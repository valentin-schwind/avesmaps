import { randomUUID } from "node:crypto";
import { AVENTURIA, isCalendarMonth, type SeasonWindow } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import type { Finding } from "../findings.ts";
import { retireFinding } from "./retire-findings.ts";
import { withZugSperre } from "../derive/derive-lock.ts";

/**
 * Die Wege-Domäne (WI-0010, Contract `paths.yaml` Version 3).
 *
 * Stufe 1 importierte nur Darstellungsdaten. Seit Version 2 (WI-0017 R1, Betreiberfreigabe
 * 2026-09-23) kommen die ROUTINGDATEN dazu: an jedem Weg `allowed_transports`, `transport_domain`,
 * `transport_seasons` und der Strömungsfaktor neben der Richtung.
 *
 * 🔴 **Version 3 (WI-0132 Release N, Betreiber 2026-10-10: „das routing voll und ganz ohne kreuzungen aus legacy“):**
 * Legacys Kreuzungsobjekte (`junction`/`crossing`) werden nur noch GEZÄHLT, nicht mehr geschrieben. Das Netz
 * entsteht aus Orten und Wegen (`routing/topology.ts`). Die Tabelle `crossing` bleibt bis Release N+1 als Rückweg
 * stehen, wird aber nicht mehr fortgeschrieben; ihr Abbau (`DROP TABLE`) ist ein eigener, freigabepflichtiger Schritt.
 *
 * 🔴 `befahrbar` bleibt draußen: Legacys Routing liest es nicht (MCS-017), und eine Spalte, die
 * niemand liest, sieht nach Daten aus, ohne welche zu sein.
 *
 * 🪤 „Fehlt" ist nicht „leer". Eine gespeicherte leere Transportliste heißt in Legacy „hier fährt
 * nichts"; eine fehlende heißt „nimm die Vorgabe der Wegart". Beides muss unterscheidbar ankommen.
 */

export const CONTRACT_VERSION = "3";

/** Die acht Wegarten des Bestands, in der Schreibweise des Bestands. */
export const PATH_SUBTYPES = [
    "Reichsstrasse",
    "Strasse",
    "Weg",
    "Pfad",
    "Gebirgspass",
    "Wuestenpfad",
    "Flussweg",
    "Seeweg",
] as const;
export type PathSubtype = (typeof PATH_SUBTYPES)[number];

/** Legacys Transportmittel, in einer festen Reihenfolge - sie macht Listen vergleichbar. */
export const TRANSPORTS = [
    "caravan",
    "groupFoot",
    "lightWalker",
    "horseCarriage",
    "groupHorse",
    "lightRider",
    "riverSailer",
    "riverBarge",
    "cargoShip",
    "fastShip",
    "galley",
] as const;
export type Transport = (typeof TRANSPORTS)[number];

export const TRANSPORT_DOMAINS = ["land", "river", "sea", "none"] as const;
export type TransportDomain = (typeof TRANSPORT_DOMAINS)[number];

export interface LegacyFeature {
    geometry?: { type?: string; coordinates?: unknown };
    properties?: Record<string, unknown>;
}

export interface LegacyPayload {
    ok?: boolean;
    revision?: number;
    features?: LegacyFeature[];
}

export interface TransformedPath {
    publicId: string;
    name: string;
    subtype: PathSubtype;
    labelVisible: boolean;
    isBach: boolean;
    /** 'forward', 'reverse' oder null — null heisst "unbekannt", nicht "vorwaerts". */
    flowDirection: "forward" | "reverse" | null;
    /** Stromauf kostet Zeit x Faktor. null = nicht gespeichert (Legacy nimmt dann 2,0). */
    flowFactor: number | null;
    /** null = keine Liste gespeichert; [] = ausdrücklich keins. In TRANSPORTS-Reihenfolge. */
    allowedTransports: Transport[] | null;
    transportDomain: TransportDomain | null;
    transportSeasons: Partial<Record<Transport, SeasonWindow>> | null;
    /** GeoJSON der Linie, im Kartenraum. */
    geojson: string;
}

export interface TransformResult {
    paths: TransformedPath[];
    /** Legacys Kreuzungsobjekte (`junction`/`crossing`): seit Version 3 nur gezählt, nie übernommen. */
    crossingFeatures: number;
    /** Alles, was weder Weg noch Kreuzung ist (Orte, Labels, Kraftlinien, Regionen). */
    skippedOtherTypes: number;
    rejected: { publicId: string; reason: string }[];
}

export class MigrationAborted extends Error {
    readonly detail: Record<string, unknown>;

    constructor(message: string, detail: Record<string, unknown>) {
        super(message);
        this.name = "MigrationAborted";
        this.detail = detail;
    }
}

/**
 * Die Quelle muss vollständig sein, bevor irgendetwas daraus abgeleitet wird.
 *
 * 💣 `ok: false` oder eine fehlende Feature-Liste heißt ABBRUCH, nicht „null Wege". Ein Lauf, der
 * eine leere Antwort als leere Welt liest, legt den ganzen Bestand still.
 *
 * 🔴 Bleibt ein Abbruch (Betreiber 2026-10-03, „A auch für die Prüfungen“, BLOCKING_SOURCE_CHECKS A14): Die Stilllegequote
 * meldet nur noch, dies ist die Bremse gegen einen halben Abruf.
 */
export function assertSourceComplete(payload: LegacyPayload): void {
    if (payload.ok === false) {
        throw new MigrationAborted("the source reports ok=false", { ok: payload.ok });
    }
    if (!Array.isArray(payload.features)) {
        throw new MigrationAborted("the source carries no feature list", {
            keys: Object.keys(payload),
        });
    }
    if (payload.features.length === 0) {
        throw new MigrationAborted("the source carries no features at all", { features: 0 });
    }
}

/** Ist das Objekt eine Kreuzung in Legacy (`junction` oder `crossing`, KD1 im Contract)? */
function isCrossingFeature(properties: Record<string, unknown>): boolean {
    const type = String(properties["feature_type"] ?? "").toLowerCase();
    return type === "junction" || type === "crossing";
}

/**
 * Wie Legacy `show_label` liest — auf BEIDEN Seiten gemessen (Contract, `null_bedeutet_aus`):
 * Der Server nimmt `?? false`, der Client verlangt einen ausdrücklichen Wahrheitswert. Ein
 * fehlender Wert heißt also aus.
 */
function readLabelVisible(value: unknown): boolean {
    return value === true || value === 1 || value === "1";
}

/**
 * Die Fliessrichtung aus `properties.flow` (WI-0010, V11).
 *
 * 🪤 Alles, was nicht 'forward' oder 'reverse' ist, wird zu null — auch ein vorhandenes `flow` mit
 * unbrauchbarem `dir`. Legacy macht genau dasselbe, und null heisst dort "zeichne keinen Pfeil":
 * der Editor sieht sofort, wo die Richtung fehlt. Ein Vorgabewert waere eine erfundene Aussage.
 */
function readFlowDirection(value: unknown): "forward" | "reverse" | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const dir = (value as Record<string, unknown>)["dir"];
    return dir === "forward" || dir === "reverse" ? dir : null;
}

/** Ein Wert, der nicht passt, weist den ganzen Weg zurück - nichts wird still verbogen. */
class Unreadable extends Error {}

/** Der Strömungsfaktor neben der Richtung. Legacys Untergrenze ist 1,0 (path-flow.php). */
function readFlowFactor(value: unknown): number | null {
    if (typeof value !== "object" || value === null || !("factor" in value)) {
        return null;
    }
    const factor = (value as Record<string, unknown>)["factor"];
    if (typeof factor !== "number" || !Number.isFinite(factor) || factor < 1) {
        throw new Unreadable(`Strömungsfaktor ${JSON.stringify(factor)} ist keine Zahl ab 1`);
    }
    return factor;
}

function readAllowedTransports(properties: Record<string, unknown>): Transport[] | null {
    if (!("allowed_transports" in properties)) {
        return null;
    }
    const value = properties["allowed_transports"];
    if (!Array.isArray(value)) {
        throw new Unreadable("allowed_transports ist keine Liste");
    }
    for (const entry of value) {
        if (!(TRANSPORTS as readonly unknown[]).includes(entry)) {
            throw new Unreadable(`unbekanntes Transportmittel ${JSON.stringify(entry)}`);
        }
    }
    // Feste Reihenfolge: zwei Listen mit demselben Inhalt sollen gleich sein, auch in SQL.
    return TRANSPORTS.filter((transport) => value.includes(transport));
}

function readTransportDomain(value: unknown): TransportDomain | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (!(TRANSPORT_DOMAINS as readonly unknown[]).includes(value)) {
        throw new Unreadable(`unbekannte transport_domain ${JSON.stringify(value)}`);
    }
    return value as TransportDomain;
}

function readSeasonDay(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 30) {
        throw new Unreadable(`${field} ${JSON.stringify(value)} ist kein Tag 1..30`);
    }
    return value;
}

function readSeasonMonth(value: unknown, field: string): string {
    if (typeof value !== "string" || !isCalendarMonth(value)) {
        throw new Unreadable(`${field} ${JSON.stringify(value)} ist kein aventurischer Monat`);
    }
    return value as string;
}

function readTransportSeasons(value: unknown): Partial<Record<Transport, SeasonWindow>> | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new Unreadable("transport_seasons ist kein Objekt");
    }
    const source = value as Record<string, unknown>;
    const windows: Partial<Record<Transport, SeasonWindow>> = {};
    for (const key of Object.keys(source)) {
        if (!(TRANSPORTS as readonly string[]).includes(key)) {
            throw new Unreadable(`Saisonfenster für unbekanntes Transportmittel ${key}`);
        }
    }
    for (const transport of TRANSPORTS) {
        const window = source[transport];
        if (window === undefined) continue;
        if (typeof window !== "object" || window === null) {
            throw new Unreadable(`Saisonfenster ${transport} ist kein Objekt`);
        }
        const fields = window as Record<string, unknown>;
        windows[transport] = {
            from_month: readSeasonMonth(fields["from_month"], "from_month"),
            from_day: readSeasonDay(fields["from_day"], "from_day"),
            to_month: readSeasonMonth(fields["to_month"], "to_month"),
            to_day: readSeasonDay(fields["to_day"], "to_day"),
        };
    }
    return windows;
}

export function transformPaths(payload: LegacyPayload): TransformResult {
    const result: TransformResult = {
        paths: [],
        crossingFeatures: 0,
        skippedOtherTypes: 0,
        rejected: [],
    };
    const seen = new Set<string>();

    for (const feature of payload.features ?? []) {
        const properties = feature.properties ?? {};
        const featureType = String(properties["feature_type"] ?? "");

        // Version 3: Kreuzungen nur zählen. Das Netz entsteht aus Orten und Wegen (WI-0132 Release N).
        if (isCrossingFeature(properties)) {
            result.crossingFeatures += 1;
            continue;
        }
        if (featureType !== "path") {
            result.skippedOtherTypes += 1;
            continue;
        }

        const publicId = String(properties["public_id"] ?? "");
        const name = String(properties["name"] ?? "").trim();
        const subtype = String(properties["feature_subtype"] ?? "");

        if (publicId === "") {
            result.rejected.push({ publicId: "(fehlt)", reason: "ohne public_id" });
            continue;
        }
        if (seen.has(publicId)) {
            result.rejected.push({ publicId, reason: "public_id doppelt" });
            continue;
        }
        if (name === "") {
            result.rejected.push({ publicId, reason: "ohne Namen" });
            continue;
        }
        if (!(PATH_SUBTYPES as readonly string[]).includes(subtype)) {
            result.rejected.push({ publicId, reason: `unbekannte Wegart ${subtype || "(leer)"}` });
            continue;
        }
        if (feature.geometry?.type !== "LineString") {
            result.rejected.push({
                publicId,
                reason: `Geometrie ist ${feature.geometry?.type ?? "(keine)"}, erwartet LineString`,
            });
            continue;
        }
        const coordinates = feature.geometry.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            result.rejected.push({ publicId, reason: "weniger als zwei Stützpunkte" });
            continue;
        }

        let routing: Pick<TransformedPath, "flowFactor" | "allowedTransports" | "transportDomain" | "transportSeasons">;
        try {
            routing = {
                flowFactor: readFlowFactor(properties["flow"]),
                allowedTransports: readAllowedTransports(properties),
                transportDomain: readTransportDomain(properties["transport_domain"]),
                transportSeasons: readTransportSeasons(properties["transport_seasons"]),
            };
        } catch (error) {
            if (!(error instanceof Unreadable)) throw error;
            result.rejected.push({ publicId, reason: error.message });
            continue;
        }

        seen.add(publicId);
        result.paths.push({
            publicId,
            name,
            subtype: subtype as PathSubtype,
            labelVisible: readLabelVisible(properties["show_label"]),
            // Ein Bach ist ein Flussweg mit einem Merkmal — das CHECK im Schema hält das fest.
            isBach: properties["is_bach"] === true && subtype === "Flussweg",
            flowDirection: readFlowDirection(properties["flow"]),
            ...routing,
            geojson: JSON.stringify(feature.geometry),
        });
    }

    return result;
}

export interface ImportOptions {
    mapDomainId?: string;
}

export interface RowCounts {
    created: number;
    updated: number;
    /** Zeilen, die der Snapshot genau so beschreibt, wie sie schon dastehen. */
    unchanged: number;
    retired: number;
}

export interface ImportReport extends RowCounts {
    runId: string;
    sourceRef: string;
    /** Legacys Kreuzungsobjekte im Snapshot: gezählt, nicht übernommen (Version 3). */
    crossingsIgnored: number;
    skippedOtherTypes: number;
    rejected: { publicId: string; reason: string }[];
    /** Was der Lauf meldet, ohne anzuhalten (Betreiber 2026-10-03): etwa die Stilllegequote. */
    findings: Finding[];
}

export function importPaths(
    database: Database,
    payload: LegacyPayload,
    options: ImportOptions = {},
): Promise<ImportReport> {
    return withZugSperre(database, options.mapDomainId ?? AVENTURIA.mapDomain, "I5 Wege", () =>
        importPathsLocked(database, payload, options),
    );
}

/** Der Körper von `importPaths`, unter der Sperre des Zugs. */
async function importPathsLocked(
    database: Database,
    payload: LegacyPayload,
    options: ImportOptions = {},
): Promise<ImportReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    assertSourceComplete(payload);
    const transformed = transformPaths(payload);
    const sourceRef = `map_revision=${String(payload.revision ?? "unknown")}`;
    const runId = randomUUID();

    const report: ImportReport = {
        runId,
        sourceRef,
        created: 0,
        updated: 0,
        unchanged: 0,
        retired: 0,
        crossingsIgnored: transformed.crossingFeatures,
        skippedOtherTypes: transformed.skippedOtherTypes,
        rejected: transformed.rejected,
        findings: [],
    };

    await database.begin(async (transaction) => {
        const incomingPaths = transformed.paths.map((path) => path.publicId);

        // Zählen, was dieser Lauf stilllegt — innerhalb der Transaktion, damit die Zahl sich nicht darunter
        // wegbewegt. Über MAX_RETIRE_FRACTION ist das ein Befund mit Namen, kein Abbruch (Betreiber 2026-10-03).
        const [pathPressure] = await transaction<{ active: number; retiring: number }[]>`
            SELECT
                count(*)::int AS active,
                count(*) FILTER (WHERE public_id <> ALL(${incomingPaths}::uuid[]))::int AS retiring
            FROM path
            WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
        `;
        const pathQuota = await retireFinding("path", pathPressure, async () => {
            const rows = await transaction<{ public_id: string; name: string }[]>`
                SELECT public_id::text, name
                FROM path
                WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
                  AND public_id <> ALL(${incomingPaths}::uuid[])
                ORDER BY name, public_id
            `;
            return rows.map((row) => ({ table: "path", publicId: row.public_id, name: row.name }));
        });
        if (pathQuota) report.findings.push(pathQuota);

        await transaction`
            INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
            VALUES (${runId}, 'paths', 'avesmaps-legacy', ${sourceRef}, ${CONTRACT_VERSION})
        `;

        for (const path of transformed.paths) {
            // 💣 Das OBJEKT übergeben, nicht JSON.stringify davon: postgres.js kodiert jsonb-Parameter
            // selbst. Vorkodiert landete das Fenster als JSON-ZEICHENKETTE in der Spalte - der
            // Verifier hat es gefunden (99 von 99 Saisonfenstern).
            const seasons = path.transportSeasons as unknown as string | null;
            const rows = await transaction<{ inserted: boolean }[]>`
                INSERT INTO path (
                    public_id, map_domain_id, name, subtype, label_visible, is_bach, flow_direction,
                    flow_factor, allowed_transports, transport_domain, transport_seasons, geom,
                    source_system, legacy_public_id, migration_run_id, imported_at, is_active
                ) VALUES (
                    ${path.publicId}, ${mapDomainId}, ${path.name}, ${path.subtype},
                    ${path.labelVisible}, ${path.isBach}, ${path.flowDirection},
                    ${path.flowFactor}::numeric, ${path.allowedTransports}::text[], ${path.transportDomain},
                    ${seasons}::jsonb,
                    -- 💣 ST_SetSRID ist nicht optional: ST_GeomFromGeoJSON liefert SRID 4326, auch
                    -- bei Koordinaten 0..1024. Ohne das Setzen bricht jede Verknüpfung mit
                    -- Zielgeometrie ab - und wo sie nicht bricht, rechnet sie falsch.
                    ST_SetSRID(ST_GeomFromGeoJSON(${path.geojson}), 0),
                    'legacy', ${path.publicId}, ${runId}, now(), TRUE
                )
                ON CONFLICT (public_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    subtype = EXCLUDED.subtype,
                    label_visible = EXCLUDED.label_visible,
                    is_bach = EXCLUDED.is_bach,
                    flow_direction = EXCLUDED.flow_direction,
                    flow_factor = EXCLUDED.flow_factor,
                    allowed_transports = EXCLUDED.allowed_transports,
                    transport_domain = EXCLUDED.transport_domain,
                    transport_seasons = EXCLUDED.transport_seasons,
                    -- Legacys Liste mit Legacys Erbe (WI-0069): „vom Editor vollständig geschrieben“ (Migration 0208, F16 „A“) gilt
                    -- für sie nicht mehr.
                    transports_written = FALSE,
                    geom = EXCLUDED.geom,
                    migration_run_id = EXCLUDED.migration_run_id,
                    imported_at = EXCLUDED.imported_at,
                    -- Ein abgenommener Weg (WI-0177 Stufe 3b, off_map) bleibt abgenommen: Der Zug holt ihn nicht zurück
                    -- (EDIT-0003 T43, Claudio). Nur die Testwelt setzt off_map vor dem Zug zurück (editor/testwelt.ts).
                    is_active = NOT path.off_map,
                    updated_at = now()
                -- Nur wenn sich wirklich etwas unterscheidet. Ohne diese Bedingung fasste jeder
                -- Wiederholungslauf jede Zeile an, und „idempotent" hieße „endet gleich" statt
                -- „tut nichts" (Kapitel 9.32).
                WHERE path.name IS DISTINCT FROM EXCLUDED.name
                   OR path.subtype IS DISTINCT FROM EXCLUDED.subtype
                   OR path.label_visible IS DISTINCT FROM EXCLUDED.label_visible
                   OR path.is_bach IS DISTINCT FROM EXCLUDED.is_bach
                   OR path.flow_direction IS DISTINCT FROM EXCLUDED.flow_direction
                   OR path.flow_factor IS DISTINCT FROM EXCLUDED.flow_factor
                   OR path.allowed_transports IS DISTINCT FROM EXCLUDED.allowed_transports
                   OR path.transport_domain IS DISTINCT FROM EXCLUDED.transport_domain
                   OR path.transport_seasons IS DISTINCT FROM EXCLUDED.transport_seasons
                   OR path.transports_written
                   OR path.geom IS DISTINCT FROM EXCLUDED.geom
                   OR path.is_active IS DISTINCT FROM (NOT path.off_map)
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

        const retiredPaths = await transaction<{ public_id: string }[]>`
            UPDATE path SET is_active = FALSE, updated_at = now()
            WHERE map_domain_id = ${mapDomainId}
              AND source_system = 'legacy'
              AND is_active
              AND public_id <> ALL(${incomingPaths}::uuid[])
            RETURNING public_id
        `;
        report.retired = retiredPaths.length;

        await transaction`
            UPDATE migration_run
            SET completed_at = now(), status = 'completed', journal = ${
                {
                    created: report.created,
                    updated: report.updated,
                    unchanged: report.unchanged,
                    retired: report.retired,
                    crossings_ignored: report.crossingsIgnored,
                    skipped_other_types: report.skippedOtherTypes,
                    rejected: report.rejected.length,
                } as unknown as string
            }
            WHERE id = ${runId}
        `;
    });

    return report;
}
