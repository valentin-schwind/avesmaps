import { describe, expect, it, vi } from "vitest";
import { sessionViewer, type MapView } from "@avesmaps3d/shared";
import { fuehreAus, handgriffZeilen, visibleActions } from "../src/editor-menu/action.ts";
import { doppelklickGriff } from "../src/editor-menu/doppelklick.ts";
import { ortHandgriffe, ortSubjekt, type OrtLage } from "../src/editor-menu/handgriffe-ort.ts";
import { kraftlinieHandgriffe, type KraftlinienLage } from "../src/editor-menu/handgriffe-kraftlinie.ts";
import { anlegenEintraege, griffAn, kartenAbschnitte, legeAn } from "../src/editor-menu/kartenmenue.ts";
import { kraftlinienpunktSubjekt, kraftlinieSubjekt } from "../src/kraftlinieneditor/kraftlinie-am-punkt.ts";
import { linienAmKnoten } from "../src/map/powerline-arcs.ts";

/**
 * Die Editor-Karte an einem Nodix in der Ansicht „Kraftlinien“ (EDIT-0003 T39, Betreiber 2026-10-17). Problemfälle: Dort stehen weiter
 * Ort verschieben, Verbergen oder Ort entfernen; der Filter greift in einer anderen Ansicht oder im Infopanel; „Kraftlinie entfernen ›“
 * steht ohne Linie da oder bietet eine Linie doppelt an; die Wahl im Untermenü erreicht eine andere Linie als die gewählte; ein
 * gesperrter Eintrag hat ein Untermenü, aus dem man trotzdem wählen könnte.
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
const AN = { rechte: ALLE, bearbeiten: { mapEditing: "testwelt" } as never, laeuft: false };
const KNOTEN = "0a0a0a0a-0000-4000-8000-00000000000a";
const LINIEN = [
    { anker: "0b0b0b0b-0000-4000-8000-000000000001", name: "Ley von Gareth" },
    { anker: "0b0b0b0b-0000-4000-8000-000000000007", name: "Nebellinie" },
];
const ORT = ortSubjekt({ id: KNOTEN, name: "Gareth" });
const uebersetze = (key: string): string => `«${key}»`;
const viewer = sessionViewer("test", ALLE);

function register(
    lage: Partial<KraftlinienLage> = {},
    entfernen = vi.fn(),
    wirkung: {
        eigenschaften?: (anker: string) => void;
        kurve?: (anker: string) => void;
        neu?: (knoten: string) => void;
        anfuegen?: (anker: string) => void;
        herausnehmen?: (anker: string, knoten: string) => void;
        punktEntfernen?: (knoten: string) => void;
        punktVerschieben?: (knoten: string) => void;
    } = {},
) {
    const ort = (): OrtLage => AN;
    return [
        ...ortHandgriffe(ort, { bearbeiten: vi.fn(), verschieben: vi.fn(), verbergen: vi.fn() }),
        ...kraftlinieHandgriffe(() => ({ ...AN, linienAm: () => LINIEN, ...lage }), {
            entfernen,
            eigenschaften: wirkung.eigenschaften ?? vi.fn(),
            kurve: wirkung.kurve ?? vi.fn(),
            neu: wirkung.neu ?? vi.fn(),
            anfuegen: wirkung.anfuegen ?? vi.fn(),
            herausnehmen: wirkung.herausnehmen ?? vi.fn(),
            punktEntfernen: wirkung.punktEntfernen ?? vi.fn(),
            punktVerschieben: wirkung.punktVerschieben ?? vi.fn(),
        }),
    ];
}

const objekt = (ansicht: MapView | undefined, actions = register()) =>
    kartenAbschnitte({ actions, subject: ORT, anlegen: [], uebersetze, ansicht }).find((a) => a.id === "objekt")!;

describe("Handgriffe am Nodix in der Ansicht Kraftlinien", () => {
    it("🔴 nur Eigenschaften bearbeiten, Neue Kraftlinie und Kraftlinie entfernen ›; verschieben, verbergen, entfernen entfallen", () => {
        expect(objekt("powerlines").eintraege.map((e) => [e.id, e.text])).toEqual([
            ["ort-bearbeiten", "«ortseditor.handgriff.bearbeiten»"],
            ["kraftlinie-herausnehmen", "«kraftlinieneditor.griff.herausnehmen»"],
            ["kraftlinie-neu", "«ortseditor.handgriff.kraftlinie»"],
            ["kraftlinie-entfernen", "«kraftlinieneditor.griff.entfernen»"],
        ]);
        const [, , neu, entfernen] = objekt("powerlines").eintraege;
        expect(neu!.grund).toBeUndefined();
        expect(entfernen!.gefahr).toBe(true);
    });

    it("🔴 in jeder anderen Ansicht bleibt die Karte des Orts, wie sie war, ohne die Kraftlinien-Griffe", () => {
        for (const ansicht of ["standard", "political", "landscapes", undefined] as const) {
            expect(objekt(ansicht).eintraege.map((e) => e.id)).toEqual([
                "ort-bearbeiten",
                "ort-verschieben",
                "ort-verbergen",
                "ort-entfernen",
            ]);
        }
    });

    it("🔴 das Infopanel kennt keine Ansicht und bleibt unverändert", () => {
        expect(handgriffZeilen(register(), ORT, "infopanel").map((z) => z.id)).not.toContain("kraftlinie-entfernen");
        expect(handgriffZeilen(register(), ORT, "infopanel").map((z) => z.id)).toContain("ort-verschieben");
    });

    it("🔴 „Kraftlinie entfernen ›“ listet die Linien am Knoten; die Wahl erreicht genau diese Linie", () => {
        const entfernen = vi.fn();
        const actions = register({}, entfernen);
        const eintrag = objekt("powerlines", actions).eintraege.find((e) => e.id === "kraftlinie-entfernen")!;
        expect(eintrag.unter!.map((u) => [u.id, u.text])).toEqual([
            [`kraftlinie-entfernen#${LINIEN[0]!.anker}`, "Ley von Gareth"],
            [`kraftlinie-entfernen#${LINIEN[1]!.anker}`, "Nebellinie"],
        ]);
        fuehreAus(actions, eintrag.unter![1]!.id, ORT, viewer);
        expect(entfernen).toHaveBeenCalledExactlyOnceWith(LINIEN[1]!.anker);
    });

    it("🔴 R5: „Aus der Linie nehmen ›“ am Nodix nimmt genau diesen Knoten aus der gewählten Linie; ohne Formrecht gesperrt", () => {
        const herausnehmen = vi.fn();
        const actions = register({}, vi.fn(), { herausnehmen });
        const eintrag = objekt("powerlines", actions).eintraege.find((e) => e.id === "kraftlinie-herausnehmen")!;
        fuehreAus(actions, eintrag.unter![0]!.id, ORT, viewer);
        expect(herausnehmen).toHaveBeenCalledExactlyOnceWith(LINIEN[0]!.anker, KNOTEN);
        const ohne = objekt(
            "powerlines",
            register({ rechte: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"] }),
        ).eintraege;
        expect(ohne.find((e) => e.id === "kraftlinie-herausnehmen")!.grund).toBe("«ortseditor.handgriff.grund.recht»");
    });

    it("eine Wahl, die am Knoten nicht (mehr) hängt, und der Griff ohne Wahl tun nichts", () => {
        const entfernen = vi.fn();
        const actions = register({}, entfernen);
        fuehreAus(actions, "kraftlinie-entfernen#0b0b0b0b-0000-4000-8000-0000000000ff", ORT, viewer);
        fuehreAus(actions, "kraftlinie-entfernen", ORT, viewer);
        expect(entfernen).not.toHaveBeenCalled();
    });

    it("ohne Linie am Knoten steht „Kraftlinie entfernen“ nicht da", () => {
        expect(objekt("powerlines", register({ linienAm: () => [] })).eintraege.map((e) => e.id)).toEqual([
            "ort-bearbeiten",
            "kraftlinie-neu",
        ]);
    });

    it("🔴 gesperrt (Bearbeiten aus, kein Recht, ein Modus läuft) mit Grund und ohne Untermenü", () => {
        const fall = (lage: Partial<KraftlinienLage>) =>
            objekt("powerlines", register(lage)).eintraege.find((e) => e.id === "kraftlinie-entfernen")!;
        const aus = fall({ bearbeiten: { mapEditing: "off", environment: "staging" } as never });
        expect(aus.grund).toBeDefined();
        expect(aus.unter).toBeUndefined();
        expect(fall({ rechte: ["use_editor_menu"] }).grund).toBe("«ortseditor.handgriff.grund.recht»");
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(fall({ laeuft: true })).toBeUndefined();
    });
});

describe("Handgriffe am Kraftlinienpunkt (EDIT-0003 T52, K10)", () => {
    const PUNKT = kraftlinienpunktSubjekt("0a0a0a0a-0000-4000-8000-00000000000b", "Kraftlinienpunkt");
    const amPunkt = (actions = register(), ansicht: MapView = "powerlines") =>
        kartenAbschnitte({ actions, subject: PUNKT, anlegen: [], uebersetze, ansicht }).find((a) => a.id === "objekt");

    it("🔴 wie am Nodix-Ort, dazu „Kraftlinienpunkt entfernen“ (rot, zuletzt); mit Linie gesperrt mit „Hier enden noch Kraftlinien“", () => {
        const eintraege = amPunkt()!.eintraege;
        expect(eintraege.map((e) => [e.id, e.text])).toEqual([
            ["kraftlinienpunkt-verschieben", "«kraftlinieneditor.punkt.verschieben»"],
            ["kraftlinie-herausnehmen", "«kraftlinieneditor.griff.herausnehmen»"],
            ["kraftlinie-neu", "«ortseditor.handgriff.kraftlinie»"],
            ["kraftlinie-entfernen", "«kraftlinieneditor.griff.entfernen»"],
            ["kraftlinienpunkt-entfernen", "«kraftlinieneditor.punkt.entfernen»"],
        ]);
        expect(eintraege.at(-1)).toMatchObject({ gefahr: true, grund: "«kraftlinieneditor.punkt.mitLinie»" });
        const entfernen = vi.fn();
        expect(
            fuehreAus(
                register({}, vi.fn(), { punktEntfernen: entfernen }),
                "kraftlinienpunkt-entfernen",
                PUNKT,
                viewer,
            ),
        ).toBe(false);
        expect(entfernen).not.toHaveBeenCalled();
    });

    it("🔴 ohne Linie geht „Kraftlinienpunkt entfernen“ und erreicht genau diesen Punkt; ohne eines der beiden Rechte gesperrt", () => {
        const entfernen = vi.fn();
        const actions = register({ linienAm: () => [] }, vi.fn(), { punktEntfernen: entfernen });
        expect(amPunkt(actions)!.eintraege.map((e) => [e.id, e.grund])).toEqual([
            ["kraftlinienpunkt-verschieben", undefined],
            ["kraftlinie-neu", undefined],
            ["kraftlinienpunkt-entfernen", undefined],
        ]);
        expect(fuehreAus(actions, "kraftlinienpunkt-entfernen", PUNKT, viewer)).toBe(true);
        expect(entfernen).toHaveBeenCalledExactlyOnceWith("0a0a0a0a-0000-4000-8000-00000000000b");
        for (const rechte of [
            ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"],
            ["use_editor_menu", "edit_map_geometry", "edit_territory_form", "edit_landscape_form", "edit_mountains"],
        ])
            expect(
                amPunkt(register({ linienAm: () => [], rechte }))!.eintraege.find(
                    (e) => e.id === "kraftlinienpunkt-entfernen",
                )?.grund,
            ).toBe("«ortseditor.handgriff.grund.recht»");
    });

    it("🔴 K5: „Kraftlinienpunkt verschieben“ erreicht genau diesen Punkt, auch mit Linie; ohne eines der beiden Rechte gesperrt", () => {
        const verschieben = vi.fn();
        expect(
            fuehreAus(
                register({}, vi.fn(), { punktVerschieben: verschieben }),
                "kraftlinienpunkt-verschieben",
                PUNKT,
                viewer,
            ),
        ).toBe(true);
        expect(verschieben).toHaveBeenCalledExactlyOnceWith("0a0a0a0a-0000-4000-8000-00000000000b");
        expect(
            amPunkt(
                register({ rechte: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"] }),
            )!.eintraege.find((e) => e.id === "kraftlinienpunkt-verschieben")?.grund,
        ).toBe("«ortseditor.handgriff.grund.recht»");
    });

    it("in einer anderen Ansicht steht am Kraftlinienpunkt nichts", () => {
        expect(amPunkt(register(), "standard")).toBeUndefined();
    });
});

describe("Linien an einem Knoten (linienAmKnoten)", () => {
    const ende = (id: string) => ({ id, kind: "place" as const });
    const abschnitt = (id: string, name: string, von: string, nach: string) => ({
        id,
        name,
        labelVisible: true,
        curve: null,
        from: ende(von),
        to: ende(nach),
        path: [
            [0, 0],
            [1, 1],
        ] as [number, number][],
    });

    it("🔴 je Linie einmal, Anker ist der kleinste Abschnitt gleichen Namens (auch einer fern vom Knoten), nach Namen geordnet", () => {
        const netz = {
            lines: [
                abschnitt("c3", "Nebellinie", "K", "X"),
                abschnitt("a1", "Nebellinie", "Y", "Z"),
                abschnitt("b2", "Nebellinie", "X", "K"),
                abschnitt("d4", "Ley von Gareth", "K", "W"),
                abschnitt("e5", "Fern", "Y", "Z"),
            ],
        };
        expect(linienAmKnoten(netz, "K")).toEqual([
            { anker: "d4", name: "Ley von Gareth" },
            { anker: "a1", name: "Nebellinie" },
        ]);
    });

    it("ein Abschnitt ohne Namen ist eine Linie für sich", () => {
        const netz = {
            lines: [abschnitt("b2", "", "K", "X"), abschnitt("a1", "", "K", "Y"), abschnitt("c3", " ", "Y", "K")],
        };
        expect(linienAmKnoten(netz, "K").map((l) => l.anker)).toEqual(["a1", "b2", "c3"]);
    });
});

/**
 * Rechtsklick und Doppelklick an einer Linie (WI-0205 K3; EDIT-0003 T25, R3; WI-0205 R8, R10). Problemfälle: ein Handgriff erreicht einen
 * anderen Abschnitt als den getroffenen; ohne Schreibrecht steht „Eigenschaften bearbeiten“ statt „Ansehen“; der Linksklick öffnet ein
 * Menü (Handgriffe nur im Rechtsklick); bei zwei Linien fehlt das Untermenü oder die Wahl trifft die andere Linie; der Doppelklick löst
 * etwas anderes aus als „Kurve bearbeiten“.
 */
describe("Handgriffe an einer Kraftlinie (K3)", () => {
    const ART = "Kraftlinie";
    const GARETH = kraftlinieSubjekt({ id: "0b0b0b0b-0000-4000-8000-000000000003", name: "Ley von Gareth" }, ART);
    const NEBEL = kraftlinieSubjekt({ id: "0b0b0b0b-0000-4000-8000-000000000009", name: "Nebellinie" }, ART);
    const linie = (actions = register(), subject = GARETH) =>
        kartenAbschnitte({ actions, subject, anlegen: [], uebersetze, ansicht: "powerlines" }).find(
            (a) => a.id === "objekt",
        )!;

    it("🔴 im Rechtsklick: Eigenschaften bearbeiten, Kurve bearbeiten mit Kürzel Doppelklick, Kraftlinie entfernen (rot, zuletzt)", () => {
        expect(linie().eintraege.map((e) => [e.id, e.text, e.hinweis])).toEqual([
            ["kraftlinie-eigenschaften", "«kraftlinieneditor.knopf.felder»", undefined],
            ["kraftlinie-kurve", "«kraftlinieneditor.knopf.form»", "«editorMenu.kuerzel.doppelklick»"],
            ["kraftlinie-anfuegen", "«kraftlinieneditor.griff.anfuegen»", undefined],
            ["kraftlinie-linie-entfernen", "«kraftlinieneditor.griff.entfernen»", undefined],
        ]);
        expect(linie().eintraege.at(-1)!.gefahr).toBe(true);
    });

    it("🔴 jeder Handgriff erreicht den getroffenen Abschnitt", () => {
        const [eigenschaften, kurve, entfernen] = [vi.fn(), vi.fn(), vi.fn()];
        const actions = register({}, entfernen, { eigenschaften, kurve });
        for (const id of ["kraftlinie-eigenschaften", "kraftlinie-kurve", "kraftlinie-linie-entfernen"])
            expect(fuehreAus(actions, id, GARETH, viewer)).toBe(true);
        for (const wirkung of [eigenschaften, kurve, entfernen])
            expect(wirkung).toHaveBeenCalledExactlyOnceWith(GARETH.ref.kind === "powerline" ? GARETH.ref.anchor : "");
    });

    it("🔴 ohne Schreibrecht „Ansehen“; Kurve und Entfernen gesperrt mit Grund; ein laufender Modus sperrt auch", () => {
        const lesend = linie(register({ rechte: ["use_editor_menu"] })).eintraege;
        expect(lesend.map((e) => [e.text, e.grund])).toEqual([
            ["«ortseditor.handgriff.ansehen»", undefined],
            ["«kraftlinieneditor.knopf.form»", "«ortseditor.handgriff.grund.recht»"],
            ["«kraftlinieneditor.griff.anfuegen»", "«ortseditor.handgriff.grund.recht»"],
            ["«kraftlinieneditor.griff.entfernen»", "«ortseditor.handgriff.grund.recht»"],
        ]);
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(linie(register({ laeuft: true })).eintraege.map((e) => e.text)).not.toContain(
            "«kraftlinieneditor.knopf.form»",
        );
    });

    it("🔴 K11: bearbeitet ein anderer die Linie, sind Kurve, Anfügen und Entfernen gesperrt („wird gerade bearbeitet“); Eigenschaften bleibt", () => {
        const anker = GARETH.ref.kind === "powerline" ? GARETH.ref.anchor : "";
        const sperreVon = (abschnitt: string) => (abschnitt === anker ? ({ id: anker } as never) : undefined);
        expect(linie(register({ sperreVon })).eintraege.map((e) => [e.id, e.grund])).toEqual([
            ["kraftlinie-eigenschaften", undefined],
            ["kraftlinie-kurve", "«sperre.grund»"],
            ["kraftlinie-anfuegen", "«sperre.grund»"],
            ["kraftlinie-linie-entfernen", "«sperre.grund»"],
        ]);
        // Eine andere Linie ist frei, und am Nodix steht keine Sperre am Eintrag (die Linie wählt man erst im Untermenü).
        expect(linie(register({ sperreVon }), NEBEL).eintraege.every((e) => e.grund === undefined)).toBe(true);
        expect(
            objekt("powerlines", register({ sperreVon: () => ({ id: anker }) as never })).eintraege.every(
                (e) => e.grund === undefined,
            ),
        ).toBe(true);
        // Gesperrt tut der Griff nichts.
        const kurve = vi.fn();
        expect(fuehreAus(register({ sperreVon }, vi.fn(), { kurve }), "kraftlinie-kurve", GARETH, viewer)).toBe(false);
        expect(kurve).not.toHaveBeenCalled();
    });

    it("🔴 Handgriffe nur im Rechtsklick: Der Linksklick auf die Linie öffnet kein Menü am Objekt", () => {
        expect(visibleActions(register(), GARETH, viewer, "powerlines")).toEqual([]);
    });

    it("🔴 „Hier laufen 2 Kraftlinien“: je Linie ihr Untermenü; die Wahl trifft genau diese Linie", () => {
        const kurve = vi.fn();
        const actions = register({}, vi.fn(), { kurve });
        const abschnitte = kartenAbschnitte({
            actions,
            subject: undefined,
            liste: { id: "kraftlinien", titel: "powerlineChoice.count", gegenstaende: [GARETH, NEBEL] },
            anlegen: [],
            uebersetze: (key, params) => `«${key}:${params?.["n"] ?? ""}»`,
            ansicht: "powerlines",
        });
        const liste = abschnitte.find((a) => a.id === "kraftlinien")!;
        expect(liste.titel).toBe("«powerlineChoice.count:2»");
        const nebel = liste.eintraege.find((e) => e.text === "Nebellinie")!;
        const kurveNebel = nebel.unter!.find((u) => u.id.endsWith("kraftlinie-kurve"))!;
        const { griff, gegenstand } = griffAn(kurveNebel.id, [GARETH, NEBEL]);
        fuehreAus(actions, griff, gegenstand!, viewer);
        expect(kurve).toHaveBeenCalledExactlyOnceWith("0b0b0b0b-0000-4000-8000-000000000009");
    });

    it("🔴 „Nodix anfügen“ an der Linie erreicht den getroffenen Abschnitt", () => {
        const anfuegen = vi.fn();
        expect(fuehreAus(register({}, vi.fn(), { anfuegen }), "kraftlinie-anfuegen", GARETH, viewer)).toBe(true);
        expect(anfuegen).toHaveBeenCalledExactlyOnceWith(GARETH.ref.kind === "powerline" ? GARETH.ref.anchor : "");
    });

    it("🔴 der Doppelklick auf eine Linie löst „Kurve bearbeiten“ aus", () => {
        expect(doppelklickGriff(register(), GARETH, viewer)?.id).toBe("kraftlinie-kurve");
    });

    it("eine namenlose Linie heißt nach ihrer Art", () => {
        expect(kraftlinieSubjekt({ id: "x", name: "" }, ART).title).toBe(ART);
    });

    it("🔴 K9: „Neue Kraftlinie“ am Nodix beginnt an genau ihm; ohne eines der beiden Rechte oder während eines Modus gesperrt", () => {
        const neu = vi.fn();
        const actions = register({}, vi.fn(), { neu });
        expect(fuehreAus(actions, "kraftlinie-neu", ORT, viewer)).toBe(true);
        expect(neu).toHaveBeenCalledExactlyOnceWith(KNOTEN);
        const grund = (lage: Partial<KraftlinienLage>) =>
            objekt("powerlines", register(lage)).eintraege.find((e) => e.id === "kraftlinie-neu")!.grund;
        expect(grund({ rechte: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"] })).toBe(
            "«ortseditor.handgriff.grund.recht»",
        );
        expect(
            grund({
                rechte: [
                    "use_editor_menu",
                    "edit_map_geometry",
                    "edit_territory_form",
                    "edit_landscape_form",
                    "edit_mountains",
                ],
            }),
        ).toBe("«ortseditor.handgriff.grund.recht»");
        // T58 (3): Im laufenden Modus fällt die Zeile weg, statt grau dazustehen.
        expect(
            objekt("powerlines", register({ laeuft: true })).eintraege.find((e) => e.id === "kraftlinie-neu"),
        ).toBeUndefined();
    });

    it("🔴 K9: „Hier hinzufügen › Neue Kraftlinie“ startet an der Stelle des Menüs (Nodix dort oder erster Klick); ohne Recht gesperrt", () => {
        const starte = vi.fn();
        const eintraege = (lage: Partial<OrtLage> = {}) =>
            anlegenEintraege(() => ({ ...AN, ...lage }), vi.fn(), vi.fn(), starte);
        const eintrag = (lage: Partial<OrtLage> = {}) => eintraege(lage).find((e) => e.id === "neue-kraftlinie")!;
        expect(eintrag().sperre()).toBeUndefined();
        expect(legeAn(eintraege(), "neue-kraftlinie", { x: 1, y: 2 })).toBe(true);
        expect(starte).toHaveBeenCalledExactlyOnceWith({ x: 1, y: 2 });
        expect(
            eintrag({
                rechte: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"],
            }).sperre(),
        ).toBe("ortseditor.handgriff.grund.recht");
        expect(eintrag({ laeuft: true }).sperre()).toBe("ortseditor.handgriff.grund.laeuft");
    });

    describe("„Hier hinzufügen“ je Ansicht (Betreiber 2026-10-18: Standard, Kraftlinien, Politisch, Derographie)", () => {
        const anlegen = anlegenEintraege(() => AN, vi.fn(), vi.fn(), vi.fn(), { sichtbar: () => true, setze: vi.fn() });
        const hier = (ansicht: MapView, subject?: typeof ORT) =>
            kartenAbschnitte({ actions: register(), subject, anlegen, uebersetze, ansicht })
                .find((a) => a.id === "anlegen")
                ?.eintraege[0]?.unter?.map((e) => e.id);

        it("🔴 Kraftlinien: auf freier Fläche nur „Neuer Kraftlinienpunkt“; am Nodix gar kein „Hier hinzufügen“", () => {
            expect(hier("powerlines")).toEqual(["neuer-kraftlinienpunkt"]);
            expect(hier("powerlines", ORT)).toBeUndefined();
        });

        it("🔴 Standard: „Neue Kraftlinie“ auf der obersten Ebene, kein Kraftlinienpunkt", () => {
            expect(hier("standard")).toEqual([
                "neue-flaeche",
                "neuer-ort",
                "neuer-weg",
                "neuer-fluss",
                "neue-kraftlinie",
            ]);
        });

        it("🔴 Politisch: weder Ort, Weg, Fläche noch Kraftlinie (Betreiber: „nur „Neues Herrschaftsgebiet““)", () => {
            for (const id of ["neue-flaeche", "neuer-ort", "neuer-weg", "neue-kraftlinie", "neuer-kraftlinienpunkt"])
                expect(hier("political") ?? []).not.toContain(id);
        });

        it("🔴 Derographie: von diesen Zeilen nur „Neue Fläche ›“ und „Neuer Fluss/Bach ›“ (Plan Fluss/Bach)", () => {
            expect(hier("landscapes")).toEqual(["neue-flaeche", "neuer-fluss"]);
        });
    });

    it("🔴 K9: „Hier hinzufügen › Neuer Kraftlinienpunkt“ setzt an der Stelle, nur in der Ansicht Kraftlinien, sonst mit Grund", () => {
        const setze = vi.fn();
        let sichtbar = true;
        const eintraege = (lage: Partial<OrtLage> = {}) =>
            anlegenEintraege(() => ({ ...AN, ...lage }), vi.fn(), vi.fn(), undefined, {
                sichtbar: () => sichtbar,
                setze,
            });
        const grund = (lage: Partial<OrtLage> = {}) =>
            eintraege(lage)
                .find((e) => e.id === "neuer-kraftlinienpunkt")!
                .sperre();
        expect(grund()).toBeUndefined();
        expect(legeAn(eintraege(), "neuer-kraftlinienpunkt", { x: 512, y: 640 })).toBe(true);
        expect(setze).toHaveBeenCalledExactlyOnceWith({ x: 512, y: 640 });
        expect(
            grund({
                rechte: [
                    "use_editor_menu",
                    "edit_map_geometry",
                    "edit_territory_form",
                    "edit_landscape_form",
                    "edit_mountains",
                ],
            }),
        ).toBe("ortseditor.handgriff.grund.recht");
        expect(grund({ laeuft: true })).toBe("ortseditor.handgriff.grund.laeuft");
        sichtbar = false;
        expect(grund()).toBe("kraftlinieneditor.punkt.nurAnsicht");
    });
});
