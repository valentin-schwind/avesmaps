import {
    AREA_LOOKUP_LAYERS,
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    isInPathChain,
    landscapeReaderName,
    pathReaderName,
    wikiPageNameKey,
    type AreaRef,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { computePathGroups, type PathGroupInput } from "../migration/path-groups.ts";
import { effectiveChain, isValidAt, type TerritoryNode } from "../territories/resolve.ts";
import { buildLinkIndex, type LinkIndex } from "./link-index.ts";
import { buildWikiKeyLookup, type WikiKeyLookup } from "./wiki-key-lookup.ts";

/**
 * Der Speicherindex der Subjects (WI-0063 P4): was jede Anfrage braucht, aber sich nur mit einem Datenstand ändert - die
 * Herrschaftsgebiete samt Baum (1,7 Tsd. Zeilen), die Wegegruppen (9,3 Tsd. Abschnitte), die Landschaftsgruppen, die
 * Lizenzen der Wiki-Korpora und die Schlüssel der Objektlinks. Er wird je `revision` einmal gebaut und gehört dem
 * `SubjectService`; eine Anfrage liest daraus, statt für jede Auswahl dieselben Tabellen zu durchlaufen
 * („kein N+1 über Herrschaftshierarchie“, WI-0063 19).
 *
 * 🔴 NUR LESEN, und nur Träger, die Besucher sehen dürfen: aktive Zeilen, bei Orten ohne die verborgenen.
 */

// ------------------------------------------------------------------------------------------------------------------
// Herrschaftsgebiete
// ------------------------------------------------------------------------------------------------------------------

export interface TerritoryRecord {
    id: number;
    publicId: string;
    name: string;
    type: string | null;
    parentId: number | null;
    wikiUrl: string | null;
    capitalPlace: string | null;
    seatPlace: string | null;
}

export interface TerritoryIndex {
    /** Das Anzeigejahr der Ableitung (die zentrale Einstellung der Kartografie, wenn nichts abgeleitet ist). */
    yearBf: number;
    /** Gibt es eine gültige Ableitung? Ohne sie gibt es keine Formen und damit keinen Gebietskontext. */
    derived: boolean;
    /**
     * Die Gebiete (interne Id) mit mindestens einer abgeleiteten Form: nur sie stehen auf der Karte, nur auf sie kann ein Link fliegen (WI-0063 27.12,
     * 688 von 1.676 Gebieten haben keine, 647 davon sind erzeugte „Herrschaftsgebiet“-Teile). Ohne gültige Ableitung ist die Menge leer.
     */
    shaped: ReadonlySet<number>;
    byId: ReadonlyMap<number, TerritoryRecord>;
    byPublicId: ReadonlyMap<string, TerritoryRecord>;
    nodes: ReadonlyMap<number, TerritoryNode>;
    /** Orte (öffentliche ID) zu den im Anzeigejahr gültigen Gebieten, deren Hauptstadt beziehungsweise Sitz sie sind. */
    capitalOf: ReadonlyMap<string, readonly TerritoryRecord[]>;
    seatOf: ReadonlyMap<string, readonly TerritoryRecord[]>;
}

/** Die wirksame Kette eines Gebiets von der Wurzel bis zu ihm (Legacys Regel, dieselbe Funktion wie die Ableitung). */
export function territoryChain(index: TerritoryIndex, territoryId: number): TerritoryRecord[] {
    const chain = effectiveChain(territoryId, index.nodes, index.yearBf);
    const records = chain.flatMap((node) => {
        const record = index.byId.get(node.id);
        return record ? [record] : [];
    });
    if (records.length > 0) return records;
    // Ein Gebiet, das im Anzeigejahr nicht gilt, hat keine wirksame Kette; es steht allein.
    const own = index.byId.get(territoryId);
    return own ? [own] : [];
}

/**
 * Die Ketten der innersten Gebiete einer Menge getroffener Gebiete: Ein Gebiet, das in der Kette eines anderen Treffers
 * liegt, ist kein eigenes Blatt. Mehrere Blätter (umstrittene oder überlappende Gebiete) ergeben mehrere Ketten: tiefere
 * zuerst, dann nach Name (`depth`), oder in der Reihenfolge der Treffer (`given`, der erste Eintritt einer Linie).
 */
export function territoryChains(
    index: TerritoryIndex,
    hits: Iterable<number>,
    order: "depth" | "given" = "depth",
): TerritoryRecord[][] {
    const ids = [...new Set(hits)].filter((id) => index.byId.has(id));
    const chains = new Map(ids.map((id) => [id, territoryChain(index, id)] as const));
    const ancestors = new Set<number>();
    for (const [id, chain] of chains) {
        for (const member of chain) if (member.id !== id) ancestors.add(member.id);
    }
    const leaves = ids
        .filter((id) => !ancestors.has(id))
        .map((id) => chains.get(id) as TerritoryRecord[])
        .filter((chain) => chain.length > 0);
    if (order === "given") return leaves;
    return leaves.sort(
        (left, right) =>
            right.length - left.length ||
            (left[left.length - 1] as TerritoryRecord).name.localeCompare(
                (right[right.length - 1] as TerritoryRecord).name,
                "de",
            ),
    );
}

// ------------------------------------------------------------------------------------------------------------------
// Wege
// ------------------------------------------------------------------------------------------------------------------

export interface PathSegmentRecord {
    publicId: string;
    name: string;
    subtype: string;
    /** `wiki_key` der Hauptzuweisung (nur mit Schnappschuss) und ihre Adresse (auch ohne). */
    mainKey: string | null;
    mainUrl: string | null;
    mainName: string | null;
    further: readonly { key: string; name: string | null; url: string | null }[];
}

export interface PathGroupRecord {
    /** `wiki:<wiki_key>` oder `name:<Wegart>:<normalisierter Name>`: die Identität der Gruppe (sie hat keine UUID). */
    id: string;
    kind: "wiki" | "name";
    key: string;
    /** Die öffentlichen IDs der Abschnitte, aufsteigend: der erste ist der kanonische Anker. */
    members: readonly string[];
}

export interface PathIndex {
    segments: ReadonlyMap<string, PathSegmentRecord>;
    groups: ReadonlyMap<string, PathGroupRecord>;
    /** Die Gruppen eines Abschnitts: die Hauptzuweisung zuerst, dann weitere; leer ohne Gruppe (Einzelsegment). */
    groupsOf: ReadonlyMap<string, readonly string[]>;
    /**
     * Alle Abschnitte mit genau diesem Namen, über Wegtypen hinweg, aufsteigend (der Kettenschlüssel `name:<Name>`, Schritt 2b); Seewege
     * nur, wo der Name allein aus ihnen besteht. Ohne die Abschnitte, die blank nach ihrer Art heißen (`isInPathChain`): „Weg“ an einem
     * `Weg` ist ein Griff, und die Kette nannte sonst einen beliebigen der vielen (2026-11-09).
     */
    byChain: ReadonlyMap<string, readonly string[]>;
    /** Abschnitte mit echtem Namen nach dem Seitenschlüssel des Namens (der Namenskanal der Objektlinks). */
    byNameKey: ReadonlyMap<string, readonly string[]>;
}

// ------------------------------------------------------------------------------------------------------------------
// Landschaften
// ------------------------------------------------------------------------------------------------------------------

export interface RegionRecord {
    publicId: string;
    name: string;
    type: string;
    layer: string;
    /** Gleicher Name, gleiche Art, gleiche Ebene ist EIN Subject (WI-0047); ein Griff („Wald-925“) steht allein. */
    groupKey: string;
    wikiUrl: string | null;
}

export interface RegionIndex {
    byPublicId: ReadonlyMap<string, RegionRecord>;
    /** Gruppenschlüssel zu den öffentlichen IDs, aufsteigend. */
    groups: ReadonlyMap<string, readonly string[]>;
}

/** Die Ebenen, deren Flächen Subjects sind (Klima hat eigene Bänder). */
export const SUBJECT_LAYERS = AREA_LOOKUP_LAYERS;

/** Alle Regionen der Gruppe von `publicId`, aufsteigend, samt ihr selbst; leer, wenn die Region unbekannt ist. */
export function areaGroupMembers(index: RegionIndex, publicId: string): readonly string[] {
    const record = index.byPublicId.get(publicId);
    if (!record) return [];
    return index.groups.get(record.groupKey) ?? [publicId];
}

/** Der kanonische Ref einer Fläche: die kleinste Kennung der Gruppe als `id`, die übrigen als `group`. */
export function canonicalAreaRef(index: RegionIndex, publicId: string): AreaRef | null {
    const members = areaGroupMembers(index, publicId);
    const [first, ...others] = members;
    if (first === undefined) return null;
    return others.length > 0 ? { kind: "area", id: first, group: others } : { kind: "area", id: first };
}

// ------------------------------------------------------------------------------------------------------------------
// Korpora
// ------------------------------------------------------------------------------------------------------------------

export interface CorpusRecord {
    key: string;
    label: string;
    /** Die Lizenz des Korpus, wenn eine erfasst ist (`license_statement = license`); sonst keine Aussage. */
    license: { name: string; uri: string | null } | null;
    attribution: string | null;
}

// ------------------------------------------------------------------------------------------------------------------
// Der Index
// ------------------------------------------------------------------------------------------------------------------

export interface SubjectIndex {
    revision: string;
    mapDomainId: string;
    territories: TerritoryIndex;
    paths: PathIndex;
    regions: RegionIndex;
    corpora: ReadonlyMap<string, CorpusRecord>;
    links: LinkIndex;
    /** Wiki-Key → Subjects (WI-0063 27.12, Quelle X2): wohin das Linkziel eines Wiki-Textes zeigt. Nie über den Namen. */
    wikiKeys: WikiKeyLookup;
}

export async function buildSubjectIndex(
    database: Database,
    revision: string,
    mapDomainId = "aventuria",
): Promise<SubjectIndex> {
    const [territories, paths, regions, corpora] = await Promise.all([
        loadTerritories(database, mapDomainId),
        loadPaths(database, mapDomainId),
        loadRegions(database, mapDomainId),
        loadCorpora(database),
    ]);
    const links = await buildLinkIndex(database, { territories, paths, regions }, mapDomainId);
    const wikiKeys = await buildWikiKeyLookup(
        database,
        { territories, paths, regions, areaRef: (publicId) => canonicalAreaRef(regions, publicId) },
        mapDomainId,
    );
    return { revision, mapDomainId, territories, paths, regions, corpora, links, wikiKeys };
}

/**
 * NUR der Lookup „Wiki-Key → Subject“ aus der Zuordnungstafel (X2), ohne Korpora und Linkindex. Für den Import der Lore (Schritt I25): Er löst die
 * Ortszeilen über DENSELBEN Lookup auf, den der Linkpfad fragt (ein Key, eine Schleuse), und braucht dafür weder Korpora noch Linkindex.
 */
export async function buildWikiKeyLookupOnly(database: Database, mapDomainId = "aventuria"): Promise<WikiKeyLookup> {
    const [territories, paths, regions] = await Promise.all([
        loadTerritories(database, mapDomainId),
        loadPaths(database, mapDomainId),
        loadRegions(database, mapDomainId),
    ]);
    return buildWikiKeyLookup(
        database,
        { territories, paths, regions, areaRef: (publicId) => canonicalAreaRef(regions, publicId) },
        mapDomainId,
    );
}

async function loadTerritories(database: Database, mapDomainId: string): Promise<TerritoryIndex> {
    const [state] = await database<{ derived_revision: string | null; derived_year_bf: number | null }[]>`
        SELECT derived_revision, derived_year_bf FROM territory_state WHERE map_domain_id = ${mapDomainId}
    `;
    const yearBf = state?.derived_year_bf ?? AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf;
    const rows = await database<
        {
            id: string;
            public_id: string;
            name: string;
            territory_type: string | null;
            parent_id: string | null;
            min_zoom: number | null;
            max_zoom: number | null;
            valid_from_bf: number | null;
            valid_to_bf: number | null;
            wiki_url: string | null;
            capital: string | null;
            seat: string | null;
        }[]
    >`
        SELECT id::text, public_id::text, name, territory_type, parent_id::text, min_zoom, max_zoom, valid_from_bf, valid_to_bf,
               wiki_url, capital_place_public_id::text AS capital, seat_place_public_id::text AS seat
        FROM territory
        WHERE is_active AND map_domain_id = ${mapDomainId}
        ORDER BY id
    `;
    const byId = new Map<number, TerritoryRecord>();
    const byPublicId = new Map<string, TerritoryRecord>();
    const nodes = new Map<number, TerritoryNode>();
    const capitalOf = new Map<string, TerritoryRecord[]>();
    const seatOf = new Map<string, TerritoryRecord[]>();
    for (const row of rows) {
        const record: TerritoryRecord = {
            id: Number(row.id),
            publicId: row.public_id,
            name: row.name,
            type: row.territory_type,
            parentId: row.parent_id === null ? null : Number(row.parent_id),
            wikiUrl: row.wiki_url,
            capitalPlace: row.capital,
            seatPlace: row.seat,
        };
        byId.set(record.id, record);
        byPublicId.set(record.publicId, record);
        nodes.set(record.id, {
            id: record.id,
            publicId: record.publicId,
            name: record.name,
            parentId: record.parentId,
            minZoom: row.min_zoom,
            maxZoom: row.max_zoom,
            validFromBf: row.valid_from_bf,
            validToBf: row.valid_to_bf,
        });
        // Eine Hauptstadt gilt nur für ein Gebiet, das im Anzeigejahr besteht.
        if (!isValidAt(row.valid_from_bf, row.valid_to_bf, yearBf)) continue;
        for (const [place, map] of [
            [record.capitalPlace, capitalOf],
            [record.seatPlace, seatOf],
        ] as const) {
            if (place === null) continue;
            const list = map.get(place);
            if (list) list.push(record);
            else map.set(place, [record]);
        }
    }
    const derived =
        Boolean(state?.derived_revision) && state?.derived_year_bf !== null && state?.derived_year_bf !== undefined;
    const shaped = derived
        ? new Set(
              (
                  await database<{ territory_id: string }[]>`
                      SELECT DISTINCT territory_id::text AS territory_id FROM territory_shape
                  `
              ).map((row) => Number(row.territory_id)),
          )
        : new Set<number>();
    return {
        yearBf,
        derived,
        shaped,
        byId,
        byPublicId,
        nodes,
        capitalOf,
        seatOf,
    };
}

/** Ein aktiver Abschnitt, wie `loadPaths` ihn liest: Name, Art, Hauptartikel und weitere Artikel. */
export interface PathIndexRow {
    public_id: string;
    name: string;
    subtype: string;
    main_key: string | null;
    main_url: string | null;
    main_name: string | null;
    further: { key: string; name: string | null; url: string | null }[];
}

async function loadPaths(database: Database, mapDomainId: string): Promise<PathIndex> {
    const rows = await database<PathIndexRow[]>`
        SELECT p.public_id::text AS public_id, p.name, p.subtype,
               ms.wiki_key AS main_key, m.wiki_url AS main_url, ms.name AS main_name,
               coalesce(fr.items, '[]'::jsonb) AS further
        FROM path p
        LEFT JOIN path_wiki_assignment m ON m.path_id = p.id AND m.role = 'main' AND m.is_active
        LEFT JOIN wiki_path_snapshot ms ON ms.id = m.snapshot_id AND ms.is_active
        LEFT JOIN LATERAL (
            SELECT jsonb_agg(jsonb_build_object('key', fs.wiki_key, 'name', fs.name, 'url', f.wiki_url) ORDER BY f.id) AS items
            FROM path_wiki_assignment f
            JOIN wiki_path_snapshot fs ON fs.id = f.snapshot_id AND fs.is_active
            WHERE f.path_id = p.id AND f.role = 'further' AND f.is_active
        ) fr ON TRUE
        WHERE p.is_active AND p.map_domain_id = ${mapDomainId}
        ORDER BY p.public_id
    `;
    return buildPathIndex(rows);
}

/** Der Wegeindex aus den Abschnitten, nach öffentlicher ID geordnet (ohne Datenbank, damit Tests ihn aus einer kleinen Welt bauen). */
export function buildPathIndex(rows: readonly PathIndexRow[]): PathIndex {
    const segments = new Map<string, PathSegmentRecord>();
    const inputs: PathGroupInput[] = [];
    const byChain = new Map<string, string[]>();
    /** Seewege für sich: In die Kette ihres Namens kommen sie nur, wo der Name allein aus Seewegen besteht (die Suche des Editors). */
    const seewege = new Map<string, string[]>();
    const byNameKey = new Map<string, string[]>();
    const push = (map: Map<string, string[]>, key: string, id: string): void => {
        const list = map.get(key);
        if (list) list.push(id);
        else map.set(key, [id]);
    };
    for (const row of rows) {
        segments.set(row.public_id, {
            publicId: row.public_id,
            name: row.name,
            subtype: row.subtype,
            mainKey: row.main_key,
            mainUrl: row.main_url,
            mainName: row.main_name,
            further: row.further,
        });
        inputs.push({
            publicId: row.public_id,
            name: row.name,
            subtype: row.subtype,
            mainKey: row.main_key,
            further: row.further.map((entry) => ({ key: entry.key, name: entry.name })),
            wikiName: row.main_name,
        });
        // Die Zeilen kommen nach öffentlicher ID: Jede Liste ist damit aufsteigend, der erste Eintrag der kanonische Anker.
        if (row.name.trim() !== "") {
            if (isInPathChain(row.name, row.subtype))
                push(row.subtype === "Seeweg" ? seewege : byChain, row.name, row.public_id);
            if (pathReaderName(row.name, row.subtype) !== null) {
                const key = wikiPageNameKey(row.name);
                if (key !== "") push(byNameKey, key, row.public_id);
            }
        }
    }
    for (const [name, ids] of seewege) if (!byChain.has(name)) byChain.set(name, ids);
    const groups = new Map<string, PathGroupRecord>();
    const groupsOf = new Map<string, string[]>();
    for (const group of computePathGroups(inputs).groups) {
        const id = `${group.kind}:${group.key}`;
        const members = [...group.members].sort();
        groups.set(id, { id, kind: group.kind, key: group.key, members });
        for (const member of members) push(groupsOf, member, id);
    }
    // Ein Abschnitt gehört zuerst zur Gruppe seiner Hauptzuweisung (Vertrag `wege`): sie ist der Vorgabewert.
    for (const [member, list] of groupsOf) {
        const main = segments.get(member)?.mainKey;
        if (main === null || main === undefined) continue;
        const wanted = `wiki:${main}`;
        const at = list.indexOf(wanted);
        if (at > 0) {
            list.splice(at, 1);
            list.unshift(wanted);
        }
    }
    return { segments, groups, groupsOf, byChain, byNameKey };
}

async function loadRegions(database: Database, mapDomainId: string): Promise<RegionIndex> {
    const rows = await database<
        { public_id: string; name: string; region_type: string | null; region_layer: string; wiki_url: string | null }[]
    >`
        SELECT public_id::text AS public_id, name, region_type, region_layer, wiki_url
        FROM region
        -- Verborgene Landschaften (WI-0178 T41) gibt es für das Infopanel nicht, für niemanden: gleiche Antwort unter derselben Adresse.
        WHERE is_active AND NOT is_hidden AND map_domain_id = ${mapDomainId} AND region_layer = ANY(${[...SUBJECT_LAYERS]}::text[])
        ORDER BY public_id
    `;
    const byPublicId = new Map<string, RegionRecord>();
    const groups = new Map<string, string[]>();
    for (const row of rows) {
        const type = row.region_type ?? "";
        const reader = landscapeReaderName(row.name, type);
        const groupKey =
            reader === null ? `id:${row.public_id}` : `${row.region_layer}|${type}|${reader.toLowerCase()}`;
        byPublicId.set(row.public_id, {
            publicId: row.public_id,
            name: row.name,
            type,
            layer: row.region_layer,
            groupKey,
            wikiUrl: row.wiki_url,
        });
        const list = groups.get(groupKey);
        if (list) list.push(row.public_id);
        else groups.set(groupKey, [row.public_id]);
    }
    return { byPublicId, groups };
}

export async function loadCorpora(database: Queryable): Promise<Map<string, CorpusRecord>> {
    const rows = await database<
        {
            corpus_key: string;
            label: string;
            license_statement: string;
            attribution: string | null;
            license_name: string | null;
            license_uri: string | null;
        }[]
    >`
        SELECT c.corpus_key, c.label, c.license_statement, c.attribution,
               l.display_name AS license_name, l.canonical_uri AS license_uri
        FROM source_corpus c
        LEFT JOIN license_catalog l ON l.key = c.license_key
        WHERE c.is_active
    `;
    return new Map(
        rows.map((row) => [
            row.corpus_key,
            {
                key: row.corpus_key,
                label: row.label,
                license:
                    row.license_statement === "license" && row.license_name !== null
                        ? { name: row.license_name, uri: row.license_uri }
                        : null,
                attribution: row.attribution,
            },
        ]),
    );
}
