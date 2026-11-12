import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { MercatorCoordinate } from "maplibre-gl";
import {
    WETTER_SYMBOL_GRENZEN,
    departureDayOfYear,
    wetterFreierTag,
    wetterJahrWert,
    wetterNeuePresetWerte,
    wetterSymbolName,
    wetterWikiTitel,
    type DepartureMonth,
    type OperationReceipt,
    type WetterJahrSpalte,
    type WetterPreset,
    type WetterPresetWerte,
    type WetterSymbol,
    type WetterSymbolAenderungen,
    type WetterSymbolArt,
    type WetterSymbolDaten,
    type WetterWikiArtikel,
} from "@avesmaps3d/shared";
import { createListenEinstellung, type ListenEinstellung } from "../editor-liste/listen-einstellung";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";
import type { ApiFehler } from "../fenster/entwurf-senden";
import { t } from "../i18n/i18n";
import type { WetterEditorAnschluss, WetterZug } from "../map/wetter/wetter-schalter";
import { createWetterEditorApi, type WetterEditorApi } from "./wetter-editor-daten";
import {
    WETTER_LISTE,
    WETTER_SORTIERUNGEN,
    aufSchritt,
    geltungAm,
    istEntfernbar,
    mitAngelegtem,
    mitZeitpunkt,
    neuesSymbol,
    tauschHinweis,
    zeitpunktFolge,
    type WetterBestand,
} from "./wetter-editor-modell";
import { createWetterSpeicher, type WetterSpeicher, type WetterZiel } from "./wetter-speicher";

/**
 * Der Wetter-Editor (WI-0288 Stufe 3): EIN Werkzeugfenster für das ganze Wetter, links die Liste (Presets und Icons), rechts die
 * Eigenschaften des Gewählten. Diese Steuerung hält den Stand, schreibt ihn und verbindet ihn mit der Karte; das Fenster
 * (`wettereditor-fenster.vue`) zeichnet nur.
 *
 * - **Speichern sofort, ohne Knopf** (Betreiber 2026-11-07): jede Änderung gleich im Stand (Liste, Fenster, Karte, Rechnung), geschrieben
 *   entprellt mit `baseRevision` (`wetter-speicher.ts`). Die erste Änderung schreibt serverseitig alle Vorgaben mit (Stufe 2).
 * - **Konflikt** (409): Der Editor sagt es und lädt den Stand neu; was nicht gespeichert war, ist verloren. Jeder andere Fehler ebenso, mit
 *   dem Satz des Servers.
 * - **Zeitpunkt** (Idee B): Ein freier Tag gilt gleich; ein Tausch (ein belegter Tag oder „Unbestimmt“) fragt erst. Nach dem Tausch steht ein
 *   Satz mit „↺ Zurücknehmen“ da. Das unbestimmte Preset auf einen freien Tag geht nicht; der Satz sagt, wie man es macht.
 * - **Icons** legt der Knopf ✚ an der freien Kartenmitte an; Entfernen fragt (weich, `entfernen`).
 * - **Presets anlegen** (Betreiber 2026-11-08: „neben wind, wirbel und meeresströmungen will auch neue presets erlauben. solang es ein datum hat,
 *   interpolieren die einstellungen automatisch mit den andern.“): ✚ „Preset“ legt eines an einem freien Tag an, ohne Entwurf; der Tag ist der
 *   Reisebeginn, wenn der frei ist, sonst die Mitte der größten Lücke (`wetterFreierTag`). Die Werte rechnet der Server aus dem gespeicherten Stand
 *   (die am Tag übergeblendeten, `wetterNeuePresetWerte`); die Anzeige rechnet bis zum nächsten Laden dieselbe Regel. Entfernen (mit Frage) gibt es nur
 *   für angelegte Presets, die nicht gerade der Kartenstandard sind; die 14 festen bleiben. Gezogen wird auf der Karte
 *   (`map/wetter/wetter-griffe.ts`), solange das Fenster offen und nicht abgelegt ist.
 * - **Wiki-Artikel am Icon** (Stufe 6): ein Feld wie jedes andere (`wikiTitel`, sofort gespeichert); die Liste der Artikel lädt erst, wenn das Feld sie braucht
 *   (`ladeWikiArtikel`), und einmal je Sitzung des Editors.
 * - 🪤 Keine Sperre während der Bearbeitung und kein Entwurf mit „Fertig“ (EDIT-0003 G4, G5): Das Wetter speichert sofort, Revisionen fangen
 *   gleichzeitige Arbeit. Mit der Editor-Orchestrierung abzustimmen, bevor es auf `origin` geht (WI-0288 „Stand“).
 * - **Wie die übrigen Editoren** (Betreiber 2026-11-08: „der wettereditor ist noch nicht so wie die andern editoren“): Suche, Filter, Sortierung
 *   und Rollstand der Liste hält die Steuerung (`listenEinstellung`), damit sie nach dem Schließen und Wiederöffnen bleiben; die Handgriffe des
 *   Kartenmenüs (`editor-menu/handgriffe-wetter.ts`) öffnen das Fenster an einem Icon (`oeffneFuer`) und schalten seine Sichtbarkeit
 *   (`setzeSichtbar`), auch bevor der Stand gelesen ist.
 */

export const WETTEREDITOR_WERKZEUG = "wettereditor";
const GEGENSTAND = "wetter";

export interface WetterMeldung {
    readonly ton: "warnung" | "gefahr";
    readonly text: string;
}

export interface WetterTausch {
    readonly id: string;
    readonly mit: string;
    readonly ziel: number | null;
}

export interface WetterTauschHinweis {
    readonly id: string;
    readonly satz: string;
    /** „↺ Zurücknehmen“ legt das Preset wieder hierhin (und tauscht damit zurück). */
    readonly zurueck: number | null;
}

export interface WettereditorOptionen {
    readonly werkzeugfenster: Werkzeugfenster;
    /** Darf diese Sitzung das Wetter schreiben (`edit_weather`)? */
    readonly darf: () => boolean;
    /** Der Reisebeginn des Planers; ohne ihn gilt auf der Karte „Unbestimmt“. */
    readonly reisebeginn: () => { month: DepartureMonth; day: number } | null;
    /** Die Mitte der freien Kartenfläche (`visibleArea.centreLocation()`), für neue Icons und den Satz zur Schneefallgrenze. */
    readonly mitte: () => readonly [number, number] | undefined;
    /** Doppelklick auf ein Icon (EDIT-0003 G3): die Kamera fliegt hin (`camera.ts`). */
    readonly fliege?: (lngLat: [number, number]) => void;
    /**
     * Ein Icon ist gewählt, auf der Karte oder in der Liste (Betreiber 2026-11-08: „ein klick auf ein icon öffnet nicht die infobox solang man im editor
     * ist (im hintergrund soll die lasche ‚info‘ erscheinen)“): Mit Wiki-Verweis zieht sein Infopanel im Hintergrund nach, wie die Wahl im Ortseditor.
     */
    readonly zeigeInfo?: (symbol: WetterSymbol) => void;
    readonly api?: WetterEditorApi;
    /** Nur für Tests: die Wartezeit des Speicherns. */
    readonly warteMs?: number;
}

export interface Wettereditor {
    readonly fenster: ComputedRef<WerkzeugFenster[]>;
    readonly bestand: Readonly<ShallowRef<WetterBestand | undefined>>;
    readonly ladeFehler: Readonly<Ref<string | undefined>>;
    readonly gewaehlt: Readonly<Ref<string | undefined>>;
    readonly speicher: WetterSpeicher;
    readonly meldung: Readonly<Ref<WetterMeldung | undefined>>;
    readonly tausch: Readonly<Ref<WetterTausch | undefined>>;
    readonly hinweis: Readonly<Ref<WetterTauschHinweis | undefined>>;
    readonly zeitProblem: Readonly<Ref<string | undefined>>;
    /** Das Icon, dessen Entfernen gerade gefragt wird. */
    readonly entfernenFrage: Readonly<Ref<string | undefined>>;
    /** Läuft gerade eine Handlung, auf deren Ergebnis das Fenster wartet (Anlegen, Entfernen)? */
    readonly laeuft: Readonly<Ref<boolean>>;
    /** Die Artikel, auf die ein Icon verweisen kann; `undefined`, bis das Feld sie gebraucht hat. */
    readonly wikiArtikel: Readonly<ShallowRef<readonly WetterWikiArtikel[] | undefined>>;
    /** Die Liste der Artikel war nicht zu laden. */
    readonly wikiFehler: Readonly<Ref<boolean>>;
    /** Der Reisebeginn als Tag im Jahr, oder `null`. */
    readonly reiseTag: ComputedRef<number | null>;
    /** Die Presets, die auf der Karte gerade gelten, mit Anteil. */
    readonly geltung: ComputedRef<ReadonlyMap<string, number>>;
    readonly darf: () => boolean;
    readonly kartenMitte: () => { x: number; z: number } | undefined;
    /** Der Editor an der Karte, solange sein Fenster zu sehen ist. */
    readonly anschluss: ComputedRef<WetterEditorAnschluss | undefined>;
    /** Suche, Filter, Sortierung und Rollstand der Liste; sie bleiben, wenn das Fenster zu- und wieder aufgeht (wie in den übrigen Editoren). */
    readonly listenEinstellung: ListenEinstellung;
    oeffneWerkzeug(): void;
    /** Öffnet das Fenster (oder holt es nach vorn) und wählt dieses Icon, sobald der Stand gelesen ist (Handgriffe des Kartenmenüs). */
    oeffneFuer(id: string): Promise<void>;
    /** Blendet ein Icon aus oder zeigt es wieder („Verbergen“, „Zurückholen“ im Kartenmenü); liest den Stand vorher, wenn er fehlt. */
    setzeSichtbar(id: string, sichtbar: boolean): Promise<void>;
    /** „Icon entfernen …“ fragt (`id`) oder nimmt die Frage zurück (`undefined`). */
    frageEntfernen(id: string | undefined): void;
    /** Die Meldung über Konflikt oder Fehler ausblenden. */
    schliesseMeldung(): void;
    lade(): Promise<void>;
    waehle(id: string | undefined): void;
    /** Doppelklick in der Liste: an ein Icon fliegen; ein Preset hat keinen Ort. */
    zeige(id: string): void;
    setzeWert(id: string, k: WetterJahrSpalte, wert: number): void;
    setzeZeitpunkt(id: string, ziel: number | null): void;
    bestaetigeTausch(): void;
    verwirfTausch(): void;
    nimmZurueck(): void;
    setzeSymbol(id: string, aenderungen: WetterSymbolAenderungen): void;
    legeAn(art: WetterSymbolArt): Promise<void>;
    entferne(id: string): Promise<void>;
    /** Legt ein Preset an einem freien Tag an und wählt es. */
    legePresetAn(): Promise<void>;
    /** Entfernt ein angelegtes Preset (nach der Frage); die 14 festen und das unbestimmte nicht. */
    entfernePreset(id: string): Promise<void>;
    /** Lädt die Artikel für das Feld „Wiki-Artikel“, wenn sie noch fehlen (nach einem Fehler erneut). */
    ladeWikiArtikel(): Promise<void>;
    destroy(): void;
}

/** Karteneinheiten des Wetters (0 bis 1024 über die Welt, wie die Engine) aus Länge und Breite der Karte, und zurück. */
export function weltAus(lngLat: readonly [number, number]): { x: number; z: number } {
    const m = MercatorCoordinate.fromLngLat({ lng: lngLat[0], lat: lngLat[1] });
    return { x: m.x * 1024, z: m.y * 1024 };
}
export function lngLatAus(lage: { x: number; z: number }): [number, number] {
    const ort = new MercatorCoordinate(lage.x / 1024, lage.z / 1024).toLngLat();
    return [ort.lng, ort.lat];
}

/** Was ein Icon nach einer Änderung ist; Zahlen in ihren Grenzen, der Name gekürzt. */
function geaendert(symbol: WetterSymbol, aenderungen: WetterSymbolAenderungen): WetterSymbol {
    const g = WETTER_SYMBOL_GRENZEN;
    const zahl = (wert: number | undefined, min: number, max: number, alt: number): number =>
        wert === undefined || !Number.isFinite(wert) ? alt : Math.min(max, Math.max(min, wert));
    const neu: WetterSymbol = {
        ...symbol,
        ...(aenderungen.nameZeigen === undefined ? {} : { nameZeigen: aenderungen.nameZeigen }),
        ...(aenderungen.sichtbar === undefined ? {} : { sichtbar: aenderungen.sichtbar }),
        x: zahl(aenderungen.x, g.x.min, g.x.max, symbol.x),
        z: zahl(aenderungen.z, g.z.min, g.z.max, symbol.z),
        reichweite: zahl(aenderungen.reichweite, g.reichweite.min, g.reichweite.max, symbol.reichweite),
        staerke: zahl(aenderungen.staerke, g.staerke.min, g.staerke.max, symbol.staerke),
    };
    if (aenderungen.name !== undefined) {
        // Zu lang (`undefined`): Der Name bleibt; leer heißt ohne Namen (`null`).
        const name = wetterSymbolName(aenderungen.name);
        if (name !== undefined) neu.name = name;
    }
    if (
        symbol.art !== "wirbel" &&
        symbol.art !== "mahlstrom" &&
        aenderungen.richtung !== undefined &&
        aenderungen.richtung !== null
    )
        neu.richtung = ((Math.round(aenderungen.richtung) % 360) + 360) % 360;
    if (
        (symbol.art === "wirbel" || symbol.art === "mahlstrom") &&
        (aenderungen.drehsinn === 1 || aenderungen.drehsinn === -1)
    )
        neu.drehsinn = aenderungen.drehsinn;
    if (aenderungen.wikiTitel !== undefined) {
        // Kein Titel (`undefined`): Der Verweis bleibt; leer oder `null` löst ihn. Ob es den Artikel gibt, sagt der Server.
        const titel = wetterWikiTitel(aenderungen.wikiTitel);
        if (titel !== undefined) neu.wikiTitel = titel;
    }
    return neu;
}

/** Die Felder, die sich an einem Icon wirklich geändert haben (für die Anfrage). */
function unterschied(alt: WetterSymbol, neu: WetterSymbol): WetterSymbolAenderungen {
    const felder = [
        "name",
        "nameZeigen",
        "sichtbar",
        "x",
        "z",
        "reichweite",
        "staerke",
        "richtung",
        "drehsinn",
    ] as const;
    const aus: Record<string, unknown> = {};
    for (const feld of felder) if (alt[feld] !== neu[feld]) aus[feld] = neu[feld];
    if ((alt.wikiTitel ?? null) !== (neu.wikiTitel ?? null)) aus["wikiTitel"] = neu.wikiTitel ?? null;
    return aus as WetterSymbolAenderungen;
}

const ohneRevisionPreset = ({ id, tag, werte }: WetterPreset): WetterPresetWerte => ({
    id,
    tag,
    werte: werte as WetterPresetWerte["werte"],
});
const ohneRevisionSymbol = (symbol: WetterSymbol): WetterSymbolDaten => ({
    id: symbol.id,
    art: symbol.art,
    name: symbol.name,
    nameZeigen: symbol.nameZeigen,
    sichtbar: symbol.sichtbar,
    x: symbol.x,
    z: symbol.z,
    reichweite: symbol.reichweite,
    staerke: symbol.staerke,
    richtung: symbol.richtung,
    drehsinn: symbol.drehsinn,
});

export function createWettereditor(optionen: WettereditorOptionen): Wettereditor {
    const api = optionen.api ?? createWetterEditorApi();
    const { werkzeugfenster } = optionen;
    const bestand = shallowRef<WetterBestand | undefined>(undefined);
    const ladeFehler = ref<string | undefined>(undefined);
    const gewaehlt = ref<string | undefined>(undefined);
    const meldung = ref<WetterMeldung | undefined>(undefined);
    const tausch = ref<WetterTausch | undefined>(undefined);
    const hinweis = ref<WetterTauschHinweis | undefined>(undefined);
    const zeitProblem = ref<string | undefined>(undefined);
    const entfernenFrage = ref<string | undefined>(undefined);
    const laeuft = ref(false);
    const wikiArtikel = shallowRef<readonly WetterWikiArtikel[] | undefined>(undefined);
    const wikiFehler = ref(false);
    let laden: Promise<void> | undefined;
    let wikiLaden: Promise<void> | undefined;
    const listenEinstellung = createListenEinstellung({
        vorbelegt: WETTER_LISTE.vorbelegt,
        sortierung: WETTER_SORTIERUNGEN[0],
        maske: "",
    });

    function ladeWikiArtikel(): Promise<void> {
        if (wikiArtikel.value !== undefined) return Promise.resolve();
        wikiLaden ??= (async () => {
            try {
                wikiArtikel.value = await api.wikiArtikel();
                wikiFehler.value = false;
            } catch {
                wikiFehler.value = true;
            } finally {
                wikiLaden = undefined;
            }
        })();
        return wikiLaden;
    }

    const reiseTag = computed(() => {
        const reise = optionen.reisebeginn();
        return reise === null ? null : departureDayOfYear(reise.month, reise.day);
    });
    const geltung = computed(() =>
        bestand.value === undefined ? new Map<string, number>() : geltungAm(bestand.value, reiseTag.value),
    );

    const kartenMitte = (): { x: number; z: number } | undefined => {
        const mitte = optionen.mitte();
        return mitte === undefined ? undefined : weltAus(mitte);
    };

    const fenster = computed(() =>
        werkzeugfenster.stand.value.fenster
            .filter((eintrag) => eintrag.werkzeug === WETTEREDITOR_WERKZEUG)
            .sort((a, b) => a.vorn - b.vorn),
    );

    const revisionVon = (ziel: WetterZiel): number => {
        const liste = ziel.art === "preset" ? bestand.value?.presets : bestand.value?.symbole;
        return liste?.find((x) => x.id === ziel.id)?.revision ?? 0;
    };
    function quittung(q: OperationReceipt): void {
        const jetzt = bestand.value;
        if (jetzt === undefined) return;
        const neu = new Map(q.affected.map((x) => [`${x.kind}:${x.id}`, x.revision]));
        const mit = <T extends { id: string; revision: number }>(art: string, x: T): T => {
            const revision = neu.get(`${art}:${x.id}`);
            return revision === undefined ? x : { ...x, revision };
        };
        bestand.value = {
            presets: jetzt.presets.map((p) => mit("wetter_preset", p)),
            symbole: jetzt.symbole.map((s) => mit("wetter_symbol", s)),
        };
    }
    const grund = (fehler: ApiFehler): string =>
        fehler.code === "network_error" ? t("wettereditor.fehler.netz") : fehler.message;

    const speicher = createWetterSpeicher({
        sende(ziel, felder) {
            const revision = revisionVon(ziel);
            return ziel.art === "preset"
                ? api.presetWerte(ziel.id, revision, felder as Record<string, number>)
                : api.symbolAendern(ziel.id, revision, felder as WetterSymbolAenderungen);
        },
        quittung,
        konflikt() {
            meldung.value = { ton: "warnung", text: t("wettereditor.konflikt") };
            void lade();
        },
        fehler(_status, fehler) {
            meldung.value = { ton: "gefahr", text: t("wettereditor.fehler", { grund: grund(fehler) }) };
            void lade();
        },
        ...(optionen.warteMs === undefined ? {} : { warteMs: optionen.warteMs }),
    });

    /** Das Preset, das auf der Karte gerade gilt (am meisten), als Wahl beim ersten Öffnen. */
    const erstesPreset = (): string | undefined => {
        const anteile = [...geltung.value.entries()].sort((a, b) => b[1] - a[1]);
        return anteile[0]?.[0] ?? bestand.value?.presets[0]?.id;
    };

    async function lade(): Promise<void> {
        if (laden !== undefined) return laden;
        laden = (async () => {
            try {
                const antwort = await api.lade();
                bestand.value = { presets: antwort.presets, symbole: antwort.symbole };
                ladeFehler.value = undefined;
                const da = (id: string | undefined): boolean =>
                    id !== undefined &&
                    (antwort.presets.some((p) => p.id === id) || antwort.symbole.some((s) => s.id === id));
                if (!da(gewaehlt.value)) gewaehlt.value = erstesPreset();
            } catch {
                ladeFehler.value = t("wettereditor.ladefehler");
            } finally {
                laden = undefined;
            }
        })();
        return laden;
    }

    function oeffneWerkzeug(): void {
        const da = fenster.value.at(-1);
        if (da !== undefined) werkzeugfenster.hervorholen(da.id);
        else
            werkzeugfenster.oeffne({
                werkzeug: WETTEREDITOR_WERKZEUG,
                gegenstand: GEGENSTAND,
                titel: t("wettereditor.titel"),
                nurLesen: !optionen.darf(),
            });
        if (bestand.value === undefined) void lade();
    }

    async function oeffneFuer(id: string): Promise<void> {
        oeffneWerkzeug();
        if (bestand.value === undefined) await lade();
        if (bestand.value?.symbole.some((s) => s.id === id) === true) waehle(id);
    }

    async function setzeSichtbar(id: string, sichtbar: boolean): Promise<void> {
        if (bestand.value === undefined) await lade();
        setzeSymbol(id, { sichtbar });
    }

    function waehle(id: string | undefined): void {
        if (id === gewaehlt.value) return;
        gewaehlt.value = id;
        tausch.value = undefined;
        hinweis.value = undefined;
        zeitProblem.value = undefined;
        entfernenFrage.value = undefined;
        // Ein Icon zeigt sein Infopanel im Hintergrund (`zeigeInfo`); ein Preset hat keins und lässt stehen, was da ist.
        const symbol = id === undefined ? undefined : bestand.value?.symbole.find((s) => s.id === id);
        if (symbol !== undefined) optionen.zeigeInfo?.(symbol);
    }

    const setzePresets = (presets: readonly WetterPreset[]): void => {
        const jetzt = bestand.value;
        if (jetzt !== undefined) bestand.value = { ...jetzt, presets };
    };
    const setzeSymbole = (symbole: readonly WetterSymbol[]): void => {
        const jetzt = bestand.value;
        if (jetzt !== undefined) bestand.value = { ...jetzt, symbole };
    };

    function setzeWert(id: string, k: WetterJahrSpalte, wert: number): void {
        const jetzt = bestand.value;
        const def = wetterJahrWert(k);
        const preset = jetzt?.presets.find((p) => p.id === id);
        if (jetzt === undefined || def === undefined || preset === undefined || !optionen.darf()) return;
        const neu = aufSchritt(def, wert);
        if (preset.werte[k] === neu) return;
        setzePresets(jetzt.presets.map((p) => (p.id === id ? { ...p, werte: { ...p.werte, [k]: neu } } : p)));
        speicher.aendere({ art: "preset", id }, { [k]: neu });
    }

    /** Legt das Preset an den Tag (oder unbestimmt) und schreibt es gleich; beim Tausch zieht das andere mit. */
    async function zeitpunktSchreiben(id: string, ziel: number | null): Promise<boolean> {
        const jetzt = bestand.value;
        if (jetzt === undefined) return false;
        setzePresets(mitZeitpunkt(jetzt.presets, id, ziel));
        const ergebnis = await speicher.sofort(() => api.presetZeitpunkt(id, revisionVon({ art: "preset", id }), ziel));
        return ergebnis?.ok === true;
    }

    function setzeZeitpunkt(id: string, ziel: number | null): void {
        const jetzt = bestand.value;
        if (jetzt === undefined || !optionen.darf()) return;
        zeitProblem.value = undefined;
        hinweis.value = undefined;
        const folge = zeitpunktFolge(jetzt.presets, id, ziel);
        if (folge.art === "gleich") {
            tausch.value = undefined;
            return;
        }
        if (folge.art === "unbestimmtBleibt") {
            tausch.value = undefined;
            zeitProblem.value = t("wettereditor.zeitpunkt.bleibt");
            return;
        }
        if (folge.art === "tausch") {
            tausch.value = { id, mit: folge.mit, ziel };
            return;
        }
        tausch.value = undefined;
        void zeitpunktSchreiben(id, ziel);
    }

    function bestaetigeTausch(): void {
        const frage = tausch.value;
        const vorher = bestand.value?.presets.find((p) => p.id === frage?.id);
        if (frage === undefined || vorher === undefined) return;
        tausch.value = undefined;
        void zeitpunktSchreiben(frage.id, frage.ziel).then((ok) => {
            const jetzt = bestand.value;
            if (!ok || jetzt === undefined) return;
            hinweis.value = {
                id: frage.id,
                satz: tauschHinweis(jetzt.presets, frage.id, frage.mit),
                zurueck: vorher.tag,
            };
        });
    }

    function nimmZurueck(): void {
        const h = hinweis.value;
        if (h === undefined) return;
        hinweis.value = undefined;
        void zeitpunktSchreiben(h.id, h.zurueck);
    }

    function setzeSymbol(id: string, aenderungen: WetterSymbolAenderungen): void {
        const jetzt = bestand.value;
        const alt = jetzt?.symbole.find((s) => s.id === id);
        if (jetzt === undefined || alt === undefined || !optionen.darf()) return;
        const neu = geaendert(alt, aenderungen);
        const felder = unterschied(alt, neu);
        if (Object.keys(felder).length === 0) return;
        setzeSymbole(jetzt.symbole.map((s) => (s.id === id ? neu : s)));
        speicher.aendere({ art: "symbol", id }, felder);
    }

    /** Ein Zug auf der Karte: jeder Schritt im Stand, erst das Loslassen geht an den Server. */
    function ziehe(id: string, zug: WetterZug, fertig: boolean): void {
        const jetzt = bestand.value;
        const alt = jetzt?.symbole.find((s) => s.id === id);
        if (jetzt === undefined || alt === undefined) return;
        setzeSymbole(jetzt.symbole.map((s) => (s.id === id ? geaendert(alt, zug) : s)));
        // Beim Loslassen geht der Endstand des Zugs an den Server, entprellt wie jede Änderung.
        if (fertig && optionen.darf()) speicher.aendere({ art: "symbol", id }, zug as WetterSymbolAenderungen);
    }

    async function legeAn(art: WetterSymbolArt): Promise<void> {
        if (bestand.value === undefined || !optionen.darf() || laeuft.value) return;
        const body = neuesSymbol(art, kartenMitte() ?? { x: 512, z: 512 });
        laeuft.value = true;
        try {
            const ergebnis = await speicher.sofort(() => api.symbolAnlegen(body));
            const angelegt = ergebnis?.ok === true ? ergebnis.quittung.affected[0] : undefined;
            const jetzt = bestand.value;
            if (angelegt === undefined || jetzt === undefined) return;
            setzeSymbole([...jetzt.symbole, { ...body, id: angelegt.id, revision: angelegt.revision ?? 1 }]);
            waehle(angelegt.id);
        } finally {
            laeuft.value = false;
        }
    }

    async function entferne(id: string): Promise<void> {
        if (bestand.value === undefined || !optionen.darf() || laeuft.value) return;
        laeuft.value = true;
        try {
            const ergebnis = await speicher.sofort(() => api.symbolEntfernen(id, revisionVon({ art: "symbol", id })));
            const jetzt = bestand.value;
            if (ergebnis?.ok !== true || jetzt === undefined) return;
            const rest = jetzt.symbole.filter((s) => s.id !== id);
            setzeSymbole(rest);
            entfernenFrage.value = undefined;
            const index = jetzt.symbole.findIndex((s) => s.id === id);
            waehle(rest[Math.min(index, rest.length - 1)]?.id ?? erstesPreset());
        } finally {
            laeuft.value = false;
        }
    }

    async function legePresetAn(): Promise<void> {
        const jetzt = bestand.value;
        if (jetzt === undefined || !optionen.darf() || laeuft.value) return;
        const tag = wetterFreierTag(jetzt.presets, reiseTag.value);
        if (tag === null) {
            meldung.value = { ton: "warnung", text: t("wettereditor.preset.keinTag") };
            return;
        }
        laeuft.value = true;
        try {
            const ergebnis = await speicher.sofort(() => api.presetAnlegen(tag));
            const angelegt = ergebnis?.ok === true ? ergebnis.quittung.affected[0] : undefined;
            const danach = bestand.value;
            if (angelegt === undefined || danach === undefined) return;
            // Die Werte, die der Server aus dem Stand vor dem Anlegen rechnet; der nächste Lauf von `lade` liest sie ohnehin neu.
            const werte = wetterNeuePresetWerte(jetzt.presets as unknown as WetterPresetWerte[], tag);
            setzePresets(
                mitAngelegtem(danach.presets, { id: angelegt.id, tag, werte, revision: angelegt.revision ?? 1 }),
            );
            waehle(angelegt.id);
        } finally {
            laeuft.value = false;
        }
    }

    async function entfernePreset(id: string): Promise<void> {
        const jetzt = bestand.value;
        const preset = jetzt?.presets.find((p) => p.id === id);
        if (jetzt === undefined || preset === undefined || !istEntfernbar(preset) || !optionen.darf() || laeuft.value)
            return;
        laeuft.value = true;
        try {
            const ergebnis = await speicher.sofort(() => api.presetEntfernen(id, revisionVon({ art: "preset", id })));
            const danach = bestand.value;
            if (ergebnis?.ok !== true || danach === undefined) return;
            const rest = danach.presets.filter((p) => p.id !== id);
            setzePresets(rest);
            entfernenFrage.value = undefined;
            // Gewählt wird das Preset, das in der Liste an seine Stelle rückt (am Ende das letzte), sonst das erste.
            const index = danach.presets.findIndex((p) => p.id === id);
            waehle(rest[Math.min(index, rest.length - 1)]?.id ?? erstesPreset());
        } finally {
            laeuft.value = false;
        }
    }

    // Das Fenster ist zu (nicht nur abgelegt): Was noch wartet, geht gleich.
    const stopFenster = watch(
        () => fenster.value.length,
        (jetzt, vorher) => {
            if (jetzt === 0 && vorher > 0) void speicher.alles();
        },
    );

    const sichtbaresFenster = computed(() => fenster.value.some((eintrag) => eintrag.lage !== "versenkt"));
    const anschluss = computed((): WetterEditorAnschluss | undefined => {
        const jetzt = bestand.value;
        if (!sichtbaresFenster.value || jetzt === undefined) return undefined;
        return {
            presets: jetzt.presets.map(ohneRevisionPreset),
            symbole: jetzt.symbole.map(ohneRevisionSymbol),
            gewaehlt: gewaehlt.value,
            darf: optionen.darf(),
            waehle: (id) => waehle(id),
            ziehe,
        };
    });

    return {
        fenster,
        bestand,
        ladeFehler,
        gewaehlt,
        speicher,
        meldung,
        tausch,
        hinweis,
        zeitProblem,
        entfernenFrage,
        laeuft,
        wikiArtikel,
        wikiFehler,
        reiseTag,
        geltung,
        darf: optionen.darf,
        kartenMitte,
        anschluss,
        listenEinstellung,
        oeffneWerkzeug,
        oeffneFuer,
        setzeSichtbar,
        frageEntfernen(id) {
            entfernenFrage.value = id;
        },
        schliesseMeldung() {
            meldung.value = undefined;
        },
        lade,
        waehle,
        zeige(id) {
            const symbol = bestand.value?.symbole.find((s) => s.id === id);
            if (symbol !== undefined) optionen.fliege?.(lngLatAus(symbol));
        },
        setzeWert,
        setzeZeitpunkt,
        bestaetigeTausch,
        verwirfTausch() {
            tausch.value = undefined;
        },
        nimmZurueck,
        setzeSymbol,
        legeAn,
        entferne,
        legePresetAn,
        entfernePreset,
        ladeWikiArtikel,
        destroy() {
            stopFenster();
            void speicher.alles().finally(() => speicher.destroy());
        },
    };
}
