import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import Toast from 'react-native-toast-message';
import { useRecordStore } from '../src/store/useRecordStore';
import { useProposalStore } from '../src/store/useProposalStore';
import { removeOutboxOperation, retryOutboxOperation } from '../src/services/offlineDatabase';
import { loadSyncDetailRows, removeRefusedSubmit, type SyncDetailRow } from '../src/services/syncDetailsList';
import { attemptsText } from '../src/utils/syncDetails';

// Sync details (Profile > Sync details, and "Details" on a sync failure message): EVERY item
// that can make sync fail on this phone: changes waiting in the upload list (plants,
// observations, tags, species requests), photos that did not upload and observations whose
// "submit for review" was refused. Each shows what it is, the plant tag / name, how many
// times it was tried, the server's last answer as a code and in plain words. "Retry" only
// for answers that can change (network, server busy); "Remove from phone" (confirmed) for
// answers that never will. Removing deletes only the unsent item on this phone.

type Row = SyncDetailRow;

export default function SyncDetailsScreen() {
  const router = useRouter();
  const syncRecord = useRecordStore((state) => state.syncRecord);
  const removePhoto = useRecordStore((state) => state.removePhoto);
  const hydrateOfflineRecords = useRecordStore((state) => state.hydrateOfflineRecords);
  const syncProposal = useProposalStore((state) => state.syncProposal);
  const removeProposal = useProposalStore((state) => state.removeProposal);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await loadSyncDetailRows(useRecordStore.getState().records));
      setProblem(null);
    } catch (error) {
      setRows([]);
      setProblem(error instanceof Error ? error.message : 'The upload list could not be read on this phone.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const retry = async (row: Row) => {
    setBusyKey(row.key);
    try {
      let result: { ok: boolean; reason?: string } = { ok: true };
      if (row.target.type === 'photo' || row.target.type === 'submit') {
        result = await syncRecord(row.target.recordId);
      } else {
        await retryOutboxOperation(row.target.operationId);
        if (row.target.entityType === 'proposal') result = await syncProposal(row.target.clientRecordId);
        else if (row.target.recordId) result = await syncRecord(row.target.recordId);
      }
      Toast.show(
        result.ok
          ? { type: 'success', text1: 'Uploaded', position: 'bottom' }
          : { type: 'error', text1: 'Still not uploaded', text2: result.reason, position: 'bottom' }
      );
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not retry', text2: error instanceof Error ? error.message : undefined, position: 'bottom' });
    } finally {
      setBusyKey(null);
      await load();
    }
  };

  const remove = (row: Row) => {
    const what =
      row.target.type === 'photo'
        ? 'This photo will be deleted from this phone. It was never uploaded.'
        : row.target.type === 'submit'
          ? row.code === 'plant_deleted'
            ? 'This plant and its observations will be deleted from this phone. Nothing is deleted on the server.'
            : 'This observation will be deleted from this phone. Nothing is deleted on the server.'
          : row.target.entityType === 'proposal'
            ? 'This species request will be deleted from this phone. It was never uploaded.'
            : 'This change will be taken off the upload list and never sent. The record keeps the server copy if the server has it; otherwise it stays on this phone as a draft.';
    Alert.alert('Remove from phone?', `${row.kindLabel}: ${row.title}\n\n${what} This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusyKey(row.key);
          try {
            if (row.target.type === 'photo') {
              await removePhoto(row.target.recordId, row.target.uri, row.target.obsId);
            } else if (row.target.type === 'submit') {
              await removeRefusedSubmit(row.target.recordId, row.target.obsId, row.code);
            } else if (row.target.entityType === 'proposal') {
              await removeProposal(row.target.clientRecordId);
            } else {
              await removeOutboxOperation(row.target.operationId);
              await hydrateOfflineRecords();
            }
            Toast.show({ type: 'success', text1: 'Removed from phone', position: 'bottom' });
          } catch (error) {
            Toast.show({ type: 'error', text1: 'Could not remove it', text2: error instanceof Error ? error.message : undefined, position: 'bottom' });
          } finally {
            setBusyKey(null);
            await load();
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.navSide} accessibilityLabel="Back">
          <Text style={styles.backChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Sync details</Text>
        <View style={styles.navSide} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Everything on this phone that is still waiting to upload or could not upload (changes, photos and observations sent for review), and what the server last said about it.
        </Text>
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}

        {rows === null ? (
          <ActivityIndicator color="#213B2A" style={{ marginTop: 24 }} />
        ) : rows.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nothing waiting</Text>
            <Text style={styles.body}>Everything on this phone has been uploaded.</Text>
          </View>
        ) : (
          rows.map((row) => {
            const busy = busyKey === row.key;
            return (
              <View key={row.key} style={styles.card}>
                <View style={styles.topRow}>
                  <Text style={styles.kind}>{row.kindLabel.toUpperCase()}</Text>
                  <Text style={styles.code} numberOfLines={1}>{row.code}</Text>
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>{row.title}</Text>
                <Text style={styles.body}>{row.explanation}</Text>
                {row.attempts !== null ? <Text style={styles.hint}>{attemptsText(row.attempts)}</Text> : null}
                <View style={styles.actions}>
                  {busy ? (
                    <ActivityIndicator color="#213B2A" />
                  ) : (
                    <>
                      {/* Retry only when trying again can help (network, server busy, waiting). */}
                      {!row.final ? (
                        <TouchableOpacity onPress={() => void retry(row)} hitSlop={8} accessibilityRole="button" disabled={busyKey !== null}>
                          <Text style={styles.link}>Retry</Text>
                        </TouchableOpacity>
                      ) : null}
                      {row.final ? (
                        <TouchableOpacity onPress={() => remove(row)} hitSlop={8} accessibilityRole="button" disabled={busyKey !== null}>
                          <Text style={[styles.link, styles.danger]}>Remove from phone</Text>
                        </TouchableOpacity>
                      ) : null}
                    </>
                  )}
                </View>
              </View>
            );
          })
        )}
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
  intro: { fontSize: 13, color: '#526158', lineHeight: 19, marginBottom: 14 },
  problem: { fontSize: 13, fontWeight: '700', color: '#9B1C1C', marginBottom: 10 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1.2, borderColor: '#E6ECE8', padding: 14, marginBottom: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  kind: { fontSize: 11, fontWeight: '800', color: '#526158', letterSpacing: 0.6 },
  code: { flexShrink: 1, fontSize: 11.5, fontWeight: '700', color: '#8C5E03', fontVariant: ['tabular-nums'] },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#1E2B22', marginBottom: 6 },
  body: { fontSize: 13.5, color: '#526158', lineHeight: 19 },
  hint: { fontSize: 12, color: '#68776D', marginTop: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 20, marginTop: 10 },
  link: { fontSize: 13.5, fontWeight: '700', color: '#213B2A', textDecorationLine: 'underline' },
  danger: { color: '#9B1C1C' },
});
