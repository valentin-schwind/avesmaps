import { AVENTURIA } from "@avesmaps3d/shared";
import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import { loadLooseEndpoints, looseEndpointCheck } from "../routing/loose-endpoints.ts";
import { transformPaths, type LegacyPayload } from "./paths.ts";

/**
 * Parität zwischen Snapshot und migrierten Wegen (Contract `paths.yaml`, Abschnitt `validation`).
 *
 * 🔴 Die Prüfungen hier sind die Liste aus dem Contract, in derselben Reihenfolge und unter
 * denselben Namen. Eine Contract-Liste, die mehr behauptet als der Verifier ausführt, ist schlimmer
 * als keine: sie sieht nach Abdeckung aus und hat sie nicht.
 *
 * Semantik statt Zeilenzahlen: Identität, Art, Geometrie und Beschriftungssteuerung werden je
 * einzeln geprüft, damit ein Fehlschlag sagt, WAS abweicht — nicht nur, DASS etwas abweicht.
 *
 * 🔴 Ein im Editor von der Karte genommener Weg (`off_map`, WI-0177 Stufe 3b, Migration 0150) gehört nicht zum Erwartungswert: Der Zug
 * holt ihn nicht zurück (`paths.ts`), also fehlt er auf der Karte zu Recht. Der Prüfer nimmt ihn aus dem Snapshot heraus und nennt
 * seine Zahl in `wege_vollzaehlig`; ohne das würde der nächste Wege-Zug rot, sobald ein Editor einen Weg abnimmt. Ein ganz gelöschter
 * Weg (`off_map` falsch) fehlt weiter: Den belebt der Zug (wie bei den Kraftlinien, `verify-powerlines.ts`).
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
    subtype: string;
    label_visible: boolean;
    is_bach: boolean;
    points: number;
    valid: boolean;
    within: boolean;
    geometry_type: string;
    allowed_transports: string[] | null;
    transport_domain: string | null;
    transport_seasons: unknown;
    flow_factor: number | null;
}

const SAMPLE = 5;

export async function verifyPaths(
    database: Database,
    payload: LegacyPayload,
    options: { mapDomainId?: string } = {},
): Promise<ParityReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const transformed = transformPaths(payload);
    const abgenommen = new Set(
        (
            await database<{ public_id: string }[]>`
                SELECT public_id::text FROM path
                 WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND NOT is_active AND off_map
            `
        ).map((row) => row.public_id),
    );
    const expected = transformed.paths.filter((path) => !abgenommen.has(path.publicId));
    const bounds = AVENTURIA.coordinateSpace.bounds;

    const rows = await database<TargetRow[]>`
        SELECT public_id::text, name, subtype, label_visible, is_bach,
               ST_NPoints(geom)::int AS points,
               ST_IsValid(geom) AS valid,
               ST_Within(geom, ST_MakeEnvelope(
                   ${bounds.minX}, ${bounds.minY}, ${bounds.maxX}, ${bounds.maxY}, 0)) AS within,
               GeometryType(geom) AS geometry_type,
               allowed_transports, transport_domain, transport_seasons, flow_factor::float8 AS flow_factor
        FROM path
        WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
    `;

    const byId = new Map(rows.map((row) => [row.public_id, row]));
    const checks: ParityCheck[] = [];

    // 1. wege_vollzaehlig
    const missing = expected.filter((path) => !byId.has(path.publicId));
    const extra = rows.filter((row) => !expected.some((path) => path.publicId === row.public_id));
    checks.push({
        name: "wege_vollzaehlig",
        passed: missing.length === 0 && extra.length === 0 && rows.length === expected.length,
        detail: `Snapshot ${String(expected.length)}${abgenommen.size > 0 ? ` (ohne ${String(abgenommen.size)} vom Editor abgenommene)` : ""}, Datenbank ${String(rows.length)}; fehlend ${String(missing.length)}, zusätzlich ${String(extra.length)}`,
        offenders: [
            ...missing.map((p) => `fehlt: ${p.publicId}`),
            ...extra.map((r) => `zusätzlich: ${r.public_id}`),
        ].slice(0, SAMPLE),
    });

    // 2. identitaet_eindeutig
    const duplicates = rows.length - byId.size;
    checks.push({
        name: "identitaet_eindeutig",
        passed: duplicates === 0,
        detail: `${String(byId.size)} verschiedene public_id bei ${String(rows.length)} Zeilen`,
    });

    // 3. geometrie_gueltig
    const brokenGeometry = rows.filter(
        (row) => !row.valid || !row.within || row.geometry_type !== "LINESTRING" || row.points < 2,
    );
    checks.push({
        name: "geometrie_gueltig",
        passed: brokenGeometry.length === 0,
        detail: `${String(brokenGeometry.length)} Wege mit ungültiger, falsch typisierter oder außerhalb liegender Geometrie`,
        offenders: brokenGeometry
            .slice(0, SAMPLE)
            .map(
                (row) =>
                    `${row.public_id}: ${row.geometry_type}, ${String(row.points)} Punkte, gültig ${String(row.valid)}, innerhalb ${String(row.within)}`,
            ),
    });

    // 4. stuetzpunkte_erhalten
    // 🪤 Die schärfste Geometrieprüfung: sie fällt aus, sobald der Import auch nur einen Punkt
    // verliert oder erfindet — was eine Vereinfachung oder ein falscher Geometrieleser täte.
    const expectedPoints = expected.reduce((sum, path) => {
        const geometry = JSON.parse(path.geojson) as { coordinates: unknown[] };
        return sum + geometry.coordinates.length;
    }, 0);
    const actualPoints = rows.reduce((sum, row) => sum + row.points, 0);
    checks.push({
        name: "stuetzpunkte_erhalten",
        passed: expectedPoints === actualPoints,
        detail: `Snapshot ${String(expectedPoints)}, Datenbank ${String(actualPoints)}`,
    });

    // 5. wegarten_vollzaehlig
    const countBy = (list: { subtype: string }[]): Record<string, number> => {
        const map: Record<string, number> = {};
        for (const entry of list) {
            map[entry.subtype] = (map[entry.subtype] ?? 0) + 1;
        }
        return map;
    };
    const expectedSubtypes = countBy(expected);
    const actualSubtypes = countBy(rows);
    const subtypeDiff = [...new Set([...Object.keys(expectedSubtypes), ...Object.keys(actualSubtypes)])]
        .filter((key) => expectedSubtypes[key] !== actualSubtypes[key])
        .map(
            (key) =>
                `${key}: Snapshot ${String(expectedSubtypes[key] ?? 0)}, Datenbank ${String(actualSubtypes[key] ?? 0)}`,
        );
    checks.push({
        name: "wegarten_vollzaehlig",
        passed: subtypeDiff.length === 0,
        detail:
            subtypeDiff.length === 0
                ? `${String(Object.keys(actualSubtypes).length)} Arten, alle Anzahlen gleich`
                : subtypeDiff.join(" · "),
        offenders: subtypeDiff.slice(0, SAMPLE),
    });

    // 6. namen_vollzaehlig — und jeder Name genau der aus dem Snapshot
    const wrongName = expected.filter((path) => byId.get(path.publicId)?.name !== path.name);
    checks.push({
        name: "namen_vollzaehlig",
        passed: wrongName.length === 0 && rows.every((row) => row.name.trim() !== ""),
        detail: `${String(wrongName.length)} Wege mit abweichendem Namen`,
        offenders: wrongName
            .slice(0, SAMPLE)
            .map((path) => `${path.publicId}: ${byId.get(path.publicId)?.name ?? "(fehlt)"} statt ${path.name}`),
    });

    // 7. beschriftungssteuerung_erhalten
    const wrongLabel = expected.filter((path) => byId.get(path.publicId)?.label_visible !== path.labelVisible);
    const wrongBach = expected.filter((path) => byId.get(path.publicId)?.is_bach !== path.isBach);
    checks.push({
        name: "beschriftungssteuerung_erhalten",
        passed: wrongLabel.length === 0 && wrongBach.length === 0,
        detail: `${String(expected.filter((p) => p.labelVisible).length)} beschriftet, ${String(expected.filter((p) => p.isBach).length)} Bäche; Abweichungen ${String(wrongLabel.length + wrongBach.length)}`,
        offenders: [...wrongLabel, ...wrongBach].slice(0, SAMPLE).map((path) => path.publicId),
    });

    // 8. renderreihenfolge
    const [viewDefinition] = await database<{ src: string }[]>`
        SELECT pg_get_viewdef('path_render'::regclass, true) AS src
    `;
    checks.push({
        name: "renderreihenfolge",
        passed: (viewDefinition?.src ?? "").includes("ORDER BY"),
        detail: "path_render trägt ORDER BY public_id (Migration 0016)",
    });

    // (Version 2 prüfte hier `kreuzungen_vollzaehlig`. Seit Version 3, WI-0132 Release N, übernimmt der Import keine
    // Kreuzungen mehr; das Netz entsteht aus Orten und Wegen. Die Prüfung entfällt, die Tabelle liest der Prüfer nicht.)

    // 9. routingattribute_erhalten: "fehlt" und "leer" muessen getrennt ankommen.
    // 🪤 Schluesselreihenfolge zaehlt nicht: jsonb sortiert Schluessel um. Verglichen wird kanonisch.
    // Eine JSON-ZEICHENKETTE statt eines Objekts bleibt dagegen ein Fehler - genau den hat diese
    // Pruefung beim ersten Lauf gefunden.
    const canonical = (value: unknown): unknown =>
        Array.isArray(value)
            ? value.map(canonical)
            : value !== null && typeof value === "object"
              ? Object.fromEntries(
                    Object.keys(value)
                        .sort()
                        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
                )
              : value;
    const same = (left: unknown, right: unknown): boolean =>
        JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
    const wrongRouting = expected.filter((path) => {
        const row = byId.get(path.publicId);
        return (
            !row ||
            !same(row.allowed_transports, path.allowedTransports) ||
            row.transport_domain !== path.transportDomain ||
            !same(row.transport_seasons, path.transportSeasons) ||
            row.flow_factor !== path.flowFactor
        );
    });
    const counted = (predicate: (path: (typeof expected)[number]) => boolean): number =>
        expected.filter(predicate).length;
    checks.push({
        name: "routingattribute_erhalten",
        passed: wrongRouting.length === 0,
        detail: `Listen ${String(counted((p) => p.allowedTransports !== null))} (leer ${String(counted((p) => p.allowedTransports?.length === 0))}), Domaene ${String(counted((p) => p.transportDomain !== null))}, Saisonfenster ${String(counted((p) => p.transportSeasons !== null))}, Stroemungsfaktor ${String(counted((p) => p.flowFactor !== null))}; Abweichungen ${String(wrongRouting.length)}`,
        offenders: wrongRouting.slice(0, SAMPLE).map((path) => path.publicId),
    });

    // 10. wegenden_am_knoten — lose Wegenden als BEFUND (Betreiberentscheidung 2026-10-06: „ja, bau C auch ein“)
    //
    // 🔴 Der Befund stammt aus `project-control/discovery/route-gareth-alfenmohn-haken-2026-10-06.md`: Wo ein Ort
    // gelöscht wird, hängen sich die Wegenden an den nächsten im Kasten `ENDPOINT_BOX`, und der Sprung
    // dorthin kostet im Graphen nichts — die Route springt durch die Luft und die Strecke wird zu kurz angegeben.
    // Seit WI-0132 Release N gemessen auf der Topologie ohne Kreuzungen (dieselbe wie im Router); die Sackgassen nennt
    // der Befund als Zahl, ihre Stellen zeigt der Prüfhaken „Wege treffen sich nicht“. Repariert wird nach dem Cutoff in
    // Production im Wegeeditor (WI-0132 §6), nicht in Legacy.
    //
    // 🔴 Sie HÄLT NICHTS AN. Sie steht nicht in `BLOCKING_CHECKS` und soll dort nicht stehen (Betreiber 2026-10-03):
    // Eine redaktionelle Lücke in den Daten ist kein Grund, unseren Import anzuhalten. `settleChecks` macht aus dem
    // Ausfall einen Befund, das Urteil des Prüfers bleibt grün.
    //
    // 💣 Sie nennt, WAS sie sieht, nicht nur DASS sie etwas sieht. Dieselbe Lehre wie bei `verify:runs` und
    // `verify:path-runs` (2026-10-06): Eine Prüfung, die „281 lose Enden“ sagt und keine Stelle nennt, ist für die
    // Redaktion wertlos. Jede Stelle steht hier mit Punkt, Wegen und Kennungen, Rang 1 zuerst.
    //
    // Gemessen wird mit `loose-endpoints.ts` — derselben Quelle wie `npm run ops:lose-wegenden` und der Prüfhaken
    // „Offene Wegenden“. Eine Messung, drei Ausgaben.
    checks.push(looseEndpointCheck(await loadLooseEndpoints(database, mapDomainId)));

    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    const settled = settleChecks("verify:paths", checks);
    return {
        passed: settled.passed,
        sourceRef: `map_revision=${String(payload.revision ?? "unknown")}`,
        checks: settled.checks,
    };
}
