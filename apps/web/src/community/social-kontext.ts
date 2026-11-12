import { shallowRef } from "vue";
import { KANAL_KONTEXT_VORGABE, kanalKontext, type KanalKontext, type SocialKanalStand } from "@avesmaps3d/shared";

/**
 * Der Stand der fremden Kanäle, wie der Server ihn zuletzt gemeldet hat (WI-0268 C12a, `GET /api/community/social/kanaele`). Liste und Fenster des Social Hubs lesen ihn mit denselben Zählregeln wie der Server:
 * Welche Kanäle senden (Neuigkeiten immer; Mastodon nur eingerichtet, freigeschaltet und ohne Notschalter), welche Grenzen die Instanz nennt, warum ein Kanal gesperrt ist.
 *
 * Eine kleine Tafel für sich, ohne Netz und ohne Fenster, damit das Modell (`social-modell.ts`) sie lesen kann, ohne die Schnittstelle zu laden. Solange nichts geladen ist, gilt die Vorgabe: nur die Neuigkeiten
 * senden, alle Regeln wie in `ZAEHLREGELN`.
 */
export const kanalStaende = shallowRef<readonly SocialKanalStand[]>([]);
/** Darf diese Sitzung Notschalter und Grenzen verwalten (`manage_social_channels`)? */
export const kanalVerwalten = shallowRef(false);

/** Welche Kanäle senden und mit welchen Grenzen gezählt wird; wer es in einer `computed` liest, rechnet bei jedem neuen Stand neu. */
export function kanalKontextJetzt(): KanalKontext {
    const staende = kanalStaende.value;
    return staende.length === 0 ? KANAL_KONTEXT_VORGABE : kanalKontext(staende);
}

/** Der Stand eines Kanals mit Zugang, falls der Server ihn gemeldet hat. */
export const kanalStandVon = (kanal: string): SocialKanalStand | undefined =>
    kanalStaende.value.find((stand) => stand.kanal === kanal);
