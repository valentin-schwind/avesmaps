import { ordneGefahren, type GefahrenArt } from "@avesmaps3d/shared";
import { t, type MessageKey } from "../i18n/i18n";

/**
 * Die Gefahrenlage in Worten (WI-0308): je Art ihr Name aus den Sprachtafeln (`gefahr.art.<schlüssel>`), eine Auswahl als Liste mit
 * Komma in der Folge des Katalogs, keine Art als „ungefährlich“. 🔴 Die Schlüssel stehen im Namensraum `gefahr.*`, nicht unter
 * `landschaftseditor.*`: Infopanel und Planer sind Besucherwege und laden die späten Texte der Editoren nicht (`spaete-texte.ts`).
 */
export const gefahrName = (art: GefahrenArt): string => t(`gefahr.art.${art}` as MessageKey);

/** Die Arten mit Komma; ohne Art „ungefährlich“. */
export function gefahrenText(arten: Iterable<string>): string {
    const geordnet = ordneGefahren(arten);
    return geordnet.length === 0 ? t("gefahr.ungefaehrlich") : geordnet.map(gefahrName).join(", ");
}
