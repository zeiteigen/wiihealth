// Host test: runs the real firmware sketch on this computer against simulated
// sensors, time and OLED. Build and run with firmware/test/run.sh.
// DEBUG=1 prints every lift as it is counted.
#include <deque>
#include <functional>
#include <vector>
#include <random>
#include <cassert>
#include "stubs/Arduino.h"
#include "stubs/Wire.h"
#include "stubs/Adafruit_MPU6050.h"
#include "stubs/MAX30105.h"
#include "stubs/U8g2lib.h"
#include "stubs/BLE.h"

static unsigned long g_now = 0;
unsigned long millis() { return g_now; }
static std::mt19937 rng(7);
static float noise(float s) { return std::normal_distribution<float>(0, s)(rng); }

// ---- serial and BLE ----
static std::string serialIn, serialOut;
static std::vector<std::string> bleWrites;
size_t SerialStub::write(const char *b, size_t n) { serialOut.append(b, n); return n; }
int SerialStub::available() { return serialIn.size(); }
int SerialStub::read() { if (serialIn.empty()) return -1; int c = (uint8_t)serialIn[0]; serialIn.erase(0, 1); return c; }
size_t BLEStream::write(const uint8_t *b, size_t n) { bleWrites.emplace_back((const char *)b, n); return n; }
int BLEStream::available() { return 0; }
int BLEStream::read() { return -1; }
SerialStub Serial; EspStub ESP; TwoWire Wire, Wire1; BLEStub BLE;

// ---- motion ----
static std::function<void(double t, float *a)> motion = [](double, float *a) { a[0] = 0; a[1] = -1; a[2] = 0; };
bool Adafruit_MPU6050::begin(uint8_t, TwoWire *) { return true; }
bool Adafruit_MPU6050::getEvent(sensors_event_t *e, sensors_event_t *gyroEvent, sensors_event_t *) {
  float a[3], b[3]; motion(g_now / 1000.0, a); motion(g_now / 1000.0 - .005, b);
  float na = sqrtf(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]), nb = sqrtf(b[0]*b[0]+b[1]*b[1]+b[2]*b[2]);
  float c = std::clamp((a[0]*b[0]+a[1]*b[1]+a[2]*b[2]) / (na * nb), -1.0f, 1.0f);
  gyroEvent->gyro = {noise(.02f), noise(.02f), acosf(c) / .005f + .05f};  // rad/s, with a small resting offset
  e->acceleration = {(a[0] + noise(.01f)) * 9.80665f, (a[1] + noise(.01f)) * 9.80665f, (a[2] + noise(.01f)) * 9.80665f};
  g_now += 1;  // an I2C read takes about a millisecond
  return true;
}

// ---- pulse sensor: 100 samples a second, 32-deep chip FIFO, library keeps the last 4 ----
static bool simFinger = true;
static double bpmTrue = 75, ratioTrue = 0.7;
static unsigned long nextPulseMs = 10, dropped = 0;
static std::deque<std::pair<uint32_t, uint32_t>> chip, store;
static std::pair<uint32_t, uint32_t> pulseAt(double t) {
  if (!simFinger) return {2000, 1500};
  double ph = fmod(t * bpmTrue / 60.0, 1.0);
  double wave = sin(2 * PI * ph) + 0.45 * sin(4 * PI * ph + 0.6);  // sharp rise, slow fall
  double ir = 100000 + 200 * wave + noise(4), red = 80000 + 80000 * ratioTrue * (200 * wave / 100000) + noise(4);
  return {(uint32_t)red, (uint32_t)ir};
}
bool MAX30105::begin(TwoWire &, uint32_t) { return true; }
uint16_t MAX30105::check() {
  for (; nextPulseMs <= g_now; nextPulseMs += 10) { chip.push_back(pulseAt(nextPulseMs / 1000.0)); if (chip.size() > 32) chip.pop_front(); }
  uint16_t n = chip.size();
  for (auto &s : chip) { store.push_back(s); if (store.size() > 4) { store.pop_front(); dropped++; } }
  chip.clear();
  return n;
}
uint8_t MAX30105::available() { return store.size(); }
uint32_t MAX30105::getFIFORed() { return store.front().first; }
uint32_t MAX30105::getFIFOIR() { return store.front().second; }
void MAX30105::nextSample() { if (!store.empty()) store.pop_front(); }

// ---- OLED: software I2C is slow; record what is drawn ----
const uint8_t u8g2_font_6x12_tr[1] = {6}, u8g2_font_ncenB10_tr[1] = {8}, u8g2_font_logisoso24_tn[1] = {14};
static std::vector<std::string> drawing, screen;
void U8G2_SSD1306_128X64_NONAME_F_SW_I2C::clearBuffer() { drawing.clear(); }
void U8G2_SSD1306_128X64_NONAME_F_SW_I2C::drawStr(int, int, const char *s) { drawing.push_back(s); }
void U8G2_SSD1306_128X64_NONAME_F_SW_I2C::sendBuffer() { g_now += 90; screen = drawing; }
void U8G2_SSD1306_128X64_NONAME_F_SW_I2C::updateDisplayArea(int, int row, int, int) { g_now += 11; if (row == 7) screen = drawing; }

#include "../sunroom_band/sunroom_band.ino"

// ---- driver ----
static int failures = 0;
#define CHECK(cond, ...) do { if (!(cond)) { failures++; printf("FAIL %s:%d  ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } else { printf("ok   "); printf(__VA_ARGS__); printf("\n"); } } while (0)
static double t0 = 0;
static void run(double seconds) {
  unsigned long end = g_now + (unsigned long)(seconds * 1000);
  while (g_now < end) {
    uint32_t before = count; loop(); g_now += 1;
    if (getenv("DEBUG") && mode == LIFT && count != before) printf("     count %u at t=%.2f (phase %.2f) axis %d half %.2f\n", count, g_now / 1000.0, g_now / 1000.0 - t0, swingAxis, (envHi[swingAxis < 0 ? 0 : swingAxis] - envLo[swingAxis < 0 ? 0 : swingAxis]) / 2);
  }
}
static void say(const char *cmd) { serialIn += cmd; serialIn += "\n"; run(0.05); }
static std::string screenText() { std::string s; for (auto &x : screen) s += x + " | "; return s; }
static double smoothstep(double x) { x = std::clamp(x, 0.0, 1.0); return x * x * (3 - 2 * x); }
// One curl cycle: rest, up, down (seconds); returns forearm angle in degrees.
static double curl(double c, double rest, double up, double down, double deg) {
  double phi = c < rest ? 0 : c < rest + up ? smoothstep((c - rest) / up) : 1 - smoothstep((c - rest - up) / down);
  return phi * deg * PI / 180;
}

int main(int argc, char **argv) {
  setup();
  nextPulseMs = g_now + 10;  // the pulse sensor starts sampling once it is set up
  CHECK(serialOut.find("{\"ev\":\"hello\"") != std::string::npos, "boot hello sent");
  say("HELLO"); say("MODE walk"); say("NAME Margaret"); say("START");

  // Walk: band on the lower leg, 56 strides a minute (112 steps), heel-strike spikes, harmonics.
  const double stride = 56 / 60.0;
  motion = [&](double t, float *a) {
    double p = 2 * PI * stride * t, th = (30 * sin(p) + 6 * sin(2 * p + .5)) * PI / 180;
    double ph = fmod(stride * t, 1.0), spike = 1.4 * exp(-pow((ph - .02) / .012, 2)) + .5 * exp(-pow((ph - .52) / .012, 2));
    a[0] = sin(th) + .3 * sin(p + 1); a[1] = -cos(th) - spike; a[2] = .05 * sin(3 * p);
  };
  run(60);
  CHECK(abs((int)count - 112) <= 4, "walk 60 s at 112 steps/min: counted %u steps", count);
  CHECK(fabs(pace - 112) < 6, "walk pace %.1f steps/min", pace);
  CHECK(screenText().find("Margaret") != std::string::npos && screenText().find("steps") != std::string::npos, "OLED: %s", screenText().c_str());
  CHECK(abs(bpm - 75) <= 4, "heart rate %d (true 75)", bpm);
  CHECK(abs(spo2 - 94) <= 2, "oxygen %d%% (true R=0.7 -> 94%%)", spo2);

  motion = [](double, float *a) { a[0] = .02; a[1] = -1; a[2] = .03; };  // stop
  run(5);
  uint32_t walked = count;
  CHECK(pace == 0, "pace drops to 0 after stopping (%.1f)", pace);
  run(5);
  CHECK(count == walked, "standing still adds no steps (%u)", count - walked);

  // Cycle: 65 turns a minute, shank rocks 18 degrees, pedal circle adds centripetal pull.
  say("MODE cycle"); say("START");
  const double turn = 65 / 60.0;
  motion = [&](double t, float *a) {
    double p = 2 * PI * turn * t, th = (30 + 18 * sin(p)) * PI / 180;
    a[0] = sin(th) + .25 * cos(p); a[1] = -cos(th) + .25 * sin(p); a[2] = .04 * sin(2 * p);
  };
  run(60);
  CHECK(abs((int)count - 65) <= 3, "cycle 60 s at 65 rpm: counted %u turns", count);
  CHECK(fabs(pace - 65) < 4, "cycle pace %.1f turns/min", pace);

  // Lift: wrist band, curls 1.5 s up, 1.5 s down, 1.5 s rest; gravity starts along +x.
  motion = [](double, float *a) { a[0] = 1; a[1] = 0; a[2] = 0; };  // settle into the curl position, then Start
  say("MODE lift"); run(3); say("START");
  t0 = g_now / 1000.0;
  motion = [&](double t, float *a) {
    double c = fmod(t - t0, 4.5), phi = c < 1.5 ? 0 : c < 3 ? smoothstep((c - 1.5) / 1.5) : 1 - smoothstep((c - 3) / 1.5);
    phi *= 120 * PI / 180;
    a[0] = cos(phi); a[1] = sin(phi); a[2] = 0;
  };
  run(4.5 * 10 + 1);
  CHECK(count == 10, "10 slow curls: counted %u", count);
  CHECK(pace > 2 && pace < 3.5, "seconds per lift %.2f", pace);
  bool sawFast = false;
  t0 = g_now / 1000.0;
  motion = [&](double t, float *a) {  // three quick jerks, 0.6 s each
    double c = fmod(t - t0, 2.0), phi = c < .3 ? smoothstep(c / .3) : c < .6 ? 1 - smoothstep((c - .3) / .3) : 0;
    phi *= 100 * PI / 180;
    a[0] = cos(phi); a[1] = sin(phi); a[2] = 0;
  };
  size_t mark = serialOut.size();
  run(6);
  sawFast = serialOut.find("\"fast\":1", mark) != std::string::npos;
  CHECK(count == 10, "quick jerks are not counted (%u)", count);
  CHECK(sawFast, "anti-cheat flag sent to the TV");

  t0 = g_now / 1000.0;  // a slow curl right after the jerks still counts
  motion = [&](double t, float *a) { double phi = curl(t - t0, 1, 1.5, 1.5, 110); a[0] = cos(phi); a[1] = sin(phi); a[2] = 0; };
  run(5);
  CHECK(count == 11, "slow curl after the jerks counts (%u)", count);

  // Band worn the other way round, an 8 s pause, then continuous curls with no rest.
  // The person settles into the new position first, then presses Start.
  motion = [](double, float *a) { a[0] = -1; a[1] = 0; a[2] = 0; };
  run(3);
  say("START");
  t0 = g_now / 1000.0;
  motion = [&](double t, float *a) {
    double c = t - t0, phi = c < 15 ? curl(fmod(c, 5), 2, 1.5, 1.5, 100) : c < 23 ? 0 : curl(fmod(c - 23, 4), 0, 2, 2, 120);
    a[0] = -cos(phi); a[1] = 0; a[2] = -sin(phi);
  };
  run(15);
  CHECK(count == 3, "reversed band: 3 curls counted %u", count);
  run(8);
  CHECK(count == 3, "8 s pause adds nothing (%u)", count);
  run(4 * 5 + 0.5);
  CHECK(count == 8, "5 continuous curls after the pause: total %u of 8", count);
  CHECK(pace > 3 && pace < 4.6, "continuous curls: %.2f s per lift (true 4)", pace);

  say("MSG Rest: low oxygen"); run(0.5);
  CHECK(screenText().find("Rest:") != std::string::npos, "TV message on OLED: %s", screenText().c_str());
  say("MSG"); run(0.5);
  CHECK(screenText().find("lifts") != std::string::npos, "message cleared: %s", screenText().c_str());

  simFinger = false; run(3);
  mark = serialOut.rfind("{\"ax\"");
  CHECK(serialOut.find("\"hr\":0,\"o2\":0,\"f\":0", mark) != std::string::npos, "finger off: hr and o2 report 0");
  CHECK(screenText().find("place finger") != std::string::npos, "OLED: %s", screenText().c_str());
  say("BOGUS");
  CHECK(serialOut.find("unknown command") != std::string::npos, "unknown command reported");

  CHECK(dropped == 0, "pulse samples dropped by the 4-sample library buffer: %lu", dropped);
  size_t partial = 0;
  for (auto &w : bleWrites) if (w.empty() || w.back() != '\n' || w.find('\n') != w.size() - 1) partial++;
  CHECK(partial == 0, "every BLE write is exactly one line (%zu writes)", bleWrites.size());

  if (argc > 1) { FILE *f = fopen(argv[1], "w"); fwrite(serialOut.data(), 1, serialOut.size(), f); fclose(f); }
  printf("%s: %d failure(s)\n", failures ? "FAILED" : "PASSED", failures);
  return failures ? 1 : 0;
}
