import { afterEach, describe, expect, it, vi } from "vitest";

const gemeldet = vi.hoisted(() => [] as [string, string | undefined][]);
vi.mock("../src/besuch/besuch-melden.ts", () => ({
    melde: (metrik: string, dimension?: string) => gemeldet.push([metrik, dimension]),
}));
import { nextTick, ref, shallowRef } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapView } from "@avesmaps3d/shared";
import type { WetterEbene } from "../src/map/wetter/wetter-ebene.ts";
import {
    type WetterEditorAnschluss,
    engineFortschritt,
    klickeWetter,
    liesWetterStand,
    meldeWetterMetrik,
    setzeWetter,
    wetterStand,
    meldeWetterFortschritt,
    schreibeWetterStand,
    WETTER_AUS,
    wetterLaden,
    wetterLaeuft,
    wetterSperre,
    wetterStandAusAdresse,
    wirksamerWetterStand,
} from "../src/map/wetter/wetter-schalter.ts";

describe("Ein Link schaltet das Wetter ein (?wetter=, Betreiber 2026-11-08)", () => {
    it("🔴 setzt genau die genannten Schalter, der Rest ist aus; Groß- und Kleinschreibung egal", () => {
        expect(wetterStandAusAdresse("?wetter=wolken,wind")).toEqual({ ...WETTER_AUS, wolken: true, wind: true });
        expect(wetterStandAusAdresse("?x=1&wetter=RegenUndSchnee,%20stroemungen")).toEqual({
            ...WETTER_AUS,
            regenUndSchnee: true,
            stroemungen: true,
        });
    });

    it("„alle“ schaltet die sechs Schalter des Auges ein, die Schneefallgrenze nur, wenn sie eigens genannt ist", () => {
        const sechs = {
            ...WETTER_AUS,
            schneedecke: true,
            wolken: true,
            regenUndSchnee: true,
            wind: true,
            stroemungen: true,
        };
        expect(wetterStandAusAdresse("?wetter=alle")).toEqual({ ...sechs, niederschlag: true });
        expect(wetterStandAusAdresse("?wetter=Alle,schneefallgrenze")).toEqual({
            ...sechs,
            niederschlag: true,
            schneefallgrenze: true,
        });
    });

    it("„aus“ schaltet alles aus; ohne Parameter oder ohne bekannte Kennung ändert der Link nichts", () => {
        expect(wetterStandAusAdresse("?wetter=aus")).toEqual(WETTER_AUS);
        expect(wetterStandAusAdresse("")).toBeUndefined();
        expect(wetterStandAusAdresse("?wetterTelefon=1")).toBeUndefined();
        expect(wetterStandAusAdresse("?wetter=quatsch")).toBeUndefined();
        expect(wetterStandAusAdresse("?wetter=wolken,quatsch")).toEqual({ ...WETTER_AUS, wolken: true });
    });
});

describe("Ladebalken beim ersten Einschalten (Betreiber 2026-11-08)", () => {
    it("🔴 läuft von Code (bis 0,1) über die Schritte der Engine bis 1, nie zurück; Ende und Fehler nehmen ihn weg", () => {
        meldeWetterFortschritt(undefined);
        expect(wetterLaden.value).toBeNull();
        meldeWetterFortschritt(0.02);
        meldeWetterFortschritt(0.1);
        meldeWetterFortschritt(engineFortschritt(0.05));
        expect(wetterLaden.value).toBeCloseTo(0.145);
        meldeWetterFortschritt(0.1);
        expect(wetterLaden.value).toBeCloseTo(0.145);
        meldeWetterFortschritt(engineFortschritt(0.6));
        expect(wetterLaden.value).toBeCloseTo(0.64);
        meldeWetterFortschritt(engineFortschritt(1));
        expect(wetterLaden.value).toBeNull();
        meldeWetterFortschritt(0.3);
        meldeWetterFortschritt(engineFortschritt(undefined));
        expect(wetterLaden.value).toBeNull();
    });
});

/**
 * Die Wetterschalter im Auge (WI-0288 Stufe 1). Problemfälle: Die Wahl überlebt das Neuladen nicht oder liest fremde Wörter; das
 * Wetter läuft außerhalb der Standard-Ansicht oder (seit 2026-11-08) nicht am Telefon; ein gemerkter Haken „Schneefallgrenze“ lädt für Besucher das Wetter;
 * und vor allem: Die Engine wird geladen, obwohl nichts an ist.
 */

/** Ein Speicher wie `localStorage`, im Speicher. */
function speicher(start: Record<string, string> = {}): Storage {
    const werte = new Map(Object.entries(start));
    return {
        get length() {
            return werte.size;
        },
        key: (i) => [...werte.keys()][i] ?? null,
        getItem: (k) => werte.get(k) ?? null,
        setItem: (k, v) => void werte.set(k, v),
        removeItem: (k) => void werte.delete(k),
        clear: () => werte.clear(),
    };
}

describe("Gemerkt je Browser", () => {
    it("ohne Eintrag ist alles aus", () => {
        expect(liesWetterStand(speicher())).toEqual(WETTER_AUS);
        expect(liesWetterStand(undefined)).toEqual(WETTER_AUS);
    });

    it("liest zurück, was es geschrieben hat, und lässt Unbekanntes fallen", () => {
        const s = speicher();
        schreibeWetterStand(s, { ...WETTER_AUS, wolken: true, schneefallgrenze: true });
        expect(s.getItem("avesmaps3d.wetter")).toBe("wolken,schneefallgrenze");
        s.setItem("avesmaps3d.wetter", "wind,quatsch,,stroemungen");
        expect(liesWetterStand(s)).toEqual({ ...WETTER_AUS, wind: true, stroemungen: true });
    });

    it("ein Speicher, der wirft, gilt als leer", () => {
        const kaputt = {
            getItem: () => {
                throw new Error("privates Fenster");
            },
        };
        expect(liesWetterStand(kaputt)).toEqual(WETTER_AUS);
    });
});

describe("Sperre und Lauf", () => {
    it("außerhalb der Standard-Ansicht gesperrt, mit Grund; das Telefon sperrt nicht mehr (Betreiber 2026-11-08)", () => {
        expect(wetterSperre("standard")).toBeUndefined();
        expect(wetterSperre("political")).toBe("display.lock.weatherView");
        expect(wetterSperre("landscapes")).toBe("display.lock.weatherView");
    });

    it("läuft nur, wenn etwas an ist und keine Sperre greift", () => {
        const wolken = { ...WETTER_AUS, wolken: true };
        expect(wetterLaeuft(WETTER_AUS, "standard")).toBe(false);
        expect(wetterLaeuft(wolken, "standard")).toBe(true);
        expect(wetterLaeuft(wolken, "political")).toBe(false);
    });

    it("die Schneefallgrenze zählt nur mit dem Recht auf Prüfhaken", () => {
        const nurLinie = { ...WETTER_AUS, schneefallgrenze: true };
        expect(wetterLaeuft(wirksamerWetterStand(nurLinie, false), "standard")).toBe(false);
        expect(wetterLaeuft(wirksamerWetterStand(nurLinie, true), "standard")).toBe(true);
    });
});

describe("Laden auf Abruf", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    /** Das Modul frisch, mit eigenem Speicher: So liest es seine Vorgabe wie beim Seitenaufruf. */
    async function frisch(start: Record<string, string> = {}) {
        const s = speicher(start);
        vi.stubGlobal("localStorage", s);
        vi.resetModules();
        const schalter = await import("../src/map/wetter/wetter-schalter.ts");
        const { phoneViewport } = await import("../src/controls/phone-viewport.ts");
        phoneViewport.value = false;
        const ebene = {
            setze: vi.fn(),
            ein: vi.fn(),
            aus: vi.fn(),
            neuLesen: vi.fn(() => Promise.resolve()),
            editor: vi.fn(),
            offen: vi.fn(),
            messlauf: vi.fn(() => Promise.resolve(["Ohne Wetter 60 FPS · mit Wetter 30 FPS"])),
        } satisfies WetterEbene;
        const bau = vi.fn(() => ebene);
        const lade = vi.fn(() => Promise.resolve(bau));
        const ansicht = ref<MapView>("standard");
        const editor = shallowRef<WetterEditorAnschluss | undefined>(undefined);
        const stop = schalter.installWetter(
            {} as MapLibreMap,
            {
                ansicht: () => ansicht.value,
                reisebeginn: () => null,
                pruefen: () => false,
                editor: () => editor.value,
            },
            lade,
        );
        return { s, schalter, phoneViewport, ebene, bau, lade, ansicht, editor, stop };
    }
    /** Watcher und das Versprechen des Laders abwarten. */
    const ruhe = async (): Promise<void> => {
        for (let i = 0; i < 4; i++) await nextTick();
    };

    it("🔴 nichts an: die Engine wird weder geladen noch ausgeführt", async () => {
        const { lade, schalter, ansicht, phoneViewport, stop } = await frisch();
        await ruhe();
        ansicht.value = "political";
        phoneViewport.value = true;
        await ruhe();
        // Ein gemerkter Haken „Schneefallgrenze“ ohne Prüfrecht lädt auch nichts.
        schalter.setzeWetter("schneefallgrenze", true);
        ansicht.value = "standard";
        phoneViewport.value = false;
        await ruhe();
        expect(lade).not.toHaveBeenCalled();
        stop();
    });

    it("🔴 am Telefon läuft das Wetter wie am Rechner (Betreiber 2026-11-08: „dass telefon nicht freigeschaltet ist“)", async () => {
        const { schalter, phoneViewport, ebene, lade, stop } = await frisch();
        phoneViewport.value = true;
        schalter.setzeWetter("wolken", true);
        await ruhe();
        expect(lade).toHaveBeenCalledTimes(1);
        expect(ebene.ein).toHaveBeenCalledTimes(1);
        expect(ebene.aus).not.toHaveBeenCalled();
        stop();
    });

    it("der Messlauf misst nur, wenn das Wetter läuft, und legt sein Ergebnis ab", async () => {
        const { schalter, ebene, stop } = await frisch();
        schalter.starteWetterMesslauf();
        expect(schalter.wetterMesslauf.value).toEqual(["Für den Messlauf erst ein Wetter einschalten."]);
        expect(ebene.messlauf).not.toHaveBeenCalled();
        schalter.setzeWetter("wolken", true);
        await ruhe();
        schalter.starteWetterMesslauf();
        expect(schalter.wetterMesslauf.value).toBe("laeuft");
        await ruhe();
        expect(ebene.messlauf).toHaveBeenCalledTimes(1);
        expect(schalter.wetterMesslauf.value).toEqual(["Ohne Wetter 60 FPS · mit Wetter 30 FPS"]);
        stop();
    });

    it("lädt beim ersten Einschalten einmal, nimmt die Ebene bei Ansichtswechsel weg und merkt die Wahl", async () => {
        const { s, schalter, ebene, bau, lade, ansicht, stop } = await frisch();
        schalter.setzeWetter("wolken", true);
        await ruhe();
        expect(lade).toHaveBeenCalledTimes(1);
        expect(bau).toHaveBeenCalledTimes(1);
        expect(ebene.setze).toHaveBeenLastCalledWith({ ...WETTER_AUS, wolken: true });
        expect(ebene.ein).toHaveBeenCalledTimes(1);
        expect(s.getItem("avesmaps3d.wetter")).toBe("wolken");

        schalter.setzeWetter("wind", true);
        await ruhe();
        expect(ebene.setze).toHaveBeenLastCalledWith({ ...WETTER_AUS, wolken: true, wind: true });

        // Beim ersten Einschalten kommen die Daten mit dem Chunk; erst nach einer Pause liest die Ebene neu (WI-0288 Stufe 2).
        expect(ebene.neuLesen).not.toHaveBeenCalled();
        ansicht.value = "political";
        await ruhe();
        expect(ebene.aus).toHaveBeenCalledTimes(1);
        ansicht.value = "standard";
        await ruhe();
        expect(ebene.ein).toHaveBeenCalledTimes(3);
        expect(ebene.neuLesen).toHaveBeenCalledTimes(1);

        schalter.setzeWetter("wolken", false);
        schalter.setzeWetter("wind", false);
        await ruhe();
        expect(ebene.aus).toHaveBeenCalledTimes(2);
        expect(s.getItem("avesmaps3d.wetter")).toBe("");
        expect(lade).toHaveBeenCalledTimes(1);
        stop();
    });

    it("🔴 der Wetter-Editor lädt die Ebene für seine Griffe, ohne die Rechnung anzuwerfen (WI-0288 Stufe 3)", async () => {
        const { lade, ebene, ansicht, editor, stop } = await frisch();
        await ruhe();
        expect(lade).not.toHaveBeenCalled();
        const anschluss: WetterEditorAnschluss = {
            presets: [],
            symbole: [],
            gewaehlt: undefined,
            darf: true,
            waehle: vi.fn(),
            ziehe: vi.fn(),
        };
        editor.value = anschluss;
        await ruhe();
        expect(lade).toHaveBeenCalledTimes(1);
        expect(ebene.editor).toHaveBeenLastCalledWith(anschluss);
        expect(ebene.ein).not.toHaveBeenCalled();
        // Außerhalb der Ansicht „Standard“ gibt es kein Wetter, auch keine Griffe.
        ansicht.value = "political";
        await ruhe();
        expect(ebene.editor).toHaveBeenLastCalledWith(undefined);
        ansicht.value = "standard";
        await ruhe();
        expect(ebene.editor).toHaveBeenLastCalledWith(anschluss);
        editor.value = undefined;
        await ruhe();
        expect(ebene.editor).toHaveBeenLastCalledWith(undefined);
        expect(ebene.ein).not.toHaveBeenCalled();
        expect(lade).toHaveBeenCalledTimes(1);
        stop();
    });

    it("🔴 das Wettermodell der Systemsteuerung gilt ohne Neuladen: läuft das Wetter, liest es sofort neu, sonst beim Einschalten (WI-0288 Stufe 4)", async () => {
        const { schalter, ebene, lade, ansicht, stop } = await frisch();
        // Ohne Ebene gibt es nichts nachzulesen: Sie liest frisch, wenn sie kommt.
        schalter.meldeWettermodellGespeichert();
        await ruhe();
        expect(lade).not.toHaveBeenCalled();

        schalter.setzeWetter("wolken", true);
        await ruhe();
        expect(ebene.neuLesen).not.toHaveBeenCalled();
        schalter.meldeWettermodellGespeichert();
        await ruhe();
        expect(ebene.neuLesen).toHaveBeenCalledTimes(1);

        // Steht das Wetter (andere Ansicht), merkt es sich die Änderung und liest beim nächsten Einschalten einmal.
        ansicht.value = "political";
        await ruhe();
        schalter.meldeWettermodellGespeichert();
        await ruhe();
        expect(ebene.neuLesen).toHaveBeenCalledTimes(1);
        ansicht.value = "standard";
        await ruhe();
        expect(ebene.neuLesen).toHaveBeenCalledTimes(2);
        stop();

        // Hat nur der Wetter-Editor die Ebene geladen, liest das erste Einschalten das gespeicherte Modell nach.
        const zweite = await frisch();
        zweite.editor.value = {
            presets: [],
            symbole: [],
            gewaehlt: undefined,
            darf: true,
            waehle: vi.fn(),
            ziehe: vi.fn(),
        };
        await ruhe();
        expect(zweite.lade).toHaveBeenCalledTimes(1);
        zweite.schalter.meldeWettermodellGespeichert();
        await ruhe();
        expect(zweite.ebene.neuLesen).not.toHaveBeenCalled();
        zweite.schalter.setzeWetter("wind", true);
        await ruhe();
        expect(zweite.ebene.neuLesen).toHaveBeenCalledTimes(1);
        zweite.stop();
    });

    it("eine gemerkte Wahl lädt gleich beim Start", async () => {
        const { lade, ebene, stop } = await frisch({ "avesmaps3d.wetter": "schneedecke" });
        await ruhe();
        expect(lade).toHaveBeenCalledTimes(1);
        expect(ebene.setze).toHaveBeenLastCalledWith({ ...WETTER_AUS, schneedecke: true });
        expect(ebene.ein).toHaveBeenCalledTimes(1);
        stop();
    });
});

/**
 * Die Zählung der Wetterschalter (WI-0288). 🔴 Gezählt wird der Klick, nie der Startzustand: `setzeWetter` bleibt der stille Weg (Start,
 * gemerkte Wahl), `klickeWetter` ist die Hand der Person.
 */
describe("Wetterschalter melden sich an die Besucherstatistik", () => {
    afterEach(() => {
        gemeldet.length = 0;
        setzeWetter("wolken", false);
        setzeWetter("schneefallgrenze", false);
    });

    it("🔴 ein Klick schaltet um und meldet `display_toggle` mit der Wetter-Kennung, in beide Richtungen", () => {
        klickeWetter("wolken", true);
        expect(wetterStand.value.wolken).toBe(true);
        klickeWetter("wolken", false);
        klickeWetter("regenUndSchnee", true);
        klickeWetter("schneefallgrenze", true);
        expect(gemeldet).toEqual([
            ["display_toggle", "wetter_wolken:on"],
            ["display_toggle", "wetter_wolken:off"],
            ["display_toggle", "wetter_regenUndSchnee:on"],
            ["display_toggle", "wetter_schneefallgrenze:on"],
        ]);
        setzeWetter("regenUndSchnee", false);
    });

    it("🔴 ein Wechsel ohne Klick (gemerkte Wahl, Start) meldet nichts", () => {
        setzeWetter("wolken", true);
        setzeWetter("wolken", false);
        expect(gemeldet).toEqual([]);
    });

    it("eine Wettermetrik geht höchstens einmal je Schlüssel raus, mit dem Gerät davor", () => {
        meldeWetterMetrik("wetter_bildrate", "30-45", "test-bildrate");
        meldeWetterMetrik("wetter_bildrate", "45-60", "test-bildrate");
        meldeWetterMetrik("wetter_fehler", "shader", "test-fehler:shader");
        meldeWetterMetrik("wetter_fehler", "webgl2", "test-fehler:webgl2");
        expect(gemeldet).toEqual([
            ["wetter_bildrate", "rechner:30-45"],
            ["wetter_fehler", "rechner:shader"],
            ["wetter_fehler", "rechner:webgl2"],
        ]);
    });
});
