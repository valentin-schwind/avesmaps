import { describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import type { MapHistoryEntry, MapHistoryPage, OperationReceipt } from "@avesmaps3d/shared";
import type { BearbeitungsLage, BearbeitungsZustand } from "../src/fenster/bearbeitung";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden";
import { createVerlauf, istHerkunftsfeld, wikiRuecknahme, type VerlaufsArt } from "../src/fenster/entwurf-verlauf";

/**
 * Der gemeinsame Verlauf (`fenster/entwurf-verlauf.ts`) mit einer erfundenen Art, ohne Server. Problemfälle: Der Verlauf liest schon,
 * bevor ihn jemand zeigt; er bleibt nach „Fertig“ auf dem alten Stand; ↺ schreibt mitten in einer Bearbeitung (T44); nach ↺ liest
 * die Bearbeitung nicht neu; eine Ablehnung verschwindet still; der Name an allen Abschnitten steht mehrfach da.
 */

interface Stand {
    readonly id: string;
    readonly name: string;
}
interface Koerper {
    readonly operationId: string;
    readonly reverts: string;
    readonly name: string;
}

const eintrag = (operationId: string, seq: number, gegenstaende: MapHistoryEntry["objects"]): MapHistoryEntry => ({
    operationId,
    seq,
    at: "2026-10-17T10:00:00.000Z",
    operation: "linie.update",
    source: "editor",
    actor: { kind: "person", name: "Thomas" },
    objects: gegenstaende,
});
const NAME = { name: { before: "Alt", after: "Neu" } };
const ERSTE = eintrag("e1", 7, [
    { kind: "powerline", id: "a", action: "x", revisionBefore: 1, revisionAfter: 2, changes: NAME },
    { kind: "powerline", id: "b", action: "x", revisionBefore: 4, revisionAfter: 5, changes: NAME },
    { kind: "powerline", id: "fremd", action: "x", revisionBefore: 1, revisionAfter: 2, changes: { curve: {} } },
]);
const ZWEITE = eintrag("e2", 3, [
    { kind: "powerline", id: "a", action: "x", revisionBefore: 0, revisionAfter: 1, changes: { curve: { after: 5 } } },
]);

function aufbau(
    seiten: MapHistoryPage[] = [{ entries: [ERSTE], next: 7 }, { entries: [ZWEITE] }],
    herkunft?: VerlaufsArt<Stand, Koerper>["herkunft"],
) {
    const urls: string[] = [];
    const fetcher = vi.fn(async (eingabe: string | URL | Request) => {
        urls.push(String(eingabe));
        const seite = seiten[Math.min(urls.length - 1, seiten.length - 1)]!;
        return new Response(JSON.stringify(seite), { status: 200 });
    });
    const gesendet: Koerper[] = [];
    let antwort: SchreibAntwort = {
        ok: true,
        quittung: { mapRevision: 99, warnings: [], affected: [] } as unknown as OperationReceipt,
    };
    const art: VerlaufsArt<Stand, Koerper> = {
        url: (id) => `/verlauf/${id}`,
        gehoert: (g) => g.id === "a" || g.id === "b",
        ruecknahme: (e, d, operationId) =>
            e.operationId === "e2"
                ? { art: "konflikt", felder: ["curve"] }
                : { art: "geht", body: { operationId, reverts: e.operationId, name: `${d.name}?` } },
        schreibe: vi.fn(async (_id: string, body: Koerper) => {
            gesendet.push(body);
            return antwort;
        }),
        feldFolge: ["name"],
        ...(herkunft === undefined ? {} : { herkunft }),
    };
    const bearbeitung = {
        detail: shallowRef<Stand | undefined>({ id: "a", name: "Neu" }),
        zustand: shallowRef<BearbeitungsZustand<Stand>>({ art: "bereit" }),
        lage: shallowRef<BearbeitungsLage>({
            aktiv: false,
            form: false,
            ungespeichert: 0,
            zurueck: false,
            wieder: false,
            frage: false,
        }),
        neuLesen: vi.fn(async () => undefined),
    };
    const zurueckgenommen = vi.fn();
    const verlauf = createVerlauf(art, {
        id: "a",
        bearbeitung,
        zurueckgenommen,
        fetcher,
        neueKennung: () => "op-neu",
    });
    return {
        verlauf,
        urls,
        gesendet,
        bearbeitung,
        zurueckgenommen,
        antworte: (a: SchreibAntwort) => (antwort = a),
    };
}

describe("Der gemeinsame Verlauf", () => {
    it("🔴 liest erst, wenn er gezeigt wird, seitenweise; nach „Fertig“ liest er neu", async () => {
        const w = aufbau();
        expect(w.urls).toEqual([]);
        await w.verlauf.lade();
        expect(w.urls).toEqual(["/verlauf/a"]);
        expect(w.verlauf.mehrDa.value).toBe(true);
        await w.verlauf.lade(true);
        expect(w.urls[1]).toBe("/verlauf/a?before=7");
        expect(w.verlauf.eintraege.value.map((e) => e.operationId)).toEqual(["e1", "e2"]);
        expect(w.verlauf.mehrDa.value).toBe(false);
        w.bearbeitung.zustand.value = { art: "gespeichert", revision: 3, befunde: [], mapRevision: 1 };
        await vi.waitFor(() => expect(w.urls).toHaveLength(3));
        expect(w.urls[2]).toBe("/verlauf/a");
    });

    it("die Felder der Gegenstände, die zum Objekt gehören, gleiche Wechsel einmal; Revision nur bei genau einem", async () => {
        const w = aufbau();
        await w.verlauf.lade();
        expect(w.verlauf.felder(ERSTE)).toEqual([{ feld: "name", vorher: "Alt", nachher: "Neu" }]);
        expect(w.verlauf.revision(ERSTE)).toBeUndefined();
        expect(w.verlauf.revision(ZWEITE)).toEqual({ vor: 0, nach: 1 });
    });

    it("🔴 ↺ nur ohne laufende Bearbeitung (T44); geschrieben liest die Bearbeitung neu, die Karte folgt, der Verlauf liest neu", async () => {
        const w = aufbau();
        await w.verlauf.lade();
        w.bearbeitung.lage.value = { ...w.bearbeitung.lage.value, aktiv: true, ungespeichert: 1 };
        expect(w.verlauf.gesperrt.value).toBe("bearbeitung");
        await w.verlauf.zuruecknehmen(ERSTE);
        expect(w.gesendet).toEqual([]);
        w.bearbeitung.lage.value = { ...w.bearbeitung.lage.value, aktiv: false, ungespeichert: 0 };
        expect(w.verlauf.gesperrt.value).toBeUndefined();
        expect(w.verlauf.ruecknahme(ZWEITE)).toEqual({ art: "konflikt", felder: ["curve"] });
        await w.verlauf.zuruecknehmen(ZWEITE);
        expect(w.gesendet).toEqual([]);
        await w.verlauf.zuruecknehmen(ERSTE);
        expect(w.gesendet).toEqual([{ operationId: "op-neu", reverts: "e1", name: "Neu?" }]);
        expect(w.bearbeitung.neuLesen).toHaveBeenCalledOnce();
        expect(w.zurueckgenommen).toHaveBeenCalledWith(99);
        expect(w.urls).toHaveLength(2);
    });

    it("🔴 eine Ablehnung steht am Eintrag, nichts liest neu", async () => {
        const w = aufbau();
        await w.verlauf.lade();
        w.antworte({ ok: false, status: 409, fehler: { code: "edit_conflict", message: "Jemand war schneller." } });
        await w.verlauf.zuruecknehmen(ERSTE);
        expect(w.verlauf.meldung.value).toEqual({ operationId: "e1", satz: "Jemand war schneller." });
        expect(w.bearbeitung.neuLesen).not.toHaveBeenCalled();
        expect(w.zurueckgenommen).not.toHaveBeenCalled();
    });
});

describe("Herkunft der Wiki-Felder im Verlauf (WI-0225)", () => {
    it("🔴 <feld>Origin eines Wiki-Felds ist kein eigenes Feld; andere …Origin bleiben; ↺ bringt einen Wiki-Wert als revert zurück", () => {
        expect(istHerkunftsfeld("powerline", "nameOrigin")).toBe(true);
        expect(istHerkunftsfeld("powerline", "descriptionOrigin")).toBe(true);
        expect(istHerkunftsfeld("territory", "parentOrigin")).toBe(false);
        expect(istHerkunftsfeld(undefined, "nameOrigin")).toBe(false);
        expect(istHerkunftsfeld("powerline", "name")).toBe(false);
        // Gebiete: Herkunft der Detailfelder an eigener Stelle, über `herkunftsfelder`; `parentOrigin` bleibt sichtbar.
        expect(istHerkunftsfeld("territory", "rulerOrigin", ["ruler", "capital_name"])).toBe(true);
        expect(istHerkunftsfeld("territory", "parentOrigin", ["ruler", "capital_name"])).toBe(false);
        expect(istHerkunftsfeld(undefined, "rulerOrigin", ["ruler"])).toBe(true);
        const changes = {
            name: { before: "Hexagramm", after: "Hexagramm Nord" },
            nameOrigin: { before: "wiki", after: "manual" },
            description: { before: "eigen", after: "anders" },
        };
        expect(wikiRuecknahme<string>(changes, "name")).toEqual({ revert: "wiki" });
        expect(wikiRuecknahme<string>(changes, "description")).toEqual({ value: "eigen" });
        expect(wikiRuecknahme<string>(changes, "subtype")).toBeUndefined();
    });

    it("🔴 mit `herkunft` zeigt der Verlauf `nameOrigin` nicht als eigene Zeile, ohne schon", () => {
        const mitHerkunft = eintrag("e3", 9, [
            {
                kind: "powerline",
                id: "a",
                action: "x",
                revisionBefore: 2,
                revisionAfter: 3,
                changes: { ...NAME, nameOrigin: { before: "wiki", after: "manual" } },
            },
        ]);
        expect(aufbau(undefined, "powerline").verlauf.felder(mitHerkunft)).toEqual([
            { feld: "name", vorher: "Alt", nachher: "Neu" },
        ]);
        expect(
            aufbau()
                .verlauf.felder(mitHerkunft)
                .map((f) => f.feld),
        ).toEqual(["name", "nameOrigin"]);
    });
});

describe("Der gemeinsame Verlauf: Änderungen an den Quellen (WI-0254 §12)", () => {
    const QUELLEN = eintrag("e9", 9, [
        {
            kind: "powerline",
            id: "a",
            action: "territory.sources_changed",
            revisionBefore: null,
            revisionAfter: null,
            changes: { quellen: { before: [], after: [] } },
        },
    ]);

    it("🔴 sie sind keine Felder des Objekts und werden nicht von der Rücknahme des Objekts zurückgenommen (die Quellen haben ihr eigenes ↺)", async () => {
        const w = aufbau([{ entries: [QUELLEN] }]);
        await w.verlauf.lade();
        expect(w.verlauf.felder(QUELLEN)).toEqual([]);
        expect(w.verlauf.ruecknahme(QUELLEN)).toEqual({ art: "nicht" });
        await w.verlauf.zuruecknehmen(QUELLEN);
        expect(w.gesendet).toEqual([]);
    });
});
