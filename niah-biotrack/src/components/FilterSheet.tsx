import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// The filter bottom sheet, its "Filter" button and the removable pills, shared by the
// Plants tab and Home's "Recent activity" so both look and work the same.

export interface FilterGroup {
  key: string;
  title: string;
  options: { value: string; label: string }[];
  selected: string;
}

// A bottom sheet with groups of options (one choice each), Reset and an apply button
// ("Show 12 plants"). The caller keeps the draft choices and applies them.
export function FilterSheet({
  visible,
  onClose,
  groups,
  onSelect,
  onReset,
  applyLabel,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  groups: FilterGroup[];
  onSelect: (groupKey: string, value: string) => void;
  onReset: () => void;
  applyLabel: string;
  onApply: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close the filter" />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Filter</Text>
        <ScrollView style={styles.sheetScroll}>
          {groups.map((group) => (
            <View key={group.key}>
              <Text style={styles.groupTitle}>{group.title}</Text>
              {group.options.map((option) => {
                const selected = group.selected === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={styles.optionRow}
                    onPress={() => onSelect(group.key, option.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selected ? '#213B2A' : '#8C9A91'}
                    />
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </ScrollView>
        <View style={styles.sheetActions}>
          <TouchableOpacity style={styles.resetBtn} onPress={onReset} accessibilityRole="button">
            <Text style={styles.resetText}>Reset</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.applyBtn} onPress={onApply} accessibilityRole="button">
            <Text style={styles.applyText} numberOfLines={1}>
              {applyLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// The removable pills under a heading or search box, one per active filter.
export function FilterPills({
  pills,
  onRemove,
}: {
  pills: { group: string; label: string }[];
  onRemove: (group: string) => void;
}) {
  if (pills.length === 0) return null;
  return (
    <View style={styles.pillRow}>
      {pills.map((pill) => (
        <TouchableOpacity
          key={pill.group}
          style={styles.pill}
          onPress={() => onRemove(pill.group)}
          accessibilityRole="button"
          accessibilityLabel={`Remove filter: ${pill.label}`}
        >
          <Text style={styles.pillText} numberOfLines={1}>
            {pill.label}
          </Text>
          <Ionicons name="close" size={14} color="#213B2A" />
        </TouchableOpacity>
      ))}
    </View>
  );
}

// The "Filter" button. "badge": the number in a small circle (Plants tab, next to the
// search box); "inline": "Filter · 2" (a compact button next to a heading).
export function FilterButton({
  count,
  onPress,
  variant = 'badge',
}: {
  count: number;
  onPress: () => void;
  variant?: 'badge' | 'inline';
}) {
  const active = count > 0;
  return (
    <TouchableOpacity
      style={[styles.filterBtn, variant === 'inline' && styles.filterBtnCompact, active && styles.filterBtnActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={active ? `Filter, ${count} active` : 'Filter'}
    >
      <Ionicons name="options-outline" size={variant === 'inline' ? 16 : 18} color={active ? '#FFFFFF' : '#213B2A'} />
      <Text style={[styles.filterText, active && styles.filterTextActive]}>
        {variant === 'inline' && active ? `Filter · ${count}` : 'Filter'}
      </Text>
      {variant === 'badge' && active ? (
        <View style={styles.filterCount}>
          <Text style={styles.filterCountText}>{count}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  filterBtn: {
    height: 46,
    borderRadius: 23,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.2,
    borderColor: '#213B2A',
    backgroundColor: '#FFFFFF',
  },
  filterBtnCompact: { height: 34, borderRadius: 17, paddingHorizontal: 12 },
  filterBtnActive: { backgroundColor: '#213B2A' },
  filterText: { fontSize: 13, fontWeight: '700', color: '#213B2A' },
  filterTextActive: { color: '#FFFFFF' },
  filterCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterCountText: { fontSize: 11, fontWeight: '800', color: '#213B2A' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    backgroundColor: '#DDEAE1',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  pillText: { fontSize: 12, fontWeight: '700', color: '#213B2A', flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '80%',
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D5DDD8', marginBottom: 10 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: '#1E2B22', marginBottom: 4 },
  sheetScroll: { flexGrow: 0 },
  groupTitle: { fontSize: 12, fontWeight: '800', color: '#68776D', letterSpacing: 0.5, marginTop: 14, marginBottom: 2 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  optionText: { fontSize: 14, color: '#3A4A40', flexShrink: 1 },
  optionTextSelected: { fontWeight: '700', color: '#1E2B22' },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  resetBtn: {
    flex: 1,
    minHeight: 46,
    paddingVertical: 8,
    borderRadius: 23,
    borderWidth: 1.2,
    borderColor: '#213B2A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resetText: { color: '#213B2A', fontWeight: '700', fontSize: 14, flexShrink: 1, textAlign: 'center' },
  applyBtn: {
    flex: 2,
    minHeight: 46,
    paddingVertical: 8,
    borderRadius: 23,
    backgroundColor: '#213B2A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  applyText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, flexShrink: 1, textAlign: 'center' },
});
