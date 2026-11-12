import { WIKISYNC_ARTIKEL_TITEL_MAX, WIKISYNC_ARTIKEL_TITEL_VERBOTEN } from "@avesmaps3d/shared";

/**
 * Der Titel eines einzelnen Artikels, wie die Steuerung ihn annimmt (WI-0253 D-2). Die Route und der Auftrag prüfen dasselbe; der Auftrag nimmt nichts, was die Route nicht nähme.
 *
 * 🔴 Kein `|` und keine Zeichen, die in keinem MediaWiki-Titel stehen: `|` hängte sonst einen zweiten Titel an die Anfrage (die API nimmt `titles=A|B`), und Steuerzeichen haben in einer
 * Adresse nichts verloren.
 */

/** Der Titel, wie MediaWiki ihn nimmt: Unterstriche sind Leerzeichen, Leerraum an den Rändern fällt weg, Leerraum in der Mitte ist ein Leerzeichen. */
export function normalisiereArtikelTitel(roh: string): string {
    return roh.replaceAll("_", " ").replace(/\s+/gu, " ").trim();
}

/** Ist das ein Titel, den die Steuerung annimmt? */
export function artikelTitelOk(titel: string): boolean {
    if (titel === "" || titel.length > WIKISYNC_ARTIKEL_TITEL_MAX || WIKISYNC_ARTIKEL_TITEL_VERBOTEN.test(titel))
        return false;
    // Steuerzeichen (und DEL) stehen in keinem Titel.
    return ![...titel].some((zeichen) => (zeichen.codePointAt(0) ?? 0) < 32 || zeichen === "\u007f");
}
