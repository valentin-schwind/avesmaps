/**
 * Fließtext eines Fensters mit Auszeichnung - aus der Sprachtafel, ohne HTML (WI-0045).
 *
 * Erklärtexte brauchen Betonung und Verweise (Legacy schrieb `<em>`, `<b>` und `<a>` in die
 * Übersetzung und setzte sie per `innerHTML`). Hier steht in der Tafel eine kleine, feste Schreibweise,
 * und `fenster-text.vue` baut daraus Knoten - nie `v-html`, damit kein Text je Markup wird:
 *
 * | Schreibweise | wird |
 * |---|---|
 * | `*Wort*` | kursiv (Betonung im Satz) |
 * | `**Satz**` | betont (`--color-text-strong`, Guide §3: Farbe, nicht Gewicht) |
 * | `[Text](https://…)` | Verweis nach draußen, mit ↗ |
 * | Zeile mit `- ` am Anfang | ein Punkt einer Aufzählung (WI-0076: weniger Textwand) |
 * | Leerzeile | neuer Absatz |
 *
 * Alles andere bleibt Text, auch ein einzelner Stern. Ein Verweis, der nicht mit `http://` oder
 * `https://` beginnt, bleibt ebenfalls Text - ein `javascript:` kommt so nie in ein `href`.
 */

export type TextTeil =
    | { art: "text"; text: string }
    | { art: "kursiv"; text: string }
    | { art: "betont"; text: string }
    | { art: "verweis"; text: string; ziel: string };

const AUSZEICHNUNG = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** Nur ein Ziel nach draußen über http(s) wird ein Verweis - ein `javascript:` kommt nie in ein `href`. */
export function istVerweisZiel(ziel: string): boolean {
    return /^https?:\/\/\S+$/.test(ziel);
}

export function zerlegeText(text: string): TextTeil[] {
    const teile: TextTeil[] = [];
    let bis = 0;
    for (const treffer of text.matchAll(AUSZEICHNUNG)) {
        const anfang = treffer.index;
        if (anfang > bis) teile.push({ art: "text", text: text.slice(bis, anfang) });
        const [, betont, kursiv, verweis, ziel] = treffer;
        if (betont !== undefined) teile.push({ art: "betont", text: betont });
        else if (kursiv !== undefined) teile.push({ art: "kursiv", text: kursiv });
        else if (verweis !== undefined && ziel !== undefined) teile.push({ art: "verweis", text: verweis, ziel });
        bis = anfang + treffer[0].length;
    }
    if (bis < text.length) teile.push({ art: "text", text: text.slice(bis) });
    return teile;
}

/** Ein Block eines Erklärtexts: ein Absatz oder eine Aufzählung, jeder Punkt mit seiner Auszeichnung. */
export type TextBlock = { art: "absatz"; teile: TextTeil[] } | { art: "liste"; punkte: TextTeil[][] };

/**
 * Zerlegt einen Erklärtext in Absätze und Aufzählungen (WI-0076, Betreiber 2026-10-04: „könntest du mit absätzen,
 * bullet-points oder so arbeiten“): Eine Zeile mit `- ` am Anfang ist ein Punkt, eine Leerzeile beendet einen Absatz,
 * aufeinanderfolgende Textzeilen bilden einen Absatz. Ein Text ohne Zeilenumbruch ist genau ein Absatz.
 */
export function zerlegeBloecke(text: string): TextBlock[] {
    const bloecke: TextBlock[] = [];
    let absatz: string[] = [];
    let punkte: string[] = [];
    const absatzEnde = (): void => {
        if (absatz.length > 0) bloecke.push({ art: "absatz", teile: zerlegeText(absatz.join(" ")) });
        absatz = [];
    };
    const listeEnde = (): void => {
        if (punkte.length > 0) bloecke.push({ art: "liste", punkte: punkte.map(zerlegeText) });
        punkte = [];
    };
    for (const zeile of text.split("\n")) {
        const punkt = /^- (.+)$/.exec(zeile.trim());
        if (punkt) {
            absatzEnde();
            punkte.push(punkt[1] as string);
        } else if (zeile.trim() === "") {
            absatzEnde();
            listeEnde();
        } else {
            listeEnde();
            absatz.push(zeile.trim());
        }
    }
    absatzEnde();
    listeEnde();
    return bloecke;
}
