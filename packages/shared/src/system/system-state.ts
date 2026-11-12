import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { PersonRef } from "../auth/admin.ts";
import { RoutingState } from "../health.ts";
import { GemeinsameWarteschlange } from "../jobs.ts";
import { OperationId } from "../operation.ts";

/**
 * Der Betriebszustand (WI-0127 SYS-2, Bauplan SYS-0001 §3.1, §3.2, §4.2, §4.6; Betreiber 2026-10-09 E1, E4, E5).
 *
 * - **Stellung** `normal` oder `restricted` (eingeschränkt: nur Personen mit `access_restricted_mode` kommen hinein). Eine Stellung
 *   „Wartung“ gibt es hier nicht: Die Wartung ist Claudios root-Datei, die Anwendung sieht sie nie.
 * - **Zwei Sperren**, getrennt (E4): die Kartensperre (`map`) hält jede Änderung an Kartendaten und Inhalten an, die Systemsperre
 *   (`system`) jede Änderung an Rechten und Einstellungen; Sicherheitshandgriffe bleiben unter beiden offen. An den Schreibwegen
 *   wirken sie seit SYS-4 (`apps/server/src/system/write-guard.ts`: 423 `map_locked` bzw. `system_locked`).
 * - **Eingestellt** ist, was in der Datenbank steht; **wirksam** ist, was eine Instanz gerade im Speicher hält. Weiß sie es nicht, ist
 *   die Quelle `unknown` und Stellung wie Sperren sind `null`: nie Normal, nie offen (fail-closed, Claudio 2026-10-09 Punkt 4).
 */
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String();
const Revision = Type.Integer({ minimum: 1 });

export const SYSTEM_MODES = ["normal", "restricted"] as const;
export type SystemMode = (typeof SYSTEM_MODES)[number];
export const SystemModeName = Type.Union(SYSTEM_MODES.map((mode) => Type.Literal(mode)));

export const SYSTEM_LOCKS = ["map", "system"] as const;
export type SystemLock = (typeof SYSTEM_LOCKS)[number];
export const SystemLockName = Type.Union(SYSTEM_LOCKS.map((lock) => Type.Literal(lock)));

/**
 * Woher eine Instanz ihren Zustand hat (§3.2):
 * - `database`: die Zeile gelesen, höchstens 30 s alt;
 * - `unprovisioned`: die Tabelle fehlt noch (Fastify startet im Korridor vor `migrate`); dann gilt Normal wie vor SYS-2;
 * - `unknown`: Datenbank weg, Lesen gescheitert oder der letzte Stand zu alt. Kein Schreibweg läuft (503 `system_state_unknown`).
 */
export const SYSTEM_STATE_SOURCES = ["database", "unprovisioned", "unknown"] as const;
export type SystemStateSource = (typeof SYSTEM_STATE_SOURCES)[number];
export const SystemStateSourceName = Type.Union(SYSTEM_STATE_SOURCES.map((source) => Type.Literal(source)));

/** Längster Grund in Zeichen, wie bei den Sonderrechten. */
export const SYSTEM_REASON_MAX = 300;
const Reason = Type.String({ maxLength: SYSTEM_REASON_MAX });

/**
 * Die Fachcodes des Betriebszustands (ADR-0018, SYS-0001 §4.6) mit ihrem HTTP-Status, soweit SYS-2 bis SYS-4 sie brauchen.
 * `feature_paused` und `unknown_switch` kommen mit dem Paket, das sie auslöst (SYS-10).
 *
 * `restricted_mode` (503, SYS-3): Die Anwendung ist eingeschränkt, und diese Anfrage trägt kein Zugangsrecht (`access_restricted_mode`
 * mit zweitem Faktor). Er kommt nur ohne Nginx davor (lokal, über die Schleife) oder wenn der vhost eine Adresse nicht durch die Tür
 * schickt; hinter der Tür sieht ein Besucher stattdessen die Wartungsseite.
 *
 * `map_locked` und `system_locked` (423) tragen `details` nach `SystemLockedDetails`; die Oberfläche entscheidet am Code, nie am Satz.
 */
export const SYSTEM_ERROR_STATUS = {
    system_state_unknown: 503,
    restricted_mode: 503,
    would_lock_out_self: 409,
    no_restricted_access_holder: 409,
    reason_required: 400,
    no_change: 409,
    map_locked: 423,
    system_locked: 423,
} as const;
export type SystemErrorCode = keyof typeof SYSTEM_ERROR_STATUS;

/**
 * `details` von 423 `map_locked` und `system_locked` (SYS-0001 §4.6): seit wann die Sperre gilt; den Grund sieht nur, wer
 * `view_operations` hat (er kann Personenbezug tragen und steht sonst nur in der Verwaltung).
 */
export const SystemLockedDetails = Type.Object(
    { since: Nullable(Moment), reason: Type.Optional(Type.String()) },
    { additionalProperties: false },
);
export type SystemLockedDetails = Static<typeof SystemLockedDetails>;

/** `POST /api/admin/system/mode`: umschalten. Beim Einschränken ist der Grund Pflicht (er steht im Protokoll). */
export const SystemModeBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Revision,
        mode: SystemModeName,
        reason: Type.Optional(Reason),
    },
    { additionalProperties: false },
);
export type SystemModeBody = Static<typeof SystemModeBody>;

/** `POST /api/admin/system/lock`: eine Sperre setzen (Grund Pflicht) oder lösen. */
export const SystemLockBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Revision,
        lock: SystemLockName,
        locked: Type.Boolean(),
        reason: Type.Optional(Reason),
    },
    { additionalProperties: false },
);
export type SystemLockBody = Static<typeof SystemLockBody>;

/**
 * `POST /api/admin/system/queue`: die Warteschlange dieser Umgebung pausieren (Grund Pflicht) oder fortsetzen (WI-0160).
 *
 * 🔴 Es gibt „Pausieren“ und „Fortsetzen“, kein „Starten“: Nichts ist angehalten, was man starten müsste — die Aufträge holt der
 * Abholer von selbst ab (Claudios Entwurf §5; die Beschriftung steht im Work Item WI-0160, dem Betreiber vorgelegt).
 */
export const SystemQueueBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Revision,
        paused: Type.Boolean(),
        reason: Type.Optional(Reason),
    },
    { additionalProperties: false },
);
export type SystemQueueBody = Static<typeof SystemQueueBody>;

/** Wer zuletzt geschaltet hat: eine Person oder die Kommandozeile (`cli:<Systembenutzer>`), nie beides; beide leer heißt Migration. */
const Setter = {
    since: Nullable(Moment),
    by: Nullable(PersonRef),
    byLabel: Nullable(Type.String()),
    reason: Nullable(Type.String()),
};

export const SystemModeSetting = Type.Object(
    { mode: SystemModeName, ...Setter, since: Moment },
    { additionalProperties: false },
);
export const SystemLockSetting = Type.Object({ locked: Type.Boolean(), ...Setter }, { additionalProperties: false });

/** Die Pause der Warteschlange (WI-0160), in derselben Form wie eine Sperre: seit wann, von wem, warum. */
export const SystemQueueSetting = Type.Object({ paused: Type.Boolean(), ...Setter }, { additionalProperties: false });

/** Der eingestellte Zustand, wie er in der Datenbank steht. */
export const SystemStateView = Type.Object(
    {
        mode: SystemModeSetting,
        mapLock: SystemLockSetting,
        systemLock: SystemLockSetting,
        queuePause: SystemQueueSetting,
        revision: Revision,
        contentRevision: Revision,
        updatedAt: Moment,
    },
    { additionalProperties: false },
);
export type SystemStateView = Static<typeof SystemStateView>;

/** Was diese Instanz gerade im Speicher hält. Bei `unknown` sind Stellung und Sperren `null`, nie ein geratener Wert. */
export const SystemEffectiveState = Type.Object(
    {
        source: SystemStateSourceName,
        mode: Nullable(SystemModeName),
        mapLock: Nullable(Type.Boolean()),
        systemLock: Nullable(Type.Boolean()),
        revision: Nullable(Revision),
        contentRevision: Nullable(Revision),
        /** Zeitpunkt des letzten erfolgreichen Lesens. */
        readAt: Nullable(Moment),
        /** Pool-Ping jung und erfolgreich, Zustand nicht `unknown` (§3.2). Die Tür (SYS-3) liest daraus ihre Bereitschaft. */
        ready: Type.Boolean(),
    },
    { additionalProperties: false },
);
export type SystemEffectiveState = Static<typeof SystemEffectiveState>;

/** Wer im eingeschränkten Betrieb hineinkommt; die Bestätigung nennt sie namentlich (§4.5). */
export const RestrictedAccessHolder = Type.Object(
    { person: PersonRef, hasPasskey: Type.Boolean() },
    { additionalProperties: false },
);

/** Die Teile des Kurzstatus, die bereit oder gestört sein können; `off` heißt „hier nicht eingerichtet“, kein Fehler. */
export const SystemBriefState = Type.Union([Type.Literal("ready"), Type.Literal("failed")]);
export const SystemBriefLoginState = Type.Union([Type.Literal("ready"), Type.Literal("failed"), Type.Literal("off")]);

/**
 * Der Kurzstatus „Betrieb im Moment“ (WI-0127 SYS-5, SYS-0001 §6.2, Blatt A1): was DIESE Instanz selbst weiß, aus den Lesepfaden, die
 * es schon gibt. Die Tür-Probe von außen (Claudios `system.json`) kommt mit SYS-8; bis dahin steht hier die eigene Bereitschaft.
 *
 * - `now`: die Uhr des Servers beim Antworten. Die Oberfläche rechnet jedes „vor … s“ daran, nie an der Uhr des Browsers.
 * - `startedAt`: seit wann diese Instanz (und damit ihr Release) läuft.
 * - `map`: die eigene Bereitschaft (`ready` des wirksamen Zustands); `login`: die Anmeldung ist eingerichtet und bereit.
 * - `routing`: der Zustand des Routenrechners wie `/health/routing`, das Nginx nicht durchreicht.
 * - `queue`: laufende und wartende Jobs; `null`, wenn sich die Warteschlange gerade nicht lesen lässt (nie eine Null). Mit dem Stand
 *   des Dirigenten (WI-0163) zählt die gemeinsame Reihe aller Umgebungen; ist er unbekannt, ist auch `queue` `null`.
 */
export const AdminSystemBrief = Type.Object(
    {
        now: Moment,
        releaseId: Type.String(),
        startedAt: Moment,
        map: SystemBriefState,
        login: SystemBriefLoginState,
        routing: RoutingState,
        queue: Nullable(
            Type.Object(
                { running: Type.Integer({ minimum: 0 }), queued: Type.Integer({ minimum: 0 }) },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type AdminSystemBrief = Static<typeof AdminSystemBrief>;

/**
 * `GET /api/admin/system`: eingestellt (`null`, solange die Tabelle fehlt), wirksam auf dieser Instanz, Inhaber des Zugangsrechts,
 * dazu seit SYS-5 der Kurzstatus (`brief`).
 *
 * Seit WI-0163 die gemeinsame Warteschlange (`warteschlange`): die wirksame Pause über alle Umgebungen und die gemeinsame Reihe aus
 * dem Stand des Dirigenten. 🔴 `configured.queuePause` bleibt die letzte Anweisung DIESER Umgebung; wirksam ist die jüngste über
 * alle. Ohne `QUEUE_STAND_FILE` fehlt das Feld, und es gilt die eigene Zeile wie bis WI-0163.
 */
export const AdminSystemOverview = Type.Object(
    {
        configured: Nullable(SystemStateView),
        effective: SystemEffectiveState,
        restrictedAccessHolders: Type.Array(RestrictedAccessHolder),
        brief: AdminSystemBrief,
        warteschlange: Type.Optional(GemeinsameWarteschlange),
    },
    { additionalProperties: false },
);
export type AdminSystemOverview = Static<typeof AdminSystemOverview>;

/**
 * `GET /health/mode`, nur über Loopback (Claudio 2026-10-09 Punkt 8): oben flach der WIRKSAME Zustand dieser Instanz (SYS-0001 §4.2),
 * daneben der EINGESTELLTE aus der Datenbank (`null`, wenn er sich gerade nicht lesen lässt) und der Stand von `LISTEN`. Immer 200:
 * eine Anzeige für den Postflight, kein Gate für Blue/Green.
 */
export const HealthModeResponse = Type.Object(
    {
        releaseId: Type.String(),
        ...SystemEffectiveState.properties,
        listen: Type.Object(
            {
                /** Abonnement steht und die Datenbank antwortet. */
                connected: Type.Boolean(),
                /** Wie oft `LISTEN` (neu) aufgebaut wurde; jedes Wiederverbinden zählt eins weiter und liest neu. */
                generation: Type.Integer({ minimum: 0 }),
                lastResyncAt: Nullable(Moment),
            },
            { additionalProperties: false },
        ),
        configured: Nullable(
            Type.Object(
                {
                    mode: SystemModeName,
                    mapLock: Type.Boolean(),
                    systemLock: Type.Boolean(),
                    revision: Revision,
                    contentRevision: Revision,
                },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type HealthModeResponse = Static<typeof HealthModeResponse>;
