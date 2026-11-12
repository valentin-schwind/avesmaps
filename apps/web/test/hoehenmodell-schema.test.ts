import { describe, expect, it } from "vitest";
import { baueRaster, formeKoepfe, kopfRadius, rechneRueckennetz, type V12Input } from "@avesmaps3d/shared";
import { hillCap } from "../../server/src/terrain/domain/hills.ts";
import { KOPF_AUSLAUF_E as KOPF_AUSLAUF_REAL } from "../../../packages/shared/src/gebirge/rueckennetz/koepfe.ts";
import { baueAusKaemmen } from "../../../packages/shared/src/gebirge/rueckennetz/kaemme.ts";
import {
    astLinien,
    BSP,
    flankenHoehen,
    formHoehe,
    laengsHoehen,
    querHoehen,
    randHoehen,
    sattelHoehen,
    schemaAeste,
    schemaKamm,
    schemaQuer,
    schemaRand,
    schemaSattel,
    schemaWelle,
    welleHoehen,
    type FormParameter,
} from "../src/auth/hoehenmodell-vorschau-form.ts";
import {
    diffusionNachher,
    diffusionVorher,
    durchhangHoehen,
    erhaltHoehen,
    erosionNachher,
    erosionVorher,
    huegelFenster,
    huegelHoehen,
    huegelKappe,
    KOPF_AUSLAUF_E,
    kopfHoehen,
    kopfRadiusE,
    kammNaehe,
    schemaDurchhang,
    schemaErhalt,
    schemaHuegel,
    schemaKopf,
    schemaRinnen,
    schemaTal,
    talHoehen,
    type HuegelRezept,
} from "../src/auth/hoehenmodell-vorschau-schema.ts";

/**
 * Die Schemata neben den Werten von „19 (Test)“ (WI-0249 P8), ohne Browser.
 *
 * Problemfälle: Das Schema nimmt eine Konstante oder Formel, die der Rechnung davonläuft (Auslauf des Kopfs, Kegel der Nebengipfel, Rücken und
 * Sockel, Äste, Kappe der Hügel); der Wert verändert das Bild nicht oder in die falsche Richtung; ein Fenster passt nicht zur Größe der Hügel.
 */

const HUEGEL: HuegelRezept = {
    minimum: 50,
    maximum: 500,
    wavelength: 2,
    attempts: 8,
    radiusAtMinimum: 1.5,
    heightExponent: 4,
    overlapPower: 4,
};
const HUEGEL_19: HuegelRezept = {
    minimum: 80,
    maximum: 320,
    wavelength: 0.9,
    attempts: 3,
    radiusAtMinimum: 0.5,
    heightExponent: 1.5,
    overlapPower: 4,
};

/** Die Form des Beispiels, wie Fassung 19 sie für das Kammgebirge führt; `rauschen` 0 für den glatten Querschnitt. */
const FORM: FormParameter = {
    breite: 1.1,
    schaerfe: 0.9,
    talboden: 0.3,
    bergform: 2,
    rauschen: 0,
    koernung: 14,
    stufen: 3,
    muster: "rauschen",
    grat: 0.15,
    gratBreite: 0.45,
    randBreite: 3,
    kammMuster: 1,
};

/** Dasselbe Beispielgebirge in der Rechnung des Rückennetzes: ein gerader Kamm der Höhe 3000 auf y = 6, ohne Gipfel und Nebengipfel. */
function rechnung(form: FormParameter, ast = { abstand: 0, laenge: 0 }) {
    const ellipse = Array.from({ length: 96 }, (_, i) => {
        const w = (2 * Math.PI * i) / 96;
        return [BSP.mx + BSP.rx * Math.cos(w), BSP.my + BSP.ry * Math.sin(w)];
    });
    ellipse.push(ellipse[0]!);
    const input: V12Input = {
        bounds: { min_x: 0, min_y: 0, max_x: 24, max_y: 12 },
        geometry: { type: "Polygon", coordinates: [ellipse] },
        peaks: [],
        kurve: null,
        fluesse: [],
        seen: [],
        regler: {
            maximalhoehe: 3000,
            plateau: form.schaerfe,
            bergform: form.bergform,
            rauschen: form.rauschen,
            koernung: form.koernung,
            stufen: form.stufen,
            ...(form.muster === "zellen" ? { muster: "zellen" as const } : {}),
        },
        saat: BSP.saat,
        zelle: 0.25,
    };
    return rechneRueckennetz(
        input,
        {
            struktur: {
                abstand: 6,
                fuellung: 0.3,
                straengeMax: 1,
                wandern: 0.3,
                welle: 14,
                astAbstand: ast.abstand,
                astLaenge: ast.laenge,
            },
            form: {
                breite: form.breite,
                schaerfe: form.schaerfe,
                talboden: form.talboden,
                rauschen: form.rauschen,
                koernung: 4,
                randBreite: form.randBreite,
                erosion: 0,
                erhalt: 0.5,
                grat: form.grat,
                gratBreite: form.gratBreite,
            },
        },
        {
            kaemme: [
                {
                    punkte: [
                        [BSP.kammVon, BSP.kammY],
                        [BSP.kammBis, BSP.kammY],
                    ],
                    rang: "haupt",
                    hoehen: [3000, 3000],
                },
            ],
            stufe: "grundform",
            hypsometrie: false,
            talbodenFest: form.talboden,
        },
    );
}

describe("Form des Rückens: dieselben Formeln wie die Rechnung des Rückennetzes", () => {
    it("🔴 der Querschnitt gleicht der Hebung in der Rechnung, quer über den Kamm in der Mitte", () => {
        for (const form of [
            FORM,
            { ...FORM, schaerfe: 0.2, breite: 1.8 },
            { ...FORM, talboden: 0.7, bergform: 6 },
            { ...FORM, grat: 0, schaerfe: 1 },
        ]) {
            const echt = rechnung(form);
            for (let j = 0; j < echt.hh; j += 1) {
                const y = j * 0.25;
                if (Math.abs(y - BSP.kammY) > 3.5 || y < 1.5) continue;
                const i = Math.round(BSP.mx / 0.25);
                expect(
                    formHoehe(form, BSP.mx, y, false),
                    `Breite ${String(form.breite)}, Schärfe ${String(form.schaerfe)}, y ${String(y)}`,
                ).toBeCloseTo(echt.h[j * echt.w + i]! / 3000, 1);
            }
        }
    });

    it("🔴 die Flanke gleicht der Rechnung mit Rauschen und Muster, Zelle für Zelle (derselbe Zufall, dieselbe Saat)", () => {
        for (const form of [
            { ...FORM, rauschen: 0.5 },
            { ...FORM, rauschen: 0.8, koernung: 30, stufen: 5 },
            { ...FORM, rauschen: 0.6, muster: "zellen" as const },
        ]) {
            const echt = rechnung(form);
            const j = Math.round((BSP.kammY + 1.5) / 0.25);
            let maximum = 0;
            for (let x = 4; x <= 20; x += 0.25) {
                const i = Math.round(x / 0.25);
                maximum = Math.max(
                    maximum,
                    Math.abs(formHoehe(form, x, BSP.kammY + 1.5, true) - echt.h[j * echt.w + i]! / 3000),
                );
            }
            expect(maximum, `${form.muster} ${String(form.rauschen)}`).toBeLessThan(0.02);
        }
    });

    it("der Querschnitt hat seinen Kamm in der Mitte, auf Kammhöhe, und läuft am Rand auf Null", () => {
        const q = querHoehen({ ...FORM, grat: 0 });
        expect(q).toHaveLength(161);
        expect(q[80]).toBeCloseTo(1, 1);
        expect(q[0]).toBe(0);
        expect(q[160]).toBe(0);
        expect(Math.max(...q)).toBeLessThanOrEqual(1.0001);
    });

    it("ein Talboden hebt das Land neben dem Kamm, ein scharfer Rücken ist schmaler als ein runder, eine Gratlinie gräbt die Furche", () => {
        const b = { ...FORM, grat: 0 };
        const neben = (h: readonly number[]): number => h[100] as number;
        expect(neben(querHoehen({ ...b, talboden: 0.8 }))).toBeGreaterThan(
            neben(querHoehen({ ...b, talboden: 0 })) + 0.4,
        );
        expect(neben(querHoehen({ ...b, talboden: 0, schaerfe: 1 }))).toBeLessThan(
            neben(querHoehen({ ...b, talboden: 0, schaerfe: 0 })),
        );
        const mitte = 80 + 12;
        expect(querHoehen({ ...b, grat: 0.3 })[mitte]!).toBeLessThan(querHoehen({ ...b, grat: 0 })[mitte]! - 0.02);
    });

    it("die Flanke schwankt nur mit Rauschen, die Muster unterscheiden sich, das Muster am Kamm blendet den Kamm aus", () => {
        const spanne = (h: readonly number[]): number => Math.max(...h.slice(20, 140)) - Math.min(...h.slice(20, 140));
        const glatt = flankenHoehen({ ...FORM, rauschen: 0 });
        const rauh = flankenHoehen({ ...FORM, rauschen: 0.8 });
        const zellen = flankenHoehen({ ...FORM, rauschen: 0.8, muster: "zellen" });
        expect(spanne(rauh)).toBeGreaterThan(spanne(glatt) + 0.05);
        expect(zellen).not.toEqual(rauh);
        // Am Kamm selbst wirkt das Muster nur nach `kammMuster`; auf der Flanke (1,5 E) immer.
        const kammGlatt = laengsHoehen({ ...FORM, rauschen: 0.8, kammMuster: 0 }, 0);
        const kammRauh = laengsHoehen({ ...FORM, rauschen: 0.8, kammMuster: 1 }, 0);
        expect(spanne(kammGlatt)).toBeLessThan(0.01);
        expect(spanne(kammRauh)).toBeGreaterThan(0.05);
        expect(laengsHoehen({ ...FORM, rauschen: 0.8, kammMuster: 0 }, 1.5)).toEqual(
            laengsHoehen({ ...FORM, rauschen: 0.8, kammMuster: 1 }, 1.5),
        );
        expect(kammNaehe(0)).toBe(1);
        expect(kammNaehe(1.2)).toBe(0);
        expect(schemaKamm(FORM, FORM).vorher).not.toBeNull();
    });

    it("🔴 die Äste gleichen denen der Rechnung (`baueAusKaemmen`): dieselben Ansatzpunkte und Richtungen", () => {
        const r = baueRaster(
            { min_x: 0, min_y: 0, max_x: 24, max_y: 12 },
            0.25,
            (x, y) => ((x - BSP.mx) / BSP.rx) ** 2 + ((y - BSP.my) / BSP.ry) ** 2 < 1,
        );
        for (const [abstand, laenge] of [
            [2.5, 0.8],
            [1.8, 0.5],
            [4, 1],
        ] as const) {
            const netz = baueAusKaemmen(
                r,
                [
                    {
                        punkte: [
                            [BSP.kammVon, BSP.kammY],
                            [BSP.kammBis, BSP.kammY],
                        ],
                        rang: "haupt",
                        hoehen: [3000, 3000],
                    },
                ],
                {
                    abstand: 6,
                    fuellung: 0.3,
                    straengeMax: 1,
                    wandern: 0.3,
                    welle: 14,
                    astAbstand: abstand,
                    astLaenge: laenge,
                },
                BSP.saat,
                [],
                3000,
            );
            const echt = netz.kanten.filter((k) => k.art === "ast").map((k) => k.punkte);
            const schema = astLinien(abstand, laenge);
            expect(schema.length, `Abstand ${String(abstand)}`).toBe(echt.length);
            for (let k = 0; k < echt.length; k += 1) {
                expect(schema[k]![0]![0]).toBeCloseTo(echt[k]![0]![0], 6);
                expect(schema[k]![0]![1]).toBeCloseTo(echt[k]![0]![1], 6);
                // Die Länge hängt an der Wegmessung in Zellen (Maske gegen Ellipse): höchstens eine Zelle Unterschied.
                const ende = (l: readonly (readonly number[])[]): number =>
                    Math.hypot(l.at(-1)![0]! - l[0]![0]!, l.at(-1)![1]! - l[0]![1]!);
                expect(Math.abs(ende(schema[k]!) - ende(echt[k]!))).toBeLessThan(0.5);
            }
        }
        expect(astLinien(0, 0.8)).toEqual([]);
    });

    it("mehr Astabstand gibt weniger Äste, längere Äste reichen weiter; das Gebirge steht von oben (kein Boden)", () => {
        expect(astLinien(1.5, 0.8).length).toBeGreaterThan(astLinien(4, 0.8).length);
        const weite = (l: ReturnType<typeof astLinien>): number =>
            Math.max(...l.map((a) => Math.hypot(a.at(-1)![0] - a[0]![0], a.at(-1)![1] - a[0]![1])));
        expect(weite(astLinien(2.5, 1))).toBeGreaterThan(weite(astLinien(2.5, 0.3)));
        const figur = schemaAeste(2.5, 0.8);
        expect(figur.draufsicht).toBe(true);
        expect(figur.flaeche.endsWith("Z")).toBe(true);
        expect(figur.marken).toHaveLength(2);
    });

    it("Sattel: Zwischen zwei Gipfeln sinkt der Kamm auf den Wert und bleibt an den Gipfeln stehen; 1 ist gerade", () => {
        const h = sattelHoehen(0.3);
        expect(h[0]).toBe(1);
        expect(h.at(-1)).toBe(1);
        expect(h[80]!).toBeCloseTo(0.3 + 0.7 * Math.exp(-(8 * 8) / 32), 6);
        expect(sattelHoehen(1).every((v) => v === 1)).toBe(true);
        expect(schemaSattel(0.5).marken).toHaveLength(2);
    });

    it("Welle: Die Höhe schwankt nur um wenige Prozent; ein langer Wert gibt eine ruhigere Linie", () => {
        const spanne = (h: readonly number[]): number => Math.max(...h) - Math.min(...h);
        expect(spanne(welleHoehen(2))).toBeGreaterThan(spanne(welleHoehen(40)));
        expect(schemaWelle(12).vorher).not.toBeNull();
    });

    it("Rand: Ein breiterer Auslauf hebt das Gebirge später an; ein Talboden gibt dem Rand Höhe", () => {
        const schmal = randHoehen(0.5);
        const breit = randHoehen(4);
        const i = 20;
        expect(breit[i]!).toBeLessThan(schmal[i]!);
        expect(schemaRand(3).vorher).not.toBeNull();
        expect(Math.max(...randHoehen(3, 0.9))).toBeGreaterThan(Math.max(...randHoehen(3, 0.2)));
    });

    it("schemaQuer: gestrichelt der Vergleich, dazwischen der Unterschied", () => {
        const s = schemaQuer({ ...FORM, talboden: 0.7 }, { ...FORM, talboden: 0 });
        expect(s.vorher).not.toBeNull();
        expect(s.unterschied).toMatch(/^M/u);
        expect(s.marken).toHaveLength(1);
    });
});

describe("Kopf, Durchhang, Erosion, Ausgleich, Hügel: die Formeln der Rechnung im Eindimensionalen", () => {
    it("🔴 der Auslauf des Kopfes ist der der Rechnung (eine Konstante, zwei Orte)", () => {
        expect(KOPF_AUSLAUF_E).toBe(KOPF_AUSLAUF_REAL);
    });

    it("🔴 Kopf mit Neigung: das Schema gleicht Zelle für Zelle dem Kegel von `formeKoepfe` (Radius, Profil, Sockel)", () => {
        // Ein Streifen mit der Reihe des Nebengipfels: In ihr ist die Entfernung zum Punkt der Abstand in x, wie im Schema.
        const r = baueRaster({ min_x: 0, min_y: 0, max_x: 10, max_y: 0.5 }, 0.25, () => true);
        const roh = kopfHoehen(0);
        const zeile = (h: Float64Array): number[] => Array.from({ length: r.w }, (_, i) => h[r.w + i]! / 3000);
        const reihe = (x: number): number => Math.round(x / 0.0625);
        for (const [prominenz, neigung] of [
            [0.1, 0.08],
            [0.1, 0.03],
            [0.2, 0.05],
            [0.06, 0.12],
        ] as const) {
            const h = new Float64Array(r.w * r.hh);
            for (let j = 0; j < r.hh; j += 1)
                for (let i = 0; i < r.w; i += 1) h[j * r.w + i] = roh[reihe(r.x(i))]! * 3000;
            formeKoepfe(r, h, [{ x: 6.5, y: 0.25, h: 0.7 * 3000, fest: false }], prominenz * 3000, { neigung });
            const echt = zeile(h);
            const schema = kopfHoehen(prominenz, neigung);
            for (let i = 0; i < r.w; i += 1) {
                const x = r.x(i);
                if (Math.abs(x - 6.5) > kopfRadius(prominenz * 3000, neigung) + KOPF_AUSLAUF_E + 0.25) continue;
                expect(
                    echt[i]!,
                    `Prominenz ${String(prominenz)}, Neigung ${String(neigung)}, x ${String(x)}`,
                ).toBeCloseTo(schema[reihe(x)]!, 3);
            }
        }
    });

    it("Kopf: Je mehr Prominenz, desto tiefer der Sattel neben dem Nebengipfel; der Nebengipfel selbst bleibt", () => {
        const roh = kopfHoehen(0);
        const mit = kopfHoehen(0.2);
        const i = Math.round((6.5 / 10) * 160);
        expect(mit[i]).toBeCloseTo(roh[i]!, 6);
        const rand = Math.round(((6.5 + 0.9) / 10) * 160);
        expect(mit[rand]!).toBeLessThan(roh[rand]! - 0.05);
        const naheDran = (h: number[]) => Math.min(...h.slice(i - 20, i + 20));
        expect(naheDran(kopfHoehen(0.3))).toBeLessThan(naheDran(kopfHoehen(0.1)));
        // Weit weg vom Nebengipfel ändert sich nichts.
        expect(mit[10]).toBe(roh[10]);
    });

    it("Kopf mit Neigung: die Neigung ändert die Form, die Spitze bleibt; ohne Neigung wie zuvor", () => {
        const i = Math.round((6.5 / 10) * 160);
        const breit = kopfHoehen(0.1, 0.04);
        const schmal = kopfHoehen(0.1, 0.12);
        expect(breit[i]).toBeCloseTo(schmal[i]!, 6);
        const unterschied = breit.map((h, k) => Math.abs(h - schmal[k]!));
        expect(Math.max(...unterschied)).toBeGreaterThan(0.01);
        expect(kopfHoehen(0.1, 0)).toEqual(kopfHoehen(0.1));
        expect(kopfRadiusE(0.1, 0)).toBe(0.75);
        expect(kopfRadiusE(0.1, 0.08)).toBeCloseTo(1.25, 6);
        expect(kopfRadiusE(0.3, 0.02)).toBe(2);
        expect(schemaKopf(0.1, 0.08, 0).vorher).not.toBe(schemaKopf(0.1, 0.08).vorher);
    });

    it("Durchhang: ohne Wert gerade zwischen den Punkten, mit Wert hängt die Mitte durch, die Punkte bleiben", () => {
        const gerade = durchhangHoehen(0);
        const tief = durchhangHoehen(0.4);
        expect(tief).toHaveLength(gerade.length);
        const mitte = (gerade.length - 1) / 4;
        expect(tief[mitte]!).toBeLessThan(gerade[mitte]! - 0.3);
        expect(tief[0]).toBe(gerade[0]);
        expect(tief[(gerade.length - 1) / 2]).toBeCloseTo(gerade[(gerade.length - 1) / 2]!, 9);
        expect(tief.at(-1)).toBeCloseTo(gerade.at(-1)!, 9);
        const s = schemaDurchhang(0.4);
        expect(s.vorher).not.toBeNull();
        expect(s.unterschied).toMatch(/^M/u);
        expect(s.marken).toHaveLength(3);
    });

    it("Erosion: 0 bleibt die Saat, 1 ist niedriger in den Tälern und auf den Kuppen", () => {
        const vorher = erosionVorher();
        expect(erosionNachher(0)).toEqual(vorher);
        const nachher = erosionNachher(1);
        const taleI = Math.round((5.5 / 16) * 160);
        expect(nachher[taleI]!).toBeLessThan(vorher[taleI]! - 0.05);
        const kuppeI = 80;
        expect(nachher[kuppeI]!).toBeLessThan(vorher[kuppeI]!);
    });

    it("Rinnen und Erhalt: Der Erhalt blendet die Form vor der Erosion zurück, auf den Kämmen mehr; Stufe 0 ändert nichts", () => {
        const vorher = erosionVorher();
        erhaltHoehen(0, 0).forEach((h, i) => expect(h).toBeCloseTo(vorher[i]!, 9));
        const ohne = erhaltHoehen(1, 0);
        const halb = erhaltHoehen(1, 0.5);
        const voll = erhaltHoehen(1, 1);
        const abweichung = (h: readonly number[]): number => h.reduce((a, x, i) => a + Math.abs(x - vorher[i]!), 0);
        expect(abweichung(halb)).toBeLessThan(abweichung(ohne));
        expect(abweichung(voll)).toBeCloseTo(0, 9);
        // Auf dem Kamm (x = 8) bleibt auch ohne Erhalt etwas stehen (`GRAT_ERHALT`).
        const kamm = 80;
        expect(vorher[kamm]! - ohne[kamm]!).toBeLessThan(vorher[kamm]! - erosionNachher(1)[kamm]!);
        expect(schemaRinnen(5, 0.5).linie).not.toBe(schemaRinnen(5, 0).linie);
        expect(schemaRinnen(0, 0.5).linie).toBe(schemaRinnen(0, 0).linie);
        expect(schemaErhalt(0.2).vorher).not.toBeNull();
    });

    it("Hangdiffusion: Dieselbe Rechnung wie im Gelände, die Spitze sinkt mit Wert und Runden, die Masse bleibt etwa", () => {
        const vorher = diffusionVorher();
        expect(diffusionNachher(0, 20)).toEqual(vorher);
        const spitze = (h: number[]) => Math.max(...h);
        expect(spitze(diffusionNachher(0.015, 20))).toBeLessThan(spitze(vorher));
        expect(spitze(diffusionNachher(0.05, 20))).toBeLessThan(spitze(diffusionNachher(0.015, 20)));
        expect(spitze(diffusionNachher(0.015, 60))).toBeLessThan(spitze(diffusionNachher(0.015, 20)));
        const masse = (h: number[]) => h.reduce((a, b) => a + b, 0);
        expect(masse(diffusionNachher(0.05, 20))).toBeGreaterThan(0.95 * masse(vorher));
        // Der Wert der Fassung 19 (0,005 je Runde) rundet die Spitze kaum: Der Zug am Regler reicht bis 0,1.
        expect(spitze(vorher) - spitze(diffusionNachher(0.005, 20))).toBeLessThan(0.05);
        expect(spitze(vorher) - spitze(diffusionNachher(0.05, 20))).toBeGreaterThan(0.08);
    });

    it("Tal: schneidet in der Achse am tiefsten ein, höchstens bis 75 % der Hanghöhe; breiter öffnet es weiter", () => {
        const flach = talHoehen(0, 1.5);
        expect(flach.every((h) => h === flach[0])).toBe(true);
        const tief = talHoehen(3000, 1.5);
        expect(Math.min(...tief)).toBeCloseTo(flach[0]! * 0.25, 6);
        expect(tief[80]).toBe(Math.min(...tief));
        const breit = talHoehen(500, 4);
        const schmal = talHoehen(500, 1);
        expect(breit.filter((h) => h < flach[0]! - 1e-6).length).toBeGreaterThan(
            schmal.filter((h) => h < flach[0]! - 1e-6).length,
        );
        expect(schemaTal(1000, 2).vorher).not.toBeNull();
    });
});

describe("Hügel: die Kappe des Geländes und das Fenster", () => {
    it("🔴 die Kappe gleicht der des Servers in der Mitte, am Rand und außerhalb", () => {
        const kappe = { x: 5, y: 5, radius: 3, height: 300 };
        for (const [x, y] of [
            [5, 5],
            [6.5, 5],
            [7.99, 5],
            [8, 5],
            [11, 5],
            [5, 2.5],
        ] as const)
            expect(huegelKappe(kappe, x, y)).toBe(hillCap({ ...kappe }, x, y));
    });

    it("das Fenster folgt der Größe der Hügel: 16 E bei denen der Fassung 19, 40 E bei großen", () => {
        expect(huegelFenster(HUEGEL_19)).toBe(16);
        expect(huegelFenster(HUEGEL)).toBe(40);
        expect(huegelFenster({ minimum: 100, maximum: 100.0001, radiusAtMinimum: 0.1 })).toBe(12);
    });

    it("breitere Kappen füllen das Bild, die Höhen bleiben im Bild", () => {
        const flaeche = (rezept: HuegelRezept): number => huegelHoehen(rezept).filter((h) => h > 0.02).length;
        expect(flaeche({ ...HUEGEL_19, radiusAtMinimum: 0.3 })).toBeLessThan(
            flaeche({ ...HUEGEL_19, radiusAtMinimum: 1.2 }),
        );
        for (const rezept of [HUEGEL, HUEGEL_19]) {
            const h = huegelHoehen(rezept);
            expect(Math.max(...h)).toBeLessThanOrEqual(1.05);
            expect(Math.max(...h)).toBeGreaterThan(0.3);
        }
        expect(schemaHuegel(HUEGEL_19).vorher).toBeNull();
    });

    it("die Hügel der Fassung 19 stehen im Schema als Hügel, nicht als einzelne Striche", () => {
        // Die breiteste Kappe hat etwa 2 E Radius: bei 16 E Fenster und 160 Punkten über 40 Punkte breit.
        const h = huegelHoehen(HUEGEL_19);
        const breite = h.filter((v) => v > 0.1).length;
        expect(breite).toBeGreaterThan(30);
    });
});
