import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref, type Ref } from "vue";
import {
    AVENTURIA,
    editorViewer,
    toRenderLngLat,
    visitorViewer,
    type SubjectDetail,
    type SubjectRef,
    type ViewerContext,
} from "@avesmaps3d/shared";
import type { EditorAction } from "../src/editor-menu/action.ts";
import { editorActions } from "../src/editor-menu/actions.ts";
import { createEditorMenu, type EditorMenu, type EditorMenuVorschau } from "../src/editor-menu/editor-menu.ts";
import { createRevisionCache } from "../src/info-panel/subject-cache.ts";
import type { SubjectAnswer, SubjectClient } from "../src/info-panel/subject-client.ts";
import { subjectRefOfPlace } from "../src/info-panel/subject-refs.ts";
import {
    createSubjectSelection,
    type OpenSubjectOptions,
    type SubjectSelection,
} from "../src/info-panel/subject-selection.ts";
import { createEscapeCascade, type EscapeCascade } from "../src/keyboard/escape-cascade.ts";
import { placeOwner } from "../src/map/interaction/owners.ts";
import { PLACE_MARKER_LAYER_ID } from "../src/map/place-layers.ts";
import { createHarness, feature, mouse, type Harness } from "./fake-interaction-map.ts";

/**
 * Das Editor-Menü am Objekt (WI-0063 P9, 4.2, 4.10, 15): Wann es aufgeht, wann es zugeht, und was es nie tut. Die Auswahl ist die
 * echte (`createSubjectSelection`), die Karte ein Testdoppel; Antworten des Servers schickt der Test selbst ab.
 */

const REVISION = "1b1fc50153bf";
const GARETH: SubjectRef = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };
const WALD: SubjectRef = { kind: "area", id: "0b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11" };

const garethDetail: SubjectDetail = {
    subject: GARETH,
    revision: REVISION,
    title: "Gareth",
    subtitle: [{ part: "type", key: "metropole" }],
};

const CLICK = { x: 340, y: 260 };
const MAP_CLICK: Pick<OpenSubjectOptions, "source" | "camera" | "anchor"> = {
    source: "map",
    camera: "none",
    anchor: CLICK,
};

const ACTION: EditorAction = {
    id: "test",
    kinds: ["place", "area"],
    capability: "use_editor_menu",
    gruppe: "bearbeiten",
    label: "editorMenu.dev.test",
    run: () => undefined,
};
const DANGER: EditorAction = { ...ACTION, id: "danger", label: "editorMenu.dev.danger", danger: true };

interface Setup {
    selection: SubjectSelection;
    menu: EditorMenu;
    cascade: EscapeCascade;
    /** Wie viele Male das Zeigen auf der Karte ruht (Hand, die noch nicht zurückgegeben wurde). */
    holds: () => number;
    answers: { ref: SubjectRef; resolve: (answer: SubjectAnswer | null) => void }[];
    desktop: Ref<boolean>;
    capture: { id: string | undefined };
    actions: { list: readonly EditorAction[] };
}

function create(
    options: {
        viewer?: ViewerContext;
        actions?: readonly EditorAction[];
        canPin?: boolean;
        vorschau?: (jetzt: EditorMenuVorschau | undefined) => void;
    } = {},
): Setup {
    const answers: Setup["answers"] = [];
    const client: SubjectClient = {
        detail: (subject) => new Promise((resolve) => answers.push({ ref: subject, resolve })),
        resolveLink: () => Promise.reject(new Error("nicht gebraucht")),
    };
    let holding = 0;
    const desktop = ref(true);
    const capture: Setup["capture"] = { id: undefined };
    const actions: Setup["actions"] = { list: options.actions ?? [ACTION] };
    const hook: { menu?: EditorMenu } = {};
    const selection = createSubjectSelection({
        client,
        canPin: options.canPin ?? false,
        cache: createRevisionCache<SubjectAnswer>({ ttlMs: 60_000, size: 10, now: () => 0 }),
        effects: { present: () => undefined, clear: () => undefined, fly: () => undefined },
        onOpened: (opened, open) => hook.menu?.subjectOpened(opened, open),
    });
    const menu = createEditorMenu({
        viewer: options.viewer ?? editorViewer("test"),
        actions: () => actions.list,
        selection,
        available: () => desktop.value,
        captured: () => capture.id,
        ...(options.vorschau !== undefined ? { vorschau: options.vorschau } : {}),
        holdPointer: () => {
            holding += 1;
            return () => {
                holding -= 1;
            };
        },
    });
    hook.menu = menu;
    const cascade = createEscapeCascade();
    menu.attachEscape(cascade);
    cascade.register("info-panel", () => selection.escapeVisible());
    cascade.register("map-selection", () => selection.escapeSelection());
    return {
        selection,
        menu,
        cascade,
        holds: () => holding,
        answers,
        desktop,
        capture,
        actions,
    };
}

const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

describe("🔴 das Menü öffnet nur, wo es etwas zu tun gibt (WI-0063 4.2, 15.2)", () => {
    it("🔴 heute gibt es keine Action: ein Klick auf Gareth öffnet für einen Editor kein Menü - das Infopanel schon", () => {
        const { selection, menu } = create({ actions: editorActions() });
        selection.openSubject(GARETH, { ...MAP_CLICK, known: { title: "Gareth" } });
        expect(menu.view.value).toBeUndefined();
        // Das Infopanel ist davon unberührt: Gareth ist gewählt und der rechte Slot offen.
        expect(selection.selected.value).toEqual(GARETH);
        expect(selection.panelVisible.value).toBe(true);
    });

    it("mit einer Action: ein Linksklick auf einen Ort öffnet das Menü am Klickpunkt, zusätzlich zur Auswahl", () => {
        const { selection, menu } = create();
        selection.openSubject(GARETH, { ...MAP_CLICK, known: { title: "Gareth" } });
        expect(menu.view.value).toMatchObject({ anchor: CLICK, subject: { title: "Gareth" } });
        expect(menu.view.value?.items.map((item) => item.id)).toEqual(["test"]);
        // 4.2 Punkte 1 bis 3: Die Auswahl und das Panel stehen wie ohne Menü.
        expect(selection.selected.value).toEqual(GARETH);
        expect(selection.panelVisible.value).toBe(true);
    });

    it("sein Kopf nennt Name und Art; die Art kommt mit der Antwort des Servers", async () => {
        const { selection, menu, answers } = create();
        selection.openSubject(GARETH, { ...MAP_CLICK, known: { title: "Gareth" } });
        expect(menu.view.value?.subject).toMatchObject({ title: "Gareth", art: undefined });
        answers[0]?.resolve(garethDetail);
        await flush();
        expect(menu.view.value?.subject).toMatchObject({ title: "Gareth", art: "Metropole" });
        expect(menu.view.value?.anchor).toEqual(CLICK);
    });

    it("eine Action für eine andere Art: kein Menü", () => {
        const { selection, menu } = create({ actions: [{ ...ACTION, kinds: ["territory"] }] });
        selection.openSubject(GARETH, MAP_CLICK);
        expect(menu.view.value).toBeUndefined();
    });

    it("das Menü zeigt nur die Actions, die für diesen Gegenstand gelten, in der Reihenfolge der Registry; die gefährliche trägt es als Eigenschaft", () => {
        const { selection, menu } = create({
            actions: [DANGER, ACTION, { ...ACTION, id: "nur-gebiet", kinds: ["territory"] }],
        });
        selection.openSubject(WALD, { ...MAP_CLICK, known: { title: "Waldwildnis" } });
        expect(menu.view.value?.items.map((item) => [item.id, item.danger])).toEqual([
            ["danger", true],
            ["test", false],
        ]);
    });

    it("ein Prädikat, das nach der Antwort nichts mehr sichtbar lässt, schließt das Menü: Es steht nie leer da", async () => {
        const { selection, menu, answers, holds } = create({
            actions: [{ ...ACTION, visible: (subject) => subject.answer === undefined || subject.title !== "Gareth" }],
        });
        selection.openSubject(GARETH, { ...MAP_CLICK, known: { title: "Gareth" } });
        expect(menu.view.value).toBeDefined();
        expect(holds()).toBe(1);
        answers[0]?.resolve(garethDetail);
        await flush();
        expect(menu.view.value).toBeUndefined();
        expect(holds()).toBe(0);
    });
});

describe("🔴 ein Besucher sieht nie ein Menü (WI-0063 15.1, Kriterium 2)", () => {
    it("ohne irgendeine Fähigkeit: kein Menü, auch mit Actions in der Registry", () => {
        const { selection, menu } = create({ viewer: visitorViewer("test") });
        selection.openSubject(GARETH, { ...MAP_CLICK, known: { title: "Gareth" } });
        expect(menu.view.value).toBeUndefined();
        expect(selection.panelVisible.value).toBe(true);
    });

    it("🔴 auch ein Betrachter, dem nur die Fähigkeit des Menüs fehlt, bekommt keins - obwohl er die der Action hätte", () => {
        const viewer: ViewerContext = { source: "test", can: (capability) => capability !== "use_editor_menu" };
        const { selection, menu } = create({ viewer, actions: [{ ...ACTION, capability: "pin_selection" }] });
        selection.openSubject(GARETH, MAP_CLICK);
        expect(menu.view.value).toBeUndefined();
    });
});

describe("nur ein Linksklick der Karte, nur am Rechner", () => {
    it.each(["search", "link", "planner", "context"] as const)(
        "🔴 %s öffnet nie ein Menü, auch mit Klickpunkt: Suche, Link und Planer sind kein Klick auf ein Kartenobjekt (4.6, 4.7)",
        (source) => {
            const { selection, menu } = create();
            selection.openSubject(GARETH, { source, camera: "none", anchor: CLICK });
            expect(menu.view.value).toBeUndefined();
        },
    );

    it("eine Öffnung der Karte ohne Klickpunkt (ein Besitzer, der ihn nicht mitgab) öffnet keins", () => {
        const { selection, menu } = create();
        selection.openSubject(GARETH, { source: "map", camera: "none" });
        expect(menu.view.value).toBeUndefined();
    });

    it("🔴 am Telefon gibt es nie ein Menü (4.3)", () => {
        const setup = create();
        setup.desktop.value = false;
        setup.selection.openSubject(GARETH, MAP_CLICK);
        expect(setup.menu.view.value).toBeUndefined();
        expect(setup.holds()).toBe(0);
    });

    it("wird das Fenster zum Telefon (Drehen, Größe), während es offen ist, geht es zu und gibt den Zeiger zurück", () => {
        const setup = create();
        setup.selection.openSubject(GARETH, MAP_CLICK);
        expect(setup.holds()).toBe(1);
        setup.desktop.value = false;
        expect(setup.menu.view.value).toBeUndefined();
        expect(setup.holds()).toBe(0);
    });

    it("🔴 eine Etappe öffnet nie ein Menü: Klick auf die Routenlinie zeigt ihre Information im Infopanel (4.7)", () => {
        const { selection, menu } = create({ actions: [{ ...ACTION, kinds: ["routeStage"] as never }] });
        selection.openSubject(
            { kind: "routeStage", index: 1, routeKey: "route-1" },
            { ...MAP_CLICK, known: { presentation: { stage: 1 } } },
        );
        expect(menu.view.value).toBeUndefined();
    });

    it("🔴 eine fixierte Auswahl (Leertaste): Ein Kartenklick auf etwas anderes ändert weder sie noch das Menü", () => {
        const { selection, menu, holds } = create({ canPin: true });
        selection.openSubject(GARETH, { ...MAP_CLICK, known: { title: "Gareth" } });
        selection.togglePin();
        expect(selection.pinned.value).toBe(true);
        expect(selection.openSubject(WALD, { ...MAP_CLICK, anchor: { x: 10, y: 10 } })).toBe(false);
        expect(menu.view.value?.subject.ref).toEqual(GARETH);
        expect(menu.view.value?.anchor).toEqual(CLICK);
        expect(holds()).toBe(1);
    });
});

describe("🔴 ein Werkzeug, das den Zeiger erfasst hat, behält die Geste (WI-0063 15.3)", () => {
    it("ist der Zeiger erfasst, öffnet eine Öffnung der Karte kein Menü", () => {
        const setup = create();
        setup.capture.id = "waypoint-drag";
        setup.selection.openSubject(GARETH, MAP_CLICK);
        expect(setup.menu.view.value).toBeUndefined();
        expect(setup.holds()).toBe(0);
    });

    describe("am echten Koordinator der Karte: ein Klick auf einen Ort", () => {
        let harness: Harness;
        let setup: Setup;

        beforeEach(() => {
            vi.useFakeTimers();
            harness = createHarness();
            harness.map.layers.add(PLACE_MARKER_LAYER_ID);
            setup = create();
            // So hängt `app.vue` den Ort an: der Klickpunkt des Besitzers wandert als Anker durch die Öffnungsnaht.
            harness.coordinator.register(
                placeOwner({
                    select: (place, at) => {
                        const subject = subjectRefOfPlace(place);
                        if (subject === undefined) return;
                        setup.selection.openSubject(subject, {
                            source: "map",
                            camera: "none",
                            known: { title: place.name, presentation: { place } },
                            anchor: at,
                        });
                    },
                }),
            );
            const { lng, lat } = toRenderLngLat(AVENTURIA.coordinateSpace, { x: 551.625, y: 532.969 });
            harness.map.hits = [
                feature(
                    PLACE_MARKER_LAYER_ID,
                    { public_id: GARETH.kind === "place" ? GARETH.id : "", name: "Gareth", subtype: "metropole" },
                    { type: "Point", coordinates: [lng, lat] },
                ),
            ];
        });

        afterEach(() => {
            harness.coordinator.destroy();
            vi.useRealTimers();
        });

        it("ohne Werkzeug öffnet er das Menü an der Stelle des Klicks (Fensterkoordinaten)", () => {
            harness.map.fire("click", mouse(5, 5));
            expect(setup.menu.view.value).toMatchObject({ anchor: { x: 105, y: 105 }, subject: { title: "Gareth" } });
            expect(setup.selection.selected.value).toEqual(GARETH);
        });

        it("🔴 hält ein Werkzeug den Zeiger, kommt der Klick gar nicht erst bei der Auswahl an: weder Menü noch Wechsel", () => {
            const release = harness.coordinator.capture("waypoint-drag", 7);
            expect(release).toBeDefined();
            harness.map.fire("click", mouse(5, 5));
            expect(setup.menu.view.value).toBeUndefined();
            expect(setup.selection.selected.value).toBeUndefined();
            release?.();
            harness.map.fire("click", mouse(5, 5));
            expect(setup.menu.view.value).toBeDefined();
        });
    });
});

describe("zugehen (WI-0063 4.10)", () => {
    it("🔴 Escape schließt zuerst das Menü: Panel und Auswahl bleiben; das zweite Escape schließt das Panel samt Auswahl", () => {
        const { selection, menu, cascade, holds } = create();
        selection.openSubject(GARETH, MAP_CLICK);
        expect(cascade.run()).toBe("floating-menu");
        expect(menu.view.value).toBeUndefined();
        expect(holds()).toBe(0);
        expect(selection.selected.value).toEqual(GARETH);
        expect(selection.panelVisible.value).toBe(true);
        expect(cascade.run()).toBe("info-panel");
        expect(selection.selected.value).toBeUndefined();
    });

    it("die Menüs der Karte (Auge, Fächer, Liste, Kartenmenü) schließen vor dem Menü am Objekt (Escape-Kaskade, Stage-Fund 2026-10-20)", () => {
        const { selection, cascade } = create();
        const log: string[] = [];
        let offen = true;
        cascade.register("menus", () => {
            log.push("menus");
            const war = offen;
            offen = false;
            return war;
        });
        selection.openSubject(GARETH, MAP_CLICK);
        expect(cascade.run()).toBe("menus");
        expect(cascade.run()).toBe("floating-menu");
        expect(log).toEqual(["menus", "menus"]);
    });

    it("ein Klick daneben und jede Kartenbewegung rufen `close`; das Menü ist dann zu, die Auswahl bleibt", () => {
        const { selection, menu, holds } = create();
        selection.openSubject(GARETH, MAP_CLICK);
        expect(menu.close()).toBe(true);
        expect(menu.view.value).toBeUndefined();
        expect(holds()).toBe(0);
        expect(menu.close()).toBe(false);
        expect(selection.selected.value).toEqual(GARETH);
    });

    it("🔴 wechselt die Auswahl zu etwas anderem (Suche), ist das Menü zu: Es gehört dem gewählten Subject", () => {
        const { selection, menu, holds } = create();
        selection.openSubject(GARETH, MAP_CLICK);
        selection.openSubject(WALD, { source: "search", camera: "none" });
        expect(menu.view.value).toBeUndefined();
        expect(holds()).toBe(0);
    });

    it("🔴 ist nichts mehr gewählt (Leerklick), ist das Menü zu", () => {
        const { selection, menu } = create();
        selection.openSubject(GARETH, MAP_CLICK);
        selection.closeSubject();
        expect(menu.view.value).toBeUndefined();
    });

    it("gibt es den Subject nicht (404), ist das Menü zu", async () => {
        const { selection, menu, answers } = create();
        selection.openSubject(GARETH, MAP_CLICK);
        answers[0]?.resolve(null);
        await flush();
        expect(menu.view.value).toBeUndefined();
    });

    it("ein neuer Klick auf einen anderen Gegenstand ersetzt das Menü; es gibt höchstens eines, und der Zeiger ruht nur einmal", () => {
        const { selection, menu, holds } = create();
        selection.openSubject(GARETH, MAP_CLICK);
        selection.openSubject(WALD, { ...MAP_CLICK, anchor: { x: 500, y: 300 }, known: { title: "Waldwildnis" } });
        expect(menu.view.value).toMatchObject({ anchor: { x: 500, y: 300 }, subject: { title: "Waldwildnis" } });
        expect(holds()).toBe(1);
    });

    it("🔴 derselbe Gegenstand noch einmal an anderer Stelle: Das Menü kommt an den neuen Klickpunkt wieder", () => {
        const { selection, menu, holds } = create();
        selection.openSubject(GARETH, MAP_CLICK);
        menu.close();
        selection.openSubject(GARETH, { ...MAP_CLICK, anchor: { x: 400, y: 410 } });
        expect(menu.view.value?.anchor).toEqual({ x: 400, y: 410 });
        expect(holds()).toBe(1);
    });

    it("ein Klick auf einen Gegenstand ohne sichtbare Action schließt ein offenes Menü und öffnet keins", () => {
        const setup = create({ actions: [{ ...ACTION, kinds: ["place"] }] });
        setup.selection.openSubject(GARETH, MAP_CLICK);
        expect(setup.menu.view.value).toBeDefined();
        setup.selection.openSubject(WALD, MAP_CLICK);
        expect(setup.menu.view.value).toBeUndefined();
        expect(setup.holds()).toBe(0);
    });

    it("die Registry wird bei jedem Öffnen frisch gelesen: Eine Action, die später dazukommt, gilt ab dem nächsten Klick", () => {
        const setup = create({ actions: [] });
        setup.selection.openSubject(GARETH, MAP_CLICK);
        expect(setup.menu.view.value).toBeUndefined();
        setup.actions.list = [ACTION];
        setup.selection.openSubject(GARETH, MAP_CLICK);
        expect(setup.menu.view.value).toBeDefined();
    });

    it("`destroy` räumt auf: zu, und der Zeiger ist zurück", () => {
        const { selection, menu, holds } = create();
        selection.openSubject(GARETH, MAP_CLICK);
        menu.destroy();
        expect(menu.view.value).toBeUndefined();
        expect(holds()).toBe(0);
    });
});

describe("eine Zeile wählen", () => {
    it("🔴 das Menü ist zu, BEVOR der Handler läuft; er bekommt den Gegenstand und den Betrachter", () => {
        const seen: unknown[] = [];
        const later: { setup?: Setup } = {};
        const run = vi.fn((context: Parameters<EditorAction["run"]>[0]) => {
            seen.push({
                open: later.setup?.menu.view.value !== undefined,
                holds: later.setup?.holds(),
                subject: context.subject,
            });
        });
        const setup = create({ actions: [{ ...ACTION, run }] });
        later.setup = setup;
        setup.selection.openSubject(GARETH, { ...MAP_CLICK, known: { title: "Gareth" } });
        expect(setup.menu.choose("test")).toBe(true);
        expect(run).toHaveBeenCalledTimes(1);
        expect(seen).toMatchObject([{ open: false, holds: 0, subject: { ref: GARETH, title: "Gareth" } }]);
        expect(setup.menu.view.value).toBeUndefined();
        // Die Auswahl bleibt: Eine Action ändert nicht, was gewählt ist.
        expect(setup.selection.selected.value).toEqual(GARETH);
    });

    it("eine Zeile, die es nicht gibt, tut nichts", () => {
        const run = vi.fn();
        const { selection, menu } = create({ actions: [{ ...ACTION, run }] });
        selection.openSubject(GARETH, MAP_CLICK);
        expect(menu.choose("gibt-es-nicht")).toBe(false);
        expect(menu.view.value).toBeDefined();
        expect(run).not.toHaveBeenCalled();
    });

    it("🔴 eine Action, die für diesen Gegenstand nicht gilt, läuft auch über ihre Kennung nicht", () => {
        const run = vi.fn();
        const { selection, menu } = create({
            actions: [ACTION, { ...ACTION, id: "gebiet", kinds: ["territory"], run }],
        });
        selection.openSubject(GARETH, MAP_CLICK);
        expect(menu.choose("gebiet")).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    it("ohne offenes Menü läuft nichts", () => {
        const run = vi.fn();
        const { menu } = create({ actions: [{ ...ACTION, run }] });
        expect(menu.choose("test")).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });
});

describe("🔴 eine Zeile mit Untermenü (EDIT-0003 T49, Abschnitte im Menü am Weg)", () => {
    const AUSWAHL: EditorAction = {
        ...ACTION,
        id: "kurve",
        auswahl: () => [
            { id: "a1", text: "1 · Angbar – Ferdok", vorschau: true },
            { id: "a2", text: "2 · Ferdok – Abzweig", hinweis: "außerhalb", vorschau: true },
        ],
    };

    it("🔴 die Zeile trägt ihre Wahlen; gewählt wird `griff#wahl`, und die Action bekommt die Wahl", () => {
        const run = vi.fn();
        const { selection, menu } = create({ actions: [{ ...AUSWAHL, run }] });
        selection.openSubject(GARETH, MAP_CLICK);
        expect(menu.view.value?.items[0]?.auswahl?.map((w) => w.id)).toEqual(["a1", "a2"]);
        expect(menu.choose("kurve#a2")).toBe(true);
        expect(run).toHaveBeenCalledWith(expect.objectContaining({ wahl: "a2" }));
        expect(menu.view.value).toBeUndefined();
    });

    it("🔴 eine Zeile mit Untermenü läuft nie ohne Wahl und nie mit einer fremden", () => {
        const run = vi.fn();
        const { selection, menu } = create({ actions: [{ ...AUSWAHL, run }] });
        selection.openSubject(GARETH, MAP_CLICK);
        expect(menu.choose("kurve")).toBe(false);
        expect(menu.choose("kurve#a9")).toBe(false);
        expect(run).not.toHaveBeenCalled();
        expect(menu.view.value).toBeDefined();
    });

    it("Zeigen auf eine Wahl meldet das Menü seinem Besitzer; Schließen nimmt es zurück", () => {
        const vorschau = vi.fn();
        const { selection, menu } = create({ actions: [AUSWAHL], vorschau });
        selection.openSubject(GARETH, { ...MAP_CLICK, known: { title: "Gareth" } });
        menu.zeige("kurve", "a1");
        expect(vorschau).toHaveBeenLastCalledWith(
            expect.objectContaining({
                griff: "kurve",
                wahl: "a1",
                subject: expect.objectContaining({ title: "Gareth" }),
            }),
        );
        menu.close();
        expect(vorschau).toHaveBeenLastCalledWith(undefined);
    });
});
