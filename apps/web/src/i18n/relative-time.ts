import type { MessageKey } from "./de";
import { tafelVon, type Locale } from "./i18n";

/**
 * Relative Zeit für Listen und Protokolle (WI-0120 A8; Guide §24 „Zahlen und Einheiten“: „vor 21 Std.", „vor 5 Tagen",
 * „gerade eben"). Zwei Fragen, zwei Formen:
 *
 * - **`abstand`** - wie lange ist es her? Für „Letzte Anmeldung" und Sitzungen: „gerade eben", „vor 4 Min.",
 *   „vor 3 Std.", „gestern", „vor 12 Tagen". Die Stufen sind Legacys `formatPresenceAge` (js/review/review-panels.js an
 *   cbe27821): unter 30 s „gerade eben", unter 90 s „vor 1 Min.", dann gerundete Minuten ab 2, unter 24 Stunden gerundete
 *   Stunden. 🪤 Ab einem Tag zählt der KALENDER, nicht `Sekunden / 86400`: Legacy rundete 33 Stunden zu „vor 1 Tagen";
 *   hier heißt der Vortag „gestern" (Mockup, review/admin-mockup), alles davor „vor N Tagen" mit N ab 2.
 * - **`zeitpunkt`** - wann genau? Für das Protokoll: „heute, 14:03", „gestern, 22:17", „23.09., 21:05", in einem anderen
 *   Jahr mit Jahr. So stehen die Zeiten im Mockup des Protokolls.
 *
 * 🔴 Die Sprache kommt als Argument, nicht aus dem reaktiven `locale`: Die Funktion ist rein und rechnet für jede Sprache
 * dasselbe, egal was die Seite gerade zeigt. Die Wörter stehen trotzdem nur in den Sprachtafeln (`ui.time.*`).
 * Datum und Uhrzeit formatiert `Intl` mit den Gebietsschemata der Tafeln (Deutsch „23.09.", Englisch „23/09"), immer im
 * 24-Stunden-Takt wie Legacy.
 *
 * Eine Zeit in der Zukunft (die Uhr des Servers geht vor) ist „gerade eben": Ein Abstand ist nie negativ.
 */
export type ZeitArt = "abstand" | "zeitpunkt";

/**
 * Dieselben Gebietsschemata wie die Zahlen der Tafeln (`i18n.ts`): Deutsch „de-DE“, Englisch „en-GB“,
 * Französisch „fr-FR“, Niederländisch „nl-NL“, Italienisch „it-IT“, Spanisch „es-ES“.
 */
const GEBIET: Record<Locale, string> = {
    de: "de-DE",
    en: "en-GB",
    fr: "fr-FR",
    nl: "nl-NL",
    it: "it-IT",
    es: "es-ES",
    pl: "pl-PL",
    da: "da-DK",
    sv: "sv-SE",
};

const MINUTE = 60_000;
const STUNDE = 60 * MINUTE;

function text(lang: Locale, key: MessageKey, params: Readonly<Record<string, string | number>> = {}): string {
    // Die Tafel aus `i18n.ts` (WI-0235: nur Deutsch steht im Startpaket); eine noch nicht geladene Sprache spricht Deutsch.
    return (tafelVon(lang)[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = params[name];
        return value === undefined ? match : String(value);
    });
}

/** Ganze Kalendertage zwischen zwei Zeitpunkten in der Zeitzone des Betrachters: gestern 23:59 bis heute 00:01 ist ein Tag. */
function kalendertage(von: Date, bis: Date): number {
    const tagVon = Date.UTC(von.getFullYear(), von.getMonth(), von.getDate());
    const tagBis = Date.UTC(bis.getFullYear(), bis.getMonth(), bis.getDate());
    return Math.round((tagBis - tagVon) / (24 * STUNDE));
}

function uhrzeit(date: Date, lang: Locale): string {
    return new Intl.DateTimeFormat(GEBIET[lang], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function datum(date: Date, now: Date, lang: Locale): string {
    const mitJahr = date.getFullYear() !== now.getFullYear();
    return new Intl.DateTimeFormat(GEBIET[lang], {
        day: "2-digit",
        month: "2-digit",
        ...(mitJahr ? { year: "numeric" } : {}),
    }).format(date);
}

function abstand(date: Date, now: Date, lang: Locale): string {
    const ms = Math.max(0, now.getTime() - date.getTime());
    if (ms < 30_000) return text(lang, "ui.time.justNow");
    if (ms < 90_000) return text(lang, "ui.time.minutesAgo", { n: 1 });
    if (ms < STUNDE) return text(lang, "ui.time.minutesAgo", { n: Math.max(2, Math.round(ms / MINUTE)) });
    if (ms < 24 * STUNDE) {
        return text(lang, "ui.time.hoursAgo", { n: Math.min(23, Math.max(1, Math.round(ms / STUNDE))) });
    }
    const tage = Math.max(1, kalendertage(date, now));
    return tage === 1 ? text(lang, "ui.time.yesterday") : text(lang, "ui.time.daysAgo", { n: tage });
}

function zeitpunkt(date: Date, now: Date, lang: Locale): string {
    const zeit = uhrzeit(date, lang);
    const tage = kalendertage(date, now);
    if (tage === 0) return text(lang, "ui.time.todayAt", { time: zeit });
    if (tage === 1) return text(lang, "ui.time.yesterdayAt", { time: zeit });
    return text(lang, "ui.time.dateAt", { date: datum(date, now, lang), time: zeit });
}

/**
 * Wie lange `date` vor `now` liegt (`abstand`, Vorgabe) oder wann es war (`zeitpunkt`), in der Sprache `lang`.
 * Ein ungültiges Datum ergibt einen leeren Text: Lieber nichts als eine erfundene Zeit.
 */
export function relativeTime(date: Date, now: Date, lang: Locale, art: ZeitArt = "abstand"): string {
    if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return "";
    return art === "zeitpunkt" ? zeitpunkt(date, now, lang) : abstand(date, now, lang);
}
