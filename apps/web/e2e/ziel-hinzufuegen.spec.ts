import { expect, test, type Page } from "@playwright/test";
import { GARETH, selectedPlace, showPlace } from "./map-handle.ts";
import { showStages } from "./stage-groups.ts";

/**
 * **WI-0100 — die zweite Zeile des Kartenmenüs, an der laufenden Oberfläche.**
 *
 * Betreiber 2026-10-07: „kannst du beim rechtsklick auf ein ort ‚Hierhin reisen‘ ersetzen durch ‚Ziel hinzufügen‘
 * (mit den tropfen als icon)“, und klarstellend:
 *
 * > „‚Hierher reisen‘ ist ein klick auf der freien fläche (‚Kartenpunkt bei …‘) · ‚Ziel hinzufügen‘ fügt einen ort
 * > hinzu (wie ‚Reiseziel hinzufügen‘) · das eine ersetzt das andere wenn ich auf einen ort geklickt hat. Der
 * > Linksklick macht ein Ortsmarker gelb. Genau dasselbe will ich mit rechtsklick nur dass das Kontextmenü aufgeht.“
 *
 * Geprüft wird, was man nur im Browser sehen kann:
 * 1. 🔴 **welcher der beiden Einträge steht** - freie Fläche gegen Ort, und immer genau einer;
 * 2. 🔴 dass der **Rechtsklick auf einen Ort ihn wählt** (goldener Kern), wie der Linksklick;
 * 3. das **gezeichnete** Zeichen im Menü (kein `<img>`, ein `<svg>`) und dass die Nadel dieselbe Fläche einnimmt
 *    wie die gemalten `.webp` der Nachbarn, die Zeilen also gleich hoch bleiben;
 * 4. dass das **Verhalten zur Beschriftung passt**: der Kartenpunkt wird Startpunkt beziehungsweise hängt an, der
 *    ORT kommt als Ort hinten dran.
 *
 * 🪤 Das Menü wird mit einem **echten Rechtsklick** geöffnet, auch im schmalen Bild: Am Finger führt der lange
 * Druck bei uns nicht ins Kartenmenü, sondern öffnet „Was ist hier?“ (Befund WI-0095 F7, nicht Gegenstand dieses
 * Arbeitspakets).
 */

/** Eine freie Stelle neben Gareth, an der `map-points.spec.ts` das Kartenmenü seit WI-0030 öffnet. */
const STELLE = { x: 560, y: 540 };

async function openMapApp(page: Page, search = ""): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
}

/** Springt zur Stelle und sagt, wo sie im Bild liegt - in Seitenpixeln. */
async function showPoint(page: Page, point: { x: number; y: number }, zoom = 8): Promise<{ x: number; y: number }> {
    await page.evaluate(
        ({ point, zoom }) => {
            const center = globalThis.avesmapsRenderProjection!.toRenderLngLat(point);
            globalThis.avesmapsMap!.jumpTo({ center, zoom });
        },
        { point, zoom },
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    const box = await page.getByTestId("map").boundingBox();
    const at = await page.evaluate(
        (point) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(point)),
        point,
    );
    return { x: (box?.x ?? 0) + at.x, y: (box?.y ?? 0) + at.y };
}

/** Echter Rechtsklick an der Stelle; das Menü steht danach offen. */
async function openMenu(page: Page, screen: { x: number; y: number }): Promise<void> {
    await page.mouse.click(screen.x, screen.y, { button: "right" });
    await expect(page.getByTestId("map-context-menu")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
}

/** Die gemessenen Kästen der Menüzeilen: Zeilenhöhe, Symbolkasten, und was das Symbol ist. */
async function gemessen(page: Page): Promise<
    {
        action: string;
        zeile: number;
        kasten: { width: number; height: number };
        gezeichnet: boolean;
        zeichen: { width: number; height: number } | null;
    }[]
> {
    return page.evaluate(() => {
        const rund = (value: number): number => Math.round(value * 100) / 100;
        return [...document.querySelectorAll<HTMLElement>('[data-testid="map-context-menu"] .context-menu__item')].map(
            (item) => {
                const cell = item.querySelector<HTMLElement>(".context-menu__icon")!;
                const svg = cell.querySelector("svg");
                const box = svg?.getBoundingClientRect();
                return {
                    action: (item.dataset["testid"] ?? "").replace("context-", ""),
                    zeile: rund(item.getBoundingClientRect().height),
                    kasten: {
                        width: rund(cell.getBoundingClientRect().width),
                        height: rund(cell.getBoundingClientRect().height),
                    },
                    gezeichnet: svg !== null,
                    zeichen: box ? { width: rund(box.width), height: rund(box.height) } : null,
                };
            },
        );
    });
}

/** Springt zu Gareth und sagt, wo seine Ortsmarke im Bild liegt - dieselbe Naht wie `info-panel.spec.ts`. */
async function zeigeGareth(page: Page): Promise<{ x: number; y: number }> {
    await showPlace(page, GARETH, 5);
    const box = await page.getByTestId("map").boundingBox();
    const at = await page.evaluate(
        (p) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p)),
        GARETH,
    );
    return { x: (box?.x ?? 0) + at.x, y: (box?.y ?? 0) + at.y };
}

/** Die Aufschriften des offenen Menüs, in der Reihenfolge, in der sie stehen. */
function aufschriften(page: Page): Promise<string[]> {
    return page.locator('[data-testid="map-context-menu"] .context-menu__item').allInnerTexts();
}

test("🔴 Auf der FREIEN FLÄCHE steht „Hierher reisen“ mit Legacys Stiefel", async ({ page }) => {
    await openMapApp(page);
    await openMenu(page, await showPoint(page, STELLE));

    await expect(page.getByTestId("context-travel-here")).toHaveText("Hierher reisen");
    await expect(page.getByTestId("context-travel-here").locator("img")).toHaveCount(1);
    expect(await page.getByTestId("context-travel-here").locator("img").getAttribute("src")).toContain("schuh.webp");
    // 🔴 Der andere Eintrag steht NICHT daneben: zwei Einträge, eine Zeile.
    await expect(page.getByTestId("context-add-destination")).toHaveCount(0);
    expect(await aufschriften(page)).toEqual([
        "Was ist hier?",
        "Hierher reisen",
        "Hier etwas melden",
        "Eigenes Bild hinzufügen",
        "Nächsten Ort finden",
        "Auf Karte suchen",
        "Entfernung messen",
        "Screenshot machen",
    ]);
    // Und die freie Fläche wählt keinen Ort aus.
    expect(await selectedPlace(page)).toBeUndefined();
});

test("🔴 Auf einem ORT steht „Ziel hinzufügen“ mit dem gezeichneten Tropfen - und ERSETZT den anderen", async ({
    page,
}) => {
    await openMapApp(page);
    await openMenu(page, await zeigeGareth(page));

    const eintrag = page.getByTestId("context-add-destination");
    await expect(eintrag).toHaveText("Ziel hinzufügen");
    // Das ECHTE Zeichen: ein Inline-SVG der Wegpunktmarke, kein `<img>` und kein neues `.webp`.
    await expect(eintrag.locator("svg.mark--drop")).toHaveCount(1);
    await expect(eintrag.locator("img")).toHaveCount(0);
    // 🔴 „Hierher reisen“ steht hier NICHT - es ist ersetzt, nicht ergänzt.
    await expect(page.getByTestId("context-travel-here")).toHaveCount(0);
    expect(await aufschriften(page)).toEqual([
        "Was ist hier?",
        "Ziel hinzufügen",
        "Hier etwas melden",
        "Eigenes Bild hinzufügen",
        "Nächsten Ort finden",
        "Auf Karte suchen",
        "Entfernung messen",
        "Screenshot machen",
    ]);
    // Die Nachbarn mit Bild sind unberührt.
    for (const action of ["what-is-here", "report", "photobox", "nearest", "search", "measure", "screenshot"]) {
        await expect(page.getByTestId(`context-${action}`).locator("img"), action).toHaveCount(1);
    }
});

test("🔴 Der Rechtsklick auf einen Ort WÄHLT ihn - genau wie der Linksklick, nur mit Menü", async ({ page }) => {
    await openMapApp(page);

    // Erst der Linksklick als Maßstab: Er macht die Ortsmarke gold und öffnet das Infopanel.
    const at = await zeigeGareth(page);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    expect((await selectedPlace(page))?.name).toBe("Gareth");
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);

    // Dann derselbe Ort mit der rechten Taste, frisch geladen.
    await openMapApp(page);
    const at2 = await zeigeGareth(page);
    expect(await selectedPlace(page)).toBeUndefined();
    await openMenu(page, at2);

    // 🔴 Derselbe gewählte Ort wie beim Linksklick - und dazu das Menü.
    expect((await selectedPlace(page))?.name).toBe("Gareth");
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    await expect(page.getByTestId("map-context-menu")).toBeVisible();
});

test("🔴 „Ziel hinzufügen“ hängt den ORT an die bestehende Reise, als Ort und nicht als Kartenpunkt", async ({
    page,
}) => {
    await openMapApp(page, "?route=Perricum~Rommilys");
    await expect(page.getByTestId("waypoint-input")).toHaveCount(2);
    const vorher = await page
        .getByTestId("waypoint-input")
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    await showStages(page, 20_000);

    await openMenu(page, await zeigeGareth(page));
    await page.getByTestId("context-add-destination").click();
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);

    // 🔴 Die zwei Stationen stehen unverändert, Gareth kommt als dritte dazu - mit seinem NAMEN, nicht als Kartenpunkt.
    await expect(page.getByTestId("waypoint-input")).toHaveCount(3);
    const nachher = await page
        .getByTestId("waypoint-input")
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    expect(nachher.slice(0, 2)).toEqual(vorher);
    expect(nachher[2]).toBe("Gareth");
    // 🪤 Keine Meldung: `travelHere.startSet` spricht vom Kartenpunkt und gehört der freien Fläche.
    await expect(page.getByTestId("toast")).toHaveCount(0);
});

test("🔴 Die Nadel nimmt dieselbe Fläche wie die gemalten Nachbarn - alle Zeilen bleiben gleich hoch", async ({
    page,
}) => {
    await openMapApp(page);
    await openMenu(page, await zeigeGareth(page));

    const zeilen = await gemessen(page);
    expect(zeilen.map((z) => z.action)).toEqual([
        "what-is-here",
        "add-destination",
        "report",
        "photobox",
        "nearest",
        "search",
        "measure",
        "screenshot",
    ]);

    // Jeder Symbolkasten ist Legacys Bildkante, auch der gezeichnete.
    for (const zeile of zeilen) {
        expect(zeile.kasten, zeile.action).toEqual({ width: 18, height: 18 });
    }

    // 🔴 EINE Zeilenhöhe über alle Zeilen; die Nadel macht ihre Zeile nicht höher.
    const hoehen = [...new Set(zeilen.map((z) => z.zeile))];
    expect(hoehen, `Zeilenhöhen: ${zeilen.map((z) => `${z.action}=${String(z.zeile)}`).join(" · ")}`).toHaveLength(1);

    // Genau EIN gezeichnetes Zeichen, und es steht auf der Bildhöhe der Nachbarn (18 px) - höher als breit.
    expect(zeilen.filter((z) => !z.gezeichnet)).toHaveLength(7);
    const nadel = zeilen.find((z) => z.action === "add-destination");
    expect(nadel?.gezeichnet).toBe(true);
    expect(nadel?.zeichen?.height).toBeCloseTo(18, 1);
    expect(nadel?.zeichen?.width).toBeCloseTo(14 * (18 / 24), 1);
    // Sie bleibt IM Kasten: nichts ragt heraus, weder waagerecht noch senkrecht.
    expect(nadel!.zeichen!.height).toBeLessThanOrEqual(nadel!.kasten.height + 0.01);
    expect(nadel!.zeichen!.width).toBeLessThanOrEqual(nadel!.kasten.width + 0.01);
});

test("Leere Reise, freie Fläche: der Kartenpunkt wird der Startpunkt, und ein Satz sagt, was noch fehlt", async ({
    page,
}) => {
    await openMapApp(page);
    await openMenu(page, await showPoint(page, STELLE));
    await page.getByTestId("context-travel-here").click();
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);

    await expect(page.getByTestId("toast")).toContainText("Kartenpunkt als Startpunkt gesetzt");
    await expect(page.getByTestId("waypoint-input").nth(0)).toHaveValue(/^Kartenpunkt/);
    await expect(page.getByTestId("waypoint-input")).toHaveCount(1);
});

test("🔴 Bestehende Reise mit drei Stationen: der Kartenpunkt hängt als VIERTE hinten an", async ({ page }) => {
    await openMapApp(page, "?route=Gareth~Perricum~Rommilys");
    await expect(page.getByTestId("waypoint-input")).toHaveCount(3);
    const vorher = await page
        .getByTestId("waypoint-input")
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    await showStages(page, 20_000);

    await openMenu(page, await showPoint(page, STELLE));
    await page.getByTestId("context-travel-here").click();
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);

    // 🔴 Die drei vorhandenen Stationen stehen unverändert, der Kartenpunkt kommt als vierte dazu.
    await expect(page.getByTestId("waypoint-input")).toHaveCount(4);
    const nachher = await page
        .getByTestId("waypoint-input")
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    expect(nachher.slice(0, 3)).toEqual(vorher);
    expect(nachher[3]).toMatch(/^Kartenpunkt/);
    // Kein Startpunkt-Hinweis: es fehlt kein Ziel mehr.
    await expect(page.getByTestId("toast")).toHaveCount(0);

    // Und die Reise endet wirklich dort: die letzte Etappe führt zum Kartenpunkt.
    const stages = await showStages(page, 30_000).then(() => page.getByTestId("route-stage").allInnerTexts());
    expect(stages.at(-1)).toMatch(/Kartenpunkt/);
});

/**
 * Gegenprobe zu „vierte hinten“ ohne Zufall (WI-0248, Release-Lauf f80bb5c83: `openStageGroups` wartete zehn Sekunden auf eine Änderung von 5 zugeklappten
 * Köpfen, die nie kam). Der Server antwortet auf die Neuberechnung hier erst nach anderthalb Sekunden. Solange steht die ALTE Liste gedämpft da
 * (`is-stale`), ihre Gruppen sind durch die neuen Wegpunktnamen schon wieder zu, und ein Helfer, der dort zählt und klickt, klappt an der NEUEN
 * Liste eine von sechs auf: wieder fünf. Im Lauf traf das Fenster nur der Zufall, hier trifft es jedes Mal.
 */
test("🔴 Die Reise rechnet langsam neu: die Gruppen öffnen erst an der frischen Liste, nicht an der gedämpften alten", async ({
    page,
}) => {
    let anfragen = 0;
    await page.route(
        (url) => url.pathname === "/api/route",
        async (route) => {
            anfragen += 1;
            // Die erste Anfrage lädt die drei Stationen aus dem Link; erst die zweite (mit dem Kartenpunkt) kommt verspätet.
            if (anfragen > 1) await new Promise((fertig) => setTimeout(fertig, 1500));
            await route.continue();
        },
    );
    await openMapApp(page, "?route=Gareth~Perricum~Rommilys");
    await expect(page.getByTestId("waypoint-input")).toHaveCount(3);
    await showStages(page, 20_000);

    await openMenu(page, await showPoint(page, STELLE));
    await page.getByTestId("context-travel-here").click();
    await expect(page.getByTestId("waypoint-input")).toHaveCount(4);
    // Genau das Fenster des Release-Laufs: Die alte Liste steht gedämpft da, die neue ist noch unterwegs.
    await expect(page.getByTestId("route-stages")).toHaveClass(/(^|\s)is-stale(\s|$)/);

    await showStages(page, 30_000);
    await expect(page.getByTestId("route-stages")).not.toHaveClass(/(^|\s)is-stale(\s|$)/);
    await expect(page.locator('[data-testid="route-stage-group"] [aria-expanded="false"]')).toHaveCount(0);
    expect(anfragen, "die verspätete Antwort war wirklich die Neuberechnung").toBeGreaterThan(1);
});

test("Bei 360 px steht dasselbe da - geöffnet mit einem echten Rechtsklick (WI-0095 F7)", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await openMapApp(page);
    const stelle = await showPoint(page, STELLE);
    /*
     * 🪤 **Am Telefon deckt der offene Planer die Kartenmitte** - gemessen: an der Stelle liegt dann `DIV.options__row`,
     * und der Rechtsklick erreicht die Karte gar nicht. Er wird deshalb zugeklappt, so wie man es auch am Gerät tut.
     * Das ist die Lage des Bauteils, kein Fehler dieses Eintrags; dass der lange DRUCK ohnehin nicht ins Kartenmenü
     * führt, ist der Befund WI-0095 F7 und nicht Gegenstand dieses Pakets.
     */
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) === "true") await tab.click();
    await openMenu(page, stelle);

    await expect(page.getByTestId("context-travel-here")).toHaveText("Hierher reisen");
    const zeilen = await gemessen(page);
    for (const zeile of zeilen) {
        expect(zeile.kasten, zeile.action).toEqual({ width: 18, height: 18 });
    }
    expect([...new Set(zeilen.map((z) => z.zeile))]).toHaveLength(1);
});
