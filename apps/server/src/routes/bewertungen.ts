import { createHash, randomInt, randomUUID } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    ApiErrorBody,
    BEWERTUNGEN_URL,
    BEWERTUNG_GRENZEN,
    BewertungAntwort,
    BewertungBody,
    BewertungDetail,
    BewertungListe,
    BewertungMeldenBody,
    BewertungParams,
    BewertungQuittung,
    BewertungSchrittBody,
    BewertungVerbergenBody,
    BewertungenQuery,
    GefaelltAntwort,
    GefaelltBody,
    MeldungAntwort,
    aventurischesDatumHeute,
    comNummer,
    normalisiereAventurischesDatum,
} from "@avesmaps3d/shared";
import type { FastifyInstance, FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import { ADMIN_ERRORS, actorFields, adminSession, noStore } from "../auth/admin-guard.ts";
import { recordEvent, type AuditAction } from "../auth/audit.ts";
import { protect, sameOriginRequest } from "../auth/plugin.ts";
import type { SessionRecord } from "../auth/session-store.ts";
import { isNotProvisioned, type Queryable } from "../database.ts";
import { bewertungVerdacht } from "../community/bewertung-verdacht.ts";
import {
    bewertungDetail,
    bewertungEinblenden,
    bewertungFreigeben,
    bewertungGefaellt,
    bewertungInhaltLoeschen,
    bewertungMelden,
    bewertungSchreiben,
    bewertungSichten,
    bewertungVerbergen,
    bewertungenListe,
} from "../community/bewertungen.ts";
import { CommunityFehler, type CommunityFehlerCode } from "../community/db.ts";
import { bestenfalls, neueBewertung } from "../community/glocke.ts";
import { ApiError, apiErrorBody } from "../http/api-error.ts";
import { createRateLimiter } from "../share/rate-limiter.ts";

/**
 * Bewertungen an der Leitung (WI-0269 C10, Fachkonzept §14, Bedienkonzept §6). Die Regeln (Zustände, Revision, Idempotenz) stehen in der Datenbank
 * (Migration 0266, `community/bewertungen.ts`); hier wird nur angenommen, begrenzt, geprüft und übersetzt. Gelesen wird die Sektion „Bewertung“ eines
 * Orts weiter über `GET /api/subjects/place/:id/reviews` (nur Öffentliches).
 *
 * Öffentlich (ohne Anmeldung, nur von der eigenen Seite, `no-store`, Schreibklasse `public`):
 *
 *     POST /api/community/bewertungen                     eine Bewertung schreiben (201, Kennung und Zustand)
 *     POST /api/community/bewertungen/:id/gefaellt        „Gefällt mir“ setzen (`delta` 1) oder zurücknehmen (-1); nur die Zahl
 *     POST /api/community/bewertungen/:id/melden          eine Bewertung melden (201, COM-Nummer): ein Vorgang im Reiter Meldungen
 *
 * Redaktion (`moderate_submissions`, Schreibklasse `community`; die Personen-ID kommt aus der Sitzung):
 *
 *     GET  /api/community/bewertungen?segment&q&sterne&herkunft&gemeldet&zurueckgehalten&sortierung
 *     GET  /api/community/bewertungen/:id                 eine Bewertung mit Ort, Schnitt, Meldungen und Verlauf
 *     POST /api/community/bewertungen/:id/sichten | freigeben | verbergen | einblenden
 *     POST /api/community/bewertungen/:id/inhalt-loeschen `moderate_community` und frischer Passkey
 *
 * - 🔴 **Missbrauch** (Fachkonzept §14.4): Honigtopf und Zeitfalle verwerfen still (201 mit erfundener Kennung, NICHTS gespeichert). Die Drossel zählt je
 *   Adresse und Stunde sowie insgesamt je Tag, nur im Speicher und mit gehashter Adresse, nie gespeichert; ehrlich 429 „Du hast gerade mehrere
 *   Bewertungen geschrieben.“ Wortliste und Adresse im Text halten die Bewertung zurück (nie still verwerfen).
 * - 🔴 **„Gefällt mir“**: Die Datenbank zählt nur eine Zahl. „Einmal je Browser“ hält der Browser; die Drossel je Adresse lebt nur im Speicher.
 * - 🔴 **Protokoll**: `system.community_bewertung_*` mit der öffentlichen Kennung der Bewertung und dem Zustand danach, nie Name, Text, Datum oder
 *   Sterne; in derselben Transaktion wie die Handlung und nur, wenn sie wirklich geschah (nicht bei einer Wiederholung derselben Kennung).
 * - 🪤 `request.ip` stimmt nur, weil die App allein dem Proxy auf derselben Maschine traut (`trustProxy: "loopback"`, `app.ts`).
 */

const STATUS_VON: Record<CommunityFehlerCode, number> = {
    community_not_found: 404,
    community_conflict: 409,
    community_transition: 409,
    community_invalid: 422,
    // Die Tagesgrenze der neuen Mails (WI-0268 C6a) gibt es nur im Reiter Mails; diese Route erreicht sie nie.
    community_mail_grenze: 429,
};

const NICHT_BEREIT =
    "Die Community ist auf dieser Instanz noch nicht eingerichtet: eine Migration oder ein Recht fehlt.";

const FEHLER = { ...ADMIN_ERRORS, 422: ApiErrorBody, 429: ApiErrorBody };

/** Ein Fehler der Datenbankfunktionen als Fachcode mit Status; Schema oder Recht fehlt noch: 503 `community_unavailable`. */
async function uebersetzt<T>(lauf: () => Promise<T>): Promise<T> {
    try {
        return await lauf();
    } catch (roh) {
        if (roh instanceof CommunityFehler)
            throw new ApiError(STATUS_VON[roh.code], roh.code, roh.message, roh.details);
        if (isNotProvisioned(roh)) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
        throw roh;
    }
}

/** Ein kurzer Hash der Adresse für die Drossel: Die Adresse selbst wird nirgends gehalten (wie `community.ts`, `besuch.ts`). */
const adresse = (ip: string): string => createHash("sha256").update(ip).digest("base64").slice(0, 16);

const zuViele = (satz: string): ApiError =>
    new ApiError(429, "community_rate", satz, {
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

export const bewertungenRoutes: FastifyPluginAsyncTypebox = async (app) => {
    noStore(app);
    const db = (): Queryable => {
        if (app.database === undefined) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
        return app.database;
    };

    // Die Drosseln leben im Speicher dieser Instanz und werden nie gespeichert (Fachkonzept §14.4).
    const schreibenJeStunde = createRateLimiter(BEWERTUNG_GRENZEN.jeAdresseJeStunde, 3_600_000);
    const schreibenJeTag = createRateLimiter(BEWERTUNG_GRENZEN.jeTag, 86_400_000);
    const gefaelltJeStunde = createRateLimiter(BEWERTUNG_GRENZEN.gefaelltJeAdresseJeStunde, 3_600_000);
    const meldenJeStunde = createRateLimiter(BEWERTUNG_GRENZEN.meldenJeAdresseJeStunde, 3_600_000);

    const oeffentlich = {
        config: { auth: "public" as const, writeClass: "public" as const, errorEnvelope: true as const },
        bodyLimit: BEWERTUNG_GRENZEN.rumpfBytes,
        onRequest: nurEigeneSeite(app),
    };
    const lesen = protect("moderate_submissions");
    const schreiben = protect("moderate_submissions", { writeClass: "community" });
    const loeschen = protect("moderate_community", { confirm: "passkey", writeClass: "community" });
    const REDAKTION_RUMPF = 16 * 1024;

    /**
     * Eine Handlung mit Eintrag im Protokoll: die Datenbankfunktion und das Ereignis in EINER Transaktion, das Ereignis nur, wenn die Handlung
     * wirklich geschah. Eine Wiederholung derselben Kennung (die Funktion erkennt sie am Verlauf der Bewertung) liefert die Revision und schreibt
     * nichts zweites; eine Sperre je Kennung hält zwei gleichzeitige Wiederholungen hintereinander.
     */
    async function protokolliert<T>(
        request: FastifyRequest,
        session: SessionRecord,
        operationId: string,
        ereignis: { action: AuditAction; id: string; details: Record<string, unknown> },
        lauf: (tx: Queryable) => Promise<T>,
        danach?: (ergebnis: T) => { action: AuditAction; targetRef: string; details: Record<string, unknown> }[],
    ): Promise<T> {
        const database = app.database;
        if (database === undefined) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
        const fertig = await uebersetzt(() =>
            database.begin(async (tx) => {
                await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`bewertung:${operationId}`}, 0))`;
                const [schon] = await tx<{ da: boolean }[]>`
                    SELECT EXISTS (SELECT 1 FROM avesmaps_community.bewertung_ereignis WHERE operation_id = ${operationId}::uuid) AS da
                `;
                const ergebnis = await lauf(tx);
                if (schon?.da !== true) {
                    await recordEvent(tx, {
                        ...actorFields(session, request),
                        action: ereignis.action,
                        targetRef: ereignis.id,
                        details: ereignis.details,
                    });
                    for (const weitere of danach?.(ergebnis) ?? []) {
                        await recordEvent(tx, { ...actorFields(session, request), ...weitere });
                    }
                }
                return ergebnis;
            }),
        );
        // `begin` verpackt den Rückgabewert in sein eigenes Typmuster; es ist genau der der Handlung.
        return fertig as T;
    }

    // --- Öffentlich ---------------------------------------------------------------------------------------------------------

    app.post(
        BEWERTUNGEN_URL,
        { ...oeffentlich, schema: { body: BewertungBody, response: { 201: BewertungAntwort, ...FEHLER } } },
        async (request, reply) => {
            const body = request.body;
            const schluessel = adresse(request.ip);
            if (!schreibenJeStunde.allows(schluessel) || !schreibenJeTag.allows("alle")) {
                throw zuViele("Du hast gerade mehrere Bewertungen geschrieben. Bitte versuch es später noch einmal.");
            }
            // Honigtopf (ein Feld, das ein Mensch nie sieht) und Zeitfalle (schneller als ein Mensch tippt): still verwerfen. Der Bot liest ein
            // freundliches „Danke“, es entsteht nichts (Fachkonzept §14.4).
            if (body.falle.feld.trim() !== "" || body.falle.dauerMs < BEWERTUNG_GRENZEN.mindestDauerMs) {
                schreibenJeStunde.record(schluessel);
                request.log.info("Community: Bewertung von der Falle verworfen");
                return reply.code(201).send({ id: randomUUID(), zustand: "neu" });
            }
            // Das aventurische Datum: leer gilt der heutige Tag im Kalender der Anwendung; ein ungültiges sagt ehrlich, was nicht stimmt.
            const datum = normalisiereAventurischesDatum(body.datum ?? "");
            if (datum === null) {
                throw new ApiError(
                    422,
                    "community_invalid",
                    "Das aventurische Datum passt nicht. Beispiel: 7. Rahja 1049 BF. Leer lassen setzt den heutigen Tag.",
                    // WI-0291: der Fachcode für das Fenster, das in seiner Sprache sagt, was zu tun ist (Satz des Servers bleibt für Protokoll und alte Fenster).
                    { reason: "datum_ungueltig" },
                );
            }
            const verdacht = bewertungVerdacht(body.text, body.name);
            const database = app.database;
            if (database === undefined) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
            const umgebung = app.authConfig.environment;
            const angelegt = await uebersetzt(() =>
                database.begin(async (tx) => {
                    const neu = await bewertungSchreiben(tx, {
                        operationId: body.operationId,
                        ort: body.ort,
                        sterne: body.sterne,
                        text: body.text,
                        name: body.name,
                        datum:
                            datum === ""
                                ? aventurischesDatumHeute(new Date(), AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf)
                                : datum,
                        zustand: verdacht.zustand,
                        grund: verdacht.grund,
                    });
                    if (umgebung !== undefined) {
                        await bestenfalls(tx, request.log, "neue Bewertung", (q) => neueBewertung(q, umgebung, neu.id));
                    }
                    return neu;
                }),
            );
            schreibenJeStunde.record(schluessel);
            schreibenJeTag.record("alle");
            return reply.code(201).send(angelegt);
        },
    );

    app.post(
        `${BEWERTUNGEN_URL}/:id/gefaellt`,
        {
            ...oeffentlich,
            schema: { params: BewertungParams, body: GefaelltBody, response: { 200: GefaelltAntwort, ...FEHLER } },
        },
        async (request) => {
            const schluessel = adresse(request.ip);
            if (!gefaelltJeStunde.allows(schluessel)) {
                throw zuViele("Du hast gerade sehr oft „Gefällt mir“ gedrückt. Bitte versuch es später noch einmal.");
            }
            const gefaellt = await uebersetzt(() => bewertungGefaellt(db(), request.params.id, request.body.delta));
            gefaelltJeStunde.record(schluessel);
            return { gefaellt };
        },
    );

    app.post(
        `${BEWERTUNGEN_URL}/:id/melden`,
        {
            ...oeffentlich,
            schema: {
                params: BewertungParams,
                body: BewertungMeldenBody,
                response: { 201: MeldungAntwort, ...FEHLER },
            },
        },
        async (request, reply) => {
            const body = request.body;
            const schluessel = adresse(request.ip);
            if (!meldenJeStunde.allows(schluessel) || !schreibenJeTag.allows("melden")) {
                throw zuViele("Gerade sind zu viele Meldungen eingegangen. Später geht es wieder.");
            }
            if (body.falle.feld.trim() !== "" || body.falle.dauerMs < BEWERTUNG_GRENZEN.mindestDauerMs) {
                meldenJeStunde.record(schluessel);
                request.log.info("Community: Meldung einer Bewertung von der Falle verworfen");
                return reply.code(201).send({ nummer: comNummer(randomInt(10, 700)) });
            }
            const id = await uebersetzt(() =>
                bewertungMelden(db(), {
                    operationId: body.operationId,
                    bewertung: request.params.id,
                    schluessel: body.schluessel,
                    grund: body.grund,
                    text: body.text,
                }),
            );
            meldenJeStunde.record(schluessel);
            return reply.code(201).send({ nummer: comNummer(id) });
        },
    );

    // --- Redaktion: Lesen ---------------------------------------------------------------------------------------------------

    app.get(
        BEWERTUNGEN_URL,
        { ...lesen, schema: { querystring: BewertungenQuery, response: { 200: BewertungListe, ...FEHLER } } },
        async (request) => {
            await adminSession(request);
            const q = request.query;
            return uebersetzt(() =>
                bewertungenListe(db(), {
                    segment: q.segment ?? "sichten",
                    q: q.q,
                    sterne: q.sterne,
                    herkunft: q.herkunft,
                    gemeldet: q.gemeldet,
                    zurueckgehalten: q.zurueckgehalten,
                    sortierung: q.sortierung,
                }),
            );
        },
    );

    app.get(
        `${BEWERTUNGEN_URL}/:id`,
        { ...lesen, schema: { params: BewertungParams, response: { 200: BewertungDetail, ...FEHLER } } },
        async (request) => {
            await adminSession(request);
            const eintrag = await uebersetzt(() => bewertungDetail(db(), request.params.id));
            if (eintrag === null) throw new ApiError(404, "community_not_found", "Diese Bewertung gibt es nicht.");
            return eintrag;
        },
    );

    // --- Redaktion: Handlungen mit Eintrag im Protokoll ---------------------------------------------------------------------

    const SCHRITTE = [
        {
            pfad: "sichten",
            action: "system.community_bewertung_gesichtet",
            zustand: "gesichtet",
            lauf: bewertungSichten,
        },
        {
            pfad: "freigeben",
            action: "system.community_bewertung_freigegeben",
            zustand: "gesichtet",
            lauf: bewertungFreigeben,
        },
        {
            pfad: "einblenden",
            action: "system.community_bewertung_eingeblendet",
            zustand: "gesichtet",
            lauf: bewertungEinblenden,
        },
    ] as const;
    for (const schritt of SCHRITTE) {
        app.post(
            `${BEWERTUNGEN_URL}/:id/${schritt.pfad}`,
            {
                ...schreiben,
                bodyLimit: REDAKTION_RUMPF,
                schema: {
                    params: BewertungParams,
                    body: BewertungSchrittBody,
                    response: { 200: BewertungQuittung, ...FEHLER },
                },
            },
            async (request) => {
                const session = await adminSession(request);
                const id = request.params.id;
                const body = request.body;
                const revision = await protokolliert(
                    request,
                    session,
                    body.operationId,
                    { action: schritt.action, id, details: { bewertung: id, zustand: schritt.zustand } },
                    (tx) =>
                        schritt.lauf(tx, {
                            operationId: body.operationId,
                            id,
                            person: session.personId,
                            revision: body.baseRevision,
                        }),
                );
                return { id, revision, abgeschlossen: [] };
            },
        );
    }

    app.post(
        `${BEWERTUNGEN_URL}/:id/verbergen`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: {
                params: BewertungParams,
                body: BewertungVerbergenBody,
                response: { 200: BewertungQuittung, ...FEHLER },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = request.params.id;
            const body = request.body;
            const ergebnis = await protokolliert(
                request,
                session,
                body.operationId,
                {
                    action: "system.community_bewertung_verborgen",
                    id,
                    details: { bewertung: id, zustand: "verborgen", grund: body.grund },
                },
                (tx) =>
                    bewertungVerbergen(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                        grund: body.grund,
                        vorgaengeAbschliessen: body.vorgaengeAbschliessen,
                    }),
                // Die gleich mit abgeschlossenen Meldungen schreiben ihren Eintrag wie jedes Abschließen (COM-Nummer und Ergebnis).
                (verborgen) =>
                    verborgen.abgeschlossen.map((nummer) => ({
                        action: "system.community_abgeschlossen" as const,
                        targetRef: nummer,
                        details: { com: nummer, ergebnis: "umgesetzt" },
                    })),
            );
            return { id, revision: ergebnis.revision, abgeschlossen: ergebnis.abgeschlossen };
        },
    );

    // Inhalt löschen (Fachkonzept §14.3, Datenschutz): Name, Text und Datum weg. Stufe S im Moment: frischer Passkey.
    app.post(
        `${BEWERTUNGEN_URL}/:id/inhalt-loeschen`,
        {
            ...loeschen,
            bodyLimit: REDAKTION_RUMPF,
            schema: {
                params: BewertungParams,
                body: BewertungSchrittBody,
                response: { 200: BewertungQuittung, ...FEHLER },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = request.params.id;
            const body = request.body;
            const revision = await protokolliert(
                request,
                session,
                body.operationId,
                {
                    action: "system.community_bewertung_geloescht",
                    id,
                    details: { bewertung: id, zustand: "verborgen" },
                },
                (tx) =>
                    bewertungInhaltLoeschen(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                    }),
            );
            return { id, revision, abgeschlossen: [] };
        },
    );
};
