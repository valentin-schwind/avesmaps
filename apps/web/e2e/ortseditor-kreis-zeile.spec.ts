import { expect, test } from "@playwright/test";
import type { EditorPlaceRow } from "@avesmaps3d/shared";
import { LISTE, fenster, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";

/**
 * Legende und Zählung der Ortsliste in EINER Zeile unter der Liste, mit vier Zuständen (WI-0187; EDIT-0003 §6, T26 (5)). Betreiber
 * 2026-10-16, wörtlich: „ich wollte dass du die legende mit der zählung kombinierst. z.B. beim Ortseditor statt Oben: ● 13 · ◐ 18 · ○ 0
 * nur Unten: platziert und dem Wiki zugewiesen ● 13 · nur im Wiki, nicht platziert ◐ 18 · platziert, ohne Wiki-Artikel ◑ 0 - nicht
 * platziert, ohne Wiki-Artikel ○ 0“.
 */

const NAMEN = [
    "platziert und dem Wiki zugewiesen",
    "nur im Wiki, nicht platziert",
    "platziert, ohne Wiki-Artikel",
    "nicht platziert, ohne Wiki-Artikel",
];
/** Zu den Zeilen der Ortsliste je ein Ort, der platziert ist, aber keinen Artikel hat, und einer ohne Lage und ohne Artikel. */
const VIER: EditorPlaceRow[] = [
    ...LISTE.rows,
    {
        key: "11111111-0000-4000-8000-0000000000aa",
        origin: "karte",
        name: "Klein-Gratenfels",
        circle: "halb",
        assignment: "none",
        subtype: "dorf",
        x: 451,
        y: 537,
    },
    {
        key: "11111111-0000-4000-8000-0000000000bb",
        origin: "ohne-lage",
        name: "Neuer Ort",
        circle: "leer",
        assignment: "none",
    },
];

test("🔴 unten EINE Zeile: Name, Kreis und Zahl je Zustand, in der Folge ● ◐ ◑ ○; oben keine Kreise", async ({
    page,
}) => {
    await oeffneOrtseditor(page, { liste: { ...LISTE, rows: VIER } });
    const legende = fenster(page).locator('[data-testid$="-orte-legende"]');
    await expect(legende).toBeVisible();
    const eintraege = legende.locator("li");
    await expect(eintraege).toHaveCount(4);
    await expect(eintraege).toHaveText(NAMEN.map((name) => new RegExp(`^${name}\\s*\\d+$`)));
    await expect(eintraege.locator(".avm-kreis")).toHaveCount(4);
    const fuellungen = await eintraege.evaluateAll((li) => li.map((el) => el.getAttribute("data-kreis")));
    expect(fuellungen).toEqual(["voll", "halb", "halb-rechts", "leer"]);
    // Unter der Liste, nicht über ihr.
    const [rumpf, unten] = [
        (await fenster(page).locator('[data-testid$="-orte-rumpf"]').boundingBox())!,
        (await legende.boundingBox())!,
    ];
    expect(unten.y).toBeGreaterThanOrEqual(rumpf.y + rumpf.height - 1);
    // Oben stehen keine Kreise mehr; ohne Suche, Trichter oder Maske auch keine Trefferzahl.
    await expect(fenster(page).locator('[data-testid$="-orte-bilanz"] .avm-kreis')).toHaveCount(0);
});

test("🔴 jede Zeile der Liste zeigt einen der vier Zustände", async ({ page }) => {
    await oeffneOrtseditor(page, { liste: { ...LISTE, rows: VIER } });
    const kreis = (name: string) => zeile(page, name).locator(".avm-kreis").first();
    await expect(kreis("Gratenfels")).toHaveAttribute("data-kreis", "voll");
    await expect(kreis("Klein-Gratenfels")).toHaveAttribute("data-kreis", "halb-rechts");
    await expect(kreis("Klein-Gratenfels")).toHaveAttribute("aria-label", "platziert, ohne Wiki-Artikel");
});

test("🔴 oben steht nur „N Treffer“, sobald die Suche die Liste ändert; die Zahlen unten zählen mit", async ({
    page,
}) => {
    await oeffneOrtseditor(page, { liste: { ...LISTE, rows: VIER } });
    await fenster(page).locator('[data-testid$="-orte-leiste-suche"] input').fill("Gratenfels");
    await expect(fenster(page).locator('[data-testid$="-orte-bilanz"]')).toHaveText(/^\s*2 Treffer\s*$/);
    const legende = fenster(page).locator('[data-testid$="-orte-legende"] li');
    await expect(legende.nth(0)).toHaveText(/1$/);
    await expect(legende.nth(2)).toHaveText(/1$/);
});
