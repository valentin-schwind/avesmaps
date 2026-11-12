import { writeFileSync } from "node:fs";
import { AVENTURIA_CARTOGRAPHY, DESIGN_CANON } from "@avesmaps3d/shared";

/**
 * Die Ansicht des Sichtbarkeitsgraphen (WI-0046, Betreiber 2026-09-27: „darf ich mal sehen wie das
 * aussieht?“): eine eigenständige Seite mit Canvas, zoom- und verschiebbar. Ebenen für Küstenecken,
 * Sichtkanten, A*-Brücken und Häfen, dazu Beispielreisen je Schiffstyp mit ihrem bevorzugten
 * Küstenabstand (S7), geglättet mit Catmull-Rom; A* zum Vergleich.
 * Nur ein Werkzeug für die Messung, kein Teil der Anwendung.
 */

type Point = [number, number];

export interface GraphView {
    shapes: { region_type: string; svg: string }[];
    nodes: { x: number; y: number; port: boolean }[];
    edges: { a: number; b: number; via: Point[] | null }[];
    examples: {
        label: string;
        astar: Point[];
        routes: { label: string; colour: string; points: Point[]; units: number; hours: number; maxCoast: number }[];
    }[];
    stats: string;
}

/** Karteneinheiten auf 1/60 genau als 16-Bit-Zahl: 1024 E passen, und die Seite bleibt klein. */
const SCALE = 60;

function packCoordinates(points: readonly Point[]): string {
    const array = new Uint16Array(points.length * 2);
    points.forEach(([x, y], index) => {
        array[index * 2] = Math.round(Math.max(0, x) * SCALE);
        array[index * 2 + 1] = Math.round(Math.max(0, y) * SCALE);
    });
    return Buffer.from(array.buffer).toString("base64");
}

const packInts = (values: readonly number[], Type: Uint16ArrayConstructor | Uint32ArrayConstructor): string =>
    Buffer.from(Type.from(values).buffer).toString("base64");

function fill(type: string): string {
    const value = AVENTURIA_CARTOGRAPHY.types[type]?.fill;
    if (value === undefined) throw new Error(`Kartografie ohne Ton für ${type}`);
    return value;
}

function tokens(colours: Record<string, string>): string {
    const pick = (name: string): string => colours[name] ?? (DESIGN_CANON.colour[name] as string);
    return [
        `--ground: ${pick("pageBg")};`,
        `--panel: ${pick("panel")};`,
        `--ink: ${pick("text")};`,
        `--strong: ${pick("textStrong")};`,
        `--muted: ${pick("textMuted")};`,
        `--border: ${pick("border")};`,
        `--accent: ${pick("accentStrong")};`,
        `--wash: ${pick("hoverWash")};`,
        `--danger: ${pick("danger")};`,
        `--focus: ${pick("focus")};`,
    ].join(" ");
}

export function writeGraphView(file: string, view: GraphView): void {
    const sight = view.edges.filter((edge) => edge.via === null);
    const bridges = view.edges.filter((edge) => edge.via !== null);
    const bridgeOffsets: number[] = [0];
    const bridgePoints: Point[] = [];
    for (const edge of bridges) {
        bridgePoints.push(...(edge.via as Point[]));
        bridgeOffsets.push(bridgePoints.length);
    }
    const data = {
        scale: SCALE,
        nodes: packCoordinates(view.nodes.map((node) => [node.x, node.y])),
        ports: packInts(
            view.nodes.flatMap((node, index) => (node.port ? [index] : [])),
            Uint16Array,
        ),
        sight: packInts(
            sight.flatMap((edge) => [edge.a, edge.b]),
            Uint16Array,
        ),
        bridgePoints: packCoordinates(bridgePoints),
        bridgeOffsets: packInts(bridgeOffsets, Uint32Array),
        land: view.shapes
            .filter((shape) => shape.region_type === "kontinent" || shape.region_type === "insel")
            .map((shape) => shape.svg),
        water: view.shapes
            .filter((shape) => shape.region_type === "meer" || shape.region_type === "see")
            .map((shape) => shape.svg),
        examples: view.examples,
        colours: {
            land: DESIGN_CANON.colour["mapPaper"] as string,
            sea: fill("meer"),
            lake: fill("see"),
            route: DESIGN_CANON.colour["route"] as string,
        },
    };
    const exampleButtons = view.examples
        .map(
            (example, index) =>
                `<button type="button" class="example" data-example="${String(index)}">${example.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}${example.routes
                    .map(
                        (route) =>
                            `<span><i class="swatch" style="background:${route.colour}"></i>${route.label}: ${route.units.toFixed(0)} E, ${route.hours.toFixed(0)} h, bis ${route.maxCoast.toFixed(1)} E vor der Küste</span>`,
                    )
                    .join("")}</button>`,
        )
        .join("");
    const page = `<title>Sichtbarkeitsgraph</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Faculty+Glyphic&display=swap">
<style>
:root { ${tokens(DESIGN_CANON.colour)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${tokens(DESIGN_CANON.colourDark ?? {})} color-scheme: dark; } }
:root[data-theme="dark"] { ${tokens(DESIGN_CANON.colourDark ?? {})} color-scheme: dark; }
body { background: var(--ground); color: var(--ink); font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; padding-inline: 16px; padding-block: 16px 40px; }
main { max-width: 1180px; margin: 0 auto; display: grid; gap: 14px; }
h1 { font-size: 22px; margin: 0; color: var(--strong); }
p { margin: 0; max-width: 78ch; }
.lead { color: var(--muted); }
.controls { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
.controls label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
.swatch { width: 14px; height: 4px; border-radius: 2px; display: inline-block; }
button { font: inherit; color: var(--ink); background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; cursor: pointer; transition: background-color 120ms; }
button:hover { background: var(--wash); }
button[aria-pressed="true"] { border-color: var(--accent); background: var(--wash); }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 14px; align-items: start; }
@media (max-width: 820px) { .layout { grid-template-columns: 1fr; } }
.frame { position: relative; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--panel); aspect-ratio: 1; max-width: 100%; max-height: 82vh; touch-action: none; }
canvas { width: 100%; height: 100%; display: block; cursor: grab; }
.examples { display: grid; gap: 6px; }
.examples h2 { font-size: 14px; margin: 0; color: var(--muted); font-weight: 400; }
.example { text-align: left; display: grid; gap: 2px; }
.example span { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; display: flex; gap: 6px; align-items: center; }
.info { color: var(--strong); min-height: 1.45em; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
<main>
<header><h1>Sichtbarkeitsgraph mit A*-Brücken</h1>
<p class="lead">Wie ein Schiff frei übers Meer seinen Weg findet: Knoten sind die Ecken der Küste, an denen Land ins Wasser ragt. Wo zwei Ecken sich sehen, verbindet sie eine gerade Kante. Wo sie nah beieinander liegen, sich aber nicht sehen – in Sunden und Fjorden –, verbindet sie eine A*-Brücke. Eine Reise ist der günstigste Weg durch dieses Netz: Jedes Schiff zahlt für zu wenig und zu viel Abstand zur Küste (vorläufige Werte), die Galeere bleibt nah am Land, der Schnellsegler geht über die offene See. Das Stück vom Hafen zur Anlegestelle gehört zur Seefahrt. Die Linie ist mit Catmull-Rom geglättet. ${view.stats}</p></header>
<div class="controls">
<label><input type="checkbox" id="l-sight" data-layer="sight" checked><i class="swatch" style="background:var(--muted)"></i>Sichtkanten</label>
<label><input type="checkbox" id="l-bridges" data-layer="bridges" checked><i class="swatch" style="background:var(--accent)"></i>A*-Brücken</label>
<label><input type="checkbox" id="l-corners" data-layer="corners" checked>Küstenecken</label>
<label><input type="checkbox" id="l-ports" data-layer="ports" checked><i class="swatch" style="background:var(--danger)"></i>Häfen</label>
<label><input type="checkbox" id="l-routes" data-layer="routes" checked>Reisen je Schiff, geglättet</label>
<label><input type="checkbox" id="l-astar" data-layer="astar">A* zum Vergleich (gestrichelt)</label>
<button type="button" id="reset">Ganze Karte</button>
</div>
<div class="layout">
<div class="frame"><canvas id="map" aria-label="Karte des Sichtbarkeitsgraphen"></canvas></div>
<aside class="examples"><h2>Beispielreisen je Schiff: Länge, Stunden, größter Küstenabstand</h2>${exampleButtons}</aside>
</div>
<p class="info" id="info">Mausrad oder zwei Finger zoomen, Ziehen verschiebt. Eine Beispielreise antippen zoomt dorthin. Hineinzoomen zeigt die Kanten einzeln.</p>
</main>
<script>
const DATA = ${JSON.stringify(data)};
(() => {
  const decode = (b64, Type) => { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new Type(bytes.buffer); };
  const S = DATA.scale;
  const nodes = decode(DATA.nodes, Uint16Array);
  const ports = decode(DATA.ports, Uint16Array);
  const sight = decode(DATA.sight, Uint16Array);
  const bridgePoints = decode(DATA.bridgePoints, Uint16Array);
  const bridgeOffsets = decode(DATA.bridgeOffsets, Uint32Array);
  const land = DATA.land.map((d) => new Path2D(d));
  const water = DATA.water.map((d) => new Path2D(d));
  const isPort = new Uint8Array(nodes.length / 2); for (const p of ports) isPort[p] = 1;
  const canvas = document.getElementById("map");
  const ctx = canvas.getContext("2d");
  const full = { x: 0, y: 1024, w: 1024 };
  let view = { ...full };
  let active = -1;
  const on = (name) => document.querySelector('[data-layer="' + name + '"]').checked;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let queued = false;
  const draw = () => {
    queued = false;
    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth * dpr;
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    const k = size / view.w;
    const px = 1 / k * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = css("--panel");
    ctx.fillRect(0, 0, size, size);
    // Welt → Bild: x' = k(x - vx), y' = k(vy - y). Die Flächen tragen schon -y (ST_AsSVG).
    ctx.setTransform(k, 0, 0, k, -k * view.x, k * view.y);
    ctx.fillStyle = DATA.colours.land; for (const p of land) ctx.fill(p);
    ctx.fillStyle = DATA.colours.sea; for (const p of water) ctx.fill(p);
    const X = (i) => nodes[i * 2] / S;
    const Y = (i) => -nodes[i * 2 + 1] / S;
    if (on("sight")) {
      ctx.strokeStyle = css("--muted"); ctx.globalAlpha = view.w > 300 ? 0.05 : view.w > 60 ? 0.1 : view.w > 15 ? 0.25 : 0.45; ctx.lineWidth = 0.6 * px;
      ctx.beginPath();
      for (let e = 0; e < sight.length; e += 2) { ctx.moveTo(X(sight[e]), Y(sight[e])); ctx.lineTo(X(sight[e + 1]), Y(sight[e + 1])); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (on("bridges")) {
      ctx.strokeStyle = css("--accent"); ctx.globalAlpha = 0.7; ctx.lineWidth = 0.9 * px;
      ctx.beginPath();
      for (let b = 0; b + 1 < bridgeOffsets.length; b++) {
        const from = bridgeOffsets[b], to = bridgeOffsets[b + 1];
        for (let p = from; p < to; p++) { const x = bridgePoints[p * 2] / S, y = -bridgePoints[p * 2 + 1] / S; if (p === from) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    const dot = (i, r, colour) => { ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(X(i), Y(i), r * px, 0, 6.2832); ctx.fill(); };
    if (on("corners")) { const c = css("--ink"); for (let i = 0; i < isPort.length; i++) if (!isPort[i]) dot(i, 1.4, c); }
    if (on("ports")) { const c = css("--danger"); for (let i = 0; i < isPort.length; i++) if (isPort[i]) dot(i, 2.6, c); }
    if (on("routes")) {
      // Mit einer gewählten Reise nur diese.
      DATA.examples.forEach((ex, index) => {
        if (active >= 0 && index !== active) return;
        const line = (points, dash, colour, width) => {
          if (points.length < 2) return;
          ctx.strokeStyle = colour; ctx.lineWidth = width * px; ctx.setLineDash(dash.map((d) => d * px));
          ctx.beginPath(); points.forEach(([x, y], i) => (i ? ctx.lineTo(x, -y) : ctx.moveTo(x, -y))); ctx.stroke(); ctx.setLineDash([]);
        };
        const strong = index === active;
        if (on("astar")) line(ex.astar, [5, 4], css("--muted"), 1.2);
        for (const route of ex.routes) line(route.points, [], route.colour, strong ? 2.6 : 1.8);
      });
    }
  };
  const redraw = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
  const toWorld = (cx, cy) => { const r = canvas.getBoundingClientRect(); return [view.x + (cx - r.left) / r.width * view.w, view.y - (cy - r.top) / r.height * view.w]; };
  const zoom = (f, wx, wy) => { const w = Math.min(full.w, Math.max(2, view.w * f)); const s = w / view.w; view = { x: wx - (wx - view.x) * s, y: wy - (wy - view.y) * s, w }; redraw(); };
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); const [x, y] = toWorld(e.clientX, e.clientY); zoom(Math.exp(e.deltaY * 0.0015), x, y); }, { passive: false });
  const pointers = new Map();
  canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); });
  canvas.addEventListener("pointermove", (e) => {
    const last = pointers.get(e.pointerId); if (!last) return;
    const r = canvas.getBoundingClientRect();
    if (pointers.size === 1) { view = { ...view, x: view.x - (e.clientX - last[0]) / r.width * view.w, y: view.y + (e.clientY - last[1]) / r.height * view.w }; redraw(); }
    else if (pointers.size === 2) {
      const [other] = [...pointers.entries()].filter(([id]) => id !== e.pointerId).map(([, p]) => p);
      const before = Math.hypot(last[0] - other[0], last[1] - other[1]); const after = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
      const [x, y] = toWorld((e.clientX + other[0]) / 2, (e.clientY + other[1]) / 2);
      if (before > 0 && after > 0) zoom(before / after, x, y);
    }
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
  });
  const release = (e) => pointers.delete(e.pointerId);
  canvas.addEventListener("pointerup", release); canvas.addEventListener("pointercancel", release);
  document.getElementById("reset").addEventListener("click", () => { view = { ...full }; active = -1; for (const b of document.querySelectorAll(".example")) b.setAttribute("aria-pressed", "false"); redraw(); });
  for (const box of document.querySelectorAll("[data-layer]")) box.addEventListener("change", redraw);
  for (const button of document.querySelectorAll(".example")) {
    button.addEventListener("click", () => {
      active = Number(button.dataset.example);
      for (const b of document.querySelectorAll(".example")) b.setAttribute("aria-pressed", String(b === button));
      const ex = DATA.examples[active];
      const all = ex.routes.flatMap((r) => r.points);
      const xs = all.map((p) => p[0]); const ys = all.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const w = Math.min(full.w, Math.max(maxX - minX, maxY - minY) * 1.25 + 4);
      view = { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 + w / 2, w };
      document.getElementById("info").textContent = ex.label + ": " + ex.routes.map((r) => r.label + " " + r.units.toFixed(0) + " E in " + r.hours.toFixed(0) + " h").join(" · ") + " (1 E = 3 Meilen).";
      redraw();
    });
  }
  new ResizeObserver(redraw).observe(canvas);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  redraw();
})();
</script>
`;
    writeFileSync(file, page);
}
