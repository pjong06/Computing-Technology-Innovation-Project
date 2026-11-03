import React, { useState } from 'react';
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

const NOT_RECORDED = 'Not recorded';

function formatHeight(height?: string) {
  const value = height?.trim();
  if (!value) return NOT_RECORDED;
  return /^\d+(\.\d+)?$/.test(value) ? `${value} m` : value;
}

// Labelled chips for one visit. Values that weren't recorded get no chip at all.
function visitChips(obs: ObservationVisit): string[] {
  const chips: string[] = [];
  if (obs.health) chips.push(`Health: ${obs.health}`);
  if (obs.stage) chips.push(`Stage: ${obs.stage}`);
  if (obs.heightCm !== undefined || obs.diameterCm !== undefined) {
    // Visits from the 3-step screen store centimetres; height reads better in metres.
    if (obs.heightCm !== undefined) chips.push(`Height ${Number((obs.heightCm / 100).toFixed(2))} m`);
    if (obs.diameterCm !== undefined) chips.push(`Diameter ${obs.diameterCm} cm`);
  } else {
    // Older visits only have the free-text "height / diameter" (e.g. "0.62 m").
    const measurement = obs.measurement?.trim();
    if (measurement && measurement !== NOT_RECORDED) chips.push(`Height / diameter ${measurement}`);
  }
  return chips;
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  const text = value?.trim();
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, !text && styles.detailEmpty]}>{text || NOT_RECORDED}</Text>
    </View>
  );
}

export default function PlantDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const records = useRecordStore((state) => state.records);
  const submitForReview = useRecordStore((state) => state.submitForReview);
  const { width } = useWindowDimensions();
  const [photoIndex, setPhotoIndex] = useState(0);
  const [brokenPhotos, setBrokenPhotos] = useState<Record<string, boolean>>({});

  const matched = records.find((r) => r.id === id);

  if (!matched) {
    return <PlantNotFound code={id} />;
  }

  const photos = (matched.photoUris ?? []).map(resolveStoredPhotoUri);

  const coordinates =
    matched.latitude !== undefined && matched.longitude !== undefined
      ? formatCoordinates(matched.latitude, matched.longitude, matched.gpsAccuracyM ?? null)
      : matched.gpsCoordination;

  // Safe fallback to prevent crash if reviewStatus is undefined on local record
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
    matched.reviewStatus === ReviewStatus.DRAFT || matched.reviewStatus === ReviewStatus.REJECTED;
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
            } else if (result.sync.ok && result.sync.submittedForReview) {
              Alert.alert('Submitted to officer review', 'A Conservation Officer can now review this record.');
            } else {
              // Submitted on the phone, but it didn't fully reach the officer queue.
              // Nothing is lost: the next Sync now or Retry finishes the job.
              const reason = result.sync.ok
                ? 'A visit was added while uploading and still needs to be sent.' // rare
                : result.sync.reason;
              Alert.alert(
                'Saved, not uploaded yet',
                `${reason}\n\nThe record is kept on this phone. Use Sync now or Retry when you have a connection.`
              );
            }
          },
        },
      ]
    );
  };

  const handlePhotoScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPhotoIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
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
                  <View style={[styles.heroPhoto, styles.heroEmpty, { width }]}>
                    <Text style={styles.heroEmptyText}>Photo file is no longer on this device</Text>
                  </View>
                ) : (
                  <Image
                    source={{ uri: item }}
                    style={[styles.heroPhoto, { width }]}
                    resizeMode="cover"
                    onError={() => setBrokenPhotos((prev) => ({ ...prev, [item]: true }))}
                  />
                )
              }
            />
          ) : (
            <View style={[styles.heroPhoto, styles.heroEmpty, { width }]}>
              <Text style={styles.heroEmptyText}>No photos recorded</Text>
            </View>
          )}
          <TouchableOpacity onPress={() => router.back()} style={styles.backCircle}>
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

        <View style={styles.sheet}>
          <Text style={styles.title}>
            {matched.scientificName || 'Identification pending'}
          </Text>

          <View style={styles.statusRow}>
            <View style={[styles.statusPill, { backgroundColor: review.bg }]}>
              <Text style={[styles.statusPillText, { color: review.text }]}>{review.label}</Text>
            </View>
            <Text style={styles.syncText}>{matched.syncStatus}</Text>
          </View>

          {needsIdentification && (
            <View style={styles.identificationCard}>
              <Text style={styles.identificationTitle}>Identification pending</Text>
              <Text style={styles.identificationText}>
                Photos, GPS and field information are stored on this device. Continue editing when
                you can confirm an approved species.
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

          {matched.reviewStatus === ReviewStatus.REJECTED && (
            <View style={styles.commentBox}>
              <Text style={styles.commentTitle}>Officer's comment</Text>
              <Text style={styles.commentBody}>
                {matched.reviewComment?.trim() || 'No comment was given.'}
              </Text>
            </View>
          )}

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
              Confirm the species before submitting this record for officer review.
            </Text>
          ) : matched.reviewStatus === ReviewStatus.PENDING ? (
            <Text style={styles.lockedNote}>
              {matched.syncStatus === SyncStatus.UPLOADED
                ? 'Waiting for a Conservation Officer to review it.'
                : 'Submitted. It will go to an officer when it uploads.'}
            </Text>
          ) : null}

          <Text style={styles.heading}>SPECIES DETAILS</Text>
          <View style={styles.detailCard}>
            <DetailRow label="Common name" value={matched.commonName} />
            <DetailRow label="Family" value={matched.family} />
            <DetailRow label="Height / diameter" value={formatHeight(matched.height)} />
            <DetailRow label="Plant tag" value={matched.tagCode ?? 'No tag attached'} />
          </View>

          <Text style={styles.heading}>MORPHOLOGICAL CHARACTERISTICS</Text>
          <Text style={[styles.body, !matched.morphology?.trim() && styles.detailEmpty]}>
            {matched.morphology?.trim() || NOT_RECORDED}
          </Text>

          <Text style={styles.heading}>NOTES</Text>
          <Text style={[styles.body, !matched.description?.trim() && styles.detailEmpty]}>
            {matched.description?.trim() || NOT_RECORDED}
          </Text>

          <Text style={styles.heading}>LOCATION</Text>
          <View style={styles.detailCard}>
            <DetailRow label="Location landmark" value={matched.locationName} />
            <DetailRow label="Coordinates" value={coordinates} />
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => router.push({ pathname: '/offline-map', params: { id: matched.id } } as any)}
            >
              <Text style={styles.actionBtnText}>🧭 Navigate</Text>
            </TouchableOpacity>
            {matched.tagCode ? (
              <View style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>🏷️ {matched.tagCode}</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() =>
                  router.push({
                    pathname: '/attach-tag',
                    params: { recordId: matched.id },
                  } as any)
                }
              >
                <Text style={styles.actionBtnText}>🏷️ Attach tag</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Observation Visits Timeline */}
          <View style={styles.obsHeaderRow}>
            <Text style={styles.heading}>OBSERVATION HISTORY</Text>
            <Text style={styles.obsCount}>{(matched.observations ?? []).length} visits</Text>
          </View>

          {(matched.observations ?? []).map((obs) => (
            <View key={obs.id} style={styles.timelineItem}>
              <View style={styles.timelineLine} />
              <View style={styles.timelineDot} />
              <View style={styles.obsCard}>
                <View style={styles.obsCardTop}>
                  <Text style={styles.obsDate}>{obs.date}</Text>
                  <Text
                    style={[
                      styles.obsStatus,
                      obs.syncStatus === SyncStatus.NOT_UPLOADED && { color: '#8C5E03' },
                    ]}
                  >
                    • {obs.syncStatus}
                  </Text>
                </View>
                <Text style={styles.obsAuthor}>{obs.recordedBy}</Text>
                {(() => {
                  const chips = visitChips(obs);
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
                {obs.notes ? <Text style={styles.obsNotes}>{obs.notes}</Text> : null}
                {obs.photoUris && obs.photoUris.length > 0 ? (
                  <Text style={styles.obsPhotos}>
                    📷 {obs.photoUris.length} {obs.photoUris.length === 1 ? 'photo' : 'photos'}
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
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6' },
  heroBox: { height: 260, backgroundColor: '#2B3A30', position: 'relative' },
  heroPhoto: { height: 260 },
  heroEmpty: { justifyContent: 'center', alignItems: 'center' },
  heroEmptyText: { color: '#DCE4DF', fontSize: 13.5, fontWeight: '600' },
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
  detailLabel: { fontSize: 13, color: '#68776D' },
  detailValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 13.5,
    fontWeight: '600',
    color: '#1E2B22',
  },
  detailEmpty: { color: '#98A69D', fontStyle: 'italic', fontWeight: '400' },
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
  photoCountText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  sheet: { padding: 22, backgroundColor: '#F6F8F6' },
  title: { fontSize: 24, fontWeight: '800', color: '#1E2B22' },
  heading: {
    fontSize: 12,
    fontWeight: '800',
    color: '#6A7D71',
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 6,
  },
  body: { fontSize: 13.5, color: '#2B392F', lineHeight: 20 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 18 },
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
  actionBtnText: { color: '#213B2A', fontWeight: '700', fontSize: 13.5 },
  obsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  obsCount: { fontSize: 12, color: '#68776D', fontWeight: '600' },
  timelineItem: { position: 'relative', paddingLeft: 24, marginBottom: 16 },
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
  obsCardTop: { flexDirection: 'row', justifyContent: 'space-between' },
  obsDate: { fontSize: 13, fontWeight: '700', color: '#1E2B22' },
  obsStatus: { fontSize: 11, fontWeight: '700', color: '#215A36' },
  obsAuthor: { fontSize: 11.5, color: '#7E8F83', marginTop: 2 },
  // Wraps onto a second line instead of pushing chips past the card edge.
  pillGroup: { flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 },
  tagPill: {
    backgroundColor: '#EDF5EF',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginRight: 6,
    marginBottom: 6,
  },
  tagPillText: { fontSize: 11, fontWeight: '700', color: '#213B2A' },
  obsNotes: { fontSize: 12.5, color: '#3A483E', lineHeight: 18, marginTop: 2 },
  obsPhotos: { fontSize: 11.5, color: '#526659', fontWeight: '600', marginTop: 6 },
  addObsBtn: {
    backgroundColor: '#213B2A',
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 30,
  },
  addObsBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14.5 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 12 },
  statusPill: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 16 },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  syncText: { fontSize: 12, color: '#68776D', fontWeight: '600' },
  commentBox: {
    backgroundColor: '#FDF2F2',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#F5C9C9',
    padding: 14,
    marginBottom: 12,
  },
  commentTitle: { fontSize: 12, fontWeight: '800', color: '#9B1C1C', marginBottom: 4 },
  commentBody: { fontSize: 13.5, color: '#1E2B22', lineHeight: 19 },
  submitBtn: {
    backgroundColor: '#213B2A',
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  lockedNote: { fontSize: 12.5, color: '#68776D', marginBottom: 8 },
  identificationCard: {
    backgroundColor: '#FDF4D8',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#F2D98C',
    padding: 14,
    marginBottom: 12,
  },
  identificationTitle: { fontSize: 14, fontWeight: '800', color: '#7A5200' },
  identificationText: { fontSize: 12.5, color: '#6A5730', lineHeight: 18, marginTop: 4 },
  continueBtn: {
    backgroundColor: '#213B2A',
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  continueBtnText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '700' },
});
