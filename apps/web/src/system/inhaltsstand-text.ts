import { CONTENT_SWITCHES } from "@avesmaps3d/shared";
import { schalterName } from "../auth/inhalte";
import { isMessageKey, t } from "../i18n/i18n";

/**
 * Die Sätze der Inhaltsschalter für Besucher (WI-0127 SYS-10, Blatt WI-0119 A2): an der Stelle des Inhalts (`pausiertSatz`) und die Zeile
 * „Gerade pausiert: …“ in den Hinweisen der Karte (`geradePausiert`).
 */

/** Der Satz an der Stelle eines ausgeblendeten Inhalts; `null`, wo es keinen gibt (Bilder zeigen ihren Platzhalter). */
export function pausiertSatz(key: string): string | null {
    const message = `inhalt.pausiert.${key}`;
    return isMessageKey(message) ? t(message) : null;
}

const RANG = new Map(CONTENT_SWITCHES.map((entry, index) => [entry.key, index]));

/** „Gerade pausiert: Kartenvorschauen, Literatur.“ in der Reihenfolge der Tafeln; `null`, wenn nichts aus ist. */
export function geradePausiert(off: ReadonlySet<string>): string | null {
    if (off.size === 0) return null;
    const keys = [...off].sort(
        (a, b) =>
            (RANG.get(a) ?? Number.MAX_SAFE_INTEGER) - (RANG.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b),
    );
    return t("inhalt.geradePausiert", { liste: keys.map(schalterName).join(", ") });
}
