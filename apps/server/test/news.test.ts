import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NEWS_RUBRIKEN, istNewsRubrik } from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { abgleicheModes } from "../src/abgleiche/ausfuehrung.ts";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { spieleSeedEin } from "../src/migration/news-cli.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Neuigkeiten (WI-0139, Migration 0119) gegen echtes PostgreSQL.
 *
 * 🔴 Der Punkt der Funktion `news_add`: Die tägliche Routine kann genau eine Sache — einen **Entwurf** anlegen. Sie kann nicht
 * veröffentlichen, nicht ändern, nicht löschen und nicht in `zustand` oder `freigegeben_at` schreiben; die Funktion nimmt diese Felder
 * gar nicht an. „Nur anlegen“ ist damit eine Eigenschaft des Rechts, keine Verabredung im Prompt (Betreiber 2026-10-13: „erst entwurf“).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describe("Neuigkeiten: der Katalog", () => {
    it("trägt Legacys vier Rubriken und dahinter Programm und KI (WI-0217)", () => {
        expect([...NEWS_RUBRIKEN]).toEqual(["karte", "routenplaner", "inhalte", "community", "programm", "ki"]);
        expect(istNewsRubrik("karte")).toBe(true);
        expect(istNewsRubrik("ki")).toBe(true);
        expect(istNewsRubrik("erfunden")).toBe(false);
    });
});

describeWithDatabase("Neuigkeiten: news_add (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;

    const anlegen = async (
        titel: string,
        quelle: string,
        datum = "2026-10-13",
        rubrik = "karte",
    ): Promise<number | null> => {
        const [zeile] = await database<{ id: string | null }[]>`
            SELECT public.news_add(${datum}::date, ${titel}, 'Ein Satz für normale Leser.', ${rubrik}, ${quelle}) AS id
        `;
        return zeile?.id === null || zeile?.id === undefined ? null : Number(zeile.id);
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
    });

    beforeEach(async () => {
        await database`DELETE FROM public.news_entry WHERE quelle LIKE 'test:%'`;
    });

    afterAll(async () => {
        await database`DELETE FROM public.news_entry WHERE quelle LIKE 'test:%'`.catch(() => undefined);
        await database?.end({ timeout: 5 });
    });

    it("🔴 legt einen Entwurf an — nicht sichtbar, ohne Freigabe, mit der Herkunft „routine“", async () => {
        const id = await anlegen("Orte zeigen ein Titelbild", "test:release-1");
        expect(id).not.toBeNull();
        const [zeile] = await database<
            { zustand: string; herkunft: string; freigegeben_at: Date | null; reihe: number }[]
        >`
            SELECT zustand, herkunft, freigegeben_at, reihe FROM public.news_entry WHERE id = ${id as number}
        `;
        expect(zeile).toMatchObject({ zustand: "entwurf", herkunft: "routine", freigegeben_at: null, reihe: 0 });
    });

    it("🔴 derselbe Stand legt nichts zweimal an: der zweite Lauf gibt NULL", async () => {
        expect(await anlegen("Derselbe Satz", "test:release-2")).not.toBeNull();
        expect(await anlegen("Derselbe Satz", "test:release-2")).toBeNull();
        const [zahl] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM public.news_entry WHERE quelle = 'test:release-2'
        `;
        expect(zahl?.n).toBe(1);
    });

    it("zwei Einträge desselben Laufs stehen in der Reihe, in der sie kamen", async () => {
        await anlegen("Erster", "test:release-3");
        await anlegen("Zweiter", "test:release-3");
        const reihen = await database<{ titel: string; reihe: number }[]>`
            SELECT titel, reihe FROM public.news_entry WHERE quelle = 'test:release-3' ORDER BY reihe
        `;
        expect(reihen.map((z) => [z.titel, z.reihe])).toEqual([
            ["Erster", 0],
            ["Zweiter", 1],
        ]);
    });

    it("🔴 ohne Quelle kein Eintrag: die Routine muss sagen, aus welchem Stand sie schreibt", async () => {
        await expect(anlegen("Ohne Herkunft", "")).rejects.toThrow(/quelle/u);
        await expect(database`SELECT public.news_add('2026-10-13'::date, 'x', 'y', 'karte', NULL)`).rejects.toThrow(
            /quelle/u,
        );
    });

    it("🔴 ein leerer Titel oder Text wird abgewiesen, Leerraum zählt nicht als Inhalt", async () => {
        await expect(
            database`SELECT public.news_add('2026-10-13'::date, '   ', 'y', 'karte', 'test:leer')`,
        ).rejects.toThrow();
        await expect(
            database`SELECT public.news_add('2026-10-13'::date, 'x', '  ', 'karte', 'test:leer')`,
        ).rejects.toThrow();
    });

    it("🔴 sichtbar heißt: mit Zeitpunkt der Freigabe — die Datenbank lässt nichts anderes zu", async () => {
        const id = (await anlegen("Zum Freigeben", "test:release-4")) as number;
        await expect(database`UPDATE public.news_entry SET zustand = 'sichtbar' WHERE id = ${id}`).rejects.toThrow();
        await database`UPDATE public.news_entry SET zustand = 'sichtbar', freigegeben_at = now() WHERE id = ${id}`;
        const [zeile] = await database<{ zustand: string }[]>`
            SELECT zustand FROM public.news_entry WHERE id = ${id}
        `;
        expect(zeile?.zustand).toBe("sichtbar");
    });

    it("eine unbekannte Rubrik nimmt die Datenbank an (der Katalog entscheidet, nicht ein CHECK)", async () => {
        expect(await anlegen("Mit neuer Rubrik", "test:release-5", "2026-10-13", "wetter")).not.toBeNull();
    });
});

/**
 * Der Lesepfad, die Pflege und der Startbestand (WI-0139 N3, N4, N6).
 *
 * 🔴 Besucher sehen **nur Sichtbares**: ein Entwurf der Routine und ein verstecktes Missgeschick gehören nicht auf avesmaps.de.
 * 🔴 **Gelöscht wird nie** — Löschen heißt Papierkorb (WI-0217), die Zeile bleibt und lässt sich zurückholen.
 */
describeWithDatabase("Neuigkeiten: Lesepfad, Pflege und Startbestand (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let betreiber: { id: string; cookie: string };
    let editor: { cookie: string };

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "news-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    });

    beforeAll(async () => {
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
        const person = async (role: "operator" | "editor", name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { ...created, cookie };
        };
        betreiber = await person("operator", "Rondrikan");
        editor = await person("editor", "Editha");
    });

    beforeEach(async () => {
        await database`DELETE FROM public.news_entry`;
    });

    afterAll(async () => {
        await app?.close();
        await database`DELETE FROM public.news_entry`.catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const oeffentlich = () => app.inject({ method: "GET", url: "/api/news" });
    const pflege = (cookie: string) =>
        app.inject({ method: "GET", url: "/api/admin/system/news", headers: { cookie } });

    it("🔴 Besucher sehen nur Sichtbares: kein Entwurf, nichts Verstecktes", async () => {
        await database`SELECT public.news_add('2026-10-13'::date, 'Entwurf der Routine', 'x', 'karte', 'test:e')`;
        await database`
            INSERT INTO public.news_entry (datum, titel, text, rubrik, zustand, herkunft, freigegeben_at)
            VALUES ('2026-10-12', 'Steht öffentlich', 'Ein Satz.', 'karte', 'sichtbar', 'legacy', now()),
                   ('2026-10-11', 'Zurückgenommen', 'y', 'inhalte', 'versteckt', 'legacy', now())
        `;
        const antwort = await oeffentlich();
        expect(antwort.statusCode).toBe(200);
        const body = antwort.json() as { stand: string | null; eintraege: { titel: string }[] };
        expect(body.eintraege.map((eintrag) => eintrag.titel)).toEqual(["Steht öffentlich"]);
        expect(body.stand).toBe("2026-10-12");
        expect(antwort.headers["cache-control"]).toContain("max-age=600");
    });

    it("derselbe Stand kommt als 304 zurück, ein veränderter nicht", async () => {
        await database`
            INSERT INTO public.news_entry (datum, titel, text, rubrik, zustand, herkunft, freigegeben_at)
            VALUES ('2026-10-12', 'Erster', 'Ein Satz.', 'karte', 'sichtbar', 'legacy', now())
        `;
        const erst = await oeffentlich();
        const etag = erst.headers.etag as string;
        const wieder = await app.inject({ method: "GET", url: "/api/news", headers: { "if-none-match": etag } });
        expect(wieder.statusCode).toBe(304);
        await database`
            INSERT INTO public.news_entry (datum, titel, text, rubrik, zustand, herkunft, freigegeben_at)
            VALUES ('2026-10-13', 'Zweiter', 'Noch einer.', 'karte', 'sichtbar', 'legacy', now())
        `;
        const danach = await app.inject({ method: "GET", url: "/api/news", headers: { "if-none-match": etag } });
        expect(danach.statusCode).toBe(200);
    });

    it("🔴 die Pflege zeigt auch Entwürfe und zählt sie; ohne das Recht gibt es sie nicht", async () => {
        await database`SELECT public.news_add('2026-10-13'::date, 'Wartet', 'x', 'karte', 'test:w')`;
        const antwort = await pflege(betreiber.cookie);
        expect(antwort.statusCode).toBe(200);
        const body = antwort.json() as { entwuerfe: number; eintraege: { zustand: string; herkunft: string }[] };
        expect(body.entwuerfe).toBe(1);
        expect(body.eintraege[0]).toMatchObject({ zustand: "entwurf", herkunft: "routine" });
        expect((await pflege(editor.cookie)).statusCode).toBe(403);
    });

    it("🔴 freigeben setzt Zeitpunkt und Person; verstecken nimmt es Besuchern wieder weg", async () => {
        const [zeile] = await database<{ id: string }[]>`
            SELECT public.news_add('2026-10-13'::date, 'Zum Freigeben', 'Ein Satz.', 'karte', 'test:f') AS id
        `;
        const id = Number(zeile!.id);
        const patch = (zustand: string) =>
            app.inject({
                method: "POST",
                url: `/api/admin/system/news/${String(id)}`,
                payload: { operationId: randomUUID(), zustand },
                headers: { cookie: betreiber.cookie, origin: TEST_ORIGIN },
            });
        expect((await patch("sichtbar")).statusCode).toBe(200);
        expect(((await oeffentlich()).json() as { eintraege: unknown[] }).eintraege).toHaveLength(1);
        const [nachher] = await database<{ freigegeben_von: string | null }[]>`
            SELECT freigegeben_von FROM public.news_entry WHERE id = ${id}
        `;
        expect(nachher?.freigegeben_von).toBe(betreiber.id);
        expect((await patch("versteckt")).statusCode).toBe(200);
        expect(((await oeffentlich()).json() as { eintraege: unknown[] }).eintraege).toHaveLength(0);
    });

    it("einen Eintrag, den es nicht gibt, meldet die Route als solchen", async () => {
        const antwort = await app.inject({
            method: "POST",
            url: "/api/admin/system/news/999999",
            payload: { operationId: randomUUID(), zustand: "sichtbar" },
            headers: { cookie: betreiber.cookie, origin: TEST_ORIGIN },
        });
        expect(antwort.statusCode).toBe(404);
        expect((antwort.json() as { error: { code: string } }).error.code).toBe("news_not_found");
    });

    const post = (url: string, payload: Record<string, unknown>) =>
        app.inject({
            method: "POST",
            url,
            payload: { operationId: randomUUID(), ...payload },
            headers: { cookie: betreiber.cookie, origin: TEST_ORIGIN },
        });
    const neu = (felder: Record<string, unknown>) =>
        post("/api/admin/system/news", { text: "Ein Satz.", rubrik: "karte", ...felder });
    const aendere = (id: number, felder: Record<string, unknown>) =>
        post(`/api/admin/system/news/${String(id)}`, felder);
    interface PflegeAntwort {
        entwuerfe: number;
        eintraege: { id: number; titel: string; zustand: string; nurStage: boolean; datum: string }[];
        papierkorb: { id: number; titel: string; zustand: string; nurStage: boolean; geloeschtVon: string | null }[];
        stage: { letzterZug: string | null; nurStage: number } | null;
    }
    const liste = async (): Promise<PflegeAntwort> => (await pflege(betreiber.cookie)).json() as PflegeAntwort;
    const titel = async () => (await liste()).eintraege.map((eintrag) => eintrag.titel);
    const idVon = async (name: string) => (await liste()).eintraege.find((eintrag) => eintrag.titel === name)!.id;

    describe("WI-0217: neu und zwischendrin", () => {
        beforeEach(async () => {
            expect((await neu({ datum: "2026-10-10", titel: "Zehnter unten" })).statusCode).toBe(200);
            expect((await neu({ datum: "2026-10-10", titel: "Zehnter oben" })).statusCode).toBe(200);
            expect((await neu({ datum: "2026-10-09", titel: "Neunter" })).statusCode).toBe(200);
        });

        it("ohne Platz steht ein neuer Eintrag an der Spitze seines Tages", async () => {
            expect(await titel()).toEqual(["Zehnter oben", "Zehnter unten", "Neunter"]);
        });

        it("🔴 unter einem Eintrag mit gleichem Datum steht der neue direkt darunter", async () => {
            const nach = await idVon("Zehnter oben");
            expect((await neu({ datum: "2026-10-10", titel: "Dazwischen", nach })).statusCode).toBe(200);
            expect(await titel()).toEqual(["Zehnter oben", "Dazwischen", "Zehnter unten", "Neunter"]);
        });

        it("🔴 mit einem anderen Datum steht er an der Spitze seines Tages, nicht unter dem Eintrag", async () => {
            const nach = await idVon("Zehnter oben");
            expect((await neu({ datum: "2026-10-09", titel: "Anderer Tag", nach })).statusCode).toBe(200);
            expect(await titel()).toEqual(["Zehnter oben", "Zehnter unten", "Anderer Tag", "Neunter"]);
        });

        it("als Entwurf angelegt ist er nicht öffentlich und zählt als Entwurf", async () => {
            expect((await neu({ datum: "2026-10-11", titel: "Erst prüfen", zustand: "entwurf" })).statusCode).toBe(200);
            expect((await liste()).entwuerfe).toBe(1);
            const oeffentliche = ((await oeffentlich()).json() as { eintraege: { titel: string }[] }).eintraege;
            expect(oeffentliche.map((eintrag) => eintrag.titel)).not.toContain("Erst prüfen");
        });

        it("ein neues Datum stellt den Eintrag an die Spitze seines neuen Tages", async () => {
            const id = await idVon("Neunter");
            expect((await aendere(id, { datum: "2026-10-10" })).statusCode).toBe(200);
            expect(await titel()).toEqual(["Neunter", "Zehnter oben", "Zehnter unten"]);
        });

        it("Programm und KI sind Rubriken, eine erfundene nicht; ein Datum muss ein Tag sein", async () => {
            expect((await neu({ datum: "2026-10-11", titel: "KI", rubrik: "ki" })).statusCode).toBe(200);
            expect((await neu({ datum: "2026-10-11", titel: "Wetter", rubrik: "wetter" })).statusCode).toBe(400);
            expect((await neu({ datum: "11.10.2026", titel: "Falsch" })).statusCode).toBe(400);
        });
    });

    describe("WI-0217: der Papierkorb", () => {
        it("🔴 ein sichtbarer Eintrag verlässt Liste und avesmaps.de und kommt mit seinem Zustand zurück", async () => {
            await neu({ datum: "2026-10-10", titel: "Doppelt" });
            const id = await idVon("Doppelt");
            expect((await aendere(id, { papierkorb: true })).statusCode).toBe(200);
            const nachher = await liste();
            expect(nachher.eintraege).toHaveLength(0);
            expect(nachher.papierkorb).toEqual([
                expect.objectContaining({ id, titel: "Doppelt", zustand: "versteckt", geloeschtVon: "Rondrikan" }),
            ]);
            expect(((await oeffentlich()).json() as { eintraege: unknown[] }).eintraege).toHaveLength(0);
            // Gelöscht wird nie: Die Zeile steht noch da.
            const [zeile] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM public.news_entry WHERE id = ${id}
            `;
            expect(zeile?.n).toBe(1);

            expect((await aendere(id, { papierkorb: false })).statusCode).toBe(200);
            const zurueck = await liste();
            expect(zurueck.papierkorb).toHaveLength(0);
            expect(zurueck.eintraege[0]).toMatchObject({ id, zustand: "sichtbar" });
            expect(((await oeffentlich()).json() as { eintraege: unknown[] }).eintraege).toHaveLength(1);
        });

        it("ein Entwurf bleibt im Papierkorb ein Entwurf und zählt nicht mehr als wartend", async () => {
            const [zeile] = await database<{ id: string }[]>`
                SELECT public.news_add('2026-10-13'::date, 'Missglückt', 'x', 'karte', 'test:k') AS id
            `;
            const id = Number(zeile!.id);
            expect((await aendere(id, { papierkorb: true })).statusCode).toBe(200);
            const nachher = await liste();
            expect(nachher.entwuerfe).toBe(0);
            expect(nachher.papierkorb[0]).toMatchObject({ id, zustand: "entwurf" });
            expect((await aendere(id, { papierkorb: false })).statusCode).toBe(200);
            expect((await liste()).eintraege[0]).toMatchObject({ id, zustand: "entwurf" });
        });

        it("Papierkorb steht allein: zusammen mit einer anderen Änderung 400", async () => {
            await neu({ datum: "2026-10-10", titel: "Allein" });
            const antwort = await aendere(await idVon("Allein"), { papierkorb: true, titel: "Neu" });
            expect(antwort.statusCode).toBe(400);
            expect((antwort.json() as { error: { code: string } }).error.code).toBe("news_papierkorb_allein");
        });
    });

    describe("WI-0217: nur auf der Stage", () => {
        let stage: FastifyInstance;
        const stagePflege = async (): Promise<PflegeAntwort> =>
            (
                await stage.inject({
                    method: "GET",
                    url: "/api/admin/system/news",
                    headers: { cookie: betreiber.cookie },
                })
            ).json() as PflegeAntwort;

        beforeAll(async () => {
            stage = buildApp({
                config: {
                    ...config(),
                    abgleiche: abgleicheModes({ RELEASE_ID: "news-test", ABGLEICHE: "production:korridor" }),
                },
                database: createDatabase(testDatabaseUrl as string, { max: 2 }),
                logStream: { write: () => undefined },
                jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
                stichprobe: { start: () => undefined, close: () => undefined },
            });
            await stage.ready();
        });

        beforeEach(async () => {
            await database`DELETE FROM public.job WHERE kind = 'production_pull'`;
        });

        afterAll(async () => {
            await database`DELETE FROM public.job WHERE kind = 'production_pull'`.catch(() => undefined);
            await stage?.close();
        });

        it("wo kein Production-Zug ankommt, gibt es keinen Stage-Stand", async () => {
            await neu({ datum: "2026-10-10", titel: "Production" });
            const body = await liste();
            expect(body.stage).toBeNull();
            expect(body.eintraege[0]?.nurStage).toBe(false);
        });

        it("auf der Stage ohne Zug: Stand ohne Zeitpunkt, nichts markiert", async () => {
            await neu({ datum: "2026-10-10", titel: "Vor jedem Zug" });
            const body = await stagePflege();
            expect(body.stage).toEqual({ letzterZug: null, nurStage: 0 });
            expect(body.eintraege[0]?.nurStage).toBe(false);
        });

        it("🔴 nach dem Zug angelegt, geändert oder gelöscht heißt nur auf der Stage; vom Zug Mitgebrachtes nicht", async () => {
            // Was der Zug brachte: vor seinem Ende angelegt.
            await database`
                INSERT INTO public.news_entry (datum, titel, text, rubrik, zustand, herkunft, freigegeben_at, erstellt_at)
                VALUES ('2026-10-08', 'Von Production', 'x', 'karte', 'sichtbar', 'legacy', now(), now() - interval '2 hours'),
                       ('2026-10-07', 'Bald geändert', 'x', 'karte', 'sichtbar', 'legacy', now(), now() - interval '2 hours'),
                       ('2026-10-06', 'Bald gelöscht', 'x', 'karte', 'sichtbar', 'legacy', now(), now() - interval '2 hours')
            `;
            await database`
                INSERT INTO public.job (kind, map_domain_id, state, finished_at)
                VALUES ('production_pull', 'aventuria', 'SUCCEEDED', now() - interval '1 hour'),
                       ('production_pull', 'aventuria', 'FAILED', now() - interval '1 minute')
            `;
            await neu({ datum: "2026-10-10", titel: "Nur hier" });
            await aendere(await idVon("Bald geändert"), { titel: "Geändert" });
            await aendere(await idVon("Bald gelöscht"), { papierkorb: true });

            const body = await stagePflege();
            const markiert = Object.fromEntries(body.eintraege.map((eintrag) => [eintrag.titel, eintrag.nurStage]));
            expect(markiert).toEqual({ "Nur hier": true, "Von Production": false, Geändert: true });
            expect(body.papierkorb.map((eintrag) => eintrag.nurStage)).toEqual([true]);
            expect(body.stage?.nurStage).toBe(3);
            // Der gescheiterte Zug zählt nicht: Der Stand ist das Ende des erfolgreichen.
            expect(Date.now() - Date.parse(body.stage?.letzterZug ?? "")).toBeGreaterThan(30 * 60_000);
        });
    });

    it("🔴 der Startbestand kommt sichtbar herein, und ein zweiter Lauf legt nichts doppelt an", async () => {
        const seed = {
            schema: 1 as const,
            quelle: "legacy.avesmaps.de",
            gelesenAt: "2026-10-13T08:00:00.000Z",
            eintraege: [
                { datum: "2026-04-22", titel: "Erster Eintrag", text: "Ein Satz.", rubrik: "karte" },
                { datum: "2026-04-22", titel: "Zweiter am selben Tag", text: "Noch einer.", rubrik: "wetter" },
            ],
        };
        const erst = await spieleSeedEin(database, seed, false);
        expect(erst).toMatchObject({ gelesen: 2, neu: 2, schonDa: 0 });
        // Eine unbekannte Rubrik meldet nur, sie hält nichts an.
        expect(erst.befunde).toHaveLength(1);
        expect(erst.befunde[0]).toContain("wetter");
        const nochmal = await spieleSeedEin(database, seed, false);
        expect(nochmal).toMatchObject({ neu: 0, schonDa: 2 });
        expect(((await oeffentlich()).json() as { eintraege: unknown[] }).eintraege).toHaveLength(2);
    });

    it("ein Probelauf schreibt nichts", async () => {
        const seed = {
            schema: 1 as const,
            quelle: "legacy.avesmaps.de",
            gelesenAt: "2026-10-13T08:00:00.000Z",
            eintraege: [{ datum: "2026-05-01", titel: "Nur gerechnet", text: "Ein Satz.", rubrik: "karte" }],
        };
        expect(await spieleSeedEin(database, seed, true)).toMatchObject({ neu: 1, schonDa: 0 });
        const [zahl] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM public.news_entry`;
        expect(zahl?.n).toBe(0);
    });
});
