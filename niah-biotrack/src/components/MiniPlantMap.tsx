import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WebView, type WebViewProps } from 'react-native-webview';
import NetInfo from '@react-native-community/netinfo';

const NativeWebView = WebView as unknown as React.ComponentType<WebViewProps>;

// A small, non-interactive map of where a plant is (Plant detail → Location): the plant pin
// on the street map. It takes no touches, so the screen around it decides what a tap does
// (Plant detail opens Find plant). Without internet, or if the map can't load, it shows a
// plain grid with the pin instead of a blank box.
export default function MiniPlantMap({
  latitude,
  longitude,
  height = 150,
}: {
  latitude: number;
  longitude: number;
  height?: number;
}) {
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        setOffline(state.isConnected === false || state.isInternetReachable === false);
      }),
    []
  );

  const html = useMemo(
    () => `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; background: #E8F0EA; }
  .leaflet-control-attribution { display: none; }
  .pin { width: 22px; height: 22px; border-radius: 50%; background: #DC2626; border: 2.5px solid #fff;
         box-shadow: 0 0 0 5px rgba(220,38,38,0.22), 0 2px 5px rgba(0,0,0,0.35); }
</style></head>
<body><div id="map"></div>
<script>
  if (typeof L === 'undefined') {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('failed');
  } else {
    // Every interaction off: it is a picture of the place, not a map to use.
    var map = L.map('map', {
      zoomControl: false, dragging: false, touchZoom: false, doubleClickZoom: false,
      scrollWheelZoom: false, boxZoom: false, keyboard: false, tap: false
    }).setView([${latitude}, ${longitude}], 17);
    var tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    var loaded = false;
    tiles.on('tileload', function() { loaded = true; });
    tiles.on('tileerror', function() {
      if (!loaded && window.ReactNativeWebView) window.ReactNativeWebView.postMessage('failed');
    });
    L.marker([${latitude}, ${longitude}], {
      icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false
    }).addTo(map);
  }
</script></body></html>`,
    [latitude, longitude]
  );

  if (offline || failed) {
    return (
      <View style={[styles.box, styles.grid, { height }]}>
        {[0.25, 0.5, 0.75].map((f) => (
          <View key={`v${f}`} style={[styles.gridLine, { left: `${f * 100}%`, top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
        ))}
        {[0.25, 0.5, 0.75].map((f) => (
          <View key={`h${f}`} style={[styles.gridLine, { top: `${f * 100}%`, left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
        ))}
        <View style={styles.offlinePin} />
        <Text style={styles.offlineText} numberOfLines={1}>
          Map needs the internet
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.box, { height }]} pointerEvents="none">
      <NativeWebView
        source={{ html }}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        onMessage={(event) => {
          if (event.nativeEvent.data === 'failed') setFailed(true);
        }}
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', overflow: 'hidden', borderRadius: 12, backgroundColor: '#E8F0EA' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  grid: { alignItems: 'center', justifyContent: 'center' },
  gridLine: { position: 'absolute', backgroundColor: '#C9D6CC' },
  offlinePin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#DC2626',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },
  offlineText: { position: 'absolute', bottom: 8, fontSize: 11, fontWeight: '600', color: '#526659' },
});
