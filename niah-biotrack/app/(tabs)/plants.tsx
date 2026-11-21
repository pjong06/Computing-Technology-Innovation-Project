import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSpeciesStore } from '../../src/store/useSpeciesStore';
import { conservationStatusColors, plainConservationStatus } from '../../src/utils/conservationStatus';
import { plantPhotoCaption } from '../../src/utils/plantPhotoCaption';

// The visitor and guest "Plant guide": the approved species list (public data, cached on
// the phone), in plain language. Botanists use the Species tab instead.
export default function PlantGuideScreen() {
  const router = useRouter();
  const species = useSpeciesStore((state) => state.species);
  const loading = useSpeciesStore((state) => state.loading);
  const error = useSpeciesStore((state) => state.error);
  // A photo of one of the species' plants (staff only; visitors see the leaf).
  const plantPhotosBySpeciesId = useSpeciesStore((state) => state.plantPhotosBySpeciesId);
  const loadSpecies = useSpeciesStore((state) => state.loadSpecies);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    void loadSpecies();
  }, [loadSpecies]);

  // The categories that actually appear (chips are hidden when there are none).
  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const s of species) {
      const name = s.species_category?.trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [species]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return species.filter((s) => {
      const matchesSearch =
        query === '' ||
        [s.common_name, s.local_name, s.scientific_name].some((name) => name?.toLowerCase().includes(query));
      const matchesCategory = category === null || s.species_category?.trim() === category;
      return matchesSearch && matchesCategory;
    });
  }, [species, search, category]);

  const renderEmpty = () => {
    if (species.length === 0 && loading) {
      return <ActivityIndicator color="#213B2A" style={{ marginTop: 40 }} />;
    }
    if (species.length === 0 && error) {
      return (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>Couldn't load the plant guide</Text>
          <Text style={styles.emptyText}>Connect to the internet once to download it.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void loadSpecies()}>
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
        <Text style={styles.title}>Plant guide</Text>

        <TextInput
          style={styles.search}
          placeholder="Search by name"
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

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshing={loading && species.length > 0}
          onRefresh={() => void loadSpecies()}
          ListEmptyComponent={renderEmpty}
          renderItem={({ item }) => {
            const status = plainConservationStatus(item.conservation_status);
            const colors = conservationStatusColors(status.code);
            const photo = plantPhotosBySpeciesId[item.id];
            return (
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => router.push({ pathname: '/plant-info', params: { speciesId: item.id } } as any)}
              >
                <View style={styles.photoColumn}>
                  {photo ? (
                    <Image source={{ uri: photo.uri }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, styles.thumbPlaceholder]}>
                      <Text style={{ fontSize: 22 }}>🌿</Text>
                    </View>
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.commonName}>{item.common_name || item.scientific_name}</Text>
                  {item.common_name ? <Text style={styles.scientific}>{item.scientific_name}</Text> : null}
                  {photo ? <Text style={styles.photoCaption} numberOfLines={1}>{plantPhotoCaption(photo.tag)}</Text> : null}
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
  photoColumn: { width: 110 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
  title: { fontSize: 24, fontWeight: '800', color: '#1E2B22', marginBottom: 12 },
  search: { backgroundColor: '#FFFFFF', height: 46, borderRadius: 23, paddingHorizontal: 18, fontSize: 14, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 10 },
  chipScroll: { flexGrow: 0, marginBottom: 10 },
  chipRow: { gap: 8, paddingRight: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1.2, borderColor: '#DCE4DF', backgroundColor: '#FFFFFF' },
  chipOn: { backgroundColor: '#213B2A', borderColor: '#213B2A' },
  chipText: { fontSize: 12.5, fontWeight: '600', color: '#334839' },
  chipTextOn: { color: '#FFFFFF' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 12, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 8 },
  thumb: { width: 56, height: 56, borderRadius: 14, backgroundColor: '#E7EFEA' },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  commonName: { fontSize: 15, fontWeight: '700', color: '#1E2B22' },
  scientific: { fontSize: 12.5, fontStyle: 'italic', color: '#526659', marginTop: 1 },
  photoCaption: { fontSize: 11, color: '#68776D', marginTop: 2 },
  badge: { alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 10, marginTop: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  chevron: { fontSize: 24, color: '#8A998E', marginLeft: 8 },
  emptyBox: { alignItems: 'center', marginTop: 40 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#1E2B22', marginBottom: 6 },
  emptyText: { fontSize: 13, color: '#68776D', textAlign: 'center', marginTop: 20 },
  retryBtn: { marginTop: 12, paddingVertical: 8, paddingHorizontal: 18, borderRadius: 16, backgroundColor: '#213B2A' },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
});
