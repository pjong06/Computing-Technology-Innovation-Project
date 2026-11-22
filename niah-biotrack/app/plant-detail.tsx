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
  Platform,
  ActivityIndicator,
  Share,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';

import { useRouter, useLocalSearchParams } from 'expo-router';
import Toast from 'react-native-toast-message';
import { Ionicons } from '@expo/vector-icons';

import {
  IdentificationStatus,
  RecordStatus,
  ReviewStatus,
  SyncStatus,
  useRecordStore,
  type ObservationVisit,
} from '../src/store/useRecordStore';

import { NOT_SUBMITTED_BADGE, REVIEW_BADGE, visitStatus } from '../src/utils/reviewStatus';
import { plantStatusLine, speciesSubtitle, type TagProblemCode } from '../src/utils/plantStatusLine';
import { requeueLockedTagOperations, resumePausedRecordRetries } from '../src/services/offlineDatabase';
import PlantNotFound from '../src/components/PlantNotFound';
import { resolveStoredPhotoUri } from '../src/utils/photoStorage';
import { formatCoordinates } from '../src/utils/formatCoordinates';
import { fetchPlantQr, type PlantQr } from '../src/api/plantQr';
import { downloadTagImage, saveFile, shareFile } from '../src/services/myTags';
import { ApiError, BASE_URL } from '../src/api/client';
import PlantThumbnail from '../src/components/PlantThumbnail';
import MiniPlantMap from '../src/components/MiniPlantMap';
import { thumbnailSources } from '../src/utils/thumbnailSources';
import { usePlantListStore } from '../src/store/usePlantListStore';
import { pickPlantDetails } from '../src/utils/plantDetails';
import { isPhysicalTag } from '../src/utils/myTags';
import { formatDiameterCm, formatHeightFromCm, parseMeasurement } from '../src/utils/units';
import { routeSyncLabel, routesUploadedText } from '../src/utils/routeSync';

const TAG_PROBLEM_TEXT: Record<TagProblemCode, string> = {
  in_use:
    'This tag is already attached to another plant. Check the tag, then attach the right one.',
  not_yours:
    "This tag isn't one of your reserved tags. Attach one of your own tags from My QR tags.",
  already_set:
    'This plant already has a physical tag on the server.',
  locked:
    "This plant can't be changed after submission, so the change was not saved on the server. It stays on this phone.",
};

const TAG_NOT_ON_SERVER_TEXT =
  "The new tag hasn't reached the server yet. Use Sync now on Home, then try again.";

// A plant without a real NIAH-PLT tag has no QR to show.
const NO_TAG_TEXT = 'No tag attached yet';

const NOT_RECORDED = 'Not recorded';

// The upload state as a chip (never the raw enum value): "Synced", "Not uploaded", or
// "Upload failed" (worth its own colour, the botanist needs to act on it).
function syncChip(status: SyncStatus | string | undefined): { label: string; bg: string; text: string } {
  switch (String(status ?? '').toLowerCase()) {
    case 'uploaded':
      return { label: 'Synced', bg: '#E4F2E7', text: '#215A36' };
    case 'failed':
    case 'upload failed':
      return { label: 'Upload failed', bg: '#FDE2E2', text: '#9B1C1C' };
    case 'syncing':
      return { label: 'Uploading', bg: '#E3ECF8', text: '#1F4E8C' };
    default:
      return { label: 'Not uploaded', bg: '#FDF4D8', text: '#8C5E03' };
  }
}

// The phone's latest height and diameter (cm): from the newest visit that has one,
// otherwise from what was typed when the plant was registered (height in m, diameter in cm).
function localHeightCm(record: { height?: string; observations: ObservationVisit[] }): number | null {
  const visit = record.observations.find((observation) => observation.heightCm !== undefined);
  if (typeof visit?.heightCm === 'number') return visit.heightCm;
  const typed = parseMeasurement(record.height);
  return typed === null ? null : Math.round(typed * 100);
}

function localDiameterCm(record: { diameter?: string; observations: ObservationVisit[] }): number | null {
  const visit = record.observations.find((observation) => observation.diameterCm !== undefined);
  if (typeof visit?.diameterCm === 'number') return visit.diameterCm;
  return parseMeasurement(record.diameter);
}

function observationChips(observation: ObservationVisit): string[] {
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

// The phone's newest observation health or life stage (as stored), or null.
function localCondition(visits: ObservationVisit[], field: 'health' | 'stage'): string | null {
  const newest = [...visits]
    .filter((visit) => Boolean(visit?.[field]))
    .sort((a, b) => Date.parse(b.observedAt || b.date || '') - Date.parse(a.observedAt || a.date || ''))[0];
  return newest?.[field] ? String(newest[field]) : null;
}

// Health or life stage in plain words ("seedling_sapling" -> "Seedling sapling").
function conditionText(value: string | null): string | null {
  const text = String(value ?? '').replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : null;
}

// A label and its value (wrapping, never clipped).
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

// One MEASUREMENTS tile: "—" when nothing is recorded.
function MeasureTile({ label, value }: { label: string; value: string | null | undefined }) {
  const text = value?.trim();
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, !text && styles.tileEmpty]}>{text || '—'}</Text>
    </View>
  );
}

export default function PlantDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const records = useRecordStore((state) => state.records);
  const submitForReview = useRecordStore((state) => state.submitForReview);
  const removePhoto = useRecordStore((state) => state.removePhoto);
  const deleteRecord = useRecordStore((state) => state.deleteRecord);
  const syncRoutes = useRecordStore((state) => state.syncRoutes);
  const syncRecord = useRecordStore((state) => state.syncRecord);

  const { width } = useWindowDimensions();

  // "Upload failed: <reason> · Retry": sends this plant again, including a tag the server
  // refused before tags could be attached after submission (now sent as a tag-only change).
  const [retryingUpload, setRetryingUpload] = useState(false);
  const retryUpload = async () => {
    const record = records.find((item) => item.id === id);
    if (!record) return;
    setRetryingUpload(true);
    try {
      await resumePausedRecordRetries(record.id, record.observations.map((visit) => visit.id));
      await requeueLockedTagOperations(record.id);
      const result = await syncRecord(record.id);
      Toast.show(
        result.ok
          ? { type: 'success', text1: 'Plant uploaded', position: 'bottom' }
          : { type: 'error', text1: 'Upload failed', text2: result.reason, position: 'bottom' }
      );
    } catch {
      Toast.show({ type: 'error', text1: 'Could not retry this plant. Please try again.', position: 'bottom' });
    } finally {
      setRetryingUpload(false);
    }
  };

  // Retry for a route that did not upload: runs the route upload only (not the plant sync).
  const [retryingRoute, setRetryingRoute] = useState(false);
  const retryRouteUpload = async () => {
    setRetryingRoute(true);
    try {
      const result = await syncRoutes();
      if (result.uploaded > 0 && result.failed === 0) {
        Alert.alert('Route uploaded', routesUploadedText(result.uploaded) + '.');
      }
    } finally {
      setRetryingRoute(false);
    }
  };

  const [photoIndex, setPhotoIndex] = useState(0);
  const [brokenPhotos, setBrokenPhotos] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [qrVisible, setQrVisible] = useState(false);
  const [qr, setQr] = useState<PlantQr | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');
  const [qrExporting, setQrExporting] = useState(false);

  const matched = records.find((record) => record.id === id);
  // The signed server thumbnail of an own plant (from the shared plant list), used when the
  // phone has no photo of it: the same picture its list row shows.
  // The server's details of this plant from the Plants list (approved plants), when the
  // phone has none of its own from the tag lookup.
  const listDetails = usePlantListStore((state) =>
    matched?.serverId ? state.detailsById[matched.serverId] ?? null : null
  );
  const signedThumbnail = usePlantListStore((state) =>
    matched && !matched.otherBotanist && matched.serverId ? state.ownThumbnails[matched.serverId] ?? null : null
  );
  const needsServerPhoto = Boolean(
    matched && !matched.otherBotanist && matched.serverId && (matched.photoUris ?? []).length === 0
  );
  useEffect(() => {
    // Opened without going through a list (e.g. after a scan): load the list once (reused if fresh).
    if (needsServerPhoto) void usePlantListStore.getState().load();
  }, [needsServerPhoto]);
  if (!matched) {
    return <PlantNotFound code={id} />;
  }

  const photos = (matched.photoUris ?? []).map(resolveStoredPhotoUri);

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
        label: `Observation ${observation.date}`,
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

    // A plant's QR is its printed tag; without a real NIAH-PLT tag there is none to show.
    if (!isPhysicalTag(matched.tagCode)) {
      Alert.alert(NO_TAG_TEXT, 'A QR code is made once a NIAH-PLT tag is attached to this plant.');
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
          ? error.code === 'no_tag'
            ? NO_TAG_TEXT // the server has no real tag for it (e.g. only a placeholder)
            : error.message
          : 'Could not load the QR code. Please try again.'
      );
    } finally {
      setQrLoading(false);
    }
  };

  // Save image / Share: the plant's QR label as a PNG (QR with the tag underneath), from
  // GET /api/plants/:id/qr/image (own plants, or any approved plant), the same label as in
  // My QR tags.
  const exportQr = async (action: 'save' | 'share') => {
    if (!qr || !matched?.serverId) return;
    setQrExporting(true);
    const image = await downloadTagImage(qr.qrValue, `/api/plants/${encodeURIComponent(matched.serverId)}/qr/image`);
    setQrExporting(false);
    if (!image.ok) {
      Alert.alert('No image', image.reason);
      return;
    }
    const result = action === 'save'
      ? await saveFile(image.file, 'image/png')
      : await shareFile(image.file, `${qr.qrValue}\n${qr.publicUrl}`);
    if (!result.ok) {
      Alert.alert(action === 'save' ? 'Not saved' : 'Not shared', result.reason);
    } else if (action === 'save') {
      Toast.show({ type: 'success', text1: 'QR image ready', text2: result.message, position: 'bottom' });
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

  // "This plant": the phone's values and the server's details of an approved plant, merged
  // (own plants: the phone first; someone else's: the server first; src/utils/plantDetails.ts).
  const visitsHere = matched.observations ?? [];
  const shown = pickPlantDetails(
    !matched.otherBotanist,
    {
      locationNote: matched.locationName === 'Location not recorded' ? null : matched.locationName,
      latitude: matched.latitude ?? null,
      longitude: matched.longitude ?? null,
      gpsAccuracyM: matched.gpsAccuracyM ?? null,
      morphology: matched.morphology ?? null,
      notes: matched.description ?? null,
      heightCm: localHeightCm({ ...matched, observations: visitsHere }),
      diameterCm: localDiameterCm({ ...matched, observations: visitsHere }),
      health: localCondition(visitsHere, 'health'),
      stage: localCondition(visitsHere, 'stage'),
    },
    matched.serverDetails ?? listDetails
  );
  const coordinates =
    shown.latitude !== null && shown.longitude !== null
      ? formatCoordinates(shown.latitude, shown.longitude, shown.gpsAccuracyM)
      : matched.gpsCoordination;

  const review =
    (matched.reviewStatus && REVIEW_BADGE[matched.reviewStatus]) || NOT_SUBMITTED_BADGE;

  const needsIdentification =
    matched.identificationStatus === IdentificationStatus.PENDING ||
    !matched.scientificName.trim();

  const canEdit =
    matched.reviewStatus === ReviewStatus.DRAFT ||
    matched.reviewStatus === ReviewStatus.REJECTED;

  // Delete (in the "⋯" menu): only the botanist's own plants that were never submitted.
  const canDelete =
    !matched.otherBotanist &&
    (matched.reviewStatus === ReviewStatus.DRAFT || !matched.reviewStatus);

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
                'Sent for review',
                'A Conservation Officer can now review this record.'
              );
              return;
            }

            const reason = result.sync.ok
              ? 'An observation was added while uploading and still needs to be sent.'
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
      'This record will be removed from this phone immediately. If it was already synced, the deletion will also be sent to the server automatically.',
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

  // Observations, newest first.
  const observations = [...visitsHere].sort(
    (a, b) => (Date.parse(b.observedAt || '') || 0) - (Date.parse(a.observedAt || '') || 0)
  );

  const recordObservation = () =>
    router.push({
      pathname: '/add-observation',
      params: {
        plantId: matched.id,
        tagCode: matched.tagCode ?? '',
        scientificName: matched.scientificName,
      },
    } as any);

  const openFindPlant = () =>
    router.push({
      pathname: '/navigate-plant',
      params: { plantId: matched.id },
    } as any);

  const openAttachTag = () =>
    router.push({
      pathname: '/attach-tag',
      params: {
        recordId: matched.id,
        plantId: matched.serverId || matched.id,
      },
    } as any);

  const hasCoordinates = shown.latitude !== null && shown.longitude !== null;
  // Own plants show "Not recorded" when there is no GPS fix; for someone else's plant the
  // coordinates appear only when the server lets this user see them (otherwise the row is hidden).
  const showCoordinatesRow = hasCoordinates || !matched.otherBotanist;

  const sharePlant = async () => {
    setMenuOpen(false);
    const lines = [
      matched.scientificName || 'Plant',
      matched.commonName?.trim() || null,
      isPhysicalTag(matched.tagCode) ? `Tag ${matched.tagCode}` : null,
      shown.locationNote ? `Location: ${shown.locationNote}` : null,
    ].filter(Boolean);
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // Closing the share sheet is not an error worth showing.
    }
  };

  const sync = syncChip(matched.syncStatus);
  const commonLine = speciesSubtitle(matched.scientificName, matched.commonName, matched.family);
  const statusLine = plantStatusLine(matched);
  const photoCount = photos.length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
        {/* Header photos: swipe; "1 of 2". */}
        <View style={styles.heroBox}>
          {photoCount > 0 ? (
            <FlatList
              data={photos}
              keyExtractor={(uri, index) => `${index}-${uri}`}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handlePhotoScroll}
              renderItem={({ item }) =>
                brokenPhotos[item] ? (
                  <View style={[styles.heroPhoto, styles.heroEmpty, { width }]}>
                    <Text style={styles.heroEmptyText}>Photo file is no longer on this device</Text>
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
          ) : (
            // No photo on this phone: the same sources, in the same order, as the list row
            // (its signed server thumbnail for an own plant; the public copy, full size then
            // the small one, for someone else's), otherwise the placeholder.
            <PlantThumbnail
              sources={thumbnailSources({
                signed: signedThumbnail,
                publicPath: matched.otherBotanist ? matched.publicPhotoUrl : null,
                baseUrl: BASE_URL,
                size: 'full',
              })}
              style={[styles.heroPhoto, { width }]}
              placeholder={
                <View style={[styles.heroPhoto, styles.heroEmpty, { width }]}>
                  <Ionicons name="leaf-outline" size={34} color="#9FB4A6" />
                  <Text style={styles.heroEmptyText}>No photos yet</Text>
                </View>
              }
            />
          )}

          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.heroButton, styles.heroButtonLeft]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setMenuOpen(true)}
            style={[styles.heroButton, styles.heroButtonRight]}
            accessibilityRole="button"
            accessibilityLabel="More actions"
            hitSlop={8}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          {photoCount > 1 && (
            <View style={styles.photoCountBadge}>
              <Text style={styles.photoCountText}>
                {Math.min(photoIndex + 1, photoCount)} of {photoCount}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.sheet}>
          {/* Title block */}
          <Text style={[styles.title, !needsIdentification && styles.titleItalic]}>
            {matched.scientificName || 'Identification pending'}
          </Text>
          {commonLine ? <Text style={styles.subtitle}>{commonLine}</Text> : null}

          <View style={styles.chipRow}>
            <View style={[styles.chip, { backgroundColor: review.bg }]}>
              <Text style={[styles.chipText, { color: review.text }]}>{review.label}</Text>
            </View>
            <View style={[styles.chip, styles.chipNeutral]}>
              <Ionicons name="pricetag-outline" size={12} color="#4A5A50" />
              <Text style={[styles.chipText, styles.chipNeutralText]}>
                {isPhysicalTag(matched.tagCode) ? matched.tagCode : 'No tag yet'}
              </Text>
            </View>
            <View style={[styles.chip, { backgroundColor: sync.bg }]}>
              <Text style={[styles.chipText, { color: sync.text }]}>{sync.label}</Text>
            </View>
          </View>

          {/* One status line from the real state: Waiting for review (on the server),
              Not uploaded yet, or Upload failed: <reason> · Retry. */}
          {statusLine ? (
            statusLine.kind === 'failed' ? (
              <View style={[styles.card, styles.tagProblemBox]} accessibilityRole="alert">
                <Text style={styles.tagProblemText}>{statusLine.text}</Text>
                <View style={styles.statusActions}>
                  <TouchableOpacity onPress={() => void retryUpload()} disabled={retryingUpload} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.tagProblemAction}>{retryingUpload ? 'Retrying…' : 'Retry'}</Text>
                  </TouchableOpacity>
                  {matched.tagProblem === 'in_use' || matched.tagProblem === 'not_yours' ? (
                    <TouchableOpacity onPress={openAttachTag} hitSlop={8} accessibilityRole="button">
                      <Text style={styles.tagProblemAction}>Attach a different tag</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : (
              <Text style={styles.lockedNote}>{statusLine.text}</Text>
            )
          ) : null}

          {/* Main actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={recordObservation}
              accessibilityRole="button"
            >
              <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
              <Text style={[styles.actionBtnText, styles.actionBtnPrimaryText]}>Record observation</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={openFindPlant} accessibilityRole="button">
              <Ionicons name="navigate-outline" size={17} color="#213B2A" />
              <Text style={styles.actionBtnText}>Find plant</Text>
            </TouchableOpacity>

            {/* A real tag: its QR (own plants, and other botanists' or imported approved
                plants). No tag yet (or only the "plant:<id>" placeholder): Attach tag on this
                botanist's own plant; on someone else's plant, just say so. */}
            {isPhysicalTag(matched.tagCode) ? (
              <TouchableOpacity style={styles.actionBtn} onPress={() => void openQr()}>
                <Ionicons name="qr-code-outline" size={17} color="#213B2A" />
                <Text style={styles.actionBtnText}>Show QR</Text>
              </TouchableOpacity>
            ) : matched.otherBotanist ? (
              <View style={[styles.actionBtn, styles.actionBtnMuted]} accessible accessibilityLabel={NO_TAG_TEXT}>
                <Text style={styles.actionBtnMutedText}>{NO_TAG_TEXT}</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.actionBtn} onPress={openAttachTag} accessibilityRole="button">
                <Ionicons name="pricetag-outline" size={17} color="#213B2A" />
                <Text style={styles.actionBtnText}>Attach tag</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Identification pending */}
          {needsIdentification && (
            <View style={styles.identificationCard}>
              <Text style={styles.identificationTitle}>Identification pending</Text>
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
                  <Text style={styles.continueBtnText}>Continue identification</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Officer's reason */}
          {matched.reviewStatus === ReviewStatus.REJECTED && (
            <View style={styles.commentBox}>
              <Text style={styles.commentTitle}>Officer's reason</Text>
              <Text style={styles.commentBody}>
                {matched.reviewComment?.trim() || 'No reason was given.'}
              </Text>
            </View>
          )}

          {/* Submit for review */}
          {canSubmit ? (
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
              <Text style={styles.submitBtnText}>
                {matched.reviewStatus === ReviewStatus.REJECTED ? 'Resubmit for review' : 'Submit for review'}
              </Text>
            </TouchableOpacity>
          ) : needsIdentification ? (
            <Text style={styles.lockedNote}>
              Confirm the species before submitting this record for officer review.
            </Text>
          ) : null}

          {/* MEASUREMENTS */}
          <Text style={styles.heading}>MEASUREMENTS</Text>
          <View style={styles.tileGrid}>
            <MeasureTile label="Height (m)" value={formatHeightFromCm(shown.heightCm)} />
            <MeasureTile label="Diameter (cm)" value={formatDiameterCm(shown.diameterCm)} />
            <MeasureTile label="Health" value={conditionText(shown.health)} />
            <MeasureTile label="Life stage" value={conditionText(shown.stage)} />
          </View>

          {/* LOCATION */}
          <Text style={styles.heading}>LOCATION</Text>
          <View style={styles.card}>
            {hasCoordinates ? (
              <TouchableOpacity
                onPress={openFindPlant}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Open Find plant"
                style={styles.miniMapWrap}
              >
                <MiniPlantMap latitude={shown.latitude as number} longitude={shown.longitude as number} />
              </TouchableOpacity>
            ) : null}
            <DetailRow label="Location note" value={shown.locationNote} />
            {showCoordinatesRow ? (
              <DetailRow label="Coordinates" value={hasCoordinates ? coordinates : null} />
            ) : null}
          </View>

          {/* FIELD NOTES (hidden when both are empty) */}
          {shown.morphology || shown.notes ? (
            <>
              <Text style={styles.heading}>FIELD NOTES</Text>
              <View style={styles.card}>
                {shown.morphology ? (
                  <View style={styles.noteBlock}>
                    <Text style={styles.noteLabel}>Morphology</Text>
                    <Text style={styles.body}>{shown.morphology}</Text>
                  </View>
                ) : null}
                {shown.notes ? (
                  <View style={styles.noteBlock}>
                    <Text style={styles.noteLabel}>Notes</Text>
                    <Text style={styles.body}>{shown.notes}</Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}

          {/* Photos that can't upload (too large, locked, missing): explain and offer Remove. */}
          {photoProblems.length > 0 || untypedCount > 0 ? (
            <>
              <Text style={styles.heading}>PHOTOS</Text>
              <View style={styles.card}>
                <Text style={styles.photoSummary}>
                  {photoStates.length} on this phone · {uploadedPhotoCount} uploaded
                </Text>
                {untypedCount > 0 && (
                  <Text style={styles.photoNote}>
                    {untypedCount} older {untypedCount === 1 ? 'photo stays' : 'photos stay'} on this phone only.
                  </Text>
                )}
                {photoProblems.map((photo) => (
                  <View key={photo.uri} style={styles.photoProblemRow}>
                    <View style={styles.flexText}>
                      <Text style={styles.photoProblemLabel}>{photo.label}</Text>
                      <Text style={styles.photoProblemText}>
                        {photo.meta?.problem === 'too_large'
                          ? "Over 5 MB, so it can't be uploaded. Remove it so the rest can upload."
                          : photo.meta?.problem === 'locked'
                          ? "Photos can't be added after submission. It stays on this phone."
                          : 'The photo file is no longer on this phone.'}
                      </Text>
                    </View>
                    {photo.meta?.problem !== 'locked' && (
                      <TouchableOpacity onPress={() => confirmRemovePhoto(photo.uri, photo.obsId)} hitSlop={8}>
                        <Text style={styles.photoRemove}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {/* OBSERVATIONS, newest first */}
          <View style={styles.obsHeaderRow}>
            <Text style={[styles.heading, styles.flexText]}>OBSERVATIONS</Text>
            {observations.length > 0 ? (
              <Text style={styles.obsCount}>
                {observations.length} {observations.length === 1 ? 'observation' : 'observations'}
              </Text>
            ) : null}
          </View>

          {observations.length === 0 ? (
            <View style={[styles.card, styles.emptyObs]}>
              <Text style={styles.emptyObsTitle}>No observations yet</Text>
              <Text style={styles.emptyObsText}>Record an observation each time you check this plant.</Text>
              <TouchableOpacity style={styles.emptyObsBtn} onPress={recordObservation} accessibilityRole="button">
                <Text style={styles.emptyObsBtnText}>+ Record first observation</Text>
              </TouchableOpacity>
            </View>
          ) : (
            observations.map((observation) => {
              // Each observation's review status and the officer's reason if it was sent back.
              const status = visitStatus(observation, matched.syncError);
              const chips = observationChips(observation);
              return (
                <View key={observation.id} style={[styles.card, styles.obsCard]}>
                  <View style={styles.obsCardTop}>
                    <Text style={[styles.obsDate, styles.flexText]}>{observation.date}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: status.badge.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: status.badge.text }]}>
                        {status.badge.label}
                      </Text>
                    </View>
                  </View>
                  {observation.recordedBy ? <Text style={styles.obsAuthor}>{observation.recordedBy}</Text> : null}
                  {status.reason ? <Text style={styles.obsReason}>{status.reason}</Text> : null}
                  {chips.length > 0 ? (
                    <View style={styles.pillGroup}>
                      {chips.map((chip) => (
                        <View key={chip} style={styles.tagPill}>
                          <Text style={styles.tagPillText}>{chip}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {observation.notes ? <Text style={styles.obsNotes}>{observation.notes}</Text> : null}
                  {observation.photoUris && observation.photoUris.length > 0 ? (
                    <Text style={styles.obsPhotos}>
                      📷 {observation.photoUris.length} {observation.photoUris.length === 1 ? 'photo' : 'photos'}
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}

          <View style={{ height: 32 }} />
        </View>
      </ScrollView>

      {/* "⋯" menu: the rarer actions */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuSheet}>
            {matched.speciesId ? (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  router.push({ pathname: '/new-record', params: { speciesId: matched.speciesId } } as any);
                }}
                accessibilityRole="button"
              >
                <Ionicons name="add-outline" size={20} color="#213B2A" />
                <Text style={styles.menuText}>Add plant of this species</Text>
              </TouchableOpacity>
            ) : null}
            {!matched.otherBotanist ? (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  openAttachTag();
                }}
                accessibilityRole="button"
              >
                <Ionicons name="pricetag-outline" size={20} color="#213B2A" />
                <Text style={styles.menuText}>{isPhysicalTag(matched.tagCode) ? 'Change tag' : 'Attach tag'}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.menuItem} onPress={() => void sharePlant()} accessibilityRole="button">
              <Ionicons name="share-outline" size={20} color="#213B2A" />
              <Text style={styles.menuText}>Share</Text>
            </TouchableOpacity>
            {canDelete ? (
              <TouchableOpacity
                style={styles.menuItem}
                disabled={deleting}
                onPress={() => {
                  setMenuOpen(false);
                  handleDelete();
                }}
                accessibilityRole="button"
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#B42318" />
                ) : (
                  <Ionicons name="trash-outline" size={20} color="#B42318" />
                )}
                <Text style={[styles.menuText, styles.menuDanger]}>Delete record</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[styles.menuItem, styles.menuCancel]} onPress={() => setMenuOpen(false)}>
              <Text style={[styles.menuText, styles.menuCancelText]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

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
              <ActivityIndicator size="large" color="#213B2A" style={{ marginVertical: 80 }} />
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
                <Text style={styles.qrHint}>Scanning it opens the plant's public visitor page.</Text>
                <View style={styles.qrActions}>
                  <TouchableOpacity
                    style={[styles.qrPrimary, styles.qrAction, qrExporting && { opacity: 0.6 }]}
                    onPress={() => void exportQr('save')}
                    disabled={qrExporting}
                    accessibilityRole="button"
                  >
                    {qrExporting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.qrPrimaryText}>Save image</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.qrPrimary, styles.qrAction, qrExporting && { opacity: 0.6 }]}
                    onPress={() => void exportQr('share')}
                    disabled={qrExporting}
                    accessibilityRole="button"
                  >
                    <Text style={styles.qrPrimaryText}>Share</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <Text style={styles.qrError}>{qrError || 'Could not load the QR code.'}</Text>
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

            <TouchableOpacity style={styles.qrSecondary} onPress={() => setQrVisible(false)}>
              <Text style={styles.qrSecondaryText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Text never overflows: every Text in a row can shrink and wrap (flexShrink: 1, minWidth: 0),
// buttons grow taller instead of clipping (minHeight, not height), and chips wrap to a new line.
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6' },
  flexText: { flex: 1, flexShrink: 1, minWidth: 0 },

  heroBox: { height: 260, backgroundColor: '#2B3A30', position: 'relative' },
  heroPhoto: { height: 260 },
  heroEmpty: { justifyContent: 'center', alignItems: 'center', gap: 6 },
  heroEmptyText: { color: '#DCE4DF', fontSize: 13.5, fontWeight: '600', textAlign: 'center', paddingHorizontal: 24 },
  heroButton: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 36 : 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroButtonLeft: { left: 16 },
  heroButtonRight: { right: 16 },
  photoCountBadge: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  photoCountText: { color: '#FFF', fontSize: 12, fontWeight: '700' },

  sheet: { padding: 20, backgroundColor: '#F6F8F6' },
  title: { fontSize: 24, fontWeight: '800', color: '#1E2B22', flexShrink: 1 },
  titleItalic: { fontStyle: 'italic' },
  subtitle: { fontSize: 14, color: '#526659', marginTop: 4, flexShrink: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  chipText: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  chipNeutral: { backgroundColor: '#EEF1EF' },
  chipNeutralText: { color: '#4A5A50' },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  tagProblemBox: { marginTop: 12, paddingVertical: 10 },
  statusActions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 },
  tagProblemText: { fontSize: 12.5, color: '#9B1C1C', lineHeight: 17, flexShrink: 1 },
  tagProblemAction: { fontSize: 12.5, fontWeight: '700', color: '#213B2A', textDecorationLine: 'underline', marginTop: 6 },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#FFFFFF',
    minHeight: 46,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#DCE4DF',
  },
  actionBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 14, flexShrink: 1, textAlign: 'center' },
  actionBtnPrimary: { backgroundColor: '#213B2A', borderColor: '#213B2A', minHeight: 50 },
  actionBtnPrimaryText: { color: '#FFFFFF', fontSize: 15 },
  actionBtnMuted: { backgroundColor: '#F1F4F2', borderStyle: 'dashed' },
  actionBtnMutedText: { color: '#68776D', fontWeight: '600', fontSize: 13, flexShrink: 1, textAlign: 'center' },

  identificationCard: {
    backgroundColor: '#FDF4D8',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#F2D98C',
    padding: 14,
    marginTop: 14,
  },
  identificationTitle: { fontSize: 14, fontWeight: '800', color: '#7A5200' },
  identificationText: { fontSize: 12.5, color: '#6A5730', lineHeight: 18, marginTop: 4 },
  continueBtn: {
    backgroundColor: '#213B2A',
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  continueBtnText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '700', textAlign: 'center' },
  commentBox: {
    backgroundColor: '#FDF2F2',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#F5C9C9',
    padding: 14,
    marginTop: 14,
  },
  commentTitle: { fontSize: 12, fontWeight: '800', color: '#9B1C1C', marginBottom: 4 },
  commentBody: { fontSize: 13.5, color: '#1E2B22', lineHeight: 19 },
  submitBtn: {
    backgroundColor: '#213B2A',
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 14,
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700', textAlign: 'center' },
  lockedNote: { fontSize: 12.5, color: '#68776D', marginTop: 12, lineHeight: 18 },

  heading: {
    fontSize: 12,
    fontWeight: '800',
    color: '#6A7D71',
    letterSpacing: 0.8,
    marginTop: 22,
    marginBottom: 8,
  },
  body: { fontSize: 13.5, color: '#2B392F', lineHeight: 20 },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  tileLabel: { fontSize: 12, color: '#68776D', fontWeight: '600' },
  tileValue: { fontSize: 18, fontWeight: '800', color: '#1E2B22', marginTop: 4, flexShrink: 1 },
  tileEmpty: { color: '#98A69D' },

  miniMapWrap: { marginTop: 10, marginBottom: 4 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6ECE8',
    gap: 12,
  },
  detailLabel: { fontSize: 13, color: '#68776D', flexShrink: 0, maxWidth: '45%' },
  detailValue: { flex: 1, minWidth: 0, flexShrink: 1, textAlign: 'right', fontSize: 13.5, fontWeight: '600', color: '#1E2B22' },
  detailEmpty: { color: '#98A69D', fontStyle: 'italic', fontWeight: '400' },

  noteBlock: { paddingVertical: 10 },
  noteLabel: { fontSize: 12, fontWeight: '700', color: '#68776D', marginBottom: 4 },

  photoSummary: { fontSize: 13, fontWeight: '700', color: '#1E2B22', paddingVertical: 8 },
  photoNote: { fontSize: 12, color: '#68776D', paddingBottom: 8 },
  photoProblemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#EEF2EF',
  },
  photoProblemLabel: { fontSize: 12.5, fontWeight: '700', color: '#1E2B22' },
  photoProblemText: { fontSize: 12, color: '#9B1C1C', marginTop: 2 },
  photoRemove: { fontSize: 12.5, fontWeight: '700', color: '#9B1C1C', textDecorationLine: 'underline' },

  obsHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  obsCount: { fontSize: 12, color: '#68776D', fontWeight: '600', marginTop: 14, flexShrink: 0 },
  obsCard: { paddingVertical: 12, marginBottom: 10 },
  obsCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  obsDate: { fontSize: 13.5, fontWeight: '700', color: '#1E2B22' },
  statusBadge: { flexShrink: 1, maxWidth: '55%', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 12 },
  statusBadgeText: { fontSize: 11.5, fontWeight: '700', flexShrink: 1 },
  obsAuthor: { fontSize: 12, color: '#7E8F83', marginTop: 2 },
  obsReason: { fontSize: 12.5, fontWeight: '600', color: '#9B1C1C', marginTop: 6, lineHeight: 17 },
  pillGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tagPill: { maxWidth: '100%', backgroundColor: '#EDF5EF', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8 },
  tagPillText: { fontSize: 11.5, fontWeight: '700', color: '#213B2A', flexShrink: 1 },
  obsNotes: { fontSize: 13, color: '#3A483E', lineHeight: 18, marginTop: 8 },
  obsPhotos: { fontSize: 12, color: '#526659', fontWeight: '600', marginTop: 6 },
  emptyObs: { alignItems: 'center', paddingVertical: 18, paddingHorizontal: 16 },
  emptyObsTitle: { fontSize: 15, fontWeight: '800', color: '#1E2B22', textAlign: 'center' },
  emptyObsText: { fontSize: 13, color: '#68776D', marginTop: 4, textAlign: 'center', lineHeight: 18 },
  emptyObsBtn: {
    marginTop: 12,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: '#213B2A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyObsBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, textAlign: 'center' },


  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  menuSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingBottom: 24,
    paddingHorizontal: 12,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingVertical: 12, paddingHorizontal: 10 },
  menuText: { fontSize: 15, fontWeight: '600', color: '#1E2B22', flexShrink: 1 },
  menuDanger: { color: '#B42318' },
  menuCancel: { justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E6ECE8', marginTop: 4 },
  menuCancelText: { color: '#526659', textAlign: 'center' },

  qrBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  qrCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, alignItems: 'center' },
  qrTag: { fontSize: 22, fontWeight: '800', color: '#1E2B22', marginTop: 14, letterSpacing: 1, textAlign: 'center' },
  qrHint: { fontSize: 12.5, color: '#68776D', marginTop: 4, textAlign: 'center' },
  qrError: { fontSize: 14, color: '#9B1C1C', textAlign: 'center', marginVertical: 24 },
  qrPrimary: {
    backgroundColor: '#213B2A',
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 24,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
  },
  qrActions: { flexDirection: 'row', alignSelf: 'stretch', gap: 10 },
  qrAction: { flex: 1, minWidth: 0, alignSelf: 'auto' },
  qrPrimaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, textAlign: 'center', flexShrink: 1 },
  qrSecondary: { minHeight: 44, alignSelf: 'stretch', justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  qrSecondaryText: { color: '#213B2A', fontWeight: '700', fontSize: 14 },
});
