import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  absoluteMeters,
  clampToView,
  dashSegments,
  fitMetersPerPixel,
  gridLines,
  gridSpacingMeters,
  offsetMeters,
  plantsWithin,
  scaleBar,
  toScreen,
  type LatLng,
} from '../utils/offlineMap';

// The "Find plant" map without internet (no tiles): drawn on the phone from GPS and compass
// only. North is up; the phone is the centre; the target plant sits at its real bearing and
// distance, auto-zoomed so both fit. Other plants within 1 km are small dots: tap one to make
// it the target. Plain Views only (no map or SVG library). The maths is in offlineMap.ts.

export interface OfflineMapPlant extends LatLng {
  key: string;
  title: string;
}

interface OfflinePlantMapProps {
  here: (LatLng & { accuracy: number | null }) | null;
  headingDegrees: number | null;
  target: OfflineMapPlant;
  others: OfflineMapPlant[];
  onSelect: (key: string) => void;
}

const OTHERS_RADIUS_M = 1000;
const MAX_OTHER_DOTS = 60;

export default function OfflinePlantMap({ here, headingDegrees, target, others, onSelect }: OfflinePlantMapProps) {
  const [view, setView] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== view.width || height !== view.height) setView({ width, height });
  };

  const label = (
    <View style={styles.label} pointerEvents="none">
      <Ionicons name="cloud-offline-outline" size={12} color="#526659" />
      <Text style={styles.labelText}>Offline map: GPS and compass only</Text>
    </View>
  );

  if (!here || view.width === 0) {
    return (
      <View style={styles.container} onLayout={onLayout}>
        {label}
        <View style={styles.waiting}>
          <Text style={styles.waitingText}>Waiting for phone GPS to draw the offline map…</Text>
        </View>
      </View>
    );
  }

  const targetOffset = offsetMeters(here, target);
  const metresPerPixel = fitMetersPerPixel([targetOffset], view);
  const centre = { x: view.width / 2, y: view.height / 2 };
  // Always on screen, even if the zoom could not quite fit it.
  const targetPoint = clampToView(toScreen(targetOffset, view, metresPerPixel), view, 18);

  const spacing = gridSpacingMeters(metresPerPixel);
  const grid = gridLines(absoluteMeters(here), spacing, metresPerPixel, view);
  const bar = scaleBar(metresPerPixel);
  const dashes = dashSegments(centre, targetPoint);
  const accuracyRadius = here.accuracy ? Math.min(here.accuracy / metresPerPixel, view.width) : 0;

  const dots = plantsWithin(here, others.filter((plant) => plant.key !== target.key), OTHERS_RADIUS_M)
    .slice(0, MAX_OTHER_DOTS)
    .map((plant) => ({ plant, point: toScreen(offsetMeters(here, plant), view, metresPerPixel) }))
    .filter(({ point }) => point.x >= 6 && point.x <= view.width - 6 && point.y >= 6 && point.y <= view.height - 6);

  return (
    <View style={styles.container} onLayout={onLayout}>
      {/* Grid: light lines every `spacing` metres, fixed to the ground. */}
      {grid.xs.map((x) => (
        <View key={`x${x}`} style={[styles.gridLine, { left: x, top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
      ))}
      {grid.ys.map((y) => (
        <View key={`y${y}`} style={[styles.gridLine, { top: y, left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
      ))}

      {/* Dashed line from the phone to the plant. */}
      {dashes.map((dash, index) => (
        <View
          key={index}
          pointerEvents="none"
          style={[
            styles.dash,
            { left: dash.x - dash.length / 2, top: dash.y - 1.5, width: dash.length, transform: [{ rotate: `${dash.angle}deg` }] },
          ]}
        />
      ))}

      {/* Other plants nearby: tap to navigate to one instead. */}
      {dots.map(({ plant, point }) => (
        <TouchableOpacity
          key={plant.key}
          style={[styles.otherDot, { left: point.x - 5, top: point.y - 5 }]}
          onPress={() => onSelect(plant.key)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Navigate to ${plant.title}`}
        />
      ))}

      {/* GPS accuracy circle and the phone, with the way it faces. */}
      {accuracyRadius > 6 ? (
        <View
          pointerEvents="none"
          style={[
            styles.accuracy,
            { left: centre.x - accuracyRadius, top: centre.y - accuracyRadius, width: accuracyRadius * 2, height: accuracyRadius * 2, borderRadius: accuracyRadius },
          ]}
        />
      ) : null}
      {headingDegrees !== null ? (
        <View pointerEvents="none" style={[styles.headingWrap, { left: centre.x - 16, top: centre.y - 16, transform: [{ rotate: `${headingDegrees}deg` }] }]}>
          <Ionicons name="caret-up" size={14} color="#2563EB" />
        </View>
      ) : null}
      <View pointerEvents="none" style={[styles.phoneDot, { left: centre.x - 9, top: centre.y - 9 }]} />

      {/* The target plant. */}
      <View pointerEvents="none" style={[styles.targetPin, { left: targetPoint.x - 15, top: targetPoint.y - 15 }]}>
        <Text style={styles.targetPinText}>P</Text>
      </View>

      {/* North arrow and scale bar. */}
      <View style={styles.north} pointerEvents="none">
        <Ionicons name="arrow-up" size={14} color="#213B2A" />
        <Text style={styles.northText}>N</Text>
      </View>
      <View style={styles.scale} pointerEvents="none">
        <View style={[styles.scaleBar, { width: bar.px }]} />
        <Text style={styles.scaleText}>{bar.label}</Text>
      </View>

      {label}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F6F1', overflow: 'hidden' },
  gridLine: { position: 'absolute', backgroundColor: '#C9D6CC' },
  dash: { position: 'absolute', height: 3, borderRadius: 1.5, backgroundColor: '#2563EB', opacity: 0.9 },
  otherDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#7D8C81',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  accuracy: {
    position: 'absolute',
    backgroundColor: 'rgba(37,99,235,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(37,99,235,0.35)',
  },
  headingWrap: { position: 'absolute', width: 32, height: 32, alignItems: 'center' },
  phoneDot: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#2563EB',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },
  targetPin: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#DC2626',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetPinText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  north: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: '#DCE4DF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  northText: { fontSize: 9.5, fontWeight: '800', color: '#213B2A', marginTop: -3 },
  scale: { position: 'absolute', left: 12, bottom: 10 },
  scaleBar: { height: 4, borderWidth: 1.5, borderTopWidth: 0, borderColor: '#213B2A' },
  scaleText: { fontSize: 10.5, fontWeight: '700', color: '#213B2A', marginTop: 2 },
  label: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#DCE4DF',
  },
  labelText: { fontSize: 10.5, fontWeight: '700', color: '#526659' },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  waitingText: { fontSize: 12.5, fontWeight: '600', color: '#526659', textAlign: 'center' },
});
