import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import { GEOMETRIE_ANFASSER_TREFFER, GEOMETRIE_KANTE_TREFFER } from "../map/geometrie/schicht";
import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, HitContext, InteractionOwner, MapInteractionCoordinator } from "../map/interaction/types";

/**
 * „↕ Höhe ziehen“ im Kammeditor (WI-0249 P9; Betreiber 2026-10-24: „der toggle button zum einstellen der höhe (rauf runter) kann den cursor
 * so verändern, dass die hoch-runter-bewegung auf der map die höhe einstellt“): der Besitzer `height-drag` im Koordinator, nur angemeldet,
 * solange der Knopf gedrückt ist.
 *
 * - **Nur über einem Punkt oder Kamm** (Betreiber 2026-10-25: „wenn man ins leere klickt … die ansicht bewegen … nur wenn man AUF die
 *   gipfel/kämme klickt, soll sich die höhe verändern“): Über einem Anfasser (Kammpunkt, Nebengipfel, Mulde) oder der Kante eines Kamms zeigt
 *   der Zeiger `ns-resize`, und ein Druck dort gehört dem Modus; über leerer Karte bleibt alles der Karte (Verschieben, Zeiger).
 * - **Ziehen** nach oben hebt, nach unten senkt: auf einem Punkt dessen Höhe, auf einer Kante die des ganzen Kamms; liegt das Ziel in der
 *   Auswahl, alle gewählten um denselben Betrag (der Aufrufer entscheidet in `beginne`). 10 Schritt je Bildpunkt, mit Alt 1 Schritt (Umschalt
 *   gehört der Mehrfachauswahl). Gezählt wird je Bewegung, ein Wechsel von Alt mitten im Zug wirkt ab da.
 * - Erst ab `ZUG_AB_PX` Bildpunkten ist ein Druck ein Zug; ein Klick ohne Bewegung bleibt ein Klick und wählt über `geometry-edit` darunter.
 * - **Loslassen** schließt ab (EIN Schritt im Entwurf, `ende`); Esc (über `abbrechen` des Kammeditors), ein zweiter Finger oder eine stärkere
 *   Geste brechen ab und stellen den Wert davor her.
 * - Zwei Finger, Strg (gehört dem Modus, `map/geometrie/besitzer.ts`) und andere Tasten als die linke beansprucht er nicht.
 */

/** Was unter dem Zeiger liegt: ein Stützpunkt, Nebengipfel oder eine Mulde (mit `index`), oder die Kante eines Kamms (ohne). */
export interface ZugZiel {
    readonly nr: number;
    readonly index?: number | undefined;
}

/** Schritt je Bildpunkt beim Ziehen (Vorgabe des Auftrags; 3.000 Schritt Kammhöhe sind 300 Bildpunkte). */
export const HOEHE_JE_PIXEL = 10;
/** Mit Alt: fein, 1 Schritt je Bildpunkt. */
export const HOEHE_JE_PIXEL_FEIN = 1;
/** Ab dieser Strecke ist ein Druck ein Zug (wie beim Ziehen der Anfasser). */
export const ZUG_AB_PX = 3;

export interface HoehenZiehenEingabe {
    /** Das Ziel unter dem Zeiger: der Punkt, dessen Anfasser dort liegt, sonst der Kamm, dessen Kante dort liegt, sonst keins (die Karte bleibt frei). */
    zielUnter(
        anfasser: { properties: Record<string, unknown> } | undefined,
        kante: { properties: Record<string, unknown> } | undefined,
    ): ZugZiel | undefined;
    /** Der Zug beginnt (erste Bewegung): `false`, wenn es nichts zu ziehen gibt. */
    beginne(ziel: ZugZiel): boolean;
    /** Der Betrag in Schritt seit Beginn des Zugs, nach oben positiv. */
    folge(betrag: number): void;
    /** Losgelassen. */
    ende(): void;
    /** Abgebrochen: der Wert davor. */
    abbrechen(): void;
}

export interface HoehenZiehen {
    /** Bricht einen laufenden Zug ab (Esc); `true`, wenn einer lief. */
    abbrechen(): boolean;
    aus(): void;
}

type Anspruch = Claim & { readonly ziel?: ZugZiel | undefined };

function istHauptdruck(event: MapMouseEvent | MapTouchEvent): boolean {
    const original = event.originalEvent;
    if ("touches" in original) return original.touches.length === 1;
    return original.button === 0 && !original.ctrlKey && !original.metaKey;
}

export function installHoehenZiehen(
    map: MapLibreMap,
    interaction: MapInteractionCoordinator,
    eingabe: HoehenZiehenEingabe,
): HoehenZiehen {
    let zug:
        | {
              readonly release: () => void;
              readonly start: { x: number; y: number };
              readonly ziel: ZugZiel;
              letzteY: number;
              betrag: number;
              laeuft: boolean;
              tot: boolean;
          }
        | undefined;

    const schluss = (): void => {
        const laufend = zug;
        zug = undefined;
        laufend?.release();
        globalThis.removeEventListener("mouseup", los);
    };
    function los(): void {
        const laufend = zug;
        if (laufend === undefined) return;
        schluss();
        if (laufend.laeuft) eingabe.ende();
    }
    const abbrechen = (): boolean => {
        const laufend = zug;
        if (laufend === undefined) return false;
        schluss();
        if (laufend.laeuft) eingabe.abbrechen();
        return laufend.laeuft;
    };
    const bewege = (event: MapMouseEvent | MapTouchEvent): void => {
        const laufend = zug;
        if (laufend === undefined || laufend.tot) return;
        const original = event.originalEvent;
        // Ein zweiter Finger: Die Karte bekommt die Geste zurück, der Zug geht ungeschehen.
        if ("touches" in original && original.touches.length > 1) {
            abbrechen();
            return;
        }
        const { x, y } = event.point;
        if (!laufend.laeuft) {
            if (Math.hypot(x - laufend.start.x, y - laufend.start.y) < ZUG_AB_PX) return;
            laufend.laeuft = eingabe.beginne(laufend.ziel);
            if (!laufend.laeuft) {
                laufend.tot = true;
                return;
            }
        }
        const fein = "altKey" in original && original.altKey;
        laufend.betrag += (laufend.letzteY - y) * (fein ? HOEHE_JE_PIXEL_FEIN : HOEHE_JE_PIXEL);
        laufend.letzteY = y;
        eingabe.folge(Math.round(laufend.betrag));
    };

    const anfasser = (): string[] =>
        map.getLayer(GEOMETRIE_ANFASSER_TREFFER) === undefined ? [] : [GEOMETRIE_ANFASSER_TREFFER];
    const kanten = (): string[] =>
        map.getLayer(GEOMETRIE_KANTE_TREFFER) === undefined ? [] : [GEOMETRIE_KANTE_TREFFER];
    const owner: InteractionOwner<Anspruch> = {
        id: "height-drag",
        priority: INTERACTION_PRIORITY["height-drag"],
        kinds: ["press", "hover"],
        layers: () => [...anfasser(), ...kanten()],
        hit(context: HitContext): Anspruch | undefined {
            if (context.kind !== "hover" && (context.kind !== "press" || !istHauptdruck(context.event)))
                return undefined;
            // Nur über einem Punkt oder einem Kamm: Über leerer Karte gehört alles der Karte.
            const ziel = eingabe.zielUnter(context.features(anfasser())[0], context.features(kanten())[0]);
            if (ziel === undefined) return undefined;
            return context.kind === "hover" ? { cursor: "ns-resize" } : { cursor: "ns-resize", ziel };
        },
        apply(kind, anspruch, context) {
            if (kind !== "press" || zug !== undefined || anspruch.ziel === undefined) return;
            const release = interaction.capture("height-drag", undefined, "ns-resize");
            if (!release) return;
            context.event.preventDefault();
            zug = {
                release,
                start: { x: context.point.x, y: context.point.y },
                ziel: anspruch.ziel,
                letzteY: context.point.y,
                betrag: 0,
                laeuft: false,
                tot: false,
            };
            // 🪤 Losgelassen über einem Fenster oder außerhalb: Die Karte meldet dann kein `mouseup`.
            globalThis.addEventListener("mouseup", los);
        },
        lost(reason) {
            if (reason === "preempted") abbrechen();
        },
    };
    const ab = interaction.register(owner as InteractionOwner);
    map.on("mousemove", bewege);
    map.on("touchmove", bewege);
    map.on("mouseup", los);
    map.on("touchend", los);
    map.on("touchcancel", abbrechen);
    return {
        abbrechen,
        aus() {
            abbrechen();
            ab();
            map.off("mousemove", bewege);
            map.off("touchmove", bewege);
            map.off("mouseup", los);
            map.off("touchend", los);
            map.off("touchcancel", abbrechen);
        },
    };
}
