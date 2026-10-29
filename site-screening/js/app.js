import { CONFIG } from "./config.js";
import { reverseGeocode, fetchNearby, fetchLanduse, fetchMlit } from "./sources.js";
import { evaluate } from "./rules.js";

const PRESETS = [
  { id: "kita", label: "北広島市(蓄電所の例)", lat: 42.9847, lng: 141.5627, z: 15 },
  { id: "fuku", label: "福島市", lat: 37.7608, lng: 140.4747, z: 15 },
  { id: "japan", label: "日本全体", lat: 37.5, lng: 137.5, z: 5, noRun: true }
];
const STATUS_LABEL = { ok: "確認済み", warn: "確認済み・注意", todo: "未確認" };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let map, marker, circle, layer, rules = {}, seq = 0;

async function init() {
  try { rules = await (await fetch("data/municipalities.json")).json(); } catch (e) { rules = {}; }
  map = L.map("map").setView([37.5, 137.5], 5);
  L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
    maxZoom: 18
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
  marker = L.marker([37.5, 137.5], { draggable: true });
  marker.on("dragend", () => { const p = marker.getLatLng(); run(p.lat, p.lng, false); });
  map.on("click", (e) => run(e.latlng.lat, e.latlng.lng, false));

  $("presets").innerHTML = PRESETS.map((p) => `<button type="button" data-id="${p.id}">${esc(p.label)}</button>`).join("");
  $("presets").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const p = PRESETS.find((x) => x.id === b.dataset.id);
    if (p.noRun) { map.setView([p.lat, p.lng], p.z); return; }
    run(p.lat, p.lng, true, p.z);
  });
  $("proxyNote").hidden = !!CONFIG.PROXY_URL;
  $("result").innerHTML = '<p class="hint">地図をクリックするか、ピンを動かすと、その地点を判定します。</p>';
}

async function run(lat, lng, fly, z) {
  const my = ++seq;
  marker.setLatLng([lat, lng]).addTo(map);
  if (fly) map.setView([lat, lng], z || 15);
  $("result").innerHTML = '<p class="hint">取得中…(地図データの混雑時は十数秒かかります)</p>';

  const settle = async (p) => { try { return { v: await p }; } catch (e) { return { e: e.message || String(e) }; } };
  const mlitState = async (layerName) => {
    if (!CONFIG.PROXY_URL) return { state: "off" };
    const r = await settle(fetchMlit(layerName, lat, lng));
    return r.e ? { state: "err", error: r.e } : { state: "ok", rows: r.v || [] };
  };
  // Overpass への同時アクセスを避けるため、OSM系は順番に取得。国の API・住所は並行。
  const geoP = settle(reverseGeocode(lat, lng));
  const kP = mlitState("XKT001"), zP = mlitState("XKT002");
  const nb = await settle(fetchNearby(lat, lng));
  const lu = await settle(fetchLanduse(lat, lng));
  const [geo, kubun, zoning] = await Promise.all([geoP, kP, zP]);
  if (my !== seq) return; // 後から押された操作を優先

  const muni = geo.v || null;
  const nearby = nb.v || null;
  const res = evaluate({ muni, nearby, landuse: lu.v || null, mlit: { kubun, zoning }, rules });
  draw(lat, lng, nearby, res.radius);
  render(muni, geo.e, res);
}

function draw(lat, lng, nearby, radius) {
  layer.clearLayers();
  if (circle) { circle = null; }
  L.circle([lat, lng], { radius, color: "#b45309", weight: 1.5, fillOpacity: 0.05 }).addTo(layer);
  if (!nearby) return;
  for (const b of nearby.buildings.slice(0, 300)) {
    L.circleMarker([b.lat, b.lng], { radius: b.res ? 3.5 : 2, color: b.res ? "#b91c1c" : "#6b7280", weight: 1, fillOpacity: 0.8 }).addTo(layer);
  }
  const n = nearby.buildings.find((b) => b.res);
  if (n) L.polyline([[lat, lng], [n.lat, n.lng]], { color: "#b91c1c", weight: 2, dashArray: "4 4" }).addTo(layer);
}

function srcHtml(s) {
  if (!s) return '<span class="nosrc">出典なし</span>';
  return s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title);
}

function render(muni, geoErr, res) {
  const head = muni
    ? `<h2>${esc(muni.name || "市区町村コード " + muni.code)}<small>${esc(muni.detail || "")}</small></h2>`
    : `<h2>所在地を特定できません<small>${esc(geoErr || "日本国外・海上の可能性")}</small></h2>`;
  const counts = `<p class="counts"><span class="chip ok">確認済み ${res.ok}</span><span class="chip todo">未確認 ${res.todo}</span>${res.warn ? `<span class="chip warn">注意 ${res.warn}</span>` : ""}</p>`;
  const body = res.sections.map((s) => `
    <section><h3>${esc(s.title)}</h3>
    ${s.rows.map((r) => `
      <div class="row ${r.status}">
        <div class="lab"><span class="badge ${r.status}">${STATUS_LABEL[r.status]}</span>${esc(r.label)}</div>
        <div class="txt">${esc(r.text)}</div>
        <div class="src">出典: ${srcHtml(r.source)}${r.hint ? `<br><span class="h">${esc(r.hint)}</span>` : ""}</div>
      </div>`).join("")}
    </section>`).join("");
  $("result").innerHTML = head + counts + body +
    '<p class="foot">これは一次スクリーニングです。許認可・法的判断・自治体の見解の代わりにはなりません。「未確認」は必ず原典・窓口で確認してください。</p>';
}

init();
