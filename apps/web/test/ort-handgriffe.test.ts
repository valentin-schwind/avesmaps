import { describe, expect, it, vi } from "vitest";
import type { EditorPlaceDetail, OperationReceipt, PlaceUpdateBody } from "@avesmaps3d/shared";
import { verbergen } from "../src/ortseditor/ort-handgriffe.ts";

/**
 * Der Schreibweg von „Verbergen“ und „Zurückholen“ am Ort (WI-0128 E15, D20). Die Handgriffe selbst stehen im Register und werden in
 * `handgriffe-ort.test.ts` und `kartenmenue.test.ts` geprüft.
 */

describe("Verbergen", () => {
    it("🔴 sofort eine Operation place.update { hidden } auf der gelesenen Revision; die Quittung nennt Name, Revision und Kachelrevision", async () => {
        const gesendet: PlaceUpdateBody[] = [];
        const quittung: OperationReceipt = {
            operationId: "op",
            status: "applied",
            environment: "development",
            affected: [{ kind: "place", id: "ort-1", revision: 8 }],
            derivedWork: [],
            warnings: [],
            mapRevision: 60,
        };
        const ergebnis = await verbergen(
            {
                ort: () => Promise.resolve({ name: "Gratenfels", revision: 7 } as EditorPlaceDetail),
                speichereOrt: (_id, body) => {
                    gesendet.push(body);
                    return Promise.resolve({ ok: true, quittung });
                },
            },
            "ort-1",
            true,
            () => "op-1",
        );
        expect(gesendet).toEqual([{ operationId: "op-1", baseRevision: 7, changes: { hidden: true } }]);
        expect(ergebnis).toEqual({ ok: true, name: "Gratenfels", revision: 8, mapRevision: 60 });
    });

    it("eine Ablehnung bringt den Satz des Servers; ein fehlender Ort den Ladefehler", async () => {
        const abgelehnt = await verbergen(
            {
                ort: () => Promise.resolve({ name: "Gratenfels", revision: 7 } as EditorPlaceDetail),
                speichereOrt: () =>
                    Promise.resolve({
                        ok: false,
                        status: 423,
                        fehler: { code: "map_editing_off", message: "Bearbeiten ist bis zum Umstieg gesperrt." },
                    }),
            },
            "ort-1",
            true,
        );
        expect(abgelehnt).toEqual({ ok: false, satz: "Bearbeiten ist bis zum Umstieg gesperrt." });
        const fehlt = await verbergen(
            { ort: () => Promise.resolve(null), speichereOrt: vi.fn() },
            "ort-1",
            true,
            undefined,
            "nicht geladen",
        );
        expect(fehlt).toEqual({ ok: false, satz: "nicht geladen" });
    });
});
