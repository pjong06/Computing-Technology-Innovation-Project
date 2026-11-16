import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Alert,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  FlatList,
  Image,
  Modal,
  Share,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';

import { useRouter, useLocalSearchParams } from 'expo-router';

import {
  IdentificationStatus,
  RecordStatus,
  ReviewStatus,
  SyncStatus,
  useRecordStore,
  type ObservationVisit,
} from '../src/store/useRecordStore';

import { REVIEW_BADGE } from '../src/utils/reviewStatus';
import PlantNotFound from '../src/components/PlantNotFound';
import { resolveStoredPhotoUri } from '../src/utils/photoStorage';
import { formatCoordinates } from '../src/utils/formatCoordinates';
import { fetchPlantQr, saveQrImage, type PlantQr } from '../src/api/plantQr';
import { ApiError } from '../src/api/client';
import { formatDiameterCm, formatHeightFromCm, parseMeasurement } from '../src/utils/units';
import { useSpeciesStore } from '../src/store/useSpeciesStore';
import SpeciesPhotoCredit from '../src/components/SpeciesPhotoCredit';
import { preferredSpeciesPhoto } from '../src/utils/speciesPhoto';

const TAG_PROBLEM_TEXT: Record<'in_use' | 'locked', string> = {
  in_use:
    'This tag is already attached to another plant. Check the tag, then attach the right one.',
  locked:
    "This plant can't be changed after submission, so the tag was not saved on the server. It stays on this phone.",
};

const TAG_NOT_ON_SERVER_TEXT =
  "The new tag hasn't reached the server yet. Use Sync now on Home, then try again.";

const NOT_RECORDED = 'Not recorded';

// The plant's latest measured height and diameter: from the newest visit that has one
// (stored in cm), otherwise from what was typed when the plant was registered
// (height in m, diameter in cm). Height is shown in metres, diameter in centimetres.
function latestHeight(record: { height?: string; observations: ObservationVisit[] }): string {
  const visit = record.observations.find((observation) => observation.heightCm !== undefined);
  const fromVisit = formatHeightFromCm(visit?.heightCm);
  if (fromVisit) return fromVisit;
  const typed = parseMeasurement(record.height);
  return typed === null ? NOT_RECORDED : `${typed} m`;
}

function latestDiameter(record: { diameter?: string; observations: ObservationVisit[] }): string {
  const visit = record.observations.find((observation) => observation.diameterCm !== undefined);
  const fromVisit = formatDiameterCm(visit?.diameterCm);
  if (fromVisit) return fromVisit;
  return formatDiameterCm(parseMeasurement(record.diameter)) ?? NOT_RECORDED;
}

function visitChips(observation: ObservationVisit): string[] {
  const chips: string[] = [];

  if (observation.health) {
    chips.push(`Health: ${observation.health}`);
  }

  if (observation.stage) {
    chips.push(`Stage: ${observation.stage}`);
  }

  if (
    observation.heightCm !== undefined ||
    observation.diameterCm !== undefined
  ) {
    const height = formatHeightFromCm(observation.heightCm);
    if (height) {
      chips.push(`Height ${height}`);
    }

    const diameter = formatDiameterCm(observation.diameterCm);
    if (diameter) {
      chips.push(`Diameter ${diameter}`);
    }
  } else {
    const measurement = observation.measurement?.trim();
    if (measurement && measurement !== NOT_RECORDED) {
      chips.push(`Height / diameter ${measurement}`);
    }
  }

  return chips;
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  const text = value?.trim();

  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, !text && styles.detailEmpty]}>
        {text || NOT_RECORDED}
      </Text>
    </View>
  );
}

export default function PlantDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const records = useRecordStore((state) => state.records);
  const routes = useRecordStore((state) => state.routes);
  const submitForReview = useRecordStore((state) => state.submitForReview);
  const removePhoto = useRecordStore((state) => state.removePhoto);
  const deleteRecord = useRecordStore((state) => state.deleteRecord);

  const { width } = useWindowDimensions();

  const [photoIndex, setPhotoIndex] = useState(0);
  const [brokenPhotos, setBrokenPhotos] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState(false);

  const [qrVisible, setQrVisible] = useState(false);
  const [qr, setQr] = useState<PlantQr | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');

  const matched = records.find((record) => record.id === id);
  const speciesId = matched?.speciesId ?? null;
  const speciesImageUri = useSpeciesStore((state) =>
    speciesId ? state.imageUrisBySpeciesId[speciesId] : undefined
  );
  const speciesMedia = useSpeciesStore((state) =>
    speciesId ? state.detailsById[speciesId]?.species_media : undefined
  );
  const loadSpeciesDetail = useSpeciesStore((state) => state.loadSpeciesDetail);

  useEffect(() => {
    if (speciesId && !matched?.photoUris?.length) {
      void loadSpeciesDetail(speciesId);
    }
  }, [loadSpeciesDetail, matched?.photoUris?.length, speciesId]);

  if (!matched) {
    return <PlantNotFound code={id} />;
  }

  const linkedRoute = routes.find(
    (route) =>
      route.linkedPlantId === matched.id ||
      (matched.serverId && route.linkedPlantId === matched.serverId)
  );

  const displayRouteLength =
    matched.routeLength ??
    (linkedRoute
      ? linkedRoute.distanceMeters >= 1000
        ? `${(linkedRoute.distanceMeters / 1000).toFixed(2)} km`
        : `${Math.round(linkedRoute.distanceMeters)} m`
      : undefined);

  const displayWalkingTime =
    matched.walkingTime ??
    (linkedRoute
      ? `${Math.max(1, Math.round(linkedRoute.durationSeconds / 60))} min`
      : undefined);

  const photos = (matched.photoUris ?? []).map(resolveStoredPhotoUri);
  const speciesFallbackKey = `species:${speciesId || ''}`;
  const speciesFallbackUri =
    photos.length === 0 && speciesImageUri && !brokenPhotos[speciesFallbackKey]
      ? speciesImageUri
      : null;
  const speciesPhotoCredit = preferredSpeciesPhoto(speciesMedia);

  const PHOTO_LABELS: Record<string, string> = {
    whole_plant: 'Whole plant',
    leaf: 'Leaf',
    flower: 'Flower',
    bark: 'Bark',
    field_photo: 'Field photo',
  };

  const photoStates = [
    ...(matched.photoUris ?? []).map((uri) => {
      const meta = matched.photoMeta?.[uri];
      return {
        uri,
        meta,
        obsId: undefined as string | undefined,
        label: meta?.type ? PHOTO_LABELS[meta.type] || 'Photo' : 'Photo',
      };
    }),
    ...(matched.observations ?? []).flatMap((observation) =>
      (observation.photoUris ?? []).map((uri) => ({
        uri,
        meta: observation.photoMeta?.[uri],
        obsId: observation.id,
        label: `Visit ${observation.date}`,
      }))
    ),
  ];

  const uploadedPhotoCount = photoStates.filter(
    (photo) => photo.meta?.uploaded
  ).length;

  const untypedCount = photoStates.filter(
    (photo) => !photo.obsId && !photo.meta?.type
  ).length;

  const photoProblems = photoStates.filter(
    (photo) => photo.meta?.problem && !photo.meta.uploaded
  );

  const openQr = async () => {
    if (!matched.serverId) {
      Alert.alert(
        'Sync this plant first',
        'The QR code is made by the server, so this plant has to be uploaded first.'
      );
      return;
    }

    if (matched.tagProblem) {
      Alert.alert(
        'No QR code for this tag',
        TAG_PROBLEM_TEXT[matched.tagProblem]
      );
      return;
    }

    setQrVisible(true);

    if (qr && qr.qrValue === matched.tagCode) {
      return;
    }

    setQr(null);
    setQrLoading(true);
    setQrError('');

    try {
      const result = await fetchPlantQr(matched.serverId);

      if (matched.tagCode && result.qrValue !== matched.tagCode) {
        setQrError(TAG_NOT_ON_SERVER_TEXT);
        return;
      }

      setQr(result);
    } catch (error) {
      setQrError(
        error instanceof ApiError
          ? error.message
          : 'Could not load the QR code. Please try again.'
      );
    } finally {
      setQrLoading(false);
    }
  };

  const shareQr = async () => {
    if (!qr) return;

    try {
      if (Platform.OS === 'ios') {
        const fileUri = await saveQrImage(qr);
        await Share.share({
          url: fileUri,
          message: qr.qrValue,
        });
      } else {
        await Share.share({
          title: qr.qrValue,
          message: `${qr.qrValue}\n${qr.publicUrl}`,
        });
      }
    } catch {
      Alert.alert(
        'Could not share',
        'The QR code could not be shared. Please try again.'
      );
    }
  };

  const confirmRemovePhoto = (uri: string, obsId?: string) => {
    Alert.alert(
      'Remove this photo?',
      'It is deleted from this phone. The other photos can then upload.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removePhoto(matched.id, uri, obsId),
        },
      ]
    );
  };

  const coordinates =
    matched.latitude !== undefined && matched.longitude !== undefined
      ? formatCoordinates(
          matched.latitude,
          matched.longitude,
          matched.gpsAccuracyM ?? null
        )
      : matched.gpsCoordination;

  const review =
    (matched.reviewStatus && REVIEW_BADGE[matched.reviewStatus]) || {
      bg: '#E4F2E7',
      text: '#215A36',
      label: 'Draft',
    };

  const needsIdentification =
    matched.identificationStatus === IdentificationStatus.PENDING ||
    !matched.scientificName.trim();

  const canEdit =
    matched.reviewStatus === ReviewStatus.DRAFT ||
    matched.reviewStatus === ReviewStatus.REJECTED;

  const canDelete = true;

  const canSubmit =
    canEdit &&
    matched.recordStatus === RecordStatus.COMPLETE &&
    matched.identificationStatus === IdentificationStatus.IDENTIFIED &&
    Boolean(matched.speciesId);

  const handleSubmit = () => {
    Alert.alert(
      'Submit for review?',
      "A Conservation Officer will check this record. You can't change it while it is waiting for review.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            const result = await submitForReview(matched.id);

            if (!result.ok) {
              Alert.alert('Could not submit', result.reason);
              return;
            }

            if (result.sync.ok && result.sync.submittedForReview) {
              Alert.alert(
                'Submitted to officer review',
                'A Conservation Officer can now review this record.'
              );
              return;
            }

            const reason = result.sync.ok
              ? 'A visit was added while uploading and still needs to be sent.'
              : result.sync.reason;

            Alert.alert(
              'Saved, not uploaded yet',
              `${reason}\n\nThe review request is safely stored on this phone and will retry automatically when the connection returns.`
            );
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete plant record?',
      'This record will be removed from this phone immediately. If it was already synchronized, the deletion will also be sent to the server automatically.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const result = await deleteRecord(matched.id);
              if (!result.ok) {
                Alert.alert('Could not delete record', result.reason);
                return;
              }
              router.replace('/(tabs)/records' as any);
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const handlePhotoScroll = (
    event: NativeSyntheticEvent<NativeScrollEvent>
  ) => {
    setPhotoIndex(
      Math.round(event.nativeEvent.contentOffset.x / width)
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
        {/* Photos Carousel */}
        <View style={styles.heroBox}>
          {photos.length > 0 ? (
            <FlatList
              data={photos}
              keyExtractor={(uri, index) => `${index}-${uri}`}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handlePhotoScroll}
              renderItem={({ item }) =>
                brokenPhotos[item] ? (
                  <View
                    style={[
                      styles.heroPhoto,
                      styles.heroEmpty,
                      { width },
                    ]}
                  >
                    <Text style={styles.heroEmptyText}>
                      Photo file is no longer on this device
                    </Text>
                  </View>
                ) : (
                  <Image
                    source={{ uri: item }}
                    style={[styles.heroPhoto, { width }]}
                    resizeMode="cover"
                    onError={() =>
                      setBrokenPhotos((previous) => ({
                        ...previous,
                        [item]: true,
                      }))
                    }
                  />
                )
              }
            />
          ) : speciesFallbackUri ? (
            <Image
              source={{ uri: speciesFallbackUri }}
              style={[styles.heroPhoto, { width }]}
              resizeMode="cover"
              onError={() =>
                setBrokenPhotos((previous) => ({
                  ...previous,
                  [speciesFallbackKey]: true,
                }))
              }
            />
          ) : (
            <View
              style={[
                styles.heroPhoto,
                styles.heroEmpty,
                { width },
              ]}
            >
              <Text style={styles.heroEmptyText}>No photos recorded</Text>
            </View>
          )}

          {speciesFallbackUri ? (
            <View style={styles.speciesPhotoBadge}>
              <Text style={styles.speciesPhotoBadgeText}>Species photo</Text>
            </View>
          ) : null}

          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backCircle}
          >
            <Text style={{ color: '#FFF', fontSize: 24 }}>‹</Text>
          </TouchableOpacity>

          {photos.length > 0 && (
            <View style={styles.photoCountBadge}>
              <Text style={styles.photoCountText}>
                {Math.min(photoIndex + 1, photos.length)} / {photos.length}
              </Text>
            </View>
          )}
        </View>

        {speciesFallbackUri && speciesPhotoCredit?.source === 'inaturalist' ? (
          <View style={styles.speciesPhotoCredit}>
            <SpeciesPhotoCredit photo={speciesPhotoCredit} />
          </View>
        ) : null}

        <View style={styles.sheet}>
          <Text style={styles.title}>
            {matched.scientificName || 'Identification pending'}
          </Text>

          {/* Record Status */}
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusPill,
                { backgroundColor: review.bg },
              ]}
            >
              <Text style={[styles.statusPillText, { color: review.text }]}>
                {review.label}
              </Text>
            </View>
            <Text style={styles.syncText}>{matched.syncStatus}</Text>
          </View>

          {/* Identification Pending Notice */}
          {needsIdentification && (
            <View style={styles.identificationCard}>
              <Text style={styles.identificationTitle}>
                Identification pending
              </Text>
              <Text style={styles.identificationText}>
                Photos, GPS and field information are stored on this device.
                Continue editing when you can confirm an approved species.
              </Text>
              {canEdit && (
                <TouchableOpacity
                  style={styles.continueBtn}
                  onPress={() =>
                    router.push({
                      pathname: '/new-record',
                      params: { editId: matched.id },
                    } as any)
                  }
                >
                  <Text style={styles.continueBtnText}>
                    Continue identification
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Officer Rejection Comment */}
          {matched.reviewStatus === ReviewStatus.REJECTED && (
            <View style={styles.commentBox}>
              <Text style={styles.commentTitle}>Officer's comment</Text>
              <Text style={styles.commentBody}>
                {matched.reviewComment?.trim() || 'No comment was given.'}
              </Text>
            </View>
          )}

          {/* Submit Review Action */}
          {canSubmit ? (
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
              <Text style={styles.submitBtnText}>
                {matched.reviewStatus === ReviewStatus.REJECTED
                  ? 'Resubmit for review'
                  : 'Submit for review'}
              </Text>
            </TouchableOpacity>
          ) : needsIdentification ? (
            <Text style={styles.lockedNote}>
              Confirm the species before submitting this record for officer
              review.
            </Text>
          ) : matched.reviewStatus === ReviewStatus.PENDING ? (
            <Text style={styles.lockedNote}>
              {matched.syncStatus === SyncStatus.UPLOADED
                ? 'Waiting for a Conservation Officer to review it.'
                : 'Submitted. It will go to an officer automatically when connectivity is available.'}
            </Text>
          ) : null}

          {/* Species Details: Split Height and Diameter */}
          <Text style={styles.heading}>SPECIES DETAILS</Text>

          <View style={styles.detailCard}>
            <DetailRow label="Common name" value={matched.commonName} />
            <DetailRow label="Family" value={matched.family} />
            <DetailRow
              label="Height (m)"
              value={latestHeight(matched)}
            />
            <DetailRow
              label="Diameter (cm)"
              value={latestDiameter(matched)}
            />
            <DetailRow
              label="Plant tag"
              value={matched.tagCode ?? 'No tag attached'}
            />

            {matched.tagProblem ? (
              <View style={styles.tagProblemBox}>
                <Text style={styles.tagProblemText}>
                  {TAG_PROBLEM_TEXT[matched.tagProblem]}
                </Text>
                {matched.tagProblem === 'in_use' ? (
                  <TouchableOpacity
                    onPress={() =>
                      router.push({
                        pathname: '/attach-tag',
                        params: {
                          recordId: matched.id,
                          plantId: matched.serverId || matched.id,
                        },
                      } as any)
                    }
                    hitSlop={8}
                  >
                    <Text style={styles.tagProblemAction}>
                      Attach a different tag
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>

          <Text style={styles.heading}>MORPHOLOGICAL CHARACTERISTICS</Text>
          <Text
            style={[
              styles.body,
              !matched.morphology?.trim() && styles.detailEmpty,
            ]}
          >
            {matched.morphology?.trim() || NOT_RECORDED}
          </Text>

          <Text style={styles.heading}>NOTES</Text>
          <Text
            style={[
              styles.body,
              !matched.description?.trim() && styles.detailEmpty,
            ]}
          >
            {matched.description?.trim() || NOT_RECORDED}
          </Text>

          {/* Location Landmark & GPS Coordinates */}
          <Text style={styles.heading}>LOCATION</Text>
          <View style={styles.detailCard}>
            <DetailRow
              label="Location landmark"
              value={matched.locationName}
            />
            <DetailRow label="Coordinates" value={coordinates} />
            {(displayRouteLength || displayWalkingTime) && (
              <>
                <DetailRow
                  label="Transect distance"
                  value={displayRouteLength}
                />
                <DetailRow
                  label="Walking time"
                  value={displayWalkingTime}
                />
              </>
            )}
          </View>

          {/* Photos Upload Status */}
          {photoStates.length > 0 && (
            <>
              <Text style={styles.heading}>PHOTOS</Text>
              <View style={styles.detailCard}>
                <Text style={styles.photoSummary}>
                  {photoStates.length} on this phone · {uploadedPhotoCount} uploaded
                </Text>

                {untypedCount > 0 && (
                  <Text style={styles.photoNote}>
                    {untypedCount} older{' '}
                    {untypedCount === 1 ? 'photo stays' : 'photos stay'} on this
                    phone only.
                  </Text>
                )}

                {photoProblems.map((photo) => (
                  <View key={photo.uri} style={styles.photoProblemRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.photoProblemLabel}>
                        {photo.label}
                      </Text>
                      <Text style={styles.photoProblemText}>
                        {photo.meta?.problem === 'too_large'
                          ? "Over 5 MB, so it can't be uploaded. Remove it so the rest can upload."
                          : photo.meta?.problem === 'locked'
                          ? "Photos can't be added after submission. It stays on this phone."
                          : 'The photo file is no longer on this phone.'}
                      </Text>
                    </View>

                    {photo.meta?.problem !== 'locked' && (
                      <TouchableOpacity
                        onPress={() => confirmRemovePhoto(photo.uri, photo.obsId)}
                        hitSlop={8}
                      >
                        <Text style={styles.photoRemove}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Navigation and QR Plaque Actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() =>
                router.push({
                  pathname: '/offline-map',
                  params: { id: matched.id },
                } as any)
              }
            >
              <Text style={styles.actionBtnText}>🧭 Find plant</Text>
            </TouchableOpacity>

            {matched.tagCode ? (
              <TouchableOpacity style={styles.actionBtn} onPress={() => void openQr()}>
                <Text style={styles.actionBtnText}>🔳 Show QR</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() =>
                  router.push({
                    pathname: '/attach-tag',
                    params: {
                      recordId: matched.id,
                      plantId: matched.serverId || matched.id,
                    },
                  } as any)
                }
              >
                <Text style={styles.actionBtnText}>🏷️ Attach tag</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Observation Visits History */}
          <View style={styles.obsHeaderRow}>
            <Text style={styles.heading}>OBSERVATION HISTORY</Text>
            <Text style={styles.obsCount}>
              {(matched.observations ?? []).length} visits
            </Text>
          </View>

          {(matched.observations ?? []).map((observation) => (
            <View key={observation.id} style={styles.timelineItem}>
              <View style={styles.timelineLine} />
              <View style={styles.timelineDot} />
              <View style={styles.obsCard}>
                <View style={styles.obsCardTop}>
                  <Text style={styles.obsDate}>{observation.date}</Text>
                  <Text
                    style={[
                      styles.obsStatus,
                      observation.syncStatus === SyncStatus.NOT_UPLOADED && {
                        color: '#8C5E03',
                      },
                      observation.syncStatus === SyncStatus.FAILED && {
                        color: '#B42318',
                      },
                    ]}
                  >
                    • {observation.syncStatus}
                  </Text>
                </View>

                <Text style={styles.obsAuthor}>{observation.recordedBy}</Text>

                {(() => {
                  const chips = visitChips(observation);
                  return chips.length > 0 ? (
                    <View style={styles.pillGroup}>
                      {chips.map((chip) => (
                        <View key={chip} style={styles.tagPill}>
                          <Text style={styles.tagPillText}>{chip}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null;
                })()}

                {observation.notes ? (
                  <Text style={styles.obsNotes}>{observation.notes}</Text>
                ) : null}

                {observation.photoUris && observation.photoUris.length > 0 ? (
                  <Text style={styles.obsPhotos}>
                    📷 {observation.photoUris.length}{' '}
                    {observation.photoUris.length === 1 ? 'photo' : 'photos'}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}

          <TouchableOpacity
            style={styles.addObsBtn}
            onPress={() =>
              router.push({
                pathname: '/add-observation',
                params: {
                  plantId: matched.id,
                  tagCode: matched.tagCode ?? '',
                  scientificName: matched.scientificName,
                },
              } as any)
            }
          >
            <Text style={styles.addObsBtnText}>+ Add observation</Text>
          </TouchableOpacity>

          {/* Delete Record */}
          {canDelete && (
            <TouchableOpacity
              style={[
                styles.deleteBtn,
                deleting && styles.deleteBtnDisabled,
              ]}
              disabled={deleting}
              onPress={handleDelete}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#B42318" />
              ) : (
                <Text style={styles.deleteBtnText}>Delete record</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* QR Plaque Modal */}
      <Modal
        visible={qrVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setQrVisible(false)}
      >
        <View style={styles.qrBackdrop}>
          <View style={styles.qrCard}>
            {qrLoading ? (
              <ActivityIndicator
                size="large"
                color="#213B2A"
                style={{ marginVertical: 80 }}
              />
            ) : qr ? (
              <>
                <Image
                  source={{ uri: qr.imageDataUri }}
                  style={{
                    width: Math.min(width - 96, 320),
                    height: Math.min(width - 96, 320),
                  }}
                  resizeMode="contain"
                  accessibilityLabel={`QR code for ${qr.qrValue}`}
                />
                <Text style={styles.qrTag}>{qr.qrValue}</Text>
                <Text style={styles.qrHint}>
                  Scanning it opens the plant's public visitor page.
                </Text>
                <TouchableOpacity style={styles.qrPrimary} onPress={() => void shareQr()}>
                  <Text style={styles.qrPrimaryText}>Share</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.qrError}>
                {qrError || 'Could not load the QR code.'}
              </Text>
            )}

            {!qrLoading && !qr && (
              <TouchableOpacity
                style={styles.qrPrimary}
                onPress={() => {
                  setQrVisible(false);
                  void openQr();
                }}
              >
                <Text style={styles.qrPrimaryText}>Try again</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.qrSecondary}
              onPress={() => setQrVisible(false)}
            >
              <Text style={styles.qrSecondaryText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tagProblemBox: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#EEF2EF',
  },
  tagProblemText: {
    fontSize: 12,
    color: '#9B1C1C',
    lineHeight: 17,
  },
  tagProblemAction: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#213B2A',
    textDecorationLine: 'underline',
    marginTop: 6,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
  },
  heroBox: {
    height: 260,
    backgroundColor: '#2B3A30',
    position: 'relative',
  },
  heroPhoto: {
    height: 260,
  },
  heroEmpty: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroEmptyText: {
    color: '#DCE4DF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  backCircle: {
    position: 'absolute',
    top: 30,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoCountBadge: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  photoCountText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  speciesPhotoBadge: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  speciesPhotoBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  speciesPhotoCredit: {
    paddingHorizontal: 22,
    paddingTop: 4,
    backgroundColor: '#F6F8F6',
  },
  sheet: {
    padding: 22,
    backgroundColor: '#F6F8F6',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1E2B22',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 12,
  },
  statusPill: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  syncText: {
    fontSize: 12,
    color: '#68776D',
    fontWeight: '600',
  },
  heading: {
    fontSize: 12,
    fontWeight: '800',
    color: '#6A7D71',
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 6,
  },
  body: {
    fontSize: 13.5,
    color: '#2B392F',
    lineHeight: 20,
  },
  detailCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    paddingHorizontal: 14,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6ECE8',
    gap: 12,
  },
  detailLabel: {
    fontSize: 13,
    color: '#68776D',
  },
  detailValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 13.5,
    fontWeight: '600',
    color: '#1E2B22',
  },
  detailEmpty: {
    color: '#98A69D',
    fontStyle: 'italic',
    fontWeight: '400',
  },
  identificationCard: {
    backgroundColor: '#FDF4D8',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#F2D98C',
    padding: 14,
    marginBottom: 12,
  },
  identificationTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#7A5200',
  },
  identificationText: {
    fontSize: 12.5,
    color: '#6A5730',
    lineHeight: 18,
    marginTop: 4,
  },
  continueBtn: {
    backgroundColor: '#213B2A',
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  continueBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  commentBox: {
    backgroundColor: '#FDF2F2',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#F5C9C9',
    padding: 14,
    marginBottom: 12,
  },
  commentTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#9B1C1C',
    marginBottom: 4,
  },
  commentBody: {
    fontSize: 13.5,
    color: '#1E2B22',
    lineHeight: 19,
  },
  submitBtn: {
    backgroundColor: '#213B2A',
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  lockedNote: {
    fontSize: 12.5,
    color: '#68776D',
    marginBottom: 8,
  },
  photoSummary: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E2B22',
    paddingVertical: 6,
  },
  photoNote: {
    fontSize: 12,
    color: '#68776D',
    paddingBottom: 6,
  },
  photoProblemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#EEF2EF',
  },
  photoProblemLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1E2B22',
  },
  photoProblemText: {
    fontSize: 12,
    color: '#9B1C1C',
    marginTop: 2,
  },
  photoRemove: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#9B1C1C',
    textDecorationLine: 'underline',
    marginLeft: 12,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 18,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#DCE4DF',
    marginHorizontal: 4,
  },
  actionBtnText: {
    color: '#213B2A',
    fontWeight: '700',
    fontSize: 13.5,
  },
  obsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  obsCount: {
    fontSize: 12,
    color: '#68776D',
    fontWeight: '600',
  },
  timelineItem: {
    position: 'relative',
    paddingLeft: 24,
    marginBottom: 16,
  },
  timelineLine: {
    position: 'absolute',
    left: 6,
    top: 12,
    bottom: -12,
    width: 2,
    backgroundColor: '#D6E2DA',
  },
  timelineDot: {
    position: 'absolute',
    left: 2,
    top: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#213B2A',
  },
  obsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
  },
  obsCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  obsDate: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E2B22',
  },
  obsStatus: {
    fontSize: 11,
    fontWeight: '700',
    color: '#215A36',
  },
  obsAuthor: {
    fontSize: 11.5,
    color: '#7E8F83',
    marginTop: 2,
  },
  pillGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginVertical: 8,
  },
  tagPill: {
    backgroundColor: '#EDF5EF',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginRight: 6,
    marginBottom: 6,
  },
  tagPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#213B2A',
  },
  obsNotes: {
    fontSize: 12.5,
    color: '#3A483E',
    lineHeight: 18,
    marginTop: 2,
  },
  obsPhotos: {
    fontSize: 11.5,
    color: '#526659',
    fontWeight: '600',
    marginTop: 6,
  },
  addObsBtn: {
    backgroundColor: '#213B2A',
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 16,
  },
  addObsBtnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14.5,
  },
  deleteBtn: {
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.4,
    borderColor: '#C62828',
    backgroundColor: '#FFF5F5',
    marginBottom: 34,
  },
  deleteBtnDisabled: {
    opacity: 0.55,
  },
  deleteBtnText: {
    color: '#B42318',
    fontSize: 14,
    fontWeight: '800',
  },
  qrBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 24,
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  qrTag: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1E2B22',
    marginTop: 14,
    letterSpacing: 1,
  },
  qrHint: {
    fontSize: 12.5,
    color: '#68776D',
    marginTop: 4,
    textAlign: 'center',
  },
  qrError: {
    fontSize: 14,
    color: '#9B1C1C',
    textAlign: 'center',
    marginVertical: 24,
  },
  qrPrimary: {
    backgroundColor: '#213B2A',
    height: 48,
    borderRadius: 24,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
  },
  qrPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  qrSecondary: {
    height: 44,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  qrSecondaryText: {
    color: '#213B2A',
    fontWeight: '700',
    fontSize: 14,
  },
});