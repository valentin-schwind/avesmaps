import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpracheEditorDetail } from "@avesmaps3d/shared";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { meldeSprachen, sprachMeldung } from "../src/spracheditor/sprache-melde";
import { createSpracheditorSteuerung } from "../src/spracheditor/spracheditor-steuerung";
import type { SprachenDaten } from "../src/spracheditor/sprachen-daten";

/**
 * Sprachen, die der Reiter „Änderungen“ zurücknimmt (WI-0265 B6e): Ein offenes Sprachfenster hält die Revision vom letzten Lesen. Problemfälle: Das Fenster zeigt nach dem ↺ den alten
 * Stand und schreibt mit einer veralteten Revision (409 beim nächsten „Fertig“); sein Verlauf nennt die Rücknahme nicht; die Kacheln der Karte ziehen nicht nach; ein Fenster, das die
 * Rücknahme nicht berührt, liest unnötig neu; ein Fenster mit laufender Bearbeitung verliert sein Ungeschriebenes; eine Teilfläche, die dort als „zurückholbar“ stand, steht nach der
 * Rücknahme noch da und holte mit einer veralteten Revision zurück.
 */

const GARETHI = "5d2c0000-0000-4000-8000-000000000001";
const BOSPARANO = "5d2c0000-0000-4000-8000-000000000002";
const TEIL = "5d2c0000-0000-4000-8000-0000000000f1";
const ORT = "0a0a0a0a-0000-4000-8000-000000000001";

const detail = (id: string, revision: number): SpracheEditorDetail => ({
    id,
    schluessel: id === GARETHI ? "garethi" : "bosparano",
    name: id === GARETHI ? "Garethi" : "Bosparano",
    legende: null,
    farbe: "#ffb901",
    reihenfolge: 1,
    herkunft: "sprachenkarte",
    revision,
    aktiv: true,
    flaeche: 0,
    wiki: [],
    teilflaechen: [],
    treffer: { orte: 0, gebiete: 0, regionen: 0, wege: 0, berechnetAt: null, ausstehend: false },
    ueberlappungen: [],
    sperre: null,
});

const ruhe = () => new Promise((r) => setTimeout(r, 0));
const warte = async () => {
    for (let i = 0; i < 6; i += 1) await ruhe();
};

function aufbau() {
    const stand = { [GARETHI]: 3, [BOSPARANO]: 8 } as Record<string, number>;
    /** Die Sprachen, die der Server nicht mehr kennt (still gelegt durch die Rücknahme ihrer Anlage): `null`. */
    const weg = new Set<string>();
    const zaehler = {
        liste: 0,
        sprache: { [GARETHI]: 0, [BOSPARANO]: 0 } as Record<string, number>,
        verlauf: { [GARETHI]: 0, [BOSPARANO]: 0 } as Record<string, number>,
    };
    const daten = {
        liste: vi.fn(async () => {
            zaehler.liste += 1;
            return { zeilen: [] };
        }),
        sprache: vi.fn(async (id: string) => {
            zaehler.sprache[id] = (zaehler.sprache[id] ?? 0) + 1;
            return weg.has(id) ? null : detail(id, stand[id]!);
        }),
        stilllegen: vi.fn(),
        flaecheStilllegen: vi.fn(async () => ({
            ok: true as const,
            quittung: {
                operationId: "op",
                status: "applied",
                environment: "development",
                affected: [{ kind: "sprache_flaeche", id: TEIL, revision: 4 }],
                derivedWork: [],
                warnings: [],
                mapRevision: 11,
            },
        })),
    } as unknown as SprachenDaten;
    // Der Verlauf liest über den globalen `fetch`.
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            const treffer = /\/api\/editor\/sprachen\/([^/]+)\/history/.exec(String(url));
            if (treffer === null) return new Response("{}", { status: 404 });
            zaehler.verlauf[treffer[1]!] = (zaehler.verlauf[treffer[1]!] ?? 0) + 1;
            return new Response(JSON.stringify({ entries: [], series: [] }));
        }),
    );
    const geaendert = vi.fn();
    const steuerung = createSpracheditorSteuerung(createWerkzeugfenster(undefined), daten, undefined, {
        sperre: {
            unter: vi.fn(async (_id: string, schreibe: () => Promise<unknown>) => schreibe()),
            haelt: () => false,
            halter: () => ({
                nimm: vi.fn(async () => ({ art: "genommen" as const, sperre: {} as never })),
                gib: vi.fn(),
                beiVerlust: () => () => undefined,
                liste: async () => [],
            }),
        } as never,
        lauf: "lauf",
        geaendert,
        darfSchreiben: () => true,
    } as never);
    return { steuerung, stand, zaehler, geaendert, weg };
}

afterEach(() => {
    vi.unstubAllGlobals();
    sprachMeldung.value = undefined;
});

describe("Meldung nach einer Rücknahme: was gemeldet wird", () => {
    it("🔴 Sprachen und ihre Teilflächen werden gemeldet, Orte und Flächen der Derographie nicht; ohne etwas davon entsteht keine Meldung", () => {
        meldeSprachen(
            [
                { kind: "place", id: ORT },
                { kind: "sprache", id: GARETHI },
                { kind: "sprache_flaeche", id: TEIL },
                { kind: "landscape", id: ORT },
            ],
            4711,
        );
        const meldung = sprachMeldung.value;
        expect(meldung?.sprachen).toEqual([GARETHI]);
        expect(meldung?.flaechen).toEqual([TEIL]);
        expect(meldung?.mapRevision).toBe(4711);

        meldeSprachen(
            [
                { kind: "place", id: ORT },
                { kind: "landscape", id: ORT },
            ],
            4712,
        );
        expect(sprachMeldung.value).toBe(meldung);
    });
});

describe("B8c: angelegte und still gelegte Sprachen werden gemeldet", () => {
    it("🔴 die Rücknahme einer Anlage nennt Sprache und Teilfläche (still gelegt oder belebt): beide erreichen die Meldung, die Fläche der Derographie, aus der kopiert wurde, nicht", () => {
        meldeSprachen(
            [
                { kind: "sprache", id: GARETHI },
                { kind: "sprache_flaeche", id: TEIL },
            ],
            8300,
        );
        expect(sprachMeldung.value).toMatchObject({ sprachen: [GARETHI], flaechen: [TEIL], mapRevision: 8300 });
    });

    it("🔴 eine Sprache, deren Anlage zurückgenommen wurde, liest das offene Fenster neu: Es sagt „fehlt“ statt mit einer veralteten Revision zu schreiben; die Liste liest neu", async () => {
        const { steuerung, zaehler, weg } = aufbau();
        steuerung.oeffneFuer(BOSPARANO);
        await warte();
        const bearbeitung = steuerung.bearbeitungVon(BOSPARANO)!;
        expect(bearbeitung.zustand.value.art).toBe("bereit");
        const vorher = { liste: zaehler.liste, sprache: zaehler.sprache[BOSPARANO]! };

        weg.add(BOSPARANO);
        meldeSprachen([{ kind: "sprache", id: BOSPARANO }], 8301);
        await warte();

        expect(zaehler.liste).toBe(vorher.liste + 1);
        expect(zaehler.sprache[BOSPARANO]).toBe(vorher.sprache + 1);
        expect(bearbeitung.zustand.value.art).toBe("fehlt");
        steuerung.destroy();
    });
});

describe("Sprachfenster nach einer Rücknahme im Reiter „Änderungen“", () => {
    it("🔴 die Kacheln ziehen mit der Revision der Rücknahme nach, Liste, Sprache und Verlauf lesen neu, die Bearbeitung hat die neue Revision", async () => {
        const { steuerung, stand, zaehler, geaendert } = aufbau();
        steuerung.oeffneFuer(GARETHI);
        await warte();
        const bearbeitung = steuerung.bearbeitungVon(GARETHI)!;
        expect(bearbeitung.detail.value?.revision).toBe(3);
        void steuerung.verlaufVon(GARETHI)?.lade();
        await warte();
        const vorher = { liste: zaehler.liste, sprache: zaehler.sprache[GARETHI]!, verlauf: zaehler.verlauf[GARETHI]! };

        stand[GARETHI] = 4;
        meldeSprachen([{ kind: "sprache", id: GARETHI }], 4711);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(4711);
        expect(zaehler.liste).toBe(vorher.liste + 1);
        expect(zaehler.sprache[GARETHI]).toBe(vorher.sprache + 1);
        expect(zaehler.verlauf[GARETHI]).toBe(vorher.verlauf + 1);
        expect(steuerung.bearbeitungVon(GARETHI)).toBe(bearbeitung);
        expect(bearbeitung.detail.value?.revision).toBe(4);
        steuerung.destroy();
    });

    it("🔴 ein Fenster, das die Rücknahme nicht berührt, liest nicht neu; die Kacheln ziehen trotzdem nach", async () => {
        const { steuerung, zaehler, geaendert } = aufbau();
        steuerung.oeffneFuer(GARETHI);
        await warte();
        steuerung.oeffneFuer(BOSPARANO);
        await warte();
        void steuerung.verlaufVon(BOSPARANO)?.lade();
        await warte();
        const vorher = { sprache: zaehler.sprache[BOSPARANO]!, verlauf: zaehler.verlauf[BOSPARANO]! };

        meldeSprachen([{ kind: "sprache", id: GARETHI }], 7000);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(7000);
        expect(zaehler.sprache[BOSPARANO]).toBe(vorher.sprache);
        expect(zaehler.verlauf[BOSPARANO]).toBe(vorher.verlauf);
        steuerung.destroy();
    });

    it("🔴 laufende Bearbeitung: das Ungeschriebene bleibt, der neue Stand kommt als Nebenstand, die Kacheln ziehen nach", async () => {
        const { steuerung, stand, geaendert } = aufbau();
        steuerung.oeffneFuer(GARETHI);
        await warte();
        const bearbeitung = steuerung.bearbeitungVon(GARETHI)!;
        bearbeitung.feld((felder) => ({ ...felder, name: "Neuer Name" }));
        await warte();
        expect(bearbeitung.lage.value.aktiv).toBe(true);

        stand[GARETHI] = 4;
        meldeSprachen([{ kind: "sprache", id: GARETHI }], 8000);
        await warte();

        expect(geaendert).toHaveBeenCalledWith(8000);
        expect(bearbeitung.lage.value.aktiv).toBe(true);
        expect(bearbeitung.stand.value?.felder.name).toBe("Neuer Name");
        expect(bearbeitung.detail.value?.revision).toBe(3);
        expect(steuerung.detailVon(GARETHI)?.revision).toBe(4);
        steuerung.destroy();
    });

    it("🔴 eine Teilfläche, die in dieser Sitzung stillgelegt wurde und nun zurückgenommen ist, steht nicht mehr als „zurückholbar“ da", async () => {
        const { steuerung } = aufbau();
        steuerung.oeffneFuer(GARETHI);
        await warte();
        await steuerung.teilflaeche(GARETHI, { id: TEIL, revision: 3, flaeche: 100 }, "stilllegen");
        expect(steuerung.stillgelegteVon(GARETHI).map((teil) => teil.id)).toEqual([TEIL]);

        meldeSprachen(
            [
                { kind: "sprache_flaeche", id: TEIL },
                { kind: "sprache", id: GARETHI },
            ],
            9000,
        );
        await warte();
        expect(steuerung.stillgelegteVon(GARETHI)).toEqual([]);
        steuerung.destroy();
    });
});

describe("Zurücknehmen aus dem Verlauf des Fensters selbst", () => {
    it("🔴 die Quittung der Rücknahme lässt das Fenster die zurückgebrachte Teilfläche vergessen, ohne dass der Reiter etwas meldet", async () => {
        const { steuerung } = aufbau();
        steuerung.oeffneFuer(GARETHI);
        await warte();
        await steuerung.teilflaeche(GARETHI, { id: TEIL, revision: 3, flaeche: 100 }, "stilllegen");
        expect(steuerung.stillgelegteVon(GARETHI).map((teil) => teil.id)).toEqual([TEIL]);

        await steuerung.verlaufVon(GARETHI)!.nachRuecknahme({
            mapRevision: 12,
            affected: [{ kind: "sprache_flaeche", id: TEIL }],
        });
        expect(steuerung.stillgelegteVon(GARETHI)).toEqual([]);
        steuerung.destroy();
    });
});

describe("Hören und Aufhören", () => {
    it("🔴 eine zweite Meldung mit gleichem Inhalt wirkt wieder; nach `destroy` hört die Steuerung nicht mehr zu", async () => {
        const { steuerung, geaendert } = aufbau();
        meldeSprachen([{ kind: "sprache", id: GARETHI }], 9500);
        await warte();
        meldeSprachen([{ kind: "sprache", id: GARETHI }], 9500);
        await warte();
        expect(geaendert).toHaveBeenCalledTimes(2);

        steuerung.destroy();
        meldeSprachen([{ kind: "sprache", id: GARETHI }], 9501);
        await warte();
        expect(geaendert).toHaveBeenCalledTimes(2);
    });
});
