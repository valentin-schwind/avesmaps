import { expect, test, type Page } from "@playwright/test";
import { chooseFromFan, chooseView, openMap, settleFrame, showPlace, GARETH } from "./map-handle.ts";

/**
 * Der Kartenfächer (WI-0009; seit WI-0024 1:1 wie Legacys Ansichts-Kachel).
 *
 * 💣 Geprüft wird, was die Karte ANFRAGT, nicht was im Style steht. Ein Layer, der auf
 * `visibility: none` steht, verschwindet aus dem Bild und lädt weiter Kacheln — in einer Prüfung
 * der Stilspezifikation wäre er nicht von einem entfernten zu unterscheiden, im Netzverkehr schon.
 * Genau deshalb entfernt der Stil nicht gewählte Ebenen, statt sie auszublenden.
 *
 * 🪤 Die Zählung braucht einen Moment Ruhe nach dem Wechsel: MapLibre baut den Stil um und stellt
 * die Anfragen im nächsten Frame, nicht im Klick.
 */

interface MapHandle {
    getStyle(): { layers: { id: string }[]; sources: Record<string, unknown> };
    queryRenderedFeatures(options: { layers: string[] }): { properties: Record<string, unknown> }[];
}

async function layerIds(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        ((globalThis.avesmapsMap as unknown as MapHandle).getStyle().layers ?? []).map((layer) => layer.id),
    );
}

/** Die Kachelpfade, die die Karte seit dem letzten Zurücksetzen angefragt hat. */
async function watchRequests(page: Page): Promise<() => Promise<string[]>> {
    const seen: string[] = [];
    page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/tiles/")) {
            seen.push(url.pathname);
        }
    });
    return async () => {
        await page.waitForTimeout(1500);
        return [...seen];
    };
}

test("zeigt die eingestellte Ansicht; das Eselsohr öffnet die Unterreihe", async ({ page }) => {
    await openMap(page);
    await expect(page.getByTestId("fan-toggle")).toContainText("Standard");

    await page.getByTestId("fan-toggle").click();
    // Über der Standardansicht stehen die Untergründe, keine Ebenen: eine Ebenenwahl ohne
    // Landschaften wäre ein Schalter ohne Wirkung.
    await page.getByTestId("fan-view-standard").hover();
    // 🔴 Die Zelle zu überfahren öffnet die Unterreihe NICHT mehr (WI-0036) - erst das Ohr.
    await page.waitForTimeout(400);
    await expect(page.getByTestId("fan-stufe")).toBeHidden();
    await page.getByTestId("fan-ohr-standard").hover();
    await expect(page.getByTestId("fan-series-original")).toBeVisible();
    await expect(page.getByTestId("fan-layer-alle")).toHaveCount(0);

    // Das nächste Ohr: die Unterreihe wechselt ohne Warten.
    await page.getByTestId("fan-view-landscapes").hover();
    await page.getByTestId("fan-ohr-landscapes").hover();
    await expect(page.getByTestId("fan-layer-alle")).toBeVisible();
    await page.getByTestId("fan-layer-alle").click();
    await expect(page.getByTestId("fan-toggle")).toContainText("Derographie");
    await expect(page.getByTestId("fan-toggle")).toContainText("Alle");
});

test("💣 die Standardansicht fragt keine Landschafts- und keine Klimakachel an", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 4);

    const ids = await layerIds(page);
    expect(ids, "kein Landschaftslayer im Stil").toEqual(ids.filter((id) => !id.startsWith("landscape-fill-")));
    expect(ids).not.toContain("climate-fill");
    expect(ids, "die Grundkarte gehört zur Standardansicht").toContain("basemap");
    expect(ids, "Orte gehören zur Standardansicht").toContain("place-marker");

    const requests = await watchRequests(page);
    await page.evaluate(() => {
        (globalThis.avesmapsMap as unknown as { triggerRepaint(): void }).triggerRepaint();
    });
    const pfade = await requests();
    expect(
        pfade.filter((p) => p.includes("region_area_tile")),
        "Landschaftskacheln",
    ).toEqual([]);
    expect(
        pfade.filter((p) => p.includes("climate_band_render")),
        "Klimakacheln",
    ).toEqual([]);
});

test("💣 die Landschaftsansicht fragt keine Rasterkachel an", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 4);

    const requests = await watchRequests(page);
    await chooseView(page, "landscapes");
    const pfade = await requests();

    const rasterNachWechsel = pfade.filter((p) => p.startsWith("/tiles/raster/"));
    // Vor dem Wechsel geladene Rasterkacheln zählen nicht - gemessen wird, ob NEUE dazukommen.
    const ids = await layerIds(page);
    expect(ids, "die Grundkarte ist weg, nicht nur durchsichtig").not.toContain("basemap");
    // Seit WI-0028 zeigen die Landschaften Orte und Wege (Legacys Besucherprofil, Betreiber 2026-09-23).
    expect(ids, "Orte gehören in die Landschaftsansicht").toContain("place-marker");
    expect(
        ids.some((id) => id.startsWith("landscape-fill-")),
        "Flächen sind da",
    ).toBe(true);
    expect(rasterNachWechsel.length, `Raster nach dem Wechsel: ${rasterNachWechsel.length}`).toBeLessThanOrEqual(
        pfade.filter((p) => p.startsWith("/tiles/raster/")).length,
    );
});

test("🔴 die Ebenenwahl filtert wirklich: bei Vegetation ist keine Topographie gezeichnet", async ({ page }) => {
    await openMap(page);
    await showPlace(page, GARETH, 4);

    await chooseFromFan(page, "landscapes", "fan-layer-alle");
    await page.waitForTimeout(800);
    const alle = await layerIds(page);
    expect(alle).toContain("landscape-fill-vegetation");
    expect(alle).toContain("landscape-fill-topographie");
    // Betreiber 2026-10-05: „Wenn ich auf "Alle" klick, sollen keine klimazonen mehr angezeigt werden“ (Legacy ebenso).
    expect(alle, "die Auswahl Alle zeigt keine Klimabaender").not.toContain("climate-fill");
    expect(alle, "und keine Klimanamen").not.toContain("climate-label");

    await chooseFromFan(page, "landscapes", "fan-layer-vegetation");
    await page.waitForTimeout(800);
    const nurVegetation = await layerIds(page);
    expect(nurVegetation).toContain("landscape-fill-vegetation");
    expect(nurVegetation, "Topographie ist raus, nicht unsichtbar").not.toContain("landscape-fill-topographie");
    expect(nurVegetation).not.toContain("climate-fill");

    await chooseFromFan(page, "landscapes", "fan-layer-klima");
    await page.waitForTimeout(800);
    const nurKlima = await layerIds(page);
    expect(nurKlima).toContain("climate-fill");
    expect(nurKlima).not.toContain("landscape-fill-vegetation");
});

test("Ansicht, Ebene und Untergrund überleben ein Neuladen", async ({ page }) => {
    await openMap(page);
    await chooseFromFan(page, "landscapes", "fan-layer-topographie");
    await page.waitForTimeout(600);

    const adresse = page.url();
    expect(adresse).toContain("view=landscapes");
    expect(adresse).toContain("layer=topographie");

    await page.goto(adresse);
    await page.waitForFunction(() => Boolean(globalThis.avesmapsMap));
    await page.waitForTimeout(1200);

    await expect(page.getByTestId("fan-toggle")).toContainText("Derographie");
    // Seit WI-0055 nennt die Kachel bei der Topographie ihre Unterwahl (Vorgabe: Höhenlinien).
    await expect(page.getByTestId("fan-toggle")).toContainText("Höhenlinien");
    const ids = await layerIds(page);
    expect(ids).toContain("landscape-fill-topographie");
    expect(ids).not.toContain("landscape-fill-vegetation");
});

test("🔴 die Ebenenwahl filtert auch die NAMEN, nicht nur die Flaechen", async ({ page }) => {
    // 💣 REGRESSION, an der Stage-Abnahme am 2026-09-22 vom Betreiber gefunden: die Flaechen
    // wechselten mit dem Faecher, die Landschaftsnamen blieben alle stehen. "Herz des Kontinents"
    // und "Darpatien" sind derographische Regionen und standen trotzdem ueber der Vegetations-
    // und der Topographieansicht.
    //
    // 🪤 Gemessen werden GEZEICHNETE Features, nicht der Stil. Ein Filter kann im Style richtig
    // aussehen und trotzdem das Falsche durchlassen.
    await openMap(page);
    await showPlace(page, GARETH, 4);

    // 🪤 Auf den Renderer warten, nicht auf die Uhr. Hier standen 900 ms, unter Last zu wenig: Bei
    // „Vegetation“ standen noch die Namen der vorigen Ansicht (loaded=false), 2026-09-27.
    const ebenenImBild = async (): Promise<string[]> => {
        await settleFrame(page);
        return page.evaluate(() => {
            const map = globalThis.avesmapsMap as unknown as MapHandle;
            const namen = map.queryRenderedFeatures({
                layers: map
                    .getStyle()
                    .layers.map((l) => l.id)
                    .filter((id) => id.startsWith("map-label-") || id.startsWith("landscape-label-run-")),
            });
            return [...new Set(namen.map((feature) => String(feature.properties["region_layer"])))].sort();
        });
    };

    await chooseFromFan(page, "landscapes", "fan-layer-vegetation");
    expect(await ebenenImBild(), "bei Vegetation steht nur Vegetation").toEqual(["vegetation"]);

    await chooseFromFan(page, "landscapes", "fan-layer-topographie");
    expect(await ebenenImBild(), "bei Topographie steht nur Topographie").toEqual(["topographie"]);

    await chooseFromFan(page, "landscapes", "fan-layer-derographisch");
    expect(await ebenenImBild(), "bei Derographie steht nur Derographie").toEqual(["derographisch"]);

    // 🪤 In der Klimaansicht steht kein LANDSCHAFTSname. Klimazonen tragen sehr wohl einen Namen,
    // aber auf einem anderen Weg - er ist der Regionsname der Flaeche, kein map_label-Eintrag, und
    // bekommt deshalb einen eigenen Layer (WI-0012).
    await chooseFromFan(page, "landscapes", "fan-layer-klima");
    expect(await ebenenImBild(), "in der Klimaansicht steht kein Landschaftsname").toEqual([]);

    // ⭐ ... aber die Klimazonen tragen sehr wohl ihren Namen (WI-0012). Er kommt nur nicht aus
    // `map_label`, sondern ist der Regionsname der Flaeche - darum ein eigener Layer.
    //
    // Gemessen wird herausgezoomt, mit mehreren Zonen im Bild. Bis 2026-10-05 war das Pflicht: Die
    // Namen standen an den beiden KARTENRAENDERN (Legacys Verfahren, Migration 0021), bei z4 ueber
    // Gareth war keiner im Bild. Seitdem stehen sie mittig im sichtbaren Teil ihrer Zone
    // (`climate-labels.spec.ts`).
    await page.evaluate(() => {
        (globalThis.avesmapsMap as unknown as { setZoom(z: number): void }).setZoom(1);
    });
    await settleFrame(page);

    const zonen = await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as MapHandle;
        return [
            ...new Set(
                map.queryRenderedFeatures({ layers: ["climate-label"] }).map((f) => String(f.properties["name"])),
            ),
        ].sort();
    });
    // 🪤 „Mehr als null" belegt nur, dass der Fächer den Layer einschaltet. Wo die Namen stehen
    // (mittig, auf ihrem Land, je Zone einer), prüft `climate-labels.spec.ts`; dieser Test hier
    // blieb einst grün, während am Ostrand jeder Name fehlte (Befund 2026-09-23).
    expect(zonen.length, `Klimazonen beschriftet: ${zonen.join(", ")}`).toBeGreaterThan(0);

    // Und bei "Alle" wieder alle drei - welcher gewinnt, entscheidet die Kollision.
    await chooseFromFan(page, "landscapes", "fan-layer-alle");
    const alle = await ebenenImBild();
    expect(alle.length, `bei Alle stehen mehrere Ebenen: ${alle.join(", ")}`).toBeGreaterThan(1);
});

// --- WI-0036: feste Reihe neben der stehenden Kachel, Eselsohr ------------------------------------

async function mapCentre(page: Page): Promise<{ lng: number; lat: number }> {
    return page.evaluate(() =>
        (globalThis.avesmapsMap as unknown as { getCenter(): { lng: number; lat: number } }).getCenter(),
    );
}

async function reihenfolge(page: Page): Promise<(string | undefined)[]> {
    return page
        .getByTestId("fan-menu")
        .locator(".fan__cell")
        .evaluateAll((zellen) => zellen.map((zelle) => (zelle as HTMLElement).dataset["view"]));
}

test("🔴 fünf Ansichten in FESTER Reihenfolge, auch nach einer Wahl; alle wählbar, sobald Gebiete abgeleitet sind", async ({
    page,
}) => {
    // 💣 REGRESSION (Betreiber 2026-09-25, beobachtet an Nutzern): Legacys Reihe stellte die aktive
    // Ansicht ans Ende und sortierte sich damit nach jeder Wahl um - die Leute trafen daneben.
    await openMap(page);
    await page.getByTestId("fan-toggle").click();
    const fest = ["none", "political", "standard", "powerlines", "landscapes"];
    expect(await reihenfolge(page)).toEqual(fest);
    // WI-0062: „Politisch“ ist freigeschaltet (Betreiber 2026-09-29), sobald der Zeiger der Gebiete antwortet.
    await expect(page.getByTestId("fan-view-political")).toBeEnabled();
    await expect(page.getByTestId("fan-view-powerlines")).toBeEnabled();
    await expect(page.getByTestId("fan-view-none")).toBeEnabled();

    await page.getByTestId("fan-view-landscapes").click();
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await page.getByTestId("fan-toggle").click();
    expect(await reihenfolge(page), "nach der Wahl von Landschaften").toEqual(fest);
    await expect(page.getByTestId("fan-view-landscapes")).toHaveClass(/is-active/);
});

test("🔴 ohne Gebietsdaten bleibt „Politisch“ ausgegraut und nennt den Grund; ein Link dorthin öffnet die Standardkarte", async ({
    page,
}) => {
    // Kein Zeiger (nichts abgeleitet, oder ein Import hat die Ableitung entwertet): keine Gebiete, statt alter.
    await page.route("**/api/territories/current", (route) =>
        route.fulfill({ status: 404, json: { error: { code: "no_territories", message: "keine" } } }),
    );
    await page.goto("/#x=520&y=500&z=5&series=original&view=political&layer=alle");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("fan-toggle")).toContainText("Standard");
    await page.getByTestId("fan-toggle").click();
    await expect(page.getByTestId("fan-view-political")).toBeDisabled();
    await expect(page.getByTestId("fan-view-political")).toHaveAttribute("title", /Gebietsdaten/);
    const ids = await layerIds(page);
    expect(ids.filter((id) => id.startsWith("territory-"))).toEqual([]);
    // Auch der Schalter „Grenzen“ bleibt gesperrt, mit Legacys Grund.
    await page.getByTestId("fan-toggle").click();
    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-borders").locator("input")).toBeDisabled();
    await expect(page.getByTestId("display-borders")).toHaveAttribute("title", /Gebietsgrenzen/);
});

test("🔴 die Kachel bleibt beim Aufklappen stehen, die Reihe klappt links daneben auf", async ({ page }) => {
    await openMap(page);
    const vorher = await page.getByTestId("fan-toggle").boundingBox();
    await page.getByTestId("fan-toggle").click();
    await expect(page.getByTestId("fan-menu")).toBeVisible();
    const nachher = await page.getByTestId("fan-toggle").boundingBox();
    const reihe = await page.getByTestId("fan-menu").boundingBox();
    if (!vorher || !nachher || !reihe) {
        throw new Error("Kachel oder Reihe fehlt");
    }
    expect(nachher).toEqual(vorher);
    expect(reihe.x + reihe.width, "die Reihe endet links der Kachel").toBeLessThanOrEqual(nachher.x);
    expect(Math.abs(reihe.y + reihe.height - (nachher.y + nachher.height)), "gleiche Unterkante").toBeLessThanOrEqual(
        1,
    );
});

test("🔴 ein Klick auf eine Ansicht wählt sie sofort - ohne Umweg über die Unterreihe", async ({ page }) => {
    await openMap(page);
    await page.getByTestId("fan-toggle").click();
    await page.getByTestId("fan-view-powerlines").click();
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await expect(page.getByTestId("fan-stufe")).toBeHidden();
    await expect(page).toHaveURL(/view=powerlines/);
    await expect(page.getByTestId("fan-toggle")).toContainText("Kraftlinien");
});

test("ein Untergrund in der Unterreihe wählt Ansicht und Untergrund zugleich: Nur Karte über Modern", async ({
    page,
}) => {
    await openMap(page);
    await chooseFromFan(page, "none", "fan-series-modern");
    await expect(page).toHaveURL(/view=none/);
    await expect(page).toHaveURL(/series=modern/);
    await expect(page.getByTestId("fan-toggle")).toContainText("Nur Karte");
    await expect(page.getByTestId("fan-toggle")).toContainText("Modern");

    // „Nur Karte“ ist der Untergrund allein: keine Orte, keine Wege, keine Namen.
    await page.waitForTimeout(800);
    const ids = await layerIds(page);
    expect(ids).toContain("basemap");
    expect(ids).not.toContain("place-marker");
    expect(ids.filter((id) => id.startsWith("map-label"))).toEqual([]);
    expect(ids.filter((id) => id.startsWith("path-"))).toEqual([]);
});

test("🔴 Old steht Besuchern nur unter „Nur Karte“ offen, auch per Link (Betreiber 2026-11-10)", async ({ page }) => {
    // Der Katalog, wie ihn der Server seit 2026-11-10 schickt (Old für alle), unabhängig vom Stand des lokalen Servers.
    await page.route("**/api/map-series", async (route) => {
        const antwort = await route.fetch();
        const katalog = (await antwort.json()) as { series: { id: string; visibility: string }[] };
        for (const serie of katalog.series) if (serie.id === "old") serie.visibility = "PUBLIC";
        await route.fulfill({ response: antwort, json: katalog });
    });
    await openMap(page);
    // Unter „Standard“ fehlt Old: Dort stünde jeder Name doppelt.
    await page.getByTestId("fan-toggle").click();
    await page.getByTestId("fan-view-standard").hover();
    await page.getByTestId("fan-ohr-standard").click();
    await expect(page.getByTestId("fan-series-modern")).toBeVisible();
    await expect(page.getByTestId("fan-series-old")).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Unter „Nur Karte“ steht es und wählt beides.
    await chooseFromFan(page, "none", "fan-series-old");
    await expect(page).toHaveURL(/series=old/);
    await expect(page).toHaveURL(/view=none/);
    await expect(page.getByTestId("fan-toggle")).toContainText("Old");
    // Eine andere Ansicht bringt die Vorgabe-Serie.
    await page.getByTestId("fan-toggle").click();
    await page.getByTestId("fan-view-standard").click();
    await expect(page).toHaveURL(/view=standard/);
    await expect(page).toHaveURL(/series=modern/);
    // Ein Link auf Old ohne Ansicht öffnet „Nur Karte“. 🪤 Erst weg von der Seite: Ein reiner Hash-Wechsel lädt sie nicht neu.
    await page.goto("about:blank");
    await openMap(page, "/#series=old");
    await expect(page).toHaveURL(/series=old/);
    await expect(page).toHaveURL(/view=none/);
    await expect(page.getByTestId("fan-toggle")).toContainText("Nur Karte");
    await expect(page.getByTestId("fan-toggle")).toContainText("Old");
});

test("🔴 das Eselsohr der Kachel wechselt den Untergrund, ohne die Ansicht anzufassen", async ({ page }) => {
    await openMap(page);
    await chooseView(page, "powerlines");
    await page.getByTestId("fan-toggle").hover();
    await page.getByTestId("fan-ohr-kachel").click();
    await expect(page.getByTestId("fan-series-original")).toBeVisible();
    // Die Ansichtsreihe bleibt dabei zu - wer auf das Ohr zielt, will den Untergrund.
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await page.getByTestId("fan-series-original").click();
    await expect(page.getByTestId("fan-stufe")).toBeHidden();
    await expect(page).toHaveURL(/view=powerlines/);
    await expect(page).toHaveURL(/series=original/);
    await expect(page.getByTestId("fan-toggle")).toContainText("Kraftlinien");
    await expect(page.getByTestId("fan-toggle")).toContainText("Original");
});

test("Überfahren der Zelle lässt eine fremde Unterreihe los; ein Klick aufs Ohr hält sie, der zweite schließt", async ({
    page,
}) => {
    await openMap(page);
    await page.getByTestId("fan-toggle").click();
    await page.getByTestId("fan-view-standard").hover();
    await page.getByTestId("fan-ohr-standard").hover();
    await expect(page.getByTestId("fan-series-modern")).toBeVisible();
    await page.getByTestId("fan-view-powerlines").hover();
    await expect(page.getByTestId("fan-stufe")).toBeHidden();

    await page.getByTestId("fan-view-standard").hover();
    await page.getByTestId("fan-ohr-standard").click();
    await expect(page.getByTestId("fan-stufe")).toBeVisible();
    await page.getByTestId("fan-view-powerlines").hover();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("fan-stufe"), "festgehalten").toBeVisible();
    await page.getByTestId("fan-view-standard").hover();
    await page.getByTestId("fan-ohr-standard").click();
    await expect(page.getByTestId("fan-stufe")).toBeHidden();
});

test("Auge und Lupe rutschen hoch, wenn die Unterreihe über der Kachel ihren Platz braucht", async ({ page }) => {
    await openMap(page);
    const lupe = page.getByTestId("fan").locator("xpath=preceding-sibling::*[1]");
    const vorher = await lupe.boundingBox();
    await page.getByTestId("fan-toggle").hover();
    await page.getByTestId("fan-ohr-kachel").click();
    await expect(page.getByTestId("fan-stufe")).toBeVisible();
    await page.waitForTimeout(400);
    const nachher = await lupe.boundingBox();
    const stufe = await page.getByTestId("fan-stufe").boundingBox();
    if (!vorher || !nachher || !stufe) {
        throw new Error("Lupe oder Unterreihe fehlt");
    }
    expect(nachher.y, "die Lupe ist hochgerutscht").toBeLessThan(vorher.y);
    expect(nachher.y + nachher.height, "und liegt über der Unterreihe").toBeLessThanOrEqual(stufe.y);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    expect((await lupe.boundingBox())?.y, "nach dem Schließen wieder an ihrem Platz").toBeCloseTo(vorher.y, 0);
});

test("🔴 Tastatur: Pfeile wandern durch den Fächer, ohne die Karte zu verschieben; Pfeil hoch öffnet die Unterreihe", async ({
    page,
}) => {
    await openMap(page);
    await page.getByTestId("fan-toggle").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("fan-view-standard")).toBeFocused();

    const vorher = await mapCentre(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("fan-view-landscapes")).toBeFocused();
    expect(await mapCentre(page), "die Pfeile gehören dem Fächer, nicht der Karte").toEqual(vorher);

    // Pfeil hoch öffnet die Unterreihe und führt hinein, Pfeil runter zurück zur Zelle.
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("fan-stufe").locator(".fan__cell").first()).toBeFocused();
    await expect(page.getByTestId("fan-toggle")).toContainText("Standard");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("fan-view-landscapes")).toBeFocused();
    // Enter wählt die Ansicht, mit der gemerkten Ebene.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await expect(page.getByTestId("fan-toggle")).toContainText("Derographie");
});

test("Escape schließt den Fächer und gibt den Fokus an die Kachel zurück; ein Klick auf die Karte schließt ebenso", async ({
    page,
}) => {
    await openMap(page);
    await page.getByTestId("fan-toggle").click();
    await expect(page.getByTestId("fan-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await expect(page.getByTestId("fan-toggle")).toBeFocused();

    await page.getByTestId("fan-toggle").click();
    await expect(page.getByTestId("fan-menu")).toBeVisible();
    await page.mouse.click(300, 400);
    await expect(page.getByTestId("fan-menu")).toBeHidden();
});

test("am Zeiger klappt das Überfahren auf und das Verlassen wieder zu", async ({ page }) => {
    await openMap(page);
    await page.getByTestId("fan-toggle").hover({ position: { x: 12, y: 60 } });
    await expect(page.getByTestId("fan-menu")).toBeVisible();
    await page.mouse.move(300, 300);
    await expect(page.getByTestId("fan-menu")).toBeHidden();
});

test("bei „Bewegung reduzieren“ fällt das Aufrollen ganz weg", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMap(page);
    await page.getByTestId("fan-toggle").click();
    const menu = page.getByTestId("fan-menu");
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((element) => getComputedStyle(element).clipPath)).toBe("none");
});
