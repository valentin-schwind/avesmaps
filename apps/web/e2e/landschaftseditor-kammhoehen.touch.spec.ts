import { expect, test, type CDPSession, type Page } from "@playwright/test";
import type { LandscapeUpdateBody } from "@avesmaps3d/shared";
import { EDITOR_MODE } from "./map-handle.ts";
import { aufSeite, gebirgeKennung, insFreie, obenAn, oeffneGebirge, probegebirge } from "./gebirge-stub.ts";
import { blutzinnenStub, fensterAusDemWeg, KAMMHOEHEN_BILDER, zeigeKammhoehen } from "./kammhoehen-stub.ts";
import { flussTalStub } from "./fluss-tal-stub.ts";

/**
 * „↕ Höhe ziehen“ am Telefon (WI-0249 P9, zweiter Nachtrag des Betreibers 2026-10-24): Ein Finger senkrecht zieht die Höhe der gewählten
 * Punkte wie die Maus, zwei Finger bewegen weiterhin die Karte. Dazu das Bild der Leiste mit Höhen am Telefon. Alles aus Stubs.
 * 🪤 Das angedockte Fenster deckt am Telefon im Modus Karte und Leiste (`fensterAusDemWeg`, offen gemeldet); geprüft wird die Geste.
 */
type Punkt = { x: number; y: number };

/** Am Telefon steht das Editorpanel eingeklappt; mit Reiter in der Adresse trägt es seine Lasche (`editor-panel.touch.spec.ts`). */
const TELEFON_START = `${EDITOR_MODE}?tab=karteninhalte`;

async function finger(client: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", punkte: Punkt[]) {
    await client.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: punkte.map((p, id) => ({ x: p.x, y: p.y, id })),
    });
}

/** Legt die Finger auf, schiebt sie in Schritten um `dy` und hebt sie ab. */
async function wische(page: Page, client: CDPSession, start: Punkt[], dx: number, dy: number): Promise<void> {
    await finger(client, "touchStart", start);
    for (let i = 1; i <= 8; i++) {
        await finger(
            client,
            "touchMove",
            start.map((p) => ({ x: p.x + (dx * i) / 8, y: p.y + (dy * i) / 8 })),
        );
        await page.waitForTimeout(16);
    }
    await finger(client, "touchEnd", []);
}

test("🔴 Telefon: ein Finger senkrecht zieht die Höhe der gewählten Punkte, zwei Finger bewegen die Karte", async ({
    page,
}) => {
    const gesendet: LandscapeUpdateBody[] = await oeffneGebirge(
        page,
        probegebirge({
            kaemme: [
                {
                    punkte: [
                        [445, 510],
                        [450, 520],
                        [460, 530],
                    ],
                    rang: "haupt",
                    hoehen: [3000, 3000, 3000],
                },
            ],
            nebengipfel: [],
        }),
        TELEFON_START,
    );
    await page.getByRole("tab", { name: "Gebirge" }).click();
    await gebirgeKennung(page, "-kaemme-zeichnen").click();
    await expect(page.getByTestId("kamm-netz-leiste")).toBeVisible();
    await fensterAusDemWeg(page);
    await insFreie(page, { x: 453, y: 520 }, 6);
    await page.getByTestId("kamm-netz-werkzeug-waehlen").click();
    // Nahe der Mitte (32 px je E bei Zoom 6, das Telefon ist schmal): B und eine leere Stelle rechts davon, abseits beider Kammstücke.
    const b = await aufSeite(page, { x: 450, y: 520 });
    const frei = await aufSeite(page, { x: 456, y: 519 });
    for (const p of [b, frei])
        expect(await obenAn(page, p), `der Finger bei ${String(Math.round(p.x))}, ${String(Math.round(p.y))}`).toBe(
            "Karte",
        );
    await page.touchscreen.tap(b.x, b.y);
    await expect(page.getByTestId("kamm-netz-hoehe")).toHaveValue("3000");
    await page.getByTestId("kamm-netz-hoehe-ziehen").click();
    const client = await page.context().newCDPSession(page);
    const mitte = await page.evaluate(() => globalThis.avesmapsMap!.getCenter());
    // 20 Bildpunkte nach oben, ein Finger AUF dem Punkt: +200 Schritt; die Karte steht.
    await wische(page, client, [b], 0, -20);
    await expect(page.getByTestId("kamm-netz-hoehe")).toHaveValue("3200");
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getCenter())).toEqual(mitte);
    // Zwei Finger: die Karte bewegt sich, die Höhe nicht. Waagerecht, denn zwei Finger senkrecht sind bei MapLibre das Neigen (in 2D ohne
    // Wirkung), nicht das Verschieben.
    await wische(page, client, [frei, { x: frei.x, y: frei.y + 60 }], -80, 0);
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap!.getCenter().lng)).not.toBe(mitte.lng);
    await expect(page.getByTestId("kamm-netz-hoehe")).toHaveValue("3200");
    await page.getByTestId("kamm-netz-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]!.gebirge![0]!.changes.netz!.kaemme[0]!.hoehen).toEqual([
        [0, 3000],
        [1, 3200],
        [2, 3000],
    ]);
});

test("Bild: die Leiste mit Höhen am Telefon (Gebirge wie die Blutzinnen)", async ({ page }) => {
    await oeffneGebirge(page, blutzinnenStub(), TELEFON_START);
    await zeigeKammhoehen(page, `${KAMMHOEHEN_BILDER}/blutzinnen-telefon.png`, true);
});

test("🔴 Telefon: das Profil im Kammeditor hat Griffe; ein Finger senkrecht setzt die Höhe eines Flusspunkts im EINEN Entwurf (WI-0259)", async ({
    page,
}) => {
    const gesendet: LandscapeUpdateBody[] = await oeffneGebirge(page, flussTalStub(), TELEFON_START);
    await page.getByRole("tab", { name: "Gebirge" }).click();
    await gebirgeKennung(page, "-kaemme-zeichnen").click();
    await expect(page.getByTestId("kamm-netz-leiste")).toBeVisible();
    const profil = page.getByTestId("gebirge-profil-fluss");
    await profil.scrollIntoViewIfNeeded();
    await expect(profil).toBeVisible();
    // Doppelt so hoch wie sonst (10 rem), sieben Griffe, dazu der am See; die Trefferfläche ist fingergroß.
    expect((await profil.locator(".profil__plot").boundingBox())!.height).toBeCloseTo(160, 0);
    const griffe = page.getByTestId("gebirge-profil-griff");
    await expect(griffe).toHaveCount(7);
    const k3 = griffe.nth(3);
    const box = (await k3.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    await expect(k3).toHaveAttribute("data-hoehe", "1600");
    const mitte = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const client = await page.context().newCDPSession(page);
    await wische(page, client, [mitte], 0, -40);
    await expect(page.getByTestId("kamm-netz-leiste-ungespeichert")).toContainText("1");
    const gezogen = Number(await k3.getAttribute("data-hoehe"));
    expect(gezogen).toBeGreaterThan(1800);
    expect(gezogen % 10).toBe(0);
    await expect(k3).toHaveAttribute("data-steigt", "true");
    await expect(k3).toHaveAttribute("data-gewaehlt", "true");
    await profil.screenshot({ path: `${KAMMHOEHEN_BILDER}/fluss-profil-telefon.png` });
    await page.screenshot({ path: `${KAMMHOEHEN_BILDER}/fluss-telefon.png` });
    await page.getByTestId("kamm-netz-leiste-fertig").evaluate((el) => (el as HTMLButtonElement).click());
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]!.gebirge![0]!.changes.netz!.flussHoehen).toContainEqual({ x: 453, y: 509.5, h: gezogen });
});
