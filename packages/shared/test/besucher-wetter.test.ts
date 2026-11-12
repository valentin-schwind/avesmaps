import { describe, expect, it } from "vitest";
import {
    wetterAufloesungKlasse,
    wetterBildrateKlasse,
    wetterDimension,
    wetterFehlerArt,
    wetterGpuFamilie,
    wetterSchalterKennung,
    wetterSpitzeKlasse,
    wetterStartKlasse,
    WETTER_DIMENSION_FORM,
} from "../src/index.ts";

/**
 * Die Klassen der Wetterstatistik (WI-0288): Korbgrenzen, Familien der Grafikkarte, Fehlerarten. Die Grenzen sind die des Betreibers
 * (seit 2026-11-08 fein: Bildrate in Zehnern `<10` … `110-120`, `120+`; Spitze in 10 ms `<10` … `90-100`, `100+`; Start in Sekunden
 * `<1s` … `9-10s`, dann `10-15s`, `15-20s`, `20-30s`, `30s+`).
 */
describe("Körbe", () => {
    it.each([
        [0, "u10"],
        [9.9, "u10"],
        [10, "10-20"],
        [29.9, "20-30"],
        [30, "30-40"],
        [45, "40-50"],
        [59.9, "50-60"],
        [60, "60-70"],
        [119.9, "110-120"],
        [120, "ab120"],
        [144, "ab120"],
        [Number.NaN, "u10"],
    ])("Bildrate %s fällt in %s", (fps, klasse) => {
        expect(wetterBildrateKlasse(fps)).toBe(klasse);
    });

    it.each([
        [8.3, "u10"],
        [16.7, "10-20"],
        [20, "20-30"],
        [33, "30-40"],
        [50, "50-60"],
        [99, "90-100"],
        [100, "ab100"],
    ])("Bildzeit-Spitze %s ms fällt in %s", (ms, klasse) => {
        expect(wetterSpitzeKlasse(ms)).toBe(klasse);
    });

    it.each([
        [999, "u1s"],
        [1999, "1-2s"],
        [2000, "2-3s"],
        [5000, "5-6s"],
        [9999, "9-10s"],
        [10000, "10-15s"],
        [20000, "20-30s"],
        [30000, "ab30s"],
    ])("Start nach %s ms fällt in %s", (ms, klasse) => {
        expect(wetterStartKlasse(ms)).toBe(klasse);
    });

    it("rundet die Wolkenauflösung auf ganze fünf Prozent", () => {
        expect(["0.25", "0.27", "0.23", "1", "0.02", "2"].map((n) => wetterAufloesungKlasse(Number(n)))).toEqual([
            "25",
            "25",
            "25",
            "100",
            "0",
            "100",
        ]);
    });
});

describe("Familie der Grafikkarte", () => {
    it.each([
        ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)", "nvidia"],
        ["ANGLE (AMD, AMD Radeon RX 6800 Direct3D11)", "amd"],
        ["ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)", "intel"],
        ["Apple M2", "apple"],
        ["Apple GPU", "apple"],
        ["Adreno (TM) 740", "adreno"],
        ["Mali-G78", "mali"],
        ["PowerVR Rogue GE8320", "powervr"],
        ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", "software"],
        ["llvmpipe (LLVM 15.0.7, 256 bits)", "software"],
        ["Microsoft Basic Render Driver", "software"],
        ["Vivante GC7000", "andere"],
        ["", "unbekannt"],
        ["   ", "unbekannt"],
    ])("%s ist %s", (name, familie) => {
        expect(wetterGpuFamilie(name)).toBe(familie);
    });

    it("🔴 Software schlägt die Marke: SwiftShader über Vulkan trägt keinen NVIDIA-Namen, aber ein Treibertext könnte ihn tragen", () => {
        expect(wetterGpuFamilie("SwiftShader on NVIDIA host")).toBe("software");
    });
});

describe("Fehlerart", () => {
    it.each([
        ["Diese Grafikkarte kann nicht in Gleitkomma-Puffer zeichnen.", "gleitkomma"],
        ["Bildpuffer der Wetterkopie unvollständig", "bildpuffer"],
        ["Shader: 0:12 syntax error", "shader"],
        ["Programm: Uniform u_x fehlt", "shader"],
        ["Geländekachel fehlt: 404", "kachel"],
        ["WebGL context lost", "webgl2"],
        ["etwas ganz anderes mit 12345 und https://example.org/geheim", "andere"],
    ])("%s ist %s", (text, art) => {
        expect(wetterFehlerArt(text)).toBe(art);
    });
});

describe("Ausprägung", () => {
    it("🔴 jede gebaute Ausprägung besteht die Form, die der Server prüft", () => {
        const gebaut = [
            wetterDimension("rechner"),
            wetterDimension("telefon", wetterBildrateKlasse(31)),
            wetterDimension("rechner", wetterSpitzeKlasse(120)),
            wetterDimension("telefon", wetterStartKlasse(7000)),
            wetterDimension("rechner", wetterAufloesungKlasse(0.27)),
            wetterDimension("rechner", wetterGpuFamilie("Adreno (TM) 740")),
            wetterDimension("telefon", wetterFehlerArt("Gleitkomma")),
        ];
        for (const dimension of gebaut) expect(WETTER_DIMENSION_FORM.test(dimension), dimension).toBe(true);
    });

    it("weist Fremdes ab", () => {
        for (const roh of ["", "tablet", "rechner:", "rechner:<15", "rechner:a:b", "rechner:NVIDIA GeForce", "x:30-45"])
            expect(WETTER_DIMENSION_FORM.test(roh), roh).toBe(false);
    });

    it("die Zählkennung eines Schalters hat die Form der übrigen", () => {
        expect(wetterSchalterKennung("wolken", true)).toBe("wetter_wolken:on");
        expect(wetterSchalterKennung("regenUndSchnee", false)).toBe("wetter_regenUndSchnee:off");
    });
});
