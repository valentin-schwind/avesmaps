import {
    extrahiereInfoboxBlock,
    feldRoh as rohAusFeldern,
    infoboxName,
    leseParameter,
    normalisiereFelder,
    type InfoboxBlock,
} from "./block.ts";
import { bereinige, normalisiereTitel, schluesselform } from "./text.ts";

/**
 * Eine Wiki-Seite, einmal zerlegt (WI-0253 C): Titel, Infobox-Name, Block und Parameter. Die Leser der Bereiche (`ort.ts` … `gebiet.ts`) arbeiten
 * darauf; jeder holt seine Felder über `feld` (bereinigt) oder `feldRoh` (roh, mit Links).
 */
export interface Infoboxseite {
    /** Der Titel, wie Legacy ihn führt (Unterstriche zu Leerzeichen, ohne Sprungmarke). */
    titel: string;
    wikitext: string;
    /** Der Name der ersten Infobox („Siedlung”); leer ohne Infobox. */
    infobox: string;
    /** Die Schlüsselform des Namens („siedlung”, „strasse”); damit entscheidet Legacy die Art. */
    infoboxSchluessel: string;
    block: InfoboxBlock;
    norm: ReadonlyMap<string, string>;
}

export function analysiere(titel: string, wikitext: string): Infoboxseite {
    const name = infoboxName(wikitext);
    const block = extrahiereInfoboxBlock(wikitext);
    return {
        titel: normalisiereTitel(titel),
        wikitext,
        infobox: name,
        infoboxSchluessel: schluesselform(name),
        block,
        norm: normalisiereFelder(leseParameter(block.block)),
    };
}

/** Ein Feld roh, wie die Seite es führt (mit Links und Vorlagen); der erste Schlüssel mit Inhalt gewinnt, sonst `""`. */
export function feldRoh(seite: Infoboxseite, schluessel: readonly string[]): string {
    return rohAusFeldern(seite.norm, schluessel);
}

/** Ein Feld, bereinigt (Links, Vorlagen und Auszeichnung weg). */
export function feld(seite: Infoboxseite, schluessel: readonly string[]): string {
    return bereinige(feldRoh(seite, schluessel));
}
