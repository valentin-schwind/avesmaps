import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { EditorPathList, EditorPathRow, EditorPathStreet } from "@avesmaps3d/shared";
import { buildMehrfachMarkierungLayers, createMehrfachMarkierung } from "../src/map/mehrfach-markierung";
import type { Werkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { sammelWerte, wegMarke } from "../src/wegeditor/weg-sammel";
import { createWegeditorSteuerung } from "../src/wegeditor/wegeditor-steuerung";

/**
 * Die Mehrfachauswahl der Wege (WI-0252; Betreiber 2026-10-24: „die mehrfach auswahl von wegen wär super“), dazu die zentrale Regel
 * „Esc und ein Klick in die Karte heben sie auf“. Problemfälle: Ein Umschalt-Klick auf einen Abschnitt hakt den Abschnitt statt seiner
 * Straße an, ein namenloser Abschnitt (ein Weg für sich) findet keine Zeile, die Straße des Fensters zählt beim Einschalten nicht mit, ein
 * zweiter Umschalt-Klick nimmt sie nicht heraus; auf der Karte leuchtet eine Straße nur an einem Abschnitt; gemischte Werte stehen als
 * der Wert des ersten Wegs da; `hebeAuf` hört nach dem ersten Editor auf.
 */

const row = (teil: Partial<EditorPathRow> & { id: string }): EditorPathRow => ({
    name: "",
    subtype: "Weg",
    isBach: false,
    circle: "halb-rechts",
    segments: 1,
    ...teil,
});
const RS = "11111111-1111-4111-8111-111111111111";
const RS2 = "11111111-1111-4111-8111-111111111112";
const GRIFF = "33333333-3333-4333-8333-333333333333";
const OHNE = "44444444-4444-4444-8444-444444444444";
const LISTE: EditorPathList = {
    rows: [
        row({ id: RS, name: "Reichsstraße 3", subtype: "Reichsstrasse", segments: 2 }),
        row({ id: GRIFF, name: "Weg-6029", subtype: "Weg" }),
        row({ id: OHNE, name: "", subtype: "Pfad" }),
    ],
};
const strasse = (id: string): EditorPathStreet =>
    id === RS
        ? {
              id: RS,
              name: "Reichsstraße 3",
              subtype: "Reichsstrasse",
              isBach: false,
              circle: "halb-rechts",
              labelVisible: null,
              wiki: { url: "https://x/rs3", title: "Reichsstraße 3" },
              segments: [
                  { id: RS, revision: 1, labelVisible: true, wiki: true, points: 5, art: "Reichsstrasse" },
                  { id: RS2, revision: 1, labelVisible: false, wiki: true, points: 3, art: "Reichsstrasse" },
              ],
          }
        : {
              id,
              name: id === GRIFF ? "Weg-6029" : "",
              subtype: id === GRIFF ? "Weg" : "Pfad",
              isBach: false,
              circle: "leer",
              labelVisible: true,
              segments: [
                  { id, revision: 2, labelVisible: true, wiki: false, points: 2, art: id === GRIFF ? "Weg" : "Pfad" },
              ],
          };

interface Fenster {
    id: string;
    werkzeug: string;
    gegenstand?: string | undefined;
    lage: string;
    vorn: number;
}
function aufbau() {
    const fenster = ref<Fenster[]>([]);
    let zaehler = 0;
    const neu = (f: { werkzeug: string; gegenstand?: string | undefined }): Fenster => {
        zaehler += 1;
        return {
            id: `f${String(zaehler)}`,
            werkzeug: f.werkzeug,
            gegenstand: f.gegenstand,
            lage: "angedockt",
            vorn: zaehler,
        };
    };
    const werkzeugfenster = {
        stand: computed(() => ({ fenster: fenster.value })),
        hervorholen: vi.fn(),
        markiere: vi.fn(),
        setzeLage: vi.fn(),
        oeffne: vi.fn((f: { werkzeug: string; gegenstand?: string }) => {
            const offen = neu(f);
            fenster.value = [...fenster.value, offen];
            return offen.id;
        }),
        oeffneAnStelle: vi.fn((an: string | undefined, f: { werkzeug: string; gegenstand?: string }) => {
            const offen = neu(f);
            fenster.value = [...fenster.value.filter((x) => x.id !== an), offen];
            return offen.id;
        }),
    } as unknown as Werkzeugfenster;
    const fetcher = vi.fn(async (url: string) => {
        if (url.endsWith("/api/editor/paths")) return new Response(JSON.stringify(LISTE));
        const id = url.split("/").at(-2)!;
        return new Response(JSON.stringify(strasse(id)));
    });
    const s = createWegeditorSteuerung(werkzeugfenster, fetcher as never);
    return { s, fenster };
}
const ruhe = () => new Promise((r) => setTimeout(r, 0));

describe("Wege: Mehrfachauswahl in der Steuerung", () => {
    it("🔴 Umschalt-Klick auf einen Abschnitt hakt seine STRASSE an; aus schaltet ein, die Straße des Fensters zählt mit; zweimal nimmt heraus", async () => {
        const a = aufbau();
        a.s.waehle(GRIFF);
        await ruhe();
        const fensterId = a.fenster.value[0]!.id;
        expect(a.s.umschaltBereit()).toBe(true);
        // Die Karte nennt eine Straße mit echtem Namen über ihre Kette, nie über den getroffenen Abschnitt.
        a.s.umschalteAufKarte("name:Reichsstraße 3");
        expect(a.s.mehrfachVon(fensterId)).toEqual({ mehrfach: true, angehakt: [GRIFF, RS] });
        // Ein namenloser Abschnitt ist ein Weg für sich: seine Kennung.
        a.s.umschalteAufKarte(OHNE);
        expect(a.s.mehrfachVon(fensterId).angehakt).toEqual([GRIFF, RS, OHNE]);
        a.s.umschalteAufKarte("name:Reichsstraße 3");
        expect(a.s.mehrfachVon(fensterId).angehakt).toEqual([GRIFF, OHNE]);
        // Unbekanntes (kein Weg der Liste) ändert nichts.
        a.s.umschalteAufKarte("name:Gibt es nicht");
        expect(a.s.mehrfachVon(fensterId).angehakt).toEqual([GRIFF, OHNE]);
    });

    it("🔴 ab zwei Haken eine Sammelansicht mit den gelesenen Straßen; auf der Karte leuchtet die Straße über ihren Namen, ein Griff über seine Kennung", async () => {
        const a = aufbau();
        a.s.waehle(RS);
        await ruhe();
        const fensterId = a.fenster.value[0]!.id;
        a.s.setzeMehrfach(fensterId, true);
        a.s.setzeAngehakt(fensterId, [RS, GRIFF]);
        const sammel = a.s.sammelVon(fensterId);
        expect(sammel?.ids).toEqual([RS, GRIFF]);
        await ruhe();
        await ruhe();
        expect([...(sammel?.strassen.value.keys() ?? [])]).toEqual([RS, GRIFF]);
        expect(a.s.markierung.value).toEqual(["name:Reichsstraße 3", GRIFF]);
        a.s.setzeAngehakt(fensterId, [RS]);
        expect(a.s.sammelVon(fensterId)).toBeUndefined();
    });

    it("🔴 aufheben schaltet jede Mehrfachauswahl aus und löst die Haken; ohne eine sagt es nein", async () => {
        const a = aufbau();
        a.s.waehle(RS);
        await ruhe();
        const fensterId = a.fenster.value[0]!.id;
        a.s.umschalteAufKarte(GRIFF);
        expect(a.s.aufheben()).toBe(true);
        expect(a.s.mehrfachVon(fensterId)).toEqual({ mehrfach: false, angehakt: [] });
        expect(a.s.markierung.value).toEqual([]);
        expect(a.s.aufheben()).toBe(false);
        // Das Fenster zeigt weiter seine Straße.
        expect(a.fenster.value[0]!.gegenstand).toBe(RS);
    });
});

describe("Wege: Werte der Sammelansicht", () => {
    it("🔴 gleich steht mit Wert, verschieden als gemischt; gezählt wird je Abschnitt", () => {
        const werte = sammelWerte([strasse(RS), strasse(GRIFF)]);
        expect(werte.name).toEqual({ gleich: false });
        expect(werte.wegtyp).toEqual({ gleich: false });
        expect(werte.nameAufKarte).toEqual({ gleich: false });
        expect(werte.tunnel).toEqual({ gleich: true, wert: false });
        expect(werte.karawanenroute).toEqual({ gleich: true, wert: false });
        expect(werte.artikel).toEqual({ gleich: false });
        expect(werte.abschnitte).toBe(3);
        // Ein Griff ist kein Name (WI-0105): zwei namenlose Wege heißen gleich, nämlich leer.
        expect(sammelWerte([strasse(GRIFF), strasse(OHNE)]).name).toEqual({ gleich: true, wert: "" });
    });

    it("die Marke der Karte: echter Name, sonst die Kennung; nicht auf der Karte immer die Kennung", () => {
        expect(wegMarke(LISTE.rows[0]!)).toBe("name:Reichsstraße 3");
        expect(wegMarke(LISTE.rows[1]!)).toBe(GRIFF);
        expect(wegMarke({ ...LISTE.rows[0]!, offMap: true })).toBe(RS);
    });
});

describe("Mehrfachauswahl auf der Karte: Wege und das zentrale Aufheben", () => {
    it("🔴 angehakte Wege leuchten golden über alle Abschnitte ihres Namens, namenlose über ihre Kennung", () => {
        const [ebene, ...rest] = buildMehrfachMarkierungLayers([{ art: "path", ids: ["name:Reichsstraße 3", OHNE] }], {
            territoryData: false,
        });
        expect(rest).toEqual([]);
        expect(ebene).toMatchObject({
            id: "mehrfach-path",
            type: "line",
            filter: [
                "any",
                ["in", ["get", "name"], ["literal", ["Reichsstraße 3"]]],
                ["in", ["get", "public_id"], ["literal", [OHNE]]],
            ],
        });
    });

    it("🔴 hebeAuf fragt JEDES Ziel (zwei Editoren zugleich) und sagt, ob eine Auswahl an war", () => {
        const markierung = createMehrfachMarkierung();
        const gefragt: string[] = [];
        let wegeAn = true;
        markierung.ziel("path", {
            bereit: () => true,
            umschalten: () => undefined,
            aufheben: () => {
                gefragt.push("wege");
                const war = wegeAn;
                wegeAn = false;
                return war;
            },
        });
        markierung.ziel("territory", {
            bereit: () => true,
            umschalten: () => undefined,
            aufheben: () => {
                gefragt.push("gebiete");
                return false;
            },
        });
        // Ein Ziel ohne `aufheben` (ältere Anbindung) stört nicht.
        markierung.ziel("peak", { bereit: () => true, umschalten: () => undefined });
        expect(markierung.hebeAuf()).toBe(true);
        expect(gefragt).toEqual(["wege", "gebiete"]);
        expect(markierung.hebeAuf()).toBe(false);
    });
});
