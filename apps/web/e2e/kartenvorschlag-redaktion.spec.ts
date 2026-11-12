import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Benachrichtigung } from "@avesmaps3d/shared";
import { stubBenachrichtigungen } from "./benachrichtigungen-stub.ts";
import {
    AUFNAHMEN,
    HAVENA,
    REDAKTION,
    VORGANG,
    datei,
    kennung,
    link,
    server,
} from "./kartenvorschlag-redaktion-stub.ts";
import { stubSitzung } from "./medien-quelle.ts";

/**
 * Die Redaktion der Kartenvorschläge am Rechner (WI-0275, Entwurf Fassung 2): Liste, Fenster, die Blätter „Annehmen“ (mit dem Ort) und „Ablehnen“, die Glocke. Seit WI-0305 (Vali 2026-11-10: „Als Eintrag der Meldungen“)
 * stehen die Vorschläge in der Liste der Meldungen, den Unterreiter „Karten“ gibt es nicht mehr. Die Antworten des Servers sind vorgegeben (keine Datenbank; die prüft
 * `apps/server/test/kartenvorschlag-annehmen.test.ts`); hier geht es darum, was die Oberfläche zeigt und was sie schickt.
 */

async function oeffneMeldungen(page: Page): Promise<void> {
    await page.goto("/edit");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    await page.getByTestId("editorpanel-reiter-community").click();
    await expect(page.getByTestId("community-meldungen")).toBeVisible();
}

test("🔴 die Meldungen tragen die Kartenvorschläge: kein Unterreiter „Karten“, die Zahl zählt sie mit, Zeile mit Kategorie Karte, Trichter, Suche und Segmente fragen beide Quellen", async ({
    page,
}) => {
    await stubSitzung(page, REDAKTION);
    await stubBenachrichtigungen(page, []);
    const antwort = await server(page, [datei(), link()]);
    await oeffneMeldungen(page);

    const unterreiter = page.getByTestId("community-unterreiter");
    await expect(unterreiter.getByTestId("community-unterreiter-kartenvorschlaege")).toHaveCount(0);
    // Was auf mich wartet (ein Vorgang ohne Zuständigkeit) und die zwei wartenden Vorschläge.
    await expect(unterreiter.getByTestId("community-unterreiter-meldungen")).toHaveText("Meldungen3");
    await expect(page.getByTestId("community-segmente-offen")).toContainText("(3)");

    const vorgang = page.getByTestId(`community-zeile-${VORGANG.nummer}`);
    await expect(vorgang).toBeVisible();
    const dateiZeile = page.getByTestId(`community-karte-zeile-${kennung(1)}`);
    await expect(dateiZeile).toContainText("Karte: Gareth, Gesamtplan");
    await expect(dateiZeile).toContainText("K-1047 · Gareth · 🖼️ JPEG-Bild");
    const linkZeile = page.getByTestId(`community-karte-zeile-${kennung(2)}`);
    await expect(linkZeile).toContainText("ohne Ort · beispielshop.example");
    await expect(linkZeile).not.toContainText("🖼️");
    await expect(page.getByTestId("community-legende")).toContainText("3");

    // Der Trichter kennt die Kategorie „Karte“ und zählt beide Vorschläge.
    await page.getByTestId("community-filter").click();
    const karte = page.getByTestId("community-filter-kategorie-karte");
    await expect(page.locator("label", { has: karte })).toHaveText(/Karte\s*2/u);
    await karte.check();
    await expect(vorgang).toHaveCount(0);
    await expect(dateiZeile).toBeVisible();
    await karte.uncheck();
    await expect(vorgang).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByTestId("community-leiste").locator("input").fill("handels");
    await expect(dateiZeile).toHaveCount(0);
    await expect(linkZeile).toBeVisible();
    expect(antwort.listen.some((suche) => suche.includes("q=handels"))).toBe(true);
    expect(antwort.vorgaenge.some((suche) => suche.includes("q=handels"))).toBe(true);

    await page.getByTestId("community-leiste").locator("input").fill("");
    await page.getByTestId("community-segmente-erledigt").click();
    await expect(page.getByTestId("community-leer")).toBeVisible();
    await expect.poll(() => antwort.listen.some((suche) => suche.includes("segment=abgelehnt"))).toBe(true);
    expect(antwort.listen.some((suche) => suche.includes("segment=angenommen"))).toBe(true);
});

test("🔴 Annehmen mit Blatt: Das Blatt nennt die Folgen, der Ort ist wählbar, ohne Ort warnt es; geschickt wird die gesehene Revision und der gewählte Ort", async ({
    page,
}) => {
    await stubSitzung(page, REDAKTION);
    await stubBenachrichtigungen(page, []);
    const antwort = await server(page, [datei()]);
    await oeffneMeldungen(page);

    await page.getByTestId(`community-karte-zeile-${kennung(1)}`).click();
    const fenster = page.getByTestId("community-karte-fenster");
    await expect(fenster).toBeVisible();
    await expect(page.getByTestId("community-karte-zustand")).toHaveText(/wartet auf die Redaktion/u);
    await expect(page.getByTestId("community-karte-format")).toHaveText("🖼️ JPEG-Bild");
    await expect(page.getByTestId("community-karte-medien")).toHaveText("→ In der Medienverwaltung öffnen");
    await expect(page.getByTestId("community-karte-vorschau").locator("img")).toBeVisible();
    await expect(page.getByTestId("community-karte-angaben")).toContainText("Unbekannt:");
    await expect(page.getByTestId("community-karte-angaben")).toContainText("Spoiler");

    await page.getByTestId("community-karte-vorschau").click();
    await expect(page.getByTestId("community-karte-bildansicht")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("community-karte-bildansicht")).toBeHidden();

    await page.getByTestId("community-karte-annehmen").click();
    const blatt = page.getByTestId("community-karte-blatt-annehmen");
    await expect(blatt).toBeVisible();
    await expect(page.getByTestId("community-karte-fuss")).toHaveCount(0);
    await expect(page.getByTestId("community-karte-blatt-satz")).toContainText("in der Kartensammlung von Gareth");
    await expect(page.getByTestId("community-karte-folgen")).toContainText("Datei als Vollkarte");
    await expect(page.getByTestId("community-karte-ortwahl-name")).toHaveText("Gareth");

    await page.getByTestId("community-karte-ortwahl-weg").click();
    await expect(page.getByTestId("community-karte-ohne-ort")).toBeVisible();
    await page.getByTestId("community-karte-ortwahl-suche").locator("input").fill("hav");
    const treffer = page.getByTestId("community-karte-ortwahl-treffer").locator("button");
    await expect(treffer).toHaveCount(1);
    await treffer.first().click();
    await expect(page.getByTestId("community-karte-ortwahl-name")).toHaveText("Havena");
    await expect(page.getByTestId("community-karte-ohne-ort")).toHaveCount(0);
    await expect(page.getByTestId("community-karte-blatt-satz")).toContainText("in der Kartensammlung von Havena");

    await page.getByTestId("community-karte-annehmen-senden").click();
    await expect(page.getByTestId("community-karte-kartensammlung")).toBeVisible();
    expect(antwort.annehmen).toHaveLength(1);
    expect(antwort.annehmen[0]).toMatchObject({ baseRevision: 3, placeId: HAVENA.id });
    await expect(page.getByTestId("community-karte-zustand")).toContainText("angenommen");
    await expect(page.getByTestId(`community-karte-zeile-${kennung(1)}`)).toHaveCount(0);
});

test("Annehmen ohne Ort schickt ausdrücklich keinen; ein Import, der gerade läuft, sagt es im Blatt und lässt alles stehen", async ({
    page,
}) => {
    await stubSitzung(page, REDAKTION);
    await stubBenachrichtigungen(page, []);
    const antwort = await server(page, [link()]);
    await oeffneMeldungen(page);
    await page.getByTestId(`community-karte-zeile-${kennung(2)}`).click();
    await expect(page.getByTestId("community-karte-link")).toHaveText(/Karte auf beispielshop\.example/u);
    await expect(page.getByTestId("community-karte-rechte")).toContainText("Bei einem Link wird nichts hochgeladen.");

    await page.getByTestId("community-karte-annehmen").click();
    await expect(page.getByTestId("community-karte-ohne-ort")).toBeVisible();
    antwort.naechsterFehler = { status: 503, code: "map_import_running" };
    await page.getByTestId("community-karte-annehmen-senden").click();
    await expect(page.getByTestId("community-karte-blatt-fehler")).toHaveText(/Ein Import schreibt gerade die Karte/u);
    await expect(page.getByTestId("community-karte-blatt-annehmen")).toBeVisible();
    expect(antwort.annehmen[0]).toMatchObject({ placeId: null });
});

/** Die Liste der Kartensammlung für die Zielwahl (WI-0287 Stufe 2): Sie liefert mehr als die Namensvettern; die Wahl zeigt nur sie. */
async function kartensammlung(page: Page): Promise<string[]> {
    const fragen: string[] = [];
    const zeile = (id: string, title: string) => ({
        id,
        title,
        art: "derographisch",
        types: ["stadtplan"],
        validFromBf: null,
        validToBf: null,
        places: 1,
        images: 1,
        publicImages: 1,
        versions: 2,
        state: "active",
        active: true,
        preview: null,
        privatePreview: null,
    });
    await page.route("**/api/editor/media/citymaps?**", async (route) => {
        fragen.push(new URL(route.request().url()).searchParams.get("q") ?? "");
        const items = [
            zeile(kennung(70), "Gareth"),
            zeile(kennung(71), "Gareth Neustadt"),
            zeile(kennung(72), "Havena"),
        ];
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ items, total: items.length, retiredTotal: 0 }),
        });
    });
    return fragen;
}

test("🔴 Annehmen als weitere Version (WI-0287 Stufe 2): ohne Ziel ein Satz, die Namensvettern des Orts, das Feld „Version“; geschickt werden Ziel und Bezeichnung, kein Ort", async ({
    page,
}) => {
    await stubSitzung(page, REDAKTION);
    await stubBenachrichtigungen(page, []);
    const antwort = await server(page, [datei()]);
    const fragen = await kartensammlung(page);
    await oeffneMeldungen(page);
    await page.getByTestId(`community-karte-zeile-${kennung(1)}`).click();
    await page.getByTestId("community-karte-annehmen").click();
    await expect(page.getByTestId("community-karte-annahme-weg-neu")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("community-karte-annahme-weg-version").click();
    await expect(page.getByTestId("community-karte-folgen")).toHaveCount(0);

    await page.getByTestId("community-karte-annehmen-senden").click();
    await expect(page.getByTestId("community-karte-ziel-fehlt")).toHaveText(
        "Es fehlt der Eintrag, zu dem die Version gehört.",
    );
    expect(antwort.annehmen).toHaveLength(0);

    const treffer = page.getByTestId("community-karte-ziel-treffer");
    await expect(treffer).toHaveCount(2);
    expect(fragen[0]).toBe("gareth");
    await treffer.filter({ hasText: "Neustadt" }).click();
    await expect(page.getByTestId("community-karte-ziel-gewaehlt")).toContainText(
        "Derographisch · Stadtplan · 2 Versionen",
    );
    await page.getByTestId("community-karte-version").locator("input").fill("Nachtausgabe");
    await expect(page.getByTestId("community-karte-blatt-version-satz")).toHaveText(
        "Die Datei wird eine weitere Version von „Gareth Neustadt“. Titel und Angaben des Eintrags bleiben.",
    );
    if (AUFNAHMEN !== undefined) await page.screenshot({ path: join(AUFNAHMEN, "karten-annahme-version.png") });
    await page.getByTestId("community-karte-annehmen-senden").click();
    await expect(page.getByTestId("community-karte-kartensammlung")).toBeVisible();
    expect(antwort.annehmen).toEqual([
        {
            operationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
            baseRevision: 3,
            targetId: kennung(71),
            versionLabel: "Nachtausgabe",
        },
    ]);
});

test("Annehmen eines Links als Version: kein Feld „Version“, der Satz nennt die Fundstellen; ein stillgelegtes Ziel sagt es im Blatt und gibt die Wahl frei", async ({
    page,
}) => {
    await stubSitzung(page, REDAKTION);
    await stubBenachrichtigungen(page, []);
    const antwort = await server(page, [link()]);
    const fragen = await kartensammlung(page);
    await oeffneMeldungen(page);
    await page.getByTestId(`community-karte-zeile-${kennung(2)}`).click();
    await page.getByTestId("community-karte-annehmen").click();
    await page.getByTestId("community-karte-annahme-weg-version").click();
    // Ohne Ort die Namensvettern des Titels („Das Neue Reich …“): keine.
    await expect(page.getByTestId("community-karte-ziel-nichts")).toHaveText("Den Namen des Eintrags suchen.");
    expect(fragen[0]).toBe("das");
    await page.getByTestId("community-karte-ziel-suche").locator("input").fill("gareth");
    await page.getByTestId("community-karte-ziel-treffer").filter({ hasText: "Havena" }).click();
    await expect(page.getByTestId("community-karte-version")).toHaveCount(0);
    await expect(page.getByTestId("community-karte-blatt-version-satz")).toHaveText(
        "Der Link des Vorschlags kommt zu den Fundstellen von „Havena“. Titel und Angaben des Eintrags bleiben.",
    );

    antwort.naechsterFehler = { status: 409, code: "citymap_target_retired" };
    await page.getByTestId("community-karte-annehmen-senden").click();
    await expect(page.getByTestId("community-karte-blatt-fehler")).toHaveText(
        "Diesen Eintrag gibt es nicht mehr, oder er ist stillgelegt. Ein anderer muss gewählt werden.",
    );
    await expect(page.getByTestId("community-karte-ziel-gewaehlt")).toHaveCount(0);
    await expect(page.getByTestId("community-karte-ziel-suche")).toBeVisible();
    expect(antwort.annehmen[0]).toMatchObject({ targetId: kennung(72), versionLabel: null });
    expect(antwort.annehmen[0]).not.toHaveProperty("placeId");
});

test("🔴 Ablehnen im Fenster öffnet das Blatt; „inzwischen geändert“ lädt neu und behält den Grund; beim zweiten Mal geht er mit der neuen Revision hinaus", async ({
    page,
}) => {
    await stubSitzung(page, REDAKTION);
    await stubBenachrichtigungen(page, []);
    const antwort = await server(page, [datei()]);
    await oeffneMeldungen(page);

    // In der Zeile der Meldungen steht kein ⊘ (WI-0305): Abgelehnt wird im Fenster.
    await expect(page.getByTestId(`community-karte-ablehnen-${kennung(1)}`)).toHaveCount(0);
    await page.getByTestId(`community-karte-zeile-${kennung(1)}`).click();
    await page.getByTestId("community-karte-ablehnen").click();
    const blatt = page.getByTestId("community-karte-blatt-ablehnen");
    await expect(blatt).toBeVisible();
    await page.getByTestId("community-karte-grund").fill("Gibt es schon");
    await expect(page.getByTestId("community-karte-grund-zahl")).toHaveText("13 / 500");

    antwort.naechsterFehler = { status: 409, code: "kartenvorschlag_conflict" };
    await page.getByTestId("community-karte-ablehnen-senden").click();
    await expect(page.getByTestId("community-karte-meldung")).toHaveText(/Inzwischen geändert/u);
    await expect(blatt).toHaveCount(0);

    await page.getByTestId("community-karte-ablehnen").click();
    await expect(page.getByTestId("community-karte-grund")).toHaveValue("Gibt es schon");
    await page.getByTestId("community-karte-ablehnen-senden").click();
    await expect(page.getByTestId("community-karte-zustand")).toContainText("abgelehnt");
    expect(antwort.ablehnen).toHaveLength(2);
    expect(antwort.ablehnen[1]).toMatchObject({ baseRevision: 4, grund: "Gibt es schon" });
    await expect(page.getByTestId("community-karte-verlauf")).toContainText("abgelehnt: „Gibt es schon“");
});

test("gesperrt heißt ein Satz: Solange die Datei geprüft wird, geht Annehmen nicht, Ablehnen schon; ein Platzhalter steht statt der Vorschau", async ({
    page,
}) => {
    await stubSitzung(page, REDAKTION);
    await stubBenachrichtigungen(page, []);
    await server(page, [datei({ zustand: "incoming", technik: "pending", vorschau: null })]);
    await oeffneMeldungen(page);
    await expect(page.getByTestId(`community-karte-zeile-${kennung(1)}`)).toContainText("Datei wird noch geprüft");
    await page.getByTestId(`community-karte-zeile-${kennung(1)}`).click();
    await expect(page.getByTestId("community-karte-platzhalter")).toHaveText(/Die Vorschau folgt/u);
    await expect(page.getByTestId("community-karte-annehmen")).toBeDisabled();
    await expect(page.getByTestId("community-karte-fuss")).toContainText("Die Datei wird noch geprüft.");
    await expect(page.getByTestId("community-karte-ablehnen")).toBeEnabled();
});

test("ein Bild, das nicht lädt (Notaus), wird zum Platzhalter, nicht zu einem zerbrochenen Bild", async ({ page }) => {
    await stubSitzung(page, REDAKTION);
    await stubBenachrichtigungen(page, []);
    await server(page, [datei()]);
    await page.route(/\/api\/editor\/media\/[0-9a-f-]{36}\/preview\//u, (route) =>
        route.fulfill({ status: 404, body: "" }),
    );
    await oeffneMeldungen(page);
    await page.getByTestId(`community-karte-zeile-${kennung(1)}`).click();
    await expect(page.getByTestId("community-karte-platzhalter")).toHaveText(/Keine Vorschau/u);
    await expect(page.getByTestId("community-karte-vorschau")).toHaveCount(0);
});

for (const [name, width, height] of [["Seitenfenster", 900, 800]] as const) {
    test(`${name}: Liste und Fenster passen in ${String(width)} px, nichts läuft waagerecht über, die Blätter bleiben bedienbar`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height });
        await stubSitzung(page, REDAKTION);
        await stubBenachrichtigungen(page, []);
        await server(page, [datei({ ort: null }), link()]);
        await page.goto("/edit");
        await expect(page.getByTestId("kopfleiste")).toBeVisible();
        const reiter = page.getByTestId("editorpanel-reiter-community");
        if (!(await reiter.isVisible())) await page.getByTestId("editor-panel-tab").click();
        await reiter.click();
        const unterreiter = page.getByTestId("community-unterreiter");
        await expect(page.getByTestId(`community-karte-zeile-${kennung(1)}`)).toBeVisible();
        const eng = await unterreiter.evaluate((el) => ({ innen: el.scrollWidth, aussen: el.clientWidth }));
        expect(eng.innen, "die Mulde läuft nicht über").toBeLessThanOrEqual(eng.aussen);
        if (AUFNAHMEN !== undefined)
            await page.screenshot({ path: join(AUFNAHMEN, `karten-${String(width)}-liste.png`) });

        await page.getByTestId(`community-karte-zeile-${kennung(1)}`).click();
        const fenster = page.getByTestId("community-karte-fenster");
        await expect(fenster).toBeVisible();
        // 🔴 Am Telefon läge es sonst hinter dem Panel: geometrisch „sichtbar“, tatsächlich verdeckt.
        const oben = await page.getByTestId("community-karte-annehmen").evaluate((knopf) => {
            const { x, y, width, height } = knopf.getBoundingClientRect();
            return document.elementFromPoint(x + width / 2, y + height / 2)?.closest("button") === knopf;
        });
        expect(oben, "der Knopf des Fensters liegt obenauf").toBe(true);
        if (AUFNAHMEN !== undefined) {
            await page.screenshot({ path: join(AUFNAHMEN, `karten-${String(width)}-fenster.png`) });
        }
        await page.getByTestId("community-karte-annehmen").click();
        await expect(page.getByTestId("community-karte-blatt-annehmen")).toBeVisible();
        await expect(page.getByTestId("community-karte-annehmen-senden")).toBeInViewport();
        const box = await fenster.boundingBox();
        expect((box?.x ?? -1) + (box?.width ?? width + 1), "das Fenster bleibt im Bild").toBeLessThanOrEqual(width);
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
        if (AUFNAHMEN !== undefined)
            await page.screenshot({ path: join(AUFNAHMEN, `karten-${String(width)}-blatt.png`) });
    });
}

test("der Kartograph sieht die Meldungen mit nur den Kartenvorschlägen und fragt keine Vorgänge", async ({ page }) => {
    await stubSitzung(page, [
        "use_editor_menu",
        "view_editor_series",
        "pin_selection",
        "view_media_private",
        "moderate_map_suggestions",
    ]);
    await stubBenachrichtigungen(page, []);
    const antwort = await server(page, [datei()]);
    await page.goto("/edit");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    await page.getByTestId("editorpanel-reiter-community").click();
    await expect(page.getByTestId("community-unterreiter").locator("button")).toHaveCount(1);
    await expect(page.getByTestId("community-unterreiter-meldungen")).toBeVisible();
    await expect(page.getByTestId(`community-karte-zeile-${kennung(1)}`)).toBeVisible();
    await expect(page.getByTestId(`community-zeile-${VORGANG.nummer}`)).toHaveCount(0);
    expect(antwort.vorgaenge, "ohne moderate_submissions keine Vorgänge").toEqual([]);
});

test("🔴 die Glocke: ein neuer Vorschlag führt zu ihm, mehrere in die Liste", async ({ page }) => {
    await stubSitzung(page, REDAKTION);
    const eintrag = (id: number, text: string): Benachrichtigung => ({
        id,
        art: "kartenvorschlag_neu",
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
    await stubBenachrichtigungen(page, [eintrag(31, kennung(1))]);
    await server(page, [datei()]);
    await page.goto("/edit");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    await page.getByTestId("glocke-knopf").click();
    await page.getByRole("button", { name: "Neuer Kartenvorschlag zum Prüfen" }).click();
    await expect(page.getByTestId("community-meldungen")).toBeVisible();
    await expect(page.getByTestId(`community-karte-zeile-${kennung(1)}`)).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("community-karte-fenster")).toBeVisible();
    await expect(page.getByTestId("community-karte-zustand")).toContainText("wartet auf die Redaktion");
});

test("🔴 Medienverwaltung › Eingänge › Kartenvorschläge (OPS-000093): dieselbe Liste, der Vorschlag mit seinem Blatt in Spalte 3, die Zahl an der Schiene folgt dem Annehmen", async ({
    page,
}) => {
    await stubSitzung(page, REDAKTION);
    await stubBenachrichtigungen(page, []);
    const antwort = await server(page, [datei(), link()]);
    await page.route("**/api/editor/media/navigation", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                total: 0,
                kinds: { image: 0, model_3d: 0 },
                types: {},
                galleries: 0,
                citymaps: 0,
                photoboxGalerien: 0,
                typeImages: 0,
                baskets: { rights_open: 0 },
            }),
        }),
    );
    await page.goto("/edit?medien&medien-objekt=kartenvorschlaege");

    const schiene = page.getByTestId("medien-arten-eintrag-objekt-kartenvorschlaege");
    await expect(schiene).toContainText("2");
    await expect(page.getByTestId("medien-spalte-vorschlaege")).toBeVisible();
    await expect(page.getByTestId("medien-vorschlag-keiner")).toBeVisible();
    // Ohne ⊘ in der Zeile: Das Blatt „Ablehnen“ liegt in Spalte 3.
    const zeile = page.getByTestId(`community-karte-zeile-${kennung(1)}`);
    await expect(zeile).toBeVisible();
    await expect(page.getByTestId(`community-karte-ablehnen-${kennung(1)}`)).toHaveCount(0);

    await zeile.click();
    await expect(page).toHaveURL(new RegExp(`medien-vorschlag=${kennung(1)}`, "u"));
    await expect(zeile).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("medien-vorschlag")).toBeVisible();
    await expect(page.getByTestId("community-karte-fenster"), "kein Werkzeugfenster der Redaktion").toHaveCount(0);
    await expect(page.getByTestId("community-karte-zustand")).toHaveText(/wartet auf die Redaktion/u);

    // Annehmen und Ablehnen sind ohne Umweg da, mit demselben Blatt wie im Werkzeugfenster.
    await page.getByTestId("community-karte-ablehnen").click();
    await expect(page.getByTestId("community-karte-blatt-ablehnen")).toBeVisible();
    await page.getByTestId("community-karte-blatt-abbrechen").click();
    await page.getByTestId("community-karte-annehmen").click();
    await expect(page.getByTestId("community-karte-blatt-annehmen")).toBeVisible();
    await page.getByTestId("community-karte-annehmen-senden").click();
    await expect(page.getByTestId("community-karte-zustand")).toHaveText(/angenommen/u);
    expect(antwort.annehmen).toHaveLength(1);
    // Die Liste lädt neu (der Vorschlag verlässt „Offen“), und die Zahl an der Schiene stimmt.
    await expect(zeile).toHaveCount(0);
    await expect(schiene).toContainText("1");
});
