import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RELEASE_TEST_URL, type ReleaseTestSicht } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Routen des Release-Tests (WI-0248 L) gegen echtes PostgreSQL, mit einem Ersatz für den Starter (`support/release-test-starter.mjs`): ein echter
 * Prozessaufruf, aber ein Skript, das aus `zustand.json` antwortet und nie einen Test startet.
 *
 * 🔴 Die Sätze, auf die es ankommt:
 * 1. **Nur lokal** — ohne `config.releaseTest` gibt es die Routen nicht.
 * 2. **Nur Betreiber; Starten nur mit frischem Passkey, Abbrechen ohne.**
 * 3. **Eine Handlung, ein Ereignis** — und nichts, wo die Vorprüfung ablehnt.
 * 4. **Der Starter sieht die Umgebung des Servers nicht.**
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const STAGE = "a".repeat(40);
const AUFTRAG = "b".repeat(40);
const ANDERER = "c".repeat(40);

const KANDIDAT = {
    stage: { sha: STAGE, zeit: "2026-10-23T08:00:00Z" },
    auftrag: { sha: AUFTRAG, zeit: "2026-10-23T09:00:00Z", ops: "OPS-000123" },
};
const LAUF = (zustand: string) => ({
    zustand,
    sha: AUFTRAG,
    fertigeTeile: [],
    sperre: zustand === "laeuft",
    jetzt: "2026-10-23T10:00:00.000Z",
    schritte: [{ id: "vorbereitung", zustand: "offen", erwartetMs: 1000, schaetzung: true }],
    erwartetMs: 1000,
    erwartetSchaetzung: true,
    fortschritt: 0,
});

describeWithDatabase("Release-Test-Routen (PostgreSQL, Ersatz-Starter)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let ohneRoute: FastifyInstance;
    let ordner: string;
    let betreiber: { id: string; cookie: string };
    let betreiberAlt: { cookie: string };
    let admin: { cookie: string };

    const setze = (zustand: Record<string, unknown>): void => {
        writeFileSync(join(ordner, "zustand.json"), JSON.stringify(zustand), "utf8");
    };
    const aufrufe = (): { argumente: string[]; umgebung: string[] }[] => {
        try {
            return readFileSync(join(ordner, "aufrufe.jsonl"), "utf8")
                .trim()
                .split("\n")
                .filter((z) => z !== "")
                .map((z) => JSON.parse(z) as { argumente: string[]; umgebung: string[] });
        } catch {
            return [];
        }
    };
    const startAufrufe = () =>
        aufrufe().filter((a) => a.argumente.includes("--commit") && !a.argumente.includes("--trocken"));
    const config = (releaseTest: ServerConfig["releaseTest"]): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "release-test-routen",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
        ...(releaseTest === undefined ? {} : { releaseTest }),
    });
    const baue = async (releaseTest: ServerConfig["releaseTest"]): Promise<FastifyInstance> => {
        const instanz = buildApp({
            config: config(releaseTest),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await instanz.ready();
        return instanz;
    };
    const code = (antwort: { statusCode: number; json(): unknown }): string =>
        antwort.statusCode < 300
            ? String(antwort.statusCode)
            : (antwort.json() as { error: { code: string } }).error.code;
    const lesen = (cookie = betreiber.cookie, instanz = app) =>
        instanz.inject({ method: "GET", url: RELEASE_TEST_URL, headers: { cookie } });
    const schreiben = (
        weg: "starten" | "abbrechen",
        commit: string,
        cookie = betreiber.cookie,
        operationId: string = randomUUID(),
        instanz = app,
        zusatz: Record<string, unknown> = {},
    ) =>
        instanz.inject({
            method: "POST",
            url: `${RELEASE_TEST_URL}/${weg}`,
            payload: { operationId, commit, ...zusatz },
            headers: { cookie, origin: TEST_ORIGIN },
        });
    /** „Rote Teile wiederholen“ ist ein Start desselben Stands mit `wiederholen: true`. */
    const wiederholen = (commit: string, cookie = betreiber.cookie) =>
        schreiben("starten", commit, cookie, randomUUID(), app, { wiederholen: true });
    const wiederholAufrufe = () =>
        aufrufe().filter((a) => a.argumente.includes("--wiederholen") && !a.argumente.includes("--trocken"));
    const ereignisse = async (action: string): Promise<{ details: unknown }[]> =>
        await database<{ details: unknown }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE environment = 'test' AND action = ${action} ORDER BY at
        `;
    /** Die Aufträge des Release-Tests in der Testdatenbank, ältester zuerst. */
    const auftraege = async () =>
        await database<
            {
                public_id: string;
                state: string;
                origin: string;
                actor_ref: string | null;
                external_ref: string | null;
                label: string | null;
                input_ref: Record<string, unknown>;
                cancel_reason: string | null;
                cancel_requested_at: Date | null;
            }[]
        >`
            SELECT public_id::text, state, origin, actor_ref, external_ref, label, input_ref, cancel_reason, cancel_requested_at
              FROM job WHERE kind = 'release_test' ORDER BY id
        `;

    beforeAll(async () => {
        ordner = mkdtempSync(join(tmpdir(), "avm-release-test-"));
        copyFileSync(
            fileURLToPath(new URL("./support/release-test-starter.mjs", import.meta.url)),
            join(ordner, "starter.mjs"),
        );
        setze({ kandidat: KANDIDAT, stand: LAUF("keiner") });
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        app = await baue({ starter: join(ordner, "starter.mjs"), ausgabe: join(ordner, "ausgabe") });
        ohneRoute = await baue(undefined);
        const person = async (role: "operator" | "admin", name: string, minuten: number) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: minuten });
            return { ...created, cookie };
        };
        betreiber = await person("operator", "Rondrikan", 1);
        betreiberAlt = await person("operator", "Travine", 600);
        admin = await person("admin", "Admina", 1);
    });

    beforeEach(async () => {
        rmSync(join(ordner, "aufrufe.jsonl"), { force: true });
        setze({ kandidat: KANDIDAT, stand: LAUF("keiner") });
        await database`DELETE FROM job WHERE kind = 'release_test'`;
    });

    afterAll(async () => {
        await app?.close();
        await ohneRoute?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (ordner !== undefined) rmSync(ordner, { recursive: true, force: true });
    });

    it("🔴 nur lokal: Ohne die Einstellung des Servers gibt es die Routen nicht; mit ihr antworten sie", async () => {
        expect((await lesen(betreiber.cookie, ohneRoute)).statusCode).toBe(404);
        expect((await schreiben("starten", STAGE, betreiber.cookie, randomUUID(), ohneRoute)).statusCode).toBe(404);
        expect((await schreiben("abbrechen", STAGE, betreiber.cookie, randomUUID(), ohneRoute)).statusCode).toBe(404);
        // Wo die Route nicht angemeldet ist, ruft auch niemand den Starter.
        expect(aufrufe()).toEqual([]);
        expect((await lesen()).statusCode).toBe(200);
        expect(aufrufe().length).toBeGreaterThan(0);
    });

    it("zeigt Kandidat und Stand des Laufs; ein Admin und ein Anonymer bekommen sie nicht", async () => {
        const antwort = await lesen();
        expect(antwort.statusCode).toBe(200);
        const sicht = antwort.json() as ReleaseTestSicht;
        expect(sicht).toMatchObject({ verfuegbar: true, fehler: null, kandidat: KANDIDAT, start: null });
        expect(sicht.lauf?.zustand).toBe("keiner");
        expect(code(await lesen(admin.cookie))).toBe("forbidden");
        expect(code(await app.inject({ method: "GET", url: RELEASE_TEST_URL }))).toBe("unauthenticated");
    });

    it("🔴 `?frisch=1` holt den Kandidaten neu (der Blick der Karte vor einem Start)", async () => {
        const zaehle = (): number => aufrufe().filter((a) => a.argumente.includes("--kandidat")).length;
        await lesen();
        const vorher = zaehle();
        const frisch = await app.inject({
            method: "GET",
            url: `${RELEASE_TEST_URL}?frisch=1`,
            headers: { cookie: betreiber.cookie },
        });
        expect(frisch.statusCode).toBe(200);
        expect(zaehle()).toBe(vorher + 1);
    });

    it("ein Starter, der nichts Brauchbares liefert, macht die Sicht „nicht verfügbar“, nicht einen Fehler", async () => {
        setze({ kandidat: "text", stand: "text" });
        const antwort = await lesen();
        expect(antwort.statusCode).toBe(200);
        expect(antwort.json()).toMatchObject({ verfuegbar: false, lauf: null });
    });

    it("🔴 starten reiht ein: Betreiber mit frischem Passkey, ein Ereignis, ein Auftrag mit der Person in der Warteschlange, der Starter startet nichts", async () => {
        setze({
            kandidat: KANDIDAT,
            stand: LAUF("keiner"),
            trocken: { status: "trocken", grund: "Würde starten." },
            start: { status: "gestartet", grund: "Release-Test gestartet (PID 1)" },
        });
        const vorher = (await ereignisse("system.release_test_gestartet")).length;
        const antwort = await schreiben("starten", AUFTRAG);
        expect(code(antwort)).toBe("200");
        const quittung = antwort.json() as { derivedWork: { kind: string; jobId: string; state: string }[] };
        expect(quittung.derivedWork).toEqual([{ kind: "release_test", jobId: expect.any(String), state: "QUEUED" }]);
        expect((await ereignisse("system.release_test_gestartet")).length).toBe(vorher + 1);
        const [job] = await auftraege();
        // 🔴 WI-0248: Der Start IST die Freigabe. Ihre Kennung ist die des Auftrags; die Notiz schreibt der Starter mit Stand und Person.
        const kennung = `RT-${String(job?.public_id)}`;
        expect((await ereignisse("system.release_test_gestartet")).at(-1)?.details).toEqual({
            commit: AUFTRAG.slice(0, 12),
            freigabe: kennung,
        });
        expect(
            aufrufe()
                .filter((a) => a.argumente.includes("--freigeben"))
                .map((a) => a.argumente),
        ).toEqual([["--freigeben", AUFTRAG, "--kennung", kennung, "--von", "Rondrikan", "--trocken", "--json"]]);
        expect(job).toMatchObject({
            public_id: quittung.derivedWork[0]?.jobId,
            state: "QUEUED",
            origin: "queued",
            actor_ref: betreiber.id,
            external_ref: "release-test",
            label: `Release-Test ${AUFTRAG.slice(0, 8)}`,
        });
        // Die erwartete Dauer des Starters (1000 ms im Ersatz) geht als Schätzung mit.
        expect(job?.input_ref).toMatchObject({ commit: AUFTRAG, wiederholen: false, erwartetS: 1 });
        // Den Starter ruft erst der Ausführer: Die Route hat nur vorgeprüft.
        expect(startAufrufe()).toEqual([]);
        // Die Karte sieht den Auftrag: eingereiht, hinter allem, was in der Testdatenbank schon wartet (andere Testdateien lassen Aufträge stehen).
        const [vor] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job
             WHERE state = 'QUEUED' AND origin = 'queued' AND kind <> 'release_test' AND priority <= 50
        `;
        const sicht = (await lesen()).json() as ReleaseTestSicht;
        expect(sicht.auftrag?.platz).toBe((vor?.n ?? 0) + 1);
        expect(sicht.auftrag).toMatchObject({
            zustand: "wartet",
            commit: AUFTRAG,
            wiederholen: false,
            abbruch: false,
        });
        // Ein zweiter Druck neben dem Auftrag wird abgewiesen, ohne den Starter zu fragen; derselbe Druck noch einmal bekommt seine Quittung.
        const fragen = aufrufe().length;
        expect(code(await schreiben("starten", AUFTRAG))).toBe("release_test_laeuft");
        expect(aufrufe().length).toBe(fragen);
        expect(await auftraege()).toHaveLength(1);
        expect((await ereignisse("system.release_test_gestartet")).length).toBe(vorher + 1);
    });

    it("dieselbe Kennung noch einmal bekommt ihre Quittung, auch wenn der Auftrag schon wartet", async () => {
        setze({ kandidat: KANDIDAT, stand: LAUF("keiner"), trocken: { status: "trocken", grund: "x" } });
        const kennung = randomUUID();
        expect(code(await schreiben("starten", AUFTRAG, betreiber.cookie, kennung))).toBe("200");
        const zweite = await schreiben("starten", AUFTRAG, betreiber.cookie, kennung);
        expect(zweite.statusCode).toBe(200);
        expect((zweite.json() as { status: string }).status).toBe("replayed");
        expect(await auftraege()).toHaveLength(1);
    });

    it("🔴 wiederholen: Betreiber mit frischem Passkey, ein Ereignis mit dem Hinweis, der Auftrag trägt `wiederholen`", async () => {
        setze({
            kandidat: KANDIDAT,
            stand: LAUF("rot"),
            trocken: {
                status: "trocken",
                grund: "Würde wiederholen.",
                wiederholt: { von: AUFTRAG, uebernehmbar: ["voll"] },
            },
            start: { status: "gestartet", grund: "Release-Test gestartet (Wiederholung)" },
        });
        const vorher = (await ereignisse("system.release_test_gestartet")).length;
        expect(code(await wiederholen(AUFTRAG))).toBe("200");
        const jetzt = await ereignisse("system.release_test_gestartet");
        expect(jetzt.length).toBe(vorher + 1);
        expect(jetzt.at(-1)?.details).toMatchObject({ commit: AUFTRAG.slice(0, 12), wiederholen: true });
        expect(jetzt.at(-1)?.details).toHaveProperty("freigabe", expect.stringMatching(/^RT-/u));
        expect(aufrufe().some((a) => a.argumente.join(" ") === `--wiederholen ${AUFTRAG} --trocken --json`)).toBe(true);
        const [job] = await auftraege();
        expect(job?.input_ref).toMatchObject({ commit: AUFTRAG, wiederholen: true });
        expect(job?.label).toBe(`Release-Test ${AUFTRAG.slice(0, 8)} (rote Teile)`);
        expect(wiederholAufrufe()).toEqual([]);
        expect(startAufrufe()).toEqual([]);
    });

    it("🔴 wiederholen verlangt wie das Starten den frischen Passkey und den Betreiber; ohne früheren Lauf sagt die Route es, ohne Ereignis", async () => {
        setze({
            kandidat: KANDIDAT,
            stand: LAUF("rot"),
            trocken: { status: "trocken", grund: "x" },
            start: { status: "gestartet", grund: "x" },
        });
        const vorher = (await ereignisse("system.release_test_gestartet")).length;
        expect(code(await wiederholen(AUFTRAG, betreiberAlt.cookie))).toBe("reauth_required");
        expect(code(await wiederholen(AUFTRAG, admin.cookie))).toBe("forbidden");
        expect(wiederholAufrufe()).toEqual([]);
        setze({
            kandidat: KANDIDAT,
            stand: LAUF("keiner"),
            trocken: { status: "kein-roter-lauf", grund: "nichts zu wiederholen" },
        });
        expect(code(await wiederholen(AUFTRAG))).toBe("release_test_kein_roter_lauf");
        // Auch die Wiederholung gilt nur für den Kandidaten, den die Oberfläche sah.
        setze({ kandidat: KANDIDAT, stand: LAUF("rot"), trocken: { status: "trocken", grund: "x" } });
        expect(code(await wiederholen(ANDERER))).toBe("release_test_stale");
        expect(wiederholAufrufe()).toEqual([]);
        expect((await ereignisse("system.release_test_gestartet")).length).toBe(vorher);
    });

    it("das Feld `wiederholen` ist ein Wahrheitswert; mit Text oder Objekt lehnt die Route ab, ohne den Starter zu rufen", async () => {
        const vorher = aufrufe().length;
        for (const zusatz of [{ wiederholen: "ja" }, { wiederholen: {} }]) {
            const antwort = await schreiben("starten", AUFTRAG, betreiber.cookie, randomUUID(), app, zusatz);
            expect(antwort.statusCode, JSON.stringify(zusatz)).toBe(400);
        }
        expect(aufrufe().length).toBe(vorher);
    });

    it("🔴 der Stand eines Starts kommt aus der Datei des Starters (ein neuer Server zeigt ihn)", async () => {
        // Neustart des Servers: Der Speicher ist leer, die Datei des Starters sagt, dass der Start noch baut.
        const vermerk = { commit: AUFTRAG, seit: "2026-10-23T17:00:00.000Z", zustand: "baut", grund: null };
        setze({ kandidat: KANDIDAT, stand: { ...LAUF("keiner"), startvorgang: vermerk } });
        const neu = await baue({ starter: join(ordner, "starter.mjs"), ausgabe: join(ordner, "ausgabe") });
        try {
            const sicht = (await lesen(betreiber.cookie, neu)).json() as ReleaseTestSicht;
            expect(sicht.start).toEqual(vermerk);
            expect(sicht.lauf).not.toHaveProperty("startvorgang");
            const gescheitert = { ...vermerk, zustand: "fehler", grund: "Testpaket nicht gebaut (Exit 1): kein Platz" };
            setze({ kandidat: KANDIDAT, stand: { ...LAUF("keiner"), startvorgang: gescheitert } });
            expect(((await lesen(betreiber.cookie, neu)).json() as ReleaseTestSicht).start).toEqual(gescheitert);
        } finally {
            await neu.close();
        }
    });

    it("🔴 starten ohne frischen Passkey, als Admin oder anonym geht nicht, und der Starter wird nicht gerufen", async () => {
        setze({
            kandidat: KANDIDAT,
            stand: LAUF("keiner"),
            trocken: { status: "trocken", grund: "x" },
            start: { status: "gestartet", grund: "x" },
        });
        const vorher = (await ereignisse("system.release_test_gestartet")).length;
        expect(code(await schreiben("starten", STAGE, betreiberAlt.cookie))).toBe("reauth_required");
        expect(code(await schreiben("starten", STAGE, admin.cookie))).toBe("forbidden");
        expect(
            (
                await app.inject({
                    method: "POST",
                    url: `${RELEASE_TEST_URL}/starten`,
                    payload: { operationId: randomUUID(), commit: STAGE },
                    headers: { origin: TEST_ORIGIN },
                })
            ).statusCode,
        ).toBe(401);
        expect(aufrufe()).toEqual([]);
        expect((await ereignisse("system.release_test_gestartet")).length).toBe(vorher);
    });

    it("die Vorprüfung lehnt ab: veralteter Stand, es läuft schon, Sperre, Fehler des Starters; kein Ereignis, kein Start", async () => {
        const vorher = (await ereignisse("system.release_test_gestartet")).length;
        setze({ kandidat: KANDIDAT, stand: LAUF("keiner"), trocken: { status: "trocken", grund: "x" } });
        expect(code(await schreiben("starten", ANDERER))).toBe("release_test_stale");
        setze({ kandidat: KANDIDAT, stand: LAUF("laeuft"), trocken: { status: "laeuft", grund: "aktiv" } });
        expect(code(await schreiben("starten", STAGE))).toBe("release_test_laeuft");
        setze({ kandidat: KANDIDAT, stand: LAUF("keiner"), trocken: { status: "sperre-ohne-prozess", grund: "x" } });
        expect(code(await schreiben("starten", STAGE))).toBe("release_test_sperre");
        setze({
            kandidat: KANDIDAT,
            stand: LAUF("keiner"),
            trocken: { status: "fehler", grund: "Stand nicht in origin/master" },
        });
        expect(code(await schreiben("starten", STAGE))).toBe("release_test_fehler");
        expect(startAufrufe()).toEqual([]);
        expect((await ereignisse("system.release_test_gestartet")).length).toBe(vorher);
    });

    it("🔴 lässt sich die Freigabe nicht schreiben, startet nichts: kein Auftrag, kein Ereignis (WI-0248)", async () => {
        const vorher = (await ereignisse("system.release_test_gestartet")).length;
        setze({
            kandidat: KANDIDAT,
            stand: LAUF("keiner"),
            trocken: { status: "trocken", grund: "x" },
            freigeben: { status: "fehler", grund: "push abgewiesen", freigabe: true },
        });
        expect(code(await schreiben("starten", STAGE))).toBe("release_test_freigabe");
        expect(await auftraege()).toEqual([]);
        expect((await ereignisse("system.release_test_gestartet")).length).toBe(vorher);
        expect(startAufrufe()).toEqual([]);
    });

    it("🔴 schon grün geprüft: Der Druck gibt den Stand frei, ohne neuen Lauf; der Auftrag endet beim Ausführer gleich grün (WI-0248)", async () => {
        setze({ kandidat: KANDIDAT, stand: LAUF("gruen"), trocken: { status: "gruen", grund: "schon grün" } });
        expect(code(await schreiben("starten", STAGE))).toBe("200");
        expect(aufrufe().filter((a) => a.argumente.includes("--freigeben"))).toHaveLength(1);
        expect((await auftraege())[0]?.input_ref).toMatchObject({ commit: STAGE, erwartetS: 60 });
        expect(startAufrufe()).toEqual([]);
    });

    it("🔴 abbrechen darf jeder Betreiber ohne frischen Passkey, ein Admin nicht; ohne Auftrag und ohne laufenden Test sagt die Route das", async () => {
        const vorher = (await ereignisse("system.release_test_abgebrochen")).length;
        setze({
            kandidat: KANDIDAT,
            stand: LAUF("laeuft"),
            abbrechen: { status: "abbruch-angefordert", grund: "Abbruch angefordert" },
        });
        expect(code(await schreiben("abbrechen", AUFTRAG, admin.cookie))).toBe("forbidden");
        expect(code(await schreiben("abbrechen", AUFTRAG, betreiberAlt.cookie))).toBe("200");
        expect((await ereignisse("system.release_test_abgebrochen")).length).toBe(vorher + 1);
        expect((await ereignisse("system.release_test_abgebrochen")).at(-1)?.details).toEqual({
            commit: AUFTRAG.slice(0, 12),
        });
        setze({
            kandidat: KANDIDAT,
            stand: LAUF("gruen"),
            abbrechen: { status: "kein-lauf", grund: "Für bbbb läuft kein Release-Test" },
        });
        expect(code(await schreiben("abbrechen", AUFTRAG))).toBe("release_test_kein_lauf");
        expect((await ereignisse("system.release_test_abgebrochen")).length).toBe(vorher + 1);
    });

    it("🔴 abbrechen eines wartenden Auftrags beendet ihn, ohne den Starter zu fragen; beim laufenden ist der Abbruch angefordert und ABBRUCH gleich angelegt", async () => {
        setze({ kandidat: KANDIDAT, stand: LAUF("keiner"), trocken: { status: "trocken", grund: "x" } });
        expect(code(await schreiben("starten", AUFTRAG))).toBe("200");
        const vorher = aufrufe().filter((a) => a.argumente.includes("--abbrechen")).length;
        expect(code(await schreiben("abbrechen", AUFTRAG))).toBe("200");
        expect((await auftraege())[0]).toMatchObject({ state: "CANCELLED", cancel_reason: "operator" });
        // Abbrechen beendet auch die Freigabe dieses Auftrags (WI-0248): keine Auslieferung.
        expect(
            aufrufe()
                .filter((a) => a.argumente.includes("--freigabe-beenden"))
                .map((a) => a.argumente.slice(0, 4)),
        ).toEqual([["--freigabe-beenden", AUFTRAG, "--kennung", `RT-${String((await auftraege())[0]?.public_id)}`]]);
        expect(aufrufe().filter((a) => a.argumente.includes("--abbrechen")).length).toBe(vorher);
        expect(((await lesen()).json() as ReleaseTestSicht).auftrag ?? null).toBeNull();

        // Ein laufender Auftrag (der Ausführer hat ihn übernommen): angefordert, und die Datei ABBRUCH über den Starter.
        expect(code(await schreiben("starten", AUFTRAG))).toBe("200");
        await database`
            UPDATE job SET state = 'RUNNING', lease_owner = 'test', lease_no = 1, lease_expires_at = now() + interval '1 minute',
                started_at = now(), attempt = 1
             WHERE kind = 'release_test' AND state = 'QUEUED'
        `;
        setze({
            kandidat: KANDIDAT,
            stand: { ...LAUF("laeuft"), start: "2099-01-01T00:00:00.000Z" },
            abbrechen: { status: "abbruch-angefordert", grund: "ok" },
        });
        expect(code(await schreiben("abbrechen", AUFTRAG))).toBe("200");
        const laufend = (await auftraege()).find((job) => job.state === "RUNNING");
        expect(laufend?.cancel_requested_at).not.toBeNull();
        expect(aufrufe().filter((a) => a.argumente.includes("--abbrechen")).length).toBe(vorher + 1);
        expect(((await lesen()).json() as ReleaseTestSicht).auftrag).toMatchObject({
            zustand: "laeuft",
            abbruch: true,
        });
    });

    it("eine Wiederholung mit derselben Kennung ruft den Starter nicht noch einmal", async () => {
        setze({ kandidat: KANDIDAT, stand: LAUF("laeuft"), abbrechen: { status: "abbruch-angefordert", grund: "ok" } });
        const kennung = randomUUID();
        expect(code(await schreiben("abbrechen", AUFTRAG, betreiber.cookie, kennung))).toBe("200");
        const zweite = await schreiben("abbrechen", AUFTRAG, betreiber.cookie, kennung);
        expect(zweite.statusCode).toBe(200);
        expect((zweite.json() as { status: string }).status).toBe("replayed");
        expect(aufrufe().filter((a) => a.argumente.includes("--abbrechen"))).toHaveLength(1);
    });

    it("🔴 der Starter bekommt die Umgebung des Servers nicht: weder die Datenbank noch Geheimnisse", async () => {
        process.env["DISCORD_CLIENT_SECRET"] = "nur-fuer-den-test";
        try {
            await lesen();
        } finally {
            delete process.env["DISCORD_CLIENT_SECRET"];
        }
        const namen = aufrufe().flatMap((a) => a.umgebung.map((n) => n.toUpperCase()));
        expect(namen.length).toBeGreaterThan(0);
        expect(namen).toContain("PATH");
        for (const verboten of [
            "DATABASE_URL",
            "TEST_DATABASE_URL",
            "DISCORD_CLIENT_SECRET",
            "RELEASE_ID",
            "AVESMAPS_ENV",
            "PORT",
        ])
            expect(namen, verboten).not.toContain(verboten);
    });

    describe("🔴 Der Volltest (WI-0264): derselbe Start mit `volltest: true`, nie eine Freigabe", () => {
        const volltest = (commit: string, cookie = betreiber.cookie) =>
            schreiben("starten", commit, cookie, randomUUID(), app, { volltest: true });

        it("Passkey wie beim Schnelltest; ein Auftrag mit `volltest`; keine Freigabe geschrieben, keine beim Abbrechen beendet", async () => {
            setze({
                kandidat: KANDIDAT,
                stand: LAUF("gruen"),
                trocken: { status: "trocken", grund: "Würde starten." },
            });
            expect(code(await volltest(AUFTRAG, betreiberAlt.cookie))).not.toBe("200");
            expect(await auftraege()).toHaveLength(0);
            const vorher = (await ereignisse("system.release_test_gestartet")).length;
            expect(code(await volltest(AUFTRAG))).toBe("200");
            // Die Vorprüfung fragt Teil 1 des Volltests; den Lauf startet erst der Ausführer.
            expect(
                aufrufe().some((a) => a.argumente.join(" ") === `--commit ${AUFTRAG} --volltest tor --trocken --json`),
            ).toBe(true);
            expect(startAufrufe()).toEqual([]);
            expect(aufrufe().filter((a) => a.argumente.includes("--freigeben"))).toEqual([]);
            const [job] = await auftraege();
            expect(job?.input_ref).toMatchObject({ commit: AUFTRAG, wiederholen: false, volltest: true });
            expect(job?.label).toBe(`Volltest ${AUFTRAG.slice(0, 8)}`);
            const jetzt = await ereignisse("system.release_test_gestartet");
            expect(jetzt.length).toBe(vorher + 1);
            expect(jetzt.at(-1)?.details).toEqual({ commit: AUFTRAG.slice(0, 12), volltest: true });
            expect(((await lesen()).json() as ReleaseTestSicht).auftrag).toMatchObject({
                volltest: true,
                commit: AUFTRAG,
            });
            // Neben dem Volltest startet kein Schnelltest: derselbe Platz.
            expect(code(await schreiben("starten", AUFTRAG))).toBe("release_test_laeuft");

            expect(code(await schreiben("abbrechen", AUFTRAG))).toBe("200");
            expect(aufrufe().filter((a) => a.argumente.includes("--freigabe-beenden"))).toEqual([]);
            expect((await ereignisse("system.release_test_abgebrochen")).at(-1)?.details).toEqual({
                commit: AUFTRAG.slice(0, 12),
                volltest: true,
            });
        });

        it("nie zusammen mit `wiederholen`; ein Starter, der den Volltest nicht kennt, startet nichts", async () => {
            setze({ kandidat: KANDIDAT, stand: LAUF("rot"), trocken: { status: "trocken", grund: "x" } });
            const beides = await schreiben("starten", AUFTRAG, betreiber.cookie, randomUUID(), app, {
                volltest: true,
                wiederholen: true,
            });
            expect(beides.statusCode).toBe(400);
            setze({
                kandidat: KANDIDAT,
                stand: LAUF("keiner"),
                trocken: { status: "trocken", grund: "x", volltest: false },
            });
            expect(code(await volltest(AUFTRAG))).toBe("release_test_unavailable");
            expect(await auftraege()).toHaveLength(0);
        });
    });

    it("eine falsch geformte Anfrage (kurzer Commit) wird abgewiesen, bevor etwas geschieht", async () => {
        const antwort = await schreiben("starten", "abc123");
        expect(antwort.statusCode).toBe(400);
        expect(aufrufe()).toEqual([]);
    });
});
