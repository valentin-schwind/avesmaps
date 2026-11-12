import { landmarkenArtDerSeite } from "./landmarke.ts";
import type { Infoboxseite } from "./seite.ts";
import { vorlagenNamen } from "./sprache.ts";
import { istWindArtikel } from "./wind.ts";

/**
 * Welche Artikel als Wiki-Eintrag in die Liste der Derographie gehören (WI-0284; Vali 2026-11-06: „einfach listeneinträge mit dem wiki-eintrag (halt ohne fläche)“). REIN, ohne Datenbank.
 *
 * Jede Seite mit geschlossener `{{Infobox Region}}`, außer:
 * - **Landmarken** (Berg, Höhle, Quelle …): Sie stehen schon als Kandidaten im Bereich `gipfel` (`landmarke.ts`).
 * - **Artikel eines anderen Kontinents:** Die Karte zeigt Aventurien. Nur die Hälfte der aventurischen Artikel trägt `{{Aventurien}}`, darum entscheidet nicht diese Vorlage allein, sondern ob die Seite einen anderen
 *   Kontinent nennt. Ohne jede Aussage bleibt der Artikel in der Liste: lieber einer zu viel, als dass ein Editor einen Artikel nie findet.
 *
 * Dazu die **Wind-Artikel** (`{{Infobox Wind}}` oder Kategorie `Wind`, `wind.ts`; WI-0288 Stufe 6, Betreiber 2026-11-08: „Leicht, Derographie“): Sie stehen mit der Art „Wind“ in derselben Liste, mit derselben
 * Regel für den Kontinent.
 *
 * Das ist die erste Stufe und braucht nur die Seite selbst. Die zweite braucht den ganzen Dump und steht im Plan: Führt die Elternkette (`Region=`) in eine andere Welt oder eine Globule (`zielKlasse`), gehört der
 * Artikel nicht in die Liste, auch mit `{{Aventurien}}`. Die Vorlage allein reichte nicht: Der erste Lauf auf der Stage brachte rund 190 Artikel aus Myranor und Uthuria.
 */

const ANDERE_KONTINENTE: readonly string[] = ["Myranor", "Uthuria", "Tharun", "Rakshazar", "Riesland"];

/** Nennt die Vorlage einen anderen Kontinent (`{{Myranor}}`, `{{Nav Derographie Uthuria}}` …)? Auch die neuen Orts-Artikel fragen so (WI-0295, `abgleich/ort-artikel.ts`). */
export const nenntAnderenKontinent = (vorlage: string): boolean =>
    ANDERE_KONTINENTE.some((kontinent) => vorlage === kontinent || vorlage === `Nav Derographie ${kontinent}`);

export function gehoertZurFlaechenliste(seite: Infoboxseite): boolean {
    if (!istWindArtikel(seite)) {
        if (!seite.infoboxSchluessel.includes("region") || !seite.block.geschlossen) return false;
        if (landmarkenArtDerSeite(seite) !== null) return false;
    }
    const vorlagen = vorlagenNamen(seite.wikitext);
    return vorlagen.includes("Aventurien") || !vorlagen.some(nenntAnderenKontinent);
}
