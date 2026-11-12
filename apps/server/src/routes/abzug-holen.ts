import { createReadStream } from "node:fs";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { ABZUG_HOLEN_URL, ABZUG_KENNUNG_MUSTER, AbzugHolenListe } from "@avesmaps3d/shared";
import { dateinameFuer, findeAbzug, listeAbzuege } from "../abzug/ablage.ts";
import { merkeNutzung, pruefeSchluessel, schluesselAusKopf } from "../abzug/schluessel.ts";
import { recordEvent } from "../auth/audit.ts";
import { requestMeta } from "../auth/plugin.ts";
import { ADMIN_ERRORS } from "../auth/admin-guard.ts";
import { isNotProvisioned } from "../database.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Der Entwicklungsrechner holt einen Abzug selbst ab (WI-0251; Vali 2026-10-25). Stage und Production bieten dafür zwei Lesewege an, die statt einer Sitzung
 * einen Abzugs-Schlüssel verlangen (`Authorization: Bearer abz_…`, `abzug/schluessel.ts`; ein Admin legt ihn im Datenabgleich an):
 *
 *     GET /api/abzug-holen/liste               die fertigen Abzüge DIESER Umgebung, neueste zuerst
 *     GET /api/abzug-holen/:kennung/datei      die Datei als Strom; mit `Range: bytes=N-` setzt ein abgebrochenes Laden dort fort
 *
 * - 🔴 **Genau diese zwei Dinge, sonst nichts.** Der Schlüssel kennt weder Sitzung noch Recht; er öffnet keine andere Route. Er stößt auch keinen Abzug an
 *   (das ist `create_backup` mit Passkey) und liest nur die Ablage dieser Umgebung (`ABZUG_ROOT/<umgebung>/`, wie die Auslieferung per Link).
 * - **Protokoll:** Jedes Herunterladen schreibt ein Ereignis `backup.downloaded` (Akteur „Abzugs-Schlüssel“ und seine Kurzkennung); ein Fortsetzen mit
 *   `Range` ab der Mitte schreibt keines (es ist dasselbe Herunterladen). Ohne Eintrag im Protokoll gibt es keine Datei (fail-closed).
 * - Die Datei geht ungepuffert hinaus (Stream, nie im Speicher); die Zeitgrenzen des Nginx davor (`proxy_read_timeout`, `proxy_buffering`) gehören zur
 *   Einrichtung dort (Claudio).
 */

const strict = { additionalProperties: false } as const;
const KennungParam = Type.Object({ kennung: Type.String({ pattern: ABZUG_KENNUNG_MUSTER }) }, strict);
const ERROR_RESPONSES = { ...ADMIN_ERRORS, 401: ADMIN_ERRORS[401], 416: ADMIN_ERRORS[400] };

/** Der Bereich einer `Range`-Zeile (nur ein einzelner, `bytes=N-` oder `bytes=N-M`); `null`: nicht zu erfüllen (416); `undefined`: keine Zeile. */
export function leseBereich(
    kopf: string | undefined,
    groesse: number,
): { start: number; ende: number } | null | undefined {
    if (kopf === undefined) return undefined;
    const treffer = /^bytes=(\d+)-(\d*)$/u.exec(kopf);
    if (treffer === null) return null;
    const start = Number(treffer[1]);
    const ende = treffer[2] === "" ? groesse - 1 : Math.min(Number(treffer[2]), groesse - 1);
    if (!Number.isSafeInteger(start) || start >= groesse || ende < start) return null;
    return { start, ende };
}

export const abzugHolenRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const abzug = app.config.abzug;
    if (abzug === undefined || !abzug.rollen.includes("erstellen")) return;
    const quelle = abzug.quelle!;
    const geprueft = new WeakMap<FastifyRequest, string>();

    /** Der Wächter dieser Lesewege: ein gültiger Schlüssel dieser Umgebung (401 sonst), vor der Prüfung der Anfrage. */
    const waechter = async (request: FastifyRequest): Promise<void> => {
        const database = app.database;
        if (database === undefined || app.authConfig.environment === undefined) {
            throw new ApiError(503, "auth_unavailable", "Die Anmeldung ist auf dieser Instanz nicht eingerichtet.");
        }
        let urteil;
        try {
            urteil = await pruefeSchluessel(database, schluesselAusKopf(request.headers.authorization), quelle);
        } catch (error) {
            if (isNotProvisioned(error)) {
                throw new ApiError(503, "auth_unavailable", "Die Anmeldung ist auf dieser Instanz noch nicht bereit.");
            }
            throw error;
        }
        if (!urteil.ok) {
            throw urteil.grund === "abgelaufen"
                ? new ApiError(401, "abzug_schluessel_abgelaufen", "Dieser Schlüssel ist abgelaufen oder widerrufen.")
                : new ApiError(401, "abzug_schluessel_ungueltig", "Dieser Schlüssel gilt hier nicht.");
        }
        geprueft.set(request, urteil.id);
        await merkeNutzung(database, urteil.id);
    };
    const wacht = {
        config: { auth: "abzug_schluessel" as const, errorEnvelope: true as const },
        preValidation: waechter,
    };

    app.get(
        `${ABZUG_HOLEN_URL}/liste`,
        { ...wacht, schema: { response: { 200: AbzugHolenListe, ...ERROR_RESPONSES } } },
        async (_request, reply) => {
            void reply.header("cache-control", "no-store");
            const dateien = abzug.wurzel === undefined ? [] : await listeAbzuege(abzug.wurzel, quelle);
            return {
                umgebung: quelle,
                jetzt: new Date().toISOString(),
                abzuege: dateien.map((datei) => ({
                    kennung: datei.kennung,
                    erstellt: datei.erstellt,
                    bytes: datei.bytes,
                    tafeln: datei.tafeln,
                    zeilen: datei.zeilen,
                    medien: datei.medien,
                    medienBytes: datei.medienBytes,
                    laeuftAb: datei.laeuftAb,
                })),
            };
        },
    );

    app.get(
        `${ABZUG_HOLEN_URL}/:kennung/datei`,
        { ...wacht, schema: { params: KennungParam, response: { ...ERROR_RESPONSES } } },
        async (request, reply) => {
            if (abzug.wurzel === undefined) {
                throw new ApiError(
                    503,
                    "abzug_ablage_fehlt",
                    "Auf dieser Instanz ist keine Ablage für Abzüge eingerichtet (ABZUG_ROOT).",
                );
            }
            const datei = await findeAbzug(abzug.wurzel, quelle, request.params.kennung);
            if (datei === null) {
                throw new ApiError(
                    404,
                    "abzug_unbekannt",
                    "Diesen Abzug gibt es nicht (mehr). Er wird nach 24 Stunden gelöscht.",
                );
            }
            const bereich = leseBereich(request.headers.range, datei.bytes);
            if (bereich === null) {
                return reply
                    .code(416)
                    .header("content-range", `bytes */${String(datei.bytes)}`)
                    .header("cache-control", "no-store")
                    .type("application/json; charset=utf-8")
                    .send({
                        error: { code: "range_not_satisfiable", message: "Dieser Bereich liegt außerhalb der Datei." },
                    });
            }
            // Das Herunterladen steht im Protokoll, bevor die erste Byte hinausgeht; ein Fortsetzen ab der Mitte ist dasselbe Herunterladen.
            if (bereich === undefined || bereich.start === 0) {
                const id = geprueft.get(request) ?? "";
                await recordEvent(app.database!, {
                    environment: app.authConfig.environment!,
                    actorKind: "system",
                    actorLabel: `abzug-schluessel:${id.slice(0, 8)}`,
                    action: "backup.downloaded",
                    targetRef: `abzug:${quelle}:${datei.kennung}`,
                    details: { name: dateinameFuer(quelle, datei.kennung) },
                    ...requestMeta(request),
                });
            }
            const laenge = bereich === undefined ? datei.bytes : bereich.ende - bereich.start + 1;
            void reply
                .code(bereich === undefined ? 200 : 206)
                .header("content-type", "application/x-tar")
                .header("content-length", String(laenge))
                .header("accept-ranges", "bytes")
                .header("content-disposition", `attachment; filename="${dateinameFuer(quelle, datei.kennung)}"`)
                .header("cache-control", "no-store")
                .header("x-content-type-options", "nosniff");
            if (bereich !== undefined) {
                void reply.header(
                    "content-range",
                    `bytes ${String(bereich.start)}-${String(bereich.ende)}/${String(datei.bytes)}`,
                );
            }
            // Der Strom ist keine JSON-Antwort: Das Schema kennt nur die Fehlerhüllen, die Datei geht am Schema vorbei.
            return reply.send(
                createReadStream(
                    datei.tarPfad,
                    bereich === undefined ? {} : { start: bereich.start, end: bereich.ende },
                ) as never,
            );
        },
    );
};
