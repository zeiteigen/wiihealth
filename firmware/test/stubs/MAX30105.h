#pragma once
#include "Wire.h"
#define I2C_SPEED_FAST 400000
class MAX30105 { public: bool begin(TwoWire &, uint32_t); void setup(byte, byte, byte, int, int, int) {}
  void setPulseAmplitudeRed(uint8_t) {} void setPulseAmplitudeGreen(uint8_t) {}
  uint16_t check(); uint8_t available(); uint32_t getFIFORed(); uint32_t getFIFOIR(); void nextSample(); };
