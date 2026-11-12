import { onScopeDispose, ref, watch, type Ref, type WatchSource } from "vue";

/**
 * Ein Suchtext, der erst nach einer Tipp-Pause weitergeht (die Suchen der Leisten fragen den Server, Betreiber 2026-10-11): `ms` nach dem
 * letzten Zeichen, getrimmt. Leeren geht sofort, damit die Liste ohne Wartezeit zurückkommt.
 */
export function entprellt(quelle: WatchSource<string>, ms = 250): Ref<string> {
    const wert = ref("");
    let uhr: ReturnType<typeof setTimeout> | undefined;
    watch(
        quelle,
        (text) => {
            if (uhr !== undefined) clearTimeout(uhr);
            const neu = text.trim();
            if (neu === "") {
                wert.value = "";
                return;
            }
            uhr = setTimeout(() => (wert.value = neu), ms);
        },
        { immediate: true },
    );
    onScopeDispose(() => {
        if (uhr !== undefined) clearTimeout(uhr);
    });
    return wert;
}
