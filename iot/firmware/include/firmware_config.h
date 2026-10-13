#pragma once

#include <Arduino.h>

namespace config {

constexpr char STATION_ID[] = "niah-station-01";
constexpr char MQTT_TOPIC[] = "niah/telemetry/niah-station-01";

// ESP32 DevKit V1 pin plan. GPIO34/35 are ADC1 pins and remain usable with Wi-Fi.
constexpr uint8_t DHT_PIN = 4;
constexpr uint8_t SOIL_ANALOG_PIN = 34;
constexpr uint8_t PIR_PIN = 27;
constexpr uint8_t ULTRASONIC_TRIG_PIN = 5;
constexpr uint8_t ULTRASONIC_ECHO_PIN = 18;
constexpr uint8_t RAIN_ANALOG_PIN = 35;

constexpr unsigned long SAMPLE_INTERVAL_MS = 10000;
constexpr unsigned long WIFI_RETRY_INTERVAL_MS = 5000;
constexpr unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
constexpr unsigned long CLOCK_RETRY_INTERVAL_MS = 5000;
constexpr unsigned long ULTRASONIC_TIMEOUT_US = 30000;
constexpr time_t MIN_VALID_EPOCH = 1704067200;  // 2024-01-01 UTC

// Calibrate these values with the actual probes before field use.
constexpr int SOIL_DRY_RAW = 3200;
constexpr int SOIL_WET_RAW = 1200;
constexpr int RAIN_DRY_RAW = 4095;
constexpr int RAIN_WET_RAW = 1000;

constexpr size_t TELEMETRY_BUFFER_CAPACITY = 30;
constexpr size_t TELEMETRY_PAYLOAD_CAPACITY = 512;

}  // namespace config
