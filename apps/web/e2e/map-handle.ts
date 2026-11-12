import { expect, type Page } from "@playwright/test";
import { zeit } from "./zeitfaktor.ts";

/**
 * The development handles the app publishes on `globalThis` (see app.vue).
 *
 * Browser tests drive the map through the application's own projection rather than through
 * hand-written coordinates: if the projection were wrong, a test with its own numbers would keep
 * passing while the map showed the wrong place.
 */
export interface RenderedFeature {
    /** Die Kennung, die `promoteId` hebt (Wege: `public_id`). */
    id?: string | number;
    properties: Record<string, unknown>;
    geometry: { coordinates: [number, number] };
    /** Aus welcher Ebene der Treffer kommt. Nötig, wo ein Test über mehrere Ebenen fragt (WI-0090: `path-hit-*`). */
    layer: { id: string };
}

export interface MapHandle {
    getSource?(id: string): unknown;
    easeTo(options: { zoom?: number; duration?: number }): void;
    isStyleLoaded(): boolean;
    getStyle(): { layers: { id: string }[] };
    queryRenderedFeatures(
        pointOrOptions: { layers: string[] } | [number, number] | [[number, number], [number, number]],
        options?: { layers: string[] },
    ): RenderedFeature[];
    jumpTo(options: { center?: { lng: number; lat: number }; zoom?: number; bearing?: number; pitch?: number }): void;
    getBearing(): number;
    getPitch(): number;
    getCanvas(): HTMLCanvasElement;
    once(event: string, handler: () => void): void;
    /** Mithören, was die Kamera tut; das Ereignis trägt die Daten des Aufrufers (`LAYOUT_EVENT` an einem Sprung der Fläche). */
    on(event: string, handler: (event: unknown) => void): void;
    off(event: string, handler: (event: unknown) => void): void;
    triggerRepaint(): void;
    getRenderWorldCopies(): boolean;
    getCenter(): { lng: number; lat: number };
    getZoom(): number;
    isMoving(): boolean;
    getLayer(id: string): unknown;
    /** Die Features einer Quelle aus den geladenen Kacheln, auch die, die kein Layer zeichnet (Gebiete, WI-0062). */
    querySourceFeatures(sourceId: string, parameters?: { sourceLayer?: string }): RenderedFeature[];
    /** Der Filter einer Ebene, etwa der Vorschaukontur beim Zeigen (WI-0043 Stufe 2). */
    getFilter(id: string): unknown;
    getFeatureState(feature: { source: string; sourceLayer: string; id: string }): Record<string, unknown>;
    loaded(): boolean;
    hasImage(id: string): boolean;
    getPaintProperty(layer: string, name: string): unknown;
    project(lngLat: { lng: number; lat: number }): { x: number; y: number };
    unproject(point: [number, number]): { lng: number; lat: number };
}

/** Je Seite, was die Panels von der Karte nehmen (`visible-area.ts`). */
export interface InsetsHandle {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/**
 * Die freie Fläche (`visible-area.ts`). Seit WI-0218 ist sie nicht mehr MapLibres `padding` (der Fluchtpunkt bleibt in der Bildmitte):
 * `insets` ist der Bezug der Mitte (ohne Seitenleisten), `keepFree` alles, was frei bleiben muss.
 */
export interface VisibleAreaHandle {
    insets(): InsetsHandle;
    /** Die Ränder, hinter die der Kartenzaun den Kartenrand zurückweichen lässt: nur hinter Panels, die ihre ganze Kante decken (WI-0265 B9d). */
    fenceInsets(): InsetsHandle;
    keepFree(): InsetsHandle;
    /** Die Mitte der freien Fläche in Bildpunkten der Karte: dort, wo bis WI-0218 `map.project(map.getCenter())` lag. */
    centre(): { x: number; y: number };
}

export interface RenderProjectionHandle {
    toRenderLngLat(point: { x: number; y: number }): { lng: number; lat: number };
    fromRenderLngLat(lngLat: { lng: number; lat: number }): { x: number; y: number };
}

/** Der angeklickte Ort, in Kartenkoordinaten (app.vue, seit der Entwicklerkasten weg ist). */
export interface SelectedPlaceHandle {
    id: string;
    name: string;
    subtype: string;
    x: number;
    y: number;
}

/** Die gewählte Fläche (WI-0043): Kennung der Region, Name, Art und Anker des Namens in Kartenkoordinaten. */
export interface AreaSelectionHandle {
    kind: string;
    id: string;
    name: string | null;
    type: string;
    label: string;
    anchor: { x: number; y: number };
    /** Alle Regionen einer Gruppe gleichnamiger Landschaften (WI-0047); fehlt bei einer einzelnen. */
    group?: string[];
}

/** Der gewählte Subject (WI-0063): seine Art und die Kennung der Fachdomäne, wie `SubjectRef` sie führt. */
export interface SelectedSubjectHandle {
    kind: string;
    id?: string;
    chain?: string;
    index?: number;
    x?: number;
    y?: number;
    /** Kartenpunkt: die teilnehmenden Landschaftsebenen der Ansicht, in der er geöffnet wurde (Nachtrag zu WI-0083). */
    layers?: string[];
}

declare global {
    var avesmapsMap: MapHandle | undefined;
    var avesmapsVisibleArea: VisibleAreaHandle | undefined;
    var avesmapsRenderProjection: RenderProjectionHandle | undefined;
    var avesmapsSelectedPlace: (() => SelectedPlaceHandle | undefined) | undefined;
    var avesmapsAreaSelection: (() => AreaSelectionHandle | undefined) | undefined;
    var avesmapsSelectedSubject: (() => SelectedSubjectHandle | undefined) | undefined;
    /**
     * Die Öffnungsnaht (nur Entwicklung): ein Subject ohne Besitzer auf der Karte, etwa eine Kraftlinie, ist nur so zu öffnen.
     * `known.title` reicht nach, was die Karte schon weiß - damit messbar ist, was das Panel zeigt, solange die Antwort fehlt.
     */
    var avesmapsOpenSubject:
        ((ref: Record<string, unknown>, options?: { known?: { title?: string } }) => void) | undefined;
    /** Die Zonennamen (WI-0012, Nachtrag 2026-10-05): wo sie stehen sollen, in Bildpunkten der Karte. */
    var avesmapsClimateLabels:
        { placed(): readonly { key: string; name: string; at: readonly [number, number]; room: number }[] } | undefined;
    /** Die Entfernungsmessung (WI-0095): die zwei Punkte in Kartenkoordinaten und der gemessene Wert in Meilen. */
    var avesmapsMeasurement: (() => MeasurementHandle | undefined) | undefined;
}

/** Was die Messung hält: der erste Punkt, der zweite sobald er steht, und die Meilen dazwischen. */
export interface MeasurementHandle {
    start: { x: number; y: number };
    end?: { x: number; y: number };
    miles?: number;
}

/** Gareth, from the imported legacy slice (map_revision 139969). */
export const GARETH = { x: 551.625, y: 532.969 };

/**
 * Ein Punkt der Karte (Canvas-Pixel, wie `map.project` oder `queryRenderedFeatures` sie kennen) in Seitenkoordinaten, wie
 * `page.mouse` sie braucht. 🪤 Die Karte beginnt nicht bei 0,0 der Seite: im Editor-Modus steht darüber die Kopfleiste (WI-0120).
 */
export async function onPage(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const rect = await page.evaluate(() => {
        const box = globalThis.avesmapsMap!.getCanvas().getBoundingClientRect();
        return { left: box.left, top: box.top };
    });
    return { x: rect.left + point.x, y: rect.top + point.y };
}

/** Der umgekehrte Weg: ein Punkt der Seite in Canvas-Pixeln (etwa als Anfang einer Suche über die Karte). */
export async function onCanvas(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const rect = await page.evaluate(() => {
        const box = globalThis.avesmapsMap!.getCanvas().getBoundingClientRect();
        return { left: box.left, top: box.top };
    });
    return { x: point.x - rect.left, y: point.y - rect.top };
}

/** Klick auf einen Punkt der Karte (Canvas-Pixel). */
export async function clickMap(
    page: Page,
    point: { x: number; y: number },
    options?: Parameters<Page["mouse"]["click"]>[2],
): Promise<void> {
    const at = await onPage(page, point);
    await page.mouse.click(at.x, at.y, options);
}

/** Den Zeiger auf einen Punkt der Karte (Canvas-Pixel) bewegen. */
export async function moveMap(
    page: Page,
    point: { x: number; y: number },
    options?: Parameters<Page["mouse"]["move"]>[2],
): Promise<void> {
    const at = await onPage(page, point);
    await page.mouse.move(at.x, at.y, options);
}

/**
 * Der Editor-Modus (`/edit`): Nur dort gibt es die Werkzeuge der Editoren (Betreiber 2026-10-09), dazu die Kopfleiste, wenn die
 * Anmeldung eingerichtet ist. Ohne ihn ist es die öffentliche Karte.
 */
export const EDITOR_MODE = "/edit";

export async function openMap(page: Page, path = "/"): Promise<void> {
    await page.goto(path);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
        timeout: zeit(30_000),
    });
}

/**
 * Ein Frame über `idle` hinaus: noch einmal zeichnen und wieder auf `idle` warten. Gehört hinter
 * jeden Kamerasprung, nach dem ein Test Gezeichnetes liest (Pixel, gerenderte Features).
 *
 * 💣 Das Bild, bei dem `idle` feuert, ist nicht immer das letzte. Beim Wechsel der Kachelstufe hält
 * MapLibre die alte Kachel fest, damit ihre Symbole ausblenden können. Ihr Name ist sichtbar, der
 * der neuen Kachel als Duplikat versteckt. `_render` gibt gehaltene Kacheln erst NACH dem Zeichnen
 * frei und meldet dann `idle`, ohne neu zu zeichnen. Auf dem Schirm bleibt das alte Bild stehen, bis
 * irgendetwas neu zeichnet: beim ersten Sprung nach dem Laden (z5 → z4) Gareth eine Stufe zu groß,
 * 76 statt 58 px (labels.spec.ts). Ob es eintritt, hängt am Tempo der Kacheln. Vor dem ersten `idle`
 * blendet MapLibre gar nicht aus, und genau dort beginnen die meisten Tests.
 *
 * Kostet einen Frame, 15-50 ms. Hat MapLibre danach noch Namen auszublenden, bis rund 0,6 s
 * (gemessen 2026-09-27).
 *
 * Wer im selben `page.evaluate` springt und misst, schreibt dieselben vier Zeilen dazwischen.
 */
export async function settleFrame(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const map = globalThis.avesmapsMap;
        if (!map) {
            throw new Error("map handle missing");
        }
        await new Promise<void>((resolve) => {
            map.once("idle", resolve);
            map.triggerRepaint();
        });
    });
}

/**
 * Rückt, was nach einem Sprung in der Bildmitte steht, in die Mitte der freien Fläche (WI-0218). Bis dahin tat das MapLibres `padding`
 * von selbst; seit der Fluchtpunkt in der Bildmitte bleibt, tut es die Kamera beim Fliegen und diese Hilfe beim Testaufbau. Gespiegelt
 * um die Bildmitte: flach und auf der Bildzeile durch die Mitte genau.
 */
async function inDieFreieMitte(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const map = globalThis.avesmapsMap;
        const area = globalThis.avesmapsVisibleArea;
        if (!map || !area) return;
        const { top, right, bottom, left } = area.insets();
        if (top + right + bottom + left === 0) return;
        const canvas = map.getCanvas();
        const mitte = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
        const frei = {
            x: left + (canvas.clientWidth - left - right) / 2,
            y: top + (canvas.clientHeight - top - bottom) / 2,
        };
        map.jumpTo({ center: map.unproject([2 * mitte.x - frei.x, 2 * mitte.y - frei.y]) });
        await new Promise<void>((resolve) => {
            map.once("idle", resolve);
            setTimeout(resolve, 10_000);
        });
    });
}

/** Moves the camera and waits until the renderer has nothing left to do - and one frame beyond. */
export async function showPlace(page: Page, point: { x: number; y: number }, zoom: number): Promise<void> {
    await page.evaluate(
        async ({ target, level }) => {
            const map = globalThis.avesmapsMap;
            const projection = globalThis.avesmapsRenderProjection;
            if (!map || !projection) {
                throw new Error("map or projection handle missing");
            }
            map.jumpTo({ center: projection.toRenderLngLat(target), zoom: level });
            await new Promise<void>((resolve) => map.once("idle", resolve));
        },
        { target: point, level: zoom },
    );
    await inDieFreieMitte(page);
    await settleFrame(page);
}

/**
 * Schaltet in die Landschaftsansicht (WI-0009, Kartenfächer).
 *
 * 💣 Seit dem Kartenfächer zeigt die Standardansicht KEINE Landschaftsflächen mehr — sie gehören in
 * die Landschaftsansicht. Ein Test, der eine Fläche abfragt, muss also vorher hierher schalten;
 * sonst misst er null und behauptet, die Karte sei kaputt.
 *
 * Die Namen der Landschaften stehen weiterhin in BEIDEN Ansichten; nur die Flächen sind getrennt.
 */
export async function showLandscapes(page: Page, selection = "alle"): Promise<void> {
    await chooseFromFan(page, "landscapes", `fan-layer-${selection}`);
    // 🪤 NICHT auf `once("idle")` warten: der Stilumbau kann fertig sein, bevor der Listener steht,
    // und dann wartet der Test bis zum Timeout auf ein Ereignis, das schon vorbei ist.
    //
    // 💣 Und nicht nur auf den STIL warten, sondern auf GEZEICHNETE Flächen. Der Stil trägt seine
    // Layer, sobald `setStyle` durch ist; die Kacheln kommen danach. Ein Test, der dazwischen
    // misst, findet null und meldet einen Fehler, den es nicht gibt - zwischen zwei Läufen mal so,
    // mal anders. Genau diese Flakigkeit hat hier zuerst wie ein echter Befund ausgesehen.
    await page.waitForFunction(
        (erwartet) => {
            const map = globalThis.avesmapsMap;
            if (!map) {
                return false;
            }
            const ids = (map.getStyle?.().layers ?? []).map((layer) => layer.id);
            const gesucht =
                erwartet === "klima"
                    ? ids.filter((id) => id === "climate-fill")
                    : ids.filter((id) => id.startsWith("landscape-fill-"));
            if (gesucht.length === 0) {
                return false;
            }
            return map.queryRenderedFeatures({ layers: gesucht }).length > 0;
        },
        selection,
        { timeout: zeit(30_000) },
    );
    // 💣 „Eine Fläche gezeichnet“ heißt nicht „alle Kacheln da“. Unter Last maß landscape-names.spec.ts
    // danach bei `loaded=false`: Seine Stichpunkte lagen auf Kacheln, die noch fehlten, und der Name
    // stand „nicht über seiner Fläche“ (2026-09-27, 4 von 18 Läufen mit 4 Workern). `settleFrame`
    // löst hier einen Frame aus und wartet auf das `idle` danach; die Falle oben greift deshalb nicht.
    await settleFrame(page);
}

/** Die Kamera, wie sie gerade steht (WI-0016). Drehung auf (−180, 180]. */
export async function readCamera(page: Page): Promise<{ bearing: number; pitch: number; zoom: number }> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) {
            throw new Error("map handle missing");
        }
        return { bearing: map.getBearing(), pitch: map.getPitch(), zoom: map.getZoom() };
    });
}

/**
 * Wie weit die Spitze der Nordnadel vom Rand der Kompassscheibe weg ist, in Pixeln (WI-0027). Gerechnet
 * wird mit der gezeichneten Spitze, also samt Drehung und Stauchung der Nadel.
 */
export async function needleGap(page: Page): Promise<number> {
    return page.evaluate(() => {
        const scheibe = document.querySelector<HTMLElement>('[data-testid="camera-north"]');
        const nadel = scheibe?.querySelector<SVGPolygonElement>(".camera-ring__needle-north");
        const matrix = nadel?.getScreenCTM();
        if (!scheibe || !nadel || !matrix) {
            throw new Error("Kompass nicht sichtbar");
        }
        const box = scheibe.getBoundingClientRect();
        const rand = parseFloat(getComputedStyle(scheibe).borderTopWidth);
        const punkt = nadel.points.getItem(0);
        const spitze = new DOMPoint(punkt.x, punkt.y).matrixTransform(matrix);
        const abstand = Math.hypot(spitze.x - (box.left + box.width / 2), spitze.y - (box.top + box.height / 2));
        return box.width / 2 - rand - abstand;
    });
}

/**
 * Kamera setzen, warten, bis der Renderer nichts mehr zu tun hat, und einen Frame darüber hinaus
 * (`settleFrame`).
 *
 * 🪤 Hier stand vor dem Warten `if (!map.isMoving()) resolve()`. Nach `jumpTo` bewegt sich nichts
 * mehr, der Helfer kehrte also sofort zurück und wartete auf gar nichts (bis 2026-09-27).
 */
export async function showCamera(
    page: Page,
    view: { point: { x: number; y: number }; zoom: number; bearing?: number; pitch?: number },
): Promise<void> {
    await page.evaluate(async ({ point, zoom, bearing, pitch }) => {
        const map = globalThis.avesmapsMap;
        const projection = globalThis.avesmapsRenderProjection;
        if (!map || !projection) {
            throw new Error("map or projection handle missing");
        }
        map.jumpTo({ center: projection.toRenderLngLat(point), zoom, bearing: bearing ?? 0, pitch: pitch ?? 0 });
        await new Promise<void>((resolve) => {
            map.once("idle", resolve);
            setTimeout(resolve, 10_000);
        });
    }, view);
    await inDieFreieMitte(page);
    await settleFrame(page);
}

/**
 * Wählt im Kartenfächer Untergrund bzw. Ebene wie ein Mensch mit der Maus (WI-0036): die Kachel
 * anklicken, die Ansicht überfahren (dann steht ihr Eselsohr da), das Ohr anklicken - das hält die
 * Unterreihe fest - und darin wählen. Die Auswahl schließt den Fächer.
 *
 * 🪤 Nicht die Ansicht ANKLICKEN, um an ihre Unterreihe zu kommen: seit WI-0036 WÄHLT der Klick die
 * Ansicht sofort, und der Fächer geht zu.
 */
export async function chooseFromFan(page: Page, view: string, stageTestId: string): Promise<void> {
    await page.getByTestId("fan-toggle").click();
    await page.getByTestId(`fan-view-${view}`).hover();
    await page.getByTestId(`fan-ohr-${view}`).click();
    await page.getByTestId(stageTestId).click();
    await expect(page.getByTestId("fan-menu")).toBeHidden();
}

/** Der Ort, den der letzte Klick gewählt hat - oder keiner. */
export async function selectedPlace(page: Page): Promise<SelectedPlaceHandle | undefined> {
    return page.evaluate(() => globalThis.avesmapsSelectedPlace?.());
}

/**
 * Eine Stelle der Karte, an der WIRKLICH kein Besitzer liegt: kein Ort, keine Route, kein Weg, keine Kraftlinie.
 * Gesucht wird in einem Raster von links oben nach rechts unten; die erste Stelle ohne Treffer gewinnt.
 *
 * 💣 **Die Liste der Ebenen wird aus dem LEBENDEN STIL abgeleitet, nicht gepflegt.** Vorher stand hier eine Handliste
 * (`place-marker`, `place-marker-structure`, `route-hit`, `route-markers`), und mit WI-0090 bekam jede Wegart eine
 * unsichtbare Trefferfläche `path-hit-<wegart>` in der Breite der Route (14 px am Zeiger, 28 am Finger). Die Handliste
 * kannte sie nicht, also galt eine Stelle mitten auf einer Straße als „frei“ - und drei Telefonfälle („langer Druck auf
 * die freie Karte", „kurzer Tipp setzt keinen Kartenpunkt", „Langer Druck öffnet Was ist hier?") waren dauerhaft rot,
 * weil die Karte korrekt den Weg wählte („Nach Wulfenhag" statt „Was ist hier?").
 *
 * 🔴 Deshalb das Muster statt der Liste: Jede Ebene, deren Kennung das Teilstück `hit` trägt, ist eine Trefferfläche
 * eines Besitzers (`route-hit`, `powerline-hit`, `path-hit-strasse`, …), und dazu die sichtbaren Ortsmarken. Eine neue
 * Art mit eigener Trefferfläche ist damit von selbst mitgezählt. Wer eine Trefferfläche OHNE `hit` im Namen anlegt,
 * macht diesen Helfer wieder blind - die Tafeln dazu stehen in `map/interaction/priorities.ts`.
 */
export async function freeSpot(
    page: Page,
    from = { x: 60, y: 200 },
): Promise<{ x: number; y: number; ignored: string[] }> {
    const found = await page.evaluate((origin) => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const canvas = map.getCanvas();
        // 🪤 Die Karte beginnt nicht bei 0,0 der Seite (im Editor-Modus die Kopfleiste, WI-0120): geprüft wird in Kartenkoordinaten,
        // zurück kommt die Stelle in Seitenkoordinaten, wie `page.mouse` sie braucht.
        const rect = canvas.getBoundingClientRect();
        const ids = (map.getStyle?.().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => /(^|-)hit(-|$)/.test(id) || id.startsWith("place-marker") || id === "route-markers");
        for (let y = origin.y; y < canvas.clientHeight - 200; y += 25) {
            for (let x = origin.x; x < canvas.clientWidth - 40; x += 25) {
                // 🪤 Die Stelle muss auch frei von BEDIENELEMENTEN sein: Am Telefon deckt der Hinweis zum Neigen, der
                // Planerreiter oder der 3D-Knopf Teile der Karte, und ein Tipp dort erreicht die Karte nie.
                if (document.elementFromPoint(rect.left + x, rect.top + y) !== canvas) continue;
                if (map.queryRenderedFeatures([x, y], { layers: ids }).length === 0) {
                    return { x: rect.left + x, y: rect.top + y, ids };
                }
            }
        }
        return { x: -1, y: -1, ids };
    }, from);
    if (found.x < 0) {
        throw new Error(`keine freie Stelle in der Karte; geprüfte Ebenen: ${found.ids.join(", ")}`);
    }
    // 🪤 Ohne eine einzige geprüfte Ebene wäre JEDE Stelle „frei“, und der Fall wäre grün, ohne etwas zu prüfen.
    if (found.ids.length === 0) throw new Error("der Stil trägt keine Trefferfläche - die Stelle ist nicht belegbar");
    return { x: found.x, y: found.y, ignored: found.ids };
}

/**
 * Die Untergründe, die der Kartenfächer anbietet (über der Standardansicht). Der Entwicklerkasten
 * mit seiner Serienwahl ist weg (Betreiber 2026-09-24) - gewählt wird wie ein Mensch im Fächer.
 */
export async function offeredSeries(page: Page): Promise<string[]> {
    await page.getByTestId("fan-toggle").click();
    await page.getByTestId("fan-view-standard").hover();
    await page.getByTestId("fan-ohr-standard").click();
    const cells = page.locator('[data-testid^="fan-series-"]');
    await expect(cells.first()).toBeVisible();
    const ids = await cells.evaluateAll((nodes) =>
        nodes.map((node) => (node.getAttribute("data-testid") ?? "").replace("fan-series-", "")),
    );
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    return ids;
}

/** Wählt einen Untergrund im Fächer; die Karte zeigt danach die Standardansicht. */
export async function chooseSeries(page: Page, id: string): Promise<void> {
    await chooseFromFan(page, "standard", `fan-series-${id}`);
}

/** Wählt eine Ansicht allein, mit dem eingestellten Untergrund bzw. der gemerkten Ebene - ein Klick genügt (WI-0036). */
export async function chooseView(page: Page, view: string): Promise<void> {
    await page.getByTestId("fan-toggle").click();
    await page.getByTestId(`fan-view-${view}`).click();
    await expect(page.getByTestId("fan-menu")).toBeHidden();
}
