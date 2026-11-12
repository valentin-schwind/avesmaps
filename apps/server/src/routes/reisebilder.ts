import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { MEDIA_REISEBILDER_PUBLIC_URL, REISEBILD_LESEN_JE_STUNDE, ausschnittGueltig } from "@avesmaps3d/shared";
import type { onRequestAsyncHookHandler } from "fastify";
import { isNotProvisioned } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { liesReisebilder, reisebilderLeer } from "../photobox/karte.ts";
import { createRateLimiter } from "../share/rate-limiter.ts";

/**
 * Die Reisebilder für die Karte, öffentlich (WI-0272 S4, Aufgabe 23): `GET /api/media/reisebilder?x0=&y0=&x1=&y1=` liefert die freigegebenen Bilder im gerasterten
 * Ausschnitt (`ReisebilderAntwort`). Was erscheinen darf, entscheidet allein `decidePublication` im Resolver (`resolveReisebilder`); diese Route fragt Drossel,
 * Ausschnitt und Zwischenspeicher (`photobox/karte.ts`).
 *
 * - **Drossel zuerst:** je Adresse und Stunde ({@link REISEBILD_LESEN_JE_STUNDE}), im `onRequest`, also vor Schema, Ausschnitt und jeder Datenbankfrage; gezählt wird
 *   beim Eintritt, nur im Speicher und mit gehashter Adresse (wie `routes/photobox.ts`). Darüber ist es 429 `reisebilder_rate`.
 * - **Ausschnitt:** Er muss auf dem Raster liegen und in der Welt (`ausschnittGueltig`), sonst 422 `reisebilder_ausschnitt`. Die Zahlen kommen als Zahlen an; ob sie ganz
 *   sind, entscheidet `ausschnittGueltig` und nicht das Schema, damit jede Verletzung dieselbe Antwort ist.
 * - **Zwischenspeicher in drei Stufen:** Der Browser darf nicht ohne Rückfrage wiederverwenden (`cache-control: no-cache`, ETag, 304 bei `if-none-match`), der Server
 *   hält 15 s je Ausschnitt und leert sich bei Offline und Notaus sofort. Ein längeres `max-age` widerspräche „sofort weg“.
 * - **Ohne Datenbank oder Schema** (die Instanz ist nicht eingerichtet): 200 mit `{ an: false, bilder: [], gekappt: false }`, kein Fehler: Die Karte zeigt dann nichts.
 * - Eigenes Plugin und kein `noStore`: Die Antwort ist zwischenspeicherbar (mit Rückfrage). Nur Lesen, darum keine Schreibklasse.
 */

/** Die Zahlen des Ausschnitts, wie sie ankommen: Ob sie ganz sind und auf dem Raster liegen, prüft `ausschnittGueltig` (422), nicht das Schema (400). */
const Anfrage = Type.Object({
    x0: Type.Number(),
    y0: Type.Number(),
    x1: Type.Number(),
    y1: Type.Number(),
});

/** Ein kurzer Hash der Adresse für die Drossel: Die Adresse selbst wird nirgends gehalten (wie `photobox.ts`, `community.ts`). */
const adresse = (ip: string): string => createHash("sha256").update(ip).digest("base64").slice(0, 16);

/** Nennt der Browser den ETag der Antwort? Ein Proxy darf ihn schwächen (`W/"…"`) oder mehrere nennen; verglichen wird der Wert. */
function etagPasst(angefragt: string | undefined, etag: string): boolean {
    if (angefragt === undefined) return false;
    return angefragt.split(",").some((teil) => teil.trim().replace(/^W\//u, "") === etag);
}

export interface ReisebilderOptionen {
    /** Lesende Aufrufe je Adresse und Stunde; nur die Tests setzen sie. */
    jeStunde?: number;
}

export const reisebilderRoutes: FastifyPluginAsyncTypebox<ReisebilderOptionen> = async (app, options) => {
    // Die Drossel lebt im Speicher dieser Instanz und wird nie gespeichert.
    const drossel = createRateLimiter(options.jeStunde ?? REISEBILD_LESEN_JE_STUNDE, 3_600_000);

    const lesenStufe: onRequestAsyncHookHandler = async (request) => {
        const key = adresse(request.ip);
        if (!drossel.allows(key)) {
            throw new ApiError(
                429,
                "reisebilder_rate",
                "Gerade sind zu viele Anfragen eingegangen. Später geht es wieder.",
                { retryAfterSeconds: 3600 },
            );
        }
        drossel.record(key);
    };

    app.get(
        MEDIA_REISEBILDER_PUBLIC_URL,
        {
            config: { auth: "public", errorEnvelope: true },
            // Keine Antwortform: Die Antwort ist der fertige Text aus dem Zwischenspeicher (`ReisebilderAntwort`), bei 304 leer.
            schema: { querystring: Anfrage },
            onRequest: lesenStufe,
        },
        async (request, reply) => {
            const ausschnitt = request.query;
            if (!ausschnittGueltig(ausschnitt)) {
                throw new ApiError(
                    422,
                    "reisebilder_ausschnitt",
                    "Dieser Ausschnitt passt nicht zum Raster der Karte.",
                );
            }
            let antwort = reisebilderLeer();
            if (app.database !== undefined) {
                try {
                    antwort = await liesReisebilder(app.database, ausschnitt);
                } catch (fehler) {
                    // Schema oder Recht fehlt noch (der Korridor startet Fastify vor `migrate`): Es gibt nichts zu zeigen, und das ist kein Fehler.
                    if (!isNotProvisioned(fehler)) throw fehler;
                }
            }
            void reply.header("cache-control", "no-cache").header("etag", antwort.etag);
            if (etagPasst(request.headers["if-none-match"], antwort.etag)) return reply.code(304).send();
            return reply.header("content-type", "application/json; charset=utf-8").send(antwort.body);
        },
    );
};
