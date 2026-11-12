import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type ServerConfig } from "./config.ts";
import { createDatabase, SERVER_TIMEOUTS, type Database } from "./database.ts";
import type { ChangeWatchOptions } from "./auth/change-watch.ts";
import { createDiscordClient, type DiscordClient } from "./auth/discord-client.ts";
import { createGate, type Gate, type GateCache } from "./auth/gate.ts";
import { registerAuth } from "./auth/plugin.ts";
import { registerErrorHandler } from "./error-handler.ts";
import { finiteValidatorFactory } from "./finite-validator.ts";
import { requestLogValue } from "./log-address.ts";
import { beobachteLebendenHeap } from "./routing/heap-lebend.ts";
import { createWorkerRunner, type RouteRunner } from "./routing/runner.ts";
import { databaseWaypointIndex, type WaypointIndex } from "./routing/waypoints.ts";
import { healthRoutes } from "./routes/health.ts";
import { jobsRoutes, type JobsRoutesOptions } from "./routes/jobs.ts";
import { realtimeRoutes, type RealtimeRoutesOptions } from "./routes/realtime.ts";
import { areaRoutes } from "./routes/areas.ts";
import { authRoutes } from "./routes/auth.ts";
import { authPasswordRoutes } from "./routes/auth-password.ts";
import { authDiscordRoutes } from "./routes/auth-discord.ts";
import { discordInteraktionenRoutes } from "./routes/discord-interaktionen.ts";
import { authPasskeyRoutes } from "./routes/auth-passkey.ts";
import { authInvitationRoutes } from "./routes/auth-invitation.ts";
import { abzugHolenRoutes } from "./routes/abzug-holen.ts";
import { adminRoutes } from "./routes/admin.ts";
import { internSonderrollenRoutes } from "./routes/intern-sonderrollen.ts";
import { createSonderrollenAbgleich, type SonderrollenAbgleicher } from "./auth/sonderrollen-abgleich.ts";
import { gegenseiteAdresse } from "./system/gegenseite.ts";
import { benachrichtigungRoutes } from "./routes/benachrichtigungen.ts";
import { kurzinfoRoutes } from "./routes/versionen.ts";
import { contentStateRoutes } from "./routes/admin-inhalte.ts";
import { mapSettingsRoutes } from "./routes/admin-karteneinstellungen.ts";
import { mapSeriesRoutes } from "./routes/map-series.ts";
import { zoomBandsRoutes } from "./routes/admin-zoombaender.ts";
import { wetterRoutes } from "./routes/wetter.ts";
import { newsPublicRoutes } from "./routes/news.ts";
import { accountRoutes } from "./routes/account.ts";
import { landscapeRoutes } from "./routes/landscapes.ts";
import { mediaRoutes } from "./routes/media.ts";
import { mediaEditorRoutes } from "./routes/media-editor.ts";
import { editorLandscapesRoutes } from "./routes/editor-landscapes.ts";
import { editorGebirgeRoutes } from "./routes/editor-gebirge.ts";
import { editorTerritoriesRoutes } from "./routes/editor-territories.ts";
import { editorInhalteRoutes } from "./routes/editor-inhalte.ts";
import { editorKraftlinienRoutes } from "./routes/editor-kraftlinien.ts";
import { editorLocksRoutes } from "./routes/editor-locks.ts";
import { editorSprachenRoutes } from "./routes/editor-sprachen.ts";
import { editorPathsRoutes } from "./routes/editor-paths.ts";
import { editorPlacesRoutes } from "./routes/editor-places.ts";
import { editorWikiBoxRoutes } from "./routes/editor-wiki-box.ts";
import { editorStatusRoutes } from "./routes/editor-status.ts";
import { mapCheckRoutes } from "./routes/map-checks.ts";
import { powerlineRoutes } from "./routes/powerlines.ts";
import { routeRoutes } from "./routes/route.ts";
import { searchRoutes } from "./routes/search.ts";
import { shareRoutes } from "./routes/share.ts";
import { besuchRoutes } from "./routes/besuch.ts";
import { bewertungenRoutes } from "./routes/bewertungen.ts";
import { communityRoutes } from "./routes/community.ts";
import { photoboxRoutes } from "./routes/photobox.ts";
import { entwicklerApiRoutes } from "./routes/entwickler-api.ts";
import { karteExportRoutes } from "./routes/karten-export.ts";
import { kartenvorschlagRoutes } from "./routes/kartenvorschlag.ts";
import { reisebilderRoutes } from "./routes/reisebilder.ts";
import { communityBrueckeRoutes } from "./routes/community-bruecke.ts";
import { registriereHerkunft } from "./community/herkunft.ts";
import { socialRoutes } from "./routes/social.ts";
import { messwerteRoutes } from "./routes/messwerte.ts";
import { spracheRoutes } from "./routes/sprachen.ts";
import { stageLoreRoutes } from "./routes/stage-lore.ts";
import { subjectRoutes } from "./routes/subjects.ts";
import { terrainTileRoutes } from "./routes/terrain-tiles.ts";
import { displayHeightRoutes } from "./routes/display-height.ts";
import { territoryRoutes } from "./routes/territories.ts";
import { tileRevisionRoutes } from "./routes/tile-revisions.ts";
import { typeImageRoutes } from "./routes/type-images.ts";
import { tileRoutes } from "./routes/tiles.ts";
import { createShareService, type ShareService } from "./share/share-service.ts";
import { databaseShareStore } from "./share/share-store.ts";
import { createSubjectService, type SubjectService } from "./subjects/service.ts";
import { SystemStateStore } from "./system/state-store.ts";
import { InhaltsschalterStore } from "./system/inhaltsschalter.ts";
import { createStichprobe, type Stichprobe } from "./system/stichprobe.ts";
import { createHaengtMelder } from "./jobs/haengt-melder.ts";
import { createBesucherTakt } from "./besucher/takt.ts";
import { zaehleSchnittstellen } from "./besucher/api-zaehler.ts";
import { WorkerLebenszeichen } from "./jobs/lebenszeichen.ts";
import { createWarteschlangeStandLeser, type WarteschlangeStandLeser } from "./jobs/stand-datei.ts";
import { registerFeaturePause } from "./system/feature-pause.ts";
import { registerRestrictedMode } from "./system/restricted-mode.ts";
import { registerWriteGuard } from "./system/write-guard.ts";

declare module "fastify" {
    interface FastifyInstance {
        /** Nur auf der Stage, wenn der Weg von Production eingerichtet ist (WI-0279 E9); dann liest der Reiter nur. */
        sonderrollenAbgleich: SonderrollenAbgleicher | undefined;
        config: ServerConfig;
        database: Database | undefined;
        /** Die Route; ohne Datenbank gibt es keine. (`routing` ist in Fastify vergeben.) */
        routeRunner: RouteRunner | undefined;
        /** Die Wegpunktsuche des Routenplaners; ohne Datenbank gibt es keine. */
        waypointIndex: WaypointIndex | undefined;
        /** Die Kurzlinks (WI-0034); ohne Datenbank gibt es keine. */
        shareService: ShareService | undefined;
        /** Die Subjects des Infopanels (WI-0063 P4): Detail, Kartenpunkt, Objektlinks; ohne Datenbank gibt es keine. */
        subjects: SubjectService | undefined;
        /** Der Betriebszustand im Speicher dieser Instanz (WI-0127 SYS-2); ohne Datenbank gibt es keinen, und er gilt als unbekannt. */
        systemState: SystemStateStore | undefined;
        /** Die Tür (WI-0120 R6, WI-0127 SYS-3): `GET /api/auth/gate` und der eingeschränkte Betrieb der Anwendung fragen sie. */
        gate: Gate;
        /** Die Inhaltsschalter dieser Instanz (WI-0127 SYS-10); nachgelesen, sobald sich die Inhaltsrevision ändert. Ohne Datenbank keine. */
        inhaltsschalter: InhaltsschalterStore | undefined;
        /** Das Lebenszeichen des Jobs-Workers mit seinem Speicher (WI-0127 §22); ohne Datenbank keines. */
        jobLebenszeichen: WorkerLebenszeichen | undefined;
        /**
         * Der Stand der gemeinsamen Warteschlange (WI-0163, `QUEUE_STAND_FILE`): ein Leser je Instanz mit kurzem Zwischenspeicher.
         * Ohne die Variable ist er nicht eingerichtet, und alles gilt wie bis WI-0163.
         */
        warteschlangeStand: WarteschlangeStandLeser;
    }
}

/** So lange wartet der Start höchstens auf das erste Lesen des Betriebszustands. */
const SYSTEM_START_WAIT_MS = 3_000;

export interface BuildAppOptions {
    config?: ServerConfig;
    database?: Database;
    /** Für Tests: eine eigene Steuerung statt des Routing-Workers. */
    routeRunner?: RouteRunner;
    /** Für Tests: eine eigene Wegpunktsuche statt der Datenbank. */
    waypointIndex?: WaypointIndex;
    /** Für Tests: ein Kurzlink-Dienst mit eigenem Codegeber, eigener Drossel oder eigenem Budget. */
    shareService?: ShareService;
    /** Für Tests: ein Subject-Dienst mit eigenem Speicherindex. */
    subjects?: SubjectService;
    /** Für Tests: die Statusseite der Queue (WI-0074): eigene Messung, eigenes Repository, eigene Takte von `/ws`. */
    jobs?: JobsRoutesOptions & RealtimeRoutesOptions;
    /** Für Tests: ein Ersatz für Discord (Code tauschen, Benutzer lesen, widerrufen), WI-0120 A5. */
    discordClient?: DiscordClient;
    /** Nur Tests: wie die Stage Production fragt (WI-0279 E9). */
    sonderrollenAbrufen?: typeof fetch;
    /** Für Tests: der Speicher der Tür mit eigener Uhr (WI-0120 R6). */
    gateCache?: GateCache;
    /** Für Tests: der Takt, in dem der Wächter der Tür prüft, ob `LISTEN` noch hört (WI-0127 SYS-3). */
    gateWatch?: ChangeWatchOptions;
    /** Für Tests: ein Speicher des Betriebszustands mit eigener Uhr und eigenen Takten (WI-0127 SYS-2). */
    systemState?: SystemStateStore;
    /** Für Tests: eine eigene Stichprobe des Systemzustands (SYS-8), etwa eine, die nichts schreibt. */
    stichprobe?: Stichprobe;
    /** Für Tests: ein Empfang des Lebenszeichens, dem der Test selbst Meldungen gibt. */
    jobLebenszeichen?: WorkerLebenszeichen;
    /** Für Tests: ein Leser des Stands der gemeinsamen Warteschlange mit eigener Uhr. */
    warteschlangeStand?: WarteschlangeStandLeser;
    /** Für Tests: wohin das Protokoll geht, statt nach stdout. */
    logStream?: { write(line: string): void };
}

/**
 * Builds the application without listening, so tests and the entry point share one wiring
 * (route adapter -> validation -> domain logic, chapter 4.6).
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
    const config = options.config ?? loadConfig();
    const app = Fastify({
        // 🔴 Nur dem Proxy auf derselben Maschine trauen (Nginx, Vite): `request.ip` ist dann der Client,
        // und der linke, fälschbare Eintrag in `X-Forwarded-For` zählt nie. Nie `true` (WI-0034, Claudio).
        trustProxy: "loopback",
        // G4-02: ±Infinity aus "Infinity"/"1e400" besteht jede Zahlengrenze; der Prüfer lehnt es zentral ab (`finite-validator.ts`).
        schemaController: { compilersFactory: { buildValidator: finiteValidatorFactory() } },
        logger: {
            level: process.env["LOG_LEVEL"] ?? "info",
            // Structured logs with correlation ids (chapter 10.94, 10.96).
            redact: ["req.headers.authorization", "req.headers.cookie"],
            // Fastifys eigene Anfragezeile, nur mit gekürzter Adresse (WI-0085, `log-address.ts`).
            serializers: { req: requestLogValue },
            ...(options.logStream ? { stream: options.logStream } : {}),
        },
    });

    const database =
        options.database ??
        (config.databaseUrl ? createDatabase(config.databaseUrl, { timeouts: SERVER_TIMEOUTS }) : undefined);

    // Der lebende Heap des Hauptthreads für die Zeile zum Wechsel des Stands (WI-0298, Stufe 4).
    const lebenderHeap = options.routeRunner === undefined && config.databaseUrl ? beobachteLebendenHeap() : undefined;
    // Der Worker startet erst mit der ersten Route (oder mit warm()), nicht mit der App.
    const routeRunner =
        options.routeRunner ??
        (config.databaseUrl
            ? createWorkerRunner({
                  databaseUrl: config.databaseUrl,
                  onError: (error) => app.log.error({ err: error }, "routing worker"),
                  // Zum Wechsel des Stands den Speicher des Hauptthreads (WI-0298); `routing graph loaded` des Workers nennt nur dessen Heap.
                  onLoaded: (revision) => {
                      const speicher = process.memoryUsage();
                      const mib = (bytes: number): number => Math.round(bytes / 1048576);
                      app.log.info(
                          {
                              revision,
                              rss_mb: mib(speicher.rss),
                              heap_used_mb: mib(speicher.heapUsed),
                              heap_total_mb: mib(speicher.heapTotal),
                              external_mb: mib(speicher.external),
                              heap_live_mb: lebenderHeap?.mib() ?? null,
                          },
                          "server memory at routing reload",
                      );
                  },
              })
            : undefined);

    app.decorate("config", config);
    app.decorate("database", database);
    app.decorate("routeRunner", routeRunner);
    app.decorate("waypointIndex", options.waypointIndex ?? (database ? databaseWaypointIndex(database) : undefined));
    app.decorate(
        "shareService",
        options.shareService ?? (database ? createShareService(databaseShareStore(database)) : undefined),
    );
    app.decorate("subjects", options.subjects ?? (database ? createSubjectService(database) : undefined));
    const systemState =
        options.systemState ?? (database ? new SystemStateStore({ database, log: app.log }) : undefined);
    app.decorate("systemState", systemState);
    app.decorate(
        "inhaltsschalter",
        database
            ? new InhaltsschalterStore({
                  database,
                  revision: () => systemState?.snapshot().contentRevision ?? null,
                  warn: (message) => app.log.warn(message),
              })
            : undefined,
    );
    app.decorate(
        "warteschlangeStand",
        options.warteschlangeStand ??
            createWarteschlangeStandLeser(
                config.warteschlange?.standFile,
                config.warteschlange?.umgebung ?? config.auth?.environment ?? "development",
                { warn: (message) => app.log.warn(message) },
            ),
    );
    const discord = config.auth?.discord;
    app.decorate("discordClient", options.discordClient ?? (discord ? createDiscordClient(discord) : undefined));

    // Der Betriebszustand ist bekannt, bevor die erste Anfrage kommt; eine tote Datenbank hält den Start höchstens kurz auf, der
    // Zustand bleibt dann `unknown`, bis der Takt ihn liest (SYS-0001 §3.2).
    app.addHook("onReady", async () => {
        if (systemState === undefined) return;
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
            systemState.start(),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, SYSTEM_START_WAIT_MS);
            }),
        ]);
        clearTimeout(timer);
    });

    // Die Stichprobe des Systemzustands (WI-0127 SYS-8): alle 5 min eine Zeile in `system_sample` je Umgebung, für den Verlauf über 24 h.
    const stichprobe = options.stichprobe ?? (database ? createStichprobe({ database, log: app.log }) : undefined);
    app.addHook("onReady", async () => stichprobe?.start());

    // Hängende Aufträge der gemeinsamen Warteschlange (WI-0179): Der Dirigent führt sie im Stand, die App meldet die ihrer Umgebung
    // einmal in die Glocke der Betreiber. Nur mit Datenbank, Stand-Datei und Anmeldung (ohne sie gibt es keine Glocke).
    const standLeser = app.warteschlangeStand;
    const glockenUmgebung = config.auth?.environment;
    const haengtMelder =
        database && standLeser.eingerichtet && glockenUmgebung !== undefined
            ? createHaengtMelder({ database, leser: standLeser, umgebung: glockenUmgebung, log: app.log })
            : undefined;
    app.addHook("onReady", async () => haengtMelder?.start());

    // Der Takt der Besucherstatistik (WI-0138): alle 5 min abgelaufene Anwesenheiten verbuchen, Tageskennungen von gestern löschen
    // und seltene Ausprägungen verdichten. Ohne ihn wäre die Aufbewahrung aus dem Datenschutztext nur eine Behauptung.
    // Die Nutzung der eigenen Schnittstellen (V12): ein Haken am Ende jeder Anfrage, der nur im Prozess mitzählt; geschrieben
    // wird im selben Takt wie das Aufräumen.
    // Die eigenen Proben (Statusprobe über die öffentliche Adresse, WI-0307) zählen nicht als Dritte; die Adressen stehen nur in der `.env`.
    if (database) zaehleSchnittstellen(app, config.apiZaehler?.eigeneAdressen ?? []);
    if ((config.apiZaehler?.verworfen ?? 0) > 0) {
        app.log.warn(
            { verworfen: config.apiZaehler?.verworfen },
            "API_ZAEHLER_EIGENE_ADRESSEN: ungültige Einträge übergangen (keine IP-Adresse)",
        );
    }
    const besucherTakt = database ? createBesucherTakt({ database, log: app.log }) : undefined;
    app.addHook("onReady", async () => besucherTakt?.start());
    app.addHook("onClose", async () => besucherTakt?.stop());
    app.addHook("onClose", async () => lebenderHeap?.stop());

    // Die Stage übernimmt die Sonderrollen von Production (WI-0279 E9). Ohne Adresse und Schlüssel bleibt sie, was sie ist.
    const abgleichConfig = config.sonderrollenAbgleich;
    const abgleichAdresse =
        config.auth?.environment === "staging"
            ? gegenseiteAdresse(abgleichConfig?.url, (meldung) => app.log.warn(meldung), "SONDERROLLEN_ABGLEICH_URL")
            : undefined;
    const sonderrollenAbgleich =
        database && abgleichAdresse && abgleichConfig?.schluessel
            ? createSonderrollenAbgleich({
                  database,
                  environment: "staging",
                  adresse: abgleichAdresse,
                  schluessel: abgleichConfig.schluessel,
                  log: app.log,
                  ...(options.sonderrollenAbrufen === undefined ? {} : { abrufen: options.sonderrollenAbrufen }),
              })
            : undefined;
    app.decorate("sonderrollenAbgleich", sonderrollenAbgleich);
    app.addHook("onReady", async () => sonderrollenAbgleich?.start());
    app.addHook("onClose", async () => sonderrollenAbgleich?.stop());

    // Das Lebenszeichen des Jobs-Workers (WI-0127 §22): hört von Anfang an mit, damit der Systemzustand beim Öffnen schon Werte hat.
    const jobLebenszeichen =
        options.jobLebenszeichen ??
        (database
            ? new WorkerLebenszeichen({ database, warn: (fields, message) => app.log.warn(fields, message) })
            : undefined);
    app.decorate("jobLebenszeichen", jobLebenszeichen);
    app.addHook("onReady", async () => {
        // Nicht abwarten: Ein langsames `LISTEN` hält den Start nicht auf.
        void jobLebenszeichen?.start();
    });

    app.addHook("onClose", async () => {
        stichprobe?.close();
        haengtMelder?.close();
        await jobLebenszeichen?.close();
        await systemState?.close();
        await routeRunner?.close();
        if (database) {
            await database.end({ timeout: 5 });
        }
    });

    registerErrorHandler(app);
    // Die Anmeldung (WI-0120): am Root vor allen Routen, weil jede Route ein gekapseltes Plugin ist. Ohne `config.auth` aus.
    registerAuth(app, config.auth);
    // Die Tür (WI-0127 SYS-3): eine je Instanz, mit dem Speicher der Sitzungen. `GET /api/auth/gate` fragt sie für Nginx, und im
    // eingeschränkten Betrieb fragt die Anwendung sie selbst, an jeder Anfrage außer Anmeldung und Gesundheit.
    const gate = createGate({
        database,
        config: app.authConfig,
        profile: config.authGate,
        state: systemState,
        log: app.log,
        ...(options.gateCache === undefined ? {} : { cache: options.gateCache }),
        ...(options.gateWatch === undefined ? {} : { watch: options.gateWatch }),
    });
    app.decorate("gate", gate);
    app.addHook("onClose", async () => gate.close());
    registerRestrictedMode(app, gate);
    registerFeaturePause(app);
    // Die Sperren an den Schreibwegen (WI-0127 SYS-4): ebenfalls am Root, nach der Anmeldung; jede schreibende Route nennt ihre Klasse.
    registerWriteGuard(app);
    // Die Herkunft einer Kartenoperation aus einem Community-Vorgang (WI-0268 C7): Kopfzeile in den Kontext der Anfrage, gelesen von `mapOperation`.
    registriereHerkunft(app);
    app.register(healthRoutes);
    app.register(authRoutes);
    app.register(authPasswordRoutes);
    app.register(authDiscordRoutes);
    // Die Befehle aus Discord (WI-0255 Paket 2): ohne Anmeldung, Signatur von Discord; nur wo der Kanal lebt, sonst 404.
    app.register(discordInteraktionenRoutes);
    app.register(authPasskeyRoutes);
    app.register(authInvitationRoutes);
    app.register(adminRoutes);
    app.register(internSonderrollenRoutes);
    // Abzüge selbst abholen (WI-0251): zwei Lesewege hinter dem Abzugs-Schlüssel, nur auf Stage und Production.
    app.register(abzugHolenRoutes);
    app.register(karteExportRoutes);
    // Die Entwickler-API ohne Schlüssel und die 410 der alten Legacy-API (WI-0303 P7).
    app.register(entwicklerApiRoutes);
    app.register(contentStateRoutes);
    // Die Startansicht der Karte und die übrigen Voreinstellungen (WI-0166): öffentlich, mit ETag.
    app.register(mapSettingsRoutes);
    app.register(mapSeriesRoutes);
    app.register(zoomBandsRoutes);
    // Das Wetter (WI-0288 Stufe 2): der öffentliche Leseweg und die Schreibwege des Wetter-Editors.
    app.register(wetterRoutes);
    app.register(newsPublicRoutes);
    app.register(accountRoutes);
    app.register(benachrichtigungRoutes);
    app.register(kurzinfoRoutes);
    app.register(searchRoutes);
    app.register(routeRoutes);
    app.register(landscapeRoutes);
    // Die Sprachen als Kartenebene (WI-0261 S2): Liste und eine Sprache mit Teilflächen, öffentlich und nur lesend.
    app.register(spracheRoutes);
    app.register(stageLoreRoutes);
    app.register(areaRoutes);
    app.register(subjectRoutes);
    app.register(powerlineRoutes);
    app.register(shareRoutes);
    app.register(besuchRoutes);
    // Das Community-Modul (WI-0268): Meldeformular und Statusseite ohne Anmeldung, die Redaktion mit `moderate_submissions`.
    app.register(communityRoutes);
    // Die Reisebilder (WI-0272 S2): einreichen und die Statusseite des Einreichers, ohne Konto.
    app.register(photoboxRoutes);
    // Karte vorschlagen (WI-0275 Stufe B): Kartenvorschläge von Besuchern ohne Konto, die Redaktion mit `moderate_submissions`.
    app.register(kartenvorschlagRoutes);
    // Die Reisebilder auf der Karte (WI-0272 S4): der öffentliche Lesepfad je Ausschnitt, nur Veröffentlichtes.
    app.register(reisebilderRoutes);
    // Die Production-Seite der Brücke für /offen und /erledigt in Discord (WI-0268 C8): zwei Wege ohne Sitzung, nur mit dem Dienstschlüssel der Stage; ohne ihn gibt es sie nicht (404).
    app.register(communityBrueckeRoutes);
    app.register(bewertungenRoutes);
    app.register(socialRoutes);
    app.register(messwerteRoutes);
    app.register(tileRoutes);
    app.register(terrainTileRoutes);
    // Die veröffentlichten Medien (WI-0063 MEDIA-M12): lokal liefert Fastify sie aus, auf Stage und Production Nginx
    // auf demselben Pfad. Nur `published/`, und die Freigabe hat die Policy beim Import entschieden.
    app.register(mediaRoutes);
    // Der Lesepfad der Medienverwaltung (WI-0068 P2): nur mit `view_media_private`, nur lesend.
    app.register(mediaEditorRoutes);
    // Der Lesepfad des Ortseditors (WI-0128 E4) und sein Stand (E9: Schalter MAP_EDITING): nur mit `use_editor_menu`, nur lesend.
    app.register(editorPlacesRoutes);
    app.register(editorPathsRoutes);
    app.register(editorLandscapesRoutes);
    app.register(editorGebirgeRoutes);
    app.register(editorTerritoriesRoutes);
    app.register(editorKraftlinienRoutes);
    // Die Wiki-Box im Objekteditor (WI-0253): Stand, Suche, Zuweisen, Entfernen, Sync.
    app.register(editorWikiBoxRoutes);
    // Das Fenster „Inhalte bearbeiten“, Reiter „Quellen“ (WI-0254).
    app.register(editorInhalteRoutes);
    // Der Spracheditor (WI-0261 S5d): Inhalte › Auf der Karte › Sprachen.
    app.register(editorSprachenRoutes);
    app.register(editorLocksRoutes);
    app.register(editorStatusRoutes);
    // Die Prüfhaken im Auge (WI-0131): nur mit `use_editor_menu`, nur lesend.
    app.register(mapCheckRoutes);
    app.register(displayHeightRoutes);
    app.register(territoryRoutes);
    app.register(tileRevisionRoutes);
    app.register(typeImageRoutes);
    // Die Statusseite der Queue (WI-0074): nur lesend, und `STATUS_PAGE=off` schaltet sie ab (Production bis ADR-0013).
    app.register(jobsRoutes, options.jobs ?? {});
    app.register(realtimeRoutes, options.jobs ?? {});

    return app;
}
