import { describe, expect, it } from "vitest";
import type { EditorPeakDetail, MapHistoryEntry } from "@avesmaps3d/shared";
import { createGipfelVerlaufsArt } from "../src/landschaftseditor/gipfel-verlauf";

/**
 * Der Verlauf eines Gipfels („Gipfel entfernen …“, Editor-Orchestrierung 2026-10-19; seit WI-0265 B6c nimmt der Server ALLES zurück, was am Gipfel zurückgeht). Problemfälle: Der Anschluss
 * spielt etwas selbst zurück, obwohl der Server es als EINE Operation tut; ↺ an einer Änderung von Name oder Höhe fehlt (Parität mit dem Server, der sie kennt); ↺ an einem fremden Gipfel
 * derselben Mehrfachauswahl; das Anlegen („Gipfel setzen“) bietet ein ↺ an. Die Rücknahmen des Servers prüft `ruecknahme-gipfel.test.ts` (Server, Wegwerf-Cluster).
 */
const G = "c8c8c8c8-0000-4000-8000-000000000001";
const ANDERER = "c8c8c8c8-0000-4000-8000-000000000002";
const D: EditorPeakDetail = {
    id: G,
    name: "Probezinne",
    subtype: "berggipfel",
    showName: true,
    position: [450, 560],
    revision: 2,
    state: "retired",
};
const eintrag = (
    operation: string,
    id = G,
    action = "peak.retired",
    changes: MapHistoryEntry["objects"][number]["changes"] = { active: { before: true, after: false } },
): MapHistoryEntry => ({
    operationId: "e1e1e1e1-0000-4000-8000-000000000001",
    seq: 4,
    at: "2026-10-19T12:00:00.000Z",
    operation,
    source: "editor",
    actor: { kind: "person", name: "Thomas" },
    objects: [{ kind: "peak", id, action, revisionBefore: 1, revisionAfter: 2, changes }],
});

describe("Verlauf des Gipfels, nach B6c", () => {
    it("🔴 dieser Anschluss spielt nichts mehr selbst zurück: Entfernen, Zurückholen und Felder nimmt der Server zurück", () => {
        const art = createGipfelVerlaufsArt();
        for (const e of [
            eintrag("peak.retire"),
            eintrag("landscape.retire"),
            eintrag("peak.update", G, "peak.updated", { height: { before: 1, after: 2 } }),
        ])
            expect(art.ruecknahme(e, D, "op")).toEqual({ art: "nicht" });
    });

    it("🔴 die Adresse der Server-Rücknahme ist der Gipfel dieses Verlaufs: Entfernen, ein „Entfernen …“ der Mehrfachauswahl und Änderungen von Name, Höhe, Anzeige und Lage", () => {
        const art = createGipfelVerlaufsArt();
        const ziel = { familie: "peak", id: G };
        expect(art.ruecknahmeZiel?.(eintrag("peak.retire"), G)).toEqual(ziel);
        expect(art.ruecknahmeZiel?.(eintrag("landscape.retire"), G)).toEqual(ziel);
        expect(art.ruecknahmeZiel?.(eintrag("peak.restore", G, "peak.restored"), G)).toEqual(ziel);
        for (const [feld, wechsel] of [
            ["height", { before: 100, after: 200 }],
            ["name", { before: "A", after: "B" }],
            ["showName", { before: true, after: false }],
            ["position", { before: [1, 2], after: [3, 4] }],
        ] as const)
            expect(art.ruecknahmeZiel?.(eintrag("peak.update", G, "peak.updated", { [feld]: wechsel }), G)).toEqual(
                ziel,
            );
    });

    it("🔴 keine Adresse an einem fremden Gipfel derselben Operation; das Anlegen („Gipfel setzen“) hat seit B8c seine Adresse", () => {
        const art = createGipfelVerlaufsArt();
        expect(art.ruecknahmeZiel?.(eintrag("landscape.retire", ANDERER), G)).toBeUndefined();
        expect(art.ruecknahmeZiel?.(eintrag("peak.create", G, "peak.created", { active: { after: true } }), G)).toEqual(
            { familie: "peak", id: G },
        );
    });

    it("✅ liest den Verlauf unter der Adresse des Gipfels und kennt nur seine Gegenstände", () => {
        const art = createGipfelVerlaufsArt();
        expect(art.url(G)).toBe(`/api/editor/peaks/${G}/history`);
        const gegenstand = eintrag("peak.retire").objects[0]!;
        expect(art.gehoert(gegenstand, D)).toBe(true);
        expect(art.gehoert({ ...gegenstand, id: ANDERER }, D)).toBe(false);
    });
});
