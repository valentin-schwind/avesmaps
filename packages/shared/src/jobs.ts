import { Type, type Static } from "@sinclair/typebox";

/**
 * Die Warteschlange (JOBS-0001, WI-0074): Zustände, Gründe, Jobarten und die Verträge der Statusseite.
 *
 * 🔴 Gespeichert sind genau fünf Zustände (Kap. 11.64). „Hängt“ ist KEIN sechster, sondern abgeleitet:
 * `RUNNING` mit abgelaufener Lease. Wer „hängt“ in eine Spalte schreibt, baut einen Zustand, den niemand
 * aufräumt, wenn der Aufseher stirbt.
 */

export const JOB_STATES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type JobState = (typeof JOB_STATES)[number];

/** Zustände, die nicht mehr wechseln. */
export const TERMINAL_JOB_STATES: readonly JobState[] = ["SUCCEEDED", "FAILED", "CANCELLED"];

export function isTerminalJobState(state: JobState): boolean {
    return state === "SUCCEEDED" || state === "FAILED" || state === "CANCELLED";
}

/** Woher ein Job kommt: der Worker holt ihn (`queued`), oder ein bestehender Ablauf meldet sich selbst (`recorded`). */
export const JOB_ORIGINS = ["queued", "recorded"] as const;
export type JobOrigin = (typeof JOB_ORIGINS)[number];

/**
 * Warum ein wartender Job wartet (Abschnitt 4.3). `waits_system_lock` (WI-0127 SYS-4, SYS-0001 §3.3): ein Editor-Job wartet, solange
 * die Kartensperre gesetzt oder der Betrieb eingeschränkt ist; Importe und Wartung betrifft das nie.
 *
 * 🔴 Das sind die Gründe, die der PLANER setzt, und die Spalte trägt keinen `CHECK` (0070): Ein aufgezeichneter Ablauf darf dort
 * seinen eigenen Grund als Freitext melden, wenn er auf etwas außerhalb der Queue wartet (`stage_rollout` hinter der
 * Geländerechnung, WI-0143). Die Statusseite zeigt einen Grund, der hier nicht steht, als Satz, ohne ihn zu übersetzen.
 *
 * 🪤 Drei der Gründe schreibt niemand in die Spalte: `waits_queue_paused`, `waits_running_kind` und `waits_no_worker` entstehen
 * beim LESEN (WI-0160, `apps/server/src/jobs/wartegrund.ts`). Sie sind die Antwort auf eine Umgebung ohne Planer — in Production
 * gibt es keinen, der einen Wartegrund schreiben könnte, und eine wartende Zeile stand dort stumm da.
 */
export const WAIT_REASONS = [
    "waits_dependency",
    "waits_area",
    "waits_memory",
    "waits_slot",
    "waits_domain_lock",
    "waits_rollout",
    "waits_system_lock",
    // Ein Abgleich, den Claudios Abholer übernimmt (ABGLEICHE=korridor, WI-0127 SYS-14b): kein Worker nimmt ihn an.
    "waits_pickup",
    // Die drei Gründe, die beim LESEN entstehen (WI-0160, `apps/server/src/jobs/wartegrund.ts`): In einer Umgebung ohne Planer
    // — Production — schreibt niemand einen Wartegrund, und eine Zeile stand bis WI-0160 stumm da.
    // Die Warteschlange dieser Umgebung ist pausiert (`system_state.queue_paused`); sie übersteuert jeden anderen Grund.
    "waits_queue_paused",
    // Ein Auftrag derselben Art läuft gerade: Abholer wie Worker nehmen immer nur einen.
    "waits_running_kind",
    // Hier nimmt niemand diese Art an: kein Planer läuft, und kein Abholer holt sie.
    "waits_no_worker",
    // Die Umgebung kann diesen Auftrag noch nicht ausführen (WI-0163): Der Dirigent hat gestartet, der Ausführer meldet „fehlt“
    // (Exit 3, etwa Production vor der Freigabe des Releases mit `auftrag-cli`). Der Dirigent versucht es später wieder.
    "waits_executor",
    // Der Auftrag hängt (WI-0179): Der Ausführer hat ihn immer wieder gleich abgewiesen (`haengt` im Stand). 🔴 Entsteht nur beim
    // LESEN (`grundAusStand`, `apps/server/src/jobs/gemeinsame-reihe.ts`); der Dirigent schreibt ihn nie in den Stand, sonst läse
    // ein älterer Leser den ganzen Stand als unlesbar.
    "waits_executor_stuck",
    "debouncing",
] as const;
export type WaitReason = (typeof WAIT_REASONS)[number];

/** Warum ein Job abgebrochen wurde. */
export const CANCEL_REASONS = ["operator", "owner", "dependency_failed", "dependency_cancelled", "superseded"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** Befunde an einer Jobzeile: sie melden, sie halten nie an (AGENTS.md „Blockierende Prüfungen im Betrieb“). */
export const JOB_FINDING_CODES = [
    "swap_in_use",
    "budget_exceeded",
    "selfreport_deviation",
    "observed_false",
    "recorder_lost",
] as const;
export type JobFindingCode = (typeof JOB_FINDING_CODES)[number];

/**
 * Die Jobarten, die dieses Release kennt. Eine Jobart steht NICHT als `CHECK` in der Datenbank (ein neuer Name wäre
 * sonst ein `DROP CONSTRAINT` mitten in einem Blue/Green-Wechsel); jeder Slot nimmt nur Arten an, die er kennt.
 * Gelände-Jobs (`terrain_local`, `dem_publish`, `display_heights`, `routing_reload`) kommen mit Etappe 2.
 */
export const JOB_KINDS = ["probe", "import", "rollout"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** Höchstens zwei Wiederholungen, also drei Läufe (Auftrag, JOBS-0001 4.6). Entschieden, keine Messstelle. */
export const JOB_MAX_RETRIES = 2;

/**
 * So viele zuletzt beendete Aufträge liefert die Übersicht je Liste (`recent`: fertig und abgebrochen, `failed`: gescheitert). Die
 * Statusseite mischt beide zeitlich (Betreiber 2026-10-15) und muss wissen, ob eine Liste gekappt ist: Nur dann fehlt dahinter etwas.
 */
export const JOBS_FINISHED_LIMIT = 15;

/** Der `LISTEN`-Kanal der Datenbank: das Ereignis trägt nur die Nummer `seq`, die Wahrheit bleibt die Tabelle. */
export const JOB_NOTIFY_CHANNEL = "avesmaps3d_jobs";

/** Die Klasse des Advisory Locks des Planers; die Kartendomäne ist der zweite Schlüssel. */
export const JOB_PLANNER_LOCK_CLASS = "avesmaps3d:job-worker";

// --- Verträge der Statusseite ----------------------------------------------------------------------------------

const StateSchema = Type.Union(JOB_STATES.map((state) => Type.Literal(state)));
const OriginSchema = Type.Union(JOB_ORIGINS.map((origin) => Type.Literal(origin)));

export const JobFinding = Type.Object({ code: Type.String(), detail: Type.String() }, { additionalProperties: false });
export type JobFinding = Static<typeof JobFinding>;

export const JobScope = Type.Object(
    {
        kind: Type.Union([Type.Literal("domain"), Type.Literal("tiles")]),
        tiles: Type.Array(Type.Integer()),
    },
    { additionalProperties: false },
);
export type JobScope = Static<typeof JobScope>;

/**
 * Wer einen Auftrag ausgelöst hat, als Art (WI-0293; Betreiber 2026-11-09 zur Warteschlange: „Wer hat sie gestartet. Wann. Wo (Stage
 * oder Production)?“). Abgeleitet aus `job.actor_ref` und der Herkunft (`apps/server/src/jobs/ausloeser.ts`), nie gespeichert:
 *
 * - `person`: eine pseudonyme `person.id`. Auch Folgeaufträge einer Kette tragen sie (Gelände veröffentlichen, Routenrechner,
 *   Höhenlinien nach einer Speicherung).
 * - `kommandozeile`: `cli:<Systembenutzer>` oder `jobs-cli`.
 * - `agent`: `agent:claudia`, `agent:claudio` (eine freigegebene Kartenoperation eines Agenten).
 * - `automatik`: jede andere Kennung eines Ablaufs (`system:<Etikett>`, `kanal`, `inhaltsschalter`, `notaus`).
 * - `betrieb`: ein aufgezeichneter Lauf ohne Auslöser (Auslieferung, Sicherung, Abholer).
 * - `unbekannt`: ein eingereihter Auftrag ohne Auslöser.
 */
export const AUSLOESER_ARTEN = ["person", "kommandozeile", "agent", "automatik", "betrieb", "unbekannt"] as const;
export type AusloeserArt = (typeof AUSLOESER_ARTEN)[number];

/**
 * Der Auslöser, wie die Warteschlange ihn zeigt (WI-0293). 🔴 Einen Namen trägt er nur in einer Antwort an jemanden, der die
 * Warteschlange sehen darf (`view_operations` alles, `view_own_jobs` nur die eigenen Aufträge, also nur den eigenen Namen). In der
 * Tafel steht weiter die opake `actor_ref` (JOBS-0001 §4.1); den Namen löst die Anwendung aus dem geschützten Schema auf, für die
 * andere Umgebung der Dirigent mit einem Leserecht nur auf Kennung und Anzeigename (Betreiber 2026-11-09: „Ja, Namen zeigen“).
 */
export const JobAusloeser = Type.Object(
    {
        art: Type.Union(AUSLOESER_ARTEN.map((art) => Type.Literal(art))),
        /** Der heutige Anzeigename der Person oder der Name des Agenten; `null`, wo es keinen gibt oder er sich nicht auflösen lässt. */
        name: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
);
export type JobAusloeser = Static<typeof JobAusloeser>;

/**
 * Ein Job, wie die Statusseite ihn zeigt. Keine Pfade, keine Geheimnisse (Abschnitt 4.1); einen Namen nur im Auslöser der Übersicht
 * (`ausgeloest`, WI-0293).
 */
export const JobSummary = Type.Object(
    {
        id: Type.String(),
        kind: Type.String(),
        origin: OriginSchema,
        state: StateSchema,
        /** `true`, wenn `RUNNING` mit abgelaufener Lease: dann zeigt die Seite „hängt“. */
        stalled: Type.Boolean(),
        label: Type.Union([Type.String(), Type.Null()]),
        waitReason: Type.Union([Type.String(), Type.Null()]),
        phase: Type.Union([Type.String(), Type.Null()]),
        progress: Type.Union([Type.Number(), Type.Null()]),
        mapDomainId: Type.String(),
        scope: JobScope,
        priority: Type.Integer(),
        queuedAt: Type.String(),
        notBefore: Type.Union([Type.String(), Type.Null()]),
        startedAt: Type.Union([Type.String(), Type.Null()]),
        finishedAt: Type.Union([Type.String(), Type.Null()]),
        heartbeatAt: Type.Union([Type.String(), Type.Null()]),
        leaseExpiresAt: Type.Union([Type.String(), Type.Null()]),
        attempt: Type.Integer(),
        /** Läufe, die dieser Job höchstens bekommt (Wiederholungen plus eins). */
        maxAttempts: Type.Integer(),
        wallMs: Type.Union([Type.Integer(), Type.Null()]),
        rssPeakMb: Type.Union([Type.Integer(), Type.Null()]),
        memExpectedMb: Type.Union([Type.Integer(), Type.Null()]),
        swapSeenMb: Type.Union([Type.Integer(), Type.Null()]),
        cancelRequested: Type.Boolean(),
        cancelReason: Type.Union([Type.String(), Type.Null()]),
        errorCode: Type.Union([Type.String(), Type.Null()]),
        errorSummary: Type.Union([Type.String(), Type.Null()]),
        findings: Type.Array(JobFinding),
        coalescedCount: Type.Integer(),
        /** Verweise der Abhängigkeiten (öffentliche Kennungen der Vorgänger). */
        dependsOn: Type.Array(Type.String()),
        result: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
        /**
         * Das erwartete Ende, wie ein laufender Auftrag es selbst meldet (WI-0248: die Restzeit des Release-Test-Runners). Fehlt, wo der
         * Auftrag keine Restzeit kennt; dann rechnet die Oberfläche aus der Schätzung.
         */
        etaAt: Type.Optional(Type.String()),
        /**
         * Wer ihn ausgelöst hat (WI-0293). Nur in der Übersicht (`GET /api/jobs/overview`); fehlt in anderen Antworten und bei einem
         * älteren Server. Die Oberfläche sagt dann „Auslöser unbekannt“.
         */
        ausgeloest: Type.Optional(JobAusloeser),
    },
    { additionalProperties: false },
);
export type JobSummary = Static<typeof JobSummary>;

/** Wie sicher eine Zeitangabe ist: aus dem Startwert, aus den letzten Läufen oder gar nicht („unbekannt“). */
export const ESTIMATE_BASES = ["history", "startwert", "unknown"] as const;
export type EstimateBasis = (typeof ESTIMATE_BASES)[number];

export const JobEstimate = Type.Object(
    {
        /** Frühester Start, `null` = unbekannt. */
        startAt: Type.Union([Type.String(), Type.Null()]),
        finishAt: Type.Union([Type.String(), Type.Null()]),
        durationP50S: Type.Union([Type.Number(), Type.Null()]),
        durationP95S: Type.Union([Type.Number(), Type.Null()]),
        basis: Type.Union(ESTIMATE_BASES.map((basis) => Type.Literal(basis))),
    },
    { additionalProperties: false },
);
export type JobEstimate = Static<typeof JobEstimate>;

export const QueueEntry = Type.Composite([
    JobSummary,
    Type.Object({ position: Type.Integer(), estimate: JobEstimate }),
]);
export type QueueEntry = Static<typeof QueueEntry>;

/**
 * Die Pause der Warteschlange, wie die Statusseite sie zeigt (WI-0160): „pausiert seit … von … · Grund“ oben im Reiter. Der Grund
 * steht nur in der vollen Sicht — er kann Personenbezug tragen, wie der Grund einer Sperre (SYS-0001 §4.6).
 *
 * 🔴 Hier steht nur die ANZEIGE. Geschaltet wird in der Verwaltung („Betriebszustand“), mit Recht, frischem Passkey und
 * Protokolleintrag; die Statusseite ist nur lesend und in Production ohnehin aus.
 */
export const QueuePauseView = Type.Object(
    {
        paused: Type.Boolean(),
        since: Type.Union([Type.String(), Type.Null()]),
        /** Der heutige Anzeigename, `cli:<Benutzer>` an der Kommandozeile, `null` ohne beides. */
        by: Type.Union([Type.String(), Type.Null()]),
        reason: Type.Union([Type.String(), Type.Null()]),
        /**
         * Die ANDERE Umgebung, in der zuletzt geschaltet wurde (WI-0163: wirksam ist die jüngste Anweisung über alle Umgebungen).
         * 🔴 Dann steht keine Person in `by`: Ein Name lässt sich nur in der Umgebung auflösen, in der geschaltet wurde; hier steht
         * stattdessen die Umgebung („auf der Stage“). Fehlt das Feld oder ist es `null`, wurde hier geschaltet.
         */
        anderswo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    },
    { additionalProperties: false },
);
export type QueuePauseView = Static<typeof QueuePauseView>;

/**
 * Wie es um den Stand der gemeinsamen Warteschlange steht (WI-0163 §1.7): `ok` heißt, der Dirigent hat ihn vor höchstens
 * `WARTESCHLANGE_STAND_ALT_S` geschrieben. Alles andere ist „Zustand unbekannt“, nie „läuft“: Die Datei fehlt, lässt sich nicht
 * lesen oder ist zu alt.
 */
export const GEMEINSAM_ZUSTAENDE = ["ok", "fehlt", "unlesbar", "veraltet"] as const;
export type GemeinsamZustand = (typeof GEMEINSAM_ZUSTAENDE)[number];

/**
 * Ein Auftrag der gemeinsamen Reihe, wie Statusseite und Verwaltung ihn zeigen (WI-0163 §1.7). Die eigenen Aufträge tragen ihre
 * öffentliche Kennung (`jobId`); ihre Einzelheiten stehen in den Listen der eigenen Umgebung. 🔴 Die der anderen Umgebung stehen nur
 * mit Umgebung, Art, Bezeichnung, Platz, Zustand, Grund und Auslöser (Art und Anzeigename, WI-0293) da: ohne Kennung, die hier ohnehin
 * niemand auflösen könnte.
 */
export const GemeinsamerAuftrag = Type.Object(
    {
        umgebung: Type.String(),
        /** Ein Auftrag dieser Umgebung. */
        eigen: Type.Boolean(),
        jobId: Type.Union([Type.String(), Type.Null()]),
        kind: Type.String(),
        label: Type.Union([Type.String(), Type.Null()]),
        state: Type.Union([Type.Literal("QUEUED"), Type.Literal("RUNNING")]),
        /** Platz in der gemeinsamen Reihe (1 = als Nächstes dran); `null` bei laufenden. */
        platz: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
        phase: Type.Union([Type.String(), Type.Null()]),
        progress: Type.Union([Type.Number(), Type.Null()]),
        /** Warum er wartet (Schlüssel aus `WAIT_REASONS`); `null` bei laufenden und bei dem, der als Nächstes startet. */
        waitReason: Type.Union([Type.String(), Type.Null()]),
        queuedAt: Type.String(),
        startedAt: Type.Union([Type.String(), Type.Null()]),
        /**
         * Wer ihn ausgelöst hat (WI-0293): die Art, bei einer Person dazu ihr Anzeigename aus dem Stand, auch für die andere Umgebung
         * (Betreiber 2026-11-09: „Ja, Namen zeigen“). `name` ist `null`, solange der Dirigent den Namen nicht lesen darf. Fehlt, solange er
         * die Art nicht in den Stand schreibt.
         */
        ausgeloest: Type.Optional(JobAusloeser),
        /**
         * Frühester Start aus dem Stand (WI-0293): Mit ihm nennt ein sammelnder Auftrag (`debouncing`) seine Restzeit. Fehlt, solange der
         * Dirigent ihn nicht schreibt; dann heißt die Restzeit „unbekannt“.
         */
        notBefore: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    },
    { additionalProperties: false },
);
export type GemeinsamerAuftrag = Static<typeof GemeinsamerAuftrag>;

/**
 * Die gemeinsame Warteschlange aus dem Stand des Dirigenten (WI-0163; `QUEUE_STAND_FILE`). Fehlt die Variable, fehlt auch dieses
 * Feld in den Antworten, und es gilt die eigene Tafel wie bis WI-0163.
 */
export const GemeinsameWarteschlange = Type.Object(
    {
        zustand: Type.Union(GEMEINSAM_ZUSTAENDE.map((zustand) => Type.Literal(zustand))),
        /** Diese Umgebung, wie der Stand sie nennt (`development`, `staging`, `production`, `test`). */
        umgebung: Type.String(),
        /** Wann der Dirigent den Stand zuletzt geschrieben hat; `null`, wenn er sich nicht lesen ließ. */
        stand: Type.Union([Type.String(), Type.Null()]),
        /** Die WIRKSAME Pause (die jüngste Anweisung über alle Umgebungen); `null` ohne frischen Stand. */
        pause: Type.Union([QueuePauseView, Type.Null()]),
        /** Laufende zuerst, dann die wartenden nach Platz; leer ohne frischen Stand. */
        reihe: Type.Array(GemeinsamerAuftrag),
    },
    { additionalProperties: false },
);
export type GemeinsameWarteschlange = Static<typeof GemeinsameWarteschlange>;

export const JobsMemory = Type.Object(
    {
        /** Summe der Erwartungen aller laufenden Jobs. */
        bookedMb: Type.Integer(),
        budgetMb: Type.Union([Type.Integer(), Type.Null()]),
        availableMb: Type.Union([Type.Integer(), Type.Null()]),
        availFloorMb: Type.Union([Type.Integer(), Type.Null()]),
        swapUsedMb: Type.Union([Type.Integer(), Type.Null()]),
        rolloutActive: Type.Boolean(),
    },
    { additionalProperties: false },
);
export type JobsMemory = Static<typeof JobsMemory>;

export const JobsOverview = Type.Object(
    {
        /** Nummer des letzten Ereignisses: ab hier holt der Client nach. */
        seq: Type.Integer(),
        now: Type.String(),
        releaseId: Type.String(),
        profile: Type.String(),
        /**
         * Ob gerade ein Planer lebt: ein Worker hält den Advisory Lock, oder (mit `QUEUE_STAND_FILE`, WI-0163) der Dirigent hat seinen
         * Stand vor höchstens `WARTESCHLANGE_STAND_ALT_S` geschrieben und plant diese Umgebung.
         */
        plannerActive: Type.Boolean(),
        /** Die Pause der Warteschlange dieser Umgebung (WI-0160); der Grund nur in der vollen Sicht. */
        queuePause: QueuePauseView,
        /**
         * Welche Sicht (WI-0120 A11, JOBS-0001 D1 A): `all` mit Speicher und Befunden für den Betrieb, `own` nur die eigenen Jobs
         * (Position und Wartezeit gelten trotzdem für die ganze Warteschlange).
         */
        view: Type.Union([Type.Literal("all"), Type.Literal("own")]),
        running: Type.Array(JobSummary),
        queued: Type.Array(QueueEntry),
        recent: Type.Array(JobSummary),
        failed: Type.Array(JobSummary),
        stalled: Type.Array(JobSummary),
        /** Das Speicherbudget; in der eigenen Sicht `null` (nur Betreiber, JOBS-0001 5.2). */
        memory: Type.Union([JobsMemory, Type.Null()]),
        /**
         * Die gemeinsame Reihe aus dem Stand des Dirigenten (WI-0163); fehlt ohne `QUEUE_STAND_FILE`. In der eigenen Sicht nur die
         * eigenen Aufträge.
         */
        gemeinsam: Type.Optional(GemeinsameWarteschlange),
        /**
         * Die Umgebung dieser Tafel (`AVESMAPS_ENV`: `development`, `staging`, `production`, `test`; WI-0293). Alle Listen oben sind
         * Aufträge dieser Umgebung; die Oberfläche nennt sie in jeder Zeile („auf Production“), weil die gemeinsame Reihe Aufträge beider
         * Umgebungen mischt. Fehlt bei einem älteren Server.
         */
        umgebung: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);
export type JobsOverview = Static<typeof JobsOverview>;

export const JobsList = Type.Object({ jobs: Type.Array(JobSummary) }, { additionalProperties: false });
export type JobsList = Static<typeof JobsList>;

/** Ein Ereignis im Verlauf. Nur Zustands- und Phasenwechsel, nie Heartbeats (Kap. 7.38). */
export const JobEventRecord = Type.Object(
    {
        seq: Type.Integer(),
        at: Type.String(),
        kind: Type.String(),
        jobId: Type.Union([Type.String(), Type.Null()]),
        mapDomainId: Type.Union([Type.String(), Type.Null()]),
        payload: Type.Record(Type.String(), Type.Unknown()),
    },
    { additionalProperties: false },
);
export type JobEventRecord = Static<typeof JobEventRecord>;

export const EventsResponse = Type.Object(
    {
        events: Type.Array(JobEventRecord),
        /** Neueste Nummer; der Client merkt sie sich. */
        latestSeq: Type.Integer(),
        /** `true`: die gewünschten Ereignisse sind schon aufgeräumt, der Client holt den Stand neu und vergleicht Zeiger. */
        gap: Type.Boolean(),
    },
    { additionalProperties: false },
);
export type EventsResponse = Static<typeof EventsResponse>;

// --- Betrieb und Überblick ------------------------------------------------------------------------------------

export const OperationsStatus = Type.Object(
    {
        now: Type.String(),
        releaseId: Type.String(),
        profile: Type.String(),
        health: Type.Object(
            {
                database: Type.Object(
                    { status: Type.Union([Type.Literal("ok"), Type.Literal("failed")]), detail: Type.String() },
                    { additionalProperties: false },
                ),
            },
            { additionalProperties: false },
        ),
        migration: Type.Union([Type.String(), Type.Null()]),
        pointers: Type.Object(
            {
                dem: Type.Union([
                    Type.Object(
                        { revision: Type.String(), format: Type.String(), createdAt: Type.String() },
                        { additionalProperties: false },
                    ),
                    Type.Null(),
                ]),
                displayHeights: Type.Object(
                    {
                        state: Type.Union([Type.Literal("current"), Type.Literal("stale"), Type.Literal("none")]),
                        revision: Type.Union([Type.String(), Type.Null()]),
                        demRevision: Type.Union([Type.String(), Type.Null()]),
                    },
                    { additionalProperties: false },
                ),
            },
            { additionalProperties: false },
        ),
        legacy: Type.Object(
            {
                mapRevision: Type.Union([Type.String(), Type.Null()]),
                ecosystemRevision: Type.Union([Type.String(), Type.Null()]),
                territoriesRevision: Type.Union([Type.String(), Type.Null()]),
                importedAt: Type.Union([Type.String(), Type.Null()]),
            },
            { additionalProperties: false },
        ),
        imports: Type.Array(JobSummary),
    },
    { additionalProperties: false },
);
export type OperationsStatus = Static<typeof OperationsStatus>;

/** Eine Fundstelle im Repository: die Seite sagt immer, woher sie etwas hat (Datei und Zeile). */
export const RepoBeleg = Type.Object({ file: Type.String(), line: Type.Integer() }, { additionalProperties: false });
export type RepoBeleg = Static<typeof RepoBeleg>;

const RepoEntry = Type.Object(
    { text: Type.String(), detail: Type.Union([Type.String(), Type.Null()]), beleg: RepoBeleg },
    { additionalProperties: false },
);

export const RepoOverview = Type.Object(
    {
        /** `false` auf Stage und überall, wo es kein Repository gibt (D2: nur lokal). */
        available: Type.Boolean(),
        reason: Type.Union([Type.Literal("not_local"), Type.Literal("no_repository"), Type.Null()]),
        generatedAt: Type.String(),
        today: Type.String(),
        /** Handovers und Entscheidungen, die auf den Betreiber warten. */
        waiting: Type.Array(RepoEntry),
        /** Zeilen der Form „Betreiber <heute>: „…““. */
        decidedToday: Type.Array(RepoEntry),
        /** Markierungen `IMPLEMENTATION DETAIL` und „selbst entschieden“ in heute geänderten Dateien. */
        selfDecided: Type.Array(RepoEntry),
        /** Work Items in Arbeit samt Besitzer, abgeleitet aus dem Repository (D3 A). */
        sessions: Type.Array(RepoEntry),
        /** Datenstand laut Dokumentation: Stage gegen lokal (`current.md` Abschnitt 4). */
        dataStand: Type.Array(
            Type.Object(
                { label: Type.String(), local: Type.String(), stage: Type.String(), beleg: RepoBeleg },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type RepoOverview = Static<typeof RepoOverview>;

// --- /ws ---------------------------------------------------------------------------------------------------------

/**
 * Die Kanäle von `/ws`: `jobs` (die Statusseite, JOBS-0001 Etappe 1) und `area` (die Karte, Etappe 2, WI-0125): nur die
 * Bereichsereignisse `area.changed` (neue Geländekacheln mit Bereich und Kachelliste) und `display_heights.changed`.
 */
export type WsChannel = "jobs" | "area";

/** Was ein Client über `/ws` schickt. */
export type WsClientMessage =
    | { op: "subscribe"; channel: WsChannel; since?: number }
    | { op: "unsubscribe"; channel: WsChannel }
    | { op: "ping" };

/** Was der Server schickt. Das Ereignis trägt `seq`; die Wahrheit liefert HTTP. */
export type WsServerMessage =
    | { op: "hello"; seq: number; serverTime: string; releaseId: string }
    | { op: "subscribed"; channel: WsChannel; seq: number }
    | { op: "event"; channel: WsChannel; event: JobEventRecord }
    | { op: "gap"; channel: WsChannel; seq: number }
    | { op: "pong"; serverTime: string }
    | { op: "error"; code: string };

/** Alle 30 s sendet der Client einen Ping (Nginx hält `/ws` 3.600 s offen, Claudio Q9). */
export const WS_PING_INTERVAL_S = 30;
