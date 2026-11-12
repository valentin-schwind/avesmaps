import { describe, expect, it } from "vitest";
import { effectScope, nextTick, watch } from "vue";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { DESIGN_CANON, canonColour, type SubjectRef } from "@avesmaps3d/shared";
import { createSubjectSelection } from "../src/info-panel/subject-selection.ts";
import type { PresentedSelection } from "../src/info-panel/presentation.ts";
import { createEscapeCascade } from "../src/keyboard/escape-cascade.ts";
import {
    buildSprachLeuchtenLayers,
    createSprachLeuchten,
    SPRACHE_LEUCHTEN_FUELLUNG_ID,
    SPRACHE_LEUCHTEN_LINIE_ID,
    SPRACHE_LEUCHTEN_SCHEIN_ID,
    withSprachLeuchten,
} from "../src/map/sprachen-leuchten.ts";
import {
    SPRACHE_FILL_LAYER_ID,
    SPRACHE_LINE_LAYER_ID,
    SPRACHE_SOURCE_ID,
    SPRACHE_SOURCE_LAYER,
} from "../src/map/sprachen-layers.ts";

/**
 * Das Leuchten der Flächen einer Sprache (WI-0261 S5c), ohne Browser: die Ebenen und ihr Filter, ihre Stelle im Stil, die Quelle in anderen Ebenen, und der Zustand - eine neu gewählte Sprache
 * leuchtet, „Alle zeigen“ schaltet sie um und lässt sie nicht von selbst wieder an, Escape und jede andere Wahl beenden es.
 */

const URL = "/tiles/vector/sprache_flaeche_render/{z}/{x}/{y}";

/** Ein Stil, wie die Ebene „Sprachen“ ihn hat: Flächen und Kontur der Sprachen, darüber das Wasser, die Wege, die Route und die Orte. */
function sprachenStil(): StyleSpecification {
    const layers = [
        { id: "background", type: "background" },
        { id: SPRACHE_FILL_LAYER_ID, type: "fill", source: SPRACHE_SOURCE_ID, "source-layer": SPRACHE_SOURCE_LAYER },
        { id: SPRACHE_LINE_LAYER_ID, type: "line", source: SPRACHE_SOURCE_ID, "source-layer": SPRACHE_SOURCE_LAYER },
        { id: "water-lake", type: "fill", source: "water", "source-layer": "w" },
        { id: "path-center-weg", type: "line", source: "paths", "source-layer": "p" },
        { id: "route-halo", type: "line", source: "route" },
        { id: "place-marker", type: "circle", source: "places" },
    ] as LayerSpecification[];
    return {
        version: 8,
        sources: {
            [SPRACHE_SOURCE_ID]: { type: "vector", tiles: [URL] },
            paths: { type: "vector", tiles: ["/p/{z}/{x}/{y}"] },
        },
        layers,
    };
}

/** Ein Stil einer anderen Ebene (Klima): keine Sprachflächen, keine Quelle. */
function klimaStil(): StyleSpecification {
    return {
        version: 8,
        sources: { paths: { type: "vector", tiles: ["/p/{z}/{x}/{y}"] } },
        layers: [
            { id: "background", type: "background" },
            { id: "climate-fill", type: "fill", source: "paths", "source-layer": "c" },
            { id: "path-center-weg", type: "line", source: "paths", "source-layer": "p" },
            { id: "route-halo", type: "line", source: "route" },
            { id: "place-marker", type: "circle", source: "places" },
        ] as LayerSpecification[],
    };
}

const ids = (stil: StyleSpecification): string[] => stil.layers.map((layer) => layer.id);

describe("Die Ebenen des Leuchtens", () => {
    it("ohne leuchtende Sprache keine Ebene", () => {
        expect(buildSprachLeuchtenLayers([])).toEqual([]);
    });

    it("Füllung, Schein und Kontur im Hausmuster der Auswahl, über der Quelle der Sprachflächen, gefiltert auf den Schlüssel", () => {
        const layers = buildSprachLeuchtenLayers(["garethi"]);
        expect(layers.map((layer) => layer.id)).toEqual([
            SPRACHE_LEUCHTEN_FUELLUNG_ID,
            SPRACHE_LEUCHTEN_SCHEIN_ID,
            SPRACHE_LEUCHTEN_LINIE_ID,
        ]);
        for (const layer of layers) {
            expect(layer).toMatchObject({
                source: SPRACHE_SOURCE_ID,
                "source-layer": SPRACHE_SOURCE_LAYER,
                filter: ["in", ["get", "schluessel"], ["literal", ["garethi"]]],
            });
        }
        const look = DESIGN_CANON.mapSelection;
        expect(layers[0]).toMatchObject({
            type: "fill",
            paint: { "fill-color": canonColour("mapSelection"), "fill-opacity": look.fillOpacity },
        });
        expect(layers[1]).toMatchObject({
            type: "line",
            paint: { "line-color": canonColour("mapSelectionGlow"), "line-width": look.glowWidth },
        });
        expect(layers[2]).toMatchObject({
            type: "line",
            paint: { "line-color": canonColour("mapSelection"), "line-width": look.lineWidth },
        });
    });

    it("mehrere Schlüssel gehen in einen Filter (über 64 als Nachschlagetabelle)", () => {
        const viele = Array.from({ length: 70 }, (_, n) => `s${String(n)}`);
        const filter = (buildSprachLeuchtenLayers(viele)[0] as { filter: unknown[] }).filter;
        expect(filter[0]).toBe("match");
        expect(filter[2]).toEqual(viele);
    });
});

describe("Das Leuchten im Stil", () => {
    it("ohne leuchtende Sprache bleibt der Stil, wie er ist", () => {
        const stil = sprachenStil();
        expect(withSprachLeuchten(stil, [], { sprachenUrl: URL })).toBe(stil);
    });

    it("in der Ebene „Sprachen“: direkt über der Kontur der Sprachen, unter Wasser, Wegen, Route und Orten", () => {
        const stil = sprachenStil();
        const neu = withSprachLeuchten(stil, ["garethi"], { sprachenUrl: URL });
        expect(ids(neu)).toEqual([
            "background",
            SPRACHE_FILL_LAYER_ID,
            SPRACHE_LINE_LAYER_ID,
            SPRACHE_LEUCHTEN_FUELLUNG_ID,
            SPRACHE_LEUCHTEN_SCHEIN_ID,
            SPRACHE_LEUCHTEN_LINIE_ID,
            "water-lake",
            "path-center-weg",
            "route-halo",
            "place-marker",
        ]);
        // Die Quelle steht schon da und bleibt dieselbe.
        expect(neu.sources[SPRACHE_SOURCE_ID]).toBe(stil.sources[SPRACHE_SOURCE_ID]);
        expect(Object.keys(neu.sources)).toEqual([SPRACHE_SOURCE_ID, "paths"]);
    });

    it("in jeder anderen Ebene bringt das Leuchten die Quelle mit und liegt vor der Route und den Marken (wie das Leuchten der Suche)", () => {
        const neu = withSprachLeuchten(klimaStil(), ["garethi"], { sprachenUrl: URL });
        expect(ids(neu)).toEqual([
            "background",
            "climate-fill",
            "path-center-weg",
            SPRACHE_LEUCHTEN_FUELLUNG_ID,
            SPRACHE_LEUCHTEN_SCHEIN_ID,
            SPRACHE_LEUCHTEN_LINIE_ID,
            "route-halo",
            "place-marker",
        ]);
        expect(neu.sources[SPRACHE_SOURCE_ID]).toMatchObject({
            type: "vector",
            tiles: [URL],
            // Die Teilflächen tragen ihre Kennung wie in der Ebene „Sprachen“ (Zeigen über den Feature-State).
            promoteId: { [SPRACHE_SOURCE_LAYER]: "public_id" },
        });
    });

    it("ohne Kachelvorlage und ohne Quelle leuchtet nichts, statt auf eine fehlende Quelle zu zeigen", () => {
        const stil = klimaStil();
        expect(withSprachLeuchten(stil, ["garethi"], {})).toBe(stil);
    });

    it("der Stil, den der Aufrufer reicht, bleibt unverändert", () => {
        const stil = klimaStil();
        const vorher = JSON.stringify(stil);
        withSprachLeuchten(stil, ["garethi"], { sprachenUrl: URL });
        expect(JSON.stringify(stil)).toBe(vorher);
    });
});

describe("Der Zustand des Leuchtens", () => {
    it("eine neu gewählte Sprache leuchtet; keine Wahl beendet es", () => {
        const leuchten = createSprachLeuchten();
        expect(leuchten.schluessel.value).toEqual([]);
        leuchten.folge("garethi");
        expect(leuchten.schluessel.value).toEqual(["garethi"]);
        expect(leuchten.leuchtet("garethi")).toBe(true);
        leuchten.folge(undefined);
        expect(leuchten.schluessel.value).toEqual([]);
    });

    it("„Alle zeigen“ schaltet um, und derselbe Stand der Auswahl schaltet es nicht wieder an", () => {
        const leuchten = createSprachLeuchten();
        leuchten.folge("garethi");
        expect(leuchten.schalte("garethi")).toBe(false);
        expect(leuchten.leuchtet("garethi")).toBe(false);
        // `present` ruft `folge` mit demselben Schlüssel noch einmal (Wissen der Karte, dann Antwort des Servers): Das Ausschalten bleibt.
        leuchten.folge("garethi");
        expect(leuchten.leuchtet("garethi")).toBe(false);
        expect(leuchten.schalte("garethi")).toBe(true);
        expect(leuchten.leuchtet("garethi")).toBe(true);
    });

    it("eine andere Sprache leuchtet wieder von selbst; eine bewusste Wahl derselben auch", () => {
        const leuchten = createSprachLeuchten();
        leuchten.folge("garethi");
        leuchten.schalte("garethi");
        leuchten.folge("orkisch");
        expect(leuchten.schluessel.value).toEqual(["orkisch"]);
        leuchten.schalte("orkisch");
        leuchten.zeige("orkisch");
        expect(leuchten.schluessel.value).toEqual(["orkisch"]);
    });

    it("beende sagt, ob etwas leuchtete, und vergisst die Wahl: dieselbe Sprache leuchtet danach wieder", () => {
        const leuchten = createSprachLeuchten();
        expect(leuchten.beende()).toBe(false);
        leuchten.folge("garethi");
        expect(leuchten.beende()).toBe(true);
        expect(leuchten.beende()).toBe(false);
        leuchten.folge("garethi");
        expect(leuchten.leuchtet("garethi")).toBe(true);
    });

    it("eine Änderung ist für den Stil sichtbar (reaktiv): Er entsteht neu, wenn die Sprache leuchtet oder nicht mehr leuchtet", async () => {
        const leuchten = createSprachLeuchten();
        const gesehen: string[][] = [];
        const scope = effectScope();
        scope.run(() => watch(leuchten.schluessel, (neu) => gesehen.push([...neu])));
        leuchten.folge("garethi");
        await nextTick();
        leuchten.schalte("garethi");
        await nextTick();
        scope.stop();
        expect(gesehen).toEqual([["garethi"], []]);
    });
});

describe("🔴 Mit der echten Auswahl und der Escape-Kaskade (so wie `app.vue` es verdrahtet)", () => {
    const GARETHI: SubjectRef = { kind: "sprache", id: "c0de0000-0000-4000-8000-000000000001" };
    const ORT: SubjectRef = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };

    function verdrahtet() {
        const leuchten = createSprachLeuchten();
        const cascade = createEscapeCascade();
        const selection = createSubjectSelection({
            client: { detail: () => new Promise(() => undefined), resolveLink: () => Promise.reject(new Error("-")) },
            effects: {
                // `present` und `clear` von `app.vue`: die Wahl der Sprache und ihr Leuchten folgen der Darstellung.
                present: (next: PresentedSelection) => leuchten.folge(next.sprache),
                clear: () => {
                    leuchten.beende();
                },
                fly: () => undefined,
            },
        });
        cascade.register("info-panel", () => selection.escapeVisible());
        cascade.register("map-selection", () => selection.escapeSelection());
        const oeffne = (ref: SubjectRef, sprache?: string): boolean =>
            selection.openSubject(ref, {
                source: "search",
                camera: "target",
                known: { title: "Garethi", presentation: sprache === undefined ? {} : { sprache } },
            });
        return { leuchten, cascade, selection, oeffne };
    }

    it("die Infobox einer Sprache öffnen: sie leuchtet; Escape schließt die Infobox und beendet das Leuchten", () => {
        const { leuchten, cascade, selection, oeffne } = verdrahtet();
        oeffne(GARETHI, "garethi");
        expect(leuchten.leuchtet("garethi")).toBe(true);
        expect(cascade.run()).toBe("info-panel");
        expect(selection.selected.value).toBeUndefined();
        expect(leuchten.schluessel.value).toEqual([]);
    });

    it("eingeklappt (kein sichtbares Panel) beendet die letzte Stufe, die Auswahl der Karte, das Leuchten", () => {
        const { leuchten, cascade, selection, oeffne } = verdrahtet();
        oeffne(GARETHI, "garethi");
        selection.collapsePanel();
        expect(cascade.run()).toBe("map-selection");
        expect(leuchten.schluessel.value).toEqual([]);
    });

    it("ein anderer Gegenstand ersetzt das Leuchten; „Alle zeigen“ aus bleibt aus, solange dieselbe Infobox offen ist", () => {
        const { leuchten, oeffne } = verdrahtet();
        oeffne(GARETHI, "garethi");
        leuchten.schalte("garethi");
        // Dieselbe Sprache noch einmal geöffnet (Wiederholung der Darstellung): keine Wiederkehr des Goldes von selbst.
        oeffne(GARETHI, "garethi");
        expect(leuchten.schluessel.value).toEqual([]);
        oeffne(ORT);
        expect(leuchten.schluessel.value).toEqual([]);
        oeffne(GARETHI, "garethi");
        expect(leuchten.leuchtet("garethi")).toBe(true);
        oeffne(ORT);
        expect(leuchten.schluessel.value).toEqual([]);
    });
});
