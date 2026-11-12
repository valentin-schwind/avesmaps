import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { settleFrame } from "./map-handle.ts";

/**
 * Die Maßstabsleiste im laufenden Browser (WI-0096).
 *
 * 🔴 Hier wird WIRKLICH gezoomt und die Leiste abgelesen - die Rechnung allein prüft
 * `test/scale-bar.test.ts`. Was nur hier zu messen ist: dass die Leiste an ihrer eigenen Bildzeile misst,
 * dass die Zahl beim stufenlosen Zoom nicht flackert, dass sie mittig steht und über den Toast steigt -
 * und dass sie **ohne Fläche** auf hellem WIE dunklem Kartengrund lesbar bleibt (Betreiber 2026-10-07:
 * „die dynamische skala zentriert, ohne hintergrund, schatten wie bei legacy").
 */

/**
 * Der Pfad des Toast-Moduls, absichtlich als Variable: Ein Stringliteral würde TypeScript dazu bringen,
 * eine Vite-Adresse wie ein Modul des Prüfprojekts aufzulösen. Zur Laufzeit ist es dasselbe Modul, das die
 * Anwendung selbst benutzt - sonst stünde kein Toast im Dokument.
 */
const TOAST_MODULE = "/src/feedback/toast.ts";

const VIEW = "#x=512&y=512&z=4&series=original&view=standard&layer=alle";

/**
 * Eine helle Stelle der Original-Rasterkarte in der Standardansicht.
 *
 * WI-0115: Der bisherige Punkt 450/560 ist mit geladenen Rasterkacheln dunkel (0,108),
 * auch ohne Landschaftsfüllung. Hier beträgt der gemessene Randmedian 0,878. Die
 * Voraussetzung > 0,75 bleibt ausdrücklich geprüft; der Rasterinhalt ist kein fester Papierton.
 */
const HELL = { x: 550, y: 350 };

/**
 * Eine dunkle Stelle der Original-Rasterkarte in derselben Ansicht: schon ohne Landschaftsfüllung dunkel (WI-0115, gemessen
 * 0,108). Bis 2026-10-19 stand der dunkle Grund in der Vegetationsansicht, die allein deckend gezeichnet wurde; seit dem Wort des
 * Betreibers („B“: Vegetation auch allein als Lasur wie die anderen Ebenen) trägt keine Landschaftsfläche mehr einen dunklen Grund.
 */
const DUNKEL = { x: 450, y: 560 };

async function openMap(page: Page): Promise<void> {
    await page.goto(`/${VIEW}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
}

interface Reading {
    label: string;
    miles: number;
    width: number;
    centre: number;
    bottom: number;
    screenCentre: number;
}

async function readBar(page: Page): Promise<Reading> {
    return page.evaluate(() => {
        const host = document.querySelector<HTMLElement>('[data-testid="scale-bar"]');
        const bar = document.querySelector<HTMLElement>('[data-testid="scale-bar-bar"]');
        const label = document.querySelector<HTMLElement>('[data-testid="scale-bar-label"]');
        if (!host || !bar || !label) throw new Error("scale bar missing");
        const box = host.getBoundingClientRect();
        const text = label.textContent ?? "";
        return {
            label: text,
            miles: Number(text.replace(/[^0-9]/g, "")),
            width: Math.round(bar.getBoundingClientRect().width),
            centre: Math.round((box.left + box.right) / 2),
            bottom: Math.round(box.bottom),
            screenCentre: Math.round(window.innerWidth / 2),
        };
    });
}

async function setZoom(page: Page, zoom: number): Promise<void> {
    await page.evaluate((level) => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        map.jumpTo({ zoom: level });
    }, zoom);
    // Zwei Bilder: eines für MapLibre, eines für die Leiste, die im nächsten Bild misst.
    await settleFrame(page);
    await settleFrame(page);
}

/**
 * Die Kartenstelle `to` genau UNTER die Leiste fahren.
 *
 * 💣 Nicht in die Bildmitte: Die Leiste steht am unteren Rand, und was dort liegt, entscheidet über ihre
 * Lesbarkeit. Ein erster Anlauf fuhr das offene Meer in die Mitte und maß unter der Leiste den blanken
 * Papierton der Grundkarte (0,866) - der Fall hätte „dunkler Grund" behauptet und hellen gemessen.
 * Deshalb: hinfahren, nachsehen, was unter der Leiste liegt, und die Kamera um die Differenz schieben.
 */
async function placeUnderBar(page: Page, to: { x: number; y: number }, zoom: number): Promise<void> {
    await page.evaluate(
        async ({ target, level }) => {
            const map = globalThis.avesmapsMap;
            const projection = globalThis.avesmapsRenderProjection;
            if (!map || !projection) throw new Error("map or projection handle missing");
            map.jumpTo({ center: projection.toRenderLngLat(target), zoom: level });
            await new Promise<void>((resolve) => map.once("idle", resolve));
        },
        { target: to, level: zoom },
    );
    await settleFrame(page);
    await page.evaluate(async (target) => {
        const map = globalThis.avesmapsMap;
        const projection = globalThis.avesmapsRenderProjection;
        const host = document.querySelector<HTMLElement>('[data-testid="scale-bar"]');
        if (!map || !projection || !host) throw new Error("handles missing");
        const frame = map.getCanvas().getBoundingClientRect();
        const box = host.getBoundingClientRect();
        const under = projection.fromRenderLngLat(
            map.unproject([(box.left + box.right) / 2 - frame.left, (box.top + box.bottom) / 2 - frame.top]),
        );
        const centre = projection.fromRenderLngLat(map.getCenter());
        map.jumpTo({
            center: projection.toRenderLngLat({
                x: centre.x + (target.x - under.x),
                y: centre.y + (target.y - under.y),
            }),
        });
        await new Promise<void>((resolve) => map.once("idle", resolve));
    }, to);
    await settleFrame(page);
    await settleFrame(page);
}

/** Relative Leuchtdichte nach WCAG. */
function luminance(r: number, g: number, b: number): number {
    const channel = (value: number): number => {
        const v = value / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

interface Legibility {
    /** Die hellste Stelle im Ausschnitt: die Schrift beziehungsweise der Strich. */
    ink: number;
    /** Die dunkelste: der Saum, den `shadow.mapInk` zieht. */
    halo: number;
    /** Der Kartengrund ringsum, als Median des Randstreifens des Ausschnitts. */
    ground: number;
    contrast: number;
}

/**
 * Die Lesbarkeit der Leiste, aus den WIRKLICH gezeichneten Bildpunkten gemessen.
 *
 * 💣 Nicht aus den Farbwerten des Stilblatts gerechnet: Die Scheibe ist weg, also entscheidet, was der
 * Browser über der Karte zeichnet - weiße Tinte, schwarzer Saum, Karte darunter. Nur ein Bild zeigt das.
 */
async function legibility(page: Page): Promise<Legibility> {
    const box = await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>('[data-testid="scale-bar"]');
        if (!host) throw new Error("scale bar missing");
        const rect = host.getBoundingClientRect();
        return {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
        };
    });
    const margin = 8;
    const shot = await page.screenshot({
        clip: { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin },
    });
    const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let ink = 0;
    let halo = 1;
    const edge: number[] = [];
    for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
            const at = (y * info.width + x) * info.channels;
            const value = luminance(data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0);
            if (value > ink) ink = value;
            if (value < halo) halo = value;
            // Der Randstreifen trägt keine Tinte: Dort steht nur die Karte.
            if (x < 2 || y < 2 || x >= info.width - 2 || y >= info.height - 2) edge.push(value);
        }
    }
    edge.sort((a, b) => a - b);
    const ground = edge[Math.floor(edge.length / 2)] ?? 0;
    return { ink, halo, ground, contrast: contrast(ink, halo) };
}

test.describe("Maßstabsleiste", () => {
    test("zeigt bei z4 zwanzig Meilen und misst sie so breit, wie die Karte sie zeichnet", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openMap(page);
        const bar = await readBar(page);
        expect(bar.label).toBe("20 Meilen");

        // Gegenprobe ohne die Leiste: zwei Punkte, zwanzig Meilen auseinander (20/3 Karteneinheiten),
        // an ihrer eigenen Bildzeile gemessen.
        const expected = await page.evaluate(() => {
            const map = globalThis.avesmapsMap;
            const projection = globalThis.avesmapsRenderProjection;
            const host = document.querySelector<HTMLElement>('[data-testid="scale-bar-bar"]');
            if (!map || !projection || !host) throw new Error("handles missing");
            const frame = map.getCanvas().getBoundingClientRect();
            const box = host.getBoundingClientRect();
            const row = box.bottom - frame.top;
            const start = map.unproject([box.left - frame.left, row]);
            const here = projection.fromRenderLngLat(start);
            const there = projection.toRenderLngLat({ x: here.x + 20 / 3, y: here.y });
            return Math.abs(map.project(there).x - map.project(start).x);
        });
        expect(Math.abs(bar.width - expected)).toBeLessThanOrEqual(1);
    });

    test("steht auf der Bildschirmmitte - auch mit offenem Planer, wie Legacys 50vw", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openMap(page);
        const tab = page.getByTestId("route-planner-tab");
        await expect(tab).toHaveAttribute("aria-expanded", "true");
        const offen = await readBar(page);
        expect(Math.abs(offen.centre - offen.screenCentre)).toBeLessThanOrEqual(1);

        await tab.click();
        await expect(tab).toHaveAttribute("aria-expanded", "false");
        await settleFrame(page);
        await settleFrame(page);
        const zu = await readBar(page);
        expect(Math.abs(zu.centre - zu.screenCentre)).toBeLessThanOrEqual(1);
        // Am freien Rand steht sie im Kartenrand des Hauses (`--space-10`, 12 px).
        const edge = await page.evaluate(() => window.innerHeight);
        expect(edge - zu.bottom).toBe(12);
    });

    test("trägt keine Fläche: kein Grund, kein Rahmen, kein Panelschatten, und sie nimmt keinen Klick", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openMap(page);
        const look = await page.evaluate(() => {
            const host = document.querySelector<HTMLElement>('[data-testid="scale-bar"]');
            const bar = document.querySelector<HTMLElement>('[data-testid="scale-bar-bar"]');
            const label = document.querySelector<HTMLElement>('[data-testid="scale-bar-label"]');
            if (!host || !bar || !label) throw new Error("scale bar missing");
            const style = getComputedStyle(host);
            return {
                background: style.backgroundColor,
                border: style.borderStyle,
                boxShadow: style.boxShadow,
                ink: style.color,
                pointerEvents: style.pointerEvents,
                barFilter: getComputedStyle(bar).filter,
                labelShadow: getComputedStyle(label).textShadow,
                // Was ein Klick in der Mitte der Leiste wirklich trifft.
                hit:
                    document.elementFromPoint(
                        (host.getBoundingClientRect().left + host.getBoundingClientRect().right) / 2,
                        (host.getBoundingClientRect().top + host.getBoundingClientRect().bottom) / 2,
                    )?.tagName ?? "",
            };
        });
        expect(look.background).toBe("rgba(0, 0, 0, 0)");
        expect(look.border).toBe("none");
        expect(look.boxShadow).toBe("none");
        expect(look.ink).toBe("rgb(255, 255, 255)");
        expect(look.pointerEvents).toBe("none");
        // Legacys Saum, aus `shadow.mapInk`: am Balken als Filter, am Text als Textschatten.
        expect(look.barFilter).toBe("drop-shadow(rgba(0, 0, 0, 0.95) 0px 1px 2px)");
        expect(look.labelShadow).toBe("rgba(0, 0, 0, 0.95) 0px 1px 2px");
        // 🔴 In der Bildmitte ist das keine Kosmetik: Der Klick muss an der Karte ankommen.
        expect(look.hit).toBe("CANVAS");
    });

    test("bleibt ohne Fläche lesbar - auf hellem UND auf dunklem Kartengrund", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openMap(page);
        await page.getByTestId("route-planner-tab").click();
        await settleFrame(page);

        await placeUnderBar(page, HELL, 5);
        const hell = await legibility(page);

        // Der dunkle Grund ist die Rasterkarte selbst (`DUNKEL`), in derselben Ansicht wie der helle.
        await placeUnderBar(page, DUNKEL, 5);
        const dunkel = await legibility(page);
        await test.info().attach("massstab-lesbarkeit", {
            body: JSON.stringify({ hell: { point: HELL, ...hell }, dunkel: { point: DUNKEL, ...dunkel } }),
            contentType: "application/json",
        });

        // 🔴 Die beiden Gründe sind wirklich verschieden - sonst hätte der Fall nichts gemessen. Die
        // Schwellen sind an der Karte gemessen, nicht gesetzt: helle Stelle der Rasterkarte 0,878, dunkle 0,108 (WI-0115).
        expect(hell.ground, `heller Grund ${hell.ground.toFixed(3)}`).toBeGreaterThan(0.75);
        expect(dunkel.ground, `dunkler Grund ${dunkel.ground.toFixed(3)}`).toBeLessThan(0.55);
        expect(
            hell.ground - dunkel.ground,
            `Abstand der Gründe ${(hell.ground - dunkel.ground).toFixed(3)}`,
        ).toBeGreaterThan(0.3);

        for (const [name, found] of [
            ["hell", hell],
            ["dunkel", dunkel],
        ] as const) {
            // Die Tinte ist weiß und der Saum trägt sie: auf beiden Gründen dasselbe Verhältnis.
            expect(found.ink, `${name}: Tinte ${found.ink.toFixed(3)}`).toBeGreaterThan(0.8);
            expect(found.halo, `${name}: Saum ${found.halo.toFixed(3)}`).toBeLessThan(0.25);
            expect(found.contrast, `${name}: Kontrast ${found.contrast.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        }

        // 🔴 Der eigentliche Punkt nach dem Wegfall der Scheibe: Was trennt die Leiste vom GRUND?
        // Auf hellem Grund ist es der Saum, auf dunklem die Tinte - je einer von beiden trägt immer.
        const gegenGrund = (found: Legibility): number =>
            Math.max(contrast(found.ink, found.ground), contrast(found.halo, found.ground));
        expect(
            gegenGrund(hell),
            `hell: der Saum gegen den Grund ${contrast(hell.halo, hell.ground).toFixed(2)}`,
        ).toBeGreaterThanOrEqual(3);
        expect(
            gegenGrund(dunkel),
            `dunkel: die Tinte gegen den Grund ${contrast(dunkel.ink, dunkel.ground).toFixed(2)}`,
        ).toBeGreaterThanOrEqual(3);
    });

    test("steigt über den Toast und kehrt an den Kartenrand zurück", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openMap(page);
        const ruhe = await readBar(page);

        const show = async (text: string): Promise<void> => {
            await page.evaluate(
                async ({ message, module }) => {
                    const toast = (await import(/* @vite-ignore */ module)) as {
                        showToast: (t: string, tone: string, ms: number) => void;
                    };
                    toast.showToast(message, "normal", 30_000);
                },
                { message: text, module: TOAST_MODULE },
            );
            await page.waitForTimeout(400);
        };
        const gap = async (): Promise<number> =>
            page.evaluate(() => {
                const host = document.querySelector<HTMLElement>('[data-testid="scale-bar"]');
                const toast = document.querySelector<HTMLElement>('[data-testid="toast"]');
                if (!host || !toast) throw new Error("scale bar or toast missing");
                return Math.round(toast.getBoundingClientRect().top - host.getBoundingClientRect().bottom);
            });

        await show("Kurze Meldung.");
        // Legacys Luft über dem, worüber die Leiste steigt: 6 px, gemessen statt gerechnet. Sie fährt
        // dorthin (140 ms), also wird gemessen, wo sie zum Stehen kommt.
        await expect.poll(gap, { timeout: 5_000 }).toBe(6);
        const kurz = await readBar(page);
        expect(kurz.bottom, "die Leiste ist gestiegen").toBeLessThan(ruhe.bottom);

        // Der Toast wächst mit seinem Text, während er schon steht - der Hub führt nach.
        await show(
            "Eine deutlich längere Meldung, die über mehrere Zeilen läuft und den Kasten wachsen lässt, damit der Hub sich mitbewegt.",
        );
        await expect.poll(gap, { timeout: 5_000 }).toBe(6);
        const lang = await readBar(page);
        expect(lang.bottom, "sie ist mit dem Toast weiter gestiegen").toBeLessThan(kurz.bottom);

        await page.evaluate(async (module) => {
            const toast = (await import(/* @vite-ignore */ module)) as { hideToast: () => void };
            toast.hideToast();
        }, TOAST_MODULE);
        await expect.poll(async () => (await readBar(page)).bottom, { timeout: 5_000 }).toBe(ruhe.bottom);
    });

    test("wechselt die Zahl über eine ganze Zoomstufe höchstens einmal - die Breite läuft mit", async ({ page }) => {
        test.setTimeout(300_000);
        await page.setViewportSize({ width: 1280, height: 900 });
        await openMap(page);
        // 🔴 Der Kern des Auftrags: Unser Zoom rastet nicht. Gemessen in 0,1er Schritten, also auf
        // Zwischenständen, die Legacy gar nicht kennt.
        for (let base = 2; base <= 7; base += 1) {
            const labels = new Set<string>();
            const widths: number[] = [];
            for (let step = 0; step <= 10; step += 1) {
                await setZoom(page, base + step / 10);
                const bar = await readBar(page);
                labels.add(bar.label);
                widths.push(bar.width);
                expect(bar.width, `z${String(base + step / 10)}`).toBeLessThanOrEqual(130);
                expect(bar.width).toBeGreaterThanOrEqual(52);
            }
            expect(
                labels.size,
                `z${String(base)} bis z${String(base + 1)}: ${[...labels].join(" / ")}`,
            ).toBeLessThanOrEqual(2);
            // Innerhalb einer Sprosse wächst die Breite; sie springt nur dort zurück, wo die Zahl wechselt.
            const fallbacks = widths.filter((width, index) => index > 0 && width < (widths[index - 1] ?? 0)).length;
            expect(fallbacks).toBeLessThanOrEqual(labels.size - 1);
        }
    });

    test("steht am Telefon mittig und niemandem im Weg", async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 780 });
        await openMap(page);
        const box = await page.evaluate(() => {
            const host = document.querySelector<HTMLElement>('[data-testid="scale-bar"]');
            const corner = document.querySelector<HTMLElement>(".corner:not(.corner--top)");
            if (!host || !corner) throw new Error("scale bar or corner missing");
            const a = host.getBoundingClientRect();
            const b = corner.getBoundingClientRect();
            const links = document.querySelector<HTMLElement>(".corner-links");
            if (!links) throw new Error("corner links missing");
            const c = links.getBoundingClientRect();

            return {
                right: Math.round(a.right),
                centre: Math.round((a.left + a.right) / 2),
                screenCentre: Math.round(window.innerWidth / 2),
                cornerLeft: Math.round(b.left),
                linksLeft: Math.round(c.left),
                linksTop: Math.round(c.top),
                bottom: Math.round(a.bottom),
                height: window.innerHeight,
            };
        });
        expect(Math.abs(box.centre - box.screenCentre), JSON.stringify(box)).toBeLessThanOrEqual(1);
        // 🪤 Sie FÄHRT nach oben (140 ms): gemessen wird, wo sie zum Stehen kommt, nicht wo sie gerade ist.
        await expect
            .poll(async () => (await readBar(page)).bottom, { timeout: 5_000 })
            .toBeLessThanOrEqual(box.linksTop - 6);
        const steht = await readBar(page);
        // 🔴 Bei 360 px schneidet die mittige Leiste den Eckbund waagerecht - wie in Legacy. Gelöst wird
        // das wie dort: Sie STEIGT über die Verweiszeile, statt zur Seite zu weichen (Betreiber in Legacy
        // 11.08.2026: „schueb nach oben, aber nur ueber die zwei buttons").
        expect(box.right, "sie schneidet den Bund waagerecht").toBeGreaterThan(box.linksLeft);
        expect(box.linksTop - steht.bottom, "Legacys 6 px Luft").toBe(6);
    });
});
