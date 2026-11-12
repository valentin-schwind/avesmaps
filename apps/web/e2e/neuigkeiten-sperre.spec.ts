import { expect, test } from "@playwright/test";
import type { NewsPflege } from "@avesmaps3d/shared";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Ein gesperrter Speicherknopf der Neuigkeiten nennt seinen Grund (Guide §7; Hauptorchestrierung 2026-10-19: „Die zehn gesperrten Knöpfe
 * brauchen ihren Grund am Knopf“). Problemfall: Seit `AvmKnopf` ein `disabled` des Aufrufers achtet, stand der leere Editor mit zwei grauen
 * Knöpfen ohne Satz da.
 */
const PFLEGE: NewsPflege = { entwuerfe: 0, eintraege: [], papierkorb: [], stage: null };

test("🔴 der leere Editor nennt die leeren Felder, EINMAL für beide Knöpfe, und gibt sie frei, sobald alles da ist", async ({
    page,
}) => {
    await stubAdmin(page, {
        capabilities: [...ADMIN_CAPABILITIES, "manage_news"],
        role: "operator",
        answer: (call) => (call.path.startsWith("/api/admin/system/news") ? { status: 200, body: PFLEGE } : undefined),
    });
    await page.goto("/?verwaltung=neuigkeiten");
    await page.getByTestId("news-neu").click();

    const editor = page.getByTestId("news-editor");
    const veroeffentlichen = page.getByTestId("news-editor-veroeffentlichen");
    const entwurf = page.getByTestId("news-editor-entwurf");
    const satz = editor.getByTestId("sperrgrund");
    await expect(satz).toHaveCount(1);
    await expect(satz).toHaveText("Noch nicht ausgefüllt: Titel und Text.");
    for (const knopf of [veroeffentlichen, entwurf]) {
        await expect(knopf).toBeDisabled();
        await expect(knopf).toHaveAttribute("title", "Noch nicht ausgefüllt: Titel und Text.");
    }

    await page.getByTestId("news-editor-titel").fill("Neu auf der Karte");
    await expect(satz).toHaveText("Noch nicht ausgefüllt: Text.");

    await page.getByTestId("news-editor-text").fill("Ein Satz.");
    await expect(satz).toHaveCount(0);
    await expect(veroeffentlichen).toBeEnabled();
    await expect(entwurf).toBeEnabled();
});
