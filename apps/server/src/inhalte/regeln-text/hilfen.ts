/**
 * Vergleichsformen und „ähnlich“ für „Regeln als Text“ (WI-0254 §13; Port des Entwurfs `teile/i-text.js`). Rein, ohne Datenbank.
 */

/** Vergleichsform: klein, ß=ss, Akzente weg (NFD), Apostroph und Strich vereinheitlicht, Leerraum normalisiert. */
export const norm = (s: string | null | undefined): string =>
    String(s ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/gu, "")
        .toLowerCase()
        .replace(/ß/gu, "ss")
        .replace(/[’‘´`]/gu, "'")
        .replace(/[–—‐‑]/gu, "-")
        .replace(/\s+/gu, " ")
        .trim();

/** Für die festen Wortlisten (Arten, Zonen, Richtungen): zusätzlich ae/oe/ue gleich ä/ö/ü, damit „gemaessigt“ und „gemäßigt“ dasselbe sind. */
export const kurz = (s: string | null | undefined): string =>
    norm(s).replace(/ae/gu, "a").replace(/oe/gu, "o").replace(/ue/gu, "u");

/** Die ersten acht Zeichen einer Kennung: so steht sie in `[[#xxxxxxxx|Name]]`. */
export const kennungAnfang = (id: string): string => String(id).slice(0, 8);

/** Ein Kandidat zum Vorschlagen: mindestens die Vergleichsform. */
export interface Kandidat {
    norm: string;
}

/** Der Abstand zweier Wörter nach Levenshtein, abgebrochen, sobald er über `grenze` liegt (dann `grenze + 1`). */
function abstand(a: string, b: string, grenze: number): number {
    if (Math.abs(a.length - b.length) > grenze) return grenze + 1;
    let vor = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const akt = [i];
        let kleinster = i;
        for (let j = 1; j <= b.length; j++) {
            const k = Math.min(
                (vor[j] ?? 0) + 1,
                (akt[j - 1] ?? 0) + 1,
                (vor[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
            akt.push(k);
            if (k < kleinster) kleinster = k;
        }
        if (kleinster > grenze) return grenze + 1;
        vor = akt;
    }
    return vor[b.length] ?? grenze + 1;
}

/** Die höchstens `max` ähnlichsten Kandidaten: gemeinsamer Anfang, Abstand bis 2 (bis 3 bei langen Wörtern), sonst enthalten. */
export function naechste<T extends Kandidat>(wort: string, kandidaten: readonly T[], max = 3): T[] {
    const grenze = wort.length >= 9 ? 3 : 2;
    const treffer: { k: T; punkte: number }[] = [];
    for (const k of kandidaten) {
        const c = k.norm;
        if (c === wort) continue;
        let punkte: number | null = null;
        if (wort.length >= 3 && c.startsWith(wort)) punkte = 1 + (c.length - wort.length) / 100;
        else if (c.length >= 3 && wort.startsWith(c)) punkte = 1.5 + (wort.length - c.length) / 100;
        else {
            const d = abstand(wort, c, grenze);
            if (d <= grenze) punkte = 2 + d;
            else if (wort.length >= 4 && c.includes(wort)) punkte = 6 + (c.length - wort.length) / 100;
        }
        if (punkte !== null) treffer.push({ k, punkte });
    }
    treffer.sort((a, b) => a.punkte - b.punkte || a.k.norm.length - b.k.norm.length || (a.k.norm < b.k.norm ? -1 : 1));
    return treffer.slice(0, max).map((t) => t.k);
}

/** Bis zu `max` Vorschläge mit verschiedenem Anzeigenamen (`anzeige(k)`). */
export function vorschlaege<T extends Kandidat>(
    wort: string,
    kandidaten: readonly T[],
    anzeige: (k: T) => string,
    max = 3,
): T[] {
    const aus: T[] = [];
    for (const v of naechste(wort, kandidaten, 16)) {
        if (aus.length < max && !aus.some((x) => anzeige(x) === anzeige(v))) aus.push(v);
    }
    return aus;
}

/** Ein Ziel, das ohne Umwege in einem Link stehen kann. */
export const gutesZiel = (z: string): boolean =>
    z !== "" && z === z.trim() && !/[|[\]\r\n]/u.test(z) && !z.startsWith("#");

/** Ein Name, der als Anzeige hinter dem `|` eines Links stehen darf. */
export const gutAlsAnzeige = (z: string): boolean => z !== "" && !/[|[\]\r\n]/u.test(z);
