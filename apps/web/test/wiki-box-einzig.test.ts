import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 🔴 EINE WIKI-BOX, NICHT FÜNF (WI-0253; Entwurf `review/wi-0253/wikifeld-sync-mockup.html`): Die Zuordnung eines Wiki-Artikels (Zuweisen, Ändern, Sync aktualisieren, Entfernen) ist das Bauteil `WikiBox`
 * (`src/fenster/wiki-box.vue`). Der frühere Kasten „Wiki-Artikel“ der Kraftlinie (`WikiZuordnung`, eine Zuordnung im Entwurf) ist weg; ein Editor, der ihn oder eine eigene Zuordnung wieder baut, bekommt diesen
 * Test rot. Dazu: Die fünf Fenster mit Wiki-Feldern (Ort, Weg, Herrschaftsgebiet, Landschaft, Kraftlinie) hängen die Box ein.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const srcRoot = join(repositoryRoot, "apps", "web", "src");

function vueDateien(ordner: string): string[] {
    return readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) => {
        const pfad = join(ordner, eintrag.name);
        if (eintrag.isDirectory()) return vueDateien(pfad);
        return eintrag.name.endsWith(".vue") ? [pfad] : [];
    });
}

const lies = (pfad: string): string => readFileSync(join(repositoryRoot, pfad), "utf8");

describe("Eine Wiki-Box", () => {
    it("💣 die alte Zuordnung im Entwurf fällt auf (Bauteil WikiZuordnung)", () => {
        expect('import WikiZuordnung from "../fenster/wiki-zuordnung.vue";').toMatch(/wiki-zuordnung/);
    });

    it("🔴 keine Vue-Datei baut den Kasten „Wiki-Artikel“ (WikiZuordnung) wieder", () => {
        const funde = vueDateien(srcRoot)
            .map((datei) => relative(repositoryRoot, datei).replace(/\\/g, "/"))
            .filter((datei) => /WikiZuordnung|wiki-zuordnung/.test(lies(datei)));
        expect(funde).toEqual([]);
    });

    it("🔴 die Fenster mit Wiki-Feldern hängen die Wiki-Box ein", () => {
        const fenster: readonly [string, string][] = [
            ["apps/web/src/ortseditor/ortseditor-eigenschaften.vue", 'art="ort"'],
            ["apps/web/src/wegeditor/wegeditor-fenster.vue", 'art="weg"'],
            ["apps/web/src/gebietseditor/gebiet-eigenschaften.vue", 'art="gebiet"'],
            ["apps/web/src/landschaftseditor/landschaftseditor-fenster.vue", 'art="region"'],
            ["apps/web/src/kraftlinieneditor/kraftlinieneditor-fenster.vue", 'art="kraftlinie"'],
            // Gipfel und jede Landmarke (WI-0271 L4).
            ["apps/web/src/landschaftseditor/gipfel-eigenschaften.vue", 'art="gipfel"'],
        ];
        for (const [datei, art] of fenster) {
            const text = lies(datei);
            expect(text, datei).toContain("<WikiBox");
            expect(text, datei).toContain(art);
        }
    });

    it("die Box nennt ihre Knöpfe mit abstrakten Zeichen und sagt, dass Zuweisen und Entfernen sofort wirken", () => {
        const box = lies("apps/web/src/fenster/wiki-box.vue");
        for (const zeichen of ["✚", "⚙", "⇄", "✕"]) expect(box).toContain(zeichen);
        expect(box).toContain("wikiBox.sofort");
    });
});
