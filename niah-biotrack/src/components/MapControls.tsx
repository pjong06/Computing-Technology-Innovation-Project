import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// The zoom and recenter buttons on the right edge of the Find plant map (online and offline).
// `paused`: the map stopped following the phone after a manual pan or zoom, so the recenter
// button is highlighted until it is tapped. `children` sit above the buttons (e.g. a north arrow).
export default function MapControls({
  onZoomIn,
  onZoomOut,
  onRecenter,
  paused = false,
  children = null,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecenter: () => void;
  paused?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.column} pointerEvents="box-none">
      {children}
      <View style={styles.group}>
        <TouchableOpacity style={styles.button} onPress={onZoomIn} accessibilityRole="button" accessibilityLabel="Zoom in">
          <Ionicons name="add" size={22} color="#213B2A" />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.button} onPress={onZoomOut} accessibilityRole="button" accessibilityLabel="Zoom out">
          <Ionicons name="remove" size={22} color="#213B2A" />
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={[styles.button, styles.single, paused && styles.pausedButton]}
        onPress={onRecenter}
        accessibilityRole="button"
        accessibilityLabel={paused ? 'Recenter and follow my position' : 'Recenter map'}
      >
        <Ionicons name={paused ? 'locate' : 'locate-outline'} size={20} color={paused ? '#FFFFFF' : '#213B2A'} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // Bottom right, above the Map / Satellite switch: clear of the guidance panel at the top,
  // however tall large text makes it.
  column: { position: 'absolute', right: 10, bottom: 52, alignItems: 'center', gap: 8 },
  group: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DCE4DF',
    overflow: 'hidden',
  },
  button: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#DCE4DF' },
  single: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DCE4DF',
  },
  pausedButton: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
});
