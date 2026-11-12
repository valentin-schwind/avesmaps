import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import type { RunCheck, RunReport } from "./verify-path-runs.ts";

/**
 * Die Zusicherungen über die gezeichnete Wegkurve (WI-0010, Migration 0024).
 *
 * 🔴 Die wichtigste steht zuerst: die Kurve bewegt Anfang und Ende NICHT. Daran hängt später die
 * Topologie — ein verschobener Endpunkt ist ein anderer Knoten, und die Straße endet woanders als
 * die Kreuzung liegt.
 */

const SAMPLE = 5;

export async function verifyPathVisuals(database: Database, mapDomainId = "aventuria"): Promise<RunReport> {
    const checks: RunCheck[] = [];

    // 1. endpunkte_unveraendert
    //
    // 💣 EXAKT, nicht „nah dran". Am 2026-09-22 stimmten hier 6402 von 6983 — die Ableitung las
    // `ST_AsGeoJSON` ohne zweites Argument und bekam auf neun Stellen gerundete Koordinaten.
    // Für die Darstellung war das unsichtbar; für eine spätere Topologie wären es andere Knoten
    // gewesen. Deshalb ST_Equals und keine Toleranz.
    const versetzt = await database<{ name: string; seite: string }[]>`
        SELECT p.name, 'Start' AS seite
        FROM path p JOIN path_visual v ON v.path_id = p.id
        WHERE p.map_domain_id = ${mapDomainId} AND NOT ST_Equals(ST_StartPoint(v.geom), ST_StartPoint(p.geom))
        UNION ALL
        SELECT p.name, 'Ende'
        FROM path p JOIN path_visual v ON v.path_id = p.id
        WHERE p.map_domain_id = ${mapDomainId} AND NOT ST_Equals(ST_EndPoint(v.geom), ST_EndPoint(p.geom))
    `;
    checks.push({
        name: "endpunkte_unveraendert",
        passed: versetzt.length === 0,
        detail: `${String(versetzt.length)} Endpunkte weichen von der authoritativen Geometrie ab`,
        offenders: versetzt.slice(0, SAMPLE).map((row) => `${row.name} (${row.seite})`),
    });

    // 2. jede_linie_hat_ihre_kurve
    const [fehlend] = await database<{ n: number }[]>`
        SELECT count(*)::int AS n
        FROM path p
        WHERE p.is_active AND p.map_domain_id = ${mapDomainId}
          AND NOT EXISTS (SELECT 1 FROM path_visual v WHERE v.path_id = p.id)
    `;
    checks.push({
        name: "jede_linie_hat_ihre_kurve",
        passed: (fehlend?.n ?? 0) === 0,
        detail: `${String(fehlend?.n ?? 0)} aktive Wege ohne gezeichnete Kurve (sie fielen auf die rohe Geometrie zurück)`,
    });

    // 3. gerade_bleibt_gerade
    //
    // 🪤 Die Umkehrprobe zum Overshoot: wo nichts zu glätten ist, darf sich nichts bewegen. Fällt
    // sie, verbiegt die Kurve auch das, was schon richtig war.
    const geradeVerbogen = await database<{ name: string; abweichung: number }[]>`
        SELECT p.name, ST_HausdorffDistance(v.geom, p.geom) AS abweichung
        FROM path p JOIN path_visual v ON v.path_id = p.id
        WHERE p.map_domain_id = ${mapDomainId} AND ST_NPoints(p.geom) = 2
          AND ST_HausdorffDistance(v.geom, p.geom) > 1e-9
    `;
    checks.push({
        name: "gerade_bleibt_gerade",
        passed: geradeVerbogen.length === 0,
        detail: `${String(geradeVerbogen.length)} zweipunktige Wege wurden verbogen`,
        offenders: geradeVerbogen.slice(0, SAMPLE).map((row) => `${row.name}: ${String(row.abweichung)}`),
    });

    // 4. laenge_bleibt_plausibel
    //
    // Eine geglättete Kurve ist etwas länger als ihr Polygonzug - das ist die Rundung der Ecken.
    // Deutlich mehr hiesse, dass die Kurve ausschlägt statt zu runden.
    const [laenge] = await database<{ faktor: number; schlimmster: number }[]>`
        SELECT
            sum(ST_Length(v.geom)) / NULLIF(sum(ST_Length(p.geom)), 0) AS faktor,
            max(ST_Length(v.geom) / NULLIF(ST_Length(p.geom), 0)) AS schlimmster
        FROM path p JOIN path_visual v ON v.path_id = p.id
        WHERE p.map_domain_id = ${mapDomainId}
    `;
    const faktor = laenge?.faktor ?? 0;
    checks.push({
        name: "laenge_bleibt_plausibel",
        passed: faktor >= 1 && faktor <= 1.05,
        detail: `Gesamtlänge ×${faktor.toFixed(4)}, schlimmster Einzelfall ×${(laenge?.schlimmster ?? 0).toFixed(3)}`,
    });

    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    return settleChecks("verify:path-visuals", checks);
}
