import { createHash } from "node:crypto";
import type { Queryable } from "../database.ts";
import type { StoredRaster } from "../terrain/dem-tiles.ts";
import { loadTerrainManifest } from "../terrain/dem-manifest.ts";
import type { DomainHeightSource } from "../terrain/domain/read.ts";
import {
    readRows,
    readSlices,
    routingRasterRead,
    routingSliceBytes,
    sliceCount,
    type RasterRead,
} from "./sliced-read.ts";

/**
 * Das Höhenmodell des Routings laden (WI-0071): ein Raster, einmal im Speicher, und nur dann neu, wenn es sich
 * geändert hat.
 *
 * - **Das Raster kommt in Scheiben.** `terrain_domain_raster.samples` ist eine Zeile von 32 MiB. Der Treiber
 *   bekommt sie als Hexadezimaltext (64 MiB), sammelt die Pakete der Nachricht, fügt sie zu einem Puffer zusammen
 *   und wandelt ihn um: gemessen 218 bis 259 MiB ArrayBuffer-Spitze beim Laden, obwohl das Raster danach 32 MiB
 *   belegt, und bis zur nächsten Anfrage hielt die Verbindung die Puffer. Mit Scheiben von 1 MiB bleibt die Spitze
 *   über dem Raster bei wenigen MiB. Das Ergebnis ist Byte für Byte dasselbe. Bei einer komprimiert abgelegten Zeile
 *   kommen die Scheiben als Zeilen EINER Anfrage (`readSamples`); Scheibengröße und Art lassen sich über die
 *   Umgebung einstellen (`ROUTING_SLICE_MIB`, `ROUTING_RASTER_READ`, `sliced-read.ts`).
 * - **Dasselbe Raster wird nicht noch einmal gelesen.** Es ist unveränderlich unter seinem Fingerabdruck
 *   (`storeDomainRaster` schreibt `samples` nie über einen vorhandenen). Ein Nachladen, das `previous` mitbringt,
 *   übernimmt dessen Raster als dasselbe Objekt, solange der Fingerabdruck gleich ist; ändern sich nur die
 *   Gebirgsflächen, kostet das 0,4 MiB statt 32. Auch ein neuer Stand, dessen Raster UND Gebirgsflächen gleich sind,
 *   ist `previous` selbst (dasselbe Objekt, samt der Zwischenspeicher, die an ihm hängen).
 *
 * - **Ein neues Raster wird Kachel für Kachel getauscht** (WI-0125, Anforderung des Betreibers 2026-10-04 zur Meldegrenze): Ist ein
 *   Raster im Speicher und kennen beide Revisionen ihr Manifest, liest der Worker nur die Kacheln der feinsten Stufe (512² Zellen
 *   des Masters), deren Revision sich änderte, und setzt sie in SEIN Raster ein. Kein zweites Raster neben dem alten (bis 808 MB RSS
 *   beim Wechsel), und das Routing antwortet die ganze Zeit. 🪤 Weil der alte Stand dasselbe Raster hält, rechnet er ab dem Einsetzen
 *   (ein synchroner Schritt, nach allen Lesungen) bis zum Wechsel des Stands schon mit den neuen Höhen dieser Kacheln, mit seiner
 *   alten Eichung; gemessen ist das die Vorbereitung des neuen Stands, rund eine Sekunde. Was ein Raster gerade hält, steht in
 *   `held` (Fingerabdruck und Manifest), nicht am Stand, der es trägt: Ein gescheitertes Nachladen tauscht beim nächsten Mal
 *   dieselben Kacheln noch einmal, statt den alten Fingerabdruck zu glauben. Das Manifest ist je Revision unveränderlich und hängt am
 *   Revisionsteil `terrain` (`terrain_dem.revision`); `loadTerrainManifest` liest es.
 *
 * 🔴 Die Auswahl des Rasters und die Gebirgsflächen sind dieselben wie in `loadPublishedDomainSource`
 * (`terrain/domain/read.ts`), die die Ableitung und die Prüfer lesen; `route-terrain-load.test.ts` vergleicht
 * beide gegen die Datenbank. Wer eine Abfrage ändert, ändert beide.
 */

export interface DomainLoadOptions {
    /** Scheibengröße in Byte; im Test klein und krumm, damit Grenzen und Rest vorkommen. Vorgabe `routingSliceBytes()`. */
    sliceBytes?: number;
    /** Die Art, das Raster zu lesen; Vorgabe `routingRasterRead()` (`auto`). Im Test erzwungen. */
    read?: RasterRead;
}

/**
 * Das veröffentlichte Höhenmodell der Kartendomäne, wie `loadPublishedDomainSource` es ohne Fingerabdruck liefert
 * (das aktuelle), mit `previous` als dem Stand, den ein Nachladen übernehmen darf: Null ohne Raster.
 */
export async function loadDomainHeightSource(
    database: Queryable,
    domain: string,
    previous?: DomainHeightSource | null,
    options: DomainLoadOptions = {},
): Promise<DomainHeightSource | null> {
    const [stored] = await database<{ fingerprint: string; revision: string; size: number }[]>`
        SELECT t.fingerprint, d.revision, t.size FROM terrain_domain_raster t
        JOIN terrain_dem d ON d.map_domain_id = t.map_domain_id AND d.domain_fingerprint = t.fingerprint
        WHERE t.map_domain_id = ${domain} AND d.is_current
        ORDER BY d.is_current DESC, t.derived_at DESC, d.created_at DESC LIMIT 1
    `;
    if (!stored) return null;
    const areas = await database<{ geometry: string; min_x: number; min_y: number; max_x: number; max_y: number }[]>`
        SELECT ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(a.geom,'method=structure'),3),15) AS geometry,
            ST_XMin(a.geom) AS min_x, ST_YMin(a.geom) AS min_y, ST_XMax(a.geom) AS max_x, ST_YMax(a.geom) AS max_y
        FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
        WHERE a.is_active AND a.map_domain_id = ${domain} AND r.region_layer = 'topographie' AND r.region_type = 'gebirge'
        ORDER BY a.public_id
    `;
    const membershipFingerprint = createHash("sha256").update(JSON.stringify(areas)).digest("hex");
    const holds = previous ? (held.get(previous.raster)?.fingerprint ?? previous.fingerprint) : undefined;
    const sameRaster =
        previous !== undefined &&
        previous !== null &&
        holds === stored.fingerprint &&
        previous.raster.width === stored.size;
    const unchanged =
        sameRaster && previous.revision === stored.revision && previous.membershipFingerprint === membershipFingerprint;
    if (previous && unchanged) return previous;
    const cell = 1024 / stored.size;
    const manifest = finestLevel(await loadTerrainManifest(database, stored.revision));
    let raster: StoredRaster | undefined = previous && sameRaster ? previous.raster : undefined;
    if (!raster && previous && previous.raster.width === stored.size && manifest)
        raster = await exchangeTiles(database, domain, stored.fingerprint, previous.raster, manifest);
    raster ??= {
        cell,
        originX: cell / 2,
        originY: cell / 2,
        width: stored.size,
        height: stored.size,
        samples: await readSamples(database, domain, stored.fingerprint, stored.size, options),
    };
    held.set(raster, { fingerprint: stored.fingerprint, ...(manifest ? { tiles: manifest } : {}) });
    return {
        fingerprint: stored.fingerprint,
        revision: stored.revision,
        membershipFingerprint,
        raster,
        mountains: areas.map((area) => ({
            geometry: JSON.parse(area.geometry),
            minX: area.min_x,
            minY: area.min_y,
            maxX: area.max_x,
            maxY: area.max_y,
        })),
    };
}

/**
 * Die feinste Stufe eines Manifests: die Kacheln, die das Raster in voller Auflösung zerlegen. Aus dem Manifest selbst, nicht aus
 * `dem-tiles.ts` (der Rechenpfad importiert von dort nur Typen, 5.32a Regel 5).
 */
function finestLevel(tiles: Record<string, string> | undefined): Record<string, string> | undefined {
    if (!tiles) return undefined;
    const zoomOf = (key: string): number => Number(key.split("/")[0]);
    const zoom = Math.max(...Object.keys(tiles).map(zoomOf));
    return Object.fromEntries(Object.entries(tiles).filter(([key]) => zoomOf(key) === zoom));
}

/** Was ein Raster im Speicher gerade hält: Fingerabdruck und Manifest der feinsten Stufe (WI-0125). */
const held = new WeakMap<StoredRaster, { fingerprint: string; tiles?: Record<string, string> }>();

/** Ein Tausch der Kacheln (WI-0125): wie viele, wie viele Byte, wie lange. Der Worker schreibt es ins Journal. */
export interface HeightExchange {
    tiles: number;
    bytes: number;
    ms: number;
}

let exchangeListener: ((exchange: HeightExchange) => void) | undefined;

/** Meldet jeden Tausch (der Routing-Worker schreibt ihn ins Journal); `undefined` meldet sich ab. */
export function onHeightExchange(listener: ((exchange: HeightExchange) => void) | undefined): void {
    exchangeListener = listener;
}

/**
 * Tauscht die geänderten Kacheln der feinsten Stufe in einem Raster im Speicher (WI-0125): erst alles lesen, dann in EINEM synchronen
 * Schritt einsetzen. `undefined`, wenn das nicht geht (das alte Manifest ist unbekannt, die Zeile liegt komprimiert); dann liest der
 * Aufrufer das ganze Raster wie bisher. Eine Kachel (`4/x/y`, Zeile 0 im Norden) sind die gespeicherten Zeilen
 * `n - (y + 1) · 512` bis `n - y · 512` und die Spalten `x · 512` bis `(x + 1) · 512`; nebeneinanderliegende geänderte Kacheln einer
 * Kachelzeile werden in einer Anfrage gelesen.
 */
async function exchangeTiles(
    database: Queryable,
    domain: string,
    fingerprint: string,
    raster: StoredRaster,
    manifest: Record<string, string>,
): Promise<StoredRaster | undefined> {
    const before = held.get(raster)?.tiles;
    if (!before) return undefined;
    if (await storedCompressed(database, domain, fingerprint)) return undefined;
    const started = performance.now();
    const n = raster.width;
    // Die feinste Stufe zerlegt das Raster in perSide² gleiche Kacheln (Aventurien 8192²: 16², je 512²).
    const perSide = Math.round(Math.sqrt(Object.keys(manifest).length));
    const size = n / perSide;
    if (perSide * perSide !== Object.keys(manifest).length || !Number.isInteger(size)) return undefined;
    const rows = new Map<number, number[]>();
    for (const [key, revision] of Object.entries(manifest)) {
        if (before[key] === revision) continue;
        const [, x, y] = key.split("/").map(Number) as [number, number, number];
        if (x >= perSide || y >= perSide) return undefined;
        rows.set(y, [...(rows.get(y) ?? []), x]);
    }
    const parts: { offset: number; values: Uint16Array }[] = [];
    let tiles = 0;
    for (const [y, columns] of rows) {
        columns.sort((a, b) => a - b);
        tiles += columns.length;
        for (let i = 0; i < columns.length;) {
            let j = i;
            while (j + 1 < columns.length && columns[j + 1] === columns[j]! + 1) j += 1;
            const c0 = columns[i]! * size;
            const width = (j - i + 1) * size;
            const r0 = n - (y + 1) * size;
            const read = await database<{ r: number; part: Buffer }[]>`
                SELECT r, substring(samples, (r * ${n} + ${c0}) * 2 + 1, ${width * 2}) AS part
                FROM terrain_domain_raster, generate_series(${r0}::int, ${r0 + size - 1}::int) AS r
                WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}
            `;
            if (read.length !== size) return undefined;
            for (const row of read) {
                if (row.part.byteLength !== width * 2) return undefined;
                const values = new Uint16Array(width);
                new Uint8Array(values.buffer).set(row.part);
                parts.push({ offset: row.r * n + c0, values });
            }
            i = j + 1;
        }
    }
    // Alles gelesen: jetzt in einem Zug einsetzen, ohne dass eine Anfrage dazwischen das halbe Raster sieht.
    for (const part of parts) raster.samples.set(part.values, part.offset);
    const bytes = parts.reduce((sum, part) => sum + part.values.byteLength, 0);
    exchangeListener?.({ tiles, bytes, ms: Math.round(performance.now() - started) });
    return raster;
}

/**
 * Die Proben des Rasters (uint16, Zeile 0 im Süden) in EINEN Puffer (`sliced-read.ts`). Jede Anfrage nennt das Raster bei
 * seinem Fingerabdruck: Es ändert sich nicht, auch nicht zwischen zwei Scheiben.
 *
 * - **Scheiben**, eine Anfrage je Scheibe: der Weg für eine unkomprimierte Zeile (lokal 0,75 s für 128 MiB).
 * - **Zeilen**, eine Anfrage für alle Scheiben: der Weg für eine komprimierte Zeile. `EXTERNAL` komprimiert nichts, entpackt
 *   aber auch nichts: Ein Wert, den die Hilfstabelle der Ableitung (`EXTENDED`) schon komprimiert hatte, bleibt es, und
 *   jede Scheibe entpackt dann alles vor sich (Stage 8k: 17,8 s statt 0,75 s). Die Anfrage entpackt die Zeile einmal
 *   und schneidet die Scheiben aus dem Ergebnis; der Treiber liest sie mit einem Cursor Zeile für Zeile, der Speicher
 *   auf dieser Seite bleibt bei dem der Scheiben von 1 MiB (50 gegen 56 MiB Spitze über dem Raster). Der Datenbankprozess
 *   hält dafür kurz die ganze Zeile (128 MiB).
 * - `auto` nimmt die Zeilen nur, wenn `pg_column_size` kleiner ist als die Länge, also bei komprimierter Zeile.
 * - Die Zeilenanfrage schreibt `substring(wert, von, anzahl)` statt `substring(wert FROM …)`: Der Test der Revisionsteile
 *   (`routing-fingerprint-coverage.test.ts`) liest jedes `FROM <Name>` im Quelltext der Loader als Tabelle.
 */
async function readSamples(
    database: Queryable,
    domain: string,
    fingerprint: string,
    size: number,
    options: DomainLoadOptions,
): Promise<Uint16Array> {
    const total = size * size * 2;
    const slice = options.sliceBytes ?? routingSliceBytes();
    const mode = options.read ?? routingRasterRead();
    const byRows = mode === "rows" || (mode === "auto" && (await storedCompressed(database, domain, fingerprint)));
    const bytes = byRows
        ? await readRows(total, slice, async (onRow) => {
              await database<{ i: number; part: Buffer }[]>`
                  SELECT i, substring(r.v, i * ${slice} + 1, ${slice}) AS part
                  FROM (
                      SELECT substring(samples, 1) AS v FROM terrain_domain_raster
                      WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint} OFFSET 0
                  ) r, generate_series(0, ${sliceCount(total, slice) - 1}) AS i
              `.cursor(1, (rows) => {
                  for (const row of rows) onRow({ index: row.i, part: row.part });
              });
          })
        : await readSlices(total, slice, async (offset, length) => {
              const [row] = await database<{ part: Buffer }[]>`
                  SELECT substring(samples FROM ${offset + 1} FOR ${length}) AS part
                  FROM terrain_domain_raster WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}
              `;
              return row?.part;
          });
    if (!bytes) throw new Error(`Das Domain-Raster ${fingerprint} ist nicht lesbar`);
    return new Uint16Array(bytes.buffer);
}

/** Liegt die Zeile komprimiert? `pg_column_size` und `octet_length` lesen die Zeile nicht, nur ihren Verweis. */
async function storedCompressed(database: Queryable, domain: string, fingerprint: string): Promise<boolean> {
    const [row] = await database<{ stored: number; raw: number }[]>`
        SELECT pg_column_size(samples) AS stored, octet_length(samples) AS raw
        FROM terrain_domain_raster WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}
    `;
    return row !== undefined && row.stored < row.raw;
}
