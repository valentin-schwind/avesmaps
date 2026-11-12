import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorLandscapeDetail } from "@avesmaps3d/shared";
import { settleFrame } from "./map-handle.ts";
import { json, oeffneFlaechenWerkzeug, stellen, type Stelle } from "./landschaft-werkzeug-stub.ts";

/**
 * „Fläche malen“ und „Fläche radieren“ im Kartenmenü (WI-0178 Werkzeug 6; EDIT-0003 T34 (4), T41 (5) „Ja, Alt und Zeichen“; EDIT-0004
 * §2.13): Die Fläche unter dem Rechtsklick kommt aus den Kacheln der lokalen Karte; Detail, Nachbarn, Sperre, die Rechnung des Strichs und
 * der Schreibweg aus Stubs. 🔴 Kein Test schreibt in die Datenbank der Entwicklung.
 *
 * Problemfälle: Der Eintrag bleibt „Kommt später“; der Kreis fehlt oder trägt das falsche Zeichen; Strg+Mausrad zoomt die Karte statt den
 * Pinsel zu ändern; Ziehen schiebt die Karte statt zu malen; Alt wirkt nicht; mit gehaltener Leertaste wird gemalt; „Fertig“ schreibt
 * etwas anderes als das gerechnete Ergebnis.
 */

interface Server {
    striche: Record<string, unknown>[];
    geschrieben: Record<string, unknown>[];
}

async function aufbau(page: Page): Promise<{ stelle: Stelle; server: Server; ergebnisse: [number, number][][][][] }> {
    const server: Server = { striche: [], geschrieben: [] };
    const stub: { detail?: EditorLandscapeDetail } = {};
    await oeffneFlaechenWerkzeug(page, (route: Route) => {
        if (route.request().method() === "PATCH") {
            server.geschrieben.push(route.request().postDataJSON() as Record<string, unknown>);
            return route.fulfill(
                json(200, {
                    operationId: "a6a6a6a6-0000-4000-8000-0000000000e1",
                    status: "applied",
                    environment: "test",
                    affected: [],
                    derivedWork: [],
                    warnings: [],
                }),
            );
        }
        return route.fulfill(json(stub.detail === undefined ? 404 : 200, stub.detail ?? { message: "unbekannt" }));
    });
    const [stelle] = await stellen(page, [
        { dx: 80, dy: 0 },
        { dx: -80, dy: 0 },
    ]);
    const karte = (dx: number, dy: number) =>
        page.evaluate(
            ([x, y]) => {
                const k = globalThis.avesmapsRenderProjection!.fromRenderLngLat(
                    globalThis.avesmapsMap!.unproject([x!, y!]),
                );
                return [k.x, k.y] as [number, number];
            },
            [stelle!.canvas.x + dx, stelle!.canvas.y + dy],
        );
    const umriss = [await karte(-30, -30), await karte(30, -30), await karte(30, 30), await karte(-30, 30)];
    // Je Strich ein anderes Ergebnis: Ein Schritt mit demselben Stand wäre keiner.
    const ergebnisse: [number, number][][][][] = [
        [[[await karte(-30, -30), await karte(90, -30), await karte(90, 30), await karte(-30, 30)]]],
        [[[await karte(-30, -30), await karte(60, -30), await karte(60, 30), await karte(-30, 30)]]],
    ];
    stub.detail = {
        id: stelle!.region,
        name: "Krötensumpf",
        layer: "vegetation",
        circle: "halb-rechts",
        order: 1,
        clickLocked: false,
        areas: [{ id: stelle!.area, polygons: [[umriss]], affectsPaths: true, revision: 5 }],
        labels: [],
        neighbors: [],
        revision: 1,
    };
    await page.route(/\/api\/editor\/landscapes\/[^/]+\/targets/, (route) =>
        route.fulfill(json(200, { margin: 15, neighbors: [], edges: [], riverPoints: [] })),
    );
    await page.route(/\/api\/editor\/landscapes\/[^/]+\/brush$/, (route) => {
        server.striche.push(route.request().postDataJSON() as Record<string, unknown>);
        return route.fulfill(
            json(200, { polygons: ergebnisse[Math.min(server.striche.length, ergebnisse.length) - 1] }),
        );
    });
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return route.fulfill(json(200, { locks: [] }));
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return route.fulfill(json(200, { lost: [] }));
        const body = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill(
            json(200, {
                lock: {
                    ...body,
                    person: { id: "a6a6a6a6-0000-4000-8000-0000000000f1", name: "Rondrikan" },
                    since: "2026-10-19T08:00:00.000Z",
                    heartbeatAt: "2026-10-19T08:00:00.000Z",
                    own: true,
                },
            }),
        );
    });
    return { stelle: stelle!, server, ergebnisse };
}

async function starte(page: Page, stelle: Stelle, eintrag: "malen" | "radieren"): Promise<void> {
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await page.getByTestId("context-editor-gruppe-form").hover();
    const griff = page.getByTestId(`context-editor-flaeche-${eintrag}`);
    await expect(griff).toBeEnabled();
    await griff.click();
    await expect(page.getByTestId("flaeche-malen-leiste")).toBeVisible();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
}

async function ziehe(page: Page, von: { x: number; y: number }, dx: number): Promise<void> {
    await page.mouse.move(von.x, von.y);
    await page.mouse.down();
    await page.mouse.move(von.x + dx / 2, von.y, { steps: 4 });
    await page.mouse.move(von.x + dx, von.y, { steps: 4 });
    await page.mouse.up();
}

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 Pinsel: Kreis mit Zeichen, Strg+Mausrad ändert die Größe, Ziehen malt EINEN Schritt, Alt radiert, „Fertig“ schreibt das Gerechnete", async ({
    page,
}) => {
    const { stelle, server, ergebnisse } = await aufbau(page);
    await starte(page, stelle, "malen");
    const leiste = page.getByTestId("flaeche-malen-leiste");
    await expect(leiste).toContainText("Fläche malen");
    await expect(leiste).toContainText("Krötensumpf");
    await expect(page.getByTestId("flaeche-malen-groesse")).toHaveText("Pinsel 40 px");

    await page.mouse.move(stelle.x + 10, stelle.y + 5);
    const kreis = page.getByTestId("pinsel-kreis");
    await expect(kreis).toBeVisible();
    await expect(kreis).toHaveAttribute("data-art", "malen");
    await expect(page.getByTestId("pinsel-zeichen")).toHaveAttribute("data-art", "malen");

    // Strg+Mausrad: der Pinsel wächst um × 1,18, die Karte zoomt nicht.
    const zoom = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect(page.getByTestId("flaeche-malen-groesse")).toHaveText("Pinsel 47 px");
    await expect.poll(async () => Number(await kreis.getAttribute("r"))).toBeCloseTo(47.2, 3);
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getZoom())).toBeCloseTo(zoom, 5);
    await page.screenshot({ path: "test-results/werkzeug6-pinsel.png" });

    // Ziehen malt: EIN Strich, die Karte bleibt stehen.
    const mitte = await page.evaluate(() => [
        globalThis.avesmapsMap!.getCenter().lng,
        globalThis.avesmapsMap!.getCenter().lat,
    ]);
    await ziehe(page, { x: stelle.x + 20, y: stelle.y }, 60);
    await expect.poll(() => server.striche.length).toBe(1);
    expect(server.striche[0]).toMatchObject({ areaId: stelle.area, mode: "malen" });
    expect((server.striche[0]!["line"] as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(server.striche[0]!["radius"]).toBeGreaterThan(0);
    expect(
        await page.evaluate(() => [globalThis.avesmapsMap!.getCenter().lng, globalThis.avesmapsMap!.getCenter().lat]),
    ).toEqual(mitte);
    await expect(page.getByTestId("flaeche-malen-leiste-ungespeichert")).toHaveText("1 ungespeichert");

    // Alt halten: das Gegenwerkzeug, Kreis, Zeichen und Leiste wechseln; Loslassen führt zurück.
    await page.keyboard.down("Alt");
    await expect(kreis).toHaveAttribute("data-art", "radieren");
    await expect(page.getByTestId("pinsel-zeichen")).toHaveAttribute("data-art", "radieren");
    await expect(leiste).toContainText("Fläche radieren");
    await ziehe(page, { x: stelle.x - 10, y: stelle.y }, 20);
    await page.keyboard.up("Alt");
    await expect.poll(() => server.striche.length).toBe(2);
    expect(server.striche[1]).toMatchObject({ mode: "radieren" });
    await expect(kreis).toHaveAttribute("data-art", "malen");
    await expect(page.getByTestId("flaeche-malen-leiste-ungespeichert")).toHaveText("2 ungespeichert");

    await page.getByTestId("flaeche-malen-leiste-fertig").click();
    await expect(leiste).toHaveCount(0);
    await expect.poll(() => server.geschrieben.length).toBe(1);
    const areas = server.geschrieben[0]!["areas"] as { id: string; baseRevision: number; polygons: unknown }[];
    expect(areas).toEqual([{ id: stelle.area, baseRevision: 5, polygons: ergebnisse[1] }]);
});

test("🔴 mit gehaltener Leertaste zieht der Druck die Karte, gemalt wird nichts", async ({ page }) => {
    const { stelle, server } = await aufbau(page);
    await starte(page, stelle, "radieren");
    await page.mouse.move(stelle.x + 10, stelle.y + 5);
    await expect(page.getByTestId("pinsel-kreis")).toHaveAttribute("data-art", "radieren");
    const mitte = await page.evaluate(() => [
        globalThis.avesmapsMap!.getCenter().lng,
        globalThis.avesmapsMap!.getCenter().lat,
    ]);
    await page.keyboard.down(" ");
    await ziehe(page, { x: stelle.x, y: stelle.y }, 70);
    await page.keyboard.up(" ");
    await page.waitForTimeout(300);
    expect(server.striche).toHaveLength(0);
    expect(
        await page.evaluate(() => [globalThis.avesmapsMap!.getCenter().lng, globalThis.avesmapsMap!.getCenter().lat]),
    ).not.toEqual(mitte);
});

test("🔴 Leertaste halten, ziehen, loslassen, weitermalen: die gehaltene Taste öffnet nicht zugleich die Suche", async ({
    page,
}) => {
    // Die Leertaste ist auch ein Kürzel (`keyboard/install-keyboard.ts`): ohne Recht zum Fixieren „Suche“, mit ihm „Auswahl fixieren“
    // (Fund der Gebiete beim Zeichnen, c79e82d29, dbbb0c17c). Der Pinsel fängt die Taste jetzt vorher ab. Der Fall hält Ziehen,
    // Weitermalen, die geschlossene Suche und die Fixierung fest.
    const { stelle, server } = await aufbau(page);
    await starte(page, stelle, "malen");
    await page.mouse.move(stelle.x + 10, stelle.y + 5);
    const fixiert = page.getByTestId("info-pinned");
    const vorher = await fixiert.count();
    await page.keyboard.down(" ");
    await page.keyboard.down(" ");
    await page.keyboard.down(" ");
    // Erst nach einem Bild: Das Kürzel öffnete die Suche mit dem nächsten Durchlauf von Vue (wie neue-flaeche.spec.ts).
    await page.evaluate(() => new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig))));
    await expect(page.getByTestId("search")).toHaveCount(0);
    await ziehe(page, { x: stelle.x, y: stelle.y }, 70);
    await page.keyboard.up(" ");
    await expect(fixiert).toHaveCount(vorher);
    expect(server.striche).toHaveLength(0);
    // Weitermalen: Die Karte ist um 70 px gewandert, die Fläche mit ihr.
    await ziehe(page, { x: stelle.x + 70, y: stelle.y }, 30);
    await expect.poll(() => server.striche.length).toBe(1);
    await expect(fixiert).toHaveCount(vorher);
    await expect(page.getByTestId("search")).toHaveCount(0);
});

test("🔴 T58 (3): im Modus „Gebietsform bearbeiten“ geht „Malen“ weiter; Ecke ziehen, malen, ↶ nimmt den Strich, ↶ nimmt die Ecke", async ({
    page,
}) => {
    const { stelle } = await aufbau(page);
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await page.getByTestId("context-editor-flaeche-gebietsform").click();
    await expect(page.getByTestId("ecken-leiste")).toBeVisible();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    // Die Ecke oben rechts des Umrisses (30 px um die Stelle) ein Stück nach rechts.
    await ziehe(page, { x: stelle.x + 30, y: stelle.y - 30 }, 20);
    await expect(page.getByTestId("ecken-leiste-ungespeichert")).toHaveText("1 ungespeichert");

    // Im Modus zeigt das Menü, was im selben Entwurf weitergeht; was nicht geht, fehlt (nicht grau).
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await page.getByTestId("context-editor-gruppe-form").hover();
    await expect(page.getByTestId("context-editor-flaeche-malen")).toBeEnabled();
    await expect(page.getByTestId("context-editor-flaeche-radieren")).toBeEnabled();
    await expect(page.getByTestId("context-editor-flaeche-zerschneiden")).toHaveCount(0);
    await expect(page.getByTestId("context-editor-flaeche-entfernen")).toHaveCount(0);
    await page.getByTestId("context-editor-flaeche-malen").click();

    // Der Wechsel behält den Entwurf: Die Ecke zählt weiter mit.
    const leiste = page.getByTestId("flaeche-malen-leiste");
    await expect(leiste).toBeVisible();
    await expect(page.getByTestId("ecken-leiste")).toHaveCount(0);
    await expect(page.getByTestId("flaeche-malen-leiste-ungespeichert")).toHaveText("1 ungespeichert");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    await ziehe(page, { x: stelle.x + 10, y: stelle.y + 5 }, 60);
    await expect(page.getByTestId("flaeche-malen-leiste-ungespeichert")).toHaveText("2 ungespeichert");

    await page.getByTestId("flaeche-malen-leiste-zurueck").click();
    await expect(page.getByTestId("flaeche-malen-leiste-ungespeichert")).toHaveText("1 ungespeichert");
    await page.getByTestId("flaeche-malen-leiste-zurueck").click();
    await expect(page.getByTestId("flaeche-malen-leiste-ungespeichert")).toHaveText("0 ungespeichert");
});
