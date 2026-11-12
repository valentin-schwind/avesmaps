import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESIGN_CANON } from "@avesmaps3d/shared";
import { contourSet, displayHeightRevision } from "../src/terrain/display-height/bands.ts";
import { contourLevel, CONTOUR_OPTIONS, WATER_SMOOTHING } from "../src/terrain/display-height/contours.ts";
import { MOUNTAIN } from "../src/terrain/visual-relief/grid.ts";

describe("Höhenlinien", () => {
    /** Ein runder Hügel von 0 bis 1.250 Schritt, 64², ohne Gebirge. */
    const n = 64;
    const hill = Float32Array.from({ length: n * n }, (_, k) => {
        const x = k % n;
        const y = (k - x) / n;
        return Math.max(0, 1250 * (1 - Math.hypot(x - 31.5, y - 31.5) / 30));
    });

    const lines = (classes: Uint8Array, minRing = 0) =>
        contourSet(hill, classes, n, { ...CONTOUR_OPTIONS, minRing }).lines;

    it("zieht je Hunderter einen geschlossenen Ring und stuft 1.000 dick, 500 dünn, Rest fein", () => {
        const all = lines(new Uint8Array(n * n));
        expect(all.map((line) => line.ele)).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]);
        expect(all.every((line) => line.closed)).toBe(true);
        expect(all.map((line) => line.level)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0]);
        expect([contourLevel(3000), contourLevel(2500), contourLevel(2300)]).toEqual([2, 1, 0]);
    });

    it("🔴 im Gebirge sind die Hunderter Detail (erst aus der Nähe), die Fünfhunderter nie", () => {
        const gebirge = lines(new Uint8Array(n * n).fill(MOUNTAIN));
        expect(gebirge.filter((line) => line.detail !== true).map((line) => line.ele)).toEqual([500, 1000]);
        expect(gebirge.filter((line) => line.detail === true).every((line) => line.level === 0)).toBe(true);
    });

    it("🔴 eine Linie über die Gebirgsgrenze endet nicht: ihre Stücke schließen lückenlos aneinander", () => {
        // Regression (Betreiber 2026-09-28: „manchmal enden so höhenlinien“): Die östliche Hälfte ist Gebirge.
        // Vorher hörten die Hunderter dort auf; jetzt geht es als Detailstück weiter, am selben Punkt.
        const classes = Uint8Array.from({ length: n * n }, (_, k) => (k % n >= 32 ? MOUNTAIN : 0));
        const dreihundert = lines(classes).filter((line) => line.ele === 300);
        expect(dreihundert.map((line) => line.detail === true).sort()).toEqual([false, true]);
        const [flach, berg] = [dreihundert.find((l) => l.detail !== true), dreihundert.find((l) => l.detail === true)];
        const ends = (line: typeof flach) => {
            const c = line?.coords ?? new Float64Array();
            return [`${String(c[0])},${String(c[1])}`, `${String(c.at(-2))},${String(c.at(-1))}`].sort();
        };
        // Zwei Stücke eines Rings: Beide teilen ihre beiden Wechselpunkte.
        expect(ends(flach)).toEqual(ends(berg));
    });

    it("lässt Ringe unter der Mindestlänge weg", () => {
        // Eine Zelle sind 16 E. Der 1.000er-Ring hat 6 Zellen Radius (rund 600 E Umfang), der 1.100er 3,6 (360 E).
        expect(lines(new Uint8Array(n * n), 400).map((line) => line.ele)).toEqual([
            100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
        ]);
    });
});

describe("Höhenstufen", () => {
    const n = 64;
    const none = new Uint8Array(n * n);
    const hill = Float32Array.from({ length: n * n }, (_, k) => {
        const x = k % n;
        const y = (k - x) / n;
        return Math.max(0, 1250 * (1 - Math.hypot(x - 31.5, y - 31.5) / 30));
    });

    it("🔴 der Rand einer Stufe ist genau ihre Höhenlinie (keine „ungenauen farbumfüllungen“)", () => {
        const set = contourSet(hill, none, n);
        expect(set.bands.map((band) => band.threshold)).toEqual([...DESIGN_CANON.topography.heightSteps]);
        // Stufe 0 ist die ganze Karte; der Hügel reicht bis 1.250, darüber keine Ringe.
        expect(set.bands.map((band) => band.rings.length)).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
        const greenBoundary = set.bands.find((band) => band.threshold === 200)?.rings[0];
        const line = set.lines.find((line) => line.ele === 200);
        expect(greenBoundary).toBeDefined();
        expect(greenBoundary?.coords).toEqual(line?.coords);
    });

    it("schließt Ringe am Kartenrand: Ein Hang, der über den Rand läuft, gibt trotzdem eine Fläche", () => {
        // Von West nach Ost 0 bis 1.260 Schritt: Jede Linie läuft von Rand zu Rand.
        const ramp = Float32Array.from({ length: n * n }, (_, k) => (k % n) * 20);
        const set = contourSet(ramp, none, n);
        expect(set.lines.length).toBeGreaterThan(0);
        expect(set.lines.every((line) => line.closed)).toBe(true);
        for (const band of set.bands.filter((b) => b.threshold > 0 && b.threshold < 1260)) {
            expect(band.rings).toHaveLength(1);
            const c = band.rings[0]?.coords ?? new Float64Array();
            expect([c[0], c[1]]).toEqual([c.at(-2), c.at(-1)]);
        }
    });

    it("gleiches Feld, gleiche Revision; ein anderes Feld, eine andere", () => {
        const a = displayHeightRevision(contourSet(hill, none, n));
        expect(a).toMatch(/^[0-9a-f]{12}$/);
        expect(displayHeightRevision(contourSet(hill, none, n))).toBe(a);
        const higher = hill.map((h) => h * 1.1);
        expect(displayHeightRevision(contourSet(higher, none, n))).not.toBe(a);
    });
});

describe("Isolation", () => {
    // 🔴 Nur Anzeige (Betreiber 2026-09-28: Reisezeiten unberührt): Wer rechnet, darf die Anzeigehöhen
    // nicht lesen. Routing, Wegprofile, Steigung, Querfeldein, Flug und das Gelände kennen sie nicht.
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

    it("wird außerhalb ihres Ordners nur von Ableitung, Prüfer und Zeigerroute genannt", () => {
        const readers = files(root)
            .filter((file) => !file.includes(join("terrain", "display-height")))
            .filter((file) =>
                /display-height|terrain_display_height|terrain_contour|terrain_height_band/.test(
                    readFileSync(file, "utf8"),
                ),
            )
            .map((file) => file.slice(root.length + 1));
        expect(readers.sort()).toEqual(
            [
                join("derive", "display-height-cli.ts"),
                join("derive", "verify-display-height-cli.ts"),
                join("routes", "display-height.ts"),
                // Die Statusseite (Betrieb) liest nur den Zustand des Zeigers, sie rechnet nichts (WI-0074).
                join("jobs", "operations.ts"),
                // Der Job `display_heights` (WI-0125) ist die Ableitung als Job: er ruft dieselbe Funktion wie die CLI.
                join("jobs", "terrain-chain-jobs.ts"),
                // I13 (M5): die Schritt-Tabelle nennt die CLI, legacy:update ruft Ableitung und Prüfer.
                join("migration", "pipeline-steps.ts"),
                join("migration", "legacy-update-cli.ts"),
                "app.ts",
            ].sort(),
        );
    });
});

describe("Ufer", () => {
    it("die Glättung der Sicht ist die, mit der die Linien abgeschnitten und die Revision gerechnet werden", () => {
        const migration = readFileSync(
            join(import.meta.dirname, "..", "migrations", "0053_terrain_display_height.sql"),
            "utf8",
        );
        expect(migration).toContain(`ST_ChaikinSmoothing(geom, ${String(WATER_SMOOTHING)})`);
    });
});

describe("Kacheln je Zoom", () => {
    it("🔴 die Linienkachel liefert ab genau dem Zoom eine Stufe, ab dem die Karte sie zeichnet (Designkanon)", () => {
        // Die Schwellen stehen in SQL (`terrain_contour_tile`) und im Kanon (`topography.contour.minZoom`). Liefert
        // die Kachel eine Stufe später, fehlen Linien; früher, trägt die Übersicht wieder alle Linien (190 statt 8 KB).
        const migration = readFileSync(
            join(import.meta.dirname, "..", "migrations", "0053_terrain_display_height.sql"),
            "utf8",
        );
        const [fein, mittel] = DESIGN_CANON.topography.contour.minZoom.map(Math.floor);
        expect(migration).toContain(
            `niedrigste smallint := CASE WHEN z < ${String(mittel)} THEN 2 WHEN z < ${String(fein)} THEN 1 ELSE 0 END;`,
        );
        // Die Gebirgslinien fragt die Karte erst ab `detailMinZoom` ab; darunter trüge die Kachel nur Gewicht.
        expect(DESIGN_CANON.topography.contour.detailMinZoom).toBeGreaterThanOrEqual(fein ?? 0);
    });
});
