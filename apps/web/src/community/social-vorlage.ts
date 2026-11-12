import { t } from "../i18n/i18n";

/**
 * Der Text des Entwurfs bei „Als Beitrag vorschlagen“ (WI-0270 C11), in einer eigenen kleinen Datei: Das Vorgangsfenster liegt im Startpaket und soll die Zählung des Social Hubs nicht mitziehen.
 */

/**
 * Der Text des Entwurfs bei „Als Beitrag vorschlagen“ (Bedienkonzept §6.6): der Gegenstand der Meldung und ihr Ergebnis, ohne Namen, Kontakt und Text des Melders. Die Redaktion schreibt ihn um.
 * `name` ist der Name des Bezugs (Ort, Gebiet …), `ergebnis` das Wort des Abschlusses.
 */
export function vorlageAusVorgang(name: string | null | undefined, ergebnis: string | null | undefined): string {
    const wer = (name ?? "").trim();
    const was = (ergebnis ?? "").trim();
    if (wer !== "" && was !== "") return t("community.social.vorgang.vorlage", { name: wer, ergebnis: was });
    if (wer !== "") return t("community.social.vorgang.vorlageName", { name: wer });
    return "";
}
