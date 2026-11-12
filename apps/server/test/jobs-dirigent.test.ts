import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { leseWarteschlangeStand, type WarteschlangeStand, type WarteschlangeUmgebung } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import type { Ausfuehrer } from "../src/jobs/dirigent/ausfuehrer.ts";
import {
    Dirigent,
    FEHLT_WARTEN_MS,
    UNVERAENDERT_WARTEN_MS,
    type DirigentOptionen,
} from "../src/jobs/dirigent/dirigent.ts";
import { Quelle } from "../src/jobs/dirigent/quelle.ts";
import { claimJob, completeJob, insertJob } from "../src/jobs/store.ts";
import { fakeMemory, testJobsConfig, uniqueScope, waitFor } from "./support/jobs-support.ts";

/**
 * Der Dirigent (WI-0163 §5.3) gegen echtes PostgreSQL, mit EINER Umgebung und einem gefälschten Ausführer: Er startet den
 * wartenden Auftrag, schreibt den Stand, und 🔴 er schreibt nichts in die Datenbank — nicht einmal einen Wartegrund. Pausiert
 * startet er nichts. Die Planung selbst prüft `jobs-dirigent-plan.test.ts` ohne Datenbank.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const PERSON = "6f1c1f9e-2b8a-4c55-9a51-3e0d6c7b8a90";
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

interface FakeStart {
    umgebung: WarteschlangeUmgebung;
    id: number;
    kind: string;
    ende: (code: number | null) => void;
}

function fakeAusfuehrer(): { ausfuehrer: Ausfuehrer; starts: FakeStart[]; pflege: string[] } {
    const starts: FakeStart[] = [];
    const pflege: string[] = [];
    return {
        starts,
        pflege,
        ausfuehrer: {
            art: "lokal",
            start: (umgebung, id, kind) =>
                new Promise<number | null>((resolve) => {
                    starts.push({ umgebung, id, kind, ende: resolve });
                }),
            pflege: (umgebung) => {
                pflege.push(umgebung);
                return Promise.resolve(0);
            },
            beenden: () => {
                for (const start of starts) start.ende(null);
                return Promise.resolve();
            },
        },
    };
}

describeWithDatabase("Dirigent", { timeout: 60_000 }, () => {
    let database: Database;
    let verzeichnis: string;
    const DOMAIN = "aventuria";
    const dirigenten: Dirigent[] = [];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 8 });
        await migrate(database);
        await seedMapDomains(database);
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
        await setzePause(false);
        verzeichnis = await mkdtemp(join(tmpdir(), "dirigent-"));
    });

    afterEach(async () => {
        for (const dirigent of dirigenten.splice(0)) await dirigent.stop();
        await setzePause(false);
        await setzeHalt("normal");
        await rm(verzeichnis, { recursive: true, force: true });
    });

    /** Kartensperre, eingeschränkter Betrieb oder keins von beiden, direkt in der Zeile (so wie die Kommandozeile sie setzt). */
    async function setzeHalt(halt: "normal" | "kartensperre" | "eingeschraenkt"): Promise<void> {
        await database`
            UPDATE system_state
               SET mode = 'normal', mode_by = NULL, mode_by_label = NULL, mode_reason = NULL,
                   map_lock = false, map_lock_since = NULL, map_lock_by = NULL, map_lock_by_label = NULL, map_lock_reason = NULL
             WHERE id = 1
        `;
        if (halt === "kartensperre") {
            await database`
                UPDATE system_state
                   SET map_lock = true, map_lock_since = now(), map_lock_by_label = 'cli:test', map_lock_reason = 'Test WI-0163'
                 WHERE id = 1
            `;
        }
        if (halt === "eingeschraenkt") {
            await database`
                UPDATE system_state
                   SET mode = 'restricted', mode_since = now(), mode_by_label = 'cli:test', mode_reason = 'Test WI-0163'
                 WHERE id = 1
            `;
        }
    }

    /** Schaltet die Pause direkt in der Zeile, mit Zeitpunkt; `queue_changed_at` nur, wenn Migration 0133 schon da ist. */
    async function setzePause(paused: boolean): Promise<void> {
        const [spalte] = await database<{ da: boolean }[]>`
            SELECT EXISTS (
                SELECT 1 FROM pg_attribute
                 WHERE attrelid = to_regclass('system_state') AND attname = 'queue_changed_at' AND NOT attisdropped
            ) AS da
        `;
        await database`
            UPDATE system_state
               SET queue_paused = ${paused}, queue_paused_since = ${paused ? new Date() : null},
                   queue_paused_by = NULL, queue_paused_by_label = ${paused ? "cli:test" : null},
                   queue_paused_reason = ${paused ? "Datenbank wird gesichert" : null}
             WHERE id = 1
        `;
        if (spalte?.da === true) {
            await database`UPDATE system_state SET queue_changed_at = ${paused ? new Date() : null} WHERE id = 1`;
        }
    }

    function dirigent(
        plannerScope = uniqueScope("dirigent"),
        name = "stand.json",
        optionen: Partial<DirigentOptionen> = {},
    ): { dirigent: Dirigent; fake: ReturnType<typeof fakeAusfuehrer>; datei: string; quelle: Quelle } {
        const fake = fakeAusfuehrer();
        const datei = join(verzeichnis, "warteschlange", name);
        const quelle = new Quelle({
            umgebung: "test",
            database,
            eigeneVerbindung: false,
            mapDomainId: DOMAIN,
            plannerScope,
        });
        const instance = new Dirigent({
            quellen: [quelle],
            ausfuehrer: fake.ausfuehrer,
            config: testJobsConfig(),
            standDatei: datei,
            instanz: "test-dirigent",
            release: "test",
            memory: fakeMemory().probe,
            ...optionen,
        });
        dirigenten.push(instance);
        return { dirigent: instance, fake, datei, quelle };
    }

    const stand = async (datei: string): Promise<WarteschlangeStand> => {
        const gelesen = leseWarteschlangeStand(JSON.parse(await readFile(datei, "utf8")));
        if (gelesen === null) throw new Error("Stand verletzt den Vertrag");
        return gelesen;
    };

    /** Alles, was der Dirigent schreiben KÖNNTE: die Zeilen der Aufträge, die Ereignisse, den Betriebszustand. */
    const spiegel = async () => ({
        jobs: await database`SELECT * FROM job ORDER BY id`,
        events: await database`SELECT seq, kind FROM job_event ORDER BY seq`,
        system: await database`SELECT * FROM system_state WHERE id = 1`,
    });

    const add = (extra: Partial<Parameters<typeof insertJob>[1]> = {}) =>
        insertJob(database, {
            kind: "probe",
            mapDomainId: DOMAIN,
            scopeKind: "tiles",
            scopeTiles: [],
            label: "Probe",
            ...extra,
        });

    it("startet den wartenden Auftrag, schreibt den Stand und 🔴 nichts in die Datenbank", async () => {
        const { dirigent: instance, fake, datei } = dirigent();
        const job = await add();
        const vorher = await spiegel();

        const bericht = await instance.takt();
        expect(bericht.starts.map((entry) => [entry.umgebung, entry.id, entry.kind])).toEqual([
            ["test", job.id, "probe"],
        ]);
        expect(fake.starts.map((entry) => [entry.umgebung, entry.id, entry.kind])).toEqual([["test", job.id, "probe"]]);
        expect(fake.pflege).toEqual(["test"]);

        const geschrieben = await stand(datei);
        expect(geschrieben).toMatchObject({
            schema: 1,
            dirigent: { instanz: "test-dirigent", release: "test" },
            pause: { paused: false },
            umgebungen: [{ name: "test", erreichbar: true, planer: true }],
        });
        expect(geschrieben.auftraege).toEqual([
            expect.objectContaining({
                umgebung: "test",
                id: job.id,
                publicId: job.publicId,
                kind: "probe",
                label: "Probe",
                state: "QUEUED",
                platz: 1,
                wartegrund: null,
                schwer: false,
            }),
        ]);

        // Ein zweiter Takt startet ihn nicht noch einmal: Er ist gestartet, aber noch nicht als RUNNING gelesen.
        expect((await instance.takt()).starts).toEqual([]);
        expect(fake.starts).toHaveLength(1);

        expect(await spiegel()).toEqual(vorher);
    });

    it("endet der Ausführer, ohne die Zeile zu übernehmen, wartet der Auftrag mit waits_executor statt im Takt neu zu starten", async () => {
        const { dirigent: instance, fake, datei } = dirigent();
        const job = await add();
        await instance.takt();
        fake.starts[0]?.ende(0);
        // Die Antwort wird mit einer Lesung ausgewertet, die NACH dem Ende beginnt.
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect((await instance.takt()).starts).toEqual([]);
        expect(fake.starts).toHaveLength(1);
        expect((await stand(datei)).auftraege).toEqual([
            expect.objectContaining({ id: job.id, wartegrund: "waits_executor" }),
        ]);
    });

    it("Exit 3: die Umgebung kann ihn noch nicht ausführen, er wartet mit waits_executor", async () => {
        const { dirigent: instance, fake, datei } = dirigent();
        const job = await add();
        await instance.takt();
        fake.starts[0]?.ende(3);
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect((await instance.takt()).starts).toEqual([]);
        expect((await stand(datei)).auftraege).toEqual([
            expect.objectContaining({ id: job.id, platz: 1, wartegrund: "waits_executor" }),
        ]);
    });

    describe("hängende Aufträge (WI-0179)", () => {
        // Die Rückstellungen dauern Minuten; nur die Uhr der Zeitpunkte springt, die Takte und die Datenbank laufen echt.
        beforeEach(() => {
            vi.useFakeTimers({ toFake: ["Date"] });
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        const kurz = () => new Promise((resolve) => setTimeout(resolve, 20));

        /** Startet den Auftrag, lässt den Ausführer mit `code` enden und wartet die Rückstellung ab. */
        async function ablehnen(
            instance: Dirigent,
            fake: ReturnType<typeof fakeAusfuehrer>,
            code: number,
            wartenMs: number,
        ): Promise<void> {
            const vorher = fake.starts.length;
            await instance.takt();
            expect(fake.starts).toHaveLength(vorher + 1);
            fake.starts[vorher]?.ende(code);
            await kurz();
            // Ausgewertet wird mit einer Lesung, die NACH dem Ende beginnt; die eingefrorene Uhr muss dafür weiter.
            vi.setSystemTime(Date.now() + 10);
            await instance.takt();
            vi.setSystemTime(Date.now() + wartenMs + 1_000);
        }

        it("🔴 dreimal Exit 3 für denselben Versuch: er hängt im Stand; übernimmt der Ausführer ihn, ist es vorbei", async () => {
            const { dirigent: instance, fake, datei } = dirigent();
            const job = await add({ label: "Legacy-Zug: Landschaften" });
            await ablehnen(instance, fake, 3, FEHLT_WARTEN_MS);
            await ablehnen(instance, fake, 3, FEHLT_WARTEN_MS);
            expect((await stand(datei)).auftraege[0]).not.toHaveProperty("haengt");

            // Die dritte Ablehnung: Der Grund des Dirigenten bleibt `waits_executor`, dazu steht der Befund.
            await instance.takt();
            fake.starts[2]?.ende(3);
            await kurz();
            vi.setSystemTime(Date.now() + 10);
            await instance.takt();
            expect((await stand(datei)).auftraege).toEqual([
                expect.objectContaining({
                    id: job.id,
                    wartegrund: "waits_executor",
                    haengt: expect.objectContaining({ ablehnungen: 3, grund: "exit_3", code: 3, attempt: 0 }),
                }),
            ]);

            // Erfolg: Der Ausführer übernimmt ihn (RUNNING); der Befund fällt weg.
            vi.setSystemTime(Date.now() + FEHLT_WARTEN_MS + 1_000);
            await instance.takt();
            expect(fake.starts).toHaveLength(4);
            expect(await claimJob(database, job.id, "ausfuehrer", 60)).not.toBeNull();
            fake.starts[3]?.ende(0);
            await kurz();
            vi.setSystemTime(Date.now() + 10);
            await instance.takt();
            expect((await stand(datei)).auftraege).toEqual([
                expect.not.objectContaining({ haengt: expect.anything() }),
            ]);
            expect((await stand(datei)).auftraege[0]).toMatchObject({ id: job.id, state: "RUNNING" });
        });

        it("Claudios Exit 70 (Einrichtungsfehler): der Ausführer endet ohne Übernahme, dreimal, dann hängt er", async () => {
            const { dirigent: instance, fake, datei } = dirigent();
            const job = await add();
            // Der letzte Takt in `ablehnen` hat die dritte Antwort ausgewertet und den Stand geschrieben.
            for (let n = 0; n < 3; n += 1) await ablehnen(instance, fake, 70, UNVERAENDERT_WARTEN_MS);
            expect((await stand(datei)).auftraege).toEqual([
                expect.objectContaining({
                    id: job.id,
                    haengt: expect.objectContaining({ ablehnungen: 3, grund: "unveraendert", code: 70 }),
                }),
            ]);
        });

        it("Exit 75 dazwischen (die Sperre der Domäne): Der Ausführer arbeitet, die Serie beginnt von vorn", async () => {
            const { dirigent: instance, fake, datei } = dirigent();
            await add();
            await ablehnen(instance, fake, 3, FEHLT_WARTEN_MS);
            await ablehnen(instance, fake, 3, FEHLT_WARTEN_MS);
            await ablehnen(instance, fake, 75, 60_000);
            await ablehnen(instance, fake, 3, FEHLT_WARTEN_MS);
            expect((await stand(datei)).auftraege[0]).not.toHaveProperty("haengt");
        });
    });

    it("🔴 warum ein Auftrag wartet, steht je Wechsel einmal im Log, nicht je Takt (WI-0283)", async () => {
        const zeilen: { kind?: unknown; wartegrund?: unknown; memAvailableMb?: unknown }[] = [];
        const log = {
            info: (felder: Record<string, unknown>, text: string) => {
                if (text === "dirigent: Auftrag wartet") zeilen.push(felder);
            },
            warn: () => undefined,
            error: () => undefined,
        };
        const speicher = fakeMemory({ availableMb: 100 });
        const { dirigent: instance } = dirigent(uniqueScope("dirigent"), "stand.json", { log, memory: speicher.probe });
        await add({ notBefore: new Date(Date.now() + 600_000) });
        await instance.takt();
        await instance.takt();
        expect(zeilen).toEqual([
            expect.objectContaining({ kind: "probe", wartegrund: "debouncing", memAvailableMb: 100 }),
        ]);
    });

    it("Exit 76: das Speichertor des Wrappers lehnt ab, er wartet mit waits_memory", async () => {
        const { dirigent: instance, fake, datei } = dirigent();
        const job = await add();
        await instance.takt();
        fake.starts[0]?.ende(76);
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect((await instance.takt()).starts).toEqual([]);
        expect((await stand(datei)).auftraege).toEqual([
            expect.objectContaining({ id: job.id, platz: 1, wartegrund: "waits_memory" }),
        ]);
    });

    it("🔴 pausiert startet er nichts; jeder wartende sagt warum, und auch das steht nur im Stand, nicht in der Tafel", async () => {
        const { dirigent: instance, fake, datei } = dirigent();
        const job = await add();
        await setzePause(true);
        const vorher = await spiegel();

        const bericht = await instance.takt();
        expect(bericht.starts).toEqual([]);
        expect(fake.starts).toEqual([]);
        const geschrieben = await stand(datei);
        expect(geschrieben.pause).toMatchObject({
            paused: true,
            umgebung: "test",
            byLabel: "cli:test",
            reason: "Datenbank wird gesichert",
        });
        expect(geschrieben.auftraege).toEqual([
            expect.objectContaining({ id: job.id, platz: 1, wartegrund: "waits_queue_paused" }),
        ]);
        expect(await spiegel()).toEqual(vorher);

        // Fortsetzen: der nächste Takt startet ihn.
        await setzePause(false);
        expect((await instance.takt()).starts.map((entry) => entry.id)).toEqual([job.id]);
    });

    it("ein Planer je Umgebung: zwei Dirigenten mit derselben Planersperre, nur einer startet; der andere sagt planer: false", async () => {
        const scope = uniqueScope("dirigent");
        const erster = dirigent(scope, "erster.json");
        const zweiter = dirigent(scope, "zweiter.json");
        const job = await add();
        expect((await erster.dirigent.takt()).starts.map((entry) => entry.id)).toEqual([job.id]);
        expect((await zweiter.dirigent.takt()).starts).toEqual([]);
        expect(zweiter.fake.starts).toEqual([]);
        const fremd = await stand(zweiter.datei);
        expect(fremd.umgebungen).toEqual([{ name: "test", erreichbar: true, planer: false }]);
        // Er zeigt den Auftrag trotzdem, mit dem Grund aus der Tafel (hier keiner: niemand schreibt ihn mehr).
        expect(fremd.auftraege).toEqual([expect.objectContaining({ id: job.id, platz: 1, wartegrund: null })]);

        // Geht der erste, plant der zweite beim nächsten Takt.
        await erster.dirigent.stop();
        dirigenten.splice(dirigenten.indexOf(erster.dirigent), 1);
        expect((await zweiter.dirigent.takt()).starts.map((entry) => entry.id)).toEqual([job.id]);
    });

    it("fällt der Planer aus, übernimmt der andere und achtet laufende Leases", async () => {
        const scope = uniqueScope("dirigent");
        const erster = dirigent(scope, "erster.json");
        const zweiter = dirigent(scope, "zweiter.json");
        const laufend = await add();
        // Ein Ausführer des ersten hat den Auftrag übernommen: RUNNING mit gültiger Lease.
        expect(await claimJob(database, laufend.id, "ausfuehrer-des-ersten", 60)).not.toBeNull();
        expect((await erster.dirigent.takt()).starts).toEqual([]);
        await erster.dirigent.stop();
        dirigenten.splice(dirigenten.indexOf(erster.dirigent), 1);

        expect((await zweiter.dirigent.takt()).starts).toEqual([]);
        expect(zweiter.fake.starts).toEqual([]);
        const geschrieben = await stand(zweiter.datei);
        expect(geschrieben.umgebungen).toEqual([{ name: "test", erreichbar: true, planer: true }]);
        expect(geschrieben.auftraege).toEqual([
            expect.objectContaining({ id: laufend.id, state: "RUNNING", platz: null, wartegrund: null }),
        ]);
    });

    it("NOTIFY weckt: ein neuer Auftrag startet ohne den Takt; ein frei gewordener Platz weckt den nächsten", async () => {
        // Ein Takt von einer Minute: Was hier startet, hat NOTIFY oder das Ende eines Ausführers geweckt.
        const {
            dirigent: instance,
            fake,
            quelle,
        } = dirigent(undefined, undefined, {
            config: testJobsConfig({ maxConcurrent: { value: { probe: 1, import: 1 } } }),
            taktMs: 60_000,
        });
        instance.start();
        // Ein NOTIFY vor dem LISTEN ginge verloren (im Betrieb fände ihn der nächste Takt): erst hören, dann einreihen.
        await waitFor(() => quelle.hoertZu() && fake.pflege.length > 0, 10_000, "LISTEN und erster Takt");
        const erster = await add();
        await waitFor(() => fake.starts.length === 1, 10_000, "Start auf NOTIFY");
        const zweiter = await add();
        // Der zweite wartet (ein Platz für `probe`), bis der erste fertig ist.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(fake.starts.map((entry) => entry.id)).toEqual([erster.id]);

        const claimed = await claimJob(database, erster.id, "ausfuehrer", 60);
        await completeJob(database, erster.id, claimed?.leaseNo ?? 0, {});
        fake.starts[0]?.ende(0);
        await waitFor(() => fake.starts.length === 2, 10_000, "Start nach dem Ende des ersten");
        expect(fake.starts[1]?.id).toBe(zweiter.id);
    });

    it("eine abgelaufene Lease holt die Pflege sofort, sonst nur im Abstand", async () => {
        const { dirigent: instance, fake } = dirigent(undefined, undefined, { pflegeFruehestensMs: 0 });
        await instance.takt();
        expect(fake.pflege).toEqual(["test"]);
        const job = await add();
        await claimJob(database, job.id, "verschwunden", 60);
        await instance.takt();
        expect(fake.pflege).toEqual(["test"]);
        await database`UPDATE job SET lease_expires_at = now() - make_interval(secs => 1) WHERE id = ${job.id}`;
        await instance.takt();
        expect(fake.pflege).toEqual(["test", "test"]);
    });

    for (const halt of ["kartensperre", "eingeschraenkt"] as const) {
        it(`unter ${halt === "kartensperre" ? "Kartensperre" : "eingeschränktem Betrieb"} startet kein neuer Editor-Job (waits_system_lock), ohne Person läuft er`, async () => {
            const { dirigent: instance, fake, datei } = dirigent();
            await setzeHalt(halt);
            const editor = await add({ actorRef: PERSON });
            const ohnePerson = await add();
            expect((await instance.takt()).starts.map((entry) => entry.id)).toEqual([ohnePerson.id]);
            expect(fake.starts.map((entry) => entry.id)).toEqual([ohnePerson.id]);
            expect((await stand(datei)).auftraege).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: editor.id, wartegrund: "waits_system_lock" })]),
            );
        });
    }
});
