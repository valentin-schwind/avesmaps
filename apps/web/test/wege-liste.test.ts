import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { EditorPathList, EditorPathRow, EditorPathStreet } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n";
import { WEGE_OPTIONEN, ladeWege, wertName, zeileVon } from "../src/wegeditor/wege-liste";
import { createWegeditorSteuerung, WEGEDITOR } from "../src/wegeditor/wegeditor-steuerung";
import type { Werkzeugfenster } from "../src/editor-panel/werkzeugfenster";

/**
 * Das Wege-Fenster, lesend (WI-0177 Stufe 2, W5a): Adapter der Liste und Steuerung. Problemfälle: Die Zeile heißt nach dem Griff
 * („Weg-6029“); ein Bach steht als Flussweg; der Kreis ist voll, obwohl nur ein Teil den Artikel trägt; ein Klick auf der Karte kennt nur
 * die Kette und wählt nichts, solange die Liste noch lädt; ein Abschnitt der Karte steht in der Liste unter seiner eigenen Kennung statt
 * unter dem Anker der Straße. Stufe 3b: ein genommener Abschnitt sieht aus wie die Straße auf der Karte, oder die Kette von der Karte wählt
 * ihn statt der Straße auf der Karte.
 */

afterEach(() => setLocale("de"));

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
const BACH = "22222222-2222-4222-8222-222222222222";
const GRIFF = "33333333-3333-4333-8333-333333333333";
const LISTE: EditorPathList = {
    rows: [
        row({
            id: RS,
            name: "Reichsstraße 3",
            subtype: "Reichsstrasse",
            segments: 4,
            wiki: { url: "https://x", title: "Reichsstraße 3" },
            wikiSegments: 2,
        }),
        row({ id: BACH, name: "", subtype: "Flussweg", isBach: true }),
        row({ id: GRIFF, name: "Weg-6029", subtype: "Weg", circle: "voll", wiki: { url: "https://y" } }),
    ],
};

describe("Wegeliste: Zeilen", () => {
    it("🔴 nie der Griff als Name; ohne Namen der Satz der Art; ein Bach heißt Bach", () => {
        const [rs, bach, griff] = LISTE.rows.map(zeileVon);
        expect(rs).toMatchObject({ name: "Reichsstraße 3", rechts: "Reichsstraße" });
        expect(bach).toMatchObject({ name: "Unbezeichneter Bach", rechts: "Bach", facetten: { art: "Bach" } });
        expect(griff?.name).toBe("Unbezeichneter Weg");
    });

    it("🔴 Karawanenroute (Migration 0174): EINE Zeile, ihre Art ist die Karawanenroute, die Unterzeile nennt den Untergrund", () => {
        const route = zeileVon(
            row({
                id: RS2,
                name: "Keft–Rashdul",
                subtype: "Pfad",
                mark: "karawanenroute",
                subtypes: ["Pfad", "Wuestenpfad", "Strasse"],
                segments: 9,
                circle: "voll",
                wiki: { url: "https://z", title: "Karawanenroute Keft–Rashdul" },
            }),
        );
        expect(route).toMatchObject({ rechts: "Karawanenroute", facetten: { art: "karawanenroute" } });
        expect(route.unter).toEqual({ text: "auf Pfad, Wüstenpfad, Straße · 9 Abschnitte", ton: "gut" });
        expect(wertName("art", "karawanenroute")).toBe("Karawanenroute");
    });

    it("🔴 Wiki an einem Teil der Abschnitte: Facette „an einem Teil“, die Unterzeile sagt wie viele, als Warnung", () => {
        const rs = zeileVon(LISTE.rows[0]!);
        expect(rs.facetten).toMatchObject({ wiki: "teil", art: "Reichsstrasse" });
        expect(rs.unter).toEqual({ text: "Wiki an 2 von 4 Abschnitten", ton: "warnung" });
        expect(wertName("wiki", "teil")).toBe("an einem Teil");
        expect(wertName("art", "Reichsstrasse")).toBe("Reichsstraße");
        expect(WEGE_OPTIONEN.facetten).toEqual(["stand", "wiki", "art"]);
    });

    it("🔴 Stufe 3b: ein genommener Abschnitt steht unter „Nicht auf der Karte“, als Warnung, Kreis ohne Karte", () => {
        const genommen = zeileVon(
            row({ id: RS2, name: "Reichsstraße 3", subtype: "Reichsstrasse", circle: "leer", offMap: true }),
        );
        expect(genommen).toMatchObject({
            kreis: "leer",
            facetten: { stand: "nichtAufDerKarte" },
            unter: { text: "Nicht auf der Karte", ton: "warnung" },
        });
        expect(zeileVon(LISTE.rows[0]!).facetten).toMatchObject({ stand: "aufDerKarte" });
        expect(wertName("stand", "nichtAufDerKarte")).toBe("Nicht auf der Karte");
    });

    it("🔴 T54: eine gelöschte Straße steht unter „Gelöscht“, standardmäßig aus, und zählt in keiner Legende", () => {
        const geloescht = zeileVon(
            row({ id: RS2, name: "Reichsstraße 3", subtype: "Reichsstrasse", circle: "leer", deleted: true }),
        );
        expect(geloescht).toMatchObject({
            facetten: { stand: "geloescht" },
            unter: { text: "Gelöscht", ton: "warnung" },
            zaehltNicht: true,
        });
        expect(zeileVon(LISTE.rows[0]!)).not.toHaveProperty("zaehltNicht");
        expect([...(WEGE_OPTIONEN.vorbelegt?.get("stand") ?? [])]).toEqual(["aufDerKarte", "nichtAufDerKarte"]);
    });

    it("lädt ohne Zwischenspeicher-Tricks, aber mit no-cache; ein 403 wird ein Fehler mit Code", async () => {
        const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
            expect(init?.cache).toBe("no-cache");
            return new Response(JSON.stringify({ error: { code: "forbidden", message: "nein" } }), { status: 403 });
        });
        await expect(ladeWege(new AbortController().signal, fetcher as never)).rejects.toMatchObject({
            status: 403,
            code: "forbidden",
        });
    });
});

describe("Wege-Fenster: Steuerung, je Straße ein Fenster (W5b, T44)", () => {
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
        let listeAntworten!: (liste: EditorPathList) => void;
        // Jeder Abschnitt gehört zur Reichsstraße: Ihr Anker ist RS.
        const strasse: EditorPathStreet = {
            id: RS,
            name: "Reichsstraße 3",
            subtype: "Reichsstrasse",
            isBach: false,
            circle: "halb-rechts",
            labelVisible: null,
            segments: [
                { id: RS, revision: 1, labelVisible: true, wiki: true, points: 5 },
                { id: RS2, revision: 1, labelVisible: false, wiki: false, points: 3 },
            ],
        };
        const fetcher = vi.fn(async (url: string) => {
            if (url.endsWith("/api/editor/paths"))
                return new Promise<Response>((r) => {
                    listeAntworten = (liste) => r(new Response(JSON.stringify(liste)));
                });
            return new Response(JSON.stringify(strasse));
        });
        const s = createWegeditorSteuerung(werkzeugfenster, fetcher as never);
        return { s, werkzeugfenster, fenster, fetcher, liste: (l: EditorPathList) => listeAntworten(l) };
    }
    const ruhe = () => new Promise((r) => setTimeout(r, 0));

    it("🔴 ein geschlossenes Fenster öffnet ein Klick auf einen Weg nicht (zweiter Klick und Doppelklick blieben sonst nicht am Ort)", () => {
        const a = aufbau();
        expect(a.s.geoeffnet({ kind: "path", anchor: RS2 }, { source: "map" } as never, true)).toBe(false);
        expect(a.werkzeugfenster.oeffne).not.toHaveBeenCalled();
    });

    it("🔴 ein offenes Fenster folgt einem Abschnitt der Karte, an seiner Stelle und unter dem Anker der Straße", async () => {
        const a = aufbau();
        a.s.oeffneWerkzeug();
        expect(a.werkzeugfenster.oeffne).toHaveBeenCalledWith(
            expect.objectContaining({ werkzeug: WEGEDITOR, gegenstand: undefined }),
        );
        expect(a.s.geoeffnet({ kind: "path", anchor: RS2 }, { source: "map" } as never, true)).toBe(true);
        await ruhe();
        await ruhe();
        expect(a.fenster.value.map((f) => f.gegenstand)).toEqual([RS]);
        expect(a.s.auswahl.value).toBe(RS);
        // Je Straße EINE Bearbeitung, gelesen unter dem Anker.
        await ruhe();
        expect(a.s.bearbeitungVon(RS)?.detail.value?.segments).toHaveLength(2);
    });

    it("🔴 nur die Kette (erster Klick): die Wahl wartet auf die Liste und nimmt dann den Anker", async () => {
        const a = aufbau();
        a.s.oeffneWerkzeug();
        a.s.geoeffnet({ kind: "path", chain: "Reichsstraße 3:Reichsstrasse" }, { source: "map" } as never, true);
        expect(a.s.auswahl.value).toBeUndefined();
        a.liste(LISTE);
        await ruhe();
        await ruhe();
        expect(a.s.auswahl.value).toBe(RS);
    });

    it("🔴 ein Klick in der Liste öffnet die Straße an der Stelle dieses Fensters (D19), nicht in einem zweiten", () => {
        const a = aufbau();
        a.s.oeffneWerkzeug();
        const an = a.fenster.value[0]!.id;
        a.s.waehle(GRIFF, an);
        expect(a.werkzeugfenster.oeffneAnStelle).toHaveBeenCalledWith(
            an,
            expect.objectContaining({ gegenstand: GRIFF }),
        );
        expect(a.fenster.value.map((f) => f.gegenstand)).toEqual([GRIFF]);
        // Dieselbe Straße noch einmal: nichts.
        a.s.waehle(GRIFF, a.fenster.value[0]!.id);
        expect(a.werkzeugfenster.oeffneAnStelle).toHaveBeenCalledTimes(1);
    });

    it("ohne Schreibrecht bleibt die Bearbeitung lesend: eine Feldänderung nimmt keine Sperre und beginnt nichts", async () => {
        const a = aufbau();
        a.s.oeffneWerkzeug();
        a.s.waehle(RS, a.fenster.value[0]!.id);
        await ruhe();
        await ruhe();
        const bearbeitung = a.s.bearbeitungVon(RS)!;
        bearbeitung.feld((f) => ({ ...f, name: "Neu" }), "name");
        await ruhe();
        expect(bearbeitung.zustand.value.art).toBe("sperrfehler");
        expect(bearbeitung.lage.value.aktiv).toBe(false);
    });

    it("außerhalb des Editors, ohne Klick der Karte oder an anderem als einem Weg: nichts", () => {
        const a = aufbau();
        expect(a.s.geoeffnet({ kind: "path", anchor: RS }, { source: "map" } as never, false)).toBe(false);
        expect(a.s.geoeffnet({ kind: "path", anchor: RS }, { source: "search" } as never, true)).toBe(false);
        expect(a.s.geoeffnet({ kind: "place", id: RS }, { source: "map" } as never, true)).toBe(false);
        expect(a.werkzeugfenster.oeffne).not.toHaveBeenCalled();
    });
});
