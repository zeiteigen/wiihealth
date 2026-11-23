#pragma once
#include <stdint.h>
#include <string.h>
#include <strings.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <algorithm>
#include <string>
using std::min; using std::max;
typedef uint8_t byte;
#define PI 3.1415926535897932384626433832795
#define TWO_PI 6.283185307179586476925286766559
#define degrees(rad) ((rad)*57.295779513082320876798154814105)
#define constrain(amt,low,high) ((amt)<(low)?(low):((amt)>(high)?(high):(amt)))
#define ESP_ARDUINO_VERSION_MAJOR 4
unsigned long millis();
class String { std::string s; public: String(const char *c = "") : s(c) {} const char *c_str() const { return s.c_str(); } };
struct SerialStub { void setTxBufferSize(size_t) {} void begin(unsigned long) {} size_t write(const char *b, size_t n); int available(); int read(); };
extern SerialStub Serial;
struct EspStub { uint64_t getEfuseMac() { return 0x7F3A00112233ULL; } };
extern EspStub ESP;
#define sq(x) ((x)*(x))
