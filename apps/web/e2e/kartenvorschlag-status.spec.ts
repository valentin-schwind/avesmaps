import { expect, test, type Page } from "@playwright/test";

/**
 * Die Statusseite eines Kartenvorschlags über ihren persönlichen Link `/kartenvorschlag#…` (WI-0275 Stufe C): Der Link öffnet das Fenster von „Karte vorschlagen“ auf der Statusseite, der Schlüssel geht im Rumpf an den Server (nie
 * in einer Adresse) und aus der Adresse der Seite, und ein verstümmelter Link fragt den Server gar nicht erst. Der Server ist eine Attrappe (`page.route`); die Karte darunter braucht keine Daten.
 *
 * Das Formular und die Einreichung in zwei Schritten (Angaben, dann die Bytes) prüft `catalog-windows.spec.ts` bis zum Öffnen; die Rechenregeln stehen in `test/kartenvorschlag.test.ts`.
 */

const SCHLUESSEL = "B".repeat(43);

async function attrappe(page: Page, zustand: "pending" | "rejected"): Promise<string[]> {
    const aufrufe: string[] = [];
    await page.route("**/api/kartenvorschlaege/**", async (route) => {
        const anfrage = route.request();
        aufrufe.push(`${anfrage.method()} ${new URL(anfrage.url()).pathname} ${anfrage.postData() ?? ""}`);
        const antwort = anfrage.url().endsWith("/status")
            ? {
                  nummer: "K-7",
                  zustand,
                  weg: "datei",
                  titel: "Herz des Reiches",
                  link: null,
                  dateiTyp: "application/pdf",
                  eingegangenAm: new Date().toISOString(),
                  entschiedenAm: zustand === "rejected" ? new Date().toISOString() : null,
                  grund: zustand === "rejected" ? "Die Karte ist zu klein." : null,
                  zurueckziehbar: zustand === "pending",
              }
            : { einreichen: true };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(antwort) });
    });
    return aufrufe;
}

test("🔴 der persönliche Link öffnet die Statusseite: Schlüssel im Rumpf, nicht in der Adresse, Zurückziehen nur vor der Entscheidung", async ({
    page,
}) => {
    const aufrufe = await attrappe(page, "pending");
    await page.goto(`/kartenvorschlag#${SCHLUESSEL}`);
    const fenster = page.getByTestId("kartenvorschlag-fenster");
    await expect(fenster).toBeVisible({ timeout: 45_000 });
    await expect(fenster).toContainText("Mein Kartenvorschlag");
    await expect(page.getByTestId("kartenvorschlag-status-zustand")).toHaveText("In Prüfung");
    await expect(page.getByTestId("kartenvorschlag-status-fakten")).toContainText("K-7");
    await expect(page.getByTestId("kartenvorschlag-status-fakten")).toContainText("PDF-Datei");
    await expect(page.getByTestId("kartenvorschlag-status-zurueckziehen")).toBeVisible();
    // Der Schlüssel steht im Rumpf der Frage und nirgends in der Adresse der Seite oder der Anfrage.
    expect(
        aufrufe.some(
            (aufruf) => aufruf.startsWith("POST /api/kartenvorschlaege/status ") && aufruf.includes(SCHLUESSEL),
        ),
    ).toBe(true);
    expect(aufrufe.every((aufruf) => !aufruf.split(" ")[1]?.includes(SCHLUESSEL))).toBe(true);
    expect(page.url()).not.toContain(SCHLUESSEL);
    expect(page.url()).not.toContain("kartenvorschlag");
});

test("eine abgelehnte Einreichung zeigt den Grund der Redaktion und kein Zurückziehen mehr", async ({ page }) => {
    await attrappe(page, "rejected");
    await page.goto(`/kartenvorschlag#${SCHLUESSEL}`);
    await expect(page.getByTestId("kartenvorschlag-status-grund")).toContainText("Die Karte ist zu klein.", {
        timeout: 45_000,
    });
    await expect(page.getByTestId("kartenvorschlag-status-zustand")).toHaveText("Abgelehnt");
    await expect(page.getByTestId("kartenvorschlag-status-zurueckziehen")).toHaveCount(0);
});

test("ein verstümmelter Link sagt „gibt es nicht“, ohne den Server zu fragen", async ({ page }) => {
    const aufrufe = await attrappe(page, "pending");
    await page.goto("/kartenvorschlag#kaputt");
    await expect(page.getByTestId("kartenvorschlag-status-fehlt")).toContainText(
        "Zu diesem Link gibt es keinen Kartenvorschlag (mehr).",
        { timeout: 45_000 },
    );
    expect(aufrufe.filter((aufruf) => aufruf.includes("/status"))).toEqual([]);
});
