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
import { titelOhneAuszeichnung } from "../wiki/infobox/text.ts";
import { parseLegacyStamp, textOf, uuidOf } from "./subject-details.ts";

/**
 * Spielliteratur: die reine Umwandlung der Antwort von `game-literature.php` in Werke, Ortsbezüge, weitere Links und Herkunftsvermerke
 * (WI-0063 P3, Vertrag `project-control/migration/contracts/literature.yaml`, D3).
 *
 * Diese Datei kennt weder Datenbank noch Netz; was sie über die Ziele der Ortsbezüge wissen muss, bekommt sie als `TargetIndex`. Der
 * Prüfer rechnet dieselbe Funktion noch einmal.
 *
 * 🔴 Alles verbatim, nichts geparst; ein leerer Text ist NULL. Die Reihenfolge der Ortsliste ist Aussage und wird nie neu sortiert.
 * 🔴 `thumb`/`cover_url` werden NIE übernommen: Die Beziehung zum Cover entsteht mit dem Medienimport (MEDIA-M8), nicht hier.
 * 🔴 Nichts blockiert (AGENTS.md, „Blockierende Prüfungen im Betrieb“): Ist die Antwort unbrauchbar, leer bei aktivem Schalter oder
 * der Schalter aus, schreibt der Schritt nichts, legt nichts still und meldet `source_block_missing`, `source_empty_catalog` beziehungsweise
 * `source_switched_off`; der Lauf geht weiter. Alle anderen Codes melden nur.
 *
 * Die PRIVATEN Felder (E5 und E5+) kommen als eigene Datei und ändern nichts an den öffentlichen Feldern (`parseLiteratureOverlay`): Legacys
 * Export B (`media-export-migration.json`, Block `game_literature`, an der Datei vom 2026-10-10 bestätigt) oder das früher angenommene Format
 * (`adventures`); ohne die Datei bleiben `legacy_origin` `unknown` und `wiki_key`, `authors` und `synced_at` NULL.
 */

export const LITERATURE_CONTRACT_VERSION = "1";

export type WorkRole = "start" | "play" | "covers";
export type LegacyOrigin = "manual" | "wiki" | "unknown";
export const WORK_ROLES: readonly string[] = ["start", "play", "covers"];

/** Die Felder, für die Legacy je Werk eine Herkunft führt (`field_origins_json`); der Vertrag nennt die feste Liste. */
export const FIELD_ORIGIN_FIELDS = [
    "title",
    "product_type",
    "edition",
    "bf_year",
    "bf_label",
    "genre",
    "complexity_gm",
    "complexity_pl",
    "is_official",
    "authors",
    "series",
    "fshop_code",
    "cover_url",
    "wiki_url",
    "wiki_key",
    "link_ulisses",
    "link_fshop",
    "isbn",
    "contained_in",
] as const;

/** Legacys Obergrenzen (Spaltenbreiten): Ein längerer Text wird unverändert gespeichert und als Befund gemeldet. */
const LIMITS = {
    title: 300,
    product_type: 32,
    edition: 16,
    bf_label: 120,
    genre: 160,
    complexity_gm: 60,
    complexity_pl: 60,
    series: 200,
    fshop_code: 40,
    isbn: 20,
    contained_in: 300,
    wiki_url: 500,
    link_ulisses: 500,
    link_fshop: 500,
    authors: 500,
    raw_name: 300,
    link_label: 120,
    link_url: 500,
} as const;

/** Die sechs Bootstrap-Beispielwerke von Legacy. */
const SEED_SAMPLE = /^a0e17e10-0000-4000-8000-00000000000[1-6]$/;

/** Nur Regionalspielhilfen und Spielhilfen tragen keine geordnete Ortsliste (alle Orte `covers`); alles andere beginnt am ersten Ort. */
export function hasOrderedPlaceList(productType: string): boolean {
    const type = productType.trim().toLowerCase();
    return type !== "regionalspielhilfe" && type !== "spielhilfe";
}

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface WorkRow {
    publicId: string;
    title: string;
    wikiUrl: string | null;
    productType: string;
    edition: string | null;
    bfYear: number | null;
    bfLabel: string | null;
    genre: string | null;
    complexityGm: string | null;
    complexityPl: string | null;
    isOfficial: boolean;
    series: string | null;
    fshopCode: string | null;
    linkUlisses: string | null;
    linkFshop: string | null;
    isbn: string | null;
    containedIn: string | null;
}

export interface WorkPlaceRow {
    workPublicId: string;
    workTitle: string;
    sortOrder: number;
    exportOrdinal: number;
    nameKey: string;
    dupOrdinal: number;
    rawName: string;
    role: WorkRole;
    legacy: LegacyTarget;
    territoryPath: string[];
    resolution: Resolution;
}

export interface WorkLinkRow {
    workPublicId: string;
    workTitle: string;
    url: string;
    label: string;
    position: number;
}

/** Die privaten Felder eines Werks aus der Datei (E5): nur was die Datei nennt. */
export interface PrivateWork {
    publicId: string;
    origin: LegacyOrigin | null;
    wikiKey: string | null;
    authors: string | null;
    syncedAt: string | null;
    /** `null`: die Datei nennt keine Herkunftsvermerke dieses Werks (der gespeicherte Satz bleibt). */
    fieldOrigins: { field: string; origin: "wiki" | "manual" }[] | null;
}

export interface PrivatePlace {
    workPublicId: string;
    sortOrder: number;
    nameKey: string;
    dupOrdinal: number;
    origin: LegacyOrigin;
}

/** Ein unterdrückter Ort (Tombstone, E5+): Legacy hat ihn von Hand entfernt; er wird nie wieder belebt. */
export interface SuppressedPlace {
    workPublicId: string;
    workTitle: string;
    sortOrder: number;
    exportOrdinal: number;
    nameKey: string;
    dupOrdinal: number;
    rawName: string;
    role: WorkRole;
    legacy: LegacyTarget;
    origin: LegacyOrigin;
}

export interface LiteratureOverlayEntry {
    publicId: string;
    origin: LegacyOrigin | null;
    suppressed: boolean;
    wikiKey: string | null;
    authors: string | null;
    syncedAt: string | null;
    fieldOrigins: { field: string; origin: "wiki" | "manual" }[] | null;
    places: OverlayPlace[] | null;
}

export interface OverlayPlace {
    sortOrder: number;
    rawName: string;
    origin: LegacyOrigin;
    suppressed: boolean;
    role: WorkRole | null;
    legacy: LegacyTarget;
}

/** Die Form der Datei mit den privaten Feldern. */
export type OverlayFormat = "export_b" | "angenommen";

export interface LiteratureOverlay {
    entries: ReadonlyMap<string, LiteratureOverlayEntry>;
    findings: Finding[];
    /** Die Form der Datei; `null`, wenn keine lesbare Liste der Werke darin stand. */
    format: OverlayFormat | null;
}

const ORIGINS: readonly string[] = ["manual", "wiki"];
const STATUSES: readonly string[] = ["approved", "suppressed"];

function isOneOf(value: unknown, list: readonly string[]): boolean {
    return typeof value === "string" && list.includes(value.trim());
}

function originOf(value: unknown): LegacyOrigin | null {
    return typeof value === "string" && ORIGINS.includes(value.trim()) ? (value.trim() as LegacyOrigin) : null;
}

function roleOf(value: unknown): WorkRole | null {
    return typeof value === "string" && WORK_ROLES.includes(value.trim()) ? (value.trim() as WorkRole) : null;
}

function legacyTargetOf(item: Bag): LegacyTarget {
    return {
        kind: textOf(item["target_kind"]),
        publicId: textOf(item["target_public_id"]),
        wikiKey: textOf(item["target_wiki_key"]),
    };
}

/**
 * Die Liste der Werke und die Form, in der die Datei sie führt: Legacys Export B (`game_literature`, siehe unten) oder die angenommene
 * Liste `adventures`. Trägt eine Datei beide, gilt `adventures` (so las der Parser bisher). Ein Export B mit `ok: false` ist die Fehlerantwort
 * des Endpunkts und keine Quelle.
 */
function overlayList(raw: unknown): { list: unknown[]; format: OverlayFormat } | null {
    if (!isBag(raw)) return null;
    const assumed = raw["adventures"];
    if (Array.isArray(assumed)) return { list: assumed, format: "angenommen" };
    const exportB = raw["game_literature"];
    if (Array.isArray(exportB) && raw["ok"] !== false) return { list: exportB, format: "export_b" };
    return null;
}

/**
 * Liest die Datei mit den privaten Feldern (E5/E5+) in einer von zwei Formen.
 *
 * 🔴 **Export B** (`media-export-migration.json`, Legacys `GET /api/edit/migration/media-export.php`, Admin-Sitzung; gelesen an der Datei vom
 * 2026-10-10 und an `avesmapsMedienExportWerke` im Mirror `a7f2dac86`): `{ ok, map_revision, media_revision, switches, counts, items, game_literature:
 * [ { public_id, wiki_key, title, status, origin, authors, field_origins: { <Feld>: wiki|manual }, synced_at, wiki_url, … cover_*, places: [ {
 * sort_order, raw_name, target_kind, target_public_id, target_wiki_key, territory_path, role, origin, status, created_from_source_id } ], links:
 * [ … ] } ], citymaps }`. Die Feldnamen von `field_origins` sind Legacys Spaltennamen und gleich `FIELD_ORIGIN_FIELDS`; es gibt keine Abbildung. Export B wird
 * STRENG gelesen: Was Legacys Wortschatz verlässt (ein Feld, das wir nicht führen, ein Zustand oder eine Herkunft ausserhalb von approved/suppressed
 * und wiki/manual, ein Stempel, der kein Datum ist), eine doppelte `public_id` und ein Ort ohne Namen oder ohne ganzzahlige Position werden gezählt
 * und gemeldet, nie geraten und nie auf ein anderes Feld abgebildet. `items` und `citymaps` gehören dem Medienimport und werden hier nicht gelesen.
 * `suppressed` heisst bei Legacy `status = 'suppressed'` an Werk oder Ort (in der Datei vom 2026-10-10 gibt es keinen).
 *
 * Die **angenommene Form** (`{ adventures: [ { public_id, origin, status, wiki_key, authors, synced_at, field_origins, places: [ { sort_order, raw_name,
 * origin, status, role, target_* } ] } ] }`) liest der Parser unverändert wie vorher, ohne die strengen Befunde. Beide Formen teilen die Regeln der
 * Einträge; nur der Umschlag und die Strenge unterscheiden sich. Was nicht lesbar ist, wird gemeldet und ausgelassen.
 */
export function parseLiteratureOverlay(raw: unknown): LiteratureOverlay {
    const findings: Finding[] = [];
    const entries = new Map<string, LiteratureOverlayEntry>();
    const source = overlayList(raw);
    if (source === null) {
        findings.push(
            createFinding(
                "private_file_unusable",
                "Die Datei mit den privaten Feldern trägt weder die Liste `game_literature` (Legacys Export B) noch die Liste `adventures` des angenommenen Formats; sie wird nicht verwendet",
                {},
            ),
        );
        return { entries, findings, format: null };
    }
    const strict = source.format === "export_b";
    const unusable: FindingObject[] = [];
    const unknownOrigin: FindingObject[] = [];
    // Nur Export B (streng):
    const duplicates: FindingObject[] = [];
    const unusablePlaces: FindingObject[] = [];
    const unknownFields = new Map<string, number>();
    const unknownValues = { werk_status: 0, werk_herkunft: 0, ort_status: 0, ort_herkunft: 0, stempel: 0 };
    const unknownValueObjects: FindingObject[] = [];
    for (const item of source.list) {
        if (!isBag(item)) continue;
        const publicId = uuidOf(item["public_id"]);
        if (publicId === null) {
            unusable.push({ table: "adventure", publicId: String(item["public_id"] ?? ""), name: null });
            continue;
        }
        const ref: FindingObject = { table: "adventure", publicId, name: null };
        if (strict && entries.has(publicId)) {
            duplicates.push(ref);
            continue;
        }
        const unknownValue = (kind: keyof typeof unknownValues): void => {
            unknownValues[kind] += 1;
            unknownValueObjects.push(ref);
        };
        if (strict) {
            if (!isOneOf(item["status"], STATUSES)) unknownValue("werk_status");
            if (!isOneOf(item["origin"], ORIGINS)) unknownValue("werk_herkunft");
            const stamp = item["synced_at"];
            if (stamp !== null && stamp !== undefined && stamp !== "" && parseLegacyStamp(stamp) === null) {
                unknownValue("stempel");
            }
        }
        const fieldOrigins: { field: string; origin: "wiki" | "manual" }[] = [];
        let hasFieldOrigins = false;
        if (isBag(item["field_origins"])) {
            hasFieldOrigins = true;
            for (const [field, origin] of Object.entries(item["field_origins"])) {
                if (!(FIELD_ORIGIN_FIELDS as readonly string[]).includes(field)) {
                    if (strict) unknownFields.set(field, (unknownFields.get(field) ?? 0) + 1);
                    continue;
                }
                if (origin === "wiki" || origin === "manual") fieldOrigins.push({ field, origin });
                else unknownOrigin.push(ref);
            }
        }
        const places: OverlayPlace[] = [];
        if (Array.isArray(item["places"])) {
            for (const place of item["places"]) {
                if (!isBag(place)) continue;
                const rawName = textOf(place["raw_name"]);
                const sortOrder = strict
                    ? typeof place["sort_order"] === "number"
                        ? place["sort_order"]
                        : Number.NaN
                    : Number(place["sort_order"]);
                if (rawName === null || !Number.isInteger(sortOrder)) {
                    if (strict) unusablePlaces.push(ref);
                    continue;
                }
                if (strict) {
                    if (!isOneOf(place["status"], STATUSES)) unknownValue("ort_status");
                    if (!isOneOf(place["origin"], ORIGINS)) unknownValue("ort_herkunft");
                }
                places.push({
                    sortOrder,
                    rawName,
                    origin: originOf(place["origin"]) ?? "unknown",
                    suppressed: place["status"] === "suppressed",
                    role: roleOf(place["role"]),
                    legacy: legacyTargetOf(place),
                });
            }
        }
        entries.set(publicId, {
            publicId,
            origin: originOf(item["origin"]),
            suppressed: item["status"] === "suppressed",
            wikiKey: textOf(item["wiki_key"]),
            authors: textOf(item["authors"]),
            syncedAt: parseLegacyStamp(item["synced_at"]),
            fieldOrigins: hasFieldOrigins ? fieldOrigins : null,
            places: Array.isArray(item["places"]) ? places : null,
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
    if (unknownOrigin.length > 0) {
        findings.push(
            createFinding(
                "field_origin_unknown",
                `${String(unknownOrigin.length)} Herkunftswerte ausserhalb von wiki und manual; nicht gespeichert (ein fehlender Eintrag heisst nie wiki)`,
                { werte: unknownOrigin.length },
                unknownOrigin,
            ),
        );
    }
    if (duplicates.length > 0) {
        findings.push(
            createFinding(
                "private_entry_duplicate",
                `${String(duplicates.length)} Werke der Datei tragen eine public_id, die sie schon einmal nennt; das erste gilt`,
                { eintraege: duplicates.length },
                duplicates,
            ),
        );
    }
    if (unusablePlaces.length > 0) {
        findings.push(
            createFinding(
                "private_place_unusable",
                `${String(unusablePlaces.length)} Orte der Datei ohne lesbaren Namen oder ohne ganzzahlige Position; ausgelassen`,
                { orte: unusablePlaces.length },
                unusablePlaces,
            ),
        );
    }
    if (unknownFields.size > 0) {
        const total = [...unknownFields.values()].reduce((sum, count) => sum + count, 0);
        findings.push(
            createFinding(
                "private_field_unknown",
                `${String(total)} Herkunftsvermerke zu ${String(unknownFields.size)} Feldern, die ein Werk bei uns nicht führt; nicht gespeichert, nie auf ein anderes Feld abgebildet`,
                { werte: total, felder: unknownFields.size },
                [],
                total,
                [...unknownFields.entries()].sort().map(([field, count]) => `${field}: ${String(count)}`),
            ),
        );
    }
    if (unknownValueObjects.length > 0) {
        const counted = Object.entries(unknownValues).filter(([, count]) => count > 0);
        findings.push(
            createFinding(
                "private_value_unknown",
                `${String(unknownValueObjects.length)} Werte der Datei ausserhalb von Legacys Wortschatz (${counted.map(([name, count]) => `${name} ${String(count)}`).join(", ")}); nichts wird geraten, der Eintrag gilt wie ohne den Wert`,
                unknownValues,
                unknownValueObjects,
            ),
        );
    }
    return { entries, findings, format: source.format };
}

export interface LiteratureTransform {
    /** `true`: die Antwort ist unbrauchbar, leer bei aktivem Schalter oder der Schalter ist aus; der Aufrufer schreibt nichts. */
    skipped: boolean;
    works: WorkRow[];
    places: WorkPlaceRow[];
    links: WorkLinkRow[];
    /** Die privaten Felder der Werke, die die Datei nennt UND die die Antwort trägt. */
    privateWorks: PrivateWork[];
    privatePlaces: PrivatePlace[];
    /** Öffentliche IDs der Werke, die die Datei unterdrückt nennt (nur Vorhandene werden umgewandelt). */
    suppressedWorks: string[];
    suppressedPlaces: SuppressedPlace[];
    totals: ResolutionTotals;
    findings: Finding[];
}

function skip(findings: Finding[]): LiteratureTransform {
    return {
        skipped: true,
        works: [],
        places: [],
        links: [],
        privateWorks: [],
        privatePlaces: [],
        suppressedWorks: [],
        suppressedPlaces: [],
        totals: emptyTotals(),
        findings,
    };
}

/** Liegt die Adresse im Bild-Verzeichnis dieser Domäne? (`/uploads/questcovers/`, auch als absolute Adresse von avesmaps.de.) */
export function isLocalUpload(address: string, directory: string): boolean {
    try {
        const url = new URL(address, "https://avesmaps.de");
        return (
            (url.hostname === "avesmaps.de" || url.hostname === "www.avesmaps.de") && url.pathname.startsWith(directory)
        );
    } catch {
        return false;
    }
}

const NOTE_MESSAGES: Record<ResolutionNote, (n: number) => string> = {
    place_unresolved: (n) => `${String(n)} Orte ohne Ziel in Legacy selbst (unresolved); der Rohname bleibt stehen`,
    place_unmatched: (n) =>
        `${String(n)} Orte, deren Ziel Legacy nennt, Avesmaps3D aber nicht findet oder nur inaktiv (unmatched); Kennung und Schlüssel bleiben als Text, die Auflösung wird bei jedem Lauf neu gerechnet`,
    place_target_ambiguous: (n) =>
        `${String(n)} Orte, deren Wiki-Schlüssel mehrere aktive Ziele trifft; nie still gewählt (unmatched)`,
    place_target_key_disagrees: (n) =>
        `${String(n)} Orte, bei denen Kennung und Wiki-Schlüssel auf verschiedene Ziele zeigen; die Kennung gewinnt`,
    place_kind_unknown: (n) =>
        `${String(n)} Orte mit einer Legacy-Art ausserhalb von settlement, territory, region, path (etwa lore, powerline, ecosystem); unmatched`,
    path_anchor_derived: (n) =>
        `${String(n)} Weg-Ziele wurden über den Schlüssel aufgelöst; der Anker ist das Segment der Wegegruppe mit der kleinsten public_id`,
};

/**
 * Wandelt die Antwort um. `overlay` sind die privaten Felder (E5/E5+) oder `null`. Der Aufrufer prüft nichts weiter: Eine unbrauchbare
 * Antwort ist `skipped` mit Befund.
 */
export function transformLiterature(
    payload: unknown,
    index: TargetIndex,
    overlay: LiteratureOverlay | null = null,
): LiteratureTransform {
    const bag = isBag(payload) ? payload : null;
    if (bag === null || bag["ok"] !== true || !Array.isArray(bag["adventures"])) {
        return skip([
            createFinding(
                "source_block_missing",
                "Die Antwort von game-literature.php ist unbrauchbar (ok nicht true oder adventures keine Liste); der Schritt schreibt nichts und legt nichts still, der Lauf geht weiter",
                {
                    grund:
                        bag === null ? "kein Objekt" : bag["ok"] !== true ? "ok nicht true" : "adventures keine Liste",
                },
            ),
        ]);
    }
    if (bag["adventures_enabled"] === false) {
        return skip([
            createFinding(
                "source_switched_off",
                "Der Katalog ist in Legacy abgeschaltet (adventures_enabled false): kein Stand, nichts wird stillgelegt; ein leerer Katalog ist hier nicht „alles entfernt“",
                {},
            ),
        ]);
    }
    const list = bag["adventures"];
    if (list.length === 0) {
        return skip([
            createFinding(
                "source_empty_catalog",
                "Der Katalog ist leer, obwohl adventures_enabled nicht false meldet; der Schritt schreibt nichts und legt nichts still",
                {},
            ),
        ]);
    }

    const findings: Finding[] = [];
    const works: WorkRow[] = [];
    const places: WorkPlaceRow[] = [];
    const links: WorkLinkRow[] = [];
    const totals = emptyTotals();
    const seenWorks = new Set<string>();

    const unusable: FindingObject[] = [];
    const duplicateWorks: FindingObject[] = [];
    const seedSamples: FindingObject[] = [];
    const withoutPlaces: FindingObject[] = [];
    const withoutStart: FindingObject[] = [];
    const roleUnknown: FindingObject[] = [];
    const duplicateRows: FindingObject[] = [];
    const sortTies: FindingObject[] = [];
    const schemeRejected: FindingObject[] = [];
    const duplicateUrls: FindingObject[] = [];
    const derivedMismatch: FindingObject[] = [];
    const exceeds: FindingObject[] = [];
    const externalCover: FindingObject[] = [];
    const notes = new Map<ResolutionNote, FindingObject[]>();
    let withCover = 0;
    let withBfYear = 0;
    let withIsbn = 0;
    let officialCount = 0;
    let unusableLinks = 0;

    const note = (code: ResolutionNote, object: FindingObject): void => {
        const bucket = notes.get(code) ?? [];
        bucket.push(object);
        notes.set(code, bucket);
    };
    const overLimit = (value: string | null, limit: number, ref: FindingObject, field: string): void => {
        if (value !== null && [...value].length > limit) exceeds.push({ ...ref, name: `${ref.name ?? ""} (${field})` });
    };
    const httpOf = (value: unknown, ref: FindingObject, field: string): string | null => {
        const text = textOf(value);
        if (text === null) return null;
        if (!/^https?:\/\//i.test(text)) {
            schemeRejected.push({ ...ref, name: `${ref.name ?? ""} (${field})` });
            return null;
        }
        return text;
    };

    for (const item of list) {
        if (!isBag(item)) {
            unusable.push({ table: "adventure", publicId: "", name: null });
            continue;
        }
        const publicId = uuidOf(item["public_id"]);
        const cleanTitle = typeof item["title"] === "string" ? titelOhneAuszeichnung(item["title"]) : "";
        const title = cleanTitle.trim() !== "" ? cleanTitle : null;
        const productType =
            typeof item["product_type"] === "string" && item["product_type"].trim() !== ""
                ? item["product_type"]
                : null;
        if (publicId === null || title === null || productType === null) {
            unusable.push({
                table: "adventure",
                publicId: publicId ?? String(item["public_id"] ?? ""),
                name: title,
            });
            continue;
        }
        const ref: FindingObject = { table: "adventure", publicId, name: title };
        if (seenWorks.has(publicId)) {
            duplicateWorks.push(ref);
            continue;
        }
        seenWorks.add(publicId);
        if (SEED_SAMPLE.test(publicId)) seedSamples.push(ref);

        const bfYearRaw = item["bf_year"];
        const bfYear =
            typeof bfYearRaw === "number" && Number.isInteger(bfYearRaw)
                ? bfYearRaw
                : typeof bfYearRaw === "string" && /^-?\d+$/.test(bfYearRaw.trim())
                  ? Number(bfYearRaw)
                  : null;
        const work: WorkRow = {
            publicId,
            title,
            wikiUrl: httpOf(item["wiki_url"], ref, "wiki_url"),
            productType,
            edition: textOf(item["edition"]),
            bfYear,
            bfLabel: textOf(item["bf_label"]),
            genre: textOf(item["genre"]),
            complexityGm: textOf(item["complexity_gm"]),
            complexityPl: textOf(item["complexity_pl"]),
            // Legacy: NOT NULL, Vorgabe 1.
            isOfficial: typeof item["is_official"] === "boolean" ? item["is_official"] : item["is_official"] !== 0,
            series: textOf(item["series"]),
            fshopCode: textOf(item["fshop_code"]),
            linkUlisses: httpOf(item["link_ulisses"], ref, "link_ulisses"),
            linkFshop: httpOf(item["link_fshop"], ref, "link_fshop"),
            isbn: textOf(item["isbn"]),
            containedIn: textOf(item["contained_in"]),
        };
        works.push(work);
        if (work.bfYear !== null) withBfYear += 1;
        if (work.isbn !== null) withIsbn += 1;
        if (work.isOfficial) officialCount += 1;
        overLimit(work.title, LIMITS.title, ref, "title");
        overLimit(work.productType, LIMITS.product_type, ref, "product_type");
        overLimit(work.edition, LIMITS.edition, ref, "edition");
        overLimit(work.bfLabel, LIMITS.bf_label, ref, "bf_label");
        overLimit(work.genre, LIMITS.genre, ref, "genre");
        overLimit(work.complexityGm, LIMITS.complexity_gm, ref, "complexity_gm");
        overLimit(work.complexityPl, LIMITS.complexity_pl, ref, "complexity_pl");
        overLimit(work.series, LIMITS.series, ref, "series");
        overLimit(work.fshopCode, LIMITS.fshop_code, ref, "fshop_code");
        overLimit(work.isbn, LIMITS.isbn, ref, "isbn");
        overLimit(work.containedIn, LIMITS.contained_in, ref, "contained_in");
        overLimit(work.wikiUrl, LIMITS.wiki_url, ref, "wiki_url");
        overLimit(work.linkUlisses, LIMITS.link_ulisses, ref, "link_ulisses");
        overLimit(work.linkFshop, LIMITS.link_fshop, ref, "link_fshop");

        // ---- Cover: nur die Beziehung, nie ein Bild. Eine Adresse ausserhalb des Upload-Verzeichnisses ist keine Bindung. -------
        const cover = textOf(item["cover_url"]);
        if (cover !== null) {
            withCover += 1;
            if (!isLocalUpload(cover, "/uploads/questcovers/")) externalCover.push(ref);
        }

        // ---- Orte ----------------------------------------------------------------------------------------------------------------
        const rawPlaces: RawPlace[] = [];
        const roleByOrdinal: WorkRole[] = [];
        const placeList = Array.isArray(item["places"]) ? item["places"] : [];
        for (const place of placeList) {
            if (!isBag(place)) continue;
            const rawName =
                typeof place["raw_name"] === "string" && place["raw_name"].trim() !== "" ? place["raw_name"] : null;
            const sortOrder = Number(place["sort_order"]);
            if (rawName === null || !Number.isInteger(sortOrder)) {
                unusable.push({ table: "adventure_place", publicId, name: `${title} / ${rawName ?? "(ohne Namen)"}` });
                continue;
            }
            const role = roleOf(place["role"]);
            if (role === null) roleUnknown.push(placeObject("adventure_place", publicId, title, rawName));
            roleByOrdinal.push(role ?? "play");
            const territoryPath = Array.isArray(place["territory_path"])
                ? place["territory_path"].map((entry) => String(entry))
                : [];
            rawPlaces.push({ sortOrder, rawName, legacy: legacyTargetOf(place), territoryPath });
            if ([...rawName].length > LIMITS.raw_name) {
                exceeds.push(placeObject("adventure_place", publicId, title, rawName));
            }
        }
        const numbered = numberPlaces(rawPlaces);
        if (numbered.ties) sortTies.push(ref);
        const orderedList = hasOrderedPlaceList(productType);
        const workPlaces: WorkPlaceRow[] = numbered.rows.map((row, ordinal) => {
            const resolution = resolveTarget(row.legacy, index);
            countResolution(totals, row.legacy.kind, resolution);
            const object = placeObject("adventure_place", publicId, title, row.rawName);
            for (const code of resolution.notes) note(code, object);
            if (row.dupOrdinal > 0) duplicateRows.push(object);
            return {
                workPublicId: publicId,
                workTitle: title,
                sortOrder: row.sortOrder,
                exportOrdinal: row.exportOrdinal,
                nameKey: row.nameKey,
                dupOrdinal: row.dupOrdinal,
                rawName: row.rawName,
                role: roleByOrdinal[ordinal] ?? "play",
                legacy: row.legacy,
                territoryPath: row.territoryPath,
                resolution,
            };
        });
        places.push(...workPlaces);
        if (workPlaces.length === 0) {
            withoutPlaces.push(ref);
        } else if (orderedList) {
            // Der Startort ist der kleinste sort_order; die Rolle wird nicht umgeschrieben (Befund, nie Korrektur).
            const smallest = Math.min(...workPlaces.map((place) => place.sortOrder));
            if (!workPlaces.some((place) => place.sortOrder === smallest && place.role === "start"))
                withoutStart.push(ref);
        }

        // ---- Links: nur die kuratierten (extra:<n>), die berechneten sind Gegenprobe ---------------------------------------------
        const linkList = Array.isArray(item["links"]) ? item["links"] : [];
        const seenUrls = new Set<string>();
        let position = 0;
        const derived = new Map<string, string>();
        for (const link of linkList) {
            if (!isBag(link) || typeof link["key"] !== "string") continue;
            const key = link["key"];
            const url = textOf(link["url"]) ?? "";
            if (key === "ulisses" || key === "fshop" || key === "wiki") {
                derived.set(key, url);
                continue;
            }
            if (!key.startsWith("extra:")) continue;
            const label = typeof link["label"] === "string" && link["label"].trim() !== "" ? link["label"] : null;
            if (url === "" || label === null) {
                unusableLinks += 1;
                continue;
            }
            if (!/^https?:\/\//i.test(url)) {
                schemeRejected.push({ ...ref, name: `${title} (${key})` });
                continue;
            }
            if (seenUrls.has(url)) {
                duplicateUrls.push(ref);
                continue;
            }
            seenUrls.add(url);
            if ([...label].length > LIMITS.link_label || [...url].length > LIMITS.link_url) {
                exceeds.push({ ...ref, name: `${title} (${key})` });
            }
            links.push({ workPublicId: publicId, workTitle: title, url, label, position });
            position += 1;
        }
        // Gegenprobe der berechneten Links gegen die Stammfelder (Information).
        const rawUlisses = textOf(item["link_ulisses"]) ?? "";
        const rawFshop = textOf(item["link_fshop"]) ?? "";
        const rawWiki = textOf(item["wiki_url"]) ?? "";
        const wikiActual = derived.get("wiki") ?? "";
        const wikiOk =
            rawWiki !== ""
                ? wikiActual === rawWiki
                : wikiActual === "" || wikiActual.startsWith("https://de.wiki-aventurica.de/wiki/");
        if ((derived.get("ulisses") ?? "") !== rawUlisses || (derived.get("fshop") ?? "") !== rawFshop || !wikiOk) {
            derivedMismatch.push(ref);
        }
    }

    // ---- Die privaten Felder (E5 und E5+) -------------------------------------------------------------------------------------
    const privateWorks: PrivateWork[] = [];
    const privatePlaces: PrivatePlace[] = [];
    const suppressedWorks: string[] = [];
    const suppressedPlaces: SuppressedPlace[] = [];
    if (overlay !== null) {
        findings.push(...overlay.findings);
        const titleOf = new Map(works.map((work) => [work.publicId, work.title]));
        const placesOf = new Map<string, WorkPlaceRow[]>();
        for (const place of places) {
            const list = placesOf.get(place.workPublicId) ?? [];
            list.push(place);
            placesOf.set(place.workPublicId, list);
        }
        const conflicts: FindingObject[] = [];
        const unknownWorks: FindingObject[] = [];
        const claimedKeys = new Map<string, string>();
        const keyConflicts: FindingObject[] = [];
        for (const entry of overlay.entries.values()) {
            const title = titleOf.get(entry.publicId);
            if (entry.suppressed) {
                // Die öffentliche Antwort nennt nie ein unterdrücktes Werk; nennt sie es doch, gewinnt die Antwort.
                if (title !== undefined) conflicts.push({ table: "adventure", publicId: entry.publicId, name: title });
                else suppressedWorks.push(entry.publicId);
                continue;
            }
            if (title === undefined) {
                unknownWorks.push({ table: "adventure", publicId: entry.publicId, name: null });
                continue;
            }
            let wikiKey = entry.wikiKey;
            if (wikiKey !== null) {
                const owner = claimedKeys.get(wikiKey);
                if (owner !== undefined && owner !== entry.publicId) {
                    keyConflicts.push({ table: "adventure", publicId: entry.publicId, name: title });
                    wikiKey = null;
                } else {
                    claimedKeys.set(wikiKey, entry.publicId);
                }
            }
            privateWorks.push({
                publicId: entry.publicId,
                origin: entry.origin,
                wikiKey,
                authors: entry.authors,
                syncedAt: entry.syncedAt,
                fieldOrigins: entry.fieldOrigins,
            });
            // Orte: Herkunft je Ort und unterdrückte Zeilen (Tombstones).
            if (entry.places !== null) {
                const present = new Map<string, WorkPlaceRow>();
                const ofWork = placesOf.get(entry.publicId) ?? [];
                for (const place of ofWork) {
                    present.set(`${String(place.sortOrder)}|${place.nameKey}|${String(place.dupOrdinal)}`, place);
                }
                const counters = new Map<string, number>();
                let extra = ofWork.length;
                for (const place of entry.places) {
                    const key = place.rawName.trim().toLowerCase();
                    const slot = `${String(place.sortOrder)}|${key}`;
                    const ordinal = counters.get(slot) ?? 0;
                    counters.set(slot, ordinal + 1);
                    const row = present.get(`${slot}|${String(ordinal)}`);
                    if (place.suppressed) {
                        if (row !== undefined) {
                            conflicts.push(placeObject("adventure_place", entry.publicId, title, place.rawName));
                            continue;
                        }
                        suppressedPlaces.push({
                            workPublicId: entry.publicId,
                            workTitle: title,
                            sortOrder: place.sortOrder,
                            exportOrdinal: extra,
                            nameKey: key,
                            dupOrdinal: ordinal,
                            rawName: place.rawName,
                            role: place.role ?? "play",
                            legacy: place.legacy,
                            origin: place.origin,
                        });
                        extra += 1;
                    } else if (row !== undefined) {
                        privatePlaces.push({
                            workPublicId: entry.publicId,
                            sortOrder: place.sortOrder,
                            nameKey: key,
                            dupOrdinal: ordinal,
                            origin: place.origin,
                        });
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
        if (unknownWorks.length > 0) {
            findings.push(
                createFinding(
                    "private_work_unknown",
                    `${String(unknownWorks.length)} Werke stehen in der Datei mit den privaten Feldern, aber nicht in der Antwort; ihre Felder werden nicht gespeichert`,
                    { werke: unknownWorks.length },
                    unknownWorks,
                ),
            );
        }
        if (keyConflicts.length > 0) {
            findings.push(
                createFinding(
                    "wiki_key_conflict",
                    `${String(keyConflicts.length)} Werke teilen einen wiki_key mit einem anderen Werk der Datei; der Schluessel wird nicht gespeichert (er ist eindeutig)`,
                    { werke: keyConflicts.length },
                    keyConflicts,
                ),
            );
        }
    } else {
        findings.push(
            createFinding(
                "suppressed_not_exported",
                "Unterdrückte Werke, Orte und Links sind nicht im öffentlichen Export (E5+ noch nicht gebaut); ohne Datei mit den privaten Feldern bleibt legacy_origin unknown und es gibt keine Tombstones",
                {},
            ),
        );
    }

    // ---- Befunde ------------------------------------------------------------------------------------------------------------------
    const simple = (code: string, message: string, objects: FindingObject[]): void => {
        if (objects.length > 0) findings.push(createFinding(code, message, { zeilen: objects.length }, objects));
    };
    simple(
        "work_entry_unusable",
        `${String(unusable.length)} Einträge ohne lesbare public_id, ohne Titel, ohne Werkart oder Orte ohne Namen oder Position; nicht speicherbar, ausgelassen`,
        unusable,
    );
    simple(
        "work_duplicate_public_id",
        `${String(duplicateWorks.length)} Werke tragen eine public_id, die die Antwort schon einmal nennt; das erste gilt`,
        duplicateWorks,
    );
    simple(
        "work_seed_sample",
        `${String(seedSamples.length)} Werke mit einer der sechs festen Bootstrap-UUIDs von Legacy; Werke wie alle, nichts wird entfernt`,
        seedSamples,
    );
    simple(
        "work_without_places",
        `${String(withoutPlaces.length)} Werke ohne Ort (184 von 1.352 am 2026-08-02); sie erscheinen in keinem Panel`,
        withoutPlaces,
    );
    simple(
        "work_without_start",
        `${String(withoutStart.length)} Werke mit geordneter Ortsliste, deren kleinster sort_order nicht die Rolle start trägt (höchstens 2 am 2026-08-02); die Rolle wird nicht umgeschrieben`,
        withoutStart,
    );
    for (const [code, objects] of notes) {
        findings.push(createFinding(code, NOTE_MESSAGES[code](objects.length), { orte: objects.length }, objects));
    }
    simple(
        "place_duplicate_row",
        `${String(duplicateRows.length)} Orte mit gleichem (sort_order, name_key) im selben Werk; mit dup_ordinal gespeichert`,
        duplicateRows,
    );
    simple(
        "place_sort_order_tie",
        `${String(sortTies.length)} Werke mit mehreren Orten gleichen sort_order (der Startort ist dann nicht eindeutig)`,
        sortTies,
    );
    simple(
        "role_unknown",
        `${String(roleUnknown.length)} Orte mit einem Rollenwert ausserhalb von start, play, covers; gespeichert als play (lieber verschleiern als verraten)`,
        roleUnknown,
    );
    simple(
        "link_scheme_rejected",
        `${String(schemeRejected.length)} Adressen ohne http oder https (wiki_url, link_ulisses, link_fshop, Links); nicht gespeichert`,
        schemeRejected,
    );
    simple(
        "link_duplicate_url",
        `${String(duplicateUrls.length)} Links mit einer Adresse, die das Werk schon trägt; eine Zeile`,
        duplicateUrls,
    );
    simple(
        "link_derived_mismatch",
        `${String(derivedMismatch.length)} Werke, deren berechnete Links (ulisses, fshop, wiki) nicht zu den Stammfeldern passen (Information)`,
        derivedMismatch,
    );
    if (unusableLinks > 0) {
        findings.push(
            createFinding(
                "link_unusable",
                `${String(unusableLinks)} kuratierte Links ohne Titel oder Adresse; nicht speicherbar, ausgelassen`,
                { links: unusableLinks },
            ),
        );
    }
    simple(
        "external_unlocalized",
        `${String(externalCover.length)} Cover-Adressen ausserhalb von /uploads/questcovers/; keine Bindung, kein Abruf`,
        externalCover,
    );
    simple(
        "text_exceeds_legacy_limit",
        `${String(exceeds.length)} Texte über Legacys Spaltenbreite; unverändert gespeichert`,
        exceeds,
    );
    if (officialCount > 0) {
        findings.push(
            createFinding(
                "is_official_default",
                `${String(officialCount)} von ${String(works.length)} Werken tragen is_official true; bei Wiki-Werken ist das Legacys Vorgabe, keine Auskunft aus dem Namensraum (Information)`,
                { offiziell: officialCount, werke: works.length },
            ),
        );
    }
    findings.push(
        createFinding(
            "bf_year_sparse",
            `bf_year ist bei ${String(withBfYear)} und isbn bei ${String(withIsbn)} von ${String(works.length)} Werken gefüllt (Legacy: die Wiki-Infobox führt kein BF-Jahr; Information)`,
            { bf_year: withBfYear, isbn: withIsbn, werke: works.length },
        ),
    );
    if (withCover > 0 && (overlay === null || overlay.entries.size === 0)) {
        findings.push(
            createFinding(
                "cover_origin_unknown",
                `${String(withCover)} Werke tragen ein Cover; seine Herkunft (Wiki lokalisiert oder eigener Upload) ist ohne die privaten Felder nicht bekannt, die Bindung wäre legacy (Information; der Medienimport schreibt sie)`,
                { cover: withCover },
            ),
        );
    }

    return {
        skipped: false,
        works,
        places,
        links,
        privateWorks,
        privatePlaces,
        suppressedWorks,
        suppressedPlaces,
        totals,
        findings,
    };
}
