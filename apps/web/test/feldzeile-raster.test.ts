import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 🔴 EINE FELDKANTE IM EDITOR (Betreiber 2026-10-19 an den Eigenschaften der Herrschaftsgebiete, wörtlich: „glaubst man kann das so
 * angleichen?“). Das Raster jeder Feldzeile steht nur in `src/fenster/fenster-feldzeile-raster.css` (Beschriftung 130 px · Feld · ↺);
 * Zeilen bauen `FensterFeldzeile`, `FensterFeldzeilen` oder `WikiFeld`. Ein eigenes Raster aus Beschriftung und Feld in einem Editor
 * („38,2 % · 61,8 %“, „mindestens 7em · Rest“) setzt seine Felder an eine andere Kante.
 *
 * `NOCH_EIGEN` nennt die Stellen, die ihre Sitzungen noch umstellen (Stand 2026-10-19). Die Liste wird nur kürzer: Eine neue Stelle
 * macht den Test rot, eine umgestellte auch, bis sie hier gestrichen ist.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const srcRoot = join(repositoryRoot, "apps", "web", "src");
const EDITOREN = ["ortseditor", "wegeditor", "gebietseditor", "kraftlinieneditor", "landschaftseditor"];

const NOCH_EIGEN = ["apps/web/src/ortseditor/ort-entfernen-fenster.vue"];

function vueDateien(ordner: string): string[] {
    return readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) => {
        const pfad = join(ordner, eintrag.name);
        if (eintrag.isDirectory()) return vueDateien(pfad);
        return eintrag.name.endsWith(".vue") ? [pfad] : [];
    });
}

/** Ein Raster aus Beschriftung und Feld: zwei Spalten, die erste nach Anteil oder nach ihrem Inhalt. */
function eigenesZeilenraster(quelltext: string): boolean {
    return /grid-template-columns:\s*minmax\(0,\s*0?\.382fr\)\s+minmax\(0,\s*0?\.618fr\)|grid-template-columns:\s*minmax\(\d+(?:\.\d+)?(?:em|rem|px),\s*auto\)\s+minmax\(0,\s*1fr\)\s*;/.test(
        quelltext,
    );
}

describe("Feldzeilen der Editoren auf einem Raster", () => {
    it("💣 die Wertliste der Gebiete, wie sie vor 2026-10-19 stand, fällt auf", () => {
        expect(
            eigenesZeilenraster(".gebiet__werte { grid-template-columns: minmax(0, 0.382fr) minmax(0, 0.618fr); }"),
        ).toBe(true);
        expect(eigenesZeilenraster(".felder__liste { grid-template-columns: minmax(7em, auto) minmax(0, 1fr); }")).toBe(
            true,
        );
    });

    it("eine Liste mit Spalten nach Inhalt (keine Feldzeile) fällt nicht auf", () => {
        expect(eigenesZeilenraster(".leiste { grid-template-columns: minmax(0, 1fr) auto auto; }")).toBe(false);
    });

    it("🔴 nur die genannten Editorstellen bauen noch ein eigenes Zeilenraster", () => {
        const funde = EDITOREN.flatMap((ordner) => vueDateien(join(srcRoot, ordner)))
            .filter((datei) => eigenesZeilenraster(readFileSync(datei, "utf8")))
            .map((datei) => relative(repositoryRoot, datei).replace(/\\/g, "/"))
            .sort();
        expect(funde).toEqual(NOCH_EIGEN);
    });
});
