import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { mockBackend, repo } from "./status-fixtures.ts";

/**
 * Die Statusseite am Telefon (JOBS-0001 Teil B: „mobil lesbar“, Betreiber 2026-10-04: D5 C, die Seite ist für ihn und er liest sie am
 * Handy über Tailscale). Gemessen wird, was am Telefon schiefgeht: waagerechtes Scrollen, abgeschnittene Texte, zu kleine Ziele.
 * Mit `STATUS_SHOTS=1` entstehen Bilder unter `review/status-page/`.
 */

const SHOTS = fileURLToPath(new URL("../../../review/status-page/", import.meta.url));

async function shot(page: Page, name: string): Promise<void> {
    if (process.env["STATUS_SHOTS"] !== "1") return;
    mkdirSync(SHOTS, { recursive: true });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });
}

async function noSocket(page: Page): Promise<void> {
    await page.routeWebSocket(/\/ws$/, (ws) => {
        ws.send(JSON.stringify({ op: "hello", seq: 120, serverTime: new Date().toISOString(), releaseId: "x" }));
        ws.onMessage((message) => {
            if ((JSON.parse(String(message)) as { op: string }).op === "subscribe")
                ws.send(JSON.stringify({ op: "subscribed", channel: "jobs", seq: 120 }));
        });
    });
}

/** Ragt etwas über den Rand hinaus? Das wäre waagerechtes Scrollen am Telefon. */
async function overflow(page: Page): Promise<{ page: number; offenders: string[] }> {
    return page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const offenders: string[] = [];
        for (const element of document.querySelectorAll<HTMLElement>("body *")) {
            const box = element.getBoundingClientRect();
            if (box.width > 0 && box.right > width + 1) offenders.push(`${element.tagName}.${element.className}`);
        }
        return { page: document.documentElement.scrollWidth - width, offenders };
    });
}

test("🔴 Telefon: Warteschlange ohne waagerechtes Scrollen, jeder Zustand lesbar", async ({ page }) => {
    await mockBackend(page, { repo: repo(true) });
    await noSocket(page);
    await page.goto("/status.html");
    await expect(page.getByTestId("queue-tab")).toBeVisible();
    await expect(page.getByTestId("job-00000000-0000-4000-8000-0000000000a1").getByTestId("job-state")).toHaveText(
        "läuft",
    );
    await expect(page.getByTestId("job-00000000-0000-4000-8000-0000000000a2").getByTestId("job-state")).toHaveText(
        "hängt",
    );
    const measured = await overflow(page);
    expect(measured.page).toBeLessThanOrEqual(0);
    expect(measured.offenders).toEqual([]);
    await shot(page, "telefon-queue");
});

test("🔴 Telefon: Betrieb und Überblick ohne waagerechtes Scrollen, auch mit langen Zeilen (Fundstellen, Revisionen)", async ({
    page,
}) => {
    await mockBackend(page, { repo: repo(true) });
    await noSocket(page);
    await page.goto("/status.html");
    await page.getByTestId("status-reiter-operations").tap();
    await expect(page.getByTestId("operations-tab")).toBeVisible();
    expect((await overflow(page)).offenders).toEqual([]);
    await shot(page, "telefon-betrieb");
    await page.getByTestId("status-reiter-overview").tap();
    await expect(page.getByTestId("overview-tab")).toBeVisible();
    const measured = await overflow(page);
    expect(measured.offenders).toEqual([]);
    expect(measured.page).toBeLessThanOrEqual(0);
    await shot(page, "telefon-ueberblick");
});

test("Telefon: die Reiter lassen sich antippen und sind mindestens 32 px hoch (Guide §9)", async ({ page }) => {
    await mockBackend(page, { repo: repo(true) });
    await noSocket(page);
    await page.goto("/status.html");
    for (const key of ["operations", "overview", "queue"]) {
        const tab = page.getByTestId(`status-reiter-${key}`);
        const box = await tab.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
        await tab.tap();
        await expect(tab).toHaveAttribute("aria-selected", "true");
    }
});

test("Telefon: die Schrift ist nirgends kleiner als 11 px (Untergrenze des Guides)", async ({ page }) => {
    await mockBackend(page, { repo: repo(true) });
    await noSocket(page);
    await page.goto("/status.html");
    await expect(page.getByTestId("queue-tab")).toBeVisible();
    const smallest = await page.evaluate(() => {
        let min = Number.POSITIVE_INFINITY;
        for (const element of document.querySelectorAll<HTMLElement>("body *")) {
            if (
                !element.childNodes.length ||
                !Array.from(element.childNodes).some(
                    (node) => node.nodeType === 3 && (node.textContent ?? "").trim().length > 0,
                )
            )
                continue;
            min = Math.min(min, Number.parseFloat(getComputedStyle(element).fontSize));
        }
        return min;
    });
    expect(smallest).toBeGreaterThanOrEqual(11);
});
