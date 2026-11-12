/**
 * Die Auszeichnung im Text der Hinweise (`config/legal/notices.json`, Schlüssel `hinweise`): rein, ohne Vue, und nie HTML. `hinweise-text.vue` baut aus den Knoten Elemente, darum kann kein Text je Markup werden.
 *
 * | Schreibweise | wird |
 * |---|---|
 * | `**Text**` | die Textschattierung: heller Ton, nie Fett (die Hausschrift hat keinen Fettschnitt) |
 * | `[Text](https://…)` | ein Verweis nach draußen, mit ↗ |
 * | `[Text](mailto:…)` | die Adresse, ohne ↗ |
 * | `[Text](#kennung)` | ein Sprung im Fenster |
 *
 * Beides lässt sich ineinander schachteln: `**vor [Text](#a) nach**` und `[**Text**](#a)`. Ein einzelner Stern bleibt Text, auch in einer Adresse (`A*-Algorithmus`). Ein Ziel mit einem anderen Schema wird kein Verweis,
 * sein Text bleibt stehen: So kommt ein `javascript:` nie in ein `href`.
 *
 * Eine Schwester von `fenster/fenster-text.ts`, die aus zwei Gründen nicht reicht: Sie kennt weder die Schachtelung noch die Ziele im Fenster.
 */

export type InlineKnoten =
    | { art: "text"; text: string }
    | { art: "hell"; kinder: InlineKnoten[] }
    | { art: "link"; ziel: string; kinder: InlineKnoten[] };

/** `[Text](Ziel)`, das Ziel ohne Leerraum, runde Klammern darin höchstens eine Ebene tief (`…/Ort_(Berg)`). */
const LINK = /\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/uy;

/** Die erlaubten Schemata; alles andere bleibt Text. */
export function istHinweisZiel(ziel: string): boolean {
    return /^https?:\/\/\S+$/u.test(ziel) || /^mailto:\S+$/u.test(ziel) || /^#[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(ziel);
}

function linkAn(text: string, stelle: number): RegExpExecArray | null {
    LINK.lastIndex = stelle;
    return LINK.exec(text);
}

/** Wo eine Schattierung endet, die ab `von` läuft: Ein `**` innerhalb eines Verweises zählt nicht. */
function endeDerSchattierung(text: string, von: number): number {
    let stelle = von;
    while (stelle < text.length) {
        if (text[stelle] === "[") {
            const link = linkAn(text, stelle);
            if (link) {
                stelle += link[0].length;
                continue;
            }
        }
        if (text.startsWith("**", stelle)) return stelle;
        stelle += 1;
    }
    return -1;
}

export function zerlegeInline(text: string): InlineKnoten[] {
    const knoten: InlineKnoten[] = [];
    let puffer = "";
    const leere = (): void => {
        if (puffer !== "") knoten.push({ art: "text", text: puffer });
        puffer = "";
    };
    let stelle = 0;
    while (stelle < text.length) {
        if (text.startsWith("**", stelle)) {
            const ende = endeDerSchattierung(text, stelle + 2);
            if (ende > stelle + 2) {
                leere();
                knoten.push({ art: "hell", kinder: zerlegeInline(text.slice(stelle + 2, ende)) });
                stelle = ende + 2;
                continue;
            }
        }
        if (text[stelle] === "[") {
            const link = linkAn(text, stelle);
            if (link) {
                const [ganz, beschriftung = "", ziel = ""] = link;
                leere();
                const kinder = zerlegeInline(beschriftung);
                if (istHinweisZiel(ziel)) knoten.push({ art: "link", ziel, kinder });
                else knoten.push(...kinder);
                stelle += ganz.length;
                continue;
            }
        }
        puffer += text.charAt(stelle);
        stelle += 1;
    }
    leere();
    return knoten;
}

/** Nur die Wörter: für ein `aria-label`, für Tests und den Vergleich mit einer Vorlage. */
export function klartextVon(knoten: readonly InlineKnoten[]): string {
    return knoten.map((k) => (k.art === "text" ? k.text : klartextVon(k.kinder))).join("");
}

export function klartext(text: string): string {
    return klartextVon(zerlegeInline(text));
}

/** Alle Ziele eines Texts, auch die in einer Schattierung. */
export function zieleVon(knoten: readonly InlineKnoten[]): string[] {
    return knoten.flatMap((k) => {
        if (k.art === "text") return [];
        return k.art === "link" ? [k.ziel, ...zieleVon(k.kinder)] : zieleVon(k.kinder);
    });
}
