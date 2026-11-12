import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EDITOR_STATUS_URL, type Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { loadConfig, mapEditingMode, type ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { requireMapEditing } from "../src/editor/map-editing.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";

/**
 * Der Schalter `MAP_EDITING` (WI-0128 E9, EDIT-0001 §4.6, §5.1 N1, §7.1 E9).
 *
 * Problemfälle: Eine Umgebung vergisst den Wert und schreibt die Karte; ein Tippfehler bleibt unbemerkt; bei `off` läuft eine
 * Schreibroute trotzdem an. Soll: ohne Wert `off` (nur lokal `testwelt`, nie Production), `off` → 423 `map_editing_off` vor dem
 * Handler, die Status-Route nennt den Modus. 🔴 Seit dem Betreiberentscheid vom 2026-10-15 darf Production `testwelt`, wenn es
 * AUSDRÜCKLICH gesetzt ist, auch neben dem Legacy-Zug je Kategorie (`config.ts`, WI-0128 §10.5).
 */

describe("MAP_EDITING aus der Umgebung", () => {
    it("🔴 ohne Wert aus, lokal Testwelt; ein ausdrücklicher Wert gilt", () => {
        expect(mapEditingMode({ RELEASE_ID: "2026-10-10-abc" })).toBe("off");
        expect(mapEditingMode({})).toBe("testwelt");
        expect(mapEditingMode({ RELEASE_ID: "dev" })).toBe("testwelt");
        expect(mapEditingMode({ RELEASE_ID: "2026-10-10-abc", MAP_EDITING: "testwelt" })).toBe("testwelt");
        expect(mapEditingMode({ MAP_EDITING: "off" })).toBe("off");
    });

    it("🔴 Production schreibt nur mit ausdrücklichem Schalter (Betreiber 2026-10-15); ein Tippfehler hält den Start an", () => {
        expect(mapEditingMode({ AVESMAPS_ENV: "production", RELEASE_ID: "r1", MAP_EDITING: "testwelt" })).toBe(
            "testwelt",
        );
        expect(mapEditingMode({ AVESMAPS_ENV: "production", MAP_EDITING: "testwelt" })).toBe("testwelt");
        // Ohne RELEASE_ID wäre die Vorgabe lokal Testwelt; in Production bleibt es ohne Schalter aus.
        expect(mapEditingMode({ AVESMAPS_ENV: "production" })).toBe("off");
        expect(mapEditingMode({ AVESMAPS_ENV: "production", RELEASE_ID: "r1" })).toBe("off");
        expect(mapEditingMode({ AVESMAPS_ENV: "production", MAP_EDITING: "off" })).toBe("off");
        expect(() => mapEditingMode({ MAP_EDITING: "an" })).toThrow(/MAP_EDITING/);
    });

    it("🔴 der Legacy-Zug je Kategorie und der Editor dürfen zugleich (Betreiber 2026-10-15, vorher WI-0141 §3.6)", () => {
        // Bis 2026-10-15 hielt diese Kombination den Start an (Claudio 2026-10-13: „sonst überschreibt der nächste Zug
        // 3D-Änderungen“). Der Betreiber hat es aufgehoben: „Mir ist klar, dass Teständerungen dort für Besucher sichtbar sind,
        // bis der nächste Legacy-Zug sie überschreibt.“ Production startet jetzt so (dass Production `testwelt` überhaupt darf, prüft
        // der Fall darüber an `mapEditingMode`; `loadConfig` verlangte für Production zusätzlich die ganze Anmeldung).
        expect(
            loadConfig({ RELEASE_ID: "r1", MAP_EDITING: "testwelt", ABGLEICHE: "legacy:kategorien" }).mapEditing,
        ).toBe("testwelt");
        // Ohne Kategoriezug bleibt der Editor erlaubt — der ganze Zug allein sperrt ihn ohnehin nicht.
        expect(loadConfig({ RELEASE_ID: "r1", MAP_EDITING: "testwelt", ABGLEICHE: "legacy:korridor" }).mapEditing).toBe(
            "testwelt",
        );
        // Und `off` bleibt `off`, auch mit Kategoriezug.
        expect(
            loadConfig({ RELEASE_ID: "r1", MAP_EDITING: "off", ABGLEICHE: "legacy:kategorien,medien:aus" }).mapEditing,
        ).toBe("off");
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase(
    "Stand des Bearbeitens und Schalter an den Schreibrouten (WI-0128 E9)",
    { timeout: 120_000 },
    () => {
        let database: Database;
        const apps = new Map<"off" | "testwelt", FastifyInstance>();
        const cookies = new Map<Role, string>();
        let geschrieben = 0;

        const config = (mapEditing: "off" | "testwelt"): ServerConfig => ({
            port: 0,
            host: "127.0.0.1",
            releaseId: "test",
            databaseUrl: undefined,
            tileRoot: undefined,
            auth: TEST_AUTH,
            mapEditing,
        });

        beforeAll(async () => {
            database = createDatabase(testDatabaseUrl as string, { max: 4 });
            await migrate(database);
            const fixture = authFixture(database);
            for (const role of ["tester", "reviewer"] as const) {
                const person = await fixture.person(role, { name: `Status ${role}` });
                cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
            }
            for (const mode of ["off", "testwelt"] as const) {
                const app = buildApp({
                    config: config(mode),
                    database: createDatabase(testDatabaseUrl as string, { max: 2 }),
                    logStream: { write: () => undefined },
                });
                // Eine Probe-Schreibroute, wie E10 sie trägt: Der Schalter steht vor dem Handler.
                app.post(
                    "/api/editor/probe",
                    { config: { writeClass: "public" }, preHandler: requireMapEditing },
                    async () => {
                        geschrieben += 1;
                        return { ok: true };
                    },
                );
                await app.ready();
                apps.set(mode, app);
            }
        });

        afterAll(async () => {
            for (const app of apps.values()) await app.close();
            await database.end({ timeout: 5 });
        });

        const status = (mode: "off" | "testwelt", role?: Role) =>
            apps.get(mode)!.inject({
                method: "GET",
                url: EDITOR_STATUS_URL,
                headers: role === undefined ? {} : { cookie: cookies.get(role) ?? "" },
            });

        it("die Status-Route nennt den Modus, nur ab Reviewer", async () => {
            expect((await status("off")).statusCode).toBe(401);
            expect((await status("off", "tester")).statusCode).toBe(403);
            const aus = await status("off", "reviewer");
            expect(aus.statusCode).toBe(200);
            expect(aus.json()).toEqual({ mapEditing: "off", environment: TEST_AUTH.environment, umwandelnFrei: true });
            expect((await status("testwelt", "reviewer")).json()).toMatchObject({ mapEditing: "testwelt" });
        });

        it("🔴 aus: 423 map_editing_off, bevor die Route etwas tut; Testwelt: sie läuft", async () => {
            const vorher = geschrieben;
            const aus = await apps.get("off")!.inject({ method: "POST", url: "/api/editor/probe", payload: {} });
            expect(aus.statusCode).toBe(423);
            expect(aus.json()).toMatchObject({ error: { code: "map_editing_off" } });
            expect(geschrieben).toBe(vorher);
            const an = await apps.get("testwelt")!.inject({ method: "POST", url: "/api/editor/probe", payload: {} });
            expect(an.statusCode).toBe(200);
            expect(geschrieben).toBe(vorher + 1);
        });
    },
);
