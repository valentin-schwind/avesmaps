import type { MapGeoJSONFeature } from "maplibre-gl";
import { AVENTURIA, fromRenderLngLat } from "@avesmaps3d/shared";
import { climateZoneName } from "../climate-zones";
import { CLIMATE_FILL_LAYER_ID } from "../landscape-layers";
import { PLACE_MARKER_LAYERS } from "../place-layers";
import { NODIX_HIT_LAYER_ID } from "../powerline-layers";
import { climatePointerHint, placePointerHint, type PointerHint } from "../pointer-hint";
import { ROUTE_CLICK_LAYERS, ROUTE_MARKER_LAYER_ID } from "../route-layers";
import { INTERACTION_PRIORITY } from "./priorities";
import type { Claim, InteractionOwner, Screen } from "./types";

/**
 * Die einfachen Besitzer der Karte: Ort (80), Route (60), das Klimaband (30), das Kontextmenü (20) und der Rückfall in die freie Karte (0).
 * Vorher standen sie als `placeAt`, `routeAt` und `claimedByOthers` in `app.vue`: Jeder Handler fragte selbst,
 * ob ein anderer schon dran war, und ein Klick kostete fünf Abfragen der Karte. Jetzt entscheidet der Rang
 * (`priorities.ts`), und der Koordinator fragt einmal.
 *
 * Die Regel dahinter ist die von Legacy: Ort vor Route vor Fläche (`_onClick`, WI-0043).
 */

const space = AVENTURIA.coordinateSpace;

/**
 * Der angeklickte Ort: Sein Kern steht gold, bis ein Klick daneben geht (Legacy `setActiveLocationMarker`,
 * Betreiber 2026-09-24). Die Lage ist in Kartenkoordinaten (ADR-0003).
 */
export interface SelectedPlace {
    id: string;
    name: string;
    subtype: string;
    x: number;
    y: number;
    /** Verborgen (`is_hidden` der Kachel; nur der Editor zeichnet solche Orte): das Kontextmenü bietet „Wieder zeigen“ (E15). */
    hidden?: boolean;
}

interface PlaceClaim extends Claim {
    feature: MapGeoJSONFeature;
}

/**
 * Ein Ort unter dem Zeiger: Ein Klick oder Tipp wählt ihn, Zeigen zeigt die Hand und das Schild „Name · Art“
 * (WI-0063 4.5; passiv, ohne Aktion und ohne Nachladen).
 *
 * 🔴 **Der RECHTSKLICK auf einen Ort wählt ihn ebenfalls** (WI-0100, Betreiber 2026-10-07: „Der Linksklick macht ein
 * Ortsmarker gelb. Genau dasselbe will ich mit rechtsklick nur dass das Kontextmenü aufgeht“). Er läuft durch
 * **dieselbe** `select`-Naht wie der Linksklick - keine zweite Fassung - und öffnet danach das Kartenmenü in seiner
 * Ortsform. Dass der Besitzer `place` (80) den Rechtsklick dem allgemeinen `context` (20) wegnimmt, ist genau die
 * Lücke, die die Rangtafel seit jeher offenhält: „Es steht unter allen Besitzern, die später ein eigenes Menü
 * bringen (Ort, …)“.
 *
 * 🔴 **Und der lange Druck am Finger ist dieser Rechtsklick** (WI-0108, Betreiber 2026-10-08): Er kommt als
 * `contextmenu` an, nimmt also genau denselben Zweig - goldener Kern UND Menü in seiner Ortsform. Vorher wählte er
 * den Ort nur aus (`longpress`), und das Menü war am Telefon überhaupt nicht erreichbar. Zwei Verhalten für dieselbe
 * Sache gibt es damit nicht mehr; dass es sie gab, war der Befund.
 *
 * 🪤 Gemessen am 2026-10-07, vorher: Der Rechtsklick auf Gareth wählte **nichts** (kein goldener Kern, kein Panel) und
 * öffnete dasselbe Menü wie die freie Fläche.
 *
 * 🚩 **Für später, wenn das Editor-Menü Actions bekommt** (WI-0063 P9): Es geht an `source: "map"` mit `anchor` auf,
 * und genau damit öffnet der Rechtsklick jetzt auch. Heute ist das folgenlos - `visibleActions` ist leer, das Menü
 * öffnet für niemanden. Sobald es die erste Action gibt, stünden am Rechtsklick auf einen Ort ZWEI Menüs; dann ist zu
 * entscheiden, welches gilt. Nicht vorweggenommen: Der Betreiber hat „genau dasselbe“ wie der Linksklick verlangt,
 * und eine eigene Quelle nur für den Rechtsklick wäre schon heute ein Unterschied, den niemand wollte.
 */
export function placeOwner(input: {
    /** `at`: wo geklickt oder gedrückt wurde (Fensterkoordinaten) - dort verankert das Editor-Menü (WI-0063 P9). */
    select: (place: SelectedPlace, at: Screen) => void;
    /** Der Rechtsklick: nach dem Wählen geht hier das Kartenmenü auf, in seiner Ortsform. Ohne Angabe gibt es keins. */
    menu?: (place: SelectedPlace, at: Screen, lngLat: { lng: number; lat: number }) => void;
    /** Das Zeiger-Schild beim Zeigen; `undefined` nimmt es weg. Ohne Angabe gibt es keins. */
    hover?: (hint: PointerHint | undefined) => void;
    /** Ein Umschalt-Klick: `true`, wenn ein offenes Editor-Fenster das Objekt zusätzlich aufnahm (WI-0209); sonst fällt er durch. */
    umschalt?: (id: string) => boolean;
}): InteractionOwner<PlaceClaim> {
    return {
        id: "place",
        priority: INTERACTION_PRIORITY.place,
        kinds: ["click", "hover", "contextmenu"],
        layers: () => [...PLACE_MARKER_LAYERS, NODIX_HIT_LAYER_ID],
        hit(context) {
            // 🔴 In der Kraftlinien-Ansicht ist ein Nodix ein Knoten, keine Ortsmarke (Betreiber 2026-10-11: „im kraftlinien editor
            // nicht auf die nodices klicken kann“). Seine Trefferfläche trägt die Felder des Orts; ein Label oder ein
            // Kraftlinienpunkt (`node_kind`) ist kein Ort, dort trifft der Klick die Kraftlinie darunter.
            const feature =
                context.features(PLACE_MARKER_LAYERS)[0] ??
                context.features([NODIX_HIT_LAYER_ID]).find((knoten) => knoten.properties["node_kind"] === "place");
            return feature ? { feature, cursor: "pointer" } : undefined;
        },
        umschalt: ({ feature }) => input.umschalt?.(String(feature.properties["public_id"] ?? "")) === true,
        apply(kind, { feature }, context) {
            if (kind === "hover") {
                input.hover?.(
                    placePointerHint(
                        {
                            name: String(feature.properties["name"] ?? ""),
                            subtype: String(feature.properties["subtype"] ?? ""),
                        },
                        context.screen,
                    ),
                );
                return;
            }
            if (kind !== "click" && kind !== "contextmenu") return;
            const geometry = feature.geometry as { coordinates: [number, number] };
            const point = fromRenderLngLat(space, { lng: geometry.coordinates[0], lat: geometry.coordinates[1] });
            const place = {
                id: String(feature.properties["public_id"] ?? ""),
                name: String(feature.properties["name"] ?? ""),
                subtype: String(feature.properties["subtype"] ?? ""),
                x: point.x,
                y: point.y,
                ...(feature.properties["is_hidden"] === true ? { hidden: true } : {}),
            };
            // Erst wählen - dieselbe Naht wie der Linksklick -, dann das Menü. Kein Browsermenü neben unserem.
            input.select(place, context.screen);
            if (kind === "contextmenu") {
                context.event.preventDefault();
                input.menu?.(place, context.screen, context.lngLat);
            }
        },
        lost() {
            input.hover?.(undefined);
        },
    };
}

interface RouteClaim extends Claim {
    /** Die Etappe, auf deren Linie der Zeiger liegt; fehlt bei einer Wegpunktmarke. */
    stage?: number;
}

/**
 * Die Route samt ihren Wegpunktmarken bekommt einen Klick vor jeder Fläche (WI-0043). Ein Klick oder Tipp auf die
 * Linie wählt ihre Etappe (Legacy E6); eine Marke beansprucht ihn nur, damit die Fläche darunter schweigt.
 *
 * 🔴 **Den langen Druck beansprucht sie nicht mehr** (WI-0108): Er ist seit dem 2026-10-08 der Rechtsklick, und den
 * bekam die Route am Rechner nie - dort öffnet er das Kartenmenü. Hätte sie ihn behalten, wäre das Menü über jeder
 * Route am Finger weiter unerreichbar.
 */
export function routeOwner(input: {
    /** Eine veraltete Route (Eingaben geändert, noch nicht neu gerechnet) zeigt keine Hand. */
    stale: () => boolean;
    selectStage: (stage: number) => void;
}): InteractionOwner<RouteClaim> {
    return {
        id: "route",
        priority: INTERACTION_PRIORITY.route,
        kinds: ["click", "hover"],
        layers: () => [...ROUTE_CLICK_LAYERS, ROUTE_MARKER_LAYER_ID],
        hit(context) {
            const line = context.features(ROUTE_CLICK_LAYERS)[0];
            if (!line && context.features([ROUTE_MARKER_LAYER_ID]).length === 0) return undefined;
            const stage = Number(line?.properties["stage"]);
            return {
                ...(line && Number.isInteger(stage) ? { stage } : {}),
                // Über der Linie die Hand; die Marke hat die ihre (Greifhand, `waypoint-drag`).
                ...(line && !input.stale() ? { cursor: "pointer" } : {}),
            };
        },
        apply(kind, { stage }) {
            if (kind === "click" && stage !== undefined) input.selectStage(stage);
        },
        // Eine Etappe nimmt kein Editor-Fenster auf: Der Umschalt-Klick fällt durch (WI-0209).
        umschalt: () => false,
    };
}

/**
 * Das Klimaband unter dem Zeiger: sein Schlüssel (`climate_zone_type.type_key`, die Kennung des Subjects) und sein
 * Name in der Sprache der Seite (`climateZoneName`, WI-0171) - nicht der deutsche Stamm aus der Kachel.
 */
export interface ClimateZone {
    band: string;
    name: string;
}

interface ClimateClaim extends Claim {
    zone: ClimateZone;
}

/**
 * Das Klimaband (WI-0063 P8): In der Klimaansicht wählt ein Klick oder Tipp das Band darunter (Legacy
 * `showEcosystemAreaInfopanel`: ein Kopf-Panel mit Name und „Klimazonen“, ohne Feld und ohne Aktion), das Zeigen zeigt die Hand und
 * das Zeiger-Schild „Name · Klimazone“ (Legacy: `bindTooltip` der Fläche, L1031). Es liegt unter jeder Fläche und jedem Fluss
 * (Rang 30). Bänder gibt es nur in der Klimaansicht („Alle“ zeigt keine, Betreiber 2026-10-05; Legacy ebenso), und dort ist das
 * Band das einzige wählbare Objekt (`LAYER_OWNERS`). Wo keine Bänder gezeichnet sind, trifft der Besitzer nichts; eine eigene
 * Bedingung braucht er nicht (bis 2026-10-05 `active` und `climateBandsClickable`, weil es in „Alle“ klickdurchlässig blieb).
 *
 * 🔴 **Den langen Druck beansprucht es nicht mehr** (WI-0108): Er ist der Rechtsklick, und ein Band deckt in seiner
 * Ansicht die ganze Karte - mit dem langen Druck in der Hand des Bandes wäre das Kartenmenü in den Klimazonen am
 * Finger nirgends zu öffnen. Am Rechner ist es dort längst offen: `context` steht in `LAYER_OWNERS.klima`.
 */
export function climateOwner(input: {
    /** `at`: wo geklickt wurde (Fensterkoordinaten) - dort verankert das Editor-Menü (WI-0063 P9). */
    select: (zone: ClimateZone, at: Screen) => void;
    /** Das Zeiger-Schild beim Zeigen; `undefined` nimmt es weg. Ohne Angabe gibt es keins. */
    hover?: (hint: PointerHint | undefined) => void;
}): InteractionOwner<ClimateClaim> {
    return {
        id: "climate",
        priority: INTERACTION_PRIORITY.climate,
        kinds: ["click", "hover"],
        layers: () => [CLIMATE_FILL_LAYER_ID],
        hit(context) {
            const properties = context.features([CLIMATE_FILL_LAYER_ID])[0]?.properties;
            const band = properties?.["type_key"];
            if (typeof band !== "string" || band === "") return undefined;
            // Der Name aus der Sprachtafel; der `label` der Kachel ist nur noch der Rückfall (WI-0171).
            const stamm = properties?.["label"];
            return {
                zone: { band, name: climateZoneName(band, typeof stamm === "string" ? stamm : undefined) },
                cursor: "pointer",
            };
        },
        apply(kind, { zone }, context) {
            if (kind === "hover") {
                input.hover?.(climatePointerHint(zone, context.screen));
                return;
            }
            if (kind === "click") input.select(zone, context.screen);
        },
        lost() {
            input.hover?.(undefined);
        },
    };
}

/**
 * Das Kontextmenü der Karte: der Rechtsklick am Rechner **und der lange Druck am Finger** (WI-0108, Betreiber
 * 2026-10-08: „langer tap ist rechtsklick“). Es gilt an jedem Kartenpunkt und beansprucht deshalb nur diese eine
 * Art, nie Klick und nie Zeigen.
 *
 * 🔴 **Der lange Druck ist keine eigene Art mehr.** Bis WI-0108 gehörte er dem Besitzer `map-point`, der direkt
 * „Was ist hier?“ öffnete - damit war am Telefon KEINER der Menüeinträge erreichbar (Befund aus WI-0095 F7).
 * „Was ist hier?“ ist seitdem der erste EINTRAG dieses Menüs, am Finger wie am Rechner; der Weg dorthin ist
 * derselbe (`onContextAction` → `openPoint`).
 *
 * Rang 20: Ein Besitzer, der später ein eigenes Menü bringt (Ort, Wegpunkt, Fläche bearbeiten), gewinnt vor
 * diesem allgemeinen (`priorities.ts`).
 */
export function contextOwner(input: {
    open: (screen: { x: number; y: number }, lngLat: { lng: number; lat: number }) => void;
}): InteractionOwner {
    return {
        id: "context",
        priority: INTERACTION_PRIORITY.context,
        kinds: ["contextmenu"],
        layers: () => [],
        hit: () => ({}),
        apply(_kind, _claim, context) {
            // Kein Menü des Browsers neben unserem.
            context.event.preventDefault();
            input.open(context.screen, context.lngLat);
        },
    };
}

/**
 * Der Rückfall: Ein Klick, den niemand beansprucht, ist ein Klick in die freie Karte und beendet die Auswahl
 * (Legacy `_onClick`: kein Ort → abwählen). Dieselbe Regel wie Esc (`clearSelection`).
 */
export function emptyOwner(input: { clear: () => void }): InteractionOwner {
    return {
        id: "empty",
        priority: INTERACTION_PRIORITY.empty,
        kinds: ["click"],
        layers: () => [],
        hit: () => ({}),
        apply: () => input.clear(),
    };
}
