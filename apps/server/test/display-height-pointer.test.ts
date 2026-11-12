import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { DISPLAY_HEIGHT_GENERATOR } from "../src/terrain/display-height/generate.ts";
import { displayHeightState, rebindDisplayHeight } from "../src/terrain/display-height/pointer.ts";

/**
 * Die Anzeigehöhen sind an Gelände und Relief gebunden (Kapitel 5.32a, Regel 2; Hardening-Review M4): Passt die
 * Revision nicht mehr, gilt sie als veraltet, und die Karte zeigt keine Linien und keine Stufen. Dazu: Die
 * geglättete Anzeigeküste liest nur, wer darstellt oder auswählt, nie das Routing.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Eine eigene Kartendomäne, damit der Test keine aktuelle Revision eines anderen Tests berührt. */
const DOMAIN = "test-wi0055-pointer";
const DEM = { alt: "0055a0000001", neu: "0055a0000002", kodierung: "0055a0000003", anderes: "0055a0000004" };
/** Der Fingerabdruck des Domain-Masters: die Höhen selbst, unabhängig davon, wie die Kacheln kodiert sind. */
const MASTER = { gleich: "master-0055-a", anders: "master-0055-b" };
const RELIEF = "0055b0000001";
const DISPLAY = "0055c0000001";

describeWithDatabase("Zeiger der Anzeigehöhen gegen PostGIS", () => {
    let database: Database;

    async function cleanup(): Promise<void> {
        await database`DELETE FROM terrain_display_height WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM terrain_visual_relief WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM terrain_dem WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM terrain_domain_raster WHERE map_domain_id = ${DOMAIN}`;
    }
    /**
     * Ein leeres Domain-Master zu einem Fingerabdruck. 🪤 Es muss wirklich 4096² Proben tragen (CHECK der Migration
     * 0061), weil `terrain_dem.domain_fingerprint` darauf zeigt; die Nullen komprimiert PostgreSQL auf fast nichts.
     */
    async function master(fingerprint: string): Promise<void> {
        await database`
            INSERT INTO terrain_domain_raster (
                map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report
            ) VALUES (${DOMAIN}, ${fingerprint}, 'test', 'test', 4096, ${Buffer.alloc(4096 * 4096 * 2)}, '{}')
            ON CONFLICT DO NOTHING
        `;
    }
    async function dem(revision: string, current: boolean, domainFingerprint?: string): Promise<void> {
        await database`
            INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, is_current, domain_fingerprint)
            VALUES (${revision}, ${DOMAIN}, 'test', 512, 3, 'mapbox', 1, 1, ${current}, ${domainFingerprint ?? null})
        `;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await database`
            INSERT INTO map_domain
            SELECT (jsonb_populate_record(NULL::map_domain, to_jsonb(m) || ${database.json({ id: DOMAIN })})).*
            FROM map_domain m WHERE m.id = 'aventuria'
            ON CONFLICT (id) DO NOTHING
        `;
        await cleanup();
        await master(MASTER.gleich);
        await master(MASTER.anders);
        await dem(DEM.alt, true);
        await database`
            INSERT INTO terrain_visual_relief (
                revision, map_domain_id, fingerprint, dem_revision, generator_version, seed, params, tile_size,
                max_zoom, encoding, tiles, bytes, output_checksum, is_current
            ) VALUES (${RELIEF}, ${DOMAIN}, 'test', ${DEM.alt}, '3', 1, '{}', 512, 3, 'mapbox', 1, 1, 'test', TRUE)
        `;
        await database`
            INSERT INTO terrain_display_height (
                revision, map_domain_id, fingerprint, dem_revision, relief_revision, generator_version, params,
                contours, contour_points, band_pieces, is_current
            ) VALUES (${DISPLAY}, ${DOMAIN}, 'test', ${DEM.alt}, ${DEM.alt}, ${DISPLAY_HEIGHT_GENERATOR}, '{}', 0, 0, 0, TRUE)
        `;
    });

    afterAll(async () => {
        await cleanup();
        await database`DELETE FROM map_domain WHERE id = ${DOMAIN}`;
        await database.end({ timeout: 5 });
    });

    it("🔴 eine Revision aus einer älteren Fassung der Rechnung ist veraltet, auch bei gleichem Gelände", async () => {
        // Höhenstufen-Befund 2026-10-03: Die Ableitung rechnet nur bei geänderten Eingaben; ohne die Fassung im
        // Fingerabdruck und im Zeiger bliebe die fehlerhafte Revision auf demselben Gelände bestehen.
        await database`UPDATE terrain_display_height SET generator_version = '2' WHERE revision = ${DISPLAY}`;
        expect((await displayHeightState(database, DOMAIN)).kind).toBe("stale");
        await database`UPDATE terrain_display_height SET generator_version = ${DISPLAY_HEIGHT_GENERATOR} WHERE revision = ${DISPLAY}`;
        expect((await displayHeightState(database, DOMAIN)).kind).toBe("current");
    });

    it("🔴 gilt unabhängig vom alten Relief; nach einem neuen Domain-DEM ist sie veraltet", async () => {
        expect(await displayHeightState(database, DOMAIN)).toEqual({
            kind: "current",
            revision: DISPLAY,
            demRevision: DEM.alt,
        });
        await database`UPDATE terrain_visual_relief SET is_current = FALSE WHERE map_domain_id = ${DOMAIN}`;
        expect((await displayHeightState(database, DOMAIN)).kind).toBe("current");
        // Ein neues Gelände ist veröffentlicht, `derive:display-heights` ist noch nicht gelaufen.
        await database`UPDATE terrain_dem SET is_current = FALSE WHERE map_domain_id = ${DOMAIN}`;
        await dem(DEM.neu, true);
        expect((await displayHeightState(database, DOMAIN)).kind).toBe("stale");
        expect((await displayHeightState(database, "keine-domaene")).kind).toBe("none");
    });

    it("🔴 gleiche Höhen auf neuem Gelände: die Ableitung bindet dieselbe Revision neu, danach ist sie aktuell", async () => {
        // Stage 2026-10-04 (`9a666c7`): dasselbe Master als WebP, neue DEM-Revision, dieselbe Anzeigehöhen-Revision.
        // Vorher schrieb die Ableitung nur den Fingerabdruck, der Zeiger blieb veraltet, die Karte ohne Linien.
        expect((await displayHeightState(database, DOMAIN)).kind).toBe("stale");
        await rebindDisplayHeight(database, DISPLAY, {
            fingerprint: "neu",
            demRevision: DEM.neu,
            reliefRevision: DEM.neu,
        });
        expect(await displayHeightState(database, DOMAIN)).toEqual({
            kind: "current",
            revision: DISPLAY,
            demRevision: DEM.neu,
        });
    });

    it("🔴 nur die Kodierung der Kacheln ist neu: dasselbe Domain-Gelände, die Linien bleiben gültig", async () => {
        // 💣 WI-0149: WI-0142 rundete die Höhen der Kacheln auf einen Schritt. Das ändert die DEM-Revision (ein Hash
        // der Kachelbytes), nicht aber die Höhen - die Anzeigehöhen rechnen aus `terrain_domain_raster`, nicht aus
        // den Kacheln. Trotzdem galten sie als veraltet, und die Karte zeigte in 2D wie in 3D weder Linien noch
        // Stufen noch Legende (Betreiber 2026-10-14). Gebunden wird deshalb an den Fingerabdruck des Masters.
        await database`UPDATE terrain_dem SET domain_fingerprint = ${MASTER.gleich} WHERE revision = ${DEM.neu}`;
        await database`UPDATE terrain_dem SET is_current = FALSE WHERE map_domain_id = ${DOMAIN}`;
        await dem(DEM.kodierung, true, MASTER.gleich);
        // 🔴 Gemeldet wird die Revision, die GILT: Die Karte vergleicht sie mit dem Gelände, das sie geladen hat
        // (`displayHeightFor`), und blendet die Linien sonst selbst aus.
        expect(await displayHeightState(database, DOMAIN)).toEqual({
            kind: "current",
            revision: DISPLAY,
            demRevision: DEM.kodierung,
        });
    });

    it("🔴 ein anderes Domain-Gelände bleibt veraltet, auch mit gültigen Linien", async () => {
        await database`UPDATE terrain_dem SET is_current = FALSE WHERE map_domain_id = ${DOMAIN}`;
        await dem(DEM.anderes, true, MASTER.anders);
        expect((await displayHeightState(database, DOMAIN)).kind).toBe("stale");
        // Ohne bekannten Master (ältere Zeilen) gilt wie bisher allein die Revision.
        await database`UPDATE terrain_dem SET domain_fingerprint = NULL WHERE map_domain_id = ${DOMAIN}`;
        expect((await displayHeightState(database, DOMAIN)).kind).toBe("stale");
    });
});

describe("Die geglättete Anzeigeküste", () => {
    // 🔴 Kapitel 5.32a, Regel 1 (Hardening-Review M4): Sie ist Darstellung. Lesen dürfen sie die Anzeigehöhen (die
    // Linien enden an ihr) und die Kartenauswahl (Umriss für Vorschau und Leuchten), nie das Routing.
    const root = join(import.meta.dirname, "..", "src");
    function files(dir: string): string[] {
        return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
            entry.isDirectory()
                ? files(join(dir, entry.name))
                : entry.name.endsWith(".ts")
                  ? [join(dir, entry.name)]
                  : [],
        );
    }

    it("lesen nur die Anzeigehöhen, die Kartenauswahl und die Glättung der Flächen", () => {
        // Die Anzeigehöhen selbst (ihr Ordner) schneiden ihre Linien an der Küste ab; außerhalb nur die Auswahl und, seit
        // WI-0077, die Glättung der Flächen, die das Ufer im gemeinsamen Netz baut (ebenfalls Darstellung). Deren Rechnung liegt
        // seit WI-0178 L2 in `packages/shared/src/flaechen-rundung/` und nennt die Küste dort; im Server bleibt die Auswahl.
        const readers = files(root)
            .filter((file) => !file.includes(join("terrain", "display-height")))
            .filter((file) => /terrain_water_(smooth|render)/.test(readFileSync(file, "utf8")))
            .map((file) => file.slice(root.length + 1))
            .sort();
        expect(readers).toEqual([join("areas", "area-lookup.ts")]);
        const rundung = join(import.meta.dirname, "..", "..", "..", "packages", "shared", "src", "flaechen-rundung");
        expect(
            files(rundung)
                .filter((file) => /terrain_water_(smooth|render)/.test(readFileSync(file, "utf8")))
                .map((file) => file.slice(rundung.length + 1))
                .sort(),
        ).toEqual(["smooth-line.ts", "smooth-net.ts"]);
        expect(readers.some((file) => file.startsWith(`routing`))).toBe(false);
    });
});
