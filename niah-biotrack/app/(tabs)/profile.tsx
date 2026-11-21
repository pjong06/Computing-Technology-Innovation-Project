import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';

import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useAuthRole } from '../../src/context/AuthRoleContext';
import { supabase } from '../../src/lib/supabase';

import {
  SyncStatus,
  useRecordStore,
} from '../../src/store/useRecordStore';

import { useProposalStore } from '../../src/store/useProposalStore';

import { buildSyncSummary } from '../../src/services/syncSummary';

import { routesUploadedText } from '../../src/utils/routeSync';

import {
  getLastSuccessfulSync,
  resumeAllPausedRecordRetries,
} from '../../src/services/offlineDatabase';
import { pullServerRecords, serverPullError } from '../../src/services/serverPull';

const NOT_RECORDED = 'Not recorded';

const ROLE_LABELS: Record<string, string> = {
  botanist: 'Botanist',
  officer: 'Conservation officer',
  researcher: 'Researcher',
};

function roleLabel(role: string): string {
  const key = role.trim().toLowerCase();
  return ROLE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

interface ProfileData {
  fullName: string | null;
  email: string | null;
  role: string | null;
  staffId: string | null;
}

export default function ProfileScreen() {
  const router = useRouter();

  const {
    isVisitor,
    isGuest,
    role,
    userName,
    logout,
  } = useAuthRole();

  const records = useRecordStore(
    (state) => state.records
  );

  const syncAll = useRecordStore(
    (state) => state.syncAll
  );

  const syncRoutes = useRecordStore(
    (state) => state.syncRoutes
  );

  // Saved trace routes still to upload, and how many of those failed last time.
  const routesNotUploaded = useRecordStore(
    (state) =>
      state.routes.filter(
        (route) => route.syncStatus !== 'uploaded'
      ).length
  );

  const routesFailed = useRecordStore(
    (state) =>
      state.routes.filter(
        (route) => route.syncStatus === 'failed'
      ).length
  );

  const unsentProposalCount = useProposalStore(
    (state) =>
      state.proposals.filter(
        (proposal) =>
          proposal.syncStatus !== SyncStatus.UPLOADED
      ).length
  );

  const syncAllProposals = useProposalStore(
    (state) => state.syncAllProposals
  );

  const refreshProposalStatuses = useProposalStore(
    (state) => state.refreshProposalStatuses
  );

  const [loading, setLoading] =
    useState<boolean>(!isVisitor);

  const [profile, setProfile] =
    useState<ProfileData | null>(null);

  const [visitorEmail, setVisitorEmail] =
    useState<string | null>(null);

  const [isSyncing, setIsSyncing] =
    useState(false);

  const [lastSyncAt, setLastSyncAt] =
    useState<string | null>(null);

  /*
   * Same record summary used by Home.
   *
   * Auto sync is the normal workflow.
   * This Profile screen keeps "Sync now" only as a manual fallback.
   */
  const syncSummary =
    buildSyncSummary(records, isSyncing);

  const uploadedCount =
    syncSummary.uploadedRecordCount;

  const pendingCount =
    syncSummary.pendingRecordCount;

  const failedCount =
    syncSummary.failedRecordCount;

  /*
   * Load account/profile data.
   */
  useEffect(() => {
    if (isVisitor) {
      setLoading(false);

      if (!isGuest) {
        void supabase.auth
          .getSession()
          .then(({ data }) => {
            setVisitorEmail(
              data.session?.user.email ?? null
            );
          });
      }

      return;
    }

    async function fetchStaffProfile() {
      try {
        setLoading(true);

        /*
         * Read cached Supabase session first.
         * This still works when field connectivity is unavailable.
         */
        const { data: sessionData } =
          await supabase.auth.getSession();

        const user =
          sessionData?.session?.user;

        if (!user) {
          setLoading(false);
          return;
        }

        let resolvedName: string | null =
          user.user_metadata?.full_name || null;

        let resolvedRole: string | null =
          user.user_metadata?.role ||
          role ||
          null;

        let resolvedStaffId: string | null =
          null;

        /*
         * Extended profile information is optional here.
         * If the request cannot reach Supabase, cached session
         * information is still displayed.
         */
        try {
          const { data: dbProfile } =
            await supabase
              .from('profiles')
              .select(
                'full_name, role, staff_id'
              )
              .eq('id', user.id)
              .maybeSingle();

          if (dbProfile) {
            resolvedName =
              dbProfile.full_name ||
              resolvedName;

            resolvedRole =
              dbProfile.role ||
              resolvedRole;

            resolvedStaffId =
              dbProfile.staff_id ||
              resolvedStaffId;
          }
        } catch {
          // Keep cached session values.
        }

        setProfile({
          fullName: resolvedName,
          email: user.email || null,
          role: resolvedRole,
          staffId: resolvedStaffId,
        });
      } catch {
        setProfile({
          fullName: null,
          email: null,
          role: role || null,
          staffId: null,
        });
      } finally {
        setLoading(false);
      }
    }

    void fetchStaffProfile();
  }, [
    isVisitor,
    isGuest,
    role,
  ]);

  /*
   * SQLite remembers the last fully successful sync.
   */
  useEffect(() => {
    if (isVisitor) {
      return;
    }

    void getLastSuccessfulSync()
      .then(setLastSyncAt)
      .catch(() => undefined);
  }, [isVisitor]);

  /*
   * Manual fallback.
   *
   * Normal workflow:
   * Save -> SQLite -> automatic upload.
   *
   * Offline workflow:
   * Save -> SQLite -> reconnect -> automatic upload.
   *
   * This button exists when the Botanist wants to force a retry.
   */
  const handleSync = async () => {
    if (
      isVisitor ||
      isSyncing
    ) {
      return;
    }

    setIsSyncing(true);

    try {
      await resumeAllPausedRecordRetries();
      /*
       * syncAll() also processes the durable SQLite outbox first,
       * including operations such as an offline delete.
       */
      const recordResult =
        await syncAll();

      /*
       * Trace routes upload on their own path, after
       * the plant/visit sync (never inside syncAll).
       */
      const routeResult =
        await syncRoutes();

      /*
       * Main also has Species Proposal synchronization.
       * Keep it part of the manual Sync now operation.
       */
      const proposalResult =
        await syncAllProposals();

      try {
        await refreshProposalStatuses();
      } catch {
        // Proposal status refresh should not invalidate
        // successful field-record synchronization.
      }

      let downloaded = 0;
      let downloadError: string | null = null;
      try {
        downloaded = (await pullServerRecords()).downloaded;
      } catch (error) {
        downloadError = serverPullError(error);
      }

      const latestSuccessfulSync =
        await getLastSuccessfulSync();

      setLastSyncAt(
        latestSuccessfulSync
      );

      const totalFailed =
        recordResult.failed +
        proposalResult.failed +
        routeResult.failed;

      const routesLine =
        routeResult.uploaded > 0
          ? ` ${routesUploadedText(routeResult.uploaded)}.`
          : '';

      if (totalFailed > 0) {
        const reason = proposalResult.reasons[0] ?? downloadError;
        Alert.alert(
          'Sync needs attention',
          `${totalFailed} ${totalFailed === 1 ? 'item' : 'items'} could not be uploaded. They remain safely stored on this phone.${reason ? ` ${reason}` : ''}${routesLine}`
        );

        return;
      }

      if (downloadError) {
        Alert.alert('Uploaded, but couldn\'t download updates', downloadError);
        return;
      }

      const processed =
        recordResult.uploaded +
        proposalResult.uploaded;

      Alert.alert(
        'Sync complete',
        processed > 0 || routeResult.uploaded > 0 || downloaded > 0
          ? `${processed} ${processed === 1 ? 'item' : 'items'} uploaded and ${downloaded} server ${downloaded === 1 ? 'change' : 'changes'} downloaded.${routesLine}`
          : 'Everything is up to date.'
      );
    } catch (error) {
      Alert.alert(
        'Sync could not complete',
        error instanceof Error
          ? error.message
          : 'Your local data remains safely stored on this phone.'
      );
    } finally {
      setIsSyncing(false);
    }
  };

  /*
   * Warn before logout if local work has not reached
   * the server yet.
   */
  const unsynced =
    syncSummary.unsyncedRecordCount;

  const hasUnsent =
    unsynced > 0 ||
    unsentProposalCount > 0;

  const unsentText = [
    unsynced > 0
      ? `${unsynced} ${
          unsynced === 1
            ? 'record'
            : 'records'
        }`
      : null,

    unsentProposalCount > 0
      ? `${unsentProposalCount} species ${
          unsentProposalCount === 1
            ? 'request'
            : 'requests'
        }`
      : null,
  ]
    .filter(Boolean)
    .join(' and ');

  const handleGuestSignUp = () => {
    router.push(
      '/sign-up' as any
    );
  };

  const handleGuestLogOut =
    async () => {
      await logout();

      router.replace('/');
    };

  const handleLogout =
    async () => {
      Alert.alert(
        isVisitor
          ? 'Exit Visitor Mode'
          : hasUnsent
            ? 'Log out with unsynced data?'
            : 'Log out',

        isVisitor
          ? 'Return to sign-in screen?'
          : hasUnsent
            ? `${unsentText} not uploaded to the server yet. Logging out deletes them and all photos from this device. This cannot be undone.`
            : 'Are you sure you want to log out of your field session? Records and photos are removed from this phone.',

        [
          {
            text: 'Cancel',
            style: 'cancel',
          },

          {
            text: isVisitor
              ? 'Exit'
              : hasUnsent
                ? 'Log out anyway'
                : 'Log out',

            style: 'destructive',

            onPress:
              async () => {
                await logout();

                router.replace(
                  '/'
                );
              },
          },
        ]
      );
    };

  return (
    <SafeAreaView
      style={styles.safeArea}
    >
      <StatusBar
        barStyle="dark-content"
      />

      <View
        style={styles.header}
      >
        <Text
          style={
            styles.headerTitle
          }
        >
          Profile
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={
          styles.scrollContent
        }
      >
        {/* User Card */}

        {isGuest ? (
          <View
            style={styles.card}
          >
            <View
              style={
                styles.userRow
              }
            >
              <View
                style={[
                  styles.avatarCircle,
                  {
                    backgroundColor:
                      '#E0F2FE',
                  },
                ]}
              >
                <Ionicons
                  name="compass"
                  size={30}
                  color="#0284C7"
                />
              </View>

              <View
                style={
                  styles.userInfo
                }
              >
                <Text
                  style={
                    styles.userName
                  }
                >
                  You're exploring
                  as a guest
                </Text>

                <Text
                  style={
                    styles.userSub
                  }
                >
                  No account ·
                  nothing is saved
                  to the server
                </Text>
              </View>
            </View>

            <View
              style={
                styles.visitorDescBox
              }
            >
              <Ionicons
                name="information-circle-outline"
                size={17}
                color="#0369A1"
              />

              <Text
                style={
                  styles.visitorDescText
                }
              >
                You can browse
                approved plants and
                scan plant tags. Log
                in, or create a free
                account.
              </Text>
            </View>
          </View>
        ) : isVisitor ? (
          <View
            style={styles.card}
          >
            <View
              style={
                styles.userRow
              }
            >
              <View
                style={[
                  styles.avatarCircle,
                  {
                    backgroundColor:
                      '#E0F2FE',
                  },
                ]}
              >
                <Ionicons
                  name="person"
                  size={28}
                  color="#0284C7"
                />
              </View>

              <View
                style={
                  styles.userInfo
                }
              >
                <Text
                  style={
                    styles.userName
                  }
                >
                  {userName ||
                    visitorEmail ||
                    NOT_RECORDED}
                </Text>

                <Text
                  style={
                    styles.userSub
                  }
                >
                  {visitorEmail ||
                    NOT_RECORDED}
                </Text>
              </View>

              <View
                style={
                  styles.visitorBadge
                }
              >
                <Text
                  style={
                    styles.visitorBadgeText
                  }
                >
                  VISITOR
                </Text>
              </View>
            </View>

            <Text
              style={
                styles.visitorAccountText
              }
            >
              Visitor account
            </Text>
          </View>
        ) : loading ? (
          <View
            style={[
              styles.card,
              styles.centerCard,
            ]}
          >
            <ActivityIndicator
              size="small"
              color="#2D6A4F"
            />

            <Text
              style={
                styles.loadingText
              }
            >
              Loading account
              details...
            </Text>
          </View>
        ) : (
          <View
            style={styles.card}
          >
            <View
              style={
                styles.userRow
              }
            >
              <View
                style={[
                  styles.avatarCircle,
                  {
                    backgroundColor:
                      '#E8F5E9',
                  },
                ]}
              >
                <Ionicons
                  name="person"
                  size={28}
                  color="#2D6A4F"
                />
              </View>

              <View
                style={
                  styles.userInfo
                }
              >
                <Text
                  style={
                    styles.userName
                  }
                >
                  {profile?.fullName ||
                    profile?.email ||
                    NOT_RECORDED}
                </Text>

                <Text
                  style={
                    styles.userSub
                  }
                >
                  {profile?.email ||
                    NOT_RECORDED}
                </Text>
              </View>

              <View
                style={
                  styles.staffBadge
                }
              >
                <Text
                  style={
                    styles.staffBadgeText
                  }
                >
                  STAFF
                </Text>
              </View>
            </View>

            <View
              style={
                styles.metaRow
              }
            >
              <View
                style={
                  styles.metaCol
                }
              >
                <Text
                  style={
                    styles.metaLabel
                  }
                >
                  Designation
                </Text>

                <Text
                  style={
                    styles.metaVal
                  }
                >
                  {profile?.role
                    ? roleLabel(profile.role)
                    : NOT_RECORDED}
                </Text>
              </View>

              <View
                style={
                  styles.metaDivider
                }
              />

              <View
                style={
                  styles.metaCol
                }
              >
                <Text
                  style={
                    styles.metaLabel
                  }
                >
                  Staff ID
                </Text>

                <Text
                  style={
                    styles.metaVal
                  }
                >
                  {profile?.staffId ||
                    NOT_RECORDED}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Database Sync - Staff only */}

        {!isVisitor && (
          <View
            style={styles.card}
          >
            <View
              style={
                styles.cardHeaderBetween
              }
            >
              <Text
                style={
                  styles.cardTitle
                }
              >
                Sync
              </Text>

              <View
                style={
                  styles.syncStatusPill
                }
              >
                <Text
                  style={
                    styles.syncStatusText
                  }
                >
                  {isSyncing
                    ? 'Syncing...'
                    : failedCount > 0
                      ? 'Attention needed'
                      : pendingCount > 0
                        ? `${pendingCount} queued`
                        : records.length >
                            0
                          ? 'All synced'
                          : 'No records'}
                </Text>
              </View>
            </View>

            <Text
              style={
                styles.cardSub
              }
            >
              Local storage and
              cloud synchronization
              status.
            </Text>

            <View
              style={
                styles.metricsGrid
              }
            >
              <View
                style={
                  styles.metricBox
                }
              >
                <Text
                  style={[
                    styles.metricNumber,
                    {
                      color:
                        '#2D6A4F',
                    },
                  ]}
                >
                  {
                    uploadedCount
                  }
                </Text>

                <Text
                  style={
                    styles.metricLabel
                  }
                >
                  Uploaded
                </Text>
              </View>

              <View
                style={
                  styles.metricDivider
                }
              />

              <View
                style={
                  styles.metricBox
                }
              >
                <Text
                  style={[
                    styles.metricNumber,
                    {
                      color:
                        '#D97706',
                    },
                  ]}
                >
                  {
                    pendingCount
                  }
                </Text>

                <Text
                  style={
                    styles.metricLabel
                  }
                >
                  Waiting
                </Text>
              </View>

              <View
                style={
                  styles.metricDivider
                }
              />

              <View
                style={
                  styles.metricBox
                }
              >
                <Text
                  style={[
                    styles.metricNumber,
                    {
                      color:
                        '#DC2626',
                    },
                  ]}
                >
                  {
                    failedCount
                  }
                </Text>

                <Text
                  style={
                    styles.metricLabel
                  }
                >
                  Failed
                </Text>
              </View>
            </View>

            {routesNotUploaded > 0 ? (
              <Text
                style={
                  styles.routesLine
                }
              >
                Routes: {routesNotUploaded} not uploaded
                {routesFailed > 0
                  ? ` · ${routesFailed} failed (Sync now to retry)`
                  : ''}
              </Text>
            ) : null}

            <View
              style={
                styles.syncFooterRow
              }
            >
              <Ionicons
                name="time-outline"
                size={15}
                color="#8A998E"
              />

              <Text
                style={
                  styles.syncFooterText
                }
              >
                Last successful
                sync:{' '}

                <Text
                  style={{
                    fontWeight:
                      '700',
                  }}
                >
                  {lastSyncAt
                    ? new Date(
                        lastSyncAt
                      ).toLocaleString()
                    : 'Not yet'}
                </Text>
              </Text>
            </View>

            <Text
              style={
                styles.syncSummaryText
              }
            >
              {
                syncSummary.overallMessage
              }{' '}
              Observations:{' '}
              {
                syncSummary.observationSummary
              }.
            </Text>

            <TouchableOpacity
              style={[
                styles.syncButton,

                isSyncing &&
                  styles.syncButtonDisabled,
              ]}
              onPress={
                handleSync
              }
              disabled={
                isSyncing
              }
            >
              {isSyncing ? (
                <ActivityIndicator
                  size="small"
                  color="#FFFFFF"
                />
              ) : (
                <Ionicons
                  name="cloud-upload-outline"
                  size={18}
                  color="#FFFFFF"
                />
              )}

              <Text
                style={
                  styles.syncButtonText
                }
              >
                {isSyncing
                  ? 'Syncing...'
                  : 'Sync now'}
              </Text>
            </TouchableOpacity>

            <Text
              style={
                styles.syncHelpText
              }
            >
              Records normally sync
              automatically. Use this
              button only to force a
              retry.
            </Text>
          </View>
        )}

        {/* My QR tags - botanists: reserved tags and "Get new tags" (PDF of QR labels). */}

        {role === 'botanist' && (
          <TouchableOpacity
            style={[styles.actionRowCard, styles.actionRowSpaced]}
            activeOpacity={0.8}
            onPress={() => router.push('/my-tags' as never)}
            accessibilityRole="button"
            accessibilityLabel="My QR tags"
          >
            <View style={styles.actionRowLeft}>
              <View style={styles.actionIconBox}>
                <Ionicons
                  name="qr-code-outline"
                  size={18}
                  color="#213B2A"
                />
              </View>
              <Text style={styles.actionRowTitle}>
                My QR tags
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color="#76877B"
            />
          </TouchableOpacity>
        )}

        {/* Account Security - Signed-in accounts only */}

        {!isGuest && (
          <TouchableOpacity
            style={styles.actionRowCard}
            activeOpacity={0.8}
            onPress={() => router.push('/change-password' as never)}
          >
            <View style={styles.actionRowLeft}>
              <View style={styles.actionIconBox}>
                <Ionicons
                  name="key-outline"
                  size={18}
                  color="#213B2A"
                />
              </View>
              <Text style={styles.actionRowTitle}>
                Change password
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color="#76877B"
            />
          </TouchableOpacity>
        )}

        {/* Actions */}

        {isGuest && (
          <TouchableOpacity
            style={
              styles.signUpBtn
            }
            onPress={
              handleGuestSignUp
            }
          >
            <Text
              style={
                styles.signUpBtnText
              }
            >
              Sign up
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={
            styles.logoutBtn
          }

          onPress={
            isGuest
              ? handleGuestLogOut
              : handleLogout
          }
        >
          <Text
            style={
              styles.logoutText
            }
          >
            Log out
          </Text>
        </TouchableOpacity>
      </ScrollView>
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
      paddingHorizontal: 20,
      paddingVertical: 14,
      backgroundColor:
        '#FFFFFF',
      borderBottomWidth: 1,
      borderBottomColor:
        '#E6ECE8',
    },

    headerTitle: {
      fontSize: 22,
      fontWeight: '800',
      color: '#213B2A',
    },

    scrollContent: {
      padding: 16,
      paddingBottom: 40,
      gap: 14,
    },

    card: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 20,
      padding: 18,
      borderWidth: 1,
      borderColor:
        '#E6ECE8',
    },

    centerCard: {
      alignItems: 'center',
      paddingVertical: 32,
      gap: 10,
    },

    loadingText: {
      fontSize: 13,
      color: '#68776D',
      fontWeight: '600',
    },

    userRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },

    avatarCircle: {
      width: 52,
      height: 52,
      borderRadius: 26,
      justifyContent:
        'center',
      alignItems: 'center',
      marginRight: 14,
    },

    userInfo: {
      flex: 1,
      minWidth: 0,
    },

    userName: {
      fontSize: 18,
      fontWeight: '800',
      color: '#213B2A',
    },

    userSub: {
      fontSize: 12.5,
      color: '#68776D',
      marginTop: 2,
    },

    staffBadge: {
      backgroundColor:
        '#E8F5E9',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor:
        '#A3D9A5',
    },

    staffBadgeText: {
      fontSize: 10.5,
      fontWeight: '800',
      color: '#2D6A4F',
    },

    visitorBadge: {
      backgroundColor:
        '#E0F2FE',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor:
        '#BAE6FD',
    },

    visitorBadgeText: {
      fontSize: 10.5,
      fontWeight: '800',
      color: '#0284C7',
    },

    visitorDescBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor:
        '#F0F9FF',
      borderRadius: 12,
      padding: 12,
      marginTop: 14,
    },

    visitorDescText: {
      flex: 1,
      minWidth: 0,
      fontSize: 12,
      color: '#0369A1',
      lineHeight: 17,
    },

    visitorAccountText: {
      fontSize: 13,
      color: '#526659',
      marginTop: 12,
    },

    metaRow: {
      flexDirection: 'row',
      backgroundColor:
        '#F7F9F7',
      borderRadius: 14,
      paddingVertical: 12,
      marginTop: 14,
      borderWidth: 1,
      borderColor:
        '#E8EFEA',
    },

    metaCol: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
    },

    metaDivider: {
      width: 1,
      backgroundColor:
        '#DDE5E0',
    },

    metaLabel: {
      fontSize: 11,
      color: '#76877B',
      fontWeight: '600',
      marginBottom: 2,
    },

    metaVal: {
      fontSize: 13,
      fontWeight: '800',
      color: '#213B2A',
    },

    cardHeaderBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      marginBottom: 4,
    },

    cardTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: '#213B2A',
    },

    cardSub: {
      fontSize: 12,
      color: '#68776D',
      marginBottom: 16,
    },

    syncStatusPill: {
      backgroundColor:
        '#F0F4F1',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
    },

    syncStatusText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#49594D',
    },

    metricsGrid: {
      flexDirection: 'row',
      backgroundColor:
        '#F9FAF9',
      borderRadius: 14,
      paddingVertical: 14,
      borderWidth: 1,
      borderColor:
        '#EAEFEA',
      marginBottom: 12,
    },

    metricBox: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
    },

    metricNumber: {
      fontSize: 22,
      fontWeight: '900',
      fontVariant: [
        'tabular-nums',
      ],
    },

    metricLabel: {
      fontSize: 11,
      color: '#68776D',
      fontWeight: '600',
      marginTop: 2,
    },

    metricDivider: {
      width: 1,
      backgroundColor:
        '#E2E8E4',
    },

    syncFooterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      justifyContent:
        'center',
      marginTop: 4,
    },

    syncFooterText: {
      fontSize: 11.5,
      color: '#76877B',
      textAlign: 'center',
    },

    routesLine: {
      fontSize: 12,
      color: '#526659',
      fontWeight: '600',
      textAlign: 'center',
      marginBottom: 8,
    },

    syncSummaryText: {
      fontSize: 11.5,
      color: '#76877B',
      textAlign: 'center',
      marginTop: 8,
    },

    syncButton: {
      minHeight: 48,
      borderRadius: 24,
      backgroundColor:
        '#2D6A4F',
      marginTop: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 8,
    },

    syncButtonDisabled: {
      backgroundColor:
        '#A8B6AC',
    },

    syncButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '800',
    },

    syncHelpText: {
      fontSize: 11,
      color: '#8A998E',
      textAlign: 'center',
      marginTop: 8,
    },

    actionRowSpaced: {
      marginTop: 10,
    },

    actionRowCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: '#FFFFFF',
      borderRadius: 18,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderWidth: 1,
      borderColor: '#E6ECE8',
    },

    actionRowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },

    actionIconBox: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: '#EDF3EE',
      alignItems: 'center',
      justifyContent: 'center',
    },

    actionRowTitle: {
      fontSize: 14.5,
      fontWeight: '700',
      color: '#213B2A',
    },

    signUpBtn: {
      backgroundColor:
        '#213B2A',
      height: 50,
      borderRadius: 25,
      justifyContent:
        'center',
      alignItems: 'center',
      marginTop: 8,
      marginBottom: 10,
    },

    signUpBtnText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '700',
    },

    logoutBtn: {
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent:
        'center',
      marginTop: 10,
    },

    logoutText: {
      fontSize: 15,
      fontWeight: '700',
      color: '#DC2626',
    },
  });
