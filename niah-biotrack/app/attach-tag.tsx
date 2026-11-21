import React, {
  useEffect,
  useState,
} from 'react';

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  Alert,
  Image,
  ActivityIndicator,
  Share,
} from 'react-native';

import {
  useRouter,
  useLocalSearchParams,
} from 'expo-router';

import {
  CameraView,
  useCameraPermissions,
} from 'expo-camera';

import Toast from 'react-native-toast-message';

import {
  useStaffOnly,
} from '../src/context/AuthRoleContext';

import {
  useRecordStore,
} from '../src/store/useRecordStore';

import {
  apiFetch,
  ApiError,
} from '../src/api/client';

import {
  saveQrImage,
  type PlantQr,
} from '../src/api/plantQr';

import {
  parseTagCode,
} from '../src/utils/tagCode';

import FormScrollView from '../src/components/FormScrollView';
import { myTagProblem } from '../src/services/myTags';

interface AutoAttachTagResponse {
  tag_code: string;
  // The plant's version after the server saved the tag.
  row_version?: number;
  qr_code: string;
  public_url: string;
}

type ServerStatus =
  | 'idle'
  | 'checking'
  | 'success'
  | 'offline'
  | 'error';

export default function AttachTagScreen() {
  const router =
    useRouter();

  /*
   * Botanist-only screen.
   */
  const blocked =
    useStaffOnly();

  /*
   * Support BOTH navigation styles:
   *
   * our plant-detail:
   *   recordId = local UUID
   *
   * teammate/main:
   *   id / plantId = possibly server UUID
   */
  const params =
    useLocalSearchParams<{
      recordId?: string;
      id?: string;
      plantId?: string;
    }>();

  const requestedId =
    params.recordId ||
    params.plantId ||
    params.id;

  const records =
    useRecordStore(
      (state) =>
        state.records
    );

  const record =
    records.find(
      (item) =>
        item.id ===
          requestedId ||
        item.serverId ===
          requestedId
    );

  const attachTag =
    useRecordStore(
      (state) =>
        state.attachTag
    );

  /*
   * Camera.
   */
  const [
    permission,
    requestPermission,
  ] =
    useCameraPermissions();

  const [
    scanned,
    setScanned,
  ] =
    useState(false);

  /*
   * Manual tag input.
   */
  const [
    code,
    setCode,
  ] =
    useState('');

  const [
    manualError,
    setManualError,
  ] =
    useState<
      string | null
    >(null);

  /*
   * Teammate server-generated
   * Tag + QR.
   */
  const [
    serverStatus,
    setServerStatus,
  ] =
    useState<ServerStatus>(
      'idle'
    );

  const [
    serverMessage,
    setServerMessage,
  ] =
    useState('');

  const [
    qrData,
    setQrData,
  ] =
    useState<PlantQr | null>(
      null
    );

  /*
   * Camera permission.
   */
  useEffect(() => {
    if (
      permission?.status ===
      'undetermined'
    ) {
      void requestPermission();
    }
  }, [
    permission?.status,
    requestPermission,
  ]);

  /*
   * A new server tag is made only when the botanist asks ("Generate new tag" below): the
   * screen first offers scanning one of their printed tags (My QR tags), so opening it never
   * uses up a new number by itself.
   */

  /*
   * =====================================================
   * OFFLINE / PRE-PRINTED TAG WORKFLOW
   * =====================================================
   */
  const tryAttach =
    async (
      raw: string
    ): Promise<
      string | null
    > => {
      if (!record) {
        return 'Plant record not found.';
      }

      const clean =
        parseTagCode(
          raw
        );

      if (!clean) {
        return "That isn't a Niah plant tag. Tag codes look like NIAH-PLT-00001.";
      }

      // Only one of this botanist's own reserved, unused tags (checked online, or against
      // the list saved on the phone when offline). Anything else would be refused at sync.
      const notMine = await myTagProblem(clean, record.serverId);
      if (notMine) {
        return notMine;
      }

      const result =
        await attachTag(
          record.id,
          clean
        );

      if (
        !result.ok
      ) {
        return result.reason;
      }

      Toast.show({
        type: 'success',

        text1:
          'Tag attached',

        text2:
          `${clean} saved on this device.`,
      });

      /*
       * attachTag() already:
       *
       * → writes SQLite
       * → queues metadata update
       * → tries sync immediately if possible
       *
       * If offline, autoSync finishes after reconnect.
       */
      router.back();

      return null;
    };

  /*
   * QR camera scanned.
   */
  const handleBarcodeScanned =
    async ({
      data,
    }: {
      data: string;
    }) => {
      if (scanned) {
        return;
      }

      setScanned(
        true
      );

      const problem =
        await tryAttach(
          data
        );

      if (problem) {
        Alert.alert(
          "Couldn't attach tag",

          problem,

          [
            {
              text: 'OK',

              onPress:
                () =>
                  setScanned(
                    false
                  ),
            },
          ]
        );
      }
    };

  /*
   * Manual text entry.
   */
  const handleManualAttach =
    async () => {
      const problem =
        await tryAttach(
          code
        );

      setManualError(
        problem
      );
    };

  /*
   * Retry teammate's online generation.
   */
  const retryServerGeneration =
    async () => {
      if (
        !record?.serverId
      ) {
        Toast.show({
          type: 'info',

          text1:
            'Plant not uploaded yet',

          text2:
            'Sync the plant first before generating its server QR.',
        });

        return;
      }

      setServerStatus(
        'checking'
      );

      setServerMessage(
        'Assigning tag and generating QR...'
      );

      try {
        const response =
          await apiFetch<AutoAttachTagResponse>(
            `/api/plants/${encodeURIComponent(
              record.serverId
            )}/attach-tag`,
            {
              method:
                'POST',

              body: {},
            }
          );

        const localResult =
          await attachTag(
            record.id,
            response.tag_code,
            {
              serverRowVersion:
                response.row_version,
            }
          );

        if (
          !localResult.ok
        ) {
          setServerStatus(
            'error'
          );

          setServerMessage(
            localResult.reason
          );

          return;
        }

        setQrData({
          qrValue:
            response.tag_code,

          publicUrl:
            response.public_url,

          imageDataUri:
            response.qr_code,
        });

        setServerStatus(
          'success'
        );

        setServerMessage(
          'Tag assigned and QR generated successfully.'
        );
      } catch (error) {
        setServerStatus(
          error instanceof
              ApiError &&
            error.status ===
              0
            ? 'offline'
            : 'error'
        );

        setServerMessage(
          error instanceof
            Error
            ? error.message
            : 'Could not generate a server tag.'
        );
      }
    };

  /*
   * Share teammate-generated QR.
   */
  const handleShare =
    async () => {
      if (!qrData) {
        return;
      }

      try {
        if (
          Platform.OS ===
          'ios'
        ) {
          const fileUri =
            await saveQrImage(
              qrData
            );

          await Share.share({
            url: fileUri,

            message:
              `${qrData.qrValue}\n${qrData.publicUrl}`,
          });
        } else {
          await Share.share({
            title:
              qrData.qrValue,

            message:
              `Niah National Park Flora Record [${qrData.qrValue}]: ${qrData.publicUrl}`,
          });
        }
      } catch {
        Alert.alert(
          'Could not share',

          'The QR code could not be shared. Please try again.'
        );
      }
    };

  if (blocked) {
    return null;
  }

  /*
   * Invalid / missing record.
   */
  if (!record) {
    return (
      <SafeAreaView
        style={
          styles.safeArea
        }
      >
        <View
          style={
            styles.notFoundContainer
          }
        >
          <Text
            style={
              styles.title
            }
          >
            Plant not found
          </Text>

          <Text
            style={
              styles.subtitle
            }
          >
            The plant record for
            this tag operation is
            not available on this
            device.
          </Text>

          <TouchableOpacity
            style={
              styles.secondaryBtn
            }
            onPress={() =>
              router.back()
            }
          >
            <Text
              style={
                styles.secondaryBtnText
              }
            >
              Back
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={
        styles.safeArea
      }
    >
      <StatusBar
        barStyle="dark-content"
      />

      {/* Header */}

      <View
        style={
          styles.header
        }
      >
        <TouchableOpacity
          style={
            styles.backBtn
          }
          onPress={() =>
            router.back()
          }
        >
          <Text
            style={
              styles.backChevron
            }
          >
            ‹
          </Text>
        </TouchableOpacity>

        <Text
          style={
            styles.headerTitle
          }
        >
          Attach plant tag
        </Text>

        <View
          style={{
            width: 40,
          }}
        />
      </View>

      <FormScrollView
        contentContainerStyle={
          styles.container
        }
      >
        <Text
          style={
            styles.title
          }
        >
          Botanical Tag
        </Text>

        <Text
          style={
            styles.subtitle
          }
        >
          Attach a tag to{' '}

          <Text
            style={
              styles.plantName
            }
          >
            {record.scientificName ||
              'this plant (species not confirmed yet)'}
          </Text>
          .
        </Text>

        {/* =================================================
            SERVER GENERATED TAG + QR
            ================================================= */}

        <Text
          style={
            styles.sectionLabel
          }
        >
          SERVER TAG & QR
        </Text>

        {!record.serverId ? (
          <View
            style={
              styles.infoCard
            }
          >
            <Text
              style={
                styles.infoTitle
              }
            >
              Plant not uploaded yet
            </Text>

            <Text
              style={
                styles.infoText
              }
            >
              A server-generated
              tag and public QR are
              available after this
              plant is synced.
              You can still attach a
              pre-printed tag
              offline below.
            </Text>
          </View>
        ) : serverStatus ===
          'checking' ? (
          <View
            style={
              styles.serverCard
            }
          >
            <ActivityIndicator
              size="large"
              color="#2D6A4F"
            />

            <Text
              style={
                styles.serverLoadingTitle
              }
            >
              Generating tag & QR
            </Text>

            <Text
              style={
                styles.serverLoadingText
              }
            >
              {
                serverMessage
              }
            </Text>
          </View>
        ) : serverStatus ===
            'success' &&
          qrData ? (
          <View
            style={
              styles.qrCard
            }
          >
            <View
              style={
                styles.successBadge
              }
            >
              <Text
                style={
                  styles.successBadgeText
                }
              >
                ✓ Tag attached
              </Text>
            </View>

            <Text
              style={
                styles.tagCodeText
              }
            >
              {
                qrData.qrValue
              }
            </Text>

            <Text
              style={
                styles.qrSubText
              }
            >
              Scan to open the
              public visitor
              catalogue
            </Text>

            <View
              style={
                styles.qrFrame
              }
            >
              <Image
                source={{
                  uri:
                    qrData.imageDataUri,
                }}
                style={
                  styles.qrImage
                }
                resizeMode="contain"
              />
            </View>

            <View
              style={
                styles.urlContainer
              }
            >
              <Text
                style={
                  styles.urlLabel
                }
              >
                PUBLIC VISITOR LINK
              </Text>

              <Text
                style={
                  styles.urlText
                }
                numberOfLines={
                  1
                }
              >
                {
                  qrData.publicUrl
                }
              </Text>
            </View>

            <TouchableOpacity
              style={
                styles.shareBtn
              }
              onPress={() =>
                void handleShare()
              }
            >
              <Text
                style={
                  styles.shareBtnText
                }
              >
                Share QR / Link
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={
                styles.doneBtn
              }
              onPress={() =>
                router.back()
              }
            >
              <Text
                style={
                  styles.doneBtnText
                }
              >
                Done
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View
            style={[
              styles.infoCard,

              serverStatus ===
                'error' &&
                styles.errorCard,
            ]}
          >
            <Text
              style={[
                styles.infoTitle,

                serverStatus ===
                  'error' &&
                  styles.errorTitle,
              ]}
            >
              {serverStatus ===
              'idle'
                ? 'No printed tag? Generate a new one'
                : serverStatus ===
                  'offline'
                  ? 'Server unavailable'
                  : 'Could not generate QR'}
            </Text>

            <Text
              style={
                styles.infoText
              }
            >
              {serverStatus ===
              'idle'
                ? 'Best: scan one of your printed tags below. If you have none with you, the app can give this plant a new tag number now; then print its QR.'
                : serverMessage ||
                  'You can attach a pre-printed tag below.'}
            </Text>

            <TouchableOpacity
              style={
                styles.retryBtn
              }
              onPress={() =>
                void retryServerGeneration()
              }
            >
              <Text
                style={
                  styles.retryBtnText
                }
              >
                {serverStatus ===
                'idle'
                  ? 'Generate new tag'
                  : 'Retry online'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* =================================================
            OFFLINE / PRE-PRINTED TAG
            ================================================= */}

        {serverStatus !==
          'success' && (
          <>
            <Text
              style={
                styles.sectionLabel
              }
            >
              PRE-PRINTED TAG
            </Text>

            <Text
              style={
                styles.offlineHint
              }
            >
              This option works
              offline. Scan a
              physical NIAH tag or
              type its code. The
              change is stored on
              this phone first and
              syncs automatically
              after reconnecting.
            </Text>

            {/* Camera */}

            {permission?.granted ? (
              <View
                style={
                  styles.cameraBox
                }
              >
                <CameraView
                  style={
                    StyleSheet.absoluteFill
                  }
                  barcodeScannerSettings={{
                    barcodeTypes: [
                      'qr',
                    ],
                  }}
                  onBarcodeScanned={
                    scanned
                      ? undefined
                      : handleBarcodeScanned
                  }
                />

                <View
                  style={
                    styles.cameraOverlay
                  }
                >
                  <View
                    style={
                      styles.scanFrame
                    }
                  />
                </View>
              </View>
            ) : permission ===
              null ? (
              <View
                style={
                  styles.noCameraBox
                }
              >
                <ActivityIndicator
                  color="#213B2A"
                />

                <Text
                  style={
                    styles.noCameraText
                  }
                >
                  Checking camera
                  permission...
                </Text>
              </View>
            ) : (
              <View
                style={
                  styles.noCameraBox
                }
              >
                <Text
                  style={
                    styles.noCameraTitle
                  }
                >
                  Camera access is
                  off
                </Text>

                <Text
                  style={
                    styles.noCameraText
                  }
                >
                  You can type the
                  tag code below
                  instead.
                </Text>

                <TouchableOpacity
                  style={
                    styles.permissionBtn
                  }
                  onPress={() =>
                    void requestPermission()
                  }
                >
                  <Text
                    style={
                      styles.permissionBtnText
                    }
                  >
                    Allow camera
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Manual */}

            <Text
              style={
                styles.label
              }
            >
              Or type the tag code
            </Text>

            <TextInput
              style={[
                styles.input,

                manualError &&
                  styles.inputError,
              ]}
              placeholder="NIAH-PLT-00001"
              placeholderTextColor="#8C9A91"
              value={code}
              onChangeText={(
                value
              ) => {
                setCode(
                  value
                );

                if (
                  manualError
                ) {
                  setManualError(
                    null
                  );
                }
              }}
              autoCapitalize="characters"
              autoCorrect={
                false
              }
              returnKeyType="done"
              onSubmitEditing={() =>
                void handleManualAttach()
              }
            />

            {manualError && (
              <View
                style={
                  styles.manualErrorBox
                }
              >
                <Text
                  style={
                    styles.manualErrorText
                  }
                >
                  {
                    manualError
                  }
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={
                styles.primaryBtn
              }
              onPress={() =>
                void handleManualAttach()
              }
            >
              <Text
                style={
                  styles.primaryBtnText
                }
              >
                Attach tag
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={
                styles.secondaryBtn
              }
              onPress={() =>
                router.back()
              }
            >
              <Text
                style={
                  styles.secondaryBtnText
                }
              >
                Skip for now
              </Text>
            </TouchableOpacity>
          </>
        )}
      </FormScrollView>
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
      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'space-between',

      paddingHorizontal:
        16,

      paddingVertical:
        12,

      backgroundColor:
        '#FFFFFF',

      borderBottomWidth:
        1,

      borderBottomColor:
        '#E6ECE8',
    },

    backBtn: {
      width: 40,

      height: 40,

      borderRadius: 20,

      justifyContent:
        'center',

      alignItems:
        'center',

      backgroundColor:
        '#F0F4F1',
    },

    backChevron: {
      fontSize: 30,

      lineHeight: 32,

      color:
        '#213B2A',
    },

    headerTitle: {
      fontSize: 17,

      fontWeight:
        '800',

      color:
        '#213B2A',
    },

    container: {
      flexGrow: 1,

      padding: 20,

      paddingBottom:
        40,
    },

    notFoundContainer: {
      flex: 1,

      justifyContent:
        'center',

      padding: 24,
    },

    title: {
      fontSize: 25,

      fontWeight:
        '800',

      color:
        '#1E2B22',
    },

    subtitle: {
      fontSize: 13,

      color:
        '#68776D',

      marginTop: 5,

      marginBottom:
        18,

      lineHeight: 19,
    },

    plantName: {
      fontStyle:
        'italic',

      fontWeight:
        '700',

      color:
        '#213B2A',
    },

    sectionLabel: {
      fontSize: 11.5,

      fontWeight:
        '800',

      color:
        '#738177',

      letterSpacing:
        0.8,

      marginTop: 10,

      marginBottom:
        8,
    },

    infoCard: {
      backgroundColor:
        '#FFFFFF',

      borderRadius: 18,

      borderWidth:
        1.2,

      borderColor:
        '#E1E9E3',

      padding: 16,

      marginBottom:
        18,
    },

    errorCard: {
      backgroundColor:
        '#FFF8F8',

      borderColor:
        '#F0C2C2',
    },

    infoTitle: {
      fontSize: 14,

      fontWeight:
        '800',

      color:
        '#213B2A',

      marginBottom: 5,
    },

    errorTitle: {
      color:
        '#9B1C1C',
    },

    infoText: {
      fontSize: 12.5,

      color:
        '#68776D',

      lineHeight: 18,
    },

    retryBtn: {
      alignSelf:
        'flex-start',

      marginTop: 12,

      backgroundColor:
        '#E8EFEA',

      paddingVertical:
        8,

      paddingHorizontal:
        16,

      borderRadius: 18,
    },

    retryBtnText: {
      color:
        '#213B2A',

      fontSize: 12.5,

      fontWeight:
        '700',
    },

    serverCard: {
      backgroundColor:
        '#FFFFFF',

      borderRadius: 20,

      borderWidth:
        1.2,

      borderColor:
        '#E1E9E3',

      paddingVertical:
        26,

      paddingHorizontal:
        18,

      alignItems:
        'center',

      marginBottom:
        18,
    },

    serverLoadingTitle: {
      marginTop: 12,

      fontSize: 14,

      fontWeight:
        '800',

      color:
        '#213B2A',
    },

    serverLoadingText: {
      marginTop: 5,

      fontSize: 12,

      color:
        '#68776D',

      textAlign:
        'center',
    },

    qrCard: {
      backgroundColor:
        '#FFFFFF',

      borderRadius: 24,

      padding: 22,

      alignItems:
        'center',

      borderWidth: 1,

      borderColor:
        '#E6ECE8',

      marginBottom:
        20,
    },

    successBadge: {
      backgroundColor:
        '#ECFDF5',

      paddingHorizontal:
        12,

      paddingVertical:
        5,

      borderRadius: 14,

      marginBottom:
        10,
    },

    successBadgeText: {
      fontSize: 12,

      fontWeight:
        '800',

      color:
        '#065F46',
    },

    tagCodeText: {
      fontSize: 25,

      fontWeight:
        '900',

      color:
        '#213B2A',

      letterSpacing: 2,

      marginBottom: 4,
    },

    qrSubText: {
      fontSize: 12.5,

      color:
        '#76877B',

      marginBottom:
        18,
    },

    qrFrame: {
      padding: 12,

      backgroundColor:
        '#FFFFFF',

      borderRadius: 20,

      borderWidth:
        1.5,

      borderColor:
        '#D8E2DC',

      marginBottom:
        16,
    },

    qrImage: {
      width: 220,

      height: 220,
    },

    urlContainer: {
      width: '100%',

      backgroundColor:
        '#F8FAF8',

      padding: 12,

      borderRadius: 12,

      borderWidth: 1,

      borderColor:
        '#E6ECE8',

      marginBottom:
        14,

      alignItems:
        'center',
    },

    urlLabel: {
      fontSize: 10,

      color:
        '#76877B',

      fontWeight:
        '800',

      marginBottom: 2,
    },

    urlText: {
      fontSize: 12,

      color:
        '#2D6A4F',

      fontWeight:
        '600',
    },

    shareBtn: {
      width: '100%',

      height: 46,

      borderRadius: 23,

      borderWidth:
        1.5,

      borderColor:
        '#2D6A4F',

      justifyContent:
        'center',

      alignItems:
        'center',

      marginBottom:
        10,
    },

    shareBtnText: {
      color:
        '#2D6A4F',

      fontSize: 14,

      fontWeight:
        '700',
    },

    doneBtn: {
      width: '100%',

      height: 48,

      backgroundColor:
        '#213B2A',

      borderRadius: 24,

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    doneBtnText: {
      color:
        '#FFFFFF',

      fontSize: 14.5,

      fontWeight:
        '700',
    },

    offlineHint: {
      fontSize: 12,

      lineHeight: 18,

      color:
        '#68776D',

      marginBottom:
        12,
    },

    cameraBox: {
      height: 280,

      borderRadius: 20,

      overflow:
        'hidden',

      backgroundColor:
        '#000',

      marginBottom:
        20,

      position:
        'relative',
    },

    cameraOverlay: {
      ...StyleSheet.absoluteFill,

      justifyContent:
        'center',

      alignItems:
        'center',
    },

    scanFrame: {
      width: 190,

      height: 190,

      borderWidth: 2,

      borderColor:
        '#FFFFFF',

      borderRadius: 18,

      backgroundColor:
        'transparent',
    },

    noCameraBox: {
      padding: 18,

      borderRadius: 16,

      backgroundColor:
        '#FFFFFF',

      borderWidth:
        1.2,

      borderColor:
        '#E6ECE8',

      marginBottom:
        20,

      alignItems:
        'center',
    },

    noCameraTitle: {
      fontSize: 14,

      fontWeight:
        '800',

      color:
        '#213B2A',

      marginBottom: 4,
    },

    noCameraText: {
      fontSize: 13,

      color:
        '#68776D',

      textAlign:
        'center',
    },

    permissionBtn: {
      marginTop: 12,

      paddingVertical:
        8,

      paddingHorizontal:
        16,

      borderRadius: 18,

      backgroundColor:
        '#EDF3EE',
    },

    permissionBtnText: {
      color:
        '#213B2A',

      fontSize: 12.5,

      fontWeight:
        '700',
    },

    label: {
      fontSize: 12.5,

      fontWeight:
        '700',

      color:
        '#213B2A',

      marginBottom: 6,
    },

    input: {
      backgroundColor:
        '#FFFFFF',

      height: 50,

      borderRadius: 25,

      paddingHorizontal:
        18,

      fontSize: 14,

      color:
        '#1E2B22',

      borderWidth:
        1.2,

      borderColor:
        '#E6ECE8',

      marginBottom:
        12,
    },

    inputError: {
      borderColor:
        '#D98B8B',
    },

    manualErrorBox: {
      backgroundColor:
        '#FDF2F2',

      padding: 14,

      borderRadius: 16,

      marginBottom:
        12,
    },

    manualErrorText: {
      color:
        '#9B1C1C',

      fontSize: 12.5,

      lineHeight: 17,
    },

    primaryBtn: {
      backgroundColor:
        '#213B2A',

      height: 50,

      borderRadius: 25,

      justifyContent:
        'center',

      alignItems:
        'center',

      marginBottom:
        12,
    },

    primaryBtnText: {
      color: '#FFF',

      fontWeight:
        '700',

      fontSize: 14.5,
    },

    secondaryBtn: {
      height: 50,

      borderRadius: 25,

      justifyContent:
        'center',

      alignItems:
        'center',

      borderWidth:
        1.2,

      borderColor:
        '#213B2A',

      backgroundColor:
        '#FFF',
    },

    secondaryBtnText: {
      color:
        '#213B2A',

      fontWeight:
        '700',

      fontSize: 14.5,
    },
  });