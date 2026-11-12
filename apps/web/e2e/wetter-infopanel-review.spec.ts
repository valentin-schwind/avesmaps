import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { MEDIA_TYPE_IMAGES_URL, WETTER_SYMBOL_VORGABEN, type MamTypeImageList } from "@avesmaps3d/shared";
import { openMap } from "./map-handle.ts";
import {
    MIT_MEDIEN,
    bedieneMedienrouten,
    medienQuelle,
    schliesseMedienQuelle,
    stubSitzung,
    type MedienQuelle,
} from "./medien-quelle.ts";
import { iconMitte, stubWetterInfopanel, zuIcon, type ProbeArtikel } from "./wetter-infopanel-stub.ts";

/**
 * Abnahmebilder zum Infopanel der Wetter-Icons (WI-0288; Betreiber 2026-11-08: „ja infopanel bauen“; nur, wenn jemand die Datei nennt): je ein Panel eines Winds, eines Wirbels,
 * einer Meeresströmung und eines Mahlstroms, dazu die Medienverwaltung „Typbilder“ mit den vier neuen Kategorien. 1600 × 900, mit echter Grafikkarte (die Icons stehen nur, solange
 * das Wetter läuft). Die Bilder landen in `WETTER_FOTOS` (sonst unter `test-results/`). Geprüft wird hier nichts; das tun `wetter-infopanel.spec.ts` und die Vitest-Fälle.
 *
 * 🔴 Nichts Schreibendes erreicht einen Server. Wetter und Detailantworten kommen aus Nachbauten (erfundene Artikel und Texte); die Typbilder rechnet die Abfrage des Servers
 * DIESES Checkouts (`typeImageList`) gegen die Entwicklungsdatenbank, nur lesend, wie `medien-quelle.ts` es für die Medienverwaltung tut.
 */

test.use({
    viewport: { width: 1600, height: 900 },
    launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] },
});
test.setTimeout(300_000);

const ORDNER = process.env["WETTER_FOTOS"] ?? join("test-results", "wetter-infopanel");
mkdirSync(ORDNER, { recursive: true });

const [WIND, , , , WIRBEL, , , MAHLSTROM_WIRBEL, , , , , STROM] = WETTER_SYMBOL_VORGABEN;

const VERWEISE: Readonly<Record<string, ProbeArtikel>> = {
    [WIND!.id]: {
        titel: "Probewind (Wind)",
        art: "Wind",
        region: "Probeküste, Westliches Probemeer",
        beschreibung: "Ein erfundener Westwind für die Abnahme: Er weht beständig von der offenen See auf die Küste.",
    },
    [WIRBEL!.id]: {
        titel: "Probesturm",
        art: "Wind",
        region: "Östliches Probemeer",
        beschreibung: "Ein erfundener Wirbelsturm für die Abnahme, der im Spätsommer über das Meer zieht.",
    },
    [STROM!.id]: {
        titel: "Probestrom",
        art: "Meeresströmung",
        region: "Probegolf",
        beschreibung: "Eine erfundene Meeresströmung für die Abnahme.",
    },
    [MAHLSTROM_WIRBEL!.id]: {
        titel: "Probestrudel",
        art: "Mahlstrom",
        region: "Südliches Probemeer",
        beschreibung: "Ein erfundener Mahlstrom für die Abnahme.",
    },
};

async function panelFoto(page: Page, symbol: (typeof WETTER_SYMBOL_VORGABEN)[number], datei: string): Promise<void> {
    await zuIcon(page, symbol);
    const mitte = await iconMitte(page, symbol.id);
    await page.mouse.click(mitte.x, mitte.y);
    await expect(page.getByTestId("info-title")).toHaveText(symbol.name!);
    await expect(page.getByTestId("info-header-image")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(ORDNER, datei) });
}

test("Infopanel: Wind, Wirbel, Meeresströmung, Mahlstrom", async ({ page }) => {
    await stubWetterInfopanel(page, VERWEISE);
    await openMap(page);
    await panelFoto(page, WIND!, "infopanel-wind.png");
    await panelFoto(page, WIRBEL!, "infopanel-wirbel.png");
    await panelFoto(page, STROM!, "infopanel-meeresstroemung.png");
    await panelFoto(page, MAHLSTROM_WIRBEL!, "infopanel-mahlstrom.png");
});

let quelle: MedienQuelle | undefined;
test.afterAll(async () => {
    await schliesseMedienQuelle();
});

test("Medienverwaltung: Typbilder mit Wind, Wirbelsturm, Meeresströmung und Mahlstrom", async ({ page }) => {
    quelle = await medienQuelle();
    test.skip(quelle === undefined, "ohne DATABASE_URL keine echten Medien");
    const { typeImageList } = (await import(
        pathToFileURL(resolve(import.meta.dirname, "../../../apps/server/src/media-editor/type-images.ts")).href
    )) as { typeImageList(db: unknown): Promise<MamTypeImageList> };
    await page.route("**/api/**", (route) =>
        route.request().method() === "GET" ? route.fallback() : route.fulfill({ status: 204, body: "" }),
    );
    await stubSitzung(page, MIT_MEDIEN);
    await bedieneMedienrouten(page, quelle!);
    const liste = await typeImageList(quelle!.db);
    await page.route(`**${MEDIA_TYPE_IMAGES_URL}`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(liste) }),
    );
    // Je Bild die gewählte Kategorie und ihre Nachbarn in der Mitte der Liste: Mahlstrom, Meer, Meeresströmung; Weg, Wind, Wirbelsturm.
    for (const [kategorie, mitte] of [
        ["mahlstrom", "Meer"],
        ["wind", "Wind"],
    ] as const) {
        await openMap(page, `/edit?medien&medien-objekt=typbilder&medien-kategorie=${kategorie}`);
        const fenster = page.getByTestId("medien-fenster");
        await fenster.waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(2500);
        await fenster
            .getByText(mitte, { exact: true })
            .first()
            .evaluate((zeile) => zeile.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(ORDNER, `typbilder-${kategorie}.png`) });
    }
});
