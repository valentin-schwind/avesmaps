import { STAPEL_ANONYM, STAPEL_BOT, TITEL_ABFRAGE_MAX_KODIERT } from "./konstanten.ts";

/**
 * Stapelgröße und Abfragetext (WI-0253 B-1, B1-Vertrag; Legacy `avesmapsWikiSyncNextTitleBatch`, der Fehler vom 25.08.2026).
 *
 * 💣 GESTAPELT WIRD NACH ZWEI GRÖSSEN, UND DIE KLEINERE GEWINNT: nach Titelzahl (50, als angemeldeter Bot 500) UND nach kodierter Länge von
 * `titles=`. Solange die Anmeldung scheiterte, waren es 50 Titel und alles passte; in der Minute, in der sie ging, wurden 500 Titel und über
 * 15.000 Zeichen daraus, und das Wiki antwortete mit 414. Der Fehler lag nicht an der Stelle, sondern an einem Nachbarteil, der zu
 * funktionieren begann.
 */

export type StapelStatus = "unversucht" | "anonym" | "bot" | "gescheitert";

/** Die Titelzahl folgt dem ZUSTAND, nicht der Hoffnung: 500 nur für `bot` und nur, solange das Wiki sie nicht abgewiesen hat. */
export function stapelGroesse(status: StapelStatus, abgewiesen = false): number {
    return status === "bot" && !abgewiesen ? STAPEL_BOT : STAPEL_ANONYM;
}

/** Wie PHPs `rawurlencode` (RFC 3986): auch `! ' ( ) *` werden kodiert, damit die Länge eine obere Grenze ist. */
export function kodiere(wert: string): string {
    return encodeURIComponent(wert).replace(
        /[!'()*]/gu,
        (zeichen) => `%${zeichen.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

/** Der Abfragetext `a=b&c=d` in der Reihenfolge der Eingabe, jeder Wert kodiert; ein Titelstapel ist EIN Wert mit `|`. */
export function baueAbfrage(params: Readonly<Record<string, string>>): string {
    return Object.entries(params)
        .map(([name, wert]) => `${kodiere(name)}=${kodiere(wert)}`)
        .join("&");
}

export interface TitelStapel {
    titel: string[];
    /** Wo der nächste Stapel beginnt (`offset` plus Zahl der Titel). */
    naechsterOffset: number;
}

/**
 * Der nächste Titelstapel ab `offset`. Ein Stapel ist nie leer, solange Titel offen sind, auch wenn ein einzelner Titel die Länge allein
 * sprengt: Ein leerer Stapel ließe den Zeiger des Aufrufers stehen, ein übersprungener Titel verlöre lautlos eine Seite. So einer fährt
 * allein, und die Anfrage scheitert dann sichtbar (`url_zu_lang` im Client). Gerechnet wird die KODIERTE Länge: ein Umlaut sind sechs
 * Zeichen, das Trennzeichen `|` drei.
 */
export function naechsterTitelStapel(
    titel: readonly string[],
    offset: number,
    maxAnzahl: number,
    maxKodiert: number = TITEL_ABFRAGE_MAX_KODIERT,
): TitelStapel {
    const start = Math.max(0, offset);
    const grenze = Math.max(1, maxAnzahl);
    const stapel: string[] = [];
    let laenge = 0;
    for (let index = start; index < titel.length && stapel.length < grenze; index += 1) {
        const eintrag = titel[index] ?? "";
        const kosten = kodiere(eintrag).length + (stapel.length === 0 ? 0 : 3);
        if (stapel.length > 0 && laenge + kosten > maxKodiert) break;
        stapel.push(eintrag);
        laenge += kosten;
    }
    return { titel: stapel, naechsterOffset: start + stapel.length };
}
