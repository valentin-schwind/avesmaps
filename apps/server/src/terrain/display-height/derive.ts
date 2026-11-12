import { AVENTURIA } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../../database.ts";
import { DEM_MAX_ZOOM, DEM_TILE_SIZE } from "../dem-tiles.ts";
import { FULL_SCOPE, type DeriveScope } from "../derive-scope.ts";
import { bandAreaQuery } from "./band-area.ts";
import { contourSet, displayHeightRevision, type ContourSet } from "./bands.ts";
import { CONTOUR_OPTIONS, pointCount, type ContourLine, type ContourOptions } from "./contours.ts";
import {
    DISPLAY_HEIGHT_GENERATOR,
    DISPLAY_HEIGHT_PARAMS,
    generateDisplayHeights,
    type DisplayHeightInput,
    type DisplayHeightParams,
} from "./generate.ts";
import { loadDisplayHeightInputs, type DisplayHeightInputs } from "./inputs.ts";
import { lineJson } from "./line-json.ts";
import { rebindDisplayHeight } from "./pointer.ts";
import { withDeriveLock } from "../../derive/derive-lock.ts";

/**
 * Domain-derived contours and bands (ADR-0016). The height field is an exact copy of the master;
 * only water/contour display smoothing follows. Contour chains and band rings cross tile boundaries,
 * so changed inputs rebuild the full product. Unchanged inputs do not publish again.
 * Martin caches the resulting vector tiles; restart/invalidate after a new revision.
 * Flat coordinate buffers, explicit collection and point-bounded insert batches limit memory.
 */

const runGc = (globalThis as { gc?: (options?: object) => void }).gc;
/**
 * Die gründliche Müllabfuhr (`last-resort`). Eine gewöhnliche gibt die Objekte frei, nicht aber den Speicher ihrer
 * ArrayBuffer (der geht erst mit der nächsten zurück) und nicht die junge Generation von V8: Die wächst beim Laden
 * der Geometrien je nach Lauf auf 64 oder 128 MB und bleibt so, in jeder folgenden Phase. Gemessen: rund 190 MB
 * weniger Spitze, 30 ms je Aufruf.
 */
const collectGarbage = (): void => {
    try {
        runGc?.({ type: "major", execution: "sync", flavor: "last-resort" });
    } catch {
        // Eine Node-Fassung ohne diese Wahl: zweimal gewöhnlich, das gibt wenigstens die Felder frei.
        runGc?.();
        runGc?.();
    }
};

/**
 * Wie viele Linien je Einfügung (eine Anweisung, viele Zeilen), und ab wie vielen Stützpunkten sie voll ist: Das
 * GeoJSON einer Einfügung liegt beim Senden mehrfach im Speicher (Text, Feldliteral, Puffer); 500 Linien der tiefen
 * Höhen sind über 30 MB Text und kosteten rund 200 MB Spitze. Eine einzelne größere Linie geht allein.
 */
const INSERT_BATCH = 500;
const INSERT_POINTS = 100_000;
/**
 * Höchstens so viele Stützpunkte je Stück einer Stufe (ST_Subdivide): Eine Kachel liest nur ihre Stücke, nie den
 * ganzen Kontinent. Die Nähte liegen unter der Farbe derselben Stufe.
 */
const BAND_PIECE_VERTICES = 512;
/** Das Wasser zum Abschneiden in Stücken dieser Größe: eine Linie liest nur die Stücke an ihrem Weg. */
const WATER_PIECE_VERTICES = 256;
/** Kürzere Reste einer abgeschnittenen Linie fallen weg (E, eine Zelle der Anzeigehöhen). */
export const MIN_PIECE_LENGTH = 0.25;

const mb = (bytes: number): string => (bytes / 1048576).toFixed(0);

/** RSS jetzt, Spitze bisher, Heap und ArrayBuffer (nach der Müllabfuhr): der Speicher je Phase (WI-0055, I13). */
function memoryNote(): string {
    const usage = process.memoryUsage();
    return `RSS ${mb(usage.rss)} MB, Spitze ${mb(process.resourceUsage().maxRSS * 1024)} MB, Heap ${mb(usage.heapUsed)} MB, Puffer ${mb(usage.arrayBuffers)} MB`;
}

/** Warum ein übergebener Bereich die Rechnung nicht beschränkt (siehe Kopfkommentar). */
const DISPLAY_HEIGHT_FALLBACK =
    "Domain-Höhenlinien und Stufenringe überschreiten Kachelgrenzen: bei geänderten Eingaben rechnet die Ableitung voll.";

export interface DeriveDisplayHeightOptions {
    mapDomainId?: string;
    /** Worauf sich der Lauf bezieht (WI-0059); die Rechnung ist davon unabhängig, siehe oben. Vorgabe: alles. */
    scope?: DeriveScope;
    force?: boolean;
    dryRun?: boolean;
    params?: Readonly<DisplayHeightParams>;
    contours?: Readonly<ContourOptions>;
    /** Beim Aufräumen nur die aktuelle Revision behalten (lokal, das npm-Skript). */
    onlyCurrent?: boolean;
    onProgress?: (message: string) => void;
}

export interface DeriveDisplayHeightReport {
    fingerprint: string;
    demRevision: string;
    reliefRevision: string;
    computed: boolean;
    revision: string;
    revisionChanged: boolean;
    contours: number;
    contourPoints: number;
    bandRings: number;
    bandPieces: number;
    /** Der Auftrag, mit dem gerechnet wurde (WI-0059). */
    scope: DeriveScope;
    /** `full`: Eingaben geändert, alles gerechnet; `unchanged`: Eingaben gleich, nichts gerechnet. */
    mode: "full" | "unchanged";
    /** Der Grund, wenn ein Bereich übergeben wurde und trotzdem voll gerechnet werden musste; sonst `null`. */
    fallback: string | null;
    removedRevisions: string[];
    ms: number;
}

export async function deriveDisplayHeights(
    database: Database,
    options: DeriveDisplayHeightOptions = {},
): Promise<DeriveDisplayHeightReport> {
    // Eine Ableitung des Geländes zur Zeit, für jeden Aufrufer (derive/derive-lock.ts, Koordination 2026-09-29).
    return withDeriveLock(database, options.mapDomainId ?? AVENTURIA.mapDomain, "derive:display-heights", () =>
        runDeriveDisplayHeights(database, options),
    );
}

/**
 * Die Anzeigehöhen ohne eigene Sperre: für den Job `display_heights` der Queue (WI-0125), dessen Worker die geteilte Sperre der Domäne
 * hält. Rechnet wie `deriveDisplayHeights` nur bei geänderten Eingaben (dem Gelände, an das sie gebunden sind).
 */
export function deriveDisplayHeightsWithinLock(
    database: Database,
    options: DeriveDisplayHeightOptions = {},
): Promise<DeriveDisplayHeightReport> {
    return runDeriveDisplayHeights(database, options);
}

async function runDeriveDisplayHeights(
    database: Database,
    options: DeriveDisplayHeightOptions,
): Promise<DeriveDisplayHeightReport> {
    const started = Date.now();
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const params = options.params ?? DISPLAY_HEIGHT_PARAMS;
    const contourOptions = options.contours ?? CONTOUR_OPTIONS;
    const progress = options.onProgress ?? (() => undefined);
    const phase = (name: string): void => {
        collectGarbage();
        progress(`${name} (${memoryNote()})`);
    };

    // `let`: Die Eingaben (das Domain-Gelände) werden nach dem Bau des Feldes freigegeben, vor der Linienrechnung
    // und dem Schreiben mit seinen Puffern.
    let loaded: DisplayHeightInputs | undefined = await loadDisplayHeightInputs(
        database,
        mapDomainId,
        params,
        contourOptions,
    );
    const { demRevision, reliefRevision, fingerprint } = loaded;
    phase("Eingaben geladen");
    const [current] = await database<
        { revision: string; fingerprint: string; dem_revision: string; relief_revision: string }[]
    >`
        SELECT revision, fingerprint, dem_revision, relief_revision
        FROM terrain_display_height WHERE map_domain_id = ${mapDomainId} AND is_current
    `;
    const report: DeriveDisplayHeightReport = {
        fingerprint,
        demRevision,
        reliefRevision,
        computed: false,
        revision: current?.revision ?? "",
        revisionChanged: false,
        contours: 0,
        contourPoints: 0,
        bandRings: 0,
        bandPieces: 0,
        scope: options.scope ?? FULL_SCOPE,
        mode: "unchanged",
        fallback: null,
        removedRevisions: [],
        ms: 0,
    };
    progress(`Domain-DEM ${demRevision}`);

    if (current && current.fingerprint === fingerprint && options.force !== true && options.dryRun !== true) {
        progress(`Eingaben unverändert, Revision ${current.revision} bleibt`);
        // Ein Stand vor `5210a17c` schrieb bei gleicher Revision nur den Fingerabdruck (Stage 2026-10-04): Dann
        // stimmt der Fingerabdruck, aber der Zeiger hängt am alten Gelände. Ohne Rechnung neu binden.
        if (current.dem_revision !== demRevision || current.relief_revision !== reliefRevision) {
            await rebindDisplayHeight(database, current.revision, { fingerprint, demRevision, reliefRevision });
            progress(`Zeiger an Gelände ${demRevision} neu gebunden`);
        }
    } else {
        const n = DEM_TILE_SIZE << DEM_MAX_ZOOM;
        // Die Eingaben gehen an `linesOf` und sind danach frei: Das Domain-Raster (134 MB bei 8k) wird nur für das
        // Feld gelesen und lag bisher während der ganzen Linienrechnung daneben (Spitze 861 → rund 600 MB).
        const set = linesOf(
            () => {
                const { input } = loaded as DisplayHeightInputs;
                loaded = undefined;
                return input;
            },
            n,
            params,
            contourOptions,
            phase,
        );
        phase("Linien und Stufen gezogen");
        const revision = displayHeightRevision(set);
        report.computed = true;
        report.mode = "full";
        if (report.scope.kind !== "full") report.fallback = DISPLAY_HEIGHT_FALLBACK;
        report.revision = revision;
        report.contours = set.lines.length;
        report.contourPoints = set.lines.reduce((sum, line) => sum + pointCount(line), 0);
        report.bandRings = set.bands.reduce((sum, band) => sum + band.rings.length, 0);
        if (options.dryRun !== true) {
            await publish(
                database,
                mapDomainId,
                { revision, fingerprint, demRevision, reliefRevision, params, set },
                report,
                phase,
            );
        }
    }

    if (options.dryRun !== true) {
        report.removedRevisions = await pruneDisplayHeights(database, mapDomainId, options.onlyCurrent === true);
    }
    report.ms = Date.now() - started;
    return report;
}

/**
 * Feld und Linien; das Feld (268 MB bei 8k) lebt nur hier drin und ist danach frei, die Eingaben schon nach dem Feld
 * (`takeInput` gibt sie her und lässt den Aufrufer sie vergessen).
 */
function linesOf(
    takeInput: () => DisplayHeightInput,
    n: number,
    params: Readonly<DisplayHeightParams>,
    contourOptions: Readonly<ContourOptions>,
    phase: (name: string) => void,
): ContourSet {
    const { field, classes } = generateDisplayHeights(takeInput(), n, params, phase);
    return contourSet(field, classes, n, contourOptions, phase);
}

/**
 * Aufräumen bei JEDEM Lauf (wie das Relief, `handovers/2026-09-28-stage-ohne-ballast.md`): Stage hält
 * die aktuelle und die zuletzt abgelöste einen Tag lang, lokal (`onlyCurrent`) nur die aktuelle.
 * Linien und Stufen gehen per `ON DELETE CASCADE` mit.
 */
export async function pruneDisplayHeights(
    database: Queryable,
    mapDomainId: string,
    onlyCurrent: boolean,
): Promise<string[]> {
    const rows = await database<{ revision: string }[]>`
        DELETE FROM terrain_display_height
        WHERE map_domain_id = ${mapDomainId} AND NOT is_current
          AND EXISTS (SELECT 1 FROM terrain_display_height WHERE map_domain_id = ${mapDomainId} AND is_current)
          AND (
              ${onlyCurrent}
              OR superseded_at < now() - interval '1 day'
              OR revision IS DISTINCT FROM (
                  SELECT revision FROM terrain_display_height
                  WHERE map_domain_id = ${mapDomainId} AND NOT is_current
                  ORDER BY superseded_at DESC NULLS LAST, revision LIMIT 1
              )
          )
        RETURNING revision
    `;
    return rows.map((row) => row.revision).sort();
}

/** Das Ende der Einfügung, die bei `start` beginnt: INSERT_BATCH Linien oder INSERT_POINTS Stützpunkte, je nachdem. */
function batchEnd(lines: readonly ContourLine[], start: number): number {
    let end = start;
    let points = 0;
    // Eine Linie geht immer mit, auch wenn sie allein über der Grenze liegt.
    while (end < lines.length && end - start < INSERT_BATCH && (end === start || points < INSERT_POINTS)) {
        points += pointCount(lines[end] as ContourLine);
        end += 1;
    }
    return end;
}

async function publish(
    database: Database,
    mapDomainId: string,
    out: {
        revision: string;
        fingerprint: string;
        demRevision: string;
        reliefRevision: string;
        params: Readonly<DisplayHeightParams>;
        set: ContourSet;
    },
    report: DeriveDisplayHeightReport,
    phase: (name: string) => void,
): Promise<void> {
    const extent = AVENTURIA.coordinateSpace.bounds;
    await database.begin(async (transaction) => {
        const [current] = await transaction<{ revision: string }[]>`
            SELECT revision FROM terrain_display_height WHERE map_domain_id = ${mapDomainId} AND is_current
        `;
        if (current?.revision === out.revision) {
            await rebindDisplayHeight(transaction, out.revision, out);
            return;
        }
        report.revisionChanged = true;
        const [existing] = await transaction<{ revision: string }[]>`
            SELECT revision FROM terrain_display_height WHERE revision = ${out.revision}
        `;
        if (existing) {
            await rebindDisplayHeight(transaction, out.revision, out);
        } else {
            await transaction`
                INSERT INTO terrain_display_height (
                    revision, map_domain_id, fingerprint, dem_revision, relief_revision, generator_version, params,
                    contours, contour_points, band_pieces
                ) VALUES (
                    ${out.revision}, ${mapDomainId}, ${out.fingerprint}, ${out.demRevision}, ${out.reliefRevision},
                    ${DISPLAY_HEIGHT_GENERATOR}, ${transaction.json({ ...out.params })}, ${report.contours},
                    ${report.contourPoints}, 0
                )
            `;
            // Das Wasser, wie die Karte es zeigt (`terrain_water_smooth`, Migration 0053), in Stücken: Keine Linie
            // und keine Zahl steht im See oder im Meer (Betreiber 2026-09-28: „kann man verhindern dass die linien
            // darüberliegen?“). Die Anzeigehöhen zeichnen das Wasser auf 0,25 E; die Linie am Seespiegel läuft
            // deshalb teils über die Fläche, und genau dieses Stück fällt hier weg.
            await transaction`
                CREATE TEMP TABLE display_height_water ON COMMIT DROP AS
                WITH islands AS MATERIALIZED (
                    SELECT ST_Union(ST_CollectionExtract(ST_MakeValid(a.geom,'method=structure'),3)) AS geom
                    FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
                    WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
                        AND r.region_layer = 'topographie' AND r.region_type = 'insel'
                )
                SELECT piece.geom FROM (
                    SELECT (ST_Dump(ST_Subdivide(CASE WHEN islands.geom IS NULL THEN ST_MakeValid(terrain_water_smooth(a.geom))
                        ELSE ST_Difference(ST_MakeValid(terrain_water_smooth(a.geom)), islands.geom) END, ${WATER_PIECE_VERTICES}))).geom AS geom
                    FROM region_area a
                    JOIN region r ON r.id = a.region_id
                    CROSS JOIN islands
                    WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND r.is_active AND r.region_type IN ('see', 'meer')
                ) piece
                WHERE ST_Dimension(piece.geom) = 2
            `;
            await transaction`CREATE INDEX ON display_height_water USING gist (geom)`;
            // Ohne Statistik schätzt der Planer die frische Tabelle leer und liest sie je Linie ganz.
            await transaction`ANALYZE display_height_water`;
            phase("Wasser bereit");
            for (let start = 0; start < out.set.lines.length; start = batchEnd(out.set.lines, start)) {
                const batch = out.set.lines.slice(start, batchEnd(out.set.lines, start));
                // Die Kachelgeometrie wird beim Schreiben einmal gerechnet und indiziert: Martin fragt je Kachel
                // mit dem Kachelrahmen, und eine Sicht, die jede Linie erst umrechnet, könnte keinen Index nutzen.
                // Eine Linie, die Wasser quert, zerfällt in Stücke; Krümel unter einer Zelle fallen weg.
                // 🪤 `MATERIALIZED`: Sonst setzt der Planer das Lesen des GeoJSON in jede Prüfung ein und liest
                // jede Linie fünfmal (gemessen: Ableitung 79 statt 17 s).
                await transaction`
                    WITH line AS MATERIALIZED (
                        SELECT e AS ele, l AS level, d = 1 AS detail,
                               ST_SetSRID(ST_GeomFromGeoJSON(g), 0)::geometry(LineString, 0) AS geom
                        FROM unnest(${batch.map((line) => line.ele)}::integer[],
                                    ${batch.map((line) => line.level)}::smallint[],
                                    ${batch.map((line) => (line.detail === true ? 1 : 0))}::smallint[],
                                    ${batch.map(lineJson)}::text[]) AS input(e, l, d, g)
                    )
                    INSERT INTO terrain_contour (revision, ele, level, detail, geom, render_geom)
                    SELECT ${out.revision}, piece.ele, piece.level, piece.detail, piece.geom,
                           map_domain_to_render(${mapDomainId}, piece.geom)::geometry(LineString, 3857)
                    FROM (
                        SELECT line.ele, line.level, line.detail,
                               (ST_Dump(ST_LineMerge(ST_CollectionExtract(
                                   CASE WHEN water.geom IS NULL THEN line.geom ELSE ST_Difference(line.geom, water.geom) END,
                                   2
                               )))).geom AS geom
                        FROM line
                        LEFT JOIN LATERAL (
                            SELECT ST_Union(w.geom) AS geom FROM display_height_water w
                            WHERE w.geom && line.geom AND ST_Intersects(w.geom, line.geom)
                        ) water ON TRUE
                    ) piece
                    WHERE GeometryType(piece.geom) = 'LINESTRING' AND ST_Length(piece.geom) >= ${MIN_PIECE_LENGTH}
                `;
            }
            phase("Linien geschrieben");
            const [kept] = await transaction<{ lines: number; points: number }[]>`
                SELECT count(*)::int AS lines, coalesce(sum(ST_NPoints(geom)), 0)::int AS points
                FROM terrain_contour WHERE revision = ${out.revision}
            `;
            report.contours = kept?.lines ?? 0;
            report.contourPoints = kept?.points ?? 0;
            await transaction`
                UPDATE terrain_display_height SET contours = ${report.contours}, contour_points = ${report.contourPoints}
                WHERE revision = ${out.revision}
            `;
            // Die Stufen: Stufe 0 ist die ganze Karte, jede weitere die Fläche innerhalb ihrer Ringe
            // (Gerade-ungerade-Regel: ein Ring in einem Ring ist ein Loch). Dieselben Ringe wie die Linien.
            for (const band of out.set.bands) {
                if (band.step !== 0 && band.rings.length === 0) continue;
                const area =
                    band.step === 0
                        ? transaction`ST_MakeEnvelope(${extent.minX}, ${extent.minY}, ${extent.maxX}, ${extent.maxY}, 0)`
                        : bandAreaQuery(transaction, band.rings);
                await transaction`
                    INSERT INTO terrain_height_band (revision, step, geom, render_geom)
                    SELECT ${out.revision}, ${band.step}, piece.geom,
                           map_domain_to_render(${mapDomainId}, piece.geom)::geometry(Polygon, 3857)
                    FROM (
                        SELECT (ST_Dump(ST_Subdivide(${area}, ${BAND_PIECE_VERTICES}))).geom::geometry(Polygon, 0) AS geom
                    ) piece
                    WHERE NOT ST_IsEmpty(piece.geom)
                `;
            }
            phase("Stufen geschrieben");
            const [pieces] = await transaction<{ count: number }[]>`
                SELECT count(*)::int AS count FROM terrain_height_band WHERE revision = ${out.revision}
            `;
            report.bandPieces = pieces?.count ?? 0;
            await transaction`UPDATE terrain_display_height SET band_pieces = ${report.bandPieces} WHERE revision = ${out.revision}`;
        }
        await transaction`
            UPDATE terrain_display_height SET is_current = FALSE, superseded_at = now()
            WHERE map_domain_id = ${mapDomainId} AND is_current
        `;
        await transaction`
            UPDATE terrain_display_height SET is_current = TRUE, superseded_at = NULL WHERE revision = ${out.revision}
        `;
    });
}
