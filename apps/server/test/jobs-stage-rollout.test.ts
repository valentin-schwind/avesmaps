import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leaseSecondsFor, getJobsConfig } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { runJobsCli, type CliIo } from "../src/jobs/cli-commands.ts";
import {
    JOB_KIND_CATALOG,
    STAGE_ROLLOUT_PHASES,
    STAGE_ROLLOUT_REF,
    claimsSlot,
    expectedMemoryMb,
    phaseProgress,
} from "../src/jobs/kinds.ts";
import { buildJobsOverview } from "../src/jobs/overview.ts";
import { insertJob } from "../src/jobs/store.ts";
import { fakeMemory, testJobsConfig, uniqueScope } from "./support/jobs-support.ts";

/**
 * Die Auslieferung auf die Stage als aufgezeichneter Job (WI-0143; Auftrag Claudio,
 * `handovers/2026-10-13-auslieferung-in-der-warteschlange.md`; Betreiber 2026-10-13: „sie soll auch in der warte schlange
 * angezeigt werden, dafür ist die doch da. für jobs, die länger brauchen“).
 *
 * 🔴 Der Fall, der alles entscheidet: Die Auslieferung stellt sich HINTER die Warteschlange, sie stellt sich nicht in sie. Ein
 * laufender `stage_rollout` darf keinen Job aufhalten — sonst wartete die Auslieferung auf die Geländerechnung und die
 * Geländerechnung auf die Auslieferung.
 */

describe("stage_rollout: die Jobart", () => {
    it("ist aufgezeichnet, rechnet nichts und belegt keinen Platz", () => {
        const spec = JOB_KIND_CATALOG["stage_rollout"];
        expect(spec).toBeDefined();
        expect(spec?.origin).toBe("recorded");
        expect(spec?.threads).toBe(0);
        expect(spec?.holdsSharedDomainLock).toBe(false);
        expect(spec?.claimsSlot).toBe(false);
        // Kein Speicherschlüssel heißt: kostet nichts, nicht „unbekannt“ (sonst liefe die Art allein).
        expect(spec?.memoryKey({}, null)).toBeNull();
        expect(expectedMemoryMb(spec!, {}, null, testJobsConfig(), null)).toBe(0);
    });

    it("🔴 nur beobachtende Läufe sind vom Platz befreit; eine unbekannte Art zählt im Zweifel mit", () => {
        expect(claimsSlot("stage_rollout")).toBe(false);
        expect(claimsSlot("rollout")).toBe(false);
        expect(claimsSlot("terrain_full")).toBe(true);
        expect(claimsSlot("legacy_pull")).toBe(true);
        expect(claimsSlot("eine_art_aus_dem_naechsten_release")).toBe(true);
    });

    it("die Phasen stehen in der Reihenfolge des Rollouts, der Fortschritt steigt", () => {
        expect(STAGE_ROLLOUT_PHASES.map((phase) => phase.name)).toEqual([
            "wartet",
            "bauen",
            "migrieren",
            "umschalten",
            "proben",
        ]);
        const anteile = STAGE_ROLLOUT_PHASES.map((phase) => phase.progress);
        expect(anteile).toEqual([...anteile].sort((a, b) => a - b));
        expect(anteile.at(-1)).toBeLessThan(1);
        expect(phaseProgress("stage_rollout", "umschalten")).toBe(0.7);
        // Eine fremde Phase hat keinen Anteil, und eine Art ohne Tafel auch nicht.
        expect(phaseProgress("stage_rollout", "tanzen")).toBeNull();
        expect(phaseProgress("import", "I11")).toBeNull();
    });

    it("die Lease trägt mehrere ausgefallene Takte von auto-stage.sh (10 min)", () => {
        for (const profile of ["local", "staging"] as const) {
            const seconds = leaseSecondsFor(getJobsConfig(profile), "stage_rollout", true);
            expect(seconds, profile).toBeGreaterThanOrEqual(1800);
        }
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function capture(): { io: CliIo; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

describeWithDatabase("stage_rollout: aufzeichnen aus auto-stage.sh", { timeout: 45_000 }, () => {
    let database: Database;

    const environment = (): NodeJS.ProcessEnv => ({
        DATABASE_URL: testDatabaseUrl as string,
        JOBS_PROFILE: "staging",
        RELEASE_ID: "test-release",
    });

    async function run(argv: string[]) {
        const output = capture();
        const code = await runJobsCli(argv, environment(), output.io);
        return { code, out: output.out, err: output.err };
    }

    /** Ein Takt von `auto-stage.sh`: EIN Aufruf, ob der Lauf gerade entsteht oder schon läuft. */
    function takt(label: string, phase: string, waitReason?: string) {
        return run([
            "record",
            "start",
            "--kind",
            "stage_rollout",
            "--ref",
            STAGE_ROLLOUT_REF,
            "--label",
            label,
            "--phase",
            phase,
            ...(waitReason === undefined ? [] : ["--wait-reason", waitReason]),
            "--strict",
        ]);
    }

    async function row() {
        const [found] = await database<
            {
                public_id: string;
                state: string;
                phase: string | null;
                wait_reason: string | null;
                label: string | null;
                progress: number | null;
                origin: string;
            }[]
        >`
            SELECT public_id, state, phase, wait_reason, label, progress, origin
            FROM job WHERE kind = 'stage_rollout' ORDER BY id DESC LIMIT 1
        `;
        return found;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
    });

    it("wartet, baut, ist fertig: ein Lauf über alle Takte, mit Stand, Grund und Fortschritt", async () => {
        const wartend = await takt("3c75c88d · Neigung bis 85 Grad", "wartet", "hinter Gelände voll: Fassung 17");
        expect(wartend.code, wartend.err.join(" ")).toBe(0);
        const erster = await row();
        expect(erster?.origin).toBe("recorded");
        expect(erster?.state).toBe("RUNNING");
        expect(erster?.phase).toBe("wartet");
        expect(erster?.wait_reason).toBe("hinter Gelände voll: Fassung 17");
        expect(erster?.label).toBe("3c75c88d · Neigung bis 85 Grad");
        expect(erster?.progress).toBeCloseTo(0.05, 5);

        // Zweiter Takt, derselbe Lauf (`external_ref`), aber ein neuerer Stand und ein anderer Grund.
        const nochWartend = await takt("df9490ed · Nur diese anzeigen", "wartet", "hinter 2 Job(s)");
        expect(nochWartend.code).toBe(0);
        const zweiter = await row();
        expect(zweiter?.public_id).toBe(erster?.public_id);
        expect(zweiter?.label).toBe("df9490ed · Nur diese anzeigen");
        expect(zweiter?.wait_reason).toBe("hinter 2 Job(s)");

        // Die Bahn ist frei: der Grund verschwindet, sobald eine Phase ohne ihn gemeldet wird.
        await takt("df9490ed · Nur diese anzeigen", "bauen");
        const bauend = await row();
        expect(bauend?.phase).toBe("bauen");
        expect(bauend?.wait_reason).toBeNull();
        expect(bauend?.progress).toBeCloseTo(0.3, 5);

        const fertig = await run([
            "record",
            "finish",
            "--ref",
            STAGE_ROLLOUT_REF,
            "--kind",
            "stage_rollout",
            "--status",
            "ok",
            "--strict",
        ]);
        expect(fertig.code, fertig.err.join(" ")).toBe(0);
        const ende = await row();
        expect(ende?.state).toBe("SUCCEEDED");
        expect(ende?.progress).toBe(1);
        expect(ende?.wait_reason).toBeNull();

        // Nach dem Ende ist die Kennung wieder frei: der nächste Stand legt einen NEUEN Lauf an.
        await takt("aaaaaaaa · der nächste Stand", "bauen");
        const neuer = await row();
        expect(neuer?.public_id).not.toBe(erster?.public_id);
        expect(neuer?.state).toBe("RUNNING");
    });

    it("🔴 ein laufender stage_rollout hält keinen wartenden Job auf (sonst wartete jeder auf jeden)", async () => {
        await takt("3c75c88d · ein Stand", "wartet", "hinter Gelände voll");
        const terrain = await insertJob(database, {
            kind: "terrain_full",
            mapDomainId: "aventuria",
            origin: "queued",
            actorRef: "test",
            scopeKind: "domain",
        });

        const overview = await buildJobsOverview({
            database,
            config: getJobsConfig("staging"),
            releaseId: "test-release",
            mapDomainId: "aventuria",
            plannerScope: uniqueScope(),
            memory: fakeMemory().probe,
        });

        // Die Auslieferung steht auf der Seite …
        expect(overview.running.map((job) => job.kind)).toContain("stage_rollout");
        // … aber sie bucht keinen Speicher und sperrt keinen Bereich.
        expect(overview.memory?.bookedMb).toBe(0);
        const wartend = overview.queued.find((job) => job.id === terrain.publicId);
        expect(wartend).toBeDefined();
        /*
         * Die harte Zusicherung: Der Geländejob startet JETZT. Stünde die Auslieferung in der Zulassung, wäre sie ein laufender
         * Job mit dem Fußabdruck `domain` und ohne bekannte Dauer — die Schätzung fände keinen Zeitpunkt mehr, an dem er starten
         * kann, und `startAt` bliebe leer. Genau das wäre der Stillstand.
         */
        expect(wartend?.estimate.startAt).not.toBeNull();
        expect(Date.parse(wartend?.estimate.startAt ?? "")).toBeCloseTo(Date.parse(overview.now), -4);
    });
});
