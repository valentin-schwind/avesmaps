import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SonderrollenUebersicht } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { acceptInvitation, findOpenInvitationById } from "../src/auth/invitations.ts";
import { dissolvePerson } from "../src/auth/dissolve.ts";
import type { Database } from "../src/database.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type SessionOptions } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Sonderrollen (WI-0279). Benannte Fälle des Pakets 1:
 *
 * - Nur Betreiber vergeben; ein Admin liest, aber ohne Grund, und ein Editor liest gar nicht.
 * - Vergabe an jede Grundrolle und ans eigene Konto; die Rechte wirken mit der nächsten Anfrage und enden mit dem Entzug.
 * - Regional: ohne Region abgewiesen; „höchstens eine Person je Region“ beim Regionalkanzler, mehrere beim Ortskundigen.
 * - Die Herabstufung lässt die Sonderrolle stehen.
 * - Einladung: nur Betreiber, mit Grund und Discord-ID; wirksam erst beim Einlösen, ein inzwischen vergebener Kanzler bleibt aus.
 * - Auflösen des Kontos beendet die Rolle und schwärzt den Grund.
 * - Fehlen die Rechte an den Tafeln noch (Claudio spielt sie ein, oft nach der Migration): Anmeldung, Einladungsliste und Annahme laufen weiter.
 *
 * Läuft auf dem Wegwerf-Cluster mit den Rollen des VPS: Fastify als App-Rolle, die Rechte aus `auth-grants.psql`.
 */

const ENV = "sonderrollen";
const describeWithCluster = postgresBin ? describe : describe.skip;
const PASSKEY_FRESH: SessionOptions = { passkeyMinutesAgo: 1 };
const STRONG: SessionOptions = { assurance: "strong" };
const DISCORD_ID = "123456789012345678";

describeWithCluster("Sonderrollen (Wegwerf-Cluster mit den Rollen des VPS)", { timeout: 180_000 }, () => {
    let cluster: VpsCluster;
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let app: FastifyInstance;

    const post = (url: string, cookie: string | undefined, payload: object) =>
        app.inject({
            method: "POST",
            url,
            headers: { origin: TEST_ORIGIN, ...(cookie === undefined ? {} : { cookie }) },
            payload: { operationId: randomUUID(), ...payload },
        });
    const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });

    async function region(name: string): Promise<string> {
        const publicId = randomUUID();
        await database`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, source_system)
            VALUES (${publicId}, 'aventuria', ${name}, 'derographisch', 'avesmaps3d')
        `;
        return publicId;
    }

    async function betreiber(): Promise<{ id: string; cookie: string }> {
        const person = await fixture.person("operator");
        const { cookie } = await fixture.session(person.id, { assurance: "strong", ...PASSKEY_FRESH });
        return { id: person.id, cookie };
    }

    const vergeben = (cookie: string, personId: string, sonderrolle: string, extra: object = {}) =>
        post("/api/admin/sonderrollen/vergeben", cookie, { personId, sonderrolle, grund: "Probe", ...extra });

    async function uebersicht(cookie: string): Promise<SonderrollenUebersicht> {
        const antwort = await get("/api/admin/sonderrollen", cookie);
        expect(antwort.statusCode, antwort.body).toBe(200);
        return antwort.json<SonderrollenUebersicht>();
    }

    const rechteDer = async (cookie: string): Promise<string[]> =>
        (await get("/api/auth/session", cookie)).json<{ capabilities: string[] }>().capabilities;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, [fileURLToPath(new URL("../src/db/auth-grants.psql", import.meta.url))], {
            mapDomains: true,
        });
        database = cluster.admin;
        fixture = authFixture(database);
        app = buildApp({
            config: {
                port: 0,
                host: "127.0.0.1",
                releaseId: "test",
                databaseUrl: undefined,
                tileRoot: undefined,
                auth: TEST_AUTH,
            },
            database: cluster.app,
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 180_000);

    afterEach(async () => {
        await database`DELETE FROM avesmaps_auth.sonderrolle_zuteilung`;
    });

    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    it("🔴 nur Betreiber vergeben; Admin liest ohne Grund; Editor liest nicht", async () => {
        const chef = await betreiber();
        const admin = await fixture.person("admin");
        const adminSitzung = await fixture.session(admin.id, STRONG);
        const editor = await fixture.person("editor");
        const editorSitzung = await fixture.session(editor.id);

        expect((await vergeben(adminSitzung.cookie, editor.id, "kurator")).statusCode).toBe(403);
        expect((await vergeben(editorSitzung.cookie, editor.id, "kurator")).statusCode).toBe(403);
        expect((await get("/api/admin/sonderrollen", editorSitzung.cookie)).statusCode).toBe(403);

        const vergabe = await vergeben(chef.cookie, editor.id, "kurator");
        expect(vergabe.statusCode, vergabe.body).toBe(200);
        expect((await uebersicht(chef.cookie)).zuteilungen[0]?.grund).toBe("Probe");
        const gelesen = (await uebersicht(adminSitzung.cookie)).zuteilungen[0];
        expect(gelesen?.person.id).toBe(editor.id);
        expect(gelesen?.grund).toBeNull();
    });

    it("🔴 ohne frischen Passkey keine Vergabe (Stufe S)", async () => {
        const chef = await fixture.person("operator");
        const { cookie } = await fixture.session(chef.id, STRONG);
        const editor = await fixture.person("editor");
        const antwort = await vergeben(cookie, editor.id, "kurator");
        expect(antwort.statusCode).toBe(403);
        expect(antwort.json<{ error: { code: string } }>().error.code).toBe("reauth_required");
    });

    it("🔴 die Rechte kommen mit der Vergabe, gehen mit dem Entzug, und das auch für Tester", async () => {
        const chef = await betreiber();
        const tester = await fixture.person("tester");
        const { cookie } = await fixture.session(tester.id);
        expect(await rechteDer(cookie)).not.toContain("use_editor_menu");

        const vergabe = await vergeben(chef.cookie, tester.id, "derograph");
        expect(vergabe.statusCode, vergabe.body).toBe(200);
        expect(await rechteDer(cookie)).toContain("use_editor_menu");

        const zuteilungId = (await uebersicht(chef.cookie)).zuteilungen[0]!.id;
        const entzug = await post("/api/admin/sonderrollen/entziehen", chef.cookie, { zuteilungId, grund: "Ende" });
        expect(entzug.statusCode, entzug.body).toBe(200);
        expect(await rechteDer(cookie)).not.toContain("use_editor_menu");

        const nochmal = await post("/api/admin/sonderrollen/entziehen", chef.cookie, { zuteilungId, grund: "Ende" });
        expect(nochmal.statusCode).toBe(409);
        expect((await uebersicht(chef.cookie)).zuteilungen[0]?.entzogenAm).not.toBeNull();
    });

    it("🔴 auch ans eigene Konto, und zweimal dieselbe Rolle ist kein Doppel", async () => {
        const chef = await betreiber();
        expect((await vergeben(chef.cookie, chef.id, "kartograph")).statusCode).toBe(200);
        expect((await vergeben(chef.cookie, chef.id, "kartograph")).statusCode).toBe(409);
    });

    it("🔴 Grund, unbekannte Rolle und gesperrte Person werden abgewiesen", async () => {
        const chef = await betreiber();
        const editor = await fixture.person("editor");
        const gesperrt = await fixture.person("editor", { status: "locked" });
        const ohneGrund = await post("/api/admin/sonderrollen/vergeben", chef.cookie, {
            personId: editor.id,
            sonderrolle: "kurator",
            grund: "  ",
        });
        expect(ohneGrund.json<{ error: { code: string } }>().error.code).toBe("reason_required");
        expect(
            (await vergeben(chef.cookie, editor.id, "erzmagier")).json<{ error: { code: string } }>().error.code,
        ).toBe("sonderrolle_unbekannt");
        expect(
            (await vergeben(chef.cookie, gesperrt.id, "kurator")).json<{ error: { code: string } }>().error.code,
        ).toBe("account_inactive");
    });

    it("🔴 regional: ohne Region abgewiesen, Kanzler einer je Region, Ortskundige mehrere", async () => {
        const chef = await betreiber();
        const weiden = await region("Weiden (Probe)");
        const garetien = await region("Garetien (Probe)");
        const eins = await fixture.person("editor");
        const zwei = await fixture.person("reviewer");

        expect(
            (await vergeben(chef.cookie, eins.id, "ortskundiger")).json<{ error: { code: string } }>().error.code,
        ).toBe("region_fehlt");
        expect(
            (await vergeben(chef.cookie, eins.id, "kurator", { regionen: [weiden] })).json<{
                error: { code: string };
            }>().error.code,
        ).toBe("sonderrolle_ohne_region");
        expect(
            (await vergeben(chef.cookie, eins.id, "ortskundiger", { regionen: [randomUUID()] })).json<{
                error: { code: string };
            }>().error.code,
        ).toBe("region_unbekannt");

        const mehrere = await vergeben(chef.cookie, eins.id, "ortskundiger", { regionen: [weiden, garetien] });
        expect(mehrere.statusCode, mehrere.body).toBe(200);
        expect((await vergeben(chef.cookie, zwei.id, "ortskundiger", { regionen: [weiden] })).statusCode).toBe(200);

        expect((await vergeben(chef.cookie, eins.id, "regionalkanzler", { regionen: [weiden] })).statusCode).toBe(200);
        const belegt = await vergeben(chef.cookie, zwei.id, "regionalkanzler", { regionen: [weiden] });
        expect(belegt.statusCode).toBe(409);
        expect(belegt.json<{ error: { code: string } }>().error.code).toBe("region_vergeben");
        expect((await vergeben(chef.cookie, zwei.id, "regionalkanzler", { regionen: [garetien] })).statusCode).toBe(
            200,
        );

        const liste = await uebersicht(chef.cookie);
        expect(liste.regionen.map((zeile) => zeile.id)).toEqual(expect.arrayContaining([weiden, garetien]));
        expect(liste.zuteilungen.filter((zeile) => zeile.sonderrolle === "ortskundiger")).toHaveLength(3);
    });

    it("🔴 die Herabstufung lässt die Sonderrolle stehen", async () => {
        const chef = await betreiber();
        const editor = await fixture.person("editor");
        const { cookie } = await fixture.session(editor.id);
        expect((await vergeben(chef.cookie, editor.id, "diplomat")).statusCode).toBe(200);
        const rolle = await post("/api/admin/people/role", chef.cookie, {
            personId: editor.id,
            role: "tester",
            baseRevision: 1,
        });
        expect(rolle.statusCode, rolle.body).toBe(200);
        expect(await rechteDer(cookie)).toContain("read_mailbox");
    });

    describe("Einladung", () => {
        const einladen = (cookie: string, extra: object) =>
            post("/api/admin/invitations", cookie, { role: "editor", validDays: 7, ...extra });

        async function jungsteEinladung(
            cookie: string,
        ): Promise<{ id: string; sonderrollen?: { sonderrolle: string }[] }> {
            const antwort = await get("/api/admin/invitations", cookie);
            const invitation = antwort.json<{
                invitations: { id: string; sonderrollen?: { sonderrolle: string }[] }[];
            }>().invitations[0]!;
            return invitation;
        }

        it("🔴 nur Betreiber, mit Discord-ID und Grund", async () => {
            const chef = await betreiber();
            const admin = await fixture.person("admin");
            const { cookie: adminCookie } = await fixture.session(admin.id, { assurance: "strong", ...PASSKEY_FRESH });
            const sonderrollen = [{ sonderrolle: "kurator" }];

            const alsAdmin = await einladen(adminCookie, {
                discordUserId: DISCORD_ID,
                sonderrollen,
                sonderrollenGrund: "Probe",
            });
            expect(alsAdmin.statusCode).toBe(403);
            const ohneDiscord = await einladen(chef.cookie, { sonderrollen, sonderrollenGrund: "Probe" });
            expect(ohneDiscord.json<{ error: { code: string } }>().error.code).toBe("invitation_binding_required");
            const ohneGrund = await einladen(chef.cookie, { discordUserId: DISCORD_ID, sonderrollen });
            expect(ohneGrund.json<{ error: { code: string } }>().error.code).toBe("reason_required");

            const ohneRolle = await einladen(adminCookie, {});
            expect(ohneRolle.statusCode, ohneRolle.body).toBe(200);
            const bestand = await jungsteEinladung(adminCookie);
            expect(bestand.sonderrollen).toEqual([]);
        });

        it("🔴 wirksam erst beim Einlösen; ein inzwischen vergebener Kanzler bleibt aus, die Einladung gilt weiter", async () => {
            const chef = await betreiber();
            const weiden = await region("Weiden (Probe)");
            const antwort = await einladen(chef.cookie, {
                discordUserId: DISCORD_ID,
                sonderrollen: [{ sonderrolle: "kurator" }, { sonderrolle: "regionalkanzler", regionen: [weiden] }],
                sonderrollenGrund: "Neu im Team",
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            const offen = await jungsteEinladung(chef.cookie);
            expect(offen.sonderrollen?.map((zeile) => zeile.sonderrolle)).toEqual(["kurator", "regionalkanzler"]);
            expect((await uebersicht(chef.cookie)).zuteilungen).toEqual([]);

            const vorher = await fixture.person("editor");
            expect((await vergeben(chef.cookie, vorher.id, "regionalkanzler", { regionen: [weiden] })).statusCode).toBe(
                200,
            );

            const einladung = await findOpenInvitationById(database, offen.id);
            const personId = await cluster.app.begin((tx) => acceptInvitation(tx, einladung!, "Neue Person (Probe)"));
            expect(personId).toBeDefined();
            const neu = await database<{ sonderrolle: string; reason: string; granted_by: string }[]>`
                SELECT sonderrolle, reason, granted_by FROM avesmaps_auth.sonderrolle_zuteilung
                 WHERE person_id = ${personId!} AND revoked_at IS NULL
            `;
            expect(neu).toEqual([{ sonderrolle: "kurator", reason: "Neu im Team", granted_by: chef.id }]);
            const [ereignis] = await database<{ details: { sonderrollen: string[]; uebersprungen: string[] } }[]>`
                SELECT details FROM avesmaps_auth.security_event
                 WHERE action = 'sonderrolle.eingeladen' AND target_person_id = ${personId!}
            `;
            expect(ereignis?.details).toEqual({
                sonderrollen: ["kurator"],
                uebersprungen: ["regionalkanzler (Weiden (Probe))"],
            });
        });

        it("🔴 „Neu ausstellen“ trägt die Sonderrollen weiter und verlangt dafür den Betreiber", async () => {
            const chef = await betreiber();
            const antwort = await einladen(chef.cookie, {
                discordUserId: DISCORD_ID,
                sonderrollen: [{ sonderrolle: "kurator" }],
                sonderrollenGrund: "Probe",
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            const alt = await jungsteEinladung(chef.cookie);

            const admin = await fixture.person("admin");
            const { cookie: adminCookie } = await fixture.session(admin.id, { assurance: "strong", ...PASSKEY_FRESH });
            const alsAdmin = await post("/api/admin/invitations/reissue", adminCookie, {
                invitationId: alt.id,
                baseRevision: 1,
            });
            expect(alsAdmin.statusCode).toBe(403);

            const neu = await post("/api/admin/invitations/reissue", chef.cookie, {
                invitationId: alt.id,
                baseRevision: 1,
            });
            expect(neu.statusCode, neu.body).toBe(200);
            const jetzt = await jungsteEinladung(chef.cookie);
            expect(jetzt.id).not.toBe(alt.id);
            expect(jetzt.sonderrollen?.map((zeile) => zeile.sonderrolle)).toEqual(["kurator"]);
        });
    });

    it("🔴 ohne Rechte an den Tafeln läuft die Anmeldung weiter, nur der Reiter ist noch nicht bereit", async () => {
        const chef = await betreiber();
        const offen = await post("/api/admin/invitations", chef.cookie, { role: "editor", validDays: 7 });
        expect(offen.statusCode, offen.body).toBe(200);
        const app_rolle = cluster.roles.app;
        await database.unsafe(
            `REVOKE ALL ON avesmaps_auth.sonderrolle_zuteilung, avesmaps_auth.invitation_sonderrolle FROM ${app_rolle}`,
        );
        try {
            expect(
                (await get("/api/auth/session", chef.cookie)).json<{ capabilities: string[] }>().capabilities,
            ).toContain("grant_special_capabilities");
            const reiter = await get("/api/admin/sonderrollen", chef.cookie);
            expect(reiter.statusCode).toBe(503);
            expect(reiter.json<{ error: { code: string } }>().error.code).toBe("auth_unavailable");
            const liste = await get("/api/admin/invitations", chef.cookie);
            expect(liste.statusCode, liste.body).toBe(200);
            const einladung = liste.json<{ invitations: { id: string; sonderrollen: unknown[] }[] }>().invitations[0]!;
            expect(einladung.sonderrollen).toEqual([]);
            const gefunden = await findOpenInvitationById(database, einladung.id);
            const personId = await cluster.app.begin((tx) => acceptInvitation(tx, gefunden!, "Ohne Rechte (Probe)"));
            expect(personId).toBeDefined();
        } finally {
            await database.unsafe(
                `GRANT SELECT, INSERT, UPDATE ON avesmaps_auth.sonderrolle_zuteilung, avesmaps_auth.invitation_sonderrolle TO ${app_rolle}`,
            );
        }
    });

    it("🔴 Auflösen beendet die Rolle und schwärzt den Grund", async () => {
        const chef = await betreiber();
        const editor = await fixture.person("editor");
        expect((await vergeben(chef.cookie, editor.id, "kurator")).statusCode).toBe(200);
        await cluster.app.begin((tx) =>
            dissolvePerson(tx, { personId: editor.id, environment: "test", actorLabel: "test" }),
        );
        const [zeile] = await database<{ revoked_at: Date | null; revoke_reason: string; reason: string }[]>`
            SELECT revoked_at, revoke_reason, reason FROM avesmaps_auth.sonderrolle_zuteilung WHERE person_id = ${editor.id}
        `;
        expect(zeile?.revoked_at).not.toBeNull();
        expect(zeile?.revoke_reason).toBe("departed");
        expect(zeile?.reason).toBe("[geschwärzt]");
    });
});
