import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { tileRevision } from "../src/terrain/dem-tiles.ts";
import { encodeWebpRgb } from "../src/terrain/webp/encode.ts";

/**
 * Die Geländekacheln aus der Datenbank (WI-0049 S3): dieselben Zusagen wie die Grundkarte (ADR-0008).
 * Seit WI-0073 trägt eine Revision ihr Format (WebP, oder PNG aus der Zeit davor); die Endung der URL ist das Format.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const PNG_REVISION = "0049abcdef01";
const WEBP_REVISION = "0073abcdef02";
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const WEBP = encodeWebpRgb(
    Uint8Array.from({ length: 4 * 4 * 3 }, (_, i) => (i * 37) & 255),
    4,
    4,
);

describeWithDatabase("Geländekacheln", () => {
    let database: Database;
    let app: FastifyInstance;
    let previous: string | undefined;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await database`DELETE FROM terrain_dem WHERE revision IN (${PNG_REVISION}, ${WEBP_REVISION})`;
        // Eine vorhandene aktuelle Revision wird für den Test beiseitegestellt und danach zurückgesetzt.
        const [current] = await database<{ revision: string }[]>`
            SELECT revision FROM terrain_dem WHERE map_domain_id = 'aventuria' AND is_current
        `;
        previous = current?.revision;
        await database`UPDATE terrain_dem SET is_current = FALSE WHERE map_domain_id = 'aventuria' AND is_current`;
        // Ohne Angabe des Formats gilt PNG: so schreibt auch der Code vor WI-0073 (Rückweg).
        await database`
            INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, is_current)
            VALUES (${PNG_REVISION}, 'aventuria', 'test', 512, 3, 'mapbox', 1, ${PNG.length}, TRUE)
        `;
        await database`INSERT INTO terrain_dem_tile (revision, z, x, y, png) VALUES (${PNG_REVISION}, 0, 0, 0, ${PNG})`;
        await database`
            INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, format)
            VALUES (${WEBP_REVISION}, 'aventuria', 'test', 512, 4, 'mapbox', 1, ${WEBP.length}, 'webp')
        `;
        await database`INSERT INTO terrain_dem_tile (revision, z, x, y, png) VALUES (${WEBP_REVISION}, 0, 0, 0, ${WEBP})`;
        app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
            database,
        });
    });

    afterAll(async () => {
        await app.close();
        const cleanup = createDatabase(testDatabaseUrl as string, { max: 1 });
        await cleanup`DELETE FROM terrain_dem WHERE revision IN (${PNG_REVISION}, ${WEBP_REVISION})`;
        if (previous) {
            await cleanup`UPDATE terrain_dem SET is_current = TRUE WHERE revision = ${previous}`;
        }
        await cleanup.end({ timeout: 5 });
    });

    const makeCurrent = async (revision: string): Promise<void> => {
        await database`UPDATE terrain_dem SET is_current = FALSE WHERE map_domain_id = 'aventuria' AND is_current`;
        await database`UPDATE terrain_dem SET is_current = TRUE WHERE revision = ${revision}`;
    };

    it("liefert den Zeiger ohne Cache, mit ETag und mit dem Format der Kacheln", async () => {
        await makeCurrent(PNG_REVISION);
        const response = await app.inject({ method: "GET", url: "/tiles/terrain/dem/current.json" });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-cache");
        expect(response.json()).toEqual({
            schemaVersion: 1,
            revision: PNG_REVISION,
            tileSize: 512,
            maxNativeZoom: 3,
            encoding: "mapbox",
            format: "png",
            // Das Manifest (WI-0125): je Kachel ihre Revision, der Inhalts-Hash ihrer Bytes.
            tiles: { "0/0/0": tileRevision(PNG) },
        });
        const again = await app.inject({
            method: "GET",
            url: "/tiles/terrain/dem/current.json",
            headers: { "if-none-match": String(response.headers["etag"]) },
        });
        expect(again.statusCode).toBe(304);
    });

    it("🔴 der Zeiger einer WebP-Revision sagt webp, ein neuer ETag ersetzt den alten", async () => {
        await makeCurrent(PNG_REVISION);
        const before = await app.inject({ method: "GET", url: "/tiles/terrain/dem/current.json" });
        await makeCurrent(WEBP_REVISION);
        const after = await app.inject({
            method: "GET",
            url: "/tiles/terrain/dem/current.json",
            headers: { "if-none-match": String(before.headers["etag"]) },
        });
        expect(after.statusCode).toBe(200);
        expect(after.json()).toMatchObject({ revision: WEBP_REVISION, maxNativeZoom: 4, format: "webp" });
    });

    it("liefert eine Kachel unveränderlich, eine fehlende leer und nie gecacht", async () => {
        const tile = await app.inject({ method: "GET", url: `/tiles/terrain/dem/${PNG_REVISION}/0/0/0.png` });
        expect(tile.statusCode).toBe(200);
        expect(tile.headers["content-type"]).toBe("image/png");
        expect(tile.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
        expect(tile.rawPayload.equals(PNG)).toBe(true);

        const missing = await app.inject({ method: "GET", url: `/tiles/terrain/dem/${PNG_REVISION}/3/7/7.png` });
        expect(missing.statusCode).toBe(204);
        expect(missing.headers["cache-control"]).toBe("no-store");
    });

    it("liefert eine WebP-Kachel als image/webp, byte-gleich zur abgelegten", async () => {
        const tile = await app.inject({ method: "GET", url: `/tiles/terrain/dem/${WEBP_REVISION}/0/0/0.webp` });
        expect(tile.statusCode).toBe(200);
        expect(tile.headers["content-type"]).toBe("image/webp");
        expect(tile.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
        expect(tile.rawPayload.equals(WEBP)).toBe(true);
    });

    it("🔴 eine Revision antwortet nur unter der Endung ihres Formats (kein WebP unter .png und umgekehrt)", async () => {
        for (const url of [
            `/tiles/terrain/dem/${WEBP_REVISION}/0/0/0.png`,
            `/tiles/terrain/dem/${PNG_REVISION}/0/0/0.webp`,
        ]) {
            const response = await app.inject({ method: "GET", url });
            expect(response.statusCode, url).toBe(204);
            expect(response.headers["cache-control"], url).toBe("no-store");
        }
    });

    it("🔴 eine Kachel liegt auch unter ihrer eigenen Revision, unveränderlich, im Format ihrer Revision (WI-0125)", async () => {
        const own = tileRevision(WEBP);
        const tile = await app.inject({ method: "GET", url: `/tiles/terrain/dem/k/${own}/0/0/0.webp` });
        expect(tile.statusCode).toBe(200);
        expect(tile.headers["content-type"]).toBe("image/webp");
        expect(tile.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
        expect(tile.rawPayload.equals(WEBP)).toBe(true);
        // Eine andere Stelle oder ein anderes Format unter derselben Kachelrevision gibt es nicht.
        for (const url of [`/tiles/terrain/dem/k/${own}/1/0/0.webp`, `/tiles/terrain/dem/k/${own}/0/0/0.png`]) {
            const response = await app.inject({ method: "GET", url });
            expect(response.statusCode, url).toBe(204);
            expect(response.headers["cache-control"], url).toBe("no-store");
        }
        const bad = await app.inject({ method: "GET", url: `/tiles/terrain/dem/k/${own.slice(0, 12)}/0/0/0.webp` });
        expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("🔴 der Trigger rechnet die Kachelrevision aus den Bytes wie `tileRevision`, auch wenn der Schreiber eine andere nennt", async () => {
        const [row] = await database<{ tile_revision: string }[]>`
            SELECT tile_revision FROM terrain_dem_tile WHERE revision = ${WEBP_REVISION} AND z = 0
        `;
        expect(row?.tile_revision).toBe(tileRevision(WEBP));
        await database`UPDATE terrain_dem_tile SET tile_revision = 'ffffffffffffffff' WHERE revision = ${WEBP_REVISION}`;
        const [again] = await database<{ tile_revision: string }[]>`
            SELECT tile_revision FROM terrain_dem_tile WHERE revision = ${WEBP_REVISION} AND z = 0
        `;
        expect(again?.tile_revision).toBe(tileRevision(WEBP));
    });

    it("weist eine Revision außerhalb des Musters ab", async () => {
        for (const extension of ["png", "webp"]) {
            const response = await app.inject({ method: "GET", url: `/tiles/terrain/dem/../0/0/0.${extension}` });
            expect(response.statusCode).toBeGreaterThanOrEqual(400);
        }
    });
});
