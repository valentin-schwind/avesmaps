import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyReply } from "fastify";
import { Type } from "@sinclair/typebox";
import {
    FastifyErrorBody,
    loreSwitchKey,
    SEARCH_BEISPIELE_URL,
    SEARCH_EINTRAG_URL,
    SEARCH_LAGEN,
    SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX,
    SEARCH_LEUCHTEN_URL,
    SEARCH_ZAHLEN_MAX,
    SEARCH_ZAHLEN_URL,
    SearchBeispiele,
    SearchEintrag,
    SearchLeuchten,
    SearchResponse,
    SearchZahlen,
    SEARCH_LIMIT,
    UUID_PATTERN,
    type InhalteVorkommenArt,
    type SearchLeuchtAnfrage,
} from "@avesmaps3d/shared";
import { etagMatches } from "../media/delivery.ts";
import { beispiele } from "../search/beispiele.ts";
import { eintragFuerPanel, eintragStempel } from "../search/eintrag.ts";
import { vorkommenIndex } from "../search/vorkommen-index.ts";
import { ADMIN_ERRORS } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import { apiErrorBody } from "../http/api-error.ts";
import { search } from "../search/search.ts";
import { gemessen } from "../search/vorkommen-suche.ts";
import { istAus } from "../system/inhaltsstand.ts";
import { anfrageGueltig, anfrageHash, leuchte, SCHALTER_ARTEN, zaehle } from "../vorkommen/leuchten.ts";
import { ermittleKartenstand } from "../vorkommen/regeln.ts";

/**
 * Der Suchendpunkt (WI-0013) und, seit WI-0257 S3a, die Wege der Vorkommen in der Spotlight-Suche.
 *
 *     GET /api/search            die Tastendruck-Suche; neu und nur, wo es etwas gibt: `vorkommen`, `gebiete`, `anfrage`
 *     GET /api/search/leuchten   was für einen Treffer auf der Karte leuchtet (ganze Gegenden, Zuschnitte, Orte, Rahmen für den Flug)
 *     GET /api/search/zahlen     die Zahl der leuchtenden Gegenden für bis zu acht Einträge
 *     GET /api/search/beispiele  echte Anfragen mit Treffern für den wechselnden Platzhalter
 *
 * 🔴 ER LIEST NUR. Keine Methode ausser GET, kein Schreibpfad, kein Nebeneffekt.
 *
 * 🪤 Die Anfrage wird auf 100 Zeichen begrenzt, bevor sie die Datenbank sieht. Nicht wegen der
 * Einschleusung — die Abfrage ist parametrisiert —, sondern weil ein Suchmuster aus zehntausend
 * Zeichen jeden Namen im Bestand einmal vergleichen laesst, ohne je etwas zu treffen.
 *
 * 🔴 **Die neuen Wege liegen unter `/api/search/`** und sind damit öffentlich (die Karte braucht keine Anmeldung) und in der Zone „karte“ der Schnittstellenzählung. 🪤 Sie liegen AUSSERHALB der
 * Nginx-Drossel (`location ~ ^/api/(search|route/waypoints)$` nimmt nur den genauen Pfad) und rechnen teurer als die Tastendruck-Suche: Darum gilt hier die Grenze der Anwendung
 * (`CONCURRENT`, sonst 503 `busy` mit `Retry-After`), und `leuchten` und `zahlen` antworten mit ETag aus dem Kartenstand (304 ohne Rechnung).
 *
 * 🔴 **Die Inhaltsschalter je Art gelten** (`panel.lore.<art>`): Eine ausgeblendete Art fehlt in der Sektion „Vorkommen“ und in den Begriffen der Anfragen; ihr Leuchten antwortet leer mit
 * `pausiert`, und die Zahlen nennen sie nicht. Der Stand kommt aus dem Speicher der Schalter (`app.inhaltsschalter`), ohne Datenbankfrage je Tastendruck.
 */

/** So viele Rechnungen dieser Wege laufen höchstens zugleich im Prozess. */
const CONCURRENT = 4;

const UUID = UUID_PATTERN.slice(1, -1);
const UUID_LISTE = (max: number): string => `^${UUID}(,${UUID}){0,${String(max - 1)}}$`;

const FehlerBody = Type.Object({ error: Type.String() });
/** Eine ungültige Anfrage beantwortet entweder Fastify (Schema: `FastifyErrorBody`) oder wir (die Angaben passen nicht zusammen); steht nur eine Form im Schema, wird aus der anderen ein 500. */
const FehlerOderFastify = Type.Union([FastifyErrorBody, FehlerBody]);

export const searchRoutes: FastifyPluginAsyncTypebox = async (app) => {
    /** Die Arten, die gerade ausgeblendet sind; ohne Speicher (keine Datenbank) keine. */
    const ausgeblendetVon = async (): Promise<((art: InhalteVorkommenArt) => boolean) | undefined> => {
        const store = app.inhaltsschalter;
        if (store === undefined) return undefined;
        const stand = await store.read();
        return (art) => istAus(stand, loreSwitchKey(art));
    };

    app.get(
        "/api/search",
        {
            schema: {
                querystring: Type.Object({
                    q: Type.String({ maxLength: 100 }),
                    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SEARCH_LIMIT })),
                    /**
                     * Sucht ein Editor? Dann findet er einen Seeweg über seinen genauen Namen. Seewegnamen sind nicht geheim;
                     * wirksam ist der Schalter trotzdem nur mit dem Recht `search_sea_route_names` aus der Sitzung (WI-0120 A11,
                     * AUTH-0001 §13): Ein Besucher, der ihn setzt, sucht wie ein Besucher.
                     */
                    editor: Type.Optional(Type.Boolean()),
                    /**
                     * Die Klimazonen, deren Name in der Sprache des Browsers zur Anfrage passt, als Schlüssel
                     * (`polar,gemaessigt`; WI-0171, Betreiber 2026-10-15, Weg D).
                     *
                     * 🔴 Die acht Namen stehen in der Sprachtafel des Browsers, und hier kann niemand dort
                     * nachschlagen. Deshalb nennt der Browser die Schlüssel, und der Server bleibt bei dem, was nur er
                     * kann: der Geometrie. Deutsch findet er zusätzlich selbst (`label ILIKE`), damit eine neue
                     * Sprachtafel ohne Serveränderung auskommt und eine alte Adresse weiter trifft.
                     *
                     * 🪤 Die Liste ist eine ANGABE, keine Vollmacht: Gesucht wird nur unter den aktiven Zonen, und mehr
                     * als ihren Namen und ihr Sprungziel gibt die Antwort nicht her (dieselben acht Zeilen, die jede
                     * Karte schon zeichnet).
                     */
                    climate: Type.Optional(Type.String({ maxLength: 200, pattern: "^[a-z_]+(,[a-z_]+)*$" })),
                }),
                response: { 200: SearchResponse, 204: Type.Null(), 503: Type.Object({ error: Type.String() }) },
            },
        },
        async (request, reply) => {
            if (!app.database) {
                // 🪤 503 und nicht 500: die Suche ist nicht kaputt, sie ist gerade nicht bedienbar.
                // Derselbe Unterschied, den `/health/ready` macht.
                return reply.code(503).send({ error: "Datenbank nicht verbunden" });
            }
            const { q, limit, climate } = request.query;
            // Die Sitzung nur fragen, wenn der Schalter gesetzt ist: Die gewöhnliche Suche bleibt ohne Datenbankabfrage für die Anmeldung.
            const editor =
                request.query.editor === true && (await request.auth.capabilities()).has("search_sea_route_names");
            const climateKeys = climate === undefined ? [] : climate.split(",");
            // Die Dauer je Teil als `Server-Timing` (Claudio 2026-11-01: in Production 1,2 bis 1,4 s ohne Last): Wo die Zeit hingeht, sieht man im
            // Browser und mit `curl -i`, ohne Zugang zur Datenbank.
            const zeiten = new Map<string, number>();
            const beginn = performance.now();
            const ausgeblendet = await gemessen(zeiten, "schalter", ausgeblendetVon());
            // Verwirft der Browser die Anfrage (ein neuer Tastendruck), schließt er die Antwort vor ihrem Ende: Dann bricht die Hauptabfrage ab, und der
            // Abbruch ist kein Fehler (er stünde sonst im Journal, das der Postflight zählt).
            const verworfen = new AbortController();
            reply.raw.once("close", () => {
                if (!reply.raw.writableFinished) verworfen.abort();
            });
            const antwort = await search(app.database, q, {
                zeiten,
                signal: verworfen.signal,
                ...(limit === undefined ? {} : { limit }),
                ...(editor ? { editor } : {}),
                ...(climateKeys.length === 0 ? {} : { climateKeys }),
                ...(ausgeblendet === undefined ? {} : { ausgeblendet }),
                // Ein Fehler im Vorkommen-Anteil nimmt der Suche ihre eigenen Treffer nicht.
                onVorkommenFehler: (fehler) => {
                    request.log.warn({ err: fehler }, "Suche: Vorkommen-Anteil fehlgeschlagen");
                },
                // Ebenso die Sektion „Sprachen“ (WI-0261 S5c).
                onSprachenFehler: (fehler) => {
                    request.log.warn({ err: fehler }, "Suche: Sprachen-Anteil fehlgeschlagen");
                },
            }).catch((fehler: unknown) => {
                if (verworfen.signal.aborted) return undefined;
                throw fehler;
            });
            // Niemand wartet mehr: nichts senden, nichts melden.
            if (antwort === undefined) return reply.code(204).send(null);
            zeiten.set("gesamt", performance.now() - beginn);
            void reply.header(
                "Server-Timing",
                [...zeiten].map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(", "),
            );
            return antwort;
        },
    );

    // Der Abfrageplan der Suche für Betreiber (Claudio 2026-11-01, Suche unter Last): Die Hauptabfrage braucht auf der Stage 1,2 s gleich welches Wort,
    // lokal 0,05 s; den Plan mit den Daten dort sieht so jemand ohne Zugang zur Datenbank. Lesend, mit derselben Anfrage wie `/api/search`.
    app.get(
        "/api/admin/system/suche-plan",
        {
            ...protect("view_operations"),
            schema: {
                querystring: Type.Object({ q: Type.String({ maxLength: 100 }) }),
                response: { 200: Type.Object({ plan: Type.Array(Type.String()) }), ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            if (!app.database)
                return reply.code(503).send(apiErrorBody("database_unavailable", "Datenbank nicht verbunden"));
            let plan: string[] = [];
            await search(app.database, request.query.q, {
                abfrageplan: (zeilen) => {
                    plan = zeilen;
                },
            });
            return { plan };
        },
    );

    // Die laufenden Rechnungen dieser Wege (Semaphor), alle drei zusammen.
    let running = 0;
    const guarded = async <T>(
        reply: FastifyReply,
        work: () => Promise<T>,
    ): Promise<{ result: T } | { rejected: FastifyReply }> => {
        if (running >= CONCURRENT) {
            void reply.header("Retry-After", "1");
            return { rejected: reply.code(503).send({ error: "busy" }) };
        }
        running += 1;
        try {
            return { result: await work() };
        } finally {
            running -= 1;
        }
    };

    /** Der ETag einer Antwort: Kartenstand, ausgeblendete Arten und der Schlüssel der Anfrage; sonst nichts. */
    const etagVon = (
        stand: string,
        ausgeblendet: ((art: InhalteVorkommenArt) => boolean) | undefined,
        schluessel: string,
    ): string => {
        const aus = SCHALTER_ARTEN.filter((art) => ausgeblendet?.(art) === true).join(",");
        return `W/"${createHash("sha256").update(`${stand}|${aus}|${schluessel}`).digest("base64url").slice(0, 32)}"`;
    };

    app.get(
        SEARCH_LEUCHTEN_URL,
        {
            schema: {
                querystring: Type.Object({
                    eintrag: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
                    art: Type.Optional(Type.String({ pattern: "^[a-z_]{2,40}$" })),
                    /** Die Landschaften des Ziels, `region.public_id` mit Komma (gleichnamige sind EIN Ziel). */
                    landschaften: Type.Optional(Type.String({ pattern: UUID_LISTE(SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX) })),
                    gebiet: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
                    lage: Type.Optional(Type.Union(SEARCH_LAGEN.map((lage) => Type.Literal(lage)))),
                    /** Der Ort der Lage, bei `zwischen` zwei (`place.public_id` mit Komma). */
                    orte: Type.Optional(Type.String({ pattern: UUID_LISTE(2) })),
                }),
                response: {
                    200: SearchLeuchten,
                    304: Type.Null(),
                    400: FehlerOderFastify,
                    404: FehlerBody,
                    503: FehlerBody,
                },
            },
        },
        async (request, reply) => {
            const database = app.database;
            if (!database) return reply.code(503).send({ error: "Datenbank nicht verbunden" });
            const query = request.query;
            const anfrage: SearchLeuchtAnfrage = {
                ...(query.eintrag === undefined ? {} : { eintrag: query.eintrag }),
                ...(query.art === undefined ? {} : { art: query.art }),
                ...(query.landschaften === undefined ? {} : { landschaften: query.landschaften.split(",") }),
                ...(query.gebiet === undefined ? {} : { gebiet: query.gebiet }),
                ...(query.lage === undefined ? {} : { lage: query.lage }),
                ...(query.orte === undefined ? {} : { orte: query.orte.split(",") }),
            };
            if (!anfrageGueltig(anfrage)) {
                void reply.header("cache-control", "no-store");
                // Fastifys eigene 400 trägt `{ statusCode, code, error, message }`; hier sagt dieselbe Form, was nicht stimmt.
                return reply.code(400).send({ error: "invalid_request" });
            }
            const done = await guarded(reply, async () => {
                const ausgeblendet = await ausgeblendetVon();
                const stand = await ermittleKartenstand(database);
                const etag = etagVon(stand, ausgeblendet, anfrageHash(anfrage));
                if (etagMatches(request.headers["if-none-match"], etag)) {
                    void reply.header("cache-control", "public, no-cache").header("etag", etag);
                    return reply.code(304).send(null);
                }
                const antwort = await leuchte(database, anfrage, {
                    stand,
                    ...(ausgeblendet === undefined ? {} : { ausgeblendet }),
                });
                if (antwort === undefined) {
                    void reply.header("cache-control", "no-store");
                    return reply.code(404).send({ error: "not_found" });
                }
                void reply.header("cache-control", "public, no-cache").header("etag", etag);
                return antwort;
            });
            return "rejected" in done ? done.rejected : done.result;
        },
    );

    app.get(
        SEARCH_ZAHLEN_URL,
        {
            schema: {
                querystring: Type.Object({
                    /** Die Einträge (`lore_entry.public_id` mit Komma), höchstens `SEARCH_ZAHLEN_MAX`. */
                    ids: Type.String({ pattern: UUID_LISTE(SEARCH_ZAHLEN_MAX) }),
                }),
                response: { 200: SearchZahlen, 304: Type.Null(), 503: FehlerBody },
            },
        },
        async (request, reply) => {
            const database = app.database;
            if (!database) return reply.code(503).send({ error: "Datenbank nicht verbunden" });
            const ids = [...new Set(request.query.ids.split(","))];
            const done = await guarded(reply, async () => {
                const ausgeblendet = await ausgeblendetVon();
                const stand = await ermittleKartenstand(database);
                const etag = etagVon(stand, ausgeblendet, [...ids].sort().join(","));
                void reply.header("cache-control", "public, no-cache").header("etag", etag);
                if (etagMatches(request.headers["if-none-match"], etag)) return reply.code(304).send(null);
                const zahlen = await zaehle(database, ids, {
                    stand,
                    ...(ausgeblendet === undefined ? {} : { ausgeblendet }),
                });
                return { zahlen };
            });
            return "rejected" in done ? done.rejected : done.result;
        },
    );

    app.get(
        SEARCH_EINTRAG_URL,
        {
            schema: {
                querystring: Type.Object({ id: Type.String({ pattern: UUID_PATTERN }) }),
                response: { 200: SearchEintrag, 304: Type.Null(), 404: FehlerBody, 503: FehlerBody },
            },
        },
        async (request, reply) => {
            const database = app.database;
            if (!database) return reply.code(503).send({ error: "Datenbank nicht verbunden" });
            const id = request.query.id.toLowerCase();
            const done = await guarded(reply, async () => {
                const ausgeblendet = await ausgeblendetVon();
                const stand = await ermittleKartenstand(database);
                // Die Texte eines Eintrags (Lebensraum, Wiki-Adresse) ändern den Kartenstand nicht: Der Stempel des Index (Einträge, Regeln, Ortszeilen) kommt dazu, und seit WI-0260 der des Eintrags selbst
                // (Kurzbeschreibung, Quellen). 🪤 `eintrag2` statt `eintrag`: Die Antwort trägt neue Felder; ein 304 auf den ETag der alten darf sie nicht verbergen.
                const index = await vorkommenIndex(database);
                const etag = etagVon(
                    `${stand}|${index.stempel}`,
                    ausgeblendet,
                    `eintrag2|${id}|${await eintragStempel(database, id)}`,
                );
                if (etagMatches(request.headers["if-none-match"], etag)) {
                    void reply.header("cache-control", "public, no-cache").header("etag", etag);
                    return reply.code(304).send(null);
                }
                const antwort = await eintragFuerPanel(
                    database,
                    id,
                    ausgeblendet === undefined ? {} : { ausgeblendet },
                );
                if (antwort === undefined) {
                    void reply.header("cache-control", "no-store");
                    return reply.code(404).send({ error: "not_found" });
                }
                void reply.header("cache-control", "public, no-cache").header("etag", etag);
                return antwort;
            });
            return "rejected" in done ? done.rejected : done.result;
        },
    );

    app.get(
        SEARCH_BEISPIELE_URL,
        { schema: { response: { 200: SearchBeispiele, 503: FehlerBody } } },
        async (_request, reply) => {
            const database = app.database;
            if (!database) return reply.code(503).send({ error: "Datenbank nicht verbunden" });
            const done = await guarded(reply, async () => {
                const ausgeblendet = await ausgeblendetVon();
                const antwort = await beispiele(database, ausgeblendet === undefined ? {} : { ausgeblendet });
                // Die Beispiele wechseln mit dem Tag und ändern sich mit der Karte: kurz im Browser, dann wieder fragen.
                void reply.header("cache-control", "public, max-age=300");
                return antwort;
            });
            return "rejected" in done ? done.rejected : done.result;
        },
    );
};
