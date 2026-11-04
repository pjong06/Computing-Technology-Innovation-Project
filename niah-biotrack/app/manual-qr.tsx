import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import FormScrollView from '../src/components/FormScrollView';

import { lookupTag, describeTagLookup, type TagLookupResult } from '../src/services/tagLookup';

export default function ManualQRScreen() {
  const router = useRouter();
  const [tagInput, setTagInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Tags looked up on this screen; starts empty (no example tags).
  const [recentTags, setRecentTags] = useState<string[]>([]);
  const [lookupResult, setLookupResult] = useState<TagLookupResult | null>(null);

  const handleSearchTag = async (overrideTag?: string) => {
    const code = (overrideTag || tagInput).trim();
    if (!code) {
      Toast.show({
        type: 'error',
        text1: 'Input Required',
        text2: 'Enter a plant tag code to search.',
      });
      return;
    }

    setIsLoading(true);
    setLookupResult(null);

    // Phone first, then the server; never filled in with made-up plant details.
    const result = await lookupTag(code);
    setLookupResult(result);
    setRecentTags((prev) => [result.tagCode, ...prev.filter((t) => t !== result.tagCode)].slice(0, 6));
    setIsLoading(false);
  };

  const handleProceed = () => {
    // Only plants saved on this phone can get a visit (it's stored with the record).
    if (lookupResult?.status !== 'on-phone') return;
    router.push({
      pathname: '/add-observation',
      params: {
        plantId: lookupResult.record.id, // the phone's own record id
        tagCode: lookupResult.tagCode,
        scientificName: lookupResult.record.scientificName,
      },
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBackBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#213B2A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manual Tag Entry</Text>
        <View style={{ width: 40 }} />
      </View>

      <FormScrollView contentContainerStyle={styles.content}>
        {/* Search Input Card */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Enter Botanical Tag Code</Text>
          <View style={styles.inputRow}>
            <Ionicons name="pricetag-outline" size={20} color="#8A998E" style={{ marginLeft: 14 }} />
            <TextInput
              style={styles.textInput}
              placeholder="e.g. NIAH-PLT-00001"
              placeholderTextColor="#8C9A91"
              value={tagInput}
              onChangeText={setTagInput}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => handleSearchTag()}
            />
            {tagInput.length > 0 && (
              <TouchableOpacity style={styles.clearBtn} onPress={() => setTagInput('')}>
                <Ionicons name="close-circle" size={18} color="#8A998E" />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.searchBtn, isLoading && styles.btnDisabled]}
            onPress={() => handleSearchTag()}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Ionicons name="search" size={17} color="#FFFFFF" />
                <Text style={styles.searchBtnText}>Look Up Tag</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Recent Scans Carousel */}
        {recentTags.length > 0 && (
          <View style={styles.sectionHeader}>
            <Ionicons name="time-outline" size={16} color="#526A5A" />
            <Text style={styles.sectionTitle}>Recent Tag Queries</Text>
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
          {recentTags.map((tag) => (
            <TouchableOpacity
              key={tag}
              style={styles.recentChip}
              onPress={() => {
                setTagInput(tag);
                handleSearchTag(tag);
              }}
            >
              <Text style={styles.recentChipText}>{tag}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Search Result Card */}
        {lookupResult?.status === 'on-phone' && (
          <View style={styles.resultCard}>
            <View style={styles.resultPill}>
              <Ionicons name="checkmark-circle" size={15} color="#2D6A4F" />
              <Text style={styles.resultPillText}>Tag Found: {lookupResult.tagCode}</Text>
            </View>

            <Text style={styles.resultScientific}>
              {lookupResult.record.scientificName || 'Identification pending'}
            </Text>
            {lookupResult.record.commonName ? (
              <Text style={styles.resultCommon}>{lookupResult.record.commonName}</Text>
            ) : null}

            {lookupResult.record.family ? (
              <Text style={styles.resultFamily}>Family: {lookupResult.record.family}</Text>
            ) : null}

            <TouchableOpacity style={styles.proceedBtn} onPress={handleProceed}>
              <Text style={styles.proceedBtnText}>Record Observation for This Plant</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}

        {/* Every other result: say what happened instead of showing a plant. */}
        {lookupResult && lookupResult.status !== 'on-phone' && (
          <View style={styles.resultCard}>
            <View style={styles.resultPill}>
              <Ionicons name="pricetag-outline" size={15} color="#526A5A" />
              <Text style={styles.resultPillText}>{lookupResult.tagCode}</Text>
            </View>
            <Text style={styles.resultScientific}>{describeTagLookup(lookupResult).title}</Text>
            {lookupResult.status === 'server-only' && lookupResult.commonName ? (
              <Text style={styles.resultCommon}>{lookupResult.commonName}</Text>
            ) : null}
            <Text style={styles.resultCommon}>{describeTagLookup(lookupResult).message}</Text>
          </View>
        )}
      </FormScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E6ECE8',
  },
  headerBackBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#F0F4F1',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#213B2A',
  },
  content: {
    padding: 18,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E6ECE8',
    marginBottom: 20,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#34493B',
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F9F7',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#D8E2DC',
    marginBottom: 14,
  },
  textInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: 10,
    fontSize: 16,
    fontWeight: '700',
    color: '#213B2A',
  },
  clearBtn: {
    padding: 10,
  },
  searchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2D6A4F',
    height: 48,
    borderRadius: 24,
    gap: 8,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  searchBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#526A5A',
  },
  recentRow: {
    gap: 8,
    paddingBottom: 20,
  },
  recentChip: {
    backgroundColor: '#EAF1EC',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D4DDD6',
  },
  recentChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#213B2A',
  },
  resultCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#52B788',
    marginTop: 8,
  },
  resultPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#E8F5E9',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    gap: 6,
    marginBottom: 10,
  },
  resultPillText: {
    color: '#2D6A4F',
    fontSize: 12.5,
    fontWeight: '800',
  },
  resultScientific: {
    fontSize: 18,
    fontWeight: '800',
    fontStyle: 'italic',
    color: '#213B2A',
  },
  resultCommon: {
    fontSize: 13.5,
    color: '#68776D',
    marginTop: 2,
    marginBottom: 8,
  },
  resultFamily: {
    fontSize: 12.5,
    color: '#8A998E',
    fontWeight: '600',
    marginBottom: 16,
  },
  proceedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#213B2A',
    height: 48,
    borderRadius: 24,
    gap: 8,
  },
  proceedBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});