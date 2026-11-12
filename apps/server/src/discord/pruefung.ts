import { DISCORD_BERICHT_TEILE_MAX, DISCORD_INHALT_MAX, DISCORD_SCHLUSS } from "@avesmaps3d/shared";
import { COMMIT, ERWAEHNUNG, KENNUNG, LINKARTIG, OHNE_SICHTBARE_WIRKUNG, PUNKTZEILE, endetAlsSatz } from "./muster.ts";
import { TEILE, type BerichtKontext } from "./punkte.ts";
import { GEMEINSCHAFT_ERKENNUNG, LINK, ersteZeile } from "./vorlage.ts";

/**
 * Die Qualitätskontrolle vor jedem Versand (WI-0255; Betreiberauftrag: „die Discord-Tagesmeldung wird nach automatischen Qualitätskontrollen
 * selbstständig publiziert“). Sie prüft den fertigen Text, nicht seine Absicht; ein roter Befund heißt: nicht senden.
 *
 * - Kopf mit dem Berichtstag (Icon, Name und Datum, `ersteZeile`) in der ersten und Schluss „Eure Claudia und Claudio“ in der letzten Nachricht; jede
 *   Nachricht höchstens 2000 Zeichen, der Bericht höchstens `DISCORD_BERICHT_TEILE_MAX` Nachrichten (`pruefeTeile`).
 * - 🔴 Kein Ping: keine Erwähnung einer Person, Rolle oder eines Kanals, kein `@everyone`/`@here` (dazu verbietet `allowed_mentions` Discord
 *   jede Erwähnung).
 * - Keine internen Kennungen (`WI-`, `OPS-`, …) und keine Commit-Kennungen.
 * - Kein Verweis außer auf avesmaps.de (die Stage ist geschlossen, alles andere ist nicht unseres).
 * - 🔴 Kein Geheimnis: Steht der Bot-Schlüssel im Text, geht nichts hinaus.
 */

const VERWEIS = /https?:\/\/[^\s<>]+/giu;

export interface Pruefergebnis {
    ok: boolean;
    fehler: string[];
}

/** Was jede einzelne Nachricht erfüllen muss, gleich welche es ist: kein Ping, keine Kennung, kein Commit, kein fremder Verweis, kein Schlüssel. */
function pruefeInhalt(text: string, geheimnis?: string): string[] {
    const fehler: string[] = [];
    if (ERWAEHNUNG.test(text)) fehler.push("Erwähnung (Ping) im Text");
    if (KENNUNG.test(text)) fehler.push("interne Kennung im Text");
    if (COMMIT.test(text)) fehler.push("Commit-Kennung im Text");
    for (const treffer of text.matchAll(VERWEIS)) {
        if (!treffer[0].startsWith(LINK)) fehler.push(`fremder Verweis: ${treffer[0].slice(0, 60)}`);
    }
    if (geheimnis !== undefined && geheimnis.length >= 8 && text.includes(geheimnis)) fehler.push("Geheimnis im Text");
    return fehler;
}

/**
 * Die Nachrichten des Berichts vor dem Versand: die erste beginnt mit dem Kopf des Tages, die letzte endet mit dem Gruß, jede hat höchstens 2000 Zeichen und
 * erfüllt `pruefeInhalt`; mehr als `DISCORD_BERICHT_TEILE_MAX` Nachrichten sind ein Überlauf und rot (dann geht der Bericht ohne die Community-Liste,
 * `formulierer.ts`).
 */
export function pruefeTeile(teile: readonly string[], tag: string, geheimnis?: string): Pruefergebnis {
    const fehler: string[] = [];
    if (teile.length === 0) fehler.push("kein Text");
    if (teile.length > DISCORD_BERICHT_TEILE_MAX) {
        fehler.push(`zu viele Nachrichten: ${String(teile.length)} von ${String(DISCORD_BERICHT_TEILE_MAX)}`);
    }
    teile.forEach((teil, index) => {
        const wo = teile.length > 1 ? `Nachricht ${String(index + 1)}: ` : "";
        if (teil.length > DISCORD_INHALT_MAX) {
            fehler.push(`zu lang: ${wo}${String(teil.length)} von ${String(DISCORD_INHALT_MAX)} Zeichen`);
        }
        for (const befund of pruefeInhalt(teil, geheimnis)) fehler.push(`${wo}${befund}`);
    });
    if (teile.length > 0 && !teile[0]!.startsWith(ersteZeile(tag))) fehler.push("Kopf mit dem Berichtstag fehlt");
    if (teile.length > 0 && !teile.at(-1)!.trimEnd().endsWith(DISCORD_SCHLUSS)) {
        fehler.push(`Schluss „${DISCORD_SCHLUSS}“ fehlt`);
    }
    return { ok: fehler.length === 0, fehler };
}

/** Ein Bericht in einer Nachricht (`pruefeTeile`). */
export const pruefeBericht = (text: string, tag: string, geheimnis?: string): Pruefergebnis =>
    pruefeTeile([text], tag, geheimnis);

/**
 * Der Auftakt eines Formulierers (Sprachmodell): eine Zeile, höchstens 280 Zeichen. 🔴 Er darf nichts behaupten, was Fakten sind — also keine
 * Ziffern (keine erfundenen Zahlen und Versionen), keine Verweise, keine Erwähnungen, keine Kennungen und keines der Wörter, mit denen man eine
 * Auslieferung behauptet. Die Fakten stehen allein in den Abschnitten der Vorlage.
 *
 * 🔴 Diese Prüfung kennt den Prompt der Betreiber (Reiter „Discord“, WI-0255) nicht und braucht ihn nicht: Ob ein Prompt Zahlen, Namen oder Behauptungen
 * verlangt, ändert nichts an dem, was hinausgeht. Der Rahmentext bleibt der eine Satz unter dem Kopf; bei einem Befund gilt die Vorlage.
 */
const BEHAUPTUNG =
    /\b(?:live|veröffentlich\w*|freigegeben|freigabe|release\w*|version\w*|ausgeliefert|deploy\w*|update\w*|neu\w*\s+auf\s+avesmaps)\b/iu;

export function pruefeAuftakt(auftakt: string): Pruefergebnis {
    const fehler: string[] = [];
    const zeile = auftakt.trim();
    if (zeile.length === 0 || zeile.length > 280) fehler.push("Länge");
    if (/[\r\n]/u.test(zeile)) fehler.push("mehrere Zeilen");
    if (/\d/u.test(zeile)) fehler.push("Ziffer");
    if (/https?:|www\./iu.test(zeile)) fehler.push("Verweis");
    if (/@|<[@#]/u.test(zeile)) fehler.push("Erwähnung");
    if (KENNUNG.test(zeile)) fehler.push("Kennung");
    if (/[*_~`|>]/u.test(zeile)) fehler.push("Formatierung");
    if (BEHAUPTUNG.test(zeile)) fehler.push("Behauptung über eine Auslieferung");
    return { ok: fehler.length === 0, fehler };
}

const ZAHL = /\d+/gu;
/** Dieselbe Zahl in anderer Schreibweise ist dieselbe: `09` und `9`. */
const zahlNormal = (zahl: string): string => zahl.replace(/^0+(?=\d)/u, "");
/** Für den Vergleich ganzer Sätze: ohne Variationsselektor (🛠 und 🛠️) und mit einfachen Leerzeichen. */
const glatt = (text: string): string => text.replace(/️/gu, "").replace(/\s+/gu, " ");

/** Die Antwort eines Formulierers auf die Aufgabe `bericht`: der ganze Text und die Kennungen der Punkte, die er verwendet hat. */
export interface ModellBericht {
    text: string;
    punkte: string[];
}

/**
 * Eine Punktzeile mit Fettkopf, bei der der Kopf den Satz zerreißt (Vali 2026-11-02: „**Wiki-Artikel über Höhlen** — Quellen, Wasserfälle …“): ein Kopf
 * mit Komma oder Strichpunkt, mit mehr als sechs Wörtern, ein Rest, der klein weitergeht, oder ein Rest, der eine Aufzählung fortsetzt („Quellen, Wasserfälle …“: ein einzelnes Wort, dann ein Komma). Ein echter Titel hat nichts
 * davon. Trifft die letzte Regel einmal einen guten Satz, gilt die feste Vorlage; das ist harmlos.
 */
const FETTKOPF = /^\s*•\s+\*\*([^*]+)\*\*\s*[—–-]\s*(\S.*)$/u;
export function fettkopfZerreisstSatz(zeile: string): boolean {
    const treffer = FETTKOPF.exec(zeile);
    if (treffer === null) return false;
    const [, kopf = "", rest = ""] = treffer;
    return (
        /[,;]/u.test(kopf) ||
        kopf.trim().split(/\s+/u).length > 6 ||
        /^\p{Ll}/u.test(rest) ||
        /^[\p{L}\p{N}-]+,\s/u.test(rest)
    );
}

/**
 * Der ganze Bericht eines Formulierers (Sprachmodell), WI-0255 §3b. 🔴 Er darf nichts behaupten, was nicht in der Eingabe steht — und diese
 * Prüfung ist die einzige Grenze: Sie kennt den Prompt der Betreiber nicht und braucht ihn nicht. Bei einem Befund gilt die feste Vorlage.
 *
 * - Alles, was die Prüfung vor dem Versand jedem Text abverlangt (`pruefeInhalt`): kein Ping, keine Kennung, kein Commit, kein fremder Verweis, kein
 *   Schlüssel; dazu Kopf mit dem Tag und Schluss. Die Länge einer Nachricht prüft erst `pruefeTeile` nach dem Teilen.
 * - Höchstens `kontext.max` Zeichen: eine Obergrenze gegen Ausreißer, nicht der Platz einer Nachricht (die App teilt, `teilung.ts`). Der Gruß ist die
 *   letzte Zeile. Den Dank-Abschnitt schreibt das Modell nicht: Steht seine Überschrift im Text, fällt er durch.
 * - Kein Punkt, der selbst sagt, er habe keine sichtbare Wirkung (`OHNE_SICHTBARE_WIRKUNG`, Vali 2026-11-03: Interna weglassen). Ob ein Punkt sonst intern ist, prüft
 *   nichts; das entscheiden die Regeln des Formulierers.
 * - 🔴 Jeder Punkt besteht aus ganzen Sätzen (Vali 2026-11-02): Eine Punktzeile, die mitten im Satz endet („… und lassen sich…“, auf „…“, ein Komma oder ein
 *   Wort ohne Satzzeichen), lässt den Text durchfallen; ebenso ein Fettkopf, der den Satz zerreißt (`fettkopfZerreisstSatz`).
 * - Seit §3e wählt das Modell aus und bündelt: `punkte` nennt nur Neuerungen der Eingabe, keine doppelt; fehlen darf jede. Jeder Teil mit
 *   Neuerungen erzählt mindestens eine davon, und der Text hat mindestens so viele Punktzeilen (`• …`) wie Teile mit Neuerungen.
 * - Ein Teil ohne Neuerungen trägt wörtlich den Satz, den die App dafür vorgibt (`leer`): Das Modell erfindet keinen Stand, wo die Quellen keinen
 *   belegen.
 * - Keine Zahl, die nicht in der Eingabe steht: nicht in den Neuerungen (Sätze, Betreff, Beschreibung), den Leersätzen und nicht das Datum des
 *   Berichtstags. Zahlwörter (`drei`) fängt das nicht; die Regeln der Eingabe verbieten sie.
 */
export function pruefeModellBericht(
    antwort: ModellBericht,
    kontext: BerichtKontext,
    geheimnis?: string,
): Pruefergebnis {
    const fehler = pruefeInhalt(antwort.text, geheimnis);
    if (!antwort.text.startsWith(ersteZeile(kontext.tag))) fehler.push("Kopf mit dem Berichtstag fehlt");
    if (!antwort.text.trimEnd().endsWith(DISCORD_SCHLUSS)) fehler.push(`Schluss „${DISCORD_SCHLUSS}“ fehlt`);
    if (antwort.text.length > kontext.max) {
        fehler.push(`zu lang für den Bericht: ${String(antwort.text.length)} von ${String(kontext.max)} Zeichen`);
    }
    if (antwort.text.split("\n").at(-1)?.trim() !== kontext.schluss) fehler.push("Gruß ist nicht die letzte Zeile");
    if (antwort.text.includes(GEMEINSCHAFT_ERKENNUNG)) fehler.push("Dank-Abschnitt gehört der App");
    if (antwort.text.includes("Aus der Community")) fehler.push("Community-Abschnitt gehört der App");

    const bekannt = new Set(kontext.neuerungen.map((neuerung) => neuerung.id));
    const genannt = new Set(antwort.punkte);
    if (genannt.size !== antwort.punkte.length) fehler.push("Punkt doppelt genannt");
    for (const id of genannt) if (!bekannt.has(id)) fehler.push(`fremder Punkt: ${id.slice(0, 20)}`);
    const teileMitNeuerungen = TEILE.filter((teil) => kontext.neuerungen.some((neuerung) => neuerung.teil === teil));
    for (const teil of teileMitNeuerungen) {
        if (!kontext.neuerungen.some((neuerung) => neuerung.teil === teil && genannt.has(neuerung.id))) {
            fehler.push(`keine Neuerung erzählt: ${teil}`);
        }
    }
    const punktzeilen = antwort.text.split(/\r?\n/u).filter((zeile) => PUNKTZEILE.test(zeile));
    if (punktzeilen.length < teileMitNeuerungen.length) {
        fehler.push(
            `zu wenige Punktzeilen: ${String(punktzeilen.length)} für ${String(teileMitNeuerungen.length)} Teile`,
        );
    }
    for (const zeile of punktzeilen) {
        // Interna (Vali 2026-11-03): ein Punkt, der selbst sagt, dass niemand etwas davon sieht, gehört nicht in den Bericht.
        if (OHNE_SICHTBARE_WIRKUNG.test(zeile))
            fehler.push(`Punkt ohne sichtbare Wirkung: ${zeile.trim().slice(0, 50)}`);
        if (!endetAlsSatz(zeile)) fehler.push(`Punkt endet mitten im Satz: …${zeile.trim().slice(-40)}`);
        if (fettkopfZerreisstSatz(zeile)) fehler.push(`Fettkopf zerreißt den Satz: ${zeile.trim().slice(0, 50)}`);
    }

    const glatterText = glatt(antwort.text);
    for (const teil of TEILE) {
        const satz = kontext.leer[teil];
        if (satz !== null && !glatterText.includes(glatt(satz))) fehler.push(`Satz zum leeren Teil fehlt: ${teil}`);
    }

    const [jahr = "", monat = "", tagImMonat = ""] = kontext.tag.split("-");
    const erlaubt = new Set(
        [
            jahr,
            monat,
            tagImMonat,
            ...kontext.neuerungen.flatMap((neuerung) => [...neuerung.neu, neuerung.betreff, neuerung.beschreibung]),
            ...TEILE.map((teil) => kontext.leer[teil] ?? ""),
        ]
            .flatMap((text) => text.match(ZAHL) ?? [])
            .map(zahlNormal),
    );
    const fremd = new Set((antwort.text.match(ZAHL) ?? []).map(zahlNormal).filter((zahl) => !erlaubt.has(zahl)));
    for (const zahl of fremd) fehler.push(`Zahl, die nicht in der Eingabe steht: ${zahl.slice(0, 12)}`);
    return { ok: fehler.length === 0, fehler };
}

// --- Zusammenfassungen ungesichteter Meldungen (WI-0255 §3c) ---

/** Die Daten, aus denen das Modell eine ungesichtete Meldung zusammenfasst: gekürzte, ungeprüfte Texte aus Discord. */
export interface ZusammenfassungsDaten {
    titel: string;
    text: string | null;
}

/** So lang darf ein Stück der Zusammenfassung höchstens wörtlich aus der Meldung stammen (Vali: kein Zitat über etwa 30 Zeichen). */
export const ZITAT_MAX = 30;

const grenzen = (alternativen: string): RegExp =>
    new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternativen})(?![\\p{L}\\p{N}])`, "iu");

/**
 * Was nach einer Anweisung an das Modell oder an die Leser aussieht: Wörter des Einschleusens („ignoriere …“, „vorherige Anweisungen“, „System-Prompt“),
 * Bezüge auf das Modell selbst, ein Befehl an „du“ und die gängigsten Befehlsformen. Heuristik, absichtlich streng: Ein Treffer kostet nur die
 * Zusammenfassung dieser einen Meldung, es bleibt die kurze Form „#N (Bug, noch nicht gesichtet)“.
 */
const ANWEISUNG: readonly RegExp[] = [
    grenzen(
        "ignorier\\w*|ignore|disregard|forget|override|vergiss\\w*|missachte\\w*|überschreib\\w*|befolg\\w*|ersetze|obey",
    ),
    grenzen(
        "vorherige\\w*\\s+(?:anweisung|regel|instruktion)\\w*|previous\\s+instructions?|system[\\s-]?prompt|prompt|anweisung\\w*|instruction\\w*|regeln|jailbreak|ki|llm|modell|claude|claudia|claudio|assistent\\w*|bot",
    ),
    grenzen(
        "du\\s+(?:bist|sollst|musst|darfst|wirst)|you\\s+(?:are|must|should|will)|ab\\s+sofort|ab\\s+jetzt|von\\s+nun\\s+an|from\\s+now\\s+on|stattdessen|instead",
    ),
    grenzen(
        "schreib\\w*|send\\w*|schick\\w*|poste?|antworte?|nenne?|erwähne?|gib|zeige|lösche|ändere|entferne|schalte|aktiviere|führe|nimm|mach|veröffentliche|print|say|write|reply|output|repeat|wiederhole",
    ),
];

const glatterText = (text: string): string =>
    text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();

/** Wie viele Zeichen am Stück stehen wörtlich in der Quelle (nur Buchstaben und Ziffern, ohne Schreibweise der Satzzeichen)? */
function laengstesZitat(zusammenfassung: string, quelle: string): number {
    const z = glatterText(zusammenfassung);
    const q = glatterText(quelle);
    let laengste = 0;
    for (let i = 0; i < z.length; i += 1) {
        let n = laengste + 1;
        while (i + n <= z.length && q.includes(z.slice(i, i + n))) n += 1;
        laengste = Math.max(laengste, n - 1);
    }
    return laengste;
}

/**
 * Die Zusammenfassung einer UNGESICHTETEN Meldung, die ein Formulierer schreibt (Vali 2026-10-26: „auch ungesichtete, aber nur kurz zusammengefasst“).
 * 🔴 Der Text der Meldung ist fremd und ungeprüft und geht in einen öffentlichen Post. Darum gilt hier die strengste Prüfung des Berichts; sie kennt weder
 * Prompt noch Modell. Höchstens 90 Zeichen (gemeint sind etwa 80), eine Zeile, und
 *
 * - kein Verweis (auch keiner ohne `https://`), keine Erwähnung, keine Kennung, keine Commit-Kennung, kein Markdown, kein „#“;
 * - kein Ausrufezeichen, nichts, was nach Anweisung aussieht (`ANWEISUNG`);
 * - kein wörtliches Zitat aus der Meldung über 30 Zeichen;
 * - keine Zahl, die nicht in der Meldung steht.
 *
 * Fällt sie durch, steht an ihrer Stelle nur „#N (Bug, noch nicht gesichtet)“.
 */
export function pruefeZusammenfassung(zusammenfassung: string, daten: ZusammenfassungsDaten): Pruefergebnis {
    const fehler: string[] = [];
    const z = zusammenfassung.trim();
    if (z === "") fehler.push("leer");
    if (z.length > 90) fehler.push("Länge");
    if (/[\r\n]/u.test(z)) fehler.push("mehrere Zeilen");
    if (/[*_~`|>#\\]/u.test(z)) fehler.push("Formatierung");
    if (/!/u.test(z)) fehler.push("Ausrufezeichen");
    if (ERWAEHNUNG.test(z) || /@|<[@#:]/u.test(z)) fehler.push("Erwähnung");
    if (LINKARTIG.test(z)) fehler.push("Verweis");
    if (KENNUNG.test(z)) fehler.push("Kennung");
    if (COMMIT.test(z)) fehler.push("Commit-Kennung");
    if (ANWEISUNG.some((muster) => muster.test(z))) fehler.push("Anweisung");
    const quelle = `${daten.titel} ${daten.text ?? ""}`;
    if (laengstesZitat(z, quelle) > ZITAT_MAX) fehler.push("Zitat");
    const erlaubt = new Set((quelle.match(ZAHL) ?? []).map(zahlNormal));
    for (const zahl of new Set((z.match(ZAHL) ?? []).map(zahlNormal))) {
        if (!erlaubt.has(zahl)) fehler.push(`Zahl, die nicht in der Meldung steht: ${zahl.slice(0, 12)}`);
    }
    return { ok: fehler.length === 0, fehler };
}
