import { computed, onBeforeUnmount, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { PANEL_SECTION_SWITCH, subjectKey, type SubjectRef, type SubjectReviewsSection } from "@avesmaps3d/shared";
import { bewertungGeschrieben } from "../community/bewertung-signal";
import { ausgeblendet } from "../system/inhaltsstand";
import { cachedSection, editorSektionen, loadSection, reloadSection } from "./panel-section-load";

/**
 * Die Bewertungen eines Orts für das Infopanel (WI-0269 C10): EINE Frage für die Zeile im Kopf und den Reiter. Beide lesen dieselbe Sektion
 * (`GET /api/subjects/place/{id}/reviews`, nur Öffentliches), und beide zeigen dieselbe Zahl; der Kopf braucht den Durchschnitt schon, wenn der Reiter zu ist.
 *
 * - 🔴 Die Antwort gehört zu IHREM Ort: Wechselt er, bricht die Frage ab, und eine verspätete Antwort eines anderen gilt nie.
 * - Ein Inhaltsschalter der Systemsteuerung (`panel.reviews`, WI-0127 SYS-10) blendet die Bewertungen für Besucher aus: dann fragt dieser Baustein nicht, und Kopf, Reiter und
 *   Kachel entfallen (`pausiert`). Ein Editor sieht sie echt, mit dem Vermerk „öffentlich ausgeblendet“ (`oeffentlichAusgeblendet`, SYS-11).
 * - `lade(true)` fragt am Cache und am Zwischenspeicher vorbei: nach einer eigenen Handlung (eine Bewertung geschrieben) soll sie dastehen.
 */
export interface OrtBewertungen {
    status: Ref<"loading" | "ready" | "error">;
    section: ShallowRef<SubjectReviewsSection | undefined>;
    /** Die Bewertungen sind für Besucher ausgeblendet (Inhaltsschalter): Kopf, Reiter und Kachel entfallen. */
    pausiert: ComputedRef<boolean>;
    /** Ein Editor sieht die Bewertungen, obwohl sie für Besucher ausgeblendet sind. */
    oeffentlichAusgeblendet: ComputedRef<boolean>;
    lade(frisch?: boolean): Promise<void>;
    /** Die Zahl „Gefällt mir“ einer Bewertung nach dem Klick, ohne neu zu laden. */
    setzeGefaellt(id: string, zahl: number): void;
}

export function useOrtBewertungen(subject: () => SubjectRef): OrtBewertungen {
    const status = ref<"loading" | "ready" | "error">("loading");
    const section = shallowRef<SubjectReviewsSection | undefined>(undefined);
    let controller: AbortController | undefined;
    const editorSicht = editorSektionen();
    const schalter = PANEL_SECTION_SWITCH["reviews"];
    const ausgeblendetHier = (): boolean => !editorSicht && schalter !== undefined && ausgeblendet(schalter);
    const pausiert = computed(
        () => ausgeblendetHier() || (section.value as { paused?: true } | undefined)?.paused === true,
    );
    const oeffentlichAusgeblendet = computed(
        () => (section.value as { publicHidden?: true } | undefined)?.publicHidden === true,
    );

    async function lade(frisch = false): Promise<void> {
        controller?.abort();
        const ziel = subject();
        if (ziel.kind !== "place" || ausgeblendetHier()) {
            section.value = undefined;
            status.value = "ready";
            return;
        }
        if (!frisch) {
            const treffer = cachedSection<SubjectReviewsSection>("reviews", ziel);
            if (treffer !== undefined) {
                section.value = treffer;
                status.value = "ready";
                return;
            }
        }
        const eigene = new AbortController();
        controller = eigene;
        if (section.value === undefined || !frisch) status.value = "loading";
        try {
            const geladen = frisch
                ? await reloadSection<SubjectReviewsSection>("reviews", ziel, eigene.signal)
                : await loadSection<SubjectReviewsSection>("reviews", ziel, eigene.signal);
            if (eigene.signal.aborted) return;
            section.value = geladen ?? undefined;
            status.value = "ready";
        } catch (fehler) {
            if (eigene.signal.aborted) return;
            console.error("Infopanel: Bewertungen nicht geladen", fehler);
            status.value = "error";
        }
    }

    watch(
        () => subjectKey(subject()),
        () => {
            section.value = undefined;
            void lade();
        },
        { immediate: true },
    );
    // Hier wurde eine Bewertung geschrieben (`bewertung-fenster.vue`): frisch laden, am Cache und am Zwischenspeicher vorbei.
    watch(bewertungGeschrieben, (ereignis) => {
        const ziel = subject();
        if (ereignis !== undefined && ziel.kind === "place" && ziel.id.toLowerCase() === ereignis.ort.toLowerCase()) {
            void lade(true);
        }
    });
    onBeforeUnmount(() => controller?.abort());

    return {
        status,
        section,
        pausiert,
        oeffentlichAusgeblendet,
        lade,
        setzeGefaellt(id, zahl) {
            const jetzt = section.value;
            if (jetzt === undefined) return;
            section.value = {
                ...jetzt,
                reviews: jetzt.reviews.map((eintrag) => {
                    if (eintrag.id !== id) return eintrag;
                    const neu = { ...eintrag };
                    if (zahl > 0) neu.likes = zahl;
                    else delete neu.likes;
                    return neu;
                }),
            };
        },
    };
}
