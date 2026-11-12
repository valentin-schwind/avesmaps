import { DESIGN_CANON } from "@avesmaps3d/shared";
import { Marker, type Map as MapLibreMap } from "maplibre-gl";
import { h, render } from "vue";

import { mapTooltipOptions, mapTooltipViewport } from "./map-tooltip";
import { arrangeLabels, type LabelSpot } from "./route-border-label-placement";
import RouteBorderLabel from "./route-border-label.vue";

export interface RouteBorderLabelSpot {
    lngLat: [number, number];
    from: string;
    to: string;
}

export interface RouteBorderLabels {
    show(spots: readonly RouteBorderLabelSpot[]): void;
    /** Ein gewählter Übertritt (Klick in der Liste) hat Vorrang vor der Reihenfolge der Reise; `null` hebt ihn auf. */
    prefer(lngLat: readonly [number, number] | null): void;
    clear(): void;
}

interface Placed {
    marker: Marker;
    element: HTMLElement;
    lngLat: readonly [number, number];
}

/** Wie lange ein Schild ausblendet, bevor sein Marker verschwindet: so lange wie der Übergang (`route-border-label.vue`). */
const FADE_OUT_MS = 110;

const reducedMotion = (): boolean => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

const sameSpot = (a: readonly [number, number], b: readonly [number, number]): boolean =>
    Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/**
 * Die Namensschilder der Grenzübertritte (Betreiber 2026-10-03): Solange das Häkchen „auf der Karte zeigen“ an ist,
 * steht an jeder Marke „Reich → Reich“ mit der Zeile „Landesgrenze“, ohne Zeigen oder Tippen. Es geht mit den Marken,
 * also mit der Route, beim Neuladen und mit dem Häkchen. Ein MapLibre-Marker trägt das Schild: Er folgt Kamera,
 * Neigung und Gelände selbst, die Seite fragt keine Höhen je Bild ab.
 *
 * Der Marker ist ein Punkt ohne Ausdehnung (Anker `center`); an ihm hängt das Schild auf einer von vier Seiten, damit
 * sich die Schilder nicht überdecken, und wo das nicht geht, bleibt das mit dem niedrigeren Rang weg
 * (`route-border-label-placement.ts`, Guide §15.3). Gerechnet wird, wenn die Schilder erscheinen, nach jeder
 * Kamerabewegung und bei geänderter Größe, nie während sie läuft: Das Schild wechselt die Seite nicht unter dem Finger.
 *
 * Schilder blenden kurz ein und aus (CSS am Schild). Ein Schild, das mit dem Häkchen oder der Route geht, blendet erst
 * aus und verschwindet dann; bei reduzierter Bewegung geht es sofort.
 */
export function createRouteBorderLabels(map: MapLibreMap): RouteBorderLabels {
    const markerRadius = DESIGN_CANON.route.crossingMarker.rim;
    let placed: Placed[] = [];
    let frame = 0;
    let preferred: readonly [number, number] | null = null;
    let spotsKey = "";
    let routeKey = "";

    const labelOf = (entry: Placed): HTMLElement => entry.element.firstElementChild as HTMLElement;

    const layout = (): void => {
        if (placed.length === 0) return;
        const canvas = map.getCanvas().getBoundingClientRect();
        // Was ein Panel deckt (der offene Planer), ist kein Platz für ein Schild: Es steht dort unsichtbar.
        const viewport = mapTooltipViewport({
            left: canvas.left,
            top: canvas.top,
            width: canvas.width,
            height: canvas.height,
        });
        const spots: LabelSpot[] = placed.map((entry) => {
            const point = entry.element.getBoundingClientRect();
            const size = labelOf(entry).getBoundingClientRect();
            return { x: point.left, y: point.top, width: size.width, height: size.height };
        });
        // Der Rang: ein gewählter Übertritt zuerst, dann die Reihenfolge der Reise.
        const wanted = preferred;
        const chosen = wanted ? placed.findIndex((entry) => sameSpot(entry.lngLat, wanted)) : -1;
        const { sides, visible } = arrangeLabels(
            spots,
            mapTooltipOptions(viewport, markerRadius),
            chosen >= 0 ? [chosen] : undefined,
        );
        placed.forEach((entry, index) => {
            const label = labelOf(entry);
            label.dataset["dir"] = sides[index]!;
            label.toggleAttribute("data-hidden", !visible[index]);
            label.setAttribute("aria-hidden", visible[index] ? "false" : "true");
        });
    };

    const schedule = (): void => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            layout();
        });
    };

    /** Die Schilder gehen lassen: erst ausblenden, dann den Marker abbauen (sofort bei reduzierter Bewegung). */
    const retire = (entries: readonly Placed[]): void => {
        const remove = (): void => {
            for (const entry of entries) {
                render(null, entry.element);
                entry.marker.remove();
            }
        };
        if (entries.length === 0) return;
        if (reducedMotion()) {
            remove();
            return;
        }
        for (const entry of entries) {
            const label = labelOf(entry);
            // Es zählt nicht mehr als Schild der Route; die Platzierung kennt es nicht mehr.
            label.removeAttribute("data-testid");
            label.setAttribute("aria-hidden", "true");
            label.setAttribute("data-hidden", "");
        }
        setTimeout(remove, FADE_OUT_MS + 30);
    };

    const clear = (): void => {
        map.off("moveend", schedule);
        map.off("resize", schedule);
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        retire(placed);
        placed = [];
    };

    return {
        show(spots) {
            // Eine andere Route (andere Marken) hebt die Wahl auf.
            const route = spots.map((spot) => spot.lngLat.join(",")).join(";");
            if (route !== routeKey) preferred = null;
            routeKey = route;
            // Dieselben Schilder noch einmal gemeldet (die Route wird nur nachgeführt): stehen lassen, nicht neu einblenden.
            const key = spots.map((spot) => `${spot.lngLat.join(",")}|${spot.from}|${spot.to}`).join(";");
            if (key === spotsKey && placed.length > 0) {
                schedule();
                return;
            }
            spotsKey = key;
            clear();
            placed = spots.map((spot) => {
                const element = document.createElement("div");
                // Das Schild nimmt der Karte keinen Zeiger weg: Ziehen und Klicken gehen durch.
                element.style.pointerEvents = "none";
                render(h(RouteBorderLabel, { from: spot.from, to: spot.to }), element);
                const marker = new Marker({ element, anchor: "center" }).setLngLat(spot.lngLat).addTo(map);
                return { marker, element, lngLat: spot.lngLat };
            });
            layout();
            map.on("moveend", schedule);
            map.on("resize", schedule);
            // Die Schrift ist zum ersten Bild geladen; ein zweiter Durchgang fängt ein Nachladen ab.
            schedule();
        },
        prefer(lngLat) {
            preferred = lngLat;
            schedule();
        },
        clear() {
            spotsKey = "";
            clear();
        },
    };
}
