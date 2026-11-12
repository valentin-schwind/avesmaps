import { computed, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { WetterBestand } from "../src/wettereditor/wetter-editor-modell";
import { createWetterKartenmenue } from "../src/wettereditor/wetter-kartenmenue.ts";
import { createWettereditorHuelle, type WettereditorQuelle } from "../src/wettereditor/wettereditor-huelle.ts";
import type { Wettereditor, WettereditorOptionen } from "../src/wettereditor/wettereditor-steuerung";

/**
 * Die Hülle des Wetter-Editors im Startpaket (WI-0288, Besucherpaket 2026-11-08): Die Steuerung lädt nach. Problemfälle: Editoren (Steuerung vor dem Einhängen geladen)
 * bekommen das Fenster einen Takt später als vorher; ein Besucher lädt die Steuerung, ohne den Editor zu öffnen; zwei schnelle Handgriffe legen zwei Editoren an; ein
 * gescheitertes Laden wirft ins Leere; nach dem Abbau entsteht noch ein Editor.
 */
const BESTAND: WetterBestand = { presets: [], symbole: [] };
const ID = "02880000-0000-4000-8000-000000000001";

function falscherEditor(): Wettereditor {
    const bestand = shallowRef<WetterBestand | undefined>(BESTAND);
    return {
        bestand,
        anschluss: computed(() => undefined),
        oeffneWerkzeug: vi.fn(),
        oeffneFuer: vi.fn(() => Promise.resolve()),
        setzeSichtbar: vi.fn(() => Promise.resolve()),
        frageEntfernen: vi.fn(),
        destroy: vi.fn(),
    } as unknown as Wettereditor;
}

const OPTIONEN = { darf: () => true } as unknown as WettereditorOptionen;

function quelle(vorab: boolean): WettereditorQuelle & { angelegt: Wettereditor[]; laden: ReturnType<typeof vi.fn> } {
    const angelegt: Wettereditor[] = [];
    const steuerung = {
        createWettereditor: () => {
            const editor = falscherEditor();
            angelegt.push(editor);
            return editor;
        },
    };
    return {
        angelegt,
        laden: vi.fn(() => Promise.resolve(steuerung)),
        geladen: () => (vorab ? steuerung : undefined),
    };
}

describe("Die Hülle des Wetter-Editors", () => {
    it("🔴 Editoren: Die Steuerung ist schon geladen, der Editor steht beim Aufbau, und das Fenster geht im selben Takt auf", () => {
        const q = quelle(true);
        const huelle = createWettereditorHuelle(OPTIONEN, q);
        expect(q.angelegt).toHaveLength(1);
        expect(huelle.bestand.value).toBe(BESTAND);
        huelle.oeffneWerkzeug();
        // Ohne `await`: Das Werkzeug ist schon auf.
        expect(q.angelegt[0]!.oeffneWerkzeug).toHaveBeenCalledTimes(1);
        expect(q.laden).not.toHaveBeenCalled();
    });

    it("🔴 Besucher: Nichts lädt, bis jemand öffnet; zwei schnelle Aufrufe legen EINEN Editor an", async () => {
        const q = quelle(false);
        const huelle = createWettereditorHuelle(OPTIONEN, q);
        expect(huelle.editor.value).toBeUndefined();
        expect(huelle.bestand.value).toBeUndefined();
        expect(huelle.anschluss.value).toBeUndefined();
        expect(q.laden).not.toHaveBeenCalled();
        huelle.oeffneWerkzeug();
        await huelle.mit((editor) => editor.oeffneFuer(ID));
        expect(q.angelegt).toHaveLength(1);
        expect(q.angelegt[0]!.oeffneWerkzeug).toHaveBeenCalledTimes(1);
        expect(q.angelegt[0]!.oeffneFuer).toHaveBeenCalledWith(ID);
        expect(huelle.bestand.value).toBe(BESTAND);
    });

    it("nach dem Abbau entsteht kein Editor mehr; ein gescheitertes Laden meldet und gibt `undefined`", async () => {
        const q = quelle(false);
        const huelle = createWettereditorHuelle(OPTIONEN, q);
        const offen = huelle.mit(() => "fertig");
        huelle.destroy();
        expect(await offen).toBeUndefined();
        expect(q.angelegt).toHaveLength(0);

        const fehler = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const kaputt = createWettereditorHuelle(OPTIONEN, {
            laden: () => Promise.reject(new Error("Chunk fehlt")),
            geladen: () => undefined,
        });
        expect(await kaputt.mit(() => "fertig")).toBeUndefined();
        expect(fehler).toHaveBeenCalledWith("Der Wetter-Editor ließ sich nicht laden", expect.any(Error));
        fehler.mockRestore();
    });

    it("🔴 die Handgriffe im Kartenmenü laden die Steuerung, wo sie fehlt, und öffnen erst, dann schalten sie", async () => {
        const q = quelle(false);
        const huelle = createWettereditorHuelle(OPTIONEN, q);
        const zeigeEditor = vi.fn();
        const menue = createWetterKartenmenue({
            editor: huelle,
            lage: () => ({ bearbeiten: { mapEditing: "testwelt" }, laeuft: false }),
            zeigeEditor,
        });
        const subject = {
            ref: { kind: "wetterSymbol", id: ID },
            title: "Westwinddrift",
            art: "Wind",
            answer: undefined,
        };
        // Ungelesen gilt ein Icon als gezeigt: „Verbergen“ steht da, ohne dass etwas lädt.
        expect(q.laden).not.toHaveBeenCalled();
        menue.handgriffe.find((griff) => griff.id === "wetter-verbergen")!.run({ subject } as never);
        expect(zeigeEditor).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(q.angelegt[0]?.setzeSichtbar).toHaveBeenCalledWith(ID, false));
        expect(q.angelegt[0]!.oeffneFuer).toHaveBeenCalledWith(ID);
        menue.handgriffe.find((griff) => griff.id === "wetter-entfernen")!.run({ subject } as never);
        await vi.waitFor(() => expect(q.angelegt[0]!.frageEntfernen).toHaveBeenCalledWith(ID));
        expect(q.angelegt).toHaveLength(1);
    });
});
