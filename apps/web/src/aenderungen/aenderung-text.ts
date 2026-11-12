import type { MapHistoryEntry, MapHistoryObjectKind, MapHistoryStatus } from "@avesmaps3d/shared";
import { formatNumber, locale, t, tPlural, type MessageKey } from "../i18n/i18n";
import type { Kreis } from "./aenderung-modell";

/**
 * Die Texte des Reiters „Änderungen“ und des gemeinsamen Details, soweit sie aus Daten entstehen (WI-0265 B5a): Zeit mit Zeitzone, die
 * Person, die Quelle, die Art, der Zustand und ein Wert, wie Menschen ihn lesen. Die Wörter selbst stehen in den Sprachtafeln.
 */

/** Wie lang ein Wert höchstens als Text steht; mehr schneidet die Zeile ab (ein Netz oder eine Beschreibung gehört nicht ganz in eine Zeile). */
export const WERT_LAENGE = 160;

const MS_TAG = 86_400_000;

/** Die Formate einer Liste werden hundertfach gebraucht und je Sprache nur einmal gebaut. */
const FORMATE = new Map<string, Intl.DateTimeFormat>();
function teile(at: string, optionen: Intl.DateTimeFormatOptions): string {
    const schluessel = `${locale.value}|${JSON.stringify(optionen)}`;
    let format = FORMATE.get(schluessel);
    if (format === undefined) {
        format = new Intl.DateTimeFormat(locale.value, optionen);
        FORMATE.set(schluessel, format);
    }
    return format.format(new Date(at));
}
const RELATIV = new Map<string, Intl.RelativeTimeFormat>();

/** Tag und Uhrzeit mit Zeitzone, etwa „31.10.2026, 14:03 MEZ“ (die Zeitzone ist die des Browsers). */
export const zeitMitZone = (at: string): string =>
    teile(at, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
    });

/** Nur die Uhrzeit, etwa „14:03“: für die Mitglieder einer Serie, deren Tag in der Kopfzeile steht. */
export const uhrzeit = (at: string): string => teile(at, { hour: "2-digit", minute: "2-digit" });

/** Tag und Monat, etwa „31.10.“: für die Spanne einer Serie, die über Mitternacht reicht. */
export const kurzesDatum = (at: string): string => teile(at, { day: "2-digit", month: "2-digit" });

/** Wie viele Kalendertage `at` von `jetzt` entfernt liegt (0 heute, -1 gestern), in Ortszeit. */
function tagAbstand(at: string, jetzt: Date): number {
    const anfang = (datum: Date): number => new Date(datum.getFullYear(), datum.getMonth(), datum.getDate()).getTime();
    return Math.round((anfang(new Date(at)) - anfang(jetzt)) / MS_TAG);
}

/** „heute“ oder „gestern“ in der Sprache der Oberfläche; `undefined`, wenn der Tag weiter zurückliegt. */
function relativerTag(abstand: number): string | undefined {
    if (abstand !== 0 && abstand !== -1) return undefined;
    let format = RELATIV.get(locale.value);
    if (format === undefined) {
        format = new Intl.RelativeTimeFormat(locale.value, { numeric: "auto" });
        RELATIV.set(locale.value, format);
    }
    return format.format(abstand, "day");
}

const grossAnfang = (wort: string): string => `${wort.charAt(0).toLocaleUpperCase(locale.value)}${wort.slice(1)}`;

/** Der Tag mit „heute“ und „gestern“ in der Sprache der Oberfläche, sonst als Datum. */
function tagWort(at: string, jetzt: Date): string {
    return relativerTag(tagAbstand(at, jetzt)) ?? teile(at, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Der Kopf eines Tages in der Liste (WI-0265 B10): „Heute“, „Gestern“, sonst „Mittwoch, 28. Oktober“ in der Sprache der Oberfläche; liegt der Tag in einem anderen Jahr, steht es dabei.
 * Der Tag zählt in Ortszeit des Browsers.
 */
export function tagesKopf(at: string, jetzt: Date = new Date()): string {
    const wort = relativerTag(tagAbstand(at, jetzt));
    if (wort !== undefined) return grossAnfang(wort);
    const anderesJahr = new Date(at).getFullYear() !== jetzt.getFullYear();
    return teile(at, { weekday: "long", day: "numeric", month: "long", ...(anderesJahr ? { year: "numeric" } : {}) });
}

/** Die Zeit in einer Zeile: „heute, 14:03 MEZ“, älter „30.10.2026, 22:15 MEZ“. */
export function zeilenZeit(at: string, jetzt: Date = new Date()): string {
    const wort = tagWort(at, jetzt);
    const rest = teile(at, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
    return `${grossAnfang(wort)}, ${rest}`;
}

/** Wer: die Person (mit „eigene Änderung“), ein Agent mit seiner Freigabe, sonst das System. */
export function wer(actor: MapHistoryEntry["actor"]): string {
    if (actor.kind === "person")
        return actor.self ? t("verlauf.du", { name: actor.name ?? "–" }) : (actor.name ?? t("verlauf.jemand"));
    if (actor.kind === "agent")
        return t("verlauf.agent", { name: actor.name ?? "–", freigabe: actor.approvalRef ?? "–" });
    return actor.name ?? t("verlauf.system");
}

const QUELLEN: Readonly<Record<string, MessageKey>> = {
    editor: "verlauf.quelle.editor",
    restore: "verlauf.quelle.restore",
    import: "verlauf.quelle.import",
    testwelt_reset: "verlauf.quelle.testwelt",
    wikisync: "verlauf.quelle.wikisync",
};
export const quelle = (q: string): string => {
    const schluessel = QUELLEN[q];
    return schluessel === undefined ? q : t(schluessel);
};

/** Der Name einer Art („Ort“, „Weg“ …); eine unbekannte Art steht mit ihrem Schlüssel da. */
export const artName = (kind: MapHistoryObjectKind | string): string => t(`aenderungen.art.${kind}` as MessageKey);

export const statusName = (status: MapHistoryStatus): string => t(`aenderungen.status.${status}` as MessageKey);

/**
 * Der EINE Wortschatz des Zustands (WI-0265 B10): ● wirksam · ◐ teils zurückgenommen · ○ zurückgenommen · ⊘ nicht rücknehmbar. Dieselben Wörter stehen am Kreis (Tooltip), in der Legende, im Detail und im Trichter;
 * sie kommen aus den `aenderungen.status.*` der Sprachtafeln (`statusName` für die Zustände des Servers, `teils` für ◐, das der Server nicht kennt).
 */
export function kreisName(kreis: Kreis): string {
    if (kreis === "voll") return statusName("ruecknehmbar");
    if (kreis === "halb") return t("aenderungen.status.teils");
    return statusName(kreis === "leer" ? "bereits_zurueckgenommen" : "nicht_ruecknehmbar");
}

/** Der Tooltip des Kreises: wie `kreisName`; ● sagt zusätzlich „(rücknehmbar)“, ◐ einer Serie nennt, wie viele ihrer Mitglieder schon zurück sind. */
export function kreisTitel(kreis: Kreis, serie?: { readonly zurueck: number; readonly gesamt: number }): string {
    if (kreis === "voll") return t("aenderungen.status.ruecknehmbarTitel");
    if (kreis === "halb" && serie !== undefined)
        return t("aenderungen.status.teilsAnzahl", {
            n: formatNumber(serie.zurueck, 0),
            gesamt: formatNumber(serie.gesamt, 0),
        });
    return kreisName(kreis);
}

/** „3 Objekte“ in der Zeile, wo eine Änderung mehr als ein Objekt betrifft; sonst nichts. */
export const objekteText = (n: number): string | undefined =>
    n > 1 ? tPlural("aenderungen.zeile.objekte", n, { n: formatNumber(n, 0) }) : undefined;

/**
 * Der Satz, warum ein Eintrag nicht zurückgenommen wird (`nicht_ruecknehmbar`): `quelle` (Import, WikiSync, Testwelt: eigene Wege) oder `art` (eine Art Änderung, die keine Familie
 * zurücknimmt, etwa das Anlegen). Seit WI-0265 B6g3 nimmt der Server jede Änderung der Inhalte zurück (Quelle, Werk, Korpus, Vorkommen und die Quellen eines Trägers); ihr Anlegen bleibt eine Art
 * wie jedes andere Anlegen und hat den allgemeinen Satz. `undefined`, wenn der Eintrag nicht `nicht_ruecknehmbar` ist oder der Server keinen Grund nennt.
 */
export function nichtRuecknehmbarSatz(
    eintrag: Pick<MapHistoryEntry, "status" | "statusReason" | "operation">,
): string | undefined {
    if (eintrag.status !== "nicht_ruecknehmbar") return undefined;
    if (eintrag.statusReason === "quelle") return t("aenderungen.status.grund.quelle");
    if (eintrag.statusReason === "art") return t("aenderungen.status.grund.art");
    return undefined;
}

/** Die ersten Zeichen einer Kennung, damit eine Zeile sie nennen kann; die ganze steht im Detail. */
export const kurzeKennung = (id: string): string => `${id.slice(0, 8)}…`;

const istZahl = (wert: unknown): wert is number => typeof wert === "number" && Number.isFinite(wert);
const istPunkt = (wert: unknown): boolean => Array.isArray(wert) && wert.length === 2 && wert.every(istZahl);

function punkteZaehlen(wert: readonly unknown[]): number | undefined {
    if (wert.length === 0) return undefined;
    if (wert.every(istPunkt)) return wert.length;
    if (wert.every((teil) => Array.isArray(teil))) {
        let summe = 0;
        for (const teil of wert as unknown[][]) {
            const n = punkteZaehlen(teil);
            if (n === undefined) return undefined;
            summe += n;
        }
        return summe;
    }
    return undefined;
}

export const kuerzen = (text: string): string =>
    text.length > WERT_LAENGE ? `${text.slice(0, WERT_LAENGE - 1)}…` : text;

/** Die Punkte einer Linie oder Fläche (auch verschachtelt, mit Löchern); `undefined`, wenn der Wert keine Punktliste ist. */
export const punkteIn = (wert: unknown): number | undefined => (Array.isArray(wert) ? punkteZaehlen(wert) : undefined);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** Eine Kennung (UUID) ist kein Text für Menschen. */
export const istKennung = (wert: unknown): wert is string => typeof wert === "string" && UUID.test(wert);

/**
 * Ein Schlüssel des Protokolls als Wort, wenn es für ihn keinen Namen gibt: `grat_breite` und `showName` werden „Grat breite“ und
 * „Show name“. Das ist ein Rückfall, kein Name; der Schlüssel selbst steht dazu nur im `title`.
 */
export function lesbar(schluessel: string): string {
    const woerter = schluessel
        .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
        .replace(/[_:.-]+/gu, " ")
        .trim()
        .toLocaleLowerCase(locale.value);
    return woerter === "" ? schluessel : `${woerter.charAt(0).toLocaleUpperCase(locale.value)}${woerter.slice(1)}`;
}

/**
 * Der Klartext (bereinigte Fassung) zu einem Feld mit dem Wiki-Quelltext (`[[…]]` und Vorlagen): `rohSchrift` gehört zu `schrift`, der Wiki-Stand `wikiRohVerbreitung` zu `wikiVerbreitung`.
 * `undefined`, wenn der Schlüssel kein Rohfeld ist. Nur ein Wort `roh` mit Großbuchstaben danach zählt (`rohstoffe` nicht).
 */
export function bereinigtesFeld(feld: string): string | undefined {
    const wiki = /^wikiRoh([A-Z]\w*)$/u.exec(feld)?.[1];
    if (wiki !== undefined) return `wiki${wiki}`;
    const roh = /^roh([A-Z]\w*)$/u.exec(feld)?.[1];
    return roh === undefined ? undefined : `${roh.charAt(0).toLowerCase()}${roh.slice(1)}`;
}

/** Steht neben diesem Rohfeld in demselben Gegenstand seine bereinigte Fassung? Dann zeigt die Oberfläche nur die bereinigte (der Quelltext steht im Protokoll, nicht doppelt davor). */
export function istRohNeben(feld: string, felder: readonly string[]): boolean {
    const bereinigt = bereinigtesFeld(feld);
    return bereinigt !== undefined && felder.includes(bereinigt);
}

const MAX_ANGABEN = 4;
const istSkalar = (wert: unknown): wert is string | number | boolean | null =>
    wert === null || ["string", "number", "boolean"].includes(typeof wert);

/**
 * Ein Objekt, dessen Form die Oberfläche nicht kennt, als Satz: seine einfachen Angaben mit lesbaren Namen („Grat breite 14 · Muster
 * Rauschen“), höchstens vier, der Rest als „…“; hat es nichts Einfaches, nur die Zahl seiner Angaben. Nie JSON.
 */
function objektText(objekt: Readonly<Record<string, unknown>>): string {
    const eintraege = Object.entries(objekt);
    if (eintraege.length === 0) return "–";
    const einfach = eintraege.filter(([, wert]) => istSkalar(wert));
    if (einfach.length === 0) return t("aenderungen.wert.angaben", { n: formatNumber(eintraege.length, 0) });
    const teile = einfach
        .slice(0, MAX_ANGABEN)
        .map(([schluessel, wert]) => `${lesbar(schluessel)} ${wertText(schluessel, wert) ?? "–"}`);
    return kuerzen(
        `${teile.join(" · ")}${einfach.length > MAX_ANGABEN || einfach.length < eintraege.length ? " …" : ""}`,
    );
}

/**
 * Ein Wert des Protokolls, wie Menschen ihn lesen: leer als Strich, ja/nein, Zahlen, eine Lage als „x · y“, eine Linie oder Fläche als Zahl
 * ihrer Punkte (nie als Liste), eine Kennung als „anderer Eintrag“, ein unbekanntes Objekt als Satz seiner einfachen Angaben. Nie rohes JSON.
 * Nur `undefined` bleibt `undefined`: Der Wert wurde nicht geführt, und das Detail sagt es mit eigenen Worten. Was eine Art besser weiß (Wegart,
 * Ebene, Gebirgswerte), setzt `aenderung-felder.ts` davor.
 */
export function wertText(_feld: string, wert: unknown): string | undefined {
    if (wert === undefined) return undefined;
    if (wert === null || wert === "") return "–";
    if (typeof wert === "boolean") return t(wert ? "editorListe.ja" : "editorListe.nein");
    if (istZahl(wert)) return Number.isInteger(wert) ? String(wert) : formatNumber(wert, 2);
    if (typeof wert === "string") return istKennung(wert) ? t("aenderungen.wert.verweis") : kuerzen(wert);
    if (Array.isArray(wert)) {
        if (wert.length === 0) return "–";
        if (istPunkt(wert)) return (wert as number[]).map((zahl) => formatNumber(zahl, 2)).join(" · ");
        const punkte = punkteZaehlen(wert);
        if (punkte !== undefined) return t("aenderungen.wert.punkte", { n: formatNumber(punkte, 0) });
        if (wert.every((teil) => typeof teil === "string" || istZahl(teil)))
            return kuerzen(
                wert.map((teil) => (istKennung(teil) ? t("aenderungen.wert.verweis") : String(teil))).join(", "),
            );
        return t("aenderungen.wert.eintraege", { n: formatNumber(wert.length, 0) });
    }
    return objektText(wert as Record<string, unknown>);
}
