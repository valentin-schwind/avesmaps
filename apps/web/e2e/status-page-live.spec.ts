import { expect, test } from "@playwright/test";

/**
 * Der echte Weg der Statusseite (JOBS-0001 Teil B): Seite, Vite-Proxy, Fastify, PostgreSQL, `/ws` — ohne Ersatz.
 *
 * 🔴 Kein stilles Grün: Antwortet der laufende Server nicht mit der Statusseite (älterer Stand ohne die Routen, `STATUS_PAGE=off`,
 * keine Datenbank oder Migration 0070 fehlt), ist der Test ein SICHTBARER Skip mit dem Grund. Der Inhalt hängt an der Datenbank und
 * wird deshalb nur auf seine Form geprüft; die Zustände prüft `status-page.spec.ts` mit festen Daten.
 *
 * 🔴 Nicht im Standardlauf (WI-0248 S1): Beide Routen verlangen eine Anmeldung (`view_own_jobs`, `view_operations` mit zweitem Faktor).
 * Anonym antwortet nur ein Server mit `AUTH_ANONYMOUS_VIEW=editor` (nur lokal, nirgends mehr Vorgabe, `auth/config.ts`); unter dem Release-Lauf
 * (eigener Fastify ohne diese Einstellung) überspränge jeder Fall mit 401. `playwright.config.ts` fährt die Datei deshalb nur, wenn sie
 * GENANNT ist (`npx playwright test e2e/status-page-live.spec.ts`, mit `AUTH_ANONYMOUS_VIEW=editor` in der Umgebung des Fastify).
 */

test("🔴 echter Server: Stand über HTTP, /ws verbindet und abonniert, die Seite sagt „Live“", async ({
    page,
    request,
}) => {
    const overview = await request.get("/api/jobs/overview");
    test.skip(
        overview.status() !== 200,
        `die Statusseite ist auf dem laufenden Server nicht erreichbar (HTTP ${String(overview.status())}); Server neu starten, Migration 0070 anwenden`,
    );

    const frames: string[] = [];
    page.on("websocket", (socket) => {
        socket.on("framereceived", (frame) => frames.push(String(frame.payload)));
    });
    await page.goto("/status.html");
    await expect(page.getByTestId("queue-tab")).toBeVisible();
    await expect(page.getByTestId("status-live")).toHaveAttribute("data-connection", "live", { timeout: 15_000 });
    // Der Server begrüßt (`hello`) und bestätigt das Abonnement (`subscribed`).
    await expect
        .poll(() => frames.map((frame) => (JSON.parse(frame) as { op: string }).op))
        .toEqual(expect.arrayContaining(["hello", "subscribed"]));
    // Die vier Abschnitte und der Speicher stehen da, welche Jobs es auch gibt.
    await expect(page.getByTestId("memory")).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Läuft \(\d+\)$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Wartet \(\d+\)$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Fehlgeschlagen \(\d+\)$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Zuletzt fertig \(\d+\)$/i })).toBeVisible();
    // Der Release und das Profil der Warteschlange kommen vom Server.
    await expect(page.getByTestId("status-env")).toContainText(/Release \S+ · Warteschlangen-Profil \S+/);
});

test("echter Server: Betrieb liest Health und höchste Migration aus der Datenbank", async ({ page, request }) => {
    const operations = await request.get("/api/status/operations");
    test.skip(
        operations.status() !== 200,
        `Betrieb ist auf dem laufenden Server nicht erreichbar (HTTP ${String(operations.status())})`,
    );
    await page.goto("/status.html#operations");
    await expect(page.getByTestId("ops-health")).toContainText("ok · postgis");
    await expect(page.getByTestId("ops-migration")).toHaveText(/^\d{4}_\w+/);
});
