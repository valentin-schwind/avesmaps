import { WIKI_ART_WIND } from "@avesmaps3d/shared";
import { ersterAbsatz } from "./beschreibung.ts";
import { feld, type Infoboxseite } from "./seite.ts";
import { LEER, kuerze } from "./text.ts";

/**
 * Die Wind-Artikel des Wikis als Wiki-Einträge ohne Fläche (WI-0288 Stufe 6; Betreiber 2026-11-08: „Leicht, Derographie“). REIN, ohne Datenbank.
 *
 * - **Welche:** eine Seite, deren erste Infobox `{{Infobox Wind}}` ist (mit geschlossener Klammer), oder eine Seite der Kategorie `Wind`, deren erste Infobox keine `{{Infobox Region}}` ist (die Region liest
 *   ihr eigener Weg). Der Befund am Dump vom 11.10. (`project-control/discovery/wetter-wiki-befund-2026-11-08.md`): 17 Artikel mit der Infobox, 10 nur mit der Kategorie, zusammen 27 im Hauptraum.
 * - 🪤 **Nicht die Kategorie `Strömung`:** Sie sammelt die Glaubensströmungen der Kirchen, keine Meeresströmungen. Meeresströmungen und Mahlströme tragen `{{Infobox Region}}` und bleiben, wo sie sind.
 * - 🪤 **Ein Verweis auf die Kategorie ist keine Kategorie:** `[[:Kategorie:Wind]]` (mit Doppelpunkt) verlinkt nur; der Begriffsartikel „Wind“ (Kategorie Wetter) gehört nicht dazu.
 * - **Felder:** Name, die Art „Wind“, die Region und die Kurzbeschreibung (erster Absatz), in den Spalten der Wiki-Einträge (`wiki_region_snapshot`). Windrichtung, Stärke und Charakter der Infobox
 *   haben dort keine Spalte und bleiben im Wiki: Die Tafel gehört dem Derographie-Zug, und für einen Verweis am Icon genügen Titel und Art.
 *
 * 🔴 Der Abgleich legt hier nur Wiki-Einträge an (Liste der Derographie). Er legt nie eine Fläche, eine Landmarke oder ein Wetter-Icon an; ein Icon setzt ein Editor von Hand.
 */

/** Die Kategorie, die eine Seite auch ohne Infobox zum Wind-Artikel macht; nur die Einordnung `[[Kategorie:Wind]]` oder `[[Kategorie:Wind|Sortierung]]`, kein Verweis `[[:Kategorie:Wind]]`. */
const KATEGORIE_WIND = new RegExp(
    `\\[\\[${LEER}*(?:Kategorie|Category)${LEER}*:${LEER}*Wind${LEER}*(?:\\||\\]\\])`,
    "iu",
);

/** Billig vorab, bevor der Sammler eine Seite ganz zerlegt: kommt die Infobox oder die Kategorie überhaupt vor? */
const VORAB = /Infobox[ _]+Wind|(?:Kategorie|Category)\s*:\s*Wind/iu;
export const koennteWindSein = (wikitext: string): boolean => VORAB.test(wikitext);

const mitInfoboxWind = (seite: Infoboxseite): boolean => seite.infoboxSchluessel === "wind" && seite.block.geschlossen;

/** Ist die Seite ein Wind-Artikel? Eine Seite mit `{{Infobox Region}}` ist es nie, auch mit der Kategorie: Sie steht schon als Region in der Liste. */
export function istWindArtikel(seite: Infoboxseite): boolean {
    if (mitInfoboxWind(seite)) return true;
    return !seite.infoboxSchluessel.includes("region") && KATEGORIE_WIND.test(seite.wikitext);
}

export type WindLesen =
    { ok: true; infobox: string; felder: Record<string, string> } | { ok: false; grund: "name_fehlt"; infobox: string };

/** Liest einen Wind-Artikel in die Felder der Wiki-Einträge (`name`, `art`, `region_parent`, `description`); ein Feld, das das Wiki nicht nennt, fehlt. */
export function leseWind(seite: Infoboxseite): WindLesen {
    const felder: Record<string, string> = {};
    const setze = (name: string, wert: string): void => {
        if (wert.trim() !== "") felder[name] = wert;
    };
    const kasten = mitInfoboxWind(seite);
    setze("name", kuerze((kasten ? feld(seite, ["name"]) : "") || seite.titel, 255));
    setze("art", WIKI_ART_WIND);
    if (kasten) setze("region_parent", kuerze(feld(seite, ["region", "regionen"]), 255));
    setze("description", ersterAbsatz(seite.wikitext, seite.block));
    if ((felder["name"] ?? "") === "") return { ok: false, grund: "name_fehlt", infobox: "Wind" };
    return { ok: true, infobox: "Wind", felder };
}
