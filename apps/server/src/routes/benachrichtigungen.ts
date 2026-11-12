import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    BENACHRICHTIGUNG_SEITE,
    BENACHRICHTIGUNG_URL,
    BenachrichtigungAntwortBody,
    BenachrichtigungGelesen,
    BenachrichtigungGelesenBody,
    BenachrichtigungListe,
    BenachrichtigungParams,
    OperationReceipt,
    opsId,
    type Benachrichtigung,
    type BenachrichtigungAntwort,
    type KanalStatus,
} from "@avesmaps3d/shared";
import type { FastifyRequest } from "fastify";
import { ADMIN_ERRORS, noStore } from "../auth/admin-guard.ts";
import { protect, sessionOnly } from "../auth/plugin.ts";
import type { SessionRecord } from "../auth/session-store.ts";
import { ApiError } from "../http/api-error.ts";
import { KanalFehler, abnehmen, kanalFehler, wiederOeffnen } from "../kanal/db.ts";
import { reisebildVorschauen } from "../media-editor/search.ts";

/**
 * Benachrichtigungen in der Leiste (WI-0136, NACHRICHT-0001 §3.2). Erzeugt werden sie nur in der Datenbank (`benachrichtige`, Migration
 * 0107); hier wird gelesen, als gelesen markiert und auf „Fix ist live“ geantwortet.
 *
 *     GET  /api/benachrichtigungen                  die jüngsten 50 eigenen, Zahl ungelesen; ETag, sonst 304          Sitzung
 *     POST /api/benachrichtigungen/gelesen          { bis }  alle eigenen bis dahin gelesen                            Sitzung
 *     POST /api/benachrichtigungen/:id/antwort      { operationId, antwort, kommentar? }  „Gelöst“ / „Noch nicht gelöst“  use_operator_channel
 *
 * - Jede Person sieht nur die eigenen Zeilen in ihrer Umgebung. Den Stand des Vorgangs gibt es nur mit dem Kanal.
 * - 🔴 Eine Art, die erst ein neueres Release schreibt, bricht das Lesen nicht (WI-0181, Versprechen von 0118): Sie kommt mit, zählt als
 *   ungelesen und lässt sich als gelesen markieren.
 * - „Gelöst“ ist dieselbe Handlung wie „Abnehmen“ im Kanal, „Noch nicht gelöst“ dieselbe wie „Wieder öffnen mit Kommentar“ (W2), mit der
 *   Revision von jetzt. Hat schon jemand im Kanal geantwortet, ist der Vorgang nicht mehr zur Abnahme: 409, und die Oberfläche zeigt den
 *   Stand.
 * - Eine neue Meldung zu einem Reisebild trägt beim Lesen dessen Vorschau (`bilder`, WI-0272), nur mit `view_media_private`. 🔴 Bestenfalls: Scheitert das, kommt die Glocke ohne Bild; an einer Zierde darf sie nie hängen.
 */

interface Zeile {
    id: string;
    /** Auch eine Art, die dieses Release nicht kennt (WI-0181). */
    art: string;
    von_art: Benachrichtigung["von"]["art"];
    von_person: string | null;
    von_name: string | null;
    bezug_ops: string | null;
    text: string | null;
    frage_geloest: boolean;
    erstellt_at: Date;
    gelesen_at: Date | null;
    beantwortet_at: Date | null;
    antwort: BenachrichtigungAntwort | null;
    status: KanalStatus | null;
    abgenommen_name: string | null;
    abgenommen_at: Date | null;
}

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

/** Die COM-Nummer im `text` einer neuen Meldung; eine gebündelte trägt die Zahl und nennt kein Bild. */
const COM_NUMMER = /^COM-([0-9]{6,12})$/u;

function eintrag(zeile: Zeile, mitKanal: boolean, bilder?: Benachrichtigung["bilder"]): Benachrichtigung {
    return {
        id: Number(zeile.id),
        ...(bilder === undefined ? {} : { bilder }),
        art: zeile.art,
        von: {
            art: zeile.von_art,
            id: zeile.von_person,
            name: zeile.von_art === "person" ? (zeile.von_name ?? null) : null,
        },
        ops: zeile.bezug_ops === null ? null : opsId(zeile.bezug_ops),
        text: zeile.text,
        frageGeloest: zeile.frage_geloest,
        erstelltAt: zeile.erstellt_at.toISOString(),
        gelesenAt: iso(zeile.gelesen_at),
        beantwortetAt: iso(zeile.beantwortet_at),
        antwort: zeile.antwort,
        vorgang:
            mitKanal && zeile.status !== null
                ? { status: zeile.status, abgenommenVon: zeile.abgenommen_name, abgenommenAt: iso(zeile.abgenommen_at) }
                : null,
    };
}

export const benachrichtigungRoutes: FastifyPluginAsyncTypebox = async (app) => {
    noStore(app);
    const db = () => app.database!;
    const eigene = async (request: FastifyRequest): Promise<SessionRecord> => {
        const session = await request.auth.session();
        if (session === undefined) throw new ApiError(401, "unauthenticated", "Dafür ist eine Anmeldung nötig.");
        return session;
    };
    const ungelesen = async (session: SessionRecord): Promise<number> => {
        const [row] = await db()<{ n: number }[]>`
            SELECT count(*)::int AS n FROM public.benachrichtigung
             WHERE an_person = ${session.personId} AND environment = ${session.environment} AND gelesen_at IS NULL
        `;
        return row?.n ?? 0;
    };

    /** Je Zeile der Glocke das Reisebild, das ihre neue Meldung betrifft. */
    const gemeldeteBilder = async (
        request: FastifyRequest,
        zeilen: readonly Zeile[],
    ): Promise<Map<string, NonNullable<Benachrichtigung["bilder"]>>> => {
        const jeZeile = new Map<string, NonNullable<Benachrichtigung["bilder"]>>();
        const meldungen = zeilen.flatMap((zeile) => {
            const nummer = zeile.art === "community_neu" ? COM_NUMMER.exec(zeile.text ?? "")?.[1] : undefined;
            return nummer === undefined ? [] : [{ zeile: zeile.id, vorgang: String(Number(nummer)) }];
        });
        if (meldungen.length === 0) return jeZeile;
        try {
            const bezuege = await db()<{ vorgang: string; bild: string }[]>`
                SELECT vorgang_id::text AS vorgang, reisebild_id::text AS bild FROM avesmaps_community.bezug
                 WHERE vorgang_id = ANY(${meldungen.map((meldung) => meldung.vorgang)}::bigint[]) AND reisebild_id IS NOT NULL
            `;
            const vorschauen = await reisebildVorschauen(
                db(),
                bezuege.map((bezug) => bezug.bild),
            );
            const bildJeVorgang = new Map(bezuege.map((bezug) => [bezug.vorgang, bezug.bild]));
            for (const meldung of meldungen) {
                const vorschau = vorschauen.get(bildJeVorgang.get(meldung.vorgang) ?? "");
                if (vorschau !== undefined) jeZeile.set(meldung.zeile, [vorschau]);
            }
        } catch (error) {
            request.log.warn({ err: error }, "Glocke: Vorschau gemeldeter Reisebilder fehlt");
        }
        return jeZeile;
    };

    app.get(
        BENACHRICHTIGUNG_URL,
        { ...sessionOnly(), schema: { response: { 200: BenachrichtigungListe, 304: Type.Null(), ...ADMIN_ERRORS } } },
        async (request, reply) => {
            const session = await eigene(request);
            const rechte = await request.auth.capabilities();
            const mitKanal = rechte.has("use_operator_channel");
            const [zeilen, zahl] = await Promise.all([
                db()<Zeile[]>`
                    SELECT b.id::text, b.art, b.von_art, b.von_person::text, p.display_name AS von_name, b.bezug_ops::text, b.text,
                           b.frage_geloest, b.erstellt_at, b.gelesen_at, b.beantwortet_at, b.antwort,
                           v.status, a.display_name AS abgenommen_name, v.abgenommen_at
                      FROM public.benachrichtigung b
                      LEFT JOIN avesmaps_auth.person p ON p.id = b.von_person
                      LEFT JOIN avesmaps_kanal.vorgang v ON v.id = b.bezug_ops AND v.environment = b.environment
                      LEFT JOIN avesmaps_auth.person a ON a.id = v.abgenommen_von
                     WHERE b.an_person = ${session.personId} AND b.environment = ${session.environment}
                     ORDER BY b.id DESC
                     LIMIT ${BENACHRICHTIGUNG_SEITE}
                `,
                ungelesen(session),
            ]);
            const bilder = rechte.has("view_media_private") ? await gemeldeteBilder(request, zeilen) : undefined;
            const body: BenachrichtigungListe = {
                ungelesen: zahl,
                eintraege: zeilen.map((z) => eintrag(z, mitKanal, bilder?.get(z.id))),
            };
            // Der ETag ist der Inhalt selbst: Ändert sich nichts, kostet die Nachfrage im Takt nur ein 304.
            const etag = `"b${createHash("sha1").update(JSON.stringify(body)).digest("base64url").slice(0, 22)}"`;
            reply.header("etag", etag);
            if (request.headers["if-none-match"] === etag) return reply.code(304).send(null);
            return body;
        },
    );

    app.post(
        `${BENACHRICHTIGUNG_URL}/gelesen`,
        {
            ...sessionOnly(),
            schema: { body: BenachrichtigungGelesenBody, response: { 200: BenachrichtigungGelesen, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await eigene(request);
            await db()`
                UPDATE public.benachrichtigung SET gelesen_at = now()
                 WHERE an_person = ${session.personId} AND environment = ${session.environment}
                   AND id <= ${request.body.bis} AND gelesen_at IS NULL
            `;
            return { ungelesen: await ungelesen(session) };
        },
    );

    app.post(
        `${BENACHRICHTIGUNG_URL}/:id/antwort`,
        {
            ...protect("use_operator_channel", { writeClass: "kanal" }),
            schema: {
                params: BenachrichtigungParams,
                body: BenachrichtigungAntwortBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const session = await eigene(request);
            const { operationId, antwort, kommentar } = request.body;
            if (antwort === "nicht_geloest" && (kommentar === undefined || kommentar.trim() === "")) {
                throw new ApiError(400, "validation_failed", "„Noch nicht gelöst“ braucht einen Kommentar.", {
                    issues: [{ path: "kommentar", rule: "required" }],
                });
            }
            const vorgang = await db().begin(async (tx) => {
                const [zeile] = await tx<
                    {
                        frage_geloest: boolean;
                        antwort: string | null;
                        bezug_ops: string | null;
                        revision: number | null;
                        status: string | null;
                    }[]
                >`
                    SELECT b.frage_geloest, b.antwort, b.bezug_ops::text, v.revision, v.status
                      FROM public.benachrichtigung b
                      LEFT JOIN avesmaps_kanal.vorgang v ON v.id = b.bezug_ops AND v.environment = b.environment
                     WHERE b.id = ${request.params.id} AND b.an_person = ${session.personId} AND b.environment = ${session.environment}
                       FOR UPDATE OF b
                `;
                if (zeile === undefined) throw new ApiError(404, "not_found", "Diese Benachrichtigung gibt es nicht.");
                if (!zeile.frage_geloest || zeile.bezug_ops === null || zeile.revision === null) {
                    throw new ApiError(409, "benachrichtigung_ohne_frage", "Hier gibt es nichts zu beantworten.");
                }
                if (zeile.antwort !== null)
                    throw new ApiError(409, "benachrichtigung_beantwortet", "Schon beantwortet.");
                const id = Number(zeile.bezug_ops);
                try {
                    if (antwort === "geloest") await abnehmen(tx, id, session.personId, zeile.revision, operationId);
                    else await wiederOeffnen(tx, id, session.personId, zeile.revision, kommentar!.trim(), operationId);
                } catch (roh) {
                    // Schon abgenommen oder wieder geöffnet (im Kanal): 409, die Oberfläche zeigt den Stand.
                    const fehler = kanalFehler(roh);
                    if (fehler instanceof KanalFehler) {
                        throw new ApiError(fehler.code === "kanal_not_found" ? 404 : 409, fehler.code, fehler.message);
                    }
                    throw roh;
                }
                await tx`
                    UPDATE public.benachrichtigung SET antwort = ${antwort}, beantwortet_at = now(), gelesen_at = COALESCE(gelesen_at, now())
                     WHERE id = ${request.params.id}
                `;
                return id;
            });
            return {
                operationId,
                status: "applied" as const,
                environment: session.environment,
                affected: [{ kind: "kanal_vorgang", id: opsId(vorgang) }],
                derivedWork: [],
                warnings: [],
            };
        },
    );
};
