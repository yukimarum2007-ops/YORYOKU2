// Cloudflare Worker:国土交通省「不動産情報ライブラリ」APIの中継。
// APIキーはここ(サーバー側の秘密情報)にだけ置き、ブラウザには出しません。
// 設定:  wrangler secret put REINFOLIB_KEY
//        wrangler.toml の [vars] に ALLOWED_ORIGINS = "https://<あなた>.github.io"
const LAYERS = new Set(["XKT001", "XKT002"]);

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? origin : "null",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return new Response("method not allowed", { status: 405, headers: cors });
    if (!okOrigin) return new Response("origin not allowed", { status: 403, headers: cors });

    const url = new URL(request.url);
    const layer = url.pathname.replace(/^\//, "");
    const z = Number(url.searchParams.get("z")), x = Number(url.searchParams.get("x")), y = Number(url.searchParams.get("y"));
    if (!LAYERS.has(layer) || !Number.isInteger(z) || z < 11 || z > 15 || !Number.isInteger(x) || !Number.isInteger(y)) {
      return new Response("bad request", { status: 400, headers: cors });
    }
    const api = `https://www.reinfolib.mlit.go.jp/ex-api/external/${layer}?response_format=geojson&z=${z}&x=${x}&y=${y}`;
    const r = await fetch(api, {
      headers: { "Ocp-Apim-Subscription-Key": env.REINFOLIB_KEY },
      cf: { cacheTtl: 86400, cacheEverything: true }
    });
    return new Response(r.body, {
      status: r.status,
      headers: { ...cors, "Content-Type": r.headers.get("Content-Type") || "application/json", "Cache-Control": "public, max-age=86400" }
    });
  }
};
