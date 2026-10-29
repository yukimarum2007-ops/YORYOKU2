// 設定ファイル。
// PROXY_URL: 国土交通省「不動産情報ライブラリ」のAPIを中継するサーバー(worker/reinfolib-proxy.js)のURL。
//   空のままでも動きますが、用途地域・区域区分は「未確認」と表示されます。
//   例: "https://site-screening-proxy.<あなたのアカウント>.workers.dev"
//   動作確認用に、URLの末尾に ?proxy=https://... を付けて上書きすることもできます。
const params = new URLSearchParams(location.search);

export const CONFIG = {
  PROXY_URL: params.get("proxy") || "",
  OVERPASS: [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ],
  // 地図に描く参考の円(m)。市のルールに距離の基準があれば、その値に置き換わる
  REF_RADIUS_M: 300,
  // 住宅系として数える OpenStreetMap の building タグ
  RESIDENTIAL: ["house", "residential", "detached", "semidetached_house", "terrace", "apartments", "dormitory", "bungalow"],
  // 農地として数える OpenStreetMap の landuse タグ
  FARMLAND: ["farmland", "farm", "orchard", "vineyard", "meadow", "greenhouse_horticulture", "plant_nursery", "paddy"]
};
