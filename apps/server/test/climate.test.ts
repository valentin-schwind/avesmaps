import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFindings } from "../src/blocking-checks.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import {
    CLIMATE_ZONES,
    dividerSetFingerprint,
    importClimate,
    losslessFinding,
    readLegacyBands,
    reconstructDividers,
    verifyReconstruction,
    type LegacyBand,
} from "../src/migration/climate.ts";
import { verifyClimate } from "../src/migration/verify-climate.ts";

/**
 * Die Klimaableitung an einer Fixture, deren Bänder man von Hand kennt (WI-0005).
 *
 * Gebaut wird aus SIEBEN gedachten Trennlinien ein Satz von acht Bändern — und daraus versucht der
 * Code, die Linien zurückzugewinnen. Das ist genau der Weg der Migration, nur mit einer Vorlage,
 * deren Antwort feststeht: eine echte Karte würde jede Abweichung plausibel aussehen lassen.
 *
 * 🪤 Eine Linie der Fixture läuft ausdrücklich RÜCKWÄRTS. Ohne sie prüfte der Test nur den Fall,
 * den ohnehin jeder trifft — die Blasen sind der Grund, warum kein y(x)-Test verwendet werden darf,
 * und sie gehören deshalb in die Vorlage.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Sieben waagerechte Linien, eine davon mit einem Rückwärtsstück. */
function fixtureDividers(): { south: string; points: [number, number][] }[] {
    return CLIMATE_ZONES.slice(1).map((zone, index) => {
        const y = 900 - index * 100;
        if (zone === "trockene_subtropen") {
            // Eine Blase: x läuft zwischendurch zurück. Genau das, was Legacy für die Khôm erlaubt.
            return {
                south: zone,
                points: [
                    [0, y],
                    [400, y],
                    [500, y + 20],
                    [450, y + 40],
                    [520, y + 40],
                    [600, y],
                    [1024, y],
                ],
            };
        }
        return {
            south: zone,
            points: [
                [0, y],
                [512, y],
                [1024, y],
            ],
        };
    });
}

/** Baut aus den Linien die acht Bänder — so, wie Legacy sie gespeichert hätte. */
function fixtureBands(): LegacyBand[] {
    const dividers = fixtureDividers();
    const edge = (y: number): [number, number][] => [
        [0, y],
        [1024, y],
    ];
    return CLIMATE_ZONES.map((zone, index) => {
        const upper = index === 0 ? edge(1024) : (dividers[index - 1]?.points as [number, number][]);
        const lower = index === CLIMATE_ZONES.length - 1 ? edge(0) : (dividers[index]?.points as [number, number][]);
        const ring = [...upper, ...[...lower].reverse(), upper[0] as [number, number]];
        return {
            typeKey: zone,
            geoJson: JSON.stringify({ type: "Polygon", coordinates: [ring] }),
        };
    });
}

describe("Contract und Verifier", () => {
    /**
     * 💣 Der Contract und der Verifier müssen DIESELBEN Gates nennen, in derselben Reihenfolge.
     *
     * Genau hier ist es schon einmal auseinandergelaufen: der Contract listete fünfzehn Prüfungen,
     * der Verifier führte vierzehn aus, und zwei davon hießen verschieden. Eine Vertragsliste, die
     * mehr behauptet als der Code ausführt, ist schlimmer als keine — sie sieht nach Abdeckung aus
     * und hat sie nicht. Der Fehler fiel dem Betreiber auf, nicht dem Werkzeug; dieser Test ist die
     * Lehre daraus.
     */
    it("nennen dieselben Gates in derselben Reihenfolge", async () => {
        const contractPath = fileURLToPath(
            new URL("../../../project-control/migration/contracts/climate.yaml", import.meta.url),
        );
        const contract = await readFile(contractPath, "utf8");
        const verifier = await readFile(
            fileURLToPath(new URL("../src/migration/verify-climate.ts", import.meta.url)),
            "utf8",
        );

        // Aus dem YAML ohne Parser: jede Zeile "- check: <name>" unterhalb von `validation:`.
        const section = contract.slice(contract.indexOf("validation:"), contract.indexOf("run_gates:"));
        const declared = [...section.matchAll(/^\s*- check: ([a-z_]+)$/gm)].map((match) => match[1]);
        // Aus dem Code: jeder `check("<name>", ...)`, Mehrfachnennungen zusammengefasst - eine
        // Prüfung darf in zwei Zweigen stehen (gelaufen / übersprungen) und bleibt EIN Gate.
        const executed = [...new Set([...verifier.matchAll(/check\(\s*"([a-z_]+)"/g)].map((match) => match[1]))];

        expect(declared.length, "der Contract nennt Gates").toBeGreaterThan(0);
        expect(executed).toEqual(declared);
    });
});

/**
 * Orte, deren Zone man an der Fixture ablesen kann: die Linien liegen bei y = 900, 800, ... 300,
 * und x = 100 ist weit links von der Blase (die zwischen x 400 und 600 ausbeult).
 *
 * Der letzte Punkt liegt bewusst UNTER der Ausbuchtung: dort ist die Antwort eindeutig, und ein
 * y(x)-Test würde sie trotzdem falsch geben, weil die Linie an dieser Stelle drei Werte hat.
 */
function fixturePlaces(): { x: number; y: number; zone: string }[] {
    return [
        { x: 100, y: 950, zone: "polar" },
        { x: 100, y: 850, zone: "subpolar" },
        { x: 100, y: 750, zone: "boreal" },
        { x: 100, y: 650, zone: "gemaessigt" },
        { x: 100, y: 550, zone: "subtropen_winterfeucht" },
        { x: 100, y: 450, zone: "trockene_subtropen" },
        { x: 100, y: 350, zone: "subtropisch" },
        { x: 100, y: 150, zone: "tropisch" },
        { x: 480, y: 380, zone: "subtropisch" },
    ];
}

describe("Klimazonen, reine Funktionen", () => {
    it("liest nur die Klimaflächen aus einem Snapshot", () => {
        const bands = readLegacyBands({
            areas: [
                { kind: "vegetation", region_type: "wald", geometry: { type: "Polygon", coordinates: [] } },
                { kind: "klima", region_type: "polar", geometry: { type: "Polygon", coordinates: [] } },
            ],
        });
        expect(bands.map((band) => band.typeKey)).toEqual(["polar"]);
    });

    it("bindet den Fingerabdruck an den SATZ, nicht an eine Zeile", () => {
        const set = [
            { southTypeKey: "subpolar", wkt: "LINESTRING(0 900,1024 900)", pointCount: 2 },
            { southTypeKey: "boreal", wkt: "LINESTRING(0 800,1024 800)", pointCount: 2 },
        ];
        const moved = [
            set[0] as (typeof set)[0],
            { ...(set[1] as (typeof set)[0]), wkt: "LINESTRING(0 801,1024 801)" },
        ];
        // Eine einzige verschobene Linie entwertet den ganzen Satz - und muss es, weil die Bänder
        // ihrer Nachbarn sich mit ihr ändern.
        expect(dividerSetFingerprint(moved)).not.toEqual(dividerSetFingerprint(set));
        // Die Reihenfolge, in der die Linien ankommen, darf dagegen nichts ändern.
        expect(dividerSetFingerprint([...set].reverse())).toEqual(dividerSetFingerprint(set));
    });
});

describeWithDatabase("Klimazonen gegen PostGIS", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        // 🪤 Das Aufraeumen muss IN einer Transaktion laufen: `set_config(..., true)` setzt den Wert
        // nur fuer die laufende Transaktion, und ein einzelnes SELECT ist seine eigene. Ohne das
        // Beisammen scheitert schon das DELETE am Riegel - was beim ersten Lauf genau passiert ist
        // und zeigt, dass der Riegel auch hier greift.
        await database.begin(async (transaction) => {
            await transaction`SELECT set_config('climate.deriving', 'on', true)`;
            await transaction`DELETE FROM climate_band`;
            await transaction`DELETE FROM climate_divider`;
        });
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("gewinnt sieben Linien aus acht Bändern zurück, Blase eingeschlossen", async () => {
        const dividers = await reconstructDividers(database, fixtureBands());
        expect(dividers).toHaveLength(7);
        expect(dividers.map((divider) => divider.southTypeKey)).toEqual([...CLIMATE_ZONES].slice(1));

        // Jede Linie läuft von Rand zu Rand, nach dem Umdrehen vorwärts.
        for (const divider of dividers) {
            expect(divider.wkt.startsWith("LINESTRING(0 ")).toBe(true);
            expect(divider.wkt).toMatch(/1024 [\d.]+\)$/);
        }
    });

    it("beweist die Verlustfreiheit über die Eckenarithmetik", async () => {
        const bands = fixtureBands();
        const dividers = await reconstructDividers(database, bands);
        const result = await verifyReconstruction(database, bands, dividers);
        expect(result.offenders ?? []).toEqual([]);
        expect(result.passed).toBe(true);
    });

    it("erfüllt alle Gates und ist beim zweiten Lauf unverändert", async () => {
        const bands = fixtureBands();
        const first = await importClimate(database, bands);
        expect(first.dividers).toBe(7);
        expect(first.written).toBe(true);

        const second = await importClimate(database, bands);
        expect(second.written, "ein zweiter Lauf schreibt nichts").toBe(false);
        expect(second.fingerprint).toEqual(first.fingerprint);

        const report = await verifyClimate(database, bands, fixturePlaces());
        // 🪤 Punktzahl und Blasenzahl sind auf den ECHTEN Bestand geeicht, nicht auf diese Fixture -
        // sie müssen hier abweichen. Alles andere sind Aussagen über den Satz und muss auch hier
        // gelten, `zugehoerigkeit_ort` eingeschlossen.
        const fixtureBound = ["punktzahl_je_linie", "blasen_erhalten"];
        const failed = report.checks
            .filter((entry) => !entry.passed && !fixtureBound.includes(entry.name))
            .map((entry) => `${entry.name}: ${entry.detail}`);
        expect(failed).toEqual([]);

        // 🔴 Betreiber 2026-10-03 („B“): Die zwei fixturegebundenen Prüfungen fallen aus, halten den Lauf aber nicht an -
        // sie stehen als Befund mit Zahlen da, das Urteil bleibt grün.
        const bound = report.checks.filter((entry) => fixtureBound.includes(entry.name));
        expect(bound.map((entry) => entry.passed)).toEqual([false, false]);
        expect(bound.every((entry) => entry.blocking === false)).toBe(true);
        expect(report.passed).toBe(true);
        const befunde = checkFindings("verify:climate", report.checks, (entry) => entry.passed);
        expect(befunde.map((befund) => befund.code)).toEqual([
            "verify:climate/punktzahl_je_linie",
            "verify:climate/blasen_erhalten",
        ]);
    });

    it("🔴 verliert die Rekonstruktion einen Punkt, ist das ein Befund mit Zone und Zahlen, und der Import läuft trotzdem (Betreiber „B“)", async () => {
        const bands = fixtureBands();
        const polar = bands.find((band) => band.typeKey === "polar") as LegacyBand;
        const ring = (JSON.parse(polar.geoJson) as { coordinates: number[][][] }).coordinates[0] as number[][];
        // Ein zusätzlicher Stützpunkt auf der Nordkante: Bandecken = Oberkante + Unterkante + 1 geht für dieses Band nicht auf.
        ring.splice(1, 0, [512, 1024]);
        polar.geoJson = JSON.stringify({ type: "Polygon", coordinates: [ring] });

        const dividers = await reconstructDividers(database, bands);
        const result = await verifyReconstruction(database, bands, dividers);
        expect(result.passed).toBe(false);

        const finding = losslessFinding(result);
        expect(finding?.code).toBe("migrate:climate/rekonstruktion_verlustfrei");
        expect(finding?.numbers).toEqual({ baender: 1 });
        expect(finding?.objects).toEqual([{ table: "climate_band", publicId: "polar", name: "polar" }]);
        expect(finding?.notes).toEqual(["polar: 7 statt 6 (2 + 3 + 1)"]);
        expect(finding?.message).toContain("der Lauf geht weiter");

        // Kein Stopp: Der Import schreibt, wie der Lauf es nach dem Befund tut.
        const imported = await importClimate(database, bands);
        expect(imported.dividers).toBe(7);
        expect(losslessFinding({ ...result, passed: true })).toBeUndefined();
    });

    /**
     * 🔴 Jeder Klimaname hat eine Kachel, die ihn zeichnet (Befund 2026-09-23, Migration 0034).
     *
     * 💣 MapLibre verwirft Symbolanker außerhalb von [0, extent) und überlässt sie der Nachbarkachel.
     * Der Ostanker lag auf x = 1024, also auf dem Ostrand der Welt und damit in der Kachel auf
     * x = extent — östlich davon gibt es keine Kachel. Die Quelle lieferte alle 16 Punkte, gezeichnet
     * wurden die 8 im Westen.
     *
     * Gemessen wird mit Martins eigener Umrechnung (`ST_AsMVTGeom`, extent 4096, buffer 64) auf jeder
     * Quellstufe, in der Kachel, in die der Punkt fällt.
     */
    it("🔴 legt jeden Namensanker auf jeder Quellstufe INNERHALB seiner Kachel ab", async () => {
        await importClimate(database, fixtureBands());
        const lage = await database<{ seite: string; z: number; x: number; y: number }[]>`
            WITH welt AS (SELECT ST_XMax(ST_TileEnvelope(0, 0, 0)) AS w)
            SELECT r.seite, s.z, ST_X(m.geom) AS x, ST_Y(m.geom) AS y
            FROM climate_label_render r
            CROSS JOIN welt
            CROSS JOIN generate_series(0, 8) AS s(z)
            CROSS JOIN LATERAL (
                SELECT ST_AsMVTGeom(
                           r.geom,
                           ST_TileEnvelope(
                               s.z,
                               LEAST(floor((ST_X(r.geom) + welt.w) / (2 * welt.w) * 2 ^ s.z), 2 ^ s.z - 1)::int,
                               LEAST(floor((welt.w - ST_Y(r.geom)) / (2 * welt.w) * 2 ^ s.z), 2 ^ s.z - 1)::int
                           ),
                           4096, 64, true
                       ) AS geom
            ) m
            ORDER BY r.seite, r.type_key, s.z
        `;

        // Gegenprobe: beide Kanten auf allen neun Stufen — acht Bänder, jedes an beiden Rändern hoch genug.
        expect(lage.length, "16 Anker × 9 Stufen").toBe(16 * 9);
        expect(new Set(lage.map((punkt) => punkt.seite))).toEqual(new Set(["west", "ost"]));

        const ausserhalb = lage
            .filter((punkt) => !(punkt.x >= 0 && punkt.x < 4096 && punkt.y >= 0 && punkt.y < 4096))
            .map((punkt) => `${punkt.seite} z${punkt.z}: x=${punkt.x} y=${punkt.y}`);
        expect(ausserhalb, "Anker, die MapLibre verwirft").toEqual([]);
    });

    it("verriegelt die Bänder gegen direkte Mutation", async () => {
        await expect(database`UPDATE climate_band SET derived_at = now() WHERE type_key = 'polar'`).rejects.toThrow(
            /derived from climate_divider/,
        );
    });
});
