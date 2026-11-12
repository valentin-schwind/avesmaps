import { afterEach, describe, expect, it, vi } from "vitest";
import {
    editorViewer,
    visitorViewer,
    type SubjectDetail,
    type SubjectRef,
    type ViewerCapability,
    type ViewerContext,
} from "@avesmaps3d/shared";
import {
    fuehreAus,
    handgriffZeilen,
    labelVon,
    NO_MENU_KINDS,
    visibleActions,
    type EditorAction,
    type EditorMenuSubject,
} from "../src/editor-menu/action.ts";
import { EDITOR_ACTIONS, editorActions } from "../src/editor-menu/actions.ts";
import { devEditorActions } from "../src/editor-menu/dev-actions.ts";
import { MENU_EDGE, MENU_GAP, placeMenu } from "../src/editor-menu/placement.ts";
import { subjectOf } from "../src/editor-menu/subject-identity.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import type { ShownSubject } from "../src/info-panel/subject-selection.ts";

/**
 * Die Action Registry des Editor-Menüs als Daten (WI-0063 P9, 15.2, 18.1): Was ein Descriptor sein muss, wer was sieht, und die
 * reinen Helfer (Platz, Name und Art). Das Verhalten des Menüs selbst steht in `editor-menu.test.ts`.
 */

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const REVISION = "1b1fc50153bf";
const GARETH: SubjectRef = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };
const WALD: SubjectRef = { kind: "area", id: "0b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11" };

const gareth: EditorMenuSubject = { ref: GARETH, title: "Gareth", art: "Metropole", answer: undefined };
const wald: EditorMenuSubject = { ref: WALD, title: "Waldwildnis", art: "Wald", answer: undefined };

const action = (over: Partial<EditorAction> & Pick<EditorAction, "id">): EditorAction => ({
    kinds: ["place"],
    capability: "use_editor_menu",
    gruppe: "bearbeiten",
    label: "editorMenu.dev.test",
    run: () => undefined,
    ...over,
});

/** Ein Betrachter mit genau diesen Fähigkeiten. */
const viewerWith = (...allowed: ViewerCapability[]): ViewerContext => ({
    source: "test",
    can: (capability) => allowed.includes(capability),
});

describe("🔴 die Registry besteht aus vollständigen Descriptors (WI-0063 18.1: keine Action ohne Handler und Capability)", () => {
    it("jede eingebaute Action hat Handler, Fähigkeit, mindestens eine Art und eine Beschriftung in Deutsch UND Englisch", () => {
        for (const entry of EDITOR_ACTIONS) {
            expect(typeof entry.run, `${entry.id}: Handler`).toBe("function");
            expect(entry.capability, `${entry.id}: Fähigkeit`).toBeTruthy();
            expect(entry.kinds.length, `${entry.id}: Arten`).toBeGreaterThan(0);
            expect(labelVon(entry, gareth) in de, `${entry.id}: deutsche Beschriftung`).toBe(true);
            expect(labelVon(entry, gareth) in en, `${entry.id}: englische Beschriftung`).toBe(true);
            expect(
                (entry.kinds as readonly string[]).filter((kind) => NO_MENU_KINDS.includes(kind as never)),
                `${entry.id}: eine Etappe hat nie ein Menü`,
            ).toEqual([]);
        }
    });

    it("die Kennungen sind eindeutig, in der eingebauten Registry wie mit den Testaktionen", () => {
        vi.stubGlobal("__avesmapsEditorActions", {});
        const ids = editorActions().map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("🔴 heute gibt es keine eingebaute Action: Phase 6 hängt hier an, wir erfinden keine (WI-0063 4.2)", () => {
        // Kein Test, der Phase 6 aufhält: Eine Action einzuhängen ist der vorgesehene Weg, und dieser Test prüft sie dann mit
        // dem ersten Absatz oben. Er hält nur fest, dass ohne Naht nichts in der Registry steht, was niemand gebaut hat.
        expect(editorActions()).toEqual([...EDITOR_ACTIONS]);
    });
});

describe("wer welche Action sieht", () => {
    const editor = editorViewer("test");

    it("nach Art: Eine Action gilt nur für ihre Arten", () => {
        const list = [action({ id: "a", kinds: ["place"] }), action({ id: "b", kinds: ["area", "territory"] })];
        expect(visibleActions(list, gareth, editor).map((entry) => entry.id)).toEqual(["a"]);
        expect(visibleActions(list, wald, editor).map((entry) => entry.id)).toEqual(["b"]);
    });

    it("🔴 nach Fähigkeit: ohne sie gibt es die Action für diesen Betrachter nicht, und für keinen Besucher", () => {
        const list = [action({ id: "a", capability: "pin_selection" })];
        expect(visibleActions(list, gareth, editor)).toHaveLength(1);
        expect(visibleActions(list, gareth, viewerWith("use_editor_menu"))).toEqual([]);
        expect(visibleActions(list, gareth, visitorViewer("test"))).toEqual([]);
    });

    it("das Sichtbarkeitsprädikat entscheidet je Gegenstand; es sieht Name, Art und, wenn da, die Antwort", () => {
        const seen: EditorMenuSubject[] = [];
        const list = [
            action({
                id: "nur-garethia",
                visible: (subject) => {
                    seen.push(subject);
                    return subject.title === "Gareth";
                },
            }),
        ];
        expect(visibleActions(list, gareth, editor)).toHaveLength(1);
        expect(visibleActions(list, { ...gareth, title: "Perricum" }, editor)).toEqual([]);
        expect(seen[0]).toBe(gareth);
    });

    it("innerhalb einer Gruppe ist die Reihenfolge der Registry die des Menüs", () => {
        const list = [action({ id: "z" }), action({ id: "a", danger: true }), action({ id: "m" })];
        expect(visibleActions(list, gareth, editor).map((entry) => entry.id)).toEqual(["z", "a", "m"]);
    });

    it("🔴 eine Etappe hat nie ein Menü, auch wenn ein Descriptor sie nennt (WI-0063 4.7)", () => {
        const stage: EditorMenuSubject = {
            ref: { kind: "routeStage", index: 2, routeKey: "route-1" },
            title: "Etappe 3",
            art: undefined,
            answer: undefined,
        };
        const list = [action({ id: "a", kinds: ["routeStage"] as never })];
        expect(visibleActions(list, stage, editor)).toEqual([]);
    });
});

describe("🔴 EIN Register, drei Stellen (EDIT-0002 §4.2, §6; EDIT-0003 G10)", () => {
    const editor = editorViewer("test");
    const ids = (list: readonly { id: string }[]): string[] => list.map((entry) => entry.id);

    it("🔴 an jedem Objekt dieselbe Folge: Bearbeiten · Form · Sichtbarkeit · Neues von hier aus · Entfernen", () => {
        const list = [
            action({ id: "weg", gruppe: "neu" }),
            action({ id: "weg-damit", gruppe: "entfernen", danger: true }),
            action({ id: "zeigen", gruppe: "sichtbarkeit" }),
            action({ id: "schieben", gruppe: "form" }),
            action({ id: "eigenschaften", gruppe: "bearbeiten" }),
            action({ id: "form-2", gruppe: "form" }),
        ];
        const folge = ["eigenschaften", "schieben", "form-2", "zeigen", "weg", "weg-damit"];
        expect(ids(visibleActions(list, gareth, editor))).toEqual(folge);
        expect(ids(handgriffZeilen(list, gareth, "karte"))).toEqual(folge);
        expect(ids(handgriffZeilen(list, gareth, "infopanel"))).toEqual(folge);
    });

    it("🔴 am Objekt nur, was geht; Kartenmenü und Infopanel zeigen Gesperrtes mit Grund (WI-0063 4.2)", () => {
        const list = [
            action({ id: "geht" }),
            action({ id: "gesperrt", gruppe: "form", sperre: () => "ortseditor.handgriff.grund.aus" }),
        ];
        expect(ids(visibleActions(list, gareth, editor))).toEqual(["geht"]);
        expect(handgriffZeilen(list, gareth, "karte").map((zeile) => [zeile.id, zeile.grund])).toEqual([
            ["geht", undefined],
            ["gesperrt", "ortseditor.handgriff.grund.aus"],
        ]);
    });

    it("`stellen` begrenzt, wo ein Handgriff steht; ein situativer steht in keinem Menü des Objekts", () => {
        const list = [
            action({ id: "ueberall" }),
            action({ id: "nur-panel", stellen: ["infopanel"] }),
            action({ id: "griff-am-modus", situativ: true }),
        ];
        expect(ids(visibleActions(list, gareth, editor))).toEqual(["ueberall"]);
        expect(ids(handgriffZeilen(list, gareth, "karte"))).toEqual(["ueberall"]);
        expect(ids(handgriffZeilen(list, gareth, "infopanel"))).toEqual(["ueberall", "nur-panel"]);
    });

    it("Beschriftung und Zeichen dürfen am Gegenstand hängen; die Zeile trägt Gefahr, Kürzel und Zwischenüberschrift", () => {
        const list = [
            action({
                id: "a",
                label: (subject) => (subject.title === "Gareth" ? "editorMenu.dev.test" : "editorMenu.dev.danger"),
                zeichen: () => "bearbeiten",
                danger: true,
                hinweis: "editorMenu.dev.test",
                abschnitt: "editorMenu.dev.danger",
            }),
        ];
        expect(handgriffZeilen(list, gareth, "karte")).toEqual([
            {
                id: "a",
                text: "editorMenu.dev.test",
                zeichen: "bearbeiten",
                grund: undefined,
                gefahr: true,
                hinweis: "editorMenu.dev.test",
                abschnitt: "editorMenu.dev.danger",
            },
        ]);
        expect(handgriffZeilen(list, { ...gareth, title: "Perricum" }, "karte")[0]?.text).toBe("editorMenu.dev.danger");
    });

    it("🔴 `fuehreAus` führt nur aus, was geht: nie gesperrt, nie ohne Fähigkeit, nie unbekannt", () => {
        const run = vi.fn();
        const list = [
            action({ id: "geht", run }),
            action({ id: "gesperrt", run, sperre: () => "ortseditor.handgriff.grund.laeuft" }),
            action({ id: "ohne-recht", run, capability: "edit_map_objects" }),
        ];
        expect(fuehreAus(list, "geht", gareth, editor)).toBe(true);
        expect(fuehreAus(list, "gesperrt", gareth, editor)).toBe(false);
        expect(fuehreAus(list, "ohne-recht", gareth, viewerWith("use_editor_menu"))).toBe(false);
        expect(fuehreAus(list, "gibt-es-nicht", gareth, editor)).toBe(false);
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith({ subject: gareth, viewer: editor });
    });
});

describe("🔴 die Entwicklungsnaht liefert Testaktionen - nur eingeschaltet", () => {
    it("ohne den Schalter ist die Registry leer: Es gibt keine Testaktion in einer normalen Sitzung", () => {
        expect(devEditorActions()).toEqual([]);
        expect(editorActions()).toEqual([]);
    });

    it("mit dem Schalter kommen eine gewöhnliche und eine gefährliche Testaktion; beide vermerken nur ihren Aufruf", () => {
        const calls: { id: string; kind: string }[] = [];
        vi.stubGlobal("__avesmapsEditorActions", { calls });
        const list = devEditorActions();
        expect(list.map((entry) => [entry.id, entry.danger === true])).toEqual([
            ["dev.test", false],
            ["dev.danger", true],
        ]);
        for (const entry of list) entry.run({ subject: gareth, viewer: editorViewer("test") });
        expect(calls).toEqual([
            { id: "dev.test", kind: "place" },
            { id: "dev.danger", kind: "place" },
        ]);
    });

    it("die Arten lassen sich wählen: Eine Testaktion nur für Gebiete erscheint an einem Ort nicht", () => {
        vi.stubGlobal("__avesmapsEditorActions", { kinds: ["territory"] });
        expect(visibleActions(devEditorActions(), gareth, editorViewer("test"))).toEqual([]);
    });

    it("kein Objekt als Schalter, kein Menü: `true` oder ein Text schalten nichts ein", () => {
        vi.stubGlobal("__avesmapsEditorActions", true);
        expect(devEditorActions()).toEqual([]);
        vi.stubGlobal("__avesmapsEditorActions", null);
        expect(devEditorActions()).toEqual([]);
    });

    it("🔴 im Produktionsbau (`import.meta.env.DEV` falsch) bleibt die Naht stumm, auch mit gesetztem Schalter", () => {
        vi.stubGlobal("__avesmapsEditorActions", { calls: [] });
        vi.stubEnv("DEV", false);
        try {
            expect(devEditorActions()).toEqual([]);
        } finally {
            vi.unstubAllEnvs();
        }
    });
});

describe("wo das Menü steht", () => {
    const viewport = { left: 0, top: 0, right: 1280, bottom: 900 };
    const size = { width: 200, height: 120 };

    it("rechts und unterhalb des Klickpunkts, mit Abstand: Das angeklickte Zeichen bleibt zu sehen", () => {
        expect(placeMenu({ x: 300, y: 300 }, size, viewport)).toEqual({ x: 300 + MENU_GAP, y: 300 + MENU_GAP });
    });

    it("rechts zu knapp: Es klappt nach links; unten zu knapp: nach oben", () => {
        const at = placeMenu({ x: 1200, y: 850 }, size, viewport);
        expect(at).toEqual({ x: 1200 - MENU_GAP - size.width, y: 850 - MENU_GAP - size.height });
    });

    it("🔴 Panels, die die Karte decken, zählen nicht zum Platz: Das Infopanel rechts (400 px) wird nicht überdeckt, das Menü klappt nach links", () => {
        const free = { ...viewport, right: 1280 - 400 };
        const at = placeMenu({ x: 815, y: 400 }, size, free);
        expect(at.x).toBe(815 - MENU_GAP - size.width);
        expect(at.x + size.width).toBeLessThanOrEqual(free.right - MENU_EDGE);
    });

    it("und ein offener Planer links ebenso: Auch zum Klappen nach links reicht der Platz nur bis zu seiner Kante", () => {
        const free = { ...viewport, left: 350, right: 880 };
        const at = placeMenu({ x: 420, y: 300 }, { width: 300, height: 100 }, free);
        expect(at.x).toBeGreaterThanOrEqual(free.left + MENU_EDGE);
    });

    it("bleibt im Fenster, auch in der Ecke und wenn es zu groß ist", () => {
        const corner = placeMenu({ x: 2, y: 2 }, size, viewport);
        expect(corner.x).toBeGreaterThanOrEqual(MENU_EDGE);
        expect(corner.y).toBeGreaterThanOrEqual(MENU_EDGE);
        const tall = placeMenu({ x: 640, y: 450 }, { width: 200, height: 2000 }, viewport);
        expect(tall.y).toBe(MENU_EDGE);
        const wide = placeMenu({ x: 640, y: 450 }, { width: 3000, height: 100 }, viewport);
        expect(wide.x).toBe(MENU_EDGE);
    });
});

describe("Name und Art des Gegenstands (wie der Kopf des Infopanels)", () => {
    const shown = (ref: SubjectRef, over: Partial<ShownSubject> = {}): ShownSubject => ({
        ref,
        key: "k",
        title: undefined,
        status: "ready",
        answer: undefined,
        ...over,
    });
    const detail = (ref: SubjectRef, over: Partial<SubjectDetail>): SubjectDetail => ({
        subject: ref,
        revision: REVISION,
        ...over,
    });

    it("vor der Antwort steht der Name, den die Karte kannte, und keine Art", () => {
        expect(subjectOf(shown(GARETH, { title: "Gareth", status: "loading" }))).toMatchObject({
            title: "Gareth",
            art: undefined,
        });
    });

    it("ohne bekannten Namen heißt er „Ohne Namen“, nie leer", () => {
        expect(subjectOf(shown(WALD, { status: "loading" })).title).toBe(de["infoPanel.untitled"]);
    });

    it("mit der Antwort: Name der Fachdomäne, Art in Worten (Legacys Regel: der erste Eintrag des Untertitels)", () => {
        const answer = detail(GARETH, { title: "Gareth", subtitle: [{ part: "type", key: "metropole" }] });
        expect(subjectOf(shown(GARETH, { title: "gareth", answer }))).toMatchObject({
            title: "Gareth",
            art: "Metropole",
        });
    });

    it("eine namenlose Fläche heißt nach ihrer Art („Wald“), und die Art steht nicht noch einmal daneben", () => {
        // WI-0105: Vorher stand hier die blanke Art, zweimal nebeneinander (Titel wie Art). OPS-073: Der Satz IST jetzt die Art
        // („Unbezeichneter Wald“ -> „Wald“), also entfällt sie neben dem Titel.
        const answer = detail(WALD, { subtitle: [{ part: "type", key: "wald" }] });
        expect(subjectOf(shown(WALD, { answer }))).toMatchObject({
            title: de["landscape.unnamed.wald"],
            art: undefined,
        });
        expect(de["landscape.unnamed.wald"]).toBe("Wald");
    });

    it("eine Fläche mit eigenem Namen behält ihre Art daneben", () => {
        const answer = detail(WALD, { title: "Waldwildnis", subtitle: [{ part: "type", key: "wald" }] });
        expect(subjectOf(shown(WALD, { answer }))).toMatchObject({ title: "Waldwildnis", art: "Wald" });
    });

    it("ein Weg ohne Namen: „Unbezeichneter Fluss“, die Art steht daneben nur bei Wasser", () => {
        const ref: SubjectRef = { kind: "path", chain: "Gardel:Flussweg" };
        const answer = detail(ref, { subtitle: [{ part: "type", key: "Flussweg" }] });
        expect(subjectOf(shown(ref, { answer })).title).toBe(de["infoPanel.unnamed.Flussweg"]);
    });

    it("die freie Kartenstelle heißt „Was ist hier?“", () => {
        expect(subjectOf(shown({ kind: "mapPoint", x: 1, y: 2 })).title).toBe(de["infoPanel.mapPoint.title"]);
    });
});
