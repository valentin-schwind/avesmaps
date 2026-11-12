/**
 * Parität der Gebirgsrechnung V12 (WI-0049 S3): Legacys Modul gegen die Übertragung in
 * `packages/shared/src/gebirge` (seit WI-0226 gemeinsamer Code), je Gebirgsfläche mit derselben Eingabe, Zelle für Zelle.
 *
 * Aufruf (aus der Wurzel des Repositoriums):
 *   node scripts/dev/terrain-oracle/compare-v12.mjs [--only Name1,Name2] [--limit N]
 *        [--pfad flach|mittelachse|kurve|spannbaum|gipfel+kurve|ein-gipfel] [--sort klein|gross]
 *        [--shard k/n] [--out ergebnis.jsonl] [--snapshot <verzeichnis>]
 *
 * Verglichen werden `h` (Float64, bitweise), die gespeicherten uint16-Werte, das Raster (Weite,
 * Höhe, Zelle, Maske) und `leer`. Die Zeiten laufen im selben Prozess nacheinander, erst Orakel,
 * dann Port. Rückgabewert 1, sobald ein Gebirge abweicht.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { buildMountainRaster, rasterSamples } from "@avesmaps3d/shared";
import { legacySamples, loadLegacyV12, snapshotMountains } from "./legacy-v12.mjs";

const { values } = parseArgs({
    options: {
        only: { type: "string" },
        limit: { type: "string" },
        pfad: { type: "string" },
        sort: { type: "string" },
        shard: { type: "string" },
        out: { type: "string" },
        snapshot: { type: "string", default: "C:/avesmaps3d-data/legacy-snapshots/2026-09-26" },
    },
});

/** Welchen Zweig des Trichters die Eingabe nimmt, grob nach Gipfeln, Kurve und Maximalhöhe. */
function pfadOf(input) {
    const gipfel = input.peaks.length;
    const kurve = Array.isArray(input.kurve) && input.kurve.length >= 2;
    const mh = Number(input.regler.maximalhoehe) > 0;
    if (!gipfel && !mh) return "flach";
    if (!gipfel) return kurve ? "kurve" : "mittelachse";
    if (kurve) return "gipfel+kurve";
    return gipfel >= 2 ? "spannbaum" : "ein-gipfel";
}

function vergleiche(o, port) {
    const befund = {
        form: true,
        maske: true,
        leerGleich: o.leer === port.leer,
        hZellen: 0,
        hMax: 0,
        sZellen: 0,
        sMax: 0,
    };
    if (o.r.w !== port.w || o.r.hh !== port.hh || o.r.cell !== port.cell) {
        befund.form = false;
        return befund;
    }
    for (let k = 0; k < port.eigen.length; k++) {
        if ((o.r.eigen[k] ? 1 : 0) !== (port.eigen[k] ? 1 : 0)) befund.maske = false;
    }
    // Bitweise: auch -0 gegen +0 und NaN zählen als Abweichung.
    const a = new BigUint64Array(o.h.buffer, o.h.byteOffset, o.h.length);
    const b = new BigUint64Array(port.h.buffer, port.h.byteOffset, port.h.length);
    for (let k = 0; k < a.length; k++) {
        if (a[k] !== b[k]) {
            befund.hZellen++;
            const d = Math.abs(o.h[k] - port.h[k]);
            if (!(d <= befund.hMax)) befund.hMax = d;
        }
    }
    const sa = legacySamples(o);
    const sb = rasterSamples(port);
    for (let k = 0; k < sa.length; k++) {
        if (sa[k] !== sb[k]) {
            befund.sZellen++;
            befund.sMax = Math.max(befund.sMax, Math.abs(sa[k] - sb[k]));
        }
    }
    return befund;
}

const legacy = loadLegacyV12();
let gebirge = snapshotMountains(values.snapshot, legacy.pointInGeometry);
const zellenOf = (area) =>
    (Math.round((area.bounds.max_x - area.bounds.min_x) / 0.25) + 1) *
    (Math.round((area.bounds.max_y - area.bounds.min_y) / 0.25) + 1);
if (values.only) {
    const namen = new Set(values.only.split(",").map((n) => n.trim()));
    gebirge = gebirge.filter((g) => namen.has(g.area.region_name) || namen.has(g.area.public_id));
}
if (values.pfad) gebirge = gebirge.filter((g) => pfadOf(g.inputFor()) === values.pfad);
if (values.sort === "klein") gebirge.sort((x, y) => zellenOf(x.area) - zellenOf(y.area));
if (values.sort === "gross") gebirge.sort((x, y) => zellenOf(y.area) - zellenOf(x.area));
if (values.shard) {
    const [k, n] = values.shard.split("/").map(Number);
    gebirge = gebirge.filter((_, index) => index % n === k);
}
if (values.limit) gebirge = gebirge.slice(0, Number(values.limit));
if (values.out) writeFileSync(values.out, "");

let gleich = 0;
let orakelMs = 0;
let portMs = 0;
for (const [index, { area, inputFor }] of gebirge.entries()) {
    const input = inputFor();
    const t0 = performance.now();
    const o = legacy.build(inputFor());
    const t1 = performance.now();
    const port = buildMountainRaster(input);
    const t2 = performance.now();
    const befund = vergleiche(o, port);
    const identisch = befund.form && befund.maske && befund.leerGleich && befund.hZellen === 0 && befund.sZellen === 0;
    if (identisch) gleich++;
    orakelMs += t1 - t0;
    portMs += t2 - t1;
    const zeile = {
        name: area.region_name,
        public_id: area.public_id,
        pfad: pfadOf(input),
        gipfel: input.peaks.length,
        fluesse: input.fluesse.length,
        seen: input.seen.length,
        w: port.w,
        hh: port.hh,
        drin: port.eigen.reduce((n, v) => n + v, 0),
        leer: port.leer,
        identisch,
        ...befund,
        orakel_ms: Math.round(t1 - t0),
        port_ms: Math.round(t2 - t1),
    };
    const abweichung = identisch
        ? "identisch"
        : `ABWEICHUNG form=${befund.form} maske=${befund.maske} leer=${befund.leerGleich} ` +
          `h: ${befund.hZellen} Zellen (max ${befund.hMax}), uint16: ${befund.sZellen} Zellen (max ${befund.sMax})`;
    console.log(
        `[${index + 1}/${gebirge.length}] ${zeile.name} (${zeile.pfad}, ${zeile.gipfel} Gipfel, ` +
            `${zeile.fluesse} Flüsse, ${zeile.seen} Seen, ${zeile.w}×${zeile.hh}): ${abweichung} · ` +
            `Orakel ${(zeile.orakel_ms / 1000).toFixed(1)} s · Port ${(zeile.port_ms / 1000).toFixed(1)} s`,
    );
    if (values.out) appendFileSync(values.out, JSON.stringify(zeile) + "\n");
}
console.log(
    `${gleich} von ${gebirge.length} identisch · Orakel ${(orakelMs / 1000).toFixed(1)} s · ` +
        `Port ${(portMs / 1000).toFixed(1)} s`,
);
process.exitCode = gleich === gebirge.length ? 0 : 1;
