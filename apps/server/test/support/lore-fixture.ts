import { createHash } from "node:crypto";
import type { SubjectRef } from "@avesmaps3d/shared";
import type { Queryable } from "../../src/database.ts";
import type { LoreLookups } from "../../src/migration/lore.ts";
import type { WikiKeyLookup, WikiKeyTarget } from "../../src/subjects/wiki-key-lookup.ts";
import {
    C,
    MAP_DOMAIN,
    carrierId,
    cleanCatalogFixtures,
    fixtureIndex,
    insertCatalogCarriers,
} from "./catalog-fixture.ts";

/**
 * Fixtures für die Tests von D5 (Lore, Migration 0074), WI-0063 P3.
 *
 * Die Träger sind die von D3 und D2 (`catalog-fixture.ts`: Orte mit Schlüssel `p68t-…`, Gebiete mit `wiki:p68t-…`, Landschaft, Gipfel,
 * Wegegruppe); dazu ein Ort mit Namensraum im Schlüssel (`p68t-inoffiziell-ort-a`) und zwei Katalogquellen von D1. Die Zuordnung X2
 * (`wiki_key_assignment`), aus der der Lookup der Oberfläche entsteht, trägt für jeden Träger den Key `wiki:` plus Slug; das Gebiet hat KEINE
 * abgeleitete Form (kein Ziel des Lookups), der inaktive Ort trägt einen Eintrag, ist aber kein Ziel. Alle Einträge der
 * Lore tragen den Schlüssel `p74t-…`, Quellen den Titel `P74T …` und Adressen auf `p74test.example`; `cleanLoreFixtures` räumt genau
 * das weg und fasst keinen fremden Bestand an.
 */

export { C, carrierId };

/** Ein Ort, dessen Wiki-Schlüssel den Namensraum trägt: ein anderer Artikel als `p68t-ort-a`. */
export const EXTRA_ORT = carrierId(90);

export const ZOO_KEY = "wikipub:p74t-zoo-botanica";
export const KRAEUTER_URL = "https://p74test.example/kraeuter";
export const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
export const KRAEUTER_KEY = `url:${sha256(KRAEUTER_URL)}`;

export interface LoreIds {
    carriers: Record<string, string>;
    /** `feature_source.id` je `source_key`. */
    sources: Record<string, string>;
}

/** Legt Träger, den Namensraum-Ort und zwei Katalogquellen an. */
export async function insertLoreFixtures(database: Queryable): Promise<LoreIds> {
    const carriers = await insertCatalogCarriers(database);
    const [place] = await database<{ id: string }[]>`
        INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
        VALUES (${EXTRA_ORT}, ${MAP_DOMAIN}, 'C68T Ort Inoffiziell', 'dorf', ST_SetSRID(ST_MakePoint(405, 400), 0), 'test', TRUE)
        RETURNING id::text
    `;
    const [snapshot] = await database<{ id: string }[]>`
        INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url)
        VALUES ('p68t-inoffiziell-ort-a', 'https://de.wiki-aventurica.de/wiki/Inoffiziell:P68t_Ort_A') RETURNING id::text
    `;
    await database`
        INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state)
        VALUES (${(place as { id: string }).id}, 'https://de.wiki-aventurica.de/wiki/Inoffiziell:P68t_Ort_A', ${(snapshot as { id: string }).id}, 'assigned')
    `;
    carriers[EXTRA_ORT] = (place as { id: string }).id;
    const assign = async (art: string, publicId: string, key: string): Promise<void> => {
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key) VALUES (${art}, ${publicId}::uuid, ${key})
        `;
    };
    await assign("siedlung", C.ortA, "wiki:p68t-ort-a");
    await assign("siedlung", C.ortB, "wiki:p68t-ort-geteilt");
    await assign("siedlung", C.ortC, "wiki:p68t-ort-geteilt");
    await assign("siedlung", EXTRA_ORT, "wiki:p68t-inoffiziell-ort-a");
    await assign("siedlung", C.ortInaktiv, "wiki:p68t-ort-inaktiv");
    await assign("gebiet", C.gebietB, "wiki:p68t-gebiet-b");
    await assign("landschaft", C.regionA, "wiki:p68t-region-a");
    await assign("region", C.gipfelA, "wiki:p68t-gipfel-a");
    await assign("weg", C.wegA1, "wiki:p68t-weg-a");
    const sources: Record<string, string> = {};
    const [zoo] = await database<{ id: string }[]>`
        INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official)
        VALUES (${ZOO_KEY}, 'final', NULL, 'P74T Zoo-Botanica Aventurica', 'regionalspielhilfe', TRUE) RETURNING id::text
    `;
    sources[ZOO_KEY] = (zoo as { id: string }).id;
    const [kraeuter] = await database<{ id: string }[]>`
        INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official)
        VALUES (${KRAEUTER_KEY}, 'final', ${KRAEUTER_URL}, 'P74T Kräuterkunde', 'sonstiges', FALSE) RETURNING id::text
    `;
    sources[KRAEUTER_KEY] = (kraeuter as { id: string }).id;
    return { carriers, sources };
}

/** Räumt die Lore, ihre Quellen, den Namensraum-Ort und die Träger weg, in der Reihenfolge der Fremdschlüssel. */
export async function cleanLoreFixtures(database: Queryable): Promise<void> {
    for (const table of [
        "lore_rule_term",
        "lore_rule",
        "lore_place_target",
        "lore_place",
        "lore_entry_source",
        "lore_entry_field_origin",
        "lore_entry",
    ]) {
        await database.unsafe(`DELETE FROM ${table}`);
    }
    await database.unsafe(`DELETE FROM wiki_key_assignment WHERE object_public_id::text LIKE '68000000-%'`);
    await database.unsafe(`DELETE FROM feature_source WHERE title LIKE 'P74T%' OR url LIKE 'https://p74test.%'`);
    await cleanCatalogFixtures(database);
    try {
        await database.unsafe(`DELETE FROM migration_run WHERE data_domain = 'lore'`);
    } catch {
        // ein Fremdschlüssel hält ihn: stehen lassen
    }
}

type Bag = Record<string, unknown>;

export const entry = (key: string, kind: string, over: Bag = {}): Bag => ({
    wiki_key: key,
    kind,
    name: `P74T ${key}`,
    wiki_title: null,
    wiki_url: null,
    gruppe: null,
    typ: null,
    lebensraum: null,
    synonyme: null,
    merkmale: null,
    continent: null,
    origin: "wiki",
    status: "active",
    field_origins: null,
    match_key: key.replace(/[^a-z0-9]/g, ""),
    ...over,
});

export const place = (entryKey: string, placeKey: string, over: Bag = {}): Bag => ({
    entry_wiki_key: entryKey,
    place_wiki_key: placeKey,
    place_title: placeKey,
    relation: "verbreitung",
    sort_order: 0,
    origin: "wiki",
    status: "active",
    ...over,
});

export const term = (seq: number, over: Bag = {}): Bag => ({
    seq,
    join_op: "und",
    area_public_id: null,
    climate_from: null,
    climate_to: null,
    region_types: [],
    ...over,
});

export const rule = (entryKey: string, terms: Bag[], over: Bag = {}): Bag => ({
    id: 1,
    entry_wiki_key: entryKey,
    relation: "verbreitung",
    origin: "manual",
    status: "active",
    sort_order: 0,
    terms,
    ...over,
});

export const catalogRow = (id: number, over: Bag = {}): Bag => ({
    id,
    url_hash: "",
    wiki_key: null,
    url: "",
    label: `P74T Quelle ${String(id)}`,
    type: "sonstiges",
    official: false,
    license: null,
    attribution: null,
    corpus: null,
    own_fields: [],
    no_corpus: false,
    ...over,
});

export const zooRow = (id = 1): Bag =>
    catalogRow(id, {
        wiki_key: "p74t-zoo-botanica",
        url_hash: sha256("wikipub:p74t-zoo-botanica"),
        label: "P74T Zoo-Botanica Aventurica",
        type: "regionalspielhilfe",
        official: true,
    });

export const kraeuterRow = (id = 2): Bag =>
    catalogRow(id, { url: KRAEUTER_URL, url_hash: sha256(KRAEUTER_URL), label: "P74T Kräuterkunde" });

export const link = (entryKey: string, sourceId: number, over: Bag = {}): Bag => ({
    entity_type: "lore",
    entity_public_id: entryKey,
    source_id: sourceId,
    source_url_hash: null,
    status: "approved",
    origin: "wiki_publication",
    reference_kind: "ausfuehrlich",
    pages: null,
    note: null,
    position: 0,
    entity_active: null,
    ...over,
});

export interface AnswerParts {
    entries: Bag[];
    places?: Bag[];
    rules?: Bag[];
    sources?: Bag[];
    links?: Bag[];
    kinds?: Record<string, boolean>;
    withheld?: number;
    over?: Bag;
}

/** Eine Antwort in der Form des Exports, deren Kopfzähler zu den Listen passen. */
export function answer(parts: AnswerParts): Bag {
    const places = parts.places ?? [];
    const rules = parts.rules ?? [];
    const sources = parts.sources ?? [];
    const links = parts.links ?? [];
    const termList = rules.flatMap((rule) => (rule["terms"] as Bag[] | undefined) ?? []);
    const byStatus: Record<string, number> = {};
    const byOrigin: Record<string, number> = {};
    for (const item of links) {
        byStatus[String(item["status"])] = (byStatus[String(item["status"])] ?? 0) + 1;
        byOrigin[String(item["origin"])] = (byOrigin[String(item["origin"])] ?? 0) + 1;
    }
    return {
        ok: true,
        map_revision: 812,
        lore_revision: "lore-p74t",
        kinds_enabled: parts.kinds ?? { flora: true, fauna: true, spezies: true, ware: true },
        counts: {
            entries: parts.entries.length,
            withheld_entries: parts.withheld ?? 0,
            places: places.length,
            rules: rules.length,
            rule_terms: termList.length,
            rule_term_types: termList.reduce(
                (sum, item) => sum + ((item["region_types"] as unknown[] | undefined)?.length ?? 0),
                0,
            ),
            orphaned_rule_terms: 0,
            sources: sources.length,
            links: links.length,
            links_by_status: byStatus,
            links_by_origin: byOrigin,
        },
        entries: parts.entries,
        places,
        rules,
        sources,
        links,
        ...parts.over,
    };
}

/** Ein Lookup ohne Datenbank: je kanonischem Key (`wiki:` plus Slug) die Objekte, denen er zugewiesen ist. */
export function wikiKeysOf(assignments: Record<string, [WikiKeyTarget["kind"], SubjectRef][]>): WikiKeyLookup {
    const byKey = new Map<string, WikiKeyTarget[]>();
    for (const [key, targets] of Object.entries(assignments))
        byKey.set(
            key,
            targets.map(([kind, ref]) => ({ kind, ref })),
        );
    return { byKey, pageKeys: new Map() };
}

/** Die Zuordnung der Fixture als Lookup: dieselben Träger und Keys wie `insertLoreFixtures`, mit festen Ids (Gebiet B hat keine Form, der inaktive Ort fehlt). */
export function fixtureWikiKeys(): WikiKeyLookup {
    return wikiKeysOf({
        "wiki:p68t-ort-a": [["place", { kind: "place", id: C.ortA }]],
        "wiki:p68t-ort-geteilt": [
            ["place", { kind: "place", id: C.ortB }],
            ["place", { kind: "place", id: C.ortC }],
        ],
        "wiki:p68t-inoffiziell-ort-a": [["place", { kind: "place", id: EXTRA_ORT }]],
        "wiki:p68t-gebiet-a": [["territory", { kind: "territory", id: C.gebietA }]],
        "wiki:p68t-region-a": [["area", { kind: "area", id: C.regionA }]],
        "wiki:p68t-gipfel-a": [["peak", { kind: "peak", id: C.gipfelA }]],
        "wiki:p68t-weg-a": [["path", { kind: "path", anchor: C.wegA1, wiki: "p68t-weg-a" }]],
    });
}

/** Die Träger ohne Datenbank für die reinen Tests. */
export function loreLookups(over: Partial<LoreLookups> = {}): LoreLookups {
    return {
        wikiKeys: fixtureWikiKeys(),
        carrierIds: {
            places: new Map([
                [C.ortA, "1"],
                [C.ortB, "2"],
                [C.ortC, "3"],
                [EXTRA_ORT, "9"],
            ]),
            territories: new Map([
                [C.gebietA, "10"],
                [C.gebietB, "11"],
            ]),
            peaks: new Map([[C.gipfelA, "30"]]),
            regions: new Map([[C.regionA.toLowerCase(), "20"]]),
        },
        // Das Vergleichsmaß: die Träger über D6 und territory.wiki_key (Gebiet B trägt dort seinen Schlüssel auch ohne Form).
        targets: fixtureIndex({
            placesByKey: new Map([
                ["p68t-ort-a", ["1"]],
                ["p68t-ort-geteilt", ["2", "3"]],
                ["p68t-inoffiziell-ort-a", ["9"]],
            ]),
        }),
        regions: new Map([
            [C.regionA.toLowerCase(), { id: "20", active: true }],
            [C.regionInaktiv.toLowerCase(), { id: "21", active: false }],
        ]),
        regionTypes: new Set(["vegetation|wald", "vegetation|auwald", "vegetation|sumpf", "topographie|gebirge"]),
        climateKeys: new Set(["polar", "gemaessigt", "subtropisch", "tropisch"]),
        sources: new Map([
            [ZOO_KEY, "501"],
            [KRAEUTER_KEY, "502"],
        ]),
        ...over,
    };
}
