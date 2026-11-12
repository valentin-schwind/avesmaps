import { describe, expect, it } from "vitest";
import {
    GEBIRGS_PRESETS_VORGABE,
    GEBIRGS_WERTE,
    GEBIRGSTYPEN,
    HOEHENMODELL_REGLER,
    RUECKENNETZ_TYPWERTE,
    type HoehenmodellTest,
} from "@avesmaps3d/shared";
import {
    DURCHHANG_NEBEN_FAKTOR,
    REGLER,
    REGLER_BEREICHE,
    REGLER_FOLGE,
    REGLER_IDS,
    reglerAbweichungen,
    reglerHinweise,
    reglerProblem,
    reglerSchluessel,
    reglerSchreibt,
    reglerTippt,
    reglerWert,
    reglerZeile,
    reglerZurueck,
    type ReglerDef,
} from "../src/auth/hoehenmodell-regler.ts";
import { flach, neu, problem, satz, type Tafel } from "../src/auth/hoehenmodell-test.ts";
import { formParameter, mitWerten, vorschauFuerRegler, vorschauFuerWert } from "../src/auth/hoehenmodell-vorschau.ts";
import { LOCALES, locale, t, type MessageKey } from "../src/i18n/i18n.ts";

/**
 * Die dreizehn Regler der Gebirgs-Presets von „19 (Test)“ ohne Browser (WI-0249 P8).
 *
 * Problemfälle: Ein Regler schreibt ein Feld, das es gar nicht gibt oder das der Server später ablehnt (Grenzen); die Abbildung eines
 * zusammenfassenden Reglers ist nicht umkehrbar (Zug und Lesen widersprechen sich); das bloße Anfassen überschreibt Einzelwerte, obwohl der
 * Reglerwert gleich blieb; ein Regler oder ein Wert der Liste „Alle Werte“ hat kein Schema oder in einer Sprache keinen Satz.
 */

const REGLER_WERTE = HOEHENMODELL_REGLER.reduce<Record<string, number | null>>(
    (aus, r) => ({ ...aus, [r.id]: null }),
    {},
);
const VORGABE = GEBIRGS_PRESETS_VORGABE;

function testVon(patch: Partial<HoehenmodellTest> = {}): HoehenmodellTest {
    return {
        version: 19,
        name: "Fassung 19 (Test)",
        werte: {},
        revision: 0,
        gerechnet: 0,
        geaendertAm: null,
        wer: null,
        grund: null,
        gesperrt: false,
        regler: REGLER_WERTE,
        reglerDatei: REGLER_WERTE,
        rezept: {},
        rezeptDatei: {},
        technik: {},
        presets: VORGABE,
        presetsDatei: VORGABE,
        verlauf: [],
        ...patch,
    } as HoehenmodellTest;
}

const tafelVorgabe = (): Tafel => flach(REGLER_WERTE, VORGABE);
const ZAHLEN = REGLER_IDS.map((id) => REGLER[id]).filter((def) => def.art === "zahl");

describe("die Folge der Regler", () => {
    it("🔴 drei Bereiche, dreizehn Regler, jeder einmal", () => {
        expect(REGLER_BEREICHE).toEqual(["form", "rinnen", "gelaende"]);
        expect(REGLER_IDS).toHaveLength(13);
        expect(new Set(REGLER_IDS).size).toBe(13);
        expect(REGLER_FOLGE.form).toHaveLength(10);
        expect(REGLER_FOLGE.rinnen).toEqual(["rinnen", "taleinschnitt"]);
        expect(REGLER_FOLGE.gelaende).toEqual(["gelaendeErosion"]);
        for (const bereich of REGLER_BEREICHE)
            for (const id of REGLER_FOLGE[bereich]) expect(REGLER[id].bereich).toBe(bereich);
    });

    it("🔴 jeder Regler schreibt nur Felder der Tafel, für jeden der elf Typen", () => {
        const tafel = tafelVorgabe();
        for (const typ of GEBIRGSTYPEN)
            for (const def of Object.values(REGLER))
                for (const key of reglerSchluessel(def, typ))
                    expect(tafel.has(key), `${typ} · ${def.id} · ${key}`).toBe(true);
    });
});

describe("die Abbildung: Zug und Lesen sind umkehrbar", () => {
    it("🔴 Massigkeit: Hypsometrie 0,15 + 0,25 · M, Talboden 0,85 · M, Ziel wie die Hypsometrie", () => {
        const def = REGLER.massigkeit;
        expect(reglerSchreibt(def, 0, "kammgebirge")).toEqual({
            "p:kammgebirge:hypsometrie": 0.15,
            "n:kammgebirge:form.talboden": 0,
            "n:kammgebirge:band.ziel": 0.15,
        });
        expect(reglerSchreibt(def, 1, "kammgebirge")).toEqual({
            "p:kammgebirge:hypsometrie": 0.4,
            "n:kammgebirge:form.talboden": 0.85,
            "n:kammgebirge:band.ziel": 0.4,
        });
        const halb = reglerSchreibt(def, 0.5, "plateaugebirge");
        expect(halb["n:plateaugebirge:form.talboden"]).toBe(0.425);
        expect(halb["p:plateaugebirge:hypsometrie"]).toBe(0.275);
    });

    it("Massigkeit liest aus der Hypsometrie: darüber bleibt es bei 1, darunter bei 0", () => {
        const def = REGLER.massigkeit;
        const lies = (h: number): number => reglerWert(def, new Map([["p:kammgebirge:hypsometrie", h]]), "kammgebirge");
        expect(lies(0.15)).toBe(0);
        expect(lies(0.4)).toBe(1);
        expect(lies(0.7)).toBe(1);
        expect(lies(0)).toBe(0);
        expect(lies(0.275)).toBeCloseTo(0.5, 2);
    });

    it("🔴 jeder Zahlenregler: was er schreibt, liest er wieder, über den ganzen Zug und in jedem Typ", () => {
        for (const typ of ["kammgebirge", "plateaugebirge", "bergland"] as const)
            for (const def of ZAHLEN) {
                const { min, max } = def.zug;
                for (const anteil of [0, 0.25, 0.5, 0.75, 1]) {
                    const wert = Math.round((min + (max - min) * anteil) / def.zug.schritt) * def.zug.schritt;
                    const tafel = mitWerten(tafelVorgabe(), reglerSchreibt(def, wert, typ));
                    expect(reglerWert(def, tafel, typ), `${typ} · ${def.id} · ${String(wert)}`).toBeCloseTo(wert, 1);
                }
            }
    });

    it("🔴 was ein Regler schreibt, nimmt die Prüfung der Felder an (Grenzen des Servers)", () => {
        const tafel = tafelVorgabe();
        for (const typ of GEBIRGSTYPEN)
            for (const def of ZAHLEN) {
                for (const wert of [def.zug.min, (def.zug.min + def.zug.max) / 2, def.zug.max]) {
                    // Ausgang: der Regler steht am anderen Ende, sonst gleicht der getippte Wert dem alten und nichts wird geschrieben.
                    const andere = wert === def.zug.min ? def.zug.max : def.zug.min;
                    const ausgang = mitWerten(tafel, reglerSchreibt(def, andere, typ));
                    const felder = reglerTippt(def, ausgang, typ, String(wert).replace(".", ","));
                    expect(Object.keys(felder).length, `${typ} · ${def.id} · ${String(wert)}`).toBeGreaterThan(0);
                    for (const [key, text] of Object.entries(felder))
                        expect(problem(key, text), `${typ} · ${def.id} · ${key} = ${text}`).toBeUndefined();
                }
            }
    });

    it("Kammschärfe, Unruhe und Rinnen setzen den Wert des Rückennetzes gleich dem der V12", () => {
        const w = reglerSchreibt(REGLER.kammschaerfe, 0.35, "kuppengebirge");
        expect(w).toEqual({ "p:kuppengebirge:plateau": 0.35, "n:kuppengebirge:form.schaerfe": 0.35 });
        expect(reglerSchreibt(REGLER.unruhe, 0.3, "bergland")).toEqual({
            "p:bergland:rauschen": 0.3,
            "n:bergland:form.rauschen": 0.3,
        });
        // Der Typwert hört bei 0,5 auf; die V12 geht bis 1.
        expect(reglerSchreibt(REGLER.unruhe, 0.94, "karst")["n:karst:form.rauschen"]).toBe(0.5);
        expect(reglerSchreibt(REGLER.rinnen, 4, "karst")).toEqual({ "p:karst:erosion": 4, "n:karst:form.erosion": 4 });
    });

    it("Durchhang: Nebenkämme hängen ein Drittel stärker durch, so stehen die Presets der Fassung 19", () => {
        expect(DURCHHANG_NEBEN_FAKTOR).toBeCloseTo(4 / 3, 6);
        const w = reglerSchreibt(REGLER.durchhang, 0.12, "kammgebirge");
        expect(w["n:kammgebirge:form.durchhang"]).toBe(0.12);
        expect(w["n:kammgebirge:form.durchhangNeben"]).toBe(0.16);
    });

    it("Höhe und Steilheit der Nebengipfel sind zwei Regler mit je einem Feld", () => {
        expect(reglerSchreibt(REGLER.prominenz, 0.1, "kammgebirge")).toEqual({ "n:kammgebirge:form.kopf": 0.1 });
        expect(reglerSchreibt(REGLER.neigung, 0.08, "kammgebirge")).toEqual({ "n:kammgebirge:form.kopfNeigung": 0.08 });
    });

    it("Taleinschnitt schreibt Tiefe und halbe Breite zusammen", () => {
        const w = reglerSchreibt(REGLER.taleinschnitt, 550, "kammgebirge");
        expect(w["p:kammgebirge:einschnitt"]).toBe(550);
        expect(w["p:kammgebirge:talbreite"]).toBeCloseTo(1.6, 1);
        expect(reglerSchreibt(REGLER.taleinschnitt, 1925, "karst")["p:karst:talbreite"]).toBeCloseTo(3.8, 1);
    });

    it("das Grundmuster schreibt seinen Namen", () => {
        expect(reglerSchreibt(REGLER.muster, 1, "bergland")).toEqual({ "m:bergland": "zellen" });
        expect(reglerSchreibt(REGLER.muster, 0, "bergland")).toEqual({ "m:bergland": "rauschen" });
        expect(reglerWert(REGLER.muster, new Map([["m:bergland", "zellen"]]), "bergland")).toBe(1);
    });
});

describe("Einzelwerte, die anders stehen", () => {
    it("🔴 die Presets der Fassung 19: Massigkeit meldet Talboden und Ziel, wo sie vom Regler abweichen", () => {
        const tafel = tafelVorgabe();
        const kamm = reglerAbweichungen(REGLER.massigkeit, tafel, "kammgebirge");
        expect(kamm.map((a) => a.key)).toContain("n:kammgebirge:form.talboden");
        // Kamm: Hypsometrie 0,45 liegt über dem Bereich, der Regler steht auf 1 (Talboden 0,85, das Preset führt 0,3).
        expect(kamm.find((a) => a.key.endsWith("form.talboden"))).toMatchObject({ soll: 0.85 });
    });

    it("Kuppengebirge: die Schärfe des Rückennetzes (0,05) wird heute vom Wert der V12 (1) übersteuert; der Regler meldet es", () => {
        const a = reglerAbweichungen(REGLER.kammschaerfe, tafelVorgabe(), "kuppengebirge");
        expect(a).toHaveLength(1);
        expect(a[0]).toMatchObject({ key: "n:kuppengebirge:form.schaerfe", ist: 0.05, soll: 1 });
    });

    it("ein Regler ohne Begleiter meldet nichts", () => {
        expect(reglerAbweichungen(REGLER.rueckenbreite, tafelVorgabe(), "kammgebirge")).toEqual([]);
        expect(reglerAbweichungen(REGLER.gelaendeErosion, tafelVorgabe(), "kammgebirge")).toEqual([]);
    });

    it("🔴 die Hinweise: wo er wirkt; der Vorschlag nur bei den Reglern, die V12 und Rückennetz gleichsetzen", () => {
        const tafel = tafelVorgabe();
        const art = (def: ReglerDef) => reglerHinweise(def, tafel, "kuppengebirge").map((h) => h.art);
        expect(art(REGLER.rueckenbreite)).toEqual(["wirkt"]);
        expect(art(REGLER.kammschaerfe)).toEqual(["wirkt", "vorschlag", "abweichung"]);
        expect(art(REGLER.unruhe)).toContain("vorschlag");
        expect(art(REGLER.rinnen)).toContain("vorschlag");
        expect(art(REGLER.massigkeit)).toContain("vorschlag");
        expect(art(REGLER.durchhang)).not.toContain("vorschlag");
        const text = reglerHinweise(REGLER.kammschaerfe, tafel, "kuppengebirge").find(
            (h) => h.art === "abweichung",
        )!.text;
        expect(text).toContain("0,05");
        expect(text).toContain("(Regler: 1)");
    });
});

describe("Tippen und Zurücknehmen", () => {
    it("🔴 derselbe Wert schreibt nichts: Das bloße Anfassen überschreibt keine Einzelwerte", () => {
        const tafel = tafelVorgabe();
        expect(reglerTippt(REGLER.kammschaerfe, tafel, "kuppengebirge", "1")).toEqual({});
        expect(reglerTippt(REGLER.kammschaerfe, tafel, "kuppengebirge", "1,0")).toEqual({});
        expect(Object.keys(reglerTippt(REGLER.kammschaerfe, tafel, "kuppengebirge", "0,5"))).toEqual([
            "p:kuppengebirge:plateau",
            "n:kuppengebirge:form.schaerfe",
        ]);
    });

    it("ein ungültiger Text schreibt nichts, mit Grund", () => {
        const tafel = tafelVorgabe();
        expect(reglerTippt(REGLER.unruhe, tafel, "karst", "abc")).toEqual({});
        expect(reglerTippt(REGLER.unruhe, tafel, "karst", "1,5")).toEqual({});
        expect(reglerProblem(REGLER.unruhe, "abc")).toBeDefined();
        expect(reglerProblem(REGLER.unruhe, "1,5")).toContain("0");
        expect(reglerProblem(REGLER.unruhe, "0,5")).toBeUndefined();
    });

    it("🔴 die Zeile: geändert, abweichend und ↺ gelten für alle Felder des Reglers zusammen", () => {
        const test = testVon();
        const ohne = reglerZeile(test, {}, REGLER.massigkeit, "kammgebirge", undefined);
        expect(ohne.geaendert).toBe(false);
        expect(ohne.ruecksetzbar).toBe(false);
        expect(ohne.key).toBe("regler:massigkeit");
        const felder = reglerTippt(REGLER.massigkeit, tafelVorgabe(), "kammgebirge", "0,6");
        expect(Object.keys(felder)).toHaveLength(3);
        const mit = reglerZeile(test, felder, REGLER.massigkeit, "kammgebirge", "0,6");
        expect(mit.geaendert).toBe(true);
        expect(mit.abweichend).toBe(true);
        expect(mit.ruecksetzbar).toBe(true);
        expect(mit.feld).toBe("0,6");
        expect(mit.statt).toContain("1");
        // ↺ trägt die Datei in alle drei Felder ein.
        const zurueck = reglerZurueck(test, REGLER.massigkeit, "kammgebirge");
        expect(Object.keys(zurueck).sort()).toEqual(Object.keys(felder).sort());
        expect(zurueck["p:kammgebirge:hypsometrie"]).toBe("0,45");
        const danach = reglerZeile(test, zurueck, REGLER.massigkeit, "kammgebirge", undefined);
        expect(danach.abweichend).toBe(false);
    });

    it("ein ungültiger Text bleibt im Feld stehen, mit Problem; ein passender auch; ein fremder weicht dem Wert", () => {
        const test = testVon();
        expect(reglerZeile(test, {}, REGLER.unruhe, "karst", "abc")).toMatchObject({ feld: "abc" });
        expect(reglerZeile(test, {}, REGLER.unruhe, "karst", "abc").problem).toBeDefined();
        // Der Wert der Datei ist 0,94; ein getippter 0,5 gilt nur, wenn er auch geschrieben wurde.
        expect(reglerZeile(test, {}, REGLER.unruhe, "karst", "0,5").feld).toBe("0,94");
    });
});

describe("die Vorschauen der Regler und der einzelnen Werte", () => {
    const test = testVon();
    const tafel = neu(test, {});

    it("🔴 jeder Regler trägt eine Vorschau: Schema, Satz, Unterschriften; das Grundmuster ohne Schieber", () => {
        for (const typ of ["kammgebirge", "plateaugebirge", "karst"] as const)
            for (const def of Object.values(REGLER)) {
                const modell = vorschauFuerRegler(test, def, typ, tafel, def.id)!;
                expect(modell, `${typ} · ${def.id}`).not.toBeNull();
                const wert = modell.wert;
                expect(modell.satz!(wert).length, def.id).toBeGreaterThan(10);
                expect(modell.satz!(wert)).not.toContain("{");
                expect(modell.schema(wert).linie.startsWith("M")).toBe(true);
                expect(
                    t(`admin.terrain.test.vorschau.schema.${modell.unterschrift.schema}` as MessageKey),
                ).not.toContain("admin.terrain");
                if (modell.unterschrift.vorher !== null)
                    expect(
                        t(`admin.terrain.test.vorschau.vorher.${modell.unterschrift.vorher}` as MessageKey),
                    ).not.toContain("admin.terrain");
                expect(modell.zug === null).toBe(def.art === "muster");
            }
    });

    it("🔴 jeder einzelne Wert der Liste „Alle Werte“ hat einen Satz in Alltagssprache, in allen neun Sprachen, und bis auf einen ein Schema", () => {
        const keys = [
            ...GEBIRGS_WERTE.map((w) => `p:kammgebirge:${w}`),
            ...RUECKENNETZ_TYPWERTE.map(({ id }) => `n:kammgebirge:${id}`),
        ];
        expect(keys).toHaveLength(31);
        for (const sprache of LOCALES) {
            locale.value = sprache;
            for (const key of keys) {
                const text = satz(key);
                expect(text, `${sprache} · ${key}`).not.toContain("admin.terrain.test.wert");
                expect(text.length, `${sprache} · ${key}`).toBeGreaterThan(20);
            }
        }
        locale.value = "de";
        const ohneSchema: string[] = [];
        for (const key of keys) {
            const modell = vorschauFuerWert(test, key, "kammgebirge", tafel, key);
            if (modell === null) ohneSchema.push(key);
            else {
                expect(modell.schema(modell.wert).linie.startsWith("M"), key).toBe(true);
                expect(modell.zug, key).not.toBeNull();
            }
        }
        // Nur die Mindestschärfe des Grats gehört zur Suche des Talbodens und lässt sich nicht zeichnen.
        expect(ohneSchema).toEqual(["n:kammgebirge:gratMin"]);
    });

    it("jeder Wert hat in jeder Sprache seine Unterschriften (nichts bleibt als Schlüssel stehen)", () => {
        const keys = [
            ...GEBIRGS_WERTE.map((w) => `p:kammgebirge:${w}`),
            ...RUECKENNETZ_TYPWERTE.map(({ id }) => `n:kammgebirge:${id}`),
            "r:diffusion",
            "w:topographie.huegelland.landform.hills.radiusAtMinimum",
            "w:topographie.huegelland.landform.hills.heightExponent",
        ];
        const hier = mitWerten(tafel, {
            "r:diffusion": 0.005,
            "w:topographie.huegelland.landform.minimum": 80,
            "w:topographie.huegelland.landform.maximum": 320,
            "w:topographie.huegelland.landform.wavelength": 0.9,
            "w:topographie.huegelland.landform.hills.attempts": 3,
            "w:topographie.huegelland.landform.hills.radiusAtMinimum": 0.5,
            "w:topographie.huegelland.landform.hills.heightExponent": 1.5,
            "w:topographie.huegelland.landform.hills.overlapPower": 4,
        });
        for (const sprache of LOCALES) {
            locale.value = sprache;
            for (const key of keys) {
                const modell = vorschauFuerWert(test, key, "kammgebirge", hier, key);
                if (modell === null) continue;
                const u = modell.unterschrift;
                expect(
                    t(`admin.terrain.test.vorschau.schema.${u.schema}` as MessageKey),
                    `${sprache} · ${key}`,
                ).not.toContain("admin.terrain");
                if (u.vorher !== null)
                    expect(
                        t(`admin.terrain.test.vorschau.vorher.${u.vorher}` as MessageKey),
                        `${sprache} · ${key}`,
                    ).not.toContain("admin.terrain");
                if (modell.satz !== null)
                    expect(modell.satz(modell.wert), `${sprache} · ${key}`).not.toContain("admin.terrain");
            }
        }
        locale.value = "de";
    });

    it("🔴 der Wert ändert das Schema: bei jedem Regler sieht die Linie mit einem anderen Wert anders aus", () => {
        // Mit Kopf: Ohne Höhe gibt es keinen Kopf, und die Steilheit änderte nichts.
        const mitKopf = mitWerten(tafel, { "n:kammgebirge:form.kopf": 0.1 });
        const linie = (id: keyof typeof REGLER, wert: number): string =>
            vorschauFuerRegler(test, REGLER[id], "kammgebirge", mitKopf, id)!.schema(wert).linie;
        for (const [id, a, b] of [
            ["massigkeit", 0, 1],
            ["kammschaerfe", 0, 1],
            ["rueckenbreite", 0.5, 3],
            ["gipfelform", 0, 8],
            ["unruhe", 0, 0.8],
            ["koernung", 5, 60],
            ["durchhang", 0, 0.3],
            ["prominenz", 0, 0.2],
            ["neigung", 0.02, 0.2],
            ["rinnen", 0, 5],
            ["taleinschnitt", 0, 1500],
            ["gelaendeErosion", 0, 1],
        ] as const)
            expect(linie(id, a), id).not.toBe(linie(id, b));
    });

    it("Muster: das Schema zeigt das gewählte Muster gegen das andere", () => {
        const modell = vorschauFuerRegler(test, REGLER.muster, "kammgebirge", tafel, "m")!;
        expect(modell.satz!(0)).not.toBe(modell.satz!(1));
        expect(modell.schema(0).linie).not.toBe(modell.schema(1).linie);
        // Gestrichelt steht das andere Muster.
        expect(modell.schema(0).vorher).not.toBeNull();
    });

    it("🔴 Höhe und Steilheit der Nebengipfel zeigen denselben Kopf: Jeder Regler verstellt seine Hälfte", () => {
        const mitKopf = mitWerten(tafel, { "n:kammgebirge:form.kopf": 0.1, "n:kammgebirge:form.kopfNeigung": 0.08 });
        const hoehe = vorschauFuerRegler(test, REGLER.prominenz, "kammgebirge", mitKopf, "h")!;
        const steil = vorschauFuerRegler(test, REGLER.neigung, "kammgebirge", mitKopf, "s")!;
        // Beide Zeichnungen sind bei den Werten der Tafel dieselbe Linie.
        expect(hoehe.schema(0.1).linie).toBe(steil.schema(0.08).linie);
        expect(hoehe.schema(0.2).linie).not.toBe(hoehe.schema(0.1).linie);
        expect(steil.schema(0.03).linie).not.toBe(steil.schema(0.08).linie);
        expect(steil.satz!(0.08)).toContain("1,25");
        // Ohne Höhe sagt die Steilheit, dass es keinen Kopf gibt.
        expect(vorschauFuerRegler(test, REGLER.neigung, "kammgebirge", tafel, "s")!.satz!(0.08)).toBe(
            t("admin.terrain.test.vorschau.satz.neigungKeinKopf"),
        );
    });

    it("die Sätze folgen dem Wert, und ein Wert ohne Wirkung sagt es", () => {
        const satzVon = (id: keyof typeof REGLER, wert: number, tafel2: Tafel = tafel): string =>
            vorschauFuerRegler(test, REGLER[id], "kammgebirge", tafel2, id)!.satz!(wert);
        expect(satzVon("massigkeit", 0)).toContain("0 %");
        expect(satzVon("massigkeit", 1)).toContain("85 %");
        expect(satzVon("kammschaerfe", 0)).not.toBe(satzVon("kammschaerfe", 1));
        const rund = mitWerten(tafel, { "p:kammgebirge:plateau": 0 });
        expect(satzVon("gipfelform", 5, rund)).toBe(t("admin.terrain.test.vorschau.satz.gipfelformRund"));
        expect(satzVon("gipfelform", 5)).not.toBe(t("admin.terrain.test.vorschau.satz.gipfelformRund"));
        const glatt = mitWerten(tafel, { "p:kammgebirge:rauschen": 0 });
        expect(satzVon("koernung", 20, glatt)).toBe(t("admin.terrain.test.vorschau.satz.koernungGlatt"));
        expect(satzVon("rinnen", 0)).toContain("0 Durchgänge");
        expect(satzVon("rinnen", 5)).toContain("360 Durchgänge");
        expect(satzVon("taleinschnitt", 1000)).toContain("1.000 Schritt");
    });

    it("die Form des Schemas liest die Tafel wie die Rechnung: Schärfe und Rauschen aus der V12, der Rest aus dem Rückennetz", () => {
        const p = formParameter(tafel, "kuppengebirge");
        // Kuppengebirge: Typwert 0,05, V12-Preset 1 – die Rechnung nimmt die 1.
        expect(p.schaerfe).toBe(1);
        expect(p.rauschen).toBe(0.3);
        expect(p.breite).toBe(1.6);
        expect(p.muster).toBe("rauschen");
        expect(formParameter(tafel, "bergland").muster).toBe("zellen");
    });
});
