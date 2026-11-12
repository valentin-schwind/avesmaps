import type { WetterEinheit } from "@avesmaps3d/shared";
import { t, type MessageKey } from "../i18n/i18n";

/**
 * Die Wörter der Einheiten aller Wetterwerte (WI-0288): der fünf jahreszeitlichen Werte im Wetter-Editor (Stufe 3) und der übrigen im
 * Reiter „Wettermodell“ der Systemsteuerung (Stufe 4). Ein eigenes kleines Modul, damit die Systemsteuerung es lesen kann, ohne das Modell
 * des Editors (Liste, Planer) mitzuladen. `zahl` steht ohne Wort da.
 */
const EINHEIT_TEXT: Readonly<Record<WetterEinheit, MessageKey | null>> = {
    celsius: "wettereditor.einheit.celsius",
    grad: "wettereditor.einheit.grad",
    faktor: "wettereditor.einheit.faktor",
    prozent: "wettereditor.einheit.prozent",
    meter: "wettereditor.einheit.meter",
    km: "wettereditor.einheit.km",
    zahl: null,
    je_sekunde: "wettereditor.einheit.jeSekunde",
    fps: "wettereditor.einheit.fps",
    einheiten: "wettereditor.einheit.einheiten",
    zellen: "wettereditor.einheit.zellen",
};

export function einheitText(einheit: WetterEinheit): string {
    const schluessel = EINHEIT_TEXT[einheit];
    return schluessel === null ? "" : t(schluessel);
}
