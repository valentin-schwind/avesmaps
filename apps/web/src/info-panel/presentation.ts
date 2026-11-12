import {
    pathChainKey,
    type LandscapeSelection,
    type MapPoint,
    type MapPointDetail,
    type MapView,
    type SubjectDetail,
} from "@avesmaps3d/shared";
import type { AreaSelection } from "../map/area-selection";
import type { SelectedPlace } from "../map/interaction/owners";

/**
 * Was die Karte für einen gewählten Subject zeigt (WI-0063 11.1): Es gibt genau EINEN `selectedSubject`; die drei
 * Darstellungszustände der Karte - der goldene Ortskern (`selectedPlace`), die leuchtende Fläche oder der Weg
 * (`areaSelection`), die goldene Etappe (`planner.selectedStage`) - werden aus ihm gespeist, nicht von ihm ersetzt, und
 * dazu der Tropfen einer freien Kartenstelle. `app.vue` setzt sie aus diesem einen Wert und kennt keine Art des Subjects.
 *
 * Eine fehlende Angabe heißt: Diese Darstellung endet (`present` ersetzt, es ergänzt nicht). Nur die Etappe gehört dem
 * Planer: Fehlt `stage`, bleibt die gewählte stehen (Esc und Leerklick ließen sie schon immer stehen).
 */
export interface PresentedSelection {
    /** Der angeklickte Ort; sein Kern steht gold. */
    place?: SelectedPlace;
    /** Die leuchtende Fläche, der leuchtende Weg oder das leuchtende Gebiet. */
    area?: AreaSelection;
    /** Die freie Kartenstelle: Der Tropfen steht dort. */
    pin?: MapPoint;
    /** Die gewählte Etappe der Reise im Planer. */
    stage?: number;
    /** Die Ansicht, in der der Subject zu sehen ist; nur gesetzt, wo die Auswahl nicht von der Karte kam (Link, Suche). */
    view?: MapView;
    /** Die Landschaftsebene, die die Ansicht zeigt, nur wo die Ansicht eine braucht (die Klimabänder liegen auf „Klima“). */
    landscape?: LandscapeSelection;
    /** Die Klimazone, die kräftiger steht, bis eine andere Auswahl kommt (der Schlüssel des Bands, wie bei der Suche). */
    climate?: string;
    /**
     * Die gewählte Kraftlinie leuchtet heller (WI-0063 P8): ihr Name, denn eine Kraftlinie ist die Gruppe ihrer Segmente und die
     * Karte kennt sie am Namen. Sie ist nur in der Kraftlinien-Ansicht zu sehen.
     */
    powerline?: { name: string };
    /**
     * Die gewählte Sprache (WI-0261 S5b): ihr Schlüssel (`sprache_flaeche_render.schluessel`). Sie steht in der Ebene „Sprachen“ im Hausmuster der Flächenauswahl
     * (`sprachen-auswahl.ts`).
     */
    sprache?: string;
}

export const NO_PRESENTATION: PresentedSelection = {};

/** Die Art eines Orts oder einer Fläche aus dem Untertitel einer Antwort: der erste Teil `type`, sonst leer. */
function typeKeyOf(detail: SubjectDetail): string {
    return detail.subtitle?.find((part) => part.part === "type")?.key ?? "";
}

/**
 * Die Darstellung für einen Subject, dessen Antwort gerade eintraf und der nicht von der Karte kam (Objektlink, Planer):
 * Dann weiß nur die Antwort, wie er heißt und wo er liegt. Ein Subject, den die Karte schon kannte, hat seine Darstellung
 * seit dem Klick; die Antwort ändert sie nicht.
 */
export function presentationFromDetail(detail: SubjectDetail | MapPointDetail): PresentedSelection {
    const ref = detail.subject;
    if (ref.kind === "mapPoint") return { pin: { x: ref.x, y: ref.y } };
    if (!("target" in detail) || detail.target === undefined) return {};
    const anchor = { x: detail.target.x, y: detail.target.y };
    const full = detail as SubjectDetail;
    switch (ref.kind) {
        case "place":
            return {
                place: { id: ref.id, name: full.title ?? "", subtype: typeKeyOf(full), x: anchor.x, y: anchor.y },
                view: "standard",
            };
        case "area": {
            const group = [ref.id, ...(ref.group ?? [])];
            return {
                area: {
                    kind: "landscape",
                    id: ref.id,
                    name: full.title ?? null,
                    type: typeKeyOf(full),
                    anchor,
                    ...(group.length > 1 ? { group } : {}),
                },
                view: "standard",
            };
        }
        case "territory":
            return {
                area: { kind: "territory", id: ref.id, name: full.title ?? null, type: "", anchor },
                view: "political",
            };
        // Ein Klimaband liegt nur in der Klimaansicht; dort steht es kräftiger (die Hervorhebung der Suche, `highlightedClimateZone`).
        case "climate":
            return { view: "landscapes", landscape: "klima", climate: ref.band };
        // Eine Kraftlinie liegt nur in ihrer eigenen Ansicht (`composeView`); dort leuchtet sie, wie das Klimaband in seiner.
        case "powerline":
            return { view: "powerlines", ...(full.title === undefined ? {} : { powerline: { name: full.title } }) };
        // Eine Sprache liegt nur in der Ebene „Sprachen“ der Derographie (WI-0261 E1); dort steht sie gewählt.
        case "sprache":
            return {
                view: "landscapes",
                landscape: "sprachen",
                ...(full.sprache === undefined ? {} : { sprache: full.sprache.schluessel }),
            };
        // Ein Wetter-Icon (WI-0288) gibt es nur in der Ansicht „Standard“; dort steht es, sobald Wind oder Meeresströmungen im Auge an sind.
        case "wetterSymbol":
            return { view: "standard" };
        case "path": {
            const type = typeKeyOf(full);
            if (full.title === undefined || type === "") return { view: "standard" };
            return {
                area: {
                    kind: "path",
                    id: "chain" in ref && ref.chain !== undefined ? ref.chain : pathChainKey(full.title),
                    name: full.title,
                    type,
                    anchor,
                    // Die Abschnitte der Gruppe samt der geteilten (WI-0302): Sie leuchten, nicht die Kette des Namens.
                    ...(full.abschnitte === undefined ? {} : { abschnitte: full.abschnitte }),
                },
                view: "standard",
            };
        }
        default:
            return {};
    }
}
