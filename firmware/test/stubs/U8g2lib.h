#pragma once
#include "Arduino.h"
#define U8G2_R0 nullptr
#define U8X8_PIN_NONE 255
extern const uint8_t u8g2_font_6x12_tr[1], u8g2_font_ncenB10_tr[1], u8g2_font_logisoso24_tn[1];
class U8G2_SSD1306_128X64_NONAME_F_SW_I2C { public: U8G2_SSD1306_128X64_NONAME_F_SW_I2C(const void *, int, int, int) {}
  void begin() {} void clearBuffer(); void setFont(const uint8_t *f) { font = f; } void drawStr(int x, int y, const char *s);
  unsigned getStrWidth(const char *s) { return strlen(s) * font[0]; } void drawHLine(int, int, int) {}
  void sendBuffer(); void updateDisplayArea(int, int row, int, int); const uint8_t *font = u8g2_font_6x12_tr; };
