import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import type { File } from 'expo-file-system';
import { useAuthRole } from '../src/context/AuthRoleContext';
import { useRecordStore } from '../src/store/useRecordStore';
import {
  cachedMyTags,
  fetchMyTags,
  printTagsPdf,
  reserveTags,
  saveTagImages,
  shareTagsPdf,
} from '../src/services/myTags';
import { isSyncOffline } from '../src/services/syncRetry';
import {
  DEFAULT_TAG_COUNT,
  MAX_PRINT_TAGS,
  PRINT_LAYOUTS,
  batchCountsText,
  batchLabel,
  groupBatches,
  initiallyOpenBatches,
  parseTagCount,
  printPlan,
  stepTagCount,
  tagCountsText,
  toggleSelected,
  type MyTag,
  type PrintLayout,
} from '../src/utils/myTags';

// "My QR tags" (botanists, from Profile): the QR tags reserved by this botanist.
//   - Get new tags: how many (1–100, typed or − / +), then "Get N tags" (no layout yet).
//   - Your tags: one collapsible section per reservation ("Today · 10 tags", newest open),
//     "N used · M unused", and "Print" for that batch. Each tag: checkbox, tag, Unused/Used,
//     and the plant a used tag is on (tap opens it).
//   - Choosing tags shows "N selected · Clear · Print N": it prints exactly those tags, from
//     any batches (POST /api/tag-reservations/print).
//   - Every print opens "Print N tags": Sheet of labels (default), One label per page, or
//     Images (one PNG per tag), then Print / Cancel.
// The endpoints only let a botanist reserve, see and print their own tags. Needs the
// internet; offline it shows the list saved on this phone.

function dayText(value: string | null | undefined): string {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time)
    ? ''
    : new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

type PrintRequest = { tags: string[]; title: string; clearSelection: boolean };

export default function MyTagsScreen() {
  const router = useRouter();
  const { role } = useAuthRole();
  const records = useRecordStore((state) => state.records);

  const [tags, setTags] = useState<MyTag[] | null>(null);
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // "Get new tags": the typed number, and a failed request to retry with the same id.
  const [countText, setCountText] = useState(String(DEFAULT_TAG_COUNT));
  const [countError, setCountError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [retry, setRetry] = useState<{ count: number; requestId: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The last PDF made here (to share again).
  const [pdf, setPdf] = useState<File | null>(null);
  // Batches open (newest open at first), and the tags chosen to print.
  const [openBatches, setOpenBatches] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // The "Print N tags" sheet.
  const [printing, setPrinting] = useState<PrintRequest | null>(null);
  const [layout, setLayout] = useState<PrintLayout>('sheet');

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

  const batches = groupBatches(tags ?? []);

  // The newest batch starts open; the others collapsed (once, when the list first arrives).
  useEffect(() => {
    if (openBatches === null && tags !== null) setOpenBatches(initiallyOpenBatches(batches));
  }, [tags]);

  // The plant a used tag is attached to, if it is on this phone.
  const plantFor = (serverId: string | null) =>
    serverId ? records.find((record) => record.serverId === serverId) ?? null : null;

  const sharePdf = async (file: File) => {
    const result = await shareTagsPdf(file);
    Toast.show(
      result.ok
        ? { type: 'success', text1: 'QR labels ready', text2: result.message, position: 'bottom' }
        : { type: 'error', text1: 'Not shared', text2: result.reason, position: 'bottom' }
    );
  };

  // Opens "Print N tags" for exactly these tags (a batch's, or the ones chosen).
  const openPrint = (request: PrintRequest) => {
    if (request.tags.length === 0) return;
    setLayout('sheet');
    setPrinting(request);
  };

  const getTags = async (howMany: number, requestId?: string) => {
    setWorking(true);
    setProblem(null);
    const result = await reserveTags(howMany, requestId);
    setWorking(false);
    if (!result.ok) {
      setProblem(result.reason);
      // Retrying with the same request gives the same tags, never extra ones.
      setRetry({ count: howMany, requestId: result.requestId });
      return;
    }
    setRetry(null);
    Toast.show({ type: 'success', text1: `${howMany} tags reserved`, text2: 'Choose how to print them.', position: 'bottom' });
    await load();
    setOpenBatches((current) => [result.requestId, ...(current ?? [])]);
    const plan = printPlan({ kind: 'selection', selected: result.tags }, 'sheet');
    openPrint({ tags: plan.tags, title: plan.title, clearSelection: false });
  };

  const submitCount = () => {
    const parsed = parseTagCount(countText);
    if (!parsed.ok) {
      setCountError(parsed.message);
      return;
    }
    setCountError(null);
    void getTags(parsed.value);
  };

  // Print: exactly the tags of the request, in the chosen layout.
  const runPrint = async () => {
    if (!printing) return;
    const request = printing;
    const plan = printPlan({ kind: 'selection', selected: request.tags }, layout);
    setWorking(true);
    if (plan.layout === 'images') {
      const byTag = new Map((tags ?? []).map((tag) => [tag.tag, tag]));
      const result = await saveTagImages(plan.tags.map((tag) => byTag.get(tag) ?? { tag, boundPlantId: null }));
      setWorking(false);
      Toast.show(
        result.ok
          ? { type: 'success', text1: 'Tag images ready', text2: result.message, position: 'bottom' }
          : { type: 'error', text1: 'Not saved', text2: result.reason, position: 'bottom' }
      );
      if (!result.ok) return;
    } else {
      const result = await printTagsPdf(plan.tags, plan.layout);
      setWorking(false);
      if (!result.ok) {
        Toast.show({ type: 'error', text1: 'Not printed', text2: result.reason, position: 'bottom' });
        return;
      }
      setPdf(result.file);
      setPrinting(null);
      if (request.clearSelection) setSelected([]);
      await sharePdf(result.file);
      return;
    }
    setPrinting(null);
    if (request.clearSelection) setSelected([]);
  };

  const choose = (tag: string) => {
    if (!selected.includes(tag) && selected.length >= MAX_PRINT_TAGS) {
      Toast.show({ type: 'info', text1: `Up to ${MAX_PRINT_TAGS} tags at a time`, position: 'bottom' });
      return;
    }
    setSelected((current) => toggleSelected(current, tag));
  };

  const toggleBatch = (requestId: string) =>
    setOpenBatches((current) =>
      (current ?? []).includes(requestId) ? (current ?? []).filter((id) => id !== requestId) : [...(current ?? []), requestId]
    );

  if (role !== 'botanist') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <Text style={styles.body}>Only botanists have QR tags.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const parsedCount = parseTagCount(countText);
  const selectionPlan = printPlan({ kind: 'selection', selected }, 'sheet');

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
          <Text style={styles.label}>How many (1–100)</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => {
                setCountText(stepTagCount(countText, -1));
                setCountError(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="One tag fewer"
            >
              <Ionicons name="remove" size={20} color="#213B2A" />
            </TouchableOpacity>
            <TextInput
              style={[styles.countInput, countError && styles.countInputError]}
              value={countText}
              onChangeText={(text) => {
                setCountText(text.replace(/[^0-9]/g, '').slice(0, 3));
                setCountError(null);
              }}
              keyboardType="number-pad"
              maxLength={3}
              accessibilityLabel="Number of tags"
              selectTextOnFocus
            />
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => {
                setCountText(stepTagCount(countText, 1));
                setCountError(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="One tag more"
            >
              <Ionicons name="add" size={20} color="#213B2A" />
            </TouchableOpacity>
          </View>
          {countError ? <Text style={styles.problem}>{countError}</Text> : null}
          <TouchableOpacity
            style={[styles.primaryBtn, (working || !parsedCount.ok) && styles.disabled]}
            onPress={submitCount}
            disabled={working}
            accessibilityRole="button"
          >
            {working && !printing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryText} numberOfLines={1}>
                {parsedCount.ok ? `Get ${parsedCount.value} ${parsedCount.value === 1 ? 'tag' : 'tags'}` : 'Get tags'}
              </Text>
            )}
          </TouchableOpacity>
          <Text style={styles.hint}>Needs the internet. You choose how to print them next.</Text>
          {problem ? <Text style={styles.problem}>{problem}</Text> : null}
          {retry ? (
            <TouchableOpacity onPress={() => void getTags(retry.count, retry.requestId)} disabled={working} accessibilityRole="button">
              <Text style={styles.link}>Try again (same {retry.count} tags)</Text>
            </TouchableOpacity>
          ) : null}
          {pdf ? (
            <TouchableOpacity onPress={() => void sharePdf(pdf)} accessibilityRole="button">
              <Text style={styles.link}>Share PDF</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {offlineNote ? <Text style={styles.note}>{offlineNote}</Text> : null}

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Your tags</Text>
          {tags && tags.length > 0 ? <Text style={styles.counts} numberOfLines={1}>{tagCountsText(tags)}</Text> : null}
        </View>

        {loading && tags === null ? <ActivityIndicator color="#213B2A" /> : null}
        {tags !== null && tags.length === 0 && !loading ? (
          <Text style={styles.body}>No tags yet. Use "Get new tags" to reserve and print some.</Text>
        ) : null}

        {batches.map((batch) => {
          const open = (openBatches ?? []).includes(batch.requestId);
          return (
            <View key={batch.requestId} style={styles.card}>
              <View style={styles.batchHeader}>
                <TouchableOpacity
                  style={styles.batchToggle}
                  onPress={() => toggleBatch(batch.requestId)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${batchLabel(batch)}, ${batchCountsText(batch)}`}
                >
                  <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color="#213B2A" />
                  <View style={styles.batchText}>
                    <Text style={styles.batchTitle} numberOfLines={1}>{batchLabel(batch)}</Text>
                    <Text style={styles.batchCounts} numberOfLines={1}>{batchCountsText(batch)}</Text>
                  </View>
                </TouchableOpacity>
                {/* While tags are chosen, the bar at the bottom is the one Print (only those tags). */}
                {selected.length === 0 ? (
                  <TouchableOpacity
                    style={styles.batchPrint}
                    onPress={() => {
                      const plan = printPlan({ kind: 'batch', batch }, 'sheet');
                      openPrint({ tags: plan.tags, title: plan.title, clearSelection: false });
                    }}
                    disabled={working}
                    accessibilityRole="button"
                    accessibilityLabel={`Print ${batchLabel(batch)}`}
                  >
                    <Text style={styles.batchPrintText}>Print</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {open
                ? batch.tags.map((tag) => {
                    const plant = plantFor(tag.boundPlantId);
                    const isChosen = selected.includes(tag.tag);
                    return (
                      <View key={tag.tag} style={styles.tagRow}>
                        <TouchableOpacity
                          onPress={() => choose(tag.tag)}
                          hitSlop={8}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: isChosen }}
                          accessibilityLabel={`Choose ${tag.tag}`}
                        >
                          <Ionicons name={isChosen ? 'checkbox' : 'square-outline'} size={22} color="#213B2A" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.tagMain}
                          disabled={!plant}
                          onPress={() => plant && router.push({ pathname: '/plant-detail', params: { id: plant.id } })}
                          accessibilityRole={plant ? 'button' : undefined}
                        >
                          <Text style={styles.tagCode} numberOfLines={1}>{tag.tag}</Text>
                          <View style={[styles.badge, tag.boundPlantId ? styles.badgeUsed : styles.badgeUnused]}>
                            <Text style={[styles.badgeText, tag.boundPlantId ? styles.badgeUsedText : styles.badgeUnusedText]}>
                              {tag.boundPlantId ? 'Used' : 'Unused'}
                            </Text>
                          </View>
                          {tag.boundPlantId ? (
                            <Text style={styles.tagPlant} numberOfLines={1}>
                              {plant ? plant.scientificName || 'Identification pending' : 'on a plant'}
                            </Text>
                          ) : (
                            <View style={styles.flexFill} />
                          )}
                          {plant ? <Ionicons name="chevron-forward" size={16} color="#76877B" /> : null}
                        </TouchableOpacity>
                      </View>
                    );
                  })
                : null}
            </View>
          );
        })}
      </ScrollView>

      {/* Chosen tags: "N selected · Clear · Print N" prints exactly those tags. */}
      {selected.length > 0 ? (
        <View style={styles.printBar}>
          <Text style={styles.printBarText} numberOfLines={1}>{selected.length} selected</Text>
          <TouchableOpacity onPress={() => setSelected([])} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.printBarBtn, working && styles.disabled]}
            onPress={() => openPrint({ tags: selectionPlan.tags, title: selectionPlan.title, clearSelection: true })}
            disabled={working}
            accessibilityRole="button"
          >
            <Text style={styles.printBarBtnText} numberOfLines={1}>Print {selectionPlan.tags.length}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* "Print N tags": the layout, then Print / Cancel. */}
      <Modal visible={printing !== null} transparent animationType="slide" onRequestClose={() => setPrinting(null)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => !working && setPrinting(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{printing?.title ?? ''}</Text>
            {PRINT_LAYOUTS.map((option) => {
              const on = layout === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.layoutOption, on && styles.layoutOptionOn]}
                  onPress={() => setLayout(option.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color="#213B2A" />
                  <View style={styles.layoutTextBox}>
                    <Text style={styles.layoutLabel}>{option.label}</Text>
                    <Text style={styles.layoutHint}>{option.hint}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={styles.sheetCancel}
                onPress={() => setPrinting(null)}
                disabled={working}
                accessibilityRole="button"
              >
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sheetPrint, working && styles.disabled]}
                onPress={() => void runPrint()}
                disabled={working}
                accessibilityRole="button"
              >
                {working ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Print</Text>}
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>
              {Platform.OS === 'ios'
                ? 'Print or send it from the share sheet.'
                : 'Saved into a folder you pick; open it from Files to print or send.'}
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8F6', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  navSide: { width: 32 },
  backChevron: { fontSize: 32, color: '#213B2A' },
  navTitle: { fontSize: 17, fontWeight: '800', color: '#1E2B22' },
  content: { paddingHorizontal: 20, paddingBottom: 100 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  intro: { fontSize: 13, color: '#526158', lineHeight: 19, marginBottom: 14 },
  body: { fontSize: 13.5, color: '#526158', lineHeight: 19 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1.2, borderColor: '#E6ECE8', padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#1E2B22', marginBottom: 10 },
  label: { fontSize: 12.5, fontWeight: '700', color: '#526158', marginBottom: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.2, borderColor: '#213B2A', justifyContent: 'center', alignItems: 'center' },
  countInput: { flex: 1, minWidth: 0, height: 44, borderRadius: 22, borderWidth: 1.2, borderColor: '#E6ECE8', backgroundColor: '#FFFFFF', textAlign: 'center', fontSize: 17, fontWeight: '800', color: '#1E2B22' },
  countInputError: { borderColor: '#9B1C1C' },
  primaryBtn: { height: 48, borderRadius: 24, backgroundColor: '#213B2A', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  primaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.6 },
  hint: { fontSize: 12, color: '#68776D', marginTop: 8, lineHeight: 17 },
  problem: { fontSize: 13, fontWeight: '700', color: '#9B1C1C', marginTop: 4, marginBottom: 8 },
  link: { fontSize: 13.5, fontWeight: '700', color: '#213B2A', textDecorationLine: 'underline', marginTop: 10 },
  note: { fontSize: 12.5, fontWeight: '600', color: '#8C5E03', marginBottom: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6, marginBottom: 10, gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#1E2B22' },
  counts: { flexShrink: 1, fontSize: 12.5, color: '#68776D' },
  batchHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  batchToggle: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  batchText: { flex: 1, minWidth: 0 },
  batchTitle: { fontSize: 14, fontWeight: '800', color: '#1E2B22' },
  batchCounts: { fontSize: 12.5, color: '#68776D', marginTop: 2 },
  batchPrint: { borderWidth: 1.2, borderColor: '#213B2A', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  batchPrintText: { fontSize: 13, fontWeight: '800', color: '#213B2A' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#EEF2EF', marginTop: 4 },
  tagMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  tagCode: { flexShrink: 0, fontSize: 13.5, fontWeight: '700', color: '#1E2B22', fontVariant: ['tabular-nums'] },
  badge: { borderRadius: 10, paddingVertical: 2, paddingHorizontal: 8 },
  badgeUnused: { backgroundColor: '#E4F2E7' },
  badgeUsed: { backgroundColor: '#EEF1EF' },
  badgeText: { fontSize: 11.5, fontWeight: '700' },
  badgeUnusedText: { color: '#215A36' },
  badgeUsedText: { color: '#4A5A50' },
  tagPlant: { flex: 1, minWidth: 0, fontSize: 12.5, fontStyle: 'italic', color: '#526158' },
  flexFill: { flex: 1 },
  printBar: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#E6ECE8', backgroundColor: '#FFFFFF' },
  printBarText: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '800', color: '#1E2B22' },
  clearText: { fontSize: 13.5, fontWeight: '700', color: '#213B2A', textDecorationLine: 'underline' },
  printBarBtn: { height: 42, borderRadius: 21, backgroundColor: '#213B2A', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18 },
  printBarBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 25, 19, 0.45)' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 32 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#1E2B22', marginBottom: 12 },
  layoutOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1.2, borderColor: '#E6ECE8', marginBottom: 8 },
  layoutOptionOn: { borderColor: '#213B2A', backgroundColor: '#F1F6F2' },
  layoutTextBox: { flex: 1, minWidth: 0 },
  layoutLabel: { fontSize: 14, fontWeight: '800', color: '#1E2B22' },
  layoutHint: { fontSize: 12, color: '#68776D', marginTop: 2 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  sheetCancel: { flex: 1, height: 48, borderRadius: 24, borderWidth: 1.2, borderColor: '#213B2A', justifyContent: 'center', alignItems: 'center' },
  sheetCancelText: { fontSize: 15, fontWeight: '800', color: '#213B2A' },
  sheetPrint: { flex: 1, height: 48, borderRadius: 24, backgroundColor: '#213B2A', justifyContent: 'center', alignItems: 'center' },
});
