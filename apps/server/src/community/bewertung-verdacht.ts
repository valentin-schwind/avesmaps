import type { BewertungVerdacht } from "@avesmaps3d/shared";

/**
 * Spamverdacht bei einer neuen Bewertung (Fachkonzept §14.3 und §14.4, WI-0269). Ein Treffer heißt „zurückgehalten“, nie „verworfen“: Der Verfasser
 * liest „Danke! Wir sehen sie uns kurz an, bevor sie erscheint.“, die Redaktion gibt mit einem Klick frei. Ein Verdacht ist eine Vermutung, kein Urteil.
 *
 * - **Ganze Wörter statt Teilzeichenketten** (Legacy fing „seo“ in „Museo“ und „loan“ in „Gloanna“): Ein Wort zählt nur, wenn davor und dahinter
 *   kein Buchstabe und keine Ziffer steht.
 * - **Adresse im Text**: `http://`, `https://`, `www.`, eine Mailadresse oder ein Name mit einer gängigen Endung (`firma.com`). Legacy kannte nur die
 *   drei ersten.
 * - Die Wortliste ist die von Legacy (`casino`, `crypto`, `viagra`, `loan`, `betting`, `porn`, `sex`, `seo`) plus die beiden aus dem Kontaktformular
 *   (`bitcoin`, `forex`). Sie wird nach Erfahrung nachgezogen; eine Änderung ist eine Zeile hier.
 * - Geprüft werden Text und Name (beides steht öffentlich), nicht das Datum.
 */

const WOERTER = ["casino", "crypto", "viagra", "loan", "betting", "porn", "sex", "seo", "bitcoin", "forex"] as const;
const BUCHSTABE = String.raw`[\p{L}\p{N}]`;
const WORT = new RegExp(String.raw`(?<!${BUCHSTABE})(?:${WOERTER.join("|")})(?!${BUCHSTABE})`, "iu");

const ENDUNGEN = [
    "com",
    "net",
    "org",
    "de",
    "info",
    "biz",
    "ru",
    "cn",
    "xyz",
    "top",
    "shop",
    "online",
    "site",
    "club",
    "io",
    "co",
    "me",
    "tv",
    "ly",
    "link",
    "click",
    "ws",
    "cc",
] as const;
const ADRESSEN: readonly RegExp[] = [
    new RegExp(String.raw`(?<!${BUCHSTABE})https?://`, "iu"),
    new RegExp(String.raw`(?<!${BUCHSTABE})www\.`, "iu"),
    /[^\s@]+@[^\s@]+\.[a-z]{2,}/iu,
    new RegExp(String.raw`(?<!${BUCHSTABE})[\p{L}\p{N}-]+\.(?:${ENDUNGEN.join("|")})(?!${BUCHSTABE})`, "iu"),
];

export type Verdacht = { zustand: "neu"; grund: null } | { zustand: "zurueckgehalten"; grund: BewertungVerdacht };

/** `neu`, wenn nichts auffällt; sonst `zurueckgehalten` mit dem Grund (eine Adresse zählt vor der Wortliste). */
export function bewertungVerdacht(...felder: readonly (string | undefined)[]): Verdacht {
    const text = felder.filter((feld): feld is string => feld !== undefined && feld !== "").join("\n");
    if (ADRESSEN.some((muster) => muster.test(text))) return { zustand: "zurueckgehalten", grund: "adresse" };
    if (WORT.test(text)) return { zustand: "zurueckgehalten", grund: "wortliste" };
    return { zustand: "neu", grund: null };
}
