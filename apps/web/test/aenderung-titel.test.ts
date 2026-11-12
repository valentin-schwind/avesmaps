import { describe, expect, it } from "vitest";
import type { MapHistoryEntry, MapHistoryObject } from "@avesmaps3d/shared";
import { eintragsTitel } from "../src/aenderungen/aenderung-titel";
import { vorgangVon } from "../src/aenderungen/aenderung-vorgang";

/**
 * Der Titel einer Zeile in „Änderungen“ (WI-0265 B6i): ein WikiSync-Lauf über Sprachartikel stand als „WikiSync: 0 Felder aus dem Wiki übernommen (0 Objekte)“ in der Liste, obwohl er neunzig
 * Gegenstände mit vielen Feldern trug (der Server zählte die angelegten Artikel nicht mit; neue Läufe schreiben die richtige Zahl, `wikisync-titel.test.ts`). Der Altbestand bleibt in der
 * Datenbank, wie er ist: Die Liste zählt dort, wo der Titel offensichtlich falsch ist (null, obwohl Gegenstände da sind), aus den gelieferten Gegenständen.
 */

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const artikel = (n: number, felder: readonly string[]): MapHistoryObject => ({
    kind: "sprache_artikel",
    id: id(n),
    name: `Sprache ${String(n)}`,
    action: "sprache_artikel.wikisync_uebernommen",
    revisionBefore: null,
    revisionAfter: 1,
    changes: Object.fromEntries(felder.map((feld) => [feld, { before: null, after: "x" }])),
});
const lauf = (
    summary: string | undefined,
    objects: MapHistoryObject[],
    source: MapHistoryEntry["source"] = "wikisync",
): MapHistoryEntry => ({
    operationId: id(900),
    seq: 900,
    at: "2026-10-31T14:03:00.000Z",
    operation: "wikisync.uebernehmen",
    source,
    ...(summary === undefined ? {} : { summary }),
    actor: { kind: "system" },
    objects,
});

describe("Titel einer Zeile in „Änderungen“", () => {
    it("🔴 „0 Felder (0 Objekte)“ bei neunzig Gegenständen zählt aus den Gegenständen: ohne das Rohfeld neben seiner bereinigten Fassung", () => {
        const objekte = Array.from({ length: 90 }, (_unused, n) =>
            artikel(n + 1, ["artikel", "name", "schrift", "rohSchrift"]),
        );
        const titel = eintragsTitel(lauf("WikiSync: 0 Felder aus dem Wiki übernommen (0 Objekte)", objekte));
        // Je Artikel drei Zeilen (Artikel, Name, Schrift): `rohSchrift` steht neben `schrift` nicht als Zeile da.
        expect(titel).toBe("WikiSync: 270 Felder aus dem Wiki übernommen (90 Objekte)");
    });

    it("steht nur die Zahl der Felder auf null, bleibt die Zahl der Objekte, die der Server nannte", () => {
        const objekte = [artikel(1, ["artikel", "name"]), artikel(2, ["artikel"])];
        expect(eintragsTitel(lauf("WikiSync: 0 Felder aus dem Wiki übernommen (6 Objekte)", objekte))).toBe(
            "WikiSync: 3 Felder aus dem Wiki übernommen (6 Objekte)",
        );
    });

    it("eine Zahl über null bleibt, auch wenn die Liste anders zählt", () => {
        const text = "WikiSync: 12 Felder aus dem Wiki übernommen (3 Objekte)";
        expect(eintragsTitel(lauf(text, [artikel(1, ["artikel", "name"])]))).toBe(text);
    });

    it("ohne Gegenstände oder ohne Felder bleibt der Titel des Servers; fremde Titel und andere Quellen bleiben unberührt", () => {
        const null0 = "WikiSync: 0 Felder aus dem Wiki übernommen (0 Objekte)";
        expect(eintragsTitel(lauf(null0, []))).toBe(null0);
        expect(eintragsTitel(lauf(null0, [artikel(1, [])]))).toBe(null0);
        expect(eintragsTitel(lauf(null0, [artikel(1, ["name"])], "editor"))).toBe(null0);
        expect(
            eintragsTitel(lauf("Wiki-Box: 0 Felder aus dem Wiki übernommen (Sync am Objekt)", [artikel(1, ["name"])])),
        ).toBe("Wiki-Box: 0 Felder aus dem Wiki übernommen (Sync am Objekt)");
    });

    it("ohne Titel des Servers steht der Name der Operation", () => {
        const e = lauf(undefined, [artikel(1, ["name"])]);
        expect(eintragsTitel(e)).toBe(vorgangVon(e));
    });
});
