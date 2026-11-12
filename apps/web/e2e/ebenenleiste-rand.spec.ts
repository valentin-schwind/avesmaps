import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorLandscapeDetail } from "@avesmaps3d/shared";
import { EDITOR_MODE, onPage, settleFrame } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Ebenenleiste endet vor dem angedockten Fenster, sobald es aufgeht, ohne dass sich die Größe des Browserfensters ändert (WI-0225, Befund
 * der Probierseite T60, EDIT-0003): Gleich nach dem Öffnen des Derographie-Fensters stand sie mittig über der ganzen Breite und lief 294 px
 * unter das Fenster, bis eine Größenänderung den Rand nachrechnete. Liste und Sperren aus Stubs; 🔴 kein Test schreibt in die Datenbank.
 *
 * Problemfall: Die Leiste reicht nach dem Öffnen unter das Fenster oder seine Lasche. Sollfall: Sie endet links davor, auch nach dem Schließen
 * wieder über der ganzen freien Karte.
 */

const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function oeffneDerographie(page: Page, planerZu: boolean): Promise<void> {
    await stubAdmin(page, {
        capabilities: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        role: "editor",
    });
    await page.route("**/api/editor/status", (route) => json(route, { mapEditing: "testwelt" }));
    await page.route("**/api/editor/landscapes", (route) => json(route, { rows: [] }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release))?(\?.*)?$/, (route) =>
        route.request().method() === "GET" ? json(route, { locks: [] }) : json(route, { lost: [] }),
    );
    await page.goto(`${EDITOR_MODE}#x=455.000&y=548.000&z=6.80&series=original&view=landscapes&layer=vegetation`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    if (planerZu) {
        await page.getByTestId("route-planner-tab").click();
        await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "false");
    }
    await expect(page.getByTestId("ebenenleiste")).toBeVisible();
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    await expect(page.locator('dialog[data-lage="angedockt"]')).toBeVisible();
}

/** Rechte Kante der Ebenenleiste und linke Kante von Fenster und Editor-Lasche, in Bildpunkten der Seite. */
const kanten = (page: Page) =>
    page.evaluate(() => {
        const rechts = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
        return {
            leiste: rechts('[data-testid="ebenenleiste"]')?.right ?? Number.NaN,
            fenster: rechts('dialog[data-lage="angedockt"]')?.left ?? Number.NaN,
            lasche: rechts('[data-testid="editor-panel-tab"]')?.left ?? Number.NaN,
        };
    });

for (const { breite, hoehe, planerZu } of [
    { breite: 1920, hoehe: 1080, planerZu: false },
    { breite: 1280, hoehe: 800, planerZu: true },
])
    test.describe(`${String(breite)} × ${String(hoehe)}`, () => {
        test.use({ viewport: { width: breite, height: hoehe } });

        test(`🔴 Ebenenleiste endet nach dem Öffnen des Fensters vor ihm, ohne Größenänderung (${String(breite)} px)`, async ({
            page,
        }) => {
            await oeffneDerographie(page, planerZu);
            // Vor dem Fenster UND vor seiner Lasche, die links an ihm steht.
            await expect
                .poll(async () => {
                    const k = await kanten(page);
                    return k.leiste <= Math.min(k.fenster, k.lasche) + 0.5;
                })
                .toBe(true);
            // Das Fenster schließen: Die Leiste darf wieder über die ganze freie Karte reichen (rechts an der Kante).
            await page.locator('dialog[data-lage="angedockt"]').getByTestId("fenster-schliessen").click();
            await expect(page.locator('dialog[data-lage="angedockt"]')).toHaveCount(0);
            await expect.poll(async () => (await kanten(page)).leiste, { timeout: 10_000 }).toBeGreaterThan(breite / 2);
        });
    });

/**
 * Die Ebenenleiste bleibt stehen, solange ein Modus läuft (WI-0225, Betreiber 2026-10-20 über die Editor-Orchestrierung, wörtlich: „die
 * leiste mit "alle", "region", "vegetation", usw. darf nicht verschwinden, wenn die bearbeitungen der gebirgseigenschaften (oder anderer
 * tools) eingeblendet wird. hier in diesem fall brauchen wir z.b. kontrolle über die transparenz des untergrunds.“). Die Leiste des Modus
 * steht darunter (oder unten im Fenster, T45 (3)), das Rad unter beiden. Modus hier „Ecken bearbeiten“ an einer Landschaft aus Stubs.
 *
 * Problemfall: Mit dem Modus verschwindet die Ebenenleiste, ◐ ist nicht erreichbar, oder Modusleiste und Rad liegen über ihr.
 */
const LANDSCHAFT: EditorLandscapeDetail = {
    id: "a4a4a4a4-0000-4000-8000-0000000000d1",
    name: "Probe",
    layer: "vegetation",
    circle: "halb-rechts",
    order: 1,
    clickLocked: false,
    areas: [
        {
            id: "a4a4a4a4-0000-4000-8000-0000000000d2",
            polygons: [
                [
                    [
                        [440, 552],
                        [460, 552],
                        [462, 568],
                        [441, 570],
                    ],
                ],
            ],
            affectsPaths: true,
            revision: 4,
        },
    ],
    labels: [],
    neighbors: [],
    revision: 1,
};

async function starteEcken(page: Page): Promise<void> {
    await stubAdmin(page, {
        capabilities: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        role: "editor",
    });
    await page.route("**/api/editor/status", (route) => json(route, { mapEditing: "testwelt" }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return json(route, { locks: [] });
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return json(route, { lost: [] });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        return json(route, {
            lock: {
                ...body,
                person: { id: "a4a4a4a4-0000-4000-8000-0000000000f1", name: "Rondrikan" },
                since: "2026-10-21T08:00:00.000Z",
                heartbeatAt: "2026-10-21T08:00:00.000Z",
                own: true,
            },
        });
    });
    await page.route("**/api/editor/landscapes", (route) =>
        json(route, {
            rows: [{ id: LANDSCHAFT.id, name: "Probe", layer: "vegetation", circle: "halb-rechts", order: 1 }],
        }),
    );
    await page.route("**/api/editor/landscapes/*", (route) => json(route, LANDSCHAFT));
    await page.route(/\/api\/editor\/landscapes\/[^/]+\/targets/, (route) =>
        json(route, { margin: 15, neighbors: [], edges: [], riverPoints: [] }),
    );
    await page.goto(`${EDITOR_MODE}#x=450&y=560&z=6.5&series=original&view=landscapes&layer=vegetation`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
    await expect(page.getByTestId("ebenenleiste")).toBeVisible();
    // Eine Stelle mit genau einer Landschaft, nahe der Mitte der freien Fläche (wie `wegeditor-ein-modus.spec.ts`).
    const stelle = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const ids = (map.getStyle().layers ?? []).map((l) => l.id).filter((id) => id.startsWith("landscape-fill-"));
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        for (let r = 0; r < 240; r += 8)
            for (let w = 0; w < 360; w += 30) {
                const x = Math.round(mitte.x + r * Math.cos((w * Math.PI) / 180));
                const y = Math.round(mitte.y + r * Math.sin((w * Math.PI) / 180));
                const regionen = new Set(
                    map
                        .queryRenderedFeatures([x, y], { layers: ids })
                        .map((f) => String(f.properties["region_public_id"])),
                );
                if (regionen.size === 1) return { x, y };
            }
        return undefined;
    });
    expect(stelle, "eine Stelle mit genau einer Landschaft").toBeDefined();
    const at = await onPage(page, stelle!);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-flaeche-gebietsform").click();
    await expect(page.getByTestId("ecken-leiste")).toBeVisible();
}

for (const { breite, hoehe } of [
    { breite: 1920, hoehe: 1080 },
    { breite: 1280, hoehe: 800 },
])
    test.describe(`Modus ${String(breite)} × ${String(hoehe)}`, () => {
        test.use({ viewport: { width: breite, height: hoehe } });

        test(`🔴 läuft ein Modus, bleibt die Ebenenleiste mit ◐ stehen, die Modusleiste und das Rad darunter (${String(breite)} px)`, async ({
            page,
        }) => {
            await starteEcken(page);
            const ebenen = page.getByTestId("ebenenleiste");
            await expect(ebenen).toBeVisible();
            // ◐ bleibt bedienbar: der Regler des Untergrunds klappt auf.
            await page.getByTestId("ebenenleiste-untergrund-knopf").click();
            await expect(page.getByTestId("ebenenleiste-untergrund-zeile")).toBeVisible();
            // Die aufgeklappte Zeile liegt über der Modusleiste (OPS-000054, 07a647fbd: Sie lag unter ihr und war nicht bedienbar): Der Regler nimmt
            // den Klick an. Playwright prüft vor dem Klick, dass nichts davor liegt.
            await page.getByTestId("ebenenleiste-untergrund-bahn").click();
            // Untereinander: die Modusleiste unter der Ebenenleiste, sofern sie über der Karte steht; das Rad unter beiden.
            await expect
                .poll(() =>
                    page.evaluate(() => {
                        const r = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
                        const e = r('[data-testid="ebenenleiste"]')!;
                        const m = document.querySelector('[data-testid="ecken-leiste"]');
                        const imFenster = m?.closest("dialog") !== null;
                        const mb = m?.getBoundingClientRect();
                        const rad = r('[data-testid="camera-controls"]');
                        const unten = imFenster || mb === undefined ? e.bottom : Math.max(e.bottom, mb.bottom);
                        const modusDarunter = imFenster || mb === undefined || mb.top >= e.bottom - 0.5;
                        const radDarunter = rad === undefined || rad.top >= unten - 0.5;
                        return modusDarunter && radDarunter;
                    }),
                )
                .toBe(true);
            // Die Zeile schließt mit dem Knopf. Offen deckt sie als Blatt über der Karte die Modusleiste, auch ihr „Fertig“ (Fokus bliebe im Bauteil).
            await page.getByTestId("ebenenleiste-untergrund-knopf").click();
            await expect(page.getByTestId("ebenenleiste-untergrund-zeile")).toHaveCount(0);
            // Den Modus beenden: Ohne Schritt endet er mit „Fertig“; die Ebenenleiste bleibt.
            await page.getByTestId("ecken-leiste-fertig").click();
            await expect(page.getByTestId("ecken-leiste")).toHaveCount(0);
            await expect(ebenen).toBeVisible();
        });
    });

/**
 * Zeichen in der Ebenenleiste (WI-0225, Betreiber 2026-10-21, wörtlich: „auch die "Derographische" leiste (mit Alle, Regionen, Topographie,
 * Vegetation und Klima) könnte durch icons ergänzt und vollständig ersetzt werden, wenn das menü in der breite zu klein wird.“): Jeder Reiter
 * trägt sein Zeichen; passt die Leiste mit Namen nicht, stehen nur die Zeichen, der Name im Hinweis. Die gewählte Ebene bleibt gefüllt, ◐
 * bleibt bedienbar, nichts wird gekürzt und nichts läuft über die Bühne.
 *
 * Problemfälle: Namen mit „…“ gekürzt, Reiter unter Fenster oder Lasche, ein Zeichen fehlt, ohne Namen kein Hinweis.
 */
// Fünf Reiter: „Sprachen“ steht seit 2026-10-31 nicht mehr in der Leiste (Betreiber: „Kannst du "Sprachen" aus dem Derographie-Menü oben … raustun“),
// nur noch im Kartenfächer.
const EBENEN = ["alle", "derographisch", "vegetation", "topographie", "klima"];

async function pruefeZeichen(page: Page, erwartet: "namen" | "zeichen" | "eines"): Promise<void> {
    const leiste = page.getByTestId("ebenenleiste");
    await expect(leiste).toBeVisible();
    for (const ebene of EBENEN)
        await expect(page.getByTestId(`ebenenleiste-ebene-${ebene}`).locator("svg.editor-zeichen")).toBeVisible();
    await expect(page.getByTestId("ebenenleiste-ebene-vegetation")).toHaveAttribute("aria-pressed", "true");
    const stand = await page.evaluate(() => {
        const l = document.querySelector('[data-testid="ebenenleiste"]')!;
        const namen = [...l.querySelectorAll('[data-testid^="ebenenleiste-ebene-"] .einzeilig')] as HTMLElement[];
        const knoepfe = [...l.querySelectorAll('[data-testid^="ebenenleiste-ebene-"]')] as HTMLElement[];
        const fenster =
            document.querySelector('dialog[data-lage="angedockt"]')?.getBoundingClientRect().left ?? Infinity;
        const lasche =
            document.querySelector('[data-testid="editor-panel-tab"]')?.getBoundingClientRect().left ?? Infinity;
        return {
            namen: namen.length,
            gekuerzt: namen.filter((n) => n.scrollWidth > n.clientWidth + 1).length,
            hinweise: knoepfe.filter((k) => (k.getAttribute("title") ?? "") !== "").length,
            rechts: l.getBoundingClientRect().right,
            grenze: Math.min(fenster, lasche),
            ueberlauf: l.scrollWidth > l.clientWidth + 1,
        };
    });
    expect(stand.gekuerzt, "kein Name mit „…“").toBe(0);
    expect(stand.hinweise, "jeder Reiter nennt seinen Namen im Hinweis").toBe(EBENEN.length);
    expect(stand.ueberlauf, "nichts läuft über die Leiste").toBe(false);
    expect(stand.rechts, "die Leiste endet vor Fenster und Lasche").toBeLessThanOrEqual(stand.grenze + 0.5);
    if (erwartet === "namen") expect(stand.namen).toBe(EBENEN.length);
    if (erwartet === "zeichen") expect(stand.namen).toBe(0);
    if (erwartet === "eines") expect([0, EBENEN.length]).toContain(stand.namen);
    await page.getByTestId("ebenenleiste-untergrund-knopf").click();
    await expect(page.getByTestId("ebenenleiste-untergrund-zeile")).toBeVisible();
    await page.getByTestId("ebenenleiste-untergrund-knopf").click();
}

// Im Editor stehen Planer (350 px) und Editorpanel (400 px) offen: Erst bei 1920 px reicht die freie Karte für die Namen.
for (const { breite, hoehe, ohneModus, mitModus } of [
    { breite: 1920, hoehe: 1080, ohneModus: "namen" as const, mitModus: "eines" as const },
    { breite: 1440, hoehe: 900, ohneModus: "zeichen" as const, mitModus: "zeichen" as const },
    { breite: 1280, hoehe: 800, ohneModus: "zeichen" as const, mitModus: "zeichen" as const },
])
    test.describe(`Zeichen ${String(breite)} × ${String(hoehe)}`, () => {
        test.use({ viewport: { width: breite, height: hoehe } });

        test(`🔴 ohne Modus: Zeichen in der Ebenenleiste, Namen nur mit Platz (${String(breite)} px)`, async ({
            page,
        }) => {
            await stubAdmin(page, {
                capabilities: [
                    "use_editor_menu",
                    "edit_map_objects",
                    "edit_map_geometry",
                    "edit_territories",
                    "edit_landscapes",
                    "edit_territory_form",
                    "edit_landscape_form",
                    "edit_mountains",
                ],
                role: "editor",
            });
            await page.route("**/api/editor/status", (route) => json(route, { mapEditing: "testwelt" }));
            await page.route("**/api/editor/landscapes", (route) => json(route, { rows: [] }));
            await page.goto(
                `${EDITOR_MODE}#x=455.000&y=548.000&z=6.80&series=original&view=landscapes&layer=vegetation`,
            );
            await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
            await pruefeZeichen(page, ohneModus);
        });

        test(`🔴 mit Modus: die Ebenenleiste bleibt, bei schmaler Karte nur Zeichen (${String(breite)} px)`, async ({
            page,
        }) => {
            await starteEcken(page);
            await pruefeZeichen(page, mitModus);
            await page.getByTestId("ecken-leiste-fertig").click();
            await expect(page.getByTestId("ecken-leiste")).toHaveCount(0);
        });
    });
