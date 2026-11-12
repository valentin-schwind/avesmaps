import type {
    HillshadeLayerSpecification,
    Map as MapLibreMap,
    RasterDEMSourceSpecification,
    StyleSpecification,
    TerrainSpecification,
} from "maplibre-gl";
import type { TerrainDemPointer } from "@avesmaps3d/shared";
import { terrainSourceTiles } from "./terrain-tiles";

/**
 * Das Gelände der geneigten Karte (WI-0049 S4): Legacys Gebirge in 3D, maßstabsgetreu.
 *
 * Festgelegt mit S1 (Betreiber 2026-09-27, Blatt 4):
 * - **D1:** In 2D gibt es weder Gelände noch Schattierung. Die flache Karte bleibt, wie sie war.
 * - **Wachsen:** Beim Kippen wachsen die Gebirge bis 30° von flach auf volle Höhe, die Schattierung
 *   blendet mit. So ploppen sie beim Umschalten nicht auf.
 * - **A1:** Überhöhung 1. Den Ausgleich der Breite tragen schon die Kacheln (WI-0049 S1).
 * - **Schattierung:** Licht aus Nordwest, Schatten 40 %, Glanz 20 %, kein Akzent.
 *
 * 🪤 Gelände und Schattierung lesen je eine EIGENE `raster-dem`-Quelle derselben Kacheln. Aus
 * derselben Quelle rechnet MapLibre die Schattierung schlechter und warnt.
 *
 * ADR-0016: Gelände und Hillshade lesen das vollständige Domain-DEM. Die Landschaftsansicht
 * verwendet weiterhin drei Lichtrichtungen; dabei wechselt nur die Darstellung, niemals die Höhe.
 */

export const TERRAIN_SOURCE_ID = "gelaende-dem";
export const HILLSHADE_SOURCE_ID = "gelaende-schatten-dem";
export const HILLSHADE_LAYER_ID = "gelaende-schatten";

/** Die Schattierung liegt direkt über der Grundkarte, unter allem, was auf der Karte steht. */
const HILLSHADE_AFTER = "basemap";
/**
 * Die Flächen der Ebenen mit eigener Quelle, über denen das Relief in den Landschaften liegt, wenn keine Landschaftsfläche
 * gezeichnet wird: das Klima (`CLIMATE_FILL_LAYER_ID`) und die Sprachen samt Schraffur (`SPRACHE_FILL_LAYER_ID`,
 * `SPRACHE_MISCH_LAYER_ID`, WI-0261 S5a). Als Text wie `HILLSHADE_AFTER`; `terrain.test.ts` hält sie gegen die Kennungen.
 */
export const OWN_AREA_FILL_IDS: readonly string[] = ["climate-fill", "sprachen-fill", "sprachen-misch-fill"];

export const GELAENDE = {
    /** Bis zu dieser Neigung wachsen die Gebirge aus der flachen Karte heraus; darüber voll. */
    wachsenBisGrad: 30,
    /** A1: maßstabsgetreu. */
    ueberhoehung: 1,
    schattierung: {
        verfahren: "standard",
        lichtGrad: 315,
        lichtHoeheGrad: 40,
        /** Bei voller Neigung; darunter blendet sie mit dem Wachsen ein. */
        staerke: 0.6,
        schatten: "rgba(45, 32, 18, 0.4)",
        glanz: "rgba(255, 250, 238, 0.2)",
    },
    /**
     * Das visuelle Relief in Landschaften (WI-0054): Blatt 1 R3, mehrere Lichter. Blatt 2 F2 mit 40 % / 22 %,
     * dann „ruhig noch 1/3 schwächer“ und „um 50% schwächer“ (Betreiber 2026-09-28): 13,5 % / 7,5 %. Danach
     * „auf manchen Monitoren schwach … doch etwas erhöhen“ (Betreiber 2026-09-28): 20 % / 11 %. Danach am
     * Relief-Regler auf mehreren Monitoren eingestellt: „die passen. das machen“: 50 % / 10 %.
     * Stärke über die Deckkraft: Die
     * `exaggeration` wirkt ab Zoom 5 kaum, dort steht die Schattierung in MapLibres Klemme.
     */
    relief: {
        verfahren: "multidirectional",
        lichtGrad: [270, 315, 0],
        lichtHoeheGrad: [40, 40, 40],
        staerke: 0.5,
        schatten: "rgba(45, 32, 18, 0.5)",
        glanz: "rgba(255, 250, 238, 0.1)",
    },
} as const;

/** Unter diesem Schlüssel trägt die Schattierungsebene ihre volle Stärke; `installTerrain` liest ihn. */
const STAERKE = "avesmaps:staerke";

/** Unter diesem Anteil gilt die Karte als flach: kein Gelände, keine Schattierung. */
const FLACH = 0.005;

/** Wie weit die Gebirge bei dieser Neigung gewachsen sind: 0 flach, 1 volle Höhe. */
export function terrainShare(pitch: number): number {
    const anteil = Math.min(1, Math.max(0, pitch / GELAENDE.wachsenBisGrad));
    return anteil <= FLACH ? 0 : anteil;
}

/**
 * Die Geländeangabe des Stils. Sie nennt immer die VOLLE Überhöhung, auch während die Gebirge
 * wachsen: `installTerrain` stellt das Wachsen direkt am Gelände, und ein `setStyle` mit `diff`
 * sieht so keine Änderung und baut das Gelände nicht neu auf.
 */
function terrainSpec(): TerrainSpecification {
    return { source: TERRAIN_SOURCE_ID, exaggeration: GELAENDE.ueberhoehung };
}

/**
 * Die Güte des Geländes. Sie ist am Telefon eine andere als am Rechner (Betreiber 2026-10-12: „kannst du die qualität für handy
 * separat behandeln und so weit runterschrauben bis es geht?“), denn dort entscheidet nicht, wie fein die Berge sind, sondern ob
 * die Seite überhaupt lebt: Mit Gelände starb sie nach ein bis fünf Sekunden, ohne flog sie dieselbe Route eine halbe Minute.
 */
export interface GelaendeGuete {
    /**
     * Die Feinheit der Zwischenbilder, mit denen das Gelände arbeitet (MapLibre `qualityFactor`). **Die eine Zahl, die am
     * Telefon über Leben und Tod entscheidet** — siehe `DRAPE_MB`.
     */
    drape: number;
    /** Schattierung liest die Geländequelle mit, statt dieselben Kacheln ein zweites Mal zu halten. */
    eineQuelle: boolean;
    /** So viele Zoomstufen gröber als das Höhenmodell hergibt; 1 ist ein Viertel der Höhenkacheln. */
    zoomAbzug: number;
    /** Ohne sie entfallen Ebene und zweite Quelle ganz; das Gelände bleibt. */
    schattierung: boolean;
}

/**
 * 🔴 **Warum `drape` die Leiter trägt und die Datenmenge nicht.** Mit Gelände zeichnet MapLibre die Karte nicht auf den Schirm,
 * sondern je Geländekachel und Ebenenstapel in eine eigene Textur und legt diese dann über die Maschen
 * (`RenderToTexture`). Die Kantenlänge dieser Textur ist `tileManager.tileSize * qualityFactor`, und `tileSize` ist
 * schon das Doppelte der Kachelgröße der Höhenquelle (MapLibre `deltaZoom = 1`). Mit unseren 512er-Höhenkacheln und
 * MapLibres Vorgabe 2 sind das **2048 × 2048 je Stapel**, RGBA und mit Mipmaps.
 *
 * Gemessen am 2026-10-12, Fenstermaße iPhone 15, dieselbe Route, Überblick bei Zoom 2,56 und 30° (ohne Flug): 4 Geländekacheln,
 * 2 Ebenenstapel, also 8 Zwischenbilder.
 *
 * | `drape` | Kantenlänge | Zwischenbilder gesamt |
 * | --- | --- | --- |
 * | 2 (MapLibres Vorgabe) | 2048 | **171 MB** |
 * | 1 | 1024 | **43 MB** |
 * | 0,5 | 512 | **11 MB** |
 *
 * Das erklärt, warum alles andere nichts brachte: `zoomAbzug` senkt nur `maxzoom` der Höhenquelle (gemessen 4 → 3) und ließ die
 * 171 MB unberührt, und `pixelRatio` geht in die Kantenlänge überhaupt nicht ein. Gegengerechnet: Bei Zoom 2,56 deckt eine
 * Geländekachel etwa 590 Bildpunkte des iPhone-Schirms — 2048 ist dafür das Dreieinhalbfache, 1024 noch immer mehr als genug.
 */
export const DRAPE_MB = { 2: 171, 1: 43, 0.5: 11 } as const;

/**
 * Die Leiter, Stufe für Stufe schwächer. 0 ist, was Rechner und Tablet bekommen und was bis heute für alle galt.
 *
 * 🪤 Welche Stufe ein Telefon trägt, lässt sich hier nicht messen — nur dort. Darum ist sie einstellbar
 * (`?handy=<0..3>`, nur im Entwicklungsbuild, `map/flug-probe.ts`), und die Vorgabe bleibt 0, bis der Betreiber eine wählt.
 */
export const GELAENDE_STUFEN: readonly GelaendeGuete[] = [
    { drape: 2, eineQuelle: false, zoomAbzug: 0, schattierung: true },
    { drape: 1, eineQuelle: true, zoomAbzug: 0, schattierung: true },
    { drape: 0.5, eineQuelle: true, zoomAbzug: 0, schattierung: true },
    { drape: 0.5, eineQuelle: true, zoomAbzug: 1, schattierung: false },
];

function demSource(pointer: TerrainDemPointer, tiles: string, zoomAbzug = 0): RasterDEMSourceSpecification {
    return {
        type: "raster-dem",
        tiles: [tiles],
        tileSize: pointer.tileSize,
        maxzoom: Math.max(0, pointer.maxNativeZoom - zoomAbzug),
        encoding: pointer.encoding,
    };
}

function hillshadeLayer(share: number, relief: boolean, quelle: string): HillshadeLayerSpecification {
    if (relief) {
        const look = GELAENDE.relief;
        return {
            id: HILLSHADE_LAYER_ID,
            type: "hillshade",
            source: quelle,
            metadata: { [STAERKE]: look.staerke },
            layout: { visibility: share > 0 ? "visible" : "none" },
            paint: {
                "hillshade-method": look.verfahren,
                "hillshade-illumination-direction": [...look.lichtGrad],
                "hillshade-illumination-altitude": [...look.lichtHoeheGrad],
                "hillshade-exaggeration": look.staerke * share,
                "hillshade-shadow-color": look.lichtGrad.map(() => look.schatten),
                "hillshade-highlight-color": look.lichtGrad.map(() => look.glanz),
            },
        };
    }
    const look = GELAENDE.schattierung;
    return {
        id: HILLSHADE_LAYER_ID,
        type: "hillshade",
        source: quelle,
        layout: { visibility: share > 0 ? "visible" : "none" },
        paint: {
            "hillshade-method": look.verfahren,
            "hillshade-illumination-direction": look.lichtGrad,
            "hillshade-illumination-altitude": look.lichtHoeheGrad,
            "hillshade-exaggeration": look.staerke * share,
            "hillshade-shadow-color": look.schatten,
            "hillshade-highlight-color": look.glanz,
            "hillshade-accent-color": "rgba(0, 0, 0, 0)",
        },
    };
}

/**
 * Hängt Gelände und Schattierung an den Stil, im Zustand der Neigung `share` (`terrainShare`).
 *
 * 🔴 Der Stil muss genau das nennen, was `installTerrain` gerade gestellt hat. Sonst setzte jedes
 * `setStyle` mit `diff` (ein Ort gewählt, eine Ebene umgeschaltet) das Gelände zurück.
 *
 * Ohne Zeiger bleibt der Stil unverändert: Die Karte ist flach wie vor WI-0049. Mit `relief` (nur aus
 * `reliefFor`) liest die Schattierung das visuelle Relief und liegt über der untersten
 * Landschaftsfläche, unter deren Kante; das Gelände bleibt dasselbe.
 */
export function withTerrain(
    style: StyleSpecification,
    pointer: TerrainDemPointer | undefined,
    share: number,
    landscapes = false,
    guete: GelaendeGuete = GELAENDE_STUFEN[0] as GelaendeGuete,
): StyleSpecification {
    if (!pointer) {
        return style;
    }
    const layers = [...style.layers];
    // Ohne Grundkarte (Zeiger nicht lesbar) liegt sie über dem Hintergrund, sonst deckte der sie zu.
    let after = Math.max(
        layers.findIndex((layer) => layer.id === HILLSHADE_AFTER),
        layers.findIndex((layer) => layer.type === "background"),
    );
    if (landscapes) {
        // Unter den Flächen verschwände das Relief in ihrer Deckkraft (WI-0054 V3); ohne Landschaftsfläche
        // (Klima allein, Seen aus) liegt es über den Klimabändern, die dort kräftig stehen. Die Sprachen ebenso (WI-0261 S5a):
        // über ihrer Füllung und ihrer Schraffur, unter ihrer Kontur.
        const landscapeFill = layers.findIndex((layer) => layer.id.startsWith("landscape-fill-"));
        const eigeneFlaeche = layers.reduce(
            (last, layer, index) => (OWN_AREA_FILL_IDS.includes(layer.id) ? index : last),
            -1,
        );
        after = Math.max(after, landscapeFill >= 0 ? landscapeFill : eigeneFlaeche);
    }
    const quelle = guete.eineQuelle ? TERRAIN_SOURCE_ID : HILLSHADE_SOURCE_ID;
    if (guete.schattierung) layers.splice(after + 1, 0, hillshadeLayer(share, landscapes, quelle));
    return {
        ...style,
        sources: {
            ...style.sources,
            // Mit Manifest löst ein eigenes Protokoll jede Kachel unter ihrer Revision auf (WI-0125, `terrain-tiles.ts`).
            [TERRAIN_SOURCE_ID]: demSource(pointer, terrainSourceTiles(pointer), guete.zoomAbzug),
            ...(guete.schattierung && !guete.eineQuelle
                ? { [HILLSHADE_SOURCE_ID]: demSource(pointer, terrainSourceTiles(pointer), guete.zoomAbzug) }
                : {}),
        },
        layers,
        ...(share > 0 ? { terrain: terrainSpec() } : {}),
    };
}

/** Was vom Gelände der Karte gebraucht wird: MapLibre stellt `exaggeration` öffentlich bereit. */
type TerrainHandle = { exaggeration: number } | null;

/** Die Teile von MapLibre, die die Feinheit der Zwischenbilder stellen. Alles außer `qualityFactor` ist innen; alles defensiv. */
interface DrapeTeile {
    terrain?: {
        qualityFactor: number;
        tileManager?: { tileSize?: number; _tiles?: Record<string, { releaseRTT?: (painter: unknown) => void }> };
    } | null;
    painter?: { renderToTexture?: { rttSize: number } | null; clearRTTPool?: () => void } | null;
}

/**
 * Stellt die Feinheit der Zwischenbilder (`GelaendeGuete.drape`, siehe `DRAPE_MB`).
 *
 * 🪤 `map.setTerrain` merkt sich die Kantenlänge EINMAL: `new RenderToTexture(painter, terrain)` liest `qualityFactor` in
 * seinem Konstruktor nach `rttSize`. Ein später gesetzter `qualityFactor` allein bliebe deshalb wirkungslos (am 2026-10-12
 * gemessen: die Zwischenbilder blieben 2048). Darum wird beides gestellt — und schon gelegte Zwischenbilder werden
 * zurückgegeben, damit die nächsten in der neuen Kantenlänge entstehen.
 */
function stelleDrape(map: MapLibreMap, drape: number): void {
    const teile = map as unknown as DrapeTeile;
    const terrain = teile.terrain;
    const painter = teile.painter;
    const rtt = painter?.renderToTexture;
    const tileSize = terrain?.tileManager?.tileSize;
    if (!terrain || !rtt || typeof tileSize !== "number") return;
    if (terrain.qualityFactor === drape) return;
    terrain.qualityFactor = drape;
    rtt.rttSize = tileSize * drape;
    for (const tile of Object.values(terrain.tileManager?._tiles ?? {})) tile.releaseRTT?.(painter);
    painter?.clearRTTPool?.();
    map.triggerRepaint();
}

/** Die Teile von MapLibre, die den Zustand der Überblendung tragen. Alles ist innen; alles defensiv. */
interface UeberblendTeile {
    style?: {
        tileManagers?: Record<string, { _inViewTiles?: { getAllTiles?: () => { resetFadeLogic?: () => void }[] } }>;
    };
}

/**
 * Beendet die Überblendung der Rasterkacheln, sobald das Gelände angeht.
 *
 * 💣 Flach blendet MapLibre eine abgelöste Kachel aus und hält sie mit Deckkraft 0 im Sichtbereich; `isRenderable` sagt dann
 * nein. Zurück nimmt das nur `updateFadingTiles`, und die läuft mit Gelände nicht (`tile_manager.ts`, geprüft bis 6.16). Wird
 * so eine Kachel im ersten Bild mit Gelände wieder gebraucht, hat sie Daten und wird doch nie gezeichnet: Ihre Fläche bleibt
 * ohne Rasterbild hell, während `areTilesLoaded()` `true` meldet (2026-11-06, nach Mausrad heraus und zügigem Strg + Ziehen).
 * Über Gelände blendet MapLibre nicht, der Zustand ist also an jeder Kachel hinfällig. Nicht mehr Gebrauchtes räumt das nächste Bild weg.
 */
function beendeUeberblendung(map: MapLibreMap): void {
    if (!map.getTerrain()) return;
    const quellen = (map as unknown as UeberblendTeile).style?.tileManagers ?? {};
    for (const quelle of Object.values(quellen)) {
        for (const kachel of quelle._inViewTiles?.getAllTiles?.() ?? []) kachel.resetFadeLogic?.();
    }
}

/**
 * Führt Gelände und Schattierung mit der Neigung (D1, Wachsen bis 30°).
 *
 * 🪤 Das Wachsen stellt die Überhöhung direkt am Gelände (`map.terrain.exaggeration`): `setTerrain`
 * baut das Gelände bei jedem Aufruf neu auf, und das in jedem Bild einer Kippbewegung.
 */
export function installTerrain(map: MapLibreMap, drape: () => number = () => 2): () => void {
    const apply = (): void => {
        if (!map.getSource(TERRAIN_SOURCE_ID)) {
            return;
        }
        const share = terrainShare(map.getPitch());
        if (share === 0) {
            if (map.getTerrain()) {
                map.setTerrain(null);
            }
        } else {
            if (!map.getTerrain()) {
                map.setTerrain(terrainSpec());
            }
            // Vor dem ersten gezeichneten Bild: `setTerrain` baut `RenderToTexture` neu, und der liest die Kantenlänge einmal.
            stelleDrape(map, drape());
            const terrain = (map as unknown as { terrain: TerrainHandle }).terrain;
            const soll = GELAENDE.ueberhoehung * share;
            if (terrain && terrain.exaggeration !== soll) {
                terrain.exaggeration = soll;
                map.triggerRepaint();
            }
        }
        const layer = map.getLayer(HILLSHADE_LAYER_ID);
        if (layer) {
            // Die volle Stärke steht an der Ebene: Gelände und Relief (WI-0054) schattieren verschieden stark.
            const metadata = (layer as { metadata?: unknown }).metadata as Record<string, unknown> | undefined;
            const staerke = metadata?.[STAERKE];
            const full = typeof staerke === "number" ? staerke : GELAENDE.schattierung.staerke;
            map.setLayoutProperty(HILLSHADE_LAYER_ID, "visibility", share > 0 ? "visible" : "none");
            map.setPaintProperty(HILLSHADE_LAYER_ID, "hillshade-exaggeration", full * share);
        }
    };
    map.on("pitch", apply);
    // Ein neuer Stil und ein neu gesetztes Gelände (volle Überhöhung aus dem Stil) holen das Wachsen nach.
    map.on("styledata", apply);
    map.on("terrain", apply);
    // Im selben Aufruf wie `setTerrain`, also vor dem ersten Bild mit Gelände.
    const beiGelaende = (): void => beendeUeberblendung(map);
    map.on("terrain", beiGelaende);
    return () => {
        map.off("pitch", apply);
        map.off("styledata", apply);
        map.off("terrain", apply);
        map.off("terrain", beiGelaende);
    };
}
