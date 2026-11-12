import { describe, expect, it } from "vitest";
import type { EditorTerritoryDetail, MapHistoryEntry, MapHistoryObject, RuecknahmePruefung } from "@avesmaps3d/shared";
import { folgenZeilen, ruecknahmeFamilie, ruecknahmeZiel } from "../src/aenderungen/aenderung-ruecknahme.ts";
import { istHerkunftsfeld } from "../src/fenster/entwurf-verlauf.ts";
import { createGebietVerlaufsArt } from "../src/gebietseditor/gebiet-verlauf.ts";

/**
 * Der Verlauf eines Herrschaftsgebiets (WI-0209 D5; gemeinsamer Verlauf `fenster/entwurf-verlauf.ts`), seit WI-0265 B6b ohne eigenes Zurückspielen: Der Server nimmt zurück
 * (`ruecknahme-gebiet.ts`), der Anschluss nennt nur die Adresse. Problemfälle: Ein Eintrag, den der Server kennt, bekommt keine Adresse (kein ↺); einer, den er nicht kennt (Anlegen, Form,
 * Zurückholen, ein Nodix), bekommt eine; der Verlauf spielt doch noch selbst zurück; die Folgen des Zurückholens verschwinden aus der Rückfrage.
 */
const GEBIET = "d5d5d5d5-0000-4000-8000-000000000001";
const WEST = "d5d5d5d5-0000-4000-8000-000000000002";
const OST = "d5d5d5d5-0000-4000-8000-000000000003";
const FLAECHE = "d5d5d5d5-0000-4000-8000-0000000000a1";

const detail = (extra: Partial<EditorTerritoryDetail> = {}): EditorTerritoryDetail => ({
    id: GEBIET,
    revision: 4,
    name: "Baronie",
    color: "#5dac60",
    opacity: 0.7,
    minZoom: 4,
    maxZoom: 8,
    order: 0,
    parents: [{ id: OST, name: "Ost" }],
    children: [],
    details: {},
    areas: [{ id: FLAECHE, revision: 2, bounds: [0, 0, 1, 1] }],
    claimedBy: [],
    claims: [],
    ...extra,
});
const gegenstand = (changes: MapHistoryObject["changes"], extra: Partial<MapHistoryObject> = {}): MapHistoryObject => ({
    kind: "territory",
    id: GEBIET,
    action: "territory.updated",
    revisionBefore: 3,
    revisionAfter: 4,
    changes,
    ...extra,
});
const eintrag = (
    operation: string,
    objects: MapHistoryObject[],
    extra: Partial<MapHistoryEntry> = {},
): MapHistoryEntry => ({
    operationId: "op-alt",
    seq: 7,
    at: "2026-10-18T10:00:00.000Z",
    operation,
    source: "editor",
    actor: { kind: "person", name: "Thomas" },
    objects,
    ...extra,
});

describe("Verlauf des Gebiets (D5, seit B6b über den Server)", () => {
    it("🔴 der Anschluss spielt nichts mehr selbst zurück: ↺ sagt immer `nicht`, die Adresse nennt das Gebiet des Verlaufs", () => {
        const art = createGebietVerlaufsArt();
        const umgehaengt = eintrag("territory.update", [gegenstand({ parent: { before: WEST, after: OST } })]);
        expect(art.ruecknahme(umgehaengt, detail(), "op-neu")).toEqual({ art: "nicht" });
        expect(art.ruecknahmeZiel?.(umgehaengt, GEBIET)).toEqual({ familie: "territory", id: GEBIET });
    });

    it("🔴 jede Art, die der Server kennt, bekommt eine Adresse: Felder, Farbe und Spanne, Mehrfachauswahl, Entfernen, Obergebiet anlegen, Vereinigen", () => {
        const art = createGebietVerlaufsArt();
        const anzeige = { action: "territory.display_changed" };
        const faelle: [string, MapHistoryObject[]][] = [
            [
                "territory.update",
                [gegenstand({ name: { before: "A", after: "B" }, ruler: { before: null, after: "X" } })],
            ],
            ["territory.display", [gegenstand({ color: { before: "#111111", after: "#222222" } }, anzeige)]],
            [
                "territory.sammel",
                [
                    gegenstand({ type: { before: "Baronie", after: "Junkertum" } }),
                    gegenstand({ color: { before: "#111111", after: "#222222" } }, anzeige),
                    gegenstand(
                        { minZoom: { before: 2, after: 3 } },
                        { ...anzeige, kind: "territory_area", id: FLAECHE, action: "territory_area.bands_cleared" },
                    ),
                ],
            ],
            [
                "territory.retire",
                [gegenstand({ active: { before: true, after: false } }, { action: "territory.retired" })],
            ],
            ["territory.create_parent", [gegenstand({ parent: { before: OST, after: WEST } })]],
            [
                "territory.merge",
                [
                    gegenstand(
                        { geometry: { before: [], after: [] } },
                        { kind: "territory_area", id: FLAECHE, action: "territory_area.merged" },
                    ),
                ],
            ],
            ["territory.restore_series", [gegenstand({ name: { before: "A", after: "B" } })]],
        ];
        for (const [operation, objects] of faelle) {
            const e = eintrag(operation, objects);
            expect(ruecknahmeFamilie(e), operation).toBe("territory");
            expect(art.ruecknahmeZiel?.(e, GEBIET), operation).toEqual({ familie: "territory", id: GEBIET });
        }
    });

    it("🔴 B8b: Anlegen, die Form und ein Zurückholen haben seither eine Adresse; ein Import-Etikett am falschen Namen nicht", () => {
        const art = createGebietVerlaufsArt();
        const form = eintrag("territory.update", [
            gegenstand(
                { geometry: { before: "a", after: "b" } },
                { kind: "territory_area", id: FLAECHE, action: "territory_area.reshaped" },
            ),
        ]);
        const angelegt = eintrag("territory.create", [gegenstand({}, { action: "territory.created" })]);
        const geholt = eintrag("territory.restore", [
            gegenstand({ active: { before: false, after: true } }, { action: "territory.restored" }),
        ]);
        const unbekannt = eintrag("territory.import", [gegenstand({ parent: { before: WEST, after: OST } })]);
        for (const e of [form, angelegt, geholt]) {
            expect(ruecknahmeFamilie(e), e.operation).toBe("territory");
            expect(art.ruecknahmeZiel?.(e, GEBIET), e.operation).toEqual({ familie: "territory", id: GEBIET });
        }
        expect(art.ruecknahmeZiel?.(unbekannt, GEBIET)).toBeUndefined();
    });

    it("🔴 B6g3: die Quellen des Gebiets haben in „Änderungen“ eine Adresse (Familie des Gebiets), in diesem Verlauf keine: dort ist ihr ↺ das je Quelle", () => {
        const quellen = eintrag("traeger.sources", [
            gegenstand(
                { quellen: { before: [], after: [] } },
                { action: "territory.sources_changed", revisionBefore: null, revisionAfter: null },
            ),
        ]);
        expect(ruecknahmeFamilie(quellen)).toBe("territory");
        expect(ruecknahmeZiel(quellen)).toEqual({ familie: "territory", id: GEBIET });
        expect(createGebietVerlaufsArt().ruecknahmeZiel?.(quellen, GEBIET)).toBeUndefined();
    });

    it("🔴 die Adresse des globalen Reiters „Änderungen“: das Gebiet im Eintrag, auch bei einer Operation über mehrere Gebiete das erste", () => {
        const gemeinsam = eintrag("territory.sammel", [
            gegenstand({ type: { before: "Baronie", after: "Junkertum" } }, { id: OST }),
            gegenstand({ type: { before: "Mark", after: "Junkertum" } }),
        ]);
        expect(ruecknahmeZiel(gemeinsam)).toEqual({ familie: "territory", id: OST });
    });

    it("🔴 T54 die Rückfrage vor ↺ an „Entfernen“ nennt die Folgen: was zurückkommt, wie die Untergebiete wieder hängen; sonst keine", () => {
        const mitglied = (
            operation: string,
            gegenstaende: MapHistoryObject[],
        ): RuecknahmePruefung["mitglieder"][number] => ({
            operationId: "op-alt",
            seq: 7,
            at: "2026-10-18T10:00:00.000Z",
            operation,
            source: "editor",
            actor: { kind: "person", name: "Thomas" },
            status: "ruecknehmbar",
            offen: true,
            gegenstaende: gegenstaende.map((g) => ({
                kind: g.kind,
                id: g.id,
                ...(g.name === undefined ? {} : { name: g.name }),
                action: g.action,
                revisionBefore: g.revisionBefore,
                revisionAfter: g.revisionAfter,
                felder: Object.keys(g.changes),
            })),
        });
        const pruefung = (operation: string, gegenstaende: MapHistoryObject[]) => ({
            offen: ["op-alt"],
            mitglieder: [mitglied(operation, gegenstaende)],
            folgen: { gegenstaende: gegenstaende.length, gelaende: "keines" as const },
        });
        const entfernt = pruefung("territory.retire", [
            gegenstand({ active: { before: true, after: false } }, { action: "territory.retired", name: "Baronie" }),
            gegenstand(
                { active: { before: true, after: false } },
                { id: "kind-1", action: "territory.retired", name: "Junkertum" },
            ),
            gegenstand({ parent: { before: GEBIET, after: OST } }, { id: "kind-2", name: "Lehen" }),
            gegenstand(
                { active: { before: true, after: false } },
                { kind: "territory_area", id: FLAECHE, action: "territory_area.retired" },
            ),
        ]);
        const zeilen = folgenZeilen(entfernt);
        expect(zeilen).toEqual(
            expect.arrayContaining([
                "Baronie, Junkertum: zurück in Karte und Baum.",
                "Sie hängen wieder wie vorher (1).",
                "Die Flächen (1) kommen zurück auf die Karte.",
                "Danach leitet der Auftrag neu ab; bis dahin zeigt die Karte den alten Stand.",
            ]),
        );
        const viele = pruefung(
            "territory.retire",
            Array.from({ length: 8 }, (_, i) =>
                gegenstand(
                    { active: { before: true, after: false } },
                    { id: `g${i}`, action: "territory.retired", name: `G${i}` },
                ),
            ),
        );
        expect(folgenZeilen(viele)).toContain("G0, G1, G2, G3, G4, G5 und 2 weitere: zurück in Karte und Baum.");
        // Eine Änderung der Felder hat keine solchen Folgen.
        expect(folgenZeilen(pruefung("territory.update", [gegenstand({ name: { before: "A", after: "B" } })]))).toEqual(
            [],
        );
    });

    it("die Herkunft der Detailfelder steht nicht als eigene Zeile da (gemeinsamer Verlauf, `herkunftsfelder`); `parentOrigin` bleibt", () => {
        const art = createGebietVerlaufsArt();
        expect(art.herkunftsfelder).toContain("ruler");
        expect(istHerkunftsfeld(art.herkunft, "rulerOrigin", art.herkunftsfelder)).toBe(true);
        expect(istHerkunftsfeld(art.herkunft, "parentOrigin", art.herkunftsfelder)).toBe(false);
    });

    it("zum Gebiet gehören es selbst und seine Flächen, kein Nachbar", () => {
        const art = createGebietVerlaufsArt();
        expect(art.gehoert(gegenstand({}), detail())).toBe(true);
        expect(art.gehoert(gegenstand({}, { kind: "territory_area", id: FLAECHE }), detail())).toBe(true);
        expect(art.gehoert(gegenstand({}, { id: OST }), detail())).toBe(false);
        expect(art.url(GEBIET)).toBe(`/api/editor/territories/${GEBIET}/history`);
    });
});
