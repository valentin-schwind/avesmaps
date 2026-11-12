import { expect, test, type Page } from "@playwright/test";
import { MAP_CHECKS_URL, type MapCheckResult } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, showPlace } from "./map-handle.ts";
import { ME, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Prüfhaken im Auge (WI-0131 Stufe 1; Blatt 1 abgenommen 2026-10-10).
 *
 * Problemfälle: ein Besucher oder Tester sieht die Haken; ein Haken lädt, bevor ihn jemand einschaltet; ein ausgeschalteter Haken
 * zeichnet weiter; der Haken überlebt das Neuladen nicht; er landet in der Adresse. 🪤 Der Leseweg verlangt eine Sitzung mit
 * `use_editor_menu` (401 ohne): Die Tests legen die Sitzung und kleine Funde hin, wie die Ortseditor-Tests (`ortseditor-stub.ts`).
 */

const FUNDE: Record<string, MapCheckResult> = {
    "uphill-rivers": {
        check: "uphill-rivers",
        rivers: [
            {
                id: "f1",
                name: "Bodrin",
                rise: 12,
                lines: [
                    [
                        [470, 515],
                        [471.5, 516.5],
                    ],
                ],
            },
        ],
    },
    "loose-ends": {
        check: "loose-ends",
        paths: [
            {
                id: "w1",
                name: "Leuenach",
                lines: [
                    [
                        [472, 517],
                        [473, 518],
                    ],
                ],
            },
        ],
        ends: [{ x: 473, y: 518, path: "w1" }],
        absorbed_ends: 0,
        looped_paths: 0,
    },
    unconnected: { check: "unconnected", nodes: [{ id: "o1", kind: "place", name: "Âthykril", x: 474, y: 519 }] },
    "paths-apart": {
        check: "paths-apart",
        spots: [{ kind: "offen", x: 475, y: 520, path: "w3", other: "w1", distance: 0.0004, near_miss: true }],
        at_place: 0,
    },
    "no-wiki": { check: "no-wiki", places: [], paths: [] },
    "invalid-areas": { check: "invalid-areas", spots: [] },
};

const EDITOR = ["use_editor_menu", "view_flow_directions", "view_editor_series", "pin_selection"];

async function stubChecks(page: Page, funde: Record<string, MapCheckResult> = FUNDE): Promise<string[]> {
    const calls: string[] = [];
    await page.route(`**${MAP_CHECKS_URL}/*`, (route) => {
        const check = new URL(route.request().url()).pathname.split("/").pop() ?? "";
        calls.push(check);
        const body = funde[check];
        return body
            ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
            : route.fulfill({ status: 400, contentType: "application/json", body: "{}" });
    });
    return calls;
}

async function styleLayers(page: Page): Promise<string[]> {
    return page.evaluate(() => globalThis.avesmapsMap?.getStyle().layers.map((layer) => layer.id) ?? []);
}

async function openMenu(page: Page): Promise<void> {
    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-menu")).toBeVisible();
}

test("🔴 Editor: die Gruppe „Prüfen · nur Editoren“ in der Reihenfolge von Blatt 1, und nichts lädt vor dem Einschalten", async ({
    page,
}) => {
    await stubAdmin(page, { capabilities: EDITOR, role: "editor" });
    const calls = await stubChecks(page);
    await openMap(page, EDITOR_MODE);
    await openMenu(page);
    const gruppe = page.getByTestId("display-checks");
    await expect(gruppe.locator(".display-menu__title")).toHaveText(/Prüfen\s*nur Editoren/);
    const zeilen = await gruppe
        .locator("label")
        .evaluateAll((labels) => labels.map((label) => label.dataset["testid"]));
    expect(zeilen).toEqual([
        "display-flow",
        "display-check-uphill-rivers",
        "display-check-loose-ends",
        "display-check-unconnected",
        "display-check-paths-apart",
        "display-check-no-wiki",
        "display-check-invalid-areas",
        "display-tile-grid",
    ]);
    // Die Ebenen-Gruppe trägt die Editorschalter nicht mehr.
    await expect(
        page.getByTestId("display-menu").locator(".display-menu__group").nth(1).getByTestId("display-flow"),
    ).toHaveCount(0);
    expect(calls).toEqual([]);
});

test("Einschalten lädt und zeichnet, Ausschalten nimmt weg; der Haken bleibt nach dem Neuladen, nie in der Adresse", async ({
    page,
}) => {
    await stubAdmin(page, { capabilities: EDITOR, role: "editor" });
    const calls = await stubChecks(page);
    await openMap(page, EDITOR_MODE);
    await openMenu(page);

    await page.getByTestId("display-check-unconnected").click();
    await expect.poll(() => styleLayers(page)).toContain("check-unconnected");
    expect(calls).toEqual(["unconnected"]);
    expect(page.url()).not.toContain("unconnected");
    expect(await page.evaluate((key) => globalThis.localStorage.getItem(key), `avesmaps3d.pruefhaken.${ME.id}`)).toBe(
        '["unconnected"]',
    );

    await page.reload();
    await expect.poll(() => styleLayers(page)).toContain("check-unconnected");
    await openMenu(page);
    await expect(page.getByTestId("display-check-unconnected").locator("input")).toBeChecked();

    await page.getByTestId("display-check-unconnected").click();
    await expect.poll(() => styleLayers(page)).not.toContain("check-unconnected");

    await page.getByTestId("display-check-loose-ends").click();
    await page.getByTestId("display-check-uphill-rivers").click();
    await page.getByTestId("display-check-paths-apart").click();
    await expect
        .poll(() => styleLayers(page))
        .toEqual(
            expect.arrayContaining([
                "check-loose-path",
                "check-loose-end",
                "check-uphill-river",
                "check-paths-apart-halo",
                "check-paths-apart",
            ]),
        );
});

test("🔴 „Wege treffen sich nicht“: fast deckungsgleiche Stellen als ein Ring, gefüllt, sobald eine knapp verfehlt; hineingezoomt wieder einzeln", async ({
    page,
}) => {
    // Drei Stellen bei Gareth: zwei fast deckungsgleich (eine „knapp verfehlt“), die dritte 0,3 E daneben. Bei Zoom 5 sind 0,3 E
    // rund 5 Bildpunkte, alle drei liegen im Rund eines Rings; bei Zoom 9 rund 77 Bildpunkte.
    const spots = [
        { kind: "offen", x: 551, y: 530, path: "w3", other: "w1", distance: 0.0004, near_miss: true },
        { kind: "offen", x: 551.0004, y: 530, path: "w1", other: "w3", distance: 0.0004, near_miss: false },
        { kind: "kreuzt", x: 551.3, y: 530, path: "w5", other: "w6", distance: null, near_miss: false },
    ] as const;
    await stubAdmin(page, { capabilities: EDITOR, role: "editor" });
    await stubChecks(page, { ...FUNDE, "paths-apart": { check: "paths-apart", spots: [...spots], at_place: 0 } });
    await openMap(page, EDITOR_MODE);
    await openMenu(page);
    await page.getByTestId("display-check-paths-apart").click();
    await expect.poll(() => styleLayers(page)).toContain("check-paths-apart");

    const rings = async (zoom: number) => {
        await showPlace(page, { x: 551.15, y: 530 }, zoom);
        return page.evaluate(() =>
            (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["check-paths-apart"] }) ?? [])
                .map((feature) => ({
                    count: Number(feature.properties["point_count"] ?? 1),
                    near: feature.properties["near"] === true,
                }))
                .sort((a, b) => b.count - a.count),
        );
    };
    expect(await rings(5)).toEqual([{ count: 3, near: true }]);
    expect(await rings(9)).toEqual([
        { count: 2, near: true },
        { count: 1, near: false },
    ]);
});

test("🔴 Besucher: keine Gruppe, und gemerkte Haken laden nicht", async ({ page }) => {
    const calls = await stubChecks(page);
    await page.addInitScript(() => globalThis.localStorage.setItem("avesmaps3d.pruefhaken", '["unconnected"]'));
    await openMap(page);
    await openMenu(page);
    await expect(page.getByTestId("display-checks")).toHaveCount(0);
    expect(calls).toEqual([]);
    expect(await styleLayers(page)).not.toContain("check-unconnected");
});

test("Tester: Strömungsrichtungen und Kachelraster, aber keine Prüfhaken (die verlangen `use_editor_menu`)", async ({
    page,
}) => {
    await stubAdmin(page, { capabilities: ["view_flow_directions", "view_editor_series"], role: "tester" });
    await stubChecks(page);
    await openMap(page, EDITOR_MODE);
    await openMenu(page);
    const gruppe = page.getByTestId("display-checks");
    await expect(gruppe.getByTestId("display-flow")).toBeVisible();
    await expect(gruppe.getByTestId("display-tile-grid")).toBeVisible();
    await expect(gruppe.locator("[data-testid^='display-check-']")).toHaveCount(0);
});

test("🔴 ohne Anmeldung keine Prüfhaken, auch wenn die Übergangsansicht das Recht meldet (Fehlerbericht 2026-10-10)", async ({
    page,
}) => {
    // So antwortet der lokale Stapel ohne Sitzung: Anmeldung eingerichtet, keine Person, die Leserechte der Übergangsansicht.
    await page.route("**/api/auth/session", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                environment: "development",
                authEnabled: true,
                person: null,
                capabilities: ["use_editor_menu", "view_editor_series", "view_flow_directions"],
            }),
        }),
    );
    await page.addInitScript(() => globalThis.localStorage.setItem("avesmaps3d.pruefhaken", '["unconnected"]'));
    const calls = await stubChecks(page);
    await openMap(page, EDITOR_MODE);
    // Ohne Person geht auf /edit das Anmeldefenster auf (WI-0203); geprüft wird die Karte dahinter.
    await expect(page.getByRole("dialog", { name: "Anmelden" })).toBeVisible();
    await page.keyboard.press("Escape");
    await openMenu(page);
    await expect(page.getByTestId("display-checks").locator("[data-testid^='display-check-']")).toHaveCount(0);
    expect(calls).toEqual([]);
});

test("🔴 eine Absage des Servers steht als Satz am Haken: 403 „Nur angemeldet mit Editorrechten“, 500 „Gerade nicht ladbar“", async ({
    page,
}) => {
    await stubAdmin(page, { capabilities: EDITOR, role: "editor" });
    await page.route(`**${MAP_CHECKS_URL}/*`, (route) => {
        const check = new URL(route.request().url()).pathname.split("/").pop() ?? "";
        return route.fulfill({
            status: check === "unconnected" ? 403 : 500,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "forbidden", message: "Dafür fehlt das Recht." } }),
        });
    });
    await openMap(page, EDITOR_MODE);
    await openMenu(page);
    await page.getByTestId("display-check-unconnected").click();
    await expect(page.getByTestId("display-check-problem-unconnected")).toHaveText("Nur angemeldet mit Editorrechten");
    await page.getByTestId("display-check-loose-ends").click();
    await expect(page.getByTestId("display-check-problem-loose-ends")).toHaveText("Gerade nicht ladbar");
    expect(await styleLayers(page)).not.toContain("check-unconnected");
    // Ausschalten nimmt den Satz weg.
    await page.getByTestId("display-check-unconnected").click();
    await expect(page.getByTestId("display-check-problem-unconnected")).toHaveCount(0);
});
