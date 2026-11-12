import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { JobsOverview } from "@avesmaps3d/shared";
import { expect, test, type Page } from "@playwright/test";
import { fullOverview, job, NOW, queued } from "./status-fixtures.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Warteschlange im Kopf am Telefon (WI-0230; Betreiber zur Probierseite: „rechner lösung und telefonlösung super!“): nur die Uhr
 * (gesammelt, wartet) oder der Ring (läuft) mit der Restzeit, neben der Glocke; der Wortlaut steht im Titel. Mit `KOPF_SHOTS=1` legt der
 * Test die Bilder für die Sichtprüfung unter `review/kopf-warteschlange/` ab.
 */
const SHOTS = fileURLToPath(new URL("../../../review/kopf-warteschlange/", import.meta.url));
const later = (sekunden: number): string => new Date(NOW + sekunden * 1000).toISOString();
const ago = (sekunden: number): string => new Date(NOW - sekunden * 1000).toISOString();

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

async function oeffnen(page: Page, antwort: JobsOverview): Promise<void> {
    await stubAdmin(page, { role: "editor", capabilities: ["view_own_jobs"] });
    await page.route(
        (url) => url.pathname === "/api/jobs/overview",
        (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(antwort) }),
    );
    await page.goto("/edit");
}

test("🔴 am Telefon: die Uhr mit Restzeit neben der Glocke, ohne Wortlaut in der Leiste", async ({ page }) => {
    await oeffnen(
        page,
        eigene({
            queued: [
                queued(
                    1,
                    { id: "00000000-0000-4000-8000-0000000000a1", kind: "territory_derive", notBefore: later(76) },
                    { durationP50S: 48, durationP95S: 51, basis: "history" },
                ),
                queued(
                    2,
                    { id: "00000000-0000-4000-8000-0000000000a2", kind: "path_label_runs", notBefore: later(9) },
                    { durationP50S: 1, durationP95S: 1, basis: "history" },
                ),
            ],
        }),
    );
    const uhr = page.getByTestId("kopfschlange");
    await expect(uhr).toBeVisible();
    await expect(uhr).toHaveAttribute("aria-label", /Wegnamen werden gesetzt|Gebiete werden berechnet/u);
    await expect(uhr.locator(".kopfschlange__zahl")).toHaveText(/^\d:\d\d$/u);
    await expect(uhr.locator(".kopfschlange__art")).toBeHidden();
    await expect(uhr.locator(".kopfschlange__mehr")).toHaveText("+1");
    // Neben der Glocke: rechts in der Leiste, links von ihr.
    const lage = await page.evaluate(() => {
        const knopf = document.querySelector('[data-testid="kopfschlange"]')!.getBoundingClientRect();
        const glocke = document.querySelector('[data-testid="glocke"]')!.getBoundingClientRect();
        return { abstand: glocke.left - knopf.right };
    });
    expect(lage.abstand).toBeGreaterThanOrEqual(0);
    expect(lage.abstand).toBeLessThan(24);
    // Problemfall von der ersten Sichtprüfung: Neben „STAGE · Testwelt“ drückte die Leiste die Uhr zusammen, von „1:16“ blieb „1“, „+1“
    // fehlte ganz. Restzeit und Zähler stehen ganz im Knopf; Platz macht der Titel.
    const innen = await page.evaluate(() => {
        const knopf = document.querySelector('[data-testid="kopfschlange"]')!;
        const rand = knopf.getBoundingClientRect().right;
        const ende = (sel: string) => knopf.querySelector(sel)!.getBoundingClientRect().right;
        const leiste = document.querySelector('[data-testid="kopfleiste"]')!;
        return {
            zahl: rand - ende(".kopfschlange__zahl"),
            mehr: rand - ende(".kopfschlange__mehr"),
            ueberlauf: leiste.scrollWidth - leiste.clientWidth,
            // Der gekürzte Titel behält seine Unterlängen („Avesmaps“): Er kürzt über `.einzeilig`, die den Platz nach unten mitbringt.
            titelEinzeilig: document.querySelector(".leiste__titel")!.classList.contains("einzeilig"),
        };
    });
    expect(innen.zahl).toBeGreaterThanOrEqual(0);
    expect(innen.mehr).toBeGreaterThanOrEqual(0);
    expect(innen.ueberlauf).toBeLessThanOrEqual(0);
    expect(innen.titelEinzeilig).toBe(true);
    await shot(page, "telefon-gesammelt");
});

test("am Telefon läuft der Ring und zeigt die Restzeit", async ({ page }) => {
    await oeffnen(
        page,
        eigene({
            running: [
                job({
                    id: "00000000-0000-4000-8000-0000000000b1",
                    kind: "terrain_local",
                    state: "RUNNING",
                    startedAt: ago(20),
                    progress: 0.4,
                }),
            ],
        }),
    );
    const ring = page.getByTestId("kopfschlange");
    await expect(ring).toHaveAttribute("data-stand", "laeuft");
    await expect(ring.locator("circle.wert")).toHaveCount(1);
    await shot(page, "telefon-laeuft");
});
