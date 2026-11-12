import { DISCORD_ZEITPLAN, sendefenster } from "@avesmaps3d/shared";

/**
 * Die Uhr des Berichts (WI-0255): Berichtstag und Sendefenster gelten in Europe/Berlin, mit Sommer- und Winterzeit. Gerechnet wird mit
 * `Intl` (die Zeitzonendaten von Node), nie mit einem festen Versatz: Am 25.10.2026 springt die Uhr um 3:00 auf 2:00 zurück, und ein Bericht
 * „um 10 Uhr“ ist dann 9:00 UTC statt 8:00. Das Fenster folgt der Uhrzeit, die die Betreiber im Reiter einstellen (`sendefenster` in `shared`).
 */

const TEILE = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISCORD_ZEITPLAN.zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

function teile(jetzt: Date): { tag: string; minuten: number } {
    const wert = (typ: Intl.DateTimeFormatPartTypes): string =>
        TEILE.formatToParts(jetzt).find((teil) => teil.type === typ)?.value ?? "00";
    return {
        tag: `${wert("year")}-${wert("month")}-${wert("day")}`,
        minuten: Number.parseInt(wert("hour"), 10) * 60 + Number.parseInt(wert("minute"), 10),
    };
}

/** Der Berichtstag (`JJJJ-MM-TT`) in Europe/Berlin. */
export function berichtstag(jetzt: Date): string {
    return teile(jetzt).tag;
}

/**
 * Liegt `jetzt` im Sendefenster zu `uhrzeit` (Berliner Zeit, von einschließlich, bis ausschließlich; vier Stunden, höchstens bis Mitternacht)? Ein
 * Lauf außerhalb sendet nicht: So holt ein Rechner, der nach einem Ausfall um 23 Uhr startet, den Bericht nicht nach (Betreiberauftrag: „Ausfall
 * darf keinen unkontrollierten Backlog erzeugen“). Verglichen wird die Wanduhr des Berliner Tages; um Mitternacht beginnt ein neuer Tag mit
 * einem neuen Fenster.
 */
export function imSendefenster(jetzt: Date, uhrzeit: string = DISCORD_ZEITPLAN.uhrzeit): boolean {
    const { minuten } = teile(jetzt);
    const fenster = sendefenster(uhrzeit);
    return minuten >= fenster.vonMinuten && minuten < fenster.bisMinuten;
}

/** Der Beginn eines Berliner Tages als Zeitpunkt (für die Suche im Kanal: „seit heute früh“). */
export function tagesbeginn(tag: string): Date {
    // Mitternacht Berlin liegt zwischen 22:00 und 23:00 UTC des Vortags; von 21:00 UTC aus die erste Minute suchen, die schon `tag` ist.
    const start = Date.parse(`${tag}T00:00:00Z`) - 3 * 3600_000;
    for (let ms = start; ms < start + 6 * 3600_000; ms += 15 * 60_000) {
        if (berichtstag(new Date(ms)) === tag) return new Date(ms);
    }
    return new Date(Date.parse(`${tag}T00:00:00Z`));
}

/** Der Tag in Worten für „seit Freitag, 23. Oktober 2026“. */
export function tagInWorten(tag: string): string {
    const mittag = new Date(`${tag}T12:00:00Z`);
    return new Intl.DateTimeFormat("de-DE", {
        timeZone: DISCORD_ZEITPLAN.zone,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    }).format(mittag);
}

/** Discords Zeitstempel als Snowflake (für `after=` beim Nachsehen): Millisekunden seit 2015 um 22 Bit verschoben. */
export function snowflakeAb(zeit: Date): string {
    const DISCORD_EPOCHE = 1_420_070_400_000n;
    const ms = BigInt(Math.max(zeit.getTime(), 1_420_070_400_000));
    return ((ms - DISCORD_EPOCHE) << 22n).toString();
}

/** Der Berichtstag als Datum der Titelzeile: `2026-10-26` → `26.10.2026` (wie die früheren Tagesberichte). */
export function datumKurz(tag: string): string {
    const [jahr = "", monat = "", tagImMonat = ""] = tag.split("-");
    return `${tagImMonat}.${monat}.${jahr}`;
}

/** Die Tageszeit, nach der der Bericht grüßt (Vali 2026-10-26: „nach tageszeit begrüßen“). */
export const TAGESZEITEN = ["morgens", "mittags", "abends"] as const;
export type Tageszeit = (typeof TAGESZEITEN)[number];

/**
 * Die Tageszeit zur gespeicherten Uhrzeit des Berichts (`HH:MM`, Berliner Zeit): bis 10:59 morgens, bis 15:59 mittags, danach abends. Es gibt nur
 * diese drei; ein Bericht um 02:00 grüßt also „morgens“. Eine ungültige Uhrzeit gilt als morgens (die Vorgabe ist 10:00).
 */
export function tageszeitVon(uhrzeit: string): Tageszeit {
    const treffer = /^(\d{2}):\d{2}$/u.exec(uhrzeit);
    const stunde = treffer === null ? 10 : Number.parseInt(treffer[1]!, 10);
    if (stunde < 11) return "morgens";
    return stunde < 16 ? "mittags" : "abends";
}
