import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { AVENTURIA, MAIL_ADMIN_URL, MailRoutineBody, MailStand, OperationReceipt } from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession, noStore } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import { COMMUNITY_MAIL_VERSAND_KIND } from "../community/mail/konfiguration.ts";
import { CommunityFehler, communityFehler } from "../community/db.ts";
import { leseUebersicht, setzeSchalter, wartendeMails } from "../community/mail/routine.ts";
import { baueMailStand, ordnerAus } from "../community/mail/stand.ts";
import { isNotProvisioned, type Database, type Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Das Panel „Mailpostfach“ unter Systemsteuerung › Redaktion & Zusammenarbeit (WI-0268 C6c): der Mailweg der Community, Abruf (IMAP) und Versand (SMTP), mit einem Schalter je Art.
 * Vorbild ist die Routine des Discord-Tagesberichts (`routes/discord.ts`).
 *
 *     GET  /api/admin/system/mail             Betrieb, Routine, Zugang (nur ob), letzter Lauf und Erfolg beider Wege    view_operations
 *     POST /api/admin/system/mail/routine     den Abruf oder den Versand an- oder ausschalten                           manage_system_settings + Passkey
 *
 * - 🔴 **Nie in einer Antwort, einem Protokolleintrag oder einem Fehler:** Nutzer, Kennwort, Absenderadresse, Ablagepfad. Der Stand sagt nur, OB der Zugang hinterlegt ist, und nennt IMAP- bzw. SMTP-Host und den Ordner
 *   (`community/mail/stand.ts`). Eingerichtet wird der Zugang nur auf dem Server (`ops/production/mail-einrichten.sh`).
 * - **Der Schalter liegt in der Datenbank** (`mail_routine`, Migration 0289) und gilt ZUSÄTZLICH zur Konfiguration in der `.env`. Aus heißt: Die Pflege reiht keinen Abruf ein, ein wartender Abrufjob endet ohne Verbindung zum
 *   Postfach; der Versand hält die Mails zurück (sie bleiben „wartet“, kein Versuch wird gezählt). Neue Antworten werden weiter eingereiht und bleiben dann liegen.
 * - 🔴 **Wiedereinschalten des Versands** reiht in DERSELBEN Transaktion für jede wartende Mail einen Versandauftrag nach (höchstens 1000; dieselbe Einreihung wie `routes/community.ts`). Ein doppelter Auftrag ist
 *   harmlos: `community_mail_holen` reserviert nur einmal. Scheitert das Einreihen, gilt auch der Schalter nicht.
 * - Das Recht ist `manage_system_settings` mit frischem Passkey (Schreibklasse `system`); keine neue Capability. Das Protokoll trägt Art, von/nach und die Zahl der nachgereihten Mails, keine Person und keine Adresse.
 * - Fehlt die Migration oder ein Recht (Funktion 42883, Recht 42501, Tafel 42P01), antwortet die Route 503 `mail_unavailable`.
 */

const NICHT_BEREIT = "Das Mailpostfach gibt es in dieser Umgebung noch nicht: eine Migration oder ein Recht fehlt.";

const STATUS_VON: Record<string, number> = { community_not_found: 404, community_invalid: 422 };

/** Fehler der Datenbankfunktionen als Fachfehler; „Schema oder Recht fehlt noch“ als 503. */
async function uebersetzt<T>(lauf: () => Promise<T>): Promise<T> {
    try {
        return await lauf();
    } catch (roh) {
        const fehler = communityFehler(roh);
        if (fehler instanceof CommunityFehler)
            throw new ApiError(STATUS_VON[fehler.code] ?? 409, fehler.code, fehler.message, fehler.details);
        if (isNotProvisioned(roh)) throw new ApiError(503, "mail_unavailable", NICHT_BEREIT);
        throw roh;
    }
}

/**
 * Reiht den Versand EINER Mail ein, in der Transaktion des Schalters (`job_enqueue`, SECURITY DEFINER). Dieselbe Einreihung wie `reiheMailEin` in `routes/community.ts`; der Auftrag trägt nur die Kennung des Ausgangs.
 */
async function reiheVersandEin(tx: Queryable, ausgang: number): Promise<void> {
    await tx`
        SELECT public_id::text AS public_id
          FROM job_enqueue(
                   ${COMMUNITY_MAIL_VERSAND_KIND}, 1::smallint, ${AVENTURIA.mapDomain}, 'community', ${tx.json({ ausgang })}::jsonb,
                   50::smallint, NULL, 'tiles', '{}'::smallint[]
               )
    `;
}

export const adminCommunityMailRoutes: FastifyPluginAsyncTypebox = async (app) => {
    noStore(app);
    const lesen = protect("view_operations");
    const schalten = protect("manage_system_settings", { confirm: "passkey", writeClass: "system" });
    const db = (): Database => {
        if (app.database === undefined) throw new ApiError(503, "mail_unavailable", NICHT_BEREIT);
        return app.database;
    };

    app.get(MAIL_ADMIN_URL, { ...lesen, schema: { response: { 200: MailStand, ...ADMIN_ERRORS } } }, async () => {
        // Die Umgebung bei jedem Aufruf lesen (die Unit setzt sie beim Start, Tests setzen sie je Fall).
        const umgebung = process.env;
        const uebersicht = await uebersetzt(() => leseUebersicht(db(), ordnerAus(umgebung)));
        return baueMailStand({ umgebung, uebersicht, jetzt: new Date() });
    });

    app.post(
        `${MAIL_ADMIN_URL}/routine`,
        { ...schalten, schema: { body: MailRoutineBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } } },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, art, aktiv } = request.body;
            return await uebersetzt(() =>
                adminOperation(
                    db(),
                    session,
                    { operationId, body: { action: "mail.routine", art, aktiv } },
                    async (tx) => {
                        const ergebnis = await setzeSchalter(tx, art, aktiv, session.personId);
                        // Erst beim Wiedereinschalten des Versands: was liegen blieb, geht jetzt in die Warteschlange.
                        let nachgereiht = 0;
                        if (art === "versand" && aktiv && !ergebnis.vorher) {
                            for (const ausgang of await wartendeMails(tx)) {
                                await reiheVersandEin(tx, ausgang);
                                nachgereiht += 1;
                            }
                        }
                        return {
                            receipt: {
                                environment: session.environment,
                                affected: [],
                                derivedWork:
                                    nachgereiht > 0 ? [{ kind: COMMUNITY_MAIL_VERSAND_KIND, state: "queued" }] : [],
                                warnings: [],
                            },
                            event: {
                                ...actorFields(session, request),
                                action: "system.community_mail_routine",
                                targetRef: `mail:${art}`,
                                details: {
                                    art,
                                    von: ergebnis.vorher ? "an" : "aus",
                                    nach: aktiv ? "an" : "aus",
                                    nachgereiht,
                                },
                            },
                        };
                    },
                ),
            );
        },
    );
};
