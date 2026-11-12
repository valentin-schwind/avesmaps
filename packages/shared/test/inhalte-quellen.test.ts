import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    INHALTE_QUELLEN_TRAEGER,
    INHALTE_TRAEGER,
    InhalteQuelleAendernBody,
    InhalteTraegerQuellenVorher,
    InhalteVerwendung,
    InhalteVerwendungVorher,
    InhalteZiel,
    InhalteZieleAnfrage,
} from "../src/index.ts";

/**
 * Das Fenster „Inhalte bearbeiten“, Reiter „Quellen“ (WI-0254): der Vertrag der Verwendungen. Ein Weg ist dort immer die ganze Straße (Betreiber 2026-10-28), ändert sich wie jede andere
 * Verwendung und trägt dabei den gesehenen Stand (`vorher`), weil die Straße keine eigene Revision hat; ein Abschnitt kommt im Vertrag nicht vor.
 */

const UUID = "11111111-1111-4111-8111-111111111111";
const OPERATION = "22222222-2222-4222-8222-222222222222";
const fehler = (schema: Parameters<typeof Value.Errors>[0], wert: unknown): string[] =>
    [...Value.Errors(schema, wert)].map((e) => e.path);

const GESEHEN = { state: "active", referenceKind: "erwaehnung", pages: "5", note: null };
const koerper = (links: unknown[]) => ({ operationId: OPERATION, baseRevision: 3, links });

describe("Träger einer Quelle", () => {
    it("Orte der Literatur und Vorkommen kennen keinen Weg; die Träger einer Quelle schon", () => {
        expect(INHALTE_TRAEGER).toEqual(["place", "territory", "area", "peak"]);
        expect(INHALTE_QUELLEN_TRAEGER).toEqual(["place", "territory", "area", "peak", "path"]);
    });
});

describe("Verwendungen ändern", () => {
    it("🔴 ein Weg geht in jeder der vier Änderungen durch, mit gesehenem Stand (oder null, wenn es keine gab)", () => {
        const links = [
            { op: "add", kind: "path", carrierId: UUID, vorher: null, referenceKind: "ergaenzend", pages: "3" },
            { op: "update", kind: "path", carrierId: UUID, vorher: GESEHEN, pages: null },
            { op: "remove", kind: "path", carrierId: UUID, vorher: GESEHEN },
            { op: "restore", kind: "path", carrierId: UUID, vorher: { ...GESEHEN, state: "suppressed" } },
        ];
        expect(fehler(InhalteQuelleAendernBody, koerper(links))).toEqual([]);
    });

    it("die anderen Träger gehen weiter ohne `vorher` durch; `vorher` hat dieselbe Form wie in der Klappbox der Karteneditoren", () => {
        expect(
            fehler(InhalteQuelleAendernBody, koerper([{ op: "add", kind: "peak", carrierId: UUID, pages: "1" }])),
        ).toEqual([]);
        expect(InhalteVerwendungVorher).toBe(InhalteTraegerQuellenVorher);
    });

    it("🔴 ein ungültiger gesehener Stand wird abgewiesen: unbekannter Zustand, zu lange Seiten, ein Feld zu viel", () => {
        const mit = (vorher: unknown) =>
            fehler(InhalteQuelleAendernBody, koerper([{ op: "remove", kind: "path", carrierId: UUID, vorher }]));
        expect(mit({ ...GESEHEN, state: "weg" })).not.toEqual([]);
        expect(mit({ ...GESEHEN, pages: "x".repeat(121) })).not.toEqual([]);
        expect(mit({ ...GESEHEN, abschnitte: 3 })).not.toEqual([]);
        expect(mit(GESEHEN)).toEqual([]);
    });
});

describe("Verwendungen und Ziele", () => {
    const verwendung = {
        kind: "path",
        carrierId: UUID,
        name: "Reichsstraße 1",
        subtype: "Strasse",
        referenceKind: "erwaehnung",
        pages: "5",
        note: null,
        state: "active",
        herkunft: "legacy",
        traegerAktiv: true,
        aenderbar: true,
    };

    it("🔴 eine Verwendung nennt keinen Abschnitt: die Zahl der Abschnitte ist kein Teil des Vertrags mehr", () => {
        expect(fehler(InhalteVerwendung, verwendung)).toEqual([]);
        expect(fehler(InhalteVerwendung, { ...verwendung, abschnitte: 3 })).not.toEqual([]);
    });

    it("die Suche nach Zielen findet Wege nur auf Wunsch; ein Treffer darf ein Weg sein", () => {
        expect(fehler(InhalteZieleAnfrage, { q: "Reichs" })).toEqual([]);
        expect(fehler(InhalteZieleAnfrage, { q: "Reichs", wege: true })).toEqual([]);
        expect(
            fehler(InhalteZiel, { kind: "path", carrierId: UUID, name: "Reichsstraße 1", subtype: "Strasse" }),
        ).toEqual([]);
        expect(fehler(InhalteZiel, { kind: "river", carrierId: UUID, name: "x" })).not.toEqual([]);
    });
});
