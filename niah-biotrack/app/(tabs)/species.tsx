import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar} from 'react-native';
import { useRouter } from 'expo-router';

const CAT = [{ id: '1', name: 'Shorea platyclados', loc: '2.3km trail' }, { id: '2', name: 'Nepenthes ampullaria', loc: 'Cave entrance' }];

export default function SpeciesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.headerTitle}>Species Catalog</Text>
        <TextInput style={styles.searchBar} placeholder="Search species" value={search} onChangeText={setSearch} />
        <FlatList
          data={CAT.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.pillCard} onPress={() => router.push({ pathname: '/plant-detail', params: { name: item.name, location: item.loc } } as any)}>
              <View><Text style={styles.speciesName}>{item.name}</Text><Text style={styles.locationSubtitle}>{item.loc}</Text></View>
              <Text style={{fontSize: 24, color: '#88988D'}}>›</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6',paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#1E2B22', marginBottom: 14 },
  searchBar: { backgroundColor: '#FFFFFF', height: 50, borderRadius: 25, paddingHorizontal: 18, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 14 },
  pillCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', padding: 18, borderRadius: 24, marginBottom: 10, borderWidth: 1.2, borderColor: '#E6ECE8' },
  speciesName: { fontSize: 16, fontWeight: '700', color: '#1E2B22' },
  locationSubtitle: { fontSize: 13, color: '#68776D', marginTop: 4 }
});