import { Type, type Static, type TSchema } from "@sinclair/typebox";

/**
 * Die Variablen der Warteschlange (JOBS-0001 Abschnitt 7, Register `MS1` bis `MS20`), ein Profil je Umgebung unter
 * `config/jobs/`.
 *
 * 🔴 VARIABLEN, KEINE ZAHLEN IM CODE. Jeder Wert, der vom Rechner abhängt (Zeit, Speicher, Parallelität), steht hier.
 * Lokale Werte stehen nur im Profil `local`; in `staging` und `production` steht ein Wert nur mit Beleg: entweder als
 * **Startwert** (Claudios Richtwert aus Stage-Läufen, `start: …`) bis zum Messtor der Etappe, oder als **gemessener Wert**
 * (`messung: …` mit Verweis auf das Messprotokoll). Ein Test hält das (`jobs-config.test.ts`): Das ist ein Test der
 * Entwicklung, kein Betriebs-Gate.
 *
 * 🔴 UNBEKANNT HEISST ALLEIN. Fehlt der Wert einer Jobart (kein Startwert, keine Messung), läuft sie allein: Parallelität 1,
 * keine Zulassung gegen andere Jobs. Die Queue rät nie.
 */

/** Ein Wert samt dem Beleg, woher er kommt. */
function evidenced<T extends TSchema>(value: T) {
    return Type.Object(
        {
            value,
            /** `start: <Quelle>` oder `messung: <Protokoll>`; Pflicht in `staging` und `production`. */
            evidence: Type.Optional(Type.String()),
            /** Wofür der Wert steht (Kennung des Registers). */
            note: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
    );
}

const PerKind = Type.Record(Type.String(), Type.Number({ minimum: 0 }));

export const JobsProfile = Type.Object(
    {
        $comment: Type.Optional(Type.String()),
        schemaVersion: Type.Literal(1),
        profile: Type.String(),
        values: Type.Object(
            {
                /** MS1: Takt des Lebenszeichens des Aufsehers, Sekunden. */
                heartbeatS: Type.Optional(evidenced(Type.Number({ minimum: 1 }))),
                /** MS2: Zeit ohne Lebenszeichen bis „hängt“ je Jobart, Sekunden; `default` gilt für jede andere Art. */
                leaseS: Type.Optional(evidenced(PerKind)),
                /**
                 * Lease eines aufgezeichneten Jobs (`recorded`), Sekunden. Ihn überwacht kein Aufseher (ein Skript meldet nur
                 * an Phasengrenzen), also muss sie länger sein als die längste Phase. Entwurf der Entwicklung, nicht aus dem
                 * Register: Claudio bestätigt sie im Messtor von Etappe 1.
                 */
                recordedLeaseS: Type.Optional(evidenced(PerKind)),
                /** MS3: gleichzeitige Jobs je Jobart. Fehlt eine Art, läuft sie allein. */
                maxConcurrent: Type.Optional(evidenced(PerKind)),
                /** MS3: Paare von Jobarten, die nie nebeneinander laufen (`import` neben `terrain_local`). */
                exclusivePairs: Type.Optional(evidenced(Type.Array(Type.Tuple([Type.String(), Type.String()])))),
                /** MS4: Threads aller laufenden Jobs zusammen. */
                cpuBudgetThreads: Type.Optional(evidenced(Type.Integer({ minimum: 1 }))),
                /** Threads je Jobart (fehlt: unbekannt, die Art läuft allein). */
                threads: Type.Optional(evidenced(PerKind)),
                /** MS5: erwartete Spitze RSS je Speicherschlüssel (MB). */
                memExpectedMb: Type.Optional(evidenced(PerKind)),
                /** MS6: Summe der Erwartungen aller Jobs zusammen (MB). */
                memTotalBudgetMb: Type.Optional(evidenced(Type.Number({ minimum: 1 }))),
                /** MS7: Mindest-`MemAvailable` nach einer Zulassung (MB). */
                memAvailFloorMb: Type.Optional(evidenced(Type.Number({ minimum: 0 }))),
                /** MS7 für leichte Arten neben einem Schweren (WI-0283); fehlt der Wert, gilt `memAvailFloorMb`. */
                memAvailFloorLightMb: Type.Optional(evidenced(Type.Number({ minimum: 0 }))),
                /** Q3: solange die Marke `rollout` aktiv ist, nur Jobs bis hierhin (MB). */
                rolloutMaxJobMb: Type.Optional(evidenced(Type.Number({ minimum: 0 }))),
                /** MS8: Meldegrenzen je Speicherschlüssel (MB): nur melden, nie anhalten. */
                memReportWarnMb: Type.Optional(evidenced(PerKind)),
                /** MS9: Was während eines Auftrags bis hierhin aus dem Swap eingelagert wird, ist Rauschen (MB); darüber der Befund `swap_in_use`. */
                swapNoiseMb: Type.Optional(evidenced(Type.Number({ minimum: 0 }))),
                /** MS9: Eingelagertes je Laufminute bis hierhin ist Grundrauschen des Hosts (`pswpin` zählt den ganzen Host). */
                swapInRateMbPerMin: Type.Optional(evidenced(Type.Number({ minimum: 0 }))),
                /** MS9: eine eigene Rate je Jobart, die den Host regelmäßig in den Swap treibt (der Rollout: Bauen und Wechsel). */
                swapInRateMbPerMinByKind: Type.Optional(evidenced(PerKind)),
                /** MS10: Startwert der Wartezeit-Schätzung je Speicherschlüssel, Sekunden. */
                expectedDurationS: Type.Optional(evidenced(PerKind)),
                /** MS10: ab so vielen Läufen zählt die Historie statt des Startwerts. */
                historyMinRuns: Type.Optional(evidenced(Type.Integer({ minimum: 1 }))),
                /** MS12: wie lange der alte Slot einen Job weiterlaufen lässt, Sekunden. */
                drainMaxS: Type.Optional(evidenced(Type.Number({ minimum: 0 }))),
                /** MS14: Verbindungen von `/ws` je Instanz; `null` = noch nicht gemessen, unbegrenzt. */
                wsMaxConnections: Type.Optional(evidenced(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]))),
                /** MS15: Aufbewahrung terminaler Jobs und ihrer Ereignisse. */
                retention: Type.Optional(
                    evidenced(
                        Type.Object(
                            {
                                keepDays: Type.Integer({ minimum: 1 }),
                                keepRuns: Type.Integer({ minimum: 1 }),
                                eventKeepDays: Type.Integer({ minimum: 1 }),
                            },
                            { additionalProperties: false },
                        ),
                    ),
                ),
                /** MS19: Ziel der API unter Jobs (Millisekunden): das Messwerkzeug vergleicht dagegen, die Queue nicht. */
                apiLatencyTargetMs: Type.Optional(
                    evidenced(
                        Type.Object(
                            { p95: Type.Number({ minimum: 1 }), p99: Type.Number({ minimum: 1 }) },
                            { additionalProperties: false },
                        ),
                    ),
                ),
                /** MS20: Verbindungen von Worker und Job-Prozessen zusammen (Limit der Jobs-Rolle). */
                dbConnectionBudget: Type.Optional(evidenced(Type.Integer({ minimum: 1 }))),
                /** Takt des Planers, Sekunden (Entwurf der Entwicklung). */
                tickS: Type.Optional(evidenced(Type.Number({ minimum: 0.1 }))),
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export type JobsProfile = Static<typeof JobsProfile>;

/** Der Speicherschlüssel eines Jobs: die Zeile in `memExpectedMb`, `memReportWarnMb` und `expectedDurationS`. */
export type MemoryKey = string;

/** Alle Variablen, aufgelöst. `null` heißt: unbekannt, die Jobart läuft allein. */
export interface JobsConfig {
    profile: string;
    heartbeatS: number;
    leaseS: Readonly<Record<string, number>>;
    recordedLeaseS: Readonly<Record<string, number>>;
    /** Je Jobart; fehlt sie: unbekannt, allein. */
    maxConcurrent: Readonly<Record<string, number>>;
    exclusivePairs: readonly (readonly [string, string])[];
    cpuBudgetThreads: number | null;
    threads: Readonly<Record<string, number>>;
    memExpectedMb: Readonly<Record<string, number>>;
    memTotalBudgetMb: number | null;
    memAvailFloorMb: number | null;
    memAvailFloorLightMb: number | null;
    rolloutMaxJobMb: number | null;
    memReportWarnMb: Readonly<Record<string, number>>;
    swapNoiseMb: number;
    swapInRateMbPerMin: number;
    swapInRateMbPerMinByKind: Readonly<Record<string, number>>;
    expectedDurationS: Readonly<Record<string, number>>;
    historyMinRuns: number;
    drainMaxS: number;
    wsMaxConnections: number | null;
    retention: { keepDays: number; keepRuns: number; eventKeepDays: number };
    apiLatencyTargetMs: { p95: number; p99: number } | null;
    dbConnectionBudget: number | null;
    tickS: number;
}

/**
 * Der Rückfall für ein Profil ohne Datei (etwa `production`, solange nichts gemessen ist): nur Entwurfswerte, keine
 * Rechnerwerte. Jede Jobart läuft dann allein.
 */
export const UNKNOWN_JOBS_CONFIG: Omit<JobsConfig, "profile"> = {
    heartbeatS: 10,
    leaseS: { default: 60 },
    recordedLeaseS: { default: 900 },
    maxConcurrent: {},
    exclusivePairs: [],
    cpuBudgetThreads: null,
    threads: {},
    memExpectedMb: {},
    memTotalBudgetMb: null,
    memAvailFloorMb: null,
    memAvailFloorLightMb: null,
    rolloutMaxJobMb: null,
    memReportWarnMb: {},
    swapNoiseMb: 64,
    swapInRateMbPerMin: 21,
    swapInRateMbPerMinByKind: {},
    expectedDurationS: {},
    historyMinRuns: 5,
    drainMaxS: 420,
    wsMaxConnections: null,
    retention: { keepDays: 30, keepRuns: 200, eventKeepDays: 14 },
    apiLatencyTargetMs: null,
    dbConnectionBudget: null,
    tickS: 2,
};

/**
 * Die Rate je Laufminute, über der ein Lauf dieser Art den Befund `swap_in_use` trägt: die eigene der Art, sonst die des Hosts
 * (Claudio 2026-10-19: Ein Rollout lagert auf 8 GB auch ohne Prüflauf daneben bis 170 MB je Minute ein, Production merkt nichts).
 */
export function swapRateFor(
    config: Pick<JobsConfig, "swapInRateMbPerMin" | "swapInRateMbPerMinByKind">,
    kind: string,
): number {
    return config.swapInRateMbPerMinByKind[kind] ?? config.swapInRateMbPerMin;
}

/** Löst ein Profil auf: jeder Wert aus der Datei, sonst der Rückfall. */
export function resolveJobsConfig(profile: JobsProfile | undefined, name: string): JobsConfig {
    const v = profile?.values ?? {};
    const base = UNKNOWN_JOBS_CONFIG;
    return {
        profile: name,
        heartbeatS: v.heartbeatS?.value ?? base.heartbeatS,
        leaseS: v.leaseS?.value ?? base.leaseS,
        recordedLeaseS: v.recordedLeaseS?.value ?? base.recordedLeaseS,
        maxConcurrent: v.maxConcurrent?.value ?? base.maxConcurrent,
        exclusivePairs: v.exclusivePairs?.value ?? base.exclusivePairs,
        cpuBudgetThreads: v.cpuBudgetThreads?.value ?? base.cpuBudgetThreads,
        threads: v.threads?.value ?? base.threads,
        memExpectedMb: v.memExpectedMb?.value ?? base.memExpectedMb,
        memTotalBudgetMb: v.memTotalBudgetMb?.value ?? base.memTotalBudgetMb,
        memAvailFloorMb: v.memAvailFloorMb?.value ?? base.memAvailFloorMb,
        memAvailFloorLightMb: v.memAvailFloorLightMb?.value ?? base.memAvailFloorLightMb,
        rolloutMaxJobMb: v.rolloutMaxJobMb?.value ?? base.rolloutMaxJobMb,
        memReportWarnMb: v.memReportWarnMb?.value ?? base.memReportWarnMb,
        swapNoiseMb: v.swapNoiseMb?.value ?? base.swapNoiseMb,
        swapInRateMbPerMin: v.swapInRateMbPerMin?.value ?? base.swapInRateMbPerMin,
        swapInRateMbPerMinByKind: v.swapInRateMbPerMinByKind?.value ?? base.swapInRateMbPerMinByKind,
        expectedDurationS: v.expectedDurationS?.value ?? base.expectedDurationS,
        historyMinRuns: v.historyMinRuns?.value ?? base.historyMinRuns,
        drainMaxS: v.drainMaxS?.value ?? base.drainMaxS,
        wsMaxConnections: v.wsMaxConnections === undefined ? base.wsMaxConnections : v.wsMaxConnections.value,
        retention: v.retention?.value ?? base.retention,
        apiLatencyTargetMs: v.apiLatencyTargetMs?.value ?? base.apiLatencyTargetMs,
        dbConnectionBudget: v.dbConnectionBudget?.value ?? base.dbConnectionBudget,
        tickS: v.tickS?.value ?? base.tickS,
    };
}

/** Die Lease eines Jobs der Art `kind`, Sekunden. */
export function leaseSecondsFor(config: JobsConfig, kind: string, recorded: boolean): number {
    const table = recorded ? config.recordedLeaseS : config.leaseS;
    return table[kind] ?? table["default"] ?? (recorded ? 900 : 60);
}
