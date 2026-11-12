import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import {
    countResolution,
    emptyTotals,
    numberPlaces,
    placeObject,
    resolveTarget,
    type LegacyTarget,
    type RawPlace,
    type Resolution,
    type ResolutionNote,
    type ResolutionTotals,
    type TargetIndex,
} from "./catalog-places.ts";
import { isLocalUpload } from "./literature.ts";
import { catalogSourceIdentity } from "./sources.ts";
import { textOf, uuidOf } from "./subject-details.ts";

/**
 * Kartensammlung: die reine Umwandlung der Antwort von `citymaps.php` in Karten, Typen, Beziehungen, Ortsbezüge, Fundstellen und die
 * Quellenverknüpfung (WI-0063 P3, Vertrag `project-control/migration/contracts/citymaps.yaml`, D2).
 *
 * Diese Datei kennt weder Datenbank noch Netz; was sie über die Ziele der Ortsbezüge wissen muss, bekommt sie als `TargetIndex`. Der
 * Prüfer rechnet dieselbe Funktion noch einmal.
 *
 * 🔴 Alles verbatim, nichts geparst (auch `note` nicht: sie kann Abgleichstext tragen). Eigenschaften sind DREIWERTIG: `null` heißt
 * unbekannt, nie „nein“. `is_paid` gehört zum LINK, nicht zur Karte.
 * 🔴 `thumb`, `map_local_url` werden NIE übernommen (die Beziehung zu den Bildern entsteht mit dem Medienimport, MEDIA-M8); `thumb_auto_url`
 * und `thumb_url` stehen nicht in der Antwort und werden nie Asset.
 * 🔴 Die Quellenverknüpfung (`citymap_source`) kommt aus dem Block `feature_sources` der `map-features.json` desselben Zuges (Träger
 * `citymap:<public_id>`), nicht aus der Anzeigekopie `sources[]` der Antwort; sie wird nicht vererbt.
 * 🔴 Nichts blockiert (AGENTS.md, „Blockierende Prüfungen im Betrieb“): Ist die Antwort unbrauchbar, leer bei aktivem Schalter oder der
 * Schalter aus, schreibt der Schritt nichts, legt nichts still und meldet `source_block_missing`, `source_empty_catalog` beziehungsweise
 * `source_switched_off`; der Lauf geht weiter. Alle anderen Codes melden nur.
 *
 * Die PRIVATEN Felder (Anfrage E5 und E5+, noch nicht gebaut) kommen als eigene Datei (`parseCitymapOverlay`); ihr Format ist eine
 * ANNAHME, die der Legacy-Export bestätigen muss. Ohne sie bleiben `legacy_origin` `unknown` und `legacy_wiki_key` NULL, und es gibt
 * keine Zuordnung des eigenen Wiki-Artikels und keine Tombstones.
 */

export const CITYMAPS_CONTRACT_VERSION = "1";

export const CITYMAP_TYPE_KEYS: readonly string[] = [
    "ortsplan",
    "stadtplan",
    "bezirk",
    "viertel",
    "lageplan",
    "uebersicht",
    "schauplatz",
    "grundriss",
    "befestigungen",
    "dungeon",
    "hoehlen",
    "krypten",
    "katakomben",
    "schatzkarte",
    "region",
    "sonstige",
];
export const CITYMAP_ARTS: readonly string[] = ["politisch", "derographisch", "topologisch", "skizze"];
export const COLOR_MODES: readonly string[] = ["graustufen", "braun", "farbig"];
const REFERENCE_KINDS: readonly string[] = ["ausfuehrlich", "ergaenzend", "erwaehnung"];

export type CityOrigin = "manual" | "community" | "wiki" | "unknown";
const CITY_ORIGINS: readonly string[] = ["manual", "community", "wiki"];

/** Legacys Obergrenzen (Spaltenbreiten): Ein längerer Text wird unverändert gespeichert und als Befund gemeldet. */
const LIMITS = {
    title: 300,
    author: 300,
    publisher: 160,
    format: 120,
    note: 2000,
    raw_name: 300,
    link_label: 200,
    link_url: 500,
} as const;

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface MapRow {
    publicId: string;
    title: string;
    /** `null`: keine, unbekannt oder Teil eines Zyklus (siehe die Befunde). */
    parentPublicId: string | null;
    art: string | null;
    colorMode: string | null;
    isMultilevel: boolean | null;
    isLabeled: boolean | null;
    isOfficial: boolean | null;
    isSpoiler: boolean | null;
    hasScale: boolean | null;
    widthPx: number | null;
    heightPx: number | null;
    format: string | null;
    validFromBf: number | null;
    validToBf: number | null;
    author: string | null;
    publisher: string | null;
    note: string | null;
}

export interface TypeRow {
    mapPublicId: string;
    mapTitle: string;
    typeKey: string;
}

/** Das unsortierte Paar zweier Karten (`a` ist die kleinere öffentliche ID als Text; die Kennung in der Tabelle ordnet der Import). */
export interface RelatedPair {
    a: string;
    b: string;
    titleA: string;
}

export interface MapPlaceRow {
    mapPublicId: string;
    mapTitle: string;
    sortOrder: number;
    exportOrdinal: number;
    nameKey: string;
    dupOrdinal: number;
    rawName: string;
    legacy: LegacyTarget;
    territoryPath: string[];
    resolution: Resolution;
}

export interface MapLinkRow {
    mapPublicId: string;
    mapTitle: string;
    role: "primary" | "further";
    url: string;
    label: string;
    isPaid: boolean | null;
    position: number;
}

export interface MapSourceRow {
    mapPublicId: string;
    mapTitle: string;
    /** `source_key` der Katalogzeile in `feature_source`. */
    sourceKey: string;
    referenceKind: string | null;
    pages: string | null;
    note: string | null;
    legacyOrigin: string | null;
    position: number;
}

export interface OverlayLink {
    url: string;
    label: string | null;
    isPaid: boolean | null;
    origin: CityOrigin;
    suppressed: boolean;
    role: "primary" | "further";
}

export interface OverlayPlace {
    sortOrder: number;
    rawName: string;
    origin: CityOrigin;
    suppressed: boolean;
    legacy: LegacyTarget;
}

export interface ArticleAssignment {
    state: "assigned" | "separated";
    wikiUrl: string | null;
    articleKey: string | null;
    articleTitle: string | null;
    origin: "legacy_editor" | "legacy_wiki_publication" | "unknown";
}

export interface CitymapOverlayEntry {
    publicId: string;
    origin: CityOrigin | null;
    suppressed: boolean;
    wikiKey: string | null;
    /** Die Felder des eigenen Wiki-Artikels, soweit die Datei sie nennt. */
    article: {
        url: string | null;
        key: string | null;
        title: string | null;
        noArticle: boolean;
        origin: string | null;
    } | null;
    places: OverlayPlace[] | null;
    links: OverlayLink[] | null;
}

export interface CitymapOverlay {
    entries: ReadonlyMap<string, CitymapOverlayEntry>;
    findings: Finding[];
}

function originOf(value: unknown): CityOrigin | null {
    return typeof value === "string" && CITY_ORIGINS.includes(value.trim()) ? (value.trim() as CityOrigin) : null;
}

function triBool(value: unknown): boolean | null {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    return null;
}

function intOrNull(value: unknown): number | null {
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value);
    return null;
}

function legacyTargetOf(item: Bag): LegacyTarget {
    return {
        kind: textOf(item["target_kind"]),
        publicId: textOf(item["target_public_id"]),
        wikiKey: textOf(item["target_wiki_key"]),
    };
}

/**
 * Liest die Datei mit den privaten Feldern (E5/E5+). ANNAHME, vom Legacy-Export noch zu bestätigen: `{ citymaps: [ { public_id, origin,
 * status, wiki_key, article_url, article_key, article_title, no_article, article_origin, places: [ { sort_order, raw_name, origin,
 * status, target_kind, target_public_id, target_wiki_key } ], links: [ { url, label, is_paid, origin, status, key } ] } ] }`. Der
 * Schlüssel `key` eines Links ist `map` für den Karten-Link, sonst `link:<n>`. Was nicht lesbar ist, wird gemeldet und ausgelassen.
 */
export function parseCitymapOverlay(raw: unknown): CitymapOverlay {
    const findings: Finding[] = [];
    const entries = new Map<string, CitymapOverlayEntry>();
    const list = isBag(raw) ? raw["citymaps"] : null;
    if (!Array.isArray(list)) {
        findings.push(
            createFinding(
                "private_file_unusable",
                "Die Datei mit den privaten Feldern trägt keine Liste `citymaps`; sie wird nicht verwendet",
                {},
            ),
        );
        return { entries, findings };
    }
    const unusable: FindingObject[] = [];
    for (const item of list) {
        if (!isBag(item)) continue;
        const publicId = uuidOf(item["public_id"]);
        if (publicId === null) {
            unusable.push({ table: "citymap", publicId: String(item["public_id"] ?? ""), name: null });
            continue;
        }
        const hasArticle = ["article_url", "article_key", "article_title", "no_article", "article_origin"].some(
            (key) => key in item,
        );
        const places: OverlayPlace[] = [];
        if (Array.isArray(item["places"])) {
            for (const place of item["places"]) {
                if (!isBag(place)) continue;
                const rawName = textOf(place["raw_name"]);
                const sortOrder = Number(place["sort_order"]);
                if (rawName === null || !Number.isInteger(sortOrder)) continue;
                places.push({
                    sortOrder,
                    rawName,
                    origin: originOf(place["origin"]) ?? "unknown",
                    suppressed: place["status"] === "suppressed",
                    legacy: legacyTargetOf(place),
                });
            }
        }
        const links: OverlayLink[] = [];
        if (Array.isArray(item["links"])) {
            for (const link of item["links"]) {
                if (!isBag(link)) continue;
                const url = textOf(link["url"]);
                if (url === null) continue;
                links.push({
                    url,
                    label: textOf(link["label"]),
                    isPaid: triBool(link["is_paid"]),
                    origin: originOf(link["origin"]) ?? "unknown",
                    suppressed: link["status"] === "suppressed",
                    role: link["key"] === "map" ? "primary" : "further",
                });
            }
        }
        entries.set(publicId, {
            publicId,
            origin: originOf(item["origin"]),
            suppressed: item["status"] === "suppressed",
            wikiKey: textOf(item["wiki_key"]),
            article: hasArticle
                ? {
                      url: textOf(item["article_url"]),
                      key: textOf(item["article_key"]),
                      title: textOf(item["article_title"]),
                      noArticle: item["no_article"] === true || item["no_article"] === 1,
                      origin: textOf(item["article_origin"]),
                  }
                : null,
            places: Array.isArray(item["places"]) ? places : null,
            links: Array.isArray(item["links"]) ? links : null,
        });
    }
    if (unusable.length > 0) {
        findings.push(
            createFinding(
                "private_entry_unusable",
                `${String(unusable.length)} Einträge der Datei mit den privaten Feldern ohne lesbare public_id; ausgelassen`,
                { eintraege: unusable.length },
                unusable,
            ),
        );
    }
    return { entries, findings };
}

export interface PrivateMap {
    publicId: string;
    origin: CityOrigin | null;
    wikiKey: string | null;
}

export interface PrivatePlace {
    mapPublicId: string;
    sortOrder: number;
    nameKey: string;
    dupOrdinal: number;
    origin: CityOrigin;
}

export interface SuppressedPlace {
    mapPublicId: string;
    mapTitle: string;
    sortOrder: number;
    exportOrdinal: number;
    nameKey: string;
    dupOrdinal: number;
    rawName: string;
    legacy: LegacyTarget;
    origin: CityOrigin;
}

export interface PrivateLink {
    mapPublicId: string;
    url: string;
    origin: CityOrigin;
}

export interface SuppressedLink {
    mapPublicId: string;
    mapTitle: string;
    role: "primary" | "further";
    url: string;
    label: string;
    isPaid: boolean | null;
    position: number;
    origin: CityOrigin;
}

export interface AssignmentRow {
    mapPublicId: string;
    mapTitle: string;
    assignment: ArticleAssignment;
}

export type SourcesPart = "applied" | "no_features" | "block_missing";

/** Die Verweise der Karten im Satz, gezählt (Vertrag `verifier`: Summe aus angelegten und gemeldeten Waisen gleich der Zahl der Verweise). */
export interface SourceTotals {
    /** Verweise `citymap:<public_id>` im Satz. */
    total: number;
    /** Träger `citymap:` mit mindestens einem Verweis. */
    carriers: number;
    /** Verweise, deren Karte nicht im Katalog steht (nicht angelegt). */
    withoutMapLinks: number;
    /** Verweise ohne Katalogzeile (nicht angelegt). */
    withoutCatalog: number;
    /** Doppelte (Karte, Quelle) (einmal angelegt). */
    duplicates: number;
    /** Verschiedene Quellen über alle Verweise mit Katalogzeile, davon URL-lose. */
    distinctSources: number;
    urlLessSources: number;
    /** Verweise mit leerer Art (echte Quelle), mit Seiten und mit Notiz. */
    emptyKind: number;
    withPages: number;
    withNote: number;
}

export interface CitymapsTransform {
    /** `true`: die Antwort ist unbrauchbar, leer bei aktivem Schalter oder der Schalter ist aus; der Aufrufer schreibt nichts. */
    skipped: boolean;
    maps: MapRow[];
    types: TypeRow[];
    related: RelatedPair[];
    places: MapPlaceRow[];
    links: MapLinkRow[];
    /** Die Quellenverknüpfung; nur gültig, wenn `sourcesPart` `applied` ist. */
    sources: MapSourceRow[];
    sourcesPart: SourcesPart;
    sourceTotals: SourceTotals | null;
    privateMaps: PrivateMap[];
    privatePlaces: PrivatePlace[];
    privateLinks: PrivateLink[];
    suppressedMaps: string[];
    suppressedPlaces: SuppressedPlace[];
    suppressedLinks: SuppressedLink[];
    /** Die Zuordnung des eigenen Wiki-Artikels; nur mit der Datei (`overlay`), sonst leer. */
    assignments: AssignmentRow[];
    totals: ResolutionTotals;
    findings: Finding[];
}

function skip(findings: Finding[]): CitymapsTransform {
    return {
        skipped: true,
        maps: [],
        types: [],
        related: [],
        places: [],
        links: [],
        sources: [],
        sourcesPart: "no_features",
        sourceTotals: null,
        privateMaps: [],
        privatePlaces: [],
        privateLinks: [],
        suppressedMaps: [],
        suppressedPlaces: [],
        suppressedLinks: [],
        assignments: [],
        totals: emptyTotals(),
        findings,
    };
}

const NOTE_MESSAGES: Record<ResolutionNote, (n: number) => string> = {
    place_unresolved: (n) =>
        `${String(n)} Orte ohne Ziel in Legacy selbst (unresolved, bei Wiki-Karten etwa „Bosparan“, „Aventurien“); der Rohname bleibt stehen`,
    place_unmatched: (n) =>
        `${String(n)} Orte, deren Ziel Legacy nennt, Avesmaps3D aber nicht findet oder nur inaktiv (unmatched); Kennung und Schlüssel bleiben als Text, die Auflösung wird bei jedem Lauf neu gerechnet`,
    place_target_ambiguous: (n) =>
        `${String(n)} Orte, deren Wiki-Schlüssel mehrere aktive Ziele trifft; nie still gewählt (unmatched)`,
    place_target_key_disagrees: (n) =>
        `${String(n)} Orte, bei denen Kennung und Wiki-Schlüssel auf verschiedene Ziele zeigen; die Kennung gewinnt`,
    place_kind_unknown: (n) =>
        `${String(n)} Orte mit einer Legacy-Art ausserhalb von settlement, territory, region, path; unmatched`,
    path_anchor_derived: (n) =>
        `${String(n)} Weg-Ziele wurden über den Schlüssel aufgelöst; der Anker ist das Segment der Wegegruppe mit der kleinsten public_id`,
};

/**
 * Wandelt die Antwort um. `options.features` ist der Satz `map-features.json` desselben Zuges (nur für die Quellenverknüpfung der
 * Karten; ohne ihn entfällt dieser Teil mit Befund), `options.overlay` die privaten Felder (E5/E5+) oder `null`.
 */
export function transformCitymaps(
    payload: unknown,
    index: TargetIndex,
    options: { features?: unknown; overlay?: CitymapOverlay | null } = {},
): CitymapsTransform {
    const overlay = options.overlay ?? null;
    const bag = isBag(payload) ? payload : null;
    if (bag === null || bag["ok"] !== true || !Array.isArray(bag["citymaps"])) {
        return skip([
            createFinding(
                "source_block_missing",
                "Die Antwort von citymaps.php ist unbrauchbar (ok nicht true oder citymaps keine Liste); der Schritt schreibt nichts und legt nichts still, der Lauf geht weiter",
                { grund: bag === null ? "kein Objekt" : bag["ok"] !== true ? "ok nicht true" : "citymaps keine Liste" },
            ),
        ]);
    }
    if (bag["citymaps_enabled"] === false) {
        return skip([
            createFinding(
                "source_switched_off",
                "Die Kartensammlung ist in Legacy abgeschaltet (citymaps_enabled false): kein Stand, nichts wird stillgelegt; ein leerer Katalog ist hier nicht „alles entfernt“",
                {},
            ),
        ]);
    }
    const list = bag["citymaps"];
    if (list.length === 0) {
        return skip([
            createFinding(
                "source_empty_catalog",
                "Der Katalog ist leer, obwohl citymaps_enabled nicht false meldet; der Schritt schreibt nichts und legt nichts still",
                {},
            ),
        ]);
    }

    const findings: Finding[] = [];
    if (bag["citymap_previews_enabled"] === false) {
        findings.push(
            createFinding(
                "source_switched_off",
                "Die Vorschauen sind in Legacy abgeschaltet (citymap_previews_enabled false): jede thumb ist leer; das ist KEIN Entfernen, der Medienimport legt keine Vorschau-Bindung still",
                { vorschauen: 0 },
            ),
        );
    }
    const maps: MapRow[] = [];
    const types: TypeRow[] = [];
    const places: MapPlaceRow[] = [];
    const links: MapLinkRow[] = [];
    const totals = emptyTotals();
    const seenMaps = new Set<string>();
    const titleOfId = new Map<string, string>();
    /** Je Karte: die Rohangaben, die erst nach dem ersten Durchlauf (alle Karten bekannt) aufgelöst werden. */
    const parentRaw = new Map<string, string>();
    const relatedRaw = new Map<string, string[]>();
    const displaySources = new Map<string, Bag[]>();

    const unusable: FindingObject[] = [];
    const duplicateMaps: FindingObject[] = [];
    const typeUnknown: FindingObject[] = [];
    const artUnknown: FindingObject[] = [];
    const withoutLink: FindingObject[] = [];
    const paidWithoutLink: FindingObject[] = [];
    const schemeRejected: FindingObject[] = [];
    const duplicateUrls: FindingObject[] = [];
    const semistructured: FindingObject[] = [];
    const openEnd: FindingObject[] = [];
    const exceeds: FindingObject[] = [];
    const external: FindingObject[] = [];
    const duplicateRows: FindingObject[] = [];
    const notes = new Map<ResolutionNote, FindingObject[]>();
    const firstPlace = new Map<string, string>();
    const note = (code: ResolutionNote, object: FindingObject): void => {
        const bucket = notes.get(code) ?? [];
        bucket.push(object);
        notes.set(code, bucket);
    };
    const overLimit = (value: string | null, limit: number, ref: FindingObject, field: string): void => {
        if (value !== null && [...value].length > limit) exceeds.push({ ...ref, name: `${ref.name ?? ""} (${field})` });
    };

    for (const item of list) {
        if (!isBag(item)) {
            unusable.push({ table: "citymap", publicId: "", name: null });
            continue;
        }
        const publicId = uuidOf(item["public_id"]);
        const title = typeof item["title"] === "string" && item["title"].trim() !== "" ? item["title"] : null;
        if (publicId === null || title === null) {
            unusable.push({ table: "citymap", publicId: publicId ?? String(item["public_id"] ?? ""), name: title });
            continue;
        }
        const ref: FindingObject = { table: "citymap", publicId, name: title };
        if (seenMaps.has(publicId)) {
            duplicateMaps.push(ref);
            continue;
        }
        seenMaps.add(publicId);
        titleOfId.set(publicId, title);

        const artRaw = textOf(item["art"]);
        const art = artRaw !== null && CITYMAP_ARTS.includes(artRaw) ? artRaw : null;
        if (artRaw !== null && art === null) artUnknown.push(ref);
        const colorRaw = textOf(item["color_mode"]);
        const row: MapRow = {
            publicId,
            title,
            parentPublicId: null,
            art,
            colorMode: colorRaw !== null && COLOR_MODES.includes(colorRaw) ? colorRaw : null,
            isMultilevel: triBool(item["is_multilevel"]),
            isLabeled: triBool(item["is_labeled"]),
            isOfficial: triBool(item["is_official"]),
            isSpoiler: triBool(item["is_spoiler"]),
            hasScale: triBool(item["has_scale"]),
            widthPx: intOrNull(item["width_px"]),
            heightPx: intOrNull(item["height_px"]),
            format: textOf(item["format"]),
            validFromBf: intOrNull(item["valid_from_bf"]),
            validToBf: intOrNull(item["valid_to_bf"]),
            author: textOf(item["author"]),
            publisher: textOf(item["publisher"]),
            note: textOf(item["note"]),
        };
        maps.push(row);
        parentRaw.set(publicId, textOf(item["parent_public_id"]) ?? "");
        relatedRaw.set(
            publicId,
            Array.isArray(item["related"])
                ? item["related"].flatMap((entry) => (typeof entry === "string" ? [entry] : []))
                : [],
        );
        displaySources.set(publicId, Array.isArray(item["sources"]) ? item["sources"].filter(isBag) : []);
        overLimit(row.title, LIMITS.title, ref, "title");
        overLimit(row.author, LIMITS.author, ref, "author");
        overLimit(row.publisher, LIMITS.publisher, ref, "publisher");
        overLimit(row.format, LIMITS.format, ref, "format");
        overLimit(row.note, LIMITS.note, ref, "note");
        if (row.note !== null && /(?:^|[\s.;])(?:Format|Ma(?:ß|ss)stab)\s*:/i.test(row.note)) semistructured.push(ref);
        if (row.validToBf === 9999) openEnd.push(ref);
        for (const field of ["map_local_url", "thumb"] as const) {
            const address = textOf(item[field]);
            if (address !== null && !isLocalUpload(address, "/uploads/kartensammlungen/")) {
                external.push({ ...ref, name: `${title} (${field})` });
            }
        }

        // ---- Typen: Menge, ein unbekannter Schlüssel wird nicht gespeichert -------------------------------------------------------
        const seenTypes = new Set<string>();
        for (const type of Array.isArray(item["types"]) ? item["types"] : []) {
            if (typeof type !== "string") continue;
            if (!CITYMAP_TYPE_KEYS.includes(type)) {
                typeUnknown.push({ ...ref, name: `${title} (${type})` });
                continue;
            }
            if (seenTypes.has(type)) continue;
            seenTypes.add(type);
            types.push({ mapPublicId: publicId, mapTitle: title, typeKey: type });
        }

        // ---- Orte ----------------------------------------------------------------------------------------------------------------
        const rawPlaces: RawPlace[] = [];
        for (const place of Array.isArray(item["places"]) ? item["places"] : []) {
            if (!isBag(place)) continue;
            const rawName =
                typeof place["raw_name"] === "string" && place["raw_name"].trim() !== "" ? place["raw_name"] : null;
            const sortOrder = Number(place["sort_order"]);
            if (rawName === null || !Number.isInteger(sortOrder)) {
                unusable.push({ table: "citymap_place", publicId, name: `${title} / ${rawName ?? "(ohne Namen)"}` });
                continue;
            }
            rawPlaces.push({
                sortOrder,
                rawName,
                legacy: legacyTargetOf(place),
                territoryPath: Array.isArray(place["territory_path"])
                    ? place["territory_path"].map((entry) => String(entry))
                    : [],
            });
            if ([...rawName].length > LIMITS.raw_name)
                exceeds.push(placeObject("citymap_place", publicId, title, rawName));
        }
        const numbered = numberPlaces(rawPlaces);
        for (const place of numbered.rows) {
            const resolution = resolveTarget(place.legacy, index);
            countResolution(totals, place.legacy.kind, resolution);
            const object = placeObject("citymap_place", publicId, title, place.rawName);
            for (const code of resolution.notes) note(code, object);
            if (place.dupOrdinal > 0) duplicateRows.push(object);
            if (place.exportOrdinal === 0) firstPlace.set(publicId, `${place.nameKey}`);
            places.push({
                mapPublicId: publicId,
                mapTitle: title,
                sortOrder: place.sortOrder,
                exportOrdinal: place.exportOrdinal,
                nameKey: place.nameKey,
                dupOrdinal: place.dupOrdinal,
                rawName: place.rawName,
                legacy: place.legacy,
                territoryPath: place.territoryPath,
                resolution,
            });
        }

        // ---- Fundstellen: der Karten-Link (key map) ist primary, die weiteren (link:<n>) further ----------------------------------------
        const linkList = (Array.isArray(item["links"]) ? item["links"] : []).filter(isBag);
        const ordered = [
            ...linkList.filter((link) => link["key"] === "map").slice(0, 1),
            ...linkList.filter((link) => typeof link["key"] === "string" && link["key"].startsWith("link:")),
        ];
        const seenUrls = new Set<string>();
        let position = 0;
        let primaryStored = false;
        for (const link of ordered) {
            const isPrimary = link["key"] === "map";
            const url = textOf(link["url"]);
            const label = typeof link["label"] === "string" && link["label"].trim() !== "" ? link["label"] : null;
            if (url === null || label === null) {
                unusable.push({ table: "citymap_link", publicId, name: `${title} (${String(link["key"])})` });
                continue;
            }
            if (!/^https?:\/\//i.test(url)) {
                schemeRejected.push({ ...ref, name: `${title} (${String(link["key"])})` });
                continue;
            }
            if (seenUrls.has(url)) {
                duplicateUrls.push(ref);
                continue;
            }
            seenUrls.add(url);
            if ([...label].length > LIMITS.link_label || [...url].length > LIMITS.link_url) {
                exceeds.push({ ...ref, name: `${title} (${String(link["key"])})` });
            }
            if (isPrimary) primaryStored = true;
            links.push({
                mapPublicId: publicId,
                mapTitle: title,
                role: isPrimary ? "primary" : "further",
                url,
                label,
                isPaid: triBool(link["is_paid"]),
                position,
            });
            position += 1;
        }
        if (!linkList.some((link) => link["key"] === "map")) withoutLink.push(ref);
        // is_paid der Karte ist dieselbe Aussage wie is_paid des Karten-Links; ohne Link hat der Wert keinen Träger.
        if (triBool(item["is_paid"]) !== null && !primaryStored) paidWithoutLink.push(ref);
    }

    // ---- Beziehungen: übergeordnet und verwandt (alle Karten sind jetzt bekannt) ---------------------------------------------------------
    const parentUnknown: FindingObject[] = [];
    const parentCycle: FindingObject[] = [];
    const parentOf = new Map<string, string>();
    for (const [publicId, raw] of parentRaw) {
        if (raw === "") continue;
        const parent = uuidOf(raw);
        const ref = { table: "citymap", publicId, name: titleOfId.get(publicId) ?? null };
        if (parent === null || !seenMaps.has(parent)) {
            parentUnknown.push(ref);
            continue;
        }
        parentOf.set(publicId, parent);
    }
    // Zyklen und Selbstverweis: alle Karten, die selbst Teil eines Zyklus sind, verlieren ihr Elter (Karten, die nur in einen Zyklus
    // münden, behalten es: durch sie läuft kein Zyklus).
    const inCycle = new Set<string>();
    for (const start of parentOf.keys()) {
        let current = parentOf.get(start);
        const seen = new Set<string>([start]);
        while (current !== undefined && !seen.has(current)) {
            seen.add(current);
            current = parentOf.get(current);
        }
        if (current === start) {
            // `start` ist Teil des Zyklus (der Weg läuft zu ihm zurück).
            let node: string | undefined = start;
            do {
                inCycle.add(node as string);
                node = parentOf.get(node as string);
            } while (node !== undefined && node !== start);
        }
    }
    for (const row of maps) {
        if (inCycle.has(row.publicId)) {
            parentCycle.push({ table: "citymap", publicId: row.publicId, name: row.title });
            continue;
        }
        row.parentPublicId = parentOf.get(row.publicId) ?? null;
    }

    const relatedUnknown: FindingObject[] = [];
    const relatedSelf: FindingObject[] = [];
    const relatedByPair = new Map<string, { a: string; b: string; seenFrom: Set<string> }>();
    for (const [publicId, ids] of relatedRaw) {
        for (const rawId of ids) {
            const other = uuidOf(rawId);
            const ref = { table: "citymap", publicId, name: titleOfId.get(publicId) ?? null };
            if (other === null || !seenMaps.has(other)) {
                relatedUnknown.push(ref);
                continue;
            }
            if (other === publicId) {
                relatedSelf.push(ref);
                continue;
            }
            const [a, b] = publicId < other ? [publicId, other] : [other, publicId];
            const pair = relatedByPair.get(`${a}|${b}`) ?? { a, b, seenFrom: new Set<string>() };
            pair.seenFrom.add(publicId);
            relatedByPair.set(`${a}|${b}`, pair);
        }
    }
    const related: RelatedPair[] = [];
    const asymmetric: FindingObject[] = [];
    for (const pair of [...relatedByPair.values()].sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1))) {
        related.push({ a: pair.a, b: pair.b, titleA: titleOfId.get(pair.a) ?? "" });
        if (pair.seenFrom.size < 2) {
            const only = [...pair.seenFrom][0] as string;
            asymmetric.push({ table: "citymap", publicId: only, name: titleOfId.get(only) ?? null });
        }
    }

    // ---- Quellenverknüpfung aus dem Satz (feature_sources, Träger citymap:<public_id>) --------------------------------------------------
    const sources: MapSourceRow[] = [];
    let sourcesPart: SourcesPart = "no_features";
    let sourceTotals: SourceTotals | null = null;
    const sourceFindings: Finding[] = [];
    const features = options.features;
    if (features !== undefined && features !== null) {
        const raw = isBag(features) ? features : {};
        const catalog = raw["source_catalog"];
        const linkBlock = raw["feature_sources"];
        if (!isBag(catalog) || !isBag(linkBlock) || Object.keys(catalog).length === 0) {
            sourcesPart = "block_missing";
            sourceFindings.push(
                createFinding(
                    "source_block_missing",
                    "Der Satz trägt keinen brauchbaren Quellenkatalog (source_catalog, feature_sources): die Quellenverknüpfung der Karten (citymap_source) entfällt, der Schritt sonst nicht",
                    { teil: "citymap_source" },
                ),
            );
        } else {
            sourcesPart = "applied";
            const keyByLegacyId = new Map<number, { sourceKey: string; label: string; url: string | null }>();
            const shownBySourceKey = new Map<string, string>();
            for (const [idText, entry] of Object.entries(catalog)) {
                if (!isBag(entry)) continue;
                const identity = catalogSourceIdentity(idText, entry);
                if (identity?.legacyId == null) continue;
                const label = typeof entry["label"] === "string" ? entry["label"] : "";
                keyByLegacyId.set(identity.legacyId, {
                    sourceKey: identity.sourceKey,
                    label,
                    url: textOf(entry["url"]),
                });
                if (!shownBySourceKey.has(identity.sourceKey)) {
                    shownBySourceKey.set(
                        identity.sourceKey,
                        textOf(entry["url"]) ?? textOf(label) ?? identity.sourceKey,
                    );
                }
            }
            const withoutMap = new Map<string, FindingObject>();
            const withoutCatalog: FindingObject[] = [];
            const seenPairs = new Set<string>();
            const carriers = new Set<string>();
            const distinct = new Set<string>();
            const urlLess = new Set<string>();
            let total = 0;
            let duplicates = 0;
            let emptyKind = 0;
            let withPages = 0;
            let withNote = 0;
            for (const [legacyKey, entries] of Object.entries(linkBlock)) {
                if (!legacyKey.startsWith("citymap:") || !Array.isArray(entries)) continue;
                const publicId = uuidOf(legacyKey.slice("citymap:".length));
                if (entries.length > 0) carriers.add(legacyKey);
                for (const [position, item] of entries.entries()) {
                    if (!isBag(item)) continue;
                    total += 1;
                    const sourceId =
                        typeof item["source_id"] === "number" ? item["source_id"] : Number(item["source_id"]);
                    const source = Number.isFinite(sourceId) ? keyByLegacyId.get(sourceId) : undefined;
                    if (source) {
                        distinct.add(source.sourceKey);
                        if (source.url === null) urlLess.add(source.sourceKey);
                        if (textOf(item["reference_kind"]) === null) emptyKind += 1;
                        if (textOf(item["pages"]) !== null) withPages += 1;
                        if (textOf(item["note"]) !== null) withNote += 1;
                    }
                    if (publicId === null || !seenMaps.has(publicId)) {
                        const id = publicId ?? legacyKey;
                        withoutMap.set(id, { table: "citymap", publicId: id, name: null });
                        continue;
                    }
                    const ref = { table: "citymap", publicId, name: titleOfId.get(publicId) ?? null };
                    if (!source) {
                        withoutCatalog.push(ref);
                        continue;
                    }
                    const pairKey = `${publicId}|${source.sourceKey}`;
                    if (seenPairs.has(pairKey)) {
                        duplicates += 1;
                        continue;
                    }
                    seenPairs.add(pairKey);
                    const rawKind = typeof item["reference_kind"] === "string" ? item["reference_kind"] : "";
                    sources.push({
                        mapPublicId: publicId,
                        mapTitle: titleOfId.get(publicId) ?? "",
                        sourceKey: source.sourceKey,
                        referenceKind: REFERENCE_KINDS.includes(rawKind) ? rawKind : null,
                        pages: textOf(item["pages"]),
                        note: textOf(item["note"]),
                        legacyOrigin: textOf(item["origin"]),
                        position,
                    });
                }
            }
            sourceTotals = {
                total,
                carriers: carriers.size,
                withoutMapLinks: total - sources.length - withoutCatalog.length - duplicates,
                withoutCatalog: withoutCatalog.length,
                duplicates,
                distinctSources: distinct.size,
                urlLessSources: urlLess.size,
                emptyKind,
                withPages,
                withNote,
            };
            if (withoutMap.size > 0) {
                sourceFindings.push(
                    createFinding(
                        "source_link_without_map",
                        `${String(withoutMap.size)} Träger citymap: mit Quellenverknüpfung, deren Karte nicht im Katalog steht (unterdrückte Karte, verspäteter Satz); keine Zeile angelegt, die Karte folgt mit dem nächsten Zug`,
                        { traeger: withoutMap.size },
                        [...withoutMap.values()],
                    ),
                );
            }
            if (withoutCatalog.length > 0) {
                sourceFindings.push(
                    createFinding(
                        "link_without_catalog_row",
                        `${String(withoutCatalog.length)} Verweise von Karten ohne Katalogzeile; keine Zeile angelegt`,
                        { verweise: withoutCatalog.length },
                        withoutCatalog,
                    ),
                );
            }
            // Gegenprobe: die Anzeigekopie `sources[]` der Antwort gegen die aufgelösten Verknüpfungen (zwei Abrufe, erwartbar abweichend).
            const resolvedByMap = new Map<string, Set<string>>();
            for (const source of sources) {
                const set = resolvedByMap.get(source.mapPublicId) ?? new Set<string>();
                set.add(shownBySourceKey.get(source.sourceKey) ?? source.sourceKey);
                resolvedByMap.set(source.mapPublicId, set);
            }
            const disagree: FindingObject[] = [];
            for (const [publicId, shown] of displaySources) {
                const theirs = new Set(shown.map((entry) => textOf(entry["url"]) ?? textOf(entry["label"]) ?? ""));
                const ours = resolvedByMap.get(publicId) ?? new Set<string>();
                if (theirs.size !== ours.size || [...theirs].some((entry) => !ours.has(entry))) {
                    disagree.push({ table: "citymap", publicId, name: titleOfId.get(publicId) ?? null });
                }
            }
            if (disagree.length > 0) {
                sourceFindings.push(
                    createFinding(
                        "citymap_sources_disagree",
                        `${String(disagree.length)} Karten, deren Anzeigekopie sources[] von den aufgelösten Verknüpfungen abweicht (zwei Abrufe zu verschiedenen Zeiten, Information)`,
                        { karten: disagree.length, verweise: total },
                        disagree,
                    ),
                );
            }
        }
    }

    // ---- Die privaten Felder (E5 und E5+) -------------------------------------------------------------------------------------------
    const privateMaps: PrivateMap[] = [];
    const privatePlaces: PrivatePlace[] = [];
    const privateLinks: PrivateLink[] = [];
    const suppressedMaps: string[] = [];
    const suppressedPlaces: SuppressedPlace[] = [];
    const suppressedLinks: SuppressedLink[] = [];
    const assignments: AssignmentRow[] = [];
    if (overlay !== null) {
        findings.push(...overlay.findings);
        const placesOf = new Map<string, MapPlaceRow[]>();
        for (const place of places) {
            const group = placesOf.get(place.mapPublicId) ?? [];
            group.push(place);
            placesOf.set(place.mapPublicId, group);
        }
        const linksOf = new Map<string, MapLinkRow[]>();
        for (const link of links) {
            const group = linksOf.get(link.mapPublicId) ?? [];
            group.push(link);
            linksOf.set(link.mapPublicId, group);
        }
        const conflicts: FindingObject[] = [];
        const unknownMaps: FindingObject[] = [];
        const wikiAssignmentVsDecision: FindingObject[] = [];
        const unusablePrivate: FindingObject[] = [];
        for (const entry of overlay.entries.values()) {
            const title = titleOfId.get(entry.publicId);
            if (entry.suppressed) {
                if (title !== undefined) conflicts.push({ table: "citymap", publicId: entry.publicId, name: title });
                else suppressedMaps.push(entry.publicId);
                continue;
            }
            if (title === undefined) {
                unknownMaps.push({ table: "citymap", publicId: entry.publicId, name: null });
                continue;
            }
            privateMaps.push({ publicId: entry.publicId, origin: entry.origin, wikiKey: entry.wikiKey });
            // Zuordnung des eigenen Wiki-Artikels.
            if (entry.article !== null) {
                const origin =
                    entry.article.origin === "manual"
                        ? "legacy_editor"
                        : entry.article.origin === "wiki_publication"
                          ? "legacy_wiki_publication"
                          : "unknown";
                const url = entry.article.url;
                if (url !== null && /^https?:\/\//i.test(url)) {
                    if (entry.article.noArticle) {
                        // Adresse und no_article zugleich: ein Widerspruch in Legacy; beide Aussagen bleiben, assigned mit Adresse gewinnt.
                        wikiAssignmentVsDecision.push({ table: "citymap", publicId: entry.publicId, name: title });
                    }
                    assignments.push({
                        mapPublicId: entry.publicId,
                        mapTitle: title,
                        assignment: {
                            state: "assigned",
                            wikiUrl: url,
                            articleKey: entry.article.key,
                            articleTitle: entry.article.title,
                            origin,
                        },
                    });
                } else if (url !== null) {
                    schemeRejected.push({ table: "citymap", publicId: entry.publicId, name: `${title} (article_url)` });
                } else if (entry.article.noArticle) {
                    assignments.push({
                        mapPublicId: entry.publicId,
                        mapTitle: title,
                        assignment: { state: "separated", wikiUrl: null, articleKey: null, articleTitle: null, origin },
                    });
                }
            }
            if (entry.places !== null) {
                const ofMap = placesOf.get(entry.publicId) ?? [];
                const present = new Map(
                    ofMap.map((place) => [
                        `${String(place.sortOrder)}|${place.nameKey}|${String(place.dupOrdinal)}`,
                        place,
                    ]),
                );
                const counters = new Map<string, number>();
                let extra = ofMap.length;
                for (const place of entry.places) {
                    const key = place.rawName.trim().toLowerCase();
                    const slot = `${String(place.sortOrder)}|${key}`;
                    const ordinal = counters.get(slot) ?? 0;
                    counters.set(slot, ordinal + 1);
                    const row = present.get(`${slot}|${String(ordinal)}`);
                    if (place.suppressed) {
                        if (row !== undefined) {
                            conflicts.push(placeObject("citymap_place", entry.publicId, title, place.rawName));
                            continue;
                        }
                        suppressedPlaces.push({
                            mapPublicId: entry.publicId,
                            mapTitle: title,
                            sortOrder: place.sortOrder,
                            exportOrdinal: extra,
                            nameKey: key,
                            dupOrdinal: ordinal,
                            rawName: place.rawName,
                            legacy: place.legacy,
                            origin: place.origin,
                        });
                        extra += 1;
                    } else if (row !== undefined) {
                        privatePlaces.push({
                            mapPublicId: entry.publicId,
                            sortOrder: place.sortOrder,
                            nameKey: key,
                            dupOrdinal: ordinal,
                            origin: place.origin,
                        });
                    }
                }
            }
            if (entry.links !== null) {
                const ofMap = linksOf.get(entry.publicId) ?? [];
                const present = new Map(ofMap.map((link) => [link.url, link]));
                let extra = ofMap.length;
                for (const link of entry.links) {
                    const row = present.get(link.url);
                    if (link.suppressed) {
                        if (row !== undefined) {
                            conflicts.push({
                                table: "citymap_link",
                                publicId: entry.publicId,
                                name: `${title} / ${link.url}`,
                            });
                            continue;
                        }
                        if (link.label === null || !/^https?:\/\//i.test(link.url)) {
                            unusablePrivate.push({
                                table: "citymap_link",
                                publicId: entry.publicId,
                                name: `${title} / ${link.url}`,
                            });
                            continue;
                        }
                        suppressedLinks.push({
                            mapPublicId: entry.publicId,
                            mapTitle: title,
                            role: link.role,
                            url: link.url,
                            label: link.label,
                            isPaid: link.isPaid,
                            position: extra,
                            origin: link.origin,
                        });
                        extra += 1;
                    } else if (row !== undefined) {
                        privateLinks.push({ mapPublicId: entry.publicId, url: link.url, origin: link.origin });
                    }
                }
            }
        }
        if (conflicts.length > 0) {
            findings.push(
                createFinding(
                    "private_conflict",
                    `${String(conflicts.length)} Einträge, die die Datei unterdrückt nennt und die die Antwort zugleich genehmigt führt; die Antwort gewinnt, die Zeile bleibt aktiv`,
                    { eintraege: conflicts.length },
                    conflicts,
                ),
            );
        }
        if (unknownMaps.length > 0) {
            findings.push(
                createFinding(
                    "private_map_unknown",
                    `${String(unknownMaps.length)} Karten stehen in der Datei mit den privaten Feldern, aber nicht in der Antwort; ihre Felder werden nicht gespeichert`,
                    { karten: unknownMaps.length },
                    unknownMaps,
                ),
            );
        }
        if (unusablePrivate.length > 0) {
            findings.push(
                createFinding(
                    "private_entry_unusable",
                    `${String(unusablePrivate.length)} unterdrückte Links ohne Titel oder mit einer Adresse ohne http oder https; kein Tombstone`,
                    { eintraege: unusablePrivate.length },
                    unusablePrivate,
                ),
            );
        }
        if (wikiAssignmentVsDecision.length > 0) {
            findings.push(
                createFinding(
                    "wiki_assignment_vs_decision",
                    `${String(wikiAssignmentVsDecision.length)} Karten tragen eine Artikeladresse UND no_article (ein Widerspruch in Legacy); beide Aussagen bleiben: assigned mit Adresse, separated wird nicht zusätzlich geschrieben`,
                    { karten: wikiAssignmentVsDecision.length },
                    wikiAssignmentVsDecision,
                ),
            );
        }
    } else {
        findings.push(
            createFinding(
                "suppressed_not_exported",
                "Unterdrückte Karten, Orte und Links sind nicht im öffentlichen Export (E5+ noch nicht gebaut); ohne Datei mit den privaten Feldern bleibt legacy_origin unknown, es gibt keine Tombstones und keine Zuordnung des eigenen Wiki-Artikels",
                {},
            ),
        );
    }

    // ---- Befunde ------------------------------------------------------------------------------------------------------------------
    const simple = (code: string, message: string, objects: FindingObject[]): void => {
        if (objects.length > 0) findings.push(createFinding(code, message, { zeilen: objects.length }, objects));
    };
    simple(
        "map_entry_unusable",
        `${String(unusable.length)} Einträge ohne lesbare public_id oder ohne Titel, Orte ohne Namen oder Position, Links ohne Titel oder Adresse; nicht speicherbar, ausgelassen`,
        unusable,
    );
    simple(
        "map_duplicate_public_id",
        `${String(duplicateMaps.length)} Karten tragen eine public_id, die die Antwort schon einmal nennt; die erste gilt`,
        duplicateMaps,
    );
    simple(
        "citymap_parent_unknown",
        `${String(parentUnknown.length)} Karten nennen eine übergeordnete Karte, die nicht im Katalog steht (etwa eine unterdrückte); parent_id bleibt NULL`,
        parentUnknown,
    );
    simple(
        "citymap_parent_cycle",
        `${String(parentCycle.length)} Karten, deren Übergeordnet-Kette ein Zyklus ist oder auf sich selbst verweist; parent_id dieser Karten bleibt NULL`,
        parentCycle,
    );
    simple(
        "citymap_related_unknown",
        `${String(relatedUnknown.length)} Verweise auf verwandte Karten, die nicht im Katalog stehen; das Paar wird nicht angelegt`,
        relatedUnknown,
    );
    simple(
        "citymap_related_self",
        `${String(relatedSelf.length)} Karten nennen sich selbst als verwandt; kein Paar angelegt (Information)`,
        relatedSelf,
    );
    simple(
        "related_asymmetric",
        `${String(asymmetric.length)} Beziehungen „verwandt“ stehen nur an einer der beiden Karten; als Paar gespeichert`,
        asymmetric,
    );
    simple(
        "type_unknown",
        `${String(typeUnknown.length)} Typschlüssel ausserhalb der 16 festen; nicht gespeichert`,
        typeUnknown,
    );
    simple(
        "art_unknown_value",
        `${String(artUnknown.length)} Karten mit einer art ausserhalb der vier; NULL`,
        artUnknown,
    );
    for (const [code, objects] of notes) {
        findings.push(createFinding(code, NOTE_MESSAGES[code](objects.length), { orte: objects.length }, objects));
    }
    simple(
        "place_duplicate_row",
        `${String(duplicateRows.length)} Orte mit gleichem (sort_order, name_key) in derselben Karte; mit dup_ordinal gespeichert`,
        duplicateRows,
    );
    simple(
        "map_without_link",
        `${String(withoutLink.length)} Karten ohne Karten-Link (48 von 456 am 2026-08-05); sie zeigen „keine Fundstelle“`,
        withoutLink,
    );
    simple(
        "map_is_paid_without_link",
        `${String(paidWithoutLink.length)} Karten tragen is_paid, aber keinen Karten-Link; der Wert hat keinen Träger und geht verloren (is_paid gehört zum Link)`,
        paidWithoutLink,
    );
    simple(
        "link_scheme_rejected",
        `${String(schemeRejected.length)} Adressen ohne http oder https; nicht gespeichert`,
        schemeRejected,
    );
    simple(
        "link_duplicate_url",
        `${String(duplicateUrls.length)} Fundstellen mit einer Adresse, die die Karte schon trägt; eine Zeile, der Karten-Link gewinnt`,
        duplicateUrls,
    );
    simple(
        "note_semistructured",
        `${String(semistructured.length)} Karten tragen in note Abgleichstext („Format: …“, „Maßstab: …“); verbatim, nicht geparst`,
        semistructured,
    );
    simple(
        "valid_open_end_marker",
        `${String(openEnd.length)} Karten mit valid_to_bf 9999 (Legacys offenes Ende); wörtlich gespeichert, nicht zu NULL umgeschrieben (Information)`,
        openEnd,
    );
    simple(
        "external_unlocalized",
        `${String(external.length)} Bildadressen (map_local_url, thumb) ausserhalb von /uploads/kartensammlungen/; keine Bindung, kein Abruf`,
        external,
    );
    simple(
        "text_exceeds_legacy_limit",
        `${String(exceeds.length)} Texte über Legacys Spaltenbreite; unverändert gespeichert`,
        exceeds,
    );
    // Gleicher Titel, gleicher Ort, gleiche erste Quelle: die Wiki-Dubletten (nicht bereinigt, Cutoff-Regel).
    const groups = new Map<string, string[]>();
    for (const row of maps) {
        const first = displaySources.get(row.publicId)?.[0];
        const key = [
            row.title.trim().toLowerCase(),
            firstPlace.get(row.publicId) ?? "",
            first === undefined ? "" : (textOf(first["url"]) ?? textOf(first["label"]) ?? ""),
        ].join("|");
        const group = groups.get(key) ?? [];
        group.push(row.publicId);
        groups.set(key, group);
    }
    const duplicateTitles = [...groups.values()].filter((group) => group.length > 1);
    if (duplicateTitles.length > 0) {
        findings.push(
            createFinding(
                "citymap_title_duplicate",
                `${String(duplicateTitles.length)} Gruppen von Karten mit gleichem Titel, gleichem Ort und gleicher erster Quelle (Wiki-Dubletten); nicht bereinigt (Cutoff-Regel)`,
                {
                    gruppen: duplicateTitles.length,
                    karten: duplicateTitles.reduce((sum, group) => sum + group.length, 0),
                },
                duplicateTitles.flat().map((publicId) => ({
                    table: "citymap",
                    publicId,
                    name: titleOfId.get(publicId) ?? null,
                })),
            ),
        );
    }
    findings.push(...sourceFindings);

    return {
        skipped: false,
        maps,
        types,
        related,
        places,
        links,
        sources,
        sourcesPart,
        sourceTotals,
        privateMaps,
        privatePlaces,
        privateLinks,
        suppressedMaps,
        suppressedPlaces,
        suppressedLinks,
        assignments,
        totals,
        findings,
    };
}
