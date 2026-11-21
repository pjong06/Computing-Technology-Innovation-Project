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
import MapControls from './MapControls';

// The "Find plant" map without internet (no tiles): drawn on the phone from GPS and compass
// only. North is up; the phone is the centre; the target plant sits at its real bearing and
// distance, auto-zoomed so both fit. Other plants within 1 km are small dots: tap one to make
// it the target. + / − zoom in and out from that fit; recenter goes back to it (the phone
// always stays in the centre, so the map follows the botanist anyway). The phone is a blue
// arrow with a light cone turning with the compass. Plain Views only (no map or SVG library).
// The maths is in offlineMap.ts.

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
  // The path walked so far during navigation, drawn as a thin line.
  trail?: LatLng[];
}

const OTHERS_RADIUS_M = 1000;
const MAX_OTHER_DOTS = 60;
// Each + / − step halves or doubles the scale, up to this many steps from the auto-fit.
const MAX_ZOOM_STEPS = 4;

export default function OfflinePlantMap({ here, headingDegrees, target, others, onSelect, trail = [] }: OfflinePlantMapProps) {
  const [view, setView] = useState({ width: 0, height: 0 });
  // 0 = auto-fit (phone and plant both in view); positive = zoomed in, negative = out.
  const [zoomSteps, setZoomSteps] = useState(0);
  const zoomBy = (step: number) =>
    setZoomSteps((current) => Math.max(-MAX_ZOOM_STEPS, Math.min(MAX_ZOOM_STEPS, current + step)));
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
  const metresPerPixel = fitMetersPerPixel([targetOffset], view) * 2 ** -zoomSteps;
  const centre = { x: view.width / 2, y: view.height / 2 };
  // Always on screen, even if the zoom could not quite fit it.
  const targetPoint = clampToView(toScreen(targetOffset, view, metresPerPixel), view, 18);

  const spacing = gridSpacingMeters(metresPerPixel);
  const grid = gridLines(absoluteMeters(here), spacing, metresPerPixel, view);
  const bar = scaleBar(metresPerPixel);
  const dashes = dashSegments(centre, targetPoint);
  const accuracyRadius = here.accuracy ? Math.min(here.accuracy / metresPerPixel, view.width) : 0;

  // The walked trail: one thin segment between each pair of kept points.
  const trailPoints = trail.map((point) => toScreen(offsetMeters(here, point), view, metresPerPixel));
  const trailSegments = trailPoints.slice(1).map((to, index) => {
    const from = trailPoints[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    return {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
      length,
      angle: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
    };
  }).filter((segment) => segment.length >= 0.5);

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

      {/* The path walked so far. */}
      {trailSegments.map((segment, index) => (
        <View
          key={`t${index}`}
          pointerEvents="none"
          style={[
            styles.trail,
            { left: segment.x - segment.length / 2, top: segment.y - 1, width: segment.length, transform: [{ rotate: `${segment.angle}deg` }] },
          ]}
        />
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
      {/* The phone: a blue arrow turning with the compass, with a light cone the way it faces. */}
      <View
        pointerEvents="none"
        style={[
          styles.me,
          { left: centre.x - 32, top: centre.y - 32 },
          headingDegrees !== null && { transform: [{ rotate: `${headingDegrees}deg` }] },
        ]}
      >
        {headingDegrees !== null ? <View style={styles.meCone} /> : null}
        <View style={styles.phoneDot}>
          {headingDegrees !== null ? <View style={styles.meArrow} /> : null}
        </View>
      </View>

      {/* The target plant. */}
      <View pointerEvents="none" style={[styles.targetPin, { left: targetPoint.x - 15, top: targetPoint.y - 15 }]}>
        <Text style={styles.targetPinText}>P</Text>
      </View>

      {/* North arrow above the zoom / recenter buttons; scale bar bottom left. */}
      <MapControls
        onZoomIn={() => zoomBy(1)}
        onZoomOut={() => zoomBy(-1)}
        onRecenter={() => setZoomSteps(0)}
        paused={zoomSteps !== 0}
      >
        <View style={styles.north} pointerEvents="none">
          <Ionicons name="arrow-up" size={14} color="#213B2A" />
          <Text style={styles.northText}>N</Text>
        </View>
      </MapControls>
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
  trail: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: '#1D4ED8', opacity: 0.6 },
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
  me: { position: 'absolute', width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  meCone: {
    position: 'absolute',
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 18,
    borderRightWidth: 18,
    borderTopWidth: 32,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(37,99,235,0.22)',
  },
  phoneDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2563EB',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meArrow: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FFFFFF',
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
  // Bottom right, clear of the guidance panel at the top and the scale bar on the left.
  label: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    maxWidth: '60%',
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
  labelText: { fontSize: 10.5, fontWeight: '700', color: '#526659', flexShrink: 1 },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  waitingText: { fontSize: 12.5, fontWeight: '600', color: '#526659', textAlign: 'center' },
});
