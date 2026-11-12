import { gleicheLage, WASSER_LAGE_E } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die eigenen Höhen an Flüssen folgen dem Verlauf des Flusswegs (WI-0259 §2, Vali 2026-10-30: „Höhe wandert mit“). Eine Flusshöhe hängt
 * in `terrain_water_height` nur an der Lage (`WASSER_LAGE_E`, Migration 0230), nicht an einer Kennung des Stützpunkts; dieses Modul hält
 * die Lage und den Weg beisammen:
 *
 * - `fuehreFlussHoehenNach`: Der Wegeditor (`path-edit.ts`, `path-verbinden.ts`) oder das Mitziehen der Wegenden beim Verschieben eines Ortes
 *   (`place-edit.ts`) hat Stützpunkte von `von` nach `nach` verschoben; die Höhe an `von` zieht in derselben
 *   Transaktion um. Eine gelöschte oder eingefügte Stelle kommt hier nie an: Die Höhe an einer gelöschten Stelle bleibt stehen (sie ist
 *   dann unwirksam; setzt ein ↶ den Punkt an dieselbe Lage zurück, wirkt sie wieder), ein eingefügter Punkt hat keine eigene.
 * - `flussHoehenAufStuetzpunkten`: Das Schreiben des Netzes (`gebirge-editor.ts`) speichert nur Flusshöhen, die auf einem Stützpunkt eines
 *   aktiven Flusswegs liegen; was darauf verwaist ist, fällt beim nächsten „Fertig“ weg.
 *
 * Keine Migration: die Bindung bleibt die Lage.
 */

export interface FlussPunkt {
    x: number;
    y: number;
}

/** Ein Stützpunkt eines Flusswegs ist von `von` nach `nach` gewandert. */
export interface FlussPunktVerschoben {
    von: FlussPunkt;
    nach: FlussPunkt;
}

/** Eine umgezogene Höhe, wie das Fachprotokoll sie führt: die Gebirgsfläche (`region_area.public_id`), die Höhe in Schritt, Lage vorher und nachher. */
export interface FlussHoeheUmzug {
    area: string;
    h: number;
    von: FlussPunkt;
    nach: FlussPunkt;
}

export interface FlussHoehenNachgefuehrt {
    umzuege: FlussHoeheUmzug[];
    /** Die Gebirgswerte, deren Revision die Operation gezählt hat (offene Entwürfe des Kammeditors bekommen 409; das Gelände rechnet neu). */
    affected: { kind: "terrain_control"; id: string; revision: number }[];
}

const NICHTS: FlussHoehenNachgefuehrt = { umzuege: [], affected: [] };

/**
 * Welche der Lagen liegen (bis `WASSER_LAGE_E`) auf einem Stützpunkt eines aktiven Flusswegs der Karte? Ein Weg der Art `Flussweg`, auch
 * der Bach; in der Folge der Lagen.
 */
export async function liegenAufFlussStuetzpunkt(
    tx: Queryable,
    domain: string,
    lagen: readonly FlussPunkt[],
): Promise<boolean[]> {
    if (lagen.length === 0) return [];
    const treffer = await tx<{ i: number }[]>`
        SELECT k.i::int AS i
          FROM unnest(${lagen.map((p) => p.x)}::float8[], ${lagen.map((p) => p.y)}::float8[]) WITH ORDINALITY AS k(x, y, i)
         WHERE EXISTS (
               SELECT 1 FROM path p CROSS JOIN LATERAL ST_DumpPoints(p.geom) AS d
                WHERE p.is_active AND p.subtype = 'Flussweg' AND p.map_domain_id = ${domain}
                  AND p.geom && ST_MakeEnvelope(k.x - ${WASSER_LAGE_E}::float8, k.y - ${WASSER_LAGE_E}::float8,
                                                k.x + ${WASSER_LAGE_E}::float8, k.y + ${WASSER_LAGE_E}::float8, 0)
                  AND abs(ST_X(d.geom) - k.x) <= ${WASSER_LAGE_E}::float8
                  AND abs(ST_Y(d.geom) - k.y) <= ${WASSER_LAGE_E}::float8)
    `;
    const drauf = new Set(treffer.map((z) => z.i));
    return lagen.map((_, i) => drauf.has(i + 1));
}

/** Aus den Flusshöhen eines Gebirges nur die, die auf einem Stützpunkt eines aktiven Flusswegs liegen (Reihenfolge bleibt). */
export async function flussHoehenAufStuetzpunkten<T extends FlussPunkt>(
    tx: Queryable,
    domain: string,
    hoehen: readonly T[],
): Promise<T[]> {
    const drauf = await liegenAufFlussStuetzpunkt(tx, domain, hoehen);
    return hoehen.filter((_, i) => drauf[i]);
}

interface HoehenZeile {
    id: string;
    area_id: string;
    area: string;
    x: number;
    y: number;
    h: number;
}

/** Jede Lage `von` einmal (zwei Flüsse an einem Knoten melden ihn beide) und nur, wo sich die Lage wirklich ändert. */
function einzelne(verschoben: readonly FlussPunktVerschoben[]): FlussPunktVerschoben[] {
    const raus: FlussPunktVerschoben[] = [];
    for (const v of verschoben) {
        if (gleicheLage(v.von, v.nach)) continue;
        if (raus.some((r) => gleicheLage(r.von, v.von))) continue;
        raus.push({ von: { x: v.von.x, y: v.von.y }, nach: { x: v.nach.x, y: v.nach.y } });
    }
    return raus;
}

const abstand = (a: FlussPunkt, b: FlussPunkt): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Welche Zeilen ziehen um? Gelesen und entschieden gegen den Stand der Karte NACH den Schreibvorgängen des Wegs:
 * - eine Zeile an einer Lage `von` (Art `fluss`, in jeder Gebirgsfläche der Karte);
 * - nicht, wo `von` noch ein Stützpunkt eines aktiven Flusswegs ist (ein anderer Fluss hängt dort weiter, oder die Kurve läuft über die
 *   Stelle zurück): Die Höhe gehört diesem Stützpunkt; `genau` (die Umkehrung eines Eintrags im Fachprotokoll) prüft das nicht;
 * - nicht, wo die Fläche an `nach` schon eine Flusshöhe trägt (zwei Höhen an einer Lage gäbe es nicht; die vorhandene gewinnt, die andere
 *   bleibt unwirksam stehen, ein ↶ macht sie wieder wirksam).
 */
async function entscheide(
    tx: Queryable,
    domain: string,
    paare: readonly FlussPunktVerschoben[],
    genau: boolean,
): Promise<(HoehenZeile & { nach: FlussPunkt })[]> {
    const lagen = paare.flatMap((p) => [p.von, p.nach]);
    const zeilen = await tx<HoehenZeile[]>`
        SELECT w.id::text AS id, w.area_id::text AS area_id, a.public_id::text AS area, ST_X(w.geom) AS x, ST_Y(w.geom) AS y,
               w.height_schritt AS h
          FROM terrain_water_height w JOIN region_area a ON a.id = w.area_id
         WHERE w.art = 'fluss' AND w.map_domain_id = ${domain}
           AND EXISTS (SELECT 1 FROM unnest(${lagen.map((p) => p.x)}::float8[], ${lagen.map((p) => p.y)}::float8[]) AS k(x, y)
                        WHERE abs(ST_X(w.geom) - k.x) <= ${WASSER_LAGE_E}::float8
                          AND abs(ST_Y(w.geom) - k.y) <= ${WASSER_LAGE_E}::float8)
         ORDER BY w.id
    `;
    if (zeilen.length === 0) return [];
    const besetzt = genau
        ? paare.map(() => false)
        : await liegenAufFlussStuetzpunkt(
              tx,
              domain,
              paare.map((p) => p.von),
          );
    // Je Zeile das nächste `von`, an dem sie hängt.
    const kandidaten: (HoehenZeile & { nach: FlussPunkt })[] = [];
    for (const zeile of zeilen) {
        let beste = -1;
        paare.forEach((p, i) => {
            if (gleicheLage(zeile, p.von) && (beste < 0 || abstand(zeile, p.von) < abstand(zeile, paare[beste]!.von)))
                beste = i;
        });
        if (beste < 0 || besetzt[beste]) continue;
        kandidaten.push({ ...zeile, nach: paare[beste]!.nach });
    }
    const ziehen = new Set(kandidaten.map((k) => k.id));
    const gewaehlt: (HoehenZeile & { nach: FlussPunkt })[] = [];
    for (const k of kandidaten) {
        const belegt =
            zeilen.some((z) => z.area_id === k.area_id && !ziehen.has(z.id) && gleicheLage(z, k.nach)) ||
            gewaehlt.some((g) => g.area_id === k.area_id && gleicheLage(g.nach, k.nach));
        if (!belegt) gewaehlt.push(k);
    }
    return gewaehlt;
}

/**
 * Führt die Flusshöhen den verschobenen Stützpunkten nach (in der Transaktion des Wegs, NACH dessen Schreibvorgängen). `domain` ist die
 * Karte des Wegs. `genau`: Die Verschiebungen sind die Umkehrung eines Eintrags im Fachprotokoll (↺ von „Wege verbinden“, wo zwei Enden zu
 * einem Punkt wurden und die Lage allein nicht mehr sagt, wem die Höhe gehörte). Die Gebirgswerte der berührten Flächen zählen ihre Revision (sie sperrt dabei gegen ein gleichzeitiges „Fertig“ des
 * Kammeditors; dessen veralteter Entwurf bekommt 409 statt die umgezogene Höhe an der alten Lage zurückzuschreiben).
 */
export async function fuehreFlussHoehenNach(
    tx: Queryable,
    domain: string,
    verschoben: readonly FlussPunktVerschoben[],
    optionen: { genau?: boolean } = {},
): Promise<FlussHoehenNachgefuehrt> {
    const genau = optionen.genau === true;
    const paare = einzelne(verschoben);
    if (paare.length === 0) return NICHTS;
    const vorab = await entscheide(tx, domain, paare, genau);
    if (vorab.length === 0) return NICHTS;
    // Erst die Gebirgswerte sperren und zählen: Ein gleichzeitiges Schreiben des Netzes ersetzt die Zeilen; danach wird neu gelesen.
    const gebirge = await tx<{ area: string; revision: string }[]>`
        UPDATE terrain_control c SET revision = c.revision
          FROM region_area a
         WHERE a.id = c.area_id AND c.is_active AND c.area_id = ANY(${[...new Set(vorab.map((z) => z.area_id))]}::bigint[])
        RETURNING a.public_id::text AS area, c.revision::text AS revision
    `;
    const plan = await entscheide(tx, domain, paare, genau);
    if (plan.length > 0)
        await tx`
            UPDATE terrain_water_height w SET geom = ST_SetSRID(ST_MakePoint(t.x, t.y), 0)
              FROM unnest(${plan.map((z) => z.id)}::bigint[], ${plan.map((z) => z.nach.x)}::float8[], ${plan.map((z) => z.nach.y)}::float8[])
                   AS t(id, x, y)
             WHERE w.id = t.id
        `;
    return {
        umzuege: plan.map((z) => ({ area: z.area, h: z.h, von: { x: z.x, y: z.y }, nach: z.nach })),
        affected: gebirge.map((g) => ({ kind: "terrain_control" as const, id: g.area, revision: Number(g.revision) })),
    };
}

/** Das Feld `wasserHoehen` im Fachprotokoll eines Wegs (`MAP_AUDIT_FIELDS.path`): die umgezogenen Höhen vorher und nachher, parallel. */
export function wasserHoehenProtokoll(umzuege: readonly FlussHoeheUmzug[]): { before: unknown; after: unknown } {
    return {
        before: umzuege.map((u) => ({ area: u.area, h: u.h, x: u.von.x, y: u.von.y })),
        after: umzuege.map((u) => ({ area: u.area, h: u.h, x: u.nach.x, y: u.nach.y })),
    };
}

/** Die Umzüge eines Protokolleintrags als Verschiebungen zurück (↺ von „Wege verbinden“); Unbrauchbares wird ausgelassen. */
export function umgekehrtAusProtokoll(
    wechsel: { before?: unknown; after?: unknown } | undefined,
): FlussPunktVerschoben[] {
    const vorher = wechsel?.before;
    const nachher = wechsel?.after;
    if (!Array.isArray(vorher) || !Array.isArray(nachher) || vorher.length !== nachher.length) return [];
    const lage = (wert: unknown): FlussPunkt | undefined => {
        const { x, y } = (wert ?? {}) as { x?: unknown; y?: unknown };
        return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
    };
    return vorher.flatMap((v, i) => {
        const von = lage(nachher[i]);
        const nach = lage(v);
        return von === undefined || nach === undefined ? [] : [{ von, nach }];
    });
}
