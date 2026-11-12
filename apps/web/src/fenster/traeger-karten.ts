import { onScopeDispose, shallowRef, watch, type ShallowRef } from "vue";
import { subjectKey, type CitymapEntry, type SubjectCitymapsSection, type SubjectRef } from "@avesmaps3d/shared";
import { fetchSection } from "../info-panel/panel-section-load";

/**
 * Die Karten der Kartensammlung, die ein Objekt abbilden, für den Reiter „Karten“ seines Eigenschaftseditors (Vali 2026-11-02: „als tab im eigenschaftseditor von objekten die eine karte haben bzw in der
 * kartensammlung sind, sollen hier alle karten gelistet werden. ein klick öffnet den eintrag im MAM“). Gelesen wird die Sektion, die auch das Infopanel zeigt (`GET /api/subjects/{kind}/{id}/citymaps`), mit
 * `?editor=true` für den Editor. Der Reiter steht nur, wenn es Karten gibt; darum liest die Sektion sofort, nicht erst beim Öffnen des Reiters.
 *
 * - **Wechsel des Objekts:** Die alte Liste bleibt, bis die neue da ist; ein gewählter Reiter springt nicht um, wenn auch das nächste Objekt Karten hat.
 * - **Keine Karten (auch nach einem Fehler):** `beiLeer` holt die Eigenschaften nach vorn; der Reiter fällt einfach weg. Ein Fehler sagt nichts: Die Karten sind eine Zugabe, und bearbeitet wird hier nicht.
 */
export function useTraegerKarten(
    ziel: () => SubjectRef | undefined,
    beiLeer: () => void,
    fetcher?: typeof fetch,
): Readonly<ShallowRef<readonly CitymapEntry[]>> {
    const karten = shallowRef<readonly CitymapEntry[]>([]);
    let lauf: AbortController | undefined;
    const setze = (liste: readonly CitymapEntry[]): void => {
        karten.value = liste;
        if (liste.length === 0) beiLeer();
    };
    watch(
        () => {
            const ref = ziel();
            return ref === undefined ? undefined : subjectKey(ref);
        },
        () => {
            lauf?.abort();
            const ref = ziel();
            if (ref === undefined) {
                setze([]);
                return;
            }
            const eigener = new AbortController();
            lauf = eigener;
            fetchSection<SubjectCitymapsSection>("citymaps", ref, eigener.signal, fetcher).then(
                (antwort) => {
                    if (!eigener.signal.aborted) setze(antwort?.maps ?? []);
                },
                () => {
                    if (!eigener.signal.aborted) setze([]);
                },
            );
        },
        { immediate: true },
    );
    onScopeDispose(() => lauf?.abort());
    return karten;
}
