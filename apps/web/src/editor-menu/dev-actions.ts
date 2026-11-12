import type { EditorAction, EditorMenuRef, MenuSubjectKind } from "./action";

/**
 * Die Entwicklungsnaht des Editor-Menüs (WI-0063 P9): Heute gibt es keine Action, also öffnet das Menü für niemanden. Damit
 * Architektur und Oberfläche trotzdem am echten Stack zu prüfen sind, legt `globalThis.__avesmapsEditorActions` zwei TESTACTIONS
 * in die Registry: eine gewöhnliche und eine gefährliche. Beide tun nichts, als ihren Aufruf in `calls` zu vermerken.
 *
 * 🔴 Der Schalter wirkt NUR im Entwicklungsmodus (`import.meta.env.DEV`), wie `__avesmapsPanelExtras`
 * (`info-panel/panel-extras.ts`). Vite ersetzt diese Konstante im Produktionsbau durch `false`; der Zweig und der Name des
 * Schalters fallen dort heraus. Ein Wächter (`editor-menu-huelle.test.ts`) hält fest, dass der Name an keiner anderen Stelle
 * steht.
 *
 * Der Wert ist ein Objekt, das der Test hinlegt (`page.addInitScript`):
 * - `calls`: eine Liste, in die jede ausgeführte Testaktion `{ id, kind }` schreibt;
 * - `kinds`: für welche Arten die Testaktionen gelten (Vorgabe: `place`, `area`, `territory`, `path`, `peak`, `powerline`).
 */

export interface DevActionWish {
    calls?: { id: string; kind: EditorMenuRef["kind"] }[];
    kinds?: MenuSubjectKind[];
}

const DEFAULT_KINDS: readonly MenuSubjectKind[] = ["place", "area", "territory", "path", "peak", "powerline"];

/** Die Testaktionen, wenn die Naht eingeschaltet ist; sonst - und in jedem Produktionsbau - nichts. */
export function devEditorActions(): readonly EditorAction[] {
    if (import.meta.env.DEV) {
        const wish = (globalThis as { __avesmapsEditorActions?: unknown }).__avesmapsEditorActions;
        if (typeof wish !== "object" || wish === null) return [];
        const { calls, kinds } = wish as DevActionWish;
        const record =
            (id: string): EditorAction["run"] =>
            ({ subject }) => {
                calls?.push({ id, kind: subject.ref.kind });
            };
        const shared = { kinds: kinds ?? DEFAULT_KINDS, capability: "use_editor_menu", gruppe: "bearbeiten" } as const;
        return [
            { ...shared, id: "dev.test", label: "editorMenu.dev.test", run: record("dev.test") },
            { ...shared, id: "dev.danger", label: "editorMenu.dev.danger", danger: true, run: record("dev.danger") },
        ];
    }
    return [];
}
