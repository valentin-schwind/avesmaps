import { describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import type { EditorPlaceDetail, MapHistoryEntry, MapHistoryPage, MapHistorySeries } from "@avesmaps3d/shared";
import { gruppiere } from "../src/aenderungen/aenderung-modell";
import { angebotEinzeln, angebotSerie } from "../src/aenderungen/aenderung-ruecknahme";
import type { BearbeitungsZustand, OrtBearbeitung } from "../src/ortseditor/ort-bearbeitung";
import { createOrtVerlauf } from "../src/ortseditor/ort-verlauf";
import { verlaufFelderMit } from "../src/ortseditor/ortseditor-texte";

/**
 * Der Verlauf eines Orts auf dem gemeinsamen Verlauf (WI-0128 E17; WI-0265 B6d). ↺ nimmt der Server zurück (`aenderung-ruecknahme.test.ts`: Adresse, Angebot, Ablauf; die Vorprüfung des Servers
 * prüft Konflikte und Sperren): Der Client spielt keinen Eintrag selbst zurück, darum prüft diese Datei, was der Verlauf ANZEIGT und wann er ein ↺ anbietet.
 *
 * Problemfälle: Die Herkunft eines Texts steht als eigene Zeile da; die Liste der Stätten steht als rohe Zahlenliste im Verlauf; ein Ort ohne Schreibrecht hat gar keinen Verlauf (der gemeinsame
 * Verlauf liest die Felder über den Stand der Bearbeitung); ↺ wird am Ort eines anderen Fensters angeboten; ein Verschieben auf der Karte lässt den Verlauf auf dem alten Stand; ↺ geht mitten in einem
 * ungespeicherten Entwurf (T44 verlangt: erst, wenn keine Bearbeitung läuft); die Serie hat ihr ↺ nicht am neuesten Mitglied.
 */
const ORT = "e17e17e1-0000-4000-8000-000000000001";
const ANDERER = "e17e17e1-0000-4000-8000-000000000002";

const eintrag = (
    operationId: string,
    objekte: MapHistoryEntry["objects"],
    ueber: Partial<MapHistoryEntry> = {},
): MapHistoryEntry => ({
    operationId,
    seq: 42,
    at: "2026-10-11T12:00:00.000Z",
    operation: "place.update",
    source: "editor",
    actor: { kind: "person", name: "Rondrikan", self: true },
    objects: objekte,
    ...ueber,
});

const geaendert = (
    changes: Record<string, { before?: unknown; after?: unknown }>,
    operationId = "00000000-0000-4000-8000-000000000042",
    id = ORT,
    ueber: Partial<MapHistoryEntry> = {},
) =>
    eintrag(
        operationId,
        [{ kind: "place", id, action: "place.updated", revisionBefore: 8, revisionAfter: 9, changes }],
        ueber,
    );

/** Die Bearbeitung des Orts, soweit der Verlauf sie braucht: Stand, Zustand, ungespeichert, Neu-Lesen. */
/** `revision` null: Der Ort ist noch nicht gelesen. */
function bearbeitungMit(id = ORT, revision: number | null = 9) {
    const detail = shallowRef<EditorPlaceDetail | undefined>(
        revision === null ? undefined : ({ publicId: id, revision } as EditorPlaceDetail),
    );
    const zustand = shallowRef<BearbeitungsZustand>({ art: "bereit" });
    const ungespeichert = shallowRef(false);
    const nachVerschieben = vi.fn(async () => undefined);
    return {
        detail,
        zustand,
        ungespeichert,
        nachVerschieben,
        bearbeitung: { detail, zustand, ungespeichert, nachVerschieben } as unknown as OrtBearbeitung,
    };
}

/** Der Verlauf mit gestelltem Server; `bearbeitung` ist die des Fensters (oder keine: Ort ohne Schreibrecht). */
function aufbau(seiten: MapHistoryPage[], bearbeitung?: ReturnType<typeof bearbeitungMit>) {
    const urls: string[] = [];
    const fetcher = vi.fn(async (eingabe: string | URL | Request) => {
        urls.push(String(eingabe));
        return new Response(JSON.stringify(seiten[Math.min(urls.length - 1, seiten.length - 1)]), { status: 200 });
    });
    const zurueckgenommen = vi.fn();
    const verlauf = createOrtVerlauf(ORT, () => bearbeitung?.bearbeitung, { fetcher, zurueckgenommen });
    return { verlauf, urls, zurueckgenommen };
}

describe("Verlauf: was ein Eintrag zeigt", () => {
    it("die Felder eines Eintrags in der Folge des Formulars, ohne Herkunftsfelder und ohne die Liste der Stätten", async () => {
        const e = geaendert({
            hidden: { before: false, after: true },
            name: { before: "Alt", after: "Neu" },
            nameOrigin: { before: "wiki", after: "manual" },
            einwohnerOrigin: { before: "wiki", after: "manual" },
            staetten: { before: [280], after: [] },
            position: { before: [1, 2], after: [3, 4] },
        });
        const { verlauf } = aufbau([{ entries: [e] }], bearbeitungMit());
        await verlauf.lade();
        expect(verlauf.felder(e).map((feld) => feld.feld)).toEqual(["name", "position", "hidden"]);
    });

    it("🔴 auch ein Ort ohne Schreibrecht (keine Bearbeitung) zeigt Felder und Revision, nur ohne ↺", async () => {
        const e = geaendert({ hidden: { before: false, after: true } });
        const { verlauf } = aufbau([{ entries: [e] }]);
        await verlauf.lade();
        expect(verlauf.felder(e)).toEqual([{ feld: "hidden", vorher: false, nachher: true }]);
        expect(verlauf.revision(e)).toEqual({ vor: 8, nach: 9 });
        expect(verlauf.ruecknahmeZiel(e)).toBeUndefined();
    });

    it("Gegenstände anderer Orte und die Wegenden, die ein Verschieben mitnahm, sind keine Felder dieses Orts", async () => {
        const e = eintrag(
            "00000000-0000-4000-8000-000000000043",
            [
                {
                    kind: "place",
                    id: ORT,
                    action: "place.moved",
                    revisionBefore: 8,
                    revisionAfter: 9,
                    changes: { position: { before: [1, 2], after: [3, 4] } },
                },
                {
                    kind: "path",
                    id: ANDERER,
                    action: "path.endpoint_moved",
                    revisionBefore: 1,
                    revisionAfter: 2,
                    changes: { geometry: { before: [[1, 2]], after: [[3, 4]] } },
                },
            ],
            { operation: "place.move" },
        );
        const { verlauf } = aufbau([{ entries: [e] }], bearbeitungMit());
        await verlauf.lade();
        expect(verlauf.felder(e).map((feld) => feld.feld)).toEqual(["position"]);
        expect(verlauf.gegenstaende(e).map((g) => g.id)).toEqual([ORT]);
    });
});

describe("Verlauf: Änderungen an den Quellen des Orts (WI-0254 §12)", () => {
    const quellen = eintrag(
        "00000000-0000-4000-8000-000000000044",
        [
            {
                kind: "place",
                id: ORT,
                action: "place.sources_changed",
                revisionBefore: null,
                revisionAfter: null,
                changes: { quellen: { before: [], after: [] } },
            },
        ],
        { operation: "traeger.sources" },
    );

    it("🔴 sie stehen nicht als Feld „quellen“ mit rohen Listen da und haben kein ↺ des Orts", async () => {
        const { verlauf } = aufbau([{ entries: [quellen] }], bearbeitungMit());
        await verlauf.lade();
        expect(verlauf.felder(quellen)).toEqual([]);
        expect(verlauf.ruecknahme(quellen)).toEqual({ art: "nicht" });
        expect(verlauf.ruecknahmeZiel(quellen)).toBeUndefined();
    });
});

describe("Verlauf: ↺ über den Server", () => {
    const felder = geaendert({ hidden: { before: false, after: true } });
    const verschoben = eintrag(
        "00000000-0000-4000-8000-000000000045",
        [
            {
                kind: "place",
                id: ORT,
                action: "place.moved",
                revisionBefore: 9,
                revisionAfter: 10,
                changes: { position: { before: [1, 2], after: [3, 4] } },
            },
        ],
        { operation: "place.move" },
    );

    it("die Adresse ist der Ort des Verlaufs, sobald seine Bearbeitung ihn gelesen hat", async () => {
        const b = bearbeitungMit(ORT, null);
        const { verlauf } = aufbau([{ entries: [felder] }], b);
        await verlauf.lade();
        expect(verlauf.ruecknahmeZiel(felder)).toBeUndefined();
        b.detail.value = { publicId: ORT, revision: 9 } as EditorPlaceDetail;
        expect(verlauf.ruecknahmeZiel(felder)).toEqual({ familie: "place", id: ORT });
        expect(verlauf.ruecknahmeZiel(verschoben)).toEqual({ familie: "place", id: ORT });
    });

    it("🔴 eine Operation, die einen anderen Ort betrifft, bekommt hier kein ↺ (Mehrfachlöschen, Verwechslung der Fenster)", async () => {
        const fremd = geaendert(
            { hidden: { before: false, after: true } },
            "00000000-0000-4000-8000-000000000046",
            ANDERER,
        );
        const { verlauf } = aufbau([{ entries: [fremd] }], bearbeitungMit());
        await verlauf.lade();
        expect(verlauf.ruecknahmeZiel(fremd)).toBeUndefined();
    });

    it("🔴 die Bearbeitung eines anderen Orts im selben Fenster gilt nicht: weder Revision noch ↺", async () => {
        const { verlauf } = aufbau([{ entries: [felder] }], bearbeitungMit(ANDERER));
        await verlauf.lade();
        expect(verlauf.ruecknahmeZiel(felder)).toBeUndefined();
    });

    it("T44: ein ungespeicherter Entwurf, ein Speichern und ein Konflikt sperren ↺ mit Grund; danach geht es wieder", async () => {
        const b = bearbeitungMit();
        const { verlauf } = aufbau([{ entries: [felder] }], b);
        expect(verlauf.gesperrt.value).toBeUndefined();
        b.ungespeichert.value = true;
        expect(verlauf.gesperrt.value).toBe("bearbeitung");
        b.ungespeichert.value = false;
        b.zustand.value = { art: "speichert" };
        expect(verlauf.gesperrt.value).toBe("bearbeitung");
        b.zustand.value = { art: "konflikt" } as BearbeitungsZustand;
        expect(verlauf.gesperrt.value).toBe("bearbeitung");
        b.zustand.value = { art: "bereit" };
        expect(verlauf.gesperrt.value).toBeUndefined();
    });

    it("🔴 nach ↺ liest der Ort sich neu (ohne den Entwurf zu verlieren), die Karte folgt, der Verlauf liest neu", async () => {
        const b = bearbeitungMit();
        const { verlauf, urls, zurueckgenommen } = aufbau([{ entries: [felder] }], b);
        await verlauf.lade();
        await verlauf.nachRuecknahme({ mapRevision: 12 });
        expect(zurueckgenommen).toHaveBeenCalledWith(12);
        expect(b.nachVerschieben).toHaveBeenCalledTimes(1);
        expect(urls).toHaveLength(2);
    });

    it("eine Serie von Feldern hat ihr ↺ am neuesten Mitglied, mit der Adresse des Orts", async () => {
        const mitglied = (id: string, seq: number, position: number): MapHistoryEntry =>
            geaendert({ hidden: { before: seq % 2 === 0, after: seq % 2 !== 0 } }, id, ORT, {
                seq,
                status: "ruecknehmbar",
                series: { id: "s1", position, size: 2 },
            });
        const aelter = mitglied("00000000-0000-4000-8000-0000000000a1", 7, 1);
        const neuer = mitglied("00000000-0000-4000-8000-0000000000a2", 8, 2);
        const serie: MapHistorySeries = {
            id: "s1",
            size: 2,
            delivered: 2,
            members: [aelter.operationId, neuer.operationId],
            membersHash: "f".repeat(64),
            scope: { kind: "place", id: ORT, name: "Gratenfels" },
        };
        const { verlauf } = aufbau([{ entries: [neuer, aelter], series: [serie] }], bearbeitungMit());
        await verlauf.lade();
        const zeilen = gruppiere(verlauf.eintraege.value, new Map(verlauf.serien.value.map((s) => [s.id, s])));
        expect(zeilen).toHaveLength(1);
        const zeile = zeilen[0]!;
        if (zeile.art !== "serie") throw new Error("eine Serie erwartet");
        expect(zeile.mitglieder.map((m) => m.operationId)).toEqual([neuer.operationId, aelter.operationId]);
        const angebot = angebotSerie(zeile, verlauf.ruecknahmeZiel(zeile.mitglieder[0]!));
        expect(angebot).toMatchObject({
            modus: "serie",
            ziel: { familie: "place", id: ORT },
            mitglieder: serie.members,
            offen: 2,
        });
        // Einzeln nur das letzte offene Mitglied: das ältere ist überholt.
        expect(angebotEinzeln(aelter, verlauf.ruecknahmeZiel(aelter), zeile.mitglieder)?.sperre).toEqual({
            art: "ueberholt",
            position: 2,
        });
        expect(angebotEinzeln(neuer, verlauf.ruecknahmeZiel(neuer), zeile.mitglieder)?.sperre).toBeUndefined();
    });
});

describe("Verlauf: bleibt auf dem Stand des Orts", () => {
    const e = geaendert({ hidden: { before: false, after: true } });

    it("🔴 liest erst, wenn er gezeigt wird; ein Verschieben auf der Karte (neue Revision) lässt ihn neu lesen", async () => {
        const b = bearbeitungMit();
        const { verlauf, urls } = aufbau([{ entries: [e] }], b);
        b.detail.value = { publicId: ORT, revision: 10 } as EditorPlaceDetail;
        await Promise.resolve();
        expect(urls).toEqual([]);
        await verlauf.lade();
        expect(urls).toHaveLength(1);
        b.detail.value = { publicId: ORT, revision: 11 } as EditorPlaceDetail;
        await vi.waitFor(() => expect(urls).toHaveLength(2));
        expect(urls[1]).toBe(`/api/editor/places/${ORT}/history`);
    });

    it("🔴 dass die Bearbeitung den Ort erst liest (vorher keine Revision), ist kein neuer Stand: kein zweites Lesen mitten im Laden", async () => {
        const b = bearbeitungMit(ORT, null);
        const { verlauf, urls } = aufbau([{ entries: [e] }], b);
        const laden = verlauf.lade();
        b.detail.value = { publicId: ORT, revision: 9 } as EditorPlaceDetail;
        await laden;
        await Promise.resolve();
        expect(urls).toHaveLength(1);
        expect(verlauf.eintraege.value).toHaveLength(1);
    });

    it("nach „Fertig“ (Zustand gespeichert) steht der neue Eintrag oben", async () => {
        const b = bearbeitungMit();
        const { verlauf, urls } = aufbau([{ entries: [e] }], b);
        await verlauf.lade();
        b.zustand.value = { art: "gespeichert", revision: 10, befunde: [] };
        await vi.waitFor(() => expect(urls).toHaveLength(2));
    });

    it("ältere Einträge kommen seitenweise", async () => {
        const { verlauf, urls } = aufbau([
            { entries: [e], next: 41 },
            { entries: [geaendert({ ruined: { after: true } }, "00000000-0000-4000-8000-000000000047")] },
        ]);
        await verlauf.lade();
        expect(verlauf.mehrDa.value).toBe(true);
        await verlauf.lade(true);
        expect(urls[1]).toBe(`/api/editor/places/${ORT}/history?before=41`);
        expect(verlauf.eintraege.value).toHaveLength(2);
        expect(verlauf.mehrDa.value).toBe(false);
    });
});

describe("„Änderungen“: die Suche kennt die angezeigten Namen der Felder", () => {
    it("ein Teil des Namens, ohne Groß und Klein, findet den Schlüssel; leer findet nichts", () => {
        expect(verlaufFelderMit("verb")).toEqual(["hidden"]);
        // „Lage“ steckt auch in „Ungefähre Lage“ (WI-0267).
        expect(verlaufFelderMit("  LAGE ")).toEqual(["approximate", "lage"]);
        expect(verlaufFelderMit("")).toEqual([]);
        expect(verlaufFelderMit("gibt-es-nicht")).toEqual([]);
    });
});
