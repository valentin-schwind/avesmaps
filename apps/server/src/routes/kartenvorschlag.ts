import { createHash, randomInt } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    ApiErrorBody,
    KARTENVORSCHLAG_GRENZEN,
    KARTENVORSCHLAG_EINREICHEN_SCHALTER,
    KARTENVORSCHLAG_REDAKTION_URL,
    KARTENVORSCHLAG_SCHLUESSEL_KOPF,
    KARTENVORSCHLAG_URL,
    KartenvorschlagAblehnen,
    KartenvorschlagAnnehmen,
    KartenvorschlagDateiAngenommen,
    KartenvorschlagDetail,
    KartenvorschlagEingegangen,
    KartenvorschlagEinreichung,
    KartenvorschlagListe,
    KartenvorschlagListeQuery,
    KartenvorschlagParams,
    KartenvorschlagStand,
    KartenvorschlagStatus,
    KartenvorschlagStatusBody,
    KartenvorschlagZurueckziehen,
    STATUS_SCHLUESSEL_MUSTER,
    kartenvorschlagNummer,
    type KartenvorschlagZustand,
} from "@avesmaps3d/shared";
import type { FastifyInstance, onRequestAsyncHookHandler } from "fastify";
import { ADMIN_ERRORS, actorFields, adminSession, noStore } from "../auth/admin-guard.ts";
import { recordEvent } from "../auth/audit.ts";
import { hatRecht, protectEines, sameOriginRequest } from "../auth/plugin.ts";
import type { Sql } from "../auth/session-store.ts";
import type { GlockeLog } from "../community/glocke.ts";
import { isNotProvisioned, type Database } from "../database.ts";
import { ApiError, apiErrorBody } from "../http/api-error.ts";
import { annehmen } from "../kartenvorschlag/annehmen.ts";
import { dateiAnnehmen, einreichen } from "../kartenvorschlag/einreichen.ts";
import { kartenvorschlagBereit, nichtGefunden } from "../kartenvorschlag/db.ts";
import { meldeNeuenKartenvorschlag } from "../kartenvorschlag/glocke.ts";
import { ablehnen, detail, liste } from "../kartenvorschlag/redaktion.ts";
import { statusLesen, zurueckziehen } from "../kartenvorschlag/status.ts";
import { createRateLimiter } from "../share/rate-limiter.ts";
import { istAus } from "../system/inhaltsstand.ts";
import { storeOf } from "./media-editor-operations.ts";

/**
 * Karte vorschlagen (WI-0275 Stufe B): Besucher ohne Konto schlagen eine Karte für die Kartensammlung vor, die Redaktion prüft. Die Regeln (Prüfung der
 * Datei, Übergänge, Idempotenz) stehen in `kartenvorschlag/`; hier sind Herkunft, Drossel, Falle und die Übersetzung in HTTP. Muster: `routes/photobox.ts`.
 *
 * Öffentlich (ohne Anmeldung, nur von der eigenen Seite, `no-store`, Schreibklasse `public`):
 *
 *     GET  /api/kartenvorschlaege/stand               nimmt der Server Vorschläge an?
 *     POST /api/kartenvorschlaege/einreichungen       die Angaben (201 `{ ok, nummer, dateiNoetig }`)
 *     PUT  /api/kartenvorschlaege/datei               die Bytes einer Datei (roher Rumpf bis 50 MiB, Kopf `x-vorschlag-schluessel`)
 *     POST /api/kartenvorschlaege/status              der Stand zum Schlüssel (`KartenvorschlagStatus`)
 *     POST /api/kartenvorschlaege/status/zurueckziehen  zurückziehen (vor der Entscheidung)
 *
 * Redaktion (`moderate_submissions`, Schreibklasse `community`; die Person kommt aus der Sitzung):
 *
 *     GET  /api/community/kartenvorschlaege?segment&q&zustand&limit&nach   der Korb (Vorgabe: die wartenden), mit Zählern je Zustand
 *     GET  /api/community/kartenvorschlaege/:id                   ein Vorschlag mit allen Angaben
 *     POST /api/community/kartenvorschlaege/:id/ablehnen          ablehnen (mit Grund, der Einreicher liest ihn)
 *     POST /api/community/kartenvorschlaege/:id/annehmen          annehmen: legt die Karte in der Kartensammlung an (Schreibklasse `map`)
 *
 * - 🔴 **Der Schlüssel der Statusseite** (32 Zufallsbytes, nur beim Einreicher) steht im Rumpf bzw. im Kopf, nie in der Adresse, und in keiner Logzeile,
 *   keiner Fehlermeldung und keiner Antwort. In der Datenbank liegt nur sein Hash. Ein falscher Schlüssel antwortet immer mit demselben 404-Satz.
 * - 🔴 **Missbrauch:** Honigtopf und Zeitfalle verwerfen still (201 mit erfundener Nummer, KEIN Vorschlag). Die Drossel zählt je Adresse und Stunde
 *   sowie insgesamt je Tag (Einreichungen und, getrennt, Dateien) und je Adresse und Stunde (Statusseite), nur im Speicher und mit gehashter Adresse.
 *   Reihenfolge beim Einreichen: Drossel, Honigtopf und Zeitfalle, Arbeit; gezählt wird beim Eintritt, auch ein Fallen-Treffer und ein Fehlversuch zählen.
 *   Die Drossel sitzt im `onRequest`, also VOR dem Lesen des Rumpfs (bei einer Datei bis 50 MiB): Eine gedrosselte Anfrage kostet weder Speicher noch Datenbank.
 * - 🔴 **Nie öffentlich ohne Redaktion:** Nur das Annehmen einer berechtigten Person legt eine Karte an (`kartenvorschlag/annehmen.ts`); die Datei wird dadurch
 *   nicht öffentlich, das entscheidet die Freigabe des Werks.
 * - **Notaus:** Ist der Schalter `kartenvorschlag.submissions` aus, antwortet `POST …/einreichungen` 503 `kartenvorschlag_paused` und `GET …/stand` meldet
 *   `einreichen: false`; Eingereichtes (Datei nachreichen, Status, Zurückziehen) und die Redaktion laufen weiter.
 * - 🪤 **Ablehnung vor dem Lesen des Rumpfs:** Antwortet die App auf eine Datei, bevor sie den Rumpf gelesen hat (Herkunft, Drossel), bricht ein
 *   ungepufferter Proxy mit 502 ab. Nginx muss für diese Route `client_max_body_size 51m` und `proxy_request_buffering on` haben (Handover an Claudio).
 * - 🪤 `request.ip` stimmt nur, weil die App allein dem Proxy auf derselben Maschine traut (`trustProxy: "loopback"`, `app.ts`).
 * - Die 6-MiB-Grenze der Medienverwaltung (D2) bleibt unberührt; die 50 MiB gelten nur für `PUT …/datei`.
 */

const NICHT_BEREIT =
    "Kartenvorschläge sind auf dieser Instanz noch nicht eingerichtet: eine Migration oder ein Recht fehlt.";

const FEHLER = { ...ADMIN_ERRORS, 413: ApiErrorBody, 415: ApiErrorBody, 422: ApiErrorBody, 429: ApiErrorBody };
const REDAKTION_RUMPF = 16 * 1024;

/** Ein kurzer Hash der Adresse für die Drossel: Die Adresse selbst wird nirgends gehalten (wie `photobox.ts`, `community.ts`). */
const adresse = (ip: string): string => createHash("sha256").update(ip).digest("base64").slice(0, 16);

const zuViele = (): ApiError =>
    new ApiError(429, "kartenvorschlag_rate", "Gerade sind zu viele Anfragen eingegangen. Später geht es wieder.", {
        retryAfterSeconds: 3600,
    });

/** Nur von der eigenen Seite (Origin passt zur öffentlichen Adresse bzw. zum Host): eine fremde Seite soll hier nichts einwerfen. */
function nurEigeneSeite(app: FastifyInstance): onRequestAsyncHookHandler {
    return async (request, reply) => {
        void reply.header("cache-control", "no-store");
        if (!sameOriginRequest(request, app.authConfig)) {
            return reply
                .code(403)
                .send(apiErrorBody("forbidden_origin", "Diese Anfrage muss von Avesmaps selbst kommen."));
        }
    };
}

/** Schema oder Recht fehlt noch (der Korridor startet Fastify vor `migrate`): 503 statt 500. */
async function uebersetzt<T>(lauf: () => Promise<T>): Promise<T> {
    try {
        return await lauf();
    } catch (fehler) {
        if (isNotProvisioned(fehler)) throw new ApiError(503, "kartenvorschlag_unavailable", NICHT_BEREIT);
        throw fehler;
    }
}

export const kartenvorschlagRoutes: FastifyPluginAsyncTypebox = async (app) => {
    noStore(app);
    const db = (): Database => {
        if (app.database === undefined) throw new ApiError(503, "kartenvorschlag_unavailable", NICHT_BEREIT);
        return app.database;
    };

    // Die Rohbytes einer Datei: ganz lesen (Grenze: Datei plus ein Rest), die Route prüft sie danach.
    app.addContentTypeParser(
        "application/octet-stream",
        { parseAs: "buffer", bodyLimit: KARTENVORSCHLAG_GRENZEN.dateiBytes + 64 * 1024 },
        (_request, body, done) => done(null, body),
    );

    // Die Drossel lebt im Speicher dieser Instanz und wird nie gespeichert.
    const jeStunde = createRateLimiter(KARTENVORSCHLAG_GRENZEN.jeAdresseJeStunde, 3_600_000);
    const jeTag = createRateLimiter(KARTENVORSCHLAG_GRENZEN.jeTag, 86_400_000);
    const dateiJeStunde = createRateLimiter(KARTENVORSCHLAG_GRENZEN.dateiJeAdresseJeStunde, 3_600_000);
    const dateiJeTag = createRateLimiter(KARTENVORSCHLAG_GRENZEN.dateiJeTag, 86_400_000);
    const statusJeStunde = createRateLimiter(KARTENVORSCHLAG_GRENZEN.statusJeStunde, 3_600_000);

    /** Der Schalter „Vorschläge annehmen“: gelesen wird der Stand aus dem Speicher der Anwendung, nicht je Anfrage aus der Datenbank. */
    const einreichenAus = async (): Promise<boolean> => {
        const store = app.inhaltsschalter;
        return store !== undefined && istAus(await store.read(), KARTENVORSCHLAG_EINREICHEN_SCHALTER);
    };

    /** Die Glocke der Redaktion; ohne Umgebung (Werkzeuge) schweigt sie. */
    const glocke =
        (log: GlockeLog) =>
        async (tx: Sql, id: string): Promise<void> => {
            const umgebung = app.authConfig.environment;
            if (umgebung !== undefined) await meldeNeuenKartenvorschlag(tx, log, umgebung, id);
        };

    const herkunft = nurEigeneSeite(app);
    const oeffentlich = (
        stufe: onRequestAsyncHookHandler,
        rumpfBytes: number = KARTENVORSCHLAG_GRENZEN.rumpfBytes,
    ) => ({
        config: { auth: "public" as const, writeClass: "public" as const, errorEnvelope: true as const },
        bodyLimit: rumpfBytes,
        onRequest: [herkunft, stufe],
    });

    /** Einreichen: Drossel der Adresse (jeder Versuch zählt) und Prüfen des Tagesbudgets; gezählt wird dieses nach der Falle in der Route. */
    const einreichenStufe: onRequestAsyncHookHandler = async (request) => {
        // Erst der Schalter (ein Notaus kostet weder Drossel noch Rumpf), dann die Drossel der Adresse.
        if (await einreichenAus()) {
            throw new ApiError(
                503,
                "kartenvorschlag_paused",
                "Kartenvorschläge werden gerade nicht angenommen. Bitte später noch einmal versuchen.",
            );
        }
        const key = adresse(request.ip);
        if (!jeStunde.allows(key) || !jeTag.allows("alle")) throw zuViele();
        jeStunde.record(key);
    };
    const statusStufe: onRequestAsyncHookHandler = async (request) => {
        const key = adresse(request.ip);
        if (!statusJeStunde.allows(key)) throw zuViele();
        statusJeStunde.record(key);
    };
    /** Die Datei zählt beim Eintritt in der Drossel der Adresse UND im Tagesbudget aller (jeder Versuch kostet Speicher und Rechenzeit). */
    const dateiStufe: onRequestAsyncHookHandler = async (request) => {
        const key = adresse(request.ip);
        if (!dateiJeStunde.allows(key) || !dateiJeTag.allows("alle")) throw zuViele();
        dateiJeStunde.record(key);
        dateiJeTag.record("alle");
    };

    app.get(
        `${KARTENVORSCHLAG_URL}/stand`,
        {
            config: { auth: "public", errorEnvelope: true },
            schema: { response: { 200: KartenvorschlagStand, 503: ApiErrorBody } },
            onRequest: async (_request, reply) => {
                void reply.header("cache-control", "no-store");
            },
        },
        async () => {
            if (app.database === undefined || (await einreichenAus())) return { einreichen: false };
            // Fehlt die Tafel oder das Recht, geht das Formular nicht; das ist ein Stand, kein Fehler.
            return { einreichen: await kartenvorschlagBereit(app.database) };
        },
    );

    app.post(
        `${KARTENVORSCHLAG_URL}/einreichungen`,
        {
            ...oeffentlich(einreichenStufe),
            schema: { body: KartenvorschlagEinreichung, response: { 201: KartenvorschlagEingegangen, ...FEHLER } },
        },
        async (request, reply) => {
            const body = request.body;
            // Honigtopf (ein Feld, das ein Mensch nie sieht) und Zeitfalle (schneller als ein Mensch tippt): still verwerfen. Der Bot sieht einen
            // Erfolg, es entsteht nichts. Der Treffer hat in der Stufe davor in der Drossel der Adresse gezählt, das Tagesbudget bleibt unberührt.
            if (body.falle.feld.trim() !== "" || body.falle.dauerMs < KARTENVORSCHLAG_GRENZEN.mindestDauerMs) {
                request.log.info("Kartenvorschlag: Einreichung von der Falle verworfen");
                return reply.code(201).send({
                    ok: true,
                    nummer: kartenvorschlagNummer(randomInt(1000, 9999)),
                    dateiNoetig: body.weg === "datei",
                });
            }
            // Das Tagesbudget aller begrenzt den Speicher: gezählt wird erst, wenn die Arbeit gelang (ein gescheiterter Versuch belegt nichts).
            if (!jeTag.allows("alle")) throw zuViele();
            const quittung = await uebersetzt(() => einreichen(db(), body, glocke(request.log)));
            jeTag.record("alle");
            return reply.code(201).send({ ok: true, ...quittung });
        },
    );

    app.put(
        `${KARTENVORSCHLAG_URL}/datei`,
        {
            ...oeffentlich(dateiStufe, KARTENVORSCHLAG_GRENZEN.dateiBytes + 64 * 1024),
            schema: { response: { 200: KartenvorschlagDateiAngenommen, ...FEHLER } },
        },
        async (request) => {
            const kopf = request.headers[KARTENVORSCHLAG_SCHLUESSEL_KOPF];
            const schluessel = typeof kopf === "string" ? kopf : "";
            // Ein Schlüssel, der keiner sein kann, ist wie ein falscher: derselbe 404-Satz.
            if (!new RegExp(STATUS_SCHLUESSEL_MUSTER).test(schluessel)) throw nichtGefunden();
            const bytes: unknown = request.body;
            if (!Buffer.isBuffer(bytes)) {
                throw new ApiError(
                    415,
                    "unsupported_media_type",
                    "Die Datei kommt als roher Rumpf (application/octet-stream).",
                    { reason: "kein_roher_rumpf" },
                );
            }
            const ergebnis = await uebersetzt(() =>
                dateiAnnehmen(db(), storeOf(app), schluessel, bytes, glocke(request.log)),
            );
            return { ok: true as const, zustand: ergebnis.zustand as KartenvorschlagZustand };
        },
    );

    app.post(
        `${KARTENVORSCHLAG_URL}/status`,
        {
            ...oeffentlich(statusStufe),
            schema: { body: KartenvorschlagStatusBody, response: { 200: KartenvorschlagStatus, ...FEHLER } },
        },
        async (request) => {
            const status = await uebersetzt(() => statusLesen(db(), request.body.schluessel));
            if (status === null) throw nichtGefunden();
            return status;
        },
    );

    app.post(
        `${KARTENVORSCHLAG_URL}/status/zurueckziehen`,
        {
            ...oeffentlich(statusStufe),
            schema: { body: KartenvorschlagZurueckziehen, response: { 200: KartenvorschlagStatus, ...FEHLER } },
        },
        async (request) => uebersetzt(() => zurueckziehen(db(), request.body)),
    );

    // --- Redaktion --------------------------------------------------------------------------------------------------------------

    const lesen = protectEines(["moderate_submissions", "moderate_map_suggestions"]);
    const schreiben = protectEines(["moderate_submissions", "moderate_map_suggestions"], { writeClass: "community" });

    app.get(
        KARTENVORSCHLAG_REDAKTION_URL,
        {
            ...lesen,
            schema: {
                querystring: KartenvorschlagListeQuery,
                response: { 200: KartenvorschlagListe, ...ADMIN_ERRORS },
            },
        },
        async (request) => uebersetzt(() => liste(db(), request.query)),
    );

    app.get(
        `${KARTENVORSCHLAG_REDAKTION_URL}/:id`,
        {
            ...lesen,
            schema: { params: KartenvorschlagParams, response: { 200: KartenvorschlagDetail, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const mitVorschau = hatRecht(session, "view_media_private", app.authConfig);
            const vorschlag = await uebersetzt(() => detail(db(), request.params.id, { mitVorschau }));
            if (vorschlag === undefined)
                throw new ApiError(404, "kartenvorschlag_not_found", "Diesen Kartenvorschlag gibt es nicht.");
            return vorschlag;
        },
    );

    app.post(
        `${KARTENVORSCHLAG_REDAKTION_URL}/:id/ablehnen`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: {
                params: KartenvorschlagParams,
                body: KartenvorschlagAblehnen,
                response: { 200: KartenvorschlagDetail, ...FEHLER },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = request.params.id;
            const fertig = await uebersetzt(() =>
                db().begin(async (tx) => {
                    const ergebnis = await ablehnen(tx, session.personId, id, request.body);
                    // Das Ereignis nur, wenn wirklich etwas geschah (nicht bei einer Wiederholung), in derselben Transaktion.
                    if (ergebnis.wirklich) {
                        await recordEvent(tx, {
                            ...actorFields(session, request),
                            action: "system.community_kartenvorschlag_abgelehnt",
                            targetRef: id,
                            details: { vorschlag: id, zustand: "rejected" },
                        });
                    }
                    return ergebnis.vorschlag;
                }),
            );
            return fertig as KartenvorschlagDetail;
        },
    );

    // Annehmen legt eine Karte der Kartensammlung an: Kartendaten und Inhalte, also Schreibklasse `map` (423 bei Kartensperre) und die geteilte Sperre der
    // Kartendomäne gegen den Legacy-Zug (503 `map_import_running`).
    const annehmenRecht = protectEines(["moderate_submissions", "moderate_map_suggestions"], { writeClass: "map" });
    app.post(
        `${KARTENVORSCHLAG_REDAKTION_URL}/:id/annehmen`,
        {
            ...annehmenRecht,
            bodyLimit: REDAKTION_RUMPF,
            schema: {
                params: KartenvorschlagParams,
                body: KartenvorschlagAnnehmen,
                response: { 200: KartenvorschlagDetail, ...FEHLER },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = request.params.id;
            await uebersetzt(() =>
                annehmen(
                    db(),
                    { personId: session.personId, environment: session.environment },
                    id,
                    request.body,
                    async (tx, kennungen) => {
                        // Das Ereignis nur, wenn wirklich etwas geschah (nicht bei einer Wiederholung), in derselben Transaktion wie die Karte.
                        await recordEvent(tx, {
                            ...actorFields(session, request),
                            action: "system.community_kartenvorschlag_angenommen",
                            targetRef: kennungen.vorschlag,
                            details: { vorschlag: kennungen.vorschlag, zustand: "approved", karte: kennungen.karte },
                        });
                    },
                ),
            );
            const vorschlag = await uebersetzt(() => detail(db(), id));
            if (vorschlag === undefined)
                throw new ApiError(404, "kartenvorschlag_not_found", "Diesen Kartenvorschlag gibt es nicht.");
            return vorschlag;
        },
    );
};
