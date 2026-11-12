import type { InjectionKey } from "vue";
import type { LoreKind } from "@avesmaps3d/shared";

/**
 * Das Panel eines Vorkommens öffnen (Betreiber 2026-10-30: „wenn ich da auf ein ding draufklicke kommt keine infobox dazu“): dieselbe Hand wie der Treffer der Suche
 * (`zeigeEintrag` in `app.vue`), also Titel sofort und am Telefon eingeklappt mit der Pille „Eintrag öffnen“. Der Name einer Vorkommenszeile in der Infobox (`info-lore-entry.vue`) ruft sie
 * mit Kennung, Name und Art, die die Zeile kennt; ohne Hand (eine Probeseite, ein Bauteiltest) öffnet er wie jeder Objektlink über `info-panel.vue`.
 */
export type EintragOeffnen = (id: string, name: string, kind: LoreKind) => void;
export const EINTRAG_OEFFNEN: InjectionKey<EintragOeffnen> = Symbol("eintrag-oeffnen");
