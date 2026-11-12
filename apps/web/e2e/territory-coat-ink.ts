import type { Page } from "@playwright/test";
import { settleFrame } from "./map-handle.ts";

/**
 * Wo Wappen und Name eines Gebiets GEZEICHNET sind (WI-0121): gemessen am Bild, nicht am Stil.
 *
 * 🪤 Ein Symbol hat zwei Teile, Bild und Text, und `queryRenderedFeatures` nennt nur seinen Ankerpunkt. Gemessen wird deshalb
 * dreimal von derselben Stelle: beide Teile unsichtbar (der Grund), nur das Bild, nur der Text - über `icon-opacity` und
 * `text-opacity` der Ebene, die ohne neuen Kachelbau wirken. Was sich gegenüber dem Grund ändert, ist die Tinte des Teils.
 *
 * 🪤 Die Tinte des Textes ist nur, was DUNKLER wird. Der Saum ist weiß und hellte den Grund auf; ein Rahmen um die Tinte
 * mit Saum läge um die Breite des Saums weiter außen und, je nachdem, wie die Glyphen ausladen, einseitig daneben.
 * Ist der Name gewählt, ist der Saum dunkel und die Schrift gelb: `withHalo` misst dann Glyphen SAMT Saum, jede Änderung gegenüber
 * dem Grund. Der Saum ist rundum gleich breit, die Mitte der Tinte also dieselbe, ob Schrift und Saum dunkel und hell oder gelb und
 * dunkel sind (und die Höhe um höchstens die Breitendifferenz der beiden Säume verschieden).
 *
 * Alle Maße in CSS-Pixeln vom Anker aus (rechts und unten positiv; auf einem Schirm mit doppelter Pixeldichte ist ein Bildpunkt
 * des Screenshots ein halber); `x1` und `y1` liegen jenseits der letzten Tinte.
 */
export interface Ink {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    /** Wie viele Bildpunkte sich geändert haben. 0 heißt: dieser Teil ist nicht gezeichnet. */
    pixels: number;
}

export interface LabelInk {
    icon: Ink;
    text: Ink;
}

/** Die Mitte einer Tinte auf der waagerechten Achse, vom Anker aus. */
export const centreX = (ink: Ink): number => (ink.x0 + ink.x1) / 2;

interface Shots {
    base: string;
    icon: string;
    text: string;
    /** Der Grund noch einmal, nach den anderen: Was sich zwischen den beiden Grundbildern ändert, ist nicht Tinte. */
    after: string;
}

async function shoot(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<string> {
    await settleFrame(page);
    // Symbole blenden über ein paar hundert Millisekunden ein und aus (Kollision); gemessen wird erst, wenn sie stehen.
    await page.waitForTimeout(700);
    return (await page.screenshot({ clip })).toString("base64");
}

/**
 * „Unsichtbar“ ist nicht 0. 🪤 Ein Symbol, dessen Bild UND Text die Deckkraft 0 haben, setzt MapLibre gar nicht erst: Der Platz,
 * den es besetzt hielt, wird frei, die Namen der Nachbarn blenden dort ein, und der „Grund“ ist ein anderer als mit Symbol.
 * Gemessen an Thorwal (Band 1) und Luring (Band 4): Tinte, die keine war. Eine Deckkraft unter einem Schritt der 8-Bit-Farbe
 * bleibt unsichtbar, und das Symbol steht weiter in der Kollision.
 */
const HIDDEN = 0.003;

async function setOpacity(page: Page, layer: string, icon: number, text: number): Promise<void> {
    await page.evaluate(
        ({ layer: id, icon: i, text: t }) => {
            const map = globalThis.avesmapsMap as unknown as {
                setPaintProperty(layer: string, name: string, value: number): void;
            };
            map.setPaintProperty(id, "icon-opacity", i);
            map.setPaintProperty(id, "text-opacity", t);
        },
        { layer, icon, text },
    );
}

/**
 * Misst Bild und Text der Ebene `layer` um den Punkt `anchor` (Längen- und Breitengrad der Karte). Der Punkt muss im Bild
 * stehen und frei von Bedienflächen sein; die Ebene bekommt ihre Deckkraft danach zurück.
 *
 * `only` ist die Kennung des Gebiets, dessen Namen die Ebene der Namen ALLEIN zeigt, solange gemessen wird (der Filter kommt
 * danach zurück). 🪤 Sonst liegen die Nachbarn im Ausschnitt: Sie blenden aus und ein, wenn sich das Symbol ändert, und ihre
 * Tinte gilt als die des Symbols. Ohne `only` (die Auswahl, ein einzelner Punkt) bleibt die Ebene, wie sie ist.
 */
export async function measureLabelInk(
    page: Page,
    layer: string,
    anchor: { lng: number; lat: number },
    options: { radius?: number; only?: string; withHalo?: boolean } = {},
): Promise<LabelInk> {
    const radius = options.radius ?? 120;
    const point = await page.evaluate(({ lng, lat }) => {
        const map = globalThis.avesmapsMap!;
        const projected = map.project({ lng, lat });
        const rect = map.getCanvas().getBoundingClientRect();
        return { x: rect.left + projected.x, y: rect.top + projected.y };
    }, anchor);
    const clip = {
        x: Math.round(point.x - radius),
        y: Math.round(point.y - radius),
        width: radius * 2,
        height: radius * 2,
    };
    // Der Anker in Bildpunkten des Ausschnitts: auf ganze Pixel gerundet, wie die Karte Symbole setzt.
    const origin = { x: point.x - clip.x, y: point.y - clip.y };
    const filter = await page.evaluate(
        ({ layer: id, only }) => {
            const map = globalThis.avesmapsMap as unknown as {
                getFilter(layer: string): unknown;
                setFilter(layer: string, filter: unknown): void;
            };
            const before = map.getFilter(id);
            if (only !== undefined) {
                map.setFilter(id, ["all", before ?? true, ["==", ["get", "territory_public_id"], only]]);
            }
            return before ?? null;
        },
        { layer, only: options.only },
    );
    try {
        await setOpacity(page, layer, HIDDEN, HIDDEN);
        const base = await shoot(page, clip);
        await setOpacity(page, layer, 1, HIDDEN);
        const icon = await shoot(page, clip);
        await setOpacity(page, layer, HIDDEN, 1);
        const text = await shoot(page, clip);
        await setOpacity(page, layer, HIDDEN, HIDDEN);
        const after = await shoot(page, clip);
        const scale = await page.evaluate(() => globalThis.devicePixelRatio);
        return await page.evaluate(analyse, {
            shots: { base, icon, text, after } as Shots,
            origin,
            scale,
            withHalo: options.withHalo === true,
        });
    } finally {
        await setOpacity(page, layer, 1, 1);
        if (options.only !== undefined) {
            await page.evaluate(
                ({ layer: id, before }) =>
                    (
                        globalThis.avesmapsMap as unknown as { setFilter(layer: string, filter: unknown): void }
                    ).setFilter(id, before),
                { layer, before: filter },
            );
        }
    }
}

/** Läuft im Browser: die drei Bilder lesen und die Tinte der beiden Teile bestimmen. */
async function analyse({
    shots,
    origin,
    scale,
    withHalo,
}: {
    shots: Shots;
    origin: { x: number; y: number };
    scale: number;
    withHalo: boolean;
}): Promise<LabelInk> {
    const load = (data: string): Promise<ImageData> =>
        new Promise((resolve) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext("2d")!;
                context.drawImage(image, 0, 0);
                resolve(context.getImageData(0, 0, image.width, image.height));
            };
            image.src = `data:image/png;base64,${data}`;
        });
    const [base, icon, text, after] = await Promise.all([
        load(shots.base),
        load(shots.icon),
        load(shots.text),
        load(shots.after),
    ]);
    // 🪤 Auf einer Karte, die noch Kacheln lädt und Symbole ein- und ausblendet, ändert sich auch der Grund von selbst. Nur
    // Bildpunkte, die zwischen den beiden Grundbildern gleich bleiben, können Tinte des Symbols sein.
    const stable = (k: number): boolean =>
        Math.abs(base.data[k]! - after.data[k]!) +
            Math.abs(base.data[k + 1]! - after.data[k + 1]!) +
            Math.abs(base.data[k + 2]! - after.data[k + 2]!) <=
        12;
    const luma = (data: ImageData, at: number): number =>
        0.299 * data.data[at]! + 0.587 * data.data[at + 1]! + 0.114 * data.data[at + 2]!;
    /**
     * Die Tinte DIESES Symbols: Der Ausschnitt trägt auch die Nachbarn derselben Ebene (ein Wappen 60 px weiter unten, ein
     * Name daneben). Geändert gegenüber dem Grund sind alle; zusammengehörig ist, was nicht weiter als `gap` Bildpunkte
     * auseinanderliegt, und das Symbol ist der Haufen, der den Anker (auf `reach` Pixel) erreicht.
     */
    const measure = (changed: (k: number) => boolean, gap: number): Ink => {
        const width = base.width;
        const radius = Math.ceil(gap * scale);
        const reach = 25 * scale;
        const inked = new Set<number>();
        for (let y = 0; y < base.height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const k = (y * width + x) * 4;
                if (stable(k) && changed(k)) inked.add(y * width + x);
            }
        }
        const anchorX = origin.x * scale;
        const anchorY = origin.y * scale;
        let best: { x0: number; x1: number; y0: number; y1: number; pixels: number } | undefined;
        while (inked.size > 0) {
            const [seed] = inked;
            const queue = [seed!];
            inked.delete(seed!);
            const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, pixels: 0 };
            while (queue.length > 0) {
                const at = queue.pop()!;
                const x = at % width;
                const y = Math.floor(at / width);
                box.pixels += 1;
                box.x0 = Math.min(box.x0, x);
                box.x1 = Math.max(box.x1, x + 1);
                box.y0 = Math.min(box.y0, y);
                box.y1 = Math.max(box.y1, y + 1);
                for (let dy = -radius; dy <= radius; dy += 1) {
                    for (let dx = -radius; dx <= radius; dx += 1) {
                        const next = (y + dy) * width + (x + dx);
                        if (x + dx >= 0 && x + dx < width && inked.delete(next)) queue.push(next);
                    }
                }
            }
            const away = Math.hypot(
                Math.max(box.x0 - anchorX, 0, anchorX - box.x1),
                Math.max(box.y0 - anchorY, 0, anchorY - box.y1),
            );
            if (away <= reach && (best === undefined || box.pixels > best.pixels)) best = box;
        }
        return best === undefined
            ? { x0: 0, x1: 0, y0: 0, y1: 0, pixels: 0 }
            : {
                  x0: best.x0 / scale - origin.x,
                  x1: best.x1 / scale - origin.x,
                  y0: best.y0 / scale - origin.y,
                  y1: best.y1 / scale - origin.y,
                  pixels: best.pixels,
              };
    };
    return {
        icon: measure((k) => {
            const d =
                Math.abs(icon.data[k]! - base.data[k]!) +
                Math.abs(icon.data[k + 1]! - base.data[k + 1]!) +
                Math.abs(icon.data[k + 2]! - base.data[k + 2]!);
            return d > 24;
        }, 6),
        text: measure(
            withHalo
                ? // Glyphen samt Saum: jede Änderung gegenüber dem Grund, gleich welche Farbe Schrift und Saum haben.
                  (k) =>
                      Math.abs(text.data[k]! - base.data[k]!) +
                          Math.abs(text.data[k + 1]! - base.data[k + 1]!) +
                          Math.abs(text.data[k + 2]! - base.data[k + 2]!) >
                      45
                : (k) => luma(base, k) - luma(text, k) > 30,
            8,
        ),
    };
}

/** Ein Gebiet der Karte: seine Kennung und der Anker seines Namens, wie die Kachel ihn führt. */
export interface TerritoryAnchor {
    lng: number;
    lat: number;
    id: string;
}

/**
 * Schiebt die Karte so, dass der Anker an (`x`, `y`) steht (WI-0121 Nachtrag). Am Rechner decken links der Planer (bis 350 px),
 * oben der Hinweis zum Neigen (bis 140 px) und, sobald ein Gebiet gewählt ist, rechts das Infopanel (ab 880 px) einen Teil der Karte;
 * in der Mitte dazwischen liegt, was ein Bild des Namens vor und nach dem Klick unverdeckt zeigt.
 */
export async function centreInFreeArea(page: Page, anchor: TerritoryAnchor, x = 615, y = 400): Promise<void> {
    await page.evaluate(
        async ({ lng, lat, targetX, targetY }) => {
            const map = globalThis.avesmapsMap as unknown as {
                project(point: { lng: number; lat: number }): { x: number; y: number };
                panBy(offset: [number, number], options: { animate: boolean }): void;
                once(event: string, handler: () => void): void;
            };
            const at = map.project({ lng, lat });
            map.panBy([at.x - targetX, at.y - targetY], { animate: false });
            await new Promise<void>((resolve) => map.once("idle", resolve));
        },
        { lng: anchor.lng, lat: anchor.lat, targetX: x, targetY: y },
    );
    await settleFrame(page);
}

/**
 * Wählt das Gebiet mit einem ECHTEN Mausklick auf seine Fläche, nahe am Namen, an einer Stelle ohne Ort, Weg oder Route (deren
 * Besitzer gewännen vor der Fläche). Danach steht der Zeiger abseits, damit kein Zeigen-Schild im Bild liegt.
 */
export async function clickTerritory(page: Page, anchor: TerritoryAnchor): Promise<void> {
    const spot = await page.evaluate(({ lng, lat, id }) => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        const centre = map.project({ lng, lat });
        const rect = canvas.getBoundingClientRect();
        const owners = (map.getStyle?.().layers ?? [])
            .map((layer) => layer.id)
            .filter(
                (name) => /(^|-)hit(-|$)/.test(name) || name.startsWith("place-marker") || name === "route-markers",
            );
        for (let radius = 0; radius <= 160; radius += 10) {
            const steps = radius === 0 ? 1 : 16;
            for (let k = 0; k < steps; k += 1) {
                const angle = (k / steps) * Math.PI * 2;
                const x = centre.x + radius * Math.cos(angle);
                const y = centre.y + radius * Math.sin(angle);
                if (x < 5 || y < 5 || x > canvas.clientWidth - 5 || y > canvas.clientHeight - 5) continue;
                if (document.elementFromPoint(rect.left + x, rect.top + y) !== canvas) continue;
                const fill = map.queryRenderedFeatures([x, y], { layers: ["territory-fill"] })[0];
                if (fill?.properties["territory_public_id"] !== id) continue;
                if (owners.length > 0 && map.queryRenderedFeatures([x, y], { layers: owners }).length > 0) continue;
                return { x: rect.left + x, y: rect.top + y };
            }
        }
        return null;
    }, anchor);
    if (!spot) throw new Error(`keine freie Stelle in der Fläche von ${anchor.id}`);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForFunction(
        (id) => {
            const area = globalThis.avesmapsAreaSelection?.();
            return area?.kind === "territory" && area.id === id;
        },
        anchor.id,
        { timeout: 15_000 },
    );
    await page.mouse.move(3, 3);
}

/** Hebt die Auswahl auf (Escape) und wartet, bis sie weg ist. */
export async function clearSelection(page: Page): Promise<void> {
    if (!(await page.evaluate(() => globalThis.avesmapsAreaSelection?.() !== undefined))) return;
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => globalThis.avesmapsAreaSelection?.() === undefined, undefined, {
        timeout: 15_000,
    });
}
