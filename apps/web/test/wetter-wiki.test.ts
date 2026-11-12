import { describe, expect, it, vi } from "vitest";
import {
    WETTER_PRESET_VORGABEN,
    WETTER_SYMBOL_VORGABEN,
    WIKI_ART_WIND,
    wetterWikiAdresse,
    type OperationReceipt,
    type WetterDatenAntwort,
    type WetterWikiArtikel,
} from "@avesmaps3d/shared";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster.ts";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden.ts";
import { WIND_FACETTE, wertName, wikiEintragZeileVon } from "../src/landschaftseditor/landschaften-liste.ts";
import type { WetterEditorApi } from "../src/wettereditor/wetter-editor-daten.ts";
import { passtZumIcon, wikiArtikelZu, wikiNamensvorschlag, wikiTreffer } from "../src/wettereditor/wetter-wiki.ts";
import { createWettereditor, lngLatAus } from "../src/wettereditor/wettereditor-steuerung.ts";

/**
 * Der Wiki-Artikel am Wetter-Icon und die Winde in der Liste der Derographie (WI-0288 Stufe 6; Betreiber 2026-11-08: „Leicht, Derographie“). Die Titel sind erfunden.
 *
 * Problemfälle: Die Suche findet „Strömung“ nicht ohne Umlaut oder stellt die Strömung vor den Wind eines Wind-Icons; der Verweis überschreibt den Namen von selbst; ein Titel mit `|` geht an den Server; das
 * Lösen schickt nichts; die Liste lädt bei jedem Tastendruck neu; ein Wind ist im Trichter nicht zu finden oder bekommt eine Flächenart, die beim Zeichnen mitwandert.
 */

const artikel = (titel: string, art: string, region?: string): WetterWikiArtikel => ({
    titel,
    art,
    ...(region === undefined ? {} : { region }),
    wikiUrl: wetterWikiAdresse(titel),
});
const LISTE: readonly WetterWikiArtikel[] = [
    artikel("Probestrom", "Meeresströmung", "Probemeer"),
    artikel("Probewind (Wind)", "Wind", "Probeküste"),
    artikel("Probestrudel", "Mahlstrom (Strömung)"),
    artikel("Ödwind", "Wind"),
];

describe("Suche und Vorschlag (Rechnung)", () => {
    it("🔴 ohne Suche die Artikel der passenden Art zuerst: Wind zu Wind, Strömung zu Meeresströmung, Wirbel zu Mahlstrom", () => {
        expect(wikiTreffer(LISTE, "", "wind").map((a) => a.titel)).toEqual([
            "Ödwind",
            "Probewind (Wind)",
            "Probestrom",
            "Probestrudel",
        ]);
        expect(wikiTreffer(LISTE, "", "stroemung")[0]?.titel).toBe("Probestrom");
        expect(wikiTreffer(LISTE, "", "wirbel")[0]?.titel).toBe("Probestrudel");
        expect(passtZumIcon({ art: "Mahlstrom" }, "wirbel")).toBe(true);
        expect(passtZumIcon({ art: WIKI_ART_WIND }, "stroemung")).toBe(false);
    });

    it("sucht ohne Groß- und Kleinschreibung und ohne Akzente, Wortanfang vor Teilwort, auch in der Region; höchstens acht", () => {
        expect(wikiTreffer(LISTE, "odw", "stroemung").map((a) => a.titel)).toEqual(["Ödwind"]);
        expect(wikiTreffer(LISTE, "WIND", "wind").map((a) => a.titel)).toEqual(["Probewind (Wind)", "Ödwind"]);
        expect(wikiTreffer(LISTE, "kuste", "wind").map((a) => a.titel)).toEqual(["Probewind (Wind)"]);
        expect(wikiTreffer(LISTE, "nichts", "wind")).toEqual([]);
        const viele = Array.from({ length: 20 }, (_, i) => artikel(`Wind ${String(i).padStart(2, "0")}`, "Wind"));
        expect(wikiTreffer(viele, "wind", "wind")).toHaveLength(8);
    });

    it("der Name aus dem Titel ohne Klammerzusatz; der gespeicherte Titel findet seinen Artikel in jeder Schreibung", () => {
        expect(wikiNamensvorschlag("Probewind (Wind)")).toBe("Probewind");
        expect(wikiNamensvorschlag("Probestrom")).toBe("Probestrom");
        expect(wikiNamensvorschlag("(Nur Klammer)")).toBe("(Nur Klammer)");
        expect(wikiArtikelZu(LISTE, "probewind (wind)")?.art).toBe("Wind");
        expect(wikiArtikelZu(undefined, "Probestrom")).toBeUndefined();
        expect(wikiArtikelZu(LISTE, null)).toBeUndefined();
    });
});

const antwort = (): WetterDatenAntwort => ({
    presets: WETTER_PRESET_VORGABEN.map((p) => ({ ...p, werte: { ...p.werte }, revision: 0 })),
    symbole: WETTER_SYMBOL_VORGABEN.map((s) => ({ ...s, revision: 0 })),
    modell: { revision: null, werte: {}, verstellt: [] },
    quelle: { presets: "vorgabe", symbole: "vorgabe", modell: "vorgabe" },
});
const quittung = (affected: OperationReceipt["affected"]): SchreibAntwort => ({
    ok: true,
    quittung: { operationId: "x", status: "applied", environment: "local", affected, derivedWork: [], warnings: [] },
});

function editorMit(api: Partial<WetterEditorApi>) {
    const voll: WetterEditorApi = {
        lade: vi.fn(() => Promise.resolve(antwort())),
        presetWerte: vi.fn(() => Promise.resolve(quittung([]))),
        presetZeitpunkt: vi.fn(() => Promise.resolve(quittung([]))),
        presetAnlegen: vi.fn(() => Promise.resolve(quittung([]))),
        presetEntfernen: vi.fn(() => Promise.resolve(quittung([]))),
        symbolAnlegen: vi.fn(() => Promise.resolve(quittung([]))),
        symbolAendern: vi.fn((id: string, revision: number) =>
            Promise.resolve(quittung([{ kind: "wetter_symbol", id, revision: revision + 1 }])),
        ),
        symbolEntfernen: vi.fn(() => Promise.resolve(quittung([]))),
        wikiArtikel: vi.fn(() => Promise.resolve(LISTE)),
        ...api,
    };
    const editor = createWettereditor({
        werkzeugfenster: createWerkzeugfenster(undefined),
        darf: () => true,
        reisebeginn: () => null,
        mitte: () => lngLatAus({ x: 300, z: 400 }),
        api: voll,
        warteMs: 0,
    });
    return { editor, api: voll };
}

describe("Das Feld „Wiki-Artikel“ in der Steuerung", () => {
    const ERSTES = WETTER_SYMBOL_VORGABEN[0]!;

    it("🔴 setzen und lösen gehen sofort mit baseRevision; der Name bleibt, wie er ist", async () => {
        const { editor, api } = editorMit({});
        editor.oeffneWerkzeug();
        await editor.lade();
        editor.setzeSymbol(ERSTES.id, { wikiTitel: "Probewind (Wind)" });
        expect(editor.bestand.value!.symbole[0]).toMatchObject({ wikiTitel: "Probewind (Wind)", name: ERSTES.name });
        await editor.speicher.alles();
        expect(api.symbolAendern).toHaveBeenLastCalledWith(ERSTES.id, 0, { wikiTitel: "Probewind (Wind)" });
        editor.setzeSymbol(ERSTES.id, { wikiTitel: null });
        await editor.speicher.alles();
        expect(api.symbolAendern).toHaveBeenLastCalledWith(ERSTES.id, 1, { wikiTitel: null });
        expect(editor.bestand.value!.symbole[0]!.wikiTitel).toBeNull();
    });

    it("ein Titel, der keiner sein kann, und dasselbe noch einmal schicken nichts", async () => {
        const { editor, api } = editorMit({});
        editor.oeffneWerkzeug();
        await editor.lade();
        editor.setzeSymbol(ERSTES.id, { wikiTitel: "Probe|wind" });
        editor.setzeSymbol(ERSTES.id, { wikiTitel: null });
        await editor.speicher.alles();
        expect(api.symbolAendern).not.toHaveBeenCalled();
    });

    it("die Artikel laden erst auf Wunsch und einmal; nach einem Fehler beim nächsten Wunsch erneut", async () => {
        const wikiArtikel = vi
            .fn<WetterEditorApi["wikiArtikel"]>()
            .mockRejectedValueOnce(new Error("weg"))
            .mockResolvedValue(LISTE);
        const { editor } = editorMit({ wikiArtikel });
        editor.oeffneWerkzeug();
        await editor.lade();
        expect(wikiArtikel).not.toHaveBeenCalled();
        await editor.ladeWikiArtikel();
        expect(editor.wikiFehler.value).toBe(true);
        expect(editor.wikiArtikel.value).toBeUndefined();
        await Promise.all([editor.ladeWikiArtikel(), editor.ladeWikiArtikel()]);
        await editor.ladeWikiArtikel();
        expect(wikiArtikel).toHaveBeenCalledTimes(2);
        expect(editor.wikiFehler.value).toBe(false);
        expect(editor.wikiArtikel.value).toHaveLength(LISTE.length);
    });
});

describe("🔴 Winde in der Liste der Derographie", () => {
    const eintrag = (art: string | undefined, type?: string) =>
        wikiEintragZeileVon({
            id: "b8000000-0000-4000-8000-0000000000aa",
            titel: "Probewind (Wind)",
            name: "Probewind",
            layer: "derographisch",
            ...(type === undefined ? {} : { type }),
            ...(art === undefined ? {} : { art }),
            wikiUrl: wetterWikiAdresse("Probewind (Wind)"),
        });

    it("ein Wind trägt im Trichter die Wahl „Wind“ unter Flächenart, rechts seine Art, unter Regionen", () => {
        const zeile = eintrag(WIKI_ART_WIND);
        expect(zeile.facetten).toMatchObject({
            flaechenart: WIND_FACETTE,
            ebene: "derographisch",
            stand: "nichtAufDerKarte",
        });
        expect(zeile.rechts).toBe("Wind");
        expect(zeile.kreis).toBe("halb");
        expect(wertName("flaechenart", WIND_FACETTE)).toBe("Wind");
    });

    it("andere Einträge behalten ihre Flächenart oder „ohne Art“", () => {
        expect(eintrag("Meeresströmung").facetten["flaechenart"]).toBe("");
        expect(eintrag("Insel", "insel").facetten["flaechenart"]).toBe("insel");
        expect(eintrag(undefined).facetten["flaechenart"]).toBe("");
    });
});
