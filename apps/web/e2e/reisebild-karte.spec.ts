import { expect, test, type Page } from "@playwright/test";
import { stubReisebilderKarte, GARETH_ORT, type KartenBild, type KartenAttrappe } from "./reisebild-stub.ts";
import { chooseView, GARETH, openMap, selectedPlace, settleFrame, showPlace } from "./map-handle.ts";

/**
 * Die Reisebilder auf der Karte (WI-0272 S4, Aufgabe 27): Zeichen, Bündel, Fahne am Ortsmarker, Klick über den Koordinator, Ansichten, Ruhe. Der Lesepfad ist eine Attrappe
 * (`reisebild-stub.ts`, `stubReisebilderKarte`); Knopf und Leiste prüft `reisebild-leiste.spec.ts`.
 *
 * Problemfälle: ein Zeichen fehlt oder steht doppelt; zwei nahe Bilder bündeln beim Herauszoomen nicht oder beim Hereinzoomen immer noch; die Fahne taucht ohne ihren Marker auf oder fehlt mit ihm; die Fahne
 * deckt den Marker; ein Bild auf einem Namen bleibt als freies Zeichen daneben stehen; ein Klick auf das Symbol öffnet den Ort darunter, ein Klick daneben nicht mehr; der Rechtsklick öffnet kein Kartenmenü;
 * andere Ansichten zeigen Ebenen oder Treffer; die Rückkehr fragt neu; die Auswahl eines Orts baut die Ebenen neu oder fragt neu; `setData` ohne Änderung; `DataCloneError` oder Fehler in der Konsole.
 */

interface ZeichenProbe {
    readonly schluessel: string;
    readonly bild: string;
    readonly x: number;
    readonly y: number;
}

/** Ein Punkt der Karte als Länge/Breite (Renderkoordinaten) und als Bildpunkt der Seite. */
async function seite(page: Page, punkt: { x: number; y: number }): Promise<{ x: number; y: number }> {
    return page.evaluate((p) => {
        const map = globalThis.avesmapsMap!;
        const projektion = globalThis.avesmapsRenderProjection!;
        const am = map.project(projektion.toRenderLngLat(p));
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + am.x, y: rahmen.top + am.y };
    }, punkt);
}

/** Die Zeichen der Quelle `photobox-bilder`, wie die Karte sie gerade trägt, mit ihrer Stelle auf der Seite. */
async function zeichen(page: Page): Promise<ZeichenProbe[]> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        if (map.getLayer("photobox-zeichen") === undefined) return [];
        const rahmen = map.getCanvas().getBoundingClientRect();
        // Eine GeoJSON-Quelle liefert dasselbe Merkmal aus mehreren Kacheln: je Schlüssel einmal.
        const einmal = new Map(
            map.querySourceFeatures("photobox-bilder").map((m) => [String(m.properties["schluessel"]), m]),
        );
        return [...einmal.values()].map((merkmal) => {
            const [lng, lat] = (merkmal.geometry as unknown as { coordinates: [number, number] }).coordinates;
            const am = map.project({ lng, lat });
            return {
                schluessel: String(merkmal.properties["schluessel"]),
                bild: String(merkmal.properties["bild"]),
                x: rahmen.left + am.x,
                y: rahmen.top + am.y,
            };
        });
    });
}

/** Die Fahnen der Quelle `photobox-fahnen`: ihre Bildkennung und die Kennung des Orts. */
async function fahnen(page: Page): Promise<{ bild: string; ort: string }[]> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        if (map.getSource === undefined || map.getLayer("photobox-fahne") === undefined) return [];
        const einmal = new Map(
            map.querySourceFeatures("photobox-fahnen").map((m) => [String(m.properties["schluessel"]), m]),
        );
        return [...einmal.values()].map((m) => ({
            bild: String(m.properties["bild"]),
            ort: String(m.properties["public_id"]),
        }));
    });
}

/** Was der Zustand der Reisebilder gerade hält (Entwicklungs-Handle `avesmapsReisebilder`). */
interface Stand {
    readonly leisteOffen: boolean;
    readonly markiert: string[];
    readonly bilder: number;
    readonly imBild: number;
}
const stand = (page: Page): Promise<Stand> =>
    page.evaluate(() => {
        const z = (
            globalThis as unknown as {
                avesmapsReisebilder: {
                    leisteOffen: { value: boolean };
                    markiert: { value: ReadonlySet<string> };
                    bilder: { value: readonly unknown[] };
                    imBild: { value: readonly unknown[] };
                };
            }
        ).avesmapsReisebilder;
        return {
            leisteOffen: z.leisteOffen.value,
            markiert: [...z.markiert.value],
            bilder: z.bilder.value.length,
            imBild: z.imBild.value.length,
        };
    });

async function warteAufLauf(page: Page, attrappe: KartenAttrappe): Promise<void> {
    await expect.poll(() => attrappe.abrufe, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await stand(page)).bilder, { timeout: 15_000 }).toBeGreaterThan(0);
}

/** Der Ort Gareth, wie der Lesepfad ihn nennt (`ReisebildKarte.ort`). */
const gareth = {
    id: GARETH_ORT.id,
    name: GARETH_ORT.name,
    subtype: GARETH_ORT.subtype,
    lage: { x: GARETH.x, y: GARETH.y },
};

const frei = (id: string, dx: number, dy: number, mehr: Partial<KartenBild> = {}): KartenBild => ({
    id,
    lage: { x: GARETH.x + dx, y: GARETH.y + dy },
    ...mehr,
});

let fehler: string[];
test.beforeEach(({ page }) => {
    fehler = [];
    page.on("pageerror", (e) => fehler.push(e.stack ?? String(e)));
    page.on("console", (nachricht) => {
        const text = nachricht.text();
        if (nachricht.type() === "error" && /DataCloneError|photobox|reisebild/iu.test(text)) fehler.push(text);
    });
});
test.afterEach(() => {
    expect(fehler).toEqual([]);
});

test("🔴 Zeichen erscheinen; zwei nahe Bilder sind herausgezoomt eine Gruppe mit Zahl 2, nah zwei Zeichen", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const attrappe = await stubReisebilderKarte(page, [
        frei("00000000-0000-4000-8000-0000000000a1", 40, 25),
        frei("00000000-0000-4000-8000-0000000000a2", 42, 27),
        frei("00000000-0000-4000-8000-0000000000a3", -45, -30, { entstehung: "ai_generated" }),
    ]);
    await openMap(page);
    const nah = 8;
    const fern = 3;
    // Zwei Bilder, 2,8 Einheiten auseinander: weit draußen unter dem Fangradius, nah daran weit darüber.
    await showPlace(page, { x: GARETH.x + 41, y: GARETH.y + 26 }, fern);
    await warteAufLauf(page, attrappe);
    await expect.poll(async () => (await zeichen(page)).map((z) => z.bild)).toContain("photobox-zeichen-2");
    await showPlace(page, { x: GARETH.x + 41, y: GARETH.y + 26 }, nah);
    await expect
        .poll(async () => (await zeichen(page)).filter((z) => z.bild === "photobox-zeichen-1").length, {
            timeout: 15_000,
        })
        .toBe(2);
    // Das KI-Bild trägt das Zeichen mit dem Roboter.
    await showPlace(page, { x: GARETH.x - 45, y: GARETH.y - 30 }, nah);
    await expect
        .poll(async () => (await zeichen(page)).map((z) => z.bild), { timeout: 15_000 })
        .toContain("photobox-zeichen-1-ki");
});

test("🔴 Die Fahne steht genau, wenn der Marker steht, auf drei Zoomstufen, und deckt den Marker nicht", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const attrappe = await stubReisebilderKarte(page, [
        frei("00000000-0000-4000-8000-0000000000b1", 0.5, 0.5, {
            ort: gareth,
        }),
        frei("00000000-0000-4000-8000-0000000000b2", -0.5, 0.5, {
            ort: gareth,
        }),
    ]);
    await openMap(page);
    let sah = 0;
    for (const zoom of [2, 5, 8]) {
        await showPlace(page, GARETH, zoom);
        await warteAufLauf(page, attrappe);
        await settleFrame(page);
        const proben = await expect
            .poll(
                async () =>
                    page.evaluate(() => {
                        const map = globalThis.avesmapsMap!;
                        const marker = map
                            .queryRenderedFeatures({ layers: ["place-marker", "place-marker-structure"] })
                            .some((m) => m.properties["name"] === "Gareth");
                        const fahne =
                            map.getLayer("photobox-fahne") !== undefined &&
                            map.queryRenderedFeatures({ layers: ["photobox-fahne"] }).length > 0;
                        return marker === fahne;
                    }),
                { timeout: 15_000, message: `Fahne gleich Marker bei Zoom ${String(zoom)}` },
            )
            .toBe(true);
        void proben;
        const steht = await page.evaluate(
            () => (globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["photobox-fahne"] }).length > 0) as boolean,
        );
        if (steht) {
            sah += 1;
            // Der Kasten der Fahne enthält den Markerpunkt nicht: Dort, wo der Marker seinen Mittelpunkt hat, trifft die Fahne nichts.
            const mitte = await seite(page, GARETH);
            const treffer = await page.evaluate(({ x, y }) => {
                const map = globalThis.avesmapsMap!;
                const rahmen = map.getCanvas().getBoundingClientRect();
                return map.queryRenderedFeatures([x - rahmen.left, y - rahmen.top], { layers: ["photobox-fahne"] })
                    .length;
            }, mitte);
            expect(treffer).toBe(0);
        }
    }
    expect(sah).toBeGreaterThan(0);
    // Beide Bilder hängen an einer Fahne mit Zahl 2.
    await showPlace(page, GARETH, 5);
    await expect.poll(async () => (await fahnen(page)).map((f) => f.bild)).toContain("photobox-fahne-2");
});

test("Ein freies Bild auf einem Namen geht in die Fahne dieses Orts auf", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const attrappe = await stubReisebilderKarte(page, [
        // Genau auf dem Ortspunkt, ohne Ort in der Antwort: Die Karte findet den Marker darunter.
        frei("00000000-0000-4000-8000-0000000000c1", 0, 0),
    ]);
    await openMap(page);
    await showPlace(page, GARETH, 5);
    await warteAufLauf(page, attrappe);
    await expect.poll(async () => (await fahnen(page)).length, { timeout: 15_000 }).toBe(1);
    expect(await zeichen(page)).toEqual([]);
});

test("🔴 Klick auf das Symbol öffnet keinen Ort und die Leiste; daneben öffnet er den Ort; Rechtsklick öffnet das Kartenmenü", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const attrappe = await stubReisebilderKarte(page, [
        frei("00000000-0000-4000-8000-0000000000d1", 40, 25),
        frei("00000000-0000-4000-8000-0000000000d2", 0.5, 0.5, { ort: gareth }),
    ]);
    await openMap(page);
    await showPlace(page, { x: GARETH.x + 40, y: GARETH.y + 25 }, 7);
    await warteAufLauf(page, attrappe);
    await expect.poll(async () => (await zeichen(page)).length, { timeout: 15_000 }).toBe(1);
    const symbol = (await zeichen(page))[0]!;
    // Rechtsklick zuerst (er gehört dem Kartenmenü darunter).
    await page.mouse.click(symbol.x, symbol.y, { button: "right" });
    await expect(page.getByTestId("context-photobox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("context-photobox")).toBeHidden();

    await page.mouse.click(symbol.x, symbol.y);
    await expect.poll(async () => (await stand(page)).leisteOffen).toBe(true);
    expect((await stand(page)).markiert).toEqual(["00000000-0000-4000-8000-0000000000d1"]);
    expect(await selectedPlace(page)).toBeUndefined();

    // Daneben: Gareth selbst. Die Fahne sitzt links oberhalb, der Marker ist frei.
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await stand(page)).leisteOffen).toBe(false);
    await showPlace(page, GARETH, 6);
    const ort = await seite(page, GARETH);
    await page.mouse.click(ort.x, ort.y);
    await expect.poll(async () => (await selectedPlace(page))?.name, { timeout: 15_000 }).toBe("Gareth");
});

test("Andere Ansicht: Ebenen und Quellen weg, kein Treffer; zurück: wieder da, ohne neuen Abruf im Vorrat", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const attrappe = await stubReisebilderKarte(page, [frei("00000000-0000-4000-8000-0000000000e1", 40, 25)]);
    await openMap(page);
    await showPlace(page, { x: GARETH.x + 40, y: GARETH.y + 25 }, 6);
    await warteAufLauf(page, attrappe);
    await expect.poll(async () => (await zeichen(page)).length, { timeout: 15_000 }).toBe(1);
    const abrufe = attrappe.abrufe;

    await chooseView(page, "landscapes");
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsMap!.getLayer("photobox-zeichen") === undefined))
        .toBe(true);
    expect(
        await page.evaluate(() => globalThis.avesmapsMap!.getStyle().layers.some((l) => l.id.startsWith("photobox-z"))),
    ).toBe(false);
    expect((await stand(page)).bilder).toBe(0);

    await chooseView(page, "standard");
    await expect.poll(async () => (await zeichen(page)).length, { timeout: 15_000 }).toBe(1);
    expect(attrappe.abrufe).toBe(abrufe);
});

test("Die Auswahl eines Orts lässt Ebenen, Daten und Abruf stehen; im Leerlauf kein setData", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const attrappe = await stubReisebilderKarte(page, [frei("00000000-0000-4000-8000-0000000000f1", 40, 25)]);
    await openMap(page);
    await showPlace(page, GARETH, 6);
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const zaehler = { n: 0 };
        (globalThis as unknown as { setDataZaehler: { n: number } }).setDataZaehler = zaehler;
        const quelle = (id: string): void => {
            const s = map.getSource?.(id) as unknown as { setData: (d: unknown) => unknown } | undefined;
            if (s === undefined || (s as { gezaehlt?: boolean }).gezaehlt === true) return;
            const alt = s.setData.bind(s);
            s.setData = (d: unknown) => {
                zaehler.n += 1;
                return alt(d);
            };
            (s as { gezaehlt?: boolean }).gezaehlt = true;
        };
        quelle("photobox-bilder");
        quelle("photobox-fahnen");
    });
    await warteAufLauf(page, attrappe);
    await showPlace(page, { x: GARETH.x + 40, y: GARETH.y + 25 }, 6);
    await expect.poll(async () => (await zeichen(page)).length, { timeout: 15_000 }).toBe(1);
    const abrufe = attrappe.abrufe;
    const gezaehlt = (): Promise<number> =>
        page.evaluate(() => (globalThis as unknown as { setDataZaehler: { n: number } }).setDataZaehler.n);
    await page.waitForTimeout(1_500);
    const vorher = await gezaehlt();
    await page.waitForTimeout(1_500);
    expect(await gezaehlt()).toBe(vorher);

    // Ein Ort wird gewählt (setStyle mit diff): Die Ebenen bleiben.
    await showPlace(page, GARETH, 6);
    const ort = await seite(page, GARETH);
    await page.mouse.click(ort.x, ort.y);
    await expect.poll(async () => (await selectedPlace(page))?.name, { timeout: 15_000 }).toBe("Gareth");
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getLayer("photobox-zeichen") !== undefined)).toBe(true);
    expect(attrappe.abrufe).toBe(abrufe);
});

test("🔴 Schalter aus (`an: false`): keine Zeichen und keine Bilder im Zustand", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const attrappe = await stubReisebilderKarte(page, [frei("00000000-0000-4000-8000-000000000011", 40, 25)]);
    attrappe.an = false;
    await openMap(page);
    await showPlace(page, { x: GARETH.x + 40, y: GARETH.y + 25 }, 6);
    await expect.poll(() => attrappe.abrufe, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(await zeichen(page)).toEqual([]);
    expect((await stand(page)).bilder).toBe(0);
});
