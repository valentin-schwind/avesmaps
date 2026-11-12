import { computed, ref, shallowRef, type ComputedRef, type Ref } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { SearchSpracheHit, SpracheRef } from "@avesmaps3d/shared";
import { sprachChoiceList, type ChoiceList } from "../controls/choice-list";
import type { OpenSubjectOptions } from "../info-panel/subject-selection";
import { spracheOwner } from "./interaction/sprache-owner";
import type { InteractionOwner, Screen } from "./interaction/types";
import { sprachePointerHint, type PointerHint } from "./pointer-hint";
import { installSprachHover, type SprachHover, type SpracheAnStelle } from "./sprachen-auswahl";
import type { SprachLegendenZeile } from "./sprachen-stand";

/**
 * Die Wahl einer Sprache aus Karte, Menü am Zeiger und Legende (WI-0261 S5b), an EINER Stelle, damit `app.vue` nur einhängt (Hausregel: `app.vue` schmal).
 *
 * - Ein Klick auf eine Sprache (Karte, Menü, Legende) öffnet ihre Infobox über die eine Öffnungsnaht (`openSubject`); die Kamera fliegt auf die Hauptteile
 *   (`camera: "target"`, das Ziel der Antwort), die Fläche leuchtet sofort (`known.presentation.sprache`, gezeichnet über `sprachen-leuchten.ts` am Stil).
 * - Zeigen auf der Karte, im Menü und in der Legende hebt die Sprache über denselben Feature-State hervor (`installSprachHover`).
 * - Die Wahl selbst (`gewaehlt`) setzt `app.vue` aus der Darstellung des gewählten Subjects (`PresentedSelection.sprache`), wie jede Fläche.
 * - Karte und Menü am Zeiger reichen die getroffene Teilfläche mit (`OpenSubjectOptions.teilflaeche`): Ist der Spracheditor offen, wählt er sie in seiner
 *   Liste (WI-0261 Stufe 1; Betreiber 2026-10-31: „ich kann auch teilfächen auf der karte nicht anklicken, sodass sie in der liste selektiert werden“).
 */
export interface SprachWahl {
    /** Der Schlüssel der gewählten Sprache; ihn setzt die Darstellung des Subjects (`present`). */
    gewaehlt: Ref<string | undefined>;
    /** Das Menü am Zeiger, wo mehrere Sprachen liegen; `undefined`: zu. */
    menu: ComputedRef<ChoiceList | undefined>;
    /** Nach dem Laden der Karte: der Feature-State für das Zeigen. */
    install(map: MapLibreMap): void;
    /** Der Besitzer der Zeigerereignisse (Rang `sprache`). */
    owner(): InteractionOwner;
    /** Ein Eintrag des Menüs. */
    choose(id: string): void;
    /** Zeigen auf einen Eintrag des Menüs (`undefined`: keiner). */
    preview(id: string | undefined): void;
    close(): void;
    /** Eine Zeile der Legende. */
    waehle(zeile: SprachLegendenZeile): void;
    /** Zeigen auf eine Zeile der Legende (`undefined`: keine). */
    zeige(schluessel: string | undefined): void;
    /**
     * Ein Treffer der Spotlight-Suche (WI-0261 S5c): wie die Legende, nur mit der Quelle `search`, und die Ansicht wechselt gleich in die Ebene „Sprachen“ der Derographie, statt erst mit der
     * Antwort des Servers. Die Kamera fliegt auf die Hauptteile (`camera: "target"`), die Flächen leuchten (`present` folgt der Wahl).
     */
    waehleAusSuche(treffer: Pick<SearchSpracheHit, "id" | "name" | "schluessel" | "dialektVon">): void;
}

export function useSprachWahl(deps: {
    open: (ref: SpracheRef, options: OpenSubjectOptions) => void;
    /** Das eine Zeiger-Schild der Karte. */
    hint: (hint: PointerHint | undefined) => void;
    /** Die Sprache wurde bewusst gewählt: Ihre Flächen leuchten (WI-0261 S5c, `sprachen-leuchten.ts`), auch bei erneuter Wahl derselben. */
    leuchte?: (schluessel: string) => void;
}): SprachWahl {
    const gewaehlt = ref<string | undefined>(undefined);
    const auswahl = shallowRef<{ sprachen: readonly SpracheAnStelle[]; screen: Screen } | undefined>(undefined);
    let hover: SprachHover | undefined;

    const oeffne = (
        sprache: { id: string; name: string; schluessel: string; teilflaeche?: string | undefined },
        source: OpenSubjectOptions["source"],
        anchor?: Screen,
    ): void => {
        deps.open(
            { kind: "sprache", id: sprache.id },
            {
                source,
                camera: "target",
                known: { title: sprache.name, presentation: { sprache: sprache.schluessel } },
                ...(anchor === undefined ? {} : { anchor }),
                ...(sprache.teilflaeche === undefined ? {} : { teilflaeche: sprache.teilflaeche }),
            },
        );
        deps.leuchte?.(sprache.schluessel);
    };

    /** Die gewählte Sprache als Eintrag des Menüs (über ihren Schlüssel). */
    const auswahlId = (schluessel: string | undefined): string | undefined =>
        auswahl.value?.sprachen.find((sprache) => sprache.schluessel === schluessel)?.id;
    const menu = computed(() =>
        auswahl.value === undefined
            ? undefined
            : sprachChoiceList(auswahl.value.sprachen, auswahl.value.screen, auswahlId(gewaehlt.value)),
    );

    return {
        gewaehlt,
        menu,
        install(map) {
            hover = installSprachHover(map);
        },
        owner() {
            return spracheOwner({
                select: (sprache, at) => oeffne(sprache, "map", at),
                choose: (sprachen, at) => {
                    deps.hint(undefined);
                    auswahl.value = { sprachen, screen: at };
                },
                hover: (sprachen, at) => {
                    // Solange das Menü offen ist, gehört das Zeigen ihm (Vorlage: `menueHover`): kein Schild, keine zweite Hervorhebung.
                    const menuOffen = auswahl.value !== undefined;
                    deps.hint(
                        sprachen === undefined || at === undefined || menuOffen
                            ? undefined
                            : sprachePointerHint(sprachen, at),
                    );
                    if (!menuOffen) hover?.setze(sprachen?.[0]?.schluessel);
                },
            });
        },
        choose(id) {
            const offen = auswahl.value;
            const sprache = offen?.sprachen.find((eintrag) => eintrag.id === id);
            if (offen === undefined || sprache === undefined) return;
            oeffne(sprache, "map", offen.screen);
        },
        preview(id) {
            hover?.setze(auswahl.value?.sprachen.find((sprache) => sprache.id === id)?.schluessel);
        },
        close() {
            auswahl.value = undefined;
            hover?.setze(undefined);
        },
        waehle(zeile) {
            oeffne(zeile, "context");
        },
        zeige(schluessel) {
            hover?.setze(schluessel);
        },
        waehleAusSuche(treffer) {
            deps.open(
                { kind: "sprache", id: treffer.id },
                {
                    source: "search",
                    camera: "target",
                    known: {
                        // Über einen Dialekt gefunden, öffnet sich die Infobox der Sprache: Sie heißt von Anfang an so.
                        title: treffer.dialektVon ?? treffer.name,
                        presentation: { view: "landscapes", landscape: "sprachen", sprache: treffer.schluessel },
                    },
                },
            );
            deps.leuchte?.(treffer.schluessel);
        },
    };
}
