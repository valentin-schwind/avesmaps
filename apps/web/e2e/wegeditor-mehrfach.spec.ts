import { expect, test, type Page, type Route } from "@playwright/test";
import { OperationReceipt, PathSammelRemovalBody, type EditorPathRow, type EditorPathStreet } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { GRATENFELS_LAGE, editorPanelVorn } from "./ortseditor-stub.ts";
import { vertragGilt } from "./vertrag.ts";
import { stubAdmin } from "./verwaltung-stub.ts";
import {
    abstand,
    gewaehltNach,
    handgriffeAuf,
    rechtsKlick,
    rueckeInDieFreieMitte,
    umschaltKlick,
    wegeDerKarte,
    type Stelle,
    type Weg,
} from "./wegeditor-mehrfach-hilfen.ts";

/**
 * Die Mehrfachauswahl der Wege (WI-0252; Betreiber 2026-10-24: „die mehrfach auswahl von wegen wär super“) und die zentrale Regel
 * „Esc und ein Klick in die Karte heben sie auf, ein Klick ins Fenster nicht“ (Betreiber 2026-10-24: „ESC soll in allen fällen
 * mehrfachauswahlen wieder aufheben, auch ein klick ins leere oder woanders muss eine mehrfachauswahl aufheben.“).
 *
 * Die Wege kommen aus den Kacheln der lokalen Karte, Liste und Straßen aus Stubs, gebaut aus dem, was gezeichnet ist. 🔴 Kein Test schreibt
 * in die Datenbank.
 *
 * Problemfälle: Der Umschalt-Klick fällt durch (Wege kannten keine Mehrfachauswahl); er hakt den Abschnitt statt der Straße an; die Liste
 * hakt nicht an; das Fenster zeigt weiter EINE Straße statt der Auswahl mit „gemischt“; der zweite Umschalt-Klick nimmt nicht heraus;
 * bleibt einer, zeigt das Fenster „Noch kein Weg offen“; auf der Karte leuchtet nur die Einzelauswahl; Esc oder ein Klick in die Karte
 * lassen die Auswahl stehen; ein Klick ins Fenster hebt sie auf.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/** Die Bilder für den Betreiber (Auftrag WI-0252): nur, wenn der Ordner genannt ist. */
const BILDER = process.env["WEGE_MEHRFACH_BILDER"];

/** Das Wege-Fenster an der Stelle Gratenfels mit allen gezeichneten Wegen in der Liste; zwei Wege, die ein Klick dort wählt. */
async function oeffne(page: Page): Promise<{ a: Weg; b: Weg; leer: Stelle | undefined; strassen: EditorPathStreet[] }> {
    await stubAdmin(page, {
        capabilities: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        role: "editor",
    });
    let liste: { rows: EditorPathRow[]; strassen: EditorPathStreet[]; wege: Weg[] } = {
        rows: [],
        strassen: [],
        wege: [],
    };
    await page.route("**/api/editor/status", (route) => json(route, { mapEditing: "testwelt" }));
    await page.route("**/api/editor/paths", (route) => json(route, { rows: liste.rows }));
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (route) => {
        const id = route.request().url().split("/").at(-2)!;
        const strasse = liste.strassen.find((s) => s.id === id || s.segments.some((a) => a.id === id));
        return strasse === undefined ? route.fulfill({ status: 404, body: "{}" }) : json(route, strasse);
    });
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/history(\?.*)?$/, (route) => json(route, { entries: [] }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) =>
        route.request().method() === "GET" ? json(route, { locks: [] }) : json(route, { lost: [] }),
    );
    await openMap(page, EDITOR_MODE);
    // Der Planer klappt zu und die Liste des Fensters ein: Sonst deckt bei 1280 px fast nichts mehr die Karte auf.
    await page.getByTestId("route-planner-tab").click();
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "false");
    await editorPanelVorn(page);
    await showPlace(page, GRATENFELS_LAGE, 7);
    await settleFrame(page);
    // Die Liste aus allem, was gezeichnet ist, und je Straße eine Stelle, solange kein Fenster etwas deckt.
    liste = await wegeDerKarte(page);
    await page.getByTestId("editorpanel-kachel-wege").click();
    await page.getByTestId("editorpanel-verb").click();
    await expect(page.locator('dialog[data-lage][open][data-testid^="wegeditor-"]')).toHaveCount(1);
    await page.locator('dialog[open][data-testid^="wegeditor-"] [data-testid$="-listenschalter"]').first().click();
    await settleFrame(page);
    // Zwei Straßen, die ein gewöhnlicher Klick an ihrer Stelle wählt: Der Besitzer entscheidet mit seinem Fangradius, nicht die Kachel;
    // wählt der Klick dort eine andere Straße mit echtem Namen, ist die Stelle eben ihre. Je Paar nahe beieinander (vor dem Fenster
    // gemessen) rückt die Karte die Mitte der beiden in die Mitte der freien Fläche.
    const echt = new Set(liste.rows.map((zeile) => `name:${zeile.name}`));
    const paare = liste.wege
        .flatMap((x, i) => liste.wege.slice(i + 1).map((y) => [x, y] as const))
        .sort(([a1, b1], [a2, b2]) => abstand(a1.stelle, b1.stelle) - abstand(a2.stelle, b2.stelle));
    const versuche: string[] = [];
    let gefunden: Weg[] = [];
    let karte = await wegeDerKarte(page);
    const runden: (readonly [Weg, Weg] | undefined)[] = [undefined, ...paare.slice(0, 4)];
    for (const paar of runden) {
        if (paar !== undefined) await rueckeInDieFreieMitte(page, paar[0], paar[1]);
        karte = await wegeDerKarte(page);
        gefunden = [];
        for (const weg of karte.wege) {
            const bekommen = await gewaehltNach(page, weg);
            versuche.push(`${weg.name} → ${String(bekommen)}`);
            if (bekommen === undefined || !echt.has(bekommen) || gefunden.some((g) => `name:${g.name}` === bekommen))
                continue;
            gefunden.push({
                name: bekommen.slice("name:".length),
                stelle: weg.stelle,
                ...(weg.ort === undefined ? {} : { ort: weg.ort }),
            });
            if (gefunden.length === 2) break;
        }
        if (gefunden.length === 2) break;
    }
    expect(gefunden, `zwei Wege mit echtem Namen, je an einer eigenen Stelle (${versuche.join("; ")})`).toHaveLength(2);
    return { a: gefunden[0]!, b: gefunden[1]!, leer: karte.leer, strassen: liste.strassen };
}

const offen = (page: Page) => page.locator('dialog[open][data-testid^="wegeditor-"]');
const schalter = (page: Page) => offen(page).locator('[data-testid$="-wege-mehrfach"]').first();
const haken = (page: Page) => offen(page).locator('[data-testid$="-wege-haken"]').first();
const sammel = (page: Page) => offen(page).locator('[data-testid$="-sammel"]').first();

/** Die Namen, die die Ebene der angehakten Wege golden zeichnet (`mehrfach-path`); ohne Ebene keine. */
async function leuchtend(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        if (map.getLayer("mehrfach-path") === undefined) return [];
        const filter = map.getFilter("mehrfach-path") as unknown[];
        const namen = (filter[1] as unknown[])[2] as unknown[];
        return (namen[1] as string[]).slice().sort();
    });
}

test("🔴 Umschalt-Klick auf einen zweiten Weg: Liste hakt an, das Fenster zeigt beide mit „gemischt“, golden auf der Karte; zweimal nimmt heraus", async ({
    page,
}) => {
    const { a, b } = await oeffne(page);
    // A gewählt (gewöhnlicher Klick): Das offene Fenster folgt ihm.
    expect(await gewaehltNach(page, a)).toBe(`name:${a.name}`);
    await expect(offen(page)).toContainText(a.name);
    await umschaltKlick(page, b);
    await expect(schalter(page)).toHaveAttribute("aria-pressed", "true");
    await expect(haken(page)).toContainText("2 angehakt");
    await expect(sammel(page)).toBeVisible();
    await expect(sammel(page).locator('[data-testid$="-sammel-zahl"]')).toHaveText("2 Wege gewählt");
    const name = sammel(page).locator('[data-testid$="-sammel-feld-name"]').locator("input").first();
    await expect(name).toHaveAttribute("placeholder", "gemischt");
    await expect(name).toBeDisabled();
    // „Name auf der Karte“ ist an den Abschnitten verschieden (Stub: jeder zweite), also gemischt.
    await expect(
        sammel(page).locator('[data-testid$="-sammel-feld-name-auf-karte"]').locator("input").first(),
    ).toHaveAttribute("placeholder", "gemischt");
    await expect(sammel(page).locator('[data-testid$="-sammel-wegkurve"]')).toBeDisabled();
    await expect.poll(() => leuchtend(page)).toEqual([a.name, b.name].sort());
    if (BILDER) await page.screenshot({ path: `${BILDER}/wege-mehrfach-1920.png` });

    // Zwei Klicks am selben Fleck binnen 400 ms sind ein Doppelklick (`object-dblclick`).
    await page.waitForTimeout(500);
    await umschaltKlick(page, b);
    await expect(haken(page)).toContainText("1 angehakt");
    // Bleibt einer, zeigt das Fenster ihn wie einzeln gewählt.
    await expect(sammel(page)).toHaveCount(0);
    await expect(offen(page).locator('[data-testid$="-eigenschaften"]').first()).toBeVisible();
    await expect(offen(page)).toContainText(a.name);
    await expect.poll(() => leuchtend(page)).toEqual([a.name]);
});

test("🔴 Esc hebt die Mehrfachauswahl auf, ein Klick in die Karte auch; ein Klick ins Fenster nicht", async ({
    page,
}) => {
    // 🔴 Dieser Fall ist lang: fünf Auswahlwechsel auf der Karte, jeder mit Pause gegen den Doppelklick und mit dem Warten auf das fertige
    // Bild (`settleFrame`), das die Kamera nach jedem Klick zu den gewählten Wegen fliegen lässt. Gemessen (2026-10-29, Rechner unter Last):
    // das Öffnen (`oeffne`) 22 bis 37 s, der Rest 24 bis 28 s, zusammen 46 bis 65 s gegen die 60 s der Vorgabe. Im Release-Test d80313c07 riss
    // er die Grenze mitten in einem `page.evaluate` (`settleFrame`) und einem `mouse.click`, ohne dass etwas hing: Mit Zeit kamen alle sechs
    // Läufe durch, und die Karte war Sekunden später wieder `loaded`. Die Zusicherungen bleiben dieselben.
    test.setTimeout(150_000);
    const { a, b } = await oeffne(page);
    expect(await gewaehltNach(page, a)).toBe(`name:${a.name}`);
    await umschaltKlick(page, b);
    await expect(haken(page)).toContainText("2 angehakt");
    // Esc mit dem Fokus auf der Karte (der Umschalt-Klick ging dorthin).
    await page.keyboard.press("Escape");
    await expect(schalter(page)).toHaveAttribute("aria-pressed", "false");
    await expect(sammel(page)).toHaveCount(0);
    await expect.poll(() => leuchtend(page)).toEqual([]);

    // Wieder an: Ein Klick ins Fenster (Kopf der Sammelansicht) lässt sie stehen.
    await page.waitForTimeout(500);
    await umschaltKlick(page, b);
    await expect(haken(page)).toContainText("2 angehakt");
    await sammel(page).locator('[data-testid$="-sammel-zahl"]').click();
    await expect(haken(page)).toContainText("2 angehakt");
    await expect(schalter(page)).toHaveAttribute("aria-pressed", "true");

    // Ein Klick ins Leere hebt sie auf.
    // Die leere Stelle erst jetzt suchen: Die Kamera ist seither zu den gewählten Wegen geflogen.
    const leer = (await wegeDerKarte(page)).leer;
    expect(leer, "eine Stelle ohne Weg und Ort").toBeDefined();
    await page.mouse.click(leer!.x, leer!.y);
    await expect(schalter(page)).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => leuchtend(page)).toEqual([]);

    // Wieder an: Ein Klick ohne Umschalt auf einen Weg ersetzt sie durch diesen einen.
    await page.waitForTimeout(500);
    expect(await gewaehltNach(page, b)).toBe(`name:${b.name}`);
    await page.waitForTimeout(500);
    await umschaltKlick(page, a);
    await expect(haken(page)).toContainText("2 angehakt");
    await page.waitForTimeout(500);
    expect(await gewaehltNach(page, a)).toBe(`name:${a.name}`);
    await expect(schalter(page)).toHaveAttribute("aria-pressed", "false");
    await expect(offen(page)).toContainText(a.name);
    await expect.poll(() => leuchtend(page)).toEqual([]);
});

/**
 * „Wege verbinden ›“ im Kartenmenü (WI-0252; Betreiber 2026-10-24: „beim rechtsklick über "Weg entfernen" die menü option "Wege
 * verbinden" … ähnlich wie bei "wegkurve bearbeiten" kann ich dann im untermenü auswählen wessen abschnittseinstellungen dann übernommen
 * werden sollen“). Die Prüfung und der Schreibweg kommen aus Stubs; ob es im Netz verlustfrei geht, prüft
 * `apps/server/test/editor-path-verbinden.test.ts`. Problemfälle: Der Eintrag fehlt, steht nicht direkt über „Weg entfernen“, hat kein
 * Untermenü; das Zeigen lässt nichts leuchten; die Wahl schickt nicht die Vorlage; geht es nicht, steht er nicht grau mit dem Grund.
 */
for (const groesse of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
]) {
    test.describe(`Wege verbinden bei ${String(groesse.width)} px`, () => {
        test.use({ viewport: groesse });

        test("🔴 zwei Wege angehakt: „Wege verbinden ›“ direkt über „Weg entfernen“, das Untermenü nennt die Abschnitte und lässt sie leuchten; die Wahl ist die Vorlage", async ({
            page,
        }) => {
            const { a, b, strassen } = await oeffne(page);
            const abschnitte = (name: string) => strassen.find((s) => s.name === name)?.segments.map((x) => x.id) ?? [];
            const kette = [...abschnitte(a.name), ...abschnitte(b.name)];
            let geht = true;
            await page.route(/\/api\/editor\/paths\/verbinden\?ids=/, (route) =>
                json(
                    route,
                    geht
                        ? { geht: true, kette: kette.map((publicId) => ({ publicId, umgedreht: false })) }
                        : { geht: false, grund: "netz" },
                ),
            );
            const gesendet: { vorlage?: string; sections: { publicId: string }[] }[] = [];
            await page.route("**/api/editor/paths/verbinden", (route) => {
                const body = route.request().postDataJSON() as {
                    operationId: string;
                    vorlage?: string;
                    sections: { publicId: string }[];
                };
                gesendet.push(body);
                return json(route, {
                    operationId: body.operationId,
                    status: "applied",
                    environment: "development",
                    affected: [],
                    derivedWork: [],
                    warnings: [],
                    mapRevision: 4253,
                    publicId: body.vorlage,
                });
            });
            expect(await gewaehltNach(page, a)).toBe(`name:${a.name}`);
            await page.waitForTimeout(500);
            await umschaltKlick(page, b);
            await expect(haken(page)).toContainText("2 angehakt");
            await page.waitForTimeout(500);
            await rechtsKlick(page, a);
            await handgriffeAuf(page);
            const eintrag = page.getByTestId("context-editor-weg-verbinden");
            await expect(eintrag).toBeVisible();
            await expect(eintrag).toContainText("Wege verbinden");
            // Direkt über „Weg entfernen“: der nächste Eintrag im Menü.
            const folge = await page
                .locator('[data-testid^="context-editor-weg-"]:not([data-testid*="#"]):not([data-testid$="-unter"])')
                .evaluateAll((knoten) => knoten.map((k) => k.getAttribute("data-testid")));
            expect(folge.indexOf("context-editor-weg-entfernen")).toBe(
                folge.indexOf("context-editor-weg-verbinden") + 1,
            );
            await eintrag.hover();
            const unter = page.getByTestId("context-editor-weg-verbinden-unter");
            await expect(unter).toBeVisible();
            await expect(unter.getByRole("menuitem")).toHaveCount(kette.length);
            const erster = page.getByTestId(`context-editor-weg-verbinden#${kette[0]!}`);
            await expect(erster).toContainText(`1 · ${a.name}`);
            await erster.hover();
            await expect
                .poll(() =>
                    page.evaluate(() => {
                        const map = globalThis.avesmapsMap!;
                        return map.getLayer("weg-abschnitte-hervor") === undefined
                            ? ""
                            : JSON.stringify(map.getFilter("weg-abschnitte-hervor"));
                    }),
                )
                .toContain(kette[0]!);
            if (BILDER) await page.screenshot({ path: `${BILDER}/wege-verbinden-menue-${String(groesse.width)}.png` });
            await erster.click();
            await expect.poll(() => gesendet.length).toBe(1);
            expect(gesendet[0]!.vorlage).toBe(kette[0]);
            expect(gesendet[0]!.sections.map((x) => x.publicId).sort()).toEqual([...kette].sort());
            await expect(page.getByText("sind jetzt ein Abschnitt")).toBeVisible();

            // Geht es nicht, steht der Eintrag grau mit dem Grund (ohne Untermenü).
            geht = false;
            await page.waitForTimeout(500);
            expect(await gewaehltNach(page, a)).toBe(`name:${a.name}`);
            await page.waitForTimeout(500);
            await umschaltKlick(page, b);
            await expect(haken(page)).toContainText("2 angehakt");
            await page.waitForTimeout(500);
            await rechtsKlick(page, a);
            await handgriffeAuf(page);
            const grau = page.getByTestId("context-editor-weg-verbinden");
            await expect(grau).toBeDisabled();
            await expect(grau).toHaveAttribute("title", /durchgehender Weg/);
        });
    });
}

/**
 * „Weg entfernen …“ an der Mehrfachauswahl (WI-0252; Betreiber 2026-10-25 auf der Stage: „entfernen -> ganz löschen geht noch nicht mit
 * mehrfachauswahl“). Die Schreibwege kommen aus Stubs; den echten Schreibweg prüft `apps/server/test/editor-path-split.test.ts`.
 * Problemfälle: „Weg entfernen …“ im Kartenmenü löscht nur den Abschnitt unter dem Rechtsklick und lässt den zweiten angehakten Weg
 * stehen; das Blatt nennt nicht die Zahl der Wege; „Ganz löschen“ schickt mehrere Operationen oder nicht alle Abschnitte beider Wege;
 * „Von der Karte nehmen“ geht in der Sammelansicht nicht; danach steht die Mehrfachauswahl weiter.
 */
for (const groesse of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
]) {
    test.describe(`Weg entfernen an der Mehrfachauswahl bei ${String(groesse.width)} px`, () => {
        test.use({ viewport: groesse });

        test("🔴 zwei Wege angehakt: „Weg entfernen …“ im Kartenmenü öffnet EIN Blatt für beide, „Ganz löschen“ schickt EINE Operation über alle ihre Abschnitte; „Von der Karte nehmen“ geht aus der Sammelansicht", async ({
            page,
        }) => {
            const { a, b, strassen } = await oeffne(page);
            const abschnitte = (name: string) => strassen.find((s) => s.name === name)?.segments.map((x) => x.id) ?? [];
            const alle = [...abschnitte(a.name), ...abschnitte(b.name)].sort();
            const gesendet: { art: string; sections: { publicId: string; baseRevision: number }[] }[] = [];
            for (const [muster, art] of [
                ["delete", "loeschen"],
                ["take-off-map", "abnehmen"],
            ] as const)
                await page.route(`**/api/editor/paths/sammel/${muster}`, (route) => {
                    // Was die Oberfläche schickt, muss der Server annehmen (Schema der Route: höchstens 500 Abschnitte, nur Kennung und
                    // Revision), und die Antwort hat die Form der Quittung.
                    const body = vertragGilt(
                        PathSammelRemovalBody,
                        route.request().postDataJSON(),
                        "Die Anfrage der Oberfläche",
                    );
                    gesendet.push({ art, sections: body.sections });
                    return json(
                        route,
                        vertragGilt(
                            OperationReceipt,
                            {
                                operationId: body.operationId,
                                status: "applied",
                                environment: "development",
                                affected: [],
                                derivedWork: [],
                                warnings: [],
                                mapRevision: 4254,
                            },
                            "Die Antwort des Stubs",
                        ),
                    );
                });
            const zweiAngehakt = async (): Promise<void> => {
                await page.waitForTimeout(500);
                expect(await gewaehltNach(page, a)).toBe(`name:${a.name}`);
                await page.waitForTimeout(500);
                await umschaltKlick(page, b);
                await expect(haken(page)).toContainText("2 angehakt");
                await page.waitForTimeout(500);
            };

            // 1. Kartenmenü: Rechtsklick auf den ersten Weg, „Weg entfernen …“.
            await zweiAngehakt();
            await rechtsKlick(page, a);
            await handgriffeAuf(page);
            const eintrag = page.getByTestId("context-editor-weg-entfernen");
            await expect(eintrag).toBeVisible();
            await eintrag.click();
            const blatt = page.getByTestId("weg-entfernen");
            await expect(blatt).toBeVisible();
            // Das Blatt nennt die Zahl der Wege, der Knopf die Handlung mit der Zahl.
            await expect(blatt).toContainText("2 Wege gewählt");
            await expect(page.getByTestId("weg-entfernen-los")).toBeDisabled();
            await page.getByTestId("weg-entfernen-loeschen").click();
            await expect(page.getByTestId("weg-entfernen-los")).toHaveText("2 Wege ganz löschen");
            if (BILDER)
                await page.screenshot({ path: `${BILDER}/wege-entfernen-auswahl-${String(groesse.width)}.png` });
            expect(gesendet).toEqual([]);
            await page.getByTestId("weg-entfernen-los").click();
            await expect.poll(() => gesendet.length).toBe(1);
            // EINE Operation über alle Abschnitte beider Wege, jeder gegen seine frisch gelesene Revision.
            expect(gesendet[0]!.art).toBe("loeschen");
            expect(gesendet[0]!.sections.map((x) => x.publicId).sort()).toEqual(alle);
            expect(gesendet[0]!.sections.every((x) => x.baseRevision === 1)).toBe(true);
            await expect(page.getByText("2 Wege gelöscht")).toBeVisible();
            // Danach ist die Mehrfachauswahl aus.
            await expect(blatt).toBeHidden();
            await expect(schalter(page)).toHaveAttribute("aria-pressed", "false");
            await expect(offen(page).locator('[data-testid$="-sammel"]')).toHaveCount(0);

            // 2. Sammelansicht: „Weg entfernen …“, „Von der Karte nehmen“.
            await zweiAngehakt();
            const knopf = offen(page).locator('[data-testid$="-sammel-entfernen"]').first();
            await expect(knopf).toBeEnabled();
            await knopf.click();
            await expect(blatt).toContainText("2 Wege gewählt");
            await page.getByTestId("weg-entfernen-abnehmen").click();
            await expect(page.getByTestId("weg-entfernen-los")).toHaveText("2 Wege von der Karte nehmen");
            await page.getByTestId("weg-entfernen-los").click();
            await expect.poll(() => gesendet.length).toBe(2);
            expect(gesendet[1]!.art).toBe("abnehmen");
            expect(gesendet[1]!.sections.map((x) => x.publicId).sort()).toEqual(alle);
            await expect(page.getByText("2 Wege von der Karte genommen")).toBeVisible();
        });
    });
}
