import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useRecordStore } from '../src/store/useRecordStore';
import PlantNotFound from '../src/components/PlantNotFound';
import FormScrollView from '../src/components/FormScrollView';
import KeyboardDoneBar from '../src/components/KeyboardDoneBar';

const DONE_BAR_ID = 'add-observation-done';

export default function AddObservationScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const records = useRecordStore((state) => state.records);
  const addObservation = useRecordStore((state) => state.addObservation);

  const matched = records.find((r) => r.id === id);

  const [health, setHealth] = useState<'Healthy' | 'Stressed' | 'Damaged' | 'Dead'>('Healthy');
  const [stage, setStage] = useState<'Bud' | 'Flowering' | 'Vegetative' | 'Fruiting'>('Flowering');
  const [measurement, setMeasurement] = useState('0.62');
  const [notes, setNotes] = useState('');

  // Hooks above must run on every render, so the not-found check comes after them.
  if (!matched) {
    return <PlantNotFound code={id} />;
  }

  const handleSave = () => {
    addObservation(matched.id, {
      date: `${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · 8:10 AM`,
      recordedBy: 'Brendan Noel',
      health,
      stage,
      measurement: `${measurement} m`,
      notes: notes || 'Observation logged in field.',
    });

    Toast.show({
      type: 'success',
      text1: 'Observation Logged',
      text2: 'Visit recorded locally to device.',
      position: 'bottom',
    });

    router.back();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}><Text style={styles.backChevron}>‹</Text></TouchableOpacity>
        <Text style={styles.topBarTitle}>Add Observation</Text>
        <View style={{ width: 28 }} />
      </View>

      <FormScrollView contentContainerStyle={styles.container}>
        <Text style={styles.plantTitle}>{matched.scientificName}</Text>
        <Text style={styles.metaSubtitle}>{matched.tagCode ?? 'No tag attached'} · {matched.locationName} visit #{matched.observations.length + 1}</Text>

        <Text style={styles.label}>Health status *</Text>
        <View style={styles.pillRow}>
          {(['Healthy', 'Stressed', 'Damaged', 'Dead'] as const).map((h) => (
            <TouchableOpacity key={h} onPress={() => setHealth(h)} style={[styles.pill, health === h && styles.activePill]}>
              <Text style={[styles.pillText, health === h && styles.activePillText]}>{h}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Phenology stage *</Text>
        <View style={styles.pillRow}>
          {(['Bud', 'Flowering', 'Vegetative', 'Fruiting'] as const).map((s) => (
            <TouchableOpacity key={s} onPress={() => setStage(s)} style={[styles.pill, stage === s && styles.activePill]}>
              <Text style={[styles.pillText, stage === s && styles.activePillText]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Height / diameter (m)</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={measurement}
          onChangeText={setMeasurement}
          placeholder="e.g. 0.62"
          inputAccessoryViewID={DONE_BAR_ID}
        />

        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
          multiline
          value={notes}
          onChangeText={setNotes}
          placeholder="Day 2 of bloom, perigone lobes fully open..."
          inputAccessoryViewID={DONE_BAR_ID}
        />

        <TouchableOpacity style={styles.submitBtn} onPress={handleSave}>
          <Text style={styles.submitBtnText}>Save observation</Text>
        </TouchableOpacity>
      </FormScrollView>
      <KeyboardDoneBar nativeID={DONE_BAR_ID} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  backChevron: { fontSize: 32, color: '#213B2A' },
  topBarTitle: { fontSize: 17, fontWeight: '700', color: '#1E2B22' },
  container: { padding: 20, paddingBottom: 40 },
  plantTitle: { fontSize: 22, fontWeight: '800', color: '#213B2A' },
  metaSubtitle: { fontSize: 13, color: '#68776D', marginTop: 4, marginBottom: 20 },
  label: { fontSize: 12.5, fontWeight: '700', color: '#4E6254', marginBottom: 8, marginTop: 10 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 },
  pill: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DCE4DF', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, marginRight: 8, marginBottom: 8 },
  activePill: { backgroundColor: '#213B2A', borderColor: '#213B2A' },
  pillText: { fontSize: 12.5, color: '#334839', fontWeight: '600' },
  activePillText: { color: '#FFF' },
  input: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1.2, borderColor: '#E6ECE8', paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, color: '#1E2B22', marginBottom: 12 },
  submitBtn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
});