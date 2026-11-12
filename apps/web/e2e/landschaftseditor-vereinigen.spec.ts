import { expect, test } from "@playwright/test";
import { BILDER, GEHT, ebeneDa, freieStelle, hakeBeideAn, oeffne } from "./landschaftseditor-vereinigen-stub.ts";
import { settleFrame } from "./map-handle.ts";

/**
 * „Flächen vereinigen ›“ im Kartenmenü (WI-0252; Betreiber 2026-10-24: „unter anlegen "Hier hinzufügen" soll im kontextmenü (bei der
 * mehrfachauswahl von objekte) "Flächen vereinigen" stehen das Untermenü bestimmt wessen einstellungen übernommen werden“).
 *
 * Die Flächen kommen aus den Kacheln der lokalen Karte (zwei Nachbarn derselben Art in der Vegetation), Liste, Prüfung und Schreibweg aus
 * Stubs. 🔴 Kein Test schreibt in die Datenbank; die Rechnung selbst prüft `apps/server/test/flaechen-vereinigen.test.ts`.
 *
 * Problemfälle: Der Eintrag fehlt bei einer Mehrfachauswahl oder steht nicht direkt unter „Hier hinzufügen ›“; das Untermenü nennt die
 * Flächen nicht oder lässt die gezeigte nicht leuchten; die Wahl schreibt nicht EINMAL mit der Vorlage; danach bleibt die Mehrfachauswahl
 * stehen; geht es nicht, steht der Eintrag anklickbar da statt grau mit dem Grund.
 */

for (const groesse of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
]) {
    test(`🔴 ${String(groesse.width)}: zwei angehakte Nachbarn, „Flächen vereinigen ›“ unter „Hier hinzufügen ›“, die Wahl schreibt EINMAL`, async ({
        page,
    }) => {
        await page.setViewportSize(groesse);
        const { server, n } = await oeffne(page, GEHT);
        await hakeBeideAn(page, n);
        await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-mehrfach$/)).toContainText(
            "2 Landschaften gewählt",
        );
        const stelle = await freieStelle(page);
        await page.mouse.click(stelle.x, stelle.y, { button: "right" });
        const karte = page.getByTestId("context-editor");
        await expect(karte).toBeVisible();
        // Direkt unter „Hier hinzufügen ›“, im Abschnitt Anlegen.
        const anlegen = await karte
            .locator('[data-testid^="context-editor-"]')
            .evaluateAll((knoepfe) =>
                knoepfe
                    .map((k) => k.getAttribute("data-testid") ?? "")
                    .filter(
                        (id) => id === "context-editor-hier-hinzufuegen" || id === "context-editor-flaechen-vereinigen",
                    ),
            );
        expect(anlegen).toEqual(["context-editor-hier-hinzufuegen", "context-editor-flaechen-vereinigen"]);
        await expect(page.getByTestId("context-editor-flaechen-vereinigen")).toBeEnabled();
        await page.getByTestId("context-editor-flaechen-vereinigen").hover();
        const unter = page.getByTestId("context-editor-flaechen-vereinigen-unter");
        await expect(unter).toBeVisible();
        await expect(unter).toContainText(n.a.name);
        await expect(unter).toContainText(n.b.name);
        // Zeigen lässt die Vorlage leuchten.
        await page.getByTestId(`context-editor-flaechen-vereinigen#${n.b.id}`).hover();
        await expect.poll(() => ebeneDa(page, "flaechen-vereinigen-hervor")).toBe(true);
        await settleFrame(page);
        if (BILDER) await page.screenshot({ path: `${BILDER}/flaechen-vereinigen-menue-${String(groesse.width)}.png` });

        await page.getByTestId(`context-editor-flaechen-vereinigen#${n.b.id}`).click();
        await expect.poll(() => server.geschrieben.length).toBe(1);
        expect(server.geschrieben[0]).toEqual({
            operationId: expect.any(String),
            objects: [
                { publicId: n.a.id, baseRevision: 2 },
                { publicId: n.b.id, baseRevision: 3 },
            ],
            vorlage: n.b.id,
        });
        await expect(page.getByText("2 Flächen sind jetzt eine; ↺ im Verlauf.")).toBeVisible();
        // Danach ist die Mehrfachauswahl aufgehoben, nichts leuchtet mehr.
        await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-mehrfach$/)).toHaveCount(0);
        await expect.poll(() => ebeneDa(page, "flaechen-vereinigen-hervor")).toBe(false);
        if (BILDER)
            await page.screenshot({ path: `${BILDER}/flaechen-vereinigen-danach-${String(groesse.width)}.png` });
    });
}

test("🔴 geht es nicht, steht der Eintrag grau mit dem Grund, ohne Untermenü", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { server, n } = await oeffne(page, (x) => ({
        geht: false,
        grund: "nachbar",
        objekte: [x.a, x.b].map((f) => ({ publicId: f.id, revision: 1, name: f.name, art: f.typ, flaechen: 1 })),
    }));
    await hakeBeideAn(page, n);
    const stelle = await freieStelle(page);
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    const eintrag = page.getByTestId("context-editor-flaechen-vereinigen");
    await expect(eintrag).toBeDisabled();
    await expect(eintrag).toHaveAttribute("title", "Eine Nachbarfläche verlöre ihre gemeinsame Kante.");
    // 🔴 Der Grund steht auch als Zeile unter dem Eintrag: Ohne sie sah das Grau aus wie „tut nichts“ (WI-0252, Stage), am Finger gibt es
    // keinen Tooltip, und an echten Daten ist das Grau der Regelfall (rund ein Drittel der Nachbarpaare geht nicht).
    await expect(page.getByTestId("context-editor-flaechen-vereinigen-grund")).toHaveText(
        "Eine Nachbarfläche verlöre ihre gemeinsame Kante.",
    );
    await eintrag.hover({ force: true });
    await expect(page.getByTestId("context-editor-flaechen-vereinigen-unter")).toHaveCount(0);
    expect(server.gefragt).toHaveLength(1);
    if (BILDER) await page.screenshot({ path: `${BILDER}/flaechen-vereinigen-grau-1280.png` });
});
