import { expect, test, type Page } from "@playwright/test";
import { ergaenzeEintrag } from "./eintrag-stub.ts";
import { settleFrame } from "./map-handle.ts";

/**
 * Vorkommen in der Spotlight-Suche (WI-0257, S3b) am echten Stapel: die Sektion „Vorkommen“, die Autovervollständigung (Präpositionen, Ziele), das Leuchten auf der Karte, das Panel des Eintrags und der
 * wechselnde Platzhalter.
 *
 * 🪤 Das Panel des Eintrags liest das Format von WI-0260 (`wo`, Kurzbeschreibung, Publikationen): `ergaenzeEintrag` fragt den echten Server und hängt an, was ihm noch fehlt; führt er das Format selbst, geht seine Antwort
 * unverändert durch. Die Gegenden und ihre Anfragen sind damit die der Entwicklungsdatenbank, und gelesen wird weiter an der Karte.
 *
 * 🪤 Gelesen wird, was die KARTE zeichnet und die KAMERA tut, nicht nur die Liste: Eine Liste mit dem richtigen Namen, nach der nichts leuchtet, wäre die halbe Funktion. Die Daten sind die der lokalen
 * Datenbank (Baumdrache: Wald in Aventurien; Schlinger: Meridiana und Echsensümpfe; Eiche: nur „Aventurien“). Wirselkraut hat dort keine übernommene Regel.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const START = "/#x=500.000&y=500.000&z=2.50&series=original";

async function openSearch(page: Page): Promise<void> {
    await page.goto(START);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.keyboard.press("f");
    await expect(page.getByTestId("search-input")).toBeFocused();
}

/** Tippt in die Suche und wartet, bis die Antwort zur Eingabe da ist (die Liste nennt etwas, das nur die neue Antwort kennt). */
async function type(page: Page, text: string): Promise<void> {
    await page.getByTestId("search-input").fill(text);
}

/** Wie viele Kennungen ein Kennungsfilter nennt: `match` (über 64) trägt die Liste an Stelle 2, `in` als `["literal", liste]`. */
function kennungen(filter: unknown): number {
    if (!Array.isArray(filter)) return 0;
    const dritte = filter[2] as unknown;
    if (filter[0] === "match") return Array.isArray(dritte) ? dritte.length : 0;
    return Array.isArray(dritte) && dritte[0] === "literal" ? ((dritte[1] as unknown[] | undefined)?.length ?? 0) : 0;
}

/** Die Ebenen und die Quelle des Leuchtens, wie die Karte sie führt. */
async function leuchten(page: Page): Promise<{
    ganzFilter: unknown;
    ganzSichtbar: number;
    formen: number;
    ringe: number;
    kontinentLinie: boolean;
}> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as import("maplibre-gl").Map;
        const quelle = map.getSource("such-leuchten") as import("maplibre-gl").GeoJSONSource | undefined;
        // `serialize()` trägt die Daten der Quelle; `_data` wäre ein privates Feld.
        const daten = quelle?.serialize().data as { features?: { properties: { t: string } }[] } | undefined;
        const merkmale = daten?.features ?? [];
        return {
            ganzFilter:
                map.getLayer("such-leuchten-ganz-fuellung") === undefined
                    ? null
                    : map.getFilter("such-leuchten-ganz-fuellung"),
            ganzSichtbar:
                map.getLayer("such-leuchten-ganz-fuellung") === undefined
                    ? 0
                    : map.queryRenderedFeatures(undefined, { layers: ["such-leuchten-ganz-fuellung"] }).length,
            formen: merkmale.filter((m) => m.properties.t === "flaeche").length,
            ringe: merkmale.filter((m) => m.properties.t === "ort").length,
            kontinentLinie: map.getLayer("such-leuchten-kontinent-linie") !== undefined,
        };
    });
}

test("🔴 „baumdrache“ zeigt die Sektion Vorkommen mit Kategoriezeichen, leiser Zeile und der Zahl der Gegenden", async ({
    page,
}) => {
    await openSearch(page);
    await type(page, "baumdrache");
    const zeile = page.getByTestId("search-vorkommen").first();
    await expect(page.getByTestId("search-sektion-vorkommen")).toHaveText(/Vorkommen/u);
    await expect(zeile).toContainText("Baumdrache");
    await expect(zeile).toContainText("Fauna");
    await expect(zeile.locator(".editor-zeichen")).toBeVisible();
    // Die Zahl wird nachgeladen (die Sektion rechnet nichts) und steht in der Farbe der Auswahl.
    await expect(page.getByTestId("search-vorkommen-zahl").first()).toContainText(/leuchtet in \d+ Gegenden/u);
    // Unter einem Treffer ohne Präposition steht die leise Zeile, keine Chips.
    await expect(page.getByTestId("search-hinweis")).toHaveText(/in …, auf …, südlich von … grenzt ein/u);
    await expect(page.getByTestId("search-chips")).toBeHidden();
    // Die ganze Liste steht über der Eingabe; nichts liegt über der Suche.
    const obenauf = await zeile.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const oben = document.elementFromPoint(box.left + 4, box.top + box.height / 2);
        return oben !== null && el.contains(oben);
    });
    expect(obenauf).toBe(true);
});

test("„baumdrache “ schlägt die Präpositionen als Chips vor; ein Klick setzt sie ins Feld", async ({ page }) => {
    await openSearch(page);
    await type(page, "baumdrache ");
    const chips = page.getByTestId("search-chip");
    await expect(chips).toHaveCount(8);
    await expect(page.getByTestId("search-hinweis")).toBeHidden();
    await expect(chips.first()).toContainText("in …");
    await chips.filter({ hasText: "südlich von" }).click();
    await expect(page.getByTestId("search-input")).toHaveValue("Baumdrache südlich von ");
    await expect(page.getByTestId("search-input")).toBeFocused();
});

test("„baumdrache in “ nennt die Orte mit Zahl; im Wiki Genanntes steht markiert, Gebiete in eigener Gruppe", async ({
    page,
}) => {
    await openSearch(page);
    await type(page, "Schlinger in ");
    const sektion = page.getByTestId("search-sektion-ziele:landschaft");
    await expect(sektion).toHaveText(/Schlinger in … · Landschaften/u);
    const ziele = page.getByTestId("search-ziel");
    await expect(ziele.first()).toContainText("im Wiki genannt");
    await expect(ziele.first()).toContainText(/\d+ Gegenden/u);
    await expect(page.getByTestId("search-ziel-hinweis")).toBeVisible();
    // Die Hinweiszeile trennt nicht von selbst („Gegen-den“): `hyphens: manual`.
    await expect(page.getByTestId("search-ziel-hinweis")).toHaveCSS("hyphens", "manual");
    // Das erste Ziel ist vorausgewählt; Tab übernimmt es ins Feld, ohne es zu leuchten.
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("search-input")).toHaveValue(/^Schlinger in \S/u);
    await expect(page.getByTestId("search")).toBeVisible();
});

test("🔴 ein Vorkommen gewählt: sein Panel geht auf, die Gegenden leuchten, die Kamera fliegt auf den Rahmen", async ({
    page,
}) => {
    await ergaenzeEintrag(page);
    await openSearch(page);
    const vorher = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    await type(page, "schlinger");
    await expect(page.getByTestId("search-vorkommen").first()).toContainText("Schlinger");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("search")).toBeHidden();

    // Das Panel des Eintrags in der Hülle des Infopanels: Kopf mit Name und Art, „Wo es vorkommt“ mit „Alle zeigen“ und den Gegenden.
    const panel = page.getByTestId("info-eintrag");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("info-title")).toHaveText("Schlinger");
    await expect(page.getByTestId("info-subtitle")).toContainText("Fauna");
    // Der ganze Eintrag leuchtet, also steht „Alle zeigen“ in der Farbe der Auswahl; jede Gegend steht einmal da, ohne Zahl und ohne Kontinent.
    await expect(page.getByTestId("info-eintrag-alle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("info-eintrag-zeile").first()).toBeVisible();
    await expect(page.getByTestId("info-eintrag-zeile").filter({ hasText: /^Aventurien/u })).toHaveCount(0);
    expect(await page.getByTestId("info-eintrag-wo").innerText()).not.toMatch(/\d/u);
    await expect(page.getByTestId("info-eintrag-chip")).toHaveCount(0);
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsSelectedSubject?.()), { timeout: 15_000 })
        .toMatchObject({ kind: "loreEntry" });

    // Es leuchtet: ganze Gegenden über den Kachelfilter, angeschnittene als Formen; die Kamera ist hingeflogen (nie gesprungen).
    await expect.poll(async () => (await leuchten(page)).ganzFilter, { timeout: 30_000 }).not.toBeNull();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 30_000 });
    await settleFrame(page);
    const nachher = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    expect(nachher).not.toBe(vorher);
    await expect.poll(async () => (await leuchten(page)).ganzSichtbar, { timeout: 30_000 }).toBeGreaterThan(0);

    // Es bleibt beim Schwenken stehen …
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const mitte = map.project(map.getCenter());
        map.jumpTo({ center: map.unproject([mitte.x + 60, mitte.y + 40]) });
    });
    await settleFrame(page);
    expect((await leuchten(page)).ganzFilter).not.toBeNull();
    // … und endet mit einem Klick ins Leere.
    await page.mouse.click(1150, 700);
    await expect.poll(async () => (await leuchten(page)).ganzFilter, { timeout: 10_000 }).toBeNull();
});

test("🔴 eine Gegend der Liste schneidet das Leuchten auf sie zu; „Alle zeigen“ nimmt es zurück", async ({ page }) => {
    await ergaenzeEintrag(page);
    await openSearch(page);
    await type(page, "schlinger");
    await expect(page.getByTestId("search-vorkommen").first()).toContainText("Schlinger");
    await page.keyboard.press("Enter");
    const gegend = page.locator('[data-testid="info-eintrag-zeile"][data-art="gegend"]').first();
    await expect(gegend).toBeVisible();
    await expect.poll(async () => (await leuchten(page)).ganzFilter, { timeout: 30_000 }).not.toBeNull();
    const alleFilter = JSON.stringify((await leuchten(page)).ganzFilter);
    const alle = page.getByTestId("info-eintrag-alle");
    await expect(alle).toHaveAttribute("aria-pressed", "true");

    await gegend.click();
    await expect(gegend).toHaveAttribute("aria-pressed", "true");
    await expect(alle).toHaveAttribute("aria-pressed", "false");
    // Das Leuchten ist ein anderes (kleiner oder zugeschnitten) und trägt etwas: ganze Gegenden (Kennungen) oder angeschnittene (Formen).
    await expect
        .poll(async () => JSON.stringify((await leuchten(page)).ganzFilter), { timeout: 30_000 })
        .not.toBe(alleFilter);
    const bild = await leuchten(page);
    expect(kennungen(bild.ganzFilter) + bild.formen).toBeGreaterThan(0);

    await alle.click();
    await expect(alle).toHaveAttribute("aria-pressed", "true");
    await expect(gegend).toHaveAttribute("aria-pressed", "false");
    await expect
        .poll(async () => JSON.stringify((await leuchten(page)).ganzFilter), { timeout: 30_000 })
        .toBe(alleFilter);
});

test("🔴 „Baumdrache in Kosch“ schneidet zu: nur der Teil in Kosch leuchtet, mit Panel", async ({ page }) => {
    await ergaenzeEintrag(page);
    await openSearch(page);
    await type(page, "Baumdrache in Kosch");
    const ziel = page.getByTestId("search-ziel").first();
    await expect(ziel).toContainText("Kosch");
    await expect(ziel).toContainText(/\d+ Gegenden/u);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("search")).toBeHidden();
    await expect(page.getByTestId("info-title")).toHaveText("Baumdrache");
    await expect.poll(async () => (await leuchten(page)).ganzFilter, { timeout: 30_000 }).not.toBeNull();
    // Baumdrache leuchtet sonst in rund 2.900 Gegenden: Zugeschnitten auf Kosch sind es wenige.
    const bild = await leuchten(page);
    expect(kennungen(bild.ganzFilter) + bild.formen).toBeGreaterThan(0);
    expect(kennungen(bild.ganzFilter)).toBeLessThan(200);
});

test("🔴 „Baumdrache“ allein: die ganzen 2.900 Gegenden leuchten über EINEN Kachelfilter (match), und die Karte bleibt bedienbar", async ({
    page,
}) => {
    await ergaenzeEintrag(page);
    await openSearch(page);
    await type(page, "baumdrache");
    await expect(page.getByTestId("search-vorkommen").first()).toContainText("Baumdrache");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await leuchten(page)).ganzFilter, { timeout: 45_000 }).not.toBeNull();
    const filter = (await leuchten(page)).ganzFilter as unknown[];
    expect(filter[0]).toBe("match");
    expect(kennungen(filter)).toBeGreaterThan(1000);
    // Das Panel: Der Kontinent ist keine Zeile („Alle zeigen“ deckte ihn ab), „Mittelreich“ löst keine Gegend auf; es bleibt „Alle zeigen“, und es leuchtet.
    await expect(page.getByTestId("info-eintrag-alle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("info-eintrag-zeile").filter({ hasText: /^Aventurien/u })).toHaveCount(0);
    await expect(page.getByTestId("info-eintrag-chip")).toHaveCount(0);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 30_000 });
    await settleFrame(page);
    await expect.poll(async () => (await leuchten(page)).ganzSichtbar, { timeout: 45_000 }).toBeGreaterThan(0);
});

test("🔴 „Eiche“ nennt nur Aventurien: kein gefülltes Leuchten, der Kontinent als Umriss, das Panel sagt „überall“", async ({
    page,
}) => {
    await ergaenzeEintrag(page);
    await openSearch(page);
    await type(page, "eiche");
    const zeile = page
        .getByTestId("search-vorkommen")
        .filter({ has: page.locator(".spotlight__name", { hasText: /^\s*Eiche\s*$/u }) })
        .first();
    await expect(zeile.getByTestId("search-vorkommen-zahl")).toContainText("überall in Aventurien");
    await zeile.click();
    await expect(page.getByTestId("info-eintrag-ueberall")).toContainText("Überall in Aventurien");
    // Kein „Regel“ für Besucher, keine Zeile zum Wählen.
    await expect(page.getByTestId("info-eintrag-ueberall")).toContainText(
        "Keine genauere Gegend bekannt. Aventurien leuchtet als Umriss.",
    );
    await expect(page.getByTestId("info-eintrag-ueberall")).not.toContainText(/regel/iu);
    await expect(page.getByTestId("info-eintrag-alle")).toHaveCount(0);
    await expect(page.getByTestId("info-eintrag-zeile")).toHaveCount(0);
    await expect.poll(async () => (await leuchten(page)).kontinentLinie, { timeout: 30_000 }).toBe(true);
    const bild = await leuchten(page);
    expect(bild.ganzFilter).toBeNull();
    expect(bild.formen).toBe(0);
});

test("🔴 genannte Orte leuchten als Ring, ein genanntes Herrschaftsgebiet als Umriss (Säbel)", async ({ page }) => {
    await ergaenzeEintrag(page);
    await openSearch(page);
    await type(page, "Säbel");
    const zeile = page
        .getByTestId("search-vorkommen")
        .filter({ has: page.locator(".spotlight__name", { hasText: /^\s*Säbel\s*$/u }) })
        .first();
    await expect(zeile).toBeVisible();
    await zeile.click();
    await expect(page.getByTestId("info-title")).toHaveText("Säbel");
    await expect.poll(async () => (await leuchten(page)).ringe, { timeout: 30_000 }).toBe(2);
    const umriss = await page.evaluate(
        () =>
            (globalThis.avesmapsMap as unknown as import("maplibre-gl").Map).getLayer(
                "such-leuchten-gebiet-ganz-linie",
            ) !== undefined,
    );
    expect(umriss).toBe(true);
});

test("Herrschaftsgebiete sind Treffer: die Sektion „Gebiete“, ein Klick wählt das Gebiet", async ({ page }) => {
    await openSearch(page);
    await type(page, "Nivesenlande");
    await expect(page.getByTestId("search-sektion-gebiete")).toBeVisible();
    await page.getByTestId("search-gebiet").first().click();
    await expect(page.getByTestId("search")).toBeHidden();
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsSelectedSubject?.()), { timeout: 15_000 })
        .toMatchObject({ kind: "territory" });
});

test("der Platzhalter wechselt sanft zwischen echten Beispielen und hält an, sobald das Feld angeklickt wird", async ({
    page,
}) => {
    await openSearch(page);
    const text = page.getByTestId("search-placeholder-text");
    await expect(text).toBeVisible();
    const erstes = (await text.textContent()) ?? "";
    expect(erstes.length).toBeGreaterThan(0);
    // Nach rund vier Sekunden steht ein anderes Beispiel da.
    await expect
        .poll(async () => (await text.textContent()) ?? "", { timeout: 15_000, intervals: [500] })
        .not.toBe(erstes);
    // Ein Klick ins Feld hält ihn an.
    await page.getByTestId("search-input").click();
    const gehalten = (await text.textContent()) ?? "";
    await page.waitForTimeout(5_000);
    expect((await text.textContent()) ?? "").toBe(gehalten);
    // Tippen blendet ihn aus.
    await type(page, "g");
    await expect(page.getByTestId("search-placeholder")).toBeHidden();
});

test.describe("ohne Bewegung", () => {
    test.use({ reducedMotion: "reduce" });
    test("🔴 `prefers-reduced-motion`: kein Wechsel des Platzhalters", async ({ page }) => {
        await openSearch(page);
        const text = page.getByTestId("search-placeholder-text");
        await expect(text).toBeVisible();
        const erstes = (await text.textContent()) ?? "";
        await page.waitForTimeout(6_000);
        expect((await text.textContent()) ?? "").toBe(erstes);
    });
});
