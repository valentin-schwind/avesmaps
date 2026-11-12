import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    DATA_PART_INPUTS,
    MAP_SEGMENT_INPUTS,
    MAP_SEGMENTS,
    ROUTING_DATA_PARTS,
    type RoutingRevisionPart,
} from "../src/routing/revision.ts";

/**
 * M6 (Architecture Hardening Review 2026-09-28): `readRoutingRevision()` (`revision.ts`, die Abfrage hinter
 * `RoutingSource.revision()`) muss jede Tabelle kennen, die einer der Loader liest, die `load()`/`loadSea()`
 * aufrufen — sonst rechnet der Worker nach einer Änderung an genau dieser Tabelle bis zum Neustart
 * mit dem alten Stand (so geschehen mit `terrain_raster`, `terrain_peak`, `terrain_control`). Teil 1 des
 * Auftrags hat diese Lücke geschlossen; seit der Naht (`RoutingDataRevision`) hat die Abfrage je Teil eine Spalte.
 *
 * **Methode:** rein textuell über die SQL-Strings, wie im Befund vorgeschlagen, aber gezielt auf die
 * Loader-FUNKTIONEN beschränkt, die `databaseRoutingSource()` tatsächlich aufruft — nicht auf die
 * ganzen Dateien. `network.ts`, `sea-derive.ts` & Co. exportieren daneben CLI- und Verifier-Code mit
 * eigenen SQL-Strings (Paritätswerkzeuge, Fingerabdruck der Seewege), die nicht Teil des geladenen
 * `Loaded`-Stands sind und deshalb auch nicht in DIESER Revision stehen müssen. Innerhalb einer
 * Loader-Funktion werden `WITH x AS (…)`-Zwischenergebnisse (CTEs) von echten Tabellen unterschieden
 * (`ground.ts` liest `region_area`/`region` über die CTE `flaeche` — `flaeche` ist keine Tabelle).
 *
 * Damit prüft der Test automatisch: Ändert ein Loader künftig eine neue Tabelle, ohne dass jemand
 * den Fingerabdruck nachzieht, fällt der Test — ohne dass die Liste der Tabellen hier von Hand
 * gepflegt werden müsste.
 */

const SRC = resolve(import.meta.dirname, "..", "src");

/**
 * Die Loader, die `databaseRoutingSource().load()` bzw. `.loadSea()` tatsächlich aufrufen. `part` ist der
 * Bestandteil des Datenstands (`DATA_PART_INPUTS`); der Seegraph kommt lazy und hängt an seinem Revisionsteil.
 */
const LOADERS = [
    { file: "routing/network.ts", fn: "loadRouteNetwork", part: "network" },
    { file: "routing/water.ts", fn: "loadWater", part: "water" },
    { file: "routing/land.ts", fn: "loadLand", part: "land" },
    { file: "routing/rivers.ts", fn: "loadRivers", part: "rivers" },
    { file: "routing/ground.ts", fn: "loadGround", part: "ground" },
    { file: "routing/climate.ts", fn: "loadClimate", part: "climate" },
    { file: "routing/terrain-load.ts", fn: "loadDomainHeightSource", part: "heights" },
    { file: "routing/toll-territories.ts", fn: "loadTollTerritories", part: "territories" },
    { file: "routing/sea-derive.ts", fn: "loadSeaRoutes", part: null },
] as const;

/** Welche Tabellen zu welchem Teil der Revision gehören: die Abfrage in `readRoutingRevision` muss es genau so tun. */
const PART_TABLES: Record<RoutingRevisionPart, string[]> = {
    // Seit WI-0132 Release N liest das Netz keine Kreuzungen mehr; `crossing` steht deshalb nicht mehr in der Revision.
    map: ["path", "place", "region", "region_area"],
    travelModel: [],
    terrain: ["region", "region_area", "terrain_dem", "terrain_domain_raster"],
    pathProfiles: ["terrain_path_profile"],
    seaGraph: ["sea_route_graph"],
    climate: ["climate_band"],
    territories: ["territory", "territory_shape", "territory_state"],
    // Die FREIGEGEBENEN Kenngrößen (WI-0153 Schnitt 6): eine eigene Anweisung, weil die Tafel vor 0135 fehlen kann.
    settings: ["routing_setting_applied"],
    // Die GESPEICHERTEN Kenngrößen, die ohne Knopf gelten (Schnitt 6): eigene Anweisung aus demselben Grund.
    settingsLive: ["routing_setting"],
};

/** Die SQL-Spalte, in der `readRoutingRevision` den Teil abfragt. */
const PART_COLUMNS: Partial<Record<RoutingRevisionPart, string>> = {
    map: "map",
    terrain: "terrain",
    pathProfiles: "path_profiles",
    seaGraph: "sea_graph",
    climate: "climate",
    territories: "territories",
    settings: "settings",
    settingsLive: "settings_live",
};

/** Grenzt den Quelltext einer exportierten Funktion ein: vom Signaturkopf bis zum nächsten `export ` in Spalte 0. */
function functionBody(source: string, fnName: string): string {
    const start = source.search(new RegExp(`export\\s+(async\\s+)?function\\s+${fnName}\\b`));
    if (start < 0) throw new Error(`Funktion ${fnName} nicht gefunden`);
    const rest = source.slice(start + 1);
    const nextExport = rest.search(/\nexport\s/);
    return nextExport < 0 ? rest : rest.slice(0, nextExport);
}

/** Echte Tabellennamen einer Loader-Funktion: alle `FROM`/`JOIN`-Ziele abzüglich ihrer eigenen CTE-Namen. */
function tablesReadBy(body: string): Set<string> {
    const cteNames = new Set([...body.matchAll(/\bWITH\s+([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)].map((m) => m[1] as string));
    const tables = new Set<string>();
    for (const match of body.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)) {
        const name = match[1] as string;
        if (!cteNames.has(name)) tables.add(name);
    }
    return tables;
}

/** Die Tabellen, die `readRoutingRevision` (`revision.ts`) abfragt: eine SQL-Anweisung, je Teil eine Spalte. */
function fingerprintTables(): Set<string> {
    const revisionSource = readFileSync(resolve(SRC, "routing", "revision.ts"), "utf8");
    return tablesReadBy(functionBody(revisionSource, "readRoutingRevision"));
}

describe("Fingerabdruck der Routing-Quelle deckt jede Loader-Tabelle ab (M6 Teil 1)", () => {
    const tracked = fingerprintTables();

    it.each(LOADERS)("$file:$fn", ({ file, fn }) => {
        const source = readFileSync(resolve(SRC, file), "utf8");
        const tables = tablesReadBy(functionBody(source, fn));
        expect(tables.size).toBeGreaterThan(0);
        for (const table of tables) {
            expect(
                tracked.has(table),
                `Tabelle "${table}" aus ${file}:${fn} fehlt in der Routing-Revision (revision.ts:readRoutingRevision)`,
            ).toBe(true);
        }
    });

    it("🔴 jeder Teil der Revision fragt genau die Tabellen, die ihm die Tafel zuschreibt", () => {
        const revisionSource = readFileSync(resolve(SRC, "routing", "revision.ts"), "utf8");
        const sql = functionBody(revisionSource, "readRoutingRevision");
        // Die Spalten stehen in fester Reihenfolge; der Text vor `AS <spalte>` gehört zu ihr.
        const columns = Object.values(PART_COLUMNS);
        let from = sql.indexOf("SELECT");
        for (const column of columns) {
            const end = sql.indexOf(`AS ${column as string}`, from);
            expect(end, `Spalte ${column as string} nicht gefunden`).toBeGreaterThan(from);
            const part = (Object.keys(PART_COLUMNS) as RoutingRevisionPart[]).find(
                (key) => PART_COLUMNS[key] === column,
            );
            expect([...tablesReadBy(sql.slice(from, end))].sort(), `Teil ${String(part)}`).toEqual(
                PART_TABLES[part as RoutingRevisionPart],
            );
            from = end;
        }
    });

    it.each(LOADERS)(
        "🔴 $fn liest nur Tabellen aus den Revisionsteilen, von denen sein Bestandteil abhängt",
        ({ file, fn, part }) => {
            const source = readFileSync(resolve(SRC, file), "utf8");
            const tables = tablesReadBy(functionBody(source, fn));
            // Der Seegraph hängt an `seaGraph`; alle anderen laut `DATA_PART_INPUTS`.
            const inputs: readonly RoutingRevisionPart[] = part === null ? ["seaGraph"] : DATA_PART_INPUTS[part];
            const covered = new Set(inputs.flatMap((input) => PART_TABLES[input]));
            for (const table of tables) {
                expect(
                    covered.has(table),
                    `${fn} liest "${table}", aber ${part ?? "seaGraph"} hängt laut DATA_PART_INPUTS nicht von einem Teil ab, der sie abfragt (${inputs.join(", ")})`,
                ).toBe(true);
            }
        },
    );

    it("🔴 der Teil `map` fragt seine Tabellen in der Reihenfolge von MAP_SEGMENTS (WI-0298: `staleDataParts` vergleicht die Abschnitte)", () => {
        const revisionSource = readFileSync(resolve(SRC, "routing", "revision.ts"), "utf8");
        const sql = functionBody(revisionSource, "readRoutingRevision");
        const start = sql.indexOf("SELECT");
        const end = sql.indexOf("AS map", start);
        expect([...tablesReadBy(sql.slice(start, end))]).toEqual([...MAP_SEGMENTS]);
    });

    it("🔴 jeder Bestandteil, der an `map` hängt, nennt seine Abschnitte, und nur Abschnitte von `map`", () => {
        for (const part of ROUTING_DATA_PARTS) {
            const segments = MAP_SEGMENT_INPUTS[part];
            expect(segments !== undefined, part).toBe(DATA_PART_INPUTS[part].includes("map"));
            for (const segment of segments ?? []) expect(PART_TABLES.map).toContain(segment);
        }
    });

    it.each(LOADERS.filter((loader) => loader.part !== null && DATA_PART_INPUTS[loader.part].includes("map")))(
        "🔴 $fn liest aus `map` nur die Tabellen seiner Abschnitte (WI-0298)",
        ({ file, fn, part }) => {
            const source = readFileSync(resolve(SRC, file), "utf8");
            const tables = [...tablesReadBy(functionBody(source, fn))].filter((table) =>
                PART_TABLES.map.includes(table),
            );
            const segments: readonly string[] = MAP_SEGMENT_INPUTS[part as keyof typeof MAP_SEGMENT_INPUTS] ?? [];
            for (const table of tables) {
                expect(
                    segments.includes(table),
                    `${fn} liest "${table}", aber MAP_SEGMENT_INPUTS.${String(part)} nennt nur ${segments.join(", ")}`,
                ).toBe(true);
            }
        },
    );

    it("die Revision liest kein Höhenmodell der Kacheln und keine Darstellungsprodukte (ADR-0011, Kap. 5.32a)", () => {
        // ADR-0015 erlaubt den Veröffentlichungszeiger aus terrain_dem, weiterhin keine DEM-Kacheln.
        // Die Isolation prüft compute-height-isolation.test.ts über den gesamten Rechenpfad.
        for (const table of tracked) {
            expect(table, `${table} gehört nicht in die Revision der Rechengrundlage`).not.toMatch(
                /^terrain_(dem_tile|visual|display|contour|height_band|water)/,
            );
        }
    });
});
