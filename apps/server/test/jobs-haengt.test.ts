import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    WAIT_REASONS,
    WarteschlangeAuftrag,
    leseWarteschlangeStand,
    type WarteschlangeStand,
} from "@avesmaps3d/shared";
import { HAENGT_AB_ABLEHNUNGEN, HaengtZaehler } from "../src/jobs/dirigent/haengt.ts";
import type { QuelleLage, ReiheEintrag } from "../src/jobs/dirigent/plan.ts";
import { baueStand } from "../src/jobs/dirigent/stand.ts";
import { gemeinsameWarteschlange, grundAusStand, standAuftraege } from "../src/jobs/gemeinsame-reihe.ts";
import { haengtQuelle, haengtText } from "../src/jobs/haengt-melder.ts";
import type { JobRow } from "../src/jobs/rows.ts";

/**
 * Hängende Aufträge (WI-0179) ohne Datenbank: der Zähler des Dirigenten, das Feld im Stand und der Grund, den die App daraus liest.
 *
 * Problemfall, der das Paket ausgelöst hat (2026-10-15): Seit 07:25 wies der Wrapper jeden Korridor-Auftrag mit Exit 3 ab, der
 * Dirigent stellte ihn acht Stunden lang alle fünf Minuten still zurück, in der Oberfläche stand „Wartet“. Soll: Ab der dritten
 * gleichen Ablehnung desselben Versuchs hängt der Auftrag, und das steht im Stand; jede andere Antwort des Ausführers setzt zurück.
 */

const NOW = Date.parse("2026-10-15T07:25:00.000Z");
const MIN = 60_000;
const LEGACY_ZUG = { umgebung: "production" as const, id: 81, attempt: 0 };

describe("Hängende Aufträge: der Zähler des Dirigenten", () => {
    it("die Schwelle: zwei gleiche Ablehnungen sind Warten, die dritte macht ihn hängend, gemeldet genau einmal", () => {
        expect(HAENGT_AB_ABLEHNUNGEN).toBe(3);
        const zaehler = new HaengtZaehler();
        expect(zaehler.zaehle(LEGACY_ZUG, "exit_3", 3, NOW)).toEqual({ ablehnungen: 1, jetztHaengend: false });
        expect(zaehler.zaehle(LEGACY_ZUG, "exit_3", 3, NOW + 5 * MIN)).toEqual({
            ablehnungen: 2,
            jetztHaengend: false,
        });
        expect(zaehler.haengt("production", 81)).toBeNull();
        expect(zaehler.zaehle(LEGACY_ZUG, "exit_3", 3, NOW + 10 * MIN)).toEqual({
            ablehnungen: 3,
            jetztHaengend: true,
        });
        expect(zaehler.haengt("production", 81)).toEqual({
            seit: "2026-10-15T07:25:00.000Z",
            ablehnungen: 3,
            grund: "exit_3",
            code: 3,
            attempt: 0,
        });
        // Jeder weitere Versuch zählt mit, meldet sich aber nicht noch einmal.
        expect(zaehler.zaehle(LEGACY_ZUG, "exit_3", 3, NOW + 15 * MIN)).toEqual({
            ablehnungen: 4,
            jetztHaengend: false,
        });
        expect(zaehler.haengt("production", 81)?.ablehnungen).toBe(4);
    });

    it("Claudios Exit 70 zählt als „unverändert“ und trägt seinen Code; dieselbe Kennung in der anderen Umgebung ist ein anderer Auftrag", () => {
        const zaehler = new HaengtZaehler();
        for (let n = 0; n < 3; n += 1)
            zaehler.zaehle({ umgebung: "staging", id: 81, attempt: 2 }, "unveraendert", 70, NOW + n * MIN);
        expect(zaehler.haengt("staging", 81)).toMatchObject({ grund: "unveraendert", code: 70, attempt: 2 });
        expect(zaehler.haengt("production", 81)).toBeNull();
    });

    it("zurückgesetzt: ein anderer Grund und ein neuer Versuch beginnen bei eins", () => {
        const zaehler = new HaengtZaehler();
        zaehler.zaehle(LEGACY_ZUG, "exit_3", 3, NOW);
        zaehler.zaehle(LEGACY_ZUG, "exit_3", 3, NOW + 5 * MIN);
        expect(zaehler.zaehle(LEGACY_ZUG, "exit_2", 2, NOW + 10 * MIN).ablehnungen).toBe(1);
        expect(zaehler.zaehle({ ...LEGACY_ZUG, attempt: 1 }, "exit_2", 2, NOW + 15 * MIN).ablehnungen).toBe(1);
        expect(zaehler.haengt("production", 81)).toBeNull();
    });

    it("zurückgesetzt bei Erfolg: `loese` sagt, ob er bis eben hing; danach beginnt alles von vorn", () => {
        const zaehler = new HaengtZaehler();
        for (let n = 0; n < 3; n += 1) zaehler.zaehle(LEGACY_ZUG, "exit_3", 3, NOW + n * 5 * MIN);
        expect(zaehler.loese("production", 81)).toBe(true);
        expect(zaehler.haengt("production", 81)).toBeNull();
        expect(zaehler.loese("production", 81)).toBe(false);
        expect(zaehler.zaehle(LEGACY_ZUG, "exit_3", 3, NOW + 20 * MIN).ablehnungen).toBe(1);
    });

    it("abgeglichen mit der Lesung: übernommen oder neuer Versuch fällt heraus, wartend bleibt, eine unlesbare Umgebung behält ihre", () => {
        const zaehler = new HaengtZaehler();
        const ablehnen = (umgebung: "staging" | "production", id: number) => {
            for (let n = 0; n < 3; n += 1) zaehler.zaehle({ umgebung, id, attempt: 0 }, "exit_3", 3, NOW + n * MIN);
        };
        ablehnen("production", 81); // wartet weiter, gleicher Versuch
        ablehnen("production", 82); // übernommen: nicht mehr wartend
        ablehnen("production", 83); // neuer Versuch
        ablehnen("staging", 9); // Umgebung gerade nicht lesbar
        const geloest = zaehler.abgleichen([
            lage("production", [
                job({ id: 81, kind: "legacy_zug" }),
                job({ id: 83, kind: "terrain_full", attempt: 1 }),
            ]),
            { ...lage("staging", []), erreichbar: false },
        ]);
        expect(geloest).toEqual([
            { umgebung: "production", id: 82 },
            { umgebung: "production", id: 83 },
        ]);
        expect(zaehler.haengt("production", 81)).not.toBeNull();
        expect(zaehler.haengt("staging", 9)).not.toBeNull();
    });
});

describe("Hängende Aufträge: der Stand", () => {
    const reihe: ReiheEintrag[] = [
        {
            umgebung: "staging",
            job: job({ id: 7, kind: "media_derive", state: "RUNNING", startedAt: new Date(NOW) }),
            platz: null,
            wartegrund: null,
            schwer: false,
        },
        {
            umgebung: "production",
            job: job({ id: 81, kind: "legacy_zug", label: "Legacy-Zug: Landschaften" }),
            platz: 1,
            wartegrund: "waits_executor",
            schwer: true,
        },
    ];
    const zaehler = new HaengtZaehler();
    for (let n = 0; n < 3; n += 1) zaehler.zaehle(LEGACY_ZUG, "exit_3", 3, NOW + n * 5 * MIN);
    for (let n = 0; n < 3; n += 1)
        zaehler.zaehle({ umgebung: "staging", id: 7, attempt: 0 }, "exit_3", 3, NOW + n * 5 * MIN);

    const { stand } = baueStand({
        nowMs: NOW + 10 * MIN,
        dirigent: { instanz: "vps:1", release: "abc", taktS: 2 },
        pause: { paused: false, umgebung: null, changedAt: null, since: null, by: null, byLabel: null, reason: null },
        umgebungen: [
            { name: "staging", erreichbar: true, planer: true },
            { name: "production", erreichbar: true, planer: true },
        ],
        reihe,
        haengt: (umgebung, id) => zaehler.haengt(umgebung, id),
    });
    const gelesen = leseWarteschlangeStand(JSON.parse(JSON.stringify(stand))) as WarteschlangeStand;

    it("steht am wartenden Auftrag, nie an einem laufenden; der Wartegrund des Dirigenten bleibt `waits_executor`", () => {
        expect(gelesen).not.toBeNull();
        expect(gelesen.auftraege[0]).not.toHaveProperty("haengt");
        expect(gelesen.auftraege[1]).toMatchObject({
            wartegrund: "waits_executor",
            haengt: { ablehnungen: 3, grund: "exit_3", code: 3, attempt: 0 },
        });
    });

    it("🔴 ein älterer Leser (Vertrag ohne `haengt`) liest den neuen Stand, ein neuerer Grund macht ihn nicht unlesbar", () => {
        const alterAuftrag = Type.Omit(WarteschlangeAuftrag, ["haengt"]);
        for (const auftrag of gelesen.auftraege) expect(Value.Check(alterAuftrag, auftrag)).toBe(true);
        const kuenftig = JSON.parse(JSON.stringify(stand)) as WarteschlangeStand;
        kuenftig.auftraege[1]!.haengt!.grund = "exit_99_kuenftig";
        expect(leseWarteschlangeStand(kuenftig)).not.toBeNull();
    });

    it("die App liest daraus `waits_executor_stuck`, für die eigenen wie für die fremden Aufträge; die Pause übersteuert", () => {
        expect(WAIT_REASONS).toContain("waits_executor_stuck");
        expect(grundAusStand(gelesen.auftraege[1]!)).toBe("waits_executor_stuck");
        expect(grundAusStand(gelesen.auftraege[0]!)).toBeNull();
        const lageOk = { zustand: "ok" as const, stand: gelesen };
        expect(standAuftraege(lageOk, "production")?.gruende.get(gelesen.auftraege[1]!.publicId)).toBe(
            "waits_executor_stuck",
        );
        const aufStage = gemeinsameWarteschlange(lageOk, "staging", null);
        expect(aufStage?.reihe.map((auftrag) => [auftrag.umgebung, auftrag.eigen, auftrag.waitReason])).toEqual([
            ["staging", true, null],
            ["production", false, "waits_executor_stuck"],
        ]);
        const pausiert = gemeinsameWarteschlange(lageOk, "staging", {
            paused: true,
            since: null,
            by: null,
            reason: null,
        });
        expect(pausiert?.reihe[1]?.waitReason).toBe("waits_queue_paused");
    });

    it("die Meldung: einmal je Umgebung, Auftrag und Versuch; Text die Bezeichnung, sonst die Art", () => {
        expect(haengtQuelle(gelesen.auftraege[1]!)).toBe("haengt:production-81-0");
        expect(
            haengtQuelle({ ...gelesen.auftraege[1]!, haengt: { ...gelesen.auftraege[1]!.haengt!, attempt: 1 } }),
        ).toBe("haengt:production-81-1");
        expect(haengtText(gelesen.auftraege[1]!)).toBe("Legacy-Zug: Landschaften");
        expect(haengtText({ label: "  ", kind: "legacy_zug" })).toBe("legacy_zug");
        expect(haengtText({ label: "ä".repeat(400), kind: "x" })).toHaveLength(300);
    });
});

function lage(umgebung: "staging" | "production", queued: JobRow[]): QuelleLage {
    return {
        umgebung,
        erreichbar: true,
        planer: true,
        queued,
        running: [],
        offeneAbhaengigkeiten: new Set(),
        rssVerlauf: {},
        rolloutAktiv: false,
        editorHalt: false,
        pause: null,
    };
}

function job(partial: Partial<JobRow> & { id: number; kind: string }): JobRow {
    const queuedAt = new Date(NOW - MIN);
    return {
        publicId: `00000000-0000-4000-8000-${String(partial.id).padStart(12, "0")}`,
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
