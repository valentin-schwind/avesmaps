import { createHash } from "node:crypto";
import { LEGACY_CATMULL, catmullRomLine, type CurvePoint } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { withZugSperre } from "./derive-lock.ts";

/**
 * Leitet die gezeichnete Wegkurve ab (WI-0010, Betreiberauftrag 2026-09-22).
 *
 * 🔴 EINE Implementierung, zwei Verbraucher: die sichtbare Linie (`path_render`) und die
 * Schriftläufe (`derive:path-runs`) lesen beide `path_visual`. Legacy hat denselben Satz gelernt
 * und schreibt ihn über seine Datei: „A second copy of these ~30 lines would be two curves free to
 * drift apart."
 *
 * 🪤 `path.geom` wird nicht angefasst. Routing und Topologie rechnen weiter auf der rohen
 * Geometrie; diese Tabelle ist Darstellung.
 *
 * Der Ortseditor (WI-0128 E10) leitet nach `place.move` die Kurven der mitgezogenen Wege mit DERSELBEN Funktion ab, in
 * derselben Transaktion (`derivePathVisualsFor`, EDIT-0001 §6.3): Die Linie stimmt sofort, ohne einen zweiten Rechenweg.
 */

/** Steigt, wenn sich die Glättung ändert — und entwertet alle Kurven. */
export const ALGORITHM_VERSION = `catmull-${String(LEGACY_CATMULL.samples)}-${String(LEGACY_CATMULL.tension)}`;

export interface VisualReport {
    wege: number;
    geschrieben: number;
    unveraendert: number;
    punkteVorher: number;
    punkteNachher: number;
}

interface Weg {
    id: number;
    geojson: string;
    fingerprint: string;
}

/** Schreibt die Kurve eines Wegs, nur wenn sie sich geändert hat; `true`, wenn geschrieben. */
async function writeVisual(transaction: Sql, weg: Weg, report: VisualReport): Promise<boolean> {
    report.wege += 1;
    const geometry = JSON.parse(weg.geojson) as { coordinates: number[][] };
    const punkte: CurvePoint[] = geometry.coordinates.map(([x, y]) => ({
        x: x as number,
        y: y as number,
    }));
    report.punkteVorher += punkte.length;

    const kurve = catmullRomLine(punkte);
    report.punkteNachher += kurve.length;

    const fingerprint = createHash("sha256")
        .update(`${weg.fingerprint}|${weg.geojson}|${ALGORITHM_VERSION}`)
        .digest("hex")
        .slice(0, 16);

    const linie = `LINESTRING(${kurve.map((p) => `${String(p.x)} ${String(p.y)}`).join(",")})`;
    const rows = await transaction<{ id: number }[]>`
        INSERT INTO path_visual (path_id, geom, source_fingerprint, algorithm_version)
        VALUES (${weg.id}, ST_SetSRID(ST_GeomFromText(${linie}), 0), ${fingerprint}, ${ALGORITHM_VERSION})
        ON CONFLICT (path_id) DO UPDATE SET
            geom = EXCLUDED.geom,
            source_fingerprint = EXCLUDED.source_fingerprint,
            algorithm_version = EXCLUDED.algorithm_version,
            derived_at = now()
        -- Nur wenn sich wirklich etwas geändert hat: „idempotent" heisst „tut nichts",
        -- nicht „endet gleich".
        WHERE path_visual.source_fingerprint IS DISTINCT FROM EXCLUDED.source_fingerprint
        RETURNING path_id AS id
    `;
    if (rows.length > 0) report.geschrieben += 1;
    else report.unveraendert += 1;
    return rows.length > 0;
}

const emptyReport = (): VisualReport => ({
    wege: 0,
    geschrieben: 0,
    unveraendert: 0,
    punkteVorher: 0,
    punkteNachher: 0,
});

/** Die Kurven genau dieser Wege, in der Transaktion des Aufrufers (`place.move`, WI-0128 E10). */
export async function derivePathVisualsFor(transaction: Sql, pathIds: readonly number[]): Promise<VisualReport> {
    const report = emptyReport();
    if (pathIds.length === 0) return report;
    const wege = await transaction<Weg[]>`
        SELECT p.id, ST_AsGeoJSON(p.geom, 15) AS geojson, p.public_id::text AS fingerprint
        FROM path p
        WHERE p.id = ANY(${pathIds as number[]}::bigint[])
    `;
    for (const weg of wege) await writeVisual(transaction, weg, report);
    return report;
}

export function derivePathVisuals(database: Database, mapDomainId = "aventuria"): Promise<VisualReport> {
    return withZugSperre(database, mapDomainId, "I6 Wegkurve", () => derivePathVisualsLocked(database, mapDomainId));
}

/** Der Körper von `derivePathVisuals`, unter der Sperre des Zugs. */
async function derivePathVisualsLocked(database: Database, mapDomainId = "aventuria"): Promise<VisualReport> {
    const report = emptyReport();

    const wege = await database<Weg[]>`
        -- 💣 ST_AsGeoJSON rundet OHNE zweites Argument auf neun Nachkommastellen. Gemessen am
        -- 2026-09-22: damit stimmten nur 6402 von 6983 Startpunkten exakt mit der Quelle überein,
        -- obwohl die Kurve ihre Endpunkte gar nicht bewegt - sie las bereits gerundete Werte.
        -- Ein Endpunkt, der in der letzten Stelle abweicht, ist für die Darstellung belanglos und
        -- für eine spätere Topologie ein anderer Knoten.
        SELECT p.id, ST_AsGeoJSON(p.geom, 15) AS geojson, p.public_id::text AS fingerprint
        FROM path p
        WHERE p.is_active AND p.map_domain_id = ${mapDomainId}
    `;

    await database.begin(async (transaction) => {
        for (const weg of wege) await writeVisual(transaction, weg, report);
    });

    return report;
}
