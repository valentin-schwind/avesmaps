import { describe, expect, it } from "vitest";
import { getJobsConfig, type WarteschlangeUmgebung } from "@avesmaps3d/shared";
import {
    LEICHTE_ARTEN,
    istSchwer,
    plane,
    type Gestartet,
    type PauseAnweisung,
    type PlanEingabe,
    type QuelleLage,
} from "../src/jobs/dirigent/plan.ts";
import { abgleicheModes, pickupJobKinds, skippedJobKinds } from "../src/abgleiche/ausfuehrung.ts";
import type { JobRow } from "../src/jobs/rows.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Planung des Dirigenten (WI-0163 §1, §5.3): beide Schlangen in EINE Entscheidung. Reine Funktion, also benannte Fälle ohne
 * Datenbank: Reihenfolge über Umgebungen, ein Schwerer zur Zeit, Bereiche je Umgebung, die jüngste Pause, Halt je Umgebung,
 * Antwort des Ausführers, gestartet-aber-noch-wartend.
 */

const NOW = 1_800_000_000_000;
const PERSON = "6f1c1f9e-2b8a-4c55-9a51-3e0d6c7b8a90";

/** Ein Profil, in dem alles bekannt ist: Parallelität, Threads und Speicher ließen überall zwei zu. */
const config = testJobsConfig({
    maxConcurrent: {
        value: { probe: 2, import: 1, terrain_full: 2, display_heights: 2, terrain_local: 2, media_derive: 2 },
    },
    threads: { value: { probe: 1, terrain_full: 1, display_heights: 1, terrain_local: 1, media_derive: 1 } },
    memExpectedMb: {
        value: {
            probe_base: 40,
            import: 300,
            terrain_full: 300,
            display_heights: 200,
            media_derive: 100,
        },
    },
    cpuBudgetThreads: { value: 8 },
    memTotalBudgetMb: { value: 4000 },
    memAvailFloorMb: { value: 500 },
});

let naechste = 1;
function zeile(partial: Partial<JobRow> & { kind: string }): JobRow {
    const id = partial.id ?? naechste++;
    const queuedAt = partial.queuedAt ?? new Date(NOW - 600_000 + id * 1000);
    return {
        id,
        publicId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
        kindVersion: 1,
        mapDomainId: "aventuria",
        origin: "queued",
        actorRef: null,
        externalRef: null,
        label: null,
        inputRef: {},
        state: "QUEUED",
        waitReason: null,
        priority: 50,
        queuedAt,
        notBefore: null,
        firstRequestedAt: queuedAt,
        coalescedCount: 0,
        scopeKind: "tiles",
        scopeTiles: [],
        attempt: 0,
        leaseOwner: null,
        leaseNo: 0,
        leaseExpiresAt: null,
        heartbeatAt: null,
        phase: null,
        progress: null,
        cancelRequestedAt: null,
        cancelReason: null,
        startedAt: null,
        finishedAt: null,
        rssPeakMb: null,
        arrayBufferPeakMb: null,
        cpuMs: null,
        wallMs: null,
        swapSeenMb: null,
        memExpectedMb: null,
        phaseStats: {},
        findings: [],
        result: null,
        errorCode: null,
        errorSummary: null,
        dependsOn: [],
        ...partial,
    };
}

const laeuft = (partial: Partial<JobRow> & { kind: string }): JobRow =>
    zeile({
        state: "RUNNING",
        attempt: 1,
        startedAt: new Date(NOW - 30_000),
        leaseExpiresAt: new Date(NOW + 30_000),
        ...partial,
    });

function lage(umgebung: WarteschlangeUmgebung, partial: Partial<QuelleLage> = {}): QuelleLage {
    return {
        umgebung,
        erreichbar: true,
        planer: true,
        queued: [],
        running: [],
        offeneAbhaengigkeiten: new Set(),
        rssVerlauf: {},
        rolloutAktiv: false,
        editorHalt: false,
        pause: null,
        ...partial,
    };
}

function plan(quellen: QuelleLage[], extra: Partial<PlanEingabe> = {}): ReturnType<typeof plane> {
    return plane({ nowMs: NOW, config, memAvailableMb: 8000, quellen, gestartet: [], rueckstellungen: [], ...extra });
}

const gestartete = (result: ReturnType<typeof plane>): string[] =>
    result.starts.map((entry) => `${entry.umgebung}#${String(entry.id)}`);

const grund = (result: ReturnType<typeof plane>, umgebung: WarteschlangeUmgebung, id: number) =>
    result.reihe.find((entry) => entry.umgebung === umgebung && entry.job.id === id);

function anweisung(paused: boolean, changedAt: string): PauseAnweisung {
    return { paused, changedAt, since: changedAt, by: null, byLabel: "cli:test", reason: paused ? "Wartung" : null };
}

describe("Dirigent, Planung: eine Reihe für beide Umgebungen", () => {
    it("A1: zwei Umgebungen stehen in der Reihenfolge ihres Einreihens, je mit Umgebung und Platz", () => {
        // Kennungen sind nur mit der Umgebung eindeutig: dieselbe Nummer 7 in beiden.
        const stage = zeile({ id: 7, kind: "terrain_full", queuedAt: new Date(NOW - 10_000) });
        const production = zeile({ id: 7, kind: "terrain_full", queuedAt: new Date(NOW - 20_000) });
        const result = plan([lage("staging", { queued: [stage] }), lage("production", { queued: [production] })]);
        expect(result.reihe.map((entry) => [entry.umgebung, entry.job.id, entry.platz])).toEqual([
            ["production", 7, 1],
            ["staging", 7, 2],
        ]);
        expect(gestartete(result)).toEqual(["production#7"]);
        expect(grund(result, "production", 7)?.wartegrund).toBeNull();
        expect(grund(result, "staging", 7)?.wartegrund).toBe("waits_slot");
    });

    it("laufende stehen vor den wartenden, ohne Platz und ohne Grund", () => {
        const running = laeuft({ kind: "media_derive" });
        const waiting = zeile({ kind: "media_derive" });
        const result = plan([lage("staging", { running: [running] }), lage("production", { queued: [waiting] })]);
        expect(result.reihe.map((entry) => [entry.umgebung, entry.job.state, entry.platz, entry.wartegrund])).toEqual([
            ["staging", "RUNNING", null, null],
            ["production", "QUEUED", 1, null],
        ]);
    });
});

describe("Dirigent, Planung: ein Schwerer zur Zeit (A2)", () => {
    it("🔴 nie zwei schwere zugleich, auch nicht aus verschiedenen Umgebungen", () => {
        const running = laeuft({ kind: "display_heights" });
        const waiting = zeile({ kind: "terrain_full" });
        const result = plan([lage("staging", { running: [running] }), lage("production", { queued: [waiting] })]);
        expect(result.starts).toEqual([]);
        expect(grund(result, "production", waiting.id)?.wartegrund).toBe("waits_slot");
    });

    it("ein leichter läuft neben einem schweren, auch aus der anderen Umgebung", () => {
        const running = laeuft({ kind: "terrain_full" });
        const leicht = zeile({ kind: "media_derive" });
        const schwer = zeile({ kind: "terrain_local" });
        const result = plan([
            lage("staging", { running: [running] }),
            lage("production", { queued: [schwer, leicht] }),
        ]);
        expect(gestartete(result)).toEqual([`production#${String(leicht.id)}`]);
        expect(grund(result, "production", schwer.id)?.wartegrund).toBe("waits_slot");
        expect(grund(result, "production", leicht.id)?.schwer).toBe(false);
    });

    it("mit dem echten Profil der Stage läuft eine Meldung neben einem laufenden Legacy-Zug (Claudios Messwerte, 09b50deb)", () => {
        // Ohne Werte für die leichten Arten hiesse „unbekannt“ allein, und „Kleine nebenher“ griffe nie (WI-0163 §6).
        const zug = laeuft({ kind: "legacy_zug", inputRef: { kategorie: "landschaften" } });
        const meldung = zeile({ kind: "benachrichtigung" });
        const result = plane({
            nowMs: NOW,
            config: getJobsConfig("staging"),
            memAvailableMb: 5000,
            quellen: [lage("production", { running: [zug] }), lage("staging", { queued: [meldung] })],
            gestartet: [],
            rueckstellungen: [],
        });
        expect(gestartete(result)).toEqual([`staging#${String(meldung.id)}`]);
    });

    it("mit dem echten Profil der Stage laufen die Folgen einer Wege-Operation neben einem Legacy-Zug (Claudio 2026-10-18, WI-0177)", () => {
        const zug = laeuft({ kind: "legacy_zug", inputRef: { kategorie: "landschaften" } });
        const namen = zeile({ kind: "path_label_runs" });
        const profil = zeile({ kind: "path_profile" });
        const eingabe = (queued: JobRow[], running: JobRow[]): Parameters<typeof plane>[0] => ({
            nowMs: NOW,
            config: getJobsConfig("staging"),
            memAvailableMb: 5000,
            quellen: [lage("production", { running }), lage("staging", { queued })],
            gestartet: [],
            rueckstellungen: [],
        });
        expect(gestartete(plane(eingabe([namen], [zug])))).toEqual([`staging#${String(namen.id)}`]);
        expect(gestartete(plane(eingabe([profil], [zug])))).toEqual([`staging#${String(profil.id)}`]);
        // Neben dem Gelände (drei Threads) trägt sie das CPU-Budget der Stage (4, Claudio 2026-10-19 Weg A); die zweite leichte Art
        // dahinter wartet auf einen Kern (3 + 1 + 1 > 4), nicht auf ihre Einstufung.
        const gelaende = laeuft({ kind: "terrain_local" });
        expect(gestartete(plane(eingabe([namen], [gelaende])))).toEqual([`staging#${String(namen.id)}`]);
        const beide = plane(eingabe([namen, profil], [gelaende]));
        expect(gestartete(beide)).toEqual([`staging#${String(namen.id)}`]);
        expect(grund(beide, "staging", profil.id)).toMatchObject({ schwer: false, wartegrund: "waits_slot" });
    });

    it("Gebiete und Wegnamen ohne Kartenfußabdruck laufen neben einem Gelände der Stage, warten hinter einem Zug (Hauptorchestrierung 2026-10-19, WI-0229)", () => {
        // Wie die Schreibnaht sie einreiht: Bereich `tiles` ohne Kacheln (`map-operation.ts`, `keiner`).
        const ableitung = zeile({ kind: "territory_derive", scopeKind: "tiles", scopeTiles: [] });
        const namen = zeile({ kind: "path_label_runs", scopeKind: "tiles", scopeTiles: [] });
        const eingabe = (queued: JobRow[], laufend: JobRow): Parameters<typeof plane>[0] => ({
            nowMs: NOW,
            config: getJobsConfig("staging"),
            memAvailableMb: 5000,
            quellen: [lage("staging", { queued, running: [laufend] })],
            gestartet: [],
            rueckstellungen: [],
        });
        // Neben dem Gelände im Umkreis derselben Domäne (Kachelbereich): Budget 4 (3 + 1) und Speicher 2000 (1850 + 150) tragen eine.
        const gelaende = laeuft({ kind: "terrain_local", scopeKind: "tiles", scopeTiles: [19, 20, 27, 28] });
        expect(gestartete(plane(eingabe([ableitung], gelaende)))).toEqual([`staging#${String(ableitung.id)}`]);
        expect(gestartete(plane(eingabe([namen], gelaende)))).toEqual([`staging#${String(namen.id)}`]);
        // 🔴 Stage 2026-10-19 (Job 1930): Früher eingereihte `land_smooth` und `label_runs` mit Bereich `domain` warten selbst auf das
        // Gelände; die Ableitung ohne Fußabdruck überholt sie und läuft, sie selbst warten weiter.
        const runden = zeile({ kind: "land_smooth", scopeKind: "domain", queuedAt: new Date(NOW - 900_000) });
        const beschriften = zeile({ kind: "label_runs", scopeKind: "domain", queuedAt: new Date(NOW - 899_000) });
        const stage = plane(eingabe([runden, beschriften, ableitung], gelaende));
        expect(gestartete(stage)).toEqual([`staging#${String(ableitung.id)}`]);
        for (const job of [runden, beschriften])
            expect(grund(stage, "staging", job.id), job.kind).toMatchObject({ wartegrund: "waits_area" });
        // Hinter einem Zug derselben Domäne (Bereich `domain`) warten beide: die Bereichssperre.
        const zug = laeuft({ kind: "legacy_zug", scopeKind: "domain", inputRef: { kategorie: "wege" } });
        for (const job of [ableitung, namen]) {
            const result = plane(eingabe([job], zug));
            expect(gestartete(result), job.kind).toEqual([]);
            expect(grund(result, "staging", job.id), job.kind).toMatchObject({
                schwer: false,
                wartegrund: "waits_area",
            });
        }
        // Die Kopie von Production und der volle Import schreiben die Gebietstafeln neu: nie daneben (`exclusivePairs`, `import` läuft allein).
        for (const kind of ["production_pull", "import"]) {
            const result = plane(eingabe([ableitung], laeuft({ kind, mapDomainId: "andere" })));
            expect(gestartete(result), kind).toEqual([]);
            expect(grund(result, "staging", ableitung.id), kind).toMatchObject({ wartegrund: "waits_slot" });
        }
    });

    describe("🔴 die Folgen einer Landschaft hängen nicht hinter der Geländekette (WI-0283)", () => {
        const profil = getJobsConfig("staging");
        const eingabe = (queued: JobRow[], running: JobRow[], memAvailableMb = 5000) => ({
            nowMs: NOW,
            config: profil,
            memAvailableMb,
            quellen: [lage("staging", { queued, running })],
            gestartet: [],
            rueckstellungen: [],
        });
        /** Wie in Production: Das Gelernte klemmt das Gelände auf das volle Budget. */
        const gelaende = () =>
            laeuft({ kind: "terrain_local", scopeKind: "tiles", scopeTiles: [19, 20, 27, 28], memExpectedMb: 2000 });

        it("Problemfall Job 2755: label_runs und land_smooth laufen neben dem Gelände, auch auf dessen Speicherspitze", () => {
            const runden = zeile({ kind: "land_smooth" });
            const beschriften = zeile({ kind: "label_runs", inputRef: { landscape: "x" } });
            // 1100 MB frei: über dem Boden der leichten (512), unter dem der schweren (1024).
            expect(gestartete(plane(eingabe([beschriften], [gelaende()], 1100)))).toEqual([
                `staging#${String(beschriften.id)}`,
            ]);
            // Beide zugleich: Das CPU-Budget (3 + 1 von 4) trägt einen, der andere folgt Sekunden später, nicht nach der Kette.
            const beide = plane(eingabe([runden, beschriften], [gelaende()], 1100));
            expect(gestartete(beide)).toEqual([`staging#${String(runden.id)}`]);
            expect(grund(beide, "staging", beschriften.id)).toMatchObject({ wartegrund: "waits_slot" });
        });

        it("neben den Anzeigehöhen ebenso, und ein Wartender blockiert den nächsten Geländelauf nicht", () => {
            const beschriften = zeile({ kind: "label_runs", inputRef: { landscape: "x" } });
            const hoehen = laeuft({ kind: "display_heights", scopeKind: "tiles", scopeTiles: [] });
            expect(gestartete(plane(eingabe([beschriften], [hoehen])))).toEqual([`staging#${String(beschriften.id)}`]);
            // Früher eingereiht und noch in ihrer Sammelzeit: Sie hält den Bereich des Geländes nicht mehr.
            const wartend = zeile({
                kind: "label_runs",
                inputRef: { landscape: "y" },
                queuedAt: new Date(NOW - 5000),
                notBefore: new Date(NOW + 5000),
            });
            const lokal = zeile({
                kind: "terrain_local",
                scopeKind: "tiles",
                scopeTiles: [19, 20],
                queuedAt: new Date(NOW - 4000),
            });
            expect(gestartete(plane(eingabe([wartend, lokal], [])))).toEqual([`staging#${String(lokal.id)}`]);
        });

        it("der Boden der leichten hält: unter 512 MB frei wartet auch ein kleiner Auftrag", () => {
            const beschriften = zeile({ kind: "label_runs", inputRef: { landscape: "x" } });
            const result = plane(eingabe([beschriften], [gelaende()], 600));
            expect(gestartete(result)).toEqual([]);
            expect(grund(result, "staging", beschriften.id)).toMatchObject({ wartegrund: "waits_memory" });
        });

        it("eine schwere Art bucht weiter gegen Budget und Boden", () => {
            const hoehen = zeile({ kind: "display_heights", scopeKind: "tiles", scopeTiles: [] });
            // Erwartung 700 MB, Boden 560 MB (Entscheidung Vali 2026-11-06, `5cde1331b`; vorher 1024): ab 1260 MB frei startet sie, bei 1200 wartet sie.
            const result = plane(eingabe([hoehen], [], 1200));
            expect(gestartete(result)).toEqual([]);
            expect(grund(result, "staging", hoehen.id)).toMatchObject({ wartegrund: "waits_memory" });
        });

        it("hinter einem Zug derselben Domäne warten sie: die Bereichssperre bleibt", () => {
            const beschriften = zeile({ kind: "label_runs", inputRef: { landscape: "x" } });
            const zug = laeuft({ kind: "legacy_zug", scopeKind: "domain", inputRef: { kategorie: "wege" } });
            const result = plane(eingabe([beschriften], [zug]));
            expect(gestartete(result)).toEqual([]);
            expect(grund(result, "staging", beschriften.id)).toMatchObject({ wartegrund: "waits_area" });
        });
    });

    it("schwer ist alles außer der Liste der leichten, auch eine unbekannte Art und der aufgezeichnete Import", () => {
        expect([...LEICHTE_ARTEN].every((kind) => !istSchwer(kind))).toBe(true);
        expect(istSchwer("benachrichtigung")).toBe(false);
        for (const kind of ["import", "terrain_full", "legacy_pull", "production_pull", "eine_neue_art"]) {
            expect(istSchwer(kind)).toBe(true);
        }
    });
});

describe("Dirigent, Planung: Bereiche je Umgebung", () => {
    it("🔴 dieselbe Kartendomäne in Stage und Production ist nicht derselbe Bereich; in derselben Umgebung sperrt sie", () => {
        const running = laeuft({ kind: "probe", scopeKind: "domain" });
        const nebenan = zeile({ kind: "probe", scopeKind: "domain" });
        const gleich = zeile({ kind: "probe", scopeKind: "domain" });
        const result = plan([
            lage("staging", { running: [running], queued: [gleich] }),
            lage("production", { queued: [nebenan] }),
        ]);
        expect(gestartete(result)).toEqual([`production#${String(nebenan.id)}`]);
        expect(grund(result, "staging", gleich.id)?.wartegrund).toBe("waits_area");
    });
});

describe("Dirigent, Planung: ein Play/Pause für beide (A3)", () => {
    it("🔴 die jüngste Anweisung gewinnt: Stage pausiert, Production setzt später fort -> es läuft", () => {
        const waiting = zeile({ kind: "probe" });
        const result = plan([
            lage("staging", { queued: [waiting], pause: anweisung(true, "2026-10-15T10:00:00.000Z") }),
            lage("production", { pause: anweisung(false, "2026-10-15T10:05:00.000Z") }),
        ]);
        expect(result.pause).toMatchObject({ paused: false, umgebung: "production" });
        expect(gestartete(result)).toEqual([`staging#${String(waiting.id)}`]);
    });

    it("Pause in der einen Umgebung hält auch die andere an: nichts startet, jeder wartende sagt warum", () => {
        const stage = zeile({ kind: "probe" });
        const production = zeile({ kind: "media_derive" });
        const result = plan([
            lage("staging", { queued: [stage], pause: anweisung(false, "2026-10-15T10:00:00.000Z") }),
            lage("production", { queued: [production], pause: anweisung(true, "2026-10-15T10:05:00.000Z") }),
        ]);
        expect(result.pause).toMatchObject({ paused: true, umgebung: "production", reason: "Wartung" });
        expect(result.starts).toEqual([]);
        expect(result.reihe.map((entry) => entry.wartegrund)).toEqual(["waits_queue_paused", "waits_queue_paused"]);
    });

    it("die Anweisung einer nicht erreichbaren Umgebung gilt weiter (die Quelle trägt die letzte gelesene)", () => {
        const waiting = zeile({ kind: "probe" });
        const result = plan([
            lage("staging", { queued: [waiting] }),
            lage("production", { erreichbar: false, pause: anweisung(true, "2026-10-15T10:05:00.000Z") }),
        ]);
        expect(result.pause.paused).toBe(true);
        expect(result.starts).toEqual([]);
    });

    it("ohne jede Anweisung läuft die Warteschlange", () => {
        const result = plan([lage("staging", { queued: [zeile({ kind: "probe" })] })]);
        expect(result.pause).toMatchObject({ paused: false, umgebung: null });
        expect(result.starts).toHaveLength(1);
    });
});

describe("Dirigent, Planung: Halt, Abhängigkeiten, Entprellung", () => {
    it("der Halt der Editor-Jobs gilt nur in seiner Umgebung", () => {
        const stage = zeile({ kind: "probe", actorRef: PERSON });
        const production = zeile({ kind: "probe", actorRef: PERSON });
        const ohnePerson = zeile({ kind: "probe" });
        const result = plan([
            lage("staging", { queued: [stage, ohnePerson], editorHalt: true }),
            lage("production", { queued: [production] }),
        ]);
        expect(grund(result, "staging", stage.id)?.wartegrund).toBe("waits_system_lock");
        expect(gestartete(result).sort()).toEqual(
            [`production#${String(production.id)}`, `staging#${String(ohnePerson.id)}`].sort(),
        );
    });

    it("Abhängigkeiten: der Nachfolger wartet, bis sein Vorgänger SUCCEEDED ist", () => {
        const nachfolger = zeile({ kind: "probe" });
        const offen = plan([
            lage("staging", { queued: [nachfolger], offeneAbhaengigkeiten: new Set([nachfolger.id]) }),
        ]);
        expect(offen.starts).toEqual([]);
        expect(grund(offen, "staging", nachfolger.id)?.wartegrund).toBe("waits_dependency");
        expect(plan([lage("staging", { queued: [nachfolger] })]).starts).toHaveLength(1);
    });

    it("`not_before` entprellt: der Auftrag startet erst danach", () => {
        const job = zeile({ kind: "probe", notBefore: new Date(NOW + 5_000) });
        expect(grund(plan([lage("staging", { queued: [job] })]), "staging", job.id)?.wartegrund).toBe("debouncing");
        expect(plan([lage("staging", { queued: [job] })], { nowMs: NOW + 6_000 }).starts).toHaveLength(1);
    });

    it("die Marke `rollout` einer Umgebung bremst den ganzen Host: nur Aufträge bis `rolloutMaxJobMb` starten", () => {
        const gross = zeile({ kind: "terrain_full" });
        const klein = zeile({ kind: "probe" });
        const result = plan([lage("staging", { rolloutAktiv: true }), lage("production", { queued: [gross, klein] })]);
        expect(grund(result, "production", gross.id)?.wartegrund).toBe("waits_rollout");
        expect(gestartete(result)).toEqual([`production#${String(klein.id)}`]);
    });
});

describe("Dirigent, Planung: Antwort des Ausführers", () => {
    it("Exit 3: waits_executor bis zum Ablauf, dann ein neuer Versuch", () => {
        const job = zeile({ kind: "terrain_full" });
        const quellen = [lage("production", { queued: [job] })];
        const rueckstellungen = [
            { umgebung: "production" as const, id: job.id, grund: "waits_executor" as const, bisMs: NOW + 300_000 },
        ];
        const jetzt = plan(quellen, { rueckstellungen });
        expect(jetzt.starts).toEqual([]);
        expect(grund(jetzt, "production", job.id)).toMatchObject({ platz: 1, wartegrund: "waits_executor" });
        const spaeter = plan(quellen, { rueckstellungen, nowMs: NOW + 300_001 });
        expect(gestartete(spaeter)).toEqual([`production#${String(job.id)}`]);
    });

    it("Exit 75: waits_domain_lock; ein zurückgestellter behält seinen Platz im Bereich, ein späterer überholt ihn dort nicht", () => {
        const zurueck = zeile({ kind: "probe", scopeKind: "tiles", scopeTiles: [4] });
        const spaeter = zeile({ kind: "probe", scopeKind: "tiles", scopeTiles: [4] });
        const anderswo = zeile({ kind: "probe", scopeKind: "tiles", scopeTiles: [9] });
        const result = plan([lage("staging", { queued: [zurueck, spaeter, anderswo] })], {
            rueckstellungen: [{ umgebung: "staging", id: zurueck.id, grund: "waits_domain_lock", bisMs: NOW + 60_000 }],
        });
        expect(grund(result, "staging", zurueck.id)?.wartegrund).toBe("waits_domain_lock");
        expect(grund(result, "staging", spaeter.id)?.wartegrund).toBe("waits_area");
        expect(gestartete(result)).toEqual([`staging#${String(anderswo.id)}`]);
    });

    it("🔴 gestartet, aber noch nicht als RUNNING gelesen: zählt als laufend, startet nicht doppelt und hält den Platz der Schweren", () => {
        const unterwegs = zeile({ kind: "terrain_full" });
        const naechster = zeile({ kind: "terrain_local" });
        const gestartet: Gestartet = {
            umgebung: "staging",
            id: unterwegs.id,
            publicId: unterwegs.publicId,
            kind: unterwegs.kind,
            mapDomainId: unterwegs.mapDomainId,
            scopeKind: unterwegs.scopeKind,
            scopeTiles: unterwegs.scopeTiles,
            memExpectedMb: 300,
            threads: 1,
            attempt: 0,
        };
        const result = plan([lage("staging", { queued: [unterwegs] }), lage("production", { queued: [naechster] })], {
            gestartet: [gestartet],
        });
        expect(result.starts).toEqual([]);
        expect(grund(result, "staging", unterwegs.id)).toMatchObject({ platz: 1, wartegrund: null });
        expect(grund(result, "production", naechster.id)?.wartegrund).toBe("waits_slot");
    });

    it("ein gestarteter Auftrag einer nicht erreichbaren Umgebung belegt den Host weiter", () => {
        const schwer = zeile({ kind: "terrain_full" });
        const result = plan([lage("staging", { queued: [schwer] }), lage("production", { erreichbar: false })], {
            gestartet: [
                {
                    umgebung: "production",
                    id: 99,
                    publicId: "p",
                    kind: "legacy_pull",
                    mapDomainId: "aventuria",
                    scopeKind: "domain",
                    scopeTiles: [],
                    memExpectedMb: null,
                    threads: null,
                    attempt: 0,
                },
            ],
        });
        expect(grund(result, "staging", schwer.id)?.wartegrund).toBe("waits_slot");
    });
});

describe("Dirigent, Planung: Übergang und fremde Planer", () => {
    it("ABGLEICHE (nur lokal): Abholarten warten auf den Abholer, andere übersprungene sagen „niemand nimmt sie an“", () => {
        const abholung = zeile({ kind: "legacy_pull" });
        const aus = zeile({ kind: "legacy_media" });
        const result = plan([lage("staging", { queued: [abholung, aus] })], {
            uebersprungen: new Set(["legacy_pull", "legacy_media"]),
            abholung: new Set(["legacy_pull"]),
        });
        expect(result.starts).toEqual([]);
        expect(grund(result, "staging", abholung.id)?.wartegrund).toBe("waits_pickup");
        expect(grund(result, "staging", aus.id)?.wartegrund).toBe("waits_no_worker");
    });

    it("ABGLEICHE=legacy:korridor,medien:aus wie auf der Stage: legacy_pull wartet auf Abholung, legacy_media auf niemanden", () => {
        const modes = abgleicheModes({ RELEASE_ID: "r", ABGLEICHE: "legacy:korridor,medien:aus" });
        const zug = zeile({ kind: "legacy_pull", actorRef: PERSON });
        const medien = zeile({ kind: "legacy_media", actorRef: PERSON });
        const result = plan([lage("staging", { queued: [zug, medien] })], {
            uebersprungen: skippedJobKinds(modes),
            abholung: pickupJobKinds(modes),
        });
        expect(result.starts).toEqual([]);
        expect(grund(result, "staging", zug.id)?.wartegrund).toBe("waits_pickup");
        // Bis WI-0163 stand hier gar kein Grund; der Stand nennt jeden (A7): niemand nimmt diese Art an.
        expect(grund(result, "staging", medien.id)?.wartegrund).toBe("waits_no_worker");
    });

    it("ohne Planersperre: nichts starten, den Grund aus der Tafel zeigen; ihre Läufe belegen den Host trotzdem", () => {
        const fremd = zeile({ kind: "probe", waitReason: "waits_memory" });
        const freitext = zeile({ kind: "probe", waitReason: "wartet auf die Geländerechnung" });
        const fremdLaeuft = laeuft({ kind: "terrain_full" });
        const eigen = zeile({ kind: "terrain_local" });
        const result = plan([
            lage("staging", { planer: false, queued: [fremd, freitext], running: [fremdLaeuft] }),
            lage("production", { queued: [eigen] }),
        ]);
        expect(result.starts).toEqual([]);
        expect(grund(result, "staging", fremd.id)?.wartegrund).toBe("waits_memory");
        expect(grund(result, "staging", freitext.id)?.wartegrund).toBeNull();
        expect(grund(result, "production", eigen.id)?.wartegrund).toBe("waits_slot");
    });

    it("Aufzeichnungen ohne Bedarf (`stage_rollout`) belegen keinen Platz, stehen aber als laufend in der Reihe", () => {
        const auslieferung = laeuft({ kind: "stage_rollout", origin: "recorded", scopeKind: "domain" });
        const schwer = zeile({ kind: "terrain_full", scopeKind: "domain" });
        const result = plan([lage("staging", { running: [auslieferung], queued: [schwer] })]);
        expect(gestartete(result)).toEqual([`staging#${String(schwer.id)}`]);
        expect(result.reihe[0]).toMatchObject({ umgebung: "staging", platz: null });
    });
});

describe("Dirigent, Planung: Zulassung des Hosts (bis WI-0163 im Worker geprüft)", () => {
    it("MS7: zu wenig `MemAvailable` -> waits_memory, nie ein Abbruch; mit Speicher startet er", () => {
        const job = zeile({ kind: "terrain_full" });
        const knapp = plan([lage("staging", { queued: [job] })], { memAvailableMb: 700 });
        expect(knapp.starts).toEqual([]);
        expect(grund(knapp, "staging", job.id)?.wartegrund).toBe("waits_memory");
        expect(plan([lage("staging", { queued: [job] })], { memAvailableMb: 8000 }).starts).toHaveLength(1);
    });

    it("MS6: die Summe der Erwartungen über beide Umgebungen bleibt im Budget des Hosts", () => {
        const gross = laeuft({ kind: "media_derive", memExpectedMb: 3950 });
        const job = zeile({ kind: "media_derive" });
        const result = plan([lage("staging", { running: [gross] }), lage("production", { queued: [job] })]);
        expect(grund(result, "production", job.id)?.wartegrund).toBe("waits_memory");
    });

    it("MS3: die Parallelität je Art gilt für den Host, nicht je Umgebung", () => {
        const job = zeile({ kind: "media_derive" });
        const result = plan([
            lage("staging", { running: [laeuft({ kind: "media_derive" })] }),
            lage("production", { running: [laeuft({ kind: "media_derive" })], queued: [job] }),
        ]);
        expect(grund(result, "production", job.id)?.wartegrund).toBe("waits_slot");
    });

    it("ein laufender Import (aufgezeichnet, Bedarf unbekannt) lässt nichts neben sich starten, auch keinen leichten", () => {
        const zug = laeuft({ kind: "import", origin: "recorded", scopeKind: "domain" });
        const leicht = zeile({ kind: "media_derive" });
        const result = plan([lage("production", { running: [zug] }), lage("staging", { queued: [leicht] })]);
        expect(result.starts).toEqual([]);
        expect(grund(result, "staging", leicht.id)?.wartegrund).toBe("waits_slot");
    });
});

describe("Dirigent, Planung: Arten, die dieser Stand nicht kennt", () => {
    const nurKatalog = (kind: string, version: number): boolean => kind === "probe" && version === 1;

    it("lokal startet er nur Arten, die der eigene Katalog kennt; eine fremde Art oder Fassung wartet mit waits_no_worker", () => {
        const fremd = zeile({ kind: "eine_neue_art" });
        const neueFassung = zeile({ kind: "probe", kindVersion: 2 });
        const bekannt = zeile({ kind: "probe" });
        const result = plan([lage("staging", { queued: [fremd, neueFassung, bekannt] })], { kenntArt: nurKatalog });
        expect(gestartete(result)).toEqual([`staging#${String(bekannt.id)}`]);
        expect(grund(result, "staging", fremd.id)?.wartegrund).toBe("waits_no_worker");
        expect(grund(result, "staging", neueFassung.id)?.wartegrund).toBe("waits_no_worker");
    });

    it("mit sudo (ohne Prüfung) startet er sie: Wrapper und Ausführer der Umgebung kennen sie vielleicht; sie gilt als schwer und allein", () => {
        const fremd = zeile({ kind: "eine_neue_art" });
        const leicht = zeile({ kind: "probe" });
        const result = plan([lage("production", { queued: [fremd, leicht] })]);
        expect(gestartete(result)).toEqual([`production#${String(fremd.id)}`]);
        expect(grund(result, "production", fremd.id)?.schwer).toBe(true);
        expect(grund(result, "production", leicht.id)?.wartegrund).toBe("waits_slot");
    });

    it("ein zurückgegebener Editor-Job unter Kartensperre sagt waits_system_lock, auch wenn er zurückgestellt ist", () => {
        const editor = zeile({ kind: "probe", actorRef: PERSON });
        const result = plan([lage("staging", { queued: [editor], editorHalt: true })], {
            rueckstellungen: [{ umgebung: "staging", id: editor.id, grund: "waits_executor", bisMs: NOW + 60_000 }],
        });
        expect(grund(result, "staging", editor.id)?.wartegrund).toBe("waits_system_lock");
    });
});
