import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Hausregel ✕ an der Liste (WI-0241; Betreiber 2026-10-20: „kannst du hier ein X hinmachen, dass das ding zumacht (bei mobilgeräten
 * wär das wichtig, dass dann hier "Eigenschaften" zu sehen ist)“). Jede einziehbare Listenspalte eines Werkzeugfensters trägt das ✕ der
 * gemeinsamen Spalte (`fenster-spalte.vue`, `schliessen`) und hängt es an denselben Weg wie „«“: über der Karte der Listen-Schalter,
 * am Telefon die Seite „Eigenschaften“.
 *
 * Problemfälle: Ein Editor bekommt eine Liste ohne ✕; ein ✕ baut einen zweiten Weg zum Einklappen (eigener Zustand statt `listeZu`);
 * am Telefon bleibt nach dem ✕ die Liste stehen.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function vueDateien(ordner: string): string[] {
    return readdirSync(ordner).flatMap((name) => {
        const pfad = join(ordner, name);
        if (statSync(pfad).isDirectory()) return vueDateien(pfad);
        return name.endsWith(".vue") ? [pfad] : [];
    });
}

/** Die öffnenden Tags `<FensterSpalte …>` einer Datei, samt Attributen. */
function spalten(quelltext: string): string[] {
    return [...quelltext.matchAll(/<FensterSpalte\b[\s\S]*?>/g)].map((treffer) => treffer[0]);
}

describe("✕ an der Liste der Werkzeugfenster (WI-0241)", () => {
    const listen = vueDateien(SRC).flatMap((pfad) =>
        spalten(readFileSync(pfad, "utf8"))
            .filter((tag) => tag.includes(":einziehbar="))
            .map((tag) => ({ datei: relative(SRC, pfad).replaceAll("\\", "/"), tag })),
    );

    it("🔴 die sieben Editoren mit Liste und Eigenschaften sind dabei", () => {
        expect(listen.map((l) => l.datei).sort()).toEqual([
            "gebietseditor/gebietseditor-fenster.vue",
            "kraftlinieneditor/kraftlinieneditor-fenster.vue",
            "landschaftseditor/landschaftseditor-fenster.vue",
            "ortseditor/ortseditor-fenster.vue",
            // Der Spracheditor (WI-0261 S5d2) trägt das ✕ seit seinem Bau.
            "spracheditor/spracheditor-fenster.vue",
            "wegeditor/wegeditor-fenster.vue",
            // Der Wetter-Editor (WI-0288) seit seiner Angleichung an die übrigen Editoren.
            "wettereditor/wettereditor-fenster.vue",
        ]);
    });

    it("🔴 jede einziehbare Liste trägt das ✕ und hängt es an „«“ (Listen-Schalter) und am Telefon an „Eigenschaften“", () => {
        for (const { datei, tag } of listen) {
            expect(tag, datei).toContain(`:schliessen="t('fenster.liste.schliessen')"`);
            expect(tag, datei).toContain(
                `@schliesse="phoneViewport ? (telefonSeite = 'eigenschaften') : emit('listeZu', true)"`,
            );
        }
    });
});
