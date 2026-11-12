import type { Insets } from "../map/camera/visible-area";
import type { FensterLage } from "./fenster-verwaltung";
import type { FensterBox } from "../fenster/fenster-lage";

/**
 * Wohin ein Hinflug aus einem Editor zielt (WI-0128 E7; EDIT-0001 §4.5, W5, T7.2, T7.9; seit WI-0218 für ALLE Editoren): in die freie
 * Kartenfläche, wie sie NACH der Landung ist, nicht wie sie jetzt ist. 🔴 EINE Rechnung für Orte, Wege, Landschaften, Herrschaftsgebiete
 * und Kraftlinien (WI-0218 Nachbesserung; Betreiber 2026-10-17 über die Orchestrierung: „ok, aber beachte dass bei angedockten editoren
 * ein klick auf die ziel objekte ebenfalls nicht in der bildmitte erfolgen sollen“): Doppelklick und Enter in der Liste, „zeigen“ im
 * Fenster und der Klick auf der Karte, der ein Fenster öffnet. Bis zur Nachbesserung rechnete nur der Ortseditor so; die übrigen vier
 * landeten bei Planer und angedocktem Fenster in der Bildmitte, unter der linken Kante des Fensters.
 *
 * Die Ränder sind ALLES, was nach der Landung gedeckt ist: die Panels (`covered`, roh, ohne die Regeln der sichtbaren Fläche für die
 * Mitte) und das Fenster. 🪤 Die sichtbare Fläche lässt zwei Panels einander gegenüber fallen, wenn sie zusammen mehr als 60 % decken;
 * Planer und angedocktes Fenster tun das schon auf Full HD, und das Ziel landete dann neben der Lücke statt in ihrer Mitte. Bleibt
 * zwischen ihnen keine Lücke (1280 px), zielt die Kamera wie ohne Angabe (`camera.ts`).
 *
 * - **angedockt:** rechts die Breite des angedockten Fensters (Kanon `fenster.breite.werkzeug`, das Wege-Fenster `fenster.breite.wege`;
 *   höchstens der Rahmen ohne Lasche).
 * - **gelöst:** die größere Seite neben dem Fenster, links oder rechts davon, ohne die Panels. Das Fenster ist kein Rand, es deckt
 *   eine Insel; die Kamera zielt in die größere Lücke daneben.
 * - **versenkt:** nur die Panels: Die Karte ist bis auf das Editorpanel frei.
 */

/**
 * Wo das Fenster nach der Landung steht. `box` wie die Fensterverwaltung sie führt (im Rahmen der Seite), nur gelöst; `id`, wenn
 * das Fenster schon offen ist: Dann gilt, wo es wirklich steht. Ohne beides ist die Stelle eines gelösten Fensters unbekannt.
 */
export interface Ziellage {
    readonly lage: FensterLage;
    readonly box?: FensterBox | undefined;
    readonly id?: string | undefined;
    /** Das Werkzeug des Fensters: Es nennt seine Kanonbreite, wenn die nicht `werkzeug` ist (`BREITE_JE_WERKZEUG`). */
    readonly werkzeug?: string | undefined;
}

/**
 * Die Fenster, die nicht `fenster.breite.werkzeug` breit sind, mit der Variablen ihrer Breite: das Wege-Fenster (WI-0177, Betreiber
 * 2026-10-19: Eigenschaften breiter; `breite="wege"` in `wegeditor-fenster.vue`). Fehlt ein Werkzeug hier, gilt `werkzeug`.
 */
const BREITE_JE_WERKZEUG: Readonly<Record<string, string>> = { wegeditor: "--avm-fenster-wege" };

/** Ein Rechteck in Bildschirmkoordinaten (wie `getBoundingClientRect`). */
export interface Rechteck {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

export interface Bildschirm {
    /** Die Karte auf dem Schirm. */
    readonly karte: Rechteck;
    /** Die rechte Kante des Rahmens, an der ein angedocktes Fenster steht, in Bildschirmkoordinaten. */
    readonly rechteKante: number;
    /** Die Breite eines angedockten Werkzeugfensters, wie die Hülle sie zeichnet. */
    readonly angedockt: number;
    /** Was die Panels jetzt wirklich decken (`covered`), in Kartenpixeln. */
    readonly bedeckt: Insets;
}

/**
 * Die Ränder der Karte, die nach der Landung gedeckt sind, in Kartenpixeln: die Panels und das Fenster. `box` ist hier das gelöste
 * Fenster in Bildschirmkoordinaten (gemessen oder umgerechnet).
 */
export function freiNachLandung(ziel: { lage: FensterLage; box?: Rechteck | undefined }, schirm: Bildschirm): Insets {
    const { karte, bedeckt } = schirm;
    const mit = (fenster: Partial<Insets>): Insets => ({
        top: Math.max(bedeckt.top, fenster.top ?? 0),
        right: Math.max(bedeckt.right, fenster.right ?? 0),
        bottom: Math.max(bedeckt.bottom, fenster.bottom ?? 0),
        left: Math.max(bedeckt.left, fenster.left ?? 0),
    });
    if (ziel.lage === "angedockt") {
        const kante = schirm.rechteKante - schirm.angedockt;
        return mit({ right: Math.max(0, karte.left + karte.width - kante) });
    }
    if (ziel.lage === "geloest" && ziel.box !== undefined) {
        const links = ziel.box.left - karte.left;
        const rechts = links + ziel.box.width;
        const platzLinks = links - bedeckt.left;
        const platzRechts = karte.width - bedeckt.right - rechts;
        return mit(
            platzLinks >= platzRechts ? { right: Math.max(0, karte.width - links) } : { left: Math.max(0, rechts) },
        );
    }
    return { ...bedeckt };
}

/** Was die Seite für die Rechnung misst: die Karte, die Panels, ein schon gezeichnetes Fenster und die Liste des Fensters. */
export interface Umgebung {
    /** Der Kasten der Karte (`map.getContainer()`); der Rahmen der Seite ist sein `.app`. */
    readonly karte: HTMLElement;
    /** Was die Panels jetzt wirklich decken (`VisibleArea.covered`). */
    bedeckt(): Insets;
    /** Das Fenster mit dieser Kennung, wenn es schon gezeichnet ist: Ein gelöstes gilt dann, wo es wirklich steht. */
    gezeichnet(id: string): HTMLElement | null;
    /** Um wie viele Pixel die Liste dieses Fensters eingezogen ist (`ListenSchalter.einzug`): So viel schmaler steht es angedockt (P1). */
    einzug(id: string | undefined): number;
}

/** Die freie Fläche nach der Landung, gemessen an der Seite: Karte, Rahmen, die Breite eines angedockten Fensters, ein gelöstes Fenster. */
export function freiFuer(ziel: Ziellage, umgebung: Umgebung): Insets {
    const karte = umgebung.karte.getBoundingClientRect();
    const rahmen = (umgebung.karte.closest<HTMLElement>(".app") ?? document.body).getBoundingClientRect();
    const wurzel = getComputedStyle(document.documentElement);
    const px = (name: string): number => Number.parseFloat(wurzel.getPropertyValue(name)) || 0;
    const offen = ziel.id === undefined ? null : umgebung.gezeichnet(ziel.id);
    const box =
        ziel.lage !== "geloest"
            ? undefined
            : offen
              ? offen.getBoundingClientRect()
              : ziel.box && { ...ziel.box, left: ziel.box.left + rahmen.left, top: ziel.box.top + rahmen.top };
    return freiNachLandung(
        { lage: ziel.lage, box },
        {
            karte,
            rechteKante: rahmen.right,
            angedockt: Math.min(
                px(BREITE_JE_WERKZEUG[ziel.werkzeug ?? ""] ?? "--avm-fenster-werkzeug") -
                    (ziel.lage === "angedockt" ? umgebung.einzug(ziel.id) : 0),
                rahmen.width - px("--avesmaps-tab-w"),
            ),
            bedeckt: umgebung.bedeckt(),
        },
    );
}
