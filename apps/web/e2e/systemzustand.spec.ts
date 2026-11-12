import { expect, test, type Page } from "@playwright/test";
import type { AdminSystemzustand } from "@avesmaps3d/shared";
import { ohneDatei, systemzustandAntwort, systemzustandStand } from "./systemzustand-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Eintrag „Systemzustand“ der Systemsteuerung (WI-0127 SYS-8, SYS-0001 §6.3; Blatt WI-0119 A7) am Rechner, gegen den Nachbau
 * (`systemzustand-stub.ts`); die echte Route prüft `apps/server/test/systemzustand-routes.test.ts`, das Blatt erzeugt
 * `systemzustand-review.spec.ts`.
 *
 * - Ein Admin sieht die Komponenten mit Aufgabe, Zustand, Seit und Version, die Auslastung mit zwei Verläufen, Datenbank und Platte.
 * - 🔴 Ohne Claudios Statusdatei stehen Nginx und Tür, Verbindungen und Größen als „unbekannt“ da, nie als 0; die Schiene nennt die Zahl.
 * - Eine Platte unter 15 % frei steht als Warnung da (nur Anzeige).
 */

async function oeffnen(page: Page, stand: () => AdminSystemzustand) {
    const calls = await stubAdmin(page, { capabilities: ADMIN_CAPABILITIES, answer: systemzustandAntwort(stand) });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-systemzustand").click();
    await expect(page.getByTestId("systemzustand-komponenten")).toBeVisible();
    return calls;
}

test("ein Admin sieht Komponenten, Auslastung mit Verlauf, Datenbank und Platte wie im Blatt", async ({ page }) => {
    await oeffnen(page, () => systemzustandStand());
    await expect(page.getByTestId("systemzustand-fastify")).toContainText("läuft");
    await expect(page.getByTestId("systemzustand-fastify")).toContainText("Release 028ec13 · Node 24.14.1");
    await expect(page.getByTestId("systemzustand-postgresql")).toContainText("18.6 · PostGIS 3.6.0");
    // Jede Komponente sagt in Alltagssprache, was sie tut (Betreiber 2026-10-11: „nicht alle betreiber kennen jedes framework“).
    await expect(page.getByTestId("systemzustand-komponenten").locator("thead th")).toHaveText([
        "Komponente",
        "Aufgabe",
        "Zustand",
        "Seit",
        "Version oder Release",
    ]);
    await expect(page.getByTestId("systemzustand-martin").getByTestId("systemzustand-aufgabe")).toHaveText(
        "Liefert die Kartenkacheln aus der Datenbank: Wege, Namen, Höhenlinien und Gewässer.",
    );
    await expect(page.getByTestId("systemzustand-aufgabe")).toHaveCount(7);
    await expect(page.getByTestId("systemzustand-nginx")).toContainText("erreichbar");
    await expect(page.getByTestId("systemzustand-sicherung")).toContainText("noch nicht eingerichtet");
    await expect(page.getByTestId("systemzustand-last")).toHaveText("0,18 · 0,24 · 0,21");
    await expect(page.getByTestId("systemzustand-speicher")).toHaveText("3,4 GB von 7,7 GB belegt");
    // Eine Zeile je Prozess; der Routing-Worker ist ein Thread in Fastify (WI-0127 §22).
    await expect(page.getByTestId("systemzustand-prozess")).toHaveText([
        "Fastify 410 MB",
        "Routing-Worker im Fastify-Prozess: Heap 70 MB, Graph 180 MB",
        "Jobs-Worker 88 MB, dazu 1 laufender Job mit 1,2 GB",
    ]);
    await expect(page.getByTestId("systemzustand-verlauf-last")).toHaveAttribute(
        "aria-label",
        /^Last über 24 Stunden, zuletzt /u,
    );
    await expect(page.getByTestId("systemzustand-verlauf-last").locator("path")).toHaveCount(2);
    await expect(page.getByTestId("systemzustand-verbindungen")).toHaveText("14 von 100 belegt");
    await expect(page.getByTestId("systemzustand-tabellen").locator("tbody tr")).toHaveCount(5);
    await expect(page.getByTestId("systemzustand-platte")).toContainText("14,6 GB");
    await expect(page.getByTestId("verwaltung-eintrag-systemzustand")).toHaveText("Systemzustand1 unbekannt");
});

test("🔴 ohne Statusdatei: unbekannt statt 0 bei Nginx und Tür, Last, Verbindungen und Größen; die Schiene zählt", async ({
    page,
}) => {
    await oeffnen(page, ohneDatei);
    await expect(page.getByTestId("systemzustand-nginx")).toContainText("unbekannt");
    await expect(page.getByTestId("systemzustand-nginx")).toContainText("Messwert fehlt");
    await expect(page.getByTestId("systemzustand-last")).toHaveText("unbekannt");
    await expect(page.getByTestId("systemzustand-verbindungen")).toHaveText("unbekannt");
    // Ohne Datei sind die Größen unbekannt, nie „0“.
    await expect(page.getByTestId("systemzustand-platte")).toContainText("unbekannt");
    await expect(page.getByTestId("systemzustand-platte")).not.toContainText(/(^|\s)0(\s|$)/u);
    await expect(page.getByTestId("verwaltung-eintrag-systemzustand")).toHaveText("Systemzustand3 unbekannt");
});

test("eine Platte unter 15 % frei steht als Warnung da; eine ausgefallene Komponente führt die Schiene an", async ({
    page,
}) => {
    const stand = systemzustandStand();
    await oeffnen(page, () => ({
        ...stand,
        komponenten: stand.komponenten.map((entry) =>
            entry.id === "jobs" ? { ...entry, zustand: "ausgefallen" as const, hinweis: "no_planner" } : entry,
        ),
        auslastung: {
            ...stand.auslastung,
            platten: [{ id: "/", quelle: "datei" as const, gesamt: 232 * 1024 ** 3, frei: 21 * 1024 ** 3 }],
        },
    }));
    await expect(page.getByTestId("systemzustand-jobs")).toContainText("ausgefallen");
    await expect(page.getByTestId("systemzustand-jobs")).toContainText("kein Planer aktiv");
    await expect(
        page.getByTestId("systemzustand-platten").locator(".avm-status, [class*='status']").first(),
    ).toContainText("21 GB frei von 232 GB (9 %)");
    await expect(page.getByTestId("verwaltung-eintrag-systemzustand")).toHaveText("Systemzustand1 ausgefallen");
});
