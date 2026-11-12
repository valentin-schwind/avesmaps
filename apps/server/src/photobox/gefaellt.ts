import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * „Gefällt mir“ an einem Reisebild (WI-0304, nach den Bewertungen, WI-0269 C10): Die Regel steht in der Datenbank (`public.photobox_gefaellt`, Migration 0337). Sie zählt nur
 * an einem freigegebenen, nicht offline genommenen Reisebild, nie unter 0, und speichert nur die Zahl. Hier wird nur der Fehlercode der Funktion in eine Antwort übersetzt.
 */

/** Das Reisebild gibt es nicht (mehr) oder es ist nicht freigegeben: 404 mit dem Fachcode `reisebild_unbekannt` für den Satz des Fensters. */
export const reisebildUnbekannt = (): ApiError =>
    new ApiError(404, "photobox_not_found", "Dieses Reisebild gibt es nicht (mehr).", {
        reason: "reisebild_unbekannt",
    });

/** „Gefällt mir“ setzen (`1`) oder zurücknehmen (`-1`). Antwort: die Zahl danach. */
export async function reisebildGefaellt(db: Queryable, id: string, delta: 1 | -1): Promise<number> {
    try {
        const [row] = await db<{ zahl: number }[]>`SELECT public.photobox_gefaellt(${id}::uuid, ${delta}::int) AS zahl`;
        return Number(row?.zahl ?? 0);
    } catch (fehler) {
        if ((fehler as { code?: unknown } | undefined)?.code === "KC404") throw reisebildUnbekannt();
        throw fehler;
    }
}
