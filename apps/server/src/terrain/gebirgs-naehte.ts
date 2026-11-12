import { pointInGeometry, type V12Geometry } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Gemeinsame Grenzen von Gebirgen (OPS-000089, Vali 2026-11-07: „An gemeinsamen Grenzen fällt nichts mehr ab.“).
 *
 * - **Angedockt** heißt: Beide Flächen teilen ein Stück Umriss, Punkt für Punkt, und liegen auf verschiedenen Seiten davon. Das ist die gemeinsame Kante des Flächeneditors. 🪤 Eine
 *   Fläche in einer größeren (Salamandersteine in „Salamandersteine gesamt“) teilt oft auch Stücke des Umrisses, liegt aber auf derselben Seite: Das ist der freie Rand von beiden.
 *   Der Bestand hat rund 175 überlappende Paare, darum prüft jede Kante die Seiten.
 * - **Wer:** Gebirge an Gebirge und Gebirge an Hochebene (dort behält die Hochebene ihre Höhe). Hügelland setzt das Gebirge selbst fort (`extendMountainFoothills`).
 * - **Die Kanten** stehen als einzelne Strecken in fester Ordnung: Sie gehen in den Fingerabdruck der Saat, und PostGIS verspricht keine Reihenfolge der Stücke.
 */

/** Eine Strecke `[[x, y], [x, y]]` einer gemeinsamen Grenze. */
export type NahtKante = [number, number][];

export interface GebirgsNahtPaar {
    /** Immer ein Gebirge. */
    a: string;
    b: string;
    /** `b` ist eine Hochebene. */
    bFest: boolean;
    kanten: NahtKante[];
}

/** VORSCHLAG: So weit neben der Kante wird geprüft, welche Fläche auf welcher Seite liegt (E). */
const SEITE_E = 0.01;
/** VORSCHLAG: Kürzer ist keine Grenze, sondern ein Berührpunkt zweier Flächen (E). */
const NAHT_MINDESTLAENGE_E = 0.5;

function zuegeAus(linien: string): [number, number][][] {
    const geo = JSON.parse(linien) as
        | { type: "LineString"; coordinates: [number, number][] }
        | { type: "MultiLineString"; coordinates: [number, number][][] };
    return geo.type === "LineString" ? [geo.coordinates] : geo.coordinates;
}

function streckenAus(linien: string): NahtKante[] {
    const raus: NahtKante[] = [];
    for (const zug of zuegeAus(linien))
        for (let i = 1; i < zug.length; i += 1) {
            const p = zug[i - 1]!;
            const q = zug[i]!;
            if (p[0] === q[0] && p[1] === q[1]) continue;
            const vorn = p[0]! < q[0]! || (p[0] === q[0] && p[1]! < q[1]!);
            raus.push(
                vorn
                    ? [
                          [p[0]!, p[1]!],
                          [q[0]!, q[1]!],
                      ]
                    : [
                          [q[0]!, q[1]!],
                          [p[0]!, p[1]!],
                      ],
            );
        }
    return raus;
}

/** Liegen die Flächen auf verschiedenen Seiten dieser Strecke? */
export function aufVerschiedenenSeiten(kante: NahtKante, a: V12Geometry, b: V12Geometry): boolean {
    const [p, q] = kante as [[number, number], [number, number]];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const laenge = Math.hypot(dx, dy);
    if (laenge === 0) return false;
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    const links: [number, number] = [mx - (dy / laenge) * SEITE_E, my + (dx / laenge) * SEITE_E];
    const rechts: [number, number] = [mx + (dy / laenge) * SEITE_E, my - (dx / laenge) * SEITE_E];
    const aLinks = pointInGeometry(links, a);
    const aRechts = pointInGeometry(rechts, a);
    const bLinks = pointInGeometry(links, b);
    const bRechts = pointInGeometry(rechts, b);
    return (aLinks && !aRechts && bRechts && !bLinks) || (aRechts && !aLinks && bLinks && !bRechts);
}

const laengeVon = (kanten: readonly NahtKante[]): number =>
    kanten.reduce((summe, [p, q]) => summe + Math.hypot(q![0] - p![0], q![1] - p![1]), 0);

const vergleiche = (a: NahtKante, b: NahtKante): number =>
    a[0]![0] - b[0]![0] || a[0]![1] - b[0]![1] || a[1]![0] - b[1]![0] || a[1]![1] - b[1]![1];

/** Die angedockten Paare der Karte; mit `nur` die, an denen eine dieser Flächen beteiligt ist. In fester Ordnung. */
export async function ladeGebirgsNaehte(
    database: Queryable,
    mapDomainId: string,
    nur: readonly string[] = [],
): Promise<GebirgsNahtPaar[]> {
    const zeilen = await database<{ a: string; a_typ: string; b: string; b_typ: string; linien: string }[]>`
        WITH g AS (
            SELECT a.public_id, r.region_type, a.geom, ST_Boundary(a.geom) AS rand
              FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
             WHERE a.is_active AND a.map_domain_id = ${mapDomainId} AND r.region_layer = 'topographie'
               AND r.region_type IN ('gebirge', 'hochebene')
        ), p AS (
            SELECT a.public_id AS a, a.region_type AS a_typ, b.public_id AS b, b.region_type AS b_typ,
                   ST_CollectionExtract(ST_Intersection(a.rand, b.rand), 2) AS linien
              FROM g a JOIN g b ON a.public_id < b.public_id AND a.geom && b.geom
             WHERE (a.region_type = 'gebirge' OR b.region_type = 'gebirge')
               AND (${nur.length === 0}::boolean OR a.public_id::text = ANY(${[...nur]}::text[]) OR b.public_id::text = ANY(${[...nur]}::text[]))
        )
        SELECT a::text, a_typ, b::text, b_typ, ST_AsGeoJSON(linien, 15) AS linien FROM p
         WHERE NOT ST_IsEmpty(linien) ORDER BY a, b
    `;
    if (zeilen.length === 0) return [];
    const kennungen = [...new Set(zeilen.flatMap((z) => [z.a, z.b]))];
    const formen = new Map(
        (
            await database<{ id: string; geometry: string }[]>`
                SELECT public_id::text AS id, ST_AsGeoJSON(geom, 15) AS geometry FROM region_area
                 WHERE public_id::text = ANY(${kennungen}::text[])
            `
        ).map((z) => [z.id, JSON.parse(z.geometry) as V12Geometry]),
    );
    const raus: GebirgsNahtPaar[] = [];
    for (const z of zeilen) {
        const fa = formen.get(z.a);
        const fb = formen.get(z.b);
        if (!fa || !fb) continue;
        const kanten = streckenAus(z.linien)
            .filter((kante) => aufVerschiedenenSeiten(kante, fa, fb))
            .sort(vergleiche);
        if (laengeVon(kanten) < NAHT_MINDESTLAENGE_E) continue;
        // `a` ist immer das Gebirge; an einer Hochebene steht sie auf `b`.
        raus.push(
            z.a_typ === "gebirge"
                ? { a: z.a, b: z.b, bFest: z.b_typ !== "gebirge", kanten }
                : { a: z.b, b: z.a, bFest: true, kanten },
        );
    }
    return raus;
}

/** VORSCHLAG: So nah muss die Mitte einer geglätteten Linie an einer gemeinsamen Kante liegen, damit sie zu ihr gehört (E). Die Glättung verschiebt eine Kante um weniger. */
const LINIE_NAEHE_E = 1;

function abstandZu(x: number, y: number, kante: NahtKante): number {
    const [p, q] = kante as [[number, number], [number, number]];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const nenner = dx * dx + dy * dy;
    const t = nenner > 0 ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / nenner)) : 0;
    return Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy);
}

/**
 * Die gemeinsamen Grenzen, wie die Karte sie zeichnet (für die Linie der Editoren): Die Kacheln zeigen die Ränder geglättet (`region_area_smooth`, jede gemeinsame Kante einmal, Migration
 * 0067), die Eingabe der Saat ist eckig, und daneben läge die Linie sichtbar neben der Kante. Ein Paar ohne geglättete Form (gerade gespeichert) zeigt seine eckigen Kanten. Geglättete Stücke,
 * die zwei Flächen nur auf derselben Seite teilen, fallen über die Nähe zu den Kanten weg.
 */
export async function ladeNahtLinien(database: Queryable, mapDomainId: string): Promise<NahtKante[]> {
    const paare = await ladeGebirgsNaehte(database, mapDomainId);
    if (paare.length === 0) return [];
    const zeilen = await database<{ a: string; b: string; linien: string }[]>`
        SELECT p.a, p.b,
               ST_AsGeoJSON(ST_LineMerge(ST_CollectionExtract(ST_Intersection(ST_Boundary(sa.geom), ST_Boundary(sb.geom)), 2)), 15) AS linien
          FROM unnest(${paare.map((p) => p.a)}::text[], ${paare.map((p) => p.b)}::text[]) AS p(a, b)
          JOIN region_area ra ON ra.public_id = p.a::uuid
          JOIN region_area rb ON rb.public_id = p.b::uuid
          JOIN region_area_smooth sa ON sa.region_area_id = ra.id
          JOIN region_area_smooth sb ON sb.region_area_id = rb.id
    `;
    const glatt = new Map(zeilen.map((z) => [`${z.a}|${z.b}`, z.linien]));
    const raus: NahtKante[] = [];
    for (const paar of paare) {
        const geo = glatt.get(`${paar.a}|${paar.b}`);
        const zuege = geo === undefined ? [] : zuegeAus(geo);
        const passend = zuege.filter((zug) => {
            const mitte = zug[Math.floor(zug.length / 2)]!;
            return paar.kanten.some((kante) => abstandZu(mitte[0]!, mitte[1]!, kante) <= LINIE_NAEHE_E);
        });
        raus.push(...(passend.length > 0 ? passend : paar.kanten));
    }
    return raus;
}

/** Je Gebirgsfläche ihre gemeinsamen Kanten, in fester Ordnung (für die Saat). */
export function kantenJeGebirge(paare: readonly GebirgsNahtPaar[]): Map<string, NahtKante[]> {
    const raus = new Map<string, NahtKante[]>();
    const dazu = (id: string, kanten: readonly NahtKante[]): void => {
        const liste = raus.get(id);
        if (liste) liste.push(...kanten);
        else raus.set(id, [...kanten]);
    };
    for (const paar of paare) {
        dazu(paar.a, paar.kanten);
        if (!paar.bFest) dazu(paar.b, paar.kanten);
    }
    for (const liste of raus.values()) liste.sort(vergleiche);
    return raus;
}
