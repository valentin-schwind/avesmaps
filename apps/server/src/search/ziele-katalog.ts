import {
    foldName,
    landscapeSearchHandlePattern,
    SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX,
    type VorkommenRahmen,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ermittleKartenstand } from "../vorkommen/regeln.ts";

/**
 * Die Ziele der kurzen Anfragen (WI-0257, S3a): die benannten Landschaften und die Herrschaftsgebiete mit Form, einmal je Kartenstand im Prozess gelesen. Aus ihm kommen
 *
 * - die Gebiete als Treffer der Tastendruck-Suche (Name gefaltet gesucht, Rahmen und Beschriftungspunkt für den Flug),
 * - die Ziele nach „Begriff in …“ (Name, Ausschnitt für den Vorfilter, Fläche für die Reihung).
 *
 * 🔴 **Eine Landschaft ist die Gruppe gleichnamiger Landschaften** (gleicher Name, gleiche Art, gleiche Ebene; „Archipel der Perlen“ sind fünf Regionen und EIN Ziel), wie in der Suche (WI-0047). Namen,
 * die ein Griff sind („Wald-925“), sind kein Ziel und werden nie genannt. Die Ebene `klima` ist keine Landschaft. Eine Landschaft ohne aktive Fläche und ein Gebiet ohne Form gibt es hier nicht.
 * 🪤 Der Katalog liest nur; ändert jemand die Karte, ist er beim nächsten Abruf neu (der Kartenstand zählt Landschaften, Orte, Operationen und die Ableitung der Gebiete).
 */

const DOMAENE = "aventuria";

export interface LandschaftsZiel {
    /** Der gefaltete Name. */
    readonly gefaltet: string;
    readonly name: string;
    /** Der Schlüssel der Art (`wald`, `region` …); kann leer sein. */
    readonly typ: string | null;
    readonly ebene: string;
    /** Die Kennungen der Karte (`region.public_id`), höchstens so viele, wie die Leuchten-Route nimmt. */
    readonly publicIds: readonly string[];
    /** `region.id` der Mitglieder. */
    readonly ids: readonly string[];
    readonly rahmen: VorkommenRahmen;
    /** Die Summe der Flächen, für die Reihung. */
    readonly flaeche: number;
}

export interface GebietsZiel {
    readonly gefaltet: string;
    readonly publicId: string;
    readonly id: string;
    readonly name: string;
    readonly typ: string | null;
    readonly rahmen: VorkommenRahmen;
    readonly flaeche: number;
    /** Der Punkt der Beschriftung (oder die Mitte des Ausschnitts). */
    readonly x: number;
    readonly y: number;
}

export interface ZielKatalog {
    readonly stand: string;
    readonly landschaften: readonly LandschaftsZiel[];
    readonly gebiete: readonly GebietsZiel[];
}

const GRIFF = landscapeSearchHandlePattern();

async function baue(database: Queryable, stand: string): Promise<ZielKatalog> {
    const [landschaften, gebiete] = await Promise.all([
        database<
            {
                name: string;
                typ: string | null;
                ebene: string;
                public_ids: string[];
                ids: string[];
                x0: number;
                y0: number;
                x1: number;
                y1: number;
                flaeche: number;
            }[]
        >`
            SELECT min(btrim(r.name)) AS name, r.region_type AS typ, r.region_layer AS ebene,
                   array_agg(DISTINCT r.public_id::text ORDER BY r.public_id::text) AS public_ids,
                   array_agg(DISTINCT r.id::text ORDER BY r.id::text) AS ids,
                   ST_XMin(ST_Extent(a.geom))::float8 AS x0, ST_YMin(ST_Extent(a.geom))::float8 AS y0,
                   ST_XMax(ST_Extent(a.geom))::float8 AS x1, ST_YMax(ST_Extent(a.geom))::float8 AS y1,
                   sum(ST_Area(a.geom))::float8 AS flaeche
              FROM region r
              JOIN region_area a ON a.region_id = r.id AND a.is_active
             WHERE r.is_active AND NOT r.is_hidden AND r.map_domain_id = ${DOMAENE} AND r.region_layer <> 'klima'
               AND r.name !~* ${GRIFF}
             GROUP BY r.region_layer, r.region_type, lower(btrim(r.name))
        `,
        database<
            {
                public_id: string;
                id: string;
                name: string;
                typ: string | null;
                x0: number;
                y0: number;
                x1: number;
                y1: number;
                flaeche: number;
                lx: number | null;
                ly: number | null;
            }[]
        >`
            SELECT t.public_id::text AS public_id, t.id::text AS id, btrim(t.name) AS name, t.territory_type AS typ,
                   ST_XMin(x.e)::float8 AS x0, ST_YMin(x.e)::float8 AS y0, ST_XMax(x.e)::float8 AS x1, ST_YMax(x.e)::float8 AS y1,
                   x.flaeche::float8 AS flaeche, x.lx::float8 AS lx, x.ly::float8 AS ly
              FROM territory t
              JOIN LATERAL (
                   SELECT ST_Extent(s.geom) AS e, sum(s.area) AS flaeche,
                          (array_agg(ST_X(s.label_geom)) FILTER (WHERE s.label_geom IS NOT NULL))[1] AS lx,
                          (array_agg(ST_Y(s.label_geom)) FILTER (WHERE s.label_geom IS NOT NULL))[1] AS ly
                     FROM territory_shape s
                    WHERE s.territory_id = t.id AND s.band = (SELECT max(b.band) FROM territory_shape b WHERE b.territory_id = t.id)
              ) x ON x.e IS NOT NULL
             WHERE t.is_active AND t.map_domain_id = ${DOMAENE}
        `,
    ]);
    return {
        stand,
        landschaften: landschaften.map((zeile) => ({
            gefaltet: foldName(zeile.name),
            name: zeile.name,
            typ: zeile.typ,
            ebene: zeile.ebene,
            publicIds: zeile.public_ids.slice(0, SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX),
            ids: zeile.ids,
            rahmen: { x0: Number(zeile.x0), y0: Number(zeile.y0), x1: Number(zeile.x1), y1: Number(zeile.y1) },
            flaeche: Number(zeile.flaeche),
        })),
        gebiete: gebiete.map((zeile) => {
            const rahmen = { x0: Number(zeile.x0), y0: Number(zeile.y0), x1: Number(zeile.x1), y1: Number(zeile.y1) };
            return {
                gefaltet: foldName(zeile.name),
                publicId: zeile.public_id,
                id: zeile.id,
                name: zeile.name,
                typ: zeile.typ,
                rahmen,
                flaeche: Number(zeile.flaeche),
                x: zeile.lx === null ? (rahmen.x0 + rahmen.x1) / 2 : Number(zeile.lx),
                y: zeile.ly === null ? (rahmen.y0 + rahmen.y1) / 2 : Number(zeile.ly),
            };
        }),
    };
}

let aktuell: ZielKatalog | undefined;
let ladend: { stand: string; versprechen: Promise<ZielKatalog> } | undefined;
let geprueftAm = 0;
/** So lange gilt ein geprüfter Kartenstand für die Ziele: ein Tastendruck nach dem anderen fragt die Datenbank nicht jedes Mal. */
const PRUEFABSTAND_MS = 1_500;

/** Verwirft den Katalog im Prozess (Tests, Eingriffe an der Datenbank). */
export function leereZielKatalog(): void {
    aktuell = undefined;
    ladend = undefined;
    geprueftAm = 0;
}

/** Der Katalog der Ziele, neu gelesen, wenn sich die Karte geändert hat; mehrere gleichzeitige Fragen lesen einmal. */
export async function zielKatalog(database: Queryable): Promise<ZielKatalog> {
    const jetzt = Date.now();
    if (aktuell !== undefined && jetzt - geprueftAm < PRUEFABSTAND_MS) return aktuell;
    const stand = await ermittleKartenstand(database, DOMAENE);
    geprueftAm = Date.now();
    if (aktuell?.stand === stand) return aktuell;
    if (ladend?.stand === stand) return ladend.versprechen;
    const versprechen = baue(database, stand).then((katalog) => {
        aktuell = katalog;
        return katalog;
    });
    ladend = { stand, versprechen };
    void versprechen.then(
        () => {
            if (ladend?.versprechen === versprechen) ladend = undefined;
        },
        () => {
            if (ladend?.versprechen === versprechen) ladend = undefined;
        },
    );
    return versprechen;
}

/** Vor einem Wortanfang steht Leerraum, ein Bindestrich, ein Schrägstrich oder eine Klammer. */
const WORTGRENZE = /[\s\-/(]/u;

/** Überschneiden sich zwei Ausschnitte? */
export const schneiden = (a: VorkommenRahmen, b: VorkommenRahmen): boolean =>
    a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/**
 * Wie gut passt ein gefalteter Name zum Getippten: 0 genau, 1 Anfang oder ganzes Wort („Fürstentum Kosch“ für „kosch“), 2 Wortanfang, 3 enthalten, sonst `undefined`.
 * Leer passt zu allem (2).
 */
export function zielGuete(gefaltet: string, q: string): number | undefined {
    if (q === "") return 2;
    if (gefaltet === q) return 0;
    if (gefaltet.startsWith(q) || ` ${gefaltet} `.includes(` ${q} `)) return 1;
    let stelle = gefaltet.indexOf(q);
    if (stelle < 0) return undefined;
    while (stelle >= 0) {
        if (WORTGRENZE.test(gefaltet.charAt(stelle - 1))) return 2;
        stelle = gefaltet.indexOf(q, stelle + 1);
    }
    return 3;
}
