import type { Map as MapLibreMap } from "maplibre-gl";
import { shallowRef, watch, type ShallowRef, type WatchStopHandle } from "vue";
import {
    AVENTURIA,
    fromRenderLngLat,
    KAMM_FANG_E,
    SEARCH_FIT_MAX_ZOOM,
    toRenderLngLat,
    type EditorGebirge,
    type LinienRang,
    type PunktHoehe,
    type PunktHoehen,
} from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import type { Camera } from "../map/camera/camera";
import type { AnlegenModus } from "../map/geometrie/anlegen";
import { installAnlegenModus } from "../map/geometrie/anlegen-modus";
import { GEBIRGSNETZ, KAMM_ANLEGEN, NEBENGIPFEL_SETZEN } from "../map/geometrie/arten";
import { vergissEinzug, zeigeFrei, type Umriss } from "../map/geometrie/kamera";
import { kaemmeAnzeigen, vorschauFlaeche, vorschauTalboden, zugVorschau } from "./gebirge-anzeige";
import { ladeGebirge } from "./gebirge-daten";
import { targetInsets } from "../map/camera/visible-area";
import { installGeometrieModus, type GeometrieModus } from "../map/geometrie/modus";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import type { Punkt } from "../map/geometrie/geometrie";
import { installHoehenZiehen, type HoehenZiehen } from "./kamm-hoehe-ziehen";
import { gewaesserAus, KEIN_GEWAESSER, wasserHoehe, type Gewaesser } from "./kamm-netz-wasser";
import {
    flussAnsichten,
    flussZeichnung,
    KEIN_FLUSS,
    steigendeFluesse,
    zahlDerFluesse,
    type FlussDaten,
} from "./kamm-netz-fluss";
import { kammNetzProfil, type KammNetzProfil } from "./kamm-netz-profil";
import { kammHoehenZeigen } from "./kamm-hoehen-schalter";
import { entferneNetzLage, netzLageFehlt, zeichneHoehen, zeichneNetzLage } from "./kamm-netz-lage";
import { hoeheIn } from "./kamm-netz-hoehen";
import { hoehenBeschriftung, hoehenVon, kammhoeheVon, netzVon, standVon, eingerasteteHoehe } from "./kamm-netz-hoehen";
import {
    eigeneHoehe,
    gleicheStelle,
    hoeheAn,
    istKamm,
    loeschArt,
    mitMulde,
    LEERES_NETZ,
    mitHoehen,
    mitKamm,
    mitNebengipfel,
    mitRang,
    netzAus,
    netzHatTeile,
    netzZiele,
    ohneAuswahl,
    punkteDerAuswahl,
    punktLage,
    startWerkzeug,
    teileAus,
    wasserBasis,
    wasserTeilVon,
    type GebirgsNetz,
    type NetzPunkt,
    type NetzStelle,
} from "./kamm-netz";
import type { LandschaftBearbeitung } from "./landschaftseditor-steuerung";

/**
 * „Kämme zeichnen“ (WI-0245 D2; EDIT-0003 §6 „Gebirgsnetz“, Variante A; Bauvorlage Gebirge-Entwurf V16, abgenommen 2026-10-20): das Netz
 * eines Gebirges auf der echten Karte, im EINEN Entwurf der Landschaft (wie `gipfel-ziehen.ts`). Drei Werkzeuge in der Leiste unten, je
 * ein Modus des gemeinsamen Geometrie-Moduls, nie zwei zugleich. Der Modus beginnt mit „Kamm“, bei einem Gebirge mit Netz aber mit
 * „Wählen“ (`startWerkzeug`, OPS-055/OPS-057); die Gestenzeile der Leiste sagt je Werkzeug, was die Maus kann:
 *
 * - **Kamm** (`KAMM_ANLEGEN`, Anlegen): Punkt für Punkt, eingerastet an Gipfeln, Nebengipfeln und Kammpunkten; Doppelklick, Enter oder
 *   „Kamm fertig“ hängt ihn mit dem gewählten Rang ans Netz, und der nächste beginnt. Rechtsklick und ⌫ nehmen den letzten Punkt zurück.
 * - **Nebengipfel** (`NEBENGIPFEL_SETZEN`): ein Klick setzt einen Formpunkt.
 * - **Wählen** (`GEBIRGSNETZ`, Bearbeiten): Punkte ziehen (ein Knoten bleibt ein Knoten), Doppelklick auf die Kante setzt, auf einen Punkt
 *   löscht; ein Klick auf einen Anfasser wählt diesen Stützpunkt, auf die Kante den ganzen Kamm, auf einen Nebengipfel oder eine Mulde den
 *   Punkt; Umschalt + Klick nimmt in die Auswahl auf oder heraus (WI-0249 P9). Rang und „Löschen“ gelten den gewählten Teilen. Esc und ein
 *   Klick ohne Umschalt neben das Netz heben die Auswahl auf (Querschnittsregel des Betreibers 2026-10-24 für jede Mehrfachauswahl).
 *
 * **Höhen je Punkt** (WI-0249 P9, Betreiber 2026-10-24; Vali wählte 2026-10-26: kein Startwert): Das Feld ↕ zeigt die Höhe der Auswahl
 * (eigene kräftig, ohne eigene die des Geländes aus der Vorschau blass, gemischte leer) und setzt sie an allen gewählten Punkten und an jedem
 * deckungsgleichen Punkt; leer nimmt die eigene Höhe weg. Ein neuer Punkt hat keine eigene Höhe; nur eingerastet an einem Stützpunkt,
 * Nebengipfel oder einer Mulde mit eigener Höhe trägt er dieselbe. Erst ein gesetzter oder gezogener Wert ist eigen und wird getroffen. Der
 * Knopf ↕ davor schaltet „Höhe ziehen“ (`kamm-hoehe-ziehen.ts`), der Schalter „Höhen beschriften“ die Zahlen über allen Punkten
 * (`kamm-hoehen-schalter.ts`).
 *
 * **Flüsse als Täler** (WI-0259, OPS-071; Vali 2026-10-30: „flüsse sind automatische kammtäler, deren verlauf im kammeditor auch in der höhe
 * verändert werden kann“): Im Werkzeug „Wählen“ stehen die Flüsse der Fläche wie auf der Karte (Catmull-Rom), ihre Stützpunkte gefüllt mit
 * eigener Höhe, sonst hohl; über Punkten mit eigener Höhe und über dem gewählten Punkt steht die Höhe. Ein „!“ sitzt an jedem Punkt, vor dem der
 * Fluss in Fließrichtung steigt (`kamm-netz-fluss.ts`, dieselbe Rechnung wie im Profil). „Löschen“ und Entf nehmen die eigenen Höhen gewählter
 * Flusspunkte und Seen weg; den Verlauf ändert nur der Wegeditor. Ein See trägt am Platz einen Griff ↕: Ziehen setzt seine Höhe wie „Höhe
 * ziehen“, ohne dass der Schalter an sein muss. Das Profil im Reiter „Gebirge“ greift über `kamm-netz-profil.ts` in denselben Entwurf.
 *
 * Jede Änderung ist ein Schritt im Entwurf (↶ ↷ der Leiste), „Fertig“ schreibt das Netz mit den übrigen Feldern (`landscape.update`,
 * `gebirge[].changes.netz`). Das vorhandene Netz steht während des Modus als eigene Lage auf der Karte (Hauptkamm kräftig, Nebenkamm
 * dünn, Nebengipfel als Punkt). Der Modus endet, wenn das Fenster der Landschaft geht oder die Bearbeitung endet.
 */
export type KammWerkzeug = "kamm" | "nebengipfel" | "mulde" | "waehlen";

export interface KammNetzSeite {
    karte():
        | { map: MapLibreMap; interaction: MapInteractionCoordinator; camera: Pick<Camera, "showBounds" | "zoomBy"> }
        | undefined;
    /** Die Bearbeitung der Landschaft; öffnet ihr Fenster. Ohne Schreibrecht keine: Dann beginnt nichts. */
    bearbeitung(regionId: string): LandschaftBearbeitung | undefined;
    /** Steht das Fenster der Landschaft noch? Sonst endet der Modus. */
    getragen(regionId: string): boolean;
    /** Der Fangradius aller Editoren in Bildpunkten (Karteneinstellung `fangradius`). */
    fangradius(): number;
    /** Farben der Lage aus dem Designkanon; `text` und `blass` für die Höhen (eigen, Gelände), `rand` auch für deren Saum. */
    farben(): { kamm: string; tal?: string; gewaehlt: string; rand: string; text?: string; blass?: string };
    /** Presets, Grundhöhe und Eingabe der Teilfläche (`GET /api/editor/gebirge/:area`); ohne Angabe liest der Modus selbst. */
    gebirge?(flaeche: string): Promise<EditorGebirge | undefined>;
}

export interface KammNetzLauf {
    readonly id: string;
    readonly flaeche: string;
    readonly name: string;
    readonly werkzeug: KammWerkzeug;
    readonly rang: LinienRang;
    /** Der zuletzt gewählte Teil (`nr` im Netz); Rang, Löschen und die Farbe gelten allen Teilen der Auswahl. */
    readonly gewaehlt: number | undefined;
    /** Die Auswahl: ganze Teile und einzelne Stützpunkte (WI-0249 P9). */
    readonly auswahl: readonly NetzStelle[];
    /** Punkte des Kamms, der gerade entsteht. */
    readonly zeichnet: number;
    /** „↕ Höhe ziehen“ an. */
    readonly hoehenZug: boolean;
    /** Während eines Zugs der Höhe: das Netz mit den Werten unter dem Zeiger (für Feld und Beschriftung); sonst keins. */
    readonly zugNetz: GebirgsNetz | undefined;
    /** Was der Reiter liest (Presets, Grundhöhe, Gipfel der Fläche); bis es da ist, keins. */
    readonly daten: EditorGebirge | undefined;
    /** Die Flüsse und Seen der Fläche aus `daten` (WI-0249, `kamm-netz-wasser.ts`): nur zum Wählen und für ihre Höhe. */
    readonly gewaesser: Gewaesser;
    readonly bearbeitung: LandschaftBearbeitung;
}

export interface KammNetz {
    readonly laufend: Readonly<ShallowRef<KammNetzLauf | undefined>>;
    /** Das Netz, wie es im Entwurf steht (für Leiste und Zählung). */
    netz(): GebirgsNetz;
    /** Das Netz, das Feld und Beschriftung zeigen: während eines Zugs der Höhe mit den Werten unter dem Zeiger. */
    anzeigeNetz(): GebirgsNetz;
    /** Die Höhe jedes Punkts, die gilt (eigen oder Vorgabe), für `anzeigeNetz`. */
    hoehen(): PunktHoehen;
    /** Die Höhe, die an einem Punkt gilt, auch an Flüssen und Seen (dort ohne eigene die Fläche der Vorschau, `eigen` falsch). */
    hoeheVon(p: NetzPunkt): PunktHoehe | undefined;
    /** Die einzelnen Punkte der Auswahl. */
    auswahlPunkte(): NetzPunkt[];
    /**
     * Was „Löschen“ und Entf an der Auswahl tun (WI-0259): `teile` entfernt Kämme, Nebengipfel und Mulden, `hoehen` nimmt nur die eigenen Höhen
     * gewählter Flusspunkte und Seen weg, `undefined`: nichts.
     */
    loeschArt(): "teile" | "hoehen" | undefined;
    /** Die Namen der Flüsse, die vor einem „!“-Punkt oder in einen See steigen (für die Gestenzeile); leer, wenn keiner steigt. */
    steigende(): string[];
    /** Wie viele verschiedene Flüsse die Fläche berühren (für den Zähler). */
    zahlFluesse(): number;
    /** An einer Teilfläche des Gebirges; ohne Angabe an der ersten (jedes der 232 Gebirge hat genau eine). */
    starte(regionId: string, flaeche?: string): void;
    /** Der Umschalter „Kämme zeichnen“ über der Vorschau: läuft der Modus an diesem Gebirge, endet er (der Entwurf bleibt), sonst beginnt er. */
    umschalten(regionId: string, flaeche?: string): void;
    werkzeug(werkzeug: KammWerkzeug): void;
    rang(rang: LinienRang): void;
    /** Die gewählten Teile entfernen. */
    loesche(): void;
    /** Alle Kämme und Nebengipfel entfernen (ein Schritt). */
    leere(): void;
    /** Die Höhe aller gewählten Punkte; `null` ist die Vorgabe des Modells. */
    hoehe(h: number | null): void;
    /** „↕ Höhe ziehen“ an oder aus (ohne Angabe umschalten); an schaltet auf „Wählen“. */
    hoehenZiehen(an?: boolean): void;
    /** Den Kamm, der gerade entsteht, abschließen (wie Enter). */
    kammFertig(): void;
    /** „⌖ Gebirge“ in der Leiste: die ganze Teilfläche in die freie Fläche einpassen (auch heran oder hinaus). */
    zeigeGebirge(): void;
    /** Der Gebirgstyp der Teilfläche im Entwurf (für die Statuszeile); `null` ohne Typ. */
    typ(): string | null;
    /** Esc: erst ein Zug der Höhe, dann der entstehende Kamm, dann die Auswahl, dann der Modus; `false`, wenn keiner läuft. */
    abbrechen(): boolean;
    beende(): void;
}

const space = AVENTURIA.coordinateSpace;

/**
 * So oft höchstens geht das Netz eines laufenden Zugs an die Vorschau (`zugVorschau`, WI-0249 Leistung): Die Vorschau rechnet ohnehin nur das
 * jüngste (die Warteschlange ersetzt den wartenden Auftrag), die Grenze spart nur das Bauen und Übergeben. VORSCHLAG.
 */
export const ZUG_VORSCHAU_MS = 150;

/** Karteneinheiten je Bildpunkt um die Mitte der Karte. */
function massstab(map: MapLibreMap): number {
    const mitte = map.getCenter();
    const at = map.project(mitte);
    const a = fromRenderLngLat(space, map.unproject([at.x, at.y]));
    const b = fromRenderLngLat(space, map.unproject([at.x + 1, at.y]));
    return Math.max(1e-9, Math.hypot(b.x - a.x, b.y - a.y));
}

export function createKammNetz(seite: KammNetzSeite): KammNetz {
    const laufend = shallowRef<KammNetzLauf | undefined>(undefined);
    let anlegen: AnlegenModus | undefined;
    let bearbeiten: GeometrieModus | undefined;
    let ziehen: HoehenZiehen | undefined;
    let karte: ReturnType<KammNetzSeite["karte"]>;
    let stop: WatchStopHandle[] = [];
    /** Der Umriss der Teilfläche, an der der Modus läuft (für Hinflug und „⌖ Gebirge“). */
    let umriss: Umriss[] = [];
    /** Ein Zug der Höhe: die gezogenen Punkte mit ihrer Höhe beim Beginn. */
    let zug: { punkte: readonly (NetzPunkt & { von: number })[]; zuvor: readonly NetzStelle[] } | undefined;

    const lauf = (): KammNetzLauf | undefined => laufend.value;
    /** Nur bei einer echten Änderung ein neuer Lauf: Der Modus meldet seinen Stand bei jedem Neuzeichnen, sonst kreiste das. */
    const setze = (teil: Partial<KammNetzLauf>): void => {
        const jetzt = lauf();
        if (jetzt === undefined) return;
        if ((Object.keys(teil) as (keyof KammNetzLauf)[]).every((k) => jetzt[k] === teil[k])) return;
        laufend.value = { ...jetzt, ...teil };
    };
    /** Die Auswahl setzen; `gewaehlt` ist ihr letzter Teil. */
    const waehleAus = (auswahl: readonly NetzStelle[]): void => setze({ auswahl, gewaehlt: auswahl.at(-1)?.nr });
    const netz = (): GebirgsNetz => netzVon(lauf());
    const anzeigeNetz = (): GebirgsNetz => lauf()?.zugNetz ?? netz();
    /** Ein Schritt im Entwurf: das neue Netz für diese Teilfläche. */
    const schreibe = (neu: (netz: GebirgsNetz) => GebirgsNetz, verschmelze?: string): void => {
        const l = lauf();
        if (l === undefined) return;
        l.bearbeitung.feld((felder) => {
            const stand = standVon(felder, l);
            return {
                ...felder,
                gebirge: { ...felder.gebirge, [l.flaeche]: { ...stand, netz: neu(stand.netz ?? LEERES_NETZ) } },
            };
        }, verschmelze);
    };
    const fangradius = (): number => {
        const map = karte?.map;
        return map === undefined ? seite.fangradius() : Math.max(seite.fangradius(), KAMM_FANG_E / massstab(map));
    };
    const ziele = () => {
        const l = lauf();
        if (l === undefined) return [];
        return netzZiele(l.flaeche, l.name, netz(), l.bearbeitung.detail.value?.peaks ?? []);
    };

    // --- Höhen: Kammhöhe, Vorgaben, eigene Höhen (WI-0249 P9, `kamm-netz-hoehen.ts`) ---
    const kammhoehe = (): number => kammhoeheVon(lauf());
    const hoehen = (): PunktHoehen => hoehenVon(lauf(), anzeigeNetz());
    const gew = (): Gewaesser => lauf()?.gewaesser ?? KEIN_GEWAESSER;

    // --- Die Lage des Netzes auf der Karte (`kamm-netz-lage.ts`) ---
    /** Die Fläche der letzten Vorschau dieser Teilfläche: An einem Punkt ohne eigene Höhe zeigen Zahl und Feld, wie hoch sie dort steht. */
    const flaecheDerVorschau = () => {
        const v = vorschauFlaeche.value;
        return v !== undefined && v.flaeche === lauf()?.flaeche ? v.raster : undefined;
    };
    /** Die Höhen über den Punkten: alle mit „Höhen beschriften“, sonst nur die gerade gezogenen (WI-0249 P9). */
    const hoehenDaten = () =>
        lauf() === undefined
            ? hoehenBeschriftung(LEERES_NETZ, hoehen(), false, [])
            : hoehenBeschriftung(
                  anzeigeNetz(),
                  hoehen(),
                  kammHoehenZeigen.value,
                  [...(zug?.punkte ?? []), ...wasserZahlen()],
                  flaecheDerVorschau(),
                  gew(),
              );
    /**
     * Die Höhe an einem Punkt (WI-0249; Vali wählte 2026-10-26): die eigene, sonst die des Geländes am Punkt aus der Vorschau (wie die Zahl auf
     * der Karte); ohne Vorschau keine.
     */
    const hoeheVon = (p: NetzPunkt): PunktHoehe | undefined => {
        const n = anzeigeNetz();
        if (wasserTeilVon(n, gew(), p.nr) === undefined) {
            const gilt = hoeheAn(n, hoehen(), p);
            if (gilt?.eigen === true) return gilt;
        } else {
            const eigen = eigeneHoehe(n, p, gew());
            if (eigen !== null && eigen !== undefined) return { h: eigen, eigen: true };
        }
        const at = punktLage(n, p, gew());
        const raster = flaecheDerVorschau();
        const flaeche = at === undefined || raster === undefined ? undefined : hoeheIn(raster, at.x, at.y);
        return flaeche === undefined ? undefined : { h: Math.round(flaeche), eigen: false };
    };
    // --- Flüsse als Täler (WI-0259, `kamm-netz-fluss.ts`) ---
    /** Die Höhe des Geländes an einer Stelle aus der letzten Vorschau; ohne sie keine. */
    const gelaendeAm = (at: Punkt): number | undefined => {
        const raster = flaecheDerVorschau();
        return raster === undefined ? undefined : hoeheIn(raster, at.x, at.y);
    };
    /** Die Ansicht jedes Flusses, von dem die Fläche ein Stück hat: wirksame Höhe und Steigen (die Rechnung des Profils ist dieselbe). */
    const ansichten = () => {
        const eingabe = lauf()?.daten?.eingabe;
        return eingabe === undefined || gew().teile.length === 0
            ? new Map()
            : flussAnsichten(eingabe, anzeigeNetz(), gew(), gelaendeAm);
    };
    const punktSchluessel = (p: NetzPunkt): string => `${String(p.nr)}:${String(p.index)}`;
    /** Was die Karte an den Flüssen zeichnet: nur im Werkzeug „Wählen“, in dem sie stehen. */
    const flussDaten = (): FlussDaten => {
        const l = lauf();
        if (l === undefined || l.werkzeug !== "waehlen" || gew().teile.length === 0) return KEIN_FLUSS;
        const n = anzeigeNetz();
        const gewaehlt = new Set(punkteDerAuswahl(n, l.auswahl, gew()).map(punktSchluessel));
        return flussZeichnung(ansichten(), gew(), wasserBasis(n), gewaehlt, {
            quelle: t("landschaftseditor.kaemme.quelle"),
            muendung: t("landschaftseditor.kaemme.muendung"),
        });
    };
    /** Die Punkte von Flüssen und Seen, über denen immer eine Zahl steht: mit eigener Höhe und der gewählte (WI-0259). */
    const wasserZahlen = (): NetzPunkt[] => {
        const l = lauf();
        if (l === undefined || l.werkzeug !== "waehlen") return [];
        const n = anzeigeNetz();
        const basis = wasserBasis(n);
        const gewaehlt = new Set(punkteDerAuswahl(n, l.auswahl, gew()).map(punktSchluessel));
        return gew().teile.flatMap((teil, i) =>
            teil.punkte.flatMap((at, index) => {
                const punkt = { nr: basis + i, index };
                return wasserHoehe(n, teil, at) !== null || gewaehlt.has(punktSchluessel(punkt)) ? [punkt] : [];
            }),
        );
    };
    const zeichne = (): void => {
        const map = karte?.map;
        if (map === undefined) return;
        try {
            zeichneNetzLage(
                map,
                netz(),
                lauf()?.auswahl ?? [],
                hoehenDaten(),
                seite.farben(),
                kaemmeAnzeigen.value,
                gew(),
                flussDaten(),
            );
        } catch {
            map.once("styledata", zeichne);
        }
    };
    const entferneLage = (): void => {
        if (karte?.map !== undefined) entferneNetzLage(karte.map);
    };
    /**
     * Während eines Zugs der Höhe nur die Zahlen, einmal je Bild: Netz und Auswahl bleiben, wie sie sind (WI-0249 Leistung; vorher je
     * Mausbewegung drei Quellen, die Griffe des Moduls und ein Stilwechsel).
     */
    let hoehenFrame: number | undefined;
    const planeHoehen = (): void => {
        if (hoehenFrame !== undefined) return;
        hoehenFrame = requestAnimationFrame(() => {
            hoehenFrame = undefined;
            const map = karte?.map;
            if (map === undefined) return;
            try {
                if (!zeichneHoehen(map, hoehenDaten(), flussDaten())) zeichne();
            } catch {
                zeichne();
            }
        });
    };

    // --- Die Vorschau zieht beim Ziehen nach (WI-0249, Vali 2026-10-25), gedrosselt (`ZUG_VORSCHAU_MS`) ---
    let zugNetzOffen: GebirgsNetz | undefined;
    let zugZeit: ReturnType<typeof setTimeout> | undefined;
    let zugZuletzt = Number.NEGATIVE_INFINITY;
    const gibZug = (): void => {
        zugZeit = undefined;
        const l = lauf();
        if (zugNetzOffen === undefined || l === undefined) return;
        zugZuletzt = performance.now();
        zugVorschau.value = { flaeche: l.flaeche, netz: zugNetzOffen };
    };
    /** Das Netz unter dem Zeiger an die Vorschau; `undefined` beendet den Zug (vor dem Schritt im Entwurf). */
    const meldeZug = (n: GebirgsNetz | undefined): void => {
        zugNetzOffen = n;
        if (n === undefined) {
            clearTimeout(zugZeit);
            zugZeit = undefined;
            if (zugVorschau.value !== undefined) zugVorschau.value = undefined;
            return;
        }
        if (zugZeit !== undefined) return;
        const warte = ZUG_VORSCHAU_MS - (performance.now() - zugZuletzt);
        if (warte <= 0) gibZug();
        else zugZeit = setTimeout(gibZug, warte);
    };

    // --- „↕ Höhe ziehen“ (WI-0249 P9) ---
    const ziehenAus = (): void => {
        ziehen?.aus();
        ziehen = undefined;
        zug = undefined;
    };
    function starteZiehen(): void {
        if (karte === undefined || ziehen !== undefined) return;
        ziehen = installHoehenZiehen(karte.map, karte.interaction, {
            zielUnter(anfasser, kante) {
                // Ein Anfasser (Punkt) geht der Kante vor; nur Teile dieses Gebirges.
                const a = anfasser?.properties;
                if (a !== undefined && String(a["objekt"]) === lauf()?.flaeche) {
                    // Ohne „↕ Höhe ziehen“ gehört nur der Griff ↕ am See dem Zug (WI-0259); jeder andere Anfasser bleibt der Karte und dem Modus.
                    if (lauf()?.hoehenZug !== true && wasserTeilVon(netz(), gew(), Number(a["nr"]))?.art !== "see")
                        return undefined;
                    return { nr: Number(a["nr"]), index: Number(a["index"]) };
                }
                if (lauf()?.hoehenZug !== true) return undefined;
                const k = kante?.properties;
                if (k !== undefined && String(k["objekt"]) === lauf()?.flaeche) return { nr: Number(k["nr"]) };
                return undefined;
            },
            beginne(ziel) {
                const l = lauf();
                if (l === undefined) return false;
                const n = netz();
                const gewaehlt = punkteDerAuswahl(n, l.auswahl, gew());
                // Auf einem Punkt oder Kamm außerhalb der Auswahl zieht nur er (und steht danach gewählt); sonst alle gewählten.
                const stelle: NetzStelle =
                    ziel.index === undefined ? { nr: ziel.nr } : stelleVon(n, { nr: ziel.nr, index: ziel.index });
                const zielPunkte = punkteDerAuswahl(n, [stelle], gew());
                if (zielPunkte.length === 0) return false;
                const aufFremdem = zielPunkte.some((p) => !gewaehlt.some((g) => g.nr === p.nr && g.index === p.index));
                const punkte = aufFremdem ? zielPunkte : gewaehlt;
                zug = {
                    punkte: punkte.map((p) => ({ ...p, von: hoeheVon(p)?.h ?? kammhoehe() })),
                    zuvor: l.auswahl,
                };
                if (aufFremdem) waehleAus([stelle]);
                return true;
            },
            folge(betrag) {
                const laufender = zug;
                if (laufender === undefined) return;
                const zugNetz = mitHoehen(
                    netz(),
                    laufender.punkte.map((p) => ({ ...p, h: p.von + betrag })),
                    gew(),
                );
                setze({ zugNetz });
                meldeZug(zugNetz);
            },
            ende() {
                const laufender = zug;
                const ziel = lauf()?.zugNetz;
                zug = undefined;
                meldeZug(undefined);
                setze({ zugNetz: undefined });
                if (laufender === undefined || ziel === undefined) return;
                // EIN Schritt im Entwurf; die Werte stehen schon begrenzt im Netz des Zugs.
                const werte = laufender.punkte.map((p) => ({ ...p, h: eigeneHoehe(ziel, p, gew()) ?? null }));
                schreibe((n) => mitHoehen(n, werte, gew()));
            },
            abbrechen() {
                const laufender = zug;
                zug = undefined;
                meldeZug(undefined);
                setze({
                    zugNetz: undefined,
                    ...(laufender ? { auswahl: laufender.zuvor, gewaehlt: laufender.zuvor.at(-1)?.nr } : {}),
                });
            },
        });
    }
    /** Eine Stelle wählen; mit Umschalt in die Auswahl aufnehmen oder aus ihr herausnehmen (Karte und Profil teilen sie, WI-0259). */
    const waehleStelle = (stelle: NetzStelle, umschalt: boolean): void => {
        const jetzt = lauf()?.auswahl ?? [];
        if (!umschalt) waehleAus([stelle]);
        else if (jetzt.some((s) => gleicheStelle(s, stelle))) waehleAus(jetzt.filter((s) => !gleicheStelle(s, stelle)));
        else waehleAus([...jetzt, stelle]);
    };
    /** Die Stelle der Auswahl zu einem Punkt: ein Stützpunkt bleibt ein Stützpunkt, Nebengipfel und Mulde sind der ganze Teil. */
    const stelleVon = (n: GebirgsNetz, p: NetzPunkt): NetzStelle => (istLinie(n, p.nr) ? p : { nr: p.nr });
    /** Ein Kamm oder ein Stück Fluss mit mehr als einem Punkt: Ein Stützpunkt darin ist eine eigene Stelle der Auswahl. */
    const istLinie = (n: GebirgsNetz, nr: number): boolean =>
        istKamm(n, nr) ||
        (wasserTeilVon(n, gew(), nr)?.art === "fluss" && (wasserTeilVon(n, gew(), nr)?.punkte.length ?? 0) > 1);

    // --- Die Werkzeuge: je ein Modus des Geometrie-Moduls ---
    const modusAus = (): void => {
        anlegen?.aus();
        anlegen = undefined;
        bearbeiten?.aus();
        bearbeiten = undefined;
        ziehenAus();
    };
    function starteKamm(): void {
        const l = lauf();
        if (l === undefined || karte === undefined) return;
        anlegen = installAnlegenModus(karte.map, karte.interaction, {
            art: KAMM_ANLEGEN,
            ziele,
            fangradius,
            stand: (stand) => setze({ zeichnet: stand.punkte }),
            fertig(punkte) {
                const rang = lauf()?.rang ?? "neben";
                // Kein Startwert (WI-0249; Vali wählte 2026-10-26): nur eingerastet die Höhe des Punkts darunter.
                const hoehen = punkte.map((p) => eingerasteteHoehe(netz(), p));
                schreibe((n) =>
                    mitKamm(
                        n,
                        punkte.map((p) => p.at),
                        rang,
                        hoehen,
                    ),
                );
                neuStarten();
            },
            abgewiesen: () => undefined,
        });
    }
    function starteNebengipfel(): void {
        if (karte === undefined) return;
        anlegen = installAnlegenModus(karte.map, karte.interaction, {
            art: NEBENGIPFEL_SETZEN,
            ziele: () => [],
            fangradius,
            // Ein Klick ist ein Nebengipfel: Er beendet sofort.
            stand: (stand) => {
                if (stand.punkte >= 1) queueMicrotask(() => anlegen?.fertig());
            },
            fertig(punkte) {
                const at = punkte[0]?.at;
                const mulde = lauf()?.werkzeug === "mulde";
                // Kein Startwert (WI-0249; Vali wählte 2026-10-26): Nebengipfel und Mulde ohne eigene Höhe.
                if (at !== undefined) schreibe((n) => (mulde ? mitMulde(n, at) : mitNebengipfel(n, at)));
                neuStarten();
                // Der neue Punkt steht gewählt (gelb), „Höhe … Schritt“ ist gleich stellbar (Blatt Gebirge, Bild 14).
                if (at !== undefined)
                    waehleAus([
                        {
                            nr:
                                netz().kaemme.length +
                                netz().nebengipfel.length +
                                (mulde ? (netz().mulden?.length ?? 0) : 0) -
                                1,
                        },
                    ]);
            },
            abgewiesen: () => undefined,
        });
    }
    function starteWaehlen(): void {
        const l = lauf();
        if (l === undefined || karte === undefined) return;
        const revision = (): number => standVon(l.bearbeitung.stand.value?.felder, l).revision ?? 0;
        const neu = installGeometrieModus(karte.map, karte.interaction, {
            art: GEBIRGSNETZ,
            teile: () => teileAus(l.flaeche, l.name, netz(), revision(), gew()),
            nachbarn: () => [],
            // Ein Knoten bleibt ein Knoten: Deckungsgleiche Punkte der anderen Kämme und Nebengipfel ziehen mit, Strg löst.
            mitziehenImObjekt: true,
            ziele,
            orte: () => [],
            fangradius,
            handbewegung(aenderung) {
                schreibe((n) => netzAus(aenderung.teile, n));
                const { nr, index } = aenderung.stelle;
                // Der gezogene oder eingefügte Stützpunkt steht danach gewählt; nach dem Löschen eines Punkts sein Kamm.
                waehleAus([istKamm(netz(), nr) && aenderung.art !== "loeschen" ? { nr, index } : { nr }]);
                neu?.aktualisiere();
            },
            kontext: (stelle) => waehleAus([{ nr: stelle.nr }]),
            // Die Vorschau zieht beim Ziehen eines Punkts nach (gedrosselt, ohne Erosion); beim Loslassen kommt der Schritt im Entwurf.
            zieht: (teile) => meldeZug(teile === undefined ? undefined : netzAus(teile, netz())),
            waehle: (teil, { umschalt }) => {
                const n = netz();
                waehleStelle(
                    teil.index !== undefined && istLinie(n, teil.nr)
                        ? { nr: teil.nr, index: teil.index }
                        : { nr: teil.nr },
                    umschalt,
                );
            },
            werkzeug: "landschaftseditor",
        });
        bearbeiten = neu;
        // Der Zug der Höhe läuft in „Wählen“ immer: ohne den Schalter nur am Griff ↕ eines Sees (`zielUnter`), mit ihm an jedem Punkt.
        starteZiehen();
    }
    /** Nach einem fertigen Kamm oder Nebengipfel: dasselbe Werkzeug von vorn (Zeichnen in Folge, V16). */
    function neuStarten(): void {
        const w = lauf()?.werkzeug;
        modusAus();
        setze({ zeichnet: 0 });
        if (w !== undefined) installiere(w);
    }
    function installiere(werkzeug: KammWerkzeug): void {
        if (werkzeug === "kamm") starteKamm();
        else if (werkzeug === "nebengipfel" || werkzeug === "mulde") starteNebengipfel();
        else starteWaehlen();
    }

    // --- Tasten: Enter schließt den Kamm ab, ⌫ nimmt seinen letzten Punkt; sonst gehören sie der Seite (Strg+Z, Esc). ---
    const taste = (ereignis: KeyboardEvent): void => {
        if (lauf() === undefined) return;
        const ziel = ereignis.target as HTMLElement | null;
        if (ziel !== null && (ziel.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(ziel.tagName))) return;
        // Entf löscht das Gewählte (Blatt Gebirge, „Wählen“), in jedem Werkzeug.
        if (ereignis.key === "Delete" && (lauf()?.auswahl.length ?? 0) > 0) {
            ereignis.preventDefault();
            netzObjekt.loesche();
            return;
        }
        if (anlegen === undefined) return;
        const zeichnet = (lauf()?.zeichnet ?? 0) > 0;
        if (ereignis.key === "Enter" && zeichnet) {
            ereignis.preventDefault();
            ereignis.stopPropagation();
            anlegen.fertig();
        } else if (ereignis.key === "Backspace" && zeichnet) {
            ereignis.preventDefault();
            anlegen.zurueck();
        }
    };

    function beende(): void {
        for (const s of stop) s();
        stop = [];
        meldeZug(undefined);
        if (hoehenFrame !== undefined) cancelAnimationFrame(hoehenFrame);
        hoehenFrame = undefined;
        globalThis.removeEventListener("keydown", taste, true);
        modusAus();
        entferneLage();
        vergissEinzug();
        karte = undefined;
        profilZug = undefined;
        if (kammNetzProfil.value === profilBruecke) kammNetzProfil.value = undefined;
        laufend.value = undefined;
    }

    // --- Das Profil im Reiter „Gebirge“ greift in diesen Entwurf (WI-0259, `kamm-netz-profil.ts`) ---
    let profilZug: { punkt: NetzPunkt } | undefined;
    const profilBruecke: KammNetzProfil = {
        flaeche: () => lauf()?.flaeche,
        netz: anzeigeNetz,
        gewaesser: gew,
        eingabe: () => lauf()?.daten?.eingabe,
        gewaehlt: () => new Set(punkteDerAuswahl(anzeigeNetz(), lauf()?.auswahl ?? [], gew()).map(punktSchluessel)),
        waehle: waehleStelle,
        zugLaeuft: () => profilZug !== undefined,
        ziehe(punkt, h) {
            if (lauf() === undefined) return;
            profilZug = { punkt };
            const zugNetz = mitHoehen(netz(), [{ ...punkt, h }], gew());
            setze({ zugNetz });
            meldeZug(zugNetz);
        },
        zugEnde() {
            const laufender = profilZug;
            const ziel = lauf()?.zugNetz;
            profilZug = undefined;
            meldeZug(undefined);
            setze({ zugNetz: undefined });
            if (laufender === undefined || ziel === undefined) return;
            // EIN Schritt im Entwurf; der Wert steht schon begrenzt im Netz des Zugs.
            const h = eigeneHoehe(ziel, laufender.punkt, gew()) ?? null;
            schreibe((n) => mitHoehen(n, [{ ...laufender.punkt, h }], gew()));
        },
        zugAb() {
            profilZug = undefined;
            meldeZug(undefined);
            setze({ zugNetz: undefined });
        },
        entferne(punkt) {
            schreibe((n) => mitHoehen(n, [{ ...punkt, h: null }], gew()));
        },
        setzeHoehe(punkt, h) {
            // Tasten in Folge sind EIN Schritt, bis `abschluss` (der Griff verliert den Fokus).
            schreibe((n) => mitHoehen(n, [{ ...punkt, h }], gew()), `gebirgsnetz.profil.${punktSchluessel(punkt)}`);
        },
        abschluss: () => lauf()?.bearbeitung.feldVerlassen(),
    };

    const netzObjekt: KammNetz = {
        laufend,
        netz,
        anzeigeNetz,
        hoehen,
        hoeheVon,
        auswahlPunkte: () => punkteDerAuswahl(netz(), lauf()?.auswahl ?? [], gew()),
        starte(regionId, wunsch) {
            beende();
            const k = seite.karte();
            const bearbeitung = seite.bearbeitung(regionId);
            if (k === undefined || bearbeitung === undefined) return;
            // Das Fenster liest das Detail eben erst: darauf warten, dann beginnen.
            if (bearbeitung.detail.value === undefined) {
                const warte = watch(
                    () => bearbeitung.detail.value,
                    (detail) => {
                        if (detail === undefined) return;
                        warte();
                        netzObjekt.starte(regionId, wunsch);
                    },
                );
                stop = [warte];
                return;
            }
            const flaeche = wunsch ?? bearbeitung.detail.value.areas[0]?.id;
            if (flaeche === undefined) return;
            karte = k;
            const name = bearbeitung.detail.value.name;
            const beginn: KammNetzLauf = {
                id: regionId,
                flaeche,
                name,
                werkzeug: "kamm",
                // Neue Kanten sind Nebenkämme (Blatt Gebirge, „Haupt- und Nebenkamm“: „Vorgabe: Nebenkamm“).
                rang: "neben",
                gewaehlt: undefined,
                auswahl: [],
                zeichnet: 0,
                hoehenZug: false,
                zugNetz: undefined,
                daten: undefined,
                gewaesser: KEIN_GEWAESSER,
                bearbeitung,
            };
            // Hat das Gebirge schon ein Netz (im Entwurf oder gelesen), beginnt der Modus mit „Wählen“: Punkte ziehen, Doppelklick, Entf
            // (OPS-055, OPS-057); ohne Netz mit dem Zeichnen des ersten Kamms.
            const start = startWerkzeug(netzVon(beginn));
            laufend.value = { ...beginn, werkzeug: start };
            installiere(start);
            if (anlegen === undefined && bearbeiten === undefined) {
                // Ein anderer Modus des Moduls läuft (der Hinweis kam schon): nichts beginnt.
                laufend.value = undefined;
                karte = undefined;
                return;
            }
            kammNetzProfil.value = profilBruecke;
            // Grundhöhe, Presets und Gipfel der Teilfläche für Kammhöhe und Vorgaben (WI-0249 P9); bis sie da sind, gilt die eigene Kammhöhe.
            void (seite.gebirge ?? ladeGebirge)(flaeche)
                .then((gelesen) => {
                    if (lauf()?.flaeche === flaeche)
                        setze({ daten: gelesen, gewaesser: gewaesserAus(gelesen?.eingabe) });
                })
                .catch(() => undefined);
            zeichne();
            // Formmodus A (Betreiber 2026-10-19): Ist von der Teilfläche nichts frei zu sehen, fliegt die Kamera hin.
            umriss = (bearbeitung.detail.value.areas.find((a) => a.id === flaeche)?.polygons ?? []).flatMap((polygon) =>
                polygon.map((ring) => ({ art: "ring" as const, punkte: ring.map(([x, y]) => ({ x, y })) })),
            );
            zeigeFrei(k.map, k.camera, umriss, SEARCH_FIT_MAX_ZOOM.landschaft);
            globalThis.addEventListener("keydown", taste, true);
            let warAktiv = bearbeitung.lage.value.aktiv;
            // Ein Klick ohne Umschalt, der keinen Punkt und keine Kante des Netzes trifft, hebt die Auswahl auf (Betreiber 2026-10-24: „auch
            // ein klick ins leere oder woanders muss eine mehrfachauswahl aufheben“); Klicks in die Leiste erreichen die Karte nicht.
            let mitUmschalt = false;
            const druck = (ereignis: PointerEvent): void => {
                mitUmschalt = ereignis.shiftKey;
            };
            const behaelter = k.map.getCanvasContainer();
            behaelter.addEventListener("pointerdown", druck, true);
            const klickBeobachter = k.interaction.observe("click", ({ claimedBy }) => {
                if (claimedBy === "geometry-edit" || mitUmschalt || (lauf()?.auswahl.length ?? 0) === 0) return;
                waehleAus([]);
            });
            // Ein Stilwechsel (`rebuildStyle` in app.vue, etwa nach dem Klick auf einen Ort oder ein Gebiet, mit `setStyle` und `diff`) nimmt
            // Quellen und Ebenen des Netzes mit: Sie kommen mit `styledata` wieder, einen Frame später (Ebenen mitten in der Stilaktualisierung
            // bleiben unevaluiert, wie in `gebirge-vorschau-karte.ts`). Sonst stünde das Netz samt Auswahl bis zur nächsten Änderung nicht mehr da.
            let stilFrame: number | undefined;
            const nachStil = (): void => {
                if (stilFrame !== undefined || !netzLageFehlt(k.map)) return;
                stilFrame = requestAnimationFrame(() => {
                    stilFrame = undefined;
                    if (lauf()?.id === regionId) zeichne();
                });
            };
            k.map.on("styledata", nachStil);
            stop = [
                klickBeobachter,
                () => behaelter.removeEventListener("pointerdown", druck, true),
                () => {
                    k.map.off("styledata", nachStil);
                    if (stilFrame !== undefined) cancelAnimationFrame(stilFrame);
                    stilFrame = undefined;
                },
                watch([kaemmeAnzeigen, kammHoehenZeigen, vorschauTalboden, vorschauFlaeche], () => zeichne()),
                // Die Flüsse stehen nur in „Wählen“ (WI-0259): Ein Wechsel des Werkzeugs zeichnet sie neu und holt ihre Zeichen über die Griffe.
                watch(
                    () => laufend.value?.werkzeug,
                    () => zeichne(),
                ),
                watch(
                    () => seite.getragen(regionId),
                    (getragen) => {
                        if (!getragen) beende();
                    },
                ),
                // Zwei Quellen, je für sich verglichen: Ein Getter mit neuem Array feuerte bei jedem neuen Lauf.
                watch([() => bearbeitung.stand.value, () => laufend.value?.auswahl, () => laufend.value?.daten], () => {
                    zeichne();
                    bearbeiten?.aktualisiere();
                    anlegen?.aktualisiere();
                }),
                // Ein Zug der Höhe ändert nur die Zahlen (einmal je Bild); Lagen und Griffe bleiben.
                watch(() => laufend.value?.zugNetz, planeHoehen),
                watch(
                    () => [bearbeitung.lage.value.aktiv, bearbeitung.zustand.value.art] as const,
                    ([aktiv, art]) => {
                        anlegen?.sperre(art === "speichert");
                        bearbeiten?.sperre(art === "speichert");
                        // Fertig oder Verwerfen beendet die Bearbeitung und damit den Modus.
                        if (warAktiv && !aktiv) beende();
                        warAktiv = aktiv;
                    },
                ),
            ];
        },
        umschalten(regionId, flaeche) {
            if (lauf()?.id === regionId) beende();
            else netzObjekt.starte(regionId, flaeche);
        },
        werkzeug(werkzeug) {
            if (lauf() === undefined || lauf()?.werkzeug === werkzeug) return;
            modusAus();
            // Ein Zeichenwerkzeug schaltet „↕ Höhe ziehen“ aus (WI-0249 P9).
            setze({
                werkzeug,
                zeichnet: 0,
                ...(werkzeug === "waehlen" ? {} : { gewaehlt: undefined, auswahl: [], hoehenZug: false }),
            });
            installiere(werkzeug);
        },
        rang(rang) {
            const l = lauf();
            if (l === undefined) return;
            setze({ rang });
            const kaemme = [...new Set(l.auswahl.map((s) => s.nr))].filter((nr) => istKamm(netz(), nr));
            if (kaemme.length > 0) schreibe((n) => kaemme.reduce((m, nr) => mitRang(m, nr, rang), n));
        },
        loesche() {
            const auswahl = lauf()?.auswahl ?? [];
            const art = loeschArt(netz(), auswahl, gew());
            if (art === undefined) return;
            // WI-0259: Auch die eigenen Höhen gewählter Flusspunkte und Seen gehen weg (in einem Schritt); den Verlauf eines Flusses ändert nur
            // der Wegeditor. Fallen nur Höhen weg, bleibt die Auswahl stehen (die `nr` der Gewässer ändern sich dabei nicht).
            schreibe((n) => ohneAuswahl(n, auswahl, gew()));
            if (art === "teile") waehleAus([]);
            bearbeiten?.aktualisiere();
        },
        loeschArt: () => loeschArt(netz(), lauf()?.auswahl ?? [], gew()),
        steigende() {
            const eingabe = lauf()?.daten?.eingabe;
            return eingabe === undefined || lauf()?.werkzeug !== "waehlen"
                ? []
                : steigendeFluesse(ansichten(), gew(), eingabe);
        },
        zahlFluesse: () => zahlDerFluesse(gew()),
        leere() {
            if (!netzHatTeile(netz())) return;
            schreibe(() => LEERES_NETZ);
            waehleAus([]);
            bearbeiten?.aktualisiere();
        },
        hoehe(h) {
            const l = lauf();
            const punkte = punkteDerAuswahl(netz(), l?.auswahl ?? [], gew());
            if (l === undefined || punkte.length === 0) return;
            // Ein Tippen in Folge ist EIN Schritt (bis das Feld verlassen wird), je Auswahl.
            const schluessel = l.auswahl.map((s) => `${String(s.nr)}:${String(s.index ?? "*")}`).join(",");
            schreibe(
                (n) =>
                    mitHoehen(
                        n,
                        punkte.map((p) => ({ ...p, h })),
                        gew(),
                    ),
                `gebirgsnetz.hoehe.${schluessel}`,
            );
        },
        hoehenZiehen(an) {
            const l = lauf();
            if (l === undefined) return;
            const neu = an ?? !l.hoehenZug;
            if (neu === l.hoehenZug) return;
            if (neu && l.werkzeug !== "waehlen") {
                // An schaltet auf „Wählen“: Gezogen wird an den Anfassern des Netzes.
                modusAus();
                setze({ werkzeug: "waehlen", zeichnet: 0, hoehenZug: true });
                installiere("waehlen");
                return;
            }
            // Der Zug selbst bleibt installiert (am Griff ↕ eines Sees gilt er auch ohne den Schalter); der Schalter sagt nur, wo sonst.
            setze({ hoehenZug: neu });
            starteZiehen();
        },
        zeigeGebirge() {
            const ecken = umriss.flatMap((teil) => teil.punkte).map((p) => toRenderLngLat(space, p));
            if (karte === undefined || ecken.length === 0) return;
            const lng = ecken.map((e) => e.lng);
            const lat = ecken.map((e) => e.lat);
            void karte.camera.showBounds(
                [
                    [Math.min(...lng), Math.min(...lat)],
                    [Math.max(...lng), Math.max(...lat)],
                ],
                { maxZoom: SEARCH_FIT_MAX_ZOOM.landschaft, free: targetInsets(karte.map) },
            );
        },
        typ() {
            const l = lauf();
            return l === undefined ? null : standVon(l.bearbeitung.stand.value?.felder, l).typ;
        },
        kammFertig() {
            if ((lauf()?.zeichnet ?? 0) > 0) anlegen?.fertig();
        },
        abbrechen() {
            if (lauf() === undefined) return false;
            // Esc während eines Zugs aus dem Profil: zurück auf den Wert davor (WI-0259).
            if (profilZug !== undefined) {
                profilBruecke.zugAb();
                return true;
            }
            // Esc während eines Zugs der Höhe: zurück auf den Wert davor, der Modus bleibt.
            if (ziehen?.abbrechen() === true) return true;
            // Dann nimmt Esc „↕ Höhe ziehen“ zurück (Betreiber 2026-10-25: „mit ESC die höheneinstellung abbrechen“): Auswahl und Modus „Wählen“
            // bleiben, erst die nächsten Esc heben die Auswahl auf und beenden den Modus.
            if (lauf()?.hoehenZug === true) {
                netzObjekt.hoehenZiehen(false);
                return true;
            }
            if ((lauf()?.zeichnet ?? 0) > 0 && anlegen !== undefined) {
                anlegen.verwerfen();
                setze({ zeichnet: 0 });
                return true;
            }
            // Dann hebt Esc die Auswahl auf (Betreiber 2026-10-24: „ESC soll in allen fällen mehrfachauswahlen wieder aufheben“), erst der
            // nächste beendet den Modus.
            if ((lauf()?.auswahl.length ?? 0) > 0) {
                waehleAus([]);
                return true;
            }
            beende();
            return true;
        },
        beende,
    };
    return netzObjekt;
}
