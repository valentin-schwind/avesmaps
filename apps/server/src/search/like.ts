import type { PendingQuery, Row } from "postgres";
import type { Queryable } from "../database.ts";

/**
 * Bereitet die Eingabe so auf, dass sie als `ILIKE`-Muster sicher ist.
 *
 * 💣 `%` und `_` sind in `LIKE` Platzhalter. Ohne Maskierung fände die Eingabe `%` jeden Namen im
 * Bestand, und `_` jeden mit einem beliebigen Zeichen an der Stelle. Das ist keine
 * Einschleusungslücke — die Abfrage ist parametrisiert —, aber es ist ein falsches Ergebnis, und
 * das faellt niemandem auf, der nicht gerade danach sucht.
 *
 * 🪤 Der Backslash muss ZUERST maskiert werden. Andersherum verdoppelte man die Backslashes, die
 * man gerade selbst eingefügt hat.
 */
export function likePattern(query: string): string {
    const maskiert = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    return `%${maskiert}%`;
}

/** Dasselbe Maskieren ohne die Platzhalter an den Enden: das Muster trifft nur den genauen Namen (ohne Rücksicht auf die Schreibweise, mit `ILIKE`). */
export function likeGenau(query: string): string {
    return query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Ein Name in der Datenbank, gefaltet wie `foldName`: ohne Akzente, ß als ss (OPS-000065: „Athykril“ findet „Âthykril“). Die Groß- und
 * Kleinschreibung übernimmt `ILIKE`; das Muster dazu kommt aus der gefalteten Eingabe (`likePattern(foldName(…))`).
 *
 * 🪤 Ohne die Erweiterung `unaccent` (die bräuchte Claudio): `normalize` zerlegt einen Buchstaben in Grundzeichen und Akzent, und der Ausdruck
 * streicht die Akzente im Block U+0300 bis U+036F, in dem alle des Bestands liegen. Die Folge entspricht `foldName` vor dem `toLowerCase`.
 */
export function gefaltet(database: Queryable, spalte: PendingQuery<Row[]>): PendingQuery<Row[]> {
    return database`replace(regexp_replace(normalize(${spalte}, NFD), '[\\u0300-\\u036f]', '', 'g'), 'ß', 'ss')`;
}

/**
 * Passt der Name gefaltet zum Muster? Dasselbe wie `gefaltet(…) ILIKE muster`, nur billiger: Ein Name aus reinem ASCII ist schon gefaltet, und das
 * zeigt `octet_length <> length` ohne Funktion je Zeichen. Gefaltet wird nur, was ein Zeichen außerhalb von ASCII trägt.
 *
 * 💣 Gemessen am lokalen Bestand (11.925 Wege, 7.047 Landschaften, 5.645 Orte): Die Faltung jeder Zeile machte „Gareth“ von 7 auf 75 ms langsam.
 * 🪤 Steht daneben eine teurere Bedingung (der Griff-Regex der Suche), ordnet PostgreSQL diese hier nach Kosten DAHINTER, und die teure läuft über
 * jede Zeile. Dann gehört diese in eine Unterabfrage hinter `OFFSET 0` (`search.ts`). Ein `CASE` hielte die Folge auch, aber dessen Trefferzahl
 * schätzt der Planer blind auf die Hälfte und startet parallele Worker.
 */
export function passtGefaltet(database: Queryable, spalte: PendingQuery<Row[]>, muster: string): PendingQuery<Row[]> {
    return database`(${spalte} ILIKE ${muster} OR (octet_length(${spalte}) <> length(${spalte}) AND ${gefaltet(database, spalte)} ILIKE ${muster}))`;
}
