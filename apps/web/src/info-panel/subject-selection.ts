import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { subjectDetailUrl, subjectKey, type SubjectRef, type SubjectTarget } from "@avesmaps3d/shared";
import { createRevisionCache, type RevisionCache } from "./subject-cache";
import { melde } from "../besuch/besuch-melden";
import { createSubjectClient, type SubjectAnswer, type SubjectClient } from "./subject-client";
import { presentationFromDetail, type PresentedSelection } from "./presentation";

/**
 * Die Auswahl und der rechte Slot (WI-0063 P5, §8, §11).
 *
 * 🔴 Es gibt genau EINEN `selectedSubject` und EINE Öffnungsnaht: `openSubject(ref, { camera, source })` und
 * `closeSubject()`. Karte, Suche, Objektlink, Planer und das Kontextmenü öffnen alle über sie; es gibt keinen zweiten
 * Infopanel-Pfad. Sie speist die vorhandenen Darstellungszustände der Karte (`selectedPlace`, `areaSelection`,
 * `planner.selectStage`, der Tropfen), statt sie zu ersetzen: Das tut `effects.present`, und `app.vue` kennt keine Art
 * des Subjects.
 *
 * 🔴 Eine verspätete Antwort überschreibt nie einen neueren Subject (§11.3): Jede Öffnung bricht die Frage nach der vorigen ab
 * (`AbortController`) und trägt einen Zählerstand; eine Antwort zählt nur, wenn der Zählerstand UND der `subjectKey` noch
 * der gewählte sind. Ein Stack, der das Abbrechen nicht beachtet, ändert daran nichts. Legacys `lastPanelRender` und
 * `refreshingPanel` gibt es nicht.
 *
 * Der rechte Slot hat die Zustände `info`, `editor` und `closed`, dazu „eingeklappt“ (§8). `editor` setzt das Editorpanel
 * (WI-0128 E3, Lasche „Editor“ unter „Info“, Legacy `window.avesmapsEdgePanels`: zwei Laschen, ein Slot, eins offen): Ist er
 * aktiv, bleibt er vorn, und das Infopanel zieht nur im Hintergrund nach. Ein hinter dem Editorpanel vorbereiteter Inhalt zählt
 * nicht als sichtbar (Escape, §4.10); die Lasche „Info“ holt ihn nach vorn.
 *
 * 🔴 Lokale Auswahlfixierung (§4.11, §16, nur Editor): Solange sie gilt, wechselt kein normaler Kartenklick den Subject und
 * hebt keiner ihn auf. Hover und Kamera bleiben; Suche, Objektlink und Planer sind bewusste Handlungen und lösen sie.
 * Escape löst sie mit der Auswahl. Kein Soft Lock im Sinne von Kapitel 7: es geht nur um die eigene Auswahl.
 */

/** Woher eine Öffnung kommt: Nur `map` (Klick, langer Druck, Leerklick) ist von der Fixierung betroffen. */
export type SubjectSource = "map" | "search" | "link" | "planner" | "context";

/** Ob die Kamera zum Ziel fliegt: `target` fliegt zum Ziel der Antwort (nie ein Sprung, `camera.ts`), `none` bleibt. */
export type CameraMode = "target" | "none";

/** Was die Karte schon weiß, ehe die Antwort da ist: ein Name für die Zeit des Ladens und die Darstellung. */
export interface KnownSubject {
    title?: string;
    presentation?: PresentedSelection;
}

export interface OpenSubjectOptions {
    source: SubjectSource;
    camera: CameraMode;
    known?: KnownSubject;
    /**
     * Wo der Klick stand (Fensterkoordinaten), wenn die Karte den Subject öffnet (`source: "map"`): Dort hängt das Editor-Menü
     * (WI-0063 P9, `editor-menu/`). Ein Besitzer, der einen Subject aus der Karte wählt, reicht `context.screen` hierher durch;
     * ohne Angabe gibt es für diese Öffnung nie ein Menü.
     */
    anchor?: { x: number; y: number };
    /**
     * Die Wahl kommt aus einer Liste eines Werkzeugs (WI-0128 E6, Ortseditor): Sie markiert den Subject auf der Karte (D14, Liste und
     * Karte synchron), holt das Infopanel aber nicht nach vorn - das Werkzeug steht vor ihm.
     */
    still?: boolean;
    /**
     * Die Teilfläche, die der Klick auf der Karte traf: Ein offener Editor einer Art mit Teilflächen wählt sie in seiner Liste (eingeführt mit der
     * Sprache, WI-0261 Stufe 1; jede Art mit Teilflächen darf ihn nutzen, etwa später die Landschaften). Die Auswahl selbst kennt sie nicht, sie reicht sie
     * nur an `onOpened` weiter.
     */
    teilflaeche?: string;
}

/** Die drei Besitzer des rechten Slots (§8). `editor` ist das Editorpanel (WI-0128 E3). */
export type RightSlot = "info" | "editor" | "closed";

export type ShownStatus = "loading" | "ready" | "missing" | "error";

/** Was das Panel zeigt: der gewählte Subject, sein vorläufiger Name und die Antwort des Servers. */
export interface ShownSubject {
    /** Kanonisch, sobald die Antwort da ist (ein Weg über die Kette wird sein Anker samt Wiki-Schlüssel). */
    ref: SubjectRef;
    /** Der Schlüssel, unter dem er geöffnet wurde: Er bindet die Antwort an diese Öffnung. */
    key: string;
    /** Der Name, den die Karte schon kannte; die Antwort trägt den maßgeblichen. */
    title: string | undefined;
    status: ShownStatus;
    answer: SubjectAnswer | undefined;
}

/** Die Wirkungen nach außen: Darstellung der Karte und Kamera. */
export interface SubjectSelectionEffects {
    /** Die Darstellungszustände nachführen (`app.vue` setzt `selectedPlace`, `areaSelection`, Tropfen, Etappe). */
    present(selection: PresentedSelection): void;
    /** Nichts ist mehr gewählt: alle Darstellungszustände enden, auch Klimazone und offene Listen. */
    clear(): void;
    /** Die Kamera fliegt zum Ziel (nie ein Sprung): `target` aus der Antwort, bei einer Kartenstelle fehlt es. */
    fly(ref: SubjectRef, target: SubjectTarget | undefined): void;
}

export interface SubjectSelectionOptions {
    effects: SubjectSelectionEffects;
    /** Für Tests: der Dienst und der Cache. */
    client?: SubjectClient;
    cache?: RevisionCache<SubjectAnswer>;
    /** Die Fixierung gibt es nur für Editoren (`pin_selection`). */
    canPin?: boolean;
    /**
     * Eine Öffnung wurde angenommen (eine von der Fixierung abgewiesene nicht): P9 hängt das Editor-Menü daran (`editor-menu/`).
     * Die Auswahl selbst kennt kein Menü; sie meldet nur, was sie getan hat.
     */
    onOpened?: (ref: SubjectRef, options: OpenSubjectOptions) => void;
}

export interface SubjectSelection {
    /** Der gewählte Subject (§11.1); `undefined`, wenn nichts gewählt ist. */
    selected: Readonly<ShallowRef<SubjectRef | undefined>>;
    shown: Readonly<ShallowRef<ShownSubject | undefined>>;
    slot: Ref<RightSlot>;
    collapsed: Ref<boolean>;
    pinned: Readonly<Ref<boolean>>;
    /** Gibt es etwas zu zeigen? Ohne Inhalt ist die Randlasche verborgen. */
    hasContent: ComputedRef<boolean>;
    /** Steht das Infopanel gerade vor der Karte? Ein hinter dem Editor vorbereitetes oder eingeklapptes zählt nicht. */
    panelVisible: ComputedRef<boolean>;
    /** Steht das Editorpanel vor der Karte (WI-0128 E3)? */
    editorVisible: ComputedRef<boolean>;
    /** Ist der Slot offen, gleich mit welchem Panel? Die Laschen sitzen dann an seiner Kante, sonst an der Bildschirmkante. */
    slotOpen: ComputedRef<boolean>;
    /**
     * Die Lasche „Editor“: holt das Editorpanel nach vorn oder klappt den Slot zu. Zu bleibt die Auswahl, das Infopanel steht
     * eingeklappt dahinter (Legacy: ein Slot, eins offen).
     */
    toggleEditor(): void;
    /** Das Editorpanel nach vorn, ohne umzuschalten (Tiefer Link, gemerkter Stand nach dem Laden). */
    showEditor(): void;
    /** Das Editorpanel geht zu, falls es vorn steht (am Telefon, wenn der Planer aufgeht). */
    closeEditor(): void;
    /** Öffnet einen Subject. `false`, wenn die Fixierung einen Kartenklick abgewiesen hat. */
    openSubject(ref: SubjectRef, options: OpenSubjectOptions): boolean;
    /** Hebt die Auswahl auf und klappt das Panel ein. `false`, wenn die Fixierung einen Kartenklick abgewiesen hat. */
    closeSubject(options?: { source: SubjectSource | "escape" }): boolean;
    /**
     * Die Randlasche und ein expliziter Schließen-Knopf: nur die Darstellung klappt ein oder aus, die Auswahl bleibt. Steht das
     * Editorpanel vorn, holt die Lasche das Infopanel nach vorn.
     */
    togglePanel(): void;
    collapsePanel(): void;
    /** Leertaste im Editor: Auswahl fixieren oder lösen. Ohne Auswahl und für Besucher geschieht nichts. */
    togglePin(): boolean;
    /** Ein Fehlschlag soll noch einmal fragen. */
    retry(): void;
    /**
     * Ein Editor hat den gezeigten Subject geändert (WI-0128 E19: Wappen, Titelbilder; ebenso Felder und Lage): Er wird neu gelesen,
     * am Cache vorbei, ohne Flug und ohne das Panel nach vorn zu holen; bis die Antwort da ist, bleibt die alte stehen. Ein anderer
     * gezeigter Subject (`ref` passt nicht) bleibt, wie er ist.
     */
    auffrischen(ref?: SubjectRef): void;
    /** Escape, Stufe „Infopanel“: schließt das SICHTBARE Panel und hebt die Auswahl auf. */
    escapeVisible(): boolean;
    /** Escape, Stufe „Auswahl der Karte“: hebt alles auf, auch wo kein Panel zu sehen ist. */
    escapeSelection(): boolean;
    destroy(): void;
}

/** Ein Subject ohne Endpunkt (Etappe lebt im Planer, Klima ist Kontext) hat nur das, was die Karte kennt. */
const hasEndpoint = (ref: SubjectRef): boolean => subjectDetailUrl(ref) !== null;

export function createSubjectSelection(options: SubjectSelectionOptions): SubjectSelection {
    const { effects } = options;
    const client = options.client ?? createSubjectClient();
    const cache = options.cache ?? createRevisionCache<SubjectAnswer>();
    const canPin = options.canPin === true;

    const selected = shallowRef<SubjectRef | undefined>(undefined);
    const shown = shallowRef<ShownSubject | undefined>(undefined);
    const slot = ref<RightSlot>("closed");
    const collapsed = ref(false);
    const pinned = ref(false);
    const hasContent = computed(() => selected.value !== undefined);
    const panelVisible = computed(() => slot.value === "info" && !collapsed.value && hasContent.value);
    const editorVisible = computed(() => slot.value === "editor");
    const slotOpen = computed(() => panelVisible.value || editorVisible.value);

    /** Das Editorpanel geht zu: Mit Inhalt steht das Infopanel eingeklappt dahinter, seine Lasche bleibt. */
    function leaveEditor(): void {
        slot.value = hasContent.value ? "info" : "closed";
        collapsed.value = hasContent.value;
    }

    let controller: AbortController | undefined;
    /** Der Zählerstand der jüngsten Öffnung: Eine Antwort für einen anderen Stand ist veraltet. */
    let round = 0;
    let last: { ref: SubjectRef; options: OpenSubjectOptions } | undefined;
    let destroyed = false;

    const cancel = (): void => {
        controller?.abort();
        controller = undefined;
        round += 1;
    };

    /** Das Panel kommt nach vorn - außer ein anderer Besitzer des Slots (Editor) ist aktiv: Dann bleibt er vorn. */
    function reveal(): void {
        if (slot.value === "closed") slot.value = "info";
        if (slot.value === "info") collapsed.value = false;
    }

    /** Gilt die Antwort noch? Der Zählerstand UND der Schlüssel müssen die der gewählten Öffnung sein. */
    const isCurrent = (token: number, key: string): boolean =>
        !destroyed && token === round && shown.value?.key === key;

    function settle(
        token: number,
        key: string,
        answer: SubjectAnswer | null,
        open: OpenSubjectOptions,
        frisch = false,
    ): void {
        if (!isCurrent(token, key)) return;
        const current = shown.value as ShownSubject;
        if (answer === null) {
            shown.value = { ...current, status: "missing", answer: undefined };
            return;
        }
        // Der Server nennt den kanonischen Ref: Ein Weg über seine Kette wird sein Anker samt Wiki-Schlüssel.
        selected.value = answer.subject;
        shown.value = { ...current, ref: answer.subject, status: "ready", answer };
        // Was die Karte nicht schon kannte (Objektlink, Planer), zeigt sie erst jetzt: Nur die Antwort weiß, wo es liegt.
        if (open.known?.presentation === undefined) effects.present(presentationFromDetail(answer));
        else if (!(
            frisch &&
            current.answer !== undefined &&
            folgeKette(current.answer, answer, open.known.presentation)
        ))
            folgeGruppe(answer, open.known.presentation);
        if (open.camera === "target") {
            effects.fly(answer.subject, "target" in answer ? answer.target : undefined);
        }
    }

    /**
     * Ein neu gelesener Weg liegt in einer anderen Kette als vorher (umbenannt; ein Wegtyp trennt seit Schritt 2b nicht mehr; WI-0177, Betreiber 2026-10-18: „ich kann
     * den Namen ändern, aber es steht immer noch "unbezeichneter weg" dran“): Die goldene Markierung kam vom Klick und filtert die
     * Kacheln nach dem ALTEN Namen, sie träfe nichts mehr. Sie geht auf die neue Kette über, an der Stelle des Klicks und ohne die
     * Ansicht zu wechseln; der Titel kommt mit der Antwort.
     */
    function folgeKette(vorher: SubjectAnswer, answer: SubjectAnswer, gezeigt: PresentedSelection): boolean {
        const klick = gezeigt.area;
        const neu = presentationFromDetail(answer).area;
        if (klick?.kind !== "path" || neu?.kind !== "path" || neu.id === klick.id) return false;
        if (presentationFromDetail(vorher).area?.id === neu.id) return false;
        // Die Gruppe der neuen Kette nennt die Antwort (WI-0302); die der alten gilt nicht mehr.
        const area: NonNullable<PresentedSelection["area"]> = { ...klick, id: neu.id, name: neu.name, type: neu.type };
        delete area.abschnitte;
        if (neu.abschnitte !== undefined) area.abschnitte = neu.abschnitte;
        zeigeNeu(gezeigt, area);
        return true;
    }

    /**
     * Die Gruppe eines Wegs, wie die Antwort sie nennt (WI-0302, `SubjectDetail.abschnitte`): Die goldene Markierung kam vom Klick und filtert nach
     * dem Namen; mit der Antwort leuchten genau die Abschnitte der Gruppe, auch die geteilten einer anderen Straße (Vali 2026-11-10, „Ja,
     * mitzählen“). Ein im Editor markierter Abschnitt (`segment`) bleibt allein.
     */
    function folgeGruppe(answer: SubjectAnswer, gezeigt: PresentedSelection): void {
        const klick = gezeigt.area;
        const neu = presentationFromDetail(answer).area;
        if (klick?.kind !== "path" || neu?.kind !== "path" || klick.segment !== undefined) return;
        if (neu.abschnitte === undefined || neu.id !== klick.id) return;
        const alt = klick.abschnitte;
        if (
            alt !== undefined &&
            alt.length === neu.abschnitte.length &&
            alt.every((id, i) => id === neu.abschnitte?.[i])
        )
            return;
        zeigeNeu(gezeigt, { ...klick, abschnitte: neu.abschnitte });
    }

    /** Die Markierung des Klicks geht auf eine neue Fläche über, ohne die Ansicht zu wechseln; die Öffnung merkt sie sich. */
    function zeigeNeu(gezeigt: PresentedSelection, area: NonNullable<PresentedSelection["area"]>): void {
        const nachher: PresentedSelection = { ...gezeigt, area };
        if (last !== undefined && last.options.known !== undefined)
            last = { ...last, options: { ...last.options, known: { ...last.options.known, presentation: nachher } } };
        effects.present(nachher);
    }

    function load(ref: SubjectRef, key: string, open: OpenSubjectOptions, frisch = false): void {
        const token = round;
        const cached = frisch ? undefined : cache.get(key);
        if (cached !== undefined) {
            settle(token, key, cached, open, frisch);
            return;
        }
        const own = new AbortController();
        controller = own;
        client.detail(ref, own.signal, frisch).then(
            (answer) => {
                if (answer !== null) cache.set(key, answer);
                // Nach einer Änderung neu gelesen und weg (von der Karte genommen): Die Auswahl endet, statt „gibt es nicht“ zu sagen.
                if (answer === null && frisch && isCurrent(token, key)) {
                    closeSubject({ source: "link" });
                    return;
                }
                settle(token, key, answer, open, frisch);
            },
            (error: unknown) => {
                // Das Abbrechen ist kein Fehler; ein überholter Subject auch nicht.
                if (own.signal.aborted || !isCurrent(token, key)) return;
                if (!(error instanceof Error && error.name === "AbortError")) {
                    console.error("Infopanel: Subject nicht geladen", error);
                }
                shown.value = { ...(shown.value as ShownSubject), status: "error", answer: undefined };
            },
        );
    }

    function openSubject(ref: SubjectRef, open: OpenSubjectOptions): boolean {
        const accepted = openAccepted(ref, open);
        if (accepted) {
            // Was interessiert: Orte, Territorien, Wege … Gezählt wird die ART des Objekts, nie seine Kennung (WI-0138).
            melde("place_open", ref.kind);
            options.onOpened?.(ref, open);
        }
        return accepted;
    }

    function openAccepted(ref: SubjectRef, open: OpenSubjectOptions): boolean {
        // Eine fixierte Auswahl wechselt nicht durch einen Kartenklick (§4.11); Suche und Link sind bewusst.
        if (pinned.value && open.source === "map") return false;
        if (open.source !== "map") pinned.value = false;
        const key = subjectKey(ref);
        last = { ref, options: open };
        if (open.still !== true) reveal();

        const current = shown.value;
        const same = current !== undefined && (current.key === key || subjectKey(current.ref) === key);
        if (same && current.status !== "error") {
            // Derselbe Subject noch einmal: nichts neu fragen, nur die Darstellung und die Kamera nachführen.
            if (open.known?.presentation !== undefined) effects.present(open.known.presentation);
            if (open.camera === "target" && current.answer !== undefined) {
                effects.fly(current.ref, "target" in current.answer ? current.answer.target : undefined);
            }
            return true;
        }

        cancel();
        selected.value = ref;
        shown.value = {
            ref,
            key,
            title: open.known?.title,
            status: hasEndpoint(ref) ? "loading" : "ready",
            answer: undefined,
        };
        if (open.known?.presentation !== undefined) effects.present(open.known.presentation);
        else if (ref.kind === "mapPoint") effects.present({ pin: { x: ref.x, y: ref.y } });
        // Eine Etappe gehört dem Planer und ist dort schon gewählt: Was ein voriger Subject auf der Karte leuchten ließ
        // (Ort, Fläche, Tropfen), endet - es gibt nur EINEN gewählten Subject.
        else if (!hasEndpoint(ref)) effects.present({});

        if (!hasEndpoint(ref)) return true;
        // Eine Kartenstelle braucht für den Flug keine Antwort: Sie liegt, wo man hinzeigte.
        if (ref.kind === "mapPoint" && open.camera === "target") effects.fly(ref, undefined);
        load(ref, key, ref.kind === "mapPoint" ? { ...open, camera: "none" } : open);
        return true;
    }

    function closeSubject(close: { source: SubjectSource | "escape" } = { source: "map" }): boolean {
        if (pinned.value && close.source === "map") return false;
        cancel();
        last = undefined;
        pinned.value = false;
        selected.value = undefined;
        shown.value = undefined;
        // Der Slot ist zu, wenn nichts mehr zu zeigen ist; ein aktiver Editor bleibt, wie er ist.
        if (slot.value === "info") slot.value = "closed";
        collapsed.value = false;
        effects.clear();
        return true;
    }

    return {
        selected,
        shown,
        slot,
        collapsed,
        pinned,
        hasContent,
        panelVisible,
        editorVisible,
        slotOpen,
        toggleEditor() {
            if (slot.value === "editor") leaveEditor();
            else slot.value = "editor";
        },
        showEditor() {
            slot.value = "editor";
        },
        closeEditor() {
            if (slot.value === "editor") leaveEditor();
        },
        openSubject,
        closeSubject,
        auffrischen(ref) {
            // Nach einer Änderung gilt keine gespeicherte Antwort mehr, auch nicht für ein Subject, das gerade nicht offen ist: Sonst
            // zeigt es beim nächsten Öffnen den alten Stand (WI-0209, Betreiber 2026-10-19: „ich hab das herrschaftsgebiet umbenannt in
            // Valis reich, aber es heisst immer noch neues herrschaftsgebiet“).
            cache.clear();
            const current = shown.value;
            if (current === undefined || current.status !== "ready" || !hasEndpoint(current.ref)) return;
            if (ref !== undefined && subjectKey(ref) !== current.key && subjectKey(ref) !== subjectKey(current.ref))
                return;
            cancel();
            load(
                current.ref,
                current.key,
                { ...(last?.options ?? { source: "link" }), camera: "none", still: true },
                true,
            );
        },
        togglePanel() {
            if (!hasContent.value) return;
            if (slot.value === "editor") {
                slot.value = "info";
                collapsed.value = false;
                return;
            }
            if (slot.value !== "info") return;
            collapsed.value = !collapsed.value;
        },
        collapsePanel() {
            if (slot.value === "info") collapsed.value = true;
        },
        togglePin() {
            if (!canPin) return false;
            // Ohne Auswahl gibt es nichts festzuhalten.
            if (!hasContent.value) {
                pinned.value = false;
                return false;
            }
            pinned.value = !pinned.value;
            return true;
        },
        retry() {
            const wanted = last;
            if (wanted === undefined || shown.value?.status !== "error") return;
            // Dieselbe Öffnung noch einmal: Der Fehlschlag steht noch im Zustand, also zählt sie nicht als „derselbe“.
            const key = subjectKey(wanted.ref);
            cancel();
            shown.value = { ...(shown.value as ShownSubject), status: "loading" };
            load(wanted.ref, key, wanted.options);
        },
        escapeVisible() {
            if (!panelVisible.value) return false;
            return closeSubject({ source: "escape" });
        },
        escapeSelection() {
            closeSubject({ source: "escape" });
            return true;
        },
        destroy() {
            destroyed = true;
            controller?.abort();
        },
    };
}
