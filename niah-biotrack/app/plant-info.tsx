import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
  AppState,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSpeciesStore } from '../src/store/useSpeciesStore';
import { lookupPublicTag, describePublicTagLookup, type PublicTagLookupResult } from '../src/services/tagLookup';
import { conservationStatusColors, plainConservationStatus } from '../src/utils/conservationStatus';
import { plantPhotoCaption } from '../src/utils/plantPhotoCaption';
import { publicPhotoUri } from '../src/utils/publicPhoto';
import { BASE_URL } from '../src/api/client';
import PlantThumbnail from '../src/components/PlantThumbnail';
import { thumbnailSources } from '../src/utils/thumbnailSources';

// What the page shows, from either source. Never any location or coordinates.
interface PlantFacts {
  commonName: string | null;
  scientificName: string | null;
  localName: string | null;
  status: string | null;
  description: string | null;
  habitat: string | null;
  culturalSignificance: string | null;
}

const normalise = (text: string | null | undefined) => (text ?? '').trim().toLowerCase();

// The visitor plant page, shared by the Plant guide, Home and Scan. Opened with
// ?speciesId= (an approved species) or ?tag= (a scanned plant tag). Uses public data
// only, with no login token.
export default function PlantInfoScreen() {
  const router = useRouter();
  const { speciesId: speciesParam, tag } = useLocalSearchParams<{ speciesId?: string; tag?: string }>();

  const species = useSpeciesStore((state) => state.species);
  const detailsById = useSpeciesStore((state) => state.detailsById);
  const loadSpecies = useSpeciesStore((state) => state.loadSpecies);
  const loadSpeciesDetail = useSpeciesStore((state) => state.loadSpeciesDetail);

  const [scan, setScan] = useState<PublicTagLookupResult | null>(null);
  const [scanLoading, setScanLoading] = useState(Boolean(tag));
  const [refreshing, setRefreshing] = useState(false);

  // Which approved species this is: the one asked for, or (for a scan) the species with
  // the same scientific name, so its photo can be shown.
  const scanned = scan?.status === 'found' ? scan : null;
  const speciesId =
    speciesParam ??
    (scanned?.scientificName
      ? species.find((s) => normalise(s.scientific_name) === normalise(scanned.scientificName))?.id
      : undefined);

  const syncPlantPage = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      try {
        if (species.length === 0) {
          await loadSpecies({ silent: true });
        }
        if (tag) {
          const result = await lookupPublicTag(tag);
          setScan(result);
          setScanLoading(false);
        }
        if (speciesId) {
          await loadSpeciesDetail(speciesId, true);
        }
      } finally {
        if (manual) setRefreshing(false);
      }
    },
    [species.length, loadSpecies, tag, speciesId, loadSpeciesDetail]
  );

  // Auto-sync when opening or returning to this screen
  useFocusEffect(
    useCallback(() => {
      void syncPlantPage(false);
    }, [syncPlantPage])
  );

  // Auto-sync when returning to the app from the background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void syncPlantPage(false);
      }
    });
    return () => subscription.remove();
  }, [syncPlantPage]);

  const detail = speciesId ? detailsById[speciesId] : undefined;
  const listItem = speciesId ? species.find((s) => s.id === speciesId) : undefined;
  // A scanned plant shows its own main photo (from the public lookup); a species page shows
  // the species' public plant photo. Both are served stripped by the backend. Never a species
  // reference photo or another plant's photo for a scan, and never a credit.
  const photo: { tag: string | null; url: string | null } | null = tag
    ? scanned
      ? { tag: scanned.tagCode, url: scanned.photoUrl }
      : null
    : (detail?.public_photo ?? listItem?.public_photo ?? null);
  const photoUri = publicPhotoUri(BASE_URL, photo?.url);

  // The scanned plant's own public facts come first; the species fills any gaps.
  const facts: PlantFacts = {
    commonName: scanned?.commonName ?? detail?.common_name ?? listItem?.common_name ?? null,
    scientificName: scanned?.scientificName ?? detail?.scientific_name ?? listItem?.scientific_name ?? null,
    localName: scanned?.localName ?? detail?.local_name ?? listItem?.local_name ?? null,
    status: scanned?.conservationStatus ?? detail?.conservation_status ?? listItem?.conservation_status ?? null,
    description: scanned?.description ?? detail?.description ?? listItem?.description ?? null,
    habitat: scanned?.habitat ?? detail?.habitat ?? null,
    culturalSignificance: scanned?.culturalSignificance ?? detail?.cultural_significance ?? null,
  };

  const notFound = scan && scan.status !== 'found' ? describePublicTagLookup(scan) : null;
  const nothingToShow = !tag && !speciesParam;
  const stillLoading = scanLoading || (!!speciesParam && !detail && !listItem);
  const status = plainConservationStatus(facts.status);
  const statusColors = conservationStatusColors(status.code);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
      </View>

      {nothingToShow || notFound ? (
        <View style={styles.centerBox}>
          <Text style={styles.title}>{notFound ? notFound.title : 'Plant not found'}</Text>
          <Text style={styles.body}>{notFound ? notFound.message : "This plant's information isn't available."}</Text>
        </View>
      ) : stillLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator color="#213B2A" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void syncPlantPage(true)}
              tintColor="#213B2A"
              colors={['#213B2A']}
            />
          }
        >
          {photoUri ? (
            <View style={styles.photoBox}>
              <PlantThumbnail
                // Full size first, then the small copy the list showed (kept on the phone).
                sources={thumbnailSources({ publicPath: photo?.url, baseUrl: BASE_URL, size: 'full' })}
                style={[styles.photo, styles.photoInBox]}
                caption={tag ? null : <Text style={styles.photoCaption}>{plantPhotoCaption(photo?.tag)}</Text>}
                placeholder={
                  <View style={[styles.photo, styles.photoInBox, styles.photoPlaceholder]}>
                    <Text style={styles.placeholderIcon}>🌿</Text>
                  </View>
                }
              />
            </View>
          ) : (
            <View style={[styles.photo, styles.photoPlaceholder]}>
              <Text style={styles.placeholderIcon}>🌿</Text>
            </View>
          )}

          <Text style={styles.title}>{facts.commonName || facts.scientificName || 'Unnamed plant'}</Text>
          {facts.scientificName && facts.commonName ? (
            <Text style={styles.scientific}>{facts.scientificName}</Text>
          ) : null}
          {/* This plant: only for a scanned tag (the one plant in front of the visitor). */}
          {scanned ? (
            <>
              <Text style={styles.heading}>This plant</Text>
              <Text style={styles.body}>Tag: {scanned.tagCode}</Text>
            </>
          ) : null}

          {/* About this species: true of every plant of this species. */}
          <Text style={styles.heading}>About this species</Text>
          {facts.localName ? <Text style={styles.localName}>Local name: {facts.localName}</Text> : null}
          <View style={[styles.badge, { backgroundColor: statusColors.bg }]}>
            <Text style={[styles.badgeText, { color: statusColors.text }]}>{status.label}</Text>
          </View>
          <Text style={styles.body}>{status.meaning}</Text>

          {facts.description ? (
            <>
              <Text style={styles.subheading}>Description</Text>
              <Text style={styles.body}>{facts.description}</Text>
            </>
          ) : null}

          {facts.habitat ? (
            <>
              <Text style={styles.subheading}>Where it grows</Text>
              <Text style={styles.body}>{facts.habitat}</Text>
            </>
          ) : null}

          {facts.culturalSignificance ? (
            <>
              <Text style={styles.subheading}>Cultural significance</Text>
              <Text style={styles.body}>{facts.culturalSignificance}</Text>
            </>
          ) : null}

          <Text style={styles.footer}>Niah National Park · Sarawak Forestry Corporation</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  topBar: { paddingHorizontal: 16, paddingVertical: 6 },
  back: { fontSize: 32, color: '#213B2A' },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 20, marginBottom: 16, backgroundColor: '#E7EFEA' },
  photoBox: { marginBottom: 16 },
  photoInBox: { marginBottom: 0 },
  photoCaption: { fontSize: 11, color: '#68776D', marginTop: 6 },
  photoPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  placeholderIcon: { fontSize: 48 },
  title: { fontSize: 24, fontWeight: '800', color: '#1E2B22', textAlign: 'left' },
  scientific: { fontSize: 15, fontStyle: 'italic', color: '#4E6254', marginTop: 2 },
  localName: { fontSize: 13.5, color: '#526659', marginTop: 4 },
  badge: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14, marginTop: 14 },
  badgeText: { fontSize: 12.5, fontWeight: '700' },
  heading: { fontSize: 15, fontWeight: '800', color: '#213B2A', marginTop: 22, marginBottom: 6 },
  subheading: { fontSize: 13, fontWeight: '700', color: '#526659', marginTop: 12, marginBottom: 4 },
  body: { fontSize: 14, color: '#3A483E', lineHeight: 21, marginTop: 6 },
  footer: { fontSize: 12, color: '#7E8F83', textAlign: 'center', marginTop: 32 },
});