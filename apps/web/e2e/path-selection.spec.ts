import { expect, test, type Page } from "@playwright/test";
import { chooseFromFan, GARETH, settleFrame, showPlace } from "./map-handle.ts";

/**
 * Wege sind auf der Karte anklickbar (WI-0090, Betreiber 2026-10-06: „wege kann man noch nicht anklicken, kannst du das
 * mal für die standardansicht machen?“). Die Abnahmefälle A1 bis A13 aus § 5 des Work Items, am echten Stack.
 *
 * 🔴 **Die Regel in einem Satz: Die Auswahl ist überall gleich; der Unterschied sitzt allein in der Vorschau.** Ein
 * Schild beim Zeigen kommt immer, die gestrichelte Umrandung nur dort, wo genau eine Landschaftsebene das Bild trägt.
 *
 * 🪤 Die Stellen werden GESUCHT, nicht geraten: Welche Wege wo liegen, hängt an Zoom, Fenstergröße und Kachelstand. Ein
 * Test mit festem Bildpunkt wäre rot geworden, ohne dass etwas falsch ist. Gesucht wird in der unsichtbaren
 * Trefferebene (`path-hit-*`) - derselben, die der Besitzer fragt.
 *
 * 🪤 Ob GESTRICHELT wird, steht nicht im Bild, sondern in der Quelle der Vorschau-Ebene: Die Quelle `path-preview` liegt
 * immer im Stil, leer, und bekommt nur dort die Linien der Kette gesetzt (WI-0266). Das ist genau die Stelle, an der die Regel
 * wirkt - ein Pixelvergleich würde an der Linienbreite scheitern, nicht an der Regel.
 */

const PREVIEW_LAYER = "path-preview";

/** Ein Weg unter dem Zeiger: wo er im Bild liegt, und was die Kachel über ihn sagt. */
interface Spot {
    x: number;
    y: number;
    layer: string;
    name: string;
    subtype: string;
}

async function openView(page: Page, view: string, layer?: string): Promise<void> {
    const hash = `#x=${String(GARETH.x)}&y=${String(GARETH.y)}&z=6.5&series=original&view=${view}${
        layer === undefined ? "" : `&layer=${layer}`
    }`;
    // Jede Runde lädt neu: Eine reine Änderung der Adressraute wechselt die Ansicht nicht.
    await page.goto(`/?wi0090=${view}-${layer ?? "-"}${hash}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await settleFrame(page);
}

/** Die Trefferebenen der Wege, die gerade im Stil stehen. */
const hitLayers = (page: Page): Promise<string[]> =>
    page.evaluate(() =>
        (globalThis.avesmapsMap?.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => id.startsWith("path-hit-")),
    );

/**
 * Eine Stelle, an der ein benannter Weg der gewünschten Art unter dem Zeiger liegt - und an der die Leinwand der Karte
 * vorn liegt (am oberen Rand decken Fächer und Suche sie, und ein Klick landete im Bauteil).
 *
 * 🪤 BENANNT heißt seit WI-0105 auch: KEIN GRIFF. 5.092 der 9.506 Wege heißen `Pfad-3443` oder `Strasse-113`, und
 * die Trefferebenen kennen `label_visible` nicht - diese Suche fand sie also regelmäßig. Panel und Schild zeigen dort
 * jetzt „Unbezeichnete Straße“, und diese Fälle prüfen die AUSWAHL, nicht die Benennung. Dass ein Griff richtig
 * heißt, sichert `e2e/unbezeichnet.spec.ts`.
 */
async function spotOf(page: Page, wanted?: string, echterName = false): Promise<Spot | undefined> {
    const layers = await hitLayers(page);
    if (layers.length === 0) return undefined;
    const found = await page.evaluate(
        ({ ids, want, echt, griff }) => {
            const map = globalThis.avesmapsMap;
            if (!map) throw new Error("map handle missing");
            const canvas = map.getCanvas();
            const box = canvas.getBoundingClientRect();
            // Ein Ort oder Bauwerk auf dem Weg gewinnt (A8); eine solche Stelle prüft nicht den Weg.
            const placeIds = (map.getStyle().layers ?? [])
                .filter((layer) => "source" in layer && layer.source === "places")
                .map((layer) => layer.id);
            for (let y = 150; y < canvas.clientHeight - 150; y += 4) {
                for (let x = 420; x < canvas.clientWidth - 440; x += 4) {
                    if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
                    if (placeIds.length > 0 && map.queryRenderedFeatures([x, y], { layers: placeIds }).length > 0)
                        continue;
                    const hits = map
                        .queryRenderedFeatures([x, y], { layers: ids })
                        .filter((hit) => String(hit.properties["name"] ?? "").trim() !== "");
                    const first = hits[0];
                    if (!first) continue;
                    // 💣 Geprüft wird der OBERSTE Treffer, denn genau den wählt auch die Anwendung. Ein Griff weiter unten
                    // in der Liste zu überspringen hätte den Fall gegen einen anderen Weg messen lassen als den geklickten.
                    const ersterName = String(first.properties["name"]).trim();
                    if (
                        echt &&
                        (new RegExp(griff, "u").test(ersterName) || ersterName === String(first.properties["subtype"]))
                    )
                        continue;
                    if (want !== undefined && String(first.properties["subtype"]) !== want) continue;
                    return {
                        x,
                        y,
                        layer: first.layer.id,
                        name: String(first.properties["name"]).trim(),
                        subtype: String(first.properties["subtype"]),
                    };
                }
            }
            return undefined;
        },
        { ids: layers, want: wanted, echt: echterName, griff: "^\\S+-\\d+$" },
    );
    return found;
}

/** Die Stelle im Fenster, an der geklickt wird. */
async function windowPoint(page: Page, spot: { x: number; y: number }): Promise<{ x: number; y: number }> {
    const box = await page.getByTestId("map").boundingBox();
    return { x: (box?.x ?? 0) + spot.x, y: (box?.y ?? 0) + spot.y };
}

/**
 * Was die Vorschau der Wege gerade strichelt (WI-0266): die Linien in ihrer kleinen Quelle `path-preview`, je mit der Art ihres Abschnitts.
 * Keine Linie heißt: kein Weg gestrichelt. Die Linien tragen keinen Namen - die Kette selbst bestimmt der Einheitentest.
 */
const outlined = (page: Page): Promise<{ lines: number; subtypes: string[] }> =>
    page.evaluate((layer) => {
        const map = globalThis.avesmapsMap as unknown as
            | {
                  getLayer(id: string): unknown;
                  getSource(
                      id: string,
                  ): { serialize(): { data?: { features?: { properties?: Record<string, unknown> }[] } } } | undefined;
              }
            | undefined;
        if (!map || map.getLayer(layer) === undefined) return { lines: 0, subtypes: [] };
        const features = map.getSource(layer)?.serialize().data?.features ?? [];
        return {
            lines: features.length,
            subtypes: [...new Set(features.map((entry) => String(entry.properties?.["subtype"])))],
        };
    }, PREVIEW_LAYER);

/** Die Arten der Abschnitte einer Kette in den geladenen Kacheln: Was die Vorschau dieser Kette tragen darf. */
const chainSubtypes = (page: Page, name: string): Promise<string[]> =>
    page.evaluate((chain) => {
        const map = globalThis.avesmapsMap;
        if (!map) return [];
        const sections = map.querySourceFeatures("paths", { sourceLayer: "path_render" });
        return [
            ...new Set(
                sections
                    .filter((entry) => entry.properties["name"] === chain)
                    .map((entry) => String(entry.properties["subtype"])),
            ),
        ];
    }, name);

async function hover(page: Page, spot: { x: number; y: number }): Promise<void> {
    const at = await windowPoint(page, spot);
    await page.mouse.move(at.x - 30, at.y - 30);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.waitForTimeout(400);
}

async function click(page: Page, spot: { x: number; y: number }): Promise<void> {
    const at = await windowPoint(page, spot);
    await page.mouse.click(at.x, at.y);
    await page
        .waitForFunction(() => globalThis.avesmapsSelectedSubject?.() !== undefined, undefined, { timeout: 8_000 })
        .catch(() => undefined);
}

const chosen = (page: Page): Promise<{ kind?: string; id?: string; name?: string | null; type?: string } | undefined> =>
    page.evaluate(() => {
        const area = globalThis.avesmapsAreaSelection?.();
        return area ? { kind: area.kind, id: area.id, name: area.name, type: area.type } : undefined;
    });

/** Alles zu, damit der nächste Klick auf die Karte trifft und nicht auf ein offenes Panel. */
async function clear(page: Page): Promise<void> {
    for (let i = 0; i < 3; i += 1) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);
    }
}

// -----------------------------------------------------------------------------------------------------------------

test("🔴 A1: ein Klick auf eine Reichsstraße öffnet ihr Panel - im Browser, nicht nur als Ereignis", async ({
    page,
}) => {
    await openView(page, "landscapes", "alle");
    await expect(page.getByTestId("info-panel")).toBeHidden();
    const spot = await spotOf(page, "Reichsstrasse", true);
    expect(spot, "eine benannte Reichsstraße im Bild").toBeDefined();
    await click(page, spot!);
    // 💣 Die Öffnungsnaht: Hier ging die Etappenliste einmal vorbei (WI-0087 P2). Geprüft wird das PANEL, nicht das Ereignis.
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect(page.getByTestId("info-title")).toHaveText(spot!.name);
    expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind)).toBe("path");
    expect(await chosen(page)).toMatchObject({ kind: "path", type: "Reichsstrasse", name: spot!.name });
});

test("🔴 A1b: jede gezeichnete Wegart öffnet ihr Panel", async ({ page }) => {
    await openView(page, "landscapes", "alle");
    const arten = await hitLayers(page);
    expect(arten.length, "Trefferebenen im Stil").toBeGreaterThan(0);
    const geprueft: string[] = [];
    for (const art of ["Reichsstrasse", "Strasse", "Weg", "Pfad"] as const) {
        const spot = await spotOf(page, art, true);
        if (!spot) continue;
        await clear(page);
        await click(page, spot);
        await expect(page.getByTestId("info-panel")).toBeVisible();
        await expect(page.getByTestId("info-title")).toHaveText(spot.name);
        geprueft.push(art);
    }
    expect(geprueft.length, "mindestens zwei Wegarten im Bild geprüft").toBeGreaterThanOrEqual(2);
});

test("🔴 A2: Zeigen auf einen Weg in der Ansicht „Standard“ - Schild, KEINE Strichelung", async ({ page }) => {
    // „Standardansicht“ ist der Kartenfächer auf „Standard“ (WI-0090 O2, Betreiber 2026-10-09).
    await openView(page, "standard");
    const spot = await spotOf(page, undefined, true);
    expect(spot).toBeDefined();
    await hover(page, spot!);
    await expect(page.getByTestId("pointer-hint")).toBeVisible();
    await expect(page.getByTestId("pointer-hint")).toContainText(spot!.name);
    expect(await page.evaluate(() => globalThis.avesmapsMap?.getCanvas().style.cursor)).toBe("pointer");
    // 🔴 Der Kern des Pakets: in der ruhigen Ansicht blitzt nichts Gestricheltes auf.
    expect((await outlined(page)).lines, "kein Weg gestrichelt").toBe(0);
});

// Jede Ansicht außer „Standard“ strichelt, auch die Landschaften mit „Alle“ (WI-0090 O2, Betreiber 2026-10-09).
for (const layer of ["alle", "topographie", "vegetation", "derographisch"] as const) {
    test(`🔴 A3: Zeigen auf einen Weg in ${layer} - Schild UND Strichelung`, async ({ page }) => {
        await openView(page, "landscapes", layer);
        const spot = await spotOf(page, undefined, true);
        expect(spot).toBeDefined();
        await hover(page, spot!);
        await expect(page.getByTestId("pointer-hint")).toContainText(spot!.name);
        const strich = await outlined(page);
        expect(strich.lines, "der gezeigte Weg ist gestrichelt").toBeGreaterThan(0);
        // Und es sind Linien DIESER Kette: Jede Linie trägt die Art eines Abschnitts mit dem Namen des gezeigten Wegs.
        const arten = await chainSubtypes(page, spot!.name);
        for (const art of strich.subtypes) expect(arten, `${layer}: ${art} gehört zu ${spot!.name}`).toContain(art);
    });
}

test("🔴 A4 und A5: die Auswahl ist überall dieselbe, und ein Ansichtswechsel ändert sie nicht", async ({ page }) => {
    await openView(page, "landscapes", "alle");
    const spot = await spotOf(page, "Strasse");
    expect(spot).toBeDefined();
    await click(page, spot!);
    const inAlle = await chosen(page);
    expect(inAlle).toMatchObject({ kind: "path", type: "Strasse" });
    // A4: dieselbe Markierung in einer Landschaftsebene - die goldene Linie steht im Stil, in Legacys Breite.
    const markierung = async (): Promise<{ present: boolean; width?: unknown; opacity?: unknown }> =>
        page.evaluate(() => {
            const map = globalThis.avesmapsMap;
            if (!map || map.getLayer("area-selection-path") === undefined) return { present: false };
            return {
                present: true,
                width: map.getPaintProperty("area-selection-path", "line-width"),
                opacity: map.getPaintProperty("area-selection-path", "line-opacity"),
            };
        });
    const inAlleLook = await markierung();
    expect(inAlleLook.present, "die goldene Linie steht").toBe(true);

    // A5: Ansicht wechseln, ohne neu zu laden - die Auswahl bleibt, die Markierung ändert sich nicht.
    await chooseFromFan(page, "landscapes", "fan-layer-topographie");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    expect(await chosen(page), "die Auswahl bleibt").toMatchObject({ kind: "path", id: inAlle?.id });
    expect(await markierung(), "die Markierung ist dieselbe").toEqual(inAlleLook);
});

test("🔴 A6 und A7: der Fluss folgt derselben Regel - Schild und Strichelung in „Alle“ wie in Topographie", async ({
    page,
}) => {
    // 🪤 In der Ansicht „Standard“ sind Flüsse Teil des Kartenbilds und gar nicht wählbar (keine Ebene `path-*-flussweg`); in
    // jeder Landschaftsebene, auch „Alle“, bekommen sie Schild UND Strichelung (WI-0090 O2, Betreiber 2026-10-09).
    for (const [layer, strichelung] of [
        ["alle", true],
        ["topographie", true],
    ] as const) {
        await openView(page, "landscapes", layer);
        const spot = await spotOf(page, "Flussweg", true);
        expect(spot, `ein benannter Fluss im Bild (${layer})`).toBeDefined();
        await hover(page, spot!);
        await expect(page.getByTestId("pointer-hint"), layer).toContainText(spot!.name);
        // Fluss und Bach behalten ihre gewohnten Wörter.
        await expect(page.getByTestId("pointer-hint"), layer).toContainText(/Fluss|Bach/);
        const strich = await outlined(page);
        if (strichelung) expect(strich.lines, `${layer}: Strichelung`).toBeGreaterThan(0);
        else expect(strich.lines, `${layer}: keine Strichelung`).toBe(0);
        await clear(page);
        await click(page, spot!);
        expect(await chosen(page), layer).toMatchObject({ kind: "path", type: "Flussweg" });
    }
});

test("🔴 A8: ein Ort auf einem Weg gewinnt", async ({ page }) => {
    await openView(page, "landscapes", "alle");
    await showPlace(page, GARETH, 6.5);
    // Die Stelle von Gareth: dort laufen Reichsstraßen zusammen, der Ort liegt darüber.
    const box = await page.getByTestId("map").boundingBox();
    const at = await page.evaluate(
        (target) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(target)),
        GARETH,
    );
    const unterZeiger = await page.evaluate(
        ({ point }) => {
            const map = globalThis.avesmapsMap!;
            const ids = (map.getStyle().layers ?? [])
                .map((layer) => layer.id)
                .filter((id) => id.startsWith("path-hit-"));
            return map.queryRenderedFeatures([point.x, point.y], { layers: ids }).length;
        },
        { point: at },
    );
    expect(unterZeiger, "unter Gareth liegt mindestens ein Weg").toBeGreaterThan(0);
    await page.mouse.click((box?.x ?? 0) + at.x, (box?.y ?? 0) + at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind)).toBe("place");
    expect(await chosen(page), "kein Weg gewählt").toBeUndefined();
});

test("🔴 A9: eine Route über einem Weg gewinnt - sie wird entlang der Wege gerechnet", async ({ page }) => {
    await page.goto("/?route=Gareth~Perricum");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.getLayer("route-hit") !== undefined, undefined, {
        timeout: 60_000,
    });
    await settleFrame(page);
    // Eine Stelle, an der Route UND Weg unter dem Zeiger liegen.
    const spot = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        const box = canvas.getBoundingClientRect();
        const wege = (map.getStyle().layers ?? []).map((layer) => layer.id).filter((id) => id.startsWith("path-hit-"));
        for (let y = 150; y < canvas.clientHeight - 150; y += 4) {
            for (let x = 420; x < canvas.clientWidth - 440; x += 4) {
                if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
                if (map.queryRenderedFeatures([x, y], { layers: ["route-hit"] }).length === 0) continue;
                if (map.queryRenderedFeatures([x, y], { layers: wege }).length === 0) continue;
                return { x, y };
            }
        }
        return undefined;
    });
    expect(spot, "eine Stelle, an der die Route auf einem Weg liegt").toBeDefined();
    await click(page, spot!);
    expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind)).toBe("routeStage");
    expect(await chosen(page), "kein Weg gewählt").toBeUndefined();
});

test("🔴 A10: ein Klick knapp neben die Linie trifft, mit der Toleranz der Route", async ({ page }) => {
    await openView(page, "landscapes", "alle");
    const spot = await spotOf(page);
    expect(spot).toBeDefined();
    // Die Trefferbreite ist die der Route (14 px am Zeiger): Ein Klick 5 px neben der Mitte muss noch treffen.
    const abstand = await page.evaluate(
        ({ point, layer }) => {
            const map = globalThis.avesmapsMap!;
            // Die größte Entfernung, in der die Trefferebene desselben Wegs noch anspricht (nach oben gemessen).
            let weitest = 0;
            for (let d = 1; d <= 10; d += 1) {
                const hits = map.queryRenderedFeatures([point.x, point.y - d], { layers: [layer] });
                if (hits.length > 0) weitest = d;
            }
            return weitest;
        },
        { point: { x: spot!.x, y: spot!.y }, layer: spot!.layer },
    );
    expect(abstand, "die Trefferebene reicht mehrere Bildpunkte neben die Linie").toBeGreaterThanOrEqual(4);
    // Und der Klick dort wählt denselben Weg.
    await click(page, { x: spot!.x, y: spot!.y - abstand });
    expect(await chosen(page)).toMatchObject({ kind: "path", name: spot!.name });
});

test("🔴 A12 (gemessen): in den Klimazonen sind Wege GEZEICHNET, aber nur das Band ist wählbar", async ({ page }) => {
    // 🔴 Der Befund des Pakets (WI-0090 O1): Die Wege stehen voll im Stil der Klimaansicht. Dass sie dort trotzdem
    // nicht teilnehmen, ist die Entscheidung des Betreibers vom 2026-10-05 („nur klimazonen klickbar“) - umlegen
    // wäre eine Zeile in `LAYER_OWNERS`.
    await openView(page, "landscapes", "klima");
    const gezeichnet = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        const ids = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((id) => id.startsWith("path-center-") || id.startsWith("path-outline-"));
        const flaeche: [[number, number], [number, number]] = [
            [0, 0],
            [canvas.clientWidth, canvas.clientHeight],
        ];
        return {
            ebenen: ids.length,
            features: ids.length > 0 ? map.queryRenderedFeatures(flaeche, { layers: ids }).length : 0,
        };
    });
    expect(gezeichnet.ebenen, "Wegebenen im Stil der Klimaansicht").toBeGreaterThan(0);
    expect(gezeichnet.features, "gezeichnete Wege im Bild").toBeGreaterThan(0);
    // Und trotzdem nimmt kein Weg teil: Der Klick fällt auf das Band, und das Schild nennt die Klimazone, nicht den Weg.
    const spot = await spotOf(page);
    expect(spot, "ein benannter Weg im Bild").toBeDefined();
    await hover(page, spot!);
    // 🪤 Ein Schild STEHT hier - es gehört dem Band unter dem Weg (Rang 30, der einzige Teilnehmer dieser Ansicht).
    // Geprüft wird deshalb, WEM es gehört, nicht ob es da ist.
    const schild = page.getByTestId("pointer-hint");
    await expect(schild).toBeVisible();
    await expect(schild).toContainText("Klimazone");
    await expect(schild).not.toContainText(spot!.name);
    expect((await outlined(page)).lines, "kein Weg gestrichelt").toBe(0);
    await click(page, spot!);
    expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind)).toBe("climate");
    expect(await chosen(page)).toBeUndefined();
});

test("🔴 A13: ein Klick auf die leere Karte beendet die Auswahl wie bisher", async ({ page }) => {
    await openView(page, "landscapes", "alle");
    const spot = await spotOf(page);
    expect(spot).toBeDefined();
    await click(page, spot!);
    expect(await chosen(page)).toMatchObject({ kind: "path" });
    // Eine Stelle ohne Weg, ohne Ort, ohne Fläche: über dem Meer.
    const leer = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        const box = canvas.getBoundingClientRect();
        const ids = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter(
                (id) =>
                    id.startsWith("path-hit-") ||
                    id.startsWith("landscape-fill-") ||
                    id === "gewaesser-flaeche" ||
                    id === "gewaesser-grund" ||
                    id === "place-marker" ||
                    id === "place-marker-structure" ||
                    id === "area-selection-fill" ||
                    id === "area-selection-path" ||
                    id === "route-hit",
            );
        for (let y = 150; y < canvas.clientHeight - 150; y += 7) {
            for (let x = 420; x < canvas.clientWidth - 440; x += 7) {
                if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
                const around: [[number, number], [number, number]] = [
                    [x - 18, y - 18],
                    [x + 18, y + 18],
                ];
                if (map.queryRenderedFeatures(around, { layers: ids }).length === 0) return { x, y };
            }
        }
        return undefined;
    });
    if (leer === undefined) {
        test.info().annotations.push({ type: "Befund", description: "keine freie Stelle im Bild - A13 nicht geprüft" });
        return;
    }
    const at = await windowPoint(page, leer);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(500);
    expect(await chosen(page), "die Auswahl ist beendet").toBeUndefined();
    await expect(page.getByTestId("info-panel")).toBeHidden();
});
