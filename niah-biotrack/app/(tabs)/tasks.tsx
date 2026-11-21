import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  Ionicons,
} from '@expo/vector-icons';

import {
  useFocusEffect,
  useRouter,
} from 'expo-router';

import {
  useAuthRole,
} from '../../src/context/AuthRoleContext';

import {
  useIotTaskStore,
  type AssignedIotTask,
} from '../../src/store/useIotTaskStore';

const SEVERITY_COLOURS: Record<
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

function title(
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
    normalized.includes('humidity')
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

  const parsed =
    new Date(value);

  return Number.isNaN(
    parsed.getTime()
  )
    ? value
    : parsed.toLocaleString();
}

export default function AssignedTasksScreen() {
  const router = useRouter();

  const {
    role,
  } = useAuthRole();

  const tasks =
    useIotTaskStore(
      (state) => state.tasks
    );

  const stations =
    useIotTaskStore(
      (state) => state.stations
    );

  const updatedAt =
    useIotTaskStore(
      (state) => state.updatedAt
    );

  const refreshing =
    useIotTaskStore(
      (state) => state.refreshing
    );

  const error =
    useIotTaskStore(
      (state) => state.error
    );

  const hydrateTasks =
    useIotTaskStore(
      (state) =>
        state.hydrateTasks
    );

  const refreshAssignedTasks =
    useIotTaskStore(
      (state) =>
        state.refreshAssignedTasks
    );

  const refresh =
    React.useCallback(() => {
      if (role === 'botanist') {
        void refreshAssignedTasks().catch(
          () => undefined
        );
      }
    }, [
      role,
      refreshAssignedTasks,
    ]);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;

      void hydrateTasks().then(
        () => {
          if (active) {
            refresh();
          }
        }
      );

      return () => {
        active = false;
      };
    }, [
      hydrateTasks,
      refresh,
    ])
  );

  const stationNames =
    React.useMemo(
      () =>
        new Map(
          stations.map(
            (station) => [
              station.id,
              station.station_code,
            ]
          )
        ),
      [stations]
    );

  const openTask = (
    task: AssignedIotTask
  ) => {
    router.push({
      pathname:
        '/iot-task-detail',
      params: {
        id: task.id,
      },
    } as any);
  };

  const renderTask = ({
    item,
  }: {
    item: AssignedIotTask;
  }) => {
    const severity =
      SEVERITY_COLOURS[
        item.severity
      ] ?? {
        background:
          '#E8EEE9',
        text: '#435348',
      };

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.75}
        onPress={() =>
          openTask(item)
        }
        accessibilityRole="button"
        accessibilityLabel={`Open ${title(
          item.alert_message
        )} task`}
      >
        <View
          style={
            styles.cardHeader
          }
        >
          <View
            style={
              styles.titleRow
            }
          >
            <Ionicons
              name="warning-outline"
              size={20}
              color="#213B2A"
            />

            <Text
              style={
                styles.cardTitle
              }
            >
              {title(
                item.alert_message
              )}
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
              {item.severity
                .charAt(0)
                .toUpperCase() +
                item.severity.slice(
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
            Assigned by officer
          </Text>
        </View>

        <Text
          style={styles.station}
        >
          {stationNames.get(
            item.station_id
          ) ??
            'Unknown station'}
        </Text>

        {item.assignment_notes ? (
          <View
            style={styles.note}
          >
            <Text
              style={
                styles.noteLabel
              }
            >
              Officer instruction
            </Text>

            <Text
              style={
                styles.noteText
              }
            >
              {
                item.assignment_notes
              }
            </Text>
          </View>
        ) : null}

        <View
          style={
            styles.bottomRow
          }
        >
          <View style={{ flex: 1 }}>
            <Text
              style={styles.time}
            >
              Assigned{' '}
              {dateTime(
                item.assigned_at
              )}
            </Text>

            <Text
              style={styles.time}
            >
              Triggered{' '}
              {dateTime(
                item.triggered_at
              )}
            </Text>
          </View>

          <Ionicons
            name="chevron-forward"
            size={22}
            color="#7A8A80"
          />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView
      style={styles.safeArea}
    >
      <View
        style={styles.header}
      >
        <View>
          <Text
            style={styles.heading}
          >
            Assigned tasks
          </Text>

          <Text
            style={
              styles.subheading
            }
          >
            IoT alerts assigned to
            you by an officer
          </Text>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Refresh assigned tasks"
          style={
            styles.refreshButton
          }
          onPress={refresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <ActivityIndicator
              size="small"
              color="#FFFFFF"
            />
          ) : (
            <Ionicons
              name="refresh"
              size={20}
              color="#FFFFFF"
            />
          )}
        </TouchableOpacity>
      </View>

      {error ? (
        <View
          style={
            styles.offlineNotice
          }
        >
          <Ionicons
            name="cloud-offline-outline"
            size={18}
            color="#8C5E03"
          />

          <Text
            style={
              styles.offlineText
            }
          >
            Latest tasks could
            not be downloaded.
            Showing the saved
            copy on this phone.
          </Text>
        </View>
      ) : null}

      <FlatList
        data={tasks}
        keyExtractor={(item) =>
          item.id
        }
        renderItem={renderTask}
        contentContainerStyle={
          tasks.length
            ? styles.list
            : styles.emptyList
        }
        refreshControl={
          <RefreshControl
            refreshing={
              refreshing
            }
            onRefresh={refresh}
            tintColor="#213B2A"
          />
        }
        ListEmptyComponent={
          refreshing
            ? undefined
            : (
              <View
                style={
                  styles.empty
                }
              >
                <Ionicons
                  name="checkmark-circle-outline"
                  size={52}
                  color="#7FA38B"
                />

                <Text
                  style={
                    styles.emptyTitle
                  }
                >
                  No assigned tasks
                </Text>

                <Text
                  style={
                    styles.emptyText
                  }
                >
                  New officer
                  assignments will
                  appear here after
                  the app
                  syncs.
                </Text>
              </View>
            )
        }
        ListFooterComponent={
          updatedAt &&
          tasks.length ? (
            <Text
              style={
                styles.updated
              }
            >
              Last updated{' '}
              {dateTime(
                updatedAt
              )}
            </Text>
          ) : undefined
        }
      />
    </SafeAreaView>
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
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 14,
    },

    heading: {
      fontSize: 27,
      fontWeight: '800',
      color: '#213B2A',
    },

    subheading: {
      marginTop: 4,
      fontSize: 12.5,
      color: '#68776D',
    },

    refreshButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent:
        'center',
      backgroundColor:
        '#213B2A',
    },

    offlineNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 20,
      marginBottom: 8,
      padding: 12,
      borderRadius: 12,
      backgroundColor:
        '#FDF4D8',
    },

    offlineText: {
      flex: 1,
      color: '#6F4B05',
      fontSize: 12,
      lineHeight: 17,
    },

    list: {
      padding: 20,
      paddingTop: 8,
      gap: 12,
    },

    emptyList: {
      flexGrow: 1,
      padding: 20,
    },

    card: {
      backgroundColor:
        '#FFFFFF',
      borderWidth: 1,
      borderColor:
        '#DFE7E1',
      borderRadius: 18,
      padding: 16,
    },

    cardHeader: {
      flexDirection: 'row',
      alignItems:
        'flex-start',
      justifyContent:
        'space-between',
      gap: 10,
    },

    titleRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems:
        'flex-start',
      gap: 8,
    },

    cardTitle: {
      flex: 1,
      color: '#213B2A',
      fontSize: 16,
      fontWeight: '800',
      lineHeight: 21,
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
      alignSelf:
        'flex-start',
      marginTop: 12,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 5,
      backgroundColor:
        '#E5F1E8',
    },

    assignedText: {
      color: '#2F6844',
      fontSize: 11,
      fontWeight: '800',
    },

    station: {
      marginTop: 11,
      color: '#526158',
      fontSize: 13,
      fontWeight: '700',
    },

    note: {
      marginTop: 12,
      padding: 12,
      borderRadius: 12,
      backgroundColor:
        '#F3F6F4',
    },

    noteLabel: {
      color: '#526158',
      fontSize: 11,
      fontWeight: '800',
      marginBottom: 5,
    },

    noteText: {
      color: '#263C2D',
      fontSize: 13,
      lineHeight: 19,
    },

    bottomRow: {
      marginTop: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },

    time: {
      marginTop: 5,
      color: '#7A8A80',
      fontSize: 11.5,
    },

    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent:
        'center',
      paddingHorizontal: 28,
    },

    emptyTitle: {
      marginTop: 14,
      color: '#213B2A',
      fontSize: 18,
      fontWeight: '800',
    },

    emptyText: {
      marginTop: 7,
      color: '#68776D',
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
    },

    updated: {
      paddingTop: 14,
      paddingBottom: 6,
      color: '#7A8A80',
      fontSize: 11,
      textAlign: 'center',
    },
  });