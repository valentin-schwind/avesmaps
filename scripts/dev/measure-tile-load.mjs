/**
 * Misst im Browser, wie schnell eine Rasterpyramide je Format lädt (WI-0006, Teil 2).
 *
 * Vorher: `py -3 scripts/dev/measure-tile-formats.py --series <serie>` legt die Varianten an.
 * Aufruf:  node scripts/dev/measure-tile-load.mjs [--series original] [--runs 3]
 *
 * ⭐ EINE EIGENE MESSSEITE, nicht die Anwendung: nur die Rasterquelle, keine Vektorkacheln, keine
 * Beschriftung. Sonst mäße die Zeit bis „fertig" auch Martin und die Kollision mit.
 *
 * 🪤 HTTP/2 ÜBER TLS, wie Nginx ausliefert. Unter HTTP/1.1 teilen sich sechs Verbindungen je Host
 * alle Anfragen, und die vierfache Kachelzahl der 256er-Variante würde künstlich bestraft. Der
 * Vergleich HTTP/1.1 läuft zusätzlich mit — als Warnung, falls ein Server HTTP/2 nicht spricht.
 *
 * 🪤 Jeder Lauf in einem FRISCHEN Browserkontext (leerer Cache) und mit `raster-fade-duration: 0`
 * — sonst mäße die Messung die Einblendanimation mit. Kein Hintergrundtab: Playwright zeichnet im
 * Headless-Fenster mit echten Frames.
 *
 * Ergebnis: review/tile-formats/<serie>-load.json und -load.md (review/ ist nicht versioniert).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createSecureServer } from "node:http2";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { URLSearchParams } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { AVENTURIA, toRenderLngLat } from "@avesmaps3d/shared";

const { values } = parseArgs({
    options: {
        series: { type: "string", default: "original" },
        runs: { type: "string", default: "3" },
    },
});
const SERIES = values.series;
const RUNS = Number(values.runs);
const DATA_ROOT = "C:\\avesmaps3d-data";
const REPO = resolve(import.meta.dirname, "..", "..");
const DIST = join(REPO, "node_modules", "maplibre-gl", "dist");

/** Die Varianten: Pfad, Endung, Kachelgröße und die höchste Stufe, die es als Datei gibt. */
const VARIANTS = [
    {
        id: "png512",
        ext: "png",
        tileSize: 512,
        maxzoom: 6,
        root: join(DATA_ROOT, "work", "aventuria", SERIES, "pyramid-png"),
    },
    {
        id: "webp512-q80",
        ext: "webp",
        tileSize: 512,
        maxzoom: 6,
        root: join(DATA_ROOT, "work", "tile-formats", SERIES, "webp512-q80"),
    },
    {
        id: "webp512-ll",
        ext: "webp",
        tileSize: 512,
        maxzoom: 6,
        root: join(DATA_ROOT, "work", "tile-formats", SERIES, "webp512-ll"),
    },
    {
        id: "webp256-q80",
        ext: "webp",
        tileSize: 256,
        maxzoom: 7,
        root: join(DATA_ROOT, "work", "tile-formats", SERIES, "webp256-q80"),
    },
];

/** Drei Ausschnitte: Überblick, mittlere Stufe über Gareth, nah (über der nativen Stufe). */
const VIEWS = [
    { id: "ueberblick-z3", x: 512, y: 512, zoom: 3 },
    { id: "gareth-z5", x: 551.6, y: 533, zoom: 5 },
    { id: "gareth-z7", x: 551.6, y: 533, zoom: 7 },
];

/** Zwei Netze: ungebremst (nur der Rechner) und eine gewöhnliche Leitung, 20/5 Mbit/s, 40 ms. */
const NETWORKS = [
    { id: "lokal", conditions: null },
    {
        id: "20mbit",
        conditions: { offline: false, latency: 40, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8 },
    },
];

const TYPES = {
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".webp": "image/webp",
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/maplibre/maplibre-gl.css">
<style>html,body,#map{margin:0;width:100%;height:100%}</style></head><body><div id="map"></div>
<script type="module">
import * as maplibregl from "/maplibre/maplibre-gl.mjs";
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
const q = new URLSearchParams(location.search);
const t0 = performance.now();
const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: { r: { type: "raster", tiles: [q.get("tiles")], tileSize: Number(q.get("ts")), maxzoom: Number(q.get("mz")) } },
           layers: [{ id: "r", type: "raster", source: "r", paint: { "raster-fade-duration": 0 } }] },
  center: [Number(q.get("lng")), Number(q.get("lat"))], zoom: Number(q.get("z")), renderWorldCopies: false, fadeDuration: 0,
});
map.once("idle", async () => {
  const fertig = performance.now() - t0;
  const kacheln = performance.getEntriesByType("resource").filter((e) => e.name.includes("/t/"));
  const bytes = kacheln.reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), 0);
  // Dekodierzeit: dieselben Kacheln noch einmal holen und nur das Dekodieren messen.
  let decode = 0, n = 0;
  for (const e of kacheln.slice(0, 16)) {
    const blob = await (await fetch(e.name, { cache: "no-store" })).blob();
    const t = performance.now(); const bild = await createImageBitmap(blob); decode += performance.now() - t; bild.close(); n += 1;
  }
  window.__ergebnis = { fertigMs: fertig, kacheln: kacheln.length, bytes, decodeMs: n ? decode / n : 0 };
});
</script></body></html>`;

async function handle(request, response) {
    const url = new URL(request.url, "https://localhost");
    const send = (status, body, type) => {
        response.writeHead(status, { "content-type": type ?? "text/plain", "cache-control": "no-store" });
        response.end(body);
    };
    try {
        if (url.pathname === "/") return send(200, PAGE, "text/html; charset=utf-8");
        if (url.pathname.startsWith("/maplibre/")) {
            const datei = url.pathname.slice("/maplibre/".length);
            return send(200, await readFile(join(DIST, datei)), TYPES[datei.slice(datei.lastIndexOf("."))]);
        }
        const m = /^\/t\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.(png|webp)$/.exec(url.pathname);
        if (m) {
            const variante = VARIANTS.find((v) => v.id === m[1]);
            if (!variante) return send(404, "unbekannte Variante");
            return send(200, await readFile(join(variante.root, m[2], m[3], `${m[4]}.${m[5]}`)), TYPES[`.${m[5]}`]);
        }
        return send(404, "nicht gefunden");
    } catch {
        return send(404, "fehlt");
    }
}

function selfSignedCertificate() {
    const dir = join(tmpdir(), "avesmaps3d-tile-load");
    mkdirSync(dir, { recursive: true });
    const key = join(dir, "key.pem");
    const cert = join(dir, "cert.pem");
    execFileSync(
        "openssl",
        [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            key,
            "-out",
            cert,
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
        ],
        { stdio: "ignore" },
    );
    return { key: readFileSync(key), cert: readFileSync(cert) };
}

const h2 = createSecureServer({ ...selfSignedCertificate(), allowHTTP1: false }, handle).listen(4190);
const h1 = createServer(handle).listen(4191);
const PROTOKOLLE = [
    { id: "h2", base: "https://localhost:4190" },
    { id: "h1", base: "http://localhost:4191" },
];

const median = (werte) => [...werte].sort((a, b) => a - b)[Math.floor(werte.length / 2)];
const browser = await chromium.launch();
const ergebnisse = [];
for (const protokoll of PROTOKOLLE) {
    for (const netz of NETWORKS) {
        // HTTP/1.1 nur im gedrosselten Netz — dort zeigt sich der Unterschied, lokal ist er Rauschen.
        if (protokoll.id === "h1" && netz.conditions === null) continue;
        for (const view of VIEWS) {
            const { lng, lat } = toRenderLngLat(AVENTURIA.coordinateSpace, { x: view.x, y: view.y });
            for (const variante of VARIANTS) {
                const laeufe = [];
                for (let lauf = 0; lauf < RUNS; lauf += 1) {
                    const context = await browser.newContext({
                        viewport: { width: 1280, height: 800 },
                        ignoreHTTPSErrors: true,
                    });
                    const page = await context.newPage();
                    if (netz.conditions) {
                        const cdp = await context.newCDPSession(page);
                        await cdp.send("Network.enable");
                        await cdp.send("Network.emulateNetworkConditions", netz.conditions);
                    }
                    const tiles = `${protokoll.base}/t/${variante.id}/{z}/{x}/{y}.${variante.ext}`;
                    const q = new URLSearchParams({
                        tiles,
                        ts: String(variante.tileSize),
                        mz: String(variante.maxzoom),
                        lng: String(lng),
                        lat: String(lat),
                        z: String(view.zoom),
                    });
                    await page.goto(`${protokoll.base}/?${q.toString()}`);
                    await page.waitForFunction(() => globalThis.__ergebnis !== undefined, undefined, {
                        timeout: 120000,
                    });
                    laeufe.push(await page.evaluate(() => globalThis.__ergebnis));
                    await context.close();
                }
                const zeile = {
                    protokoll: protokoll.id,
                    netz: netz.id,
                    view: view.id,
                    variante: variante.id,
                    fertigMs: Math.round(median(laeufe.map((l) => l.fertigMs))),
                    kacheln: laeufe[0].kacheln,
                    kb: Math.round(median(laeufe.map((l) => l.bytes)) / 1024),
                    decodeMs: Number(median(laeufe.map((l) => l.decodeMs)).toFixed(2)),
                };
                ergebnisse.push(zeile);
                console.log(JSON.stringify(zeile));
            }
        }
    }
}
await browser.close();
h2.close();
h1.close();

const ziel = join(REPO, "review", "tile-formats");
mkdirSync(ziel, { recursive: true });
writeFileSync(join(ziel, `${SERIES}-load.json`), JSON.stringify(ergebnisse, null, 2));
const kopf =
    "| Protokoll | Netz | Ausschnitt | Variante | fertig (ms) | Kacheln | KB | Dekodieren je Kachel (ms) |\n|---|---|---|---|---|---|---|---|\n";
writeFileSync(
    join(ziel, `${SERIES}-load.md`),
    `# Ladezeit je Format — Serie ${SERIES}\n\nMedian aus ${RUNS} Läufen, frischer Cache, 1280×800.\n\n${kopf}${ergebnisse
        .map(
            (e) =>
                `| ${e.protokoll} | ${e.netz} | ${e.view} | ${e.variante} | ${e.fertigMs} | ${e.kacheln} | ${e.kb} | ${e.decodeMs} |`,
        )
        .join("\n")}\n`,
);
console.log(`geschrieben: ${ziel}`);
