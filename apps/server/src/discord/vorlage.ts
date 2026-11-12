import { createHash } from "node:crypto";
import { DISCORD_SCHLUSS, type DiscordFakten } from "@avesmaps3d/shared";
import { RUHETAG_SATZ, leerSatz, sammlePunkte, wartenSatz, type BerichtPunkt, type Teil } from "./punkte.ts";
import { meldungsAbschnitt, planMeldungen, type Meldungen } from "./meldungen.ts";
import { berichtstag, datumKurz, tagInWorten, type Tageszeit } from "./zeit.ts";

/**
 * Die feste Vorlage des Tagesberichts (WI-0255 §3b), im Aufbau der früheren Tagesberichte von Avesmaps Legacy. Sie gilt, wo kein Formulierer
 * eingerichtet ist, und 🔴 immer dann, wenn der Text eines Formulierers die Prüfung nicht besteht: Der Bericht kommt also immer. Tonregeln des
 * Betreiberauftrags: verständliches, persönliches Deutsch (ihr, euch), keine Commit-Listen, keine Vorgangsnummern, nichts Erfundenes, kein
 * Versprechen. Der Bericht endet mit „Eure Claudia und Claudio“ (bei mehreren Nachrichten steht das nur in der letzten).
 *
 * ```text
 * 🚀 **Tagesbericht** · 26.10.2026
 * Guten Morgen aus der Kartenstube. …                       (Gruß nach der Tageszeit der gespeicherten Uhrzeit)
 *
 * ✨ **Was ist neu?** (auf avesmaps.de)                      (Production, `live`)
 * 🗺️ **Karte**  /  🛠️ **Editor und Werkzeuge**  /  🤝 **Discord und Community**  /  🐞 **Fehler behoben**
 * • **Kurztitel** — Satz
 *
 * 🔨 **Was ist in Entwicklung?** (noch nicht auf avesmaps.de)   (Stage, `getestet` und `laufend`)
 * …
 * https://avesmaps.de
 *
 * **Dank an unsere fleißigen Editoren und die Community:**      (nur mit Beiträgen, Vali 2026-10-26)
 * • 14 Bearbeitungen an der Karte im Editor seit gestern von 3 Leuten
 * Danke an alle, die mitmachen!
 * Eure Claudia und Claudio                                   (ohne den Dank-Abschnitt steht der Gruß nach einer Leerzeile unter dem Link)
 * ```
 *
 * - Die Punkte sind ALLE (`punkte.ts`, Vali 2026-11-02), ungekürzt: Die Vorlage liefert den ganzen Text, und `teilung.ts` verteilt ihn bei Bedarf an den
 *   Punktgrenzen auf mehrere Nachrichten. Ein Satz endet immer als Satz; kein „… und n weitere“.
 * - Ein Teil ohne Punkte sagt ehrlich warum (`leerSatz`); fehlt für beide etwas Neues, ist es ein Ruhetag mit dem Satz der früheren Berichte.
 * - Der Gruß wechselt je Tag nach einer festen Regel (Prüfsumme des Tages) und folgt der Tageszeit; ein Formulierer mit der älteren Schnittstelle
 *   (`auftakt`) darf nur ihn ersetzen (`formulierer.ts`).
 * - Die Community-Liste (`meldungen.ts`, WI-0255 §3c) steht nach „Was ist in Entwicklung?“ und vor dem Link; Ungesichtete zeigt die Vorlage nur kurz.
 * - Der Dank-Abschnitt (`gemeinschaftAbschnitt`) steht fest am Ende, in der Vorlage wie im Text eines Formulierers (`mitAbschnitten`).
 * - Karte, Editor, Discord oder Fehler entscheidet eine Näherung am Satz (`bereichVon`), denn der Faktenbestand trägt keinen Bereich. Eine falsche
 *   Zuordnung ändert keine Aussage, nur die Überschrift darüber. Unter „Fehler behoben“ steht nur ein `fix`, dessen Satz selbst eine Behebung sagt („nicht
 *   mehr“, „wieder“ …); eine reine Benennung („… heißt jetzt …“) und eine Neuerung unter dem Präfix `fix` stehen dort nicht.
 * - Ein Fettkopf („• **Titel** — Satz“) steht nur, wo der Satz selbst „Titel: Satz“ oder „Titel — Satz“ lautet (`zerlege`); nie aus den ersten Wörtern eines
 *   Satzes, der danach weitergeht.
 */

export const LINK = "https://avesmaps.de";

// Kurz, ohne Ausschmückung (Vali 2026-11-02: „einfach nur " wir waren wieder fleissig für Euch..." oder so“).
const GRUESSE: Record<Tageszeit, readonly string[]> = {
    morgens: [
        "Guten Morgen. Wir waren wieder fleißig für euch.",
        "Praios zum Gruße. Wir waren wieder fleißig für euch.",
        "Guten Morgen, ihr Reisenden. Das haben wir für euch geschafft.",
        "Guten Morgen. Das ist neu bei uns.",
    ],
    mittags: [
        "Guten Tag. Wir waren wieder fleißig für euch.",
        "Praios zum Gruße. Das haben wir für euch geschafft.",
        "Guten Tag, ihr Reisenden. Das ist neu bei uns.",
    ],
    abends: [
        "Guten Abend. Wir waren wieder fleißig für euch.",
        "Rahja zum Abend. Das haben wir für euch geschafft.",
        "Guten Abend, ihr Reisenden. Das ist neu bei uns.",
    ],
};

/** Der Index einer Liste nach dem Tag: dieselbe Regel für jeden Tag, ohne Zufall. */
function nachTag(tag: string, anzahl: number): number {
    return createHash("sha256").update(tag).digest().readUInt32BE(0) % anzahl;
}

/** Der Gruß des Tages zur Tageszeit (die Vorlage und der Rückfall der älteren Formulierer-Schnittstelle). */
export function auftaktVon(tag: string, tageszeit: Tageszeit = "morgens"): string {
    const liste = GRUESSE[tageszeit];
    return liste[nachTag(tag, liste.length)]!;
}

/**
 * Die erste Zeile jeder Nachricht: Icon, Name und Datum wie in den früheren Tagesberichten. An ihr erkennt das Nachsehen im Kanal den eigenen Bericht
 * (`rest.suche`), und die Prüfung verlangt sie am Anfang auch vom Text eines Formulierers.
 */
export function ersteZeile(tag: string): string {
    return `🚀 **Tagesbericht** · ${datumKurz(tag)}`;
}

/**
 * Der Dank-Abschnitt am Ende (Vali 2026-10-26: „Dank an unsere fleißigen Editoren und die Community: …“). 🔴 Ihn setzt die App fest an, in der
 * Vorlage wie im Text eines Formulierers (`mitGemeinschaft`): Das Modell schreibt ihn nicht, so stimmen die Zahlen immer. Ohne jeden Beitrag
 * im Fenster entfällt er ganz. Das Ausrufezeichen ist Valis Text („keine Ausrufezeichen“ gilt nur für das Modell).
 */
export const GEMEINSCHAFT_KOPF = "**Dank an unsere fleißigen Editoren und die Community:**";
/** Daran erkennt die Prüfung, dass ein Formulierer den Abschnitt doch selbst geschrieben hat. */
export const GEMEINSCHAFT_ERKENNUNG = "Dank an unsere fleißigen Editoren";
const GEMEINSCHAFT_DANK = "Danke an alle, die mitmachen!";

/** „ein Handgriff“ oder „2 Handgriffe“: Die Einzahl trägt ihren Artikel (Geschlecht), die Mehrzahl die Zahl. */
const zahlWort = (n: number, einzahl: string, mehrzahl: string): string =>
    n === 1 ? einzahl : `${String(n)} ${mehrzahl}`;

/** „seit gestern“, wenn das Fenster rund einen Tag ist; sonst „seit Freitag, 23. Oktober 2026“. */
export function seitWann(fakten: DiscordFakten): string {
    const von = Date.parse(fakten.community.von);
    const bis = Date.parse(fakten.community.bis);
    const stunden = (bis - von) / 3600_000;
    if (stunden >= 20 && stunden <= 28) return "seit gestern";
    return `seit ${tagInWorten(berichtstag(new Date(von)))}`;
}

/** Der Abschnitt als Text (Überschrift, Zeilen, Dank; ohne den Gruß darunter), oder `null` ohne jeden Beitrag. */
export function gemeinschaftAbschnitt(fakten: DiscordFakten): string | null {
    const { community } = fakten;
    if (community.bearbeitungen + community.medien + community.bewertungen === 0) return null;
    const seit = seitWann(fakten);
    const zeilen = [GEMEINSCHAFT_KOPF];
    if (community.bearbeitungen > 0) {
        const wer = community.personen === null ? "" : ` von ${String(community.personen)} Leuten`;
        zeilen.push(
            `• ${zahlWort(community.bearbeitungen, "eine Bearbeitung", "Bearbeitungen")} an der Karte im Editor ${seit}${wer}`,
        );
    }
    if (community.medien > 0) {
        zeilen.push(`• ${zahlWort(community.medien, "ein Handgriff", "Handgriffe")} in der Medienverwaltung`);
    }
    if (community.bewertungen > 0) {
        zeilen.push(`• ${zahlWort(community.bewertungen, "eine neue Ortsbewertung", "neue Ortsbewertungen")}`);
    }
    zeilen.push(GEMEINSCHAFT_DANK);
    return zeilen.join("\n");
}

/** Das Ende des Berichts: der Link, dann (mit Beiträgen) der Dank-Abschnitt, direkt darunter der Gruß; ohne Abschnitt der Gruß nach einer Leerzeile. */
function schlussteil(dank: string | null, schluss: string): string[] {
    return dank === null ? [LINK, "", schluss] : [LINK, "", ...dank.split("\n"), schluss];
}

/**
 * Setzt die Abschnitte am Ende in den Text eines Formulierers ein, der mit dem Gruß endet: erst die Community-Liste (nach „Was ist in Entwicklung?“),
 * dann der Link, den die App setzt oder (wenn das Modell ihn als letzte Zeile vor dem Gruß schrieb) an seiner Stelle belässt, dann der Dank-Abschnitt und
 * direkt darunter der Gruß. Ohne beide Abschnitte bleibt der Text, wie er ist.
 */
export function mitAbschnitten(text: string, meldungen: string | null, dank: string | null): string {
    if (meldungen === null && dank === null) return text;
    const zeilen = text.trimEnd().split("\n");
    const schluss = zeilen.pop() ?? DISCORD_SCHLUSS;
    const ohneLeerzeilen = (): void => {
        while (zeilen.length > 0 && zeilen[zeilen.length - 1]!.trim() === "") zeilen.pop();
    };
    ohneLeerzeilen();
    if (zeilen[zeilen.length - 1]?.trim() === LINK) {
        zeilen.pop();
        ohneLeerzeilen();
    }
    return [...zeilen, "", ...(meldungen === null ? [] : [meldungen, ""]), ...schlussteil(dank, schluss)].join("\n");
}

export type Bereich = "karte" | "editor" | "discord" | "fehler";
const BEREICHE: readonly Bereich[] = ["karte", "editor", "discord", "fehler"];
/** Die Überschriften der Bereiche. 🤝 und nicht 💬: Die Community-Liste der App heißt „💬 Aus der Community“ und soll nicht damit verwechselt werden. */
export const BEREICH_KOPF: Record<Bereich, string> = {
    karte: "🗺️ **Karte**",
    editor: "🛠️ **Editor und Werkzeuge**",
    discord: "🤝 **Discord und Community**",
    fehler: "🐞 **Fehler behoben**",
};
const TEIL_KOPF: Record<Teil, string> = {
    neu: "✨ **Was ist neu?** (auf avesmaps.de)",
    entwicklung: "🔨 **Was ist in Entwicklung?** (noch nicht auf avesmaps.de)",
};

/** Wörter, an denen ein Satz zum Editor und zu den Werkzeugen gehört (Anfang eines Wortes; `Kammeditor` zählt). */
const EDITOR_MUSTER =
    /(?<!\p{L})(?:\p{L}*editor|werkzeug|verwaltung|betreiber|admin|eigenschaften|reiter|import|export|protokoll|freigabe|release|wartung|warteschlange|passkey|wikisync|abgleich|bearbeit)/iu;

/**
 * Was zu Discord gehört (Vali: eigene Gruppe statt „Karte“): der Tagesbericht selbst, Discord beim Namen und die Befehle des Bots. „Community“ steht nicht
 * darin: „Community › Meldungen“ ist ein Reiter der Redaktion und gehört zum Editor.
 */
const DISCORD_MUSTER =
    /(?<!\p{L})(?:discord|tagesbericht)|(?<![\p{L}\p{N}])\/(?:bug|idee|frage|offen|erledigt|hilfe)(?![\p{L}])/iu;

/**
 * Eine Behebung sagt, was vorher nicht stimmte („nicht mehr“, „wieder“, „richtig“, „behoben“ …). Die Art `fix` gibt nur der Commit an, und viele tragen eine
 * Neuerung unter diesem Präfix („Rechtsklick auf ein Gebiet bietet …“, „/offen zeigt die Nummer …“): Das ist keine Behebung, solange der Satz selbst nichts
 * Falsches nennt (Vali 2026-11-03, Befund aus der Vorschau). Eine Näherung am Wortlaut; ein echter Fehler ohne diese Wörter steht dann unter seinem Ort.
 */
const BEHEBUNG = new RegExp(
    [
        "nicht\\s+mehr",
        "nie\\s+mehr",
        "nicht\\s+länger",
        "kein\\w*\\s+(?:\\p{L}+\\s+)?mehr",
        "nur\\s+noch",
        "wieder",
        "endlich",
        "behoben",
        "korrigiert",
        "repariert",
        "beseitigt",
        "richtig",
        "korrekt",
        "stimmt",
        "stimmen",
        "falsch\\w*",
        "fehlerhaft\\w*",
        "fehler",
        "kaputt\\w*",
        "defekt\\w*",
        "statt",
        "bleib\\w+",
        "verhinder\\w*",
        "absturz",
        "abstürz\\w*",
        "hänger",
    ]
        .map((teil) => `(?<![\\p{L}])${teil}(?![\\p{L}])`)
        .join("|"),
    "iu",
);

/**
 * Eine reine Benennung („Das Fenster heißt jetzt „Eigenschaften der Landmarke““, „… umbenannt“): kein behobener Fehler, auch wenn der Commit ein `fix` war
 * (Vali 2026-11-02, Befund aus der Vorschau). Die Näherung ist eng gehalten: „heißt“ muss unmittelbar vor dem neuen Namen in Anführungszeichen stehen.
 */
const BENENNUNG =
    /(?:\bhei(?:ß|ss)(?:t|en)\b|\bnennt sich\b)\s+(?:jetzt\s+|nun\s+|künftig\s+|neu\s+)?[„‚"“»‘']|\bumbenannt\b|\bumbenennung\b|\bbenennung\b/iu;

/**
 * Behebungen stehen unter „Fehler behoben“, wenn der Satz eine Behebung ist (`BEHEBUNG`) und keine reine Benennung. Alles andere steht unter „Editor und
 * Werkzeuge“, wenn der Satz sie nennt, unter „Discord und Community“, wenn er von Discord erzählt, sonst unter „Karte“.
 */
export function bereichVon(punkt: Pick<BerichtPunkt, "art" | "text">): Bereich {
    if (punkt.art === "fix" && BEHEBUNG.test(punkt.text) && !BENENNUNG.test(punkt.text)) return "fehler";
    if (EDITOR_MUSTER.test(punkt.text)) return "editor";
    return DISCORD_MUSTER.test(punkt.text) ? "discord" : "karte";
}

const TITEL_MIN = 8;
const TITEL_MAX = 50;
/** Wie bei den Regeln des Formulierers: ein echter Titel hat zwei bis fünf Wörter. Sechs Wörter vor dem Doppelpunkt sind meist schon ein Satz („Der Tagesbericht in Discord wird ausführlicher“). */
const TITEL_WOERTER_MAX = 5;
const REST_MIN = 15;

/**
 * „Titel — Satz“ aus einem Satz, der selbst so gebaut ist: Der Titel steht vor einem Doppelpunkt oder Gedankenstrich (nach höchstens 50 Zeichen und sechs
 * Wörtern, ohne Komma, Strichpunkt oder Satzzeichen), und der Rest beginnt als Satz mit einem Großbuchstaben oder einer Ziffer. 🔴 Nie ein Komma als Trenner und
 * nie ein Satz, der nach den ersten Wörtern weitergeht: „Wiki-Artikel über Höhlen, Quellen, Wasserfälle …“ ist eine Aufzählung, kein Titel mit Rest (Vali
 * 2026-11-02). Sonst steht der Satz ohne Titel da. Der Faktenbestand kennt keine Kurztitel, und ein Betreff aus dem Verlauf ist zu technisch.
 */
export function zerlege(text: string): { titel: string | null; rest: string } {
    for (const trenner of [": ", " – ", " — ", " - "]) {
        const i = text.indexOf(trenner);
        if (i < TITEL_MIN || i > TITEL_MAX) continue;
        const titel = text.slice(0, i).trim();
        const rest = text.slice(i + trenner.length).trim();
        if (rest.length < REST_MIN || !/^[\p{Lu}\d]/u.test(rest)) continue;
        if (titel.split(/\s+/u).length > TITEL_WOERTER_MAX || /[,;.!?:]/u.test(titel)) continue;
        return { titel, rest };
    }
    return { titel: null, rest: text };
}

/** Ein Satz endet als Satz: Fehlt ein Satzzeichen am Ende (Buchstabe oder Ziffer), setzt die Vorlage den Punkt. Der Text selbst wird nie gekürzt. */
const alsSatz = (text: string): string => (/[\p{L}\p{N}]$/u.test(text) ? `${text}.` : text);

function punktZeile(punkt: BerichtPunkt): string {
    const text = alsSatz(punkt.text);
    const { titel, rest } = zerlege(text);
    return titel === null ? `• ${text}` : `• **${titel}** — ${rest}`;
}

/** Ein Teil des Berichts: die Überschrift und alle Punkte, nach Bereichen; ohne Punkte der ehrliche Satz (`leerSatz`). */
function teilZeilen(fakten: DiscordFakten, teil: Teil, pool: readonly BerichtPunkt[]): string[] {
    const zeilen = [TEIL_KOPF[teil]];
    const gezeigt = pool.filter((punkt) => punkt.teil === teil);
    if (gezeigt.length === 0) return [...zeilen, leerSatz(fakten, teil)];
    for (const bereich of BEREICHE) {
        const punkte = gezeigt.filter((punkt) => bereichVon(punkt) === bereich);
        if (punkte.length > 0) zeilen.push(BEREICH_KOPF[bereich], ...punkte.map(punktZeile));
    }
    return zeilen;
}

/** Ist nirgends etwas Neues, das sich erzählen ließe? Nur wenn Production belegbar nichts brachte; dann wird der Bericht ehrlich kurz. */
export function istRuhetag(fakten: DiscordFakten): boolean {
    const { production, werkstatt } = fakten;
    return (
        (production.vergleich === "gleich" || production.vergleich === "neu") &&
        production.neu.length === 0 &&
        werkstatt.neu.length === 0
    );
}

export interface BerichtOptionen {
    tageszeit?: Tageszeit;
    /** Der Gruß, der den des Tages ersetzt (ältere Formulierer-Schnittstelle, geprüft). */
    auftakt?: string;
    /** Die Meldungen aus dem Kanal für „Aus der Community“; ohne sie oder bei `null` entfällt der Abschnitt. Die Vorlage zeigt Ungesichtete nur kurz. */
    meldungen?: Meldungen | null;
}

/**
 * Der ganze Text des Berichts aus dem Faktenbestand: alle Punkte, die ganze Community-Liste, der Dank-Abschnitt. Er ist nicht auf eine Nachricht
 * begrenzt; wie er auf Nachrichten verteilt wird, entscheidet `teileBericht` (`teilung.ts`).
 */
export function baueBericht(fakten: DiscordFakten, optionen: BerichtOptionen = {}): string {
    const gruss = optionen.auftakt ?? auftaktVon(fakten.tag, optionen.tageszeit);
    const dank = gemeinschaftAbschnitt(fakten);
    const community = meldungsAbschnitt(planMeldungen(optionen.meldungen ?? null));
    if (istRuhetag(fakten)) {
        const zeilen = [ersteZeile(fakten.tag), gruss, "", RUHETAG_SATZ];
        if (fakten.werkstatt.weiterhin > 0) zeilen.push(wartenSatz(fakten.werkstatt.weiterhin));
        // Der Ruhetag trägt keinen Link; die Abschnitte (mit Beiträgen) stehen über dem Gruß.
        zeilen.push("");
        if (community !== null) zeilen.push(community, "");
        if (dank !== null) zeilen.push(...dank.split("\n"));
        return [...zeilen, DISCORD_SCHLUSS].join("\n");
    }
    const punkte = sammlePunkte(fakten);
    return [
        ersteZeile(fakten.tag),
        gruss,
        "",
        ...teilZeilen(fakten, "neu", punkte),
        "",
        ...teilZeilen(fakten, "entwicklung", punkte),
        "",
        ...(community === null ? [] : [community, ""]),
        ...schlussteil(dank, DISCORD_SCHLUSS),
    ].join("\n");
}
