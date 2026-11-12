import { expect, test, type Page } from "@playwright/test";
import {
    bedieneMedienrouten,
    GARETH,
    MIT_MEDIEN,
    medienQuelle,
    schliesseMedienQuelle,
    stubSitzung,
    type MedienQuelle,
} from "./medien-quelle.ts";

/**
 * Die Medienverwaltung am Telefon (WI-0068 §3.4, P3): Drill-down in drei Ebenen im selben modalen Fenster - Arten → Treffer →
 * Asset, „‹“ führt zurück, keine gequetschten Spalten. Gegen die echten Medien der Entwicklungsdatenbank (`medien-quelle.ts`).
 */

let quelle: MedienQuelle | undefined;

test.beforeAll(async () => {
    quelle = await medienQuelle();
});
test.afterAll(async () => {
    await schliesseMedienQuelle();
});

async function oeffneKarte(page: Page, pfad = "/edit"): Promise<MedienQuelle> {
    test.skip(quelle === undefined, "ohne DATABASE_URL keine echten Medien");
    await stubSitzung(page, MIT_MEDIEN);
    await bedieneMedienrouten(page, quelle!);
    await page.goto(pfad);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    return quelle!;
}

const sichtbar = async (page: Page, id: string): Promise<boolean> => (await page.getByTestId(id).count()) > 0;

test("🔴 drei Ebenen im selben Fenster: Arten → Treffer → Asset und zurück", async ({ page }) => {
    await oeffneKarte(page);
    await page.getByTestId("kopfleiste-menue").tap();
    await page.getByTestId("menue-medien").tap();
    const fenster = page.getByTestId("medien-fenster");
    await expect(fenster).toBeVisible();
    // Volle Breite mit 14 px Rand (Hülle), kein Griff.
    const rand = await fenster.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { links: box.left, rechts: innerWidth - box.right };
    });
    expect(rand.links).toBeCloseTo(14, 0);
    expect(rand.rechts).toBeCloseTo(14, 0);

    // Ebene 1: nur die Arten; die Suche steht bei den Treffern (Betreiber 2026-10-11).
    await expect(page.getByTestId("medien-spalte-arten")).toBeVisible();
    expect(await sichtbar(page, "medien-spalte-treffer")).toBe(false);
    expect(await sichtbar(page, "medien-spalte-inspektor")).toBe(false);
    await expect(page.getByTestId("medien-spalte-arten").getByTestId("medien-suche")).toHaveCount(0);
    await expect(page.getByTestId("medien-fuss")).toHaveText("Ebene 1 von 3");
    // Die Spalte füllt das Fenster.
    const spalte = await page.getByTestId("medien-spalte-arten").evaluate((node) => node.getBoundingClientRect().width);
    const breite = await fenster.evaluate((node) => node.getBoundingClientRect().width);
    expect(spalte).toBeGreaterThan(breite - 4);

    // Ebene 2: die Treffer.
    await page.getByTestId("medien-arten-eintrag-korb-rights_open").tap();
    await expect(page.getByTestId("medien-spalte-treffer")).toBeVisible();
    // Neben Trichter, Sortierung und zwei Segmentgruppen passt am Telefon nicht einmal „Suchen …“: Die Suche ist der Lupen-Knopf der
    // Leiste (Design Guide §13.45, Koordination 2026-10-12).
    await expect(page.getByTestId("medien-spalte-treffer").getByTestId("medien-lupe")).toBeVisible();
    expect(await sichtbar(page, "medien-spalte-arten")).toBe(false);
    await expect(page.getByTestId("medien-fuss")).toHaveText("Ebene 2 von 3");
    await expect(page.getByTestId("medien-eintrag").first()).toBeVisible();

    // Ebene 3: das Asset.
    await page.getByTestId("medien-eintrag").first().tap();
    await expect(page.getByTestId("medien-spalte-inspektor")).toBeVisible();
    await expect(page.getByTestId("medien-pillen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("medien-fuss")).toHaveText("Ebene 3 von 3");

    // Zurück, Schritt für Schritt; die Wahl bleibt.
    await page.getByTestId("medien-zurueck-treffer").tap();
    await expect(page.getByTestId("medien-spalte-treffer")).toBeVisible();
    await expect(page.locator('[data-testid="medien-eintrag"][aria-current="true"]')).toHaveCount(1);
    await page.getByTestId("medien-zurueck-arten").tap();
    await expect(page.getByTestId("medien-spalte-arten")).toBeVisible();
    await expect(page.getByTestId("medien-arten-eintrag-korb-rights_open")).toHaveAttribute("aria-current", "page");
});

test("🔴 der Kontext-Einstieg am Wappen landet auf Ebene 3", async ({ page }) => {
    const q = await oeffneKarte(page);
    const wappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    await page.evaluate((id) => globalThis.avesmapsOpenSubject?.({ kind: "place", id }), GARETH);
    const knopf = page.getByTestId("info-medien-wappen");
    await expect(knopf).toBeVisible({ timeout: 20_000 });
    await knopf.tap();
    await expect(page.getByTestId("medien-spalte-inspektor")).toBeVisible();
    await expect(page.getByTestId("medien-inspektor-kennung")).toHaveText(`Asset ${wappen.items[0]!.id.slice(0, 8)}`);
    await expect(page.getByTestId("medien-fuss")).toHaveText("Ebene 3 von 3");
    await page.getByTestId("medien-zurueck-treffer").tap();
    await expect(page.getByTestId("medien-spalte-treffer").getByTestId("fenster-spalte-unter")).toContainText(
        "verwendet von Gareth",
    );
    await expect(page.getByTestId("medien-filter-von")).toBeVisible();
});
