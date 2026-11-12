import type { WikisyncLageRichtung, WikisyncRegelLage, WikisyncRegelLageOrt } from "@avesmaps3d/shared";
import type { GliedAnalyse, GliedLink, RegelWissen } from "./lesen.ts";

/**
 * Das Lesen der Lage zu einer Linie aus einem Glied (WI-0254, Bauplan „Lage zu einer Linie“, S2): „ganz [[Aventurien]] südlich von [[Festum]]“, „südlich der Linie [[Havena (Siedlung)|Havena]]–[[Perricum]]“,
 * „zwischen [[Riva]] und [[Al'Anfa]]“. REIN: keine Datenbank; die Siedlungen der Karte kommen als `RegelWissen.siedlungen` herein.
 *
 * Drei Muster, jeweils mit einem Vorsatz V vor und einem Schluss T hinter dem Satzteil (beides dürfen leer sein):
 * - `V? R von ORT T?` – R ist eine der vier Richtungen (nördlich, südlich, östlich, westlich): die Linie läuft waagerecht (Nord, Süd) oder senkrecht (Ost, West) durch den Ort;
 * - `V? R (der|einer) Linie ORT (-|–|und|bis) ORT T?` – die Linie läuft durch beide Orte, verlängert;
 * - `V? zwischen ORT und ORT T?` – zwei Bedingungen mit UND: nördlich der einen Linie, südlich der anderen (oder östlich und westlich), je nachdem, welche Richtung die beiden Orte trennt.
 *
 * 🔴 **Nie raten.** Ein Ort gilt nur, wenn GENAU EINE aktive Siedlung der Karte so heißt (Name nach NFC, getrimmt, `’` wie `'`, ohne Groß/Klein). Ist der Name mehrdeutig, unbekannt oder ein Flächenname
 * (Thorwal, Aranien …), ist der Satzteil keine Lage; dann bleibt er, was er heute ist: ein Teil mit seinem Grund (`linie`, `bezugspunkt`). Ebenso bei jedem Rest, den dieser Leser nicht ganz versteht
 * (zweite Richtung, Link im Schluss, mehr als ein Ort-Paar …). Vorsatz und Schluss werden erst in `bewerten.ts` als Glieder gelesen und bewertet (`bewerteLage`); dieser Leser liefert nur ihren Rohtext.
 *
 * Gelesen wird auf `GliedAnalyse.aussen`: Jeder Ortslink ist dort ein `§` (mit seiner Endung), in der Reihenfolge von `links`.
 */

/** Die Siedlungen der Karte nach dem Schlüssel ihres Namens (`ortsSchluessel`); mehr als ein Eintrag heißt: der Name ist mehrdeutig. */
export type SiedlungsKatalog = ReadonlyMap<string, readonly WikisyncRegelLageOrt[]>;

/** Der Schlüssel eines Siedlungsnamens: NFC, Leerraum ein Leerzeichen, getrimmt, `’` wie `'`, klein. */
export const ortsSchluessel = (name: string): string =>
    name
        .normalize("NFC")
        .replace(/[’‘`´]/gu, "'")
        .replace(/\s+/gu, " ")
        .trim()
        .toLowerCase();

export type LageForm = "von" | "linie" | "zwischen";

/** Was gelesen wurde: die Form, der Rohtext vor und hinter dem Satzteil und die Lagen (bei „zwischen“ zwei, sonst eine). */
export interface LageLesung {
    form: LageForm;
    /** Der Text vor dem Satzteil, Links als `[[ziel|anzeige]]endung`; leer, wo nichts davor steht. */
    vorsatzRoh: string;
    /** Der Text hinter dem Satzteil; nie mit Link. */
    schlussRoh: string;
    lagen: WikisyncRegelLage[];
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Zeichen
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Zeichen {
    art: "link" | "wort" | "strich" | "sonst";
    text: string;
    start: number;
    ende: number;
    /** Bei einem Link: seine Stelle in `links`. */
    link: number;
}

/** Ein Ortslink (`§` mit Endung), ein Wort (mit Apostroph im Wort: „Al'Anfa“), ein Strich oder ein anderes Zeichen. */
const ZEICHEN = /§[\p{L}\p{N}_]*|[\p{L}\p{N}_]+(?:['’][\p{L}\p{N}_]+)*|[-–—]|\S/gu;

function zerlege(aussen: string): Zeichen[] {
    const aus: Zeichen[] = [];
    let links = 0;
    for (const treffer of aussen.matchAll(ZEICHEN)) {
        const text = treffer[0];
        const start = treffer.index ?? 0;
        const art = text.startsWith("§")
            ? "link"
            : /^[-–—]$/u.test(text)
              ? "strich"
              : /^[\p{L}\p{N}_]/u.test(text)
                ? "wort"
                : "sonst";
        aus.push({ art, text, start, ende: start + text.length, link: art === "link" ? links++ : -1 });
    }
    return aus;
}

const RICHTUNGEN: Readonly<Record<string, WikisyncLageRichtung>> = {
    nördlich: "nord",
    südlich: "sued",
    östlich: "ost",
    westlich: "west",
};

const ohneKlammer = (titel: string): string => titel.replace(/\s*\([^)]*\)\s*$/u, "").trim();

/** Die Schreibweise eines Links als Rohtext für die Lesung von Vorsatz und Schluss. */
function rohLink(link: GliedLink): string {
    const anzeige =
        link.suffix === "" ? link.label : link.label.slice(0, Math.max(0, link.label.length - link.suffix.length));
    return `[[${link.ziel}|${anzeige}]]${link.suffix}`;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Das Lesen
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ein Ort der Karte: eindeutig, sonst `null` (unbekannt oder mehrdeutig). */
function eindeutig(name: string, wissen: RegelWissen): WikisyncRegelLageOrt | null {
    const treffer = wissen.siedlungen?.(name) ?? [];
    return treffer.length === 1 ? (treffer[0] ?? null) : null;
}

/** Ein Ortslink: nur eine Siedlung (oder ein Ziel ohne Artikel, `fehlt`) kann ein Ort sein, nie eine Fläche; der Name ist das Ziel ohne Klammerzusatz, bei `fehlt` zuerst der Anzeigetext. */
function ortVonLink(link: GliedLink | undefined, wissen: RegelWissen): WikisyncRegelLageOrt | null {
    if (link === undefined || (link.cls !== "siedlung" && link.cls !== "fehlt")) return null;
    const anzeige =
        link.suffix === "" ? link.label : link.label.slice(0, Math.max(0, link.label.length - link.suffix.length));
    const namen = link.cls === "fehlt" ? [anzeige, ohneKlammer(link.ziel)] : [ohneKlammer(link.ziel)];
    for (const name of namen) {
        const treffer = wissen.siedlungen?.(name) ?? [];
        if (treffer.length === 1) return treffer[0] ?? null;
        // Mehrdeutig: nie raten, auch nicht über den zweiten Namen.
        if (treffer.length > 1) return null;
    }
    return null;
}

const kopie = (ort: WikisyncRegelLageOrt): WikisyncRegelLageOrt => ({
    kennung: ort.kennung,
    name: ort.name,
    x: ort.x,
    y: ort.y,
});

interface OrtTreffer {
    ort: WikisyncRegelLageOrt;
    /** Das erste Zeichen hinter dem Ort. */
    weiter: number;
}

/**
 * „zwischen A und B“ als zwei Lagen, in der Reihenfolge der Nennung: Trennt die Karte die Orte vorwiegend nach Norden und Süden (|Δy| ≥ |Δx|), steht der nördlichere Ort für `sued`, der südlichere für
 * `nord`; sonst der östlichere für `west`, der westlichere für `ost`. Beide Bedingungen zusammen (UND) treffen den Streifen zwischen den Linien durch die beiden Orte.
 */
export function zwischenLagen(
    a: WikisyncRegelLageOrt,
    b: WikisyncRegelLageOrt,
): [WikisyncRegelLage, WikisyncRegelLage] {
    const nordSued = Math.abs(a.y - b.y) >= Math.abs(a.x - b.x);
    const [ra, rb]: [WikisyncLageRichtung, WikisyncLageRichtung] = nordSued
        ? a.y >= b.y
            ? ["sued", "nord"]
            : ["nord", "sued"]
        : a.x >= b.x
          ? ["west", "ost"]
          : ["ost", "west"];
    return [
        { richtung: ra, orte: [kopie(a)] },
        { richtung: rb, orte: [kopie(b)] },
    ];
}

/**
 * Liest die Lage zu einer Linie aus einem Glied, oder `null`, wo das Glied keine (ganz verstandene) hat. Ohne Siedlungen im Wissen ist es immer `null`.
 */
export function leseLage(glied: GliedAnalyse, wissen: RegelWissen): LageLesung | null {
    if (wissen.siedlungen === undefined) return null;
    // Billig zuerst: Eine Richtung oder „zwischen“ muss im Glied stehen (die Merkmale „Bezugspunkt“ und „Linie“ sagen es).
    if (!glied.quals.has("bezugspunkt") && !glied.quals.has("linie")) return null;
    const aussen = glied.aussen;
    const zeichen = zerlege(aussen);
    if (zeichen.filter((z) => z.art === "link").length !== glied.links.length) return null;

    const klein = (index: number): string => {
        const z = zeichen[index];
        return z?.art === "wort" ? z.text.toLowerCase() : "";
    };
    const richtungen = zeichen.flatMap((_z, index) => (Object.hasOwn(RICHTUNGEN, klein(index)) ? [index] : []));
    const zwischen = zeichen.flatMap((_z, index) => (klein(index) === "zwischen" ? [index] : []));

    // Die Orte: ein Link (nur Siedlung) oder Klartext (der Name ist eine eindeutige Siedlung und kein Flächenname).
    const flaechenNamen = wissen.flaechenNamen();
    const istFlaeche = (name: string): boolean =>
        flaechenNamen.has(name.toLowerCase()) || wissen.flaechen(name).length > 0;
    const orte = (von: number): OrtTreffer[] => {
        const z = zeichen[von];
        if (z === undefined) return [];
        if (z.art === "link") {
            const ort = ortVonLink(glied.links[z.link], wissen);
            return ort === null ? [] : [{ ort, weiter: von + 1 }];
        }
        if (z.art !== "wort") return [];
        const aus: OrtTreffer[] = [];
        for (let bis = von; bis < zeichen.length && bis < von + 8; bis += 1) {
            const letztes = zeichen[bis] as Zeichen;
            if (letztes.art === "wort") {
                const name = aussen.slice(z.start, letztes.ende);
                const ort = istFlaeche(name) ? null : eindeutig(name, wissen);
                if (ort !== null) aus.push({ ort, weiter: bis + 1 });
            } else if (letztes.art === "strich") {
                // Ein Strich gehört nur zum Namen, wo er ohne Abstand zwischen zwei Wörtern steht („Hôt-Alem“); „A - B“ trennt.
                const davor = zeichen[bis - 1];
                const danach = zeichen[bis + 1];
                if (
                    davor === undefined ||
                    danach === undefined ||
                    davor.ende !== letztes.start ||
                    danach.start !== letztes.ende ||
                    danach.art !== "wort"
                )
                    break;
            } else break;
        }
        return aus;
    };
    const roh = (von: number, bis: number): string => {
        let text = "";
        let stelle = zeichen[von]?.start ?? 0;
        for (let index = von; index < bis; index += 1) {
            const z = zeichen[index] as Zeichen;
            text += aussen.slice(stelle, z.start);
            text += z.art === "link" ? rohLink(glied.links[z.link] as GliedLink) : z.text;
            stelle = z.ende;
        }
        return text.trim();
    };
    /** Der Schluss darf keinen Link tragen (ein zweiter Ort wäre ein weiterer Satzteil). */
    const schlussRoh = (von: number): string | null =>
        zeichen.slice(von).some((z) => z.art === "link") ? null : roh(von, zeichen.length);
    const fertig = (form: LageForm, beginn: number, weiter: number, lagen: WikisyncRegelLage[]): LageLesung | null => {
        const schluss = schlussRoh(weiter);
        return schluss === null ? null : { form, vorsatzRoh: roh(0, beginn), schlussRoh: schluss, lagen };
    };
    /** Von mehreren Lesarten desselben Orts oder Ort-Paars gilt die längste; zwei verschiedene Ergebnisse sind keine. */
    const waehle = <T extends { weiter: number }>(treffer: readonly T[], schluessel: (t: T) => string): T | null => {
        if (treffer.length === 0 || new Set(treffer.map(schluessel)).size !== 1) return null;
        return treffer.reduce((a, b) => (b.weiter > a.weiter ? b : a));
    };

    if (richtungen.length === 1 && zwischen.length === 0) {
        const p = richtungen[0] as number;
        const richtung = RICHTUNGEN[klein(p)] as WikisyncLageRichtung;
        // R von ORT
        if (klein(p + 1) === "von") {
            const treffer = waehle(orte(p + 2), (t) => t.ort.kennung);
            if (treffer === null) return null;
            return fertig("von", p, treffer.weiter, [{ richtung, orte: [kopie(treffer.ort)] }]);
        }
        // R der Linie ORT (-|–|und|bis) ORT
        if ((klein(p + 1) === "der" || klein(p + 1) === "einer") && klein(p + 2) === "linie") {
            const paare: { a: WikisyncRegelLageOrt; b: WikisyncRegelLageOrt; weiter: number }[] = [];
            for (const erster of orte(p + 3)) {
                const trenner = zeichen[erster.weiter];
                if (trenner === undefined) continue;
                if (trenner.art !== "strich" && klein(erster.weiter) !== "und" && klein(erster.weiter) !== "bis")
                    continue;
                for (const zweiter of orte(erster.weiter + 1))
                    paare.push({ a: erster.ort, b: zweiter.ort, weiter: zweiter.weiter });
            }
            const treffer = waehle(paare, (t) => [t.a.kennung, t.b.kennung].sort().join(","));
            if (treffer === null || treffer.a.kennung === treffer.b.kennung) return null;
            return fertig("linie", p, treffer.weiter, [{ richtung, orte: [kopie(treffer.a), kopie(treffer.b)] }]);
        }
        return null;
    }
    if (zwischen.length === 1 && richtungen.length === 0) {
        // zwischen ORT und ORT
        const p = zwischen[0] as number;
        const paare: { a: WikisyncRegelLageOrt; b: WikisyncRegelLageOrt; weiter: number }[] = [];
        for (const erster of orte(p + 1)) {
            if (klein(erster.weiter) !== "und") continue;
            for (const zweiter of orte(erster.weiter + 1))
                paare.push({ a: erster.ort, b: zweiter.ort, weiter: zweiter.weiter });
        }
        // Die Reihenfolge der Nennung gehört zur Lesung (A–B und B–A zeichnen verschiedene Bedingungen in dieser Reihenfolge).
        const treffer = waehle(paare, (t) => `${t.a.kennung},${t.b.kennung}`);
        if (treffer === null || treffer.a.kennung === treffer.b.kennung) return null;
        return fertig("zwischen", p, treffer.weiter, zwischenLagen(treffer.a, treffer.b));
    }
    return null;
}
