import type { WikiBoxArt, WikiTreffer } from "@avesmaps3d/shared";
import { isMessageKey, t } from "../i18n/i18n";

/**
 * Die leise Zeile unter dem Namen eines Treffers der Artikelsuche, je Art aus den Werten des Wiki-Stands (Ort: Größe, Bauwerk, Region; Weg: Art und
 * Lage …). Die Wiki-Box (`wiki-box.vue`) und das Feld „Weitere Straßennamen“ (`wegeditor/weg-weitere.vue`, WI-0302) sagen damit dasselbe.
 */
export function trefferZeile(art: WikiBoxArt, tr: WikiTreffer): string {
    const wert = (schluessel: string): string | undefined => {
        const roh = tr.werte[schluessel];
        return roh === undefined || roh === null || roh === "" ? undefined : String(roh);
    };
    const teile: (string | undefined)[] = [];
    switch (art) {
        case "ort": {
            const groesse = wert("groesse");
            const schluessel = groesse === undefined ? undefined : `place.${groesse}`;
            teile.push(
                schluessel !== undefined && isMessageKey(schluessel) ? t(schluessel) : groesse,
                wert("bauwerk"),
                wert("region"),
            );
            break;
        }
        case "weg":
            teile.push(wert("art"), wert("lage"));
            break;
        case "gebiet":
            teile.push(wert("form"), wert("kontinent"));
            break;
        case "region":
            teile.push(wert("art")?.split("|")[0]?.trim());
            break;
        case "kraftlinie":
            teile.push(wert("staerke"), wert("regionen"));
            break;
        case "gipfel":
            // Die Wiki-Art roh (mit dem Rest der Mehrwertigkeit hinter `|`), dazu die Region des Artikels.
            teile.push(wert("art")?.split("|")[0]?.trim(), wert("region"));
            break;
    }
    return teile.filter((teil): teil is string => teil !== undefined).join(" · ");
}
