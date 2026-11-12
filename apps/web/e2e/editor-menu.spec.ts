import { expect, test, type Page } from "@playwright/test";
import { EDITOR_MODE, GARETH, openMap, settleFrame, showLandscapes, showPlace } from "./map-handle.ts";
import { ORTSEDITOR_RECHTE, editorPanelGemerktZu } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Das Editor-Menü am Objekt am echten Stack (WI-0063 P9, 4.2, 4.10, 15): Heute gibt es keine Action, also öffnet es für niemanden.
 * Damit Architektur und Oberfläche trotzdem belegt sind, legt die Entwicklungsnaht `__avesmapsEditorActions` zwei Testaktionen in die
 * Registry (`editor-menu/dev-actions.ts`, nur im Entwicklungsmodus).
 *
 * 🪤 Jeder Editor-Test legt die Naht VOR dem Laden hin (`addInitScript`); ohne sie ist die Registry leer.
 * 🪤 Und seit `3c75c88d` („ohne Anmeldung überall die Besucheransicht“) braucht das Menü am Objekt eine Sitzung mit
 * `use_editor_menu` - ohne sie gab es die Handgriffe gar nicht mehr, und elf Tests waren rot. Die Sitzung wird deshalb hier
 * gestellt, wie in `ortseditor-stub.ts`.
 */
test.beforeEach(async ({ page }) => {
    await stubAdmin(page, { capabilities: ORTSEDITOR_RECHTE, role: "editor" });
    // Seit `dd9f7476` steht das Editorpanel beim Laden offen und das Infopanel dahinter; diese Tests prüfen Menü und Infopanel.
    await editorPanelGemerktZu(page);
});

interface Call {
    id: string;
    kind: string;
}

async function withTestActions(page: Page): Promise<void> {
    await page.addInitScript(() => {
        (globalThis as { __avesmapsEditorActions?: unknown }).__avesmapsEditorActions = { calls: [] };
    });
}

const calls = (page: Page): Promise<Call[]> =>
    page.evaluate(
        () => (globalThis as unknown as { __avesmapsEditorActions: { calls: Call[] } }).__avesmapsEditorActions.calls,
    );

const subject = (page: Page): Promise<{ kind: string } | undefined> =>
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

/** Klickt Gareth und gibt den Klickpunkt zurück. */
async function clickGareth(page: Page): Promise<{ x: number; y: number }> {
    await showPlace(page, GARETH, 5);
    const at = await screenOf(page, GARETH);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    return at;
}

/** Eine freie Stelle der sichtbaren Karte: zwischen Planer und Panel, ohne Ort und ohne Route auch in der Nähe. */
async function freeSpot(page: Page): Promise<{ x: number; y: number }> {
    const spot = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        // Kartenkoordinaten zum Suchen, Seitenkoordinaten zurück (im Editor-Modus schiebt die Kopfleiste die Karte nach unten).
        const rect = canvas.getBoundingClientRect();
        const layers = ["place-marker", "place-marker-structure", "route-hit", "route-markers"].filter((id) =>
            map.getLayer(id),
        );
        for (let y = 150; y < canvas.clientHeight - 150; y += 21) {
            for (let x = 400; x < canvas.clientWidth - 440; x += 23) {
                const around = [
                    [x - 16, y - 16],
                    [x + 16, y + 16],
                ] as [[number, number], [number, number]];
                if (map.queryRenderedFeatures(around, { layers }).length === 0)
                    return { x: rect.left + x, y: rect.top + y };
            }
        }
        return null;
    });
    if (!spot) throw new Error("keine freie Stelle in der Karte");
    return spot;
}

test("🔴 ohne Testaktionen trägt das Menü am Ort nur die Handgriffe des Ortseditors (WI-0128 E15), keine der Entwicklungsnaht", async ({
    page,
}) => {
    await openMap(page, EDITOR_MODE);
    await clickGareth(page);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect(page.getByTestId("editor-action-ort-bearbeiten")).toBeVisible();
    await expect(page.getByTestId("editor-action-dev.test")).toHaveCount(0);
});

test("🔴 ein Linksklick auf einen Ort öffnet das Menü am Klickpunkt mit Name, Art und den Actions - und das Infopanel auch", async ({
    page,
}) => {
    await withTestActions(page);
    await openMap(page, EDITOR_MODE);
    const click = await clickGareth(page);
    const menu = page.getByTestId("editor-menu");
    await expect(menu).toBeVisible();
    // Wessen Menü es ist: der Name sofort, die Art mit der Antwort des Servers (dieselbe Regel wie der Kopf des Panels).
    await expect(page.getByTestId("editor-menu-title")).toHaveText("Gareth");
    await expect(page.getByTestId("editor-menu-art")).toHaveText("Metropole");
    // Wem das Menü gehört (Betreiber 2026-10-11): die Pille „nur Editoren“ im Kopf, wie im Kontextmenü.
    await expect(page.getByTestId("editor-menu-pille")).toHaveText("nur Editoren");
    await expect(page.getByTestId("editor-action-dev.test")).toBeVisible();
    await expect(page.getByTestId("editor-action-dev.danger")).toHaveAttribute("data-danger", "true");
    await expect(page.getByTestId("editor-action-dev.test")).not.toHaveAttribute("data-danger", /.*/);
    // 4.2 Punkte 1 bis 3: Das Infopanel wird mit aktualisiert, und der Ort ist der gewählte Subject.
    await expect(page.getByTestId("info-panel")).toBeVisible();
    expect(await subject(page)).toMatchObject({ kind: "place" });
    // Am Klickpunkt, daneben: Das angeklickte Zeichen bleibt zu sehen, das Menü bleibt im Fenster.
    const box = (await menu.boundingBox())!;
    const size = page.viewportSize()!;
    const covers =
        click.x >= box.x && click.x <= box.x + box.width && click.y >= box.y && click.y <= box.y + box.height;
    expect(covers, "das Menü deckt den Klickpunkt nicht").toBe(false);
    expect(Math.hypot(box.x + box.width / 2 - click.x, box.y + box.height / 2 - click.y)).toBeLessThan(260);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    // 🔴 Der Klick schiebt auch das Infopanel herein (400 px am rechten Rand): Das Menü liegt neben ihm und deckt seine Aktionen nicht.
    const panel = page.getByTestId("info-panel");
    await expect.poll(async () => Math.round((await panel.boundingBox())?.x ?? 0)).toBe(size.width - 400);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width - 400);
});

test("🔴 Escape schließt zuerst das Menü, dann erst das Infopanel samt Auswahl (WI-0063 4.10)", async ({ page }) => {
    await withTestActions(page);
    await openMap(page, EDITOR_MODE);
    await clickGareth(page);
    await expect(page.getByTestId("editor-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
    // Auswahl und Panel stehen noch.
    await expect(page.getByTestId("info-panel")).toBeVisible();
    expect(await subject(page)).toMatchObject({ kind: "place" });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("info-panel")).toBeHidden();
    expect(await subject(page)).toBeUndefined();
});

test("ein Klick in die freie Karte schließt das Menü und hebt die Auswahl auf; ein Klick auf denselben Ort bringt es wieder", async ({
    page,
}) => {
    await withTestActions(page);
    await openMap(page, EDITOR_MODE);
    const click = await clickGareth(page);
    await expect(page.getByTestId("editor-menu")).toBeVisible();
    const free = await freeSpot(page);
    await page.mouse.click(free.x, free.y);
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
    expect(await subject(page)).toBeUndefined();
    // Noch einmal Gareth, dann Escape (nur das Menü zu) und derselbe Ort an leicht anderer Stelle: Das Menü kommt wieder.
    await page.mouse.click(click.x, click.y);
    await expect(page.getByTestId("editor-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
    // 🪤 Zwei Klicks auf denselben Ort binnen `DOPPELKLICK_MS` sind ein Doppelklick (R3, WI-0177): Er öffnete das Ortseditor-Fenster
    // statt des Menüs (Sammellauf 3c3fc479 rot). Gemeint ist hier ein neuer Einzelklick.
    await page.waitForTimeout(500); // über `DOPPELKLICK_MS` (400 ms, src/editor-menu/doppelklick.ts)
    await page.mouse.click(click.x + 3, click.y + 2);
    await expect(page.getByTestId("editor-menu")).toBeVisible();
    await expect(page.getByTestId("editor-menu-title")).toHaveText("Gareth");
});

test("🔴 jede Kartenbewegung schließt das Menü: Die Auswahl bleibt, das Menü folgt der Karte nicht", async ({
    page,
}) => {
    await withTestActions(page);
    await openMap(page, EDITOR_MODE);
    await clickGareth(page);
    await expect(page.getByTestId("editor-menu")).toBeVisible();
    // Ziehen der Karte an einer freien Stelle.
    const free = await freeSpot(page);
    await page.mouse.move(free.x, free.y);
    await page.mouse.down();
    await page.mouse.move(free.x + 60, free.y + 20, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
    expect(await subject(page)).toMatchObject({ kind: "place" });
    await expect(page.getByTestId("info-panel")).toBeVisible();
    // Auch das Rad (Zoom).
    await showPlace(page, GARETH, 5);
    const at = await screenOf(page, GARETH);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("editor-menu")).toBeVisible();
    await page.mouse.move(free.x, free.y);
    await page.mouse.wheel(0, -200);
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
});

test("eine Zeile wählen: Das Menü ist zu, der Handler hat den Gegenstand bekommen, die Auswahl bleibt", async ({
    page,
}) => {
    await withTestActions(page);
    await openMap(page, EDITOR_MODE);
    await clickGareth(page);
    await page.getByTestId("editor-action-dev.test").click();
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
    expect(await calls(page)).toEqual([{ id: "dev.test", kind: "place" }]);
    expect(await subject(page)).toMatchObject({ kind: "place" });
    await expect(page.getByTestId("info-panel")).toBeVisible();
});

test("🔴 das Menü nimmt keinen Fokus: Die Leertaste löst keine Action aus, und der Fokus bleibt außerhalb", async ({
    page,
}) => {
    await withTestActions(page);
    await openMap(page, EDITOR_MODE);
    await clickGareth(page);
    await expect(page.getByTestId("editor-menu")).toBeVisible();
    expect(
        await page.evaluate(() =>
            document.querySelector('[data-testid="editor-menu"]')?.contains(document.activeElement),
        ),
    ).toBe(false);
    // Im Editor fixiert die Leertaste die Auswahl (WI-0063 4.11); sie darf nicht die erste Zeile des Menüs „drücken“.
    await page.keyboard.press("Space");
    expect(await calls(page)).toEqual([]);
});

test("🔴 solange das Menü offen ist, ruht das Zeigen auf der Karte; danach zeigt der Ort sein Schild wieder", async ({
    page,
}) => {
    await withTestActions(page);
    await openMap(page, EDITOR_MODE);
    const click = await clickGareth(page);
    await expect(page.getByTestId("editor-menu")).toBeVisible();
    // Ohne Menü zeigte der Zeiger über dem Ortszeichen das Schild „Name · Art“; mit Menü schweigt es.
    await page.mouse.move(click.x + 1, click.y + 1);
    await settleFrame(page);
    await page.mouse.move(click.x + 2, click.y);
    await settleFrame(page);
    await expect(page.getByTestId("pointer-hint")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
    await page.mouse.move(click.x, click.y);
    await expect(page.getByTestId("pointer-hint")).toBeVisible();
});

test("🔴 ein Besucher sieht nie ein Menü, auch mit eingeschalteten Testaktionen (Kriterium 2); das Infopanel bleibt", async ({
    page,
}) => {
    await withTestActions(page);
    await page.goto("/?besucher");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await clickGareth(page);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
});

test("🔴 auf der öffentlichen Karte (`/`) gibt es kein Menü, auch nicht für einen Editor (Betreiber 2026-10-09)", async ({
    page,
}) => {
    await withTestActions(page);
    await openMap(page);
    await clickGareth(page);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
});

test("eine Suche schließt das Menü: Es gehört dem Gegenstand, den ein Klick der Karte wählte", async ({ page }) => {
    await withTestActions(page);
    await openMap(page, EDITOR_MODE);
    await clickGareth(page);
    await expect(page.getByTestId("editor-menu")).toBeVisible();
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill("Gareth");
    await page.locator('[data-testid="search-hit"][data-kind="ort"]').first().click();
    await expect(page.getByTestId("search")).toBeHidden();
    await expect(page.getByTestId("editor-menu")).toHaveCount(0);
});

test.describe("Flächen", () => {
    const REGIONS = "landscape-fill-vegetation";

    /** Zwei Punkte derselben einzelnen Fläche (genau eine Region darunter), weit genug auseinander, ohne Ort in der Nähe. */
    /** Punkte (Seitenkoordinaten) einer einzelnen Fläche, von denen mindestens zwei weiter als 70 px auseinanderliegen. */
    async function pointsOfOneRegion(page: Page): Promise<{ x: number; y: number }[]> {
        const found = await page.evaluate((layer) => {
            const map = globalThis.avesmapsMap!;
            const canvas = map.getCanvas();
            const rect = canvas.getBoundingClientRect();
            // 🔴 Was dem Klick auf die Fläche vorgeht (Rang über 40, `interaction/priorities.ts`): Orte, die Route und die Wege. Die Wege
            // (`path-hit-<wegart>`, Rang 45) gehören dazu: Fehlten sie hier, hing der Treffpunkt an der Startansicht der Karteneinstellungen
            // (`/api/map-settings`: Antwort ja oder nein, gespeicherter Startzoom), und mit der gespeicherten lag die Reichsstraße 3 unter
            // ihm - der Klick wählte den Weg statt der Fläche (Release-Test d80313c07).
            const markers = [
                "place-marker",
                "place-marker-structure",
                "route-hit",
                "route-markers",
                ...(map.getStyle().layers ?? []).map((l) => l.id).filter((id) => id.startsWith("path-hit-")),
            ].filter((id) => map.getLayer(id));
            const byRegion = new Map<string, { x: number; y: number }[]>();
            for (let y = 150; y < canvas.clientHeight - 150; y += 19) {
                for (let x = 420; x < canvas.clientWidth - 450; x += 23) {
                    const ids = new Set(
                        map
                            .queryRenderedFeatures([x, y], { layers: [layer] })
                            .map((f) => String(f.properties["region_public_id"])),
                    );
                    const around = [
                        [x - 16, y - 16],
                        [x + 16, y + 16],
                    ] as [[number, number], [number, number]];
                    if (ids.size !== 1 || map.queryRenderedFeatures(around, { layers: markers }).length > 0) continue;
                    if (document.elementFromPoint(rect.left + x, rect.top + y) !== canvas) continue;
                    const id = [...ids][0]!;
                    byRegion.set(id, [...(byRegion.get(id) ?? []), { x: rect.left + x, y: rect.top + y }]);
                }
            }
            for (const points of byRegion.values()) {
                const first = points[0]!;
                if (points.some((p) => Math.hypot(p.x - first.x, p.y - first.y) > 70)) return points;
            }
            return null;
        }, REGIONS);
        if (!found) throw new Error("keine einzelne Fläche mit zwei Punkten");
        return found;
    }

    /**
     * Der zweite Punkt, gewählt NACH dem ersten Klick: Der öffnet das Infopanel, die obere Ecke rückt nach links, und der Hinweis
     * „Karte drehen und neigen“ (`camera-hint`) lag danach über dem vorher gewählten zweiten Punkt (Sammellauf 3c3fc479). Nur wo
     * jetzt die Karte selbst oben liegt.
     */
    async function secondPoint(page: Page, points: { x: number; y: number }[]): Promise<{ x: number; y: number }> {
        const first = points[0]!;
        const free = await page.evaluate(
            (candidates) => {
                const canvas = globalThis.avesmapsMap!.getCanvas();
                return candidates.filter((p) => document.elementFromPoint(p.x, p.y) === canvas);
            },
            points.filter((p) => Math.hypot(p.x - first.x, p.y - first.y) > 70),
        );
        if (free.length === 0) throw new Error("kein freier zweiter Punkt auf der Fläche");
        return free[0]!;
    }

    test("🔴 ein Klick auf eine einzelne Fläche wählt sie wie im Frontend, ohne Menü; auch ein zweiter Klick an anderer Stelle bringt keins", async ({
        page,
    }) => {
        // WI-0178, Betreiber 2026-10-21, wörtlich: „kannst du zum abschluss noch verhindern, dass beim linksklick diese menüs kommen und nur
        // eine normale auswahl wie im frontend passiert.“ Kehrt T58 (2) um: kein Kartenmenü und kein Menü am Objekt; Bearbeiten über den
        // Rechtsklick.
        await withTestActions(page);
        // 🔴 Die Kamera nennt die Adresse: Ohne sie gilt die Startansicht der Karteneinstellungen (`/api/map-settings`, gespeicherter
        // Startzoom), und die liegt lokal, im Release-Test und auf der Stage anderswo - dann lag die Reichsstraße 3 unter dem Treffpunkt.
        await openMap(page, `${EDITOR_MODE}#x=518.750&y=493.747&z=2.50&series=modern`);
        await showLandscapes(page, "vegetation");
        const points = await pointsOfOneRegion(page);
        const first = points[0]!;
        await page.mouse.click(first.x, first.y);
        await expect(page.getByTestId("info-panel")).toBeVisible();
        expect(await subject(page)).toMatchObject({ kind: "area" });
        await expect(page.getByTestId("context-editor")).toHaveCount(0);
        await expect(page.getByTestId("editor-menu")).toHaveCount(0);
        // Die Ecke oben rückt mit dem Infopanel (Übergang 0,22 s); erst danach steht fest, was über der Karte liegt.
        await page.waitForTimeout(400);
        const second = await secondPoint(page, points);
        await page.mouse.click(second.x, second.y);
        expect(await subject(page)).toMatchObject({ kind: "area" });
        await expect(page.getByTestId("context-editor")).toHaveCount(0);
        await expect(page.getByTestId("editor-menu")).toHaveCount(0);
        // Der Rechtsklick bringt das Editor-Menü wie bisher.
        await page.mouse.click(second.x, second.y, { button: "right" });
        await expect(page.getByTestId("context-editor")).toBeVisible();
    });

    test("🔴 wo mehrere Flächen übereinanderliegen, öffnet der Klick die Liste und KEIN Menü; auch der Eintrag der Liste bringt keins", async ({
        page,
    }) => {
        await withTestActions(page);
        // Im Kosch liegen Gebirge ineinander (area-selection.spec.ts, Stufe 2).
        await page.goto(`${EDITOR_MODE}#x=468&y=527&z=6&series=original&view=landscapes&layer=topographie`);
        await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
        await settleFrame(page);
        const spot = await page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            const canvas = map.getCanvas();
            const rect = canvas.getBoundingClientRect();
            let best = { n: 0, x: 0, y: 0 };
            for (let y = 140; y < canvas.clientHeight - 140; y += 17) {
                for (let x = 420; x < canvas.clientWidth - 440; x += 19) {
                    const ids = new Set(
                        map
                            .queryRenderedFeatures([x, y], { layers: ["landscape-fill-topographie"] })
                            .map((f) => f.properties["region_public_id"]),
                    );
                    const free = ["place-marker", "place-marker-structure"].every(
                        (id) => !map.getLayer(id) || map.queryRenderedFeatures([x, y], { layers: [id] }).length === 0,
                    );
                    if (free && ids.size > best.n) best = { n: ids.size, x, y };
                }
            }
            return { ...best, x: rect.left + best.x, y: rect.top + best.y };
        });
        expect(spot.n, "eine Stelle mit mehreren Flächen").toBeGreaterThan(1);
        await page.mouse.click(spot.x, spot.y);
        await expect(page.getByTestId("area-choice")).toHaveCount(spot.n);
        await expect(page.getByTestId("info-panel")).toBeVisible();
        // Gewählt ist erst, was die Liste wählt: kein Menü neben der Liste.
        await expect(page.getByTestId("editor-menu")).toHaveCount(0);
        // Der Eintrag wählt nur, ohne Untermenü (WI-0178, Betreiber 2026-10-21: „aber keine untermenüs mehr haben“).
        await expect(page.getByTestId("area-choices").getByRole("menu")).toHaveCount(0);
        await page.getByTestId("area-choice").nth(1).click();
        await expect(page.getByTestId("area-choice")).toHaveCount(0);
        await expect(page.getByTestId("editor-menu")).toHaveCount(0);
        expect(await subject(page)).toMatchObject({ kind: "area" });
    });
});
