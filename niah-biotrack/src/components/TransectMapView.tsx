import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { WebView, type WebViewProps } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import type { RoutePoint } from '../store/useRecordStore';

const NativeWebView = WebView as unknown as React.ComponentType<
  WebViewProps & { ref?: React.Ref<WebView> }
>;

export interface MapTargetPoint {
  latitude: number;
  longitude: number;
  title: string;
  subtitle?: string;
}

interface TransectMapViewProps {
  currentPoint: RoutePoint | null;
  targetPoint: MapTargetPoint | null;
  height?: number;
  // The phone has no internet connection (NetInfo).
  offline?: boolean;
  // Drawn instead of the map while offline or while the map tiles fail to load.
  offlineView?: React.ReactNode;
}

// While the tiles are failing, try loading the map again this often (signal can come back
// without the phone reporting a network change, e.g. walking out from under the canopy).
const TILE_RETRY_MS = 30_000;

export default function TransectMapView({
  currentPoint,
  targetPoint,
  height = 270,
  offline = false,
  offlineView = null,
}: TransectMapViewProps) {
  const webViewRef = useRef<WebView | null>(null);
  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');
  const [mapReady, setMapReady] = useState(false);
  // 'unknown' until the first tile loads or fails. The map page reports it (see the
  // tileload / tileerror handlers in the HTML below).
  const [tiles, setTiles] = useState<'unknown' | 'ok' | 'failed'>('unknown');

  const payload = useMemo(
    () => ({
      user: currentPoint
        ? {
            lat: currentPoint.latitude,
            lng: currentPoint.longitude,
          }
        : null,
      target: targetPoint
        ? {
            lat: targetPoint.latitude,
            lng: targetPoint.longitude,
            title: targetPoint.title,
            subtitle: targetPoint.subtitle || 'Saved plant location',
          }
        : null,
      mapStyle,
    }),
    [currentPoint, targetPoint, mapStyle]
  );

  const html = useMemo(
    () => `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map {
      height: 100%;
      width: 100%;
      margin: 0;
      padding: 0;
      background: #E8F0EA;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .leaflet-control-attribution { display: none; }
    .pin-target {
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: #DC2626;
      color: #fff;
      font-weight: 800;
      font-size: 12px;
      width: 30px;
      height: 30px;
      border: 2.5px solid #fff;
      box-shadow: 0 0 0 6px rgba(220,38,38,0.22), 0 2px 6px rgba(0,0,0,0.35);
    }
    .pin-live {
      border-radius: 50%;
      background: #2563EB;
      width: 18px;
      height: 18px;
      border: 2.5px solid #fff;
      box-shadow: 0 0 0 7px rgba(37,99,235,0.28);
    }
    .popup-title { font-weight: 800; font-size: 13px; color: #1E2B22; margin-bottom: 3px; }
    .popup-desc { font-size: 12px; color: #374151; margin-bottom: 4px; }
    .popup-coords { font-size: 10.5px; color: #6B7280; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    // No Leaflet: its script could not be downloaded (no internet).
    if (typeof L === 'undefined') {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('tiles-failed');
      throw new Error('Leaflet not loaded');
    }
    var map = L.map('map', { zoomControl: false }).setView([3.802, 113.784], 17);

    var streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20
    });

    var satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19
    });

    // Tell the app whether map tiles are arriving, so it can show its offline view instead
    // of a blank map (and switch back as soon as one loads).
    var tilesLoaded = 0;
    function report(status) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(status);
    }
    [streetLayer, satelliteLayer].forEach(function(layer) {
      layer.on('tileload', function() {
        tilesLoaded += 1;
        if (tilesLoaded === 1) report('tiles-ok');
      });
      layer.on('tileerror', function() {
        if (tilesLoaded === 0) report('tiles-failed');
      });
    });

    var activeLayer = streetLayer.addTo(map);
    var guideLine = L.polyline([], {
      color: '#2563EB',
      weight: 3.5,
      dashArray: '8, 8',
      opacity: 0.9
    }).addTo(map);
    var markersLayer = L.layerGroup().addTo(map);
    var userInteracted = false;

    map.on('dragstart zoomstart', function() {
      userInteracted = true;
    });

    function esc(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function fitAll(points) {
      if (!points || points.length === 0) return;
      if (points.length === 1) {
        map.setView(points[0], 18);
      } else {
        map.fitBounds(L.latLngBounds(points), { padding: [44, 44], maxZoom: 19 });
      }
    }

    window.recenterMap = function() {
      userInteracted = false;
      fitAll(window._lastAllCoords || []);
    };

    window.updateNavData = function(data) {
      if (data.mapStyle === 'satellite' && activeLayer !== satelliteLayer) {
        map.removeLayer(activeLayer);
        activeLayer = satelliteLayer.addTo(map);
      } else if (data.mapStyle === 'street' && activeLayer !== streetLayer) {
        map.removeLayer(activeLayer);
        activeLayer = streetLayer.addTo(map);
      }

      markersLayer.clearLayers();
      var allCoords = [];

      if (data.user && data.target) {
        guideLine.setLatLngs([
          [data.user.lat, data.user.lng],
          [data.target.lat, data.target.lng]
        ]);
      } else {
        guideLine.setLatLngs([]);
      }

      if (data.target) {
        allCoords.push([data.target.lat, data.target.lng]);
        var targetIcon = L.divIcon({
          className: '',
          html: '<div class="pin-target">P</div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });
        L.marker([data.target.lat, data.target.lng], { icon: targetIcon })
          .bindPopup(
            '<div class="popup-title">' + esc(data.target.title) + '</div>' +
            '<div class="popup-desc">' + esc(data.target.subtitle) + '</div>' +
            '<div class="popup-coords">' + data.target.lat.toFixed(6) + ', ' + data.target.lng.toFixed(6) + '</div>'
          )
          .addTo(markersLayer);
      }

      if (data.user) {
        allCoords.push([data.user.lat, data.user.lng]);
        var userIcon = L.divIcon({
          className: '',
          html: '<div class="pin-live"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });
        L.marker([data.user.lat, data.user.lng], { icon: userIcon })
          .bindPopup(
            '<div class="popup-title">Your Phone</div>' +
            '<div class="popup-coords">' + data.user.lat.toFixed(6) + ', ' + data.user.lng.toFixed(6) + '</div>'
          )
          .addTo(markersLayer);
      }

      window._lastAllCoords = allCoords;
      if (!userInteracted && allCoords.length > 0) {
        fitAll(allCoords);
      }
    };
  </script>
</body>
</html>
`,
    []
  );

  const syncMap = () => {
    const js = `window.updateNavData && window.updateNavData(${JSON.stringify(payload)}); true;`;
    webViewRef.current?.injectJavaScript(js);
  };

  React.useEffect(() => {
    if (mapReady) {
      syncMap();
    }
  }, [mapReady, payload]);

  const showOffline = offline || tiles === 'failed';

  // Load the map page again when the phone comes back online without tiles, and every
  // TILE_RETRY_MS while tiles keep failing. The offline view stays until a tile actually
  // arrives ('tiles-ok').
  const wasOffline = useRef(offline);
  useEffect(() => {
    if (wasOffline.current && !offline && tiles !== 'ok') webViewRef.current?.reload();
    wasOffline.current = offline;
  }, [offline, tiles]);
  useEffect(() => {
    if (tiles !== 'failed' || offline) return undefined;
    const timer = setInterval(() => webViewRef.current?.reload(), TILE_RETRY_MS);
    return () => clearInterval(timer);
  }, [tiles, offline]);

  const handleRecenter = () => {
    webViewRef.current?.injectJavaScript('window.recenterMap && window.recenterMap(); true;');
  };

  const hasCoords = currentPoint !== null || targetPoint !== null;

  return (
    <View style={[styles.container, { height }]}>
      {!hasCoords ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#213B2A" />
          <Text style={styles.loadingText}>Locating phone GPS...</Text>
        </View>
      ) : (
        <>
          <NativeWebView
            ref={webViewRef}
            source={{ html }}
            style={styles.webview}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={false}
            onLoadEnd={() => {
              setMapReady(true);
              syncMap();
            }}
            onMessage={(event) => {
              const message = event.nativeEvent.data;
              if (message === 'tiles-ok') setTiles('ok');
              else if (message === 'tiles-failed') setTiles((current) => (current === 'ok' ? current : 'failed'));
            }}
            onError={() => setTiles('failed')}
          />

          {/* Offline or no tiles: the phone-drawn view covers the (blank) map. The map stays
              underneath so it can report when tiles load again. */}
          {showOffline && offlineView ? <View style={StyleSheet.absoluteFill}>{offlineView}</View> : null}

          {showOffline && offlineView ? null : (<>
          <View style={styles.layerToggle}>
            <TouchableOpacity
              style={[
                styles.layerBtn,
                mapStyle === 'street' && styles.layerBtnActive,
              ]}
              onPress={() => setMapStyle('street')}
            >
              <Text
                style={[
                  styles.layerBtnText,
                  mapStyle === 'street' && styles.layerBtnTextActive,
                ]}
              >
                Map
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.layerBtn,
                mapStyle === 'satellite' && styles.layerBtnActive,
              ]}
              onPress={() => setMapStyle('satellite')}
            >
              <Text
                style={[
                  styles.layerBtnText,
                  mapStyle === 'satellite' && styles.layerBtnTextActive,
                ]}
              >
                Satellite
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.recenterBtn}
            onPress={handleRecenter}
            accessibilityLabel="Recenter map"
          >
            <Ionicons name="locate-outline" size={18} color="#213B2A" />
          </TouchableOpacity>
          </>)}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#E8F0EA',
    position: 'relative',
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#526659',
  },
  layerToggle: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 10,
    padding: 2,
    borderWidth: 1,
    borderColor: '#DCE4DF',
  },
  layerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  layerBtnActive: {
    backgroundColor: '#213B2A',
  },
  layerBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#213B2A',
  },
  layerBtnTextActive: {
    color: '#FFFFFF',
  },
  recenterBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DCE4DF',
  },
});