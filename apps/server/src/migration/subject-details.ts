import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { assertMapFeaturesUsable, type MapFeaturesPayload } from "./map-features.ts";

/**
 * Direkte Detailfelder und Wiki-Zuordnung der Subjects: die reine Umwandlung des Satzes in Zeilen (WI-0063 P3, Vertrag
 * `project-control/migration/contracts/subject-details.yaml`, D6).
 *
 * Quelle ist dieselbe `map-features.json` wie bei Orten, Wegen, Kraftlinien und Gelände-Eingaben, kein neuer Abruf. Diese Datei
 * kennt weder Datenbank noch Netz: Was sie über die Träger wissen muss (welche Orte, Wege, Kraftlinien, Beschriftungen und
 * Gipfel es in Avesmaps3D aktiv gibt), bekommt sie als `CarrierTargets` hereingereicht. So bleibt sie mit kleinen
 * synthetischen Sätzen prüfbar, und der Prüfer rechnet dieselbe Funktion noch einmal.
 *
 * 🔴 Nichts wird geraten, nichts repariert. Legacy exportiert für Kartenträger genau drei Aussagen: ein Nest mit Schlüssel
 * (zugewiesen), nur eine Adresse (von Hand getippt) und nichts. Der Zustand „bewusst getrennt“ und „unterdrückt“ ist KEIN
 * Datum des Exports und wird nie geschrieben; die Herkunft der Zuordnung ist `unknown`, außer beim Weg (`source`).
 * Was redaktionell auffällig aussieht, steht als Befund (AGENTS.md, Cutoff-Regel).
 */

export const SUBJECT_DETAILS_CONTRACT_VERSION = "1";

export type WikiState = "assigned" | "address_only";
export type WikiOrigin = "legacy_editor" | "legacy_verlauf_sync" | "unknown";
export type FieldOrigin = "wiki" | "manual";

/** Die Richtungen, die Legacys Nachbarobjekt kennt, in fester Reihenfolge. */
export const NEIGHBOR_DIRECTIONS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"] as const;

/** Was Avesmaps3D an Trägern aktiv hat. Kleinbuchstaben-UUIDs. */
export interface CarrierTargets {
    places: ReadonlySet<string>;
    paths: ReadonlySet<string>;
    powerlines: ReadonlySet<string>;
    /** `map_label`-Zeilen (gebundene Beschriftungen): öffentliche ID, ob aktiv. */
    labels: ReadonlyMap<string, boolean>;
    /** `terrain_peak`-Zeilen (Gipfel, Vulkane, freie Beschriftungen): öffentliche ID, ob aktiv. */
    peaks: ReadonlyMap<string, boolean>;
}

export interface TrafficLinkRow {
    position: number;
    linkText: string;
    pathName: string;
}

export interface SettlementSnapshotRow {
    wikiKey: string;
    wikiUrl: string;
    wikiTitle: string | null;
    wikiName: string | null;
    description: string | null;
    einwohner: string | null;
    oberhaupt: string | null;
    regionText: string | null;
    staatText: string | null;
    handelszone: string | null;
    verkehrswege: string | null;
    bevoelkerung: string | null;
    tempel: string | null;
    buildingType: string | null;
    isRuined: boolean | null;
    /** Legacys Ortsklasse des Nests, wörtlich, und ob der Parser sie geraten hat (`null`: das Nest sagt es nicht; WI-0225, 0184). */
    settlementClass: string | null;
    settlementClassGuessed: boolean | null;
    syncedAt: string | null;
    trafficLinks: TrafficLinkRow[];
}

export interface PathSnapshotRow {
    wikiKey: string;
    wikiUrl: string;
    name: string | null;
    kind: string | null;
    art: string | null;
    lage: string | null;
    verlauf: string | null;
    laenge: string | null;
    description: string | null;
    isLean: boolean;
    syncedAt: string | null;
}

export interface NeighborRow {
    direction: string;
    position: number;
    name: string;
}

export interface SynonymRow {
    position: number;
    text: string;
}

export interface RegionSnapshotRow {
    wikiKey: string;
    wikiUrl: string;
    name: string | null;
    art: string | null;
    continent: string | null;
    regionParent: string | null;
    affiliationStaat: string | null;
    einwohner: string | null;
    sprache: string | null;
    vegetation: string | null;
    verkehrswege: string | null;
    description: string | null;
    syncedAt: string | null;
    neighbors: NeighborRow[];
    synonyms: SynonymRow[];
}

export interface PowerlineSnapshotRow {
    wikiKey: string;
    wikiUrl: string;
    name: string | null;
    staerke: string | null;
    affinitaet: string | null;
    laenge: string | null;
    regionen: string | null;
    verlauf: string | null;
    description: string | null;
    syncedAt: null;
}

interface AssignmentBase {
    publicId: string;
    name: string | null;
    wikiUrl: string;
    state: WikiState;
    origin: WikiOrigin;
    /** `wiki_key` des Schnappschusses; genau bei `assigned` gesetzt. */
    snapshotKey: string | null;
}

export type PlaceAssignmentRow = AssignmentBase;
export type PowerlineAssignmentRow = AssignmentBase;
export type PeakAssignmentRow = AssignmentBase;

export interface PathAssignmentRow extends AssignmentBase {
    role: "main" | "further";
}

export interface PlaceDetailRow {
    placePublicId: string;
    name: string | null;
    description: string | null;
    einwohner: string | null;
    lage: string | null;
    oberhaupt: string | null;
    einwohnerOrigin: FieldOrigin | null;
    lageOrigin: FieldOrigin | null;
    oberhauptOrigin: FieldOrigin | null;
}

export interface SubjectDetailsTransform {
    revision: number;
    settlementSnapshots: SettlementSnapshotRow[];
    placeAssignments: PlaceAssignmentRow[];
    placeDetails: PlaceDetailRow[];
    pathSnapshots: PathSnapshotRow[];
    pathAssignments: PathAssignmentRow[];
    regionSnapshots: RegionSnapshotRow[];
    peakAssignments: PeakAssignmentRow[];
    powerlineSnapshots: PowerlineSnapshotRow[];
    powerlineAssignments: PowerlineAssignmentRow[];
    /** Öffentliche IDs der gebundenen Beschriftungen, deren Nest einen Schnappschuss beiträgt (Zuordnung liegt an der Region). */
    boundLabelNests: { publicId: string; wikiKey: string; name: string | null }[];
    /** Zahlen für den Prüfer: Schlüssel, die mehrere Beschriftungen teilen, und wie viele Beschriftungen das sind (alle Nester). */
    stats: { labelSharedKeys: number; labelSharedLabels: number; labelNestUrls: string[] };
    /** Was die Umwandlung meldet, ohne anzuhalten. */
    findings: Finding[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Kleine Leser
// ---------------------------------------------------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Eine UUID in Kleinbuchstaben, oder `null`. */
export function uuidOf(value: unknown): string | null {
    return typeof value === "string" && UUID_PATTERN.test(value.trim()) ? value.trim().toLowerCase() : null;
}

/**
 * Ein Text, wie er gespeichert wird: unverändert, aber leer (oder nur Leerraum) ist `null`. Legacy löscht ein geleertes
 * Feld, und ein Text, der nur Leerraum trägt, sagt nichts.
 */
export function textOf(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Ein Legacy-Stempel als ISO-Zeichenkette in UTC. Legacy liefert beim Ort eine Zone (`+00:00`), bei Weg und Landschaft keine
 * (`2026-08-17 07:57:14.387`, MySQL `DATETIME(3)`): Sie gelten als UTC. Die Zone des Legacy-Servers ist nicht belegt; innerhalb
 * einer Tabelle ist das Format einheitlich, die Wahl des jüngsten Stempels hängt nicht von ihr ab.
 */
export function parseLegacyStamp(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (text === "") return null;
    const iso = text.replace(" ", "T");
    const withZone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(iso) && /T\d/.test(iso);
    const date = new Date(withZone ? iso : `${iso}Z`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Reste von Wikimarkup in einem Text (`[[ ]]`, `{{ }}`, `<ref`, `&nbsp;`). */
export function hasWikitextResidue(text: string | null): boolean {
    return text !== null && /\[\[|\]\]|\{\{|\}\}|<ref|&nbsp;/i.test(text);
}

/** Die registrierbare Domain einer Adresse (Legacy `avesmapsSourceCorpusKey`); leer, wenn keine zu erkennen ist. */
export function corpusKeyOfUrl(url: string): string {
    const trimmed = url.trim();
    if (trimmed === "") return "";
    const hostOf = (candidate: string): string => {
        try {
            return new URL(candidate).hostname;
        } catch {
            return "";
        }
    };
    let host = hostOf(trimmed);
    if (host === "") host = hostOf(`https://${trimmed.replace(/^\/+/, "")}`);
    host = host.toLowerCase().replace(/\.+$/, "");
    if (host === "" || !host.includes(".")) return "";
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return "";
    const parts = host.split(".");
    const lastTwo = parts.slice(-2).join(".");
    const multiLabel = ["co.uk", "org.uk", "me.uk", "com.au", "net.au", "org.au", "co.jp", "com.br", "co.nz", "com.tr"];
    if (parts.length >= 3 && multiLabel.includes(lastTwo)) return parts.slice(-3).join(".");
    return lastTwo;
}

function originOfPathSource(value: unknown): WikiOrigin {
    if (value === "editor") return "legacy_editor";
    if (value === "verlauf-sync") return "legacy_verlauf_sync";
    return "unknown";
}

function fieldOriginOf(value: unknown): FieldOrigin | null {
    return value === "wiki" || value === "manual" ? value : null;
}

interface Contribution<N> {
    nest: N;
    url: string;
    stamp: string | null;
    order: number;
    carrier: FindingObject;
}

/** Der Beitrag, der den Schnappschuss stellt: der jüngste Stempel, bei Gleichstand der früheste in der Reihenfolge der Quelle. */
function winnerOf<N>(contributions: readonly Contribution<N>[]): Contribution<N> {
    let best = contributions[0] as Contribution<N>;
    for (const candidate of contributions) {
        const better =
            (candidate.stamp ?? "") > (best.stamp ?? "") ||
            ((candidate.stamp ?? "") === (best.stamp ?? "") && candidate.order < best.order);
        if (better) best = candidate;
    }
    return best;
}

function addContribution<N>(map: Map<string, Contribution<N>[]>, key: string, contribution: Contribution<N>): void {
    const list = map.get(key);
    if (list) list.push(contribution);
    else map.set(key, [contribution]);
}

/**
 * Wie viele Schlüssel Nester mit verschiedenen Stempeln tragen und wie viele Nester einen anderen Stempel haben als das ERSTE
 * Nest ihres Schlüssels in der Reihenfolge der Quelle (so misst der Vertrag: Ort 4, Weg 64, Landschaft 13).
 */
function divergentStamps(stamps: ReadonlyMap<string, readonly (string | null)[]>): { keys: number; nests: number } {
    let keys = 0;
    let nests = 0;
    for (const list of stamps.values()) {
        const differing = list.filter((stamp) => stamp !== list[0]).length;
        if (differing > 0) {
            keys += 1;
            nests += differing;
        }
    }
    return { keys, nests };
}

function recordStamp(stats: Map<string, (string | null)[]>, key: string, stamp: string | null): void {
    const list = stats.get(key);
    if (list) list.push(stamp);
    else stats.set(key, [stamp]);
}

function carrierObject(table: string, publicId: string, name: unknown): FindingObject {
    return { table, publicId, name: typeof name === "string" && name.trim() !== "" ? name : null };
}

/**
 * Eine Verkehrsweg-Zeile: Legacy trägt sie als Objekt (Anzeigetext zu LINKZIEL, dem Seitennamen des Wiki-Links; `pathName` heißt nur die Spalte), leer
 * als Feld `[]`. Verlinkt wird später über den Wiki-Key des Linkziels, nie über den Namen eines Wegs (`subjects/wiki-key-lookup.ts`).
 */
function trafficLinksOf(value: unknown, unusable: { count: number }): TrafficLinkRow[] {
    if (!isBag(value)) return [];
    const rows: TrafficLinkRow[] = [];
    let position = 0;
    for (const [linkText, pathName] of Object.entries(value)) {
        const name = textOf(pathName);
        if (textOf(linkText) === null || name === null) {
            unusable.count += 1;
        } else {
            rows.push({ position, linkText, pathName: name });
        }
        position += 1;
    }
    return rows;
}

function neighborsOf(value: unknown, unusable: { count: number }): NeighborRow[] {
    if (!isBag(value)) return [];
    const known = new Set<string>(NEIGHBOR_DIRECTIONS);
    const rows: NeighborRow[] = [];
    for (const direction of NEIGHBOR_DIRECTIONS) {
        const list = value[direction];
        if (!Array.isArray(list)) continue;
        list.forEach((entry, index) => {
            const name = textOf(entry);
            if (name === null) unusable.count += 1;
            else rows.push({ direction, position: index, name });
        });
    }
    for (const direction of Object.keys(value)) {
        if (!known.has(direction)) unusable.count += 1;
    }
    return rows;
}

function synonymsOf(value: unknown, unusable: { count: number }): SynonymRow[] {
    if (!Array.isArray(value)) return [];
    const rows: SynonymRow[] = [];
    value.forEach((entry, index) => {
        const text = textOf(entry);
        if (text === null) unusable.count += 1;
        else rows.push({ position: index, text });
    });
    return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// Die Umwandlung
// ---------------------------------------------------------------------------------------------------------------------

interface MapFeature {
    properties?: Bag;
}

/** Wie lang ein Feld in Legacy höchstens sein darf (die Editor-Grenzen); ein längerer Quelltext ist ein Befund, kein Abbruch. */
export const DETAIL_LIMITS = { description: 1200, einwohner: 200, lage: 300, oberhaupt: 200 } as const;

export function transformSubjectDetails(payload: MapFeaturesPayload, targets: CarrierTargets): SubjectDetailsTransform {
    // A13: die Quelle muss als ganze Antwort erkennbar sein (Betreiber 2026-10-03, BLOCKING_SOURCE_CHECKS).
    assertMapFeaturesUsable(payload);
    const features = payload.features as MapFeature[];

    // Befundsammler
    const addressOnly = { place: [] as FindingObject[], path: [] as FindingObject[], powerline: [] as FindingObject[] };
    const missingCarrier: FindingObject[] = [];
    const nestUnusable: FindingObject[] = [];
    const entryUnusable = { count: 0 };
    const orphanNests: FindingObject[] = [];
    const orphanNestKeys = new Set<string>();
    const directOverrides: FindingObject[] = [];
    const directOverrideCounts: Record<string, number> = { description: 0, einwohner: 0, lage: 0, oberhaupt: 0 };
    const directOnlyHidden: FindingObject[] = [];
    const directOnlyCounts: Record<string, number> = { einwohner: 0, lage: 0, oberhaupt: 0 };
    const tooLong: FindingObject[] = [];
    const tooLongCounts: Record<string, number> = { description: 0, einwohner: 0, lage: 0, oberhaupt: 0 };
    const fieldOriginUnknown: FindingObject[] = [];
    const imageUnlicensed: FindingObject[] = [];
    const furtherWithoutMain: FindingObject[] = [];
    const furtherSameAsMain: FindingObject[] = [];
    const placeLinkTargetMissing: FindingObject[] = [];
    const stampUnreadable = { count: 0 };
    const stampStats = {
        ort: new Map<string, (string | null)[]>(),
        weg: new Map<string, (string | null)[]>(),
        landschaft: new Map<string, (string | null)[]>(),
    };
    let settlementResidue = 0;
    let synonymResidue = 0;
    let deityPresent = 0;
    let deityFilled = 0;

    // ---- Orte ---------------------------------------------------------------------------------------------------------
    const placeContribution = new Map<string, Contribution<Bag>[]>();
    const placeAssignments: PlaceAssignmentRow[] = [];
    const placeDetails: PlaceDetailRow[] = [];
    const seenPlaces = new Set<string>();
    let order = 0;
    for (const feature of features) {
        const props = feature.properties ?? {};
        if (props["feature_type"] !== "location") continue;
        const publicId = uuidOf(props["public_id"]);
        if (publicId === null || seenPlaces.has(publicId)) continue;
        seenPlaces.add(publicId);
        order += 1;
        const carrier = carrierObject("place", publicId, props["name"]);
        const nest = isBag(props["wiki_settlement"]) ? props["wiki_settlement"] : null;
        const flatUrl = textOf(props["wiki_url"]) ?? textOf(props["data-report-wiki-url"]);
        const nestKey = nest ? textOf(nest["wiki_key"]) : null;
        const nestUrl = nest ? textOf(nest["wiki_url"]) : null;
        const hasWikiData = nest !== null || flatUrl !== null;
        if (nest) {
            if (typeof nest["deity"] === "string") {
                deityPresent += 1;
                if (textOf(nest["deity"]) !== null) deityFilled += 1;
            } else if ("deity" in nest) {
                deityPresent += 1;
            }
        }

        const details = {
            description: textOf(props["description"]),
            einwohner: textOf(props["einwohner"]),
            lage: textOf(props["lage"]),
            oberhaupt: textOf(props["oberhaupt"]),
        };
        const hasDetail = Object.values(details).some((value) => value !== null);
        if (!targets.places.has(publicId)) {
            if (hasWikiData || hasDetail) missingCarrier.push(carrier);
            continue;
        }

        // Zuordnung
        if (nest && nestKey !== null && (flatUrl ?? nestUrl) !== null) {
            const url = (flatUrl ?? nestUrl) as string;
            placeAssignments.push({
                publicId,
                name: carrier.name,
                wikiUrl: url,
                state: "assigned",
                origin: "unknown",
                snapshotKey: nestKey,
            });
            const stamp = parseLegacyStamp(nest["synced_at"]);
            if (stamp === null && nest["synced_at"] !== undefined && textOf(nest["synced_at"]) !== null)
                stampUnreadable.count += 1;
            addContribution(placeContribution, nestKey, { nest, url: nestUrl ?? url, stamp, order, carrier });
            recordStamp(stampStats.ort, nestKey, stamp);
            if (hasWikitextResidue(textOf(nest["description"]))) settlementResidue += 1;
        } else if (flatUrl !== null) {
            placeAssignments.push({
                publicId,
                name: carrier.name,
                wikiUrl: flatUrl,
                state: "address_only",
                origin: "unknown",
                snapshotKey: null,
            });
            addressOnly.place.push(carrier);
            if (nest) nestUnusable.push(carrier);
        } else if (nest) {
            nestUnusable.push(carrier);
        }

        // Redaktionelle Felder
        if (hasDetail) {
            const origins = isBag(props["field_origins"]) ? props["field_origins"] : {};
            const originOf = (field: string, value: string | null): FieldOrigin | null => {
                if (value === null) return null;
                const raw = origins[field];
                const parsed = fieldOriginOf(raw);
                if (parsed === null && raw !== undefined && raw !== null && raw !== "")
                    fieldOriginUnknown.push(carrier);
                return parsed;
            };
            placeDetails.push({
                placePublicId: publicId,
                name: carrier.name,
                ...details,
                einwohnerOrigin: originOf("einwohner", details.einwohner),
                lageOrigin: originOf("lage", details.lage),
                oberhauptOrigin: originOf("oberhaupt", details.oberhaupt),
            });
            for (const field of ["description", "einwohner", "lage", "oberhaupt"] as const) {
                const value = details[field];
                if (value !== null && value.length > DETAIL_LIMITS[field]) {
                    tooLong.push(carrier);
                    tooLongCounts[field] = (tooLongCounts[field] ?? 0) + 1;
                }
            }
        }
        // Direkter Wert gegen Nestwert (der wirksame Wert bildet der Leser, hier wird nur gemeldet).
        for (const field of ["description", "einwohner", "lage", "oberhaupt"] as const) {
            const direct = details[field];
            if (direct === null) continue;
            const nestValue = nest ? textOf(nest[field]) : null;
            if (nestValue !== null && nestValue !== direct) {
                directOverrides.push(carrier);
                directOverrideCounts[field] = (directOverrideCounts[field] ?? 0) + 1;
            }
            if (nest === null && field !== "description") {
                directOnlyHidden.push(carrier);
                directOnlyCounts[field] = (directOnlyCounts[field] ?? 0) + 1;
            }
        }
    }

    const settlementSnapshots: SettlementSnapshotRow[] = [];
    for (const key of [...placeContribution.keys()].sort()) {
        const contributions = placeContribution.get(key) as Contribution<Bag>[];
        const { nest, url, stamp } = winnerOf(contributions);
        const traffic = trafficLinksOf(nest["verkehrswege_links"], entryUnusable);
        const row: SettlementSnapshotRow = {
            wikiKey: key,
            wikiUrl: url,
            wikiTitle: textOf(nest["title"]),
            wikiName: textOf(nest["name"]),
            description: textOf(nest["description"]),
            einwohner: textOf(nest["einwohner"]),
            oberhaupt: textOf(nest["oberhaupt"]),
            regionText: textOf(nest["region"]),
            staatText: textOf(nest["staat"]),
            handelszone: textOf(nest["handelszone"]),
            verkehrswege: textOf(nest["verkehrswege"]),
            bevoelkerung: textOf(nest["bevoelkerung"]),
            tempel: textOf(nest["tempel"]),
            buildingType: textOf(nest["building_type"]),
            isRuined: typeof nest["is_ruined"] === "boolean" ? nest["is_ruined"] : null,
            settlementClass: textOf(nest["settlement_class"]),
            settlementClassGuessed:
                typeof nest["settlement_class_guessed"] === "boolean" ? nest["settlement_class_guessed"] : null,
            syncedAt: stamp,
            trafficLinks: traffic,
        };
        settlementSnapshots.push(row);
    }

    // ---- Wege ---------------------------------------------------------------------------------------------------------
    interface FurtherInfo {
        name: string | null;
        url: string;
        art: string | null;
        kind: string | null;
    }
    const pathContribution = new Map<string, Contribution<Bag>[]>();
    const furtherInfo = new Map<string, FurtherInfo>();
    const pathAssignments: PathAssignmentRow[] = [];
    const seenPaths = new Set<string>();
    for (const feature of features) {
        const props = feature.properties ?? {};
        if (props["feature_type"] !== "path") continue;
        const publicId = uuidOf(props["public_id"]);
        if (publicId === null || seenPaths.has(publicId)) continue;
        seenPaths.add(publicId);
        order += 1;
        const carrier = carrierObject("path", publicId, props["display_name"] ?? props["name"]);
        const nest = isBag(props["wiki_path"]) ? props["wiki_path"] : null;
        const flatUrl = textOf(props["wiki_url"]);
        const nestKey = nest ? textOf(nest["wiki_key"]) : null;
        const nestUrl = nest ? textOf(nest["wiki_url"]) : null;
        const further = Array.isArray(props["wiki_path_weitere"]) ? props["wiki_path_weitere"] : [];
        if (!targets.paths.has(publicId)) {
            if (nest !== null || flatUrl !== null || further.length > 0) missingCarrier.push(carrier);
            continue;
        }
        let hasMain = false;
        let mainKey: string | null = null;
        if (nest && nestKey !== null && (flatUrl ?? nestUrl) !== null) {
            const url = (flatUrl ?? nestUrl) as string;
            pathAssignments.push({
                publicId,
                name: carrier.name,
                role: "main",
                wikiUrl: url,
                state: "assigned",
                origin: originOfPathSource(nest["source"]),
                snapshotKey: nestKey,
            });
            const stamp = parseLegacyStamp(nest["synced_at"]);
            addContribution(pathContribution, nestKey, { nest, url: nestUrl ?? url, stamp, order, carrier });
            recordStamp(stampStats.weg, nestKey, stamp);
            hasMain = true;
            mainKey = nestKey;
        } else if (flatUrl !== null) {
            pathAssignments.push({
                publicId,
                name: carrier.name,
                role: "main",
                wikiUrl: flatUrl,
                state: "address_only",
                origin: "unknown",
                snapshotKey: null,
            });
            addressOnly.path.push(carrier);
            if (nest) nestUnusable.push(carrier);
            hasMain = true;
        } else if (nest) {
            nestUnusable.push(carrier);
        }
        const seenFurther = new Set<string>();
        for (const entry of further) {
            if (!isBag(entry)) {
                entryUnusable.count += 1;
                continue;
            }
            const key = textOf(entry["wiki_key"]);
            const url = textOf(entry["wiki_url"]);
            if (key === null || url === null) {
                entryUnusable.count += 1;
                continue;
            }
            if (!hasMain) {
                furtherWithoutMain.push(carrier);
                continue;
            }
            if (key === mainKey || seenFurther.has(key)) {
                furtherSameAsMain.push(carrier);
                continue;
            }
            seenFurther.add(key);
            if (!furtherInfo.has(key)) {
                furtherInfo.set(key, {
                    name: textOf(entry["name"]),
                    url,
                    art: textOf(entry["art"]),
                    kind: textOf(entry["kind"]),
                });
            }
            pathAssignments.push({
                publicId,
                name: carrier.name,
                role: "further",
                wikiUrl: url,
                state: "assigned",
                origin: "unknown",
                snapshotKey: key,
            });
        }
    }

    const pathSnapshots: PathSnapshotRow[] = [];
    for (const key of [...pathContribution.keys()].sort()) {
        const { nest, url, stamp } = winnerOf(pathContribution.get(key) as Contribution<Bag>[]);
        pathSnapshots.push({
            wikiKey: key,
            wikiUrl: url,
            name: textOf(nest["name"]),
            kind: textOf(nest["kind"]),
            art: textOf(nest["art"]),
            lage: textOf(nest["lage"]),
            verlauf: textOf(nest["verlauf"]),
            laenge: textOf(nest["laenge"]),
            description: textOf(nest["description"]),
            isLean: false,
            syncedAt: stamp,
        });
    }
    const usedFurtherKeys = new Set(
        pathAssignments.filter((row) => row.role === "further").map((row) => row.snapshotKey as string),
    );
    for (const key of [...usedFurtherKeys].sort()) {
        if (pathContribution.has(key)) continue;
        const info = furtherInfo.get(key) as FurtherInfo;
        pathSnapshots.push({
            wikiKey: key,
            wikiUrl: info.url,
            name: info.name,
            kind: info.kind,
            art: info.art,
            lage: null,
            verlauf: null,
            laenge: null,
            description: null,
            isLean: true,
            syncedAt: null,
        });
    }

    // ---- Kraftlinien --------------------------------------------------------------------------------------------------
    const powerlineContribution = new Map<string, Contribution<Bag>[]>();
    const powerlineAssignments: PowerlineAssignmentRow[] = [];
    const seenPowerlines = new Set<string>();
    for (const feature of features) {
        const props = feature.properties ?? {};
        if (props["feature_type"] !== "powerline") continue;
        const publicId = uuidOf(props["public_id"]);
        if (publicId === null || seenPowerlines.has(publicId)) continue;
        seenPowerlines.add(publicId);
        order += 1;
        const carrier = carrierObject("powerline", publicId, props["name"]);
        const nest = isBag(props["wiki_powerline"]) ? props["wiki_powerline"] : null;
        const flatUrl = textOf(props["wiki_url"]);
        const nestKey = nest ? textOf(nest["wiki_key"]) : null;
        const nestUrl = nest ? textOf(nest["wiki_url"]) : null;
        if (!targets.powerlines.has(publicId)) {
            if (nest !== null || flatUrl !== null) missingCarrier.push(carrier);
            continue;
        }
        if (nest && nestKey !== null && (flatUrl ?? nestUrl) !== null) {
            const url = (flatUrl ?? nestUrl) as string;
            powerlineAssignments.push({
                publicId,
                name: carrier.name,
                wikiUrl: url,
                state: "assigned",
                origin: "unknown",
                snapshotKey: nestKey,
            });
            // Das Kraftlinien-Nest trägt keinen Stempel: der erste Beitrag stellt den Schnappschuss.
            addContribution(powerlineContribution, nestKey, { nest, url: nestUrl ?? url, stamp: null, order, carrier });
        } else if (flatUrl !== null) {
            powerlineAssignments.push({
                publicId,
                name: carrier.name,
                wikiUrl: flatUrl,
                state: "address_only",
                origin: "unknown",
                snapshotKey: null,
            });
            addressOnly.powerline.push(carrier);
            if (nest) nestUnusable.push(carrier);
        } else if (nest) {
            nestUnusable.push(carrier);
        }
    }
    const powerlineSnapshots: PowerlineSnapshotRow[] = [];
    for (const key of [...powerlineContribution.keys()].sort()) {
        const { nest, url } = winnerOf(powerlineContribution.get(key) as Contribution<Bag>[]);
        powerlineSnapshots.push({
            wikiKey: key,
            wikiUrl: url,
            name: textOf(nest["name"]),
            staerke: textOf(nest["staerke"]),
            affinitaet: textOf(nest["affinitaet"]),
            laenge: textOf(nest["laenge"]),
            regionen: textOf(nest["regionen"]),
            verlauf: textOf(nest["verlauf"]),
            description: textOf(nest["description"]),
            syncedAt: null,
        });
    }

    // ---- Beschriftungen: Landschaft (an der Region) und Gipfel ----------------------------------------------------------
    const regionContribution = new Map<string, Contribution<Bag>[]>();
    const peakAssignments: PeakAssignmentRow[] = [];
    const boundLabelNests: SubjectDetailsTransform["boundLabelNests"] = [];
    const labelKeyHolders = new Map<string, number>();
    const labelNestUrls: string[] = [];
    const seenLabels = new Set<string>();
    for (const feature of features) {
        const props = feature.properties ?? {};
        if (props["feature_type"] !== "label") continue;
        const publicId = uuidOf(props["public_id"]);
        if (publicId === null || seenLabels.has(publicId)) continue;
        seenLabels.add(publicId);
        order += 1;
        const carrier = carrierObject("map_label", publicId, props["name"] ?? props["text"]);
        const nest = isBag(props["wiki_region"]) ? props["wiki_region"] : null;
        const bound = targets.labels.has(publicId);
        const peak = targets.peaks.has(publicId);
        // `?place=` auf eine freie Beschriftung ohne jede Zeile in Avesmaps3D (für den Leser, nicht für den Import).
        if (!bound && !peak && textOf(props["ecosystem_region_public_id"]) === null) {
            placeLinkTargetMissing.push(carrier);
        }
        if (nest === null) continue;
        const key = textOf(nest["wiki_key"]);
        const url = textOf(nest["wiki_url"]) ?? textOf(props["wiki_url"]);
        if (key === null || url === null) {
            nestUnusable.push(carrier);
            continue;
        }
        labelKeyHolders.set(key, (labelKeyHolders.get(key) ?? 0) + 1);
        labelNestUrls.push(url);
        recordStamp(stampStats.landschaft, key, parseLegacyStamp(nest["synced_at"]));
        if (
            Array.isArray(nest["synonyms"]) &&
            nest["synonyms"].some((entry) => typeof entry === "string" && /\[\[|\]\]/.test(entry))
        ) {
            synonymResidue += 1;
        }
        if (textOf(nest["image_url"]) !== null) imageUnlicensed.push(carrier);
        const active =
            (bound && targets.labels.get(publicId) === true) || (peak && targets.peaks.get(publicId) === true);
        if (!active) {
            orphanNests.push(carrier);
            orphanNestKeys.add(key);
            continue;
        }
        const stamp = parseLegacyStamp(nest["synced_at"]);
        addContribution(regionContribution, key, { nest, url, stamp, order, carrier });
        if (bound) {
            boundLabelNests.push({ publicId, wikiKey: key, name: carrier.name });
        } else {
            peakAssignments.push({
                publicId,
                name: carrier.name,
                wikiUrl: url,
                state: "assigned",
                origin: "unknown",
                snapshotKey: key,
            });
        }
    }
    // Schlüssel, deren Nester ALLE ohne aktives Ziel sind, zählen als „ohne aktives Ziel“; hat ein Schlüssel auch nur ein Ziel, ist er es nicht.
    const orphanOnlyKeys = [...orphanNestKeys].filter((key) => !regionContribution.has(key));

    const regionSnapshots: RegionSnapshotRow[] = [];
    let artMultivalue = 0;
    const incompleteRegions: FindingObject[] = [];
    for (const key of [...regionContribution.keys()].sort()) {
        const contributions = regionContribution.get(key) as Contribution<Bag>[];
        const { nest, url, stamp, carrier } = winnerOf(contributions);
        const synonyms = synonymsOf(nest["synonyms"], entryUnusable);
        const row: RegionSnapshotRow = {
            wikiKey: key,
            wikiUrl: url,
            name: textOf(nest["name"]),
            art: textOf(nest["art"]),
            continent: textOf(nest["continent"]),
            regionParent: textOf(nest["region_parent"]),
            affiliationStaat: textOf(nest["affiliation_staat"]),
            einwohner: textOf(nest["einwohner"]),
            sprache: textOf(nest["sprache"]),
            vegetation: textOf(nest["vegetation"]),
            verkehrswege: textOf(nest["verkehrswege"]),
            description: textOf(nest["description"]),
            syncedAt: stamp,
            neighbors: neighborsOf(nest["neighbors"], entryUnusable),
            synonyms,
        };
        if (row.art !== null && row.art.includes("|")) artMultivalue += 1;
        const hasText = [
            row.name,
            row.art,
            row.continent,
            row.regionParent,
            row.affiliationStaat,
            row.einwohner,
            row.sprache,
            row.vegetation,
            row.verkehrswege,
            row.description,
        ].some((value) => value !== null);
        if (!hasText) incompleteRegions.push(carrier);
        regionSnapshots.push(row);
    }

    // ---- Befunde ------------------------------------------------------------------------------------------------------
    const findings: Finding[] = [];
    const total = (...lists: readonly (readonly unknown[])[]): number =>
        lists.reduce((sum, list) => sum + list.length, 0);
    const addressOnlyTotal = total(addressOnly.place, addressOnly.path, addressOnly.powerline);
    if (addressOnlyTotal > 0) {
        findings.push(
            createFinding(
                "wiki_address_only",
                `${String(addressOnlyTotal)} Zuordnungen tragen nur eine Adresse, keinen Schlüssel und keinen Schnappschuss ` +
                    `(Ort ${String(addressOnly.place.length)}, Weg ${String(addressOnly.path.length)}, Kraftlinie ${String(addressOnly.powerline.length)}); übernommen als address_only`,
                {
                    place: addressOnly.place.length,
                    path: addressOnly.path.length,
                    powerline: addressOnly.powerline.length,
                },
                [...addressOnly.place, ...addressOnly.path, ...addressOnly.powerline],
                addressOnlyTotal,
            ),
        );
    }
    const assignedTotal =
        placeAssignments.length + pathAssignments.length + powerlineAssignments.length + peakAssignments.length;
    if (assignedTotal > 0) {
        findings.push(
            createFinding(
                "wiki_state_not_exported",
                "Legacy exportiert nur Nest mit Schlüssel und bloße Adresse; automatisch zugeordnet, bestätigt, korrigiert, getrennt und " +
                    "unterdrückt sind keine Daten des Exports. Die Herkunft ist unknown (Weg: Legacys source), separated und suppressed werden nie geschrieben",
                {
                    zuordnungen: assignedTotal,
                    ort: placeAssignments.length,
                    weg: pathAssignments.length,
                    kraftlinie: powerlineAssignments.length,
                    gipfel: peakAssignments.length,
                },
            ),
        );
    }
    // Mehrere Träger einer Art teilen Adresse oder Schlüssel: nie still aufgelöst.
    const sharedPlaceAddresses = sharedGroups(
        placeAssignments.map((row) => ({ key: row.wikiUrl, carrier: carrierObject("place", row.publicId, row.name) })),
    );
    const sharedPlaceKeys = sharedGroups(
        placeAssignments
            .filter((row) => row.snapshotKey !== null)
            .map((row) => ({
                key: row.snapshotKey as string,
                carrier: carrierObject("place", row.publicId, row.name),
            })),
    );
    const sharedLabelKeys = [...labelKeyHolders.values()].filter((count) => count > 1);
    if (sharedPlaceAddresses.groups > 0 || sharedLabelKeys.length > 0) {
        findings.push(
            createFinding(
                "wiki_key_shared",
                `Mehrere Träger einer Art teilen eine Adresse oder einen Schlüssel: Orte ${String(sharedPlaceAddresses.groups)} Adressen an ` +
                    `${String(sharedPlaceAddresses.carriers.length)} Orten (${String(sharedPlaceKeys.groups)} Schlüssel), Beschriftungen ` +
                    `${String(sharedLabelKeys.length)} Schlüssel an ${String(sharedLabelKeys.reduce((sum, count) => sum + count, 0))} Beschriftungen. Kein Fehler, aber nie still aufgelöst (Leser und WI-0029)`,
                {
                    orteAdressen: sharedPlaceAddresses.groups,
                    orteOrte: sharedPlaceAddresses.carriers.length,
                    orteSchluessel: sharedPlaceKeys.groups,
                    beschriftungenSchluessel: sharedLabelKeys.length,
                    beschriftungen: sharedLabelKeys.reduce((sum, count) => sum + count, 0),
                },
                sharedPlaceAddresses.carriers,
            ),
        );
    }
    if (orphanNests.length > 0) {
        findings.push(
            createFinding(
                "orphan_nest",
                `${String(orphanNests.length)} Wiki-Nester an Beschriftungen ohne aktives Ziel in Avesmaps3D (${String(orphanOnlyKeys.length)} Schlüssel ohne jedes aktive Ziel); nicht angelegt`,
                { nester: orphanNests.length, schluesselOhneZiel: orphanOnlyKeys.length },
                orphanNests,
            ),
        );
    }
    if (incompleteRegions.length > 0) {
        findings.push(
            createFinding(
                "snapshot_incomplete",
                `${String(incompleteRegions.length)} Nester tragen nur Schlüssel und Adresse; der Schnappschuss hat NULL-Texte`,
                { schnappschuesse: incompleteRegions.length },
                incompleteRegions,
            ),
        );
    }
    if (directOverrides.length > 0) {
        findings.push(
            createFinding(
                "direct_overrides_wiki",
                `${String(directOverrides.length)} direkte Werte weichen vom Nestwert ab (Beschreibung ${String(directOverrideCounts["description"])}, ` +
                    `Einwohner ${String(directOverrideCounts["einwohner"])}, Lage ${String(directOverrideCounts["lage"])}, Oberhaupt ${String(directOverrideCounts["oberhaupt"])}); wirksam ist der direkte`,
                { ...directOverrideCounts },
                directOverrides,
            ),
        );
    }
    if (directOnlyHidden.length > 0) {
        findings.push(
            createFinding(
                "direct_only_hidden_in_legacy",
                `${String(directOnlyHidden.length)} direkte Felder an Orten ohne Nest (Einwohner ${String(directOnlyCounts["einwohner"])}, Lage ${String(directOnlyCounts["lage"])}, Oberhaupt ${String(directOnlyCounts["oberhaupt"])}); Legacy zeigt sie öffentlich nirgends`,
                { ...directOnlyCounts },
                directOnlyHidden,
            ),
        );
    }
    if (settlementResidue + synonymResidue > 0) {
        findings.push(
            createFinding(
                "wikitext_residue",
                `Reste von Wikimarkup in Nest-Texten: ${String(settlementResidue)} Orts-Beschreibungen, ${String(synonymResidue)} Synonymlisten; nicht repariert`,
                { ortBeschreibungen: settlementResidue, synonymlisten: synonymResidue },
            ),
        );
    }
    if (deityPresent > 0) {
        findings.push(
            createFinding(
                "deity_empty_in_export",
                `deity ist in ${String(deityPresent)} Ortsnestern vorhanden, gefüllt in ${String(deityFilled)}; keine Spalte`,
                { vorhanden: deityPresent, gefuellt: deityFilled },
            ),
        );
    }
    if (imageUnlicensed.length > 0) {
        findings.push(
            createFinding(
                "image_unlicensed_not_imported",
                `${String(imageUnlicensed.length)} Landschaftsnester tragen ein Bild ohne Lizenz (Proxy-Zwischenspeicher); nie übernommen`,
                { bilder: imageUnlicensed.length },
                imageUnlicensed,
            ),
        );
    }
    if (furtherWithoutMain.length > 0) {
        findings.push(
            createFinding(
                "path_further_without_main",
                `${String(furtherWithoutMain.length)} weitere Zuweisungen ohne Hauptzuweisung; nicht angelegt`,
                { weitere: furtherWithoutMain.length },
                furtherWithoutMain,
            ),
        );
    }
    if (furtherSameAsMain.length > 0) {
        findings.push(
            createFinding(
                "path_further_duplicate",
                `${String(furtherSameAsMain.length)} weitere Zuweisungen wiederholen die Hauptzuweisung oder eine andere weitere desselben Segments; nur einmal angelegt`,
                { weitere: furtherSameAsMain.length },
                furtherSameAsMain,
            ),
        );
    }
    if (artMultivalue > 0) {
        findings.push(
            createFinding(
                "art_multivalue",
                `${String(artMultivalue)} Landschaftsschnappschüsse tragen eine mehrwertige Art (mit |); roh gespeichert`,
                {
                    schnappschuesse: artMultivalue,
                },
            ),
        );
    }
    const stampNumbers = {
        ort: divergentStamps(stampStats.ort),
        weg: divergentStamps(stampStats.weg),
        landschaft: divergentStamps(stampStats.landschaft),
    };
    if (stampNumbers.ort.keys + stampNumbers.weg.keys + stampNumbers.landschaft.keys > 0) {
        findings.push(
            createFinding(
                "snapshot_stamp_divergent",
                `Gleicher Schlüssel, verschiedene synced_at: Ort ${String(stampNumbers.ort.nests)} Nester (${String(stampNumbers.ort.keys)} Schlüssel), ` +
                    `Weg ${String(stampNumbers.weg.nests)} (${String(stampNumbers.weg.keys)}), Landschaft ${String(stampNumbers.landschaft.nests)} (${String(stampNumbers.landschaft.keys)}); der jüngste Stempel gewinnt (Nester gemessen am ersten Nest ihres Schlüssels)`,
                {
                    ortNester: stampNumbers.ort.nests,
                    ortSchluessel: stampNumbers.ort.keys,
                    wegNester: stampNumbers.weg.nests,
                    wegSchluessel: stampNumbers.weg.keys,
                    landschaftNester: stampNumbers.landschaft.nests,
                    landschaftSchluessel: stampNumbers.landschaft.keys,
                },
            ),
        );
    }
    if (placeLinkTargetMissing.length > 0) {
        findings.push(
            createFinding(
                "place_link_target_missing",
                `${String(placeLinkTargetMissing.length)} freie Beschriftungen ohne Zeile in Avesmaps3D: ?place= würde ins Leere zeigen (für den Leser)`,
                { beschriftungen: placeLinkTargetMissing.length },
                placeLinkTargetMissing,
            ),
        );
    }
    if (tooLong.length > 0) {
        findings.push(
            createFinding(
                "text_exceeds_legacy_limit",
                `${String(tooLong.length)} direkte Felder sind länger als Legacys Editorgrenze (Beschreibung ${String(tooLongCounts["description"])}, Einwohner ${String(tooLongCounts["einwohner"])}, Lage ${String(tooLongCounts["lage"])}, Oberhaupt ${String(tooLongCounts["oberhaupt"])}); unverändert gespeichert`,
                { ...tooLongCounts },
                tooLong,
            ),
        );
    }
    if (fieldOriginUnknown.length > 0) {
        findings.push(
            createFinding(
                "field_origin_unknown_value",
                `${String(fieldOriginUnknown.length)} Feldherkünfte haben weder den Wert wiki noch manual; gespeichert als nicht bekannt`,
                { felder: fieldOriginUnknown.length },
                fieldOriginUnknown,
            ),
        );
    }
    if (missingCarrier.length > 0) {
        findings.push(
            createFinding(
                "carrier_missing",
                `${String(missingCarrier.length)} Träger mit Wiki-Daten haben in Avesmaps3D keine aktive Zeile; ihre Zuordnung wird nicht angelegt`,
                { traeger: missingCarrier.length },
                missingCarrier,
            ),
        );
    }
    if (nestUnusable.length > 0) {
        findings.push(
            createFinding(
                "nest_unusable",
                `${String(nestUnusable.length)} Wiki-Nester ohne Schlüssel oder ohne Adresse; als bloße Adresse übernommen oder ausgelassen`,
                { nester: nestUnusable.length },
                nestUnusable,
            ),
        );
    }
    if (entryUnusable.count > 0) {
        findings.push(
            createFinding(
                "source_entry_unusable",
                `${String(entryUnusable.count)} Einträge in Verkehrswegen, Nachbarn, Synonymen oder weiteren Zuweisungen waren leer oder ohne Schlüssel; ausgelassen`,
                { eintraege: entryUnusable.count },
            ),
        );
    }
    if (stampUnreadable.count > 0) {
        findings.push(
            createFinding(
                "synced_at_unreadable",
                `${String(stampUnreadable.count)} synced_at waren nicht lesbar; gespeichert als NULL`,
                { stempel: stampUnreadable.count },
            ),
        );
    }
    // Der Befund `wiki_text_license_unrecorded` braucht die Korpustafel und steht im Import (Datenbank).

    return {
        revision: Number(payload.revision),
        settlementSnapshots,
        placeAssignments,
        placeDetails,
        pathSnapshots,
        pathAssignments,
        regionSnapshots,
        peakAssignments,
        powerlineSnapshots,
        powerlineAssignments,
        boundLabelNests,
        stats: {
            labelSharedKeys: sharedLabelKeys.length,
            labelSharedLabels: sharedLabelKeys.reduce((sum, count) => sum + count, 0),
            labelNestUrls,
        },
        findings,
    };
}

/** Schlüssel, die mehr als ein Träger teilt: die Zahl der Schlüssel und die beteiligten Träger. */
export function sharedGroups(entries: readonly { key: string; carrier: FindingObject }[]): {
    groups: number;
    carriers: FindingObject[];
} {
    const byKey = new Map<string, FindingObject[]>();
    for (const entry of entries) {
        const list = byKey.get(entry.key);
        if (list) list.push(entry.carrier);
        else byKey.set(entry.key, [entry.carrier]);
    }
    const shared = [...byKey.values()].filter((list) => list.length > 1);
    return { groups: shared.length, carriers: shared.flat() };
}
