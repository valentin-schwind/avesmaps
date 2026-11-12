import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Die Urheberzeile unter den Streifen des Infopanels (WI-0063 §27.16, Betreiber 2026-10-06: „ja, bau die zeile ein! im zweifel wie
 * legacy“). Sie ist die Pflichtangabe aus den Ulisses-Fanrichtlinien (`NOTICE.md`), die Legacy unter Literaturstreifen und
 * Kartensammlung druckt - und die Avesmaps3D seit MEDIA-M14 an 1.534 Verlagscovern fehlte.
 *
 * 🔴 **Keine Bilder, keine Zeile** - Legacys eigene Bedingung (`cityMapsHaveVisibleCover`, dessen Test wörtlich: „a section showing
 * covers must show the credit“ / „no covers, no credit“). Die drei benannten Fälle stehen hier am echten Panel, die Regel ohne
 * Browser in `test/catalog-model.test.ts`.
 *
 * 🪤 Die beiden Negativfälle kommen aus einer gestellten Antwort, nicht aus dem Bestand: Ein Ort, dessen Werke ALLE keinen
 * freigegebenen Umschlag tragen, ist am geteilten Entwicklungsstand nicht verlässlich zu finden, und ob die Kartensammlung Bilder
 * zeigt, hängt an einer widerrufbaren Freigaberegel (widerrufen 2026-10-06, zurückgenommen 2026-10-08). Gestellt wird nur die Liste des Abschnitts; Panel, Modell und Bauteil sind
 * die echten.
 */

const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };
const IMAGE = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons", "header", "dorf.webp");

/*
 * 🔴 NUR DER SATZ, KEIN LINK (Betreiber 2026-10-09: ohne „— im F-Shop ansehen“). Bis dahin trug die Zeile einen Anker in den F-Shop; der
 * Weg in den Laden steht jetzt an den Fundstellen des einzelnen Eintrags im Katalogfenster (`catalog-windows.spec.ts`).
 */
const CREDIT_DE = "Bilder © Ulisses Spiele bzw. der jeweiligen Rechteinhaber";
const CREDIT_EN = "Images © Ulisses Spiele or their respective rights holders";

const SHA = "44f434f75137007884e4a6b8bdfe797c58e1c6e405d02b5e5a184a8172f5f2c7";

/** Jeder gestellte Eintrag trägt seine Kennung (WI-0118): Sie ist der Schlüssel der Kachel und das, was das Fenster aufschlägt. */
const id = (n: number): string => `80000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** Ein freigegebenes Bild, so wie der Media Core es liefert. */
const media = (role: "literature_cover" | "map_preview") => ({
    id: "11111111-2222-4333-8444-555555555555",
    role,
    url: `/media/sha256/44/f4/${SHA}.webp`,
    width: 424,
    height: 600,
    mimeType: "image/webp",
});

/** Jede Medienadresse beantwortet ein echtes Bild - sonst nimmt das Bauteil es aus seiner Karte (`@error`). */
async function serveImages(page: Page): Promise<void> {
    await page.route("**/media/sha256/**", (route) =>
        route.fulfill({ status: 200, contentType: "image/webp", path: IMAGE }),
    );
}

/** Stellt die Liste EINES Abschnitts; der Rest des Panels bleibt der echte. */
async function serveSection(page: Page, section: "literature" | "citymaps", body: unknown): Promise<void> {
    await page.route(`**/api/subjects/place/*/${section}*`, async (route) => {
        const response = await route.fetch();
        const answer = (await response.json()) as Record<string, unknown>;
        const key = section === "literature" ? "works" : "maps";
        await route.fulfill({ response, json: { ...answer, [key]: body } });
    });
}

async function openGareth(page: Page, section: "literature" | "citymaps"): Promise<void> {
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    await page.locator(`[data-section="${section}"]`).waitFor({ timeout: 30_000 });
    await page
        .getByTestId(section === "literature" ? "info-literature-strip" : "info-citymaps-strip")
        .waitFor({ timeout: 30_000 });
}

const credit = (page: Page, section: "literature" | "citymaps") =>
    page.locator(`[data-section="${section}"]`).getByTestId("info-catalog-credit");

test.describe("🔴 die Urheberzeile unter den Buchumschlägen", () => {
    test("Fall 1: ein Ort MIT Umschlägen zeigt die Zeile, nur der Satz, ohne Link", async ({ page }) => {
        await serveImages(page);
        await openGareth(page, "literature");
        // Am Bestand trägt Gareth Umschläge (69 von 110 Werken, MEDIA-M14); die Zeile hängt an genau diesen Bildern.
        await expect(page.getByTestId("info-literature-image").first()).toBeVisible({ timeout: 30_000 });
        const line = credit(page, "literature");
        await expect(line).toBeVisible();
        expect((await line.innerText()).replace(/\s+/g, " ").trim()).toBe(CREDIT_DE);
        // 🔴 Kein Link: nur der Satz.
        await expect(line.locator("a")).toHaveCount(0);
        // Sie steht UNTER dem Streifen, nicht darüber oder daneben.
        const strip = await page.getByTestId("info-literature-strip").boundingBox();
        const box = await line.boundingBox();
        expect((box?.y ?? 0) > (strip?.y ?? 0) + (strip?.height ?? 0) - 1).toBe(true);
        // 🔴 Leise und wie die übrigen Hinweiszeilen des Streifens: dieselbe Sprosse (11 px, die unterste des Kanons) und dieselbe
        // gedämpfte Farbe wie die Zeilen unter einem Titel - keine neue Farbe, keine neue Sprosse.
        const look = await line.evaluate((element) => {
            const own = getComputedStyle(element);
            const hint = document.querySelector(".info-lit__type");
            const other = hint === null ? null : getComputedStyle(hint);
            return {
                size: own.fontSize,
                colour: own.color,
                hintSize: other?.fontSize ?? "",
                hintColour: other?.color ?? "",
            };
        });
        expect(look.size).toBe("11px");
        expect([look.size, look.colour]).toEqual([look.hintSize, look.hintColour]);
    });

    test("🔴 Fall 2: ein Ort OHNE Umschläge zeigt sie NICHT - eine Urheberzeile ohne Bilder wäre eine Aussage über nichts", async ({
        page,
    }) => {
        await serveImages(page);
        await serveSection(page, "literature", [
            { id: id(1), title: "Werk ohne Umschlag", productType: "gruppenabenteuer", role: "start" },
            { id: id(2), title: "Zweites Werk ohne Umschlag", productType: "spielhilfe", role: "start" },
        ]);
        await openGareth(page, "literature");
        await expect(page.getByTestId("info-literature-card")).toHaveCount(2);
        await expect(page.getByTestId("info-literature-image")).toHaveCount(0);
        await expect(credit(page, "literature")).toHaveCount(0);
    });

    test("🔴 Fall 3: die Kartensammlung ohne Vorschauen zeigt sie nicht - und mit einer Vorschau von selbst doch", async ({
        page,
    }) => {
        await serveImages(page);
        await serveSection(page, "citymaps", [
            { id: id(3), title: "Karte ohne Vorschau" },
            { id: id(4), title: "Zweite ohne Vorschau" },
        ]);
        await openGareth(page, "citymaps");
        await expect(page.getByTestId("info-citymaps-card")).toHaveCount(2);
        await expect(page.getByTestId("info-citymaps-image")).toHaveCount(0);
        await expect(credit(page, "citymaps")).toHaveCount(0);

        // 🪤 Die andere Richtung im selben Fall: stehen dort je wieder Bilder, erscheint die Zeile von selbst - ohne Codeänderung.
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await serveImages(page);
        await serveSection(page, "citymaps", [
            { id: id(5), title: "Karte ohne Vorschau" },
            { id: id(6), title: "Karte mit Vorschau", preview: media("map_preview") },
        ]);
        // `openGareth` lädt die Seite neu; damit ist auch der kurze Cache des Abschnitts wieder leer.
        await openGareth(page, "citymaps");
        await expect(page.getByTestId("info-citymaps-image")).toHaveCount(1);
        const line = credit(page, "citymaps");
        await expect(line).toBeVisible();
        expect((await line.innerText()).replace(/\s+/g, " ").trim()).toBe(CREDIT_DE);
    });

    test("Englisch: Legacys englische Fassung, ohne Link", async ({ page }) => {
        await serveImages(page);
        await page.goto("/?lang=en");
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH);
        await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
        await page.getByTestId("info-literature-strip").waitFor({ timeout: 30_000 });
        const line = credit(page, "literature");
        await expect(line).toBeVisible();
        expect((await line.innerText()).replace(/\s+/g, " ").trim()).toBe(CREDIT_EN);
        await expect(line.locator("a")).toHaveCount(0);
    });
});

test.describe("am Telefon", () => {
    test.use({ viewport: { width: 360, height: 760 } });

    test("360 px: die Zeile bricht im Panel um und schiebt es nicht breiter", async ({ page }) => {
        await serveImages(page);
        await openGareth(page, "literature");
        const line = credit(page, "literature");
        await expect(line).toBeVisible();
        expect((await line.innerText()).replace(/\s+/g, " ").trim()).toBe(CREDIT_DE);
        // 🔴 Sie bricht, statt zu überlaufen: der Textkasten bleibt in seiner Spalte, und nichts rollt waagerecht.
        const fit = await line.evaluate((element) => {
            const parent = element.parentElement as HTMLElement;
            return {
                overflowing: element.scrollWidth > element.clientWidth + 1,
                wider: Math.round(element.getBoundingClientRect().width) > Math.round(parent.clientWidth),
                lines: Math.round(
                    element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).fontSize),
                ),
            };
        });
        expect(fit.overflowing).toBe(false);
        expect(fit.wider).toBe(false);
        // Zwei bis vier Zeilen bei 11 px in einem 360-px-Panel; eine einzige wäre ein Zeichen für einen Überlauf.
        expect(fit.lines).toBeGreaterThan(1);
    });
});

test.describe("🔴 ohne ein einziges Bild keine leere Fläche über den Titeln", () => {
    // Betreiber 2026-10-08 („fix alles“ auf die Vorlage): Die Fläche hält in einem GEMISCHTEN Streifen die Titel auf einer Höhe
    // (WI-0063 §27.15). Trägt kein Eintrag ein Bild, hält sie nichts und sah wie ein Ladefehler aus (§27.17, Nebenbefund).
    test("Kartensammlung ohne jede Vorschau: keine Bildfläche", async ({ page }) => {
        await serveImages(page);
        await serveSection(page, "citymaps", [
            { id: id(3), title: "Karte ohne Vorschau" },
            { id: id(4), title: "Zweite ohne Vorschau" },
        ]);
        await openGareth(page, "citymaps");
        await expect(page.getByTestId("info-citymaps-card")).toHaveCount(2);
        await expect(page.getByTestId("info-citymaps-thumb")).toHaveCount(0);
    });

    test("Literatur ohne jeden Umschlag: keine Umschlagfläche", async ({ page }) => {
        await serveImages(page);
        await serveSection(page, "literature", [
            { id: id(1), title: "Werk ohne Umschlag", productType: "gruppenabenteuer", role: "start" },
            { id: id(2), title: "Zweites Werk ohne Umschlag", productType: "spielhilfe", role: "start" },
        ]);
        await openGareth(page, "literature");
        await expect(page.getByTestId("info-literature-card")).toHaveCount(2);
        await expect(page.getByTestId("info-literature-cover")).toHaveCount(0);
    });

    test("ein gemischter Streifen behält die Fläche an jeder Karte: die Titel stehen auf einer Höhe", async ({
        page,
    }) => {
        await serveImages(page);
        await serveSection(page, "citymaps", [
            { id: id(5), title: "Karte ohne Vorschau" },
            { id: id(6), title: "Karte mit Vorschau", preview: media("map_preview") },
        ]);
        await openGareth(page, "citymaps");
        await expect(page.getByTestId("info-citymaps-image")).toHaveCount(1);
        await expect(page.getByTestId("info-citymaps-thumb")).toHaveCount(2);
        const tops = await page
            .locator(".info-maps__label")
            .evaluateAll((labels) => labels.map((label) => Math.round(label.getBoundingClientRect().top)));
        expect(new Set(tops).size).toBe(1);
    });
});
