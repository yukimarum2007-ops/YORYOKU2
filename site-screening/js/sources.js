// データの取得。ここだけがネットワークに触れる。
// どの取得も失敗しうるので、呼び出し側(app.js)が失敗を「未確認」として扱う。
import { CONFIG } from "./config.js";
import { hav, lngLatToTile, featureContains } from "./geo.js";

function withTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

/** 国土地理院 逆ジオコーダ:点 → 市区町村コード。名前は muni.js(index.html で読み込み)から引く。 */
export async function reverseGeocode(lat, lng) {
  const r = await withTimeout(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`, {}, 10000);
  if (!r.ok) throw new Error("gsi " + r.status);
  const j = await r.json();
  const code = j && j.results && String(j.results.muniCd || "");
  if (!code) return null;
  let name = null;
  try {
    const rec = window.MUNI_ARRAY && window.MUNI_ARRAY[code];
    if (rec) { const p = String(rec).split(","); name = (p[1] || "") + (p[3] || ""); }
  } catch (e) { /* 名前なし */ }
  return { code, name, detail: j.results.lv01Nm || "" };
}

async function overpass(query) {
  const body = "data=" + encodeURIComponent(query);
  let lastErr;
  for (const url of CONFIG.OVERPASS) {
    try {
      const r = await withTimeout(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, 25000);
      if (!r.ok) throw new Error("overpass " + r.status);
      return (await r.json()).elements || [];
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** OpenStreetMap(Overpass):周辺の建物・道路・消防署。 */
export async function fetchNearby(lat, lng) {
  const q = `[out:json][timeout:25];
(way["building"](around:800,${lat},${lng}););out center tags 500;
(way["highway"](around:60,${lat},${lng}););out center tags 60;
(nwr["amenity"="fire_station"](around:10000,${lat},${lng}););out center tags 20;`;
  const els = await overpass(q);
  const buildings = [], roads = [], fire = [];
  for (const e of els) {
    const t = e.tags || {};
    const c = e.center || (e.lat != null ? { lat: e.lat, lon: e.lon } : null);
    if (!c) continue;
    const d = hav(lat, lng, c.lat, c.lon);
    if (t.building) buildings.push({ lat: c.lat, lng: c.lon, d, type: t.building, res: CONFIG.RESIDENTIAL.includes(t.building) });
    else if (t.highway) roads.push({ cls: t.highway, name: t.name || "", width: t.width || "", d });
    else if (t.amenity === "fire_station") fire.push({ lat: c.lat, lng: c.lon, d, name: t.name || "" });
  }
  buildings.sort((a, b) => a.d - b.d);
  roads.sort((a, b) => a.d - b.d);
  fire.sort((a, b) => a.d - b.d);
  return { buildings, roads, fire };
}

/** OpenStreetMap(Overpass):点を含む土地利用(農地かどうかの手がかり)。 */
export async function fetchLanduse(lat, lng) {
  const els = await overpass(`[out:json][timeout:25];is_in(${lat},${lng})->.a;area.a["landuse"];out tags;`);
  return els.map((e) => (e.tags && e.tags.landuse) || "").filter(Boolean);
}

/**
 * 国土交通省 不動産情報ライブラリ(中継サーバー経由):点を含む都市計画のポリゴンの属性。
 * layer: "XKT001"(区域区分) または "XKT002"(用途地域)。PROXY_URL が空なら null を返す。
 */
export async function fetchMlit(layer, lat, lng) {
  if (!CONFIG.PROXY_URL) return null;
  const z = 15;
  const { x, y } = lngLatToTile(lng, lat, z);
  const r = await withTimeout(`${CONFIG.PROXY_URL.replace(/\/$/, "")}/${layer}?z=${z}&x=${x}&y=${y}`, {}, 20000);
  if (!r.ok) throw new Error(layer + " " + r.status);
  const j = await r.json();
  return (j.features || []).filter((f) => featureContains(f, lng, lat)).map((f) => f.properties || {});
}
