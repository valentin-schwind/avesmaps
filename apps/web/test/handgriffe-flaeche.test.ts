import { describe, expect, it, vi } from "vitest";
import { sessionViewer } from "@avesmaps3d/shared";
import { fuehreAus, handgriffZeilen, visibleActions } from "../src/editor-menu/action.ts";
import { flaecheHandgriffe, flaecheSubjekt } from "../src/editor-menu/handgriffe-flaeche.ts";

/**
 * Die Handgriffe an einer Landschaftsfläche (WI-0178 A4, C1; EDIT-0004 §2.1; EDIT-0003 T34 (1), (4), F18; Probierblatt Landschaften).
 * Problemfälle: Die Folge weicht vom Blatt ab; ein Handgriff, dessen Paket noch fehlt, ist anklickbar; „Eigenschaften bearbeiten“ oder
 * „Beschriftung …“ öffnet nicht die Landschaft, an der er steht; „Gebietsform bearbeiten“ startet den Modus nicht; das Menü am Objekt
 * zeigt Gesperrtes; ein Leser ohne Schreibrecht sieht „Kommt später.“ statt „ohne Recht“; Malen und Radieren stehen in einem Eintrag.
 * Reihenfolge und Sperren (D1): wirken an einer anderen Landschaft, oder gehen, während ein Modus läuft oder ein anderer sie hält.
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
const WALD = flaecheSubjekt(
    { kind: "landscape", id: "r-1", name: "Reichsforst", type: "wald", area: 3 },
    "Reichsforst",
    "Wald",
);
const viewer = (rechte: string[]) => sessionViewer("test", rechte);

describe("Handgriffe an der Fläche", () => {
    it("🔴 Folge: Eigenschaften, Gebietsform, Beschriftung, Form, Mit anderer Fläche, Unterflächen, Reihenfolge, Kopieren, Entfernen", () => {
        const zeilen = handgriffZeilen(
            flaecheHandgriffe(
                () => ({ rechte: ALLE, bearbeiten: { mapEditing: "testwelt" } as never, laeuft: false }),
                {
                    oeffnen: vi.fn(),
                    beschriftung: vi.fn(),
                    ecken: vi.fn(),
                    platz: vi.fn(),
                    klicksperre: vi.fn(),
                    entfernen: vi.fn(),
                    verbergen: vi.fn(),
                },
            ),
            WALD,
            "karte",
        );
        expect(zeilen.map((zeile) => zeile.id)).toEqual([
            "flaeche-bearbeiten",
            "flaeche-gebietsform",
            "flaeche-beschriftung",
            "flaeche-beschriftung-neu",
            "flaeche-verschieben",
            "flaeche-zerschneiden",
            "flaeche-malen",
            "flaeche-radieren",
            "flaeche-vereinfachen",
            "flaeche-vereinigen",
            "flaeche-vereinigen-behalten",
            "flaeche-ausschneiden",
            "flaeche-ausschneiden-behalten",
            "flaeche-neu-ausschneiden",
            "unterflaechen-vereinigen",
            "unterflaeche-herausloesen",
            "unterflaeche-loeschen",
            "flaeche-verbergen",
            "flaeche-vorn",
            "flaeche-hinten",
            "flaeche-klicks",
            "flaeche-kopieren",
            "flaeche-entfernen",
        ]);
        // Das Fenster, die Gebietsform (der Modus, C1), „Beschriftung …“, Reihenfolge und Sperren (D1) und „Fläche entfernen …“ (D2)
        // gehen; alles andere kommt mit seinem Paket. „Neue Beschriftung hier“ und „Fläche vereinfachen“ warten auf ihre Wirkung
        // (Werkzeuge 2 und 4, Plan der Editor-Orchestrierung 2026-10-19).
        expect(zeilen.filter((zeile) => zeile.grund === undefined).map((zeile) => zeile.id)).toEqual([
            "flaeche-bearbeiten",
            "flaeche-gebietsform",
            "flaeche-beschriftung",
            "flaeche-verbergen",
            "flaeche-vorn",
            "flaeche-hinten",
            "flaeche-klicks",
            "flaeche-entfernen",
        ]);
        expect(new Set(zeilen.filter((zeile) => zeile.grund !== undefined).map((zeile) => zeile.grund))).toEqual(
            new Set(["editorPanel.spaeter.satz"]),
        );
        expect(zeilen.find((zeile) => zeile.id === "flaeche-entfernen")?.gefahr).toBe(true);
        // Wie am Ort: dasselbe Wort für das Fenster (F18); Malen und Radieren mit eigenem Zeichen (T34 (4)).
        expect(zeilen[0]).toMatchObject({ text: "landschaftseditor.griff.oeffnen", zeichen: "bearbeiten" });
        expect(zeilen[1]).toMatchObject({ text: "landschaftseditor.griff.bearbeiten", zeichen: "gebietsform" });
        expect(zeilen.find((zeile) => zeile.id === "flaeche-radieren")?.zeichen).toBe("radieren");
        // Der Doppelklick auf die Fläche startet „Gebietsform bearbeiten“ (EDIT-0003 R3): Dort und nur dort steht sein Kürzel.
        expect(zeilen[1]?.hinweis).toBe("editorMenu.kuerzel.doppelklick");
        expect(zeilen.filter((zeile) => zeile.hinweis !== undefined).map((zeile) => zeile.id)).toEqual([
            "flaeche-gebietsform",
        ]);
    });

    it("🔴 im Infopanel nur Bearbeiten, Gebietsform, Beschriftung, Reihenfolge und Entfernen; im Menü am Objekt nur, was geht", () => {
        const actions = flaecheHandgriffe(
            () => ({ rechte: ALLE, bearbeiten: { mapEditing: "testwelt" } as never, laeuft: false }),
            {
                oeffnen: vi.fn(),
                beschriftung: vi.fn(),
                ecken: vi.fn(),
                platz: vi.fn(),
                klicksperre: vi.fn(),
                entfernen: vi.fn(),
                verbergen: vi.fn(),
            },
        );
        expect(handgriffZeilen(actions, WALD, "infopanel").map((zeile) => zeile.id)).toEqual([
            "flaeche-bearbeiten",
            "flaeche-gebietsform",
            "flaeche-beschriftung",
            "flaeche-verbergen",
            "flaeche-vorn",
            "flaeche-hinten",
            "flaeche-klicks",
            "flaeche-entfernen",
        ]);
        expect(visibleActions(actions, WALD, viewer(ALLE)).map((action) => action.id)).toEqual([
            "flaeche-bearbeiten",
            "flaeche-gebietsform",
            "flaeche-beschriftung",
            "flaeche-verbergen",
            "flaeche-vorn",
            "flaeche-hinten",
            "flaeche-klicks",
            "flaeche-entfernen",
        ]);
    });

    it("🔴 Fenster, Gebietsform und „Beschriftung …“ wirken an der Landschaft, an der sie stehen; Gesperrtes läuft nie", () => {
        const oeffnen = vi.fn();
        const beschriftung = vi.fn();
        const ecken = vi.fn();
        const actions = flaecheHandgriffe(
            () => ({ rechte: ALLE, bearbeiten: { mapEditing: "testwelt" } as never, laeuft: false }),
            {
                oeffnen,
                beschriftung,
                ecken,
                platz: vi.fn(),
                klicksperre: vi.fn(),
                entfernen: vi.fn(),
                verbergen: vi.fn(),
            },
        );
        expect(fuehreAus(actions, "flaeche-bearbeiten", WALD, viewer(ALLE))).toBe(true);
        expect(oeffnen).toHaveBeenCalledWith("r-1");
        expect(fuehreAus(actions, "flaeche-beschriftung", WALD, viewer(ALLE))).toBe(true);
        expect(beschriftung).toHaveBeenCalledWith("r-1");
        expect(fuehreAus(actions, "flaeche-gebietsform", WALD, viewer(ALLE))).toBe(true);
        expect(ecken).toHaveBeenCalledWith("r-1");
        // „Fläche entfernen …“ (D2) öffnet das Blatt im Fenster.
        expect(fuehreAus(actions, "flaeche-entfernen", WALD, viewer(ALLE))).toBe(true);
    });

    it("🔴 „Verschieben“ (Werkzeug 7) geht, sobald die Seite es kennt, an der Landschaft, an der es steht; nicht, solange ein Modus läuft", () => {
        const verschieben = vi.fn();
        const mit = (laeuft: boolean) =>
            flaecheHandgriffe(() => ({ rechte: ALLE, bearbeiten: { mapEditing: "testwelt" } as never, laeuft }), {
                oeffnen: vi.fn(),
                beschriftung: vi.fn(),
                ecken: vi.fn(),
                platz: vi.fn(),
                klicksperre: vi.fn(),
                entfernen: vi.fn(),
                verbergen: vi.fn(),
                verschieben,
            });
        const zeile = (laeuft: boolean) =>
            handgriffZeilen(mit(laeuft), WALD, "karte").find((z) => z.id === "flaeche-verschieben");
        expect(zeile(false)).toMatchObject({ zeichen: "verschieben", grund: undefined });
        expect(fuehreAus(mit(false), "flaeche-verschieben", WALD, viewer(ALLE))).toBe(true);
        expect(verschieben).toHaveBeenCalledWith("r-1");
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(zeile(true)).toBeUndefined();
    });

    it("ohne Schreibrecht: „Ansehen“ statt „Eigenschaften bearbeiten“, „ohne Recht“ statt „Kommt später.“; „Beschriftung …“ geht", () => {
        const zeilen = handgriffZeilen(
            flaecheHandgriffe(
                () => ({ rechte: ["use_editor_menu"], bearbeiten: { mapEditing: "testwelt" } as never, laeuft: false }),
                {
                    oeffnen: vi.fn(),
                    beschriftung: vi.fn(),
                    ecken: vi.fn(),
                    platz: vi.fn(),
                    klicksperre: vi.fn(),
                    entfernen: vi.fn(),
                    verbergen: vi.fn(),
                },
            ),
            WALD,
            "karte",
        );
        expect(zeilen.find((zeile) => zeile.id === "flaeche-bearbeiten")).toMatchObject({
            text: "landschaftseditor.griff.ansehen",
            zeichen: "ansehen",
            grund: undefined,
        });
        expect(zeilen.find((zeile) => zeile.id === "flaeche-gebietsform")?.grund).toBe("sonderrollen.grund.flaeche");
        expect(zeilen.find((zeile) => zeile.id === "flaeche-beschriftung")?.grund).toBeUndefined();
    });

    it("„Gebietsform bearbeiten“ ist gesperrt, solange ein Modus läuft, und bei ausgeschaltetem Bearbeiten (wie am Ort)", () => {
        const grund = (lage: { bearbeiten: unknown; laeuft: boolean }) =>
            handgriffZeilen(
                flaecheHandgriffe(() => ({ rechte: ALLE, ...lage }) as never, {
                    oeffnen: vi.fn(),
                    beschriftung: vi.fn(),
                    ecken: vi.fn(),
                    platz: vi.fn(),
                    klicksperre: vi.fn(),
                    entfernen: vi.fn(),
                    verbergen: vi.fn(),
                }),
                WALD,
                "karte",
            ).find((zeile) => zeile.id === "flaeche-gebietsform")?.grund;
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(grund({ bearbeiten: { mapEditing: "testwelt" }, laeuft: true })).toBe(undefined);
        expect(grund({ bearbeiten: undefined, laeuft: false })).toBe("ortseditor.handgriff.grund.aus");
    });

    it("🔴 D1: Reihenfolge und Klicksperre wirken an der Landschaft, an der sie stehen; gesperrt im Modus und an fremder Sperre", () => {
        const platz = vi.fn();
        const klicksperre = vi.fn();
        let lage: { laeuft: boolean; sperreVon?: (id: string) => unknown } = { laeuft: false };
        const actions = flaecheHandgriffe(
            () => ({ rechte: ALLE, bearbeiten: { mapEditing: "testwelt" } as never, ...lage }) as never,
            {
                oeffnen: vi.fn(),
                beschriftung: vi.fn(),
                ecken: vi.fn(),
                platz,
                klicksperre,
                entfernen: vi.fn(),
                verbergen: vi.fn(),
            },
        );
        expect(fuehreAus(actions, "flaeche-vorn", WALD, viewer(ALLE))).toBe(true);
        expect(platz).toHaveBeenLastCalledWith("r-1", "vorn");
        expect(fuehreAus(actions, "flaeche-hinten", WALD, viewer(ALLE))).toBe(true);
        expect(platz).toHaveBeenLastCalledWith("r-1", "hinten");
        expect(fuehreAus(actions, "flaeche-klicks", WALD, viewer(ALLE))).toBe(true);
        expect(klicksperre).toHaveBeenCalledWith("r-1");
        const grund = () => handgriffZeilen(actions, WALD, "karte").find((zeile) => zeile.id === "flaeche-vorn")?.grund;
        lage = { laeuft: true };
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(handgriffZeilen(actions, WALD, "karte").find((zeile) => zeile.id === "flaeche-vorn")).toBeUndefined();
        lage = { laeuft: false, sperreVon: (id) => (id === "r-1" ? { kind: "landscape" } : undefined) };
        expect(grund()).toBe("sperre.grund");
        expect(fuehreAus(actions, "flaeche-klicks", WALD, viewer(ALLE))).toBe(false);
        expect(klicksperre).toHaveBeenCalledTimes(1);
    });

    it("🔴 T41: an einer sichtbaren Fläche „Verbergen“, an einer verborgenen „Zurückholen“ (wie am Ort); beide wirken an ihrer Landschaft", () => {
        const verbergen = vi.fn();
        let verborgen = false;
        const actions = flaecheHandgriffe(
            () => ({
                rechte: ALLE,
                bearbeiten: { mapEditing: "testwelt" } as never,
                laeuft: false,
                verborgen: () => verborgen,
            }),
            {
                oeffnen: vi.fn(),
                beschriftung: vi.fn(),
                ecken: vi.fn(),
                platz: vi.fn(),
                klicksperre: vi.fn(),
                entfernen: vi.fn(),
                verbergen,
            },
        );
        const ids = () => visibleActions(actions, WALD, viewer(ALLE)).map((action) => action.id);
        expect(ids()).toContain("flaeche-verbergen");
        expect(ids()).not.toContain("flaeche-zurueckholen");
        expect(fuehreAus(actions, "flaeche-verbergen", WALD, viewer(ALLE))).toBe(true);
        expect(verbergen).toHaveBeenLastCalledWith("r-1", true);
        verborgen = true;
        expect(ids()).toContain("flaeche-zurueckholen");
        expect(ids()).not.toContain("flaeche-verbergen");
        expect(
            handgriffZeilen(actions, WALD, "karte").find((zeile) => zeile.id === "flaeche-zurueckholen"),
        ).toMatchObject({
            text: "landschaftseditor.griff.zurueckholen",
            zeichen: "zurueckholen",
            grund: undefined,
        });
        expect(fuehreAus(actions, "flaeche-zurueckholen", WALD, viewer(ALLE))).toBe(true);
        expect(verbergen).toHaveBeenLastCalledWith("r-1", false);
    });
});

describe("Andockstellen für Werkzeug 2 und 4 (Plan der Editor-Orchestrierung 2026-10-19, Thomas 4.1)", () => {
    const wirkung = () => ({
        oeffnen: vi.fn(),
        beschriftung: vi.fn(),
        ecken: vi.fn(),
        platz: vi.fn(),
        klicksperre: vi.fn(),
        entfernen: vi.fn(),
        verbergen: vi.fn(),
        beschriftungNeu: vi.fn(),
        vereinfachen: vi.fn(),
    });
    const zeilen = (lage: Record<string, unknown>, w = wirkung()) =>
        handgriffZeilen(
            flaecheHandgriffe(
                () => ({ rechte: ALLE, bearbeiten: { mapEditing: "testwelt" }, laeuft: false, ...lage }) as never,
                w,
            ),
            WALD,
            "karte",
        );

    it("🔴 mit Wirkung gehen „Neue Beschriftung hier“ und „Fläche vereinfachen“ und wirken an ihrer Landschaft", () => {
        const w = wirkung();
        const z = zeilen({}, w);
        expect(z.find((zeile) => zeile.id === "flaeche-beschriftung-neu")?.grund).toBeUndefined();
        expect(z.find((zeile) => zeile.id === "flaeche-vereinfachen")?.grund).toBeUndefined();
        const actions = flaecheHandgriffe(
            () => ({ rechte: ALLE, bearbeiten: { mapEditing: "testwelt" } as never, laeuft: false }),
            w,
        );
        expect(fuehreAus(actions, "flaeche-beschriftung-neu", WALD, viewer(ALLE))).toBe(true);
        expect(fuehreAus(actions, "flaeche-vereinfachen", WALD, viewer(ALLE))).toBe(true);
        expect(w.beschriftungNeu).toHaveBeenCalledWith("r-1");
        expect(w.vereinfachen).toHaveBeenCalledWith("r-1");
    });

    it("„Neue Beschriftung hier“ trägt den Grund der Seite (etwa F7) und sperrt wie das Fenster; „vereinfachen“ wie die Gebietsform", () => {
        expect(
            zeilen({ beschriftungGrund: () => "editorPanel.spaeter.satz" }).find(
                (zeile) => zeile.id === "flaeche-beschriftung-neu",
            )?.grund,
        ).toBe("editorPanel.spaeter.satz");
        const laeuft = zeilen({ laeuft: true });
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(laeuft.find((zeile) => zeile.id === "flaeche-beschriftung-neu")).toBeUndefined();
        expect(laeuft.find((zeile) => zeile.id === "flaeche-vereinfachen")).toBeUndefined();
    });

    it("🔴 T58 (3): Läuft ein Formmodus an derselben Landschaft, gehen die Modi im Entwurf weiter; das Übrige fällt weg", () => {
        const alle = {
            ...wirkung(),
            verschieben: vi.fn(),
            malen: vi.fn(),
            zerschneiden: vi.fn(),
            mitAnderer: vi.fn(),
            unterflaechen: vi.fn(),
        };
        const ids = (formmodusAn: (id: string) => boolean) =>
            zeilen({ laeuft: true, formmodusAn }, alle).map((zeile) => zeile.id);
        const hier = ids((id) => id === "r-1");
        for (const id of [
            "flaeche-gebietsform",
            "flaeche-verschieben",
            "flaeche-malen",
            "flaeche-radieren",
            "flaeche-vereinfachen",
        ])
            expect(hier, id).toContain(id);
        for (const id of [
            "flaeche-zerschneiden",
            "flaeche-vereinigen",
            "unterflaeche-loeschen",
            "flaeche-entfernen",
            "flaeche-vorn",
        ])
            expect(hier, id).not.toContain(id);
        // An einer anderen Landschaft geht im Modus nichts davon.
        expect(ids((id) => id === "r-anders")).not.toContain("flaeche-malen");
    });
});
