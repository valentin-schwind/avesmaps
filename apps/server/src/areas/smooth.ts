import { createFinding, type Finding } from "../findings.ts";
import type { Database, Queryable } from "../database.ts";
import { SMOOTH_NET_OPTIONS, smoothNet, type NetArea } from "@avesmaps3d/shared";
import { buildScope, membersSql, planRun } from "./smooth-scope.ts";
import { readSurfaceWkb, writeMultiPolygonWkb } from "./wkb.ts";

/**
 * Alle Flächen nahtlos geglättet (WI-0077, Betreiber 2026-10-04; vorher nur die Landflächen der Topographie, WI-0055), dazu
 * die Klimabänder mit geglätteten Übergängen.
 *
 * 🔴 Die Quelle bleibt unverändert: gelesen werden `region_area` und die Klimatafeln, geschrieben nur die abgeleiteten Tafeln
 * `region_area_smooth` und `climate_band_smooth` (Map Mutation Guard). Eine Fläche ohne frische Zeile zeigt die Renderansicht
 * eckig, bis die Ableitung gelaufen ist; eine Fläche, deren Zusammenbau ungültig oder zu klein wäre, behält ihre Ausgangsform
 * (`status fallback_*`, ein Befund, kein Abbruch).
 *
 * Das Netz rechnet `smoothNet` (TypeScript), die Datenbank liest die Flächen gültig gemacht ein (nur beim Lesen, mit
 * `ST_MakeValid(…, 'method=structure')`) und prüft das Ergebnis beim Schreiben.
 *
 * **Nur die Fläche und ihre Nachbarn** (`smooth-scope.ts`). Hat sich seit dem letzten Lauf nur wenig geändert (höchstens
 * `LOCAL_SEED_LIMIT` Flächen, gleiches Rezept), rechnet der Lauf nur die geänderten Flächen, ihre Nachbarn (Rand höchstens
 * `NEIGHBOUR_REACH` daneben, vorher wie nachher) und deren Nachbarn als Umfeld, und schreibt die ersten beiden. Dasselbe tut
 * `--areas <public_id,…>` für eine Fläche, die ein Editor gerade geändert hat. Das Ergebnis ist Punkt für Punkt das des vollen
 * Laufs (`land-smooth.test.ts`).
 *
 * 🪤 Martin cacht Kacheln: Nach jeder Ableitung, die gerechnet hat, Martin neu starten.
 */

/** Das Rezept des Netzes liegt seit WI-0178 L2 bei der Rechnung in `packages/shared` (`SMOOTH_NET_OPTIONS`). */
export { SMOOTH_NET_OPTIONS };

/**
 * Punkte höchstens so weit vom Rand der Kartendomäne bleiben fest, und der Rand bleibt gerade (eine Rasterzelle von Legacy:
 * Legacys Meere enden 0,062 E vor dem Rand).
 */
export const FRAME_MARGIN = 0.125;

/** Höchstens so viele Bytes WKB je Schreibbefehl. */
const WRITE_BATCH_BYTES = 4 * 1024 * 1024;

export interface ClimateSmoothReport {
    computed: boolean;
    recipe: string;
    bands: number;
    smoothed: number;
    fallbacks: number;
    /** Summe der Bandflächen in E²; die Karte hat 1024² = 1.048.576. */
    area: number | null;
    ms: number;
}

export interface LandSmoothReport {
    /** Hat der Lauf gerechnet? `false`: Die Eingaben waren seit der letzten Ableitung unverändert. */
    computed: boolean;
    recipe: string;
    /** `voll`: das ganze Netz; `lokal`: geänderte Flächen und ihre Nachbarn; `keine`: nichts zu tun. */
    mode: "voll" | "lokal" | "keine";
    /** Mit `nurLokal`: Der Plan verlangte das ganze Netz, und der Lauf hat es ausgelassen. */
    ausgelassen?: "voll";
    /** Flächen im Netz (alle aktiven). */
    areas: number;
    /** Davon geglättet (nach dem Lauf, über die ganze Kartendomäne); der Rest behielt seine Ausgangsform (`fallbacks`). */
    smoothed: number;
    /** Rückfälle nach Grund (`fallback_invalid`, `fallback_shrunk`, …), über die ganze Kartendomäne; leer, wenn keine. */
    fallbacks: Record<string, number>;
    /** Flächen, die dieser Lauf gerechnet hat (mit Umfeld), und Zeilen, die er geschrieben hat. */
    computedAreas: number;
    written: number;
    /** Ketten im gerechneten Netz, davon mit mindestens zwei Eigentümern, davon über mindestens zwei Ebenen. */
    edges: number;
    sharedEdges: number;
    crossLayerEdges: number;
    /** Gruppen fast gleicher Punkte, die zu einem wurden, und eingefügte Punkte (T-Stöße). */
    mergedPoints: number;
    insertedPoints: number;
    ms: number;
    /** Zeit je Schritt in Millisekunden. */
    phases: { name: string; ms: number }[];
    /** Die Klimabänder (nur in der Kartendomäne `aventuria`; sonst `undefined`). */
    climate?: ClimateSmoothReport | undefined;
}

export interface LandSmoothOptions {
    mapDomainId?: string;
    /** Rechnet das ganze Netz auch ohne Änderung der Eingaben. */
    force?: boolean;
    /**
     * Nur diese Flächen (`region_area.id`) und ihre Nachbarn neu glätten, auch ohne Änderung: die Funktion für einen Editor,
     * der eine Fläche geändert hat. Auch stillgelegte oder gelöschte Flächen: Ihre Nachbarn werden neu gerechnet.
     */
    areaIds?: readonly number[];
    /** Klimabänder mit ableiten; ohne Angabe nur in der Kartendomäne `aventuria` (die Klimatafeln kennen keine andere). */
    climate?: boolean;
    /**
     * Nie das ganze Netz: Verlangte der Plan es (zu viele veraltete Flächen, ein anderes Rezept, noch nichts geglättet), rechnet der
     * Lauf nichts und meldet `ausgelassen`. Für den Auftrag `land_smooth` nach einer Speicherung (WI-0178 B3; Claudio 2026-10-16:
     * „nur für die betroffene Region und ihre Nachbarn, nicht voll. Voll braucht `land_smooth` heute 400 MB.“). Das volle Netz rechnet
     * die Ableitung des Imports.
     */
    nurLokal?: boolean;
}

/** Leitet `region_area_smooth` (und in `aventuria` `climate_band_smooth`) ab. Ohne Änderung der Eingaben rechnet sie nichts. */
export async function deriveLandSmooth(database: Database, options: LandSmoothOptions = {}): Promise<LandSmoothReport> {
    const domain = options.mapDomainId ?? "aventuria";
    const started = performance.now();
    const phases: { name: string; ms: number }[] = [];
    let mark = started;
    const phase = (name: string): void => {
        const now = performance.now();
        phases.push({ name, ms: Math.round(now - mark) });
        mark = now;
    };
    return database.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext('avesmaps3d:region_area_smooth'), hashtext(${domain}))`;
        // Die ungültigen Legacy-Flächen melden sich bei jeder Prüfung mit einer NOTICE; hier sind sie erwartet.
        await tx`SELECT set_config('client_min_messages', 'warning', true)`;
        const [recipeRow] = await tx<{ recipe: string }[]>`SELECT region_area_smooth_recipe() AS recipe`;
        const recipe = recipeRow?.recipe ?? "";
        const geplant = await planRun(tx, domain, options);
        const ausgelassen = options.nurLokal === true && geplant.mode === "voll";
        const plan: typeof geplant = ausgelassen ? { mode: "keine", seeds: [] } : geplant;
        phase("Plan");

        let net = { chains: 0, sharedChains: 0, crossLayerChains: 0, mergedPoints: 0, insertedPoints: 0 };
        let computedAreas = 0;
        let written = 0;
        if (plan.mode !== "keine") {
            await buildScope(tx, domain, plan);
            await tx`DROP TABLE IF EXISTS ras2_in, ras2_out, ras2_final`;
            await tx`
                CREATE TEMP TABLE ras2_in ON COMMIT DROP AS
                SELECT a.id AS aid, a.updated_at, a.geom AS raw, s.writes, r.region_layer AS layer,
                       ST_Multi(ST_CollectionExtract(
                           CASE WHEN ST_IsValid(a.geom) THEN a.geom ELSE ST_MakeValid(a.geom, 'method=structure') END, 3)) AS g
                FROM ras2_scope s
                JOIN region_area a ON a.id = s.aid
                JOIN region r ON r.id = a.region_id
            `;
            phase("Umfang");
            const rows = await tx<{ aid: string; layer: string; writes: boolean; wkb: Buffer }[]>`
                SELECT aid::text, layer, writes, ST_AsBinary(g) AS wkb FROM ras2_in WHERE NOT ST_IsEmpty(g) ORDER BY aid
            `;
            const areas: NetArea[] = [];
            const writeIds = new Set<number>();
            for (const row of rows) {
                const id = Number(row.aid);
                areas.push({ id, layer: row.layer, polygons: readSurfaceWkb(row.wkb) });
                if (row.writes) writeIds.add(id);
            }
            rows.length = 0;
            computedAreas = areas.length;
            phase("Lesen");
            const [frame] = await tx<{ minX: number; minY: number; maxX: number; maxY: number }[]>`
                SELECT min_x AS "minX", min_y AS "minY", max_x AS "maxX", max_y AS "maxY" FROM map_domain WHERE id = ${domain}
            `;
            const result = smoothNet(
                areas,
                { ...SMOOTH_NET_OPTIONS, frame: frame ? { ...frame, margin: FRAME_MARGIN } : undefined },
                plan.mode === "voll" ? undefined : writeIds,
            );
            areas.length = 0;
            net = result.stats;
            phase("Netz");

            await tx`CREATE TEMP TABLE ras2_out (aid BIGINT PRIMARY KEY, wkb BYTEA NOT NULL) ON COMMIT DROP`;
            let batch: { aid: number; wkb: Buffer }[] = [];
            let bytes = 0;
            const flush = async (): Promise<void> => {
                if (batch.length === 0) return;
                await tx`INSERT INTO ras2_out ${tx(batch, "aid", "wkb")}`;
                batch = [];
                bytes = 0;
            };
            for (const [aid, shape] of result.shapes) {
                const wkb = writeMultiPolygonWkb(shape);
                batch.push({ aid, wkb });
                bytes += wkb.length;
                result.shapes.delete(aid);
                if (bytes >= WRITE_BATCH_BYTES) await flush();
            }
            await flush();
            phase("Uebertragen");

            // Prüfen und schreiben. Ein ungültiger Zusammenbau wird gültig gemacht; was danach ungültig bliebe oder weniger als
            // die Hälfte der Ausgangsfläche hätte, behält die Ausgangsform (Befund, kein Abbruch).
            await tx`
                CREATE TEMP TABLE ras2_final ON COMMIT DROP AS
                WITH o AS (
                    SELECT aid, CASE WHEN ST_IsValid(g) THEN g
                                     ELSE ST_Multi(ST_CollectionExtract(ST_MakeValid(g, 'method=structure'), 3)) END AS g
                    FROM (SELECT aid, ST_GeomFromWKB(wkb, 0) AS g FROM ras2_out) x
                )
                SELECT i.aid, i.updated_at,
                       CASE
                           WHEN ST_IsEmpty(i.g) THEN i.raw
                           WHEN o.aid IS NULL OR ST_IsEmpty(o.g) OR NOT ST_IsValid(o.g) OR ST_Area(o.g) < 0.5 * ST_Area(i.g) THEN i.g
                           ELSE o.g
                       END AS g,
                       CASE
                           WHEN ST_IsEmpty(i.g) THEN 'fallback_empty'
                           WHEN o.aid IS NULL OR ST_IsEmpty(o.g) THEN 'fallback_missing'
                           WHEN NOT ST_IsValid(o.g) THEN 'fallback_invalid'
                           WHEN ST_Area(o.g) < 0.5 * ST_Area(i.g) THEN 'fallback_shrunk'
                           ELSE 'smoothed'
                       END AS status
                FROM ras2_in i
                LEFT JOIN o ON o.aid = i.aid
                WHERE i.writes
            `;
            if (plan.mode === "voll") {
                await tx`
                    DELETE FROM region_area_smooth s USING region_area a
                    WHERE a.id = s.region_area_id AND a.map_domain_id = ${domain}
                `;
            } else {
                await tx`
                    DELETE FROM region_area_smooth
                    WHERE region_area_id IN (SELECT aid FROM ras2_final) OR region_area_id = ANY(${plan.seeds}::bigint[])
                `;
            }
            const inserted = await tx`
                INSERT INTO region_area_smooth (region_area_id, geom, render_geom, source_updated_at, recipe, status)
                SELECT aid, ST_SetSRID(g, 0), map_domain_to_render(${domain}, ST_SetSRID(g, 0)), updated_at,
                       region_area_smooth_recipe(), status
                FROM ras2_final
            `;
            written = inserted.count;
            phase("Schreiben");
        }

        const [counts] = await tx<{ areas: number; smoothed: number }[]>`
            SELECT (SELECT count(*)::int FROM (${membersSql(tx, domain)}) m) AS areas,
                   (SELECT count(*)::int FROM region_area_smooth s JOIN region_area a ON a.id = s.region_area_id
                    WHERE a.map_domain_id = ${domain} AND s.status = 'smoothed') AS smoothed
        `;
        const fallbackRows = await tx<{ status: string; n: number }[]>`
            SELECT s.status, count(*)::int AS n
            FROM region_area_smooth s JOIN region_area a ON a.id = s.region_area_id
            WHERE a.map_domain_id = ${domain} AND s.status <> 'smoothed'
            GROUP BY s.status ORDER BY s.status
        `;
        const climate =
            (options.climate ?? domain === "aventuria")
                ? await deriveClimateSmooth(tx, options.force === true)
                : undefined;
        phase("Klima");
        return {
            computed: plan.mode !== "keine",
            recipe,
            mode: plan.mode,
            areas: counts?.areas ?? 0,
            smoothed: counts?.smoothed ?? 0,
            fallbacks: Object.fromEntries(fallbackRows.map((row) => [row.status, row.n])),
            computedAreas,
            written,
            edges: net.chains,
            sharedEdges: net.sharedChains,
            crossLayerEdges: net.crossLayerChains,
            mergedPoints: net.mergedPoints,
            insertedPoints: net.insertedPoints,
            ms: Math.round(performance.now() - started),
            phases,
            climate,
            ...(ausgelassen ? { ausgelassen: "voll" as const } : {}),
        };
    });
}

/** Leitet `climate_band_smooth` ab (Migration 0072); ohne Änderung der Bänder rechnet sie nichts. */
export async function deriveClimateSmooth(database: Queryable, force = false): Promise<ClimateSmoothReport> {
    const [row] = await database<{ report: Partial<ClimateSmoothReport> }[]>`
        SELECT climate_band_smooth_derive(${force}) AS report
    `;
    const report = row?.report ?? {};
    return {
        computed: report.computed === true,
        recipe: report.recipe ?? "",
        bands: Number(report.bands ?? 0),
        smoothed: Number(report.smoothed ?? 0),
        fallbacks: Number(report.fallbacks ?? 0),
        area: report.area === undefined || report.area === null ? null : Number(report.area),
        ms: Number(report.ms ?? 0),
    };
}

/** Ob die Ableitung veraltet ist (eine Fläche ohne frische Zeile, eine Zeile ohne Fläche, ein anderes Rezept). */
export async function landSmoothStale(database: Queryable, mapDomainId = "aventuria"): Promise<boolean> {
    const [row] = await database<{ stale: boolean }[]>`SELECT region_area_smooth_is_stale(${mapDomainId}) AS stale`;
    return row?.stale === true;
}

/** Die Kennungen (`region_area.id`) zu öffentlichen IDs von Flächen; unbekannte fehlen in der Antwort. */
export async function areaIdsOf(
    database: Queryable,
    publicIds: readonly string[],
    mapDomainId = "aventuria",
): Promise<{ id: number; publicId: string }[]> {
    const rows = await database<{ id: string; public_id: string }[]>`
        SELECT id::text, public_id::text FROM region_area
        WHERE map_domain_id = ${mapDomainId} AND public_id = ANY(${[...publicIds]}::uuid[])
        ORDER BY public_id
    `;
    return rows.map((row) => ({ id: Number(row.id), publicId: row.public_id }));
}

/**
 * Ein Rückfall ist ein Befund, kein Abbruch (Betreiber 2026-10-03, AGENTS.md „Blockierende Prüfungen“): Die Fläche behält
 * ihre Ausgangsform und steht eckig in der Karte. Die betroffenen Flächen nennt die Abfrage `landSmoothFallbacks`. Ebenso ein
 * Klimaband, dessen geglättete Form ungültig wäre.
 */
export function landSmoothFindings(report: LandSmoothReport): Finding[] {
    const findings: Finding[] = [];
    const count = Object.values(report.fallbacks).reduce((sum, value) => sum + value, 0);
    if (count > 0) {
        findings.push(
            createFinding(
                "land_glaettung_rueckfall",
                `${String(count)} von ${String(report.areas)} Flaechen behielten ihre Ausgangsform (Zusammenbau ungueltig oder zu klein): ` +
                    Object.entries(report.fallbacks)
                        .map(([reason, n]) => `${reason} ${String(n)}`)
                        .join(", "),
                { areas: report.areas, fallbacks: count },
                [],
                count,
            ),
        );
    }
    if (report.climate && report.climate.fallbacks > 0) {
        findings.push(
            createFinding(
                "klima_glaettung_rueckfall",
                `${String(report.climate.fallbacks)} von ${String(report.climate.bands)} Klimabaendern behielten ihre Ausgangsform (geglaettete Form ungueltig)`,
                { bands: report.climate.bands, fallbacks: report.climate.fallbacks },
            ),
        );
    }
    return findings;
}

/** Die Flächen, die ihre Ausgangsform behielten, mit Grund: Tabelle, öffentliche ID (der Fläche), Name der Region. */
export async function landSmoothFallbacks(
    database: Queryable,
    mapDomainId = "aventuria",
): Promise<{ publicId: string; name: string; status: string }[]> {
    return [
        ...(await database<{ publicId: string; name: string; status: string }[]>`
            SELECT a.public_id::text AS "publicId", r.name, s.status
            FROM region_area_smooth s
            JOIN region_area a ON a.id = s.region_area_id
            JOIN region r ON r.id = a.region_id
            WHERE a.map_domain_id = ${mapDomainId} AND s.status <> 'smoothed'
            ORDER BY a.public_id
        `),
    ];
}
