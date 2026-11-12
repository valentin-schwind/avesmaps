import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 🔴 EIN WIKI-FELD, NICHT FÜNF (WI-0225; Design Guide §13.8: „Kein Editor baut seine eigene Wiki-Zeile.“).
 *
 * Der durchgestrichene Wiki-Wert entsteht nur im Bauteil `WikiFeld` (`src/fenster/wiki-feld.vue`). Wer in einer anderen Vue-Datei ein
 * `<s>` oder `<del>` mit einem Wiki-Wert schreibt, oder eine Stilregel mit „wiki“ im Selektor und `line-through`, bekommt diesen Test rot.
 * Die Verläufe streichen alte Werte durch, keine Wiki-Werte; sie fallen nicht auf.
 *
 * ⭐ Eine absichtlich falsche Probe steht mit im Test („💣 …“): die Wiki-Zeile, wie der Ortseditor sie vor WI-0225 baute.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const srcRoot = join(repositoryRoot, "apps", "web", "src");
const BAUTEIL = "apps/web/src/fenster/wiki-feld.vue";

function vueDateien(ordner: string): string[] {
    return readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) => {
        const pfad = join(ordner, eintrag.name);
        if (eintrag.isDirectory()) return vueDateien(pfad);
        return eintrag.name.endsWith(".vue") ? [pfad] : [];
    });
}

/** Was in einer Vue-Datei nach einem eigenen durchgestrichenen Wiki-Wert aussieht. */
function eigeneWikiZeilen(quelltext: string): string[] {
    const funde: string[] = [];
    // `<s …>…</s>` oder `<del …>…</del>`, in dessen Kopf oder Inhalt „wiki“ steht.
    for (const treffer of quelltext.matchAll(/<(s|del)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
        if (/wiki/i.test(treffer[2]! + treffer[3]!)) funde.push(treffer[0].replace(/\s+/g, " ").slice(0, 120));
    }
    // Eine Stilregel mit „wiki“ im Selektor, die durchstreicht. 🪤 Nur, wo überhaupt durchgestrichen wird: Der Ausdruck läuft über
    // große Dateien (app.vue) quadratisch und überschritt unter Last die 5 s (2026-10-19).
    if (!quelltext.includes("line-through")) return funde;
    for (const treffer of quelltext.matchAll(/([^{}]*wiki[^{}]*)\{([^}]*)\}/gi)) {
        if (/line-through/.test(treffer[2]!)) funde.push(`${treffer[1]!.trim()} { line-through }`);
    }
    return funde;
}

describe("Wiki-Werte nur über WikiFeld", () => {
    it("💣 die alte Wiki-Zeile des Ortseditors fällt auf", () => {
        const alt = `<span class="felder__wiki"><s :title="t('ortseditor.wiki.stand')">{{ detail.fields[text.feld].wiki }}</s></span>
<style scoped>.felder__wiki s { text-decoration: line-through; }</style>`;
        expect(eigeneWikiZeilen(alt)).toHaveLength(2);
    });

    it("ein durchgestrichener alter Wert im Verlauf fällt nicht auf", () => {
        expect(eigeneWikiZeilen(`<s class="verlauf__vorher">{{ aenderung.before }}</s>`)).toEqual([]);
    });

    it("🔴 keine Vue-Datei außer dem Bauteil streicht einen Wiki-Wert durch", () => {
        const funde = vueDateien(srcRoot)
            .map((datei) => relative(repositoryRoot, datei).replace(/\\/g, "/"))
            .filter((datei) => datei !== BAUTEIL)
            .flatMap((datei) =>
                eigeneWikiZeilen(readFileSync(join(repositoryRoot, datei), "utf8")).map((fund) => `${datei}: ${fund}`),
            );
        expect(funde).toEqual([]);
    });
});
