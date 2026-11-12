import {
    landscapeTypeNameDe,
    LORE_READING,
    WIKISYNC_LANDSCHAFTSARTEN,
    type InhalteVorkommenArt,
    type SearchLeuchtAnfrage,
    type SearchLeuchten,
    type SearchLeuchtenForm,
    type SearchLeuchtenOrt,
    type VorkommenForm,
    type VorkommenRahmen,
    type VorkommenRegelTreffer,
    type VorkommenZusatzRahmen,
} from "@avesmaps3d/shared";
import { createHash } from "node:crypto";
import type { Queryable } from "../database.ts";
import { maskeAlsAbfrage, rechneRegel, trefferDesEintrags } from "./karte.ts";
import { REPARIERT } from "./regel-sql.ts";
import { ermittleKartenstand, type Regel } from "./regeln.ts";
import { Zwischenspeicher } from "./speicher.ts";
import { KEIN_ERSATZ, ortszeileErsetzt, ortszeilenErsatz } from "./punkte.ts";

/**
 * Das Leuchten eines Suchtreffers (WI-0257, S3a): was für ein Vorkommen oder eine Landschaftsart, auf Wunsch zugeschnitten auf einen Rahmen, auf der Karte leuchtet. Richtung A der
 * Auswertung (`karte.ts`) für die Regeln, dazu die Ortszeilen des Eintrags – KOMBINIERT GENAU WIE IM PANEL:
 *
 * - **Beides gilt (Vereinigung).** Wo eine Regel derselben Beziehung denselben Ort genauer fasst als eine Ortszeile („Steppe in Bornland“ statt „Bornland“), gilt nur die Regel (F2,
 *   `LORE_READING.ortszeileHinterRegel`, `ortszeileErsetzt`); alle anderen Ortszeilen gelten weiter. Entschieden wird je ZEILE, wie `entriesAt` im Panel.
 * - **Die Kontinentzeile** („Aventurien“) leuchtet nicht gefüllt (D5: „ganz aventurien wird markiert, es sei denn weitere orte werden genannt“; F1): Nennt der Eintrag weitere Orte oder hat
 *   er eine Regel, die etwas trifft, zählt sie nicht. Bleibt nur sie übrig, ist `nurKontinent` gesetzt und die Oberfläche zeigt den Kontinent als Umriss. Mit einem Rahmen leuchtet
 *   stattdessen der Rahmen selbst (was überall vorkommt, kommt auch dort vor).
 * - **Genannte Orte** sind die Orte und Gipfel der Ortszeilen, als Punkte; Siedlungen, in die eine Regel fällt, nie (sonst stünden Hunderte Ringe auf der Karte).
 * - **Ganz oder angeschnitten:** ganze Gegenden nur als Kennung (Kachelfilter), angeschnittene als zugeschnittene Form. Ein Rahmen schneidet Regeln, Landschaften und Gebiete der Ortszeilen
 *   zu und lässt Orte außerhalb weg.
 *
 * Eine Landschaftsart („Wald in Kosch“) ist eine Kette mit EINER Bedingung (Art, keine Fläche) und braucht einen Rahmen; sie hat weder Ortszeilen noch Schalter.
 *
 * 🔴 **Die Inhaltsschalter je Art gelten** (`panel.lore.<art>`): Eine ausgeblendete Art antwortet leer mit `pausiert`, auch ohne ihren Namen.
 * 🪤 Die Antwort kommt aus dem Zwischenspeicher (je Anfrage und Kartenstand); der Kartenstand zählt seit S3a auch die Ortszeilen. Nichts davon in der Datenbank.
 */

const DOMAENE = "aventuria";
/** Die Kontinentbegriffe dieser Karte (wie `CONTINENT_KEYS_OF_DOMAIN` im Panel, `subjects/sections/lore.ts`). */
const KONTINENT_SCHLUESSEL = ["aventurien"];
const VEREINFACHUNG = "0.2";
const STAUB = "1e-6";
const GANZ_AB = "(1 - 1e-6)";
const NULL_UUID = "00000000-0000-4000-8000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Bis zu 300 Antworten oder 64 MB; die schwerste (alle Wälder) wiegt wenige Hundert Kilobyte. */
const speicher = new Zwischenspeicher<SearchLeuchten>(300, 64 * 1024 * 1024);
const unterwegs = new Map<string, Promise<SearchLeuchten | undefined>>();

/** Leert den Zwischenspeicher (Tests, Eingriffe an der Datenbank). */
export function leereLeuchtenSpeicher(): void {
    speicher.leere();
    unterwegs.clear();
    kontexte.clear();
}

// ---------------------------------------------------------------------------------------------------------------------
// Die Landschaftsarten
// ---------------------------------------------------------------------------------------------------------------------

export interface Landschaftsart {
    /** Der Schlüssel der Art (`wald`), eindeutig über alle Ebenen. */
    readonly art: string;
    /** `ebene|art` wie in den Bedingungen der Regeln. */
    readonly schluessel: string;
    /** Der deutsche Name („Wald“). */
    readonly name: string;
}

/** Die 33 Landschaftsarten (`WIKISYNC_LANDSCHAFTSARTEN`) mit ihrem deutschen Namen. */
export const LANDSCHAFTSARTEN: readonly Landschaftsart[] = WIKISYNC_LANDSCHAFTSARTEN.map(({ ebene, art }) => ({
    art,
    schluessel: `${ebene}|${art}`,
    name: landscapeTypeNameDe(art) ?? art,
}));

/** Die Landschaftsart zu einem Schlüssel (`wald`), oder `undefined`. */
export const landschaftsartVon = (art: string): Landschaftsart | undefined =>
    LANDSCHAFTSARTEN.find((eintrag) => eintrag.art === art);

// ---------------------------------------------------------------------------------------------------------------------
// Kleine Helfer für Rahmen und Formen
// ---------------------------------------------------------------------------------------------------------------------

const vereinige = (a: VorkommenRahmen | null, b: VorkommenRahmen | null): VorkommenRahmen | null =>
    a === null
        ? b
        : b === null
          ? a
          : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };

/** Die Polygone einer GeoJSON-Form (Text aus PostGIS oder schon eine Form). */
function polygoneVon(form: string | VorkommenForm | null | undefined): unknown[] {
    if (form === null || form === undefined) return [];
    const geo = typeof form === "string" ? (JSON.parse(form) as VorkommenForm) : form;
    if (geo.type === "Polygon") return geo.coordinates.length === 0 ? [] : [geo.coordinates];
    if (geo.type === "MultiPolygon") return geo.coordinates;
    return [];
}

function formAus(polygone: readonly unknown[]): VorkommenForm | undefined {
    if (polygone.length === 0) return undefined;
    if (polygone.length === 1) return { type: "Polygon", coordinates: polygone[0] as unknown[] };
    return { type: "MultiPolygon", coordinates: [...polygone] };
}

/** Eine Gegend, die leuchtet: ganz oder mit den Polygonen ihres leuchtenden Teils. */
interface Teil {
    name: string;
    ganz: boolean;
    polygone: unknown[];
    rahmen: VorkommenRahmen;
}

/** Sammelt, was leuchtet: je Gegend ein Teil (ganz gewinnt, Zuschnitte werden zusammengelegt), dazu Rest, Orte und der gemeinsame Rahmen. */
class Sammler {
    readonly landschaften = new Map<string, Teil>();
    readonly gebiete = new Map<string, Teil>();
    readonly orte = new Map<string, SearchLeuchtenOrt>();
    restPolygone: unknown[] = [];
    restRahmen: VorkommenRahmen | null = null;
    rahmen: VorkommenRahmen | null = null;

    fuegeTeil(
        ziel: Map<string, Teil>,
        publicId: string,
        name: string,
        ganz: boolean,
        polygone: readonly unknown[],
        rahmen: VorkommenRahmen,
    ): void {
        const da = ziel.get(publicId);
        if (da === undefined) {
            ziel.set(publicId, { name, ganz, polygone: ganz ? [] : [...polygone], rahmen });
        } else {
            da.rahmen = vereinige(da.rahmen, rahmen) as VorkommenRahmen;
            if (ganz) {
                da.ganz = true;
                da.polygone = [];
            } else if (!da.ganz) {
                da.polygone.push(...polygone);
            }
        }
        this.rahmen = vereinige(this.rahmen, rahmen);
    }

    fuegeRegelTreffer(treffer: VorkommenRegelTreffer): void {
        for (const landschaft of treffer.landschaften) {
            this.fuegeTeil(
                this.landschaften,
                landschaft.publicId,
                landschaft.name,
                landschaft.schnitt === "ganz",
                polygoneVon(landschaft.form),
                landschaft.rahmen,
            );
        }
        if (treffer.rest !== undefined) {
            this.restPolygone.push(...polygoneVon(treffer.rest.form));
            this.restRahmen = vereinige(this.restRahmen, treffer.rest.rahmen);
            this.rahmen = vereinige(this.rahmen, treffer.rest.rahmen);
        }
    }

    fuegeOrt(ort: SearchLeuchtenOrt): void {
        if (this.orte.has(ort.id)) return;
        this.orte.set(ort.id, ort);
        this.rahmen = vereinige(this.rahmen, { x0: ort.x, y0: ort.y, x1: ort.x, y1: ort.y });
    }

    /** Ob etwas leuchtet (Gegenden, Rest oder Orte). */
    get leer(): boolean {
        return this.landschaften.size + this.gebiete.size + this.orte.size === 0 && this.restPolygone.length === 0;
    }
}

const alsForm = (publicId: string, teil: Teil): SearchLeuchtenForm | undefined => {
    const form = formAus(teil.polygone);
    return form === undefined ? undefined : { publicId, name: teil.name, form, rahmen: teil.rahmen };
};

/** Ganze und angeschnittene Teile einer Karte von Gegenden, nach Name geordnet. */
function teileListen(teile: Map<string, Teil>): { ganz: string[]; angeschnitten: SearchLeuchtenForm[] } {
    const eintraege = [...teile].sort(([ka, a], [kb, b]) => a.name.localeCompare(b.name, "de") || ka.localeCompare(kb));
    const ganz: string[] = [];
    const angeschnitten: SearchLeuchtenForm[] = [];
    for (const [publicId, teil] of eintraege) {
        if (teil.ganz) ganz.push(publicId);
        else {
            // Ein Zuschnitt, den die Vereinfachung ganz verschluckt, ist kein sichtbarer Treffer.
            const form = alsForm(publicId, teil);
            if (form !== undefined) angeschnitten.push(form);
        }
    }
    return { ganz, angeschnitten };
}

// ---------------------------------------------------------------------------------------------------------------------
// Der Rahmen: Namen und Orte auflösen
// ---------------------------------------------------------------------------------------------------------------------

interface AufgeloesterRahmen {
    /** Der Rahmen für die Rechnung; `undefined`, wo die Anfrage keinen nennt. */
    rahmen: VorkommenZusatzRahmen | undefined;
    /** Der Teil des Titels hinter dem Begriff („in Bornland“); leer ohne Rahmen. */
    titel: string;
}

const RICHTUNGSWORT = { nord: "nördlich von", sued: "südlich von", ost: "östlich von", west: "westlich von" } as const;

/**
 * Löst den Rahmen der Anfrage auf: Namen und Orte der Kennungen nachschlagen. `undefined`, wo ein genanntes Ziel nicht (mehr) da ist oder die Angaben nicht zusammenpassen
 * (eine Lage ohne Ort, `zwischen` mit nicht zwei Orten).
 */
async function loeseRahmenAuf(
    database: Queryable,
    anfrage: SearchLeuchtAnfrage,
): Promise<AufgeloesterRahmen | undefined> {
    const rahmen: VorkommenZusatzRahmen = {};
    const titel: string[] = [];
    let hat = false;
    if (anfrage.landschaften !== undefined) {
        const zeilen = await database<{ public_id: string; name: string }[]>`
            SELECT r.public_id::text AS public_id, btrim(r.name) AS name FROM region r
             WHERE r.public_id = ANY(${[...anfrage.landschaften]}::uuid[]) AND r.is_active AND NOT r.is_hidden AND r.map_domain_id = ${DOMAENE}
             ORDER BY r.id
        `;
        const erste = zeilen[0];
        if (erste === undefined) return undefined;
        rahmen.regionIds = zeilen.map((zeile) => zeile.public_id);
        titel.push(`in ${erste.name}`);
        hat = true;
    }
    if (anfrage.gebiet !== undefined) {
        const [zeile] = await database<{ id: string; name: string }[]>`
            SELECT t.id::text AS id, btrim(t.name) AS name FROM territory t
             WHERE t.public_id = ${anfrage.gebiet}::uuid AND t.is_active AND t.map_domain_id = ${DOMAENE}
               AND EXISTS (SELECT 1 FROM territory_shape s WHERE s.territory_id = t.id)
        `;
        if (zeile === undefined) return undefined;
        rahmen.territoryId = Number(zeile.id);
        titel.push(`in ${zeile.name}`);
        hat = true;
    }
    if (anfrage.lage !== undefined) {
        const ids = anfrage.orte ?? [];
        const erwartet = anfrage.lage === "zwischen" ? 2 : 1;
        if (ids.length !== erwartet) return undefined;
        const zeilen = await database<{ public_id: string; name: string; x: number; y: number }[]>`
            SELECT p.public_id::text AS public_id, p.name, ST_X(p.geom)::float8 AS x, ST_Y(p.geom)::float8 AS y FROM place p
             WHERE p.public_id = ANY(${[...ids]}::uuid[]) AND p.is_active AND NOT p.is_hidden AND p.map_domain_id = ${DOMAENE}
        `;
        const nachId = new Map(zeilen.map((zeile) => [zeile.public_id, zeile]));
        const orte = ids.map((id) => nachId.get(id));
        const a = orte[0];
        const b = orte[1];
        if (a === undefined) return undefined;
        if (anfrage.lage === "zwischen") {
            if (b === undefined) return undefined;
            rahmen.zwischen = { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
            titel.push(`zwischen ${a.name} und ${b.name}`);
        } else {
            rahmen.lage = { richtung: anfrage.lage, ort: { x: a.x, y: a.y } };
            titel.push(`${RICHTUNGSWORT[anfrage.lage]} ${a.name}`);
        }
        hat = true;
    } else if (anfrage.orte !== undefined) {
        // Orte ohne Lage sagen nichts.
        return undefined;
    }
    return { rahmen: hat ? rahmen : undefined, titel: titel.join(" ") };
}

// ---------------------------------------------------------------------------------------------------------------------
// Flächen und Punkte, auf den Rahmen zugeschnitten
// ---------------------------------------------------------------------------------------------------------------------

interface FlaechenZeile {
    pid: string;
    name: string;
    ganz: boolean;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    form: string | null;
}

/** Aus welcher Tafel die Flächen kommen: eine feste Wahl, nie eine Eingabe (der Name geht in den Text). */
const FLAECHEN = {
    region: {
        /** Der Ausschnitt aller aktiven Flächen der Landschaft (ohne Rahmen genügt er; die Vereinigung wird nicht gebraucht). */
        ausschnitt: `SELECT r.public_id::text AS pid, btrim(r.name) AS name, TRUE AS ganz,
                   ST_XMin(x.e)::float8 AS x0, ST_YMin(x.e)::float8 AS y0, ST_XMax(x.e)::float8 AS x1, ST_YMax(x.e)::float8 AS y1, NULL::text AS form
              FROM region r
              JOIN LATERAL (SELECT ST_Extent(a.geom) AS e FROM region_area a WHERE a.region_id = r.id AND a.is_active) x ON x.e IS NOT NULL
             WHERE r.id = ANY($1::bigint[]) AND r.is_active AND NOT r.is_hidden AND r.map_domain_id = $2::text
             ORDER BY 2, 1`,
        /** Die Vereinigung der (reparierten) Flächen je Landschaft. */
        vereinigt: `SELECT r.public_id::text AS pid, btrim(r.name) AS name, ST_UnaryUnion(ST_Collect(${REPARIERT("a.geom")})) AS g
              FROM region r JOIN region_area a ON a.region_id = r.id AND a.is_active
             WHERE r.id = ANY($1::bigint[]) AND r.is_active AND NOT r.is_hidden AND r.map_domain_id = $2::text
             GROUP BY r.id, r.public_id, r.name`,
    },
    territory: {
        ausschnitt: `SELECT t.public_id::text AS pid, btrim(t.name) AS name, TRUE AS ganz,
                   ST_XMin(x.e)::float8 AS x0, ST_YMin(x.e)::float8 AS y0, ST_XMax(x.e)::float8 AS x1, ST_YMax(x.e)::float8 AS y1, NULL::text AS form
              FROM territory t
              JOIN LATERAL (SELECT ST_Extent(s.geom) AS e FROM territory_shape s
                             WHERE s.territory_id = t.id AND s.band = (SELECT max(b.band) FROM territory_shape b WHERE b.territory_id = t.id)) x ON x.e IS NOT NULL
             WHERE t.id = ANY($1::bigint[]) AND t.is_active AND t.map_domain_id = $2::text
             ORDER BY 2, 1`,
        vereinigt: `SELECT t.public_id::text AS pid, btrim(t.name) AS name, ST_UnaryUnion(ST_Collect(ST_MakeValid(s.geom))) AS g
              FROM territory t
              JOIN territory_shape s ON s.territory_id = t.id AND s.band = (SELECT max(b.band) FROM territory_shape b WHERE b.territory_id = t.id)
             WHERE t.id = ANY($1::bigint[]) AND t.is_active AND t.map_domain_id = $2::text
             GROUP BY t.id, t.public_id, t.name`,
    },
} as const;

/**
 * Die Flächen einer Tafel (Landschaften oder Gebiete) als Gegenden, zugeschnitten auf die Maske. Ohne Maske ist jede ganz; mit ihr entscheidet der Schnitt: leer (fällt weg),
 * so gut wie die ganze Fläche (ganz) oder ein Teil (mit Form, vereinfacht).
 */
async function schneideFlaechen(
    database: Queryable,
    tafel: keyof typeof FLAECHEN,
    ids: readonly string[],
    rahmen: VorkommenZusatzRahmen | undefined,
): Promise<FlaechenZeile[]> {
    if (ids.length === 0) return [];
    const bau = FLAECHEN[tafel];
    const maske = maskeAlsAbfrage(rahmen, 3);
    if (maske === undefined) return database.unsafe<FlaechenZeile[]>(bau.ausschnitt, [[...ids], DOMAENE] as never[]);
    // $1 und $2 sind die Kennungen und die Karte; die Maske hat die Parameter ab 3.
    const text = `WITH m AS (${maske.sql}),
        u AS (${bau.vereinigt}),
        s AS (SELECT u.pid, u.name, u.g, ST_CollectionExtract(ST_Intersection(u.g, m.g), 3) AS i FROM u CROSS JOIN m WHERE m.g IS NOT NULL AND u.g IS NOT NULL),
        z AS (SELECT s.pid, s.name, s.g, s.i FROM s WHERE NOT ST_IsEmpty(s.i) AND ST_Area(s.i) >= ${STAUB})
        SELECT z.pid, z.name, ST_Area(z.i) >= ST_Area(z.g) * ${GANZ_AB} AS ganz,
               ST_XMin(z.i)::float8 AS x0, ST_YMin(z.i)::float8 AS y0, ST_XMax(z.i)::float8 AS x1, ST_YMax(z.i)::float8 AS y1,
               CASE WHEN ST_Area(z.i) >= ST_Area(z.g) * ${GANZ_AB} THEN NULL
                    ELSE ST_AsGeoJSON(ST_SimplifyPreserveTopology(z.i, ${VEREINFACHUNG}), 1) END AS form
          FROM z ORDER BY z.name, z.pid`;
    return database.unsafe<FlaechenZeile[]>(text, [[...ids], DOMAENE, ...maske.params] as never[]);
}

/** Genannte Orte oder Gipfel, auf die Maske beschränkt (außerhalb fällt weg). */
async function ladeOrte(
    database: Queryable,
    tafel: "place" | "terrain_peak",
    ids: readonly string[],
    rahmen: VorkommenZusatzRahmen | undefined,
): Promise<SearchLeuchtenOrt[]> {
    if (ids.length === 0) return [];
    const maske = maskeAlsAbfrage(rahmen, 3);
    const art = tafel === "place" ? "p.subtype" : "'gipfel'";
    const sperre = tafel === "place" ? "AND NOT p.is_hidden" : "";
    const text = `${maske === undefined ? "" : `WITH m AS (${maske.sql}) `}
        SELECT p.public_id::text AS id, p.name, ${art} AS art, ST_X(p.geom)::float8 AS x, ST_Y(p.geom)::float8 AS y
          FROM ${tafel} p ${maske === undefined ? "" : "CROSS JOIN m"}
         WHERE p.id = ANY($1::bigint[]) AND p.is_active ${sperre} AND p.map_domain_id = $2::text
           ${maske === undefined ? "" : "AND m.g IS NOT NULL AND ST_Covers(m.g, p.geom)"}
         ORDER BY p.name, p.public_id`;
    const zeilen = await database.unsafe<SearchLeuchtenOrt[]>(text, [
        [...ids],
        DOMAENE,
        ...(maske?.params ?? []),
    ] as never[]);
    return zeilen.map((zeile) => ({
        id: zeile.id,
        name: zeile.name,
        art: zeile.art,
        x: Number(zeile.x),
        y: Number(zeile.y),
    }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Die Ortszeilen eines Eintrags
// ---------------------------------------------------------------------------------------------------------------------

interface Ortszeile {
    relation: string;
    /** Eine Kontinentzeile („Aventurien“): `key_class = 'continent'` und der Begriff dieser Karte. */
    kontinent: boolean;
    regionen: string[];
    orte: string[];
    gebiete: string[];
    gipfel: string[];
}

async function ladeOrtszeilen(database: Queryable, eintragId: string): Promise<Ortszeile[]> {
    const zeilen = await database<
        {
            zeile: string;
            relation: string;
            key_class: string;
            schluessel: string | null;
            place_id: string | null;
            region_id: string | null;
            territory_id: string | null;
            peak_id: string | null;
        }[]
    >`
        SELECT p.id::text AS zeile, p.relation, p.key_class,
               lower(regexp_replace(p.place_wiki_key, '^wiki:', '')) AS schluessel,
               t.place_id::text AS place_id, t.region_id::text AS region_id, t.territory_id::text AS territory_id, t.terrain_peak_id::text AS peak_id
          FROM lore_place p
          LEFT JOIN lore_place_target t ON t.lore_place_id = p.id
         WHERE p.lore_entry_id = ${eintragId}::bigint AND p.is_active AND p.state = 'active' AND (p.role IS NULL OR p.role = 'ort')
         ORDER BY p.sort_order, p.id, t.id
    `;
    const nachZeile = new Map<string, Ortszeile>();
    for (const zeile of zeilen) {
        let ort = nachZeile.get(zeile.zeile);
        if (ort === undefined) {
            ort = {
                relation: zeile.relation,
                kontinent:
                    zeile.key_class === "continent" &&
                    zeile.schluessel !== null &&
                    KONTINENT_SCHLUESSEL.includes(zeile.schluessel),
                regionen: [],
                orte: [],
                gebiete: [],
                gipfel: [],
            };
            nachZeile.set(zeile.zeile, ort);
        }
        if (zeile.region_id !== null) ort.regionen.push(zeile.region_id);
        if (zeile.place_id !== null) ort.orte.push(zeile.place_id);
        if (zeile.territory_id !== null) ort.gebiete.push(zeile.territory_id);
        if (zeile.peak_id !== null) ort.gipfel.push(zeile.peak_id);
    }
    return [...nachZeile.values()];
}

/**
 * Die Landschaften und Gebiete (`region.id`, `territory.id`), die der Eintrag in seinen Ortszeilen NENNT („im Wiki genannt“), unabhängig davon, ob eine genauere Regel die Zeile
 * ersetzt: Genannt ist, was dasteht. Für die Autovervollständigung, die sie vor den übrigen Zielen zeigt.
 */
export async function genannteZiele(
    database: Queryable,
    eintragPublicId: string,
): Promise<{ regionen: Set<string>; gebiete: Set<string> }> {
    const zeilen = await database<{ region_id: string | null; territory_id: string | null }[]>`
        SELECT t.region_id::text AS region_id, t.territory_id::text AS territory_id
          FROM lore_entry e
          JOIN lore_place p ON p.lore_entry_id = e.id AND p.is_active AND p.state = 'active' AND (p.role IS NULL OR p.role = 'ort')
          JOIN lore_place_target t ON t.lore_place_id = p.id
         WHERE e.public_id = ${eintragPublicId}::uuid AND e.is_active AND e.state = 'active'
    `;
    const regionen = new Set<string>();
    const gebiete = new Set<string>();
    for (const zeile of zeilen) {
        if (zeile.region_id !== null) regionen.add(zeile.region_id);
        if (zeile.territory_id !== null) gebiete.add(zeile.territory_id);
    }
    return { regionen, gebiete };
}

interface RegionMeta {
    id: string;
    public_id: string;
    name: string;
    region_type: string | null;
}

/** Die Landschaft des Kontinents (`region_type = 'kontinent'`), mit ihrem Ausschnitt; `undefined`, wo es sie nicht gibt. */
async function ladeKontinent(
    database: Queryable,
): Promise<{ id: string; publicId: string; name: string; rahmen: VorkommenRahmen } | undefined> {
    const [zeile] = await database<
        { id: string; public_id: string; name: string; x0: number; y0: number; x1: number; y1: number }[]
    >`
        SELECT r.id::text AS id, r.public_id::text AS public_id, btrim(r.name) AS name,
               ST_XMin(x.e)::float8 AS x0, ST_YMin(x.e)::float8 AS y0, ST_XMax(x.e)::float8 AS x1, ST_YMax(x.e)::float8 AS y1
          FROM region r
          JOIN LATERAL (SELECT ST_Extent(a.geom) AS e FROM region_area a WHERE a.region_id = r.id AND a.is_active) x ON x.e IS NOT NULL
         WHERE r.region_type = 'kontinent' AND r.is_active AND NOT r.is_hidden AND r.map_domain_id = ${DOMAENE}
         ORDER BY r.id LIMIT 1
    `;
    if (zeile === undefined) return undefined;
    return {
        id: zeile.id,
        publicId: zeile.public_id,
        name: zeile.name,
        rahmen: { x0: Number(zeile.x0), y0: Number(zeile.y0), x1: Number(zeile.x1), y1: Number(zeile.y1) },
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Das Leuchten
// ---------------------------------------------------------------------------------------------------------------------

export interface LeuchtOptionen {
    /** Ist die Art durch den Inhaltsschalter ausgeblendet? Ohne Angabe gilt keine als ausgeblendet. */
    ausgeblendet?: (art: InhalteVorkommenArt) => boolean;
    /** Der Kartenstand, wenn der Aufrufer ihn eben gelesen hat (`ermittleKartenstand`): spart die Abfrage. */
    stand?: string;
}

/** Die Schlüssel der Inhaltsschalter der vier Arten, für den ETag der Route. */
export const SCHALTER_ARTEN: readonly InhalteVorkommenArt[] = ["flora", "fauna", "ware", "spezies"];

const leerLeuchten = (titel: string, begriff: SearchLeuchten["begriff"], pausiert: boolean): SearchLeuchten => ({
    titel,
    begriff,
    pausiert,
    ganz: [],
    angeschnitten: [],
    gebiete: { ganz: [], angeschnitten: [] },
    orte: [],
    gegenden: 0,
    rahmen: null,
    nurKontinent: false,
});

/** Die Anfrage in einer Form, die als Schlüssel taugt (kleingeschrieben, Listen geordnet). */
function normalisiere(anfrage: SearchLeuchtAnfrage): SearchLeuchtAnfrage {
    return {
        ...(anfrage.eintrag === undefined ? {} : { eintrag: anfrage.eintrag.toLowerCase() }),
        ...(anfrage.art === undefined ? {} : { art: anfrage.art }),
        ...(anfrage.landschaften === undefined
            ? {}
            : { landschaften: anfrage.landschaften.map((id) => id.toLowerCase()).sort() }),
        ...(anfrage.gebiet === undefined ? {} : { gebiet: anfrage.gebiet.toLowerCase() }),
        ...(anfrage.lage === undefined ? {} : { lage: anfrage.lage }),
        // Bei „zwischen“ ist A–B dasselbe wie B–A (der Streifen zwischen den Linien, WI-0253 §27 B); bei einer Richtung gibt es nur einen Ort.
        ...(anfrage.orte === undefined
            ? {}
            : {
                  orte:
                      anfrage.lage === "zwischen"
                          ? anfrage.orte.map((id) => id.toLowerCase()).sort()
                          : anfrage.orte.map((id) => id.toLowerCase()),
              }),
    };
}

/** Ob die Anfrage in sich stimmt: genau eines von Eintrag und Art, Kennungen in Form, Orte nur mit Lage, Art nur mit Rahmen. */
export function anfrageGueltig(anfrage: SearchLeuchtAnfrage): boolean {
    if ((anfrage.eintrag === undefined) === (anfrage.art === undefined)) return false;
    const kennungen = [
        ...(anfrage.eintrag === undefined ? [] : [anfrage.eintrag]),
        ...(anfrage.landschaften ?? []),
        ...(anfrage.gebiet === undefined ? [] : [anfrage.gebiet]),
        ...(anfrage.orte ?? []),
    ];
    if (!kennungen.every((id) => UUID.test(id.toLowerCase()))) return false;
    if ((anfrage.lage === undefined) !== (anfrage.orte === undefined)) return false;
    // „Zwischen“ braucht zwei verschiedene Orte.
    if (anfrage.lage === "zwischen" && new Set((anfrage.orte ?? []).map((id) => id.toLowerCase())).size !== 2)
        return false;
    if (anfrage.lage !== undefined && (anfrage.orte ?? []).length !== (anfrage.lage === "zwischen" ? 2 : 1))
        return false;
    const hatRahmen = anfrage.landschaften !== undefined || anfrage.gebiet !== undefined || anfrage.lage !== undefined;
    if (anfrage.art !== undefined && (!hatRahmen || landschaftsartVon(anfrage.art) === undefined)) return false;
    return true;
}

/**
 * Was für die Anfrage leuchtet, oder `undefined`, wo der Eintrag, die Art oder ein Ziel der Anfrage nicht (mehr) da ist. Eine ungültige Anfrage (`anfrageGueltig`) wirft.
 * 🪤 Die Antwort kommt aus dem Zwischenspeicher und gehört allen Aufrufern: nicht verändern.
 */
export async function leuchte(
    database: Queryable,
    anfrage: SearchLeuchtAnfrage,
    optionen: LeuchtOptionen = {},
): Promise<SearchLeuchten | undefined> {
    if (!anfrageGueltig(anfrage)) throw new Error("Ungültige Leuchtanfrage");
    const norm = normalisiere(anfrage);
    const stand = optionen.stand ?? (await ermittleKartenstand(database, DOMAENE));
    const schluessel = JSON.stringify(norm);
    // Die Art eines Eintrags steht erst nach dem Lesen fest; der Schalter wird in `rechne` geprüft und nie gemerkt.
    const gemerkt = speicher.get(schluessel, stand);
    if (gemerkt !== undefined) return pruefeSchalter(gemerkt, optionen);
    const laufend = unterwegs.get(`${schluessel}|${stand}`);
    if (laufend !== undefined) return pruefeSchalter(await laufend, optionen);
    const lauf = rechne(database, norm, stand)
        .then((antwort) => {
            if (antwort !== undefined) speicher.set(schluessel, stand, antwort, JSON.stringify(antwort).length);
            return antwort;
        })
        .finally(() => {
            unterwegs.delete(`${schluessel}|${stand}`);
        });
    unterwegs.set(`${schluessel}|${stand}`, lauf);
    return pruefeSchalter(await lauf, optionen);
}

/** Eine ausgeblendete Art antwortet leer, ohne Namen. */
function pruefeSchalter(antwort: SearchLeuchten | undefined, optionen: LeuchtOptionen): SearchLeuchten | undefined {
    if (antwort === undefined) return undefined;
    const art = antwort.begriff.kind;
    if (art === undefined || optionen.ausgeblendet?.(art) !== true) return antwort;
    return leerLeuchten("", { name: "" }, true);
}

/** Was zu einem Eintrag gehört, unabhängig vom Rahmen: die Zeile des Eintrags, seine Ortszeilen und die Landschaften, auf die sie zeigen. */
interface EintragKontext {
    eintrag: { id: string; public_id: string; kind: string; name: string };
    zeilen: Ortszeile[];
    metas: RegionMeta[];
}

const kontexte = new Map<string, Promise<EintragKontext | undefined>>();
const KONTEXTE_MAX = 64;

/**
 * Der Kontext eines Eintrags, je Kartenstand einmal gelesen: Mehrere Rahmen für denselben Eintrag („Wirselkraut in …“ für jedes Ziel der Autovervollständigung) lesen ihn nicht
 * jedes Mal neu (gemessen: vier Abfragen von neun).
 */
function eintragKontext(database: Queryable, publicId: string, stand: string): Promise<EintragKontext | undefined> {
    const schluessel = `${publicId}|${stand}`;
    const da = kontexte.get(schluessel);
    if (da !== undefined) return da;
    const lauf = (async (): Promise<EintragKontext | undefined> => {
        const [eintrag] = await database<{ id: string; public_id: string; kind: string; name: string }[]>`
            SELECT e.id::text AS id, e.public_id::text AS public_id, e.kind, e.name FROM lore_entry e
             WHERE e.public_id = ${publicId}::uuid AND e.is_active AND e.state = 'active'
        `;
        if (eintrag === undefined) return undefined;
        const zeilen = await ladeOrtszeilen(database, eintrag.id);
        const regionIds = [...new Set(zeilen.flatMap((zeile) => zeile.regionen))];
        const metas =
            regionIds.length === 0
                ? []
                : await database<RegionMeta[]>`
                      SELECT r.id::text AS id, r.public_id::text AS public_id, btrim(r.name) AS name, r.region_type
                        FROM region r WHERE r.id = ANY(${regionIds}::bigint[]) AND r.is_active AND NOT r.is_hidden
                  `;
        return { eintrag, zeilen, metas };
    })();
    kontexte.set(schluessel, lauf);
    if (kontexte.size > KONTEXTE_MAX) {
        const aeltester = kontexte.keys().next().value;
        if (aeltester !== undefined) kontexte.delete(aeltester);
    }
    lauf.catch(() => {
        if (kontexte.get(schluessel) === lauf) kontexte.delete(schluessel);
    });
    return lauf;
}

async function rechne(
    database: Queryable,
    anfrage: SearchLeuchtAnfrage,
    stand: string,
): Promise<SearchLeuchten | undefined> {
    const aufgeloest = await loeseRahmenAuf(database, anfrage);
    if (aufgeloest === undefined) return undefined;
    const { rahmen } = aufgeloest;
    const sammler = new Sammler();
    if (anfrage.art !== undefined) {
        const art = landschaftsartVon(anfrage.art) as Landschaftsart;
        const regel: Regel = {
            ruleId: "0",
            ruleKey: "0".repeat(64),
            beziehung: "verbreitung",
            eintragId: "0",
            eintragPublicId: NULL_UUID,
            art: "flora",
            verwaiste: 0,
            glieder: [{ op: "und", arten: [art.schluessel], nenntArten: true, flaeche: null, klima: null, lage: null }],
        };
        sammler.fuegeRegelTreffer(await rechneRegel(database, regel, { ...(rahmen === undefined ? {} : { rahmen }) }));
        return abschluss(
            sammler,
            `${art.name} ${aufgeloest.titel}`.trim(),
            { name: art.name, art: art.art },
            false,
            undefined,
        );
    }
    const kontext = await eintragKontext(database, anfrage.eintrag as string, stand);
    if (kontext === undefined) return undefined;
    const { eintrag, zeilen } = kontext;
    const kind = eintrag.kind as InhalteVorkommenArt;
    const begriff = { name: eintrag.name, kind, eintrag: eintrag.public_id };
    const titel = `${eintrag.name} ${aufgeloest.titel}`.trim();

    const [ersatz, treffer] = await Promise.all([
        LORE_READING.ortszeileHinterRegel ? ortszeilenErsatz(database) : Promise.resolve(KEIN_ERSATZ),
        trefferDesEintrags(database, eintrag.public_id, { ...(rahmen === undefined ? {} : { rahmen }), stand }),
    ]);
    for (const regel of treffer?.regeln ?? []) sammler.fuegeRegelTreffer(regel);

    // F2: Eine Ortszeile, hinter die eine genauere Regel derselben Beziehung getreten ist, gilt nicht mehr (je Zeile, wie im Panel).
    const geltende = zeilen.filter((zeile) => !ortszeileErsetzt(ersatz, eintrag.id, zeile.relation, zeile.regionen));

    // Die Landschaften der Zeilen; eine Landschaft vom Typ Kontinent ist die Kontinentzeile (D5), keine Gegend.
    const regionIds = [...new Set(geltende.flatMap((zeile) => zeile.regionen))];
    const metas = kontext.metas;
    const kontinentRegionen = new Set(
        metas.filter((meta) => meta.region_type === "kontinent" && regionIds.includes(meta.id)).map((meta) => meta.id),
    );
    const kontinentGilt = geltende.some(
        (zeile) => zeile.kontinent || zeile.regionen.some((id) => kontinentRegionen.has(id)),
    );
    const gegendIds = regionIds.filter((id) => !kontinentRegionen.has(id) && metas.some((meta) => meta.id === id));
    const gebietIds = [...new Set(geltende.flatMap((zeile) => zeile.gebiete))];
    const ortIds = [...new Set(geltende.flatMap((zeile) => zeile.orte))];
    const gipfelIds = [...new Set(geltende.flatMap((zeile) => zeile.gipfel))];

    const [landschaftsZeilen, gebietsZeilen, orte, gipfel] = await Promise.all([
        schneideFlaechen(database, "region", gegendIds, rahmen),
        schneideFlaechen(database, "territory", gebietIds, rahmen),
        ladeOrte(database, "place", ortIds, rahmen),
        ladeOrte(database, "terrain_peak", gipfelIds, rahmen),
    ]);
    for (const zeile of landschaftsZeilen) fuegeFlaeche(sammler, sammler.landschaften, zeile);
    for (const zeile of gebietsZeilen) fuegeFlaeche(sammler, sammler.gebiete, zeile);
    for (const ort of [...orte, ...gipfel]) sammler.fuegeOrt(ort);

    // D5 / F1: Die Kontinentzeile zählt nur, wenn nichts anderes genannt ist – weder eine weitere Zeile mit Ziel noch eine Regel mit Treffer (ohne Rahmen gerechnet).
    let nurKontinent = false;
    let kontinentRahmen: SearchLeuchten["kontinent"];
    if (kontinentGilt) {
        const andereZeilen = gegendIds.length + gebietIds.length + ortIds.length + gipfelIds.length > 0;
        let regelnTreffen = false;
        if (!andereZeilen) {
            const ohneRahmen =
                rahmen === undefined ? treffer : await trefferDesEintrags(database, eintrag.public_id, { stand });
            regelnTreffen = (ohneRahmen?.regeln ?? []).some(
                (regel) => regel.landschaften.length > 0 || regel.rest !== undefined,
            );
        }
        if (!andereZeilen && !regelnTreffen) {
            const kontinent = await ladeKontinent(database);
            if (kontinent !== undefined) {
                if (rahmen === undefined) {
                    nurKontinent = true;
                    kontinentRahmen = { publicId: kontinent.publicId, name: kontinent.name, rahmen: kontinent.rahmen };
                } else {
                    // Was überall vorkommt, kommt auch im Rahmen vor: Der Rahmen selbst leuchtet.
                    for (const zeile of await schneideFlaechen(database, "region", [kontinent.id], rahmen)) {
                        fuegeFlaeche(sammler, sammler.landschaften, zeile);
                    }
                }
            }
        }
    }
    return abschluss(sammler, titel, begriff, nurKontinent, kontinentRahmen);
}

/** Eine Zeile der Flächenabfrage in den Sammler. */
function fuegeFlaeche(sammler: Sammler, ziel: Map<string, Teil>, zeile: FlaechenZeile): void {
    sammler.fuegeTeil(ziel, zeile.pid, zeile.name, zeile.ganz, polygoneVon(zeile.form), {
        x0: Number(zeile.x0),
        y0: Number(zeile.y0),
        x1: Number(zeile.x1),
        y1: Number(zeile.y1),
    });
}

function abschluss(
    sammler: Sammler,
    titel: string,
    begriff: SearchLeuchten["begriff"],
    nurKontinent: boolean,
    kontinent: SearchLeuchten["kontinent"],
): SearchLeuchten {
    const landschaften = teileListen(sammler.landschaften);
    const gebiete = teileListen(sammler.gebiete);
    const restForm = formAus(sammler.restPolygone);
    const orte = [...sammler.orte.values()].sort(
        (a, b) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id),
    );
    const antwort: SearchLeuchten = {
        titel,
        begriff,
        pausiert: false,
        ganz: landschaften.ganz,
        angeschnitten: landschaften.angeschnitten,
        ...(restForm !== undefined && sammler.restRahmen !== null
            ? { rest: { form: restForm, rahmen: sammler.restRahmen } }
            : {}),
        gebiete,
        orte,
        gegenden:
            landschaften.ganz.length +
            landschaften.angeschnitten.length +
            gebiete.ganz.length +
            gebiete.angeschnitten.length,
        rahmen: nurKontinent ? null : sammler.rahmen,
        nurKontinent,
        ...(kontinent === undefined ? {} : { kontinent }),
    };
    return antwort;
}

/**
 * Die Zahlen für die Sektion „Vorkommen“: je Eintrag die Zahl der leuchtenden Gegenden und genannten Orte. Dieselbe Rechnung wie `leuchte`, also dieselbe Zahl; ein
 * ausgeblendeter oder unbekannter Eintrag fehlt.
 */
export async function zaehle(
    database: Queryable,
    eintragIds: readonly string[],
    optionen: LeuchtOptionen = {},
): Promise<{ id: string; gegenden: number; orte: number; nurKontinent: boolean }[]> {
    const antworten = await Promise.all(eintragIds.map((id) => leuchte(database, { eintrag: id }, optionen)));
    const zahlen: { id: string; gegenden: number; orte: number; nurKontinent: boolean }[] = [];
    eintragIds.forEach((id, i) => {
        const antwort = antworten[i];
        if (antwort === undefined || antwort.pausiert) return;
        zahlen.push({ id, gegenden: antwort.gegenden, orte: antwort.orte.length, nurKontinent: antwort.nurKontinent });
    });
    return zahlen;
}

/** Ein Hash der Anfrage, für ETags (die Reihenfolge der Listen ist normalisiert). */
export const anfrageHash = (anfrage: SearchLeuchtAnfrage): string =>
    createHash("sha256")
        .update(JSON.stringify(normalisiere(anfrage)))
        .digest("base64url")
        .slice(0, 22);
