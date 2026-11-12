import type { Map as MapLibreMap, MapGeoJSONFeature, MapMouseEvent, MapTouchEvent } from "maplibre-gl";

/**
 * Der Vertrag der Karteninteraktion (M8, Hardening Review 2026-09-28): Wer auf der Karte auf den Zeiger hört,
 * meldet sich als Besitzer beim Koordinator an. Der Koordinator hört EINMAL je Ereignis, fragt EINMAL die
 * Karte, wer unter dem Zeiger liegt, und gibt das Ereignis an den Besitzer mit dem höchsten Rang. Vorrang,
 * Zeigerform und Abbruch stehen damit an einer Stelle statt als Bedingung in jedem Handler.
 */

/**
 * Was ein Besitzer beanspruchen kann.
 * - `click`: ein Klick oder Tipp.
 * - `hover`: der Zeiger ruht über etwas (nur Maus; je Bild einmal, nie mit gedrückter Taste).
 * - `press`: der Druck beginnt (Maustaste oder Finger) - vor jedem Ziehen der Karte, mit `preventDefault`.
 * - `contextmenu`: die rechte Maustaste **und am Finger der lange Druck** (550 ms fast still, WI-0108).
 *
 * 🔴 **Es gibt keine eigene Art `longpress` mehr** (Betreiber 2026-10-08, wörtlich: „Kartenmenü ‚Was ist hier?‘ ->
 * ist im rechtsklicks als menüpunkt drin, langer tap ist rechtsklick“). Der Koordinator MISST den langen Druck
 * weiter selbst (iOS kennt kein `contextmenu`, `long-press.ts`), verteilt ihn aber als `contextmenu`: ein Weg, eine
 * Rangfolge, ein Satz Besitzer. Wer vorher nur `longpress` beanspruchte - Weg, Fläche, Kraftlinie, Route,
 * Klimaband -, bekommt den langen Druck damit nicht mehr; am Rechner bekam keiner von ihnen den Rechtsklick, und
 * genau diese Lücke war am Telefon das unerreichbare Kartenmenü.
 */
export type InteractionKind = "click" | "hover" | "press" | "contextmenu";

/** Was ein Treffer trägt. Die Zeigerform gehört dem Gewinner; wer keine nennt, lässt den Standard. */
export interface Claim {
    readonly cursor?: string;
}

export interface Screen {
    x: number;
    y: number;
}

/**
 * Alles, was ein Besitzer über das Ereignis wissen darf. Die Abfrage der Karte ist schon gelaufen: EINE
 * `queryRenderedFeatures` über die Layer aller Besitzer, die dieses Ereignis beanspruchen.
 */
export interface HitContext {
    readonly kind: InteractionKind;
    readonly map: MapLibreMap;
    /** Das MapLibre-Ereignis dazu; beim langen Druck der Beginn des Drucks. */
    readonly event: MapMouseEvent | MapTouchEvent;
    /** Der Zeiger in Bildpunkten der Karte. */
    readonly point: Screen;
    readonly lngLat: { lng: number; lat: number };
    /** Der Zeiger in Fensterkoordinaten - dort, wo Menüs und Schilder stehen. */
    readonly screen: Screen;
    /** Die Treffer nach Layer gruppiert, je Gruppe von oben nach unten. Ein Layer ohne Treffer fehlt. */
    readonly byLayer: ReadonlyMap<string, readonly MapGeoJSONFeature[]>;
    /** Die Treffer dieser Layer in der Reihenfolge der Abfrage (oberster zuerst). */
    features(layers: readonly string[]): MapGeoJSONFeature[];
    /**
     * Eine zweite Frage mit Spiel: die Layer in einem Quadrat von `reach` Bildpunkten um den Zeiger. Nur für
     * dünne Linien nötig (Flüsse), die der Zeiger sonst verfehlt; ein Besitzer, der sie nicht braucht, spart sie.
     */
    query(layers: readonly string[], reach: number): MapGeoJSONFeature[];
    /** Ein jüngeres Ereignis hat dieses überholt oder die Geste ist vorbei: laufende Arbeit abbrechen. */
    readonly signal: AbortSignal;
}

/** Warum ein Besitzer die Zeigerhoheit verliert. */
export type LostReason =
    /** Das Zeigen endete: der Zeiger ging weg, gehört jetzt einem anderen, die Karte bewegt sich, ein Klick kam. */
    | "hover-ended"
    /** Eine Geste mit höherem Rang hat den Zeiger erfasst (`capture`). */
    | "preempted";

/**
 * Wer Ereignisse der Karte beansprucht. `C` ist, was `hit` findet und `apply` bekommt.
 */
export interface InteractionOwner<C extends Claim = Claim> {
    /** Eindeutig; steht in `INTERACTION_PRIORITY`. */
    readonly id: string;
    /** Aus `INTERACTION_PRIORITY`, nie eine eigene Zahl. */
    readonly priority: number;
    readonly kinds: readonly InteractionKind[];
    /** Die Layer, die dieser Besitzer sehen will - jedes Mal neu gelesen, denn der Stil wechselt. */
    layers(): readonly string[];
    /** Aus: Der Besitzer nimmt an keinem Ereignis teil. Ohne Angabe: an. */
    enabled?(): boolean;
    /**
     * Beansprucht dieser Besitzer das Ereignis? Ein Treffer gewinnt, wenn kein Besitzer mit höherem Rang einen
     * hat. Ein Versprechen (`Promise`) ist erlaubt, etwa für eine Frage an den Server: Es gilt nur, solange
     * `context.signal` nicht abgebrochen ist, und es hält die Besitzer mit niedrigerem Rang auf.
     * 🔴 Für `press` synchron: Nur dann greift `preventDefault` noch.
     */
    hit(context: HitContext): C | undefined | Promise<C | undefined>;
    /** Der Besitzer hat gewonnen: tun, was das Ereignis verlangt. */
    apply(kind: InteractionKind, claim: C, context: HitContext): void;
    /**
     * Nur bei Objekten auf der Karte (Ort, Gipfel, Route, Kraftlinie, Weg, Fläche): Nimmt ein offenes Editor-Fenster das getroffene
     * Objekt beim Umschalt-Klick zusätzlich auf (WI-0209)? `true`: aufgenommen, `apply` entfällt. `false`: Der Klick fällt durch zum
     * nächsten Objekt darunter; nimmt keins auf, wählt er das oberste wie ein gewöhnlicher Klick (Editor-Orchestrierung 2026-10-20 „A“).
     */
    umschalt?(claim: C, context: HitContext): boolean;
    /** Die Zeigerhoheit ist weg: flüchtige Anzeigen (Schild, Vorschau) zurücknehmen. */
    lost?(reason: LostReason): void;
}

/** Was ein Beobachter eines Klicks erfährt. */
export interface ClickInfo {
    /**
     * Wer den Klick schon hat, wenn die synchronen Besitzer durch sind. `undefined`, wenn keiner von ihnen ihn
     * beansprucht - ein asynchroner Besitzer (Serverfrage) kann ihn danach noch bekommen.
     */
    claimedBy: string | undefined;
    /** Mit gedrückter Umschalttaste (WI-0252): Ein solcher Klick nimmt in eine Mehrfachauswahl auf, statt sie aufzuheben. */
    umschalt?: boolean;
}

/** Passive Beobachter: Sie greifen nie ein und entscheiden nichts. */
export interface InteractionObservers {
    /** Jemand fasst die Karte an: Maustaste oder Finger gedrückt, Rad gedreht (vor allen Besitzern). */
    gesture: () => void;
    /** Irgendeine Eingabe auf der Karte: Zeiger bewegt, gedrückt, Rad, Finger. */
    activity: () => void;
    click: (info: ClickInfo) => void;
}

export type ObserverKind = keyof InteractionObservers;

export interface MapInteractionCoordinator {
    /** Einen Besitzer anmelden; gibt die Abmeldung zurück. Eine Id gibt es nur einmal. */
    register(owner: InteractionOwner): () => void;
    /**
     * Die Geste gehört jetzt `id`: kein Zeigen, kein Klick, kein Kontextmenü und kein langer Druck für andere,
     * bis die Rückgabe gerufen wird. Ein langer Druck, der schon läuft, ist damit abgebrochen. Mit `pointerId`
     * endet die Erfassung auch, wenn dieser Zeiger losgelassen oder abgebrochen wird (Sicherung gegen ein
     * verlorenes Loslassen); `cursor` ist die Zeigerform, solange sie gilt.
     *
     * Gibt es die Erfassung nicht, weil eine Geste mit gleichem oder höherem Rang den Zeiger hält, kommt
     * `undefined` zurück. Eine Geste mit höherem Rang verdrängt die laufende (deren Besitzer bekommt `lost`).
     */
    capture(id: string, pointerId?: number, cursor?: string): (() => void) | undefined;
    /** Wer den Zeiger gerade hält, oder `undefined`. */
    captured(): string | undefined;
    observe<K extends ObserverKind>(kind: K, listener: InteractionObservers[K]): () => void;
    /**
     * Das Zeigen ruhen lassen (etwa solange ein Menü offen ist): Was gerade gezeigt wird, geht weg, neues Zeigen
     * kommt nicht. Mit `owners` ruht nur das Zeigen dieser Besitzer, sonst das aller. Klicks bleiben unberührt.
     * Gibt die Fortsetzung zurück.
     */
    suspendHover(reason: string, owners?: readonly string[]): () => void;
    /** Alles abmelden. Danach tut jeder Aufruf nichts. */
    destroy(): void;
}
