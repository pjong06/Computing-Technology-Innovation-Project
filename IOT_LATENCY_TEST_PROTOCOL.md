
# IoT Alert Latency Testing Protocol

## 1. Objective

This test evaluates how quickly the Niah BioTrack system generates an alert after an ESP32 sensor detects an event.

The proposed performance target is 3 seconds (3000 ms) or less per trial. This target must be confirmed against the project's acceptance criteria.

At least 10 real hardware trials will be conducted.

## 2. System Components

- ESP32 sensor station
- MQTT broker
- Node.js backend
- IoT telemetry processing service
- IoT threat detection and alert service
- Supabase / Render services, where enabled

## 3. Measurement Definition

End-to-end alert latency is defined as:

Latency (ms) = Alert generation time - Sensor event time

Two timestamps are required:

- T1: Time at which the ESP32 detects the sensor event.
- T2: Time at which the backend creates or updates the matching alert.

The ESP32 and backend clocks must be synchronized before subtracting timestamps. Alternatively, a validated measurement method using a common clock must be used.

Backend processing duration may be recorded separately, but it must not be presented as full ESP32-to-alert latency.

## 4. Existing Implementation Findings

The current MQTT service receives telemetry, performs optional persistence, and then calls ingestTelemetry().

The ingestTelemetry() function validates telemetry and invokes processTelemetryForAlerts().

The alert service stores first_detected_at and last_detected_at. These timestamps are derived from the reading's received_at value and do not independently identify the completion time of alert processing.

The current sensor payload contains a station_id and sequence number that can be used to match an ESP32 event with the corresponding backend reading.

The HTTP persistence endpoint records server-generated timestamps. These must not be mistaken for the original ESP32 event timestamp.

## 5. Preconditions

Before testing:

1. Confirm the ESP32 firmware and sensors are functioning.
2. Confirm Wi-Fi and MQTT broker connectivity.
3. Confirm the backend is subscribed to the correct MQTT topic.
4. Confirm the backend can receive and process telemetry.
5. Confirm the selected alert threshold and triggering conditions.
6. Confirm a reliable timing method and timestamp synchronization.
7. Ensure that each trial can be matched using station_id and sequence.
8. Confirm whether the test measures backend alert creation or dashboard visibility.
9. Record whether telemetry persistence is enabled.

## 6. Testing Procedure

1. Start the ESP32, MQTT broker, and backend.
2. Verify that ordinary telemetry is received successfully.
3. Establish a baseline condition where the selected alert is inactive.
4. Trigger a real sensor event that crosses the alert threshold.
5. Record the ESP32 event timestamp (T1), station_id, and sequence.
6. Identify the corresponding MQTT message and backend reading.
7. Record the independent timestamp when the matching alert is created (T2).
8. Calculate latency as T2 - T1.
9. Save the relevant logs or screenshots as evidence.
10. Return the sensor to its normal state.
11. Confirm that the previous alert has resolved before starting another trial.
12. Repeat until at least 10 valid measurements have been collected.

Any incomplete or invalid trial should be documented separately rather than silently discarded.

## 7. Results Table

| Trial | Station ID | Sequence | Event Time T1 | Alert Time T2 | Latency (ms) | Result |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |
| 6 | | | | | | |
| 7 | | | | | | |
| 8 | | | | | | |
| 9 | | | | | | |
| 10 | | | | | | |

Result: Pass if latency is 3000 ms or less; otherwise Fail, subject to confirmation of the acceptance criteria.

## 8. Analysis

After collecting the measurements, calculate:

- Minimum latency
- Maximum latency
- Average latency
- Number and percentage of trials meeting the target

Average Latency = Sum of Valid Latencies / Number of Valid Trials

Pass Rate (%) = (Passing Trials / Valid Trials) x 100

Document environmental factors that may affect latency, including network instability, MQTT reconnection, persistence delays, and backend startup or cold starts.

Do not use fabricated, simulated, or estimated measurements as actual hardware test results.

## 9. Required Evidence

Collect and retain:

- ESP32 serial monitor output showing the sensor event.
- ESP32 event timestamp and sequence number.
- MQTT message or corresponding ingestion evidence.
- Backend log showing the matching alert generation time.
- Screenshot of the alert where relevant.
- Completed results table containing at least 10 real trials.
- Calculations and a short conclusion.

Any screenshots must clearly identify the same trial or matching sequence number.

## 10. Team Responsibilities

### Gerald

- Prepare the testing protocol and results table.
- Inspect backend telemetry and alert processing.
- Assist in recording and validating trial measurements.
- Calculate performance statistics.
- Prepare the testing evidence and report.

### Steven

- Provide the ESP32 hardware and working firmware.
- Confirm sensor triggering and MQTT transmission.
- Help establish reliable ESP32 event timestamps.
- Assist with the 10 physical trials.
- Coordinate any required MQTT or firmware changes.

### Phoebe

- Coordinate access to the deployed backend and configuration.
- Confirm the applicable alert performance target.
- Assist with live deployment verification where necessary.

## 11. Completion Criteria

Task 5 can be considered completed when:

- The measurement method is validated.
- At least 10 real hardware trials have been performed.
- Sensor events are correctly matched to backend alerts.
- The latency statistics are calculated.
- Evidence and findings are documented.
- The system's performance is evaluated against the confirmed target.

## 12. Current Status

Protocol prepared.

Hardware trials: Pending coordination with Steven.

Actual latency measurements: Not yet collected.

Performance conclusion: Pending actual test results.
