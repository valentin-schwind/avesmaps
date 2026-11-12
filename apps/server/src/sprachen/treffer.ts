import type { Queryable } from "../database.ts";
import { leseKarteneinstellungen, wirksameKarteneinstellungen } from "../system/karteneinstellungen.ts";
import type { TrefferArt } from "./treffer-auftrag.ts";
import type { SprachTreffer, SpracheEinesObjekts } from "./typen.ts";

/**
 * Lesen der Treffer (WI-0261 S4, Migration 0256): die Sprachen eines Objekts (für die Zeile „Sprachen“ der Infoboxen, S5) und die Zahlen einer
 * Sprache je Art (Infobox der Sprache). Geschrieben werden die Treffer nur vom Auftrag `sprache_treffer`.
 *
 * - 🔴 **Die Schwelle wirkt hier**, nicht beim Rechnen: Die Tafel trägt jede Berührung mit Anteil > 0, der Leser nimmt, was mindestens den
 *   Mindestanteil hat (`sprachenMindestanteil` in den Karteneinstellungen, Prozent; 0 heißt jede Berührung). Ein Ort zählt immer (Punkt in
 *   Fläche, Anteil 1).
 * - **Nur aktive Sprachen.** Eine stillgelegte Sprache erscheint nicht, auch wenn ihr Lauf ihre Treffer noch nicht gelöscht hat.
 * - Die Treffer sind ein Zwischenspeicher: Nach einer Änderung stehen sie für die Sammelzeit des Auftrags (Ruhe 30 s, höchstens 120 s) und
 *   seine Laufzeit auf dem alten Stand.
 */

/** Der Mindestanteil der Karteneinstellungen als Anteil (0 bis 1); fehlt die Tafel, gilt die Vorgabe. */
export async function sprachenMindestanteil(db: Queryable): Promise<number> {
    const werte = wirksameKarteneinstellungen(await leseKarteneinstellungen(db, { personen: false }));
    return werte.sprachenMindestanteil / 100;
}

interface SpracheZeile {
    id: string;
    schluessel: string;
    name: string;
    farbe: string;
    anteil: number;
}

/** Die aktiven Sprachen eines Objekts ab dem Mindestanteil (ein Ort: jede), der größte Anteil zuerst, dann nach der Legende. */
export async function sprachenDesObjekts(
    db: Queryable,
    art: TrefferArt,
    publicId: string,
    mindestanteil: number,
): Promise<SpracheEinesObjekts[]> {
    return sprachenDerGruppe(db, art, [publicId], mindestanteil);
}

/**
 * Die aktiven Sprachen einer GRUPPE von Objekten einer Art (WI-0261 S5b, Zeile „Sprachen“): Eine Landschaft ist die Gruppe gleichnamiger Regionen, ein Weg die
 * Gruppe seiner Abschnitte. Der Anteil der Gruppe ist der gewichtete Anteil ihrer Mitglieder: bei Regionen nach Fläche, bei Wegen nach Länge (eine Sprache, die
 * einen kurzen Abschnitt ganz deckt, deckt die lange Straße kaum). Orte und Gebiete stehen einzeln da (Gewicht 1). Ohne messbares Gewicht zählt jedes Mitglied
 * gleich. Die Schwelle wirkt auf den Anteil der Gruppe; ein Ort zählt immer.
 *
 * `mindestanteil` `undefined` liest den Wert der Karteneinstellungen, aber nur, wenn es überhaupt einen Treffer unter der Schwelle gibt: Ohne Sprachflächen
 * (vor dem Einspielen, S6) kostet die Zeile eine Abfrage über den Primärschlüssel und sonst nichts.
 */
export async function sprachenDerGruppe(
    db: Queryable,
    art: TrefferArt,
    publicIds: readonly string[],
    mindestanteil?: number,
): Promise<SpracheEinesObjekts[]> {
    if (publicIds.length === 0) return [];
    const gewicht =
        art === "region"
            ? db`(SELECT COALESCE(sum(ST_Area(a.geom)), 0) FROM region r
                    JOIN region_area a ON a.region_id = r.id AND a.is_active
                   WHERE r.public_id = m.public_id)`
            : art === "path"
              ? db`(SELECT COALESCE(ST_Length(p.geom), 0) FROM path p WHERE p.public_id = m.public_id)`
              : db`1::double precision`;
    const zeilen = await db<SpracheZeile[]>`
        WITH m AS MATERIALIZED (
            SELECT x.id::uuid AS public_id FROM unnest(${[...publicIds]}::text[]) AS x(id) GROUP BY x.id
        ),
        g AS MATERIALIZED (
            SELECT m.public_id, ${gewicht}::double precision AS w FROM m
        ),
        n AS (
            SELECT g.public_id, CASE WHEN (SELECT sum(w) FROM g) > 0 THEN g.w ELSE 1 END AS w FROM g
        )
        SELECT s.public_id::text AS id, s.schluessel, s.name, s.farbe,
               LEAST(1, sum(t.anteil * n.w) / (SELECT sum(w) FROM n))::double precision AS anteil
          FROM sprache_treffer t
          JOIN n ON n.public_id = t.objekt_public_id
          JOIN sprache s ON s.id = t.sprache_id AND s.is_active
         WHERE t.objekt_art = ${art}
         GROUP BY s.id
         ORDER BY anteil DESC, s.reihenfolge, lower(s.name), s.id
    `;
    if (art === "place" || zeilen.length === 0) return zeilen.map((zeile) => ({ ...zeile }));
    const schwelle = mindestanteil ?? (await sprachenMindestanteil(db));
    return zeilen.filter((zeile) => zeile.anteil >= schwelle).map((zeile) => ({ ...zeile }));
}

/** Je Art die Zahl der Objekte, die die Sprache ab dem Mindestanteil trifft (Orte: jeder Treffer); `null`, wenn es sie nicht aktiv gibt. */
export async function trefferDerSprache(
    db: Queryable,
    schluessel: string,
    mindestanteil: number,
): Promise<SprachTreffer | null> {
    const [zeile] = await db<(SprachTreffer & { da: boolean })[]>`
        SELECT true AS da,
               count(*) FILTER (WHERE t.objekt_art = 'place')::int AS orte,
               count(*) FILTER (WHERE t.objekt_art = 'territory' AND t.anteil >= ${mindestanteil}::double precision)::int AS gebiete,
               count(*) FILTER (WHERE t.objekt_art = 'region' AND t.anteil >= ${mindestanteil}::double precision)::int AS regionen,
               count(*) FILTER (WHERE t.objekt_art = 'path' AND t.anteil >= ${mindestanteil}::double precision)::int AS wege
          FROM sprache s
          LEFT JOIN sprache_treffer t ON t.sprache_id = s.id
         WHERE s.schluessel = ${schluessel} AND s.is_active
         GROUP BY s.id
    `;
    if (zeile === undefined) return null;
    return { orte: zeile.orte, gebiete: zeile.gebiete, regionen: zeile.regionen, wege: zeile.wege };
}
