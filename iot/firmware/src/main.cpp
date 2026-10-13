#include <Arduino.h>
#include <DHT.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

#include "firmware_config.h"
#include "mqtt_root_ca.h"
#include "secrets.h"

namespace {

DHT dht(config::DHT_PIN, DHT11);
WiFiClientSecure tlsClient;
PubSubClient mqttClient(tlsClient);

struct TelemetryMessage {
  char payload[config::TELEMETRY_PAYLOAD_CAPACITY];
};

TelemetryMessage telemetryBuffer[config::TELEMETRY_BUFFER_CAPACITY];
size_t bufferHead = 0;
size_t bufferSize = 0;
uint32_t sequenceNumber = 0;
unsigned long lastSampleAt = 0;
unsigned long lastWifiAttemptAt = 0;
unsigned long lastMqttAttemptAt = 0;
unsigned long lastClockAttemptAt = 0;
bool clockConfigured = false;

int percentageFromRaw(int raw, int dryRaw, int wetRaw) {
  if (dryRaw == wetRaw) return 0;
  const long percentage = map(raw, dryRaw, wetRaw, 0, 100);
  return constrain(static_cast<int>(percentage), 0, 100);
}

float readDistanceCm() {
  digitalWrite(config::ULTRASONIC_TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(config::ULTRASONIC_TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(config::ULTRASONIC_TRIG_PIN, LOW);

  const unsigned long duration = pulseIn(
      config::ULTRASONIC_ECHO_PIN, HIGH, config::ULTRASONIC_TIMEOUT_US);
  if (duration == 0) return -1.0F;
  return duration * 0.0343F / 2.0F;
}

void enqueuePayload(const char* payload) {
  size_t insertionIndex;
  if (bufferSize < config::TELEMETRY_BUFFER_CAPACITY) {
    insertionIndex = (bufferHead + bufferSize) % config::TELEMETRY_BUFFER_CAPACITY;
    ++bufferSize;
  } else {
    // The buffer represents a short interruption. If it fills, discard only
    // the oldest reading so the most recent field state remains available.
    insertionIndex = bufferHead;
    bufferHead = (bufferHead + 1) % config::TELEMETRY_BUFFER_CAPACITY;
  }

  strlcpy(telemetryBuffer[insertionIndex].payload, payload,
          config::TELEMETRY_PAYLOAD_CAPACITY);
}

bool publishPayload(const char* payload) {
  if (!mqttClient.connected()) return false;
  return mqttClient.publish(config::MQTT_TOPIC, payload, false);
}

void flushBufferedTelemetry() {
  while (mqttClient.connected() && bufferSize > 0) {
    if (!publishPayload(telemetryBuffer[bufferHead].payload)) return;
    bufferHead = (bufferHead + 1) % config::TELEMETRY_BUFFER_CAPACITY;
    --bufferSize;
  }
}

void connectWifiIfNeeded() {
  if (WiFi.status() == WL_CONNECTED) return;

  const unsigned long now = millis();
  if (now - lastWifiAttemptAt < config::WIFI_RETRY_INTERVAL_MS) return;
  lastWifiAttemptAt = now;

  Serial.println("Connecting to Wi-Fi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

bool ensureClockReady() {
  if (time(nullptr) >= config::MIN_VALID_EPOCH) return true;

  const unsigned long now = millis();
  if (!clockConfigured || now - lastClockAttemptAt >= config::CLOCK_RETRY_INTERVAL_MS) {
    lastClockAttemptAt = now;
    clockConfigured = true;
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    Serial.println("Synchronizing clock for TLS certificate validation...");
  }
  return false;
}

void connectMqttIfNeeded() {
  if (WiFi.status() != WL_CONNECTED || mqttClient.connected()) return;
  if (!ensureClockReady()) return;

  const unsigned long now = millis();
  if (now - lastMqttAttemptAt < config::MQTT_RETRY_INTERVAL_MS) return;
  lastMqttAttemptAt = now;

  String clientId = String("niah-") + config::STATION_ID + "-" +
                    String(static_cast<uint32_t>(ESP.getEfuseMac()), HEX);

  const bool connected = strlen(MQTT_USERNAME) == 0
      ? mqttClient.connect(clientId.c_str())
      : mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD);

  Serial.println(connected ? "MQTT connected" : "MQTT connection failed");
}

void sampleAndQueueTelemetry() {
  const float humidity = dht.readHumidity();
  const float temperature = dht.readTemperature();
  const int soilRaw = analogRead(config::SOIL_ANALOG_PIN);
  const int rainRaw = analogRead(config::RAIN_ANALOG_PIN);
  const bool motionDetected = digitalRead(config::PIR_PIN) == HIGH;
  const float distanceCm = readDistanceCm();

  const bool dhtValid = !isnan(humidity) && !isnan(temperature);
  const bool distanceValid = distanceCm >= 0.0F;
  const int soilPercent = percentageFromRaw(
      soilRaw, config::SOIL_DRY_RAW, config::SOIL_WET_RAW);
  const int rainPercent = percentageFromRaw(
      rainRaw, config::RAIN_DRY_RAW, config::RAIN_WET_RAW);

  char payload[config::TELEMETRY_PAYLOAD_CAPACITY];
  const int written = snprintf(
      payload, sizeof(payload),
      "{\"schema_version\":1,\"station_id\":\"%s\",\"sequence\":%lu,"
      "\"uptime_ms\":%lu,\"temperature_c\":%.1f,\"humidity_pct\":%.1f,"
      "\"dht_valid\":%s,\"soil_raw\":%d,\"soil_moisture_pct\":%d,"
      "\"motion_detected\":%s,\"distance_cm\":%.1f,\"distance_valid\":%s,"
      "\"rain_raw\":%d,\"rain_intensity_pct\":%d}",
      config::STATION_ID, static_cast<unsigned long>(sequenceNumber++),
      millis(), dhtValid ? temperature : 0.0F, dhtValid ? humidity : 0.0F,
      dhtValid ? "true" : "false", soilRaw, soilPercent,
      motionDetected ? "true" : "false", distanceValid ? distanceCm : 0.0F,
      distanceValid ? "true" : "false", rainRaw, rainPercent);

  if (written <= 0 || static_cast<size_t>(written) >= sizeof(payload)) {
    Serial.println("Telemetry payload exceeded its fixed buffer");
    return;
  }

  enqueuePayload(payload);
  Serial.println(payload);
}

}  // namespace

void setup() {
  Serial.begin(115200);

  pinMode(config::PIR_PIN, INPUT);
  pinMode(config::ULTRASONIC_TRIG_PIN, OUTPUT);
  pinMode(config::ULTRASONIC_ECHO_PIN, INPUT);
  pinMode(config::SOIL_ANALOG_PIN, INPUT);
  pinMode(config::RAIN_ANALOG_PIN, INPUT);
  digitalWrite(config::ULTRASONIC_TRIG_PIN, LOW);

  analogReadResolution(12);
  dht.begin();
  tlsClient.setCACert(MQTT_ROOT_CA);
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setBufferSize(768);

  connectWifiIfNeeded();
}

void loop() {
  connectWifiIfNeeded();
  connectMqttIfNeeded();

  if (mqttClient.connected()) {
    mqttClient.loop();
    flushBufferedTelemetry();
  }

  const unsigned long now = millis();
  if (now - lastSampleAt >= config::SAMPLE_INTERVAL_MS) {
    lastSampleAt = now;
    sampleAndQueueTelemetry();
    flushBufferedTelemetry();
  }

  delay(10);
}
