# Sprint 1 IoT work: activities 5.2 and 5.3

## Completion status

### 5.2 Develop sensor firmware

`firmware/` contains ESP32 Arduino firmware for the confirmed component set:

- DHT11
- YL-69 + LM393 soil-moisture sensor
- HC-SR501 PIR motion sensor
- HC-SR04 ultrasonic sensor
- LM393 analog rain sensor

The firmware reads all sensors, validates timeout/error conditions, converts calibrated analog values to percentages, and outputs a versioned JSON telemetry payload. It has been compiled and uploaded to a classic 30-pin ESP32/ESP32S development board. Wi-Fi, NTP time synchronization, certificate-validated MQTT over TLS, and telemetry publication have been verified on the real board.

The sensor-reading code is complete, but activity 5.2 remains **partially physically verified** until the five sensor modules are wired, calibrated, and tested. Unconnected sensor values must not be presented as measured results.

### 5.3 MQTT telemetry ingestion and short-interruption buffering

- ESP32 publishes JSON to `niah/telemetry/<station-id>`.
- A 30-message RAM FIFO retains readings during a short Wi-Fi/MQTT interruption and flushes oldest-first after reconnection.
- `backend/src/services/mqttIngestionService.js` subscribes to `niah/telemetry/+`.
- `backend/src/services/iotTelemetryService.js` validates readings and provides in-memory latest/history data to the officer-only IoT API.
- `/api/iot/readings`, `/api/iot/latest`, and `/api/iot/summary` now use ingested data rather than hard-coded demo stations.
- EMQX Serverless is configured through MQTT over TLS on port 8883 with broker-certificate validation enabled.
- End-to-end delivery from the real ESP32 through EMQX to the backend has been verified.
- A real Wi-Fi interruption test verified FIFO buffering and ordered replay. Sequences 430–442 were received in order and in rapid batches after reconnection. See `TEST-EVIDENCE.md`.

Activity 5.3 is complete for the Sprint 1 scope of MQTT ingestion and short-interruption buffering.

## Remaining work outside the verified 5.3 scope

- Assemble the circuit, include an HC-SR04 Echo voltage divider, then calibrate soil/rain raw values.
- Test each physical sensor and record measured results for activity 5.2.
- Confirm the exact rain-sensor module before finalizing its VCC wiring and calibration.
- Create/confirm a final Supabase telemetry table before replacing the current in-memory backend history. This is a later persistence/dashboard concern, not required to prove the current short-interruption buffer.
- Consider QoS 1 with a persistent session or application acknowledgements if later requirements demand protection while the backend subscriber itself is offline. The current QoS 0 prototype can lose a message in that separate condition; sequence 444 demonstrated this limitation.

Secrets remain local in ignored `.env` and `secrets.h` files and must never be committed.
