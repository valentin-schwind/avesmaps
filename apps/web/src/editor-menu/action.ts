import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import type { MapView, SubjectKind, SubjectRef, ViewerCapability, ViewerContext } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";
import type { SubjectAnswer } from "../info-panel/subject-client";

/**
 * Das Register der Handgriffe als DATEN (WI-0063 15.2, Betreiber 2026-10-04; EDIT-0002 §6 Nr. 1 bis 3, EDIT-0003 G10, Schritt O1):
 * Jeder Handgriff ist ein Descriptor, und drei Stellen lesen dasselbe Register, ohne eine Objektart zu kennen:
 *
 * - das **Menü am Objekt** (Linksklick): nur, was gerade geht (`visibleActions`, WI-0063 4.2: keine toten Zeilen);
 * - der **Abschnitt im Kartenmenü** (Rechtsklick) und die **Gruppe „Bearbeiten · nur Editoren“ im Infopanel**: alles, was an dieser
 *   Stelle steht, Gesperrtes mit seinem Grund (`handgriffZeilen`).
 *
 * Es gibt keine `switch (kind)`-Kaskade in `app.vue` und keine Bedingung in einem Menü, die eine Art Subject kennt: Wer einen Handgriff
 * einhängt, schreibt einen Eintrag in die Datei seiner Objektart (`handgriffe-ort.ts`, später Weg und Fläche daneben), sonst nichts.
 * Die Folge an jedem Objekt ist dieselbe (`GRUPPEN_FOLGE`); die Wörter setzt der Betreiber je Objekt (EDIT-0003 T5).
 *
 * 🔴 Ein Descriptor ist vollständig oder er gilt nicht: Art, Fähigkeit, Gruppe, Beschriftung und Handler sind Pflicht
 * (`editor-menu-actions.test.ts`).
 */

/**
 * Die Arten, an denen ein Menü hängen kann: jede außer der Etappe. Eine Etappe öffnet ihre Information im Infopanel und nie ein
 * Menü (WI-0063 4.7); sie ist hier schon im Typ ausgeschlossen, und der Controller prüft es noch einmal.
 */
export type MenuSubjectKind = Exclude<SubjectKind, "routeStage"> | KraftlinienpunktRef["kind"];

/**
 * Ein Kraftlinienpunkt (`nodix.public_id`, ein Nodix ohne Ort und ohne Beschriftung) als Gegenstand NUR des Editor-Menüs (EDIT-0003 T52,
 * WI-0205): Er hat keine Information im Infopanel, keinen Link und keinen Flug; darum ist er kein `SubjectRef`, und der Typcheck hält
 * ihn von allem fern, was einen `SubjectRef` erwartet.
 */
export interface KraftlinienpunktRef {
    readonly kind: "kraftlinienpunkt";
    readonly id: string;
}

/** Wen ein Menü meint: ein Subject oder ein Kraftlinienpunkt. */
export type EditorMenuRef = SubjectRef | KraftlinienpunktRef;

/** Die Arten ohne Menü, als Laufzeitprüfung des Controllers. */
export const NO_MENU_KINDS: readonly EditorMenuRef["kind"][] = ["routeStage"];

/** Was ein Sichtbarkeitsprädikat und ein Handler über den Gegenstand wissen: seine Kennung, sein Name, seine Art und die Antwort. */
export interface EditorMenuSubject {
    readonly ref: EditorMenuRef;
    /** Der Name, wie das Infopanel ihn zeigt (eine namenlose Fläche heißt nach ihrer Art). */
    readonly title: string;
    /** Die Art in Worten („Metropole“, „Wald“); fehlt, solange die Antwort des Servers noch aussteht. */
    readonly art: string | undefined;
    /** Die Antwort des Servers, sobald sie da ist: Ein Prädikat darf auf Einzelheiten schauen (etwa ob ein Weg einen Verlauf hat). */
    readonly answer: SubjectAnswer | undefined;
}

export interface EditorActionContext {
    readonly subject: EditorMenuSubject;
    readonly viewer: ViewerContext;
    /** Bei einem Handgriff mit Auswahl (`auswahl`): was im Untermenü gewählt wurde. */
    readonly wahl?: string | undefined;
}

/**
 * Welche Handgriffe in einer Kartenansicht an einer Art NUR stehen (EDIT-0003 T39, Betreiber 2026-10-17, Ansicht „Kraftlinien“: „im
 * kraftlinien modus ist es nicht sinnvoll, dass man orte bearbeiten kann“; „Eigenschaften bearbeiten“ bleibt, weil dort die Einstellung
 * Nodix ist). 🔴 Keine allgemeine Regel: Für andere Ansichten sagt es der Betreiber („ich sags dann“); eine Ansicht ohne Zeile lässt
 * alles stehen. Die Ansicht ist die der Karte (`view` in der Adresse).
 */
export const HANDGRIFFE_JE_ANSICHT: Readonly<
    Partial<Record<MapView, Partial<Record<MenuSubjectKind, readonly string[]>>>>
> = {
    // „Aus der Linie nehmen ›“ am Nodix: Blatt Kraftlinien G, „entschieden“ (T28 (5), WI-0205 R5).
    powerlines: { place: ["ort-bearbeiten", "kraftlinie-neu", "kraftlinie-herausnehmen", "kraftlinie-entfernen"] },
};

/** Eine Wahl im Untermenü eines Handgriffs mit Auswahl (`auswahl`), etwa eine der Kraftlinien an einem Nodix. */
export interface HandgriffWahl {
    readonly id: string;
    readonly text: string;
    /** Leise rechts im Eintrag, etwa „außerhalb“ (ein Abschnitt außerhalb des Bilds, EDIT-0003 T49). */
    readonly hinweis?: string | undefined;
    /**
     * Zeigen lässt die Wahl auf der Karte leuchten (EDIT-0003 T49: der Abschnitt eines Wegs); das Menü meldet es seinem Besitzer. Am
     * Finger leuchtet das erste Tippen, das zweite wählt.
     */
    readonly vorschau?: true;
    /**
     * Warum diese Wahl gerade nicht geht („Unterpolygone löschen …“: die Hauptfläche bleibt); sie steht grau mit dem Grund und läuft nie.
     * Eine Wahl mit Grund meldet auch keine Vorschau.
     */
    readonly grund?: MessageKey;
}

/** Trennt den Handgriff von seiner Wahl in der Kennung eines Eintrags (`kraftlinie-entfernen#<Linie>`). */
export const WAHL_TRENNER = "#";

/**
 * Die Gruppen eines Objekts, in der Folge, die an jedem Objekt gilt (EDIT-0003 G10): Bearbeiten · Form · Sichtbarkeit und
 * Reihenfolge · Neues von hier aus · Entfernen (rot, zuletzt).
 */
export const GRUPPEN_FOLGE = ["bearbeiten", "form", "sichtbarkeit", "neu", "entfernen"] as const;
export type HandgriffGruppe = (typeof GRUPPEN_FOLGE)[number];

/** Die drei Stellen, die das Register lesen (EDIT-0002 §4.2). */
export type HandgriffStelle = "objekt" | "karte" | "infopanel";

export interface EditorAction {
    /** Eindeutig in der Registry; steht im `data-testid` des Eintrags. */
    readonly id: string;
    /** Für welche Arten von Subject die Action gilt. */
    readonly kinds: readonly MenuSubjectKind[];
    /**
     * Was der Betrachter dafür können muss (`viewer.can`). Das Menü am Objekt zeigt den Handgriff ohne sie gar nicht; Kartenmenü und
     * Infopanel zeigen ihn mit dem Grund aus `sperre`.
     */
    readonly capability: ViewerCapability;
    /** Die Stelle in der festen Folge (`GRUPPEN_FOLGE`). */
    readonly gruppe: HandgriffGruppe;
    /** Zwischenüberschrift im Untermenü, wo eines nötig ist (Fläche: Form, Mit anderer Fläche, Teilflächen …). */
    readonly abschnitt?: MessageKey;
    /**
     * Das Zeichen des Abschnitts, wo er als EIN Eintrag „… ›“ steht (`kartenmenue.ts`, nach Abschnitten); ohne Angabe das Zeichen des
     * ersten Handgriffs darin. Steht am ersten Handgriff des Abschnitts.
     */
    readonly abschnittZeichen?: EditorZeichenName;
    /** Wo er steht; ohne Angabe an allen drei Stellen. */
    readonly stellen?: readonly HandgriffStelle[];
    /** In welchen Kartenansichten er steht (`view`); ohne Angabe in jeder. Was eine Ansicht ausblendet, sagt `HANDGRIFFE_JE_ANSICHT`. */
    readonly ansichten?: readonly MapView[];
    /**
     * Ein Handgriff mit Auswahl: Im Kartenmenü steht er als „… ›“, sein Untermenü listet die Wahlen; `run` bekommt die gewählte
     * (`context.wahl`). Ohne Wahl steht er nicht da.
     */
    readonly auswahl?: (subject: EditorMenuSubject) => readonly HandgriffWahl[];
    /** Kürzel rechts im Eintrag. Für „Doppelklick“ nicht setzen: Das kommt aus `doppelklick`. */
    readonly hinweis?: MessageKey;
    /**
     * Diesen Handgriff löst der Doppelklick auf den Gegenstand aus (EDIT-0003 R3, `doppelklick.ts`); höchstens einer je Art. Er trägt
     * damit auch das Kürzel „Doppelklick“: Hinweis und Wirkung kommen aus demselben Feld und laufen nie auseinander.
     */
    readonly doppelklick?: true;
    /**
     * Warum er gerade nicht geht (kein Recht, Bearbeiten ausgeschaltet, ein Modus läuft, kommt später); ohne Grund geht er. Liest den
     * jetzigen Stand selbst (die Datei seiner Objektart bekommt ihn beim Erzeugen).
     */
    readonly sperre?: (subject: EditorMenuSubject) => MessageKey | undefined;
    /** Steht nur im Rechtsklick auf den Griff eines laufenden Modus (Stützpunkt löschen …), nie im Menü des Objekts. */
    readonly situativ?: true;
    /**
     * Zusätzlich zu Art und Fähigkeit: Gilt sie für DIESEN Gegenstand? Fehlt es, gilt sie für jeden dieser Art. 🪤 Beim Klick fehlt die
     * Antwort des Servers meist noch (`answer` ist `undefined`): Ein Prädikat, das Einzelheiten braucht, sagt dann `true` (die Zeile
     * verschwindet mit der Antwort wieder; bleibt keine, schließt das Menü) oder `false` (für diesen Klick öffnet das Menü nicht).
     */
    readonly visible?: (subject: EditorMenuSubject) => boolean;
    /** Schlüssel der Sprachtafel (`de.ts`, `en.ts`): Ein Text als Literal steht nie im Descriptor. Hängt er am Stand, eine Funktion. */
    readonly label: MessageKey | ((subject: EditorMenuSubject) => MessageKey);
    /** Ein Bild unter `/icons/…` (wie das Kartenmenü); ohne Angabe steht die Zeile ohne Bild da. */
    readonly icon?: string;
    /** Ein gezeichnetes Zeichen statt eines Bildes: die Handlungen nur für Editoren (`controls/editor-zeichen.vue`). */
    readonly zeichen?: EditorZeichenName | ((subject: EditorMenuSubject) => EditorZeichenName);
    /**
     * Gefahrstatus: Die Zeile trägt das Zeichen der Warnfarbe, und ihr Handler startet den eigenen Bestätigungsweg (WI-0063 18.4: „gefährliche
     * Actions nur mit ihrem normalen Safety-Flow“). Das Menü führt nie selbst etwas aus, das Daten ändert, und fragt nicht selbst nach.
     */
    readonly danger?: boolean;
    /** Was die Action tut. Das Menü ist vorher zu. */
    readonly run: (context: EditorActionContext) => void;
}

export const labelVon = (action: EditorAction, subject: EditorMenuSubject): MessageKey =>
    typeof action.label === "function" ? action.label(subject) : action.label;

export const zeichenVon = (action: EditorAction, subject: EditorMenuSubject): EditorZeichenName | undefined =>
    typeof action.zeichen === "function" ? action.zeichen(subject) : action.zeichen;

const stehtAn = (action: EditorAction, stelle: HandgriffStelle): boolean =>
    (action.stellen ?? ["objekt", "karte", "infopanel"]).includes(stelle);

/** Steht er in dieser Ansicht? Ohne Ansicht (Infopanel, Tests) gilt nur, was keine Ansicht verlangt. */
function inAnsicht(action: EditorAction, kind: MenuSubjectKind, ansicht: MapView | undefined): boolean {
    if (action.ansichten !== undefined && (ansicht === undefined || !action.ansichten.includes(ansicht))) return false;
    const nur = ansicht === undefined ? undefined : HANDGRIFFE_JE_ANSICHT[ansicht]?.[kind];
    return nur === undefined || nur.includes(action.id);
}

/** Die Handgriffe einer Art an einer Stelle, in der festen Folge der Gruppen (stabil: innerhalb einer Gruppe die Folge des Registers). */
function geordnet(
    actions: readonly EditorAction[],
    subject: EditorMenuSubject,
    stelle: HandgriffStelle,
    ansicht?: MapView,
): EditorAction[] {
    const kind = subject.ref.kind;
    if (NO_MENU_KINDS.includes(kind)) return [];
    const rang = (action: EditorAction): number => GRUPPEN_FOLGE.indexOf(action.gruppe);
    return actions
        .filter(
            (action) =>
                (action.kinds as readonly EditorMenuRef["kind"][]).includes(kind) &&
                stehtAn(action, stelle) &&
                inAnsicht(action, kind as MenuSubjectKind, ansicht) &&
                action.situativ !== true &&
                (action.visible?.(subject) ?? true) &&
                (action.auswahl === undefined || action.auswahl(subject).length > 0),
        )
        .map((action, i) => ({ action, i }))
        .sort((a, b) => rang(a.action) - rang(b.action) || a.i - b.i)
        .map(({ action }) => action);
}

/**
 * Das Menü am Objekt: die Handgriffe, die dieser Betrachter an diesem Gegenstand gerade ausführen kann, in der festen Folge. 🔴 Ein
 * leeres Ergebnis heißt: Es gibt kein Menü. Es steht nie leer oder voller ausgegrauter Zeilen da (Design Guide, „Leerzustand“: Das
 * Menü wird gar nicht geöffnet).
 */
export function visibleActions(
    actions: readonly EditorAction[],
    subject: EditorMenuSubject,
    viewer: ViewerContext,
    ansicht?: MapView,
): EditorAction[] {
    return geordnet(actions, subject, "objekt", ansicht).filter(
        (action) => viewer.can(action.capability) && action.sperre?.(subject) === undefined,
    );
}

/** Eine Zeile im Kartenmenü oder in der Gruppe des Infopanels: was dort steht, mit dem Grund, wenn es gerade nicht geht. */
export interface HandgriffZeile {
    readonly id: string;
    readonly text: MessageKey;
    readonly zeichen: EditorZeichenName | undefined;
    readonly grund: MessageKey | undefined;
    readonly gefahr: boolean;
    readonly hinweis: MessageKey | undefined;
    readonly abschnitt: MessageKey | undefined;
    readonly abschnittZeichen: EditorZeichenName | undefined;
    /** Bei einem Handgriff mit Auswahl: die Wahlen seines Untermenüs. */
    readonly auswahl?: readonly HandgriffWahl[] | undefined;
}

/** Kartenmenü und Infopanel: alles, was an dieser Stelle zu diesem Gegenstand gehört, Gesperrtes mit Grund (EDIT-0002 §4.2). */
/** Der Grund „ein Modus läuft“: Eine Zeile mit ihm steht nicht im Menü (EDIT-0003 T58 (3)). */
export const MODUS_LAEUFT = "ortseditor.handgriff.grund.laeuft";

export function handgriffZeilen(
    actions: readonly EditorAction[],
    subject: EditorMenuSubject,
    stelle: Exclude<HandgriffStelle, "objekt">,
    ansicht?: MapView,
): HandgriffZeile[] {
    // Im laufenden Modus fällt weg, was nicht geht, statt grau dazustehen (EDIT-0003 T58 (3), Regel 7): Was weitergeht, hat keinen
    // Grund „läuft“ (etwa Malen während „Gebietsform bearbeiten“ an derselben Landschaft).
    return geordnet(actions, subject, stelle, ansicht)
        .filter((action) => action.sperre?.(subject) !== MODUS_LAEUFT)
        .map((action) => ({
            id: action.id,
            text: labelVon(action, subject),
            zeichen: zeichenVon(action, subject),
            grund: action.sperre?.(subject),
            gefahr: action.danger === true,
            hinweis: action.hinweis ?? (action.doppelklick === true ? "editorMenu.kuerzel.doppelklick" : undefined),
            abschnitt: action.abschnitt,
            abschnittZeichen: action.abschnittZeichen,
            ...(action.auswahl !== undefined ? { auswahl: action.auswahl(subject) } : {}),
        }));
}

/**
 * Die Handgriffe am Griff eines laufenden Modus (`situativ`, EDIT-0003 G10, R7, T24 (3); Festlegung der Editor-Orchestrierung
 * 2026-10-17): Sie stehen nur im Rechtsklick auf den Griff (das Kartenmenü in der Form „nur Editor-Karte“), nie im Menü des Objekts,
 * Gesperrtes mit Grund. Folge wie im Register.
 */
export function griffZeilen(actions: readonly EditorAction[], subject: EditorMenuSubject): HandgriffZeile[] {
    const kind = subject.ref.kind;
    return actions
        .filter(
            (action) =>
                action.situativ === true &&
                (action.kinds as readonly EditorMenuRef["kind"][]).includes(kind) &&
                (action.visible?.(subject) ?? true),
        )
        .map((action) => ({
            id: action.id,
            text: labelVon(action, subject),
            zeichen: zeichenVon(action, subject),
            grund: action.sperre?.(subject),
            gefahr: action.danger === true,
            hinweis: action.hinweis,
            abschnitt: undefined,
            abschnittZeichen: undefined,
        }));
}

/** Bis so viele Handgriffe stehen im Kartenmenü flach; mehr stehen hinter EINEM Eintrag „… ›“ (EDIT-0003 G10). */
export const FLACH_BIS = 5;

/**
 * Führt einen Handgriff aus, den eine der Stellen gewählt hat; einen gesperrten oder unbekannten nie. Eine Kennung „<griff>#<wahl>“
 * trägt die Wahl eines Untermenüs; die muss der Handgriff gerade anbieten.
 */
export function fuehreAus(
    actions: readonly EditorAction[],
    id: string,
    subject: EditorMenuSubject,
    viewer: ViewerContext,
): boolean {
    const trenner = id.indexOf(WAHL_TRENNER);
    const griff = trenner < 0 ? id : id.slice(0, trenner);
    const wahl = trenner < 0 ? undefined : id.slice(trenner + 1);
    const action = actions.find((x) => x.id === griff);
    if (action === undefined || !viewer.can(action.capability) || action.sperre?.(subject) !== undefined) return false;
    if (
        action.auswahl !== undefined &&
        (wahl === undefined || !action.auswahl(subject).some((w) => w.id === wahl && w.grund === undefined))
    )
        return false;
    action.run({ subject, viewer, wahl });
    return true;
}
