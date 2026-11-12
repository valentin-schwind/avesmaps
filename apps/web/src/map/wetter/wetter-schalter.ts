import { computed, readonly, ref, watch, type Ref } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
    departureDayOfYear,
    wetterDimension,
    wetterReisetag,
    wetterSchalterKennung,
    type MapView,
    type WetterGeraet,
    type WetterMetrik,
    type WetterPresetWerte,
    type WetterSymbolDaten,
} from "@avesmaps3d/shared";
import { t, type MessageKey } from "../../i18n/i18n";
import { melde } from "../../besuch/besuch-melden";
import { phoneViewport } from "../../controls/phone-viewport";
import { wikiNamensvorschlag } from "./wetter-wiki-name";
import type { MapInteractionCoordinator, Screen } from "../interaction/types";
import type { PointerHint } from "../pointer-hint";
import type { WetterEbene } from "./wetter-ebene";
import type { WetterInfoAnschluss } from "./wetter-info";
import type { WetterSymbol } from "./wetter-symbole";
import type { Reisebeginn } from "./wetter-jahr";

/**
 * Die Wetterschalter im Auge (WI-0288 Stufe 1): sechs gemalte Icons in der Gruppe „Wetter (experimentell)“ unter „Ebenen“, dazu die
 * Schneefallgrenze unter „Prüfen“ für Editoren. Dieses Modul hält nur den Zustand und entscheidet, ob das Wetter läuft; die Rechnung selbst
 * (`wetter-ebene.ts` mit der Engine) lädt es erst beim ersten Einschalten nach, auch im gebauten Paket.
 *
 * - 🔴 **Gemerkt je Browser** wie die Höhenlinien (`hoehenlinien-schalter.ts`): eine Gewohnheit der Person, nicht der Ansicht und
 *   nicht des Teilen-Links. Vorgabe: alles aus.
 * - **Nur in der Ansicht „Standard“** (Betreiber 2026-11-07). Außerhalb davon sind die Schalter gesperrt, die Wahl bleibt aber stehen
 *   und gilt wieder, sobald die Sperre fällt. Am Telefon läuft es seit 2026-11-08 mit gröberem Profil (Betreiber: „dass telefon nicht
 *   freigeschaltet ist, du kannst das probiere“; „wobei wir mit der qualität hier runter können - im gegensatz zum desktop“).
 * - Die Schneefallgrenze zählt nur, solange die Person Prüfhaken sehen darf (`editorChecks` im Auge): Ein gemerkter Haken aus einer
 *   Editorsitzung lädt für einen Besucher kein Wetter.
 */
export const WETTER_ANZEIGEN = [
    "schneedecke",
    "wolken",
    "regenUndSchnee",
    "wind",
    "stroemungen",
    "niederschlag",
] as const;
export type WetterAnzeige = (typeof WETTER_ANZEIGEN)[number];
/** Die Anzeigen und die Prüfung „Schneefallgrenze“. */
export type WetterSchalter = WetterAnzeige | "schneefallgrenze";
export type WetterStand = Readonly<Record<WetterSchalter, boolean>>;

const ALLE: readonly WetterSchalter[] = [...WETTER_ANZEIGEN, "schneefallgrenze"];
const STORAGE_KEY = "avesmaps3d.wetter";

export const WETTER_AUS: WetterStand = Object.freeze(
    Object.fromEntries(ALLE.map((id) => [id, false])) as Record<WetterSchalter, boolean>,
);

/** Gemerkt als Liste der eingeschalteten Schalter, durch Kommas getrennt; Unbekanntes fällt weg. */
export function liesWetterStand(speicher: Pick<Storage, "getItem"> | undefined): WetterStand {
    let text: string | null = null;
    try {
        text = speicher?.getItem(STORAGE_KEY) ?? null;
    } catch {
        // Ohne Speicher (privates Fenster) gilt die Vorgabe: alles aus.
    }
    const an = new Set((text ?? "").split(","));
    return Object.fromEntries(ALLE.map((id) => [id, an.has(id)])) as Record<WetterSchalter, boolean>;
}

export function schreibeWetterStand(speicher: Pick<Storage, "setItem"> | undefined, stand: WetterStand): void {
    try {
        speicher?.setItem(STORAGE_KEY, ALLE.filter((id) => stand[id]).join(","));
    } catch {
        // siehe liesWetterStand
    }
}

function browserSpeicher(): Storage | undefined {
    try {
        return globalThis.localStorage;
    } catch {
        return undefined;
    }
}

/** Der Tag im Jahr des Reisebeginns, oder `null` ohne Reisebeginn. */
export function wetterTag(reise: Reisebeginn): number | null {
    return reise ? departureDayOfYear(reise.month, reise.day) : null;
}

/**
 * Das Datum des Wetters (WI-0288 Stufe 5): der Reisebeginn plus die vergangenen Tage eines Replays (Rast eingeschlossen,
 * `JourneyPosition.days`; `null`, solange kein Pfeil auf der Karte steht), als Tag im Jahr mit Bruchteil. Über den 5. Namenlosen Tag geht
 * es zum 1. Praios. Hier und nicht im Chunk: Die Ebene bekommt es als Getter.
 */
export function wetterDatum(reise: Reisebeginn, reisetage: number | null | undefined): number | null {
    return wetterReisetag(wetterTag(reise), reisetage);
}

/**
 * Ein Link schaltet das Wetter ein (Betreiber 2026-11-08 auf die Frage, ob `?wetter=wolken,wind` gebaut werden soll: „Ja, bauen“):
 * `?wetter=` mit den Kennungen der Schalter durch Kommas (`schneedecke`, `wolken`, `regenUndSchnee`, `wind`, `stroemungen`,
 * `niederschlag`, `schneefallgrenze`; Groß- und Kleinschreibung egal), `?wetter=alle` die sechs Schalter des Auges, `?wetter=aus`
 * schaltet alles aus. Der Link setzt den Stand
 * dieses Seitenaufrufs GENAU so (was er nicht nennt, ist aus), überschreibt aber nicht still die gemerkte Wahl des Browsers: Gemerkt
 * wird erst, wenn die Person danach im Auge schaltet (dann der ganze Stand). Unbekanntes fällt weg; ein Link ohne eine einzige bekannte
 * Kennung (und nicht `aus`) ändert nichts. Die Teilen-Links tragen das Wetter weiter nicht von selbst mit.
 */
export function wetterStandAusAdresse(suche: string): WetterStand | undefined {
    let wert: string | null;
    try {
        wert = new URLSearchParams(suche).get("wetter");
    } catch {
        return undefined;
    }
    if (wert === null) return undefined;
    const teile = wert
        .split(",")
        .map((teil) => teil.trim().toLowerCase())
        .filter((teil) => teil !== "");
    if (teile.length === 1 && teile[0] === "aus") return WETTER_AUS;
    // „alle“ (Betreiber 2026-11-08: „mach aber alle optionen nicht nur wolken und wind (waren beispiele) des wettermoduls“): die sechs
    // Schalter des Auges; die Schneefallgrenze ist eine Prüfung für Editoren und kommt nur, wenn sie eigens genannt ist.
    const an = new Set<WetterSchalter>(
        teile.includes("alle") ? WETTER_ANZEIGEN : ALLE.filter((id) => teile.includes(id.toLowerCase())),
    );
    for (const id of ALLE) if (teile.includes(id.toLowerCase())) an.add(id);
    if (an.size === 0) return undefined;
    return Object.fromEntries(ALLE.map((id) => [id, an.has(id)])) as Record<WetterSchalter, boolean>;
}

/** Was die Person eingeschaltet hat, unabhängig von Ansicht und Gerät; ein Link mit `?wetter=` geht dem Gemerkten vor. */
export const wetterStand = ref<WetterStand>(
    wetterStandAusAdresse(globalThis.location?.search ?? "") ?? liesWetterStand(browserSpeicher()),
);

watch(wetterStand, (stand) => schreibeWetterStand(browserSpeicher(), stand));

export function setzeWetter(id: WetterSchalter, an: boolean): void {
    wetterStand.value = { ...wetterStand.value, [id]: an };
}

/**
 * Der Klick eines Menschen auf einen Wetterschalter im Auge: schaltet um UND zählt (WI-0288; Betreiber 2026-11-08: „schalten sie das
 * feature ein/aus“). Gezählt wird nur das Umschalten, nie der aus dem Browser gemerkte Startzustand und nie ein Wechsel durch die
 * Sperre der Ansicht: `setzeWetter` bleibt der stille Weg für alles, was nicht die Hand der Person ist.
 *
 * 🔴 Hier und nicht an einem `watch` auf `wetterStand`: Der Zustand wechselt auch ohne Wahl (Start, anderer Tab), und ein Sender
 * daran zählte, was niemand getan hat (WI-0159 §3.3).
 */
export function klickeWetter(id: WetterSchalter, an: boolean): void {
    setzeWetter(id, an);
    melde("display_toggle", wetterSchalterKennung(id, an));
}

/** Das Gerät des Wetters: dasselbe Urteil wie das Telefon-Profil der Engine (`phoneViewport`). */
export const wetterGeraet = (): WetterGeraet => (phoneViewport.value ? "telefon" : "rechner");

const wetterGemeldet = new Set<string>();
/**
 * Eine Wettermetrik melden, höchstens einmal je Seitenaufruf und `einmal` (Vorgabe: die Metrik; ein Fehler nimmt seine Art dazu).
 * Das Gerät kommt von hier. Die Messung selbst liegt im nachgeladenen Teil (`wetter-messung.ts`); hier steht nur, was auch der Fehler
 * beim Nachladen braucht.
 */
export function meldeWetterMetrik(metrik: WetterMetrik, klasse?: string, einmal: string = metrik): void {
    if (wetterGemeldet.has(einmal)) return;
    wetterGemeldet.add(einmal);
    melde(metrik, wetterDimension(wetterGeraet(), klasse));
}

/** Wann das Wetter zum ersten Mal anlief (`performance.now()`); der Start misst von hier bis zum ersten `bereit`. */
let wetterStartBeginn: number | undefined;
export const wetterStartZeit = (): number | undefined => wetterStartBeginn;

/**
 * Die Messzeile (Betreiber 2026-11-08: „wir sollten versuchen noch fürs handy zu benchmarken und zu optimieren“): `?wetterTelefon=1` in der
 * Adresse schaltet sie ein, `?wetterTelefon=0` wieder aus; gemerkt im Browser. Der Name stammt aus dem Telefon-Test, der bis dahin auch die
 * Sperre am Telefon aufhob; die gibt es seit der Freigabe nicht mehr (Betreiber 2026-11-08: „dass telefon nicht freigeschaltet ist, du kannst
 * das probiere“). Das Auge zeigt dann Bildrate, Wolkenauflösung, Takt und Grafikkarte und bietet den Messlauf an (`starteWetterMesslauf`).
 */
const MESSZEILE_KEY = "avesmaps3d.wetterTelefon";
function liesMesszeile(): boolean {
    try {
        const wahl = new URLSearchParams(globalThis.location?.search ?? "").get("wetterTelefon");
        const speicher = browserSpeicher();
        if (wahl === "1") speicher?.setItem(MESSZEILE_KEY, "1");
        if (wahl === "0") speicher?.removeItem(MESSZEILE_KEY);
        return speicher?.getItem(MESSZEILE_KEY) === "1";
    } catch {
        return false;
    }
}
export const wetterMesszeile = ref(liesMesszeile());

/** Die Messzeile: Bildrate, Wolkenauflösung, Takt, Grafikkarte; `null` ohne Messzeile. */
export interface WetterMessung {
    fps: number;
    anteil: number;
    takt: number;
    gpu: string;
}
const wetterMessungWert = ref<WetterMessung | null>(null);
export const wetterMessung: Readonly<Ref<WetterMessung | null>> = readonly(wetterMessungWert);
export function meldeWetterMessung(messung: WetterMessung | null): void {
    wetterMessungWert.value = messung;
}

/** Warum die Engine nicht zeichnen kann (etwa ohne Gleitkomma-Puffer); `null`, solange nichts schiefging. */
const wetterFehlerWert = ref<string | null>(null);
export const wetterFehler: Readonly<Ref<string | null>> = readonly(wetterFehlerWert);
export function meldeWetterFehler(text: string | null): void {
    wetterFehlerWert.value = text;
}

/**
 * Warum das Wetter gerade nicht geht, als Textschlüssel; `undefined`, wenn es gehen darf. Nur die Ansicht sperrt: Am Telefon läuft es seit
 * 2026-11-08 mit dem Telefon-Profil (`wetter-ebene.ts`).
 */
export function wetterSperre(ansicht: MapView): MessageKey | undefined {
    return ansicht === "standard" ? undefined : "display.lock.weatherView";
}

/**
 * Der Messlauf (Betreiber 2026-11-08: „wir sollten versuchen noch fürs handy zu benchmarken“): auf dem Gerät selbst, auf Knopfdruck in der
 * Messzeile. Er misst die Bildrate der Karte ohne und mit Wetter und die GPU-Zeit je Durchgang (`WetterEbene.messlauf`); das Ergebnis steht
 * als Text im Auge, zum Kopieren. `null`: kein Lauf, `"laeuft"`: er läuft.
 */
const wetterMesslaufWert = ref<"laeuft" | readonly string[] | null>(null);
export const wetterMesslauf: Readonly<Ref<"laeuft" | readonly string[] | null>> = readonly(wetterMesslaufWert);
let messbareEbene: WetterEbene | undefined;

export function starteWetterMesslauf(): void {
    if (wetterMesslaufWert.value === "laeuft") return;
    const ebene = messbareEbene;
    if (ebene === undefined) {
        wetterMesslaufWert.value = [t("display.weather.messlauf.ohne")];
        return;
    }
    wetterMesslaufWert.value = "laeuft";
    ebene
        .messlauf()
        .then((zeilen) => {
            wetterMesslaufWert.value = zeilen;
        })
        .catch((fehler: unknown) => {
            wetterMesslaufWert.value = [String(fehler)];
        });
}

/** Was wirkt: die gemerkte Wahl, die Schneefallgrenze nur mit dem Recht auf Prüfhaken. */
export function wirksamerWetterStand(stand: WetterStand, pruefen: boolean): WetterStand {
    return pruefen || !stand.schneefallgrenze ? stand : { ...stand, schneefallgrenze: false };
}

/** Läuft das Wetter? Nur wenn etwas an ist und keine Sperre greift; sonst wird die Engine weder geladen noch ausgeführt. */
export function wetterLaeuft(stand: WetterStand, ansicht: MapView): boolean {
    return ALLE.some((id) => stand[id]) && wetterSperre(ansicht) === undefined;
}

/**
 * Das Wettermodell der Systemsteuerung ist neu gespeichert (WI-0288 Stufe 4, `wettermodell/wettermodell.ts`). Läuft das Wetter in diesem
 * Browser, liest es den Leseweg neu und übernimmt die Werte der Folge `sofort` ohne Neuladen der Seite; die der Folge `neustart` stehen
 * danach in `cfg`, wirken aber erst, wenn die Engine neu entsteht (`wetter-ebene.ts`). Läuft es gerade nicht, liest es beim nächsten
 * Einschalten neu. Ein Zähler statt der Werte: Es gilt, was der Server gespeichert hat, nicht was die Ansicht zuletzt gezeigt hat.
 */
const wettermodellGespeichert = ref(0);

/** Wie oft das Wettermodell in diesem Browser gespeichert wurde; das Wasser in 3D (`map/wasser/`) liest dann seinen Glanz neu. */
export const wettermodellZaehler: Readonly<Ref<number>> = readonly(wettermodellGespeichert);

export function meldeWettermodellGespeichert(): void {
    wettermodellGespeichert.value += 1;
}

/**
 * Der Fortschritt beim ersten Einschalten (Betreiber 2026-11-08: „das erstmalige anzeigen des wetters dauert recht lang - können wir hier
 * vorladen … oder einen ladebalken anzeigen?“): 0 bis 1, `null`, solange nichts lädt. Der Code des Chunks zählt bis 0,1, danach die
 * Schritte der Engine (Höhen und Vegetation, Wolkenrauschen, Einschwingen; `meldung` in `engine/wetter-engine.ts`). Er geht nie zurück; ein
 * Fehler oder das Ende nimmt den Balken weg. Das Auge zeigt ihn unter den Wetter-Icons.
 */
const wetterLadenWert = ref<number | null>(null);
export const wetterLaden: Readonly<Ref<number | null>> = readonly(wetterLadenWert);

/** `anteil` ab 1 oder `undefined` (ein Fehler) beendet den Balken. */
export function meldeWetterFortschritt(anteil: number | undefined): void {
    wetterLadenWert.value =
        anteil === undefined || anteil >= 1 ? null : Math.max(wetterLadenWert.value ?? 0, Math.max(0, anteil));
}

/** Die Meldung der Engine (0 bis 1) auf den Balken: Der Code lag schon bei 0,1. */
export const engineFortschritt = (anteil: number | undefined): number | undefined =>
    anteil === undefined ? undefined : 0.1 + 0.9 * anteil;

/**
 * Der Name eines Icons mit Wiki-Verweis für Zeiger-Schild und vorläufigen Titel des Infopanels: sein Name, ohne ihn der Titel des Artikels ohne Klammerzusatz (wie der
 * Namensvorschlag des Editors). Den endgültigen Titel nennt die Antwort des Servers.
 */
export const wetterIconName = (symbol: Pick<WetterSymbol, "name" | "wiki">): string =>
    symbol.name.trim() !== "" ? symbol.name : wikiNamensvorschlag(symbol.wiki);

/** Das Zeiger-Schild eines Icons mit Wiki-Verweis: Name und Art (Guide P8: Jedes Kartenobjekt zeigt sich beim Zeigen). */
export function wetterIconSchild(symbol: Pick<WetterSymbol, "name" | "wiki" | "kind">, screen: Screen): PointerHint {
    return { name: wetterIconName(symbol), type: t(`wetterSymbol.art.${symbol.kind}`), screen };
}

/** Was ein Zug an einem Icon auf der Karte ändert: die Lage, Richtung und Stärke an der Pfeilspitze, die Reichweite am Ring. */
export type WetterZug = Partial<Pick<WetterSymbolDaten, "x" | "z" | "reichweite" | "staerke" | "richtung">>;

/**
 * Der Wetter-Editor an der Karte (WI-0288 Stufe 3): Solange sein Fenster offen ist, zeigt die Karte ALLE Icons als Griffe (ausgeblendete
 * grau), auch ohne Wetterschalter, und rechnet mit dem Stand des Editors, auch vor dem Speichern. Die Engine läuft dafür nicht: Sie läuft
 * nur mit einem Schalter im Auge, und dann übernimmt sie jede Änderung sofort.
 */
export interface WetterEditorAnschluss {
    readonly presets: readonly WetterPresetWerte[];
    readonly symbole: readonly WetterSymbolDaten[];
    /** Das gewählte Icon (oder Preset); ein gewähltes Icon trägt die Griffe für Richtung, Stärke und Reichweite. */
    readonly gewaehlt: string | undefined;
    /** Darf ziehen; sonst stehen die Icons nur da und lassen sich wählen. */
    readonly darf: boolean;
    waehle(id: string): void;
    /** Ein Zug an einem Icon; `fertig` beim Loslassen, dann speichert der Editor. */
    ziehe(id: string, zug: WetterZug, fertig: boolean): void;
}

export interface WetterUmgebung {
    /** Die Ansicht der Karte (`mapView` in `app.vue`). */
    ansicht: () => MapView;
    /** Der Reisebeginn des Planers; `null` heißt „unbestimmt“, dann gilt der Kartenstandard. */
    reisebeginn: () => Reisebeginn;
    /**
     * Die vergangenen Tage eines Replays samt Rast (`JourneyPosition.days` des Playmodes, WI-0288 Stufe 5), solange der Pfeil auf der Karte
     * steht; sonst `null`. Das Wetter gleitet damit mit dem Reisedatum.
     */
    reisetage?: () => number | null;
    /** Darf die Person Prüfhaken sehen (wie `editorChecks` im Auge)? */
    pruefen: () => boolean;
    /** Der Wetter-Editor, solange sein Fenster offen ist (reaktiv gelesen); sonst `undefined`. */
    editor?: () => WetterEditorAnschluss | undefined;
    /** Der Koordinator der Karte: Die Griffe des Editors melden sich dort an (`wetter-icon`). */
    interaction?: MapInteractionCoordinator | undefined;
    /**
     * Das Infopanel eines Icons mit Wiki-Verweis (Betreiber 2026-11-08: „ja infopanel bauen“): öffnen, Zeiger-Schild und welches gerade offen ist (reaktiv gelesen). Der
     * Besitzer `wetter-info` meldet sich mit der Ebene an; ohne Angabe öffnet ein Klick nichts.
     */
    info?: WetterInfoAnschluss | undefined;
}

/** Das Datum des Wetters ist ein Tag im Jahr mit Bruchteil (`wetterDatum`), `null` heißt „unbestimmt“. */
export type WetterEbenenBau = (
    map: MapLibreMap,
    datum: () => number | null,
    interaction: MapInteractionCoordinator | undefined,
    info?: WetterInfoAnschluss,
) => WetterEbene;

/**
 * Der eine dynamische Import: Engine, Jahreszeit, Kartenicons und der Leseweg liegen in einem eigenen Chunk. Mit ihm kommen Presets, Icons
 * und Wettermodell (`GET /api/wetter`, WI-0288 Stufe 2); ohne Antwort baut die Ebene mit den Vorgaben.
 */
const ladeWetterEbene = (): Promise<WetterEbenenBau> =>
    import("./wetter-ebene").then(async (m) => {
        const daten = await m.ladeWetterDaten();
        return (map, datum, interaction, info) => m.erzeugeWetterEbene(map, datum, daten, interaction, info);
    });

/**
 * Hängt das Wetter an die Karte. Solange nichts an ist (oder die Sperre greift), passiert nichts; beim ersten Einschalten lädt es
 * die Ebene nach und schaltet sie ein, sind alle aus oder wechselt die Ansicht, nimmt es sie von der Karte.
 *
 * Der Wetter-Editor (WI-0288 Stufe 3, `editor`) lädt die Ebene ebenso nach, schaltet aber nur ihre Icons ein, als Griffe; die Rechnung läuft
 * weiter allein mit einem Schalter im Auge. Jede Änderung des Editors geht sofort in die Ebene.
 */
export function installWetter(
    map: MapLibreMap,
    umgebung: WetterUmgebung,
    lade: () => Promise<WetterEbenenBau> = ladeWetterEbene,
): () => void {
    let ebene: WetterEbene | undefined;
    let laedt = false;
    let beendet = false;
    const wirksam = computed(() => wirksamerWetterStand(wetterStand.value, umgebung.pruefen()));
    const laeuft = computed(() => wetterLaeuft(wirksam.value, umgebung.ansicht()));
    // Der Editor zählt nur, wo es Wetter gibt: in der Ansicht „Standard“.
    const anschluss = computed(() =>
        wetterSperre(umgebung.ansicht()) === undefined ? umgebung.editor?.() : undefined,
    );
    const gebraucht = computed(() => laeuft.value || anschluss.value !== undefined);
    // Das Datum liest die Ebene in jedem Bild: der Reisebeginn, im Replay plus die vergangenen Reisetage (Stufe 5).
    const datum = (): number | null => wetterDatum(umgebung.reisebeginn(), umgebung.reisetage?.());
    // Lief das Wetter schon einmal und kommt es nach einer Pause wieder, liest es neu: So zeigt es, was Editoren inzwischen geändert haben.
    // Ebenso, wenn das Wettermodell gespeichert wurde, während die Ebene stand oder noch lud (`veraltet`).
    let lief = false;
    let schonEinmal = false;
    let veraltet = false;
    const neuLesen = (): void => {
        veraltet = false;
        ebene?.neuLesen().catch((fehler: unknown) => console.error("Wetter ließ sich nicht neu lesen", fehler));
    };
    const anwenden = (): void => {
        if (!ebene) return;
        ebene.setze(wirksam.value);
        if (laeuft.value) {
            if (!lief && (schonEinmal || veraltet)) neuLesen();
            ebene.ein();
            lief = true;
            schonEinmal = true;
            messbareEbene = ebene;
        } else {
            ebene.aus();
            lief = false;
            messbareEbene = undefined;
        }
        ebene.editor(anschluss.value);
    };
    const stop = watch(
        [wirksam, laeuft, anschluss],
        () => {
            if (ebene || !gebraucht.value) {
                anwenden();
                return;
            }
            if (laedt) return;
            laedt = true;
            // Der Balken nur, wenn die Rechnung anläuft; für die Griffe des Editors allein startet die Engine nicht.
            if (laeuft.value) {
                meldeWetterFortschritt(0.02);
                wetterStartBeginn ??= performance.now();
            }
            lade()
                .then((bau) => {
                    if (beendet) return;
                    meldeWetterFortschritt(laeuft.value ? 0.1 : 1);
                    ebene = bau(map, datum, umgebung.interaction, umgebung.info);
                    anwenden();
                })
                .catch((fehler: unknown) => {
                    meldeWetterFortschritt(undefined);
                    meldeWetterMetrik("wetter_fehler", "laden", "wetter_fehler:laden");
                    console.error("Wetter ließ sich nicht laden", fehler);
                })
                .finally(() => {
                    laedt = false;
                });
        },
        { immediate: true },
    );
    // Das Wettermodell der Systemsteuerung (Stufe 4): Läuft das Wetter, gilt das Gespeicherte sofort; sonst beim nächsten Einschalten.
    const stopModell = watch(wettermodellGespeichert, () => {
        if (ebene !== undefined && lief) neuLesen();
        else if (ebene !== undefined || laedt) veraltet = true;
    });
    // Das Icon, dessen Infopanel offen ist, trägt den Ton der Auswahl; die Ebene zeichnet es beim nächsten Bild.
    const stopOffen = watch(
        () => umgebung.info?.offen(),
        (id) => ebene?.offen(id),
    );
    return () => {
        beendet = true;
        messbareEbene = undefined;
        stop();
        stopModell();
        stopOffen();
        ebene?.editor(undefined);
        ebene?.aus();
    };
}
