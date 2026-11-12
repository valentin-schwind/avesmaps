import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import { AVENTURIA, fromRenderLngLat, toRenderLngLat } from "@avesmaps3d/shared";
import { INTERACTION_PRIORITY } from "../interaction/priorities";
import { LONG_PRESS_MS } from "../interaction/long-press";
import type { Claim, HitContext, InteractionOwner, MapInteractionCoordinator } from "../interaction/types";
import { ANDOCK_UMKREIS, bildVon, type Zustand } from "./bild";
import { belegeGeometrie, meldeGeometrieAn } from "./besitzer";
import type {
    Aenderung,
    GeometrieArt,
    Marke,
    Mitgezogen,
    Pixel,
    Punkt,
    Stelle,
    Teil,
    Treffer,
    Ziel,
} from "./geometrie";
import {
    andockziele,
    aufGemeinsamerKante,
    deckungsgleich,
    einfuegePosition,
    einrasten,
    liegenBleibende,
    mitPunkt,
    flaechenKanteUnter,
    gruppeVerschoben,
    mitziehendeAller,
    ohneTeil,
    mitziehende,
    ohnePunkt,
    stellenAn,
    teilMit,
    teilungUnter,
    verschoben,
    type Teilung,
} from "./rechnung";
import {
    GEOMETRIE_ANFASSER_TREFFER,
    GEOMETRIE_KANTE_TREFFER,
    GEOMETRIE_STEUER_TREFFER,
    installGeometrieSchicht,
} from "./schicht";

/**
 * Der Modus „Geometrie bearbeiten“: der EINE Besitzer `geometry-edit` im Koordinator für alle Arten (WI-0177; Editor-Orchestrierung
 * 2026-10-15, Bedingung a; EDIT-0001 §4.7 G4). Angemeldet nur, solange jemand ausdrücklich einen Modus gestartet hat; dann gehören
 * ihm die Anfasser (Druck, Zeigen, Klick) und die Kante des bearbeiteten Objekts (Zeigen, Klick).
 *
 * - **Ziehen** eines Anfassers: Der Punkt folgt dem Zeiger, rastet nach den Regeln der Art im Fangradius ein (Kringel VOR dem
 *   Loslassen), Andockpunkte um den Zeiger leuchten, deckungsgleiche Punkte der Nachbarn ziehen mit. Strg einmal während des Zugs
 *   oder schon beim Druck: nichts rastet ein, nichts zieht mit, bis zum Loslassen („trennen“, `getrennt` in der Handbewegung). Solange
 *   ein Modus läuft, dreht Strg + Ziehen die Karte nicht (`besitzer.ts`; auf dem Griff Thomas 2026-10-19 über die Editor-Orchestrierung,
 *   überall Vali 2026-11-06). Am Finger trennt ein langer Druck vor dem Ziehen. Bei einer Art mit `loesen: false` (Kraftlinie) lösen weder
 *   Strg noch der lange Druck.
 * - **Ziehen** eines Steuergriffs (Art mit `steuergriff`, Kraftlinie: der Scheitel): Der Wert folgt dem Zeiger nach der Rechnung der
 *   Art, die Vorschau zeigt ihn live, die Lage vorher blass. Beim Loslassen EINE Handbewegung `steuern`; die Punkte bleiben.
 * - **Doppelklick** auf die Kante setzt dort einen Punkt (hinter dem nächsten geraden Abschnitt, Legacy), auf einen Anfasser löscht
 *   er ihn, soweit die Art es erlaubt. Mit Strg setzt er keinen.
 * - **Doppelklick in die Fläche** (Art mit Ringen und `einfuegen`; EDIT-0003 T59, OPS-000043, der Betreiber wählte 2026-10-20 „A Wie
 *   Legacy (Empfehlung)“): im Inneren und bis `SAUM_PX` neben der Kante setzt er einen Punkt an der Klickstelle, in die nächste Kante
 *   über alle Ringe (`flaechenKanteUnter`), auf einer gemeinsamen Kante auch in die Nachbarn. Den ersten Klick lässt der Modus durch
 *   (er wählt wie jeder Klick), erst den zweiten am selben Fleck nimmt er. Weiter draußen bleibt der Doppelklick „Fertig“
 *   (`editor-menu/doppelklick.ts`). Am Finger wirkt das Doppeltippen genauso.
 * - **R** (Art mit `eckenZeigen`, also Flächen; Betreiber 2026-11-06, wörtlich: „kann man einen shortcut einbauen (taste R) um die rundung während dem editieren ein und
 *   auszuschalten? beim verlassen wird wieder automatisch abgerundet“): schaltet die Vorschau zwischen Rundung und geraden Linien durch die Punkte um. Das gilt nur für
 *   diesen Modus; der nächste beginnt wieder gerundet. Geändert wird nichts, gespeichert wird ohnehin der eckige Umriss. Im Textfeld und mit Strg, Alt oder Umschalt
 *   wirkt R nicht; solange der Modus läuft, kommt das Kürzel „Ziel hinzufügen“ nicht durch.
 * - **Strg über einer Kante** (Art mit `einfuegen`, nicht bei `strgTeilt: false` wie im Gebirgsnetz; Betreiber 2026-10-20, Legacy
 *   `map-features-region-vertex-detach-edit.js`): die gerade
 *   Strecke leuchtet, darauf vier Vorschaupunkte; Strg + Klick setzt sie als EINE Handbewegung `einfuegen`, auf einer gemeinsamen Kante
 *   auch in die Nachbarn. Liegt eine Ecke näher als 14 px, gehört Strg ihr (trennen beim Ziehen) und die Kante zeigt nichts. Nach dem
 *   Setzen ruht Strg + Klick `TEILUNG_SPERRE_MS`, sonst setzte ein Doppelklick zweimal vier. Strg + Ziehen auf der Kante tut nichts; am
 *   Finger gibt es die Geste nicht.
 * - Die Doppelklick-Zoomung der Karte ruht, solange der Modus läuft; der Koordinator verteilt Klicks, also zählt der Modus zwei Klicks
 *   am selben Fleck selbst.
 * - **Loslassen** und jeder Doppelklick melden EINE fertige Handbewegung (`eingabe.handbewegung`); der Modus zeichnet sie sofort
 *   und wartet, bis der Aufrufer `aktualisiere` ruft. Während des Speicherns sperrt der Aufrufer (`sperre`).
 * - 🔴 Beim Ziehen fragt nichts den Server: Ziele, Nachbarn und Orte kommen vom Aufrufer, einmal beim Start und nach jeder Quittung.
 * - Rechtsklick auf einen Anfasser nur, wenn der Aufrufer ein Menü dafür hat (`kontext`); die Menüs teilt die Orchestrierung zu.
 * - **Einfacher Klick** auf einen Anfasser oder eine Kante meldet den Teil, wenn der Aufrufer `waehle` angibt (Gebirgsnetz „Wählen“,
 *   EDIT-0003 §6, Zuteilung der Orchestrierung 2026-10-20); auch der erste Klick eines Doppelklicks wählt, nicht mit Strg, nicht am
 *   Steuergriff. Am Anfasser nennt er die Stelle. Mit Umschalt meldet er die Mehrfachauswahl (WI-0249 P9, wie in den übrigen Editoren)
 *   und zählt nie als Hälfte eines Doppelklicks. Ohne Angabe tut er nichts.
 * - **Mehrere Ecken markieren** (Art mit `markieren`, alle Flächen; OPS-000081, Vali 2026-11-06: „ja mach das mit mehrfachauswahl und shift“,
 *   „du kannst das prinzip auch auf alle anderen flächen übertragen“): Umschalt + Klick auf eine Ecke nimmt sie in die Markierung auf oder heraus
 *   (gelber Ring), auch über mehrere Teilflächen und Löcher eines Objekts. Ein Zug an einer markierten Ecke bewegt alle markierten um dieselbe Strecke
 *   als EINE Handbewegung; die gemeinsamen Ecken der Nachbarn ziehen mit, Strg löst alle. Die Gruppe rastet nicht ein: Ein Ziel passt nur für die gezogene
 *   Ecke, und die Ecken eines Nachbarn, an denen sie einrasten könnte, ziehen womöglich gerade mit. Die Markierung endet mit Esc, einem Klick auf eine andere
 *   Stelle der Fläche, einem Zug an einer unmarkierten Ecke und jeder Handbewegung, die die Zahl der Ecken ändert; nach einem Zug bleibt sie, damit man
 *   nachfassen kann. Umschalt + Klick gehört dabei ganz dem Modus, auch neben einer Ecke: Ein Fehlklick wechselt nie das Gebiet und nimmt nichts in ein offenes
 *   Fenster auf. Darum ruht auch das Zoomen mit Umschalt + Ziehen, solange der Modus läuft (ein Klick, der ein paar Bildpunkte wandert, wäre sonst ein Zoom).
 *   Am Finger gibt es keine Umschalttaste, dort bleibt es bei einzelnen Ecken.
 * - **Mitziehen im eigenen Objekt** (`mitziehenImObjekt`, nur bei einer Art mit `mitziehen`; Gebirgsnetz: Kammenden am selben Knoten):
 *   deckungsgleiche Punkte der anderen Teile desselben Objekts ziehen mit wie die der Nachbarn, Strg löst; sie stehen in `teile` der
 *   Handbewegung, nicht in `mitgezogen`. Ohne Angabe ziehen nur die Nachbarn mit.
 * - Läuft schon ein Modus des Moduls, beginnt keiner: `installGeometrieModus` gibt `undefined` zurück, ein Hinweis sagt warum
 *   (`besitzer.ts`), der laufende bleibt.
 */

export interface GeometrieEingabe {
    readonly art: GeometrieArt;
    /** Die bearbeiteten Teile, wie sie gespeichert sind. */
    teile(): readonly Teil[];
    /** Die Teile anderer Objekte, deren Punkte mitziehen können. */
    nachbarn(): readonly Teil[];
    /** Woran eingerastet werden kann. */
    ziele(): readonly Ziel[];
    /** Wo Orte stehen: Dort zieht nichts mit. */
    orte(): readonly Punkt[];
    /** Der Fangradius in Bildpunkten (Karteneinstellung `fangradius`). */
    fangradius(): number;
    handbewegung(aenderung: Aenderung): void;
    /**
     * Rechtsklick auf einen Anfasser. Wer ihn angibt, bekommt auch den Rechtsklick am Anfasser: Er fällt nicht zum Objekt darunter
     * durch (O2), auch wenn der Aufrufer kein Menü zeigt (Ort verschieben).
     */
    kontext?(stelle: Stelle, screen: Pixel): void;
    /** Das Werkzeug, aus dessen Fenster der Modus kam: Dessen Liste zieht ein, solange er läuft (`besitzer.ts`). */
    readonly werkzeug?: string | undefined;
    /**
     * Ein einfacher Klick auf einen Anfasser oder eine Kante: welcher Teil (Kopf, „Einfacher Klick“), am Anfasser mit seiner Stelle (`index`),
     * und ob Umschalt gedrückt war (Mehrfachauswahl, dieselbe Geste wie in den übrigen Editoren). Ohne Angabe wie bisher.
     */
    waehle?(
        teil: { readonly objekt: string; readonly nr: number; readonly index?: number },
        art: { readonly umschalt: boolean },
    ): void;
    /** Ziehen nimmt auch deckungsgleiche Punkte der anderen eigenen Teile mit (Kopf, „Mitziehen im eigenen Objekt“). */
    readonly mitziehenImObjekt?: boolean | undefined;
    /**
     * Während eines Zugs je Bewegung die Teile mit dem Punkt unter dem Zeiger (samt mitgezogenen eigenen), am Ende des Zugs (Loslassen,
     * Abbruch) `undefined`, vor der Handbewegung. Für eine Vorschau, die beim Ziehen nachzieht (Gebirgsnetz, WI-0249); drosseln muss der
     * Aufrufer. Ohne Angabe wie bisher.
     */
    zieht?(teile: readonly Teil[] | undefined): void;
}

/** Die anderen Teile des gezogenen Objekts: Ihre deckungsgleichen Punkte ziehen bei `mitziehenImObjekt` mit. */
export function andereEigene(teile: readonly Teil[], gezogen: { objekt: string; nr: number }): Teil[] {
    // Ein Teil nur zum Wählen (`Teil.fest`) zieht nie mit.
    return teile.filter((t) => t.objekt === gezogen.objekt && t.nr !== gezogen.nr && t.fest !== true);
}

/** Die Teile nach einem Zug: der gezogene Punkt und die mitgezogenen eigenen Punkte (`eigene`) an ihrer neuen Stelle. */
export function teileNachZug(
    teile: readonly Teil[],
    gezogen: Stelle,
    at: Punkt,
    eigene: readonly Mitgezogen[],
): Teil[] {
    return teile.map((t) => {
        let punkte =
            t.objekt === gezogen.objekt && t.nr === gezogen.nr ? verschoben(t.punkte, gezogen.index, at) : t.punkte;
        for (const m of eigene)
            if (m.stelle.objekt === t.objekt && m.stelle.nr === t.nr)
                punkte = verschoben(punkte, m.stelle.index, m.nach);
        return punkte === t.punkte ? t : teilMit(t, punkte);
    });
}

export interface GeometrieModus {
    /** Nach einer Quittung oder einem neuen Lesen: Teile, Nachbarn und Ziele neu holen und zeichnen. */
    aktualisiere(): void;
    /** Die Marken des Aufrufers (bestätigter Anschluss, offenes Ende). */
    markiere(marken: readonly Marke[]): void;
    /** Während gespeichert wird, packt niemand einen Anfasser und kein Doppelklick ändert etwas. */
    sperre(gesperrt: boolean): void;
    /** Bricht einen laufenden Zug ab; der Punkt geht zurück. Gibt zurück, ob einer lief. */
    abbrechen(): boolean;
    /** Liegt der Bildpunkt in der bearbeiteten Fläche oder im Saum ihrer Kante, wo ein Doppelklick einen Punkt setzt (T59)? Eine bloße Vorschau ohne Anfasser trägt nichts. */
    traegt?(punkt: Pixel): boolean;
    aus(): void;
}

/** Erst ab dieser Strecke ist ein Druck ein Ziehen (wie beim Ort verschieben und beim Wegpunktziehen). */
const DRAG_THRESHOLD_PX = 3;
/** Zwei Klicks in dieser Zeit und Nähe sind ein Doppelklick. */
const DOPPELKLICK_MS = 400;
const DOPPELKLICK_PX = 6;
/** Nach Strg + Klick ruht die Geste so lange: Ein Doppelklick feuert zwei Klicks (Legacy `lastEdgeSubdivisionAt`, 350 ms). */
export const TEILUNG_SPERRE_MS = 350;

const space = AVENTURIA.coordinateSpace;
const lngLat = (p: Punkt): [number, number] => {
    const render = toRenderLngLat(space, p);
    return [render.lng, render.lat];
};

type Anspruch = Claim & {
    readonly ziel: "anfasser" | "kante" | "innen" | "steuer" | "teilung" | "umschalt";
    readonly stelle?: Stelle;
    readonly teil?: { objekt: string; nr: number };
};

/** Ein Zug am Steuergriff eines Teils: der Wert beim Druck und der laufende. */
interface SteuerZug {
    readonly teil: { readonly objekt: string; readonly nr: number };
    readonly start: Pixel;
    readonly offset: Pixel;
    readonly von: number | undefined;
    readonly release: () => void;
    wert: number | undefined;
    moved: boolean;
}

interface Zug {
    readonly stelle: Stelle;
    readonly start: Pixel;
    readonly offset: Pixel;
    readonly von: Punkt;
    readonly release: () => void;
    last: Pixel;
    moved: boolean;
    getrennt: boolean;
    langerDruck: ReturnType<typeof setTimeout> | undefined;
    at: Punkt;
    treffer: Treffer | undefined;
    mitgezogen: Mitgezogen[];
    /** Mitgezogene Punkte anderer Teile desselben Objekts (`mitziehenImObjekt`), beim Gruppenzug die übrigen markierten Ecken. */
    eigene: Mitgezogen[];
    /** Die übrigen markierten Ecken, die mit diesem Zug wandern (leer: der Zug bewegt nur diese eine Ecke). */
    readonly gruppe: readonly { readonly stelle: Stelle; readonly revision: number; readonly von: Punkt }[];
    andock: Ziel[];
}

function istHauptdruck(event: MapMouseEvent | MapTouchEvent): boolean {
    const original = event.originalEvent;
    return !(
        ("touches" in original && original.touches.length !== 1) ||
        ("button" in original && original.button !== 0)
    );
}

const strgGedrueckt = (event: MapMouseEvent | MapTouchEvent): boolean =>
    "ctrlKey" in event.originalEvent && (event.originalEvent.ctrlKey || event.originalEvent.metaKey);

const umschaltGedrueckt = (event: MapMouseEvent | MapTouchEvent): boolean =>
    "shiftKey" in event.originalEvent && event.originalEvent.shiftKey;

const gleicheStelle = (a: Stelle, b: Stelle): boolean => a.objekt === b.objekt && a.nr === b.nr && a.index === b.index;
/** Wie viele Ecken jeder Teil hat: Ändert es sich, stimmen die Stellen der Markierung nicht mehr. */
const aufbauVon = (teile: readonly Teil[]): string =>
    teile.map((t) => `${t.objekt} ${String(t.nr)} ${String(t.punkte.length)}`).join("|");

const stelleAus = (properties: Record<string, unknown>): Stelle => ({
    objekt: String(properties["objekt"]),
    nr: Number(properties["nr"]),
    index: Number(properties["index"]),
});

export function installGeometrieModus(
    map: MapLibreMap,
    interaction: MapInteractionCoordinator,
    eingabe: GeometrieEingabe,
): GeometrieModus | undefined {
    const belegung = belegeGeometrie(eingabe.werkzeug);
    if (belegung === undefined) return undefined;
    const { art } = eingabe;
    const schicht = installGeometrieSchicht(map);
    const schirm = (p: Punkt): Pixel => map.project(lngLat(p));
    let teile: readonly Teil[] = eingabe.teile();
    let marken: readonly Marke[] = [];
    let zug: Zug | undefined;
    let steuerZug: SteuerZug | undefined;
    let gesperrt = false;
    let aktiv = true;
    let letzterKlick: { zeit: number; at: Pixel; ziel: Anspruch["ziel"]; schluessel: string } | undefined;
    /** Strg über einer Kante: was ein Klick setzen würde, und wo der Zeiger zuletzt war (für Strg ohne Mausbewegung). */
    let teilung: Teilung | undefined;
    let zeigerZuletzt: Pixel | undefined;
    let geteiltUm = Number.NEGATIVE_INFINITY;
    const zoomVorher = map.doubleClickZoom.isEnabled();
    map.doubleClickZoom.disable();
    const markierbar = art.markieren === true;
    /** Die markierten Ecken (Kopf, „Mehrere Ecken markieren“) und der Aufbau der Teile, für den ihre Stellen gelten. */
    let markiert: readonly Stelle[] = [];
    let markenAufbau = "";
    const kastenVorher = markierbar && map.boxZoom.isEnabled();
    if (kastenVorher) map.boxZoom.disable();

    const teilVon = (stelle: { objekt: string; nr: number }): Teil | undefined =>
        teile.find((t) => t.objekt === stelle.objekt && t.nr === stelle.nr);
    const imObjekt = art.mitziehen && eingabe.mitziehenImObjekt === true;
    /** Woran beim Lösen etwas liegen bleibt: die Nachbarn, bei `mitziehenImObjekt` auch die anderen eigenen Teile. */
    const mitEigenen = (gezogen: { objekt: string; nr: number }): readonly Teil[] =>
        imObjekt ? [...eingabe.nachbarn(), ...andereEigene(teile, gezogen)] : eingabe.nachbarn();

    /** Taste R (Kopf oben): die Rundung für diesen Modus ausgeschaltet. */
    let eckig = false;

    const zeichne = (): void => {
        const steuernd = steuerZug;
        if (steuernd?.moved === true) {
            const derselbe = (t: Teil): boolean => t.objekt === steuernd.teil.objekt && t.nr === steuernd.teil.nr;
            schicht.zeige(
                bildVon(
                    art,
                    {
                        teile: teile.map((t) => (derselbe(t) ? { ...t, wert: steuernd.wert } : t)),
                        vorher: teile.filter(derselbe),
                        nachbarn: eingabe.nachbarn(),
                        mitgezogen: [],
                        gesteuert: steuernd.teil,
                        andock: [],
                        marken: [],
                    },
                    eingabe.fangradius(),
                ),
            );
            return;
        }
        const laufend = zug;
        const zustand: Zustand = laufend
            ? {
                  teile: teileNachZug(teile, laufend.stelle, laufend.at, laufend.eigene),
                  vorher: laufend.moved
                      ? teile.filter(
                            (t) =>
                                t.objekt === laufend.stelle.objekt ||
                                laufend.gruppe.some((g) => g.stelle.objekt === t.objekt),
                        )
                      : undefined,
                  nachbarn: eingabe.nachbarn(),
                  mitgezogen: laufend.mitgezogen,
                  // Die Gruppe rastet nicht ein: keine Hülle um die gezogene Ecke.
                  gezogen:
                      laufend.moved && laufend.gruppe.length === 0
                          ? { stelle: laufend.stelle, at: laufend.at }
                          : undefined,
                  treffer: laufend.treffer,
                  andock: laufend.andock,
                  marken: [],
                  liegen:
                      laufend.moved && art.mitziehen
                          ? [laufend.von, ...laufend.gruppe.map((g) => g.von)].flatMap((von) =>
                                liegenBleibende(von, mitEigenen(laufend.stelle), eingabe.orte(), laufend.getrennt),
                            )
                          : [],
                  markiert,
              }
            : { teile, nachbarn: eingabe.nachbarn(), mitgezogen: [], andock: [], marken, teilung, markiert };
        schicht.zeige(bildVon(art, { ...zustand, eckig }, eingabe.fangradius()));
    };

    /**
     * Die Kante für Strg + Klick unter dem Zeiger; keine ohne Strg, ohne `einfuegen`, bei `strgTeilt: false` (Gebirgsnetz), während eines
     * Zugs oder des Speicherns.
     */
    const teilungAn = (zeiger: Pixel | undefined, strg: boolean): Teilung | undefined =>
        strg &&
        zeiger !== undefined &&
        art.einfuegen &&
        art.strgTeilt !== false &&
        !gesperrt &&
        zug === undefined &&
        steuerZug === undefined
            ? teilungUnter(teile, zeiger, schirm)
            : undefined;
    const gleicheTeilung = (a: Teilung | undefined, b: Teilung | undefined): boolean =>
        a === b ||
        (a !== undefined &&
            b !== undefined &&
            a.objekt === b.objekt &&
            a.nr === b.nr &&
            a.position === b.position &&
            deckungsgleich(a.von, b.von) &&
            deckungsgleich(a.bis, b.bis));
    /** Die Vorschau der vier Punkte zeigen oder wegnehmen; gezeichnet nur, wenn sie sich ändert. */
    const zeigeTeilung = (neu: Teilung | undefined): void => {
        if (gleicheTeilung(teilung, neu)) return;
        teilung = neu;
        if (aktiv) zeichne();
    };
    // Strg drücken oder loslassen, ohne die Maus zu bewegen: Die Vorschau kommt und geht sofort (Legacy `keyup` „Control“).
    const strgTaste = (event: KeyboardEvent): void => {
        if (event.key !== "Control" && event.key !== "Meta") return;
        zeigeTeilung(teilungAn(zeigerZuletzt, event.type === "keydown"));
    };
    // 🪤 In der Capture-Phase, vor den Tastenkürzeln: R heißt sonst „Ziel hinzufügen“ (`keyboard/shortcuts.ts`), `preventDefault` hält es zurück.
    const rundungTaste = (event: KeyboardEvent): void => {
        if (art.eckenZeigen !== true || event.key.toLowerCase() !== "r") return;
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        const ziel = event.target as Partial<Pick<Element, "closest">> | null;
        if (ziel?.closest?.("input, textarea, select, [contenteditable='true']")) return;
        event.preventDefault();
        if (event.repeat) return;
        eckig = !eckig;
        zeichne();
    };
    const ohneZeiger = (): void => {
        zeigerZuletzt = undefined;
        zeigeTeilung(undefined);
    };

    const istMarkiert = (stelle: Stelle): boolean => markiert.some((m) => gleicheStelle(m, stelle));
    const schalteMarke = (stelle: Stelle): void => {
        markenAufbau = aufbauVon(teile);
        markiert = istMarkiert(stelle) ? markiert.filter((m) => !gleicheStelle(m, stelle)) : [...markiert, stelle];
        if (aktiv) zeichne();
    };
    const leereMarken = (): void => {
        if (markiert.length === 0) return;
        markiert = [];
        if (aktiv) zeichne();
    };
    /** Hat sich die Zahl der Ecken geändert, stimmen die Stellen nicht mehr: Die Markierung endet. */
    const pruefeMarken = (): void => {
        if (markiert.length > 0 && aufbauVon(teile) !== markenAufbau) markiert = [];
    };

    const folge = (zeiger: Pixel, strg: boolean): void => {
        const laufend = zug;
        const teil = laufend && teilVon(laufend.stelle);
        if (!laufend || !teil) return;
        laufend.getrennt ||= strg && art.loesen !== false;
        const spitze = { x: zeiger.x - laufend.offset.x, y: zeiger.y - laufend.offset.y };
        const roh = fromRenderLngLat(space, map.unproject([spitze.x, spitze.y]));
        if (laufend.gruppe.length > 0) {
            laufend.at = roh;
            laufend.eigene = gruppeVerschoben(laufend.gruppe, roh.x - laufend.von.x, roh.y - laufend.von.y);
            laufend.mitgezogen = art.mitziehen
                ? mitziehendeAller(
                      [{ von: laufend.von, nach: roh }, ...laufend.eigene],
                      eingabe.nachbarn(),
                      eingabe.orte(),
                      laufend.getrennt,
                  )
                : [];
            zeichne();
            return;
        }
        const erlaubt = laufend.getrennt ? [] : art.ziele(laufend.stelle, teil);
        // Nie am Ausgangspunkt selbst, außer an einem Ort oder Gipfel: Dort liegt der Punkt eines Nachbarn, der mitzieht, und ein Kammende,
        // das man vom Gipfel weg- und zurückzieht, rastet wieder an ihm ein (Gebirgsnetz, Fund der Derographie, Orchestrierung 2026-10-20).
        const zulassen = (ziel: Ziel): boolean =>
            art.zielErlaubt(ziel, laufend.stelle, teil) &&
            (ziel.art === "ort" || ziel.art === "gipfel" || !deckungsgleich(ziel.at, laufend.von));
        const ziele = eingabe.ziele();
        laufend.treffer = einrasten(spitze, ziele, erlaubt, eingabe.fangradius(), schirm, zulassen);
        laufend.at = laufend.treffer?.at ?? roh;
        laufend.andock = andockziele(spitze, ziele, erlaubt, eingabe.fangradius() * ANDOCK_UMKREIS, schirm, zulassen);
        laufend.mitgezogen = art.mitziehen
            ? mitziehende(laufend.von, laufend.at, eingabe.nachbarn(), eingabe.orte(), laufend.getrennt)
            : [];
        laufend.eigene = imObjekt
            ? mitziehende(
                  laufend.von,
                  laufend.at,
                  andereEigene(teile, laufend.stelle),
                  eingabe.orte(),
                  laufend.getrennt,
              )
            : [];
        zeichne();
        eingabe.zieht?.(teileNachZug(teile, laufend.stelle, laufend.at, laufend.eigene));
    };

    const trenne = (): void => {
        const laufend = zug;
        if (!laufend || laufend.getrennt || art.loesen === false) return;
        laufend.getrennt = true;
        folge(laufend.last, true);
    };

    // Strg drücken, ohne die Maus zu bewegen: sofort gelöst, klebrig bis zum Loslassen (G4).
    const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Control" || event.key === "Meta") trenne();
    };

    const ende = (): void => {
        const laufend = zug;
        const steuernd = steuerZug;
        zug = undefined;
        steuerZug = undefined;
        if (laufend?.moved === true) eingabe.zieht?.(undefined);
        if (laufend?.langerDruck !== undefined) clearTimeout(laufend.langerDruck);
        laufend?.release();
        steuernd?.release();
        globalThis.removeEventListener("keydown", onKey);
        globalThis.removeEventListener("mouseup", drop);
    };

    const greife = (event: MapMouseEvent | MapTouchEvent, stelle: Stelle): void => {
        const teil = teilVon(stelle);
        const von = teil?.punkte[stelle.index];
        if (!teil || !von) return;
        // 🔴 Erst erfassen: Der Druck gehört dem Anfasser, ein langer Druck öffnet kein Kartenmenü.
        const release = interaction.capture("geometry-edit", undefined, "grabbing");
        if (!release) return;
        event.preventDefault();
        // Ein Zug an einer unmarkierten Ecke beendet die Markierung; an einer markierten nimmt er die übrigen mit.
        if (!istMarkiert(stelle)) leereMarken();
        const gruppe = markiert.flatMap((m) => {
            const ihr = teilVon(m);
            const ihrVon = ihr?.punkte[m.index];
            return gleicheStelle(m, stelle) || !ihr || !ihrVon
                ? []
                : [{ stelle: m, revision: ihr.revision, von: ihrVon }];
        });
        const spitze = schirm(von);
        const at = { x: event.point.x, y: event.point.y };
        const amFinger = "touches" in event.originalEvent;
        zug = {
            stelle,
            start: at,
            offset: { x: at.x - spitze.x, y: at.y - spitze.y },
            von,
            release,
            last: at,
            moved: false,
            // Strg schon beim Druck: getrennt vom ersten Schritt an (die Kamera hat ihn dem Griff gelassen).
            getrennt: strgGedrueckt(event) && art.loesen !== false,
            langerDruck: amFinger && art.loesen !== false ? setTimeout(trenne, LONG_PRESS_MS) : undefined,
            at: von,
            treffer: undefined,
            mitgezogen: [],
            eigene: [],
            gruppe,
            andock: [],
        };
        teilung = undefined;
        globalThis.addEventListener("keydown", onKey);
        // 🪤 Losgelassen über einem Fenster oder außerhalb: Die Karte meldet dann kein `mouseup`.
        globalThis.addEventListener("mouseup", drop);
    };

    /** Ein Druck auf den Steuergriff eines Teils: Der Wert folgt dem Zeiger, bis er loslässt. */
    const greifeSteuer = (event: MapMouseEvent | MapTouchEvent, ref: { objekt: string; nr: number }): void => {
        const teil = teilVon(ref);
        const lage = teil !== undefined ? art.steuergriff?.lage(teil) : undefined;
        if (!teil || !lage) return;
        const release = interaction.capture("geometry-edit", undefined, "grabbing");
        if (!release) return;
        event.preventDefault();
        const spitze = schirm(lage);
        const at = { x: event.point.x, y: event.point.y };
        steuerZug = {
            teil: { objekt: teil.objekt, nr: teil.nr },
            start: at,
            offset: { x: at.x - spitze.x, y: at.y - spitze.y },
            von: teil.wert,
            release,
            wert: teil.wert,
            moved: false,
        };
        globalThis.addEventListener("mouseup", drop);
    };

    const steuere = (zeiger: Pixel): void => {
        const steuernd = steuerZug;
        const teil = steuernd && teilVon(steuernd.teil);
        if (!steuernd || !teil || !art.steuergriff) return;
        if (!steuernd.moved && Math.hypot(zeiger.x - steuernd.start.x, zeiger.y - steuernd.start.y) < DRAG_THRESHOLD_PX)
            return;
        steuernd.moved = true;
        const spitze = { x: zeiger.x - steuernd.offset.x, y: zeiger.y - steuernd.offset.y };
        steuernd.wert = art.steuergriff.wert(teil, fromRenderLngLat(space, map.unproject([spitze.x, spitze.y])));
        zeichne();
    };

    const bewege = (event: MapMouseEvent | MapTouchEvent): void => {
        if (!zug && !steuerZug && !("touches" in event.originalEvent)) {
            zeigerZuletzt = { x: event.point.x, y: event.point.y };
            zeigeTeilung(teilungAn(zeigerZuletzt, strgGedrueckt(event)));
        }
        if (steuerZug) {
            steuere({ x: event.point.x, y: event.point.y });
            return;
        }
        const laufend = zug;
        if (!laufend) return;
        laufend.last = { x: event.point.x, y: event.point.y };
        if (
            !laufend.moved &&
            Math.hypot(laufend.last.x - laufend.start.x, laufend.last.y - laufend.start.y) < DRAG_THRESHOLD_PX
        )
            return;
        if (laufend.langerDruck !== undefined) {
            clearTimeout(laufend.langerDruck);
            laufend.langerDruck = undefined;
        }
        laufend.moved = true;
        folge(laufend.last, strgGedrueckt(event));
    };

    const melde = (aenderung: Aenderung): void => {
        teile = aenderung.teile;
        pruefeMarken();
        zeichne();
        eingabe.handbewegung(aenderung);
    };

    function drop(): void {
        const steuernd = steuerZug;
        if (steuernd) {
            ende();
            const teil = teilVon(steuernd.teil);
            if (!steuernd.moved || !teil || steuernd.wert === steuernd.von) {
                zeichne();
                return;
            }
            const neu: Teil = { ...teil, wert: steuernd.wert };
            melde({
                art: "steuern",
                stelle: { objekt: teil.objekt, nr: teil.nr, index: -1 },
                teile: teile.map((t) => (t === teil ? neu : t)),
                mitgezogen: [],
                treffer: undefined,
                getrennt: false,
            });
            return;
        }
        const laufend = zug;
        if (!laufend) return;
        ende();
        const teil = teilVon(laufend.stelle);
        if (!laufend.moved || !teil || (laufend.at.x === laufend.von.x && laufend.at.y === laufend.von.y)) {
            zeichne();
            return;
        }
        melde({
            art: "ziehen",
            stelle: laufend.stelle,
            ...(laufend.gruppe.length > 0 ? { auch: laufend.gruppe.map((g) => g.stelle) } : {}),
            teile: teileNachZug(teile, laufend.stelle, laufend.at, laufend.eigene),
            mitgezogen: laufend.mitgezogen,
            treffer: laufend.treffer,
            getrennt: laufend.getrennt,
        });
    }

    const abbrechen = (): boolean => {
        const lief = zug !== undefined || steuerZug !== undefined;
        ende();
        if (aktiv) zeichne();
        return lief;
    };

    const fuegeEin = (stelle: { objekt: string; nr: number }, zeiger: Pixel): void => {
        const teil = teilVon(stelle);
        if (!teil || !art.einfuegen || teil.art === "punkt") return;
        const position = einfuegePosition(teil.punkte, zeiger, schirm, teil.art === "ring");
        const at = fromRenderLngLat(space, map.unproject([zeiger.x, zeiger.y]));
        const neu = teilMit(teil, mitPunkt(teil.punkte, position, at));
        // Auf einer gemeinsamen Kante kommt derselbe Punkt auch in die Nachbarn (Thomas 2026-10-19, 5.2).
        const eingefuegt = art.mitziehen ? aufGemeinsamerKante(teil, position, at, eingabe.nachbarn()) : [];
        melde({
            art: "einfuegen",
            stelle: { objekt: teil.objekt, nr: teil.nr, index: position },
            teile: teile.map((t) => (t === teil ? neu : t)),
            mitgezogen: [],
            ...(eingefuegt.length > 0 ? { eingefuegt } : {}),
            treffer: undefined,
            getrennt: false,
        });
    };

    /** Strg + Klick: die vier Punkte auf die Strecke unter dem Zeiger, auf einer gemeinsamen Kante auch in die Nachbarn. */
    const unterteile = (zeiger: Pixel): void => {
        const jetzt = performance.now();
        if (gesperrt || jetzt - geteiltUm < TEILUNG_SPERRE_MS) return;
        const ziel = teilungUnter(teile, zeiger, schirm);
        const teil = ziel && teilVon(ziel);
        if (!ziel || !teil) return;
        geteiltUm = jetzt;
        letzterKlick = undefined;
        teilung = undefined;
        const punkte = [...teil.punkte.slice(0, ziel.position), ...ziel.punkte, ...teil.punkte.slice(ziel.position)];
        const eingefuegt = art.mitziehen
            ? aufGemeinsamerKante(teil, ziel.position, ziel.punkte, eingabe.nachbarn())
            : [];
        melde({
            art: "einfuegen",
            stelle: { objekt: teil.objekt, nr: teil.nr, index: ziel.position },
            teile: teile.map((t) => (t === teil ? teilMit(teil, punkte) : t)),
            mitgezogen: [],
            ...(eingefuegt.length > 0 ? { eingefuegt } : {}),
            treffer: undefined,
            getrennt: false,
        });
    };

    const loesche = (stelle: Stelle): void => {
        const teil = teilVon(stelle);
        const ohne =
            teil !== undefined && art.teilLoeschbar === true ? ohneTeil(teile, teil, art.mindestens) : undefined;
        if (ohne !== undefined) {
            melde({ art: "loeschen", stelle, teile: ohne, mitgezogen: [], treffer: undefined, getrennt: false });
            return;
        }
        if (!teil || !art.loeschbar(stelle, teil) || teil.punkte.length <= art.mindestens) return;
        const neu = teilMit(teil, ohnePunkt(teil.punkte, stelle.index));
        const punkt = teil.punkte[stelle.index];
        const entfernt =
            art.mitziehen && teil.art === "ring" && punkt !== undefined
                ? stellenAn(punkt, eingabe.nachbarn()).map(({ objekt, nr, index }) => ({
                      stelle: { objekt, nr, index },
                  }))
                : [];
        melde({
            art: "loeschen",
            stelle,
            teile: teile.map((t) => (t === teil ? neu : t)),
            mitgezogen: [],
            ...(entfernt.length > 0 ? { entfernt } : {}),
            treffer: undefined,
            getrennt: false,
        });
    };

    /** Ist ein Klick an `at` der zweite eines Doppelklicks auf dasselbe Ziel? */
    const zweiterKlick = (at: Pixel, schluessel: string): boolean => {
        const vorher = letzterKlick;
        return (
            vorher !== undefined &&
            performance.now() - vorher.zeit <= DOPPELKLICK_MS &&
            vorher.schluessel === schluessel &&
            Math.hypot(at.x - vorher.at.x, at.y - vorher.at.y) <= DOPPELKLICK_PX
        );
    };
    /** Kante und Inneres desselben Objekts zählen zusammen: Ein Doppelklick genau am Rand der Kantenlinie ist einer. */
    const flaechenSchluessel = (objekt: string): string => `k:${objekt}`;

    /**
     * Ein Klick in die bearbeitete Fläche oder bis `SAUM_PX` neben ihre Kante (T59): Den ersten lässt der Modus durch, er wählt wie
     * jeder Klick; den zweiten am selben Fleck nimmt er, und `klick` setzt den Punkt.
     */
    const innenKlick = (context: HitContext): Anspruch | undefined => {
        if (art.teilart !== "ring" || !art.einfuegen) return undefined;
        const unter = flaechenKanteUnter(teile, context.point, schirm);
        if (unter === undefined) return undefined;
        const schluessel = flaechenSchluessel(unter.objekt);
        if (zweiterKlick(context.point, schluessel))
            return { cursor: "copy", ziel: "innen", teil: { objekt: unter.objekt, nr: unter.nr } };
        letzterKlick = { zeit: performance.now(), at: context.point, ziel: "innen", schluessel };
        leereMarken();
        return undefined;
    };

    const klick = (anspruch: Anspruch, context: HitContext): void => {
        // Ein Klick auf den Steuergriff ändert nichts; nur ein Zug.
        if (anspruch.ziel === "steuer") return;
        // Umschalt + Klick markiert (Kopf, „Mehrere Ecken markieren“) und ist nie die Hälfte eines Doppelklicks; neben einer Ecke tut er nichts.
        if (anspruch.ziel === "umschalt") {
            letzterKlick = undefined;
            if (!gesperrt && anspruch.stelle) schalteMarke(anspruch.stelle);
            return;
        }
        if (anspruch.ziel === "teilung") {
            unterteile(context.point);
            return;
        }
        // Der zweite Klick in die Fläche (`innenKlick`); mit Strg setzt auch er keinen einzelnen Punkt (Strg gehört den vier).
        if (anspruch.ziel === "innen") {
            letzterKlick = undefined;
            if (!gesperrt && !strgGedrueckt(context.event) && anspruch.teil) fuegeEin(anspruch.teil, context.point);
            return;
        }
        // Strg + Doppelklick auf die Kante setzt keinen einzelnen Punkt (Legacy): Strg gehört dort den vier.
        if (anspruch.ziel === "kante" && strgGedrueckt(context.event)) {
            letzterKlick = undefined;
            return;
        }
        const gewaehlt = (umschalt: boolean): void => {
            const teil = anspruch.stelle ?? anspruch.teil;
            if (teil === undefined) return;
            eingabe.waehle?.(
                anspruch.ziel === "anfasser" && anspruch.stelle
                    ? { objekt: teil.objekt, nr: teil.nr, index: anspruch.stelle.index }
                    : { objekt: teil.objekt, nr: teil.nr },
                { umschalt },
            );
        };
        // Umschalt + Klick nimmt in die Auswahl auf oder heraus und ist nie die Hälfte eines Doppelklicks (der zweite löschte sonst den Punkt).
        if (eingabe.waehle !== undefined && umschaltGedrueckt(context.event)) {
            letzterKlick = undefined;
            gewaehlt(true);
            return;
        }
        const schluessel =
            anspruch.ziel === "anfasser" && anspruch.stelle
                ? `a:${anspruch.stelle.objekt}:${String(anspruch.stelle.nr)}:${String(anspruch.stelle.index)}`
                : flaechenSchluessel(anspruch.teil?.objekt ?? "");
        const doppelt = zweiterKlick(context.point, schluessel);
        letzterKlick = { zeit: performance.now(), at: context.point, ziel: anspruch.ziel, schluessel };
        if (!doppelt) {
            if (!(anspruch.stelle && istMarkiert(anspruch.stelle))) leereMarken();
            gewaehlt(false);
            return;
        }
        if (gesperrt) return;
        letzterKlick = undefined;
        // Ein Teil nur zum Wählen: Der Doppelklick setzt und löscht nichts, er wählt noch einmal.
        if (teilVon(anspruch.stelle ?? anspruch.teil ?? { objekt: "", nr: -1 })?.fest === true) {
            gewaehlt(false);
            return;
        }
        if (anspruch.ziel === "anfasser" && anspruch.stelle) loesche(anspruch.stelle);
        else if (anspruch.ziel === "kante" && anspruch.teil) fuegeEin(anspruch.teil, context.point);
    };

    const owner: InteractionOwner<Anspruch> = {
        id: "geometry-edit",
        priority: INTERACTION_PRIORITY["geometry-edit"],
        kinds: eingabe.kontext ? ["press", "hover", "click", "contextmenu"] : ["press", "hover", "click"],
        layers: () => [GEOMETRIE_ANFASSER_TREFFER, GEOMETRIE_STEUER_TREFFER, GEOMETRIE_KANTE_TREFFER],
        hit(context) {
            // Umschalt gehört beim Markieren ganz dem Modus: Der Druck zieht nichts, und auch ein Klick neben eine Ecke fällt nicht zum Objekt darunter durch.
            if (
                markierbar &&
                (context.kind === "click" || context.kind === "press") &&
                umschaltGedrueckt(context.event)
            ) {
                const ecke = context.kind === "click" ? context.features([GEOMETRIE_ANFASSER_TREFFER])[0] : undefined;
                return {
                    cursor: "pointer",
                    ziel: "umschalt",
                    ...(ecke === undefined ? {} : { stelle: stelleAus(ecke.properties) }),
                };
            }
            const anfasser = context.features([GEOMETRIE_ANFASSER_TREFFER])[0];
            if (anfasser !== undefined) {
                if (context.kind === "press" && (gesperrt || !istHauptdruck(context.event))) return undefined;
                // Ein Teil nur zum Wählen (`Teil.fest`): Ein Druck gehört der Karte, Klick und Zeigen dem Modus.
                if (context.kind === "press" && teilVon(stelleAus(anfasser.properties))?.fest === true)
                    return undefined;
                return { cursor: "grab", ziel: "anfasser", stelle: stelleAus(anfasser.properties) };
            }
            // Der Steuergriff (Kraftlinie: der Scheitel) liegt auf der Kante; er geht ihr vor. Kein Menü an ihm.
            const steuer = art.steuergriff ? context.features([GEOMETRIE_STEUER_TREFFER])[0] : undefined;
            if (steuer !== undefined && context.kind !== "contextmenu") {
                if (context.kind === "press" && (gesperrt || !istHauptdruck(context.event))) return undefined;
                return {
                    cursor: "grab",
                    ziel: "steuer",
                    teil: { objekt: String(steuer.properties["objekt"]), nr: Number(steuer.properties["nr"]) },
                };
            }
            // Auf der Kante zieht ein Druck die Karte wie sonst; nur Zeigen und Klick (für den Doppelklick) gehören dem Modus.
            if (context.kind === "press" || context.kind === "contextmenu") return undefined;
            // Strg über einer Kante: Klick setzt die vier Punkte, im Umkreis der geraden Strecke (nicht nur auf der gerundeten Linie).
            const geteilt = teilungAn(context.point, strgGedrueckt(context.event));
            if (geteilt !== undefined)
                return { cursor: "copy", ziel: "teilung", teil: { objekt: geteilt.objekt, nr: geteilt.nr } };
            const kante = context.features([GEOMETRIE_KANTE_TREFFER])[0];
            if (kante === undefined) return context.kind === "click" ? innenKlick(context) : undefined;
            return {
                cursor: art.einfuegen ? "copy" : "default",
                ziel: "kante",
                teil: { objekt: String(kante.properties["objekt"]), nr: Number(kante.properties["nr"]) },
            };
        },
        apply(kind, anspruch, context) {
            if (anspruch.ziel === "umschalt") {
                if (kind === "click") klick(anspruch, context);
                return;
            }
            if (kind === "press" && anspruch.ziel === "steuer" && anspruch.teil)
                greifeSteuer(context.event, anspruch.teil);
            else if (kind === "press" && anspruch.stelle) greife(context.event, anspruch.stelle);
            else if (kind === "click") klick(anspruch, context);
            else if (kind === "contextmenu" && anspruch.stelle) {
                // Auch ohne eigenes Menü kein Browsermenü am Anfasser.
                context.event.preventDefault();
                eingabe.kontext?.(anspruch.stelle, context.screen);
            }
        },
        // Eine stärkere Geste hat den Zeiger genommen: Der Punkt geht zurück.
        lost(reason) {
            if (reason === "preempted") abbrechen();
        },
    };

    zeichne();
    const anmeldung = meldeGeometrieAn(interaction, owner);
    globalThis.addEventListener("keydown", strgTaste);
    globalThis.addEventListener("keyup", strgTaste);
    globalThis.addEventListener("keydown", rundungTaste, { capture: true });
    globalThis.addEventListener("blur", ohneZeiger);
    map.on("mouseout", ohneZeiger);
    map.on("mousemove", bewege);
    map.on("touchmove", bewege);
    map.on("mouseup", drop);
    map.on("touchend", drop);
    map.on("touchcancel", abbrechen);

    return {
        aktualisiere() {
            teile = eingabe.teile();
            pruefeMarken();
            if (aktiv) zeichne();
        },
        markiere(neu) {
            marken = neu;
            if (aktiv) zeichne();
        },
        sperre(an) {
            gesperrt = an;
            if (an) zeigeTeilung(undefined);
        },
        // Esc: erst der laufende Zug, dann die Markierung, erst danach fragt der Aufrufer weiter.
        abbrechen() {
            if (abbrechen()) return true;
            if (markiert.length === 0) return false;
            leereMarken();
            return true;
        },
        traegt: (punkt) => flaechenKanteUnter(teile, punkt, schirm) !== undefined,
        aus() {
            if (!aktiv) return;
            ende();
            aktiv = false;
            anmeldung.ab();
            belegung.frei();
            globalThis.removeEventListener("keydown", strgTaste);
            globalThis.removeEventListener("keyup", strgTaste);
            globalThis.removeEventListener("keydown", rundungTaste, { capture: true });
            globalThis.removeEventListener("blur", ohneZeiger);
            map.off("mouseout", ohneZeiger);
            map.off("mousemove", bewege);
            map.off("touchmove", bewege);
            map.off("mouseup", drop);
            map.off("touchend", drop);
            map.off("touchcancel", abbrechen);
            if (zoomVorher) map.doubleClickZoom.enable();
            if (kastenVorher) map.boxZoom.enable();
            schicht.entferne();
        },
    };
}
