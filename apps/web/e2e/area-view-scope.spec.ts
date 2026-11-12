import { expect, test, type Page } from "@playwright/test";
import { onPage, settleFrame } from "./map-handle.ts";

/**
 * In jeder Landschaftsansicht ist nur die Fläche dieser Ansicht anklickbar (WI-0083, Betreiber 2026-10-05: „kannst du dafür
 * sorgen, dass immer nur die flächen (derographie, vegetation, topographie) angeklickt werden können, deren ansicht gerade aktiv
 * is. seen und meere sollen in allen ansichten sichtbar sein, aber nur in topographie (und alle) anklickbar.“).
 *
 * 🔴 Zwei Aussagen je Ansicht: was ein Klick trifft, und dass dort, wo niemand teilnimmt, kein Zeiger-Schild und keine Hand
 * erscheinen. Das Wasser bleibt in jeder Ansicht GEZEICHNET - geprüft an den gerenderten Features, nicht am Stil.
 *
 * 🔴 Seit dem Nachtrag (Betreiber 2026-10-05 „ja“) gilt dieselbe Regel für FLÜSSE: Ein Fluss ist Wasser wie ein See, also
 * überall gezeichnet, wählbar nur in Topographie und „Alle“.
 *
 * 🪤 Die Stellen werden gesucht, nicht geraten: Ein Klick nimmt die KLEINSTE Fläche darunter, und am Ochsenwasser liegt eine
 * Insel. Ein Test mit festem Bildpunkt wäre am Telefon rot geworden, ohne dass etwas falsch ist.
 */

/** Die Mitte des Ochsenwassers und ein Punkt im Golf von Perricum (Kartenkoordinaten, Legacy-Bestand). */
const SEE = { x: 597.841, y: 549.016 };
const MEER = { x: 650, y: 480 };

/** Eine Stelle mit Flächen in allen drei Ebenen: Vorgebirge des Kosch / Nablaquell-Wälder. */
const LAND = { x: 450, y: 560 };

/** Gareth am Großen Fluss: dort gibt es eine benannte Flusslinie. */
const FLUSS = { x: 551.625, y: 532.969 };

/** Jede Runde lädt die Seite neu: eine reine Änderung der Adressraute wechselt die Ansicht nicht. */
let round = 0;

async function open(page: Page, layer: string, probe: { x: number; y: number }, zoom = 6.5): Promise<void> {
    round += 1;
    await page.goto(
        `/?r=${String(round)}#x=${String(probe.x)}&y=${String(probe.y)}&z=${String(zoom)}&series=original&view=landscapes&layer=${layer}`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
}

/** Die Flächenlayer im Stil, aus denen eine wählbare Fläche kommen kann. */
const AREA_LAYERS = (page: Page): Promise<string[]> =>
    page.evaluate(() =>
        (globalThis.avesmapsMap?.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter(
                // 🪤 Das Wasser steht in ZWEI Füllungen, seit das Meer als Grund unter den Landschaftsfüllungen liegt
                // (Nachtrag zu WI-0083): der See oben, das Meer unten. Wer nur die eine fragt, findet das Meer nicht.
                (id) => id === "gewaesser-flaeche" || id === "gewaesser-grund" || id.startsWith("landscape-fill-"),
            ),
    );

/** Welche Arten an dieser Stelle gezeichnet sind. */
async function drawnAt(page: Page, at: { x: number; y: number }): Promise<string[]> {
    const layers = await AREA_LAYERS(page);
    if (layers.length === 0) return [];
    return page.evaluate(
        ({ point, ids }) => {
            // Punkte stehen in diesem Spec in Seitenkoordinaten; gefragt wird die Karte in ihren eigenen.
            const box = globalThis.avesmapsMap?.getCanvas().getBoundingClientRect();
            return (
                globalThis.avesmapsMap
                    ?.queryRenderedFeatures([point.x - (box?.left ?? 0), point.y - (box?.top ?? 0)], { layers: ids })
                    .map((feature) => String(feature.properties["region_type"])) ?? []
            );
        },
        { point: at, ids: layers },
    );
}

/**
 * Eine Stelle im Bild, an der eine Fläche dieser Art die KLEINSTE unter dem Zeiger ist - also die, die ein Klick nimmt
 * (`nextCandidate`). So steht fest, was dort getroffen würde, ohne eine Annahme über Zoom, Fenstergröße und Nachbarflächen.
 */
async function smallestAt(page: Page, type: string): Promise<{ x: number; y: number }> {
    const layers = await AREA_LAYERS(page);
    const found = await page.evaluate(
        ({ ids, wanted }) => {
            const map = globalThis.avesmapsMap;
            if (!map) throw new Error("map handle missing");
            const canvas = map.getCanvas();
            const middle = globalThis.avesmapsVisibleArea!.centre();
            const size = (feature: { properties: Record<string, unknown> }): number => {
                const raw = Number(feature.properties["area"]);
                return Number.isFinite(raw) && raw > 0 ? raw : Number.POSITIVE_INFINITY;
            };
            let best: { x: number; y: number } | undefined;
            for (let y = 90; y < canvas.clientHeight - 90; y += 6) {
                for (let x = Math.max(90, Math.round(middle.x) - 280); x < canvas.clientWidth - 60; x += 6) {
                    const hits = map.queryRenderedFeatures([x, y], { layers: ids });
                    if (hits.length === 0) continue;
                    const smallest = hits.reduce((a, b) => (size(a) <= size(b) ? a : b));
                    if (String(smallest.properties["region_type"]) !== wanted) continue;
                    const point = { x, y };
                    if (
                        !best ||
                        Math.hypot(point.x - middle.x, point.y - middle.y) <
                            Math.hypot(best.x - middle.x, best.y - middle.y)
                    ) {
                        best = point;
                    }
                }
            }
            return best;
        },
        { ids: layers, wanted: type },
    );
    expect(found, `eine Stelle, an der „${type}“ die kleinste Fläche ist`).toBeDefined();
    return onPage(page, found as { x: number; y: number });
}

/** Eine Stelle, an der NUR Flächen dieser Art gezeichnet sind: dort nimmt außer ihnen niemand teil. */
async function onlyAt(page: Page, type: string): Promise<{ x: number; y: number }> {
    const layers = await AREA_LAYERS(page);
    const found = await page.evaluate(
        ({ ids, wanted }) => {
            const map = globalThis.avesmapsMap;
            if (!map) throw new Error("map handle missing");
            const canvas = map.getCanvas();
            const middle = globalThis.avesmapsVisibleArea!.centre();
            let best: { x: number; y: number } | undefined;
            for (let y = 90; y < canvas.clientHeight - 90; y += 6) {
                for (let x = Math.max(90, Math.round(middle.x) - 280); x < canvas.clientWidth - 60; x += 6) {
                    const types = map
                        .queryRenderedFeatures([x, y], { layers: ids })
                        .map((feature) => String(feature.properties["region_type"]));
                    if (types.length === 0 || types.some((type) => type !== wanted)) continue;
                    const point = { x, y };
                    if (
                        !best ||
                        Math.hypot(point.x - middle.x, point.y - middle.y) <
                            Math.hypot(best.x - middle.x, best.y - middle.y)
                    ) {
                        best = point;
                    }
                }
            }
            return best;
        },
        { ids: layers, wanted: type },
    );
    expect(found, `eine Stelle mit nur „${type}“ im Bild`).toBeDefined();
    return onPage(page, found as { x: number; y: number });
}

const chosen = (page: Page): Promise<{ kind?: string; type?: string; name?: string | null } | undefined> =>
    page.evaluate(() => {
        const area = globalThis.avesmapsAreaSelection?.();
        return area ? { kind: area.kind, type: area.type, name: area.name } : undefined;
    });

async function hover(page: Page, at: { x: number; y: number }): Promise<string> {
    await page.mouse.move(at.x - 25, at.y - 25);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.waitForTimeout(400);
    return page.evaluate(() => globalThis.avesmapsMap?.getCanvas().style.cursor ?? "");
}

for (const layer of ["alle", "topographie"] as const) {
    test(`🔴 ${layer}: See und Meer sind gezeichnet und wählbar`, async ({ page }) => {
        for (const [what, probe] of [
            ["see", SEE],
            ["meer", MEER],
        ] as const) {
            await open(page, layer, probe);
            const at = await smallestAt(page, what);
            expect(await drawnAt(page, at), `${what} gezeichnet`).toContain(what);
            expect(await hover(page, at), `${what}: die Hand`).toBe("pointer");
            await page.mouse.click(at.x, at.y);
            await expect.poll(async () => (await chosen(page))?.type).toBe(what);
        }
    });
}

for (const layer of ["vegetation", "derographisch"] as const) {
    test(`🔴 ${layer}: See und Meer bleiben gezeichnet, nehmen aber nicht teil`, async ({ page }) => {
        for (const [what, probe] of [
            ["see", SEE],
            ["meer", MEER],
        ] as const) {
            await open(page, layer, probe);
            // Die Stelle, an der ein Klick das Wasser nähme, wenn es teilnähme: die kleinste Fläche darunter.
            const at = await smallestAt(page, what);
            // Sichtbar bleibt es: die Art steht in den gerenderten Features.
            expect(await drawnAt(page, at), `${what} gezeichnet`).toContain(what);
            await page.mouse.click(at.x, at.y);
            await page.waitForTimeout(500);
            // Gewählt ist es nicht: entweder die Fläche dieser Ebene darunter, oder nichts.
            expect((await chosen(page))?.type, `${what} ist nicht gewählt`).not.toBe(what);
        }
    });

    test(`🔴 ${layer}: über dem Meer gibt es kein Zeiger-Schild und keine Hand`, async ({ page }) => {
        // Am Meer liegt keine Fläche dieser Ebene: Dort nimmt niemand teil, und der Klick fällt in die freie Karte.
        await open(page, layer, MEER);
        const at = await onlyAt(page, "meer");
        expect(await drawnAt(page, at)).toContain("meer");
        expect(await hover(page, at)).toBe("");
        await expect(page.getByTestId("pointer-hint")).toHaveCount(0);
        await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(500);
        expect(await chosen(page)).toBeUndefined();
    });
}

test("🔴 Vegetation: ein Klick trifft die Vegetationsfläche, nicht die Ebene darunter", async ({ page }) => {
    await open(page, "vegetation", LAND);
    const at = await smallestAt(page, "wald");
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await chosen(page))?.type).toBe("wald");
});

test("🔴 Topographie: ein Klick trifft die topographische Fläche", async ({ page }) => {
    await open(page, "topographie", LAND);
    const at = await smallestAt(page, "huegelland");
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await chosen(page))?.type).toBe("huegelland");
});

test("🔴 Derographisch: ein Klick trifft die derographische Fläche", async ({ page }) => {
    await open(page, "derographisch", LAND);
    const at = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const point = globalThis.avesmapsVisibleArea!.centre();
        const box = map.getCanvas().getBoundingClientRect();
        return { x: Math.round(box.left + point.x), y: Math.round(box.top + point.y) };
    });
    const types = await drawnAt(page, at);
    expect(types.length, "eine derographische Fläche unter der Mitte").toBeGreaterThan(0);
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await chosen(page)) !== undefined).toBe(true);
    // Derographische Flächen tragen keine Landschaftsart oder eine der eigenen Ebene.
    expect(["", "region", "kontinent", "inselgruppe", "sonstiges"]).toContain((await chosen(page))?.type);
});

test("🔴 Klimazonen: nur das Band, auch über dem Meer", async ({ page }) => {
    await open(page, "klima", MEER);
    const at = await onlyAt(page, "meer");
    expect(await drawnAt(page, at), "das Meer steht auch hier").toContain("meer");
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind)).toBe("climate");
    expect(await chosen(page)).toBeUndefined();
});

/**
 * Eine benannte Flusslinie im Bild, mit derselben Reichweite, mit der die Auswahl nach einer dünnen Linie fragt.
 *
 * 🪤 Die Stelle muss am Zeiger ERREICHBAR sein: Am oberen Rand liegen Fächer und Suche über der Karte, und ein Klick
 * dort landet im Bauteil, nicht auf dem Fluss (gemessen 2026-10-05 bei (998, 120): Cursor blieb leer). Geprüft wird
 * deshalb mit `elementFromPoint`, dass dort die Leinwand der Karte vorn liegt.
 */
const riverSpot = (page: Page): Promise<{ x: number; y: number } | undefined> =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const canvas = map.getCanvas();
        const box = canvas.getBoundingClientRect();
        const free = (x: number, y: number): boolean => document.elementFromPoint(box.left + x, box.top + y) === canvas;
        // 🔴 Seit WI-0090 ist auch eine STRASSE wählbar, und zwar in jeder Ansicht, in der sie gezeichnet ist. Eine
        // Stelle, an der neben dem Fluss eine Straße liegt, bewiese hier also nichts: Der Klick nähme die Straße, und
        // der Test läse das als „der Fluss nimmt teil“. Gesucht wird deshalb eine Stelle mit NUR Wasser - gefragt wird
        // die Trefferebene, dieselbe, die auch der Besitzer fragt.
        const strassen = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => id.startsWith("path-hit-") && !id.includes("flussweg"));
        for (let y = 140; y < canvas.clientHeight - 140; y += 6) {
            for (let x = 400; x < canvas.clientWidth - 140; x += 6) {
                if (!free(x, y)) continue;
                const box5: [[number, number], [number, number]] = [
                    [x - 5, y - 5],
                    [x + 5, y + 5],
                ];
                const hits = map.queryRenderedFeatures(box5, {
                    layers: ["path-center-flussweg", "path-center-flussweg-bach"],
                });
                if (!hits.some((hit) => String(hit.properties["name"] ?? "").trim() !== "")) continue;
                if (strassen.length > 0 && map.queryRenderedFeatures(box5, { layers: strassen }).length > 0) continue;
                return { x: box.left + x, y: box.top + y };
            }
        }
        return undefined;
    });

/**
 * 🔴 Der Fluss folgt dem Wasser (Nachtrag zu WI-0083, Betreiber 2026-10-05 „ja“): gezeichnet samt Namen in jeder
 * Ansicht, wählbar nur in Topographie und „Alle“. Gareth liegt am Großen Fluss.
 */
for (const layer of ["alle", "topographie"] as const) {
    test(`🔴 ${layer}: der Fluss ist wählbar`, async ({ page }) => {
        await open(page, layer, FLUSS, 7);
        const river = await riverSpot(page);
        expect(river, "ein benannter Fluss im Bild").toBeDefined();
        const at = river as { x: number; y: number };
        expect(await hover(page, at), "die Hand über dem Fluss").toBe("pointer");
        await page.mouse.click(at.x, at.y);
        await expect.poll(() => page.evaluate(() => globalThis.avesmapsAreaSelection?.()?.kind)).toBe("path");
    });
}

for (const layer of ["vegetation", "derographisch", "klima"] as const) {
    test(`🔴 ${layer}: der Fluss bleibt gezeichnet, nimmt aber nicht teil`, async ({ page }) => {
        await open(page, layer, FLUSS, 7);
        const river = await riverSpot(page);
        expect(river, "der Fluss ist gezeichnet").toBeDefined();
        const at = river as { x: number; y: number };
        await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(500);
        expect((await chosen(page))?.kind, "kein Fluss gewählt").not.toBe("path");
    });
}

/**
 * 🔴 „Was ist hier?“ nennt nur die aktive Ansicht (Nachtrag zu WI-0083, Betreiber 2026-10-05 „ja“): Der Kartenpunkt
 * nimmt die teilnehmenden Ebenen mit zum Server - gemessen an der ADRESSE, die der Browser wirklich fragt, und an dem
 * Subject, das die Auswahl hält. Dass der Server danach filtert, steht in `apps/server/test/subjects.test.ts`.
 *
 * 🪤 Gemessen am Kontextmenü - und seit WI-0108 ist das der EINZIGE Weg zum Kartenpunkt: „Was ist hier?“ ist ein
 * Eintrag dieses Menüs, am Rechner wie am Finger, und beide gehen durch dieselbe Öffnungsnaht (`openPoint`). Der
 * eigene Besitzer `map-point` (Rang 10) ist weg. Der lange Druck am Finger steht in der Telefonfassung.
 */
for (const [layer, expected] of [
    ["vegetation", "vegetation"],
    ["topographie", "topographie"],
    ["alle", "derographisch,vegetation,topographie"],
    ["klima", "klima"],
] as const) {
    test(`🔴 ${layer}: „Was ist hier?“ fragt nach genau dieser Ansicht`, async ({ page }) => {
        await open(page, layer, LAND);
        const at = await page.evaluate(() => {
            const map = globalThis.avesmapsMap;
            if (!map) throw new Error("map handle missing");
            const point = globalThis.avesmapsVisibleArea!.centre();
            const box = map.getCanvas().getBoundingClientRect();
            return { x: Math.round(box.left + point.x), y: Math.round(box.top + point.y) };
        });
        await page.mouse.click(at.x, at.y, { button: "right" });
        await expect(page.getByTestId("map-context-menu")).toBeVisible();
        const asked = page.waitForRequest((request) => request.url().includes("/api/subjects/map-point"), {
            timeout: 15_000,
        });
        await page.getByTestId("context-what-is-here").click();
        const url = new URL((await asked).url());
        expect(url.searchParams.get("layers"), `${layer}: die Ebenen der Ansicht`).toBe(expected);
        // Und derselbe Hinweis steht am gewählten Subject: Er bindet die Antwort an diese Ansicht.
        await expect.poll(() => page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind)).toBe("mapPoint");
        expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.layers)).toEqual(expected.split(","));
    });
}

/** 🪤 Ohne Landschaftsebene (Standard, Politisch, Kraftlinien, Nur Karte) fragt der Punkt wie bisher, ohne `layers`. */
test("🪤 in der Standardansicht fragt „Was ist hier?“ ohne Ebenen - wie vor der Änderung", async ({ page }) => {
    round += 1;
    await page.goto(`/?r=${String(round)}#x=${String(LAND.x)}&y=${String(LAND.y)}&z=6&series=original&view=standard`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    const at = await page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const point = globalThis.avesmapsVisibleArea!.centre();
        const box = map.getCanvas().getBoundingClientRect();
        return { x: Math.round(box.left + point.x), y: Math.round(box.top + point.y) };
    });
    await page.mouse.click(at.x, at.y, { button: "right" });
    await expect(page.getByTestId("map-context-menu")).toBeVisible();
    const asked = page.waitForRequest((request) => request.url().includes("/api/subjects/map-point"), {
        timeout: 15_000,
    });
    await page.getByTestId("context-what-is-here").click();
    expect(new URL((await asked).url()).searchParams.get("layers")).toBeNull();
});
