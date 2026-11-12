import { describe, expect, it, vi } from "vitest";
import { sessionViewer, type EditorLock } from "@avesmaps3d/shared";
import { fuehreAus, griffZeilen, handgriffZeilen, visibleActions } from "../src/editor-menu/action.ts";
import { wegHandgriffe, wegSubjekt, type WegLage } from "../src/editor-menu/handgriffe-weg.ts";
import { griffAbschnitte, griffAn, kartenAbschnitte } from "../src/editor-menu/kartenmenue.ts";

/**
 * Die Handgriffe an einem Weg (WI-0177 W2; Probierblatt P5, Blatt „Wegeditor“). Problemfälle: Die Folge weicht vom Blatt ab;
 * „Wegkurve bearbeiten“ steht im Infopanel, wo nur die ganze Straße bekannt ist; sie startet einen anderen Abschnitt als den unter dem
 * Rechtsklick; sie geht, während ein anderer Modus läuft oder Bearbeiten aus ist; was erst später kommt, ist anklickbar.
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
const ABSCHNITT = "5a5a5a5a-0000-4000-8000-0000000000a1";
const RS3 = wegSubjekt(
    { publicId: ABSCHNITT, name: "Reichsstraße 3", subtype: "Reichsstrasse", isBach: false },
    "Reichsstraße 3",
);
const STRASSE = { ...RS3, ref: { kind: "path" as const, chain: "Reichsstraße 3:Reichsstrasse" } };
const AN: WegLage = { rechte: ALLE, bearbeiten: { mapEditing: "testwelt" } as never, laeuft: false };
const viewer = (rechte: string[]) => sessionViewer("test", rechte);

describe("Handgriffe am Weg", () => {
    it("🔴 Folge wie im Probierblatt: Eigenschaften, Wegkurve bearbeiten, Wegkurve vereinfachen, Weg entfernen", () => {
        const zeilen = handgriffZeilen(
            wegHandgriffe(() => AN, {
                eigenschaften: vi.fn(),
                wegkurve: vi.fn(),
                vereinfachen: vi.fn(),
                neuAbOrt: vi.fn(),
            }),
            RS3,
            "karte",
        );
        expect(zeilen.map((z) => z.id)).toEqual([
            "weg-eigenschaften",
            "weg-wegkurve",
            "weg-vereinfachen",
            "weg-entfernen",
        ]);
        expect(zeilen.map((z) => z.grund)).toEqual([undefined, undefined, undefined, "editorPanel.spaeter.satz"]);
        expect(zeilen.at(-1)!.gefahr).toBe(true);
    });

    it("🔴 im Infopanel gilt die Wegkurve dem markierten Abschnitt; solange die ganze Straße markiert ist, sagt sie warum nicht", () => {
        const zeilen = (lage: WegLage) =>
            handgriffZeilen(
                wegHandgriffe(() => lage, {
                    eigenschaften: vi.fn(),
                    wegkurve: vi.fn(),
                    vereinfachen: vi.fn(),
                    neuAbOrt: vi.fn(),
                }),
                STRASSE,
                "infopanel",
            );
        expect(zeilen(AN).map((z) => z.id)).toEqual([
            "weg-eigenschaften",
            "weg-wegkurve-abschnitt",
            "weg-vereinfachen-abschnitt",
            "weg-entfernen-abschnitt",
        ]);
        expect(zeilen(AN)[1]!.grund).toBe("wegeditor.griff.grund.abschnitt");
        expect(zeilen(AN)[2]!.grund).toBe("wegeditor.griff.grund.abschnitt");
        expect(zeilen({ ...AN, abschnitt: ABSCHNITT })[1]!.grund).toBeUndefined();
        expect(zeilen({ ...AN, abschnitt: ABSCHNITT })[2]!.grund).toBeUndefined();
    });

    it("🔴 am markierten Abschnitt startet die Wegkurve ihn, nie den Anker des Gegenstands (der kleinste Abschnitt der Straße)", () => {
        const wegkurve = vi.fn();
        const kanonisch = { ...RS3, ref: { kind: "path" as const, anchor: "0a0a0a0a-0000-4000-8000-000000000001" } };
        const actions = wegHandgriffe(() => ({ ...AN, abschnitt: ABSCHNITT }), {
            eigenschaften: vi.fn(),
            wegkurve,
            vereinfachen: vi.fn(),
            neuAbOrt: vi.fn(),
        });
        expect(visibleActions(actions, kanonisch, viewer(ALLE)).map((a) => a.id)).toEqual([
            "weg-eigenschaften",
            "weg-wegkurve-abschnitt",
            "weg-vereinfachen-abschnitt",
        ]);
        fuehreAus(actions, "weg-wegkurve-abschnitt", kanonisch, viewer(ALLE));
        expect(wegkurve).toHaveBeenCalledWith(ABSCHNITT);
    });

    it("das Menü am Objekt zeigt bei der ganzen Straße keine Wegkurve (wie Legacy), nur die Eigenschaften", () => {
        const actions = wegHandgriffe(() => AN, {
            eigenschaften: vi.fn(),
            wegkurve: vi.fn(),
            vereinfachen: vi.fn(),
            neuAbOrt: vi.fn(),
        });
        expect(visibleActions(actions, STRASSE, viewer(ALLE)).map((a) => a.id)).toEqual(["weg-eigenschaften"]);
    });

    it("🔴 „Eigenschaften bearbeiten“ öffnet das Wege-Fenster: am Abschnitt mit seinem Anker, an der Straße mit ihrer Kette (W5a)", () => {
        const eigenschaften = vi.fn();
        const actions = wegHandgriffe(() => AN, {
            eigenschaften,
            wegkurve: vi.fn(),
            vereinfachen: vi.fn(),
            neuAbOrt: vi.fn(),
        });
        fuehreAus(actions, "weg-eigenschaften", RS3, viewer(["use_editor_menu"]));
        fuehreAus(actions, "weg-eigenschaften", STRASSE, viewer(["use_editor_menu"]));
        expect(eigenschaften.mock.calls).toEqual([
            [{ anchor: ABSCHNITT }],
            [{ chain: "Reichsstraße 3:Reichsstrasse" }],
        ]);
    });

    it("🔴 „Wegkurve vereinfachen“ startet ihren Modus am Abschnitt unter dem Rechtsklick und am markierten, nie die Wegkurve", () => {
        const wegkurve = vi.fn();
        const vereinfachen = vi.fn();
        const kanonisch = { ...RS3, ref: { kind: "path" as const, anchor: "0a0a0a0a-0000-4000-8000-000000000001" } };
        fuehreAus(
            wegHandgriffe(() => AN, { eigenschaften: vi.fn(), wegkurve, vereinfachen, neuAbOrt: vi.fn() }),
            "weg-vereinfachen",
            RS3,
            viewer(ALLE),
        );
        fuehreAus(
            wegHandgriffe(() => ({ ...AN, abschnitt: "5a5a5a5a-0000-4000-8000-0000000000b2" }), {
                eigenschaften: vi.fn(),
                wegkurve,
                vereinfachen,
                neuAbOrt: vi.fn(),
            }),
            "weg-vereinfachen-abschnitt",
            kanonisch,
            viewer(ALLE),
        );
        expect(vereinfachen.mock.calls).toEqual([[ABSCHNITT], ["5a5a5a5a-0000-4000-8000-0000000000b2"]]);
        expect(wegkurve).not.toHaveBeenCalled();
    });

    it("🔴 startet den Abschnitt unter dem Rechtsklick", () => {
        const wegkurve = vi.fn();
        fuehreAus(
            wegHandgriffe(() => AN, { eigenschaften: vi.fn(), wegkurve, vereinfachen: vi.fn(), neuAbOrt: vi.fn() }),
            "weg-wegkurve",
            RS3,
            viewer(ALLE),
        );
        expect(wegkurve).toHaveBeenCalledWith(ABSCHNITT);
    });

    it("gesperrt, während ein Modus läuft, ohne Recht und bei ausgeschaltetem Bearbeiten", () => {
        const grund = (lage: WegLage) =>
            handgriffZeilen(
                wegHandgriffe(() => lage, {
                    eigenschaften: vi.fn(),
                    wegkurve: vi.fn(),
                    vereinfachen: vi.fn(),
                    neuAbOrt: vi.fn(),
                }),
                RS3,
                "karte",
            ).find((z) => z.id === "weg-wegkurve")!.grund;
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(
            handgriffZeilen(
                wegHandgriffe(() => ({ ...AN, laeuft: true }), {
                    eigenschaften: vi.fn(),
                    wegkurve: vi.fn(),
                    vereinfachen: vi.fn(),
                    neuAbOrt: vi.fn(),
                }),
                RS3,
                "karte",
            ).find((z) => z.id === "weg-wegkurve"),
        ).toBeUndefined();
        expect(grund({ ...AN, rechte: ["use_editor_menu"] })).toBe("ortseditor.handgriff.grund.recht");
        expect(grund({ ...AN, bearbeiten: { mapEditing: "off", environment: "staging" } as never })).toBe(
            "ortseditor.handgriff.grund.aus",
        );
    });

    it("das Menü am Objekt zeigt nichts Gesperrtes; ohne Schreibrecht sagt „später“ „ohne Recht“, die Eigenschaften gehen lesend", () => {
        const actions = wegHandgriffe(() => ({ ...AN, rechte: ["use_editor_menu"] }), {
            eigenschaften: vi.fn(),
            wegkurve: vi.fn(),
            vereinfachen: vi.fn(),
            neuAbOrt: vi.fn(),
        });
        expect(visibleActions(actions, RS3, viewer(["use_editor_menu"])).map((a) => a.id)).toEqual([
            "weg-eigenschaften",
        ]);
        expect(handgriffZeilen(actions, RS3, "karte").at(-1)!.grund).toBe("ortseditor.handgriff.grund.recht");
    });

    it("ein Weg ohne Namen trägt keine Kette, nur den Abschnitt", () => {
        expect(
            wegSubjekt({ publicId: ABSCHNITT, name: "", subtype: "Pfad", isBach: false }, "Unbezeichneter Pfad").ref,
        ).toEqual({
            kind: "path",
            anchor: ABSCHNITT,
        });
    });
});

describe("„Hier laufen N Wege“ im Kartenmenü (EDIT-0003 T25)", () => {
    const uebersetze = (key: string, params?: Record<string, string>) =>
        params?.["n"] === undefined ? `«${key}»` : `«${key}:${params["n"]}»`;
    const PFAD = wegSubjekt(
        { publicId: "5a5a5a5a-0000-4000-8000-0000000000b2", name: "", subtype: "Pfad", isBach: false },
        "Unbezeichneter Pfad",
    );

    it("🔴 mehrere Wege: eine Liste mit je Weg seinem Untermenü; die Kennung nennt den Weg, der Griff startet SEINEN Abschnitt", () => {
        const wegkurve = vi.fn();
        const actions = wegHandgriffe(() => AN, {
            eigenschaften: vi.fn(),
            wegkurve,
            vereinfachen: vi.fn(),
            neuAbOrt: vi.fn(),
        });
        const wege = [RS3, PFAD];
        const [liste] = kartenAbschnitte({
            actions,
            subject: undefined,
            liste: { id: "wege", titel: "wegeditor.hierLaufen", gegenstaende: wege },
            anlegen: [],
            uebersetze: uebersetze as never,
        });
        expect(liste?.id).toBe("wege");
        expect(liste?.titel).toBe("«wegeditor.hierLaufen:2»");
        expect(liste?.eintraege.map((e) => e.text)).toEqual(["Reichsstraße 3", "Unbezeichneter Pfad"]);
        expect(liste?.eintraege.every((e) => e.id.startsWith("weg-"))).toBe(true);
        const griff = liste?.eintraege[1]?.unter?.find((e) => e.id.endsWith("|weg-wegkurve"));
        expect(griff?.hinweis).toBe("«editorMenu.kuerzel.doppelklick»");
        const { griff: id, gegenstand } = griffAn(griff!.id, wege);
        fuehreAus(actions, id, gegenstand!, viewer(ALLE));
        expect(wegkurve).toHaveBeenCalledWith("5a5a5a5a-0000-4000-8000-0000000000b2");
    });

    it("ein Weg allein steht wie bisher als der Gegenstand", () => {
        const actions = wegHandgriffe(() => AN, {
            eigenschaften: vi.fn(),
            wegkurve: vi.fn(),
            vereinfachen: vi.fn(),
            neuAbOrt: vi.fn(),
        });
        const [objekt] = kartenAbschnitte({
            actions,
            subject: undefined,
            liste: { id: "wege", titel: "wegeditor.hierLaufen", gegenstaende: [RS3] },
            anlegen: [],
            uebersetze: uebersetze as never,
        });
        expect(objekt?.id).toBe("objekt");
    });
});

describe("Handgriffe am Stützpunkt (T24 (3))", () => {
    const zeilen = (griff: WegLage["griff"]) =>
        griffZeilen(
            wegHandgriffe(() => ({ ...AN, laeuft: true, griff }), {
                eigenschaften: vi.fn(),
                wegkurve: vi.fn(),
                vereinfachen: vi.fn(),
                neuAbOrt: vi.fn(),
            }),
            RS3,
        );

    it("🔴 nur am Griff, nie im Menü des Objekts; am inneren Punkt gehen beide, auch während der Modus läuft", () => {
        expect(zeilen({ index: 1, ende: false, ungespeichert: false }).map((z) => [z.id, z.grund])).toEqual([
            ["weg-stuetzpunkt-teilen", undefined],
            ["weg-stuetzpunkt-entfernen", undefined],
        ]);
        const karte = handgriffZeilen(
            wegHandgriffe(() => AN, {
                eigenschaften: vi.fn(),
                wegkurve: vi.fn(),
                vereinfachen: vi.fn(),
                neuAbOrt: vi.fn(),
            }),
            RS3,
            "karte",
        );
        expect(karte.map((z) => z.id)).not.toContain("weg-stuetzpunkt-teilen");
    });

    it("am Ende geht keiner; mit Ungespeichertem nur Entfernen", () => {
        expect(zeilen({ index: 0, ende: true, ungespeichert: false }).map((z) => z.grund)).toEqual([
            "wegeditor.griff.grund.innen",
            "wegeditor.griff.grund.endeBleibt",
        ]);
        expect(zeilen({ index: 1, ende: false, ungespeichert: true }).map((z) => z.grund)).toEqual([
            "wegeditor.griff.grund.ungespeichert",
            undefined,
        ]);
    });

    it("das Kartenmenü am Griff ist EIN Abschnitt mit dem Griff im Titel; gewählt läuft der Handgriff mit dem Index", () => {
        const teilen = vi.fn();
        const actions = wegHandgriffe(() => ({ ...AN, griff: { index: 2, ende: false, ungespeichert: false } }), {
            eigenschaften: vi.fn(),
            wegkurve: vi.fn(),
            vereinfachen: vi.fn(),
            neuAbOrt: vi.fn(),
            teilen,
        });
        const abschnitte = griffAbschnitte(actions, RS3, "Stützpunkt 3", (key) => `«${key}»`);
        expect(abschnitte.map((a) => [a.id, a.titel, a.eintraege.map((e) => e.id)])).toEqual([
            ["griff", "Stützpunkt 3", ["weg-stuetzpunkt-teilen", "weg-stuetzpunkt-entfernen"]],
        ]);
        expect(fuehreAus(actions, "weg-stuetzpunkt-teilen", RS3, viewer(ALLE))).toBe(true);
        expect(teilen).toHaveBeenCalledWith(2);
    });

    it("🔴 hält ein anderer den Abschnitt: die Wegkurve unter dem Zeiger und am markierten gesperrt mit Grund, im Untermenü nicht", () => {
        const fremd = { id: ABSCHNITT, kind: "path", own: false } as unknown as EditorLock;
        const lage: WegLage = {
            ...AN,
            abschnitt: ABSCHNITT,
            sperreVon: (id) => (id === ABSCHNITT ? fremd : undefined),
        };
        const actions = wegHandgriffe(() => lage, {
            eigenschaften: vi.fn(),
            wegkurve: vi.fn(),
            vereinfachen: vi.fn(),
            neuAbOrt: vi.fn(),
        });
        const sperre = (id: string, subject: typeof RS3) =>
            actions.find((action) => action.id === id)?.sperre?.(subject);
        expect(sperre("weg-wegkurve", RS3)).toBe("sperre.grund");
        expect(sperre("weg-wegkurve-abschnitt", STRASSE)).toBe("sperre.grund");
        expect(sperre("weg-vereinfachen", RS3)).toBe("sperre.grund");
        expect(sperre("weg-wegkurve-strasse", STRASSE)).toBeUndefined();
        // Ein anderer Abschnitt derselben Straße ist frei.
        const anderer = wegSubjekt(
            {
                publicId: "5a5a5a5a-0000-4000-8000-0000000000c3",
                name: "Reichsstraße 3",
                subtype: "Reichsstrasse",
                isBach: false,
            },
            "Reichsstraße 3",
        );
        expect(sperre("weg-wegkurve", anderer)).toBeUndefined();
    });
});

/**
 * „Weg hier teilen“ am Rechtsklick auf den Weg (Thomas 2.1; Betreiber 2026-10-19 „A: auch am Weg (Empfehlung)“): nur im Kartenmenü, am
 * Abschnitt unter dem Rechtsklick; grau mit Grund, solange der Weg lädt, wenn kein Stützpunkt in der Nähe liegt, ohne Recht und während
 * ein Modus läuft.
 */
describe("Weg hier teilen am Weg", () => {
    const wirkung = () => ({
        eigenschaften: vi.fn(),
        wegkurve: vi.fn(),
        vereinfachen: vi.fn(),
        neuAbOrt: vi.fn(),
        teilenAmWeg: vi.fn(),
    });
    const zeile = (lage: WegLage, w = wirkung(), stelle: "karte" | "infopanel" = "karte") =>
        handgriffZeilen(
            wegHandgriffe(() => lage, w),
            RS3,
            stelle,
        ).find((z) => z.id === "weg-hier-teilen");

    it("🔴 steht nach „Wegkurve vereinfachen“ im Kartenmenü, nie im Infopanel; ohne Wirkung gar nicht", () => {
        const lage: WegLage = { ...AN, teilstelle: () => ({ art: "stelle", index: 2, at: { x: 1, y: 1 } }) };
        const ids = handgriffZeilen(
            wegHandgriffe(() => lage, wirkung()),
            RS3,
            "karte",
        ).map((z) => z.id);
        expect(ids.indexOf("weg-hier-teilen")).toBe(ids.indexOf("weg-vereinfachen") + 1);
        expect(zeile(lage)?.grund).toBeUndefined();
        expect(zeile(lage, wirkung(), "infopanel")).toBeUndefined();
        expect(
            handgriffZeilen(
                wegHandgriffe(() => lage, {
                    eigenschaften: vi.fn(),
                    wegkurve: vi.fn(),
                    vereinfachen: vi.fn(),
                    neuAbOrt: vi.fn(),
                }),
                RS3,
                "karte",
            ).some((z) => z.id === "weg-hier-teilen"),
        ).toBe(false);
    });

    it("🔴 grau mit Grund: lädt, kein Stützpunkt in der Nähe, ohne Recht, Modus läuft", () => {
        expect(zeile({ ...AN, teilstelle: () => ({ art: "laedt" }) })?.grund).toBe("wegeditor.griff.grund.laedt");
        expect(zeile({ ...AN, teilstelle: () => ({ art: "keine" }) })?.grund).toBe(
            "wegeditor.griff.grund.keinStuetzpunkt",
        );
        const stelle = () => ({ art: "stelle" as const, index: 1, at: { x: 0, y: 0 } });
        expect(
            zeile({
                ...AN,
                rechte: [
                    "use_editor_menu",
                    "edit_map_geometry",
                    "edit_territory_form",
                    "edit_landscape_form",
                    "edit_mountains",
                ],
                teilstelle: stelle,
            })?.grund,
        ).toBe("ortseditor.handgriff.grund.recht");
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(zeile({ ...AN, laeuft: true, teilstelle: stelle })).toBeUndefined();
    });

    it("🔴 teilt den Abschnitt unter dem Rechtsklick, mit dem Titel für den Hinweis", () => {
        const w = wirkung();
        const lage: WegLage = { ...AN, teilstelle: () => ({ art: "stelle", index: 2, at: { x: 1, y: 1 } }) };
        fuehreAus(
            wegHandgriffe(() => lage, w),
            "weg-hier-teilen",
            RS3,
            viewer(ALLE),
        );
        expect(w.teilenAmWeg).toHaveBeenCalledWith(ABSCHNITT, "Reichsstraße 3");
    });

    it("🔴 „Weg entfernen …“ im Kartenmenü gilt in der Mehrfachauswahl allen angehakten Wegen (WI-0252), sonst dem Abschnitt unter dem Rechtsklick", () => {
        const lauf = (inMehrfach: boolean) => {
            const entfernen = vi.fn();
            const entfernenAuswahl = vi.fn();
            const lage: WegLage = { ...AN, inMehrfach: () => inMehrfach };
            fuehreAus(
                wegHandgriffe(() => lage, {
                    eigenschaften: vi.fn(),
                    wegkurve: vi.fn(),
                    vereinfachen: vi.fn(),
                    neuAbOrt: vi.fn(),
                    entfernen,
                    entfernenAuswahl,
                }),
                "weg-entfernen",
                RS3,
                viewer(ALLE),
            );
            return { entfernen, entfernenAuswahl };
        };
        const mehrfach = lauf(true);
        expect(mehrfach.entfernenAuswahl).toHaveBeenCalledOnce();
        expect(mehrfach.entfernen).not.toHaveBeenCalled();
        const einzeln = lauf(false);
        expect(einzeln.entfernen).toHaveBeenCalledWith(ABSCHNITT);
        expect(einzeln.entfernenAuswahl).not.toHaveBeenCalled();
    });
});
