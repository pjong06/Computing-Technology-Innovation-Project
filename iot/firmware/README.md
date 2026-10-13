# Niah BioTrack ESP32 telemetry firmware (Sprint 1: 5.2 and 5.3)

This firmware targets an **ESP32 DevKit V1** and the components confirmed by Steven:

- DHT11 temperature/humidity sensor
- YL-69 probe with LM393 soil-moisture board
- HC-SR501 PIR motion sensor
- HC-SR04 ultrasonic distance sensor
- Common LM393 rain-sensor module with analog output

## Pin plan

| Component | Module pin | ESP32 pin | Important note |
|---|---|---|---|
| DHT11 | DATA | GPIO 4 | A bare four-pin DHT11 needs a pull-up resistor. |
| Soil LM393 | AO | GPIO 34 | ADC1 is used because ADC2 conflicts with Wi-Fi. |
| HC-SR501 | OUT | GPIO 27 | Digital motion signal. |
| HC-SR04 | TRIG | GPIO 5 | ESP32 output to sensor. |
| HC-SR04 | ECHO | GPIO 18 | **Use a voltage divider/level shifter; do not send 5 V directly to ESP32.** |
| Rain LM393 | AO | GPIO 35 | ADC1 analog reading. |
| All modules | GND | ESP32 GND | All devices must share ground. |

The exact VCC wiring must be checked against each physical module. The HC-SR04 normally requires 5 V. Keep every ESP32 GPIO signal at or below 3.3 V.

## Configure and build

1. Copy `include/secrets.example.h` to `include/secrets.h`.
2. Enter the Wi-Fi and MQTT broker settings in `secrets.h`.
3. Build/upload with PlatformIO using the `esp32dev` environment, or install the same libraries in Arduino IDE.
4. Open Serial Monitor at 115200 baud.

The firmware samples every 10 seconds and publishes to `niah/telemetry/niah-station-01`.
It connects to EMQX Serverless through MQTT over TLS on port 8883, validates
the broker certificate against DigiCert Global Root G2, and synchronizes the
ESP32 clock with NTP before starting the TLS session.

## Short-interruption buffering

The firmware keeps up to 30 JSON readings in a RAM FIFO (about five minutes at the default interval). When MQTT reconnects, readings are sent oldest first. If the buffer becomes full, the oldest reading is replaced. A restart or power loss clears this RAM buffer; persistent offline storage is outside the stated short-interruption scope.

The real-board interruption test on 13 October 2026 verified ordered replay:
sequences 430–442, generated while connectivity was unavailable, arrived at the
backend in rapid consecutive batches after reconnection. See `../TEST-EVIDENCE.md`.

Messages currently use MQTT QoS 0. The ESP32 FIFO protects readings while the
ESP32 itself cannot publish, but it does not guarantee delivery when the broker
accepts a message while the backend subscriber is offline. QoS 1/persistent
sessions or application acknowledgements are a future reliability enhancement.

## Calibration required

`SOIL_DRY_RAW`, `SOIL_WET_RAW`, `RAIN_DRY_RAW`, and `RAIN_WET_RAW` in `firmware_config.h` are initial placeholders. Record real dry/wet values and replace them before presenting percentages as measured results.

This code can be developed before activity 5.1, but activity 5.2 is not physically verified until the real wiring and sensors are tested.
