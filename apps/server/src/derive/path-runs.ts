import { createHash } from "node:crypto";
import { AVENTURIA_PATH_CARTOGRAPHY, FACULTY_GLYPHIC_METRICS, requiredRunLength } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import {
    calmestWindowStart,
    labelFitsAngle,
    sliceByLength,
    mapUnitsPerPixel,
    splitIntoInstances,
    zoomWhereInstancesFit,
    type Point,
} from "./run-geometry.ts";

/**
 * Leitet die Schriftläufe der Wegnamen ab (WI-0010 P5).
 *
 * ⭐ DIESELBE BAUFORM WIE WI-0004, mit den gemeinsamen Teilen aus `run-geometry.ts` — nicht mit
 * einer zweiten Label-Engine. Was hier fehlt, fehlt mit Absicht:
 *
 * | | Landschaft (WI-0004) | Weg (hier) |
 * |---|---|---|
 * | Ausgangsgeometrie | eine Fläche | eine **Linie** |
 * | Mittelachse ableiten | Triangulation + chordale Achse | 🔴 **entfällt** — die Linie ist schon da |
 * | Glätten (`fitCurve`, `calmToChord`) | ja, die Achse ist selbst abgeleitet | 🔴 **verboten** — die Weggeometrie ist authoritativ |
 * | Zahl der Instanzen | `label_curve_max`, redaktionell 1–3 | ergibt sich aus der Länge |
 *
 * 💣 Die Glättung wegzulassen ist keine Vereinfachung, sondern die Zusicherung: ein geglätteter
 * Lauf ließe den Namen NEBEN dem Weg laufen. Bei einer Landschaft darf die Achse von der Fläche
 * abweichen — sie ist ohnehin erfunden. Bei einem Weg ist das ein Fehler.
 *
 * 🪤 Grundlage sind die KETTEN (`path_label_render`, Migration 0022), nicht die Abschnitte. Sonst
 * bäte „Reichsstraße 2" siebenundsiebzig Mal um Platz.
 */

/**
 * Steigt, wenn sich Aufteilung oder Fenstersuche ändern — und entwertet alte Läufe. 6: Jeder Lauf trägt `is_bach` (Migration 0199).
 */
export const ALGORITHM_VERSION = "6";

/** Mindestabstand zweier Instanzen desselben Namens, in Schriftgrößen. Wie bei den Landschaften. */
const MIN_GAP_EM = 2.0;
/** Wie viele Namensinstanzen ein Teilstück höchstens trägt. */
const MAX_INSTANCES = 4;
/**
 * Die Schriftgröße, für die ein Lauf zugeschnitten wird — in Bildschirmpixeln.
 *
 * 💣 Hier stand `12`, und im Kartenlayer stand `12` noch einmal. Zwei Stellen für eine Zahl, die
 * zusammenpassen MUSS: MapLibre biegt einen Namen, der breiter ist als sein Lauf, nicht — es lässt
 * ihn weg. Ersatzlos, ohne Meldung. Jetzt kommen beide aus derselben Kartografie.
 *
 * 🪤 Und zwar aus dem GRÖSSTEN Aufschlag, nicht aus der Grundgröße: ein Flussname ist drei Pixel
 * größer als ein Straßenname (Legacy). Die Läufe wurden bisher für 12 geschnitten und die
 * Flussnamen mit 15 gezeichnet — sie waren die ersten, die verschwanden.
 *
 * ⭐ Dazu die Reserve `runHeadroom`: der Lauf wird länger geschnitten, als der Name braucht. Das
 * ist der Spielraum, in dem sich die Schriftgröße bewegen darf, ohne dass irgendetwas neu
 * abgeleitet werden muss — genau was der Schriftgrößen-Regler tut.
 */
export const LABEL_SIZE =
    (AVENTURIA_PATH_CARTOGRAPHY.label.baseSize +
        Math.max(
            AVENTURIA_PATH_CARTOGRAPHY.label.sizeDelta.Flussweg,
            AVENTURIA_PATH_CARTOGRAPHY.label.sizeDelta.bach,
            AVENTURIA_PATH_CARTOGRAPHY.label.sizeDelta.sonst,
        )) *
    (AVENTURIA_PATH_CARTOGRAPHY.label.calibration ?? 1) *
    AVENTURIA_PATH_CARTOGRAPHY.label.runHeadroom;
/** Bis hierhin wird nach einer passenden Stufe gesucht. */
const MAX_ZOOM = 8;

/**
 * Die Winkelgrenzen, in Bogenmaß — dieselben Zahlen, die der Kartenlayer MapLibre gibt.
 *
 * 🪤 Das Winkelfenster ist MapLibres `3/5 × Schriftgröße`. Geprüft wird mit der GRÖSSTEN
 * Schriftgröße (`LABEL_SIZE` samt Reserve): ein längeres Fenster summiert mehr Ecken auf, die
 * Prüfung ist also nie nachsichtiger als MapLibre.
 */
const MAX_ANGLE = (AVENTURIA_PATH_CARTOGRAPHY.label.maxAngleDeg * Math.PI) / 180;
const MAX_TURN = (AVENTURIA_PATH_CARTOGRAPHY.label.maxTurnDeg * Math.PI) / 180;
const ANGLE_WINDOW_PX = (3 / 5) * LABEL_SIZE;

/**
 * Wie weit ein Wegname an seiner Linie ausweichen darf — als Anteil SEINER Länge, je Richtung.
 *
 * ⭐ Legacy lässt einen Wegnamen bis 160 px entlang seiner Linie rutschen, bis die Stelle frei ist
 * (`PATH_LABEL_CALM_SEARCH_PX`). Betreiberentscheidung 2026-09-23: „Wegnamen sollen ausweichen
 * dürfen wie bei Avesmaps."
 *
 * 💣 MAPLIBRE KANN DAS NICHT SELBST, und die Grenze ist hart. Die Kachel liefert deshalb fünf
 * Kandidaten je Name (`path_label_run_tile`, Migration 0030), die sich GEGENSEITIG überdecken —
 * sonst stünde derselbe Name zweimal. Kandidaten werden auf der ganzen Kachelstufe z geschnitten,
 * gezeichnet aber bis z + 0,99; dort ist der Name auf der Karte nur noch halb so lang. Damit sich
 * zwei Kandidaten auch dann noch überdecken, darf ihr größter Abstand höchstens die HALBE
 * Namenslänge sein: ±¼ je Richtung. Mehr wäre ein doppelter Name beim Zoomen.
 */
export const SLIDE_SHARE = 0.25;

/** Würde MapLibre den Namen auf dieser Stufe mitten auf diesen Lauf setzen? */
export function runFitsAngle(points: readonly Point[], nameWidthPx: number, zoom: number): boolean {
    const units = mapUnitsPerPixel(zoom);
    return labelFitsAngle(points, nameWidthPx * units, ANGLE_WINDOW_PX * units, MAX_ANGLE, MAX_TURN);
}

export interface ChainInput {
    name: string;
    subtype: string;
    mapDomainId: string;
    /** Die Teilstücke der Kette — ein MultiLineString zerfällt in mehrere. */
    parts: Point[][];
    /** Woraus die Kette entstand: die Revisionen ihrer Abschnitte. */
    fingerprintSource: string;
}

export interface DerivedPathRun {
    part: number;
    instance: number;
    instanceCount: number;
    runMinZoom: number;
    runMaxZoom: number;
    nameWidthPx: number;
    points: Point[];
}

export function fingerprintOf(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Der Punkt auf halber Länge einer Linie. */
function mitteVon(points: readonly Point[]): Point {
    const halb = lengthOf(points) / 2;
    let bisher = 0;
    for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1] as Point;
        const b = points[index] as Point;
        const strecke = Math.hypot(b.x - a.x, b.y - a.y);
        if (strecke > 0 && bisher + strecke >= halb) {
            const t = (halb - bisher) / strecke;
            return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
        }
        bisher += strecke;
    }
    return points[0] as Point;
}

/** Der kleinste Abstand eines Punkts zu den Strecken der Linien. */
function abstandZu(punkt: Point, linien: readonly (readonly Point[])[]): number {
    let best = Infinity;
    for (const linie of linien) {
        for (let index = 1; index < linie.length; index += 1) {
            const a = linie[index - 1] as Point;
            const b = linie[index] as Point;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const q = dx * dx + dy * dy;
            const t = q > 0 ? Math.max(0, Math.min(1, ((punkt.x - a.x) * dx + (punkt.y - a.y) * dy) / q)) : 0;
            best = Math.min(best, Math.hypot(punkt.x - a.x - t * dx, punkt.y - a.y - t * dy));
        }
    }
    return best;
}

/**
 * So nah muss die Mitte eines Laufs an einem Bachabschnitt liegen, in Karteneinheiten. Der Lauf ist ein Stück der Kette selbst
 * (`sliceByLength`, ohne Glättung), seine Mitte liegt also AUF einem ihrer Abschnitte; die Schranke fängt nur Rundung ab.
 */
const AUF_DER_LINIE = 1e-6;

/**
 * Liegt ein Lauf auf einem Bach (WI-0177, Migration 0199; Befund WI-0221 §10)? Je LAUF, nicht je Name: 21 Flussketten mischen
 * Bach- und Flussabschnitte (etwa Ingval, 1 zu 18), und ein Lauf auf dem Flussteil ist ein Flussname. Maßgeblich ist seine Mitte,
 * dort steht der Name (`line-center`).
 */
export function laufAufBach(points: readonly Point[], bachLinien: readonly (readonly Point[])[]): boolean {
    if (bachLinien.length === 0 || points.length < 2) return false;
    return abstandZu(mitteVon(points), bachLinien) <= AUF_DER_LINIE;
}

function lengthOf(points: readonly Point[]): number {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1] as Point;
        const b = points[index] as Point;
        total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return total;
}

/**
 * Die Läufe eines Teilstücks, über alle Instanzzahlen.
 *
 * Für jede Zahl von `MAX_INSTANCES` abwärts wird gefragt, ab welcher Stufe sie nebeneinander
 * passen. Daraus entstehen die Zoombänder: die höchste Zahl bekommt die oberen Stufen, die
 * nächstkleinere die darunter, und die eine Instanz reicht bis ganz nach unten.
 *
 * 🪤 HIER WEICHT DER WEG VON DER LANDSCHAFT AB, und der Verifier hat mich darauf gestoßen.
 *
 * Bei den Landschaften reicht der Satz mit EINER Instanz bis ganz nach unten, ohne auf Passung
 * geprüft zu werden — Invariante I7 verlangt, dass der Name nie ausfällt, also wird es wenigstens
 * versucht. Ich hatte das übernommen; `verify:path-runs` meldete daraufhin 1210 Läufe, die auf
 * ihrer untersten Stufe kürzer sind als ihr Name.
 *
 * 💣 Für Wege ist das die falsche Übernahme. Ein Wegname DARF ausfallen (sein Layer ist
 * `text-optional`), und ein Lauf, der Platz verspricht, den es nicht gibt, ist kein Versuch,
 * sondern eine unbrauchbare Zeile in jeder Kachel. Jeder Lauf trägt deshalb eine ehrliche Zusage:
 * `run_min_zoom` ist die Stufe, ab der der Name wirklich passt. Wo er nie passt, gibt es keinen
 * Lauf — und die Kette bleibt namenlos, was ehrlicher ist als ein Name, der nie erscheint.
 */
export function runsForPart(points: readonly Point[], nameWidthPx: number, part: number): DerivedPathRun[] {
    const curveLength = lengthOf(points);
    if (curveLength <= 0 || points.length < 2) {
        return [];
    }
    const gapPixels = MIN_GAP_EM * LABEL_SIZE;
    const runs: DerivedPathRun[] = [];

    // Von oben nach unten: jede Instanzzahl bekommt das Band bis zur nächstkleineren.
    let takenFrom = MAX_ZOOM + 1;
    for (let count = MAX_INSTANCES; count >= 1; count -= 1) {
        // 🔴 AUCH fuer eine einzelne Instanz wird gefragt. Siehe der Kommentar oben: ein Lauf, der
        // Platz verspricht, den es nicht gibt, ist eine unbrauchbare Zeile in jeder Kachel.
        const fitsFrom = zoomWhereInstancesFit(curveLength, count, nameWidthPx, gapPixels, MAX_ZOOM);
        if (fitsFrom === null || fitsFrom >= takenFrom) {
            continue;
        }
        // 💣 PASST HEISST AUCH: KNICKT NICHT ZU STARK. Die Länge allein versprach Platz, den MapLibre
        // dann verweigerte — ein Name auf einem Bogen wird still verworfen. Ist auf `fitsFrom` keine
        // ruhige Stelle zu finden, wird die nächste Stufe versucht: dort ist der Name auf der Karte
        // kürzer und passt eher auf ein gerades Stück. Findet sich bis zum Rand des Bandes nichts,
        // bekommt diese Instanzzahl keinen Lauf.
        let gefunden: Point[][] | null = null;
        let abStufe = fitsFrom;
        for (let zoom = fitsFrom; zoom < takenFrom && gefunden === null; zoom += 1) {
            const pieces =
                count === 1 ? [[...points]] : splitIntoInstances(points, count, gapPixels * mapUnitsPerPixel(zoom));
            // Eine einzelne Instanz nutzt das ganze Teilstueck - splitIntoInstances braucht es nicht.
            if (pieces.length !== count) {
                continue;
            }
            // 🪤 Die ruhigste Stelle, aber NICHT geglättet. `calmestWindowStart` schneidet nur aus
            // - es verändert keinen Punkt. Genau deshalb ist es hier verwendbar und `calmToChord`
            // nicht.
            const windows = pieces.map((piece) => {
                const laenge = nameWidthPx * mapUnitsPerPixel(zoom);
                const start = calmestWindowStart(piece, laenge, undefined, (window) =>
                    runFitsAngle(window, nameWidthPx, zoom),
                );
                if (start === null) {
                    return [];
                }
                // ⭐ Der AUSWEICHRAUM: das ruhige Fenster wird nach beiden Seiten gleich weit
                // verlängert, soweit die Linie reicht. GLEICH weit, weil die Kachel den bevorzugten
                // Kandidaten in die MITTE des Laufs setzt — eine einseitige Verlängerung verschöbe
                // ihn von der ruhigen Stelle weg.
                const gesamt = lengthOf(piece);
                const rand = Math.min(SLIDE_SHARE * laenge, start, gesamt - start - laenge);
                return sliceByLength(piece, start - Math.max(0, rand), start + laenge + Math.max(0, rand));
            });
            if (windows.every((window) => window.length >= 2)) {
                gefunden = windows;
                abStufe = zoom;
            }
        }
        if (gefunden === null) {
            continue;
        }
        gefunden.forEach((window, instance) => {
            runs.push({
                part,
                instance,
                instanceCount: count,
                runMinZoom: abStufe,
                runMaxZoom: takenFrom - 1,
                nameWidthPx,
                points: window,
            });
        });
        takenFrom = abStufe;
        if (abStufe === 0) {
            break;
        }
    }
    return runs;
}

export interface DeriveReport {
    chains: number;
    parts: number;
    runs: number;
    skippedTooShort: number;
}

/** Eine Kette: alle aktiven Abschnitte mit Namen auf der Karte, gleichem Namen und gleicher Art (Migration 0022). */
export interface PathChainKey {
    readonly name: string;
    readonly subtype: string;
}

interface ChainRow {
    name: string;
    subtype: string;
    geojson: string;
    fingerprint: string;
    /** Alle Abschnitte der Kette sind Bäche. */
    alle_bach: boolean;
    /** Die Bachabschnitte einer gemischten Kette; sonst `null`. */
    bach_geojson: string | null;
}

/**
 * Die Ketten, wie die Läufe sie brauchen. 🔴 AUS DER GEZEICHNETEN KURVE, nicht aus der rohen Geometrie (Betreiberauftrag 2026-09-22):
 * Die sichtbare Linie kommt aus `path_visual`; läge der Name auf `path.geom`, rutschte er an jeder Kurve neben die Straße - sichtbar
 * genau dort, wo die Glättung am meisten tut.
 *
 * 🪤 `COALESCE`, kein harter JOIN: fehlt die Kurve (Ableitung noch nicht gelaufen), entsteht der Lauf auf der Rohgeometrie statt gar
 * nicht. `verify:path-runs` meldet den Fall. Geometrie im KARTENRAUM - die Renderprojektion entsteht erst in der Kachelfunktion.
 */
function leseKetten(sql: Queryable, mapDomainId: string, nur?: readonly PathChainKey[]) {
    const auswahl =
        nur === undefined
            ? sql``
            : sql`AND (p.name, p.subtype) IN (SELECT k.name, k.subtype FROM jsonb_to_recordset(${sql.json(
                  nur.map((k) => ({ name: k.name, subtype: k.subtype })) as never,
              )}::jsonb) AS k(name text, subtype text))`;
    return sql<ChainRow[]>`
        SELECT
            p.name,
            p.subtype,
            ST_AsGeoJSON(ST_LineMerge(ST_Collect(COALESCE(v.geom, p.geom))), 15) AS geojson,
            -- Der Bach gehört zur Herkunft des Laufs: Wird ein Abschnitt zum Bach, ist der Lauf ein anderer.
            string_agg(p.public_id::text || CASE WHEN p.is_bach THEN ':bach' ELSE '' END, ',' ORDER BY p.public_id) AS fingerprint,
            bool_and(p.is_bach) AS alle_bach,
            -- Nur eine gemischte Kette braucht ihre Bachlinie; ganz Bach oder ganz Fluss entscheidet ohne Geometrie.
            CASE
                WHEN bool_or(p.is_bach) AND NOT bool_and(p.is_bach)
                THEN ST_AsGeoJSON(ST_Collect(COALESCE(v.geom, p.geom)) FILTER (WHERE p.is_bach), 15)
            END AS bach_geojson
        FROM path p
        LEFT JOIN path_visual v ON v.path_id = p.id
        WHERE p.is_active AND p.label_visible AND p.map_domain_id = ${mapDomainId}
          ${auswahl}
        GROUP BY p.name, p.subtype
    `;
}

/** Die Linien einer GeoJSON-Geometrie (LineString, MultiLineString, GeometryCollection), leer ohne. */
function linienAus(geojson: string | null): Point[][] {
    if (geojson === null) return [];
    const linien: Point[][] = [];
    const sammle = (g: { type: string; coordinates?: unknown; geometries?: unknown[] }): void => {
        if (g.type === "LineString")
            linien.push((g.coordinates as number[][]).map(([x, y]) => ({ x: x as number, y: y as number })));
        else if (g.type === "MultiLineString")
            for (const l of g.coordinates as number[][][])
                linien.push(l.map(([x, y]) => ({ x: x as number, y: y as number })));
        else if (g.type === "GeometryCollection") for (const teil of (g.geometries ?? []) as never[]) sammle(teil);
    };
    sammle(JSON.parse(geojson) as { type: string });
    return linien;
}

/** Die Läufe einer Kette rechnen und ablegen; zählt in `report`. */
async function schreibeKette(
    transaction: Queryable,
    mapDomainId: string,
    chain: ChainRow,
    report: DeriveReport,
): Promise<void> {
    // Ohne Namen kein Lauf (OPS-000098, Production-Auftrag 8104): Ein leerer Name hat die Breite 0, und `name_width_px > 0` wies den Lauf ab;
    // die Kette scheiterte, statt leer zu enden. Gilt für den vollen Lauf wie für `path_label_runs` einer Kette.
    if (chain.name.trim() === "") return;
    report.chains += 1;
    const geometry = JSON.parse(chain.geojson) as { type: string; coordinates: number[][] | number[][][] };
    const parts: Point[][] =
        geometry.type === "LineString"
            ? [(geometry.coordinates as number[][]).map(([x, y]) => ({ x: x as number, y: y as number }))]
            : (geometry.coordinates as number[][][]).map((line) =>
                  line.map(([x, y]) => ({ x: x as number, y: y as number })),
              );

    const bachLinien = linienAus(chain.bach_geojson);
    const nameWidthPx = requiredRunLength(FACULTY_GLYPHIC_METRICS, chain.name, {
        size: LABEL_SIZE,
        letterSpacing: 0,
    });
    const fingerprint = fingerprintOf(`${chain.fingerprint}|${ALGORITHM_VERSION}`);

    for (const [part, points] of parts.entries()) {
        report.parts += 1;
        const runs = runsForPart(points, nameWidthPx, part);
        if (runs.length === 0) {
            report.skippedTooShort += 1;
            continue;
        }
        for (const run of runs) {
            const line = `LINESTRING(${run.points.map((p) => `${String(p.x)} ${String(p.y)}`).join(",")})`;
            await transaction`
                INSERT INTO path_label_run (
                    name, subtype, map_domain_id, part, instance, instance_count,
                    run_min_zoom, run_max_zoom, name_width_px, geom,
                    source_fingerprint, algorithm_version, is_bach
                ) VALUES (
                    ${chain.name}, ${chain.subtype}, ${mapDomainId}, ${run.part}, ${run.instance},
                    ${run.instanceCount}, ${run.runMinZoom}, ${run.runMaxZoom}, ${run.nameWidthPx},
                    ST_SetSRID(ST_GeomFromText(${line}), 0),
                    ${fingerprint}, ${ALGORITHM_VERSION}, ${chain.alle_bach || laufAufBach(run.points, bachLinien)}
                )
            `;
            report.runs += 1;
        }
    }
}

export async function derivePathRuns(database: Database, mapDomainId = "aventuria"): Promise<DeriveReport> {
    const report: DeriveReport = { chains: 0, parts: 0, runs: 0, skippedTooShort: 0 };
    const chains = await leseKetten(database, mapDomainId);
    await database.begin(async (transaction) => {
        await transaction`DELETE FROM path_label_run WHERE map_domain_id = ${mapDomainId}`;
        for (const chain of chains) await schreibeKette(transaction, mapDomainId, chain, report);
    });
    return report;
}

/**
 * Nur die Läufe dieser Ketten (`path_label_runs`, WI-0177; nach jeder Wege-Operation des Editors): dieselbe Rechnung wie der volle
 * Lauf, in EINER Transaktion. Eine Kette ohne aktive Abschnitte mit Namen auf der Karte (umbenannt, gelöscht, „Name auf der Karte“
 * aus) verliert ihre Läufe und bekommt keine neuen.
 */
export async function derivePathRunsFor(
    database: Database,
    mapDomainId: string,
    ketten: readonly PathChainKey[],
): Promise<DeriveReport> {
    const report: DeriveReport = { chains: 0, parts: 0, runs: 0, skippedTooShort: 0 };
    if (ketten.length === 0) return report;
    await database.begin(async (transaction) => {
        for (const kette of ketten)
            await transaction`
                DELETE FROM path_label_run
                 WHERE map_domain_id = ${mapDomainId} AND name = ${kette.name} AND subtype = ${kette.subtype}
            `;
        for (const chain of await leseKetten(transaction, mapDomainId, ketten))
            await schreibeKette(transaction, mapDomainId, chain, report);
    });
    return report;
}
