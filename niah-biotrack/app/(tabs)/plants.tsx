import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  ActivityIndicator,
  AppState,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePublicPlantsStore } from '../../src/store/usePublicPlantsStore';
import { conservationStatusColors, plainConservationStatus } from '../../src/utils/conservationStatus';
import { BASE_URL } from '../../src/api/client';
import PlantThumbnail from '../../src/components/PlantThumbnail';
import { thumbnailSources } from '../../src/utils/thumbnailSources';

const AUTO_REFRESH_INTERVAL_MS = 30_000;

// Visitor "Plants" tab: read-only list of approved plants synced with the park's
// approved plant records (no coordinates, no staff details, and no add/edit controls).
export default function VisitorPlantsScreen() {
  const router = useRouter();
  const plants = usePublicPlantsStore((state) => state.plants);
  const loading = usePublicPlantsStore((state) => state.loading);
  const error = usePublicPlantsStore((state) => state.error);
  const loadPublicPlants = usePublicPlantsStore((state) => state.loadPublicPlants);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const syncPlants = useCallback(
    (silent: boolean) => {
      void loadPublicPlants({ silent });
    },
    [loadPublicPlants]
  );

  // Auto-sync whenever the Plants tab gains focus and every 30s while open
  useFocusEffect(
    useCallback(() => {
      syncPlants(plants.length > 0);
      const timer = setInterval(() => {
        syncPlants(true);
      }, AUTO_REFRESH_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [plants.length, syncPlants])
  );

  // Auto-sync when returning to the app from the background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        syncPlants(true);
      }
    });
    return () => subscription.remove();
  }, [syncPlants]);

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const p of plants) {
      const name = p.speciesCategory?.trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [plants]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return plants.filter((p) => {
      const matchesSearch =
        query === '' ||
        [p.scientificName, p.commonName, p.localName, p.tagCode].some((value) =>
          value?.toLowerCase().includes(query)
        );
      const matchesCategory = category === null || p.speciesCategory?.trim() === category;
      return matchesSearch && matchesCategory;
    });
  }, [plants, search, category]);

  const renderEmpty = () => {
    if (plants.length === 0 && loading) {
      return <ActivityIndicator color="#213B2A" style={{ marginTop: 40 }} />;
    }
    if (plants.length === 0 && error) {
      return (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>Couldn't load plants</Text>
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void loadPublicPlants()}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return <Text style={styles.emptyText}>No plants match your search.</Text>;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Plants</Text>

        <TextInput
          style={styles.search}
          placeholder="Search plant, species or tag"
          placeholderTextColor="#8C9A91"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />

        {categories.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipRow}
            keyboardShouldPersistTaps="handled"
          >
            {[null, ...categories].map((name) => {
              const selected = category === name;
              return (
                <TouchableOpacity
                  key={name ?? 'all'}
                  style={[styles.chip, selected && styles.chipOn]}
                  onPress={() => setCategory(name)}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextOn]}>{name ?? 'All'}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {plants.length > 0 && (
          <Text style={styles.summary}>
            {filtered.length} {filtered.length === 1 ? 'plant' : 'plants'} · newest first
          </Text>
        )}

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshing={loading && plants.length > 0}
          onRefresh={() => void loadPublicPlants()}
          ListEmptyComponent={renderEmpty}
          renderItem={({ item }) => {
            const status = plainConservationStatus(item.conservationStatus);
            const colors = conservationStatusColors(status.code);
            return (
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.75}
                onPress={() =>
                  router.push({
                    pathname: '/plant-info',
                    params: item.tagCode
                      ? { tag: item.tagCode }
                      : item.speciesId
                        ? { speciesId: item.speciesId }
                        : {},
                  } as any)
                }
                accessibilityRole="button"
              >
                <PlantThumbnail
                  sources={thumbnailSources({ publicPath: item.photoUrl, baseUrl: BASE_URL })}
                  style={styles.thumb}
                  placeholder={
                    <View style={[styles.thumb, styles.thumbPlaceholder]}>
                      <Ionicons name="leaf-outline" size={22} color="#46654F" />
                    </View>
                  }
                />
                <View style={styles.textCol}>
                  <Text style={styles.scientificName} numberOfLines={2}>
                    {item.scientificName || item.commonName || 'Approved plant'}
                  </Text>
                  <Text style={styles.tagCode} numberOfLines={1}>
                    {item.tagCode}
                  </Text>
                  {item.commonName && item.scientificName ? (
                    <Text style={styles.commonName} numberOfLines={1}>
                      {item.commonName}
                    </Text>
                  ) : null}
                  <View style={[styles.badge, { backgroundColor: colors.bg }]}>
                    <Text style={[styles.badgeText, { color: colors.text }]}>{status.label}</Text>
                  </View>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
  title: { fontSize: 24, fontWeight: '800', color: '#1E2B22', marginBottom: 12 },
  search: { backgroundColor: '#FFFFFF', height: 46, borderRadius: 23, paddingHorizontal: 18, fontSize: 14, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 10 },
  chipScroll: { flexGrow: 0, marginBottom: 10 },
  chipRow: { gap: 8, paddingRight: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1.2, borderColor: '#DCE4DF', backgroundColor: '#FFFFFF' },
  chipOn: { backgroundColor: '#213B2A', borderColor: '#213B2A' },
  chipText: { fontSize: 12.5, fontWeight: '600', color: '#334839' },
  chipTextOn: { color: '#FFFFFF' },
  summary: { fontSize: 12.5, color: '#68776D', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 12, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 8 },
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#E7EFEA' },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  textCol: { flex: 1, minWidth: 0, marginLeft: 12 },
  scientificName: { fontSize: 14.5, fontWeight: '700', fontStyle: 'italic', color: '#1E2B22' },
  tagCode: { fontSize: 12, color: '#68776D', marginTop: 2 },
  commonName: { fontSize: 12, color: '#526659', marginTop: 1 },
  badge: { alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 10, marginTop: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  chevron: { fontSize: 24, color: '#8A998E', marginLeft: 8 },
  emptyBox: { alignItems: 'center', marginTop: 40 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#1E2B22', marginBottom: 6 },
  emptyText: { fontSize: 13, color: '#68776D', textAlign: 'center', marginTop: 20 },
  retryBtn: { marginTop: 12, paddingVertical: 8, paddingHorizontal: 18, borderRadius: 16, backgroundColor: '#213B2A' },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
});