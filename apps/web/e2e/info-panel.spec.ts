import { expect, test, type Page, type Route } from "@playwright/test";
import { clickMap, EDITOR_MODE, GARETH, onPage, openMap, selectedPlace, settleFrame, showPlace } from "./map-handle.ts";
import { expectTooltipLook } from "./map-tooltip-look.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";
import { openStageGroups } from "./stage-groups.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Das Infopanel und die Auswahl am echten Stack (WI-0063 P5): Klick auf Ort und Fläche, die Hülle am rechten Rand, die
 * Escape-Kaskade, Hover, die Leertaste, das Kontextmenü „Was ist hier?“ und die Legacy-Objektlinks.
 *
 * 🪤 Gemessen wird an der SICHTBAREN Mitte (`avesmapsVisibleArea.centre()`, bis WI-0218 die projizierte Kartenmitte), nicht an der Canvasmitte: Am Rechner steht links
 * der Planer, und mit dem Panel kommt rechts ein zweiter Rand dazu (AGENTS.md „Die Kamera“).
 */

const subject = (page: Page): Promise<{ kind: string; id?: string; x?: number; y?: number } | undefined> =>
    page.evaluate(() => globalThis.avesmapsSelectedSubject?.());

/** Wo ein Punkt der Karte im Fenster liegt. */
async function screenOf(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const box = await page.getByTestId("map").boundingBox();
    const at = await page.evaluate(
        (target) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(target)),
        point,
    );
    return { x: (box?.x ?? 0) + at.x, y: (box?.y ?? 0) + at.y };
}

async function clickGareth(page: Page): Promise<void> {
    await showPlace(page, GARETH, 5);
    const at = await screenOf(page, GARETH);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
}

/**
 * Eine freie Stelle der sichtbaren Karte: zwischen Planer und Panel, ohne Ort und ohne Route darunter - und auch nicht in ihrer Nähe.
 * Die Besitzer fragen mit einem Hof um den Zeiger (`context.features(area)`), nicht an einem Punkt: Ein Punkt, der selbst leer ist, aber
 * neben einer Marke liegt, trifft sie beim Klick. Unter Last, mit anderem Kachelstand, war genau das der Wackler.
 */
async function freeSpot(page: Page): Promise<{ x: number; y: number }> {
    const spot = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        const layers = ["place-marker", "place-marker-structure", "route-hit", "route-markers"].filter((id) =>
            map.getLayer(id),
        );
        for (let y = 150; y < canvas.clientHeight - 150; y += 21) {
            for (let x = 400; x < canvas.clientWidth - 440; x += 23) {
                const around = [
                    [x - 16, y - 16],
                    [x + 16, y + 16],
                ] as [[number, number], [number, number]];
                if (map.queryRenderedFeatures(around, { layers }).length === 0) return { x, y };
            }
        }
        return null;
    });
    if (!spot) throw new Error("keine freie Stelle in der Karte");
    // Gesucht in Kartenkoordinaten, geklickt wird in Seitenkoordinaten (im Editor-Modus steht über der Karte die Kopfleiste).
    return onPage(page, spot);
}

test("🔴 ein Klick auf einen Ort öffnet das Infopanel mit seinem Titel (M8)", async ({ page }) => {
    await openMap(page);
    await expect(page.getByTestId("info-panel")).toBeHidden();
    await clickGareth(page);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    // Dieselbe Naht: der gewählte Subject ist der Ort, und sein goldener Kern steht wie vorher.
    expect(await subject(page)).toMatchObject({ kind: "place" });
    expect((await selectedPlace(page))?.name).toBe("Gareth");
    // Die Antwort des Servers kommt dazu: die Ortsart im Untertitel.
    await expect(page.getByTestId("info-subtitle")).toContainText("Metropole");
});

test("🔴 die Hülle: 400 px am rechten Rand, oben 10 px, unten der Kartenrand, nur links gerundet, als Rand gemeldet", async ({
    page,
}) => {
    await openMap(page);
    await clickGareth(page);
    const panel = page.getByTestId("info-panel");
    await expect(panel).toBeVisible();
    // Die Fahrt (0,22 s) abwarten, dann messen.
    await expect.poll(async () => Math.round((await panel.boundingBox())?.x ?? 0)).toBe(880);
    const box = await panel.boundingBox();
    const size = page.viewportSize();
    // Oben zählt der Rand der Anwendung, nicht der Seite: im Editor-Modus steht darüber die Kopfleiste (WI-0120).
    const appTop = await page.evaluate(() => document.querySelector(".app")!.getBoundingClientRect().top);
    expect(box?.width).toBe(400);
    expect((box?.y ?? 0) - appTop).toBe(10);
    expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(size?.width);
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe((size?.height ?? 0) - 12);
    expect(await panel.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("5px 0px 0px 5px");
    // 🔴 Es meldet sich als Rand: Die Kamera zielt daneben.
    expect(await panel.getAttribute("data-map-overlay")).toBe("right");
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsVisibleArea!.insets().right)).toBe(400);
});

test("🔴 Kamera-Ring und Eckknöpfe fahren mit dem offenen Panel nach links und werden nie verdeckt", async ({
    page,
}) => {
    await openMap(page);
    const right = (testid: string): Promise<number> =>
        page.getByTestId(testid).evaluate((element) => Math.round(element.getBoundingClientRect().right));
    const before = { ring: await right("camera-controls"), search: await right("search-open") };
    await clickGareth(page);
    const panel = await page.getByTestId("info-panel").boundingBox();
    await expect.poll(async () => await right("search-open")).toBeLessThan(panel?.x ?? 0);
    expect(await right("camera-controls")).toBeLessThan(panel?.x ?? 0);
    // Gleiche Zeit wie das Panel: Die Ansichtsknöpfe unten rücken um die Panelbreite (400 px, wie Legacy, Betreiber
    // 2026-10-04: kein Abstand für die Lasche), der Ring oben um Panel- und Laschenbreite (400 + 30 px), denn die Lasche steht
    // links neben dem Panel und läge sonst über dem Ring.
    await expect.poll(async () => before.search - (await right("search-open"))).toBe(400);
    await expect.poll(async () => before.ring - (await right("camera-controls"))).toBe(430);
    const tab = await page.getByTestId("info-panel-tab").boundingBox();
    expect(await right("camera-controls")).toBeLessThanOrEqual(Math.round(tab?.x ?? 0));
    // Eingeklappt (Lasche): Nur die Lasche steht an der Kante, der Ring rückt um ihre Breite und liegt nie unter ihr
    // (Betreiber 2026-10-04: „der navigationskreis verschwindet unter der lasche“); die Ansichtsknöpfe sind zurück.
    await page.getByTestId("info-panel-tab").click();
    await expect.poll(async () => before.ring - (await right("camera-controls"))).toBe(30);
    await expect.poll(() => right("search-open")).toBe(before.search);
    const edgeTab = await page.getByTestId("info-panel-tab").boundingBox();
    expect(await right("camera-controls")).toBeLessThanOrEqual(Math.round(edgeTab?.x ?? 0));
    // Zu, und alles ist zurück.
    await page.getByTestId("info-panel-tab").click();
    await page.keyboard.press("Escape");
    await expect.poll(() => right("search-open")).toBe(before.search);
    await expect.poll(() => right("camera-controls")).toBe(before.ring);
});

test("🔴 die Randlasche „Info“ klappt nur die Darstellung ein: Die Auswahl bleibt", async ({ page }) => {
    await openMap(page);
    await expect(page.getByTestId("info-panel-tab")).toBeHidden();
    await clickGareth(page);
    const tab = page.getByTestId("info-panel-tab");
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await tab.click();
    await expect(page.getByTestId("info-panel")).toBeHidden();
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute("aria-expanded", "false");
    expect(await subject(page)).toMatchObject({ kind: "place" });
    expect((await selectedPlace(page))?.name).toBe("Gareth");
    // Kein ✕ am Rechner.
    await expect(page.getByTestId("info-panel-close")).toHaveCount(0);
    await tab.click();
    await expect(page.getByTestId("info-panel")).toBeVisible();
});

test("🔴 ein Klick in die freie Karte hebt die Auswahl auf, und das Panel klappt ein", async ({ page }) => {
    await openMap(page);
    await clickGareth(page);
    const spot = await freeSpot(page);
    await page.mouse.click(spot.x, spot.y);
    await expect(page.getByTestId("info-panel")).toBeHidden();
    expect(await subject(page)).toBeUndefined();
    expect(await selectedPlace(page)).toBeUndefined();
    // Ohne Inhalt ist die Lasche verborgen.
    await expect(page.getByTestId("info-panel-tab")).toBeHidden();
});

test("🔴 ein Klick auf eine Fläche öffnet das Infopanel (nach der vorhandenen Auswahl- und Listenlogik)", async ({
    page,
}) => {
    await page.goto("/#x=468&y=527&z=5&series=original&view=landscapes&layer=vegetation");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    const spot = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        const markers = ["place-marker", "place-marker-structure", "route-hit", "route-markers"].filter((id) =>
            map.getLayer(id),
        );
        for (let y = 150; y < canvas.clientHeight - 150; y += 19) {
            for (let x = 400; x < canvas.clientWidth - 440; x += 23) {
                const areas = map.queryRenderedFeatures([x, y], { layers: ["landscape-fill-vegetation"] });
                // Eine einzige Fläche: Der Klick wählt sie ohne Liste.
                const ids = new Set(areas.map((feature) => feature.properties["region_public_id"]));
                if (ids.size === 1 && map.queryRenderedFeatures([x, y], { layers: markers }).length === 0) {
                    return { x, y, id: [...ids][0] as string };
                }
            }
        }
        return null;
    });
    expect(spot, "eine Stelle mit genau einer Fläche").not.toBeNull();
    await clickMap(page, spot!);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect.poll(async () => (await subject(page))?.kind).toBe("area");
    expect((await subject(page))?.id).toBe(spot!.id);
    // Die Fläche leuchtet weiter wie vorher (WI-0043): die Darstellung wird aus dem Subject gespeist.
    await expect.poll(async () => (await page.evaluate(() => globalThis.avesmapsAreaSelection?.()))?.id).toBe(spot!.id);
    await expect(page.getByTestId("info-title")).not.toHaveText("");
});

test("🔴 die Escape-Kaskade: ein Menü schließt ohne die Auswahl, dann das Panel mit ihr, dann nichts mehr", async ({
    page,
}) => {
    await openMap(page);
    await clickGareth(page);
    // Das Auge-Menü ist offen, Auswahl und Panel stehen.
    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("display-menu")).toBeHidden();
    await expect(page.getByTestId("info-panel")).toBeVisible();
    expect((await selectedPlace(page))?.name).toBe("Gareth");
    expect(await subject(page)).toMatchObject({ kind: "place" });
    // Das zweite Escape: das sichtbare Panel und mit ihm die Auswahl.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("info-panel")).toBeHidden();
    expect(await subject(page)).toBeUndefined();
    expect(await selectedPlace(page)).toBeUndefined();
    // Das dritte tut nichts und wirft nichts.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("info-panel")).toBeHidden();
});

test("🔴 Escape bei eingeklapptem Panel hebt die Auswahl der Karte auf (letzte Stufe)", async ({ page }) => {
    await openMap(page);
    await clickGareth(page);
    await page.getByTestId("info-panel-tab").click();
    await expect(page.getByTestId("info-panel")).toBeHidden();
    await page.keyboard.press("Escape");
    expect(await subject(page)).toBeUndefined();
    expect(await selectedPlace(page)).toBeUndefined();
});

test("🔴 Hover über einem Ort zeigt das eine Zeiger-Schild „Name · Art“, passiv und ohne Aktion", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const at = await screenOf(page, GARETH);
    await page.mouse.move(at.x - 40, at.y - 40);
    await page.mouse.move(at.x, at.y);
    const hint = page.getByTestId("pointer-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText("Gareth · Metropole");
    await expectTooltipLook(hint);
    // Passiv: Es fängt keinen Zeiger, hat keinen Knopf und lädt nichts nach.
    expect(await hint.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
    await expect(hint.locator("button, a")).toHaveCount(0);
    // Hover wählt nichts und öffnet nichts.
    await expect(page.getByTestId("info-panel")).toBeHidden();
    expect(await subject(page)).toBeUndefined();
    // Verlässt der Zeiger den Ort, ist es weg.
    await page.mouse.move(at.x + 200, at.y + 150);
    await expect(hint).toBeHidden();
});

test("🔴 Hover über einem Fluss zeigt dasselbe Schild mit der Art", async ({ page }) => {
    await page.goto("/#x=551.6&y=533&z=7&series=original&view=landscapes&layer=topographie");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    const river = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        const ids = ["path-center-flussweg", "path-center-flussweg-bach"].filter((id) => map.getLayer(id));
        const markers = ["place-marker", "place-marker-structure"].filter((id) => map.getLayer(id));
        // Seit WI-0090 ist auch eine Straße wählbar: Liegt eine neben dem Fluss, zeigt das Schild sie. Gesucht wird deshalb
        // eine Stelle mit NUR Wasser (wie `area-view-scope.spec.ts`).
        const strassen = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => id.startsWith("path-hit-") && !id.includes("flussweg"));
        const rect = canvas.getBoundingClientRect();
        for (let y = 80; y < canvas.clientHeight - 80; y += 4) {
            for (let x = 380; x < canvas.clientWidth - 60; x += 4) {
                const hit = map.queryRenderedFeatures([x, y], { layers: ids })[0];
                const name = hit?.properties["name"];
                // Der Zeiger muss auf der Karte stehen, nicht auf dem Planer, dem Ring oder einem Knopf darüber.
                const onCanvas = document.elementFromPoint(rect.left + x, rect.top + y) === canvas;
                if (
                    onCanvas &&
                    typeof name === "string" &&
                    name !== "" &&
                    map.queryRenderedFeatures([x, y], { layers: markers }).length === 0 &&
                    (strassen.length === 0 ||
                        map.queryRenderedFeatures(
                            [
                                [x - 6, y - 6],
                                [x + 6, y + 6],
                            ],
                            { layers: strassen },
                        ).length === 0)
                ) {
                    return { x: rect.left + x, y: rect.top + y, name };
                }
            }
        }
        return null;
    });
    test.skip(river === null, "kein benannter Fluss im Bild");
    await page.mouse.move(river!.x - 30, river!.y - 30);
    await page.mouse.move(river!.x, river!.y);
    const hint = page.getByTestId("pointer-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText(river!.name);
    await expect(hint).toContainText(/· (Fluss|Bach)\s*$/);
});

test("🔴 Besucher: Leertaste und F öffnen die Suche; kein Fixieren", async ({ page }) => {
    await page.goto("/?besucher");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.keyboard.press("Space");
    await expect(page.getByTestId("search")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("search")).toBeHidden();
    await page.keyboard.press("f");
    await expect(page.getByTestId("search")).toBeVisible();
});

test("🔴 Editor: F öffnet die Suche, die Leertaste fixiert die Auswahl - normale Klicks wechseln dann nicht", async ({
    page,
}) => {
    // 🪤 Eine gestellte Sitzung ist Pflicht: Seit die Anmeldung auch lokal läuft (`authEnabled`), gibt `/edit` ohne sie
    // KEINE Rechte mehr, und die Leertaste ist dann die Suche des Besuchers (`shortcuts.ts:73`) statt der Fixierung.
    // Dieselbe Falle wie bei den Ortseditor-Tests am 2026-10-12.
    // 🪤 Und das Editorpanel muss gemerkt zu sein: Seit `dd9f7476` steht es am Rechner beim Laden vorn, und das Infopanel samt
    // „Auswahl fixiert“ zieht dann nur im Hintergrund nach (`subject-selection.ts`). Derselbe Griff wie in `2923ba21`.
    await editorPanelGemerktZu(page);
    await stubAdmin(page, { capabilities: ["pin_selection", "use_editor_menu"], role: "editor" });
    await openMap(page, EDITOR_MODE);
    await page.keyboard.press("f");
    await expect(page.getByTestId("search")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("search")).toBeHidden();

    await clickGareth(page);
    await expect(page.getByTestId("info-pinned")).toHaveCount(0);
    await page.keyboard.press("Space");
    await expect(page.getByTestId("search")).toBeHidden();
    await expect(page.getByTestId("info-pinned")).toBeVisible();
    // Ein Klick in die freie Karte, und die Auswahl bleibt.
    const spot = await freeSpot(page);
    await page.mouse.click(spot.x, spot.y);
    expect(await subject(page)).toMatchObject({ kind: "place" });
    await expect(page.getByTestId("info-panel")).toBeVisible();
    // Hover und Kamera bleiben möglich: Die Karte lässt sich weiter verschieben.
    const before = await page.evaluate(() => globalThis.avesmapsMap!.getCenter());
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap!.getCenter().lng)).not.toBe(before.lng);
    // Die Leertaste löst, dann wechselt der Klick wieder.
    await page.keyboard.press("Space");
    await expect(page.getByTestId("info-pinned")).toHaveCount(0);
    // Die Karte hat sich verschoben: Die freie Stelle ist neu zu suchen, sonst läge ein anderer Ort darunter. 🪤 Und erst, wenn sie
    // steht und das letzte Bild gezeichnet ist: Die Pfeiltaste fährt mit Auslauf, und eine Stelle, die mitten in der Fahrt frei war,
    // liegt beim Klick schon unter einer Marke (unter Last gemessen, `--workers=4`).
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 15_000 });
    await settleFrame(page);
    const later = await freeSpot(page);
    await page.mouse.click(later.x, later.y);
    await expect.poll(() => subject(page)).toBeUndefined();
});

test("🔴 Escape löst die Fixierung mit der Auswahl", async ({ page }) => {
    await editorPanelGemerktZu(page);
    await stubAdmin(page, { capabilities: ["pin_selection", "use_editor_menu"], role: "editor" });
    await openMap(page, EDITOR_MODE);
    await clickGareth(page);
    await page.keyboard.press("Space");
    await expect(page.getByTestId("info-pinned")).toBeVisible();
    // Seit WI-0128 E15 (`3eeafe9c`, Handgriffe am Ort) öffnet der Klick im Editor-Modus auch das Menü am Objekt. Escape geht von innen
    // nach außen (`escape-cascade.ts`, Betreiber 2026-10-04): Das erste schließt nur das Menü, Fixierung und Auswahl bleiben.
    await expect(page.getByTestId("editor-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
    await expect(page.getByTestId("info-pinned")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("info-panel")).toBeHidden();
    expect(await subject(page)).toBeUndefined();
    await expect(page.getByTestId("info-pinned")).toHaveCount(0);
});

test("🔴 das Kontextmenü: „Was ist hier?“ geht und öffnet den Kartenpunkt mit seinem Tropfen", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(page.getByTestId("map-context-menu")).toBeVisible();
    const entry = page.getByTestId("context-what-is-here");
    await expect(entry).toBeEnabled();
    await entry.click();
    await expect(page.getByTestId("info-title")).toHaveText("Was ist hier?");
    expect(await subject(page)).toMatchObject({ kind: "mapPoint" });
    // Kein erfundenes Länge/Breite: die Koordinate der Karte.
    await expect(page.getByTestId("info-subtitle")).toContainText("x ");
    // Der Tropfen steht an der Stelle.
    const pins = await page.evaluate(
        () =>
            (
                (
                    globalThis.avesmapsMap as unknown as { getStyle(): { sources: Record<string, { data?: unknown }> } }
                ).getStyle().sources["map-pin"]?.data as { features: unknown[] }
            ).features.length,
    );
    expect(pins).toBe(1);
    // Ein Klick in die freie Karte nimmt ihn mit der Auswahl weg.
    await page.mouse.click(spot.x + 30, spot.y + 30);
    await expect(page.getByTestId("info-panel")).toBeHidden();
    const after = await page.evaluate(
        () =>
            (
                (
                    globalThis.avesmapsMap as unknown as { getStyle(): { sources: Record<string, { data?: unknown }> } }
                ).getStyle().sources["map-pin"]?.data as { features: unknown[] }
            ).features.length,
    );
    expect(after).toBe(0);
});

test("🔴 `?siedlung=Gareth` öffnet Gareth: Panel, gewählter Ort, die Kamera fliegt hin (Legacy-Objektlink)", async ({
    page,
}) => {
    await page.goto("/?siedlung=Gareth#x=300&y=300&z=4&series=original&view=standard");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("info-panel")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    expect(await subject(page)).toMatchObject({ kind: "place" });
    expect((await selectedPlace(page))?.name).toBe("Gareth");
    // Die Kamera ist hingeflogen (die Ansicht begann woanders) und steht in der sichtbaren Mitte.
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 15_000 });
    await settleFrame(page);
    const gap = await page.evaluate(
        ({ target }) => {
            const map = globalThis.avesmapsMap!;
            const gareth = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(target));
            // Die Mitte der freien Fläche zwischen Planer und Infopanel (seit WI-0218 nicht mehr die Mitte der Karte).
            const centre = globalThis.avesmapsVisibleArea!.centre();
            return Math.hypot(gareth.x - centre.x, gareth.y - centre.y);
        },
        { target: GARETH },
    );
    expect(gap).toBeLessThan(3);
});

test("🔴 die englischen Aliase öffnen dasselbe: `?settlement=Gareth`", async ({ page }) => {
    await page.goto("/?settlement=Gareth");
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 20_000 });
    expect(await subject(page)).toMatchObject({ kind: "place" });
});

test("🔴 eine Absage wegen Last fragt das Panel selbst noch einmal: `?siedlung=Gareth` mit 503 beim ersten Abruf", async ({
    page,
}) => {
    // Befund 2026-10-04: Unter paralleler Last lief der Kontext von Gareth in die Zeitgrenze der Datenbank, und das Panel zeigte
    // sofort „Die Angaben konnten nicht geladen werden“. Hier nachgestellt: je eine Absage für Objektlink und Detail.
    const refusals = { link: 0, detail: 0 };
    const refuseOnce = (kind: keyof typeof refusals, error: "busy" | "database_unavailable") => {
        return async (route: Route): Promise<void> => {
            refusals[kind] += 1;
            if (refusals[kind] > 1) return route.continue();
            // Die Pause bestimmt der Server; hier keine, damit der Test nicht wartet.
            return route.fulfill({
                status: 503,
                contentType: "application/json",
                headers: { "Retry-After": "0" },
                body: JSON.stringify({ error }),
            });
        };
    };
    await page.route((url) => url.pathname === "/api/subjects/resolve-link", refuseOnce("link", "busy"));
    await page.route(
        (url) => /^\/api\/subjects\/place\/[0-9a-f-]+$/.test(url.pathname),
        refuseOnce("detail", "database_unavailable"),
    );

    await page.goto("/?siedlung=Gareth");
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 20_000 });
    await expect(page.getByTestId("info-error")).toHaveCount(0);
    // Unter echter Last kann auch die zweite Frage abgewiesen werden; dann kommt die Antwort mit der dritten.
    expect(refusals.link, "eine Absage, dann der Objektlink").toBeGreaterThanOrEqual(2);
    expect(refusals.detail, "eine Absage, dann die Angaben").toBeGreaterThanOrEqual(2);
});

test("🔴 `?place=<Kennung>` öffnet den Ort über seine stabile Kennung", async ({ page }) => {
    const hits = (await (await page.request.get("/api/search?q=Gareth")).json()) as {
        hits: { kind: string; id: string; name: string }[];
    };
    const gareth = hits.hits.find((hit) => hit.kind === "ort" && hit.name === "Gareth");
    expect(gareth).toBeDefined();
    await page.goto(`/?place=${gareth!.id}`);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 20_000 });
    expect((await subject(page))?.id).toBe(gareth!.id);
});

test("🔴 `?pin=lat,lng` öffnet „Was ist hier?“ an der Stelle, mit Tropfen (Legacy: y vor x)", async ({ page }) => {
    await page.goto("/?pin=532.969,551.625");
    await expect(page.getByTestId("info-title")).toHaveText("Was ist hier?", { timeout: 20_000 });
    expect(await subject(page)).toMatchObject({ kind: "mapPoint", x: 551.63, y: 532.97 });
});

test("🔴 wird die Kartenstelle Reiseziel, weicht ihr Tropfen dem der Route - und kommt mit dem Entfernen zurück", async ({
    page,
}) => {
    // Betreiber 2026-10-09: „fragezeichen sieht super aus, verschwindet aber nicht, wenn ich "Reiseziel hinfügen" mach“.
    const pins = (): Promise<number> =>
        page.evaluate(
            () =>
                (
                    (
                        globalThis.avesmapsMap as unknown as {
                            getStyle(): { sources: Record<string, { data?: unknown }> };
                        }
                    ).getStyle().sources["map-pin"]?.data as { features: unknown[] }
                ).features.length,
        );
    await page.goto("/?pin=532.969,551.625");
    await expect(page.getByTestId("info-title")).toHaveText("Was ist hier?", { timeout: 20_000 });
    await expect.poll(pins).toBe(1);
    await page.getByTestId("info-action-addDestination").click();
    await expect(page.getByTestId("info-action-removeDestination")).toBeVisible();
    // Die Stelle bleibt gewählt, aber ihr Tropfen ist weg: Die Route trägt sie jetzt.
    expect(await subject(page)).toMatchObject({ kind: "mapPoint" });
    await expect.poll(pins).toBe(0);
    await page.getByTestId("info-action-removeDestination").click();
    await expect(page.getByTestId("info-action-addDestination")).toBeVisible();
    await expect.poll(pins).toBe(1);
});

test("🔴 ein mehrdeutiger Objektlink zeigt die Auswahl - nichts wird still gewählt", async ({ page }) => {
    // Der Server meldet Kandidaten erst mit den Wiki-Daten (Satz 161832); die Liste selbst ist hier das Prüfobjekt.
    const found = (await (await page.request.get("/api/search?q=Gareth")).json()) as {
        hits: { kind: string; id: string; name: string }[];
    };
    const gareth = found.hits.find((hit) => hit.kind === "ort" && hit.name === "Gareth");
    const other = found.hits.find((hit) => hit.kind === "ort" && hit.name !== "Gareth");
    expect(gareth).toBeDefined();
    expect(other).toBeDefined();
    await page.route("**/api/subjects/resolve-link*", (route) =>
        route.fulfill({
            json: {
                candidates: [
                    { ref: { kind: "place", id: gareth!.id }, title: "Rathila", type: "stadt" },
                    { ref: { kind: "place", id: other!.id }, title: "Rathila", type: "dorf" },
                ],
                param: "siedlung",
                via: "name",
            },
        }),
    );
    await page.goto("/?siedlung=Rathila");
    const list = page.getByTestId("link-choices");
    await expect(list).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("link-choice")).toHaveCount(2);
    await expect(page.getByTestId("link-choice").nth(0)).toContainText("Stadt");
    // Nichts ist gewählt, das Panel ist zu.
    await expect(page.getByTestId("info-panel")).toBeHidden();
    expect(await subject(page)).toBeUndefined();
    // Escape schließt die Liste, ohne etwas zu öffnen.
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    expect(await subject(page)).toBeUndefined();
    // Ein Eintrag öffnet seinen Gegenstand.
    await page.goto("/?siedlung=Rathila");
    await page.getByTestId("link-choice").nth(0).click();
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 20_000 });
    await expect(page.getByTestId("link-choices")).toBeHidden();
});

test("🔴 ein unbekannter Name sagt es - nie still Gareth oder die Startansicht", async ({ page }) => {
    await page.goto("/?siedlung=Unbekanntheim");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("toast")).toContainText("Unbekanntheim", { timeout: 20_000 });
    await expect(page.getByTestId("toast")).toContainText("nicht (mehr) auf der Karte");
    await expect(page.getByTestId("info-panel")).toBeHidden();
    expect(await subject(page)).toBeUndefined();
});

test("🔴 eine Etappe öffnet ihre Information im Infopanel: „Etappe n von m“", async ({ page }) => {
    await page.goto("/?route=Gareth~Perricum");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await openStageGroups(page);
    const rows = page.getByTestId("route-stage");
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    // 🪤 Auf das BILD der Zeile: Ihre Mitte trägt seit WI-0087 P1 den Wegnamen, und der ist ein eigener Link.
    await rows.first().locator("img").first().click();
    await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 1 von \d+$/);
    expect(await subject(page)).toMatchObject({ kind: "routeStage" });
    await expect(page.getByTestId("info-panel")).toBeVisible();
    // E13: Die Pfeile stehen an den Rändern der Untertitelzeile - an der ersten Etappe ist ‹ gesperrt (die Wege prüft `info-panel-p7.spec.ts`,
    // die Lage `info-panel-stage-head.spec.ts`).
    await expect(page.getByTestId("info-stage-nav")).toBeVisible();
    await expect(page.getByTestId("info-stage-prev")).toBeDisabled();
    await expect(page.getByTestId("info-stage-next")).toBeEnabled();
    // Gareth bleibt ein Ort, die Karte kennt keinen zweiten gewählten Subject.
    expect(await selectedPlace(page)).toBeUndefined();
});
