import { Value } from "@sinclair/typebox/value";
import type { Static, TSchema } from "@sinclair/typebox";

/**
 * Prüft, ob ein Wert dem Vertrag aus `@avesmaps3d/shared` entspricht, und wirft sonst mit allen Abweichungen (WI-0252).
 *
 * 🔴 Anlass: „Wege löschen“ und „Flächen vereinigen“ liefen in den Browserfällen gegen Stubs und waren grün, auf der Stage ging keines. Ein
 * Stub, der den Vertrag nur nachspielt, sagt nichts, wenn er sich vom echten Server entfernt (Form der Antwort) oder die Oberfläche etwas
 * schickt, das der Server mit 400 abwiese (Form der Anfrage, etwa zu viele Abschnitte). Die Stubs prüfen darum BEIDE Seiten gegen dasselbe
 * Schema, das der Server benutzt (`schema: { body, response }` der Route). Was nur echte Daten zeigen (ungültige Ränder, Zeitgrenzen),
 * prüfen die Fälle gegen den echten Server in der Wegwerf-Welt (`wegeditor-echt.spec.ts`, `flaechen-echt.spec.ts`).
 */
export function vertragGilt<T extends TSchema>(schema: T, wert: unknown, was: string): Static<T> {
    const fehler = [...Value.Errors(schema, wert)].map((e) => `${e.path || "/"}: ${e.message}`);
    if (fehler.length > 0) throw new Error(`${was} weicht vom Vertrag ab: ${fehler.join("; ")}`);
    return wert as Static<T>;
}
