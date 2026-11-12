import type {
    SpracheEditorArtikel,
    SpracheEditorArtikelAnfrage,
    SpracheEditorDetail,
    SpracheEditorFlaecheForm,
    SpracheEditorListe,
    SpracheEditorSpracheZeile,
    SpracheEditorZustand,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { likeMuster } from "../db/like-muster.ts";
import { listEditorLocks } from "../editor/editor-lock.ts";
import { polygoneVon } from "../editor/ring-form.ts";
import { SPRACHE_TREFFER_JOB_KIND } from "./treffer-auftrag.ts";
import { sprachenMindestanteil, trefferDerSprache } from "./treffer.ts";

/**
 * Lesen für den Spracheditor (WI-0261 S5d; Vertrag `packages/shared/src/sprachen-editor.ts`): die Liste mit den vier Zuständen, eine Sprache mit Pillen,
 * Teilflächen, Treffern, Überlappungen und Sperre, die Form einer Teilfläche und die Artikelsuche fürs Zuordnen. Nur lesend; die öffentlichen Leser
 * (`lesen.ts`, `GET /api/sprachen`) bleiben, wie sie sind.
 *
 * - **Die vier Zustände** (Bauvorlage): je Sprache aus „hat Wiki-Artikel“ und „hat eine aktive Teilfläche“; ein aktiver Wiki-Artikel, der keiner Sprache gehört,
 *   steht als eigene Zeile „nur im Wiki, nicht platziert“ da (O1). Stillgelegte Sprachen nur auf Wunsch und in keinem Zustand gezählt.
 * - **Flächen** in Karteneinheiten² (SRID 0) auf zwei Stellen, wie die Kachelsicht und `lesen.ts`; Teilflächen verschiedener Sprachen überlappen (E2), jede
 *   Sprache zählt für sich.
 * - **Treffer** nach dem Mindestanteil der Karteneinstellungen (`treffer.ts`), dazu ihr Stand: Wartet ein Auftrag, der die Sprache rechnet, sind die Zahlen alt.
 * - **Überlappungen** kommen aus den Mischgebieten (`sprache_misch`, abgeleitet vom Auftrag `sprache_treffer`), nicht aus einer eigenen Rechnung.
 */

const zustandVon = (wiki: boolean, platziert: boolean): SpracheEditorZustand =>
    wiki ? (platziert ? "platziert_wiki" : "nur_wiki") : platziert ? "platziert_ohne_wiki" : "leer";

const herkunft = (wert: string): "sprachenkarte" | "redaktion" =>
    wert === "sprachenkarte" ? "sprachenkarte" : "redaktion";

interface SpracheListenZeile {
    id: string;
    schluessel: string;
    name: string;
    legende: string | null;
    farbe: string;
    reihenfolge: number;
    herkunft: string;
    revision: number;
    aktiv: boolean;
    teilflaechen: number;
    flaeche: number;
    wiki_artikel: number;
    erster: string | null;
}

/** Die Liste: Sprachen nach Legende und Name, danach die freien Artikel nach Titel; mit den Zahlen je Zustand. */
export async function leseSprachEditorListe(
    database: Queryable,
    optionen: { stillgelegt?: boolean | undefined } = {},
): Promise<SpracheEditorListe> {
    const sprachen = await database<SpracheListenZeile[]>`
        SELECT s.public_id::text AS id, s.schluessel, s.name, s.legende, s.farbe, s.reihenfolge, s.herkunft, s.revision::int AS revision,
               s.is_active AS aktiv, f.anzahl::int AS teilflaechen, COALESCE(f.flaeche, 0)::double precision AS flaeche,
               w.anzahl::int AS wiki_artikel, w.erster
          FROM sprache s
          LEFT JOIN LATERAL (
                SELECT count(*) AS anzahl, round(sum(ST_Area(a.geom))::numeric, 2) AS flaeche
                  FROM sprache_flaeche a WHERE a.sprache_id = s.id AND a.is_active
          ) f ON TRUE
          LEFT JOIN LATERAL (
                SELECT count(*) AS anzahl, (array_agg(t.titel ORDER BY z.position, z.id))[1] AS erster
                  FROM sprache_wiki z JOIN wiki_sprache_artikel t ON t.id = z.wiki_sprache_artikel_id
                 WHERE z.sprache_id = s.id AND z.is_active
          ) w ON TRUE
         WHERE s.is_active OR ${optionen.stillgelegt === true}
         ORDER BY s.reihenfolge, lower(s.name), s.id
    `;
    const frei = await database<
        {
            id: string;
            titel: string;
            name: string | null;
            kurzbeschreibung: string | null;
            sprachfamilie: string | null;
        }[]
    >`
        SELECT a.public_id::text AS id, a.titel, a.name, a.kurzbeschreibung, a.sprachfamilie
          FROM wiki_sprache_artikel a
         WHERE a.is_active
           AND NOT EXISTS (SELECT 1 FROM sprache_wiki z WHERE z.wiki_sprache_artikel_id = a.id AND z.is_active)
         ORDER BY lower(a.titel), a.id
    `;
    const zahlen = { platziertWiki: 0, nurWiki: frei.length, platziertOhneWiki: 0, leer: 0 };
    const zeilen: SpracheEditorListe["zeilen"] = sprachen.map((zeile): SpracheEditorSpracheZeile => {
        const zustand = zustandVon(zeile.wiki_artikel > 0, zeile.teilflaechen > 0);
        if (zeile.aktiv) {
            if (zustand === "platziert_wiki") zahlen.platziertWiki += 1;
            else if (zustand === "nur_wiki") zahlen.nurWiki += 1;
            else if (zustand === "platziert_ohne_wiki") zahlen.platziertOhneWiki += 1;
            else zahlen.leer += 1;
        }
        return {
            art: "sprache",
            id: zeile.id,
            schluessel: zeile.schluessel,
            name: zeile.name,
            legende: zeile.legende,
            farbe: zeile.farbe,
            reihenfolge: zeile.reihenfolge,
            herkunft: herkunft(zeile.herkunft),
            revision: zeile.revision,
            aktiv: zeile.aktiv,
            teilflaechen: zeile.teilflaechen,
            flaeche: zeile.flaeche,
            wikiArtikel: zeile.wiki_artikel,
            ersterArtikel: zeile.erster,
            zustand,
        };
    });
    for (const artikel of frei) zeilen.push({ art: "artikel", ...artikel, zustand: "nur_wiki" });
    return { zeilen, zahlen };
}

interface TeilRow {
    id: string;
    herkunft: string;
    quelle_revision: string | null;
    revision: number;
    flaeche: number;
    min_x: number;
    min_y: number;
    max_x: number;
    max_y: number;
    stuetzpunkte: number;
    loecher: number;
}

/** Eine Sprache für den Spracheditor, auch stillgelegt; `undefined`, wenn es sie nicht gibt. `run`: der Lauf des Fensters, für `sperre.own`. */
export async function leseSprachEditorDetail(
    database: Queryable,
    publicId: string,
    run?: string,
): Promise<SpracheEditorDetail | undefined> {
    const [sprache] = await database<
        {
            row_id: string;
            schluessel: string;
            name: string;
            legende: string | null;
            farbe: string;
            reihenfolge: number;
            herkunft: string;
            revision: number;
            aktiv: boolean;
        }[]
    >`
        SELECT id::text AS row_id, schluessel, name, legende, farbe, reihenfolge, herkunft, revision::int AS revision, is_active AS aktiv
          FROM sprache WHERE public_id = ${publicId}::uuid
    `;
    if (sprache === undefined) return undefined;
    const pillen = await database<
        {
            id: string;
            titel: string;
            name: string | null;
            kurzbeschreibung: string | null;
            sprachfamilie: string | null;
            vorstufen: string | null;
            schrift: string | null;
            im_wiki: boolean;
            herkunft: string;
        }[]
    >`
        SELECT a.public_id::text AS id, a.titel, a.name, a.kurzbeschreibung, a.sprachfamilie, a.vorstufen, a.schrift, a.is_active AS im_wiki,
               z.herkunft
          FROM sprache_wiki z JOIN wiki_sprache_artikel a ON a.id = z.wiki_sprache_artikel_id
         WHERE z.sprache_id = ${sprache.row_id}::bigint AND z.is_active
         ORDER BY z.position, z.id
    `;
    const teile = await database<TeilRow[]>`
        SELECT f.public_id::text AS id, f.herkunft, f.quelle_revision, f.revision::int AS revision,
               round(ST_Area(f.geom)::numeric, 2)::double precision AS flaeche,
               ST_XMin(f.geom) AS min_x, ST_YMin(f.geom) AS min_y, ST_XMax(f.geom) AS max_x, ST_YMax(f.geom) AS max_y,
               ST_NPoints(f.geom)::int AS stuetzpunkte,
               (SELECT COALESCE(sum(ST_NumInteriorRings(d.geom)), 0) FROM ST_Dump(f.geom) d)::int AS loecher
          FROM sprache_flaeche f
         WHERE f.sprache_id = ${sprache.row_id}::bigint AND f.is_active
         ORDER BY ST_Area(f.geom) DESC, f.public_id
    `;
    const summe = teile.reduce((gesamt, teil) => gesamt + teil.flaeche, 0);
    const mindestanteil = await sprachenMindestanteil(database);
    const zahlen = (sprache.aktiv ? await trefferDerSprache(database, sprache.schluessel, mindestanteil) : null) ?? {
        orte: 0,
        gebiete: 0,
        regionen: 0,
        wege: 0,
    };
    const [stand] = await database<{ berechnet_at: Date | null; ausstehend: boolean }[]>`
        SELECT (SELECT max(t.berechnet_at) FROM sprache_treffer t WHERE t.sprache_id = ${sprache.row_id}::bigint) AS berechnet_at,
               EXISTS (
                   SELECT 1 FROM job j
                    WHERE j.kind = ${SPRACHE_TREFFER_JOB_KIND} AND j.state IN ('QUEUED', 'RUNNING')
                      AND (j.input_ref -> 'alle' = 'true'::jsonb OR j.input_ref -> 'sprachen' ? ${publicId})
               ) AS ausstehend
    `;
    const ueber = await database<{ id: string; schluessel: string; name: string; farbe: string; flaeche: number }[]>`
        SELECT o.public_id::text AS id, o.schluessel, o.name, o.farbe,
               round(sum(ST_Area(m.geom))::numeric, 2)::double precision AS flaeche
          FROM sprache_misch m
          JOIN sprache o ON o.id = CASE WHEN m.sprache_a_id = ${sprache.row_id}::bigint THEN m.sprache_b_id ELSE m.sprache_a_id END
         WHERE (m.sprache_a_id = ${sprache.row_id}::bigint OR m.sprache_b_id = ${sprache.row_id}::bigint) AND o.is_active
         GROUP BY o.id
         ORDER BY flaeche DESC, o.id
    `;
    const sperre = (await listEditorLocks(database, "sprache", run)).find((eine) => eine.id === publicId) ?? null;
    return {
        id: publicId,
        schluessel: sprache.schluessel,
        name: sprache.name,
        legende: sprache.legende,
        farbe: sprache.farbe,
        reihenfolge: sprache.reihenfolge,
        herkunft: herkunft(sprache.herkunft),
        revision: sprache.revision,
        aktiv: sprache.aktiv,
        flaeche: Math.round(summe * 100) / 100,
        wiki: pillen.map((pille) => ({
            id: pille.id,
            titel: pille.titel,
            name: pille.name,
            kurzbeschreibung: pille.kurzbeschreibung,
            sprachfamilie: pille.sprachfamilie,
            vorstufen: pille.vorstufen,
            schrift: pille.schrift,
            imWiki: pille.im_wiki,
            herkunft: pille.herkunft === "import" ? "import" : "redaktion",
        })),
        teilflaechen: teile.map((teil) => ({
            id: teil.id,
            herkunft: herkunft(teil.herkunft),
            quelleRevision: teil.quelle_revision,
            revision: teil.revision,
            flaeche: teil.flaeche,
            bbox: [teil.min_x, teil.min_y, teil.max_x, teil.max_y],
            stuetzpunkte: teil.stuetzpunkte,
            loecher: teil.loecher,
        })),
        treffer: {
            ...zahlen,
            berechnetAt: stand?.berechnet_at?.toISOString() ?? null,
            ausstehend: stand?.ausstehend === true,
        },
        ueberlappungen: ueber.map((zeile) => ({
            ...zeile,
            anteil: summe > 0 ? Math.min(1, Math.round((zeile.flaeche / summe) * 10_000) / 10_000) : 0,
        })),
        sperre,
    };
}

/** Die Form einer Teilfläche dieser Sprache (auch stillgelegt), eckig wie gespeichert; `undefined`, wenn sie nicht zu ihr gehört. */
export async function leseSprachflaecheForm(
    database: Queryable,
    spracheId: string,
    flaecheId: string,
): Promise<SpracheEditorFlaecheForm | undefined> {
    const [zeile] = await database<
        { revision: number; herkunft: string; quelle_revision: string | null; aktiv: boolean; geojson: string }[]
    >`
        SELECT f.revision::int AS revision, f.herkunft, f.quelle_revision, f.is_active AS aktiv, ST_AsGeoJSON(f.geom, 15) AS geojson
          FROM sprache_flaeche f JOIN sprache s ON s.id = f.sprache_id
         WHERE f.public_id = ${flaecheId}::uuid AND s.public_id = ${spracheId}::uuid
    `;
    if (zeile === undefined) return undefined;
    return {
        id: flaecheId,
        sprache: spracheId,
        revision: zeile.revision,
        herkunft: herkunft(zeile.herkunft),
        quelleRevision: zeile.quelle_revision,
        aktiv: zeile.aktiv,
        polygons: polygoneVon(zeile.geojson).map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x, y]))),
    };
}

/**
 * Aktive Wiki-Artikel für das Zuordnen, mit dem heutigen Besitzer: Titel oder Name enthält `q` (ohne Groß und Klein), Titel, die damit beginnen, zuerst.
 * `frei`: nur Artikel ohne Sprache.
 */
export async function sucheSprachArtikel(
    database: Queryable,
    anfrage: SpracheEditorArtikelAnfrage,
): Promise<{ artikel: SpracheEditorArtikel[] }> {
    const text = (anfrage.q ?? "").trim();
    const muster = text === "" ? null : likeMuster(text);
    const anfang = text === "" ? null : `${likeMuster(text).slice(1)}`;
    const zeilen = await database<
        {
            id: string;
            titel: string;
            name: string | null;
            kurzbeschreibung: string | null;
            sprachfamilie: string | null;
            besitzer_id: string | null;
            besitzer_schluessel: string | null;
            besitzer_name: string | null;
            besitzer_aktiv: boolean | null;
        }[]
    >`
        SELECT a.public_id::text AS id, a.titel, a.name, a.kurzbeschreibung, a.sprachfamilie,
               s.public_id::text AS besitzer_id, s.schluessel AS besitzer_schluessel, s.name AS besitzer_name, s.is_active AS besitzer_aktiv
          FROM wiki_sprache_artikel a
          LEFT JOIN sprache_wiki z ON z.wiki_sprache_artikel_id = a.id AND z.is_active
          LEFT JOIN sprache s ON s.id = z.sprache_id
         WHERE a.is_active
           AND (${muster}::text IS NULL OR a.titel ILIKE ${muster} ESCAPE '\\' OR a.name ILIKE ${muster} ESCAPE '\\')
           AND (${anfrage.frei !== true} OR z.id IS NULL)
         ORDER BY (${anfang}::text IS NOT NULL AND a.titel ILIKE ${anfang} ESCAPE '\\') DESC, lower(a.titel), a.id
         LIMIT ${anfrage.limit ?? 8}
    `;
    return {
        artikel: zeilen.map((zeile) => ({
            id: zeile.id,
            titel: zeile.titel,
            name: zeile.name,
            kurzbeschreibung: zeile.kurzbeschreibung,
            sprachfamilie: zeile.sprachfamilie,
            besitzer:
                zeile.besitzer_id === null
                    ? null
                    : {
                          id: zeile.besitzer_id,
                          schluessel: zeile.besitzer_schluessel ?? "",
                          name: zeile.besitzer_name ?? "",
                          aktiv: zeile.besitzer_aktiv === true,
                      },
        })),
    };
}
