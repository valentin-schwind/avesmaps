import { isMessageKey, t, type MessageKey } from "./i18n";

/**
 * Wie ein Gegenstand OHNE Namen auf der Seite heißt (WI-0105).
 *
 * 🔴 **Die Trennung ist tragend:** Ob ein Name fehlt, entscheidet die Datenschicht
 * (`pathReaderName`/`landscapeReaderName` in `@avesmaps3d/shared`, beide liefern `null`); welcher SATZ dann
 * dort steht, entscheidet die Sprachtafel - er heißt auf Englisch anders und darf sich ändern, ohne dass ein
 * Griff plötzlich als Name durchrutscht.
 *
 * 🔴 **Ein Schlüssel je Art, keine zusammengesetzte Zeichenkette.** Bei den WEGEN wechselt das Geschlecht: „Unbezeichnet**e**
 * Straße" gegen „Unbezeichnet**er** Weg", also steht jeder Satz ausgeschrieben da. Dieselbe Begründung hat Legacy aktenkundig
 * (`avesmaps@9f1c68c9f`: „Spelled out per subtype rather than concatenated, because German inflects the adjective").
 *
 * 🔴 **Die FLÄCHEN tragen kein Adjektiv mehr** (OPS-073, Meldung von Thomas: „unbekannter Wald“ wirke total unprofessionell, das
 * „unbekannter“ solle überall weg, „so dass zb nur Wald steht“): Der Satz einer namenlosen Fläche ist nur noch ihre Art („Wald“,
 * „Region“, „Inselgruppe“) und damit in jeder Sprache ohne Beugung. Die Schlüssel `landscape.unnamed.<art>` bleiben, ihr Wert ist
 * der von `landscape.type.<art>` (`apps/web/test/unbezeichnet.test.ts` hält beide in allen neun Sprachen gleich).
 *
 * 🪤 **Titel und Art dürfen nicht dasselbe Wort doppelt sagen.** Heißt eine Fläche „Wald“, weil sie keinen Namen hat, steht „Wald“ als
 * Titel - und die Art daneben (Untertitel des Infopanels, hinter dem Namen in Zeigerschild und Auswahlliste, im Editor-Menü) wäre
 * dasselbe Wort noch einmal. Wo Name und Art nebeneinander stehen, geht die Art deshalb durch `artNebenName`; wo sie darunter steht,
 * durch `subtitleUnderTitle` (`info-panel/panel-header.ts`).
 *
 * 🪤 **Nicht jede Art heißt im Satz wie in der Artentafel.** Ein `Flussweg` ist im Satz ein „Fluss" und mit
 * `is_bach` ein „Bach" (Legacy, Owner 31.08.2026) - `path.Flussweg` hieße „Flussweg", und das stünde doppelt
 * unter dem Untertitel. Darum haben die Sätze ihre eigene Tafel (`infoPanel.unnamed.*`,
 * `landscape.unnamed.*`) und leiten sich nicht aus `path.*`/`landscape.type.*` ab.
 */

/**
 * Die Art, die neben einem Namen steht, ohne ihn zu wiederholen (OPS-073): Heißt eine Fläche selbst nur nach ihrer Art („Wald“, weil
 * sie keinen Namen hat), steht dieselbe Art nicht noch einmal daneben. Leer heißt „keine Art zeigen“.
 */
export function artNebenName(name: string, art: string): string {
    return art === name ? "" : art;
}

/**
 * „Unbezeichneter Pfad", „Unbezeichnete Straße", „Unbezeichneter Bach".
 *
 * Eine Art ohne eigenen Satz fällt auf „Ohne Namen" - erfunden wird nichts.
 */
export function unnamedPathLabel(subtype: string, bach = false): string {
    const key = `infoPanel.unnamed.${bach && subtype === "Flussweg" ? "Bach" : subtype}`;
    return isMessageKey(key) ? t(key as MessageKey) : t("infoPanel.untitled");
}

/**
 * „Wald", „Insel", „Tal" (OPS-073; vorher „Unbezeichneter Wald" …): nur die Art, in der Sprache der Seite.
 *
 * 🪤 Eine Art ohne eigenen Satz fällt auf „Fläche" (`landscape.unnamed`) - dasselbe Wort, das
 * `landscape-names.ts` als Rückfall-Griff führt. Das trifft `sonstiges` (kein sinnvoller Satz, im Bestand
 * keine einzige aktive Fläche) und jede Art, die die Tafel noch nicht kennt.
 */
export function unnamedLandscapeLabel(type: string): string {
    const key = `landscape.unnamed.${type}`;
    return type !== "" && isMessageKey(key) ? t(key as MessageKey) : t("landscape.unnamed");
}

/**
 * Derselbe Satz für einen Kandidaten der Kartenauswahl (Flächenliste und Zeiger-Schild): Fläche, Weg oder
 * Gebiet.
 *
 * 🪤 Ein Herrschaftsgebiet bleibt bei seiner Art: Im Bestand trägt kein aktives Gebiet einen Griff (gemessen
 * 0 von 1.676), und seine Art ist ein Datenwert aus Legacy („Baronie“), keine Sprachtafel - ein Satz daraus
 * wäre erfunden.
 */
export function unnamedCandidateLabel(candidate: {
    kind: "landscape" | "path" | "territory";
    type: string;
    bach?: boolean;
}): string {
    if (candidate.kind === "path") return unnamedPathLabel(candidate.type, candidate.bach === true);
    if (candidate.kind === "territory") return candidate.type === "" ? t("areaChoice.territory") : candidate.type;
    return unnamedLandscapeLabel(candidate.type);
}
