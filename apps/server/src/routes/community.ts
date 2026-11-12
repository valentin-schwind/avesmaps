import { createHash, randomInt } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    AbschliessenBody,
    AlsMeldungAntwort,
    AlsMeldungBody,
    AnfrageAntwortBody,
    AnhangParams,
    AnhangQuery,
    AnKanalAntwort,
    AnKanalBody,
    ApiErrorBody,
    AVENTURIA,
    COMMUNITY_GRENZEN,
    COMMUNITY_URL,
    ComParams,
    CommunityPerson,
    CommunityStand,
    ErneutSendenBody,
    ErneutSendenParams,
    GesendetListe,
    GesendetQuery,
    GrundBody,
    KANAL_GRENZE_VORGAENGE_JE_STUNDE,
    KontaktBody,
    KorrekturBody,
    KorrekturKandidaten,
    MeldungAntwort,
    MeldungBody,
    NeueMailAntwort,
    NeueMailBody,
    NotizBody,
    OperationId,
    PrioritaetBody,
    RollenBody,
    RueckfrageBody,
    StatusAntwortBody,
    StatusBody,
    StatusDiscordLoesenAntwort,
    StatusSicht,
    StatusZurueckziehenBody,
    VorgaengeQuery,
    VorgangDetail,
    VorgangListe,
    VorgangQuittung,
    VorgangSchrittBody,
    ZustaendigBody,
    comNummer,
    istMailAdresse,
    leseCom,
    nurBekannteRollen,
    opsId,
    type Capability,
} from "@avesmaps3d/shared";
import type { FastifyInstance, FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import type postgres from "postgres";
import { ADMIN_ERRORS, actorFields, adminSession, noStore } from "../auth/admin-guard.ts";
import { recordEvent, type AuditAction } from "../auth/audit.ts";
import { demand, protect, protectEines, sameOriginRequest } from "../auth/plugin.ts";
import type { SessionRecord } from "../auth/session-store.ts";
import { isNotProvisioned, type Database, type Queryable } from "../database.ts";
import {
    ANSEHBARE_MIME,
    CommunityFehler,
    abschliessen,
    anhangDatei,
    alsMeldung,
    anfragen,
    anfrageAntworten,
    anfrageAntwortenMail,
    anfrageArchivieren,
    anfrageZurueckholen,
    archivieren,
    communityBereit,
    detail,
    discordLoesen,
    gesendet,
    istVerknuepft,
    korrekturKandidaten,
    liste,
    mailErneut,
    melden,
    neueMail,
    notiz,
    papierkorb,
    personenbezugLoeschen,
    prioritaet,
    revision,
    rueckfrage,
    sichten,
    statusAntworten,
    statusLesen,
    statusZurueckziehen,
    uebernehmen,
    verknuepfen,
    wiederherstellen,
    wiedereroeffnen,
    zustaendig,
    type CommunityFehlerCode,
} from "../community/db.ts";
import {
    bearbeitende,
    type BearbeitendesRecht,
    antwortDesMelders,
    bestenfalls,
    neueAnfrage,
    neueMeldung,
    rollenZugewiesen,
    zugewiesen as meldeZugewiesen,
} from "../community/glocke.ts";
import { dateiAblage } from "../community/mail/ablage.ts";
import { regionenAmBezug } from "../community/regionen.ts";
import { meineRollen, rollenAmEingang, rollenImDetail, rollenLesbar, rollenSetzen } from "../community/rollen.ts";
import { reisebildVorschauen } from "../media-editor/search.ts";
import {
    COMMUNITY_MAIL_VERSAND_KIND,
    leseAblage,
    leseMailKonfiguration,
    type MailZugang,
} from "../community/mail/konfiguration.ts";
import { ApiError, apiErrorBody } from "../http/api-error.ts";
import { KanalFehler, melden as kanalMelden } from "../kanal/db.ts";
import { createRateLimiter } from "../share/rate-limiter.ts";
import { adminCommunityMailRoutes } from "./admin-community-mail.ts";

/**
 * Das Community-Modul an der Leitung (WI-0268, Fachkonzept WI-0263). Die Regeln (Übergänge, Revision, Idempotenz, Aufbewahrung) stehen in der
 * Datenbank (Migration 0265, `community/db.ts`); hier wird nur angenommen, begrenzt, geprüft und übersetzt.
 *
 * Öffentlich (ohne Anmeldung, nur von der eigenen Seite, `no-store`, Schreibklasse `public`):
 *
 *     GET  /api/community/stand                        geht das Meldeformular gerade? (`{ meldungen }`)
 *     POST /api/community/meldungen                    eine Meldung abgeben (201, COM-Nummer)
 *     POST /api/community/anfragen                     das Kontaktformular der Hinweise (201, COM-Nummer; WI-0268 C4)
 *     POST /api/community/status                       die Statusseite lesen (der Schlüssel steht im Rumpf)
 *     POST /api/community/status/antwort               als Melder antworten oder ergänzen
 *     POST /api/community/status/zurueckziehen         die eigene Meldung zurückziehen
 *     POST /api/community/status/discord-loesen        die Verbindung mit Discord lösen (WI-0268 C8; verbunden wird über den Weg `/api/auth/discord/start` mit dem Zweck `melder`)
 *
 * Redaktion (`moderate_submissions`, Stufe R, Schreibklasse `community`; die Personen-ID kommt aus der Sitzung):
 *
 *     GET  /api/community/vorgaenge?segment&art&q      die Liste mit Zählern (Segment `papierkorb` nur mit `moderate_community`)
 *     GET  /api/community/vorgaenge/:com               ein Vorgang mit Bezug, Melder (ohne Kontakt) und Verlauf
 *     GET  /api/community/personen                     wer als Zuständige in Frage kommt (aktiv, ab Reviewer)
 *     POST /api/community/vorgaenge/:com/sichten | uebernehmen | archivieren | prioritaet | notiz | rueckfrage | abschliessen
 *                                                      | wiedereroeffnen | zustaendig | rollen (Sonderrollen, WI-0279)
 *     POST /api/community/vorgaenge/:com/papierkorb | wiederherstellen        `moderate_community`
 *     POST /api/community/vorgaenge/:com/personenbezug-loeschen                `moderate_community` und frischer Passkey
 *
 * Mails (WI-0268 C4, Fachkonzept §9; Reiter Mails): Anfragen tragen Namen und Adressen und gehören einem engeren Kreis.
 *
 *     GET  /api/community/vorgaenge?art=anfrage&segment=eingang | archiv | papierkorb   `read_mailbox` (Papierkorb zusätzlich `moderate_community`)
 *     GET  /api/community/gesendet?q                   die ausgehenden Nachrichten der Anfragen            `read_mailbox`
 *     POST /api/community/vorgaenge/:com/antworten     antworten (Statusseite), mit `archivieren` gleich ins Archiv   `answer_community`
 *     POST /api/community/vorgaenge/:com/ins-archiv | zurueck-in-eingang                               `read_mailbox`
 *     POST /api/community/vorgaenge/:com/als-meldung   aus der Anfrage eine Meldung machen (mit Antwort: `answer_community`)
 *
 * Mailweg (WI-0268 C6a, Migration 0279, Fachkonzept §3.4 und §9; ohne die fünf Angaben der Umgebung `COMMUNITY_MAIL_*` ist er aus, `GET /stand` meldet `mailweg: false`, und Antworten gehen auf die Statusseite):
 *
 *     POST /api/community/vorgaenge/:com/antworten    mit `weg` `mail` (Vorgabe, wenn der Mailweg an ist und der Absender eine Adresse hat) oder `statusseite`          `answer_community`
 *     POST /api/community/vorgaenge/:com/nachrichten/:id/erneut-senden   eine nicht zugestellte Mail noch einmal in den Versand                                       `answer_community`
 *     POST /api/community/mails                       eine neue Mail an eine freie Adresse; höchstens 20 je Person und Tag (429 `community_mail_grenze`)               `send_new_mail`
 *
 * - 🔴 **Kein offenes Relay:** Der Empfänger einer Antwort ist die Adresse des Melders dieses Vorgangs, nie eine Angabe der Anfrage (der Rumpf kennt keine; die Datenbankfunktion hat keinen Parameter dafür). Nur
 *   `POST /mails` nimmt eine Adresse, mit dem eigenen Recht, der Tagesgrenze und einem strengen Muster (genau eine Adresse). Das Protokoll trägt die Nummer, bei einer neuen Mail den Empfänger NUR als Hash.
 * - Die Mail geht nicht aus der Anfrage heraus, sondern über die Warteschlange (Jobart `community_mail_versand`, `jobs/community-mail-job.ts`): Der Eintrag und der Auftrag entstehen in EINER Transaktion; der Auftrag
 *   sendet, trägt den Zustellstand ein und wiederholt vorübergehende Fehler. Wiederholt jemand dieselbe Kennung, entsteht weder eine zweite Mail noch ein zweiter Auftrag.
 *
 * Mailabruf (WI-0268 C6b, Migration 0281, Fachkonzept §3.4): Mails aus dem Postfach sind Nachrichten der Anfragen; das Detail liefert je eingehender Mail Betreff, BEREINIGTES HTML, die Zahl blockierter
 * Bilder und die Anhänge (nur mit `read_mailbox`).
 *
 *     GET  /api/community/vorgaenge/:com/anhaenge/:id[?ansehen=1]   die Datei eines Anhangs aus der Ablage                                                                             `read_mailbox`
 *
 * - 🔴 **Der Pfad entsteht nie aus der Anfrage:** Die Route fragt die Datenbank nach dem Anhang UNTER DIESEM VORGANG und nimmt den Namen der Datei (SHA-256) von dort; die Ablage prüft den Namen noch einmal.
 * - 🔴 **Kopfzeilen:** `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: private, no-store`, `Content-Disposition: attachment`. Nur Bilder und PDF kommen mit
 *   `?ansehen=1` inline; alles andere immer als Download.
 *
 * Verknüpfungen (WI-0268 C7, Fachkonzept §6 und §7; Migration 0272 und 0273):
 *
 *     GET  /api/community/vorgaenge/:com/korrektur-kandidaten   die letzten 15 Operationen am Bezugsobjekt (sonst die eigenen), noch nicht verknüpft   `moderate_submissions`
 *     POST /api/community/vorgaenge/:com/korrektur              eine Korrektur (Kennung einer Operation) von Hand verknüpfen                        `moderate_submissions`
 *     POST /api/community/vorgaenge/:com/an-kanal               im Betreiber-Kanal einen Vorgang anlegen und als OPS-Nummer verknüpfen              zusätzlich `use_operator_channel`
 *
 * - 🔴 **Keine Melderdaten im Kanal:** `an-kanal` legt den Kanal-Vorgang aus Titel und Nachricht an, die die Person schreibt; der Server liest weder Name noch Adresse noch Text des Melders und gibt dem Kanal nur
 *   die COM-Nummer als Verweis mit (`kontext.anfrage`). Beides in EINER Transaktion; dieselbe Kennung der Handlung legt nichts zweites an (die Funktion des Kanals erkennt sie). Das Protokoll trägt nur COM-Nummer und
 *   OPS-Nummer bzw. die Kennung der Operation.
 * - 🔴 **Anfragen sind nur mit `read_mailbox` lesbar und bearbeitbar** (E3, Vali 2026-10-31): ein Wächter vor JEDER Route mit `:com` fragt, ob der Vorgang eine Anfrage ist, und verlangt dann das Recht
 *   (403 `community_forbidden`), gleich ob Lesen oder Schreiben. Die Liste der Meldungen (Vorgabe `art=meldung`), ihre Suche und ihre Zähler enthalten nie Anfragen; Adresse und frühere Vorgänge des Melders
 *   liefert das Detail nur mit dem Recht. Die Protokolleinträge der Mails tragen nur COM-Nummer, Ergebnis und die Nummer der neuen Meldung, nie Adresse, Name oder Text.
 * - 🔴 **Der Schlüssel der Statusseite** (32 Zufallsbytes, nur beim Melder) steht im Rumpf, nie in der Adresse, und in keiner Logzeile. In der
 *   Datenbank liegt nur sein Hash. Ein falscher oder abgelaufener Schlüssel antwortet immer mit demselben 404-Satz, auch wenn der Vorgang
 *   im Papierkorb liegt: Aus der Antwort ist nicht abzulesen, ob es ihn gab.
 * - 🔴 **Missbrauch** (Fachkonzept §10.5): Honigtopf und Zeitfalle verwerfen still (201 mit einer erfundenen Nummer, KEIN Vorgang); die Drossel
 *   zählt je Adresse und Stunde sowie insgesamt je Tag, nur im Speicher und mit gehashter Adresse (wie `besuch.ts`), nie gespeichert.
 * - 🪤 `request.ip` stimmt nur, weil die App allein dem Proxy auf derselben Maschine traut (`trustProxy: "loopback"`, `app.ts`).
 * - **Jeder darf zuweisen, jeder kann empfangen** (WI-0279, Vali 2026-11-11): Wer Meldungen bearbeitet, setzt jede Person als zuständig, leert jede Zuständigkeit und setzt Sonderrollen;
 *   `moderate_community` braucht es dafür nicht mehr. Beim Eingang einer Meldung (Website, Kanal, „Als Meldung weiterführen“) setzt der Server passende Rollen selbst (`community/rollen.ts`).
 * - Abschließen, Wiedereröffnen, Papierkorb und „Personenbezug löschen“ schreiben je einen Eintrag ins Protokoll (nur COM-Nummer und Ergebnis, nie
 *   Text oder Kontakt), in derselben Transaktion wie die Handlung und nur, wenn sie wirklich geschah (nicht bei einer Wiederholung).
 * - Schreibklassen: der Eingang `public`, die Redaktion `community`; beide hängen an keiner Sperre (`system/write-guard.ts`).
 * - 🔔 **Die Glocke** (WI-0268 C5, `community/glocke.ts`): Eine neue Meldung (nicht die der Falle), die Antwort des Melders, eine Zuweisung an eine
 *   ANDERE Person und eine neu zugewiesene Sonderrolle (an ihre Inhaber außer der Person, die zuweist) melden sich in DERSELBEN Transaktion wie die Handlung, aber bestenfalls (Savepoint): Scheitert die Glocke, gilt die Handlung. Sätze
 *   aus Art und COM-Nummer, nie aus dem Text des Melders.
 */

/** Fachcode → HTTP-Status; die Fachcodes selbst stehen in `COMMUNITY_FEHLER` (`packages/shared/src/community.ts`). */
const STATUS_VON: Record<CommunityFehlerCode, number> = {
    community_not_found: 404,
    community_conflict: 409,
    community_transition: 409,
    community_invalid: 422,
    community_mail_grenze: 429,
};

/** Der eine Satz, wenn zu einem Schlüssel kein Vorgang (mehr) da ist: derselbe für „nie gewesen“, „abgelaufen“ und „im Papierkorb“. */
const STATUS_FEHLT = "Zu diesem Link gibt es keine Meldung (mehr).";

const NICHT_BEREIT =
    "Die Community ist auf dieser Instanz noch nicht eingerichtet: eine Migration oder ein Recht fehlt.";

const FEHLER = { ...ADMIN_ERRORS, 422: ApiErrorBody, 429: ApiErrorBody };

/**
 * Ein Fehler der Datenbankfunktionen als Fachcode mit Status. `satz` ersetzt den Text eines `community_not_found` (öffentliche Wege: keiner
 * soll aus dem Wortlaut lesen, ob es den Vorgang gab). Schema oder Recht fehlt noch: 503 `community_unavailable`.
 */
async function uebersetzt<T>(lauf: () => Promise<T>, satz?: string): Promise<T> {
    try {
        return await lauf();
    } catch (roh) {
        if (roh instanceof CommunityFehler) {
            const text = satz !== undefined && roh.code === "community_not_found" ? satz : roh.message;
            throw new ApiError(STATUS_VON[roh.code], roh.code, text, roh.details);
        }
        // Der Kanal antwortet auf eine ungültige Eingabe mit seinem eigenen Fachcode; hier gilt der der Community.
        if (roh instanceof KanalFehler && roh.code === "kanal_invalid")
            throw new ApiError(422, "community_invalid", roh.message);
        if (roh instanceof KanalFehler && roh.code === "kanal_not_found")
            throw new ApiError(404, "community_not_found", roh.message);
        if (isNotProvisioned(roh)) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
        throw roh;
    }
}

function com(text: string): number {
    const id = leseCom(text);
    if (id === undefined) throw new ApiError(404, "community_not_found", "Diesen Vorgang gibt es nicht.");
    return id;
}

/** Ein kurzer Hash der Adresse für die Drossel: Die Adresse selbst wird nirgends gehalten (wie `besuch.ts`). */
const adresse = (ip: string): string => createHash("sha256").update(ip).digest("base64").slice(0, 16);

const zuViele = (): ApiError =>
    new ApiError(429, "community_rate", "Gerade sind zu viele Meldungen eingegangen. Später geht es wieder.", {
        retryAfterSeconds: 3600,
    });

const quittung = (id: number, stand: number) => ({ nummer: comNummer(id), revision: stand });

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

/** Ein zweites Recht, das erst der Inhalt verlangt: fehlt es, 403 `community_forbidden`; Stufe und Bestätigung sagen ihren eigenen Code. */
function verlange(
    app: FastifyInstance,
    session: SessionRecord,
    capability: Capability,
    satz = "Dafür fehlt das Recht, die Community zu moderieren.",
): void {
    try {
        demand(session, capability, app.authConfig);
    } catch (error) {
        if (error instanceof ApiError && error.code === "forbidden") {
            // WI-0291: `reason` und das fehlende Recht, damit das Fenster sagt, welches Recht fehlt und wer es vergibt (der Satz bleibt für Protokoll und alte Fenster).
            throw new ApiError(403, "community_forbidden", satz, { reason: "recht_fehlt", recht: capability });
        }
        throw error;
    }
}

/** Hat die Sitzung das Recht (ohne zu werfen)? Für das, was ein Recht nur anreichert (die Adresse im Detail), nicht verwehrt. */
function darf(app: FastifyInstance, session: SessionRecord, capability: Capability): boolean {
    try {
        demand(session, capability, app.authConfig);
        return true;
    } catch {
        return false;
    }
}

/**
 * `Content-Disposition` mit dem Namen des Anhangs: ein ASCII-Name für alte Programme und der echte Name nach RFC 5987. Der Name stammt aus der Mail (gesäubert beim Abruf), wird aber hier noch einmal so
 * kodiert, dass nichts darin eine Kopfzeile oder einen Parameter beenden kann.
 */
export function dispositionVon(art: "inline" | "attachment", name: string): string {
    const ascii = name.replace(/[^A-Za-z0-9._-]+/gu, "_").slice(0, 100) || "anhang";
    const utf8 = encodeURIComponent(name).replace(
        /['()*]/gu,
        (zeichen) => `%${zeichen.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `${art}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

const MAILS_LESEN = "Dafür fehlt das Recht, Nachrichten zu lesen.";
const MAILWEG_AUS = "Der Mailweg ist noch nicht eingerichtet.";
const MAILS_ANTWORTEN = "Dafür fehlt das Recht, nach außen zu antworten.";
const KANAL_RECHT = "Dafür fehlt das Recht, den Betreiber-Kanal zu nutzen.";

/** 409: Der Mailweg ist aus (WI-0291: `reason`, damit das Fenster den Mailweg neu liest und sagt, was bleibt: die Statusseite). */
const mailwegAus = (): ApiError => new ApiError(409, "community_transition", MAILWEG_AUS, { reason: "mailweg_aus" });

/**
 * Die Datenbank sagt bei einer Dublette, die es nicht gibt, nur die Nummer („COM-000123“) als 404; derselbe Satz käme, wenn der eigene Vorgang fehlte. Hier steht fest, welcher gemeint ist
 * (WI-0291): Trifft die Nummer des Satzes die genannte Dublette, ist es der ANDERE Vorgang. Alles andere bleibt, wie es ist.
 */
function dubletteFehlt(fehler: unknown, id: number, dublette: number | undefined): unknown {
    if (dublette === undefined || !(fehler instanceof ApiError) || fehler.code !== "community_not_found") return fehler;
    if (fehler.message !== comNummer(dublette)) return fehler;
    return new ApiError(404, "community_not_found", fehler.message, {
        reason: dublette === id ? "dublette_selbst" : "dublette_unbekannt",
        nummer: comNummer(dublette),
    });
}

/** Der Satz, wenn jemand nur Mails hat und an eine Meldung will (WI-0279). */
const MELDUNGEN_LESEN = "Dafür fehlt das Recht, Meldungen zu bearbeiten.";

export const communityRoutes: FastifyPluginAsyncTypebox = async (app) => {
    noStore(app);
    const db = (): Database => {
        if (app.database === undefined) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
        return app.database;
    };

    /**
     * 🔴 Der Wächter der Anfragen (WI-0268 C4): vor jeder Route mit `:com` (Lesen wie Schreiben), nach der Prüfung des Rechts der Route und der Form der Anfrage. Ist der Vorgang eine Anfrage, verlangt er
     * `read_mailbox`; eine Meldung lässt er durch. Ein Vorgang, den es nicht gibt, lässt er ebenfalls durch (die Route antwortet dann selbst 404). Zentral an EINER Stelle, damit keine Route vergessen
     * werden kann, die einen Vorgang liest oder ändert.
     */
    app.addHook("preHandler", async (request) => {
        const com = (request.params as { com?: unknown } | undefined)?.com;
        if (typeof com !== "string") return;
        const id = leseCom(com);
        if (id === undefined) return;
        const session = await request.auth.session();
        if (session === undefined) return;
        const [vorgang] = await uebersetzt(
            () => db()<{ art: string }[]>`SELECT art FROM avesmaps_community.vorgang WHERE id = ${id}::bigint`,
        );
        if (vorgang?.art === "anfrage") verlange(app, session, "read_mailbox", MAILS_LESEN);
        // Das Gegenstück (WI-0279): Wer nur Mails hat, liest und ändert keine Meldungen.
        else if (vorgang !== undefined) verlange(app, session, "moderate_submissions", MELDUNGEN_LESEN);
    });

    /** Die Umgebung der Glocke; ohne eingerichtete Anmeldung gibt es keine. */
    const glockenUmgebung = (): string | undefined => app.authConfig.environment;

    /**
     * Der Mailweg dieser Umgebung (WI-0268 C6a): die Angaben aus `COMMUNITY_MAIL_*`, bei jedem Aufruf gelesen (die Unit setzt sie beim Start; Tests setzen sie je Fall). `undefined`, wenn eine fehlt: Der Mailweg ist aus.
     * 🔴 Die Zugangsdaten verlassen `leseMailKonfiguration` nie; diese Datei fragt nur, ob es sie gibt, und nach der Domäne des Absenders (Teil der Message-ID).
     */
    const mailZugang = (): MailZugang | undefined => leseMailKonfiguration(process.env);

    /** Reiht den Versand EINER Mail ein, in der Transaktion, die sie anlegt (`job_enqueue`, SECURITY DEFINER). Der Auftrag trägt nur die Kennung des Ausgangs, nie Adresse oder Text. */
    async function reiheMailEin(tx: Queryable, ausgang: number): Promise<void> {
        await tx`
            SELECT public_id::text AS public_id
              FROM job_enqueue(
                       ${COMMUNITY_MAIL_VERSAND_KIND}, 1::smallint, ${AVENTURIA.mapDomain}, 'community', ${tx.json({ ausgang })}::jsonb,
                       50::smallint, NULL, 'tiles', '{}'::smallint[]
                   )
        `;
    }

    /** Der Empfänger im Protokoll: nur ein Hash (die ersten 16 Zeichen von sha256 der Adresse in Kleinschrift), nie die Adresse. */
    const empfaengerHash = (adresse: string): string =>
        createHash("sha256").update(adresse.trim().toLowerCase(), "utf8").digest("hex").slice(0, 16);

    // Die Drossel lebt im Speicher dieser Instanz und wird nie gespeichert (Fachkonzept §10.5).
    const jeStunde = createRateLimiter(COMMUNITY_GRENZEN.jeAdresseJeStunde, 3_600_000);
    const jeTag = createRateLimiter(COMMUNITY_GRENZEN.jeTag, 86_400_000);
    const antwortenJeStunde = createRateLimiter(20, 3_600_000);

    const oeffentlich = {
        config: { auth: "public" as const, writeClass: "public" as const, errorEnvelope: true as const },
        bodyLimit: COMMUNITY_GRENZEN.rumpfBytes,
        onRequest: nurEigeneSeite(app),
    };
    // Beide Arten teilen die Routen: Wer nur Mails hat (`read_mailbox`, die Sonderrolle Diplomat), kommt herein, und der Wächter oben lässt ihn nur an Anfragen.
    const lesen = protectEines(["moderate_submissions", "read_mailbox"]);
    const schreiben = protectEines(["moderate_submissions", "read_mailbox"], { writeClass: "community" });
    // Papierkorb und Zurückholen: `trash_mail` öffnet nur diese zwei Routen, und dort nur für Anfragen (`verlangeKorb`).
    const korb = protectEines(["moderate_community", "trash_mail"], { writeClass: "community" });
    const loeschen = protect("moderate_community", { confirm: "passkey", writeClass: "community" });
    // Die Rümpfe der Redaktion sind größer als die der Besucher: Begründung und Nachricht zusammen können 6000 Zeichen tragen.
    const REDAKTION_RUMPF = 64 * 1024;

    /**
     * Eine Handlung mit Eintrag im Protokoll: die Datenbankfunktion und das Ereignis in EINER Transaktion, das Ereignis nur, wenn die Handlung
     * wirklich geschah. Eine Wiederholung derselben Kennung (die Funktion erkennt sie am Verlauf des Vorgangs) liefert die Revision und schreibt
     * nichts zweites; eine Sperre je Kennung hält zwei gleichzeitige Wiederholungen hintereinander.
     */
    async function protokolliert<T = number>(
        request: FastifyRequest,
        session: SessionRecord,
        operationId: string,
        ereignis: {
            action: AuditAction;
            id: number;
            /** Feste Schlüssel; als Funktion erst NACH der Handlung berechnet (das Ergebnis steht erst dann fest). */
            details: Record<string, unknown> | ((tx: Queryable, ergebnis: T) => Promise<Record<string, unknown>>);
            /** Wo die Kennung der Handlung sonst steht, wenn nicht am Verlauf (`als-meldung`: an der neuen Meldung). */
            schon?: (tx: Queryable) => Promise<boolean>;
        },
        lauf: (tx: postgres.TransactionSql) => Promise<T>,
    ): Promise<T> {
        const database = app.database;
        if (database === undefined) throw new ApiError(503, "community_unavailable", NICHT_BEREIT);
        // `begin` entpackt Zusagen in Feldern (`UnwrapPromiseArray`); `T` ist hier nie ein Feld, die Zusicherung ist wahr.
        return uebersetzt(
            () =>
                database.begin(async (tx) => {
                    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`community:${operationId}`}, 0))`;
                    const schon =
                        ereignis.schon === undefined
                            ? (
                                  await tx<{ da: boolean }[]>`
                                  SELECT EXISTS (SELECT 1 FROM avesmaps_community.ereignis WHERE operation_id = ${operationId}::uuid) AS da
                              `
                              )[0]?.da === true
                            : await ereignis.schon(tx);
                    const stand = await lauf(tx);
                    if (!schon) {
                        await recordEvent(tx, {
                            ...actorFields(session, request),
                            action: ereignis.action,
                            targetRef: comNummer(ereignis.id),
                            details:
                                typeof ereignis.details === "function"
                                    ? await ereignis.details(tx, stand)
                                    : ereignis.details,
                        });
                    }
                    return stand;
                }) as Promise<T>,
        );
    }

    // --- Öffentlich ---------------------------------------------------------------------------------------------------------

    app.get(
        `${COMMUNITY_URL}/stand`,
        {
            config: { auth: "public", errorEnvelope: true },
            schema: { response: { 200: CommunityStand, 503: ApiErrorBody } },
            onRequest: async (_request, reply) => {
                void reply.header("cache-control", "no-store");
            },
        },
        async () => {
            // Der Mailweg ist an, wenn alle Angaben der Umgebung da sind (ohne sie zu nennen) UND das Modul geht: Ohne Modul gibt es nichts zu senden.
            if (app.database === undefined) return { meldungen: false, mailweg: false, discord: false };
            // „Mit Discord verbinden“ (WI-0268 C8) geht, wenn die Anmeldung mit Discord hier eingerichtet ist (Umgebung, Anwendung, Draht zu Discord) UND das Modul geht.
            const discordDa =
                app.authConfig.environment !== undefined &&
                app.authConfig.discord !== undefined &&
                app.discordClient !== undefined;
            try {
                const bereit = await communityBereit(app.database);
                return {
                    meldungen: bereit,
                    mailweg: bereit && mailZugang() !== undefined,
                    discord: bereit && discordDa,
                };
            } catch (error) {
                // Fehlt das Schema oder das Recht, geht das Formular nicht; das ist ein Stand, kein Fehler.
                if (isNotProvisioned(error)) return { meldungen: false, mailweg: false, discord: false };
                throw error;
            }
        },
    );

    app.post(
        `${COMMUNITY_URL}/meldungen`,
        { ...oeffentlich, schema: { body: MeldungBody, response: { 201: MeldungAntwort, ...FEHLER } } },
        async (request, reply) => {
            const body = request.body;
            const schluessel = adresse(request.ip);
            if (!jeStunde.allows(schluessel) || !jeTag.allows("alle")) throw zuViele();
            // Honigtopf (ein Feld, das ein Mensch nie sieht) und Zeitfalle (schneller als ein Mensch tippt): still verwerfen. Der Bot sieht einen
            // Erfolg mit plausibler Nummer, es entsteht nichts. Beide zählen auf die Drossel der Adresse, nicht auf das Tagesbudget.
            if (body.falle.feld.trim() !== "" || body.falle.dauerMs < COMMUNITY_GRENZEN.mindestDauerMs) {
                jeStunde.record(schluessel);
                request.log.info("Community: Meldung von der Falle verworfen");
                return reply.code(201).send({ nummer: comNummer(randomInt(10, 700)) });
            }
            const umgebung = glockenUmgebung();
            const id = await uebersetzt(() =>
                db().begin(async (tx) => {
                    const angelegt = await melden(tx, {
                        operationId: body.operationId,
                        schluessel: body.schluessel,
                        kategorie: body.kategorie,
                        text: body.text,
                        quelle: body.quelle,
                        fehltArt: body.fehltArt,
                        name: body.name,
                        bezug: body.bezug,
                    });
                    if (umgebung !== undefined) {
                        await bestenfalls(tx, request.log, "neue Meldung", (q) => neueMeldung(q, umgebung, angelegt));
                        await rollenAmEingang(tx, request.log, umgebung, angelegt);
                    }
                    return angelegt;
                }),
            );
            jeStunde.record(schluessel);
            jeTag.record("alle");
            return reply.code(201).send({ nummer: comNummer(id) });
        },
    );

    // Das Kontaktformular der Hinweise (WI-0268 C4): dieselbe Grenze (EIN Zähler je Adresse und Tag für Meldungen und Anfragen), derselbe Honigtopf und dieselbe Zeitfalle wie die Meldung.
    app.post(
        `${COMMUNITY_URL}/anfragen`,
        { ...oeffentlich, schema: { body: KontaktBody, response: { 201: MeldungAntwort, ...FEHLER } } },
        async (request, reply) => {
            const body = request.body;
            const schluessel = adresse(request.ip);
            if (!jeStunde.allows(schluessel) || !jeTag.allows("alle")) throw zuViele();
            if (body.falle.feld.trim() !== "" || body.falle.dauerMs < COMMUNITY_GRENZEN.mindestDauerMs) {
                jeStunde.record(schluessel);
                request.log.info("Community: Anfrage von der Falle verworfen");
                return reply.code(201).send({ nummer: comNummer(randomInt(10, 700)) });
            }
            const umgebung = glockenUmgebung();
            const id = await uebersetzt(() =>
                db().begin(async (tx) => {
                    const angelegt = await anfragen(tx, {
                        operationId: body.operationId,
                        schluessel: body.schluessel,
                        kategorie: body.kategorie,
                        text: body.text,
                        name: body.name,
                        mail: body.mail,
                    });
                    if (umgebung !== undefined) {
                        await bestenfalls(tx, request.log, "neue Anfrage", (q) => neueAnfrage(q, umgebung, angelegt));
                    }
                    return angelegt;
                }),
            );
            jeStunde.record(schluessel);
            jeTag.record("alle");
            return reply.code(201).send({ nummer: comNummer(id) });
        },
    );

    app.post(
        `${COMMUNITY_URL}/status`,
        { ...oeffentlich, schema: { body: StatusBody, response: { 200: StatusSicht, ...FEHLER } } },
        async (request) => {
            const sicht = await uebersetzt(() => statusLesen(db(), request.body.schluessel));
            if (sicht === null) throw new ApiError(404, "community_not_found", STATUS_FEHLT);
            return sicht;
        },
    );

    /**
     * Antwort und Zurückziehen des Melders teilen sich eine Drossel je Adresse; danach liest die Funktion die Nummer des Vorgangs. `danach` läuft
     * in derselben Transaktion (die Glocke zur Antwort), mit der Kennung des Vorgangs.
     */
    async function alsMelder(
        ip: string,
        schluessel: string,
        lauf: (tx: Queryable) => Promise<number>,
        danach?: (tx: postgres.TransactionSql, id: number) => Promise<void>,
    ): Promise<{ nummer: string; revision: number }> {
        const key = adresse(ip);
        if (!antwortenJeStunde.allows(key)) throw zuViele();
        const ergebnis = await uebersetzt(
            () =>
                db().begin(async (tx) => {
                    const stand = await lauf(tx);
                    const sicht = await statusLesen(tx, schluessel);
                    const id = sicht === null ? undefined : leseCom(sicht.nummer);
                    if (sicht !== null && id !== undefined) await danach?.(tx, id);
                    return sicht === null ? null : { nummer: sicht.nummer, revision: stand };
                }),
            STATUS_FEHLT,
        );
        antwortenJeStunde.record(key);
        if (ergebnis === null) throw new ApiError(404, "community_not_found", STATUS_FEHLT);
        return ergebnis;
    }

    app.post(
        `${COMMUNITY_URL}/status/antwort`,
        { ...oeffentlich, schema: { body: StatusAntwortBody, response: { 200: VorgangQuittung, ...FEHLER } } },
        async (request) =>
            alsMelder(
                request.ip,
                request.body.schluessel,
                (tx) => statusAntworten(tx, request.body.operationId, request.body.schluessel, request.body.text),
                async (tx, id) => {
                    const umgebung = glockenUmgebung();
                    if (umgebung === undefined) return;
                    await bestenfalls(tx, request.log, "Antwort des Melders", (q) =>
                        antwortDesMelders(q, umgebung, { id, operationId: request.body.operationId }),
                    );
                },
            ),
    );

    app.post(
        `${COMMUNITY_URL}/status/zurueckziehen`,
        { ...oeffentlich, schema: { body: StatusZurueckziehenBody, response: { 200: VorgangQuittung, ...FEHLER } } },
        async (request) =>
            alsMelder(request.ip, request.body.schluessel, (tx) =>
                statusZurueckziehen(tx, request.body.operationId, request.body.schluessel),
            ),
    );

    // Die Verbindung mit Discord lösen (WI-0268 C8, Fachkonzept §8.4): aus ALLEN Vorgängen derselben Kennung. Dieselbe Drossel je Adresse wie Antwort und Zurückziehen; ein unbekannter Schlüssel ist derselbe 404-Satz.
    app.post(
        `${COMMUNITY_URL}/status/discord-loesen`,
        { ...oeffentlich, schema: { body: StatusBody, response: { 200: StatusDiscordLoesenAntwort, ...FEHLER } } },
        async (request) => {
            const key = adresse(request.ip);
            if (!antwortenJeStunde.allows(key)) throw zuViele();
            const geloest = await uebersetzt(() => discordLoesen(db(), request.body.schluessel), STATUS_FEHLT);
            antwortenJeStunde.record(key);
            return { geloest };
        },
    );

    // --- Redaktion: Lesen ---------------------------------------------------------------------------------------------------

    app.get(
        `${COMMUNITY_URL}/vorgaenge`,
        { ...lesen, schema: { querystring: VorgaengeQuery, response: { 200: VorgangListe, ...FEHLER } } },
        async (request) => {
            const session = await adminSession(request);
            const segment = request.query.segment ?? "offen";
            // Die Liste der Meldungen ist die Vorgabe und enthält nie Anfragen; der Eingang der Mails ist immer die Liste der Anfragen. Anfragen lesen nur, die `read_mailbox` haben.
            const art = request.query.art ?? (segment === "eingang" ? "anfrage" : "meldung");
            if (art === "anfrage") verlange(app, session, "read_mailbox", MAILS_LESEN);
            else verlange(app, session, "moderate_submissions", MELDUNGEN_LESEN);
            // Der Papierkorb ist Sache der Moderation: Was dort liegt, ist meist Spam und kann Unerfreuliches enthalten. Den der Anfragen sieht auch, wer sie wegräumen darf.
            if (segment === "papierkorb" && !(art === "anfrage" && darf(app, session, "trash_mail"))) {
                verlange(app, session, "moderate_community");
            }
            const q = request.query.q?.trim();
            // „Meine“ (WI-0279): meine Sonderrollen, nur bei Meldungen und nur, wenn die Rollen der Meldungen lesbar sind.
            const rollen =
                art === "meldung" && (await rollenLesbar(db()))
                    ? await meineRollen(db(), session.environment, session.personId)
                    : undefined;
            return uebersetzt(() =>
                liste(db(), {
                    segment,
                    art,
                    kontakt: art === "anfrage",
                    ...(q === undefined || q === "" ? {} : { q }),
                    person: session.personId,
                    rollen,
                }),
            );
        },
    );

    app.get(
        `${COMMUNITY_URL}/vorgaenge/:com`,
        { ...lesen, schema: { params: ComParams, response: { 200: VorgangDetail, ...FEHLER } } },
        async (request) => {
            const session = await adminSession(request);
            // Adresse und frühere Vorgänge des Melders liefert das Detail nur mit `read_mailbox`; der Wächter oben hat Anfragen ohne das Recht schon abgewiesen.
            const kontakt = darf(app, session, "read_mailbox");
            const eintrag = await uebersetzt(() => detail(db(), com(request.params.com), { kontakt }));
            if (eintrag === null) throw new ApiError(404, "community_not_found", "Diesen Vorgang gibt es nicht.");
            if (
                eintrag.papierkorbAt !== null &&
                !(eintrag.zeile.art === "anfrage" && darf(app, session, "trash_mail"))
            ) {
                verlange(app, session, "moderate_community");
            }
            // Ein Hinweis (WI-0279 E3c): Fällt er aus, bleibt der Vorgang lesbar.
            const regionen = await regionenAmBezug(db(), session.environment, eintrag.bezug).catch(() => undefined);
            // Die Sonderrollen der Meldung (WI-0279): Fallen sie aus, bleibt der Vorgang lesbar, nur ohne Kasten und Blatt.
            const rollen =
                eintrag.zeile.art === "meldung"
                    ? await rollenImDetail(
                          db(),
                          session.environment,
                          leseCom(eintrag.zeile.nummer) ?? 0,
                          eintrag.bezug,
                      ).catch((fehler: unknown) => {
                          request.log.warn({ err: fehler }, "Community: Sonderrollen des Vorgangs nicht gelesen");
                          return {};
                      })
                    : {};
            // Das gemeldete Reisebild (WI-0272): nur mit dem Recht der Medienverwaltung; fällt die Vorschau aus, bleibt der Vorgang lesbar.
            const bild = eintrag.bezug?.reisebildId ?? null;
            const reisebild =
                bild === null || !darf(app, session, "view_media_private")
                    ? undefined
                    : (await reisebildVorschauen(db(), [bild]).catch(() => undefined))?.get(bild);
            return {
                ...eintrag,
                bezug:
                    eintrag.bezug === null || reisebild === undefined ? eintrag.bezug : { ...eintrag.bezug, reisebild },
                ...(regionen === undefined ? {} : { regionen }),
                ...rollen,
            };
        },
    );

    // Die Datei eines Anhangs (WI-0268 C6b). Der Wächter oben gilt (`:com`); das Recht wird hier ausdrücklich noch einmal verlangt, denn die Datei einer Mail kommt nie ohne `read_mailbox`.
    app.get(
        `${COMMUNITY_URL}/vorgaenge/:com/anhaenge/:id`,
        {
            ...lesen,
            schema: { params: AnhangParams, querystring: AnhangQuery, response: { 200: Type.Unknown(), ...FEHLER } },
            // Nach dem Haken der Instanz (`no-store`): Die Datei ist privat, kein gemeinsamer Zwischenspeicher darf sie halten.
            onSend: async (_request, reply, payload) => {
                void reply.header("cache-control", "private, no-store");
                return payload;
            },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            const nichtDa = (): ApiError => new ApiError(404, "community_not_found", "Diesen Anhang gibt es nicht.");
            const treffer = await uebersetzt(() =>
                anhangDatei(db(), com(request.params.com), Number(request.params.id)),
            );
            // Ein Bild einer Meldung aus dem Betreiber-Kanal (WI-0297) gehört zur Meldung: Es sieht, wer die Meldung sieht (der Wächter oben). Alles andere nur mit `read_mailbox`.
            if (treffer?.ausDiscord !== true) verlange(app, session, "read_mailbox", MAILS_LESEN);
            const verzeichnis = leseAblage(process.env);
            if (treffer === null || verzeichnis === undefined) throw nichtDa();
            const datei = await dateiAblage(verzeichnis).oeffne(treffer.datei);
            if (datei === undefined) throw nichtDa();
            // Ansehen darf nur, was der Browser gefahrlos zeigt (Bild, PDF); der Rest ist immer ein Download.
            const inline = request.query.ansehen === "1" && ANSEHBARE_MIME.has(treffer.mime);
            return reply
                .header("content-type", treffer.mime)
                .header("content-length", datei.groesse)
                .header("content-disposition", dispositionVon(inline ? "inline" : "attachment", treffer.name))
                .header("x-content-type-options", "nosniff")
                .header("content-security-policy", "sandbox; default-src 'none'")
                .header("cache-control", "private, no-store")
                .send(datei.stream);
        },
    );

    /** Aktive Personen dieser Umgebung ab Reviewer (für Anfragen: mit `read_mailbox`): das Menü „Zuständig“. */
    async function redaktion(
        environment: string,
        nur?: string,
        recht: BearbeitendesRecht = "moderate_submissions",
    ): Promise<{ id: string; name: string }[]> {
        // Wer das Recht hat: aus der Rolle oder einer Sonderrolle (WI-0279; `bearbeitende` rechnet dasselbe für die Glocke).
        const personen = await uebersetzt(() => bearbeitende(db(), environment, recht));
        return uebersetzt(
            () => db()<{ id: string; name: string }[]>`
                SELECT p.id::text AS id, p.display_name AS name
                  FROM avesmaps_auth.person p
                 WHERE p.id = ANY(${personen}::uuid[])
                   AND (${nur ?? null}::uuid IS NULL OR p.id = ${nur ?? null}::uuid)
                 ORDER BY p.display_name, p.id
            `,
        );
    }

    // `?mails=true`: wer eine Anfrage übernehmen kann, sind die mit `read_mailbox` (Menü „Zuständig“ im Fenster einer Anfrage); die Liste verlangt dann das Recht selbst.
    app.get(
        `${COMMUNITY_URL}/personen`,
        {
            ...lesen,
            schema: {
                querystring: Type.Object({ mails: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
                response: { 200: Type.Array(CommunityPerson), ...FEHLER },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            if (request.query.mails === true) {
                verlange(app, session, "read_mailbox", MAILS_LESEN);
                return redaktion(session.environment, undefined, "read_mailbox");
            }
            verlange(app, session, "moderate_submissions", MELDUNGEN_LESEN);
            return redaktion(session.environment);
        },
    );

    /** Den Papierkorb bedient die Moderation; `trash_mail` genügt nur bei einer Anfrage, nie bei einer Meldung (WI-0279). */
    async function verlangeKorb(session: SessionRecord, id: number): Promise<void> {
        if (darf(app, session, "moderate_community")) return;
        if (darf(app, session, "trash_mail") && (await istAnfrage(id))) return;
        verlange(app, session, "moderate_community");
    }

    /** Ist der Vorgang eine Anfrage? (Für die Wahl der Personen, die sie übernehmen dürfen.) */
    async function istAnfrage(id: number): Promise<boolean> {
        const [vorgang] = await uebersetzt(
            () => db()<{ art: string }[]>`SELECT art FROM avesmaps_community.vorgang WHERE id = ${id}::bigint`,
        );
        return vorgang?.art === "anfrage";
    }

    // --- Redaktion: Schritte ohne weitere Angabe -------------------------------------------------------------------------------

    const SCHRITTE = [
        ["sichten", sichten],
        ["uebernehmen", uebernehmen],
        ["archivieren", archivieren],
    ] as const;
    for (const [pfad, schritt] of SCHRITTE) {
        app.post(
            `${COMMUNITY_URL}/vorgaenge/:com/${pfad}`,
            {
                ...schreiben,
                bodyLimit: REDAKTION_RUMPF,
                schema: { params: ComParams, body: VorgangSchrittBody, response: { 200: VorgangQuittung, ...FEHLER } },
            },
            async (request) => {
                const session = await adminSession(request);
                const id = com(request.params.com);
                const stand = await uebersetzt(() =>
                    schritt(db(), {
                        operationId: request.body.operationId,
                        id,
                        person: session.personId,
                        revision: request.body.baseRevision,
                    }),
                );
                return quittung(id, stand);
            },
        );
    }

    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/prioritaet`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: PrioritaetBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const stand = await uebersetzt(() =>
                prioritaet(db(), {
                    operationId: request.body.operationId,
                    id,
                    person: session.personId,
                    revision: request.body.baseRevision,
                    prioritaet: request.body.prioritaet,
                }),
            );
            return quittung(id, stand);
        },
    );

    // Notizen prüfen keine Revision (sie hängen nur an); die Quittung trägt die aktuelle.
    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/notiz`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: NotizBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const stand = await uebersetzt(async () => {
                await notiz(db(), {
                    operationId: request.body.operationId,
                    id,
                    person: session.personId,
                    text: request.body.text,
                });
                return revision(db(), id);
            });
            if (stand === null) throw new ApiError(404, "community_not_found", "Diesen Vorgang gibt es nicht.");
            return quittung(id, stand);
        },
    );

    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/rueckfrage`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: RueckfrageBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const stand = await uebersetzt(() =>
                rueckfrage(db(), {
                    operationId: request.body.operationId,
                    id,
                    person: session.personId,
                    revision: request.body.baseRevision,
                    text: request.body.text,
                }),
            );
            return quittung(id, stand);
        },
    );

    // --- Redaktion: Handlungen mit Eintrag im Protokoll ----------------------------------------------------------------------

    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/abschliessen`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: AbschliessenBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const body = request.body;
            let dublette: number | undefined;
            if (body.dubletteVon !== undefined) {
                dublette = leseCom(body.dubletteVon);
                if (dublette === undefined) {
                    throw new ApiError(422, "community_invalid", "Die Nummer des anderen Vorgangs passt nicht.", {
                        reason: "dublette_nummer_ungueltig",
                    });
                }
            }
            const stand = await protokolliert(
                request,
                session,
                body.operationId,
                {
                    action: "system.community_abgeschlossen",
                    id,
                    details: { com: comNummer(id), ergebnis: body.ergebnis },
                },
                (tx) =>
                    abschliessen(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                        ergebnis: body.ergebnis,
                        begruendung: body.begruendung,
                        ...(body.nachricht === undefined ? {} : { nachricht: body.nachricht }),
                        ...(dublette === undefined ? {} : { dubletteVon: dublette }),
                    }),
            ).catch((fehler: unknown) => {
                throw dubletteFehlt(fehler, id, dublette);
            });
            return quittung(id, stand);
        },
    );

    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/wiedereroeffnen`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: GrundBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const body = request.body;
            const stand = await protokolliert(
                request,
                session,
                body.operationId,
                { action: "system.community_wiedereroeffnet", id, details: { com: comNummer(id) } },
                (tx) =>
                    wiedereroeffnen(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                        grund: body.grund,
                    }),
            );
            return quittung(id, stand);
        },
    );

    // --- Redaktion: Zuständigkeit ---------------------------------------------------------------------------------------------

    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/zustaendig`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: ZustaendigBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const ziel = request.body.person;
            const [aktuell] = await uebersetzt(
                () => db()<{ zustaendig: string | null }[]>`
                    SELECT zustaendig::text AS zustaendig FROM avesmaps_community.vorgang WHERE id = ${id}::bigint
                `,
            );
            // Jeder darf zuweisen und jeder kann empfangen (WI-0279, Vali 2026-11-11): Wer Meldungen bearbeitet (bei Anfragen: `read_mailbox`, der Wächter oben), setzt jede
            // Person ein und leert jede Zuständigkeit; bis dahin war beides für andere Sache der Moderation.
            // Die Funktion prüft die Person nicht; ohne diese Frage würde eine erfundene Kennung ein 500 am Fremdschlüssel.
            if (
                ziel !== null &&
                (
                    await redaktion(
                        session.environment,
                        ziel,
                        (await istAnfrage(id)) ? "read_mailbox" : "moderate_submissions",
                    )
                ).length === 0
            ) {
                throw new ApiError(422, "community_invalid", "Diese Person kann nicht zuständig sein.", {
                    reason: "zustaendig_unmoeglich",
                    anfrage: await istAnfrage(id),
                });
            }
            // Die Zuweisung an eine ANDERE Person meldet sich bei ihr in der Glocke, in derselben Transaktion (WI-0268 C5); sich selbst zu
            // übernehmen oder dieselbe Person nochmals einzusetzen löst nichts aus.
            const umgebung = glockenUmgebung();
            const stand = await uebersetzt(() =>
                db().begin(async (tx) => {
                    const revisionNeu = await zustaendig(tx, {
                        operationId: request.body.operationId,
                        id,
                        person: session.personId,
                        revision: request.body.baseRevision,
                        ziel,
                    });
                    if (umgebung !== undefined && ziel !== null) {
                        await bestenfalls(tx, request.log, "Zuweisung", (q) =>
                            meldeZugewiesen(q, umgebung, {
                                id,
                                ziel,
                                von: session.personId,
                                vorher: aktuell?.zustaendig ?? null,
                                operationId: request.body.operationId,
                            }),
                        );
                    }
                    return revisionNeu;
                }),
            );
            return quittung(id, stand);
        },
    );

    // --- Redaktion: Sonderrollen (WI-0279) ------------------------------------------------------------------------------------
    //
    // Die ganze Menge der Rollen einer Meldung (hinzu und heraus), mit Revision wie `zustaendig`; jeder, der Meldungen bearbeitet (der Wächter oben). Die Inhaber der neu
    // hinzugekommenen Rollen hören die Glocke, außer der Person, die zuweist; herausnehmen meldet nichts. Nur Meldungen (eine Anfrage hat keine Rollen).
    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/rollen`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: RollenBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const body = request.body;
            if (!nurBekannteRollen(body.rollen)) {
                throw new ApiError(422, "community_invalid", "Diese Sonderrolle gibt es nicht.", {
                    reason: "sonderrolle_unbekannt",
                });
            }
            if (await istAnfrage(id)) {
                throw new ApiError(409, "community_transition", "Sonderrollen gibt es nur an Meldungen.");
            }
            const umgebung = session.environment;
            const stand = await uebersetzt(() =>
                db().begin(async (tx) => {
                    const ergebnis = await rollenSetzen(tx, umgebung, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                        rollen: body.rollen,
                    });
                    if (ergebnis.hinzu.length > 0 && glockenUmgebung() !== undefined) {
                        await bestenfalls(tx, request.log, "Sonderrollen", (q) =>
                            rollenZugewiesen(q, umgebung, {
                                id,
                                empfaenger: ergebnis.empfaenger,
                                von: session.personId,
                                operationId: body.operationId,
                            }),
                        );
                    }
                    return ergebnis.revision;
                }),
            );
            return quittung(id, stand);
        },
    );

    // --- Mails (WI-0268 C4) -----------------------------------------------------------------------------------------------------
    //
    // Der Wächter oben verlangt `read_mailbox` an jedem Vorgang, der eine Anfrage ist; hier steht, was Anfragen zusätzlich tun. Dass die Funktionen nur für Anfragen gelten, sagt die Datenbank
    // (`community_transition`).

    // Antworten per Mail (WI-0268 C6a) oder, wo es keinen Mailweg gibt, auf die Statusseite; `answer_community`, denn eine Antwort vertritt Avesmaps nach außen.
    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/antworten`,
        {
            ...protect("answer_community", { writeClass: "community" }),
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: AnfrageAntwortBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const body = request.body;
            const zugang = mailZugang();
            // Die Vorgabe: Mail, wenn der Mailweg an ist und der Absender eine (einzelne, gültige) Adresse hat, sonst die Statusseite. Ausdrücklich `mail` ohne Mailweg geht nicht.
            const [melder] = await uebersetzt(
                () => db()<{ mail: string | null }[]>`
                    SELECT mail FROM avesmaps_community.melder WHERE vorgang_id = ${id}::bigint AND entfernt_at IS NULL
                `,
            );
            const hatAdresse = melder?.mail != null && istMailAdresse(melder.mail);
            const weg = body.weg ?? (zugang !== undefined && hatAdresse ? "mail" : "statusseite");
            if (weg === "mail" && zugang === undefined) throw mailwegAus();
            const stand = await protokolliert(
                request,
                session,
                body.operationId,
                {
                    action: "system.community_antwort_gesendet",
                    id,
                    details: {
                        com: comNummer(id),
                        ...(body.archivieren ? { ergebnis: "beantwortet" } : {}),
                        ...(weg === "statusseite" ? {} : { weg }),
                    },
                },
                async (tx) => {
                    if (weg === "mail" && zugang !== undefined) {
                        const gesendetErgebnis = await anfrageAntwortenMail(tx, {
                            operationId: body.operationId,
                            id,
                            person: session.personId,
                            revision: body.baseRevision,
                            text: body.text,
                            archivieren: body.archivieren,
                            domaene: zugang.domaene,
                        });
                        // Nur wer die Mail wirklich anlegte, reiht den Versand ein; eine Wiederholung derselben Kennung findet sie vor und tut nichts.
                        if (gesendetErgebnis.neu && gesendetErgebnis.ausgang !== null)
                            await reiheMailEin(tx, gesendetErgebnis.ausgang);
                        return gesendetErgebnis.revision;
                    }
                    return anfrageAntworten(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                        text: body.text,
                        archivieren: body.archivieren,
                    });
                },
            );
            return quittung(id, stand);
        },
    );

    // Erneut senden (WI-0268 C6a): eine nicht zugestellte Mail geht zurück auf „wartet“ und wird noch einmal eingereiht. Hängt nur an (wie eine Notiz): keine Revision. Nur beim ersten Mal ein Eintrag im Protokoll.
    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/nachrichten/:id/erneut-senden`,
        {
            ...protect("answer_community", { writeClass: "community" }),
            bodyLimit: REDAKTION_RUMPF,
            schema: {
                params: ErneutSendenParams,
                body: ErneutSendenBody,
                response: { 200: VorgangQuittung, ...FEHLER },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const nachricht = Number(request.params.id);
            if (mailZugang() === undefined) throw mailwegAus();
            await uebersetzt(() =>
                db().begin(async (tx) => {
                    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`community:${request.body.operationId}`}, 0))`;
                    const erneut = await mailErneut(tx, {
                        operationId: request.body.operationId,
                        id,
                        nachricht,
                        person: session.personId,
                    });
                    if (!erneut.neu) return;
                    await reiheMailEin(tx, erneut.ausgang);
                    await recordEvent(tx, {
                        ...actorFields(session, request),
                        action: "system.community_mail_erneut",
                        targetRef: comNummer(id),
                        details: { com: comNummer(id) },
                    });
                }),
            );
            const stand = await uebersetzt(() => revision(db(), id));
            if (stand === null) throw new ApiError(404, "community_not_found", "Diesen Vorgang gibt es nicht.");
            return quittung(id, stand);
        },
    );

    // Eine neue Mail an eine freie Adresse (WI-0268 C6a): eigenes Recht `send_new_mail`, denn eine freie Adresse ist ein anderes Risiko als eine Antwort. Legt einen Vorgang im Eingang an („von Avesmaps begonnen“,
    // wartet auf Antwort), die Mail und den Versand in EINER Transaktion. Die Tagesgrenze prüft die Datenbank (429 `community_mail_grenze`).
    app.post(
        `${COMMUNITY_URL}/mails`,
        {
            ...protect("send_new_mail", { writeClass: "community" }),
            bodyLimit: REDAKTION_RUMPF,
            schema: { body: NeueMailBody, response: { 201: NeueMailAntwort, ...FEHLER } },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            const body = request.body;
            const zugang = mailZugang();
            if (zugang === undefined)
                throw new ApiError(503, "community_unavailable", MAILWEG_AUS, { reason: "mailweg_aus" });
            const id = await uebersetzt(() =>
                db().begin(async (tx) => {
                    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`community:${body.operationId}`}, 0))`;
                    const angelegt = await neueMail(tx, {
                        operationId: body.operationId,
                        person: session.personId,
                        an: body.an.trim(),
                        betreff: body.betreff,
                        text: body.text,
                        domaene: zugang.domaene,
                        grenze: COMMUNITY_GRENZEN.neueMailsJeTag,
                    });
                    if (!angelegt.neu || angelegt.ausgang === null) return angelegt.id;
                    await reiheMailEin(tx, angelegt.ausgang);
                    await recordEvent(tx, {
                        ...actorFields(session, request),
                        action: "system.community_mail_neu",
                        targetRef: comNummer(angelegt.id),
                        details: { com: comNummer(angelegt.id), empfaenger: empfaengerHash(body.an) },
                    });
                    return angelegt.id;
                }),
            );
            return reply.code(201).send({ nummer: comNummer(id) });
        },
    );

    // Ins Archiv: ein Klick ohne Begründung; das Ergebnis (`beantwortet` oder `erledigt`) ergibt sich in der Datenbank und steht im Protokoll.
    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/ins-archiv`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: VorgangSchrittBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const body = request.body;
            const stand = await protokolliert(
                request,
                session,
                body.operationId,
                {
                    action: "system.community_archiviert",
                    id,
                    details: async (tx) => {
                        const [vorgang] = await tx<{ ergebnis: string | null }[]>`
                            SELECT ergebnis FROM avesmaps_community.vorgang WHERE id = ${id}::bigint
                        `;
                        return {
                            com: comNummer(id),
                            ...(vorgang?.ergebnis == null ? {} : { ergebnis: vorgang.ergebnis }),
                        };
                    },
                },
                (tx) =>
                    anfrageArchivieren(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                    }),
            );
            return quittung(id, stand);
        },
    );

    // Zurück in den Eingang: das Wiedereröffnen ohne Grund; im Protokoll dasselbe wie sonst beim Wiedereröffnen.
    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/zurueck-in-eingang`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: VorgangSchrittBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const body = request.body;
            const stand = await protokolliert(
                request,
                session,
                body.operationId,
                { action: "system.community_wiedereroeffnet", id, details: { com: comNummer(id) } },
                (tx) =>
                    anfrageZurueckholen(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                    }),
            );
            return quittung(id, stand);
        },
    );

    // Als Meldung weiterführen: eine Meldung mit Bezug, verknüpft, ohne Melderdaten; die Anfrage kommt ins Archiv. Mit Antwort an den Absender braucht es zusätzlich `answer_community`.
    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/als-meldung`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: AlsMeldungBody, response: { 200: AlsMeldungAntwort, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const body = request.body;
            if (body.antwort !== undefined) verlange(app, session, "answer_community", MAILS_ANTWORTEN);
            const neu = await protokolliert<number>(
                request,
                session,
                body.operationId,
                {
                    action: "system.community_als_meldung",
                    id,
                    details: (_tx, meldungId) => Promise.resolve({ com: comNummer(id), meldung: comNummer(meldungId) }),
                    schon: async (tx) =>
                        (
                            await tx<{ da: boolean }[]>`
                                SELECT EXISTS (SELECT 1 FROM avesmaps_community.vorgang WHERE operation_id = ${body.operationId}::uuid) AS da
                            `
                        )[0]?.da === true,
                },
                async (tx) => {
                    const meldung = await alsMeldung(tx, {
                        operationId: body.operationId,
                        anfrage: id,
                        person: session.personId,
                        revision: body.baseRevision,
                        kategorie: body.kategorie,
                        text: body.text,
                        quelle: body.quelle,
                        fehltArt: body.fehltArt,
                        bezug: body.bezug,
                        antwort: body.antwort,
                    });
                    // Wie jeder Eingang einer Meldung (WI-0279): Avesmaps setzt die passenden Sonderrollen, wenn jemand sie hat.
                    const umgebung = glockenUmgebung();
                    if (umgebung !== undefined) await rollenAmEingang(tx, request.log, umgebung, meldung);
                    return meldung;
                },
            );
            const stand = await uebersetzt(() => revision(db(), id));
            return { nummer: comNummer(id), revision: stand ?? 1, meldung: comNummer(neu) };
        },
    );

    // --- Verknüpfungen (WI-0268 C7) ---------------------------------------------------------------------------------------------
    //
    // Der Wächter oben gilt auch hier (`:com`): Eine Anfrage verknüpft nur, wer `read_mailbox` hat.

    // Die Operationen, aus denen „Korrektur verknüpfen“ wählt: am Bezugsobjekt, sonst die eigenen. Lesen wie das Detail.
    app.get(
        `${COMMUNITY_URL}/vorgaenge/:com/korrektur-kandidaten`,
        { ...lesen, schema: { params: ComParams, response: { 200: KorrekturKandidaten, ...FEHLER } } },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const kandidaten = await uebersetzt(() => korrekturKandidaten(db(), id, session.personId));
            if (kandidaten === null) throw new ApiError(404, "community_not_found", "Diesen Vorgang gibt es nicht.");
            return kandidaten;
        },
    );

    // Eine Korrektur von Hand verknüpfen. Eine Verknüpfung hängt nur an (wie eine Notiz): keine Revision, kein Konflikt. Das Protokoll trägt nur die COM-Nummer und die Kennung der Operation,
    // und nur beim ersten Mal; die Sperre je Verknüpfung hält zwei Handlungen mit verschiedener Kennung hintereinander.
    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/korrektur`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: KorrekturBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const body = request.body;
            const verknuepfung = { id, art: "korrektur", ziel: body.ziel } as const;
            await protokolliert<number>(
                request,
                session,
                body.operationId,
                {
                    action: "system.community_korrektur_verknuepft",
                    id,
                    details: { com: comNummer(id), operation: body.ziel },
                    schon: async (tx) => {
                        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`community:verknuepfen:${String(id)}:korrektur:${body.ziel}`}, 0))`;
                        return istVerknuepft(tx, verknuepfung);
                    },
                },
                (tx) => verknuepfen(tx, { ...verknuepfung, person: session.personId }),
            );
            const stand = await uebersetzt(() => revision(db(), id));
            if (stand === null) throw new ApiError(404, "community_not_found", "Diesen Vorgang gibt es nicht.");
            return quittung(id, stand);
        },
    );

    // An den Betreiber-Kanal weiterreichen: im Kanal der eigenen Umgebung entsteht ein Vorgang, am Vorgang steht seine OPS-Nummer. 🔴 Titel und Nachricht schreibt die Person; der Server fügt nichts vom Melder hinzu.
    // Die Grenze des Kanals (20 Vorgänge je Person und Stunde) gilt wie bei `POST /api/kanal/vorgaenge`, aber nur für eine Handlung, die den Kanal-Vorgang wirklich neu anlegt.
    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/an-kanal`,
        {
            ...schreiben,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: AnKanalBody, response: { 200: AnKanalAntwort, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            verlange(app, session, "use_operator_channel", KANAL_RECHT);
            const id = com(request.params.com);
            const body = request.body;
            const kanalId = await protokolliert<number>(
                request,
                session,
                body.operationId,
                {
                    action: "system.community_an_kanal",
                    id,
                    details: (_tx, neuerKanal) => Promise.resolve({ com: comNummer(id), ops: opsId(neuerKanal) }),
                    schon: async (tx) => kanalVorgangDa(tx, body.operationId),
                },
                async (tx) => {
                    if (!(await kanalVorgangDa(tx, body.operationId))) await kanalGrenze(tx, session.personId);
                    const neuerKanal = await kanalMelden(
                        tx,
                        {
                            environment: session.environment,
                            person: session.personId,
                            kategorie: body.kategorie,
                            prioritaet: body.prioritaet,
                            titel: body.titel,
                            nachricht: body.nachricht,
                            kontext: {
                                umgebung: session.environment,
                                release: app.config.releaseId,
                                anfrage: comNummer(id),
                            },
                        },
                        body.operationId,
                    );
                    await verknuepfen(tx, { id, person: session.personId, art: "ops", ziel: opsId(neuerKanal) });
                    return neuerKanal;
                },
            );
            return { nummer: comNummer(id), ops: opsId(kanalId) };
        },
    );

    /** Gibt es den Kanal-Vorgang zu dieser Kennung schon? Die Funktion des Kanals erkennt die Wiederholung an ihr. */
    async function kanalVorgangDa(tx: Queryable, operationId: string): Promise<boolean> {
        const [row] = await tx<{ da: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM avesmaps_kanal.vorgang WHERE operation_id = ${operationId}::uuid) AS da
        `;
        return row?.da === true;
    }

    /** Dieselbe Grenze wie im Kanal (`routes/kanal.ts`, KANAL-0001 §4.2): höchstens so viele neue Vorgänge je Person und Stunde. */
    async function kanalGrenze(tx: Queryable, person: string): Promise<void> {
        const [row] = await tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_kanal.vorgang WHERE gemeldet_von = ${person} AND gemeldet_at > now() - interval '1 hour'
        `;
        if ((row?.n ?? 0) >= KANAL_GRENZE_VORGAENGE_JE_STUNDE) {
            throw new ApiError(
                429,
                "community_rate",
                "Für diese Stunde ist die Grenze des Kanals erreicht. Bitte später weiter.",
                {
                    retryAfterSeconds: 3600,
                },
            );
        }
    }

    // Gesendet: die ausgehenden Nachrichten der Anfragen, neueste zuerst. Eine Sicht, keine Ablage.
    app.get(
        `${COMMUNITY_URL}/gesendet`,
        {
            ...protect("read_mailbox"),
            schema: { querystring: GesendetQuery, response: { 200: GesendetListe, ...FEHLER } },
        },
        async (request) => {
            await adminSession(request);
            const q = request.query.q?.trim();
            return {
                zeilen: await uebersetzt(() => gesendet(db(), q === undefined || q === "" ? {} : { q })),
            };
        },
    );

    // --- Moderation -------------------------------------------------------------------------------------------------------------

    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/papierkorb`,
        {
            ...korb,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: VorgangSchrittBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            await verlangeKorb(session, id);
            const body = request.body;
            const stand = await protokolliert(
                request,
                session,
                body.operationId,
                { action: "system.community_papierkorb", id, details: { com: comNummer(id) } },
                (tx) =>
                    papierkorb(tx, {
                        operationId: body.operationId,
                        id,
                        person: session.personId,
                        revision: body.baseRevision,
                    }),
            );
            return quittung(id, stand);
        },
    );

    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/wiederherstellen`,
        {
            ...korb,
            bodyLimit: REDAKTION_RUMPF,
            schema: { params: ComParams, body: VorgangSchrittBody, response: { 200: VorgangQuittung, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            await verlangeKorb(session, id);
            const stand = await uebersetzt(() =>
                wiederherstellen(db(), {
                    operationId: request.body.operationId,
                    id,
                    person: session.personId,
                    revision: request.body.baseRevision,
                }),
            );
            return quittung(id, stand);
        },
    );

    // Datenschutzanfrage (Fachkonzept §10.4): Melderdaten und seine Texte weg, der Sachinhalt bleibt. Stufe S im Moment: frischer Passkey.
    app.post(
        `${COMMUNITY_URL}/vorgaenge/:com/personenbezug-loeschen`,
        {
            ...loeschen,
            bodyLimit: REDAKTION_RUMPF,
            schema: {
                params: ComParams,
                body: Type.Object({ operationId: OperationId }, { additionalProperties: false }),
                response: { 200: VorgangQuittung, ...FEHLER },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = com(request.params.com);
            const body = request.body;
            const stand = await protokolliert(
                request,
                session,
                body.operationId,
                { action: "system.community_personenbezug_geloescht", id, details: { com: comNummer(id) } },
                (tx) => personenbezugLoeschen(tx, { operationId: body.operationId, id, person: session.personId }),
            );
            return quittung(id, stand);
        },
    );

    // Das Panel „Mailpostfach“ der Systemsteuerung (WI-0268 C6c): Stand und Schalter von Abruf und Versand.
    app.register(adminCommunityMailRoutes);
};
