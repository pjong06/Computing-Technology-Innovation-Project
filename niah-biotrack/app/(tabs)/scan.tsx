import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Platform,
  StatusBar,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../src/config/api';
import { useAuthRole } from '../../src/context/AuthRoleContext';

interface PlantPreview {
  id: string;
  tagCode: string;
  scientificName: string;
  commonName: string;
  family?: string;
}

export default function ScanScreen() {
  const router = useRouter();
  const { canEdit } = useAuthRole();

  const [permission, requestPermission] = useCameraPermissions();
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [plantData, setPlantData] = useState<PlantPreview | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  if (!permission) {
    return <View style={styles.blackBg} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Ionicons name="camera-outline" size={64} color="#2D6A4F" />
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionSub}>
          Niah BioTrack uses your camera to scan botanical QR tags affixed to specimens.
        </Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Enable Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (scanned || isLookingUp) return;

    setScanned(true);
    setIsLookingUp(true);

    const cleanTag = data.trim();

    try {
      const res = await fetch(`${API_BASE_URL}/api/plants/tag/${encodeURIComponent(cleanTag)}`);

      if (res.ok) {
        const item = await res.json();
        setPlantData({
          id: item.id || '',
          tagCode: cleanTag,
          scientificName: item.scientific_name || item.species?.scientific_name || 'Species Recorded',
          commonName: item.common_name || item.species?.common_name || 'Forest Specimen',
          family: item.family || item.species?.family || 'Sarawak Flora',
        });
        setModalVisible(true);
      } else {
        setPlantData({
          id: '',
          tagCode: cleanTag,
          scientificName: 'Unregistered Specimen',
          commonName: 'New Botanical Tag',
          family: 'Not Cataloged',
        });
        setModalVisible(true);
      }
    } catch {
      setPlantData({
        id: '',
        tagCode: cleanTag,
        scientificName: 'Field Specimen (Offline)',
        commonName: 'Scanned Tag',
      });
      setModalVisible(true);
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleProceedToObservation = () => {
    setModalVisible(false);
    if (!plantData) return;

    router.push({
      pathname: '/add-observation',
      params: {
        plantId: plantData.id,
        tagCode: plantData.tagCode,
        scientificName: plantData.scientificName,
      },
    });

    setTimeout(() => {
      setScanned(false);
      setPlantData(null);
    }, 800);
  };

  const handleDismissSheet = () => {
    setModalVisible(false);
    setPlantData(null);
    setTimeout(() => {
      setScanned(false);
    }, 400);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <CameraView
        style={styles.camera}
        enableTorch={torchEnabled}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'code128', 'code39'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
      />

      {/* Dark Ambient Mask with Transparent Viewfinder */}
      <View style={styles.overlay}>
        {/* Top Header */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.circleUtilityBtn}
            onPress={() => router.push('/(tabs)/home')}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.modeBadge}>
            <Text style={styles.modeBadgeText}>🌿 Plant Tag Scanner</Text>
          </View>
          <TouchableOpacity
            style={[styles.circleUtilityBtn, torchEnabled && styles.activeUtilityBtn]}
            onPress={() => setTorchEnabled(!torchEnabled)}
          >
            <Ionicons
              name={torchEnabled ? 'flash' : 'flash-off-outline'}
              size={20}
              color={torchEnabled ? '#213B2A' : '#FFFFFF'}
            />
          </TouchableOpacity>
        </View>

        {/* Viewfinder Reticle Frame */}
        <View style={styles.scannerCenterSection}>
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />

            {isLookingUp && (
              <View style={styles.lookupLoader}>
                <ActivityIndicator size="large" color="#52B788" />
                <Text style={styles.lookupText}>Verifying Tag...</Text>
              </View>
            )}
          </View>
          <Text style={styles.alignHint}>Align QR code or tree tag within target frame</Text>
        </View>

        {/* Bottom Utility Bar */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.manualEntryBtn}
            onPress={() => router.push('/manual-qr')}
          >
            <Ionicons name="keypad-outline" size={18} color="#FFFFFF" />
            <Text style={styles.manualEntryText}>Manual Tag Lookup</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Slide-Up Tag Preview Bottom Sheet */}
      <Modal
        animationType="slide"
        transparent
        visible={modalVisible}
        onRequestClose={handleDismissSheet}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.bottomSheetCard}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeaderRow}>
              <View style={styles.tagPill}>
                <Ionicons name="pricetag" size={13} color="#2D6A4F" />
                <Text style={styles.tagPillText}>{plantData?.tagCode}</Text>
              </View>
              <TouchableOpacity onPress={handleDismissSheet}>
                <Ionicons name="close-circle" size={24} color="#8A998E" />
              </TouchableOpacity>
            </View>

            <Text style={styles.sheetScientificName}>
              {plantData?.scientificName}
            </Text>
            <Text style={styles.sheetCommonName}>{plantData?.commonName}</Text>

            {plantData?.family && (
              <View style={styles.familyRow}>
                <Text style={styles.familyLabel}>Taxonomy Family:</Text>
                <Text style={styles.familyVal}>{plantData.family}</Text>
              </View>
            )}

            {/* Role Conditional Action Button */}
            {canEdit ? (
              <View style={styles.sheetActionRow}>
                <TouchableOpacity
                  style={styles.sheetCancelBtn}
                  onPress={handleDismissSheet}
                >
                  <Text style={styles.sheetCancelText}>Scan Again</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.sheetConfirmBtn}
                  onPress={handleProceedToObservation}
                >
                  <Text style={styles.sheetConfirmText}>Record Observation →</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.visitorSheetFooter}>
                <View style={styles.visitorVerifiedBadge}>
                  <Ionicons name="checkmark-circle" size={16} color="#059669" />
                  <Text style={styles.visitorVerifiedText}>
                    Sarawak Forestry Corporation Verified Specimen
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.visitorDoneBtn}
                  onPress={handleDismissSheet}
                >
                  <Text style={styles.visitorDoneBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  camera: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  blackBg: { flex: 1, backgroundColor: '#000000' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    paddingVertical: Platform.OS === 'android' ? (StatusBar.currentHeight || 20) + 10 : 50,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  circleUtilityBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeUtilityBtn: {
    backgroundColor: '#74C69D',
  },
  modeBadge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(20, 35, 25, 0.85)',
    borderWidth: 1,
    borderColor: '#2D6A4F',
  },
  modeBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#D8F3DC',
  },
  scannerCenterSection: {
    alignItems: 'center',
  },
  viewfinder: {
    width: 260,
    height: 260,
    position: 'relative',
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: '#52B788',
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 18 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 18 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 18 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 18 },
  lookupLoader: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    padding: 16,
    borderRadius: 14,
  },
  lookupText: {
    color: '#D8F3DC',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  alignHint: {
    color: '#D8E2DC',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 20,
    textAlign: 'center',
  },
  bottomBar: {
    alignItems: 'center',
  },
  manualEntryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  manualEntryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#213B2A',
    marginTop: 16,
    marginBottom: 8,
  },
  permissionSub: {
    fontSize: 14,
    color: '#68776D',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  permissionBtn: {
    backgroundColor: '#2D6A4F',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 24,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  bottomSheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    backgroundColor: '#DDE5E0',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    gap: 6,
  },
  tagPillText: {
    color: '#2D6A4F',
    fontSize: 13,
    fontWeight: '800',
  },
  sheetScientificName: {
    fontSize: 21,
    fontWeight: '800',
    color: '#213B2A',
    fontStyle: 'italic',
  },
  sheetCommonName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#68776D',
    marginTop: 2,
    marginBottom: 14,
  },
  familyRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2EE',
  },
  familyLabel: {
    fontSize: 13,
    color: '#8A998E',
    fontWeight: '600',
  },
  familyVal: {
    fontSize: 13,
    color: '#213B2A',
    fontWeight: '700',
  },
  sheetActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  sheetCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 22,
    backgroundColor: '#F0F4F1',
    alignItems: 'center',
  },
  sheetCancelText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#4A5C50',
  },
  sheetConfirmBtn: {
    flex: 1.8,
    paddingVertical: 14,
    borderRadius: 22,
    backgroundColor: '#2D6A4F',
    alignItems: 'center',
  },
  sheetConfirmText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  visitorSheetFooter: {
    gap: 12,
  },
  visitorVerifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  visitorVerifiedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  visitorDoneBtn: {
    backgroundColor: '#213B2A',
    paddingVertical: 14,
    borderRadius: 22,
    alignItems: 'center',
  },
  visitorDoneBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
});