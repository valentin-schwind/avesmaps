import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, fromRenderLngLat, type MapPoint } from "@avesmaps3d/shared";
import { areaCandidates, nextCandidate, type AreaCandidate } from "./area-candidates";
import { fetchAreasAt, fetchOutline, type AreaLookup } from "./area-lookup";
import { isLayoutMove } from "./camera/visible-area";
import { INTERACTION_PRIORITY } from "./interaction/priorities";
import type { Claim, HitContext, InteractionOwner, MapInteractionCoordinator } from "./interaction/types";
import {
    AREA_PREVIEW_OUTLINE_SOURCE_ID,
    AREA_SELECTION_FILL_LAYER_ID,
    AREA_SELECTION_PATH_LAYER_ID,
    sameArea,
    type AreaSelection,
} from "./area-selection";
import {
    isWaterType,
    LANDSCAPE_FILL_LAYER_IDS,
    LANDSCAPE_SOURCE_ID,
    LANDSCAPE_SOURCE_LAYER,
    LANDSCAPE_NAME_LAYER_RANK,
    LANDSCAPE_RUN_LAYER_ID,
    landscapeRunLayerId,
    MAP_LABEL_LAYER_ID,
    mapLabelLayerId,
    WATER_FILL_LAYER_ID,
    WATER_SEA_FILL_LAYER_ID,
    WATER_SOURCE_ID,
    WATER_SOURCE_LAYER,
} from "./landscape-layers";
import { inBand, territoryBandForZoom } from "./territory-band";
import {
    TERRITORY_CLAIM_LAYER_ID,
    TERRITORY_FILL_LAYER_ID,
    TERRITORY_SOURCE_ID,
    TERRITORY_SOURCE_LAYER,
} from "./territory-layers";
import { TERRITORY_LABEL_SOURCE_LAYER } from "@avesmaps3d/shared";
import { setzeUmriss, zeigeUmriss, type UmrissAbfrage } from "./vorschau-umriss";

/**
 * Eine Fläche direkt auf der Karte wählen (WI-0043, AC6 und AC7; Stufe 2, Betreiber 2026-09-28: „A+B+C“).
 *
 * 🔴 Die Rangfolge bleibt Legacys: Ort vor Route vor Fläche (`map/interaction/priorities.ts`). Liegt ein Ort
 * oder die Route unter dem Zeiger, gehört ihnen der Klick, und die Fläche bleibt, wie sie ist. Sonst gilt:
 * - **A, Vorschau:** Beim Zeigen umreißt eine gestrichelte Kontur die Fläche, die ein Klick wählen würde, und
 *   ein Schild nennt sie. Man sieht vorher, was man trifft. (Nur mit der Maus: am Finger gibt es kein Zeigen.)
 * - **B, feste Reihenfolge:** Ein Klick wählt die kleinste Fläche unter dem Zeiger, ein zweiter an derselben
 *   Stelle die nächstgrößere (`nextCandidate`).
 * - **C, Liste:** Liegen dort mehrere, öffnet der Klick daneben eine Liste aller; ein Eintrag wählt direkt.
 * - Der Name der gewählten Fläche steht, wo ihre Beschriftung auf der Karte steht, nicht am Klickpunkt
 *   (vorher sprang er dorthin). Fehlt eine Beschriftung in den geladenen Kacheln, am Klickpunkt.
 * - Die gewählte Fläche selbst (auch in der Standardansicht sichtbar) bleibt gewählt; ein Klick in die freie
 *   Karte beendet die Auswahl - das tut der Rückfall `empty` (`interaction/owners.ts`), denn ein Klick ohne
 *   Fläche darunter beansprucht die Auswahl nicht.
 * - Auch ein Herrschaftsgebiet der politischen Ansicht (WI-0062, F7): Es leuchtet in der Markierungsfarbe, die es schon
 *   gibt, und nennt Name und Obergebiet. Die Gebiete eines Bandes liegen nebeneinander, mehrere Kandidaten an einer
 *   Stelle sind eine Überlappung (Befund), und dieselben Regeln (kleinste zuerst, Liste) gelten unverändert.
 * - 🔴 **Nur die Objekte der aktiven Ansicht** (WI-0083 samt Nachtrag, Betreiber 2026-10-05): Eine Landschaftsfläche nimmt nur
 *   teil, wenn ihre Ebene gewählt ist; in „Alle“ nehmen alle teil. See und Meer sind Wasser der Topographie und bleiben
 *   überall sichtbar, sind aber nur in Topographie und „Alle“ wählbar. Welche Ebenen teilnehmen, sagt die Tafel neben
 *   dem Rang (`areaLayersInView`, `interaction/priorities.ts`), gereicht als `areaLayers` - nicht eine Frage nach der Ansicht an
 *   dieser Stelle.
 * - Auch Seen und Meere (Betreiber 2026-09-28: „obwohl flüsse und seen zu den topographischen features gehören, kann
 *   ich sie noch nicht anklicken“, WI-0057): In der Topographie kommen sie aus der geglätteten Quelle.
 * - 🔴 **Der FLUSS gehört seit WI-0090 nicht mehr hierher**, sondern dem Besitzer `path` (Rang 45): Ein Fluss ist ein
 *   Weg, und dieselbe Regel an zwei Stellen liefe auseinander. Mit ihm umgezogen sind seine Kandidaten, seine
 *   Strichelung und seine Teilnahme nur in Topographie und „Alle“. 🪤 Eine Route über demselben Fluss bleibt wählbar:
 *   sie gehört dem Besitzer `route` (Rang 60).
 * - Wo die Karte keine Landschaftsflächen zeichnet (Höhenstufen), fragt die Auswahl den Server (WI-0058,
 *   „nur bei Bedarf“): beim Klick sofort, beim Zeigen erst, wenn der Zeiger ruht. Reihenfolge und Namen rechnen
 *   dieselben Funktionen.
 *
 * 🔴 Seit M8 (Hardening Review 2026-09-28) ist die Auswahl ein Besitzer (`area`, Rang 40) des Koordinators der
 * Karteninteraktion (`map/interaction/`). Er hört nicht mehr selbst auf Klick und Zeiger: Der Koordinator fragt
 * die Karte einmal, ruft `hit` und gibt dem Gewinner `apply`. Die Serverfrage von WI-0058 ist ein Versprechen
 * mit `AbortSignal` - ein jüngeres Ereignis bricht sie ab, ohne dass hier ein Zähler mitläuft. Die offene Liste
 * lässt das Zeigen ruhen (`suspendHover`, in `app.vue` an ihr Vorhandensein gebunden).
 */
export interface AreaSelectionInput {
    current: () => AreaSelection | undefined;
    /** `at`: wo geklickt wurde (Fensterkoordinaten); fehlt, wo eine Liste die Wahl erst anbietet. Dort verankert das Editor-Menü (WI-0063 P9). */
    select: (area: AreaSelection, at?: { x: number; y: number }) => void;
    /** A: das Schild am Zeiger; `undefined` blendet es aus. */
    hint: (hint: AreaHint | undefined) => void;
    /** C: die Liste, wo mehrere Flächen liegen; `undefined` schließt sie. */
    choices: (choices: AreaChoices | undefined) => void;
    /** Fragt die Auswahl hier den Server (WI-0058)? `undefined`: Die Kacheln genügen. */
    lookup?: () => AreaLookup | undefined;
    landscapeAreas?: () => boolean;
    /**
     * Welche Landschaftsebenen in dieser Ansicht teilnehmen (WI-0083): die Tafel neben dem Rang
     * (`areaLayersInView` in `interaction/priorities.ts`). `undefined` oder ohne Angabe: alle.
     *
     * 🪤 Hier steht keine Frage nach der Ansicht („bin ich in der Vegetation?“): Der Besitzer bekommt die
     * Antwort der Tafel gereicht, damit es die EINE Stelle bleibt, an der sie steht.
     */
    areaLayers?: () => readonly string[] | undefined;
    /**
     * Ein Umschalt-Klick auf eine Fläche (Betreiber 2026-10-20, Mehrfachauswahl): `true`, wenn ein Editor ihn als Häkchen genommen hat
     * (`map/mehrfach-markierung.ts`, `umschalteAufKarte`); dann wählt der Klick nichts und öffnet keine Liste. Sonst fällt er durch
     * (Koordinator, `umschalt`).
     */
    umschaltKlick?: (area: AreaSelection) => boolean;
}

/** Das Schild der Vorschau: welche Fläche ein Klick nähme, und wie viele sonst hier liegen. */
export interface AreaHint {
    candidate: AreaCandidate;
    others: number;
    /** Die gewählte Fläche liegt auch hier: Ein Klick nähme diese statt ihrer (Durchklicken). */
    afterCurrent: boolean;
    /** Wo der Zeiger steht, in Fensterkoordinaten. */
    screen: { x: number; y: number };
}

/** Die Liste des Klicks: alle Flächen an der Stelle, kleinste zuerst, und welche gewählt ist. */
export interface AreaChoices {
    candidates: AreaCandidate[];
    selected: string;
    screen: { x: number; y: number };
    /** Der Klickpunkt in Kartenkoordinaten: Rückfall für den Namen. */
    point: MapPoint;
}

const space = AVENTURIA.coordinateSpace;

/**
 * Alles, woraus eine Fläche in den Kacheln kommen kann: gezeichnete Landschaften, geglättetes Wasser.
 *
 * 🪤 Das Wasser steht in ZWEI Layern, seit das Meer als Grund unter den Landschaftsfüllungen liegt (Nachtrag zu
 * WI-0083): der See oben (`gewaesser-flaeche`), das Meer unten (`gewaesser-grund`). Beide gehören hierher - wo
 * ein Layer fehlt, wäre sein Wasser gezeichnet, aber nicht anklickbar.
 */
const AREA_LAYER_IDS: readonly string[] = [
    ...LANDSCAPE_FILL_LAYER_IDS,
    WATER_FILL_LAYER_ID,
    WATER_SEA_FILL_LAYER_ID,
    TERRITORY_FILL_LAYER_ID,
    // Die Schraffur trägt das Gebiet, unter dem sie erscheint: ein Klick darauf wählt es wie ein Klick auf die Füllung daneben.
    TERRITORY_CLAIM_LAYER_ID,
];
/**
 * Die gewählte Fläche und der gewählte Weg selbst: Ein Klick darauf lässt die Auswahl stehen.
 *
 * 🔴 Der gewählte WEG steht weiter hier, obwohl der Weg seit WI-0090 dem Besitzer `path` gehört - und das ist der Grund:
 * Liegt nur der schon gewählte Weg unter dem Zeiger, tritt jener Besitzer zurück (Durchklicken). Dann muss ein Klick auf
 * die goldene Linie bei DIESEM Besitzer ankommen, sonst fiele er auf `empty` und löschte die Auswahl.
 */
const SELECTION_LAYER_IDS: readonly string[] = [AREA_SELECTION_FILL_LAYER_ID, AREA_SELECTION_PATH_LAYER_ID];
/** So lange ruht der Zeiger, ehe das Zeigen den Server fragt (ms): Beim Überfahren fragt es gar nicht. */
const HOVER_REST_MS = 120;

/** Die Flächen unter dem Zeiger aus den Kacheln, kleinste zuerst. */
function tileCandidates(context: HitContext): AreaCandidate[] {
    return areaCandidates(context.features(AREA_LAYER_IDS));
}

/** Dasselbe mit den Flächen vom Server (WI-0058): gleiche Felder, gleiche Reihenfolge. */
async function serverCandidates(context: HitContext, lookup: AreaLookup): Promise<AreaCandidate[]> {
    const rows = await fetchAreasAt(fromRenderLngLat(space, context.lngLat), lookup, context.signal);
    return areaCandidates(rows.map((properties) => ({ properties })));
}

/** Wartet, bis der Zeiger `ms` geruht hat; `false`, wenn ein jüngeres Ereignis vorher kam. */
function rested(ms: number, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
        if (signal.aborted) return resolve(false);
        const timer = setTimeout(() => resolve(true), ms);
        signal.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                resolve(false);
            },
            { once: true },
        );
    });
}

interface PreviewState {
    key: string;
    source: unknown;
    request?: AbortController | undefined;
}

const previews = new WeakMap<MapLibreMap, PreviewState>();

/**
 * Wo die Form der Vorschau in den geladenen Kacheln liegt (WI-0266): ein Gebiet in der Gebietskachel, im Band der Ansicht; ein See
 * oder Meer an der geglätteten Form, wo die Karte sie so zeichnet (WI-0055); sonst die Gegend in den Landschaftskacheln - aber nur,
 * wo die Ansicht Landschaftsflächen zeichnet. Ohne Antwort kommt der Umriss einer Gegend vom Server (WI-0058).
 */
function previewQuery(map: MapLibreMap, candidate: AreaCandidate): UmrissAbfrage | undefined {
    if (candidate.kind === "territory") {
        return {
            source: TERRITORY_SOURCE_ID,
            sourceLayer: TERRITORY_SOURCE_LAYER,
            // Das Band folgt der Kamera: beim Nachführen nach einem Zoom neu bestimmt.
            filter: () =>
                inBand(territoryBandForZoom(map.getZoom()), ["==", ["get", "territory_public_id"], candidate.id]),
        };
    }
    if (candidate.kind !== "landscape") return undefined;
    const filter = ["==", ["get", "region_public_id"], candidate.id] as FilterSpecification;
    const glattesWasser =
        map.getLayer(WATER_FILL_LAYER_ID) !== undefined || map.getLayer(WATER_SEA_FILL_LAYER_ID) !== undefined;
    if (isWaterType(candidate.type) && glattesWasser) {
        return { source: WATER_SOURCE_ID, sourceLayer: WATER_SOURCE_LAYER, filter };
    }
    if (LANDSCAPE_FILL_LAYER_IDS.some((id) => map.getLayer(id) !== undefined)) {
        return { source: LANDSCAPE_SOURCE_ID, sourceLayer: LANDSCAPE_SOURCE_LAYER, filter };
    }
    return undefined;
}

/**
 * Ein aktuelles Ziel je Karte: Die Vorschau-Quelle trägt nur die Form unter dem Zeiger (`vorschau-umriss.ts`, WI-0266).
 *
 * 🪤 Der Zweig für den FLUSS ist mit WI-0090 weg; den Weg umreißt `outlinePath` (`path-selection-input.ts`). Er stand
 * hier, solange der Fluss dem Besitzer `area` gehörte.
 */
export function outlineArea(map: MapLibreMap, candidate: AreaCandidate | undefined): void {
    const abfrage = candidate === undefined ? undefined : previewQuery(map, candidate);
    const vomServer = candidate?.kind === "landscape" && abfrage === undefined;
    const source = map.getSource(AREA_PREVIEW_OUTLINE_SOURCE_ID);
    const key = JSON.stringify([
        candidate?.kind,
        candidate?.id,
        candidate?.type,
        abfrage?.source,
        vomServer ? map.getZoom() : undefined,
    ]);
    const previous = previews.get(map);
    if (previous?.key === key && previous.source === source) return;
    previous?.request?.abort();
    const state: PreviewState = { key, source };
    previews.set(map, state);
    zeigeUmriss(map, AREA_PREVIEW_OUTLINE_SOURCE_ID, abfrage);
    if (!vomServer || candidate === undefined || source === undefined) return;
    const request = new AbortController();
    state.request = request;
    void fetchOutline([candidate.id], map.getZoom(), map.getSource(WATER_SOURCE_ID) !== undefined, request.signal)
        .then((outline) => {
            if (request.signal.aborted || previews.get(map) !== state) return;
            setzeUmriss(map, AREA_PREVIEW_OUTLINE_SOURCE_ID, outline);
        })
        .catch(() => undefined);
}

/**
 * Wo die Beschriftung einer Region GEZEICHNET steht: ein Namenspunkt, sonst die Mitte eines Schriftlaufs, jeweils der dem Klick nächste.
 * So steht der Name der Auswahl dort, wo man ihn schon sah. 🔴 Gezeichnet, nicht nur in der Kachel: Ein Name, den die Kollision verdrängt
 * hat, liegt in der Quelle, ist aber nicht zu sehen (WI-0192, Befund zu `area-selection.spec.ts`: 4,9 px neben dem Klick bei Zoom 2,5).
 */
function labelAnchor(map: MapLibreMap, id: string, near: MapPoint): MapPoint | undefined {
    const filter = ["==", ["get", "region_public_id"], id] as never;
    /** Die Namensebenen einer Art, die der Stil gerade trägt: die gemeinsame und je Landschaftsebene eine (`buildLandscapeNameLayers`). */
    const ebenen = (gemeinsam: string, jeEbene: (ebene: string) => string): string[] =>
        [gemeinsam, ...LANDSCAPE_NAME_LAYER_RANK.map(jeEbene)].filter((layer) => map.getLayer(layer) !== undefined);
    const gezeichnet = (layers: string[]) =>
        layers.length === 0
            ? []
            : map
                  .queryRenderedFeatures(undefined, { layers, filter })
                  .filter((feature) => String(feature.properties["region_public_id"]) === id);
    const points: MapPoint[] = [];
    for (const feature of gezeichnet(ebenen(MAP_LABEL_LAYER_ID, mapLabelLayerId))) {
        if (feature.geometry.type !== "Point") continue;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        points.push(fromRenderLngLat(space, { lng, lat }));
    }
    if (points.length === 0) {
        for (const feature of gezeichnet(ebenen(LANDSCAPE_RUN_LAYER_ID, landscapeRunLayerId))) {
            if (feature.geometry.type !== "LineString") continue;
            const line = feature.geometry.coordinates as [number, number][];
            const [lng, lat] = line[Math.floor(line.length / 2)] as [number, number];
            points.push(fromRenderLngLat(space, { lng, lat }));
        }
    }
    let best: MapPoint | undefined;
    for (const point of points) {
        if (!best || Math.hypot(point.x - near.x, point.y - near.y) < Math.hypot(best.x - near.x, best.y - near.y)) {
            best = point;
        }
    }
    return best;
}

/**
 * Wo der Name eines Gebiets in den geladenen Kacheln steht: sein Namensanker (Pol der Unzugänglichkeit), sonst der
 * Klickpunkt. So steht der Name der Auswahl dort, wo man ihn schon sah.
 */
function territoryAnchor(map: MapLibreMap, id: string, near: MapPoint): MapPoint {
    if (!map.getSource(TERRITORY_SOURCE_ID)) return near;
    let best: MapPoint | undefined;
    for (const feature of map.querySourceFeatures(TERRITORY_SOURCE_ID, {
        sourceLayer: TERRITORY_LABEL_SOURCE_LAYER,
        // Die Kachel trägt alle Bänder: der Anker des Bandes der Ansicht, nicht der eines anderen.
        filter: inBand(territoryBandForZoom(map.getZoom()), ["==", ["get", "territory_public_id"], id]) as never,
    })) {
        if (feature.geometry.type !== "Point") continue;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        const point = fromRenderLngLat(space, { lng, lat });
        if (!best || Math.hypot(point.x - near.x, point.y - near.y) < Math.hypot(best.x - near.x, best.y - near.y)) {
            best = point;
        }
    }
    return best ?? near;
}

/** Die Auswahl einer Fläche aus der Liste oder dem Klick, mit ihrem Namen an seinem Platz. */
export function selectionOf(map: MapLibreMap, candidate: AreaCandidate, near: MapPoint): AreaSelection {
    if (candidate.kind === "territory") {
        return {
            kind: "territory",
            id: candidate.id,
            name: candidate.name,
            type: candidate.type,
            anchor: territoryAnchor(map, candidate.id, near),
        };
    }
    // Ein Weg kommt hier nicht mehr vorbei (WI-0090): Seine Auswahl baut `pathSelectionOf`.
    return {
        kind: "landscape",
        id: candidate.id,
        name: candidate.name,
        type: candidate.type,
        anchor: labelAnchor(map, candidate.id, near) ?? near,
    };
}

/** Die Kennung der gewählten Fläche, an der das Durchklicken weitergeht; ein gewählter Weg zählt mit, er ist der Vorgänger. */
function currentLandscape(input: AreaSelectionInput): string | undefined {
    return input.current()?.id;
}

/**
 * Was `hit` unter dem Zeiger findet: alle Kandidaten, kleinste zuerst, und ob der Zeiger auf der gewählten
 * Fläche oder dem gewählten Weg selbst liegt (Klick lässt die Auswahl dann stehen).
 */
interface AreaClaim extends Claim {
    candidates: AreaCandidate[];
    onSelection: boolean;
}

/** Was das Zeigen hier zeigt: die Fläche, die ein Klick nähme, wie viele sonst hier liegen; sonst nichts. */
function preview(
    candidates: readonly AreaCandidate[],
    current: string | undefined,
): { next: AreaCandidate; others: number; afterCurrent: boolean } | undefined {
    const next = nextCandidate(candidates, current);
    // Nichts zu zeigen: keine Fläche, oder nur die, die schon gewählt ist.
    if (!next || (next.id === current && candidates.length === 1)) return undefined;
    return {
        next,
        others: candidates.length - 1,
        afterCurrent: current !== undefined && candidates.some((candidate) => candidate.id === current),
    };
}

/**
 * Die Flächenauswahl als Besitzer `area` (Rang 40) des Koordinators. Gibt die Abmeldung zurück.
 */
/**
 * Welche Kandidaten in dieser Ansicht überhaupt zählen: ohne Flächen, wenn der Schalter „Flächen“ aus ist, und nur die
 * Kandidaten der teilnehmenden Ebenen (WI-0083). Ein ausgeschlossener Kandidat fällt durch auf den nächsten darunter;
 * bleibt keiner, beansprucht der Besitzer das Ereignis nicht, und es gibt kein Zeiger-Schild und keine Hand.
 */
function inView(
    candidates: AreaCandidate[],
    input: Pick<AreaSelectionInput, "landscapeAreas" | "areaLayers">,
): AreaCandidate[] {
    if (input.landscapeAreas?.() === false) return candidates.filter((candidate) => candidate.kind !== "landscape");
    const layers = input.areaLayers?.();
    if (layers === undefined) return candidates;
    // Die Ebene am Kandidaten. Ein Gebiet trägt keine und bleibt unberührt; der Weg fragt dieselbe Tafel selbst.
    return candidates.filter((candidate) => candidate.layer === undefined || layers.includes(candidate.layer));
}

/**
 * Die Landschaftsflächen an einer Stelle der Karte, wie ein Klick sie nähme (WI-0178 A4; EDIT-0003 T27 (1): die Ebene der Karte
 * entscheidet, was klickbar ist): nur gezeichnete Flächen der teilnehmenden Ebenen, kleinste zuerst. Das Kartenmenü der Editoren
 * bietet sie an, bei einer gleich ihr Menü, bei mehreren „Hier liegen N Flächen“ (T27 (2)). Fragt nie den Server: Wo die Karte keine
 * Flächen zeichnet, gibt es keine zu bearbeiten. `zusatz`: weitere Flächenschichten der Editoren mit denselben Feldern (die für Besucher
 * verborgenen, `verborgene-flaechen.ts`, T41).
 */
export function landscapesAt(
    map: MapLibreMap,
    lngLat: { lng: number; lat: number },
    input: Pick<AreaSelectionInput, "landscapeAreas" | "areaLayers">,
    zusatz: readonly string[] = [],
): AreaCandidate[] {
    const layers = [...AREA_LAYER_IDS, ...zusatz].filter((id) => map.getLayer(id) !== undefined);
    if (layers.length === 0) return [];
    const punkt = map.project([lngLat.lng, lngLat.lat]);
    return inView(areaCandidates(map.queryRenderedFeatures(punkt, { layers })), input)
        .filter((candidate) => candidate.kind === "landscape")
        .sort((a, b) => a.area - b.area);
}

export function installAreaSelection(
    map: MapLibreMap,
    interaction: MapInteractionCoordinator,
    input: AreaSelectionInput,
): () => void {
    let hinted: string | undefined;
    const clearHint = (): void => {
        if (hinted !== undefined) outlineArea(map, undefined);
        hinted = undefined;
        input.hint(undefined);
    };

    const visibleCandidates = (candidates: AreaCandidate[]): AreaCandidate[] => inView(candidates, input);

    /** Was ein Klick mit diesen Kandidaten tut: wählen, durchklicken oder die Liste öffnen. */
    const decide = (claim: AreaClaim, context: HitContext): void => {
        const candidates = visibleCandidates(claim.candidates);
        const choice = nextCandidate(candidates, currentLandscape(input));
        if (choice) {
            const point = fromRenderLngLat(space, context.lngLat);
            const area = selectionOf(map, choice, point);
            // Wo mehrere Flächen liegen, öffnet der Klick die Liste: Gewählt ist erst, was dort gewählt wird. Kein Klickpunkt, also
            // kein Editor-Menü daneben (WI-0063 P9); der Eintrag der Liste bringt seinen eigenen mit.
            const at = candidates.length > 1 ? undefined : context.screen;
            // Dieselbe Fläche noch einmal (nur eine hier): Sie bleibt, samt ihrem Namen an seinem Platz - es ist DIE gewählte, nicht eine
            // neu gerechnete. Sie geht trotzdem durch die Öffnungsnaht, damit das Editor-Menü am neuen Klickpunkt wiederkommt.
            const current = input.current();
            if (current !== undefined && sameArea(area, current)) input.select(current, at);
            else input.select(area, at);
            input.choices(
                candidates.length > 1 ? { candidates, selected: choice.id, screen: context.screen, point } : undefined,
            );
            return;
        }
        // Keine Fläche, nur die gewählte oder der gewählte Weg selbst (`onSelection`): Die Auswahl bleibt.
        input.choices(undefined);
    };

    const owner: InteractionOwner<AreaClaim> = {
        id: "area",
        priority: INTERACTION_PRIORITY.area,
        // 🔴 Kein langer Druck (WI-0108): Er ist seit dem 2026-10-08 der Rechtsklick, und den bekam eine Fläche am
        // Rechner nie. Hätte sie ihn behalten, wäre das Kartenmenü in der Landschaftsansicht am Finger nirgends zu
        // öffnen: Flächen decken dort die ganze Karte, und Rang 40 steht über dem Menü (20).
        kinds: ["click", "hover"],
        layers: () => [...AREA_LAYER_IDS, ...SELECTION_LAYER_IDS],

        hit(context) {
            const onSelection = context.features(SELECTION_LAYER_IDS).length > 0;
            const lookup = input.landscapeAreas?.() === false ? undefined : input.lookup?.();
            // 🔌 Einhängepunkt (Phase 6, geteilt mit WI-0058; nichts davon ist umgesetzt): Hier, wo die Kandidaten
            // einer Stelle feststehen, greift später die Rangfunktion über `region_layer`, `stack_order` und
            // `is_locked`. Eine reine Funktion `(Kandidaten, Kontext) → Kandidaten`, die vor `nextCandidate` ordnet
            // und gesperrte Flächen aus der Wahl nimmt. Sie kann hier sitzen, weil es EIN `hit` für Kacheln und
            // Server gibt und beide Wege ihre Kandidaten durch dieselbe Stelle geben.
            if (context.kind === "click") {
                // Nichts darunter und nicht die Auswahl selbst: Der Klick gehört niemandem hier - der Rückfall
                // `empty` beendet die Auswahl.
                const claim = (candidates: AreaCandidate[]): AreaClaim | undefined =>
                    candidates.length > 0 || onSelection ? { candidates, onSelection } : undefined;
                if (!lookup) return claim(visibleCandidates(tileCandidates(context)));
                // Eine Antwort für einen älteren Klick gilt nicht mehr: Das Signal bricht die Frage ab.
                // 🪤 Scheitert die Frage, hat dieser Besitzer nichts: Bis WI-0090 blieben hier die Flüsse aus den
                // Kacheln übrig; sie gehören jetzt dem Besitzer `path`, der sie ohne Server findet und vor diesem
                // Besitzer dran ist. Ein Rückfall auf etwas Fremdes wäre eine zweite Rechnung.
                return serverCandidates(context, lookup)
                    .catch((): AreaCandidate[] => [])
                    .then((candidates) => claim(visibleCandidates(candidates)));
            }
            // Zeigen: A, die Fläche umreißen, die ein Klick wählen würde. Wo die Karte die Flächen nicht zeichnet,
            // fragt es den Server erst, wenn der Zeiger ruht (WI-0058); beim Überfahren fragt es gar nicht.
            const showing = (candidates: AreaCandidate[]): AreaClaim | undefined =>
                preview(candidates, currentLandscape(input))
                    ? { cursor: "pointer", candidates, onSelection }
                    : undefined;
            if (!lookup) return showing(visibleCandidates(tileCandidates(context)));
            return rested(HOVER_REST_MS, context.signal).then(async (still) => {
                if (!still) return undefined;
                try {
                    return showing(visibleCandidates(await serverCandidates(context, lookup)));
                } catch {
                    return undefined;
                }
            });
        },

        apply(kind, claim, context) {
            if (kind === "click") {
                decide(claim, context);
                return;
            }
            const shown = preview(visibleCandidates(claim.candidates), currentLandscape(input));
            if (!shown) {
                clearHint();
                return;
            }
            outlineArea(map, shown.next);
            hinted = shown.next.id;
            input.hint({
                candidate: shown.next,
                others: shown.others,
                afterCurrent: shown.afterCurrent,
                screen: context.screen,
            });
        },

        umschalt(claim, context) {
            const choice = nextCandidate(visibleCandidates(claim.candidates), currentLandscape(input));
            if (choice === undefined) return false;
            const area = selectionOf(map, choice, fromRenderLngLat(space, context.lngLat));
            if (input.umschaltKlick?.(area) !== true) return false;
            input.choices(undefined);
            return true;
        },

        lost: clearHint,
    };

    const unregister = interaction.register(owner);
    // Jede Kartenbewegung schließt die Liste, wie beim Kartenmenü (das Schild nimmt der Koordinator weg). 🔴 Nicht das
    // Nachführen der sichtbaren Fläche: Geht beim ersten Klick das Infopanel auf, ändert sich nur der Innenabstand (die Karte
    // bleibt stehen, `visible-area.ts`), und die Liste, die dieser Klick gerade geöffnet hat, bliebe sonst nie stehen.
    const onMoveStart = (event: object): void => {
        if (!isLayoutMove(event)) input.choices(undefined);
    };
    map.on("movestart", onMoveStart);
    return () => {
        map.off("movestart", onMoveStart);
        unregister();
        clearHint();
    };
}
