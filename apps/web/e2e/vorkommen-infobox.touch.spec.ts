import { expect, test, type Page } from "@playwright/test";
import {
    DRUNIDET as DRUNIDET_ORT,
    ergaenzeEintrag,
    kennung,
    probeEintrag,
    stelleEintrag,
    stelleLeuchten,
} from "./eintrag-stub.ts";
import { openMap } from "./map-handle.ts";

/**
 * Die Infobox eines Vorkommens am Telefon (Betreiber 2026-10-30; WI-0260): dieselbe Hand wie ein Treffer der Suche - die Infobox bleibt eingeklappt hinter der Karte, die Pille „Eintrag öffnen“ trägt Zeichen und Namen und
 * holt sie nach vorn (`vorkommen-suche.touch.spec.ts`). Wählt jemand dort eine Gegend, leuchtet sie auf der Karte, und das Panel klappt wieder ein: Es deckte sonst die Karte, auf der es leuchtet.
 */

const DRUNIDET = { kind: "place", id: DRUNIDET_ORT } as const;

/** Öffnet Drunidet, klappt die Tierarten auf und tippt den ersten Namen an; liefert den Namen. */
async function tippeErstenNamen(page: Page, vorherStellen: (name: string) => Promise<void>): Promise<string> {
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), DRUNIDET);
    await expect(page.getByTestId("info-title")).toBeVisible({ timeout: 30_000 });
    const zeile = page.locator('[data-field="lore:fauna"]');
    await zeile.waitFor({ timeout: 30_000 });
    await zeile.locator("button").first().tap();
    await expect(zeile.getByTestId("info-lore-sheet").first()).toBeAttached({ timeout: 30_000 });
    const link = zeile.getByTestId("info-lore-names").getByTestId("info-link").first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    const name = (await link.innerText()).trim();
    await vorherStellen(name);
    await link.tap();
    return name;
}

test("🔴 am Telefon: der Name öffnet das Vorkommen eingeklappt, die Pille trägt seinen Namen und holt es nach vorn", async ({
    page,
}) => {
    await ergaenzeEintrag(page);
    const name = await tippeErstenNamen(page, async () => undefined);

    const pille = page.getByTestId("eintrag-pille");
    await expect(pille).toBeVisible({ timeout: 30_000 });
    await expect(pille).toContainText(name);
    await expect(page.getByTestId("info-eintrag")).toBeHidden();

    await pille.tap();
    await expect(page.getByTestId("info-title")).toHaveText(name);
    await expect(pille).toBeHidden();
});

test("🔴 am Telefon: eine Gegend wählen lässt sie leuchten und klappt das Panel ein; die Pille holt es mit der Auswahl zurück", async ({
    page,
}) => {
    const fragen = await stelleLeuchten(page);
    let eintragsId = "";
    const name = await tippeErstenNamen(page, async (n) => {
        await stelleEintrag(page, (id) => {
            eintragsId = id;
            return probeEintrag(id, { name: n, kind: "fauna", typ: null, gruppe: "Niederer Drache" });
        });
    });

    const pille = page.getByTestId("eintrag-pille");
    await expect(pille).toContainText(name);
    await pille.tap();
    await expect(page.getByTestId("info-title")).toHaveText(name);
    await expect(page.getByTestId("info-eintrag")).toHaveAttribute("data-status", "ready");
    // Typbild der Kategorie im Kopf, Untertitel mit der Gruppe, keine Pille mit Zahl.
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("data-graphic", "fauna");
    await expect(page.getByTestId("info-subtitle")).toHaveText("Fauna · Niederer Drache");
    await expect(page.getByTestId("info-eintrag-chip")).toHaveCount(0);

    const windhag = page.getByTestId("info-eintrag-zeile").filter({ hasText: "Windhag" });
    await windhag.scrollIntoViewIfNeeded();
    await windhag.tap();

    // Die Karte wurde gefragt, und das Panel ist eingeklappt: Die Pille steht wieder über der Karte.
    await expect.poll(() => fragen.anfragen.length, { timeout: 15_000 }).toBe(1);
    expect(fragen.anfragen[0]).toEqual({ eintrag: eintragsId, landschaften: [kennung(3)] });
    await expect(page.getByTestId("info-eintrag")).toBeHidden();
    await expect(pille).toBeVisible();
    await expect(pille).toContainText(name);

    // Die Pille holt das Panel zurück, und die Auswahl steht noch da.
    await pille.tap();
    await expect(page.getByTestId("info-eintrag")).toBeVisible();
    await expect(windhag).toHaveAttribute("aria-pressed", "true");
    await expect(windhag.locator(".info-eintrag__marke")).toHaveText("●");
    await expect(pille).toBeHidden();
});
