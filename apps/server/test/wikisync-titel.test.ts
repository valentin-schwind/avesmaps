import { describe, expect, it } from "vitest";
import type { MapAuditEntry } from "../src/editor/map-operation.ts";
import type { FeldSchritt } from "../src/wiki/abgleich/uebernahme/schreiber.ts";
import { titelZahlen, uebernahmeTitel } from "../src/wiki/abgleich/uebernahme/uebernehmen.ts";

/**
 * Der Titel der Übernahme des WikiSync in der Liste der „Änderungen“ (WI-0265 B6i): Ein Lauf über Sprachartikel stand als „0 Felder aus dem Wiki übernommen (0 Objekte)“ da, obwohl er neunzig neue
 * Gegenstände mit allen ihren Feldern anlegte; der Titel zählte nur die Schritte der Felder an Objekten, die es schon gab. Hier zählt `titelZahlen` rein; der Weg durch die Datenbank steht in
 * `wikisync-sprachen.test.ts` (die Operation trägt den Titel mit den angelegten Artikeln).
 */

const schritte = (n: number): FeldSchritt[] => Array.from({ length: n }, () => ({}) as FeldSchritt);
const neuerArtikel = (felder: readonly string[]): MapAuditEntry => ({
    action: "sprache_artikel.wikisync_uebernommen",
    revisionBefore: null,
    revisionAfter: 1,
    changes: Object.fromEntries(felder.map((feld) => [feld, { before: null, after: "x" }])),
});

describe("WikiSync: Zahlen im Titel der Operation", () => {
    it("🔴 ein Lauf, der nur neue Objekte anlegt, zählt sie und ihre Felder: nie „0 Felder (0 Objekte)“", () => {
        const artikel = Array.from({ length: 90 }, () => neuerArtikel(["artikel", "name", "schrift", "rohSchrift"]));
        const zahlen = titelZahlen({ schritte: [], beruehrt: [], listeImBestand: 0, angelegt: artikel });
        expect(zahlen).toEqual({ felder: 360, objekte: 90 });
        expect(uebernahmeTitel(zahlen)).toBe("WikiSync: 360 Felder aus dem Wiki übernommen (90 Objekte)");
    });

    it("Felder an Objekten des Bestands zählen wie bisher: die Schritte und die berührten Objekte", () => {
        expect(
            titelZahlen({ schritte: schritte(7), beruehrt: ["a", "b", "c"], listeImBestand: 0, angelegt: [] }),
        ).toEqual({
            felder: 7,
            objekte: 3,
        });
    });

    it("Bestand und Neues zusammen: die Zahlen addieren sich", () => {
        const zahlen = titelZahlen({
            schritte: schritte(4),
            beruehrt: ["a", "b"],
            listeImBestand: 0,
            angelegt: [neuerArtikel(["artikel", "name"]), neuerArtikel(["artikel"])],
        });
        expect(zahlen).toEqual({ felder: 7, objekte: 4 });
    });

    it("eine Zeile der Liste an einem Objekt des Bestands (Ortszeile, Ortsliste, Verwendung) zählt als ein Feld", () => {
        expect(titelZahlen({ schritte: [], beruehrt: ["a"], listeImBestand: 2, angelegt: [] })).toEqual({
            felder: 2,
            objekte: 1,
        });
    });

    it("`created` ist die Marke der Rücknahme, kein Feld aus dem Wiki", () => {
        const quelle: MapAuditEntry = {
            action: "source.wikisync_uebernommen",
            revisionBefore: null,
            revisionAfter: 1,
            changes: { created: { before: null, after: {} }, links: { before: [], after: [{}] } },
        };
        expect(titelZahlen({ schritte: [], beruehrt: [], listeImBestand: 0, angelegt: [quelle] })).toEqual({
            felder: 1,
            objekte: 1,
        });
    });
});
