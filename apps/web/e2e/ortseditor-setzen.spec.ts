import { expect, test, type Page } from "@playwright/test";
import type { PlaceCreateBody } from "@avesmaps3d/shared";
import { clickMap, settleFrame, showPlace } from "./map-handle.ts";
import { fenster, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";

/**
 * Einen Ort auf die Karte setzen, der noch nicht dort steht (WI-0128 E16; Betreiber 2026-10-11: „wenn man einen ort aus der liste per
 * drag and drop auf die karte ziehen könnte“, „natürlich darf man nur orte auf die karte ziehen, die noch nicht auf der karte sind“).
 * Die Liste legt `ortseditor-stub.ts` hin; der Server antwortet hier gestellt.
 */
const RECHTE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];
const NEU = "e16e16e1-0000-4000-8000-000000000001";

/**
 * Bearbeiten an (Testwelt), dann der Ortseditor, dann das Anlegen: Die Route fürs Anlegen kommt NACH der Liste der Attrappe, damit sie
 * zuerst gefragt wird (Playwright fragt die jüngste Route zuerst) und das Lesen der Liste an die Attrappe weitergibt.
 */
async function oeffneMitSchreiben(page: Page, rechte: string[]): Promise<PlaceCreateBody[]> {
    const gesendet: PlaceCreateBody[] = [];
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await oeffneOrtseditor(page, { rechte });
    await page.route("**/api/editor/places", (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        gesendet.push(route.request().postDataJSON() as PlaceCreateBody);
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: "00000000-0000-4000-8000-000000000001",
                status: "applied",
                environment: "development",
                affected: [{ kind: "place", id: NEU, revision: 1 }],
                derivedWork: [],
                warnings: [],
            }),
        });
    });
    return gesendet;
}

/** Eine Stelle der Karte (Canvas-Pixel), an der zuoberst die Karte liegt, kein Panel und kein Fenster: von links gesucht. */
async function freieStelle(page: Page): Promise<{ x: number; y: number }> {
    await settleFrame(page);
    return page.locator(".maplibregl-canvas").evaluate((canvas) => {
        const rahmen = canvas.getBoundingClientRect();
        const y = rahmen.height / 2;
        const frei = (x: number) => document.elementFromPoint(rahmen.left + x, rahmen.top + y) === canvas;
        for (let x = 60; x < rahmen.width - 60; x += 20) if (frei(x) && frei(x + 40)) return { x: x + 20, y };
        return { x: rahmen.width / 2, y };
    });
}

/** Eine freie Stelle links auf der Karte (Canvas-Pixel): Rechts liegt der angedockte Ortseditor. */
const FREI = { x: 220, y: 300 };

/**
 * Eine Zeile auf die Karte ziehen: dieselben Ereignisse wie die Maus (dragstart an der Zeile, dragover und drop über der Karte), mit
 * einem gemeinsamen DataTransfer. Playwrights `dragTo` wartet auf die Karte als Ziel und kommt über die Fensterkulisse nicht hinweg.
 */
async function zieheAufKarte(page: Page, name: string, punkt: { x: number; y: number }): Promise<void> {
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await zeile(page, name).dispatchEvent("dragstart", { dataTransfer: transfer });
    const rahmen = await page.locator(".maplibregl-canvas-container").boundingBox();
    const bei = { clientX: (rahmen?.x ?? 0) + punkt.x, clientY: (rahmen?.y ?? 0) + punkt.y, dataTransfer: transfer };
    const ziel = page.locator(".maplibregl-canvas-container");
    await ziel.dispatchEvent("dragover", bei);
    await ziel.dispatchEvent("drop", bei);
}

test("🔴 eine Zeile „nicht auf der Karte“ aus der Liste auf die Karte ziehen legt den Ort dort an, mit seinem Wiki-Eintrag", async ({
    page,
}) => {
    const gesendet = await oeffneMitSchreiben(page, RECHTE);
    const turm = zeile(page, "Wachturm am Großen Fluss");
    await expect(turm).toHaveAttribute("draggable", "true");
    // Der Griff des Hauses (⠿) steht nur an dem, was man ziehen kann (Betreiber 2026-10-11), und der Zeiger greift dort.
    const griff = turm.locator('[data-testid$="-zeile-griff"]');
    await expect(griff).toBeVisible();
    expect(await griff.evaluate((element) => getComputedStyle(element, "::before").content)).toContain("⠿");
    expect(await turm.evaluate((element) => getComputedStyle(element).cursor)).toBe("grab");
    // Was schon auf der Karte steht, und eine Stätte (E18) lassen sich nicht ziehen.
    await expect(zeile(page, "Gratenfels")).not.toHaveAttribute("draggable", "true");
    await expect(zeile(page, "Gratenfels").locator('[data-testid$="-zeile-griff"]')).toHaveCount(0);

    await settleFrame(page);
    await zieheAufKarte(page, "Wachturm am Großen Fluss", FREI);
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toMatchObject({
        name: "Wachturm am Großen Fluss",
        subtype: "gebaeude",
        kind: "Turm",
        wikiKey: "wiki:wachturm-am-grossen-fluss",
        position: { x: expect.any(Number), y: expect.any(Number) },
    });
    await expect(page.getByText("Wachturm am Großen Fluss steht jetzt auf der Karte.")).toBeVisible();
});

test("🔴 „● Auf der Karte setzen“ am Wiki-Eintrag: der nächste Klick auf die Karte setzt ihn", async ({ page }) => {
    const gesendet = await oeffneMitSchreiben(page, RECHTE);
    await zeile(page, "Wachturm am Großen Fluss").click();
    await fenster(page).locator('[data-testid$="-setzen"]').click();
    // Das Fenster klappt ein wie beim Verschieben; die Leiste sagt, was zu tun ist.
    await expect(page.locator('[data-testid$="-modusleiste"]')).toContainText("Auf die Karte klicken");
    await settleFrame(page);
    const mitte = await page.locator(".maplibregl-canvas").evaluate((canvas) => ({
        x: canvas.clientWidth / 2,
        y: canvas.clientHeight / 2,
    }));
    await clickMap(page, mitte);
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toMatchObject({ wikiKey: "wiki:wachturm-am-grossen-fluss" });
});

test("ohne Recht an der Geometrie lässt sich nichts ziehen und kein Knopf setzt", async ({ page }) => {
    await oeffneMitSchreiben(page, ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"]);
    await expect(zeile(page, "Wachturm am Großen Fluss")).not.toHaveAttribute("draggable", "true");
    await expect(fenster(page).locator('[data-testid$="-zeile-griff"]')).toHaveCount(0);
    await zeile(page, "Wachturm am Großen Fluss").click();
    await expect(fenster(page).locator('[data-testid$="-setzen"]')).toHaveCount(0);
});

test("🔴 „✚ Neuer Ort“ in der Leiste der Liste: Name, Ortsgröße, Art; ohne Lage angelegt, er steht unter „Nicht auf der Karte“", async ({
    page,
}) => {
    const gesendet = await oeffneMitSchreiben(page, RECHTE);
    await fenster(page).locator('[data-testid$="-leiste-neu"]').click();
    const formular = fenster(page).locator('form[data-testid$="-neu"]');
    await expect(formular.locator('[data-testid$="-neu-lage"]')).toHaveText("Nicht auf der Karte");
    const anlegen = formular.locator('[data-testid$="-neu-anlegen"]');
    await expect(anlegen).toBeDisabled();

    /*
     * 🔴 Der Satz, warum es nicht geht, steht UNTER der Knopfreihe (Betreiber 2026-10-13: „ja, der satz unter die
     * knöpfe“). `AvmKnopf` setzt ihn sonst neben den Knopf, und zwischen „Anlegen“ und „Abbrechen“ las er sich wie ein
     * Trenner. Geprüft wird die LAGE, nicht die Reihenfolge im Baum: Nur sie ist das, was der Betreiber sieht.
     */
    const satz = formular.locator('[data-testid="sperrgrund"]');
    await expect(satz).toHaveText("Ein Ort braucht einen Namen.");
    const abbrechen = formular.locator('[data-testid$="-neu-abbrechen"]');
    const [oben, unten, satzKasten] = await Promise.all([
        anlegen.boundingBox(),
        abbrechen.boundingBox(),
        satz.boundingBox(),
    ]);
    expect(satzKasten!.y).toBeGreaterThanOrEqual(oben!.y + oben!.height);
    expect(satzKasten!.y).toBeGreaterThanOrEqual(unten!.y + unten!.height);
    // Die Hausregel bleibt vollständig: Der Knopf zeigt auf den Satz und trägt ihn als `title` (Guide §7, §13.11).
    await expect(anlegen).toHaveAttribute("title", "Ein Ort braucht einen Namen.");
    const beschrieben = await anlegen.getAttribute("aria-describedby");
    expect(beschrieben).toBe(await satz.getAttribute("id"));
    await formular.locator('[data-testid$="-neu-name"] input').fill("Neu-Weiler");
    // Mit Namen geht der Knopf, und der Satz verschwindet.
    await expect(satz).toHaveCount(0);
    await expect(anlegen).toBeEnabled();
    await formular.locator('[data-testid$="-neu-art"] input').fill("Weiler");
    await formular.locator('[data-testid$="-neu-anlegen"]').click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toMatchObject({ name: "Neu-Weiler", subtype: "dorf", kind: "Weiler" });
    expect(gesendet[0]).not.toHaveProperty("position");
    await expect(page.getByText("Neu-Weiler angelegt, unter „Nicht auf der Karte“.")).toBeVisible();
    await expect(formular).toHaveCount(0);
});

test("🔴 „✚ Neuer Ort“ trägt ALLE Felder der Eigenschaften, und nur die ausgefüllten reisen mit (Betreiber 2026-10-13)", async ({
    page,
}) => {
    const gesendet = await oeffneMitSchreiben(page, RECHTE);
    await fenster(page).locator('[data-testid$="-leiste-neu"]').click();
    const formular = fenster(page).locator('form[data-testid$="-neu"]');

    /*
     * Dieselben Felder in derselben Folge wie „Eigenschaften › Identität“, dazu die sechs Merkmale.
     * 🪤 Die Texte tragen `-neu-text-…`, nicht `-neu-…`: Die Zeile mit der Lage hieß schon `-neu-lage`, und zwei
     * Elemente mit derselben Endung lassen jeden `$=`-Treffer mehrdeutig werden (gemessen: strict mode violation).
     * 🪤 `AvmEingabe` hängt die Kennung an eine Hülle, `AvmTextbereich` und `AvmKaestchen` an das Feld selbst.
     */
    for (const feld of ["einwohner", "oberhaupt", "lage"])
        await expect(formular.locator(`[data-testid$="-neu-text-${feld}"] input`)).toHaveCount(1);
    for (const feld of ["name", "art"])
        await expect(formular.locator(`[data-testid$="-neu-${feld}"] input`)).toHaveCount(1);
    await expect(formular.locator('textarea[data-testid$="-neu-text-description"]')).toHaveCount(1);
    for (const merkmal of ["ruined", "hidden", "seaport", "nodix", "underground", "withdrawn"])
        await expect(formular.locator(`input[data-testid$="-neu-${merkmal}"]`)).toHaveCount(1);

    await formular.locator('[data-testid$="-neu-name"] input').fill("Neu-Vollsatz");
    await formular.locator('[data-testid$="-neu-text-einwohner"] input').fill("1.200");
    await formular.locator('textarea[data-testid$="-neu-text-description"]').fill("Ein Posten an der Furt.");
    await formular.locator('input[data-testid$="-neu-seaport"]').check();
    await formular.locator('[data-testid$="-neu-anlegen"]').click();

    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toMatchObject({
        name: "Neu-Vollsatz",
        subtype: "dorf",
        einwohner: "1.200",
        description: "Ein Posten an der Furt.",
        seaport: true,
    });
    // 🪤 Nur das Ausgefüllte reist mit: Ein leeres Feld ist kein Wert, und ein nicht gesetztes Merkmal ist keine Angabe.
    for (const feld of ["kind", "lage", "oberhaupt", "ruined", "hidden", "nodix", "underground", "withdrawn"])
        expect(gesendet[0]).not.toHaveProperty(feld);
});

test("🔴 eine Wahl in der Liste schließt ein offenes „Neuer Ort“: leer sofort, mit Eintrag erst nach Rückfrage (Betreiber 2026-10-12)", async ({
    page,
}) => {
    // Betreiber: „komisch ist außerdem dass es kein namen hat obwohl es einen namen hat“ (rechts „Neuer Ort“, links ein Ort gewählt).
    await oeffneMitSchreiben(page, RECHTE);
    const titel = fenster(page).locator(".avm-fenster__titel");
    const formular = fenster(page).locator('form[data-testid$="-neu"]');
    await zeile(page, "Gratenfels").click();
    await expect(titel).toHaveText("Orte bearbeiten · Gratenfels");
    await fenster(page).locator('[data-testid$="-leiste-neu"]').click();
    await expect(formular).toBeVisible();
    // Dieselbe Zeile noch einmal: Das leere Formular geht, der Ort steht da.
    await zeile(page, "Gratenfels").click();
    await expect(formular).toHaveCount(0);
    await expect(titel).toHaveText("Orte bearbeiten · Gratenfels");

    // Mit Eintrag fragt es erst; „Weiter anlegen“ behält das Formular samt Name, „Verwerfen“ zeigt den gewählten Ort.
    await fenster(page).locator('[data-testid$="-leiste-neu"]').click();
    await formular.locator('[data-testid$="-neu-name"] input').fill("Valis Heimat");
    await zeile(page, "Ferdok").click();
    const frage = fenster(page).locator('[data-testid$="-neu-verwerfen"]');
    await expect(frage).toBeVisible();
    await frage.getByRole("button", { name: "Weiter anlegen" }).click();
    await expect(frage).toHaveCount(0);
    await expect(formular.locator('[data-testid$="-neu-name"] input')).toHaveValue("Valis Heimat");
    await zeile(page, "Ferdok").click();
    await frage.getByRole("button", { name: "Verwerfen" }).click();
    await expect(formular).toHaveCount(0);
    await expect(titel).toHaveText("Orte bearbeiten · Ferdok");
});

test("🔴 „Hier hinzufügen › Neuer Ort“ im Kontextmenü (Untermenü wie Legacy): das Formular trägt die angeklickte Lage, angelegt mit ihr", async ({
    page,
}) => {
    const gesendet = await oeffneMitSchreiben(page, RECHTE);
    // Bei 1280 × 720 deckt der angedockte Ortseditor fast die ganze Karte: zu, dann eine leere Stelle im Meer.
    await fenster(page).getByTestId("fenster-schliessen").click();
    await expect(fenster(page)).toHaveCount(0);
    await showPlace(page, { x: 120, y: 520 }, 6);
    await clickMap(page, await freieStelle(page), { button: "right" });
    // „Neuer Ort“ steht im Untermenü von „Hier hinzufügen“: zu, bis man auf den Eintrag zeigt (Legacy :hover).
    await expect(page.getByTestId("context-editor-neuer-ort")).toBeHidden();
    await page.getByTestId("context-editor-hier-hinzufuegen").hover();
    const unter = page.getByTestId("context-editor-hier-hinzufuegen-unter");
    await expect(unter).toBeVisible();
    // „Neue Fläche ›“ zuerst wie im Probierblatt Landschaften (WI-0178 A4), ein Untermenü der Ebenen (T47). Keine Kreuzung, kein freies
    // Label (Betreiber 2026-10-17: „kein freies label, keine kreuzung, beides gibts nicht mehr bei uns“). In der Ansicht Standard nach
    // „Neuer Weg“ „Neuer Fluss/Bach ›“ (WI-0177; Betreiber 2026-10-19: „hier hinzufügen in standard und in landschaft“), „Neues
    // Herrschaftsgebiet“ (WI-0209 C3) und „Neue Kraftlinie“; „Neuer Kraftlinienpunkt“ steht nur in der Ansicht Kraftlinien (WI-0205,
    // Hier hinzufügen je Ansicht).
    await expect(unter.getByRole("menuitem")).toHaveText([
        /Neue Fläche/,
        /Neuer Ort$/,
        /Neuer Weg$/,
        /Neuer Fluss\/Bach/,
        /Neues Herrschaftsgebiet$/,
        /Neue Kraftlinie$/,
    ]);
    // „Neuer Weg“ zeichnet ab dieser Stelle (WI-0177).
    await expect(page.getByTestId("context-editor-neuer-weg")).toBeEnabled();
    // Rechts daneben, wie Legacy.
    const opener = await page.getByTestId("context-editor-hier-hinzufuegen").boundingBox();
    const blatt = await unter.boundingBox();
    expect(blatt!.x).toBeGreaterThan(opener!.x + opener!.width - 20);
    await page.getByTestId("context-editor-neuer-ort").click();
    const formular = fenster(page).locator('form[data-testid$="-neu"]');
    await expect(formular.locator('[data-testid$="-neu-lage"]')).not.toHaveText("Nicht auf der Karte");
    await formular.locator('[data-testid$="-neu-name"] input').fill("Neu am Meer");
    await formular.locator('[data-testid$="-neu-anlegen"]').click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]).toMatchObject({
        name: "Neu am Meer",
        position: { x: expect.any(Number), y: expect.any(Number) },
    });
    await expect(page.getByText("Neu am Meer angelegt.")).toBeVisible();
});

test("„Hier hinzufügen“ mit der Tastatur: → öffnet das Untermenü, ← kehrt zurück", async ({ page }) => {
    await oeffneMitSchreiben(page, RECHTE);
    await fenster(page).getByTestId("fenster-schliessen").click();
    await expect(fenster(page)).toHaveCount(0);
    await showPlace(page, { x: 120, y: 520 }, 6);
    await clickMap(page, await freieStelle(page), { button: "right" });
    const opener = page.getByTestId("context-editor-hier-hinzufuegen");
    // Das Menü setzt den Fokus auf den ersten Eintrag; das öffnet das Untermenü nicht von selbst.
    await expect(opener).toBeFocused();
    await expect(page.getByTestId("context-editor-hier-hinzufuegen-unter")).toBeHidden();
    await page.keyboard.press("ArrowRight");
    // Der erste Eintrag des Untermenüs: „Neue Fläche ›“, seit dem Zeichnen frei (WI-0178 C3, T47); vorher sprang der Fokus über die
    // gesperrte Zeile auf „Neuer Ort“.
    await expect(page.getByTestId("context-editor-neue-flaeche")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(opener).toBeFocused();
    await expect(page.getByTestId("context-editor-hier-hinzufuegen-unter")).toBeHidden();
});

test("am Telefon steht das Untermenü von „Hier hinzufügen“ im Menü unter dem Eintrag (Legacy bis 640 px); ein Tippen öffnet es", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await oeffneMitSchreiben(page, RECHTE);
    if (await fenster(page).count()) {
        await fenster(page).getByTestId("fenster-schliessen").click();
        await expect(fenster(page)).toHaveCount(0);
    }
    // Schmal decken Editorpanel und Routenplaner die Karte: ihre Laschen klappen sie zu.
    if (await page.getByTestId("editor-panel").isVisible()) await page.getByTestId("editor-panel-tab").click();
    const planer = page.getByTestId("route-planner-tab");
    if ((await planer.getAttribute("aria-expanded")) === "true") await planer.click();
    await showPlace(page, { x: 120, y: 520 }, 6);
    await clickMap(page, await freieStelle(page), { button: "right" });
    const opener = page.getByTestId("context-editor-hier-hinzufuegen");
    await opener.click();
    const unter = page.getByTestId("context-editor-hier-hinzufuegen-unter");
    await expect(unter).toBeVisible();
    // Das Untermenü steht in der Karte der Editoren (zwei Karten, EDIT-0003 T3), nicht in der der Besucher darunter.
    const kasten = (await page.getByTestId("context-editor").boundingBox())!;
    const blatt = (await unter.boundingBox())!;
    expect(blatt.x + blatt.width).toBeLessThanOrEqual(kasten.x + kasten.width + 1);
    expect(blatt.y).toBeGreaterThan((await opener.boundingBox())!.y);
});
