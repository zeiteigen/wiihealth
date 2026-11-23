#!/bin/sh
# Runs the band firmware on this computer against simulated walking, cycling,
# curls and pulse (no ESP32 needed), then checks that every line it prints is
# understood by the TV page. Needs g++, node, and the SparkFun MAX3010x library
# installed through the Arduino IDE Library Manager.
set -e
cd "$(dirname "$0")"
LIB="${MAX3010X_SRC:-$HOME/Arduino/libraries/SparkFun_MAX3010x_Pulse_and_Proximity_Sensor_Library/src}"
OUT="$(mktemp -d)"
g++ -std=c++17 -O1 -Wall -Wno-unused-variable -DARDUINO=100 -Istubs -I"$LIB" -x c++ harness.cpp "$LIB/heartRate.cpp" -o "$OUT/band"
"$OUT/band" "$OUT/serial.log"
node --input-type=module -e "
import {readFileSync} from 'node:fs';
import {createLineSplitter, parseBandLine} from '../../designs/14-tv-tenfoot/band.js';
let ok = 0, bad = 0;
createLineSplitter(line => parseBandLine(line) ? ok++ : bad++)(readFileSync('$OUT/serial.log', 'utf8'));
console.log((bad ? 'FAIL' : 'ok  ') + ' TV page parsed ' + ok + ' band lines, rejected ' + bad);
process.exit(bad ? 1 : 0);
"
rm -rf "$OUT"
