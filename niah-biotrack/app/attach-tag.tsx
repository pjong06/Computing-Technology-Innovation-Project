import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Image,
  ActivityIndicator,
  Share,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '../src/config/api';
import { supabase } from '../src/lib/supabase';
import { useRecordStore } from '../src/store/useRecordStore';

export default function AttachTagScreen() {
  const router = useRouter();
  const { id, plantId } = useLocalSearchParams<{ id?: string; plantId?: string }>();
  const targetId = plantId || id;

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [qrData, setQrData] = useState<{
    tagCode: string;
    qrCode: string;
    publicUrl: string;
  } | null>(null);

  const updateRecordTag = useRecordStore((state: any) => state.updateRecordTag);

  useEffect(() => {
    async function autoAssignAndLoadQR() {
      if (!targetId) {
        setErrorMsg('Plant ID missing.');
        setLoading(false);
        return;
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        // Automatically fetch or create the tag in one seamless call
        const response = await fetch(`${API_BASE_URL}/api/plants/${targetId}/attach-tag`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({}), // No manual input needed; backend handles it automatically
        });

        const resJson = await response.json().catch(() => ({}));

        if (!response.ok) {
        throw new Error(resJson.message || `Server responded with status ${response.status}`);
        }

        // Sync local Zustand state if applicable
        if (typeof updateRecordTag === 'function') {
          updateRecordTag(targetId, resJson.tag_code);
        }

        setQrData({
          tagCode: resJson.tag_code,
          qrCode: resJson.qr_code,
          publicUrl: resJson.public_url,
        });
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to load QR code.');
      } finally {
        setLoading(false);
      }
    }

    autoAssignAndLoadQR();
  }, [targetId]);

  const handleShare = async () => {
    if (!qrData?.publicUrl) return;
    await Share.share({
      message: `Niah National Park Flora Record [${qrData.tagCode}]: ${qrData.publicUrl}`,
      url: qrData.publicUrl,
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#213B2A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Botanical Tag Plaque</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color="#2D6A4F" />
            <Text style={styles.loadingText}>Assigning next tag & generating QR...</Text>
          </View>
        ) : errorMsg ? (
          <View style={styles.centerBox}>
            <Ionicons name="alert-circle-outline" size={48} color="#DC2626" />
            <Text style={styles.errorText}>{errorMsg}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()}>
              <Text style={styles.retryBtnText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.badge}>
              <Ionicons name="checkmark-circle" size={15} color="#059669" />
              <Text style={styles.badgeText}>Plaque Assigned</Text>
            </View>

            <Text style={styles.tagCodeText}>{qrData?.tagCode}</Text>
            <Text style={styles.subText}>Scan to open public visitor catalogue</Text>

            <View style={styles.qrFrame}>
              <Image
                source={{ uri: qrData?.qrCode }}
                style={styles.qrImage}
                resizeMode="contain"
              />
            </View>

            <View style={styles.urlContainer}>
              <Text style={styles.urlLabel}>Public Visitor Link</Text>
              <Text style={styles.urlText} numberOfLines={1}>
                {qrData?.publicUrl}
              </Text>
            </View>

            <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
              <Ionicons name="share-social-outline" size={18} color="#2D6A4F" />
              <Text style={styles.shareBtnText}>Share Link</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()}>
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
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
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E6ECE8',
  },
  backBtn: {
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
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  centerBox: {
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#68776D',
    fontWeight: '600',
  },
  errorText: {
    fontSize: 14,
    color: '#DC2626',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  retryBtn: {
    marginTop: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#E8EFEA',
    borderRadius: 12,
  },
  retryBtnText: {
    color: '#213B2A',
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E6ECE8',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 10,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  tagCodeText: {
    fontSize: 26,
    fontWeight: '900',
    color: '#213B2A',
    letterSpacing: 2,
    marginBottom: 4,
  },
  subText: {
    fontSize: 12.5,
    color: '#76877B',
    marginBottom: 20,
  },
  qrFrame: {
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#D8E2DC',
    marginBottom: 18,
  },
  qrImage: {
    width: 220,
    height: 220,
  },
  urlContainer: {
    width: '100%',
    backgroundColor: '#F8FAF8',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E6ECE8',
    marginBottom: 16,
    alignItems: 'center',
  },
  urlLabel: {
    fontSize: 10,
    color: '#76877B',
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  urlText: {
    fontSize: 12,
    color: '#2D6A4F',
    fontWeight: '600',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    borderColor: '#2D6A4F',
    marginBottom: 10,
  },
  shareBtnText: {
    color: '#2D6A4F',
    fontSize: 14,
    fontWeight: '700',
  },
  doneBtn: {
    width: '100%',
    height: 48,
    backgroundColor: '#213B2A',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
});
