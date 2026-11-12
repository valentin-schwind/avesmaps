import type { Queryable } from "../database.ts";
import type { SpracheEintrag, SpracheHerkunft, SpracheMitTeilflaechen, SprachTeilflaeche } from "./typen.ts";

/**
 * Lesen der Sprachen (WI-0261 S2): die Liste der aktiven Sprachen und eine Sprache mit ihren Teilflächen. Nur lesend; geschrieben wird
 * später vom Spracheditor (S5) und vom Import (S6).
 *
 * - 🔴 **Nur Aktives.** Eine stillgelegte Sprache ist für diese Leser nicht da (`spracheLesen` gibt `null`), eine stillgelegte Teilfläche
 *   zählt weder in die Anzahl noch in die Summe noch in die Liste der Teilflächen. Dasselbe Filter wie die Kachelsicht
 *   `sprache_flaeche_render`.
 * - **Die Fläche** ist die Fläche in Kartenkoordinaten (SRID 0, Karteneinheiten²), nicht die der Kachelprojektion, und wie in der
 *   Kachelsicht auf zwei Stellen gerundet. Die Summe einer Sprache wird aus den ungerundeten Flächen gerechnet und dann gerundet.
 *   Teilflächen verschiedener Sprachen dürfen sich überlappen (E2); jede Sprache zählt für sich.
 * - Die Geometrie selbst liefert dieser Weg nie: Sie kommt als Kachel (Martin). Die Teilfläche trägt nur ihre Hülle (`bbox`), damit die
 *   Karte sie ansteuern kann.
 */

interface EintragRow {
    id: string;
    schluessel: string;
    name: string;
    legende: string | null;
    farbe: string;
    reihenfolge: number;
    herkunft: string;
    revision: number;
    anzahl: number;
    flaeche: number;
}

/** Die Tafel erlaubt nur die zwei bekannten Wörter (`sprache_herkunft_known`); alles andere gälte als Redaktion. */
const herkunft = (wert: string): SpracheHerkunft => (wert === "sprachenkarte" ? "sprachenkarte" : "redaktion");

function eintragVon(row: EintragRow): SpracheEintrag {
    return {
        id: row.id,
        schluessel: row.schluessel,
        name: row.name,
        legende: row.legende,
        farbe: row.farbe,
        reihenfolge: row.reihenfolge,
        herkunft: herkunft(row.herkunft),
        revision: row.revision,
        anzahlTeilflaechen: row.anzahl,
        flaeche: row.flaeche,
    };
}

/** Die aktiven Sprachen, nach Reihenfolge der Legende, dann nach Name. */
export async function listeSprachen(database: Queryable): Promise<SpracheEintrag[]> {
    const zeilen = await database<EintragRow[]>`
        SELECT s.public_id::text AS id, s.schluessel, s.name, s.legende, s.farbe, s.reihenfolge, s.herkunft,
               s.revision::int AS revision,
               count(a.id)::int AS anzahl,
               COALESCE(round(sum(st_area(a.geom))::numeric, 2), 0)::double precision AS flaeche
          FROM sprache s
          LEFT JOIN sprache_flaeche a ON a.sprache_id = s.id AND a.is_active
         WHERE s.is_active
         GROUP BY s.id
         ORDER BY s.reihenfolge, lower(s.name), s.id
    `;
    return zeilen.map(eintragVon);
}

interface TeilflaecheRow extends EintragRow {
    teil_id: string | null;
    teil_herkunft: string | null;
    teil_flaeche: number | null;
    min_x: number | null;
    min_y: number | null;
    max_x: number | null;
    max_y: number | null;
}

/**
 * Eine aktive Sprache mit ihren aktiven Teilflächen, die größte zuerst; `null`, wenn es den Schlüssel nicht gibt oder die Sprache stillgelegt ist.
 * Eine einzige Anweisung, damit Anzahl und Summe zu den aufgezählten Teilflächen passen.
 */
export async function spracheLesen(database: Queryable, schluessel: string): Promise<SpracheMitTeilflaechen | null> {
    const zeilen = await database<TeilflaecheRow[]>`
        SELECT s.public_id::text AS id, s.schluessel, s.name, s.legende, s.farbe, s.reihenfolge, s.herkunft,
               s.revision::int AS revision,
               count(a.id) OVER ()::int AS anzahl,
               COALESCE(round((sum(st_area(a.geom)) OVER ())::numeric, 2), 0)::double precision AS flaeche,
               a.public_id::text AS teil_id, a.herkunft AS teil_herkunft,
               round(st_area(a.geom)::numeric, 2)::double precision AS teil_flaeche,
               st_xmin(a.geom) AS min_x, st_ymin(a.geom) AS min_y, st_xmax(a.geom) AS max_x, st_ymax(a.geom) AS max_y
          FROM sprache s
          LEFT JOIN sprache_flaeche a ON a.sprache_id = s.id AND a.is_active
         WHERE s.schluessel = ${schluessel} AND s.is_active
         ORDER BY st_area(a.geom) DESC NULLS LAST, a.public_id
    `;
    const erste = zeilen[0];
    if (erste === undefined) return null;
    const teilflaechen: SprachTeilflaeche[] = [];
    for (const zeile of zeilen) {
        if (zeile.teil_id === null) continue;
        teilflaechen.push({
            id: zeile.teil_id,
            herkunft: herkunft(zeile.teil_herkunft ?? ""),
            flaeche: zeile.teil_flaeche ?? 0,
            bbox: [zeile.min_x ?? 0, zeile.min_y ?? 0, zeile.max_x ?? 0, zeile.max_y ?? 0],
        });
    }
    return { ...eintragVon(erste), teilflaechen };
}
