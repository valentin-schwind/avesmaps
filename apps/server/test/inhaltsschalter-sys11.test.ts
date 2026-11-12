import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SubjectLiteratureSection, SubjectLoreSection } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { markiereOeffentlichAusgeblendet } from "../src/subjects/pausiert.ts";
import { pauseFor } from "../src/system/feature-pause.ts";
import { TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { cleanMediaFixtures, insertPlace } from "./support/media-fixture.ts";

/**
 * SYS-11 (WI-0127, SYS-0001 §3.4): Reiseberechnung und 3D-Gelände pausieren (`route.compute`, `map.terrain3d`, Antwort `feature_paused`),
 * und ein Editor sieht ausgeblendete Abschnitte echt, mit dem Vermerk `publicHidden` (`?editor=true` mit `use_editor_menu`; die Adresse
 * allein hebt nichts auf). Was Besucher dabei sehen, prüft `apps/web/e2e/inhalte-besucher.spec.ts`.
 */

describe("Pausen: welche Route trifft es (rein)", () => {
    it("🔴 nur die rechnende Route und das Gelände der geneigten Karte; Wegpunkte, Landschaften und Anzeigehöhen bleiben", () => {
        expect(pauseFor("GET", "/api/route")).toMatchObject({ feature: "route", status: 503 });
        expect(pauseFor("HEAD", "/api/route")).toMatchObject({ feature: "route", status: 503 });
        expect(pauseFor("GET", "/api/route/waypoints")).toBeUndefined();
        expect(pauseFor("GET", "/api/route/waypoints/resolve")).toBeUndefined();
        expect(pauseFor("POST", "/api/route/landscapes")).toBeUndefined();
        expect(pauseFor("GET", "/tiles/terrain/dem/current.json")).toMatchObject({ feature: "terrain3d", status: 503 });
        // Die Kacheln mit 404: Eine offene Karte zählt sonst 5xx als Störung (`map/karte-gestoert.ts`).
        expect(pauseFor("GET", "/tiles/terrain/dem/:revision/:z/:x/:y.webp")).toMatchObject({
            feature: "terrain3d",
            status: 404,
        });
        expect(pauseFor("GET", "/tiles/terrain/display-height/current.json")).toBeUndefined();
        expect(pauseFor("GET", undefined)).toBeUndefined();
    });

    it("ein Editor sieht den Abschnitt echt, mit Vermerk; ohne Schalter ändert sich nichts", () => {
        const subject = { kind: "place", id: "6d656469-0000-4000-8000-000000000001" } as const;
        const werke = { subject, revision: "r1", works: [{ title: "x" }] } as unknown as SubjectLiteratureSection;
        expect(markiereOeffentlichAusgeblendet("literature", werke, () => false)).toBe(werke);
        expect(markiereOeffentlichAusgeblendet("literature", werke, (key) => key === "panel.literature")).toEqual({
            ...werke,
            publicHidden: true,
        });
        const lore: SubjectLoreSection = {
            subject,
            revision: "r1",
            rows: [
                { kind: "fauna", count: 1, groups: [] },
                { kind: "ware", count: 1, groups: [] },
            ],
        };
        expect(markiereOeffentlichAusgeblendet("lore", lore, (key) => key === "panel.lore.fauna")).toEqual({
            ...lore,
            publicHiddenKinds: ["fauna"],
        });
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "sys11-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

interface Umschlag {
    error?: { code?: string; details?: { feature?: string } };
}

describeWithDatabase("SYS-11 gegen die Datenbank", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let editor: { cookie: string };

    const reset = async (): Promise<void> => {
        await database`DELETE FROM content_switch`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        await reset();
        await cleanMediaFixtures(database);
        fixture = authFixture(database);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = await fixture.person("editor", { name: "Edda" });
        const { cookie } = await fixture.session(person.id, { assurance: "strong", passkeyMinutesAgo: 1 });
        editor = { cookie };
    });

    beforeEach(reset);

    afterAll(async () => {
        await reset();
        await cleanMediaFixtures(database);
        await app?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const frage = async (url: string, cookie?: string) => {
        const response = await app.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });
        return { status: response.statusCode, headers: response.headers, body: response.json<Umschlag>() };
    };

    it("🔴 Reiseberechnung und Gelände aus: 503 und 404 mit feature_paused; Wegpunkte bleiben; an: alles wie vorher", async () => {
        const route = "/api/route?waypoints=aaaaaaaa-0000-4000-8000-000000000001,dddddddd-0000-4000-8000-000000000004";
        await database`INSERT INTO content_switch (key, enabled) VALUES ('route.compute', FALSE), ('map.terrain3d', FALSE)`;
        await expect
            .poll(async () => (await frage(route)).body.error?.code, { timeout: 15_000, interval: 250 })
            .toBe("feature_paused");
        const pausiert = await frage(route);
        expect(pausiert.status).toBe(503);
        expect(pausiert.headers["retry-after"]).toBe("60");
        expect(pausiert.headers["cache-control"]).toBe("no-store");
        expect(pausiert.body.error?.details?.feature).toBe("route");

        const zeiger = await frage("/tiles/terrain/dem/current.json");
        expect(zeiger.status).toBe(503);
        expect(zeiger.body.error?.details?.feature).toBe("terrain3d");
        const kachel = await frage("/tiles/terrain/dem/0123456789ab/0/0/0.webp");
        expect(kachel.status).toBe(404);
        expect(kachel.body.error?.code).toBe("feature_paused");

        const suche = await app.inject({ method: "GET", url: "/api/route/waypoints?q=Gar" });
        expect((suche.json() as Umschlag).error?.code).not.toBe("feature_paused");

        await database`UPDATE content_switch SET enabled = TRUE`;
        await expect
            .poll(async () => (await frage(route)).body.error?.code ?? "keine", { timeout: 15_000, interval: 250 })
            .not.toBe("feature_paused");
        expect((await frage("/tiles/terrain/dem/current.json")).body.error?.code).not.toBe("feature_paused");
    });

    it("🔴 Editor-Modus: mit use_editor_menu und ?editor=true echt mit Vermerk und ohne öffentlichen Cache; ohne Recht ausgeblendet", async () => {
        const place = await insertPlace(database, 93);
        const url = `/api/subjects/place/${place.publicId}/literature`;
        await database`INSERT INTO content_switch (key, enabled) VALUES ('panel.literature', FALSE)`;
        await expect
            .poll(async () => ((await frage(url)).body as SubjectLiteratureSection).paused, {
                timeout: 15_000,
                interval: 250,
            })
            .toBe(true);

        // Die Adresse allein hebt nichts auf.
        const besucher = await frage(`${url}?editor=true`);
        expect((besucher.body as SubjectLiteratureSection).paused).toBe(true);
        expect(besucher.headers["cache-control"]).toMatch(/^public/u);

        const echt = await frage(`${url}?editor=true`, editor.cookie);
        expect(echt.status).toBe(200);
        expect(echt.body as SubjectLiteratureSection).toMatchObject({ publicHidden: true });
        expect((echt.body as SubjectLiteratureSection).paused).toBeUndefined();
        expect(echt.headers["cache-control"]).toBe("private, no-store");
    });
});
