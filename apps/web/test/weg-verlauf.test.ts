import { describe, expect, it } from "vitest";
import type { EditorPathStreet, MapHistoryEntry, MapHistoryObject } from "@avesmaps3d/shared";
import { createWegVerlaufsArt } from "../src/wegeditor/weg-verlauf";

/**
 * Der Verlauf der Straße (WI-0177, EDIT-0003 T54; seit WI-0265 B6a und B6a2 nimmt der Server ALLES zurück, was am Weg zurückgeht). Problemfälle: Der Anschluss spielt etwas selbst zurück,
 * obwohl der Server es als EINE Operation tut (zwei Rücknahmen für ein ↺); ↺ unter dem Anker trifft einen Abschnitt, den die Operation gar nicht berührte; „Auswahl zu neuem Weg“ und
 * „Wege verbinden“ zeigen im Reiter und im Wegverlauf nicht dasselbe ↺; ein Client-↺ aus dem Altbestand wird noch einmal zurückgenommen; die Quellen der Straße werden als Felder zurückgenommen.
 * Seit B8a (Anlegen, Teilen) und B8a2 (Rücknahme von „Auswahl zu neuem Weg“ und „Wege verbinden“, in beide Richtungen) hat auch das ein ↺; der Katalog des Servers steht in `ruecknahme-arten.ts`,
 * sein Spiegel in `aenderungen/aenderung-ruecknahme.ts` (`wegArt`).
 * Die Rücknahmen des Servers prüfen `ruecknahme-weg.test.ts` (Server, Wegwerf-Cluster) und `aenderung-ruecknahme.test.ts` (Adresse, Angebot, Rückfrage).
 */

const A = "0b0b0b0b-0000-4000-8000-0000000000a1";
const B = "0b0b0b0b-0000-4000-8000-0000000000a2";
const C = "0b0b0b0b-0000-4000-8000-0000000000a3";

const strasse = (zusatz: Partial<EditorPathStreet> = {}): EditorPathStreet => ({
    id: A,
    name: "Halwartsstieg",
    subtype: "Strasse",
    isBach: false,
    circle: "halb-rechts",
    labelVisible: true,
    segments: [
        { id: A, revision: 4, labelVisible: true, wiki: false, points: 4 },
        { id: B, revision: 6, labelVisible: true, wiki: false, points: 3 },
    ],
    ...zusatz,
});

const gegenstand = (id: string, action: string, changes: MapHistoryObject["changes"] = {}): MapHistoryObject => ({
    kind: "path",
    id,
    action,
    revisionBefore: 1,
    revisionAfter: 2,
    changes,
});

const eintrag = (operation: string, objects: MapHistoryObject[], source: MapHistoryEntry["source"] = "editor") =>
    ({
        operationId: "11111111-1111-4111-8111-111111111111",
        seq: 9,
        at: "2026-10-18T08:00:00.000Z",
        operation,
        source,
        actor: { kind: "person", name: "Rondrikan" },
        objects,
    }) as MapHistoryEntry;

const geloescht = eintrag("path.delete", [
    gegenstand(A, "path.deleted", { active: { before: true, after: false } }),
    gegenstand(B, "path.deleted", { active: { before: true, after: false } }),
]);
const umbenannt = eintrag("path.update", [
    gegenstand(A, "path.updated", { name: { before: "Alter Stieg", after: "Halwartsstieg" } }),
    gegenstand(B, "path.updated", { name: { before: "Alter Stieg", after: "Halwartsstieg" } }),
]);
const kurve = eintrag("path.update", [
    gegenstand(A, "path.reshaped", { geometry: { before: [[0, 0]], after: [[1, 1]] } }),
]);
const umgruppiert = eintrag("path.regroup", [
    gegenstand(A, "path.regrouped", { name: { before: "Alt", after: "Halwartsstieg" } }),
    gegenstand(B, "path.regrouped", { name: { before: "Alt", after: "Halwartsstieg" } }),
]);
const verbunden = eintrag("path.join", [
    gegenstand(A, "path.joined", { geometry: { before: [], after: [] } }),
    gegenstand(B, "path.joined", { active: { before: true, after: false } }),
]);

describe("Verlauf der Straße (T54), nach B6a2", () => {
    it("🔴 dieser Anschluss spielt nichts mehr selbst zurück: Der Server nimmt Felder, Kurve, Stand, Umgruppieren und Verbinden in EINER Operation zurück", () => {
        const art = createWegVerlaufsArt();
        const angelegt = eintrag("path.create", [gegenstand(A, "path.created")]);
        const geteilt = eintrag("path.split", [gegenstand(A, "path.split"), gegenstand(B, "path.created")]);
        for (const e of [geloescht, umbenannt, kurve, umgruppiert, verbunden, angelegt, geteilt])
            expect(art.ruecknahme(e, strasse(), "op")).toEqual({ art: "nicht" });
    });

    it("🔴 die Adresse der Server-Rücknahme: ein Abschnitt, den die Operation berührte; Anlegen und Teilen haben seit B8a auch eine, Umgruppieren und Verbinden dieselbe wie im Reiter", () => {
        const art = createWegVerlaufsArt();
        expect(art.ruecknahmeZiel?.(geloescht, A)).toEqual({ familie: "path", id: A });
        expect(art.ruecknahmeZiel?.(umbenannt, A)).toEqual({ familie: "path", id: A });
        expect(art.ruecknahmeZiel?.(kurve, A)).toEqual({ familie: "path", id: A });
        expect(art.ruecknahmeZiel?.(umgruppiert, A)).toEqual({ familie: "path", id: A });
        expect(art.ruecknahmeZiel?.(verbunden, A)).toEqual({ familie: "path", id: A });
        // Eine Operation, die nur den zweiten Abschnitt berührte (etwa ein Tunnel), hängt an ihm - nicht am Anker der Straße.
        const tunnel = eintrag("path.update", [
            gegenstand(B, "path.updated", { tunnel: { before: false, after: true } }),
        ]);
        expect(art.ruecknahmeZiel?.(tunnel, A)).toEqual({ familie: "path", id: B });
        // Anlegen (B8a): der angelegte Abschnitt. Teilen (B8a): der vordere Teil (`path.split`, behält die Kennung) und der hintere (`path.created`); die Adresse ist der erste Abschnitt der Operation.
        expect(art.ruecknahmeZiel?.(eintrag("path.create", [gegenstand(A, "path.created")]), A)).toEqual({
            familie: "path",
            id: A,
        });
        const geteilt = eintrag("path.split", [gegenstand(A, "path.split"), gegenstand(B, "path.created")]);
        expect(art.ruecknahmeZiel?.(geteilt, A)).toEqual({ familie: "path", id: A });
        // Ein Teilen ohne den angelegten hinteren Teil ist keine Art, die der Server kennt: kein ↺ (lieber keins als eins, das ablehnt).
        expect(art.ruecknahmeZiel?.(eintrag("path.split", [gegenstand(A, "path.split")]), A)).toBeUndefined();
    });

    it("🔴 eine Umgruppierung oder Verbindung, die selbst ein Client-↺ war (Altbestand: Operation `path.regroup`/`path.join` mit Quelle restore, vor dem Server-↺), hat kein ↺", () => {
        const art = createWegVerlaufsArt();
        const altGruppe = eintrag("path.regroup", [gegenstand(A, "path.regrouped")], "restore");
        const altVerbinden = eintrag("path.join", [gegenstand(A, "path.joined")], "restore");
        for (const e of [altGruppe, altVerbinden])
            expect(art.ruecknahmeZiel?.(e, A), e.operation + e.source).toBeUndefined();
    });

    it("🔴 die Rücknahme des Servers (`path.restore_series`) von „Auswahl zu neuem Weg“, „Wege verbinden“ und Teilen ist seit B8a2 selbst zurücknehmbar, in beide Richtungen: die Richtung steht im Namen der Aktion", () => {
        const art = createWegVerlaufsArt();
        const rueck = (aktion: string, abschnitte = [A, B]) =>
            eintrag(
                "path.restore_series",
                abschnitte.map((id) => gegenstand(id, aktion)),
                "restore",
            );
        const richtungen = {
            entgruppiert: rueck("path.regrouped"),
            neugruppiert: rueck("path.regrouped_again"),
            getrennt: rueck("path.joined"),
            zusammen: rueck("path.merged"),
        };
        for (const [richtung, e] of Object.entries(richtungen))
            expect(art.ruecknahmeZiel?.(e, A), richtung).toEqual({ familie: "path", id: A });
        // Die Rücknahme von „Wege verbinden“ trennt mindestens zwei Abschnitte, das Zusammenlegen legt mindestens zwei zusammen; mit nur EINEM gibt es sie nicht (wie im Server).
        for (const aktion of ["path.joined", "path.merged"])
            expect(art.ruecknahmeZiel?.(rueck(aktion, [A]), A), aktion).toBeUndefined();
        // Das Teilen als Rücknahme des Zusammenlegens (`path.merged`): vorderer Teil und angelegter hinterer Teil.
        const wiederGeteilt = eintrag(
            "path.restore_series",
            [gegenstand(A, "path.split"), gegenstand(B, "path.created")],
            "restore",
        );
        expect(art.ruecknahmeZiel?.(wiederGeteilt, A)).toEqual({ familie: "path", id: A });
    });

    it("die Quellen der Straße (path.sources_changed an EINEM Abschnitt, WI-0254 §12) gehören zum Verlauf der Straße, sind aber keine Felder: ihr ↺ ist das der Quellen, dieser Verlauf nimmt sie nie zurück", () => {
        const quellen = eintrag("traeger.sources", [
            gegenstand(A, "path.sources_changed", { quellen: { before: [], after: [] } }),
        ]);
        const art = createWegVerlaufsArt();
        // Der Anker oder ein anderer Abschnitt: jeder gehört zur Straße; ein fremder Weg nicht.
        expect(art.gehoert(quellen.objects[0]!, strasse())).toBe(true);
        expect(art.gehoert(gegenstand(B, "path.sources_changed"), strasse())).toBe(true);
        expect(art.gehoert(gegenstand(C, "path.sources_changed"), strasse())).toBe(false);
        expect(art.ruecknahme(quellen, strasse(), "op")).toEqual({ art: "nicht" });
        expect(art.ruecknahmeZiel?.(quellen, A)).toBeUndefined();
        expect(art.url(A)).toBe(`/api/editor/paths/${A}/history`);
        expect(art.herkunft).toBe("path");
    });
});
