/**
 * Wie ein Weg für einen Leser heißt: sein Name, sonst nichts (`null`) - dieselbe Mechanik wie
 * `landscape-names.ts` für Landschaften (WI-0105).
 *
 * Ein Weg ohne eigenen Namen trägt in Legacy einen Griff: `<Wort>-<Zahl>` („Pfad-3443", „Strasse-5097",
 * „Meer-9281"), oder er heißt blank nach seiner Art („Weg"). Beides ist kein Name und wird nie gezeigt.
 *
 * 🔴 **Die Regel ist Legacys eigene** (`shouldShowRoutePathDisplayName`, `js/routing/route-node.js`), und sie
 * stand in Avesmaps3D schon zweimal: als `isRealPathName` (`apps/server/src/migration/path-groups.ts`) und als
 * `isShownPathName` (`route-stages.ts`). Beide Fassungen waren wirkungsgleich - der allgemeine Zweig
 * `^\S+-\d+$` schließt `^<Art>-\d+$` ein, weil keine Wegart ein Leerzeichen enthält. Jetzt steht sie einmal,
 * und die zwei alten Namen rufen sie auf.
 *
 * 🪤 **Das sind Daten, keine Anzeige.** Wie „Unbezeichneter Pfad" auf der Seite heißt, steht in den
 * Sprachtafeln (`infoPanel.unnamed.*`) und darf sich ändern, ohne dass ein Griff plötzlich als Name
 * durchrutscht. `null` heißt „hier steht kein Name"; den Satz bildet die Oberfläche.
 *
 * 🪤 **Der rohe Name bleibt die Identität.** Der Kettenschlüssel eines Wegs ist `name:<Name>`
 * (`pathChainKey`), und die goldene Markierung auf der Karte filtert die Kacheln auf genau diesen Namen. Ein
 * Lesename ersetzt ihn nie, er steht daneben. 🔴 Nur ein GRIFF ist keine Identität (2026-11-09): Viele Abschnitte heißen
 * blank „Weg“; ein Weg ohne echten Namen ist deshalb sein Abschnitt (`#<public_id>`, `editorPathGroupKey`), und die
 * Kette eines Namens nimmt die Abschnitte nicht auf, die blank nach ihrer Art heißen (`isInPathChain`).
 */

/**
 * Trägt dieser Weg nur einen Griff statt eines Namens?
 *
 * Drei Fälle, alle drei aus Legacy:
 * 1. leer (nur Leerzeichen),
 * 2. blank die eigene Wegart („Strasse" für eine `Strasse"; 26 aktive Wege im Bestand),
 * 3. `<Wort>-<Zahl>` („Pfad-3443"; 5.130 aktive Wege).
 *
 * 🪤 **Die Art eines ANDEREN Wegs ist ein Name**: ein `Pfad`, der „Weg" heißt, behält ihn. Das ist Legacys
 * Regel und absichtlich so (gesichert in `apps/server/test/subject-details.test.ts`).
 *
 * 🪤 Groß- und Kleinschreibung spielt im Zahlzweig keine Rolle (`pfad-1` kommt im Bestand vor), beim blanken
 * Artvergleich schon - dort vergleicht Legacy genau.
 */
export function isPathHandle(name: string, subtype: string): boolean {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === subtype) return true;
    return /^\S+-\d+$/.test(trimmed);
}

/** Der Name eines Wegs, wie ein Leser ihn sieht - `null`, wo nur ein Griff steht. */
export function pathReaderName(name: string, subtype: string): string | null {
    return isPathHandle(name, subtype) ? null : name.trim();
}

/**
 * Gehört ein Abschnitt zur Kette `name:<Name>` seines rohen Namens? Nicht, wo der Name blank die eigene Wegart ist (Fall 2 oben): „Weg“
 * an einem `Weg` ist der Griff JEDES solchen Abschnitts, quer über die Karte, und keine Straße. Ohne diese Grenze leuchteten beim Klick
 * auf einen einzigen „Weg“ alle zugleich, und die Kette nannte einen beliebigen von ihnen (Betreiber 2026-11-09, Bild: „Unbezeichneter
 * Weg“ von Angbar bis Caldaia). Ein `Pfad`, der „Weg“ heißt, bleibt in seiner Kette. Die Kartenauswahl stellt dieselbe Grenze als Filter
 * (`pathChainFilter` in `apps/web`); einen namenlosen Abschnitt wählt sie über seine Kennung (`editorPathGroupKey`).
 */
export function isInPathChain(name: string, subtype: string): boolean {
    return name.trim() !== "" && name.trim() !== subtype;
}

/**
 * Der Griff-Riegel der SUCHE, als Muster für PostgreSQL (`~*`, ohne Rücksicht auf die Schreibweise) - die
 * Schwester von `landscapeSearchHandlePattern()`.
 *
 * 🔴 **Strenger als die Anzeige, und das ist der Punkt**: Er verbirgt den Griff JEDER Art, nicht nur den der
 * jetzigen. Ein Weg, der als `Flussweg-6029` angelegt wurde und heute Seeweg ist, trägt seinen alten Griff
 * weiter; gemessen tragen 38 aktive Wege den Griff einer fremden Art. Die Frage lautet hier nicht „ist der
 * Name automatisch?", sondern „würde ein Leser danach suchen?".
 *
 * 🪤 Den blanken Artnamen (Fall 2 oben) kann ein unveränderliches Muster nicht treffen - er hängt an der
 * Zeile. Die Abfrage prüft ihn daneben mit `btrim(name) <> subtype`.
 */
export function pathSearchHandlePattern(): string {
    return `^\\s*\\S+-[0-9]+\\s*$`;
}
