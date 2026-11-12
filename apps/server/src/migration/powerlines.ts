import { randomUUID } from "node:crypto";
import { AVENTURIA, powerlineDrawnPath, type CurvePoint } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { withZugSperre } from "../derive/derive-lock.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { assertSourceComplete, type LegacyFeature, type LegacyPayload } from "./paths.ts";
import { wikisyncBereiche } from "../wiki/abgleich/schalter-lesen.ts";
import { retireFinding } from "./retire-findings.ts";

/**
 * Die Kraftlinien und ihre Kraftlinienpunkte (WI-0025, Contract `powerlines.yaml` Version 2).
 *
 * Gelesen wird dieselbe Snapshot-Datei wie bei Orten und Wegen: `map-features.json` trägt alle
 * Objektarten nebeneinander, unterschieden durch `feature_type`. Hier zählt nur `powerline`.
 *
 * 🔴 DIE GEZEICHNETE BAHN FOLGT DEN KNOTEN, NICHT DER GESPEICHERTEN LINIE. So zeichnet Legacy
 * (`getPowerlineLatLngs`): kennt es beide Knoten, nimmt es deren Lage; sonst die gespeicherte Linie.
 * Gemessen am Snapshot 140088: 64 der 334 auflösbaren Enden liegen bis 55 Einheiten neben ihrem
 * Knoten — die Linie wurde gezogen, der Knoten ist später gewandert, und Legacy folgt dem Knoten.
 *
 * 🪤 Legacy hat dabei ZWEI Bilder: Besucher bekommen keine Kreuzungsmarker, also fällt eine Linie mit
 * einer Kreuzung am Ende für sie ganz auf die gespeicherte Linie zurück (14 Linien, bis 55 Einheiten
 * anders). Übernommen ist das Editorbild — es ist das, was der Code meint und was die Redaktion
 * sieht, wenn sie eine Linie pflegt. Die Abweichung steht im Contract (`known_legacy_defects`).
 *
 * ⭐ DIE KRAFTLINIENPUNKTE (Nodix) SIND EIN EIGENER OBJEKTTYP. Legacy führt einen Punkt, an dem eine
 * Linie ohne Ort endet oder mehrere zusammenlaufen, als Kreuzungsobjekt. Betreiber 2026-09-26: „achte
 * darauf, dass kreuzung nicht einfach als kreuzungen importiert werden. für deinen import reicht es
 * "Kraftlinienpunkte a.k.a. Nodix" als eigenes objekt zu bauen“. Der Lauf legt sie deshalb mit an,
 * in `nodix`, unabhängig von der Kreuzungstabelle des Wegenetzes.
 */

export const CONTRACT_VERSION = "2";

export interface TransformedPowerline {
    publicId: string;
    name: string;
    labelVisible: boolean;
    fromPublicId: string;
    toPublicId: string;
    /** Wie gespeichert. null = nicht gespeichert (zeichnet gerade, wie 0). */
    curve: number | null;
    /** Legacys gespeicherte Linie, unverändert. */
    geojson: string;
    /** Die gezeichnete Bahn, abgeleitet. */
    drawnGeojson: string;
    /** Woher die Enden der Bahn kommen: von beiden Knoten, oder (fehlt einer) von der Linie. */
    drawnFrom: "knoten" | "linie";
}

/** Ein Kraftlinienpunkt (Nodix-Objekt), wie er aus Legacys Kreuzungsobjekt entsteht. */
export interface TransformedNodix {
    publicId: string;
    legacyKind: "junction" | "crossing";
    /** Legacy schreibt „Kreuzung“ oder „Kreuzung-41“ - kein Name, nur die Spur. */
    legacyName: string | null;
    x: number;
    y: number;
}

export interface MissingNode {
    powerlinePublicId: string;
    name: string;
    side: "from" | "to";
    nodePublicId: string;
}

export interface TransformResult {
    powerlines: TransformedPowerline[];
    /** Alles, was keine Kraftlinie ist. */
    skippedOtherTypes: number;
    rejected: { publicId: string; reason: string }[];
    /** Verweise auf Knoten, die der Snapshot nicht kennt — Befund, keine Korrektur. */
    missingNodes: MissingNode[];
    /** Die Kraftlinienpunkte: jedes Kreuzungsobjekt, an dem eine Kraftlinie endet, geordnet nach Kennung. */
    nodices: TransformedNodix[];
}

/** Ein Wert, der nicht passt, weist die ganze Linie zurück - nichts wird still verbogen. */
class Unreadable extends Error {}

/** Wie Legacy `show_label` liest: nur ein ausdrücklicher Wahrheitswert zeigt den Namen. */
function readLabelVisible(value: unknown): boolean {
    return value === true || value === 1 || value === "1";
}

function readNodeId(value: unknown, field: string): string {
    const id = typeof value === "string" ? value.trim() : "";
    if (id === "") {
        throw new Unreadable(`${field} fehlt`);
    }
    return id;
}

/**
 * Der Bogen, wie gespeichert.
 *
 * 🪤 Strenger als Legacy, und mit Absicht: Legacy liest `Number(curve)` und macht aus allem, was
 * keine Zahl ist, eine gerade Linie. Ein Import, der das nachahmt, hätte einen kaputten Wert still in
 * eine gerade Linie verwandelt. Außerhalb von ±45 wird NICHT abgelehnt — das ist ein gültiger
 * gespeicherter Wert, den erst das Zeichnen klemmt, wie in Legacy.
 */
function readCurve(properties: Record<string, unknown>): number | null {
    if (!("curve" in properties) || properties["curve"] === null) {
        return null;
    }
    const value = properties["curve"];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Unreadable(`curve ${JSON.stringify(value)} ist keine Zahl`);
    }
    return value;
}

function readLine(feature: LegacyFeature): CurvePoint[] {
    const bounds = AVENTURIA.coordinateSpace.bounds;
    const coordinates = feature.geometry?.coordinates;
    if (feature.geometry?.type !== "LineString" || !Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Unreadable("keine Linie mit mindestens zwei Stützpunkten");
    }
    return coordinates.map((pair: unknown) => {
        if (
            !Array.isArray(pair) ||
            pair.length !== 2 ||
            typeof pair[0] !== "number" ||
            typeof pair[1] !== "number" ||
            pair[0] < bounds.minX ||
            pair[0] > bounds.maxX ||
            pair[1] < bounds.minY ||
            pair[1] > bounds.maxY
        ) {
            throw new Unreadable("Stützpunkt außerhalb des Kartenraums");
        }
        return { x: pair[0], y: pair[1] };
    });
}

/**
 * Die Knoten, wie Legacy sie kennt: jedes Punktobjekt mit Namen, das kein Label ist
 * (`prepareLocationData`, js/routing/routing.js) — Orte und Kreuzungen.
 *
 * 🔴 Die Lage kommt aus DEMSELBEN Snapshot wie die Linie. So zeichnet der Lauf genau das Bild dieser
 * Revision, unabhängig davon, auf welchem Stand die Ortstabelle gerade steht; `verify:powerlines`
 * prüft danach, dass beide übereinstimmen.
 */
export function nodePositions(payload: LegacyPayload): Map<string, CurvePoint> {
    const nodes = new Map<string, CurvePoint>();
    for (const feature of payload.features ?? []) {
        const properties = feature.properties ?? {};
        const coordinates = feature.geometry?.coordinates;
        if (
            feature.geometry?.type !== "Point" ||
            !properties["name"] ||
            properties["feature_type"] === "label" ||
            !Array.isArray(coordinates) ||
            typeof coordinates[0] !== "number" ||
            typeof coordinates[1] !== "number"
        ) {
            continue;
        }
        const id = String((feature as { id?: unknown }).id ?? properties["public_id"] ?? "");
        if (id !== "") {
            nodes.set(id, { x: coordinates[0], y: coordinates[1] });
        }
    }
    return nodes;
}

/**
 * Die Kraftlinienpunkte: jedes Punktobjekt vom Typ `junction` oder `crossing`, an dem eine der
 * Kraftlinien endet. Mehrere Enden am selben Punkt ergeben EINEN Punkt.
 *
 * 🪤 Nicht jede Kreuzung ist ein Kraftlinienpunkt und nicht jeder Kraftlinienpunkt eine Kreuzung:
 * Von den 45 im Snapshot 140088 liegen nur 13 auf einem Weg.
 */
export function powerlinePoints(
    payload: LegacyPayload,
    powerlines: readonly TransformedPowerline[],
): TransformedNodix[] {
    const verwendet = new Set(powerlines.flatMap((line) => [line.fromPublicId, line.toPublicId]));
    const punkte = new Map<string, TransformedNodix>();
    for (const feature of payload.features ?? []) {
        const properties = feature.properties ?? {};
        const art = properties["feature_type"];
        const coordinates = feature.geometry?.coordinates;
        const id = String((feature as { id?: unknown }).id ?? properties["public_id"] ?? "");
        if (
            (art !== "junction" && art !== "crossing") ||
            !verwendet.has(id) ||
            feature.geometry?.type !== "Point" ||
            !Array.isArray(coordinates) ||
            typeof coordinates[0] !== "number" ||
            typeof coordinates[1] !== "number"
        ) {
            continue;
        }
        const name = properties["name"];
        punkte.set(id, {
            publicId: id,
            legacyKind: art,
            legacyName: typeof name === "string" && name.trim() !== "" ? name.trim() : null,
            x: coordinates[0],
            y: coordinates[1],
        });
    }
    return [...punkte.values()].sort((a, b) => a.publicId.localeCompare(b.publicId));
}

function asGeoJsonLine(points: readonly CurvePoint[]): string {
    return JSON.stringify({ type: "LineString", coordinates: points.map((point) => [point.x, point.y]) });
}

export function transformPowerlines(payload: LegacyPayload): TransformResult {
    const result: TransformResult = {
        powerlines: [],
        skippedOtherTypes: 0,
        rejected: [],
        missingNodes: [],
        nodices: [],
    };
    const nodes = nodePositions(payload);
    const seen = new Set<string>();

    for (const feature of payload.features ?? []) {
        const properties = feature.properties ?? {};
        if (properties["feature_type"] !== "powerline") {
            result.skippedOtherTypes += 1;
            continue;
        }
        const publicId = String(properties["public_id"] ?? "").trim();
        if (publicId === "") {
            result.rejected.push({ publicId: "(fehlt)", reason: "ohne public_id" });
            continue;
        }
        if (seen.has(publicId)) {
            result.rejected.push({ publicId, reason: "public_id doppelt" });
            continue;
        }

        let line: CurvePoint[];
        let fromPublicId: string;
        let toPublicId: string;
        let curve: number | null;
        try {
            line = readLine(feature);
            fromPublicId = readNodeId(properties["from_public_id"], "from_public_id");
            toPublicId = readNodeId(properties["to_public_id"], "to_public_id");
            curve = readCurve(properties);
        } catch (error) {
            if (!(error instanceof Unreadable)) throw error;
            result.rejected.push({ publicId, reason: error.message });
            continue;
        }

        const name = String(properties["name"] ?? "").trim();
        const from = nodes.get(fromPublicId);
        const to = nodes.get(toPublicId);
        for (const [side, nodePublicId, node] of [
            ["from", fromPublicId, from],
            ["to", toPublicId, to],
        ] as const) {
            if (!node) {
                result.missingNodes.push({ powerlinePublicId: publicId, name, side, nodePublicId });
            }
        }
        // Legacy: `if (fromEntry && toEntry)` — nur mit BEIDEN Knoten, sonst die ganze Linie.
        const ends = from && to ? [from, to] : line;

        seen.add(publicId);
        result.powerlines.push({
            publicId,
            name,
            labelVisible: readLabelVisible(properties["show_label"]),
            fromPublicId,
            toPublicId,
            curve,
            geojson: asGeoJsonLine(line),
            drawnGeojson: asGeoJsonLine(powerlineDrawnPath(ends, curve)),
            drawnFrom: from && to ? "knoten" : "linie",
        });
    }
    result.nodices = powerlinePoints(payload, result.powerlines);
    return result;
}

export interface ImportOptions {
    mapDomainId?: string;
    /** Probelauf: alles rechnen und zählen, dann zurückrollen. Schreibt nichts, auch kein Journal. */
    dryRun?: boolean;
}

export interface ImportReport {
    runId: string;
    sourceRef: string;
    dryRun: boolean;
    created: number;
    updated: number;
    /** Zeilen, die der Snapshot genau so beschreibt, wie sie schon dastehen. */
    unchanged: number;
    retired: number;
    drawnFromNodes: number;
    drawnFromLine: number;
    skippedOtherTypes: number;
    rejected: { publicId: string; reason: string }[];
    missingNodes: MissingNode[];
    /** Die Kraftlinienpunkte (Nodix-Objekte) dieses Laufs. */
    nodices: { total: number; created: number; updated: number; unchanged: number; retired: number };
    /** Die Kraftlinien und Kraftlinienpunkte, die dieser Lauf stilllegt (Tabelle, öffentliche ID, Name). */
    retiredObjects: FindingObject[];
    /** Was der Lauf meldet, ohne anzuhalten (Betreiber 2026-10-03): etwa die Stilllegequote. */
    findings: Finding[];
}

/** Trägt den fertigen Bericht aus der Transaktion, die ein Probelauf zurückrollt. */
class DryRunRollback extends Error {}

/**
 * Der Zugschritt I8: Kraftlinien und Kraftlinienpunkte aus Legacy. Seit dem Kraftlinien-Editor (WI-0205 K4) schreiben auch die Editoren
 * diese Tafeln; der Schritt nimmt deshalb die Sperre der Kartendomäne exklusiv (EDIT-0003 T17), damit kein Speichern zwischen seine
 * Zeilen fällt.
 */
export async function importPowerlines(
    database: Database,
    payload: LegacyPayload,
    options: ImportOptions = {},
): Promise<ImportReport> {
    // 🔴 WI-0253 D-1: Gehören die Kraftlinien in dieser Umgebung dem WikiSync, lässt der Zug sie aus (Vali 2026-10-25: „danach lässt der Legacy-Zug diesen Bereich in
    // dieser Umgebung aus“). Der Bericht ist der eines Laufs, der nichts zu tun fand; ein Befund sagt, warum. Gelesen wird vor der Sperre: Auslassen kostet nichts.
    if ((await wikisyncBereiche(database)).has("kraftlinie")) return kraftlinienGehoerenWikisync(payload, options);
    return withZugSperre(database, options.mapDomainId ?? AVENTURIA.mapDomain, "I8 Kraftlinien", () =>
        importPowerlinesLocked(database, payload, options),
    );
}

/** Der Bericht des Schritts, wenn er die Kraftlinien auslässt: nichts gelesen, nichts geschrieben, ein Befund. */
function kraftlinienGehoerenWikisync(payload: LegacyPayload, options: ImportOptions): ImportReport {
    return {
        runId: randomUUID(),
        sourceRef: `map_revision=${String(payload.revision ?? "unknown")}`,
        dryRun: options.dryRun === true,
        created: 0,
        updated: 0,
        unchanged: 0,
        retired: 0,
        drawnFromNodes: 0,
        drawnFromLine: 0,
        skippedOtherTypes: 0,
        rejected: [],
        missingNodes: [],
        nodices: { total: 0, created: 0, updated: 0, unchanged: 0, retired: 0 },
        retiredObjects: [],
        findings: [
            createFinding(
                "bereich_wikisync",
                "Die Kraftlinien gehören in dieser Umgebung dem WikiSync; der Zug lässt sie aus (Kraftlinien und Kraftlinienpunkte)",
                { bereich: "kraftlinie" },
            ),
        ],
    };
}

/** Der Körper von `importPowerlines`, unter der Sperre des Zugs. */
async function importPowerlinesLocked(
    database: Database,
    payload: LegacyPayload,
    options: ImportOptions,
): Promise<ImportReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    assertSourceComplete(payload);
    const transformed = transformPowerlines(payload);
    const runId = randomUUID();
    const report: ImportReport = {
        runId,
        sourceRef: `map_revision=${String(payload.revision ?? "unknown")}`,
        dryRun: options.dryRun === true,
        created: 0,
        updated: 0,
        unchanged: 0,
        retired: 0,
        drawnFromNodes: transformed.powerlines.filter((line) => line.drawnFrom === "knoten").length,
        drawnFromLine: transformed.powerlines.filter((line) => line.drawnFrom === "linie").length,
        skippedOtherTypes: transformed.skippedOtherTypes,
        rejected: transformed.rejected,
        missingNodes: transformed.missingNodes,
        nodices: { total: transformed.nodices.length, created: 0, updated: 0, unchanged: 0, retired: 0 },
        retiredObjects: [],
        findings: [],
    };

    try {
        await database.begin(async (transaction) => {
            const incoming = transformed.powerlines.map((line) => line.publicId);

            // Zählen, was dieser Lauf stilllegt. Dieselbe Schwelle wie bei Orten und Wegen; darüber steht im
            // Bericht ein Befund mit Namen, der Lauf geht weiter (Betreiber 2026-10-03).
            const [pressure] = await transaction<{ active: number; retiring: number }[]>`
                SELECT
                    count(*)::int AS active,
                    count(*) FILTER (WHERE public_id <> ALL(${incoming}::uuid[]))::int AS retiring
                FROM powerline
                WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
            `;
            const lineQuota = await retireFinding("powerline", pressure, async () => {
                const rows = await transaction<{ public_id: string; name: string }[]>`
                    SELECT public_id::text, name
                    FROM powerline
                    WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
                      AND public_id <> ALL(${incoming}::uuid[])
                    ORDER BY name, public_id
                `;
                return rows.map((row) => ({ table: "powerline", publicId: row.public_id, name: row.name }));
            });
            if (lineQuota) report.findings.push(lineQuota);

            const punktIds = transformed.nodices.map((punkt) => punkt.publicId);
            const [punktDruck] = await transaction<{ active: number; retiring: number }[]>`
                SELECT
                    count(*)::int AS active,
                    count(*) FILTER (WHERE public_id <> ALL(${punktIds}::uuid[]))::int AS retiring
                FROM nodix
                WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
            `;
            const punktQuota = await retireFinding("nodix", punktDruck, async () => {
                const rows = await transaction<{ public_id: string; legacy_name: string | null }[]>`
                    SELECT public_id::text, legacy_name
                    FROM nodix
                    WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
                      AND public_id <> ALL(${punktIds}::uuid[])
                    ORDER BY legacy_name, public_id
                `;
                return rows.map((row) => ({ table: "nodix", publicId: row.public_id, name: row.legacy_name }));
            });
            if (punktQuota) report.findings.push(punktQuota);

            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'powerlines', 'avesmaps-legacy', ${report.sourceRef}, ${CONTRACT_VERSION})
            `;

            for (const line of transformed.powerlines) {
                const rows = await transaction<{ inserted: boolean }[]>`
                    INSERT INTO powerline (
                        public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, curve,
                        geom, drawn_geom, source_system, legacy_public_id, migration_run_id, imported_at,
                        is_active
                    ) VALUES (
                        ${line.publicId}, ${mapDomainId}, ${line.name}, ${line.labelVisible},
                        ${line.fromPublicId}, ${line.toPublicId}, ${line.curve}::double precision,
                        -- 💣 ST_SetSRID ist nicht optional: ST_GeomFromGeoJSON liefert SRID 4326, auch bei
                        -- Koordinaten 0..1024.
                        ST_SetSRID(ST_GeomFromGeoJSON(${line.geojson}), 0),
                        ST_SetSRID(ST_GeomFromGeoJSON(${line.drawnGeojson}), 0),
                        'legacy', ${line.publicId}, ${runId}, now(), TRUE
                    )
                    ON CONFLICT (public_id) DO UPDATE SET
                        name = EXCLUDED.name,
                        label_visible = EXCLUDED.label_visible,
                        from_public_id = EXCLUDED.from_public_id,
                        to_public_id = EXCLUDED.to_public_id,
                        curve = EXCLUDED.curve,
                        geom = EXCLUDED.geom,
                        drawn_geom = EXCLUDED.drawn_geom,
                        migration_run_id = EXCLUDED.migration_run_id,
                        imported_at = EXCLUDED.imported_at,
                        -- Eine von der Karte genommene Linie (WI-0205 K10, off_map) bleibt abgenommen: Der Zug holt sie nicht zurück
                        -- (EDIT-0003 T43, wie Wege). Nur die Testwelt setzt off_map vor dem Zug zurück (editor/testwelt.ts).
                        is_active = NOT powerline.off_map,
                        updated_at = now()
                    -- Nur wenn sich wirklich etwas unterscheidet: „idempotent" heißt „tut nichts",
                    -- nicht „endet gleich" (Kapitel 9.32).
                    -- 🪤 ST_OrderingEquals statt IS DISTINCT FROM auf der Geometrie: es vergleicht
                    -- Punkt für Punkt in Reihenfolge, und genau das ist die Frage.
                    WHERE powerline.name IS DISTINCT FROM EXCLUDED.name
                       OR powerline.label_visible IS DISTINCT FROM EXCLUDED.label_visible
                       OR powerline.from_public_id IS DISTINCT FROM EXCLUDED.from_public_id
                       OR powerline.to_public_id IS DISTINCT FROM EXCLUDED.to_public_id
                       OR powerline.curve IS DISTINCT FROM EXCLUDED.curve
                       OR NOT ST_OrderingEquals(powerline.geom, EXCLUDED.geom)
                       OR NOT ST_OrderingEquals(powerline.drawn_geom, EXCLUDED.drawn_geom)
                       OR powerline.is_active IS DISTINCT FROM (NOT powerline.off_map)
                    RETURNING (xmax = 0) AS inserted
                `;
                if (rows.length === 0) {
                    report.unchanged += 1;
                } else if (rows[0]?.inserted) {
                    report.created += 1;
                } else {
                    report.updated += 1;
                }
            }

            const retired = await transaction<{ public_id: string; name: string }[]>`
                UPDATE powerline SET is_active = FALSE, updated_at = now()
                WHERE map_domain_id = ${mapDomainId}
                  AND source_system = 'legacy'
                  AND is_active
                  AND public_id <> ALL(${incoming}::uuid[])
                RETURNING public_id::text, name
            `;
            report.retired = retired.length;
            for (const row of retired) {
                report.retiredObjects.push({ table: "powerline", publicId: row.public_id, name: row.name });
            }

            // Die Kraftlinienpunkte: dieselbe Idempotenz wie bei den Linien - geschrieben wird nur,
            // was sich unterscheidet.
            for (const punkt of transformed.nodices) {
                const rows = await transaction<{ inserted: boolean }[]>`
                    INSERT INTO nodix (
                        public_id, map_domain_id, legacy_name, legacy_kind, geom, source_system,
                        legacy_public_id, migration_run_id, imported_at, is_active
                    ) VALUES (
                        ${punkt.publicId}, ${mapDomainId}, ${punkt.legacyName}, ${punkt.legacyKind},
                        ST_SetSRID(ST_MakePoint(${punkt.x}, ${punkt.y}), 0),
                        'legacy', ${punkt.publicId}, ${runId}, now(), TRUE
                    )
                    ON CONFLICT (public_id) DO UPDATE SET
                        legacy_name = EXCLUDED.legacy_name,
                        legacy_kind = EXCLUDED.legacy_kind,
                        geom = EXCLUDED.geom,
                        migration_run_id = EXCLUDED.migration_run_id,
                        imported_at = EXCLUDED.imported_at,
                        is_active = TRUE,
                        updated_at = now()
                    WHERE nodix.legacy_name IS DISTINCT FROM EXCLUDED.legacy_name
                       OR nodix.legacy_kind IS DISTINCT FROM EXCLUDED.legacy_kind
                       OR NOT ST_Equals(nodix.geom, EXCLUDED.geom)
                       OR nodix.is_active IS DISTINCT FROM TRUE
                    RETURNING (xmax = 0) AS inserted
                `;
                if (rows.length === 0) {
                    report.nodices.unchanged += 1;
                } else if (rows[0]?.inserted) {
                    report.nodices.created += 1;
                } else {
                    report.nodices.updated += 1;
                }
            }
            const punkteStill = await transaction<{ public_id: string; legacy_name: string | null }[]>`
                UPDATE nodix SET is_active = FALSE, updated_at = now()
                WHERE map_domain_id = ${mapDomainId}
                  AND source_system = 'legacy'
                  AND is_active
                  AND public_id <> ALL(${punktIds}::uuid[])
                RETURNING public_id::text, legacy_name
            `;
            report.nodices.retired = punkteStill.length;
            for (const row of punkteStill) {
                report.retiredObjects.push({ table: "nodix", publicId: row.public_id, name: row.legacy_name });
            }

            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        created: report.created,
                        updated: report.updated,
                        unchanged: report.unchanged,
                        retired: report.retired,
                        drawn_from_nodes: report.drawnFromNodes,
                        drawn_from_line: report.drawnFromLine,
                        missing_nodes: report.missingNodes.length,
                        skipped_other_types: report.skippedOtherTypes,
                        rejected: report.rejected.length,
                        nodix_total: report.nodices.total,
                        nodix_created: report.nodices.created,
                        nodix_updated: report.nodices.updated,
                        nodix_unchanged: report.nodices.unchanged,
                        nodix_retired: report.nodices.retired,
                    } as unknown as string
                }
                WHERE id = ${runId}
            `;

            if (options.dryRun) {
                throw new DryRunRollback();
            }
        });
    } catch (error) {
        if (!(error instanceof DryRunRollback)) {
            throw error;
        }
    }

    return report;
}
