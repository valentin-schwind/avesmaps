import { expect, test, type Page } from "@playwright/test";
import { openStagePanel, stageFieldValue } from "./stage-panel.ts";
import {
    chooseView,
    clickMap,
    moveMap,
    openMap,
    settleFrame,
    showLandscapes,
    type AreaSelectionHandle,
    type RenderedFeature,
} from "./map-handle.ts";
import { expectTooltipLook } from "./map-tooltip-look.ts";

/**
 * Die gewählte Fläche am echten Stack (WI-0043): Suche, Reiseübersicht und Kartenklick lassen dieselbe
 * Fläche leuchten und schreiben ihren Namen auf die Karte.
 *
 * 🪤 Gemessen wird, was GEZEICHNET ist - die Features unter den Ebenen der Auswahl -, und der Zustand, den
 * die Anwendung dafür hält. Namen und Kennungen kommen aus den Antworten des Servers, nicht aus dem Test:
 * Der Kartenstand ändert sich mit jedem Legacy-Import.
 */

const FILL = "area-selection-fill";

async function selection(page: Page): Promise<AreaSelectionHandle | undefined> {
    return page.evaluate(() => globalThis.avesmapsAreaSelection?.());
}

async function settle(page: Page): Promise<void> {
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 15_000 });
    // 🪤 Der Flug ist zu Ende, die Kacheln der neuen Stelle noch nicht: Unter Last fand findPoint danach
    // keinen einzigen Ort (loaded=false, 0 Marker; 2026-09-27). `settleFrame` wartet sie ab.
    await settleFrame(page);
}

/**
 * Wie viele Linien die Vorschau beim Zeigen trägt (WI-0266): Sie ist eine kleine GeoJSON-Quelle, gefüllt aus den geladenen Kacheln - kein
 * Zustand mehr an der Kachelquelle. 0 heißt: Es wird nichts umrissen.
 */
async function vorschauLinien(page: Page, quelle: string): Promise<number> {
    return page.evaluate((id) => {
        const map = globalThis.avesmapsMap as unknown as
            { getSource(id: string): { serialize(): { data?: { features?: unknown[] } } } | undefined } | undefined;
        return map?.getSource(id)?.serialize().data?.features?.length ?? 0;
    }, quelle);
}

/** Die Features, die eine Ebene gerade zeichnet; wartet, bis es welche gibt. */
async function drawn(page: Page, layer: string): Promise<RenderedFeature[]> {
    await page.waitForFunction(
        (id) =>
            globalThis.avesmapsMap?.getLayer(id)
                ? globalThis.avesmapsMap.queryRenderedFeatures({ layers: [id] }).length > 0
                : false,
        layer,
        { timeout: 30_000 },
    );
    return page.evaluate((id) => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: [id] }), layer);
}

/**
 * Der Name der gewählten Fläche, wie die Karte ihn gerade zeigt (WI-0093).
 *
 * 🔴 Er steht GENAU EINMAL: als ihr gewöhnlicher Name, umgefärbt - oder, wo der gerade nicht gezeichnet ist
 * (Kollision, Erscheinungsband, Ausschnitt, Ansicht), als versetzter Ersatz. 💣 Bis WI-0093 war es umgekehrt:
 * der gewöhnliche wich immer, der versetzte stand immer. Genau daran hing der Formsprung, den ein Nutzertest
 * gemeldet hat (Betreiber 2026-10-06).
 */
async function nameDerAuswahl(
    page: Page,
    regions: string | readonly string[],
): Promise<{ texte: string[]; quelle: string }> {
    return page.evaluate(
        (ids) => {
            const map = globalThis.avesmapsMap!;
            // Seit WI-0135 je Landschaftsebene eigene Namensebenen.
            const ebenen = map
                .getStyle()
                .layers.map((l) => l.id)
                .filter((id) => id.startsWith("map-label-") || id.startsWith("landscape-label-run-"));
            const gewoehnlich =
                ebenen.length === 0
                    ? []
                    : map
                          .queryRenderedFeatures({ layers: ebenen })
                          .filter((feature) => ids.includes(String(feature.properties["region_public_id"])));
            const versetzt = map.getLayer("area-selection-label")
                ? map.queryRenderedFeatures({ layers: ["area-selection-label"] })
                : [];
            if (gewoehnlich.length > 0 && versetzt.length > 0) return { texte: [], quelle: "doppelt" };
            const treffer = gewoehnlich.length > 0 ? gewoehnlich : versetzt;
            return {
                texte: [...new Set(treffer.map((feature) => String(feature.properties["name"] ?? "")))],
                quelle: gewoehnlich.length > 0 ? "gewöhnlich" : versetzt.length > 0 ? "versetzt" : "keiner",
            };
        },
        (typeof regions === "string" ? [regions] : [...regions]) as string[],
    );
}

/**
 * Der Name steht - einmal, mit diesem Text, gleich aus welcher der beiden Quellen.
 *
 * 🪤 Gewartet, nicht einmal gelesen: Welche der beiden Quellen gilt, entscheidet die laufende Karte, und sie
 * misst erst, wenn das Bild steht - nach einem Stilumbau also ein, zwei Bilder später (`area-selection-name.ts`).
 * Ein einmaliges Lesen traf die Lücke dazwischen und meldete „gar kein Name".
 */
async function expectName(page: Page, regions: string | readonly string[], text: string, wo: string): Promise<void> {
    await expect
        .poll(async () => (await nameDerAuswahl(page, regions)).quelle, {
            timeout: 15_000,
            message: `${wo}: der Name steht genau einmal`,
        })
        .toMatch(/^(gewöhnlich|versetzt)$/);
    expect((await nameDerAuswahl(page, regions)).texte, wo).toEqual([text]);
}

/**
 * Ein Punkt im sichtbaren Kartenteil, an dem die eine Ebenengruppe etwas zeichnet und die andere nichts;
 * ohne gesuchte Ebenen genügt „nichts von den anderen“. Gesucht wird auf einem Raster rechts vom Planer,
 * damit kein Panel den Klick fängt.
 */
async function findPoint(
    page: Page,
    wanted: string[],
    unwanted: string[],
    /** Wie viel Platz rechts bleibt: Das Infopanel (400 px) deckt ihn, solange es offen ist (WI-0063). */
    right = 440,
): Promise<{ x: number; y: number }> {
    const point = await page.evaluate(
        ({ wanted, unwanted, right }) => {
            const map = globalThis.avesmapsMap!;
            const canvas = map.getCanvas();
            const present = (ids: string[]) => ids.filter((id) => map.getLayer(id));
            const hit = (ids: string[], at: [number, number]) =>
                present(ids).length > 0 && map.queryRenderedFeatures(at, { layers: present(ids) }).length > 0;
            // 🔴 Die Wege liegen vor jeder Fläche (Rang 45 gegen 40, `interaction/priorities.ts`): Ein Punkt, an dem ein Weg liegt, wählt den
            // Weg, nicht die Fläche. Wer sie nicht ausdrücklich sucht, schließt sie aus - sonst hängt der Treffer von der Startansicht ab
            // (Release-Test d80313c07: mit dem gespeicherten Startzoom lag „Weg-9640“ unter dem ersten Punkt). Ausnahme ist die Suche nach
            // einem Ort: Der Ort geht dem Weg vor (Rang 80 gegen 45), und viele Orte liegen am Ende eines Wegs.
            const ortGesucht = wanted.some((id) => id.startsWith("place-marker"));
            const wege = (map.getStyle().layers ?? [])
                .map((layer) => layer.id)
                .filter((id) => !ortGesucht && id.startsWith("path-hit-") && !wanted.includes(id));
            const ausgeschlossen = [...unwanted, ...wege];
            for (let y = 140; y < canvas.clientHeight - 140; y += 23) {
                for (let x = 420; x < canvas.clientWidth - right; x += 29) {
                    const at: [number, number] = [x, y];
                    if ((wanted.length === 0 || hit(wanted, at)) && !ausgeschlossen.some((id) => hit([id], at))) {
                        return { x, y };
                    }
                }
            }
            return null;
        },
        { wanted, unwanted, right },
    );
    if (!point) {
        throw new Error(`kein Punkt mit ${wanted.join(", ")} ohne ${unwanted.join(", ")}`);
    }
    return point;
}

/** Wählt den Landschaftstreffer mit genau diesem Namen in der Suche. */
async function chooseLandscapeHit(page: Page, name: string): Promise<void> {
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill(name);
    await page
        .locator('[data-testid="search-hit"][data-kind="landschaft"]')
        .filter({ has: page.locator(".spotlight__name", { hasText: new RegExp(`^${name}$`) }) })
        .first()
        .click();
    await expect(page.getByTestId("search")).toBeHidden();
}

const MARKERS = ["place-marker", "place-marker-structure", "route-hit", "route-markers"];

test("🔴 ein Landschaftstreffer der Suche leuchtet als Fläche mit Namen, über alle Ansichten (AC1, AC3, AC5, AC8)", async ({
    page,
}) => {
    await openMap(page);
    const antwort = page.waitForResponse((response) => response.url().includes("/api/search?q=Weiden"));
    await chooseLandscapeHit(page, "Weiden");
    const treffer = (
        (await (await antwort).json()) as { hits: { kind: string; name: string; region?: string; id: string }[] }
    ).hits.find((hit) => hit.kind === "landschaft" && hit.name === "Weiden");
    expect(treffer?.region, "der Treffer nennt seine Region").toBeTruthy();

    // Der Zustand kennt die REGION, nicht das Label.
    await expect.poll(async () => (await selection(page))?.id).toBe(treffer!.region);
    expect((await selection(page))?.id).not.toBe(treffer!.id);
    await settle(page);

    // Gezeichnet werden alle Polygone der Region, keins einer anderen.
    const flaechen = await drawn(page, FILL);
    expect(new Set(flaechen.map((feature) => feature.properties["region_public_id"]))).toEqual(
        new Set([treffer!.region]),
    );
    // 🔴 Der Name der gewählten Fläche steht GENAU EINMAL (WI-0093): als ihr gewöhnlicher Name, umgefärbt -
    // und nur dort, wo der gerade nicht gezeichnet ist, als versetzter Ersatz. 💣 Bis WI-0093 war es umgekehrt:
    // der gewöhnliche wich, der versetzte stand immer. Daran hing der Formsprung aus dem Nutzertest.
    const genauEinmal = (wo: string): Promise<void> => expectName(page, treffer!.region!, "Weiden", wo);
    await genauEinmal("nach der Suche");

    // 💣 Weit hinaus, wo die gewöhnlichen Namen sich gegenseitig verdrängen: Der Name bleibt - dann als Ersatz.
    await page.evaluate(() =>
        (globalThis.avesmapsMap as unknown as { jumpTo(o: { zoom: number }): void }).jumpTo({ zoom: 1.5 }),
    );
    await settle(page);
    await settle(page);
    await genauEinmal("weit draußen");

    // Ein Wechsel der Ansicht löscht die Auswahl nicht und macht sie nicht unsichtbar.
    await chooseView(page, "landscapes");
    await expect.poll(async () => (await selection(page))?.id).toBe(treffer!.region);
    expect((await drawn(page, FILL)).length).toBeGreaterThan(0);
    await settle(page);
    await genauEinmal("in den Landschaften");
    await chooseView(page, "none");
    expect((await drawn(page, FILL)).length).toBeGreaterThan(0);
});

test("🔴 ein Klick in die freie Karte beendet die Auswahl, ein Ort geht vor (AC6, AC7)", async ({ page }) => {
    await openMap(page);
    await chooseLandscapeHit(page, "Weiden");
    await settle(page);
    await drawn(page, FILL);
    const gewaehlt = (await selection(page))?.id;

    // Ein Ort bekommt den Klick vor der Fläche und wird der gewählte Subject - es gibt nur EINEN (WI-0063): Die Fläche
    // leuchtet nicht mehr, der Ort steht gold.
    // Das Panel, das mit der Fläche aufging, deckt den rechten Rand: eingeklappt liegen die Orte dort wieder frei.
    await page.getByTestId("info-panel-tab").click();
    await expect(page.getByTestId("info-panel")).toBeHidden();
    // Seit e109a5fcc zählen Auge, Lupe und Fächer als Deckung des Ziels (WI-0218): Die Suche passt Weiden kleiner ein (Zoom 2,37), und
    // in der freien Fläche steht dann kein Ort. Eine Stufe näher, über derselben Mitte, liegen dort wieder Orte.
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as { jumpTo(o: { zoom: number }): void; getZoom(): number };
        map.jumpTo({ zoom: map.getZoom() + 1 });
    });
    await settle(page);
    const ort = await findPoint(page, ["place-marker"], [], 160);
    await page.getByTestId("map").click({ position: ort });
    await expect
        .poll(async () => (await page.evaluate(() => globalThis.avesmapsSelectedPlace?.()))?.name ?? "")
        .not.toBe("");
    expect(await selection(page)).toBeUndefined();
    await expect(page.getByTestId("info-panel")).toBeVisible();

    // Wieder die Fläche gewählt: Ein Klick in die gewählte Fläche selbst lässt sie stehen.
    await chooseLandscapeHit(page, "Weiden");
    await settle(page);
    await drawn(page, FILL);
    expect((await selection(page))?.id).toBe(gewaehlt);
    const innen = await findPoint(page, [FILL], MARKERS);
    await page.getByTestId("map").click({ position: innen });
    expect((await selection(page))?.id).toBe(gewaehlt);

    // Ein Klick daneben, in die freie Karte, beendet sie - samt ihrem Namen.
    const draussen = await findPoint(page, [], [FILL, ...MARKERS]);
    await page.getByTestId("map").click({ position: draussen });
    await expect.poll(async () => selection(page)).toBeUndefined();
    await expect
        .poll(() => page.evaluate(() => Boolean(globalThis.avesmapsMap?.getLayer("area-selection-fill"))))
        .toBe(false);
});

test("🔴 ein Klick auf eine gezeichnete Fläche wählt sie, eine zweite ersetzt die erste (AC6, AC7)", async ({
    page,
}) => {
    // 🔴 Die Kamera nennt die Adresse: Ohne sie gilt die Startansicht der Karteneinstellungen (`/api/map-settings`, gespeicherter
    // Startzoom), und die liegt lokal, im Release-Test und auf der Stage anderswo - dann lagen Orte und Wege unter dem ersten Punkt.
    await openMap(page, "/#x=518.750&y=504&z=2.50&series=modern");
    await showLandscapes(page, "vegetation");
    const erster = await findPoint(page, ["landscape-fill-vegetation"], [FILL, ...MARKERS]);
    const unterErstem = await smallestAt(page, erster, "landscape-fill-vegetation");
    // Beschriftungen dieser Region vor dem Klick, in Bildschirmpunkten.
    const namenVorher = await labelsOf(page, unterErstem);
    await page.getByTestId("map").click({ position: erster });
    await expect.poll(async () => (await selection(page))?.id).toBe(unterErstem);
    // 🪤 Die Auswahl wechselt sofort, das Bild erst, wenn die Kacheln mit dem neuen Filter neu geparst sind
    // (`map.loaded()` ist bis dahin false). Gemessen 2026-10-03: unter Last stand danach noch die alte Fläche.
    // Erst das fertige Bild abwarten - sonst sucht `findPoint` den zweiten Punkt neben einer noch nicht
    // gezeichneten ersten Fläche.
    await settle(page);
    const gewaehlt = (await selection(page))!;
    // Stufe 2: Der Name steht, wo die Beschriftung der Fläche stand; nur ohne sie, wo geklickt wurde.
    const anker = await page.evaluate(
        (point) => globalThis.avesmapsMap!.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(point)),
        gewaehlt.anchor,
    );
    const ziele = namenVorher.length > 0 ? namenVorher : [erster];
    expect(Math.min(...ziele.map((ziel) => Math.hypot(anker.x - ziel.x, anker.y - ziel.y)))).toBeLessThan(2);
    await expectName(page, gewaehlt.group ?? gewaehlt.id, gewaehlt.label, "nach dem Klick");

    // Eine andere Fläche ersetzt die erste.
    const zweiter = await findPoint(page, ["landscape-fill-vegetation"], [FILL, ...MARKERS]);
    const unterZweitem = await smallestAt(page, zweiter, "landscape-fill-vegetation");
    expect(unterZweitem, "der zweite Klick trifft eine andere Fläche").not.toBe(unterErstem);
    await page.getByTestId("map").click({ position: zweiter });
    await expect.poll(async () => (await selection(page))?.id).toBe(unterZweitem);
    // Im fertigen Bild steht nur noch die zweite Fläche; die erste ist weg.
    await settle(page);
    const flaechen = await drawn(page, FILL);
    expect(new Set(flaechen.map((feature) => feature.properties["region_public_id"]))).toEqual(new Set([unterZweitem]));
});

/** Die kleinste Fläche unter dem Punkt (Stufe 2): nach `area` aus der Kachel, bei Gleichstand die Kennung. */
async function smallestAt(page: Page, at: { x: number; y: number }, layer: string): Promise<string> {
    return page.evaluate(
        ({ at, layer }) => {
            const features = globalThis.avesmapsMap!.queryRenderedFeatures([at.x, at.y], { layers: [layer] });
            const sorted = features
                .map((feature) => ({
                    id: String(feature.properties["region_public_id"]),
                    area: Number(feature.properties["area"]) || Number.POSITIVE_INFINITY,
                }))
                .sort((a, b) => a.area - b.area || a.id.localeCompare(b.id));
            return sorted[0]!.id;
        },
        { at, layer },
    );
}

/** Wo die Beschriftungen einer Region gerade gezeichnet stehen, in Bildschirmpunkten. */
async function labelsOf(page: Page, region: string): Promise<{ x: number; y: number }[]> {
    return page.evaluate((id) => {
        const map = globalThis.avesmapsMap!;
        const punkte = map
            .getStyle()
            .layers.map((l) => l.id)
            .filter((id) => id.startsWith("map-label-"));
        return punkte.length > 0
            ? map
                  .queryRenderedFeatures({ layers: punkte })
                  .filter((feature) => feature.properties["region_public_id"] === id)
                  .map((feature) => {
                      const [lng, lat] = (feature.geometry as { coordinates: [number, number] }).coordinates;
                      return map.project({ lng, lat });
                  })
            : [];
    }, region);
}

test("🔴 wo Flächen übereinanderliegen: Vorschau, kleinste zuerst, nochmal klicken, Liste (Stufe 2, A+B+C)", async ({
    page,
}) => {
    // Im Kosch liegen Gebirge ineinander und im Hügelland (Betreiberbefund 2026-09-28: „der klick selber ist ein
    // bisschen zufällig … insbesondere bei gebirgen in der topographischen ansicht“).
    await page.goto("/#x=468&y=527&z=6&series=original&view=landscapes&layer=topographie");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settle(page);
    const stelle = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        let best = { n: 0, x: 0, y: 0 };
        for (let y = 140; y < canvas.clientHeight - 140; y += 17) {
            for (let x = 420; x < canvas.clientWidth - 440; x += 19) {
                const ids = new Set(
                    map
                        .queryRenderedFeatures([x, y], { layers: ["landscape-fill-topographie"] })
                        .map((feature) => feature.properties["region_public_id"]),
                );
                const frei = ["place-marker", "place-marker-structure"].every(
                    (id) => !map.getLayer(id) || map.queryRenderedFeatures([x, y], { layers: [id] }).length === 0,
                );
                if (frei && ids.size > best.n) best = { n: ids.size, x, y };
            }
        }
        return best;
    });
    expect(stelle.n, "eine Stelle mit mehreren Flächen").toBeGreaterThan(1);
    const ordnung = await page.evaluate((at) => {
        const features = globalThis.avesmapsMap!.queryRenderedFeatures([at.x, at.y], {
            layers: ["landscape-fill-topographie"],
        });
        const flaeche = new Map<string, number>();
        for (const feature of features) {
            const id = String(feature.properties["region_public_id"]);
            const area = Number(feature.properties["area"]) || Number.POSITIVE_INFINITY;
            flaeche.set(id, Math.min(flaeche.get(id) ?? Number.POSITIVE_INFINITY, area));
        }
        return [...flaeche.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([id]) => id);
    }, stelle);

    // A: Zeigen umreißt die kleinste und nennt sie, samt den übrigen.
    await moveMap(page, stelle);
    await expect(page.getByTestId("pointer-hint")).toBeVisible();
    await expect(page.getByTestId("pointer-hint")).toContainText(String(stelle.n - 1));
    // 🔴 Ein Kartentooltip wie jedes Kartenschild (Guide §15.3, Betreiber 2026-10-03: alle in einer Fassung).
    await expectTooltipLook(page.getByTestId("pointer-hint"), { meta: true });
    // Die Vorschau ist die eine Ebene `area-preview-outline` an ihrer eigenen Quelle, und die trägt jetzt Linien der kleinsten Fläche.
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getLayer("area-preview-outline"))).toBeTruthy();
    await expect.poll(() => vorschauLinien(page, "area-preview-outline")).toBeGreaterThan(0);

    // B + C: Der Klick wählt die kleinste und öffnet die Liste aller, kleinste zuerst, die gewählte markiert.
    await clickMap(page, stelle);
    await expect.poll(async () => (await selection(page))?.id).toBe(ordnung[0]);
    await expect(page.getByTestId("pointer-hint")).toBeHidden();
    const liste = page.getByTestId("area-choice");
    await expect(liste).toHaveCount(stelle.n);
    await expect(liste.nth(0)).toHaveAttribute("aria-checked", "true");

    // B: Nochmal an derselben Stelle nimmt die nächstgrößere.
    await clickMap(page, stelle);
    await expect.poll(async () => (await selection(page))?.id).toBe(ordnung[1]);
    await expect(page.getByTestId("area-choice").nth(1)).toHaveAttribute("aria-checked", "true");

    // C: Ein Eintrag wählt direkt und schließt die Liste; Escape schließt sie auch.
    await page
        .getByTestId("area-choice")
        .nth(stelle.n - 1)
        .click();
    await expect.poll(async () => (await selection(page))?.id).toBe(ordnung[stelle.n - 1]);
    await expect(page.getByTestId("area-choices")).toBeHidden();
    await clickMap(page, stelle);
    await expect(page.getByTestId("area-choices")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("area-choices")).toBeHidden();
});

test("🔴 ein Landschaftsname der Reiseübersicht wählt seine Fläche, die Route bleibt (AC2)", async ({ page }) => {
    const antwort = page.waitForResponse(
        (response) => response.url().endsWith("/api/route/landscapes") && response.ok(),
    );
    await page.goto("/?route=Gareth~Perricum");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const regionen = ((await (await antwort).json()) as { regions: Record<string, { name: string | null }> }).regions;
    const summary = page.getByTestId("route-landscapes");
    await expect(summary).toContainText("Herz des Kontinents", { timeout: 15_000 });
    const [erwartet] = Object.entries(regionen).find(([, region]) => region.name === "Herz des Kontinents") ?? [];

    // Die Box ist zugeklappt (WI-0065); ihre Knöpfe stehen erst offen im Barrierefreiheitsbaum.
    await page.getByTestId("areas-toggle").press("Enter");
    await summary.getByRole("button", { name: "Herz des Kontinents" }).click();
    await expect.poll(async () => (await selection(page))?.id).toBe(erwartet);
    await settle(page);
    expect((await drawn(page, FILL)).length).toBeGreaterThan(0);
    await expectName(page, erwartet!, "Herz des Kontinents", "aus der Reiseübersicht");
    // Die Route bleibt stehen, und die Fläche liegt unter ihr.
    expect((await drawn(page, "route-line")).length).toBeGreaterThan(0);
    const reihenfolge = await page.evaluate(() => globalThis.avesmapsMap!.getStyle().layers.map((layer) => layer.id));
    expect(reihenfolge.indexOf("route-line")).toBeGreaterThan(reihenfolge.indexOf("area-selection-line"));

    // Auch aus dem Infopanel der Etappe (seit WI-0079 steht die Landschaft dort): dieselbe Auswahl.
    await openStagePanel(page, 0);
    const etappe = stageFieldValue(page, "landscapes");
    const name = (await etappe.getByRole("button").first().textContent())?.trim() ?? "";
    await etappe.getByRole("button").first().click();
    await expect.poll(async () => (await selection(page))?.label).toBe(name);
});

/**
 * 💣 Befund 2026-09-26: „Weiden“ stand in der Reiseübersicht als bloßer Text. Sein Label ist über die Region
 * gebunden, aber nicht als primäres benannt, und der Server fragte nur nach dem primären.
 */
test("💣 eine Landschaft, deren Label nicht als primäres benannt ist, ist trotzdem ein Knopf", async ({ page }) => {
    await page.goto("/?route=Gareth~Trallop");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const summary = page.getByTestId("route-landscapes");
    await expect(summary).toContainText("Weiden", { timeout: 15_000 });
    await page.getByTestId("areas-toggle").press("Enter");
    await summary.getByRole("button", { name: "Weiden", exact: true }).click();
    await expect.poll(async () => (await selection(page))?.name).toBe("Weiden");
});

// --- WI-0047: Flächen in der Suche ------------------------------------------------------------------------

interface SearchAnswer {
    hits: { kind: string; name: string; id: string; region?: string; regions?: string[] }[];
}

/** Sucht und wartet auf die Antwort des Servers: Kennungen kommen von dort, nicht aus dem Test. */
async function searchFor(page: Page, query: string): Promise<SearchAnswer> {
    const antwort = page.waitForResponse(
        (response) => response.url().includes(`/api/search?q=${encodeURIComponent(query)}`) && response.ok(),
    );
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill(query);
    return (await (await antwort).json()) as SearchAnswer;
}

/**
 * 🔴 Betreiber 2026-09-26: „sie soll natürlich auch flächen ohne beschriftung finden“. „Mittelaventurien“ hat
 * kein Label und war unauffindbar; jetzt ist die Region selbst der Treffer, und er wählt sie wie ein Klick.
 */
test("🔴 WI-0047: eine Fläche ohne Beschriftung ist ein Treffer, leuchtet und trägt ihren Namen", async ({ page }) => {
    await openMap(page);
    const antwort = await searchFor(page, "Mittelaventurien");
    const treffer = antwort.hits.find((hit) => hit.kind === "landschaft" && hit.name === "Mittelaventurien");
    expect(treffer?.region, "die Region ist der Treffer").toBeTruthy();
    expect(treffer?.id).toBe(treffer?.region);
    await page
        .locator('[data-testid="search-hit"][data-kind="landschaft"]')
        .filter({ hasText: "Mittelaventurien" })
        .first()
        .click();
    await expect.poll(async () => (await selection(page))?.id).toBe(treffer!.region);
    await settle(page);
    const flaechen = await drawn(page, FILL);
    expect(new Set(flaechen.map((feature) => feature.properties["region_public_id"]))).toEqual(
        new Set([treffer!.region]),
    );
    await expectName(page, treffer!.region!, "Mittelaventurien", "Mittelaventurien");
});

/**
 * 🔴 G1 A (Betreiber 2026-09-26: „wir wollen A“): „Archipel der Perlen“ sind fünf Regionen gleichen Namens und
 * gleicher Art - EIN Treffer, alle leuchten, die Kamera rahmt alle.
 */
test("🔴 WI-0047: gleichnamige Regionen sind EIN Treffer, und alle leuchten", async ({ page }) => {
    await openMap(page);
    const antwort = await searchFor(page, "Archipel der Perlen");
    const treffer = antwort.hits.filter((hit) => hit.kind === "landschaft" && hit.name === "Archipel der Perlen");
    expect(treffer, "eine Zeile, nicht fünf").toHaveLength(1);
    const gruppe = treffer[0]!.regions ?? [];
    expect(gruppe.length).toBeGreaterThan(1);
    await expect(page.locator('[data-testid="search-hit"][data-kind="landschaft"]')).toHaveCount(1);
    await page.locator('[data-testid="search-hit"][data-kind="landschaft"]').click();
    await expect.poll(async () => (await selection(page))?.group?.length ?? 0).toBe(gruppe.length);
    await settle(page);
    // Der Rahmen zeigt die ganze Gruppe: Jede der Regionen ist gezeichnet, keine fremde.
    await expect
        .poll(async () =>
            [
                ...new Set((await drawn(page, FILL)).map((feature) => String(feature.properties["region_public_id"]))),
            ].sort(),
        )
        .toEqual([...gruppe].sort());
});

test("💣 WI-0047: Griffe erscheinen nicht in der Suche, weder als Fläche noch als Label", async ({ page }) => {
    await openMap(page);
    const antwort = await searchFor(page, "Flussland/Flusstal");
    expect(antwort.hits.filter((hit) => /-\d+$/.test(hit.name)).map((hit) => hit.name)).toEqual([]);
});

/** E1 (WI-0047): „Mittelaventurien“ liegt auf der Reise Gareth → Perricum und ist jetzt ein Knopf. */
test("🔴 WI-0047 E1: eine Landschaft ohne Beschriftung ist in der Reiseübersicht ein Knopf", async ({ page }) => {
    const antwort = page.waitForResponse(
        (response) => response.url().endsWith("/api/route/landscapes") && response.ok(),
    );
    await page.goto("/?route=Gareth~Perricum");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const regionen = ((await (await antwort).json()) as { regions: Record<string, { name: string | null }> }).regions;
    const [erwartet] = Object.entries(regionen).find(([, region]) => region.name === "Mittelaventurien") ?? [];
    expect(erwartet, "die Reise führt durch Mittelaventurien").toBeTruthy();
    const summary = page.getByTestId("route-landscapes");
    await page.getByTestId("areas-toggle").press("Enter");
    await summary.getByRole("button", { name: "Mittelaventurien", exact: true }).click();
    await expect.poll(async () => (await selection(page))?.id).toBe(erwartet);
    await settle(page);
    expect((await drawn(page, FILL)).length).toBeGreaterThan(0);
});

// Reale Kacheln und M8: mehrere Ziele pro Bild und aufeinanderfolgende Bilder.
test("schnelles Überfahren behält nur die letzte Landschaft ohne Filterarbeit", async ({ page }) => {
    await page.goto("/#x=468&y=527&z=6&series=original&view=landscapes&layer=topographie");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true);
    await settle(page);
    const targets = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const canvas = map.getCanvas();
        const found = new Map<string, { id: string; x: number; y: number }>();
        const blockers = [
            "place-marker",
            "place-marker-structure",
            "path-center-flussweg",
            "path-center-flussweg-bach",
        ].filter((id) => map.getLayer(id));
        for (let y = 150; y < canvas.clientHeight - 140 && found.size < 3; y += 19) {
            for (let x = 430; x < canvas.clientWidth - 160 && found.size < 3; x += 23) {
                if (blockers.length && map.queryRenderedFeatures([x, y], { layers: blockers }).length) continue;
                const hits = map.queryRenderedFeatures([x, y], { layers: ["landscape-fill-topographie"] });
                hits.sort(
                    (a, b) =>
                        Number(a.properties["area"]) - Number(b.properties["area"]) ||
                        String(a.properties["region_public_id"]).localeCompare(
                            String(b.properties["region_public_id"]),
                        ),
                );
                const id = hits[0]?.properties["region_public_id"];
                if (typeof id === "string") found.set(id, { id, x, y });
            }
        }
        return [...found.values()];
    });
    expect(targets).toHaveLength(3);
    await page.evaluate(async () => {
        const map = globalThis.avesmapsMap as unknown as import("maplibre-gl").Map;
        const original = map.setFilter.bind(map);
        const calls: string[] = [];
        Object.assign(globalThis, { hoverFilterCalls: calls });
        map.setFilter = (id, ...args) => {
            calls.push(id);
            return original(id, ...args);
        };
    });
    for (let round = 0; round < 3; round += 1) {
        for (const target of targets) await moveMap(page, target);
    }
    // Die Vorschau trägt die Linien der letzten Landschaft - und nur ihre: Dieselbe Form kommt heraus, wenn man sie allein zeigt.
    const active = () => vorschauLinien(page, "area-preview-outline");
    await expect.poll(active).toBeGreaterThan(0);
    const nurDieLetzte = await active();
    await page.waitForTimeout(350);
    expect(await active(), "nichts Verzögertes kommt nach").toBe(nurDieLetzte);
    expect(
        await page.evaluate(() =>
            (globalThis as unknown as { hoverFilterCalls: string[] }).hoverFilterCalls.filter((id) =>
                id.startsWith("area-preview"),
            ),
        ),
    ).toEqual([]);
    await page.mouse.move(-10, -10);
    await expect.poll(active).toBe(0);
    await moveMap(page, targets[2]!);
    await expect.poll(active, "keine Linien der Vorgänger A und B").toBe(nurDieLetzte);
});
