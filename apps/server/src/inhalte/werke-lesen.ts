import {
    INHALTE_WERK_ROLLEN,
    INHALTE_WERK_ZIEL_STAENDE,
    type InhalteHerkunft,
    type InhalteUrsprung,
    type InhalteWerk,
    type InhalteWerkListe,
    type InhalteWerkOrt,
    type InhalteWerkRolle,
    type InhalteWerkZeile,
    type InhalteWerkZielStand,
    type InhalteWerkZielart,
    type InhalteWerkeAnfrage,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { likeMuster } from "../db/like-muster.ts";
import { resolveLiteratureCovers } from "../media/resolver.ts";
import { TRAEGER } from "./traeger.ts";

/**
 * Lesen für den Reiter „Literatur“ des Fensters „Inhalte bearbeiten“ (WI-0254, Runde 2): die Liste links und ein Werk mit seinen
 * Stammdaten, dem Cover und der geordneten Ortsliste. Nur lesend; geschrieben wird in `werke-schreiben.ts`.
 *
 * - **Die Liste** ist seitenweise. „Stillgelegt“ sind allein die von der Redaktion unterdrückten Werke (`retired_origin = editor`); was der
 *   Import stilllegte, ist Geschichte. Die Zahl der Orte zählt nur aktive Zeilen.
 * - **Die Ortsliste** trägt ALLE Zeilen in der Reihenfolge `(sort_order, export_ordinal, id)`, auch die stillen: Der Entwurf rechnet mit
 *   ihnen (wiederherstellen), die Ansicht blendet sie aus. Das Ziel einer Zeile steht mit Namen da, nie ein Name als Schlüssel: `kind` +
 *   `carrierId` ist die Identität, und eine ungeklärte Zeile hat nur ihren Rohnamen.
 * - **Das Cover** liest der Media Core (`media/resolver.ts`, eine Entscheidung für alle); hier steht nur, ob eine Bindung besteht und was
 *   davon öffentlich sein darf.
 */

const ROLLEN: ReadonlySet<string> = new Set(INHALTE_WERK_ROLLEN);
const ZIEL_STAENDE: ReadonlySet<string> = new Set(INHALTE_WERK_ZIEL_STAENDE);
const rolle = (wert: string): InhalteWerkRolle => (ROLLEN.has(wert) ? (wert as InhalteWerkRolle) : "play");
const zielStand = (wert: string): InhalteWerkZielStand =>
    ZIEL_STAENDE.has(wert) ? (wert as InhalteWerkZielStand) : "unmatched";

/** Woher die Angabe eines Werks stammt: die Redaktion hier und die Hand in Legacy zählen als Hand, `unknown` als Legacy ohne Auskunft. */
export function ursprungVon(
    sourceSystem: string,
    legacyOrigin: string,
    targetOrigin = "legacy_import",
): InhalteUrsprung {
    if (sourceSystem === "editor" || targetOrigin === "editor") return "manual";
    if (legacyOrigin === "wiki") return "wiki";
    if (legacyOrigin === "manual") return "manual";
    return "legacy";
}

/**
 * Wer ein Werk führt: Legacy (und das Wiki) oder die Hand. „Von Hand“ heißt: im Editor angelegt oder geändert (`source_system` nicht `legacy`) oder
 * von Legacys Redaktion von Hand gepflegt (`legacy_origin = manual`); beides zeigt die Liste als ◐ „manuell“ (Mockup: „manuell / geändert“).
 */
const herkunftVon = (sourceSystem: string, legacyOrigin = "unknown"): InhalteHerkunft =>
    sourceSystem === "legacy" && legacyOrigin !== "manual" ? "legacy" : "editor";
/** Dieselbe Regel als SQL über den Alias `a`. */
const VON_HAND_SQL = "(a.source_system <> 'legacy' OR a.legacy_origin = 'manual')";

interface ZeilenRow {
    public_id: string;
    title: string;
    product_type: string;
    edition: string | null;
    year_label: string | null;
    bf_year: number | null;
    source_system: string;
    legacy_origin: string;
    is_active: boolean;
    orte: number;
}

function zeileVon(row: ZeilenRow): InhalteWerkZeile {
    return {
        id: row.public_id,
        title: row.title,
        productType: row.product_type,
        ...(row.edition === null ? {} : { edition: row.edition }),
        ...(row.year_label === null ? {} : { year: row.year_label }),
        ...(row.bf_year === null ? {} : { bfYear: row.bf_year }),
        orte: row.orte,
        herkunft: herkunftVon(row.source_system, row.legacy_origin),
        stillgelegt: !row.is_active,
    };
}

/** Die Werke für die Liste links. */
export async function listeWerke(database: Queryable, anfrage: InhalteWerkeAnfrage): Promise<InhalteWerkListe> {
    const stand = anfrage.stand ?? "aktiv";
    const bedingungen: string[] = [];
    const werte: (string | number)[] = [];
    const parameter = (wert: string | number): string => {
        werte.push(wert);
        return `$${String(werte.length)}`;
    };
    if (stand === "aktiv") bedingungen.push("a.is_active");
    else if (stand === "stillgelegt") bedingungen.push("NOT a.is_active AND a.retired_origin = 'editor'");
    else bedingungen.push("(a.is_active OR a.retired_origin = 'editor')");
    if (anfrage.herkunft === "legacy") bedingungen.push(`NOT ${VON_HAND_SQL}`);
    else if (anfrage.herkunft === "editor") bedingungen.push(VON_HAND_SQL);
    const suche = anfrage.q?.trim() ?? "";
    if (suche !== "") {
        const muster = parameter(likeMuster(suche));
        bedingungen.push(
            `(a.title ILIKE ${muster} ESCAPE '\\' OR a.series ILIKE ${muster} ESCAPE '\\' OR a.genre ILIKE ${muster} ESCAPE '\\'
              OR a.wiki_key ILIKE ${muster} ESCAPE '\\' OR a.edition ILIKE ${muster} ESCAPE '\\' OR a.product_type ILIKE ${muster} ESCAPE '\\')`,
        );
    }
    const sortierung =
        anfrage.sort === "year"
            ? "a.bf_year DESC NULLS LAST, lower(a.title), a.id"
            : anfrage.sort === "title_desc"
              ? "lower(a.title) DESC, a.id"
              : "lower(a.title), a.id";
    const limit = parameter(anfrage.limit ?? 50);
    const offset = parameter(anfrage.offset ?? 0);
    const treffer = bedingungen.join(" AND ");
    const zeilen = await database.unsafe<ZeilenRow[]>(
        `SELECT a.public_id::text AS public_id, a.title, a.product_type, a.edition, coalesce(a.bf_label, a.bf_year::text) AS year_label,
                a.bf_year, a.source_system, a.legacy_origin, a.is_active,
                (SELECT count(*) FROM adventure_place p WHERE p.adventure_id = a.id AND p.is_active AND p.state = 'active')::int AS orte
           FROM adventure a
          WHERE ${treffer}
          ORDER BY ${sortierung}
          LIMIT ${limit} OFFSET ${offset}`,
        werte,
    );
    const [summe] = await database.unsafe<{ total: number }[]>(
        `SELECT count(*)::int AS total FROM adventure a WHERE ${treffer}`,
        werte.slice(0, werte.length - 2),
    );
    const [zahlen] = await database<{ aktiv: number; editor: number; stillgelegt: number }[]>`
        SELECT count(*) FILTER (WHERE is_active)::int AS aktiv,
               count(*) FILTER (WHERE is_active AND (source_system <> 'legacy' OR legacy_origin = 'manual'))::int AS editor,
               count(*) FILTER (WHERE NOT is_active AND retired_origin = 'editor')::int AS stillgelegt
          FROM adventure
    `;
    return {
        total: summe?.total ?? 0,
        items: zeilen.map(zeileVon),
        zahlen: { aktiv: zahlen?.aktiv ?? 0, editor: zahlen?.editor ?? 0, stillgelegt: zahlen?.stillgelegt ?? 0 },
    };
}

interface WerkRow {
    id: string;
    public_id: string;
    revision: number;
    wiki_key: string | null;
    title: string;
    product_type: string;
    edition: string | null;
    series: string | null;
    bf_year: number | null;
    bf_label: string | null;
    genre: string | null;
    is_official: boolean;
    editor_note: string | null;
    legacy_origin: string;
    source_system: string;
    is_active: boolean;
}

interface OrtRow {
    row_id: string;
    role: string;
    target_state: string;
    raw_name: string;
    state: string;
    source_system: string;
    target_origin: string;
    legacy_origin: string;
    place_id: string | null;
    territory_id: string | null;
    region_id: string | null;
    terrain_peak_id: string | null;
    path_id: string | null;
}

/** Die Spalten der Fremdschlüssel einer Zeile und die Art des Ziels dazu (die Landschaft heißt hier `area`, die Tabelle `region`). */
const ZIEL_SPALTEN: readonly { spalte: keyof OrtRow; kind: InhalteWerkZielart }[] = [
    { spalte: "place_id", kind: "place" },
    { spalte: "territory_id", kind: "territory" },
    { spalte: "region_id", kind: "area" },
    { spalte: "terrain_peak_id", kind: "peak" },
    { spalte: "path_id", kind: "path" },
];

/** Die Namen der Felder des Vertrags (`adventure_field_origin.field`) in der Sprache der Schnittstelle. */
const FELDNAMEN: Readonly<Record<string, string>> = {
    title: "title",
    product_type: "productType",
    edition: "edition",
    series: "series",
    bf_year: "bfYear",
    bf_label: "bfLabel",
    genre: "genre",
    is_official: "isOfficial",
};

/** Die interne Nummer eines Werks; `undefined`, wo es das Werk nicht gibt. */
export async function werkIntern(database: Queryable, publicId: string): Promise<string | undefined> {
    const [zeile] = await database<
        { id: string }[]
    >`SELECT id::text FROM adventure WHERE public_id = ${publicId}::uuid`;
    return zeile?.id;
}

/** Die Zeilen der Ortsliste eines Werks mit Namen und Art ihrer Ziele, in der Reihenfolge der Liste. */
async function leseOrte(database: Queryable, werkId: string): Promise<InhalteWerkOrt[]> {
    const zeilen = await database<OrtRow[]>`
        SELECT p.id::text AS row_id, p.role, p.target_state, p.raw_name, p.state, p.source_system, p.target_origin, p.legacy_origin,
               p.place_id::text AS place_id, p.territory_id::text AS territory_id, p.region_id::text AS region_id,
               p.terrain_peak_id::text AS terrain_peak_id, p.path_id::text AS path_id
          FROM adventure_place p
         WHERE p.adventure_id = ${werkId}::bigint
         ORDER BY p.sort_order, p.export_ordinal, p.id
    `;
    // Eine Abfrage je Art der Ziele statt eine je Zeile.
    const ziele = new Map<string, { public_id: string; name: string; subtype: string | null; is_active: boolean }>();
    for (const { spalte, kind } of ZIEL_SPALTEN) {
        const ids = zeilen.map((zeile) => zeile[spalte] as string | null).filter((id): id is string => id !== null);
        if (ids.length === 0) continue;
        const tafeln = TRAEGER[kind];
        const gefunden = await database.unsafe<
            { id: string; public_id: string; name: string | null; subtype: string | null; is_active: boolean }[]
        >(
            `SELECT c.id::text AS id, c.public_id::text AS public_id, c.name, c.${tafeln.subtype} AS subtype, c.is_active
               FROM ${tafeln.carrier} c WHERE c.id = ANY($1::bigint[])`,
            [ids],
        );
        for (const eines of gefunden) {
            ziele.set(`${kind}:${eines.id}`, {
                public_id: eines.public_id,
                name: eines.name ?? "",
                subtype: eines.subtype,
                is_active: eines.is_active,
            });
        }
    }
    return zeilen.map((zeile): InhalteWerkOrt => {
        const art = ZIEL_SPALTEN.find(({ spalte }) => zeile[spalte] !== null);
        const ziel = art === undefined ? undefined : ziele.get(`${art.kind}:${String(zeile[art.spalte])}`);
        const state = zeile.state === "retired" || zeile.state === "suppressed" ? zeile.state : "active";
        const name = ziel !== undefined && ziel.name.trim() !== "" ? ziel.name : zeile.raw_name;
        return {
            rowId: zeile.row_id,
            role: rolle(zeile.role),
            targetState: zielStand(zeile.target_state),
            ...(ziel === undefined || art === undefined ? {} : { kind: art.kind, carrierId: ziel.public_id }),
            name,
            ...(ziel === undefined || ziel.subtype === null || ziel.subtype === "" ? {} : { subtype: ziel.subtype }),
            state,
            ursprung: ursprungVon(zeile.source_system, zeile.legacy_origin, zeile.target_origin),
            herkunft: herkunftVon(zeile.source_system),
            ...(ziel === undefined ? {} : { traegerAktiv: ziel.is_active }),
        };
    });
}

/** Ein Werk mit allem, was die Mitte und die rechte Spalte zeigen; `undefined`, wo es das Werk nicht gibt. */
export async function leseWerk(database: Queryable, publicId: string): Promise<InhalteWerk | undefined> {
    const [row] = await database<WerkRow[]>`
        SELECT a.id::text AS id, a.public_id::text AS public_id, a.revision::int AS revision, a.wiki_key, a.title, a.product_type,
               a.edition, a.series, a.bf_year, a.bf_label, a.genre, a.is_official, a.editor_note, a.legacy_origin, a.source_system,
               a.is_active
          FROM adventure a
         WHERE a.public_id = ${publicId}::uuid
    `;
    if (row === undefined) return undefined;
    const herkuenfte = await database<{ field: string; origin: string }[]>`
        SELECT field, origin FROM adventure_field_origin WHERE adventure_id = ${row.id}::bigint
    `;
    const feldUrsprung: Record<string, "wiki" | "manual"> = {};
    for (const eine of herkuenfte) {
        const name = FELDNAMEN[eine.field];
        if (name !== undefined && (eine.origin === "wiki" || eine.origin === "manual"))
            feldUrsprung[name] = eine.origin;
    }
    const [bindung] = await database<{ gebunden: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM adventure_media m
             WHERE m.adventure_id = ${row.id}::bigint AND m.role = 'literature_cover' AND m.retired_at IS NULL
        ) AS gebunden
    `;
    const covers = await resolveLiteratureCovers(database, [row.public_id]);
    const ansicht = covers.get(row.public_id);
    return {
        id: row.public_id,
        revision: row.revision,
        ...(row.wiki_key === null ? {} : { wikiKey: row.wiki_key }),
        title: row.title,
        productType: row.product_type,
        edition: row.edition,
        series: row.series,
        bfYear: row.bf_year,
        bfLabel: row.bf_label,
        genre: row.genre,
        isOfficial: row.is_official,
        editorNote: row.editor_note,
        ursprung: ursprungVon(row.source_system, row.legacy_origin),
        herkunft: herkunftVon(row.source_system, row.legacy_origin),
        aktiv: row.is_active,
        feldUrsprung,
        cover: { gebunden: bindung?.gebunden === true, ...(ansicht === undefined ? {} : { ansicht }) },
        orte: await leseOrte(database, row.id),
    };
}
