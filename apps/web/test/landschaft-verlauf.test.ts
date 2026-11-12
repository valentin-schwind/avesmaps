import { describe, expect, it } from "vitest";
import type { EditorLandscapeDetail, MapHistoryEntry } from "@avesmaps3d/shared";
import { ruecknahmeFamilie } from "../src/aenderungen/aenderung-ruecknahme";
import { createLandschaftVerlaufsArt, gehoertZurFlaeche } from "../src/landschaftseditor/landschaft-verlauf";

/**
 * Der Verlauf einer Fläche der Derographie (WI-0178 D3; Anschluss an `fenster/entwurf-verlauf.ts`; seit WI-0265 B6c nimmt der Server ALLES zurück, was an der Fläche zurückgeht).
 * Problemfälle: Der Anschluss spielt etwas selbst zurück, obwohl der Server es als EINE Operation tut (zwei Rücknahmen für ein ↺); der Verlauf einer Fläche bietet ein ↺ an einem
 * Eintrag, den der Server nicht kennt (Anlegen, Beschriftung löschen); ein Werkzeug an Flächen, ein Entfernen oder eine Form hat im Verlauf der Fläche keine Adresse; die Beschriftung einer
 * anderen Fläche gehört dazu. Die Rücknahmen des Servers prüfen `ruecknahme-flaeche.test.ts` (Server, Wegwerf-Cluster) und `aenderung-ruecknahme.test.ts` (Adresse, Angebot, Rückfrage).
 */

const WALD = "c3c3c3c3-0000-4000-8000-000000000001";
const FLAECHE = "c3c3c3c3-0000-4000-8000-0000000000a1";
const LABEL = "c3c3c3c3-0000-4000-8000-0000000000c1";
const FREMD = "c3c3c3c3-0000-4000-8000-0000000000c9";

const D: EditorLandscapeDetail = {
    id: WALD,
    name: "Formforst",
    layer: "topographie",
    type: "tal",
    circle: "voll",
    order: 4,
    clickLocked: true,
    curve: { enabled: true, max: 2 },
    areas: [{ id: FLAECHE, affectsPaths: true, revision: 7, polygons: [] }],
    labels: [
        {
            id: LABEL,
            text: "Formforst",
            x: 5,
            y: 5,
            visible: false,
            revision: 4,
            size: 16,
            priority: 2,
            zoomMin: 3,
            zoomMax: 6,
        },
    ],
    neighbors: [],
    revision: 3,
};

const eintrag = (
    objects: MapHistoryEntry["objects"],
    operation = "landscape.update",
    source: MapHistoryEntry["source"] = "editor",
): MapHistoryEntry => ({
    operationId: "e1e1e1e1-0000-4000-8000-000000000001",
    seq: 12,
    at: "2026-10-18T10:00:00.000Z",
    operation,
    source,
    actor: { kind: "person", name: "Thomas" },
    objects,
});
const gegenstand = (
    kind: "landscape" | "area" | "label",
    id: string,
    action: string,
    changes: MapHistoryEntry["objects"][number]["changes"] = {},
): MapHistoryEntry["objects"][number] => ({
    kind,
    id,
    action,
    revisionBefore: 2,
    revisionAfter: 3,
    changes,
    ...(kind === "landscape" ? {} : { landscape: { id: WALD } }),
});

const felder = eintrag([gegenstand("landscape", WALD, "region.updated", { name: { before: "Alt", after: "Neu" } })]);
const beschriftung = eintrag([gegenstand("label", LABEL, "label.updated", { size: { before: 12, after: 16 } })]);
const form = eintrag([gegenstand("area", FLAECHE, "area.reshaped", { geometry: { before: [], after: [] } })]);
const entfernt = eintrag(
    [
        gegenstand("landscape", WALD, "region.taken_off_map", { active: { before: true, after: false } }),
        gegenstand("area", FLAECHE, "area.retired", { active: { before: true, after: false } }),
    ],
    "landscape.retire",
);
const werkzeug = eintrag(
    [gegenstand("area", FLAECHE, "area.boolean", { geometry: { before: [], after: [] } })],
    "landscape.boolean",
);
const gebirge = eintrag([gegenstand("area", FLAECHE, "area.gebirge", { gebirge: { before: {}, after: {} } })]);
const mehrfach = eintrag(
    [gegenstand("landscape", WALD, "region.updated", { hidden: { before: false, after: true } })],
    "landscape.batch",
);

describe("Verlauf einer Fläche der Derographie, nach B6c", () => {
    it("🔴 dieser Anschluss spielt nichts mehr selbst zurück: Der Server nimmt Felder, Beschriftungen, Form, Entfernen, Werkzeuge und Gebirge in EINER Operation zurück", () => {
        const art = createLandschaftVerlaufsArt();
        for (const e of [felder, beschriftung, form, entfernt, werkzeug, gebirge, mehrfach])
            expect(art.ruecknahme(e, D, "op")).toEqual({ art: "nicht" });
    });

    it("🔴 die Adresse der Server-Rücknahme ist die Fläche dieses Verlaufs, für jede Art, die der Server kennt", () => {
        const art = createLandschaftVerlaufsArt();
        for (const e of [felder, beschriftung, form, entfernt, werkzeug, gebirge, mehrfach])
            expect(art.ruecknahmeZiel?.(e, WALD)).toEqual({ familie: "landscape", id: WALD });
    });

    it("🔴 Anlegen und Beschriftung löschen haben seit B8c ihre Adresse (die Landschaft); ein Gipfel allein hat hier keine", () => {
        const art = createLandschaftVerlaufsArt();
        const angelegt = eintrag(
            [
                gegenstand("landscape", WALD, "region.created", { active: { after: true } }),
                gegenstand("area", FLAECHE, "area.created", { active: { after: true } }),
            ],
            "landscape.create",
        );
        const geloescht = eintrag(
            [gegenstand("label", LABEL, "label.retired", { active: { before: true, after: false } })],
            "label.retire",
        );
        const gipfel = eintrag(
            [
                {
                    kind: "peak",
                    id: "c3c3c3c3-0000-4000-8000-0000000000d1",
                    action: "peak.updated",
                    revisionBefore: 1,
                    revisionAfter: 2,
                    changes: { height: { before: 100, after: 200 } },
                },
            ],
            "peak.update",
        );
        for (const e of [angelegt, geloescht])
            expect(art.ruecknahmeZiel?.(e, WALD)).toEqual({ familie: "landscape", id: WALD });
        expect(art.ruecknahmeZiel?.(gipfel, WALD)).toBeUndefined();
    });

    it("🔴 B6g3: die Quellen der Fläche haben in „Änderungen“ eine Adresse (Familie der Landschaft), in diesem Verlauf keine: dort ist ihr ↺ das je Quelle", () => {
        const quellen = eintrag(
            [gegenstand("landscape", WALD, "region.sources_changed", { quellen: { before: [], after: [] } })],
            "traeger.sources",
        );
        expect(ruecknahmeFamilie(quellen)).toBe("landscape");
        expect(createLandschaftVerlaufsArt().ruecknahmeZiel?.(quellen, WALD)).toBeUndefined();
    });

    it("🔴 die Beschriftung und die Teilfläche einer anderen Fläche gehören nicht dazu", () => {
        expect(gehoertZurFlaeche(gegenstand("label", FREMD, "label.updated"), D)).toBe(false);
        expect(gehoertZurFlaeche(gegenstand("area", FREMD, "area.reshaped"), D)).toBe(false);
        expect(gehoertZurFlaeche(gegenstand("label", LABEL, "label.updated"), D)).toBe(true);
        expect(gehoertZurFlaeche(gegenstand("area", FLAECHE, "area.reshaped"), D)).toBe(true);
        expect(gehoertZurFlaeche(gegenstand("landscape", WALD, "region.updated"), D)).toBe(true);
    });

    it("✅ liest den Verlauf der Fläche unter ihrer Adresse und führt die Felder in der Folge der Anzeige", () => {
        const art = createLandschaftVerlaufsArt();
        expect(art.url(WALD)).toBe(`/api/editor/landscapes/${WALD}/history`);
        expect(art.feldFolge).toContain("geometry");
    });
});
