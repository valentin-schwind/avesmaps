import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance } from "fastify";
import type { Queryable } from "../database.ts";

/**
 * Herkunft einer Kartenoperation aus einem Community-Vorgang (WI-0268 C7; Fachkonzept WI-0263 §6 und §7, Migration 0272). Wer im Vorgang ⚙ drückt, öffnet den Editor
 * mit dem Vorgang als Herkunft; der Editor schickt dessen Nummer bei jedem Schreiben in der Kopfzeile `Avesmaps-Herkunft: COM-000123` mit
 * (`apps/web/src/community/herkunft.ts`), und `mapOperation` merkt sie sich in `map_operation.community_vorgang`. „Änderungen“ zeigt daran „aus COM-…“.
 *
 * - 🔴 **Keine Editor-Route ändert sich.** Die Kopfzeile wandert über einen Hook an der Wurzel in den asynchronen Kontext der Anfrage (wie `@fastify/request-context`);
 *   `einmal` in `map-operation.ts` liest sie dort. Der Hook ist `preHandler`, also nach dem Lesen des Rumpfs; nur schreibende Methoden, ein GET trägt nie eine Herkunft.
 * - 🔴 **Streng und ohne Schaden:** nur die Form `COM-` mit sechs bis zwölf Ziffern; nur eine Person als Handelnde (die Editor-Routen verlangen eine Sitzung mit
 *   Schreibrecht); und nur ein Vorgang, den es gibt (`pruefeHerkunft`, VOR der Transaktion der Operation). Alles andere lässt die Herkunft leer, statt das Speichern
 *   scheitern zu lassen: Ohne Rechte am Schema `avesmaps_community` (Stage vor den Grants) speichert der Editor wie bisher.
 */

export const HERKUNFT_KOPF = "avesmaps-herkunft";
const FORM = /^COM-(\d{6,12})$/u;
const SCHREIBEND = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const speicher = new AsyncLocalStorage<number>();

/** Die Vorgangsnummer aus der Kopfzeile, oder nichts, wenn sie fehlt oder nicht genau die Form `COM-000123` hat. */
export function leseHerkunft(kopf: string | string[] | undefined): number | undefined {
    if (typeof kopf !== "string") return undefined;
    const treffer = FORM.exec(kopf.trim());
    if (treffer === null) return undefined;
    const id = Number(treffer[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** Hängt den Hook an die Wurzel: vor allen Routen registrieren, damit er für jede gilt. */
export function registriereHerkunft(app: FastifyInstance): void {
    app.addHook("preHandler", (request, _reply, done) => {
        const id = SCHREIBEND.has(request.method) ? leseHerkunft(request.headers[HERKUNFT_KOPF]) : undefined;
        if (id === undefined) {
            done();
            return;
        }
        speicher.run(id, () => done());
    });
}

/** Die Herkunft der laufenden Anfrage (ungeprüft). */
export const anfrageHerkunft = (): number | undefined => speicher.getStore();

/** Für Tests und Werkzeuge: `arbeit` läuft mit dieser Herkunft, als käme sie aus der Kopfzeile. */
export const mitHerkunft = <T>(id: number, arbeit: () => T): T => speicher.run(id, arbeit);

/** Gibt es den Vorgang? Sonst, oder wenn das Schema nicht lesbar ist, keine Herkunft. */
export async function pruefeHerkunft(db: Queryable, id: number | undefined): Promise<number | undefined> {
    if (id === undefined) return undefined;
    try {
        const [zeile] = await db<
            { id: string }[]
        >`SELECT id::text AS id FROM avesmaps_community.vorgang WHERE id = ${id}`;
        return zeile === undefined ? undefined : id;
    } catch {
        return undefined;
    }
}
