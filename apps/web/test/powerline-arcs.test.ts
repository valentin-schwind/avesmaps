import { describe, expect, it } from "vitest";
import {
    AVENTURIA,
    AVENTURIA_POWERLINE_CARTOGRAPHY,
    createRenderProjection,
    type PowerlineNetwork,
    type PowerlineNetworkLine,
} from "@avesmaps3d/shared";
import {
    ARC_LEVELS,
    arcDraws,
    arcHeightMercator,
    arcHits,
    arcLevels,
    arcNodes,
    arcThreadPath,
    arcThreads,
    buildArcGeometry,
    type ArcLine,
    type ArcNode,
    type ArcThread,
    THREADS_PER_LINE,
    groundHeights,
    uprightNameStrips,
    type ArcFrame,
} from "../src/map/powerline-arcs.ts";

/**
 * Die Bögen am Himmel (WI-0025 Stufe 2), ohne Browser: Geometrie, Ketten, Höhe, aufrechte Namen.
 *
 * 🔴 Der Shader selbst läuft nur im Browser (Browsertest). Hier steht, was er bekommt - und die
 * Rechnung, die die Namen auf denselben Bogen setzt.
 */

const PROJEKTION = createRenderProjection(AVENTURIA.coordinateSpace);
const B = AVENTURIA_POWERLINE_CARTOGRAPHY.boegen;
const S = AVENTURIA_POWERLINE_CARTOGRAPHY.straenge;

function linie(overrides: Partial<PowerlineNetworkLine>): PowerlineNetworkLine {
    return {
        id: "a",
        name: "Testlinie",
        labelVisible: true,
        curve: null,
        from: { id: "O1", kind: "place" },
        to: { id: "O2", kind: "place" },
        path: [
            [400, 500],
            [600, 500],
        ],
        ...overrides,
    };
}

describe("Geometrie der Stränge", () => {
    it("je Linie und feinster Probe zwei Ecken, einmal im Puffer; jede Stufe ihre Dreiecke; jeder Strang und Faden eine Instanz", () => {
        const netz: PowerlineNetwork = { lines: [linie({}), linie({ id: "b", curve: 20 })] };
        const g = buildArcGeometry(netz, PROJEKTION);
        const gerade = S.segmente;
        const gebogen = g.lines[1]?.segments ?? 0;
        expect(gebogen).toBeGreaterThan(gerade);
        const [a, b] = g.lines.map((l) => l.probes) as [number, number];
        const grob = gerade * a + gebogen * b;
        expect(ARC_LEVELS).toEqual(Array.from({ length: Math.log2(S.verfeinerung) + 1 }, (_, i) => 2 ** i));
        expect(g.vertices.length).toBe((grob * S.verfeinerung + 2) * 2 * 18);
        expect(g.indices.length).toBe(ARC_LEVELS.reduce((summe, f) => summe + grob * f * 6, 0));
        // Je Linie und Faden zwei Texel zu vier Werten.
        expect(g.threads.length).toBe(2 * THREADS_PER_LINE * 2 * 4);
    });

    it("die Fäden jeder Linie stehen in der Fadentextur, in der Reihenfolge der Linien, mit Rauschen, Spreizung und Bündel ihrer Linie", () => {
        const g = buildArcGeometry({ lines: [linie({ id: "u1" }), linie({ id: "u2" })] }, PROJEKTION);
        for (const [nummer, id] of ["u1", "u2"].entries()) {
            const l = g.lines[nummer];
            if (!l) {
                throw new Error("Linie erwartet");
            }
            for (const [faden, f] of arcThreads(id).entries()) {
                const stelle = (nummer * THREADS_PER_LINE + faden) * 8;
                expect(Array.from(g.threads.subarray(stelle, stelle + 8))).toEqual(
                    [f.breite, f.licht, f.ausschlag, f.versatz, f.phase, l.noise, l.spread, l.phase].map(Math.fround),
                );
            }
        }
    });

    /** Betreiber 2026-10-11: „jetzt auch den spread gleich breit machen. chalwens griff is 4x so breit wie elementares hexagramm“. */
    it("🔴 die Fäden laufen ab der Bezugslänge gleich weit auseinander; kürzere Linien schmaler; die Mitte schwingt weiter mit der Länge", () => {
        const g = buildArcGeometry(
            {
                lines: [0.25, 1, 1.3, 4, 5.3].map((faktor) =>
                    linie({
                        id: `l${String(faktor)}`,
                        path: [
                            [300, 500],
                            [300 + S.bezugslaenge * faktor, 500],
                        ],
                    }),
                ),
            },
            PROJEKTION,
        );
        const [kurz, bezug, hexagramm, chalwen, lang] = g.lines;
        expect(kurz?.spread).toBeCloseTo(0.25 * S.faecherbreite, 9);
        // Wie Elementares Hexagramm (64 bis 94) und Chalwens Griff (bis 332): dieselbe Breite, die der Tafel.
        for (const l of [bezug, hexagramm, chalwen, lang]) {
            expect(l?.spread).toBeCloseTo(S.faecherbreite, 9);
        }
        expect(chalwen?.noise).toBeCloseTo(4, 9);
        // Jede Linie biegt ihr Bündel an eigenen Stellen, und dieselbe Linie immer gleich.
        expect(new Set(g.lines.map((l) => l.phase)).size).toBe(g.lines.length);
        expect(buildArcGeometry({ lines: [linie({ id: "l4" })] }, PROJEKTION).lines[0]?.phase).toBe(chalwen?.phase);
    });

    /**
     * Betreiber 2026-10-11: „kannst du machen, dass alle bögen das gleiche rauschen-verhältnis relativ zu ihrer länge haben. im moment
     * hat ein kleiner strang soviel rauschen wie ein großer, was ihn unruhig erscheinen lässt“.
     */
    it("🔴 jede Linie rauscht im Verhältnis ihrer Länge: eine Linie der Bezugslänge wie Legacy, eine halb so lange halb so stark", () => {
        const g = buildArcGeometry(
            {
                lines: [
                    linie({
                        id: "lang",
                        path: [
                            [400, 500],
                            [400 + S.bezugslaenge, 500],
                        ],
                    }),
                    linie({
                        id: "kurz",
                        path: [
                            [400, 500],
                            [400 + S.bezugslaenge / 2, 500],
                        ],
                    }),
                    // Gebogen zählt der Weg, nicht die Sehne.
                    linie({
                        id: "knick",
                        path: [
                            [400, 500],
                            [400 + S.bezugslaenge / 2, 500],
                            [400 + S.bezugslaenge / 2, 500 + S.bezugslaenge / 2],
                        ],
                    }),
                ],
            },
            PROJEKTION,
        );
        const [lang, kurz, knick] = g.lines.map((l) => l.noise);
        expect(lang).toBeCloseTo(1, 9);
        expect(kurz).toBeCloseTo(0.5, 9);
        expect(knick).toBeCloseTo(1, 9);
        // Verhältnis zur Länge gleich: Rauschen je Länge ist für jede Linie dasselbe.
        for (const l of g.lines) {
            expect(l.noise / (l.length / g.unit)).toBeCloseTo(1 / S.bezugslaenge, 12);
        }
    });

    /**
     * Betreiber 2026-10-11: „kannst du die glättung der kraftlinien gerade so runterschrauben, dass kanten fast nicht mehr sichtbar
     * sind?“. Dieselbe Punktdichte für jede Linie: Die Bezugslänge bekommt die Proben der Tafel, jede andere im Verhältnis ihrer Länge.
     */
    it("🔴 Proben nach Länge: die Bezugslänge wie die Tafel, die doppelte doppelt so viele, eine kurze nie unter zwei", () => {
        const laenge = (faktor: number) =>
            linie({
                id: `l${String(faktor)}`,
                path: [
                    [300, 500],
                    [300 + S.bezugslaenge * faktor, 500],
                ],
            });
        const g = buildArcGeometry({ lines: [1, 2, 0.05].map(laenge) }, PROJEKTION);
        const [bezug, doppelt, kurz] = g.lines.map((l) => l.probes);
        expect(bezug).toBe(S.proben);
        expect(doppelt).toBe(2 * S.proben);
        expect(kurz).toBe(2);
        // Die Ecken folgen den Proben: je Linie Segmente mal Proben in der feinsten Stufe plus eins, je zwei Seiten.
        const ecken = g.lines.reduce((summe, l) => summe + (l.segments * l.probes * S.verfeinerung + 1) * 2, 0);
        expect(g.vertices.length).toBe(ecken * 18);
    });

    it("🔴 an einem Kraftlinienpunkt landen beide Stücke, wie an jedem Knoten (Betreiber 2026-09-26)", () => {
        const netz: PowerlineNetwork = {
            lines: [
                linie({
                    id: "a",
                    to: { id: "K", kind: "nodix" },
                    path: [
                        [400, 500],
                        [500, 500],
                    ],
                }),
                linie({
                    id: "b",
                    from: { id: "K", kind: "nodix" },
                    path: [
                        [500, 500],
                        [700, 500],
                    ],
                }),
            ],
        };
        const [a, b] = buildArcGeometry(netz, PROJEKTION).lines;
        if (!a || !b) {
            throw new Error("zwei Linien erwartet");
        }
        // „richtig, dort landen, wie bei knoten“: am Punkt K stehen beide Bögen auf dem Boden, in ihrer
        // Mitte darüber.
        const proPx = 1 / (512 * 2 ** 4);
        expect(arcHeightMercator(a, a.length, proPx, 1)).toBeCloseTo(0, 15);
        expect(arcHeightMercator(b, 0, proPx, 1)).toBe(0);
        expect(arcHeightMercator(a, a.length / 2, proPx, 1)).toBeGreaterThan(0);
        expect(arcHeightMercator(b, b.length / 2, proPx, 1)).toBeGreaterThan(0);
    });

    it("die Höhe: null an den Ankern und flach, nie über der Grenze in Bildschirmpixeln", () => {
        const [l] = buildArcGeometry({ lines: [linie({})] }, PROJEKTION).lines;
        if (!l) {
            throw new Error("eine Linie erwartet");
        }
        for (const zoom of [3, 5, 7]) {
            const proPx = 1 / (512 * 2 ** zoom);
            expect(arcHeightMercator(l, 0, proPx, 1)).toBe(0);
            expect(arcHeightMercator(l, l.length / 2, proPx, 0), "flach liegt der Bogen am Boden").toBe(0);
            const mitte = arcHeightMercator(l, l.length / 2, proPx, 1) / proPx;
            expect(mitte).toBeGreaterThan(0);
            expect(mitte).toBeLessThanOrEqual(B.hoechstensPx);
        }
    });
});

/**
 * Betreiber 2026-10-11: „Kannst du in der Kraftlinienansicht mehr leuchtende Fäden unterschiedlicher Stärke zwischen den Orten
 * herstellen“. Legacys Stränge bleiben, wie sie sind; daneben laufen Fäden, die jede Linie aus ihrer Kennung zieht.
 */
describe("Stränge und Fäden einer Linie", () => {
    const F = AVENTURIA_POWERLINE_CARTOGRAPHY.faeden;
    const ids = Array.from({ length: 200 }, (_, i) => `pl-${String(i).padStart(4, "0")}`);
    const anteil = ([von, bis]: readonly [number, number], wert: number): number => (wert - von) / (bis - von);

    it("🔴 zuerst Legacys Stränge in voller Stärke, mit Legacys Ausschlag, Versatz und Phase", () => {
        const straenge = arcThreads("pl-0001").slice(0, S.anzahl);
        expect(straenge).toEqual(
            Array.from({ length: S.anzahl }, (_, k) => ({
                breite: 1,
                licht: 1,
                ausschlag: S.normalScales[k],
                versatz: S.waveOffsets[k],
                phase: k * S.phaseStep,
            })),
        );
        expect(THREADS_PER_LINE).toBe(S.anzahl + F.anzahl);
        expect(arcThreads("pl-0001")).toHaveLength(THREADS_PER_LINE);
    });

    it("🔴 jeder Faden zieht aus der Kennung seiner Linie, in den Bereichen der Tafel; dieselbe Linie sieht immer gleich aus", () => {
        for (const id of ids) {
            const faeden = arcThreads(id).slice(S.anzahl);
            expect(arcThreads(id).slice(S.anzahl), "bei jedem Laden dieselben Fäden").toEqual(faeden);
            for (const f of faeden) {
                for (const [bereich, wert] of [
                    [F.breite, f.breite],
                    [F.leuchtkraft, f.licht],
                    [F.ausschlag, f.ausschlag],
                    [F.versatz, f.versatz],
                ] as const) {
                    expect(wert).toBeGreaterThanOrEqual(bereich[0]);
                    expect(wert).toBeLessThanOrEqual(bereich[1]);
                }
                expect(f.phase).toBeGreaterThanOrEqual(0);
                expect(f.phase).toBeLessThan(2 * Math.PI);
                // Ein Zug setzt Breite und Leuchtkraft: ein breiter Faden leuchtet stärker.
                expect(anteil(F.leuchtkraft, f.licht)).toBeCloseTo(anteil(F.breite, f.breite), 9);
            }
        }
    });

    it("unterschiedliche Stärke: innerhalb einer Linie und von Linie zu Linie, über den ganzen Bereich", () => {
        const breiten = ids.flatMap((id) =>
            arcThreads(id)
                .slice(S.anzahl)
                .map((f) => f.breite),
        );
        const [von, bis] = F.breite;
        // Über 1000 Züge deckt die Folge den Bereich: schmale und breite Fäden kommen vor, nicht nur die Mitte.
        expect(Math.min(...breiten)).toBeLessThan(von + 0.1 * (bis - von));
        expect(Math.max(...breiten)).toBeGreaterThan(bis - 0.1 * (bis - von));
        for (const id of ids.slice(0, 20)) {
            const eigene = new Set(
                arcThreads(id)
                    .slice(S.anzahl)
                    .map((f) => f.breite),
            );
            expect(eigene.size, `${id}: jeder Faden eigen`).toBe(F.anzahl);
        }
        expect(arcThreads("pl-0001")).not.toEqual(arcThreads("pl-0002"));
    });
});

/** Betreiber 2026-10-11: „kannst du daraus auch - wie die kraftlinien - glühende punkte machen (vielleicht "waber" der glow?)“. */
describe("Die Knoten als glühende Punkte", () => {
    const punkt = (props: Record<string, unknown>, lng = 10, lat = 20) => ({
        properties: props,
        geometry: { type: "Point", coordinates: [lng, lat] },
    });

    it("je Kennung ein Knoten, auch wenn ihn zwei Kacheln liefern; Lage in Mercator, Art und Klasse aus der Quelle", () => {
        const knoten = arcNodes([
            punkt({ public_id: "a", subtype: "metropole", node_kind: "place" }),
            punkt({ public_id: "a", subtype: "metropole", node_kind: "place" }, 11, 21),
            punkt({ public_id: "b", subtype: "dorf", node_kind: "nodix" }, -5, 3),
            punkt({ public_id: "c", subtype: "gibt-es-nicht", node_kind: "label" }),
            { properties: { public_id: "d" }, geometry: { type: "LineString", coordinates: [] } },
        ]);
        expect(knoten.map((k) => [k.id, k.kind])).toEqual([
            ["a", "place"],
            ["b", "nodix"],
            ["c", "label"],
        ]);
        const a = knoten[0] as ArcNode;
        expect(a.x).toBeCloseTo((10 + 180) / 360, 12);
        expect(a.lng).toBe(10);
        // Unbekannte Klassen bekommen die Größe eines Dorfs, wie ein Kraftlinienpunkt.
        expect(knoten[2]?.klasse).toBe(knoten[1]?.klasse);
        expect(a.klasse).not.toBe(knoten[1]?.klasse);
    });

    it("jeder Knoten wabert in seiner eigenen Phase, und derselbe Knoten immer in derselben", () => {
        const einmal = arcNodes([punkt({ public_id: "a" }), punkt({ public_id: "b" })]);
        const nochmal = arcNodes([punkt({ public_id: "b" }), punkt({ public_id: "a" })]);
        expect(einmal[0]?.phase).toBe(nochmal[1]?.phase);
        expect(einmal[0]?.phase).not.toBe(einmal[1]?.phase);
        for (const k of einmal) {
            expect(k.phase).toBeGreaterThanOrEqual(0);
            expect(k.phase).toBeLessThan(2 * Math.PI);
        }
    });

    it("Wabern und Puls stehen in der Tafel und bleiben unter der Größe des Knotens", () => {
        const ley = AVENTURIA_POWERLINE_CARTOGRAPHY.leyKnoten;
        expect(ley.wabern).toBeGreaterThan(0);
        expect(ley.puls).toBeGreaterThan(0);
        expect(ley.puls).toBeLessThan(ley.wabern);
    });
});

describe("Aufrechte Namen", () => {
    /** Eine einfache Draufsicht als Matrix: Mercator um die Linie herum in den Bildraum. */
    function draufsicht(mitteX: number, mitteY: number, massstab: number): number[] {
        // Spaltenweise wie WebGL: x' = (x - mx)·k, y' = -(y - my)·k, z' = z, w = 1.
        return [massstab, 0, 0, 0, 0, -massstab, 0, 0, 0, 0, 1, 0, -mitteX * massstab, mitteY * massstab, 0, 1];
    }

    const atlas = {
        width: 2048,
        height: 64,
        plaetze: new Map([["Testlinie", { x: 0, y: 0, w: 200, h: 58 }]]),
    };

    function baender(path: [number, number][]) {
        const g = buildArcGeometry({ lines: [linie({ path })] }, PROJEKTION);
        const l = g.lines[0];
        if (!l) {
            throw new Error("eine Linie erwartet");
        }
        const mitte = l.points[0] as [number, number];
        const ende = l.points[1] as [number, number];
        const zoom = 5;
        const proPx = 1 / (512 * 2 ** zoom);
        // So groß, dass die Linie (rund 1500 px) gut ins Bild passt.
        const matrix = draufsicht((mitte[0] + ende[0]) / 2, (mitte[1] + ende[1]) / 2, 1 / (800 * proPx));
        return uprightNameStrips(g, atlas, matrix, proPx, 1);
    }

    it("steht in der Mitte und wiederholt sich auf einer langen Linie", () => {
        const { count } = baender([
            [400, 500],
            [600, 500],
        ]);
        expect(count).toBeGreaterThanOrEqual(2);
    });

    it("🔴 liest sich von links nach rechts - auch auf einer Linie, die von rechts nach links läuft", () => {
        for (const path of [
            [
                [400, 500],
                [600, 500],
            ],
            [
                [600, 500],
                [400, 500],
            ],
        ] as [number, number][][]) {
            const { vertices, count } = baender(path);
            // Das erste Dreieck beginnt an der Unterkante des ersten Schnitts: u = Anfang des Namens.
            // Liegt es links vom letzten Schnitt DESSELBEN Namens, steht der Name richtig herum. (Die
            // Wiederholungen folgen dahinter und stehen anderswo auf der Linie.)
            const jeName = vertices.length / count;
            const ersteU = vertices[3] as number;
            const ersteX = vertices[0] as number;
            const letzteX = vertices[jeName - 5] as number;
            const richtung = path[0]?.[0] === 400 ? "vorwärts" : "rückwärts";
            expect(ersteU, richtung).toBeCloseTo(0, 6);
            expect(ersteX, `${richtung}: der Anfang des Namens liegt links`).toBeLessThan(letzteX);
        }
    });

    it("ein Name, den Legacy nicht zeigt, steht auch aufrecht nicht", () => {
        const g = buildArcGeometry({ lines: [linie({ labelVisible: false })] }, PROJEKTION);
        const proPx = 1 / (512 * 2 ** 5);
        expect(uprightNameStrips(g, atlas, draufsicht(0.5, 0.5, 1), proPx, 1).count).toBe(0);
    });
});

describe("Auf dem Gelände (WI-0049)", () => {
    const netz: PowerlineNetwork = {
        lines: [
            linie({}),
            linie({
                id: "b",
                path: [
                    [600, 500],
                    [700, 520],
                ],
            }),
        ],
    };

    it("jede Ecke trägt die Nummer ihrer Linie, damit der Shader deren Füße findet", () => {
        const g = buildArcGeometry(netz, PROJEKTION);
        const ecken = g.vertices.length / 18;
        const nummern = new Set(Array.from({ length: ecken }, (_, i) => g.vertices[i * 18 + 17]));
        expect([...nummern].sort()).toEqual([0, 1]);
    });

    it("🔴 die Füße stehen auf der Höhe ihrer Endpunkte, in Mercator-Einheiten wie der Bogen", () => {
        const g = buildArcGeometry(netz, PROJEKTION);
        // Nur der Punkt bei 600/500 (Ende von a, Anfang von b) liegt auf einem Berg von 1000 m.
        const berg = g.lines[1]?.points[0] as [number, number];
        const boden = groundHeights(g, ({ lng }) => (Math.abs(lng - (berg[0] * 360 - 180)) < 1e-9 ? 1000 : 0));
        expect(boden[0]).toBe(0);
        expect(boden[1]).toBeGreaterThan(0);
        expect(boden[2]).toBe(boden[1]);
        expect(boden[3]).toBe(0);
        // 1000 m sind bei dieser Breite eine winzige, aber echte Mercator-Höhe.
        expect(boden[1]).toBeLessThan(1e-3);
    });

    it("ohne Gelände steht alles auf 0", () => {
        const g = buildArcGeometry(netz, PROJEKTION);
        expect([...groundHeights(g, () => null)]).toEqual([0, 0, 0, 0]);
    });

    it("die aufrechten Namen steigen mit dem Boden", () => {
        const g = buildArcGeometry({ lines: [linie({})] }, PROJEKTION);
        const l = g.lines[0];
        if (!l) {
            throw new Error("eine Linie erwartet");
        }
        const atlas = { width: 2048, height: 64, plaetze: new Map([["Testlinie", { x: 0, y: 0, w: 200, h: 58 }]]) };
        const [a, b] = [l.points[0], l.points[1]] as [[number, number], [number, number]];
        const [mx, my] = [(a[0] + b[0]) / 2, a[1]];
        const proPx = 1 / (512 * 2 ** 5);
        const k = 1 / (800 * proPx);
        const matrix = [k, 0, 0, 0, 0, -k, 0, 0, 0, 0, 1, 0, -mx * k, my * k, 0, 1];
        const flach = uprightNameStrips(g, atlas, matrix, proPx, 1);
        const hoch = uprightNameStrips(g, atlas, matrix, proPx, 1, new Float32Array([1e-5, 1e-5]));
        expect(hoch.count).toBe(flach.count);
        // Dieselben Ecken, jede um genau den Boden höher (z ist der dritte Wert je Ecke).
        expect((hoch.vertices[2] as number) - (flach.vertices[2] as number)).toBeCloseTo(1e-5, 9);
    });
});

describe("Treffer: welche Linie liegt unter dem Zeiger (WI-0063 P8)", () => {
    const BREITE = 1600;
    /**
     * Eine Ansicht mit gleichem Maßstab in x und y (ein Bildpunkt = `proPx`), um `mitte` zentriert, 1600 × 1600 Bildpunkte. `hoehe`
     * schiebt Punkte im Raum nach oben, wie die Neigung es tut: x' = (x - mx)·k, y' = -(y - my)·k + z·k·hoehe, w = 1.
     */
    function ansicht(mitte: [number, number], zoom: number, lift: number, time = 0): ArcFrame & { matrix: number[] } {
        const proPx = 1 / (512 * 2 ** zoom);
        const k = 1 / ((BREITE / 2) * proPx);
        const matrix = [k, 0, 0, 0, 0, -k, 0, 0, 0, k, 1, 0, -mitte[0] * k, mitte[1] * k, 0, 1];
        return { matrix, width: BREITE, height: BREITE, proPx, lift, time };
    }
    /** Ein Punkt im Raum als Bildpunkt dieser Ansicht. */
    function aufsBild(frame: ArcFrame, [x, y, z]: [number, number, number]): { x: number; y: number } {
        const m = frame.matrix;
        const nx = (m[0] as number) * x + (m[12] as number);
        const ny = (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
        return { x: ((nx + 1) / 2) * frame.width, y: ((1 - ny) / 2) * frame.height };
    }

    /** Zwei Linien, die sich in (500, 500) kreuzen: `a` waagerecht, `b` senkrecht, je 200 Karteneinheiten. */
    const netz: PowerlineNetwork = {
        lines: [
            linie({
                id: "a",
                name: "Waagerechte",
                path: [
                    [400, 500],
                    [600, 500],
                ],
            }),
            linie({
                id: "b",
                name: "Senkrechte",
                path: [
                    [500, 400],
                    [500, 600],
                ],
            }),
        ],
    };
    const g = buildArcGeometry(netz, PROJEKTION);
    const a = g.lines[0] as ArcLine;
    const kreuzung = ((): [number, number] => {
        const [p, q] = a.points as [[number, number], [number, number]];
        return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    })();
    /** Wo die Fäden der Linie `a` beim Anteil `t` im Bild stehen, und wo ihre Bahn. */
    function faedenBei(frame: ArcFrame, t: number) {
        const faeden = arcThreads(a.id).map((faden) => aufsBild(frame, arcThreadPath(a, 0, faden, frame, g.unit)(t)));
        const bahn = aufsBild(frame, [
            (a.points[0] as [number, number])[0] +
                ((a.points[1] as [number, number])[0] - (a.points[0] as [number, number])[0]) * t,
            kreuzung[1],
            arcHeightMercator(a, a.length * t, frame.proPx, frame.lift),
        ]);
        return { faeden, bahn };
    }

    it("die Fäden landen in den Knoten: am Anfang und am Ende jeder Linie auf ihrer Bahn", () => {
        const frame = ansicht(kreuzung, 5, 1, 7.3);
        for (const faden of arcThreads(a.id)) {
            const bahn = arcThreadPath(a, 0, faden, frame, g.unit);
            expect(bahn(0)[0]).toBeCloseTo((a.points[0] as [number, number])[0], 12);
            expect(bahn(1)[1]).toBeCloseTo((a.points[1] as [number, number])[1], 12);
            expect(bahn(1)[2]).toBeCloseTo(0, 12);
        }
        // Mit der Zeit wabern sie: dieselbe Stelle, ein anderes Bild.
        const faden = arcThreads(a.id)[3] as ArcThread;
        expect(arcThreadPath(a, 0, faden, frame, g.unit)(0.4)).not.toEqual(
            arcThreadPath(a, 0, faden, { ...frame, time: 9.1 }, g.unit)(0.4),
        );
    });

    /**
     * Betreiber 2026-10-11: „ja den streifen kannst anpassen“. Die Bündel langer Linien schwingen nah dran weit neben ihrer Bahn; der
     * Klick trifft dort, wo die Fäden gezeichnet sind, und nicht mehr auf der leeren Bahn.
     */
    it("🔴 getroffen wird ein Faden dort, wo er gezeichnet ist, auch weit neben der Bahn; die leere Bahn trifft nicht", () => {
        const frame = ansicht(kreuzung, 7, 0, 2.5);
        // Jeder Faden dicht abgetastet, im Bild.
        const dicht = arcThreads(a.id).map((faden) => {
            const bahn = arcThreadPath(a, 0, faden, frame, g.unit);
            return Array.from({ length: 2001 }, (_, k) => aufsBild(frame, bahn(k / 2000)));
        });
        // Die Stelle der Bahn, an der der nächste Faden (an welcher Stelle seiner Linie auch immer) am weitesten weg ist.
        let weitester = { t: 0, abstand: 0 };
        for (let t = 0.05; t < 0.95; t += 0.01) {
            const { bahn } = faedenBei(frame, t);
            const naechster = Math.min(...dicht.flat().map((f) => Math.hypot(f.x - bahn.x, f.y - bahn.y)));
            if (naechster > weitester.abstand) {
                weitester = { t, abstand: naechster };
            }
        }
        // Weit genug, dass Legacys Streifen um die Bahn (11 Bildpunkte) daneben läge; sonst bewiese der Test nichts.
        expect(weitester.abstand).toBeGreaterThan(30);
        const { faeden, bahn } = faedenBei(frame, weitester.t);
        for (const faden of faeden) {
            expect(arcHits(g, frame, faden, 11).map((hit) => hit.id)).toContain("a");
        }
        expect(arcHits(g, frame, bahn, 11).map((hit) => hit.id)).not.toContain("a");
    });

    it("🔴 die nächste Linie zuerst: auf einem Faden der Senkrechten ist sie vor der Waagerechten", () => {
        const frame = ansicht(kreuzung, 5, 0);
        const b = g.lines[1] as ArcLine;
        const faden = arcThreads(b.id)[0] as ArcThread;
        const punkt = aufsBild(frame, arcThreadPath(b, 1, faden, frame, g.unit)(0.47));
        const hits = arcHits(g, frame, punkt, 400);
        expect(hits[0]?.id).toBe("b");
        expect(hits[0]?.distance).toBeLessThan(1);
        expect(hits.map((hit) => hit.id)).toEqual(["b", "a"]);
    });

    it("🔴 geneigt steht der Bogen im Raum: getroffen wird er dort, wo er gezeichnet ist, nicht auf der Bahn am Boden", () => {
        const frame = ansicht(kreuzung, 5, 1);
        const t = 0.7;
        const { faeden } = faedenBei(frame, t);
        const amBoden = aufsBild(frame, [
            (a.points[0] as [number, number])[0] +
                ((a.points[1] as [number, number])[0] - (a.points[0] as [number, number])[0]) * t,
            kreuzung[1],
            0,
        ]);
        // Die Bögen steigen spürbar, sonst bewiese der Test nichts.
        expect(Math.min(...faeden.map((f) => Math.abs(f.y - amBoden.y)))).toBeGreaterThan(60);
        expect(arcHits(g, frame, faeden[0] as { x: number; y: number }, 11).map((hit) => hit.id)).toEqual(["a"]);
        expect(arcHits(g, frame, amBoden, 11)).toEqual([]);
    });

    it("hinter der Kamera ist nichts zu treffen", () => {
        const frame = ansicht(kreuzung, 5, 0);
        const hinten = { ...frame, matrix: [...frame.matrix.slice(0, 15), -1] };
        expect(arcHits(g, hinten, { x: BREITE / 2, y: BREITE / 2 }, 1000)).toEqual([]);
    });

    it("ohne Linien nichts", () => {
        expect(arcHits({ lines: [], unit: g.unit }, ansicht(kreuzung, 5, 0), { x: 800, y: 800 }, 11)).toEqual([]);
    });
});

/**
 * Betreiber 2026-10-11: „mehr unterteilungen wären doch nett beim näheren hinzoomen“, „mehr glättung mein ich“. Je Bild bekommt jede
 * Linie die gröbste Stufe, in der kein gerades Stück länger als `kantePx` ist; was nicht zu sehen ist, wird nicht gezeichnet.
 */
describe("Unterteilung je Bild", () => {
    const BREITE = 1600;
    /** Draufsicht wie oben, mit einem Maßstab je Zoom: x' = (x - mx)·k, y' = -(y - my)·k, w = 1. */
    function ansicht(mitte: [number, number], zoom: number): ArcFrame {
        const proPx = 1 / (512 * 2 ** zoom);
        const k = 1 / ((BREITE / 2) * proPx);
        const matrix = [k, 0, 0, 0, 0, -k, 0, 0, 0, 0, 1, 0, -mitte[0] * k, mitte[1] * k, 0, 1];
        return { matrix, width: BREITE, height: BREITE, proPx, lift: 0 };
    }
    const g = buildArcGeometry(
        {
            lines: [
                linie({ id: "a" }),
                linie({
                    id: "fern",
                    path: [
                        [100, 100],
                        [150, 100],
                    ],
                }),
            ],
        },
        PROJEKTION,
    );
    const a = g.lines[0] as ArcLine;
    const [p, q] = a.points as [[number, number], [number, number]];
    const mitteA: [number, number] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];

    it("🔴 weit weg die gröbste Stufe, nah dran feiner; kein gerades Stück länger als `kantePx`, solange es eine feinere gibt", () => {
        let vorher = 0;
        for (const zoom of [1, 3, 5, 6, 7, 8, 9, 9.5]) {
            const frame = ansicht(mitteA, zoom);
            const stufe = arcLevels(g, frame)[0] as number;
            expect(stufe, `Stufe ${String(zoom)}`).toBeGreaterThanOrEqual(vorher);
            const stueck = a.length / frame.proPx / (a.segments * a.probes * (ARC_LEVELS[stufe] as number));
            if (stufe < ARC_LEVELS.length - 1) {
                expect(stueck, `Zoom ${String(zoom)}`).toBeLessThanOrEqual(S.kantePx + 1e-9);
            }
            vorher = stufe;
        }
        expect(arcLevels(g, ansicht(mitteA, 1))[0]).toBe(0);
        expect(arcLevels(g, ansicht(mitteA, 9.5))[0]).toBe(ARC_LEVELS.length - 1);
    });

    it("🔴 eine Linie außerhalb des Bildes wird nicht gezeichnet; eine knapp jenseits des Rands schon (ihr Bündel schlägt aus)", () => {
        expect(arcLevels(g, ansicht(mitteA, 6))[1], "fern").toBe(-1);
        const proPx = ansicht(mitteA, 6).proPx;
        // Die Bahn von `a` 30 Bildpunkte über dem oberen Rand: Stränge und Schein reichen hinein.
        const knapp = arcLevels(g, ansicht([mitteA[0], mitteA[1] + (BREITE / 2 + 30) * proPx], 6))[0];
        expect(knapp).toBeGreaterThanOrEqual(0);
        // Weit darüber ist nichts mehr zu sehen.
        expect(arcLevels(g, ansicht([mitteA[0], mitteA[1] + (BREITE / 2 + 5000) * proPx], 6))[0]).toBe(-1);
    });

    it("steht ein Teil hinter der Kamera, wird nichts weggelassen", () => {
        const frame = ansicht(mitteA, 6);
        const hinten = { ...frame, matrix: [...Array.from(frame.matrix).slice(0, 15), -1] };
        expect(Array.from(arcLevels(g, hinten)).every((stufe) => stufe >= 0)).toBe(true);
    });
});

describe("Hervorhebung: die Dreiecke jeder Linie (WI-0063 P8)", () => {
    it("🔴 je Linie und Stufe ein Bereich im Indexpuffer, Stufe für Stufe ohne Lücke und ohne Überschneidung (für alle Fäden)", () => {
        const netz: PowerlineNetwork = {
            lines: [linie({ id: "a" }), linie({ id: "b", curve: 20 }), linie({ id: "c", name: "Dritte" })],
        };
        const g = buildArcGeometry(netz, PROJEKTION);
        expect(g.ranges).toHaveLength(3);
        let erwartet = 0;
        for (const [stufe, f] of ARC_LEVELS.entries()) {
            for (const [nummer, bereiche] of g.ranges.entries()) {
                const bereich = bereiche[stufe] as { start: number; count: number };
                const l = g.lines[nummer] as ArcLine;
                expect(bereich.start, `Stufe ${String(f)}, Linie ${String(nummer)}: beginnt, wo die vorige endet`).toBe(
                    erwartet,
                );
                expect(bereich.count).toBe(l.segments * l.probes * f * 6);
                erwartet += bereich.count;
            }
            // Die Dreiecke eines Bereichs stehen nur auf den Ecken ihrer Linie: Höchstindex < Mindestindex der nächsten.
            const spannen = g.ranges.map((bereiche) => {
                const bereich = bereiche[stufe] as { start: number; count: number };
                const indizes = Array.from(g.indices.subarray(bereich.start, bereich.start + bereich.count));
                return [Math.min(...indizes), Math.max(...indizes)] as const;
            });
            for (let i = 1; i < spannen.length; i += 1) {
                expect((spannen[i - 1] as readonly [number, number])[1]).toBeLessThan(
                    (spannen[i] as readonly [number, number])[0],
                );
            }
        }
        expect(g.indices.length, "der letzte Bereich endet am Ende des Puffers").toBe(erwartet);
    });

    it("jede Stufe läuft über die ganze Linie: vom ersten Eckenpaar bis zum letzten, nur in größeren Schritten", () => {
        const g = buildArcGeometry({ lines: [linie({ id: "a" })] }, PROJEKTION);
        const l = g.lines[0] as ArcLine;
        const letztesPaar = 2 * l.segments * l.probes * S.verfeinerung;
        for (const [stufe] of ARC_LEVELS.entries()) {
            const bereich = g.ranges[0]?.[stufe] as { start: number; count: number };
            const indizes = Array.from(g.indices.subarray(bereich.start, bereich.start + bereich.count));
            expect(Math.min(...indizes)).toBe(0);
            expect(Math.max(...indizes)).toBe(letztesPaar + 1);
        }
    });

    it("arcDraws: Nachbarn derselben Stufe sind ein Zug, eine Linie mit -1 fehlt, `nur` beschränkt", () => {
        const g = buildArcGeometry({ lines: ["a", "b", "c", "d"].map((id) => linie({ id })) }, PROJEKTION);
        const r = (n: number, s: number) => g.ranges[n]?.[s] as { start: number; count: number };
        // a und b grob, c nicht zu sehen, d fein.
        const zuege = arcDraws(g, [0, 0, -1, 1]);
        expect(zuege).toEqual([
            { start: r(0, 0).start, count: r(0, 0).count + r(1, 0).count },
            { start: r(3, 1).start, count: r(3, 1).count },
        ]);
        expect(arcDraws(g, [0, 0, -1, 1], { nur: new Set([1]) })).toEqual([r(1, 0)]);
        expect(arcDraws(g, [0, 0, -1, 1], { ohne: new Set([0]) })).toEqual([r(1, 0), r(3, 1)]);
        expect(arcDraws(g, [0, 0, -1, 1], { nur: new Set([2]) })).toEqual([]);
    });

    it("jede Linie trägt die Kennung ihres Segments, mit der ein Klick den Subject öffnet", () => {
        const g = buildArcGeometry({ lines: [linie({ id: "u1" }), linie({ id: "u2" })] }, PROJEKTION);
        expect(g.lines.map((l) => l.id)).toEqual(["u1", "u2"]);
    });
});
