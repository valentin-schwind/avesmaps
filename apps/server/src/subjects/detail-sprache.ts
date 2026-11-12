import { huelleDerHauptteile, type FlaechenTeil } from "./haupt-huelle.ts";
import {
    SPRACH_TREFFER_ABSCHNITT_LIMIT,
    SPRACH_TREFFER_LISTE_LIMIT,
    SUBJECT_LIMITS,
    landscapeReaderName,
    pathChainKey,
    renderZoomForBand,
    type SprachArtikel,
    type SprachHerkunft,
    type SprachTrefferArt,
    type SprachTrefferEintrag,
    type SprachTrefferListe,
    type SubjectDetail,
    type SubjectSprachTrefferSection,
    type SubjectFact,
    type SubjectFactLink,
    type SubjectSubtitlePart,
} from "@avesmaps3d/shared";
import { withStatementTimeout, type Database, type Queryable } from "../database.ts";
import { dialekteVon } from "../sprachen/dialekte.ts";
import { sprachenMindestanteil } from "../sprachen/treffer.ts";
import { spracheAdresse } from "../wiki/abgleich/sprachen.ts";
import { wikiSchluesselFuerTitel } from "../wiki/schluessel.ts";
import { textFact, wikiLine, wikiProvenance } from "./facts.ts";
import { canonicalAreaRef, territoryChain, type SubjectIndex } from "./subject-index.ts";
import { lookupWikiKey } from "./wiki-key-lookup.ts";

/**
 * Das Subject „Sprache“ (WI-0261 S5b; Bauvorlage: die Probierseite vom 2026-10-30, `app.js` Zustand 2 „Infobox“, `inhalt.js`): eine Sprache der Karte, ein Eintrag je
 * Kartengruppe (O1). Gelesen wird nur, nichts wird geschrieben.
 *
 * - **Kopf:** Name der Sprache (`sprache.name`), Art „Sprache“ bei höchstens einem Wiki-Artikel, „Sprachgruppe“ bei mehreren (O1: Thorwalsch, Gjalskisch und Fjarningsch
 *   sind eine Gruppe der Karte), dahinter die Sprachfamilie.
 * - **Felder** aus dem Wiki-Stand des ERSTEN zugeordneten Artikels (`sprache_wiki` Stelle 0 → `wiki_sprache_artikel`, 0255): Kurzbeschreibung, Sprachfamilie, Vorstufen,
 *   Schrift, Sprecheranzahl, Offizielle Sprache (mit Verweisen auf Gebiete, wo der Artikel ein Linkziel nennt, das genau ein Objekt der Karte trägt), Weitere Verbreitung.
 *   Die übrigen Artikel stehen im Quellenkasten (`sprache.artikel`). Ohne Zuordnung: nur Name, Fläche und Treffer (O1 „platziert, ohne Wiki-Artikel“).
 * - **Dialekte** (abgeleitet, keine eigene Zuordnung, O1): aktive Sprachartikel des Wikis, die KEINER aktiven Sprache zugeordnet sind und eine Navigationsleiste
 *   der Sprachfamilie mit dem ersten Artikel teilen (`navigation`, etwa „Nav Sprachfamilie Garethi“). Begründung: Die Leisten fassen eine Familie zusammen; was in ihr
 *   steht und keine eigene Fläche hat, geht in der Gruppe der Karte auf (O3: Horathi, Alberned, Brabaci → Garethi). Eine zugeordnete Sprache derselben Familie ist
 *   kein Dialekt, ebenso wenig eine Vorstufe, die der erste Artikel selbst nennt (Bosparano ist Vorstufe des Garethi, nicht seine Mundart).
 * - **Treffer** (S4, O4 „nur Zahlen, aufklappbar“) ab dem Mindestanteil der Karteneinstellungen: je Art die Zahl und die ersten `SPRACH_TREFFER_LISTE_LIMIT` Einträge
 *   als Verweise. Gezählt wird, was das Panel als Gegenstand kennt: Herrschaftsgebiete (die obersten zuerst), Regionen der Derographie als Landschaft (gleichnamige
 *   Regionen sind EINE, WI-0047; die übrigen Ebenen tragen Treffer für ihre eigene Zeile „Sprachen“, sind aber keine „Regionen“), sichtbare Orte (die größten zuerst,
 *   wie die Suche) und Wege als Straße ihres Namens (WI-0177; ein namenloser Abschnitt zählt einzeln und steht nicht in der Liste).
 * - **Ziel der Kamera** (Bauvorlage `karte.js` `hauptBBox`): die Hülle der größten Teilflächen, die zusammen 85 % der Fläche tragen; ferne Inseln und Splitter ziehen
 *   die Kamera nicht weg.
 */

const SPRACHE_ZOOM = renderZoomForBand(3);
/** Der Anteil der Fläche, den die Hülle des Kameraziels mindestens trägt (Bauvorlage `hauptBBox`). */
export const SPRACHE_HAUPTANTEIL = 0.85;

interface SpracheRow {
    id: string;
    public_id: string;
    schluessel: string;
    name: string;
    farbe: string;
}

interface TeilRow {
    herkunft: string;
    flaeche: number;
    min_x: number;
    min_y: number;
    max_x: number;
    max_y: number;
}

interface ArtikelRow {
    id: string;
    titel: string;
    name: string | null;
    sprachfamilie: string | null;
    vorstufen: string | null;
    schrift: string | null;
    sprecheranzahl: string | null;
    offizielle_sprache: string | null;
    offizielle_sprache_roh: string | null;
    weitere_verbreitung: string | null;
    kurzbeschreibung: string | null;
    navigation: string[];
    updated_at: Date;
}

/** Eine Teilfläche für das Kameraziel: Fläche und Hülle in Kartenkoordinaten. */
export type SprachTeil = FlaechenTeil;

/** Die Hülle der größten Teilflächen, die zusammen mindestens `anteil` der Fläche tragen (Bauvorlage `hauptBBox`); `null` ohne Teilfläche. */
export function hauptHuelle(
    teile: readonly SprachTeil[],
    anteil: number = SPRACHE_HAUPTANTEIL,
): [number, number, number, number] | null {
    return huelleDerHauptteile(teile, anteil);
}

/** Die Wiki-Links eines rohen Listenfelds: `[[Ziel]]` und `[[Ziel|Text]]`, der Text, wie er im bereinigten Feld steht. Sprungmarken gehören nicht zum Ziel. */
export function wikiLinksVon(roh: string): { ziel: string; text: string }[] {
    const links: { ziel: string; text: string }[] = [];
    for (const treffer of roh.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/gu)) {
        const ziel = (treffer[1] ?? "").trim();
        const text = (treffer[2] ?? treffer[1] ?? "").trim();
        if (ziel !== "" && text !== "") links.push({ ziel, text });
    }
    return links;
}

/**
 * Die Verweise im bereinigten Text eines Felds: je Link des rohen Felds, dessen Ziel über den Wiki-Key genau EIN Objekt der Karte trägt (dieselbe Schleuse wie jeder
 * Objektlink, WI-0063 27.12; nie über den Namen). Die Stelle wird von links gesucht; ein Text, der im bereinigten Feld nicht (mehr) steht, bleibt ohne Verweis.
 */
export function feldVerweise(
    index: Pick<SubjectIndex, "wikiKeys">,
    wert: string,
    roh: string | null,
): SubjectFactLink[] {
    if (roh === null) return [];
    const verweise: SubjectFactLink[] = [];
    let ab = 0;
    for (const link of wikiLinksVon(roh)) {
        const at = wert.indexOf(link.text, ab);
        if (at === -1) continue;
        ab = at + link.text.length;
        const schluessel = wikiSchluesselFuerTitel(link.ziel);
        if (schluessel === "") continue;
        const treffer = lookupWikiKey(index.wikiKeys, schluessel);
        if (treffer.kind === "one") verweise.push({ text: link.text, ref: treffer.ref, at });
    }
    return verweise;
}

/** Ein Text, der im Wiki nicht leer ist; sonst `null`. */
const text = (wert: string | null | undefined): string | null => {
    const sauber = (wert ?? "").trim();
    return sauber === "" ? null : sauber;
};

interface TrefferZeile {
    id: string;
    anteil: number;
}

/** Welche Arten ein Lauf liest und wie viele Einträge je Liste: die Infobox alle Arten mit den ersten Einträgen, der Abschnitt EINE Art ganz. */
interface TrefferUmfang {
    arten: readonly SprachTrefferArt[];
    limit: number;
}

const INFOBOX_UMFANG: TrefferUmfang = {
    arten: ["territory", "region", "place", "path"],
    limit: SPRACH_TREFFER_LISTE_LIMIT,
};

/** Eine Liste aus allen Einträgen: die Zahl und die ersten `limit`; `null` ohne Eintrag. */
function liste(
    art: SprachTrefferListe["art"],
    anzahl: number,
    eintraege: readonly SprachTrefferEintrag[],
    limit: number,
): { art: SprachTrefferArt; anzahl: number; eintraege: SprachTrefferEintrag[] } | null {
    return anzahl <= 0 ? null : { art, anzahl, eintraege: eintraege.slice(0, limit) };
}

const nachName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, "de");

/** Die Treffer einer Sprache je Art (siehe Kopf), in der Reihenfolge der Infobox; nur die Arten des Umfangs, je Liste höchstens `limit` Einträge. */
async function trefferVon(
    tx: Queryable,
    index: SubjectIndex,
    spracheId: string,
    mindestanteil: number,
    umfang: TrefferUmfang = INFOBOX_UMFANG,
): Promise<{ art: SprachTrefferArt; anzahl: number; eintraege: SprachTrefferEintrag[] }[]> {
    const { arten, limit } = umfang;
    const flaechen = async (art: "territory" | "region"): Promise<TrefferZeile[]> =>
        !arten.includes(art)
            ? []
            : tx<TrefferZeile[]>`
        SELECT t.objekt_public_id::text AS id, t.anteil
          FROM sprache_treffer t
         WHERE t.sprache_id = ${spracheId}::bigint AND t.objekt_art = ${art}
           AND t.anteil >= ${mindestanteil}::double precision
    `;

    // Herrschaftsgebiete: die obersten zuerst (das Reich vor der Baronie), dann der größere Anteil, dann der Name.
    const gebiete = (await flaechen("territory")).flatMap((zeile) => {
        const record = index.territories.byPublicId.get(zeile.id);
        if (!record) return [];
        const tiefe = territoryChain(index.territories, record.id).length;
        return [
            {
                ref: { kind: "territory" as const, id: record.publicId },
                name: record.name,
                anteil: zeile.anteil,
                tiefe,
            },
        ];
    });
    gebiete.sort((a, b) => a.tiefe - b.tiefe || b.anteil - a.anteil || nachName(a, b));

    // Regionen der Derographie, gleichnamige als eine; der größte Anteil eines Mitglieds steht für die Gruppe.
    const regionen = new Map<string, { eintrag: SprachTrefferEintrag | null; anteil: number }>();
    for (const zeile of await flaechen("region")) {
        const record = index.regions.byPublicId.get(zeile.id);
        if (!record || record.layer !== "derographisch") continue;
        const bekannt = regionen.get(record.groupKey);
        if (bekannt !== undefined && bekannt.anteil >= zeile.anteil) continue;
        const name = landscapeReaderName(record.name, record.type);
        const ref = canonicalAreaRef(index.regions, record.publicId);
        regionen.set(record.groupKey, {
            eintrag: name === null || ref === null ? null : { ref, name, anteil: zeile.anteil },
            anteil: zeile.anteil,
        });
    }
    const regionListe = [...regionen.values()]
        .flatMap((wert) => (wert.eintrag === null ? [] : [wert.eintrag]))
        .sort((a, b) => (b.anteil ?? 0) - (a.anteil ?? 0) || nachName(a, b));

    // Orte: jeder, den die Fläche enthält, außer verborgenen (sie stehen in keiner Liste anderer Objekte, WI-0080); die Klassenordnung der Suche (WI-0007).
    const orte = !arten.includes("place")
        ? []
        : await tx<{ id: string; name: string; anzahl: number }[]>`
        SELECT p.public_id::text AS id, p.name, count(*) OVER ()::int AS anzahl
          FROM sprache_treffer t
          JOIN place p ON p.public_id = t.objekt_public_id AND p.is_active AND NOT COALESCE(p.is_hidden, FALSE)
          LEFT JOIN label_class_rank r ON r.scope = 'place' AND r.class_key = p.subtype
         WHERE t.sprache_id = ${spracheId}::bigint AND t.objekt_art = 'place' AND btrim(p.name) <> ''
         ORDER BY COALESCE(r.rank, 50), lower(p.name), p.public_id
         LIMIT ${limit}
    `;

    // Wege als Straße ihres Namens (WI-0177 Schritt 2b), die längste gedeckte Strecke zuerst; ein namenloser Abschnitt zählt für sich.
    const abschnitte = !arten.includes("path")
        ? []
        : await tx<(TrefferZeile & { laenge: number })[]>`
        SELECT t.objekt_public_id::text AS id, t.anteil, COALESCE(ST_Length(p.geom), 0)::double precision AS laenge
          FROM sprache_treffer t
          JOIN path p ON p.public_id = t.objekt_public_id AND p.is_active
         WHERE t.sprache_id = ${spracheId}::bigint AND t.objekt_art = 'path'
           AND t.anteil >= ${mindestanteil}::double precision
    `;
    const strassen = new Map<string, number>();
    let namenlos = 0;
    for (const zeile of abschnitte) {
        const name = index.paths.segments.get(zeile.id)?.name.trim() ?? "";
        if (name === "") {
            namenlos += 1;
            continue;
        }
        strassen.set(name, (strassen.get(name) ?? 0) + zeile.anteil * zeile.laenge);
    }
    const wege = [...strassen.entries()]
        .sort(([nameA, a], [nameB, b]) => b - a || nameA.localeCompare(nameB, "de"))
        .map(([name]): SprachTrefferEintrag => ({ ref: { kind: "path", chain: pathChainKey(name) }, name }));

    return [
        liste(
            "territory",
            gebiete.length,
            gebiete.map(({ ref, name, anteil }) => ({ ref, name, anteil })),
            limit,
        ),
        liste("region", regionen.size, regionListe, limit),
        liste(
            "place",
            orte[0]?.anzahl ?? 0,
            orte.map((ort) => ({ ref: { kind: "place" as const, id: ort.id }, name: ort.name })),
            limit,
        ),
        liste("path", strassen.size + namenlos, wege, limit),
    ].flatMap((eintrag) => (eintrag === null ? [] : [eintrag]));
}

/**
 * Alle Treffer EINER Art (`SubjectSprachTrefferSection`): dieselbe Rechnung wie die Liste der Infobox, nur ohne deren Schranke. `null`, wenn es die Sprache nicht
 * (aktiv) gibt; eine Art ohne Treffer antwortet mit `anzahl: 0` und leerer Liste.
 */
export async function spracheTrefferAbschnitt(
    database: Database,
    index: SubjectIndex,
    publicId: string,
    art: SprachTrefferArt,
): Promise<SubjectSprachTrefferSection | null> {
    // Vor der Transaktion, wie `spracheDetail`: Der Leser der Karteneinstellungen fängt eine fehlende Tafel ab.
    const mindestanteil = await sprachenMindestanteil(database);
    return withStatementTimeout(database, SUBJECT_LIMITS.statementMs, async (tx) => {
        const [sprache] = await tx<{ id: string; public_id: string }[]>`
            SELECT s.id::text AS id, s.public_id::text AS public_id FROM sprache s
             WHERE s.public_id = ${publicId}::uuid AND s.is_active
        `;
        if (!sprache) return null;
        const [gefunden] = await trefferVon(tx, index, sprache.id, mindestanteil, {
            arten: [art],
            limit: SPRACH_TREFFER_ABSCHNITT_LIMIT,
        });
        return {
            subject: { kind: "sprache", id: sprache.public_id },
            revision: index.revision,
            art,
            anzahl: gefunden?.anzahl ?? 0,
            eintraege: gefunden?.eintraege ?? [],
        };
    });
}

const herkunftVon = (wert: string): SprachHerkunft => (wert === "sprachenkarte" ? "sprachenkarte" : "redaktion");

/** Die Infobox einer Sprache; `null`, wenn es sie nicht gibt oder sie stillgelegt ist. */
export async function spracheDetail(
    database: Database,
    index: SubjectIndex,
    publicId: string,
): Promise<SubjectDetail | null> {
    // Vor der Transaktion: Der Leser der Karteneinstellungen fängt eine fehlende Tafel ab, und das bräche eine laufende Transaktion ab.
    const mindestanteil = await sprachenMindestanteil(database);
    const loaded = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, async (tx) => {
        const [sprache] = await tx<SpracheRow[]>`
            SELECT s.id::text AS id, s.public_id::text AS public_id, s.schluessel, s.name, s.farbe
              FROM sprache s
             WHERE s.public_id = ${publicId}::uuid AND s.is_active
        `;
        if (!sprache) return null;
        const teile = await tx<TeilRow[]>`
            SELECT a.herkunft, ST_Area(a.geom)::double precision AS flaeche,
                   ST_XMin(a.geom) AS min_x, ST_YMin(a.geom) AS min_y, ST_XMax(a.geom) AS max_x, ST_YMax(a.geom) AS max_y
              FROM sprache_flaeche a
             WHERE a.sprache_id = ${sprache.id}::bigint AND a.is_active
        `;
        const artikel = await tx<ArtikelRow[]>`
            SELECT w.id::text AS id, w.titel, w.name, w.sprachfamilie, w.vorstufen, w.schrift, w.sprecheranzahl,
                   w.offizielle_sprache, w.offizielle_sprache_roh, w.weitere_verbreitung, w.kurzbeschreibung,
                   w.navigation, w.updated_at
              FROM sprache_wiki z
              JOIN wiki_sprache_artikel w ON w.id = z.wiki_sprache_artikel_id AND w.is_active
             WHERE z.sprache_id = ${sprache.id}::bigint AND z.is_active
             ORDER BY z.position, z.id
        `;
        const [erster] = artikel;
        return {
            sprache,
            teile,
            artikel,
            dialekte: erster === undefined ? [] : await dialekteVon(tx, erster),
            treffer: await trefferVon(tx, index, sprache.id, mindestanteil),
        };
    });
    if (!loaded) return null;
    const { sprache, teile, artikel, dialekte, treffer } = loaded;
    const [erster] = artikel;

    const url = erster === undefined ? null : spracheAdresse(erster.titel);
    const wert = (value: string | null | undefined) =>
        text(value) === null ? null : { value: text(value) ?? "", provenance: wikiProvenance(url, erster?.updated_at) };
    const amtssprache = text(erster?.offizielle_sprache);
    const facts: SubjectFact[] =
        erster === undefined
            ? []
            : [
                  ...textFact("description", wert(erster.kurzbeschreibung)),
                  ...textFact("sprachfamilie", wert(erster.sprachfamilie)),
                  ...textFact("vorstufen", wert(erster.vorstufen)),
                  ...textFact("schrift", wert(erster.schrift)),
                  ...(dialekte.length === 0
                      ? []
                      : [
                            {
                                field: "dialekte" as const,
                                values: dialekte,
                                provenance: wikiProvenance(url, erster.updated_at),
                            },
                        ]),
                  ...textFact("sprecheranzahl", wert(erster.sprecheranzahl)),
                  ...textFact("amtssprache", wert(amtssprache), {
                      links:
                          amtssprache === null ? [] : feldVerweise(index, amtssprache, erster.offizielle_sprache_roh),
                  }),
                  ...textFact("weitereVerbreitung", wert(erster.weitere_verbreitung)),
              ];
    const familie = text(erster?.sprachfamilie);
    const subtitle: SubjectSubtitlePart[] = [
        { part: "type", key: artikel.length > 1 ? "sprachgruppe" : "sprache" },
        ...(familie === null ? [] : [{ part: "kind" as const, text: familie }]),
    ];
    const artikelListe: SprachArtikel[] = artikel.map((zeile) => ({
        titel: text(zeile.name) ?? zeile.titel,
        url: spracheAdresse(zeile.titel),
    }));
    const herkunft = [...new Set(teile.map((teil) => herkunftVon(teil.herkunft)))].sort();
    const huelle = hauptHuelle(
        teile.map((teil) => ({
            flaeche: teil.flaeche,
            bbox: [teil.min_x, teil.min_y, teil.max_x, teil.max_y] as const,
        })),
    );
    const wiki = erster === undefined ? undefined : wikiLine(index, url, text(erster.name) ?? erster.titel);
    return {
        subject: { kind: "sprache", id: sprache.public_id },
        revision: index.revision,
        title: sprache.name,
        subtitle,
        ...(facts.length === 0 ? {} : { facts }),
        ...(wiki === undefined ? {} : { wiki }),
        ...(huelle === null
            ? {}
            : {
                  target: {
                      x: (huelle[0] + huelle[2]) / 2,
                      y: (huelle[1] + huelle[3]) / 2,
                      zoom: SPRACHE_ZOOM,
                      bounds: huelle,
                  },
              }),
        sprache: {
            schluessel: sprache.schluessel,
            farbe: sprache.farbe,
            artikel: artikelListe,
            treffer,
            gegenden: teile.length,
            herkunft,
        },
    };
}
