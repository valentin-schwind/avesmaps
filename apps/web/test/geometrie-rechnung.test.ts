import { describe, expect, it } from "vitest";
import { WEG } from "../src/map/geometrie/arten";
import { bildVon } from "../src/map/geometrie/bild";
import type { Pixel, Punkt, Teil, Ziel } from "../src/map/geometrie/geometrie";
import {
    amOrt,
    andockziele,
    aufGemeinsamerKante,
    einfuegePosition,
    einrasten,
    flaechenKanteUnter,
    liegenBleibende,
    mitziehende,
    stellenAn,
    teilungsPunkte,
    teilungUnter,
} from "../src/map/geometrie/rechnung";
import { standNach } from "../src/map/geometrie/formentwurf";

/**
 * Das gemeinsame Geometrie-Modul als reine Rechnung (WI-0177). Problemfälle: ein Ende rastet in Karteneinheiten statt am Schirm ein
 * und greift beim Hineinzoomen ins Leere; eine Kante gewinnt vor einer Ecke daneben; ein Ende rastet am eigenen anderen Ende ein;
 * an einem Ort ziehen alle Wege mit; Strg zieht trotzdem mit; der Doppelklick setzt den Punkt in den falschen Abschnitt; die Hülle
 * fehlt an den Enden.
 */

/** 1 Karteneinheit = 100 Bildpunkte: Abstände am Schirm sind leicht nachzurechnen. */
const schirm = (p: Punkt): Pixel => ({ x: p.x * 100, y: p.y * 100 });

const weg = (punkte: Punkt[], objekt = "w"): Teil => ({
    objekt,
    name: objekt,
    nr: 0,
    art: "linie",
    punkte,
    revision: 3,
});

describe("Einrasten im Bildschirmmaß", () => {
    const ziele: Ziel[] = [
        { art: "ecke", at: { x: 1, y: 1 }, objekt: "a", name: "A" },
        { art: "ort", at: { x: 2, y: 1 }, objekt: "o", name: "Ort" },
        { art: "kante", at: { x: 0, y: 3 }, bis: { x: 4, y: 3 }, objekt: "k", name: "K" },
    ];

    it("nimmt das nächste erlaubte Ziel im Radius, in Bildpunkten gemessen", () => {
        const treffer = einrasten({ x: 106, y: 100 }, ziele, ["ecke", "ort"], 10, schirm);
        expect(treffer?.ziel.objekt).toBe("a");
        expect(treffer?.at).toEqual({ x: 1, y: 1 });
        expect(treffer?.abstand).toBeCloseTo(6);
        expect(einrasten({ x: 115, y: 100 }, ziele, ["ecke", "ort"], 10, schirm)).toBeUndefined();
    });

    it("🔴 dieselbe Strecke in Karteneinheiten rastet je nach Zoom ein oder nicht", () => {
        const nah = (p: Punkt): Pixel => ({ x: p.x * 1000, y: p.y * 1000 });
        // 0,06 Karteneinheiten neben der Ecke: weit weg gezoomt 6 Bildpunkte (rastet ein), nah herangezoomt 60 (rastet nicht).
        expect(einrasten({ x: 106, y: 100 }, ziele, ["ecke"], 10, schirm)?.ziel.objekt).toBe("a");
        expect(einrasten({ x: 1060, y: 1000 }, ziele, ["ecke"], 10, nah)).toBeUndefined();
        expect(einrasten({ x: 1006, y: 1000 }, ziele, ["ecke"], 10, nah)?.ziel.objekt).toBe("a");
    });

    it("🔴 eine Ecke geht vor einer näheren Kante; der Kantenpunkt ist der Fußpunkt", () => {
        const beide: Ziel[] = [
            { art: "ecke", at: { x: 1, y: 2.92 }, objekt: "e", name: "E" },
            { art: "kante", at: { x: 0, y: 3 }, bis: { x: 4, y: 3 }, objekt: "k", name: "K" },
        ];
        expect(einrasten({ x: 100, y: 299 }, beide, ["ecke", "kante"], 10, schirm)?.ziel.objekt).toBe("e");
        const nurKante = einrasten({ x: 150, y: 296 }, beide, ["kante"], 10, schirm);
        expect(nurKante?.ziel.objekt).toBe("k");
        expect(nurKante?.at.x).toBeCloseTo(1.5);
        expect(nurKante?.at.y).toBeCloseTo(3);
    });

    it("ohne erlaubte Zielart oder ausgeschlossen: kein Einrasten", () => {
        expect(einrasten({ x: 100, y: 100 }, ziele, [], 10, schirm)).toBeUndefined();
        expect(einrasten({ x: 100, y: 100 }, ziele, ["ecke"], 10, schirm, (z) => z.objekt !== "a")).toBeUndefined();
    });

    it("die Andockmarken sind die erlaubten Ecken und Orte im Umkreis, nie Kanten", () => {
        const marken = andockziele({ x: 150, y: 100 }, ziele, ["ecke", "ort", "kante"], 60, schirm);
        expect(marken.map((z) => z.objekt).sort()).toEqual(["a", "o"]);
    });
});

describe("Stützpunkte setzen und Mitziehen", () => {
    it("der Doppelklick setzt hinter den nächsten geraden Abschnitt (Legacy), beim Ring auch auf die schließende Strecke", () => {
        const punkte = [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
        ];
        expect(einfuegePosition(punkte, { x: 100, y: 5 }, schirm, false)).toBe(1);
        expect(einfuegePosition(punkte, { x: 205, y: 120 }, schirm, false)).toBe(2);
        expect(einfuegePosition(punkte, { x: 95, y: 105 }, schirm, true)).toBe(3);
    });

    it("🔴 am Knoten ohne Ort ziehen deckungsgleiche Punkte anderer Wege mit; am Ort und mit Strg nicht", () => {
        const knoten = { x: 5, y: 5 };
        const stich = weg([knoten, { x: 5, y: 9 }], "stich");
        const fremd = weg(
            [
                { x: 1, y: 1 },
                { x: 2, y: 2 },
            ],
            "fremd",
        );
        const nach = { x: 6, y: 6 };
        expect(mitziehende(knoten, nach, [stich, fremd], [], false)).toEqual([
            { stelle: { objekt: "stich", nr: 0, index: 0 }, revision: 3, von: knoten, nach },
        ]);
        expect(mitziehende(knoten, nach, [stich], [{ x: 5, y: 5 }], false)).toEqual([]);
        expect(mitziehende(knoten, nach, [stich], [], true)).toEqual([]);
        expect(amOrt({ x: 5.000004, y: 5 }, [knoten])).toBe(true);
        expect(stellenAn({ x: 5.000001, y: 5 }, [stich])).toHaveLength(1);
    });

    it("🔴 G9 mit Strg gelöst: am Ausgangspunkt bleibt ein Bernstein-Ring, wo Nachbarn liegen bleiben; nicht ohne Lösen, nicht am Ort, nicht ohne Nachbarn", () => {
        const knoten = { x: 5, y: 5 };
        const stich = weg([knoten, { x: 5, y: 9 }], "stich");
        expect(liegenBleibende(knoten, [stich], [], true)).toEqual([knoten]);
        expect(liegenBleibende(knoten, [stich], [], false)).toEqual([]);
        expect(liegenBleibende(knoten, [stich], [knoten], true)).toEqual([]);
        expect(liegenBleibende({ x: 7, y: 7 }, [stich], [], true)).toEqual([]);
        const bild = bildVon(
            WEG,
            { teile: [], nachbarn: [stich], mitgezogen: [], andock: [], marken: [], liegen: [knoten] },
            12,
        );
        expect(bild.ringe).toContainEqual({ at: knoten, art: "liegen", radius: 17 });
    });
});

describe("Die Art Weg", () => {
    const teil = weg([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
    ]);
    const stelle = (index: number) => ({ objekt: "w", nr: 0, index });

    it("nur die Enden rasten ein, an Orten und Stützpunkten; nie am Ziel des anderen Endes", () => {
        // Seit OPS-000088 (03f656099, Vali 2026-11-06) ist auch die Geländemarke (`gipfel`) ein Ziel; der Aufrufer nennt sie nur einem Fluss oder Bach.
        expect(WEG.ziele(stelle(0), teil)).toEqual(["ort", "ecke", "gipfel"]);
        expect(WEG.ziele(stelle(1), teil)).toEqual([]);
        const amAnderenEnde: Ziel = { art: "ort", at: { x: 2, y: 0 }, objekt: "o", name: "O" };
        expect(WEG.zielErlaubt(amAnderenEnde, stelle(0), teil)).toBe(false);
        expect(WEG.zielErlaubt(amAnderenEnde, stelle(2), teil)).toBe(true);
    });

    it("die Enden bleiben beim Löschen, ein Weg behält zwei Punkte", () => {
        expect(WEG.loeschbar(stelle(1), teil)).toBe(true);
        expect(WEG.loeschbar(stelle(0), teil)).toBe(false);
        expect(
            WEG.loeschbar(
                stelle(1),
                weg([
                    { x: 0, y: 0 },
                    { x: 1, y: 1 },
                ]),
            ),
        ).toBe(false);
    });

    it("🔴 die Hülle steht in Ruhe an beiden Enden, beim Ziehen um den gezogenen Punkt, mit Kringel am Ziel", () => {
        const ruhe = bildVon(WEG, { teile: [teil], nachbarn: [], mitgezogen: [], andock: [], marken: [] }, 10);
        expect(ruhe.ringe).toEqual([
            { at: { x: 0, y: 0 }, art: "huelle", radius: 10 },
            { at: { x: 2, y: 0 }, art: "huelle", radius: 10 },
        ]);
        expect(ruhe.anfasser.map((a) => a.ende)).toEqual([true, false, true]);
        expect(ruhe.linien.map((l) => l.rolle)).toEqual(["kante"]);
        // Die Kurve geht durch jeden Stützpunkt: 1 + 8 je Abschnitt.
        expect(ruhe.linien[0]!.coords).toHaveLength(17);

        const ziel: Ziel = { art: "ecke", at: { x: -1, y: 0 }, objekt: "a", name: "A" };
        const zug = bildVon(
            WEG,
            {
                teile: [teil],
                nachbarn: [],
                mitgezogen: [],
                gezogen: { stelle: stelle(0), at: { x: -1, y: 0 } },
                treffer: { ziel, at: ziel.at, abstand: 4 },
                andock: [ziel],
                marken: [],
            },
            10,
        );
        expect(zug.ringe).toEqual([
            { at: { x: 2, y: 0 }, art: "huelle", radius: 10 },
            { at: { x: -1, y: 0 }, art: "huelle", radius: 10 },
            { at: { x: -1, y: 0 }, art: "kringel", radius: 11 },
        ]);
        expect(zug.andock).toEqual([{ x: -1, y: 0 }]);
    });

    it("ein mitgezogener Nachbar steht blass an der alten Lage und gestrichelt an der neuen", () => {
        const nachbar = weg(
            [
                { x: 0, y: 0 },
                { x: 0, y: 3 },
            ],
            "n",
        );
        const bild = bildVon(
            WEG,
            {
                teile: [teil],
                nachbarn: [nachbar],
                mitgezogen: [
                    {
                        stelle: { objekt: "n", nr: 0, index: 0 },
                        revision: 3,
                        von: { x: 0, y: 0 },
                        nach: { x: 1, y: 0 },
                    },
                ],
                andock: [],
                marken: [{ at: { x: 2, y: 0 }, art: "frei" }],
            },
            10,
        );
        expect(bild.linien.map((l) => `${l.objekt}:${l.rolle}`)).toEqual(["n:alt", "n:folge", "w:kante"]);
        expect(bild.linien[1]!.coords[0]).toEqual({ x: 1, y: 0 });
        expect(bild.ringe.at(-1)).toEqual({ at: { x: 2, y: 0 }, art: "frei", radius: 13 });
    });
});

/** 5.2 (Thomas 2026-10-19): Ein neuer Punkt auf einer gemeinsamen Kante kommt auch in den Nachbarn. */
describe("Neuer Punkt auf einer gemeinsamen Kante", () => {
    const ring = (objekt: string, punkte: Punkt[]): Teil => ({
        objekt,
        name: objekt,
        nr: 0,
        art: "ring",
        revision: 7,
        punkte,
    });
    const links = ring("a", [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
    ]);
    const at = { x: 1, y: 0.5 };

    it("🔴 die Kante in Gegenrichtung beim Nachbarn: dort an die Stelle nach ihrem Anfang, auch über das Ringende", () => {
        const rechts = ring("b", [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 1 },
            { x: 1, y: 1 },
        ]);
        // Im linken Ring ist (1,0)–(1,1) die Strecke 1→2, der neue Punkt steht an Stelle 2; im rechten ist es 3→0, also Stelle 4.
        expect(aufGemeinsamerKante(links, 2, at, [rechts])).toEqual([
            { stelle: { objekt: "b", nr: 0, index: 4 }, revision: 7, at },
        ]);
    });

    it("eine Ecke allein ist keine gemeinsame Kante, und ein Weg teilt keine Kanten", () => {
        const eck = ring("c", [
            { x: 1, y: 1 },
            { x: 2, y: 1 },
            { x: 2, y: 2 },
        ]);
        expect(aufGemeinsamerKante(links, 2, at, [eck])).toEqual([]);
        const strecke = weg([
            { x: 1, y: 0 },
            { x: 1, y: 1 },
        ]);
        expect(aufGemeinsamerKante(links, 2, at, [strecke])).toEqual([]);
        expect(aufGemeinsamerKante(strecke, 1, at, [links])).toEqual([]);
    });
});

describe("Strg + Klick: vier Punkte auf der Kante (Betreiber 2026-10-20, Legacy)", () => {
    const ring = (objekt: string, punkte: Punkt[]): Teil => ({
        objekt,
        name: objekt,
        nr: 0,
        art: "ring",
        revision: 7,
        punkte,
    });
    const links = ring("a", [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
    ]);
    const vier = [
        { x: 1, y: 0.2 },
        { x: 1, y: 0.4 },
        { x: 1, y: 0.6 },
        { x: 1, y: 0.8 },
    ];
    const nah = (a: readonly Punkt[], b: readonly Punkt[]): void => {
        expect(a).toHaveLength(b.length);
        a.forEach((p, i) => {
            expect(p.x).toBeCloseTo(b[i]!.x, 9);
            expect(p.y).toBeCloseTo(b[i]!.y, 9);
        });
    };

    it("🔴 vier Punkte gleichmäßig auf der geraden Strecke, ohne die Enden, nicht am Zeiger", () => {
        nah(teilungsPunkte({ x: 0, y: 0 }, { x: 5, y: 0 }), [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
            { x: 4, y: 0 },
        ]);
        const unter = teilungUnter([links], { x: 112, y: 30 }, schirm);
        expect(unter).toMatchObject({ objekt: "a", nr: 0, position: 2, von: { x: 1, y: 0 }, bis: { x: 1, y: 1 } });
        nah(unter!.punkte, vier);
    });

    it("🔴 die Ecke geht vor der Kante (14 px), und weiter als 22 px von der Strecke zeigt nichts", () => {
        expect(teilungUnter([links], { x: 108, y: 6 }, schirm)).toBeUndefined();
        expect(teilungUnter([links], { x: 122, y: 50 }, schirm)?.position).toBe(2);
        expect(teilungUnter([links], { x: 122.5, y: 50 }, schirm)).toBeUndefined();
        // Über das Ringende: die Strecke vom letzten Punkt zum ersten.
        expect(teilungUnter([links], { x: -10, y: 50 }, schirm)?.position).toBe(4);
        // Ein Weg hat keine schließende Strecke.
        const strecke = weg([
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
        ]);
        expect(teilungUnter([strecke], { x: 45, y: 55 }, schirm)).toBeUndefined();
        expect(teilungUnter([strecke], { x: 50, y: 10 }, schirm)?.position).toBe(1);
    });

    it("🔴 auf einer gemeinsamen Kante kommen die vier auch in den Nachbarn, in der Richtung seiner Kante; `standNach` setzt sie dort", () => {
        const rechts = ring("b", [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 1 },
            { x: 1, y: 1 },
        ]);
        const gleich = ring("c", [
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 0.5 },
        ]);
        const eingefuegt = aufGemeinsamerKante(links, 2, vier, [rechts, gleich]);
        // Rechts läuft die Kante 3→0 (Gegenrichtung): Stellen 4–7, von (1,1) nach (1,0). Bei „gleich“ läuft sie 0→1: Stellen 1–4.
        expect(eingefuegt.map((e) => [e.stelle.objekt, e.stelle.index, e.at.y])).toEqual([
            ["b", 4, 0.8],
            ["b", 5, 0.6],
            ["b", 6, 0.4],
            ["b", 7, 0.2],
            ["c", 1, 0.2],
            ["c", 2, 0.4],
            ["c", 3, 0.6],
            ["c", 4, 0.8],
        ]);
        const nachher = standNach(
            { teile: [links], nachbarn: [rechts, gleich] },
            {
                art: "einfuegen",
                stelle: { objekt: "a", nr: 0, index: 2 },
                teile: [{ ...links, punkte: [...links.punkte.slice(0, 2), ...vier, ...links.punkte.slice(2)] }],
                mitgezogen: [],
                eingefuegt,
                treffer: undefined,
                getrennt: false,
            },
        );
        expect(nachher.nachbarn[0]!.punkte.map((q) => [q.x, q.y])).toEqual([
            [1, 0],
            [2, 0],
            [2, 1],
            [1, 1],
            [1, 0.8],
            [1, 0.6],
            [1, 0.4],
            [1, 0.2],
        ]);
        expect(nachher.nachbarn[1]!.punkte.map((q) => [q.x, q.y])).toEqual([
            [1, 0],
            [1, 0.2],
            [1, 0.4],
            [1, 0.6],
            [1, 0.8],
            [1, 1],
            [2, 0.5],
        ]);
    });

    it("die Vorschau: die gerade Strecke als eigene Linie und die vier Punkte", () => {
        const unter = teilungUnter([links], { x: 112, y: 30 }, schirm)!;
        const bild = bildVon(
            WEG,
            { teile: [links], nachbarn: [], mitgezogen: [], andock: [], marken: [], teilung: unter },
            10,
        );
        expect(bild.linien.filter((l) => l.rolle === "teilung").map((l) => l.coords)).toEqual([
            [
                { x: 1, y: 0 },
                { x: 1, y: 1 },
            ],
        ]);
        expect(bild.teilung).toHaveLength(4);
    });
});

/**
 * T59 (OPS-000043; der Betreiber wählte 2026-10-20 „A Wie Legacy (Empfehlung)“): Ein Doppelklick in die bearbeitete Fläche setzt einen
 * Punkt an der Klickstelle in die nächste Kante, auch weit innen; neben der Fläche nur bis 22 px. Problemfälle: der Punkt landet in
 * einem anderen Ring als der nächsten Kante (Legacy suchte früher nur Ring 0); ein Klick ins Loch zählt als Inneres; ein Klick weit
 * draußen setzt einen Punkt statt „Fertig“.
 */
describe("Doppelklick in die Fläche (T59, Legacy)", () => {
    const ring = (punkte: Punkt[], nr = 0, objekt = "f"): Teil => ({
        objekt,
        name: objekt,
        nr,
        art: "ring",
        revision: 2,
        punkte,
    });
    // 0..4 × 0..4 Karteneinheiten = 400 × 400 px, darin ein Loch 1.5..2.5.
    const aussen = ring([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
    ]);
    const loch = ring(
        [
            { x: 1.5, y: 1.5 },
            { x: 2.5, y: 1.5 },
            { x: 2.5, y: 2.5 },
            { x: 1.5, y: 2.5 },
        ],
        1,
    );

    it("🔴 weit im Inneren: in die nächste Kante, ohne Schranke", () => {
        // 60 px vom rechten Rand, über 100 px von jeder anderen Kante: Strecke 1→2, also Stelle 2.
        expect(flaechenKanteUnter([aussen], { x: 340, y: 200 }, schirm)).toEqual({ objekt: "f", nr: 0, position: 2 });
        // Nahe der Lochkante, im Inneren: der Lochring, nicht der Außenring.
        expect(flaechenKanteUnter([aussen, loch], { x: 270, y: 200 }, schirm)).toEqual({
            objekt: "f",
            nr: 1,
            position: 2,
        });
    });

    it("🔴 draußen bis 22 px neben der Kante setzt er, weiter draußen nicht (dort bleibt „Fertig“)", () => {
        expect(flaechenKanteUnter([aussen], { x: 422, y: 200 }, schirm)?.position).toBe(2);
        expect(flaechenKanteUnter([aussen], { x: 422.5, y: 200 }, schirm)).toBeUndefined();
        // Über das Ringende: die Strecke vom letzten Punkt zum ersten.
        expect(flaechenKanteUnter([aussen], { x: -15, y: 200 }, schirm)?.position).toBe(4);
    });

    it("🔴 ein Loch ist nicht Inneres: mitten im Loch kein Punkt, am Lochrand bis 22 px schon", () => {
        expect(flaechenKanteUnter([aussen, loch], { x: 200, y: 200 }, schirm)).toBeUndefined();
        expect(flaechenKanteUnter([aussen, loch], { x: 230, y: 200 }, schirm)).toEqual({
            objekt: "f",
            nr: 1,
            position: 2,
        });
    });

    it("eine Linie hat kein Inneres; bei mehreren Objekten gilt das, in dem der Zeiger liegt", () => {
        expect(
            flaechenKanteUnter(
                [
                    weg([
                        { x: 0, y: 0 },
                        { x: 4, y: 0 },
                    ]),
                ],
                { x: 200, y: 5 },
                schirm,
            ),
        ).toBeUndefined();
        const nachbar = ring(
            [
                { x: 4.1, y: 0 },
                { x: 8, y: 0 },
                { x: 8, y: 4 },
                { x: 4.1, y: 4 },
            ],
            0,
            "n",
        );
        // Zwischen beiden, in keinem: die nächste Kante (8 px neben „f“, 2 px neben „n“).
        expect(flaechenKanteUnter([aussen, nachbar], { x: 408, y: 200 }, schirm)).toMatchObject({ objekt: "n" });
        // Im Inneren von „n“, weit von allen Kanten: seine nächste (links, 190 px), nicht die von „f“.
        expect(flaechenKanteUnter([aussen, nachbar], { x: 600, y: 200 }, schirm)).toMatchObject({
            objekt: "n",
            position: 4,
        });
    });
});
