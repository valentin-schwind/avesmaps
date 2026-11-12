/**
 * Was in einem öffentlichen Discord-Text nie stehen darf (WI-0255), an EINER Stelle für den Faktenfilter (`fakten.ts`) und die Prüfung vor dem
 * Versand (`pruefung.ts`). Dazu die Hilfen für den Bericht und die Posts: echte Umlaute (`berichtSatz`), ganze Sätze (`satzKuerze`, `ersteSaetze`) und
 * Texte von Nutzern (`nutzerText`).
 */
import { echteUmlaute } from "./umlaute.ts";

/** Eine Punktzeile: beginnt (nach Einrückung) mit „•“, „-“, „*“ oder „–“ und einem Leerzeichen. `**fett**` zählt nicht. */
export const PUNKTZEILE = /^\s*(?:•|[-*–])\s+\S/u;

/** Eine Erwähnung: Person, Rolle, Kanal, `@everyone`, `@here`. */
export const ERWAEHNUNG = /<@[!&]?\d+>|<#\d+>|@(?:everyone|here)\b/iu;
/** Eine interne Vorgangs- oder Planungskennung. */
export const KENNUNG = /\b(?:WI|OPS|SYS|EDIT|ADR|MCS|KANAL|FREIGABE|VERSION|NACHRICHT|AUTH|JOBS)-\d/u;
/** Eine Commit-Kennung: 7 bis 40 Hex-Zeichen mit mindestens einer Ziffer und einem Buchstaben (sonst träfe es Zahlen und Wörter). */
export const COMMIT = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/u;

/**
 * Taugt ein redigierter Satz (`Neu:`-Zeile) für die Öffentlichkeit? Nein, wenn er eine Kennung, eine Commit-Kennung oder eine Erwähnung trägt:
 * Dann bleibt er weg, statt den ganzen Bericht an der Prüfung scheitern zu lassen.
 */
export function satzTauglich(satz: string): boolean {
    return !KENNUNG.test(satz) && !COMMIT.test(satz) && !ERWAEHNUNG.test(satz);
}

/**
 * Sätze, die SELBST sagen, dass niemand etwas davon bemerkt („Zwischenschritt … ohne eigene sichtbare Wirkung“, „zu sehen ist das noch nicht“). Sie stehen
 * als `Neu:`-Zeile da, weil die Zeile für die Betreiber der Meldung „Neue Version“ geschrieben ist; im Tagesbericht haben sie nichts verloren (Vali
 * 2026-11-03: „interna weg lassen ja“, also nichts, was keine Person auf avesmaps.de oder in Discord bemerkt). Eng gehalten: Nur der Wortlaut, der die
 * Unsichtbarkeit ausdrücklich sagt, nie ein bloßes „nicht sichtbar“ (das kann ein echtes Merkmal sein, etwa bei verborgenen Orten).
 */
export const OHNE_SICHTBARE_WIRKUNG = new RegExp(
    [
        "ohne\\s+(?:eigene[nr]?\\s+|jede\\s+|jegliche\\s+)?(?:sichtbare|erkennbare|spürbare)[nr]?\\s+(?:wirkung|auswirkung|änderung|veränderung|effekt)",
        "zu\\s+sehen\\s+ist\\s+(?:das|es|davon)\\s+noch\\s+nicht",
        "noch\\s+nichts\\s+zu\\s+sehen",
        "(?:für|bei)\\s+(?:kartenbesucher|besucher|leser|nutzer)\\w*\\s+(?:\\p{L}+\\s+){0,3}?(?:noch\\s+)?(?:nicht|nie)\\s+(?:sichtbar|zu\\s+sehen|spürbar)",
    ]
        .map((teil) => `(?<![\\p{L}])${teil}(?![\\p{L}])`)
        .join("|"),
    "iu",
);

/**
 * Die Umgebungen und Werkzeuge der Entwickler beim Namen: Die Stage ist geschlossen, der Release-Test und der Entwicklungsrechner sind es erst recht. Ein
 * Satz, der sie nennt, erzählt von der Arbeitsweise, nicht von etwas, das Besucher oder die Leser des Tagesberichts bemerken. „Production“ gehört nicht
 * dazu: „Bearbeiten in Production“ ist für Editoren eine echte Neuerung. Groß geschrieben, damit „Backstage“ und „stage“ als Wort nicht treffen.
 */
export const ENTWICKLUNGSUMGEBUNG = /(?<![\p{L}\p{N}])(?:Stage|Release-Test|Entwicklungsrechner)(?![\p{L}\p{N}])/u;

/** Ein Satz ohne Wirkung für Besucher und Leser: er sagt es selbst, oder er erzählt von der Entwicklungsumgebung. Er kommt nicht in den Bericht. */
export const istIntern = (satz: string): boolean =>
    OHNE_SICHTBARE_WIRKUNG.test(satz) || ENTWICKLUNGSUMGEBUNG.test(satz);

/** Eine Aussage über Künftiges oder einen Zwischenstand: Sie ist beim Erscheinen des Berichts oft schon überholt („die Korrektur selbst läuft erst noch“). */
const VORBEHALT =
    /(?<![\p{L}])(?:erst\s+noch|folgt\s+(?:noch|später|demnächst)|kommt\s+(?:noch|später|demnächst)|steht\s+noch\s+aus|sobald)(?![\p{L}])/iu;

/**
 * Der Satz ohne seine Vorbehalte über Künftiges: Ein Teil hinter einem Strichpunkt und eine Klammer am Ende, die so etwas sagen, fallen weg; der erste Teil
 * bleibt immer, damit nie ein leerer Satz übrig ist. Der Bericht erzählt, was jetzt gilt (die `Neu:`-Zeile ist eine Momentaufnahme des Commits).
 */
export function ohneVorbehalt(satz: string): string {
    const ende = /[.!?]$/u.exec(satz.trim())?.[0] ?? "";
    const ohneKlammer = satz.replace(/\s*\([^()]*\)(?=[.!?]?$)/u, (klammer) =>
        VORBEHALT.test(klammer) ? "" : klammer,
    );
    const [erster = "", ...weitere] = ohneKlammer.split(/;\s+/u);
    const geblieben = [erster, ...weitere.filter((teil) => !VORBEHALT.test(teil))];
    if (geblieben.length === 1 && geblieben[0] === satz) return satz;
    const text = geblieben.join("; ").trim();
    return ende !== "" && !/[.!?]$/u.test(text) ? `${text}${ende}` : text;
}

/**
 * Ein Satz aus einer `Neu:`-Zeile, sicher für Discord: keine Verweise (die Prüfung ließe nur avesmaps.de zu), kein Markdown, das die Liste
 * zerreißt, kein `@`, das jemanden anpingen könnte (zusätzlich zu `allowed_mentions`, das Discord jede Erwähnung verbietet). Für die Vorlage und
 * für die Eingabe des Formulierers: Ein Modell sieht denselben bereinigten Satz.
 */
export function sichererSatz(satz: string): string {
    return satz
        .replace(/https?:\/\/\S+/gu, "")
        .replace(/[\r\n]+/gu, " ")
        .replace(/[*_~`|>\\]/gu, "")
        .replace(/@/gu, "@​")
        .replace(/\s+/gu, " ")
        .trim();
}

/** `sichererSatz` mit echten Umlauten (`umlaute.ts`): für Sätze und Titel, die im Bericht stehen (nicht für `/offen` und die Posts). */
export const berichtSatz = (satz: string): string => echteUmlaute(sichererSatz(satz));

/** Ein Satz einer `Neu:`-Zeile, wie ihn die Vorlage und die Eingabe des Formulierers führen: bereinigt, mit echten Umlauten und ohne Vorbehalte über Künftiges. */
export const neuSatz = (satz: string): string => ohneVorbehalt(berichtSatz(satz));

/** `oeffentlichGekuerzt` mit echten Umlauten: Titel und Befunde aus dem Kanal, wie der Bericht sie zeigt. */
export const berichtGekuerzt = (text: string, max: number): string => echteUmlaute(oeffentlichGekuerzt(text, max));

/**
 * Der Befund eines Vorgangs für den Bericht: wie `oeffentlichGekuerzt` (leer, wo er nicht öffentlich taugt), mit echten Umlauten, aber nie mitten im Satz
 * gekürzt: Ist er länger als `max`, bleiben nur seine ganzen ersten Sätze, und passt nicht einmal der erste, entfällt er (`satzKuerze`).
 */
export const berichtBefund = (text: string, max: number): string =>
    echteUmlaute(satzKuerze(oeffentlichGekuerzt(text, 10_000), max));

/** Kürzel, nach denen ein Punkt kein Satzende ist (`z. B.`, `bzw.`); einzelne Buchstaben („z.“, „B.“, „d.“) zählen immer so. */
const KUERZEL = new Set([
    "bzw",
    "ca",
    "usw",
    "etc",
    "ggf",
    "vgl",
    "nr",
    "evtl",
    "inkl",
    "max",
    "min",
    "dr",
    "prof",
    "abb",
    "bspw",
    "sog",
    "ggü",
]);

/**
 * Der Text in ganzen Sätzen. Ein Satz endet mit `.`, `!` oder `?`, gefolgt von Leerraum und einem Großbuchstaben, einer Ziffer oder einem Anführungszeichen;
 * nach einem Kürzel (`z. B.`, `bzw.`) endet er nicht. Der Rest ohne Satzzeichen am Ende ist ein (unvollständiger) letzter Satz.
 */
export function saetzeVon(text: string): string[] {
    const saetze: string[] = [];
    let start = 0;
    const ende = /[.!?]+(?=\s)/gu;
    for (let treffer = ende.exec(text); treffer !== null; treffer = ende.exec(text)) {
        const bis = treffer.index + treffer[0].length;
        const wort = /([\p{L}]+)\.?$/u.exec(text.slice(start, treffer.index + 1))?.[1] ?? "";
        const ordnungszahl = /\d$/u.test(text.slice(start, treffer.index));
        const kuerzel = treffer[0] === "." && (ordnungszahl || wort.length === 1 || KUERZEL.has(wort.toLowerCase()));
        const weiter = /^\s+(.)/u.exec(text.slice(bis))?.[1] ?? "";
        if (kuerzel || !/[\p{Lu}\d„"“»(‚'🌀-🫿]/u.test(weiter)) continue;
        saetze.push(text.slice(start, bis).trim());
        start = bis;
    }
    const rest = text.slice(start).trim();
    if (rest !== "") saetze.push(rest);
    return saetze;
}

/**
 * Endet der Text mit einem Satzzeichen (auch vor einer schließenden Klammer, einem Anführungszeichen oder einem Symbol)? Drei Punkte und „…“ sind kein Ende,
 * sondern ein Abbruch.
 */
export function endetAlsSatz(text: string): boolean {
    const ende = text.trim();
    if (/(?:\.{2,}|…)["“”»'’)\]]*$/u.test(ende)) return false;
    return /[.!?]["“”»'’)\]]*(?:\s*[\p{Extended_Pictographic}\u{FE0F}\u{200D}])*$/u.test(ende);
}

/**
 * Höchstens `max` Zeichen, aber nur aus ganzen Sätzen (Vali 2026-11-02: ein Punkt endet nie mitten im Satz). Passt schon der erste Satz nicht, ist das
 * Ergebnis leer: Dann lässt der Aufrufer den Text lieber weg, als ihn abzuschneiden.
 */
export function satzKuerze(text: string, max: number): string {
    if (text.length <= max) return text;
    let aus = "";
    for (const satz of saetzeVon(text)) {
        const naechster = aus === "" ? satz : `${aus} ${satz}`;
        if (naechster.length > max || !endetAlsSatz(satz)) break;
        aus = naechster;
    }
    return aus;
}

/**
 * Die ersten ein bis `anzahl` Sätze, zusammen höchstens `max` Zeichen (für den Post einer Meldung). Passt schon der erste Satz nicht, wird er am Wortende
 * gekürzt und mit „…“ beendet: Es ist der Text einer anderen Person, den wir hier nur anreißen.
 */
export function ersteSaetze(text: string, anzahl: number, max: number): string {
    const saetze = saetzeVon(text).slice(0, anzahl);
    let aus = "";
    for (const satz of saetze) {
        const naechster = aus === "" ? satz : `${aus} ${satz}`;
        if (naechster.length > max) break;
        aus = naechster;
    }
    return aus !== "" ? aus : kuerze(text, max);
}

/**
 * Text einer Person aus Discord für einen öffentlichen Post (`/bug`, `/idee`): eine Zeile, ohne Markdown (auch ohne `[Text](Adresse)`, die Zeichen
 * `* _ ~ \` | > \\` fallen weg), ohne Verweise, ohne Erwähnungen (`<@…>`, `<#…>`, `@everyone`, `@here`), ohne Steuer- und Richtungszeichen und mit höchstens `max`
 * Zeichen. Zusätzlich verhindert `allowed_mentions` des Posts jeden Ping, außer der meldenden Person. Die Umlaute bleiben, wie die Person sie schrieb.
 */
export function nutzerText(text: string, max: number): string {
    let aus = "";
    for (const zeichen of text.normalize("NFC")) {
        const code = zeichen.codePointAt(0)!;
        if (code < 32 || code === 127 || (code >= 0x80 && code < 0xa0)) aus += " ";
        else if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) continue;
        else if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0x2060 || code === 0xfeff) continue;
        else aus += zeichen;
    }
    const ohne = aus
        .replace(/<(?:@[!&]?|#|a?:\w+:|t:)[^>\s]*>?/giu, "")
        // Die Platzhalter, die `entschaerft` (interaktion.ts) beim Speichern an die Stelle einer Erwähnung setzt, sind im öffentlichen Post nur Rauschen.
        .replace(/@(?:Person|Rolle)(?![\p{L}\p{N}])|#Kanal(?![\p{L}\p{N}])/gu, "")
        .replace(/@(?:everyone|here)/giu, "")
        .replace(/@/gu, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1");
    // Was wie ein Verweis aussieht (auch ohne Schema), fällt als ganzes Wort weg: Discord machte es anklickbar.
    const rein = sichererSatz(ohne)
        .split(" ")
        .filter((wort) => !LINKARTIG.test(wort))
        .join(" ")
        // Am Anfang der Zeile machte Discord aus „# …“, „- …“, „1. …“ eine Überschrift oder Liste.
        .replace(/^(?:[#\-+•]+|\d+[.)])\s*/u, "")
        .trim();
    return kuerze(rein, max);
}

/** Auf `max` Zeichen gekürzt, am Wortende, mit „…“. */
export function kuerze(text: string, max: number): string {
    if (text.length <= max) return text;
    const schnitt = text.slice(0, max - 1);
    const leerzeichen = schnitt.lastIndexOf(" ");
    return `${(leerzeichen > max / 2 ? schnitt.slice(0, leerzeichen) : schnitt).replace(/[\s,;:.–—-]+$/u, "")}…`;
}

/**
 * Sieht etwas aus wie ein Verweis? `http(s):`, `www.` oder ein Name mit Punkt und Endung (`beispiel.de`, `discord.gg/x`). Die Prüfung vor dem Versand
 * lässt nur avesmaps.de zu; fremder Text (Meldungen aus Discord) darf auch keinen Verweis ohne Schema tragen, den Discord anklickbar machen würde.
 */
export const LINKARTIG = /https?:|www\.|[\p{L}\p{N}-]{2,}\.[\p{L}]{2,}/iu;

/**
 * Hintergrund aus dem Verlauf (Betreff und Beschreibung eines Commits) für die Eingabe des Formulierers (WI-0255 §3e). Das Modell soll verstehen und
 * einordnen, nicht abschreiben: Sätze mit Betreiberzitaten fallen weg; Kennungen, Commit-Kennungen, Verweise, Datei- und Feldnamen werden
 * herausgenommen (nicht der ganze Text verworfen), danach wie ein Satz bereinigt und gekürzt. Die harte Grenze bleibt die Prüfung des Berichts.
 */
export function hintergrund(text: string, max: number): string {
    const ohneZitate = text
        .replace(/[„"“»][^„"“”»«\n]{0,400}[“”"«]/gu, "")
        .split(/(?<=[.!?:])\s+/u)
        .filter((satz) => !/\b(Betreiber|Vali)\b/u.test(satz))
        .join(" ");
    const rein = sichererSatz(
        ohneZitate
            .replace(/https?:\/\/\S+|www\.\S+/giu, "")
            .replace(new RegExp(KENNUNG.source.replace("-\\d", "-\\d[\\w.-]*"), "gu"), "")
            .replace(new RegExp(COMMIT.source, "gu"), "")
            .replace(new RegExp(ERWAEHNUNG.source, "giu"), "")
            .replace(/[\p{L}\p{N}_/-]*[\p{L}\p{N}_-]\.[\p{L}]{2,}\b/gu, "")
            .replace(/\b[\p{L}\p{N}]+_[\p{L}\p{N}_]+\b/gu, ""),
    )
        .replace(/[,;]\s*(?=[,;)])/gu, "")
        .replace(/\(\s*[,;]?\s*\)/gu, "")
        .replace(/\s+([,.;:)])/gu, "$1")
        .replace(/\s+/gu, " ")
        .replace(/^[\s,.;:]+/u, "")
        .trim();
    return rein === "" ? "" : echteUmlaute(kuerze(rein, max));
}

/**
 * Ein Text aus dem Kanal, den ein Betreiber gesehen hat, für den öffentlichen Bericht: bereinigt (`sichererSatz`), gekürzt, und leer, wenn er eine
 * Kennung, eine Commit-Kennung, eine Erwähnung oder einen Verweis trägt (dann steht an seiner Stelle nur die Nummer des Vorgangs).
 */
export function oeffentlichGekuerzt(text: string, max: number): string {
    const satz = sichererSatz(text);
    return satz === "" || !satzTauglich(satz) || LINKARTIG.test(satz) ? "" : kuerze(satz, max);
}

/**
 * Der Anzeigename einer meldenden Person (Discord-Name oder Name einer Person der App): nur Buchstaben, Ziffern, Leerzeichen und `. _ ' -`, höchstens
 * 40 Zeichen, ohne Verweis, Kennung oder Commit-Kennung; sonst `null` (dann steht kein Name da). Discord erlaubt fast alles in einem Namen.
 */
export function sicherMelder(name: string | null): string | null {
    if (name === null) return null;
    const rein = name
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N} ._'-]/gu, "")
        .replace(/\s+/gu, " ")
        .trim();
    if (rein === "" || LINKARTIG.test(rein) || KENNUNG.test(rein) || COMMIT.test(rein) || /\d{10,}/u.test(rein))
        return null;
    return kuerze(rein, 40);
}
