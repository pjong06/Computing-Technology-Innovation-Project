# Sprint 1 IoT verification evidence

Test date: 13 October 2026 (Asia/Kuala_Lumpur)

## Environment

- Board: classic ESP32/ESP32S 30-pin development board
- Arduino target: ESP32 Dev Module
- Station ID: `niah-station-01`
- MQTT topic: `niah/telemetry/niah-station-01`
- Broker transport: MQTT over TLS, port 8883
- Backend subscription: `niah/telemetry/+`
- Sampling interval: 10 seconds
- ESP32 FIFO capacity: 30 messages (about five minutes)

Credentials are intentionally excluded from this evidence file.

## Build and upload verification

- Firmware compiled successfully with Arduino ESP32 core 2.0.17.
- Program storage: 888,885 bytes (67%).
- Dynamic memory: 61,640 bytes (18%).
- Upload completed, flash hash verification passed, and the ESP32 rebooted from flash.
- Serial output confirmed Wi-Fi connection, NTP synchronization, TLS certificate validation, and `MQTT connected`.

## End-to-end ingestion verification

The backend connected using its ignored local `.env`, subscribed successfully,
and continuously received `niah-station-01` messages through EMQX. Backend logs
include ISO 8601 receipt time and payload sequence number.

## Short-interruption buffer verification

Before the Wi-Fi interruption, the last received sequence was 429. During the
interruption the ESP32 remained powered. After reconnection, the backend logged:

```text
2026-10-13T03:27:22.708Z sequence=430
2026-10-13T03:27:22.709Z sequence=431
2026-10-13T03:27:22.709Z sequence=432
2026-10-13T03:27:22.709Z sequence=433
2026-10-13T03:27:22.709Z sequence=434
2026-10-13T03:27:26.927Z sequence=435
2026-10-13T03:27:26.928Z sequence=436
2026-10-13T03:27:26.928Z sequence=437
2026-10-13T03:27:26.928Z sequence=438
2026-10-13T03:27:27.068Z sequence=439
2026-10-13T03:27:27.068Z sequence=440
2026-10-13T03:27:27.068Z sequence=441
2026-10-13T03:27:27.069Z sequence=442
2026-10-13T03:27:33.257Z sequence=443
```

Sequences 430–442 were consecutive and arrived in rapid batches, whereas normal
sampling produces one message every 10 seconds. This verifies that the ESP32
retained readings in its RAM FIFO and replayed them oldest-first after MQTT
reconnection. The split batches are consistent with a temporary publish failure
or connection stabilization: unsent entries remained queued for the next flush.
Sequence 443 is consistent with the next live reading after replay.

## Observed limitation

A later, separate backend-to-broker reset produced sequence 443 followed by 445;
sequence 444 was not received. This does not invalidate the verified ESP32 FIFO:
it demonstrates that MQTT QoS 0 does not retain a message for an offline backend
subscriber after the broker has accepted it from the publisher.

## Physical sensor verification boundary

The five sensor modules were not connected during this software/network test.
Consequently, `dht_valid=false`, `distance_valid=false`, and uncalibrated analog
values are expected and are not evidence of real environmental measurements.
Activity 5.2 still requires wiring, HC-SR04 Echo voltage reduction, calibration,
and real sensor-response tests.
