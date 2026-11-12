import type { InhalteKorpusForm, InhalteKorpusVorgabe, InhalteLizenz } from "@avesmaps3d/shared";
import { t, type MessageKey } from "../i18n/i18n";
import { anzeigeformVon } from "./inhalte-korpora-modell";

/**
 * Die Worte des Reiters „Korpora“, die mehr als eine Stelle braucht (WI-0254, Runde 4): der Name einer Anzeigeform und die Namen und Werte der vier Felder der
 * Vorgabe. Die Liste, die Mitte, die Wirkung und die Quellen rechts sagen sie gleich.
 */

const FORM_NAMEN: Readonly<Record<ReturnType<typeof anzeigeformVon>, MessageKey>> = {
    belegstelle: "inhalte.korpora.form.belegstelle",
    werk: "inhalte.korpora.form.werk",
    unentschieden: "inhalte.korpora.form.unentschieden",
};

/** Der Name einer Anzeigeform; die leere Form heißt unentschieden. */
export const formName = (form: InhalteKorpusForm): string => t(FORM_NAMEN[anzeigeformVon(form)]);

const VORGABE_NAMEN: Readonly<Record<InhalteKorpusVorgabe, MessageKey>> = {
    sourceType: "inhalte.korpora.vorgabe.sourceType",
    isOfficial: "inhalte.korpora.vorgabe.isOfficial",
    lizenz: "inhalte.korpora.vorgabe.lizenz",
    attribution: "inhalte.korpora.vorgabe.attribution",
};

/** Der Name eines Felds der Vorgabe: Art, Offiziell, Lizenz, Namensnennung. */
export const vorgabeName = (feld: InhalteKorpusVorgabe): string => t(VORGABE_NAMEN[feld]);

/** Mehrere Felder der Vorgabe in einem Satzteil: „Art, Lizenz und Namensnennung“ (ohne Konjunktion: kommagetrennt, sprachfrei). */
export const vorgabeNamen = (felder: readonly InhalteKorpusVorgabe[]): string => felder.map(vorgabeName).join(", ");

/**
 * Der Wert, den ein Feld nach der Vorgabe trägt (der Server nennt Art und Lizenz als Schlüssel, „offiziell“ als ja oder nein), in den Worten des Hauses:
 * die Art als Name, die Lizenz als Name aus dem Katalog.
 */
export function vorgabeWertText(feld: InhalteKorpusVorgabe, wert: string, lizenzen: readonly InhalteLizenz[]): string {
    switch (feld) {
        case "sourceType":
            return t(`infoPanel.sourceType.${wert}` as MessageKey);
        case "isOfficial":
            return wert === "ja" ? t("inhalte.ja") : t("inhalte.nein");
        case "lizenz":
            if (wert === "public_domain") return t("infoPanel.source.licensePublicDomain");
            if (wert === "unfree") return t("infoPanel.source.licenseUnfree");
            return lizenzen.find((lizenz) => lizenz.key === wert)?.name ?? wert;
        case "attribution":
            return wert;
    }
}
