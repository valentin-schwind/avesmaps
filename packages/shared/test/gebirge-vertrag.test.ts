import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    GEBIRGS_PRESETS_VORGABE,
    GEBIRGS_WERT_GRENZEN,
    GEBIRGS_WERTE,
    GEBIRGS_ZURUECK,
    GEBIRGSTYPEN,
    GebirgsAenderung,
    GebirgsPresetGruppeSchema,
    gebirgsRegler,
} from "../src/index.ts";

// Die Folge, in der `apps/server/src/terrain/inputs.ts` die Regler bis WI-0226 einzeln schrieb (`set("koernung", …)` …).
const ALTE_FOLGE = [
    "koernung",
    "stufen",
    "erosion",
    "plateau",
    "hypsometrie",
    "maximalhoehe",
    "bergform",
    "rauschen",
    "sattel",
    "talbreite",
    "einschnitt",
];

describe("gebirgsRegler (WI-0226)", () => {
    it("ohne Typ: dieselben Schlüssel in derselben Folge wie bisher, ohne Muster (Fingerabdruck der Saaten bleibt)", () => {
        const werte = {
            koernung: 14,
            stufen: 3,
            erosion: 3,
            plateau: 0.9,
            hypsometrie: 0.45,
            bergform: 2,
            rauschen: 0.25,
            sattel: 1,
            talbreite: 1.6,
            einschnitt: 550,
        };
        const regler = gebirgsRegler(null, { werte, muster: null, kammhoehe: 4000 }, 1000);
        expect(Object.keys(regler)).toEqual(ALTE_FOLGE);
        expect(JSON.stringify(regler)).toBe(
            JSON.stringify({
                koernung: 14,
                stufen: 3,
                erosion: 3,
                plateau: 0.9,
                hypsometrie: 0.45,
                maximalhoehe: 4000,
                bergform: 2,
                rauschen: 0.25,
                sattel: 1,
                talbreite: 1.6,
                einschnitt: 550,
            }),
        );
    });

    it("ohne Typ und ohne Werte: nur die Grundhöhe, wie bei einem nie angefassten Gebirge", () => {
        expect(gebirgsRegler(null, { werte: {}, muster: null, kammhoehe: null }, 1500)).toEqual({ maximalhoehe: 1500 });
        expect(gebirgsRegler(null, { werte: {}, muster: null, kammhoehe: null }, null)).toEqual({});
    });

    it("mit Typ: die Werte des Presets, die Abweichung gewinnt, Zellen nur bei „zellen“", () => {
        const masse = GEBIRGS_PRESETS_VORGABE.typen.massengebirge;
        const regler = gebirgsRegler(masse, { werte: { koernung: 40 }, muster: null, kammhoehe: null }, 1000);
        expect(regler.koernung).toBe(40);
        expect(regler.plateau).toBe(masse.werte.plateau);
        expect(regler.maximalhoehe).toBe(1000);
        expect(regler.muster).toBe("zellen");
        expect(Object.keys(regler)).toEqual([...ALTE_FOLGE, "muster"]);
        // Ein eigenes „rauschen“ am Zellen-Preset nimmt das Muster heraus.
        expect(gebirgsRegler(masse, { werte: {}, muster: "rauschen", kammhoehe: 2500 }, 1000)).not.toHaveProperty(
            "muster",
        );
        expect(
            gebirgsRegler(GEBIRGS_PRESETS_VORGABE.typen.karst, { werte: {}, muster: null, kammhoehe: null }, 1000),
        ).not.toHaveProperty("muster");
    });
});

describe("Vorgabe der Presets (WI-0226)", () => {
    it("passt zum Schema der Fassungsgruppe und hat jeden Typ", () => {
        expect(Value.Check(GebirgsPresetGruppeSchema, GEBIRGS_PRESETS_VORGABE)).toBe(true);
        expect(Object.keys(GEBIRGS_PRESETS_VORGABE.typen)).toEqual([...GEBIRGSTYPEN]);
    });

    it("jeder Wert liegt in den Grenzen der Regler", () => {
        for (const [typ, preset] of Object.entries(GEBIRGS_PRESETS_VORGABE.typen)) {
            for (const k of GEBIRGS_WERTE) {
                const { min, max } = GEBIRGS_WERT_GRENZEN[k];
                expect(preset.werte[k], `${typ}.${k}`).toBeGreaterThanOrEqual(min);
                expect(preset.werte[k], `${typ}.${k}`).toBeLessThanOrEqual(max);
            }
        }
    });

    it("Bergland und Massengebirge rechnen mit Zellen, Karst bleibt Legacys Karst", () => {
        expect(GEBIRGS_PRESETS_VORGABE.typen.bergland.muster).toBe("zellen");
        expect(GEBIRGS_PRESETS_VORGABE.typen.massengebirge.muster).toBe("zellen");
        expect(GEBIRGS_PRESETS_VORGABE.typen.karst).toEqual({
            werte: {
                hypsometrie: 0,
                plateau: 0.85,
                rauschen: 0.94,
                einschnitt: 1925,
                erosion: 4,
                talbreite: 3.8,
                koernung: 18,
                stufen: 3,
                bergform: 10.5,
                sattel: 0.33,
            },
            muster: "rauschen",
        });
    });
});

describe("GebirgsAenderung (WI-0226)", () => {
    it("nimmt Zahl der Erhebungen bis 100 und ↺ als Liste `zurueck`, lehnt Werte außerhalb und Fremdes ab", () => {
        expect(Value.Check(GebirgsAenderung, { werte: { koernung: 100 } })).toBe(true);
        expect(
            Value.Check(GebirgsAenderung, {
                typ: "bergland",
                kammhoehe: 3200,
                zurueck: ["muster", "koernung"],
            }),
        ).toBe(true);
        expect(Value.Check(GebirgsAenderung, { werte: { koernung: 101 } })).toBe(false);
        expect(Value.Check(GebirgsAenderung, { kammhoehe: 20001 })).toBe(false);
        expect(Value.Check(GebirgsAenderung, { typ: "vulkan" })).toBe(false);
        expect(Value.Check(GebirgsAenderung, { werte: { maximalhoehe: 1 } })).toBe(false);
        expect(Value.Check(GebirgsAenderung, { zurueck: ["maximalhoehe"] })).toBe(false);
        expect(Value.Check(GebirgsAenderung, { zurueck: ["typ", "typ"] })).toBe(false);
    });

    it("🪤 kein null in den Feldern: ↺ geht nur über `zurueck` (Fastifys ajv machte aus null eine 0)", () => {
        expect(Value.Check(GebirgsAenderung, { kammhoehe: null })).toBe(false);
        expect(Value.Check(GebirgsAenderung, { werte: { koernung: null } })).toBe(false);
        expect(Value.Check(GebirgsAenderung, { typ: null })).toBe(false);
        expect(Value.Check(GebirgsAenderung, { muster: null })).toBe(false);
        expect([...GEBIRGS_ZURUECK]).toEqual(["typ", "muster", "kammhoehe", ...GEBIRGS_WERTE]);
    });
});
