import { expect, test } from "@playwright/test";
import { BILDER, GEHT, ebeneDa, freieStelle, hakeBeideAn, oeffne } from "./landschaftseditor-vereinigen-stub.ts";
import { settleFrame } from "./map-handle.ts";

/**
 * „Flächen vereinigen ›“ am Telefon (WI-0252): zwei Landschaften in der Liste anhaken, das Fenster ablegen, der lange Druck öffnet das
 * Kartenmenü (WI-0108), ein Tipp öffnet das Untermenü, das erste Tippen auf eine Fläche lässt sie leuchten, das zweite wählt sie.
 * 🔴 Kein Test schreibt in die Datenbank (Stubs aus `landschaftseditor-vereinigen-stub.ts`).
 *
 * Problemfälle: Am Telefon fehlt der Eintrag; das Untermenü geht nicht auf; schon das erste Tippen schreibt.
 */

test("🔴 Telefon: zwei angehakt, langer Druck, „Flächen vereinigen ›“, erstes Tippen leuchtet, zweites schreibt", async ({
    page,
}) => {
    const { server, n } = await oeffne(page, GEHT);
    await hakeBeideAn(page, n);
    await page.getByTestId("fenster-ablegen").first().tap();
    // Am Telefon steht das Editorpanel über die volle Höhe: zu, damit die Karte frei ist.
    const panelZu = page.getByTestId("editor-panel-close");
    if (await panelZu.isVisible()) await panelZu.tap();
    await settleFrame(page);
    const stelle = await freieStelle(page);
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...stelle, id: 0 }] });
    await page.waitForTimeout(800);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const eintrag = page.getByTestId("context-editor-flaechen-vereinigen");
    await expect(eintrag).toBeVisible();
    await expect(eintrag).toBeEnabled();
    await eintrag.tap();
    const unter = page.getByTestId("context-editor-flaechen-vereinigen-unter");
    await expect(unter).toBeVisible();
    const wahl = page.getByTestId(`context-editor-flaechen-vereinigen#${n.a.id}`);
    await wahl.tap();
    await expect.poll(() => ebeneDa(page, "flaechen-vereinigen-hervor")).toBe(true);
    expect(server.geschrieben).toHaveLength(0);
    await page.waitForTimeout(600);
    // Länger als `ZU_NACH_MS`: Das Untermenü bleibt am Finger offen, sonst fände das zweite Tippen nichts (Befund WI-0252).
    await expect(unter).toBeVisible();
    await settleFrame(page);
    if (BILDER) await page.screenshot({ path: `${BILDER}/flaechen-vereinigen-menue-telefon.png` });
    await wahl.tap();
    await expect.poll(() => server.geschrieben.length).toBe(1);
    expect(server.geschrieben[0]).toMatchObject({ vorlage: n.a.id });
    await expect(page.getByText("2 Flächen sind jetzt eine; ↺ im Verlauf.")).toBeVisible();
    if (BILDER) await page.screenshot({ path: `${BILDER}/flaechen-vereinigen-danach-telefon.png` });
});
