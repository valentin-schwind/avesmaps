import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    ApiErrorBody,
    SOCIAL_RUBRIKEN,
    SOCIAL_URL,
    SocialAendernBody,
    SocialAnlegenBody,
    SocialBildParams,
    SOCIAL_BILD_URTEILE_MAX,
    SocialBildRechte,
    SocialBildRechteBody,
    SocialBildUrteile,
    SocialBildUrteileQuery,
    SocialDetail,
    SocialErneutBody,
    SocialGrundBody,
    SocialKanaele,
    SOCIAL_HASHTAG_VORRAT_MAX,
    SocialHashtags,
    SocialKanalParams,
    SocialKanalStand,
    SocialListe,
    SocialNotschalterBody,
    SocialParams,
    SocialQuery,
    SocialQuittung,
    SocialSchrittBody,
    ZAEHLREGELN,
    bereinigeHashtags,
    hatZugang,
    kanalKontext,
    pruefeBeitrag,
    socNummer,
    type KanalId,
    type KanalKontext,
    type KanalMitZugang,
    type SocialSperrgrund,
} from "@avesmaps3d/shared";
import type { FastifyRequest } from "fastify";
import type postgres from "postgres";
import { ADMIN_ERRORS, actorFields, adminSession, noStore } from "../auth/admin-guard.ts";
import { recordEvent, type AuditAction } from "../auth/audit.ts";
import { demandEines, hatRecht, protect, protectEines } from "../auth/plugin.ts";
import type { SessionRecord } from "../auth/session-store.ts";
import { isNotProvisioned, type Queryable } from "../database.ts";
import { CommunityFehler, type CommunityFehlerCode } from "../community/db.ts";
import { beitragZurFreigabe, bestenfalls } from "../community/glocke.ts";
import {
    beitragAenderungVeroeffentlichen,
    beitragAendern,
    beitragAnlegen,
    beitragErneutSenden,
    beitragFreigeben,
    beitragInDenPapierkorb,
    beitragKanalZuruecknehmen,
    beitragKopf,
    beitragVorlegen,
    beitragZurueckgeben,
    beitragZurueckholen,
    beitragZurueckziehen,
    beitragZuruecknehmen,
    reiheSendungenEin,
    socialDetail,
    socialListe,
    type BeitragInhalt,
} from "../community/social.ts";
import { socialBildUrteile } from "../community/social/bild-urteil.ts";
import { leseHashtags, setzeHashtags } from "../community/social/hashtags.ts";
import { leseKanalStaende, liesUndSpeichereKanal, setzeNotschalter } from "../community/social/kanaele/stand.ts";
import { ApiError } from "../http/api-error.ts";
import { bestaetigeSocialBild } from "../media-editor/asset-operations.ts";

/**
 * Der Social Hub an der Leitung (WI-0270 C11, Fachkonzept §15, Bedienkonzept §6.4 bis §6.6). Die Regeln (Zustände, Revision, Idempotenz, die Neuigkeit als
 * einziger Speicher) stehen in der Datenbank (Migration 0269, `community/social.ts`); hier wird nur angenommen, die Länge je Kanal nachgezählt, das Recht
 * geprüft und übersetzt. Schreibklasse `community`: Die Sperre der Karte hält den Hub nicht an.
 *
 *     GET  /api/community/social?segment&q&kanal&herkunft    die Liste (Offen · Veröffentlicht · Papierkorb) mit den Zahlen         social_communication
 *     GET  /api/community/social/:id                         ein Beitrag mit Bild und Verlauf                                       social_communication
 *     POST /api/community/social                             einen Entwurf anlegen (auch aus einem Vorgang: `vorgang`)             social_communication
 *     POST /api/community/social/:id/aendern                 das Formular speichern                                                 Verfasser oder manage_news
 *     POST /api/community/social/:id/vorlegen                zur Freigabe vorlegen (Glocke an die Betreiber)                        Verfasser oder manage_news
 *     POST /api/community/social/:id/zurueckziehen           die Vorlage zurückziehen                                               Verfasser oder manage_news
 *     POST /api/community/social/:id/papierkorb | zurueckholen  in den Papierkorb und zurück                                         Verfasser oder manage_news
 *     POST /api/community/social/:id/zurueckgeben            zurück an den Verfasser, mit freiwilligem Grund                        manage_news
 *     POST /api/community/social/:id/freigeben               freigeben und veröffentlichen (den eigenen allein: E10)                manage_news
 *     POST /api/community/social/:id/aenderung               die Änderung veröffentlichen                                           manage_news
 *     POST /api/community/social/:id/zuruecknehmen           zurücknehmen (die Neuigkeit wird versteckt)                            manage_news
 *     POST /api/community/social/:id/erneut                  erneut senden, für einen Kanal                                         manage_news
 *     POST /api/community/social/:id/kanal-zuruecknehmen     einen Kanal mit Zugang zurücknehmen (Mastodon, Facebook: dort löschen)  manage_news
 *     POST /api/community/social/bilder/:asset/rechte        die Rechte an einem Bild der Kategorie „Social Media Posts“ bestätigen (WI-0278)  manage_news
 *     GET  /api/community/social/bilder/urteile?ids=a,b      welche Bilder der Medienverwaltung in einen Beitrag dürfen, und warum nicht (WI-0278)  social_communication
 *     GET  /api/community/social/hashtags                    die Hashtags, die der Hub in jedem Beitrag anbietet (WI-0270)          social_communication
 *     POST /api/community/social/hashtags                    die ganze Liste ersetzen (Panel „Hashtags“ der Systemsteuerung)        manage_news oder publish_social
 *     GET  /api/community/social/kanaele                     der Stand der Kanäle mit Zugang (eingerichtet, freigeschaltet, Notschalter, Grenzen)   social_communication
 *     POST /api/community/social/kanaele/:kanal/notschalter  den Notschalter eines Kanals setzen oder lösen (frischer Passkey)         manage_social_channels
 *     POST /api/community/social/kanaele/:kanal/grenzen      die Grenzen neu lesen (Mastodon) bzw. den Zugang prüfen (Meta); frischer Passkey   manage_social_channels
 *
 * - 🔴 **Vorlegen und Freigeben:** Wer nur `social_communication` hat, verfasst und legt vor; freigeben, veröffentlichen, zurücknehmen und zurückgeben darf nur, wer
 *   `manage_news` oder `publish_social` hat. Einen Beitrag, der nicht seiner ist und nicht vorgelegt wurde, ändert niemand ohne diese Rechte.
 * - 🔴 **Eine Zählung für Fenster und Server:** Vorlegen, Freigeben, Änderung veröffentlichen und Erneut senden zählen den Beitrag mit demselben Modul nach wie das
 *   Fenster (\`pruefeBeitrag\`, \`packages/shared/src/social/zaehlen.ts\`) und weisen Zu-Langes ab (422 \`community_invalid\`), auch wenn ein Fenster es durchließe.
 *   Gespeichert wird als Entwurf auch Zu-Langes (es ist Arbeit in Arbeit); die harte Grenze der Tafel ist 10 000 Zeichen.
 * - 🔴 **Protokoll:** \`system.social_*\` mit der SOC-Nummer, nie Titel, Text oder Hashtags; in derselben Transaktion wie die Handlung und nur, wenn sie wirklich
 *   geschah (nicht bei einer Wiederholung derselben Kennung).
 * - 🖼 **Bild der Kategorie „Social Media Posts“ (WI-0278):** Vorlegen geht auch, solange seine Rechte nicht bestätigt sind; Freigeben nicht. Die Bestätigung gibt, wer freigibt.
 * - 🔔 **Die Glocke:** Ein vorgelegter Beitrag meldet sich in derselben Transaktion bei den Betreibern (bestenfalls, Savepoint).
 * - 🌐 **Fremde Kanäle (WI-0268 C12a und C12b):** Ein Kanal mit Zugang (Mastodon, Facebook, Instagram) sendet nur, wenn er `bereit` ist: Die Umgebung kennt ihn (`COMMUNITY_SOCIAL_*`), seine Zählregel ist gegen ein Testkonto
 *   geprüft (`social:pruefen`) und der Notschalter steht aus. Freigeben und Erneut senden MERKEN die Sendung vor und reihen den Auftrag `social_senden` in DERSELBEN Transaktion ein; gesendet wird dort, nie hier. Ein
 *   Ausfall des Kanals ändert nichts an den Neuigkeiten. Die Zählung nimmt für Mastodon die Grenzen der Instanz (`kanalKontext`), nicht feste Zahlen.
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

const FEHLER = { ...ADMIN_ERRORS, 422: ApiErrorBody };

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

/**
 * 422 `community_invalid` mit Fachcode: `details.reason` sagt dem Fenster, welcher Satz in seiner Sprache gilt (und was zu tun ist); `weiter` trägt, was der Satz braucht.
 * Der deutsche Satz bleibt für das Protokoll und alte Fenster (Vali 2026-11-08: „ich will genau fehlermeldungen und wissen, was ich zu tun habe“).
 */
const ungueltig = (satz: string, reason: string, weiter: Record<string, unknown> = {}): ApiError =>
    new ApiError(422, "community_invalid", satz, { reason, ...weiter });
const UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Der Satz zu einem Sperrgrund, in der Sprache der Server-Antworten. Das Fenster sagt denselben Grund in seinen eigenen Sätzen. */
export function sperrSatz(grund: SocialSperrgrund): string {
    switch (grund.art) {
        case "text_fehlt":
            return "Der Text fehlt.";
        case "titel_fehlt":
            return "Die Titelzeile fehlt (die Neuigkeiten brauchen eine).";
        case "kein_kanal":
            return "Es ist kein Kanal gewählt.";
        case "kanal_nicht_verbunden": {
            const name = ZAEHLREGELN[grund.kanal].name;
            if (grund.sperre === "nicht_eingerichtet") return `${name} ist in dieser Umgebung nicht eingerichtet.`;
            if (grund.sperre === "nicht_freigeschaltet") return `${name}: Zählregel noch nicht geprüft.`;
            if (grund.sperre === "notschalter") return `${name}: Der Notschalter steht an.`;
            return `${name} ist noch nicht verbunden.`;
        }
        case "zu_lang":
            return `${ZAEHLREGELN[grund.kanal].name}: ${String(grund.zuviel)} ${
                grund.teil === "bytes" ? "Bytes" : "Zeichen"
            } zu viel${grund.teil === "titel" ? " in der Titelzeile" : ""}.`;
        case "beschreibung_fehlt":
            return "Die Bildbeschreibung fehlt.";
        case "bild_nicht_geklaert":
            return "Die Rechte des Bildes lassen keinen Beitrag zu.";
        case "bild_nicht_oeffentlich":
            return `${ZAEHLREGELN[grund.kanal].name} holt das Bild selbst ab, und es ist nirgends öffentlich.`;
        case "bild_fehlt":
            return `${ZAEHLREGELN[grund.kanal].name} sendet nur mit Bild.`;
    }
}

export const socialRoutes: FastifyPluginAsyncTypebox = async (app) => {
    noStore(app);
    const db = (): Queryable => {
        if (app.database === undefined) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
        return app.database;
    };
    /** Die Umgebung der Glocke; ohne eingerichtete Anmeldung gibt es keine. */
    const glockenUmgebung = (): string | undefined => app.authConfig.environment;

    /** Die Umgebung des Prozesses (Tests setzen sie je Fall, wie beim Mailweg). */
    const umgebung = (): NodeJS.ProcessEnv => process.env;
    /** Welche Kanäle senden und mit welchen Grenzen gezählt wird; eine eigene Verbindung, damit eine fehlende Tafel die laufende Transaktion nicht abbricht. */
    const kontextLaden = async (): Promise<KanalKontext> => kanalKontext(await leseKanalStaende(db(), umgebung()));

    const lesen = protect("social_communication");
    const schreiben = protect("social_communication", { writeClass: "community" });
    const verwalten = protectEines(["manage_news", "publish_social"], { writeClass: "community" });
    // Die Kanäle verwalten verlangt Stufe S (frischer Passkey unmittelbar davor, `checkAssurance`). Der Notschalter ist ein Sicherheitshandgriff und hängt an keiner Sperre.
    const kanalNotschalter = protect("manage_social_channels", { writeClass: "security" });
    const kanalGrenzen = protect("manage_social_channels", { writeClass: "community" });

    /** Darf diese Sitzung freigeben, veröffentlichen, zurücknehmen und fremde Beiträge ändern? (`manage_news` oder `publish_social` samt Stufe.) */
    function darfVerwalten(session: SessionRecord): boolean {
        try {
            demandEines(session, ["manage_news", "publish_social"], app.authConfig);
            return true;
        } catch {
            return false;
        }
    }

    /** Der Beitrag gehört der Person oder sie verwaltet: sonst 403 `community_forbidden`. Nicht gefunden: 404. */
    async function eigenOderVerwalter(
        tx: Queryable,
        session: SessionRecord,
        id: number,
    ): Promise<{ zustand: "entwurf" | "vorgelegt" | "veroeffentlicht"; verwaltet: boolean }> {
        const kopf = await beitragKopf(tx, id);
        if (kopf === null) throw new ApiError(404, "community_not_found", "Diesen Beitrag gibt es nicht.");
        const verwaltet = darfVerwalten(session);
        if (!verwaltet && kopf.verfasser !== session.personId) {
            // Wer das Recht hat und nur den zweiten Faktor nicht, bekommt die Frage danach (Stufe V, `demandEines`), nicht „gehört einer anderen Person“.
            if (
                hatRecht(session, "manage_news", app.authConfig) ||
                hatRecht(session, "publish_social", app.authConfig)
            ) {
                demandEines(session, ["manage_news", "publish_social"], app.authConfig);
            }
            throw new ApiError(403, "community_forbidden", "Dieser Beitrag gehört einer anderen Person.");
        }
        return { zustand: kopf.zustand, verwaltet };
    }

    /**
     * Eine Handlung mit Eintrag im Protokoll: die Datenbankfunktion und das Ereignis in EINER Transaktion, das Ereignis nur, wenn die Handlung wirklich
     * geschah. Eine Wiederholung derselben Kennung liefert die Revision und schreibt nichts zweites; eine Sperre je Kennung hält zwei gleichzeitige
     * Wiederholungen hintereinander. `vorher` läuft in der Transaktion VOR der Funktion (Rechte, Zählung); `danach` meldet die Glocke.
     */
    async function protokolliert<T>(
        request: FastifyRequest,
        session: SessionRecord,
        operationId: string,
        ereignis: { action: AuditAction; id: number; details: Record<string, unknown> } | null,
        lauf: (tx: Queryable) => Promise<T>,
        danach?: (tx: postgres.TransactionSql, ergebnis: T, neu: boolean) => Promise<void>,
    ): Promise<T> {
        const database = app.database;
        if (database === undefined) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
        const fertig = await uebersetzt(() =>
            database.begin(async (tx) => {
                await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`beitrag:${operationId}`}, 0))`;
                const [schon] = await tx<{ da: boolean }[]>`
                    SELECT EXISTS (SELECT 1 FROM avesmaps_community.beitrag_ereignis WHERE operation_id = ${operationId}::uuid)
                        OR EXISTS (SELECT 1 FROM avesmaps_community.beitrag WHERE operation_id = ${operationId}::uuid) AS da
                `;
                const ergebnis = await lauf(tx);
                const neu = schon?.da !== true;
                if (neu && ereignis !== null) {
                    await recordEvent(tx, {
                        ...actorFields(session, request),
                        action: ereignis.action,
                        targetRef: socNummer(ereignis.id),
                        details: ereignis.details,
                    });
                }
                if (danach !== undefined) await danach(tx, ergebnis, neu);
                return ergebnis;
            }),
        );
        // `begin` verpackt den Rückgabewert in sein eigenes Typmuster; es ist genau der der Handlung.
        return fertig as T;
    }

    /** Das Formular aus dem Rumpf: bereinigte Hashtags, geprüfte Rubrik, nur Kanäle des Katalogs (die Form prüft das Schema). */
    function inhaltAus(body: SocialAnlegenBody | SocialAendernBody): BeitragInhalt {
        if (!(SOCIAL_RUBRIKEN as readonly string[]).includes(body.rubrik)) {
            throw ungueltig("Diese Rubrik gibt es nicht.", "rubrik_unbekannt");
        }
        return {
            titel: body.titel ?? null,
            text: body.text,
            hashtags: bereinigeHashtags(body.hashtags),
            rubrik: body.rubrik,
            bild: body.bild ?? null,
            bildBeschreibung: body.bildBeschreibung ?? null,
            ki: body.ki,
            kanaele: [...new Set(body.kanaele)],
        };
    }

    /**
     * Die Zählung vor dem Vorlegen und Freigeben mit dem Modul des Fensters. Wirft 422 mit dem Satz des Grundes. `vorlage`: Ein Bild der Kategorie „Social Media Posts“ darf beim Vorlegen noch ohne
     * bestätigte Rechte sein (WI-0278); die Datenbank sagt dasselbe (`beitrag_vorlegen`, Migration 0301).
     */
    async function zaehlePruefe(tx: Queryable, id: number, vorlage = false): Promise<void> {
        const detail = await socialDetail(tx, id);
        if (detail === null) throw new ApiError(404, "community_not_found", "Diesen Beitrag gibt es nicht.");
        const z = detail.zeile;
        const grund = pruefeBeitrag({
            titel: z.titel,
            text: z.text,
            hashtags: z.hashtags,
            bild: z.bild,
            bildBeschreibung: z.bildBeschreibung,
            bildGeklaert:
                detail.bild === null || (vorlage && detail.bild.typ === "social_post")
                    ? undefined
                    : detail.bild.geklaert,
            bildGrund: detail.bild?.grund,
            bildOeffentlich: detail.bild?.oeffentlich,
            kanaele: z.kanaele,
            kontext: await kontextLaden(),
        });
        if (grund !== null) throw ungueltig(sperrSatz(grund), grund.art, { sperrgrund: grund });
    }

    // --- Das Bild ---------------------------------------------------------------------------------------------------------------

    app.post(
        `${SOCIAL_URL}/bilder/:asset/rechte`,
        {
            ...verwalten,
            schema: {
                params: SocialBildParams,
                body: SocialBildRechteBody,
                response: { 200: SocialBildRechte, ...FEHLER },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const database = app.database;
            if (database === undefined) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
            await uebersetzt(() =>
                bestaetigeSocialBild(
                    database,
                    { personId: session.personId, environment: session.environment },
                    request.params.asset,
                    request.body.operationId,
                ),
            );
            // Das Urteil DANACH, nicht fest „geklärt“: Die Bestätigung hebt nicht jede Sperre der Policy auf (Moderation, Notaus, Inhaltsstand). Mit festem `true` bot das Fenster
            // „Freigeben“ an, und das Freigeben scheiterte mit einem Grund, den niemand sah (Vali 2026-11-08, Beitrag 20).
            const asset = request.params.asset.toLowerCase();
            const urteil = (await uebersetzt(() => socialBildUrteile(database, [asset]))).get(asset);
            return {
                klaerung: "cleared",
                geklaert: urteil?.erlaubt ?? false,
                grund: urteil?.grund ?? "rights_missing",
                nennung: urteil?.nennung ?? null,
                oeffentlich: urteil?.oeffentlich ?? false,
            };
        },
    );

    app.get(
        `${SOCIAL_URL}/bilder/urteile`,
        { ...lesen, schema: { querystring: SocialBildUrteileQuery, response: { 200: SocialBildUrteile, ...FEHLER } } },
        async (request) => {
            await adminSession(request);
            const ids = request.query.ids.split(",").map((id) => id.trim().toLowerCase());
            if (ids.length > SOCIAL_BILD_URTEILE_MAX || !ids.every((id) => UUID_FORM.test(id))) {
                throw ungueltig("Die Kennungen der Bilder stimmen nicht.", "bild_kennungen");
            }
            const urteile = await uebersetzt(() => socialBildUrteile(db(), ids));
            return {
                urteile: [...urteile].map(([id, urteil]) => ({
                    id,
                    erlaubt: urteil.erlaubt,
                    grund: urteil.grund,
                    nennung: urteil.nennung,
                    oeffentlich: urteil.oeffentlich,
                })),
            };
        },
    );

    // --- Lesen ----------------------------------------------------------------------------------------------------------------

    app.get(
        SOCIAL_URL,
        { ...lesen, schema: { querystring: SocialQuery, response: { 200: SocialListe, ...FEHLER } } },
        async (request) => {
            await adminSession(request);
            const q = request.query;
            return uebersetzt(() =>
                socialListe(db(), { segment: q.segment ?? "offen", q: q.q, kanal: q.kanal, herkunft: q.herkunft }),
            );
        },
    );

    app.get(
        `${SOCIAL_URL}/:id`,
        { ...lesen, schema: { params: SocialParams, response: { 200: SocialDetail, ...FEHLER } } },
        async (request) => {
            await adminSession(request);
            const eintrag = await uebersetzt(() => socialDetail(db(), request.params.id));
            if (eintrag === null) throw new ApiError(404, "community_not_found", "Diesen Beitrag gibt es nicht.");
            return eintrag;
        },
    );

    // --- Verfassen ------------------------------------------------------------------------------------------------------------

    app.post(
        SOCIAL_URL,
        {
            ...schreiben,
            bodyLimit: 64 * 1024,
            schema: { body: SocialAnlegenBody, response: { 201: SocialQuittung, ...FEHLER } },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            const body = request.body;
            const inhalt = inhaltAus(body);
            const angelegt = await protokolliert(request, session, body.operationId, null, (tx) =>
                beitragAnlegen(tx, {
                    ...inhalt,
                    operationId: body.operationId,
                    person: session.personId,
                    vorgang: body.vorgang,
                }),
            );
            return reply.code(201).send({
                id: angelegt.id,
                nr: socNummer(angelegt.id),
                revision: angelegt.revision,
                zustand: angelegt.zustand,
            });
        },
    );

    app.post(
        `${SOCIAL_URL}/:id/aendern`,
        {
            ...schreiben,
            bodyLimit: 64 * 1024,
            schema: { params: SocialParams, body: SocialAendernBody, response: { 200: SocialQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const body = request.body;
            const inhalt = inhaltAus(body);
            const revision = await protokolliert(request, session, body.operationId, null, async (tx) => {
                const stand = await eigenOderVerwalter(tx, session, id);
                // Was vorgelegt oder veröffentlicht ist, ändert nur, wer es freigibt; der Verfasser zieht die Vorlage erst zurück.
                if (stand.zustand !== "entwurf" && !stand.verwaltet) {
                    throw new ApiError(
                        403,
                        "community_forbidden",
                        "Ein vorgelegter Beitrag ändert nur, wer ihn freigibt.",
                    );
                }
                return beitragAendern(tx, {
                    ...inhalt,
                    operationId: body.operationId,
                    id,
                    person: session.personId,
                    revision: body.baseRevision,
                });
            });
            return quittung(id, revision, await zustandVon(id));
        },
    );

    /** Die Namen der Kanäle eines Beitrags, durch Komma getrennt, für das Protokoll. */
    async function kanaeleVon(id: number): Promise<string> {
        const detail = await socialDetail(db(), id);
        return detail === null || detail.zeile.kanaele.length === 0 ? "neuigkeiten" : detail.zeile.kanaele.join(",");
    }

    /** Der Zustand nach der Handlung für die Quittung (eine zweite, kleine Anfrage nach dem Commit). */
    async function zustandVon(id: number): Promise<"entwurf" | "vorgelegt" | "veroeffentlicht"> {
        const kopf = await beitragKopf(db(), id);
        return kopf?.zustand ?? "entwurf";
    }
    const quittung = (
        id: number,
        revision: number,
        zustand: "entwurf" | "vorgelegt" | "veroeffentlicht",
    ): { id: number; nr: string; revision: number; zustand: "entwurf" | "vorgelegt" | "veroeffentlicht" } => ({
        id,
        nr: socNummer(id),
        revision,
        zustand,
    });

    // --- Vorlegen, zurückziehen, Papierkorb -----------------------------------------------------------------------------------

    app.post(
        `${SOCIAL_URL}/:id/vorlegen`,
        {
            ...schreiben,
            schema: { params: SocialParams, body: SocialSchrittBody, response: { 200: SocialQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const body = request.body;
            const umgebung = glockenUmgebung();
            const revision = await protokolliert(
                request,
                session,
                body.operationId,
                { action: "system.social_vorgelegt", id, details: { beitrag: socNummer(id) } },
                async (tx) => {
                    await eigenOderVerwalter(tx, session, id);
                    await zaehlePruefe(tx, id, true);
                    return beitragVorlegen(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                    });
                },
                async (tx, _revision, neu) => {
                    if (!neu || umgebung === undefined) return;
                    await bestenfalls(tx, request.log, "Beitrag zur Freigabe", (q) =>
                        beitragZurFreigabe(q, umgebung, { id, von: session.personId }),
                    );
                },
            );
            return quittung(id, revision, await zustandVon(id));
        },
    );

    app.post(
        `${SOCIAL_URL}/:id/zurueckziehen`,
        {
            ...schreiben,
            schema: { params: SocialParams, body: SocialSchrittBody, response: { 200: SocialQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const body = request.body;
            const revision = await protokolliert(request, session, body.operationId, null, async (tx) => {
                await eigenOderVerwalter(tx, session, id);
                return beitragZurueckziehen(tx, {
                    operationId: body.operationId,
                    id,
                    person: session.personId,
                    revision: body.baseRevision,
                });
            });
            return quittung(id, revision, await zustandVon(id));
        },
    );

    app.post(
        `${SOCIAL_URL}/:id/papierkorb`,
        {
            ...schreiben,
            schema: { params: SocialParams, body: SocialSchrittBody, response: { 200: SocialQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const body = request.body;
            const revision = await protokolliert(
                request,
                session,
                body.operationId,
                { action: "system.social_verworfen", id, details: { beitrag: socNummer(id) } },
                async (tx) => {
                    await eigenOderVerwalter(tx, session, id);
                    return beitragInDenPapierkorb(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                    });
                },
            );
            return quittung(id, revision, await zustandVon(id));
        },
    );

    app.post(
        `${SOCIAL_URL}/:id/zurueckholen`,
        {
            ...schreiben,
            schema: { params: SocialParams, body: SocialSchrittBody, response: { 200: SocialQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const body = request.body;
            const revision = await protokolliert(request, session, body.operationId, null, async (tx) => {
                await eigenOderVerwalter(tx, session, id);
                return beitragZurueckholen(tx, {
                    operationId: body.operationId,
                    id,
                    person: session.personId,
                    revision: body.baseRevision,
                });
            });
            return quittung(id, revision, await zustandVon(id));
        },
    );

    // --- Freigeben und was daran hängt (manage_news) ---------------------------------------------------------------------------

    app.post(
        `${SOCIAL_URL}/:id/zurueckgeben`,
        {
            ...verwalten,
            schema: { params: SocialParams, body: SocialGrundBody, response: { 200: SocialQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const body = request.body;
            const revision = await protokolliert(request, session, body.operationId, null, (tx) =>
                beitragZurueckgeben(tx, {
                    operationId: body.operationId,
                    id,
                    person: session.personId,
                    revision: body.baseRevision,
                    grund: body.grund,
                }),
            );
            return quittung(id, revision, await zustandVon(id));
        },
    );

    app.post(
        `${SOCIAL_URL}/:id/freigeben`,
        {
            ...verwalten,
            schema: { params: SocialParams, body: SocialSchrittBody, response: { 200: SocialQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const body = request.body;
            // Die Kanäle stehen im Protokoll (nur ihre Namen aus dem festen Katalog), nicht der Text des Beitrags.
            const kanaele = await kanaeleVon(id);
            const revision = await protokolliert(
                request,
                session,
                body.operationId,
                { action: "system.social_freigegeben", id, details: { beitrag: socNummer(id), kanal: kanaele } },
                async (tx) => {
                    await zaehlePruefe(tx, id);
                    return beitragFreigeben(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                    });
                },
                // Die vorgemerkten Sendungen an fremde Kanäle gehen in DERSELBEN Transaktion in die Warteschlange; eine Wiederholung derselben Kennung reiht nichts zweites ein.
                async (tx, _revision, neu) => {
                    if (neu) await reiheSendungenEin(tx, id);
                },
            );
            return quittung(id, revision, await zustandVon(id));
        },
    );

    app.post(
        `${SOCIAL_URL}/:id/aenderung`,
        {
            ...verwalten,
            schema: { params: SocialParams, body: SocialSchrittBody, response: { 200: SocialQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const body = request.body;
            const revision = await protokolliert(
                request,
                session,
                body.operationId,
                {
                    action: "system.social_aenderung_veroeffentlicht",
                    id,
                    details: { beitrag: socNummer(id), kanal: "neuigkeiten" },
                },
                async (tx) => {
                    await zaehlePruefe(tx, id);
                    return beitragAenderungVeroeffentlichen(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                    });
                },
            );
            return quittung(id, revision, await zustandVon(id));
        },
    );

    app.post(
        `${SOCIAL_URL}/:id/zuruecknehmen`,
        {
            ...verwalten,
            schema: { params: SocialParams, body: SocialSchrittBody, response: { 200: SocialQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const body = request.body;
            const revision = await protokolliert(
                request,
                session,
                body.operationId,
                {
                    action: "system.social_zurueckgenommen",
                    id,
                    details: { beitrag: socNummer(id), kanal: "neuigkeiten" },
                },
                async (tx) => {
                    // Diese Handlung nimmt die Neuigkeit zurück; ein Beitrag nur für Mastodon hat keine (dort: `kanal-zuruecknehmen`).
                    const detail = await socialDetail(tx, id);
                    if (
                        detail?.zeile.ziele.some((ziel) => ziel.kanal === "neuigkeiten" && ziel.zustand === "ok") ===
                        false
                    ) {
                        throw new ApiError(409, "community_transition", "Die Neuigkeit ist nicht veröffentlicht.");
                    }
                    return beitragZuruecknehmen(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                    });
                },
            );
            return quittung(id, revision, await zustandVon(id));
        },
    );

    app.post(
        `${SOCIAL_URL}/:id/erneut`,
        {
            ...verwalten,
            schema: { params: SocialParams, body: SocialErneutBody, response: { 200: SocialQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const body = request.body;
            const kanal: KanalId = body.kanal;
            const revision = await protokolliert(
                request,
                session,
                body.operationId,
                { action: "system.social_erneut_gesendet", id, details: { beitrag: socNummer(id), kanal } },
                async (tx) => {
                    await zaehlePruefe(tx, id);
                    return beitragErneutSenden(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                        kanal,
                    });
                },
                async (tx, _revision, neu) => {
                    if (neu) await reiheSendungenEin(tx, id);
                },
            );
            return quittung(id, revision, await zustandVon(id));
        },
    );

    // --- Fremde Kanäle (WI-0268 C12a) ----------------------------------------------------------------------------------------------

    app.post(
        `${SOCIAL_URL}/:id/kanal-zuruecknehmen`,
        {
            ...verwalten,
            schema: { params: SocialParams, body: SocialErneutBody, response: { 200: SocialQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const body = request.body;
            const kanal: KanalId = body.kanal;
            if (!hatZugang(kanal)) {
                throw ungueltig("Dieser Kanal wird nicht von hier zurückgenommen.", "kanal_ohne_zugang", { kanal });
            }
            const revision = await protokolliert(
                request,
                session,
                body.operationId,
                { action: "system.social_zurueckgenommen", id, details: { beitrag: socNummer(id), kanal } },
                (tx) =>
                    beitragKanalZuruecknehmen(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                        kanal,
                    }),
                async (tx, _revision, neu) => {
                    if (neu) await reiheSendungenEin(tx, id);
                },
            );
            return quittung(id, revision, await zustandVon(id));
        },
    );

    app.get(
        `${SOCIAL_URL}/hashtags`,
        { ...lesen, schema: { response: { 200: SocialHashtags, ...FEHLER } } },
        async (request) => {
            await adminSession(request);
            return { hashtags: await uebersetzt(() => leseHashtags(db())) };
        },
    );

    // Ohne frischen Passkey: Ein Hashtag ändert nichts daran, wohin der Hub sendet, und es geht nichts ohne Freigabe hinaus (`manage_news`, Stufe V, wie jede Arbeit an öffentlichem Text).
    app.post(
        `${SOCIAL_URL}/hashtags`,
        { ...verwalten, schema: { body: SocialHashtags, response: { 200: SocialHashtags, ...FEHLER } } },
        async (request) => {
            const session = await adminSession(request);
            const { hashtags } = request.body;
            const rein = bereinigeHashtags(
                hashtags.map((hashtag) => hashtag.tag),
                SOCIAL_HASHTAG_VORRAT_MAX,
            );
            if (rein.length !== hashtags.length) {
                throw ungueltig("Ein Hashtag hat nicht die richtige Form oder steht doppelt da.", "hashtag_form");
            }
            const neu = rein.map((tag, index) => ({ tag, vorausgewaehlt: hashtags[index]?.vorausgewaehlt === true }));
            const database = app.database;
            if (database === undefined) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
            await uebersetzt(() =>
                database.begin(async (tx) => {
                    await setzeHashtags(tx, neu);
                    await recordEvent(tx, {
                        ...actorFields(session, request),
                        action: "system.social_hashtags",
                        targetRef: "social:hashtags",
                        details: {
                            anzahl: neu.length,
                            vorausgewaehlt: neu.filter((hashtag) => hashtag.vorausgewaehlt).length,
                        },
                    });
                }),
            );
            return { hashtags: await uebersetzt(() => leseHashtags(db())) };
        },
    );

    app.get(
        `${SOCIAL_URL}/kanaele`,
        { ...lesen, schema: { response: { 200: SocialKanaele, ...FEHLER } } },
        async (request) => {
            const session = await adminSession(request);
            const kanaele = await uebersetzt(() => leseKanalStaende(db(), umgebung()));
            return { kanaele, verwalten: hatRecht(session, "manage_social_channels", app.authConfig) };
        },
    );

    /** Der Stand eines Kanals nach einer Handlung. */
    const standNach = async (kanal: KanalMitZugang) =>
        (await uebersetzt(() => leseKanalStaende(db(), umgebung()))).find((stand) => stand.kanal === kanal);

    app.post(
        `${SOCIAL_URL}/kanaele/:kanal/notschalter`,
        {
            ...kanalNotschalter,
            schema: {
                params: SocialKanalParams,
                body: SocialNotschalterBody,
                response: { 200: SocialKanalStand, ...FEHLER },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const { kanal } = request.params;
            const { an } = request.body;
            const database = app.database;
            if (database === undefined) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
            // Das Protokoll nur, wenn sich der Schalter wirklich bewegt; beides in EINER Transaktion.
            await uebersetzt(() =>
                database.begin(async (tx) => {
                    const geaendert = await setzeNotschalter(tx, kanal, an);
                    if (geaendert) {
                        await recordEvent(tx, {
                            ...actorFields(session, request),
                            action: "system.social_kanal_notschalter",
                            targetRef: `kanal:${kanal}`,
                            details: { kanal, an },
                        });
                    }
                }),
            );
            const stand = await standNach(kanal);
            if (stand === undefined) throw new ApiError(404, "community_not_found", "Diesen Kanal gibt es nicht.");
            return stand;
        },
    );

    app.post(
        `${SOCIAL_URL}/kanaele/:kanal/grenzen`,
        {
            ...kanalGrenzen,
            schema: { params: SocialKanalParams, response: { 200: SocialKanalStand, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { kanal } = request.params;
            const database = app.database;
            if (database === undefined) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
            // Das Lesen der Instanz ist ein Netzaufruf: nicht in einer Transaktion.
            const ergebnis = await uebersetzt(() => liesUndSpeichereKanal(database, kanal, umgebung()));
            if (ergebnis.art === "aus") {
                throw new ApiError(409, "community_transition", "Der Kanal ist in dieser Umgebung nicht eingerichtet.");
            }
            if (ergebnis.art === "fehler") {
                // Der Satz des Dienstes (ohne Schlüssel und Adresse) geht als `antwort` mit: Er sagt, was der Dienst bemängelt (WI-0291).
                throw new ApiError(502, "community_kanal", ergebnis.satz, {
                    reason: ergebnis.dauerhaft ? "kanal_zugang" : "kanal_antwort",
                    antwort: ergebnis.satz,
                    ...(ergebnis.status === undefined ? {} : { status: ergebnis.status }),
                });
            }
            await uebersetzt(() =>
                recordEvent(database, {
                    ...actorFields(session, request),
                    action: "system.social_kanal_grenzen",
                    targetRef: `kanal:${kanal}`,
                    details: { kanal, zeichen: ergebnis.grenzen.zeichen, adresse: ergebnis.grenzen.adresse },
                }),
            );
            const stand = await standNach(kanal);
            if (stand === undefined) throw new ApiError(404, "community_not_found", "Diesen Kanal gibt es nicht.");
            return stand;
        },
    );
};
