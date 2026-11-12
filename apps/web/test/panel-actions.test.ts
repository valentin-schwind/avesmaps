import { computed, reactive } from "vue";
import { describe, expect, it } from "vitest";
import type { SubjectDetail, SubjectRef, SubjectTarget, WaypointHit } from "@avesmaps3d/shared";
import type { ToastTone } from "../src/feedback/toast.ts";
import type { CatalogModel } from "../src/info-panel/catalog-model.ts";
import { catalogActions, hasLockedAction } from "../src/info-panel/panel-action-model.ts";
import { createPanelActions, type PanelActionDeps } from "../src/info-panel/panel-actions.ts";
import { panelModelOf } from "../src/info-panel/panel-model.ts";
import type { ActionRun, PanelAction } from "../src/info-panel/panel-types.ts";
import { GARETH_ID, env, gareth, reichsstrasseMitRoute, shown } from "./panel-fixtures.ts";

/**
 * Was die Aktionskacheln tun (WI-0063 P6): Die Beschreibung des Modells läuft über die VORHANDENEN Nähte - Planer, Zwischenablage mit
 * Meldungsweg, Kamera, Auswahl. Hier mit Attrappen; das Verhalten am echten Stack prüft `e2e/info-panel-grammar.spec.ts`.
 */

const HIT: WaypointHit = { id: GARETH_ID, name: "Gareth", subtype: "metropole", hidden: false, x: 551.6, y: 532.9 };

function setup(copied = true): {
    deps: PanelActionDeps;
    calls: string[];
    toasts: { text: string; tone: ToastTone; link: string | undefined }[];
    waypoints: { key: number; place: WaypointHit | null }[];
    flown: { ref: SubjectRef; target: SubjectTarget | undefined }[];
} {
    const calls: string[] = [];
    const toasts: { text: string; tone: ToastTone; link: string | undefined }[] = [];
    const waypoints = reactive<{ key: number; place: WaypointHit | null }[]>([{ key: 7, place: HIT }]);
    const flown: { ref: SubjectRef; target: SubjectTarget | undefined }[] = [];
    const deps: PanelActionDeps = {
        planner: {
            filled: computed(() => waypoints.flatMap((row) => (row.place ? [row.place] : []))),
            waypoints,
            addPlace: (place) => {
                calls.push(`addPlace:${place.id}`);
                return true;
            },
            addMapPoint: (point) => {
                calls.push(`addMapPoint:${String(point.x)},${String(point.y)}`);
                return true;
            },
            removeWaypoint: (key) => {
                calls.push(`removeWaypoint:${String(key)}`);
            },
            replaceWaypoints: (places) => {
                calls.push(`replaceWaypoints:${places.map((place) => place.name).join(">")}`);
                return Promise.resolve();
            },
            stepStage: (step) => {
                calls.push(`stepStage:${String(step)}`);
            },
        },
        selection: {
            closeSubject: (options) => {
                calls.push(`closeSubject:${options?.source ?? "map"}`);
                return true;
            },
        },
        fly: (ref, target) => flown.push({ ref, target }),
        copy: async (text) => {
            calls.push(`copy:${await text}`);
            return copied;
        },
        notify: (text, tone, link) => toasts.push({ text, tone, link }),
        revealPlanner: () => calls.push("revealPlanner"),
        startSet: () => calls.push("startSet"),
        openCatalog: (target) => calls.push(`openCatalog:${target.section}:${target.name}:${target.focus ?? "-"}`),
        openSuggest: (ziel) =>
            calls.push(`openSuggest:${ziel.objektArt}:${ziel.objektId}:${ziel.name}:${ziel.typ ?? "-"}`),
        openSuggestMap: (ziel) => calls.push(`openSuggestMap:${ziel.ref.kind}:${ziel.name}:${String(ziel.hatKarten)}`),
        openReview: (ziel) => calls.push(`openReview:${ziel.ortId}:${ziel.ortName}:${String(ziel.sterne ?? "-")}`),
        openReviewReport: (ziel) => calls.push(`openReviewReport:${ziel.ortId}:${ziel.bewertung.id}`),
    };
    return { deps, calls, toasts, waypoints, flown };
}

describe("Änderungen vorschlagen (WI-0268 C2)", () => {
    it("🔴 öffnet das Meldeformular über die Naht der Seite - mit Objektart, Kennung, Name und Art; nichts sonst", () => {
        const { deps, calls, toasts, waypoints } = setup();
        createPanelActions(deps).run(
            {
                type: "suggest",
                objektArt: "place",
                objektId: "00000000-0000-4000-8000-000000000001",
                name: "Gareth",
                typ: "metropole",
                lage: { x: 551.625, y: 532.969 },
            },
            shown(gareth),
        );
        expect(calls).toEqual(["openSuggest:place:00000000-0000-4000-8000-000000000001:Gareth:metropole"]);
        // Weder Planer noch Zwischenablage noch Meldung: Die Kachel öffnet nur das Formular.
        expect(waypoints).toHaveLength(1);
        expect(toasts).toEqual([]);
    });

    it("die Lage geht nur mit, wo die Antwort sie nannte", () => {
        const ziele: unknown[] = [];
        const { deps } = setup();
        createPanelActions({ ...deps, openSuggest: (ziel) => ziele.push(ziel) }).run(
            { type: "suggest", objektArt: "powerline", objektId: "00000000-0000-4000-8000-000000000009", name: "Ley" },
            shown(gareth),
        );
        expect(ziele).toEqual([
            { objektArt: "powerline", objektId: "00000000-0000-4000-8000-000000000009", name: "Ley" },
        ]);
    });
});

describe("Bewertung schreiben, teilen und melden (WI-0269 C10)", () => {
    const ORT = "00000000-0000-4000-8000-000000000001";
    const BEWERTUNG = "00000000-0000-4000-8000-0000000000b1";

    it("🔴 „Bewertung schreiben“ öffnet das Formular über die Naht der Seite - mit Ort und Name; nichts sonst", () => {
        const { deps, calls, toasts, waypoints } = setup();
        createPanelActions(deps).run({ type: "review", ortId: ORT, ortName: "Gareth" }, shown(gareth));
        expect(calls).toEqual([`openReview:${ORT}:Gareth:-`]);
        expect(waypoints).toHaveLength(1);
        expect(toasts).toEqual([]);
    });

    it("eine vorgewählte Wertung geht mit", () => {
        const { deps, calls } = setup();
        createPanelActions(deps).run({ type: "review", ortId: ORT, ortName: "Gareth", sterne: 4 }, shown(gareth));
        expect(calls).toEqual([`openReview:${ORT}:Gareth:4`]);
    });

    it("⚑ öffnet das Meldefenster zu genau dieser Bewertung", () => {
        const { deps, calls } = setup();
        createPanelActions(deps).run(
            {
                type: "reviewReport",
                ortId: ORT,
                ortName: "Gareth",
                bewertung: { id: BEWERTUNG, stars: 1, head: "Troll schreibt:" },
            },
            shown(gareth),
        );
        expect(calls).toEqual([`openReviewReport:${ORT}:${BEWERTUNG}`]);
    });

    it("🔴 „Teilen“ kopiert den Link und sagt „Link zur Bewertung kopiert.“; ohne Zwischenablage die Warnung", async () => {
        const url = `https://avesmaps.test/?place=${ORT}&bewertung=${BEWERTUNG}`;
        const gut = setup(true);
        createPanelActions(gut.deps).run({ type: "share", url, what: "review" }, shown(gareth));
        await Promise.resolve();
        await Promise.resolve();
        expect(gut.calls).toEqual([`copy:${url}`]);
        expect(gut.toasts).toEqual([{ text: "Link zur Bewertung kopiert.", tone: "success", link: url }]);
        const schlecht = setup(false);
        createPanelActions(schlecht.deps).run({ type: "share", url, what: "review" }, shown(gareth));
        await Promise.resolve();
        await Promise.resolve();
        expect(schlecht.toasts[0]?.tone).toBe("warning");
    });

    it("am Telefon öffnet „Teilen“ das Teilen-Menü des Geräts und kopiert dann nichts; abgebrochen oder ohne Menü kopiert es", async () => {
        const url = `https://avesmaps.test/?place=${ORT}&bewertung=${BEWERTUNG}`;
        const geteilt: string[] = [];
        const mit = setup(true);
        createPanelActions({
            ...mit.deps,
            shareNative: (adresse, titel) => {
                geteilt.push(`${adresse}|${titel}`);
                return Promise.resolve(true);
            },
        }).run({ type: "share", url, what: "review" }, shown(gareth));
        await Promise.resolve();
        await Promise.resolve();
        expect(geteilt).toHaveLength(1);
        expect(geteilt[0]).toContain(url);
        expect(mit.calls).toEqual([]);
        // Das Gerät hat kein Menü: der Link wird kopiert.
        const ohne = setup(true);
        createPanelActions({ ...ohne.deps, shareNative: () => Promise.resolve(false) }).run(
            { type: "share", url, what: "review" },
            shown(gareth),
        );
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(ohne.calls).toEqual([`copy:${url}`]);
        // Ein Ort oder Kartenpunkt teilt weiter über die Zwischenablage, nie über das Menü.
        const ort = setup(true);
        let menue = 0;
        createPanelActions({
            ...ort.deps,
            shareNative: () => {
                menue += 1;
                return Promise.resolve(true);
            },
        }).run({ type: "share", url, what: "place" }, shown(gareth));
        await Promise.resolve();
        expect(menue).toBe(0);
        expect(ort.calls).toEqual([`copy:${url}`]);
    });
});

describe("Reiseziel", () => {
    it("ein Ort wird Wegpunkt über die Planer-Naht, der Planer geht auf; kein Hinweis „Startpunkt“ (der gilt dem Kartenpunkt)", () => {
        const { deps, calls } = setup();
        createPanelActions(deps).run({ type: "addPlace", hit: HIT }, shown(gareth));
        expect(calls).toEqual([`addPlace:${GARETH_ID}`, "revealPlanner"]);
    });

    it("ein Kartenpunkt: Der Erste ist der Start, und ein Hinweis sagt, dass ein Ziel fehlt", () => {
        const { deps, calls } = setup();
        createPanelActions(deps).run({ type: "addMapPoint", x: 1, y: 2 }, shown(gareth));
        expect(calls).toEqual(["addMapPoint:1,2", "startSet", "revealPlanner"]);
    });

    it("entfernen geht über die Zeile des Wegpunkts; ein unbekannter Ort tut nichts", () => {
        const { deps, calls } = setup();
        const actions = createPanelActions(deps);
        actions.run({ type: "removeDestination", id: GARETH_ID }, shown(gareth));
        actions.run({ type: "removeDestination", id: "unbekannt" }, shown(gareth));
        expect(calls).toEqual(["removeWaypoint:7"]);
    });

    it("🔴 „ist Reiseziel“ liest den Stand der Reise: Die Kachel wird zu „entfernen“", () => {
        const { deps, waypoints } = setup();
        const actions = createPanelActions(deps);
        expect(actions.isDestination(GARETH_ID)).toBe(true);
        waypoints.splice(0, waypoints.length);
        expect(actions.isDestination(GARETH_ID)).toBe(false);
    });
});

describe("Link teilen", () => {
    it("die Zwischenablage bekommt die Adresse, die Meldung trägt sie greifbar", async () => {
        const { deps, calls, toasts } = setup();
        createPanelActions(deps).run(
            { type: "share", url: "https://avesmaps.test/?siedlung=Gareth", what: "place" },
            shown(gareth),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(calls).toEqual(["copy:https://avesmaps.test/?siedlung=Gareth"]);
        expect(toasts).toEqual([
            {
                text: "Link zu dieser Stelle in die Zwischenablage kopiert.",
                tone: "success",
                link: "https://avesmaps.test/?siedlung=Gareth",
            },
        ]);
    });

    it("eine Kartenstelle meldet ihren eigenen Satz; scheitert das Kopieren, steht der Link trotzdem in der Meldung", async () => {
        const ok = setup();
        createPanelActions(ok.deps).run(
            { type: "share", url: "https://avesmaps.test/?pin=1.000,2.000", what: "pin" },
            shown(gareth),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(ok.toasts[0]?.text).toBe("Link zur markierten Stelle in die Zwischenablage kopiert.");

        const failed = setup(false);
        createPanelActions(failed.deps).run(
            { type: "share", url: "https://avesmaps.test/?place=x", what: "place" },
            shown(gareth),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(failed.toasts).toEqual([
            {
                text: "Link konnte nicht automatisch kopiert werden.",
                tone: "warning",
                link: "https://avesmaps.test/?place=x",
            },
        ]);
    });
});

describe("Anzeigen und Entfernen", () => {
    it("Anzeigen fliegt zum Ziel der Antwort - die ganze Gruppe, nie ein Sprung", () => {
        const { deps, flown } = setup();
        const detail: SubjectDetail = { ...gareth, target: { x: 1, y: 2, zoom: 4, bounds: [0, 0, 5, 5] } };
        createPanelActions(deps).run({ type: "show" }, shown(detail));
        expect(flown).toEqual([{ ref: detail.subject, target: { x: 1, y: 2, zoom: 4, bounds: [0, 0, 5, 5] } }]);
    });

    it("Entfernen am Kartenpunkt beendet die Auswahl, ohne dass eine Fixierung es verhindert", () => {
        const { deps, calls } = setup();
        createPanelActions(deps).run({ type: "closePoint" }, shown(gareth));
        expect(calls).toEqual(["closeSubject:context"]);
    });
});

describe("Weg als Route und die Pfeile der Etappe (P7)", () => {
    it("🔴 „Weg als Route“ ERSETZT die Wegpunkte über die Planer-Naht, in der Reihenfolge der Straße; der Planer geht auf", () => {
        const { deps, calls } = setup();
        const tile = actionsOf(reichsstrasseMitRoute)[3];
        expect(tile?.run?.type).toBe("pathAsRoute");
        createPanelActions(deps).run(tile?.run as ActionRun, shown(reichsstrasseMitRoute));
        expect(calls).toEqual(["replaceWaypoints:Elenvina>Kyndoch>Gratenfels", "revealPlanner"]);
    });

    it("die Pfeile wählen die Etappe im Planer (gold, die Kamera fliegt dort hin); das Panel folgt aus der Wahl, nicht aus dem Pfeil", () => {
        const { deps, calls, flown } = setup();
        const actions = createPanelActions(deps);
        actions.run({ type: "stageStep", step: 1 }, shown(gareth));
        actions.run({ type: "stageStep", step: -1 }, shown(gareth));
        expect(calls).toEqual(["stepStage:1", "stepStage:-1"]);
        // Keine eigene Kamera daneben: Der Planer fliegt über `effects.fitRoute`.
        expect(flown).toEqual([]);
    });
});

function actionsOf(detail: SubjectDetail): PanelAction[] {
    const model = panelModelOf(shown(detail), null, env());
    if (model === undefined) throw new Error("kein Modell");
    return model.actions;
}

describe("Kartensammlung und Literatur anzeigen (WI-0118)", () => {
    const model = (section: "citymaps" | "literature"): CatalogModel => ({
        section,
        ref: gareth.subject,
        name: "Gareth",
        heading: section === "citymaps" ? "Kartensammlung von Gareth" : "Literatur zu Gareth",
        count: 12,
    });

    it("🔴 die Kachel öffnet das Fenster ihres Abschnitts über die Naht der Seite, ohne einen Eintrag aufzuklappen", () => {
        const { deps, calls } = setup();
        const [tile] = catalogActions(model("citymaps"));
        expect(tile).toMatchObject({ id: "citymapsAll", label: "Kartensammlung anzeigen", tone: "soft" });
        createPanelActions(deps).run(tile?.run as ActionRun, shown(gareth));
        expect(calls).toEqual(["openCatalog:citymaps:Gareth:-"]);
        const [literature] = catalogActions(model("literature"));
        expect(literature).toMatchObject({ id: "literatureAll", label: "Literatur anzeigen" });
        createPanelActions(deps).run(literature?.run as ActionRun, shown(gareth));
        expect(calls).toEqual(["openCatalog:citymaps:Gareth:-", "openCatalog:literature:Gareth:-"]);
    });

    it("🔴 „Karte vorschlagen“ ist seit WI-0275 offen: Die Kachel öffnet über die Naht das Fenster der Besucher, mit der Auskunft, ob die Sammlung schon Karten trägt", () => {
        const actions = catalogActions(model("citymaps"));
        expect(actions.map((action) => action.id)).toEqual(["citymapsAll", "citymapsSuggest"]);
        const suggest = actions[1];
        expect(suggest?.label).toBe("Karte vorschlagen");
        expect(suggest?.icon).toEqual({ image: "feder" });
        expect(suggest?.run).toEqual({ type: "suggestMap", ref: gareth.subject, name: "Gareth", hatKarten: true });
        expect(hasLockedAction(actions)).toBe(false);
        const { deps, calls } = setup();
        createPanelActions(deps).run(suggest?.run as ActionRun, shown(gareth));
        expect(calls).toEqual(["openSuggestMap:place:Gareth:true"]);
        expect(hasLockedAction(catalogActions(model("literature")))).toBe(false);
    });

    it("🔴 ein Ort ohne Karte trägt nur die Einladung: „Karte vorschlagen“ allein, ohne „Kartensammlung anzeigen“, mit hatKarten falsch", () => {
        const actions = catalogActions({ ...model("citymaps"), leer: true });
        expect(actions.map((action) => action.id)).toEqual(["citymapsSuggest"]);
        expect(actions[0]?.run).toMatchObject({ type: "suggestMap", hatKarten: false });
    });

    it("die Bewertungen haben keine Kacheln unter ihrer Liste (der Bewertungsweg gehört einem eigenen Paket)", () => {
        expect(catalogActions({ ...model("citymaps"), section: "reviews" })).toEqual([]);
    });

    it("ein Klick auf eine Kachel im Streifen öffnet dasselbe Fenster und nennt den Eintrag", () => {
        const { deps, calls } = setup();
        createPanelActions(deps).run(
            { type: "openCatalog", section: "literature", ref: gareth.subject, name: "Gareth", focus: "abc" },
            shown(gareth),
        );
        expect(calls).toEqual(["openCatalog:literature:Gareth:abc"]);
    });

    it("die Symbole der drei Kacheln liegen im Haus", () => {
        const names = [...catalogActions(model("citymaps")), ...catalogActions(model("literature"))].map((action) =>
            "image" in action.icon ? action.icon.image : "",
        );
        expect(names).toEqual(["kartensammlung", "feder", "literatur"]);
    });
});
