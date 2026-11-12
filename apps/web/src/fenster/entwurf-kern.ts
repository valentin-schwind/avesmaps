/**
 * Der Entwurfskern der Editoren (EDIT-0003 T27 (4), (7), F20, R1, R2; gehoben von der Herrschaftsgebiete-Sitzung aus „Ecken bearbeiten“,
 * WI-0209 C1, und mit O3 aus `map/geometrie/entwurf.ts` in den gemeinsamen Fensterrumpf gezogen, WI-0178). Er kennt weder Karte noch
 * Fenster noch Felder, nur Stände eines Entwurfs. Die Bearbeitung eines Objekts (`bearbeitung.ts`) und der Formentwurf des
 * Geometrie-Moduls (`map/geometrie/formentwurf.ts`) bauen darauf auf.
 *
 * ## Die Schnittstelle
 *
 * | Griff | Wirkung |
 * |---|---|
 * | `beginne(start)` | der Stand vom Start; vorher Geschriebenes zählt nicht |
 * | `schritt(stand, verschmelze?)` | ein neuer Schritt nach dem jetzigen; was nach ↶ vorn lag, fällt weg. Mit `verschmelze` (etwa dem Feld, in dem getippt wird) wird eine Folge mit demselben Schlüssel EIN Schritt, bis `schluss()`, ↶ oder ein anderer Schritt kommt |
 * | `schluss()` | beendet das Verschmelzen (das Feld wurde verlassen: ein Feld = ein Schritt, Orchestrierung 2026-10-17) |
 * | `ersetzeAlle(neu)` | rechnet jeden Stand um (die Form kommt mitten im Entwurf dazu und gilt dann auch für den Start) |
 * | `zurueck()`, `wieder()` | ↶ ↷ und Strg+Z/Strg+Y (Mac ⌘), höchstens `ENTWURF_SCHRITTE` zurück (T27 (7): „bis 20 Schritte“) |
 * | `verwerfen()` | zurück auf den Start; ob der Modus endet, sagt `entwurf-regeln.ts` (F20) |
 * | `esc()` | Esc ohne laufenden Zug (R2): mit Ungeschriebenem erst die Frage; ein zweites Esc verwirft und endet (Esc verlässt jeden Modus, Orchestrierung 2026-10-17); sonst `ende` |
 * | `antworte(verwerfen)` | die Antwort auf die Frage: verwerfen und enden, oder weiter bearbeiten; „Fertig“ ruft der Aufrufer selbst |
 * | `lage()` | was die Leiste zeigt: „n ungespeichert“, ↶, ↷, die Frage; „Fertig“ geht, sobald etwas ungespeichert ist |
 *
 * „Fertig“ schreibt EINE Operation aus `start()` und `jetzt()`; das tut der Aufrufer, der Kern zählt nur. Strg+Z und Strg+Y liest
 * `entwurfsTaste`, nie in einem Textfeld.
 */

/** So weit gehen ↶ und Strg+Z zurück (Betreiber 2026-10-16, T27 (7): „bis 20 Schritte“). */
export const ENTWURF_SCHRITTE = 20;

/** Was die Leiste des Modus über den Entwurf zeigt. */
export interface EntwurfLage {
    /** Schritte seit dem Start (nach ↶ weniger). */
    readonly ungespeichert: number;
    readonly zurueck: boolean;
    readonly wieder: boolean;
    /** Esc mit Ungeschriebenem: die Frage, ob verworfen wird, steht. */
    readonly frage: boolean;
}

export interface Entwurf<S> {
    beginne(start: S): void;
    /** Vergisst alles (der Modus endet). */
    leere(): void;
    schritt(stand: S, verschmelze?: string): void;
    schluss(): void;
    ersetzeAlle(neu: (stand: S) => S): void;
    start(): S | undefined;
    jetzt(): S | undefined;
    /** `true`, wenn es einen Schritt zurück ging. */
    zurueck(): boolean;
    wieder(): boolean;
    /** Zurück auf den Start; `true`, wenn es etwas zu verwerfen gab. Die Frage schließt. */
    verwerfen(): boolean;
    esc(): "frage" | "zu" | "ende";
    antworte(verwerfen: boolean): "ende" | "weiter";
    lage(): EntwurfLage;
}

export function createEntwurf<S>(): Entwurf<S> {
    let verlauf: S[] = [];
    let stelle = 0;
    let frage = false;
    /** Der Schlüssel des obersten Schritts, solange er weiter verschmelzen darf. */
    let offen: string | undefined;
    const zurueckGeht = (): boolean => stelle > 0 && verlauf.length - 1 - stelle < ENTWURF_SCHRITTE;
    return {
        beginne(start) {
            verlauf = [start];
            stelle = 0;
            frage = false;
            offen = undefined;
        },
        leere() {
            verlauf = [];
            stelle = 0;
            frage = false;
            offen = undefined;
        },
        schritt(stand, verschmelze) {
            if (verlauf.length === 0) return;
            if (verschmelze !== undefined && verschmelze === offen && stelle > 0 && stelle === verlauf.length - 1) {
                verlauf = [...verlauf.slice(0, stelle), stand];
                return;
            }
            verlauf = [...verlauf.slice(0, stelle + 1), stand];
            stelle = verlauf.length - 1;
            offen = verschmelze;
        },
        schluss() {
            offen = undefined;
        },
        ersetzeAlle(neu) {
            verlauf = verlauf.map(neu);
        },
        start: () => verlauf[0],
        jetzt: () => verlauf[stelle],
        zurueck() {
            if (!zurueckGeht()) return false;
            stelle -= 1;
            offen = undefined;
            return true;
        },
        wieder() {
            if (stelle >= verlauf.length - 1) return false;
            stelle += 1;
            offen = undefined;
            return true;
        },
        verwerfen() {
            if (verlauf.length === 0) return false;
            const etwas = verlauf.length > 1;
            verlauf = [verlauf[0]!];
            stelle = 0;
            frage = false;
            offen = undefined;
            return etwas;
        },
        esc() {
            // Das zweite Esc verwirft und endet: Esc verlässt jeden Modus (Editor-Orchestrierung 2026-10-17).
            if (frage) {
                frage = false;
                return "ende";
            }
            if (stelle > 0) {
                frage = true;
                return "frage";
            }
            return "ende";
        },
        antworte(verwerfen) {
            frage = false;
            return verwerfen ? "ende" : "weiter";
        },
        lage: () => ({ ungespeichert: stelle, zurueck: zurueckGeht(), wieder: stelle < verlauf.length - 1, frage }),
    };
}

/** Strg+Z (zurück), Strg+Y und Strg+Umschalt+Z (wieder), Mac ⌘; nie in einem Textfeld. Ohne Treffer `undefined`. */
export function entwurfsTaste(event: KeyboardEvent): "zurueck" | "wieder" | undefined {
    if (!(event.ctrlKey || event.metaKey)) return undefined;
    const ziel = event.target as HTMLElement | null;
    if (ziel?.closest?.("input, textarea, select, [contenteditable='true']")) return undefined;
    const taste = event.key.toLowerCase();
    if (taste === "y" || (taste === "z" && event.shiftKey)) return "wieder";
    return taste === "z" ? "zurueck" : undefined;
}
