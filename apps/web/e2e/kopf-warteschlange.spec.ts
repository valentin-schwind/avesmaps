import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { JobsOverview } from "@avesmaps3d/shared";
import { expect, test, type Page } from "@playwright/test";
import { fullOverview, job, NOW, queued } from "./status-fixtures.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Warteschlange im Kopf (WI-0230; Betreiber 2026-10-19 zur Probierseite: „uneingeloggte besucher sehen keine leiste! … klick öffnet
 * warteschlagen -> perfekt … kopf-warteschlange -> bauen“). Ohne Server: Die eigene Übersicht kommt vom Test.
 *
 * - Problemfall: Ein Besucher sieht nie etwas, auch keinen leeren Platz, und fragt die Warteschlange gar nicht erst.
 * - Soll: Ein Editor mit einem eigenen gesammelten Auftrag sieht „Gebiete werden berechnet · wird gesammelt · noch 1:…“ in der Mitte der
 *   Kopfleiste, kein `territory_derive`; ohne eigenen Auftrag nichts.
 * - Erwartung: Ein Klick (Admin) öffnet die Warteschlange der Systemsteuerung.
 */
const later = (sekunden: number): string => new Date(NOW + sekunden * 1000).toISOString();
const SHOTS = fileURLToPath(new URL("../../../review/kopf-warteschlange/", import.meta.url));

/** Mit `KOPF_SHOTS=1` ein Bild der Kopfleiste für die Sichtprüfung. */
async function shot(page: Page, name: string): Promise<void> {
    if (process.env["KOPF_SHOTS"] !== "1") return;
    mkdirSync(SHOTS, { recursive: true });
    await page.waitForTimeout(300);
    await page.screenshot({
        path: `${SHOTS}${name}.png`,
        clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 120 },
    });
}

function eigene(teil: Partial<JobsOverview>): JobsOverview {
    return {
        ...fullOverview(),
        view: "own",
        running: [],
        queued: [],
        recent: [],
        failed: [],
        stalled: [],
        memory: null,
        ...teil,
    };
}

const gesammelt = eigene({
    queued: [
        queued(
            1,
            { id: "00000000-0000-4000-8000-0000000000a1", kind: "territory_derive", notBefore: later(76) },
            { durationP50S: 48, durationP95S: 51, basis: "history" },
        ),
    ],
});

async function uebersicht(page: Page, antwort: JobsOverview): Promise<string[]> {
    const abgefragt: string[] = [];
    await page.route(
        (url) => url.pathname === "/api/jobs/overview",
        async (route) => {
            abgefragt.push(new URL(route.request().url()).search);
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(antwort) });
        },
    );
    return abgefragt;
}

test("🔴 ein Editor sieht seinen gesammelten Auftrag im Klartext mit Restzeit; ohne eigenen Auftrag steht nichts", async ({
    page,
}) => {
    await stubAdmin(page, { role: "editor", capabilities: ["view_own_jobs"] });
    const abgefragt = await uebersicht(page, gesammelt);
    await page.goto("/edit");
    const leiste = page.getByTestId("kopfschlange");
    await expect(leiste).toBeVisible();
    await expect(leiste).toHaveAttribute("data-stand", "gesammelt");
    await expect(leiste).toContainText("Gebiete werden berechnet");
    await expect(leiste).toContainText(/wird gesammelt · noch 1:\d\d · Dauer etwa 48 s/u);
    await expect(leiste).not.toContainText("territory_derive");
    expect(abgefragt.every((suche) => suche === "?eigene=true")).toBe(true);
    // Sie steht in der Mitte der Kopfleiste, zwischen Umgebung und Glocke.
    const lage = await page.evaluate(() => {
        const kopf = document.querySelector('[data-testid="kopfleiste"]')!.getBoundingClientRect();
        const knopf = document.querySelector('[data-testid="kopfschlange"]')!.getBoundingClientRect();
        return {
            mitte: knopf.left + knopf.width / 2 - (kopf.left + kopf.width / 2),
            oben: knopf.top - kopf.top,
            hoehe: kopf.height,
        };
    });
    expect(Math.abs(lage.mitte)).toBeLessThan(lage.hoehe * 4);
    expect(lage.oben).toBeGreaterThanOrEqual(0);
    await shot(page, "rechner-gesammelt");
});

test("🔴 ohne eigenen Auftrag: keine Leiste und kein leerer Platz", async ({ page }) => {
    await stubAdmin(page, { role: "editor", capabilities: ["view_own_jobs"] });
    await uebersicht(
        page,
        eigene({
            recent: [job({ id: "00000000-0000-4000-8000-0000000000f1", kind: "territory_derive", state: "SUCCEEDED" })],
        }),
    );
    await page.goto("/edit");
    await expect(page.getByTestId("glocke")).toBeVisible();
    await expect(page.getByTestId("kopfschlange")).toHaveCount(0);
});

test("🔴 ein Besucher sieht nie eine Leiste und fragt die Warteschlange nicht", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ environment: "staging", authEnabled: true, person: null, capabilities: [] }),
        }),
    );
    const abgefragt = await uebersicht(page, gesammelt);
    await page.goto("/edit");
    await expect(page.getByTestId("kopfleiste-anmelden")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("kopfschlange")).toHaveCount(0);
    expect(abgefragt).toEqual([]);
});

test("ein Klick öffnet die Warteschlange der Systemsteuerung (Admin)", async ({ page }) => {
    await stubAdmin(page, { capabilities: ADMIN_CAPABILITIES });
    await uebersicht(page, gesammelt);
    await page.goto("/edit");
    await page.getByTestId("kopfschlange").click();
    await expect(page.getByTestId("verwaltung-statusseite")).toBeVisible();
});
