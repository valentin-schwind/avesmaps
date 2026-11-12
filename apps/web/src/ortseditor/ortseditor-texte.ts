import { formatNumber, locale, t, type MessageKey } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import type { EntwurfFeld } from "./entwurf";
import type { VerschiebeMeldung } from "./ort-verschieben";
import type { Quittung } from "./verschieben";

/** Die Namen der Felder des Ortseditors, wie die Speicherleiste und der Konflikt sie nennen (WI-0128 E11). */
const FELD_NAMEN = {
    name: "ortseditor.feld.name",
    subtype: "ortseditor.feld.groesse",
    kind: "ortseditor.feld.art",
    hidden: "ortseditor.feld.verborgen",
    ruined: "ortseditor.feld.ruine",
    seaport: "ortseditor.feld.seehafen",
    nodix: "ortseditor.feld.nodix",
    underground: "ortseditor.feld.unterirdisch",
    withdrawn: "ortseditor.feld.entrueckt",
    approximate: "ortseditor.feld.ungefaehr",
    einwohner: "infoPanel.field.einwohner",
    oberhaupt: "ortseditor.feld.herrscher",
    lage: "infoPanel.field.lage",
    description: "infoPanel.field.description",
} as const satisfies Record<EntwurfFeld, MessageKey>;

export const feldNamen = (felder: readonly EntwurfFeld[]): string[] => felder.map((feld) => t(FELD_NAMEN[feld]));

/** Die Quittung des Verschiebens (Gesamtmockup): „Verschoben als Revision 16. 4 Wegenden mitgezogen.“ */
export function quittungsText(quittung: Quittung): string {
    const teile = [t("ortseditor.verschieben.quittung", { revision: String(quittung.revision) })];
    const n = (zahl: number): string => formatNumber(zahl, 0);
    if (quittung.mitgezogen === 1) teile.push(t("ortseditor.verschieben.mitgezogenEins"));
    else if (quittung.mitgezogen > 1) teile.push(t("ortseditor.verschieben.mitgezogen", { n: n(quittung.mitgezogen) }));
    if (quittung.eingerastet) teile.push(t("ortseditor.verschieben.eingerastet"));
    if (quittung.liegen === 1) teile.push(t("ortseditor.verschieben.liegenEins"));
    else if (quittung.liegen > 1) teile.push(t("ortseditor.verschieben.liegen", { n: n(quittung.liegen) }));
    return teile.join(" ");
}

/** Der Satz zum Konflikt beim Verschieben: wer, wann, und ob der Ort oder ein Weg an ihm geändert wurde. */
export function verschiebeKonfliktText(
    meldung: Extract<VerschiebeMeldung, { art: "konflikt" }>,
    ort: string,
    jetzt: Date = new Date(),
): string {
    const wann =
        meldung.wann === undefined
            ? t("ortseditor.konflikt.gerade")
            : relativeTime(new Date(meldung.wann), jetzt, locale.value);
    const schluessel: MessageKey =
        meldung.wer === undefined
            ? meldung.weg
                ? "ortseditor.verschieben.konflikt.jemandWeg"
                : "ortseditor.verschieben.konflikt.jemand"
            : meldung.weg
              ? "ortseditor.verschieben.konflikt.werWeg"
              : "ortseditor.verschieben.konflikt.wer";
    return t(schluessel, { wer: meldung.wer ?? "", ort, wann, revision: String(meldung.revision) });
}

// --- Verlauf (E17) ---

const VERLAUF_FELDER: Readonly<Record<string, MessageKey>> = {
    ...FELD_NAMEN,
    position: "ortseditor.feld.position",
    wiki: "ortseditor.abschnitt.wiki",
    active: "ortseditor.verlauf.aktiv",
};

/**
 * Die Felder, deren angezeigter Name den Freitext enthält, ohne Groß und Klein: Die Suche der „Änderungen“ schickt sie mit (`qFelder`),
 * denn die Namen kennt nur die Oberfläche („verb“ findet `hidden`, „Verborgen“).
 */
export function verlaufFelderMit(text: string): string[] {
    const gesucht = text.trim().toLocaleLowerCase(locale.value);
    if (gesucht === "") return [];
    return Object.keys(VERLAUF_FELDER).filter((feld) =>
        verlaufFeldName(feld).toLocaleLowerCase(locale.value).includes(gesucht),
    );
}

/** Der Name eines Felds im Verlauf; ein unbekanntes Feld steht mit seinem Schlüssel da. */
export const verlaufFeldName = (feld: string): string => {
    const key = VERLAUF_FELDER[feld];
    return key === undefined ? feld : t(key);
};

/** Ein Wert im Verlauf, wie Menschen ihn lesen: ja/nein, Lage als Koordinaten, leer als Strich, Ortsgröße mit Namen. */
export function verlaufWert(feld: string, wert: unknown): string {
    if (wert === undefined || wert === null || wert === "") return "–";
    if (typeof wert === "boolean") return t(wert ? "editorListe.ja" : "editorListe.nein");
    if (feld === "position" && Array.isArray(wert))
        return wert.map((zahl) => formatNumber(Number(zahl), 2)).join(" · ");
    if (feld === "subtype" && typeof wert === "string") return t(`place.${wert}` as MessageKey);
    return typeof wert === "string" ? wert : JSON.stringify(wert);
}
