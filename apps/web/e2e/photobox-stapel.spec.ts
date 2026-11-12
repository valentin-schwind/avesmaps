import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
    MAM_BASKETS,
    MEDIA_ASSET_TYPES,
    type Benachrichtigung,
    type MamNavigation,
    type PhotoboxStapel,
} from "@avesmaps3d/shared";
import { stubBenachrichtigungen } from "./benachrichtigungen-stub.ts";
import { MIT_MEDIEN, stubSitzung } from "./medien-quelle.ts";

/**
 * Glocke und Stapel neuer Reisebilder am Rechner (WI-0272 S3, Aufgabe 19): Der Stapel oben in Community › Meldungen (Fächer der Vorschauen, Zahl, Verweis) und der Satz in der Glocke
 * öffnen beide die Medienverwaltung im Korb „PhotoBox-Uploads“, Unterteilung Offen. Die Antworten des Servers sind vorgegeben (keine Datenbank): Was der Server rechnet, prüfen
 * `photobox-stapel.test.ts` und `photobox-glocke.test.ts`; hier geht es darum, dass die Oberfläche nur mit dem Recht fragt und zeigt und dass der Verweis den richtigen Korb setzt.
 *
 * Aufnahmen des Stapels für die Abnahme legt der Lauf nur ab, wenn `E2E_AUFNAHMEN` einen Ordner nennt.
 */

const HIER = dirname(fileURLToPath(import.meta.url));
const VORSCHAU = readFileSync(join(HIER, "..", "public", "icons", "header", "gebaeude.webp"));
const AUFNAHMEN = process.env["E2E_AUFNAHMEN"];

const asset = (n: number): string => `6dcf1e76-4c1a-4b0e-9a6e-${String(n).padStart(12, "0")}`;
const RECHTE = [...MIT_MEDIEN, "moderate_submissions"];

const json = (route: Route, status: number, body: unknown): Promise<void> =>
    route.fulfill({
        status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(body),
    });

const stapel = (offen: number, vorschauen: number): PhotoboxStapel => ({
    offen,
    vorschau: Array.from({ length: vorschauen }, (_, i) => ({
        publicId: asset(i + 1),
        url: `/api/editor/media/${asset(i + 1)}/preview/intern_photobox_2048`,
    })),
});

const neuesReisebild = (text: string | null): Benachrichtigung => ({
    id: 20,
    art: "photobox_eingang",
    von: { art: "system", id: null, name: null },
    ops: null,
    text,
    frageGeloest: false,
    erstelltAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    gelesenAt: null,
    beantwortetAt: null,
    antwort: null,
    vorgang: null,
});

interface Server {
    /** Die Abfragen des Stapels. */
    stapel: number;
    /** Die Anfragen der Liste der Medienverwaltung (nur der Query-String). */
    listen: string[];
}

/** Die Adressen der Medienverwaltung und des Community-Moduls, soweit die Oberfläche sie hier fragt. */
async function server(page: Page, antwort: PhotoboxStapel): Promise<Server> {
    const stand: Server = { stapel: 0, listen: [] };
    // Das Community-Modul ist hier nicht eingerichtet: Der Stapel steht trotzdem oben, er gehört den Reisebildern.
    await page.route("**/api/community/stand", (route) =>
        json(route, 200, { meldungen: false, mailweg: false, discord: false }),
    );
    await page.route("**/api/editor/**", async (route) => {
        const url = new URL(route.request().url());
        const pfad = url.pathname;
        if (pfad === "/api/editor/media/photobox/stapel") {
            stand.stapel += 1;
            return json(route, 200, antwort);
        }
        if (pfad === "/api/editor/media/navigation") {
            const navigation: MamNavigation = {
                total: antwort.offen,
                kinds: { image: antwort.offen, model_3d: 0 },
                types: Object.fromEntries(MEDIA_ASSET_TYPES.map((typ) => [typ, 0])) as MamNavigation["types"],
                galleries: 0,
                citymaps: 0,
                photoboxGalerien: 0,
                typeImages: 0,
                baskets: Object.fromEntries(
                    MAM_BASKETS.map((korb) => [korb, korb === "photobox_uploads" ? antwort.offen : 0]),
                ) as MamNavigation["baskets"],
                einreichungen: { offen: antwort.offen, rueckfrage: 0, erledigt: 0 },
            };
            return json(route, 200, navigation);
        }
        if (pfad === "/api/editor/media") {
            stand.listen.push(url.search);
            return json(route, 200, { items: [], total: 0, limit: 100, offset: 0 });
        }
        if (/^\/api\/editor\/media\/[0-9a-f-]{36}\/preview\/intern_photobox_2048$/u.test(pfad)) {
            return route.fulfill({ status: 200, contentType: "image/webp", body: VORSCHAU });
        }
        return json(route, 404, { error: { code: "not_found", message: "Diese Adresse gibt es nicht." } });
    });
    return stand;
}

async function oeffneCommunity(page: Page): Promise<void> {
    await page.goto("/edit");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    await page.getByTestId("editorpanel-reiter-community").click();
}

test("🔴 der Stapel steht oben in Community › Meldungen und der Verweis öffnet die Medienverwaltung im Korb PhotoBox-Uploads, Unterteilung Offen", async ({
    page,
}) => {
    await stubSitzung(page, RECHTE);
    await stubBenachrichtigungen(page, []);
    const antwort = await server(page, stapel(7, 5));
    await oeffneCommunity(page);

    const karte = page.getByTestId("photobox-stapel");
    await expect(karte).toBeVisible();
    await expect(page.getByTestId("photobox-stapel-zahl")).toHaveText("7 Reisebilder warten auf Prüfung");
    await expect(karte.locator("img")).toHaveCount(5);
    expect(antwort.stapel).toBeGreaterThanOrEqual(1);
    // Oben: Der Stapel liegt über der Leiste mit den Segmenten, nicht darunter.
    const stapelBox = await karte.boundingBox();
    const hinweis = await page.getByTestId("community-nicht-eingerichtet").boundingBox();
    expect(stapelBox !== null && hinweis !== null && stapelBox.y < hinweis.y).toBe(true);
    if (AUFNAHMEN !== undefined) await karte.screenshot({ path: resolve(AUFNAHMEN, "stapel.png") });

    await page.getByTestId("photobox-stapel-pruefen").click();
    await expect(page.getByTestId("medien-fenster")).toBeVisible({ timeout: 30_000 });
    // Der Korb ist gewählt und die Unterteilung Offen (die Vorgabe steht nicht in der Adresse).
    await expect.poll(() => page.url()).toContain("medien-korb=photobox_uploads");
    expect(page.url()).not.toContain("medien-einreichung=");
    await expect
        .poll(() =>
            antwort.listen.some(
                (query) => query.includes("basket=photobox_uploads") && query.includes("einreichung=offen"),
            ),
        )
        .toBe(true);
});

test("🔴 der Stapel ist nach der Prüfung nicht von gestern: Medienverwaltung auf und zu lädt ihn neu, ein erledigtes Reisebild verschwindet", async ({
    page,
}) => {
    await stubSitzung(page, RECHTE);
    await stubBenachrichtigungen(page, []);
    const inhalt = stapel(2, 2);
    const antwort = await server(page, inhalt);
    await oeffneCommunity(page);
    await expect(page.getByTestId("photobox-stapel-zahl")).toHaveText("2 Reisebilder warten auf Prüfung");
    const davor = antwort.stapel;

    await page.getByTestId("photobox-stapel-pruefen").click();
    await expect(page.getByTestId("medien-fenster")).toBeVisible({ timeout: 30_000 });
    // Die Redaktion gibt die wartenden Bilder frei (oder lehnt sie ab): Der Server zählt nichts mehr offen. Das Panel dahinter hat sich nicht bewegt.
    inhalt.offen = 0;
    inhalt.vorschau = [];
    await expect(page.getByTestId("photobox-stapel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("medien-fenster")).toBeHidden();
    await expect(page.getByTestId("photobox-stapel")).toHaveCount(0);
    expect(antwort.stapel).toBeGreaterThan(davor);
});

test("🔴 ohne `view_media_private` gibt es den Stapel nicht und die Seite fragt auch nicht danach", async ({
    page,
}) => {
    await stubSitzung(page, ["use_editor_menu", "view_editor_series", "moderate_submissions"]);
    await stubBenachrichtigungen(page, []);
    const antwort = await server(page, stapel(7, 5));
    await oeffneCommunity(page);
    await expect(page.getByTestId("community-nicht-eingerichtet")).toBeVisible();
    await expect(page.getByTestId("photobox-stapel")).toHaveCount(0);
    expect(antwort.stapel).toBe(0);
});

test("bei `offen = 0` gibt es keinen Stapel", async ({ page }) => {
    await stubSitzung(page, RECHTE);
    await stubBenachrichtigungen(page, []);
    const antwort = await server(page, stapel(0, 0));
    await oeffneCommunity(page);
    await expect(page.getByTestId("community-nicht-eingerichtet")).toBeVisible();
    await expect.poll(() => antwort.stapel).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("photobox-stapel")).toHaveCount(0);
});

test("🔴 die Glocke meldet „3 neue Reisebilder zur Prüfung“ und der Satz öffnet den Korb PhotoBox-Uploads, Offen", async ({
    page,
}) => {
    await stubSitzung(page, RECHTE);
    await stubBenachrichtigungen(page, [neuesReisebild("3")]);
    const antwort = await server(page, stapel(3, 3));
    await page.goto("/edit");
    await expect(page.getByTestId("glocke-zahl")).toHaveText("1");
    await page.getByTestId("glocke-knopf").click();
    const eintrag = page.getByTestId("benachrichtigung-20");
    await expect(eintrag).toContainText("3 neue Reisebilder zur Prüfung.");
    // Nie ein Name, nie eine Beschreibung: nur die Zahl.
    await expect(eintrag).not.toContainText("Alrik");
    await page.getByTestId("benachrichtigung-medien").click();
    await expect(page.getByTestId("medien-fenster")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.url()).toContain("medien-korb=photobox_uploads");
    await expect
        .poll(() =>
            antwort.listen.some(
                (query) => query.includes("basket=photobox_uploads") && query.includes("einreichung=offen"),
            ),
        )
        .toBe(true);
});

test("🔴 in der Glocke stehen die offenen Reisebilder, und ein Klick öffnet genau dieses Bild in der Medienverwaltung", async ({
    page,
}) => {
    await stubSitzung(page, RECHTE);
    await stubBenachrichtigungen(page, [neuesReisebild(null)]);
    await server(page, stapel(2, 2));
    await page.goto("/edit");
    await page.getByTestId("glocke-knopf").click();
    const eintrag = page.getByTestId("benachrichtigung-20");
    await expect(eintrag.getByTestId("benachrichtigung-bilder").getByRole("button")).toHaveCount(2);
    await expect(eintrag.locator("img").first()).toHaveJSProperty("complete", true);
    await eintrag.getByTestId(`benachrichtigung-bild-${asset(2)}`).click();
    await expect(page.getByTestId("medien-fenster")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.url()).toContain(`medien=${asset(2)}`);
    await expect.poll(() => page.url()).toContain("medien-korb=photobox_uploads");
    await expect(page.getByTestId("glocke-klappe")).toHaveCount(0);
});

test("🔴 eine gemeldete Reisebild-Meldung zeigt ihr Bild in der Glocke, ein Klick öffnet es unter „erledigt“", async ({
    page,
}) => {
    await stubSitzung(page, RECHTE);
    const gemeldet: Benachrichtigung = {
        ...neuesReisebild(null),
        id: 21,
        art: "community_neu",
        text: "COM-000123",
        bilder: [{ publicId: asset(7), url: `/api/editor/media/${asset(7)}/preview/intern_photobox_2048` }],
    };
    await stubBenachrichtigungen(page, [gemeldet]);
    await server(page, stapel(0, 0));
    await page.goto("/edit");
    await page.getByTestId("glocke-knopf").click();
    await page
        .getByTestId("benachrichtigung-21")
        .getByTestId(`benachrichtigung-bild-${asset(7)}`)
        .click();
    await expect(page.getByTestId("medien-fenster")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.url()).toContain(`medien=${asset(7)}`);
    await expect.poll(() => page.url()).toContain("medien-einreichung=erledigt");
});

test("ist nichts mehr offen, bleibt es in der Glocke beim Satz", async ({ page }) => {
    await stubSitzung(page, RECHTE);
    await stubBenachrichtigungen(page, [neuesReisebild(null)]);
    const antwort = await server(page, stapel(0, 0));
    await page.goto("/edit");
    await page.getByTestId("glocke-knopf").click();
    await expect(page.getByTestId("benachrichtigung-20")).toContainText("Neues Reisebild zur Prüfung.");
    await expect.poll(() => antwort.stapel).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("benachrichtigung-bilder")).toHaveCount(0);
});

test("ohne `view_media_private` ist der Satz in der Glocke Text, kein Verweis, und ohne Bilder", async ({ page }) => {
    await stubSitzung(page, ["use_editor_menu", "view_editor_series", "moderate_submissions"]);
    await stubBenachrichtigungen(page, [neuesReisebild(null)]);
    const antwort = await server(page, stapel(1, 1));
    await page.goto("/edit");
    await page.getByTestId("glocke-knopf").click();
    await expect(page.getByTestId("benachrichtigung-20")).toContainText("Neues Reisebild zur Prüfung.");
    await expect(page.getByTestId("benachrichtigung-medien")).toHaveCount(0);
    await expect(page.getByTestId("benachrichtigung-bilder")).toHaveCount(0);
    expect(antwort.stapel).toBe(0);
});
