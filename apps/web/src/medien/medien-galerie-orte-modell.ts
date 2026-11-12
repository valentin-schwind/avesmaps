import type { EditorPlaceRow, MediaSubjectSlots } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";

/**
 * Was die Ortsauswahl einer Galerie rechnet (WI-0068 P6): welche Orte überhaupt in Frage kommen, welcher gesperrt ist und warum.
 * Reine Funktionen, damit Vitest sie ohne Browser prüft.
 *
 * 🔴 **Nur echte Orte.** Die Ortsliste des Editors trägt drei Herkünfte (`EDITOR_PLACE_ORIGINS`); eine Zeile mit `origin: "wiki"`
 * ist ein Wiki-Artikel OHNE Ort in der Datenbank — ihr `key` ist `wiki:<slug>`, keine Kennung, an die sich etwas binden ließe.
 * Ein Ort ohne Lage (`ohne-lage`) ist dagegen ein echter Ort und darf eine Galerie tragen.
 *
 * 🔴 **Ein Ort hat EIN Titelbild ODER EINE Galerie** (Betreiber 2026-10-17: „EIN titelbild oder EINE Galerie“, WI-0219). Binden löst
 * ein Einzelbild des Orts; eine zweite Galerie weist der Server ab (409 `place_has_gallery`), ersetzen geht im Ortseditor. Ob am Ort
 * ein Bild oder eine Galerie hängt, sagt die Ortsliste nicht (`imageCount` zählt beides): Die Zeile nennt nur, dass er ein Titelbild
 * hat, und erst die Plätze des gewählten Orts entscheiden (`kopfFolge`) — statt eines 409, den niemand vorhersehen konnte.
 */

export interface OrtsZeile {
    /** Die `public_id` des Orts. */
    id: string;
    name: string;
    /** Was unter dem Namen steht: Art und Lage, soweit bekannt. */
    unterzeile: string;
    /** Der Satz, warum dieser Ort gerade nicht geht; `undefined` heißt wählbar. */
    gesperrt: string | undefined;
    /** Auskunft ohne Sperre: Der Ort hat schon ein Titelbild (ein Bild oder eine Galerie). */
    titelbild: string | undefined;
}

/** Die Unterzeile aus dem, was die Zeile hergibt: Art, Lage, Siedlung. Leer, wenn nichts bekannt ist. */
function unterzeileVon(row: EditorPlaceRow): string {
    const teile = [row.kind ?? row.subtype, row.within ?? row.region].filter(
        (teil): teil is string => teil !== undefined && teil.trim() !== "",
    );
    return teile.join(" · ");
}

/**
 * Die wählbaren Orte zu einer Sucheingabe.
 *
 * 🪤 Die Suche filtert HIER, nicht am Server: Die Ortsliste kommt als Ganzes (rund 5.000 Zeilen, gepackt und mit ETag), und eine
 * zweite Suchroute wäre eine zweite Wahrheit darüber, was ein Ort ist.
 */
export function ortsZeilen(
    rows: readonly EditorPlaceRow[],
    suche: string,
    optionen: { gebunden: ReadonlySet<string>; grenze?: number } = { gebunden: new Set() },
): OrtsZeile[] {
    const q = suche.trim().toLocaleLowerCase("de-DE");
    const grenze = optionen.grenze ?? 50;
    const treffer: OrtsZeile[] = [];
    for (const row of rows) {
        if (row.origin === "wiki") continue;
        if (q !== "" && !row.name.toLocaleLowerCase("de-DE").includes(q)) continue;
        treffer.push({
            id: row.key,
            name: row.name,
            unterzeile: unterzeileVon(row),
            gesperrt: optionen.gebunden.has(row.key) ? t("medien.galerien.ortSchonGebunden") : undefined,
            titelbild: row.imageCount === undefined ? undefined : t("medien.galerien.ortHatTitelbild"),
        });
        if (treffer.length >= grenze) break;
    }
    return treffer;
}

/** Wie viele Orte die Suche trifft, ohne die Anzeigegrenze — damit die Oberfläche „n weitere“ sagen kann. */
export function ortsTreffer(rows: readonly EditorPlaceRow[], suche: string): number {
    const q = suche.trim().toLocaleLowerCase("de-DE");
    return rows.filter((row) => row.origin !== "wiki" && (q === "" || row.name.toLocaleLowerCase("de-DE").includes(q)))
        .length;
}

/** Was Binden an einem Ort mit Titelbild tut: eine Galerie dort sperrt (Ersetzen im Ortseditor), ein Einzelbild wird gelöst. */
export function kopfFolge(header: MediaSubjectSlots["header"]): { gesperrt?: string; hinweis?: string } {
    if (header?.gallery) return { gesperrt: t("medien.galerien.ortHatGalerie") };
    if (header?.image) return { hinweis: t("medien.galerien.ortBildWirdGeloest") };
    return {};
}
