import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
    WETTER_SYMBOL_VORGABEN,
    WIKI_ART_WIND,
    wetterWikiAdresse,
    type EditorLandscapeList,
    type EditorWikiEintrag,
    type WetterWikiArtikel,
} from "@avesmaps3d/shared";
import { LISTE, KOSCH, landmarkenStub } from "./landmarken-stub.ts";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";
import { stubWetter } from "./wetter-stub.ts";

/**
 * Abnahmebilder zu WI-0288 Stufe 6, Wiki-Winde „leicht, im Derographie-Zug“ (nur, wenn jemand die Datei nennt): die Liste der Derographie mit dem Filter „Wind“ und das Icon-Detail im Wetter-Editor mit
 * gesetztem Wiki-Artikel, dazu der Namensvorschlag. 1600 × 900. Die Bilder landen in `WETTER_FOTOS` (sonst unter `test-results/`). Geprüft wird hier nichts; das tun `wettereditor.spec.ts` und die
 * Vitest-Fälle (`wetter-wiki.test.ts`). 🔴 Nichts Schreibendes erreicht einen Server: Liste und Wetter kommen aus Nachbauten. Titel und Regionen der Einträge sind die des Wikis, Texte stehen keine darin.
 */

test.use({ viewport: { width: 1600, height: 900 } });
test.setTimeout(180_000);

const ORDNER = process.env["WETTER_FOTOS"] ?? join("test-results", "wetter-wiki");
mkdirSync(ORDNER, { recursive: true });

const eintrag = (nummer: number, titel: string, art: string, region?: string): EditorWikiEintrag => ({
    id: `b9288000-0000-4000-8000-${String(nummer).padStart(12, "0")}`,
    titel,
    name: titel,
    layer: "derographisch",
    art,
    ...(region === undefined ? {} : { region }),
    wikiUrl: wetterWikiAdresse(titel),
});

const EINTRAEGE: EditorWikiEintrag[] = [
    eintrag(1, "Beleman", WIKI_ART_WIND, "Aventurische Westküste"),
    eintrag(2, "Firunsatem", WIKI_ART_WIND, "Nördliches Aventurien"),
    eintrag(3, "Harunka", WIKI_ART_WIND, "West-Aventurien"),
    eintrag(4, "Rastullahs Atem", WIKI_ART_WIND, "Khôm, Perlenmeer"),
    eintrag(5, "Ghibli", WIKI_ART_WIND),
    eintrag(6, "Brabakdrift", "Meeresströmung", "Südmeer"),
    eintrag(7, "Ch'Rabka", "Mahlstrom (Strömung)", "Charyptik"),
];

const ARTIKEL: WetterWikiArtikel[] = [
    ...EINTRAEGE.map((e) => ({
        titel: e.titel,
        art: e.art!,
        ...(e.region ? { region: e.region } : {}),
        wikiUrl: e.wikiUrl,
    })),
    { titel: "Pailischer Mahlstrom", art: "Mahlstrom", wikiUrl: wetterWikiAdresse("Pailischer Mahlstrom") },
].sort((a, b) => a.titel.localeCompare(b.titel, "de"));

async function nichtsSchreibendes(page: Page): Promise<void> {
    await page.route("**/api/**", (route) =>
        route.request().method() === "GET" ? route.fallback() : route.fulfill({ status: 204, body: "" }),
    );
}

test("Derographie: die Liste mit dem Filter „Wind“", async ({ page }) => {
    await nichtsSchreibendes(page);
    await landmarkenStub(page);
    const liste: EditorLandscapeList = { ...LISTE, wikiEintraege: EINTRAEGE };
    await page.route("**/api/editor/landscapes", (route: Route) =>
        route.request().method() === "GET"
            ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(liste) })
            : route.fulfill({ status: 204, body: "" }),
    );
    await openMap(page, `${EDITOR_MODE}#x=${String(KOSCH.x)}&y=${String(KOSCH.y)}&z=5&view=landscapes&layer=alle`);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    const fenster = page.locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]');
    await expect(fenster.getByRole("option", { name: /Beleman/ })).toBeVisible();
    await page.locator('[data-testid$="-landschaften-filter"]').click();
    await page.locator('[data-testid$="-landschaften-filter-flaechenart"]').getByText("Wind", { exact: true }).click();
    // Landmarken tragen keine Flächenart und blieben stehen (Regel der gemeinsamen Liste); „Flächen“ nimmt sie heraus.
    await page.locator('[data-testid$="-landschaften-filter-maske"]').getByText("Flächen", { exact: true }).click();
    await settleFrame(page);
    await page.screenshot({ path: join(ORDNER, "derographie-filter-wind-offen.png") });
    await page.keyboard.press("Escape");
    await expect(fenster.getByRole("option")).toHaveCount(5);
    await settleFrame(page);
    await page.screenshot({ path: join(ORDNER, "derographie-liste-wind.png") });
});

test("Wetter-Editor: Icon-Detail mit gesetztem Wiki-Artikel und Namensvorschlag", async ({ page }) => {
    await nichtsSchreibendes(page);
    await stubWetter(page, { wiki: ARTIKEL });
    await stubAdmin(page, { capabilities: ["use_editor_menu", "edit_weather"], role: "editor" });
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-wetter").click();
    await page.getByTestId("editorpanel-verb").click();
    const liste = page.locator('[data-testid^="wettereditor-"][data-testid$="-liste"]').first();
    await expect(liste).toBeVisible();
    const fenster = page.locator(".avm-fenster").filter({ has: liste });
    await fenster
        .locator('[data-testid$="-wetter-zeile"]')
        .filter({ hasText: WETTER_SYMBOL_VORGABEN[0]!.name! })
        .first()
        .click();
    const feld = fenster.locator('[data-testid$="-wiki"]');
    await feld.locator('[data-testid$="-wiki-suche"] input').click();
    await expect(feld.locator('[data-testid$="-wiki-treffer"]').first()).toBeVisible();
    await settleFrame(page);
    await page.screenshot({ path: join(ORDNER, "icon-wiki-suche.png") });
    await feld.locator('[data-testid$="-wiki-suche"] input').fill("bel");
    await feld.locator('[data-testid$="-wiki-treffer"]').filter({ hasText: "Beleman" }).click();
    await expect(feld.locator('[data-testid$="-wiki-artikel"]')).toContainText("Beleman");
    await settleFrame(page);
    await page.screenshot({ path: join(ORDNER, "icon-wiki-gesetzt.png") });
    await fenster.locator('[data-testid$="-name"] input').fill("");
    await expect(feld.locator('[data-testid$="-wiki-namensvorschlag"]')).toBeVisible();
    await settleFrame(page);
    await page.screenshot({ path: join(ORDNER, "icon-wiki-namensvorschlag.png") });
});
