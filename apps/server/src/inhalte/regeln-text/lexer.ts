import type { GliedRoh, RegelRoh, Zeichen } from "./typen.ts";

/**
 * Der Lexer von „Regeln als Text“ (WI-0254 §13; Port des Entwurfs `teile/i-text.js`): Eine Zeile wird zu Zeichen für „;“ „,“ „:“ „außer“, Links, Klammerzusätzen und Wörtern, alle mit ihrer Stelle in der
 * Zeile (`von`, `bis`). Zeichen zählen nur außerhalb von `[[…]]` und `(…)`. Rein, ohne Datenbank.
 */

const HEX = /^#([0-9a-f]{4,8})$/iu;

/** Der Quelltext von Anfang `a` bis Ende `b` (Zeichen mit zeile/von/bis[/ende]); über mehrere Zeilen mit Zeilenumbruch. */
export function quelltext(zeilen: readonly string[], a: Zeichen, b: Zeichen): string {
    const ende = b.art === "link" ? b.ende : b.bis;
    const erste = zeilen[a.zeile] ?? "";
    if (a.zeile === b.zeile) return erste.slice(a.von, ende);
    const teile = [erste.slice(a.von)];
    for (let z = a.zeile + 1; z < b.zeile; z++) teile.push(zeilen[z] ?? "");
    teile.push((zeilen[b.zeile] ?? "").slice(0, ende));
    return teile.join("\n");
}

/** Das Ende eines Zeichens in seiner Zeile (bei einem Link hinter den angehängten Buchstaben). */
export const zeichenEnde = (z: Zeichen): number => (z.art === "link" ? z.ende : z.bis);

/**
 * Zerlegt `s` ab Spalte `ab` in Zeichen. Arten:
 *   op      { zeichen: ; , : außer ohne }
 *   link    { ziel, anzeige, kennung|null, von, bis (hinter „]]“), ende (hinter angehängten Buchstaben) }
 *   klammer { text }  ein Klammerzusatz „(…)“
 *   wort    { text }
 *   kaputt  { was: link|klammer }  nicht geschlossen; der Rest der Zeile gehört dazu
 */
export function lexe(zeile: number, s: string, ab: number): Zeichen[] {
    const aus: Zeichen[] = [];
    const n = s.length;
    let i = ab;
    while (i < n) {
        const c = s[i]!;
        if (/\s/u.test(c)) {
            i++;
            continue;
        }
        if (c === ";" || c === "," || c === ":") {
            aus.push({ art: "op", zeichen: c, von: i, bis: i + 1, zeile });
            i++;
            continue;
        }
        if (c === "[" && s[i + 1] === "[") {
            const e = s.indexOf("]]", i + 2);
            if (e === -1) {
                aus.push({
                    art: "kaputt",
                    was: "link",
                    text: s.slice(i).trimEnd(),
                    von: i,
                    bis: s.trimEnd().length,
                    zeile,
                });
                break;
            }
            const inhalt = s.slice(i + 2, e);
            const bar = inhalt.indexOf("|");
            const ziel = (bar === -1 ? inhalt : inhalt.slice(0, bar)).trim();
            const anzeige = bar === -1 ? null : inhalt.slice(bar + 1).trim();
            let ende = e + 2;
            while (ende < n && /\p{L}/u.test(s[ende]!)) ende++;
            const hm = HEX.exec(ziel);
            aus.push({
                art: "link",
                ziel,
                anzeige,
                kennung: hm ? hm[1]!.toLowerCase() : null,
                von: i,
                bis: e + 2,
                ende,
                zeile,
            });
            i = ende;
            continue;
        }
        if (c === "(") {
            let tiefe = 0;
            let j = i;
            for (; j < n; j++) {
                if (s[j] === "(") tiefe++;
                else if (s[j] === ")" && --tiefe === 0) break;
            }
            if (j >= n) {
                aus.push({
                    art: "kaputt",
                    was: "klammer",
                    text: s.slice(i).trimEnd(),
                    von: i,
                    bis: s.trimEnd().length,
                    zeile,
                });
                break;
            }
            aus.push({ art: "klammer", text: s.slice(i + 1, j).trim(), von: i, bis: j + 1, zeile });
            i = j + 1;
            continue;
        }
        let j = i + 1;
        while (
            j < n &&
            !/\s/u.test(s[j]!) &&
            s[j] !== ";" &&
            s[j] !== "," &&
            s[j] !== ":" &&
            s[j] !== "(" &&
            !(s[j] === "[" && s[j + 1] === "[")
        )
            j++;
        const text = s.slice(i, j);
        if (/^(außer|ausser)$/iu.test(text)) aus.push({ art: "op", zeichen: "außer", von: i, bis: j, zeile });
        else if (/^ohne$/iu.test(text)) aus.push({ art: "op", zeichen: "ohne", von: i, bis: j, zeile });
        else aus.push({ art: "wort", text, von: i, bis: j, zeile });
        i = j;
    }
    return aus;
}

/** Die Zeichen eines Ausdrucks in Regeln (an „;“) und Glieder (an „,“ „:“ „außer“) zerlegen. */
export function gliedere(zeichen: readonly Zeichen[]): RegelRoh[] {
    const regeln: RegelRoh[] = [];
    let regel: RegelRoh = { glieder: [], davor: null };
    let g: GliedRoh = { v: "und", op: null, tokens: [] };
    for (const t of zeichen) {
        if (t.art === "op") {
            if (t.zeichen === ";") {
                regel.glieder.push(g);
                regeln.push(regel);
                regel = { glieder: [], davor: t };
                g = { v: "und", op: null, tokens: [] };
                continue;
            }
            regel.glieder.push(g);
            g = { v: t.zeichen === ":" ? "und" : t.zeichen === "," ? "oder" : "ohne", op: t, tokens: [] };
            continue;
        }
        g.tokens.push(t);
    }
    regel.glieder.push(g);
    regeln.push(regel);
    return regeln;
}
