import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FREIGABE_JOB_KIND, FREIGABE_URL, FreigabeDatei, freigabeJobRef, type FreigabeSicht } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { runJobsCli } from "../src/jobs/cli-commands.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Production-Freigabe, Stufe 1 (FREIGABE-0001, F3) gegen echtes PostgreSQL.
 *
 * 🔴 Die drei Sätze, auf die es ankommt:
 * 1. **Ungeprüft geht nichts raus** — ist die Stage nicht grün, antwortet die Route, statt zu schieben.
 * 2. **Es geht genau der Stand raus, der dastand** — hat sich die Stage seit dem Blick bewegt, wird abgelehnt.
 * 3. **Die Akte ist der Vorgang im Kanal** — die Freigabe legt einen an, kein zweites Protokoll.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const SHA_STAGE = "e2f28dd0a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SHA_PROD = "878c2440a1b2c3d4e5f60718293a4b5c6d7e8f90";

function datei(patch: Partial<FreigabeDatei> = {}): FreigabeDatei {
    return {
        schema: 1,
        standAt: new Date().toISOString(),
        production: { release: "878c244", commit: SHA_PROD, seit: "2026-10-12T21:22:00.000Z" },
        stage: { release: "e2f28dd", commit: SHA_STAGE, seit: "2026-10-13T14:05:00.000Z" },
        stageGruen: true,
        stagePruefung: "Proben und Journal, 14:08",
        technik: { migrationen: ["0122"], rechte: [], umgebungswerte: ["KANAL"] },
        themen: [
            {
                id: "grundlage",
                name: null,
                satz: null,
                unredigiert: false,
                marken: ["migration"],
                anzahl: 14,
                bis: "3396055",
            },
            {
                id: "WI-0139",
                name: "Neuigkeiten in Production",
                satz: "Unter „Neuigkeiten“ steht, was sich auf avesmaps.de getan hat.",
                unredigiert: false,
                marken: [],
                anzahl: 7,
                bis: "b81d356",
            },
        ],
        ...patch,
    };
}

describeWithDatabase("Production-Freigabe Stufe 1 (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let betreiber: { id: string; cookie: string };
    let admin: { cookie: string };
    let ordner: string;
    let pfad: string;

    const schreibe = (inhalt: FreigabeDatei | null): void => {
        writeFileSync(pfad, inhalt === null ? "{ kaputt" : JSON.stringify(inhalt), "utf8");
    };

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "freigabe-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        freigabe: { statusFile: pfad },
        auth: TEST_AUTH,
    });

    beforeAll(async () => {
        ordner = mkdtempSync(join(tmpdir(), "avm-freigabe-"));
        pfad = join(ordner, "freigabe.json");
        schreibe(datei());
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: "operator" | "admin", name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 1 });
            return { ...created, cookie };
        };
        betreiber = await person("operator", "Rondrikan");
        admin = await person("admin", "Admina");
    });

    beforeEach(async () => {
        await database`DELETE FROM avesmaps_kanal.nachweis`;
        await database`UPDATE avesmaps_kanal.vorgang SET folgt_auf = NULL`;
        // Abgelöste und abgebrochene Freigaben tragen einen Verlauf (WI-0234); der geht zuerst.
        await database`
            DELETE FROM avesmaps_kanal.eintrag
             WHERE vorgang_id IN (SELECT id FROM avesmaps_kanal.vorgang WHERE art = 'freigabe')
        `;
        await database`DELETE FROM avesmaps_kanal.vorgang WHERE art = 'freigabe'`;
        await database`DELETE FROM job WHERE kind = ${FREIGABE_JOB_KIND}`;
        schreibe(datei());
        // Der Leser hält 30 s; eine frische App je Fall wäre teurer als dieser Takt.
        await new Promise((fertig) => setTimeout(fertig, 0));
    });

    afterAll(async () => {
        await app?.close();
        await database`
            DELETE FROM avesmaps_kanal.eintrag
             WHERE vorgang_id IN (SELECT id FROM avesmaps_kanal.vorgang WHERE art = 'freigabe')
        `.catch(() => undefined);
        await database`DELETE FROM avesmaps_kanal.vorgang WHERE art = 'freigabe'`.catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const sicht = async (cookie = betreiber.cookie): Promise<FreigabeSicht> => {
        const antwort = await app.inject({ method: "GET", url: "/api/admin/system/production", headers: { cookie } });
        expect(antwort.statusCode).toBe(200);
        return antwort.json() as FreigabeSicht;
    };
    const schiebe = (cookie = betreiber.cookie, commit = SHA_STAGE) =>
        app.inject({
            method: "POST",
            url: "/api/admin/system/production/release",
            payload: { operationId: randomUUID(), commit },
            headers: { cookie, origin: TEST_ORIGIN },
        });
    const code = (antwort: { statusCode: number; json(): unknown }): string =>
        antwort.statusCode < 300
            ? String(antwort.statusCode)
            : (antwort.json() as { error: { code: string } }).error.code;
    /** Die Aufträge der Freigabe in der Warteschlange (WI-0248), ältester zuerst. */
    const auftraege = () =>
        database<
            {
                public_id: string;
                external_ref: string | null;
                state: string;
                origin: string;
                actor_ref: string | null;
                wait_reason: string | null;
                label: string | null;
                phase: string | null;
                attempt: number;
                cancel_reason: string | null;
            }[]
        >`
            SELECT public_id::text, external_ref, state, origin, actor_ref, wait_reason, label, phase, attempt, cancel_reason
              FROM job WHERE kind = ${FREIGABE_JOB_KIND} ORDER BY id
        `;

    it("zeigt die Themen aus Claudios Datei und sagt, dass der Weg offen ist", async () => {
        const stand = await sicht();
        expect(stand.datei?.themen.map((thema) => thema.id)).toEqual(["grundlage", "WI-0139"]);
        expect(stand.sperre).toBeNull();
        expect(stand.laeuft).toBeNull();
    });

    it("🔴 die Freigabe legt einen Vorgang im Kanal an — die Akte, kein zweites Protokoll", async () => {
        expect(code(await schiebe())).toBe("200");
        const [vorgang] = await database<{ art: string; status: string; zustaendig: string; titel: string }[]>`
            SELECT art, status, zustaendig, titel FROM avesmaps_kanal.vorgang WHERE art = 'freigabe'
        `;
        expect(vorgang).toMatchObject({ art: "freigabe", status: "neu", zustaendig: "claudio" });
        expect(vorgang?.titel).toContain("e2f28dd");
        // Danach steht sie als laufend da, und eine zweite wird abgewiesen.
        const stand = await sicht();
        expect(stand.laeuft?.art).toBe("release");
        expect(stand.sperre).toBe("laeuft");
        expect(code(await schiebe())).toBe("freigabe_blocked");
    });

    it("🔴 der Fortschritt kommt aus dem aufgezeichneten Job zum Vorgang, gemeldet wie Claudios Abholer es tut (WI-0204)", async () => {
        expect(code(await schiebe())).toBe("200");
        const ops = (await sicht()).laeuft?.ops ?? "";
        expect(ops).toMatch(/^OPS-\d+$/u);
        // Noch nicht abgeholt: kein Fortschritt, nichts erfunden.
        expect((await sicht()).laeuft?.fortschritt ?? null).toBeNull();
        const ref = freigabeJobRef(ops);
        // 🔴 WI-0248: Der Druck hat den Auftrag mit der Person angekündigt (wartet auf die Abholung, belegt keinen Platz).
        const [angekuendigt, ...mehr] = await auftraege();
        expect(mehr).toEqual([]);
        expect(angekuendigt).toMatchObject({
            external_ref: ref,
            state: "QUEUED",
            origin: "recorded",
            actor_ref: betreiber.id,
            wait_reason: "waits_pickup",
            label: `Freigabe ${ops}`,
        });

        const umgebung = {
            DATABASE_URL: testDatabaseUrl as string,
            JOBS_PROFILE: "staging",
            RELEASE_ID: "freigabe-test",
        };
        const still = { out: () => undefined, err: () => undefined };
        const melde = (argv: string[]) => runJobsCli(["record", ...argv, "--strict"], umgebung, still);
        expect(
            await melde([
                "start",
                "--kind",
                FREIGABE_JOB_KIND,
                "--ref",
                ref,
                "--label",
                `Freigabe ${ops}`,
                "--phase",
                "abgeholt",
            ]),
        ).toBe(0);
        // 🔴 Der Abholer übernimmt GENAU diesen Auftrag (kein zweiter Job): Er läuft jetzt, mit der Person und ohne Wartegrund.
        const [uebernommen, ...zweiter] = await auftraege();
        expect(zweiter).toEqual([]);
        expect(uebernommen).toMatchObject({
            public_id: angekuendigt?.public_id,
            state: "RUNNING",
            actor_ref: betreiber.id,
            wait_reason: null,
            phase: "abgeholt",
            attempt: 1,
        });
        expect(
            await melde([
                "phase",
                "--kind",
                FREIGABE_JOB_KIND,
                "--ref",
                ref,
                "--phase",
                "vorbereiten",
                "--prev-phase",
                "abgeholt",
                "--prev-wall-ms",
                "2000",
            ]),
        ).toBe(0);
        expect(
            await melde([
                "phase",
                "--kind",
                FREIGABE_JOB_KIND,
                "--ref",
                ref,
                "--phase",
                "migrieren",
                "--prev-phase",
                "vorbereiten",
                "--prev-wall-ms",
                "5000",
            ]),
        ).toBe(0);

        const laufend = (await sicht()).laeuft?.fortschritt;
        expect(laufend).toMatchObject({
            zustand: "laeuft",
            phase: "migrieren",
            fertig: [
                { phase: "abgeholt", ms: 2000 },
                { phase: "vorbereiten", ms: 5000 },
            ],
            fehlerCode: null,
        });
        // Jede Phase davor hat ihre Dauer: Seit wann die jetzige läuft, ist ableitbar.
        expect(laufend?.phaseSeit).not.toBeNull();

        // Rot vor dem Umschalten: Der Lauf endet, der Vorgang steht weiter offen, die Ansicht sieht warum.
        expect(
            await melde([
                "finish",
                "--kind",
                FREIGABE_JOB_KIND,
                "--ref",
                ref,
                "--status",
                "failed",
                "--error-code",
                "migrieren_rot",
                "--error-summary",
                "Migration 0129 schlug fehl. Production läuft unverändert.",
            ]),
        ).toBe(0);
        expect((await sicht()).laeuft?.fortschritt).toMatchObject({
            zustand: "rot",
            phase: "migrieren",
            fehlerCode: "migrieren_rot",
            fehler: "Migration 0129 schlug fehl. Production läuft unverändert.",
        });
    });

    it("🔴 ungeprüft geht nichts raus", async () => {
        schreibe(datei({ stageGruen: false }));
        const frisch = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 1 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await frisch.ready();
        try {
            const antwort = await frisch.inject({
                method: "POST",
                url: "/api/admin/system/production/release",
                payload: { operationId: randomUUID(), commit: SHA_STAGE },
                headers: { cookie: betreiber.cookie, origin: TEST_ORIGIN },
            });
            expect(code(antwort)).toBe("freigabe_blocked");
            expect((antwort.json() as { error: { message: string } }).error.message).toContain("grün");
        } finally {
            await frisch.close();
        }
    });

    it("🔴 es geht genau der Stand raus, der dastand: ein anderer Commit wird abgelehnt", async () => {
        expect(code(await schiebe(betreiber.cookie, "0000000"))).toBe("freigabe_stale");
    });

    it("🔴 der letzte Rückweg reist mit, und eine Datei OHNE ihn bleibt lesbar (WI-0144 §3)", async () => {
        // Betreiber 2026-10-14: „ich muss auf der stage im reiter "Production" sehen, dass ein Feature-Release zurückgefahren
        // wurde“. Claudios Werkzeug schreibt den Block; der Server reicht ihn durch und rechnet nichts nach.
        const rueckweg = {
            am: "2026-10-14T02:14:00.000Z",
            von: "e2f28dd",
            auf: "878c244",
            durch: "Rondrikan",
            vorgang: "OPS-000142",
        } as const;
        // 🔴 Das Feld ist OPTIONAL: Die Datei des vorigen Werkzeugs muss weiter gelesen werden, sonst hiesse der Reiter nach
        //    jedem Release eine Stunde lang „nicht eingerichtet“ („erst erweitern, dann umstellen“).
        expect((await sicht()).datei?.letzterRueckweg).toBeUndefined();
        schreibe(datei({ letzterRueckweg: rueckweg }));
        const frisch = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 1 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await frisch.ready();
        try {
            const antwort = await frisch.inject({
                method: "GET",
                url: FREIGABE_URL,
                headers: { cookie: betreiber.cookie },
            });
            expect((antwort.json() as FreigabeSicht).datei?.letzterRueckweg).toEqual(rueckweg);
        } finally {
            await frisch.close();
            schreibe(datei());
        }
    });

    it("🔴 der Rückweg wird geprüft, nicht geglaubt: eine kaputte Kennung macht die Datei unlesbar (WI-0144)", () => {
        // Die Datei kommt von einer anderen Maschine, und `von`/`auf` wandern in Texte, die zeilenweise gelesen werden
        // (derselbe Grund wie bei `FreigabeStand`). Also prüft der Vertrag sie als Kennung, nicht als Freitext.
        const gut = {
            am: "2026-10-14T02:14:00.000Z",
            von: "e2f28dd",
            auf: "878c244",
            durch: "Rondrikan",
            vorgang: "OPS-000142",
        };
        expect(Value.Check(FreigabeDatei, datei({ letzterRueckweg: gut }))).toBe(true);
        // Noch kein Rückweg, aber das Werkzeug kennt das Feld schon: `null` ist erlaubt.
        expect(Value.Check(FreigabeDatei, datei({ letzterRueckweg: null }))).toBe(true);
        for (const kaputt of [
            { ...gut, auf: "878c244\nzweite Zeile" },
            { ...gut, von: "e2f28dd|OPS-000999" },
            { ...gut, vorgang: "142" },
            { ...gut, durch: "Rondri\u0000kan" },
            { ...gut, am: undefined },
        ]) {
            expect(
                Value.Check(FreigabeDatei, datei({ letzterRueckweg: kaputt as never })),
                JSON.stringify(kaputt),
            ).toBe(false);
        }
    });

    it("ohne das Recht geht nichts: ein Admin sieht die Liste, schiebt aber nicht", async () => {
        expect((await sicht(admin.cookie)).datei).not.toBeNull();
        expect(code(await schiebe(admin.cookie))).toBe("forbidden");
    });

    it("der Rückweg läuft auch, wenn es auf der Stage nichts zu schieben gibt", async () => {
        const gleich = datei();
        schreibe({ ...gleich, stage: { ...gleich.stage, commit: gleich.production.commit } });
        const frisch = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 1 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await frisch.ready();
        try {
            const zurueck = await frisch.inject({
                method: "POST",
                url: "/api/admin/system/production/rollback",
                payload: { operationId: randomUUID() },
                headers: { cookie: betreiber.cookie, origin: TEST_ORIGIN },
            });
            expect(code(zurueck)).toBe("200");
            const [vorgang] = await database<{ titel: string }[]>`
                SELECT titel FROM avesmaps_kanal.vorgang WHERE art = 'freigabe' ORDER BY gemeldet_at DESC LIMIT 1
            `;
            expect(vorgang?.titel).toContain("Zurück");
        } finally {
            await frisch.close();
        }
    });

    /**
     * „Für Production freigeben, nachts ausliefern“ (WI-0234; Betreiber 2026-10-19 in Claudios Sitzung: „dann machen wir das "Für Production
     * freigeben, nachts ausliefern" ja“; Vertrag `2026-10-19-freigabe-nachts-ausliefern-vertrag-an-claudia.md`). Ein frischer Server je
     * Fall, weil der Leser die Datei 30 s hält.
     */
    async function mitDatei<T>(inhalt: FreigabeDatei, lauf: (ziel: FastifyInstance) => Promise<T>): Promise<T> {
        schreibe(inhalt);
        const frisch = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 1 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await frisch.ready();
        try {
            return await lauf(frisch);
        } finally {
            await frisch.close();
        }
    }
    const post = (ziel: FastifyInstance, url: string, payload: Record<string, unknown>, cookie = betreiber.cookie) =>
        ziel.inject({ method: "POST", url, payload, headers: { cookie, origin: TEST_ORIGIN } });
    const offene = () =>
        database<{ id: string; titel: string; status: string; nachricht: string }[]>`
            SELECT v.id::text AS id, v.titel, v.status, v.nachricht FROM avesmaps_kanal.vorgang v WHERE v.art = 'freigabe' ORDER BY v.id
        `;
    const freigeben = (ziel: FastifyInstance) =>
        post(ziel, "/api/admin/system/production/release", { operationId: randomUUID(), commit: SHA_STAGE });

    it("🔴 ohne `nachts` (Claudios Seite liefert noch nicht nachts aus) schiebt der Knopf sofort wie bisher", async () => {
        await mitDatei(datei(), async (ziel) => {
            expect(code(await freigeben(ziel))).toBe("200");
            const [vorgang] = await offene();
            expect(vorgang?.titel).toBe("Nach Production: e2f28dd");
        });
    });

    it("🔴 mit `nachts` gibt der Knopf nur frei: ein Vorgang „Für Production freigegeben“, der nicht als laufend zählt", async () => {
        await mitDatei(datei({ nachts: true }), async (ziel) => {
            expect(code(await freigeben(ziel))).toBe("200");
            const [vorgang] = await offene();
            expect(vorgang?.titel).toBe("Für Production freigegeben: e2f28dd");
            expect(vorgang?.status).toBe("neu");
            // Der volle Commit steht in der Nachricht; Claudios Probe liest ihn dort (`Stand ([0-9a-f]{7,40}) `). Ohne grünen Release-Nachweis
            // sagt der Satz, dass der Stand jetzt vollständig geprüft wird (WI-0248).
            expect(vorgang?.nachricht).toBe(
                `Stand ${SHA_STAGE} wird jetzt vollständig geprüft; ist die Prüfung grün, geht er gleich danach nach Production.`,
            );
            const stand = (
                await ziel.inject({
                    method: "GET",
                    url: "/api/admin/system/production",
                    headers: { cookie: betreiber.cookie },
                })
            ).json() as FreigabeSicht;
            expect(stand.laeuft).toBeNull();
            expect(stand.sperre).toBeNull();
            expect(stand.freigabe).toMatchObject({
                release: "e2f28dd",
                commit: SHA_STAGE,
                wer: "Rondrikan",
                pruefung: null,
            });
        });
    });

    it("🔴 auch nachts gibt der Knopf nur einen Stand mit grünen Proben frei", async () => {
        await mitDatei(datei({ stageGruen: null, stagePruefung: null, nachts: true }), async (ziel) => {
            expect(code(await freigeben(ziel))).toBe("freigabe_blocked");
            expect(await offene()).toEqual([]);
        });
    });

    /**
     * WI-0248: Im Nachtmodus IST das Freigeben die Kandidatenbenennung. Problemfall: `stageGruen` gab es nur mit grünem Release-Nachweis, den es
     * ohne Knopfdruck nie gab; der Knopf blieb für immer zu. Jetzt genügen grüne Proben; nur ein roter Nachweis hält ihn zu.
     */
    it("🔴 nachts genügen grüne Proben, auch ohne Release-Nachweis: der Satz sagt, dass jetzt vollständig geprüft wird", async () => {
        const kandidat = { stageGruen: null, nachts: true, probenGruen: true } as const;
        for (const nachweis of [undefined, "fehlt", "laeuft"] as const) {
            await mitDatei(datei(nachweis === undefined ? kandidat : { ...kandidat, nachweis }), async (ziel) => {
                const stand = (
                    await ziel.inject({
                        method: "GET",
                        url: "/api/admin/system/production",
                        headers: { cookie: betreiber.cookie },
                    })
                ).json() as FreigabeSicht;
                expect(stand.sperre).toBeNull();
                expect(code(await freigeben(ziel))).toBe("200");
                // Ein neuer Druck löst die offene Freigabe ab: Der jüngste Vorgang ist der von eben.
                const vorgang = (await offene()).at(-1);
                expect(vorgang?.titel).toBe("Für Production freigegeben: e2f28dd");
                expect(vorgang?.nachricht).toBe(
                    `Stand ${SHA_STAGE} wird jetzt vollständig geprüft; ist die Prüfung grün, geht er gleich danach nach Production.`,
                );
                // Claudios Probe liest den Commit aus genau diesem Satzanfang.
                expect(/Stand ([0-9a-f]{7,40}) /u.exec(vorgang?.nachricht ?? "")?.[1]).toBe(SHA_STAGE);
            });
        }
    });

    it("🔴 mit grünem Release-Nachweis sagt der Satz, dass der geprüfte Stand jetzt nach Production geht (kein Nachtfenster)", async () => {
        await mitDatei(
            datei({ stageGruen: null, nachts: true, probenGruen: true, nachweis: "gruen" }),
            async (ziel) => {
                expect(code(await freigeben(ziel))).toBe("200");
                const [vorgang] = await offene();
                expect(vorgang?.nachricht).toBe(`Stand ${SHA_STAGE} geht jetzt nach Production.`);
            },
        );
    });

    it("🔴 ein roter Release-Nachweis hält den Knopf zu, ebenso fehlende Proben", async () => {
        const rot = datei({ stageGruen: null, nachts: true, probenGruen: true, nachweis: "rot" });
        await mitDatei(rot, async (ziel) => {
            const stand = (
                await ziel.inject({
                    method: "GET",
                    url: "/api/admin/system/production",
                    headers: { cookie: betreiber.cookie },
                })
            ).json() as FreigabeSicht;
            expect(stand.sperre).toBe("stage_rot");
            const antwort = await freigeben(ziel);
            expect(code(antwort)).toBe("freigabe_blocked");
            expect((antwort.json() as { error: { message: string } }).error.message).toContain("nicht grün");
            expect(await offene()).toEqual([]);
        });
        await mitDatei(
            datei({ stageGruen: null, nachts: true, probenGruen: false, nachweis: "fehlt" }),
            async (ziel) => {
                const antwort = await freigeben(ziel);
                expect(code(antwort)).toBe("freigabe_blocked");
                // Ungeprüft ist keine „gleiche“ Stage: Der Satz muss das sagen, nicht „nichts zu schieben“.
                expect((antwort.json() as { error: { message: string } }).error.message).toContain("nicht grün");
                expect(await offene()).toEqual([]);
            },
        );
    });

    it("🔴 ohne `nachts` gibt es kein Schieben ohne `stageGruen === true`, auch nicht mit grünen Proben und grünem Nachweis", async () => {
        for (const nachweis of ["fehlt", "laeuft", "gruen"] as const) {
            await mitDatei(datei({ stageGruen: null, probenGruen: true, nachweis }), async (ziel) => {
                expect(code(await freigeben(ziel))).toBe("freigabe_blocked");
                expect(await offene()).toEqual([]);
            });
        }
        await mitDatei(
            datei({ stageGruen: null, nachts: false, probenGruen: true, nachweis: "gruen" }),
            async (ziel) => {
                expect(code(await freigeben(ziel))).toBe("freigabe_blocked");
                expect(await offene()).toEqual([]);
            },
        );
    });

    it("🔴 höchstens eine Freigabe: ein neuer Druck löst sie ab; sie sperrt den Rückweg nicht, der Rückweg löst sie ebenso ab", async () => {
        await mitDatei(datei({ nachts: true }), async (ziel) => {
            expect(code(await freigeben(ziel))).toBe("200");
            expect(code(await freigeben(ziel))).toBe("200");
            expect((await offene()).map((v) => v.status)).toEqual(["abgelehnt", "neu"]);
            const zurueck = await post(ziel, "/api/admin/system/production/rollback", { operationId: randomUUID() });
            expect(code(zurueck)).toBe("200");
            const nachher = await offene();
            expect(nachher.map((v) => v.status)).toEqual(["abgelehnt", "abgelehnt", "neu"]);
            expect(nachher[2]?.titel).toContain("Zurück");
            // 🔴 WI-0248: Mit dem abgelösten Vorgang endet sein wartender Auftrag (Auslöser `freigabe_auftrag`); der neue wartet.
            const jobs = await auftraege();
            expect(jobs.map((job) => job.state)).toEqual(["CANCELLED", "CANCELLED", "QUEUED"]);
            expect(jobs.map((job) => job.external_ref)).toEqual(
                nachher.map((v) => freigabeJobRef(`OPS-${v.id.padStart(6, "0")}`)),
            );
            expect(jobs[2]?.label).toBe(`Rückweg OPS-${nachher[2]!.id.padStart(6, "0")}`);
        });
    });

    it("🔴 abbrechen darf jeder aktive Betreiber, ohne frischen Passkey; danach ist sie erloschen, ein zweites Mal sagt das", async () => {
        const spaet = await fixture.person("operator", { name: "Travine" });
        const { cookie: ohnePasskey } = await fixture.session(spaet.id, {
            assurance: "strong",
            passkeyMinutesAgo: 600,
        });
        await mitDatei(datei({ nachts: true }), async (ziel) => {
            expect(code(await freigeben(ziel))).toBe("200");
            const [vorgang] = await offene();
            const ops = `OPS-${vorgang!.id.padStart(6, "0")}`;
            const abbrechen = (cookie: string) =>
                post(ziel, "/api/admin/system/production/abbrechen", { operationId: randomUUID(), ops }, cookie);
            expect(code(await abbrechen(admin.cookie))).toBe("forbidden");
            expect(code(await abbrechen(ohnePasskey))).toBe("200");
            expect((await offene())[0]?.status).toBe("abgelehnt");
            // 🔴 WI-0248: Abbrechen der Nacht-Freigabe beendet ihren wartenden Auftrag.
            expect(await auftraege()).toMatchObject([{ state: "CANCELLED", cancel_reason: "operator" }]);
            expect(code(await abbrechen(betreiber.cookie))).toBe("freigabe_vorbei");
        });
        // Ein Vorgang, der keine Nacht-Freigabe ist, lässt sich so nicht abbrechen.
        await mitDatei(datei(), async (ziel) => {
            expect(code(await freigeben(ziel))).toBe("200");
            const release = (await offene()).at(-1)!;
            const antwort = await post(ziel, "/api/admin/system/production/abbrechen", {
                operationId: randomUUID(),
                ops: `OPS-${release.id.padStart(6, "0")}`,
            });
            expect(code(antwort)).toBe("not_found");
        });
    });

    it("der Prüfstand kommt aus Claudios Datei, aber nur, wenn er zu dieser Freigabe gehört", async () => {
        await mitDatei(datei({ nachts: true }), async (ziel) => {
            expect(code(await freigeben(ziel))).toBe("200");
        });
        const [vorgang] = await offene();
        const ops = `OPS-${vorgang!.id.padStart(6, "0")}`;
        const freigabe = (zu: string) => ({
            ops: zu,
            commit: SHA_STAGE,
            release: "e2f28dd",
            pruefung: "Serverprüfung heute Nacht ab 04:30",
        });
        const pruefung = (inhalt: FreigabeDatei) =>
            mitDatei(inhalt, async (ziel) => {
                const sicht = (
                    await ziel.inject({
                        method: "GET",
                        url: "/api/admin/system/production",
                        headers: { cookie: betreiber.cookie },
                    })
                ).json() as FreigabeSicht;
                return sicht.freigabe?.pruefung;
            });
        expect(await pruefung(datei({ nachts: true, freigabe: freigabe(ops) }))).toBe(
            "Serverprüfung heute Nacht ab 04:30",
        );
        expect(await pruefung(datei({ nachts: true, freigabe: freigabe("OPS-999999") }))).toBeNull();
    });
});

/**
 * „Neu auf avesmaps.de“ nach einer Freigabe (FREIGABE-0001 §2a). Bis 2026-10-15 meldete sich der Server beim Start selbst, mit der
 * neuesten Kurzinfo aus `config/releases/`. Die kam aber nicht mit jeder Freigabe neu, und so stand fünfmal derselbe alte Satz in den
 * Glocken (Handover `2026-10-15-production-neu-veraltete-kurzinfo-an-claudia.md`).
 *
 * 🔴 Betreiber 2026-10-15: „B“. Der Text kommt aus dem Freigabe-Bündel, angestoßen von Claudios Korridor nach grünem Postflight,
 * wie `stage_neu` auf der Stage; seit „A“ desselben Tages über die Warteschlange (Jobart `benachrichtigung`, WI-0163), die die Art
 * aus dem Auftrag nimmt. Kein Quelltext des Servers nennt `production_neu` als eigenen Wert; dieser Wächter hält das fest.
 */
describe("Neu auf avesmaps.de: der Server meldet nicht selbst", () => {
    it("🔴 kein Quelltext des Servers trägt production_neu als eigenen Wert ein", () => {
        const wurzel = resolve(import.meta.dirname, "../src");
        // Gesucht wird das Literal im Code; ein Kommentar, der die Art erklärt, ist kein Eintrag.
        const literal = /["']production_neu["']/;
        const treffer = readdirSync(wurzel, { recursive: true, encoding: "utf8" })
            .filter((datei) => datei.endsWith(".ts"))
            .filter((datei) => literal.test(readFileSync(resolve(wurzel, datei), "utf8")));
        expect(treffer).toEqual([]);
    });
});
