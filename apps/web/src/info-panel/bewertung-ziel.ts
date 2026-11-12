import { shallowRef } from "vue";
import { leseBewertungsLink } from "./bewertungen-modell";

/**
 * Das Ziel eines geteilten Links auf eine Bewertung (WI-0269 C10, Fachkonzept §14.6a): `?place=<Ort>&bewertung=<Bewertung>`. Die Seite liest es beim Start einmal
 * (`merkeBewertungsLink`); der Ort öffnet sich wie bei jedem Objektlink (`object-link.ts`, `place=`), und das Panel dieses Orts (`info-content.vue`) wählt dann gleich den Reiter
 * „Bewertungen“ und hebt die Bewertung hervor. Das Ziel gilt genau einmal: Das Panel nimmt es beim Öffnen heraus.
 */
export const bewertungsZiel = shallowRef<{ ort: string; bewertung: string } | undefined>(undefined);

/** Merkt sich das Ziel aus der Suche der Adresse; ohne gültige Kennungen bleibt nichts. */
export function merkeBewertungsLink(suche: string): void {
    bewertungsZiel.value = leseBewertungsLink(suche);
}
