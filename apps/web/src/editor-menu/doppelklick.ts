import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { MessageKey } from "../i18n/i18n";
import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, HitContext, MapInteractionCoordinator } from "../map/interaction/types";
import type { ViewerContext } from "@avesmaps3d/shared";
import type { ChoiceList } from "../controls/choice-list";
import { fuehreAus, type EditorAction, type EditorMenuSubject } from "./action";

/**
 * Der gemeinsame Doppelklick auf Objekte der Karte (WI-0177; EDIT-0003 R3 und T19, Zuteilung der Orchestrierung 2026-10-16: einmal für
 * alle Editoren). Ein Besitzer `object-dblclick` im Koordinator, nur im Editor angemeldet:
 *
 * - **Auf ein Objekt** löst er den Handgriff aus, der am Gegenstand `doppelklick: true` trägt: am Weg „Wegkurve bearbeiten“, an der
 *   Fläche „Gebietsform bearbeiten“, an der Kraftlinie ihre Form, am Ort und am Nodix die Eigenschaften. Dasselbe Feld setzt im Menü
 *   das Kürzel „Doppelklick“ (`handgriffZeilen`): Der Hinweis steht nie neben einem anderen Eintrag als dem, was der Doppelklick tut.
 *   Gesucht wird wie im Kartenmenü: Ort vor Weg vor Fläche; ein Herrschaftsgebiet ist eine Fläche, und es zählt nur, was das Band dort
 *   zeigt (WI-0209 A4). Liegen mehrere Flächen unter dem Zeiger, kommt zuerst „Welche Fläche bearbeiten?“ (EDIT-0003 §2a), die
 *   Flächenliste mit eigener Überschrift.
 * - **Im Modus ins Leere** heißt er „Fertig“ (R3, Betreiber 2026-10-16). Was dem Modus gehört (Anfasser, Kante), bekommt der Modus
 *   selbst: Er steht im Rang darüber (`geometry-edit`). Seit T59 (OPS-000043, 2026-10-20) gehört ihm in einer bearbeiteten Fläche
 *   oder einem Gebiet auch das Innere und ein Saum von 22 px neben der Kante: Dort setzt der Doppelklick einen Punkt wie in Legacy
 *   (`map/geometrie/modus.ts`), „Fertig“ heißt er erst weiter draußen. Nimmt der Modus einen Klick, zählt er hier nicht mit.
 * - Ist der Handgriff gesperrt (kein Recht, Bearbeiten aus, ein anderer hält die Sperre), sagt der Doppelklick warum.
 *
 * 🔴 Der Koordinator verteilt Klicks, also zählt der Besitzer zwei Klicks am selben Fleck selbst (wie `map/geometrie/modus.ts`). Den
 * ersten lässt er durch: Er wählt wie jeder Klick. Den zweiten nimmt er, damit er nicht die Auswahl weiterdreht (übereinanderliegende
 * Flächen, der Abschnitt eines Wegs) und der Doppelklick dem Objekt gilt, das der erste gewählt hat.
 * 🔴 Die Doppelklick-Zoomung der Karte ist im Editormodus ganz aus (`app.vue`, Thomas 2026-10-19 über die Editor-Orchestrierung): Ein
 * Doppelklick in die freie Karte zoomt dort nicht. Das `preventDefault` hier bleibt als Sicherung.
 */

/** Zwei Klicks in dieser Zeit und Nähe sind ein Doppelklick (wie im Geometrie-Modul). */
export const DOPPELKLICK_MS = 400;
export const DOPPELKLICK_PX = 6;

/** Was unter dem Zeiger liegt: ein einzelner Gegenstand (Ort, Weg …) oder die Flächen dort. */
export interface DoppelklickZiel {
    readonly einzeln?: EditorMenuSubject | undefined;
    readonly flaechen: readonly EditorMenuSubject[];
}

export interface DoppelklickSeite {
    /** Nimmt der Doppelklick teil? Nur im Editor. */
    aktiv(): boolean;
    /** Die Ebenen, die `ziel` aus dem Treffer lesen will (die Ortsmarken). */
    layers(): readonly string[];
    /** Der laufende Modus, wenn einer läuft: Ins Leere heißt der Doppelklick „Fertig“. */
    modus(): { fertig(): void } | undefined;
    ziel(context: HitContext): DoppelklickZiel;
    actions(): readonly EditorAction[];
    readonly viewer: ViewerContext;
    /** Mehrere Flächen: die Liste „Welche Fläche bearbeiten?“ öffnen. */
    waehle(flaechen: readonly EditorMenuSubject[], screen: { x: number; y: number }): void;
    /** Der Handgriff ist gesperrt: den Grund sagen. */
    grund(text: MessageKey): void;
    /**
     * Die Ansicht stellen, bevor der Handgriff wirkt (EDIT-0003 T32 (1), über `ansichtFuerHinflug`): am Herrschaftsgebiet „Politisch“
     * (WI-0209 A4), auch in einer Ansicht, die Gebiete nur dazugeschaltet zeigt. Ohne Angabe bleibt die Ansicht.
     */
    ansicht?(subject: EditorMenuSubject): void;
    jetzt?(): number;
}

/** Der Handgriff, den ein Doppelklick an diesem Gegenstand auslöst: der erste mit `doppelklick`, den der Betrachter kennt. */
export function doppelklickGriff(
    actions: readonly EditorAction[],
    subject: EditorMenuSubject,
    viewer: ViewerContext,
): EditorAction | undefined {
    return actions.find(
        (action) =>
            action.doppelklick === true &&
            (action.kinds as readonly string[]).includes(subject.ref.kind) &&
            viewer.can(action.capability) &&
            (action.visible?.(subject) ?? true),
    );
}

/** Den Doppelklick-Handgriff eines Gegenstands auslösen; gesperrt sagt er warum. Gibt zurück, ob es einen gab. */
export function loeseAusAn(
    seite: Pick<DoppelklickSeite, "actions" | "viewer" | "grund" | "ansicht">,
    subject: EditorMenuSubject,
): boolean {
    const actions = seite.actions();
    const griff = doppelklickGriff(actions, subject, seite.viewer);
    if (griff === undefined) return false;
    seite.ansicht?.(subject);
    const grund = griff.sperre?.(subject);
    if (grund !== undefined) seite.grund(grund);
    else fuehreAus(actions, griff.id, subject, seite.viewer);
    return true;
}

/** Was der zweite Klick tut. Gibt zurück, ob er etwas tat (sonst zoomt die Karte wie immer). */
export function doppelklick(seite: DoppelklickSeite, context: HitContext): boolean {
    const modus = seite.modus();
    if (modus !== undefined) {
        modus.fertig();
        return true;
    }
    const ziel = seite.ziel(context);
    if (ziel.einzeln !== undefined) return loeseAusAn(seite, ziel.einzeln);
    const [erste] = ziel.flaechen;
    if (erste === undefined) return false;
    if (ziel.flaechen.length === 1) return loeseAusAn(seite, erste);
    // Nur Flächen, an denen der Doppelklick etwas tut, kommen in die Liste.
    const mit = ziel.flaechen.filter((f) => doppelklickGriff(seite.actions(), f, seite.viewer) !== undefined);
    if (mit.length === 0) return false;
    if (mit.length === 1) return loeseAusAn(seite, mit[0]!);
    seite.waehle(mit, context.screen);
    return true;
}

/** Meldet den Besitzer an und sperrt die Zoomung der Karte für jeden Doppelklick, der etwas tat. Gibt die Abmeldung zurück. */
export function installObjektDoppelklick(
    map: MapLibreMap,
    coordinator: MapInteractionCoordinator,
    seite: DoppelklickSeite,
): () => void {
    const jetzt = seite.jetzt ?? ((): number => performance.now());
    let vorher: { zeit: number; x: number; y: number } | undefined;
    /** Wann der letzte Doppelklick etwas tat: Das `dblclick` der Karte kommt gleich danach. */
    let getan: number | undefined;
    // Den zweiten Klick in die Fläche nahm der Modus (T59): Ein dritter am selben Fleck ist dann kein Doppelklick „Fertig“. Ebenso der Klick, der das Gebiet wechselte (OPS-000077): Ein
    // zweiter Klick aus alter Gewohnheit beendete sonst gleich das neue Gebiet.
    const beobachtung = coordinator.observe("click", ({ claimedBy }) => {
        if (claimedBy === "geometry-edit" || claimedBy === "gebiet-wechsel") vorher = undefined;
    });
    const abmelden = coordinator.register({
        id: "object-dblclick",
        priority: INTERACTION_PRIORITY["object-dblclick"],
        kinds: ["click"],
        layers: () => seite.layers(),
        enabled: () => seite.aktiv(),
        hit(context): Claim | undefined {
            const zeit = jetzt();
            const zweiter =
                vorher !== undefined &&
                zeit - vorher.zeit <= DOPPELKLICK_MS &&
                Math.hypot(context.point.x - vorher.x, context.point.y - vorher.y) <= DOPPELKLICK_PX;
            // Ein dritter Klick beginnt wieder von vorn.
            vorher = zweiter ? undefined : { zeit, x: context.point.x, y: context.point.y };
            return zweiter ? {} : undefined;
        },
        apply(_kind, _claim, context) {
            if (doppelklick(seite, context)) getan = jetzt();
        },
    });
    const zoom = (event: MapMouseEvent): void => {
        if (getan !== undefined && jetzt() - getan <= DOPPELKLICK_MS) event.preventDefault();
        getan = undefined;
    };
    map.on("dblclick", zoom);
    return () => {
        abmelden();
        beobachtung();
        map.off("dblclick", zoom);
    };
}

/** Die Liste „Welche Fläche bearbeiten?“: dieselbe Flächenliste wie beim Klick (`area-choice-menu.vue`), mit eigener Überschrift. */
export function flaechenWahlListe(
    flaechen: readonly EditorMenuSubject[],
    screen: { x: number; y: number },
    uebersetze: (key: MessageKey) => string,
): ChoiceList {
    return {
        // Landschaften oder Herrschaftsgebiete (WI-0209 A4): je mit ihrer Kennung.
        entries: flaechen.map((f) => ({
            id: f.ref.kind === "area" || f.ref.kind === "territory" ? f.ref.id : "",
            name: f.title,
            type: f.art ?? "",
        })),
        screen,
        title: uebersetze("editorMenu.doppelklick.welcheFlaeche"),
        label: uebersetze("editorMenu.doppelklick.welcheFlaeche"),
        testid: "doppelklick-flaechen",
        itemTestid: "doppelklick-flaeche",
    };
}
