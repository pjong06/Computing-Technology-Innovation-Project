import React, { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSpeciesStore } from '../src/store/useSpeciesStore';
import { photoCreditRows } from '../src/utils/photoCredit';

// Photo credits (from Profile): every species reference photo from iNaturalist that needs
// attribution, with species, photographer and licence. Uses the species list already on the
// phone. CC0 photos and SFC's own photos need no credit and are not listed.
export default function PhotoCreditsScreen() {
  const router = useRouter();
  const species = useSpeciesStore((state) => state.species);
  const loading = useSpeciesStore((state) => state.loading);
  const error = useSpeciesStore((state) => state.error);
  const loadSpecies = useSpeciesStore((state) => state.loadSpecies);

  useEffect(() => {
    if (species.length === 0) void loadSpecies();
  }, [loadSpecies, species.length]);

  const rows = useMemo(() => photoCreditRows(species), [species]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.navRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back-outline" size={26} color="#213B2A" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Photo credits</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={styles.intro}>
            Species reference photos from iNaturalist are used under their photographers'
            licences. CC0 photos and Sarawak Forestry's own photos need no credit.
          </Text>
        }
        ListEmptyComponent={
          loading && species.length === 0 ? (
            <ActivityIndicator color="#213B2A" style={styles.loading} />
          ) : (
            <Text style={styles.empty}>
              {error && species.length === 0
                ? 'Photo credits could not be loaded. Connect to the internet and try again.'
                : 'No photos need a credit at the moment.'}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.species}>{item.species}</Text>
            {item.commonName ? <Text style={styles.common}>{item.commonName}</Text> : null}
            <Text style={styles.credit}>
              {item.photographer} · {item.licence}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  navTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: '#213B2A' },
  list: { paddingHorizontal: 20, paddingBottom: 30 },
  intro: { fontSize: 12.5, color: '#68776D', lineHeight: 18, marginBottom: 14 },
  loading: { marginTop: 30 },
  empty: { fontSize: 13, color: '#68776D', textAlign: 'center', marginTop: 30 },
  row: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    padding: 12,
    marginBottom: 8,
  },
  species: { fontSize: 14, fontWeight: '700', fontStyle: 'italic', color: '#1E2B22' },
  common: { fontSize: 12.5, color: '#526659', marginTop: 1 },
  credit: { fontSize: 12.5, color: '#3A483E', marginTop: 4 },
});
