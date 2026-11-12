import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    EDITOR_TERRITORY_DETAIL_FIELDS,
    editorTerritoryCircles,
    legacyYear,
    mediaPublicUrl,
    type EditorTerritoryArea,
    type EditorTerritoryDetail,
    type EditorTerritoryDetailField,
    type EditorTerritoryHierarchy,
    type EditorTerritoryList,
    type EditorTerritoryPlace,
    type EditorTerritoryRef,
    type EditorTerritoryRow,
    type EditorTerritorySammelStand,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { PUBLISHED_VARIANT } from "../media/roles.ts";
import { readTerritoryDetail } from "../subjects/territory-detail-facts.ts";

/**
 * Der Lesepfad des Herrschaftsgebiete-Editors (WI-0209 Paket A1, EDIT-0005 §3, §9; Vertrag `packages/shared/src/territory-editor.ts`),
 * nach dem Muster des Landschaftseditors (`landscapes.ts`).
 *
 * - **Liste:** eine Abfrage für alle aktiven Gebiete der Domäne mit Elter, Spanne, Farbe, eigener Fläche und dem Rahmen dessen, was die
 *   Karte unter ihnen zeigt (abgeleitete Formen aller Bänder, `territory_shape`). Der Kreis folgt Legacys Regel über die Untergebiete
 *   (`editorTerritoryCircles`); „gilt im Anzeigejahr nicht“ rechnet wie Legacys Layer (`territory-display-rule.ts`, offen = `null` oder 9999).
 * - **Detail:** die Felder des Gebiets und die 17 Detailfelder mit Herkunft (`readTerritoryDetail`, wie das Infopanel), Elternkette,
 *   Kinder, Hauptstadt und Sitz als Ort (ein Verweis ins Leere ist `missing`, Befund), die eigenen Flächen ohne Geometrie samt
 *   Legacys „aktueller Form“ und die Ansprüche in beiden Richtungen.
 */

const OFFEN = 9999;
const rund = (v: number): number => Math.round(v * 100) / 100;
const lebt = (von: number | null, bis: number | null, jahr: number): boolean =>
    (von === null || von <= jahr) && (bis === null || bis === OFFEN || bis >= jahr);
const rahmen = (r: {
    x0: number | null;
    y0: number | null;
    x1: number | null;
    y1: number | null;
}): { bounds?: [number, number, number, number] } =>
    r.x0 !== null && r.y0 !== null && r.x1 !== null && r.y1 !== null
        ? { bounds: [rund(r.x0), rund(r.y0), rund(r.x1), rund(r.y1)] }
        : {};

interface ListRow {
    public_id: string;
    is_active: boolean;
    name: string;
    territory_type: string | null;
    parent: string | null;
    min_zoom: number | null;
    max_zoom: number | null;
    valid_from_bf: number | null;
    valid_to_bf: number | null;
    color: string;
    wiki_url: string | null;
    sort_order: number;
    areas: number;
    source_system: string;
    x0: number | null;
    y0: number | null;
    x1: number | null;
    y1: number | null;
}

export async function listEditorTerritories(
    database: Queryable,
    mapDomainId = "aventuria",
    yearBf: number = AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf,
): Promise<EditorTerritoryList> {
    const rows = await database<ListRow[]>`
        WITH a AS (
            SELECT territory_id, count(*)::int AS n
              FROM territory_area WHERE is_active AND map_domain_id = ${mapDomainId} GROUP BY territory_id
        ), s AS (
            SELECT sh.territory_id, ST_Extent(sh.geom) AS rahmen
              FROM territory_shape sh JOIN territory t ON t.id = sh.territory_id
             WHERE t.map_domain_id = ${mapDomainId} GROUP BY sh.territory_id
        )
        SELECT t.public_id::text AS public_id, t.is_active, t.name, t.territory_type, p.public_id::text AS parent, t.min_zoom, t.max_zoom,
               t.valid_from_bf, t.valid_to_bf, t.color, t.wiki_url, t.sort_order, coalesce(a.n, 0) AS areas, t.source_system,
               ST_XMin(s.rahmen) AS x0, ST_YMin(s.rahmen) AS y0, ST_XMax(s.rahmen) AS x1, ST_YMax(s.rahmen) AS y1
          FROM territory t
          LEFT JOIN territory p ON p.id = t.parent_id AND (p.is_active OR NOT t.is_active) AND p.id <> t.id
          LEFT JOIN a ON a.territory_id = t.id
          LEFT JOIN s ON s.territory_id = t.id
         WHERE t.map_domain_id = ${mapDomainId}
         ORDER BY t.sort_order, t.name, t.public_id
    `;
    // Der Kreis zählt nur, was lebt; ein gelöschtes Gebiet (T54) steht leer da und zählt nirgends mit.
    const kinder = new Map<string, string[]>();
    for (const r of rows) {
        if (r.parent === null || !r.is_active) continue;
        const liste = kinder.get(r.parent) ?? [];
        liste.push(r.public_id);
        kinder.set(r.parent, liste);
    }
    const eigen = new Set(rows.filter((r) => r.is_active && r.areas > 0).map((r) => r.public_id));
    const kreise = editorTerritoryCircles(
        rows.filter((r) => r.is_active).map((r) => r.public_id),
        (id) => kinder.get(id) ?? [],
        (id) => eigen.has(id),
    );
    return {
        yearBf,
        rows: rows.map((r): EditorTerritoryRow => ({
            id: r.public_id,
            name: r.name,
            ...(r.territory_type ? { type: r.territory_type } : {}),
            ...(r.parent ? { parent: r.parent } : {}),
            circle: kreise.get(r.public_id) ?? "leer",
            ...(r.areas > 0 ? { area: true as const } : {}),
            ...(r.min_zoom !== null ? { minZoom: r.min_zoom } : {}),
            ...(r.max_zoom !== null ? { maxZoom: r.max_zoom } : {}),
            color: r.color,
            ...(r.wiki_url ? { wiki: r.wiki_url } : {}),
            order: r.sort_order,
            ...(lebt(r.valid_from_bf, r.valid_to_bf, yearBf) ? {} : { notInYear: true as const }),
            ...(r.is_active ? {} : { deleted: true as const }),
            ...rahmen(r),
            ...(r.source_system !== "legacy" ? { source: r.source_system } : {}),
        })),
    };
}

interface DetailRow {
    id: string;
    public_id: string;
    revision: number;
    parent_origin: string | null;
    is_active: boolean;
    name: string;
    short_name: string | null;
    territory_type: string | null;
    wiki_type: string | null;
    status_text: string | null;
    color: string;
    opacity: string;
    min_zoom: number | null;
    max_zoom: number | null;
    valid_from_bf: number | null;
    valid_to_bf: number | null;
    valid_label: string | null;
    sort_order: number;
    wiki_url: string | null;
    wiki_key: string | null;
    source_system: string;
    capital_id: string | null;
    capital_name: string | null;
    capital_kind: string | null;
    seat_id: string | null;
    seat_name: string | null;
    seat_kind: string | null;
}

interface AreaRow {
    public_id: string;
    revision: number;
    min_zoom: number | null;
    max_zoom: number | null;
    valid_from_bf: number | null;
    valid_to_bf: number | null;
    is_valid: boolean;
    x0: number | null;
    y0: number | null;
    x1: number | null;
    y1: number | null;
}

function ort(id: string | null, name: string | null, kind: string | null): EditorTerritoryPlace | undefined {
    if (id === null) return undefined;
    return name === null ? { id, missing: true } : { id, name, ...(kind ? { kind } : {}) };
}

/**
 * Der Wiki-Stand eines Gebietsartikels je Detailfeld (Migration 0162, `wiki_territory_snapshot`): Text oder `null` („das Wiki kennt
 * nichts“); ein Feld mit unbekanntem Wiki-Wert (`wiki_territory_snapshot_unknown`) fehlt in der Karte. Ohne Artikel oder Schnappschuss
 * `undefined`: Dann ist jeder Wiki-Wert unbekannt.
 */
export async function leseWikiStand(
    database: Queryable,
    wikiKey: string | null,
): Promise<Map<EditorTerritoryDetailField, string | null> | undefined> {
    if (wikiKey === null || !wikiKey.startsWith("wiki:")) return undefined;
    const [zeile] = await database<(Record<string, string | null> & { unbekannt: string[] | null })[]>`
        SELECT s.*, (SELECT array_agg(u.field) FROM wiki_territory_snapshot_unknown u WHERE u.snapshot_id = s.id) AS unbekannt
          FROM wiki_territory_snapshot s
         WHERE s.wiki_key = ${wikiKey} AND s.is_active
    `;
    if (!zeile) return undefined;
    const unbekannt = new Set(zeile.unbekannt ?? []);
    const stand = new Map<EditorTerritoryDetailField, string | null>();
    for (const feld of EDITOR_TERRITORY_DETAIL_FIELDS) if (!unbekannt.has(feld)) stand.set(feld, zeile[feld] ?? null);
    return stand;
}

/** Die Detailfelder wie im Detail: Ein Feld steht da mit eigenem Wert oder mit einem Wiki-Text, den ↺ holen kann (G6); ohne beides fehlt es. */
function detailWerte(
    detail: Awaited<ReturnType<typeof readTerritoryDetail>>,
    wikiStand: Awaited<ReturnType<typeof leseWikiStand>>,
): EditorTerritoryDetail["details"] {
    const details: EditorTerritoryDetail["details"] = {};
    for (const feld of EDITOR_TERRITORY_DETAIL_FIELDS) {
        const value = detail?.values[feld] ?? null;
        const wiki = wikiStand?.get(feld);
        if (value === null && (wiki === undefined || wiki === null)) continue;
        const origin = value === null ? undefined : detail?.origins.get(feld);
        details[feld] = { value, ...(origin ? { origin } : {}), ...(wiki !== undefined ? { wiki } : {}) };
    }
    return details;
}

/**
 * Der Stand der gewählten Gebiete für die Mehrfachauswahl (EDIT-0003 T57, `EditorTerritorySammelStand`): Revision, Status und die
 * Detailfelder wie im Detail; Gelöschte und Unbekannte fehlen, die übrigen in der Folge von `ids`.
 */
export async function readTerritorySammelStand(
    database: Queryable,
    ids: readonly string[],
    mapDomainId = "aventuria",
): Promise<EditorTerritorySammelStand> {
    const zeilen = await database<
        { public_id: string; revision: number; status_text: string | null; wiki_key: string | null }[]
    >`
        SELECT public_id::text AS public_id, revision::int AS revision, status_text, wiki_key
          FROM territory
         WHERE public_id = ANY(${[...ids]}::uuid[]) AND map_domain_id = ${mapDomainId} AND is_active
    `;
    const folge = new Map(ids.map((id, i) => [id, i]));
    zeilen.sort((a, b) => folge.get(a.public_id)! - folge.get(b.public_id)!);
    const territories: EditorTerritorySammelStand["territories"] = [];
    for (const zeile of zeilen)
        territories.push({
            id: zeile.public_id,
            revision: zeile.revision,
            ...(zeile.status_text ? { status: zeile.status_text } : {}),
            details: detailWerte(
                await readTerritoryDetail(database, zeile.public_id),
                await leseWikiStand(database, zeile.wiki_key),
            ),
        });
    return { territories };
}

export async function readEditorTerritory(
    database: Queryable,
    publicId: string,
    mapDomainId = "aventuria",
    yearBf: number = AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf,
): Promise<EditorTerritoryDetail | undefined> {
    const [t] = await database<DetailRow[]>`
        SELECT t.id::text AS id, t.public_id::text AS public_id, t.name, t.short_name, t.territory_type, t.wiki_type, t.status_text,
               t.color, t.opacity::text AS opacity, t.min_zoom, t.max_zoom, t.valid_from_bf, t.valid_to_bf, t.valid_label,
               t.sort_order, t.wiki_url, t.wiki_key, t.source_system, t.revision::int AS revision, t.parent_origin, t.is_active,
               t.capital_place_public_id::text AS capital_id, c.name AS capital_name, c.subtype AS capital_kind,
               t.seat_place_public_id::text AS seat_id, s.name AS seat_name, s.subtype AS seat_kind
          FROM territory t
          LEFT JOIN place c ON c.public_id = t.capital_place_public_id AND c.is_active
          LEFT JOIN place s ON s.public_id = t.seat_place_public_id AND s.is_active
         WHERE t.public_id = ${publicId} AND t.map_domain_id = ${mapDomainId}
    `;
    if (!t) return undefined;

    // Die Kette bis zur Wurzel über aktive Eltern; ein Zyklus endet an dem Gebiet, das schon dastand.
    const parents = await database<{ public_id: string; name: string }[]>`
        WITH RECURSIVE kette(id, parent_id, tiefe, pfad) AS (
            SELECT t.id, t.parent_id, 0, ARRAY[t.id] FROM territory t WHERE t.id = ${t.id}::bigint
            UNION ALL
            SELECT p.id, p.parent_id, k.tiefe + 1, k.pfad || p.id
              FROM kette k JOIN territory p ON p.id = k.parent_id AND p.is_active
             WHERE NOT p.id = ANY(k.pfad)
        )
        SELECT t.public_id::text AS public_id, t.name FROM kette k JOIN territory t ON t.id = k.id WHERE k.tiefe > 0 ORDER BY k.tiefe
    `;
    const children = await database<{ public_id: string; name: string }[]>`
        SELECT public_id::text AS public_id, name FROM territory
         WHERE parent_id = ${t.id}::bigint AND is_active AND id <> ${t.id}::bigint
         ORDER BY sort_order, name, public_id
    `;
    const areas = await database<AreaRow[]>`
        SELECT a.public_id::text AS public_id, a.revision::int AS revision, a.min_zoom, a.max_zoom, a.valid_from_bf, a.valid_to_bf, a.is_valid,
               ST_XMin(a.geom) AS x0, ST_YMin(a.geom) AS y0, ST_XMax(a.geom) AS x1, ST_YMax(a.geom) AS y1
          FROM territory_area a
         WHERE a.territory_id = ${t.id}::bigint AND a.is_active
         ORDER BY a.valid_from_bf NULLS FIRST, a.public_id
    `;
    const claimedBy = await database<{ public_id: string; name: string }[]>`
        SELECT k.public_id::text AS public_id, k.name FROM territory_claim c
          JOIN territory k ON k.id = c.claimant_id AND k.is_active
         WHERE c.is_active AND c.territory_id = ${t.id}::bigint ORDER BY c.sort_order, k.name
    `;
    const claims = await database<{ public_id: string; name: string }[]>`
        SELECT o.public_id::text AS public_id, o.name FROM territory_claim c
          JOIN territory o ON o.id = c.territory_id AND o.is_active
         WHERE c.is_active AND c.claimant_id = ${t.id}::bigint ORDER BY o.name
    `;
    // Das Wappen (Frage 13: A3 zeigt und verweist): gebunden ja oder nein, dazu die veröffentlichte Datei, wie die Ortsliste.
    const [wappen] = await database<{ bound: boolean; sha256: string | null }[]>`
        SELECT EXISTS (
                   SELECT 1 FROM territory_media m WHERE m.territory_id = ${t.id}::bigint AND m.role = 'coat' AND m.retired_at IS NULL
               ) AS bound,
               (SELECT f.sha256 FROM territory_media m
                  JOIN media_file f ON f.media_asset_id = m.media_asset_id
                                   AND f.storage_class = 'published' AND f.variant = ${PUBLISHED_VARIANT.coat}
                 WHERE m.territory_id = ${t.id}::bigint AND m.role = 'coat' AND m.retired_at IS NULL
                 ORDER BY f.created_at DESC, f.id DESC
                 LIMIT 1) AS sha256
    `;
    const detail = await readTerritoryDetail(database, t.public_id);
    const wikiStand = await leseWikiStand(database, t.wiki_key);

    // Welche Flächen im Anzeigejahr gelten, mit Legacys „aktueller Form“: dieselbe Rechnung wie der Nachweis je Band.
    const jahr = legacyYear(
        {
            territories: [
                {
                    publicId: t.public_id,
                    name: t.name,
                    shortName: t.short_name ?? "",
                    parentPublicId: null,
                    minZoom: t.min_zoom,
                    maxZoom: t.max_zoom,
                    // Der Beginn des Gebiets gilt für Flächen ohne eigenen (Legacys `??`); sein Ende sagt `notInYear` am Gebiet.
                    validFromBf: t.valid_from_bf,
                    validToBf: null,
                },
            ],
            geometries: areas.map((a) => ({
                publicId: a.public_id,
                territoryPublicId: t.public_id,
                minZoom: a.min_zoom,
                maxZoom: a.max_zoom,
                validFromBf: a.valid_from_bf,
                validToBf: a.valid_to_bf,
            })),
        },
        yearBf,
    );
    const imJahr = new Set(jahr.geometries.map((g) => g.publicId));
    const ref = (r: { public_id: string; name: string }): EditorTerritoryRef => ({ id: r.public_id, name: r.name });

    const details = detailWerte(detail, wikiStand);
    const capital = ort(t.capital_id, t.capital_name, t.capital_kind);
    const seat = ort(t.seat_id, t.seat_name, t.seat_kind);

    return {
        id: t.public_id,
        revision: t.revision,
        name: t.name,
        ...(t.short_name ? { shortName: t.short_name } : {}),
        ...(t.territory_type ? { type: t.territory_type } : {}),
        ...(t.wiki_type ? { wikiType: t.wiki_type } : {}),
        ...(t.status_text ? { status: t.status_text } : {}),
        color: t.color,
        opacity: Number(t.opacity),
        ...(t.min_zoom !== null ? { minZoom: t.min_zoom } : {}),
        ...(t.max_zoom !== null ? { maxZoom: t.max_zoom } : {}),
        ...(t.valid_from_bf !== null ? { validFromBf: t.valid_from_bf } : {}),
        ...(t.valid_to_bf !== null ? { validToBf: t.valid_to_bf } : {}),
        ...(t.valid_label ? { validLabel: t.valid_label } : {}),
        ...(lebt(t.valid_from_bf, t.valid_to_bf, yearBf) ? {} : { notInYear: true as const }),
        order: t.sort_order,
        ...(t.wiki_url || t.wiki_key
            ? { wiki: { ...(t.wiki_url ? { url: t.wiki_url } : {}), ...(t.wiki_key ? { key: t.wiki_key } : {}) } }
            : {}),
        ...(t.source_system !== "legacy" ? { source: t.source_system } : {}),
        parents: parents.map(ref),
        ...(t.parent_origin === "override" ? { parentOrigin: "override" as const } : {}),
        ...(t.is_active ? {} : { deleted: true as const }),
        children: children.map(ref),
        ...(capital ? { capital } : {}),
        ...(seat ? { seat } : {}),
        details,
        areas: areas.map((a): EditorTerritoryArea => ({
            id: a.public_id,
            revision: a.revision,
            ...(a.min_zoom !== null ? { minZoom: a.min_zoom } : {}),
            ...(a.max_zoom !== null ? { maxZoom: a.max_zoom } : {}),
            ...(a.valid_from_bf !== null ? { validFromBf: a.valid_from_bf } : {}),
            ...(a.valid_to_bf !== null ? { validToBf: a.valid_to_bf } : {}),
            ...(imJahr.has(a.public_id) ? {} : { notInYear: true as const }),
            ...(a.is_valid ? {} : { invalid: true as const }),
            ...rahmen(a),
        })),
        claimedBy: claimedBy.map(ref),
        claims: claims.map(ref),
        ...(wappen?.bound ? { hasCoat: true as const } : {}),
        ...(wappen?.sha256 ? { coat: mediaPublicUrl(wappen.sha256) } : {}),
    };
}

interface RegelGebietRow {
    id: string;
    public_id: string;
    name: string;
    short_name: string | null;
    territory_type: string | null;
    parent: string | null;
    min_zoom: number | null;
    max_zoom: number | null;
    valid_from_bf: number | null;
    valid_to_bf: number | null;
    color: string;
    sort_order: number;
    revision: number;
    unten: boolean;
}

/**
 * Der Reiter „Hierarchie“ (A3; EDIT-0005 §3): die Eingabe der Anzeigeregel für das Gebiet, seine Kette bis zur Wurzel und alle
 * Nachfahren, dazu die Flächen der Nachfahren und das oberste abgeleitete Band. Der Browser rechnet daraus mit derselben Regel wie der
 * Nachweis N2 (`territory-display-rule.ts`), was die Karte je Band zeigt; die Kette braucht er, weil ein Obergebiet mit engerer Spanne
 * gewinnt. Die Flächen der Kette selbst zeigen nur die Kette und fehlen darum.
 */
export async function readEditorTerritoryHierarchy(
    database: Queryable,
    publicId: string,
    mapDomainId = "aventuria",
    yearBf: number = AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf,
): Promise<EditorTerritoryHierarchy | undefined> {
    const [wurzel] = await database<{ id: string }[]>`
        SELECT id::text AS id FROM territory WHERE public_id = ${publicId} AND is_active AND map_domain_id = ${mapDomainId}
    `;
    if (!wurzel) return undefined;
    // Ein Zyklus endet an dem Gebiet, das schon dastand (B1 verbietet ihn, alte Daten könnten ihn tragen).
    const gebiete = await database<RegelGebietRow[]>`
        WITH RECURSIVE oben(id, parent_id, pfad) AS (
            SELECT t.id, t.parent_id, ARRAY[t.id] FROM territory t WHERE t.id = ${wurzel.id}::bigint
            UNION ALL
            SELECT p.id, p.parent_id, o.pfad || p.id
              FROM oben o JOIN territory p ON p.id = o.parent_id AND p.is_active
             WHERE NOT p.id = ANY(o.pfad)
        ), unten(id, pfad) AS (
            SELECT t.id, ARRAY[t.id] FROM territory t WHERE t.id = ${wurzel.id}::bigint
            UNION ALL
            SELECT k.id, u.pfad || k.id
              FROM unten u JOIN territory k ON k.parent_id = u.id AND k.is_active AND k.id <> u.id
             WHERE NOT k.id = ANY(u.pfad)
        ), alle AS (
            SELECT id, false AS unten FROM oben WHERE id <> ${wurzel.id}::bigint
            UNION ALL
            SELECT DISTINCT id, true FROM unten
        )
        SELECT t.id::text AS id, t.public_id::text AS public_id, t.name, t.short_name, t.territory_type,
               p.public_id::text AS parent, t.min_zoom, t.max_zoom, t.valid_from_bf, t.valid_to_bf, t.color, t.sort_order,
               t.revision::int AS revision, a.unten
          FROM alle a
          JOIN territory t ON t.id = a.id
          LEFT JOIN territory p ON p.id = t.parent_id AND p.is_active AND p.id <> t.id
         ORDER BY t.sort_order, t.name, t.public_id
    `;
    const darunter = gebiete.filter((g) => g.unten).map((g) => g.id);
    const flaechen = await database<
        {
            public_id: string;
            territory: string;
            min_zoom: number | null;
            max_zoom: number | null;
            valid_from_bf: number | null;
            valid_to_bf: number | null;
        }[]
    >`
        SELECT a.public_id::text AS public_id, t.public_id::text AS territory, a.min_zoom, a.max_zoom, a.valid_from_bf, a.valid_to_bf
          FROM territory_area a JOIN territory t ON t.id = a.territory_id
         WHERE a.is_active AND a.territory_id = ANY(${darunter}::bigint[])
         ORDER BY a.public_id
    `;
    const [abgeleitet] = await database<{ band: number }[]>`
        SELECT coalesce(max(da.band), -1)::int AS band
          FROM territory_display_area da JOIN territory t ON t.id = da.territory_id
         WHERE t.map_domain_id = ${mapDomainId}
    `;
    return {
        yearBf,
        derivedMaxBand: abgeleitet?.band ?? -1,
        territories: gebiete.map((g) => ({
            id: g.public_id,
            ...(g.unten ? { revision: g.revision } : {}),
            name: g.name,
            ...(g.short_name ? { shortName: g.short_name } : {}),
            ...(g.territory_type ? { type: g.territory_type } : {}),
            ...(g.parent ? { parent: g.parent } : {}),
            ...(g.min_zoom !== null ? { minZoom: g.min_zoom } : {}),
            ...(g.max_zoom !== null ? { maxZoom: g.max_zoom } : {}),
            ...(g.valid_from_bf !== null ? { validFromBf: g.valid_from_bf } : {}),
            ...(g.valid_to_bf !== null ? { validToBf: g.valid_to_bf } : {}),
            color: g.color,
            order: g.sort_order,
            ...(g.unten ? {} : { above: true as const }),
        })),
        areas: flaechen.map((a) => ({
            id: a.public_id,
            territory: a.territory,
            ...(a.min_zoom !== null ? { minZoom: a.min_zoom } : {}),
            ...(a.max_zoom !== null ? { maxZoom: a.max_zoom } : {}),
            ...(a.valid_from_bf !== null ? { validFromBf: a.valid_from_bf } : {}),
            ...(a.valid_to_bf !== null ? { validToBf: a.valid_to_bf } : {}),
        })),
    };
}
