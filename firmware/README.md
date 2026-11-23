# Sunroom Band firmware

ESP32 firmware for the exercise band. It counts steps, pedal turns and dumbbell lifts, reads heart rate and blood oxygen, and streams everything to the Sunroom TV page over a USB cable or Bluetooth. The TV sends the workout, the participant's name, and safety messages back to the band's screen.

## Hardware

| Part | Bus | ESP32 pins |
| --- | --- | --- |
| MPU-6050 or MPU-6500 accelerometer and gyroscope (this band has an MPU-6500) | `Wire` | SDA 21, SCL 19 |
| MAX30102 pulse oximeter | `Wire1` | SDA 23, SCL 22 |
| SSD1306 128x64 OLED | software I2C | SDA 16, SCL 4 |

A 2.42" OLED uses the SSD1309 chip; swap in the commented setup line in the sketch. If a sensor is missing, the band keeps running and reports which one.

To confirm the wiring, upload `firmware/wiring_check/wiring_check.ino` and open Serial Monitor at 115200 baud. It tries every usable pin pair, reports which pins each module actually answers on, and says which `#define` to change if one differs from the table above.

## Flash it

1. Arduino IDE: **Tools > Board > esp32 > ESP32 Dev Module**. The sketch needs the esp32 board package **4.0.0 or newer** (Boards Manager).
2. Library Manager: **SparkFun MAX3010x Pulse and Proximity Sensor Library**, **U8g2**. The motion sensor is read register by register, so MPU-6500 clones (which the Adafruit library rejects) work too.
3. Open `firmware/sunroom_band/sunroom_band.ino` and upload. The program uses about 90% of the default app partition (the Bluetooth stack is large); if later additions overflow it, choose **Tools > Partition Scheme > Huge APP**.

On Linux, flashing and the browser both need serial access: `sudo usermod -aG uucp $USER` (Arch) or `dialout` (Debian/Ubuntu), then log out and back in.

## Connect it to the TV page

Open Sunroom TV in **Chrome or Edge**, then **Demo controls > Wristband > Connect by USB** (pick the ESP32's port) or **Connect by Bluetooth** (pick "Sunroom Band XXXX"). Both work on the GitHub Pages site and on `python designs/launch.py`. On Linux, Chromium browsers switch Web Bluetooth off for pages: open `chrome://flags/#enable-web-bluetooth` (Vivaldi: `vivaldi://flags/#enable-web-bluetooth`), set it to Enabled, and restart the browser. The page explains this if you click **Connect by Bluetooth** without it. USB works without the setting.

If the page says the band dropped right after connecting, **unplug the band's USB cable and plug it back in**. On Linux, flashing tools and serial monitors leave the port in a mode Chrome can't read (`min = 0`); a fresh plug resets it (or run `stty -F /dev/ttyUSB0 min 1`).

While the band is live, the trace under "Band motion sensor" says **live** and the TV uses the band's readings. The demo safety buttons still work on top of real readings, so a presenter can show an oxygen dip. If readings stop for 2.5 seconds, the page falls back to its simulation and says so.

## Protocol

Both links carry the same newline-separated text at 115200 baud (USB) or over the Nordic UART Service (Bluetooth: service `6e400001-…`, the TV writes to `…0002`, the band notifies on `…0003`). Any serial terminal or nRF Connect can watch it.

**Band to TV**, 25 times a second:

```json
{"ax":0.02,"ay":-0.98,"az":0.11,"hr":78,"o2":97,"f":1,"n":12,"c":112.0,"fast":0,"m":"w"}
```

| Key | Meaning |
| --- | --- |
| `ax` `ay` `az` | acceleration in g |
| `hr` | heart rate; `0` = no reading yet |
| `o2` | blood oxygen %; `0` = no reading yet |
| `f` | `1` when a finger is on the pulse sensor |
| `n` | steps, pedal turns or lifts since `START` or `MODE` |
| `c` | pace: steps a minute, turns a minute, or seconds per lift; `0` = none |
| `fast` | `1` while the band's "Slow down" warning is showing (a lift faster than the anti-cheat limit) |
| `m` | workout: `w` walk, `c` cycle, `l` lift |

Events: `{"ev":"hello","fw":…,"name":…,"mpu":1,"ppg":1,"ble":1,"m":"w"}` at boot and in reply to `HELLO`; `{"ev":"mode",…}` after `MODE`; `{"ev":"error","msg":…}`.

**TV to band**, one command per line:

| Command | Band does |
| --- | --- |
| `HELLO` | replies with the hello event |
| `MODE walk` / `cycle` / `lift` | switches the counter and resets the count |
| `START` | resets the count, shows "Let's go!" |
| `STOP` | shows "Well done!" |
| `NAME Margaret` | shows the name on the top line |
| `MSG Rest: low oxygen` | shows a message until an empty `MSG` clears it |
| `PING` | sent every 2 s; the top line shows `USB` or `BT` while the TV is listening |

## How counting works

- **Walk and cycle** (band on the lower leg): the leg swings once per stride or pedal turn. The band follows whichever axis swings most, so it can be worn either way round. A stride counts as two steps.
- **Lift** (band on the wrist): curls and lateral raises turn the forearm. The band remembers the top and bottom of recent lifts, so pauses between lifts are fine, and counts each lift once. The original anti-cheat lives on: turning faster than 300°/s is a swing, not a lift; it isn't counted and the band shows "Slow down". Seconds per lift counts only time the arm is moving. Presses barely turn the forearm, so they are not counted.

All thresholds are named constants at the top of the sketch (`WALK_*`, `CYCLE_*`, `LIFT_*`). They were tuned against simulated motion, not a real band, so check them on the hardware and adjust.

Blood oxygen is a ratio-of-ratios estimate from the red and infrared light, uncalibrated: fine for a demo, not a medical reading. It needs about 8 seconds of steady finger contact.

## Test without the band

```sh
firmware/test/run.sh
```

Builds the real sketch for this computer with stand-ins for the sensors, then walks, cycles, curls (including pauses, quick jerks, and the band worn the other way round), checks the counts, heart rate, oxygen, OLED text and Bluetooth framing, and confirms the TV page understands every line the band prints. Needs `g++`, `node`, and the SparkFun library installed as above. `DEBUG=1` prints each lift as it is counted.
