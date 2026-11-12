import { expect, test, type Page } from "@playwright/test";
import { chooseView, EDITOR_MODE, openMap, showPlace } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Angehakte Kraftlinien leuchten auf der Karte (Betreiber 2026-10-20: „auf der karte, gelb markier wär auch toll“; Schnittstelle
 * `map/mehrfach-markierung.ts`, Art `powerline`). Wie die einzeln gewählte glühen sie gelb-orange in den Bögen (`powerline-arcs.ts`,
 * `highlight`); gezählt wird über die Zahl der hervorgehobenen Abschnitte. Die Liste kommt aus einem Stub mit drei Linien, die die
 * lokale Karte bei Gareth zeichnet.
 *
 * Problemfälle: Angehakt leuchtet nichts; abgehakt leuchtet es weiter; ausgeschaltet bleiben alle hell. Ausgeschaltet bleibt höchstens EINE
 * Linie gewählt und glüht wie jede gewählte (gemeinsame Liste, `ausschalten`; seit `4777064f5` übernimmt das Fenster sie wie die Orte).
 */

const GARETH = { x: 551.625, y: 532.969 };
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/** Drei verschieden benannte Linien, wie die Kacheln sie gerade zeichnen. */
async function dreiLinien(page: Page): Promise<{ id: string; name: string }[]> {
    for (let versuch = 0; versuch < 20; versuch += 1) {
        const linien = await page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            if (!map.getLayer("powerline-hit")) return [];
            const je = new Map<string, string>();
            for (const f of map.queryRenderedFeatures({ layers: ["powerline-hit"] })) {
                const name = String(f.properties["name"] ?? "").trim();
                if (name !== "" && !/-\d+$/.test(name) && !je.has(name))
                    je.set(name, String(f.properties["public_id"]));
            }
            return [...je].map(([name, id]) => ({ id, name }));
        });
        if (linien.length >= 3) return linien.slice(0, 3);
        await page.waitForTimeout(500);
    }
    throw new Error("keine drei gezeichneten Kraftlinien");
}

const hervorgehoben = (page: Page): Promise<number> =>
    page.evaluate(
        () =>
            (
                globalThis as unknown as { avesmapsPowerlineArcs?: { state(): { highlighted: number } } }
            ).avesmapsPowerlineArcs?.state().highlighted ?? -1,
    );

test.use({ viewport: { width: 1920, height: 1080 } });

test("🔴 angehakte Kraftlinien glühen wie die gewählte: drei angehakt, eins abgehakt, ausgeschaltet höchstens die gewählte", async ({
    page,
}) => {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    let linien: { id: string; name: string }[] = [];
    await page.route("**/api/editor/powerlines", (route) =>
        route.fulfill(
            json({
                rows: linien.map((l) => ({ ...l, circle: "voll", shape: "strang", segments: 1, nodes: 2 })),
            }),
        ),
    );
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await chooseView(page, "powerlines");
    await showPlace(page, GARETH, 6);
    linien = await dreiLinien(page);
    await page.getByTestId("editorpanel-kachel-kraftlinien").click();
    await page.getByTestId("editorpanel-verb").click();
    const zeile = (name: string) =>
        page
            .locator('[data-testid^="kraftlinieneditor-"][data-testid$="-liste"]')
            .getByRole("option", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(zeile(linien[0]!.name)).toBeVisible();
    await expect.poll(() => hervorgehoben(page)).toBe(0);

    await page.locator('[data-testid$="-linien-mehrfach"]').click();
    for (const linie of linien) await zeile(linie.name).click();
    await expect(page.locator('[data-testid$="-linien-haken"]')).toContainText("3 angehakt");
    await expect.poll(() => hervorgehoben(page), { timeout: 10_000 }).toBeGreaterThan(0);
    const drei = await hervorgehoben(page);

    await zeile(linien[2]!.name).click();
    await expect(page.locator('[data-testid$="-linien-haken"]')).toContainText("2 angehakt");
    await expect.poll(() => hervorgehoben(page)).toBeLessThan(drei);
    await expect.poll(() => hervorgehoben(page)).toBeGreaterThan(0);
    const zwei = await hervorgehoben(page);

    // Ausgeschaltet glühen die Haken nicht mehr: höchstens die eine Linie, die gewählt bleibt (wie bei den Orten).
    await page.locator('[data-testid$="-linien-mehrfach"]').click();
    await expect(page.locator('[data-testid$="-linien-mehrfach"]').first()).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => hervorgehoben(page)).toBeLessThan(zwei);
    const gewaehlt = await page.evaluate(
        () => (globalThis.avesmapsSelectedSubject?.() as { kind: string } | undefined)?.kind,
    );
    if (gewaehlt !== "powerline") expect(await hervorgehoben(page)).toBe(0);
});
