/**
 * Baut die SQLite-Datenbank, mit der Legacys eigener Routing-Code lokal rechnet (WI-0017).
 *
 * Aufruf: node scripts/dev/legacy-route-oracle/build-db.mjs [--snapshot <map-features.json>]
 *        [--areas <ecosystem-areas.json>] [--out <datei>] [--ground]
 *
 * Legacy liest seine Route aus `map_features` (MariaDB). Hier stehen dieselben Zeilen in SQLite,
 * gefüllt aus dem Snapshot der Kartennutzlast:
 *
 *   map_features  jede Zeile des Snapshots, ohne Stromleitungen; Reihenfolge = Snapshotreihenfolge
 *                 (Legacy sortiert nach sort_order, id - der Snapshot kennt sort_order nicht)
 *   map_revision  die Revision des Snapshots
 *   app_setting   `travel_values`: die LIVE-Tempotafel, die der Snapshot mitliefert
 *   ecosystem_region, ecosystem_area
 *                 die Landschaftsflaechen aus `ecosystem-areas.json`. Legacy liest daraus Meer und
 *                 See (`water-areas.php`, V13): eine Querfeldein-Bruecke darf kein offenes Wasser
 *                 queren. Ohne die Tabellen ist der Wassertest still aus, live ist er eingeschaltet.
 *
 *   ecosystem_region_type
 *                 nur mit `--ground`: das Tempo der Landschaften, wie Legacy es live trägt (WI-0030
 *                 R8): die GA-Tafel für Wald, Sümpfe, Dschungel, Wüste, Tundra und die Arten ohne
 *                 GA-Zeile aus 0,75 / `offroad_factor` (Schlucht, Flussdelta, Wadi, Auenlandschaft,
 *                 Hochebene; `travel-values-migration.php`). Gebirge kommt mit dem Höhenmodell. Legacy
 *                 rastert daraus seinen Boden (`offroad-data.php`, Faktor 0,75 / Tempo). Ohne die
 *                 Tabelle rechnet Legacy still ohne Boden, wie die Orakel vor R8. Urwald bremst in
 *                 Legacy nicht, bei uns wie Dschungel (Betreiber 2026-09-25): dort weicht es ab.
 *
 * 🪤 `terrain_travel_enabled` fehlt absichtlich: fehlt die Einstellung, ist Gelände AUS - genau
 * Legacys Vorgabe. Ob es live eingeschaltet ist, ist unbekannt (MCS-018).
 */
import { readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({
    options: {
        snapshot: { type: "string", default: "C:/avesmaps3d-data/legacy-snapshots/map-features.json" },
        areas: { type: "string", default: "C:/avesmaps3d-data/legacy-snapshots/ecosystem-areas.json" },
        out: { type: "string", default: "C:/avesmaps3d-data/work/legacy-route-oracle/oracle.sqlite" },
        ground: { type: "boolean", default: false },
    },
});
const snapshot = JSON.parse(readFileSync(values.snapshot, "utf8"));
rmSync(values.out, { force: true });
const database = new DatabaseSync(values.out);

database.exec(`
    CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL);
    CREATE TABLE map_features (
        id INTEGER PRIMARY KEY,
        public_id TEXT NOT NULL,
        feature_type TEXT NOT NULL,
        feature_subtype TEXT NOT NULL,
        name TEXT NOT NULL,
        geometry_type TEXT NOT NULL,
        geometry_json TEXT NOT NULL,
        properties_json TEXT NOT NULL,
        style_json TEXT,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        is_active INTEGER NOT NULL,
        sort_order INTEGER NOT NULL
    );
    CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
`);

database.prepare("INSERT INTO map_revision (id, revision) VALUES (1, ?)").run(snapshot.revision);
database
    .prepare("INSERT INTO app_setting (setting_key, setting_value) VALUES ('travel_values', ?)")
    .run(JSON.stringify({ grid: snapshot.travel_speeds, travel_hours: snapshot.travel_hours }));

const insert = database.prepare(`
    INSERT INTO map_features (id, public_id, feature_type, feature_subtype, name, geometry_type, geometry_json,
                              properties_json, style_json, revision, updated_at, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
`);
let rows = 0;
database.exec("BEGIN");
snapshot.features.forEach((feature, index) => {
    const properties = feature.properties ?? {};
    if (properties.feature_type === "powerline") return;
    rows += 1;
    insert.run(
        index + 1,
        String(feature.id),
        String(properties.feature_type ?? ""),
        String(properties.feature_subtype ?? ""),
        String(properties.name ?? ""),
        String(feature.geometry.type),
        JSON.stringify(feature.geometry),
        JSON.stringify(properties),
        properties.style ? JSON.stringify(properties.style) : null,
        Number(properties.revision ?? snapshot.revision),
        String(properties.updated_at ?? ""),
        index + 1,
    );
});
database.exec("COMMIT");

// Die Landschaftsflaechen, so wie Legacys Wasserleser sie abfragt (water-areas.php):
// `ecosystem_area a JOIN ecosystem_region r ... WHERE a.is_active AND r.region_type IN ('meer','see')`.
// Der Snapshot traegt nur aktive Flaechen; die Grenzen stehen in `bounds`.
const areaSnapshot = JSON.parse(readFileSync(values.areas, "utf8"));
database.exec(`
    CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, kind TEXT,
                                   region_type TEXT, is_active INTEGER NOT NULL);
    CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY, region_id INTEGER NOT NULL, geometry_geojson TEXT NOT NULL,
                                 min_x REAL NOT NULL, min_y REAL NOT NULL, max_x REAL NOT NULL, max_y REAL NOT NULL,
                                 is_active INTEGER NOT NULL);
`);
const regionIds = new Map();
const insertRegion = database.prepare(
    "INSERT INTO ecosystem_region (id, public_id, kind, region_type, is_active) VALUES (?, ?, ?, ?, 1)",
);
const insertArea = database.prepare(`
    INSERT INTO ecosystem_area (id, region_id, geometry_geojson, min_x, min_y, max_x, max_y, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
`);
database.exec("BEGIN");
areaSnapshot.areas.forEach((area, index) => {
    if (!regionIds.has(area.region_public_id)) {
        regionIds.set(area.region_public_id, regionIds.size + 1);
        insertRegion.run(regionIds.size, area.region_public_id, area.kind ?? null, area.region_type ?? null);
    }
    const { min_x, min_y, max_x, max_y } = area.bounds;
    insertArea.run(
        index + 1,
        regionIds.get(area.region_public_id),
        JSON.stringify(area.geometry),
        min_x,
        min_y,
        max_x,
        max_y,
    );
});
database.exec("COMMIT");
if (values.ground) {
    // GA S. 120-123 wie Legacys `avesmapsTravelValuesSourceTable()['landscapes']`, die übrigen wie seine
    // Migration: round(0,75 / offroad_factor, 3), mit der Saat aus `ecosystem.php`.
    database.exec(
        "CREATE TABLE ecosystem_region_type (kind TEXT NOT NULL, type_key TEXT NOT NULL, terrain_speed_factor REAL)",
    );
    const insertType = database.prepare(
        "INSERT INTO ecosystem_region_type (kind, type_key, terrain_speed_factor) VALUES (?, ?, ?)",
    );
    for (const [kind, type, speed] of [
        ["vegetation", "wald", 0.5],
        ["vegetation", "suempfe_moore", 0.1],
        ["vegetation", "dschungel", 0.2],
        ["vegetation", "wueste", 0.5],
        ["vegetation", "tundra", 0.7],
        ["vegetation", "auenlandschaft", 0.577],
        ["topographie", "schlucht", 0.288],
        ["topographie", "flussdelta", 0.375],
        ["topographie", "wadi", 0.5],
        ["topographie", "hochebene", 0.682],
    ]) {
        insertType.run(kind, type, speed);
    }
}
database.close();
console.log(
    `${values.out}: ${rows} Kartenobjekte, Revision ${snapshot.revision}; ${areaSnapshot.areas.length} Landschaftsflaechen`,
);
