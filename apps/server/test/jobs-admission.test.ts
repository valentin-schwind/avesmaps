import { describe, expect, it } from "vitest";
import { resolveJobsConfig, type JobsConfig, type JobsProfile } from "@avesmaps3d/shared";
import {
    decideAdmission,
    scopesOverlap,
    type AdmissionCandidate,
    type AdmissionRunning,
} from "../src/jobs/admission.ts";

/**
 * Die Zulassung (JOBS-0001 4.5): Wann darf ein wartender Job starten?
 *
 * 🔴 Sie WARTET und MELDET, sie bricht nie ab (D7a); und UNBEKANNT HEISST ALLEIN. Beides ist hier das Gerüst der Tests:
 * jeder Fall prüft entweder einen Grund zu warten oder, dass ein Job trotz knappem Speicher nie beendet wird.
 */

const NOW = 1_800_000_000_000;

/** Ein Profil, in dem alles bekannt ist: Budget 1.000 MB, Boden 500 MB, 4 Threads. */
function config(overrides: Partial<JobsProfile["values"]> = {}): JobsConfig {
    const profile: JobsProfile = {
        schemaVersion: 1,
        profile: "test",
        values: {
            maxConcurrent: { value: { a: 2, b: 1, c: 1 } },
            exclusivePairs: { value: [["b", "c"]] },
            cpuBudgetThreads: { value: 4 },
            memTotalBudgetMb: { value: 1000 },
            memAvailFloorMb: { value: 500 },
            rolloutMaxJobMb: { value: 100 },
            ...overrides,
        },
    };
    return resolveJobsConfig(profile, "test");
}

let nextId = 1;
function queued(partial: Partial<AdmissionCandidate> & { kind: string }): AdmissionCandidate {
    const id = partial.id ?? nextId++;
    return {
        id,
        mapDomainId: "d",
        // Ohne eigenen Fußabdruck beansprucht ein Job keinen Bereich; wer die ganze Domäne will, sagt es.
        scopeKind: "tiles",
        scopeTiles: [],
        priority: 50,
        queuedAtMs: NOW - 1000 + id,
        notBeforeMs: null,
        memExpectedMb: 100,
        threads: 1,
        dependenciesDone: true,
        ...partial,
    };
}

function running(partial: Partial<AdmissionRunning> & { kind: string }): AdmissionRunning {
    return {
        id: 1000 + nextId++,
        mapDomainId: "d",
        scopeKind: "tiles",
        scopeTiles: [],
        memExpectedMb: 100,
        threads: 1,
        ...partial,
    };
}

function decide(
    candidates: AdmissionCandidate[],
    options: Partial<Parameters<typeof decideAdmission>[0]> = {},
): ReturnType<typeof decideAdmission> {
    return decideAdmission({
        nowMs: NOW,
        queued: candidates,
        running: [],
        config: config(),
        memAvailableMb: 4000,
        rolloutActive: false,
        ...options,
    });
}

describe("Zulassung: Bereiche", () => {
    it("Fußabdrücke überlappen: die ganze Domäne überlappt alles, getrennte Kacheln nicht, andere Domänen nie", () => {
        const tiles = (scopeTiles: number[], mapDomainId = "d") => ({
            mapDomainId,
            scopeKind: "tiles" as const,
            scopeTiles,
        });
        const domain = { mapDomainId: "d", scopeKind: "domain" as const, scopeTiles: [] };
        expect(scopesOverlap(domain, tiles([1]))).toBe(true);
        expect(scopesOverlap(tiles([1, 2]), tiles([2, 3]))).toBe(true);
        expect(scopesOverlap(tiles([1, 2]), tiles([3, 4]))).toBe(false);
        expect(scopesOverlap(tiles([1]), tiles([1], "andere"))).toBe(false);
        expect(scopesOverlap(domain, { ...domain, mapDomainId: "andere" })).toBe(false);
    });

    it("S1: getrennte Fußabdrücke laufen nebeneinander", () => {
        const weiden = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [1, 2] });
        const garetien = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [30, 31] });
        const result = decide([weiden, garetien]);
        expect(result.admitted.map((job) => job.id)).toEqual([weiden.id, garetien.id]);
    });

    it("S2: überlappende laufen nacheinander, in der Reihenfolge des Eintreffens", () => {
        const first = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [1, 2] });
        const second = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [2, 3] });
        const third = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [3] });
        const result = decide([third, second, first]);
        expect(result.admitted.map((job) => job.id)).toEqual([first.id]);
        expect(result.waiting.get(second.id)).toBe("waits_area");
        expect(result.waiting.get(third.id)).toBe("waits_area");
    });

    it("ein späterer Job mit getrenntem Fußabdruck darf überholen, ein überlappender nicht", () => {
        const blocked = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [1], dependenciesDone: false });
        const sameArea = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [1] });
        const elsewhere = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [9] });
        const result = decide([blocked, sameArea, elsewhere]);
        expect(result.waiting.get(blocked.id)).toBe("waits_dependency");
        // `sameArea` überlappt mit dem früheren, noch wartenden `blocked`: es überholt nicht.
        expect(result.waiting.get(sameArea.id)).toBe("waits_area");
        expect(result.admitted.map((job) => job.id)).toEqual([elsewhere.id]);
    });

    it("ein laufender Job im Fußabdruck sperrt ihn", () => {
        const job = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [5] });
        const result = decide([job], { running: [running({ kind: "a", scopeKind: "tiles", scopeTiles: [5, 6] })] });
        expect(result.waiting.get(job.id)).toBe("waits_area");
    });

    it("die Priorität ordnet nur Nichtüberlappendes: ein wichtiger späterer Job im selben Bereich überholt nicht", () => {
        const early = queued({ kind: "a", priority: 90, scopeKind: "domain" });
        const late = queued({ kind: "a", priority: 10, scopeKind: "domain" });
        const result = decide([late, early]);
        // Beide überlappen (ganze Domäne): der früher eingereihte läuft zuerst, trotz schlechterer Priorität.
        expect(result.admitted.map((job) => job.id)).toEqual([early.id]);
        expect(result.waiting.get(late.id)).toBe("waits_area");
    });
});

describe("Zulassung: Vorgänger und Entprellung", () => {
    it("ein Job wartet auf seine Vorgänger", () => {
        const job = queued({ kind: "a", dependenciesDone: false });
        expect(decide([job]).waiting.get(job.id)).toBe("waits_dependency");
    });

    it("`not_before` entprellt: erst danach darf der Job starten", () => {
        const job = queued({ kind: "a", notBeforeMs: NOW + 30_000 });
        expect(decide([job]).waiting.get(job.id)).toBe("debouncing");
        expect(decide([job], { nowMs: NOW + 30_000 }).admitted).toHaveLength(1);
    });
});

describe("Zulassung: Parallelität, Paare, Threads", () => {
    it("MS3: höchstens `maxConcurrent` je Jobart", () => {
        const [one, two, three] = [
            queued({ kind: "b", scopeKind: "tiles", scopeTiles: [1] }),
            queued({ kind: "b", scopeKind: "tiles", scopeTiles: [2] }),
            queued({ kind: "a", scopeKind: "tiles", scopeTiles: [3] }),
        ];
        const result = decide([one, two, three]);
        expect(result.admitted.map((job) => job.id)).toEqual([one.id, three.id]);
        expect(result.waiting.get(two.id)).toBe("waits_slot");
    });

    it("MS3: ein Paar läuft nie nebeneinander (`import` neben `terrain_local`)", () => {
        const b = queued({ kind: "b", scopeKind: "tiles", scopeTiles: [1] });
        const c = queued({ kind: "c", scopeKind: "tiles", scopeTiles: [2] });
        const result = decide([b, c]);
        expect(result.admitted.map((job) => job.id)).toEqual([b.id]);
        expect(result.waiting.get(c.id)).toBe("waits_slot");
    });

    it("MS4: die Threads aller laufenden Jobs zusammen bleiben unter dem Budget", () => {
        const heavy = queued({ kind: "a", threads: 3, scopeKind: "tiles", scopeTiles: [1] });
        const second = queued({ kind: "a", threads: 2, scopeKind: "tiles", scopeTiles: [2] });
        const result = decide([heavy, second]);
        expect(result.admitted.map((job) => job.id)).toEqual([heavy.id]);
        expect(result.waiting.get(second.id)).toBe("waits_slot");
    });
});

describe("Zulassung: Speicher (wartet und meldet, bricht nie ab)", () => {
    it("MS6: die Summe der Erwartungen aller Jobs bleibt unter dem Budget", () => {
        const big = queued({ kind: "a", memExpectedMb: 700, scopeKind: "tiles", scopeTiles: [1] });
        const next = queued({ kind: "a", memExpectedMb: 400, scopeKind: "tiles", scopeTiles: [2] });
        const result = decide([big, next]);
        expect(result.admitted.map((job) => job.id)).toEqual([big.id]);
        expect(result.waiting.get(next.id)).toBe("waits_memory");
    });

    it("MS7: `MemAvailable` minus Erwartung bleibt mindestens auf dem Boden", () => {
        const job = queued({ kind: "a", memExpectedMb: 400 });
        expect(decide([job], { memAvailableMb: 900 }).admitted).toHaveLength(1);
        expect(decide([job], { memAvailableMb: 899 }).waiting.get(job.id)).toBe("waits_memory");
    });

    it("was in diesem Durchgang schon zugelassen ist, zählt gegen `MemAvailable`, obwohl es noch nicht allokiert hat", () => {
        const first = queued({ kind: "a", memExpectedMb: 300, scopeKind: "tiles", scopeTiles: [1] });
        const second = queued({ kind: "a", memExpectedMb: 300, scopeKind: "tiles", scopeTiles: [2] });
        // 1.100 MB frei: die erste lässt 800 übrig (ok), nach ihr bleiben 800, die zweite ließe 500 -> gerade noch ok.
        expect(decide([first, second], { memAvailableMb: 1100 }).admitted).toHaveLength(2);
        expect(decide([first, second], { memAvailableMb: 1099 }).waiting.get(second.id)).toBe("waits_memory");
    });

    it("🔴 sie bricht nie ab: ein laufender Job bleibt laufen, wie knapp der Speicher auch wird", () => {
        const current = running({ kind: "a", memExpectedMb: 900 });
        const waiting = queued({ kind: "a", memExpectedMb: 400 });
        const result = decide([waiting], { running: [current], memAvailableMb: 100 });
        // Nur der wartende wartet; es gibt keine Entscheidung über den laufenden, die Funktion kann ihn gar nicht beenden.
        expect(result.admitted).toEqual([]);
        expect(result.waiting.get(waiting.id)).toBe("waits_memory");
        expect(Object.keys(result).sort()).toEqual(["admitted", "waiting"]);
    });

    it("die Marke `rollout`: solange sie aktiv ist, nur Jobs bis 100 MB (hier der Wert des Profils)", () => {
        const small = queued({ kind: "a", memExpectedMb: 100, scopeKind: "tiles", scopeTiles: [1] });
        const large = queued({ kind: "a", memExpectedMb: 101, scopeKind: "tiles", scopeTiles: [2] });
        const result = decide([small, large], { rolloutActive: true });
        expect(result.admitted.map((job) => job.id)).toEqual([small.id]);
        expect(result.waiting.get(large.id)).toBe("waits_rollout");
        // Ohne Marke laufen beide.
        expect(decide([small, large]).admitted).toHaveLength(2);
    });

    it("die Marke `rollout` mit unbekannter Erwartung: nie klein, also wartet der Job", () => {
        const unknown = queued({ kind: "a", memExpectedMb: null });
        expect(decide([unknown], { rolloutActive: true }).waiting.get(unknown.id)).toBe("waits_rollout");
    });
});

describe("Zulassung: unbekannt heißt allein", () => {
    it("🔴 eine Jobart ohne Wert für die Parallelität läuft allein: sie startet nur, wenn nichts läuft", () => {
        const unknownKind = queued({ kind: "neu" });
        expect(decide([unknownKind]).admitted).toHaveLength(1);
        const result = decide([unknownKind], { running: [running({ kind: "a" })] });
        expect(result.waiting.get(unknownKind.id)).toBe("waits_slot");
    });

    it("🔴 und solange sie läuft, startet nichts anderes neben ihr", () => {
        const alone = queued({ kind: "neu" });
        const other = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [1] });
        const result = decide([alone, other]);
        expect(result.admitted.map((job) => job.id)).toEqual([alone.id]);
        expect(result.waiting.get(other.id)).toBe("waits_slot");
    });

    it("ein laufender Job mit unbekanntem Bedarf (aufgezeichneter Import ohne Threads) lässt nichts neben sich zu", () => {
        const job = queued({ kind: "a" });
        const result = decide([job], { running: [running({ kind: "import", threads: null, memExpectedMb: 300 })] });
        expect(result.waiting.get(job.id)).toBe("waits_slot");
    });

    it("fehlt das Budget (MS6) oder der Boden (MS7) im Profil, läuft jede Art allein", () => {
        const profileWithoutBudget = config({ memTotalBudgetMb: undefined as never });
        const one = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [1] });
        const two = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [2] });
        const result = decide([one, two], { config: { ...profileWithoutBudget, memTotalBudgetMb: null } });
        expect(result.admitted.map((job) => job.id)).toEqual([one.id]);
        expect(result.waiting.get(two.id)).toBe("waits_slot");
    });

    it("ohne Messwert für `MemAvailable` ist der Boden nicht prüfbar: die Art läuft allein", () => {
        const one = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [1] });
        const two = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [2] });
        const result = decide([one, two], { memAvailableMb: null });
        expect(result.admitted.map((job) => job.id)).toEqual([one.id]);
        expect(result.waiting.get(two.id)).toBe("waits_slot");
    });

    it("ein Profil ohne jeden Rechnerwert (production) lässt jede Jobart allein laufen", () => {
        const unknown = resolveJobsConfig(undefined, "production");
        const one = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [1] });
        const two = queued({ kind: "b", scopeKind: "tiles", scopeTiles: [2] });
        const result = decide([one, two], { config: unknown });
        expect(result.admitted.map((job) => job.id)).toEqual([one.id]);
        expect(result.waiting.get(two.id)).toBe("waits_slot");
    });
});

describe("Zulassung: ein Schwerer zur Zeit (WI-0163, nur mit `isHeavy`)", () => {
    const heavy = (kind: string): boolean => kind !== "a";

    it("zwei schwere, für die Profil und Speicher reichten: der zweite wartet mit waits_slot", () => {
        const one = queued({ kind: "b", scopeKind: "tiles", scopeTiles: [1] });
        const two = queued({ kind: "c2", scopeKind: "tiles", scopeTiles: [2] });
        const known = config({ maxConcurrent: { value: { a: 2, b: 1, c2: 1 } } });
        // Ohne die Regel liefen beide: Parallelität, Threads und Speicher lassen es zu.
        expect(decide([one, two], { config: known }).admitted.map((job) => job.id)).toEqual([one.id, two.id]);
        const result = decide([one, two], { config: known, isHeavy: heavy });
        expect(result.admitted.map((job) => job.id)).toEqual([one.id]);
        expect(result.waiting.get(two.id)).toBe("waits_slot");
    });

    it("ein laufender schwerer hält jeden schweren an; ein leichter läuft neben ihm", () => {
        const schwer = queued({ kind: "b", scopeKind: "tiles", scopeTiles: [1] });
        const leicht = queued({ kind: "a", scopeKind: "tiles", scopeTiles: [2] });
        const result = decide([schwer, leicht], {
            running: [running({ kind: "c", scopeKind: "tiles", scopeTiles: [3] })],
            config: config({ exclusivePairs: { value: [] } }),
            isHeavy: heavy,
        });
        expect(result.admitted.map((job) => job.id)).toEqual([leicht.id]);
        expect(result.waiting.get(schwer.id)).toBe("waits_slot");
    });
});
