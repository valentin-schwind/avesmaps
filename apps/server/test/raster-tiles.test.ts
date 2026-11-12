import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";

/**
 * Die lokale Spiegelung der Rasterauslieferung (ADR-0008).
 *
 * 🔴 Diese Route ist NICHT, was Besucher sehen - auf Staging liefert Nginx die Dateien direkt. Sie
 * muss aber dieselben Pfade und dieselben Cache-Zusagen machen, sonst ist „lokal grün" eine
 * Aussage über eine andere Auslieferung.
 */

const REVISION = "3f2a9c01be47";
const POINTER = {
    schemaVersion: 1,
    series: "original",
    revision: REVISION,
    manifest: `${REVISION}5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c`,
    format: "webp",
    tileSize: 512,
    maxNativeZoom: 6,
};

let tileRoot: string;
let app: FastifyInstance;

beforeAll(() => {
    tileRoot = mkdtempSync(join(tmpdir(), "avesmaps3d-raster-"));
    mkdirSync(join(tileRoot, "original", REVISION, "0", "0"), { recursive: true });
    writeFileSync(join(tileRoot, "original", REVISION, "0", "0", "0.webp"), Buffer.from("RIFF0000WEBPVP8 "));
    writeFileSync(join(tileRoot, "original", "current.json"), JSON.stringify(POINTER));
    app = buildApp({
        config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot },
    });
});

afterAll(async () => {
    await app.close();
    rmSync(tileRoot, { recursive: true, force: true });
});

describe("Zeiger current.json", () => {
    it("wird ausgeliefert, aber bei jedem Zugriff nachgefragt", async () => {
        const response = await app.inject({ method: "GET", url: "/tiles/raster/original/current.json" });

        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-cache");
        expect(response.headers["content-type"]).toMatch(/^application\/json/);
        expect(response.json()).toEqual(POINTER);
    });

    it("antwortet 304, solange er sich nicht geändert hat", async () => {
        const first = await app.inject({ method: "GET", url: "/tiles/raster/original/current.json" });
        const etag = first.headers["etag"] as string;
        expect(etag).toMatch(/^"[0-9a-f]{16}"$/);

        const again = await app.inject({
            method: "GET",
            url: "/tiles/raster/original/current.json",
            headers: { "if-none-match": etag },
        });
        expect(again.statusCode).toBe(304);
        expect(again.body).toBe("");
    });

    it("🪤 fehlt er, ist das ein 404 und keine leere Kachel", async () => {
        const response = await app.inject({ method: "GET", url: "/tiles/raster/modern/current.json" });

        expect(response.statusCode).toBe(404);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.json()).toMatchObject({ error: { code: "no_raster_pointer" } });
    });
});

describe("Kacheln unter ihrer Revision", () => {
    it("sind ein Jahr unveränderlich", async () => {
        const response = await app.inject({ method: "GET", url: `/tiles/raster/original/${REVISION}/0/0/0.webp` });

        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toBe("image/webp");
        expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
        expect(response.body.startsWith("RIFF")).toBe(true);
    });

    it("🪤 eine fehlende Kachel ist 204 und wird NIE gespeichert", async () => {
        const response = await app.inject({ method: "GET", url: `/tiles/raster/original/${REVISION}/6/9/9.webp` });

        expect(response.statusCode).toBe(204);
        expect(response.headers["cache-control"]).toBe("no-store");
    });

    it.each([
        ["eine Revision, die keine ist", "/tiles/raster/original/current/0/0/0.webp", 400],
        ["ein Pfad statt einer Revision", "/tiles/raster/original/..%2F..%2Fxx/0/0/0.webp", 400],
        ["eine unbekannte Serie", `/tiles/raster/gibtesnicht/${REVISION}/0/0/0.webp`, 404],
        ["der alte feste PNG-Pfad", "/tiles/raster/original/0/0/0.png", 404],
    ])("weist %s ab", async (_, url, status) => {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(status);
    });
});

describe("ohne TILE_ROOT", () => {
    it("sagt es, statt leere Kacheln zu liefern", async () => {
        const bare = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
        });
        try {
            const pointer = await bare.inject({ method: "GET", url: "/tiles/raster/original/current.json" });
            const tile = await bare.inject({ method: "GET", url: `/tiles/raster/original/${REVISION}/0/0/0.webp` });
            expect(pointer.statusCode).toBe(503);
            expect(tile.statusCode).toBe(503);
        } finally {
            await bare.close();
        }
    });
});
