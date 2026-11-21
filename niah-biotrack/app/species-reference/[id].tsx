import React, { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSpeciesStore } from '../../src/store/useSpeciesStore';
import { plantPhotoCaption } from '../../src/utils/plantPhotoCaption';

const STATUS_LABELS: Record<string, string> = {
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
  DD: 'Data Deficient',
};

interface SectionProps {
  title: string;
  value: string | null | undefined;
}

function ReferenceSection({ title, value }: SectionProps) {
  if (!value?.trim()) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.bodyText}>{value.trim()}</Text>
    </View>
  );
}

export default function SpeciesReferenceDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const listItem = useSpeciesStore((state) =>
    id ? state.species.find((item) => item.id === id) : undefined
  );
  const detail = useSpeciesStore((state) =>
    id ? state.detailsById[id] : undefined
  );
  const loading = useSpeciesStore((state) =>
    id ? state.detailLoadingById[id] ?? false : false
  );
  const error = useSpeciesStore((state) =>
    id ? state.detailErrorById[id] ?? null : 'Species ID is missing'
  );
  const updatedAt = useSpeciesStore((state) =>
    id ? state.detailUpdatedAt[id] : undefined
  );
  // The species is shown with a photo of one of its plants (species reference photos are not
  // shown, and plant photos carry no credit).
  const plantPhoto = useSpeciesStore((state) =>
    id ? state.plantPhotosBySpeciesId[id] : undefined
  );
  const loadSpeciesDetail = useSpeciesStore(
    (state) => state.loadSpeciesDetail
  );

  useEffect(() => {
    if (id) void loadSpeciesDetail(id);
  }, [id, loadSpeciesDetail]);

  const taxonomyRows = useMemo(() => {
    if (!detail?.taxonomy) return [];

    return [
      ['Kingdom', detail.taxonomy.kingdom],
      ['Division', detail.taxonomy.division],
      ['Class', detail.taxonomy.class_name],
      ['Order', detail.taxonomy.order_name],
      ['Family', detail.taxonomy.family],
      ['Genus', detail.taxonomy.genus],
    ].filter((row): row is [string, string] => Boolean(row[1]));
  }, [detail]);

  const updatedText = updatedAt
    ? new Date(updatedAt).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const statusCode = detail?.conservation_status?.trim();
  const statusText = statusCode
    ? `${STATUS_LABELS[statusCode] ?? statusCode}${
        STATUS_LABELS[statusCode] ? ` (${statusCode})` : ''
      }`
    : 'Not assessed';

  const title = detail?.scientific_name ?? listItem?.scientific_name;

  if (!id) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.center]}>
        <Text style={styles.errorTitle}>Species ID is missing</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => router.back()}>
          <Text style={styles.primaryButtonText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!detail && loading) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.center]}>
        <ActivityIndicator color="#213B2A" size="large" />
        <Text style={styles.loadingText}>Loading species reference…</Text>
      </SafeAreaView>
    );
  }

  if (!detail) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.back}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title ?? 'Species Reference'}
          </Text>
          <View style={styles.headerSide} />
        </View>

        <View style={styles.center}>
          <Text style={styles.errorTitle}>Detail not available offline</Text>
          <Text style={styles.errorText}>
            This species has not been downloaded to this phone yet. Connect once
            to make its reference available offline.
          </Text>
          {error ? <Text style={styles.technicalError}>{error}</Text> : null}
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => void loadSpeciesDetail(id, true)}
          >
            <Text style={styles.primaryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Species Reference</Text>
        <TouchableOpacity
          style={styles.headerSide}
          onPress={() => void loadSpeciesDetail(id, true)}
          disabled={loading}
        >
          <Text style={[styles.refresh, loading && styles.refreshDisabled]}>
            Refresh
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {error && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>
              Couldn't refresh — showing the reference saved on this phone.
            </Text>
          </View>
        )}

        {plantPhoto ? (
          <View style={styles.heroBox}>
            <Image source={{ uri: plantPhoto.uri }} style={[styles.heroImage, styles.heroInBox]} resizeMode="cover" />
            <Text style={styles.heroCaption}>{plantPhotoCaption(plantPhoto.tag)}</Text>
          </View>
        ) : (
          <View style={[styles.heroImage, styles.imagePlaceholder]}>
            <Text style={styles.placeholderIcon}>🌿</Text>
            <Text style={styles.placeholderText}>No plant photo yet</Text>
          </View>
        )}

        <View style={styles.titleCard}>
          <Text style={styles.scientificName}>{detail.scientific_name}</Text>
          {detail.common_name ? (
            <Text style={styles.commonName}>{detail.common_name}</Text>
          ) : null}
          {detail.local_name ? (
            <Text style={styles.localName}>Local name: {detail.local_name}</Text>
          ) : null}

          <View style={styles.statusPill}>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        </View>

        <ReferenceSection title="Description" value={detail.description} />
        <ReferenceSection title="Morphology" value={detail.morphology} />
        <ReferenceSection title="Habitat" value={detail.habitat} />
        <ReferenceSection
          title="Cultural significance"
          value={detail.cultural_significance}
        />

        {taxonomyRows.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Taxonomy</Text>
            {taxonomyRows.map(([label, value]) => (
              <View key={label} style={styles.taxonomyRow}>
                <Text style={styles.taxonomyLabel}>{label}</Text>
                <Text style={styles.taxonomyValue}>{value}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sources</Text>
          {detail.sources && detail.sources.length > 0 ? (
            detail.sources.map((source, index) => (
              <View key={`${source.name}-${index}`} style={styles.sourceBlock}>
                <Text style={styles.sourceName}>{source.name}</Text>
                {source.citation ? (
                  <Text style={styles.sourceMeta}>{source.citation}</Text>
                ) : null}
                {source.license ? (
                  <Text style={styles.sourceMeta}>License: {source.license}</Text>
                ) : null}
                {source.url ? (
                  <TouchableOpacity onPress={() => void Linking.openURL(source.url!)}>
                    <Text style={styles.sourceLink}>Open source</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={styles.missingSource}>
              Source attribution has not been recorded in the current database.
            </Text>
          )}
        </View>

        <View style={styles.cacheCard}>
          <Text style={styles.cacheTitle}>Offline reference</Text>
          <Text style={styles.cacheText}>
            This text is saved on this phone
            {updatedText ? ` · updated ${updatedText}` : ''}.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E4EAE6',
  },
  back: { width: 60, fontSize: 34, lineHeight: 36, color: '#213B2A' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: '#1E2B22',
  },
  headerSide: { width: 60, alignItems: 'flex-end' },
  refresh: { fontSize: 12, fontWeight: '700', color: '#213B2A' },
  refreshDisabled: { opacity: 0.45 },
  content: { padding: 20, paddingBottom: 40 },
  offlineBanner: {
    backgroundColor: '#FFF7DB',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  offlineText: { fontSize: 12.5, color: '#6B5310', lineHeight: 17 },
  heroImage: {
    width: '100%',
    height: 220,
    borderRadius: 24,
    backgroundColor: '#E8EFEA',
    marginBottom: 14,
  },
  heroBox: { marginBottom: 14 },
  heroCaption: { fontSize: 12, color: '#68776D', marginTop: 6 },
  heroInBox: { marginBottom: 0 },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderIcon: { fontSize: 42, marginBottom: 8 },
  placeholderText: { fontSize: 12.5, color: '#68776D' },
  titleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E4EAE6',
    padding: 18,
    marginBottom: 14,
  },
  scientificName: {
    fontSize: 24,
    fontWeight: '800',
    fontStyle: 'italic',
    color: '#1E2B22',
  },
  commonName: { fontSize: 16, color: '#4D5E52', marginTop: 6 },
  localName: { fontSize: 13, color: '#68776D', marginTop: 4 },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#E4F2E7',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 12,
  },
  statusText: { fontSize: 12, fontWeight: '700', color: '#215A36' },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E4EAE6',
    padding: 18,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#213B2A',
    marginBottom: 9,
  },
  bodyText: { fontSize: 14, color: '#4D5E52', lineHeight: 21 },
  taxonomyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4EAE6',
  },
  taxonomyLabel: { fontSize: 13, color: '#718077' },
  taxonomyValue: {
    flex: 1,
    marginLeft: 20,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '600',
    color: '#263B2D',
  },
  sourceBlock: { marginBottom: 12 },
  sourceName: { fontSize: 14, fontWeight: '700', color: '#263B2D' },
  sourceMeta: { fontSize: 12.5, color: '#68776D', marginTop: 3, lineHeight: 17 },
  sourceLink: { fontSize: 12.5, fontWeight: '700', color: '#27633C', marginTop: 6 },
  missingSource: { fontSize: 13, color: '#8A5A23', lineHeight: 19 },
  cacheCard: {
    backgroundColor: '#EAF2EC',
    borderRadius: 18,
    padding: 16,
    marginTop: 2,
  },
  cacheTitle: { fontSize: 14, fontWeight: '800', color: '#213B2A' },
  cacheText: { fontSize: 12.5, color: '#53675A', lineHeight: 18, marginTop: 4 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  loadingText: { fontSize: 13, color: '#5B6B60', marginTop: 14 },
  errorTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#213B2A',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 13.5,
    color: '#5B6B60',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 10,
  },
  technicalError: {
    fontSize: 11.5,
    color: '#9B1C1C',
    textAlign: 'center',
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: '#213B2A',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 28,
    marginTop: 18,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
