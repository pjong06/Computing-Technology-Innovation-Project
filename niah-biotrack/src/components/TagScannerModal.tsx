import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, scanFromURLAsync, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';

// A full-screen camera that reads one plant tag (QR or barcode) and hands it back,
// without showing any plant sheet. Used by Add observation's "Scan tag" button.
// A QR image from the gallery works too, like on the Scan tab.
interface TagScannerModalProps {
  visible: boolean;
  onClose: () => void;
  // Called once with the scanned text (a tag code or a public QR URL).
  onScanned: (data: string) => void;
}

export default function TagScannerModal({ visible, onClose, onScanned }: TagScannerModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [isReadingImage, setIsReadingImage] = useState(false);
  const handledRef = useRef(false);

  // Ask for the camera when the scanner opens; a fresh opening can scan again.
  useEffect(() => {
    if (!visible) return;
    handledRef.current = false;
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const handOver = (data: string) => {
    if (handledRef.current) return;
    handledRef.current = true;
    onScanned(data);
  };

  const handleBarcodeScanned = ({ data }: BarcodeScanningResult) => handOver(data);

  const handleUploadQr = async () => {
    if (isReadingImage) return;
    setIsReadingImage(true);
    try {
      const access = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!access.granted) {
        Toast.show({
          type: 'error',
          text1: 'Permission denied',
          text2: 'Allow access to your photos to upload a QR image.',
          position: 'bottom',
        });
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
      const imageUri = picked.canceled ? null : picked.assets[0]?.uri;
      if (!imageUri) return;

      const barcodes = await scanFromURLAsync(imageUri, ['qr']);
      if (barcodes.length === 0) {
        Toast.show({
          type: 'error',
          text1: 'No QR code found',
          text2: 'Choose a clear image of a plant QR tag.',
          position: 'bottom',
        });
        return;
      }
      handOver(barcodes[0].data);
    } catch {
      Toast.show({
        type: 'error',
        text1: "This image couldn't be read",
        text2: 'Choose another image and try again.',
        position: 'bottom',
      });
    } finally {
      setIsReadingImage(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39'] }}
            onBarcodeScanned={isReadingImage ? undefined : handleBarcodeScanned}
          />
        ) : (
          <View style={styles.noCamera}>
            <Text style={styles.noCameraText}>
              Camera access is needed to scan a tag. You can still upload a QR image or type the tag.
            </Text>
            {permission && !permission.granted && permission.canAskAgain ? (
              <TouchableOpacity style={styles.actionBtn} onPress={() => void requestPermission()}>
                <Text style={styles.actionText}>Allow camera</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        <SafeAreaView style={styles.overlay} pointerEvents="box-none">
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close scanner"
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.title}>Scan plant tag</Text>
            <View style={{ width: 44 }} />
          </View>

          <View style={styles.frame} pointerEvents="none" />
          <Text style={styles.hint}>Align the QR code or tree tag within the frame</Text>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => void handleUploadQr()}
            disabled={isReadingImage}
            accessibilityRole="button"
          >
            {isReadingImage ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="image-outline" size={18} color="#FFFFFF" />
            )}
            <Text style={styles.actionText}>
              {isReadingImage ? 'Reading image...' : 'Upload QR from gallery'}
            </Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  overlay: { flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingBottom: 40 },
  topBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  frame: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    borderRadius: 20,
  },
  hint: { color: '#FFFFFF', fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2F6B3A',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 12,
  },
  actionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  noCamera: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  noCameraText: { color: '#FFFFFF', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
