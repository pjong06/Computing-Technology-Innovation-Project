import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import type { Species } from '../../src/api/species';
import { useSpeciesStore } from '../../src/store/useSpeciesStore';

const STATUS_LABELS: Record<string, string> = {
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
  DD: 'Data Deficient',
  NA: 'Not assessed',
};

const STATUS_ORDER = ['CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'NA'];

const statusCode = (species: Species) =>
  species.conservation_status?.trim() || 'NA';

const statusLabel = (code: string) => STATUS_LABELS[code] ?? code;

const getStatusColor = (code: string) => {
  switch (code) {
    case 'CR':
    case 'EN':
      return {
        backgroundColor: '#FDE2E2',
        textColor: '#9B1C1C',
      };

    case 'VU':
    case 'NT':
      return {
        backgroundColor: '#FEF08A',
        textColor: '#854D0E',
      };

    case 'LC':
      return {
        backgroundColor: '#E4F2E7',
        textColor: '#215A36',
      };

    default:
      return {
        backgroundColor: '#EEF1EF',
        textColor: '#5B6B60',
      };
  }
};

export default function SpeciesReferenceBookScreen() {
  const router = useRouter();

  const species = useSpeciesStore((state) => state.species);
  const loading = useSpeciesStore((state) => state.loading);
  const error = useSpeciesStore((state) => state.error);
  const lastUpdated = useSpeciesStore((state) => state.lastUpdated);
  const loadSpecies = useSpeciesStore((state) => state.loadSpecies);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    void loadSpecies();
  }, [loadSpecies]);

  const statusOptions = useMemo(() => {
    const codes = new Set(species.map(statusCode));

    const knownCodes = STATUS_ORDER.filter((code) => codes.has(code));
    const otherCodes = [...codes].filter(
      (code) => !STATUS_ORDER.includes(code)
    );

    return [...knownCodes, ...otherCodes];
  }, [species]);

  const filteredSpecies = useMemo(() => {
    const query = search.trim().toLowerCase();

    return species.filter((item) => {
      const matchesSearch =
        query === '' ||
        [
          item.scientific_name,
          item.common_name,
          item.local_name,
        ].some((name) => name?.toLowerCase().includes(query));

      const matchesStatus =
        statusFilter === null || statusCode(item) === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [search, species, statusFilter]);

  const updatedText = lastUpdated
    ? new Date(lastUpdated).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const chooseStatus = (value: string | null) => {
    setStatusFilter(value);
    setFilterOpen(false);
  };

  const openSpeciesDetail = (item: Species) => {
    router.push({
      pathname: '/species-reference/[id]',
      params: {
        id: item.id,
      },
    } as any);
  };

  const renderEmpty = () => {
    if (species.length === 0 && loading) {
      return (
        <View style={styles.centerBox}>
          <ActivityIndicator color="#213B2A" />
          <Text style={styles.loadingText}>
            Loading species reference...
          </Text>
        </View>
      );
    }

    if (species.length === 0 && error) {
      return (
        <View style={styles.centerBox}>
          <Text style={styles.emptyTitle}>
            Couldn&apos;t load the species reference
          </Text>

          <Text style={styles.emptyText}>
            Connect to refresh the species catalogue. The last saved catalogue remains available offline.
          </Text>

          <Text style={styles.technicalError}>{error}</Text>

          <TouchableOpacity
            style={styles.retryButton}
            activeOpacity={0.8}
            onPress={() => void loadSpecies()}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.centerBox}>
        <Text style={styles.emptyTitle}>No matching species</Text>

        <Text style={styles.emptyText}>
          Try another scientific, common or local name.
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.navigationRow}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.7}
            onPress={() => router.back()}
          >
            <Text style={styles.backChevron}>‹</Text>
            <Text style={styles.backButtonText}>
              Back to New Plant Record
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>
          Species <Text style={styles.titleAccent}>Reference</Text>
        </Text>

        <View style={styles.referenceModeBanner}>
          <Text style={styles.referenceModeTitle}>Reference mode</Text>

          <Text style={styles.referenceModeText}>
            Browse species information to help identify the plant. Nothing
            you view here will be added to your plant record automatically.
          </Text>
        </View>

        <TextInput
          style={styles.searchBar}
          placeholder="Search scientific, common or local name"
          placeholderTextColor="#8C9A91"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />

        {error && species.length > 0 && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>
              Couldn&apos;t refresh — showing the catalogue saved on this
              phone
              {updatedText ? ` (updated ${updatedText})` : ''}.
            </Text>
          </View>
        )}

        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[
              styles.filterPill,
              (statusFilter !== null || filterOpen) &&
                styles.filterPillActive,
            ]}
            activeOpacity={0.8}
            onPress={() => setFilterOpen((open) => !open)}
          >
            <Text
              style={[
                styles.filterText,
                statusFilter !== null && styles.filterTextActive,
              ]}
              numberOfLines={1}
            >
              {statusFilter
                ? statusLabel(statusFilter)
                : 'Conservation status'}{' '}
              {filterOpen ? '▴' : '▾'}
            </Text>
          </TouchableOpacity>
        </View>

        {filterOpen && (
          <View style={styles.optionPanel}>
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => chooseStatus(null)}
            >
              <Text
                style={[
                  styles.optionText,
                  statusFilter === null && styles.optionTextSelected,
                ]}
              >
                All statuses
              </Text>

              {statusFilter === null && (
                <Text style={styles.optionCheck}>✓</Text>
              )}
            </TouchableOpacity>

            {statusOptions.map((code) => (
              <TouchableOpacity
                key={code}
                style={styles.optionRow}
                onPress={() => chooseStatus(code)}
              >
                <Text
                  style={[
                    styles.optionText,
                    statusFilter === code &&
                      styles.optionTextSelected,
                  ]}
                >
                  {code === 'NA'
                    ? statusLabel(code)
                    : `${statusLabel(code)} (${code})`}
                </Text>

                {statusFilter === code && (
                  <Text style={styles.optionCheck}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {species.length > 0 && (
          <View style={styles.countRow}>
            <Text style={styles.countBanner}>
              {filteredSpecies.length === species.length
                ? `${species.length} species · automatically synced`
                : `Showing ${filteredSpecies.length} of ${species.length} species`}
            </Text>

            {statusFilter !== null && (
              <TouchableOpacity
                onPress={() => chooseStatus(null)}
                hitSlop={8}
              >
                <Text style={styles.clearText}>Clear filter</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <FlatList
          data={filteredSpecies}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          refreshing={loading && species.length > 0}
          onRefresh={() => void loadSpecies()}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={
            filteredSpecies.length === 0
              ? styles.emptyListContent
              : styles.listContent
          }
          renderItem={({ item }) => {
            const code = statusCode(item);
            const badgeColor = getStatusColor(code);

            const subtitle =
              item.common_name ||
              item.local_name ||
              'No common name recorded';

            return (
              <TouchableOpacity
                style={styles.speciesCard}
                activeOpacity={0.7}
                onPress={() => openSpeciesDetail(item)}
              >
                <View style={styles.speciesContent}>
                  <View style={styles.nameRow}>
                    <Text style={styles.speciesName}>
                      {item.scientific_name}
                    </Text>

                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor:
                            badgeColor.backgroundColor,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          {
                            color: badgeColor.textColor,
                          },
                        ]}
                      >
                        {code === 'NA' ? 'Not assessed' : code}
                      </Text>
                    </View>
                  </View>

                  <Text
                    style={[
                      styles.speciesSubtitle,
                      !item.common_name &&
                        !item.local_name &&
                        styles.speciesSubtitleEmpty,
                    ]}
                  >
                    {subtitle}
                  </Text>
                </View>

                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    paddingTop:
      Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  navigationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
  },
  backChevron: {
    fontSize: 31,
    lineHeight: 31,
    color: '#213B2A',
    marginRight: 5,
  },
  backButtonText: {
    fontSize: 13.5,
    color: '#213B2A',
    fontWeight: '700',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1E2B22',
    marginBottom: 12,
  },
  titleAccent: {
    color: '#6B8F72',
  },
  referenceModeBanner: {
    backgroundColor: '#EAF3EC',
    borderWidth: 1,
    borderColor: '#D4E4D8',
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 12,
    marginBottom: 12,
  },
  referenceModeTitle: {
    color: '#213B2A',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 3,
  },
  referenceModeText: {
    color: '#53675A',
    fontSize: 12.5,
    lineHeight: 17,
  },
  searchBar: {
    backgroundColor: '#FFFFFF',
    minHeight: 50,
    borderRadius: 25,
    paddingHorizontal: 18,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
    marginBottom: 12,
    color: '#1E2B22',
  },
  offlineBanner: {
    backgroundColor: '#FFF7DB',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  offlineText: {
    fontSize: 12.5,
    color: '#6B5310',
    lineHeight: 17,
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  filterPill: {
    flexShrink: 1,
    backgroundColor: '#FFFFFF',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DCE4DF',
    marginRight: 8,
  },
  filterPillActive: {
    borderColor: '#213B2A',
    backgroundColor: '#EEF5F0',
  },
  filterText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#4E6254',
  },
  filterTextActive: {
    color: '#213B2A',
    fontWeight: '700',
  },
  optionPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DCE4DF',
    marginBottom: 12,
    paddingVertical: 4,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  optionText: {
    fontSize: 13.5,
    color: '#3A5243',
  },
  optionTextSelected: {
    color: '#213B2A',
    fontWeight: '700',
  },
  optionCheck: {
    fontSize: 14,
    color: '#213B2A',
    fontWeight: '800',
  },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  countBanner: {
    fontSize: 12.5,
    color: '#5B6B60',
    fontWeight: '500',
  },
  clearText: {
    fontSize: 12.5,
    color: '#213B2A',
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 30,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  centerBox: {
    alignItems: 'center',
    marginTop: 40,
    paddingHorizontal: 20,
  },
  loadingText: {
    fontSize: 13,
    color: '#5B6B60',
    marginTop: 10,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E2B22',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#5B6B60',
    textAlign: 'center',
    lineHeight: 18,
  },
  technicalError: {
    fontSize: 11.5,
    color: '#8A5C5C',
    marginTop: 8,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: '#213B2A',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 24,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  speciesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 24,
    marginBottom: 10,
    borderWidth: 1.2,
    borderColor: '#E6ECE8',
  },
  speciesContent: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  speciesName: {
    fontSize: 15,
    fontWeight: '700',
    fontStyle: 'italic',
    color: '#1E2B22',
  },
  statusBadge: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  speciesSubtitle: {
    fontSize: 12.5,
    color: '#5B6B60',
    marginTop: 4,
  },
  speciesSubtitleEmpty: {
    fontStyle: 'italic',
    color: '#8C9A91',
  },
  chevron: {
    fontSize: 22,
    color: '#88988D',
    marginLeft: 8,
  },
});
