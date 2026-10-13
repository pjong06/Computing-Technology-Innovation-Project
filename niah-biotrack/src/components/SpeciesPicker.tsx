import React, { useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useSpeciesStore } from '../store/useSpeciesStore';
import type { Species } from '../api/species';

// What the botanist chose: a listed species, "Unknown", or nothing yet.
export type SpeciesChoice = { kind: 'species'; species: Species } | { kind: 'unknown' } | null;

interface Props {
  value: SpeciesChoice;
  onChange: (choice: SpeciesChoice) => void;
  query: string;
  onQueryChange: (text: string) => void;
  hasError?: boolean;
}

const MAX_RESULTS = 6;

export default function SpeciesPicker({ value, onChange, query, onQueryChange, hasError }: Props) {
  const species = useSpeciesStore((state) => state.species);
  const loadSpecies = useSpeciesStore((state) => state.loadSpecies);

  // Download the list if this phone has never had it (keeps the cache if offline).
  useEffect(() => {
    if (species.length === 0) void loadSpecies();
  }, []);

  // Search scientific, common and local names; only recalculated when they change.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return species
      .filter((s) =>
        [s.scientific_name, s.common_name, s.local_name].some((name) => name?.toLowerCase().includes(q))
      )
      .slice(0, MAX_RESULTS);
  }, [species, query]);

  // A choice has been made: show it with a "Change" button.
  if (value) {
    return (
      <View style={styles.chosenCard}>
        <View style={{ flex: 1 }}>
          {value.kind === 'species' ? (
            <>
              <Text style={styles.chosenName}>{value.species.scientific_name}</Text>
              {value.species.common_name ? <Text style={styles.chosenSub}>{value.species.common_name}</Text> : null}
            </>
          ) : (
            <>
              <Text style={styles.unknownName}>Unknown species</Text>
              <Text style={styles.chosenSub}>A Conservation Officer will identify it during review.</Text>
            </>
          )}
        </View>
        <TouchableOpacity onPress={() => onChange(null)} hitSlop={8}>
          <Text style={styles.changeText}>Change</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <TextInput
        style={[styles.input, hasError && styles.inputError]}
        placeholder="Search scientific, common or local name"
        placeholderTextColor="#8C9A91"
        value={query}
        onChangeText={onQueryChange}
        autoCorrect={false}
        autoCapitalize="none"
      />

      {species.length === 0 && (
        <Text style={styles.helpText}>
          The species list hasn't downloaded to this phone yet. Connect once, or choose Unknown species.
        </Text>
      )}

      {matches.map((s) => (
        <TouchableOpacity
          key={s.id}
          style={styles.resultRow}
          onPress={() => onChange({ kind: 'species', species: s })}
        >
          <Text style={styles.resultName}>{s.scientific_name}</Text>
          {s.common_name || s.local_name ? (
            <Text style={styles.resultSub}>{[s.common_name, s.local_name].filter(Boolean).join(' · ')}</Text>
          ) : null}
        </TouchableOpacity>
      ))}

      {query.trim() !== '' && matches.length === 0 && species.length > 0 && (
        <Text style={styles.helpText}>No approved species match. If you're not sure, choose Unknown species.</Text>
      )}

      <TouchableOpacity style={styles.unknownBtn} onPress={() => onChange({ kind: 'unknown' })}>
        <Text style={styles.unknownBtnText}>I don't know – Unknown species</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: '#FFFFFF', height: 48, borderRadius: 24, paddingHorizontal: 18, fontSize: 14, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 8 },
  inputError: { borderColor: '#9B1C1C' },
  helpText: { fontSize: 12.5, color: '#68776D', marginBottom: 8, lineHeight: 17 },
  resultRow: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1.2, borderColor: '#E6ECE8', paddingVertical: 10, paddingHorizontal: 14, marginBottom: 6 },
  resultName: { fontSize: 14, fontWeight: '700', fontStyle: 'italic', color: '#1E2B22' },
  resultSub: { fontSize: 12, color: '#68776D', marginTop: 2 },
  unknownBtn: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1.2, borderColor: '#213B2A', marginBottom: 8 },
  unknownBtnText: { fontSize: 12.5, fontWeight: '700', color: '#213B2A' },
  chosenCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E4F2E7', borderRadius: 16, padding: 14, marginBottom: 8 },
  chosenName: { fontSize: 15, fontWeight: '700', fontStyle: 'italic', color: '#1E2B22' },
  unknownName: { fontSize: 15, fontWeight: '700', color: '#1E2B22' },
  chosenSub: { fontSize: 12, color: '#4A5A50', marginTop: 2 },
  changeText: { fontSize: 13, fontWeight: '700', color: '#213B2A', marginLeft: 12 },
});