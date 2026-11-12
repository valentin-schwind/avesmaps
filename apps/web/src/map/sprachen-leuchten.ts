import { ref, type InjectionKey, type Ref } from "vue";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { SubjectRef, SubjectTarget } from "@avesmaps3d/shared";
import { buildSprachSource, SPRACHE_LINE_LAYER_ID, SPRACHE_SOURCE_ID, SPRACHE_SOURCE_LAYER } from "./sprachen-layers";
import { ebenenWieAuswahl, kennungsFilter, UNTER_DIESEN } from "./such-leuchten";

/**
 * Das Leuchten der Flächen einer Sprache (WI-0261 S5c; Betreiber 2026-10-30: „sprachen sollen in der suche auftauchen und leuchten“; Bauvorlage: die Probierseite, `karte.js` `leuchtPfade`,
 * `Z.leuchtet`): die Teilflächen der Sprache in der Farbe der Auswahl, Füllung, weicher Schein und klare Kontur, also dasselbe Hausmuster wie das Leuchten der Vorkommen (`such-leuchten.ts`,
 * `ebenenWieAuswahl`).
 *
 * - **Kein Zuschnitt:** Die Sprachflächen sind eine eigene Kachelquelle (`sprache_flaeche_render`); ein Filter auf den Schlüssel der Sprache (`schluessel` der Kachel, derselbe wie beim Zeigen und
 *   bei der Legende) genügt. Alle Teilflächen leuchten, auch die ferne Insel.
 * - **Es ersetzt die Wahl:** Seit S5b stand die gewählte Sprache im Hausmuster (`buildSprachWahlLayers`). Das ist dasselbe Bild, und mit „Alle zeigen“ (Bauvorlage: `Z.leuchtet`) lässt es sich
 *   ausschalten; zwei Lagen übereinander wären doppelt so dicht, und der Schalter änderte kaum etwas. Darum gibt es nur noch diese eine Lage: Eine NEU gewählte Sprache leuchtet (Karte, Menü,
 *   Legende, Suche, Link), „Alle zeigen“ schaltet sie aus und wieder an.
 * - **Es bleibt in jeder Ebene:** Wie das Leuchten der Vorkommen hängt es am fertigen Stil (`withSprachLeuchten`) und bringt die Kachelquelle mit, wo die Ebene „Sprachen“ sie nicht stellt. Wer
 *   die Ansicht wechselt, behält das Gold, solange die Infobox der Sprache offen ist.
 * - **Es endet** mit der Infobox: jeder andere Gegenstand, ein Klick in die freie Karte und Escape rufen `folge(undefined)` (`app.vue`, `present` und `clearPresentation`), wie das Leuchten der
 *   Suche (`suchLeuchten.beende`).
 */

export const SPRACHE_LEUCHTEN_KENNUNG = "sprachen-leuchten";
export const SPRACHE_LEUCHTEN_FUELLUNG_ID = `${SPRACHE_LEUCHTEN_KENNUNG}-fuellung`;
export const SPRACHE_LEUCHTEN_SCHEIN_ID = `${SPRACHE_LEUCHTEN_KENNUNG}-schein`;
export const SPRACHE_LEUCHTEN_LINIE_ID = `${SPRACHE_LEUCHTEN_KENNUNG}-linie`;

/** Die Ebenen des Leuchtens (Füllung, Schein, Kontur) für die Sprachen mit diesen Schlüsseln; leer, wo keine leuchtet. */
export function buildSprachLeuchtenLayers(schluessel: readonly string[]): LayerSpecification[] {
    if (schluessel.length === 0) return [];
    return ebenenWieAuswahl(
        SPRACHE_LEUCHTEN_KENNUNG,
        {
            source: SPRACHE_SOURCE_ID,
            "source-layer": SPRACHE_SOURCE_LAYER,
            filter: kennungsFilter("schluessel", schluessel),
        },
        true,
    );
}

export interface SprachLeuchtenUmfeld {
    /** Die Kachelvorlage der Sprachflächen (mit Revision); fehlt sie, leuchtet nichts, wo die Ebene „Sprachen“ die Quelle nicht stellt. */
    readonly sprachenUrl?: string | undefined;
}

/**
 * Hängt das Leuchten an den Stil. In der Ebene „Sprachen“ liegt es direkt über der Kontur der Sprachen, unter dem Wasser und den Wegen (T-4: Die Zeichnung legt das Wasser über die
 * Sprachflächen); sonst vor den Marken und Namen, wie das Leuchten der Suche (`withSuchLeuchten`). Ohne leuchtende Sprache bleibt der Stil, wie er ist.
 */
export function withSprachLeuchten(
    style: StyleSpecification,
    schluessel: readonly string[],
    umfeld: SprachLeuchtenUmfeld = {},
): StyleSpecification {
    const neu = buildSprachLeuchtenLayers(schluessel);
    if (neu.length === 0) return style;
    const sources: StyleSpecification["sources"] = { ...style.sources };
    if (sources[SPRACHE_SOURCE_ID] === undefined) {
        if (umfeld.sprachenUrl === undefined) return style;
        sources[SPRACHE_SOURCE_ID] = buildSprachSource(umfeld.sprachenUrl);
    }
    const layers = [...style.layers];
    const nachKontur = layers.findIndex((layer) => layer.id === SPRACHE_LINE_LAYER_ID);
    const vorMarken = layers.findIndex((layer) => UNTER_DIESEN.some((anfang) => layer.id.startsWith(anfang)));
    const stelle = nachKontur >= 0 ? nachKontur + 1 : vorMarken < 0 ? layers.length : vorMarken;
    layers.splice(stelle, 0, ...neu);
    return { ...style, sources, layers };
}

export interface SprachLeuchten {
    /** Die Schlüssel der Sprachen, die leuchten (reaktiv: Der Stil entsteht neu, wenn sie wechseln). */
    readonly schluessel: Readonly<Ref<readonly string[]>>;
    leuchtet(schluessel: string): boolean;
    /**
     * Folgt der gewählten Sprache (`undefined`: keine gewählt). Eine NEU gewählte leuchtet; dieselbe wie zuletzt behält, was „Alle zeigen“ aus ihr gemacht hat: `present` ruft es bei jedem
     * Stand der Auswahl (zuerst mit dem, was die Karte weiß, dann mit der Antwort des Servers), und ein Abschalten dazwischen darf nicht wieder aufgehoben werden.
     */
    folge(gewaehlt: string | undefined): void;
    /** Die Sprache wurde bewusst gewählt (Klick, Menü, Legende, Suche): Sie leuchtet, auch wenn „Alle zeigen“ sie zuvor ausgeschaltet hatte (Bauvorlage: `oeffneSprache` setzt `Z.leuchtet` jedes Mal). */
    zeige(schluessel: string): void;
    /** Schaltet das Leuchten dieser Sprache um und gibt zurück, ob sie jetzt leuchtet. */
    schalte(schluessel: string): boolean;
    /** Beendet das Leuchten und das Folgen; `true`, wenn etwas leuchtete. */
    beende(): boolean;
}

/**
 * Was die Infobox einer Sprache vom Leuchten braucht (`info-panel/sprache-alle-zeigen.vue`, per `provide` aus `app.vue`): welche Sprachen leuchten, und „Alle zeigen“. Beim Einschalten fliegt die
 * Kamera auf das Ziel (`flug`: Gegenstand und Ziel der Antwort); ausgeschaltet bleibt sie, wo sie ist.
 */
export interface SprachLeuchtenZugang {
    readonly schluessel: Readonly<Ref<readonly string[]>>;
    schalte(schluessel: string, flug?: { ref: SubjectRef; target?: SubjectTarget }): void;
}
export const SPRACH_LEUCHTEN_ZUGANG: InjectionKey<SprachLeuchtenZugang> = Symbol("sprach-leuchten-zugang");

export function createSprachLeuchten(): SprachLeuchten {
    const schluessel = ref<readonly string[]>([]);
    let gefolgt: string | undefined;
    return {
        schluessel,
        leuchtet: (gesucht) => schluessel.value.includes(gesucht),
        folge(gewaehlt) {
            if (gewaehlt === gefolgt) return;
            gefolgt = gewaehlt;
            schluessel.value = gewaehlt === undefined ? [] : [gewaehlt];
        },
        zeige(gewaehlt) {
            gefolgt = gewaehlt;
            schluessel.value = [gewaehlt];
        },
        schalte(gesucht) {
            const an = !schluessel.value.includes(gesucht);
            schluessel.value = an ? [gesucht] : [];
            return an;
        },
        beende() {
            const war = schluessel.value.length > 0;
            gefolgt = undefined;
            if (war) schluessel.value = [];
            return war;
        },
    };
}
