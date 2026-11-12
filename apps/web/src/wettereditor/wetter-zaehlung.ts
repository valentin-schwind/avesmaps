import type { WetterSymbol } from "@avesmaps3d/shared";
import { kreisZaehlung, type Kreis } from "../editor-liste/liste-modell";
import { t } from "../i18n/i18n";
import type { WetterBestand } from "./wetter-editor-modell";

/**
 * Der Kreis eines Wetter-Icons und die Zählung der Kachel „Wetter“ (WI-0288 Stufe 3, `editor-panel/karteninhalte-zahlen.ts`). Eigenes Modul, weil die Kacheln im
 * Startpaket stehen und das Modell des Editors (`wetter-editor-modell.ts`) mit der Steuerung nachlädt.
 */

/** Der Kreis eines Icons: ○ ausgeblendet, ● mit Namen auf der Karte, sonst ◐. */
export function symbolKreis(symbol: Pick<WetterSymbol, "sichtbar" | "nameZeigen" | "name">): Kreis {
    if (!symbol.sichtbar) return "leer";
    return symbol.nameZeigen && symbol.name !== null ? "voll" : "halb";
}

/** Die Namen der Kreise der Icons (Legende unter der Liste und an der Kachel). */
export const WETTER_LEGENDE = (): Partial<Record<Kreis, string>> => ({
    voll: t("wettereditor.legende.mitNamen"),
    halb: t("wettereditor.legende.ohneNamen"),
    leer: t("wettereditor.legende.ausgeblendet"),
});

/** Die Zählung der Kachel „Wetter“: alle Einträge, die Kreise der Icons mit ihrer Legende. */
export function zaehlungAusWetter(bestand: WetterBestand): {
    gesamt: number;
    kreise: Record<Kreis, number>;
} {
    return {
        gesamt: bestand.presets.length + bestand.symbole.length,
        kreise: kreisZaehlung(bestand.symbole.map(symbolKreis)),
    };
}
