#pragma once
#include "Arduino.h"
struct BTStatus { bool ok; explicit operator bool() const { return ok; } };
struct BLEStub { void setMTU(uint16_t) {} };
extern BLEStub BLE;
class BLEStream { public: BTStatus begin(const String &) { return {true}; } bool isConnected() const { return true; }
  size_t write(const uint8_t *b, size_t n); int available(); int read(); };
