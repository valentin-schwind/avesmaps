import { describe, expect, it, vi } from "vitest";
import type { EditorLock, EditorPowerlineDetail, EditorPowerlineList } from "@avesmaps3d/shared";
import type { NimmErgebnis } from "../src/editor-sperre/sperre";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster.ts";
import { createKraftlinieneditorSteuerung } from "../src/kraftlinieneditor/kraftlinieneditor-steuerung.ts";

/**
 * Der Kraftlinien-Editor je Linie ein Fenster (WI-0205 auf O3; EDIT-0003 T44, D19, R1). Problemfälle: Ein Klick auf einen anderen
 * Abschnitt derselben Linie öffnet ein zweites Fenster; der Klick in der Liste verwirft den Entwurf des Fensters; ein im Browser
 * gesicherter Entwurf ist nach dem Neuladen nicht mehr zu finden; die erste Feldänderung nimmt keine Sperre.
 */

const ANKER = "0e0e0e0e-0000-4000-8000-000000000001";
const ZWEITER = "0e0e0e0e-0000-4000-8000-000000000002";
const ANDERE = "0e0e0e0e-0000-4000-8000-000000000009";
const linie = (id: string, name: string, segmente: string[]): EditorPowerlineDetail =>
    ({
        id,
        name,
        circle: "voll",
        shape: "strang",
        segments: segmente.map((s, i) => ({
            id: s,
            from: `k${String(i)}`,
            to: `k${String(i + 1)}`,
            curve: null,
            labelVisible: true,
            revision: 2,
        })),
        nodes: [],
    }) as EditorPowerlineDetail;
const LINIEN = new Map([
    [ANKER, linie(ANKER, "Ley von Gareth", [ANKER, ZWEITER])],
    [ZWEITER, linie(ANKER, "Ley von Gareth", [ANKER, ZWEITER])],
    [ANDERE, linie(ANDERE, "Ley von Punin", [ANDERE])],
]);
const LISTE: EditorPowerlineList = {
    rows: [
        { id: ANKER, name: "Ley von Gareth", circle: "voll", shape: "strang", segments: 2, nodes: 3 },
        { id: ANDERE, name: "Ley von Punin", circle: "voll", shape: "strang", segments: 1, nodes: 2 },
    ],
};

/** Ein Speicher wie `localStorage`, im Speicher. */
function speicher(): Storage {
    const werte = new Map<string, string>();
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

function aufbau(browser: Storage = speicher()) {
    const fetcher = vi.fn(async (eingabe: string | URL | Request) => {
        const url = String(eingabe);
        const id = url.slice(url.lastIndexOf("/") + 1);
        if (url.endsWith("/api/editor/powerlines")) return new Response(JSON.stringify(LISTE), { status: 200 });
        const gefunden = LINIEN.get(id);
        return gefunden === undefined
            ? new Response("{}", { status: 404 })
            : new Response(JSON.stringify(gefunden), { status: 200 });
    });
    const genommen: string[] = [];
    const sperre = {
        nimm: vi.fn(async (ziel: { id: string }, teil: EditorLock["part"]): Promise<NimmErgebnis> => {
            genommen.push(`${ziel.id}:${teil}`);
            return { art: "genommen", sperre: { own: true } as EditorLock };
        }),
        gib: vi.fn(),
        beiVerlust: () => () => undefined,
    };
    const werkzeugfenster = createWerkzeugfenster(undefined);
    const steuerung = createKraftlinieneditorSteuerung(werkzeugfenster, fetcher, undefined, {
        sperre,
        geaendert: vi.fn(),
        speicher: browser,
        darfSchreiben: () => true,
    });
    return { steuerung, werkzeugfenster, genommen, browser, sperre };
}

describe("Kraftlinien-Editor: je Linie ein Fenster", () => {
    it("🔴 ein Klick auf einen anderen Abschnitt derselben Linie holt ihr Fenster, statt ein zweites zu öffnen", async () => {
        const { steuerung } = aufbau();
        expect(
            steuerung.geoeffnet({ kind: "powerline", anchor: ZWEITER }, { source: "map", camera: "none" }, true),
        ).toBe(true);
        await vi.waitFor(() => expect(steuerung.fenster.value.map((f) => f.gegenstand)).toEqual([ANKER]));
        await vi.waitFor(() => expect(steuerung.bearbeitungVon(ANKER)?.zustand.value.art).toBe("bereit"));
        const bearbeitung = await steuerung.oeffneFuer(ANKER);
        expect(bearbeitung).toBe(steuerung.bearbeitungVon(ANKER));
        await steuerung.oeffneFuer(ZWEITER);
        expect(steuerung.fenster.value).toHaveLength(1);
        steuerung.geoeffnet({ kind: "powerline", anchor: ZWEITER }, { source: "map", camera: "none" }, true);
        expect(steuerung.fenster.value.map((f) => f.gegenstand)).toEqual([ANKER]);
        steuerung.destroy();
    });

    it("🔴 der Klick auf der Karte öffnet das Fenster sofort, nicht erst nach dem Lesen der Linie (WI-0218 c1)", () => {
        // Gleich nach `geoeffnet` misst die Kamera das Fenster (`holeGeklicktesHervor` in app.vue). Öffnete es erst nach dem Lesen,
        // fand sie keines, blieb stehen, und bei 1920 px lag die Kraftlinie danach unter dem Fenster.
        const { steuerung } = aufbau();
        steuerung.geoeffnet({ kind: "powerline", anchor: ZWEITER }, { source: "map", camera: "none" }, true);
        expect(steuerung.fenster.value).toEqual([expect.objectContaining({ gegenstand: ZWEITER })]);
        steuerung.destroy();
    });

    it("🔴 die erste Feldänderung beginnt (Sperre `felder`); der Klick in der Liste legt das Fenster samt Entwurf ab (D19)", async () => {
        const { steuerung, genommen } = aufbau();
        const bearbeitung = (await steuerung.oeffneFuer(ANKER))!;
        await vi.waitFor(() => expect(bearbeitung.zustand.value.art).toBe("bereit"));
        bearbeitung.feld((f) => ({ ...f, description: "Eine Ader." }), "description");
        expect(steuerung.aktiv.value).toBe(bearbeitung);
        await vi.waitFor(() => expect(genommen).toEqual([`${ANKER}:felder`]));
        await vi.waitFor(() => expect(steuerung.fenster.value[0]?.ungespeichert).toBe(true));
        steuerung.waehle(ANDERE);
        const [abgelegt, neu] = steuerung.fenster.value;
        expect(abgelegt).toMatchObject({ gegenstand: ANKER, lage: "versenkt", ungespeichert: true });
        expect(neu?.gegenstand).toBe(ANDERE);
        expect(steuerung.bearbeitungVon(ANKER)?.stand.value?.felder.description).toBe("Eine Ader.");
        steuerung.destroy();
    });

    it("🔴 „Trotzdem schließen“ verwirft den Entwurf ganz: Sperre frei, nach dem Neuladen keine Zeile mehr (WI-0231)", async () => {
        // Der Anschluss steht in app.vue (`entwurfImFenster`); ohne ihn ginge nur die Zeile, und die Sicherung brächte den Entwurf zurück.
        const erst = aufbau();
        erst.werkzeugfenster.beimVerwerfen(
            (fenster) => void erst.steuerung.bearbeitungVon(fenster.gegenstand)?.antworte("verwerfen"),
        );
        const bearbeitung = (await erst.steuerung.oeffneFuer(ANKER))!;
        await vi.waitFor(() => expect(bearbeitung.zustand.value.art).toBe("bereit"));
        bearbeitung.feld((f) => ({ ...f, name: "Ley von Gareth am Großen Fluss" }), "name");
        bearbeitung.feldVerlassen();
        await vi.waitFor(() => expect(erst.steuerung.fenster.value[0]?.ungespeichert).toBe(true));
        const fensterId = erst.steuerung.fenster.value[0]!.id;
        erst.werkzeugfenster.setzeLage(fensterId, "versenkt");
        const frage = erst.werkzeugfenster.schliesseZeile(fensterId);
        expect(frage?.ids).toEqual([fensterId]);
        for (const id of frage!.ids) erst.werkzeugfenster.verwirf(id);
        expect(erst.steuerung.fenster.value).toEqual([]);
        expect(erst.sperre.gib).toHaveBeenCalled();
        erst.steuerung.destroy();

        const dann = aufbau(erst.browser);
        expect(dann.steuerung.fenster.value).toEqual([]);
        dann.steuerung.destroy();
    });

    it("🔴 nach dem Neuladen steht ein gesicherter Entwurf unter „Offene Bearbeitungen“ und stellt sich her (R1)", async () => {
        const erst = aufbau();
        const bearbeitung = (await erst.steuerung.oeffneFuer(ANKER))!;
        await vi.waitFor(() => expect(bearbeitung.zustand.value.art).toBe("bereit"));
        bearbeitung.feld((f) => ({ ...f, name: "Ley von Gareth am Großen Fluss" }), "name");
        bearbeitung.feldVerlassen();
        erst.steuerung.destroy();

        const dann = aufbau(erst.browser);
        expect(dann.steuerung.fenster.value).toEqual([
            expect.objectContaining({ gegenstand: ANKER, lage: "versenkt", ungespeichert: true }),
        ]);
        const wieder = dann.steuerung.bearbeitungVon(ANKER)!;
        await vi.waitFor(() => expect(wieder.stand.value?.felder.name).toBe("Ley von Gareth am Großen Fluss"));
        expect(wieder.lage.value).toMatchObject({ aktiv: true, ungespeichert: 1 });
        dann.steuerung.destroy();
    });

    it("🔴 WI-0238: Häkchen vor dem Umschalter bleiben, ab zwei eine Sammelansicht, ↺ stellt die Leiste, Schließen nimmt sie mit", async () => {
        const { steuerung, werkzeugfenster } = aufbau();
        await steuerung.oeffneFuer(ANKER);
        const fensterId = steuerung.fenster.value[0]!.id;
        // Die Liste meldet beim Einschalten erst die Häkchen (die gewählte Zeile), dann den Umschalter.
        steuerung.setzeAngehakt(fensterId, [ANKER]);
        steuerung.setzeMehrfach(fensterId, true);
        expect(steuerung.mehrfachVon(fensterId)).toEqual({ mehrfach: true, angehakt: [ANKER] });
        expect(steuerung.sammelVon(fensterId)).toBeUndefined();
        steuerung.setzeAngehakt(fensterId, [ANKER, ANDERE]);
        const sammel = steuerung.sammelVon(fensterId);
        expect(sammel?.ids).toEqual([ANKER, ANDERE]);
        // Was angehakt ist, leuchtet auf der Karte (map/mehrfach-markierung.ts, Art powerline).
        expect(steuerung.mehrfachAngehakt.value).toEqual([ANKER, ANDERE]);
        // Derselbe Satz Häkchen in anderer Folge ist dieselbe Auswahl (kein neues Lesen, kein verlorener Entwurf).
        steuerung.setzeAngehakt(fensterId, [ANDERE, ANKER]);
        expect(steuerung.sammelVon(fensterId)).toBe(sammel);
        await vi.waitFor(() => expect(sammel!.details.value.size).toBe(2));
        expect(steuerung.sammelAktiv.value).toBeUndefined();
        sammel!.entwurf.aufWiki("description");
        expect(steuerung.sammelAktiv.value).toBe(sammel);
        expect(steuerung.esc()).toBe(true);
        sammel!.entwurf.verwerfen();
        werkzeugfenster.schliesse(fensterId);
        await vi.waitFor(() => expect(steuerung.sammelVon(fensterId)).toBeUndefined());
        expect(steuerung.mehrfachVon(fensterId)).toEqual({ mehrfach: false, angehakt: [] });
        expect(steuerung.mehrfachAngehakt.value).toEqual([]);
        steuerung.destroy();
    });
});
