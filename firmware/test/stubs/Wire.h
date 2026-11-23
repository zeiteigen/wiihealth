#pragma once
#include "Arduino.h"
class TwoWire { public: bool begin(int, int) { return true; } };
extern TwoWire Wire, Wire1;
