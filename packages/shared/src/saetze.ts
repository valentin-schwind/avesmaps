/**
 * Sätze eines Wiki-Texts (WI-0260, geteilt seit WI-0257 S5): Der Server kürzt damit die Kurzbeschreibung eines Vorkommens auf höchstens drei Sätze
 * (`apps/server/src/wiki/infobox/kurzbeschreibung.ts`), die Infobox und der Sammelscreen „Ausgewählte Vorkommen“ zeigen daraus nur den ersten
 * (Vali 2026-10-30: „der erste satz reicht“). EINE Regel an beiden Stellen, damit der Browser einen Satz nie anders schneidet als der Server.
 *
 * Ein Punkt beendet keinen Satz nach einem Kürzel (`ca.`, `bzw.`, `St.`), nach einem einzelnen Buchstaben (`z. B.`, `d. h.`, `A.`), nach einer Zahl
 * (`3. Praios`) und vor einem klein geschriebenen Wort. REIN: Text hinein, Sätze hinaus.
 */

/** Die Zeichen, die PHPs `trim` ohne zweiten Parameter entfernt: Leerzeichen, \t, \n, \r, NUL, \x0B (die Regel des Servers, Legacy). */
// eslint-disable-next-line no-control-regex -- genau darum geht es: PHPs trim() entfernt NUL und \x0B
const RAND = new RegExp("^[ \\t\\n\\r\\0\\x0B]+|[ \\t\\n\\r\\0\\x0B]+$", "gu");
const ohneRand = (text: string): string => text.replace(RAND, "");

/** Kürzel, nach denen ein Punkt keinen Satz beendet (klein, ohne Punkt). */
const KUERZEL: ReadonlySet<string> = new Set([
    "ca",
    "bzw",
    "usw",
    "etc",
    "ggf",
    "evtl",
    "vgl",
    "inkl",
    "exkl",
    "max",
    "min",
    "nr",
    "dr",
    "st",
    "prof",
    "bspw",
    "sog",
    "zb",
    "ua",
    "dh",
    "ff",
    "bd",
    "kap",
    "mind",
    "ehem",
    "geb",
    "gest",
    "jh",
    "jhd",
    "tsd",
    "tl",
    "abk",
    "lat",
    "gr",
    "engl",
    "frz",
    "dt",
    "bes",
    "zt",
    "zz",
    "zzt",
    "vs",
    "sc",
]);

const SCHLIESSER = /[)\]"'“”’»«›‹]/u;
const SATZANFANG = /[\p{Lu}\d„"»«‚([‹]/u;

/** Beendet der Punkt (oder das Zeichen) an `i` einen Satz? Dann die Stelle hinter dem Satz, sonst `null`. */
function satzEnde(text: string, i: number): number | null {
    const zeichen = text.charAt(i);
    if (zeichen !== "." && zeichen !== "!" && zeichen !== "?" && zeichen !== "…") return null;
    let j = i + 1;
    while (j < text.length && /[.!?…]/u.test(text.charAt(j))) j += 1;
    while (j < text.length && SCHLIESSER.test(text.charAt(j))) j += 1;
    if (j < text.length && text.charAt(j) !== " ") return null;
    // Danach muss ein Satzanfang folgen (ein Wort in Kleinschreibung setzt den Satz fort: „… 5. bis 7. Praios“).
    let k = j;
    while (k < text.length && text.charAt(k) === " ") k += 1;
    if (k >= text.length) return j;
    if (!SATZANFANG.test(text.charAt(k))) return null;
    if (zeichen === ".") {
        // Das Wort vor dem Punkt: ein Kürzel, ein einzelner Buchstabe (`z. B.`), eine Zahl (`3. Praios`) oder `d.h.` beendet den Satz nicht.
        let anfang = i;
        while (anfang > 0 && !/[\s(„"»«‚]/u.test(text.charAt(anfang - 1))) anfang -= 1;
        const wort = text.slice(anfang, i).replace(/^[^\p{L}\d]+/u, "");
        const klein = wort.toLowerCase().replaceAll(".", "");
        if (wort !== "" && j === i + 1) {
            if (/^\d+$/u.test(wort) || /^\p{L}$/u.test(wort) || KUERZEL.has(klein) || /^(?:\p{L}\.)+\p{L}$/u.test(wort))
                return null;
        }
    }
    return j;
}

/** Zerlegt einen Absatz in Sätze (Satzzeichen bleiben am Satz). */
export function saetzeVon(text: string): string[] {
    const saetze: string[] = [];
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
        const ende = satzEnde(text, i);
        if (ende === null) continue;
        const satz = ohneRand(text.slice(start, ende));
        if (satz !== "") saetze.push(satz);
        start = ende;
        i = ende - 1;
    }
    const rest = ohneRand(text.slice(start));
    if (rest !== "") saetze.push(rest);
    return saetze;
}

/** Der erste Satz eines Texts; ein Text ohne Satzgrenze bleibt ganz, ein leerer gibt „“. */
export function ersterSatz(text: string): string {
    return saetzeVon(text.trim())[0] ?? "";
}
