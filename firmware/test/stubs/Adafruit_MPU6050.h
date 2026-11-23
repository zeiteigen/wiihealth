#pragma once
#include "Wire.h"
#define SENSORS_GRAVITY_STANDARD 9.80665F
struct sensors_vec_t { float x, y, z; };
struct sensors_event_t { sensors_vec_t acceleration; sensors_vec_t gyro; };
enum { MPU6050_RANGE_4_G = 1, MPU6050_BAND_21_HZ = 2 };
class Adafruit_MPU6050 { public: bool begin(uint8_t, TwoWire *); void setAccelerometerRange(int) {} void setFilterBandwidth(int) {}
  bool getEvent(sensors_event_t *a, sensors_event_t *, sensors_event_t *); };
