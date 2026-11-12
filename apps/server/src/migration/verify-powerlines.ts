import { AVENTURIA } from "@avesmaps3d/shared";
import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import type { LegacyPayload } from "./paths.ts";
import { transformPowerlines, type TransformedPowerline } from "./powerlines.ts";

/**
 * Parität zwischen Snapshot und migrierten Kraftlinien (Contract `powerlines.yaml`, `validation`).
 *
 * 🔴 Die Prüfungen sind die Liste aus dem Contract, in derselben Reihenfolge und unter denselben
 * Namen. Eine Contract-Liste, die mehr behauptet als der Verifier ausführt, ist schlimmer als keine.
 *
 * 🪤 Geometrie wird EXAKT verglichen (`ST_OrderingEquals`), nicht mit Toleranz. Beim Wegeimport hat
 * genau eine exakte Prüfung gerundete Koordinaten gefunden, die jede Toleranz durchgelassen hätte
 * (WI-0010, `ST_AsGeoJSON` ohne zweites Argument).
 *
 * 🔴 Eine im Editor von der Karte genommene Linie (`off_map`, WI-0205 K10, Migration 0154) gehört nicht zum Erwartungswert: Der Zug
 * holt sie nicht zurück (`powerlines.ts`), also fehlt sie auf der Karte zu Recht. Der Prüfer nimmt sie aus dem Snapshot heraus und
 * nennt ihre Zahl in `kraftlinien_vollzaehlig`; ohne das würde der nächste Zug rot, sobald ein Editor eine Linie abnimmt.
 */

export interface ParityCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

export interface ParityReport {
    passed: boolean;
    sourceRef: string;
    checks: ParityCheck[];
}

interface TargetRow {
    public_id: string;
    name: string;
    label_visible: boolean;
    from_public_id: string;
    to_public_id: string;
    curve: number | null;
    valid: boolean;
    within: boolean;
    points: number;
    geometry_type: string;
    line_equal: boolean;
    drawn_equal: boolean;
}

interface EndRow {
    public_id: string;
    start_equal: boolean;
    end_distance: number;
    from_known: boolean;
    to_known: boolean;
}

const SAMPLE = 5;
/** Das Ende einer gebogenen Bahn ist `a + (b − a)·1` und kann um eine letzte Stelle abweichen. */
const END_TOLERANCE = 1e-9;

export async function verifyPowerlines(
    database: Database,
    payload: LegacyPayload,
    options: { mapDomainId?: string } = {},
): Promise<ParityReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const transformed = transformPowerlines(payload);
    const abgenommen = new Set(
        (
            await database<{ public_id: string }[]>`
                SELECT public_id::text FROM powerline
                 WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND NOT is_active AND off_map
            `
        ).map((row) => row.public_id),
    );
    const expected = transformed.powerlines.filter((line) => !abgenommen.has(line.publicId));
    const bounds = AVENTURIA.coordinateSpace.bounds;
    // 💣 Als jsonb-WERT übergeben, nicht vorher JSON.stringify: postgres.js kodiert einen Parameter vor
    // `::jsonb` selbst, und eine vorkodierte Zeichenkette käme als JSON-Zeichenkette an statt als Liste
    // (dieselbe Falle wie beim Saisonfenster der Wege, paths.ts).
    const soll = database.json(
        expected.map((line) => ({ public_id: line.publicId, line: line.geojson, drawn: line.drawnGeojson })),
    );

    const rows = await database<TargetRow[]>`
        SELECT p.public_id::text, p.name, p.label_visible, p.from_public_id::text, p.to_public_id::text,
               p.curve,
               ST_IsValid(p.geom) AND ST_IsValid(p.drawn_geom) AS valid,
               ST_Within(p.geom, ST_MakeEnvelope(${bounds.minX}, ${bounds.minY}, ${bounds.maxX}, ${bounds.maxY}, 0))
                   AND ST_Within(p.drawn_geom, ST_MakeEnvelope(${bounds.minX}, ${bounds.minY}, ${bounds.maxX}, ${bounds.maxY}, 0))
                   AS within,
               LEAST(ST_NPoints(p.geom), ST_NPoints(p.drawn_geom))::int AS points,
               GeometryType(p.drawn_geom) AS geometry_type,
               COALESCE(ST_OrderingEquals(p.geom, ST_SetSRID(ST_GeomFromGeoJSON(e.line), 0)), FALSE) AS line_equal,
               COALESCE(ST_OrderingEquals(p.drawn_geom, ST_SetSRID(ST_GeomFromGeoJSON(e.drawn), 0)), FALSE)
                   AS drawn_equal
        FROM powerline p
        LEFT JOIN jsonb_to_recordset(${soll}) AS e(public_id uuid, line text, drawn text)
            ON e.public_id = p.public_id
        WHERE p.map_domain_id = ${mapDomainId} AND p.source_system = 'legacy' AND p.is_active
    `;

    const byId = new Map(rows.map((row) => [row.public_id, row]));
    const checks: ParityCheck[] = [];
    const vergleiche = (name: string, regel: string, abweichend: (line: TransformedPowerline) => boolean): void => {
        const falsch = expected.filter((line) => {
            const row = byId.get(line.publicId);
            return !row || abweichend(line);
        });
        checks.push({
            name,
            passed: falsch.length === 0,
            detail: `${regel}; Abweichungen ${String(falsch.length)}`,
            offenders: falsch.slice(0, SAMPLE).map((line) => `${line.publicId} (${line.name})`),
        });
    };

    // 1. kraftlinien_vollzaehlig
    const missing = expected.filter((line) => !byId.has(line.publicId));
    const extra = rows.filter((row) => !expected.some((line) => line.publicId === row.public_id));
    checks.push({
        name: "kraftlinien_vollzaehlig",
        passed: missing.length === 0 && extra.length === 0 && rows.length === expected.length,
        detail: `Snapshot ${String(expected.length)}${abgenommen.size > 0 ? ` (ohne ${String(abgenommen.size)} von der Karte genommene)` : ""}, Datenbank ${String(rows.length)}; fehlend ${String(missing.length)}, zusätzlich ${String(extra.length)}`,
        offenders: [
            ...missing.map((line) => `fehlt: ${line.publicId}`),
            ...extra.map((row) => `zusätzlich: ${row.public_id}`),
        ].slice(0, SAMPLE),
    });

    // 2. identitaet_eindeutig
    checks.push({
        name: "identitaet_eindeutig",
        passed: byId.size === rows.length,
        detail: `${String(byId.size)} verschiedene public_id bei ${String(rows.length)} Zeilen`,
    });

    // 3. geometrie_gueltig
    const broken = rows.filter(
        (row) => !row.valid || !row.within || row.geometry_type !== "LINESTRING" || row.points < 2,
    );
    checks.push({
        name: "geometrie_gueltig",
        passed: broken.length === 0,
        detail: `${String(broken.length)} Linien mit ungültiger oder außerhalb liegender Geometrie (gespeichert oder gezeichnet)`,
        offenders: broken.slice(0, SAMPLE).map((row) => row.public_id),
    });

    // 4. linie_unveraendert — Legacys gespeicherte Linie, Punkt für Punkt.
    vergleiche(
        "linie_unveraendert",
        "gespeicherte Linie exakt wie im Snapshot",
        (line) => !byId.get(line.publicId)?.line_equal,
    );

    // 5. bahn_nach_legacys_formel — die gezeichnete Bahn ist genau das, was die Rechnung liefert.
    const vonDerLinie = expected.filter((line) => line.drawnFrom === "linie").length;
    vergleiche(
        "bahn_nach_legacys_formel",
        `gezeichnete Bahn exakt nach der Formel; ${String(expected.length - vonDerLinie)} von den Knoten, ${String(vonDerLinie)} von der Linie`,
        (line) => !byId.get(line.publicId)?.drawn_equal,
    );

    // 6. knotenverweise_erhalten
    vergleiche("knotenverweise_erhalten", "from_public_id und to_public_id wie im Snapshot", (line) => {
        const row = byId.get(line.publicId);
        return row?.from_public_id !== line.fromPublicId || row.to_public_id !== line.toPublicId;
    });

    // 7. bogen_erhalten — „nicht gespeichert" und „0" bleiben getrennt.
    vergleiche(
        "bogen_erhalten",
        `curve wie gespeichert (${String(expected.filter((line) => line.curve !== null).length)} gespeichert, davon ${String(expected.filter((line) => line.curve !== null && line.curve !== 0).length)} gebogen)`,
        (line) => byId.get(line.publicId)?.curve !== line.curve,
    );

    // 8. namen_erhalten
    vergleiche("namen_erhalten", "Name wie im Snapshot", (line) => byId.get(line.publicId)?.name !== line.name);

    // 9. beschriftungssteuerung_erhalten
    vergleiche(
        "beschriftungssteuerung_erhalten",
        `${String(expected.filter((line) => line.labelVisible).length)} beschriftet, ein fehlender Wert heißt aus`,
        (line) => byId.get(line.publicId)?.label_visible !== line.labelVisible,
    );

    // 10. bahn_endet_an_den_knoten — gegen die Orte und die KRAFTLINIENPUNKTE dieser Datenbank, nicht
    // gegen den Snapshot: so fällt auf, wenn die Kraftlinien auf einem anderen Stand stehen als die Orte.
    // 🔴 Nicht gegen die Kreuzungstabelle des Wegenetzes: ein Kraftlinienpunkt ist keine Kreuzung
    // (Betreiber 2026-09-26), und der Kraftlinienimport hängt nicht am Wegeimport.
    const ends = await database<EndRow[]>`
        SELECT p.public_id::text,
               COALESCE(ST_Equals(ST_StartPoint(p.drawn_geom), COALESCE(fp.geom, fc.geom)), FALSE) AS start_equal,
               COALESCE(ST_Distance(ST_EndPoint(p.drawn_geom), COALESCE(tp.geom, tc.geom)), 'Infinity'::float8)
                   AS end_distance,
               (fp.id IS NOT NULL OR fc.id IS NOT NULL) AS from_known,
               (tp.id IS NOT NULL OR tc.id IS NOT NULL) AS to_known
        FROM powerline p
        LEFT JOIN place fp ON fp.public_id = p.from_public_id AND fp.map_domain_id = p.map_domain_id
        LEFT JOIN nodix fc ON fc.public_id = p.from_public_id AND fc.map_domain_id = p.map_domain_id AND fc.is_active
        LEFT JOIN place tp ON tp.public_id = p.to_public_id AND tp.map_domain_id = p.map_domain_id
        LEFT JOIN nodix tc ON tc.public_id = p.to_public_id AND tc.map_domain_id = p.map_domain_id AND tc.is_active
        WHERE p.map_domain_id = ${mapDomainId} AND p.source_system = 'legacy' AND p.is_active
    `;
    const endById = new Map(ends.map((row) => [row.public_id, row]));
    const endFalsch = expected.filter((line) => {
        const row = endById.get(line.publicId);
        if (!row) {
            return true;
        }
        if (line.drawnFrom === "knoten") {
            return !row.from_known || !row.to_known || !row.start_equal || row.end_distance > END_TOLERANCE;
        }
        // Fehlt ein Knoten im Snapshot, darf ihn auch die Datenbank nicht kennen - sonst zeichnete die
        // Linie hier an einer anderen Stelle als die Orte stehen.
        return row.from_known && row.to_known;
    });
    checks.push({
        name: "bahn_endet_an_den_knoten",
        passed: endFalsch.length === 0,
        detail: `Anfang exakt, Ende bis ${String(END_TOLERANCE)} auf Ort oder Kraftlinienpunkt dieser Datenbank; ${String(transformed.missingNodes.length)} Verweise ohne Knoten; Abweichungen ${String(endFalsch.length)}`,
        offenders: endFalsch.slice(0, SAMPLE).map((line) => `${line.publicId} (${line.name})`),
    });

    // 11. renderreihenfolge
    const [viewDefinition] = await database<{ src: string }[]>`
        SELECT pg_get_viewdef('powerline_render'::regclass, true) AS src
    `;
    checks.push({
        name: "renderreihenfolge",
        passed: (viewDefinition?.src ?? "").includes("ORDER BY"),
        detail: "powerline_render trägt ORDER BY public_id (Migration 0016)",
    });

    // 12. kraftlinienpunkte_vollzaehlig — jedes Kreuzungsobjekt, an dem eine Kraftlinie endet, ist ein
    // Kraftlinienpunkt, und es gibt keinen weiteren (Contract Version 2).
    const punkteSoll = transformed.nodices;
    const punkteIst = await database<{ public_id: string; x: number; y: number }[]>`
        SELECT public_id::text, ST_X(geom) AS x, ST_Y(geom) AS y
        FROM nodix
        WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
    `;
    const punktById = new Map(punkteIst.map((row) => [row.public_id, row]));
    const punktFehlt = punkteSoll.filter((punkt) => !punktById.has(punkt.publicId));
    const punktZuviel = punkteIst.filter((row) => !punkteSoll.some((punkt) => punkt.publicId === row.public_id));
    checks.push({
        name: "kraftlinienpunkte_vollzaehlig",
        passed: punktFehlt.length === 0 && punktZuviel.length === 0,
        detail: `Snapshot ${String(punkteSoll.length)}, Datenbank ${String(punkteIst.length)}; fehlend ${String(punktFehlt.length)}, zusätzlich ${String(punktZuviel.length)}`,
        offenders: [
            ...punktFehlt.map((punkt) => `fehlt: ${punkt.publicId}`),
            ...punktZuviel.map((row) => `zusätzlich: ${row.public_id}`),
        ].slice(0, SAMPLE),
    });

    // 13. kraftlinienpunkte_lage — exakt, wo das Kreuzungsobjekt im Snapshot steht.
    const punktVerschoben = punkteSoll.filter((punkt) => {
        const row = punktById.get(punkt.publicId);
        return row !== undefined && (row.x !== punkt.x || row.y !== punkt.y);
    });
    checks.push({
        name: "kraftlinienpunkte_lage",
        passed: punktVerschoben.length === 0,
        detail: `Lage exakt wie im Snapshot; Abweichungen ${String(punktVerschoben.length)}`,
        offenders: punktVerschoben.slice(0, SAMPLE).map((punkt) => punkt.publicId),
    });

    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    const settled = settleChecks("verify:powerlines", checks);
    return {
        passed: settled.passed,
        sourceRef: `map_revision=${String(payload.revision ?? "unknown")}`,
        checks: settled.checks,
    };
}
