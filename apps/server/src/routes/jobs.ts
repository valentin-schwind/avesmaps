import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import type { FastifyRequest } from "fastify";
import {
    ABGLEICH_QUELLEN,
    AVENTURIA,
    ApiErrorBody,
    EventsResponse,
    JOB_STATES,
    JobsList,
    JobsOverview,
    OperationsStatus,
    RepoOverview,
    getJobsConfig,
    type AbgleichAusfuehrungen,
    type JobsConfig,
    type JobState,
} from "@avesmaps3d/shared";
import { ausfuehrungFuer, pickupJobKinds } from "../abgleiche/ausfuehrung.ts";
import { statusViewOf, type StatusView } from "../auth/status-view.ts";
import { ApiError } from "../http/api-error.ts";
import type { MemoryProbe } from "../jobs/memory.ts";
import { ownSummary, wakeupOf } from "../jobs/own-view.ts";
import { buildOperationsStatus } from "../jobs/operations.ts";
import { buildJobsOverview, planerAktiv } from "../jobs/overview.ts";
import { standJetzt } from "../jobs/stand-datei.ts";
import { leseWarteumstand, umstandMitStand } from "../jobs/wartegrund.ts";
import { jobsProfileName } from "../jobs/profile.ts";
import { buildRepoOverview, findRepoRoot, localDate, unavailableRepoOverview } from "../jobs/repo-overview.ts";
import { toSummary } from "../jobs/rows.ts";
import { latestSeq, listFinished, listQueued, listRunning, oldestSeq, readEvents } from "../jobs/store.ts";

/**
 * Die Statusseite lesend (JOBS-0001 5.4, Etappe 1): `GET /api/jobs/overview`, `/api/jobs`, `/api/events`, `/api/status/operations`
 * und `/api/status/overview`.
 *
 * 🔴 NUR LESEND. Fastify schreibt nie in die Queue (keine Hintergrundjobs im Fastify-Prozess, Rollout-Antwort Frage 6): Eingereiht
 * wird in Etappe 3 über `job_enqueue` im Schreibpfad des Editors, gearbeitet wird im Worker, aufgezeichnet vom Korridor.
 *
 * 🔴 DIE QUEUE IST NICHT ÖFFENTLICH (WI-0120 A11, JOBS-0001 D1 A): `view_operations` sieht alles, `view_own_jobs` nur die eigenen Jobs
 * samt Position und Wartezeit, ohne Speicher und Befunde; ohne Anmeldung 401, ohne eines der Rechte 403 (`auth/status-view.ts`). Wo
 * keine Anmeldung eingerichtet ist oder die Übergangsansicht gilt (lokal), sieht man ohne Anmeldung alles wie vor WI-0120. Auf der
 * Production bleibt die Statusseite aus (`STATUS_PAGE=off`). Aus: 404 `status_disabled`.
 *
 *     GET /api/jobs/overview          läuft, wartet (Position, Grund, geschätzte Zeit), fertig, gescheitert, hängt, Speicher; mit `seq`
 *     GET /api/jobs?state=…           Jobs eines Zustands (Standard: die aktiven)
 *     GET /api/events?since=<seq>     Ereignisse ab einer Nummer; `gap`, wenn sie schon aufgeräumt sind
 *     GET /api/status/operations      Reiter Betrieb: Health, Release, Migration, Zeiger, Legacy-Satz, letzte Imports
 *     GET /api/status/overview        Reiter Überblick: nur lokal aus dem Repository, mit Datei und Zeile als Beleg
 *
 * Mit dem Stand der gemeinsamen Warteschlange (WI-0163, `QUEUE_STAND_FILE`) tragen Übersicht und Liste die Gründe und Plätze des
 * Dirigenten und die wirksame Pause über alle Umgebungen; die Übersicht dazu die gemeinsame Reihe (`gemeinsam`), die Aufträge der
 * anderen Umgebung ohne Kennung, mit ihrem Auslöser (WI-0293).
 */

export interface JobsRoutesOptions {
    /** Für Tests: eine eigene Messung des Rechners. */
    memory?: MemoryProbe;
    /** Für Tests: ein Repository (oder `null`: keines). Sonst nur lokal (`RELEASE_ID=dev`) das, in dem dieser Server liegt. */
    repoRoot?: string | null;
    /** Für Tests: ein eigener Schlüssel der Planersperre. */
    plannerScope?: string;
    /** Für Tests: ein fester Zeitpunkt. */
    now?: () => Date;
    /** Für Tests: ein eigenes Profil. */
    config?: JobsConfig;
}

/**
 * Die Fehlerform der Routen mit Datenbank: `{ error: { code, message } }` ohne Verbindung, dazu die Form des Fehlerhandlers
 * (`{ error: "database_unavailable" }`, `route-error-shapes.test.ts`): ohne sie wäre eine Antwort des Handlers ein 500.
 */
const UnavailableBody = Type.Union([
    Type.Object({ error: Type.Object({ code: Type.String(), message: Type.String() }) }),
    Type.Object({ error: Type.Literal("database_unavailable") }),
]);

/** Die Antworten jeder Route hier: 401 und 403 aus dem Einlass, 503 ohne Datenbank. */
const REFUSALS = { 401: ApiErrorBody, 403: ApiErrorBody, 503: UnavailableBody };

const ListQuery = Type.Object({
    state: Type.Optional(Type.Union(JOB_STATES.map((state) => Type.Literal(state)))),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

/**
 * `?eigene=true`: nur die eigenen Aufträge, auch in der vollen Sicht (WI-0230, die Warteschlange im Kopf). Positionen und Schätzungen bleiben
 * über die ganze Warteschlange gerechnet; ohne Person (lokal ohne Anmeldung) gilt die Sicht wie ohne den Schalter.
 */
const OverviewQuery = Type.Object({ eigene: Type.Optional(Type.Boolean()) });

const EventsQuery = Type.Object({
    since: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
});

/** Wie lange der Überblick aus dem Repository zwischengespeichert wird: Er liest hunderte Dateien. */
const REPO_CACHE_MS = 10_000;

export const jobsRoutes: FastifyPluginAsyncTypebox<JobsRoutesOptions> = async (app, options) => {
    const disabled = { error: { code: "status_disabled", message: "Die Statusseite ist auf dieser Instanz aus." } };
    const unavailable = { error: { code: "database_unavailable", message: "Datenbank nicht verbunden." } };
    const config = options.config ?? getJobsConfig(app.config.jobsProfile ?? jobsProfileName(process.env));
    const mapDomainId = AVENTURIA.mapDomain;
    const now = options.now ?? (() => new Date());
    const enabled = app.config.statusPage !== false;
    /**
     * Die Jobarten, die Claudios Abholer übernimmt (WI-0160): Ohne sie kann die Seite nicht sagen, dass eine Zeile auf die Abholung
     * wartet. Dieselbe Quelle wie beim Worker (`worker-cli.ts`), damit beide dieselbe Liste führen.
     */
    const pickupKinds = pickupJobKinds(
        Object.fromEntries(
            ABGLEICH_QUELLEN.map((quelle) => [quelle, ausfuehrungFuer(app.config.abgleiche, quelle)]),
        ) as AbgleichAusfuehrungen,
    );

    // D2 A: der Repo-Teil nur lokal. Auf der Stage gibt es das Repository nicht (und der Release trägt eine Kennung statt `dev`).
    const repoRoot =
        options.repoRoot !== undefined
            ? options.repoRoot
            : app.config.releaseId === "dev"
              ? findRepoRoot(dirname(fileURLToPath(import.meta.url)))
              : null;
    let repoCache: { at: number; value: RepoOverview } | undefined;

    // Kein Cache: der Stand enthält Messwerte, die sich ständig ändern (deshalb auch kein ETag).
    app.addHook("onRequest", async (_request, reply) => {
        void reply.header("cache-control", "no-store");
        if (!enabled) return reply.code(404).send(disabled);
        return undefined;
    });

    // Wer was sieht, einmal je Anfrage und vor der Schemaprüfung (wer nicht darf, erfährt nichts über die Form der Anfrage).
    const views = new WeakMap<FastifyRequest, StatusView>();
    app.addHook("preValidation", async (request) => {
        const verdict = statusViewOf(await request.auth.session(), app.authConfig);
        if (verdict === 401)
            throw new ApiError(401, "unauthenticated", "Für die Statusseite ist eine Anmeldung nötig.");
        if (verdict === 403)
            throw new ApiError(403, "forbidden", "Die Statusseite sehen Editoren, Admins und Betreiber.");
        views.set(request, verdict);
    });
    const viewOf = (request: FastifyRequest): StatusView => views.get(request) ?? { view: "all", personId: null };
    const owner = (request: FastifyRequest): string | undefined => {
        const view = viewOf(request);
        return view.view === "own" ? view.personId : undefined;
    };
    /** Betrieb und Überblick nur mit der vollen Sicht; einem Admin ohne zweiten Faktor sagt die Antwort, was fehlt. */
    const requireAll = (request: FastifyRequest): void => {
        const view = viewOf(request);
        if (view.view === "all") return;
        if (view.needs === "second_factor")
            throw new ApiError(403, "assurance_required", "Dafür ist eine Anmeldung mit zweitem Faktor nötig.", {
                need: "second_factor",
            });
        throw new ApiError(403, "forbidden", "Betrieb und Überblick sehen Admins und Betreiber.");
    };
    const ownJobs = { config: { auth: { capability: "view_own_jobs" as const } } };
    const operations = { config: { auth: { capability: "view_operations" as const } } };

    app.get(
        "/api/jobs/overview",
        { ...ownJobs, schema: { querystring: OverviewQuery, response: { 200: JobsOverview, ...REFUSALS } } },
        async (request, reply) => {
            const database = app.database;
            if (!database) return reply.code(503).send(unavailable);
            const person = request.query.eigene === true ? (viewOf(request).personId ?? undefined) : owner(request);
            return buildJobsOverview({
                ...(person === undefined ? {} : { owner: person }),
                database,
                config,
                releaseId: app.config.releaseId,
                mapDomainId,
                now,
                pickupKinds,
                stand: await standJetzt(app.warteschlangeStand, now()),
                ...(options.memory ? { memory: options.memory } : {}),
                ...(options.plannerScope ? { plannerScope: options.plannerScope } : {}),
            });
        },
    );

    app.get(
        "/api/jobs",
        { ...ownJobs, schema: { querystring: ListQuery, response: { 200: JobsList, ...REFUSALS } } },
        async (request, reply) => {
            const database = app.database;
            if (!database) return reply.code(503).send(unavailable);
            const at = now();
            const limit = request.query.limit ?? 50;
            const state: JobState | undefined = request.query.state;
            let rows;
            const person = owner(request);
            if (state === "QUEUED") rows = await listQueued(database);
            else if (state === "RUNNING") rows = await listRunning(database);
            else if (state !== undefined) rows = await listFinished(database, [state], limit, person);
            else rows = [...(await listRunning(database)), ...(await listQueued(database))];
            // Dieselbe Ableitung wie in der Übersicht (WI-0160): eine wartende Zeile nennt hier denselben Grund, mit dem Stand des
            // Dirigenten dessen Grund (WI-0163).
            const stand = await standJetzt(app.warteschlangeStand, at);
            const umstand = umstandMitStand(
                await leseWarteumstand(database, {
                    plannerActive: await planerAktiv(database, mapDomainId, stand, options.plannerScope),
                    pickupKinds,
                }),
                stand.lage,
                stand.umgebung,
            );
            if (person === undefined) return { jobs: rows.slice(0, limit).map((row) => toSummary(row, at, umstand)) };
            const own = rows.filter((row) => row.actorRef === person).slice(0, limit);
            return { jobs: own.map((row) => ownSummary(toSummary(row, at, umstand))) };
        },
    );

    app.get(
        "/api/events",
        { ...ownJobs, schema: { querystring: EventsQuery, response: { 200: EventsResponse, ...REFUSALS } } },
        async (request, reply) => {
            const database = app.database;
            if (!database) return reply.code(503).send(unavailable);
            const since = request.query.since ?? 0;
            const [latest, oldest] = await Promise.all([latestSeq(database), oldestSeq(database)]);
            // Sind die gewünschten Ereignisse schon aufgeräumt, holt der Client den Stand neu und vergleicht Zeiger.
            // `since=0` heißt „alles, was da ist“, nie „verpasst“.
            const gap = since > 0 && since < latest && since + 1 < oldest;
            const events = gap ? [] : await readEvents(database, since, request.query.limit ?? 200);
            // Die eigene Sicht bekommt nur den Weckruf; das Neuladen des Überblicks filtert.
            return { events: owner(request) === undefined ? events : events.map(wakeupOf), latestSeq: latest, gap };
        },
    );

    app.get(
        "/api/status/operations",
        { ...operations, schema: { response: { 200: OperationsStatus, ...REFUSALS } } },
        async (request, reply) => {
            requireAll(request);
            const database = app.database;
            if (!database) return reply.code(503).send(unavailable);
            return buildOperationsStatus({ database, config, releaseId: app.config.releaseId, mapDomainId, now });
        },
    );

    app.get(
        "/api/status/overview",
        { ...operations, schema: { response: { 200: RepoOverview, 401: ApiErrorBody, 403: ApiErrorBody } } },
        async (request) => {
            requireAll(request);
            const at = now();
            if (repoRoot === null) return unavailableRepoOverview(at.toISOString(), localDate(at), "not_local");
            if (repoCache && at.getTime() - repoCache.at < REPO_CACHE_MS) return repoCache.value;
            const value = await buildRepoOverview({ root: repoRoot, now: at });
            repoCache = { at: at.getTime(), value };
            return value;
        },
    );
};
