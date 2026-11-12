import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SONDERROLLEN_ABGLEICH_URL, type SonderrollenAbgleich, type SonderrollenUebersicht } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { ABGLEICH_GNADE_MS, createSonderrollenAbgleich } from "../src/auth/sonderrollen-abgleich.ts";
import type { Database } from "../src/database.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Der Weg der Sonderrollen von Production zur Stage (WI-0279 E9, Paket 4). Benannte Fälle:
 *
 * - Die Route: nur mit Schlüssel, ohne Köpfe des Nginx, nur in Production; nur Discord-ID, Rolle, Region; `304` ohne Änderung.
 * - Der Abgleich: trägt über die Discord-ID ein, entzieht, was fehlt, und beendet auch von Hand Vergebenes; ohne Konto eine Warnung.
 * - Störung: bis 30 Minuten der letzte Stand, danach ruht alles; ein Neustart ohne Antwort ruht sofort; die nächste Antwort stellt alles her.
 * - Die Glocke: eine Störung über 30 Minuten und ihr Ende melden sich je einmal an die Betreiber, auch über einen Neustart; kürzere bleiben still.
 * - Die Stage liest nur: 409 `sonderrollen_production` bei Vergabe, Entzug und Einladung.
 *
 * Läuft auf dem Wegwerf-Cluster mit den Rollen des VPS.
 */
const ENV = "sonderrollenabgleich";
const describeWithCluster = postgresBin ? describe : describe.skip;
const SCHLUESSEL = "abgleich-schluessel-fuer-tests-0123456789";
const ADRESSE = new URL("http://127.0.0.1:3999/api/intern/sonderrollen");
const stumm = { warn: () => undefined } as never;

describeWithCluster("Abgleich der Sonderrollen (Wegwerf-Cluster mit den Rollen des VPS)", { timeout: 180_000 }, () => {
    let cluster: VpsCluster;
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    const apps: FastifyInstance[] = [];

    async function app(environment: "production" | "staging" | "test", url?: string): Promise<FastifyInstance> {
        const neu = buildApp({
            config: {
                port: 0,
                host: "127.0.0.1",
                releaseId: "test",
                databaseUrl: undefined,
                tileRoot: undefined,
                auth: { ...TEST_AUTH, environment },
                sonderrollenAbgleich: { schluessel: SCHLUESSEL, url },
            },
            database: cluster.app,
            logStream: { write: () => undefined },
            sonderrollenAbrufen: () => Promise.reject(new Error("kein Netz im Test")),
        });
        await neu.ready();
        apps.push(neu);
        return neu;
    }
    const zuteilen = (
        person: string,
        environment: string,
        sonderrolle: string,
        herkunft = "vergabe",
        region: string | null = null,
    ) => database`
        INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, region_public_id, herkunft, reason)
        VALUES (${person}, ${environment}, ${sonderrolle}, ${region}::uuid, ${herkunft}, 'Probe')
    `;
    const discord = (person: string, id: string) => database`
        INSERT INTO avesmaps_auth.discord_login (person_id, discord_user_id) VALUES (${person}, ${id})
    `;
    const aktive = (environment: string) => database<{ person_id: string; sonderrolle: string; herkunft: string }[]>`
        SELECT person_id::text, sonderrolle, herkunft FROM avesmaps_auth.sonderrolle_zuteilung
         WHERE environment = ${environment} AND revoked_at IS NULL ORDER BY sonderrolle
    `;
    const antwort = (zuteilungen: SonderrollenAbgleich["zuteilungen"], etag = '"a"') =>
        new Response(JSON.stringify({ zuteilungen }), { status: 200, headers: { etag } });
    function abgleicher(abrufen: () => Promise<Response>, jetzt: () => number = Date.now) {
        return createSonderrollenAbgleich({
            database: cluster.app,
            environment: "test",
            adresse: ADRESSE,
            schluessel: SCHLUESSEL,
            log: stumm,
            abrufen,
            jetzt,
        });
    }

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, [fileURLToPath(new URL("../src/db/auth-grants.psql", import.meta.url))], {
            mapDomains: true,
        });
        database = cluster.admin;
        fixture = authFixture(database);
    }, 180_000);

    afterEach(async () => {
        await database`DELETE FROM avesmaps_auth.sonderrolle_zuteilung`;
        await database`DELETE FROM avesmaps_auth.discord_login`;
        await database`DELETE FROM benachrichtigung`;
    });

    afterAll(async () => {
        for (const offen of apps) await offen.close();
        await cluster?.stop();
    }, 60_000);

    describe("Die Route in Production", () => {
        const hole = (ziel: FastifyInstance, headers: Record<string, string>) =>
            ziel.inject({ method: "GET", url: SONDERROLLEN_ABGLEICH_URL, headers });
        const MIT = { authorization: `Bearer ${SCHLUESSEL}` };

        it("🔴 ohne oder mit falschem Schlüssel und mit Köpfen des Nginx gibt es den Weg nicht", async () => {
            const production = await app("production");
            expect((await hole(production, {})).statusCode).toBe(404);
            expect((await hole(production, { authorization: "Bearer falsch" })).statusCode).toBe(404);
            expect((await hole(production, { ...MIT, "x-forwarded-for": "203.0.113.9" })).statusCode).toBe(404);
            expect((await hole(production, { ...MIT, "x-real-ip": "203.0.113.9" })).statusCode).toBe(404);
            expect((await hole(production, MIT)).statusCode).toBe(200);
        });

        it("🔴 auf der Stage und ohne Schlüssel gibt es die Route nicht", async () => {
            expect((await hole(await app("staging"), MIT)).statusCode).toBe(404);
            const ohne = buildApp({
                config: {
                    port: 0,
                    host: "127.0.0.1",
                    releaseId: "test",
                    databaseUrl: undefined,
                    tileRoot: undefined,
                    auth: { ...TEST_AUTH, environment: "production" },
                },
                database: cluster.app,
                logStream: { write: () => undefined },
            });
            await ohne.ready();
            apps.push(ohne);
            expect((await hole(ohne, MIT)).statusCode).toBe(404);
        });

        it("🔴 nur Discord-ID, Rolle und Region; keine Person ohne Discord, keine gesperrte, nichts Entzogenes; 304 ohne Änderung", async () => {
            const production = await app("production");
            const region = randomUUID();
            const mit = await fixture.person("tester");
            const ohneDiscord = await fixture.person("editor");
            const gesperrt = await fixture.person("editor", { status: "locked" });
            const entzogen = await fixture.person("editor");
            await discord(mit.id, "111111111111111111");
            await discord(gesperrt.id, "222222222222222222");
            await discord(entzogen.id, "333333333333333333");
            await zuteilen(mit.id, "production", "ortskundiger", "vergabe", region);
            await zuteilen(ohneDiscord.id, "production", "kurator");
            await zuteilen(gesperrt.id, "production", "kurator");
            await zuteilen(entzogen.id, "production", "kurator");
            await database`
                UPDATE avesmaps_auth.sonderrolle_zuteilung SET revoked_at = now(), revoke_reason = 'Probe' WHERE person_id = ${entzogen.id}
            `;
            await zuteilen(mit.id, "staging", "diplomat");

            const erste = await hole(production, MIT);
            expect(erste.json()).toEqual({
                zuteilungen: [{ discordId: "111111111111111111", sonderrolle: "ortskundiger", region }],
            });
            const revision = erste.headers["etag"] as string;
            expect((await hole(production, { ...MIT, "if-none-match": revision })).statusCode).toBe(304);
            await zuteilen(mit.id, "production", "kurator");
            const danach = await hole(production, { ...MIT, "if-none-match": revision });
            expect(danach.statusCode).toBe(200);
            expect(danach.headers["etag"]).not.toBe(revision);
        });
    });

    describe("Der Abgleich auf der Stage", () => {
        it("🔴 trägt über die Discord-ID ein, entzieht, was fehlt, und beendet von Hand Vergebenes", async () => {
            const hat = await fixture.person("tester");
            const hand = await fixture.person("editor");
            await discord(hat.id, "111111111111111111");
            await zuteilen(hand.id, "test", "kurator");
            let zuteilungen: SonderrollenAbgleich["zuteilungen"] = [
                { discordId: "111111111111111111", sonderrolle: "kurator", region: null },
                { discordId: "999999999999999999", sonderrolle: "diplomat", region: null },
            ];
            const lauf = abgleicher(() => Promise.resolve(antwort(zuteilungen)));
            await lauf.lauf();
            expect(await aktive("test")).toEqual([
                { person_id: hat.id, sonderrolle: "kurator", herkunft: "production" },
            ]);
            const stand = lauf.stand();
            expect(stand.stand).toBe("ok");
            expect(stand.ohneKontoZahl).toBe(1);
            expect(stand.ohneKonto[0]?.discordId).toBe("999999999999999999");

            // Unverändert ein zweites Mal: nichts Neues im Verlauf.
            await lauf.lauf();
            const zeilen =
                await database`SELECT 1 FROM avesmaps_auth.sonderrolle_zuteilung WHERE person_id = ${hat.id}`;
            expect(zeilen).toHaveLength(1);

            zuteilungen = [];
            await lauf.lauf();
            expect(await aktive("test")).toEqual([]);
            const ereignisse = await database<{ details: object }[]>`
                SELECT details FROM avesmaps_auth.security_event WHERE action = 'sonderrolle.abgeglichen' ORDER BY at DESC, id DESC LIMIT 1
            `;
            expect(ereignisse[0]?.details).toEqual({ neu: 0, entzogen: 1, ohneKonto: 0, ruht: false });
        });

        it("🔴 304 lässt alles stehen und zählt als Antwort", async () => {
            const hat = await fixture.person("tester");
            await zuteilen(hat.id, "test", "kurator", "production");
            const lauf = abgleicher(() => Promise.resolve(new Response(null, { status: 304 })));
            await lauf.lauf();
            expect(await aktive("test")).toHaveLength(1);
            expect(lauf.stand().stand).toBe("ok");
        });

        it("🔴 antwortet Production nicht, gilt 30 Minuten der letzte Stand, danach ruht alles; die nächste Antwort stellt es her", async () => {
            const hat = await fixture.person("tester");
            await discord(hat.id, "111111111111111111");
            let uhr = 1_000_000;
            let kaputt = false;
            const lauf = abgleicher(
                () =>
                    kaputt
                        ? Promise.reject(new Error("weg"))
                        : Promise.resolve(
                              antwort([{ discordId: "111111111111111111", sonderrolle: "kurator", region: null }]),
                          ),
                () => uhr,
            );
            await lauf.lauf();
            expect(await aktive("test")).toHaveLength(1);

            kaputt = true;
            uhr += ABGLEICH_GNADE_MS - 1;
            await lauf.lauf();
            expect(await aktive("test")).toHaveLength(1);
            expect(lauf.stand()).toMatchObject({ stand: "gestoert", ruht: false });

            uhr += 2;
            await lauf.lauf();
            expect(await aktive("test")).toEqual([]);
            expect(lauf.stand()).toMatchObject({ stand: "gestoert", ruht: true });

            kaputt = false;
            await lauf.lauf();
            expect(await aktive("test")).toHaveLength(1);
            expect(lauf.stand()).toMatchObject({ stand: "ok", ruht: false, gestoertSeit: null });
        });

        it("🔴 nach einem Neustart ohne Antwort ruht alles sofort: Ein Entzug überlebt ihn nicht", async () => {
            const hat = await fixture.person("tester");
            await zuteilen(hat.id, "test", "kurator", "production");
            const lauf = abgleicher(() => Promise.reject(new Error("weg")));
            await lauf.lauf();
            expect(await aktive("test")).toEqual([]);
            expect(lauf.stand().ruht).toBe(true);
        });

        it("🔴 eine unerwartete Antwort zählt als Störung und ändert nichts", async () => {
            const hat = await fixture.person("tester");
            await discord(hat.id, "111111111111111111");
            let uhr = 1_000_000;
            let gut = true;
            const lauf = abgleicher(
                () =>
                    Promise.resolve(
                        gut
                            ? antwort([{ discordId: "111111111111111111", sonderrolle: "kurator", region: null }])
                            : new Response("{}", { status: 200 }),
                    ),
                () => uhr,
            );
            await lauf.lauf();
            gut = false;
            uhr += 60_000;
            await lauf.lauf();
            expect(await aktive("test")).toHaveLength(1);
            expect(lauf.stand().stand).toBe("gestoert");
        });
    });

    describe("Die Glocke der Betreiber", () => {
        const weg = () => Promise.reject(new Error("weg"));
        const meldungen = async (person: string) =>
            (
                await database<{ art: string; von_art: string; text: string | null }[]>`
                    SELECT art, von_art, text FROM benachrichtigung WHERE an_person = ${person} ORDER BY id
                `
            ).map((zeile) => ({ ...zeile }));
        const GESTOERT = { art: "sonderrollen_gestoert", von_art: "system", text: null };
        const WIEDER = { art: "sonderrollen_wieder", von_art: "system", text: null };

        it("🔴 über 30 Minuten gestört meldet sich einmal, das Ende einmal; nur bei Betreibern", async () => {
            const betreiber = await fixture.person("operator");
            const redaktion = await fixture.person("admin");
            let uhr = 1_000_000;
            let kaputt = false;
            const lauf = abgleicher(
                () => (kaputt ? weg() : Promise.resolve(antwort([]))),
                () => uhr,
            );
            await lauf.lauf();
            expect(await meldungen(betreiber.id)).toEqual([]);

            kaputt = true;
            await lauf.lauf();
            uhr += ABGLEICH_GNADE_MS;
            await lauf.lauf();
            expect(await meldungen(betreiber.id)).toEqual([]);

            uhr += 1;
            await lauf.lauf();
            uhr += 60_000;
            await lauf.lauf();
            expect(await meldungen(betreiber.id)).toEqual([GESTOERT]);
            expect(await meldungen(redaktion.id)).toEqual([]);

            kaputt = false;
            await lauf.lauf();
            await lauf.lauf();
            expect(await meldungen(betreiber.id)).toEqual([GESTOERT, WIEDER]);

            kaputt = true;
            await lauf.lauf();
            uhr += ABGLEICH_GNADE_MS + 1;
            await lauf.lauf();
            expect(await meldungen(betreiber.id)).toEqual([GESTOERT, WIEDER, GESTOERT]);
        });

        it("🔴 eine kürzere Störung bleibt still, auch ihr Ende", async () => {
            const betreiber = await fixture.person("operator");
            let uhr = 1_000_000;
            let kaputt = false;
            const lauf = abgleicher(
                () => (kaputt ? weg() : Promise.resolve(antwort([]))),
                () => uhr,
            );
            await lauf.lauf();
            kaputt = true;
            await lauf.lauf();
            uhr += ABGLEICH_GNADE_MS;
            await lauf.lauf();
            kaputt = false;
            await lauf.lauf();
            expect(await meldungen(betreiber.id)).toEqual([]);
        });

        it("🔴 ein Neustart meldet dieselbe Störung nicht noch einmal, und das Ende meldet auch der neue Prozess", async () => {
            const betreiber = await fixture.person("operator");
            let uhr = 1_000_000;
            for (let start = 0; start < 2; start += 1) {
                const lauf = abgleicher(weg, () => uhr);
                await lauf.lauf();
                uhr += ABGLEICH_GNADE_MS + 1;
                await lauf.lauf();
                expect(await meldungen(betreiber.id)).toEqual([GESTOERT]);
            }
            await abgleicher(
                () => Promise.resolve(antwort([])),
                () => uhr,
            ).lauf();
            expect(await meldungen(betreiber.id)).toEqual([GESTOERT, WIEDER]);
        });
    });

    describe("Die Stage liest nur", () => {
        it("🔴 Vergabe und Einladung antworten 409, der Reiter nennt den Stand; Discord-IDs nur für Betreiber", async () => {
            const stage = await app("staging", ADRESSE.href);
            const betreiber = await fixture.person("operator");
            await database`
                INSERT INTO avesmaps_auth.person_access (person_id, environment, role) VALUES (${betreiber.id}, 'staging', 'operator')
            `;
            const { cookie } = await fixture.session(betreiber.id, {
                environment: "staging",
                assurance: "strong",
                passkeyMinutesAgo: 1,
            });
            const vergabe = await stage.inject({
                method: "POST",
                url: "/api/admin/sonderrollen/vergeben",
                headers: { origin: TEST_ORIGIN, cookie },
                payload: { operationId: randomUUID(), personId: betreiber.id, sonderrolle: "kurator", grund: "Probe" },
            });
            expect(vergabe.statusCode, vergabe.body).toBe(409);
            expect(vergabe.json<{ error: { code: string } }>().error.code).toBe("sonderrollen_production");
            const reiter = await stage.inject({ method: "GET", url: "/api/admin/sonderrollen", headers: { cookie } });
            expect(reiter.statusCode, reiter.body).toBe(200);
            expect(reiter.json<SonderrollenUebersicht>().abgleich?.stand).toBeDefined();
        });

        it("🔴 ohne Adresse bleibt die Stage offen, in Production gibt es keinen Abgleich", async () => {
            const offen = await app("staging");
            expect(offen.sonderrollenAbgleich).toBeUndefined();
            const production = await app("production", ADRESSE.href);
            expect(production.sonderrollenAbgleich).toBeUndefined();
        });
    });
});
