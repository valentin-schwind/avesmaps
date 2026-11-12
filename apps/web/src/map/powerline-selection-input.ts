import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import { isLayoutMove } from "./camera/visible-area";
import { INTERACTION_PRIORITY } from "./interaction/priorities";
import type { Claim, HitContext, InteractionOwner, MapInteractionCoordinator, Screen } from "./interaction/types";
import { powerlinePointerHint, type PointerHint } from "./pointer-hint";
import { POWERLINE_HIT_LAYER_ID } from "./powerline-layers";

/**
 * Eine Kraftlinie direkt auf der Karte wählen (WI-0063 P8, Betreiber 2026-10-04: „Jedes Objekt, das bei auf unserer Karte
 * vorkommt, anklickbar sein sollte“; Design Guide P8).
 *
 * Legacy (`map-features-powerlines.js` L504-570): eine unsichtbare Trefferlinie von 22 px liegt unter den 1,5 px breiten Strängen;
 * ein Klick fragt zuerst den Ort an der Stelle (Klick-Schiedsrichter: Kraftlinien enden an Nodix-Orten), dann zeigt er die Kraftlinie
 * im Infopanel (`avesmapsShowPowerlineInInfopanel`). Beim Überfahren zeigt Legacy nichts; hier steht das EINE Zeiger-Schild.
 *
 * - **Besitzer `powerline` (Rang 50, `interaction/priorities.ts`):** Ort und Route gehen vor, Fläche und Fluss kommen danach (in der
 *   Kraftlinien-Ansicht gibt es sie nicht). Nur, wo die Kraftlinien gezeichnet sind (`visible`).
 * - **Was „unter dem Zeiger“ heißt:** wo die Bögen gezeichnet sind (`drawn`), die Linie, wie sie im Bild steht - geneigt der Bogen am
 *   Himmel, nicht die Bahn am Boden (`powerline-arcs.ts` `arcHits`). Sonst (Rückfall auf die flachen Lagen) die unsichtbare
 *   Trefferfläche der Kacheln (`POWERLINE_HIT_LAYER_ID`).
 * - **Eine Kraftlinie ist die Gruppe ihrer Segmente:** Segmente gleichen Namens zählen als EINE (das Wiki-Nest, das sonst gruppiert,
 *   kennt der Client nicht; der Server löst vom Segment zur Gruppe auf). Liegen mehrere Kraftlinien unter dem Zeiger, wählt der
 *   Klick die nächste und öffnet die Liste aller (`choice-list.ts`); ein weiterer Klick an derselben Stelle nimmt die nächste -
 *   dieselben Regeln wie bei den Flächen (WI-0043 Stufe 2).
 * - **Der Klickpunkt** (`at`, Fensterkoordinaten) geht an die Öffnungsnaht durch, wo er das Editor-Menü verankert (P9); wo eine Liste
 *   die Wahl erst anbietet, gibt es keinen.
 */

/** Eine Kraftlinie unter dem Zeiger: das Segment (`powerline.public_id`, der Anker des Subjects) und der Name der Gruppe. */
export interface PowerlineCandidate {
    id: string;
    name: string;
}

/** Die Liste des Klicks: alle Kraftlinien an der Stelle, die nächste zuerst, und welche gewählt ist. */
export interface PowerlineChoices {
    candidates: PowerlineCandidate[];
    selected: string;
    screen: Screen;
}

export interface PowerlineSelectionInput {
    /** Werden die Kraftlinien gerade gezeichnet (Kraftlinien-Ansicht)? Sonst nimmt der Besitzer an nichts teil. */
    visible: () => boolean;
    /** Der Name der gewählten Kraftlinie; `undefined`, wenn keine gewählt ist. */
    current: () => string | undefined;
    /** `at`: wo geklickt wurde (Fensterkoordinaten); fehlt, wo eine Liste die Wahl erst anbietet. Dort verankert das Editor-Menü (WI-0063 P9). */
    select: (line: PowerlineCandidate, at?: Screen) => void;
    /** Das Zeiger-Schild beim Zeigen; `undefined` nimmt es weg. */
    hint: (hint: PointerHint | undefined) => void;
    /** Die Liste, wo mehrere Kraftlinien liegen; `undefined` schließt sie. */
    choices: (choices: PowerlineChoices | undefined) => void;
    /** Wie weit der Zeiger von einer Linie entfernt sein darf (Bildpunkte): die Hälfte der Trefferbreite, am Finger mehr. */
    reach: () => number;
    /**
     * Die Linien unter dem Zeiger, wie die Bögen sie zeichnen, die nächste zuerst; `undefined`, wo keine Bögen gezeichnet sind
     * (dann gelten die Kacheln).
     */
    drawn?: (point: Screen, reach: number) => readonly PowerlineCandidate[] | undefined;
    /** Ein Umschalt-Klick: `true`, wenn ein offenes Editor-Fenster das Objekt zusätzlich aufnahm (WI-0209); sonst fällt er durch. */
    umschalt?: (id: string) => boolean;
}

interface PowerlineClaim extends Claim {
    candidates: PowerlineCandidate[];
}

/** Die Kennung einer Kraftlinie unter den Treffern: ihr Name; eine namenlose ist nur sie selbst (Segmente ohne Namen gruppiert nichts). */
const groupKey = (line: PowerlineCandidate): string => (line.name === "" ? line.id : line.name);

/** Je Kraftlinie einmal, in der Reihenfolge der Treffer: das nächste Segment steht für die Gruppe. */
export function distinctPowerlines(found: readonly PowerlineCandidate[]): PowerlineCandidate[] {
    const byKey = new Map<string, PowerlineCandidate>();
    for (const line of found) {
        if (line.id === "") continue;
        const key = groupKey(line);
        if (!byKey.has(key)) byKey.set(key, { id: line.id, name: line.name });
    }
    return [...byKey.values()];
}

/** Die Kraftlinien aus den Kacheln der unsichtbaren Trefferfläche, nach Name geordnet (die Kachel kennt keine Entfernung). */
export function tileCandidates(features: readonly MapGeoJSONFeature[]): PowerlineCandidate[] {
    const found = features.map((feature) => ({
        id: typeof feature.properties["public_id"] === "string" ? feature.properties["public_id"] : "",
        name: typeof feature.properties["name"] === "string" ? feature.properties["name"].trim() : "",
    }));
    return distinctPowerlines(found).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Was ein Klick hier wählt: die nächste Kraftlinie, oder, wenn die gewählte schon hier liegt, die danach (Durchklicken). */
export function nextPowerline(
    candidates: readonly PowerlineCandidate[],
    currentName: string | undefined,
): PowerlineCandidate | undefined {
    if (candidates.length === 0) return undefined;
    const at = currentName === undefined ? -1 : candidates.findIndex((line) => line.name === currentName);
    return candidates[(at + 1) % candidates.length];
}

/** Die Kraftlinien-Auswahl als Besitzer `powerline` (Rang 50) des Koordinators. Gibt die Abmeldung zurück. */
export function installPowerlineSelection(
    map: MapLibreMap,
    interaction: MapInteractionCoordinator,
    input: PowerlineSelectionInput,
): () => void {
    const owner: InteractionOwner<PowerlineClaim> = {
        id: "powerline",
        priority: INTERACTION_PRIORITY.powerline,
        // 🔴 Kein langer Druck (WI-0108): Er IST der Rechtsklick, und den bekam eine Kraftlinie am Rechner nie.
        kinds: ["click", "hover"],
        layers: () => [POWERLINE_HIT_LAYER_ID],
        enabled: input.visible,

        hit(context: HitContext) {
            const reach = input.reach();
            const drawn = input.drawn?.(context.point, reach);
            const candidates =
                drawn === undefined
                    ? tileCandidates(context.features([POWERLINE_HIT_LAYER_ID]))
                    : distinctPowerlines(drawn);
            return candidates.length === 0 ? undefined : { cursor: "pointer", candidates };
        },

        // Die nächste Linie unter dem Zeiger, nicht die nächste im Durchklicken: Umschalten nimmt, was oben liegt.
        umschalt: (claim) => claim.candidates[0] !== undefined && input.umschalt?.(claim.candidates[0].id) === true,

        apply(kind, claim, context) {
            const first = claim.candidates[0];
            if (first === undefined) return;
            if (kind === "hover") {
                input.hint(powerlinePointerHint(first, context.screen));
                return;
            }
            if (kind !== "click") return;
            const choice = nextPowerline(claim.candidates, input.current());
            if (choice === undefined) return;
            const several = claim.candidates.length > 1;
            // Wo mehrere liegen, öffnet der Klick die Liste: Kein Klickpunkt, also kein Editor-Menü daneben; der Eintrag der Liste
            // bringt seinen eigenen mit.
            input.select(choice, several ? undefined : context.screen);
            input.choices(
                several ? { candidates: claim.candidates, selected: choice.id, screen: context.screen } : undefined,
            );
        },

        lost: () => input.hint(undefined),
    };

    const unregister = interaction.register(owner);
    // Jede Kartenbewegung schließt die Liste (das Schild nimmt der Koordinator weg). 🔴 Nicht das Nachführen der sichtbaren Fläche:
    // Geht beim ersten Klick das Infopanel auf, ändert sich nur der Innenabstand (`visible-area.ts`), und die Liste, die dieser Klick
    // gerade geöffnet hat, bliebe sonst nie stehen.
    const onMoveStart = (event: object): void => {
        if (!isLayoutMove(event)) input.choices(undefined);
    };
    map.on("movestart", onMoveStart);
    return () => {
        map.off("movestart", onMoveStart);
        unregister();
        input.hint(undefined);
    };
}
