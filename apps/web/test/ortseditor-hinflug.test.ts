import type { Map as MapLibreMap } from "maplibre-gl";
import { shallowRef, ref, type ShallowRef } from "vue";
import { describe, expect, it } from "vitest";
import type { EditorPlaceList, SubjectRef } from "@avesmaps3d/shared";
import { shiftCenter } from "../src/map/camera/camera-math.ts";
import { CAMERA_DURATION, createCamera } from "../src/map/camera/camera.ts";
import { NO_INSETS, type Insets } from "../src/map/camera/visible-area.ts";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster.ts";
import { freiNachLandung, type Bildschirm } from "../src/editor-panel/hinflug.ts";
import { createOrtseditorSteuerung, type OrtseditorHinflug } from "../src/ortseditor/ortseditor-steuerung.ts";
import type { Ziellage } from "../src/editor-panel/hinflug.ts";
import type { SubjectSelection } from "../src/info-panel/subject-selection.ts";

/**
 * Hinflug und Auswahl (WI-0128 E7, EDIT-0001 §4.5, T7.1 bis T7.10): Die Kamera zielt in die freie Fläche NACH der Landung und meldet,
 * wie ihr Flug endet; die Steuerung öffnet erst danach und nur für die jüngste Wahl. Wie es im Browser aussieht, zeigt
 * `e2e/ortseditor.spec.ts`.
 */

interface View {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
}

/** Eine Karte wie in `camera-intent.test.ts`, dazu eine flache Projektion (100 px je Grad um die Mitte) und eine Uhr. */
function fakeMap(start: Partial<View> & { reducedMotion?: boolean } = {}) {
    const view: View = { center: [0, 0], zoom: 5, bearing: 0, pitch: 0, ...start };
    const moves: (View & { duration: number })[] = [];
    const listeners = new Map<string, Set<() => void>>();
    let running: View | undefined;
    const clock = { now: 0 };
    const fire = (event: string) => listeners.get(event)?.forEach((listener) => listener());
    const stop = () => {
        if (!running) return;
        running = undefined;
        fire("moveend");
    };
    const move = (options: View & { duration: number }) => {
        stop();
        moves.push(options);
        const target = { center: options.center, zoom: options.zoom, bearing: options.bearing, pitch: options.pitch };
        if (start.reducedMotion) {
            Object.assign(view, target);
            fire("moveend");
        } else {
            running = target;
        }
    };
    const map = {
        // MapLibres Painter: daran klemmt `installHorizonQueryFix` den Maßstabsfaktor der Trefferabfrage.
        painter: { transform: { maxPitchScaleFactor: () => 1 } },
        getCenter: () => ({ lng: view.center[0], lat: view.center[1] }),
        getZoom: () => view.zoom,
        getBearing: () => view.bearing,
        getPitch: () => view.pitch,
        getMinZoom: () => 0,
        getMaxZoom: () => 8,
        getVerticalFieldOfView: () => 36.87,
        getCanvas: () => ({ clientWidth: 1280, clientHeight: 720 }),
        isMoving: () => running !== undefined,
        project: (point: [number, number]) => ({
            x: 640 + (point[0] - view.center[0]) * 100,
            y: 360 - (point[1] - view.center[1]) * 100,
        }),
        on: (event: string, listener: () => void) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)?.add(listener);
        },
        off: (event: string, listener: () => void) => listeners.get(event)?.delete(listener),
        cameraForBounds: (_bounds: unknown, options: { padding: Insets; bearing: number }) => {
            fits.push(options);
            return { center: { lng: 1, lat: 2 }, zoom: 3, bearing: options.bearing };
        },
        flyTo: move,
        easeTo: move,
        jumpTo: () => stop(),
    };
    const fits: { padding: Insets; bearing: number }[] = [];
    /** Die Fahrt kommt nach ihrer ganzen Dauer an. */
    const finish = () => {
        if (!running) return;
        clock.now += moves.at(-1)?.duration ?? 0;
        Object.assign(view, running);
        running = undefined;
        fire("moveend");
    };
    return { map: map as unknown as MapLibreMap, view, moves, fits, finish, stop, clock };
}

const GARETH: [number, number] = [10, 20];

describe("Punkt zeigen in die freie Fläche nach der Landung (E7)", () => {
    it("🔴 T7.2: fliegt (Dauer > 0, kein Sprung), der Ort landet in der Mitte der Fläche links vom Fenster", () => {
        const { map, moves } = fakeMap({ zoom: 3 });
        void createCamera(map).showPoint(GARETH, 5, { free: { right: 960 } });
        expect(moves).toHaveLength(1);
        expect(moves[0]?.duration).toBe(CAMERA_DURATION.point);
        // Frei sind 320 px links: Der Ort soll bei x = 160 stehen, die Mitte der Karte bei 640, also 480 px rechts von ihm.
        expect(moves[0]?.center).toEqual(shiftCenter(GARETH, 480, 0, 5, 0));
        expect(moves[0]).toMatchObject({ zoom: 5, bearing: 0, pitch: 0 });
    });

    it("gedreht rechnet der Versatz mit der Drehung; die Panels zählen je Seite mit dem Größeren", () => {
        const { map, moves } = fakeMap({ zoom: 6, bearing: 90 });
        const area = {
            sync: () => NO_INSETS,
            insets: () => NO_INSETS,
            keepFree: () => ({ ...NO_INSETS, right: 380, top: 40 }),
        };
        void createCamera(map, area).showPoint(GARETH, 5, { free: { right: 960 } });
        // Frei: rechts 960 (größer als das Panel), oben 40. Mitte der Fläche (160, 380), Mitte der Karte (640, 360).
        expect(moves[0]?.center).toEqual(shiftCenter(GARETH, 480, -20, 6, 90));
    });

    it("🔴 T7.3: liegt der Ort schon mit Rand in der freien Fläche, fliegt nichts", async () => {
        const { map, moves } = fakeMap({ zoom: 6, center: GARETH });
        // Der Ort steht 4,8 Grad links der Mitte, bei x = 160: mitten in den 320 px, die neben dem Fenster frei bleiben.
        const links: [number, number] = [GARETH[0] - 4.8, GARETH[1]];
        await expect(createCamera(map).showPoint(links, 5, { free: { right: 960 }, onlyIfHidden: true })).resolves.toBe(
            true,
        );
        expect(moves).toEqual([]);
        // Unter dem künftigen Fenster: Er fliegt.
        void createCamera(map).showPoint(GARETH, 5, { free: { right: 960 }, onlyIfHidden: true });
        expect(moves).toHaveLength(1);
    });

    it("sichtbar, aber noch nicht nah genug: Er fliegt heran", () => {
        const { map, moves } = fakeMap({ zoom: 3, center: GARETH });
        const links: [number, number] = [GARETH[0] - 4.8, GARETH[1]];
        void createCamera(map).showPoint(links, 5, { free: { right: 960 }, onlyIfHidden: true });
        expect(moves[0]?.zoom).toBe(5);
    });

    it("bleibt kaum etwas frei (höchstens zweimal der Rand des Einpassens), zielt die Kamera wie ohne Angabe", () => {
        const { map, moves } = fakeMap({ zoom: 3 });
        void createCamera(map).showPoint(GARETH, 5, { free: { right: 1280 } });
        void createCamera(map).showPoint(GARETH, 5, { free: { left: 350, right: 850 } });
        expect(moves.map((move) => move.center)).toEqual([GARETH, GARETH]);
    });

    it("🔴 WI-0218: ein Klick öffnet ein Fenster (`onlyIfCovered`): frei bleibt stehen, auch knapp am Fenster; verdeckt kommt in die Mitte", async () => {
        const { map, moves } = fakeMap({ zoom: 6, center: GARETH });
        // 10 px links des Fensters (x = 310): frei, aber im Rand des Einpassens - `onlyIfHidden` flöge, `onlyIfCovered` nicht.
        const knapp: [number, number] = [GARETH[0] - 3.3, GARETH[1]];
        await expect(
            createCamera(map).showPoint(knapp, 6, { free: { right: 960 }, onlyIfCovered: true }),
        ).resolves.toBe(true);
        expect(moves).toEqual([]);
        // Unter dem Fenster (x = 640): in die Mitte der 320 freien Pixel, Zoom, Drehung und Neigung bleiben.
        void createCamera(map).showPoint(GARETH, 6, { free: { right: 960 }, onlyIfCovered: true });
        expect(moves).toHaveLength(1);
        expect(moves[0]?.center).toEqual(shiftCenter(GARETH, 480, 0, 6, 0));
        expect(moves[0]).toMatchObject({ zoom: 6, bearing: 0, pitch: 0 });
    });

    it("bleibt neben Planer und Fenster keine Lücke (1280 px), holt `onlyIfCovered` nichts", async () => {
        const { map, moves } = fakeMap({ zoom: 6, center: GARETH });
        await expect(
            createCamera(map).showPoint(GARETH, 6, { free: { left: 350, right: 960 }, onlyIfCovered: true }),
        ).resolves.toBe(true);
        expect(moves).toEqual([]);
    });

    it("🔴 WI-0218: ein Ausschnitt ohne Lücke neben dem Fenster passt ein wie ohne Angabe, statt nicht zu fliegen", () => {
        const { map, moves, fits } = fakeMap({ zoom: 6 });
        const camera = createCamera(map, { sync: () => NO_INSETS, insets: () => NO_INSETS, keepFree: () => NO_INSETS });
        void camera.showBounds(
            [
                [0, 0],
                [1, 1],
            ],
            { free: { left: 350, right: 960 } },
        );
        // Die ganze Karte, 1280 × 720: Rand 7 %, also 90 bzw. 50 px.
        expect(fits[0]?.padding).toEqual({ top: 50, right: 90, bottom: 50, left: 90 });
        expect(moves).toHaveLength(1);
    });

    it("🔴 T7.4: meldet die Ankunft; eine Geste oder ein jüngerer Flug beenden ihn ohne Ankunft", async () => {
        const first = fakeMap({ zoom: 3 });
        const camera = createCamera(first.map, undefined, () => first.clock.now);
        const arrival = camera.showPoint(GARETH, 5, { free: { right: 960 } });
        first.finish();
        await expect(arrival).resolves.toBe(true);

        const gesture = camera.showPoint([0, 0], 5, { free: { right: 960 } });
        first.stop();
        await expect(gesture).resolves.toBe(false);

        const older = camera.showPoint(GARETH, 5, { free: { right: 960 } });
        const younger = camera.showPoint([1, 1], 5, { free: { right: 960 } });
        await expect(older).resolves.toBe(false);
        first.finish();
        await expect(younger).resolves.toBe(true);
    });

    it("🔴 T7.8: bei „Bewegung reduzieren“ springt sie, samt Versatz, und meldet gleich die Ankunft", async () => {
        const { map, view } = fakeMap({ zoom: 3, reducedMotion: true });
        await expect(createCamera(map).showPoint(GARETH, 5, { free: { right: 960 } })).resolves.toBe(true);
        expect(view.center).toEqual(shiftCenter(GARETH, 480, 0, 5, 0));
    });

    it("ohne Angabe bleibt alles wie bisher: in die Mitte der Karte", () => {
        const { map, moves } = fakeMap({ zoom: 3 });
        void createCamera(map).showPoint(GARETH, 5);
        expect(moves[0]?.center).toEqual(GARETH);
    });

    it("🔴 T7.10: ein Ausschnitt passt in die freie Fläche nach der Landung (Testtafel)", async () => {
        const { map, fits, finish, clock } = fakeMap({ zoom: 6 });
        const camera = createCamera(
            map,
            { sync: () => NO_INSETS, insets: () => NO_INSETS, keepFree: () => NO_INSETS },
            () => clock.now,
        );
        const done = camera.showBounds(
            [
                [0, 0],
                [1, 1],
            ],
            { free: { right: 960 } },
        );
        // Frei sind 320 × 720 px: Rand 40 bzw. 50 px, rechts dazu die 960 px des Fensters.
        expect(fits[0]?.padding).toEqual({ top: 50, right: 1000, bottom: 50, left: 40 });
        finish();
        await expect(done).resolves.toBe(true);
    });
});

describe("Die freie Fläche je Lage nach der Landung (T7.9)", () => {
    const schirm: Bildschirm = {
        karte: { left: 0, top: 50, width: 1920, height: 1000 },
        rechteKante: 1920,
        angedockt: 960,
        bedeckt: { ...NO_INSETS, right: 380 },
    };

    it("angedockt: rechts die Breite des Fensters", () => {
        expect(freiNachLandung({ lage: "angedockt" }, schirm)).toEqual({ ...NO_INSETS, right: 960 });
        // Die Karte endet vor dem Rahmen: Gedeckt ist nur, was über ihr liegt.
        expect(freiNachLandung({ lage: "angedockt" }, { ...schirm, karte: { ...schirm.karte, width: 1800 } })).toEqual({
            ...NO_INSETS,
            right: 840,
        });
    });

    it("gelöst: die größere Seite neben dem Fenster, ohne das Panel", () => {
        // Rechts vom Fenster bleiben 1920 - 380 - 1300 = 240 px, links 700: Ziel ist links.
        const rechts = { lage: "geloest" as const, box: { left: 700, top: 100, width: 600, height: 400 } };
        expect(freiNachLandung(rechts, schirm)).toEqual({ ...NO_INSETS, right: 1220 });
        // Links 100, rechts 1920 - 380 - 700 = 840: Ziel ist rechts, das Panel deckt die Karte dort weiter.
        const links = { lage: "geloest" as const, box: { left: 100, top: 100, width: 600, height: 400 } };
        expect(freiNachLandung(links, schirm)).toEqual({ ...NO_INSETS, left: 700, right: 380 });
    });

    it("versenkt oder gelöst an unbekannter Stelle: nur die Panels", () => {
        expect(freiNachLandung({ lage: "versenkt" }, schirm)).toEqual(schirm.bedeckt);
        expect(freiNachLandung({ lage: "geloest" }, schirm)).toEqual(schirm.bedeckt);
    });
});

describe("Die Steuerung: Klick wählt, Doppelklick fliegt, das Verb öffnet nach dem Flug (E7, D19)", () => {
    const LISTE: EditorPlaceList = {
        wikiListe: true,
        rows: [
            { key: "gareth", origin: "karte", name: "Gareth", circle: "voll", assignment: "assigned", x: 10, y: 20 },
            { key: "ferdok", origin: "karte", name: "Ferdok", circle: "halb", assignment: "none", x: 30, y: 40 },
            { key: "staette:dachs", origin: "wiki", name: "Dachs", circle: "leer", assignment: "none" },
        ],
    };

    function aufbau() {
        const selected = shallowRef<SubjectRef | undefined>(undefined);
        const slot = ref<"info" | "editor" | "closed">("editor");
        const geoeffnet: SubjectRef[] = [];
        let umgeschaltet = 0;
        const selection = {
            selected,
            slot,
            openSubject: (subject: SubjectRef) => {
                geoeffnet.push(subject);
                selected.value = subject;
                return true;
            },
            togglePanel: () => {
                umgeschaltet += 1;
                slot.value = "info";
            },
        } as unknown as SubjectSelection;
        const fenster = createWerkzeugfenster(undefined);
        const fluege: {
            ort: unknown;
            ziel: Ziellage;
            optionen: Parameters<OrtseditorHinflug["zeige"]>[2];
            ende: (angekommen: boolean) => void;
        }[] = [];
        const hinflug: OrtseditorHinflug = {
            zeige: (ort, ziel, optionen) =>
                new Promise<boolean>((resolve) => {
                    fluege.push({ ort, ziel, optionen, ende: resolve });
                }),
        };
        const steuerung = createOrtseditorSteuerung(selection, fenster, false, hinflug);
        (steuerung.liste as ShallowRef<EditorPlaceList | undefined>).value = LISTE;
        const offen = () =>
            fenster.stand.value.fenster
                .filter((x) => x.lage !== "versenkt")
                .map((x) => x.gegenstand)
                .sort();
        return { steuerung, fenster, fluege, geoeffnet, offen, selection, umgeschaltet: () => umgeschaltet };
    }
    const warte = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("🔴 „Bearbeiten“ aus einem Menü bringt den Ort in die Ortsliste: Suche = Name, verbergende Maske und Filter fallen (Betreiber 2026-10-12)", () => {
        // Betreiber: „orte kommen in der liste nicht automatisch, wenn man auf bearbeiten klickt. man könnte "bearbeiten" und dann filtern“.
        const { steuerung } = aufbau();
        const einstellung = steuerung.listenEinstellung;
        einstellung.suche.value = "Fer";
        einstellung.maske.value = "bauwerke";
        steuerung.oeffneFuer("gareth");
        expect(einstellung.suche.value).toBe("Gareth");
        expect(einstellung.maske.value).toBe("alle");
        expect(steuerung.auswahl.value).toBe("gareth");
        // Eine Stätte innerorts verbirgt die Vorbelegung der Lage („außerorts + unklar“): Der Filter der Lage fällt, die anderen bleiben.
        (steuerung.liste as ShallowRef<EditorPlaceList | undefined>).value = {
            ...LISTE,
            rows: LISTE.rows.map((row) => (row.key === "staette:dachs" ? { ...row, within: "Gareth" } : row)),
        };
        einstellung.filter.value = new Map([
            ["lage", new Set(["ausserorts"])],
            ["karte", new Set(["nicht"])],
        ]);
        steuerung.oeffneFuer("staette:dachs");
        expect(einstellung.suche.value).toBe("Dachs");
        expect([...einstellung.filter.value.keys()]).toEqual(["karte"]);
    });

    it("🔴 „Bearbeiten“, bevor die Ortsliste da ist: Die Suche folgt, sobald sie geladen ist", () => {
        const { steuerung } = aufbau();
        const liste = steuerung.liste as ShallowRef<EditorPlaceList | undefined>;
        const geladen = liste.value;
        liste.value = undefined;
        steuerung.oeffneFuer("ferdok");
        expect(steuerung.listenEinstellung.suche.value).toBe("");
        liste.value = geladen;
        return warte().then(() => expect(steuerung.listenEinstellung.suche.value).toBe("Ferdok"));
    });

    it("🔴 T7.1: der Einfachklick wählt und öffnet, ohne Flug", () => {
        const { steuerung, fenster, fluege, geoeffnet, offen } = aufbau();
        const id = fenster.oeffne({ werkzeug: "ortseditor", gegenstand: undefined, titel: "", nurLesen: false });
        steuerung.oeffneOrt(id, "gareth");
        expect(fluege).toEqual([]);
        expect(offen()).toEqual(["gareth"]);
        expect(geoeffnet).toEqual([{ kind: "place", id: "gareth" }]);
    });

    it("🔴 Doppelklick aus dem Ortseditor: Flug, die Auswahl wechselt, das Fenster bleibt (Nr. 4)", () => {
        const { steuerung, fenster, fluege, offen } = aufbau();
        const id = fenster.oeffne({ werkzeug: "ortseditor", gegenstand: undefined, titel: "", nurLesen: false });
        fenster.setzeLage(id, "geloest", { left: 100, top: 100, width: 600, height: 400 });
        steuerung.fliegeOrt(id, "gareth");
        expect(offen()).toEqual(["gareth"]);
        expect(fluege).toHaveLength(1);
        expect(fluege[0]?.ziel).toMatchObject({ lage: "geloest", box: { left: 100 }, id });
        expect(steuerung.auswahl.value).toBe("gareth");
        // EDIT-0003 T32 (1): Der Doppelklick stellt die Karte dazu auf die Ansicht der Orte.
        expect(fluege[0]?.optionen).toEqual({ ansicht: { view: "standard" } });
    });

    it("🔴 T7.7: ein Ort ohne Lage fliegt nicht; die Statuszeile sagt es", () => {
        const { steuerung, fenster, fluege } = aufbau();
        const id = fenster.oeffne({ werkzeug: "ortseditor", gegenstand: undefined, titel: "", nurLesen: false });
        steuerung.fliegeOrt(id, "staette:dachs");
        expect(fluege).toEqual([]);
        expect(steuerung.hinweis.value?.text).toContain("Dachs");
        steuerung.oeffneOrt(steuerung.hinweis.value!.fenster, "gareth");
        expect(steuerung.hinweis.value).toBeUndefined();
    });

    it("🔴 T7.2, T7.4: das Verb fliegt zuerst und öffnet erst am Ende dieses Flugs, auch nach einer Geste", async () => {
        const { steuerung, fluege, offen } = aufbau();
        steuerung.setzeAuswahl("gareth");
        steuerung.oeffneWerkzeug();
        // Noch kein Fenster: Ziel ist die Lage, die ein neues Fenster bekäme (angedockt).
        expect(offen()).toEqual([]);
        expect(fluege[0]?.ziel).toMatchObject({ lage: "angedockt" });
        // Auch das Verb fliegt in die Ansicht der Orte (EDIT-0003 T32 (1)).
        expect(fluege[0]?.optionen).toEqual({ ansicht: { view: "standard" } });
        fluege[0]?.ende(false);
        await warte();
        expect(offen()).toEqual(["gareth"]);
    });

    it("🔴 T7.4: eine jüngere Wahl ersetzt die ältere, nur die letzte öffnet", async () => {
        const { steuerung, fluege, offen } = aufbau();
        steuerung.setzeAuswahl("gareth");
        steuerung.oeffneWerkzeug();
        steuerung.setzeAuswahl("ferdok");
        steuerung.oeffneWerkzeug();
        fluege[0]?.ende(false);
        fluege[1]?.ende(true);
        await warte();
        expect(offen()).toEqual(["ferdok"]);
    });

    it("das Verb öffnet an der Stelle des vordersten Ortseditors, das Bisherige wird abgelegt (D19)", async () => {
        const { steuerung, fenster, fluege, offen } = aufbau();
        const id = fenster.oeffne({ werkzeug: "ortseditor", gegenstand: "gareth", titel: "", nurLesen: false });
        steuerung.setzeAuswahl("ferdok");
        steuerung.oeffneWerkzeug();
        expect(fluege[0]?.ziel).toMatchObject({ lage: "angedockt", id });
        fluege[0]?.ende(true);
        await warte();
        expect(offen()).toEqual(["ferdok"]);
        expect(fenster.abgelegt.value.map((x) => x.gegenstand)).toEqual(["gareth"]);
    });

    it("🔴 ein Ort der Karte öffnet sich im vordersten Ortseditor wie ein Klick in seiner Liste; das Bisherige wird abgelegt", () => {
        const { steuerung, fenster, offen, fluege } = aufbau();
        fenster.oeffne({ werkzeug: "ortseditor", gegenstand: "gareth", titel: "", nurLesen: false });
        steuerung.geoeffnet({ kind: "place", id: "ferdok" }, { source: "map", camera: "none" });
        expect(offen()).toEqual(["ferdok"]);
        expect(fenster.abgelegt.value.map((x) => x.gegenstand)).toEqual(["gareth"]);
        expect(fluege).toEqual([]);
        // Die eigene Wahl aus der Liste (still) und ein Ort aus der Suche öffnen nichts neu.
        steuerung.geoeffnet({ kind: "place", id: "gareth" }, { source: "map", camera: "none", still: true });
        steuerung.geoeffnet({ kind: "place", id: "gareth" }, { source: "search", camera: "none" });
        expect(offen()).toEqual(["ferdok"]);
    });

    it("🔴 T34 (1): ohne sichtbaren Ortseditor öffnet ein Ort der Karte im Editor-Modus mit der Lasche „Editor“ vorn ein Fenster an ihm, sonst nicht", () => {
        // Betreiber 2026-10-16: „Bei Orten kommt er schon automatisch“ (WI-0198). Während eines Modus reicht `app.vue` `false` herein.
        const { steuerung, offen } = aufbau();
        expect(steuerung.geoeffnet({ kind: "place", id: "ferdok" }, { source: "map", camera: "none" }, false)).toBe(
            false,
        );
        expect(offen()).toEqual([]);
        expect(steuerung.geoeffnet({ kind: "place", id: "ferdok" }, { source: "map", camera: "none" }, true)).toBe(
            true,
        );
        expect(offen()).toEqual(["ferdok"]);
        // Hat jemand „Info“ vorn, bleibt das Infopanel; aus der Suche bleibt es ohnehin beim Alten.
        const zweiter = aufbau();
        zweiter.selection.slot.value = "info";
        expect(
            zweiter.steuerung.geoeffnet({ kind: "place", id: "ferdok" }, { source: "map", camera: "none" }, true),
        ).toBe(false);
        expect(zweiter.offen()).toEqual([]);
        expect(steuerung.geoeffnet({ kind: "place", id: "gareth" }, { source: "search", camera: "none" }, true)).toBe(
            false,
        );
        expect(offen()).toEqual(["ferdok"]);
    });

    it("🔴 Nr. 6: ein anderes Objekt der Karte holt das Infopanel vor den Ortseditor, ein Ort nicht", () => {
        const { steuerung, fenster, umgeschaltet } = aufbau();
        fenster.oeffne({ werkzeug: "ortseditor", gegenstand: "gareth", titel: "", nurLesen: false });
        steuerung.geoeffnet({ kind: "place", id: "ferdok" }, { source: "map", camera: "none" });
        expect(umgeschaltet()).toBe(0);
        steuerung.geoeffnet({ kind: "path", anchor: "reichsstrasse" }, { source: "search", camera: "none" });
        expect(umgeschaltet()).toBe(0);
        steuerung.geoeffnet({ kind: "path", anchor: "reichsstrasse" }, { source: "map", camera: "none" });
        expect(umgeschaltet()).toBe(1);
    });
});
