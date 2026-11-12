/**
 * Der Schlüssel der Wiki-Objektlinks (WI-0063 4.6, Vertrag `subject-details.yaml`, Abschnitt `objektlinks`).
 *
 * 🔴 Legacy vergleicht bei `?siedlung=`, `?staat=`, `?region=`, `?strasse=` und `?fluss=` weder den Wiki-Titel noch den
 * `wiki_key`, sondern den normalisierten Seitenanteil der GESPEICHERTEN Wiki-Adresse des Objekts mit dem normalisierten
 * Wert des Parameters. Diese Datei ist dieselbe Rechnung, Zeichen für Zeichen: `normalizeWikiDeeplinkKey` und
 * `wikiUrlToDeeplinkKey` in Legacys `js/app/wiki-deeplink.js` (Discovery-Mirror, `avesmaps@b9657635a`). Wer sie ändert,
 * ändert, welche Wiki-Seite welches Objekt öffnet - und bricht damit Links, die auf avesmaps.de zeigen (AGENTS.md,
 * „Links von Legacy bleiben gültig“).
 *
 * Der Schlüssel wird NICHT gespeichert: Er ist eine reine Funktion der Adresse. Server und Oberfläche bilden ihn aus
 * derselben Quelle; ein Test hält die Fälle gegen Legacys Verhalten fest (`wiki-link-key.test.ts`).
 */

/** Der Bereich der kombinierenden Zeichen, den Legacy nach der Zerlegung (NFD) entfernt. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Der Seitenname, normalisiert: Prozent-Dekodierung (ein `+` vorher zu Leerzeichen; schlägt sie fehl, gilt der Rohwert),
 * `_` zu Leerzeichen, NFD, ohne kombinierende Zeichen, klein, `ß` zu `ss`, `æ` zu `ae`, `œ` zu `oe`, nur `a-z0-9`.
 * Legacy: `normalizeWikiDeeplinkKey`.
 */
export function wikiPageNameKey(value: string | null | undefined): string {
    const raw = String(value ?? "");
    let decoded = raw;
    try {
        decoded = decodeURIComponent(decoded.replace(/\+/g, " "));
    } catch {
        // Kaputte Prozentkodierung: der Rohwert bleibt, die Normalisierung unten ergibt trotzdem einen Schlüssel.
        decoded = raw;
    }
    return decoded
        .replace(/_/g, " ")
        .normalize("NFD")
        .replace(COMBINING_MARKS, "")
        .toLowerCase()
        .replace(/ß/g, "ss")
        .replace(/æ/g, "ae")
        .replace(/œ/g, "oe")
        .replace(/[^a-z0-9]+/g, "")
        .trim();
}

/**
 * Der Schlüssel einer Wiki-Adresse oder eines Seitennamens: der Anteil nach `/wiki/` (bis `?` oder `#`), ohne `/wiki/` bei
 * einer Adresse das letzte Pfadsegment, sonst der Wert selbst; dann `wikiPageNameKey`. Leer, wenn nichts Brauchbares da ist.
 * Legacy: `wikiUrlToDeeplinkKey`.
 */
export function wikiLinkKey(value: string | null | undefined): string {
    const raw = String(value ?? "").trim();
    if (raw === "") {
        return "";
    }
    let pageSegment = raw;
    const wikiMatch = /\/wiki\/([^?#]+)/i.exec(raw);
    if (wikiMatch) {
        pageSegment = wikiMatch[1] as string;
    } else if (/^https?:\/\//i.test(raw)) {
        // Eine Adresse ohne `/wiki/` (nicht erwartet): das letzte Pfadsegment.
        const tail = (raw.split(/[?#]/)[0] as string).split("/").filter(Boolean).pop();
        pageSegment = tail ?? raw;
    }
    return wikiPageNameKey(pageSegment);
}
