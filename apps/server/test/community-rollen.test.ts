import { randomBytes, randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VorgangDetail, VorgangListe, leseRollenGlocke, type Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Meldungen an Sonderrollen (WI-0279, Migration 0339; Vali 2026-11-10/11) gegen echtes PostgreSQL: Zuweisen beim Eingang „wenn möglich“ (Art des Bezugs, „Etwas fehlt“,
 * Region), die Route `rollen` (die ganze Menge, jeder mit `moderate_submissions`), die Glocke `community_rolle` (gebündelt, nie an die Person, die zuweist, nie an
 * jemanden, der die Meldung nicht öffnen kann), „Meine“ in der Liste und das Auflösen eines Kontos.
 *
 * Die Welt: Mittelreich (groß) und darin Weiden (klein). Thomas ist Derograph und Topograph, Olaf Odologe, Wanda Ortskundige in Weiden, Karl Regionalkanzler im
 * Mittelreich, alle Reviewer; Tessa ist Derographin, aber nur Testerin (sie kann keine Meldung öffnen). Lena ist Reviewerin ohne Sonderrolle und ohne `moderate_community`.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const IN_WEIDEN = { x: 500, y: 500 };
const DRAUSSEN = { x: 950, y: 950 };

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "community-rollen-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Community: Meldungen an Sonderrollen (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    type Wer = { id: string; cookie: string };
    let lena: Wer;
    let thomas: Wer;
    let olaf: Wer;
    let wanda: Wer;
    let karl: Wer;
    let tessa: Wer;
    const regionen: string[] = [];
    let adresse = 10;
    const neueAdresse = (): string => `10.31.0.${String(adresse++)}`;

    async function leeren(): Promise<void> {
        await database`DELETE FROM avesmaps_community.vorgang`;
        const alle = [lena, thomas, olaf, wanda, karl, tessa].filter((w) => w !== undefined).map((w) => w.id);
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;
    }

    async function region(name: string, wkt: string): Promise<string> {
        const publicId = randomUUID();
        const [row] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, source_system, is_active)
            VALUES (${publicId}, 'aventuria', ${name}, 'derographisch', 'avesmaps3d', true)
            RETURNING id::text
        `;
        await database`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (gen_random_uuid(), 'aventuria', ${row!.id}::bigint, ST_GeomFromText(${wkt}, 0), true)
        `;
        regionen.push(publicId);
        return publicId;
    }

    const rolle = (person: string, sonderrolle: string, regionId: string | null = null) => database`
        INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, region_public_id, reason)
        VALUES (${person}::uuid, 'test', ${sonderrolle}, ${regionId}::uuid, 'Test')
    `;

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
        const person = async (role: Role, name: string): Promise<Wer> => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { id: created.id, cookie };
        };
        lena = await person("reviewer", "Lena");
        thomas = await person("reviewer", "Thomas");
        olaf = await person("reviewer", "Olaf");
        wanda = await person("reviewer", "Wanda");
        karl = await person("reviewer", "Karl");
        tessa = await person("tester", "Tessa");
        const mittelreich = await region(
            "Mittelreich (Rollen-Test)",
            "POLYGON((100 100, 700 100, 700 700, 100 700, 100 100))",
        );
        const weiden = await region("Weiden (Rollen-Test)", "POLYGON((400 400, 600 400, 600 600, 400 600, 400 400))");
        await rolle(thomas.id, "derograph");
        await rolle(thomas.id, "topograph");
        await rolle(olaf.id, "odologe");
        await rolle(wanda.id, "ortskundiger", weiden);
        await rolle(karl.id, "regionalkanzler", mittelreich);
        await rolle(tessa.id, "derograph");
    });

    beforeEach(leeren);

    afterAll(async () => {
        await app?.close();
        await leeren().catch(() => undefined);
        await database`DELETE FROM region_area WHERE region_id IN (SELECT id FROM region WHERE public_id = ANY(${regionen}::uuid[]))`.catch(
            () => undefined,
        );
        await database`DELETE FROM region WHERE public_id = ANY(${regionen}::uuid[])`.catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
    const post = (url: string, payload: Record<string, unknown>, cookie: string) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });

    /** Eine Meldung „Etwas fehlt“ an einer Stelle. */
    async function fehlt(fehltArt: string, lage: { x: number; y: number }): Promise<string> {
        const antwort = await app.inject({
            method: "POST",
            url: "/api/community/meldungen",
            remoteAddress: neueAdresse(),
            headers: { origin: TEST_ORIGIN },
            payload: {
                operationId: randomUUID(),
                schluessel: randomBytes(32).toString("base64url"),
                kategorie: "fehlt",
                fehltArt,
                text: "Hier fehlt etwas, laut Regionalband ganz deutlich.",
                quelle: "Regionalband, S. 12",
                bezug: { art: "stelle", lage },
                falle: { feld: "", dauerMs: 8000 },
            },
        });
        expect(code(antwort)).toBe("201");
        return (antwort.json() as { nummer: string }).nummer;
    }

    async function detail(nummer: string, wer: Wer = lena): Promise<VorgangDetail> {
        const antwort = await get(`/api/community/vorgaenge/${nummer}`, wer.cookie);
        expect(code(antwort)).toBe("200");
        const body = antwort.json() as VorgangDetail;
        expect(Value.Check(VorgangDetail, body)).toBe(true);
        return body;
    }

    async function liste(wer: Wer): Promise<VorgangListe> {
        const antwort = await get("/api/community/vorgaenge", wer.cookie);
        expect(code(antwort)).toBe("200");
        const body = antwort.json() as VorgangListe;
        expect(Value.Check(VorgangListe, body)).toBe(true);
        return body;
    }

    const glocke = (person: string) =>
        database<{ text: string | null; von_art: string; von_person: string | null; quelle: string }[]>`
            SELECT text, von_art, von_person::text AS von_person, quelle FROM public.benachrichtigung
             WHERE an_person = ${person}::uuid AND art = 'community_rolle' ORDER BY id
        `;

    const setze = async (nummer: string, rollen: string[], wer: Wer = lena) =>
        post(
            `/api/community/vorgaenge/${nummer}/rollen`,
            { operationId: randomUUID(), baseRevision: (await detail(nummer, wer)).zeile.revision, rollen },
            wer.cookie,
        );

    it("🔴 Eingang an einer Stelle in Weiden, „Etwas fehlt: Fluss“: Derograph, Odologe, Ortskundiger, Regionalkanzler; Glocke von Avesmaps an die Inhaber, nie an die Testerin", async () => {
        const nummer = await fehlt("fluss", IN_WEIDEN);
        const d = await detail(nummer);
        expect(d.rollen?.map((r) => r.sonderrolle)).toEqual([
            "derograph",
            "ortskundiger",
            "regionalkanzler",
            "odologe",
        ]);
        for (const r of d.rollen ?? []) expect(r.von).toEqual({ art: "system", person: null });
        const je = Object.fromEntries((d.rollen ?? []).map((r) => [r.sonderrolle, r]));
        expect(je["derograph"]?.inhaber.map((p) => p.name)).toEqual(["Thomas"]);
        expect(je["ortskundiger"]?.inhaber.map((p) => p.name)).toEqual(["Wanda"]);
        expect(je["ortskundiger"]?.regionen).toEqual(["Weiden (Rollen-Test)"]);
        expect(je["regionalkanzler"]?.regionen).toEqual(["Mittelreich (Rollen-Test)"]);
        // Das Blatt kennt alle zwölf Rollen, auch die ohne Inhaber.
        expect(d.rollenInhaber).toHaveLength(12);
        expect(d.rollenInhaber?.find((r) => r.sonderrolle === "linguist")?.personen).toEqual([]);
        // Der Verlauf: ein Ereignis „beim Eingang“.
        expect(
            d.verlauf.some(
                (e) =>
                    e.art === "ereignis" &&
                    e.ereignis === "rollen_eingang" &&
                    e.neu === "derograph,odologe,ortskundiger,regionalkanzler",
            ),
        ).toBe(true);
        for (const [wer, rolleName] of [
            [thomas, "derograph"],
            [olaf, "odologe"],
            [wanda, "ortskundiger"],
            [karl, "regionalkanzler"],
        ] as const) {
            const eintraege = await glocke(wer.id);
            expect(eintraege, rolleName).toHaveLength(1);
            expect(eintraege[0]?.von_art).toBe("system");
            expect(leseRollenGlocke(eintraege[0]!.text)).toEqual({ rolle: rolleName, nummern: [nummer], anzahl: 1 });
        }
        expect(await glocke(tessa.id)).toEqual([]);
        expect(await glocke(lena.id)).toEqual([]);
    });

    it("🔴 Eingang ohne Inhaber: keine Rolle, die Meldung bleibt bei „niemand“ und zählt am Unterreiter", async () => {
        // Draußen (keine Region) und „See oder Meer“: Derograph hat nur noch die Testerin, und die kann keine Meldung öffnen.
        await database`UPDATE avesmaps_auth.sonderrolle_zuteilung SET revoked_at = now(), revoke_reason = 'Test' WHERE person_id = ${thomas.id}::uuid AND sonderrolle = 'derograph' AND revoked_at IS NULL`;
        const nummer = await fehlt("gewaesser", DRAUSSEN).finally(() => rolle(thomas.id, "derograph"));
        const d = await detail(nummer);
        expect(d.rollen).toBeUndefined();
        expect(d.verlauf.some((e) => e.art === "ereignis" && e.ereignis === "rollen_eingang")).toBe(false);
        const l = await liste(lena);
        expect(l.zeilen.find((z) => z.nummer === nummer)).toMatchObject({ rollen: [], mein: false });
        expect(l.zaehler.meine).toBe(1);
    });

    it("🔴 Rollen setzen ohne `moderate_community`: 200, Verlauf, Glocke an die neuen Inhaber außer der Person, die zuweist; herausnehmen meldet nichts", async () => {
        const nummer = await fehlt("anderes", DRAUSSEN);
        expect((await detail(nummer)).rollen).toBeUndefined();
        // Thomas weist sich selbst Derograph zu und Olaf Odologe: Thomas hört nichts, Olaf schon.
        expect(code(await setze(nummer, ["derograph", "odologe"], thomas))).toBe("200");
        let d = await detail(nummer);
        expect(d.rollen?.map((r) => [r.sonderrolle, r.von.art, r.von.person?.name])).toEqual([
            ["derograph", "person", "Thomas"],
            ["odologe", "person", "Thomas"],
        ]);
        expect(await glocke(thomas.id)).toEqual([]);
        const olafs = await glocke(olaf.id);
        expect(olafs).toHaveLength(1);
        expect(olafs[0]?.von_person).toBe(thomas.id);
        // Lena (ohne Moderation) nimmt Odologe heraus und setzt Topograph: eine Verlaufszeile, Glocke nur an Thomas (Topograph), keine an Olaf.
        expect(code(await setze(nummer, ["derograph", "topograph"]))).toBe("200");
        d = await detail(nummer);
        expect(d.rollen?.map((r) => r.sonderrolle)).toEqual(["derograph", "topograph"]);
        const letzte = d.verlauf.filter((e) => e.art === "ereignis" && e.ereignis === "rollen").at(-1);
        expect(letzte).toMatchObject({ alt: "odologe", neu: "topograph", von: { id: lena.id, name: "Lena" } });
        expect(await glocke(olaf.id)).toHaveLength(1);
        expect((await glocke(thomas.id)).map((e) => leseRollenGlocke(e.text)?.rolle)).toEqual(["topograph"]);
        // Nur herausnehmen: keine Glocke, eine Verlaufszeile.
        expect(code(await setze(nummer, []))).toBe("200");
        d = await detail(nummer);
        expect(d.rollen).toBeUndefined();
        expect(d.verlauf.filter((e) => e.art === "ereignis" && e.ereignis === "rollen").at(-1)).toMatchObject({
            alt: "derograph,topograph",
            neu: null,
        });
        expect(await glocke(thomas.id)).toHaveLength(1);
        // Dieselbe Menge noch einmal: nichts ändert sich, die Revision bleibt.
        const vorher = d.zeile.revision;
        expect(code(await setze(nummer, []))).toBe("200");
        expect((await detail(nummer)).zeile.revision).toBe(vorher);
        // Unbekannte Rolle: 422; veraltete Revision: 409.
        expect(code(await setze(nummer, ["zauberer"]))).toBe("422 community_invalid");
        expect(
            code(
                await post(
                    `/api/community/vorgaenge/${nummer}/rollen`,
                    { operationId: randomUUID(), baseRevision: 1, rollen: ["derograph"] },
                    lena.cookie,
                ),
            ),
        ).toBe("409 community_conflict");
    });

    it("🔴 Bündelung: eine zweite Meldung für dieselbe Rolle vom selben Absender hängt ihre Nummer an, solange ungelesen", async () => {
        const eins = await fehlt("anderes", DRAUSSEN);
        const zwei = await fehlt("anderes", DRAUSSEN);
        expect(code(await setze(eins, ["topograph"]))).toBe("200");
        expect(code(await setze(zwei, ["topograph"]))).toBe("200");
        const eintraege = await glocke(thomas.id);
        expect(eintraege).toHaveLength(1);
        expect(leseRollenGlocke(eintraege[0]!.text)).toEqual({ rolle: "topograph", nummern: [eins, zwei], anzahl: 2 });
        // Gelesen beginnt die nächste einen neuen Eintrag.
        await database`UPDATE public.benachrichtigung SET gelesen_at = now() WHERE an_person = ${thomas.id}::uuid`;
        const drei = await fehlt("anderes", DRAUSSEN);
        expect(code(await setze(drei, ["topograph"]))).toBe("200");
        expect(await glocke(thomas.id)).toHaveLength(2);
    });

    it("🔴 „Meine“: Zeile und Zahl zählen die Rolle (regional nur in der Region der Meldung)", async () => {
        const weiden = await fehlt("fluss", IN_WEIDEN);
        const draussen = await fehlt("anderes", DRAUSSEN);
        // Wanda ist Ortskundige in Weiden: Die Meldung in Weiden ist ihre, die draußen (niemand zuständig) zählt mit.
        const w = await liste(wanda);
        expect(w.zeilen.find((z) => z.nummer === weiden)?.mein).toBe(true);
        expect(
            w.zeilen.find((z) => z.nummer === weiden)?.rollen?.find((r) => r.sonderrolle === "ortskundiger")?.mein,
        ).toBe(true);
        expect(
            w.zeilen.find((z) => z.nummer === weiden)?.rollen?.find((r) => r.sonderrolle === "derograph")?.mein,
        ).toBe(false);
        expect(w.zeilen.find((z) => z.nummer === draussen)?.mein).toBe(false);
        expect(w.zaehler.meine).toBe(2);
        // Lena hat keine Rolle: Die Meldung in Weiden hat Rollen, ist also nicht „niemand zuständig“; sie zählt nur die draußen.
        const l = await liste(lena);
        expect(l.zeilen.find((z) => z.nummer === weiden)?.mein).toBe(false);
        expect(l.zaehler.meine).toBe(1);
        // Als Person eingesetzt ist sie Lenas, auch ohne Rolle.
        const rev = (await detail(weiden)).zeile.revision;
        expect(
            code(
                await post(
                    `/api/community/vorgaenge/${weiden}/zustaendig`,
                    { operationId: randomUUID(), baseRevision: rev, person: lena.id },
                    thomas.cookie,
                ),
            ),
        ).toBe("200");
        const nachher = await liste(lena);
        expect(nachher.zeilen.find((z) => z.nummer === weiden)?.mein).toBe(true);
        expect(nachher.zaehler.meine).toBe(2);
        // Der Kasten weiß, wer die Person einsetzte.
        expect((await detail(weiden)).zustaendigSeit?.von).toEqual({ id: thomas.id, name: "Thomas" });
    });

    it("🔴 Konto auflösen nimmt den Absender auch aus den Rollen", async () => {
        const nummer = await fehlt("anderes", DRAUSSEN);
        expect(code(await setze(nummer, ["derograph"], olaf))).toBe("200");
        const [vorher] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_community.vorgang_rolle WHERE von_person = ${olaf.id}::uuid
        `;
        expect(vorher?.n).toBe(1);
        await database`SELECT avesmaps_community.redact_person_community(${olaf.id}::uuid)`;
        const [nachher] = await database<{ n: number; ohne: number }[]>`
            SELECT count(*) FILTER (WHERE von_person = ${olaf.id}::uuid)::int AS n,
                   count(*) FILTER (WHERE von_person IS NULL AND von_art = 'person')::int AS ohne
              FROM avesmaps_community.vorgang_rolle
        `;
        expect(nachher).toEqual({ n: 0, ohne: 1 });
        const d = await detail(nummer);
        expect(d.rollen?.[0]?.von).toEqual({ art: "person", person: null });
    });
});
