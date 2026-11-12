import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wächter über den Linkpfad (WI-0063 27.12, Betreiber 2026-10-05, AGENTS.md „Karteninteraktion“): Ein Wert eines Wiki-Feldes wird nur über den
 * Wiki-Key zu einem Objektlink, nie über den Namen - auch nicht über einen „eindeutigen“. Betreiber: „was du mit der namensauflösung gemacht hast,
 * haben wir schonmal verbockt, genau dasselbe war bei legacy auch“. Dieser Test sichert das am Quelltext ab, damit eine künftige Änderung die
 * Namenssuche nicht still wieder einführt: Der Namensindex ist weg, und keine Datei des Linkpfades kennt den normalisierten Namensschlüssel.
 *
 * Methode: Die Quelltexte werden gelesen, Kommentare entfernt (Prosa über die alte Regel darf bleiben), dann nach den Vokabeln der Namenssuche
 * gesucht. Die Dateien, die den Namensschlüssel (`wikiPageNameKey`) noch benutzen dürfen, stehen in einer Liste mit Begründung: Wer dort eine
 * Datei ergänzt, muss es hier sagen.
 */

const SRC = resolve(import.meta.dirname, "..", "src");
const SUBJECTS = join(SRC, "subjects");

/** Der Linkpfad: wer ein Wiki-Feld zu Verweisen macht. */
const LINK_PATH = [
    "wiki-key-lookup.ts",
    "link-pieces.ts",
    "detail-place.ts",
    "detail-path.ts",
    "detail-powerline.ts",
    "detail-area.ts",
    "detail-peak.ts",
    "region-snapshot.ts",
    "facts.ts",
];

/** Was die Namenssuche ausmacht: der Namensindex, die Zuordnung nach Namen, der Namensschlüssel, der Wegname-Kanal. */
const NAME_RESOLUTION =
    /name-index|\bNameIndex\b|buildNameIndex|\bNameTarget\b|text-links|\bmatchName\b|\bscanText\b|\bfieldLinks\b|\blageLinks\b|\blistLinks\b|\bFIELD_LINK_KINDS\b|\bwikiPageNameKey\b|\bbyNameKey\b|paths\.byName\b|\bindex\.names\b/;

/** Der Quelltext ohne Kommentare (Block-, Zeilen- und SQL-Kommentare), damit Prosa über die alte Regel nicht anschlägt. */
function code(file: string): string {
    return readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\s\/\/.*$/gm, "");
}

function tsFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) return tsFiles(path);
        return path.endsWith(".ts") ? [path] : [];
    });
}

describe("Der Linkpfad kennt keinen Namen (Zuordnung nur über den Wiki-Key)", () => {
    it("🔴 der Namensindex und die Namenszuordnung gibt es nicht mehr", () => {
        expect(existsSync(join(SUBJECTS, "name-index.ts"))).toBe(false);
        expect(existsSync(join(SUBJECTS, "text-links.ts"))).toBe(false);
    });

    it.each(LINK_PATH)("🔴 %s: keine Namenssuche im Linkpfad", (name) => {
        const path = join(SUBJECTS, name);
        expect(existsSync(path), `${name} fehlt`).toBe(true);
        const found = NAME_RESOLUTION.exec(code(path));
        expect(found?.[0], `${name} benutzt ${String(found?.[0])}: Namen sind Anzeige, nie Schlüssel`).toBeUndefined();
    });

    it("der Speicherindex trägt den Lookup nach Wiki-Key und keinen nach Namen", () => {
        const source = code(join(SUBJECTS, "subject-index.ts"));
        expect(source).toContain("wikiKeys: WikiKeyLookup");
        expect(source).not.toMatch(/\bnames\s*:|\bNameIndex\b|\bbyName\b/);
    });

    it("der Linkpfad fragt den Lookup über EINE Stelle: `canonicalWikiKey` (später die Weiterleitungen), nie ein eigener Schlüssel", () => {
        const source = code(join(SUBJECTS, "wiki-key-lookup.ts"));
        expect(source).toMatch(/export function canonicalWikiKey\(key: string\): string \{\s*return key;\s*\}/);
        // Beide Wege in den Lookup - Aufbau und Abfrage - gehen durch sie.
        expect(source.match(/canonicalWikiKey\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    });

    it("🔴 der Lookup RECHNET keinen Key: die Keys kommen aus Legacys Exporten (X1 `ziel_key`, X2 `wiki_key`) und werden wörtlich verglichen", () => {
        // Weder der Namensschlüssel noch Legacys Linkschlüssel der Objektlinks (`wikiLinkKey`) noch eine eigene Faltung: ein selbst gerechneter Key wäre
        // genau die zweite Wahrheit, die die Exporte abgelöst haben.
        for (const name of ["wiki-key-lookup.ts", "link-pieces.ts"]) {
            const source = code(join(SUBJECTS, name));
            expect(source, name).not.toMatch(/wikiLinkKey|wikiPageNameKey|normalize\(|toLowerCase\(\)/);
        }
    });

    it("🔴 den normalisierten NAMENSschlüssel benutzen nur die Legacy-Objektlinks (WI-0063 4.6)", () => {
        // `resolve-link.ts` und der Namenskanal `byNameKey` in `subject-index.ts` sind Legacys eigenes Verhalten (`?siedlung=` & Co. mit Namens-
        // Rückfall, WI-0063 4.6, die Frage dazu liegt beim Betreiber).
        const allowed = ["subjects/resolve-link.ts", "subjects/subject-index.ts"];
        const users = tsFiles(SRC)
            .filter((file) => /\bwikiPageNameKey\b/.test(code(file)))
            .map((file) => relative(SRC, file).split(sep).join("/"))
            .sort();
        expect(users).toEqual(allowed);
    });
});
