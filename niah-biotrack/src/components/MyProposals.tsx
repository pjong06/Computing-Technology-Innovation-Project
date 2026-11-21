import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { SyncStatus } from '../store/useRecordStore';
import { useProposalStore, type SpeciesProposal } from '../store/useProposalStore';
import { recordRowBadge, reviewOutcomeBadge } from '../utils/reviewStatus';
import { proposalOutcome, rowStatus } from '../utils/recordsList';

// "My species proposals" on Home (moved from the Records tab): newest first, one status badge
// and the officer's reason. Tap a proposal for its details; one that did not upload has
// Retry upload, and one that failed can be removed.

function formatDate(value?: string): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timestampFor(value?: string): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

export default function MyProposals() {
  const router = useRouter();
  const proposals = useProposalStore((state) => state.proposals);
  const syncProposal = useProposalStore((state) => state.syncProposal);
  const removeProposal = useProposalStore((state) => state.removeProposal);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const retry = async (id: string) => {
    setRetryingId(id);
    const result = await syncProposal(id);
    setRetryingId(null);
    Toast.show(
      result.ok
        ? { type: 'success', text1: 'Proposal uploaded', text2: 'Waiting for review by an officer.', position: 'bottom' }
        : { type: 'error', text1: 'Upload failed', text2: result.reason, position: 'bottom' }
    );
  };

  const remove = (proposal: SpeciesProposal) => {
    void removeProposal(proposal.id)
      .then(() => Toast.show({ type: 'success', text1: 'Proposal removed', position: 'bottom' }))
      .catch(() => Toast.show({ type: 'error', text1: 'Could not remove the proposal.', position: 'bottom' }));
  };

  const sorted = [...proposals].sort((a, b) => timestampFor(b.createdAt) - timestampFor(a.createdAt));

  return (
    <View style={styles.section}>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionHeading}>My species proposals</Text>
        <TouchableOpacity
          onPress={() => router.push('/species-reference' as any)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Browse the species list"
        >
          <Text style={styles.link}>Browse species</Text>
        </TouchableOpacity>
      </View>

      {sorted.length === 0 ? (
        <Text style={styles.empty}>
          No proposals yet. Use Propose species when a plant is not in the species list.
        </Text>
      ) : (
        sorted.map((proposal) => {
          const outcome = proposalOutcome(proposal.review);
          const status = rowStatus({ syncStatus: proposal.syncStatus, outcome });
          const badge = recordRowBadge(status, reviewOutcomeBadge(outcome, 'Waiting for review'));
          const notSent = proposal.syncStatus !== SyncStatus.UPLOADED;
          const expanded = expandedId === proposal.id;
          const reason =
            status.action === 'needs_changes'
              ? `Officer's reason: ${proposal.reviewComment?.trim() || 'No reason was given.'}`
              : null;
          return (
            <TouchableOpacity
              key={proposal.id}
              style={styles.card}
              activeOpacity={0.75}
              onPress={() => setExpandedId(expanded ? null : proposal.id)}
              accessibilityRole="button"
              accessibilityLabel={`Species proposal: ${proposal.scientificName}, ${badge.label}`}
            >
              <View style={styles.topRow}>
                <Text style={styles.name} numberOfLines={2}>{proposal.scientificName}</Text>
                <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.badgeText, { color: badge.text }]} numberOfLines={1}>{badge.label}</Text>
                </View>
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {[proposal.commonName, formatDate(proposal.createdAt)].filter(Boolean).join(' · ')}
              </Text>
              {reason ? <Text style={styles.reason}>{reason}</Text> : null}
              {notSent && !expanded ? <Text style={styles.hint}>Tap to retry the upload.</Text> : null}

              {expanded ? (
                <View style={styles.details}>
                  {proposal.localName ? <Text style={styles.detail}>Local name: {proposal.localName}</Text> : null}
                  {proposal.family ? <Text style={styles.detail}>Family: {proposal.family}</Text> : null}
                  {proposal.description ? (
                    <Text style={styles.detail}>Description: {proposal.description}</Text>
                  ) : null}
                  {proposal.habitat ? <Text style={styles.detail}>Habitat: {proposal.habitat}</Text> : null}
                  {notSent ? (
                    <View style={styles.actions}>
                      {retryingId === proposal.id ? (
                        <ActivityIndicator size="small" color="#213B2A" />
                      ) : (
                        <TouchableOpacity onPress={() => void retry(proposal.id)} hitSlop={8} accessibilityRole="button">
                          <Text style={styles.action}>Retry upload</Text>
                        </TouchableOpacity>
                      )}
                      {proposal.syncStatus === SyncStatus.FAILED && retryingId !== proposal.id ? (
                        <TouchableOpacity onPress={() => remove(proposal)} hitSlop={8} accessibilityRole="button">
                          <Text style={[styles.action, styles.remove]}>Remove</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8, marginBottom: 16 },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  sectionHeading: { fontSize: 15, fontWeight: '700', color: '#1E2B22', flexShrink: 1 },
  link: { fontSize: 12.5, fontWeight: '600', color: '#526659' },
  empty: { fontSize: 12.5, color: '#68776D', lineHeight: 17 },
  card: {
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 8,
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  name: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700', fontStyle: 'italic', color: '#1E2B22' },
  badge: { flexShrink: 0, maxWidth: '55%', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 12, color: '#68776D', marginTop: 4 },
  reason: { fontSize: 12, fontWeight: '600', color: '#9B1C1C', marginTop: 6 },
  hint: { fontSize: 12, fontWeight: '600', color: '#8C5E03', marginTop: 6 },
  details: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E6ECE8', gap: 4 },
  detail: { fontSize: 12.5, color: '#526158', lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 18, marginTop: 8, alignItems: 'center' },
  action: { fontSize: 13, fontWeight: '700', color: '#213B2A', textDecorationLine: 'underline' },
  remove: { color: '#9B1C1C' },
});
