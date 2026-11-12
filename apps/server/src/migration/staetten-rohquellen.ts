import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { cleanPlaceType } from "./staetten.ts";

/**
 * Die Stätten über Kennungen (WI-0134, Betreiberentscheid F1 = B, Vertrag `staetten.yaml` Version 2): reine Umformung von Legacys
 * Rohquellen-Export X4 (`staetten-rohquellen-export.php`). Kein Datenbankzugriff, kein Abruf.
 *
 * 🔴 **Objekt, Beziehung und Evidenz getrennt** (WI-0134 §3):
 *  - eine STÄTTE je Zeile einer Quelle, mit Legacys eigener Kennung (P1 und P2 `public_id`, P3b Wege-Key, P3c Organisation und
 *    Ortsangabe, P3d Titel). Zwei Sitze einer Organisation sind zwei Stätten, auch mit gemeinsamem Artikel (Regel 5);
 *  - eine BEZIEHUNG zu einer Stadt nur aus Legacys gespeicherter Kennung (P1 `innerorts_ort`, P2 `ort_public_id`) samt Herkunft. Eine
 *    Herkunft ohne Kennung ist die Entscheidung „keine Stadt“ und reist als Beziehung ohne Ort mit (Regel 2);
 *  - EVIDENZ: die Linkziele einer Kette (`lage_links`, `ort_links`, `standort_links`) samt Key. Ein genannter Ort ist nie „innerorts“,
 *    und ein mehrdeutiger oder schlüsselloser bindet nichts (Regeln 3 und 4).
 * Nie wird ein Key gerechnet, ein Name verglichen oder eine Adresse zur Identität gemacht. Eine Stadtteilweiterleitung trägt nie einen
 * eigenen Key (Regel 6), auch wenn eine Antwort ihn trüge.
 *
 * 🔴 **Eine ausgefallene Quelle legt nichts still** (Befund, kein Tor): Meldet der Kopf eine Quelle mit `ok` nicht wahr, fehlt ihre Liste
 * oder passt ihre Zahl nicht, werden ihre Zeilen weder geschrieben noch stillgelegt (`failedKinds`).
 */

export const STAETTEN_V2_CONTRACT_VERSION = "2";

/** Die Arten einer Stätte, in der Reihenfolge der Quellen (P1, P2, P3b, P3c, P3d). */
export const SITE_KINDS = ["punkt", "gespeichert", "weg", "sitz", "stadtteil"] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

/** Die Liste der Antwort je Art. */
export const SITE_SOURCES: Readonly<Record<SiteKind, string>> = {
    punkt: "punkte",
    gespeichert: "gespeicherte",
    weg: "wege",
    sitz: "sitze",
    stadtteil: "stadtteile",
};

/** Die Herkunft einer Beziehung aus Legacy (`editor` setzt nur ein Mensch in Avesmaps3D). */
export type SiteRelationOrigin = "manual" | "wiki" | "gespeichert";

export interface SiteRow {
    sourceKind: SiteKind;
    sourceKey: string;
    name: string;
    siteClass: string | null;
    siteType: string | null;
    seatRole: string | null;
    seatOrder: number | null;
    wikiUrl: string | null;
    wikiKey: string | null;
    rawLocation: string | null;
    sourceOrigin: string | null;
    onMap: boolean;
}

/** Die Beziehung einer Stätte zu einer Stadt, wie Legacy sie speichert. */
export interface SiteRelation {
    siteKey: string;
    /** Legacys Kennung der Stadt; `null` mit Herkunft heißt „keine Stadt“. */
    settlementLegacyPublicId: string | null;
    origin: SiteRelationOrigin;
}

/** Ein Ort, den die Kette einer Stätte nennt. */
export interface NamedPlace {
    position: number;
    targetRaw: string;
    targetKey: string | null;
}

export interface SiteSourceCount {
    /** Der Kopf meldet die Quelle als lesbar, die Liste ist da und ihre Zahl passt. */
    ok: boolean;
    /** Zeilen der Liste (bei einer ausgefallenen Quelle 0). */
    delivered: number;
    stored: number;
    /** Zeilen, die nicht gespeichert werden (unbrauchbar oder doppelt). */
    notStored: number;
}

export interface SiteStamps {
    mapRevision: number | null;
    aliasStamp: string | null;
    sourcesStamp: string | null;
}

export interface RohquellenTransform {
    /** Die Antwort ist unbrauchbar: nichts schreiben, nichts stilllegen. */
    skipped: boolean;
    sites: SiteRow[];
    relations: SiteRelation[];
    /** Schlüssel der Stätte → ihre genannten Orte (auch leer: dann verschwinden früher genannte). */
    namedPlaces: Map<string, NamedPlace[]>;
    /** Arten, deren Quelle ausgefallen ist: ihre Zeilen bleiben, wie sie sind. */
    failedKinds: SiteKind[];
    counts: Record<SiteKind, SiteSourceCount>;
    stamps: SiteStamps;
    findings: Finding[];
}

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag => typeof value === "object" && value !== null && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP = /^https?:\/\//i;
/** Ein nichtleerer Text, wörtlich (am Rand beschnitten); sonst `null`. */
const textOf = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;
const intOf = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null);

const SOURCE = "staetten-rohquellen-export.php";
const SEPARATOR = "\u001f";

/**
 * 🔴 **DIE EINE STELLE für den Schlüssel einer Stätte**: Art und Legacys Kennung, wie `site_source_unique`. Import, Prüfer und Bericht
 * rechnen ihn hier.
 */
export const siteKeyOf = (kind: SiteKind, sourceKey: string): string => `${kind}${SEPARATOR}${sourceKey}`;

/** Die Kennung eines Sitzes: Organisation und Ortsangabe (Legacy hat keine stabile, `uq_org_seat`). */
export const seatSourceKey = (organisation: string, rawPlace: string): string =>
    `${organisation}${SEPARATOR}${rawPlace}`;

const emptyCount = (): SiteSourceCount => ({ ok: false, delivered: 0, stored: 0, notStored: 0 });

const emptyCounts = (): Record<SiteKind, SiteSourceCount> => ({
    punkt: emptyCount(),
    gespeichert: emptyCount(),
    weg: emptyCount(),
    sitz: emptyCount(),
    stadtteil: emptyCount(),
});

const objectOf = (publicId: string, name: string | null): FindingObject => ({ table: "site", publicId, name });

/** Die Linkziele einer Kette; ein unbrauchbarer Eintrag wird gezählt, nicht geraten. */
function namedPlacesOf(value: unknown, broken: { n: number }): NamedPlace[] {
    if (!Array.isArray(value)) return [];
    const places: NamedPlace[] = [];
    for (const link of value) {
        const target = isBag(link) ? textOf(link["ziel"]) : null;
        if (target === null) {
            broken.n += 1;
            continue;
        }
        const key = isBag(link) ? textOf(link["ziel_key"]) : null;
        places.push({ position: places.length, targetRaw: target, targetKey: key });
    }
    return places;
}

/** Eine Adresse geht als href an den Leser: nur http und https (wie die CHECK-Bedingung der Tabelle). */
const httpOnly = (value: string | null): string | null => (value !== null && HTTP.test(value) ? value : null);

interface ParsedRow {
    site: SiteRow;
    relation: Omit<SiteRelation, "siteKey"> | null;
    named: NamedPlace[];
}

/** Ein Grund, warum eine Zeile nicht gespeichert wird; `null` heißt: sie ist brauchbar. */
type Rejection = { reason: string; ref: FindingObject };

interface RowContext {
    badIds: FindingObject[];
    brokenLinks: { n: number };
}

function relationOf(
    rawId: unknown,
    origin: SiteRelationOrigin | null,
    ref: FindingObject,
    context: RowContext,
): Omit<SiteRelation, "siteKey"> | null {
    const id = textOf(rawId);
    if (id !== null && !UUID.test(id)) {
        // Eine Kennung, die keine ist, bindet nichts - und sie ist auch nicht „keine Stadt“: die Beziehung bleibt offen.
        context.badIds.push({ ...ref, name: `${ref.name ?? ""} → ${id}` });
        return null;
    }
    if (id !== null) return { settlementLegacyPublicId: id.toLowerCase(), origin: origin ?? "gespeichert" };
    return origin === null ? null : { settlementLegacyPublicId: null, origin };
}

const P1_ORIGINS = new Set(["manual", "wiki"]);

function parseRow(kind: SiteKind, item: Bag, context: RowContext): ParsedRow | Rejection {
    const reject = (reason: string, publicId: string, name: string | null): Rejection => ({
        reason,
        ref: objectOf(publicId, name),
    });
    const base = {
        siteClass: null,
        seatRole: null,
        seatOrder: null,
        rawLocation: null,
        sourceOrigin: null,
        onMap: false,
    };
    switch (kind) {
        case "punkt": {
            const id = textOf(item["public_id"]);
            const name = textOf(item["name"]);
            if (id === null || !UUID.test(id) || name === null)
                return reject("site_row_unusable", id ?? "(ohne)", name);
            const herkunft = textOf(item["innerorts_herkunft"]);
            const origin = herkunft !== null && P1_ORIGINS.has(herkunft) ? (herkunft as SiteRelationOrigin) : null;
            const ref = objectOf(id.toLowerCase(), name);
            return {
                site: {
                    ...base,
                    sourceKind: kind,
                    sourceKey: id.toLowerCase(),
                    name,
                    siteClass: textOf(item["ortsklasse"]),
                    siteType: cleanType(item["art"]),
                    wikiUrl: httpOnly(textOf(item["wiki_url"])),
                    wikiKey: textOf(item["wiki_key"]),
                    onMap: item["aktiv"] === true,
                },
                relation: relationOf(item["innerorts_ort"], origin, ref, context),
                named: [],
            };
        }
        case "gespeichert": {
            const id = textOf(item["public_id"]);
            const name = textOf(item["name"]);
            if (id === null || !UUID.test(id) || name === null)
                return reject("site_row_unusable", id ?? "(ohne)", name);
            const ref = objectOf(id.toLowerCase(), name);
            return {
                site: {
                    ...base,
                    sourceKind: kind,
                    sourceKey: id.toLowerCase(),
                    name,
                    siteType: cleanType(item["art"]),
                    wikiUrl: httpOnly(textOf(item["wiki_url"])),
                    wikiKey: textOf(item["wiki_key"]),
                    sourceOrigin: textOf(item["quelle"]),
                },
                relation: relationOf(item["ort_public_id"], "gespeichert", ref, context),
                named: [],
            };
        }
        case "weg": {
            const key = textOf(item["weg_key"]);
            const name = textOf(item["name"]) ?? textOf(item["titel"]);
            if (key === null || name === null) return reject("site_row_unusable", key ?? "(ohne)", name);
            return {
                site: {
                    ...base,
                    sourceKind: kind,
                    sourceKey: key,
                    name,
                    siteType: cleanType(item["art"]),
                    wikiUrl: httpOnly(textOf(item["wiki_url"])),
                    wikiKey: textOf(item["wiki_key"]),
                    rawLocation: textOf(item["lage_roh"]),
                },
                relation: null,
                named: namedPlacesOf(item["lage_links"], context.brokenLinks),
            };
        }
        case "sitz": {
            const organisation = textOf(item["organisation"]);
            const rawPlace = textOf(item["ort_roh"]);
            const role = textOf(item["rolle"]);
            const order = intOf(item["reihenfolge"]);
            if (organisation === null || rawPlace === null || role === null || order === null) {
                return reject("site_row_unusable", organisation ?? "(ohne)", rawPlace);
            }
            return {
                site: {
                    ...base,
                    sourceKind: kind,
                    sourceKey: seatSourceKey(organisation, rawPlace),
                    name: organisation,
                    siteType: cleanType(item["organisation_art"]),
                    seatRole: role,
                    seatOrder: order,
                    wikiUrl: httpOnly(textOf(item["wiki_url"])),
                    wikiKey: textOf(item["wiki_key"]),
                    rawLocation: rawPlace,
                },
                relation: null,
                named: namedPlacesOf(item["ort_links"], context.brokenLinks),
            };
        }
        case "stadtteil": {
            const title = textOf(item["titel"]);
            if (title === null) return reject("site_row_unusable", "(ohne)", null);
            return {
                site: {
                    ...base,
                    sourceKind: kind,
                    sourceKey: title,
                    name: title,
                    siteType: null,
                    wikiUrl: httpOnly(textOf(item["wiki_url"])),
                    // 🔴 Regel 6: die Identität ist der Titel; ein Key wäre der Key der Stadt. Auch ein gelieferter wird nicht übernommen.
                    wikiKey: null,
                    rawLocation: textOf(item["standort"]),
                },
                relation: null,
                named: namedPlacesOf(item["standort_links"], context.brokenLinks),
            };
        }
    }
}

/** Die Art bereinigt (WI-0122, eine Regel ohne Liste), leer heißt `null`. */
function cleanType(value: unknown): string | null {
    const raw = textOf(value);
    return raw === null ? null : cleanPlaceType(raw);
}

function stampsOf(bag: Bag): SiteStamps {
    return {
        mapRevision: intOf(bag["map_revision"]),
        aliasStamp: textOf(bag["aliase_stempel"]),
        sourcesStamp: textOf(bag["quellen_stand"]),
    };
}

/** Die Umwandlung von X4. */
export function transformRohquellen(payload: unknown): RohquellenTransform {
    const counts = emptyCounts();
    const bag = isBag(payload) ? payload : null;
    if (bag === null || bag["ok"] !== true || !isBag(bag["kopf"])) {
        return {
            skipped: true,
            sites: [],
            relations: [],
            namedPlaces: new Map(),
            failedKinds: [...SITE_KINDS],
            counts,
            stamps: { mapRevision: null, aliasStamp: null, sourcesStamp: null },
            findings: [
                createFinding(
                    "source_block_missing",
                    `Die Antwort von ${SOURCE} ist unbrauchbar (kein Objekt, ok nicht wahr oder kein Kopf); die Stätten über Kennungen schreiben nichts und legen nichts still, der Lauf geht weiter`,
                    { datei: SOURCE },
                ),
            ],
        };
    }
    const head = bag["kopf"];
    const sites: SiteRow[] = [];
    const relations: SiteRelation[] = [];
    const namedPlaces = new Map<string, NamedPlace[]>();
    const failedKinds: SiteKind[] = [];
    const failures: string[] = [];
    const unusable: FindingObject[] = [];
    const duplicates: FindingObject[] = [];
    const context: RowContext = { badIds: [], brokenLinks: { n: 0 } };

    for (const kind of SITE_KINDS) {
        const source = SITE_SOURCES[kind];
        const sourceHead = isBag(head[source]) ? head[source] : null;
        const list = bag[source];
        const reason =
            sourceHead === null
                ? "kein Kopf"
                : sourceHead["ok"] !== true
                  ? "der Kopf meldet ok nicht wahr"
                  : !Array.isArray(list)
                    ? "keine Liste"
                    : intOf(sourceHead["zeilen"]) !== list.length
                      ? `Kopf ${String(sourceHead["zeilen"])} Zeilen, Liste ${String(list.length)}`
                      : null;
        if (reason !== null) {
            failedKinds.push(kind);
            failures.push(`${source}: ${reason}`);
            continue;
        }
        const count = counts[kind];
        count.ok = true;
        const items = list as unknown[];
        count.delivered = items.length;
        const seen = new Set<string>();
        for (const raw of items) {
            const parsed = isBag(raw)
                ? parseRow(kind, raw, context)
                : { reason: "site_row_unusable", ref: objectOf("(kein Objekt)", null) };
            if ("reason" in parsed) {
                count.notStored += 1;
                unusable.push({ ...parsed.ref, table: `site:${kind}` });
                continue;
            }
            const key = siteKeyOf(kind, parsed.site.sourceKey);
            if (seen.has(key)) {
                count.notStored += 1;
                duplicates.push({ table: `site:${kind}`, publicId: parsed.site.sourceKey, name: parsed.site.name });
                continue;
            }
            seen.add(key);
            sites.push(parsed.site);
            count.stored += 1;
            if (parsed.relation !== null) relations.push({ siteKey: key, ...parsed.relation });
            namedPlaces.set(key, parsed.named);
        }
    }

    const findings: Finding[] = [];
    if (failures.length > 0) {
        findings.push(
            createFinding(
                "staetten_quelle_ausgefallen",
                `${String(failures.length)} Quellen der Stätten sind ausgefallen oder unstimmig (${failures.join("; ")}); ihre Zeilen werden weder geschrieben noch stillgelegt (kein Tor)`,
                { quellen: failures.length },
                [],
                0,
                failures,
            ),
        );
    }
    if (unusable.length > 0) {
        findings.push(
            createFinding(
                "site_row_unusable",
                `${String(unusable.length)} Zeilen der Stätten ohne brauchbare Kennung oder ohne Namen; nicht gespeichert`,
                { zeilen: unusable.length },
                unusable,
            ),
        );
    }
    if (duplicates.length > 0) {
        findings.push(
            createFinding(
                "site_duplicate_key",
                `${String(duplicates.length)} Zeilen tragen eine Kennung, die eine frühere Zeile derselben Quelle schon trägt; die erste gilt`,
                { zeilen: duplicates.length },
                duplicates,
            ),
        );
    }
    if (context.badIds.length > 0) {
        findings.push(
            createFinding(
                "site_settlement_id_unusable",
                `${String(context.badIds.length)} Stätten nennen eine Kennung der Stadt, die keine UUID ist; die Beziehung bleibt offen (kein Ort, keine Entscheidung)`,
                { zeilen: context.badIds.length },
                context.badIds,
            ),
        );
    }
    if (context.brokenLinks.n > 0) {
        findings.push(
            createFinding(
                "site_named_place_unusable",
                `${String(context.brokenLinks.n)} Linkziele ohne Ziel; nicht gespeichert (Information)`,
                { linkziele: context.brokenLinks.n },
            ),
        );
    }
    return {
        skipped: failedKinds.length === SITE_KINDS.length,
        sites,
        relations,
        namedPlaces,
        failedKinds,
        counts,
        stamps: stampsOf(bag),
        findings,
    };
}

/**
 * X4 gegen X2 und X3 desselben Zuges (T14): Alle drei tragen `map_revision` und `aliase_stempel` aus DERSELBEN Funktion in Legacy.
 * Weichen sie ab, wurde Legacy zwischen den Abrufen redigiert; eine Zahl, die zwei Antworten verbindet, gilt dann nur für dieses Paar
 * (Information, kein Tor).
 */
export function crossStampFindingsV2(stamps: SiteStamps, others: Readonly<Record<string, unknown>>): Finding[] {
    const notes: string[] = [];
    for (const [name, other] of Object.entries(others)) {
        if (!isBag(other) || other["ok"] !== true) continue;
        const theirs = { mapRevision: intOf(other["map_revision"]), aliasStamp: textOf(other["aliase_stempel"]) };
        for (const field of ["mapRevision", "aliasStamp"] as const) {
            if (stamps[field] !== theirs[field]) {
                notes.push(`${name}.${field}: Stätten ${String(stamps[field])}, ${name} ${String(theirs[field])}`);
            }
        }
    }
    if (notes.length === 0) return [];
    return [
        createFinding(
            "stand_abweichend",
            `Die Stätten und ${String(new Set(notes.map((note) => note.split(".")[0])).size)} weitere Antworten desselben Zuges tragen verschiedene Stände; Legacy wurde zwischen den Abrufen redigiert, Zahlen über beide gelten nur für dieses Paar (Information)`,
            { abweichungen: notes.length },
            [],
            0,
            notes,
        ),
    ];
}
