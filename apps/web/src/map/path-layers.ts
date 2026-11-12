import {
    AVENTURIA_PATH_CARTOGRAPHY,
    collisionSortKey,
    labelFamily,
    MAX_BAND,
    pathTypesInDrawOrder,
    reiheMitSpanne,
    renderZoomForBand,
    spannenBedingung,
    spannenFilter,
    type PathStyle,
    VECTOR_TILE_MAX_ZOOM,
    ZOOMBAND_WEGARTEN,
    type Zoomspanne,
} from "@avesmaps3d/shared";
import type { DataDrivenPropertyValueSpecification, LayerSpecification, SourceSpecification } from "maplibre-gl";
import { ROUTE_HIT_WIDTH } from "./route-layers";
import { zoomspanne } from "./zoombaender-stand";

/**
 * Die Wege auf der Karte (WI-0010 Stufe 1).
 *
 * ⭐ Jeder Weg wird ZWEIMAL gezeichnet: eine breitere Kontur und darauf der schmalere Kern. Das ist
 * keine Verzierung, sondern was eine Linie auf einer bunten Karte überhaupt lesbar macht — der
 * helle Saum trennt sie vom Untergrund. Legacy macht es genauso.
 *
 * 🪤 Das Wasser liegt UNTEN. Eine Straße, die einen Fluss quert, gehört über ihn, sonst sieht es
 * aus, als ende sie im Wasser. Bei uns ist das die Layerreihenfolge und damit von selbst stabil;
 * Legacy muss sie nach jedem Ein- und Ausblenden neu herstellen (`bringToFront`).
 *
 * 🔴 Farbe und Breite kommen AUSSCHLIESSLICH aus der Tafel (`config/map-cartography/`). Kein
 * Farbliteral in dieser Datei — das war der Punkt von WI-0008, und ein Kostenfaktor gehört
 * ohnehin nicht hierher, sondern ins Travel-Modell (Stufe 3).
 */

export const PATH_SOURCE_ID = "paths";
export const PATH_SOURCE_LAYER = "path_render";
export const PATH_LABEL_SOURCE_ID = "path-labels";
export const PATH_LABEL_SOURCE_LAYER = "path_label_run";

/** Ein Abschnitt oder Schriftlauf mit dem Kennzeichen „Karawanenroute“ (Kacheleigenschaft `mark`, Migration 0174). */
const IST_KARAWANENROUTE = ["==", ["get", "mark"], "karawanenroute"];

/**
 * Die Trefferbreite eines Wegs ist DIE DER ROUTE (WI-0090 § 3.6: „Nimm die Lösung der Route, statt eine zweite zu
 * rechnen“), nicht eine zweite Zahl.
 *
 * ⭐ Wie sie arbeitet: MapLibre prüft einen Treffer gegen die BREITE einer Linie, nicht gegen ihre Deckkraft. Die Route
 * legt deshalb über ihre 3 px eine unsichtbare Linie (`line-opacity: 0`) von 14 px am Zeiger und 28 px am Finger
 * (`ROUTE_HIT_WIDTH`, Betreiber 2026-09-24: „der Touchbereich … könnte mit dem Finger etwas breiter sein“); Legacy tut
 * bei den Kraftlinien dasselbe mit 22 px. Ein Weg ist mit 1,5 bis 4 px genauso dünn, und derselbe Zeiger soll dieselbe
 * Toleranz haben (A10) - also dieselbe Zahl, nicht eine ähnliche.
 *
 * 🪤 Hier stand vorher keine Trefferfläche, sondern eine ZWEITE Abfrage mit Spiel um den Zeiger (`context.query(…, 5)`,
 * nur für Flüsse). Die ist mit WI-0090 weg: Sie kostete je Ereignis eine eigene `queryRenderedFeatures`, galt nur für
 * zwei Layer und hatte mit 5 px ihre eigene Toleranz.
 *
 * 🔴 Es gibt deshalb KEINEN zweiten Namen für diese Zahl: Wer die Trefferbreite eines Wegs sucht, liest
 * `ROUTE_HIT_WIDTH`. Ein `PATH_HIT_WIDTH` daneben wäre eine Zahl, die irgendwann von der der Route wegläuft.
 */

/** Der Namenszusatz einer Wegebene: beim Fluss zwei (Bach und Fluss), sonst der Subtyp in Kleinschrift. */
function layerSuffixes(subtype: string): readonly string[] {
    return subtype === "Flussweg" ? [`${subtype.toLowerCase()}-bach`, subtype.toLowerCase()] : [subtype.toLowerCase()];
}

/**
 * Alle Kennungen der unsichtbaren Trefferebenen, in Zeichenreihenfolge von unten nach oben (WI-0090).
 *
 * 🔴 Die Liste ist VOLLSTÄNDIG, nicht die der aktuellen Ansicht: Der Koordinator fragt nur Layer, die auch im Stil
 * stehen (`buildContext`), und genau das ist die Teilnahmeregel - was nicht gezeichnet wird, hat keine Trefferebene
 * (`interaction/priorities.ts`). Eine Art, die die Karte niemals zeigt (Seeweg, `hidden`), steht gar nicht darin.
 *
 * 🪤 Die Liste ist eine MENGE, keine Rangfolge: Welcher Treffer zuerst kommt, entscheidet `queryRenderedFeatures` nach
 * der Stapelung im Stil - oberster zuerst, und oben liegt nach der Kartografie-Tafel die Reichsstraße. An einer Kreuzung
 * gewinnt damit die Straße, die man oben SIEHT, und diese Ordnung kommt aus der Tafel, nicht aus einer Regel hier.
 */
export const PATH_HIT_LAYER_IDS: readonly string[] = pathTypesInDrawOrder()
    .filter(({ style }) => style.hidden !== true)
    .flatMap(({ subtype }) => layerSuffixes(subtype).map((suffix) => `path-hit-${suffix}`));

/**
 * `promoteId`: Jeder Abschnitt trägt seine Kennung (`public_id`, eindeutig und stabil) auch als Feature-Id, die Treffer unter dem
 * Zeiger lesen sie (`path-selection-input.ts`). Die Vorschau beim Zeigen setzt seit WI-0266 keinen Feature-State mehr, sondern
 * steht in einer eigenen Quelle (`vorschau-umriss.ts`).
 */
export function buildPathSource(tileUrl: string): SourceSpecification {
    return {
        type: "vector",
        tiles: [tileUrl],
        minzoom: 0,
        maxzoom: VECTOR_TILE_MAX_ZOOM,
        promoteId: { [PATH_SOURCE_LAYER]: "public_id" },
    };
}

/**
 * Darunter passt kein Wegname auf die Karte (WI-0283 H4, `min(run_min_zoom)` der Daten): Die Karte fragt die leeren Kacheln gar nicht erst an.
 * 🪤 Bekäme ein Name einmal einen Lauf auf Stufe 2, fehlte er nur dort; `path_label_run_render` sagt, ob die Zahl noch stimmt.
 */
export const PATH_LABEL_MIN_ZOOM = 3;

export function buildPathLabelSource(tileUrl: string): SourceSpecification {
    return { type: "vector", tiles: [tileUrl], minzoom: PATH_LABEL_MIN_ZOOM, maxzoom: VECTOR_TILE_MAX_ZOOM };
}

/**
 * Die Zoomstufe, auf der ein Legacy-Bandwert bei uns wirksam wird.
 *
 * 🪤 Legacys Tafel zählt z0..z6, unsere Karte zählt eine Stufe höher (RENDER_ZOOM_OFFSET, in
 * WI-0015 an beiden laufenden Karten gemessen). Ohne diese Umrechnung säße jede Breite eine Stufe
 * daneben — und zwar so, dass es auf den ersten Blick plausibel aussieht.
 */
function renderZoom(legacyZoom: number): number {
    return renderZoomForBand(legacyZoom);
}

/**
 * Die Breite einer Wegart über den Zoom.
 *
 * ⭐ Legacys Tafel, Ziffer für Ziffer: `PATH_WIDTH_SCALE[subtyp][zoom]`, multipliziert mit der
 * Grundbreite. Eine Art, die in der Tafel FEHLT, bekommt den Faktor 1 — genau wie Legacys
 * `getPathWidthScale` für einen unbekannten Schlüssel. Daran hängt, dass Flüsse und Seewege nie
 * dünner werden.
 *
 * 🪛 Legacy rundet die Zoomstufe und springt damit an jeder halben Stufe; wir blenden linear über.
 * Auf den ganzen Stufen sind beide identisch — dieselbe Entscheidung wie bei den Marker- und
 * Schriftgrößen (Betreiber, 2026-09-20).
 */
function widthExpression(base: number, faktoren: readonly number[] | undefined): unknown {
    if (!faktoren) {
        return base;
    }
    const stops: unknown[] = [];
    for (const [legacyZoom, faktor] of faktoren.entries()) {
        stops.push(renderZoom(legacyZoom), base * faktor);
    }
    return ["interpolate", ["linear"], ["zoom"], ...stops];
}

/**
 * Die Breite einer WASSERlinie: im Überblick dünn und ohne Kontur, im nahen Bild wie gewohnt.
 *
 * ⭐ Betreiberentscheidung 2026-09-23 (`water` in der Wegtafel). Die Kontur wird nicht ab einer
 * Stufe HART zugeschaltet, sondern blendet über die Stufe davor von 0 auf ihre Breite ein — eine
 * Linie, die beim Zoomen plötzlich einen weißen Rand bekommt, springt ins Auge.
 *
 * 🪤 Die Stops liegen auf den ganzen Legacy-Stufen, wie bei `widthExpression`; eine fehlende
 * Faktorzeile heißt Faktor 1 (Fluss, Seeweg), der Bach bringt seine eigene mit.
 */
function waterWidthExpression(
    base: number,
    faktoren: readonly number[] | undefined,
    art: "outline" | "center",
): unknown {
    const wasser = AVENTURIA_PATH_CARTOGRAPHY.water;
    // Die Kontur folgt dem Zoomband „Kontur“ der Flüsse (WI-0221; Vorgabe `outlineFromBand`). Der Kern ist ab ihrem Beginn voll breit.
    const kontur = zoomspanne("wege.Flussweg.kontur");
    const stops: unknown[] = [];
    for (let legacyZoom = 0; legacyZoom <= MAX_BAND; legacyZoom += 1) {
        const voll = base * (faktoren?.[Math.min(legacyZoom, faktoren.length - 1)] ?? 1);
        const nah = legacyZoom >= kontur.von;
        const mitKontur = nah && legacyZoom <= kontur.bis;
        const breite = art === "outline" ? (mitKontur ? voll : 0) : nah ? voll : Math.min(voll, wasser.thinCenterWidth);
        stops.push(renderZoom(legacyZoom), breite);
    }
    return ["interpolate", ["linear"], ["zoom"], ...stops];
}

/**
 * Ab welcher unserer Zoomstufen die Art überhaupt gezeichnet wird.
 *
 * 💣 EINE 0 IN DER TAFEL HEISST „NICHT AUF DER KARTE", nicht „Breite 0". Legacy nimmt einen Weg
 * mit Faktor 0 über `pathShouldBeOnMap` heraus, und genau so verschwinden die Straßen beim
 * Rauszoomen — es braucht keinen zweiten Sichtbarkeitsriegel. Bei uns ist das `minzoom` des
 * Layers: derselbe Effekt, und der Renderer verarbeitet die unsichtbaren Linien gar nicht erst.
 *
 * 🪤 Gesucht ist die erste Stufe mit einem Faktor über 0 — nicht die erste Stufe überhaupt. Wer
 * hier `0` zurückgibt, zeichnet auf jeder Stufe eine Linie der Breite 0: unsichtbar, aber in
 * jeder Kachel.
 */
function firstVisibleZoom(faktoren: readonly number[] | undefined): number | undefined {
    if (!faktoren) {
        return undefined;
    }
    const index = faktoren.findIndex((faktor) => faktor > 0);
    return index <= 0 ? undefined : renderZoom(index);
}

/**
 * Die Faktorzeile einer Art, mit dem Bach als eigener Zeile (er ist keine Wegart, siehe Tafel), auf die Spanne ihres Zoombands
 * gebracht (WI-0221): vor `von` eine 0 (nicht auf der Karte), ab `von` mindestens der erste Faktor der Tafel. Die Obergrenze zieht
 * `maxzoom` der Ebene, nicht eine 0 in der Zeile: Eine Interpolation dorthin ließe die Linie über eine ganze Stufe ausdünnen.
 */
function scaleFor(key: string): readonly number[] | undefined {
    const zeile = AVENTURIA_PATH_CARTOGRAPHY.widthScale[key];
    if (!zeile || !(ZOOMBAND_WEGARTEN as readonly string[]).includes(key)) return zeile;
    return reiheMitSpanne(zeile, linienSpanne(key), 0);
}

/** Die Spanne der Linie einer Ebene: je Wegart, beim Bach seine Zeile, beim Fluss die des Flusswegs. */
function linienSpanne(scaleKey: string): Zoomspanne {
    return zoomspanne(`wege.${scaleKey}.linie`);
}

/** `minzoom` und `maxzoom` einer Ebene aus der Faktorzeile und der Spanne (Band n gilt ab Zoom n + 1, bis vor n + 2). */
function zoomGrenzen(
    scaleKey: string,
    faktoren: readonly number[] | undefined,
): { minzoom?: number; maxzoom?: number } {
    const spanne = linienSpanne(scaleKey);
    const ab = faktoren ? firstVisibleZoom(faktoren) : spanne.von > 0 ? renderZoom(spanne.von) : undefined;
    return {
        ...(ab === undefined ? {} : { minzoom: ab }),
        ...(spanne.bis < MAX_BAND ? { maxzoom: renderZoom(spanne.bis + 1) } : {}),
    };
}

interface LinienEbene {
    /** Der Namenszusatz der Ebene — bei einem Bach mit Suffix, sonst der Subtyp. */
    id: string;
    subtype: string;
    /**
     * Der Stil dieser Art, MITGEFÜHRT statt später nachgeschlagen.
     *
     * 🪤 Ein zweiter Zugriff über `types[subtype]` liefert einen optionalen Wert und verlangt
     * einen Ersatz — und der wäre ein Farbliteral in einer Datei, in der keines stehen darf
     * (WI-0008). Der Wächter `design-canon.test.ts` hat genau das gemeldet.
     */
    style: PathStyle;
    /** Welcher Schlüssel der Breitentafel gilt — bei einem Bach seine eigene Zeile. */
    scaleKey: string;
    /** Nur Bäche, nur Nicht-Bäche, oder (ohne Wert) alle. */
    bach: boolean | undefined;
}

/**
 * Ein Linienpaar je Wegart, in Zeichenreihenfolge von unten nach oben.
 *
 * 💣 ALLE Konturen zuerst, dann alle Kerne — nicht Kontur/Kern paarweise. Sonst überdeckte die
 * Kontur der darüberliegenden Art den Kern der darunterliegenden, und jede Kreuzung bekäme einen
 * hellen Fleck. Legacy hat dasselbe Problem und löst es über zwei Leaflet-Panes.
 *
 * 💣 DER BACH BEKOMMT EIGENE EBENEN, und das ist kein Stilfrage, sondern eine Renderregel:
 * MapLibre erlaubt `["zoom"]` nur im ÄUSSERSTEN Ausdruck. Ein `["case", is_bach, <interpolate
 * über zoom>, …]` wird still abgelehnt, und die Breite bliebe auf ihrem Vorgabewert stehen. Der
 * Bach hat eine eigene Zoomkurve (unter Stufe 4 gar nicht gezeichnet, OPS-000036), also braucht er eine eigene
 * Ebene mit eigenem Filter.
 *
 * ⭐ DER TUNNEL IST GESTRICHELT (WI-0177, Migration 0172, Kacheleigenschaft `is_tunnel`): Kontur und Kern jeder Art bekommen
 * je eine zweite Ebene (`…-tunnel`) mit demselben Stil und `line-dasharray` aus der Tafel. 💣 `line-dasharray` ist nicht
 * datengetrieben; ein `["case", is_tunnel, …]` geht nicht, also eine eigene Ebene mit eigenem Filter, wie beim Bach. Die
 * Kontur setzt im selben Takt aus wie der Kern: Ihr Muster ist das des Kerns, umgerechnet auf ihre Breite (MapLibre misst
 * Strich und Lücke in Linienbreiten), und beide enden stumpf (`butt`), sonst ragten die runden Kappen in die Lücke. Die
 * Tunnelebenen liegen in ihrer Gruppe UNTEN (alle Tunnelkonturen vor allen Konturen, alle Tunnelkerne vor allen Kernen): Ein
 * Weg über der Erde kreuzt über einem Tunnel. Ein Abschnitt ohne die Eigenschaft (alte Kachel) ist kein Tunnel. Die
 * Trefferebene bleibt eine je Art.
 *
 * ⭐ DIE KARAWANENROUTE IST EINE PUNKTREIHE ÜBER IHREM WEGTYP (WI-0177 §30, Migration 0174, Kacheleigenschaft `mark`): Kontur und
 * Kern bleiben die des Wegtyps darunter, der die Reisewerte trägt; darüber liegt je Landweg eine Ebene `path-karawanenroute-…` mit
 * runden Punkten (Strich 0, `line-cap: round`) in Farbe, Durchmesser und Abstand aus der Tafel (`karawanenroute`), mit der Breitenzeile
 * ihres Wegtyps skaliert. Eine eigene Ebene je Art aus demselben Grund wie beim Tunnel: Strichmuster sind nicht datengetrieben, und die
 * Breite folgt der Zoomkurve der Art. Die Punkte liegen über allen Kernen und unter den Trefferebenen.
 */
export function buildPathLayers(options: PathSelection): LayerSpecification[] {
    const ebenen: LinienEbene[] = [];
    for (const { subtype, style } of pathTypesInDrawOrder()) {
        // Eine Wegart, die die Karte nicht zeigt (Seewege), kommt gar nicht erst in den Stil -
        // ausgeblendet hieße: ihre Kacheln würden trotzdem geladen.
        if (style.hidden === true) {
            continue;
        }
        // Was das Anzeige-Menü ausschaltet, fehlt ebenso ganz im Stil (WI-0028).
        if (!switchedOn(subtype, options)) {
            continue;
        }
        if (subtype === "Flussweg") {
            // Der Bach zuerst: er liegt unter dem Fluss, weil er schmaler ist.
            ebenen.push({ id: `${subtype.toLowerCase()}-bach`, subtype, style, scaleKey: "bach", bach: true });
            ebenen.push({ id: subtype.toLowerCase(), subtype, style, scaleKey: subtype, bach: false });
            continue;
        }
        ebenen.push({ id: subtype.toLowerCase(), subtype, style, scaleKey: subtype, bach: undefined });
    }
    // 🪤 Die Reihenfolge der Kennungen muss der statischen Liste entsprechen, die der Besitzer `path` abfragt.
    // Weicht sie ab, fehlt eine Trefferebene in der Abfrage, und ein gezeichneter Weg wäre still nicht anklickbar.

    const filterFor = (ebene: LinienEbene): unknown =>
        ebene.bach === undefined
            ? ["==", ["get", "subtype"], ebene.subtype]
            : ["all", ["==", ["get", "subtype"], ebene.subtype], ["==", ["get", "is_bach"], ebene.bach]];
    const imTunnel = ["==", ["get", "is_tunnel"], true];

    /** Kontur oder Kern im Tunnel: dieselbe Linie, gestrichelt (siehe oben). */
    const tunnelVon = (
        linie: LayerSpecification,
        ebene: LinienEbene,
        art: "outline" | "center",
    ): LayerSpecification => {
        const [strich, luecke] = AVENTURIA_PATH_CARTOGRAPHY.tunnel.dash as [number, number];
        const takt = art === "outline" ? ebene.style.centerWidth / ebene.style.outlineWidth : 1;
        const gezeichnet = linie as LayerSpecification & { filter: unknown; paint: Record<string, unknown> };
        return {
            ...gezeichnet,
            id: `${linie.id}-tunnel`,
            filter: ["all", gezeichnet.filter, imTunnel] as never,
            layout: { "line-cap": "butt", "line-join": "round" },
            paint: { ...gezeichnet.paint, "line-dasharray": [strich * takt, luecke * takt] },
        } as LayerSpecification;
    };

    /** Die Ebenen einer Gruppe: ohne Flusskontur, wenn sie aus ist. */
    const sichtbar = (art: "outline" | "center" | "hit"): LinienEbene[] =>
        ebenen.filter((ebene) => art !== "outline" || ebene.subtype !== "Flussweg" || options.riverOutline !== false);

    const baue = (art: "outline" | "center" | "hit"): LayerSpecification[] =>
        sichtbar(art).map((ebene) => {
            const faktoren = scaleFor(ebene.scaleKey);
            // Die Trefferfläche erbt Filter und `minzoom` der gezeichneten Linie, nur Farbe und Breite sind andere:
            // Sie ist unsichtbar und so breit wie die der Route. So kann sie gar nicht dort liegen, wo nichts steht.
            const gemeinsam = {
                id: `path-${art}-${ebene.id}`,
                type: "line" as const,
                source: PATH_SOURCE_ID,
                "source-layer": PATH_SOURCE_LAYER,
                ...zoomGrenzen(ebene.scaleKey, faktoren),
                filter: filterFor(ebene) as never,
                layout: { "line-cap": "round" as const, "line-join": "round" as const },
            };
            if (art === "hit") {
                return {
                    ...gemeinsam,
                    // Unsichtbar, aber abfragbar: MapLibre prüft Treffer gegen die Breite, nicht die Deckkraft.
                    paint: {
                        "line-color": ebene.style.center,
                        "line-width": options.hitWidth ?? ROUTE_HIT_WIDTH.pointer,
                        "line-opacity": 0,
                    },
                } as LayerSpecification;
            }
            const breite = art === "outline" ? ebene.style.outlineWidth : ebene.style.centerWidth;
            const farbe = art === "outline" ? ebene.style.outline : ebene.style.center;
            return {
                ...gemeinsam,
                paint: {
                    "line-color": farbe,
                    "line-width": (AVENTURIA_PATH_CARTOGRAPHY.water.types.includes(ebene.subtype)
                        ? waterWidthExpression(breite, faktoren, art)
                        : widthExpression(breite, faktoren)) as DataDrivenPropertyValueSpecification<number>,
                },
            } as LayerSpecification;
        });

    /** Die Linien einer Gruppe: erst alle im Tunnel (gestrichelt), dann alle anderen. */
    const linien = (art: "outline" | "center"): LayerSpecification[] => {
        const gezeichnet = baue(art);
        const zuEbene = sichtbar(art);
        return [
            ...gezeichnet.map((linie, i) => tunnelVon(linie, zuEbene[i]!, art)),
            ...gezeichnet.map((linie) => {
                const offen = linie as LayerSpecification & { filter: unknown };
                return { ...offen, filter: ["all", offen.filter, ["!", imTunnel]] as never } as LayerSpecification;
            }),
        ];
    };

    /** Die Punktreihe der Karawanenroute je Landweg (siehe oben); Wasser trägt kein Kennzeichen. */
    const karawane = AVENTURIA_PATH_CARTOGRAPHY.karawanenroute;
    const punkte: LayerSpecification[] = ebenen
        .filter((ebene) => !AVENTURIA_PATH_CARTOGRAPHY.water.types.includes(ebene.subtype))
        .map((ebene) => {
            const faktoren = scaleFor(ebene.scaleKey);
            return {
                id: `path-karawanenroute-${ebene.id}`,
                type: "line",
                source: PATH_SOURCE_ID,
                "source-layer": PATH_SOURCE_LAYER,
                ...zoomGrenzen(ebene.scaleKey, faktoren),
                filter: ["all", filterFor(ebene), IST_KARAWANENROUTE] as never,
                layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                    "line-color": karawane.dot,
                    "line-width": widthExpression(
                        karawane.dotWidth,
                        faktoren,
                    ) as DataDrivenPropertyValueSpecification<number>,
                    // MapLibre misst Strich und Lücke in Linienbreiten: Strich 0 mit runder Kappe ist ein Punkt.
                    "line-dasharray": [0, karawane.spacing / karawane.dotWidth],
                },
            } as LayerSpecification;
        });

    // 🔴 Die Trefferebenen zuletzt, also ÜBER den gezeichneten Linien: Sie sind unsichtbar, und so liegt die
    // Trefferfläche einer Reichsstraße nicht unter dem Kern eines Pfades, der sie kreuzt (WI-0090).
    return [...linien("outline"), ...linien("center"), ...punkte, ...baue("hit")];
}

export const FLOW_ARROW_IMAGE_ID = "fliessrichtung-dreieck";

/**
 * Das Dreieck als Laufzeitbild.
 *
 * 🪤 MapLibre kennt keine Formen — nur Bilder aus einem Sprite oder aus `addImage`. Wir haben kein
 * Sprite, und eins nur für ein Dreieck anzulegen hiesse, eine zweite Quelle für Bildmaterial
 * aufzumachen. Also zeichnet es der Browser einmal selbst.
 *
 * ⭐ Legacys Geometrie, Ziffer für Ziffer (`map-features-river-flow-arrows.js`): Spitze bei 8,
 * Flügel bei −5/±5,5. Die Spitze zeigt nach RECHTS, weil MapLibre ein Symbol auf einer Linie so
 * dreht, dass sein rechter Rand in Laufrichtung zeigt.
 *
 * 💣 Die Füllung ist die Flussfarbe aus der Kartografietafel, nicht `#4c89c6` von Hand. Legacy hat
 * die Zahl dort hingeschrieben; bei uns steht sie an einer Stelle, und wer das Wasser umfärbt,
 * färbt die Pfeile mit.
 */
export function drawFlowArrowImage(pixelRatio = 2): ImageData {
    const groesse = 26 * pixelRatio;
    const canvas = document.createElement("canvas");
    canvas.width = groesse;
    canvas.height = groesse;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Fliessrichtungs-Dreieck: kein 2D-Kontext");
    }
    const mitte = groesse / 2;
    const massstab = pixelRatio;
    ctx.translate(mitte, mitte);
    ctx.beginPath();
    ctx.moveTo(8 * massstab, 0);
    ctx.lineTo(-5 * massstab, -5.5 * massstab);
    ctx.lineTo(-5 * massstab, 5.5 * massstab);
    ctx.closePath();
    const wasser = AVENTURIA_PATH_CARTOGRAPHY.types["Flussweg"];
    if (!wasser) {
        // 🪤 Kein Ersatzwert. Ein Farbliteral hier waere eine zweite Quelle fuer die Wasserfarbe -
        // und eine, die nur dann sichtbar wird, wenn die Tafel schon kaputt ist.
        throw new Error("Fliessrichtungs-Dreieck: die Kartografietafel kennt keine Art 'Flussweg'");
    }
    const pfeil = AVENTURIA_PATH_CARTOGRAPHY.flowArrow;
    ctx.fillStyle = wasser.center;
    ctx.fill();
    ctx.globalAlpha = pfeil.strokeOpacity;
    ctx.strokeStyle = pfeil.strokeColor;
    ctx.lineWidth = 1 * massstab;
    ctx.stroke();
    ctx.globalAlpha = 1;
    return ctx.getImageData(0, 0, groesse, groesse);
}

/**
 * Die Strömungspfeile auf den Flüssen (V11).
 *
 * 🔴 NUR FÜR EDITOREN, und nur mit dem Schalter „Strömungsrichtungen“ im Anzeige-Menü (Betreiber
 * 2026-09-28), der auch die weiße Flusskontur trägt. In Legacy steigt `map-features-river-flow-arrows.js`
 * in `start()` aus, sobald `!IS_EDIT_MODE` — ein Besucher sieht die Dreiecke nie. Das ist keine Nebensache: an
 * derselben Regel hängt die weisse Flusskontur im Landschaftsmodus („Wer die Pfeile je für
 * Besucher freigibt, nimmt die Kontur mit"). Betreiberentscheidung 2026-09-22: „flusspfeile nur
 * für editoren sichtbar".
 *
 * 🪤 Ein Fluss OHNE Richtung bekommt keinen Pfeil, und das ist Absicht: so sieht ein Editor sofort,
 * wo die Richtung unbekannt ist. 1245 von 6983 Wegen tragen überhaupt eine.
 *
 * 🪤 Nur Flüsse (OPS-000098): Wird ein Fluss zum Landweg, behält er seine Richtung (`path-update.ts`, damit sie beim Zurückstellen
 * wieder da ist). Der Pfeil fragt darum auch die Art, sonst säße er auf der Straße.
 *
 * 💣 Die Ebene liegt UNTER allen Beschriftungen und ÜBER den Linien. In Legacy stand sie bis zum
 * 02.09.2026 zu hoch und ein Dreieck fiel mitten in den Flussnamen — auf denselben Fluss, auf dem
 * es sitzt.
 */
export function buildFlowArrowLayer(): LayerSpecification {
    return {
        id: "path-flow-arrow",
        type: "symbol",
        source: PATH_SOURCE_ID,
        "source-layer": PATH_SOURCE_LAYER,
        // Legacys ARROW_MIN_ZOOM ist 1 — in unserer Zählung eine Stufe höher.
        minzoom: renderZoomForBand(1),
        filter: [
            "all",
            ["==", ["get", "subtype"], "Flussweg"],
            ["in", ["get", "flow_direction"], ["literal", ["forward", "reverse"]]],
        ] as never,
        layout: {
            "symbol-placement": "line",
            // Legacys ARROW_SPACING_PX: ein BILDSCHIRM-Abstand, damit die Dichte beim Zoomen von
            // selbst stimmt.
            "symbol-spacing": AVENTURIA_PATH_CARTOGRAPHY.flowArrow.spacingPx,
            "icon-image": FLOW_ARROW_IMAGE_ID,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            // Das Dreieck dreht sich MIT der Karte, nicht mit dem Bildschirm — es zeigt eine
            // Richtung im Gelände an, keine am Monitor.
            "icon-rotation-alignment": "map",
            // 🪤 'reverse' heisst "entgegen der Punktreihenfolge". MapLibre legt das Symbol entlang
            // der gespeicherten Richtung, also genügt die halbe Drehung — die Geometrie bleibt
            // unangetastet.
            "icon-rotate": ["case", ["==", ["get", "flow_direction"], "reverse"], 180, 0] as never,
            "icon-size": flowArrowSizeExpression() as never,
        },
    };
}

/**
 * Wie groß das Dreieck ist: so breit wie seine Linie — Legacys `massstab`.
 *
 * ⭐ Legacy skaliert das Dreieck mit dem Breitenfaktor der Linie selbst (`pathBreitenFaktor`,
 * map-features-river-flow-arrows.js): ein Fluss hat 1, ein Bach 0,5. „Ein volles Dreieck auf einer
 * 1,5-px-Linie wäre breiter als der Bach." Das Bild trägt Legacys Geometrie bei Faktor 1.
 *
 * 💣 Hier stand eine feste 0,5 für ALLE — die Bachgröße auch auf den Flüssen. Betreiberbefund
 * 2026-09-23: „Die Pfeilchen sind superklein. Bei Bächen passen sie, bei Flüssen sollten sie etwas
 * größer werden." Jetzt aus derselben Breitentafel wie die Linie, ohne eigene Zahl.
 *
 * 🪤 Die Stops liegen auf den ganzen Stufen und lesen `is_bach` IN jedem Stop — MapLibre erlaubt
 * `["zoom"]` nur im äußersten Ausdruck.
 */
function flowArrowSizeExpression(): unknown {
    const bach = scaleFor("bach");
    const stops: unknown[] = [];
    for (let legacyZoom = 0; legacyZoom <= 6; legacyZoom += 1) {
        stops.push(renderZoom(legacyZoom), ["case", ["==", ["get", "is_bach"], true], bach?.[legacyZoom] ?? 1, 1]);
    }
    return ["interpolate", ["linear"], ["zoom"], ...stops];
}

/**
 * Die Wegnamen, auf ihrer Linie.
 *
 * 💣 NUR wo ein Editor sie eingeschaltet hat. Gemessen: 2356 von 6983 Wegen tragen
 * `label_visible`; die übrigen heißen überwiegend „Pfad-1" oder „Weg-17" und hätten nichts zu
 * sagen. Ein fehlender Wert heißt AUS — so liest es Legacy auf beiden Seiten.
 *
 * 🪤 `symbol-placement: line` statt `line-center`: ein Weg ist lang, und sein Name soll sich
 * WIEDERHOLEN, statt einmal in der Mitte zu stehen. `symbol-spacing` ist der Abstand in Pixeln —
 * eine Bildschirmgröße wie in Legacy, keine Kartengröße, damit er beim Zoomen gleich bleibt.
 *
 * 🔴 Dieser Layer liegt UNTER den Ortsnamen, und das ist gemessen begründet: MapLibre platziert
 * von oben nach unten durch den Stapel, also greifen die Ortsnamen zuerst zu. Legacy zeichnet
 * Wegnamen ausdrücklich als LETZTE — nicht weil sie unwichtiger wären, sondern weil sie nur
 * entlang ihrer Linie ausweichen können, während ein Ortsname zwölf Plätze hat. Umgekehrt kostete
 * es dort 503 Ortsnamen.
 */
/**
 * Die Wegarten, deren Namen nicht erscheinen: die Arten, die die Karte nicht zeigt (wer die Linie nicht
 * sieht, sieht auch den Namen nicht), dazu alles, was das Anzeige-Menü ausschaltet.
 */
function hiddenLabelTypes(options: PathSelection): string[] {
    return pathTypesInDrawOrder()
        .filter(({ subtype, style }) => style.hidden === true || !switchedOn(subtype, options))
        .map(({ subtype }) => subtype);
}

/**
 * Was das Anzeige-Menü von den Wegen zeigt (WI-0028). Ohne Angabe ist ein Schalter an.
 *
 * 🔴 Die Schalter teilen die Wegarten wie Legacy (`shouldShowPathOnMap`): „Flüsse" ist der Flussweg,
 * „Wege" jede andere Art. Seewege zeigt die Karte gar nicht (`hidden` in der Wegetafel).
 */
export interface PathSelection {
    land?: boolean | undefined;
    rivers?: boolean | undefined;
    /**
     * Die weiße Kontur der Flüsse. Sie gehört zu den Strömungsrichtungen (Legacy: „Wer die Pfeile je für
     * Besucher freigibt, nimmt die Kontur mit“): ohne den Schalter ist der Fluss nur sein blauer Kern.
     */
    riverOutline?: boolean | undefined;
    /**
     * Wie breit die unsichtbare Trefferfläche ist (WI-0090). Ohne Angabe die des Zeigers; am Finger reicht die
     * Oberfläche `ROUTE_HIT_WIDTH.touch` herein - DIESELBE Zahl wie bei der Route, siehe oben.
     */
    hitWidth?: number | undefined;
}

/**
 * Der Filter der Wegnamen: die ausgeblendeten Arten (siehe oben) und die Spanne des Zoombands „Name“ je Art (WI-0221, Betreiber
 * 2026-10-18: Die Namen folgen ihrem Schriftlauf, „hat ja nix damit zu tun, dass sie nicht ein zoomband haben können“). Ein Bachlauf
 * (`is_bach` am Schriftlauf, Migration 0199) folgt der Spanne der Bäche, jeder andere der seiner Art; ohne abgeleitetes `is_bach`
 * (NULL, vor der Neuableitung) gilt die Art wie bisher.
 */
function namenFilter(options: PathSelection): { filter?: never } {
    const teile: unknown[] = [];
    const versteckt = hiddenLabelTypes(options);
    if (versteckt.length > 0) teile.push(["!", ["in", ["get", "subtype"], ["literal", versteckt]]]);
    const spannen: Record<string, Zoomspanne> = {};
    for (const art of [...ZOOMBAND_WEGARTEN, "Flussweg"]) {
        if (art !== "bach") spannen[art] = zoomspanne(`wege.${art}.name`);
    }
    const arten = spannenFilter(spannen, "subtype");
    const bach = spannenBedingung(zoomspanne("wege.bach.name"));
    const spanne = bach === true ? arten : ["case", ["==", ["get", "is_bach"], true], bach, arten];
    if (spanne !== true) teile.push(spanne);
    if (teile.length === 0) return {};
    return { filter: (teile.length === 1 ? teile[0] : ["all", ...teile]) as never };
}

function switchedOn(subtype: string, options: PathSelection): boolean {
    if (subtype === "Flussweg") {
        return options.rivers !== false;
    }
    return options.land !== false;
}

/**
 * Der Name eines Wegs. Bei den Flüssen folgt er der ANSICHT und „Labels“, nicht dem Flussschalter (Legacy
 * `flussnamen`, `effectiveDisplay`): `rivers` meint hier die Flussnamen.
 */
export function buildPathLabelLayer(font: string, options: PathSelection): LayerSpecification {
    const label = AVENTURIA_PATH_CARTOGRAPHY.label;
    /**
     * Der optische Faktor des Betreibers (Stage-Abnahme 2026-09-22: „1.4 für wege").
     *
     * 💣 DIESELBE ZAHL STEHT IN DER ABLEITUNG. `path-runs.ts` schneidet die Schriftläufe auf
     * `(baseSize + größter sizeDelta) × calibration × runHeadroom` zu. Wer sie hier erhöht und
     * `derive:path-runs` nicht neu laufen lässt, macht die Namen breiter als ihre Läufe — und
     * MapLibre biegt sie dann nicht, es lässt sie weg. Ersatzlos, ohne Meldung.
     */
    const wegSchriftFaktor = label.calibration ?? 1;
    // 🪛 Er greift NUR an der Schriftgröße, nicht am Saum. Genau das hat der Betreiber am Regler
    // beurteilt. Dass Legacys Saum in Wahrheit ein Anteil der Schrift ist („Konturbreite 3,07 px
    // bei 15 px Schrift"), steht im visuellen Katalog unter „Wege und Gewässer" — es ist ein
    // Unterschied, der dort benannt ist und einer Zuteilung gehört, nicht dieser Größenänderung.
    return {
        id: "path-label",
        type: "symbol",
        // ⭐ Ein abgeleiteter SCHRIFTLAUF, nicht die Weggeometrie (Migration 0023) - dieselbe
        // Bauform wie die Landschaftsnamen aus WI-0004. Ohne sie stand von 149 Wegnamen im Bild
        // einer auf der Karte: eine Kette wie „Reichsstraße 2" ist ein MultiLineString aus 74
        // Abschnitten über die halbe Karte, und MapLibre findet darauf keine Stelle.
        source: PATH_LABEL_SOURCE_ID,
        "source-layer": PATH_LABEL_SOURCE_LAYER,
        // 🔴 Wer die Linie nicht sieht, sieht auch den Namen nicht: Die Namen der Wegarten, die die
        // Karte nicht zeigt, fallen weg (Seewege, Betreiber 2026-09-27). Ein Name über leerem Meer wäre
        // ein Hinweis auf etwas, das es auf der Karte nicht gibt.
        ...namenFilter(options),
        layout: {
            // 🪤 `line-center`, nicht `line`. Der Lauf IST schon die Stelle, an der der Name stehen
            // soll - er wurde je Zoom zugeschnitten und auf die ruhigste Strecke gelegt. `line`
            // würde daraufhin noch einmal Positionen suchen und die Arbeit der Ableitung verwerfen.
            // Dieselbe Entscheidung wie beim Landschafts-Schriftlauf, dort gemessen: mit `line`
            // verschwanden Namen an jeder Kachelgrenze.
            "symbol-placement": "line-center",
            "text-field": ["get", "name"],
            "text-font": [font],
            // ⭐ Flussnamen sind GRÖSSER als Straßennamen, ein Bach kleiner — Legacys Aufschläge
            // (+3 / -2 / +1), nicht erfunden.
            //
            // 💣 Die Grundgröße stand hier als Literal `12` — und in der Ableitung der
            // Schriftläufe noch einmal. Die beiden Zahlen MÜSSEN gleich sein: der Lauf wird auf
            // genau diese Größe zugeschnitten, und ein Name, der breiter ist als sein Lauf, wird
            // von MapLibre nicht gebogen, sondern weggelassen. Jetzt kommt sie aus der
            // Kartografie, einmal, für beide.
            //
            // ⭐ Der Faktor liegt UM die fertige Größe, nicht nur um die Grundgröße: der Betreiber
            // hat am Regler die ganze Familie beurteilt, Flussnamen samt ihrem Aufschlag. Nur
            // `baseSize` zu skalieren würde die Abstände zwischen Straße, Fluss und Bach
            // verschieben — Legacys +3/−2/+1 sind Pixel, keine Anteile.
            "text-size": [
                "case",
                ["==", ["get", "is_bach"], true],
                (label.baseSize + label.sizeDelta.bach) * wegSchriftFaktor,
                ["==", ["get", "subtype"], "Flussweg"],
                (label.baseSize + label.sizeDelta.Flussweg) * wegSchriftFaktor,
                (label.baseSize + label.sizeDelta.sonst) * wegSchriftFaktor,
            ] as unknown as DataDrivenPropertyValueSpecification<number>,
            // 🪤 KEIN `text-max-angle` unter dem Vorgabewert (45). Hier stand 30, aus dem
            // Landschafts-Layer kopiert - wo derselbe Kommentar ausdrücklich davor warnt und ich
            // ihn selbst geschrieben habe. Gemessen kostete die Verschärfung den Faktor NEUN: von
            // 149 Namen im Bild kamen mit 30 genau einer durch, mit 180 neun. Ein Weg ist kurvig;
            // ein strenger Winkel lehnt seinen Namen ab, statt ihn zu biegen.
            "text-allow-overlap": false,
            // 🪤 Optional: ein Wegname, der nicht passt, fällt weg. Bei einem Landschaftsnamen wäre
            // das falsch (die Fläche bliebe namenlos), hier nicht - derselbe Name steht weiter
            // vorn auf derselben Linie noch einmal.
            "text-optional": true,
            // 🔴 Ausdrücklich, nicht MapLibres Vorgabe: die Ableitung wählt die Läufe mit GENAU
            // dieser Zahl aus (`maxAngleDeg`). Weicht eine von beiden ab, verspricht die Ableitung
            // Platz, den MapLibre still verweigert.
            "text-max-angle": label.maxAngleDeg,
            // Legacy sperrt Wegenamen um 0,5 px, bei seinen Schriftgroessen also rund 0.03 em
            // (MCS-015). Der Wert steht im Designkanon, damit er nicht als drittes Literal neben
            // Orts- und Landschaftsnamen liegt.
            "text-letter-spacing": labelFamily("path").letterSpacing,
            // ⭐ AUSWEICHEN (Migration 0030): die Kachel liefert je Lauf bis zu fünf sich
            // überdeckende Kandidaten, `candidate` 0 ist die Mitte. Innerhalb desselben Rangs wird
            // die Mitte zuerst versucht, dann ⅛ und ¼ vor und zurück. Der Aufschlag bleibt unter
            // einem ganzen Rang (0,01 je Kandidat), damit kein Kandidat über einen fremden Namen
            // höheren Rangs springt.
            "symbol-sort-key": [
                "+",
                collisionSortKey(),
                ["*", ["to-number", ["coalesce", ["get", "candidate"], 0]], 0.01],
            ] as unknown as DataDrivenPropertyValueSpecification<number>,
        },
        paint: {
            // 🔴 HELLER NAME AUF DUNKLEM HALO — genau umgekehrt zu den Orts- und Landschaftsnamen.
            // Jeder Name trägt die Farbe seines Weges, aufgehellt (Legacy `getPathLabelStyle`).
            //
            // 🪤 Hier stand dunkler Text auf hellem Halo, aus der Landschaftstafel abgeschrieben.
            // Auf einer hellen Straße verschwindet er — und die Straße ist genau das, worauf er
            // liegt.
            // Die Karawanenroute hat ihre eigene Namensfarbe (WI-0177 §30); der Schriftlauf trägt das Kennzeichen seiner Kette.
            "text-color": [
                "case",
                IST_KARAWANENROUTE,
                AVENTURIA_PATH_CARTOGRAPHY.karawanenroute.labelColor,
                [
                    "match",
                    ["get", "subtype"],
                    ...Object.entries(AVENTURIA_PATH_CARTOGRAPHY.types).flatMap(([subtype, style]) => [
                        subtype,
                        style.labelColor,
                    ]),
                    AVENTURIA_PATH_CARTOGRAPHY.types["Weg"]?.labelColor ?? labelFamily("path").color,
                ],
            ] as unknown as DataDrivenPropertyValueSpecification<string>,
            // Der Ton ist derselbe wie bei allen anderen Namen der Karte; die STAERKE ist es
            // nicht — sie trennt Wasser und Strasse und gehoert deshalb in die Wegetafel.
            "text-halo-color": label.haloColor,
            // Bei Straßen kräftiger als bei Flüssen: ein heller Name auf hellem Gelände braucht
            // mehr Trennung als einer auf einem blauen Band (Legacy 1.6 gegen 1.0).
            "text-halo-width": [
                "case",
                ["in", ["get", "subtype"], ["literal", ["Flussweg", "Seeweg"]]],
                label.haloStrength.wasser,
                label.haloStrength.strasse,
            ] as unknown as DataDrivenPropertyValueSpecification<number>,
        },
    };
}
