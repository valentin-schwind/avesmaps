import {
    foldName,
    landscapeSearchHandlePattern,
    SEARCH_EINTRAG_GEGENDEN_JE_BEZIEHUNG,
    SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX,
    type SearchEintragGegend,
    type SearchEintragOrt,
    type SearchEintragWo,
    type SearchLeuchtAnfrage,
    type SearchLeuchten,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { bereinigeWiki } from "./vorkommen-index.ts";
import type { ZielKatalog } from "./ziele-katalog.ts";

/**
 * „Wo es vorkommt“ im Panel eines Eintrags (WI-0260): die Gegenden, die für den Eintrag leuchten, je Name und Art EINMAL, die genannten Orte und Gipfel und die Orte des Wikis ohne Kartenbezug als Text.
 *
 * 🔴 **Nichts wird neu gerechnet.** Was leuchtet, sagt `leuchte` (dieselbe Antwort, aus demselben Zwischenspeicher, die auch die Karte bekommt); hier werden nur die Namen und Arten der leuchtenden Flächen
 * nachgeschlagen, die Beziehung aus den Ortszeilen des Wikis gelesen und gleichnamige Flächen zu einer Gegend zusammengefasst. Die Zahl der Gegenden, die „Alle zeigen“ leuchten lässt, bleibt die des
 * Leuchtens; die Liste hier ist nur kürzer, wo sie gedeckelt ist (`weitere`).
 *
 * 🪤 **Eine Gegend ist ein Name, keine Fläche.** „Nebelmoor“ ist als Region, als Moor und als Tiefebene gezeichnet und leuchtet auf drei Ebenen; das Panel nennt eine Gegend. Die Art der Zeile ist die der obersten
 * Ebene (Region vor Topographie vor Vegetation). Ein Griff („Wald-003“) ist kein Name und steht nie da, wie in der Suche.
 */

const DOMAENE = "aventuria";
const GRIFF = landscapeSearchHandlePattern();

/** Die Ebene, deren Art die Zeile trägt, wenn ein Name auf mehreren liegt: kleiner gewinnt. */
const EBENE_RANG: Readonly<Record<string, number>> = { derographisch: 0, topographie: 1, vegetation: 2 };

const RELATION_RANG = { herkunft: 0, verbreitung: 1, regel: 2 } as const;

const sortiere = new Intl.Collator("de", { numeric: true });

/** Der Wiki-Schlüssel des Kontinents dieser Karte: Er ist keine „Nennung“, sondern die Aussage „überall“ (oder gar keine). */
const KONTINENT_NAME = "aventurien";

/** Eine Ortszeile des Eintrags mit EINEM ihrer Ziele (eine Zeile mit mehreren Zielen steht mehrfach, eine ohne Ziel einmal mit lauter `null`). */
export interface WoZeile {
    /** `lore_place.id`: gleich für alle Ziele einer Zeile. */
    readonly zeile: string;
    readonly relation: string;
    readonly keyClass: string;
    readonly titel: string | null;
    readonly schluessel: string;
    /** Die Ziele, die es auf der Karte gibt (aktiv, nicht verborgen) – `public_id` der Landschaft, des Gebiets, des Orts oder des Gipfels. */
    readonly regionId: string | null;
    readonly gebietId: string | null;
    readonly ortId: string | null;
    readonly gipfelId: string | null;
}

/**
 * Die Ortszeilen eines Eintrags in der Reihenfolge des Artikels, jede mit ihren Zielen. 🔴 Ein Ziel zählt nur, wo es auf der Karte steht: Ein stillgelegter oder verborgener Träger ist wie
 * kein Ziel (die Zeile ist dann „auch genannt“, nicht verschwunden).
 */
export async function ladeWoZeilen(database: Queryable, eintragPublicId: string): Promise<WoZeile[]> {
    const zeilen = await database<
        {
            zeile: string;
            relation: string;
            key_class: string;
            titel: string | null;
            schluessel: string;
            region_id: string | null;
            gebiet_id: string | null;
            ort_id: string | null;
            gipfel_id: string | null;
        }[]
    >`
        SELECT p.id::text AS zeile, p.relation, p.key_class, nullif(btrim(p.place_title), '') AS titel, p.place_wiki_key AS schluessel,
               r.public_id::text AS region_id, g.public_id::text AS gebiet_id, o.public_id::text AS ort_id, k.public_id::text AS gipfel_id
          FROM lore_entry e
          JOIN lore_place p ON p.lore_entry_id = e.id AND p.is_active AND p.state = 'active' AND (p.role IS NULL OR p.role = 'ort')
          LEFT JOIN lore_place_target t ON t.lore_place_id = p.id
          LEFT JOIN region r ON r.id = t.region_id AND r.is_active AND NOT r.is_hidden AND r.map_domain_id = ${DOMAENE}
          LEFT JOIN territory g ON g.id = t.territory_id AND g.is_active AND g.map_domain_id = ${DOMAENE}
          LEFT JOIN place o ON o.id = t.place_id AND o.is_active AND NOT o.is_hidden AND o.map_domain_id = ${DOMAENE}
          LEFT JOIN terrain_peak k ON k.id = t.terrain_peak_id AND k.is_active AND NOT 'verborgen' = ANY (k.merkmale) AND k.map_domain_id = ${DOMAENE}
         WHERE e.public_id = ${eintragPublicId}::uuid
         ORDER BY p.sort_order, p.id, t.id
    `;
    return zeilen.map((zeile) => ({
        zeile: zeile.zeile,
        relation: zeile.relation,
        keyClass: zeile.key_class,
        titel: zeile.titel,
        schluessel: zeile.schluessel,
        regionId: zeile.region_id,
        gebietId: zeile.gebiet_id,
        ortId: zeile.ort_id,
        gipfelId: zeile.gipfel_id,
    }));
}

/** Der Name eines Wiki-Schlüssels, wenn die Zeile keinen Titel trägt: ohne Namensraum, Bindestriche als Leerzeichen. */
export const ausSchluessel = (schluessel: string): string =>
    schluessel
        .replace(/^wiki:/iu, "")
        .replace(/-/gu, " ")
        .trim();

/** Der Name, unter dem das Wiki eine Ortszeile nennt, ohne Auszeichnung. */
export const zeilenName = (zeile: Pick<WoZeile, "titel" | "schluessel">): string =>
    bereinigeWiki(zeile.titel ?? ausSchluessel(zeile.schluessel));

/**
 * Die Beziehung je Ziel: `herkunft`, wo irgendeine Zeile den Eintrag von dort herleitet (Waren), sonst `verbreitung` (auch `vorkommen` und `regionen` der Spezies sagen, wo es lebt). Was nicht in einer Zeile
 * steht, hat keine Beziehung (`regel`).
 */
function beziehungen(zeilen: readonly WoZeile[]): Map<string, "verbreitung" | "herkunft"> {
    const karte = new Map<string, "verbreitung" | "herkunft">();
    for (const zeile of zeilen) {
        const neu = zeile.relation === "herkunft" ? "herkunft" : "verbreitung";
        for (const id of [zeile.regionId, zeile.gebietId, zeile.ortId, zeile.gipfelId]) {
            if (id === null) continue;
            if (karte.get(id) !== "herkunft") karte.set(id, neu);
        }
    }
    return karte;
}

interface Flaeche {
    readonly id: string;
    readonly name: string;
    readonly art: "landschaft" | "gebiet";
    readonly typ: string;
    readonly rang: number;
}

interface RegionZeile {
    id: string;
    name: string;
    typ: string | null;
    ebene: string;
}

interface GebietZeile {
    id: string;
    name: string;
    typ: string | null;
}

async function leseRegionen(database: Queryable, ids: readonly string[]): Promise<RegionZeile[]> {
    if (ids.length === 0) return [];
    return database<RegionZeile[]>`
        SELECT r.public_id::text AS id, btrim(r.name) AS name, r.region_type AS typ, r.region_layer AS ebene
          FROM region r
         WHERE r.public_id = ANY(${[...ids]}::uuid[]) AND r.is_active AND NOT r.is_hidden AND r.map_domain_id = ${DOMAENE}
           AND r.region_layer <> 'klima' AND r.region_type IS DISTINCT FROM 'kontinent'
           AND btrim(r.name) <> '' AND r.name !~* ${GRIFF}
    `;
}

async function leseGebiete(database: Queryable, ids: readonly string[]): Promise<GebietZeile[]> {
    if (ids.length === 0) return [];
    return database<GebietZeile[]>`
        SELECT t.public_id::text AS id, btrim(t.name) AS name, t.territory_type AS typ
          FROM territory t
         WHERE t.public_id = ANY(${[...ids]}::uuid[]) AND t.is_active AND t.map_domain_id = ${DOMAENE} AND btrim(t.name) <> ''
    `;
}

/** Die Namen und Arten der leuchtenden Landschaften und Gebiete, ohne Griffe, Klimabänder und den Kontinent. */
async function ladeFlaechen(
    database: Queryable,
    regionIds: readonly string[],
    gebietIds: readonly string[],
): Promise<Flaeche[]> {
    const [regionen, gebiete] = await Promise.all([
        leseRegionen(database, regionIds),
        leseGebiete(database, gebietIds),
    ]);
    return [
        ...regionen.map((zeile): Flaeche => ({
            id: zeile.id,
            name: zeile.name,
            art: "landschaft",
            typ: zeile.typ ?? "region",
            rang: EBENE_RANG[zeile.ebene] ?? 9,
        })),
        ...gebiete.map((zeile): Flaeche => ({
            id: zeile.id,
            name: zeile.name,
            art: "gebiet",
            typ: zeile.typ?.trim() || "Herrschaftsgebiet",
            rang: 0,
        })),
    ];
}

interface Gruppe {
    readonly art: "landschaft" | "gebiet";
    readonly flaechen: Flaeche[];
}

/**
 * Die Gegenden eines Eintrags: die leuchtenden Flächen, je Name und Art zu einer Gegend zusammengefasst, mit der Beziehung des Wikis und der Anfrage, die nur sie leuchten lässt.
 * 🔴 Gedeckelt wird je Beziehung (`deckel`, sonst `SEARCH_EINTRAG_GEGENDEN_JE_BEZIEHUNG`), bei den Regeln zugunsten der größten Gegenden; `weitere` zählt den Rest.
 */
async function gegenden(
    database: Queryable,
    eintragPublicId: string,
    leuchtet: Pick<SearchLeuchten, "ganz" | "angeschnitten" | "gebiete">,
    beziehung: ReadonlyMap<string, "verbreitung" | "herkunft">,
    katalog: ZielKatalog,
    deckel: number = SEARCH_EINTRAG_GEGENDEN_JE_BEZIEHUNG,
): Promise<{ gegenden: SearchEintragGegend[]; weitere: number }> {
    const regionIds = [...new Set([...leuchtet.ganz, ...leuchtet.angeschnitten.map((teil) => teil.publicId)])];
    const gebietIds = [
        ...new Set([...leuchtet.gebiete.ganz, ...leuchtet.gebiete.angeschnitten.map((teil) => teil.publicId)]),
    ];
    const flaechen = await ladeFlaechen(database, regionIds, gebietIds);

    const gruppen = new Map<string, Gruppe>();
    for (const flaeche of flaechen) {
        const schluessel = `${flaeche.art}:${flaeche.name.toLowerCase()}`;
        const gruppe = gruppen.get(schluessel);
        if (gruppe === undefined) gruppen.set(schluessel, { art: flaeche.art, flaechen: [flaeche] });
        else gruppe.flaechen.push(flaeche);
    }

    // Die Größe einer Gegend (für die Auswahl unter den Regeln): die der Gruppe im Katalog der Ziele, der im Prozess liegt.
    const groesse = new Map<string, number>();
    for (const ziel of katalog.landschaften) for (const id of ziel.publicIds) groesse.set(id, ziel.flaeche);
    for (const ziel of katalog.gebiete) groesse.set(ziel.publicId, ziel.flaeche);

    interface Kandidat {
        readonly gegend: SearchEintragGegend;
        readonly flaeche: number;
    }
    const kandidaten: Kandidat[] = [];
    for (const [schluessel, gruppe] of gruppen) {
        // Die oberste Ebene gibt Namen und Art; bei gleicher Ebene entscheidet die Kennung, damit die Antwort stabil bleibt.
        const glieder = [...gruppe.flaechen].sort((a, b) => a.rang - b.rang || a.id.localeCompare(b.id));
        const erste = glieder[0] as Flaeche;
        const relation = glieder.some((glied) => beziehung.get(glied.id) === "herkunft")
            ? "herkunft"
            : glieder.some((glied) => beziehung.has(glied.id))
              ? "verbreitung"
              : "regel";
        const flaeche = Math.max(...glieder.map((glied) => groesse.get(glied.id) ?? 0));
        const ziel =
            gruppe.art === "landschaft"
                ? {
                      eintrag: eintragPublicId,
                      landschaften: glieder.map((glied) => glied.id).slice(0, SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX),
                  }
                : {
                      eintrag: eintragPublicId,
                      // Mehrere Gebiete gleichen Namens sind selten; das größte steht für die Gegend (die Anfrage nimmt EIN Gebiet).
                      gebiet: [...glieder].sort((a, b) => (groesse.get(b.id) ?? 0) - (groesse.get(a.id) ?? 0))[0]!.id,
                  };
        kandidaten.push({
            gegend: { key: schluessel, name: erste.name, kind: gruppe.art, typ: erste.typ, relation, ziel },
            flaeche,
        });
    }

    const gewaehlt: SearchEintragGegend[] = [];
    for (const relation of ["herkunft", "verbreitung", "regel"] as const) {
        const dieser = kandidaten.filter((kandidat) => kandidat.gegend.relation === relation);
        // Unter den Regeln (oft Hunderte) die größten Gegenden; sonst nach Name. Gezeigt wird danach immer nach Name.
        dieser.sort(
            (a, b) =>
                (relation === "regel" ? b.flaeche - a.flaeche : 0) || sortiere.compare(a.gegend.name, b.gegend.name),
        );
        gewaehlt.push(...dieser.slice(0, deckel).map((kandidat) => kandidat.gegend));
    }
    gewaehlt.sort(
        (a, b) =>
            RELATION_RANG[a.relation] - RELATION_RANG[b.relation] ||
            sortiere.compare(a.name, b.name) ||
            a.key.localeCompare(b.key),
    );
    return { gegenden: gewaehlt, weitere: kandidaten.length - gewaehlt.length };
}

/** Die genannten Orte und Gipfel, die auf der Karte stehen, mit ihrer Beziehung und der Klasse (bei Gipfeln die Art: Berggipfel, Vulkan). */
async function orte(
    database: Queryable,
    leuchtet: SearchLeuchten,
    beziehung: ReadonlyMap<string, "verbreitung" | "herkunft">,
): Promise<SearchEintragOrt[]> {
    const gipfelIds = leuchtet.orte.filter((ort) => ort.art === "gipfel").map((ort) => ort.id);
    const arten =
        gipfelIds.length === 0
            ? []
            : await database<{ id: string; art: string | null }[]>`
                  SELECT k.public_id::text AS id, k.subtype AS art FROM terrain_peak k WHERE k.public_id = ANY(${gipfelIds}::uuid[])
              `;
    const gipfelArt = new Map(arten.map((zeile) => [zeile.id, zeile.art ?? "berggipfel"]));
    return leuchtet.orte.map((ort): SearchEintragOrt =>
        ort.art === "gipfel"
            ? {
                  ref: { kind: "peak", id: ort.id },
                  name: ort.name,
                  klasse: gipfelArt.get(ort.id) ?? "berggipfel",
                  relation: beziehung.get(ort.id) ?? "verbreitung",
              }
            : {
                  ref: { kind: "place", id: ort.id },
                  name: ort.name,
                  klasse: ort.art,
                  relation: beziehung.get(ort.id) ?? "verbreitung",
              },
    );
}

/**
 * Die Orte des Wikis, die nirgends auf der Karte stehen: unaufgelöst, verborgen, auf einem anderen Kontinent. Der Kontinent dieser Karte ist keine Nennung, sondern die Aussage „überall“ (`nurKontinent`).
 * Als Text, einmal je Name, in der Reihenfolge des Artikels.
 */
function auchGenannt(zeilen: readonly WoZeile[]): string[] {
    const mitZiel = new Set(
        zeilen
            .filter((zeile) => [zeile.regionId, zeile.gebietId, zeile.ortId, zeile.gipfelId].some((id) => id !== null))
            .map((zeile) => zeile.zeile),
    );
    const texte: string[] = [];
    for (const zeile of zeilen) {
        if (mitZiel.has(zeile.zeile)) continue;
        const text = zeilenName(zeile);
        if (text === "" || texte.includes(text)) continue;
        if (zeile.keyClass === "continent" && foldName(text) === KONTINENT_NAME) continue;
        texte.push(text);
    }
    return texte;
}

/** „Wo es vorkommt“ eines Eintrags aus seinen Ortszeilen, dem Leuchten und dem Katalog der Ziele. */
export async function baueWo(
    database: Queryable,
    eintragPublicId: string,
    zeilen: readonly WoZeile[],
    leuchtet: SearchLeuchten,
    katalog: ZielKatalog,
): Promise<SearchEintragWo> {
    const beziehung = beziehungen(zeilen);
    const [gegend, ortsliste] = await Promise.all([
        gegenden(database, eintragPublicId, leuchtet, beziehung, katalog),
        orte(database, leuchtet, beziehung),
    ]);
    return {
        gegenden: gegend.gegenden,
        orte: ortsliste,
        auchGenannt: auchGenannt(zeilen),
        ...(gegend.weitere > 0 ? { weitere: gegend.weitere } : {}),
    };
}

/**
 * Die Gegenden eines Eintrags, die eine Route kreuzt (WI-0257 S5, Vali 2026-10-31: „nur die gegenden anzeigen …, die von der route durchkreuzt werden“): dieselben Gegenden wie „Wo es
 * vorkommt“, gebildet nur aus den leuchtenden Flächen, die die Route berührt (`beruehrt`, `public_id`), ohne Deckel. `alle` lässt alle diese Flächen leuchten, auch die ohne Namen, die keine
 * Gegend sind: die Landschaften in Anfragen zu höchstens `SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX`, jedes Gebiet für sich (eine Anfrage schneidet Landschaften mit EINEM Gebiet, statt sie zu vereinigen).
 */
export async function gegendenAnDerRoute(
    database: Queryable,
    eintragPublicId: string,
    zeilen: readonly WoZeile[],
    leuchtet: SearchLeuchten,
    katalog: ZielKatalog,
    beruehrt: { readonly landschaften: ReadonlySet<string>; readonly gebiete: ReadonlySet<string> },
): Promise<{ gegenden: SearchEintragGegend[]; alle: SearchLeuchtAnfrage[] }> {
    const land = (id: string): boolean => beruehrt.landschaften.has(id);
    const gebiet = (id: string): boolean => beruehrt.gebiete.has(id);
    const teil = {
        ganz: leuchtet.ganz.filter(land),
        angeschnitten: leuchtet.angeschnitten.filter((form) => land(form.publicId)),
        gebiete: {
            ganz: leuchtet.gebiete.ganz.filter(gebiet),
            angeschnitten: leuchtet.gebiete.angeschnitten.filter((form) => gebiet(form.publicId)),
        },
    };
    const { gegenden: liste } = await gegenden(
        database,
        eintragPublicId,
        teil,
        beziehungen(zeilen),
        katalog,
        Number.POSITIVE_INFINITY,
    );
    const landschaften = [...new Set([...teil.ganz, ...teil.angeschnitten.map((form) => form.publicId)])].sort();
    const gebiete = [
        ...new Set([...teil.gebiete.ganz, ...teil.gebiete.angeschnitten.map((form) => form.publicId)]),
    ].sort();
    const alle: SearchLeuchtAnfrage[] = [];
    for (let at = 0; at < landschaften.length; at += SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX)
        alle.push({
            eintrag: eintragPublicId,
            landschaften: landschaften.slice(at, at + SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX),
        });
    for (const id of gebiete) alle.push({ eintrag: eintragPublicId, gebiet: id });
    return { gegenden: liste, alle };
}
