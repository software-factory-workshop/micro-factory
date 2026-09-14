// Local proxy so `eve eval --url http://127.0.0.1:4299` can reach the Passport-protected
// factory deployment: injects the Vercel protection bypass and the project OIDC bearer,
// rewrites /eve/v1/info so the agent name matches this package, and keeps long session
// streams alive by reconnecting with startIndex when the upstream closes early. Dev only.
import http from "node:http";
import https from "node:https";

const upstream = new URL(process.env.FACTORY_UPSTREAM || "https://adeo-micro-factory.vercel.app");
const bypass = process.env.VERCEL_PROTECTION_BYPASS;
const oidc = process.env.VERCEL_OIDC_TOKEN;
const agentName = process.env.EVAL_AGENT_NAME || "@micro-factory/factory";
if (!bypass || !oidc) { console.error("missing VERCEL_PROTECTION_BYPASS or VERCEL_OIDC_TOKEN"); process.exit(1); }
const TERMINAL = new Set(["session.completed", "session.failed", "session.waiting"]);
const log = (...a) => console.log(new Date().toISOString(), ...a);

function authHeaders(extra = {}) {
  return { host: upstream.host, "accept-encoding": "identity", "x-vercel-protection-bypass": bypass, authorization: `Bearer ${oidc}`, "x-vercel-trusted-oidc-idp-token": oidc, ...extra };
}
function request(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const out = https.request({ host: upstream.host, port: 443, method, path, headers }, resolve);
    out.on("error", reject);
    if (body) out.write(body);
    out.end();
  });
}
function readBody(req) { return new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); }); }
function safeHead(res, status, headers) { if (!res.headersSent) res.writeHead(status, headers); }

async function proxyInfo(res) {
  const up = await request("GET", "/eve/v1/info", authHeaders({ accept: "application/json" }));
  const text = (await readBody(up)).toString("utf8");
  let body = text;
  try { const j = JSON.parse(text); if (j.agent) j.agent.name = agentName; body = JSON.stringify(j); } catch {}
  safeHead(res, up.statusCode || 502, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

// Session stream: forward NDJSON lines, reconnect with startIndex until a terminal event
// or the client goes away. Vercel closes idle function streams well before a gate finishes.
async function proxyStream(req, res) {
  const url = new URL(req.url, "http://x");
  let index = Number(url.searchParams.get("startIndex") || 0);
  let terminal = false, closed = false, attempts = 0;
  req.on("close", () => { closed = true; });
  let headSent = false;
  while (!terminal && !closed) {
    url.searchParams.set("startIndex", String(index));
    let up;
    try { up = await request("GET", url.pathname + url.search, authHeaders({ accept: "application/x-ndjson" })); }
    catch (e) { log("stream connect error", String(e)); await new Promise((r) => setTimeout(r, 1500)); if (++attempts > 200) break; continue; }
    if (up.statusCode !== 200) {
      const t = (await readBody(up)).toString("utf8"); log("stream upstream", up.statusCode, t.slice(0, 200));
      if (!headSent) { safeHead(res, up.statusCode || 502, { "content-type": up.headers["content-type"] || "application/json" }); res.end(t); return; }
      res.write(JSON.stringify({ type: "proxy.error", status: up.statusCode }) + "\n"); break;
    }
    if (!headSent) {
      // Forward Eve's own stream headers (x-eve-stream-version, tail index) from the first upstream hop.
      const eveHeaders = Object.fromEntries(Object.entries(up.headers).filter(([k]) => k.startsWith("x-eve-")));
      safeHead(res, 200, { ...eveHeaders, "content-type": up.headers["content-type"] || "application/x-ndjson", "cache-control": "no-store" });
      headSent = true;
    }
    attempts = 0;
    let pending = "";
    await new Promise((resolve) => {
      up.on("data", (chunk) => {
        pending += chunk.toString("utf8");
        const lines = pending.split("\n"); pending = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          index += 1; res.write(line + "\n");
          try { const ev = JSON.parse(line); if (TERMINAL.has(ev.type)) terminal = true; } catch {}
        }
      });
      up.on("end", resolve); up.on("error", (e) => { log("stream error", String(e)); resolve(); });
    });
    if (!terminal && !closed) { log(`stream ended at index ${index}, reconnecting`); await new Promise((r) => setTimeout(r, 1000)); }
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/eve/v1/info") return await proxyInfo(res);
    if (req.method === "GET" && /\/eve\/v1\/session\/[^/]+\/stream/.test(req.url) && !req.url.includes("includeTailIndex")) return await proxyStream(req, res);
    const body = await readBody(req);
    const headers = authHeaders({ ...req.headers, host: upstream.host, "accept-encoding": "identity", "content-length": String(body.length) });
    const up = await request(req.method, req.url, headers, body.length ? body : undefined);
    safeHead(res, up.statusCode || 502, up.headers);
    up.pipe(res);
  } catch (e) {
    log("proxy error", String(e));
    safeHead(res, 502, { "content-type": "text/plain" }); res.end(String(e));
  }
});
server.on("clientError", (e, socket) => socket.destroy());
server.listen(Number(process.env.PORT || 4299), "127.0.0.1", () => log(`proxy -> ${upstream.origin} on ${process.env.PORT || 4299}`));
