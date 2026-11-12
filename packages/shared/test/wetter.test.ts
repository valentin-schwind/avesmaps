import { describe, expect, it } from "vitest";
import {
    karteneinstellung,
    WETTERMODELL_ID_MUSTER,
    WETTERMODELL_WERTE,
    WETTER_JAHR_SPALTEN,
    WETTER_JAHR_WERTE,
    WETTER_PRESET_ID_MUSTER,
    WETTER_PRESET_VORGABEN,
    WETTER_SYMBOL_VORGABEN,
    WETTER_UNBESTIMMT,
    wetterBogenAusGrad,
    wetterDatenAus,
    wetterFreierTag,
    wetterNeuePresetWerte,
    istAngelegtePresetId,
    wetterGeltung,
    wetterGradAusBogen,
    wetterJahreswerte,
    wetterJahrImRahmen,
    wettermodellImRahmen,
    wettermodellPaarFehler,
    wettermodellVorgaben,
    wettermodellWirksam,
    wetterSymbolStimmig,
    type WetterDatenAntwort,
} from "../src/index.ts";

/**
 * Die Tafeln des Wetters (WI-0288 Stufe 2). Problemfälle: Eine Vorgabe ändert sich beim Umzug aus dem Prototyp („Die Standardwerte bleiben,
 * wie sie sind“); zwei Presets teilen einen Tag oder keines ist unbestimmt; eine Antwort des Servers bringt Unsinn in die Engine.
 */

/** `WETTER_VORGABEN` des Prototyps, wie es bis Stufe 1 in `wetter-engine.ts` stand (`git show da472775c:…`), nur die Zahlen. */
const PROTOTYP = {
    wind: 0.55,
    conf: 1.35,
    tempo: 0.1,
    oro: 1.25,
    evap: 1.3,
    evapMeer: 1.3,
    cov: 1,
    density: 0.75,
    thick: 4400,
    scale: 0.9,
    tn: -6,
    ts: 30,
    sunEl: 38,
    sunAz: 250,
    sunPower: 1.25,
    exposure: 0.52,
    shafts: 0.2,
    schatten: 0.1,
    steps: 56,
    feucht: 0.7,
    regen: 1.1,
    tief: 0.95,
    front: 2.2,
    schleier: 0.75,
    pmenge: 1.15,
    phell: 1.1,
    plang: 1,
    pbreit: 1,
    schicht: 1800,
    wellen: 2.55,
    kern: 0.5,
    auge: 0.2,
    mmenge: 1,
    mhell: 1,
    mlang: 1,
    mbreit: 1,
    nmenge: 1,
    nhell: 1,
    ngross: 1,
    stuerme: 1,
    // `glanz: 1` zog 2026-11-08 in die Standardwerte (`ozeanGlanz`, Panel „OceanShader an/aus“); geprüft unten.
    schneeHang: 18,
} as const;

/** Die Symbole des Prototyps (`wetter-symbole.ts` bis Stufe 1): Art, Lage, Richtung im Bogenmaß, Stärke, Reichweite. */
const PROTOTYP_SYMBOLE: readonly [string, number, number, number, number, number][] = [
    ["wind", 341, 617, -0.153, 12.04, 150],
    ["wind", 605, 798, 2.842, 9, 125],
    ["wind", 430, 40, 0.6, 8, 120],
    ["wirbel", 282, 188, 0, 4, 180],
    ["wirbel", 907, 659, 0, 7.5, 135],
    ["wirbel", 293, 825, 0, 19, 170],
    ["wirbel", 707, 886, 0, 14, 130],
    ["wirbel", 139, 357, 0, 9, 195],
    ["stroemung", 60, 430, 1.571, 6, 130],
    ["stroemung", 98, 740, 0.76, 12.45, 204],
    ["stroemung", 480, 980, 0, 6, 130],
    ["stroemung", 985, 760, -1.571, 6, 130],
    ["stroemung", 460, 215, 2.6, 5, 90],
];

/** Vorgaben, die bewusst vom Prototyp abweichen, mit Grund. */
const ABWEICHUNGEN: Readonly<Record<string, number>> = {
    // WI-0290 (2026-11-08, mit WI-0288 abgestimmt): Mit 10 % war der Wolkenschatten kaum zu sehen.
    schatten: 0.5,
};

describe("Vorgaben aus dem Prototyp", () => {
    it("🔴 jede Zahl von WETTER_VORGABEN steht unverändert in Kartenstandard oder Wettermodell, und keine doppelt", () => {
        const modell = wettermodellVorgaben();
        for (const [id, zahl] of Object.entries(PROTOTYP)) {
            const jahr = (WETTER_UNBESTIMMT as Record<string, number>)[id];
            expect(
                [jahr, modell[id]].filter((wert) => wert !== undefined),
                id,
            ).toEqual([ABWEICHUNGEN[id] ?? zahl]);
        }
        // `res: "auto"` heißt in der Tafel 0.
        expect(modell["res"]).toBe(0);
        // Der Glanz steht nur noch in den Standardwerten, mit der Vorgabe des Prototyps.
        expect(modell["glanz"]).toBeUndefined();
        expect(karteneinstellung("ozeanGlanz")?.vorgabe).toBe(1);
        expect(karteneinstellung("ozeanGlanzpunkt")?.vorgabe).toBe(1);
    });

    it("🔴 die bis Stufe 1 festen Zahlen der Engine sind die Vorgaben des Modells", () => {
        expect(wettermodellVorgaben()).toMatchObject({
            mittelAb: 900,
            mittelVoll: 600,
            feinAb: 220,
            feinVoll: 140,
            nahAb: 85,
            nahVoll: 45,
            takt: 30,
            fpsGrob: 36,
            fpsFein: 57,
            resMin: 0.25,
            eFern: 2560,
            eMittel: 320,
            eNah: 80,
            rFern: 1536,
            rMittel: 768,
            rNah: 768,
        });
    });

    it("🔴 die Icons sind die des Prototyps; Grad und Bogenmaß gehen ohne Verlust ineinander über", () => {
        expect(WETTER_SYMBOL_VORGABEN).toHaveLength(PROTOTYP_SYMBOLE.length);
        WETTER_SYMBOL_VORGABEN.forEach((symbol, i) => {
            const [art, x, z, bogen, staerke, reichweite] = PROTOTYP_SYMBOLE[i]!;
            expect(symbol).toMatchObject({ art, x, z, staerke, reichweite, sichtbar: true });
            if (art === "wirbel") expect(symbol).toMatchObject({ richtung: null, drehsinn: -1 });
            else {
                const zurueck = wetterBogenAusGrad(symbol.richtung!);
                expect(Math.cos(zurueck)).toBeCloseTo(Math.cos(bogen), 12);
                expect(Math.sin(zurueck)).toBeCloseTo(Math.sin(bogen), 12);
            }
            expect(wetterSymbolStimmig(symbol), symbol.id).toBe(true);
        });
        expect(new Set(WETTER_SYMBOL_VORGABEN.map((symbol) => symbol.id)).size).toBe(PROTOTYP_SYMBOLE.length);
        // Die Windrose: Osten ist 90 °, Norden (−z) 0 °, Süden 180 °.
        expect(wetterGradAusBogen(0)).toBeCloseTo(90, 12);
        expect(wetterGradAusBogen(-Math.PI / 2)).toBeCloseTo(0, 12);
        expect(wetterGradAusBogen(Math.PI / 2)).toBeCloseTo(180, 12);
    });
});

describe("Mahlstrom", () => {
    const grund = {
        name: null,
        nameZeigen: false,
        sichtbar: true,
        x: 10,
        z: 20,
        reichweite: 60,
        staerke: 4,
        wikiTitel: null,
    } as const;

    it("🔴 ein Mahlstrom hat wie der Wirbel einen Drehsinn und keine Richtung", () => {
        expect(wetterSymbolStimmig({ ...grund, art: "mahlstrom", richtung: null, drehsinn: 1 })).toBe(true);
        expect(wetterSymbolStimmig({ ...grund, art: "mahlstrom", richtung: null, drehsinn: -1 })).toBe(true);
        expect(wetterSymbolStimmig({ ...grund, art: "mahlstrom", richtung: 90, drehsinn: 1 })).toBe(false);
        expect(wetterSymbolStimmig({ ...grund, art: "mahlstrom", richtung: 90, drehsinn: null })).toBe(false);
        expect(wetterSymbolStimmig({ ...grund, art: "mahlstrom", richtung: null, drehsinn: null })).toBe(false);
        // Die übrigen Arten bleiben, wie sie waren.
        expect(wetterSymbolStimmig({ ...grund, art: "stroemung", richtung: 90, drehsinn: null })).toBe(true);
        expect(wetterSymbolStimmig({ ...grund, art: "stroemung", richtung: null, drehsinn: 1 })).toBe(false);
    });
});

describe("Presets", () => {
    it("🔴 vierzehn, je Monat am 15., der Namenlose am 3. Tag, genau eines unbestimmt", () => {
        expect(WETTER_PRESET_VORGABEN.map((preset) => preset.tag)).toEqual([
            null,
            15,
            45,
            75,
            105,
            135,
            165,
            195,
            225,
            255,
            285,
            315,
            345,
            363,
        ]);
        expect(new Set(WETTER_PRESET_VORGABEN.map((preset) => preset.id)).size).toBe(14);
        for (const preset of WETTER_PRESET_VORGABEN) {
            expect(preset.id).toMatch(new RegExp(WETTER_PRESET_ID_MUSTER, "u"));
            for (const wert of WETTER_JAHR_WERTE) {
                expect(wetterJahrImRahmen(wert, preset.werte[wert.id]), `${preset.id} ${wert.id}`).toBe(true);
            }
        }
        expect(WETTER_PRESET_VORGABEN[0]!.werte).toEqual(WETTER_UNBESTIMMT);
    });

    it("die datierten tragen die alte Jahrestafel an ihrem Tag", () => {
        const praios = WETTER_PRESET_VORGABEN.find((preset) => preset.id === "p-praios")!;
        // 15. Praios liegt zwischen „Übergang“ (345) und „Hochsommer“ (30): 35 von 50 Tagen, geglättet 0,784.
        expect(praios.werte.tn).toBe(0.272);
        expect(praios.werte.thick).toBe(5340.8);
        const namenlos = WETTER_PRESET_VORGABEN.find((preset) => preset.id === "p-namenlos")!;
        expect(namenlos.werte).toMatchObject({ tn: -6, sunPower: 0.75, thick: 6000, tief: 1.4, stuerme: 1.6 });
        // Die Rahja-Mitte ist der alte Stützpunkt „Übergang“, also genau der Kartenstandard.
        expect(WETTER_PRESET_VORGABEN.find((preset) => preset.id === "p-rahja")!.werte).toEqual(WETTER_UNBESTIMMT);
    });

    it("🔴 ohne Reisebeginn das unbestimmte, am Tag eines Presets genau dieses, dazwischen die Nachbarn, auch über den Jahreswechsel", () => {
        expect(wetterGeltung(WETTER_PRESET_VORGABEN, null)).toEqual([{ id: "p-u", anteil: 1 }]);
        expect(wetterGeltung(WETTER_PRESET_VORGABEN, 45)).toEqual([{ id: "p-rondra", anteil: 1 }]);
        expect(wetterGeltung(WETTER_PRESET_VORGABEN, 30)).toEqual([
            { id: "p-praios", anteil: 0.5 },
            { id: "p-rondra", anteil: 0.5 },
        ]);
        const wechsel = wetterGeltung(WETTER_PRESET_VORGABEN, 2);
        expect(wechsel.map((teil) => teil.id)).toEqual(["p-namenlos", "p-praios"]);
        expect(wechsel[0]!.anteil + wechsel[1]!.anteil).toBeCloseTo(1, 12);
        const mitte = wetterJahreswerte(WETTER_PRESET_VORGABEN, 30);
        const [a, b] = [WETTER_PRESET_VORGABEN[1]!.werte, WETTER_PRESET_VORGABEN[2]!.werte];
        for (const k of WETTER_JAHR_SPALTEN) expect(mitte[k]).toBeCloseTo((a[k] + b[k]) / 2, 9);
        expect(wetterJahreswerte(WETTER_PRESET_VORGABEN, null)).toEqual(WETTER_UNBESTIMMT);
    });

    it("ein verschobenes Preset gilt an seinem neuen Tag", () => {
        const verschoben = WETTER_PRESET_VORGABEN.map((preset) =>
            preset.id === "p-u" ? { ...preset, tag: 100 } : preset.id === "p-boron" ? { ...preset, tag: null } : preset,
        );
        expect(wetterGeltung(verschoben, null)).toEqual([{ id: "p-boron", anteil: 1 }]);
        expect(wetterGeltung(verschoben, 100)).toEqual([{ id: "p-u", anteil: 1 }]);
    });
});

describe("Wettermodell", () => {
    it("🔴 Kennungen eindeutig, Vorgaben in ihren Grenzen, Paare in Reihenfolge", () => {
        const ids = WETTERMODELL_WERTE.map((wert) => wert.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const wert of WETTERMODELL_WERTE) {
            expect(wert.id).toMatch(new RegExp(WETTERMODELL_ID_MUSTER, "u"));
            expect(wettermodellImRahmen(wert, wert.vorgabe), wert.id).toBe(true);
        }
        expect(wettermodellPaarFehler(wettermodellVorgaben())).toBeUndefined();
        expect(wettermodellPaarFehler({ ...wettermodellVorgaben(), nahVoll: 90 })).toEqual({
            kleiner: "nahVoll",
            groesser: "nahAb",
        });
    });

    it("wirksam: Unbekanntes und Werte außerhalb der Grenzen fallen weg, die Auswahl gilt genau", () => {
        const werte = wettermodellWirksam({ conf: 2, tempo: 99, erfunden: 1, res: 0.5, steps: Number.NaN });
        expect(werte).toMatchObject({ conf: 2, tempo: 0.1, res: 0.5, steps: 56 });
        expect(werte).not.toHaveProperty("erfunden");
        expect(wettermodellWirksam({ res: 0.6 })["res"]).toBe(0);
    });
});

describe("wetterDatenAus", () => {
    const antwort = (): WetterDatenAntwort => ({
        presets: WETTER_PRESET_VORGABEN.map((preset) => ({ ...preset, werte: { ...preset.werte }, revision: 0 })),
        symbole: WETTER_SYMBOL_VORGABEN.map((symbol) => ({ ...symbol, revision: 0 })),
        modell: { revision: 1, werte: { ...wettermodellVorgaben(), conf: 2 }, verstellt: ["conf"] },
        quelle: { presets: "vorgabe", symbole: "vorgabe", modell: "gespeichert" },
    });

    it("🔴 ohne lesbare Antwort gelten die Vorgaben", () => {
        for (const body of [undefined, null, "kaputt", [], { presets: 1 }]) {
            const daten = wetterDatenAus(body);
            expect(daten.nurVorgaben).toBe(true);
            expect(daten.presets).toBe(WETTER_PRESET_VORGABEN);
        }
    });

    it("eine stimmige Antwort kommt so an, wie sie ist", () => {
        const daten = wetterDatenAus(antwort());
        expect(daten.nurVorgaben).toBe(false);
        expect(daten.presets.map((preset) => preset.tag)).toEqual(WETTER_PRESET_VORGABEN.map((preset) => preset.tag));
        expect(daten.symbole).toHaveLength(13);
        expect(daten.modell["conf"]).toBe(2);
    });

    it("der Wiki-Verweis eines Icons reist mit (WI-0288 Infopanel), ohne Verweis fehlt das Feld", () => {
        const body = antwort();
        body.symbole[0] = { ...body.symbole[0]!, wikiTitel: "Probewind (Wind)" };
        body.symbole[1] = { ...body.symbole[1]!, wikiTitel: null };
        const daten = wetterDatenAus(body);
        expect(daten.symbole[0]!.wikiTitel).toBe("Probewind (Wind)");
        expect(daten.symbole[1]).not.toHaveProperty("wikiTitel");
        expect(daten.symbole[2]).not.toHaveProperty("wikiTitel");
    });

    it("🔴 Unsinn fällt einzeln auf die Vorgabe zurück; ein doppelter Tag nimmt allen Presets ihre gelieferten Tage", () => {
        const body = antwort();
        body.presets[1]!.werte["tn"] = 999;
        body.symbole[0] = { ...body.symbole[0]!, richtung: null };
        const daten = wetterDatenAus(body);
        expect(daten.presets[1]!.werte.tn).toBe(WETTER_PRESET_VORGABEN[1]!.werte.tn);
        expect(daten.symbole).toHaveLength(12);

        const doppelt = antwort();
        doppelt.presets[1]!.tag = 45;
        doppelt.presets[1]!.werte["tn"] = 3;
        const gelesen = wetterDatenAus(doppelt);
        expect(gelesen.presets[1]!.tag).toBe(15);
        expect(gelesen.presets[1]!.werte.tn).toBe(3);
    });
});

describe("angelegte Presets (Betreiber 2026-11-08)", () => {
    const antwort = (): WetterDatenAntwort => ({
        presets: WETTER_PRESET_VORGABEN.map((preset) => ({ ...preset, werte: { ...preset.werte }, revision: 0 })),
        symbole: [],
        modell: { revision: 1, werte: {}, verstellt: [] },
        quelle: { presets: "gespeichert", symbole: "vorgabe", modell: "vorgabe" },
    });
    const angelegt = (id: string, tag: number | null) => ({
        id,
        tag,
        werte: { ...wetterNeuePresetWerte(WETTER_PRESET_VORGABEN, tag ?? 345) },
        revision: 1,
    });

    it("🔴 Leser: angelegte Presets stehen nach den 14, nach Tag; ein belegter Tag, eine fremde Kennung und ein ungültiger Tag lassen nur sie wegfallen", () => {
        const body = antwort();
        body.presets.push(
            angelegt("p-zzzzzzzz", 200),
            angelegt("p-aaaaaaaa", 100),
            angelegt("p-doppelt", 100),
            angelegt("p-aufdrei", 15),
            angelegt("p-1", 77),
            { ...angelegt("p-schlecht", 80), tag: 400 },
            { ...angelegt("x-fremd", 90) },
        );
        const daten = wetterDatenAus(body);
        expect(daten.presets.slice(0, 14).map((p) => p.id)).toEqual(WETTER_PRESET_VORGABEN.map((p) => p.id));
        expect(daten.presets.slice(14).map((p) => [p.id, p.tag])).toEqual([
            ["p-aaaaaaaa", 100],
            ["p-zzzzzzzz", 200],
        ]);
        // Die 14 bleiben dabei, wie geliefert.
        expect(daten.presets.slice(0, 14).map((p) => p.tag)).toEqual(WETTER_PRESET_VORGABEN.map((p) => p.tag));
    });

    it("🔴 Leser: ein Wert außerhalb der Grenzen nimmt die Überblendung der 14 am Tag an", () => {
        const body = antwort();
        body.presets.push(angelegt("p-aaaaaaaa", 100));
        body.presets[14]!.werte["tn"] = 999;
        const daten = wetterDatenAus(body);
        expect(daten.presets[14]!.werte.tn).toBe(wetterJahreswerte(WETTER_PRESET_VORGABEN, 100).tn);
    });

    it("🔴 Leser: ein angelegtes Preset darf das unbestimmte sein; die 14 tragen dann einen Tag mehr und werden nicht zurückgesetzt", () => {
        const body = antwort();
        body.presets.push(angelegt("p-aaaaaaaa", null));
        body.presets.find((p) => p.id === "p-u")!.tag = 100;
        const daten = wetterDatenAus(body);
        expect(daten.presets.find((p) => p.id === "p-u")!.tag).toBe(100);
        expect(daten.presets.find((p) => p.id === "p-aaaaaaaa")!.tag).toBeNull();
        expect(daten.presets).toHaveLength(15);
    });

    it("Leser: ein zweites unbestimmtes angelegtes fällt weg, solange eines der 14 unbestimmt ist", () => {
        const body = antwort();
        body.presets.push(angelegt("p-aaaaaaaa", null));
        const daten = wetterDatenAus(body);
        expect(daten.presets).toHaveLength(14);
    });

    it("wetterFreierTag: der Wunsch, wenn frei, sonst die Mitte der größten Lücke (zyklisch)", () => {
        expect(wetterFreierTag(WETTER_PRESET_VORGABEN, 100)).toBe(100);
        // 15 ist belegt: die erste größte Lücke (15 bis 45) hat ihre Mitte am 30.
        expect(wetterFreierTag(WETTER_PRESET_VORGABEN, 15)).toBe(30);
        expect(wetterFreierTag(WETTER_PRESET_VORGABEN, null)).toBe(30);
        // Eine einzige Lücke über den Jahreswechsel: 10 und 20 gehalten, die große Lücke 20 bis 10 (355 Tage) liegt um 197 herum.
        const zwei = [{ tag: 10 }, { tag: 20 }];
        expect(wetterFreierTag(zwei, 10)).toBe(((20 + Math.floor(355 / 2) - 1) % 365) + 1);
        // Die größte Lücke liegt zwischen 50 und 300 (250 Tage), ihre Mitte am 175.
        const rand = [{ tag: 10 }, { tag: 20 }, { tag: 30 }, { tag: 40 }, { tag: 50 }, { tag: 300 }];
        const mitte = wetterFreierTag(rand, 10)!;
        expect(rand.some((p) => p.tag === mitte)).toBe(false);
        expect(mitte).toBe(((50 + Math.floor(250 / 2) - 1) % 365) + 1);
        // Das unbestimmte hält keinen Tag; alle Tage belegt: keiner frei.
        expect(wetterFreierTag([{ tag: null }], 5)).toBe(5);
        expect(
            wetterFreierTag(
                Array.from({ length: 365 }, (_, i) => ({ tag: i + 1 })),
                5,
            ),
        ).toBeNull();
    });

    it("wetterNeuePresetWerte: die Überblendung am Tag, auf vier Stellen gerundet, in den Grenzen", () => {
        const werte = wetterNeuePresetWerte(WETTER_PRESET_VORGABEN, 100);
        for (const k of WETTER_JAHR_SPALTEN) {
            expect(Math.round(werte[k] * 10000) / 10000).toBe(werte[k]);
            expect(
                wetterJahrImRahmen(
                    WETTER_JAHR_WERTE.find((w) => w.id === k)!,
                    werte[k],
                ),
            ).toBe(true);
        }
        // Am Tag eines festen Presets sind es dessen Werte.
        expect(wetterNeuePresetWerte(WETTER_PRESET_VORGABEN, 15)).toEqual(WETTER_PRESET_VORGABEN[1]!.werte);
        expect(istAngelegtePresetId("p-aaaaaaaa")).toBe(true);
        expect(istAngelegtePresetId("p-praios")).toBe(false);
        expect(istAngelegtePresetId("q-aaaaaaaa")).toBe(false);
    });
});
