// 地理計算の小さな道具。外部ライブラリなし。

/** 2点間の距離(m)。 */
export function hav(lat1, lng1, lat2, lng2) {
  const R = 6371000, t = Math.PI / 180;
  const dLat = (lat2 - lat1) * t, dLng = (lng2 - lng1) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** 緯度経度 → XYZタイル座標(国土地理院・OSMと同じ方式)。 */
export function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y, z };
}

function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lng, lat, rings) {
  if (!rings.length || !inRing(lng, lat, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(lng, lat, rings[k])) return false; // 穴
  return true;
}

/** GeoJSON の Feature(Polygon / MultiPolygon)が、点を含むか。 */
export function featureContains(feature, lng, lat) {
  const g = feature && feature.geometry;
  if (!g) return false;
  if (g.type === "Polygon") return inPolygon(lng, lat, g.coordinates);
  if (g.type === "MultiPolygon") return g.coordinates.some((p) => inPolygon(lng, lat, p));
  return false;
}

export const round5 = (m) => Math.round(m / 5) * 5;
