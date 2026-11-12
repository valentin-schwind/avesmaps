import { DISCORD_BERICHT_MAX } from "@avesmaps3d/shared";
import { PUNKTZEILE, kuerze, satzKuerze } from "./muster.ts";
import { GEMEINSCHAFT_KOPF, LINK } from "./vorlage.ts";

/**
 * Der Bericht in mehreren Nachrichten (WI-0255; Vali 2026-11-02 auf die Frage „mehrere Nachrichten oder eine mit Zusammenfassung“: „wenn A geht!?“).
 * Passen die Punkte nicht in eine Nachricht, schickt der Bericht mehrere hintereinander, jede unter `DISCORD_BERICHT_MAX` Zeichen, und es kommen ALLE
 * Punkte: kein „… und n weitere“ mehr, auch nicht unter Community.
 *
 * - Der Text, den die Vorlage oder der Formulierer liefert, ist EIN Text; das Modell schreibt nicht je Teil. Erst hier teilt die App ihn.
 * - **Nur an Punktgrenzen**, nie mitten in einem Punkt (einer Zeile mit „• “). Die Überschriften, unter denen ein Punkt stand (der Teil „Was ist neu?“, der
 *   Bereich „Fehler behoben“, die Gruppe „Bugs“), stehen in jeder Nachricht wieder über ihren Punkten; eine Überschrift ohne Punkt darunter gibt es nie.
 * - **Gruß nur in der ersten Nachricht** (der Absatz vor der ersten Leerzeile: Titelzeile und Gruß), **Link, Dank und Unterschrift nur in der letzten**
 *   (`schlussstart`: die Zeilen ab dem Link, dem Dank-Abschnitt oder dem Gruß am Ende).
 * - Eine Nachricht füllt sich, bis der nächste Punkt (mit den Überschriften, die er braucht) nicht mehr passt; dann beginnt die nächste. Absätze ohne
 *   Punkte (etwa der Satz zu einem leeren Teil) bleiben ganz zusammen.
 * - Fehlt der erwartete Aufbau (Punkte schon im Kopfabsatz) oder passt Text, der kein Punkt ist, auch allein in keine Nachricht, ist das Ergebnis `null`:
 *   Der Formulierer verliert dann gegen die Vorlage, deren Aufbau diese Funktion kennt. Ein einzelner Punkt, der allein zu lang ist, wird an Satzgrenzen
 *   gekürzt (Notfall; kein Punkt hat annähernd 1900 Zeichen).
 */

/** Zwischen den Nachrichten in der Vorschau (Reiter, Kommandozeile): So sieht die Betreiberin, wo Discord den Bericht trennt. */
export const NACHRICHTEN_TRENNER = "\n\n— nächste Nachricht —\n\n";

interface Einheit {
    /** Die Überschriften über dieser Zeile, äußerste zuerst. */
    kontext: string[];
    zeile: string;
}

/** Ab welcher Zeile gehört der Rest zur letzten Nachricht: der Link, der Dank-Abschnitt (mit Gruß) oder nur der Gruß am Ende. */
function schlussstart(zeilen: readonly string[]): number {
    let start = zeilen.length - 1;
    const dank = zeilen.findLastIndex((zeile) => zeile.startsWith(GEMEINSCHAFT_KOPF));
    if (dank >= 0 && zeilen.slice(dank).every((zeile) => zeile.trim() !== "")) start = dank;
    let davor = start - 1;
    while (davor >= 0 && zeilen[davor]!.trim() === "") davor -= 1;
    if (davor >= 0 && zeilen[davor]!.trim() === LINK) start = davor;
    return start;
}

/** Ein Absatz mit Punkten in Einheiten: jeder Punkt mit den Überschriften über ihm; Text hinter dem letzten Punkt trägt nur die Überschrift des Absatzes. */
function einheitenVon(absatz: readonly string[]): Einheit[] {
    const letzterPunkt = absatz.findLastIndex((zeile) => PUNKTZEILE.test(zeile));
    const kopf = PUNKTZEILE.test(absatz[0]!) ? [] : [absatz[0]!];
    const einheiten: Einheit[] = [];
    let lauf: string[] = [];
    let vorherPunkt = false;
    absatz.forEach((zeile, index) => {
        const istPunkt = PUNKTZEILE.test(zeile);
        if (!istPunkt && index < letzterPunkt) {
            // Eine Überschrift über den folgenden Punkten; steht sie hinter einem Punkt, beginnt sie einen neuen Lauf von Überschriften.
            lauf = vorherPunkt ? [zeile] : [...lauf, zeile];
            vorherPunkt = false;
            return;
        }
        const kontext = istPunkt ? [...kopf, ...lauf.filter((ueberschrift) => !kopf.includes(ueberschrift))] : kopf;
        einheiten.push({ kontext, zeile });
        vorherPunkt = true;
    });
    return einheiten;
}

const gemeinsam = (a: readonly string[], b: readonly string[]): number => {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
    return n;
};

/**
 * Der Text als Nachrichten mit höchstens `max` Zeichen. Passt er in eine, ist das Ergebnis diese eine, unverändert. `null`, wenn der Aufbau nicht teilbar
 * ist (siehe oben).
 */
export function teileBericht(text: string, max: number = DISCORD_BERICHT_MAX): string[] | null {
    if (text.length <= max) return [text];
    const alle = text.replace(/\r\n?/gu, "\n").trimEnd().split("\n");
    const start = schlussstart(alle);
    const schluss = alle.slice(start);
    const koerper = alle.slice(0, start);

    // Die Absätze, durch Leerzeilen getrennt; der erste ist der Kopf mit Titelzeile und Gruß.
    const absaetze: string[][] = [];
    let offenerAbsatz: string[] | null = null;
    for (const zeile of koerper) {
        if (zeile.trim() === "") {
            offenerAbsatz = null;
            continue;
        }
        if (offenerAbsatz === null) {
            offenerAbsatz = [];
            absaetze.push(offenerAbsatz);
        }
        offenerAbsatz.push(zeile);
    }
    const kopf = absaetze.shift();
    const passt = (zeilen: readonly string[]): boolean => zeilen.join("\n").length <= max;
    if (kopf === undefined || kopf.some((zeile) => PUNKTZEILE.test(zeile)) || !passt(kopf)) return null;

    const nachrichten: string[][] = [];
    let aktuell: string[] = [...kopf];
    let offen: string[] = [];
    const schliesse = (): void => {
        if (aktuell.length > 0) nachrichten.push(aktuell);
        aktuell = [];
        offen = [];
    };
    /**
     * Setzt die Zeile mit den Überschriften, die in dieser Nachricht noch fehlen, ans Ende; passt sie nicht, beginnt eine neue Nachricht mit allen
     * Überschriften. Ein neuer Absatz beginnt nach einer Leerzeile. `false`: auch allein zu lang (und nicht `kuerzbar`: nur ein einzelner Punkt wird gekürzt,
     * nie ein Absatz ohne Punkte oder der Schluss).
     */
    const setze = (
        kontext: readonly string[],
        zeilen: readonly string[],
        neuerAbsatz: boolean,
        kuerzbar = false,
    ): boolean => {
        const schon = neuerAbsatz ? 0 : gemeinsam(kontext, offen);
        const trenner = neuerAbsatz && aktuell.length > 0 ? [""] : [];
        const angehaengt = [...aktuell, ...trenner, ...kontext.slice(schon), ...zeilen];
        if (passt(angehaengt)) {
            aktuell = angehaengt;
            offen = [...kontext];
            return true;
        }
        schliesse();
        let allein = [...kontext, ...zeilen];
        if (!passt(allein)) {
            if (!kuerzbar) return false;
            // Ein einzelner Punkt, der mit seinen Überschriften nie passt: an Satzgrenzen kürzen, sonst am Wortende.
            const frei = max - [...kontext, ""].join("\n").length;
            const roh = zeilen.join(" ");
            const kurz = frei > 20 ? satzKuerze(roh, frei) || kuerze(roh, frei) : "";
            if (kurz === "") return false;
            allein = [...kontext, kurz];
        }
        aktuell = allein;
        offen = [...kontext];
        return true;
    };

    for (const absatz of absaetze) {
        if (!absatz.some((zeile) => PUNKTZEILE.test(zeile))) {
            if (!setze([], absatz, true)) return null;
            continue;
        }
        let neu = true;
        for (const einheit of einheitenVon(absatz)) {
            if (!setze(einheit.kontext, [einheit.zeile], neu, true)) return null;
            neu = false;
        }
    }
    if (!setze([], schluss, true)) return null;
    schliesse();
    return nachrichten.map((zeilen) => zeilen.join("\n"));
}
