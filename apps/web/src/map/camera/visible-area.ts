import type { Map as MapLibreMap } from "maplibre-gl";
import { centreFor, locationAt, type CameraView } from "./target-centre";

const viewOf = (map: MapLibreMap): CameraView => ({
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
});

/**
 * Die sichtbare Kartenfläche (WI-0039, E1): Wohin die Kamera zielt, bestimmt die freie Fläche, nicht
 * die Mitte des ganzen Canvas (Betreiber 2026-09-26: „Wenn links der Routenplaner offen ist, soll ein
 * angeflogenes Ziel in der Mitte der freien Kartenfläche rechts daneben erscheinen“).
 *
 * - **Ein Panel meldet sich selbst:** `data-map-overlay="left|right|top|bottom"` an dem Element, das
 *   die Karte deckt. Gemessen wird seine echte Größe, keine angenommene Breite.
 * - **Zu ist zu:** Ein Panel unter `inert` zählt nicht - so klappt der Planer. Gemessen wird der
 *   Kasten ohne `transform`: Beim Aufklappen gilt sofort die Lage, in der er gleich steht.
 * - **Was fast alles deckt, ist kein Rand:** Ließe ein Panel weniger als 40 % der Karte übrig, zielt
 *   die Kamera auf die ganze Karte - man sieht das Ziel, sobald es zugeht. Am Telefon deckt der offene
 *   Planer 350 von 412 px (gemessen 2026-09-26); die freien 62 px wären kein Ziel.
 * - 🔴 **Die Fläche wird NICHT MapLibres `padding`, der Fluchtpunkt bleibt in der Bildmitte** (WI-0218; Betreiber 2026-10-17
 *   über die Orchestrierung, auf den Vorschlag „Fluchtpunkt bleibt in der Bildmitte, nur Ziele beim Hinfliegen rücken in die freie
 *   Fläche“: „ok, aber beachte dass bei angedockten editoren ein klick auf die ziel objekte ebenfalls nicht in der bildmitte erfolgen
 *   sollen“). Bis WI-0218 war sie es, und ein aufklappender Editor (rund 960 px) verschob in 3D den Fluchtpunkt. Die Fläche ist jetzt
 *   der Bezug (`insets`), und die Kamera rechnet jedes Ziel hinein: Fahrten, Einpassen, Ring und Tasten (`camera.ts`,
 *   `target-centre.ts`). Rad, Doppelklick und Pinch zoomen weiter am Zeiger.
 * - 🔴 **Auf breiten Schirmen bleibt die Mitte die Bildmitte** (E4, Betreiber 2026-09-26: „bei meinem 4k
 *   16:9 sieht es aus wie wenn die ansicht kaputt ist“ - an kleineren Schirmen „kommt es richtig gut“).
 *   Ein Seitenpanel, das weniger als 23,5 % der Kartenbreite deckt, ist eine Seitenleiste: Es
 *   verschiebt die Mitte nicht. Freigehalten wird es trotzdem - eingepasst wird daneben (`keepFree`).
 * - 🔴 **Die Karte bleibt stehen** (E3): Geht ein Panel auf oder zu, ändert sich nur der Bezug, nicht
 *   das Bild. Einzige Ausnahme ist das Laden (`settle`): Ein Link oder die Startansicht landet in der
 *   Mitte der freien Fläche.
 * - Wer die Fläche nur lesen will, fragt die Karte: `centreInsets(map)` den Bezug der Mitte (was bis WI-0218 `map.getPadding()` war),
 *   `targetInsets(map)`, was ein Ziel nicht verdecken darf (ein Griff in der freien Fläche?).
 */

export type OverlayEdge = "left" | "right" | "top" | "bottom";

/** Das Attribut, mit dem sich ein Panel über der Karte meldet. */
export const MAP_OVERLAY_ATTRIBUTE = "data-map-overlay";

/** Ließe ein Panel weniger als diesen Anteil der Karte frei, deckt es sie, statt sie zu verkleinern. */
export const MIN_VISIBLE_SHARE = 0.4;

/**
 * Deckt ein Seitenpanel weniger als diesen Anteil der Kartenbreite, ist es eine Seitenleiste und
 * verschiebt die Mitte nicht (E4). Gemessen wird die Fensterbreite in CSS-Pixeln, nicht die Auflösung.
 * Beim Planer mit 350 px liegt die Grenze bei 1490 px, in der Mitte zwischen 1440 und 1536:
 * - Mittig werden Full HD bei 100 % und 125 % Skalierung (1920 bzw. 1536 px; Betreiber 2026-09-26:
 *   „ja, 125 % soll auch zählen“), 2K und 4K.
 * - Die Mitte der freien Fläche behalten schmalere Fenster (1280, 1440; auch Full HD bei 150 %), an
 *   denen sie „richtig gut“ ankommt.
 */
export const SIDEBAR_SHARE = 0.235;

/** Das Kennzeichen der Bewegung, mit der die Fläche nachgeführt wird - sie ist niemandes Geste. */
export const LAYOUT_EVENT = "visibleArea";

/** Kam diese Bewegung vom Nachführen der Fläche? Dann hält sie zum Beispiel den Playmode nicht an. */
export function isLayoutMove(event: object): boolean {
    return (event as Record<string, unknown>)[LAYOUT_EVENT] === true;
}

export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface Overlay {
    edge: OverlayEdge;
    box: Box;
}

/** Wie viel Rand die Panels der Karte nehmen, in Bildpunkten - MapLibres `padding`. */
export interface Insets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

const EDGES: readonly OverlayEdge[] = ["left", "right", "top", "bottom"];

function isEdge(value: string | null): value is OverlayEdge {
    return value !== null && (EDGES as readonly string[]).includes(value);
}

const overlapsOn = (from: number, size: number, otherFrom: number, otherSize: number): boolean =>
    from < otherFrom + otherSize && otherFrom < from + size;

/** Wie weit ein Panel von seiner Kante her in die Karte reicht. */
function reach(map: Box, { edge, box }: Overlay): number {
    switch (edge) {
        case "left":
            return box.left + box.width - map.left;
        case "right":
            return map.left + map.width - box.left;
        case "top":
            return box.top + box.height - map.top;
        case "bottom":
            return map.top + map.height - box.top;
    }
}

/** Eine Seitenleiste: links oder rechts, und schmal im Verhältnis zur Karte (E4). */
function isSidebar(map: Box, overlay: Overlay): boolean {
    return (overlay.edge === "left" || overlay.edge === "right") && reach(map, overlay) < map.width * SIDEBAR_SHARE;
}

/** Die Ränder, auf die sich die Mitte bezieht: jedes Panel, das die Karte verkleinert, außer Seitenleisten. */
export function visibleInsets(map: Box, overlays: readonly Overlay[]): Insets {
    return coveredInsets(
        map,
        overlays.filter((overlay) => !isSidebar(map, overlay)),
    );
}

/**
 * Deckt dieses Panel seine ganze Kante: ein Seitenpanel die ganze Höhe der Karte, ein Kopf- oder Fußpanel die ganze Breite (WI-0265 B9d)? Nur dann liegt hinter ihm nichts, was man sehen könnte. Der Routenplaner ist eine Karte
 * von 350 × 610 Bildpunkten und deckt von der Höhe der Karte nur einen Teil: Unter ihm ist die Karte frei.
 */
export function coversWholeEdge(map: Box, { edge, box }: Overlay, tolerance = 2): boolean {
    return edge === "left" || edge === "right"
        ? box.top <= map.top + tolerance && box.top + box.height >= map.top + map.height - tolerance
        : box.left <= map.left + tolerance && box.left + box.width >= map.left + map.width - tolerance;
}

/**
 * Die Ränder, hinter die der Kartenzaun den Kartenrand zurückweichen lässt (WI-0265 B9d): wie `visibleInsets`, aber nur hinter Panels, die ihre ganze Kante decken. 🔴 Die LEINWAND zeigt nie Fläche außerhalb des
 * Kartenbilds: Wich der Rand auch hinter dem halbhohen Routenplaner zurück (so war es bis B9c), stand unter ihm, über die restliche Höhe, der leere Hintergrund (gemessen 2026-11-01: 1440 px breit, Planer 350 × 610, Editorpanel
 * rechts: 110 px leer links, nach einem ⊕ auf einen Kasten um ganz Aventurien). Die Mitte der Karte (`visibleInsets`, `keepFree`) bleibt, was sie war: Sie bestimmt, wohin eingepasst wird, nicht, was die Karte füllt.
 */
export function fenceInsets(map: Box, overlays: readonly Overlay[]): Insets {
    return visibleInsets(
        map,
        overlays.filter((overlay) => coversWholeEdge(map, overlay)),
    );
}

/** Je Kante das Panel, das am weitesten hineinreicht; `keep` entscheidet, ob ein Panel als Rand zählt. */
function reaches(map: Box, overlays: readonly Overlay[], keep: (extent: number, inset: number) => boolean): Insets {
    const insets = { ...NO_INSETS };
    for (const overlay of overlays) {
        const { box, edge } = overlay;
        if (
            !overlapsOn(box.left, box.width, map.left, map.width) ||
            !overlapsOn(box.top, box.height, map.top, map.height)
        ) {
            continue;
        }
        const extent = edge === "left" || edge === "right" ? map.width : map.height;
        const inset = Math.min(extent, Math.max(0, reach(map, overlay)));
        if (!keep(extent, inset)) continue;
        insets[edge] = Math.max(insets[edge], Math.round(inset));
    }
    return insets;
}

/**
 * Was die Panels wirklich decken, je Kante das weiteste, ohne die Regeln für die Mitte (WI-0128 E7): Der Hinflug des Ortseditors zielt in
 * die Lücke zwischen ihnen, auch wenn sie zusammen mehr als 60 % der Karte decken (Planer links, Ortseditor rechts angedockt).
 */
export const coveredEdges = (map: Box, overlays: readonly Overlay[]): Insets => reaches(map, overlays, () => true);

/** Die Ränder, die frei bleiben müssen: je Kante das Panel, das am weitesten hineinreicht - samt Seitenleisten. */
export function coveredInsets(map: Box, overlays: readonly Overlay[]): Insets {
    const insets = reaches(map, overlays, (extent, inset) => extent - inset >= extent * MIN_VISIBLE_SHARE);
    // Zwei Panels einander gegenüber dürfen zusammen nicht mehr nehmen als eins allein.
    if (map.width - insets.left - insets.right < map.width * MIN_VISIBLE_SHARE) {
        insets.left = 0;
        insets.right = 0;
    }
    if (map.height - insets.top - insets.bottom < map.height * MIN_VISIBLE_SHARE) {
        insets.top = 0;
        insets.bottom = 0;
    }
    return insets;
}

/** MapLibres `getPadding()` lässt Seiten weg, die nie gesetzt wurden. */
type LooseInsets = Partial<Insets>;

/**
 * Kleiner als das ist die Lücke zwischen den Panels kein Ziel (WI-0218 Nachbesserung): zweimal der Rand des Einpassens (`FIT_MARGIN` in
 * `camera.ts`, mindestens 40 bzw. 32 px je Seite). Planer und angedocktes Fenster lassen bei 1280 px nichts übrig.
 */
export const MIN_TARGET_GAP = { width: 80, height: 64 } as const;

/** Bleibt zwischen diesen Rändern eine Lücke, in der ein Ziel landen kann? */
export function leavesGap(size: { width: number; height: number }, insets: LooseInsets): boolean {
    const rect = visibleRect(size, insets);
    return rect.width > MIN_TARGET_GAP.width && rect.height > MIN_TARGET_GAP.height;
}

/** Die sichtbare Fläche in Bildpunkten der Karte. */
export function visibleRect(size: { width: number; height: number }, insets: LooseInsets): Box {
    const { top = 0, right = 0, bottom = 0, left = 0 } = insets;
    return {
        left,
        top,
        width: Math.max(0, size.width - left - right),
        height: Math.max(0, size.height - top - bottom),
    };
}

/** Die Mitte der sichtbaren Fläche - dort steht, was die Kamera zeigt. */
export function visibleCentre(size: { width: number; height: number }, insets: LooseInsets): { x: number; y: number } {
    const rect = visibleRect(size, insets);
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Die Ränder, die frei bleiben: je Seite das Größere aus dem, was die Panels decken (`covered`), und dem, was nach der Landung zusätzlich deckt (`extra`, etwa ein Editorfenster). */
export function mergeInsets(covered: LooseInsets, extra: LooseInsets | undefined): Insets {
    return {
        top: Math.max(covered.top ?? 0, extra?.top ?? 0),
        right: Math.max(covered.right ?? 0, extra?.right ?? 0),
        bottom: Math.max(covered.bottom ?? 0, extra?.bottom ?? 0),
        left: Math.max(covered.left ?? 0, extra?.left ?? 0),
    };
}

export function sameInsets(a: LooseInsets, b: LooseInsets): boolean {
    const sides = ["top", "right", "bottom", "left"] as const;
    return sides.every((side) => (a[side] ?? 0) === (b[side] ?? 0));
}

/** MapLibres Kachelgröße: die Welt misst bei Zoom z `512 · 2^z` Bildpunkte. */
const WORLD_TILE_SIZE = 512;
const mercatorX = (lng: number): number => (lng + 180) / 360;
const mercatorY = (lat: number): number => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const lngOf = (x: number): number => x * 360 - 180;
const latOf = (y: number): number => (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - 90;

export interface LngLatBox {
    west: number;
    south: number;
    east: number;
    north: number;
}

/**
 * Die Zoomstufe, bei der die Karte (`bounds`, Renderkoordinaten) eine Fläche dieser Größe gerade noch ganz füllt (WI-0265 B9c): das Größere aus Breiten- und Höhenpassung, also keine Seite der Fläche
 * zeigt Fläche außerhalb des Kartenbilds. Darunter sähe man den Kartenrand. Ohne Fläche (Breite oder Höhe 0) füllt jede Stufe sie; das Ergebnis ist dann `-Infinity`.
 *
 * 🔴 Die EINE Rechnung dafür: Der Kartenzaun (`constrainToVisible`) hebt den Zoom auf diese Stufe, und der Flug aus „Auf der Karte zeigen“ nimmt sie als unteren Deckel
 * (`aenderungen/aenderung-lage-modell.ts`, `flugOptionen`).
 */
export function fillZoom(bounds: LngLatBox, visible: { width: number; height: number }): number {
    const spanX = mercatorX(bounds.east) - mercatorX(bounds.west);
    const spanY = mercatorY(bounds.south) - mercatorY(bounds.north);
    return Math.log2(Math.max(visible.width / (spanX * WORLD_TILE_SIZE), visible.height / (spanY * WORLD_TILE_SIZE)));
}

/**
 * Der Kartenzaun an der SICHTBAREN Fläche (WI-0039): Aventurien endet an seinem Rand, und dieser Rand
 * darf bis an den Rand der freien Fläche kommen, aber nicht darüber.
 *
 * 💣 MapLibres eigener Zaun (`maxBounds`) kennt kein `padding`: Er hält die Mitte eine halbe
 * Canvasbreite vom Rand. Steht die Mitte rechts vom Planer, blieben so die östlichsten 175 px nie
 * erreichbar, und im Westen ragte der Rand unter den Planer (gemessen am Klimanamen-Test, 2026-09-26).
 * Gerechnet wird wie MapLibres `defaultConstrain` (Mercator), nur mit der sichtbaren Größe: Passt die
 * Welt nicht mehr hinein, rückt der Zoom so weit heran, dass sie die Fläche füllt.
 *
 * Seit WI-0218 liegt die Mitte der Karte in der Bildmitte, nicht mehr in der Mitte der freien Fläche: Die Fläche reicht von ihr aus je
 * Seite verschieden weit (`insets`). Passt die Welt in einer Richtung nicht hinein, steht sie mittig in der freien Fläche.
 */
export function constrainToVisible(
    center: { lng: number; lat: number },
    zoom: number,
    bounds: LngLatBox,
    canvas: { width: number; height: number },
    insets: LooseInsets,
    zoomRange: { min: number; max: number },
): { center: { lng: number; lat: number }; zoom: number } {
    const visible = visibleRect(canvas, insets);
    const level = Math.max(Math.min(zoomRange.max, Math.max(zoomRange.min, zoom)), fillZoom(bounds, visible));
    const size = WORLD_TILE_SIZE * 2 ** level;
    // Wie weit die freie Fläche von der Bildmitte aus reicht, je Seite, in Weltkoordinaten bei diesem Zoom.
    const { top = 0, right = 0, bottom = 0, left = 0 } = insets;
    const reachX = { before: (canvas.width / 2 - left) / size, after: (canvas.width / 2 - right) / size };
    const reachY = { before: (canvas.height / 2 - top) / size, after: (canvas.height / 2 - bottom) / size };
    const clampAxis = (value: number, min: number, max: number, reach: { before: number; after: number }): number =>
        max - min <= reach.before + reach.after
            ? (min + max) / 2 + (reach.before - reach.after) / 2
            : Math.min(max - reach.after, Math.max(min + reach.before, value));
    const x = clampAxis(mercatorX(center.lng), mercatorX(bounds.west), mercatorX(bounds.east), reachX);
    const y = clampAxis(mercatorY(center.lat), mercatorY(bounds.north), mercatorY(bounds.south), reachY);
    return { center: { lng: lngOf(x), lat: latOf(y) }, zoom: level };
}

/**
 * Die Lage eines Elements ohne `transform`, in Seitenkoordinaten. `getBoundingClientRect` zeigte ein
 * einfahrendes Panel mitten in der Fahrt; die Kamera braucht, wo es gleich steht.
 *
 * Exportiert seit WI-0096: Die Maßstabsleiste hebt sich über den Toast und hat dasselbe Problem - der
 * Toast steigt in 140 ms um 8 px auf (`toast-enter-from`), und ein Hub aus dem Rechteck MITTEN in dieser
 * Bewegung wäre 8 px zu klein. Zwei Stellen, eine Messung.
 */
export function layoutBox(element: HTMLElement): Box {
    let left = 0;
    let top = 0;
    for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
        left += node.offsetLeft;
        top += node.offsetTop;
    }
    return { left, top, width: element.offsetWidth, height: element.offsetHeight };
}

/** Die Panels, die gerade die Karte decken: gemeldet, sichtbar und nicht zugeklappt. */
export function measureOverlays(root: ParentNode): Overlay[] {
    return [...root.querySelectorAll<HTMLElement>(`[${MAP_OVERLAY_ATTRIBUTE}]`)].flatMap((element) => {
        const edge = element.getAttribute(MAP_OVERLAY_ATTRIBUTE);
        if (!isEdge(edge) || element.closest("[inert]") || element.getClientRects().length === 0) return [];
        return [{ edge, box: layoutBox(element) }];
    });
}

export interface VisibleArea {
    /** Die Fläche jetzt messen und als Bezug merken; die Karte bewegt sich dabei nicht (E3). */
    sync(): Insets;
    /** Der zuletzt gemessene Bezug der Mitte (`visibleInsets`), ohne neu zu messen: für den Zaun, der in jedem Bild fragt. */
    insets(): Insets;
    /**
     * Die Ränder, hinter die der Kartenzaun den Kartenrand zurückweichen lässt (`fenceInsets`, WI-0265 B9d): der Bezug der Mitte, aber nur hinter Panels, die ihre ganze Kante decken. Zuletzt gemessen, ohne neu zu messen: Der
     * Zaun fragt in jedem Bild.
     */
    fenceInsets(): Insets;
    /** Die Mitte der freien Fläche in Bildpunkten der Karte: Dort landet, was die Kamera zeigt (WI-0218). */
    centre(): { x: number; y: number };
    /**
     * Was gerade in der Mitte der freien Fläche liegt (WI-0218): Das schreibt die Adresse, damit ein Link seinen Ausschnitt dort öffnet
     * (`settle`) und Neuladen nichts verschiebt. Bis WI-0218 war es `map.getCenter()`.
     */
    centreLocation(): [number, number];
    /** Meldet, wenn sich der Bezug ändert (ein Panel geht auf oder zu): Die Karte steht, die Adresse nicht. Gibt die Abmeldung zurück. */
    onChange(listener: () => void): () => void;
    /** Was beim Einpassen frei bleiben muss: jedes Panel über der Karte, auch eine Seitenleiste (E4). */
    keepFree(): Insets;
    /** Was die Panels wirklich decken, ohne die Regeln für die Mitte (`coveredEdges`, WI-0128 E7). */
    covered(): Insets;
    /**
     * Meldet, wenn sich ändert, was die Panels wirklich decken (`covered`), auch wenn der Bezug der Mitte gleich bleibt: Bei 1280 px
     * ändert ein breiter werdendes Fenster den Bezug nicht (keine Lücke, Seitenleiste), wohl aber die freie Fläche (der Kamera-Hinweis,
     * Fund der Gebiete 2026-10-19). Gibt die Abmeldung zurück.
     */
    onCovered(listener: () => void): () => void;
    /**
     * Beim Laden, sobald die Panels stehen: Der Ausschnitt rückt in die freie Fläche (ein Link, die
     * Startansicht). Danach führt die Fläche sich selbst nach.
     */
    settle(): void;
    destroy(): void;
}

/** Die Fläche je Karte, für Leser, die nur die Karte kennen (`centreInsets`). */
const areas = new WeakMap<MapLibreMap, VisibleArea>();

/**
 * Der Bezug der Mitte dieser Karte: was die Panels nehmen, ohne Seitenleisten (`visibleInsets`). Bis WI-0218 war das
 * `map.getPadding()`; ohne gemessene Fläche ist es keiner.
 */
export function centreInsets(map: MapLibreMap): Insets {
    return areas.get(map)?.insets() ?? NO_INSETS;
}

/**
 * Was ein Ziel dieser Karte NICHT verdecken darf (WI-0218 Nachbesserung): was Panels und Fenster wirklich decken (`coveredEdges`), ohne die
 * Regeln der Mitte. 🪤 `centreInsets` lässt Planer und angedocktes Fenster fallen, sobald sie zusammen mehr als 60 % decken (schon bei
 * Full HD), und ein Griff unter dem Fenster galt als frei. Bleibt zwischen ihnen keine Lücke (`leavesGap`, 1280 px), gilt der Bezug der
 * Mitte: Man sieht das Ziel, sobald ein Panel geht. Für Leser, die nur die Karte kennen (`map/geometrie/kamera.ts`).
 */
export function targetInsets(map: MapLibreMap): Insets {
    const area = areas.get(map);
    if (area === undefined) return NO_INSETS;
    const covered = area.covered();
    const canvas = map.getCanvas();
    const size = { width: canvas.clientWidth, height: canvas.clientHeight };
    if (!leavesGap(size, covered)) return area.insets();
    return mitZielDeckung(size, covered, zielDeckungAm(map));
}

/**
 * Was außer Panels und Fenstern ein ZIEL verdeckt (WI-0218 §10; Orchestrierung 2026-10-18, A: „Der Auftrag des Betreibers für WI-0218
 * war ‚Ziele in die freie Fläche', und der Ring deckt Karte ab wie ein Panel“): Bedienelemente IN der freien Fläche, markiert mit
 * `data-ziel-deckung` (der Kameraring; seit dem Befund der Derographie 2026-10-19 auch Auge, Lupe und Fächer im Eckbund unten rechts,
 * unter denen nach dem Einpassen die untere rechte Ecke einer Fläche lag). Bei 1280 px steht der Ring mitten in der Lücke zwischen
 * Planer und Fenster, 53 px neben ihrer Mitte, und ein Griff lag unter ihm. Sie zählen NUR hier, für das Ziel eines Hinflugs;
 * Fluchtpunkt und sichtbare Fläche (`insets`, `centre`) kennen sie nicht, die Projektion bleibt.
 *
 * Je Kasten in der freien Fläche rückt die Kante heran, die am wenigsten Fläche kostet (der Ring am rechten Rand der Lücke: die rechte
 * Kante bis an seine linke Seite). Bliebe dann keine Lücke (`leavesGap`), gilt der Kasten nicht.
 */
export function mitZielDeckung(
    size: { width: number; height: number },
    insets: Insets,
    kaesten: readonly Box[],
): Insets {
    let raus = { ...insets };
    for (const kasten of kaesten) {
        const frei = visibleRect(size, raus);
        const innen =
            kasten.left < frei.left + frei.width &&
            kasten.left + kasten.width > frei.left &&
            kasten.top < frei.top + frei.height &&
            kasten.top + kasten.height > frei.top;
        if (!innen) continue;
        const kandidaten: Insets[] = [
            { ...raus, right: Math.max(raus.right, Math.round(size.width - kasten.left)) },
            { ...raus, left: Math.max(raus.left, Math.round(kasten.left + kasten.width)) },
            { ...raus, bottom: Math.max(raus.bottom, Math.round(size.height - kasten.top)) },
            { ...raus, top: Math.max(raus.top, Math.round(kasten.top + kasten.height)) },
        ];
        const flaeche = (rand: Insets): number => {
            const rest = visibleRect(size, rand);
            return rest.width * rest.height;
        };
        const beste = kandidaten.reduce((a, b) => (flaeche(b) > flaeche(a) ? b : a));
        if (leavesGap(size, beste)) raus = beste;
    }
    return raus;
}

/**
 * Die freie Fläche dieser Karte in Bildpunkten: was Panels und Fenster wirklich decken (`coveredEdges`) und die Bedienelemente mit
 * `data-ziel-deckung` darin abgezogen, wie für das Ziel eines Hinflugs. Bleibt keine Lücke (`leavesGap`), `undefined`: Dann gibt es
 * keinen Platz, an dem nichts deckt. Für den einmaligen Kamera-Hinweis (`controls/kamera-hinweis-platz.ts`).
 */
export function freieFlaeche(map: MapLibreMap): Box | undefined {
    const area = areas.get(map);
    if (area === undefined) return undefined;
    const covered = area.covered();
    const canvas = map.getCanvas();
    const size = { width: canvas.clientWidth, height: canvas.clientHeight };
    if (!leavesGap(size, covered)) return undefined;
    return visibleRect(size, mitZielDeckung(size, covered, zielDeckungAm(map)));
}

/**
 * Die Mitte der freien Fläche (`freieFlaeche`) als Länge und Breite, `undefined` ohne Lücke. Anders als `centreLocation` (der Bezug der
 * Mitte) zählt hier jedes Panel, auch der Planer: Dort entsteht ein neues Wetter-Icon (WI-0288 Stufe 3), sichtbar und greifbar.
 */
export function freieMitte(map: MapLibreMap): [number, number] | undefined {
    const frei = freieFlaeche(map);
    if (frei === undefined) return undefined;
    const ort = map.unproject([frei.left + frei.width / 2, frei.top + frei.height / 2]);
    return [ort.lng, ort.lat];
}

/** Die Kästen mit `data-ziel-deckung` in Bildpunkten der Karte; ohne Seite (Vitest) keine. */
function zielDeckungAm(map: MapLibreMap): Box[] {
    if (typeof document === "undefined") return [];
    const elemente = [...document.querySelectorAll<HTMLElement>("[data-ziel-deckung]")];
    if (elemente.length === 0) return [];
    const karte = map.getContainer().getBoundingClientRect();
    return elemente
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
            left: rect.left - karte.left,
            top: rect.top - karte.top,
            width: rect.width,
            height: rect.height,
        }));
}

export function createVisibleArea(
    map: MapLibreMap,
    root: HTMLElement = map.getContainer().parentElement ?? document.body,
): VisibleArea {
    const container = map.getContainer();
    let current: Insets = NO_INSETS;
    let zaun: Insets = NO_INSETS;
    let gedeckt: Insets = NO_INSETS;
    const listeners = new Set<() => void>();
    const deckungsHoerer = new Set<() => void>();
    const measure = (): Insets => {
        const box = layoutBox(container);
        const overlays = measureOverlays(root);
        const next = visibleInsets(box, overlays);
        const changed = !sameInsets(next, current);
        current = next;
        zaun = fenceInsets(box, overlays);
        const jetztGedeckt = coveredEdges(box, overlays);
        const deckungNeu = !sameInsets(jetztGedeckt, gedeckt);
        gedeckt = jetztGedeckt;
        if (changed) for (const listener of listeners) listener();
        if (deckungNeu) for (const listener of deckungsHoerer) listener();
        return current;
    };

    let observing = false;
    let frame: number | undefined;
    const sizes = new ResizeObserver(() => schedule());
    const changes = new MutationObserver(() => schedule());
    /** Was `sizes` gerade beobachtet: die Karte und die gemeldeten Panels. */
    const beobachtet = new Set<Element>();

    /** Nachmessen, wenn ein Panel aufgeht, zugeht oder seine Größe ändert. Die Karte bleibt, wo sie ist. */
    const follow = (): void => {
        frame = undefined;
        measure();
        watchOverlays();
    };
    function schedule(): void {
        if (!observing || frame !== undefined) return;
        frame = requestAnimationFrame(follow);
    }
    /**
     * Beobachtet die Karte und jedes gemeldete Panel, neue dazu, verschwundene nicht mehr. 💣 Nie alle abmelden und neu anmelden: Ein
     * ResizeObserver meldet jedes neu angemeldete Element im nächsten Bild einmal, das maß nach, meldete wieder an, und so lief das Messen
     * in jedem Bild, auch in Ruhe (WI-0249 Leistung, 2026-10-26: 303 Rückrufe in 5 s Ruhe, je Bild ein erzwungenes Layout).
     */
    const watchOverlays = (): void => {
        const jetzt = new Set<Element>([
            container,
            ...root.querySelectorAll<HTMLElement>(`[${MAP_OVERLAY_ATTRIBUTE}]`),
        ]);
        for (const element of beobachtet)
            if (!jetzt.has(element)) {
                sizes.unobserve(element);
                beobachtet.delete(element);
            }
        for (const element of jetzt)
            if (!beobachtet.has(element)) {
                sizes.observe(element);
                beobachtet.add(element);
            }
    };

    const area: VisibleArea = {
        sync() {
            return measure();
        },
        insets() {
            return current;
        },
        fenceInsets() {
            return zaun;
        },
        centre() {
            const canvas = map.getCanvas();
            return visibleCentre({ width: canvas.clientWidth, height: canvas.clientHeight }, current);
        },
        centreLocation() {
            const { lng, lat } = map.getCenter();
            return locationAt(map, viewOf(map), [lng, lat], area.centre());
        },
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        keepFree() {
            return coveredInsets(layoutBox(container), measureOverlays(root));
        },
        covered() {
            return coveredEdges(layoutBox(container), measureOverlays(root));
        },
        onCovered(listener) {
            deckungsHoerer.add(listener);
            return () => deckungsHoerer.delete(listener);
        },
        settle() {
            const first = !observing;
            const next = measure();
            if (first && !sameInsets(next, NO_INSETS)) {
                // Was jetzt in der Bildmitte liegt (ein Link, die Startansicht), rückt in die Mitte der freien Fläche.
                const canvas = map.getCanvas();
                const at = visibleCentre({ width: canvas.clientWidth, height: canvas.clientHeight }, next);
                const { lng, lat } = map.getCenter();
                // Kamera-Sprung erlaubt (first): der allererste Blick beim Laden rückt in die freie Fläche (`settle`).
                map.jumpTo({ center: centreFor(map, [lng, lat], viewOf(map), at) }, { [LAYOUT_EVENT]: true });
            }
            if (observing) return;
            observing = true;
            watchOverlays();
            changes.observe(root, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ["inert", MAP_OVERLAY_ATTRIBUTE],
            });
        },
        destroy() {
            observing = false;
            if (frame !== undefined) cancelAnimationFrame(frame);
            sizes.disconnect();
            beobachtet.clear();
            changes.disconnect();
            listeners.clear();
            deckungsHoerer.clear();
            areas.delete(map);
        },
    };
    areas.set(map, area);
    return area;
}
