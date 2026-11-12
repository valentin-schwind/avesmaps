import { afterEach, describe, expect, it } from "vitest";
import type { JobSummary, QueueEntry } from "@avesmaps3d/shared";
import { locale, t } from "../src/i18n/i18n.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { dataLabel, formatDuration, formatMb, secondsSince, secondsUntil } from "../src/status/format.ts";
import {
    estimateText,
    findingTexts,
    isRunning,
    metaParts,
    progressPercent,
    reasonText,
    pauseSatz,
    stalledText,
    stateWord,
    waitText,
    zeitlicheFolge,
} from "../src/status/job-view.ts";

/**
 * Die Sätze der Statusseite (JOBS-0001 5.2, 5.3): Zustand als Wort, Wartegründe, geschätzte Zeit (nie eine geratene Zahl), hängende
 * Jobs, Fehler im Klartext, Befunde. Alles kommt aus den Sprachtafeln, in beiden Sprachen.
 */

afterEach(() => {
    locale.value = "de";
});

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const ago = (seconds: number): string => new Date(NOW - seconds * 1000).toISOString();
const inSeconds = (seconds: number): string => new Date(NOW + seconds * 1000).toISOString();

function job(extra: Partial<JobSummary> = {}): JobSummary {
    return {
        id: "11111111-2222-4333-8444-555555555555",
        kind: "probe",
        origin: "queued",
        state: "QUEUED",
        stalled: false,
        label: null,
        waitReason: null,
        phase: null,
        progress: null,
        mapDomainId: "aventuria",
        scope: { kind: "tiles", tiles: [] },
        priority: 50,
        queuedAt: ago(60),
        notBefore: null,
        startedAt: null,
        finishedAt: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
        attempt: 0,
        maxAttempts: 3,
        wallMs: null,
        rssPeakMb: null,
        memExpectedMb: null,
        swapSeenMb: null,
        cancelRequested: false,
        cancelReason: null,
        errorCode: null,
        errorSummary: null,
        findings: [],
        coalescedCount: 0,
        dependsOn: [],
        result: null,
        ...extra,
    };
}

function entry(extra: Partial<QueueEntry["estimate"]> = {}, job_: Partial<JobSummary> = {}): QueueEntry {
    return {
        ...job(job_),
        position: 1,
        estimate: { startAt: null, finishAt: null, durationP50S: null, durationP95S: null, basis: "unknown", ...extra },
    };
}

describe("Format", () => {
    it("Dauer: Sekunden, Minuten, Stunden; nie negativ", () => {
        expect(formatDuration(0)).toBe("0 s");
        expect(formatDuration(45.4)).toBe("45 s");
        expect(formatDuration(60)).toBe("1 min");
        expect(formatDuration(312)).toBe("5 min 12 s");
        expect(formatDuration(7380)).toBe("2 h 03 min");
        expect(formatDuration(-5)).toBe("0 s");
    });

    it("Speicher mit Tausenderpunkt, unbekannt als Wort; Zahlen in der Sprache der Seite", () => {
        expect(formatMb(1250)).toBe("1.250 MB");
        expect(formatMb(null)).toBe("unbekannt");
        locale.value = "en";
        expect(formatMb(1250)).toBe("1,250 MB");
        expect(formatMb(undefined)).toBe("unknown");
    });

    it("Zeiten in Serverzeit: wie lange her, wie lange noch; ohne Zeitpunkt oder bei Unsinn null", () => {
        expect(secondsSince(ago(90), NOW)).toBe(90);
        expect(secondsSince(inSeconds(10), NOW)).toBe(0);
        expect(secondsSince(null, NOW)).toBeNull();
        expect(secondsSince("kein datum", NOW)).toBeNull();
        expect(secondsUntil(inSeconds(30), NOW)).toBe(30);
        expect(secondsUntil(ago(30), NOW)).toBe(0);
        expect(secondsUntil(null, NOW)).toBeNull();
    });

    it("Texte aus Daten: bekannte Schlüssel übersetzt, unbekannte als Rohwert", () => {
        expect(dataLabel("status.kind", "import")).toBe("Import");
        expect(dataLabel("status.kind", "jobart_von_morgen")).toBe("jobart_von_morgen");
        locale.value = "en";
        expect(dataLabel("status.wait", "waits_memory")).toBe("Waiting for memory.");
    });
});

describe("Fertig und gescheitert in einer zeitlichen Folge", () => {
    const fertig = (id: string, vor: number) => job({ id, state: "SUCCEEDED", finishedAt: ago(vor) });
    const gescheitert = (id: string, vor: number) => job({ id, state: "FAILED", finishedAt: ago(vor) });

    it("🔴 ungekappt bleibt alles, auch ein Fehlschlag, der älter ist als alles Fertige (Sammellauf 14fb1eab)", () => {
        const folge = zeitlicheFolge([fertig("c1", 840), fertig("c2", 3000)], [gescheitert("d1", 5400)]);
        expect(folge.map((eintrag) => eintrag.id)).toEqual(["c1", "c2", "d1"]);
    });

    it("hinter einer gekappten Liste fällt weg, was älter ist als ihr ältester Eintrag: dort könnte etwas fehlen", () => {
        const fertige = [fertig("c1", 100), fertig("c2", 200), fertig("c3", 300)];
        const folge = zeitlicheFolge(fertige, [gescheitert("d1", 150), gescheitert("d2", 400)], 3);
        expect(folge.map((eintrag) => eintrag.id)).toEqual(["c1", "d1", "c2", "c3"]);
    });
});

describe("Zustand als Wort", () => {
    it("„hängt“ ist abgeleitet: RUNNING mit abgelaufener Lease", () => {
        expect(stateWord(job({ state: "RUNNING", stalled: false }))).toBe("RUNNING");
        expect(stateWord(job({ state: "RUNNING", stalled: true }))).toBe("stalled");
        expect(isRunning(job({ state: "RUNNING", stalled: true }))).toBe(false);
        expect(isRunning(job({ state: "RUNNING" }))).toBe(true);
        expect(t("status.state.stalled")).toBe("hängt");
        expect(t("status.state.RUNNING")).toBe("läuft");
    });
});

describe("Läuft", () => {
    it("Zug in Phase I11: Herkunft, Phase, Dauer, Spitze gegen Erwartung, Lebenszeichen", () => {
        const running = job({
            kind: "import",
            origin: "recorded",
            state: "RUNNING",
            phase: "I11",
            startedAt: ago(312),
            heartbeatAt: ago(4),
            rssPeakMb: 1250,
            memExpectedMb: 1400,
            attempt: 1,
        });
        expect(metaParts(running, NOW)).toEqual([
            "aufgezeichnet",
            "Phase I11",
            "seit 5 min 12 s",
            "Spitze 1.250 MB, erwartet 1.400 MB",
            "Lebenszeichen vor 4 s",
        ]);
    });

    it("ein zweiter Lauf zeigt „Versuch 2 von 3“", () => {
        expect(metaParts(job({ state: "RUNNING", startedAt: ago(5), attempt: 2 }), NOW)).toContain("Versuch 2 von 3");
    });

    it("Fortschritt in Prozent, begrenzt", () => {
        expect(progressPercent(job({ progress: 0.426 }))).toBe(43);
        expect(progressPercent(job({ progress: 7 }))).toBe(100);
        expect(progressPercent(job({ progress: null }))).toBeNull();
    });

    it("dasselbe auf Englisch", () => {
        locale.value = "en";
        const running = job({
            kind: "import",
            origin: "recorded",
            state: "RUNNING",
            phase: "I11",
            startedAt: ago(312),
            rssPeakMb: 1250,
            memExpectedMb: 1400,
        });
        expect(metaParts(running, NOW)).toEqual([
            "recorded",
            "phase I11",
            "for 5 min 12 s",
            "peak 1,250 MB, expected 1,400 MB",
        ]);
    });
});

describe("Wartet: Grund und geschätzte Zeit", () => {
    it("jeder Grund hat seinen Satz; ohne Grund wartet er auf den Takt des Planers", () => {
        for (const reason of [
            "waits_dependency",
            "waits_area",
            "waits_memory",
            "waits_slot",
            "waits_domain_lock",
            "waits_rollout",
        ]) {
            expect(waitText(job({ waitReason: reason }), NOW), reason).not.toBe(reason);
        }
        expect(waitText(job({ waitReason: "waits_memory" }), NOW)).toBe("Wartet auf Speicher.");
        expect(waitText(job({ waitReason: null }), NOW)).toBe("Wartet auf den nächsten Takt des Planers.");
        expect(waitText(job({ state: "RUNNING" }), NOW)).toBeNull();
    });

    it("Entprellung nennt die Restzeit", () => {
        expect(waitText(job({ waitReason: "debouncing", notBefore: inSeconds(25) }), NOW)).toBe(
            "Wird gesammelt, noch 25 s.",
        );
        expect(waitText(job({ waitReason: "debouncing", notBefore: null }), NOW)).toBe(
            "Wird gesammelt, noch unbekannt.",
        );
    });

    it("🔴 keine bekannte Dauer: „Start unbekannt“ und „Dauer unbekannt“, nie eine geratene Zahl", () => {
        expect(estimateText(entry(), NOW)).toBe(
            "Start unbekannt · Dauer unbekannt, es liegen noch zu wenige Läufe vor",
        );
    });

    it("mit Startwert: Start in etwa …, Dauer, Herkunft der Zahl", () => {
        expect(
            estimateText(
                entry({ startAt: inSeconds(720), durationP50S: 900, durationP95S: 900, basis: "startwert" }),
                NOW,
            ),
        ).toBe("Start in etwa 12 min · Dauer etwa 15 min · nach dem Startwert");
    });

    it("nach den letzten Läufen: Spanne von p50 bis p95", () => {
        expect(
            estimateText(entry({ startAt: inSeconds(30), durationP50S: 90, durationP95S: 150, basis: "history" }), NOW),
        ).toBe("Start in etwa 30 s · Dauer 1 min 30 s bis 2 min 30 s · nach den letzten Läufen");
        locale.value = "en";
        expect(
            estimateText(entry({ startAt: inSeconds(30), durationP50S: 90, durationP95S: 150, basis: "history" }), NOW),
        ).toBe("starts in about 30 s · takes 1 min 30 s to 2 min 30 s · based on the last runs");
    });
});

describe("Die Auslieferung auf die Stage (WI-0143)", () => {
    const auslieferung = (extra: Partial<JobSummary> = {}): JobSummary =>
        job({
            kind: "stage_rollout",
            origin: "recorded",
            state: "RUNNING",
            label: "3c75c88d · Neigung bis 85 Grad · Nur diese anzeigen",
            startedAt: ago(1_380),
            heartbeatAt: ago(240),
            ...extra,
        });

    it("die Jobart und ihre Phasen haben Namen, in beiden Sprachen", () => {
        for (const key of [
            "status.kind.stage_rollout",
            "status.phase.stage_rollout.wartet",
            "status.phase.stage_rollout.bauen",
            "status.phase.stage_rollout.migrieren",
            "status.phase.stage_rollout.umschalten",
            "status.phase.stage_rollout.proben",
        ] as const) {
            expect(de[key], key).toBeTruthy();
            expect(en[key], key).toBeTruthy();
        }
        expect(dataLabel("status.kind", "stage_rollout")).toBe("Auslieferung auf die Stage");
    });

    it("die Prüfung nach dem Push und ihre Schritte haben Namen, in beiden Sprachen", () => {
        for (const key of [
            "status.kind.pruefung_nach_push",
            "status.phase.pruefung_nach_push.bauen",
            "status.phase.pruefung_nach_push.format",
            "status.phase.pruefung_nach_push.lint",
            "status.phase.pruefung_nach_push.typecheck",
            "status.phase.pruefung_nach_push.tests",
        ] as const) {
            expect(de[key], key).toBeTruthy();
            expect(en[key], key).toBeTruthy();
        }
        expect(dataLabel("status.kind", "pruefung_nach_push")).toBe("Prüflauf nach dem Push");
    });

    it("eine benannte Phase steht als Satzteil in der Zeile, eine unbenannte als „Phase …“", () => {
        expect(metaParts(auslieferung({ phase: "bauen" }), NOW)).toEqual([
            "aufgezeichnet",
            "baut das Release",
            "seit 23 min",
            "Lebenszeichen vor 4 min",
        ]);
        // Die Phasen des Imports heißen I1 bis I28 und bleiben, was sie sind.
        expect(metaParts(job({ kind: "import", state: "RUNNING", phase: "I11", startedAt: ago(5) }), NOW)).toContain(
            "Phase I11",
        );
    });

    it("🔴 ein laufender Lauf nennt seinen Wartegrund im Satz, auch als Freitext aus dem Betrieb", () => {
        expect(waitText(auslieferung({ phase: "wartet", waitReason: "hinter Gelände voll: Fassung 17" }), NOW)).toBe(
            "Wartet hinter Gelände voll: Fassung 17.",
        );
        locale.value = "en";
        expect(waitText(auslieferung({ phase: "wartet", waitReason: "hinter 2 Job(s)" }), NOW)).toBe(
            "Waiting hinter 2 Job(s).",
        );
    });

    it("ohne Wartegrund sagt ein laufender Lauf nichts (nur ein wartender nennt den Takt des Planers)", () => {
        expect(waitText(auslieferung({ phase: "bauen" }), NOW)).toBeNull();
        expect(waitText(job({ state: "SUCCEEDED", waitReason: "irgendwas" }), NOW)).toBeNull();
    });
});

describe("Hängt", () => {
    it("🔴 abgelaufene Lease, Versuche übrig: wird erneut eingereiht (Versuch n+1)", () => {
        const stalled = job({ state: "RUNNING", stalled: true, leaseExpiresAt: ago(75), attempt: 1 });
        expect(stalledText(stalled, NOW)).toBe(
            "Die Lease ist seit 1 min 15 s abgelaufen; der Job wird erneut eingereiht (Versuch 2 von 3).",
        );
    });

    it("alle Versuche aufgebraucht", () => {
        const stalled = job({ state: "RUNNING", stalled: true, leaseExpiresAt: ago(10), attempt: 3 });
        expect(stalledText(stalled, NOW)).toBe(
            "Die Lease ist seit 10 s abgelaufen und die Versuche sind aufgebraucht.",
        );
    });

    it("ein aufgezeichneter Ablauf kann nicht neu gestartet werden: die Meldung blieb aus", () => {
        const stalled = job({ state: "RUNNING", stalled: true, origin: "recorded", leaseExpiresAt: ago(2000) });
        expect(stalledText(stalled, NOW)).toBe("Die Meldung des Ablaufs ist seit 33 min 20 s ausgeblieben.");
    });

    it("ein Job, der nicht hängt, hat keinen Satz", () => {
        expect(stalledText(job({ state: "RUNNING" }), NOW)).toBeNull();
    });
});

describe("Fehler, Abbruch, Befunde", () => {
    it("fehlgeschlagen: Code und Klartext; ohne Klartext nur der Code", () => {
        expect(
            reasonText(
                job({ state: "FAILED", errorCode: "process_died", errorSummary: "Der Job-Prozess endete unerwartet." }),
            ),
        ).toBe("process_died: Der Job-Prozess endete unerwartet.");
        expect(reasonText(job({ state: "FAILED", errorCode: "recorder_lost" }))).toBe("recorder_lost");
        expect(reasonText(job({ state: "FAILED" }))).toBe("unbekannt");
    });

    it("abgebrochen: der Grund im Klartext, auch wenn ein Vorgänger gescheitert ist", () => {
        expect(reasonText(job({ state: "CANCELLED", cancelReason: "dependency_failed" }))).toBe(
            "Abgebrochen, weil ein Vorgänger gescheitert ist.",
        );
        expect(reasonText(job({ state: "CANCELLED", cancelReason: "operator" }))).toBe("Abgebrochen vom Betreiber.");
        // 🔴 WI-0141: Der Abholer schreibt bei `skipped` seinen Grund in `error_summary`. „skipped" allein sagt niemandem,
        // warum Production unverändert blieb (Claudio 2026-10-13); die Marke bleibt davor, der Satz kommt dahinter.
        expect(
            reasonText(
                job({
                    state: "CANCELLED",
                    cancelReason: "skipped",
                    errorSummary: "Landschaften ist noch nicht freigeschaltet",
                }),
            ),
        ).toMatch(/: Landschaften ist noch nicht freigeschaltet$/u);
        locale.value = "en";
        expect(reasonText(job({ state: "CANCELLED", cancelReason: "dependency_cancelled" }))).toBe(
            "Cancelled because a predecessor was cancelled.",
        );
    });

    it("🔴 verworfen, weil überholt: Marke und der Grund des Betreibers (WI-0154)", () => {
        // `job_sync_discard` schreibt `superseded` und den Grund nach `error_summary` — der Fall aus Production
        // (drei Aufträge vom 2026-10-13, überholt von der Wahl 18). Beide Teile müssen dastehen: Die Marke allein
        // sagt nicht, WAS überholt hat, der Grund allein nicht, dass nichts gelaufen ist.
        expect(
            reasonText(job({ state: "CANCELLED", cancelReason: "superseded", errorSummary: "durch Wahl 18 überholt" })),
        ).toBe("Abgebrochen, weil ein neuerer Stand ihn überholt hat: durch Wahl 18 überholt");
        expect(reasonText(job({ state: "CANCELLED", cancelReason: "superseded" }))).toBe(
            "Abgebrochen, weil ein neuerer Stand ihn überholt hat.",
        );
        locale.value = "en";
        expect(reasonText(job({ state: "CANCELLED", cancelReason: "superseded" }))).toBe(
            "Cancelled because a newer state overtook it.",
        );
    });

    it("erneut eingereiht nach einem Fehler: der letzte Fehler und der nächste Versuch", () => {
        expect(reasonText(job({ state: "QUEUED", errorCode: "process_died", attempt: 1 }))).toBe(
            "process_died: erneut eingereiht, Versuch 2 von 3.",
        );
        expect(reasonText(job({ state: "QUEUED", errorCode: null, attempt: 0 }))).toBeNull();
    });

    it("🔴 Befunde melden, sie halten nie an: ein Satz je Befund mit Zahlen", () => {
        const findings = [
            { code: "swap_in_use", detail: "Swap 24 MB benutzt (Rauschen des Kernels bis 16 MB)" },
            {
                code: "budget_exceeded",
                detail: "Spitze RSS 1512 MB über der Erwartung 1400 MB (gemeldet, nicht beendet)",
            },
            { code: "etwas_neues", detail: "Detail" },
        ];
        expect(findingTexts(job({ findings }))).toEqual([
            "Swap in Benutzung: Swap 24 MB benutzt (Rauschen des Kernels bis 16 MB)",
            "Speicher über der Erwartung: Spitze RSS 1512 MB über der Erwartung 1400 MB (gemeldet, nicht beendet)",
            "etwas_neues: Detail",
        ]);
    });
});

describe("Sprachtafeln der Statusseite", () => {
    it("🔴 jeder Platzhalter des Deutschen steht auch im Englischen, und kein Text ist leer", () => {
        const holes = (text: string): string[] =>
            [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
        const keys = Object.keys(de).filter((key) => key.startsWith("status.")) as (keyof typeof de)[];
        expect(keys.length).toBeGreaterThan(100);
        for (const key of keys) {
            expect(holes(en[key]), key).toEqual(holes(de[key]));
            expect(en[key].trim(), key).not.toBe("");
        }
    });

    it("jede Jobart, jeder Wartegrund, Abbruchgrund und Befund der Queue hat einen Text", () => {
        const needed = [
            "status.kind.probe",
            "status.kind.import",
            "status.kind.rollout",
            "status.wait.waits_dependency",
            "status.wait.waits_area",
            "status.wait.waits_memory",
            "status.wait.waits_slot",
            "status.wait.waits_domain_lock",
            "status.wait.waits_rollout",
            "status.wait.waits_system_lock",
            "status.wait.waits_pickup",
            "status.wait.waits_queue_paused",
            "status.wait.waits_running_kind",
            "status.wait.waits_no_worker",
            "status.wait.debouncing",
            "status.paused.lead",
            "status.paused.since",
            "status.paused.sinceUnknown",
            "status.paused.by",
            "status.paused.reason",
            "status.cancel.operator",
            "status.cancel.owner",
            "status.cancel.dependency_failed",
            "status.cancel.dependency_cancelled",
            "status.cancel.superseded",
            "status.finding.swap_in_use",
            "status.finding.budget_exceeded",
            "status.finding.selfreport_deviation",
            "status.finding.observed_false",
            "status.finding.recorder_lost",
            "status.state.QUEUED",
            "status.state.RUNNING",
            "status.state.SUCCEEDED",
            "status.state.FAILED",
            "status.state.CANCELLED",
            "status.state.stalled",
            "status.estimate.basis.history",
            "status.estimate.basis.startwert",
            "status.estimate.basis.unknown",
        ];
        for (const key of needed) expect(Object.hasOwn(de, key), key).toBe(true);
    });
});

describe("Die Pause der Warteschlange oben im Reiter (WI-0160)", () => {
    afterEach(() => {
        locale.value = "de";
    });

    it("🔴 pausiert: Marke, Dauer, Person und Grund in einem Satz", () => {
        const pause = pauseSatz(
            { paused: true, since: ago(4 * 60), by: "Rondrikan", reason: "Datenbank wird gesichert" },
            NOW,
        );
        expect(pause?.lead).toBe("Die Warteschlange ist pausiert.");
        expect(pause?.satz).toBe("Pausiert seit 4 min · von Rondrikan · „Datenbank wird gesichert“");
    });

    it("in der eigenen Sicht fehlen Person und Grund; die Dauer bleibt — sie ist die Antwort auf „warum läuft nichts“", () => {
        expect(pauseSatz({ paused: true, since: ago(90), by: null, reason: null }, NOW)?.satz).toBe(
            "Pausiert seit 1 min 30 s",
        );
        // Ohne Zeitpunkt wird keine Dauer behauptet.
        expect(pauseSatz({ paused: true, since: null, by: null, reason: null }, NOW)?.satz).toBe("Pausiert");
    });

    it("läuft die Warteschlange, steht oben nichts", () => {
        expect(pauseSatz({ paused: false, since: null, by: null, reason: null }, NOW)).toBeNull();
    });
});
