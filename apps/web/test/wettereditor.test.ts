import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import {
    WETTER_PRESET_VORGABEN,
    WETTER_SYMBOL_VORGABEN,
    WETTER_UNBESTIMMT,
    wetterNeuePresetWerte,
    type DepartureMonth,
    type OperationReceipt,
    type WetterDatenAntwort,
    type WetterPreset,
    type WetterSymbol,
} from "@avesmaps3d/shared";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster.ts";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden.ts";
import { gezogen, zugAus } from "../src/map/wetter/wetter-griffe.ts";
import { mal, projiziere, schneide, umkehrung } from "../src/map/wetter/wetter-kamera.ts";
import type { WetterSymbol as EngineSymbol } from "../src/map/wetter/wetter-symbole.ts";
import type { WetterEditorApi } from "../src/wettereditor/wetter-editor-daten.ts";
import {
    WETTER_LISTE,
    aufSchritt,
    himmelVon,
    istEntfernbar,
    mitAngelegtem,
    mitZeitpunkt,
    monatUndTag,
    papierkorbGrund,
    presetName,
    referenzWert,
    tagAus,
    tauschFrage,
    wetterLegenden,
    wetterZeilen,
    zeitpunktFolge,
} from "../src/wettereditor/wetter-editor-modell.ts";
import { createWetterSpeicher, type Uhr } from "../src/wettereditor/wetter-speicher.ts";
import { createWettereditor, lngLatAus, weltAus } from "../src/wettereditor/wettereditor-steuerung.ts";
import { berechne } from "../src/editor-liste/liste-modell.ts";

/**
 * Der Wetter-Editor (WI-0288 Stufe 3). Problemfälle: Die Liste stellt Icons vor die Presets oder „Unbestimmt“ nicht an die Spitze; ein
 * Regler schickt je Bewegung eine Anfrage oder eine veraltete Revision; ein Konflikt bleibt still oder schickt weiter; „Unbestimmt“ setzen
 * tauscht ohne Nachfrage (Idee B) oder das unbestimmte Preset wandert auf einen freien Tag; ein angelegtes Icon steht ohne Kennung des
 * Servers da; die Karte bekommt den Editor, obwohl sein Fenster abgelegt ist; ein Zug auf der Karte rechnet Grad und Bogen falsch.
 */

const presets = (): WetterPreset[] => WETTER_PRESET_VORGABEN.map((p) => ({ ...p, werte: { ...p.werte }, revision: 0 }));
const symbole = (): WetterSymbol[] => WETTER_SYMBOL_VORGABEN.map((s) => ({ ...s, revision: 0 }));
const antwort = (): WetterDatenAntwort => ({
    presets: presets(),
    symbole: symbole(),
    modell: { revision: null, werte: {}, verstellt: [] },
    quelle: { presets: "vorgabe", symbole: "vorgabe", modell: "vorgabe" },
});
const quittung = (affected: OperationReceipt["affected"]): SchreibAntwort => ({
    ok: true,
    quittung: { operationId: "x", status: "applied", environment: "local", affected, derivedWork: [], warnings: [] },
});
const konflikt = (): SchreibAntwort => ({
    ok: false,
    status: 409,
    fehler: { code: "edit_conflict", message: "Jemand war schneller." },
});

describe("Liste und Zeitpunkt (Modell)", () => {
    it("🔴 Presets vor Icons, „Unbestimmt“ an der Spitze, dann der Kalender; jede Ordnung hält die Gruppen", () => {
        const bestand = { presets: presets(), symbole: symbole() };
        const zeilen = wetterZeilen(bestand, null);
        for (const sortierung of ["kalender", "name", "art"]) {
            const ergebnis = berechne(
                zeilen,
                { suche: "", filter: new Map(), sortierung, offen: new Set() },
                WETTER_LISTE,
            );
            const folge = ergebnis.darstellung.map((z) => z.key);
            expect(folge[0]).toBe("gruppe:presets");
            expect(folge.indexOf("gruppe:icons")).toBe(15);
            if (sortierung === "kalender") {
                expect(folge.slice(1, 4)).toEqual(["p-u", "p-praios", "p-rondra"]);
                expect(folge[14]).toBe("p-namenlos");
            }
        }
        const unbestimmt = zeilen.find((z) => z.key === "p-u")!;
        expect(unbestimmt.name).toBe("Unbestimmt");
        expect(unbestimmt.unter?.text).toBe("Kartenstandard, ohne Reisebeginn · gilt auf der Karte");
        expect(zeilen.find((z) => z.key === "p-praios")!.name).toBe("15. Praios");
        expect(zeilen.find((z) => z.key === "p-namenlos")!.name).toBe("3. Namenloser Tag");
        const wind = zeilen.find((z) => z.key === WETTER_SYMBOL_VORGABEN[0]!.id)!;
        expect(wind.rechts).toBe("Wind");
        expect(wind.unter?.text).toBe("nach Osten · 450 km Reichweite");
        expect(wind.vorzeichen).toBe("wetter-wind");
    });

    it("🔴 beliebig viele Presets: angelegte stehen mit dem Namen ihres Tags in der Liste, entfernbar nur ein angelegtes mit Tag", () => {
        const neu = { id: "p-abcdefgh", tag: 100, werte: presets()[1]!.werte, revision: 1 };
        const bestand = { presets: mitAngelegtem(presets(), neu), symbole: symbole() };
        const zeilen = wetterZeilen(bestand, null);
        expect(zeilen.filter((z) => z.gruppe === "presets")).toHaveLength(15);
        expect(zeilen.find((z) => z.key === "p-abcdefgh")).toMatchObject({ name: "10. Travia", kreis: "voll" });
        const ergebnis = berechne(
            zeilen,
            { suche: "", filter: new Map(), sortierung: "kalender", offen: new Set() },
            WETTER_LISTE,
        );
        const folge = ergebnis.darstellung.map((z) => z.key);
        // Nach dem Kalender: 10. Travia (Tag 100) liegt vor dem 15. Travia (105).
        expect(folge.indexOf("p-abcdefgh")).toBe(folge.indexOf("p-travia") - 1);
        expect(folge.indexOf("gruppe:icons")).toBe(16);
        expect(wetterLegenden(bestand).presets.zahlen).toMatchObject({ voll: 14, halb: 1 });

        expect(istEntfernbar(neu)).toBe(true);
        expect(istEntfernbar({ id: "p-abcdefgh", tag: null })).toBe(false);
        expect(istEntfernbar(presets()[1]!)).toBe(false);
        expect(papierkorbGrund({ symbol: symbole()[0]! })).toBeUndefined();
        expect(papierkorbGrund({ preset: neu })).toBeUndefined();
        expect(papierkorbGrund({ preset: presets()[1]! })).toMatch(/festen Presets bleiben/);
        expect(papierkorbGrund({ preset: { ...neu, tag: null } })).toMatch(/Kartenstandard/);
        expect(papierkorbGrund({})).toMatch(/festen Presets bleiben/);
    });

    it("die zwei Legenden zählen je ihre Gruppe; ausgeblendet ist ○ und warnt in der Unterzeile", () => {
        const liste = symbole();
        liste[0] = { ...liste[0]!, sichtbar: false };
        liste[1] = { ...liste[1]!, nameZeigen: true };
        const bestand = { presets: presets(), symbole: liste };
        const { presets: p, icons } = wetterLegenden(bestand);
        expect(p.zahlen).toMatchObject({ voll: 13, halb: 1 });
        expect(icons.zahlen).toMatchObject({ voll: 1, halb: 11, leer: 1 });
        const zeile = wetterZeilen(bestand, null).find((z) => z.key === liste[0]!.id)!;
        expect(zeile.kreis).toBe("leer");
        expect(zeile.unter).toEqual({ text: "ausgeblendet · wirkt weiter aufs Wetter", ton: "warnung" });
    });

    it("mit Reisebeginn gelten die zwei Nachbarn anteilig, „Unbestimmt“ nicht", () => {
        const zeilen = wetterZeilen({ presets: presets(), symbole: [] }, 25);
        expect(zeilen.find((z) => z.key === "p-praios")!.unter?.text).toMatch(/^Sommer · gilt zu \d+ %$/);
        expect(zeilen.find((z) => z.key === "p-rondra")!.unter?.ton).toBe("gut");
        expect(zeilen.find((z) => z.key === "p-u")!.unter).toEqual({ text: "Kartenstandard", ton: "leise" });
    });

    it("🔴 Idee B: ein freier Tag gilt gleich, ein belegter oder „Unbestimmt“ ist ein Tausch, das unbestimmte bleibt", () => {
        const p = presets();
        expect(zeitpunktFolge(p, "p-praios", 15)).toEqual({ art: "gleich" });
        expect(zeitpunktFolge(p, "p-praios", 20)).toEqual({ art: "frei" });
        expect(zeitpunktFolge(p, "p-praios", 45)).toEqual({ art: "tausch", mit: "p-rondra" });
        expect(zeitpunktFolge(p, "p-praios", null)).toEqual({ art: "tausch", mit: "p-u" });
        expect(zeitpunktFolge(p, "p-u", 20)).toEqual({ art: "unbestimmtBleibt" });
        expect(zeitpunktFolge(p, "p-u", 15)).toEqual({ art: "tausch", mit: "p-praios" });
        const getauscht = mitZeitpunkt(p, "p-praios", null);
        expect(getauscht.find((x) => x.id === "p-praios")!.tag).toBeNull();
        expect(getauscht.find((x) => x.id === "p-u")!.tag).toBe(15);
        expect(tauschFrage(p, "p-praios", "p-u", null)).toEqual({
            frage: "„15. Praios“ zum Kartenstandard machen?",
            folge: "Nur ein Preset kann unbestimmt sein. Das bisherige bekommt dafür den 15. Praios.",
        });
    });

    it("Monat und Tag hin und zurück, geklemmt; ↺ zielt am datierten auf den Kartenstandard, am unbestimmten auf die Vorgabe", () => {
        expect(monatUndTag(15)).toEqual({ monat: "praios", tag: 15 });
        expect(monatUndTag(363)).toEqual({ monat: "namenlos", tag: 3 });
        expect(monatUndTag(null)).toBeNull();
        expect(tagAus("rondra", 40)).toBe(60);
        expect(tagAus("namenlos", 9)).toBe(365);
        expect(presetName({ tag: 75 })).toBe("15. Efferd");
        const p = presets();
        p[0] = { ...p[0]!, werte: { ...p[0]!.werte, tn: -3 } };
        expect(referenzWert(p, p[1]!, "tn")).toBe(-3);
        expect(referenzWert(p, p[0]!, "tn")).toBe(WETTER_UNBESTIMMT.tn);
        expect(aufSchritt({ min: 0, max: 5, schritt: 0.05 }, 1.337)).toBe(1.35);
        expect(aufSchritt({ min: -50, max: 35, schritt: 0.1 }, 99)).toBe(35);
        expect(himmelVon(0)).toBe("n");
        expect(himmelVon(100)).toBe("o");
        expect(himmelVon(350)).toBe("n");
    });
});

/** Eine Uhr zum Weiterdrehen: Zeitgeber laufen erst, wenn der Test sie lässt. */
function testUhr(): Uhr & { weiter(ms: number): void } {
    let jetzt = 0;
    let n = 0;
    const offen = new Map<number, { bis: number; tu: () => void }>();
    return {
        setze(tu, ms) {
            n += 1;
            offen.set(n, { bis: jetzt + ms, tu });
            return n;
        },
        loesche(griff) {
            offen.delete(griff as number);
        },
        jetzt: () => jetzt,
        weiter(ms) {
            jetzt += ms;
            for (const [griff, eintrag] of [...offen]) {
                if (eintrag.bis > jetzt) continue;
                offen.delete(griff);
                eintrag.tu();
            }
        },
    };
}
const ruhe = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("Speichern ohne Knopf", () => {
    it("🔴 entprellt je Ziel: drei Werte in Folge sind EINE Anfrage, ein zweites Ziel eine eigene", async () => {
        const uhr = testUhr();
        const sende = vi.fn(() => Promise.resolve(quittung([])));
        const speicher = createWetterSpeicher({ sende, quittung: vi.fn(), konflikt: vi.fn(), fehler: vi.fn(), uhr });
        speicher.aendere({ art: "preset", id: "p-u" }, { tn: 1 });
        uhr.weiter(200);
        speicher.aendere({ art: "preset", id: "p-u" }, { tn: 2 });
        speicher.aendere({ art: "preset", id: "p-u" }, { ts: 31 });
        speicher.aendere({ art: "symbol", id: "s" }, { x: 5 });
        expect(speicher.stand.value).toBe("wartet");
        uhr.weiter(399);
        expect(sende).not.toHaveBeenCalled();
        uhr.weiter(1);
        await ruhe();
        expect(sende).toHaveBeenCalledTimes(2);
        expect(sende).toHaveBeenNthCalledWith(1, { art: "preset", id: "p-u" }, { tn: 2, ts: 31 });
        expect(sende).toHaveBeenNthCalledWith(2, { art: "symbol", id: "s" }, { x: 5 });
        expect(speicher.stand.value).toBe("ruhe");
        expect(speicher.zuletzt.value).toBe(600);
    });

    it("🔴 eine Anfrage zur Zeit, in der Folge; ein Konflikt meldet sich und lässt fallen, was noch wartet", async () => {
        const uhr = testUhr();
        let lass: ((a: SchreibAntwort) => void) | undefined;
        const sende = vi.fn(
            () =>
                new Promise<SchreibAntwort>((fertig) => {
                    lass = fertig;
                }),
        );
        const meldung = vi.fn();
        const speicher = createWetterSpeicher({ sende, quittung: vi.fn(), konflikt: meldung, fehler: vi.fn(), uhr });
        speicher.aendere({ art: "preset", id: "p-u" }, { tn: 1 });
        uhr.weiter(400);
        speicher.aendere({ art: "preset", id: "p-praios" }, { tn: 3 });
        uhr.weiter(400);
        await ruhe();
        // Die zweite wartet, bis die erste beantwortet ist.
        expect(sende).toHaveBeenCalledTimes(1);
        expect(speicher.stand.value).toBe("laeuft");
        speicher.aendere({ art: "preset", id: "p-rondra" }, { tn: 4 });
        lass!(konflikt());
        await ruhe();
        expect(meldung).toHaveBeenCalledTimes(1);
        uhr.weiter(1000);
        await ruhe();
        expect(sende).toHaveBeenCalledTimes(1);
        expect(speicher.stand.value).toBe("ruhe");
    });

    it("409 no_change zählt als gespeichert; sofort schickt vorher, was wartet", async () => {
        const uhr = testUhr();
        const folge: string[] = [];
        const sende = vi.fn((ziel: { id: string }) => {
            folge.push(ziel.id);
            return Promise.resolve<SchreibAntwort>({
                ok: false,
                status: 409,
                fehler: { code: "no_change", message: "steht schon so" },
            });
        });
        const fehler = vi.fn();
        const speicher = createWetterSpeicher({ sende, quittung: vi.fn(), konflikt: vi.fn(), fehler, uhr });
        speicher.aendere({ art: "symbol", id: "a" }, { x: 1 });
        await speicher.sofort(() => {
            folge.push("sofort");
            return Promise.resolve(quittung([]));
        });
        expect(folge).toEqual(["a", "sofort"]);
        expect(fehler).not.toHaveBeenCalled();
        expect(speicher.zuletzt.value).toBe(0);
    });
});

function editorMit(
    api: Partial<WetterEditorApi>,
    darf = true,
    reise: { month: DepartureMonth; day: number } | null = null,
    zeigeInfo?: (symbol: WetterSymbol) => void,
) {
    const werkzeugfenster = createWerkzeugfenster(undefined);
    const voll: WetterEditorApi = {
        lade: vi.fn(() => Promise.resolve(antwort())),
        presetWerte: vi.fn(() => Promise.resolve(quittung([]))),
        presetZeitpunkt: vi.fn(() => Promise.resolve(quittung([]))),
        presetAnlegen: vi.fn(() => Promise.resolve(quittung([]))),
        presetEntfernen: vi.fn(() => Promise.resolve(quittung([]))),
        symbolAnlegen: vi.fn(() => Promise.resolve(quittung([]))),
        symbolAendern: vi.fn(() => Promise.resolve(quittung([]))),
        symbolEntfernen: vi.fn(() => Promise.resolve(quittung([]))),
        wikiArtikel: vi.fn(() => Promise.resolve([])),
        ...api,
    };
    const editor = createWettereditor({
        werkzeugfenster,
        darf: () => darf,
        reisebeginn: () => reise,
        mitte: () => lngLatAus({ x: 300, z: 400 }),
        api: voll,
        warteMs: 0,
        ...(zeigeInfo === undefined ? {} : { zeigeInfo }),
    });
    return { editor, api: voll, werkzeugfenster };
}

describe("Steuerung des Wetter-Editors", () => {
    afterEach(() => vi.useRealTimers());

    it("🔴 öffnet EIN Fenster, wählt das geltende Preset und verbindet die Karte nur, solange es zu sehen ist", async () => {
        const { editor, werkzeugfenster } = editorMit({});
        editor.oeffneWerkzeug();
        editor.oeffneWerkzeug();
        await editor.lade();
        expect(editor.fenster.value).toHaveLength(1);
        expect(editor.gewaehlt.value).toBe("p-u");
        expect(editor.anschluss.value?.symbole).toHaveLength(WETTER_SYMBOL_VORGABEN.length);
        expect(editor.anschluss.value?.symbole[0]).not.toHaveProperty("revision");
        werkzeugfenster.setzeLage(editor.fenster.value[0]!.id, "versenkt");
        expect(editor.anschluss.value).toBeUndefined();
    });

    it("🔴 ein gewähltes Icon meldet sich für sein Infopanel im Hintergrund, ein Preset nicht (Lasche „Info“, Betreiber 2026-11-08)", async () => {
        const zeigeInfo = vi.fn();
        const { editor } = editorMit({}, true, null, zeigeInfo);
        editor.oeffneWerkzeug();
        await editor.lade();
        const icon = editor.bestand.value!.symbole[0]!;
        editor.waehle(icon.id);
        editor.waehle(icon.id);
        editor.waehle("p-praios");
        expect(zeigeInfo).toHaveBeenCalledTimes(1);
        expect(zeigeInfo).toHaveBeenCalledWith(icon);
    });

    it("🔴 ein Wert gilt sofort im Stand und geht entprellt mit baseRevision; die Quittung hebt die Revision", async () => {
        vi.useFakeTimers();
        const presetWerte = vi.fn((id: string) =>
            Promise.resolve(quittung([{ kind: "wetter_preset", id, revision: 1 }])),
        );
        const { editor } = editorMit({ presetWerte });
        editor.oeffneWerkzeug();
        await editor.lade();
        editor.setzeWert("p-praios", "tn", 1.337);
        editor.setzeWert("p-praios", "ts", 33);
        expect(editor.bestand.value!.presets.find((p) => p.id === "p-praios")!.werte["tn"]).toBe(1.3);
        await vi.advanceTimersByTimeAsync(1);
        expect(presetWerte).toHaveBeenCalledWith("p-praios", 0, { tn: 1.3, ts: 33 });
        expect(editor.bestand.value!.presets.find((p) => p.id === "p-praios")!.revision).toBe(1);
        editor.setzeWert("p-praios", "tn", 2);
        await vi.advanceTimersByTimeAsync(1);
        expect(presetWerte).toHaveBeenLastCalledWith("p-praios", 1, { tn: 2 });
    });

    it("🔴 Idee B: „Unbestimmt“ fragt erst, „Tauschen“ schreibt, „Zurücknehmen“ legt zurück", async () => {
        const presetZeitpunkt = vi.fn(() =>
            Promise.resolve(
                quittung([
                    { kind: "wetter_preset", id: "p-praios", revision: 1 },
                    { kind: "wetter_preset", id: "p-u", revision: 1 },
                ]),
            ),
        );
        const { editor } = editorMit({ presetZeitpunkt });
        editor.oeffneWerkzeug();
        await editor.lade();
        editor.waehle("p-praios");
        editor.setzeZeitpunkt("p-praios", null);
        expect(editor.tausch.value).toEqual({ id: "p-praios", mit: "p-u", ziel: null });
        expect(presetZeitpunkt).not.toHaveBeenCalled();
        editor.bestaetigeTausch();
        await ruhe();
        await nextTick();
        expect(presetZeitpunkt).toHaveBeenCalledWith("p-praios", 0, null);
        expect(editor.bestand.value!.presets.find((p) => p.id === "p-u")!.tag).toBe(15);
        expect(editor.hinweis.value?.satz).toBe(
            "Dieses Preset ist jetzt der Kartenstandard. Das bisherige steht dafür am 15. Praios.",
        );
        editor.nimmZurueck();
        await ruhe();
        expect(presetZeitpunkt).toHaveBeenLastCalledWith("p-praios", 1, 15);
        expect(editor.bestand.value!.presets.find((p) => p.id === "p-praios")!.tag).toBe(15);
        expect(editor.bestand.value!.presets.find((p) => p.id === "p-u")!.tag).toBeNull();
        // Das unbestimmte auf einen freien Tag: kein Weg zum Server, ein Satz.
        editor.setzeZeitpunkt("p-u", 20);
        expect(editor.zeitProblem.value).toMatch(/muss unbestimmt bleiben/);
        expect(presetZeitpunkt).toHaveBeenCalledTimes(2);
    });

    it("🔴 Anlegen nimmt die Kennung des Servers und wählt das neue Icon; Entfernen nimmt es heraus", async () => {
        const NEU = "0288aaaa-0000-4000-8000-000000000001";
        const symbolAnlegen = vi.fn(() => Promise.resolve(quittung([{ kind: "wetter_symbol", id: NEU, revision: 1 }])));
        const symbolEntfernen = vi.fn(() =>
            Promise.resolve(quittung([{ kind: "wetter_symbol", id: NEU, revision: 2 }])),
        );
        const { editor } = editorMit({ symbolAnlegen, symbolEntfernen });
        editor.oeffneWerkzeug();
        await editor.lade();
        await editor.legeAn("wirbel");
        expect(symbolAnlegen).toHaveBeenCalledWith(
            expect.objectContaining({ art: "wirbel", richtung: null, drehsinn: -1, x: 300, z: 400 }),
        );
        expect(editor.gewaehlt.value).toBe(NEU);
        expect(editor.bestand.value!.symbole.at(-1)).toMatchObject({ id: NEU, revision: 1, art: "wirbel" });
        await editor.entferne(NEU);
        expect(symbolEntfernen).toHaveBeenCalledWith(NEU, 1);
        expect(editor.bestand.value!.symbole.some((s) => s.id === NEU)).toBe(false);
        expect(editor.gewaehlt.value).toBe(WETTER_SYMBOL_VORGABEN.at(-1)!.id);
    });

    it("🔴 ✚ Mahlstrom: kleiner und schwächer als ein Wirbel, Drehsinn 1, keine Richtung", async () => {
        const NEU = "0288aaaa-0000-4000-8000-000000000002";
        const symbolAnlegen = vi.fn(() => Promise.resolve(quittung([{ kind: "wetter_symbol", id: NEU, revision: 1 }])));
        const { editor } = editorMit({ symbolAnlegen });
        editor.oeffneWerkzeug();
        await editor.lade();
        await editor.legeAn("mahlstrom");
        expect(symbolAnlegen).toHaveBeenCalledWith(
            expect.objectContaining({ art: "mahlstrom", richtung: null, drehsinn: 1, reichweite: 60, staerke: 4 }),
        );
        expect(editor.bestand.value!.symbole.at(-1)).toMatchObject({ id: NEU, art: "mahlstrom", drehsinn: 1 });
    });

    it("🔴 Preset anlegen: am Tag des Reisebeginns, wenn frei, sonst in der größten Lücke; die Werte sind die Überblendung; das neue Preset ist gewählt", async () => {
        const presetAnlegen = vi.fn(() =>
            Promise.resolve(quittung([{ kind: "wetter_preset", id: "p-neuespreset", revision: 1 }])),
        );
        // Reisebeginn am 20. Praios (Tag 20): frei, also dort.
        const frei = editorMit({ presetAnlegen }, true, { month: "praios", day: 20 });
        frei.editor.oeffneWerkzeug();
        await frei.editor.lade();
        await frei.editor.legePresetAn();
        expect(presetAnlegen).toHaveBeenCalledWith(20);
        const neu = frei.editor.bestand.value!.presets.at(-1)!;
        expect(neu).toMatchObject({ id: "p-neuespreset", tag: 20, revision: 1 });
        expect(neu.werte).toEqual(wetterNeuePresetWerte(WETTER_PRESET_VORGABEN, 20));
        expect(frei.editor.bestand.value!.presets).toHaveLength(15);
        expect(frei.editor.gewaehlt.value).toBe("p-neuespreset");
        // Die Liste kennt jetzt 15 Presets; der Name kommt aus dem Tag, nicht aus der Kennung.
        const zeilen = wetterZeilen(frei.editor.bestand.value!, null);
        expect(zeilen.filter((z) => z.gruppe === "presets")).toHaveLength(15);
        expect(zeilen.find((z) => z.key === "p-neuespreset")!.name).toBe("20. Praios");

        // Reisebeginn am 15. Praios (belegt) und ohne Reisebeginn: die Mitte der ersten größten Lücke (30).
        for (const reise of [{ month: "praios" as const, day: 15 }, null]) {
            presetAnlegen.mockClear();
            const { editor } = editorMit({ presetAnlegen }, true, reise);
            editor.oeffneWerkzeug();
            await editor.lade();
            await editor.legePresetAn();
            expect(presetAnlegen).toHaveBeenCalledWith(30);
        }
    });

    it("🔴 Preset anlegen ohne Schreibrecht oder bei Fehler ändert den Bestand nicht", async () => {
        const presetAnlegen = vi.fn(() => Promise.resolve(quittung([])));
        const lesend = editorMit({ presetAnlegen }, false);
        lesend.editor.oeffneWerkzeug();
        await lesend.editor.lade();
        await lesend.editor.legePresetAn();
        expect(presetAnlegen).not.toHaveBeenCalled();

        const fehler = editorMit({
            presetAnlegen: vi.fn(() =>
                Promise.resolve({
                    ok: false as const,
                    status: 409,
                    fehler: { code: "tag_belegt", message: "An diesem Tag liegt schon ein Preset." },
                }),
            ),
        });
        fehler.editor.oeffneWerkzeug();
        await fehler.editor.lade();
        await fehler.editor.legePresetAn();
        expect(fehler.editor.bestand.value!.presets).toHaveLength(14);
        expect(fehler.editor.meldung.value?.text).toMatch(/An diesem Tag liegt schon ein Preset/);
    });

    it("🔴 Preset entfernen: nur ein angelegtes, nicht der Kartenstandard, nie eines der 14", async () => {
        const presetAnlegen = vi.fn(() =>
            Promise.resolve(quittung([{ kind: "wetter_preset", id: "p-neuespreset", revision: 1 }])),
        );
        const presetEntfernen = vi.fn(() =>
            Promise.resolve(quittung([{ kind: "wetter_preset", id: "p-neuespreset", revision: 2 }])),
        );
        const { editor } = editorMit({ presetAnlegen, presetEntfernen }, true, { month: "praios", day: 20 });
        editor.oeffneWerkzeug();
        await editor.lade();
        // Eines der 14 und das unbestimmte: kein Weg zum Server.
        await editor.entfernePreset("p-praios");
        await editor.entfernePreset("p-u");
        expect(presetEntfernen).not.toHaveBeenCalled();
        await editor.legePresetAn();
        editor.frageEntfernen("p-neuespreset");
        expect(editor.entfernenFrage.value).toBe("p-neuespreset");
        await editor.entfernePreset("p-neuespreset");
        expect(presetEntfernen).toHaveBeenCalledWith("p-neuespreset", 1);
        expect(editor.bestand.value!.presets).toHaveLength(14);
        expect(editor.entfernenFrage.value).toBeUndefined();
        // Gewählt ist danach das Preset davor, hier das letzte der 14 (der Namenlose).
        expect(editor.gewaehlt.value).toBe("p-namenlos");
    });

    it("🔴 ein Konflikt meldet sich und lädt neu; ein Zug auf der Karte speichert erst beim Loslassen", async () => {
        vi.useFakeTimers();
        const symbolAendern = vi.fn(() => Promise.resolve(konflikt()));
        const lade = vi.fn(() => Promise.resolve(antwort()));
        const { editor } = editorMit({ symbolAendern, lade });
        editor.oeffneWerkzeug();
        await editor.lade();
        const id = WETTER_SYMBOL_VORGABEN[0]!.id;
        editor.anschluss.value!.ziehe(id, { x: 100, z: 200 }, false);
        await vi.advanceTimersByTimeAsync(5);
        expect(symbolAendern).not.toHaveBeenCalled();
        expect(editor.bestand.value!.symbole[0]).toMatchObject({ x: 100, z: 200 });
        editor.anschluss.value!.ziehe(id, { x: 110, z: 210 }, true);
        await vi.advanceTimersByTimeAsync(5);
        expect(symbolAendern).toHaveBeenCalledWith(id, 0, { x: 110, z: 210 });
        expect(editor.meldung.value?.ton).toBe("warnung");
        expect(lade).toHaveBeenCalledTimes(2);
        expect(editor.bestand.value!.symbole[0]).toMatchObject({ x: WETTER_SYMBOL_VORGABEN[0]!.x });
    });

    it("🔴 wie die übrigen Editoren: Suche, Filter und Sortierung bleiben über Schließen und Öffnen; die Handgriffe öffnen an einem Icon", async () => {
        vi.useFakeTimers();
        const symbolAendern = vi.fn((id: string) =>
            Promise.resolve(quittung([{ kind: "wetter_symbol", id, revision: 1 }])),
        );
        const { editor, werkzeugfenster } = editorMit({ symbolAendern });
        // Die Einstellung der Liste gehört der Steuerung, nicht dem Fenster.
        expect(editor.listenEinstellung.sortierung.value).toBe("kalender");
        editor.listenEinstellung.suche.value = "Passat";
        editor.oeffneWerkzeug();
        werkzeugfenster.schliesse(editor.fenster.value[0]!.id);
        expect(editor.fenster.value).toHaveLength(0);
        expect(editor.listenEinstellung.suche.value).toBe("Passat");
        // „Eigenschaften bearbeiten“ im Kartenmenü: Fenster auf, Stand gelesen, das Icon gewählt.
        const id = WETTER_SYMBOL_VORGABEN[1]!.id;
        await editor.oeffneFuer(id);
        expect(editor.fenster.value).toHaveLength(1);
        expect(editor.gewaehlt.value).toBe(id);
        // „Verbergen“: sofort im Stand, entprellt geschrieben wie jede Änderung.
        await editor.setzeSichtbar(id, false);
        expect(editor.bestand.value!.symbole.find((s) => s.id === id)?.sichtbar).toBe(false);
        await vi.advanceTimersByTimeAsync(500);
        expect(symbolAendern).toHaveBeenCalledWith(id, 0, { sichtbar: false });
    });

    it("ohne Schreibrecht ändert nichts den Stand", async () => {
        const { editor, api } = editorMit({}, false);
        editor.oeffneWerkzeug();
        await editor.lade();
        editor.setzeWert("p-u", "tn", 3);
        editor.setzeSymbol(WETTER_SYMBOL_VORGABEN[0]!.id, { sichtbar: false });
        await editor.legeAn("wind");
        expect(editor.bestand.value!.presets[0]!.werte["tn"]).toBe(WETTER_UNBESTIMMT.tn);
        expect(api.symbolAnlegen).not.toHaveBeenCalled();
        expect(editor.anschluss.value?.darf).toBe(false);
    });
});

describe("Griffe und Kamera der Karte", () => {
    const wind: EngineSymbol = {
        id: "w",
        kind: "wind",
        x: 500,
        z: 500,
        dir: 0,
        s: 10,
        r: 100,
        spin: -1,
        name: "",
        nameZeigen: false,
        sichtbar: true,
        wiki: "",
    };

    it("🔴 die Scheibe verschiebt um den Weg des Zeigers, die Pfeilspitze setzt Richtung und Stärke, der Ring die Reichweite", () => {
        expect(gezogen(wind, "ort", { x: 505, z: 505 }, { x: 515, z: 485 })).toEqual({ x: 510, z: 480 });
        expect(gezogen(wind, "ort", { x: 0, z: 0 }, { x: 900, z: -50 })).toEqual({ x: 1024, z: 450 });
        const spitze = gezogen(wind, "pfeil", { x: 0, z: 0 }, { x: 500, z: 430 });
        // Nach Norden (−z) 70 Einheiten: Richtung 0 ° nach der Windrose, Stärke 70 / 7 = 10.
        expect(zugAus({ ...wind, ...spitze }, "pfeil")).toEqual({ richtung: 0, staerke: 10 });
        expect(gezogen(wind, "ring", { x: 0, z: 0 }, { x: 500, z: 2000 })).toEqual({ r: 600 });
        expect(zugAus({ ...wind, x: 1.234, z: 5.678 }, "ort")).toEqual({ x: 1.2, z: 5.7 });
    });

    it("die Kamera der Icons: Projektion und Strahl auf die Ebene sind zueinander invers", () => {
        // Eine Perspektive von oben, das Auge bei (500, 10, 500): w = 10 − y, Norden (−z) oben im Bild; das Auge bildet auf (0, 0, 11, 0) ab.
        const m = Float64Array.from([0.1, 0, 0, 0, 0, 0, 1, -1, 0, -0.1, 0, 0, -50, 50, 1, 10]);
        const inv = umkehrung(m)!;
        const id = mal(m, inv);
        for (let i = 0; i < 16; i++) expect(id[i]!).toBeCloseTo(i % 5 === 0 ? 1 : 0, 9);
        const p = projiziere(m, 800, 600, 520, 1, 480)!;
        const zurueck = schneide(inv, 800, 600, p.x, p.y, 1);
        expect(zurueck?.x).toBeCloseTo(520, 3);
        expect(zurueck?.z).toBeCloseTo(480, 3);
    });

    it("Karteneinheiten und Länge und Breite der Karte sind zueinander invers", () => {
        const welt = weltAus(lngLatAus({ x: 341, z: 617 }));
        expect(welt.x).toBeCloseTo(341, 6);
        expect(welt.z).toBeCloseTo(617, 6);
    });
});
