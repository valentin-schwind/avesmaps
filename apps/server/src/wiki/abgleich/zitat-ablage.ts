import type { Queryable } from "../../database.ts";
import { kuerze } from "../infobox/text.ts";
import type { PlanZitat } from "./plan.ts";

/**
 * Die Zitate des Wikis je Quelle und Objekt (WI-0254 §12, Migration 0251, Tafel `wikisync_quelle_zitat`): schreiben, in derselben Transaktion wie der Lauf der Vorschau
 * (`ablage.ts`, `schreibeLauf`), als Jobs-Rolle. Keine Fachtafel: ein Protokoll des Wiki-Stands, das mit dem Lauf fällt (`ON DELETE CASCADE`). Die Klappbox der Editoren liest es (App-Rolle).
 *
 * 🪤 Das Recht (INSERT der Jobs-Rolle) kommt mit den Vorlagen der Rechte (`system-grants.psql`), die auf Stage und Production erst ein Rechte-Lauf durch Claudio einspielt. Bis dahin
 * ist die Tafel für die Jobs-Rolle nicht beschreibbar: Der Lauf legt die Zitate dann NICHT ab und meldet die Zahl der übersprungenen in seinen Zahlen (`zitateUebersprungen`), statt zu scheitern.
 */

/** Wie viele Zitate eine Anweisung schreibt (8 Spalten, die Grenze der Parameter einer Anweisung liegt bei 65 535). */
const ZITATE_JE_ANWEISUNG = 2_000;

export const ZITAT_SPALTEN = [
    "lauf_id",
    "traeger_art",
    "traeger_id",
    "quelle_key",
    "art",
    "seiten",
    "notiz",
    "artikel",
] as const;

/** Darf die laufende Rolle die Tafel der Zitate beschreiben? Fehlt die Tafel (Migration 0251 noch nicht eingespielt), gilt: nein. */
export async function darfZitateAblegen(tx: Queryable): Promise<boolean> {
    const [zeile] = await tx<{ darf: boolean }[]>`
        SELECT coalesce(has_table_privilege(to_regclass('public.wikisync_quelle_zitat'), 'INSERT'), FALSE) AS darf
    `;
    return zeile?.darf === true;
}

/** Eine Zeile der Tafel; Seiten und Notiz stehen in der Länge da, die Legacys Spalten kennen (der Vergleich liest sie so). */
export function zitatFuerDb(laufId: number, zitat: PlanZitat): Record<(typeof ZITAT_SPALTEN)[number], unknown> {
    return {
        lauf_id: laufId,
        traeger_art: zitat.traegerArt,
        traeger_id: zitat.traegerId,
        quelle_key: zitat.quelle,
        art: zitat.art,
        seiten: zitat.seiten === null ? null : kuerze(zitat.seiten, 120),
        notiz: zitat.notiz === null ? null : kuerze(zitat.notiz, 200),
        artikel: kuerze(zitat.artikel, 500),
    };
}

/** Schreibt die Zitate zu einem Lauf. Der Aufrufer hat das Recht vorher geprüft (`darfZitateAblegen`); ein Fehler hier bricht den Lauf ab, mit seiner Transaktion. */
export async function schreibeZitate(tx: Queryable, laufId: number, zitate: readonly PlanZitat[]): Promise<void> {
    const zeilen = zitate.map((zitat) => zitatFuerDb(laufId, zitat));
    for (let ab = 0; ab < zeilen.length; ab += ZITATE_JE_ANWEISUNG) {
        const stueck = zeilen.slice(ab, ab + ZITATE_JE_ANWEISUNG);
        await tx`INSERT INTO wikisync_quelle_zitat ${tx(stueck as never, ...ZITAT_SPALTEN)}`;
    }
}
