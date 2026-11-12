import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL as model,
    countBorderCrossings,
    prepareBorderTerritory,
    shortNameOf,
    territoryAtPoint,
    type BorderRule,
    type BorderSegment,
    type BorderTerritory,
} from "../src/index.ts";
import {
    FUZZ_SCENE,
    MILES_PER_UNIT,
    WEST_OST,
    box,
    line,
    mulberry32,
    prepared,
    squareTerritory,
    withTerritoryWideBoxes,
    type SceneTerritory,
} from "./support/border-scenes.ts";

/**
 * Die Landesgrenzen einer Reise (WI-0065 U1). Die Zielwerte der ersten Gruppe sind die Legacys: die ersten fünf
 * Fälle sind seine eigenen Tests (`travel-costs.test.js:134-173`), die übrigen hat Legacys Originalfunktion auf
 * denselben Quadraten geliefert (WI-0065, „An Legacys eigenem Code nachgemessen“); der Paritätstest
 * (`travel-borders-legacy.test.ts`) führt diese Funktion selbst aus.
 */

const rule: BorderRule = model.reisekosten.grenzuebertritt.wert;
const count = (segments: BorderSegment[], territories: BorderTerritory[]) =>
    countBorderCrossings(segments, territories, MILES_PER_UNIT, rule);
const countOf = (segments: BorderSegment[], scene: SceneTerritory[] = WEST_OST) =>
    count(segments, prepared(scene))?.count ?? null;

describe("Die Regel steht im Reisemodell", () => {
    it("5 Meilen und 0,4 Einheiten, Legacys Werte, als Setzung mit Herkunft", () => {
        expect(rule).toEqual({ mindestLaufMeilen: 5, abtastschritt: 0.4 });
        expect(model.reisekosten.grenzuebertritt.status).toBe("AVESMAPS_DECISION");
        expect(model.reisekosten.grenzuebertritt.herkunft).toContain("route-costs.js");
        expect(model.meilenJeKarteneinheit.wert).toBe(MILES_PER_UNIT);
    });
});

describe("🔴 Legacys Fälle, Lauflänge statt Geometrieschnitt (Zielwerte aus Legacy)", () => {
    it("eine Linie quer durch beide Reiche: eine Grenze", () => {
        expect(countOf(line([10, 50], [190, 50]))).toBe(1);
    });

    it("💣 Pendeln an der Grenze (ein bis zwei Meilen hinüber, mehrfach) ist EIN Übertritt, nicht fünf", () => {
        const wobble = line([10, 50], [99, 50], [100.3, 50], [99, 50], [100.3, 50], [99, 50], [190, 50]);
        expect(countOf(wobble)).toBe(1);
    });

    it("ein echter Wiedereintritt zählt: hinüber, zurück, wieder hinüber = 3", () => {
        expect(countOf(line([10, 50], [150, 50], [50, 50], [190, 50]))).toBe(3);
    });

    it("ins Meer hinaus (kein Gebiet): kein Übertritt", () => {
        expect(countOf(line([10, 50], [90, 50], [90, 500], [10, 500]))).toBe(0);
    });

    it("🔴 ohne Gebiete gibt es kein Ergebnis - null, nicht 0", () => {
        expect(count(line([10, 50], [190, 50]), [])).toBeNull();
    });

    it("West, weites Meer dazwischen, Ost: kein Übertritt (ein Wechsel zu „kein Gebiet“ zählt nicht); West, Meer, West ebenso", () => {
        expect(countOf(line([50, 50], [50, 500], [150, 500], [150, 50]))).toBe(0);
        expect(countOf(line([50, 50], [50, 500], [60, 500], [60, 50]))).toBe(0);
    });

    it("eine Lücke von 6 Meilen zwischen zwei Reichen trennt sie, eine von 3 Meilen nicht", () => {
        const across = line([10, 50], [190, 50]);
        const west = squareTerritory("west", 0, 0, 100, 100, "West");
        // 2 Einheiten = 6 Meilen, 1 Einheit = 3 Meilen.
        expect(countOf(across, [west, squareTerritory("ost", 102, 0, 200, 100, "Ost")])).toBe(0);
        expect(countOf(across, [west, squareTerritory("ost", 101, 0, 200, 100, "Ost")])).toBe(1);
    });

    it("♻️ Legacy-Eigenheit, 1:1 übernommen: ein kurzer erster Lauf bleibt stehen, ein kurzer letzter wird geschluckt", () => {
        // Start 1,5 Meilen vor der Grenze, dann Ost: eine Grenze. Dieselbe Linie umgekehrt (Ziel 1,5 Meilen hinter
        // der Grenze): keine. Hin- und Rückweg zählen verschieden - Legacy tut es, an den 196 Beispielreisen bei 9.
        const forward = line([99.5, 50], [190, 50]);
        const back = line([190, 50], [99.5, 50]);
        expect(countOf(forward)).toBe(1);
        expect(countOf(back)).toBe(0);
    });
});

describe("Was der Übertritt sagt: von wo nach wo und an welchem Punkt", () => {
    it("Kennung und Name beider Gebiete, der erste Abtastpunkt im neuen Gebiet", () => {
        const result = count(line([10, 50], [190, 50]), prepared(WEST_OST));
        expect(result?.count).toBe(1);
        expect(result?.crossings).toEqual([
            {
                from: { id: "west", name: "West", shortName: "West" },
                to: { id: "ost", name: "Ost", shortName: "Ost" },
                x: 100,
                y: 50,
            },
        ]);
    });

    it("die Zahl ist die Länge der Liste, in der Reihenfolge der Reise", () => {
        const result = count(line([10, 50], [150, 50], [50, 50], [190, 50]), prepared(WEST_OST));
        expect(result?.crossings.map((crossing) => `${crossing.from.id}>${crossing.to.id}`)).toEqual([
            "west>ost",
            "ost>west",
            "west>ost",
        ]);
        expect(result?.count).toBe(3);
    });

    it("ein kurzer Ausflug (3 Meilen) in ein drittes Gebiet ist kein Aufenthalt: keine Grenze dort, der Ort bleibt beim echten Übertritt", () => {
        const enklave = squareTerritory("enklave", 50, 40, 51, 60, "Enklave");
        const west = squareTerritory("west", 0, 0, 200, 100, "West");
        const ost = squareTerritory("ost", 200, 0, 300, 100, "Ost");
        // Die Enklave steht vor West in der Liste und gewinnt dort: 1 Einheit = 3 Meilen, unter der Schwelle.
        const result = count(line([10, 50], [290, 50]), prepared([enklave, west, ost]));
        expect(result?.count).toBe(1);
        expect(result?.crossings[0]?.from.id).toBe("west");
        expect(result?.crossings[0]?.to.id).toBe("ost");
        expect(result?.crossings[0]?.x).toBeGreaterThanOrEqual(200);
    });
});

describe("Abschnitte und Ränder", () => {
    it("Abschnitte einer Reise laufen ineinander: zwei Hälften zählen wie die ganze Linie", () => {
        const halves: BorderSegment[] = [
            {
                geometry: {
                    coordinates: [
                        [10, 50],
                        [90, 50],
                    ],
                },
            },
            {
                geometry: {
                    coordinates: [
                        [90, 50],
                        [190, 50],
                    ],
                },
            },
        ];
        expect(countOf(halves)).toBe(1);
    });

    it("ein Abschnitt ohne Linie (weniger als zwei Punkte) zählt nichts", () => {
        const segments: BorderSegment[] = [
            { geometry: { coordinates: [[10, 50]] } },
            {
                geometry: {
                    coordinates: [
                        [10, 50],
                        [190, 50],
                    ],
                },
            },
        ];
        expect(countOf(segments)).toBe(1);
    });

    it("ohne Abschnitte gibt es kein Ergebnis (Legacy)", () => {
        expect(count([], prepared(WEST_OST))).toBeNull();
    });

    it("eine Linie ganz außerhalb aller Gebiete: 0, nicht null", () => {
        expect(countOf(line([300, 300], [500, 500]))).toBe(0);
    });

    it("ein Punkt auf der Stelle (Länge 0) wird als ein Abtastpunkt gezählt", () => {
        expect(countOf(line([10, 50], [10, 50]))).toBe(0);
    });

    it("eine ungültige Regel wirft, statt endlos abzutasten", () => {
        const segments = line([10, 50], [190, 50]);
        const territories = prepared(WEST_OST);
        expect(() =>
            countBorderCrossings(segments, territories, MILES_PER_UNIT, { ...rule, abtastschritt: 0 }),
        ).toThrow(RangeError);
        expect(() => countBorderCrossings(segments, territories, 0, rule)).toThrow(RangeError);
    });
});

describe("Überlappung, Löcher, Gebiete aus mehreren Teilen", () => {
    const overlapA = squareTerritory("a", 0, 0, 100, 100, "A");
    const overlapB = squareTerritory("b", 50, 0, 150, 100, "B");

    it("🔴 bei Überlappung gewinnt das erste Gebiet der Liste - die Reihenfolge entscheidet, wo der Übertritt liegt", () => {
        const across = line([10, 50], [140, 50]);
        const aFirst = count(across, prepared([overlapA, overlapB]));
        const bFirst = count(across, prepared([overlapB, overlapA]));
        // A zuerst: A bis 100, dann B - der Übertritt liegt bei x = 100. B zuerst: B ab 50 - bei x = 50.
        expect(aFirst?.crossings.map((crossing) => crossing.to.id)).toEqual(["b"]);
        expect(aFirst?.crossings[0]?.x).toBeGreaterThanOrEqual(100);
        expect(aFirst?.crossings[0]?.x).toBeLessThan(100.5);
        expect(bFirst?.crossings.map((crossing) => crossing.to.id)).toEqual(["b"]);
        expect(bFirst?.crossings[0]?.x).toBeGreaterThanOrEqual(50);
        expect(bFirst?.crossings[0]?.x).toBeLessThan(50.5);
    });

    it("🔴 ein Loch zählt als außen: keine Grenze zum Gebiet im Loch ohne dieses Gebiet, zwei mit ihm", () => {
        const ring: SceneTerritory = {
            id: "ring",
            name: "Ring",
            geometry: { type: "Polygon", coordinates: [box(0, 0, 100, 100), box(40, 40, 60, 60)] },
        };
        const insel = squareTerritory("insel", 40, 40, 60, 60, "Insel");
        const through = line([10, 50], [90, 50]);
        // Ohne die Insel liegt im Loch „kein Gebiet“ (60 Meilen breit): Ring, nichts, Ring.
        expect(countOf(through, [ring])).toBe(0);
        // Mit ihr: Ring, Insel, Ring - zwei Grenzen.
        const result = count(through, prepared([ring, insel]));
        expect(result?.crossings.map((crossing) => `${crossing.from.id}>${crossing.to.id}`)).toEqual([
            "ring>insel",
            "insel>ring",
        ]);
        // Und ein Punkt im Loch gehört dem Ring nicht: derselbe Weg, der nur im Loch endet.
        expect(countOf(line([10, 50], [50, 50]), [ring])).toBe(0);
    });

    it("ein Gebiet aus zwei entfernten Teilen ist EIN Gebiet: kein Übertritt zwischen seinen Teilen", () => {
        const inseln: SceneTerritory = {
            id: "inseln",
            name: "Inseln",
            geometry: { type: "MultiPolygon", coordinates: [[box(0, 0, 50, 100)], [box(150, 0, 200, 100)]] },
        };
        // Dazwischen liegt kein Gebiet (150 Meilen): Inseln, nichts, Inseln - und selbst mit einem Gebiet dazwischen
        // wäre es ein Wechsel zwischen zwei Gebieten, aber nie zwischen den Teilen eines Gebiets.
        expect(countOf(line([10, 50], [190, 50]), [inseln])).toBe(0);
        const dazwischen = squareTerritory("mitte", 50, 0, 150, 100, "Mitte");
        expect(countOf(line([10, 50], [190, 50]), [inseln, dazwischen])).toBe(2);
    });

    it("ein Gebiet mit gleichem Namen ist für die Zählung dasselbe (Legacy schlüsselt nach dem Namen)", () => {
        const left = squareTerritory("west-1", 0, 0, 100, 100, "Reich");
        const right = squareTerritory("west-2", 100, 0, 200, 100, "Reich");
        expect(countOf(line([10, 50], [190, 50]), [left, right])).toBe(0);
    });

    it("ein Gebiet mit leerem Namen ist „kein Gebiet“", () => {
        const namenlos = squareTerritory("namenlos", 100, 0, 200, 100, "");
        const west = squareTerritory("west", 0, 0, 100, 100, "West");
        expect(countOf(line([10, 50], [190, 50]), [west, namenlos])).toBe(0);
    });
});

describe("🔴 Hafenzoll nicht beziffert (WI-0065 Z1 A+): ein Schiffsstück verbindet zwei Reiche", () => {
    const sea = (...points: [number, number][]): BorderSegment => ({
        geometry: { coordinates: points },
        subtype: "Seeweg",
    });
    const land = (...points: [number, number][]): BorderSegment => ({
        geometry: { coordinates: points },
        subtype: "Strasse",
    });
    const harbour = (segments: BorderSegment[], scene: SceneTerritory[] = WEST_OST) =>
        count(segments, prepared(scene))?.harbourTollUnknown;

    it("von einem Hafen in West über das Meer zu einem Hafen in Ost: Hinweis gesetzt, aber KEIN Zoll (0 Grenzen)", () => {
        const voyage = [sea([90, 90], [90, 300], [110, 300], [110, 90])];
        const result = count(voyage, prepared(WEST_OST));
        expect(result?.harbourTollUnknown).toBe(true);
        // Legacy und Z1 A: offene See trägt keinen Zoll.
        expect(result?.count).toBe(0);
    });

    it("beide Häfen im selben Reich: kein Hinweis", () => {
        expect(harbour([sea([90, 90], [90, 300], [40, 300], [40, 90])])).toBe(false);
    });

    it("endet das Stück im Wasser ohne Reich (kein Hafen in einem Gebiet): kein Hinweis", () => {
        expect(harbour([sea([90, 90], [90, 300], [110, 300])])).toBe(false);
        expect(harbour([sea([90, 300], [110, 300], [110, 90])])).toBe(false);
    });

    it("über Seewege ist das Schiffsstück eine FOLGE von Abschnitten: Anfang des ersten, Ende des letzten", () => {
        const viaSeaways = [sea([90, 90], [90, 300]), sea([90, 300], [110, 300]), sea([110, 300], [110, 90])];
        expect(harbour(viaSeaways)).toBe(true);
    });

    it("ein Landabschnitt trennt zwei Schiffsstücke: nur ein Stück, das selbst zwei Reiche verbindet, zählt", () => {
        // Stück 1 endet im Wasser, Stück 2 beginnt im Wasser: verschmolzen wäre es West nach Ost, getrennt ist es keines.
        const separated = [
            sea([90, 90], [90, 300]),
            land([90, 300], [300, 300]),
            sea([300, 300], [110, 300], [110, 90]),
        ];
        expect(harbour(separated)).toBe(false);
        // Ein Stück davon verbindet dagegen zwei Reiche.
        expect(
            harbour([...separated, land([110, 90], [120, 90]), sea([120, 90], [120, 300], [40, 300], [40, 90])]),
        ).toBe(true);
    });

    it("eine Reise über Land und Fluss allein setzt den Hinweis nie, auch nicht über die Grenze", () => {
        const overland = [land([10, 50], [190, 50])];
        const result = count(overland, prepared(WEST_OST));
        expect(result?.count).toBe(1);
        expect(result?.harbourTollUnknown).toBe(false);
    });

    it("ohne Angabe der Wegart kennt die Zählung keine Schiffsstücke: kein Hinweis", () => {
        expect(harbour(line([90, 90], [90, 300], [110, 300], [110, 90]))).toBe(false);
    });

    it("gleicher Name ist gleiches Reich (der Schlüssel ist der Name, wie Legacy): kein Hinweis", () => {
        const twins = [
            squareTerritory("west", 0, 0, 100, 100, "Reich"),
            squareTerritory("ost", 100, 0, 200, 100, "Reich"),
        ];
        expect(harbour([sea([90, 90], [90, 300], [110, 300], [110, 90])], twins)).toBe(false);
    });

    it("ein Punkt auf der Stelle: territoryAtPoint nennt das erste Gebiet der Liste, null im Wasser und im Loch", () => {
        const territories = prepared(FUZZ_SCENE);
        expect(territoryAtPoint(territories, 95, 50)?.id).toBe("alpha");
        expect(territoryAtPoint(territories, 120, 65)?.id).toBe("beta");
        expect(territoryAtPoint(territories, 215, 50)?.id).toBe("gamma");
        expect(territoryAtPoint(territories, 250, 50)?.id).toBe("delta");
        expect(territoryAtPoint(territories, 230.5, 50)).toBeNull();
        expect(territoryAtPoint(territories, -50, -50)).toBeNull();
    });
});

describe("Der Kurzname für die Liste im Planer (WI-0065 Z3)", () => {
    const geometry = { type: "Polygon", coordinates: [box(0, 0, 100, 100)] };

    it("ein Gebiet mit Kurzname trägt ihn; ohne oder mit leerem Kurznamen gilt der Name", () => {
        const mit = prepareBorderTerritory({
            id: "a",
            name: "Heiliges Neues Kaiserreich",
            shortName: " Mittelreich ",
            geometry,
        });
        expect(mit?.shortName).toBe("Mittelreich");
        expect(shortNameOf(mit as BorderTerritory)).toBe("Mittelreich");
        for (const leer of [undefined, null, "", "  "]) {
            const ohne = prepareBorderTerritory({ id: "b", name: "Kalifat", shortName: leer, geometry });
            expect(ohne).not.toHaveProperty("shortName");
            expect(shortNameOf(ohne as BorderTerritory)).toBe("Kalifat");
        }
    });

    it("der Übertritt trägt den Kurzname beider Gebiete; der volle Name bleibt daneben", () => {
        const west = prepareBorderTerritory({
            id: "west",
            name: "Westliches Großreich am Meer",
            shortName: "Westreich",
            geometry: { type: "Polygon", coordinates: [box(0, 0, 100, 100)] },
        }) as BorderTerritory;
        const ost = prepareBorderTerritory({
            id: "ost",
            name: "Ostreich",
            geometry: { type: "Polygon", coordinates: [box(100, 0, 200, 100)] },
        }) as BorderTerritory;
        const crossing = count(line([10, 50], [190, 50]), [west, ost])?.crossings[0];
        expect(crossing?.from).toEqual({ id: "west", name: "Westliches Großreich am Meer", shortName: "Westreich" });
        expect(crossing?.to).toEqual({ id: "ost", name: "Ostreich", shortName: "Ostreich" });
    });

    it("die Zählung selbst kennt den Kurznamen nicht: gleicher Name bleibt gleiches Reich, auch mit anderem Kurznamen", () => {
        const a = prepareBorderTerritory({
            id: "a",
            name: "Reich",
            shortName: "A",
            geometry: { type: "Polygon", coordinates: [box(0, 0, 100, 100)] },
        });
        const b = prepareBorderTerritory({
            id: "b",
            name: "Reich",
            shortName: "B",
            geometry: { type: "Polygon", coordinates: [box(100, 0, 200, 100)] },
        });
        expect(count(line([10, 50], [190, 50]), [a as BorderTerritory, b as BorderTerritory])?.count).toBe(0);
    });
});

describe("Ein Gebiet für die Zählung vorbereiten", () => {
    it("ein Polygon: ein Teil mit der Hüllbox des Außenrings, Löcher als weitere Ringe", () => {
        const territory = prepareBorderTerritory({
            id: "t",
            name: "T",
            geometry: { type: "Polygon", coordinates: [box(10, 20, 30, 50), box(15, 25, 20, 30)] },
        });
        expect(territory?.parts).toHaveLength(1);
        expect(territory?.parts[0]?.bbox).toEqual([10, 20, 30, 50]);
        expect(territory?.parts[0]?.rings).toHaveLength(2);
    });

    it("ein MultiPolygon: eine Hüllbox JE TEIL, nicht eine für das ganze Gebiet", () => {
        const territory = prepareBorderTerritory({
            id: "t",
            name: "T",
            geometry: { type: "MultiPolygon", coordinates: [[box(0, 0, 10, 10)], [box(100, 100, 120, 130)]] },
        });
        expect(territory?.parts.map((part) => part.bbox)).toEqual([
            [0, 0, 10, 10],
            [100, 100, 120, 130],
        ]);
    });

    it("Ringe unter vier Punkten zählen nicht; ohne Außenring entfällt der Teil; kein Polygon ergibt null", () => {
        const kurz = [
            [0, 0],
            [1, 1],
            [0, 0],
        ];
        expect(
            prepareBorderTerritory({ id: "t", name: "T", geometry: { type: "Polygon", coordinates: [kurz] } }),
        ).toBeNull();
        const mitKurzemLoch = prepareBorderTerritory({
            id: "t",
            name: "T",
            geometry: { type: "Polygon", coordinates: [box(0, 0, 10, 10), kurz] },
        });
        expect(mitKurzemLoch?.parts[0]?.rings).toHaveLength(1);
        expect(
            prepareBorderTerritory({ id: "t", name: "T", geometry: { type: "Point", coordinates: [1, 2] } }),
        ).toBeNull();
        expect(prepareBorderTerritory({ id: "t", name: "T", geometry: null })).toBeNull();
    });
});

describe("Die Hüllbox je Teilpolygon ändert das Ergebnis nicht", () => {
    it("dieselben Zahlen mit einer Hüllbox je Gebiet (Legacys Bauart) wie je Teil, an 300 Linien", () => {
        const territories = prepared(FUZZ_SCENE);
        // Legacys Bauart: alle Teile eines Gebiets tragen die Hüllbox des ganzen Gebiets.
        const wholeTerritory = withTerritoryWideBoxes(territories);
        const random = mulberry32(7);
        for (let index = 0; index < 300; index += 1) {
            const points: [number, number][] = Array.from({ length: 2 + Math.floor(random() * 8) }, () => [
                -10 + random() * 320,
                -10 + random() * 150,
            ]);
            const segments = line(...points);
            expect(count(segments, territories), `Linie ${String(index)}`).toEqual(count(segments, wholeTerritory));
        }
    });
});

/**
 * Ein Gelände mit vielen Stützpunkten und einem Reich aus verstreuten Inseln, dessen Hüllbox die ganze Karte deckt:
 * dort hilft die Hüllbox je Teil (WI-0065: 32 s gegen 1,0 s an 196 Reisen mit den echten Gebieten).
 */
function landscapeScene(): BorderTerritory[] {
    const random = mulberry32(65);
    const scene: SceneTerritory[] = [];
    const inselreiche: SceneTerritory[] = [];
    // 40 Festlandreiche in einem Raster, jedes mit rund 400 Stützpunkten an einem unruhigen Rand.
    for (let row = 0; row < 5; row += 1) {
        for (let column = 0; column < 8; column += 1) {
            const x0 = column * 125;
            const y0 = row * 200;
            const ring: [number, number][] = [];
            const side = 100;
            for (let step = 0; step < side; step += 1) ring.push([x0 + (125 * step) / side, y0 + random() * 3]);
            for (let step = 0; step < side; step += 1) ring.push([x0 + 125 - random() * 3, y0 + (200 * step) / side]);
            for (let step = 0; step < side; step += 1)
                ring.push([x0 + 125 - (125 * step) / side, y0 + 200 - random() * 3]);
            for (let step = 0; step < side; step += 1) ring.push([x0 + random() * 3, y0 + 200 - (200 * step) / side]);
            ring.push(ring[0] as [number, number]);
            scene.push({
                id: `land-${String(row)}-${String(column)}`,
                name: `Land ${String(row)}-${String(column)}`,
                geometry: { type: "Polygon", coordinates: [ring] },
            });
        }
    }
    // Vier Inselreiche mit je 40 Inseln, über die ganze Karte verstreut. Sie stehen vorn in der Liste: Jeder Punkt fragt
    // sie zuerst, und ihre Hüllbox deckt die ganze Karte.
    for (let realm = 0; realm < 4; realm += 1) {
        const islands: number[][][][] = [];
        for (let island = 0; island < 40; island += 1) {
            const x = random() * 990;
            const y = random() * 990;
            const ring: [number, number][] = [];
            for (let step = 0; step < 20; step += 1) {
                const angle = (step / 20) * Math.PI * 2;
                ring.push([x + 5 + Math.cos(angle) * 4, y + 5 + Math.sin(angle) * 4]);
            }
            ring.push(ring[0] as [number, number]);
            islands.push([ring]);
        }
        inselreiche.push({
            id: `inseln-${String(realm)}`,
            name: `Inseln ${String(realm)}`,
            geometry: { type: "MultiPolygon", coordinates: islands },
        });
    }
    return prepared([...inselreiche, ...scene]);
}

/** Zufällige Reisen von 100 bis 1.000 Einheiten Weg, im Mittel rund 400 (der schlimmste Fall der 196 Beispielreisen: 1.020). */
function longRoutes(routes: number): BorderSegment[][] {
    const random = mulberry32(196);
    return Array.from({ length: routes }, () => {
        let x = random() * 1000;
        let y = random() * 1000;
        const points: [number, number][] = [[x, y]];
        const steps = 10 + Math.floor(random() * 91);
        for (let step = 0; step < steps; step += 1) {
            x = Math.min(1000, Math.max(0, x + (random() - 0.5) * 20));
            y = Math.min(1000, Math.max(0, y + (random() - 0.5) * 20));
            points.push([x, y]);
        }
        return line(...points);
    });
}

describe("Leistung: die Zählung darf das Zeitbudget des Workers nicht sprengen (Kap. 6.63)", () => {
    const territories = landscapeScene();
    const routes = longRoutes(196);

    it("196 Reisen von 100 bis 1.000 Einheiten Weg auf 40 Reichen und 160 Inseln in unter 3 s", () => {
        // Aufwärmen: die erste Rechnung zahlt das Übersetzen des Codes.
        for (const segments of routes.slice(0, 5)) count(segments, territories);
        const started = performance.now();
        for (const segments of routes) count(segments, territories);
        const elapsed = performance.now() - started;
        // Gemessen im Prototyp mit den echten Gebieten: 1,0 s. Die Grenze ist großzügig und hängt an keinem Gerät.
        expect(elapsed, `196 Reisen in ${elapsed.toFixed(0)} ms`).toBeLessThan(3000);
    });

    it("die Hüllbox je Teil ist um ein Vielfaches schneller als eine je Gebiet (das Verhältnis, nicht die Uhr)", () => {
        const wholeTerritory = withTerritoryWideBoxes(territories);
        const sample = routes.slice(0, 30);
        for (const segments of sample.slice(0, 2)) {
            count(segments, territories);
            count(segments, wholeTerritory);
        }
        const time = (which: BorderTerritory[]): number => {
            const started = performance.now();
            for (const segments of sample) count(segments, which);
            return performance.now() - started;
        };
        const perPart = time(territories);
        const perTerritory = time(wholeTerritory);
        expect(
            perTerritory / perPart,
            `je Teil ${perPart.toFixed(0)} ms, je Gebiet ${perTerritory.toFixed(0)} ms`,
        ).toBeGreaterThan(3);
    });
});
