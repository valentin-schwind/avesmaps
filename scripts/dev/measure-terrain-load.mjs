// Ladezeit des Routing-Teils `terrain` nach Arbeitsschritten (WI-0071, Nachtrag): Lesen der Scheiben, Umwandeln, Eichung
// (Zugehörigkeit zum Gebirge und Höhenhistogramm), Sonstiges. Nur lesend; es wird nichts geschrieben. Die Zeiten sind
// die des echten Laders (`loadDomainHeightSource`, `calibrateRelief`), die Zerlegung kommt aus einer Uhr um jede
// Anfrage und um die Zugehörigkeit.
//
// Aufruf (von der Wurzel, gegen die Entwicklungsdatenbank):
//   node --env-file-if-exists=.env scripts/dev/measure-terrain-load.mjs [--size 4096] [--runs 3] [--out datei.json]
//   --size 4096  ein Raster dieser Größe statt des gespeicherten: das gespeicherte wird in 2x2-Blöcken gemittelt (8192
//                auf 4096). Die Anfragen gehen trotzdem an die Datenbank (die ersten 32 MiB der echten Zeile), nur der
//                Inhalt kommt aus dem Speicher: Lesezeit wie auf einem 4k-Stand, Eichung an einem Raster derselben Größe.
//   --runs N     Läufe je Fall (Standard 3); die Tabelle zeigt jeden, `min` den schnellsten
//
// Fälle, wie sie der Dienst kennt (Nachladen des Teils `terrain`):
//   kalt            kein Vorgänger (Kaltstart, erster Stand)
//   gleich          Raster und Gebirgsflächen gleich: der geltende Stand bleibt
//   flaechen        dasselbe Raster, Gebirgsflächen anders: nur die Eichung rechnet
//   raster          ein neues Raster: lesen und eichen
// `ms` ist die Uhr um alles, die Schritte darunter sind ihre Zerlegung (`umwandeln_ms` ist der Rest des Ladens: Fläche
// als JSON lesen, Hash, Scheiben in den Puffer kopieren). Parallele Sitzungen ändern Zeiten um bis zu 25 %.
// Den Speicher (ArrayBuffer im Worker-Thread) misst `measure-routing-worker.mjs`; hier geht es nur um die Zeit.
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const MiB = 1024 * 1024;
const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : fallback;
};
const wantedSize = Number(valueOf("--size", "0"));
const runs = Math.max(1, Number(valueOf("--runs", "3")));
const out = valueOf("--out", undefined);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL fehlt (--env-file-if-exists=.env)");

const { createDatabase, WORKER_TIMEOUTS } = await import("../../apps/server/src/database.ts");
const { loadDomainHeightSource } = await import("../../apps/server/src/routing/terrain-load.ts");
const { mountainMembershipRows } = await import("../../apps/server/src/routing/mountain-membership.ts");
const { calibrateRelief, loadTerrainHeights } = await import("../../apps/server/src/routing/relief.ts");
const { SLICE_BYTES } = await import("../../apps/server/src/routing/sliced-read.ts");
const { DEFAULT_CONE } = await import("../../apps/server/src/terrain/peak-cone.ts");
const { AVENTURIA, AVENTURIA_TRAVEL_MODEL } = await import("@avesmaps3d/shared");

const database = createDatabase(process.env.DATABASE_URL, { max: 2, timeouts: WORKER_TIMEOUTS });
const domainId = AVENTURIA.mapDomain;
const now = () => performance.now();

/** Das gespeicherte Raster, in 2x2-Blöcken gemittelt, wenn ein kleineres verlangt ist (nur der Inhalt, nie die Kosten). */
async function syntheticRaster() {
    const real = await loadDomainHeightSource(database, domainId);
    if (!real) throw new Error("Kein Domain-Raster in der Datenbank");
    const size = real.raster.width;
    if (!wantedSize || wantedSize === size) return { size, fake: null, real };
    if (size % wantedSize !== 0) throw new Error(`${String(size)} lässt sich nicht auf ${String(wantedSize)} mitteln`);
    const block = size / wantedSize;
    const samples = new Uint16Array(wantedSize * wantedSize);
    for (let j = 0; j < wantedSize; j += 1) {
        for (let i = 0; i < wantedSize; i += 1) {
            let sum = 0;
            for (let dj = 0; dj < block; dj += 1)
                for (let di = 0; di < block; di += 1)
                    sum += real.raster.samples[(j * block + dj) * size + i * block + di];
            samples[j * wantedSize + i] = Math.round(sum / (block * block));
        }
    }
    return {
        size: wantedSize,
        fake: { fingerprint: `synthetisch-${String(wantedSize)}`, size: wantedSize, samples },
        real,
    };
}

/**
 * Die Datenbank mit einer Uhr um jede Anfrage des Laders, nach Art sortiert. Mit `fake` liefert sie das gemittelte
 * Raster: Die Anfrage nach den Scheiben geht trotzdem an die echte Zeile (gleiche Arbeit des Servers), der Inhalt
 * kommt aus dem Speicher.
 */
function timedDatabase(fake, realFingerprint) {
    const clock = { stored: 0, areas: 0, slice: 0, slices: 0 };
    const wrapped = async (strings, ...values) => {
        const text = strings.join("?");
        const kind = text.includes("substring(samples")
            ? "slice"
            : text.includes("ST_AsGeoJSON")
              ? "areas"
              : text.includes("terrain_domain_raster t")
                ? "stored"
                : "other";
        const began = now();
        let rows;
        if (fake && kind === "slice") {
            const [from, length, domain] = values;
            await database(strings, from, length, domain, realFingerprint);
            rows = [{ part: Buffer.from(fake.samples.buffer, from - 1, length) }];
        } else {
            rows = await database(strings, ...values);
            if (fake && kind === "stored") rows = [{ ...rows[0], fingerprint: fake.fingerprint, size: fake.size }];
        }
        const spent = now() - began;
        if (kind === "slice") {
            clock.slice += spent;
            clock.slices += 1;
        } else if (kind !== "other") clock[kind] += spent;
        return rows;
    };
    return { wrapped, clock };
}

const { size, fake, real } = await syntheticRaster();
const timed = timedDatabase(fake, real.fingerprint);
const db = timed.wrapped;

/** Dieselbe Folge wie `loadTerrainHeights`, mit einer Uhr um jeden Schritt. */
async function load(previous) {
    for (const key of Object.keys(timed.clock)) timed.clock[key] = 0;
    const began = now();
    const domain = await loadDomainHeightSource(db, domainId, previous);
    const loaded = now() - began;
    const sql = { ...timed.clock };
    let membership = 0;
    let calibrated = 0;
    if (!(domain && domain === previous)) {
        const r = domain.raster;
        const rasters = [
            {
                ...r,
                membershipRows: (from, to) => {
                    const at = now();
                    const rows = mountainMembershipRows(domain, from, to);
                    membership += now() - at;
                    return rows;
                },
                maxX: r.originX + (r.width - 1) * r.cell,
                maxY: r.originY + (r.height - 1) * r.cell,
            },
        ];
        const at = now();
        calibrateRelief(rasters, [], DEFAULT_CONE, AVENTURIA_TRAVEL_MODEL);
        calibrated = now() - at;
    }
    const whole = now() - began;
    return {
        domain,
        row: {
            ms: Math.round(whole),
            lesen_ms: Math.round(sql.slice),
            scheiben: sql.slices,
            flaechen_sql_ms: Math.round(sql.areas),
            stand_sql_ms: Math.round(sql.stored),
            umwandeln_ms: Math.round(loaded - sql.stored - sql.areas - sql.slice),
            eichung_zugehoerigkeit_ms: Math.round(membership),
            eichung_histogramm_ms: Math.round(calibrated - membership),
        },
    };
}

/** Der Server allein: dieselben Scheiben, aber nur ihre Länge zurück (ohne Übertragung und ohne Umwandlung im Treiber). */
async function serverOnly() {
    const total = size * size * 2;
    const began = now();
    for (let offset = 0; offset < total; offset += SLICE_BYTES) {
        const length = Math.min(SLICE_BYTES, total - offset);
        await database`
            SELECT octet_length(substring(samples FROM ${offset + 1} FOR ${length})) AS n
            FROM terrain_domain_raster WHERE map_domain_id = ${domainId} AND fingerprint = ${real.fingerprint}
        `;
    }
    return Math.round(now() - began);
}

const rows = [];
const print = (name, data) => {
    rows.push({ name, ...data });
    process.stdout.write(
        `${name.padEnd(34)} ${Object.entries(data)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join("  ")}\n`,
    );
};

process.stdout.write(
    `Raster ${String(size)} x ${String(size)} = ${((size * size * 2) / MiB).toFixed(0)} MiB, ${String(real.mountains.length)} Gebirgsflächen, Scheibe ${String(SLICE_BYTES / MiB)} MiB${fake ? " (synthetisch aus dem gespeicherten gemittelt)" : ""}\n`,
);
print("Lesen allein, Server ohne Übertragung", { ms: await serverOnly() });

const cases = [
    ["kalt", () => undefined],
    ["gleich", (base) => base],
    ["flaechen", (base) => ({ ...base, membershipFingerprint: "alt" })],
    ["raster", (base) => ({ ...base, fingerprint: "alt", revision: "alt" })],
];
const first = await load(undefined);
print("kalt #0 (erster Lauf, JIT kalt)", first.row);
for (const [name, previousOf] of cases) {
    const best = {};
    for (let run = 1; run <= runs; run += 1) {
        const { row } = await load(previousOf(first.domain));
        print(`${name} #${String(run)}`, row);
        if (best.ms === undefined || row.ms < best.ms) Object.assign(best, row);
    }
    print(`${name} min`, best);
}

// Gegenprobe: derselbe Aufruf wie im Dienst gibt dieselbe Eichung.
const direct = await loadTerrainHeights(db, domainId, AVENTURIA_TRAVEL_MODEL);
const parts = direct?.mu ? JSON.stringify(direct.mu) : "keine";
process.stdout.write(`Eichung mu (loadTerrainHeights): ${parts}\n`);
if (out) writeFileSync(out, `${JSON.stringify({ size, rows, mu: direct?.mu }, null, 2)}\n`);
await database.end();
