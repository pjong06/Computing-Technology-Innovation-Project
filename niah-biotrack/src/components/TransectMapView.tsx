import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { WebView, type WebViewProps } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import type { RoutePoint, RouteWaypoint } from '../store/useRecordStore';

const NativeWebView = WebView as unknown as React.ComponentType<
  WebViewProps & { ref?: React.Ref<WebView> }
>;

interface TransectMapViewProps {
  breadcrumbs: RoutePoint[];
  currentPoint: RoutePoint | null;
  waypoints: RouteWaypoint[];
  startDescription?: string;
  endDescription?: string;
  isFinished?: boolean;
  height?: number;
}

export default function TransectMapView({
  breadcrumbs,
  currentPoint,
  waypoints,
  startDescription = '',
  endDescription = '',
  isFinished = false,
  height = 240,
}: TransectMapViewProps) {
  const webViewRef = useRef<WebView | null>(null);
  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');
  const [mapReady, setMapReady] = useState(false);

  const payload = useMemo(() => {
    const pts =
      breadcrumbs.length > 0
        ? breadcrumbs
        : currentPoint
        ? [currentPoint]
        : [];

    const start = pts[0] ?? null;
    const end = isFinished
      ? pts[pts.length - 1] ?? currentPoint
      : currentPoint ?? pts[pts.length - 1] ?? null;

    return {
      points: pts.map((p) => [p.latitude, p.longitude]),
      start: start
        ? {
            lat: start.latitude,
            lng: start.longitude,
            description: startDescription.trim() || 'Transect starting point',
          }
        : null,
      end: end
        ? {
            lat: end.latitude,
            lng: end.longitude,
            description:
              endDescription.trim() ||
              (isFinished ? 'Transect end point' : 'Current live GPS position'),
          }
        : null,
      waypoints: waypoints.map((wp) => ({
        number: wp.number,
        label: wp.label,
        description: wp.description?.trim() || '',
        lat: wp.latitude,
        lng: wp.longitude,
        timeString: wp.timeString,
      })),
      isFinished,
      mapStyle,
    };
  }, [
    breadcrumbs,
    currentPoint,
    waypoints,
    startDescription,
    endDescription,
    isFinished,
    mapStyle,
  ]);

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
    .pin {
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      color: #fff;
      font-weight: 800;
      font-size: 11px;
      border: 2.5px solid #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    }
    .pin-start { background: #16A34A; width: 26px; height: 26px; }
    .pin-end { background: #DC2626; width: 26px; height: 26px; }
    .pin-wp { background: #D97706; width: 24px; height: 24px; }
    .pin-live {
      background: #2563EB;
      width: 18px;
      height: 18px;
      box-shadow: 0 0 0 6px rgba(37,99,235,0.28);
    }
    .popup-title { font-weight: 800; font-size: 13px; color: #1E2B22; margin-bottom: 3px; }
    .popup-desc { font-size: 12px; color: #374151; margin-bottom: 4px; }
    .popup-coords { font-size: 10.5px; color: #6B7280; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false }).setView([3.802, 113.784], 17);

    var streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20
    });

    var satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19
    });

    var activeLayer = streetLayer.addTo(map);
    var trailLine = L.polyline([], { color: '#16A34A', weight: 4.5, opacity: 0.9 }).addTo(map);
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
        map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 19 });
      }
    }

    window.recenterMap = function() {
      userInteracted = false;
      fitAll(window._lastAllCoords || []);
    };

    window.updateRouteData = function(data) {
      if (data.mapStyle === 'satellite' && activeLayer !== satelliteLayer) {
        map.removeLayer(activeLayer);
        activeLayer = satelliteLayer.addTo(map);
      } else if (data.mapStyle === 'street' && activeLayer !== streetLayer) {
        map.removeLayer(activeLayer);
        activeLayer = streetLayer.addTo(map);
      }

      trailLine.setLatLngs(data.points || []);
      markersLayer.clearLayers();

      var allCoords = (data.points || []).slice();

      if (data.start) {
        allCoords.push([data.start.lat, data.start.lng]);
        var startIcon = L.divIcon({
          className: '',
          html: '<div class="pin pin-start">S</div>',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });
        L.marker([data.start.lat, data.start.lng], { icon: startIcon })
          .bindPopup(
            '<div class="popup-title">Start Point</div>' +
            '<div class="popup-desc">' + esc(data.start.description) + '</div>' +
            '<div class="popup-coords">' + data.start.lat.toFixed(6) + ', ' + data.start.lng.toFixed(6) + '</div>'
          )
          .addTo(markersLayer);
      }

      (data.waypoints || []).forEach(function(wp) {
        allCoords.push([wp.lat, wp.lng]);
        var wpIcon = L.divIcon({
          className: '',
          html: '<div class="pin pin-wp">' + wp.number + '</div>',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });
        var descHtml = wp.description
          ? '<div class="popup-desc">' + esc(wp.description) + '</div>'
          : '';
        L.marker([wp.lat, wp.lng], { icon: wpIcon })
          .bindPopup(
            '<div class="popup-title">#' + wp.number + ' · ' + esc(wp.label) + '</div>' +
            descHtml +
            '<div class="popup-coords">' + wp.lat.toFixed(6) + ', ' + wp.lng.toFixed(6) + ' · ' + esc(wp.timeString) + '</div>'
          )
          .addTo(markersLayer);
      });

      if (data.end) {
        allCoords.push([data.end.lat, data.end.lng]);
        var endIcon = L.divIcon({
          className: '',
          html: data.isFinished
            ? '<div class="pin pin-end">E</div>'
            : '<div class="pin pin-live"></div>',
          iconSize: data.isFinished ? [26, 26] : [18, 18],
          iconAnchor: data.isFinished ? [13, 13] : [9, 9]
        });
        L.marker([data.end.lat, data.end.lng], { icon: endIcon })
          .bindPopup(
            '<div class="popup-title">' + (data.isFinished ? 'End Point' : 'Current Position') + '</div>' +
            '<div class="popup-desc">' + esc(data.end.description) + '</div>' +
            '<div class="popup-coords">' + data.end.lat.toFixed(6) + ', ' + data.end.lng.toFixed(6) + '</div>'
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
    const js = `window.updateRouteData && window.updateRouteData(${JSON.stringify(payload)}); true;`;
    webViewRef.current?.injectJavaScript(js);
  };

  React.useEffect(() => {
    if (mapReady) {
      syncMap();
    }
  }, [mapReady, payload]);

  const handleRecenter = () => {
    webViewRef.current?.injectJavaScript('window.recenterMap && window.recenterMap(); true;');
  };

  const hasCoords = breadcrumbs.length > 0 || currentPoint !== null;

  return (
    <View style={[styles.container, { height }]}>
      {!hasCoords ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#213B2A" />
          <Text style={styles.loadingText}>Waiting for first GPS lock...</Text>
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
          />

          {/* Map / Satellite Layer Toggle */}
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

          {/* Recenter Button */}
          <TouchableOpacity
            style={styles.recenterBtn}
            onPress={handleRecenter}
            accessibilityLabel="Recenter map"
          >
            <Ionicons name="locate-outline" size={18} color="#213B2A" />
          </TouchableOpacity>
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