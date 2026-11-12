import { describe, expect, it } from "vitest";
import type { WikisyncRegelLageOrt } from "@avesmaps3d/shared";
import {
    lageFertig,
    lageGeometrie,
    lageHalb,
    lageStand,
    lageWarnung,
    setzeLage,
    skizze,
    bedingungLageHalb,
    type EditorBedingung,
    type LageEntwurf,
    type LageFertig,
    type Punkt,
} from "../src/inhalte/inhalte-regel-lage.ts";

/**
 * Das Feld „Lage zu einer Linie“ im Regeleditor (WI-0254), ohne Vue: der halb gefüllte Stand, die Linie und die Halbebene, die Warnung bei einer Linie quer zur Richtung, die Skizze auf dem Umriss.
 *
 * - **Soll:** Eine Lage gilt erst mit Richtung UND Ort; ein ganzer Stand wird `lage`, ein halber bleibt im Editor (`lageEntwurf`), nie beides zugleich. Die Halbebene liegt auf der Seite der Richtung.
 * - **Problemfälle:** eine Linie durch zwei Orte, die fast von Norden nach Süden läuft (nördlich/südlich trennt dort nichts); eine Linie GENAU in der Richtung (trennt gar nichts); der Name eines Ortes am
 *   rechten Rand der Karte (steht links vom Punkt, sonst liefe er aus der Ansicht).
 * - **Erwartungsfälle:** `ST_AsSVG` dreht `y` um; die Orte stehen in der Skizze mit `-y`, die Halbebene ebenso.
 */

const ort = (name: string, x: number, y: number): WikisyncRegelLageOrt => ({
    kennung: `0190c0a0-0000-7000-8000-${name.length.toString().padStart(4, "0")}${x.toString(16).padStart(8, "0")}`,
    name,
    x,
    y,
});
const gareth = ort("Gareth", 500, 700);
const havena = ort("Havena", 300, 900);
const perricum = ort("Perricum", 600, 300);

const bed = (extra: Partial<EditorBedingung> = {}): EditorBedingung => ({
    verknuepfung: "und",
    flaeche: null,
    arten: [],
    klima: null,
    woerter: [],
    rueckfragen: [],
    ...extra,
});

/** Liegt der Punkt im Viereck? (Strahlverfahren) */
function innen(punkt: Punkt, viereck: readonly Punkt[]): boolean {
    let drin = false;
    for (let i = 0, j = viereck.length - 1; i < viereck.length; j = i++) {
        const a = viereck[i]!;
        const b = viereck[j]!;
        if (a.y > punkt.y !== b.y > punkt.y && punkt.x < ((b.x - a.x) * (punkt.y - a.y)) / (b.y - a.y) + a.x)
            drin = !drin;
    }
    return drin;
}

const fertig = (richtung: LageFertig["richtung"], ...orte: WikisyncRegelLageOrt[]): LageFertig => ({ richtung, orte });

describe("Fertig, halb, leer", () => {
    it("🔴 fertig ist Richtung UND ein oder zwei Orte; alles darunter ist halb, solange etwas gewählt ist, sonst nichts", () => {
        expect(lageFertig({ richtung: "sued", orte: [gareth] })).toBe(true);
        expect(lageFertig({ richtung: "sued", orte: [gareth, havena] })).toBe(true);
        expect(lageFertig({ richtung: null, orte: [gareth] })).toBe(false);
        expect(lageFertig({ richtung: "sued", orte: [] })).toBe(false);
        // Mehr als zwei Orte gibt es nicht (der Server lehnte sie ab).
        expect(lageFertig({ richtung: "sued", orte: [gareth, havena, perricum] })).toBe(false);
        expect(lageHalb({ richtung: "sued", orte: [] })).toBe(true);
        expect(lageHalb({ richtung: null, orte: [gareth] })).toBe(true);
        expect(lageHalb({ richtung: null, orte: [] })).toBe(false);
        expect(lageHalb({ richtung: "sued", orte: [gareth] })).toBe(false);
        expect(lageHalb(undefined)).toBe(false);
    });
});

describe("Der Stand in der Bedingung", () => {
    it("🔴 ein ganzer Stand wird `lage`, ein halber `lageEntwurf`, nie beides; „egal“ und ein leerer Stand nehmen beides weg", () => {
        const ganz = setzeLage(bed(), { richtung: "sued", orte: [gareth] });
        expect(ganz.lage).toEqual({ richtung: "sued", orte: [gareth] });
        expect(ganz).not.toHaveProperty("lageEntwurf");

        const halb = setzeLage(ganz, { richtung: "sued", orte: [] });
        expect(halb).not.toHaveProperty("lage");
        expect(halb.lageEntwurf).toEqual({ richtung: "sued", orte: [] });
        expect(bedingungLageHalb(halb)).toBe(true);
        expect(bedingungLageHalb(ganz)).toBe(false);

        // Der halbe Stand wird wieder ganz: das Feld wechselt von `lageEntwurf` zu `lage`.
        const wieder = setzeLage(halb, { richtung: "sued", orte: [havena] });
        expect(wieder.lage?.orte).toEqual([havena]);
        expect(wieder).not.toHaveProperty("lageEntwurf");

        expect(setzeLage(ganz, null)).not.toHaveProperty("lage");
        expect(setzeLage(halb, { richtung: null, orte: [] })).not.toHaveProperty("lageEntwurf");
        expect(Object.keys(setzeLage(halb, null)).sort()).toEqual(Object.keys(bed()).sort());
    });

    it("die übrigen Felder der Bedingung bleiben, wie sie waren; der Stand des Feldes liest die ganze Lage vor dem halben Stand", () => {
        const b = bed({ arten: [{ ebene: "vegetation", art: "wald" }], klima: { von: "arktisch", bis: "kalt" } });
        const mit = setzeLage(b, { richtung: "nord", orte: [gareth] });
        expect(mit.arten).toEqual(b.arten);
        expect(mit.klima).toEqual(b.klima);
        expect(lageStand(mit)).toEqual({ richtung: "nord", orte: [gareth] });
        expect(lageStand(setzeLage(b, { richtung: "nord", orte: [] }))).toEqual({ richtung: "nord", orte: [] });
        expect(lageStand(b)).toEqual({ richtung: null, orte: [] });
    });

    it("kopiert die Orte: ein späteres Ändern des Standes verändert die Bedingung nicht", () => {
        const orte = [{ ...gareth }];
        const stand: LageEntwurf = { richtung: "sued", orte };
        const b = setzeLage(bed(), stand);
        orte[0]!.name = "Anders";
        expect(b.lage?.orte[0]?.name).toBe("Gareth");
    });
});

describe("Linie und Halbebene", () => {
    it("🔴 ein Ort: nördlich liegt oberhalb der waagerechten Linie, südlich darunter, östlich rechts der senkrechten, westlich links", () => {
        const norden = lageGeometrie(fertig("nord", gareth));
        expect(norden.linie?.map((p) => p.y)).toEqual([700, 700]);
        expect(innen({ x: 100, y: 1200 }, norden.flaeche!)).toBe(true);
        expect(innen({ x: 100, y: 200 }, norden.flaeche!)).toBe(false);

        const sueden = lageGeometrie(fertig("sued", gareth));
        expect(innen({ x: 100, y: 200 }, sueden.flaeche!)).toBe(true);
        expect(innen({ x: 100, y: 1200 }, sueden.flaeche!)).toBe(false);

        const osten = lageGeometrie(fertig("ost", gareth));
        expect(osten.linie?.map((p) => p.x)).toEqual([500, 500]);
        expect(innen({ x: 900, y: 700 }, osten.flaeche!)).toBe(true);
        expect(innen({ x: 100, y: 700 }, osten.flaeche!)).toBe(false);

        const westen = lageGeometrie(fertig("west", gareth));
        expect(innen({ x: 100, y: 700 }, westen.flaeche!)).toBe(true);
        expect(innen({ x: 900, y: 700 }, westen.flaeche!)).toBe(false);
        // Ein Ort ist nie quer zur Richtung.
        for (const g of [norden, sueden, osten, westen]) expect(g.warnung).toBeNull();
    });

    it("🔴 zwei Orte: die Linie läuft durch beide, die Halbebene liegt auf der Seite der Richtung (hier die Linie y = x)", () => {
        const west = ort("Westhafen", 200, 200);
        const ost = ort("Osthafen", 600, 600);
        const g = lageGeometrie(fertig("sued", west, ost));
        const [p1, p2] = g.linie!;
        // Die Linie geht durch beide Orte: Der Vektor von einem zum anderen ist parallel zu ihr.
        const kreuz = (p2.x - p1.x) * (ost.y - west.y) - (p2.y - p1.y) * (ost.x - west.x);
        expect(Math.abs(kreuz)).toBeLessThan(1e-6);
        // Südlich einer Linie von Südwesten nach Nordosten liegt der Südosten, nördlich der Nordwesten.
        expect(innen({ x: 800, y: 100 }, g.flaeche!)).toBe(true);
        expect(innen({ x: 100, y: 800 }, g.flaeche!)).toBe(false);
        const nord = lageGeometrie(fertig("nord", west, ost));
        expect(innen({ x: 800, y: 100 }, nord.flaeche!)).toBe(false);
        expect(innen({ x: 100, y: 800 }, nord.flaeche!)).toBe(true);
        // Östlich ist ebenfalls der Südosten, westlich der Nordwesten.
        expect(innen({ x: 800, y: 100 }, lageGeometrie(fertig("ost", west, ost)).flaeche!)).toBe(true);
        expect(innen({ x: 100, y: 800 }, lageGeometrie(fertig("west", west, ost)).flaeche!)).toBe(true);
    });

    it("A–B ist B–A: dieselbe Halbebene, in welcher Folge die Orte auch stehen", () => {
        const ab = lageGeometrie(fertig("ost", havena, perricum));
        const ba = lageGeometrie(fertig("ost", perricum, havena));
        for (const p of [
            { x: 900, y: 600 },
            { x: 100, y: 600 },
            { x: 450, y: 1000 },
            { x: 450, y: 100 },
        ]) {
            expect(innen(p, ab.flaeche!), JSON.stringify(p)).toBe(innen(p, ba.flaeche!));
        }
    });

    it("🔴 eine Linie quer zur Richtung warnt: fast Nord–Süd mit „nördlich“ („steil“), fast West–Ost mit „östlich“ („flach“); sonst keine Warnung", () => {
        const steilA = ort("Nordhafen", 100, 100);
        const steilB = ort("Suedhafen", 110, 900);
        expect(lageGeometrie(fertig("nord", steilA, steilB)).warnung).toBe("steil");
        expect(lageGeometrie(fertig("sued", steilA, steilB)).warnung).toBe("steil");
        expect(lageGeometrie(fertig("ost", steilA, steilB)).warnung).toBeNull();
        expect(lageGeometrie(fertig("west", steilA, steilB)).warnung).toBeNull();
        const flachA = ort("Westdorf", 100, 100);
        const flachB = ort("Ostdorf", 900, 110);
        expect(lageGeometrie(fertig("ost", flachA, flachB)).warnung).toBe("flach");
        expect(lageGeometrie(fertig("west", flachA, flachB)).warnung).toBe("flach");
        expect(lageGeometrie(fertig("nord", flachA, flachB)).warnung).toBeNull();
        // Schräg (45 Grad) passt zu jeder Richtung.
        const a = ort("A", 0, 0);
        const b = ort("B", 100, 100);
        for (const r of ["nord", "sued", "ost", "west"] as const)
            expect(lageGeometrie(fertig(r, a, b)).warnung).toBeNull();
    });

    it("🔴 eine Linie GENAU in der Richtung trennt nichts: keine Linie, keine Fläche, die Warnung zur Richtung", () => {
        const senkrecht = lageGeometrie(fertig("nord", ort("Unten", 300, 100), ort("Oben", 300, 800)));
        expect(senkrecht).toEqual({ linie: null, flaeche: null, warnung: "steil" });
        const waagerecht = lageGeometrie(fertig("west", ort("Links", 100, 300), ort("Rechts", 800, 300)));
        expect(waagerecht).toEqual({ linie: null, flaeche: null, warnung: "flach" });
        // Zwei Orte an einer Stelle ergeben keine Richtung.
        expect(lageGeometrie(fertig("ost", ort("Eins", 5, 5), ort("Zwei", 5, 5))).flaeche).toBeNull();
    });

    it("die Warnung zu einem Stand: nur eine fertige Lage kann quer liegen", () => {
        expect(lageWarnung({ richtung: "nord", orte: [] })).toBeNull();
        expect(lageWarnung({ richtung: null, orte: [gareth, havena] })).toBeNull();
        expect(lageWarnung({ richtung: "nord", orte: [ort("N", 100, 100), ort("S", 105, 900)] })).toBe("steil");
    });
});

describe("Skizze", () => {
    const rahmen = { x0: 0, x1: 1000, y0: 0, y1: 1500 };

    it("🔴 die Ansicht umfasst den Rahmen der Karte mit Rand; `y` ist umgedreht (der Pfad des Servers hat es schon), die Orte stehen mit `-y`", () => {
        const s = skizze({ richtung: "sued", orte: [gareth] }, rahmen);
        expect(s.ansicht).toBe("-14 -1514 1028 1528");
        expect(s.orte).toHaveLength(1);
        expect(s.orte[0]).toMatchObject({ name: "Gareth", cx: 500, cy: -700 });
        // Die Halbebene südlich der Linie: in Bildkoordinaten alles unterhalb von y = -700.
        const punkte = s.flaeche!.split(" ").map((p) => Number(p.split(",")[1]));
        expect(Math.min(...punkte)).toBeCloseTo(-700, 1);
        expect(s.linie).toMatchObject({ y1: -700, y2: -700 });
    });

    it("🔴 ohne Richtung steht der Ort ohne Halbebene und ohne Linie da; ohne Ort steht gar nichts; eine Linie in der Richtung trennt nichts", () => {
        const nurOrt = skizze({ richtung: null, orte: [gareth] }, rahmen);
        expect(nurOrt.orte).toHaveLength(1);
        expect(nurOrt.flaeche).toBeUndefined();
        expect(nurOrt.linie).toBeUndefined();
        const leer = skizze({ richtung: null, orte: [] }, rahmen);
        expect(leer.orte).toEqual([]);
        expect(leer.flaeche).toBeUndefined();
        const quer = skizze({ richtung: "nord", orte: [ort("Unten", 300, 100), ort("Oben", 300, 800)] }, rahmen);
        expect(quer.flaeche).toBeUndefined();
        expect(quer.linie).toBeUndefined();
        expect(quer.orte).toHaveLength(2);
    });

    it("der Name steht auf der Seite des Punktes, die zur Mitte der Karte schaut (rechts vom Punkt am linken Rand, links davon am rechten)", () => {
        const links = skizze({ richtung: null, orte: [ort("Randdorf", 100, 100)] }, rahmen).orte[0]!;
        expect(links.anker).toBe("start");
        expect(links.tx).toBeGreaterThan(links.cx);
        const rechts = skizze({ richtung: null, orte: [ort("Ostdorf", 900, 100)] }, rahmen).orte[0]!;
        expect(rechts.anker).toBe("end");
        expect(rechts.tx).toBeLessThan(rechts.cx);
        // Der Name steht über dem Punkt (in Bildkoordinaten kleineres y).
        expect(rechts.ty).toBeLessThan(rechts.cy);
    });

    it("die Halbebene reicht über die ganze Karte, wie groß der Rahmen auch ist", () => {
        const gross = { x0: 0, x1: 20000, y0: 0, y1: 30000 };
        const s = skizze({ richtung: "ost", orte: [ort("Mitte", 10000, 15000)] }, gross);
        const punkte = s.flaeche!.split(" ").map((p) => p.split(",").map(Number) as [number, number]);
        // Das Viereck umschließt den rechten Rand der Karte ganz.
        expect(Math.max(...punkte.map((p) => p[0]))).toBeGreaterThan(gross.x1);
        expect(Math.min(...punkte.map((p) => p[1]))).toBeLessThan(-gross.y1);
        expect(Math.max(...punkte.map((p) => p[1]))).toBeGreaterThan(-gross.y0);
    });
});
