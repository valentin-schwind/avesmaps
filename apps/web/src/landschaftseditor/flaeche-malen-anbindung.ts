import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import { h, render, watch } from "vue";
import {
    AVENTURIA,
    SEARCH_FIT_MAX_ZOOM,
    editorLandscapeBrushUrl,
    fromRenderLngLat,
    toRenderLngLat,
    type EditorLandscapeLayer,
    type LandscapeBrushResult,
} from "@avesmaps3d/shared";
import EditorZeichen from "../controls/editor-zeichen.vue";
import { sende } from "../fenster/entwurf-senden";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";
import type { Camera } from "../map/camera/camera";
import { belegeGeometrie, meldeGeometrieAn } from "../map/geometrie/besitzer";
import type { Punkt } from "../map/geometrie/geometrie";
import { zeigeFrei } from "../map/geometrie/kamera";
import { installGeometrieSchicht } from "../map/geometrie/schicht";
import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, InteractionOwner, MapInteractionCoordinator } from "../map/interaction/types";
import { createEckenDaten } from "./ecken-daten";
import { createFlaecheMalen, naechsterRadius, wirksam, type FlaecheMalen, type MalenMeldung } from "./flaeche-malen";
import type { LandschaftBearbeitung } from "./landschaftseditor-steuerung";

/**
 * „Fläche malen“ und „Fläche radieren“ für die Seite (Werkzeug 6): der Modus mit Server, Karte, Kamera und Tasten verbunden, damit `app.vue`
 * nur die Griffe reicht. Wie die Probierseite, Variante A (Betreiber 2026-10-17 „Ja, Alt und Zeichen“):
 *
 * - **Pinselkreis am Zeiger** in einer eigenen Lage über der Leinwand (kein Kartenlayer, er folgt dem Zeiger ohne Kachelarbeit): der Pinsel
 *   durchgezogen in der Markierungsfarbe, der Radierer rot gestrichelt; am Kreis das Zeichen des Werkzeugs, das gerade wirkt (`malen` oder
 *   `radieren` aus `controls/editor-zeichen.vue`). Während des Strichs zeigt dieselbe Lage die Spur, bis die Rechnung zurück ist.
 * - **Ziehen malt:** Der Druck gehört dem Modus (Koordinator, `geometry-edit`), die Karte zieht nicht. **Leertaste halten** gibt das Ziehen
 *   der Karte zurück (nie mitten im Strich); der Kreis ruht solange. **Strg+Mausrad** ändert den Radius, die Karte zoomt dabei nicht.
 *   **Alt halten** gibt das Gegenwerkzeug. **Enter** ist „Fertig“; Strg+Z und Strg+Y nimmt die Seite (`entwurfTasten`), Esc ihre Kaskade.
 * - **Das Fenster trägt den Modus** wie bei „Ecken bearbeiten“: Wird es abgelegt, endet der Modus, der Entwurf bleibt (G5).
 * - **An einer Sprache** (WI-0261 Stufe 2) dieselbe Anbindung: Was den Entwurf trägt und welches Fenster seine Liste einzieht, sagt die Quelle des
 *   Laufs (`lauf.quelle`, `map/geometrie/flaechen-quelle.ts`).
 */
export interface MalenSeite {
    karte():
        { map: MapLibreMap; camera: Pick<Camera, "showBounds">; interaction: MapInteractionCoordinator } | undefined;
    ebenen(): readonly EditorLandscapeLayer[];
    bearbeitung(regionId: string): LandschaftBearbeitung | undefined;
    getragen(regionId: string): boolean;
}

const space = AVENTURIA.coordinateSpace;

export function malenHinweis(meldung: MalenMeldung): { text: string; ton?: "success" | "warning" } {
    switch (meldung.art) {
        case "gespeichert":
            return { text: t("landschaftseditor.malen.gespeichert", { name: meldung.name }), ton: "success" };
        case "grenze":
            return { text: meldung.satz, ton: "warning" };
        case "ohneFlaeche":
            return { text: t("landschaftseditor.malen.ohneFlaeche", { name: meldung.name }), ton: "warning" };
        case "ladefehler":
            return { text: t("landschaftseditor.malen.ladefehler"), ton: "warning" };
    }
}

/** Karteneinheiten je Bildpunkt um diesen Punkt, wie die Karte jetzt steht (waagrecht und senkrecht gemittelt). */
function massstabBei(map: MapLibreMap, mitte: Punkt): number {
    const render = toRenderLngLat(space, mitte);
    const at = map.project([render.lng, render.lat]);
    const weite = (dx: number, dy: number): number => {
        const p = fromRenderLngLat(space, map.unproject([at.x + dx, at.y + dy]));
        return Math.hypot(p.x - mitte.x, p.y - mitte.y);
    };
    return (weite(1, 0) + weite(0, 1)) / 2;
}

const istHauptdruck = (event: MapMouseEvent | MapTouchEvent): boolean => {
    const original = event.originalEvent;
    if ("touches" in original) return original.touches.length === 1;
    return original.button === 0 && !original.ctrlKey && !original.metaKey;
};

/** Die Lage des Pinsels über der Leinwand: Spur, Kreis und Zeichen. */
function installPinselLage(map: MapLibreMap) {
    const huelle = document.createElement("div");
    huelle.className = "pinsel-lage";
    huelle.dataset["testid"] = "pinsel-lage";
    Object.assign(huelle.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        zIndex: "2",
        overflow: "hidden",
    });
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    Object.assign(svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
    const spur = document.createElementNS(ns, "path");
    spur.setAttribute("fill", "none");
    spur.setAttribute("stroke-linecap", "round");
    spur.setAttribute("stroke-linejoin", "round");
    spur.setAttribute("stroke-opacity", "0.35");
    const kreis = document.createElementNS(ns, "circle");
    kreis.setAttribute("fill-opacity", "0.12");
    kreis.setAttribute("stroke-width", "2");
    kreis.dataset["testid"] = "pinsel-kreis";
    svg.append(spur, kreis);
    const zeichen = document.createElement("div");
    zeichen.dataset["testid"] = "pinsel-zeichen";
    Object.assign(zeichen.style, {
        position: "absolute",
        width: "18px",
        height: "18px",
        display: "grid",
        placeItems: "center",
        borderRadius: "50%",
        background: "var(--color-panel, #fffdf9)",
        boxShadow: "0 1px 3px rgba(0,0,0,.35)",
    });
    huelle.append(svg, zeichen);
    map.getCanvasContainer().append(huelle);
    let gezeichnet: string | undefined;
    return {
        zeige(lage: {
            zeiger: { x: number; y: number } | undefined;
            radius: number;
            art: "malen" | "radieren";
            spur: readonly Punkt[];
        }): void {
            const farbe = lage.art === "malen" ? "var(--color-marker-active)" : "var(--color-danger)";
            const pfad = lage.spur
                .map((p, i) => {
                    const render = toRenderLngLat(space, p);
                    const at = map.project([render.lng, render.lat]);
                    return `${i === 0 ? "M" : "L"}${at.x.toFixed(1)} ${at.y.toFixed(1)}`;
                })
                .join(" ");
            spur.setAttribute("d", lage.spur.length === 1 ? `${pfad} l0.01 0` : pfad);
            spur.setAttribute("stroke", farbe);
            spur.setAttribute("stroke-width", String(lage.radius * 2));
            const zu = lage.zeiger === undefined;
            kreis.style.display = zu ? "none" : "";
            zeichen.style.display = zu ? "none" : "grid";
            if (lage.zeiger === undefined) return;
            kreis.setAttribute("cx", String(lage.zeiger.x));
            kreis.setAttribute("cy", String(lage.zeiger.y));
            kreis.setAttribute("r", String(lage.radius));
            kreis.setAttribute("stroke", farbe);
            kreis.setAttribute("fill", farbe);
            kreis.setAttribute("stroke-dasharray", lage.art === "radieren" ? "5 5" : "");
            kreis.dataset["art"] = lage.art;
            // Das Zeichen sitzt oben rechts am Kreis (Variante A); es wechselt mit Alt.
            const d = lage.radius * Math.SQRT1_2;
            zeichen.style.left = `${String(lage.zeiger.x + d - 2)}px`;
            zeichen.style.top = `${String(lage.zeiger.y - d - 16)}px`;
            zeichen.style.color = farbe;
            zeichen.dataset["art"] = lage.art;
            if (gezeichnet !== lage.art) {
                render(h(EditorZeichen, { name: lage.art }), zeichen);
                gezeichnet = lage.art;
            }
        },
        entferne(): void {
            render(null, zeichen);
            huelle.remove();
        },
    };
}

/** Was der laufende Modus auf der Karte hält: Lage, Zeiger, Spur, der laufende Zug und die Leertaste. */
interface Auf {
    readonly map: MapLibreMap;
    readonly lage: ReturnType<typeof installPinselLage>;
    zeiger: { x: number; y: number } | undefined;
    spur: Punkt[];
    zug: { release(): void } | undefined;
    halt: boolean;
}

export function createFlaecheMalenFuerSeite(seite: MalenSeite): FlaecheMalen {
    let auf: Auf | undefined;

    const malen = createFlaecheMalen({
        daten: createEckenDaten(),
        strich: async (regionId, body) => {
            const antwort = await sende<LandscapeBrushResult>(editorLandscapeBrushUrl(regionId), body, "POST");
            return antwort.ok
                ? { ok: true, polygons: antwort.quittung.polygons }
                : { ok: false, satz: antwort.fehler.message };
        },
        ebenen: seite.ebenen,
        bearbeitung: seite.bearbeitung,
        getragen: seite.getragen,
        karte: {
            an(bild) {
                const da = seite.karte();
                if (da === undefined) return undefined;
                const belegung = belegeGeometrie(malen.laufend.value?.quelle.werkzeug);
                if (belegung === undefined) return undefined;
                const { map, interaction } = da;
                const schicht = installGeometrieSchicht(map);
                schicht.zeige(bild());
                const lage = installPinselLage(map);
                const hier: Auf = { map, lage, zeiger: undefined, spur: [], zug: undefined, halt: false };
                auf = hier;
                const owner: InteractionOwner<Claim> = {
                    id: "geometry-edit",
                    priority: INTERACTION_PRIORITY["geometry-edit"],
                    kinds: ["press", "hover"],
                    layers: () => [],
                    hit(context) {
                        if (hier.halt) return undefined;
                        if (context.kind === "press" && (!malen.frei() || !istHauptdruck(context.event)))
                            return undefined;
                        return { cursor: "crosshair" };
                    },
                    apply(kind, _claim, context) {
                        if (kind !== "press" || hier.zug !== undefined) return;
                        const release = interaction.capture("geometry-edit", undefined, "crosshair");
                        if (!release) return;
                        context.event.preventDefault();
                        hier.zug = { release };
                        hier.spur = [fromRenderLngLat(space, context.lngLat)];
                        hier.zeiger = { x: context.point.x, y: context.point.y };
                        zeichne();
                        globalThis.addEventListener("mouseup", los);
                    },
                };
                const anmeldung = meldeGeometrieAn(interaction, owner);
                const bewege = (event: MapMouseEvent | MapTouchEvent): void => {
                    hier.zeiger = { x: event.point.x, y: event.point.y };
                    if (hier.zug !== undefined) hier.spur.push(fromRenderLngLat(space, event.lngLat));
                    zeichne();
                };
                const raus = (): void => {
                    if (hier.zug !== undefined) return;
                    hier.zeiger = undefined;
                    zeichne();
                };
                const neuGezeichnet = (): void => zeichne();
                function los(): void {
                    globalThis.removeEventListener("mouseup", los);
                    const zug = hier.zug;
                    if (zug === undefined) return;
                    hier.zug = undefined;
                    zug.release();
                    const spur = hier.spur;
                    if (spur.length === 0) return;
                    const mitte = spur[Math.floor(spur.length / 2)]!;
                    void malen.strich(spur, massstabBei(map, mitte)).finally(() => {
                        if (auf !== hier) return;
                        hier.spur = [];
                        zeichne();
                    });
                }
                map.on("mousemove", bewege);
                map.on("touchmove", bewege);
                map.on("mouseup", los);
                map.on("touchend", los);
                map.on("mouseout", raus);
                map.on("move", neuGezeichnet);
                return {
                    aktualisiere: () => {
                        schicht.zeige(bild());
                        zeichne();
                    },
                    aus: () => {
                        globalThis.removeEventListener("mouseup", los);
                        hier.zug?.release();
                        hier.zug = undefined;
                        map.off("mousemove", bewege);
                        map.off("touchmove", bewege);
                        map.off("mouseup", los);
                        map.off("touchend", los);
                        map.off("mouseout", raus);
                        map.off("move", neuGezeichnet);
                        anmeldung.ab();
                        lage.entferne();
                        schicht.entferne();
                        belegung.frei();
                        if (auf === hier) auf = undefined;
                    },
                };
            },
            zeige(teile) {
                const da = seite.karte();
                if (da !== undefined) zeigeFrei(da.map, da.camera, teile, SEARCH_FIT_MAX_ZOOM.landschaft);
            },
        },
    });

    function zeichne(): void {
        const lauf = malen.laufend.value;
        if (auf === undefined || lauf?.phase !== "bereit") return;
        auf.lage.zeige({
            // Mit gehaltener Leertaste ruht der Pinsel: kein Kreis, der etwas verspricht, was der nächste Druck nicht tut (Legacy).
            zeiger: auf.halt ? undefined : auf.zeiger,
            radius: lauf.radius,
            art: wirksam(lauf),
            spur: auf.spur,
        });
    }

    const stopZeichnen = watch(malen.laufend, zeichne);
    const stopMeldung = watch(malen.meldung, (meldung) => {
        if (meldung === undefined) return;
        const { text, ton } = malenHinweis(meldung);
        showToast(text, ton);
    });
    const stopTraeger = watch(
        () => {
            const lauf = malen.laufend.value;
            return lauf?.phase !== "bereit" || lauf.quelle.getragen(lauf.id);
        },
        (getragen) => {
            if (!getragen) malen.beende();
        },
    );

    const inEingabe = (event: Event): boolean =>
        Boolean((event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']"));
    function runter(event: KeyboardEvent): void {
        const lauf = malen.laufend.value;
        if (lauf?.phase !== "bereit" || inEingabe(event)) return;
        if (event.key === "Alt") {
            // Nie mitten im Strich: Er gehört dem Werkzeug, mit dem er begann.
            event.preventDefault();
            if (auf?.zug === undefined) malen.gegen(true);
            return;
        }
        if (event.key === " ") {
            event.preventDefault();
            if (auf !== undefined && auf.zug === undefined && !auf.halt) {
                auf.halt = true;
                zeichne();
            }
            return;
        }
        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && lauf.bearbeitung) {
            event.preventDefault();
            void lauf.bearbeitung.fertig();
        }
    }
    function hoch(event: KeyboardEvent): void {
        if (event.key === "Alt") {
            event.preventDefault();
            malen.gegen(false);
        } else if (event.key === " " && auf?.halt) {
            auf.halt = false;
            zeichne();
        }
    }
    function weg(): void {
        malen.gegen(false);
        if (auf?.halt) {
            auf.halt = false;
            zeichne();
        }
    }
    /** Strg+Mausrad: der Radius, nicht der Zoom (vor MapLibre, im Einfangen). */
    function rad(event: WheelEvent): void {
        const lauf = malen.laufend.value;
        if (lauf?.phase !== "bereit" || !(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        malen.setzeRadius(naechsterRadius(lauf.radius, event.deltaY < 0));
    }
    // 🪤 In der Capture-Phase, also vor den Tastenkürzeln (`keyboard/install-keyboard.ts`, auch am Dokument): Die Leertaste ist sonst
    // zugleich ein Kürzel, ohne Recht zum Fixieren „Suche“, mit ihm „Auswahl fixieren“ (`shortcuts.ts`), wie beim Zeichnen einer neuen
    // Fläche (`neue-flaeche-anbindung.ts`, c79e82d29). Abgefangen (`preventDefault`) überspringt das Kürzel sie.
    document.addEventListener("keydown", runter, { capture: true });
    document.addEventListener("keyup", hoch);
    globalThis.addEventListener("blur", weg);
    let radAn: HTMLElement | undefined;
    const stopRad = watch(
        () => malen.laufend.value?.phase === "bereit",
        (bereit) => {
            radAn?.removeEventListener("wheel", rad, { capture: true });
            radAn = undefined;
            const map = seite.karte()?.map;
            if (!bereit || map === undefined) return;
            radAn = map.getCanvasContainer();
            radAn.addEventListener("wheel", rad, { capture: true, passive: false });
        },
    );

    return {
        ...malen,
        destroy() {
            malen.destroy();
            stopZeichnen();
            stopMeldung();
            stopTraeger();
            stopRad();
            radAn?.removeEventListener("wheel", rad, { capture: true });
            document.removeEventListener("keydown", runter, { capture: true });
            document.removeEventListener("keyup", hoch);
            globalThis.removeEventListener("blur", weg);
        },
    };
}
