import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
    ZOOMBAENDER_URL,
    ZOOM_BANDS_URL,
    type AdminZoombaender,
    type Role,
    type ZoomBandsPublic,
    type Zoomspanne,
} from "@avesmaps3d/shared";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { leseZoombaender } from "../src/zoombaender/stand.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Zoombänder (WI-0221, Migration 0168): der öffentliche Leseweg für den Start der Karte und der Reiter der Systemsteuerung,
 * „Übernehmen“ mit mehreren Spannen auf einmal und genau einem Eintrag im Protokoll.
 */

const ENV = "zoombaender";
const grants = [fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url))];
const describeWithCluster = postgresBin ? describe : describe.skip;

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "wi0221-test",
    databaseUrl: undefined,
    tileRoot: undefined,
    statusPage: true,
    auth: TEST_AUTH,
};

describe("GET /api/zoom-bands ohne Datenbank", () => {
    let app: FastifyInstance;
    beforeAll(async () => {
        app = buildApp({ config });
        await app.ready();
    });
    afterAll(async () => app?.close());

    it("🔴 ohne Datenbank keine Abweichung (die Karte nimmt die Vorgaben), mit ETag und 304 beim zweiten Blick", async () => {
        const erste = await app.inject({ method: "GET", url: ZOOM_BANDS_URL });
        expect(erste.statusCode).toBe(200);
        expect(erste.headers["cache-control"]).toBe("no-cache");
        expect(erste.json<ZoomBandsPublic>()).toEqual({ abweichungen: {} });
        const zweite = await app.inject({
            method: "GET",
            url: ZOOM_BANDS_URL,
            headers: { "if-none-match": String(erste.headers["etag"]) },
        });
        expect(zweite.statusCode).toBe(304);
    });
});

describeWithCluster("Reiter Zoombänder: lesen und übernehmen, App-Rolle wie auf dem VPS (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let operator: { cookie: string };
    let admin: { cookie: string };
    let editor: { cookie: string };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, grants);
        await seedMapDomains(cluster.migrator);
        fixture = authFixture(cluster.admin);
        app = buildApp({
            config,
            database: cluster.app,
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
        });
        await app.ready();
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 1 });
            return { cookie };
        };
        operator = await person("operator", "Rondrikan");
        admin = await person("admin", "Admina");
        editor = await person("editor", "Edora");
    }, 180_000);
    beforeEach(async () => {
        await cluster!.migrator`DELETE FROM zoom_band_setting`;
    });
    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    const lies = async (cookie = operator.cookie): Promise<AdminZoombaender> => {
        const response = await app.inject({ method: "GET", url: ZOOMBAENDER_URL, headers: { cookie } });
        expect(response.statusCode).toBe(200);
        return response.json<AdminZoombaender>();
    };
    const uebernimm = async (
        aenderungen: { id: string; spanne: Zoomspanne | null }[],
        { cookie = operator.cookie, baseRevision }: { cookie?: string; baseRevision?: number } = {},
    ) => {
        const revision = baseRevision ?? (await lies()).revision;
        return app.inject({
            method: "POST",
            url: ZOOMBAENDER_URL,
            payload: { operationId: randomUUID(), baseRevision: revision, aenderungen },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    };
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

    it("🔴 zwei Spannen auf einmal: eine Revision, ein Eintrag im Protokoll, der Leseweg der Karte zeigt beide", async () => {
        const vorher = await lies();
        expect(vorher.source).toBe("database");
        expect(vorher.zeilen).toEqual([]);
        const etagVorher = (await app.inject({ method: "GET", url: ZOOM_BANDS_URL })).headers["etag"];

        const antwort = await uebernimm([
            { id: "orte.dorf.name", spanne: { von: 3, bis: 8 } },
            { id: "wege.Pfad.name", spanne: { von: 4, bis: 7 } },
        ]);
        expect(code(antwort)).toBe("200");
        const nachher = await lies();
        // Die Revision steigt; wie weit, ist offen (ein Upsert löst die Anweisungs-Trigger für INSERT UND UPDATE aus).
        expect(nachher.revision!).toBeGreaterThan(vorher.revision!);
        expect(nachher.zeilen.map((z) => [z.id, z.spanne, z.changedBy])).toEqual([
            ["orte.dorf.name", { von: 3, bis: 8 }, "Rondrikan"],
            ["wege.Pfad.name", { von: 4, bis: 7 }, "Rondrikan"],
        ]);

        const ereignisse = await cluster!.admin<{ details: { anzahl: number; spuren: string[] } }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'system.zoom_band_changed' ORDER BY id
        `;
        expect(ereignisse.at(-1)?.details).toEqual({ anzahl: 2, spuren: ["orte.dorf.name", "wege.Pfad.name"] });

        const oeffentlich = await app.inject({ method: "GET", url: ZOOM_BANDS_URL });
        expect(oeffentlich.json<ZoomBandsPublic>().abweichungen).toEqual({
            "orte.dorf.name": { von: 3, bis: 8 },
            "wege.Pfad.name": { von: 4, bis: 7 },
        });
        expect(oeffentlich.headers["etag"]).not.toBe(etagVorher);
    });

    it("🔴 zurück auf die Vorgabe löscht die Zeile, ob als null oder als Vorgabe geschickt", async () => {
        expect(
            code(
                await uebernimm([
                    { id: "orte.dorf.name", spanne: { von: 3, bis: 8 } },
                    { id: "kraftlinien.kraftlinien.name", spanne: { von: 1, bis: 8 } },
                ]),
            ),
        ).toBe("200");
        expect(
            code(
                await uebernimm([
                    { id: "orte.dorf.name", spanne: null },
                    // Die Vorgabe der Kraftliniennamen ist Band 2 bis 8 (Legacys Stufe aus der Tafel).
                    { id: "kraftlinien.kraftlinien.name", spanne: { von: 2, bis: 8 } },
                ]),
            ),
        ).toBe("200");
        expect((await lies()).zeilen).toEqual([]);
        expect((await leseZoombaender(cluster!.app)).zeilen).toEqual([]);
    });

    it("🔴 abgewiesen: unbekannte Spur, Herrschaftsgebiete (nur zur Ansicht), verkehrte Spanne, nichts geändert, veraltet", async () => {
        expect(code(await uebernimm([{ id: "orte.drache.name", spanne: { von: 1, bis: 8 } }]))).toBe(
            "400 unknown_zoom_band",
        );
        expect(code(await uebernimm([{ id: "gebiete.reiche.flaeche", spanne: { von: 0, bis: 2 } }]))).toBe(
            "409 zoom_band_view_only",
        );
        expect(code(await uebernimm([{ id: "wege.Weg.linie", spanne: { von: 5, bis: 3 } }]))).toBe(
            "400 zoom_band_out_of_range",
        );
        expect(code(await uebernimm([{ id: "wege.Weg.linie", spanne: null }]))).toBe("409 no_change");
        const alt = (await lies()).revision!;
        expect(code(await uebernimm([{ id: "wege.Weg.linie", spanne: { von: 2, bis: 8 } }]))).toBe("200");
        expect(
            code(await uebernimm([{ id: "wege.Weg.linie", spanne: { von: 3, bis: 8 } }], { baseRevision: alt })),
        ).toBe("409 edit_conflict");
        // Nichts davon hat einen Eintrag hinterlassen außer dem einen, der durchging.
        expect((await lies()).zeilen.map((z) => z.id)).toEqual(["wege.Weg.linie"]);
    });

    it("🔴 Rechte: Admin darf (manage_display_settings), ein Editor sieht den Reiter nicht", async () => {
        expect(
            code(await uebernimm([{ id: "orte.stadt.name", spanne: { von: 2, bis: 8 } }], { cookie: admin.cookie })),
        ).toBe("200");
        const gesehen = await app.inject({ method: "GET", url: ZOOMBAENDER_URL, headers: { cookie: editor.cookie } });
        expect(gesehen.statusCode).toBe(403);
        const geschrieben = await app.inject({
            method: "POST",
            url: ZOOMBAENDER_URL,
            payload: {
                operationId: randomUUID(),
                baseRevision: (await lies()).revision,
                aenderungen: [{ id: "orte.stadt.name", spanne: { von: 1, bis: 8 } }],
            },
            headers: { origin: TEST_ORIGIN, cookie: editor.cookie },
        });
        expect(geschrieben.statusCode).toBe(403);
    });

    it("🔴 Rechte der App: Zeilen ja, TRUNCATE nein; die Revision legt sie weder an noch löscht sie sie", async () => {
        expect(await cluster!.granted(`avesmaps3d_${ENV}_app`, "zoom_band_setting")).toEqual([
            "SELECT",
            "INSERT",
            "UPDATE",
            "DELETE",
        ]);
        expect(await cluster!.granted(`avesmaps3d_${ENV}_app`, "zoom_band_state")).toEqual(["SELECT", "UPDATE"]);
        await expect(
            cluster!.app`INSERT INTO zoom_band_setting (key, von, bis) VALUES ('Orte.dorf.name', 1, 8)`,
        ).rejects.toThrow();
        await expect(
            cluster!.app`INSERT INTO zoom_band_setting (key, von, bis) VALUES ('orte.dorf.name', 6, 2)`,
        ).rejects.toThrow();
    });
});
