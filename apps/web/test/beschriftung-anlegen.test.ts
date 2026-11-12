import { describe, expect, it, vi } from "vitest";
import type { LandscapeLabelCreateReceipt, OperationReceipt } from "@avesmaps3d/shared";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden.ts";
import {
    createBeschriftungAnlegen,
    createBeschriftungDaten,
    zuruecksetzPunkt,
    type BeschriftungDaten,
} from "../src/landschaftseditor/beschriftung-anlegen.ts";

/**
 * Beschriftungen anlegen, duplizieren, löschen und zurücksetzen im Browser (WI-0232). Ohne Server. Problemfälle: ein Doppelklick legt
 * zwei an; nach dem Speichern bleiben Karte oder Fenster alt; ein Fehler des Servers verschwindet still; die letzte Beschriftung wird
 * gemeldet statt über „Fläche entfernen …“ zu gehen; „Position zurücksetzen“ landet in der falschen Teilfläche, im Loch, oder auf einer
 * anderen Beschriftung.
 */

const REGION = "c5c5c5c5-0000-4000-8000-000000000001";
const LABEL = "c5c5c5c5-0000-4000-8000-0000000000c1";
const quittung = (extra: Partial<LandscapeLabelCreateReceipt> = {}): LandscapeLabelCreateReceipt => ({
    operationId: "op-1",
    status: "applied",
    environment: "test",
    affected: [],
    derivedWork: [],
    warnings: [],
    mapRevision: 4711,
    publicId: "c5c5c5c5-0000-4000-8000-0000000000c9",
    ...extra,
});
const fehler = (code: string, message: string): SchreibAntwort<never> => ({
    ok: false,
    status: 409,
    fehler: { code, message } as never,
});

function aufbau(daten: Partial<BeschriftungDaten>) {
    const geaendert = vi.fn();
    const neuLesen = vi.fn();
    const melde = vi.fn();
    const ablauf = createBeschriftungAnlegen({
        daten: {
            lege: daten.lege ?? vi.fn(),
            nimmWeg: daten.nimmWeg ?? vi.fn(),
        },
        geaendert,
        neuLesen,
        melde,
        neueKennung: () => "op-1",
    });
    return { ablauf, geaendert, neuLesen, melde };
}

describe("Beschriftung anlegen, duplizieren, löschen (WI-0232)", () => {
    it("🔴 „Neue Beschriftung“: EIN Auftrag zur Zeit, danach Karte und Fenster neu", async () => {
        let fertig: (a: SchreibAntwort<LandscapeLabelCreateReceipt>) => void = () => undefined;
        const lege = vi.fn(() => new Promise<SchreibAntwort<LandscapeLabelCreateReceipt>>((r) => (fertig = r)));
        const { ablauf, geaendert, neuLesen } = aufbau({ lege });
        const laeuft = ablauf.neu(REGION, 7, [512.5, 640]);
        expect(ablauf.laeuft()).toBe(true);
        expect(await ablauf.neu(REGION, 7, [1, 2])).toBe(false);
        fertig({ ok: true, quittung: quittung() });
        expect(await laeuft).toBe(true);
        expect(lege).toHaveBeenCalledTimes(1);
        expect(lege).toHaveBeenCalledWith(REGION, { operationId: "op-1", baseRevision: 7, position: [512.5, 640] });
        expect(geaendert).toHaveBeenCalledWith(4711);
        expect(neuLesen).toHaveBeenCalledWith(REGION);
    });

    it("ohne Punkt keine Lage (der Server nimmt einen Punkt in der Fläche); Duplizieren schickt die Vorlage", async () => {
        const lege = vi.fn(async () => ({ ok: true as const, quittung: quittung() }));
        const { ablauf } = aufbau({ lege });
        await ablauf.neu(REGION, 7);
        expect(lege).toHaveBeenLastCalledWith(REGION, { operationId: "op-1", baseRevision: 7 });
        await ablauf.dupliziere(REGION, 8, LABEL, [300, 280]);
        expect(lege).toHaveBeenLastCalledWith(REGION, {
            operationId: "op-1",
            baseRevision: 8,
            from: LABEL,
            position: [300, 280],
        });
    });

    it("ein Fehler des Servers kommt als Hinweis; Karte und Fenster bleiben", async () => {
        const { ablauf, geaendert, neuLesen, melde } = aufbau({
            lege: async () => fehler("validation_failed", "Die Beschriftung liegt außerhalb der Karte."),
        });
        expect(await ablauf.neu(REGION, 7, [-5, -5])).toBe(false);
        expect(melde).toHaveBeenCalledWith("Die Beschriftung liegt außerhalb der Karte.", "warning");
        expect(geaendert).not.toHaveBeenCalled();
        expect(neuLesen).not.toHaveBeenCalled();
    });

    it("🔴 Löschen: still gelegt; die letzte meldet `letzte` ohne Hinweis (das Fenster geht dann über „Fläche entfernen …“)", async () => {
        const nimmWeg = vi.fn(async (): Promise<SchreibAntwort<OperationReceipt>> => ({
            ok: true,
            quittung: quittung(),
        }));
        const { ablauf, geaendert } = aufbau({ nimmWeg });
        expect(await ablauf.loesche(REGION, 7, { id: LABEL, revision: 3 })).toBe("geloescht");
        expect(nimmWeg).toHaveBeenCalledWith(REGION, LABEL, { operationId: "op-1", baseRevision: 7, labelRevision: 3 });
        expect(geaendert).toHaveBeenCalledWith(4711);

        const letzte = aufbau({
            nimmWeg: async () => fehler("last_label", "Das ist die letzte Beschriftung von „Moor“."),
        });
        expect(await letzte.ablauf.loesche(REGION, 7, { id: LABEL, revision: 3 })).toBe("letzte");
        expect(letzte.melde).not.toHaveBeenCalled();

        const kraftlinie = aufbau({
            nimmWeg: async () => fehler("powerline_endpoint", "An dieser Beschriftung endet eine Kraftlinie (Ader)."),
        });
        expect(await kraftlinie.ablauf.loesche(REGION, 7, { id: LABEL, revision: 3 })).toBe("fehler");
        expect(kraftlinie.melde).toHaveBeenCalledWith(expect.stringContaining("Kraftlinie"), "warning");
    });

    it("die Daten sprechen die zwei Routen an", async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify(quittung()), { status: 200 }));
        const daten = createBeschriftungDaten(fetcher as unknown as typeof fetch);
        await daten.lege(REGION, { operationId: "op-1", baseRevision: 7 });
        await daten.nimmWeg(REGION, LABEL, { operationId: "op-2", baseRevision: 7, labelRevision: 3 });
        expect(fetcher.mock.calls.map((c) => (c as unknown as [string, RequestInit])[0])).toEqual([
            `/api/editor/landscapes/${REGION}/labels`,
            `/api/editor/landscapes/${REGION}/labels/${LABEL}/retire`,
        ]);
        expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("POST");
    });
});

describe("„Position zurücksetzen“ (WI-0232, wie Legacy)", () => {
    const quadrat = (x: number, y: number, k: number): [number, number][] => [
        [x, y],
        [x + k, y],
        [x + k, y + k],
        [x, y + k],
    ];

    it("🔴 die Teilfläche unter der Beschriftung, nicht die größere daneben", () => {
        const klein = { polygons: [[quadrat(100, 100, 20)]] };
        const gross = { polygons: [[quadrat(300, 300, 200)]] };
        const p = zuruecksetzPunkt([gross, klein], { x: 105, y: 105 }, [], 1)!;
        expect(p[0]).toBeGreaterThan(100);
        expect(p[0]).toBeLessThan(120);
    });

    it("liegt sie in keiner, die nächste; ohne Fläche nichts", () => {
        const a = { polygons: [[quadrat(0, 0, 40)]] };
        const b = { polygons: [[quadrat(500, 500, 40)]] };
        const p = zuruecksetzPunkt([a, b], { x: 480, y: 480 }, [], 1)!;
        expect(p[0]).toBeGreaterThan(500);
        expect(zuruecksetzPunkt([], { x: 1, y: 1 }, [], 1)).toBeUndefined();
    });

    it("nicht ins Loch; neben einer anderen Beschriftung ein Schritt nach rechts unten (+x, −y)", () => {
        const mitLoch = { polygons: [[quadrat(0, 0, 100), quadrat(40, 40, 20)]] };
        const p = zuruecksetzPunkt([mitLoch], { x: 10, y: 10 }, [], 1)!;
        expect(p[0] > 40 && p[0] < 60 && p[1] > 40 && p[1] < 60).toBe(false);
        const daneben = zuruecksetzPunkt([mitLoch], { x: 10, y: 10 }, [p], 3)!;
        expect(daneben).toEqual([p[0] + 3, p[1] - 3]);
    });
});
