import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { DEM_MAX_ZOOM, DEM_TILE_FORMAT, DEM_TILE_SIZE, type StoredRaster } from "../src/terrain/dem-tiles.ts";
import { publishDomainDem, verifyDomainPublication } from "../src/terrain/domain/publish.ts";

/**
 * Der Übergang von PNG zu WebP in der Datenbank (WI-0073): Zu einem Master, für den nur eine PNG-Revision vorliegt (vor
 * der Umstellung), wird einmal eine WebP-Revision veröffentlicht, ohne dass der Master neu gerechnet wird; danach ist
 * sie bekannt. Geprüft wird die Veröffentlichung, nicht die Aktivierung (die braucht die ganzen Eingaben der Karte).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const DOMAIN = "aventuria";
const MASTER = "0073-test-master";
const PNG_REVISION = "0073c0ffee01";
const N = DEM_TILE_SIZE << DEM_MAX_ZOOM;

/** Ein Master wie veröffentlicht: nur Meer und ein Hügel mit Gipfel (Zeile 0 im Süden). */
function master(): StoredRaster {
    const samples = new Uint16Array(N * N);
    for (let y = 3000; y < 3300; y += 1) {
        for (let x = 5000; x < 5300; x += 1) {
            const distance = Math.hypot(x - 5150, y - 3150);
            samples[y * N + x] = Math.max(0, Math.round(1800 - distance * 12));
        }
    }
    const cell = 1024 / N;
    return { cell, originX: cell / 2, originY: cell / 2, width: N, height: N, samples };
}

describeWithDatabase("Übergang der Höhenkacheln von PNG zu WebP", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await clean();
        // Die Revisionen verweisen auf einen Master (Fremdschlüssel); sein Inhalt ist für die Veröffentlichung ohne Belang,
        // sie bekommt das Raster übergeben. 4096² ist die kleinste gültige Größe der Tabelle.
        await database`
            INSERT INTO terrain_domain_raster (map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report)
            VALUES (${DOMAIN}, ${MASTER}, 'input', 'test', 4096, decode(repeat('00', 4096 * 4096 * 2), 'hex'), '{}'::jsonb)
        `;
    }, 120_000);

    const clean = async (): Promise<void> => {
        await database`DELETE FROM terrain_dem WHERE domain_fingerprint = ${MASTER}`;
        await database`DELETE FROM terrain_domain_raster WHERE fingerprint = ${MASTER}`;
    };

    afterAll(async () => {
        await clean();
        await database.end({ timeout: 5 });
    });

    it("🔴 eine PNG-Revision desselben Masters ist nicht bekannt: einmal WebP veröffentlichen, danach ist sie bekannt", async () => {
        // Die Revision aus der Zeit davor: ohne Format-Angabe (Standard png), mit einer Platzhalter-Kachel.
        await database`
            INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, domain_fingerprint)
            VALUES (${PNG_REVISION}, ${DOMAIN}, 'input', 512, 4, 'mapbox', 1, 4, ${MASTER})
        `;
        await database`INSERT INTO terrain_dem_tile (revision, z, x, y, png) VALUES (${PNG_REVISION}, 0, 0, 0, ${Buffer.from([137, 80, 78, 71])})`;

        const raster = master();
        const first = await publishDomainDem(database, DOMAIN, MASTER, "input", raster);
        expect(first.published, "die neue Revision wird geschrieben").toBe(true);
        expect(first.tiles).toBe(341);
        expect(first.revision).not.toBe(PNG_REVISION);

        const rows = await database<{ revision: string; format: string; tiles: number; is_current: boolean }[]>`
            SELECT revision, format, tiles, is_current FROM terrain_dem WHERE domain_fingerprint = ${MASTER} ORDER BY format
        `;
        expect(rows.map((row) => [row.revision, row.format])).toEqual([
            [PNG_REVISION, "png"],
            [first.revision, DEM_TILE_FORMAT],
        ]);
        // Der Zeiger bleibt, wo er war: Aktivieren ist ein eigener Schritt nach der Prüfung.
        expect(rows.every((row) => !row.is_current)).toBe(true);
        const [stored] = await database<{ count: number; bytes: string }[]>`
            SELECT count(*)::int AS count, sum(octet_length(png))::text AS bytes FROM terrain_dem_tile WHERE revision = ${first.revision}
        `;
        expect(stored?.count).toBe(341);
        expect(Number(stored?.bytes)).toBe(first.bytes);

        const again = await publishDomainDem(database, DOMAIN, MASTER, "input", raster);
        expect(again.published, "jetzt ist die WebP-Revision bekannt, es wird nichts neu geschrieben").toBe(false);
        expect(again.revision).toBe(first.revision);
    }, 180_000);

    it("🔴 geprüft wird die Revision im heutigen Format (oder die genannte), nicht irgendeine zum Master", async () => {
        const raster = master();
        const [webp] = await database<{ revision: string }[]>`
            SELECT revision FROM terrain_dem WHERE domain_fingerprint = ${MASTER} AND format = ${DEM_TILE_FORMAT}
        `;
        // Ohne Angabe: die WebP-Revision; alle 256 Kacheln der feinsten Stufe lesen sich als der Master.
        expect(await verifyDomainPublication(database, DOMAIN, MASTER, raster)).toEqual([]);
        expect(await verifyDomainPublication(database, DOMAIN, MASTER, raster, webp?.revision)).toEqual([]);
        // Die genannte PNG-Platzhalter-Revision ist keine Veröffentlichung dieses Masters: Zahl und Bytes stimmen nicht.
        const errors = await verifyDomainPublication(database, DOMAIN, MASTER, raster, PNG_REVISION);
        expect(errors).toContain("publication:revision-or-count");
        // Ein anderer Master hat gar keine.
        expect(await verifyDomainPublication(database, DOMAIN, "0073-anderer-master", raster)).toEqual([
            "publication:missing",
        ]);
    }, 180_000);

    it("🔴 eine beschädigte Kachel fällt beim Prüfen auf, auch wenn die Revision (der Hash der Bytes) neu berechnet würde", async () => {
        const raster = master();
        const [webp] = await database<{ revision: string }[]>`
            SELECT revision FROM terrain_dem WHERE domain_fingerprint = ${MASTER} AND format = ${DEM_TILE_FORMAT}
        `;
        const revision = webp!.revision;
        // Ein Byte mitten im Strom einer Kachel der feinsten Stufe mit dem Hügel kippen.
        const [tile] = await database<{ x: number; y: number; png: Buffer }[]>`
            SELECT x, y, png FROM terrain_dem_tile WHERE revision = ${revision} AND z = ${DEM_MAX_ZOOM} AND octet_length(png) > 5000 ORDER BY octet_length(png) DESC LIMIT 1
        `;
        expect(tile).toBeDefined();
        const damaged = Buffer.from(tile!.png);
        damaged[damaged.length >> 1] = damaged[damaged.length >> 1]! ^ 0x55;
        await database`UPDATE terrain_dem_tile SET png = ${damaged} WHERE revision = ${revision} AND z = ${DEM_MAX_ZOOM} AND x = ${tile!.x} AND y = ${tile!.y}`;
        const errors = await verifyDomainPublication(database, DOMAIN, MASTER, raster);
        expect(errors.length).toBeGreaterThan(0);
        expect(
            errors.some(
                (error) => error === "publication:revision-or-count" || error.startsWith("publication:master-mismatch"),
            ),
        ).toBe(true);
    }, 180_000);
});
