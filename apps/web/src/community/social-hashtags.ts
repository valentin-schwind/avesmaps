import { shallowRef } from "vue";
import { SOCIAL_URL, type SocialHashtag, type SocialHashtags } from "@avesmaps3d/shared";
import { getJson, postJson, type Fetcher } from "../auth/api";
import { withConfirmation } from "../auth/bestaetigen";

/**
 * Die Hashtags, die der Social Hub in jedem Beitrag anbietet (WI-0270; Server: `apps/server/src/community/social/hashtags.ts`). Eine gemeinsame Tafel: Das Fenster eines Beitrags folgt einer Änderung im Panel „Hashtags“
 * der Systemsteuerung (`social-verwaltung.vue`) sofort.
 */
export const hashtagVorrat = shallowRef<readonly SocialHashtag[]>([]);

/** Lädt die Liste. `false`, wenn sie nicht kam: Dann gilt der letzte Stand weiter, und eigene Hashtags gehen im Beitrag trotzdem. */
export async function ladeHashtags(fetcher?: Fetcher): Promise<boolean> {
    try {
        hashtagVorrat.value = (await getJson<SocialHashtags>(`${SOCIAL_URL}/hashtags`, fetcher)).hashtags;
        return true;
    } catch {
        return false;
    }
}

/** Speichert die ganze Liste; die Tafel steht sofort auf dem neuen Stand und fällt zurück, wenn es nicht ging. */
export async function speichereHashtags(hashtags: readonly SocialHashtag[], fetcher?: Fetcher): Promise<void> {
    const vorher = hashtagVorrat.value;
    hashtagVorrat.value = hashtags;
    try {
        const antwort = await withConfirmation(() =>
            postJson<SocialHashtags>(`${SOCIAL_URL}/hashtags`, { hashtags }, fetcher),
        );
        hashtagVorrat.value = antwort.hashtags;
    } catch (fehler) {
        hashtagVorrat.value = vorher;
        throw fehler;
    }
}
