import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    loreSwitchKey,
    type InhalteVorkommenArt,
    ROUTE_STAGE_LORE_LIMITS,
    ROUTE_STAGE_LORE_URL,
    ROUTE_UNTERWEGS_GEGENDEN_URL,
    ROUTE_UNTERWEGS_LIMITS,
    ROUTE_UNTERWEGS_URL,
    RouteStageLoreRequest,
    RouteStageLoreResponse,
    RouteUnterwegsGegendenRequest,
    RouteUnterwegsGegendenResponse,
    RouteUnterwegsRequest,
    RouteUnterwegsResponse,
    FastifyErrorBody,
} from "@avesmaps3d/shared";
import { isStatementCancelled, withStatementTimeout } from "../database.ts";
import { eintragAnDerRoute } from "../search/eintrag.ts";
import { pausiereVorkommen } from "../subjects/pausiert.ts";
import { beruehrteFlaechen } from "../subjects/sections/unterwegs.ts";
import { UNTERWEGS_BUDGET_MS, UnterwegsZeitbudget } from "../subjects/service.ts";
import { istAus } from "../system/inhaltsstand.ts";

/**
 * `POST /api/route/stage/lore` (WI-0106): die Vorkommen einer ROUTENETAPPE - Waren, Fauna, Flora, Spezies - gesammelt aus allen
 * Flächen, die die Wegkette der Etappe berühren.
 *
 * 🔴 **Der Betreiber hat die Etappe selbst gemeint.** Am 2026-10-06 stand sie wörtlich in der Regel des Enthaltenseins
 * („dasselbe für wege, **routenetappen**, landschaften, politische regionen usw.“), am 2026-10-07 kam „kannst du die lore auch
 * in etappen anzeigen“. Gebaut ist die Etappe als Träger, nicht eine Aufzählung der Vorkommen ihrer einzelnen Wege.
 *
 * 🔴 **ER LIEST NUR, und er rechnet nichts selbst.** Die Rechnung macht der Subject-Dienst mit DERSELBEN Stelle wie ein Weg
 * (`SubjectService.stageLore` → `loreCarriersOf(…, "path", paths)`, WI-0103). Hier wird die Anfrage geprüft, gedrosselt und
 * die Antwort durchgereicht.
 *
 * ⭐ **POST wie `/api/route/landscapes`** (WI-0035): Geschrieben wird nichts, aber die Wege einer Etappe gehören in einen
 * Körper. Dazu `no-store`: Die Anfrage nennt Kennungen einer Reise, die es morgen nicht mehr gibt; den kurzen Cache hält der
 * Browser selbst unter (`revision`, Wege).
 *
 * 🔴 Kostenschranke nach demselben Muster: die Zahl der Wege im Schema (`ROUTE_STAGE_LORE_LIMITS.paths`, gemessen höchstens 13
 * je Etappe), ein Körperlimit, höchstens zwei Abfragen gleichzeitig (sonst 503 `busy` mit `Retry-After`), und PostgreSQL bricht
 * nach `SUBJECT_LIMITS.geometryStatementMs` ab.
 *
 * 🔴 **Die Inhaltsschalter je Art gelten auch hier** (WI-0127 SYS-10, `panel.lore.<art>`; WI-0257 S2 behebt den Mangel): Eine ausgeblendete
 * Art fehlt in `rows`, wie in der Antwort der freien Kartenstelle - kein ausgeblendeter Inhalt verlässt den Server. Die Antwort trägt
 * keine `pausedKinds` (die Etappe lebt im Planer, sie hat keinen Editor-Blick); fehlt die Zeile, steht sie nicht da.
 *
 * 🔴 **Die Regeln der Einträge sind seit WI-0257 S2 dabei** (`loreCarriersOf` fragt sie entlang der Wege): eine Anfrage je Etappe wie
 * bisher, die Punkte entlang der Linie als Bündel in einer Auswertung (`subjects/sections/lore.ts`, `PFAD_SCHRITT`).
 *
 * 🔴 **Seit WI-0257 S4 steht neben der Etappe die ganze Route** (`POST /api/route/unterwegs`, „Unterwegs gibt es:“ in den Routendetails): jede Etappe mit ihren Wegen und Linien in EINEM
 * Körper, die Antwort jeder Eintrag einmal mit den Nummern seiner Etappen und der Gegend. Sie rechnet je Etappe dieselben Bedingungen wie das Panel der Etappe, als Mengen über alle Etappen
 * (`SubjectService.unterwegs`, `subjects/sections/unterwegs.ts`: eine Transaktion, eine feste Zahl von Abfragen je Route), und teilt mit ihr die Zweierschranke (`schranke`) und den
 * Inhaltsschalter je Art. Eine lange Route rechnet gemessen rund 0,2 s; wer nicht mehr wartet, lässt die Rechnung trotzdem laufen (kein Abbruch, wie bei der Etappe): Die Schranke und das
 * Zeitbudget halten sie in Grenzen, und die Antwort liegt nicht im Zwischenspeicher.
 *
 * 🪤 **Kein Abbruch der Abfrage, wenn der Client geht - und das ist gemessen, nicht übersehen.** Die Landschaftsabfrage trägt
 * diese Behandlung, weil sie bis zu zwei Sekunden rechnet; eine Etappe braucht im Median 3 bis 5 ms und höchstens 62 ms (über
 * vier Reisen, 129 Etappen). Dafür eine subtile Rezeptur abzuschreiben, die ohne eigenen Prüffall verrottet, wäre teurer als
 * der Platz in der Zweiergrenze, den sie freigibt. 🔴 **Der Browser bricht trotzdem ab** (`AbortSignal`, `AGENTS.md`
 * „Beim Ziehen wird nicht nachgeschlagen“, Punkt 3): Eine jüngere Etappe lässt die Antwort auf die ältere fallen.
 */

/** Fastifys eigene Antwort auf eine ungültige Anfrage; ohne sie im Schema würde aus dem 400 ein 500. */
const ValidationError = FastifyErrorBody;
const StageLoreError = Type.Object({
    error: Type.Union([Type.Literal("busy"), Type.Literal("database_unavailable")]),
});

/**
 * Die laufenden Abfragen dieses Prozesses (Semaphor), wie bei den Landschaften der Route: Etappe, Unterwegs, Gegenden und das Unterwegs, das mit den Landschaften der Route
 * mitfährt (`routes/landscapes.ts`, WI-0292). 🪤 Je Prozess, nicht je Anmeldung des Plugins: Die Landschaften liegen in einem anderen Plugin und teilen dieselbe Schranke.
 */
const schranke = { laufend: 0 };

/**
 * Die Vorkommen der ganzen Route (`POST /api/route/unterwegs`), auch für die Frage nach den Landschaften, die sie mitbringt (WI-0292). `busy`, wenn die Zweierschranke voll ist;
 * `database_unavailable` ohne Dienst oder nach dem Zeitbudget (lieber nichts als eine halbe Liste).
 */
export async function rechneUnterwegs(
    app: Pick<FastifyInstance, "subjects" | "inhaltsschalter">,
    stages: RouteUnterwegsRequest["stages"],
): Promise<RouteUnterwegsResponse | "busy" | "database_unavailable"> {
    const subjects = app.subjects;
    if (!subjects) return "database_unavailable";
    if (schranke.laufend >= ROUTE_STAGE_LORE_LIMITS.concurrent) return "busy";
    schranke.laufend += 1;
    try {
        const route = await subjects.unterwegs(stages).catch((error: unknown) => {
            if (error instanceof UnterwegsZeitbudget) return undefined;
            throw error;
        });
        if (route === undefined) return "database_unavailable";
        // Der Stand der Schalter wird nach der Rechnung gelesen (wie bei der Etappe); eine ausgeblendete Art fehlt, kein ausgeblendeter Inhalt verlässt den Server.
        const store = app.inhaltsschalter;
        if (store === undefined) return route;
        const stand = await store.read();
        const eintraege = route.eintraege.filter((entry) => !istAus(stand, loreSwitchKey(entry.kind)));
        return eintraege.length === route.eintraege.length ? route : { ...route, eintraege };
    } finally {
        schranke.laufend -= 1;
    }
}

export const stageLoreRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        ROUTE_STAGE_LORE_URL,
        {
            config: { writeClass: "public" },
            bodyLimit: ROUTE_STAGE_LORE_LIMITS.bodyBytes,
            schema: {
                body: RouteStageLoreRequest,
                response: {
                    200: RouteStageLoreResponse,
                    400: ValidationError,
                    // Zwei Absender: das Schema (wir) und ein zu großer Körper (Fastify, vor dem Lesen).
                    413: ValidationError,
                    503: StageLoreError,
                },
            },
            onRequest: async (_request, reply) => {
                void reply.header("cache-control", "no-store");
            },
        },
        async (request, reply) => {
            const subjects = app.subjects;
            if (!subjects) return reply.code(503).send({ error: "database_unavailable" });
            if (schranke.laufend >= ROUTE_STAGE_LORE_LIMITS.concurrent) {
                void reply.header("Retry-After", "1");
                return reply.code(503).send({ error: "busy" });
            }
            schranke.laufend += 1;
            try {
                // 🪤 Kein `toLowerCase` wie in `routes/route.ts`: Dort ist die Kennung freier Text aus der Adresszeile, hier
                // verlangt `UUID_PATTERN` die Kleinschreibung schon im Schema - eine zweite Normalisierung wäre eine zweite Regel.
                const stage = await subjects.stageLore(request.body.paths, request.body.lines);
                // Der Stand der Schalter; ohne Store (keine Datenbank) gilt keiner. Gelesen wird erst nach der Rechnung, damit ein
                // Wechsel während der Abfrage nicht hinter ihr liegt.
                const store = app.inhaltsschalter;
                if (store === undefined) return stage;
                const stand = await store.read();
                const { rows } = pausiereVorkommen(stage.rows, (key) => istAus(stand, key));
                return rows.length === stage.rows.length ? stage : { ...stage, rows };
            } finally {
                schranke.laufend -= 1;
            }
        },
    );

    app.post(
        ROUTE_UNTERWEGS_URL,
        {
            config: { writeClass: "public" },
            bodyLimit: ROUTE_UNTERWEGS_LIMITS.bodyBytes,
            schema: {
                body: RouteUnterwegsRequest,
                response: {
                    200: RouteUnterwegsResponse,
                    400: ValidationError,
                    413: ValidationError,
                    503: StageLoreError,
                },
            },
            onRequest: async (_request, reply) => {
                void reply.header("cache-control", "no-store");
            },
        },
        async (request, reply) => {
            const antwort = await rechneUnterwegs(app, request.body.stages);
            if (antwort === "busy") {
                void reply.header("Retry-After", "1");
                return reply.code(503).send({ error: "busy" });
            }
            // Das Zeitbudget der ganzen Route ist aufgebraucht: lieber nichts als eine halbe Liste; die Oberfläche lässt die Box dann weg.
            if (antwort === "database_unavailable") return reply.code(503).send({ error: "database_unavailable" });
            return antwort;
        },
    );

    /**
     * Die Gegenden EINES gewählten Vorkommens, die die Route kreuzt (WI-0257 S5, Vali 2026-10-31): die Flächen, die eine Linie der Route berührt (`beruehrteFlaechen`, dieselbe Lage wie die
     * Liste), geschnitten mit dem Leuchten des Eintrags (`eintragAnDerRoute`). Eine Transaktion ohne JIT im Budget der Liste, dieselbe Zweierschranke; eine ausgeblendete Art ist 404.
     */
    app.post(
        ROUTE_UNTERWEGS_GEGENDEN_URL,
        {
            config: { writeClass: "public" },
            bodyLimit: ROUTE_UNTERWEGS_LIMITS.bodyBytes,
            schema: {
                body: RouteUnterwegsGegendenRequest,
                response: {
                    200: RouteUnterwegsGegendenResponse,
                    400: ValidationError,
                    404: Type.Object({ error: Type.Literal("not_found") }),
                    413: ValidationError,
                    503: StageLoreError,
                },
            },
            onRequest: async (_request, reply) => {
                void reply.header("cache-control", "no-store");
            },
        },
        async (request, reply) => {
            const database = app.database;
            if (!database) return reply.code(503).send({ error: "database_unavailable" });
            if (schranke.laufend >= ROUTE_STAGE_LORE_LIMITS.concurrent) {
                void reply.header("Retry-After", "1");
                return reply.code(503).send({ error: "busy" });
            }
            schranke.laufend += 1;
            try {
                const store = app.inhaltsschalter;
                const stand = store === undefined ? undefined : await store.read();
                const ausgeblendet =
                    stand === undefined ? undefined : (art: InhalteVorkommenArt) => istAus(stand, loreSwitchKey(art));
                const antwort = await withStatementTimeout(
                    database,
                    UNTERWEGS_BUDGET_MS,
                    async (transaction) =>
                        eintragAnDerRoute(
                            transaction,
                            request.body.eintrag,
                            await beruehrteFlaechen(transaction, request.body.stages),
                            ausgeblendet === undefined ? {} : { ausgeblendet },
                        ),
                    { jitOff: true },
                ).catch((error: unknown) => {
                    if (isStatementCancelled(error)) throw new UnterwegsZeitbudget();
                    throw error;
                });
                if (antwort === undefined) return reply.code(404).send({ error: "not_found" });
                return antwort;
            } catch (error) {
                if (error instanceof UnterwegsZeitbudget)
                    return reply.code(503).send({ error: "database_unavailable" });
                throw error;
            } finally {
                schranke.laufend -= 1;
            }
        },
    );
};
