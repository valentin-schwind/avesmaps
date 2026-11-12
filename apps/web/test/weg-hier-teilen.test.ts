import { describe, expect, it, vi } from "vitest";
import type { EditorPathDetail, PathSplitBody } from "@avesmaps3d/shared";
import { createWegHierTeilen, naechsterInnerer } from "../src/wegeditor/weg-hier-teilen";

/**
 * „Weg hier teilen“ im Rechtsklick auf den Weg (WI-0177; Thomas 2.1; Betreiber 2026-10-19 „A: auch am Weg (Empfehlung)“). Problemfälle:
 * ein Ende teilt; ein Stützpunkt weit weg vom Klick teilt; geteilt wird gegen eine veraltete Revision; das Menü fragt beim Bauen den
 * Server und wartet; nach einer Änderung an Wegen gilt der alte Stand.
 */
const ID = "5a5a5a5a-0000-4000-8000-0000000000a1";
const weg = (revision = 7): EditorPathDetail =>
    ({
        publicId: ID,
        revision,
        name: "Eisenstraße",
        subtype: "Gebirgspass",
        labelVisible: true,
        isBach: false,
        flowDirection: null,
        sourceSystem: "legacy",
        active: true,
        points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
            { x: 30, y: 0 },
        ],
        ends: { start: { kind: "free" }, end: { kind: "free" } },
    }) as EditorPathDetail;

describe("Weg hier teilen", () => {
    it("🔴 der innere Stützpunkt am nächsten am Klick, im Umkreis; nie ein Ende", () => {
        const punkte = weg().points;
        expect(naechsterInnerer(punkte, { x: 11, y: 1 }, 5)).toEqual({ index: 1, at: { x: 10, y: 0 } });
        expect(naechsterInnerer(punkte, { x: 18, y: 0 }, 5)).toEqual({ index: 2, at: { x: 20, y: 0 } });
        // Am Ende (0|0) liegt kein innerer im Umkreis: keiner.
        expect(naechsterInnerer(punkte, { x: 1, y: 0 }, 5)).toBeUndefined();
        expect(naechsterInnerer(punkte, { x: 15, y: 0 }, 4)).toBeUndefined();
    });

    it("🔴 das Menü wartet nicht: erst „lädt“ (und das Lesen beginnt), nach dem Lesen die Stelle oder „keine“", async () => {
        const daten = { weg: vi.fn(async () => weg()), teile: vi.fn() };
        const t = createWegHierTeilen(daten);
        expect(t.stelle(ID, { x: 11, y: 0 }, 5)).toEqual({ art: "laedt" });
        expect(daten.weg).toHaveBeenCalledTimes(1);
        await t.bereit(ID);
        expect(t.stelle(ID, { x: 11, y: 0 }, 5)).toEqual({ art: "stelle", index: 1, at: { x: 10, y: 0 } });
        expect(t.stelle(ID, { x: 1, y: 0 }, 5)).toEqual({ art: "keine" });
        expect(t.stelle(ID, undefined, 5)).toEqual({ art: "keine" });
        expect(daten.weg).toHaveBeenCalledTimes(1);
    });

    it("🔴 teilt EINMAL gegen die gelesene Revision am gefundenen Stützpunkt; danach liest es neu", async () => {
        const gesendet: PathSplitBody[] = [];
        const daten = {
            weg: vi.fn(async () => weg(7)),
            teile: vi.fn(async (_id: string, body: PathSplitBody) => {
                gesendet.push(body);
                return { ok: true as const, quittung: {} as never };
            }),
        };
        const t = createWegHierTeilen(daten, () => "op-1");
        const antwort = await t.teile(ID, { x: 21, y: 1 }, 5);
        expect(antwort?.ok).toBe(true);
        expect(gesendet).toEqual([{ operationId: "op-1", baseRevision: 7, index: 2, at: { x: 20, y: 0 } }]);
        expect(t.stelle(ID, { x: 21, y: 1 }, 5)).toEqual({ art: "laedt" });
        // Ohne Stelle teilt nichts.
        expect(await t.teile(ID, { x: 1, y: 0 }, 5)).toBeUndefined();
        expect(gesendet).toHaveLength(1);
    });

    it("nach einer Änderung an Wegen (vergiss) gilt der gelesene Stand nicht mehr", async () => {
        const daten = { weg: vi.fn(async () => weg()), teile: vi.fn() };
        const t = createWegHierTeilen(daten);
        await t.bereit(ID);
        t.vergiss();
        expect(t.stelle(ID, { x: 11, y: 0 }, 5)).toEqual({ art: "laedt" });
        expect(daten.weg).toHaveBeenCalledTimes(2);
    });
});
