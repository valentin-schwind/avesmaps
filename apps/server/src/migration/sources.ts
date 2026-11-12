import { createHash } from "node:crypto";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { titelOhneAuszeichnung } from "../wiki/infobox/text.ts";
import { assertMapFeaturesUsable, type MapFeaturesPayload } from "./map-features.ts";
import { computePathGroups, type PathGroupInput } from "./path-groups.ts";
import { textOf, uuidOf } from "./subject-details.ts";

/**
 * Feature-Quellen: die reine Umwandlung des Satzes in Katalog, Korpus, Verknüpfungen und Kanon (WI-0063 P3, Vertrag
 * `project-control/migration/contracts/sources.yaml`, D1).
 *
 * Quelle ist dieselbe `map-features.json` wie bei Orten und Wegen mit vier globalen Blöcken: `source_catalog`,
 * `feature_sources`, `source_corpora` und `feature_kanon`. Diese Datei kennt weder Datenbank noch Netz; was sie über die Träger
 * wissen muss, bekommt sie als `SourceTargets`. Der Prüfer rechnet dieselbe Funktion noch einmal.
 *
 * 🔴 Quellen werden NICHT vererbt: Jede Verknüpfung bleibt bei dem Träger, an dem Legacy sie führt. Nichts wird aggregiert.
 * 🔴 Der Kanon ist Legacys Ergebnis als Anfangsstand; die Ableitung wird nicht nachgebaut.
 * 🔴 Nichts blockiert: Fehlt ein Block oder ist der Katalog leer, schreibt der Schritt nichts, legt nichts still und meldet
 * `source_block_missing` (kein neues Tor: er hat dann keine Quelle). Alle anderen Codes melden nur.
 */

export const SOURCES_CONTRACT_VERSION = "1";

export type CarrierKind = "place" | "path" | "territory" | "region" | "terrain_peak";
export type CanonCarrierKind = CarrierKind | "powerline";
export type LicenseStatement = "unrecorded" | "license" | "public_domain" | "unfree";
export type Canon = "official" | "unofficial" | "unlabelled";
export type ReferenceKind = "ausfuehrlich" | "ergaenzend" | "erwaehnung";

export const SOURCE_TYPES = [
    "regionalspielhilfe",
    "abenteuer",
    "aventurischer_bote",
    "quellenband",
    "roman",
    "briefspiel",
    "regelbuch",
    "sonstiges",
] as const;
const REFERENCE_KINDS: readonly string[] = ["ausfuehrlich", "ergaenzend", "erwaehnung"];
const CORPUS_FORMS: readonly string[] = ["", "werk", "belegstelle"];

/** Der Zustand eines Trägers in Avesmaps3D: ob es ihn gibt, ob er aktiv ist und wie er heißt. */
export interface CarrierState {
    active: boolean;
    name: string | null;
}

/** Was Avesmaps3D an Trägern hat (jede Zeile, auch stillgelegte: so lässt sich „inaktiv“ von „fehlt“ unterscheiden). */
export interface SourceTargets {
    places: ReadonlyMap<string, CarrierState>;
    paths: ReadonlyMap<string, CarrierState>;
    territories: ReadonlyMap<string, CarrierState>;
    regions: ReadonlyMap<string, CarrierState>;
    peaks: ReadonlyMap<string, CarrierState>;
    powerlines: ReadonlyMap<string, CarrierState>;
    /** `map_label`-Zeilen (gebundene Beschriftungen). */
    labels: ReadonlySet<string>;
    /** Die Schlüssel des Lizenzkatalogs (`license_catalog`, Migration 0064). */
    licenseKeys: ReadonlySet<string>;
}

export interface CorpusRow {
    corpusKey: string;
    label: string;
    form: string;
}

export interface SourceRow {
    /** Legacys laufende `sources.id`; nur Anker der vorläufigen Identität und Information. */
    legacyId: number | null;
    sourceKey: string;
    identityState: "final" | "provisional";
    url: string | null;
    title: string;
    sourceType: string;
    isOfficial: boolean;
    licenseStatement: LicenseStatement;
    licenseKey: string | null;
    attribution: string | null;
    corpusKey: string | null;
    /** Die Träger, die diese Quelle zitieren (`<Art>:<öffentliche ID>`), für den Fingerabdruck der URL-losen Quellen. */
    carriers: string[];
}

export interface LinkRow {
    kind: CarrierKind;
    carrierPublicId: string;
    carrierName: string | null;
    /** `source_key` der Quelle. */
    sourceKey: string;
    referenceKind: ReferenceKind | null;
    pages: string | null;
    note: string | null;
    /** Legacys Herkunft der Verknüpfung (E1+: `manual`, `wiki_publication` …); `null` = nicht bekannt. */
    legacyOrigin: string | null;
    position: number;
}

/** Eine von Hand unterdrückte Verknüpfung (E1+): wird `state suppressed`, ein Tombstone, den nie jemand wieder belebt. */
export interface TombstoneRow {
    kind: CarrierKind;
    carrierPublicId: string;
    carrierName: string | null;
    sourceKey: string;
    legacyOrigin: string | null;
    referenceKind: ReferenceKind | null;
    pages: string | null;
    note: string | null;
    position: number;
}

export interface CanonRow {
    kind: CanonCarrierKind;
    carrierPublicId: string;
    carrierName: string | null;
    canon: Canon;
    designatorType: string | null;
    designatorCount: number | null;
    designatorLabel: string | null;
    derivedFrom: "legacy_feature_kanon" | "legacy_feature_kanon_default";
}

export interface SourcesTransform {
    /** `true`: ein Block fehlt oder der Katalog ist leer; der Aufrufer schreibt nichts. */
    skipped: boolean;
    revision: number;
    corpora: CorpusRow[];
    sources: SourceRow[];
    links: LinkRow[];
    /** Die unterdrückten Verknüpfungen aus dem Block `feature_sources_suppressed` (E1+), leer ohne den Block. */
    tombstones: TombstoneRow[];
    /** Ob der E1+-Block im Satz stand: `absent` (noch nicht exportiert), `present` oder `unusable` (weder Liste noch Objekt). */
    tombstoneBlock: "absent" | "present" | "unusable";
    canon: CanonRow[];
    /** Die Verweise des Satzes, gezählt: alle, aufgelöste, Waisen und zurückgestellte (Summe stimmt), dazu die Art der Quelle über alle. */
    linkTotals: {
        total: number;
        resolved: number;
        orphan: number;
        deferred: number;
        /** Verweise ohne Katalogzeile und doppelte Verweise: nicht angelegt (im Satz 161832: 0). */
        skipped: number;
        byReferenceKind: Record<string, number>;
    };
    findings: Finding[];
}

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Legacys `url_hash`: SHA-256 (hex) der Adresse, genau wie geliefert, ohne Normalisierung. */
export function urlHash(url: string): string {
    return createHash("sha256").update(url, "utf8").digest("hex");
}

/**
 * Die Identität einer Katalogzeile des Satzes (`source_catalog[<id>]`): `url:<sha256 der Adresse>` mit Adresse, `wikipub:<wiki_key>` ohne
 * Adresse mit Wiki-Schlüssel (E1), sonst vorläufig `legacy-id:<id>`; `null`, wenn nichts davon lesbar ist. EINE Stelle für die Regel: die
 * Quellenverknüpfung der Karten (D2) leitet den Schlüssel mit derselben Funktion ab.
 */
export function catalogSourceIdentity(
    idText: string,
    entry: Record<string, unknown>,
): { sourceKey: string; identityState: "final" | "provisional"; legacyId: number | null } | null {
    const numeric = /^\d+$/.test(idText) ? Number(idText) : null;
    const legacyId = numeric !== null && Number.isSafeInteger(numeric) ? numeric : null;
    const url = textOf(entry["url"]);
    const wikiKey = url === null ? textOf(entry["wiki_key"]) : null;
    if (url !== null) return { sourceKey: `url:${urlHash(url)}`, identityState: "final", legacyId };
    if (wikiKey !== null) return { sourceKey: `wikipub:${wikiKey}`, identityState: "final", legacyId };
    if (legacyId !== null)
        return { sourceKey: `legacy-id:${String(legacyId)}`, identityState: "provisional", legacyId };
    return null;
}

/** Die Zuordnung der Legacy-Art zur Tabelle; `null` für eine Art ohne Träger in Avesmaps3D (kein Fehler, nur ein Befund). */
function carrierKindOf(entityType: string): CarrierKind | "label" | "powerline" | "citymap" | null {
    switch (entityType) {
        case "settlement":
            return "place";
        case "path":
            return "path";
        case "territory":
            return "territory";
        case "ecosystem":
            return "region";
        case "region":
            return "label";
        case "powerline":
            return "powerline";
        case "citymap":
            return "citymap";
        default:
            return null;
    }
}

type Resolution =
    | { ok: true; kind: CanonCarrierKind; publicId: string; name: string | null }
    | {
          ok: false;
          reason: "missing" | "inactive" | "junction" | "bound_label" | "deferred" | "unknown_type" | "bad_id";
          entityType: string;
      };

export function transformSources(payload: MapFeaturesPayload, targets: SourceTargets): SourcesTransform {
    assertMapFeaturesUsable(payload);
    const revision = Number(payload.revision);
    const raw = payload as unknown as Bag;
    const blocks = {
        catalog: raw["source_catalog"],
        links: raw["feature_sources"],
        corpora: raw["source_corpora"],
        kanon: raw["feature_kanon"],
    };
    const empty = (reason: string): SourcesTransform => ({
        skipped: true,
        revision,
        corpora: [],
        sources: [],
        links: [],
        tombstones: [],
        tombstoneBlock: "absent",
        canon: [],
        linkTotals: { total: 0, resolved: 0, orphan: 0, deferred: 0, skipped: 0, byReferenceKind: {} },
        findings: [
            createFinding(
                "source_block_missing",
                `Die Quellenblöcke fehlen oder sind unbrauchbar (${reason}); der Schritt schreibt nichts und legt nichts still, der Lauf geht weiter`,
                { grund: reason },
            ),
        ],
    });
    if (!isBag(blocks.catalog) || !isBag(blocks.links) || !isBag(blocks.corpora) || !isBag(blocks.kanon)) {
        return empty("ein Block fehlt oder ist kein Objekt");
    }
    const kanon = blocks.kanon;
    if (!isBag(kanon["abweichungen"])) return empty("feature_kanon trägt keine abweichungen");
    const catalog = blocks.catalog;
    const linkBlock = blocks.links;
    const entries = kanon["abweichungen"];
    if (Object.keys(catalog).length === 0) {
        return empty(
            Object.keys(linkBlock).length > 0
                ? "der Katalog ist leer, die Verweise nicht (Delta-Abruf)"
                : "der Katalog ist leer",
        );
    }

    const findings: Finding[] = [];

    // ---- Korpora ---------------------------------------------------------------------------------------------------
    const corpora: CorpusRow[] = [];
    for (const key of Object.keys(blocks.corpora).sort()) {
        const entry = (blocks.corpora as Bag)[key];
        const trimmed = key.trim();
        if (trimmed === "") continue;
        const bag = isBag(entry) ? entry : {};
        const form = typeof bag["form"] === "string" && CORPUS_FORMS.includes(bag["form"]) ? bag["form"] : "";
        corpora.push({ corpusKey: key, label: typeof bag["label"] === "string" ? bag["label"] : "", form });
    }
    const corpusKeys = new Set(corpora.map((row) => row.corpusKey));

    // ---- Katalog -----------------------------------------------------------------------------------------------------
    const sources: SourceRow[] = [];
    const sourceByLegacyId = new Map<number, SourceRow>();
    const sourceByKey = new Map<string, SourceRow>();
    const typeUnknown: FindingObject[] = [];
    const licenseUnknown: FindingObject[] = [];
    const corpusMissing: FindingObject[] = [];
    const unusable: FindingObject[] = [];
    const duplicateKeys: FindingObject[] = [];
    const titleEmpty: FindingObject[] = [];
    const titleMarkup: FindingObject[] = [];
    const notHttps: FindingObject[] = [];
    const attributionWithoutLicense: FindingObject[] = [];
    const licenseWithoutAttribution: FindingObject[] = [];
    let licenseUnrecorded = 0;
    const sourceObject = (id: string, name: string | null): FindingObject => ({
        table: "feature_source",
        publicId: id,
        name,
    });

    for (const idText of Object.keys(catalog)) {
        const entry = catalog[idText];
        if (!isBag(entry)) {
            unusable.push(sourceObject(idText, null));
            continue;
        }
        const url = textOf(entry["url"]);
        const rawTitle = typeof entry["label"] === "string" ? entry["label"] : "";
        const title = titelOhneAuszeichnung(rawTitle);
        const identity = catalogSourceIdentity(idText, entry);
        if (identity === null) {
            unusable.push(sourceObject(idText, title));
            continue;
        }
        const { sourceKey, identityState, legacyId } = identity;
        const objectRef = sourceObject(idText, title === "" ? null : title);

        let sourceType = typeof entry["type"] === "string" ? entry["type"].trim().toLowerCase() : "";
        if (!(SOURCE_TYPES as readonly string[]).includes(sourceType)) {
            typeUnknown.push(objectRef);
            sourceType = "sonstiges";
        }
        const rawLicense = typeof entry["license"] === "string" ? entry["license"].trim().toLowerCase() : "";
        let licenseStatement: LicenseStatement = "unrecorded";
        let licenseKey: string | null = null;
        if (rawLicense === "unfree") {
            licenseStatement = "unfree";
        } else if (rawLicense === "public-domain") {
            licenseStatement = "public_domain";
        } else if (rawLicense !== "" && targets.licenseKeys.has(rawLicense)) {
            licenseStatement = "license";
            licenseKey = rawLicense;
        } else if (rawLicense !== "") {
            licenseUnknown.push(objectRef);
        }
        const attribution = textOf(entry["attribution"]);
        const corpusKey = textOf(entry["corpus"]);
        let storedCorpus: string | null = null;
        if (corpusKey !== null) {
            if (corpusKeys.has(corpusKey)) storedCorpus = corpusKey;
            else corpusMissing.push(objectRef);
        }
        const row: SourceRow = {
            legacyId,
            sourceKey,
            identityState,
            url,
            title,
            sourceType,
            isOfficial: entry["official"] === true,
            licenseStatement,
            licenseKey,
            attribution,
            corpusKey: storedCorpus,
            carriers: [],
        };
        const existing = sourceByKey.get(sourceKey);
        if (existing) {
            duplicateKeys.push(objectRef);
            if (legacyId !== null) sourceByLegacyId.set(legacyId, existing);
            continue;
        }
        sources.push(row);
        sourceByKey.set(sourceKey, row);
        if (legacyId !== null) sourceByLegacyId.set(legacyId, row);

        if (title === "") titleEmpty.push(objectRef);
        if (title !== rawTitle) titleMarkup.push(objectRef);
        if (url !== null && !/^https:/i.test(url)) notHttps.push(objectRef);
        if (licenseStatement === "unrecorded") licenseUnrecorded += 1;
        if (attribution !== null && licenseStatement === "unrecorded") attributionWithoutLicense.push(objectRef);
        if (attribution === null && licenseStatement !== "unrecorded") licenseWithoutAttribution.push(objectRef);
    }

    // ---- Träger auflösen -------------------------------------------------------------------------------------------
    const junctionIds = new Set<string>();
    const labelProps = new Map<string, Bag>();
    const pathFeatures: { publicId: string; props: Bag }[] = [];
    for (const feature of payload.features as { properties?: Bag }[]) {
        const props = feature.properties ?? {};
        const publicId = uuidOf(props["public_id"]);
        if (publicId === null) continue;
        if (props["feature_type"] === "junction" || props["feature_type"] === "crossing") junctionIds.add(publicId);
        if (props["feature_type"] === "label") labelProps.set(publicId, props);
        if (props["feature_type"] === "path") pathFeatures.push({ publicId, props });
    }
    const stateOf = (
        map: ReadonlyMap<string, CarrierState>,
        entityType: string,
        publicId: string,
        kind: CanonCarrierKind,
    ): Resolution => {
        const state = map.get(publicId);
        if (!state) return { ok: false, reason: "missing", entityType };
        if (!state.active) return { ok: false, reason: "inactive", entityType };
        return { ok: true, kind, publicId, name: state.name };
    };
    const resolve = (legacyKey: string): Resolution => {
        const colon = legacyKey.indexOf(":");
        const entityType = colon < 0 ? legacyKey : legacyKey.slice(0, colon);
        const publicId = uuidOf(colon < 0 ? "" : legacyKey.slice(colon + 1));
        if (publicId === null) return { ok: false, reason: "bad_id", entityType };
        const kind = carrierKindOf(entityType);
        switch (kind) {
            case "place": {
                const resolved = stateOf(targets.places, entityType, publicId, "place");
                if (!resolved.ok && resolved.reason === "missing" && junctionIds.has(publicId)) {
                    return { ok: false, reason: "junction", entityType };
                }
                return resolved;
            }
            case "path":
                return stateOf(targets.paths, entityType, publicId, "path");
            case "territory":
                return stateOf(targets.territories, entityType, publicId, "territory");
            case "region":
                return stateOf(targets.regions, entityType, publicId, "region");
            case "powerline":
                return stateOf(targets.powerlines, entityType, publicId, "powerline");
            case "label": {
                // Die Quellen einer GEBUNDENEN Beschriftung hängen an der Region (`ecosystem:`), nie an der Beschriftung.
                if (
                    targets.labels.has(publicId) ||
                    textOf(labelProps.get(publicId)?.["ecosystem_region_public_id"]) !== null
                ) {
                    return { ok: false, reason: "bound_label", entityType };
                }
                return stateOf(targets.peaks, entityType, publicId, "terrain_peak");
            }
            case "citymap":
                return { ok: false, reason: "deferred", entityType };
            default:
                return { ok: false, reason: "unknown_type", entityType };
        }
    };

    // ---- Verknüpfungen -------------------------------------------------------------------------------------------------
    // Vorlauf über die ROHEN Verweise: welche Katalogzeilen irgendwo zitiert werden und wie viele Verweise an vorläufigen Zeilen hängen
    // (so zählt der Vertrag: auch Waisen und Kartensammlung).
    const citedRaw = new Set<number>();
    let provisionalLinksAll = 0;
    let rawTotal = 0;
    const rawByKind: Record<string, number> = {};
    for (const list of Object.values(linkBlock)) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            if (!isBag(item)) continue;
            rawTotal += 1;
            const rawKind =
                typeof item["reference_kind"] === "string" && item["reference_kind"] !== ""
                    ? item["reference_kind"]
                    : "leer";
            rawByKind[rawKind] = (rawByKind[rawKind] ?? 0) + 1;
            const id = typeof item["source_id"] === "number" ? item["source_id"] : Number(item["source_id"]);
            if (!Number.isFinite(id)) continue;
            citedRaw.add(id);
            if (sourceByLegacyId.get(id)?.identityState === "provisional") provisionalLinksAll += 1;
        }
    }
    const links: LinkRow[] = [];
    const orphan = new Map<string, { carriers: Map<string, FindingObject>; links: number }>();
    const orphanReason = (
        resolution: Extract<Resolution, { ok: false }>,
        name: string | null,
        publicId: string,
    ): void => {
        const key = `${resolution.entityType}/${resolution.reason}`;
        const bucket = orphan.get(key) ?? { carriers: new Map<string, FindingObject>(), links: 0 };
        bucket.links += 1;
        bucket.carriers.set(publicId, { table: resolution.entityType, publicId, name });
        orphan.set(key, bucket);
    };
    let deferredCitymap = 0;
    const deferredCitymapCarriers = new Set<string>();
    let withoutCatalogRow = 0;
    const withoutCatalogObjects: FindingObject[] = [];
    let referenceKindUnknown = 0;
    const referenceKindObjects: FindingObject[] = [];
    const duplicateLinks: FindingObject[] = [];
    const exceedsLimit: FindingObject[] = [];
    const carrierHasLinks = new Set<string>();
    const linkedKeys = new Map<string, { kind: CanonCarrierKind; publicId: string; name: string | null }>();
    const seenPairs = new Set<string>();
    const pathLinkSets = new Map<string, Set<string>>();

    for (const legacyKey of Object.keys(linkBlock)) {
        const list = linkBlock[legacyKey];
        // Eine leere Liste sind keine Verweise.
        if (!Array.isArray(list) || list.length === 0) continue;
        const resolution = resolve(legacyKey);
        if (!resolution.ok) {
            if (resolution.reason === "deferred") {
                deferredCitymap += list.length;
                deferredCitymapCarriers.add(legacyKey);
                continue;
            }
            const publicId = uuidOf(legacyKey.slice(legacyKey.indexOf(":") + 1)) ?? legacyKey;
            for (let index = 0; index < list.length; index += 1) {
                orphanReason(resolution, null, publicId);
            }
            continue;
        }
        carrierHasLinks.add(`${resolution.kind}:${resolution.publicId}`);
        linkedKeys.set(`${resolution.kind}:${resolution.publicId}`, {
            kind: resolution.kind,
            publicId: resolution.publicId,
            name: resolution.name,
        });
        if (resolution.kind === "powerline") {
            // Kraftlinien haben im Export keine Verknüpfungen und in Avesmaps3D keine Tabelle dafür (powerline_source fehlt).
            orphanReason(
                { ok: false, reason: "deferred", entityType: "powerline" },
                resolution.name,
                resolution.publicId,
            );
            continue;
        }
        const kind: CarrierKind = resolution.kind;
        const carrierRef: FindingObject = { table: kind, publicId: resolution.publicId, name: resolution.name };
        list.forEach((item, index) => {
            if (!isBag(item)) return;
            const sourceId = typeof item["source_id"] === "number" ? item["source_id"] : Number(item["source_id"]);
            const source = Number.isFinite(sourceId) ? sourceByLegacyId.get(sourceId) : undefined;
            if (!source) {
                withoutCatalogRow += 1;
                withoutCatalogObjects.push(carrierRef);
                return;
            }
            const pairKey = `${kind}|${resolution.publicId}|${source.sourceKey}`;
            if (seenPairs.has(pairKey)) {
                duplicateLinks.push(carrierRef);
                return;
            }
            seenPairs.add(pairKey);
            const rawKind = typeof item["reference_kind"] === "string" ? item["reference_kind"] : "";
            let referenceKind: ReferenceKind | null = null;
            if (rawKind !== "") {
                if (REFERENCE_KINDS.includes(rawKind)) referenceKind = rawKind as ReferenceKind;
                else {
                    referenceKindUnknown += 1;
                    referenceKindObjects.push(carrierRef);
                }
            }
            const pages = textOf(item["pages"]);
            const note = textOf(item["note"]);
            if ((pages !== null && pages.length > 120) || (note !== null && note.length > 200))
                exceedsLimit.push(carrierRef);
            links.push({
                kind,
                carrierPublicId: resolution.publicId,
                carrierName: resolution.name,
                sourceKey: source.sourceKey,
                referenceKind,
                pages,
                note,
                legacyOrigin: textOf(item["origin"]),
                position: index,
            });
            source.carriers.push(`${kind}:${resolution.publicId}`);
            if (kind === "path") {
                const set = pathLinkSets.get(resolution.publicId) ?? new Set<string>();
                set.add(source.sourceKey);
                pathLinkSets.set(resolution.publicId, set);
            }
        });
    }
    for (const source of sources) source.carriers.sort();

    // ---- Unterdrückte Verknüpfungen (E1+, nur wenn der Block im Satz steht) -----------------------------------------------
    const tombstones: TombstoneRow[] = [];
    const tombstoneBlock = readTombstoneBlock(raw["feature_sources_suppressed"]);
    const tombstoneSkipped: FindingObject[] = [];
    const tombstoneAlsoApproved: FindingObject[] = [];
    const seenTombstones = new Set<string>();
    if (tombstoneBlock.state === "present") {
        const perCarrier = new Map<string, number>();
        for (const { legacyKey, item } of tombstoneBlock.entries) {
            const resolution = resolve(legacyKey);
            const sourceId = typeof item["source_id"] === "number" ? item["source_id"] : Number(item["source_id"]);
            const source = Number.isFinite(sourceId) ? sourceByLegacyId.get(sourceId) : undefined;
            const publicId = uuidOf(legacyKey.slice(legacyKey.indexOf(":") + 1)) ?? legacyKey;
            if (!resolution.ok || resolution.kind === "powerline" || !source) {
                tombstoneSkipped.push({ table: legacyKey.split(":")[0] ?? "", publicId, name: null });
                continue;
            }
            const kind: CarrierKind = resolution.kind;
            const carrierRef: FindingObject = { table: kind, publicId: resolution.publicId, name: resolution.name };
            const pairKey = `${kind}|${resolution.publicId}|${source.sourceKey}`;
            if (seenPairs.has(pairKey)) {
                // Legacy hat je (Träger, Quelle) nur EINEN Zustand; ein Satz, der beide nennt, ist widersprüchlich: genehmigt gewinnt.
                tombstoneAlsoApproved.push(carrierRef);
                continue;
            }
            if (seenTombstones.has(pairKey)) continue;
            seenTombstones.add(pairKey);
            const rawKind = typeof item["reference_kind"] === "string" ? item["reference_kind"] : "";
            const position = perCarrier.get(`${kind}|${resolution.publicId}`) ?? 0;
            perCarrier.set(`${kind}|${resolution.publicId}`, position + 1);
            tombstones.push({
                kind,
                carrierPublicId: resolution.publicId,
                carrierName: resolution.name,
                sourceKey: source.sourceKey,
                legacyOrigin: textOf(item["origin"]),
                referenceKind: REFERENCE_KINDS.includes(rawKind) ? (rawKind as ReferenceKind) : null,
                pages: textOf(item["pages"]),
                note: textOf(item["note"]),
                position,
            });
        }
    }

    // ---- Kanon ---------------------------------------------------------------------------------------------------------
    const canon: CanonRow[] = [];
    const unresolvableEntries: FindingObject[] = [];
    let boundLabelEntries = 0;
    const boundLabelObjects: FindingObject[] = [];
    const unknownValue: FindingObject[] = [];
    const seenCanon = new Set<string>();
    const canonOf = (
        entry: Bag,
    ): {
        canon: Canon;
        designatorType: string | null;
        designatorCount: number | null;
        designatorLabel: string | null;
    } | null => {
        const value = entry["kanon"];
        if (value !== "offiziell" && value !== "inoffiziell" && value !== "") return null;
        if (value === "offiziell")
            return { canon: "official", designatorType: null, designatorCount: null, designatorLabel: null };
        if (value === "")
            return { canon: "unlabelled", designatorType: null, designatorCount: null, designatorLabel: null };
        const type = typeof entry["bezeichner_type"] === "string" ? entry["bezeichner_type"] : "";
        const count =
            typeof entry["bezeichner_count"] === "number" &&
            Number.isInteger(entry["bezeichner_count"]) &&
            entry["bezeichner_count"] >= 2
                ? entry["bezeichner_count"]
                : null;
        return {
            canon: "unofficial",
            designatorType: (SOURCE_TYPES as readonly string[]).includes(type) ? type : null,
            designatorCount: count,
            designatorLabel: textOf(entry["bezeichner_label"]),
        };
    };
    for (const legacyKey of Object.keys(entries)) {
        const entry = entries[legacyKey];
        if (!isBag(entry)) continue;
        const resolution = resolve(legacyKey);
        if (!resolution.ok) {
            const id = uuidOf(legacyKey.slice(legacyKey.indexOf(":") + 1)) ?? legacyKey;
            if (resolution.reason === "bound_label") {
                boundLabelEntries += 1;
                boundLabelObjects.push({
                    table: "map_label",
                    publicId: id,
                    name: textOf(labelProps.get(id)?.["name"]),
                });
            } else if (resolution.reason !== "deferred" || resolution.entityType !== "citymap") {
                unresolvableEntries.push({ table: resolution.entityType, publicId: id, name: null });
            } else {
                unresolvableEntries.push({ table: "citymap", publicId: id, name: null });
            }
            continue;
        }
        const parsed = canonOf(entry);
        const carrierKey = `${resolution.kind}:${resolution.publicId}`;
        if (parsed === null) {
            unknownValue.push({ table: resolution.kind, publicId: resolution.publicId, name: resolution.name });
            continue;
        }
        if (seenCanon.has(carrierKey)) continue;
        seenCanon.add(carrierKey);
        canon.push({
            kind: resolution.kind,
            carrierPublicId: resolution.publicId,
            carrierName: resolution.name,
            ...parsed,
            derivedFrom: "legacy_feature_kanon",
        });
    }
    // Träger mit Verweisen und ohne Eintrag: die Vorgabe, ausgeschrieben.
    for (const [carrierKey, carrier] of linkedKeys) {
        if (seenCanon.has(carrierKey)) continue;
        seenCanon.add(carrierKey);
        canon.push({
            kind: carrier.kind,
            carrierPublicId: carrier.publicId,
            carrierName: carrier.name,
            canon: "official",
            designatorType: null,
            designatorCount: null,
            designatorLabel: null,
            derivedFrom: "legacy_feature_kanon_default",
        });
    }

    // ---- Befunde -------------------------------------------------------------------------------------------------------
    const provisional = sources.filter((source) => source.identityState === "provisional");
    if (provisional.length > 0) {
        const provisionalKeys = new Set(provisional.map((source) => source.sourceKey));
        const provisionalLinks = links.filter((link) => provisionalKeys.has(link.sourceKey)).length;
        findings.push(
            createFinding(
                "source_identity_provisional",
                `${String(provisional.length)} URL-lose Quellen ohne wiki_key tragen eine vorläufige Identität (legacy-id): ${String(provisionalLinksAll)} Verweise, davon ${String(provisionalLinks)} auf Träger in Avesmaps3D aufgelöst; bis Legacy den Schlüssel liefert (E1)`,
                { quellen: provisional.length, verweise: provisionalLinksAll, aufgeloest: provisionalLinks },
            ),
        );
    }
    // Doppelte Titel: je Titel mehr als eine Zeile; wie viele davon eine oder zwei URL-lose Zeilen tragen.
    const byTitle = new Map<string, SourceRow[]>();
    for (const source of sources) {
        const list = byTitle.get(source.title) ?? [];
        list.push(source);
        byTitle.set(source.title, list);
    }
    const duplicateTitles = [...byTitle].filter(([, list]) => list.length > 1);
    if (duplicateTitles.length > 0) {
        const withOne = duplicateTitles.filter(
            ([, list]) => list.filter((source) => source.url === null).length >= 1,
        ).length;
        const withTwo = duplicateTitles.filter(
            ([, list]) => list.filter((source) => source.url === null).length >= 2,
        ).length;
        findings.push(
            createFinding(
                "source_title_duplicate",
                `${String(duplicateTitles.length)} Titel kommen doppelt vor (der leere Titel eingerechnet; ${String(withOne)} mit einer URL-losen Zeile, ${String(withTwo)} mit zwei); der Titel ist keine Identität`,
                { titel: duplicateTitles.length, mitUrlLoser: withOne, mitZweiUrlLosen: withTwo },
                duplicateTitles.slice(0, 200).map(([title, list]) => ({
                    table: "feature_source",
                    publicId: list[0]?.sourceKey ?? "",
                    name: title,
                })),
                duplicateTitles.length,
            ),
        );
    }
    const simple = (code: string, message: string, objects: FindingObject[]): void => {
        if (objects.length > 0) findings.push(createFinding(code, message, { zeilen: objects.length }, objects));
    };
    simple(
        "source_title_empty",
        `${String(titleEmpty.length)} Quellen tragen einen leeren Titel; unverändert übernommen`,
        titleEmpty,
    );
    simple(
        "source_title_markup",
        `${String(titleMarkup.length)} Titel trugen Auszeichnung (etwa <br>); bereinigt übernommen`,
        titleMarkup,
    );
    simple(
        "source_url_not_https",
        `${String(notHttps.length)} Adressen beginnen mit http; nur Information (die Anzeige verlinkt http und https)`,
        notHttps,
    );
    if (licenseUnrecorded > 0) {
        findings.push(
            createFinding(
                "source_license_unrecorded",
                `${String(licenseUnrecorded)} Quellen ohne Lizenzangabe (unrecorded); leer heißt nie „keine Lizenz“`,
                { quellen: licenseUnrecorded },
            ),
        );
    }
    simple(
        "source_attribution_without_license",
        `${String(attributionWithoutLicense.length)} Quellen tragen eine Namensnennung ohne Lizenz`,
        attributionWithoutLicense,
    );
    simple(
        "source_license_without_attribution",
        `${String(licenseWithoutAttribution.length)} Quellen tragen eine Lizenz ohne Namensnennung`,
        licenseWithoutAttribution,
    );
    simple(
        "source_license_unknown_key",
        `${String(licenseUnknown.length)} Lizenzschlüssel sind nicht im Katalog; gespeichert als unrecorded`,
        licenseUnknown,
    );
    simple(
        "source_type_unknown",
        `${String(typeUnknown.length)} Quellen tragen eine unbekannte Art; gespeichert als sonstiges`,
        typeUnknown,
    );
    simple(
        "source_corpus_missing",
        `${String(corpusMissing.length)} Quellen nennen einen Korpus, den source_corpora nicht kennt; ohne Korpus gespeichert`,
        corpusMissing,
    );
    simple(
        "source_entry_unusable",
        `${String(unusable.length)} Katalogeinträge ohne lesbaren Schlüssel; ausgelassen`,
        unusable,
    );
    simple(
        "source_duplicate_key",
        `${String(duplicateKeys.length)} Katalogeinträge teilen die Identität einer anderen Zeile; ihre Verknüpfungen gehen an diese`,
        duplicateKeys,
    );

    // Waisen: Träger fehlt, ist inaktiv oder keine Trägerart. Keine Zeile angelegt.
    let orphanLinks = 0;
    const orphanObjects: FindingObject[] = [];
    const orphanNumbers: Record<string, number> = {};
    let carrierCount = 0;
    for (const [key, bucket] of [...orphan].sort()) {
        orphanLinks += bucket.links;
        carrierCount += bucket.carriers.size;
        orphanNumbers[`${key}/traeger`] = bucket.carriers.size;
        orphanNumbers[`${key}/verknuepfungen`] = bucket.links;
        orphanObjects.push(...bucket.carriers.values());
    }
    if (orphanLinks > 0) {
        findings.push(
            createFinding(
                "orphan_link",
                `${String(orphanLinks)} Verknüpfungen von ${String(carrierCount)} Trägern ohne aktive Zeile in Avesmaps3D (fehlt, inaktiv oder keine Trägerart); keine Zeile angelegt`,
                orphanNumbers,
                orphanObjects,
                carrierCount,
            ),
        );
        const junction = orphan.get("settlement/junction");
        if (junction) {
            findings.push(
                createFinding(
                    "carrier_is_junction",
                    `${String(junction.links)} Verknüpfung(en) einer settlement-Verknüpfung auf einer Wegkreuzung statt auf einem Ort`,
                    { verknuepfungen: junction.links },
                    [...junction.carriers.values()],
                ),
            );
        }
    }
    if (deferredCitymap > 0) {
        findings.push(
            createFinding(
                "link_deferred_citymap",
                `${String(deferredCitymap)} citymap-Verknüpfungen an ${String(deferredCitymapCarriers.size)} Trägern ohne Tabelle (zurückgestellt, D2)`,
                { verknuepfungen: deferredCitymap, traeger: deferredCitymapCarriers.size },
            ),
        );
    }
    simple(
        "link_without_catalog_row",
        `${String(withoutCatalogRow)} Verweise ohne Katalogzeile; keine Zeile angelegt`,
        withoutCatalogObjects,
    );
    simple(
        "reference_kind_unknown",
        `${String(referenceKindUnknown)} Verknüpfungen mit unbekannter Art der Quelle; gespeichert als NULL`,
        referenceKindObjects,
    );
    simple(
        "link_duplicate",
        `${String(duplicateLinks.length)} Verknüpfungen doppelt am selben Träger; einmal angelegt`,
        duplicateLinks,
    );
    simple(
        "text_exceeds_legacy_limit",
        `${String(exceedsLimit.length)} Verknüpfungen mit Seiten über 120 oder Notiz über 200 Zeichen (Legacys Grenze); unverändert gespeichert`,
        exceedsLimit,
    );
    const withoutLink = Object.keys(catalog).filter((idText) => !citedRaw.has(Number(idText))).length;
    if (withoutLink > 0) {
        findings.push(
            createFinding(
                "catalog_row_without_link",
                `${String(withoutLink)} Katalogzeilen ohne Verknüpfung im Block feature_sources (Information; vermutlich Lore oder nicht exportierte Träger)`,
                { zeilen: withoutLink },
            ),
        );
    }
    if (links.some((link) => link.kind === "path")) {
        const pathInputs = pathGroupInputs(pathFeatures);
        const groupOf = new Map<string, string>();
        for (const group of computePathGroups(pathInputs).groups) {
            for (const member of group.members)
                if (!groupOf.has(member)) groupOf.set(member, `${group.kind}:${group.key}`);
        }
        const pairs = new Set<string>();
        const byGroup = new Map<string, Set<string>>();
        for (const [publicId, set] of pathLinkSets) {
            const group = groupOf.get(publicId) ?? `single:${publicId}`;
            const setText = [...set].sort().join(",");
            const sets = byGroup.get(group) ?? new Set<string>();
            sets.add(setText);
            byGroup.set(group, sets);
            for (const source of set) pairs.add(`${group}|${source}`);
        }
        const inconsistent = [...byGroup.values()].filter((sets) => sets.size > 1).length;
        findings.push(
            createFinding(
                "path_links_replicated",
                `${String(links.filter((link) => link.kind === "path").length)} Wegverknüpfungen je Segment entsprechen ${String(pairs.size)} verschiedenen (Gruppe, Quelle); ${String(inconsistent)} Gruppen mit uneinheitlichen Sätzen (Information)`,
                {
                    verknuepfungen: links.filter((link) => link.kind === "path").length,
                    gruppeQuelle: pairs.size,
                    gruppenUneinheitlich: inconsistent,
                },
            ),
        );
    }
    if (unresolvableEntries.length > 0) {
        findings.push(
            createFinding(
                "kanon_entry_unresolvable",
                `${String(unresolvableEntries.length)} Kanon-Einträge ohne auflösbaren Träger; nicht übernommen`,
                { eintraege: unresolvableEntries.length },
                unresolvableEntries,
            ),
        );
    }
    if (boundLabelEntries > 0) {
        findings.push(
            createFinding(
                "kanon_entry_bound_label",
                `${String(boundLabelEntries)} Kanon-Einträge region:<gebundene Beschriftung>: die Auskunft steht unter ecosystem:; nicht übernommen`,
                { eintraege: boundLabelEntries },
                boundLabelObjects,
            ),
        );
    }
    simple(
        "kanon_value_unknown",
        `${String(unknownValue.length)} Kanon-Einträge mit unbekanntem Wert; nicht übernommen`,
        unknownValue,
    );
    if (tombstoneBlock.state === "absent") {
        findings.push(
            createFinding(
                "suppressed_not_exported",
                "Unterdrückte Verknüpfungen sind (noch) nicht im Export: E1+ ist freigegeben, aber nicht gebaut; state suppressed bleibt unbelegt, die Herkunft je Verknüpfung NULL",
                {},
            ),
        );
    } else if (tombstoneBlock.state === "unusable") {
        findings.push(
            createFinding(
                "suppressed_block_unusable",
                "feature_sources_suppressed ist weder Liste noch Objekt; der Block wird nicht gelesen",
                {},
            ),
        );
    } else {
        findings.push(
            createFinding(
                "suppressed_imported",
                `${String(tombstones.length)} unterdrückte Verknüpfungen aus dem Export (E1+) als Tombstone state suppressed; sie werden nie wieder belebt`,
                { tombstones: tombstones.length },
            ),
        );
        simple(
            "suppressed_unresolvable",
            `${String(tombstoneSkipped.length)} unterdrückte Verknüpfungen ohne aktiven Träger oder ohne Katalogzeile; nicht angelegt`,
            tombstoneSkipped,
        );
        simple(
            "suppressed_link_also_approved",
            `${String(tombstoneAlsoApproved.length)} Verknüpfungen stehen im Satz als genehmigt UND als unterdrückt (widersprüchlich); genehmigt gewinnt`,
            tombstoneAlsoApproved,
        );
    }

    return {
        skipped: false,
        revision,
        corpora,
        sources,
        links,
        tombstones,
        tombstoneBlock: tombstoneBlock.state,
        canon,
        linkTotals: {
            total: rawTotal,
            resolved: links.length,
            orphan: orphanLinks,
            deferred: deferredCitymap,
            skipped: withoutCatalogRow + duplicateLinks.length,
            byReferenceKind: rawByKind,
        },
        findings,
    };
}

/**
 * Der Block der unterdrückten Verknüpfungen (E1+). Der Export ist noch nicht gebaut; gelesen wird tolerant beide naheliegenden
 * Formen: eine Liste von `{entity_type, entity_public_id, source_id, origin?, …}` oder ein Objekt `{ "<Art>:<öffentliche ID>": [{source_id,
 * origin?, …}] }` wie `feature_sources`. Fehlt der Block, ist er `absent`.
 */
function readTombstoneBlock(
    block: unknown,
): { state: "absent" } | { state: "unusable" } | { state: "present"; entries: { legacyKey: string; item: Bag }[] } {
    if (block === undefined || block === null) return { state: "absent" };
    const entries: { legacyKey: string; item: Bag }[] = [];
    if (Array.isArray(block)) {
        for (const item of block) {
            if (!isBag(item)) continue;
            const type = typeof item["entity_type"] === "string" ? item["entity_type"] : "";
            const id = typeof item["entity_public_id"] === "string" ? item["entity_public_id"] : "";
            if (type !== "" && id !== "") entries.push({ legacyKey: `${type}:${id}`, item });
        }
        return { state: "present", entries };
    }
    if (isBag(block)) {
        for (const [legacyKey, list] of Object.entries(block)) {
            if (!Array.isArray(list)) continue;
            for (const item of list) if (isBag(item)) entries.push({ legacyKey, item });
        }
        return { state: "present", entries };
    }
    return { state: "unusable" };
}

/** Die Eingabe der Wegegruppen aus den Wegen der Quelle (Legacy: `display_name`, `wiki_path`, `wiki_path_weitere`). */
export function pathGroupInputs(features: readonly { publicId: string; props: Bag }[]): PathGroupInput[] {
    return features.map(({ publicId, props }) => {
        const nest = isBag(props["wiki_path"]) ? props["wiki_path"] : null;
        const further = Array.isArray(props["wiki_path_weitere"]) ? props["wiki_path_weitere"] : [];
        return {
            publicId,
            name:
                typeof props["display_name"] === "string"
                    ? props["display_name"]
                    : typeof props["name"] === "string"
                      ? props["name"]
                      : "",
            subtype: typeof props["feature_subtype"] === "string" ? props["feature_subtype"] : "",
            mainKey: nest ? textOf(nest["wiki_key"]) : null,
            further: further
                .filter((entry): entry is Bag => isBag(entry) && textOf(entry["wiki_key"]) !== null)
                .map((entry) => ({ key: entry["wiki_key"] as string, name: textOf(entry["name"]) })),
            wikiName: nest ? textOf(nest["name"]) : null,
        };
    });
}
