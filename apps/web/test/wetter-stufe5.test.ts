import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
    AVENTURIA_CARTOGRAPHY,
    AVENTURIA_TRAVEL_MODEL,
    WETTER_JAHR_SPALTEN,
    WETTER_PRESET_VORGABEN,
    WETTER_UNBESTIMMT_TAG,
    snowlineHeight,
    wetterJahreswerte,
    wetterKlimazonen,
    wetterKlimazonenWert,
    wetterReisetag,
    wetterSchneegrenzen,
    type MapView,
} from "@avesmaps3d/shared";
import { erzeugeJahreslauf, FOLGEN_TAGE, gleiteSchneegrenzen } from "../src/map/wetter/wetter-jahr.ts";
import { wetterDatum } from "../src/map/wetter/wetter-schalter.ts";
import { innen, seeHoehe, wasserRechtecke, wasserStaerke } from "../src/map/wasser/wasser-ebene.ts";
import { installWasser, wasserLaeuft } from "../src/map/wasser/wasser-schalter.ts";
import { klimawertBei, klimazoneBei, KLIMA_RASTER } from "../src/map/wetter/klimazonen.ts";
import { mitteSatz } from "../src/wettereditor/wetter-editor-modell.ts";
import type { WasserEbene } from "../src/map/wasser/wasser-ebene.ts";

/**
 * WI-0288 Stufe 5: Zeit, Wasser, Schneefallgrenze. Problemfälle: Das Wetter springt im Replay je Tag oder startet neu; über die Tage des
 * Namenlosen reißt das Datum ab; ohne Reisebeginn läuft trotzdem ein Datum; die Schneefallgrenze des Wetters weicht von der der Wegfindung
 * ab oder rutscht in eine falsche Zone; das Wasser lädt flach oder bleibt in 3D aus; ein See liegt auf Meereshöhe.
 */

describe("Datum des Wetters", () => {
    it("Reisebeginn plus vergangene Reisetage, als Tag im Jahr mit Bruchteil", () => {
        expect(wetterReisetag(15, 0)).toBe(15);
        expect(wetterReisetag(15, 2.25)).toBe(17.25);
        expect(wetterDatum({ month: "praios", day: 15 }, null)).toBe(15);
        expect(wetterDatum({ month: "efferd", day: 1 }, 10.5)).toBe(71.5);
    });

    it("🔴 über die Tage des Namenlosen hinweg zum 1. Praios, ohne Sprung", () => {
        expect(wetterDatum({ month: "rahja", day: 30 }, 1)).toBe(361);
        expect(wetterDatum({ month: "namenlos", day: 5 }, 0.5)).toBe(365.5);
        expect(wetterDatum({ month: "namenlos", day: 5 }, 1)).toBe(1);
        expect(wetterDatum({ month: "namenlos", day: 3 }, 365)).toBe(363);
        // Ein Jahr und ein Tag später ist es derselbe Tag des nächsten Jahres plus einer.
        expect(wetterReisetag(100, 366)).toBe(101);
    });

    it("ohne Reisebeginn unbestimmt, auch im Replay; Unsinn zählt als null Tage", () => {
        expect(wetterDatum(null, 12)).toBeNull();
        expect(wetterReisetag(null, 0)).toBeNull();
        expect(wetterReisetag(40, Number.NaN)).toBe(40);
        expect(wetterReisetag(40, -3)).toBe(40);
    });
});

/** Eine Engine zum Anfassen: nur, was der Jahreslauf braucht. */
function engine() {
    const cfg = Object.fromEntries(WETTER_JAHR_SPALTEN.map((k) => [k, 0])) as Record<string, number>;
    return {
        cfg,
        sg: new Float32Array(12).fill(-1),
        sonneGeaendert: vi.fn(),
        zeitraffer: vi.fn(),
    };
}

describe("Jahreslauf im Replay", () => {
    afterEach(() => vi.restoreAllMocks());

    const uhr = (): { stelle: (ms: number) => void } => {
        let jetzt = 1000;
        vi.spyOn(performance, "now").mockImplementation(() => jetzt);
        return { stelle: (ms) => void (jetzt = ms) };
    };

    it("🔴 kleine Schritte folgen sofort, ohne Überblendung und ohne Zeitraffer; ein Sprung gleitet und rafft", () => {
        const zeit = uhr();
        const w = engine();
        const datum = ref<number | null>(200);
        const lauf = erzeugeJahreslauf(
            w as never,
            () => datum.value,
            () => undefined,
            () => WETTER_PRESET_VORGABEN,
        );
        const soll = (tag: number | null): Record<string, number> => wetterJahreswerte(WETTER_PRESET_VORGABEN, tag);
        expect(w.cfg["tn"]).toBeCloseTo(soll(200)["tn"]!, 9);
        // Das Replay rückt je Bild um Bruchteile eines Tags vor: Die Werte stehen in jedem Bild am Reisedatum.
        for (let i = 1; i <= 40; i++) {
            datum.value = 200 + i * 0.05;
            zeit.stelle(1000 + i * 16);
            lauf.jeBild();
            expect(w.cfg["tn"]).toBeCloseTo(soll(datum.value)["tn"]!, 9);
            expect(w.cfg["sunEl"]).toBeCloseTo(soll(datum.value)["sunEl"]!, 9);
        }
        expect(w.zeitraffer).not.toHaveBeenCalled();
        expect(FOLGEN_TAGE).toBe(1);

        // Ende des Replays: zurück zum Reisebeginn, zwei Tage. Das gleitet über 2,5 s, und das Wetter holt im Zeitraffer auf.
        const vorher = w.cfg["tn"]!;
        datum.value = 200;
        zeit.stelle(2000);
        lauf.jeBild();
        expect(w.zeitraffer).toHaveBeenCalledTimes(1);
        expect(w.cfg["tn"]).toBeCloseTo(vorher, 9);
        zeit.stelle(3250);
        lauf.jeBild();
        expect(w.cfg["tn"]).not.toBeCloseTo(vorher, 6);
        zeit.stelle(4600);
        lauf.jeBild();
        expect(w.cfg["tn"]).toBeCloseTo(soll(200)["tn"]!, 9);
    });

    it("🔴 über den Jahreswechsel bleibt es ein kleiner Schritt", () => {
        const zeit = uhr();
        const w = engine();
        const datum = ref<number | null>(365.9);
        const lauf = erzeugeJahreslauf(
            w as never,
            () => datum.value,
            () => undefined,
            () => WETTER_PRESET_VORGABEN,
        );
        datum.value = wetterReisetag(365, 1.1);
        zeit.stelle(1016);
        lauf.jeBild();
        expect(datum.value).toBeCloseTo(1.1, 9);
        expect(w.zeitraffer).not.toHaveBeenCalled();
        expect(w.cfg["tn"]).toBeCloseTo(wetterJahreswerte(WETTER_PRESET_VORGABEN, 1.1)["tn"]!, 9);
    });

    it("das Himmelslicht rechnet die Engine nur neu, wenn sich die Sonne merklich ändert", () => {
        const zeit = uhr();
        const w = engine();
        const datum = ref<number | null>(100);
        const lauf = erzeugeJahreslauf(
            w as never,
            () => datum.value,
            () => undefined,
            () => WETTER_PRESET_VORGABEN,
        );
        expect(w.sonneGeaendert).toHaveBeenCalledTimes(1);
        datum.value = 100.001;
        zeit.stelle(1016);
        lauf.jeBild();
        expect(w.sonneGeaendert).toHaveBeenCalledTimes(1);
        datum.value = 100.9;
        zeit.stelle(1032);
        lauf.jeBild();
        expect(w.sonneGeaendert).toHaveBeenCalledTimes(2);
    });

    it("🔴 die Schneefallgrenze steht in Ruhe genau auf der der Wegfindung und gleitet nach einem Sprung", () => {
        const zeit = uhr();
        const w = engine();
        const datum = ref<number | null>(45);
        const lauf = erzeugeJahreslauf(
            w as never,
            () => datum.value,
            () => undefined,
            () => WETTER_PRESET_VORGABEN,
        );
        const zonen = wetterKlimazonen(AVENTURIA_TRAVEL_MODEL);
        const gemaessigt = wetterKlimazonenWert(AVENTURIA_TRAVEL_MODEL, "gemaessigt");
        expect(zonen[gemaessigt - 1]).toBe("gemaessigt");
        expect(w.sg[gemaessigt]).toBe(snowlineHeight(AVENTURIA_TRAVEL_MODEL, "gemaessigt", 45));
        expect(w.sg[0]).toBe(-1);
        // Winter: 500 Schritt. Nach rund 2,5 s steht die Linie auf 2 % am Ziel, nach gut 5 s genau.
        datum.value = 225;
        zeit.stelle(1016);
        lauf.jeBild();
        zeit.stelle(1500);
        lauf.jeBild();
        expect(w.sg[gemaessigt]).toBeGreaterThan(500);
        for (let t = 1500; t <= 8000; t += 16) {
            zeit.stelle(t);
            lauf.jeBild();
        }
        expect(w.sg[gemaessigt]).toBe(500);
    });

    it("gleiteSchneegrenzen: ein Ziel ohne Grenze gilt sofort, nahe am Ziel steht es genau", () => {
        const jetzt = Float32Array.from([-1, 1000, 2000]);
        expect(gleiteSchneegrenzen(jetzt, [-1, -1, 2000.3], 16)).toBe(false);
        expect(Array.from(jetzt)).toEqual([-1, -1, Math.fround(2000.3)]);
    });
});

describe("Schneefallgrenze aus der Wegfindung", () => {
    it("🔴 je Zone und Tag genau snowlineHeight, „unbestimmt“ am Tag des Kartenstandards", () => {
        const zonen = wetterKlimazonen(AVENTURIA_TRAVEL_MODEL);
        for (const tag of [1, 45, 135, 225, 315, 361, 363, 365]) {
            const grenzen = wetterSchneegrenzen(AVENTURIA_TRAVEL_MODEL, tag);
            expect(grenzen).toHaveLength(zonen.length + 1);
            zonen.forEach((zone, i) => expect(grenzen[i + 1]).toBe(snowlineHeight(AVENTURIA_TRAVEL_MODEL, zone, tag)));
        }
        expect(WETTER_UNBESTIMMT_TAG).toBe(345);
        expect(wetterSchneegrenzen(AVENTURIA_TRAVEL_MODEL, null)).toEqual(
            wetterSchneegrenzen(AVENTURIA_TRAVEL_MODEL, WETTER_UNBESTIMMT_TAG),
        );
        // Am Tag des Kartenstandards stimmt das Preset „unbestimmt“ mit der Jahrestafel überein (Herkunft des Tags).
        const unbestimmt = WETTER_PRESET_VORGABEN.find((p) => p.tag === null)!;
        expect(wetterJahreswerte(WETTER_PRESET_VORGABEN, WETTER_UNBESTIMMT_TAG)["tn"]).toBeCloseTo(
            unbestimmt.werte.tn,
            9,
        );
    });

    it("🔴 jede Klimazone der Karte hat einen Platz im Raster des Wetters", () => {
        const zonen = wetterKlimazonen(AVENTURIA_TRAVEL_MODEL);
        for (const zone of Object.keys(AVENTURIA_CARTOGRAPHY.climateZones)) expect(zonen).toContain(zone);
        expect(zonen.length).toBeLessThanOrEqual(11);
        expect(wetterKlimazonenWert(AVENTURIA_TRAVEL_MODEL, "unbekannt")).toBe(0);
        expect(wetterKlimazonenWert(AVENTURIA_TRAVEL_MODEL, null)).toBe(0);
    });
});

describe("Klimaraster und der Satz im Wetter-Editor", () => {
    it("die Zelle unter einem Ort, am Rand geklemmt; ohne Raster keine Zone", () => {
        const raster = new Uint8Array(KLIMA_RASTER * KLIMA_RASTER);
        const gemaessigt = wetterKlimazonenWert(AVENTURIA_TRAVEL_MODEL, "gemaessigt");
        raster[491 * KLIMA_RASTER + 551] = gemaessigt;
        raster[1023 * KLIMA_RASTER + 1023] = 1;
        expect(klimawertBei(raster, 551.9, 491.2)).toBe(gemaessigt);
        expect(klimazoneBei(raster, 551.5, 491.5)).toBe("gemaessigt");
        expect(klimazoneBei(raster, 2000, 2000)).toBe("polar");
        expect(klimazoneBei(raster, 10, 10)).toBeNull();
        expect(klimazoneBei(undefined, 551, 491)).toBeNull();
    });

    it("🔴 die Schneefallgrenze im Satz ist die der Wegfindung am Tag des Presets; ohne Zone die aus der Temperatur", () => {
        const werte = { ...WETTER_PRESET_VORGABEN[0]!.werte, tn: -6, ts: 30 };
        const mitte = { x: 551, z: 491 };
        expect(mitteSatz(werte, mitte, 45, "gemaessigt")).toContain("Schneefallgrenze 3.100 m");
        expect(mitteSatz(werte, mitte, 225, "gemaessigt")).toContain("Schneefallgrenze 500 m");
        expect(mitteSatz(werte, mitte, 225, "polar")).toContain("bis ans Meer");
        // Unbestimmt: der Tag des Kartenstandards.
        expect(mitteSatz(werte, mitte, null, "gemaessigt")).toContain(
            `Schneefallgrenze ${String(snowlineHeight(AVENTURIA_TRAVEL_MODEL, "gemaessigt", WETTER_UNBESTIMMT_TAG)).replace(/(\d)(\d{3})$/, "$1.$2")} m`,
        );
        // Ohne Zone: 6,5 °C je 1.000 m, 250 m unter der Nullgradgrenze (wie bis Stufe 4).
        const meer = -6 + 36 * (491 / 1024);
        expect(mitteSatz(werte, mitte, 45, null)).toContain(
            `${Math.round(((meer / 6.5) * 1000 - 250) / 10) * 10} m`.replace(/(\d)(\d{3}) m$/, "$1.$2 m"),
        );
    });
});

describe("Wasser: Flächen und Höhe", () => {
    const quadrat = (x0: number, z0: number, x1: number, z1: number) => [
        { x: x0, z: z0 },
        { x: x1, z: z0 },
        { x: x1, z: z1 },
        { x: x0, z: z1 },
        { x: x0, z: z0 },
    ];

    it("innen zählt Löcher mit", () => {
        const ringe = [quadrat(0, 0, 10, 10), quadrat(4, 4, 6, 6)];
        expect(innen(ringe, 1, 1)).toBe(true);
        expect(innen(ringe, 5, 5)).toBe(false);
        expect(innen(ringe, 11, 5)).toBe(false);
    });

    it("🔴 ein See liegt auf der kleinsten Höhe unter ihm, das Meer auf 0", () => {
        const n = 1024;
        const hoehe = new Float32Array(n * n).fill(900);
        for (let j = 100; j < 110; j++) for (let i = 200; i < 210; i++) hoehe[j * n + i] = i === 200 ? 650 : 400;
        const feld = { n, hoehe };
        const see = { meer: false, ringe: [quadrat(200, 100, 210, 110)] };
        expect(seeHoehe(see.ringe, feld)).toBe(400);
        const ecken = wasserRechtecke([{ meer: true, ringe: [quadrat(0, 0, 50, 50)] }, see], feld);
        // Zwei Rechtecke, je sechs Ecken zu vier Zahlen: das Meer über die Karte auf 0, der See eine Einheit größer auf 400.
        expect(ecken).toHaveLength(2 * 6 * 4);
        expect(Array.from(ecken.slice(0, 4))).toEqual([0, 0, 0, 0]);
        expect(Array.from(ecken.slice(24, 28))).toEqual([199, 99, 400, 1]);
        // Ein See, der keine Zellmitte trifft, nimmt die Zelle unter seiner Mitte.
        expect(seeHoehe([quadrat(205.1, 105.1, 205.4, 105.4)], feld)).toBe(400);
    });

    it("die Stärke wächst mit dem Gelände beim Kippen, flach ist sie 0", () => {
        expect(wasserStaerke(0)).toBe(0);
        expect(wasserStaerke(0.1)).toBeGreaterThan(0);
        expect(wasserStaerke(0.35)).toBe(1);
        expect(wasserStaerke(1)).toBe(1);
    });
});

describe("Wasser: an in 3D, aus in 2D", () => {
    it("läuft nur in 3D und in der Ansicht „Standard“, seit 2026-11-08 auch am Telefon", () => {
        expect(wasserLaeuft("standard", true)).toBe(true);
        expect(wasserLaeuft("standard", false)).toBe(false);
        expect(wasserLaeuft("political", true)).toBe(false);
    });

    /** Eine Karte, die nur Ereignisse kennt und ihr Gelände hält wie MapLibre (`terrain`). */
    function karte() {
        const hoerer = new Map<string, Set<() => void>>();
        const map = {
            terrain: null as { exaggeration: number } | null,
            on: (art: string, f: () => void) => void (hoerer.get(art) ?? hoerer.set(art, new Set()).get(art)!).add(f),
            off: (art: string, f: () => void) => void hoerer.get(art)?.delete(f),
        };
        const melde = (art: string): void => hoerer.get(art)?.forEach((f) => f());
        return { map, melde };
    }
    const ruhe = async (): Promise<void> => {
        for (let i = 0; i < 4; i++) await nextTick();
    };

    it("🔴 flach lädt nichts; geneigt lädt es einmal und schaltet ein, flach wieder aus", async () => {
        const { phoneViewport } = await import("../src/controls/phone-viewport.ts");
        phoneViewport.value = false;
        const { map, melde } = karte();
        const ebene = { ein: vi.fn(), aus: vi.fn(), neuLesen: vi.fn(() => Promise.resolve()), stand: vi.fn() };
        const bau = vi.fn(() => ebene as unknown as WasserEbene);
        const lade = vi.fn(() => Promise.resolve(bau));
        const ansicht = ref<MapView>("standard");
        const stop = installWasser(
            map as unknown as MapLibreMap,
            { ansicht: () => ansicht.value, reisebeginn: () => null },
            lade,
        );
        await ruhe();
        melde("styledata");
        await ruhe();
        expect(lade).not.toHaveBeenCalled();

        map.terrain = { exaggeration: 0.2 };
        melde("terrain");
        await ruhe();
        expect(lade).toHaveBeenCalledTimes(1);
        expect(ebene.ein).toHaveBeenCalledTimes(1);

        ansicht.value = "political";
        await ruhe();
        expect(ebene.aus).toHaveBeenCalledTimes(1);
        ansicht.value = "standard";
        await ruhe();
        expect(ebene.ein).toHaveBeenCalledTimes(2);

        map.terrain = null;
        melde("terrain");
        await ruhe();
        expect(ebene.aus).toHaveBeenCalledTimes(2);
        expect(lade).toHaveBeenCalledTimes(1);
        stop();
    });

    it("🔴 Standardwert „OceanShader an/aus“ aus: auch geneigt wird nichts geladen", async () => {
        expect(wasserLaeuft("standard", true, false)).toBe(false);
        const { phoneViewport } = await import("../src/controls/phone-viewport.ts");
        phoneViewport.value = false;
        const { map, melde } = karte();
        const lade = vi.fn(() => Promise.resolve(vi.fn()));
        const stop = installWasser(
            map as unknown as MapLibreMap,
            { ansicht: () => "standard", reisebeginn: () => null, erlaubt: () => false },
            lade as never,
        );
        map.terrain = { exaggeration: 0.2 };
        melde("terrain");
        await ruhe();
        expect(lade).not.toHaveBeenCalled();
        stop();
    });
});
