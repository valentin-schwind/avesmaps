import { MercatorCoordinate, type Map as MapLibreMap } from "maplibre-gl";

import type { Insets } from "./camera/visible-area";
import { installAreaLabels, type AreaLabels, type AreaLabelSpec } from "./area-labels";
import type { BandShape, Piece } from "./area-label-placement";
import { climateLabelSize, LANDSCAPE_SOURCE_ID, LANDSCAPE_SOURCE_LAYER } from "./landscape-layers";
import { kennungsFilter } from "./leuchten-formen";
import type { SuchLeuchtenTeil } from "./such-leuchten";
import { TERRITORY_SOURCE_ID, TERRITORY_SOURCE_LAYER } from "./territory-layers";
import {
    hatFlaeche,
    NAMEN_ABSTAND,
    NAMEN_HOEHE_EM,
    namensFarben,
    VORKOMMEN_NAMEN_EBENE,
    VORKOMMEN_NAMEN_QUELLE,
    VORKOMMEN_QUELLE,
} from "./vorkommen-leuchten";
import { nameMitZeichenBreite } from "./vorkommen-zeichen-bild";

/**
 * Die Namen der gewählten Vorkommen auf der Karte (WI-0257 S5, Vali 2026-10-30: „… UND auf der karten beschriftet werden mit den dynamsichen labels, die
 * immer da hin fliegen wo die kamera sie am besten lesen kann (wie bei sprachen oder klimazonen)“). Dieselbe Mechanik wie Klimazonen und Sprachen
 * (`area-labels.ts`): Der Name steht mittig im sichtbaren Teil seiner leuchtenden Flächen und wandert mit der Kamera; die Namen bewegen die Kamera nie.
 *
 * - **Woher die Flächen kommen:** aus den Kacheln, die das Leuchten ohnehin lädt (`flaechen`): ganze Gegenden und der Kontinent aus den Landschaftskacheln,
 *   ganze Gebiete aus den Gebietskacheln, angeschnittene Stücke und Reste aus der GeoJSON-Quelle des Leuchtens (`v` nennt ihr Vorkommen). Eine Gegend, die
 *   zwei Vorkommen tragen, zählt für beide.
 * - **Ausweichen wie die Sprachen:** Die Flächen mehrerer Vorkommen überlappen sich; ein Name, der auf einen gesetzten träfe, rückt im eigenen sichtbaren
 *   Teil an die nächste freie Stelle, statt wegzufallen (`ausweichen`, Regeln 6 und 7 in `area-label-placement.ts`). Der größte sichtbare Teil setzt zuerst.
 * - **Über dem Meer:** Das Leuchten liegt über allem, auch über dem Meer; ein Meerestier trägt seinen Namen dort, wo es leuchtet (`ueberDemMeer`).
 * - **Schrift** wie die Klima- und Sprachnamen (Größe, Versalien, Saum aus `mapLabel.families.climate`), Farbe nach deren Regel aus der Farbe des Vorkommens,
 *   vorn das Kategoriezeichen (`vorkommen-zeichen-bild.ts`).
 *
 * 🔴 **Höchstens ZWEI Namen je Vorkommen** (Auftrag: einer je Vorkommen und sichtbarem Teil, bei weit verstreuten Gegenden darf es je Teil einer sein, „aber
 * ohne Zuschütten der Karte“). Gemessen am 2026-10-30 an der Reise Burg Eichstein–Nardesfels, je fünf gewählte Waren, Tiere und Pflanzen bei Zoom 3,5 bis 6,5
 * in 1920 × 1080: Die sichtbaren Teile (Flächen, die sich bis auf 48 Bildpunkte nähern, gelten als ein Teil) sind fast immer EINER, oft bildfüllend. Wo es
 * mehr sind, ist es in 14 von 15 Vorkommen ein großer Teil mit Inselchen von höchstens 7 % seiner Fläche (Pflanzen bis zu acht Teile); ein Name je Inselchen
 * schüttete die Karte zu, und die Farbe bindet sie ohnehin an den Teil mit Namen. Nur der Affe (Finsterkamm im Nordwesten, Koschberge im Süden) hatte bei
 * jedem Zoom zwei große, weit getrennte Teile (der zweite 29 bis 93 % des ersten). Die Regel deshalb: ein Name je Vorkommen; ein zweiter nur für einen
 * sichtbaren Teil, der mindestens `ZWEITER_NAME_LUECKE` Bildpunkte vom übrigen entfernt liegt und mindestens `ZWEITER_NAME_ANTEIL` so groß ist wie der
 * größte (Rahmen im freien Bild); ein dritter nie. Die Teile werden beim Lesen der Kacheln bestimmt (nach jeder Bewegung), die Stellen der Namen in jedem Bild.
 */

/** So weit muss ein zweiter Teil vom übrigen Vorkommen entfernt liegen (Bildpunkte), damit er einen eigenen Namen bekommt: deutlich mehr als eine Namenshöhe. */
export const ZWEITER_NAME_LUECKE = 120;

/** So groß muss der zweite sichtbare Teil mindestens sein, gemessen am größten (Fläche seines Rahmens im freien Bild). */
export const ZWEITER_NAME_ANTEIL = 0.25;

/** Ein Rahmen am Boden (Mercator): links, oben, rechts, unten. */
export type Rahmen = readonly [number, number, number, number];

const sichtbar = (r: Rahmen, ansicht: Rahmen): number =>
    Math.max(0, Math.min(r[2], ansicht[2]) - Math.max(r[0], ansicht[0])) *
    Math.max(0, Math.min(r[3], ansicht[3]) - Math.max(r[1], ansicht[1]));

/**
 * Teilt das Band eines Vorkommens, wo ein zweiter Teil einen eigenen Namen bekommt (Regel oben): Teile, die sich bis auf `luecke` nähern, sind eine Gruppe;
 * die zweitgrößte sichtbare bekommt den Schlüssel `<id>#2`, wenn sie mindestens `ZWEITER_NAME_ANTEIL` so groß ist wie die größte. Sonst bleibt das Band.
 */
export function teileNachLage(band: BandShape, ansicht: Rahmen, luecke: number): BandShape[] {
    const stuecke = band.pieces;
    if (stuecke.length < 2) return [band];
    const gruppe = stuecke.map((_, i) => i);
    const wurzel = (start: number): number => {
        let i = start;
        while (gruppe[i] !== i) {
            gruppe[i] = gruppe[gruppe[i]!]!;
            i = gruppe[i]!;
        }
        return i;
    };
    // Nach dem linken Rand sortiert: Ein Teil, das weiter rechts beginnt als der rechte Rand samt Lücke, beendet die Suche nach Nachbarn.
    const folge = stuecke.map((_, i) => i).sort((a, b) => stuecke[a]!.bbox[0] - stuecke[b]!.bbox[0]);
    for (let k = 0; k < folge.length; k++) {
        const a = stuecke[folge[k]!]!.bbox;
        for (let m = k + 1; m < folge.length; m++) {
            const b = stuecke[folge[m]!]!.bbox;
            if (b[0] - luecke > a[2]) break;
            if (b[1] - luecke <= a[3] && a[1] - luecke <= b[3]) gruppe[wurzel(folge[k]!)] = wurzel(folge[m]!);
        }
    }
    const gruppen = new Map<number, { rahmen: [number, number, number, number]; stuecke: Piece[] }>();
    stuecke.forEach((stueck, i) => {
        const g = gruppen.get(wurzel(i));
        const r = stueck.bbox;
        if (g === undefined) gruppen.set(wurzel(i), { rahmen: [r[0], r[1], r[2], r[3]], stuecke: [stueck] });
        else {
            g.rahmen = [
                Math.min(g.rahmen[0], r[0]),
                Math.min(g.rahmen[1], r[1]),
                Math.max(g.rahmen[2], r[2]),
                Math.max(g.rahmen[3], r[3]),
            ];
            g.stuecke.push(stueck);
        }
    });
    if (gruppen.size < 2) return [band];
    const nachGroesse = [...gruppen.values()]
        .map((g) => ({ ...g, flaeche: sichtbar(g.rahmen, ansicht) }))
        .sort((a, b) => b.flaeche - a.flaeche);
    const [erste, zweite] = nachGroesse;
    if (!erste || !zweite || erste.flaeche <= 0 || zweite.flaeche < ZWEITER_NAME_ANTEIL * erste.flaeche) return [band];
    const ohneZweite = nachGroesse.filter((g) => g !== zweite).flatMap((g) => g.stuecke);
    return [
        { ...band, pieces: ohneZweite },
        { ...band, key: `${band.key}#2`, pieces: zweite.stuecke },
    ];
}

export interface VorkommenNamenOptionen {
    /** Was die Leiste der Panels von der Karte deckt (`visibleArea.keepFree`). */
    insets: () => Partial<Insets>;
    /** Die gewählten Vorkommen, wie das Leuchten sie gerade zeigt (`SuchLeuchtenBild.teile`); leer ohne Auswahl. */
    teile: () => readonly SuchLeuchtenTeil[];
}

type Stuecke = (geometry: { type: string; coordinates: unknown }) => Piece[];

/**
 * Die Flächen je Vorkommen aus den geladenen Kacheln; ein Vorkommen ohne Fläche (nur Orte) trägt hier keinen Namen. Mit `ansicht` (das freie Bild am Boden
 * und die Lücke zwischen Teilen in Bodeneinheiten) bekommt ein weit getrennter zweiter Teil ein eigenes Band (`teileNachLage`).
 */
export function lieseVorkommenFlaechen(
    map: Pick<MapLibreMap, "querySourceFeatures" | "getSource">,
    teile: readonly SuchLeuchtenTeil[],
    stuecke: Stuecke,
    ansicht?: { rahmen: Rahmen; luecke: number },
): BandShape[] {
    const schrift = climateLabelSize();
    const baender = new Map<string, BandShape & { pieces: Piece[] }>();
    for (const teil of teile) {
        if (!hatFlaeche(teil) || baender.has(teil.id)) continue;
        baender.set(teil.id, { key: teil.id, name: teil.name, pieces: [], properties: namensFarben(teil, schrift) });
    }
    if (baender.size === 0) return [];
    const zuordnen = (
        kennungen: Map<string, string[]>,
        sourceId: string,
        sourceLayer: string,
        eigenschaft: string,
    ): void => {
        if (kennungen.size === 0 || map.getSource(sourceId) === undefined) return;
        for (const merkmal of map.querySourceFeatures(sourceId, {
            sourceLayer,
            filter: kennungsFilter(eigenschaft, [...kennungen.keys()]),
        })) {
            const id = merkmal.properties[eigenschaft];
            const vorkommen = typeof id === "string" ? kennungen.get(id) : undefined;
            if (vorkommen === undefined) continue;
            const formen = stuecke(merkmal.geometry);
            for (const v of vorkommen) baender.get(v)?.pieces.push(...formen);
        }
    };
    const gegenden = new Map<string, string[]>();
    const gebiete = new Map<string, string[]>();
    const trage = (karte: Map<string, string[]>, id: string, v: string): void => {
        const liste = karte.get(id) ?? [];
        if (!liste.includes(v)) liste.push(v);
        karte.set(id, liste);
    };
    for (const teil of teile) {
        if (!baender.has(teil.id)) continue;
        const l = teil.leuchten;
        for (const id of l.ganz) trage(gegenden, id, teil.id);
        if (l.nurKontinent && l.kontinent !== undefined) trage(gegenden, l.kontinent.publicId, teil.id);
        for (const id of l.gebiete.ganz) trage(gebiete, id, teil.id);
    }
    zuordnen(gegenden, LANDSCAPE_SOURCE_ID, LANDSCAPE_SOURCE_LAYER, "region_public_id");
    zuordnen(gebiete, TERRITORY_SOURCE_ID, TERRITORY_SOURCE_LAYER, "territory_public_id");
    if (map.getSource(VORKOMMEN_QUELLE) !== undefined) {
        for (const merkmal of map.querySourceFeatures(VORKOMMEN_QUELLE, {
            filter: ["in", ["get", "t"], ["literal", ["flaeche", "gebiet"]]],
        })) {
            const v = merkmal.properties["v"];
            if (typeof v === "string") baender.get(v)?.pieces.push(...stuecke(merkmal.geometry));
        }
    }
    const mitFlaeche = [...baender.values()].filter((band) => band.pieces.length > 0);
    return ansicht === undefined
        ? mitFlaeche
        : mitFlaeche.flatMap((band) => teileNachLage(band, ansicht.rahmen, ansicht.luecke));
}

/** Das freie Bild (ohne die Panels) am Boden als Rahmen und die Lücke zwischen zwei Teilen in Bodeneinheiten. */
function ansichtVon(map: MapLibreMap, insets: Partial<Insets>): { rahmen: Rahmen; luecke: number } {
    const canvas = map.getCanvas();
    const { top = 0, right = 0, bottom = 0, left = 0 } = insets;
    const ecken: [number, number][] = [
        [left, top],
        [canvas.clientWidth - right, top],
        [left, canvas.clientHeight - bottom],
        [canvas.clientWidth - right, canvas.clientHeight - bottom],
    ];
    const boden = ecken.map((ecke) => MercatorCoordinate.fromLngLat(map.unproject(ecke)));
    const xs = boden.map((e) => e.x);
    const ys = boden.map((e) => e.y);
    return {
        rahmen: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        // Ein Bildpunkt am Boden: Die Welt misst `512 · 2^zoom` Bildpunkte.
        luecke: ZWEITER_NAME_LUECKE / (512 * 2 ** map.getZoom()),
    };
}

/** Die Beschreibung der Ebene für `installAreaLabels`. */
export function vorkommenNamenSpec(
    teile: () => readonly SuchLeuchtenTeil[],
    insets: () => Partial<Insets> = () => ({}),
): AreaLabelSpec {
    return {
        sourceId: LANDSCAPE_SOURCE_ID,
        sourceLayer: LANDSCAPE_SOURCE_LAYER,
        // Die Namensebene steht nur im Stil, solange Vorkommen gewählt sind (`withVorkommenLeuchten`): Sie ist zugleich der Schalter der Rechnung.
        fillLayerId: VORKOMMEN_NAMEN_EBENE,
        labelSourceId: VORKOMMEN_NAMEN_QUELLE,
        labelLayerId: VORKOMMEN_NAMEN_EBENE,
        bandOf: () => undefined,
        ausweichen: true,
        flaechen: {
            quellen: [LANDSCAPE_SOURCE_ID, TERRITORY_SOURCE_ID, VORKOMMEN_QUELLE],
            lies: (map, stuecke) => lieseVorkommenFlaechen(map, teile(), stuecke, ansichtVon(map, insets())),
            // Breite und Höhe wie MapLibres Kollisionsrahmen (`NAMEN_ABSTAND`, `NAMEN_HOEHE_EM`): Damit gerechnet, verdeckt kein gesetzter Name den nächsten.
            breite: (name, size) => nameMitZeichenBreite(name, size) + 2 * NAMEN_ABSTAND,
            raum: (size) => Math.ceil(size * NAMEN_HOEHE_EM) + 1,
            ueberDemMeer: true,
        },
    };
}

export function installVorkommenNamen(map: MapLibreMap, options: VorkommenNamenOptionen): AreaLabels {
    return installAreaLabels(map, vorkommenNamenSpec(options.teile, options.insets), { insets: options.insets });
}
