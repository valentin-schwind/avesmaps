/**
 * Welche Zeichen die Hausschrift kann, und was das PDF an ihrer Stelle setzt (WI-0306). Faculty Glyphic (OFL) trägt Latein mit allen
 * Buchstaben der neun Sprachen, „·“, „–“, „•“, „−“ und die Anführungszeichen, aber keine Pfeile (→ ↑ ↓), keinen Kreis (●) und keinen
 * schmalen Zwischenraum (U+202F, der Tausendertrenner im Französischen). pdfmake setzte für sie ein leeres Kästchen.
 *
 * - **Die Abdeckung liest das PDF aus der Schrift selbst** (`abdeckung`, Tafel `cmap` der TTF), nicht aus einer Liste: Eine andere
 *   Fassung der Schrift ändert sie mit.
 * - **Ersetzt wird sauber** (`saeuberer`): erst nach der Tafel `ERSATZ` (→ wird „–“, ↑ „+“, ↓ „−“, ● „•“, U+202F das geschützte
 *   Leerzeichen), dann ohne Akzent, wenn nur der fehlt („ő“ ohne Doppelakut wäre „o“), sonst „?“. Steuerzeichen fallen weg, Zeilenumbrüche
 *   bleiben. Kreise und Pfeile, die das PDF zeichnen will, malt es als Vektor (`dokument.ts`), nie als Zeichen.
 */

/** Ersatz für Zeichen, die die Schrift nicht hat; ein leerer Text heißt: fällt weg. */
export const ERSATZ: Readonly<Record<string, string>> = {
    "→": "–",
    "←": "–",
    "↔": "–",
    "↑": "+",
    "↓": "−",
    "↗": "",
    "●": "•",
    "○": "•",
    " ": " ",
    " ": " ",
    " ": " ",
    " ": " ",
    " ": " ",
    " ": " ",
    "‐": "-",
    "‑": "-",
    "¹": "1",
    "²": "2",
    "³": "3",
    "​": "",
    "‌": "",
    "‍": "",
    "⁠": "",
    "︎": "",
    "️": "",
};

const lies16 = (daten: DataView, stelle: number): number => daten.getUint16(stelle);
const lies32 = (daten: DataView, stelle: number): number => daten.getUint32(stelle);

/** Die Zeichen einer TrueType-Schrift (Tafel `cmap`, Format 4 oder 12), als Prüfung je Codepunkt. */
export function abdeckung(ttf: ArrayBuffer): (codepunkt: number) => boolean {
    const daten = new DataView(ttf);
    const tafeln = lies16(daten, 4);
    let cmap = -1;
    for (let i = 0; i < tafeln; i += 1) {
        const eintrag = 12 + i * 16;
        const name = String.fromCharCode(
            daten.getUint8(eintrag),
            daten.getUint8(eintrag + 1),
            daten.getUint8(eintrag + 2),
            daten.getUint8(eintrag + 3),
        );
        if (name === "cmap") cmap = lies32(daten, eintrag + 8);
    }
    if (cmap < 0) throw new Error("Schrift ohne cmap");
    const unterTafeln = lies16(daten, cmap + 2);
    let format4 = -1;
    let format12 = -1;
    for (let i = 0; i < unterTafeln; i += 1) {
        const eintrag = cmap + 4 + i * 8;
        const plattform = lies16(daten, eintrag);
        const kodierung = lies16(daten, eintrag + 2);
        const stelle = cmap + lies32(daten, eintrag + 4);
        const format = lies16(daten, stelle);
        if (format === 12 && plattform === 3 && kodierung === 10) format12 = stelle;
        if (format === 4 && (plattform === 3 || plattform === 0)) format4 = format4 < 0 ? stelle : format4;
    }
    const da = new Set<number>();
    if (format12 >= 0) {
        const gruppen = lies32(daten, format12 + 12);
        for (let i = 0; i < gruppen; i += 1) {
            const g = format12 + 16 + i * 12;
            const von = lies32(daten, g);
            const bis = lies32(daten, g + 4);
            const glyphe = lies32(daten, g + 8);
            for (let c = von; c <= bis; c += 1) if (glyphe + (c - von) !== 0) da.add(c);
        }
    } else if (format4 >= 0) {
        const segmente = lies16(daten, format4 + 6) / 2;
        const enden = format4 + 14;
        const anfaenge = enden + segmente * 2 + 2;
        const deltas = anfaenge + segmente * 2;
        const versaetze = deltas + segmente * 2;
        for (let s = 0; s < segmente; s += 1) {
            const bis = lies16(daten, enden + s * 2);
            const von = lies16(daten, anfaenge + s * 2);
            const delta = daten.getInt16(deltas + s * 2);
            const versatz = lies16(daten, versaetze + s * 2);
            for (let c = von; c <= bis && c !== 0xffff; c += 1) {
                const glyphe =
                    versatz === 0
                        ? (c + delta) & 0xffff
                        : (() => {
                              const roh = lies16(daten, versaetze + s * 2 + versatz + (c - von) * 2);
                              return roh === 0 ? 0 : (roh + delta) & 0xffff;
                          })();
                if (glyphe !== 0) da.add(c);
            }
        }
    } else {
        throw new Error("Schrift ohne Unicode-cmap");
    }
    return (codepunkt) => da.has(codepunkt);
}

/** Ein Säuberer für Texte des PDFs: Jedes Zeichen steht in der Schrift oder wird ersetzt (siehe Kopf). Einmal geprüfte Zeichen merkt er sich. */
export function saeuberer(kann: (codepunkt: number) => boolean): (text: string) => string {
    const gemerkt = new Map<string, string>();
    const fuer = (zeichen: string): string => {
        const bekannt = gemerkt.get(zeichen);
        if (bekannt !== undefined) return bekannt;
        const punkt = zeichen.codePointAt(0) ?? 0;
        let aus: string;
        if (zeichen === "\n") aus = "\n";
        else if (zeichen === "\t") aus = " ";
        else if (punkt < 0x20 || (punkt >= 0x7f && punkt < 0xa0)) aus = "";
        else if (kann(punkt)) aus = zeichen;
        else if (ERSATZ[zeichen] !== undefined) aus = ERSATZ[zeichen];
        else {
            const ohneAkzent = zeichen.normalize("NFD").replace(/[̀-ͯ]/g, "");
            aus =
                ohneAkzent !== "" && ohneAkzent !== zeichen && [...ohneAkzent].every((z) => kann(z.codePointAt(0) ?? 0))
                    ? ohneAkzent
                    : "?";
        }
        gemerkt.set(zeichen, aus);
        return aus;
    };
    return (text) => {
        let aus = "";
        for (const zeichen of text) aus += fuer(zeichen);
        return aus;
    };
}
