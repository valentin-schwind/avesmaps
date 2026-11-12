import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    INHALTE_TRAEGER_QUELLEN_ARTEN,
    INHALTE_TRAEGER_QUELLEN_GRUENDE,
    INHALTE_TRAEGER_QUELLEN_MAX,
    InhalteTraegerQuellen,
    InhalteTraegerQuellenBody,
    InhalteTraegerQuellenParams,
    gleichDemWiki,
    inhalteTraegerQuellenUrl,
    quellenWikiNormal,
} from "../src/index.ts";

/** Die Quellen eines Kartenobjekts in den Editoren (WI-0254 §12): der Vertrag und der Vergleich mit dem Wiki. */

const UUID = "11111111-1111-4111-8111-111111111111";
const OPERATION = "22222222-2222-4222-8222-222222222222";
const fehler = (schema: Parameters<typeof Value.Errors>[0], wert: unknown): string[] =>
    [...Value.Errors(schema, wert)].map((e) => e.path);

describe("Der Vergleich mit dem Wiki", () => {
    it("🔴 gleich heißt: Art, Seiten und Notiz stimmen nach dem Kürzen überein, leer ist nichts", () => {
        expect(
            gleichDemWiki({ art: "ausfuehrlich", seiten: "12", notiz: null }, { art: "ausfuehrlich", seiten: "12" }),
        ).toBe(true);
        expect(gleichDemWiki({ seiten: "  12 \t" }, { seiten: "12" })).toBe(true);
        expect(gleichDemWiki({ notiz: "   " }, { notiz: null })).toBe(true);
        expect(gleichDemWiki({}, { art: null, seiten: "", notiz: "\n" })).toBe(true);
    });

    it("🔴 ein Unterschied in einer der drei Angaben ist ungleich, auch nur in der Schreibweise", () => {
        const wiki = { art: "ergaenzend" as const, seiten: "S. 12", notiz: "Karte" };
        expect(gleichDemWiki({ ...wiki }, wiki)).toBe(true);
        expect(gleichDemWiki({ ...wiki, art: "erwaehnung" }, wiki)).toBe(false);
        expect(gleichDemWiki({ ...wiki, art: null }, wiki)).toBe(false);
        expect(gleichDemWiki({ ...wiki, seiten: "S.12" }, wiki)).toBe(false);
        expect(gleichDemWiki({ ...wiki, notiz: "karte" }, wiki)).toBe(false);
        expect(gleichDemWiki({ ...wiki, notiz: null }, wiki)).toBe(false);
    });

    it("gekürzt wird wie PHPs trim: Leerzeichen, Tabulator, Zeilenwechsel, NUL; ein geschütztes Leerzeichen bleibt", () => {
        expect(quellenWikiNormal(" \t\r\n\0\x0Bx\0 ")).toBe("x");
        expect(quellenWikiNormal(" ")).toBe(" ");
        expect(quellenWikiNormal(null)).toBeNull();
        expect(quellenWikiNormal(undefined)).toBeNull();
        expect(quellenWikiNormal(" ")).toBeNull();
    });
});

describe("Der Vertrag der Quellen eines Kartenobjekts", () => {
    it("die Adresse trägt Art und Kennung; Ort, Gebiet, Landschaft, Gipfel und die Straße eines Wegs lassen sich lesen und schreiben", () => {
        expect(inhalteTraegerQuellenUrl("place", UUID)).toBe(`/api/editor/inhalte/traeger/place/${UUID}/quellen`);
        expect(INHALTE_TRAEGER_QUELLEN_ARTEN).toEqual(["place", "territory", "area", "peak", "path"]);
        expect(INHALTE_TRAEGER_QUELLEN_GRUENDE).toEqual(["still"]);
        expect(fehler(InhalteTraegerQuellenParams, { kind: "area", id: UUID })).toEqual([]);
        // Der Gipfel trägt Quellen wie jedes Kartenobjekt; eine Art, die es nicht gibt, und ein Name als Kennung sind keine Adresse.
        expect(fehler(InhalteTraegerQuellenParams, { kind: "peak", id: UUID })).toEqual([]);
        expect(fehler(InhalteTraegerQuellenParams, { kind: "label", id: UUID })).not.toEqual([]);
        expect(fehler(InhalteTraegerQuellenParams, { kind: "place", id: "Gareth" })).not.toEqual([]);
    });

    it("die Antwort: ohne Lauf ist `wiki` null, beim Weg stehen die Abschnitte dabei (für den Kreis)", () => {
        const antwort = {
            traeger: { kind: "path", id: UUID, name: "Reichsstraße 1", aktiv: true },
            aenderbar: true,
            wiki: null,
            quellen: [
                {
                    sourceId: UUID,
                    title: "Aventurischer Bote",
                    sourceType: "aventurischer_bote",
                    offiziell: true,
                    url: null,
                    referenceKind: "erwaehnung",
                    pages: null,
                    note: null,
                    state: "active",
                    updatedAt: "2026-10-28T10:00:00.000Z",
                    wiki: null,
                    abschnitte: { mit: 2, von: 3, einheitlich: true, gleichDemWiki: false },
                },
            ],
        };
        expect(fehler(InhalteTraegerQuellen, antwort)).toEqual([]);
        expect(fehler(InhalteTraegerQuellen, { ...antwort, aenderbar: false, grund: "still" })).toEqual([]);
        // Der Grund `weg` gibt es nicht mehr: Ein Weg ist änderbar wie jedes Objekt.
        expect(fehler(InhalteTraegerQuellen, { ...antwort, aenderbar: false, grund: "weg" })).not.toEqual([]);
        expect(fehler(InhalteTraegerQuellen, { ...antwort, grund: "gesperrt" })).not.toEqual([]);
        expect(
            fehler(InhalteTraegerQuellen, { ...antwort, wiki: { laufId: 7, dumpStand: null, beendetAm: null } }),
        ).toEqual([]);
    });

    it("🔴 der Körper: 1 bis 50 Änderungen, jede mit `vorher` (null: es gab keine Verknüpfung), unbekannte Felder abgewiesen", () => {
        const hinzu = { op: "add", sourceId: UUID, vorher: null, referenceKind: "ausfuehrlich", pages: "12" };
        expect(fehler(InhalteTraegerQuellenBody, { operationId: OPERATION, aenderungen: [hinzu] })).toEqual([]);
        expect(
            fehler(InhalteTraegerQuellenBody, {
                operationId: OPERATION,
                aenderungen: [
                    {
                        op: "update",
                        sourceId: UUID,
                        pages: null,
                        vorher: { state: "active", referenceKind: null, pages: "12", note: null },
                    },
                    {
                        op: "remove",
                        sourceId: UUID,
                        vorher: { state: "active", referenceKind: null, pages: null, note: null },
                    },
                    {
                        op: "restore",
                        sourceId: UUID,
                        vorher: { state: "suppressed", referenceKind: null, pages: null, note: null },
                    },
                ],
            }),
        ).toEqual([]);
        expect(fehler(InhalteTraegerQuellenBody, { operationId: OPERATION, aenderungen: [] })).not.toEqual([]);
        expect(
            fehler(InhalteTraegerQuellenBody, {
                operationId: OPERATION,
                aenderungen: Array.from({ length: INHALTE_TRAEGER_QUELLEN_MAX + 1 }, () => hinzu),
            }),
        ).not.toEqual([]);
        // Ohne `vorher` gäbe es keinen Konflikt: Es ist Pflicht. Ein fremdes Feld ist ein Fehler.
        const ohneVorher = {
            op: hinzu.op,
            sourceId: hinzu.sourceId,
            referenceKind: hinzu.referenceKind,
            pages: hinzu.pages,
        };
        expect(fehler(InhalteTraegerQuellenBody, { operationId: OPERATION, aenderungen: [ohneVorher] })).not.toEqual(
            [],
        );
        expect(
            fehler(InhalteTraegerQuellenBody, { operationId: OPERATION, aenderungen: [{ ...hinzu, kind: "place" }] }),
        ).not.toEqual([]);
        expect(
            fehler(InhalteTraegerQuellenBody, {
                operationId: OPERATION,
                aenderungen: [{ ...hinzu, pages: "x".repeat(121) }],
            }),
        ).not.toEqual([]);
        expect(
            fehler(InhalteTraegerQuellenBody, {
                operationId: OPERATION,
                aenderungen: [{ ...hinzu, referenceKind: "frei" }],
            }),
        ).not.toEqual([]);
    });
});
