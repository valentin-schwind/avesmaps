import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL as model, countBorderCrossings, type BorderSegment } from "../src/index.ts";
import {
    LEGACY_BLOB,
    LEGACY_FIRST_LINE,
    LEGACY_LAST_LINE,
    LEGACY_MIRROR as MIRROR,
    borderCode,
    loadLegacyBorders,
    readPinnedLegacySource,
} from "../../../scripts/dev/legacy-route-costs.ts";
import {
    FUZZ_SCENE,
    LEGACY_CASES,
    MILES_PER_UNIT,
    fuzzLines,
    legacyFeature,
    prepared,
    reversed,
    type SceneTerritory,
} from "./support/border-scenes.ts";

/**
 * Der Paritätsbeweis der Grenzzählung (WI-0065 U1): Legacys ORIGINALFUNKTION läuft unverändert in einem leeren
 * `vm`-Kontext, mit denselben Gebieten und Linien wie unsere Rechnung, und beide müssen dasselbe zählen. Unsere
 * Zählung ist ein 1:1-Port; jede Abweichung ist ein Fehler im Port.
 *
 * 🔴 Gelesen wird ausschließlich der Discovery-Mirror `C:\GIT\.discovery\avesmaps.git`, nie das lokale
 * Legacy-Repository. Ohne Mirror (CI, ein anderer Rechner) sind die Tests SICHTBAR übersprungen, nicht grün.
 * Pfad überschreibbar mit `AVESMAPS_LEGACY_MIRROR`.
 *
 * Die Datei wird nicht abgeschrieben, sondern ausgeführt (`scripts/dev/legacy-route-costs.ts`, dasselbe Muster wie
 * `scripts/dev/extract-legacy-display-defaults.ts`): Zeile 16 bis 230 von `js/routing/route-costs.js` (die
 * Konstanten, `avesmapsTravelCostPrepareTerritory`, der Punkttest und `avesmapsCountRouteStateBorders`), festgehalten als
 * Git-Blob, damit der Stand unveränderlich ist. Sie haben kein `require`, kein `process` und kein Netz; der Rest der
 * Datei (Kostenzeilen) wird nicht geladen. Derselbe Lader trägt den Oracle-Test gegen zwei Implementierungen
 * (`apps/server/test/toll-borders-oracle.test.ts`).
 */

const source = readPinnedLegacySource();
const legacy = source === null ? null : loadLegacyBorders(source, MILES_PER_UNIT);

const rule = model.reisekosten.grenzuebertritt.wert;

/** Was Legacy zählt: dieselben Gebiete als GeoJSON-Features, dieselben Segmente. */
function legacyCount(scene: readonly SceneTerritory[], segments: readonly BorderSegment[]): number | null {
    if (legacy === null) throw new Error("Legacy nicht geladen");
    const territories = scene.map((entry) => legacy.prepare(legacyFeature(entry))).filter(Boolean);
    return legacy.count(segments, territories);
}

const ourCount = (scene: readonly SceneTerritory[], segments: readonly BorderSegment[]): number | null =>
    countBorderCrossings(segments, prepared([...scene]), MILES_PER_UNIT, rule)?.count ?? null;

describe.skipIf(legacy === null)(
    legacy === null
        ? `Paritätstest gegen Legacys Originalfunktion - ÜBERSPRUNGEN: Discovery-Mirror ${MIRROR} nicht lesbar`
        : "Paritätstest gegen Legacys Originalfunktion (Discovery-Mirror)",
    () => {
        it(`die Anker des Laders finden im festgehaltenen Blob genau Zeile ${String(LEGACY_FIRST_LINE)} bis ${String(LEGACY_LAST_LINE)}`, () => {
            const lines = (source ?? "").split(/\r?\n/);
            expect(borderCode(source ?? "")).toBe(lines.slice(LEGACY_FIRST_LINE - 1, LEGACY_LAST_LINE).join("\n"));
            expect(LEGACY_BLOB).toMatch(/^[0-9a-f]{40}$/);
        });

        it("Legacys Konstanten sind die Werte des Reisemodells (5 Meilen, 0,4 Einheiten)", () => {
            expect(legacy?.minRunMiles).toBe(rule.mindestLaufMeilen);
            expect(legacy?.sampleStep).toBe(rule.abtastschritt);
        });

        it.each(LEGACY_CASES)("Fall „$name“: Legacy und unsere Zählung liefern das Ergebnis der Tabelle", (entry) => {
            expect(legacyCount(entry.scene, entry.segments)).toBe(entry.expected);
            expect(ourCount(entry.scene, entry.segments)).toBe(entry.expected);
        });

        // 🪤 Eigene Zeitgrenze, weil dieser Fall KEINE Leistungsaussage ist, sondern ein Paritätsbeweis: die
        // 5.000 ms der Voreinstellung sind hier nur ein Rahmen, und der war zu knapp (WI-0100). Ruhig gemessen
        // am 2026-10-07 (Ryzen 9 5900X, 5 Läufe): Median 2.022 ms, Spanne 1.984 bis 2.156 ms. Davon sind
        // 2.344 von 2.470 ms Legacys eigene Funktion, unser Port braucht 126 ms. Die Zeit ist also nicht zu
        // drücken, ohne den Beweis zu verkleinern. Bei gesättigter CPU gemessen: 8.417 ms; auf dem
        // Entwicklungsrechner unter Browsertest-Last 11.653 ms. 60 s lassen über das Fünffache des
        // schlechtesten gemessenen Wertes Luft, und ein echter Hänger endet weiterhin.
        it(
            "500 zufällige Linien über eine Szene mit Überlappung, Loch, Teilen und Namensdoppel: hin und zurück dieselbe Zahl wie Legacy",
            { timeout: 60_000 },
            () => {
                const results = new Set<number | null>();
                let asymmetric = 0;
                for (const [index, segments] of fuzzLines(500, 65).entries()) {
                    const there = ourCount(FUZZ_SCENE, segments);
                    const back = ourCount(FUZZ_SCENE, reversed(segments));
                    expect(there, `Linie ${String(index)} hin`).toBe(legacyCount(FUZZ_SCENE, segments));
                    expect(back, `Linie ${String(index)} zurück`).toBe(legacyCount(FUZZ_SCENE, reversed(segments)));
                    results.add(there);
                    if (there !== back) asymmetric += 1;
                }
                // Der Beweis ist nur etwas wert, wenn die Linien etwas zählen: mehrere verschiedene Ergebnisse, auch
                // größere Zahlen, und solche, die die Legacy-Asymmetrie treffen (kurzer erster oder letzter Lauf).
                const counts = [...results].filter((value): value is number => value !== null);
                expect(counts.length).toBeGreaterThanOrEqual(5);
                expect(Math.max(...counts)).toBeGreaterThanOrEqual(4);
                expect(asymmetric).toBeGreaterThan(0);
            },
        );
    },
);
