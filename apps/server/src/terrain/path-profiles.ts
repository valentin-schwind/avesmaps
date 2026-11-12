import { createHash } from "node:crypto";
import { allowedTransportsForPath, type TravelModel, pointInGeometry, type V12Geometry } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { NO_HEIGHT, PAIR_FLOATS, SCHRITT_PER_UNIT } from "../routing/slope.ts";
import { leseWegfindung, wirksameWegfindung } from "../system/wegfindungsstand.ts";
import type { StoredRaster } from "./dem-tiles.ts";
import { coneHeightAt, coneRadius, freePeakHeight, type ConeRule, type FreePeak } from "./peak-cone.ts";
import { continentalHeight, type ContinentalBase } from "./continental.ts";
import { domainHeightAt, domainMountainAt, type DomainHeightSource } from "./domain/read.ts";

/**
 * Die Höhenprofile der Landwege (WI-0049 S5a), wie Legacys Lauf „Wegprofile rechnen“
 * (`terrain-store.php#L434-523`, MCS-023 Nachtrag S5):
 *
 * - je Stützpunktpaar als Gerade, höchstens alle 0,25 E abgetastet, beide Enden mit;
 * - Höhe am Punkt: das Maximum über die Gebirgsraster, bilinear und nur INNERHALB ihrer Fläche, und
 *   über die Kegel der freien Gipfel (Betreiber 2026-09-27, E4 „ein Höhenmodell, zwei Anwendungen“);
 * - außerhalb jeder Höhe `null`: Ein Schritt mit `null` an einem Ende zählt nicht. So entsteht am Rand
 *   einer Fläche kein Sprung, den es im Gelände nicht gibt.
 * - Neben den Summen je Paar stehen die Abtastwerte selbst (S5c): Reit- und Lasttier und Wagen rechnen
 *   ihre Steigung je Abtastschritt, nicht linear, und dafür reichen Summen nicht.
 *
 * Nur Derived Data; ein Verlust kostet einen Lauf von `derive:terrain`.
 */

/** Höchstens so weit auseinander liegen zwei Abtastpunkte, in Karteneinheiten (Legacy 0,25 E). */
export const PROFILE_STEP = 0.25;
/** Steigt mit jeder Änderung an Abtastung oder Speicherform; geht in den Fingerabdruck. 2: Abtastwerte (S5c). */
export const PROFILE_RULES_VERSION = "3";
/**
 * Prüfgrenze (Gutachten MCS-026, Punkt 7): Ein Abtastschritt steiler als 40 % ist außergewöhnlich. Er
 * wird gemeldet, nicht abgeschnitten - meist ein Platzhalter im Gelände oder ein Weg, der in Wahrheit in
 * Kehren geht.
 */
export const STEEP_ALERT = 0.4;
/** Prüfgrenze für Wagen (MCS-026, Punkt 7): ein Weg, den ein Wagen fahren darf, mit mehr als 10 %. */
export const WHEEL_ALERT = 0.1;
export const LAND_TYPES = ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad"];

export interface HeightRaster {
    raster: StoredRaster;
    geometry: V12Geometry;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    /** Der Inhalt dieses Rasters (`rasterContentKey`), für den Fingerabdruck der Profile. */
    fingerprint: string;
}

export interface HeightSource {
    domain?: DomainHeightSource;
    continental?: ContinentalBase | undefined;
    rasters: readonly HeightRaster[];
    peaks: readonly FreePeak[];
    rule: ConeRule;
}

function bilinear(r: StoredRaster, x: number, y: number): number {
    const fx = (x - r.originX) / r.cell;
    const fy = (y - r.originY) / r.cell;
    const i = Math.min(Math.max(0, Math.floor(fx)), Math.max(0, r.width - 2));
    const j = Math.min(Math.max(0, Math.floor(fy)), Math.max(0, r.height - 2));
    const tx = Math.min(1, Math.max(0, fx - i));
    const ty = Math.min(1, Math.max(0, fy - j));
    const right = Math.min(i + 1, r.width - 1);
    const up = Math.min(j + 1, r.height - 1);
    const s = r.samples;
    const a = s[j * r.width + i] ?? 0;
    const b = s[j * r.width + right] ?? 0;
    const c = s[up * r.width + i] ?? 0;
    const d = s[up * r.width + right] ?? 0;
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/** Ein Abtastpunkt: die Höhe in Schritt und ob er in einer Gebirgsfläche liegt (Sternregel, S5c). */
export interface HeightSample {
    height: number;
    mountain: boolean;
}

/** Höhe und Lage eines Punkts, oder `null`, wo weder ein Gebirge noch ein Gipfelkegel liegt. */
export function sampleAt(source: HeightSource, x: number, y: number): HeightSample | null {
    if (source.domain)
        return { height: domainHeightAt(source.domain, x, y), mountain: domainMountainAt(source.domain, x, y) };
    let best: number | null = source.continental ? continentalHeight(source.continental, x, y) : null;
    let mountain = false;
    for (const entry of source.rasters) {
        const b = entry.bounds;
        if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
        if (!pointInGeometry([x, y], entry.geometry)) continue;
        const value = bilinear(entry.raster, x, y);
        best = best === null ? value : Math.max(best, value);
        mountain = true;
    }
    for (const peak of source.peaks) {
        const radius = coneRadius(freePeakHeight(peak), source.rule);
        if (Math.hypot(x - peak.x, y - peak.y) >= radius) continue;
        const value = coneHeightAt(peak, x, y, source.rule);
        best = best === null ? value : Math.max(best, value);
    }
    return best === null ? null : { height: best, mountain };
}

/** Die Höhe in Schritt, oder `null`, wo weder ein Gebirge noch ein Gipfelkegel liegt. */
export function heightAt(source: HeightSource, x: number, y: number): number | null {
    return sampleAt(source, x, y)?.height ?? null;
}

/**
 * Das Profil einer Linie:
 * - `pairs`: je Stützpunktpaar sieben Zahlen (`PAIR_FLOATS`), siehe Migration 0049;
 * - `samples`: je Paar die Zahl der Abtastpunkte und die Länge eines Abtastschritts in Schritt
 *   (`SAMPLE_HEADER`), dann je Punkt die Höhe (NaN ohne Höhe) und 1 in einer Gebirgsfläche, sonst 0
 *   (`SAMPLE_POINT`). Ein Paar ganz ohne Höhe trägt nur `[0, 0]`.
 *
 * `steep` ist das Gefälle je Abtastschritt, ab dem ein Abstieg oder Anstieg als steil zählt (echt größer).
 */
export function profileLine(
    coordinates: readonly [number, number][],
    sample: (x: number, y: number) => HeightSample | null,
    steep: number,
    // Der Maßstab, mit dem die Steigungen gerechnet werden (WI-0153 Schnitt 7d): der eingestellte, sonst die Setzung.
    schrittPerUnit: number = SCHRITT_PER_UNIT,
): { pairs: Float32Array; samples: Float32Array } {
    const pairs = Math.max(0, coordinates.length - 1);
    const out = new Float32Array(pairs * PAIR_FLOATS);
    const samples: number[] = [];
    for (let pair = 0; pair < pairs; pair += 1) {
        const [x0, y0] = coordinates[pair] as [number, number];
        const [x1, y1] = coordinates[pair + 1] as [number, number];
        const length = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(1, Math.ceil(length / PROFILE_STEP));
        const run = (length / steps) * schrittPerUnit;
        let up = 0;
        let down = 0;
        let steepUp = 0;
        let steepDown = 0;
        let highest = NO_HEIGHT;
        let steepestUp = 0;
        let steepestDown = 0;
        let previous: number | null = null;
        const points: number[] = [];
        for (let step = 0; step <= steps; step += 1) {
            const t = step / steps;
            const here = sample(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
            const h = here?.height ?? null;
            points.push(h ?? Number.NaN, here?.mountain ? 1 : 0);
            if (h !== null) {
                highest = Math.max(highest, h);
                if (previous !== null && run > 0) {
                    const d = h - previous;
                    const grade = Math.abs(d) / run;
                    if (d > 0) {
                        up += d;
                        if (grade > steep) steepUp += d;
                        steepestUp = Math.max(steepestUp, grade);
                    } else if (d < 0) {
                        down -= d;
                        if (grade > steep) steepDown -= d;
                        steepestDown = Math.max(steepestDown, grade);
                    }
                }
            }
            previous = h;
        }
        out.set([up, down, steepUp, steepDown, highest, steepestUp, steepestDown], pair * PAIR_FLOATS);
        if (highest === NO_HEIGHT) samples.push(0, 0);
        else samples.push(steps + 1, run, ...points);
    }
    return { pairs: out, samples: Float32Array.from(samples) };
}

export interface PathProfileReport {
    paths: number;
    computed: number;
    unchanged: number;
    removed: number;
    /** Wege mit wenigstens einem Abtastschritt mit Höhe. */
    withHeight: number;
    fingerprint: string;
    /** Prüfgrenze: Wege mit einem Abtastschritt steiler als `STEEP_ALERT`, die steilsten zuerst. */
    steep: SteepList;
    /** Prüfgrenze für Wagen: Wege, die ein Wagen fahren darf, steiler als `WHEEL_ALERT` (S5c). */
    wheel: SteepList;
}

export interface SteepList {
    threshold: number;
    paths: number;
    top: { name: string; subtype: string; grade: number; highest: number }[];
}

/** Die Liste einer Prüfgrenze: wie viele Wege darüber liegen, die zehn steilsten zuerst. */
function steepList(threshold: number, entries: SteepList["top"]): SteepList {
    const over = entries.filter((entry) => entry.grade > threshold).sort((a, b) => b.grade - a.grade);
    return { threshold, paths: over.length, top: over.slice(0, 10) };
}

/**
 * Der Inhalt eines Rasters als Schlüssel: Gitter und Samples. Der Höhenstand eines Weges hängt am Inhalt der Raster
 * an seinem Rahmen, nicht an deren Eingaben: Brennt das Einbrennen eine Gruppe neu und ein Raster darin bleibt, wie es
 * war, ändert sich kein Profil an ihm (WI-0059, 4.4). Umgebungsunabhängig, wo die Daten dieselben sind.
 */
export function rasterContentKey(raster: StoredRaster): string {
    return createHash("sha256")
        .update(
            `${String(raster.cell)}|${String(raster.originX)}|${String(raster.originY)}|${String(raster.width)}|${String(raster.height)}|`,
        )
        .update(Buffer.from(raster.samples.buffer, raster.samples.byteOffset, raster.samples.byteLength))
        .digest("hex")
        .slice(0, 32);
}

/** Über alles, was die Profile bestimmen (Zusammenfassung für den Bericht). */
export function heightFingerprint(
    rasterFingerprints: readonly string[],
    source: Pick<HeightSource, "peaks" | "rule" | "domain">,
    model: TravelModel,
    schrittPerUnit: number = SCHRITT_PER_UNIT,
): string {
    return createHash("sha256")
        .update(source.domain ? `${source.domain.fingerprint}|${source.domain.membershipFingerprint}|` : "")
        .update(rasterFingerprints.join("|"))
        .update(`|${JSON.stringify(source.peaks)}|${JSON.stringify(source.rule)}`)
        .update(`|${String(model.steigung.wert.steilAb)}|${PROFILE_RULES_VERSION}`)
        .update(massstabImAbdruck(schrittPerUnit))
        .digest("hex")
        .slice(0, 32);
}

/** Der Rahmen eines Weges in Karteneinheiten. */
export interface PathBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Kantenlänge eines Blocks des Domain-Masters für den Fingerabdruck der Wege (WI-0125): eine Kachel der feinsten Stufe. */
export const DOMAIN_BLOCK = 512;

const blockKeysOf = new WeakMap<Uint16Array, string[]>();
const mountainKeysOf = new WeakMap<object, string>();

/**
 * Der Inhalt des Domain-Masters je Block von `DOMAIN_BLOCK`² Zellen (Zeile 0 im Süden, zeilenweise): ein Schlüssel je Block, einmal je
 * Raster gerechnet. Eine lokale Veröffentlichung (WI-0125) ändert nur die Blöcke ihres Fußabdrucks; die Wege anderswo behalten ihren
 * Fingerabdruck und werden nicht neu gerechnet.
 */
export function domainBlockKeys(raster: StoredRaster): string[] {
    const known = blockKeysOf.get(raster.samples);
    if (known) return known;
    const across = Math.ceil(raster.width / DOMAIN_BLOCK);
    const down = Math.ceil(raster.height / DOMAIN_BLOCK);
    const keys: string[] = [];
    for (let by = 0; by < down; by += 1)
        for (let bx = 0; bx < across; bx += 1) {
            const hash = createHash("sha256");
            const x0 = bx * DOMAIN_BLOCK;
            const x1 = Math.min(raster.width, x0 + DOMAIN_BLOCK);
            for (let y = by * DOMAIN_BLOCK; y < Math.min(raster.height, (by + 1) * DOMAIN_BLOCK); y += 1) {
                const row = raster.samples.subarray(y * raster.width + x0, y * raster.width + x1);
                hash.update(new Uint8Array(row.buffer, row.byteOffset, row.byteLength));
            }
            keys.push(hash.digest("hex").slice(0, 16));
        }
    blockKeysOf.set(raster.samples, keys);
    return keys;
}

/** Der Schlüssel einer Gebirgsfläche (Zugehörigkeit, Sternregel), einmal je Fläche gerechnet. */
function mountainKey(area: DomainHeightSource["mountains"][number]): string {
    const known = mountainKeysOf.get(area);
    if (known) return known;
    const key = createHash("sha256").update(JSON.stringify(area.geometry)).digest("hex").slice(0, 16);
    mountainKeysOf.set(area, key);
    return key;
}

/**
 * Die Höhen des Domain-Masters an einem Rahmen: die Blöcke unter ihm (eine Zelle Rand für die bilineare Lesung) und die Gebirge an
 * ihm.
 */
function domainBoxKey(box: PathBox, domain: DomainHeightSource): string {
    const r = domain.raster;
    const column = (x: number): number => Math.floor((x - r.originX) / r.cell);
    const row = (y: number): number => Math.floor((y - r.originY) / r.cell);
    const clampBlock = (cell: number, cells: number): number =>
        Math.min(Math.ceil(cells / DOMAIN_BLOCK) - 1, Math.max(0, Math.floor(cell / DOMAIN_BLOCK)));
    const across = Math.ceil(r.width / DOMAIN_BLOCK);
    const keys = domainBlockKeys(r);
    const parts: string[] = [];
    for (let by = clampBlock(row(box.minY) - 1, r.height); by <= clampBlock(row(box.maxY) + 2, r.height); by += 1)
        for (
            let bx = clampBlock(column(box.minX) - 1, r.width);
            bx <= clampBlock(column(box.maxX) + 2, r.width);
            bx += 1
        )
            parts.push(`${String(bx)},${String(by)}:${keys[by * across + bx] ?? ""}`);
    const mountains = domain.mountains
        .filter(
            (area) => area.minX <= box.maxX && area.maxX >= box.minX && area.minY <= box.maxY && area.maxY >= box.minY,
        )
        .map(mountainKey)
        .sort();
    return `domain:${String(r.width)}|${parts.join(";")}|${mountains.join(",")}`;
}

/**
 * Der Fingerabdruck der Höhen EINES Weges (WI-0059, 4.4): die Profilregeln, die Steilheitsgrenze und nur die Raster
 * und freien Gipfel, die seinen Rahmen berühren. `sampleAt` liest nichts anderes: ein Raster nur innerhalb seiner Fläche
 * (also seines Rahmens), einen Kegel nur innerhalb seines Radius. Ändert sich ein Gebirge, sind nur die Wege an ihm
 * neu zu rechnen; `terrain_path_profile.height_fingerprint` trägt diesen Abdruck (Routing-Revision, Kap. 6.48).
 *
 * Beim Domain-Master (ADR-0016) seit WI-0125 ebenso örtlich: die Blöcke des Masters unter dem Rahmen (`domainBlockKeys`) und die
 * Gebirgsflächen an ihm, statt des Fingerabdrucks des ganzen Masters. So rechnet eine lokale Veröffentlichung nur die Wege ihres
 * Fußabdrucks neu („Wegprofile des Bereichs“, JOBS-0001 V2); nach einem vollen Lauf sind es die Wege an den geänderten Blöcken.
 */
export function pathHeightFingerprint(
    box: PathBox,
    source: HeightSource,
    model: TravelModel,
    schrittPerUnit: number = SCHRITT_PER_UNIT,
): string {
    const rasters = source.rasters.filter((entry) => {
        const b = entry.bounds;
        return b.minX <= box.maxX && b.maxX >= box.minX && b.minY <= box.maxY && b.maxY >= box.minY;
    });
    const peaks = source.peaks.filter((peak) => {
        const radius = coneRadius(freePeakHeight(peak), source.rule);
        return (
            peak.x + radius > box.minX &&
            peak.x - radius < box.maxX &&
            peak.y + radius > box.minY &&
            peak.y - radius < box.maxY
        );
    });
    return (
        createHash("sha256")
            .update(source.domain ? domainBoxKey(box, source.domain) : "")
            .update(source.continental?.fingerprint ?? "")
            // Sortiert: Die Reihenfolge der Raster in der Liste ist keine Eingabe.
            .update(
                rasters
                    .map((entry) => entry.fingerprint)
                    .sort()
                    .join("|"),
            )
            .update(`|${JSON.stringify(peaks)}|${JSON.stringify(source.rule)}`)
            .update(`|${String(model.steigung.wert.steilAb)}|${PROFILE_RULES_VERSION}`)
            .update(massstabImAbdruck(schrittPerUnit))
            .digest("hex")
            .slice(0, 32)
    );
}

/**
 * Der Maßstab im Abdruck, nur wenn er von der Setzung abweicht (WI-0153 Schnitt 7d): Mit 3000 bleiben alle gespeicherten Profile
 * gültig, und kein Lauf rechnet sie nur deshalb neu; ein anderer Wert macht jedes Profil zu „anderer Höhenstand“.
 */
function massstabImAbdruck(schrittPerUnit: number): string {
    return schrittPerUnit === SCHRITT_PER_UNIT ? "" : `|schritt${String(schrittPerUnit)}`;
}

/**
 * „Schritt je Karteneinheit“, wie die Systemsteuerung ihn vorgibt (nach der Regel des Dienstes: am Knopf der freigegebene). Die
 * Ableitung liest ihn selbst, weil sie in eigenen Prozessen läuft (Auftrag, Zug, Gelände), die `setzeWerte` nie gesehen haben.
 * Nicht lesbar: die Setzung und ein Befund, kein Abbruch (`AGENTS.md`, „Blockierende Prüfungen im Betrieb“).
 */
export async function leseMassstab(database: Queryable): Promise<number> {
    try {
        return wirksameWegfindung(await leseWegfindung(database, { personen: false })).schrittPerUnit;
    } catch (error) {
        const grund = error instanceof Error ? error.message : String(error);
        console.warn(
            `BEFUND massstab: Schritt je Karteneinheit nicht lesbar (${grund}); es gilt ${String(SCHRITT_PER_UNIT)}`,
        );
        return SCHRITT_PER_UNIT;
    }
}

/** Höchster Punkt und steilste Steigung eines Profils, aus seinen Paaren (`PAIR_FLOATS` Zahlen je Paar). */
function profileStats(pairs: Float32Array): { any: boolean; grade: number; highest: number } {
    let any = false;
    let grade = 0;
    let highest = NO_HEIGHT;
    for (let o = 0; o < pairs.length; o += PAIR_FLOATS) {
        if (pairs[o + 4] === NO_HEIGHT) continue;
        any = true;
        highest = Math.max(highest, pairs[o + 4] ?? NO_HEIGHT);
        grade = Math.max(grade, pairs[o + 5] ?? 0, pairs[o + 6] ?? 0);
    }
    return { any, grade, highest };
}

/** Eine neu gerechnete Profilzeile. */
export interface PathProfileRow {
    path_id: string;
    height_fingerprint: string;
    pair_count: number;
    pairs: Buffer;
    samples: Buffer;
    md5: string;
}

/** Was `computePathProfiles` gerechnet hat: die neuen Zeilen, die aktiven Wege und der Bericht (ohne `removed`). */
export interface PathProfileComputation {
    report: PathProfileReport;
    rows: PathProfileRow[];
    activeIds: string[];
}

/**
 * Rechnet die Profile der aktiven Landwege, deren Stand sich geändert hat, und räumt verwaiste weg. Ein Weg ist
 * unverändert, wenn Geometrie und Höhenstand (`pathHeightFingerprint`) zum Gespeicherten passen; seine Prüfgrenzen
 * kommen dann aus dem gespeicherten Profil, dieselben Zahlen wie beim Rechnen (das Profil ist `Float32`).
 */
export async function derivePathProfiles(
    database: Database,
    mapDomainId: string,
    source: HeightSource,
    model: TravelModel,
    options: { schrittPerUnit?: number } = {},
): Promise<PathProfileReport> {
    const computation = await computePathProfiles(database, mapDomainId, source, model, options);
    await database.begin((transaction) => writePathProfiles(transaction, mapDomainId, computation));
    return computation.report;
}

/**
 * Nur rechnen, nichts schreiben: Eine lokale Veröffentlichung (WI-0125) rechnet vor ihrer Transaktion und schreibt die Zeilen IN
 * der Transaktion des Zeigerwechsels (`writePathProfiles`), damit Master, Kacheln und Wegprofile zugleich wechseln.
 */
export async function computePathProfiles(
    database: Queryable,
    mapDomainId: string,
    source: HeightSource,
    model: TravelModel,
    options: { schrittPerUnit?: number } = {},
): Promise<PathProfileComputation> {
    const schritt = options.schrittPerUnit ?? (await leseMassstab(database));
    const paths = await database<
        {
            id: string;
            name: string;
            subtype: string;
            coordinates: string;
            md5: string;
            allowed_transports: string[] | null;
            transport_domain: string | null;
            transports_written: boolean;
            min_x: number;
            min_y: number;
            max_x: number;
            max_y: number;
        }[]
    >`
        SELECT id::text, name, subtype, ST_AsGeoJSON(geom, 15) AS coordinates, md5(ST_AsBinary(geom)) AS md5,
               allowed_transports, transport_domain, transports_written,
               ST_XMin(geom) AS min_x, ST_YMin(geom) AS min_y, ST_XMax(geom) AS max_x, ST_YMax(geom) AS max_y
        FROM path
        WHERE map_domain_id = ${mapDomainId} AND is_active AND subtype = ANY(${LAND_TYPES})
        ORDER BY id
    `;
    const wagons = model.steigung.wert.familien.WHEEL.reisemittel;
    const known = new Map(
        (
            await database<{ path_id: string; height_fingerprint: string; geometry_md5: string; pairs: Buffer }[]>`
                SELECT path_id::text, height_fingerprint, geometry_md5, pairs
                FROM terrain_path_profile WHERE map_domain_id = ${mapDomainId}
            `
        ).map((row) => [row.path_id, row]),
    );
    const fingerprint = heightFingerprint(
        source.rasters.map((entry) => entry.fingerprint),
        source,
        model,
        schritt,
    );
    const report: PathProfileReport = {
        paths: paths.length,
        computed: 0,
        unchanged: 0,
        removed: 0,
        withHeight: 0,
        fingerprint,
        steep: { threshold: STEEP_ALERT, paths: 0, top: [] },
        wheel: { threshold: WHEEL_ALERT, paths: 0, top: [] },
    };
    const graded: SteepList["top"] = [];
    const wheeled: SteepList["top"] = [];
    const steep = model.steigung.wert.steilAb;
    const sample = (x: number, y: number): HeightSample | null => sampleAt(source, x, y);
    const rows: PathProfileRow[] = [];
    const bytes = (floats: Float32Array): Buffer => Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
    for (const path of paths) {
        const stored = known.get(path.id);
        const wanted = pathHeightFingerprint(
            { minX: path.min_x, minY: path.min_y, maxX: path.max_x, maxY: path.max_y },
            source,
            model,
            schritt,
        );
        let stats: ReturnType<typeof profileStats>;
        if (stored && stored.height_fingerprint === wanted && stored.geometry_md5 === path.md5) {
            const { buffer, byteOffset, byteLength } = stored.pairs;
            stats = profileStats(new Float32Array(buffer.slice(byteOffset, byteOffset + byteLength)));
            report.unchanged += 1;
        } else {
            const coordinates = (JSON.parse(path.coordinates) as { coordinates: [number, number][] }).coordinates;
            const { pairs, samples } = profileLine(coordinates, sample, steep, schritt);
            stats = profileStats(pairs);
            if (pairs.length > 0) {
                rows.push({
                    path_id: path.id,
                    height_fingerprint: wanted,
                    pair_count: pairs.length / PAIR_FLOATS,
                    pairs: bytes(pairs),
                    samples: bytes(samples),
                    md5: path.md5,
                });
            }
        }
        if (stats.any) report.withHeight += 1;
        const entry = { name: path.name, subtype: path.subtype, grade: stats.grade, highest: stats.highest };
        graded.push(entry);
        const allowed = allowedTransportsForPath(
            model,
            path.subtype,
            path.allowed_transports,
            path.transport_domain,
            path.transports_written,
        );
        if (allowed.some((transport) => wagons.includes(transport))) wheeled.push(entry);
    }
    report.computed = rows.length;
    report.steep = steepList(STEEP_ALERT, graded);
    report.wheel = steepList(WHEEL_ALERT, wheeled);
    return { report, rows, activeIds: paths.map((path) => path.id) };
}

/** Schreibt gerechnete Profile und räumt die Profile nicht mehr aktiver Wege weg; trägt `removed` in den Bericht. */
export async function writePathProfiles(
    transaction: Queryable,
    mapDomainId: string,
    computation: PathProfileComputation,
): Promise<void> {
    for (const row of computation.rows) {
        await transaction`
            INSERT INTO terrain_path_profile (path_id, map_domain_id, height_fingerprint, geometry_md5, pair_count, pairs, samples)
            VALUES (${row.path_id}, ${mapDomainId}, ${row.height_fingerprint}, ${row.md5}, ${row.pair_count}, ${row.pairs}, ${row.samples})
            ON CONFLICT (path_id) DO UPDATE SET
                height_fingerprint = EXCLUDED.height_fingerprint, geometry_md5 = EXCLUDED.geometry_md5,
                pair_count = EXCLUDED.pair_count, pairs = EXCLUDED.pairs, samples = EXCLUDED.samples,
                derived_at = now()
        `;
    }
    const removed = await transaction`
        DELETE FROM terrain_path_profile
        WHERE map_domain_id = ${mapDomainId} AND path_id <> ALL(${computation.activeIds}::bigint[])
        RETURNING path_id
    `;
    computation.report.removed = removed.length;
}
