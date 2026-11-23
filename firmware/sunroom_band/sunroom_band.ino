/*
 * Sunroom Band: ESP32 firmware for the Sunroom TV exercise app.
 *
 * Hardware (wiring unchanged from the original sketch):
 *   MPU-6050/6500 motion     Wire           SDA 21, SCL 19
 *   MAX30102 pulse oximeter  Wire1          SDA 23, SCL 22
 *   SSD1306 128x64 OLED      software I2C   SDA 16, SCL 4
 *
 * The band talks to the TV page (designs/14-tv-tenfoot) over USB serial at
 * 115200 baud and over Bluetooth LE (Nordic UART Service). Both links carry the
 * same newline-separated text. firmware/README.md describes the protocol.
 *
 * Needs the esp32 board package 4.0.0 or newer and these libraries from the
 * Library Manager: SparkFun MAX3010x, U8g2.
 */
#include <Wire.h>
#include <algorithm>
#include <MAX30105.h>
#include <U8g2lib.h>
#include <BLE.h>
#include "driver/gpio.h"

#if ESP_ARDUINO_VERSION_MAJOR < 4
#error "Sunroom Band needs the esp32 board package 4.0.0 or newer (Tools > Board > Boards Manager)."
#endif

// ---------- Pins ----------
#define MPU_SDA 21
#define MPU_SCL 19
#define MAX_SDA 23
#define MAX_SCL 22
#define OLED_SDA 16
#define OLED_SCL 4

// ---------- Devices ----------
MAX30105 particleSensor;

BLEStream bleLink;

const char *FIRMWARE = "sunroom-band 1.0";
const unsigned long MOTION_MS = 20;      // 50 Hz motion sampling
const unsigned long TELEMETRY_MS = 40;   // 25 readings a second to the TV
const unsigned long DISPLAY_MS = 400;    // OLED refresh
const unsigned long TV_QUIET_MS = 6000;  // the TV pings every 2 s; silence this long means it left

bool mpuOk = false, ppgOk = false, bleOk = false;
uint8_t mpuId = 0;  // WHO_AM_I: 0x68 MPU-6050, 0x70 MPU-6500 (this band), 0x71 MPU-9250
char bandName[24];

// ---------- Workouts ----------
enum Mode : uint8_t { WALK, CYCLE, LIFT };
struct ModeInfo {
  const char *command;  // name the TV sends: MODE walk
  char code;            // one-letter code in each reading
  const char *title;    // OLED
  const char *unit;     // OLED, after the count
};
const ModeInfo MODES[] = {
  { "walk", 'w', "Walk", "steps" },
  { "cycle", 'c', "Cycle", "turns" },
  { "lift", 'l', "Lift", "lifts" },
};
Mode mode = WALK;

// ---------- Movement tuning (check these on the real band) ----------
// Walk and cycle: the band is on the lower leg, which swings once per stride
// (two steps) or once per pedal turn. The firmware follows whichever axis
// swings most, so the band can be worn either way round.
const float WALK_FILTER_HZ = 2.5;
const float WALK_MIN_SWING_G = 0.10;            // smallest swing either side of centre that counts
const unsigned long WALK_MIN_STRIDE_MS = 700;   // quicker than this is a double trigger, not a stride
const float CYCLE_FILTER_HZ = 3.0;
const float CYCLE_MIN_SWING_G = 0.06;
const unsigned long CYCLE_MIN_TURN_MS = 400;    // 150 turns a minute
const unsigned long RHYTHM_MAX_GAP_MS = 3000;   // a longer gap is a pause: pace drops to 0

// Lift: the band is on the wrist. A curl or raise turns the forearm, so one
// axis swings from the bottom of the lift to the top and back. The top and
// bottom are remembered for a few seconds, so pauses between lifts are fine.
const float LIFT_FILTER_HZ = 3.0;
const float LIFT_MIN_SWING_G = 0.20;          // half the smallest swing that counts (about 25 degrees)
const float LIFT_ENVELOPE_S = 4.0;            // how long the top and bottom of the last lift are remembered
const float LIFT_MAX_DPS = 300;               // anti-cheat: turning faster than this is a swing, not a lift
const float LIFT_MOVING_DPS = 25;             // turning slower than this, the arm is resting
const unsigned long FAST_WARNING_MS = 2500;   // how long "Slow down" stays up
const unsigned long STILL_MS = 1000;          // still this long: learn the gyroscope's resting offset
const float STILL_G = 0.03;

// ---------- Movement state ----------
float acc[3] = { 0, 0, 1 };   // latest reading in g (sent to the TV)
float lp1[3], lp2[3];         // two-stage low-pass of acc
float avg[3], var[3];         // slow average and variance per axis
float calm[3];                // half-second average, for stillness
float gyro[3], gyroBias[3];   // turning rate in degrees a second, and its resting offset
bool motionPrimed = false;
int swingAxis = -1;
bool swingArmed = false;
float envHi[3], envLo[3];     // lift: remembered top and bottom of each axis
float peakDps = 0, movingS = 0;
unsigned long lastMpuMs = 0, stillSinceMs = 0, lastCountMs = 0, fastWarnUntil = 0;
uint32_t count = 0;           // steps, pedal turns, or lifts since START or MODE
float pace = 0;               // steps a minute, turns a minute, or seconds per lift
unsigned long intervals[4];
uint8_t intervalCount = 0, intervalNext = 0;

// ---------- Heart rate and oxygen ----------
const uint32_t FINGER_ON_IR = 50000;       // infrared level that means a finger is on the sensor
const uint32_t FINGER_OFF_IR = 30000;      // and below which it has come off...
const unsigned long FINGER_OFF_MS = 600;   // ...for this long (brief pressure changes don't count)
const int PPG_RATE = 100;                  // the sensor makes 100 samples a second (400, averaged by 4)
const int PPG_WINDOW = 500;                // analyse the last 5 seconds of pulse wave...
const int PPG_STEP = 100;                  // ...once a second
const int LAG_MIN = PPG_RATE * 60 / 200;   // fastest pulse considered: 200 a minute
const int LAG_MAX = PPG_RATE * 60 / 35;    // slowest: 35 a minute
const float PULSE_QUALITY_MIN = 0.45f;     // how regular the wave must be to trust it (0 to 1)
const unsigned long PULSE_HOLD_MS = 8000;  // keep the last reading this long while the wave is unclear
const uint8_t ESTIMATES = 5;               // report the median of the last 5 estimates
const float MOTION_AC_FACTOR = 2.5f;       // a window pulsing this much harder than recent clean ones is movement
const float MOTION_AC_MAX = 0.01f;         // as is pulsing above 1% of the light level (a pulse is 0.1 to 0.5%)
const float BPM_JUMP = 0.25f;              // a heart rate this far from the last must repeat before it is believed
float ppgIr[PPG_WINDOW], ppgRed[PPG_WINDOW];  // filtered pulse wave (ring buffers)
int ppgHead = 0, ppgFilled = 0, ppgSinceAnalysis = 0;
float dcIr = 0, dcRed = 0;

// Second-order filter section (RBJ cookbook biquad, transposed direct form II).
struct Biquad {
  float b0, b1, b2, a1, a2, z1 = 0, z2 = 0;
  static Biquad make(bool highPass, float hz) {
    float w = 2 * PI * hz / PPG_RATE, c = cosf(w), alpha = sinf(w) / (2 * 0.7071f), a0 = 1 + alpha;
    float b0 = highPass ? (1 + c) / 2 : (1 - c) / 2, b1 = highPass ? -(1 + c) : 1 - c;
    return { b0 / a0, b1 / a0, b0 / a0, -2 * c / a0, (1 - alpha) / a0 };
  }
  float step(float x) {
    float y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  }
  void reset() { z1 = z2 = 0; }
};
// Band-pass 0.5 to 4 Hz (30 to 240 beats a minute): two high-pass stages
// strip breathing and finger-pressure drift, one low-pass stage strips noise.
struct PulseFilter {
  Biquad hp1 = Biquad::make(true, 0.5f), hp2 = Biquad::make(true, 0.5f), lp = Biquad::make(false, 4.0f);
  float step(float x) { return lp.step(hp2.step(hp1.step(x))); }
  void reset() { hp1.reset(); hp2.reset(); lp.reset(); }
};
PulseFilter irFilter, redFilter;
bool rawMode = false;  // RAW 1: also stream every sensor sample over USB, for tuning
float bpmEst[ESTIMATES], spo2Est[ESTIMATES], acEst[ESTIMATES];
uint8_t bpmEstCount = 0, bpmEstNext = 0, spo2EstCount = 0, spo2EstNext = 0, acEstCount = 0, acEstNext = 0, bpmRejects = 0;
unsigned long pulseClock = 0, lastGoodPulse = 0, fingerLowSince = 0, fingerOnAt = 0;  // sensor time, in ms
int bpm = 0;    // 0 = no reading yet
int spo2 = 0;   // 0 = no reading yet
float pulseQuality = 0, pulseAc = 0, pulseRawBpm = 0;  // last analysis, sent for tuning
uint8_t ppgFailures = 0;
unsigned long ppgRetryMs = 0;
bool fingerOn = false;
uint32_t irLevel = 0;  // latest infrared reading, sent to help check finger contact

// ---------- TV link ----------
struct LineReader {
  char buf[64];
  uint8_t len;
};
LineReader usbIn = {}, bleIn = {};
unsigned long lastHeardMs = 0, lastTelemetryMs = 0, lastDisplayMs = 0;
bool heardOverBle = false;
char userName[16] = "";
char message[24] = "";
unsigned long messageUntil = 0;  // 0 = until the TV clears it

// The OLED is on ordinary pins (software I2C). U8g2's stock Arduino driver
// calls pinMode() for every bit, which takes about 0.9 s per screen on this
// core and starves everything else. This driver switches the pins as
// open-drain outputs directly: they are only ever pulled low, never driven high.
uint8_t oledGpio(u8x8_t *, uint8_t msg, uint8_t arg, void *) {
  switch (msg) {
    case U8X8_MSG_GPIO_AND_DELAY_INIT:
      for (int pin : { OLED_SDA, OLED_SCL }) {
        gpio_set_level((gpio_num_t)pin, 1);
        gpio_set_direction((gpio_num_t)pin, GPIO_MODE_INPUT_OUTPUT_OD);
        gpio_set_pull_mode((gpio_num_t)pin, GPIO_PULLUP_ONLY);
      }
      break;
    case U8X8_MSG_DELAY_MILLI: delay(arg); break;
    case U8X8_MSG_DELAY_10MICRO: delayMicroseconds(10 * arg); break;
    case U8X8_MSG_DELAY_100NANO: delayMicroseconds(1); break;
    case U8X8_MSG_DELAY_I2C: delayMicroseconds(2); break;
    case U8X8_MSG_GPIO_I2C_CLOCK: gpio_set_level((gpio_num_t)OLED_SCL, arg); break;
    case U8X8_MSG_GPIO_I2C_DATA: gpio_set_level((gpio_num_t)OLED_SDA, arg); break;
  }
  return 1;
}

class Oled : public U8G2 {
public:
  Oled() : U8G2() {
    u8g2_Setup_ssd1306_i2c_128x64_noname_f(&u8g2, U8G2_R0, u8x8_byte_sw_i2c, oledGpio);
    // A 2.42" OLED uses the SSD1309 chip: call u8g2_Setup_ssd1309_i2c_128x64_noname0_f instead.
  }
};
Oled u8g2;

bool until(unsigned long deadline) {
  return (long)(deadline - millis()) > 0;
}

// ======================================================================
// Sending to the TV
// ======================================================================
void sendLine(const char *line, int len) {
  if (len <= 0) return;
  Serial.write(line, len);
  if (bleOk && bleLink.isConnected()) bleLink.write((const uint8_t *)line, len);  // one call, so one line per notification
}

void sendHello() {
  char line[160];
  int n = snprintf(line, sizeof(line), "{\"ev\":\"hello\",\"fw\":\"%s\",\"name\":\"%s\",\"mpu\":%d,\"imu\":\"%02X\",\"ppg\":%d,\"ble\":%d,\"m\":\"%c\"}\n",
                   FIRMWARE, bandName, mpuOk, mpuId, ppgOk, bleOk, MODES[mode].code);
  sendLine(line, min(n, (int)sizeof(line) - 1));
}

void sendEvent(const char *ev, const char *msg) {
  char line[120];
  int n = snprintf(line, sizeof(line), "{\"ev\":\"%s\",\"msg\":\"%s\",\"m\":\"%c\"}\n", ev, msg, MODES[mode].code);
  sendLine(line, min(n, (int)sizeof(line) - 1));
}

void sendTelemetry() {
  char line[160];
  int n = snprintf(line, sizeof(line),
                   "{\"ax\":%.2f,\"ay\":%.2f,\"az\":%.2f,\"hr\":%d,\"o2\":%d,\"f\":%d,\"n\":%lu,\"c\":%.1f,\"fast\":%d,\"m\":\"%c\",\"ir\":%lu,\"pq\":%d,\"pa\":%d,\"pe\":%d}\n",
                   acc[0], acc[1], acc[2], bpm, spo2, fingerOn ? 1 : 0, (unsigned long)count, pace,
                   until(fastWarnUntil) ? 1 : 0, MODES[mode].code, (unsigned long)(irLevel / 1000),
                   (int)(pulseQuality * 100), (int)(pulseAc * 10000), (int)pulseRawBpm);
  sendLine(line, min(n, (int)sizeof(line) - 1));
}

// ======================================================================
// Movement: steps, pedal turns and lifts
// ======================================================================
float smoothing(float dt, float tau) {
  return dt / (dt + tau);
}

void resetCounting() {
  count = 0;
  pace = 0;
  intervalCount = intervalNext = 0;
  lastCountMs = 0;
  swingAxis = -1;
  swingArmed = false;
  peakDps = movingS = 0;
  motionPrimed = false;
  fastWarnUntil = 0;
}

void setMode(Mode m) {
  mode = m;
  resetCounting();
}

void primeMotion(unsigned long now) {
  for (int i = 0; i < 3; i++) {
    lp1[i] = lp2[i] = avg[i] = calm[i] = envHi[i] = envLo[i] = acc[i];
    var[i] = 0;
  }
  stillSinceMs = now;
  motionPrimed = true;
}

void addInterval(unsigned long ms) {
  intervals[intervalNext] = ms;
  intervalNext = (intervalNext + 1) % 4;
  if (intervalCount < 4) intervalCount++;
}

float averageInterval() {
  unsigned long sum = 0;
  for (uint8_t i = 0; i < intervalCount; i++) sum += intervals[i];
  return intervalCount ? (float)sum / intervalCount : 0;
}

// Follow the axis that moves most, so the band works whichever way it is worn.
// Returns true when it changes axis.
bool pickSwingAxis() {
  int best = 0;
  for (int i = 1; i < 3; i++)
    if (var[i] > var[best]) best = i;
  if (swingAxis >= 0 && (best == swingAxis || var[best] <= 1.5f * var[swingAxis])) return false;
  swingAxis = best;
  swingArmed = false;
  return true;
}

// Walk and cycle: count one swing each time the busiest axis goes from below
// its average to above it, with hysteresis so noise can't count.
void detectRhythm(unsigned long now) {
  pickSwingAxis();
  float minSwing = mode == WALK ? WALK_MIN_SWING_G : CYCLE_MIN_SWING_G;
  float h = max(minSwing, 0.5f * sqrtf(var[swingAxis]));
  float s = lp2[swingAxis] - avg[swingAxis];
  if (s < -h) {
    swingArmed = true;
  } else if (swingArmed && s > h) {
    swingArmed = false;
    unsigned long minGap = mode == WALK ? WALK_MIN_STRIDE_MS : CYCLE_MIN_TURN_MS;
    if (lastCountMs && now - lastCountMs < minGap) return;  // second bump inside one swing
    unsigned long gap = lastCountMs ? now - lastCountMs : 0;
    lastCountMs = now;
    count += mode == WALK ? 2 : 1;  // one leg swing is one stride: two steps
    if (gap > 0 && gap <= RHYTHM_MAX_GAP_MS) {
      addInterval(gap);
      pace = (mode == WALK ? 120000.0f : 60000.0f) / averageInterval();
    }
  }
}

// Lift: one count per swing of the busiest axis between its remembered top
// and bottom. Each lift is counted once, at the top or on the way back down
// depending on how the band is worn.
void detectLift(unsigned long now, float dt) {
  float k = smoothing(dt, LIFT_ENVELOPE_S);
  for (int i = 0; i < 3; i++) {
    envHi[i] = max(lp2[i], envHi[i] + k * (lp2[i] - envHi[i]));
    envLo[i] = min(lp2[i], envLo[i] + k * (lp2[i] - envLo[i]));
  }
  // Keep the axis while it is counting; change only when it is too small to
  // count or the arm is resting, so a lift is never counted on two axes.
  bool canCount = swingAxis >= 0 && envHi[swingAxis] - envLo[swingAxis] >= 2 * LIFT_MIN_SWING_G;
  if ((!canCount || now - stillSinceMs >= STILL_MS) && pickSwingAxis())
    swingArmed = lp2[swingAxis] < (envHi[swingAxis] + envLo[swingAxis]) / 2;
  float v = lp2[swingAxis], half = (envHi[swingAxis] - envLo[swingAxis]) / 2, mid = (envHi[swingAxis] + envLo[swingAxis]) / 2;
  float rate = sqrtf(sq(gyro[0] - gyroBias[0]) + sq(gyro[1] - gyroBias[1]) + sq(gyro[2] - gyroBias[2]));
  peakDps = max(peakDps, rate);
  if (rate > LIFT_MOVING_DPS) movingS += dt;
  if (half < LIFT_MIN_SWING_G || v < mid - 0.3f * half) {  // resting, or back at the far side: ready
    swingArmed = true;
    peakDps = 0;  // judge each lift's speed by its own sweep only
  } else if (swingArmed && v > mid + 0.3f * half) {
    swingArmed = false;
    if (peakDps > LIFT_MAX_DPS) {  // anti-cheat: whipping the band around is not a lift
      fastWarnUntil = now + FAST_WARNING_MS;
    } else {
      count++;
      lastCountMs = now;
      if (movingS > 0.5f) pace = movingS;  // seconds the arm was moving: pauses don't count
    }
    peakDps = movingS = 0;
  }
}

// ---------- Motion sensor, read register by register ----------
// The Adafruit library only accepts the original MPU-6050 (ID 0x68); this band
// has an MPU-6500 (0x70), which keeps the same registers for these readings.
// Wake only, never a device reset.
const uint8_t MPU_ADDR = 0x68;
uint8_t mpuFailures = 0;
unsigned long mpuRetryMs = 0;

bool mpuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool mpuRead(uint8_t reg, uint8_t *buf, uint8_t len) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, len) != len) return false;
  for (uint8_t i = 0; i < len; i++) buf[i] = Wire.read();
  return true;
}

bool mpuStart() {
  if (!mpuRead(0x75, &mpuId, 1)) return false;
  bool ok = mpuWrite(0x6B, 0x00);                       // wake up
  delay(10);
  ok = ok && mpuWrite(0x1A, 0x04);                      // low-pass about 20 Hz
  ok = ok && mpuWrite(0x1B, 0x08);                      // gyroscope +-500 degrees a second
  ok = ok && mpuWrite(0x1C, 0x08);                      // accelerometer +-4 g
  if (ok && mpuId != 0x68) ok = mpuWrite(0x1D, 0x04);  // MPU-6500 family: accelerometer low-pass
  mpuFailures = 0;
  return ok;
}

bool mpuSample() {
  uint8_t b[14];
  if (!mpuRead(0x3B, b, 14)) return false;
  for (int i = 0; i < 3; i++) {
    acc[i] = (int16_t)(b[2 * i] << 8 | b[2 * i + 1]) / 8192.0f;     // +-4 g range
    gyro[i] = (int16_t)(b[8 + 2 * i] << 8 | b[9 + 2 * i]) / 65.5f;  // +-500 degrees a second range
  }
  return true;
}

void sampleMotion(unsigned long now) {
  float dt = (now - lastMpuMs) / 1000.0f;
  lastMpuMs = now;
  if (!mpuSample()) {
    if (++mpuFailures >= 25) {  // half a second of failed reads: a wire came loose
      mpuOk = false;
      mpuRetryMs = now;
      sendEvent("error", "motion sensor lost");
    }
    return;
  }
  mpuFailures = 0;
  if (!motionPrimed || dt <= 0 || dt > 0.5f) {
    primeMotion(now);
    return;
  }
  float hz = mode == WALK ? WALK_FILTER_HZ : mode == CYCLE ? CYCLE_FILTER_HZ : LIFT_FILTER_HZ;
  float k = smoothing(dt, 1.0f / (TWO_PI * hz)), kSlow = smoothing(dt, 2.0f), kCalm = smoothing(dt, 0.5f);
  float drift = 0;
  for (int i = 0; i < 3; i++) {
    lp1[i] += k * (acc[i] - lp1[i]);
    lp2[i] += k * (lp1[i] - lp2[i]);
    float d = lp2[i] - avg[i];
    avg[i] += kSlow * d;
    var[i] += kSlow * (d * d - var[i]);
    calm[i] += kCalm * (lp2[i] - calm[i]);
    drift += (lp2[i] - calm[i]) * (lp2[i] - calm[i]);
  }
  if (sqrtf(drift) > STILL_G) stillSinceMs = now;
  if (now - stillSinceMs >= STILL_MS)
    for (int i = 0; i < 3; i++) gyroBias[i] += 0.02f * (gyro[i] - gyroBias[i]);
  if (mode == LIFT) {
    detectLift(now, dt);
  } else {
    detectRhythm(now);
    if (lastCountMs && now - lastCountMs > RHYTHM_MAX_GAP_MS) {
      pace = 0;
      intervalCount = intervalNext = 0;
    }
  }
}

// ======================================================================
// Heart rate (original beat detector) and blood oxygen
// ======================================================================
float medianOf(const float *v, uint8_t n) {
  n = min(n, ESTIMATES);
  float sorted[ESTIMATES];
  memcpy(sorted, v, n * sizeof(float));
  std::sort(sorted, sorted + n);
  return n % 2 ? sorted[n / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

// Drop the readings but remember how strong a clean pulse is, so the tail
// of a movement can still be recognised.
void clearReadings() {
  bpm = spo2 = 0;
  bpmEstCount = bpmEstNext = spo2EstCount = spo2EstNext = bpmRejects = 0;
}

void clearPulse() {  // finger lifted or placed: start fresh
  clearReadings();
  pulseQuality = 0;
  ppgFilled = ppgSinceAnalysis = 0;
  acEstCount = acEstNext = 0;
}

void addEstimate(float *v, uint8_t &count, uint8_t &next, float value) {
  v[next] = value;
  next = (next + 1) % ESTIMATES;
  if (count < ESTIMATES) count++;
}

// Finds the pulse period (in samples) by autocorrelation of the wave: how far
// the wave must be shifted to line up with itself. Beat-by-beat detection
// double-counts the small second bump in each pulse; this can't. Returns 0 if
// the wave isn't clearly periodic, and its quality (0 to 1) in `quality`.
float pulsePeriod(const float *x, int n, float &quality) {
  static float centred[PPG_WINDOW], r[LAG_MAX + 2];
  // Remove the best straight line through the window (drift the filter left behind).
  float mean = 0, slope = 0, spread = 0, energy = 0, mid = (n - 1) / 2.0f;
  for (int i = 0; i < n; i++) mean += x[i];
  mean /= n;
  for (int i = 0; i < n; i++) {
    slope += (i - mid) * (x[i] - mean);
    spread += (i - mid) * (i - mid);
  }
  slope /= spread;
  for (int i = 0; i < n; i++) {
    centred[i] = x[i] - mean - slope * (i - mid);
    energy += centred[i] * centred[i];
  }
  quality = 0;
  if (energy <= 0) return 0;
  for (int lag = LAG_MIN - 1; lag <= LAG_MAX + 1; lag++) {
    float sum = 0;
    for (int i = 0; i + lag < n; i++) sum += centred[i] * centred[i + lag];
    r[lag] = sum / energy * n / (n - lag);
  }
  int best = 0;  // strongest peak
  for (int lag = LAG_MIN; lag <= LAG_MAX; lag++)
    if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && (!best || r[lag] > r[best])) best = lag;
  if (!best) return 0;
  // The strongest peak can be two beats long; a shorter peak nearly as strong is the real period.
  for (int lag = LAG_MIN; lag < best; lag++)
    if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] > 0.85f * r[best]) {
      best = lag;
      break;
    }
  quality = r[best];
  float a = r[best - 1], b = r[best], c = r[best + 1], d = a - 2 * b + c;
  return best + (d < 0 ? 0.5f * (a - c) / d : 0);  // fit a parabola for sub-sample precision
}

float rms(const float *x, int n) {
  float mean = 0, sum = 0;
  for (int i = 0; i < n; i++) mean += x[i];
  mean /= n;
  for (int i = 0; i < n; i++) sum += (x[i] - mean) * (x[i] - mean);
  return sqrtf(sum / n);
}

void analysePulse() {
  static float ir[PPG_WINDOW], red[PPG_WINDOW];
  for (int i = 0; i < PPG_WINDOW; i++) {
    int j = (ppgHead + i) % PPG_WINDOW;
    ir[i] = ppgIr[j];
    red[i] = ppgRed[j];
  }
  float period = pulsePeriod(ir, PPG_WINDOW, pulseQuality);
  float acIr = rms(ir, PPG_WINDOW);
  float acRel = dcIr > 0 ? acIr / dcIr : 1;
  pulseAc = acRel;
  pulseRawBpm = period > 0 ? 60.0f * PPG_RATE / period : 0;
  // Movement shakes the light far more than a pulse does, and can look just as regular.
  bool moving = acRel > MOTION_AC_MAX || (acEstCount >= 3 && acRel > MOTION_AC_FACTOR * medianOf(acEst, acEstCount));
  if (period <= 0 || pulseQuality < PULSE_QUALITY_MIN || moving) {  // hold the last reading for a while
    if (pulseClock - lastGoodPulse > PULSE_HOLD_MS) clearReadings();
    return;
  }
  float estimate = 60.0f * PPG_RATE / period;
  if (bpm && fabsf(estimate - bpm) > BPM_JUMP * bpm && ++bpmRejects < 4) return;  // a sudden jump must repeat
  if (bpmRejects >= 4) bpmEstCount = bpmEstNext = 0;  // it did: the heart rate really changed
  bpmRejects = 0;
  lastGoodPulse = pulseClock;
  addEstimate(acEst, acEstCount, acEstNext, acRel);
  addEstimate(bpmEst, bpmEstCount, bpmEstNext, estimate);
  bpm = lroundf(medianOf(bpmEst, bpmEstCount));

  // Oxygen, only from a clean window: compare the pulsing part of the red and
  // infrared light with their steady part. Approximate and uncalibrated.
  // Folding the window at the pulse period gives the average beat: only what
  // repeats with every beat survives, so breathing and pressure drift (which
  // dim both colours alike) can't drag the ratio down.
  const int BINS = 20;
  float beatIr[BINS] = { 0 }, beatRed[BINS] = { 0 };
  int inBin[BINS] = { 0 };
  for (int i = 0; i < PPG_WINDOW; i++) {
    int bin = min(BINS - 1, (int)(fmodf(i, period) / period * BINS));
    beatIr[bin] += ir[i];
    beatRed[bin] += red[i];
    inBin[bin]++;
  }
  for (int b = 0; b < BINS; b++) {
    beatIr[b] /= max(1, inBin[b]);
    beatRed[b] /= max(1, inBin[b]);
  }
  float beatAcIr = rms(beatIr, BINS), beatAcRed = rms(beatRed, BINS);
  if (beatAcIr <= 0 || dcIr <= 0 || dcRed <= 0) return;
  float ratio = (beatAcRed / dcRed) / (beatAcIr / dcIr);
  if (ratio < 0.3f || ratio > 1.6f) return;
  addEstimate(spo2Est, spo2EstCount, spo2EstNext, constrain(-45.060f * ratio * ratio + 30.354f * ratio + 94.845f, 70.0f, 100.0f));
  if (spo2EstCount < 3) return;
  int target = lroundf(medianOf(spo2Est, spo2EstCount));
  spo2 = spo2 ? spo2 + constrain(target - spo2, -1, 1) : target;  // real oxygen levels change slowly
}

void processPulse(uint32_t red, uint32_t ir) {
  unsigned long now = pulseClock += 1000 / PPG_RATE;
  if (rawMode) {
    char line[32];
    Serial.write(line, snprintf(line, sizeof(line), "r,%lu,%lu\n", (unsigned long)red, (unsigned long)ir));
  }
  irLevel = ir;
  if (fingerOn && ir < FINGER_OFF_IR) {
    if (!fingerLowSince) fingerLowSince = now;
    if (now - fingerLowSince >= FINGER_OFF_MS) {
      clearPulse();
      fingerOn = false;
    }
    return;
  }
  fingerLowSince = 0;
  if (!fingerOn) {
    if (ir < FINGER_ON_IR) return;
    fingerOn = true;
    fingerOnAt = lastGoodPulse = now;
    dcIr = ir;
    dcRed = red;
    irFilter.reset();
    redFilter.reset();
    clearPulse();
  }
  dcIr += 0.01f * (ir - dcIr);  // steady light level (about 1 s), for the oxygen ratio
  dcRed += 0.01f * (red - dcRed);
  float pulseIr = irFilter.step(ir - dcIr), pulseRed = redFilter.step(red - dcRed);  // only the pulsing part
  if (now - fingerOnAt < 2000) return;  // let the filters settle after the finger lands
  ppgIr[ppgHead] = pulseIr;
  ppgRed[ppgHead] = pulseRed;
  ppgHead = (ppgHead + 1) % PPG_WINDOW;
  if (ppgFilled < PPG_WINDOW) ppgFilled++;
  if (++ppgSinceAnalysis >= PPG_STEP && ppgFilled == PPG_WINDOW) {
    ppgSinceAnalysis = 0;
    analysePulse();
  }
}

// Drain the sensor's own 32-sample FIFO (320 ms of slack). The SparkFun
// library's check() keeps only the newest 4 samples, so any pause of more than
// 40 ms silently dropped samples and made the beat detector miss beats.
bool maxRead(uint8_t reg, uint8_t *buf, uint8_t len) {
  Wire1.beginTransmission(0x57);
  Wire1.write(reg);
  if (Wire1.endTransmission(false) != 0) return false;
  if (Wire1.requestFrom((uint8_t)0x57, len) != len) return false;
  for (uint8_t i = 0; i < len; i++) buf[i] = Wire1.read();
  return true;
}

void readPulseSensor() {
  if (!ppgOk) return;
  uint8_t ptr[3];  // FIFO write pointer, overflow counter, read pointer
  if (!maxRead(0x04, ptr, 3)) {
    if (++ppgFailures >= 50) {  // a wire came loose, or the sensor is stuck
      ppgOk = false;
      ppgRetryMs = millis();
      sendEvent("error", "pulse sensor lost");
    }
    return;
  }
  ppgFailures = 0;
  int waiting = (ptr[0] - ptr[2]) & 0x1F;
  if (!waiting && ptr[1]) waiting = 32;  // completely full
  while (waiting > 0) {
    uint8_t batch = min(waiting, 20), buf[120];  // 20 samples = 120 bytes, inside the I2C buffer
    if (!maxRead(0x07, buf, batch * 6)) return;
    for (uint8_t i = 0; i < batch; i++) {
      const uint8_t *b = buf + 6 * i;  // red then infrared, 18 bits each
      processPulse(((uint32_t)b[0] << 16 | b[1] << 8 | b[2]) & 0x3FFFF, ((uint32_t)b[3] << 16 | b[4] << 8 | b[5]) & 0x3FFFF);
    }
    waiting -= batch;
  }
}

// If the ESP32 restarts in the middle of a sensor read (flashing does this),
// the sensor can be left holding its data line low. Nine clock pulses free it.
// Open drain throughout: the pins are only ever pulled low.
void clearI2CBus(int sda, int scl) {
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, OUTPUT_OPEN_DRAIN);
  digitalWrite(scl, HIGH);
  delayMicroseconds(5);
  for (int i = 0; i < 9 && digitalRead(sda) == LOW; i++) {
    digitalWrite(scl, LOW);
    delayMicroseconds(5);
    digitalWrite(scl, HIGH);
    delayMicroseconds(5);
  }
  pinMode(sda, OUTPUT_OPEN_DRAIN);  // stop condition: data rises while the clock is high
  digitalWrite(sda, LOW);
  delayMicroseconds(5);
  digitalWrite(sda, HIGH);
  delayMicroseconds(5);
  pinMode(sda, INPUT);
  pinMode(scl, INPUT);
}

bool startPulseSensor() {
  if (!particleSensor.begin(Wire1, I2C_SPEED_STANDARD)) return false;  // 100 kHz: the cable to the finger is long
  particleSensor.setup(0x1F, 4, 2, 400, 411, 4096);  // LED brightness, avg, mode, rate, pulse width, range
  particleSensor.setPulseAmplitudeRed(0x1F);          // red as bright as infrared, for the oxygen estimate
  particleSensor.setPulseAmplitudeGreen(0);
  ppgFailures = 0;
  return true;
}

void serviceSensors() {
  readPulseSensor();
  unsigned long now = millis();
  if (mpuOk && now - lastMpuMs >= MOTION_MS) {
    sampleMotion(now);
  }
  if (!ppgOk && now - ppgRetryMs >= 2000) {  // pulse sensor missing or lost: try again every 2 s
    ppgRetryMs = now;
    if ((ppgOk = startPulseSensor())) sendHello();
  }
  if (!mpuOk && now - mpuRetryMs >= 2000) {  // motion sensor missing or lost: try again every 2 s
    mpuRetryMs = now;
    if ((mpuOk = mpuStart())) {
      motionPrimed = false;
      sendHello();
    }
  }
}

// ======================================================================
// Commands from the TV
// ======================================================================
void copyText(char *dst, size_t size, const char *src) {
  size_t n = 0;
  for (; *src && n < size - 1; src++)
    if (*src >= 32 && *src < 127) dst[n++] = *src;  // the OLED font is plain ASCII
  dst[n] = 0;
}

void showMessage(const char *text, unsigned long ms) {
  copyText(message, sizeof(message), text);
  messageUntil = ms ? millis() + ms : 0;
}

void handleCommand(char *line, bool viaBle) {
  lastHeardMs = millis();
  heardOverBle = viaBle;
  char *arg = strchr(line, ' ');
  if (arg) {
    *arg++ = 0;
    while (*arg == ' ') arg++;
  } else {
    arg = line + strlen(line);
  }

  if (!strcasecmp(line, "PING")) return;
  if (!strcasecmp(line, "HELLO")) {
    sendHello();
  } else if (!strcasecmp(line, "MODE")) {
    for (uint8_t i = 0; i < 3; i++) {
      if (!strcasecmp(arg, MODES[i].command)) {
        if (mode != i) setMode((Mode)i);
        sendEvent("mode", MODES[i].command);
        return;
      }
    }
    sendEvent("error", "unknown mode");
  } else if (!strcasecmp(line, "START")) {
    resetCounting();
    showMessage("Let's go!", 2500);
  } else if (!strcasecmp(line, "STOP")) {
    showMessage("Well done!", 6000);
  } else if (!strcasecmp(line, "NAME")) {
    copyText(userName, sizeof(userName), arg);
  } else if (!strcasecmp(line, "RAW")) {
    rawMode = atoi(arg) != 0;
  } else if (!strcasecmp(line, "MSG")) {
    showMessage(arg, 0);  // an empty MSG clears the message
  } else {
    sendEvent("error", "unknown command");
  }
}

void feed(LineReader &in, int c, bool viaBle) {
  if (c < 0) return;
  if (c == '\n' || c == '\r') {
    if (in.len) {
      in.buf[in.len] = 0;
      in.len = 0;
      handleCommand(in.buf, viaBle);
    }
  } else if (in.len < sizeof(in.buf) - 1) {
    in.buf[in.len++] = (char)c;
  }
}

void pollCommands() {
  while (Serial.available()) feed(usbIn, Serial.read(), false);
  if (bleOk)
    while (bleLink.available()) feed(bleIn, bleLink.read(), true);
}

// ======================================================================
// OLED
// ======================================================================
const char *tvLink() {
  if (bleOk && bleLink.isConnected()) return "BT";
  if (lastHeardMs && millis() - lastHeardMs < TV_QUIET_MS && !heardOverBle) return "USB";
  return "";
}

void drawCentered(const char *text, int y) {
  u8g2.drawStr(max(0, (128 - (int)u8g2.getStrWidth(text)) / 2), y, text);
}

// One or two centred lines in the big font.
void drawBigText(const char *text) {
  u8g2.setFont(u8g2_font_ncenB10_tr);
  if (u8g2.getStrWidth(text) <= 128) {
    drawCentered(text, 40);
    return;
  }
  char first[sizeof(message)];
  copyText(first, sizeof(first), text);
  int len = strlen(first), mid = len / 2, cut = -1;
  for (int d = 0; d <= mid && cut < 0; d++) {  // split at the space nearest the middle
    if (first[mid - d] == ' ') cut = mid - d;
    else if (mid + d < len && first[mid + d] == ' ') cut = mid + d;
  }
  if (cut < 0) {  // one long word: use the small font
    u8g2.setFont(u8g2_font_6x12_tr);
    drawCentered(first, 40);
    return;
  }
  first[cut] = 0;
  drawCentered(first, 32);
  drawCentered(first + cut + 1, 48);
}

// Send the screen one 8-pixel row at a time, reading the sensors in between so
// the slow software I2C never starves the pulse sensor.
void sendScreen() {
  for (uint8_t row = 0; row < 8; row++) {
    u8g2.updateDisplayArea(0, row, 16, 1);
    serviceSensors();
  }
}

void drawScreen() {
  if (messageUntil && !until(messageUntil)) message[0] = 0;
  if (message[0] && !messageUntil && millis() - lastHeardMs > TV_QUIET_MS) message[0] = 0;  // the TV left

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x12_tr);
  u8g2.drawStr(0, 10, userName[0] ? userName : "Sunroom Band");
  char right[16];
  snprintf(right, sizeof(right), "%s %s", MODES[mode].title, tvLink());
  u8g2.drawStr(128 - u8g2.getStrWidth(right), 10, right);
  u8g2.drawHLine(0, 13, 128);

  if (message[0]) {
    drawBigText(message);
  } else if (until(fastWarnUntil)) {
    u8g2.setFont(u8g2_font_ncenB10_tr);
    drawCentered("Slow down", 36);
    u8g2.setFont(u8g2_font_6x12_tr);
    drawCentered("Easy does it", 50);
  } else if (!mpuOk) {
    u8g2.setFont(u8g2_font_6x12_tr);
    drawCentered("Motion sensor", 32);
    drawCentered("not found", 46);
  } else {
    char num[12];
    snprintf(num, sizeof(num), "%lu", (unsigned long)count);
    u8g2.setFont(u8g2_font_logisoso24_tn);
    int w = u8g2.getStrWidth(num);
    u8g2.setFont(u8g2_font_6x12_tr);
    int x = (128 - (w + 4 + (int)u8g2.getStrWidth(MODES[mode].unit))) / 2;
    u8g2.drawStr(x + w + 4, 44, MODES[mode].unit);
    u8g2.setFont(u8g2_font_logisoso24_tn);
    u8g2.drawStr(x, 44, num);
  }

  u8g2.setFont(u8g2_font_6x12_tr);
  char vitals[24];
  if (!ppgOk) snprintf(vitals, sizeof(vitals), "Pulse sensor missing");
  else if (!fingerOn) snprintf(vitals, sizeof(vitals), "HR --  place finger");
  else if (!bpm) snprintf(vitals, sizeof(vitals), "HR ...  O2 ...");
  else if (!spo2) snprintf(vitals, sizeof(vitals), "HR %d  O2 ...", bpm);
  else snprintf(vitals, sizeof(vitals), "HR %d  O2 %d%%", bpm, spo2);
  drawCentered(vitals, 63);
  sendScreen();
}

// ======================================================================
void setup() {
  Serial.setTxBufferSize(1024);  // telemetry never waits on the UART
  Serial.begin(115200);
  uint64_t mac = ESP.getEfuseMac();
  snprintf(bandName, sizeof(bandName), "Sunroom Band %02X%02X", (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));

  u8g2.begin();
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB10_tr);
  drawCentered("Sunroom Band", 30);
  u8g2.setFont(u8g2_font_6x12_tr);
  drawCentered("starting", 48);
  u8g2.sendBuffer();

  clearI2CBus(MPU_SDA, MPU_SCL);
  clearI2CBus(MAX_SDA, MAX_SCL);
  Wire.begin(MPU_SDA, MPU_SCL);
  Wire.setTimeOut(10);  // a loose wire must not stall the band
  Wire1.begin(MAX_SDA, MAX_SCL);
  Wire1.setTimeOut(10);

  // Keep going without a missing sensor so the TV can still show the rest.
  mpuOk = mpuStart();
  if (!mpuOk) sendEvent("error", "motion sensor not found");

  ppgOk = startPulseSensor();
  if (!ppgOk) sendEvent("error", "pulse sensor not found");

  bleOk = !!bleLink.begin(bandName);  // advertises the Nordic UART Service
  if (bleOk) BLE.setMTU(185);        // room for a whole reading in one notification
  else sendEvent("error", "Bluetooth did not start");

  sendHello();
}

void loop() {
  serviceSensors();
  pollCommands();
  unsigned long now = millis();
  if (now - lastTelemetryMs >= TELEMETRY_MS) {
    lastTelemetryMs = now;
    sendTelemetry();
  }
  if (now - lastDisplayMs >= DISPLAY_MS) {
    lastDisplayMs = now;
    drawScreen();
  }
}
