import { randomUUID } from "node:crypto";
import type { KanonObjektart, WikiNamespaceTafel } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { kanonDesTraegers, ladeKanonTraeger } from "../kanon/laden.ts";
import { KANON_ABGELEITET_VON } from "../kanon/neu-berechnen.ts";
import { leseNamespaceTafelImSchnitt } from "../kanon/tafel.ts";
import { wikisyncBereiche } from "../wiki/abgleich/schalter-lesen.ts";
import type { MapFeaturesPayload } from "./map-features.ts";
import {
    ladeKorpusVorgaben,
    legeVorgabeAuf,
    wendeKorpusVorgabeAn,
    type KorpusVorgabeBericht,
} from "./korpus-vorgabe.ts";
import { retireFinding } from "./retire-findings.ts";
import {
    SOURCES_CONTRACT_VERSION,
    transformSources,
    type CanonCarrierKind,
    type CarrierKind,
    type CarrierState,
    type SourceRow,
    type SourceTargets,
    type SourcesTransform,
    type TombstoneRow,
} from "./sources.ts";
import {
    pgArray,
    emptyTableReport,
    syncTable,
    type Cell,
    type Col,
    type SyncSpec,
    type TableReport,
} from "./sync-table.ts";

/**
 * Schreibt Katalog, Korpus, Verknüpfungen und Kanon der Feature-Quellen idempotent in die Zieldatenbank (WI-0063 P3, Vertrag
 * `sources.yaml`, D1).
 *
 * EINE Transaktion für alles (Korpus, Katalog, Verknüpfungen, Kanon, Stilllegen). Der zweite Lauf findet nichts zu schreiben.
 * 🔴 Kartendatenübernahme, nur mit dem Zuruf des Betreibers (Map Mutation Guard); ohne ihn rechnet der Lauf und rollt zurück.
 * 🔴 Fehlt ein Block der Quelle oder ist der Katalog leer, schreibt der Schritt nichts, legt nichts still und meldet
 * `source_block_missing`; der Lauf geht weiter (kein neues Tor, AGENTS.md „Blockierende Prüfungen im Betrieb“).
 *
 * Die Identität der URL-losen Quellen ist vorläufig (`legacy-id:<id>`), bis Legacy den Wiki-Schlüssel liefert (E1). Ändert
 * Legacy zwischen zwei Zügen die Nummer einer Zeile (Zusammenführung), findet der Fingerabdruck sie wieder.
 */

export const SOURCE_TABLES = [
    "source_corpus",
    "feature_source",
    "place_source",
    "path_source",
    "territory_source",
    "region_source",
    "terrain_peak_source",
    "place_canon",
    "path_canon",
    "territory_canon",
    "region_canon",
    "terrain_peak_canon",
    "powerline_canon",
] as const;

export type SourceTable = (typeof SOURCE_TABLES)[number];

export interface ImportSourcesOptions {
    /** Rechnen und zählen, dann zurückrollen (auch das Journal). */
    dryRun?: boolean;
}

export interface SourceIdentityReport {
    /** Vorläufige Identitäten, die der Fingerabdruck nach einer Legacy-Zusammenführung wiedergefunden hat. */
    rematched: number;
    /** Vorläufige Zeilen, die nicht wiederzufinden waren (neue Zeile, alte stillgelegt). */
    lost: number;
    /** Vorläufige Identitäten, die Legacys Wiki-Schlüssel (E1) endgültig gemacht hat. */
    resolved: number;
}

export interface ImportSourcesReport {
    runId: string;
    sourceRef: string;
    revision: number;
    dryRun: boolean;
    /** Die Quellenblöcke fehlten oder der Katalog war leer: nichts geschrieben, nichts stillgelegt. */
    skipped: boolean;
    tables: Record<SourceTable, TableReport>;
    identity: SourceIdentityReport;
    /** Die unterdrückten Verknüpfungen aus dem E1+-Block (alle fünf Verknüpfungstabellen zusammen); nie wieder belebt. */
    tombstones: { created: number; updated: number; unchanged: number; block: "absent" | "present" | "unusable" };
    /** Die Vorgabe der Belegstellen-Korpora, nach dem Abgleich erneut auf die Quellen gerechnet (WI-0254, Runde 4; `korpus-vorgabe.ts`). */
    korpusVorgabe: KorpusVorgabeBericht;
    changed: boolean;
    findings: Finding[];
}

export interface SourceCarrierIds {
    place: Map<string, string>;
    path: Map<string, string>;
    territory: Map<string, string>;
    region: Map<string, string>;
    terrain_peak: Map<string, string>;
    powerline: Map<string, string>;
}

const CARRIER_TABLES: Record<CanonCarrierKind, string> = {
    place: "place",
    path: "path",
    territory: "territory",
    region: "region",
    terrain_peak: "terrain_peak",
    powerline: "powerline",
};

/** Liest die Träger: ihren Zustand (auch stillgelegte) für die Auflösung und die Ids der aktiven für die Fremdschlüssel. */
export async function readSourceCarriers(
    database: Queryable,
): Promise<{ ids: SourceCarrierIds; targets: SourceTargets }> {
    const states: Record<CanonCarrierKind, Map<string, CarrierState>> = {
        place: new Map(),
        path: new Map(),
        territory: new Map(),
        region: new Map(),
        terrain_peak: new Map(),
        powerline: new Map(),
    };
    const ids: SourceCarrierIds = {
        place: new Map(),
        path: new Map(),
        territory: new Map(),
        region: new Map(),
        terrain_peak: new Map(),
        powerline: new Map(),
    };
    for (const kind of Object.keys(CARRIER_TABLES) as CanonCarrierKind[]) {
        const rows = await database.unsafe<
            { id: string; public_id: string; is_active: boolean; name: string | null }[]
        >(`SELECT id::text, public_id::text, is_active, name FROM ${CARRIER_TABLES[kind]}`);
        for (const row of rows) {
            states[kind].set(row.public_id, { active: row.is_active, name: row.name });
            if (row.is_active) ids[kind].set(row.public_id, row.id);
        }
    }
    const labels = await database<{ public_id: string }[]>`SELECT public_id::text FROM map_label`;
    const keys = await database<{ key: string }[]>`SELECT key FROM license_catalog`;
    return {
        ids,
        targets: {
            places: states.place,
            paths: states.path,
            territories: states.territory,
            regions: states.region,
            peaks: states.terrain_peak,
            powerlines: states.powerline,
            labels: new Set(labels.map((row) => row.public_id)),
            licenseKeys: new Set(keys.map((row) => row.key)),
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Spalten und Schlüssel
// ---------------------------------------------------------------------------------------------------------------------

const text = (name: string): Col => ({ name, type: "text" });
const first = (cells: readonly Cell[]): string => String(cells[0]);
const pair = (cells: readonly Cell[]): string => `${String(cells[0])}|${String(cells[1])}`;

export const CORPUS_COLUMNS: readonly Col[] = [text("corpus_key"), text("label"), text("form")];
export const SOURCE_COLUMNS: readonly Col[] = [
    text("source_key"),
    text("identity_state"),
    { name: "legacy_source_id", type: "bigint" },
    text("url"),
    text("title"),
    text("source_type"),
    { name: "is_official", type: "boolean" },
    text("license_statement"),
    text("license_key"),
    text("attribution"),
    text("corpus_key"),
];
const linkColumns = (carrierColumn: string): readonly Col[] => [
    { name: carrierColumn, type: "bigint" },
    { name: "source_id", type: "bigint" },
    text("reference_kind"),
    text("pages"),
    text("note"),
    text("legacy_origin"),
    { name: "position", type: "int" },
];
const canonColumns = (carrierColumn: string): readonly Col[] => [
    { name: carrierColumn, type: "bigint" },
    text("canon"),
    text("designator_type"),
    { name: "designator_count", type: "int" },
    text("designator_label"),
    text("derived_from"),
    { name: "source_revision", type: "bigint" },
];

const LINK_TABLES: Record<CarrierKind, { table: SourceTable; carrierColumn: string }> = {
    place: { table: "place_source", carrierColumn: "place_id" },
    path: { table: "path_source", carrierColumn: "path_id" },
    territory: { table: "territory_source", carrierColumn: "territory_id" },
    region: { table: "region_source", carrierColumn: "region_id" },
    terrain_peak: { table: "terrain_peak_source", carrierColumn: "terrain_peak_id" },
};
const CANON_TABLES: Record<CanonCarrierKind, { table: SourceTable; carrierColumn: string }> = {
    place: { table: "place_canon", carrierColumn: "place_id" },
    path: { table: "path_canon", carrierColumn: "path_id" },
    territory: { table: "territory_canon", carrierColumn: "territory_id" },
    region: { table: "region_canon", carrierColumn: "region_id" },
    terrain_peak: { table: "terrain_peak_canon", carrierColumn: "terrain_peak_id" },
    powerline: { table: "powerline_canon", carrierColumn: "powerline_id" },
};

export function linkSpec(kind: CarrierKind): SyncSpec {
    const { table, carrierColumn } = LINK_TABLES[kind];
    return {
        table,
        columns: linkColumns(carrierColumn),
        keyOf: pair,
        activeSet: "state = 'active'",
        retiredSet: "state = 'retired'",
        insertConstants: { state: "'active'" },
        // Ein Tombstone (state suppressed, Kapitel 9.37) bleibt, was er ist: Legacy exportiert ihn nicht, der Import hebt ihn nie auf.
        // Eine Verknüpfung, die die Redaktion angelegt oder geändert hat (`source_system editor`, Fenster „Inhalte bearbeiten“, WI-0254), fasst er
        // ebenso wenig an und legt sie nicht still: manuell schlägt Wiki.
        protectedWhere: "t.state = 'suppressed' OR t.source_system = 'editor'",
        describe: {
            join: `JOIN ${CARRIER_TABLES[kind]} c ON c.id = t.${carrierColumn}`,
            publicId: "c.public_id::text",
            name: "c.name",
        },
    };
}

export function canonSpec(kind: CanonCarrierKind): SyncSpec {
    const { table, carrierColumn } = CANON_TABLES[kind];
    return {
        table,
        columns: canonColumns(carrierColumn),
        keyOf: first,
        lifecycle: "derived",
        describe: {
            join: `JOIN ${CARRIER_TABLES[kind]} c ON c.id = t.${carrierColumn}`,
            publicId: "c.public_id::text",
            name: "c.name",
        },
    };
}

/** Die Trägerart der Kanon-Regel (`kanon/laden.ts`) zu jeder Kanon-Tafel des Imports. */
const KANON_ART: Record<CanonCarrierKind, KanonObjektart> = {
    place: "place",
    path: "path",
    territory: "territory",
    region: "area",
    terrain_peak: "peak",
    powerline: "powerline",
};

/** Eine Zeile `<träger>_canon`, wie die Regel sie sagt: die Zellen in der Folge von `canonColumns`. */
export interface KanonNachRegel {
    publicId: string;
    cells: Cell[];
}

/**
 * Die Kanon-Zeilen einer Trägerart nach der Regel von Avesmaps3D (Rang 1 bis 3, `kanon/ableitung.ts`, Regelstand `avesmaps`: ohne
 * Wiki-Zuweisung zählen Publikationen wie Quellen), aus dem Stand, den `db` sieht. Dieselbe Rechnung wie beim Bearbeiten
 * (`inhalte/kanon-folgen.ts`) und `npm run kanon:neu`. Ein Träger, zu dem Rang 1 bis 3 nichts sagen, hat keine Zeile (Rang 4 beim Lesen).
 */
export async function kanonNachRegel(
    db: Queryable,
    kind: CanonCarrierKind,
    tafel: WikiNamespaceTafel,
): Promise<KanonNachRegel[]> {
    const zeilen: KanonNachRegel[] = [];
    for (const traeger of await ladeKanonTraeger(db, KANON_ART[kind], tafel)) {
        const ergebnis = kanonDesTraegers(traeger, tafel, "avesmaps");
        if (ergebnis === null) continue;
        zeilen.push({
            publicId: traeger.publicId,
            cells: [
                traeger.id,
                ergebnis.kanon,
                ergebnis.designatorType,
                ergebnis.designatorCount,
                ergebnis.designatorLabel,
                KANON_ABGELEITET_VON,
                null,
            ],
        });
    }
    return zeilen;
}

class DryRunRollback extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// Der Import
// ---------------------------------------------------------------------------------------------------------------------

export async function importSources(
    database: Database,
    payload: MapFeaturesPayload,
    options: ImportSourcesOptions = {},
): Promise<ImportSourcesReport> {
    const runId = randomUUID();
    const sourceRef = `map_revision=${String(payload.revision ?? "unknown")}`;
    const tables = Object.fromEntries(SOURCE_TABLES.map((name) => [name, emptyTableReport()])) as Record<
        SourceTable,
        TableReport
    >;
    const report: ImportSourcesReport = {
        runId,
        sourceRef,
        revision: Number(payload.revision),
        dryRun: options.dryRun === true,
        skipped: false,
        tables,
        identity: { rematched: 0, lost: 0, resolved: 0 },
        tombstones: { created: 0, updated: 0, unchanged: 0, block: "absent" },
        korpusVorgabe: { korpora: 0, quellen: 0 },
        changed: false,
        findings: [],
    };

    // 🔴 WI-0253, Scheibe Quellen: Gehören die Quellen in dieser Umgebung dem WikiSync, lässt der Zug sie aus (Vali 2026-10-25: „danach lässt der Legacy-Zug diesen Bereich in dieser
    // Umgebung aus“) – Katalog, Korpora, Verknüpfungen und Kanon. Der Bericht ist der eines übersprungenen Schritts; ein Befund sagt, warum.
    if ((await wikisyncBereiche(database)).has("quelle")) {
        report.skipped = true;
        report.findings.push(
            createFinding(
                "bereich_wikisync",
                "Die Quellen gehören in dieser Umgebung dem WikiSync; der Zug lässt sie aus (Katalog, Korpora, Verknüpfungen, Kanon)",
                { bereich: "quelle" },
            ),
        );
        return report;
    }

    try {
        await database.begin(async (transaction) => {
            const { ids, targets } = await readSourceCarriers(transaction);
            // A13 steht in der Umwandlung: eine unvollständige Quelle hält an, bevor etwas geschrieben ist.
            const transformed = transformSources(payload, targets);
            report.findings.push(...transformed.findings);
            if (transformed.skipped) {
                report.skipped = true;
                return;
            }

            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'sources', 'avesmaps-legacy', ${sourceRef}, ${SOURCES_CONTRACT_VERSION})
            `;
            await writeAll(transaction, runId, ids, transformed, report);

            report.tombstones.block = transformed.tombstoneBlock;
            report.changed =
                Object.values(tables).some((table) => table.created + table.updated + table.retired > 0) ||
                report.tombstones.created + report.tombstones.updated > 0;
            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        tables,
                        identity: report.identity,
                        tombstones: report.tombstones,
                        dry_run: report.dryRun,
                        findings: report.findings.map((finding) => finding.code),
                    } as unknown as string
                }
                WHERE id = ${runId}
            `;
            if (options.dryRun) throw new DryRunRollback();
        });
    } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
    }
    return report;
}

interface Expected {
    cells: Cell[];
    ref: FindingObject;
}

async function runTable(
    transaction: Queryable,
    runId: string,
    report: ImportSourcesReport,
    name: SourceTable,
    spec: SyncSpec,
    rows: readonly Expected[],
    labels: { vsDecision: string; reappeared: string },
): Promise<Map<string, string>> {
    const result = await syncTable(
        transaction,
        spec,
        rows.map((row) => row.cells),
        { runId },
    );
    const table = report.tables[name];
    table.created = result.created;
    table.updated = result.updated;
    table.unchanged = result.unchanged;
    table.retired = result.retired;
    table.protectedRows = result.protectedHits.length;
    table.reappeared = result.reappeared.length;
    const refByKey = new Map(rows.map((row) => [spec.keyOf(row.cells), row.ref]));
    const objectsOf = (keys: readonly string[]): FindingObject[] =>
        keys.map((key) => refByKey.get(key)).filter((ref): ref is FindingObject => ref !== undefined);
    const quota = await retireFinding(name, result.pressure, async () => result.retiring);
    if (quota) report.findings.push(quota);
    if (result.protectedHits.length > 0) {
        report.findings.push(
            createFinding(
                labels.vsDecision,
                `${name}: der Satz bringt ${String(result.protectedHits.length)} Verknüpfungen, die ein Tombstone oder ein Editor-Entscheid hält; die Zeile bleibt`,
                { table: name, zeilen: result.protectedHits.length },
                objectsOf(result.protectedHits),
            ),
        );
    }
    if (result.reappeared.length > 0) {
        report.findings.push(
            createFinding(
                labels.reappeared,
                `${name}: ${String(result.reappeared.length)} Zeilen, die der Import stillgelegt hatte, sind wieder da`,
                { table: name, zeilen: result.reappeared.length },
                objectsOf(result.reappeared),
            ),
        );
    }
    return result.idByKey;
}

interface ExistingSource {
    id: string;
    sourceKey: string;
    identityState: string;
    legacyId: string | null;
    title: string;
    sourceType: string;
    isOfficial: boolean;
    isActive: boolean;
}

/** Der Fingerabdruck einer Quelle: Titel, Art, offiziell und die Menge der zitierenden Träger. */
export function fingerprint(row: {
    title: string;
    sourceType: string;
    isOfficial: boolean;
    carriers: readonly string[];
}): string {
    return JSON.stringify([row.title, row.sourceType, row.isOfficial, [...row.carriers].sort()]);
}

/**
 * Wiederfinden der URL-losen Quellen (Vertrag `url_lose_quellen.mechanik`): Zuordnung über `legacy-id:<id>`; für den Rest der
 * Fingerabdruck. Genau ein Treffer auf beiden Seiten, dann neu zugeordnet (der Schlüssel wandert an der Zeile mit, die Id und
 * alle Verknüpfungen bleiben); sonst entsteht eine neue Zeile, und die alte wird stillgelegt. Mit Legacys Wiki-Schlüssel (E1)
 * wird eine vorläufige Zeile an Ort und Stelle endgültig.
 */
async function resolveIdentity(
    transaction: Queryable,
    transformed: SourcesTransform,
    report: ImportSourcesReport,
): Promise<void> {
    const existing = await transaction<
        {
            id: string;
            source_key: string;
            identity_state: string;
            legacy_source_id: string | null;
            title: string;
            source_type: string;
            is_official: boolean;
            is_active: boolean;
        }[]
    >`SELECT id::text, source_key, identity_state, legacy_source_id::text, title, source_type, is_official, is_active FROM feature_source`;
    const rows: ExistingSource[] = existing.map((row) => ({
        id: row.id,
        sourceKey: row.source_key,
        identityState: row.identity_state,
        legacyId: row.legacy_source_id,
        title: row.title,
        sourceType: row.source_type,
        isOfficial: row.is_official,
        isActive: row.is_active,
    }));
    const byKey = new Map(rows.map((row) => [row.sourceKey, row]));
    const expectedKeys = new Set(transformed.sources.map((source) => source.sourceKey));
    const rekeys: { id: string; key: string; legacyId: number | null; state: string }[] = [];
    const claimed = new Set<string>();

    // E1: eine vorläufige Zeile wird mit dem Wiki-Schlüssel endgültig, an Ort und Stelle.
    const resolvedNow: SourceRow[] = [];
    for (const source of transformed.sources) {
        if (!source.sourceKey.startsWith("wikipub:") || byKey.has(source.sourceKey) || source.legacyId === null)
            continue;
        const old = byKey.get(`legacy-id:${String(source.legacyId)}`);
        if (!old || !old.isActive || old.identityState !== "provisional" || claimed.has(old.id)) continue;
        claimed.add(old.id);
        rekeys.push({ id: old.id, key: source.sourceKey, legacyId: source.legacyId, state: "final" });
        resolvedNow.push(source);
    }
    report.identity.resolved = resolvedNow.length;
    if (resolvedNow.length > 0) {
        report.findings.push(
            createFinding(
                "source_identity_resolved",
                `${String(resolvedNow.length)} vorläufige Identitäten sind mit Legacys Wiki-Schlüssel endgültig geworden (wikipub); die Id und alle Verknüpfungen bleiben`,
                { quellen: resolvedNow.length },
                resolvedNow.map((source) => ({
                    table: "feature_source",
                    publicId: source.sourceKey,
                    name: source.title,
                })),
            ),
        );
    }

    // Fingerabdruck für die vorläufigen Zeilen, die der Satz unter ihrer Nummer nicht mehr kennt.
    const candidates = rows.filter(
        (row) =>
            row.isActive &&
            row.identityState === "provisional" &&
            !expectedKeys.has(row.sourceKey) &&
            !claimed.has(row.id),
    );
    const newcomers = transformed.sources.filter(
        (source) => source.identityState === "provisional" && !byKey.has(source.sourceKey),
    );
    if (candidates.length > 0) {
        const carriers = await carriersBySource(
            transaction,
            candidates.map((row) => row.id),
        );
        const oldByPrint = new Map<string, ExistingSource[]>();
        for (const row of candidates) {
            const print = fingerprint({ ...row, carriers: carriers.get(row.id) ?? [] });
            oldByPrint.set(print, [...(oldByPrint.get(print) ?? []), row]);
        }
        const newByPrint = new Map<string, SourceRow[]>();
        for (const source of newcomers) {
            const print = fingerprint(source);
            newByPrint.set(print, [...(newByPrint.get(print) ?? []), source]);
        }
        const rematched: SourceRow[] = [];
        for (const [print, olds] of oldByPrint) {
            const news = newByPrint.get(print) ?? [];
            if (olds.length === 1 && news.length === 1) {
                const old = olds[0] as ExistingSource;
                const fresh = news[0] as SourceRow;
                claimed.add(old.id);
                rekeys.push({ id: old.id, key: fresh.sourceKey, legacyId: fresh.legacyId, state: "provisional" });
                rematched.push(fresh);
            }
        }
        const lost = candidates.filter((row) => !claimed.has(row.id));
        report.identity.rematched = rematched.length;
        report.identity.lost = lost.length;
        if (rematched.length > 0) {
            report.findings.push(
                createFinding(
                    "source_identity_rematched",
                    `${String(rematched.length)} URL-lose Quellen sind nach einer Legacy-Zusammenführung über den Fingerabdruck wiedergefunden (neue Nummer, gleiche Zeile)`,
                    { quellen: rematched.length },
                    rematched.map((source) => ({
                        table: "feature_source",
                        publicId: source.sourceKey,
                        name: source.title,
                    })),
                ),
            );
        }
        if (lost.length > 0) {
            report.findings.push(
                createFinding(
                    "source_identity_lost",
                    `${String(lost.length)} vorläufige Quellen sind nicht wiederzufinden: neue Zeile, die alte wird stillgelegt`,
                    { quellen: lost.length },
                    lost.map((row) => ({ table: "feature_source", publicId: row.sourceKey, name: row.title })),
                ),
            );
        }
    }

    if (rekeys.length > 0) {
        await transaction.unsafe(
            `UPDATE feature_source AS s SET source_key = v.source_key, legacy_source_id = v.legacy_source_id, identity_state = v.identity_state, updated_at = now() ` +
                `FROM unnest($1::bigint[], $2::text[], $3::bigint[], $4::text[]) AS v(id, source_key, legacy_source_id, identity_state) ` +
                `WHERE s.id = v.id`,
            [
                pgArray(rekeys.map((entry) => entry.id)),
                pgArray(rekeys.map((entry) => entry.key)),
                pgArray(rekeys.map((entry) => entry.legacyId)),
                pgArray(rekeys.map((entry) => entry.state)),
            ],
        );
    }
}

/** Die aktiven Träger, die eine Quelle zitieren, für den Fingerabdruck (`<Art>:<öffentliche ID>`, sortiert). */
async function carriersBySource(transaction: Queryable, sourceIds: readonly string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    for (const kind of Object.keys(LINK_TABLES) as CarrierKind[]) {
        const { table, carrierColumn } = LINK_TABLES[kind];
        const rows = await transaction.unsafe<{ source_id: string; public_id: string }[]>(
            `SELECT l.source_id::text AS source_id, c.public_id::text AS public_id FROM ${table} l JOIN ${CARRIER_TABLES[kind]} c ON c.id = l.${carrierColumn} ` +
                `WHERE l.is_active AND l.source_id = ANY($1::bigint[])`,
            [pgArray(sourceIds)],
        );
        for (const row of rows) {
            const list = result.get(row.source_id) ?? [];
            list.push(`${kind}:${row.public_id}`);
            result.set(row.source_id, list);
        }
    }
    return result;
}

/**
 * Die unterdrückten Verknüpfungen (E1+) einer Trägerart: Eine fehlende Zeile wird als Tombstone angelegt (`state suppressed`,
 * `retired_origin import`); eine aktive oder vom Import stillgelegte wird zum Tombstone; ein Tombstone bleibt einer und trägt nur
 * Legacys Herkunft nach. Eine Zeile, die ein Editor stillgelegt hat, fasst der Import nie an. Wiederbelebt wird nichts.
 */
async function syncTombstones(
    transaction: Queryable,
    runId: string,
    kind: CarrierKind,
    rows: readonly TombstoneRow[],
    carrierIds: ReadonlyMap<string, string>,
    sourceIds: ReadonlyMap<string, string>,
    report: ImportSourcesReport,
): Promise<void> {
    if (rows.length === 0) return;
    const { table, carrierColumn } = LINK_TABLES[kind];
    const expected = new Map<string, { row: TombstoneRow; carrierId: string; sourceId: string }>();
    for (const row of rows) {
        const carrierId = carrierIds.get(row.carrierPublicId);
        const sourceId = sourceIds.get(row.sourceKey);
        if (carrierId === undefined || sourceId === undefined) {
            throw new Error(
                `${table}: Träger ${row.carrierPublicId} oder Quelle ${row.sourceKey} fehlt (die Umwandlung hat beide geprüft)`,
            );
        }
        expected.set(`${carrierId}|${sourceId}`, { row, carrierId, sourceId });
    }
    const pairs = [...expected.values()];
    const existing = await transaction.unsafe<
        {
            id: string;
            carrier: string;
            source: string;
            state: string;
            retired_origin: string | null;
            legacy_origin: string | null;
        }[]
    >(
        `SELECT t.id::text AS id, t.${carrierColumn}::text AS carrier, t.source_id::text AS source, t.state, t.retired_origin, t.legacy_origin ` +
            `FROM ${table} t JOIN unnest($1::bigint[], $2::bigint[]) AS v(c, s) ON t.${carrierColumn} = v.c AND t.source_id = v.s`,
        [pgArray(pairs.map((pair) => pair.carrierId)), pgArray(pairs.map((pair) => pair.sourceId))],
    );
    const byPair = new Map(existing.map((row) => [`${row.carrier}|${row.source}`, row]));
    const toInsert: typeof pairs = [];
    const toConvert: { id: string; legacyOrigin: string | null }[] = [];
    const toRelabel: { id: string; legacyOrigin: string | null }[] = [];
    for (const [key, entry] of expected) {
        const row = byPair.get(key);
        if (!row) {
            toInsert.push(entry);
        } else if (row.state === "suppressed") {
            if (row.legacy_origin === entry.row.legacyOrigin) report.tombstones.unchanged += 1;
            else toRelabel.push({ id: row.id, legacyOrigin: entry.row.legacyOrigin });
        } else if (row.state === "retired" && row.retired_origin === "editor") {
            report.tombstones.unchanged += 1;
        } else {
            toConvert.push({ id: row.id, legacyOrigin: entry.row.legacyOrigin });
        }
    }
    if (toInsert.length > 0) {
        await transaction.unsafe(
            `INSERT INTO ${table} (${carrierColumn}, source_id, reference_kind, pages, note, legacy_origin, position, state, is_active, retired_at, retired_origin, source_system, migration_run_id, imported_at) ` +
                `SELECT v.c, v.s, v.reference_kind, v.pages, v.note, v.legacy_origin, v.position, 'suppressed', FALSE, now(), 'import', 'legacy', $8::uuid, now() ` +
                `FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[], $7::integer[]) AS v(c, s, reference_kind, pages, note, legacy_origin, position)`,
            [
                pgArray(toInsert.map((entry) => entry.carrierId)),
                pgArray(toInsert.map((entry) => entry.sourceId)),
                pgArray(toInsert.map((entry) => entry.row.referenceKind)),
                pgArray(toInsert.map((entry) => entry.row.pages)),
                pgArray(toInsert.map((entry) => entry.row.note)),
                pgArray(toInsert.map((entry) => entry.row.legacyOrigin)),
                pgArray(toInsert.map((entry) => entry.row.position)),
                runId,
            ],
        );
        report.tombstones.created += toInsert.length;
    }
    if (toConvert.length > 0) {
        await transaction.unsafe(
            `UPDATE ${table} AS t SET state = 'suppressed', is_active = FALSE, retired_at = COALESCE(t.retired_at, now()), retired_origin = 'import', ` +
                `legacy_origin = v.legacy_origin, migration_run_id = $3::uuid, imported_at = now(), updated_at = now() ` +
                `FROM unnest($1::bigint[], $2::text[]) AS v(id, legacy_origin) WHERE t.id = v.id`,
            [pgArray(toConvert.map((entry) => entry.id)), pgArray(toConvert.map((entry) => entry.legacyOrigin)), runId],
        );
        report.tombstones.updated += toConvert.length;
    }
    if (toRelabel.length > 0) {
        await transaction.unsafe(
            `UPDATE ${table} AS t SET legacy_origin = v.legacy_origin, migration_run_id = $3::uuid, imported_at = now(), updated_at = now() ` +
                `FROM unnest($1::bigint[], $2::text[]) AS v(id, legacy_origin) WHERE t.id = v.id`,
            [pgArray(toRelabel.map((entry) => entry.id)), pgArray(toRelabel.map((entry) => entry.legacyOrigin)), runId],
        );
        report.tombstones.updated += toRelabel.length;
    }
}

async function writeAll(
    transaction: Queryable,
    runId: string,
    ids: SourceCarrierIds,
    transformed: SourcesTransform,
    report: ImportSourcesReport,
): Promise<void> {
    const sourceRef = (row: { sourceKey: string; title: string }): FindingObject => ({
        table: "feature_source",
        publicId: row.sourceKey,
        name: row.title === "" ? null : row.title,
    });

    // ---- Korpus -----------------------------------------------------------------------------------------------------
    // Der Import führt Name und Form; Lizenz und Namensnennung eines Korpus exportiert Legacy nicht und fasst er nie an.
    await runTable(
        transaction,
        runId,
        report,
        "source_corpus",
        {
            table: "source_corpus",
            columns: CORPUS_COLUMNS,
            keyOf: first,
            idColumn: "corpus_key",
            idType: "text",
            // Ein Korpus, den die Redaktion angelegt oder geändert hat (WI-0254), bleibt, wie sie ihn hinterließ.
            protectedWhere: "t.source_system = 'editor'",
            describe: { join: "", publicId: "t.corpus_key", name: "t.label" },
        },
        transformed.corpora.map((row) => ({
            ref: { table: "source_corpus", publicId: row.corpusKey, name: row.label === "" ? null : row.label },
            cells: [row.corpusKey, row.label, row.form],
        })),
        { vsDecision: "link_vs_decision", reappeared: "link_reappeared" },
    );

    // ---- Katalog ----------------------------------------------------------------------------------------------------
    const vorgaben = await ladeKorpusVorgaben(transaction);
    await resolveIdentity(transaction, transformed, report);
    const sourceIds = await runTable(
        transaction,
        runId,
        report,
        "feature_source",
        {
            table: "feature_source",
            columns: SOURCE_COLUMNS,
            keyOf: first,
            // Eine Quelle, die die Redaktion angelegt oder geändert hat (`source_system editor`, WI-0254), fasst der Zug weder an noch legt er
            // sie still: manuell schlägt Wiki (Kapitel 9.37). Die Stammdaten ändert dann nur noch die Redaktion.
            protectedWhere: "t.source_system = 'editor'",
            describe: { join: "", publicId: "t.source_key", name: "t.title" },
        },
        transformed.sources.map((roh) => {
            // Die Vorgabe eines Belegstellen-Korpus liegt schon auf der erwarteten Zeile: Der Abgleich sieht eine Quelle mit der Vorgabe als unverändert (WI-0254, Runde 4).
            const row = legeVorgabeAuf(roh, roh.corpusKey === null ? undefined : vorgaben.get(roh.corpusKey));
            return {
                ref: sourceRef(row),
                cells: [
                    row.sourceKey,
                    row.identityState,
                    row.legacyId,
                    row.url,
                    row.title,
                    row.sourceType,
                    row.isOfficial,
                    row.licenseStatement,
                    row.licenseKey,
                    row.attribution,
                    row.corpusKey,
                ],
            };
        }),
        { vsDecision: "link_vs_decision", reappeared: "link_reappeared" },
    );

    // ---- Vorgabe der Belegstellen-Korpora (WI-0254, Runde 4): nach dem Abgleich der Quellen erneut auf die Quellen gerechnet ----------
    report.korpusVorgabe = await wendeKorpusVorgabeAn(transaction);

    // ---- Verknüpfungen, je Trägerart ---------------------------------------------------------------------------------
    for (const kind of Object.keys(LINK_TABLES) as CarrierKind[]) {
        const { table } = LINK_TABLES[kind];
        // Zuerst die Tombstones (E1+): Eine unterdrückte Verknüpfung ist danach geschützt und wird weder stillgelegt noch belebt.
        await syncTombstones(
            transaction,
            runId,
            kind,
            transformed.tombstones.filter((entry) => entry.kind === kind),
            ids[kind],
            sourceIds,
            report,
        );
        const rows: Expected[] = [];
        for (const link of transformed.links.filter((entry) => entry.kind === kind)) {
            const carrierId = ids[kind].get(link.carrierPublicId);
            const sourceId = sourceIds.get(link.sourceKey);
            if (carrierId === undefined || sourceId === undefined) {
                throw new Error(
                    `${table}: Träger ${link.carrierPublicId} oder Quelle ${link.sourceKey} fehlt (die Umwandlung hat beide geprüft)`,
                );
            }
            rows.push({
                ref: { table: kind, publicId: link.carrierPublicId, name: link.carrierName },
                cells: [
                    carrierId,
                    sourceId,
                    link.referenceKind,
                    link.pages,
                    link.note,
                    link.legacyOrigin,
                    link.position,
                ],
            });
        }
        await runTable(transaction, runId, report, table, linkSpec(kind), rows, {
            vsDecision: "link_vs_decision",
            reappeared: "link_reappeared",
        });
    }

    // ---- Kanon (abgeleitet), je Trägerart ------------------------------------------------------------------------------
    // 🔴 Nach der Regel von Avesmaps3D, nicht nach Legacys Ergebnis (OPS-000066, Vali 2026-10-30: „OPS-066 A aber mit production und stage
    // oder?“): Legacy zählt Publikationen nicht, die Regel vom 2026-10-25 schon. Gerechnet aus den Verknüpfungen, Quellen und Wiki-Zuweisungen,
    // wie sie nach den Schritten oben in DIESER Transaktion stehen. Legacys `feature_kanon` bleibt in der Umwandlung (Befunde, Orakel), wird
    // aber nicht mehr geschrieben.
    const tafel = await leseNamespaceTafelImSchnitt(transaction);
    for (const kind of Object.keys(CANON_TABLES) as CanonCarrierKind[]) {
        const { table } = CANON_TABLES[kind];
        const rows: Expected[] = (await kanonNachRegel(transaction, kind, tafel)).map((zeile) => ({
            ref: { table: kind, publicId: zeile.publicId, name: null },
            cells: zeile.cells,
        }));
        await runTable(transaction, runId, report, table, canonSpec(kind), rows, {
            vsDecision: "link_vs_decision",
            reappeared: "link_reappeared",
        });
    }
}
