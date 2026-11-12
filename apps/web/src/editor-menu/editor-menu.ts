import { computed, shallowRef, watch, type ComputedRef } from "vue";
import { subjectKey, type SubjectRef, type ViewerContext } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";
import type { OpenSubjectOptions, SubjectSelection } from "../info-panel/subject-selection";
import type { EscapeCascade } from "../keyboard/escape-cascade";
import {
    NO_MENU_KINDS,
    WAHL_TRENNER,
    labelVon,
    visibleActions,
    zeichenVon,
    type EditorAction,
    type EditorMenuSubject,
    type HandgriffWahl,
} from "./action";
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import type { MenuPoint } from "./placement";
import { subjectOf } from "./subject-identity";

/**
 * Der Zustand des Editor-Menüs am Objekt (WI-0063 P9, 4.2, 4.10, 15): Es gibt höchstens EIN Menü, es gehört dem gewählten
 * Subject, und es entsteht nur, wo es etwas zu tun gibt.
 *
 * Wann es aufgeht (`subjectOpened`, angeschlossen an `createSubjectSelection({ onOpened })`):
 * - die Karte hat einen Subject gewählt (`source: "map"`, ein Linksklick; Suche, Link und Planer öffnen nie ein Menü, 4.6, 4.7) und
 *   der Besitzer hat den Klickpunkt als `anchor` mitgegeben;
 * - der Betrachter hat die Fähigkeit `use_editor_menu` (Besucher nie, Kriterium 2) und sitzt am Rechner, nicht am Telefon (4.3);
 * - kein Werkzeug hat den Zeiger erfasst (15.3: Das Werkzeug besitzt die Geste bis Abschluss oder Abbruch);
 * - 🔴 **mindestens eine Action ist für diesen Gegenstand sichtbar** (`visibleActions`). Heute gibt es keine, also öffnet das Menü für
 *   niemanden. Es steht nie leer oder voller gesperrter Zeilen da.
 *
 * Wann es zugeht: Escape (Stufe `floating-menu` der Kaskade, 4.10: vor allen Menüs, dem Infopanel und der Auswahl), ein Druck daneben
 * und jede Kartenbewegung (beides der Komponente und `app.vue`), ein anderer Gegenstand oder keiner mehr (die Auswahl wechselt),
 * der Wechsel zum Telefon, eine Action (das Menü ist vorher zu), und es gibt keine sichtbare Action mehr (die Antwort des Servers
 * hat ein Prädikat umgestoßen).
 *
 * Ein Handgriff mit Auswahl (`auswahl`, EDIT-0003 T49: „Wegkurve bearbeiten ›“ mit den Abschnitten der Straße) steht als „… ›“ mit
 * Untermenü; eine Wahl läuft als `<griff>#<wahl>`. Zeigen auf eine Wahl mit Vorschau meldet das Menü seinem Besitzer (`vorschau`).
 *
 * 🔴 Das Infopanel bleibt, wie es ist: Das Menü KOMMT DAZU (4.2 Punkte 1-3), es ersetzt nichts, und es verschiebt die Auswahl nicht.
 * Ein aktives Editorpanel behält später seinen Platz im rechten Slot; das Menü hängt nur an `selected`.
 */

/** Eine Zeile des Menüs, wie die Komponente sie zeichnet: ohne Handler. */
export interface EditorMenuItem {
    readonly id: string;
    readonly label: MessageKey;
    readonly icon: string | undefined;
    readonly zeichen: EditorZeichenName | undefined;
    readonly danger: boolean;
    /** Ein Handgriff mit Auswahl: die Wahlen seines Untermenüs. */
    readonly auswahl?: readonly HandgriffWahl[] | undefined;
}

/** Was das offene Menü gerade zeigt: das offene Untermenü (ein Handgriff) und die gezeigte Wahl darin. */
export interface EditorMenuVorschau {
    readonly subject: EditorMenuSubject;
    readonly griff: string | undefined;
    readonly wahl: string | undefined;
}

export interface EditorMenuView {
    /** Wo geklickt wurde, in Fensterkoordinaten. */
    readonly anchor: MenuPoint;
    readonly subject: EditorMenuSubject;
    readonly items: readonly EditorMenuItem[];
}

export interface EditorMenuOptions {
    viewer: ViewerContext;
    /** Die Registry, bei jedem Öffnen frisch gelesen (die Entwicklungsnaht kann Testaktionen dazulegen). */
    actions: () => readonly EditorAction[];
    /** Die Auswahl: Das Menü gehört dem Subject, das sie zeigt. */
    selection: Pick<SubjectSelection, "shown">;
    /** Sitzt der Betrachter am Rechner? Am Telefon gibt es nie ein Menü (4.3). Wird reaktiv gelesen. */
    available: () => boolean;
    /** Wer hält den Zeiger (`MapInteractionCoordinator.captured`)? Ein Werkzeug in der Geste: kein Menü nebenbei (15.3). */
    captured: () => string | undefined;
    /** Das Zeigen auf der Karte ruht, solange das Menü offen ist (`suspendHover`); gibt die Fortsetzung zurück. */
    holdPointer?: () => () => void;
    /** Ein Untermenü geht auf oder zu, eine Wahl darin wird gezeigt; `undefined`: nichts mehr (das Menü ist zu). */
    vorschau?: (jetzt: EditorMenuVorschau | undefined) => void;
}

export interface EditorMenu {
    /** Was die Komponente zeichnet; `undefined`, solange kein Menü offen ist. */
    readonly view: ComputedRef<EditorMenuView | undefined>;
    /** Ein Subject wurde geöffnet (Wirkung von `onOpened`): öffnet das Menü, wo die Regeln es erlauben. */
    subjectOpened(ref: SubjectRef, options: Pick<OpenSubjectOptions, "source" | "anchor">): boolean;
    /**
     * Eine Zeile gewählt: Das Menü ist zu, dann läuft der Handler. `false`, wenn es die Zeile nicht (mehr) gibt. Eine Wahl im
     * Untermenü heißt `<griff>#<wahl>` und muss eine sein, die der Handgriff gerade anbietet.
     */
    choose(id: string): boolean;
    /** Das Untermenü eines Handgriffs ist offen (oder keins), eine Wahl darin wird gezeigt (oder keine). */
    zeige(griff: string | undefined, wahl: string | undefined): void;
    /** Zu. `true`, wenn eins offen war (Escape: die Taste ist verbraucht). */
    close(): boolean;
    /** Escape, Stufe `floating-menu` der Kaskade. Gibt die Abmeldung zurück. */
    attachEscape(cascade: EscapeCascade): () => void;
    destroy(): void;
}

interface OpenState {
    /** Der Schlüssel, unter dem der Subject geöffnet wurde: Er bindet das Menü an diese Auswahl. */
    key: string;
    anchor: MenuPoint;
    /** Die Registry zum Zeitpunkt des Öffnens. */
    actions: readonly EditorAction[];
}

export function createEditorMenu(options: EditorMenuOptions): EditorMenu {
    const { viewer, selection } = options;
    const state = shallowRef<OpenState | undefined>(undefined);
    let release: (() => void) | undefined;

    function close(): boolean {
        const wasOpen = state.value !== undefined;
        state.value = undefined;
        release?.();
        release = undefined;
        if (wasOpen) options.vorschau?.(undefined);
        return wasOpen;
    }

    /** Das Menü, wie es gerade gilt: an den gewählten Subject gebunden, und nur mit mindestens einer sichtbaren Action. */
    const resolved = computed(() => {
        const open = state.value;
        if (open === undefined || !options.available()) return undefined;
        const shown = selection.shown.value;
        if (shown === undefined || shown.status === "missing") return undefined;
        // Derselbe Gegenstand wie bei der Öffnung - oder unter seinem kanonischen Ref (ein Weg über die Kette wird sein Anker).
        if (shown.key !== open.key && subjectKey(shown.ref) !== open.key) return undefined;
        const subject = subjectOf(shown);
        const actions = visibleActions(open.actions, subject, viewer);
        return actions.length === 0 ? undefined : { anchor: open.anchor, subject, actions };
    });

    const view = computed<EditorMenuView | undefined>(() => {
        const menu = resolved.value;
        return menu === undefined
            ? undefined
            : {
                  anchor: menu.anchor,
                  subject: menu.subject,
                  items: menu.actions.map((action) => ({
                      id: action.id,
                      label: labelVon(action, menu.subject),
                      icon: action.icon,
                      zeichen: zeichenVon(action, menu.subject),
                      danger: action.danger === true,
                      ...(action.auswahl !== undefined ? { auswahl: action.auswahl(menu.subject) } : {}),
                  })),
              };
    });

    // Gilt das Menü nicht mehr (anderer Gegenstand, Auswahl leer, Telefon, keine Action mehr), räumt es sich selbst weg: Der
    // Zeigerzustand und der Zustand gehen mit. `sync`, damit die Fortsetzung des Zeigens nicht ein Bild später kommt.
    const stop = watch(
        resolved,
        (menu) => {
            if (menu === undefined && state.value !== undefined) close();
        },
        { flush: "sync" },
    );

    function open(ref: SubjectRef, anchor: MenuPoint): boolean {
        if (!viewer.can("use_editor_menu")) return false;
        if (!options.available()) return false;
        if (NO_MENU_KINDS.includes(ref.kind)) return false;
        // 15.3: Hat ein Werkzeug den Zeiger, öffnet ein Klick nicht nebenbei ein Menü.
        if (options.captured() !== undefined) return false;
        const key = subjectKey(ref);
        const shown = selection.shown.value;
        if (shown === undefined || (shown.key !== key && subjectKey(shown.ref) !== key)) return false;
        const actions = options.actions();
        close();
        if (visibleActions(actions, subjectOf(shown), viewer).length === 0) return false;
        state.value = { key, anchor, actions };
        release = options.holdPointer?.();
        return true;
    }

    return {
        view,
        subjectOpened(ref, { source, anchor }) {
            // Nur ein Linksklick der Karte, und nur mit Klickpunkt: Suche, Link und Planer sind kein Klick auf ein Kartenobjekt.
            if (source !== "map" || anchor === undefined) return false;
            return open(ref, anchor);
        },
        choose(id) {
            const menu = resolved.value;
            const trenner = id.indexOf(WAHL_TRENNER);
            const griff = trenner < 0 ? id : id.slice(0, trenner);
            const wahl = trenner < 0 ? undefined : id.slice(trenner + 1);
            const action = menu?.actions.find((entry) => entry.id === griff);
            if (menu === undefined || action === undefined) return false;
            if (
                action.auswahl !== undefined &&
                (wahl === undefined ||
                    !action.auswahl(menu.subject).some((w) => w.id === wahl && w.grund === undefined))
            )
                return false;
            // Das Menü ist vorher zu: Eine Action, die ein Werkzeug startet, findet den Zeiger frei und die Karte unverdeckt.
            close();
            action.run({ subject: menu.subject, viewer, wahl });
            return true;
        },
        zeige(griff, wahl) {
            const menu = resolved.value;
            if (menu === undefined) return;
            options.vorschau?.({ subject: menu.subject, griff, wahl });
        },
        close,
        attachEscape: (cascade) => cascade.register("floating-menu", () => close()),
        destroy() {
            stop();
            close();
        },
    };
}
