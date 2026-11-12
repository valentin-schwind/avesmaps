import type { ViewerContext } from "@avesmaps3d/shared";
import type { Camera } from "../map/camera/camera";
import { characterShortcutsOff } from "./keyboard-settings";
import {
    isCharacterKey,
    KEY_STEP,
    matchShortcut,
    shortcutsFor,
    type KeyPress,
    type ShortcutAction,
    type ShortcutRow,
} from "./shortcuts";

/**
 * Die Tastatur der Karte (WI-0016, Spez. § 5): ein Zuhörer am Dokument, die Tafel entscheidet.
 *
 * ⭐ Die Tasten wirken ab dem Laden, ohne erst in die Karte zu klicken — wie in Legacy, das genau
 * deshalb Leaflets eigene Tastatur abgeschaltet hat. MapLibres Tastatur ist aus demselben Grund aus
 * (`cameraMapOptions`): sie wirkte nur mit Kartenfokus und hätte jeden Schritt doppelt gemacht.
 *
 * 🔴 Gesperrt, solange jemand schreibt oder ein Fenster offen ist; die Leertaste gehört einem
 * fokussierten Knopf, nicht der Suche (Legacy-Regeln).
 */

export interface KeyboardTargets {
    /** Wer tippt: Die Leertaste öffnet für einen Besucher die Suche, für einen Editor fixiert sie die Auswahl (WI-0063 4.11). */
    viewer: ViewerContext;
    camera: () => Camera | undefined;
    openSearch: () => void;
    /** Editor: die Auswahl lokal fixieren oder lösen (Leertaste). */
    pinSelection: () => void;
    openHelp: () => void;
    /** Die n-te Ortsklasse im Auge-Menü, wie ein Klick darauf (WI-0028). */
    choosePlaces: (tier: number) => void;
    /** Der Routenplaner (WI-0017): Ziel anhängen, Routenart, Etappen blättern. */
    planner: {
        addDestination: () => void;
        optimize: (kind: "fastest" | "shortest") => void;
        stepStage: (step: 1 | -1) => void;
    };
    /** Escape: die geordnete Kaskade von innen nach außen (WI-0063 4.10, `escape-cascade.ts`). */
    escape: () => void;
}

/** Wo der Fokus steht und ob ein Fenster offen ist — die Umgebung eines Tastendrucks. */
export interface KeyContext {
    /** Der Fokus liegt in einem Feld, in das man schreibt. */
    typing: boolean;
    /** Ein Fenster (Dialog) ist offen und riegelt die Karte ab. */
    dialogOpen: boolean;
    /** Der Fokus liegt auf etwas, das die Leertaste selbst auslöst (Knopf, Link, Kästchen). */
    activatable: boolean;
    /** „Tastenkürzel aus" ist eingeschaltet. */
    charactersOff: boolean;
}

/** Soll die Karte diesen Tastendruck ausführen, und wenn ja, welchen? Ohne Tafel gilt die des Besuchers. */
export function actionFor(
    press: KeyPress,
    context: KeyContext,
    rows?: readonly ShortcutRow[],
): ShortcutAction | undefined {
    if (context.typing || context.dialogOpen) {
        return undefined;
    }
    const row = matchShortcut(press, rows);
    if (!row) {
        return undefined;
    }
    if (context.charactersOff && isCharacterKey(press.key)) {
        return undefined;
    }
    if (press.key === " " && context.activatable) {
        return undefined;
    }
    return row.action;
}

/**
 * Riegelt ein offenes Werkzeugfenster diesen Tastendruck? Nur solange der Fokus in ihm steht (WI-0128 E6, D14), und nicht in der Leiste
 * eines Modus, die unten im angedockten Fenster steht (EDIT-0003 T45 (3)): Escape aus ihr (etwa nach einem Klick auf ↶) gilt dem Modus,
 * wie über der Karte. `avm-fenster.vue` gibt es dafür schon weiter; ohne diese Ausnahme fing der Riegel es danach ab (WI-0238).
 */
export function fensterRiegelt(target: Pick<Element, "closest"> | null): boolean {
    return target?.closest("dialog[open]") != null && target.closest("[data-modusleiste-ziel]") == null;
}

function keyContext(event: KeyboardEvent): KeyContext {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const typing =
        target !== null && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    const activatable =
        target !== null &&
        (["BUTTON", "A", "SUMMARY"].includes(target.tagName) || target.getAttribute("role") === "button");
    // Ein offenes Fenster riegelt, wie in Legacy: der modale Dialog und die Suchkachel. Ein Werkzeugfenster ist nicht modal (WI-0128 E6,
    // D14) und riegelt nur, solange der Fokus in ihm steht; sonst bliebe Escape für den Verschiebemodus der Karte stumm (E12, T12.6).
    const dialogOpen =
        document.querySelector('dialog:modal, [role="dialog"][aria-modal="true"]') !== null || fensterRiegelt(target);
    return { typing, dialogOpen, activatable, charactersOff: characterShortcutsOff.value };
}

function run(action: ShortcutAction, targets: KeyboardTargets, press: KeyPress): void {
    if (action === "placeTier") {
        targets.choosePlaces(Number(press.key));
        return;
    }
    if (action === "search") {
        targets.openSearch();
        return;
    }
    if (action === "help") {
        targets.openHelp();
        return;
    }
    if (action === "escape") {
        targets.escape();
        return;
    }
    if (action === "pinSelection") {
        targets.pinSelection();
        return;
    }
    switch (action) {
        case "addDestination":
            return targets.planner.addDestination();
        case "fastestRoute":
            return targets.planner.optimize("fastest");
        case "shortestRoute":
            return targets.planner.optimize("shortest");
        case "previousStage":
            return targets.planner.stepStage(-1);
        case "nextStage":
            return targets.planner.stepStage(1);
    }
    const camera = targets.camera();
    if (!camera) {
        return;
    }
    const { panPixels, rotateDegrees, tiltDegrees } = KEY_STEP;
    switch (action) {
        case "panUp":
            return camera.panBy(0, -panPixels);
        case "panDown":
            return camera.panBy(0, panPixels);
        case "panLeft":
            return camera.panBy(-panPixels, 0);
        case "panRight":
            return camera.panBy(panPixels, 0);
        case "rotateLeft":
            return camera.rotateBy(-rotateDegrees);
        case "rotateRight":
            return camera.rotateBy(rotateDegrees);
        case "tiltUp":
            return camera.tiltBy(tiltDegrees);
        case "tiltDown":
            return camera.tiltBy(-tiltDegrees);
        case "zoomIn":
            return camera.zoomBy(1);
        case "zoomOut":
            return camera.zoomBy(-1);
        case "resetView":
            return camera.resetAll();
    }
}

export function installKeyboard(targets: KeyboardTargets): () => void {
    const rows = shortcutsFor(targets.viewer);
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.defaultPrevented) {
            return;
        }
        // 💣 Nicht `{ ...event }`: key, ctrlKey usw. sind Getter am Prototyp und würden beim
        // Spreizen still zu undefined - die Tasten wirkten dann nie, ohne Fehler.
        const press: KeyPress = {
            key: event.key,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
        };
        const action = actionFor(press, keyContext(event), rows);
        if (!action) {
            return;
        }
        event.preventDefault();
        run(action, targets, press);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
}
