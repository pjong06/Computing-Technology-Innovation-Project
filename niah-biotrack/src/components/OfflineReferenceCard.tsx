import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useSpeciesStore } from '../store/useSpeciesStore';

export default function OfflineReferenceCard() {
  const species = useSpeciesStore((state) => state.species);
  const detailsById = useSpeciesStore((state) => state.detailsById);
  const imageUrisBySpeciesId = useSpeciesStore(
    (state) => state.imageUrisBySpeciesId
  );
  const downloading = useSpeciesStore(
    (state) => state.offlinePackDownloading
  );
  const processed = useSpeciesStore((state) => state.offlinePackProcessed);
  const total = useSpeciesStore((state) => state.offlinePackTotal);
  const detailFailures = useSpeciesStore(
    (state) => state.offlinePackDetailFailures
  );
  const photoFailures = useSpeciesStore(
    (state) => state.offlinePackPhotoFailures
  );
  const lastCompletedAt = useSpeciesStore(
    (state) => state.offlinePackLastCompletedAt
  );
  const downloadError = useSpeciesStore(
    (state) => state.offlinePackError
  );
  const downloadOfflineReference = useSpeciesStore(
    (state) => state.downloadOfflineReference
  );

  const cachedDetailCount = species.filter(
    (item) => detailsById[item.id]
  ).length;
  const cachedPhotoCount = species.filter(
    (item) => imageUrisBySpeciesId[item.id]
  ).length;
  const expectedPhotoCount = species.filter(
    (item) => (detailsById[item.id]?.species_media.length ?? 0) > 0
  ).length;
  const missingPhotoCount = Math.max(
    0,
    expectedPhotoCount - cachedPhotoCount
  );
  const ready =
    species.length > 0 &&
    cachedDetailCount === species.length &&
    missingPhotoCount === 0;

  const lastUpdatedText = lastCompletedAt
    ? new Date(lastCompletedAt).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.headingText}>
          <Text style={styles.title}>Offline reference</Text>
          <Text style={styles.description}>
            Download species details and available photos before entering the
            field.
          </Text>
        </View>
        <View style={[styles.badge, ready && styles.readyBadge]}>
          <Text style={[styles.badgeText, ready && styles.readyBadgeText]}>
            {downloading ? 'Downloading' : ready ? 'Ready' : 'Not complete'}
          </Text>
        </View>
      </View>

      <Text style={styles.summary}>
        {species.length} species · {cachedDetailCount} details ·{' '}
        {cachedPhotoCount}
        {expectedPhotoCount > 0 ? `/${expectedPhotoCount}` : ''} photos
      </Text>

      {downloading && (
        <View style={styles.progressRow}>
          <ActivityIndicator size="small" color="#213B2A" />
          <Text style={styles.progressText}>
            Downloading {processed} of {total} species...
          </Text>
        </View>
      )}

      {!downloading && lastUpdatedText && (
        <Text style={styles.updatedText}>
          Last offline download: {lastUpdatedText}
        </Text>
      )}

      {!downloading && (detailFailures > 0 || photoFailures > 0) && (
        <Text style={styles.warningText}>
          Incomplete download: {detailFailures} detail failure
          {detailFailures === 1 ? '' : 's'} and {photoFailures} photo failure
          {photoFailures === 1 ? '' : 's'}. You can retry safely.
        </Text>
      )}

      {!downloading &&
        photoFailures === 0 &&
        missingPhotoCount > 0 && (
          <Text style={styles.warningText}>
            {missingPhotoCount} available reference photo
            {missingPhotoCount === 1 ? '' : 's'} still need to be downloaded.
          </Text>
        )}

      {!downloading && downloadError && (
        <Text style={styles.warningText}>{downloadError}</Text>
      )}

      <TouchableOpacity
        style={[styles.button, downloading && styles.buttonDisabled]}
        activeOpacity={0.8}
        disabled={downloading}
        onPress={() => void downloadOfflineReference()}
      >
        <Text style={styles.buttonText}>
          {downloading
            ? 'Downloading offline reference...'
            : ready
              ? 'Update offline reference'
              : 'Download for offline use'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#EEF5F0',
    borderWidth: 1,
    borderColor: '#D5E3D9',
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  headingText: { flex: 1 },
  title: {
    color: '#213B2A',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 3,
  },
  description: {
    color: '#5B6B60',
    fontSize: 11.5,
    lineHeight: 16,
  },
  badge: {
    backgroundColor: '#FFF4D6',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  readyBadge: { backgroundColor: '#DDEEE2' },
  badgeText: {
    color: '#7A5A13',
    fontSize: 10.5,
    fontWeight: '800',
  },
  readyBadgeText: { color: '#215A36' },
  summary: {
    color: '#213B2A',
    fontSize: 12.5,
    fontWeight: '700',
    marginTop: 11,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 9,
  },
  progressText: { color: '#4E6254', fontSize: 11.5 },
  updatedText: { color: '#68776D', fontSize: 11, marginTop: 7 },
  warningText: {
    color: '#8A5C20',
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 8,
  },
  button: {
    minHeight: 42,
    borderRadius: 21,
    backgroundColor: '#46654F',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' },
});
