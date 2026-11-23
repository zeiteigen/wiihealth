/*
 * Sunroom Band wiring check.
 *
 * Finds which ESP32 pins each I2C module is wired to and compares that with
 * the pins sunroom_band.ino expects. Upload, open Serial Monitor at 115200
 * baud, then press EN if the report scrolled past. Upload sunroom_band.ino
 * again afterwards.
 *
 * Safe by design:
 *  1. It first tries only the pin pairs the band code already uses.
 *  2. Before using any other pin, it pulls that pin low at the ESP32's weakest
 *     drive strength (about 5 mA) and reads it back. A pin wired straight to
 *     3.3 V or 5 V stays high; it is reported and never touched again.
 *  3. I2C only ever pulls lines low (open drain), so it cannot fight a module.
 */
#include <Wire.h>
#include "driver/gpio.h"

// Output-capable pins that are safe to probe (not flash, not USB serial, not BOOT).
const int PINS[] = { 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33 };
const int PIN_COUNT = sizeof(PINS) / sizeof(PINS[0]);
// Pairs the band code (and the earlier firmware) already drive as I2C.
const int KNOWN_PAIRS[][2] = { { 21, 19 }, { 23, 22 }, { 16, 4 }, { 16, 17 } };

struct Module {
  const char *name;
  uint8_t addr, altAddr;
  uint8_t idReg, idWant;  // chip ID register and the value the band's library requires (0 = none)
  int expectSda, expectScl;
  const char *defines;
  int sda = -1, scl = -1;
  uint8_t foundAddr = 0;
  int id = -1;
};
Module modules[] = {
  { "MPU-6050/6500 motion sensor", 0x68, 0x69, 0x75, 0, 21, 19, "MPU_SDA / MPU_SCL" },
  { "MAX30102 pulse sensor", 0x57, 0x57, 0xFF, 0x15, 23, 22, "MAX_SDA / MAX_SCL" },
  { "OLED screen", 0x3C, 0x3D, 0, 0, 16, 4, "OLED_SDA / OLED_SCL" },
};
bool railed[40];

bool answers(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

int readReg(uint8_t addr, uint8_t reg) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom(addr, (uint8_t)1) != 1) return -1;
  return Wire.read();
}

// Pull the pin low with the weakest driver and see whether it follows.
bool wiredToSupply(int pin) {
  gpio_num_t g = (gpio_num_t)pin;
  gpio_set_pull_mode(g, GPIO_FLOATING);
  gpio_set_level(g, 1);  // released before the driver turns on
  gpio_set_drive_capability(g, GPIO_DRIVE_CAP_0);
  gpio_set_direction(g, GPIO_MODE_INPUT_OUTPUT_OD);
  gpio_set_level(g, 0);
  delayMicroseconds(50);
  bool stuckHigh = gpio_get_level(g) == 1;
  gpio_set_level(g, 1);
  gpio_set_direction(g, GPIO_MODE_INPUT);
  gpio_set_drive_capability(g, GPIO_DRIVE_CAP_2);
  return stuckHigh;
}

void probe(int sda, int scl) {
  if (railed[sda] || railed[scl]) return;
  if (!Wire.begin(sda, scl, 100000)) return;
  Wire.setTimeOut(5);
  for (Module &m : modules) {
    if (m.sda >= 0) continue;
    uint8_t hit = answers(m.addr) ? m.addr : (m.altAddr != m.addr && answers(m.altAddr)) ? m.altAddr : 0;
    if (!hit) continue;
    m.sda = sda;
    m.scl = scl;
    m.foundAddr = hit;
    if (m.idReg) m.id = readReg(hit, m.idReg);
    Serial.printf("  found %s at 0x%02X on SDA %d, SCL %d", m.name, hit, sda, scl);
    if (m.idReg) Serial.printf(", chip ID 0x%02X", m.id & 0xFF);
    Serial.println();
  }
  Wire.end();
}

bool allFound() {
  for (Module &m : modules)
    if (m.sda < 0) return false;
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n=== Sunroom Band wiring check ===");

  Serial.println("Step 1: pins the band code already uses");
  for (auto &p : KNOWN_PAIRS) {
    probe(p[0], p[1]);
    probe(p[1], p[0]);
  }

  if (!allFound()) {
    Serial.println("Step 2: safety test on every other pin (weak 5 mA pull)");
    for (int i = 0; i < PIN_COUNT; i++) {
      railed[PINS[i]] = wiredToSupply(PINS[i]);
      if (railed[PINS[i]]) Serial.printf("  pin %d is wired straight to a supply: skipped. Check that wire!\n", PINS[i]);
    }
    Serial.println("Step 3: trying every remaining pin pair");
    for (int i = 0; i < PIN_COUNT && !allFound(); i++)
      for (int j = 0; j < PIN_COUNT && !allFound(); j++)
        if (i != j) probe(PINS[i], PINS[j]);
  }

  Serial.println("\n=== Result ===");
  bool allGood = true;
  for (Module &m : modules) {
    if (m.sda < 0) {
      allGood = false;
      Serial.printf("MISSING  %s: no answer on any pins. Check its VCC and GND wires, then SDA/SCL.\n", m.name);
      continue;
    }
    if (m.sda == m.expectSda && m.scl == m.expectScl) {
      Serial.printf("OK       %s on SDA %d, SCL %d\n", m.name, m.sda, m.scl);
    } else {
      allGood = false;
      Serial.printf("MOVED    %s is on SDA %d, SCL %d (band code expects %d / %d): set %s to %d / %d\n",
                    m.name, m.sda, m.scl, m.expectSda, m.expectScl, m.defines, m.sda, m.scl);
    }
    if (m.idWant && m.id != m.idWant) {
      allGood = false;
      Serial.printf("CHIP     %s reports ID 0x%02X; its library expects 0x%02X (a clone chip?)\n", m.name, m.id & 0xFF, m.idWant);
    }
  }
  if (modules[0].foundAddr == 0x69) Serial.println("Note: the MPU6050 answered at 0x69 (AD0 high): use mpu.begin(0x69, ...).");
  if (modules[2].foundAddr == 0x3D) Serial.println("Note: the OLED answered at 0x3D: call u8g2.setI2CAddress(0x3D * 2) before u8g2.begin().");
  Serial.println(allGood ? "WIRING_OK" : "WIRING_NEEDS_CHANGES");
}

void loop() {}
