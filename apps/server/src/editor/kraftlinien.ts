import {
    editorPowerlineCircle,
    kraftlinienGestalt,
    type EditorPowerlineDetail,
    type EditorPowerlineList,
    type EditorPowerlineNode,
    type EditorPowerlineRow,
    type PowerlineEndKind,
    type PowerlineState,
    type WikiArtikel,
    type WikiTrefferListe,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { leseHerkunft } from "./feld-herkunft.ts";

/**
 * Der Lesepfad des Kraftlinien-Editors (WI-0205 Paket K1; Vertrag `packages/shared/src/powerline-editor.ts`), nach dem Muster der
 * Landschaften (`landscapes.ts`).
 *
 * - **Liste:** alle aktiven Abschnitte der Domäne in einer Abfrage, gruppiert nach Namen (ein leerer Name bildet keine Gruppe, wie
 *   Legacy), mit ihrem Artikel aus der aktiven Zuordnung (`powerline_wiki_assignment`, Titel aus `wiki_powerline_snapshot`), dazu
 *   die Knoten, auf die sie zeigen, aus Ort, Label, Kraftlinienpunkt und Landmarke. Gestalt und Enden rechnet `kraftlinienGestalt`.
 * - **Detail:** die Abschnitte einer Linie über ihren Anker (jeder Abschnitt der Gruppe führt zur selben Linie), die Knoten mit Lage,
 *   Merkmal Nodix und den anderen Linien, die dort enden.
 * - Jeder Abschnitt trägt seine Revision (0143, K4) und seine Beschreibung (KF1); geschrieben wird in `kraftlinien-schreiben.ts` (K6).
 * - **Stand** (K10, Migration 0154, EDIT-0003 T43): auf der Karte (`is_active`), von der Karte genommen (`off_map`) oder gelöscht. Die
 *   Liste nennt alle drei (EDIT-0003 T54), die abgenommenen mit `offMap` und leerem Kreis (◐ mit Artikel, ○ ohne), die gelöschten mit
 *   `deleted` (der Trichter zeigt sie erst unter „Gelöscht“); das Detail liest jeden Stand
 *   über einen Abschnitt, damit Verlauf und „Zurück auf die Karte“ die Linie erreichen. Eine Linie ist die Gruppe gleichen Namens im
 *   SELBEN Stand.
 */

interface AbschnittRow {
    public_id: string;
    name: string;
    from_public_id: string;
    to_public_id: string;
    curve: number | null;
    label_visible: boolean;
    revision: number;
    description: string | null;
    wiki_url: string | null;
    wiki_title: string | null;
    snapshot_id: string | null;
    source_system: string;
    stand: PowerlineState;
    x0: number | null;
    y0: number | null;
    x1: number | null;
    y1: number | null;
}

interface KnotenRow {
    id: string;
    kind: Exclude<PowerlineEndKind, "missing">;
    name: string | null;
    x: number;
    y: number;
    nodix: boolean;
}

/** Die Gruppe eines Abschnitts: sein Name in seinem Stand, ein leerer Name nur er selbst. */
const gruppeVon = (a: Pick<AbschnittRow, "public_id" | "name" | "stand">): string =>
    a.name.trim() === "" ? `#${a.public_id}` : `${a.stand}=${a.name}`;
const rund = (v: number): number => Math.round(v * 100) / 100;

/** Die Abschnitte der Liste (jeder Stand) oder die einer Linie in genau einem Stand. */
async function leseAbschnitte(
    database: Queryable,
    mapDomainId: string,
    linie?: { name: string; stand: PowerlineState },
): Promise<AbschnittRow[]> {
    const imStand =
        linie === undefined
            ? database``
            : linie.stand === "karte"
              ? database`AND p.is_active`
              : linie.stand === "abgenommen"
                ? database`AND NOT p.is_active AND p.off_map`
                : database`AND NOT p.is_active AND NOT p.off_map`;
    return database<AbschnittRow[]>`
        SELECT p.public_id::text AS public_id, p.name, p.from_public_id::text AS from_public_id, p.to_public_id::text AS to_public_id,
               p.curve, p.label_visible, p.revision::int AS revision, p.description, coalesce(s.wiki_url, w.wiki_url) AS wiki_url, s.name AS wiki_title,
               s.id::text AS snapshot_id, p.source_system,
               CASE WHEN p.is_active THEN 'karte' WHEN p.off_map THEN 'abgenommen' ELSE 'geloescht' END AS stand,
               ST_XMin(p.drawn_geom) AS x0, ST_YMin(p.drawn_geom) AS y0, ST_XMax(p.drawn_geom) AS x1, ST_YMax(p.drawn_geom) AS y1
          FROM powerline p
          LEFT JOIN powerline_wiki_assignment w ON w.powerline_id = p.id AND w.is_active
          LEFT JOIN wiki_powerline_snapshot s ON s.id = w.snapshot_id AND s.is_active
         WHERE p.map_domain_id = ${mapDomainId}
           ${imStand}
           ${linie === undefined ? database`` : database`AND p.name = ${linie.name}`}
         ORDER BY p.public_id
    `;
}

/** Die Knoten, auf die die Abschnitte zeigen: Ort, Label, Kraftlinienpunkt, Landmarke; was fehlt, fehlt hier auch. */
async function leseKnoten(database: Queryable, ids: readonly string[]): Promise<Map<string, KnotenRow>> {
    if (ids.length === 0) return new Map();
    const rows = await database<KnotenRow[]>`
        SELECT public_id::text AS id, 'place' AS kind, name, ST_X(geom) AS x, ST_Y(geom) AS y, is_nodix AS nodix
          FROM place WHERE is_active AND public_id = ANY(${ids as string[]}::uuid[])
        UNION ALL
        SELECT public_id::text, 'label', name, ST_X(geom), ST_Y(geom), coalesce(is_nodix, FALSE)
          FROM map_label WHERE is_active AND public_id = ANY(${ids as string[]}::uuid[])
        UNION ALL
        SELECT public_id::text, 'nodix', NULL, ST_X(geom), ST_Y(geom), TRUE
          FROM nodix WHERE is_active AND public_id = ANY(${ids as string[]}::uuid[])
        UNION ALL
        SELECT public_id::text, 'landmark', name, ST_X(geom), ST_Y(geom), 'nodix' = ANY (merkmale)
          FROM terrain_peak WHERE is_active AND public_id = ANY(${ids as string[]}::uuid[])
    `;
    return new Map(rows.map((r) => [r.id, r]));
}

function rahmenVon(abschnitte: readonly AbschnittRow[]): [number, number, number, number] | undefined {
    let rahmen: [number, number, number, number] | undefined;
    for (const a of abschnitte) {
        if (a.x0 === null || a.y0 === null || a.x1 === null || a.y1 === null) continue;
        rahmen = rahmen
            ? [
                  Math.min(rahmen[0], a.x0),
                  Math.min(rahmen[1], a.y0),
                  Math.max(rahmen[2], a.x1),
                  Math.max(rahmen[3], a.y1),
              ]
            : [a.x0, a.y0, a.x1, a.y1];
    }
    return rahmen?.map(rund) as [number, number, number, number] | undefined;
}

/** Die Felder, die Zeile und Detail teilen: Kreis, Gestalt, Artikel, Teilzuordnung, Enden, fehlende Knoten, Rahmen. */
function zusammenfassung(abschnitte: readonly AbschnittRow[], knoten: ReadonlyMap<string, KnotenRow>) {
    const lage = (id: string): readonly [number, number] | undefined => {
        const k = knoten.get(id);
        return k ? [k.x, k.y] : undefined;
    };
    const gestalt = kraftlinienGestalt(
        abschnitte.map((a) => ({ id: a.public_id, from: a.from_public_id, to: a.to_public_id })),
        lage,
    );
    const mitArtikel = abschnitte.filter((a) => a.wiki_url !== null);
    const artikel = mitArtikel.find((a) => a.wiki_title !== null) ?? mitArtikel[0];
    const knotenIds = new Set(abschnitte.flatMap((a) => [a.from_public_id, a.to_public_id]));
    const fehlen = [...knotenIds].filter((id) => !knoten.has(id)).length;
    const erstes = gestalt.kette[0];
    const letztes = gestalt.kette.at(-1);
    const nameVon = (glied: typeof erstes): string =>
        glied !== undefined && "knoten" in glied ? (knoten.get(glied.knoten)?.name ?? "") : "";
    const bounds = rahmenVon(abschnitte);
    const fremd = abschnitte.find((a) => a.source_system !== "legacy")?.source_system;
    return {
        circle: editorPowerlineCircle(
            abschnitte.every((a) => a.stand === "karte"),
            mitArtikel.length === abschnitte.length,
        ),
        shape: gestalt.shape,
        ...(artikel?.wiki_url
            ? { wiki: { url: artikel.wiki_url, ...(artikel.wiki_title !== null ? { title: artikel.wiki_title } : {}) } }
            : {}),
        teilzuordnung: mitArtikel.length > 0 && mitArtikel.length < abschnitte.length ? mitArtikel.length : undefined,
        ends: gestalt.shape === "strang" ? ([nameVon(erstes), nameVon(letztes)] as [string, string]) : undefined,
        knoten: knotenIds.size,
        fehlen,
        ...(bounds ? { bounds } : {}),
        ...(fremd !== undefined ? { source: fremd } : {}),
    };
}

export async function listEditorPowerlines(
    database: Queryable,
    mapDomainId = "aventuria",
): Promise<EditorPowerlineList> {
    const abschnitte = await leseAbschnitte(database, mapDomainId);
    const knoten = await leseKnoten(database, [
        ...new Set(abschnitte.flatMap((a) => [a.from_public_id, a.to_public_id])),
    ]);
    const gruppen = new Map<string, AbschnittRow[]>();
    for (const a of abschnitte) {
        const g = gruppeVon(a);
        const liste = gruppen.get(g);
        if (liste) liste.push(a);
        else gruppen.set(g, [a]);
    }
    const rows: EditorPowerlineRow[] = [...gruppen.values()].map((teile) => {
        const z = zusammenfassung(teile, knoten);
        return {
            id: (teile[0] as AbschnittRow).public_id,
            name: (teile[0] as AbschnittRow).name,
            circle: z.circle,
            shape: z.shape,
            segments: teile.length,
            nodes: z.knoten,
            ...(z.wiki ? { wiki: z.wiki } : {}),
            ...(z.teilzuordnung !== undefined ? { wikiSegments: z.teilzuordnung } : {}),
            ...(z.ends ? { ends: z.ends } : {}),
            ...(z.fehlen > 0 ? { missingNodes: z.fehlen } : {}),
            ...(z.bounds ? { bounds: z.bounds } : {}),
            ...(z.source !== undefined ? { source: z.source } : {}),
            ...((teile[0] as AbschnittRow).stand === "abgenommen" ? { offMap: true as const } : {}),
            ...((teile[0] as AbschnittRow).stand === "geloescht" ? { deleted: true as const } : {}),
        };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name, "de") || (a.id < b.id ? -1 : 1));
    return { rows };
}

/** Die Linie, zu der ein Abschnitt gehört, in seinem Stand (K10: auch abgenommen oder gelöscht); `undefined`, wenn es ihn nicht gibt. */
export async function readEditorPowerline(
    database: Queryable,
    publicId: string,
    mapDomainId = "aventuria",
): Promise<EditorPowerlineDetail | undefined> {
    const [anker] = await database<{ name: string; stand: PowerlineState }[]>`
        SELECT name, CASE WHEN p.is_active THEN 'karte' WHEN p.off_map THEN 'abgenommen' ELSE 'geloescht' END AS stand FROM powerline p
         WHERE public_id = ${publicId} AND map_domain_id = ${mapDomainId}
    `;
    if (anker === undefined) return undefined;
    const abschnitte =
        anker.name.trim() === ""
            ? (await leseAbschnitte(database, mapDomainId, anker)).filter((a) => a.public_id === publicId)
            : await leseAbschnitte(database, mapDomainId, anker);
    const ids = [...new Set(abschnitte.flatMap((a) => [a.from_public_id, a.to_public_id]))];
    const knoten = await leseKnoten(database, ids);
    // „trifft:“ - die anderen Linien (anderer Name), die an einem Knoten dieser Linie enden.
    const treffen = await database<{ knoten: string; name: string }[]>`
        SELECT DISTINCT k.knoten, p.name
          FROM unnest(${ids}::uuid[]) AS k(knoten)
          JOIN powerline p ON p.is_active AND p.map_domain_id = ${mapDomainId}
                          AND (p.from_public_id = k.knoten OR p.to_public_id = k.knoten)
         WHERE p.name <> ${anker.name}
         ORDER BY p.name
    `;
    const z = zusammenfassung(abschnitte, knoten);
    const nodes: EditorPowerlineNode[] = ids.map((id) => {
        const k = knoten.get(id);
        const meets = treffen.filter((t) => t.knoten === id).map((t) => t.name);
        if (k === undefined) return { id, kind: "missing", nodix: false, meets };
        return {
            id,
            kind: k.kind,
            ...(k.name !== null ? { name: k.name } : {}),
            x: k.x,
            y: k.y,
            nodix: k.nodix,
            meets,
        };
    });
    // Woher Name und Beschreibung je Abschnitt kommen (WI-0225, `field_origin`).
    const herkunft = await leseHerkunft(
        database,
        "powerline",
        abschnitte.map((a) => a.public_id),
    );
    // Die Beschreibung der Linie: die erste gesetzte ihrer Abschnitte (Legacy `fieldSample`).
    const beschreibung = abschnitte.find((a) => a.description !== null && a.description !== "")?.description;
    // Der Artikel der Linie mit seinen Werten (je LINIE wie Legacy): der des ersten Abschnitts, der einen aus dem Abzug trägt.
    const abzug = abschnitte.find((a) => a.snapshot_id !== null)?.snapshot_id;
    const [artikel] =
        abzug === undefined || abzug === null
            ? []
            : await database<ArtikelRow[]>`
                  SELECT wiki_key, wiki_url, name, description, staerke, affinitaet, laenge, regionen FROM wiki_powerline_snapshot
                   WHERE id = ${abzug}::bigint
              `;
    return {
        id: (abschnitte[0] as AbschnittRow).public_id,
        name: anker.name,
        circle: z.circle,
        shape: z.shape,
        ...(z.wiki ? { wiki: z.wiki } : {}),
        ...(beschreibung != null ? { description: beschreibung } : {}),
        segments: abschnitte.map((a) => ({
            id: a.public_id,
            from: a.from_public_id,
            to: a.to_public_id,
            curve: a.curve,
            labelVisible: a.label_visible,
            revision: a.revision,
            ...(a.description !== null && a.description !== "" ? { description: a.description } : {}),
            ...(a.wiki_url !== null
                ? { wiki: { url: a.wiki_url, ...(a.wiki_title !== null ? { title: a.wiki_title } : {}) } }
                : {}),
            ...(herkunft.has(a.public_id)
                ? { herkunft: { ...herkunft.get(a.public_id) } as Record<string, "wiki" | "manual"> }
                : {}),
        })),
        nodes,
        ...(z.bounds ? { bounds: z.bounds } : {}),
        ...(z.source !== undefined ? { source: z.source } : {}),
        ...(anker.stand !== "karte" ? { state: anker.stand } : {}),
        ...(artikel !== undefined ? { article: artikelVon(artikel) } : {}),
        ...(z.teilzuordnung !== undefined ? { articleSegments: z.teilzuordnung } : {}),
    };
}

interface ArtikelRow {
    wiki_key: string;
    wiki_url: string;
    name: string | null;
    description: string | null;
    staerke: string | null;
    affinitaet: string | null;
    laenge: string | null;
    regionen: string | null;
}

/**
 * Ein Artikel des Abzugs mit seinen Wiki-Werten; eine leere Spalte heißt „das Wiki kennt keinen Wert“ (`null`). `name` und
 * `description` vergleicht das Wiki-Feld mit den eigenen Feldern der Linie (WI-0225, ↺); Stärke, Affinität, Länge und Regionen führt
 * nur das Wiki.
 */
const artikelVon = (row: ArtikelRow): WikiArtikel => ({
    key: row.wiki_key,
    url: row.wiki_url,
    name: row.name ?? "",
    werte: {
        name: row.name,
        description: row.description,
        staerke: row.staerke,
        affinitaet: row.affinitaet,
        laenge: row.laenge,
        regionen: row.regionen,
    },
});

/**
 * Die Artikel der Kraftlinien für die Wiki-Zuordnung (`GET /api/editor/powerline-wiki`, WI-0205): alle aktiven des Abzugs mit Werten,
 * dazu der Name einer Linie auf der Karte, an der der Artikel schon hängt (Legacys „hängt an Linie X“), nach Namen.
 */
export async function readPowerlineWiki(database: Queryable, mapDomainId = "aventuria"): Promise<WikiTrefferListe> {
    const rows = await database<(ArtikelRow & { belegt: string | null })[]>`
        SELECT s.wiki_key, s.wiki_url, s.name, s.description, s.staerke, s.affinitaet, s.laenge, s.regionen,
               (SELECT min(p.name) FROM powerline_wiki_assignment w JOIN powerline p ON p.id = w.powerline_id
                 WHERE w.snapshot_id = s.id AND w.is_active AND p.is_active AND p.map_domain_id = ${mapDomainId}) AS belegt
          FROM wiki_powerline_snapshot s
         WHERE s.is_active
         ORDER BY s.name, s.wiki_key
    `;
    return {
        articles: rows.map((row) => ({ ...artikelVon(row), ...(row.belegt !== null ? { belegt: row.belegt } : {}) })),
    };
}
