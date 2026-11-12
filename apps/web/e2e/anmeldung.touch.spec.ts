import { expect, test } from "@playwright/test";

/**
 * Die Kopfleiste am Telefon (WI-0120 A9): Name und Rolle weichen, Avatar und ☰ bleiben; das Menü steht ganz im Bild, und
 * das Anmeldefenster passt in die Breite.
 */
const SESSION = {
    environment: "staging",
    authEnabled: true,
    person: {
        id: "0f8e5a52-6d0b-4f43-9c1e-2b7d9a3c4e51",
        displayName: "Rondrikan",
        role: "editor",
        methods: ["password"],
        assurance: "basic",
        sessionMethod: "password",
        confirmedAt: "2026-10-09T10:00:00.000Z",
        passkeyConfirmedAt: null,
        expiresAt: "2026-11-08T10:00:00.000Z",
        passkeyCount: 0,
    },
    capabilities: ["use_editor_menu"],
};

test("🔴 Telefon: Avatar und ☰ statt Name, Menü ganz im Bild", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }),
    );
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const leiste = page.getByTestId("kopfleiste");
    await expect(leiste).toContainText("Avesmaps Editor");
    await expect(leiste.getByText("Rondrikan")).toBeHidden();
    await page.getByTestId("kopfleiste-menue").click();
    const menue = page.getByTestId("hauptmenue");
    await expect(menue).toContainText("Angemeldet mit Passwort");
    const lage = await menue.boundingBox();
    const breite = page.viewportSize()!.width;
    expect(lage!.x).toBeGreaterThanOrEqual(0);
    expect(lage!.x + lage!.width).toBeLessThanOrEqual(breite);
});

test("🔴 Telefon: das Anmeldefenster passt in die Breite", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ environment: "development", authEnabled: true, person: null, capabilities: [] }),
        }),
    );
    await page.goto("/anmelden");
    const fenster = page.getByRole("dialog", { name: "Anmelden" });
    await expect(fenster).toBeVisible();
    const lage = await fenster.boundingBox();
    expect(lage!.x).toBeGreaterThanOrEqual(0);
    expect(lage!.x + lage!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("🔴 Telefon hinter der Stage-Tür (R6): /anmelden steht mit lauter 401 und passt in die Breite", async ({
    page,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.route(
        (url) =>
            (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/")) ||
            url.pathname.startsWith("/tiles/") ||
            url.pathname.startsWith("/media/"),
        (route) => route.fulfill({ status: 401, contentType: "text/plain", body: "Anmeldung erforderlich\n" }),
    );
    await page.route("**/api/auth/session", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ environment: "staging", authEnabled: true, person: null, capabilities: [] }),
        }),
    );
    await page.goto("/anmelden");
    const fenster = page.getByRole("dialog", { name: "Anmelden" });
    await expect(fenster).toBeVisible();
    await expect(fenster.getByLabel("Benutzername:")).toBeEditable();
    const lage = await fenster.boundingBox();
    expect(lage!.x).toBeGreaterThanOrEqual(0);
    expect(lage!.x + lage!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(errors).toEqual([]);
});
