import { expect, test, type Page } from "@playwright/test";
import { AVENTURIA_POLITICAL_CARTOGRAPHY, canonColour } from "@avesmaps3d/shared";
import { chooseView, openMap, settleFrame, showPlace } from "./map-handle.ts";
import {
    centreInFreeArea,
    centreX,
    clearSelection,
    clickTerritory,
    measureLabelInk,
    type LabelInk,
    type TerritoryAnchor,
} from "./territory-coat-ink.ts";

/**
 * Der Name eines gewählten Herrschaftsgebiets, am echten Stack (WI-0121 Nachtrag, Betreiber 2026-10-09, wörtlich: „einfach nur
 * text, der schon da steht, gelb werden soll und nicht erst neu erzeugt, aus und wieder eingeblendet, und irgendwo platziert wird
 * (wenn ich z.b. auf Heiliges Neues Kaiserreich vom Greifenthron zu Gareth klicke wird daraus ein one liner)“).
 *
 * 🔴 Gemessen wird am gezeichneten Bild (`territory-coat-ink.ts`), nicht am Stil: Der Name steht nach dem Klick an DERSELBEN Stelle
 * (±1 px), in derselben Zeilenzahl, ist gelb, und es gibt kein zweites Symbol mit dem Namen. Die Auswahl ist ein ECHTER Mausklick auf
 * die Fläche.
 *
 * 💣 Braucht abgeleitete Gebiete und ihre Wappen in der lokalen Datenbank und einen Server mit `MEDIA_ROOT` (siehe
 * `territory-coats.spec.ts`). Namen und Kennungen kommen aus den Kacheln, nicht aus dem Test.
 */

const POLITICAL = AVENTURIA_POLITICAL_CARTOGRAPHY;
const LAYER = "territory-label";
const GOLD = canonColour("mapSelection");

/** Das Beispiel des Betreibers: ein langer Name, der in mehreren Zeilen steht und beim Klick zum Einzeiler wurde. Gareth, Band 1. */
const KAISERREICH = {
    name: "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth",
    at: { x: 551.625, y: 532.969 },
    zoom: 2.5,
};
const GREIFENFURT = { name: "Markgrafschaft Greifenfurt", near: { lng: 0.111527, lat: 27.722253 }, zoom: 4.5 };
const THORWAL = { name: "Thorwal", near: { lng: -73.0516, lat: 58.6288 }, zoom: 2 };

/** Springt in die Nähe, findet den gezeichneten Namen, zentriert ihn in der freien Fläche und gibt seinen Anker zurück. */
async function showName(
    page: Page,
    fall: { name: string; at?: { x: number; y: number }; near?: { lng: number; lat: number }; zoom: number },
): Promise<TerritoryAnchor> {
    if (fall.at) {
        await showPlace(page, fall.at, fall.zoom);
    } else {
        await page.evaluate(
            async ({ near, zoom }) => {
                const map = globalThis.avesmapsMap!;
                map.jumpTo({ center: near, zoom });
                await new Promise<void>((resolve) => map.once("idle", resolve));
            },
            { near: fall.near!, zoom: fall.zoom },
        );
        await settleFrame(page);
    }
    await expect
        .poll(
            () =>
                page.evaluate(
                    (name) =>
                        globalThis
                            .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-label"] })
                            .some((feature) => feature.properties["name"] === name),
                    fall.name,
                ),
            { timeout: 30_000, message: `${fall.name} steht nicht im Bild` },
        )
        .toBe(true);
    const anchor = await page.evaluate((name) => {
        const feature = globalThis
            .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-label"] })
            .find((candidate) => candidate.properties["name"] === name)!;
        return {
            lng: feature.geometry.coordinates[0],
            lat: feature.geometry.coordinates[1],
            id: String(feature.properties["territory_public_id"]),
        };
    }, fall.name);
    await centreInFreeArea(page, anchor);
    // Symbole blenden über ein paar hundert Millisekunden ein; gemessen wird erst, wenn sie stehen.
    await page.waitForTimeout(800);
    return anchor;
}

/** Wie oft die Karte einen Namen mit dieser Kennung gerade zeichnet (placierte Symbole der Ebene der Gebietsnamen). */
async function placedCount(page: Page, id: string): Promise<number> {
    return page.evaluate(
        (territoryId) =>
            globalThis
                .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-label"] })
                .filter((feature) => feature.properties["territory_public_id"] === territoryId).length,
        id,
    );
}

/** Die Mitte der Tinte samt Saum und die Höhe des Namens. Der Saum liegt rundum gleich: Die Mitte ist die der Glyphen. */
function textBox(ink: LabelInk): { x: number; y: number; height: number } {
    return {
        x: (ink.text.x0 + ink.text.x1) / 2,
        y: (ink.text.y0 + ink.text.y1) / 2,
        height: ink.text.y1 - ink.text.y0,
    };
}

/** Wie viele Bildpunkte in der Fläche um den Anker die Farbe der Auswahl tragen (Abstand im Farbraum unter 40). */
async function goldPixels(page: Page, anchor: TerritoryAnchor, radius: number): Promise<number> {
    const point = await page.evaluate(({ lng, lat }) => {
        const map = globalThis.avesmapsMap!;
        const p = map.project({ lng, lat });
        const rect = map.getCanvas().getBoundingClientRect();
        return { x: rect.left + p.x, y: rect.top + p.y };
    }, anchor);
    await settleFrame(page);
    const shot = (
        await page.screenshot({
            clip: {
                x: Math.round(point.x - radius),
                y: Math.round(point.y - radius),
                width: radius * 2,
                height: radius * 2,
            },
        })
    ).toString("base64");
    return page.evaluate(
        async ({ data, gold }) => {
            const image = new Image();
            await new Promise<void>((resolve) => {
                image.onload = () => resolve();
                image.src = `data:image/png;base64,${data}`;
            });
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, image.width, image.height).data;
            const target = [1, 3, 5].map((k) => parseInt(gold.slice(k, k + 2), 16));
            let count = 0;
            for (let k = 0; k < pixels.length; k += 4) {
                const distance =
                    Math.abs(pixels[k]! - target[0]!) +
                    Math.abs(pixels[k + 1]! - target[1]!) +
                    Math.abs(pixels[k + 2]! - target[2]!);
                if (distance < 40) count += 1;
            }
            return count;
        },
        { data: shot, gold: GOLD },
    );
}

test.describe("ein Klick auf ein Herrschaftsgebiet färbt seinen vorhandenen Namen gelb", () => {
    for (const fall of [
        { titel: "Kaiserreich, grobe Stufe (Beispiel des Betreibers)", ...KAISERREICH },
        { titel: "Greifenfurt, Band 3, mit Wappen", ...GREIFENFURT },
        { titel: "Thorwal, Band 1, dunkle Fläche", ...THORWAL },
    ]) {
        test(`🔴 ${fall.titel}: derselbe Name an derselben Stelle (±1 px), gleiche Zeilenzahl, gelb, kein zweites Symbol`, async ({
            page,
        }) => {
            test.setTimeout(120_000);
            await openMap(page);
            await chooseView(page, "political");
            const anchor = await showName(page, fall);

            // Ungewählt: der Name steht, einmal, in dunkler Schrift.
            expect(await placedCount(page, anchor.id), "ungewählt: ein Symbol").toBe(1);
            const ruhig = await measureLabelInk(page, LAYER, anchor, { only: anchor.id, radius: 140, withHalo: true });
            expect(ruhig.text.pixels, "der Name ist gezeichnet").toBeGreaterThan(30);
            const goldDavor = await goldPixels(page, anchor, 120);

            // Von jetzt an jedes gezeichnete Bild fragen, ob der Name noch steht: Er darf nicht aus- und wieder eingeblendet werden.
            await page.evaluate((id) => {
                const map = globalThis.avesmapsMap!;
                const seen: number[] = [];
                const ask = (): void => {
                    seen.push(
                        map
                            .queryRenderedFeatures({ layers: ["territory-label"] })
                            .filter((feature) => feature.properties["territory_public_id"] === id).length,
                    );
                };
                (map as unknown as { on(event: string, handler: () => void): void }).on("render", ask);
                (globalThis as unknown as { __nameSeen: number[] }).__nameSeen = seen;
            }, anchor.id);

            // Ein echter Klick auf die Fläche.
            await clickTerritory(page, anchor);
            await settleFrame(page);
            await page.waitForTimeout(800);
            const frames = await page.evaluate(() => (globalThis as unknown as { __nameSeen: number[] }).__nameSeen);
            test.info().annotations.push({
                type: "Messung",
                description: `${fall.name}: ${String(frames.length)} Bilder seit dem Klick, der Name stand in jedem (kleinste Zahl ${String(Math.min(...frames))})`,
            });
            expect(frames.length, "gezeichnete Bilder seit dem Klick").toBeGreaterThan(3);
            expect(Math.min(...frames), "der Name steht in JEDEM Bild: kein Aus- und Einblenden").toBe(1);
            expect(Math.max(...frames), "und nie doppelt").toBe(1);

            // Kein zweites Symbol: weder eine Ebene noch ein Punkt der Auswahl, und die Ebene der Gebietsnamen zeichnet den Namen
            // genau einmal - er wurde weder herausgefiltert noch neu gesetzt.
            const ersatz = await page.evaluate(() => {
                const map = globalThis.avesmapsMap as unknown as {
                    getLayer(id: string): unknown;
                    getStyle(): { sources: Record<string, { data?: { features: unknown[] } }> };
                };
                return {
                    ebene: map.getLayer("area-selection-label") !== undefined,
                    punkte: map.getStyle().sources["area-selection-label"]?.data?.features.length ?? 0,
                };
            });
            expect(ersatz, "keine zweite Beschriftung für das gewählte Gebiet").toEqual({ ebene: false, punkte: 0 });
            expect(await placedCount(page, anchor.id), "gewählt: dasselbe eine Symbol").toBe(1);

            // Derselbe Name an derselben Stelle: Mitte der Tinte (±1 px) und Höhe (gleiche Zeilenzahl).
            // Gemessen wird die Tinte samt Saum (jede Änderung gegenüber dem Grund): Schrift und Saum wechseln die Farbe, der Saum ist rundum gleich breit.
            const gewaehlt = await measureLabelInk(page, LAYER, anchor, {
                only: anchor.id,
                radius: 140,
                withHalo: true,
            });
            expect(gewaehlt.text.pixels, "der Name ist gezeichnet").toBeGreaterThan(30);
            const davor = textBox(ruhig);
            const danach = textBox(gewaehlt);
            test.info().annotations.push({
                type: "Messung",
                description: `${fall.name}: Mitte ungewählt ${davor.x.toFixed(1)}/${davor.y.toFixed(1)} h ${davor.height.toFixed(0)} · gewählt ${danach.x.toFixed(1)}/${danach.y.toFixed(1)} h ${danach.height.toFixed(0)}`,
            });
            expect(Math.abs(danach.x - davor.x), "waagerecht").toBeLessThanOrEqual(1);
            expect(Math.abs(danach.y - davor.y), "senkrecht").toBeLessThanOrEqual(1);
            expect(Math.abs(danach.height - davor.height), "gleiche Zeilenzahl: gleiche Höhe").toBeLessThanOrEqual(1);
            // Ein Name mit Wappen: das Wappen bleibt, wo es stand.
            if (ruhig.icon.pixels > 0) {
                expect(gewaehlt.icon.pixels, "das Wappen bleibt").toBeGreaterThan(200);
                expect(Math.abs(gewaehlt.icon.y1 - ruhig.icon.y1), "Wappen senkrecht").toBeLessThanOrEqual(1);
                expect(Math.abs(centreX(gewaehlt.icon) - centreX(ruhig.icon)), "Wappen waagerecht").toBeLessThanOrEqual(
                    1,
                );
            }

            // Und gelb: Die Schrift trägt die Farbe der Auswahl (der Kanonwert), nicht mehr das dunkle Braun.
            const goldDanach = await goldPixels(page, anchor, 120);
            test.info().annotations.push({
                type: "Messung",
                description: `Bildpunkte in der Farbe der Auswahl um den Namen: ungewählt ${String(goldDavor)}, gewählt ${String(goldDanach)}`,
            });
            expect(goldDanach, "Schrift in der Farbe der Auswahl").toBeGreaterThan(goldDavor + 60);
            const farbe = await page.evaluate(
                (layer) =>
                    (
                        globalThis.avesmapsMap as unknown as { getPaintProperty(l: string, n: string): unknown }
                    ).getPaintProperty(layer, "text-color"),
                LAYER,
            );
            expect(JSON.stringify(farbe)).toContain(GOLD);
            expect(JSON.stringify(farbe)).toContain(anchor.id);
        });
    }

    test("🔴 die Auswahl aufheben: der Name wird wieder dunkel, ohne dass er sich bewegt", async ({ page }) => {
        test.setTimeout(120_000);
        await openMap(page);
        await chooseView(page, "political");
        const anchor = await showName(page, GREIFENFURT);
        const ruhig = await measureLabelInk(page, LAYER, anchor, { only: anchor.id, radius: 140, withHalo: true });
        const goldRuhig = await goldPixels(page, anchor, 120);
        await clickTerritory(page, anchor);
        await settleFrame(page);
        await clearSelection(page);
        await settleFrame(page);
        await page.waitForTimeout(800);
        expect(await placedCount(page, anchor.id)).toBe(1);
        const danach = await measureLabelInk(page, LAYER, anchor, { only: anchor.id, radius: 140, withHalo: true });
        expect(Math.abs(textBox(danach).x - textBox(ruhig).x)).toBeLessThanOrEqual(1);
        expect(Math.abs(textBox(danach).y - textBox(ruhig).y)).toBeLessThanOrEqual(1);
        // Wieder dunkel: nicht mehr Bildpunkte in der Farbe der Auswahl als vorher (das Wappen trägt ein eigenes Gelb).
        expect(await goldPixels(page, anchor, 120)).toBeLessThanOrEqual(goldRuhig + 20);
    });

    test("Schrift größer als bei Legacy: die Tafel nennt mehr als 13,3 px, und der Name steht in der Größe der Tafel mal Faktor des Bandes", async ({
        page,
    }) => {
        expect(POLITICAL.label.sizePx).toBeGreaterThan(13.3);
        await openMap(page);
        await chooseView(page, "political");
        await showName(page, GREIFENFURT);
        const groesse = await page.evaluate(() => {
            const map = globalThis.avesmapsMap as unknown as { getLayoutProperty(l: string, n: string): unknown };
            return map.getLayoutProperty("territory-label", "text-size");
        });
        // Ein Stufenausdruck über dem Band der Ansicht: Band 3 ist die letzte Stufe, der Faktor 1.
        expect(JSON.stringify(groesse)).toContain(String(POLITICAL.label.sizePx));
    });
});
