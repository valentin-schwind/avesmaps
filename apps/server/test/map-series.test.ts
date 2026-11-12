import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
    KARTENSERIEN_URL,
    MAP_SERIES_URL,
    type AdminKartenserien,
    type KartenserieAktion,
    type MapSeriesCatalog,
    type Role,
} from "@avesmaps3d/shared";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { leseKartenserien } from "../src/map-series/stand.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Der öffentliche Leseweg der Kartenserien (WI-0220, Migration 0167): die Vorgabe der JSON samt den Zeilen der Tafel
 * `map_series`, `no-cache` mit ETag.
 */

const ENV = "kartenserien";
const grants = [fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url))];
const describeWithCluster = postgresBin ? describe : describe.skip;

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "wi0220-test",
    databaseUrl: undefined,
    tileRoot: undefined,
    statusPage: true,
    auth: TEST_AUTH,
};

describe("GET /api/map-series ohne Datenbank", () => {
    let app: FastifyInstance;
    beforeAll(async () => {
        app = buildApp({ config });
        await app.ready();
    });
    afterAll(async () => app?.close());

    it("🔴 ohne Datenbank gilt die Vorgabe der JSON, mit ETag und 304 beim zweiten Blick", async () => {
        const erste = await app.inject({ method: "GET", url: MAP_SERIES_URL });
        expect(erste.statusCode).toBe(200);
        expect(erste.headers["cache-control"]).toBe("no-cache");
        const katalog = erste.json<MapSeriesCatalog>();
        expect(katalog.series.map((s) => s.id)).toEqual(["modern", "original", "old"]);
        expect(katalog.defaultSeries).toBe("modern");
        expect(katalog).not.toHaveProperty("notes");
        const zweite = await app.inject({
            method: "GET",
            url: MAP_SERIES_URL,
            headers: { "if-none-match": String(erste.headers["etag"]) },
        });
        expect(zweite.statusCode).toBe(304);
    });
});

describeWithCluster("GET /api/map-series mit der Tafel, App-Rolle wie auf dem VPS (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let app: FastifyInstance;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, grants);
        app = buildApp({ config, database: cluster.app });
        await app.ready();
    }, 180_000);
    beforeEach(async () => {
        await cluster!.migrator`DELETE FROM map_series`;
    });
    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    it("eine Abweichung, eine neue Serie und der Papierkorb kommen im Katalog an; die Revision steigt je Anweisung einmal", async () => {
        const db = cluster!.app;
        const [vorher] = await db<{ revision: number }[]>`SELECT revision::int AS revision FROM map_series_state`;
        await db`INSERT INTO map_series (series_id, label, thumb_x, thumb_y) VALUES ('original', 'Ina Kramer', 3, 9)`;
        await db`
            INSERT INTO map_series (series_id, label, source_pixels, max_native_zoom, visibility, is_default)
            VALUES ('nacht', 'Nacht', 65536, 7, 'PUBLIC', true)
        `;
        await db`UPDATE map_series SET status = 'papierkorb', papierkorb_at = now() WHERE series_id = 'original'`;
        const [nachher] = await db<{ revision: number }[]>`SELECT revision::int AS revision FROM map_series_state`;
        expect(nachher!.revision - vorher!.revision).toBe(3);

        expect((await leseKartenserien(db)).source).toBe("database");
        const katalog = (await app.inject({ method: "GET", url: MAP_SERIES_URL })).json<MapSeriesCatalog>();
        expect(katalog.series.map((s) => s.id)).toEqual(["modern", "old", "nacht"]);
        expect(katalog.defaultSeries).toBe("nacht");
        expect(katalog.series.find((s) => s.id === "nacht")?.maxNativeZoom).toBe(7);
    });

    it("🔴 die Tafel weist eine zweite Vorgabe und eine fremde Kennung ab; Beschriftung im Bild für alle nimmt sie seit 0335", async () => {
        const db = cluster!.app;
        // Besucher sehen so eine Serie nur unter „Nur Karte“ (Betreiber 2026-11-10); das hält der Schreibweg, nicht die Tafel.
        await db`INSERT INTO map_series (series_id, labels_in_image, visibility) VALUES ('nacht', true, 'PUBLIC')`;
        await db`DELETE FROM map_series WHERE series_id = 'nacht'`;
        await db`INSERT INTO map_series (series_id, is_default) VALUES ('original', true)`;
        await expect(db`INSERT INTO map_series (series_id, is_default) VALUES ('modern', true)`).rejects.toThrow();
        await expect(db`INSERT INTO map_series (series_id) VALUES ('Nacht-2')`).rejects.toThrow();
    });

    it("🔴 Rechte: die App schreibt Zeilen, aber kein TRUNCATE; die Revision legt sie weder an noch löscht sie sie", async () => {
        expect(await cluster!.granted(`avesmaps3d_${ENV}_app`, "map_series")).toEqual([
            "SELECT",
            "INSERT",
            "UPDATE",
            "DELETE",
        ]);
        expect(await cluster!.granted(`avesmaps3d_${ENV}_app`, "map_series_state")).toEqual(["SELECT", "UPDATE"]);
        expect(await cluster!.granted(`avesmaps3d_${ENV}_tiles`, "map_series")).toEqual([]);
    });
});

describeWithCluster("Reiter Kartenserien: lesen und Handlungen, App-Rolle wie auf dem VPS (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let operator: { cookie: string };
    let admin: { cookie: string };

    beforeAll(async () => {
        cluster = await startVpsCluster(`${ENV}w`, grants);
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
    }, 180_000);
    beforeEach(async () => {
        await cluster!.migrator`DELETE FROM map_series`;
        await cluster!.migrator`DELETE FROM content_switch WHERE key LIKE 'map.series.%'`;
    });
    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    const lies = async (cookie = operator.cookie): Promise<AdminKartenserien> => {
        const response = await app.inject({ method: "GET", url: KARTENSERIEN_URL, headers: { cookie } });
        expect(response.statusCode).toBe(200);
        return response.json<AdminKartenserien>();
    };
    const tu = async (id: string, aktion: KartenserieAktion, cookie = operator.cookie) => {
        const stand = await lies();
        return app.inject({
            method: "POST",
            url: KARTENSERIEN_URL,
            payload: { operationId: randomUUID(), baseRevision: stand.revision, id, aktion },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    };
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const serie = (stand: AdminKartenserien, id: string) => stand.serien.find((e) => e.serie.id === id)!;

    it("🔴 ohne Zeile: die drei Serien, Modern ist Vorgabe, alle drei für alle (Old für Besucher nur unter „Nur Karte“)", async () => {
        const stand = await lies();
        expect(stand.source).toBe("database");
        expect(stand.serien.map((e) => [e.serie.id, e.stufe, e.istVorgabe])).toEqual([
            ["modern", "alle", true],
            ["original", "alle", false],
            ["old", "alle", false],
        ]);
    });

    it("Bild, Name und Reihenfolge: je Handlung genau ein Eintrag im Protokoll; der Katalog der Karte folgt", async () => {
        expect(code(await tu("original", { art: "thumb", thumb: { x: 3, y: 9 } }))).toBe("200");
        expect(code(await tu("original", { art: "texte", texte: { label: "Ina Kramer" } }))).toBe("200");
        expect(code(await tu("old", { art: "reihe", richtung: "hoch" }))).toBe("200");
        const katalog = (await app.inject({ method: "GET", url: MAP_SERIES_URL })).json<MapSeriesCatalog>();
        expect(katalog.series.map((s) => s.id)).toEqual(["modern", "old", "original"]);
        expect(katalog.series.find((s) => s.id === "original")).toMatchObject({
            label: "Ina Kramer",
            thumb: { x: 3, y: 9 },
        });
        const ereignisse = await cluster!.admin<{ details: { series: string; aktion: string } }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'system.map_series_changed' ORDER BY id
        `;
        expect(ereignisse.slice(-3).map((e) => `${e.details.series}:${e.details.aktion}`)).toEqual([
            "original:thumb",
            "original:texte",
            "old:reihe",
        ]);
        // Ein Name gleich der Vorgabe wird nicht gespeichert: zurück heißt die Abweichung weg.
        expect(code(await tu("original", { art: "texte", texte: { label: "Original" } }))).toBe("200");
        const [zeile] = await cluster!.app<
            { label: string | null }[]
        >`SELECT label FROM map_series WHERE series_id = 'original'`;
        expect(zeile?.label).toBeNull();
    });

    it("🔴 Sichtbarkeit: Niemand ist der Inhaltsschalter, Beschriftung im Bild nie Vorgabe, die Vorgabe bleibt für alle", async () => {
        expect(code(await tu("original", { art: "stufe", stufe: "niemand" }))).toBe("200");
        const [schalter] = await cluster!.app<{ enabled: boolean }[]>`
            SELECT enabled FROM content_switch WHERE key = 'map.series.original'
        `;
        expect(schalter?.enabled).toBe(false);
        expect(serie(await lies(), "original").stufe).toBe("niemand");
        expect(code(await tu("old", { art: "stufe", stufe: "niemand" }))).toBe("200");
        // Beschriftung im Bild darf „Alle“ heißen (Betreiber 2026-11-10); Besucher sehen sie nur unter „Nur Karte“.
        expect(code(await tu("old", { art: "stufe", stufe: "editoren" }))).toBe("200");
        expect(serie(await lies(), "old").stufe).toBe("editoren");
        expect(code(await tu("old", { art: "stufe", stufe: "alle" }))).toBe("200");
        expect(serie(await lies(), "old").stufe).toBe("alle");
        expect(code(await tu("old", { art: "vorgabe" }))).toBe("409 labels_in_image");
        expect(code(await tu("modern", { art: "stufe", stufe: "editoren" }))).toBe("409 default_visible");
        expect(code(await tu("original", { art: "stufe", stufe: "alle" }))).toBe("200");
        expect(serie(await lies(), "original").stufe).toBe("alle");
    });

    it("🔴 Vorgabe und Papierkorb: die Vorgabe nicht löschen, die letzte für alle sichtbare nicht verbergen; Wiederherstellen", async () => {
        expect(code(await tu("modern", { art: "papierkorb" }))).toBe("409 default_visible");
        expect(code(await tu("original", { art: "vorgabe" }))).toBe("200");
        expect(code(await tu("old", { art: "vorgabe" }))).toBe("409 labels_in_image");
        expect(code(await tu("modern", { art: "papierkorb" }))).toBe("200");
        // Jetzt ist Original die einzige, die alle überall sehen, und die Vorgabe. Old zählt nicht mit (Beschriftung im Bild).
        expect(code(await tu("original", { art: "stufe", stufe: "editoren" }))).toBe("409 default_visible");
        const stand = await lies();
        expect(stand.serien.map((e) => e.serie.id)).toEqual(["original", "old"]);
        expect(stand.papierkorb.map((p) => p.id)).toEqual(["modern"]);
        expect(code(await tu("modern", { art: "wiederherstellen" }))).toBe("200");
        expect((await lies()).papierkorb).toEqual([]);
    });

    it("🔴 Rechte: ein Admin sieht, ändert aber nicht (Sonderrecht manage_map_series); veraltete Revision 409", async () => {
        await lies(admin.cookie);
        expect(code(await tu("original", { art: "thumb", thumb: null }, admin.cookie))).toBe("403 forbidden");
        const veraltet = await app.inject({
            method: "POST",
            url: KARTENSERIEN_URL,
            payload: {
                operationId: randomUUID(),
                baseRevision: 0,
                id: "original",
                aktion: { art: "thumb", thumb: { x: 1, y: 1 } },
            },
            headers: { origin: TEST_ORIGIN, cookie: operator.cookie },
        });
        expect(code(veraltet)).toBe("409 edit_conflict");
    });
});
