import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useRecordStore } from '../store/useRecordStore';
import { requeueLockedTagOperations, resumePausedRecordRetries } from '../services/offlineDatabase';
import { removePermanentProblems } from '../services/syncDetailsList';
import { ROW_ACTION_LABELS, type RowActionKind } from '../utils/rowActions';

// The actions of a row that needs the botanist (src/utils/rowActions.ts decides which), in
// Recent activity, the Plants list and plant detail Observations, so they behave the same:
//   Send for review · Edit · Edit and resend · Retry · Remove from phone (confirmed first).
// The buttons wrap onto the next line instead of overflowing.

interface Props {
  actions: RowActionKind[];
  recordId: string;
  // The observation the row is about (the registration record for a new plant); null when
  // the plant has none yet.
  obsId?: string | null;
  // The plant's registration (opens Register plant) rather than a later observation.
  isRegistration: boolean;
  disabled?: boolean;
}

export default function RowActions({ actions, recordId, obsId, isRegistration, disabled }: Props) {
  const router = useRouter();
  const syncRecord = useRecordStore((state) => state.syncRecord);
  const requestSubmit = useRecordStore((state) => state.requestSubmit);
  const submitForReview = useRecordStore((state) => state.submitForReview);
  const [busy, setBusy] = useState<RowActionKind | null>(null);

  if (actions.length === 0) return null;

  const showResult = (result: { ok: boolean; reason?: string }, success: string) =>
    Toast.show(
      result.ok
        ? { type: 'success', text1: success, position: 'bottom' }
        : { type: 'error', text1: 'Not sent yet', text2: result.reason, position: 'bottom' }
    );

  // Edit (a draft) and Edit and resend (sent back): the plant registration opens Register
  // plant; a later observation opens it in Record observation. Both show the officer's
  // reason at the top and send it for review again when saved.
  const openEditor = (resend: boolean) => {
    if (isRegistration || !obsId) {
      router.push({ pathname: '/new-record', params: { editId: recordId, ...(resend ? { resend: '1' } : {}) } } as any);
    } else {
      router.push({
        pathname: '/add-observation',
        params: { plantId: recordId, editObservationId: obsId, ...(resend ? { resend: '1' } : {}) },
      } as any);
    }
  };

  const run = async (action: RowActionKind) => {
    if (action === 'edit' || action === 'edit_resend') {
      openEditor(action === 'edit_resend');
      return;
    }
    if (action === 'remove') {
      Alert.alert(
        'Remove from phone?',
        'What can never upload for this record is deleted from this phone only. Nothing is deleted on the server. This can\'t be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              setBusy('remove');
              try {
                const removed = await removePermanentProblems(recordId, obsId);
                Toast.show(
                  removed > 0
                    ? { type: 'success', text1: 'Removed from phone', position: 'bottom' }
                    : { type: 'info', text1: 'Nothing to remove', text2: 'See Profile > Sync details.', position: 'bottom' }
                );
              } catch (error) {
                Toast.show({ type: 'error', text1: 'Could not remove it', text2: error instanceof Error ? error.message : undefined, position: 'bottom' });
              } finally {
                setBusy(null);
              }
            },
          },
        ]
      );
      return;
    }

    setBusy(action);
    try {
      if (action === 'send_for_review') {
        if (obsId) {
          showResult(await requestSubmit(recordId, obsId), 'Sent for review');
        } else {
          const result = await submitForReview(recordId);
          showResult(result.ok ? result.sync : result, 'Sent for review');
        }
      } else if (action === 'retry') {
        const record = useRecordStore.getState().records.find((item) => item.id === recordId);
        await resumePausedRecordRetries(recordId, record?.observations.map((visit) => visit.id) ?? []);
        await requeueLockedTagOperations(recordId);
        showResult(await syncRecord(recordId), 'Uploaded');
      }
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Something went wrong', text2: error instanceof Error ? error.message : undefined, position: 'bottom' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.actions}>
      {actions.map((action, index) =>
        busy === action ? (
          <ActivityIndicator key={action} size="small" color="#213B2A" />
        ) : (
          <TouchableOpacity
            key={action}
            style={[
              index === 0 && action !== 'remove' ? styles.primary : styles.secondary,
              action === 'remove' && styles.danger,
            ]}
            onPress={() => void run(action)}
            disabled={disabled || busy !== null}
            accessibilityRole="button"
          >
            <Text
              style={[
                index === 0 && action !== 'remove' ? styles.primaryText : styles.secondaryText,
                action === 'remove' && styles.dangerText,
              ]}
              numberOfLines={1}
            >
              {ROW_ACTION_LABELS[action]}
            </Text>
          </TouchableOpacity>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Wraps onto a new line when there isn't room; each button shrinks before it overflows.
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  primary: { maxWidth: '100%', backgroundColor: '#213B2A', borderRadius: 18, paddingVertical: 7, paddingHorizontal: 14 },
  primaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  secondary: { maxWidth: '100%', borderWidth: 1.2, borderColor: '#213B2A', borderRadius: 18, paddingVertical: 6, paddingHorizontal: 14 },
  secondaryText: { color: '#213B2A', fontSize: 13, fontWeight: '700' },
  danger: { borderColor: '#9B1C1C' },
  dangerText: { color: '#9B1C1C' },
});
