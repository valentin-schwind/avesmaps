import { expect, test, type Page } from "@playwright/test";
import { EDITORPANEL, kinder, type EditorLandscapeList } from "@avesmaps3d/shared";
import { EDITOR_MODE, GARETH, openMap, showPlace } from "./map-handle.ts";
import { LISTE, ORTSEDITOR_RECHTE, editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Das Editorpanel am echten Stack (WI-0128 E3, EDIT-0001 §7.1 E3): zwei Laschen, ein Slot, eins offen; es meldet sich als Rand
 * und ist zu `inert`; der Weg Editor → Karteninhalte → Orte → „⚙ Orte bearbeiten“ steht nach dem Neuladen wieder da; ein Tiefer
 * Link schlägt das Gemerkte; die Adresszeile bleibt; ohne Speicher geht es weiter. Reviewer („nur lesen“) prüft
 * `editor-panel-nav.test.ts`, das Telefon `editor-panel.touch.spec.ts`.
 *
 * 🪤 Bis Stufe A fertig ist, gibt es das Panel nur im Entwicklungsbuild; dieser Test läuft gegen Vite und sieht es.
 * 🪤 Und seit `3c75c88d` („ohne Anmeldung überall die Besucheransicht“) braucht es dazu eine Sitzung mit `use_editor_menu` -
 * ohne sie gab es das Panel gar nicht mehr, und vier Tests waren rot. Die Sitzung wird deshalb hier gestellt, wie in
 * `ortseditor-stub.ts`.
 */

/** Eine gestellte Editor-Sitzung mit den Rechten des Ortseditors; `moderate_submissions` ist bewusst NICHT dabei. */
const alsEditor = (page: Page): Promise<unknown> =>
    stubAdmin(page, { capabilities: ORTSEDITOR_RECHTE, role: "editor" });

const lasche = (page: Page) => page.getByTestId("editor-panel-tab");
const editor = (page: Page) => page.getByTestId("editor-panel");
const info = (page: Page) => page.getByTestId("info-panel");
/** Die Kachel eines Karteninhalts (WI-0212). */
const kachel = (page: Page, id: string) => page.getByTestId(`editorpanel-kachel-${id}`);
/** Die Ansicht der Karte, wie die Adresse sie trägt (`#view=…`). */
const ansicht = async (page: Page): Promise<string | null> =>
    new URLSearchParams((await page.evaluate(() => globalThis.location.hash)).slice(1)).get("view");

async function clickGareth(page: Page): Promise<void> {
    await showPlace(page, GARETH, 5);
    const at = await page.evaluate((target) => {
        const map = globalThis.avesmapsMap!;
        const point = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(target));
        const box = map.getCanvas().getBoundingClientRect();
        return { x: box.left + point.x, y: box.top + point.y };
    }, GARETH);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
}

/** Der rechte Rand, auf den die Kamera zielt (`visible-area.ts`; bis WI-0218 MapLibres `padding`). */
const rechterRand = (page: Page): Promise<number> =>
    page.evaluate(() => globalThis.avesmapsVisibleArea!.insets().right);

test("🔴 zwei Laschen, ein Slot, eins offen - und nur das vordere meldet sich als Rand", async ({ page }) => {
    await alsEditor(page);
    await openMap(page, EDITOR_MODE);
    await expect(lasche(page)).toBeVisible();
    // 🔴 Am Rechner steht es beim Laden offen (Betreiber 2026-10-14: „im editor-modus [soll] das editor-panel auftauchen. IMMER,
    // wenn ein editor eingeloggt ist“, `dd9f7476`). Zugeklappt beginnt der Weg, den dieser Test geht.
    await expect(editor(page)).toBeVisible();
    await lasche(page).click();
    await expect(editor(page)).toBeHidden();
    await expect(editor(page)).toHaveAttribute("inert", "");
    await expect(editor(page)).toHaveAttribute("data-map-overlay", "right");

    await clickGareth(page);
    await expect(info(page)).toBeVisible();

    await lasche(page).click();
    await expect(editor(page)).toBeVisible();
    await expect(editor(page)).not.toHaveAttribute("inert", "");
    await expect(info(page)).toBeHidden();
    await expect(info(page)).toHaveAttribute("inert", "");
    // Die Kamera hält die Breite des Panels frei (gemessen, nicht angenommen).
    const breite = (await editor(page).boundingBox())!.width;
    await expect.poll(() => rechterRand(page)).toBe(Math.round(breite));

    // Die Lasche „Info“ holt das Infopanel nach vorn; die Auswahl blieb die ganze Zeit.
    await page.getByTestId("info-panel-tab").click();
    await expect(info(page)).toBeVisible();
    await expect(editor(page)).toBeHidden();
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");

    // Editor auf und wieder zu: Der Slot klappt zu, das Infopanel steht eingeklappt dahinter.
    await lasche(page).click();
    await lasche(page).click();
    await expect(editor(page)).toBeHidden();
    await expect(info(page)).toBeHidden();
    await expect(page.getByTestId("info-panel-tab")).toBeVisible();
    await expect.poll(() => rechterRand(page)).toBe(0);
});

test("🔴 der Weg Editor → Karteninhalte → Orte → „⚙ Orte bearbeiten“ steht nach dem Neuladen wieder da, die Adresse bleibt", async ({
    page,
}) => {
    await alsEditor(page);
    await openMap(page, EDITOR_MODE);
    const adresse = page.url();
    await editorPanelVorn(page);

    // Was die Sitzung darf, sagt der Server; „Community“ braucht `moderate_submissions`, das hat nicht jede Sitzung.
    const rechte = await page.evaluate(async () => {
        const antwort = await fetch("/api/auth/session");
        const body = (await antwort.json()) as { capabilities?: string[] };
        return body.capabilities ?? [];
    });
    await expect(page.getByTestId("editorpanel-reiter-karteninhalte")).toHaveAttribute("aria-selected", "true");
    // „Änderungen“ ist seit E17 wählbar (editor-aenderungen.spec … ortseditor-verlauf.spec.ts); der Start bleibt „Karteninhalte“.
    await expect(page.getByTestId("editorpanel-reiter-aenderungen")).not.toHaveAttribute("aria-disabled", "true");
    // „Status“ ist seit WI-0138 (Besucherstatistik) ein eigener Bereich und nicht mehr gesperrt; der Start bleibt „Karteninhalte“.
    await expect(page.getByTestId("editorpanel-reiter-status")).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("editorpanel-reiter-community")).toHaveCount(
        rechte.includes("moderate_submissions") ? 1 : 0,
    );
    // „Community“ ist seit WI-0268 C3 wählbar (Unterreiter „Meldungen“; Mails, Bewertungen und Social Hub folgen) und nicht mehr „später“.
    if (rechte.includes("moderate_submissions"))
        await expect(page.getByTestId("editorpanel-reiter-community")).not.toHaveAttribute("aria-disabled", "true");
    await expect(kachel(page, "orte")).toHaveAttribute("aria-current", "true");
    // Seit WI-0178 A3 öffnet „Landschaften“ den Landschaftseditor (landschaftseditor.spec.ts), seit WI-0205 K2 „Kraftlinien“ den
    // Kraftlinien-Editor (kraftlinieneditor.spec.ts). Was gebaut ist, sagt das Register.
    await expect(kachel(page, "regionen")).not.toHaveAttribute("aria-disabled", "true");
    await expect(kachel(page, "kraftlinien")).not.toHaveAttribute("aria-disabled", "true");
    for (const eintrag of kinder(EDITORPANEL, "karteninhalte", rechte)) {
        if (eintrag.art === "spaeter") await expect(kachel(page, eintrag.id)).toHaveAttribute("aria-disabled", "true");
        else await expect(kachel(page, eintrag.id)).not.toHaveAttribute("aria-disabled", "true");
    }
    // Das Verb steht da und öffnet seit E6 den Ortseditor (ortseditor.spec.ts).
    const verb = page.getByTestId("editorpanel-verb");
    await expect(verb).toContainText("Orte bearbeiten");
    await expect(verb).toBeEnabled();
    // Ohne Schreibrecht öffnet es „nur lesen“ und sagt es in der zweiten Zeile.
    const schreibt = rechte.includes("edit_map_objects");
    await expect(verb).toHaveAttribute("data-modus", schreibt ? "bearbeiten" : "lesen");
    if (!schreibt) await expect(verb).toContainText("nur lesen");
    await expect(page.getByTestId("editorpanel-abgleiche")).toBeDisabled();
    // 🔴 Keine Ortsliste im Editorpanel (D18).
    await expect(editor(page).getByRole("listbox")).toHaveCount(0);

    await expect(page.getByTestId("editorpanel-reiter-karteninhalte")).toHaveAttribute("aria-selected", "true");

    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(editor(page)).toBeVisible();
    await expect(kachel(page, "orte")).toHaveAttribute("aria-current", "true");
    // Pfad und Query schreibt das Panel nie (Legacy-Policy 2026-07-06). Der Hash gehört der Ansicht der Karte: Er folgt der
    // Mitte, die sich mit dem offenen Panel in die freie Fläche verschiebt.
    const ohneHash = (url: string): string => url.split("#")[0]!;
    expect(ohneHash(page.url())).toBe(ohneHash(adresse));
});

test("🔴 ein Tiefer Link öffnet das Panel, auch wenn es zuletzt zu war - und bleibt in der Adresse, wie er kam", async ({
    page,
}) => {
    await page.addInitScript(() => {
        try {
            localStorage.setItem("avesmaps3d.panel.editorpanel", "zu");
        } catch {
            // ohne Speicher: dann prüft der Test nur den Link
        }
    });
    await alsEditor(page);
    await openMap(page, `${EDITOR_MODE}?reviewTab=wiki-sync`);
    await expect(editor(page)).toBeVisible();
    await expect(page.getByTestId("editorpanel-reiter-karteninhalte")).toHaveAttribute("aria-selected", "true");
    expect(new URL(page.url()).searchParams.get("reviewTab")).toBe("wiki-sync");
});

test("🔴 wirft der Speicher, geht das Panel trotzdem", async ({ page }) => {
    await page.addInitScript(() => {
        const original = { get: Storage.prototype.getItem, set: Storage.prototype.setItem };
        Storage.prototype.getItem = function (key: string) {
            if (key.startsWith("avesmaps3d.")) throw new Error("gesperrt");
            return original.get.call(this, key);
        };
        Storage.prototype.setItem = function (key: string, value: string) {
            if (key.startsWith("avesmaps3d.")) throw new Error("gesperrt");
            original.set.call(this, key, value);
        };
    });
    const fehler: string[] = [];
    page.on("pageerror", (error) => fehler.push(error.message));
    await alsEditor(page);
    await openMap(page, EDITOR_MODE);
    // Ohne Speicher gilt die Vorgabe: am Rechner offen (`dd9f7476`). Zu und wieder auf geht trotzdem.
    await expect(editor(page)).toBeVisible();
    await expect(kachel(page, "orte")).toHaveAttribute("aria-current", "true");
    await lasche(page).click();
    await expect(editor(page)).toBeHidden();
    await lasche(page).click();
    await expect(editor(page)).toBeVisible();
    expect(fehler).toEqual([]);
});

test("ohne Editor-Modus und mit `?besucher` gibt es kein Editorpanel", async ({ page }) => {
    await alsEditor(page);
    await openMap(page, "/");
    await expect(lasche(page)).toHaveCount(0);
    await openMap(page, `${EDITOR_MODE}?besucher`);
    await expect(lasche(page)).toHaveCount(0);
});

/** Drei Landschaften in drei Zuständen (wie `landschaftseditor.spec.ts`): ●, ◑, ◐. */
const LANDSCHAFTEN = {
    rows: [
        {
            id: "a3a3a3a3-0000-4000-8000-000000000001",
            name: "Gratenfelser Becken",
            layer: "topographie",
            circle: "voll",
        },
        {
            id: "a3a3a3a3-0000-4000-8000-000000000002",
            name: "Vorgebirge des Kosch",
            layer: "topographie",
            circle: "halb-rechts",
        },
        { id: "a3a3a3a3-0000-4000-8000-000000000003", name: "Nordmarken", layer: "derographisch", circle: "halb" },
    ],
} as unknown as EditorLandscapeList;

test("🔴 Kacheln (WI-0212, EDIT-0003 T37): zwei Gruppen in zwei Spalten, Zahl je Inhalt; die Wahl stellt die Ansicht ohne Flug und zeigt den Steckbrief", async ({
    page,
}) => {
    await alsEditor(page);
    // Die Ortsliste der Tests: Gratenfels und Ferdok ●, eine Stätte und ein Turm nur im Wiki ◐ (`kreisVon`).
    await page.route("**/api/editor/places", (route) => route.fulfill({ json: LISTE }));
    await page.route("**/api/editor/landscapes", (route) => route.fulfill({ json: LANDSCHAFTEN }));
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);

    // Zwei Gruppen mit Köpfen, die Kacheln in der Folge des Registers.
    const gruppe = (id: string) => page.getByTestId(`editorpanel-gruppe-${id}`);
    await expect(gruppe("karte").locator("h3")).toHaveText("Auf der Karte");
    await expect(gruppe("nachschlagen").locator("h3")).toHaveText("Nachschlagen");
    const folge = (id: string) =>
        gruppe(id)
            .locator(".kachel")
            .evaluateAll((kacheln) =>
                kacheln.map((el) => el.getAttribute("data-testid")?.replace("editorpanel-kachel-", "")),
            );
    // „Sprachen“ kam mit dem Spracheditor dazu (WI-0261) und steht im Register hinter „Kraftlinien“.
    expect(await folge("karte")).toEqual(["orte", "territorien", "regionen", "wege", "kraftlinien", "sprachen"]);
    // „Quellen“ und „Korpora“ kamen mit dem Fenster „Inhalte bearbeiten“ dazu (WI-0254, ee8b8f783) und stehen im Register hinter „Vorkommen“.
    expect(await folge("nachschlagen")).toEqual(["literatur", "vorkommen", "quellen", "korpora"]);
    // Zwei Spalten: die ersten beiden Kacheln stehen nebeneinander.
    const [eins, zwei] = [
        (await kachel(page, "orte").boundingBox())!,
        (await kachel(page, "territorien").boundingBox())!,
    ];
    expect(Math.abs(eins.y - zwei.y)).toBeLessThan(1);
    expect(zwei.x).toBeGreaterThan(eins.x + eins.width - 1);

    // Namen, Zahl, „später“; die Zahlen kommen, sobald der Reiter zu sehen ist.
    await expect(kachel(page, "territorien")).toContainText("Herrschaftsgebiete");
    await expect(kachel(page, "orte")).toContainText("4 Einträge");
    await expect(kachel(page, "regionen")).toContainText("Derographie");
    await expect(kachel(page, "regionen")).toContainText("3 Einträge");
    // Die vier Nachschlagewerke sind seit WI-0254 gebaut (ihre Zahl prüft `karteninhalte-zahlen.test.ts`).
    for (const id of ["literatur", "vorkommen", "quellen", "korpora"])
        await expect(kachel(page, id)).not.toContainText("später");

    // Der Steckbrief der Orte: Name, Ansicht, Verb, Legende mit Zählung wie unter der Ortsliste.
    const steckbrief = page.getByTestId("editorpanel-steckbrief");
    const legende = page.getByTestId("editorpanel-legende").locator("li");
    await expect(steckbrief.locator("h3")).toHaveText("Orte");
    await expect(page.getByTestId("editorpanel-steckbrief-ansicht")).toHaveText("Ansicht Standard");
    await expect(steckbrief.getByTestId("editorpanel-verb")).toContainText("Orte bearbeiten");
    await expect(legende).toHaveText([
        /^platziert und dem Wiki zugewiesen\s*2$/,
        /^nur im Wiki, nicht platziert\s*2$/,
        /^platziert, ohne Wiki-Artikel\s*0$/,
        /^nicht platziert, ohne Wiki-Artikel\s*0$/,
    ]);

    // 🔴 Die Ansicht folgt der Wahl, ohne Flug: Landschaften → „Landschaften“, Orte → „Standard“.
    await expect.poll(() => ansicht(page)).toBe("standard");
    const vorher = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        return { ...map.getCenter(), zoom: map.getZoom() };
    });
    await kachel(page, "regionen").click();
    await expect(kachel(page, "regionen")).toHaveAttribute("aria-current", "true");
    await expect(kachel(page, "orte")).not.toHaveAttribute("aria-current", "true");
    await expect.poll(() => ansicht(page)).toBe("landscapes");
    await expect(steckbrief.locator("h3")).toHaveText("Derographie");
    await expect(page.getByTestId("editorpanel-steckbrief-ansicht")).toHaveText("Ansicht Derographie");
    await expect(steckbrief.getByTestId("editorpanel-verb")).toContainText("Derographie bearbeiten");
    await expect(legende).toHaveText([
        /zugewiesen\s*1$/,
        /nicht platziert\s*1$/,
        /Wiki-Artikel\s*1$/,
        /Wiki-Artikel\s*0$/,
    ]);
    const nachher = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        return { ...map.getCenter(), zoom: map.getZoom(), bewegt: map.isMoving() };
    });
    expect(nachher).toEqual({ ...vorher, bewegt: false });

    await kachel(page, "orte").click();
    await expect.poll(() => ansicht(page)).toBe("standard");
    await expect(steckbrief.locator("h3")).toHaveText("Orte");
});

test("🔴 die Kachel folgt der Ansicht (Betreiber 2026-10-19): ein Link mit `view=powerlines` wählt Kraftlinien, der Fächer zurück auf Standard lässt Wege stehen", async ({
    page,
}) => {
    await alsEditor(page);
    await openMap(page, `${EDITOR_MODE}#view=powerlines`);
    await editorPanelVorn(page);
    await expect(kachel(page, "kraftlinien")).toHaveAttribute("aria-current", "true");

    // Wege gewählt, die Ansicht wird Standard; der Fächer auf Landschaften wählt die Landschaftskachel, auf Kraftlinien Kraftlinien,
    // und zurück auf Standard stehen wieder die Wege.
    await kachel(page, "wege").click();
    await expect.poll(() => ansicht(page)).toBe("standard");
    await expect(kachel(page, "wege")).toHaveAttribute("aria-current", "true");
    const faecher = async (view: string): Promise<void> => {
        await page.getByTestId("fan-toggle").click();
        await page.getByTestId(`fan-view-${view}`).click();
        await expect.poll(() => ansicht(page)).toBe(view);
    };
    await faecher("landscapes");
    await expect(kachel(page, "regionen")).toHaveAttribute("aria-current", "true");
    await faecher("powerlines");
    await expect(kachel(page, "kraftlinien")).toHaveAttribute("aria-current", "true");
    await faecher("standard");
    await expect(kachel(page, "wege")).toHaveAttribute("aria-current", "true");
});
