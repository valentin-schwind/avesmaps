import { SOCIAL_URL, type KanalMitZugang, type SocialKanaele, type SocialKanalStand } from "@avesmaps3d/shared";
import { getJson, postJson, type Fetcher } from "../auth/api";
import { withConfirmation, type ReadConfirmation } from "../auth/bestaetigen";
import { kanalStaende, kanalVerwalten } from "./social-kontext";

/**
 * Die fremden Kanäle des Social Hubs an der Leitung (WI-0268 C12a; Server: `apps/server/src/routes/social.ts`, Vertrag `packages/shared/src/community-social.ts`). Lesen: der Stand (eingerichtet, freigeschaltet,
 * Notschalter, Grenzen der Instanz). Schreiben: Notschalter setzen und Grenzen neu lesen; beides verlangt `manage_social_channels` und einen frischen Passkey (Stufe S), den die Oberfläche über „Kurz bestätigen“
 * erfragt (`withConfirmation`) und die Handlung einmal wiederholt.
 */

/**
 * Lädt den Stand und legt ihn in die gemeinsame Tafel (`social-kontext.ts`). `false`, wenn er nicht kam: Dann gilt der letzte Stand weiter. Mit `frage` (die Systemsteuerung, `social-verwaltung.vue`) fragt ein fehlender
 * zweiter Faktor nach; der Hub liest ohne Rückfrage.
 */
export async function aktualisiereKanaele(fetcher?: Fetcher, frage?: ReadConfirmation["ask"]): Promise<boolean> {
    const hole = (): Promise<SocialKanaele> => getJson<SocialKanaele>(`${SOCIAL_URL}/kanaele`, fetcher);
    try {
        const antwort = await (frage === undefined ? hole() : withConfirmation(hole, frage));
        kanalStaende.value = antwort.kanaele;
        kanalVerwalten.value = antwort.verwalten;
        return true;
    } catch {
        return false;
    }
}

function uebernimm(stand: SocialKanalStand): SocialKanalStand {
    kanalStaende.value = kanalStaende.value.some((s) => s.kanal === stand.kanal)
        ? kanalStaende.value.map((s) => (s.kanal === stand.kanal ? stand : s))
        : [...kanalStaende.value, stand];
    return stand;
}

/** Den Notschalter eines Kanals setzen (`an`) oder lösen. */
export const setzeNotschalter = async (
    kanal: KanalMitZugang,
    an: boolean,
    fetcher?: Fetcher,
): Promise<SocialKanalStand> =>
    uebernimm(
        await withConfirmation(() =>
            postJson<SocialKanalStand>(`${SOCIAL_URL}/kanaele/${kanal}/notschalter`, { an }, fetcher),
        ),
    );

/** Die Grenzen des Dienstes neu lesen (Mastodon: `GET /api/v2/instance`) beziehungsweise den Zugang prüfen (Facebook, Instagram: ein lesender Aufruf bei Meta). */
export const liesGrenzenNeu = async (kanal: KanalMitZugang, fetcher?: Fetcher): Promise<SocialKanalStand> =>
    uebernimm(
        await withConfirmation(() => postJson<SocialKanalStand>(`${SOCIAL_URL}/kanaele/${kanal}/grenzen`, {}, fetcher)),
    );
