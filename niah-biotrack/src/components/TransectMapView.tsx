import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { WebView, type WebViewProps } from 'react-native-webview';
import type { RoutePoint } from '../store/useRecordStore';
import MapControls from './MapControls';

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
  // The path walked so far during navigation, drawn as a thin line.
  trail?: { latitude: number; longitude: number }[];
  // Which way the phone faces (compass), shown as the arrow and cone of the phone marker.
  heading?: number | null;
  // Navigating: the map keeps the phone in view (until the botanist pans or zooms).
  follow?: boolean;
  // Drawn at the top of the map (online and offline), e.g. the guidance panel.
  overlay?: React.ReactNode;
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
  trail = [],
  heading = null,
  follow = false,
  overlay = null,
}: TransectMapViewProps) {
  const webViewRef = useRef<WebView | null>(null);
  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');
  const [mapReady, setMapReady] = useState(false);
  // 'unknown' until the first tile loads or fails. The map page reports it (see the
  // tileload / tileerror handlers in the HTML below).
  const [tiles, setTiles] = useState<'unknown' | 'ok' | 'failed'>('unknown');
  // The botanist panned or zoomed by hand: the map stops following until "recenter".
  const [paused, setPaused] = useState(false);

  // The compass changes many times a second; 3° steps are plenty for the marker and keep
  // the map from being redrawn constantly.
  const roundedHeading = heading === null || !Number.isFinite(heading) ? null : Math.round(heading / 3) * 3;

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
      trail: trail.map((point) => [point.latitude, point.longitude]),
      heading: roundedHeading,
      follow,
    }),
    [currentPoint, targetPoint, mapStyle, trail, roundedHeading, follow]
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
    .leaflet-control-scale { margin-left: 10px !important; margin-bottom: 10px !important; }
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
    /* The phone: a blue arrow turning with the compass, a light cone the way it faces. */
    .me { position: relative; width: 64px; height: 64px; }
    .me-rot { position: absolute; inset: 0; transition: transform 0.25s linear; }
    .me-cone {
      position: absolute; left: 50%; top: 0; width: 0; height: 0; transform: translateX(-50%);
      border-left: 18px solid transparent; border-right: 18px solid transparent;
      border-top: 32px solid rgba(37,99,235,0.22);
    }
    .me-dot {
      position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px;
      border-radius: 50%; background: #2563EB; border: 2.5px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.35);
    }
    .me-arrow {
      position: absolute; left: 50%; top: 50%; width: 0; height: 0; margin: -9px 0 0 -5px;
      border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 10px solid #fff;
    }
    .me.no-heading .me-cone, .me.no-heading .me-arrow { display: none; }
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
    // Pinch, drag and double-tap zoom are on; the buttons are drawn by the app.
    var map = L.map('map', {
      zoomControl: false,
      dragging: true,
      touchZoom: true,
      doubleClickZoom: true,
      scrollWheelZoom: false
    }).setView([3.802, 113.784], 17);
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

    var streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20
    });

    var satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19
    });

    function report(status) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(status);
    }

    // Tell the app whether map tiles are arriving, so it can show its offline view instead
    // of a blank map (and switch back as soon as one loads).
    var tilesLoaded = 0;
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
    // The walked path during navigation: a thin solid line under the markers.
    var trailLine = L.polyline([], {
      color: '#1D4ED8',
      weight: 2.5,
      opacity: 0.7
    }).addTo(map);
    var guideLine = L.polyline([], {
      color: '#2563EB',
      weight: 3.5,
      dashArray: '8, 8',
      opacity: 0.9
    }).addTo(map);
    var targetMarker = null;
    var userMarker = null;
    var lastData = null;
    var lastFitKey = null;

    // Following: the map moves itself to keep the phone (and plant) in view. A pan, pinch or
    // double-tap by the botanist pauses that until the app's recenter button is tapped.
    var following = true;
    function pauseFollowing() {
      if (!following) return;
      following = false;
      report('follow-paused');
    }
    map.on('dragstart', pauseFollowing);
    map.on('dblclick', pauseFollowing);
    map.getContainer().addEventListener('touchstart', function(event) {
      if (event.touches && event.touches.length > 1) pauseFollowing();
    }, { passive: true });

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
        map.fitBounds(L.latLngBounds(points), { padding: [70, 70], maxZoom: 19 });
      }
    }

    function moveToFit(data) {
      if (!following || !data) return;
      var points = [];
      if (data.user) points.push([data.user.lat, data.user.lng]);
      if (data.target) points.push([data.target.lat, data.target.lng]);
      if (data.follow && data.user) {
        // Navigating: centre on the phone, keeping the zoom (but not zoomed far out).
        map.setView([data.user.lat, data.user.lng], Math.max(map.getZoom(), 17), { animate: true });
      } else {
        fitAll(points);
      }
    }

    window.recenterMap = function() {
      following = true;
      report('follow-on');
      moveToFit(lastData);
    };

    window.zoomMap = function(step) {
      pauseFollowing();
      if (step > 0) map.zoomIn(); else map.zoomOut();
    };

    function userIcon(heading) {
      var noHeading = heading === null || heading === undefined;
      var rotation = noHeading ? 0 : heading;
      return L.divIcon({
        className: '',
        html: '<div class="me' + (noHeading ? ' no-heading' : '') + '">' +
          '<div class="me-rot" style="transform: rotate(' + rotation + 'deg)">' +
          '<div class="me-cone"></div><div class="me-dot"></div><div class="me-arrow"></div>' +
          '</div></div>',
        iconSize: [64, 64],
        iconAnchor: [32, 32]
      });
    }

    window.updateNavData = function(data) {
      lastData = data;
      if (data.mapStyle === 'satellite' && activeLayer !== satelliteLayer) {
        map.removeLayer(activeLayer);
        activeLayer = satelliteLayer.addTo(map);
      } else if (data.mapStyle === 'street' && activeLayer !== streetLayer) {
        map.removeLayer(activeLayer);
        activeLayer = streetLayer.addTo(map);
      }

      trailLine.setLatLngs(data.trail || []);

      if (data.user && data.target) {
        guideLine.setLatLngs([
          [data.user.lat, data.user.lng],
          [data.target.lat, data.target.lng]
        ]);
      } else {
        guideLine.setLatLngs([]);
      }

      if (data.target) {
        var targetLatLng = [data.target.lat, data.target.lng];
        if (!targetMarker) {
          targetMarker = L.marker(targetLatLng, {
            icon: L.divIcon({ className: '', html: '<div class="pin-target">P</div>', iconSize: [30, 30], iconAnchor: [15, 15] })
          }).addTo(map);
        } else {
          targetMarker.setLatLng(targetLatLng);
        }
        targetMarker.bindPopup(
          '<div class="popup-title">' + esc(data.target.title) + '</div>' +
          '<div class="popup-desc">' + esc(data.target.subtitle) + '</div>' +
          '<div class="popup-coords">' + data.target.lat.toFixed(6) + ', ' + data.target.lng.toFixed(6) + '</div>'
        );
      } else if (targetMarker) {
        map.removeLayer(targetMarker);
        targetMarker = null;
      }

      if (data.user) {
        var userLatLng = [data.user.lat, data.user.lng];
        if (!userMarker) {
          userMarker = L.marker(userLatLng, { icon: userIcon(data.heading), zIndexOffset: 1000, interactive: false }).addTo(map);
        } else {
          userMarker.setLatLng(userLatLng);
          // Turn the existing arrow instead of rebuilding the marker (smooth rotation).
          var element = userMarker.getElement();
          var me = element && element.querySelector('.me');
          var rot = element && element.querySelector('.me-rot');
          if (me && rot) {
            var noHeading = data.heading === null || data.heading === undefined;
            me.className = 'me' + (noHeading ? ' no-heading' : '');
            rot.style.transform = 'rotate(' + (noHeading ? 0 : data.heading) + 'deg)';
          }
        }
      } else if (userMarker) {
        map.removeLayer(userMarker);
        userMarker = null;
      }

      // Move the map only when a position or the follow mode changed: the compass alone
      // (many updates a second) just turns the arrow.
      var fitKey = JSON.stringify([data.user, data.target && [data.target.lat, data.target.lng], data.follow]);
      if (fitKey !== lastFitKey) {
        lastFitKey = fitKey;
        moveToFit(data);
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
    setPaused(false);
    webViewRef.current?.injectJavaScript('window.recenterMap && window.recenterMap(); true;');
  };
  const zoom = (step: 1 | -1) => {
    webViewRef.current?.injectJavaScript(`window.zoomMap && window.zoomMap(${step}); true;`);
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
              setPaused(false);
              syncMap();
            }}
            onMessage={(event) => {
              const message = event.nativeEvent.data;
              if (message === 'tiles-ok') setTiles('ok');
              else if (message === 'tiles-failed') setTiles((current) => (current === 'ok' ? current : 'failed'));
              else if (message === 'follow-paused') setPaused(true);
              else if (message === 'follow-on') setPaused(false);
            }}
            onError={() => setTiles('failed')}
          />

          {/* Offline or no tiles: the phone-drawn view covers the (blank) map. The map stays
              underneath so it can report when tiles load again. */}
          {showOffline && offlineView ? <View style={StyleSheet.absoluteFill}>{offlineView}</View> : null}

          {showOffline && offlineView ? null : (
            <>
              <MapControls onZoomIn={() => zoom(1)} onZoomOut={() => zoom(-1)} onRecenter={handleRecenter} paused={paused} />

              <View style={styles.layerToggle}>
                {(['street', 'satellite'] as const).map((style) => (
                  <TouchableOpacity
                    key={style}
                    style={[styles.layerBtn, mapStyle === style && styles.layerBtnActive]}
                    onPress={() => setMapStyle(style)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.layerBtnText, mapStyle === style && styles.layerBtnTextActive]}>
                      {style === 'street' ? 'Map' : 'Satellite'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* The guidance panel (or anything else the screen puts on top), online and offline. */}
          {overlay ? (
            <View style={styles.overlay} pointerEvents="box-none">
              {overlay}
            </View>
          ) : null}
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
  overlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
  },
  layerToggle: {
    position: 'absolute',
    bottom: 10,
    right: 10,
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
});
