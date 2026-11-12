import { describe, expect, it } from "vitest";
import {
    WIKI_KANON_NAMESPACES,
    WIKI_KARTENOBJEKT_NAMESPACES,
    WIKI_NAMESPACE_PRAEFIXE,
    wikiNamespaceIstInhalt,
    wikiNamespaceKanon,
    wikiNamespaceTraegtKartenobjekte,
} from "../src/wiki-namespaces.ts";

/**
 * Die Namensräume des Wiki Aventurica als Vorgabe (WI-0253 B-1; Legacy `namespaces.php`). Zwei Fragen, zwei Antworten: Wer ist Kanon, und woraus
 * sammeln wir Kartenobjekte? Ein Raum außerhalb der Vorgabe ist kein Inhalt.
 */
describe("Wiki-Namensräume: die Vorgabe", () => {
    it("🔴 Kanon: 0, 218 und 220 offiziell; 222 und 444 inoffiziell", () => {
        expect(wikiNamespaceKanon(0)).toBe("offiziell");
        expect(wikiNamespaceKanon(218)).toBe("offiziell");
        expect(wikiNamespaceKanon(220)).toBe("offiziell");
        expect(wikiNamespaceKanon(222)).toBe("inoffiziell");
        expect(wikiNamespaceKanon(444)).toBe("inoffiziell");
        expect(Object.keys(WIKI_KANON_NAMESPACES).map(Number)).toEqual([0, 218, 220, 222, 444]);
    });

    it("🔴 Kartenobjekte werden nur aus 0 und 222 eingesammelt, nicht aus allen Kanonräumen", () => {
        expect([...WIKI_KARTENOBJEKT_NAMESPACES]).toEqual([0, 222]);
        for (const nr of [0, 222]) expect(wikiNamespaceTraegtKartenobjekte(nr), String(nr)).toBe(true);
        // 218 und 220 sind Kanon, liefern aber keine Kartenobjekte; 444 liefert nur Fehltreffer (Regelwerk-Vorteile).
        for (const nr of [218, 220, 444]) {
            expect(wikiNamespaceIstInhalt(nr), String(nr)).toBe(true);
            expect(wikiNamespaceTraegtKartenobjekte(nr), String(nr)).toBe(false);
        }
    });

    it("🔴 ein Raum außerhalb der Vorgabe ist KEIN Inhalt: Der Kanon ist `null` (die Frage stellt sich nicht), nicht inoffiziell", () => {
        for (const nr of [-2, 1, 6, 10, 14, 666, 223]) {
            expect(wikiNamespaceIstInhalt(nr), String(nr)).toBe(false);
            expect(wikiNamespaceKanon(nr), String(nr)).toBeNull();
            expect(wikiNamespaceTraegtKartenobjekte(nr), String(nr)).toBe(false);
        }
        // Und die Eigenschaften des Prototyps sind keine Räume.
        expect(wikiNamespaceIstInhalt("constructor" as unknown as number)).toBe(false);
    });

    it("die Titelpräfixe der Räume: Hauptraum ohne, alle anderen mit Wort", () => {
        expect(WIKI_NAMESPACE_PRAEFIXE).toEqual({ 218: "DSK", 220: "Elf", 222: "Inoffiziell", 444: "Ilaris" });
        expect(0 in WIKI_NAMESPACE_PRAEFIXE).toBe(false);
    });
});
