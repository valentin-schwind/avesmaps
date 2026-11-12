import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Kurzinfo, ReleaseVoll, VersionenListe, type ReleaseNotizen, type Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * „Versionen“ und die Kurzinfo vom Server (WI-0137, VERSION-0001 §3), gelesen aus einem Ordner wie `config/releases/`.
 *
 * - 🔴 Versionen nur mit `view_operations` (Admin ja, Editor 403); die Kurzinfo für jede angemeldete Person, ohne Anmeldung 401.
 * - 🔴 Laufend ist die neueste Datei; die früheren kommen ohne Commits, Aufklappen holt sie; eine kaputte Datei fällt weg.
 * - Die Kurzinfo bleibt ohne geschriebene Datei leer; Text bleibt Text.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const sha = (ziffer: string) => ziffer.repeat(40);

function notizen(bis: string, datum: string, titel: string): ReleaseNotizen {
    return {
        schema: 1,
        titel,
        von: sha("0"),
        bis,
        datum,
        pakete: { "WI-0128": "Ortseditor, Bau nach EDIT-0001" },
        commits: [
            { sha: sha("a"), datum, wer: "Claudia", betreff: "feat(WI-0128 E12): Ort verschieben", doku: false },
            { sha: sha("b"), datum, wer: "Claudio", betreff: "docs: Stand", doku: true },
        ],
    };
}

describeWithDatabase("Versionen und Kurzinfo (PostgreSQL für die Sitzungen)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let ordner: string;
    let admin: { cookie: string };
    let editor: { cookie: string };
    const vorher = process.env["RELEASE_NOTES_DIR"];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        fixture = authFixture(database);
        ordner = await mkdtemp(join(tmpdir(), "versionen-"));
        const alt = notizen(sha("1"), "2026-10-10T15:00:00+02:00", "Systemsteuerung komplett");
        const neu = notizen(sha("2"), "2026-10-11T01:01:49+02:00", "Routing ohne Kreuzungen");
        await writeFile(join(ordner, "2026-10-10-11111111.json"), JSON.stringify(alt));
        await writeFile(join(ordner, "2026-10-11-22222222.json"), JSON.stringify(neu));
        await writeFile(
            join(ordner, "2026-10-11-22222222.md"),
            "# Was ist neu?\n<!-- nicht zeigen -->\n## Prüfen\n- Routen <b>ohne</b> Kreuzungen.\n## Fremd\n- weg\n",
        );
        await writeFile(join(ordner, "2026-10-12-33333333.json"), "{ kaputt");
        process.env["RELEASE_NOTES_DIR"] = ordner;
        app = buildApp({
            config: {
                port: 0,
                host: "127.0.0.1",
                releaseId: "20261011T093012Z-22222222",
                databaseUrl: undefined,
                tileRoot: undefined,
                statusPage: true,
                auth: TEST_AUTH,
            },
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            return (await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 })).cookie;
        };
        admin = { cookie: await person("admin", "Admina") };
        editor = { cookie: await person("editor", "Editha") };
    });

    afterAll(async () => {
        process.env["RELEASE_NOTES_DIR"] = vorher;
        await app?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        await rm(ordner, { recursive: true, force: true });
    });

    const get = (url: string, cookie?: string) =>
        app.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });

    it("🔴 laufend ist die neueste gültige Datei, mit Commits; die früheren kurz; eine kaputte fällt weg", async () => {
        const antwort = await get("/api/admin/system/versionen", admin.cookie);
        expect(antwort.statusCode).toBe(200);
        const body = antwort.json() as VersionenListe;
        expect(Value.Check(VersionenListe, body)).toBe(true);
        expect(body.releaseId).toBe("20261011T093012Z-22222222");
        expect(body.laufend).toMatchObject({
            stamm: "2026-10-11-22222222",
            titel: "Routing ohne Kreuzungen",
            zahl: 1,
            doku: 1,
        });
        expect(body.laufend?.commits).toHaveLength(2);
        expect(body.frueher).toEqual([
            expect.objectContaining({
                stamm: "2026-10-10-11111111",
                titel: "Systemsteuerung komplett",
                zahl: 1,
                doku: 1,
            }),
        ]);
        expect(antwort.headers["cache-control"]).toContain("no-store");
    });

    it("Aufklappen holt die Commits eines früheren Release; Unbekanntes 404, falsche Form 400", async () => {
        const antwort = await get("/api/admin/system/versionen/2026-10-10-11111111", admin.cookie);
        expect(antwort.statusCode).toBe(200);
        expect(Value.Check(ReleaseVoll, antwort.json())).toBe(true);
        expect((await get("/api/admin/system/versionen/2026-10-12-33333333", admin.cookie)).statusCode).toBe(404);
        expect((await get("/api/admin/system/versionen/..%2Fetc", admin.cookie)).statusCode).toBe(400);
    });

    it("🔴 Versionen nur mit view_operations; die Kurzinfo für jede Sitzung, ohne Anmeldung 401", async () => {
        expect((await get("/api/admin/system/versionen", editor.cookie)).statusCode).toBe(403);
        expect((await get("/api/version/kurzinfo")).statusCode).toBe(401);
        const kurz = await get("/api/version/kurzinfo", editor.cookie);
        expect(kurz.statusCode).toBe(200);
        const body = kurz.json() as Kurzinfo;
        expect(Value.Check(Kurzinfo, body)).toBe(true);
        expect(body).toEqual({
            stand: "2026-10-11T01:01:49+02:00",
            abschnitte: [{ titel: "Prüfen", punkte: ["Routen <b>ohne</b> Kreuzungen."] }],
            release: "20261011T093012Z-22222222",
        });
        expect(kurz.headers["cache-control"]).toContain("no-store");
    });

    it("🔴 „Neue Version“: mit dem Stand des Tabs die Neuerungen seitdem aus dem Verlauf, Neu und Achtung, ohne Neu: unredigiert (Betreiber 2026-10-17)", async () => {
        const verlauf = {
            schema: 1,
            bis: sha("2"),
            commits: [
                {
                    sha: sha("2"),
                    art: "feat",
                    titel: "feat(WI-0128): Ort verschieben",
                    neu: ["Orte lassen sich verschieben."],
                    achtung: ["Wege folgen erst nach dem Speichern."],
                    anwendung: true,
                },
                { sha: sha("c"), art: "fix", titel: "fix(WI-0137): Kurzinfo", neu: [], achtung: [], anwendung: true },
                { sha: sha("1"), art: "feat", titel: "feat: alt", neu: ["Alt."], achtung: [], anwendung: true },
            ],
        };
        await writeFile(join(ordner, "verlauf.json"), JSON.stringify(verlauf));
        try {
            const neu = await get(`/api/version/kurzinfo?seit=${"1".repeat(7)}`, editor.cookie);
            expect(neu.statusCode).toBe(200);
            expect(Value.Check(Kurzinfo, neu.json())).toBe(true);
            expect(neu.json()).toEqual({
                stand: null,
                abschnitte: [
                    { titel: "Neu", punkte: ["Kurzinfo", "Orte lassen sich verschieben."] },
                    { titel: "Achtung", punkte: ["Wege folgen erst nach dem Speichern."] },
                ],
                release: "20261011T093012Z-22222222",
                unredigiert: ["Kurzinfo"],
            });
            expect((await get("/api/version/kurzinfo?seit=nicht-sha", editor.cookie)).statusCode).toBe(400);
            // Die Datei ist kein Release: Sie steht weder in „Versionen“ noch als kaputt.
            const liste = (await get("/api/admin/system/versionen", admin.cookie)).json() as VersionenListe;
            expect(liste.frueher.map((r) => r.stamm)).toEqual(["2026-10-10-11111111"]);
        } finally {
            await rm(join(ordner, "verlauf.json"));
        }
    });

    it("ohne geschriebene Kurzinfo nur der Stand; ohne Dateien gar nichts", async () => {
        await rm(join(ordner, "2026-10-11-22222222.md"));
        expect((await get("/api/version/kurzinfo", editor.cookie)).json()).toEqual({
            stand: "2026-10-11T01:01:49+02:00",
            abschnitte: [],
            release: "20261011T093012Z-22222222",
        });
        process.env["RELEASE_NOTES_DIR"] = join(ordner, "gibt-es-nicht");
        expect((await get("/api/version/kurzinfo", editor.cookie)).json()).toEqual({
            stand: null,
            abschnitte: [],
            release: "20261011T093012Z-22222222",
        });
        expect((await get("/api/admin/system/versionen", admin.cookie)).json()).toMatchObject({
            laufend: null,
            frueher: [],
        });
        process.env["RELEASE_NOTES_DIR"] = ordner;
    });
});
