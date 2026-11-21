import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import FormScrollView from '../src/components/FormScrollView';
import KeyboardDoneBar from '../src/components/KeyboardDoneBar';
import { useSpeciesStore } from '../src/store/useSpeciesStore';
import { useProposalStore } from '../src/store/useProposalStore';
import type { Species } from '../src/api/species';
import { useAuthRole } from '../src/context/AuthRoleContext';

const DONE_BAR_ID = 'propose-species-done';
const MAX_MATCHES = 5;

const normalise = (text: string | null | undefined) => (text ?? '').trim().toLowerCase();

// Approved species (from the list cached on this phone, so it works offline) that look
// like the one being proposed: same or overlapping scientific name, or the same common
// or local name.
function findSimilarSpecies(species: Species[], scientific: string, common: string, local: string): Species[] {
  const sci = normalise(scientific);
  const names = [normalise(common), normalise(local)].filter(Boolean);
  return species
    .filter((s) => {
      const existing = normalise(s.scientific_name);
      if (sci && (existing.includes(sci) || sci.includes(existing))) return true;
      return names.some((name) => name === normalise(s.common_name) || name === normalise(s.local_name));
    })
    .slice(0, MAX_MATCHES);
}

// Botanists can only REQUEST a new species. It's saved on the phone, uploaded as "pending",
// and only appears in the species list and New Record picker after an officer adds it.
// Opened with ?editId=<request id> for a request the officer did not add: the form is
// prefilled, and sending it again sets it back to waiting for review.
export default function ProposeSpeciesScreen() {
  const router = useRouter();
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const { role } = useAuthRole();
  const canPropose = role === 'botanist';

  // Only botanists can propose; everyone else is sent back (the server would refuse anyway).
  useEffect(() => {
    if (!canPropose) {
      Alert.alert('Botanist Access Required', 'Only botanists can request a new species.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }
  }, [canPropose]);

  const approvedSpecies = useSpeciesStore((state) => state.species);
  const proposals = useProposalStore((state) => state.proposals);
  const addProposal = useProposalStore((state) => state.addProposal);
  const syncProposal = useProposalStore((state) => state.syncProposal);
  const resubmitProposal = useProposalStore((state) => state.resubmitProposal);
  // The request being edited and sent again (only one the officer did not add).
  const editing = editId ? proposals.find((p) => p.id === editId && p.review === 'rejected') ?? null : null;

  const [scientificName, setScientificName] = useState('');
  const [commonName, setCommonName] = useState('');
  const [localName, setLocalName] = useState('');
  const [family, setFamily] = useState('');
  const [description, setDescription] = useState('');
  const [habitat, setHabitat] = useState('');
  const [error, setError] = useState('');
  // Similar approved species found on the last Save; the botanist confirms to continue.
  const [similar, setSimilar] = useState<Species[] | null>(null);
  const [saving, setSaving] = useState(false);

  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!editing || prefilled) return;
    setScientificName(editing.scientificName);
    setCommonName(editing.commonName ?? '');
    setLocalName(editing.localName ?? '');
    setFamily(editing.family ?? '');
    setDescription(editing.description ?? '');
    setHabitat(editing.habitat ?? '');
    setPrefilled(true);
  }, [editing, prefilled]);

  // Any edit means the similar-species check has to run again.
  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setSimilar(null);
    setError('');
  };

  const save = async (confirmedNotDuplicate: boolean) => {
    const name = scientificName.trim();
    if (!name) {
      setError('Enter the scientific name.');
      return;
    }
    // An exact name match can never be accepted by the server, so stop here.
    const exact = approvedSpecies.find((s) => normalise(s.scientific_name) === normalise(name));
    if (exact) {
      setError(`${exact.scientific_name} is already in the approved species list. Choose it in New Record instead.`);
      return;
    }
    if (proposals.some((p) => p.id !== editing?.id && normalise(p.scientificName) === normalise(name) && p.review !== 'rejected')) {
      setError('You have already requested this species.');
      return;
    }
    if (!confirmedNotDuplicate) {
      const matches = findSimilarSpecies(approvedSpecies, name, commonName, localName);
      if (matches.length > 0) {
        setSimilar(matches);
        return;
      }
    }

    setSaving(true);
    const details = {
      scientificName: name,
      commonName: commonName.trim() || undefined,
      localName: localName.trim() || undefined,
      family: family.trim() || undefined,
      description: description.trim() || undefined,
      habitat: habitat.trim() || undefined,
    };
    if (editing) {
      // Sent again straight away (needs a connection); it goes back to waiting for review.
      const resent = await resubmitProposal(editing.id, details);
      setSaving(false);
      if (!resent.ok) {
        setError(resent.reason);
        return;
      }
      Toast.show({ type: 'success', text1: 'Species request sent again', text2: 'Waiting for review by an officer.', position: 'bottom' });
      router.back();
      return;
    }
    const proposal = await addProposal({
      scientificName: name,
      commonName: commonName.trim() || undefined,
      localName: localName.trim() || undefined,
      family: family.trim() || undefined,
      description: description.trim() || undefined,
      habitat: habitat.trim() || undefined,
    }).catch(() => null);
    if (!proposal) {
      setSaving(false);
      setError('Could not save the request on this phone. Try again.');
      return;
    }
    // Try to send it now; if there's no signal it stays saved and goes up later.
    const result = await syncProposal(proposal.id);
    setSaving(false);

    Toast.show(
      result.ok
        ? { type: 'success', text1: 'Species request sent', text2: 'Waiting for review by an officer.', position: 'bottom' }
        : {
            type: 'error',
            text1: 'Saved, not uploaded yet',
            text2: `${result.reason} Use Retry upload in Recent activity on Home.`,
            position: 'bottom',
          }
    );
    router.back();
  };

  if (!canPropose) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.navSide}>
          <Text style={styles.backChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>{editing ? 'Edit species request' : 'Request a new species'}</Text>
        <View style={styles.navSide} />
      </View>

      <FormScrollView contentContainerStyle={styles.content}>
        {editing?.reviewComment ? (
          <Text style={styles.errorText}>Officer's reason: {editing.reviewComment}</Text>
        ) : null}
        <Text style={styles.intro}>
          Only for a species that isn't in the approved list. An officer will review it; until then it
          won't appear in the species list or in New Record.
        </Text>

        <Text style={styles.fieldLabel}>Scientific name *</Text>
        <TextInput
          style={[styles.input, error !== '' && styles.inputError]}
          placeholder="e.g. Nepenthes sp."
          placeholderTextColor="#8C9A91"
          value={scientificName}
          onChangeText={edit(setScientificName)}
          autoCorrect={false}
          autoCapitalize="sentences"
        />
        {error !== '' && <Text style={styles.errorText}>{error}</Text>}

        <Text style={styles.fieldLabel}>Common name</Text>
        <TextInput style={styles.input} value={commonName} onChangeText={edit(setCommonName)} placeholderTextColor="#8C9A91" />

        <Text style={styles.fieldLabel}>Local name</Text>
        <TextInput style={styles.input} value={localName} onChangeText={edit(setLocalName)} placeholderTextColor="#8C9A91" />

        <Text style={styles.fieldLabel}>Family</Text>
        <TextInput
          style={styles.input}
          value={family}
          onChangeText={edit(setFamily)}
          autoCorrect={false}
          placeholder="e.g. Nepenthaceae"
          placeholderTextColor="#8C9A91"
        />

        <Text style={styles.fieldLabel}>What it looks like</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          multiline
          value={description}
          onChangeText={edit(setDescription)}
          placeholder="Leaves, flowers, fruit, size..."
          placeholderTextColor="#8C9A91"
          inputAccessoryViewID={DONE_BAR_ID}
        />

        <Text style={styles.fieldLabel}>Habitat</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          multiline
          value={habitat}
          onChangeText={edit(setHabitat)}
          placeholder="e.g. limestone outcrops near cave mouths"
          placeholderTextColor="#8C9A91"
          inputAccessoryViewID={DONE_BAR_ID}
        />

        {similar && (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>This species may already exist</Text>
            <Text style={styles.warningText}>Check these approved species first:</Text>
            {similar.map((s) => (
              <Text key={s.id} style={styles.warningMatch}>
                • <Text style={styles.italic}>{s.scientific_name}</Text>
                {s.common_name ? ` (${s.common_name})` : ''}
              </Text>
            ))}
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => void save(true)} disabled={saving}>
              <Text style={styles.secondaryBtnText}>It's different — send anyway</Text>
            </TouchableOpacity>
          </View>
        )}

        {!similar && (
          <TouchableOpacity style={[styles.saveBtn, saving && styles.disabled]} onPress={() => void save(false)} disabled={saving}>
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>{editing ? 'Send again' : 'Send request'}</Text>}
          </TouchableOpacity>
        )}
      </FormScrollView>
      <KeyboardDoneBar nativeID={DONE_BAR_ID} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  navSide: { width: 32 },
  backChevron: { fontSize: 32, color: '#213B2A' },
  navTitle: { fontSize: 17, fontWeight: '700', color: '#1E2B22' },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  intro: { fontSize: 12.5, color: '#68776D', lineHeight: 18, marginBottom: 12 },
  fieldLabel: { fontSize: 12.5, fontWeight: '700', color: '#4E6254', marginBottom: 6, marginTop: 10 },
  input: { backgroundColor: '#FFFFFF', minHeight: 48, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, color: '#1E2B22', borderWidth: 1.2, borderColor: '#E6ECE8' },
  inputError: { borderColor: '#9B1C1C' },
  multiline: { height: 90, textAlignVertical: 'top' },
  errorText: { color: '#9B1C1C', fontSize: 12.5, marginTop: 6 },
  warningCard: { backgroundColor: '#FDF4D8', borderRadius: 16, padding: 14, marginTop: 18 },
  warningTitle: { fontSize: 14, fontWeight: '800', color: '#8C5E03', marginBottom: 4 },
  warningText: { fontSize: 12.5, color: '#6B4A06', marginBottom: 6 },
  warningMatch: { fontSize: 13, color: '#3E2F07', marginBottom: 2 },
  italic: { fontStyle: 'italic' },
  secondaryBtn: { marginTop: 12, height: 46, borderRadius: 23, borderWidth: 1.2, borderColor: '#8C5E03', justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' },
  secondaryBtnText: { color: '#8C5E03', fontWeight: '700', fontSize: 13.5 },
  saveBtn: { backgroundColor: '#213B2A', height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', marginTop: 24 },
  saveBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.6 },
});
