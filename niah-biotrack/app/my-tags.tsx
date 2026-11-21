import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import type { File } from 'expo-file-system';
import { useAuthRole } from '../src/context/AuthRoleContext';
import { useRecordStore } from '../src/store/useRecordStore';
import { cachedMyTags, fetchMyTags, reserveTagsPdf, shareTagsPdf } from '../src/services/myTags';
import { isSyncOffline } from '../src/services/syncRetry';
import { NEW_TAG_COUNTS, groupBatches, tagCountsText, type MyTag } from '../src/utils/myTags';

// "My QR tags" (botanists, from Profile): the QR tags reserved by this botanist, unused or
// used (with the plant each is attached to), and "Get new tags": reserve 10 / 20 / 50 and get
// the PDF of QR labels to print. Uses the existing endpoints, which only let a botanist reserve
// and see their own tags. Needs the internet; offline it shows the list saved on this phone.

function dayText(value: string | null | undefined): string {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time)
    ? ''
    : new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function MyTagsScreen() {
  const router = useRouter();
  const { role } = useAuthRole();
  const records = useRecordStore((state) => state.records);

  const [tags, setTags] = useState<MyTag[] | null>(null);
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState<number>(NEW_TAG_COUNTS[0]);
  const [working, setWorking] = useState(false);
  // The last PDF made here (to share again), and a request to retry after a failure.
  const [pdf, setPdf] = useState<File | null>(null);
  const [retry, setRetry] = useState<{ count: number; requestId: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    if (await isSyncOffline()) {
      const saved = await cachedMyTags();
      setTags(saved?.tags ?? []);
      setOfflineNote(
        saved
          ? `You are offline. Showing your tags as of ${dayText(saved.savedAt)}.`
          : 'You are offline. Connect to the internet to see your tags.'
      );
      setLoading(false);
      return;
    }
    try {
      setTags(await fetchMyTags());
      setOfflineNote(null);
    } catch {
      const saved = await cachedMyTags();
      setTags(saved?.tags ?? []);
      setOfflineNote('Your tags could not be loaded. Showing the ones saved on this phone.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // The plant a used tag is attached to, if it is on this phone.
  const plantFor = (serverId: string | null) =>
    serverId ? records.find((record) => record.serverId === serverId) ?? null : null;

  const share = async (file: File) => {
    const result = await shareTagsPdf(file);
    Toast.show(
      result.ok
        ? { type: 'success', text1: 'QR labels ready', text2: result.message, position: 'bottom' }
        : { type: 'error', text1: 'Not shared', text2: result.reason, position: 'bottom' }
    );
  };

  const getTags = async (howMany: number, requestId?: string) => {
    setWorking(true);
    setProblem(null);
    const result = await reserveTagsPdf(howMany, requestId);
    setWorking(false);
    if (!result.ok) {
      setProblem(result.reason);
      // Retrying with the same request gives the same tags, never extra ones.
      setRetry({ count: howMany, requestId: result.requestId });
      return;
    }
    setRetry(null);
    setPdf(result.file);
    Toast.show({ type: 'success', text1: `${howMany} tags reserved`, text2: 'Share or save the PDF to print the labels.', position: 'bottom' });
    void load();
    await share(result.file);
  };

  if (role !== 'botanist') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <Text style={styles.body}>Only botanists have QR tags.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const batches = groupBatches(tags ?? []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.navSide} accessibilityLabel="Back">
          <Text style={styles.backChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>My QR tags</Text>
        <View style={styles.navSide} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Tags reserved for you. Print the labels, tie one to a plant, then scan it when you register the plant or
          with "Attach tag" on its page. Only your own tags can be attached.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Get new tags</Text>
          <View style={styles.countRow}>
            {NEW_TAG_COUNTS.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.countChip, count === option && styles.countChipOn]}
                onPress={() => setCount(option)}
                accessibilityRole="radio"
                accessibilityState={{ selected: count === option }}
              >
                <Text style={[styles.countText, count === option && styles.countTextOn]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.primaryBtn, working && styles.disabled]}
            onPress={() => void getTags(count)}
            disabled={working}
            accessibilityRole="button"
          >
            {working ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Get {count} new tags</Text>}
          </TouchableOpacity>
          <Text style={styles.hint}>
            Needs the internet. You get a PDF of QR labels to{' '}
            {Platform.OS === 'ios' ? 'print or send from the share sheet' : 'save, then open to print or send'}.
          </Text>
          {problem ? <Text style={styles.problem}>{problem}</Text> : null}
          {retry ? (
            <TouchableOpacity onPress={() => void getTags(retry.count, retry.requestId)} disabled={working} accessibilityRole="button">
              <Text style={styles.link}>Try again (same {retry.count} tags)</Text>
            </TouchableOpacity>
          ) : null}
          {pdf ? (
            <TouchableOpacity onPress={() => void share(pdf)} accessibilityRole="button">
              <Text style={styles.link}>Share PDF</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {offlineNote ? <Text style={styles.note}>{offlineNote}</Text> : null}

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Your tags</Text>
          {tags && tags.length > 0 ? <Text style={styles.counts}>{tagCountsText(tags)}</Text> : null}
        </View>

        {loading && tags === null ? <ActivityIndicator color="#213B2A" /> : null}
        {tags !== null && tags.length === 0 && !loading ? (
          <Text style={styles.body}>No tags yet. Use "Get new tags" to reserve and print some.</Text>
        ) : null}

        {batches.map((batch) => (
          <View key={batch.requestId} style={styles.card}>
            <View style={styles.batchHeader}>
              <Text style={styles.batchTitle}>
                {batch.tags.length} {batch.tags.length === 1 ? 'tag' : 'tags'} · {dayText(batch.reservedAt)}
              </Text>
              {batch.unused > 0 ? (
                <TouchableOpacity
                  onPress={() => void getTags(batch.tags.length, batch.requestId)}
                  disabled={working}
                  accessibilityRole="button"
                  accessibilityLabel={`Print again: ${batch.tags.length} tags reserved on ${dayText(batch.reservedAt)}`}
                >
                  <Text style={styles.link}>Print again</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {batch.tags.map((tag) => {
              const plant = plantFor(tag.boundPlantId);
              return (
                <TouchableOpacity
                  key={tag.tag}
                  style={styles.tagRow}
                  disabled={!plant}
                  onPress={() => plant && router.push({ pathname: '/plant-detail', params: { id: plant.id } })}
                  accessibilityRole={plant ? 'button' : undefined}
                >
                  <Text style={styles.tagCode}>{tag.tag}</Text>
                  {tag.boundPlantId ? (
                    <Text style={styles.tagUsed} numberOfLines={1}>
                      Used{plant ? ` · ${plant.scientificName || 'Identification pending'}` : ' · on a plant'}
                    </Text>
                  ) : (
                    <Text style={styles.tagUnused}>Unused</Text>
                  )}
                  {plant ? <Ionicons name="chevron-forward" size={16} color="#76877B" /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  navSide: { width: 32 },
  backChevron: { fontSize: 32, color: '#213B2A' },
  navTitle: { fontSize: 17, fontWeight: '800', color: '#1E2B22' },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  intro: { fontSize: 13, color: '#526158', lineHeight: 19, marginBottom: 14 },
  body: { fontSize: 13.5, color: '#526158', lineHeight: 19 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1.2, borderColor: '#E6ECE8', padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#1E2B22', marginBottom: 10 },
  countRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  countChip: { flex: 1, height: 42, borderRadius: 21, borderWidth: 1.2, borderColor: '#213B2A', justifyContent: 'center', alignItems: 'center' },
  countChipOn: { backgroundColor: '#213B2A' },
  countText: { fontSize: 15, fontWeight: '800', color: '#213B2A' },
  countTextOn: { color: '#FFFFFF' },
  primaryBtn: { height: 48, borderRadius: 24, backgroundColor: '#213B2A', justifyContent: 'center', alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.6 },
  hint: { fontSize: 12, color: '#68776D', marginTop: 8, lineHeight: 17 },
  problem: { fontSize: 13, fontWeight: '700', color: '#9B1C1C', marginTop: 10 },
  link: { fontSize: 13.5, fontWeight: '700', color: '#213B2A', textDecorationLine: 'underline', marginTop: 10 },
  note: { fontSize: 12.5, fontWeight: '600', color: '#8C5E03', marginBottom: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6, marginBottom: 10, gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#1E2B22' },
  counts: { fontSize: 12.5, color: '#68776D' },
  batchHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  batchTitle: { fontSize: 13.5, fontWeight: '700', color: '#1E2B22', flexShrink: 1 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#EEF2EF', marginTop: 6 },
  tagCode: { fontSize: 13.5, fontWeight: '700', color: '#1E2B22', fontVariant: ['tabular-nums'] },
  tagUsed: { flex: 1, fontSize: 12.5, color: '#68776D' },
  tagUnused: { flex: 1, fontSize: 12.5, fontWeight: '700', color: '#215A36' },
});
