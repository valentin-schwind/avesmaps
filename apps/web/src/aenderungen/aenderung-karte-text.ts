import { t } from "../i18n/i18n";
import type { KartenHinweise } from "./aenderung-karte-modell";

/**
 * Was das Bild von Vorher und Nachher über die Lücken im Protokoll sagt, in Worten (WI-0265 B5b): im Detail unter dem Knopf „Auf der Karte zeigen“ und
 * auf der Leiste der Karte. Ein Satz je Lücke, in dieser Folge; keine Lücke, kein Satz.
 */
export function kartenHinweisTexte(hinweise: KartenHinweise): string[] {
    return [
        ...(hinweise.vorherFehlt ? [t("aenderungen.karte.hinweis.vorherFehlt")] : []),
        ...(hinweise.vorherTeilweise ? [t("aenderungen.karte.hinweis.vorherTeilweise")] : []),
        ...(hinweise.nachherTeilweise ? [t("aenderungen.karte.hinweis.nachherTeilweise")] : []),
    ];
}
