// 判定のルール。取得したデータ(ctx)から「項目ごとの表示内容」を作る。
// 状態: ok=データを取得し出典あり(確認済み) / warn=確認済みだが注意 / todo=未確認(要確認)
import { CONFIG } from "./config.js";
import { round5 } from "./geo.js";

const OSM = { title: "OpenStreetMap contributors(Overpass API)", url: "https://www.openstreetmap.org/copyright" };
const MLIT = { title: "国土交通省 不動産情報ライブラリ(都市計画情報)", url: "https://www.reinfolib.mlit.go.jp/" };
const EGOV = { title: "e-Gov法令検索", url: "https://laws.e-gov.go.jp/" };

const ROAD_JA = {
  motorway: "高速道路", trunk: "幹線道路", primary: "主要道路", secondary: "二次道路", tertiary: "三次道路",
  residential: "住宅地の道路", unclassified: "一般道", service: "敷地内・サービス道路", track: "農道・林道(未舗装の可能性)",
  path: "歩道・小道", footway: "歩道", living_street: "生活道路"
};

function findRule(rules, code) {
  if (!code) return null;
  if (rules[code]) return rules[code];
  for (const k of Object.keys(rules)) if (k.endsWith("*") && code.startsWith(k.slice(0, -1))) return rules[k];
  return null;
}

function mlitRow(label, st, build) {
  if (st.state === "off") return { label, text: "未確認:中継サーバー(PROXY_URL)が未設定のため取得していません", status: "todo", source: MLIT, hint: "README の手順で国の API キーと中継サーバーを設定すると、ここに自動で入ります" };
  if (st.state === "err") return { label, text: "未確認:取得に失敗しました(" + st.error + ")", status: "todo", source: MLIT, hint: "時間をおいて再実行、または市の都市計画課・公開GISで確認" };
  if (!st.rows.length) return { label, text: "未確認:この地点に該当する区域が返りませんでした(都市計画区域外の可能性)", status: "todo", source: MLIT, hint: "都市計画区域外かどうかを市に確認" };
  return { label, text: build(st.rows[0]), status: "ok", source: MLIT, hint: "データの更新時期により現況と異なる場合があります" };
}

export function evaluate(ctx) {
  const { muni, nearby, landuse, mlit, rules } = ctx;
  const rule = muni ? findRule(rules, muni.code) : null;
  const sections = [];

  // ---------- 1. 土地の規制 ----------
  const kubunText = mlit.kubun.state === "ok" && mlit.kubun.rows[0] ? (mlit.kubun.rows[0].area_classification_ja || "") : "";
  const isUrban = /市街化区域/.test(kubunText) && !/調整/.test(kubunText);
  const isAdjust = /市街化調整/.test(kubunText);

  const land = [];
  land.push(mlitRow("区域区分(市街化区域など)", mlit.kubun, (p) => p.area_classification_ja || "区分名の取得なし"));
  land.push(mlitRow("用途地域", mlit.zoning, (p) => {
    const t = [p.use_area_ja || "名称なし"];
    if (p.u_building_coverage_ratio_ja) t.push("建ぺい率 " + p.u_building_coverage_ratio_ja);
    if (p.u_floor_area_ratio_ja) t.push("容積率 " + p.u_floor_area_ratio_ja);
    return t.join(" / ");
  }));

  const farm = landuse ? landuse.filter((x) => CONFIG.FARMLAND.includes(x)) : null;
  let farmText = "農地転用の要否は、登記・現況・農業委員会の判断で決まります。";
  if (farm === null) farmText = "未確認:土地利用の取得に失敗しました。" + farmText;
  else if (farm.length) farmText = "農地の可能性あり(地図上の土地利用: " + [...new Set(farm)].join("、") + ")。" + farmText;
  else farmText = "地図上では農地の記載なし(未登録の場合あり)。" + farmText;
  if (isUrban) farmText += " 市街化区域のため、農地であれば転用は届出で足りる可能性(農業委員会に要確認)。";
  else if (isAdjust) farmText += " 市街化調整区域のため、農地であれば転用許可・開発許可とも厳しい判断になる可能性(要確認)。";
  else farmText += " 農地であれば農地法第4条・第5条の許可(市街化区域は届出)が論点になります。";
  land.push({ label: "農地転用の見込み", text: farmText, status: "todo", source: EGOV, hint: "登記簿の地目と農業委員会への確認が必要。OSMは農地の網羅的な台帳ではありません" });

  let devText = "開発許可(都市計画法第29条)の要否と見込みは、敷地の規模・区域区分・計画内容で決まります。";
  if (isUrban) devText += " 市街化区域では一定規模以上(原則1,000㎡以上と言われる)で必要になる可能性。";
  else if (isAdjust) devText += " 市街化調整区域は原則抑制のため、許可の見込みは個別に厳しく審査される可能性。";
  else devText += " 非線引き区域等では3,000㎡以上が目安とされる場合あり。";
  devText += " 規模・扱いは自治体の運用で異なるため要確認。";
  land.push({ label: "開発許可の見込み", text: devText, status: "todo", source: EGOV, hint: "都道府県・市の開発許可担当に事前相談(蓄電所が開発行為に当たるかも要確認)" });
  sections.push({ id: "land", title: "土地の規制", rows: land });

  // ---------- 2. 周辺住宅との距離と市の基準 ----------
  const dist = [];
  if (!nearby) {
    dist.push({ label: "最寄りの住宅系建物", text: "未確認:周辺建物の取得に失敗しました", status: "todo", source: OSM, hint: "時間をおいて再実行、または現地・航空写真で確認" });
  } else {
    const res = nearby.buildings.filter((b) => b.res);
    const any = nearby.buildings;
    const lim = rule && rule.distance_m;
    const rad = lim || CONFIG.REF_RADIUS_M;
    const within = res.filter((b) => b.d <= rad).length;
    if (res.length) {
      const nearest = res[0].d;
      let t = "約" + round5(nearest) + "m(半径" + rad + "m以内に " + within + "棟)";
      let st = "ok";
      if (lim && nearest < lim) { t += " → 市の基準 " + lim + "m より近い"; st = "warn"; }
      dist.push({ label: "最寄りの住宅系建物", text: t, status: st, source: OSM, hint: "概算。OSMに未登録の家があると実際より遠く出ます。種別が不明な建物(yes)は住宅に数えていません" });
    } else {
      dist.push({ label: "最寄りの住宅系建物", text: "800m以内に住宅系の建物は見つかりませんでした(建物全体 " + any.length + "棟)", status: "ok", source: OSM, hint: "OSMの登録漏れの可能性があります。航空写真で必ず確認" });
    }
    if (any.length && (!res.length || any[0].d < (res[0] || any[0]).d)) {
      dist.push({ label: "最寄りの建物(種別不問)", text: "約" + round5(any[0].d) + "m(種別: " + any[0].type + ")", status: "ok", source: OSM, hint: "住宅か事業用かは地図上では判別できない場合があります" });
    }
  }
  if (rule && rule.distance_m) {
    const d = rule.documents && rule.documents[0];
    const sourced = !!(d && d.url);
    dist.push({ label: "市の距離の基準(" + rule.name + ")", text: rule.distance_text, status: sourced ? "ok" : "todo", source: d ? { title: d.title, url: d.url } : null, hint: sourced ? "" : "出典URL未登録。市の公開原文で数値と対象設備を確認" });
  } else {
    dist.push({ label: "市の距離の基準", text: "未確認:この市の基準は未登録です", status: "todo", source: null, hint: muni ? "下の『条例・ガイドライン』のリンクから市の公開ページで確認し、data/municipalities.json に追記" : "" });
  }
  sections.push({ id: "dist", title: "周辺住宅との距離と市の基準", rows: dist });

  // ---------- 3. 条例・ガイドライン・手続き・様式 ----------
  const ord = [];
  if (rule) {
    for (const d of rule.documents || []) {
      ord.push({ label: "条例・ガイドライン", text: d.title + (d.note ? "(" + d.note + ")" : ""), status: d.url ? "ok" : "todo", source: d.url ? { title: d.title, url: d.url } : null, hint: d.url ? "" : "出典URL未登録。市の公開原文で最新版・対象設備を確認" });
    }
    ord.push({ label: "必要な手続き・様式", text: rule.forms || "未確認:様式の情報は未登録です", status: "todo", source: null, hint: "届出・協議の時期(着工何日前か等)は原文で確認" });
    for (const n of rule.notes || []) ord.push({ label: "留意点", text: n, status: "todo", source: null, hint: "" });
  } else {
    const q = encodeURIComponent((muni && muni.name ? muni.name : "") + " 発電設備 蓄電所 条例 ガイドライン");
    ord.push({ label: "条例・ガイドライン", text: "未確認:" + (muni && muni.name ? muni.name : "この市") + "の基準は未登録です", status: "todo", source: { title: "市の公開ページを検索(参考リンク)", url: "https://www.google.com/search?q=" + q }, hint: "原文を確認したら data/municipalities.json に追記すると、次回から表示されます" });
    ord.push({ label: "必要な手続き・様式", text: "未確認:市の原文で確認してください", status: "todo", source: null, hint: "" });
  }
  sections.push({ id: "ord", title: "市の条例・ガイドラインと、必要な手続き・様式", rows: ord });

  // ---------- 4. 注意点 ----------
  const care = [];
  if (nearby) {
    const res = nearby.buildings.filter((b) => b.res);
    const n300 = res.filter((b) => b.d <= 300).length;
    care.push({ label: "住民", text: "300m以内の住宅系建物 約" + n300 + "棟。説明会・周知の要否と範囲は市の基準と事業者判断(上の基準を確認)", status: "todo", source: OSM, hint: "棟数は概算。住民への説明そのものは事業者が行います" });
    const r = nearby.roads[0];
    if (r) {
      const w = r.width ? "、幅員タグ " + r.width + "m" : "";
      care.push({ label: "道路・搬入", text: "約" + round5(r.d) + "m以内に " + (ROAD_JA[r.cls] || r.cls) + (r.name ? "(" + r.name + ")" : "") + w, status: "todo", source: OSM, hint: "地図上の道路の有無のみ。大型車の通行可否・幅員・接道条件は現地と道路管理者で確認" });
    } else {
      care.push({ label: "道路・搬入", text: "60m以内に道路が見つかりません(接道なしの可能性)", status: "todo", source: OSM, hint: "接道の有無は現地・公図で必ず確認" });
    }
    const f = nearby.fire[0];
    care.push({ label: "消防", text: f ? "最寄りの消防署 約" + (f.d / 1000).toFixed(1) + "km" + (f.name ? "(" + f.name + ")" : "") : "10km以内に消防署が見つかりません(未登録の可能性)", status: "todo", source: OSM, hint: "蓄電設備の消防協議・届出の要否は管轄の消防本部に確認" });
  } else {
    for (const l of ["住民", "道路・搬入", "消防"]) care.push({ label: l, text: "未確認:周辺データの取得に失敗しました", status: "todo", source: OSM, hint: "" });
  }
  sections.push({ id: "care", title: "注意点(住民・道路搬入・消防)", rows: care });

  let ok = 0, todo = 0, warn = 0;
  for (const s of sections) for (const r of s.rows) { if (r.status === "ok") ok++; else if (r.status === "warn") { ok++; warn++; } else todo++; }
  return { sections, ok, todo, warn, radius: (rule && rule.distance_m) || CONFIG.REF_RADIUS_M };
}
