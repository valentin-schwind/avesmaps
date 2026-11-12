/**
 * Die Tastenkürzel der Karte (WI-0016, Spez. § 5) — nach Legacys Muster EINE Tafel.
 *
 * 💣 Diese Tafel ist die einzige Quelle. Sie ist beides: die Belegung, nach der die Tasten wirken,
 * und die Übersicht unter Hinweise → Bedienung. Wer eine Taste woanders verdrahtet oder die
 * Erklärung von Hand schreibt, baut die Divergenz ein, die Legacys `keyboard-shortcuts.js` verhindert.
 *
 * 🔴 Hinweise → Bedienung ist das Register JEDER Taste (Betreiber 2026-11-09, `AGENTS.md` „Andocken“): Wer eine Taste
 * neu belegt, umbelegt oder freigibt, trägt sie zuerst hier ein und sieht dabei, was sie schon tut. Kartentasten stehen in
 * `ROWS` und wirken von hier; Tasten eines Editor-Modus oder Werkzeugs hören in ihrem Modus selbst und stehen in `TOOL_KEYS`.
 *
 * 🔴 Kein Strg, kein Alt, kein Meta (Legacy-Owner-Entscheid 2026-08-05): diese Kombinationen
 * gehören dem Browser. `matchShortcut` gibt bei jedem dieser Modifier sofort auf.
 *
 * ⭐ W A S D wirken wie die Pfeiltasten, mit Umschalt drehen (A/D, ←/→) und neigen sie (W/S, ↑/↓)
 * (Betreiber 2026-09-23). „Umschalt = schneller schieben" aus Legacy entfällt ersatzlos.
 *
 * 🪤 Mit Umschalt meldet der Browser Großbuchstaben (`W` statt `w`); verglichen wird deshalb klein.
 *
 * Die Übersicht steht in den Sprachtafeln (WI-0032): `label` ist ein Schlüssel, und Tastennamen in
 * `caps` stehen in geschweiften Klammern wie `{shift}` oder `{ctrl}` (`CAP_NAMES`, `capLabel`).
 * Die Tasten selbst (`keys`) werden nie übersetzt.
 */

import type { ViewerContext } from "@avesmaps3d/shared";
import { t, type MessageKey } from "../i18n/i18n";

export type ShortcutAction =
    | "search"
    | "pinSelection"
    | "panUp"
    | "panDown"
    | "panLeft"
    | "panRight"
    | "rotateLeft"
    | "rotateRight"
    | "tiltUp"
    | "tiltDown"
    | "escape"
    | "zoomIn"
    | "zoomOut"
    | "resetView"
    | "placeTier"
    | "addDestination"
    | "fastestRoute"
    | "shortestRoute"
    | "previousStage"
    | "nextStage"
    | "help";

/** Für wen eine Zeile gilt (WI-0063 4.11): `visitor` ohne, `editor` mit der Fähigkeit `pin_selection`. */
export type ShortcutAudience = "visitor" | "editor";

export interface ShortcutRow {
    action: ShortcutAction;
    /** Nur für diese Betrachter; ohne Angabe für alle. */
    audience?: ShortcutAudience;
    /** `event.key`-Werte, klein geschrieben. */
    keys: readonly string[];
    /** `true`: nur mit Umschalt, `false`: nur ohne, fehlt: gleich. */
    shift?: boolean;
    /** So steht die Taste in der Übersicht; Tastennamen als `{shift}` usw. */
    caps: readonly string[];
    /** Die Erklärung in der Übersicht, als Schlüssel der Sprachtafel. */
    label: MessageKey;
}

/** Schritte der Tasten: Verschieben wie Legacy, Drehen und Neigen wie MapLibre und Google. */
export const KEY_STEP = { panPixels: 80, rotateDegrees: 15, tiltDegrees: 10 } as const;

/**
 * 🔴 Die Leertaste hat zwei Bedeutungen (WI-0063 4.11, Betreiber 2026-10-04): Ein BESUCHER öffnet mit ihr und mit F die Suche,
 * ein EDITOR (`pin_selection`) fixiert und löst mit ihr die Auswahl, und nur F öffnet die Suche. Die Tafel enthält beide
 * Fassungen; `shortcutsFor` wählt die des Betrachters, und Wirkung wie Übersicht lesen dieselbe Auswahl.
 */
const ROWS: readonly ShortcutRow[] = [
    { action: "search", audience: "visitor", keys: ["f", " "], caps: ["F", "{space}"], label: "shortcut.search" },
    { action: "search", audience: "editor", keys: ["f"], caps: ["F"], label: "shortcut.search" },
    { action: "pinSelection", audience: "editor", keys: [" "], caps: ["{space}"], label: "shortcut.pinSelection" },
    {
        action: "panUp",
        keys: ["w", "arrowup"],
        shift: false,
        caps: ["W", "↑"],
        label: "shortcut.panUp",
    },
    {
        action: "panLeft",
        keys: ["a", "arrowleft"],
        shift: false,
        caps: ["A", "←"],
        label: "shortcut.panLeft",
    },
    {
        action: "panDown",
        keys: ["s", "arrowdown"],
        shift: false,
        caps: ["S", "↓"],
        label: "shortcut.panDown",
    },
    {
        action: "panRight",
        keys: ["d", "arrowright"],
        shift: false,
        caps: ["D", "→"],
        label: "shortcut.panRight",
    },
    {
        action: "rotateLeft",
        keys: ["a", "arrowleft"],
        shift: true,
        caps: ["{shift} + A", "{shift} + ←"],
        label: "shortcut.rotateLeft",
    },
    {
        action: "rotateRight",
        keys: ["d", "arrowright"],
        shift: true,
        caps: ["{shift} + D", "{shift} + →"],
        label: "shortcut.rotateRight",
    },
    // D13 (Betreiber 2026-09-24: „kannst du die tasten Q und E doch mit der drehung verbinden (wie
    // umschalt+pfeil links/rechts)“) - statt „keine Q/E“ aus D4. Ohne Umschalt, und mit ebenso.
    { action: "rotateLeft", keys: ["q"], caps: ["Q"], label: "shortcut.rotateLeft" },
    { action: "rotateRight", keys: ["e"], caps: ["E"], label: "shortcut.rotateRight" },
    {
        action: "tiltUp",
        keys: ["w", "arrowup"],
        shift: true,
        caps: ["{shift} + W", "{shift} + ↑"],
        label: "shortcut.tiltUp",
    },
    {
        action: "tiltDown",
        keys: ["s", "arrowdown"],
        shift: true,
        caps: ["{shift} + S", "{shift} + ↓"],
        label: "shortcut.tiltDown",
    },
    { action: "zoomIn", keys: ["+", "="], caps: ["+"], label: "shortcut.zoomIn" },
    { action: "zoomOut", keys: ["-", "_"], caps: ["−"], label: "shortcut.zoomOut" },
    { action: "resetView", keys: ["0"], caps: ["0"], label: "shortcut.resetView" },
    // Legacys Zifferntasten (`keyboard-shortcuts.js`, WI-0028): Taste n wirkt wie ein Klick auf die
    // n-te Ortsklasse im Auge-Menü - die Kaskade, samt „dieselbe Taste noch einmal blendet alle aus".
    {
        action: "placeTier",
        keys: ["1", "2", "3", "4", "5", "6"],
        caps: ["1 … 6"],
        label: "shortcut.placeTier",
    },
    // Die Tasten des Routenplaners (Legacy `keyboard-shortcuts.js`, WI-0017). R öffnet auch einen
    // zugeklappten Planer - in Legacy fokussierte sie eine Zeile, die man nicht sah (MCS-020, A4).
    { action: "addDestination", keys: ["r"], caps: ["R"], label: "shortcut.addDestination" },
    { action: "fastestRoute", keys: ["home"], caps: ["{home}"], label: "shortcut.fastestRoute" },
    { action: "shortestRoute", keys: ["end"], caps: ["{end}"], label: "shortcut.shortestRoute" },
    { action: "previousStage", keys: ["pageup"], caps: ["{pageUp}"], label: "shortcut.previousStage" },
    { action: "nextStage", keys: ["pagedown"], caps: ["{pageDown}"], label: "shortcut.nextStage" },
    { action: "help", keys: ["?"], caps: ["?"], label: "shortcut.help" },
    // Escape arbeitet von innen nach außen (WI-0063 4.10): laufende Aktion, Floating Menu, offene Menüs und Listen, das
    // sichtbare Infopanel samt Auswahl, sonst die Auswahl der Karte (WI-0044, Legacy `clearSpotlightSelection`). Die
    // Reihenfolge steht in `escape-cascade.ts`; ein Menü schließt, ohne die Auswahl aufzuheben.
    { action: "escape", keys: ["escape"], caps: ["Esc"], label: "shortcut.escape" },
];

/** Die Tafel für einen Betrachter: ohne Angabe die des Besuchers. */
export function shortcutsFor(viewer?: ViewerContext): readonly ShortcutRow[] {
    const audience: ShortcutAudience = viewer?.can("pin_selection") === true ? "editor" : "visitor";
    return ROWS.filter((row) => row.audience === undefined || row.audience === audience);
}

/** Der Schlüssel einer Zeile in einer Liste: Aktion, Tasten und Umschalt - dieselbe Aktion steht mehrfach (Drehen). */
export function shortcutRowKey(row: ShortcutRow): string {
    return `${row.action}:${row.keys.join("+")}:${row.shift === undefined ? "" : String(row.shift)}`;
}

/**
 * Eine Zeichentaste: Buchstabe, Ziffer, Zeichen oder Leertaste. Genau die schaltet
 * „Tastenkürzel aus" ab (WCAG 2.1.4). Die Pfeiltasten bleiben, sonst ginge die Karte gar nicht
 * mehr per Tastatur.
 *
 * 🪤 W A S D teilen ihre Zeilen mit den Pfeilen. Deshalb entscheidet die TASTE, nicht die Zeile:
 * mit ausgeschalteten Kürzeln schiebt ↑ weiter, W nicht mehr.
 */
export function isCharacterKey(key: string): boolean {
    return key.length === 1;
}

/** Die Tastatur-Sicht auf ein Ereignis — so klein, dass ein Test sie ohne DOM bauen kann. */
export interface KeyPress {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
}

/** Welche Zeile gehört zu diesem Tastendruck? Ohne Tafel gilt die des Besuchers. */
export function matchShortcut(press: KeyPress, rows: readonly ShortcutRow[] = shortcutsFor()): ShortcutRow | undefined {
    if (press.ctrlKey || press.metaKey || press.altKey) {
        return undefined;
    }
    const key = press.key.toLowerCase();
    return rows.find((row) => row.keys.includes(key) && (row.shift === undefined || row.shift === press.shiftKey));
}

/** Die Tastennamen, die `caps` in geschweiften Klammern nennen darf; je einer steht als `key.<name>` in jeder Sprachtafel. */
export const CAP_NAMES = [
    "shift",
    "space",
    "home",
    "end",
    "pageUp",
    "pageDown",
    "ctrl",
    "alt",
    "enter",
    "backspace",
    "delete",
    "wheel",
    "click",
] as const;

const CAP_PATTERN = new RegExp(`\\{(${CAP_NAMES.join("|")})\\}`, "g");

/** Ein Tastenname der Übersicht in der Sprache der Seite: `{shift} + A` wird „Umschalt + A“ oder „Shift + A“. */
export function capLabel(cap: string): string {
    return cap.replace(CAP_PATTERN, (_match, name: string) => t(`key.${name}` as MessageKey));
}

/** Eine Zeile der Werkzeugtasten: wie eine Zeile der Kartentasten, aber nur zum Lesen. */
export interface ToolKeyRow {
    caps: readonly string[];
    label: MessageKey;
}

/** Die Tasten eines Werkzeugs oder aller Editor-Modi, als eigene Tafel in der Übersicht. */
export interface ToolKeyGroup {
    group: MessageKey;
    /** Nur für diese Betrachter; ohne Angabe für alle. */
    audience?: ShortcutAudience;
    rows: readonly ToolKeyRow[];
    /** Ein Satz unter der Tafel. */
    note?: MessageKey;
}

/**
 * Die Tasten der Editor-Modi und Werkzeuge (Betreiber 2026-11-09: Bedienung als Register jeder Taste).
 *
 * 🔴 Anders als `ROWS` wirken diese Zeilen NICHT: Jeder Modus hört selbst, solange er läuft, meist in der Capture-Phase vor der
 * Kartentafel (Rückgängig `fenster/entwurf-kern.ts`, Strg und R `map/geometrie/modus.ts`, Malen
 * `landschaftseditor/flaeche-malen-anbindung.ts`, Kämme `landschaftseditor/kamm-netz-anbindung.ts`, Screenshot
 * `screenshot/karten-screenshot.vue` und die Anbindungen daneben). Die Modusleiste nennt dieselben Tasten am Ort. Wer dort eine Taste
 * ändert, ändert sie hier im selben Commit; vorher zeigt diese Tafel zusammen mit `ROWS`, was die Taste sonst schon tut (R heißt auf
 * der Karte „Reiseziel hinzufügen“, + und − zoomen).
 *
 * Nicht hier steht, was ein Bauteil von sich aus kann: Tab, Enter und Leertaste auf Knöpfen, Pfeiltasten in Menüs, Listen, Reitern
 * und Reglern, Tasten in einem Textfeld.
 */
const TOOL_KEYS: readonly ToolKeyGroup[] = [
    {
        group: "toolKeys.edit",
        audience: "editor",
        rows: [
            { caps: ["{enter}"], label: "toolKeys.edit.enter" },
            { caps: ["Esc"], label: "toolKeys.edit.escape" },
            { caps: ["{backspace}"], label: "toolKeys.edit.backspace" },
            { caps: ["{delete}"], label: "toolKeys.edit.delete" },
            { caps: ["{ctrl} + Z"], label: "toolKeys.edit.undo" },
            { caps: ["{ctrl} + Y", "{ctrl} + {shift} + Z"], label: "toolKeys.edit.redo" },
            { caps: ["{ctrl}"], label: "toolKeys.edit.ctrl" },
            { caps: ["{shift} + {click}"], label: "toolKeys.edit.shiftClick" },
            { caps: ["{ctrl} + A"], label: "toolKeys.edit.selectAll" },
            { caps: ["R"], label: "toolKeys.edit.round" },
            { caps: ["{alt}"], label: "toolKeys.edit.alt" },
            { caps: ["{space}"], label: "toolKeys.edit.space" },
            { caps: ["{ctrl} + {wheel}"], label: "toolKeys.edit.brush" },
        ],
        note: "toolKeys.edit.mac",
    },
    {
        group: "toolKeys.screenshot",
        rows: [
            { caps: ["{enter}"], label: "toolKeys.screenshot.enter" },
            { caps: ["+", "−"], label: "toolKeys.screenshot.size" },
            { caps: ["↑", "↓"], label: "toolKeys.screenshot.format" },
            { caps: ["{wheel}"], label: "toolKeys.screenshot.wheel" },
            { caps: ["Esc"], label: "toolKeys.screenshot.escape" },
        ],
    },
];

/** Die Werkzeugtasten für einen Betrachter: ohne Angabe die des Besuchers. */
export function toolKeysFor(viewer?: ViewerContext): readonly ToolKeyGroup[] {
    const audience: ShortcutAudience = viewer?.can("pin_selection") === true ? "editor" : "visitor";
    return TOOL_KEYS.filter((group) => group.audience === undefined || group.audience === audience);
}

/** Die Gesten für die Übersicht (Spez. §§ 2–4) — nicht wirksam, nur erklärt. Als Schlüssel der Sprachtafel. */
export const GESTURES: readonly { device: MessageKey; rows: readonly [MessageKey, MessageKey][] }[] = [
    {
        device: "gesture.mouse",
        rows: [
            ["gesture.mouse.drag", "gesture.mouse.drag.effect"],
            ["gesture.mouse.wheel", "gesture.zoom"],
            ["gesture.mouse.doubleClick", "gesture.stepInOut"],
            ["gesture.mouse.rotate", "gesture.mouse.rotate.effect"],
            ["gesture.mouse.boxZoom", "gesture.mouse.boxZoom.effect"],
            ["gesture.mouse.rightClick", "gesture.contextMenu"],
            ["gesture.mouse.waypointCtrl", "gesture.mouse.waypointCtrl.effect"],
        ],
    },
    {
        device: "gesture.trackpad",
        rows: [
            ["gesture.trackpad.pinch", "gesture.zoom"],
            ["gesture.trackpad.swipe", "gesture.zoom"],
            ["gesture.trackpad.rotate", "gesture.trackpad.rotate.effect"],
        ],
    },
    {
        device: "gesture.touch",
        rows: [
            ["gesture.touch.drag", "gesture.mouse.drag.effect"],
            ["gesture.touch.pinch", "gesture.zoom"],
            ["gesture.touch.rotate", "gesture.touch.rotate.effect"],
            ["gesture.touch.tilt", "gesture.touch.tilt.effect"],
            ["gesture.touch.doubleTap", "gesture.stepInOut"],
            ["gesture.touch.longPress", "gesture.contextMenu"],
        ],
    },
];
