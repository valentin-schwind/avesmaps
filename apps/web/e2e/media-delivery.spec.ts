import { expect, test, type Page } from "@playwright/test";
import type { MediaPublicView } from "@avesmaps3d/shared";
import { openMap } from "./map-handle.ts";

/**
 * Die Medien am echten Stack (WI-0063 MEDIA-M12): Ein Wappen aus `published/` kommt wirklich über `/media/` und wird
 * wirklich gezeichnet - und ein Asset ohne Datei zeigt GAR NICHTS, keinen leeren Rahmen und keine Beschriftung.
 *
 * 💣 Der laufende Server braucht `MEDIA_ROOT` (lokal `C:\avesmaps3d-data\media`) und den Medienimport in der Datenbank.
 * Fehlt eines, scheitert der Test mit der Anleitung, statt still grün zu sein (Kap. 11.155).
 *
 * 🪤 Gemessen wird, was der Browser GELADEN hat (`naturalWidth`), nicht was im `src` steht: Genau das war der Befund -
 * die Adresse stand im Panel, die Datei lag auf der Platte, und dazwischen antwortete niemand.
 */

/** Punin: ein Herrschaftsgebiet mit Wappen (Legacy-Medienimport, 401 Gebietswappen). */
const PUNIN = "5d2bdbb0-436d-408d-aaa5-5c06db647222";
/** Fasar: ein Ort mit Wappen und einer Galerie von zehn eigenen Bildern. */
const FASAR_PLACE = "aed5f402-47d0-5a89-a7e2-c3f8a31e56c2";

interface SubjectDetail {
    media?: { coat?: MediaPublicView; header?: MediaPublicView[] };
}

/**
 * Liefert der laufende Server überhaupt Medien aus? Ohne `MEDIA_ROOT` antwortet er auf jede Adresse 503. Das ist eine
 * fehlende Voraussetzung, kein Befund: sichtbarer Skip mit der Zeile, die fehlt (Kap. 11.155) - so wird die Suite einer
 * parallelen Sitzung nicht rot, nur weil ihr Server die Variable nicht hat.
 */
test.beforeEach(async ({ page }) => {
    const probe = await page.request.get(`/media/sha256/00/00/${"0".repeat(64)}.webp`);
    test.skip(
        probe.status() === 503,
        "Der laufende Server hat kein MEDIA_ROOT (503). In die .env: MEDIA_ROOT=C:\\avesmaps3d-data\\media",
    );
    expect(probe.status(), "eine unbekannte Mediendatei ist 404").toBe(404);
});

/** Die Antwort des Servers zu einem Subject; ohne Medien im Bestand hat der Test keine Grundlage. */
async function mediaOf(page: Page, kind: string, id: string): Promise<{ coat?: MediaPublicView }> {
    const response = await page.request.get(`/api/subjects/${kind}/${id}`);
    if (response.status() !== 200) {
        throw new Error(
            `${kind} ${id} antwortet ${String(response.status())}: erst den Legacy-Zug und den Medienimport laufen ` +
                "lassen (npm run legacy:update, migrate:media-files).",
        );
    }
    const detail = (await response.json()) as SubjectDetail;
    return { ...(detail.media?.coat ? { coat: detail.media.coat } : {}) };
}

/** Öffnet ein Subject über die Öffnungsnaht und wartet, bis das Panel seinen Namen trägt. */
async function open(page: Page, ref: Record<string, unknown>, title: string): Promise<void> {
    await openMap(page);
    await page.evaluate((subject) => globalThis.avesmapsOpenSubject?.(subject), ref);
    await expect(page.getByTestId("info-title")).toHaveText(title, { timeout: 20_000 });
}

const loaded = (page: Page, testId: string): Promise<number> =>
    page.getByTestId(testId).evaluate((element) => (element as HTMLImageElement).naturalWidth);

test("🔴 das Wappen eines Gebiets kommt mit 200 aus published/ und steht im Panel", async ({ page }) => {
    await openMap(page);
    const { coat } = await mediaOf(page, "territory", PUNIN);
    if (coat === undefined) {
        throw new Error(`Punin (${PUNIN}) trägt kein veröffentlichtes Wappen: Medienimport fehlt.`);
    }
    expect(coat.url).toMatch(/^\/media\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/);

    // Erst die Auslieferung selbst: Medientyp, Haltbarkeit und der Hash als ETag.
    const file = await page.request.get(coat.url);
    expect(file.status(), `${coat.url} muss 200 geben; ohne MEDIA_ROOT antwortet der Server 503`).toBe(200);
    expect(file.headers()["content-type"]).toBe("image/webp");
    expect(file.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(file.headers()["etag"]).toBe(`"${coat.url.slice(-69, -5)}"`);
    // Dieselbe Adresse mit dem ETag: 304, der Browser behält seine Bytes.
    const again = await page.request.get(coat.url, { headers: { "if-none-match": file.headers()["etag"] ?? "" } });
    expect(again.status()).toBe(304);

    // Dann das Panel: das Wappen ist da, es ist GELADEN, und es trägt keinen Alternativtext.
    await open(page, { kind: "territory", id: PUNIN }, "Punin");
    await expect(page.getByTestId("info-coat")).toBeVisible();
    await expect(page.getByTestId("info-coat")).toHaveAttribute("src", coat.url);
    await expect(page.getByTestId("info-coat")).toHaveAttribute("alt", "");
    await expect.poll(() => loaded(page, "info-coat")).toBeGreaterThan(0);
});

test("🔴 ein Ort mit eigenen Bildern zeigt sie im Kopf statt der Grafik der Ortsgröße", async ({ page }) => {
    await open(page, { kind: "place", id: FASAR_PLACE }, "Fasar");
    const image = page.getByTestId("info-header-image");
    await expect(image).toHaveAttribute("src", /^\/media\/sha256\//);
    await expect(image).not.toHaveAttribute("data-graphic", /.+/);
    await expect.poll(() => loaded(page, "info-header-image")).toBeGreaterThan(0);
    await expect.poll(() => loaded(page, "info-coat")).toBeGreaterThan(0);
});

test("🔴 ein Wappen ohne Datei zeigt GAR NICHTS: kein leerer Rahmen, keine Beschriftung", async ({ page }) => {
    // Ein Asset, dessen Bytes fehlen (`technical_state`): die Adresse hat die richtige Form und antwortet 404.
    const missing = `/media/sha256/cc/cc/${"c".repeat(64)}.webp`;
    await page.route(`**/api/subjects/territory/${PUNIN}`, async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as Record<string, unknown>;
        const media = (body["media"] ?? {}) as Record<string, unknown>;
        const coat = { ...((media["coat"] ?? {}) as Record<string, unknown>), url: missing };
        await route.fulfill({ response, json: { ...body, media: { ...media, coat } } });
    });

    await open(page, { kind: "territory", id: PUNIN }, "Punin");
    expect((await page.request.get(missing)).status()).toBe(404);
    // Kein Bild, kein Platz dafür, und nirgends das Wort „Wappen“ als Ersatz.
    await expect(page.getByTestId("info-coat")).toHaveCount(0);
    await expect(page.getByTestId("info-header")).not.toContainText("Wappen");
    // Der Titel sitzt trotzdem, das Panel bleibt heil.
    await expect(page.getByTestId("info-title")).toHaveText("Punin");
});
