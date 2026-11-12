import { describe, expect, it, vi } from "vitest";
import { sessionViewer } from "@avesmaps3d/shared";
import { fuehreAus, handgriffZeilen, visibleActions, type EditorMenuSubject } from "../src/editor-menu/action.ts";
import { doppelklick, flaechenWahlListe, type DoppelklickSeite } from "../src/editor-menu/doppelklick.ts";
import {
    gebietHandgriffe,
    gebietSubjekt,
    neuesGebietEintrag,
    type GebietLage,
} from "../src/editor-menu/handgriffe-gebiet.ts";
import { anlegenEintraege, griffAn, kartenAbschnitte, legeAn } from "../src/editor-menu/kartenmenue.ts";
import { gebieteAus } from "../src/gebietseditor/gebiete-am-punkt.ts";
import type { HitContext } from "../src/map/interaction/types";

/**
 * Die Einstiege des Gebietseditors (WI-0209 Paket A4; EDIT-0005 §9 „A4“, H3; EDIT-0003 G10, F18, R3, T23 Frage 2, T25, T32).
 * Problemfälle: Am Gebiet fehlt „Eigenschaften bearbeiten“ oder öffnet ein anderes Gebiet; ein Leser ohne Schreibrecht sieht
 * „Eigenschaften bearbeiten“ statt „Ansehen“; „Gebietsform bearbeiten“ ist anklickbar, obwohl C1 fehlt, oder trägt nicht den
 * Doppelklick; über zwei Gebieten wählt das Kartenmenü still eines; der Doppelklick stellt nicht „Politisch“; die Liste „Welche Fläche
 * bearbeiten?“ verliert die Kennung eines Gebiets; aus der Kachel kommt ein Gebiet doppelt oder eine Landschaft als Gebiet.
 */

const ALLE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];
const LESER = ["use_editor_menu"];
const viewer = (rechte: string[]) => sessionViewer("test", rechte);
const lage =
    (rechte: string[], laeuft = false, mapEditing = "testwelt"): (() => GebietLage) =>
    () => ({ rechte, bearbeiten: { mapEditing } as never, laeuft });
const wirkung = () => ({ oeffnen: vi.fn(), gebietsform: vi.fn() });
const ID = (n: number): string => `a4a4a4a4-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const GRAFSCHAFT = gebietSubjekt({ id: ID(1) }, "Grafschaft Albenhus", "Grafschaft");
const BARONIE = gebietSubjekt({ id: ID(2) }, "Baronie Lückenhof", "Baronie");
const uebersetze = (key: string, params?: Record<string, string>): string =>
    `«${key}»${params === undefined ? "" : JSON.stringify(params)}`;

describe("Handgriffe am Herrschaftsgebiet", () => {
    it("🔴 Folge nach G10: „Eigenschaften bearbeiten“, dann „Gebietsform bearbeiten“ mit dem Kürzel „Doppelklick“", () => {
        const zeilen = handgriffZeilen(gebietHandgriffe(lage(ALLE), wirkung()), GRAFSCHAFT, "karte");
        expect(zeilen.map((zeile) => [zeile.id, zeile.text, zeile.zeichen, zeile.hinweis])).toEqual([
            ["gebiet-bearbeiten", "ortseditor.handgriff.bearbeiten", "bearbeiten", undefined],
            [
                "gebiet-gebietsform",
                "landschaftseditor.griff.bearbeiten",
                "gebietsform",
                "editorMenu.kuerzel.doppelklick",
            ],
        ]);
        // Dieselben zwei in der Gruppe „Bearbeiten · nur Editoren“ des Infopanels.
        expect(handgriffZeilen(gebietHandgriffe(lage(ALLE), wirkung()), GRAFSCHAFT, "infopanel")).toHaveLength(2);
    });

    it("🔴 „Eigenschaften bearbeiten“ öffnet DIESES Gebiet; ohne Schreibrecht heißt es „Ansehen“", () => {
        const w = wirkung();
        const griffe = gebietHandgriffe(lage(ALLE), w);
        expect(fuehreAus(griffe, "gebiet-bearbeiten", BARONIE, viewer(ALLE))).toBe(true);
        expect(w.oeffnen).toHaveBeenCalledWith(ID(2));
        const leser = handgriffZeilen(gebietHandgriffe(lage(LESER), w), BARONIE, "karte");
        expect(leser[0]).toMatchObject({ text: "ortseditor.handgriff.ansehen", zeichen: "ansehen", grund: undefined });
    });

    it("🔴 „Gebietsform bearbeiten“ startet den Modus an DIESEM Gebiet (C1); gesperrt ohne Recht, im Modus, bei ausgeschaltetem Bearbeiten", () => {
        const w = wirkung();
        const griffe = gebietHandgriffe(lage(ALLE), w);
        expect(handgriffZeilen(griffe, GRAFSCHAFT, "karte")[1]?.grund).toBeUndefined();
        expect(fuehreAus(griffe, "gebiet-gebietsform", GRAFSCHAFT, viewer(ALLE))).toBe(true);
        expect(w.gebietsform).toHaveBeenCalledWith(ID(1));
        expect(visibleActions(griffe, GRAFSCHAFT, viewer(ALLE)).map((action) => action.id)).toEqual([
            "gebiet-bearbeiten",
            "gebiet-gebietsform",
        ]);
        const grund = (l: () => GebietLage) =>
            handgriffZeilen(gebietHandgriffe(l, wirkung()), GRAFSCHAFT, "karte")[1]?.grund;
        expect(grund(lage(LESER))).toBe("sonderrollen.grund.gebiet");
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(
            handgriffZeilen(gebietHandgriffe(lage(ALLE, true), wirkung()), GRAFSCHAFT, "karte").map((z) => z.id),
        ).not.toContain("gebiet-gebietsform");
        expect(grund(lage(ALLE, false, "aus"))).toBe("ortseditor.handgriff.grund.aus");
    });
});

describe("Kartenmenü und Doppelklick über Gebieten", () => {
    it("🔴 zwei Gebiete unter dem Rechtsklick: „Hier liegen 2 Flächen“, je Gebiet sein Untermenü, nichts still gewählt", () => {
        const abschnitte = kartenAbschnitte({
            actions: gebietHandgriffe(lage(ALLE), wirkung()),
            subject: undefined,
            liste: { id: "flaechen", titel: "areaChoice.count", gegenstaende: [BARONIE, GRAFSCHAFT] },
            anlegen: [],
            uebersetze,
        });
        expect(abschnitte.map((abschnitt) => abschnitt.id)).toEqual(["flaechen"]);
        expect(abschnitte[0]?.titel).toBe('«areaChoice.count»{"n":"2"}');
        const eintraege = abschnitte[0]?.eintraege ?? [];
        expect(eintraege.map((eintrag) => [eintrag.id, eintrag.text, eintrag.hinweis])).toEqual([
            [`gebiet-${ID(2)}`, "Baronie Lückenhof", "Baronie"],
            [`gebiet-${ID(1)}`, "Grafschaft Albenhus", "Grafschaft"],
        ]);
        const unter = eintraege[1]?.unter ?? [];
        expect(unter.map((eintrag) => eintrag.id)).toEqual([
            `${ID(1)}|gebiet-bearbeiten`,
            `${ID(1)}|gebiet-gebietsform`,
        ]);
        // Die Kennung im Untermenü trifft das Gebiet, an dem es hängt.
        expect(griffAn(unter[0]!.id, [BARONIE, GRAFSCHAFT])).toEqual({
            griff: "gebiet-bearbeiten",
            gegenstand: GRAFSCHAFT,
        });
    });

    it("🔴 ein Gebiet: seine Handgriffe stehen gleich in der Karte", () => {
        const abschnitte = kartenAbschnitte({
            actions: gebietHandgriffe(lage(ALLE), wirkung()),
            subject: undefined,
            liste: { id: "flaechen", titel: "areaChoice.count", gegenstaende: [GRAFSCHAFT] },
            anlegen: [],
            uebersetze,
        });
        expect(abschnitte[0]?.id).toBe("objekt");
        expect(abschnitte[0]?.eintraege.map((eintrag) => eintrag.id)).toEqual([
            "gebiet-bearbeiten",
            "gebiet-gebietsform",
        ]);
    });

    const context = { screen: { x: 5, y: 6 }, point: { x: 50, y: 60 } } as unknown as HitContext;
    const seite = (flaechen: EditorMenuSubject[], w = wirkung()): DoppelklickSeite => ({
        aktiv: () => true,
        layers: () => [],
        modus: () => undefined,
        ziel: () => ({ flaechen }),
        actions: () => gebietHandgriffe(lage(ALLE), w),
        viewer: viewer(ALLE),
        waehle: vi.fn(),
        grund: vi.fn(),
        ansicht: vi.fn(),
    });

    it("🔴 Doppelklick auf ein Gebiet: erst „Politisch“ (T32), dann „Gebietsform bearbeiten“ an diesem Gebiet (R3)", () => {
        const w = wirkung();
        const s = seite([GRAFSCHAFT], w);
        expect(doppelklick(s, context)).toBe(true);
        expect(s.ansicht).toHaveBeenCalledWith(GRAFSCHAFT);
        expect(w.gebietsform).toHaveBeenCalledWith(ID(1));
        expect(s.grund).not.toHaveBeenCalled();
    });

    it("🔴 Doppelklick über zwei Gebieten: „Welche Fläche bearbeiten?“ mit den Kennungen der Gebiete", () => {
        const s = seite([BARONIE, GRAFSCHAFT]);
        expect(doppelklick(s, context)).toBe(true);
        expect(s.waehle).toHaveBeenCalledWith([BARONIE, GRAFSCHAFT], { x: 5, y: 6 });
        const liste = flaechenWahlListe([BARONIE, GRAFSCHAFT], { x: 5, y: 6 }, (key) => key);
        expect(liste.entries.map((eintrag) => [eintrag.id, eintrag.name, eintrag.type])).toEqual([
            [ID(2), "Baronie Lückenhof", "Baronie"],
            [ID(1), "Grafschaft Albenhus", "Grafschaft"],
        ]);
    });
});

describe("Gebiete aus der Kachel", () => {
    it("🔴 je Gebiet einmal, kleinste zuerst, ohne Landschaften", () => {
        const merkmal = (properties: Record<string, unknown>) => ({ properties });
        const gebiete = gebieteAus([
            merkmal({
                territory_public_id: ID(1),
                name: "Grafschaft Albenhus",
                territory_type: "Grafschaft",
                area: 40,
            }),
            merkmal({ territory_public_id: ID(2), name: "Baronie Lückenhof", territory_type: "Baronie", area: 9 }),
            // Die Schraffur trägt dasselbe Gebiet noch einmal; eine Landschaft gehört nicht dazu.
            merkmal({
                territory_public_id: ID(1),
                name: "Grafschaft Albenhus",
                territory_type: "Grafschaft",
                area: 40,
            }),
            merkmal({ region_public_id: "wald", name: "Reichsforst", region_type: "wald", area: 3 }),
        ]);
        expect(gebiete.map((gebiet) => [gebiet.kind, gebiet.id, gebiet.type])).toEqual([
            ["territory", ID(2), "Baronie"],
            ["territory", ID(1), "Grafschaft"],
        ]);
    });
});

describe("„Hier hinzufügen › Neues Herrschaftsgebiet“ (WI-0209 C3)", () => {
    /** Die Zeilen von „Hier hinzufügen ›“ in einer Ansicht, auf freier Karte. */
    const zeilenIn = (
        ansicht: "standard" | "political" | "landscapes",
        eintraege: ReturnType<typeof anlegenEintraege>,
    ) =>
        kartenAbschnitte({ actions: [], subject: undefined, anlegen: eintraege, uebersetze, ansicht })
            .find((a) => a.id === "anlegen")
            ?.eintraege[0]?.unter?.map((z) => [z.id, z.grund]);

    it("🔴 eigener Eintrag auf oberster Ebene nach „Neuer Weg“, vor „Neue Kraftlinie“; in Standard und Politisch, nicht in der Derographie", () => {
        const starte = vi.fn();
        const eintraege = anlegenEintraege(
            lage(ALLE),
            vi.fn(),
            vi.fn(),
            vi.fn(),
            undefined,
            undefined,
            neuesGebietEintrag(lage(ALLE), starte),
        );
        expect(eintraege.map((e) => e.id)).toEqual([
            "neue-flaeche",
            "neuer-ort",
            "neuer-weg",
            "neuer-fluss",
            "neues-gebiet",
            "neue-kraftlinie",
            "neuer-kraftlinienpunkt",
        ]);
        expect(zeilenIn("standard", eintraege)?.find(([id]) => id === "neues-gebiet")).toEqual([
            "neues-gebiet",
            undefined,
        ]);
        // Politisch hat der Betreiber entschieden (nur diese Zeile); in der Derographie steht nur „Neue Fläche ›“.
        expect(zeilenIn("political", eintraege)?.find(([id]) => id === "neues-gebiet")).toEqual([
            "neues-gebiet",
            undefined,
        ]);
        expect(zeilenIn("landscapes", eintraege)?.some(([id]) => id === "neues-gebiet")).toBe(false);
        expect(legeAn(eintraege, "neues-gebiet", { x: 3, y: 4 })).toBe(true);
        expect(starte).toHaveBeenCalledWith({ x: 3, y: 4 });
    });

    it("gesperrt ohne beide Schreibrechte, ohne Bearbeiten und während ein Modus läuft, wie „Neuer Weg“", () => {
        expect(neuesGebietEintrag(lage(LESER), vi.fn()).sperre()).toBe("sonderrollen.grund.gebiet");
        expect(neuesGebietEintrag(lage(ALLE, true), vi.fn()).sperre()).toBe("ortseditor.handgriff.grund.laeuft");
        expect(neuesGebietEintrag(lage(ALLE, false, "off"), vi.fn()).sperre()).toBeDefined();
        expect(neuesGebietEintrag(lage(ALLE), vi.fn(), ["standard"]).ansichten).toEqual(["standard"]);
    });
});
