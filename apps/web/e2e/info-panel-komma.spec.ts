import { expect, test } from "@playwright/test";
import { feldwerte, oeffneGareth, pruefeSatzzeichen, zeilen } from "./info-panel-komma.ts";

/**
 * Ein Satzzeichen hinter einem Link beginnt nie eine Zeile (Abnahmeblatt `review/bildbezug/blatt.png`): am Rechner in der Breite des
 * Panels. Das Telefon prüft `info-panel-komma.touch.spec.ts`; Messung und Daten stehen in `info-panel-komma.ts`.
 */

test("🔴 Gareth: kein Komma am Zeilenanfang des Untertitels, jedes steht direkt hinter seinem Link", async ({
    page,
}) => {
    await oeffneGareth(page);
    const untertitel = page.getByTestId("info-subtitle");
    // Der Fall des Blatts: Der erste Name bricht in sich um, und sein Kasten füllt die Breite.
    expect((await zeilen(untertitel)).length).toBeGreaterThan(3);
    await pruefeSatzzeichen(untertitel);
});

test("🔴 dieselbe Regel in der Feldliste: Gareths Verkehrswege und Lage („3, Gardel“, „Raulsmark;“)", async ({
    page,
}) => {
    await oeffneGareth(page);
    for (const wert of feldwerte(page)) {
        await expect(wert.getByTestId("info-link").first()).toBeVisible();
        await pruefeSatzzeichen(wert);
    }
});

test("sonst bleibt alles: der Text des Absatzes, die Namen der Links, das Komma in der Farbe des Textes", async ({
    page,
}) => {
    await oeffneGareth(page);
    const untertitel = page.getByTestId("info-subtitle");
    await expect(untertitel).toHaveText(
        "Metropole · Hauptstadt von Heiliges Neues Kaiserreich vom Greifenthron zu Gareth, Königreich Garetien, Kaisermark Gareth",
    );
    // Der Text eines Links ist genau sein Name, und so heißt er auch für Vorleser; das Komma gehört nicht dazu.
    await expect(untertitel.getByTestId("info-link")).toHaveText([
        "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth",
        "Königreich Garetien",
        "Kaisermark Gareth",
    ]);
    await expect(untertitel.getByRole("button", { name: "Königreich Garetien", exact: true })).toBeVisible();
    // Kopiert wird der Satz, wie er dasteht.
    const kopiert = await untertitel.evaluate((root) => {
        const selection = getSelection()!;
        selection.selectAllChildren(root);
        const text = selection.toString();
        selection.removeAllRanges();
        return text.replace(/\s+/g, " ").trim();
    });
    expect(kopiert).toContain("zu Gareth, Königreich Garetien, Kaisermark Gareth");
    const farben = await untertitel.evaluate((root) => ({
        text: getComputedStyle(root).color,
        komma: [...root.querySelectorAll("[data-tail]")].map((link) => getComputedStyle(link, "::after").color),
        name: getComputedStyle(root.querySelector(".info-link__name")!).color,
    }));
    expect(farben.komma).toEqual([farben.text, farben.text]);
    expect(farben.name).not.toBe(farben.text);
});
