import {
    COMMUNITY_DISCORD_ANTWORT_MAX,
    COMMUNITY_DISCORD_KURZTITEL_MAX,
    type CommunityDiscordStand,
    type CommunityDiscordZeile,
} from "@avesmaps3d/shared";
import type { DiscordOffenZeile } from "./db.ts";

/**
 * Was die Brücke nach Discord sagt (WI-0268 C8, Fachkonzept §8.3a): je offene Website-Meldung Nummer, Stand in Alltagssprache und ein Kurztitel aus Kategorie und Bezugsname.
 * 🔴 Nie Meldetext, Name oder Adresse des Melders und nie die Discord-Kennung: Die Datenbankfunktion liefert sie gar nicht erst, und diese Datei kennt nur diese vier Felder.
 */

/** Der Zustand des Vorgangs → das Wort der Brücke (`COMMUNITY_DISCORD_STAENDE`); abgeschlossen nur mit einer Antwort an den Melder (WI-0297). */
export const STAND_DER_BRUECKE: Readonly<Record<DiscordOffenZeile["zustand"], CommunityDiscordStand>> = {
    neu: "eingegangen",
    in_arbeit: "in_bearbeitung",
    rueckfrage: "rueckfrage",
    abgeschlossen: "abgeschlossen",
};

/** Die Kategorie in Alltagssprache (dieselben Wörter wie die Sprachtafel der Website, `community.kategorie.*`); für das, was nicht bekannt ist, „Meldung“. */
export const KATEGORIE_IN_ALLTAGSSPRACHE: Readonly<Record<string, string>> = {
    lage: "Lage falsch",
    name: "Name oder Schreibweise falsch",
    angabe: "Angabe falsch",
    fehlt: "Etwas fehlt",
    entfaellt: "Gibt es nicht (mehr) oder doppelt",
    sonstiges: "Sonstiges",
    frage: "Frage",
    hinweis: "Hinweis",
    mitmachen: "Mitmachen",
    lob: "Lob und Kritik",
    allgemein: "Allgemein",
    problem: "Problem",
    rechte: "Urheber- und Bildrechte",
    datenschutz: "Datenschutz",
    bewertung: "Bewertung gemeldet",
};

/** Höchste Länge des Kurztitels, den Production liefert (kürzer als der Vertrag erlaubt). */
export const KURZTITEL_LAENGE = 120;

/** Ohne Zeilenumbrüche, Steuer- und Richtungszeichen und mehrfache Leerräume: Der Bezugsname ist ein Text aus den Kartendaten und gehört nicht roh in eine Nachricht. */
function bereinigt(text: string): string {
    return (
        text
            // eslint-disable-next-line no-control-regex -- genau Steuer- und Richtungszeichen werden entfernt
            .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
            .replace(/\s+/gu, " ")
            .trim()
    );
}

/** „Lage falsch · Wehrheim“, höchstens 120 Zeichen; ohne Bezugsname nur die Kategorie. */
export function kurztitel(kategorie: string, bezugName: string | null): string {
    const art = KATEGORIE_IN_ALLTAGSSPRACHE[kategorie] ?? "Meldung";
    const bezug = bezugName === null ? "" : bereinigt(bezugName);
    const ganz = bezug === "" ? art : `${art} · ${bezug}`;
    return [...ganz].slice(0, Math.min(KURZTITEL_LAENGE, COMMUNITY_DISCORD_KURZTITEL_MAX)).join("").trim();
}

/**
 * Die Antwort der Redaktion für den Melder (WI-0297): ohne Steuer- und Richtungszeichen, Absätze bleiben, höchstens `COMMUNITY_DISCORD_ANTWORT_MAX` Zeichen, gekürzt mit „…“.
 * `null`, wenn nichts bleibt. Die Erwähnungen entschärft erst die Stage, dort, wo der Text nach Discord geht.
 */
export function antwortText(text: string): string | null {
    const sauber = text
        // eslint-disable-next-line no-control-regex -- genau Steuer- und Richtungszeichen werden entfernt, Zeilenumbrüche bleiben
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
        .replace(/[ \t]+/gu, " ")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
    if (sauber === "") return null;
    const zeichen = [...sauber];
    return zeichen.length <= COMMUNITY_DISCORD_ANTWORT_MAX
        ? sauber
        : `${zeichen
              .slice(0, COMMUNITY_DISCORD_ANTWORT_MAX - 1)
              .join("")
              .trimEnd()}…`;
}

export function zeileAus(zeile: DiscordOffenZeile): CommunityDiscordZeile {
    const text = zeile.antwort === null ? null : antwortText(zeile.antwort.text);
    return {
        nummer: zeile.nummer,
        stand: STAND_DER_BRUECKE[zeile.zustand],
        kurztitel: kurztitel(zeile.kategorie, zeile.bezugName),
        ...(text === null || zeile.antwort === null ? {} : { antwort: { text, at: zeile.antwort.at.toISOString() } }),
    };
}
