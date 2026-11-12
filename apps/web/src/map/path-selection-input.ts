import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, fromRenderLngLat } from "@avesmaps3d/shared";
import { nextCandidate, pathCandidates, type AreaCandidate } from "./area-candidates";
import {
    pathFilter,
    pathSegmentOfKey,
    PATH_PREVIEW_LAYER_ID,
    PATH_PREVIEW_SOURCE_ID,
    type AreaSelection,
} from "./area-selection";
import { INTERACTION_PRIORITY } from "./interaction/priorities";
import type { Claim, HitContext, InteractionOwner, MapInteractionCoordinator, Screen } from "./interaction/types";
import { PATH_HIT_LAYER_IDS, PATH_SOURCE_ID, PATH_SOURCE_LAYER } from "./path-layers";
import { pathPointerHint, type PointerHint } from "./pointer-hint";
import { zeigeUmriss } from "./vorschau-umriss";

/**
 * Einen WEG direkt auf der Karte anklicken und beim Zeigen sehen (WI-0090, Betreiber 2026-10-06: „wege kann man noch nicht
 * anklicken, kannst du das mal für die standardansicht machen?“).
 *
 * 🔴 **Die Regel in einem Satz: Die Auswahl ist überall gleich; der Unterschied sitzt allein in der Vorschau.** Ein Klick
 * wählt den Weg überall auf dieselbe Art - durchgezogenes Gold über der ganzen Kette, wie seit WI-0044. Beim ZEIGEN kommt
 * in der ruhigen Ansicht nur das Schild, in einer einzelnen Landschaftsebene zusätzlich die gestrichelte Umrandung. WO
 * das gilt, steht an EINER Stelle (`pathPreviewOutlined`, `interaction/priorities.ts`), nicht hier.
 *
 * 🪤 **Vorschau und Auswahl sind zwei Dinge**, und die Koordination hat sie unterwegs verwechselt: Strittig war nie, wie
 * ein gewählter Weg aussieht, sondern dass in der ruhigen Ansicht bei jeder Zeigerbewegung eine gestrichelte Linie
 * aufleuchtet („ich wollte die standardansicht nicht mit gelben gestrichelten linien verhunzen“).
 *
 * 🔴 **Ein Fluss IST ein Weg** - einer ohne eigene Landschaftsebene. Er gehörte bis WI-0090 dem Besitzer `area`, weil nur
 * er anklickbar war; jetzt gehört er hierher. Zwei Besitzer für dieselbe Linie hätten die Regel oben zweimal, und das
 * wäre genau die Stelle, an der zwei Fassungen auseinanderlaufen. Was MIT ihm hierher umgezogen ist:
 * - seine Teilnahme nur in Topographie und „Alle“ (WI-0083 Nachtrag, Betreiber 2026-10-05 „ja“): Der Besitzer bekommt
 *   die teilnehmenden Ebenen gereicht (`layers`) und vergleicht sie mit der Ebene am Kandidaten - DIESELBE Tafel und
 *   DIESELBE Frage wie beim Besitzer `area`, keine zweite Liste;
 * - seine Strichelung (`PATH_PREVIEW_LAYER_ID`, vormals `area-preview-path`), jetzt für jede Wegart;
 * - seine Kandidaten (`pathCandidates`, vormals `riverCandidates`).
 *
 * **Was unter dem Zeiger liegt**: die unsichtbare Trefferfläche der Kacheln (`PATH_HIT_LAYER_IDS`), so breit wie die der
 * Route - dieselbe Zahl, keine zweite Rechnung (`path-layers.ts`). Sie entsteht je Wegart mit demselben Filter und
 * demselben `minzoom` wie die gezeichnete Linie; was nicht gezeichnet ist, hat also keine und ist nicht anklickbar.
 *
 * **Rang 45**, zwischen Kraftlinie (50) und Fläche (40): Legacys Klick-Schiedsrichter ist Ort vor Weg vor Region
 * (`_onClick`). Begründung der Zahl in `interaction/priorities.ts`.
 *
 * 🪤 **Durchklicken über die Besitzergrenze.** Liegt hier NUR der Weg, der schon gewählt ist, beansprucht dieser Besitzer
 * den Klick nicht - dann gehört er dem, was darunter liegt (die Fläche, der See). So bleibt das Durchklicken von
 * WI-0043 Stufe 2 („ein zweiter Klick an derselben Stelle die nächstgrößere“) erhalten, das es für Flüsse schon gab, als
 * sie und die Flächen EINE Liste waren. Die goldene Auswahl selbst hält der Besitzer `area` weiter fest
 * (`AREA_SELECTION_PATH_LAYER_ID` in seinen Auswahl-Layern), damit ein solcher Klick nicht in die freie Karte fällt.
 */
export interface PathSelectionInput {
    /** Der gewählte Gegenstand, wenn es ein Weg ist: sein Kettenschlüssel `name:<Name>`, ohne echten Namen `#<public_id>`; sonst `undefined`. */
    current: () => string | undefined;
    /** `at`: wo geklickt wurde (Fensterkoordinaten) - dort verankert das Editor-Menü (WI-0063 P9). */
    select: (path: AreaSelection, at: Screen) => void;
    /** Das Zeiger-Schild beim Zeigen; `undefined` nimmt es weg. */
    hint: (hint: PointerHint | undefined) => void;
    /**
     * Bekommt die Vorschau die gestrichelte Umrandung dazu (WI-0090 § 2)? Die Antwort kommt aus der Tafel neben dem Rang
     * (`pathPreviewOutlined`), nicht aus einer Frage nach der Ansicht an dieser Stelle.
     */
    outline: () => boolean;
    /**
     * Welche Landschaftsebenen in dieser Ansicht teilnehmen (`areaLayersInView`); `undefined` heißt alle. Sie betrifft nur
     * Wege MIT Ebene, also die Flüsse (WI-0083 Nachtrag); eine Straße trägt keine und nimmt überall teil, wo sie gezeichnet ist.
     */
    layers?: () => readonly string[] | undefined;
    /**
     * Markiert ein Klick auf die gewählte Kette den Abschnitt (WI-0177 W2b; EDIT-0003 T24 (1), für Editoren)? Dann markiert der erste
     * Klick die ganze Straße, ein Klick auf einen ihrer Abschnitte nur diesen, ein Klick auf denselben Abschnitt wieder die ganze Straße
     * (wie Legacy). Ohne Angabe gilt das Durchklicken wie bisher.
     */
    abschnitte?: () => boolean;
    /** Der markierte Abschnitt der gewählten Kette (`path.public_id`); `undefined` heißt die ganze Kette. */
    currentSegment?: () => string | undefined;
    /**
     * Ein Umschalt-Klick (WI-0252, wie bei Kraftlinien und Gebieten, WI-0209): `true`, wenn ein offenes Wege-Fenster den Weg unter dem
     * Zeiger zusätzlich aufnahm; sonst fällt er durch. Genannt werden die Kette (`name:<Name>`), der Abschnitt darunter und seine Art, damit
     * der Editor einen namenlosen Abschnitt (ein Weg für sich) von einer Straße unterscheidet.
     */
    umschalt?: (weg: {
        readonly kette: string;
        readonly abschnitt: string | undefined;
        readonly subtype: string;
    }) => boolean;
}

interface PathClaim extends Claim {
    candidates: AreaCandidate[];
}

const space = AVENTURIA.coordinateSpace;

/** Die Wege unter dem Zeiger, oberster zuerst, je Kette einmal. */
function underPointer(context: HitContext): AreaCandidate[] {
    return pathCandidates(context.features(PATH_HIT_LAYER_IDS));
}

/**
 * Die Auswahl eines Wegs: derselbe Zustand wie aus der Suche (WI-0044) - Kettenschlüssel, Name, Wegart, und der Anker am
 * Zeiger. Ein Weg trägt seine Namen schon an der Linie; die Auswahl nennt ihn nicht noch einmal
 * (`buildAreaSelectionLayers` zeichnet beim `path` nur die goldene Linie, kein Namensschild).
 */
export function pathSelectionOf(
    candidate: AreaCandidate,
    lngLat: { lng: number; lat: number },
    segment?: string,
): AreaSelection {
    return {
        kind: "path",
        id: candidate.id,
        name: candidate.name,
        type: candidate.type,
        anchor: fromRenderLngLat(space, lngLat),
        ...(segment === undefined ? {} : { segment }),
    };
}

/** Der Abschnitt einer Kette unter dem Zeiger: seine Kennung (`public_id`), oberster zuerst. Ein Weg ohne echten Namen IST sein Abschnitt. */
function segmentAt(context: HitContext, candidate: AreaCandidate): string | undefined {
    const eigener = pathSegmentOfKey(candidate.id);
    if (eigener !== undefined) return eigener;
    for (const feature of context.features(PATH_HIT_LAYER_IDS)) {
        const p = feature.properties;
        if (p["name"] !== candidate.name) continue;
        const id = typeof p["public_id"] === "string" ? p["public_id"] : feature.id;
        if (typeof id === "string") return id;
    }
    return undefined;
}

/**
 * Welcher Weg die Strichelung bekommt - oder keiner: alle Abschnitte der Kette, die die geladenen Kacheln tragen, als Linien in der
 * Vorschau-Quelle (`vorschau-umriss.ts`, WI-0266); nur bei einem Kettenwechsel. Ein Abschnitt über zwei Kacheln steht je Kachel
 * zugeschnitten, also einmal.
 *
 * 💣 **Nie `setFilter`** (Betreiber 2026-10-09: die Strichelung „läuft hinter allen Objekten her“): Ein Filterwechsel lädt
 * in MapLibre jede Kachel der Quelle neu, und beim Überfahren vieler Wege stauen sich die Neuladungen. Bis WI-0266 lag die
 * Strichelung als unsichtbare Ebene mit Feature-State über allen Wegen; die zeichnete MapLibre in jedem Bild ganz.
 */
const shown = new WeakMap<MapLibreMap, { key: string; source: unknown }>();

export function outlinePath(map: MapLibreMap, candidate: AreaCandidate | undefined): void {
    if (map.getLayer(PATH_PREVIEW_LAYER_ID) === undefined) return;
    const source = map.getSource(PATH_PREVIEW_SOURCE_ID);
    const key = candidate === undefined ? "" : candidate.id;
    const previous = shown.get(map);
    if (previous?.key === key && previous.source === source) return;
    shown.set(map, { key, source });
    zeigeUmriss(
        map,
        PATH_PREVIEW_SOURCE_ID,
        candidate === undefined
            ? undefined
            : {
                  source: PATH_SOURCE_ID,
                  sourceLayer: PATH_SOURCE_LAYER,
                  // Die Kette seines Namens, ein Weg ohne echten Namen nur sein Abschnitt - dieselbe Wahl wie das Gold (`pathFilter`).
                  filter: pathFilter(candidate),
                  // Der Abstand der beiden Striche hängt an der Wegart (`pathPreviewGapExpression`).
                  behalte: ["subtype"],
              },
    );
}

/** Der Weg als Besitzer `path` (Rang 45) des Koordinators. Gibt die Abmeldung zurück. */
export function installPathSelection(
    map: MapLibreMap,
    interaction: MapInteractionCoordinator,
    input: PathSelectionInput,
): () => void {
    const clear = (): void => {
        outlinePath(map, undefined);
        input.hint(undefined);
    };

    /**
     * Welche Wege in dieser Ansicht zählen: die ohne Ebene immer (Straße, Pfad, Pass), die mit Ebene nur, wo ihre Ebene
     * teilnimmt (der Fluss, WI-0083 Nachtrag). Ein ausgeschlossener Weg fällt durch auf das, was darunter liegt.
     */
    const taking = (candidates: AreaCandidate[]): AreaCandidate[] => {
        const layers = input.layers?.();
        if (layers === undefined) return candidates;
        return candidates.filter((candidate) => candidate.layer === undefined || layers.includes(candidate.layer));
    };

    /** Ist das die gewählte Kette? Ihr Name, über Wegtypen hinweg (WI-0177 Schritt 2b). */
    const gewaehlt = (candidate: AreaCandidate | undefined): boolean => {
        const aktuell = input.current();
        return candidate !== undefined && aktuell !== undefined && candidate.id === aktuell;
    };

    const owner: InteractionOwner<PathClaim> = {
        id: "path",
        priority: INTERACTION_PRIORITY.path,
        // 🔴 Kein langer Druck (WI-0108): Er IST der Rechtsklick, und den bekam ein Weg am Rechner nie. Seine
        // unsichtbare Trefferfläche ist am Finger 28 px breit; hätte er den langen Druck behalten, wäre das Kartenmenü
        // über jeder Straße und jedem Fluss unerreichbar geblieben (Rang 45 über dem Menü 20).
        kinds: ["click", "hover"],
        // 🔴 Die ganze Liste, nicht die der Ansicht: Der Koordinator fragt nur, was im Stil steht - und genau das ist die
        // Teilnahmeregel der Wege (`interaction/priorities.ts`).
        layers: () => PATH_HIT_LAYER_IDS,

        hit(context) {
            const candidates = taking(underPointer(context));
            if (candidates.length === 0) return undefined;
            // Nur der Weg, der schon gewählt ist: Der Klick gehört dem, was darunter liegt (Durchklicken, siehe oben) - außer im Editor,
            // wo er den Abschnitt markiert (W2b).
            const only = candidates.length === 1 && gewaehlt(candidates[0]);
            if (only && input.abschnitte?.() !== true) return undefined;
            return { cursor: "pointer", candidates };
        },

        // Der oberste Weg unter dem Zeiger, nicht der nächste im Durchklicken: Umschalten nimmt, was oben liegt (wie die Kraftlinie).
        umschalt: (claim, context) => {
            const oben = claim.candidates[0];
            if (oben === undefined || input.umschalt === undefined) return false;
            return input.umschalt({ kette: oben.id, abschnitt: segmentAt(context, oben), subtype: oben.type }) === true;
        },

        apply(kind, claim, context) {
            if (kind === "hover") {
                const first = claim.candidates[0];
                if (first === undefined) {
                    clear();
                    return;
                }
                // Das Schild kommt immer; die Strichelung nur, wo die Tafel es sagt (WI-0090 § 2).
                outlinePath(map, input.outline() ? first : undefined);
                input.hint(pathPointerHint(first, context.screen));
                return;
            }
            if (kind !== "click") return;
            // Im Editor: Ein Klick auf die gewählte Kette markiert den Abschnitt unter dem Zeiger, derselbe Abschnitt noch einmal wieder
            // die ganze Kette (T24 (1)).
            const getroffen = claim.candidates.find(gewaehlt);
            // Die Kennung der gewählten Kette bleibt, auch wenn der Klick einen anderen Wegtyp derselben Route trifft.
            const dieselbe =
                getroffen === undefined ? undefined : { ...getroffen, id: input.current() ?? getroffen.id };
            if (input.abschnitte?.() === true && dieselbe !== undefined) {
                const segment = segmentAt(context, dieselbe);
                const naechster = segment === input.currentSegment?.() ? undefined : segment;
                input.select(pathSelectionOf(dieselbe, context.lngLat, naechster), context.screen);
                return;
            }
            const choice = nextCandidate(claim.candidates, getroffen?.id ?? input.current());
            if (choice === undefined) return;
            input.select(pathSelectionOf(choice, context.lngLat), context.screen);
        },

        lost: clear,
    };

    const unregister = interaction.register(owner);
    return () => {
        unregister();
        clear();
    };
}
