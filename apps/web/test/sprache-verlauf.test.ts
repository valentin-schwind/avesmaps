import { describe, expect, it, vi } from "vitest";
import type { MapHistoryEntry, SpracheEditorDetail } from "@avesmaps3d/shared";
import { createSpracheVerlaufsArt } from "../src/spracheditor/sprache-verlauf";

/**
 * Der Verlauf einer Sprache (WI-0261 S5d2; seit WI-0265 B6e nimmt der Server ALLES zurück, was an einer Sprache zurückgeht). Problemfälle: Der Anschluss spielt etwas selbst zurück, obwohl
 * der Server es als EINE Operation tut (dann zweimal und gegen eine Sperre, die ↺ aus „Änderungen“ nicht hält); ↺ an einer Änderung der Wiki-Artikel, der Form oder einer Kopie fehlt (Parität
 * mit dem Server, der sie kennt); ↺ an einer fremden Sprache derselben Operation; das Anlegen und „Fläche aus der Derographie“ bieten ein ↺ an. Die Rücknahmen des Servers prüft
 * `ruecknahme-sprache.test.ts` (Server, Wegwerf-Cluster).
 */
const S = "5d2c0000-0000-4000-8000-000000000001";
const ANDERE = "5d2c0000-0000-4000-8000-000000000002";
const TEIL = "5d2c0000-0000-4000-8000-0000000000f1";
const D = { id: S, revision: 4, aktiv: true } as unknown as SpracheEditorDetail;

type Objekt = MapHistoryEntry["objects"][number];
const sprache = (action: string, id = S, changes: Objekt["changes"] = {}): Objekt => ({
    kind: "sprache",
    id,
    action,
    revisionBefore: 1,
    revisionAfter: 2,
    changes,
});
const teil = (action: string, spracheId = S, changes: Objekt["changes"] = {}): Objekt => ({
    kind: "sprache_flaeche",
    id: TEIL,
    action,
    revisionBefore: 1,
    revisionAfter: 2,
    changes,
    sprache: { id: spracheId },
});
const eintrag = (operation: string, objects: Objekt[]): MapHistoryEntry => ({
    operationId: "e1e1e1e1-0000-4000-8000-000000000001",
    seq: 4,
    at: "2026-10-31T12:00:00.000Z",
    operation,
    source: "editor",
    actor: { kind: "person", name: "Thomas" },
    objects,
});

describe("Verlauf der Sprache, nach B6e", () => {
    it("🔴 dieser Anschluss spielt nichts mehr selbst zurück: Felder, Stilllegen, Zurückholen und Teilflächen nimmt der Server zurück", () => {
        const art = createSpracheVerlaufsArt();
        for (const e of [
            eintrag("sprache.update", [sprache("sprache.updated", S, { farbe: { before: "#fff", after: "#000" } })]),
            eintrag("sprache.retire", [sprache("sprache.retired")]),
            eintrag("sprache_flaeche.retire", [teil("sprache_flaeche.retired")]),
            eintrag("sprache_flaeche.reshape", [teil("sprache_flaeche.reshaped")]),
        ])
            expect(art.ruecknahme(e, D, "op")).toEqual({ art: "nicht" });
    });

    it("🔴 die Adresse der Server-Rücknahme ist die Sprache dieses Verlaufs: Felder, Wiki, Stand, Form, Werkzeuge, Kopieren; auch wo nur eine Teilfläche im Eintrag steht", () => {
        const art = createSpracheVerlaufsArt();
        const ziel = { familie: "sprache", id: S };
        for (const e of [
            eintrag("sprache.update", [sprache("sprache.updated")]),
            eintrag("sprache.wiki", [sprache("sprache.wiki_changed"), sprache("sprache.wiki_released", ANDERE)]),
            eintrag("sprache.retire", [sprache("sprache.retired")]),
            eintrag("sprache.restore", [sprache("sprache.restored")]),
            eintrag("sprache_flaeche.retire", [teil("sprache_flaeche.retired")]),
            eintrag("sprache_flaeche.restore", [teil("sprache_flaeche.restored")]),
            eintrag("sprache_flaeche.reshape", [teil("sprache_flaeche.reshaped")]),
            eintrag("sprache_flaeche.parts", [teil("sprache_flaeche.parts"), teil("sprache_flaeche.retired")]),
            eintrag("sprache_flaeche.split", [teil("sprache_flaeche.split"), teil("sprache_flaeche.created")]),
            eintrag("sprache_flaeche.boolean", [teil("sprache_flaeche.boolean"), teil("sprache_flaeche.retired")]),
            // Kopieren in eine NEUE Sprache: die neue Sprache ist `ANDERE`; der Verlauf der Quelle und der der neuen Sprache nennen beide ihre Adresse.
            eintrag("sprache_flaeche.copy", [
                sprache("sprache.created", ANDERE),
                teil("sprache_flaeche.copied", ANDERE),
                teil("sprache_flaeche.retired", S),
            ]),
            eintrag("sprache.restore_series", [sprache("sprache.updated")]),
        ])
            expect(art.ruecknahmeZiel?.(e, S), e.operation).toEqual(ziel);
        const kopie = eintrag("sprache_flaeche.copy", [
            sprache("sprache.created", ANDERE),
            teil("sprache_flaeche.copied", ANDERE),
        ]);
        expect(art.ruecknahmeZiel?.(kopie, ANDERE)).toEqual({ familie: "sprache", id: ANDERE });
    });

    it("🔴 keine Adresse an einer fremden Sprache derselben Operation; Anlegen und „Fläche der Derographie in eine Sprache“ haben seit B8c ihre Adresse", () => {
        const art = createSpracheVerlaufsArt();
        expect(
            art.ruecknahmeZiel?.(eintrag("sprache.update", [sprache("sprache.updated", ANDERE)]), S),
        ).toBeUndefined();
        const ziel = { familie: "sprache", id: S };
        expect(art.ruecknahmeZiel?.(eintrag("sprache.create", [sprache("sprache.created", S)]), S)).toEqual(ziel);
        expect(art.ruecknahmeZiel?.(eintrag("sprache_flaeche.create", [teil("sprache_flaeche.created")]), S)).toEqual(
            ziel,
        );
        expect(
            art.ruecknahmeZiel?.(
                eintrag("sprache.flaeche_aus_landschaft", [
                    sprache("sprache.created", S),
                    teil("sprache_flaeche.copied"),
                ]),
                S,
            ),
        ).toEqual(ziel);
        // Eine Aktion, die der Server nicht kennt, hat keine Adresse.
        expect(art.ruecknahmeZiel?.(eintrag("sprache.update", [sprache("sprache.zzz")]), S)).toBeUndefined();
    });

    it("✅ liest den Verlauf unter der Adresse der Sprache und kennt ihre Gegenstände und alle Teilflächen", () => {
        const art = createSpracheVerlaufsArt();
        expect(art.url(S)).toBe(`/api/editor/sprachen/${S}/history`);
        expect(art.gehoert(sprache("sprache.updated"), D)).toBe(true);
        expect(art.gehoert(sprache("sprache.updated", ANDERE), D)).toBe(false);
        expect(art.gehoert(teil("sprache_flaeche.reshaped"), D)).toBe(true);
    });

    it("🔴 nach einer Rücknahme durch den Server gibt der Anschluss die Quittung an das Fenster weiter (es vergisst zurückgebrachte Teilflächen)", () => {
        const gemeldet = vi.fn();
        const quittung = { affected: [{ kind: "sprache_flaeche", id: TEIL }] };
        createSpracheVerlaufsArt({ nachRuecknahme: gemeldet }).nachRuecknahme?.(quittung);
        expect(gemeldet).toHaveBeenCalledWith(quittung);
        expect(createSpracheVerlaufsArt().nachRuecknahme).toBeUndefined();
    });
});
