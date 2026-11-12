import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Die Leiste jeder Liste am Telefon (`controls/avm-listenleiste.vue`, Design Guide §13.45; Koordination 2026-10-12 nach dem Bild der
 * Medienleiste: Trichter und Sortierung standen höher als Suche und Segmente, die Suche war ein Feld nur mit der Lupe).
 *
 * - Alle Steuerelemente einer Leiste sind gleich hoch, am Finger 44 px.
 * - Passt nicht einmal „Suchen …“ neben die Zeichen, ist die Suche ein Lupen-Knopf derselben Größe. Ein Tipp öffnet das Feld über die
 *   ganze Zeile, die Zeichen weichen; ✕ und Esc leeren und schließen, Eingabe oder ein Tipp daneben schließen und behalten den Text.
 *   Ein gesetzter Suchtext markiert die Lupe wie gesetzte Filter den Trichter.
 *
 * Die Leiste steht hier allein auf der Seite, mit Trichter, Sortierung und zwei Segmentgruppen wie in der Medienverwaltung (eine eigene
 * Vue-App aus derselben Vue-Quelle wie die Seite), damit die Breite fest ist und keine Datenbank nötig ist.
 */

type Vue = {
    createApp: (wurzel: unknown) => { mount: (element: Element) => void };
    h: (...args: unknown[]) => unknown;
    ref: <T>(wert: T) => { value: T };
};

const PLATZHALTER = "Name, Datei oder Quelle suchen";

async function baue(page: Page, breite: number, segmente: boolean): Promise<void> {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
        async ({ breite, segmente, platzhalter }) => {
            const quelle = await (await fetch("/src/controls/avm-listenleiste.vue")).text();
            const url = /from\s+"(\/node_modules\/\.vite\/deps\/vue\.js\?v=[^"]+)"/.exec(quelle)?.[1];
            if (url === undefined) throw new Error("Vue-Quelle der Seite nicht gefunden");
            const laden = async (pfad: string): Promise<unknown> =>
                ((await import(/* @vite-ignore */ pfad)) as Record<string, unknown>)["default"];
            const vue = (await import(/* @vite-ignore */ url)) as Vue;
            const [leiste, filter, menue, gruppe] = await Promise.all(
                ["avm-listenleiste", "avm-filterknopf", "avm-menueknopf", "avm-segmente"].map((name) =>
                    laden(`/src/controls/${name}.vue`),
                ),
            );
            const platz = document.createElement("div");
            Object.assign(platz.style, {
                position: "fixed",
                top: "120px",
                left: "14px",
                width: `${String(breite)}px`,
                zIndex: "2147483647",
                background: "var(--color-panel)",
            });
            document.body.append(platz);
            const esc = { n: 0 };
            document.addEventListener("keydown", (event) => {
                if (event.key === "Escape") esc.n += 1;
            });
            (globalThis as Record<string, unknown>)["__escAmDokument"] = esc;
            const suche = vue.ref("");
            const ansicht = vue.ref("raster");
            const bild = vue.ref("fuellen");
            const segment = (testid: string, wert: { value: string }, optionen: string[]): unknown =>
                vue.h(gruppe, {
                    options: optionen.map((value) => ({ value, label: value.slice(0, 1).toUpperCase() })),
                    label: testid,
                    testid,
                    modelValue: wert.value,
                    "onUpdate:modelValue": (neu: string) => {
                        wert.value = neu;
                    },
                });
            vue.createApp({
                render: () => [
                    vue.h(
                        leiste,
                        {
                            platzhalter,
                            beschriftung: "Medien durchsuchen",
                            testid: "probe-leiste",
                            modelValue: suche.value,
                            "onUpdate:modelValue": (neu: string) => {
                                suche.value = neu;
                            },
                        },
                        {
                            default: () => [
                                vue.h(filter, {
                                    abschnitte: [
                                        {
                                            id: "art",
                                            titel: "Art",
                                            art: "mehrere",
                                            werte: [
                                                { wert: "a", text: "Wappen" },
                                                { wert: "b", text: "Ortsansicht" },
                                            ],
                                        },
                                    ],
                                    wahl: {},
                                    testid: "probe-filter",
                                }),
                                vue.h(
                                    menue,
                                    {
                                        optionen: [
                                            { wert: "name", text: "Name" },
                                            { wert: "zeit", text: "Neueste" },
                                        ],
                                        modelValue: "name",
                                        bezeichnung: "Sortierung: Name",
                                        menueBezeichnung: "Sortierung",
                                        imFenster: true,
                                        testid: "probe-sortierung",
                                    },
                                    { zeichen: () => vue.h("span", "↓") },
                                ),
                                ...(segmente
                                    ? [
                                          segment("probe-ansicht", ansicht, ["raster", "liste"]),
                                          segment("probe-bild", bild, ["fuellen", "ganz"]),
                                      ]
                                    : []),
                            ],
                        },
                    ),
                    vue.h("output", { "data-testid": "probe-wert" }, suche.value),
                ],
            }).mount(platz);
        },
        { breite, segmente, platzhalter: PLATZHALTER },
    );
}

const hoehe = async (ort: Locator): Promise<number> => (await ort.boundingBox())?.height ?? Number.NaN;

test("🔴 alle Steuerelemente der Leiste sind gleich hoch, am Finger 44 px; mit Platz ist die Suche ein Feld mit vollem Platzhalter", async ({
    page,
}) => {
    await baue(page, 384, false);
    const feld = page.getByTestId("probe-leiste-suche");
    await expect(feld).toBeVisible();
    await expect(page.getByTestId("probe-leiste-lupe")).toHaveCount(0);
    await expect(feld.locator("input")).toHaveAttribute("placeholder", PLATZHALTER);
    for (const ort of [feld, page.getByTestId("probe-filter"), page.getByTestId("probe-sortierung")]) {
        expect(await hoehe(ort)).toBeCloseTo(44, 0);
    }
});

test("🔴 zu schmal: die Suche ist ein Lupen-Knopf so groß wie die Zeichen; ein Tipp öffnet sie über die ganze Zeile", async ({
    page,
}) => {
    await baue(page, 300, true);
    const leiste = page.getByTestId("probe-leiste");
    const lupe = page.getByTestId("probe-leiste-lupe");
    const feld = page.getByTestId("probe-leiste-suche");
    await expect(lupe).toBeVisible();
    await expect(feld).toBeHidden();
    const kasten = await lupe.boundingBox();
    expect(kasten?.width).toBeCloseTo(44, 0);
    expect(kasten?.height).toBeCloseTo(44, 0);
    for (const testid of ["probe-filter", "probe-sortierung", "probe-ansicht", "probe-bild"]) {
        expect(await hoehe(page.getByTestId(testid))).toBeCloseTo(44, 0);
    }
    await expect(lupe).toHaveAttribute("aria-expanded", "false");

    await lupe.tap();
    await expect(feld).toBeVisible();
    await expect(feld.locator("input")).toBeFocused();
    await expect(lupe).toHaveAttribute("aria-expanded", "true");
    const zeile = await leiste.boundingBox();
    const offen = await feld.boundingBox();
    expect(offen?.x).toBeCloseTo(zeile?.x ?? Number.NaN, 0);
    expect(offen?.width).toBeCloseTo(zeile?.width ?? Number.NaN, 0);
    expect(offen?.height).toBeCloseTo(44, 0);
    // Auch aufgeklappt nie abgeschnitten: Das ✕ steht dort immer und nimmt Platz, also passt hier nur „Suchen …“.
    const passt = await feld.locator("input").evaluate((input: HTMLInputElement) => {
        const stil = getComputedStyle(input);
        const messer = document.createElement("canvas").getContext("2d")!;
        messer.font = stil.font;
        const frei = input.clientWidth - parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight);
        return messer.measureText(input.placeholder).width <= frei;
    });
    expect(passt).toBe(true);
    // Die Zeichen weichen, solange die Suche offen ist.
    await expect(page.getByTestId("probe-filter")).toBeHidden();
    await expect(page.getByTestId("probe-bild")).toBeHidden();
    // Leer: das ✕ steht trotzdem da und schließt.
    await page.getByRole("button", { name: "Suche schließen" }).tap();
    await expect(feld).toBeHidden();
    // Wieder da und bedienbar (nicht mehr `inert`).
    await page.getByTestId("probe-filter").tap();
    await expect(page.getByTestId("probe-filter-blatt")).toBeVisible();
});

test("🔴 die Lupe bleibt markiert, solange ein Suchtext gesetzt ist; ✕ und Esc leeren und schließen, daneben tippen behält den Text", async ({
    page,
}) => {
    await baue(page, 300, true);
    const lupe = page.getByTestId("probe-leiste-lupe");
    const feld = page.getByTestId("probe-leiste-suche");
    const eingabe = feld.locator("input");
    const wert = page.getByTestId("probe-wert");

    // Eingabe (die Taste „Suchen“ der Bildschirmtastatur) schließt und behält den Text.
    await lupe.tap();
    await eingabe.fill("gar");
    await eingabe.press("Enter");
    await expect(feld).toBeHidden();
    await expect(wert).toHaveText("gar");
    await expect(lupe).toHaveClass(/is-aktiv/u);
    await expect(lupe).toHaveAttribute("aria-label", "Medien durchsuchen: „gar“");

    // Wieder auf: der Text steht noch da; ✕ leert und schließt.
    await lupe.tap();
    await expect(eingabe).toHaveValue("gar");
    await page.getByRole("button", { name: "Suche leeren" }).tap();
    await expect(feld).toBeHidden();
    await expect(wert).toHaveText("");
    await expect(lupe).not.toHaveClass(/is-aktiv/u);

    // Esc leert und schließt und gehört der Suche: Das Fenster darunter bekommt es nicht.
    await lupe.tap();
    await eingabe.fill("wap");
    await eingabe.press("Escape");
    await expect(feld).toBeHidden();
    await expect(wert).toHaveText("");
    await expect(lupe).toBeFocused();
    expect(
        await page.evaluate(() => (globalThis as unknown as { __escAmDokument: { n: number } }).__escAmDokument.n),
    ).toBe(0);

    // Ein Tipp daneben schließt und behält den Text.
    await lupe.tap();
    await eingabe.fill("wap");
    await page.getByTestId("probe-wert").tap();
    await expect(feld).toBeHidden();
    await expect(wert).toHaveText("wap");
    await expect(lupe).toHaveClass(/is-aktiv/u);
});
