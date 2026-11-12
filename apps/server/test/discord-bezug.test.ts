import { describe, expect, it } from "vitest";
import type { Queryable } from "../src/database.ts";
import { bezugAus, stelleAus, woAus } from "../src/community/discord-bezug.ts";

/**
 * Objekt oder Stelle einer Meldung aus Discord (WI-0297; gewählte Option vom 2026-11-10: bei den Meldungen, mit Objekt und Stelle, wenn bekannt). Discord fragt „Wo?“ frei;
 * eine Adresse mit Kartenkoordinaten wird eine Stelle, ein Name, der genau einen sichtbaren Ort trifft, dieser Ort. Alles andere: kein Bezug.
 */

const ORT = { id: "11111111-2222-4333-8444-555555555555", name: "Gareth", typ: "metropole", x: 512.3456, y: 498.1 };

/** Eine Datenbank im Kleinen: gibt die vorgegebenen Orte zurück und merkt sich den gesuchten Namen. */
function orte(zeilen: readonly (typeof ORT)[]): { db: Queryable; gesucht: unknown[] } {
    const gesucht: unknown[] = [];
    const db = ((_teile: TemplateStringsArray, ...werte: unknown[]) => {
        gesucht.push(...werte);
        return Promise.resolve(zeilen);
    }) as unknown as Queryable;
    return { db, gesucht };
}

const mitWo = (wo: string): string => `Tempel fehlt\n\nIm Regionalband steht er.\n\nWo: ${wo}`;

describe("Bezug aus dem „Wo:“ einer Meldung aus Discord", () => {
    it("liest nur das „Wo:“ am Ende, eine Zeile", () => {
        expect(woAus(mitWo("Gareth"))).toBe("Gareth");
        expect(woAus("Ohne Ort.")).toBeNull();
        expect(woAus("Text\n\nWo: ")).toBeNull();
    });

    it("🔴 eine Adresse mit x und y (Anker oder Abfrage) wird eine Stelle, gerundet auf drei Stellen; ohne beide nichts", () => {
        expect(stelleAus("https://avesmaps.de/#x=519.2404&y=499.05&z=3.41&view=standard")).toEqual({
            x: 519.24,
            y: 499.05,
        });
        expect(stelleAus("https://stage.avesmaps.de/edit?x=10&y=20")).toEqual({ x: 10, y: 20 });
        expect(stelleAus("https://avesmaps.de/#z=3")).toBeNull();
        expect(stelleAus("javascript:alert(1)#x=1&y=2")).toBeNull();
        expect(stelleAus("Gareth")).toBeNull();
    });

    it("🔴 ein Name trifft genau einen Ort: Objekt mit Typ und Lage; zwei Treffer oder keiner: kein Bezug", async () => {
        const eins = orte([ORT]);
        expect(await bezugAus(eins.db, mitWo("gareth"))).toEqual({
            art: "objekt",
            objektArt: "place",
            objektId: ORT.id,
            name: "Gareth",
            typ: "metropole",
            lage: { x: 512.346, y: 498.1 },
        });
        expect(eins.gesucht).toContain("gareth");
        expect(
            await bezugAus(orte([ORT, { ...ORT, id: "99999999-2222-4333-8444-555555555555" }]).db, mitWo("Gareth")),
        ).toBeNull();
        expect(await bezugAus(orte([]).db, mitWo("Nirgendwo"))).toBeNull();
    });

    it("eine Adresse ohne Koordinaten fragt keine Orte ab; ohne „Wo:“ kein Bezug", async () => {
        const leer = orte([ORT]);
        expect(await bezugAus(leer.db, mitWo("https://avesmaps.de/s/abc123"))).toBeNull();
        expect(await bezugAus(leer.db, mitWo("www.avesmaps.de"))).toBeNull();
        expect(await bezugAus(leer.db, "Kein Ort angegeben.")).toBeNull();
        expect(leer.gesucht).toEqual([]);
        expect(await bezugAus(leer.db, mitWo("https://avesmaps.de/#x=1&y=2"))).toEqual({
            art: "stelle",
            lage: { x: 1, y: 2 },
        });
    });
});
