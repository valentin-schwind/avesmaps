import { fileURLToPath } from "node:url";
import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EditorTerritoryFindings, type EditorTerritoryFinding } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { readTerritoryFindings } from "../src/editor/territory-findings.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { deriveTerritories } from "../src/territories/derive.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Prüfen“ im Gebietseditor (WI-0209 D6; EDIT-0005 §7 D6: „jeder Befund einmal, keiner sperrt“), so wie auf dem VPS: Wegwerf-Cluster,
 * Import als Migrationsrolle, Ableitung als Jobs-Rolle, gelesen als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die
 * geteilte Testdatenbank.
 *
 * Problemfälle: ein Befund fehlt oder steht doppelt; eine Überlappung mit dem eigenen Obergebiet zählt; eine Lücke wird nach Legacys
 * Klemme auf 6 gerechnet statt bis 8; eine Hauptstadt ohne Lage zählt als hängend; N2 meldet nach einer frischen Ableitung etwas.
 */

const ENV = "pruefen";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `d6d6d6d6-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const GRAF = ID(2);
const NORD = ID(3);
const SUED = ID(4);
const FREMD = ID(5);
const PLATZ = ID(6);
const KAPUTT = ID(7);
const NORD_F = ID(0xa3);
const SUED_F = ID(0xa4);
const FREMD_F = ID(0xa5);
const KAPUTT_F = ID(0xa7);
/** Die Hauptstadt des Reichs, außerhalb jeder seiner Formen; der Sitz zeigt auf einen Ort, den es nicht gibt. */
const STADT = ID(0xc1);
const GEIST = ID(0xc2);

type Ring = [number, number][];
const rechteck = (x0: number, y0: number, x1: number, y1: number): Ring => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
];

function gebiet(
    id: string,
    name: string,
    eltern: string | null,
    [min, max]: [number, number],
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        public_id: id,
        name,
        short_name: "",
        type: "Baronie",
        wiki_type: "Baronie",
        parent_public_id: eltern,
        status: "",
        color: "#b2b065",
        opacity: 0.7,
        min_zoom: min,
        max_zoom: max,
        valid_from_bf: 100,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: `wiki:${name}`,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: 0,
        updated_at: "2026-10-17 01:00:00",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
        ...extra,
    };
}
const flaeche = (id: string, territory: string, ring: Ring): Record<string, unknown> => ({
    public_id: id,
    territory_public_id: territory,
    geometry: { type: "Polygon", coordinates: [ring] },
    valid_from_bf: null,
    valid_to_bf: null,
    min_zoom: null,
    max_zoom: null,
    updated_at: "2026-10-17 01:00:00",
});
/**
 * Reich › Grafschaft › Nord (4–6) und Süd (6–6, Lücke in 4 und 5); Fremdland (0–6) überlappt Nord; ein Platzhalter ohne Fläche;
 * Kaputtland mit einer Fläche, die nach dem Import ungültig wird. Legacys 6 wird beim Import 8.
 */
function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-pruefen",
        territories: [
            gebiet(REICH, "Reich", null, [0, 1], { capital_place_public_id: STADT, seat_place_public_id: GEIST }),
            gebiet(GRAF, "Grafschaft", REICH, [2, 3]),
            gebiet(NORD, "Baronie Nord", GRAF, [4, 6]),
            gebiet(SUED, "Baronie Süd", GRAF, [6, 6]),
            gebiet(FREMD, "Fremdland", null, [0, 6]),
            gebiet(PLATZ, "Neues Herrschaftsgebiet (3)", null, [0, 6]),
            gebiet(KAPUTT, "Kaputtland", null, [0, 6]),
        ],
        geometries: [
            flaeche(NORD_F, NORD, rechteck(300, 300, 420, 330)),
            flaeche(SUED_F, SUED, rechteck(300, 330, 420, 360)),
            flaeche(FREMD_F, FREMD, rechteck(400, 300, 450, 330)),
            flaeche(KAPUTT_F, KAPUTT, rechteck(600, 600, 660, 640)),
        ],
        claims: [],
    } as unknown as LegacyTerritoryPayload;
}

describeWithCluster("„Prüfen“: Befunde der Gebiete (WI-0209 D6, Wegwerf-Cluster)", { timeout: 240_000 }, () => {
    let cluster: VpsCluster | undefined;
    let importer: Database | undefined;
    const kurz = (befunde: readonly EditorTerritoryFinding[], art: EditorTerritoryFinding["kind"]) =>
        befunde
            .filter((b) => b.kind === art)
            .map((b) => Object.fromEntries(Object.entries(b).filter(([feld]) => feld !== "kind")));

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const o = cluster.migrator.options as unknown as {
            host: string[];
            port: number[];
            user: string;
            database: string;
        };
        importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, { max: 3 });
        await importTerritories(importer, quelle());
        await cluster.admin`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system)
            VALUES (${STADT}, 'aventuria', 'D6 Draußenstadt', 'stadt', ST_SetSRID(ST_MakePoint(250, 250), 0), 'test')
        `;
        // Eine Schleife: Die Fläche schneidet sich selbst (die Ableitung repariert sie beim Lesen).
        await cluster.admin`
            UPDATE territory_area
               SET geom = ST_Multi(ST_GeomFromText('POLYGON((600 600, 660 630, 660 600, 600 640, 600 600))', 0))
             WHERE public_id = ${KAPUTT_F}
        `;
        await deriveTerritories(cluster.jobs, { force: true });
    }, 240_000);

    afterAll(async () => {
        await importer?.end({ timeout: 5 });
        await cluster?.stop();
    }, 60_000);

    it("🔴 jeder Befund einmal: Lücke bis 8, Überlappung nur nicht verwandter, Platzhalter, ungültig, hängender Sitz, Hauptstadt außerhalb", async () => {
        const antwort = await readTerritoryFindings(cluster!.app);
        expect(Value.Check(EditorTerritoryFindings, antwort)).toBe(true);
        expect(antwort.derivedRevision).toMatch(/^[0-9a-f]{12}$/);
        const befunde = antwort.findings;
        // Nach einer frischen Ableitung zeigt sie, was die Regel zeigt.
        expect(kurz(befunde, "n2")).toEqual([]);
        // Süd beginnt erst bei 6: In 4 und 5 zeigt ihre Fläche nichts; darüber bis 8 zeigt sie sich (keine Klemme auf 6).
        expect(kurz(befunde, "luecke")).toEqual([{ territory: SUED, bands: [4, 5] }]);
        // Fremdland und Nord überlappen sich (20 × 30), beide tragen den Befund; Nord und ihre Grafschaft sind verwandt.
        expect(kurz(befunde, "ueberlappung")).toEqual([
            { territory: NORD, other: { id: FREMD, name: "Fremdland" }, size: 600 },
            { territory: FREMD, other: { id: NORD, name: "Baronie Nord" }, size: 600 },
        ]);
        expect(kurz(befunde, "platzhalter")).toEqual([{ territory: PLATZ }]);
        expect(kurz(befunde, "ungueltig")).toEqual([{ territory: KAPUTT, area: KAPUTT_F }]);
        expect(kurz(befunde, "verweis")).toEqual([{ territory: REICH, field: "seat", place: GEIST }]);
        expect(kurz(befunde, "hauptstadt")).toEqual([{ territory: REICH, place: STADT }]);
        expect(befunde).toHaveLength(7);
    });

    it("🔴 N2 meldet, wo Regel und Ableitung auseinanderliegen: Nord ab 5 statt 4, noch nicht abgeleitet", async () => {
        await cluster!.admin`UPDATE territory SET min_zoom = 5 WHERE public_id = ${NORD}`;
        try {
            const befunde = (await readTerritoryFindings(cluster!.app)).findings;
            expect(kurz(befunde, "n2")).toEqual([{ territory: NORD, area: NORD_F, bands: [4] }]);
            expect(kurz(befunde, "luecke")).toEqual([
                { territory: NORD, bands: [4] },
                { territory: SUED, bands: [4, 5] },
            ]);
        } finally {
            await cluster!.admin`UPDATE territory SET min_zoom = 4 WHERE public_id = ${NORD}`;
        }
    });

    it("eine Hauptstadt ohne Lage ist nicht hängend und nicht außerhalb", async () => {
        await cluster!.admin`DELETE FROM place WHERE public_id = ${STADT}`;
        await cluster!.admin`
            INSERT INTO place_unplaced (public_id, map_domain_id, name, subtype, source_system)
            VALUES (${STADT}, 'aventuria', 'D6 Draußenstadt', 'stadt', 'test')
        `;
        const befunde = (await readTerritoryFindings(cluster!.app)).findings;
        expect(kurz(befunde, "verweis")).toEqual([{ territory: REICH, field: "seat", place: GEIST }]);
        expect(kurz(befunde, "hauptstadt")).toEqual([]);
    });
});
