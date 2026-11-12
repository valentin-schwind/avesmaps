import type { Static, TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * Wie Zeiger geprüft werden: der Server streng, der Client tolerant (WI-0075 R5b).
 *
 * Ein Zeiger (`current.json`, `/api/territories/current`) ist der Vertrag zwischen Server und Karte, und er ändert
 * sich schneller als ein geladener Tab: Ein neues Feld macht eine Karte blind, die noch das alte Schema prüft. So
 * geschehen beim Format der Höhenkacheln (WI-0073, `format`): Das Schema lehnte das neue Feld ab, der Zeiger galt als
 * ungültig, die Karte blieb flach.
 *
 * - **Der Server prüft streng, wenn er sendet** (`checkPointer`): Ein Feld, das das Schema nicht kennt, geht nicht
 *   hinaus. Das Schema trägt `additionalProperties: false` und ist der Vertrag, den Server und Test festhalten.
 * - **Der Client liest tolerant** (`readPointer`): Unbekannte Felder werden ignoriert und nicht weitergereicht; was er
 *   kennt, prüft er genauso streng wie der Server (Typ, Muster, Wertebereich). Fehlt ein bekanntes Pflichtfeld oder
 *   hat es einen falschen Wert, scheitert er laut wie bisher.
 *
 * Regel für den Server: Ein Zeiger bekommt neue Felder nur HINZU und nie als Pflichtfeld, das ein Client der Vorversion
 * nicht kennt (AGENTS.md, „Migrationen: erst erweitern, dann umstellen, dann entfernen“, Punkt 4). Schon geladene Tabs
 * mit dem alten, strengen Leser bleiben bis zum Neuladen blind; geschützt sind alle Clients ab diesem Stand.
 */

function describeFirstError(schema: TObject, candidate: unknown): string {
    const [firstError] = [...Value.Errors(schema, candidate)];
    return firstError ? `${firstError.path || "/"}: ${firstError.message}` : "unbekannter Fehler";
}

/** Streng, wie der Server vor dem Senden: jedes Feld, das das Schema nicht kennt, ist ein Fehler. */
export function checkPointer<T extends TObject>(schema: T, candidate: unknown, what: string): Static<T> {
    if (!Value.Check(schema, candidate)) {
        throw new Error(`ungültiger ${what} (${describeFirstError(schema, candidate)})`);
    }
    return candidate;
}

/**
 * Tolerant, wie der Client: Unbekannte Felder fallen weg, die bekannten gelten nach demselben Schema. Der Rückgabewert
 * ist ein neues Objekt mit genau den Feldern des Schemas.
 */
export function readPointer<T extends TObject>(schema: T, candidate: unknown, what: string): Static<T> {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        // Kein Objekt: Das Schema meldet es mit seiner eigenen Meldung.
        return checkPointer(schema, candidate, what);
    }
    const known: Record<string, unknown> = {};
    for (const key of Object.keys(schema.properties)) {
        if (Object.hasOwn(candidate, key)) known[key] = (candidate as Record<string, unknown>)[key];
    }
    return checkPointer(schema, known, what);
}
