import type { JobsOverview, JobSummary, QueueEntry } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import {
    eigeneAuftraege,
    FERTIG_MS,
    neuesGedaechtnis,
    quittiere,
    vorderster,
    weitere,
} from "../src/warteschlange/eigene-auftraege";

/**
 * Die Warteschlange im Kopf (WI-0230): was aus der Übersicht der eigenen Aufträge wird. Problemfälle: ein fremder fertiger Auftrag
 * (die Liste „zuletzt“ trägt in der eigenen Sicht alle) erscheint nie; ein Fehlschlag verschwindet erst, wenn man die Warteschlange
 * geöffnet hat. Soll: gesammelt mit Restzeit bis zum Ende der Sammelzeit, wartet mit Start, läuft mit der Dauer aus der Schätzung.
 */
const JETZT = Date.parse("2026-10-19T03:00:00Z");
const iso = (sekunden: number): string => new Date(JETZT + sekunden * 1000).toISOString();

function job(id: string, teil: Partial<JobSummary> = {}): JobSummary {
    return {
        id,
        kind: "territory_derive",
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
        queuedAt: iso(-30),
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
        ...teil,
    } as JobSummary;
}

function wartend(id: string, teil: Partial<QueueEntry> = {}, dauer: number | null = 48): QueueEntry {
    return {
        ...job(id),
        position: 1,
        estimate: {
            startAt: null,
            finishAt: null,
            durationP50S: dauer,
            durationP95S: dauer,
            basis: dauer === null ? "unknown" : "history",
        },
        ...teil,
    } as QueueEntry;
}

function uebersicht(teil: Partial<JobsOverview>): JobsOverview {
    return {
        seq: 1,
        now: iso(0),
        releaseId: "test",
        profile: "staging",
        plannerActive: true,
        queuePause: { paused: false, since: null, by: null, reason: null },
        view: "own",
        running: [],
        queued: [],
        recent: [],
        failed: [],
        stalled: [],
        memory: null,
        ...teil,
    } as JobsOverview;
}

describe("Warteschlange im Kopf: die eigenen Aufträge", () => {
    it("🔴 gesammelt mit Restzeit bis zum Ende der Sammelzeit, danach wartet mit Start; die Dauer aus der Schätzung", () => {
        const merk = neuesGedaechtnis();
        const [gesammelt] = eigeneAuftraege(
            uebersicht({ queued: [wartend("a", { notBefore: iso(76) })] }),
            JETZT,
            merk,
        );
        expect(gesammelt).toMatchObject({
            auftrag: { art: "territory_derive", auftrag: "a" },
            stand: { stand: "gesammelt" },
            dauerS: 48,
        });
        expect(gesammelt?.stand.rest).toBeCloseTo(76, 5);
        const start = wartend("a", {
            notBefore: iso(-1),
            estimate: { startAt: iso(20), finishAt: null, durationP50S: 48, durationP95S: 60, basis: "history" },
        });
        expect(eigeneAuftraege(uebersicht({ queued: [start] }), JETZT, merk)[0]?.stand).toMatchObject({
            stand: "wartet",
            rest: 20,
        });
        // 🔴 Nach der Sammelzeit sagt die Schätzung „jetzt“ (oder eben vorbei), bis der nächste Takt startet: „startet gleich“ (rest 0),
        // nicht „Start unbekannt“ (Betreiber 2026-10-19: „startdatum steht nicht richtig dran“).
        const gleich = wartend("a", {
            notBefore: iso(-1),
            estimate: { startAt: iso(-2), finishAt: null, durationP50S: 48, durationP95S: 48, basis: "history" },
        });
        expect(eigeneAuftraege(uebersicht({ queued: [gleich] }), JETZT, merk)[0]?.stand).toEqual({
            stand: "wartet",
            rest: 0,
        });
        // Ohne Schätzung: kein Start, keine Dauer; nie eine geratene Zahl.
        expect(eigeneAuftraege(uebersicht({ queued: [wartend("b", {}, null)] }), JETZT, merk)[0]).toMatchObject({
            stand: { stand: "wartet" },
            dauerS: null,
        });
    });

    it("🔴 Kette Wegprofile → Wegnamen: ohne geschätzten Start „startet nach“ dem Vorgänger, nie „unbekannt“", () => {
        // Betreiber 2026-10-19: „nachdem die wegprofile gerechnet werden kommt "wegnamen werden gesetzt" start unbekannt“. Beide halten die
        // ganze Domäne; läuft `path_profile` über sein p95 hinaus, kennt der Server das Ende nicht und gibt `path_label_runs` keinen Start.
        const domaene = { kind: "domain" as const, tiles: [] };
        const profil = job("p", { kind: "path_profile", state: "RUNNING", startedAt: iso(-9), scope: domaene });
        const namen = wartend("n", { kind: "path_label_runs", notBefore: iso(-1), scope: domaene });
        const merk = neuesGedaechtnis();
        const [, folge] = eigeneAuftraege(uebersicht({ running: [profil], queued: [namen] }), JETZT, merk);
        expect(folge?.stand).toEqual({ stand: "wartet", nach: "path_profile" });
        // Beide noch eingereiht: der frühere ist der Vorgänger.
        const wartendesProfil = wartend("p", { kind: "path_profile", notBefore: iso(-1), scope: domaene });
        expect(eigeneAuftraege(uebersicht({ queued: [wartendesProfil, namen] }), JETZT, merk)[1]?.stand).toEqual({
            stand: "wartet",
            nach: "path_profile",
        });
        // Mit Schätzung gilt die Zeit, nicht der Vorgänger.
        const geschaetzt = { ...namen, estimate: { ...namen.estimate, startAt: iso(3) } };
        expect(eigeneAuftraege(uebersicht({ running: [profil], queued: [geschaetzt] }), JETZT, merk)[1]?.stand).toEqual(
            {
                stand: "wartet",
                rest: 3,
            },
        );
        // Ein Vorgänger aus `dependsOn` geht dem überlappenden vor; ein Auftrag einer anderen Domäne ist keiner.
        const fremd = job("f", { kind: "terrain_local", state: "RUNNING", mapDomainId: "andere", scope: domaene });
        const gelaende = job("g", { kind: "terrain_local", state: "RUNNING", scope: { kind: "tiles", tiles: [7] } });
        const abhaengig = wartend("d", { kind: "territory_derive", dependsOn: ["g"], scope: domaene });
        expect(
            eigeneAuftraege(uebersicht({ running: [profil, gelaende], queued: [abhaengig] }), JETZT, merk)[2]?.stand,
        ).toEqual({ stand: "wartet", nach: "terrain_local" });
        expect(eigeneAuftraege(uebersicht({ running: [fremd], queued: [namen] }), JETZT, merk)[1]?.stand).toEqual({
            stand: "wartet",
        });
    });

    it("🔴 läuft: die Dauer, die er beim Warten trug, gibt Restzeit und Anteil; ein Fortschritt des Servers geht vor", () => {
        const merk = neuesGedaechtnis();
        eigeneAuftraege(uebersicht({ queued: [wartend("a")] }), JETZT, merk);
        const lauf = eigeneAuftraege(
            uebersicht({ running: [job("a", { state: "RUNNING", startedAt: iso(-12) })] }),
            JETZT,
            merk,
        );
        expect(lauf[0]?.stand).toMatchObject({ stand: "laeuft", rest: 36 });
        expect(lauf[0]?.anteil).toBeCloseTo(0.25, 5);
        const mitPhase = eigeneAuftraege(
            uebersicht({ running: [job("a", { state: "RUNNING", startedAt: iso(-12), progress: 0.6 })] }),
            JETZT,
            merk,
        );
        expect(mitPhase[0]?.anteil).toBe(0.6);
        // Unbekannte Dauer: läuft ohne Restzeit.
        expect(
            eigeneAuftraege(
                uebersicht({ running: [job("x", { state: "RUNNING", startedAt: iso(-5) })] }),
                JETZT,
                merk,
            )[0]?.stand,
        ).toEqual({ stand: "laeuft" });
    });

    it("das Etikett reist mit, solange der Auftrag wartet oder läuft („Gelände voll rechnen (Fassung 19 (Test))“)", () => {
        const etikett = "Gelände voll rechnen (Fassung 19 (Test))";
        const merk = neuesGedaechtnis();
        expect(
            eigeneAuftraege(
                uebersicht({ queued: [wartend("v", { kind: "terrain_full", label: etikett })] }),
                JETZT,
                merk,
            )[0],
        ).toMatchObject({ auftrag: { art: "terrain_full" }, etikett });
        const lauf = eigeneAuftraege(
            uebersicht({
                running: [job("v", { kind: "terrain_full", label: etikett, state: "RUNNING", startedAt: iso(-5) })],
            }),
            JETZT,
            merk,
        );
        expect(lauf[0]?.etikett).toBe(etikett);
        // Ohne Etikett kein leeres Feld.
        expect(eigeneAuftraege(uebersicht({ queued: [wartend("w")] }), JETZT, merk)[0]).not.toHaveProperty("etikett");
    });

    it("🔴 fertig nur, was hier zuvor aktiv war, und nur kurz; ein fremder fertiger Auftrag erscheint nie", () => {
        const merk = neuesGedaechtnis();
        eigeneAuftraege(uebersicht({ running: [job("a", { state: "RUNNING", startedAt: iso(-40) })] }), JETZT, merk);
        const fertig = uebersicht({
            recent: [job("a", { state: "SUCCEEDED", finishedAt: iso(0) }), job("fremd", { state: "SUCCEEDED" })],
        });
        expect(eigeneAuftraege(fertig, JETZT, merk).map((a) => [a.auftrag.auftrag, a.stand.stand])).toEqual([
            ["a", "fertig"],
        ]);
        expect(eigeneAuftraege(fertig, JETZT + FERTIG_MS - 1, merk)).toHaveLength(1);
        expect(eigeneAuftraege(fertig, JETZT + FERTIG_MS, merk)).toEqual([]);
    });

    it("🔴 ein Fehlschlag bleibt, bis die Warteschlange geöffnet wurde; vorne steht er vor allem anderen", () => {
        const merk = neuesGedaechtnis();
        eigeneAuftraege(
            uebersicht({ queued: [wartend("a"), wartend("b", { kind: "path_label_runs" } as Partial<QueueEntry>)] }),
            JETZT,
            merk,
        );
        const lage = uebersicht({
            queued: [wartend("b", { kind: "path_label_runs" } as Partial<QueueEntry>)],
            running: [job("c", { kind: "terrain_local", state: "RUNNING", startedAt: iso(-1) })],
            failed: [job("a", { state: "FAILED", errorCode: "boom" })],
        });
        const liste = eigeneAuftraege(lage, JETZT + 60_000, merk);
        expect(vorderster(liste)?.auftrag.auftrag).toBe("a");
        expect(weitere(liste, vorderster(liste))).toBe(2);
        quittiere(liste, merk);
        const danach = eigeneAuftraege(lage, JETZT + 61_000, merk);
        expect(danach.map((a) => a.auftrag.auftrag)).toEqual(["c", "b"]);
        // Ohne Fehlschlag: was läuft, steht vor dem, was wartet.
        expect(vorderster(danach)?.auftrag.auftrag).toBe("c");
    });

    it("🔴 abgebrochen zählt wie gescheitert", () => {
        const merk = neuesGedaechtnis();
        eigeneAuftraege(uebersicht({ queued: [wartend("a")] }), JETZT, merk);
        const liste = eigeneAuftraege(uebersicht({ recent: [job("a", { state: "CANCELLED" })] }), JETZT, merk);
        expect(liste.map((eintrag) => eintrag.stand.stand)).toEqual(["fehlgeschlagen"]);
    });

    it("🔴 WI-0248: ein Ende, das der Auftrag selbst meldet (etaAt, der Release-Test), gibt die Restzeit; die Phase reist mit", () => {
        const merk = neuesGedaechtnis();
        const test = job("r", {
            kind: "release_test",
            state: "RUNNING",
            startedAt: iso(-600),
            phase: "tests",
            progress: 0.4,
            etaAt: iso(4_000),
        });
        const [laufend] = eigeneAuftraege(uebersicht({ running: [test] }), JETZT, merk);
        expect(laufend).toMatchObject({ stand: { stand: "laeuft" }, anteil: 0.4, phase: "tests" });
        expect(laufend?.stand.rest).toBeCloseTo(4_000, 5);
        // Ohne etaAt bleibt es bei der Schätzung, ohne Phase ohne Phase.
        const ohne = eigeneAuftraege(
            uebersicht({ running: [job("o", { state: "RUNNING", startedAt: iso(-1) })] }),
            JETZT,
            merk,
        )[0];
        expect(ohne?.stand).toEqual({ stand: "laeuft" });
        expect(ohne).not.toHaveProperty("phase");
    });

    it("WI-0248: ein wartender Auftrag trägt seinen Wartegrund (die Freigabe wartet auf ihre Abholung)", () => {
        const [freigabe] = eigeneAuftraege(
            uebersicht({
                queued: [
                    wartend("f", { kind: "production_freigabe", origin: "recorded", waitReason: "waits_pickup" }, null),
                ],
            }),
            JETZT,
            neuesGedaechtnis(),
        );
        expect(freigabe).toMatchObject({
            auftrag: { art: "production_freigabe" },
            stand: { stand: "wartet" },
            grund: "waits_pickup",
        });
    });

    it("ohne Übersicht (kein Recht, Statusseite aus, nicht angemeldet): nichts", () => {
        expect(eigeneAuftraege(null, JETZT, neuesGedaechtnis())).toEqual([]);
        expect(vorderster([])).toBeNull();
    });
});
