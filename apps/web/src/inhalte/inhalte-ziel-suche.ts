import { onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type { InhalteZiel } from "@avesmaps3d/shared";
import { istAbbruch } from "../medien/medien-client";
import type { InhalteClient } from "./inhalte-client";

/**
 * Die Suche nach Zielen im Fenster „Inhalte bearbeiten“ (WI-0254): Orte, Herrschaftsgebiete, Landschaften und Gipfel, die eine Quelle
 * nennt oder ein Werk der Literatur als Ort führt. Nur echte Kennungen kommen zurück, nie ein Name als Ziel. Ab zwei Zeichen, entprellt;
 * ein jüngerer Wunsch löst den älteren ab. Wege (je Straße ein Treffer) nur auf Wunsch (`wege`): der Reiter „Quellen“ führt sie, die Literatur nicht.
 */
export interface ZielSuche {
    readonly zielText: Ref<string>;
    readonly zielTreffer: ShallowRef<readonly InhalteZiel[]>;
    readonly zielLaedt: Ref<boolean>;
    leereZiele(): void;
}

export function createZielSuche(
    client: Pick<InhalteClient, "ziele">,
    entprellMs: number,
    optionen: { wege?: boolean } = {},
): ZielSuche {
    const zielText = ref("");
    const zielTreffer = shallowRef<readonly InhalteZiel[]>([]);
    const zielLaedt = ref(false);
    let zielAbbruch: AbortController | undefined;
    let zielTimer: ReturnType<typeof setTimeout> | undefined;
    function leereZiele(): void {
        zielAbbruch?.abort();
        zielText.value = "";
        zielTreffer.value = [];
    }
    watch(zielText, (text) => {
        if (zielTimer !== undefined) clearTimeout(zielTimer);
        zielAbbruch?.abort();
        if (text.trim().length < 2) {
            zielTreffer.value = [];
            zielLaedt.value = false;
            return;
        }
        zielTimer = setTimeout(async () => {
            const abbruch = new AbortController();
            zielAbbruch = abbruch;
            zielLaedt.value = true;
            try {
                const antwort = await client.ziele(text, abbruch.signal, optionen);
                if (!abbruch.signal.aborted) zielTreffer.value = antwort.items;
            } catch (fehler) {
                if (!istAbbruch(fehler, abbruch.signal)) zielTreffer.value = [];
            } finally {
                if (zielAbbruch === abbruch) zielLaedt.value = false;
            }
        }, entprellMs);
    });
    onScopeDispose(() => {
        zielAbbruch?.abort();
        if (zielTimer !== undefined) clearTimeout(zielTimer);
    });
    return { zielText, zielTreffer, zielLaedt, leereZiele };
}
