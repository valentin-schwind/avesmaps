import { onBeforeUnmount, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import { subjectKey } from "@avesmaps3d/shared";
import { cachedCatalog, loadCatalog, type CatalogAnswer } from "../info-panel/catalog-model";
import type { CatalogTarget } from "../info-panel/panel-types";

/**
 * Die Liste, die ein Katalogfenster zeigt (WI-0118): dieselbe Frage wie der Streifen im Panel (`loadCatalog`, abbrechbar, bei Last von selbst
 * wiederholt) und derselbe kurze Cache - Streifen und Fenster fragen den Server also nicht zweimal, und sie zeigen nie verschiedene Mengen.
 *
 * Gefragt wird erst, wenn das Fenster AUFGEHT: Ein zugeklapptes Fenster hält keine Liste. Wechselt der Gegenstand oder schließt das Fenster,
 * bricht die Frage ab, und die verspätete Antwort eines anderen gilt nie (die Kennung `key` gehört zur Frage).
 */
export type CatalogStatus = "idle" | "loading" | "ready" | "error";

export interface CatalogSectionState<Answer extends CatalogAnswer> {
    status: Ref<CatalogStatus>;
    answer: ShallowRef<Answer | undefined>;
    retry: () => void;
}

export function useCatalogSection<Answer extends CatalogAnswer>(
    section: CatalogTarget["section"],
    target: () => CatalogTarget | undefined,
    open: () => boolean,
): CatalogSectionState<Answer> {
    const status = ref<CatalogStatus>("idle");
    const answer = shallowRef<Answer | undefined>(undefined) as ShallowRef<Answer | undefined>;
    let controller: AbortController | undefined;

    async function load(): Promise<void> {
        controller?.abort();
        const wanted = target();
        if (wanted === undefined || wanted.section !== section || !open()) return;
        const cached = cachedCatalog(section, wanted.ref);
        if (cached !== undefined) {
            answer.value = cached as Answer;
            status.value = "ready";
            return;
        }
        const own = new AbortController();
        controller = own;
        status.value = "loading";
        answer.value = undefined;
        try {
            const loaded = await loadCatalog(section, wanted.ref, own.signal);
            if (own.signal.aborted) return;
            answer.value = (loaded ?? undefined) as Answer | undefined;
            status.value = "ready";
        } catch (error) {
            if (own.signal.aborted) return;
            console.error(`Katalogfenster: Liste ${section} nicht geladen`, error);
            status.value = "error";
        }
    }

    watch(
        () => {
            const wanted = target();
            return open() && wanted?.section === section ? subjectKey(wanted.ref) : undefined;
        },
        (key) => {
            if (key === undefined) {
                controller?.abort();
                return;
            }
            void load();
        },
        { immediate: true },
    );
    onBeforeUnmount(() => controller?.abort());

    return { status, answer, retry: () => void load() };
}
