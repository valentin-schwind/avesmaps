import { composeView, LANDMARKEN_ARTEN, type LandscapeSelection, type MapView } from "@avesmaps3d/shared";
import { describe, expect, it, vi } from "vitest";
import { FLACH_BIS, type EditorAction } from "../src/editor-menu/action.ts";
import { ortHandgriffe, ortSubjekt, type OrtLage } from "../src/editor-menu/handgriffe-ort.ts";
import { flaecheHandgriffe } from "../src/editor-menu/handgriffe-flaeche.ts";
import { anlegenEintraege, griffAn, kartenAbschnitte, legeAn } from "../src/editor-menu/kartenmenue.ts";
import { neueFlaecheEbenen, zielEbene } from "../src/landschaftseditor/neue-flaeche-ebenen.ts";

/**
 * Die Abschnitte für Editoren im Kartenmenü (EDIT-0002 §4.6, §6 Nr. 3; EDIT-0003 G10; Schritt O1): am Objekt sein Abschnitt aus dem
 * Register, in jedem Menü „Anlegen · Hier hinzufügen ›“ wie in Legacy; mehr als fünf Handgriffe hinter EINEM Eintrag „… ›“.
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
const lage =
    (ueber: Partial<OrtLage> = {}): (() => OrtLage) =>
    () => ({
        rechte: ALLE,
        bearbeiten: { mapEditing: "testwelt" },
        laeuft: false,
        ...ueber,
    });
const uebersetze = (key: string): string => `«${key}»`;
const wirkung = { bearbeiten: vi.fn(), verschieben: vi.fn(), verbergen: vi.fn() };
const ORT = ortSubjekt({ id: "ort-1", name: "Gratenfels" });

describe("Kartenmenü", () => {
    it("🔴 am Ort: der Abschnitt Bearbeiten mit den Handgriffen in der Folge G10, darunter Anlegen", () => {
        const abschnitte = kartenAbschnitte({
            actions: ortHandgriffe(lage(), wirkung),
            subject: ORT,
            anlegen: anlegenEintraege(lage(), vi.fn()),
            uebersetze,
        });
        expect(abschnitte.map((abschnitt) => [abschnitt.id, abschnitt.titel])).toEqual([
            ["objekt", "«ortseditor.gruppe»"],
            ["anlegen", "«ortseditor.anlegen»"],
        ]);
        expect(abschnitte[0]?.pille).toBe("«ortseditor.gruppe.nurEditoren»");
        expect(abschnitte[0]?.eintraege.map((eintrag) => [eintrag.id, eintrag.text])).toEqual([
            ["ort-bearbeiten", "«ortseditor.handgriff.bearbeiten»"],
            ["ort-verschieben", "«ortseditor.handgriff.verschieben»"],
            ["ort-verbergen", "«ortseditor.handgriff.verbergen»"],
            ["ort-entfernen", "«ortseditor.handgriff.entfernen»"],
        ]);
    });

    it("🔴 auf der freien Fläche nur Anlegen mit „Hier hinzufügen“ und darin Neuer Ort, wie Legacy", () => {
        const frei = kartenAbschnitte({
            actions: ortHandgriffe(lage(), wirkung),
            subject: undefined,
            anlegen: anlegenEintraege(lage(), vi.fn()),
            uebersetze,
        });
        // Betreiber 2026-10-11: „"Neuer Ort" ist eigentlich im Untermenü von "Hier hinzufügen". wie in legacy“.
        expect(frei.map((abschnitt) => abschnitt.id)).toEqual(["anlegen"]);
        expect(frei[0]?.eintraege.map((eintrag) => eintrag.id)).toEqual(["hier-hinzufuegen"]);
        const unter = frei[0]?.eintraege[0]?.unter ?? [];
        // Neue Fläche · Neuer Ort · Neuer Weg · Neue Kraftlinie (WI-0205 K9); keine Kreuzung und kein freies Label (Betreiber
        // 2026-10-17: „kein freies label, keine
        // kreuzung, beides gibts nicht mehr bei uns“). Fläche und Weg werden mit ihrem Zeichnen frei (C3, Wege).
        expect(unter.map((eintrag) => [eintrag.id, eintrag.grund])).toEqual([
            ["neue-flaeche", "«editorPanel.spaeter.satz»"],
            ["neuer-ort", undefined],
            ["neuer-weg", "«editorPanel.spaeter.satz»"],
            ["neuer-fluss", "«editorPanel.spaeter.satz»"],
            ["neue-kraftlinie", "«editorPanel.spaeter.satz»"],
            ["neuer-kraftlinienpunkt", "«editorPanel.spaeter.satz»"],
        ]);
        expect(unter[1]).toMatchObject({ zeichen: "neuer-ort", text: "«ortseditor.anlegen.neuerOrt»" });
    });

    it("„Neuer Ort“ ohne Recht an der Geometrie oder bei ausgeschaltetem Bearbeiten mit Grund", () => {
        const neuerOrt = (ueber: Partial<OrtLage>) =>
            kartenAbschnitte({
                actions: [],
                subject: undefined,
                anlegen: anlegenEintraege(lage(ueber), vi.fn()),
                uebersetze,
            })[0]?.eintraege[0]?.unter?.find((eintrag) => eintrag.id === "neuer-ort")?.grund;
        expect(neuerOrt({ rechte: ["edit_map_objects", "edit_territories", "edit_landscapes"] })).toBe(
            "«ortseditor.handgriff.grund.recht»",
        );
        expect(neuerOrt({ bearbeiten: undefined })).toBe("«ortseditor.handgriff.grund.aus»");
        expect(neuerOrt({})).toBe(undefined);
    });

    it("🔴 mehr als fünf Handgriffe stehen hinter EINEM Eintrag „… ›“, im Untermenü mit Zwischenüberschriften je Gruppe (G10)", () => {
        const griff = (
            id: string,
            gruppe: EditorAction["gruppe"],
            abschnitt?: "editorMenu.dev.test",
        ): EditorAction => ({
            id,
            kinds: ["territory"],
            capability: "use_editor_menu",
            gruppe,
            label: "editorMenu.dev.test",
            zeichen: "bearbeiten",
            ...(abschnitt === undefined ? {} : { abschnitt }),
            run: () => undefined,
        });
        // Ein Gebiet: Flächen stehen immer flach (T27 (2), Fall unten).
        const viele = [
            griff("f-bearbeiten", "bearbeiten"),
            griff("f-form-1", "form", "editorMenu.dev.test"),
            griff("f-form-2", "form", "editorMenu.dev.test"),
            griff("f-zeigen", "sichtbarkeit"),
            griff("f-neu", "neu"),
            griff("f-weg", "entfernen"),
        ];
        expect(viele.length).toBeGreaterThan(FLACH_BIS);
        const flaeche = {
            ref: { kind: "territory" as const, id: "g-1" },
            title: "Kosch",
            art: undefined,
            answer: undefined,
        };
        const [objekt] = kartenAbschnitte({ actions: viele, subject: flaeche, anlegen: [], uebersetze });
        expect(objekt?.eintraege.map((eintrag) => eintrag.id)).toEqual(["territory-handgriffe"]);
        const unter = objekt?.eintraege[0]?.unter ?? [];
        expect(unter.map((eintrag) => eintrag.id)).toEqual(viele.map((x) => x.id));
        // Die Überschrift steht nur dort, wo eine neue beginnt.
        expect(unter.map((eintrag) => eintrag.abschnitt)).toEqual([
            undefined,
            "«editorMenu.dev.test»",
            undefined,
            undefined,
            undefined,
            undefined,
        ]);
        // Bis fünf flach und ohne Überschriften.
        const [flach] = kartenAbschnitte({
            actions: viele.slice(0, FLACH_BIS),
            subject: flaeche,
            anlegen: [],
            uebersetze,
        });
        expect(flach?.eintraege.map((eintrag) => [eintrag.id, eintrag.abschnitt, eintrag.unter])).toEqual(
            viele.slice(0, FLACH_BIS).map((x) => [x.id, undefined, undefined]),
        );
    });

    it("„Hier hinzufügen“ legt an der angeklickten Stelle an, ein gesperrter Eintrag nie; ein Handgriff ist kein Anlegen", () => {
        const neuerOrt = vi.fn();
        const anlegen = anlegenEintraege(lage(), neuerOrt);
        expect(legeAn(anlegen, "neuer-ort", { x: 10, y: 20 })).toBe(true);
        expect(neuerOrt).toHaveBeenCalledWith({ x: 10, y: 20 });
        expect(legeAn(anlegen, "neuer-weg", { x: 10, y: 20 })).toBe(false);
        expect(legeAn(anlegen, "ort-bearbeiten", { x: 10, y: 20 })).toBe(false);
        expect(legeAn(anlegenEintraege(lage({ rechte: [] }), neuerOrt), "neuer-ort", { x: 1, y: 2 })).toBe(false);
        expect(neuerOrt).toHaveBeenCalledTimes(1);
    });

    describe("„Neue Fläche ›“ als Untermenü der Ebenen (WI-0178 T47)", () => {
        const ansicht = (view: string, auswahl: string) => () => ({ view, auswahl });
        const unterVon = (anlegen: ReturnType<typeof anlegenEintraege>) =>
            kartenAbschnitte({ actions: [], subject: undefined, anlegen, uebersetze })[0]?.eintraege[0]?.unter?.[0];

        it("🔴 jede Zeile je Ansicht ein- oder ausschaltbar (`ansichten`); ein Untermenü ohne Zeile in der Ansicht fehlt mit", () => {
            const run = vi.fn();
            const zeile = (id: string, ansichten?: ("standard" | "powerlines" | "political")[]) => ({
                id,
                zeichen: undefined,
                label: "layer.alle" as const,
                sperre: () => undefined,
                run,
                ansichten,
            });
            const anlegen = [
                { ...zeile("neue-flaeche", ["standard", "political"]), unter: [zeile("a"), zeile("b", ["standard"])] },
                zeile("punkt", ["powerlines"]),
                zeile("ort"),
            ];
            const hier = (view: "standard" | "powerlines" | "political") =>
                kartenAbschnitte({ actions: [], subject: undefined, anlegen, uebersetze, ansicht: view })[0]
                    ?.eintraege[0]?.unter;
            expect(hier("standard")?.map((x) => [x.id, x.unter?.map((u) => u.id)])).toEqual([
                ["neue-flaeche", ["a", "b"]],
                ["ort", undefined],
            ]);
            expect(hier("political")?.map((x) => [x.id, x.unter?.map((u) => u.id)])).toEqual([
                ["neue-flaeche", ["a"]],
                ["ort", undefined],
            ]);
            expect(hier("powerlines")?.map((x) => x.id)).toEqual(["punkt", "ort"]);
            // Ein Untermenü, dessen Zeilen in der Ansicht alle fehlen, fehlt mit.
            const nurStandard = [{ ...zeile("neue-flaeche"), unter: [zeile("b", ["standard"])] }, zeile("ort")];
            expect(
                kartenAbschnitte({
                    actions: [],
                    subject: undefined,
                    anlegen: nurStandard,
                    uebersetze,
                    ansicht: "powerlines",
                })[0]?.eintraege[0]?.unter?.map((x) => x.id),
            ).toEqual(["ort"]);
        });

        it("🔴 ohne den Ablauf C3 steht „Neue Fläche“ gesperrt mit „Kommt später.“ und ohne Untermenü, wie bisher", () => {
            const ohne = unterVon(anlegenEintraege(lage(), vi.fn()));
            const vorC3 = unterVon(
                anlegenEintraege(lage(), vi.fn(), undefined, undefined, undefined, [
                    ...neueFlaecheEbenen({ lage: lage(), ansicht: ansicht("standard", "alle") }),
                ]),
            );
            for (const eintrag of [ohne, vorC3]) {
                expect(eintrag).toMatchObject({ id: "neue-flaeche", grund: "«editorPanel.spaeter.satz»" });
                expect(eintrag?.unter).toBeUndefined();
            }
        });

        it("🔴 mit C3: Regionen · Vegetation · Topographie, „zuletzt“ an der Ebene der Karte; legt in der gewählten Ebene am Punkt an", () => {
            const starte = vi.fn();
            const ebenen = neueFlaecheEbenen({ lage: lage(), ansicht: ansicht("landscapes", "vegetation"), starte });
            const anlegen = anlegenEintraege(lage(), vi.fn(), undefined, undefined, undefined, ebenen);
            const eintrag = unterVon(anlegen);
            expect(eintrag?.grund).toBeUndefined();
            expect(eintrag?.unter?.map((x) => [x.id, x.text, x.hinweis, x.grund])).toEqual([
                ["neue-flaeche-derographisch", "«layer.derographisch»", undefined, undefined],
                ["neue-flaeche-vegetation", "«layer.vegetation»", "«landschaftseditor.anlegen.zuletzt»", undefined],
                ["neue-flaeche-topographie", "«layer.topographie»", undefined, undefined],
            ]);
            expect(legeAn(anlegen, "neue-flaeche-topographie", { x: 3, y: 4 })).toBe(true);
            expect(starte).toHaveBeenCalledWith("topographie", { x: 3, y: 4 });
            // Der Eintrag mit Untermenü selbst legt nichts an.
            expect(legeAn(anlegen, "neue-flaeche", { x: 3, y: 4 })).toBe(false);
        });

        it("außerhalb der Derographie steht „zuletzt“ an der zuletzt gezeichneten Ebene, in „Alle“ ebenso", () => {
            const starte = vi.fn();
            const ebenen = neueFlaecheEbenen({ lage: lage(), ansicht: ansicht("standard", "alle"), starte });
            const anlegen = anlegenEintraege(lage(), vi.fn(), undefined, undefined, undefined, ebenen);
            legeAn(anlegen, "neue-flaeche-derographisch", { x: 1, y: 1 });
            expect(unterVon(anlegen)?.unter?.map((x) => x.hinweis)).toEqual([
                "«landschaftseditor.anlegen.zuletzt»",
                undefined,
                undefined,
            ]);
            expect(zielEbene("landscapes", "alle", "topographie")).toBe("topographie");
            expect(zielEbene("landscapes", "klima", undefined)).toBeUndefined();
        });

        it("ohne Recht an der Geometrie steht „Neue Fläche“ gesperrt mit dem Grund; legt nichts an", () => {
            const starte = vi.fn();
            const ohne = lage({
                rechte: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"],
            });
            const anlegen = anlegenEintraege(ohne, vi.fn(), undefined, undefined, undefined, [
                ...neueFlaecheEbenen({ lage: ohne, ansicht: ansicht("landscapes", "vegetation"), starte }),
            ]);
            expect(unterVon(anlegen)?.grund).toBe("«sonderrollen.grund.flaeche»");
            expect(unterVon(anlegen)?.unter).toBeUndefined();
            expect(legeAn(anlegen, "neue-flaeche-vegetation", { x: 1, y: 1 })).toBe(false);
            expect(starte).not.toHaveBeenCalled();
        });

        it("geht einer im Untermenü (etwa „Herrschaftsgebiet“), öffnet es; die gesperrten stehen darin mit Grund", () => {
            const gebiet = {
                id: "neue-flaeche-gebiet",
                zeichen: undefined,
                label: "layer.alle",
                sperre: () => undefined,
                run: vi.fn(),
            } as const;
            const anlegen = anlegenEintraege(lage(), vi.fn(), undefined, undefined, undefined, [
                ...neueFlaecheEbenen({ lage: lage(), ansicht: ansicht("standard", "alle") }),
                gebiet,
            ]);
            const eintrag = unterVon(anlegen);
            expect(eintrag?.grund).toBeUndefined();
            expect(eintrag?.unter?.map((x) => [x.id, x.grund])).toEqual([
                ["neue-flaeche-derographisch", "«editorPanel.spaeter.satz»"],
                ["neue-flaeche-vegetation", "«editorPanel.spaeter.satz»"],
                ["neue-flaeche-topographie", "«editorPanel.spaeter.satz»"],
                ["neue-flaeche-gebiet", undefined],
            ]);
            expect(legeAn(anlegen, "neue-flaeche-gebiet", { x: 5, y: 6 })).toBe(true);
            expect(gebiet.run).toHaveBeenCalledWith({ x: 5, y: 6 });
            expect(legeAn(anlegen, "neue-flaeche-vegetation", { x: 5, y: 6 })).toBe(false);
        });
    });

    describe("Flächen (WI-0178 A4; EDIT-0003 T25, T27 (2))", () => {
        const flaeche = (id: string, title: string) => ({
            ref: { kind: "area" as const, id },
            title,
            art: "Wald",
            answer: undefined,
        });
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

        it("🔴 eine Fläche: gleich ihr Menü, nach Abschnitten gruppiert wie Legacy, das Fenster und die Gebietsform zuerst", () => {
            const [objekt] = kartenAbschnitte({
                actions,
                subject: undefined,
                liste: { id: "flaechen", titel: "areaChoice.count", gegenstaende: [flaeche("r-1", "Reichsforst")] },
                anlegen: [],
                uebersetze,
            });
            expect(objekt?.id).toBe("objekt");
            expect(objekt?.eintraege.map((eintrag) => [eintrag.id, eintrag.unter?.length])).toEqual([
                ["flaeche-bearbeiten", undefined],
                ["flaeche-gebietsform", undefined],
                ["flaeche-beschriftung", undefined],
                ["flaeche-beschriftung-neu", undefined],
                ["gruppe-form", 5],
                ["gruppe-andere", 5],
                ["gruppe-unter", 3],
                // „Verbergen“ flach vor „Reihenfolge und Sperren ›“ (T41, Blatt B).
                ["flaeche-verbergen", undefined],
                ["gruppe-reihenfolge", 3],
                ["flaeche-kopieren", undefined],
                ["flaeche-entfernen", undefined],
            ]);
            // Jede Gruppe ihr eigenes Zeichen; „Unterflächen ›“ das Herauslösen (T30).
            expect([4, 5, 6, 8].map((i) => objekt?.eintraege[i]?.zeichen)).toEqual([
                "verschieben",
                "vereinigen",
                "herausloesen",
                "nach-vorn",
            ]);
            expect(objekt?.eintraege[4]).toMatchObject({
                text: "«landschaftseditor.griff.abschnitt.form»",
                zeichen: "verschieben",
            });
            expect(griffAn("flaeche-beschriftung", [flaeche("r-1", "Reichsforst")]).gegenstand?.ref).toEqual({
                kind: "area",
                id: "r-1",
            });
        });

        it("🔴 mehrere Flächen: „Hier liegen N Flächen“, je Fläche Name, Art und ihr Untermenü; die Kennung nennt die Fläche", () => {
            const flaechen = [flaeche("r-1", "Reichsforst"), flaeche("r-2", "Mittelreich")];
            const abschnitte = kartenAbschnitte({
                actions,
                subject: undefined,
                liste: { id: "flaechen", titel: "areaChoice.count", gegenstaende: flaechen },
                anlegen: [],
                uebersetze,
            });
            const [liste] = abschnitte;
            expect(liste?.id).toBe("flaechen");
            expect(liste?.titel).toBe("«areaChoice.count»");
            expect(liste?.eintraege.map((eintrag) => [eintrag.id, eintrag.text, eintrag.hinweis])).toEqual([
                ["flaeche-r-1", "Reichsforst", "Wald"],
                ["flaeche-r-2", "Mittelreich", "Wald"],
            ]);
            const unter = liste?.eintraege[1]?.unter ?? [];
            expect(unter[2]?.id).toBe("r-2|flaeche-beschriftung");
            expect(unter[2]?.grund).toBeUndefined();
            // Die Abschnitte stehen auch hier als Untermenü in der zweiten Ebene.
            expect(unter[3]?.id).toBe("r-2|flaeche-beschriftung-neu");
            expect(unter[4]).toMatchObject({ id: "r-2|gruppe-form" });
            expect(unter[4]?.unter?.[0]?.id).toBe("r-2|flaeche-verschieben");
            const { griff, gegenstand: gemeint } = griffAn("r-2|flaeche-beschriftung", flaechen);
            expect([griff, gemeint?.title]).toEqual(["flaeche-beschriftung", "Mittelreich"]);
        });
    });

    it("🔴 „Neuer Fluss/Bach ›“ (Plan Fluss/Bach, Knopf „A · Untermenü“): in Standard und Landschaft, darin Fluss und Bach; legt an der Stelle mit der Art an, ohne Recht gesperrt", () => {
        const neuerFluss = vi.fn();
        const eintraege = (ueber: Partial<OrtLage> = {}) =>
            anlegenEintraege(
                lage(ueber),
                vi.fn(),
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                neuerFluss,
            );
        const hier = (view: "standard" | "landscapes" | "political", ueber: Partial<OrtLage> = {}) =>
            kartenAbschnitte({
                actions: [],
                subject: undefined,
                anlegen: eintraege(ueber),
                uebersetze,
                ansicht: view,
            })[0]?.eintraege[0]?.unter?.find((eintrag) => eintrag.id === "neuer-fluss");
        expect(hier("political")).toBeUndefined();
        for (const view of ["standard", "landscapes"] as const) {
            expect(hier(view)).toMatchObject({ text: "«wegeditor.anlegen.neuerFluss»", grund: undefined });
            expect(hier(view)?.unter?.map((u) => [u.id, u.text])).toEqual([
                ["neuer-fluss-fluss", "«wegeditor.anlegen.fluss»"],
                ["neuer-fluss-bach", "«wegeditor.anlegen.bach»"],
            ]);
        }
        expect(legeAn(eintraege(), "neuer-fluss-bach", { x: 3, y: 4 })).toBe(true);
        expect(neuerFluss).toHaveBeenCalledWith({ x: 3, y: 4 }, "bach");
        expect(legeAn(eintraege(), "neuer-fluss-fluss", { x: 5, y: 6 })).toBe(true);
        expect(neuerFluss).toHaveBeenLastCalledWith({ x: 5, y: 6 }, "fluss");
        // Ohne Recht an der Geometrie gesperrt mit Grund, und es legt nichts an.
        expect(
            hier("standard", { rechte: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"] })
                ?.grund,
        ).toBe("«ortseditor.handgriff.grund.recht»");
        expect(legeAn(eintraege({ rechte: [] }), "neuer-fluss-fluss", { x: 1, y: 1 })).toBe(false);
        expect(neuerFluss).toHaveBeenCalledTimes(2);
        // Ohne Anbindung steht er gesperrt mit „Kommt später.“.
        expect(
            kartenAbschnitte({
                actions: [],
                subject: undefined,
                anlegen: anlegenEintraege(lage(), vi.fn()),
                uebersetze,
            })[0]?.eintraege[0]?.unter?.find((eintrag) => eintrag.id === "neuer-fluss")?.grund,
        ).toBe("«editorPanel.spaeter.satz»");
    });

    it("🔴 OPS-000111: „▲ Landmarke setzen ›“ steht überall, wo die Karte Landmarken zeichnet; jede Art startet an der Stelle", () => {
        const setze = vi.fn();
        let auswahl: LandscapeSelection = "vegetation";
        const eintraege = (ueber: Partial<OrtLage> = {}, view: MapView = "landscapes") =>
            anlegenEintraege(lage(ueber), vi.fn(), undefined, undefined, undefined, undefined, undefined, {
                sichtbar: () => composeView(view, auswahl).peaks !== "none",
                setze,
            });
        const hier = (view: MapView, ueber: Partial<OrtLage> = {}) =>
            kartenAbschnitte({
                actions: [],
                subject: undefined,
                anlegen: eintraege(ueber, view),
                uebersetze,
                ansicht: view,
            })[0]?.eintraege[0]?.unter;
        const gipfel = (view: MapView, ueber: Partial<OrtLage> = {}) =>
            hier(view, ueber)?.find((eintrag) => eintrag.id === "landmarke-setzen");
        // Betreiber 2026-11-11 (OPS-000111): „Ja, überall“. Gezeigt nur, wo eine gesetzte Landmarke auch zu sehen ist.
        expect(gipfel("standard")).toBeDefined();
        for (const view of ["political", "powerlines", "none"] as const) expect(gipfel(view)).toBeUndefined();
        for (const ebene of ["vegetation", "klima", "sprachen"] as const) {
            auswahl = ebene;
            expect(gipfel("landscapes")).toBeUndefined();
        }
        for (const ebene of ["alle", "derographisch", "topographie"] as const) {
            auswahl = ebene;
            expect(gipfel("landscapes")).toBeDefined();
        }
        expect(
            hier("landscapes")
                ?.map((eintrag) => eintrag.id)
                .slice(0, 2),
        ).toEqual(["neue-flaeche", "landmarke-setzen"]);
        expect(gipfel("landscapes")).toMatchObject({
            zeichen: "neuer-gipfel",
            text: "«landschaftseditor.landmarke.setzen»",
            grund: undefined,
        });
        // Kartenmenü A (§9): die Gipfel stehen darin, jede Art des Katalogs in seiner Folge.
        expect(gipfel("standard")?.unter?.map((eintrag) => eintrag.id)).toEqual(
            LANDMARKEN_ARTEN.map((art) => `landmarke-setzen-${art}`),
        );
        expect(
            gipfel("landscapes", {
                rechte: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"],
            })?.grund,
        ).toBe("«sonderrollen.grund.gebirge»");
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(gipfel("landscapes", { laeuft: true })).toBeUndefined();
        expect(legeAn(eintraege(), "landmarke-setzen-hoehle", { x: 512, y: 640 })).toBe(true);
        expect(setze).toHaveBeenCalledWith("hoehle", { x: 512, y: 640 });
        auswahl = "klima";
        expect(legeAn(eintraege(), "landmarke-setzen-berggipfel", { x: 1, y: 2 })).toBe(false);
        expect(setze).toHaveBeenCalledTimes(1);
    });
});
