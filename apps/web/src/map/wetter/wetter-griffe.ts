import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import { WETTER_SYMBOL_GRENZEN, wetterGradAusBogen } from "@avesmaps3d/shared";
import { INTERACTION_PRIORITY } from "../interaction/priorities";
import type { Claim, HitContext, InteractionOwner, MapInteractionCoordinator } from "../interaction/types";
import type { WetterKamera } from "./wetter-kamera";
import type { WetterEditorAnschluss, WetterZug } from "./wetter-schalter";
import { EBENE_Y, PFEIL_JE_STAERKE, type Symbolebene, type Treffer, type WetterSymbol } from "./wetter-symbole";

/**
 * Die Griffe der Wetter-Icons auf der Karte (WI-0288 Stufe 3; Probierseite: „Scheibe verschiebt, Pfeilspitze setzt Richtung und Stärke,
 * Ringgriff die Reichweite“): der Besitzer `wetter-icon` im Koordinator, nur angemeldet, solange das Fenster des Wetter-Editors offen ist.
 *
 * - **Klick** auf ein Icon wählt es im Editor (auch ohne Schreibrecht); er fällt nicht auf einen Ort darunter durch.
 * - **Druck und Ziehen** (mit Schreibrecht): an der Scheibe die Lage, an der Pfeilspitze des gewählten Richtung und Stärke, an seinem Ring
 *   die Reichweite. Während des Zugs fragt nichts den Server; der Editor bekommt jeden Schritt (`ziehe`, `fertig: false`) und speichert beim
 *   Loslassen (`fertig: true`, entprellt wie jede Änderung). Erst ab `ZUG_AB_PX` ist ein Druck ein Zug; ein Klick bleibt ein Klick.
 * - Ein zweiter Finger oder eine stärkere Geste (`lost`) bricht ab und stellt das Icon zurück.
 * - **Aussehen wie das Geometrie-Modul:** Während des Zugs trägt das Icon Knallrot und der gefasste Griff ist größer (`Symbolebene.zieht`, EDIT-0003
 *   G9); Esc bricht den Zug ab (Probierstand §3a: „Esc während eines Zugs bricht nur den Zug ab“).
 * - 🪤 Kein Geometrie-Modul (`map/geometrie/`): Dort ist jeder Zug ein Entwurf mit „Fertig“ (EDIT-0003 G4); das Wetter speichert sofort
 *   (Betreiber 2026-11-07). Dazu liegen die Icons nicht in Karteneinheiten der Karte, sondern auf der Ebene der Wetterrechnung (eigene Kamera,
 *   `wetter-kamera.ts`, über dem Meer statt auf dem Gelände), und Pfeilspitze und Ring setzen zwei Werte, die kein Punkt einer Form sind. Mit der
 *   Editor-Orchestrierung abzustimmen, bevor es auf `origin` geht (WI-0288 „Stand“).
 */

export const ZUG_AB_PX = 3;

type Anspruch = Claim & { readonly treffer: Treffer };

const klemme = (wert: number, min: number, max: number): number => Math.min(max, Math.max(min, wert));
const rund = (wert: number, stellen: number): number => Math.round(wert * 10 ** stellen) / 10 ** stellen;

/** Der Zug in der Form der Daten (Grad nach der Windrose, gerundet), aus dem Icon in der Form der Engine. */
export function zugAus(symbol: WetterSymbol, griff: Treffer["griff"]): WetterZug {
    if (griff === "ort") return { x: rund(symbol.x, 1), z: rund(symbol.z, 1) };
    if (griff === "ring") return { reichweite: rund(symbol.r, 0) };
    const grad = Math.round(wetterGradAusBogen(symbol.dir)) % 360;
    return { richtung: grad, staerke: rund(symbol.s, 1) };
}

/** Wohin ein Zug das Icon bringt: `start` ist das Icon beim Druck, `anfang` und `jetzt` die Stellen des Zeigers auf der Ebene. */
export function gezogen(
    start: WetterSymbol,
    griff: Treffer["griff"],
    anfang: { x: number; z: number },
    jetzt: { x: number; z: number },
): Partial<WetterSymbol> {
    const g = WETTER_SYMBOL_GRENZEN;
    if (griff === "ort")
        return {
            x: klemme(start.x + jetzt.x - anfang.x, g.x.min, g.x.max),
            z: klemme(start.z + jetzt.z - anfang.z, g.z.min, g.z.max),
        };
    const dx = jetzt.x - start.x;
    const dz = jetzt.z - start.z;
    if (griff === "ring") return { r: klemme(Math.hypot(dx, dz), g.reichweite.min, g.reichweite.max) };
    return {
        dir: Math.atan2(dz, dx),
        s: klemme(Math.hypot(dx, dz) / PFEIL_JE_STAERKE, g.staerke.min, g.staerke.max),
    };
}

function istHauptdruck(event: MapMouseEvent | MapTouchEvent): boolean {
    const original = event.originalEvent;
    if ("touches" in original) return original.touches.length === 1;
    return original.button === 0 && !original.ctrlKey && !original.metaKey;
}

export function installWetterGriffe(
    map: MapLibreMap,
    interaction: MapInteractionCoordinator,
    symbole: Symbolebene,
    kamera: WetterKamera,
    anschluss: () => WetterEditorAnschluss | undefined,
): () => void {
    let zug:
        | {
              readonly id: string;
              readonly griff: Treffer["griff"];
              readonly start: WetterSymbol;
              readonly druck: { x: number; y: number };
              readonly anfang: { x: number; z: number };
              readonly release: () => void;
              laeuft: boolean;
          }
        | undefined;

    // Während eines Zugs markiert der Browser keinen Text (vorher färbte ein Zug über das Fenster Zeilen der Liste ein), und Esc bricht
    // ihn ab: Das Icon springt zurück, gespeichert wird nichts.
    const keineAuswahl = (event: Event): void => event.preventDefault();
    const taste = (event: KeyboardEvent): void => {
        if (event.key !== "Escape" || zug === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        abbrechen();
    };
    const ende = (): void => {
        zug?.release();
        if (zug?.laeuft === true) symbole.zieht(undefined);
        zug = undefined;
        globalThis.removeEventListener("mouseup", los);
        globalThis.removeEventListener("selectstart", keineAuswahl);
        globalThis.removeEventListener("keydown", taste, true);
    };
    function abbrechen(): void {
        const laufend = zug;
        if (laufend === undefined) return;
        if (laufend.laeuft) {
            symbole.aendere(laufend.id, laufend.start);
            anschluss()?.ziehe(laufend.id, zugAus(laufend.start, laufend.griff), false);
        }
        ende();
    }
    function los(): void {
        const laufend = zug;
        if (laufend === undefined) return;
        const jetzt = symbole.daten(laufend.id);
        if (laufend.laeuft && jetzt !== undefined) anschluss()?.ziehe(laufend.id, zugAus(jetzt, laufend.griff), true);
        ende();
    }
    const bewege = (event: MapMouseEvent | MapTouchEvent): void => {
        const laufend = zug;
        if (laufend === undefined) return;
        const original = event.originalEvent;
        if ("touches" in original && original.touches.length > 1) {
            abbrechen();
            return;
        }
        const { x, y } = event.point;
        if (!laufend.laeuft) {
            if (Math.hypot(x - laufend.druck.x, y - laufend.druck.y) < ZUG_AB_PX) return;
            laufend.laeuft = true;
            // Ab jetzt wird bearbeitet: Knallrot, der gefasste Griff größer (wie im Geometrie-Modul).
            symbole.zieht(laufend.id, laufend.griff);
        }
        const jetzt = kamera.aufEbene(x, y, EBENE_Y);
        if (jetzt === null) return;
        const aenderung = gezogen(laufend.start, laufend.griff, laufend.anfang, jetzt);
        symbole.aendere(laufend.id, aenderung);
        const neu = symbole.daten(laufend.id);
        if (neu !== undefined) anschluss()?.ziehe(laufend.id, zugAus(neu, laufend.griff), false);
    };

    const owner: InteractionOwner<Anspruch> = {
        id: "wetter-icon",
        priority: INTERACTION_PRIORITY["wetter-icon"],
        kinds: ["press", "hover", "click"],
        layers: () => [],
        enabled: () => anschluss() !== undefined,
        hit(context: HitContext): Anspruch | undefined {
            if (context.kind === "press" && !istHauptdruck(context.event)) return undefined;
            const treffer = symbole.treffer(context.point.x, context.point.y);
            if (treffer === undefined) return undefined;
            const darf = anschluss()?.darf === true;
            // Ohne Schreibrecht nimmt die Ebene nur den Klick (wählen); Druck und Zeigen bleiben der Karte.
            if (!darf && context.kind !== "click") return undefined;
            return { cursor: context.kind === "press" ? "grabbing" : "grab", treffer };
        },
        apply(kind, anspruch, context) {
            const verbunden = anschluss();
            if (verbunden === undefined) return;
            if (kind === "click") {
                verbunden.waehle(anspruch.treffer.id);
                return;
            }
            if (kind !== "press" || zug !== undefined || !verbunden.darf) return;
            const start = symbole.daten(anspruch.treffer.id);
            const anfang = kamera.aufEbene(context.point.x, context.point.y, EBENE_Y);
            if (start === undefined || anfang === null) return;
            const release = interaction.capture("wetter-icon", undefined, "grabbing");
            if (!release) return;
            context.event.preventDefault();
            if (verbunden.gewaehlt !== start.id) verbunden.waehle(start.id);
            zug = {
                id: start.id,
                griff: anspruch.treffer.griff,
                start: { ...start },
                druck: { x: context.point.x, y: context.point.y },
                anfang,
                release,
                laeuft: false,
            };
            // 🪤 Losgelassen über einem Fenster oder außerhalb: Die Karte meldet dann kein `mouseup`.
            globalThis.addEventListener("mouseup", los);
            globalThis.addEventListener("selectstart", keineAuswahl);
            globalThis.addEventListener("keydown", taste, true);
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
    return () => {
        abbrechen();
        ab();
        map.off("mousemove", bewege);
        map.off("touchmove", bewege);
        map.off("mouseup", los);
        map.off("touchend", los);
        map.off("touchcancel", abbrechen);
    };
}
