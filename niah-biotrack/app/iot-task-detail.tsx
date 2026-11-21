import React from 'react';

import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  Ionicons,
} from '@expo/vector-icons';

import {
  useLocalSearchParams,
  useRouter,
} from 'expo-router';

import {
  ApiError,
  apiFetch,
} from '../src/api/client';

import {
  useIotTaskStore,
} from '../src/store/useIotTaskStore';

interface TaskLocation {
  station_id: string;
  station_code: string;
  latitude: number | null;
  longitude: number | null;
  location_note: string | null;
}

interface LocationResponse {
  data: TaskLocation | null;
}

interface CameraEvidence {
  id: string;
  alert_id: string;
  captured_at: string;
  byte_count: number;
  sha256: string;
}

interface EvidenceResponse {
  data: CameraEvidence[];
}

interface EvidenceUrlResponse {
  url: string;
  expires_in: number;
}

const SEVERITY_COLOURS:
  Record<
    string,
    {
      background: string;
      text: string;
    }
  > = {
    critical: {
      background: '#FDE2E2',
      text: '#9B1C1C',
    },
    high: {
      background: '#FDE8E7',
      text: '#8B2E2B',
    },
    warning: {
      background: '#FDF4D8',
      text: '#8C5E03',
    },
  };

function taskTitle(
  message: string
): string {
  const normalized =
    message.toLowerCase();

  if (
    normalized.includes(
      'movement_nearby_cm'
    ) ||
    normalized.includes(
      'camera movement'
    )
  ) {
    return 'Movement detected near station';
  }

  if (
    normalized.includes(
      'soil_moisture'
    )
  ) {
    return 'Low soil moisture';
  }

  if (
    normalized.includes(
      'rain_intensity'
    )
  ) {
    return 'Heavy rain detected';
  }

  if (
    normalized.includes(
      'temperature'
    )
  ) {
    return normalized.includes('low')
      ? 'Low temperature'
      : 'High temperature';
  }

  if (
    normalized.includes(
      'humidity'
    )
  ) {
    return 'Humidity alert';
  }

  return message;
}

function dateTime(
  value: string | null
): string {
  if (!value) {
    return 'Not recorded';
  }

  const date =
    new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? value
    : date.toLocaleString();
}

function errorMessage(
  error: unknown
): string {
  if (
    error instanceof ApiError
  ) {
    if (error.status === 0) {
      return (
        'Could not reach the server. ' +
        'The task is still saved on this phone. ' +
        'Reconnect to the Internet before resolving it.'
      );
    }

    if (error.status === 409) {
      return (
        'This task changed on the server. ' +
        'Refresh your assigned tasks and try again.'
      );
    }

    if (
      error.status === 404
    ) {
      return (
        'This task is no longer available. ' +
        'It may already have been resolved or reassigned.'
      );
    }

    return error.message;
  }

  return error instanceof Error
    ? error.message
    : 'Something went wrong.';
}

export default function IotTaskDetailScreen() {
  const router = useRouter();

  const {
    id,
  } =
    useLocalSearchParams<{
      id?: string;
    }>();

  const tasks =
    useIotTaskStore(
      (state) => state.tasks
    );

  const stations =
    useIotTaskStore(
      (state) => state.stations
    );

  const hydrated =
    useIotTaskStore(
      (state) => state.hydrated
    );

  const hydrateTasks =
    useIotTaskStore(
      (state) =>
        state.hydrateTasks
    );

  const resolveTask =
    useIotTaskStore(
      (state) =>
        state.resolveTask
    );

  const task =
    tasks.find(
      (item) =>
        item.id === id
    );

  const [
    resolutionNotes,
    setResolutionNotes,
  ] = React.useState('');

  const [
    resolving,
    setResolving,
  ] = React.useState(false);

  const [
    location,
    setLocation,
  ] =
    React.useState<TaskLocation | null>(
      null
    );

  const [
    locationLoading,
    setLocationLoading,
  ] = React.useState(false);

  const [
    locationError,
    setLocationError,
  ] =
    React.useState<string | null>(
      null
    );

  const [
    evidence,
    setEvidence,
  ] =
    React.useState<CameraEvidence | null>(
      null
    );

  const [
    evidenceUrl,
    setEvidenceUrl,
  ] =
    React.useState<string | null>(
      null
    );

  const [
    evidenceLoading,
    setEvidenceLoading,
  ] = React.useState(false);

  const [
    evidenceError,
    setEvidenceError,
  ] =
    React.useState<string | null>(
      null
    );

  React.useEffect(() => {
    if (!hydrated) {
      void hydrateTasks();
    }
  }, [
    hydrateTasks,
    hydrated,
  ]);

  const loadLocation =
    React.useCallback(
      async () => {
        if (!id) {
          return;
        }

        setLocationLoading(true);
        setLocationError(null);

        try {
          const result =
            await apiFetch<LocationResponse>(
              `/api/iot-workspace/alerts/${id}/location`
            );

          setLocation(
            result.data
          );
        } catch (error) {
          setLocationError(
            errorMessage(error)
          );
        } finally {
          setLocationLoading(false);
        }
      },
      [id]
    );

  const loadEvidence =
    React.useCallback(
      async () => {
        if (!id) {
          return;
        }

        setEvidenceLoading(true);
        setEvidenceError(null);
        setEvidence(null);
        setEvidenceUrl(null);

        try {
          const result =
            await apiFetch<EvidenceResponse>(
              `/api/iot-workspace/alerts/${id}/evidence`
            );

          const latest =
            result.data?.[0] ??
            null;

          setEvidence(latest);

          if (!latest) {
            return;
          }

          const link =
            await apiFetch<EvidenceUrlResponse>(
              `/api/iot-workspace/alerts/${id}/evidence/${latest.id}/url`
            );

          setEvidenceUrl(
            link.url
          );
        } catch (error) {
          setEvidenceError(
            errorMessage(error)
          );
        } finally {
          setEvidenceLoading(false);
        }
      },
      [id]
    );

  React.useEffect(() => {
    if (!task) {
      return;
    }

    void loadLocation();
    void loadEvidence();
  }, [
    task?.id,
    loadLocation,
    loadEvidence,
  ]);

  if (
    !hydrated &&
    !task
  ) {
    return (
      <SafeAreaView
        style={
          styles.safeArea
        }
      >
        <View
          style={
            styles.center
          }
        >
          <ActivityIndicator
            size="large"
            color="#213B2A"
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!task) {
    return (
      <SafeAreaView
        style={
          styles.safeArea
        }
      >
        <View
          style={styles.header}
        >
          <TouchableOpacity
            onPress={() =>
              router.back()
            }
            style={
              styles.backButton
            }
          >
            <Ionicons
              name="arrow-back"
              size={22}
              color="#213B2A"
            />
          </TouchableOpacity>

          <Text
            style={
              styles.headerTitle
            }
          >
            Task
          </Text>
        </View>

        <View
          style={
            styles.center
          }
        >
          <Ionicons
            name="checkmark-circle-outline"
            size={52}
            color="#7FA38B"
          />

          <Text
            style={
              styles.missingTitle
            }
          >
            Task no longer active
          </Text>

          <Text
            style={
              styles.missingText
            }
          >
            It may already have
            been resolved or
            reassigned.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const stationName =
    stations.find(
      (station) =>
        station.id ===
        task.station_id
    )?.station_code ??
    location?.station_code ??
    `Station ${task.station_id.slice(
      0,
      8
    )}`;

  const severity =
    SEVERITY_COLOURS[
      task.severity
    ] ?? {
      background:
        '#E8EEE9',
      text: '#435348',
    };

  const coordinates =
    location?.latitude !==
      null &&
    location?.latitude !==
      undefined &&
    location?.longitude !==
      null &&
    location?.longitude !==
      undefined
      ? `${location.latitude.toFixed(
          6
        )}, ${location.longitude.toFixed(
          6
        )}`
      : null;

  const handleResolve =
    async () => {
      const notes =
        resolutionNotes.trim();

      if (!notes) {
        Alert.alert(
          'Resolution notes required',
          'Describe what you found before resolving this task.'
        );

        return;
      }

      Alert.alert(
        'Resolve this task?',
        'The Conservation Officer will see this alert as resolved.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Resolve',
            onPress: async () => {
              setResolving(true);

              try {
                await resolveTask(
                  task.id,
                  notes
                );

                router.replace(
                  '/(tabs)/tasks' as any
                );

                setTimeout(() => {
                  Alert.alert(
                    'Task resolved',
                    'The alert has been marked as resolved. The Officer workspace will show the updated status.'
                  );
                }, 250);
              } catch (error) {
                Alert.alert(
                  'Could not resolve task',
                  errorMessage(error)
                );
              } finally {
                setResolving(false);
              }
            },
          },
        ]
      );
    };

  return (
    <SafeAreaView
      style={styles.safeArea}
    >
      <View
        style={styles.header}
      >
        <TouchableOpacity
          onPress={() =>
            router.back()
          }
          style={
            styles.backButton
          }
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color="#213B2A"
          />
        </TouchableOpacity>

        <Text
          style={
            styles.headerTitle
          }
        >
          Assigned task
        </Text>

        <View
          style={
            styles.headerSpacer
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={
          styles.content
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={
          false
        }
      >
        <View
          style={
            styles.titleCard
          }
        >
          <View
            style={
              styles.titleTop
            }
          >
            <Ionicons
              name="warning-outline"
              size={28}
              color="#213B2A"
            />

            <View
              style={
                styles.titleTextBox
              }
            >
              <Text
                style={
                  styles.title
                }
              >
                {taskTitle(
                  task.alert_message
                )}
              </Text>

              <Text
                style={
                  styles.rawMetric
                }
              >
                {task.alert_message}
              </Text>
            </View>

            <View
              style={[
                styles.badge,
                {
                  backgroundColor:
                    severity.background,
                },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  {
                    color:
                      severity.text,
                  },
                ]}
              >
                {task.severity
                  .charAt(0)
                  .toUpperCase() +
                  task.severity.slice(
                    1
                  )}
              </Text>
            </View>
          </View>

          <View
            style={
              styles.assignedBadge
            }
          >
            <Text
              style={
                styles.assignedText
              }
            >
              Assigned by Conservation
              Officer
            </Text>
          </View>
        </View>

        <Text
          style={
            styles.sectionHeading
          }
        >
          TASK DETAILS
        </Text>

        <View
          style={
            styles.card
          }
        >
          <DetailRow
            label="Station"
            value={stationName}
          />

          <DetailRow
            label="Triggered"
            value={dateTime(
              task.triggered_at
            )}
          />

          <DetailRow
            label="Assigned"
            value={dateTime(
              task.assigned_at
            )}
          />

          {task.reading_id ? (
            <DetailRow
              label="Reading ID"
              value={
                task.reading_id
              }
            />
          ) : null}
        </View>

        {task.assignment_notes ? (
          <>
            <Text
              style={
                styles.sectionHeading
              }
            >
              OFFICER INSTRUCTION
            </Text>

            <View
              style={
                styles.instructionCard
              }
            >
              <Ionicons
                name="clipboard-outline"
                size={20}
                color="#2F6844"
              />

              <Text
                style={
                  styles.instructionText
                }
              >
                {
                  task.assignment_notes
                }
              </Text>
            </View>
          </>
        ) : null}

        <Text
          style={
            styles.sectionHeading
          }
        >
          LOCATION
        </Text>

        <View
          style={
            styles.card
          }
        >
          {locationLoading ? (
            <View
              style={
                styles.loadingRow
              }
            >
              <ActivityIndicator
                size="small"
                color="#213B2A"
              />

              <Text
                style={
                  styles.loadingText
                }
              >
                Loading location…
              </Text>
            </View>
          ) : location ? (
            <>
              <DetailRow
                label="Station"
                value={
                  location.station_code
                }
              />

              <DetailRow
                label="Coordinates"
                value={
                  coordinates ??
                  'Not recorded'
                }
              />

              {location.location_note ? (
                <View
                  style={
                    styles.longRow
                  }
                >
                  <Text
                    style={
                      styles.detailLabel
                    }
                  >
                    Location note
                  </Text>

                  <Text
                    style={
                      styles.longValue
                    }
                  >
                    {
                      location.location_note
                    }
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <View
              style={
                styles.messageRow
              }
            >
              <Ionicons
                name={
                  locationError
                    ? 'cloud-offline-outline'
                    : 'location-outline'
                }
                size={20}
                color="#68776D"
              />

              <Text
                style={
                  styles.messageText
                }
              >
                {locationError ??
                  'No station location recorded.'}
              </Text>
            </View>
          )}
        </View>

        <Text
          style={
            styles.sectionHeading
          }
        >
          CAMERA EVIDENCE
        </Text>

        <View
          style={
            styles.photoCard
          }
        >
          {evidenceLoading ? (
            <View
              style={
                styles.photoLoading
              }
            >
              <ActivityIndicator
                size="large"
                color="#213B2A"
              />

              <Text
                style={
                  styles.loadingText
                }
              >
                Loading camera
                evidence…
              </Text>
            </View>
          ) : evidence &&
            evidenceUrl ? (
            <>
              <Image
                source={{
                  uri: evidenceUrl,
                }}
                style={
                  styles.photo
                }
                resizeMode="cover"
              />

              <View
                style={
                  styles.photoMeta
                }
              >
                <Text
                  style={
                    styles.photoMetaText
                  }
                >
                  Captured{' '}
                  {dateTime(
                    evidence.captured_at
                  )}
                </Text>

                <TouchableOpacity
                  onPress={() =>
                    void loadEvidence()
                  }
                >
                  <Text
                    style={
                      styles.refreshPhoto
                    }
                  >
                    Refresh photo
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View
              style={
                styles.photoEmpty
              }
            >
              <Ionicons
                name="camera-outline"
                size={36}
                color="#7A8A80"
              />

              <Text
                style={
                  styles.photoEmptyTitle
                }
              >
                No camera evidence
              </Text>

              <Text
                style={
                  styles.photoEmptyText
                }
              >
                {evidenceError ??
                  'No photo is linked to this alert.'}
              </Text>

              <TouchableOpacity
                style={
                  styles.retryButton
                }
                onPress={() =>
                  void loadEvidence()
                }
              >
                <Text
                  style={
                    styles.retryButtonText
                  }
                >
                  Refresh
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text
          style={
            styles.sectionHeading
          }
        >
          RESOLUTION
        </Text>

        <View
          style={
            styles.resolveCard
          }
        >
          <Text
            style={
              styles.resolveHelp
            }
          >
            After inspecting the
            site, describe what you
            found and the action
            taken.
          </Text>

          <TextInput
            value={
              resolutionNotes
            }
            onChangeText={
              setResolutionNotes
            }
            placeholder="Example: Animal movement confirmed. No damage to the protected plant."
            placeholderTextColor="#98A69D"
            multiline
            maxLength={2000}
            textAlignVertical="top"
            style={
              styles.textInput
            }
          />

          <Text
            style={
              styles.characterCount
            }
          >
            {
              resolutionNotes.length
            }
            /2000
          </Text>

          <TouchableOpacity
            style={[
              styles.resolveButton,
              (resolving ||
                !resolutionNotes.trim()) &&
                styles.resolveButtonDisabled,
            ]}
            disabled={
              resolving ||
              !resolutionNotes.trim()
            }
            onPress={() =>
              void handleResolve()
            }
            accessibilityRole="button"
          >
            {resolving ? (
              <ActivityIndicator
                size="small"
                color="#FFFFFF"
              />
            ) : (
              <>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={20}
                  color="#FFFFFF"
                />

                <Text
                  style={
                    styles.resolveButtonText
                  }
                >
                  Resolve Task
                </Text>
              </>
            )}
          </TouchableOpacity>

          <View
            style={
              styles.onlineNotice
            }
          >
            <Ionicons
              name="cloud-outline"
              size={17}
              color="#68776D"
            />

            <Text
              style={
                styles.onlineNoticeText
              }
            >
              Resolving a task
              requires an Internet
              connection. The task
              remains saved on this
              phone if submission
              fails.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View
      style={
        styles.detailRow
      }
    >
      <Text
        style={
          styles.detailLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.detailValue
        }
      >
        {value}
      </Text>
    </View>
  );
}

const styles =
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor:
        '#F6F8F6',
      paddingTop:
        Platform.OS ===
        'android'
          ? StatusBar.currentHeight
          : 0,
    },

    header: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      borderBottomWidth:
        StyleSheet.hairlineWidth,
      borderBottomColor:
        '#DFE7E1',
      backgroundColor:
        '#F6F8F6',
    },

    backButton: {
      width: 42,
      height: 42,
      alignItems: 'center',
      justifyContent:
        'center',
      borderRadius: 21,
    },

    headerTitle: {
      flex: 1,
      textAlign: 'center',
      color: '#213B2A',
      fontSize: 17,
      fontWeight: '800',
    },

    headerSpacer: {
      width: 42,
    },

    content: {
      padding: 20,
      paddingBottom: 48,
    },

    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent:
        'center',
      padding: 28,
    },

    missingTitle: {
      marginTop: 14,
      color: '#213B2A',
      fontSize: 20,
      fontWeight: '800',
    },

    missingText: {
      marginTop: 7,
      color: '#68776D',
      fontSize: 13,
      textAlign: 'center',
      lineHeight: 19,
    },

    titleCard: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 20,
      borderWidth: 1,
      borderColor:
        '#DFE7E1',
      padding: 17,
    },

    titleTop: {
      flexDirection: 'row',
      alignItems:
        'flex-start',
      gap: 10,
    },

    titleTextBox: {
      flex: 1,
    },

    title: {
      color: '#213B2A',
      fontSize: 20,
      fontWeight: '800',
      lineHeight: 25,
    },

    rawMetric: {
      marginTop: 4,
      color: '#7A8A80',
      fontSize: 11,
    },

    badge: {
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 5,
    },

    badgeText: {
      fontSize: 11,
      fontWeight: '800',
    },

    assignedBadge: {
      marginTop: 14,
      alignSelf:
        'flex-start',
      backgroundColor:
        '#E5F1E8',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },

    assignedText: {
      color: '#2F6844',
      fontSize: 11,
      fontWeight: '800',
    },

    sectionHeading: {
      marginTop: 22,
      marginBottom: 8,
      color: '#6A7D71',
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.8,
    },

    card: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 17,
      borderWidth: 1,
      borderColor:
        '#DFE7E1',
      paddingHorizontal: 14,
    },

    detailRow: {
      flexDirection: 'row',
      justifyContent:
        'space-between',
      alignItems: 'flex-start',
      gap: 14,
      paddingVertical: 13,
      borderBottomWidth:
        StyleSheet.hairlineWidth,
      borderBottomColor:
        '#E6ECE8',
    },

    detailLabel: {
      color: '#68776D',
      fontSize: 12.5,
    },

    detailValue: {
      flex: 1,
      textAlign: 'right',
      color: '#213B2A',
      fontSize: 13,
      fontWeight: '700',
    },

    longRow: {
      paddingVertical: 13,
    },

    longValue: {
      marginTop: 6,
      color: '#213B2A',
      fontSize: 13,
      lineHeight: 19,
    },

    instructionCard: {
      flexDirection: 'row',
      gap: 10,
      padding: 15,
      borderRadius: 16,
      backgroundColor:
        '#EAF4EC',
      borderWidth: 1,
      borderColor:
        '#D7E8DC',
    },

    instructionText: {
      flex: 1,
      color: '#263C2D',
      fontSize: 13.5,
      lineHeight: 20,
    },

    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 18,
    },

    loadingText: {
      color: '#68776D',
      fontSize: 12.5,
    },

    messageRow: {
      flexDirection: 'row',
      alignItems:
        'flex-start',
      gap: 10,
      paddingVertical: 16,
    },

    messageText: {
      flex: 1,
      color: '#68776D',
      fontSize: 12.5,
      lineHeight: 18,
    },

    photoCard: {
      overflow: 'hidden',
      backgroundColor:
        '#FFFFFF',
      borderRadius: 18,
      borderWidth: 1,
      borderColor:
        '#DFE7E1',
    },

    photo: {
      width: '100%',
      height: 220,
      backgroundColor:
        '#E7ECE8',
    },

    photoMeta: {
      flexDirection: 'row',
      justifyContent:
        'space-between',
      alignItems: 'center',
      padding: 13,
    },

    photoMetaText: {
      flex: 1,
      color: '#68776D',
      fontSize: 11.5,
    },

    refreshPhoto: {
      color: '#2F6844',
      fontSize: 12,
      fontWeight: '800',
    },

    photoLoading: {
      minHeight: 180,
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 10,
    },

    photoEmpty: {
      minHeight: 180,
      alignItems: 'center',
      justifyContent:
        'center',
      padding: 20,
    },

    photoEmptyTitle: {
      marginTop: 8,
      color: '#213B2A',
      fontSize: 15,
      fontWeight: '800',
    },

    photoEmptyText: {
      marginTop: 5,
      color: '#68776D',
      fontSize: 12,
      lineHeight: 17,
      textAlign: 'center',
    },

    retryButton: {
      marginTop: 12,
      paddingHorizontal: 18,
      paddingVertical: 9,
      borderRadius: 999,
      borderWidth: 1,
      borderColor:
        '#213B2A',
    },

    retryButtonText: {
      color: '#213B2A',
      fontSize: 12,
      fontWeight: '800',
    },

    resolveCard: {
      padding: 15,
      borderRadius: 18,
      backgroundColor:
        '#FFFFFF',
      borderWidth: 1,
      borderColor:
        '#DFE7E1',
    },

    resolveHelp: {
      color: '#526158',
      fontSize: 12.5,
      lineHeight: 18,
      marginBottom: 10,
    },

    textInput: {
      minHeight: 120,
      borderWidth: 1,
      borderColor:
        '#CFDAD2',
      borderRadius: 14,
      padding: 13,
      color: '#213B2A',
      fontSize: 13.5,
      lineHeight: 20,
      backgroundColor:
        '#F9FBF9',
    },

    characterCount: {
      marginTop: 5,
      textAlign: 'right',
      color: '#98A69D',
      fontSize: 10.5,
    },

    resolveButton: {
      marginTop: 15,
      height: 50,
      borderRadius: 25,
      backgroundColor:
        '#213B2A',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 8,
    },

    resolveButtonDisabled: {
      opacity: 0.45,
    },

    resolveButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '800',
    },

    onlineNotice: {
      marginTop: 13,
      flexDirection: 'row',
      alignItems:
        'flex-start',
      gap: 7,
    },

    onlineNoticeText: {
      flex: 1,
      color: '#68776D',
      fontSize: 11.5,
      lineHeight: 16,
    },
  });