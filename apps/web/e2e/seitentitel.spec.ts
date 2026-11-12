import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Der Browsertitel folgt der Sitzung (Betreiber 2026-10-11: „kann man den seiten-titel sobald man eingeloggt ist von Avesmaps3D auf
 * Avesmaps3D | Editor ändern?“, dann „„Avesmaps3D · Editor“ Stage ist ja klar wegen der URL nö das passt“). Ohne Sitzung „Avesmaps3D“, mit
 * Sitzung „Avesmaps3D · Editor“, nach dem Abmelden wieder „Avesmaps3D“.
 *
 * Seit 2026-10-12 (`b4c6499a`, Wortlaut in `page.title*`, Regeln in `auth/seitentitel.ts`) heißt die Marke „Avesmaps“ und die Stage
 * trägt ihren Namen im Titel: „Avesmaps · Stage“, angemeldet „Avesmaps · Stage · Editor“. Der Nachbau hier meldet `staging`.
 * Nach einer An- oder Abmeldung lädt die Seite neu (`auth/session-state.ts`); der Server wird hier nachgebildet und merkt sich, ob
 * jemand angemeldet ist.
 */

const PERSON = {
    id: "0f8e5a52-6d0b-4f43-9c1e-2b7d9a3c4e51",
    displayName: "Rondrikan",
    role: "editor",
    methods: ["discord"],
    assurance: "strong",
    sessionMethod: "discord",
    confirmedAt: "2026-10-09T10:00:00.000Z",
    passkeyConfirmedAt: null,
    expiresAt: "2026-11-08T10:00:00.000Z",
    passkeyCount: 0,
};

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function geladen(page: Page): Promise<void> {
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
}

test("🔴 anmelden hängt „Editor“ an den Titel, abmelden nimmt den Zusatz wieder weg", async ({ page }) => {
    let angemeldet = false;
    await page.route("**/api/auth/session", (route) =>
        json(route, 200, {
            environment: "staging",
            authEnabled: true,
            person: angemeldet ? PERSON : null,
            capabilities: angemeldet ? ["use_editor_menu", "view_editor_series"] : [],
        }),
    );
    await page.route("**/api/auth/logout", (route) => {
        angemeldet = false;
        return route.fulfill({ status: 204 });
    });

    await page.goto("/edit");
    await geladen(page);
    await expect(page).toHaveTitle("Avesmaps · Stage");

    // Angemeldet: Der Server kennt jetzt eine Sitzung, die Seite lädt neu.
    angemeldet = true;
    await page.reload();
    await geladen(page);
    await expect(page).toHaveTitle("Avesmaps · Stage · Editor");

    await page.getByTestId("kopfleiste-menue").click();
    const neu = page.waitForEvent("load");
    await page.getByTestId("menue-abmelden").click();
    await neu;
    await geladen(page);
    await expect(page).toHaveTitle("Avesmaps · Stage");
});
