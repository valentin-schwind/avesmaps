import { AVENTURIA_POLITICAL_CARTOGRAPHY, COAT_IMAGE_PREFIX, coatImageUrl } from "@avesmaps3d/shared";
import { LOAD_ATTEMPTS, pause, retryAfterMs } from "../route-planner/load-retry";
import type { ImageSink, StyleImageResolver } from "./style-image-resolver";

/**
 * Die Wappen am Gebietsnamen als Bilder der Karte (WI-0121): geholt, wenn MapLibre sie zum ersten Mal braucht, und auf die
 * Größe gerechnet, in der sie stehen.
 *
 * Der Stil nennt ein Bild nur beim Namen (`coat:<sha256>`, `territory-coat-label.ts`); der Auflöser (`style-image-resolver.ts`)
 * holt die Datei von ihrer Adresse unter `/media/sha256/…`, die der Name selbst trägt - kein zweiter Weg, kein Verzeichnis
 * im Code. 🔴 Er holt nur, was `coatImageUrl` aus einem Namen machen kann, also nur Adressen des Media Core: Ein Bildname
 * aus einer Kachel ist kein Pfad.
 *
 * 🔴 Vor `addImage` wird auf die Größe heruntergerechnet, in der das Wappen steht: die lange Kante 40 px mal Pixeldichte
 * des Geräts (`label.coat.edgePx`), und nie hinauf. Die Bilder sind 128 bis 512 Bildpunkte groß (Median 18,6 KB, p90 165 KB),
 * ein ungeschrumpftes Bild stünde als 512 × 512 in der Textur, hundertfach, für ein Zeichen von 40 px. Beim Verkleinern in
 * Hälften, denn ein Schritt um das Zwölffache liefert Treppen statt eines Bildes. `pixelRatio` macht aus der Größe in
 * Bildpunkten die logische Kante von 40 px, ganz gleich, wie groß das Gerät rechnet.
 *
 * Ein Bild, das nicht kommt (404, ein Asset ohne Datei, kaputte Bytes), bleibt ohne Bild: Dann steht der Name allein. Es ist
 * kein Fehler der Karte, aber es wird einmal pro Versuch gemeldet; der nächste Bedarf versucht es neu.
 *
 * 🔴 Ein Abruf, der nur VORÜBERGEHEND scheitert, wird nachgeholt, bevor das Wappen ausbleibt (WI-0123): ein Netzfehler (der
 * Server startet neu, ein Proxy setzt den Socket zurück), 5xx, 408 und 429, höchstens `LOAD_ATTEMPTS`-mal mit der Pause aus
 * `Retry-After` wie die Route (`route-planner/load-retry.ts`). Der Grund: MapLibre baut eine Kachel mit den Bildern, die der
 * Auflöser bis dahin angelegt hat, und fragt für DIESE Kachel nie wieder. Ein einziger gescheiterter Abruf ließ das Wappen
 * also stehen, bis die Kachel neu geladen wurde, und meldete „Image … could not be loaded“ - so im Schraffurfall von
 * `e2e/territories.spec.ts`, während der gemeinsame Server neu startete. Solange der Auflöser wartet, wartet die Kachel mit.
 */

const EDGE_PX = AVENTURIA_POLITICAL_CARTOGRAPHY.label.coat.edgePx;

/** Ein Bild in Bildpunkten, bereit für `addImage`. */
export interface CoatPixels {
    width: number;
    height: number;
    /** RGBA, nicht vormultipliziert. */
    data: Uint8ClampedArray;
}

/** Die Größe, in der ein Wappen angelegt wird: ihre Kanten in Bildpunkten und die Pixeldichte, die daraus die logische Kante macht. */
export interface CoatSize {
    width: number;
    height: number;
    pixelRatio: number;
}

/**
 * Wie groß das Wappen angelegt wird: die lange Kante auf `edgePx` mal Pixeldichte, höchstens so groß wie die Quelle. Ist die
 * Quelle kleiner als das Gerät es wünscht, bleibt sie, wie sie ist, und `pixelRatio` rechnet auf die logische Kante um -
 * hochgerechnet wird nichts.
 */
export function coatImageSize(
    source: { width: number; height: number },
    edgePx: number,
    deviceRatio: number,
): CoatSize {
    const longEdge = Math.max(source.width, source.height, 1);
    const wanted = Math.max(1, Math.round(edgePx * Math.max(1, deviceRatio)));
    const target = Math.min(longEdge, wanted);
    const factor = target / longEdge;
    return {
        width: Math.max(1, Math.round(source.width * factor)),
        height: Math.max(1, Math.round(source.height * factor)),
        pixelRatio: target / edgePx,
    };
}

/** Die Zwischengrößen beim Verkleinern einer Kante: je Schritt höchstens die Hälfte, zuletzt genau `to`. Wächst nichts, bleibt es bei `to`. */
export function halvingSteps(from: number, to: number): number[] {
    const steps: number[] = [];
    let current = from;
    while (current > to * 2) {
        current = Math.ceil(current / 2);
        steps.push(current);
    }
    steps.push(to);
    return steps;
}

/** Wie ein Bild in Bildpunkte kommt: Die Karte setzt echte Leinwände ein, die Tests eigene Fälschungen. */
export interface CoatImageDependencies {
    fetcher: (
        url: string,
    ) => Promise<{ ok: boolean; status: number; headers?: Pick<Headers, "get">; blob(): Promise<Blob> }>;
    decode: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
    rasterize: (decoded: { width: number; height: number }, size: CoatSize) => CoatPixels;
    deviceRatio: () => number;
    /** Die Pause vor dem nächsten Versuch eines vorübergehend gescheiterten Abrufs. */
    wait: (ms: number) => Promise<void>;
}

/** Scheitert ein Abruf mit diesem Status nur vorübergehend? 404 und die übrigen 4xx sind endgültig. */
export function transientCoatStatus(status: number): boolean {
    return status >= 500 || status === 408 || status === 429;
}

type Canvas2D = {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
};

function canvas2d(width: number, height: number): Canvas2D {
    const canvas =
        typeof OffscreenCanvas === "undefined"
            ? Object.assign(document.createElement("canvas"), { width, height })
            : new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true }) as Canvas2D["context"] | null;
    if (!context) throw new Error("Keine 2D-Leinwand für das Wappen");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    return { canvas, context };
}

/** Rechnet in Hälften auf die Zielgröße herunter und liest die Bildpunkte aus. */
function rasterizeInHalves(decoded: { width: number; height: number }, size: CoatSize): CoatPixels {
    const widths = halvingSteps(decoded.width, size.width);
    const heights = halvingSteps(decoded.height, size.height);
    let source = decoded as unknown as CanvasImageSource;
    let last: Canvas2D | undefined;
    for (let step = 0; step < Math.max(widths.length, heights.length); step += 1) {
        const width = widths[Math.min(step, widths.length - 1)] as number;
        const height = heights[Math.min(step, heights.length - 1)] as number;
        last = canvas2d(width, height);
        last.context.drawImage(source, 0, 0, width, height);
        source = last.canvas;
    }
    if (!last) throw new Error("Kein Wappen gezeichnet");
    const pixels = last.context.getImageData(0, 0, size.width, size.height);
    return { width: pixels.width, height: pixels.height, data: pixels.data };
}

const browserDependencies: CoatImageDependencies = {
    fetcher: (url) => fetch(url),
    decode: (blob) => createImageBitmap(blob),
    rasterize: rasterizeInHalves,
    deviceRatio: () => globalThis.devicePixelRatio || 1,
    wait: (ms) => pause(ms),
};

/**
 * Der Auflöser der Wappen. Gleichzeitige Anfragen nach demselben Bild (jede Kachel fragt für sich) teilen sich EINEN Abruf;
 * ein Bild, das die Karte schon hat, wird nicht noch einmal geholt.
 */
export function coatImageResolver(
    map: ImageSink,
    dependencies: CoatImageDependencies = browserDependencies,
): StyleImageResolver {
    const inFlight = new Map<string, Promise<void>>();

    /** Die Bytes des Bildes; ein vorübergehend gescheiterter Abruf wird nachgeholt (oben). */
    async function fetchBlob(url: string): Promise<Blob> {
        for (let attempt = 1; ; attempt += 1) {
            let response: Awaited<ReturnType<CoatImageDependencies["fetcher"]>> | undefined;
            try {
                response = await dependencies.fetcher(url);
            } catch (error) {
                if (attempt >= LOAD_ATTEMPTS) throw error;
            }
            if (response?.ok) return response.blob();
            if (response && (!transientCoatStatus(response.status) || attempt >= LOAD_ATTEMPTS)) {
                throw new Error(`antwortet ${String(response.status)}`);
            }
            await dependencies.wait(retryAfterMs(response));
        }
    }

    async function load(id: string, url: string): Promise<void> {
        try {
            const decoded = await dependencies.decode(await fetchBlob(url));
            try {
                const size = coatImageSize(decoded, EDGE_PX, dependencies.deviceRatio());
                const pixels = dependencies.rasterize(decoded, size);
                if (!map.hasImage(id)) {
                    map.addImage(
                        id,
                        { width: pixels.width, height: pixels.height, data: new Uint8Array(pixels.data.buffer) },
                        { pixelRatio: size.pixelRatio },
                    );
                }
            } finally {
                decoded.close?.();
            }
        } catch (error) {
            console.error(`Wappen ${id} nicht geladen`, error instanceof Error ? error.message : error);
        } finally {
            inFlight.delete(id);
        }
    }

    return {
        prefix: COAT_IMAGE_PREFIX,
        resolve(id) {
            const url = coatImageUrl(id);
            if (url === undefined || map.hasImage(id)) return;
            const running = inFlight.get(id);
            if (running) return running;
            const started = load(id, url);
            inFlight.set(id, started);
            return started;
        },
    };
}
