import { expect, test, type Locator, type Page } from "@playwright/test";
import type { LandscapeUpdateBody } from "@avesmaps3d/shared";
import { aufSeite, gebirgeKennung, insFreie, obenAn, oeffneGebirge, probegebirge } from "./gebirge-stub.ts";
import { blutzinnenStub, KAMMHOEHEN_BILDER, zeigeKammhoehen } from "./kammhoehen-stub.ts";
import { erwarteZeichen, flussTalStub, flussZeichen, FLUSS_HOEHEN, SEE_PLATZ } from "./fluss-tal-stub.ts";

/**
 * Höhen je Punkt im Kammeditor (WI-0249 P9; Betreiber 2026-10-24: „ich will, dass kämme, nebengipfel, täler und mulden definierte höhen
 * haben. über diese eingabe sollen höhen der punkte im kammeditor einstellbar sein. cool wärs wenn im editor die punkte mit den höhen
 * beschriftet werden können“; Nachträge: nachträglich änderbar, kein Startwert (Vali wählte 2026-10-26), ↕ zieht die Höhe auf der Karte, Umschalt wählt
 * mehrere, Kammhöhe nimmt eigene Höhen verhältnisgleich mit, Esc und ein Klick ins Leere heben eine Auswahl auf). Alles aus Stubs
 * (`gebirge-stub.ts`), nichts in der Datenbank; den Schreibweg prüft `landscape-update-gebirge-netz.test.ts` als App-Rolle.
 *
 * Problemfälle: Ein neuer Punkt bekommt keine oder die falsche Höhe; das Feld zeigt eine Vorgabe als eigenen Wert; Umschalt wählt nicht
 * zusätzlich oder löscht beim zweiten Klick den Punkt (Doppelklick); Ziehen verschiebt die Karte oder den Punkt; Esc lässt einen halben
 * Zug stehen; ein Zug sind viele Schritte; die Leiste hebt die Auswahl auf; die Kammhöhe lässt eigene Höhen stehen.
 */
test.use({ viewport: { width: 1920, height: 1080 } });

const A = { x: 445, y: 510 };
const B = { x: 450, y: 520 };
const C = { x: 460, y: 530 };
const NEBEN = { x: 455, y: 512 };

/** Kämme zeichnen am Probegebirge; die Fläche mittig in der freien Fläche. */
async function kammeditor(page: Page, netz: Parameters<typeof probegebirge>[0]): Promise<LandscapeUpdateBody[]> {
    const gesendet = await oeffneGebirge(page, probegebirge(netz));
    await page.getByRole("tab", { name: "Gebirge" }).click();
    await gebirgeKennung(page, "-kaemme-zeichnen").click();
    await expect(page.getByTestId("kamm-netz-leiste")).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap!.isMoving())).toBe(false);
    await insFreie(page, { x: 453, y: 520 }, 6);
    return gesendet;
}

const feld = (page: Page) => page.getByTestId("kamm-netz-hoehe");
const klick = async (page: Page, p: { x: number; y: number }, umschalt = false) => {
    const at = await aufSeite(page, p);
    if (umschalt) await page.keyboard.down("Shift");
    await page.mouse.click(at.x, at.y);
    if (umschalt) await page.keyboard.up("Shift");
};
/** Die Höhen, die über den Punkten stehen (Quelle der Beschriftung): je Ort eine Zahl. */
const beschriftung = (page: Page) =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap! as unknown as {
            getSource(
                id: string,
            ): { serialize?(): { data?: { features?: { properties: { text: string } }[] } } } | undefined;
        };
        return (map.getSource("editor-gebirgsnetz-hoehen")?.serialize?.().data?.features ?? []).map(
            (f) => f.properties,
        );
    });

test("🔴 Startwert Kammhöhe, nachträglich ändern, Umschalt wählt mehrere; Esc und ein Klick ins Leere heben auf, die Leiste nicht", async ({
    page,
}) => {
    const gesendet = await kammeditor(page, {
        kaemme: [
            {
                punkte: [
                    [A.x, A.y],
                    [B.x, B.y],
                    [C.x, C.y],
                ],
                rang: "haupt",
            },
        ],
        nebengipfel: [{ x: NEBEN.x, y: NEBEN.y, h: null }],
    });
    // Mit vorhandenem Netz beginnt der Modus mit „Wählen“ (OPS-055); der neue Kamm braucht das Werkzeug „Kamm“.
    await expect(page.getByTestId("kamm-netz-werkzeug-waehlen")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("kamm-netz-werkzeug-kamm").click();
    // Beim Zeichnen kein Wert: Neue Punkte haben keine eigene Höhe (Vali wählte 2026-10-26, kein Startwert).
    await expect(feld(page)).toHaveValue("");
    await expect(feld(page)).toBeDisabled();
    // Rechts der Mitte, wo auch NEBEN und die leere Stelle liegen (links oben steht bei 1920 × 1080 das Fenster: 32 px je E bei Zoom 6).
    const n1 = await aufSeite(page, { x: 457, y: 518 });
    const n2 = await aufSeite(page, { x: 460, y: 515 });
    for (const p of [n1, n2])
        expect(await obenAn(page, p), `der Klick bei ${String(Math.round(p.x))}, ${String(Math.round(p.y))}`).toBe(
            "Karte",
        );
    await page.mouse.click(n1.x, n1.y);
    await page.mouse.dblclick(n2.x, n2.y);
    await expect(page.getByTestId("kamm-netz-zahl")).toHaveAttribute("aria-label", /Kämme 2/);

    await page.getByTestId("kamm-netz-werkzeug-waehlen").click();
    await expect(feld(page)).toBeDisabled();
    // Ein innerer Stützpunkt des alten Hauptkamms ohne eigene Höhe: das Feld zeigt die Höhe des Geländes aus der Vorschau, blass.
    await klick(page, B);
    await expect(feld(page)).toBeEnabled();
    await expect(feld(page)).toHaveAttribute("data-vorgabe", "true");
    await feld(page).fill("3000");
    await feld(page).press("Enter");
    await expect(feld(page)).toHaveValue("3000");
    await expect(feld(page)).toHaveAttribute("data-vorgabe", "false");
    // Umschalt nimmt C dazu: verschiedene Höhen, das Feld leer (der Tooltip sagt es); eine Eingabe setzt beide.
    await klick(page, C, true);
    await expect(feld(page)).toHaveValue("");
    await expect(feld(page)).toHaveAttribute("data-gemischt", "true");
    await expect(feld(page)).toHaveAttribute("title", /Verschiedene Höhen/);
    await feld(page).fill("2500");
    await feld(page).press("Enter");
    await expect(feld(page)).toHaveValue("2500");
    // Ein zweiter Umschalt-Klick nimmt C wieder heraus (kein Doppelklick, der den Punkt löschte).
    await klick(page, C, true);
    await expect(page.getByTestId("kamm-netz-zahl")).toHaveAttribute("aria-label", /Kämme 2/);
    await expect(feld(page)).toHaveValue("2500");
    // ↶ nimmt die 2500 in einem Schritt an beiden Punkten zurück.
    await page.getByTestId("kamm-netz-leiste-zurueck").click();
    await klick(page, C);
    await expect(feld(page)).toHaveAttribute("data-vorgabe", "true");
    await klick(page, B);
    await expect(feld(page)).toHaveValue("3000");
    await page.getByTestId("kamm-netz-leiste-wieder").click();

    // Ein Klick in die Leiste hebt die Auswahl nicht auf …
    await page.getByTestId("kamm-netz-hoehen-zeigen").click();
    await expect(feld(page)).toBeEnabled();
    await page.getByTestId("kamm-netz-hoehen-zeigen").click();
    // … Esc hebt sie auf, der Modus bleibt …
    await page.keyboard.press("Escape");
    await expect(feld(page)).toBeDisabled();
    await expect(page.getByTestId("kamm-netz-leiste")).toBeVisible();
    // … und ein Klick ins Leere ebenso.
    await klick(page, NEBEN);
    await expect(feld(page)).toBeEnabled();
    await klick(page, { x: 463, y: 506 });
    await expect(feld(page)).toBeDisabled();

    await page.getByTestId("kamm-netz-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    const netz = gesendet[0]!.gebirge![0]!.changes.netz!;
    // Der alte Kamm: A ohne eigene Höhe, B und C 2500 (↷); der neue ohne eigene Höhen (kein Startwert).
    expect(netz.kaemme[0]!.hoehen).toEqual([
        [1, 2500],
        [2, 2500],
    ]);
    expect(netz.kaemme[1]).not.toHaveProperty("hoehen");
    expect(netz.nebengipfel[0]).not.toHaveProperty("h");
    expect(JSON.stringify(gesendet[0])).not.toContain("null");
});

/** Der Text der Gestenzeile in der Kamm-Leiste (rechts unten, voller Text auch im Tooltip). */
const gesten = (page: Page) => page.getByTestId("kamm-netz-gesten");

test("🔴 Hat das Gebirge schon ein Netz, beginnt „Kämme zeichnen“ mit „Wählen“: Ziehen verschiebt, Doppelklick löscht, Entf löscht; die Gestenzeile sagt es je Werkzeug (OPS-055, OPS-057)", async ({
    page,
}) => {
    // Thomas: „finde ich gerade keine Möglichkeit einen bestehenden Kammpunkt wieder zu löschen … oder zu verschieben“ und „Bestehende Kämme
    // sollten auch im Nachgang noch bearbeitbar sein“. Die Gesten gab es (Werkzeug „Wählen“), aber niemand fand sie.
    const gesendet = await kammeditor(page, {
        kaemme: [
            {
                punkte: [
                    [A.x, A.y],
                    [B.x, B.y],
                    [C.x, C.y],
                ],
                rang: "haupt",
            },
        ],
        nebengipfel: [{ x: NEBEN.x, y: NEBEN.y, h: null }],
    });
    // Ohne ein Werkzeug zu wählen: „Wählen“ gilt, das Zeichnen ist aus.
    await expect(page.getByTestId("kamm-netz-werkzeug-waehlen")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("kamm-netz-werkzeug-kamm")).toHaveAttribute("aria-checked", "false");
    // Die Gestenzeile steht da (nicht nur im Tooltip des ⓘ) und nennt, was die Maus hier kann.
    await expect(gesten(page)).toBeVisible();
    await expect(gesten(page)).toContainText(
        "Ziehen: Punkt verschieben · Doppelklick auf einen Punkt: löschen · Doppelklick auf die Linie: Punkt setzen",
    );
    await expect(gesten(page)).toHaveAttribute("title", /Umschalt: mehrere.* · Entf: Gewähltes löschen/);
    await expect(page.getByTestId("kamm-netz-leiste").locator(".kl__info")).toHaveAttribute("title", /Entf: Gewähltes/);

    const ungespeichert = page.getByTestId("kamm-netz-leiste-ungespeichert");
    await expect(ungespeichert).toContainText("0");
    const b = await aufSeite(page, B);
    const c = await aufSeite(page, C);
    for (const p of [b, c])
        expect(await obenAn(page, p), `die Maus bei ${String(Math.round(p.x))}, ${String(Math.round(p.y))}`).toBe(
            "Karte",
        );
    // Ziehen verschiebt den Punkt B (ein Schritt) …
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 40, b.y + 20, { steps: 6 });
    await page.mouse.up();
    await expect(ungespeichert).toContainText("1");
    // … Doppelklick auf den Endpunkt C löscht ihn (ein zweiter Schritt) …
    await page.mouse.dblclick(c.x, c.y);
    await expect(ungespeichert).toContainText("2");
    // … und Entf löscht das Gewählte, hier den Nebengipfel (ein dritter).
    await klick(page, NEBEN);
    await page.keyboard.press("Delete");
    await expect(ungespeichert).toContainText("3");
    await expect(page.getByTestId("kamm-netz-zahl")).toHaveAttribute("aria-label", /Kämme 1 · Nebengipfel 0/);

    // Die Zeichenwerkzeuge sagen, was sie tun, und wo das Fertige geändert wird.
    await page.getByTestId("kamm-netz-werkzeug-kamm").click();
    await expect(gesten(page)).toContainText("Ein Klick setzt einen Punkt · Doppelklick oder Enter beendet den Kamm");
    await expect(gesten(page)).toContainText("fertige Kämme ändern: Werkzeug „Wählen“");
    await page.getByTestId("kamm-netz-werkzeug-nebengipfel").click();
    await expect(gesten(page)).toHaveText(
        "Ein Klick setzt den Punkt · gesetzte Punkte ändern oder löschen: Werkzeug „Wählen“",
    );
    await page.getByTestId("kamm-netz-werkzeug-mulde").click();
    await expect(gesten(page)).toHaveText(
        "Ein Klick setzt den Punkt · gesetzte Punkte ändern oder löschen: Werkzeug „Wählen“",
    );
    await page.getByTestId("kamm-netz-werkzeug-waehlen").click();
    await expect(gesten(page)).toContainText("Ziehen: Punkt verschieben");

    await page.getByTestId("kamm-netz-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    const netz = gesendet[0]!.gebirge![0]!.changes.netz!;
    expect(netz.nebengipfel).toEqual([]);
    expect(netz.kaemme).toHaveLength(1);
    // A blieb, B ist nach rechts unten gezogen (40 und 20 Bildpunkte bei 32 Bildpunkten je E; die y-Achse der Karte läuft nach oben), C ist weg.
    expect(netz.kaemme[0]!.punkte).toHaveLength(2);
    expect(netz.kaemme[0]!.punkte[0]).toEqual([A.x, A.y]);
    expect(netz.kaemme[0]!.punkte[1]![0]).toBeGreaterThan(B.x + 0.5);
    expect(netz.kaemme[0]!.punkte[1]![1]).toBeLessThan(B.y - 0.2);
});

test("🔴 ↕ Höhe ziehen: 10 Schritt je Pixel, Alt fein, Esc stellt zurück, ein Zug ist ein Schritt, gewählte Punkte um denselben Betrag", async ({
    page,
}) => {
    const gesendet = await kammeditor(page, {
        kaemme: [
            {
                punkte: [
                    [A.x, A.y],
                    [B.x, B.y],
                    [C.x, C.y],
                ],
                rang: "haupt",
                hoehen: [3000, 3000, 3000],
            },
        ],
        nebengipfel: [{ x: NEBEN.x, y: NEBEN.y, h: 2000 }],
    });
    await page.getByTestId("kamm-netz-werkzeug-waehlen").click();
    await klick(page, B);
    await klick(page, NEBEN, true);
    await page.getByTestId("kamm-netz-hoehe-ziehen").click();
    await expect(page.getByTestId("kamm-netz-hoehe-ziehen")).toHaveAttribute("aria-pressed", "true");
    expect(await beschriftung(page)).toEqual([]);
    const ungespeichert = page.getByTestId("kamm-netz-leiste-ungespeichert");
    await expect(ungespeichert).toContainText("0");
    // Auf einem gewählten Punkt gezogen: beide gewählten um denselben Betrag, 20 Pixel nach oben = +200.
    const frei = await aufSeite(page, B);
    const ziehe = async (dy: number, mitten?: () => Promise<void>) => {
        await page.mouse.move(frei.x, frei.y);
        await page.mouse.down();
        for (let i = 1; i <= 4; i++) await page.mouse.move(frei.x, frei.y - (dy * i) / 4);
        await mitten?.();
        await page.mouse.up();
    };
    const vorher = await page.evaluate(() => globalThis.avesmapsMap!.getCenter());
    await ziehe(20, async () => {
        // Während des Zugs: Feld und Beschriftung der gezogenen Punkte zeigen den Wert, auch ohne „Höhen beschriften“.
        await expect(feld(page)).toHaveValue("");
        // Die Zahlen kommen einmal je Bild (WI-0249 Leistung): nach dem nächsten Bild.
        await expect.poll(async () => (await beschriftung(page)).map((p) => p.text).sort()).toEqual(["2.200", "3.200"]);
        await page.screenshot({ path: `${KAMMHOEHEN_BILDER}/ziehen-probegebirge-1920.png` });
    });
    // Die Karte hat sich nicht bewegt.
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getCenter())).toEqual(vorher);
    await expect(ungespeichert).toContainText("1");
    expect(await beschriftung(page)).toEqual([]);
    // Alt: fein, 1 Schritt je Pixel.
    await page.keyboard.down("Alt");
    await ziehe(20);
    await page.keyboard.up("Alt");
    await expect(ungespeichert).toContainText("2");
    // Esc mitten im Zug: der Wert davor, kein Schritt.
    await ziehe(30, () => page.keyboard.press("Escape"));
    await expect(ungespeichert).toContainText("2");
    // ↶ nimmt den feinen Zug in einem Schritt zurück.
    await page.getByTestId("kamm-netz-leiste-zurueck").click();
    await expect(ungespeichert).toContainText("1");
    // Höhen beschriften: alle Orte, je eine Zahl; gemerkt je Browser.
    await page.getByTestId("kamm-netz-hoehen-zeigen").click();
    await expect.poll(async () => (await beschriftung(page)).length).toBe(4);
    expect((await beschriftung(page)).map((p) => p.text).sort()).toEqual(["2.200", "3.000", "3.000", "3.200"]);
    expect(await page.evaluate(() => localStorage.getItem("avesmaps3d.kammhoehen"))).toBe("an");
    // Ein Zeichenwerkzeug schaltet ↕ aus.
    await page.getByTestId("kamm-netz-werkzeug-kamm").click();
    await expect(page.getByTestId("kamm-netz-hoehe-ziehen")).toHaveAttribute("aria-pressed", "false");

    await page.getByTestId("kamm-netz-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    const netz = gesendet[0]!.gebirge![0]!.changes.netz!;
    expect(netz.kaemme[0]!.hoehen).toEqual([
        [0, 3000],
        [1, 3200],
        [2, 3000],
    ]);
    expect(netz.nebengipfel[0]!.h).toBe(2200);
});

test("🔴 ↕ gilt nur über einem Punkt oder Kamm: ins Leere gezogen bewegt die Ansicht; Esc nimmt ↕ zurück, dann die Auswahl", async ({
    page,
}) => {
    // Betreiber 2026-10-25: „wenn man ins leere klickt … die ansicht bewegen … nur wenn man AUF die gipfel/kämme klickt, soll sich die höhe
    // verändern“ und „mit ESC die höheneinstellung abbrechen“.
    await kammeditor(page, {
        kaemme: [
            {
                punkte: [
                    [A.x, A.y],
                    [B.x, B.y],
                    [C.x, C.y],
                ],
                rang: "haupt",
                hoehen: [3000, 3000, 3000],
            },
        ],
        nebengipfel: [{ x: NEBEN.x, y: NEBEN.y, h: 2000 }],
    });
    await page.getByTestId("kamm-netz-werkzeug-waehlen").click();
    await klick(page, B);
    await page.getByTestId("kamm-netz-hoehe-ziehen").click();
    const hoeheZiehen = page.getByTestId("kamm-netz-hoehe-ziehen");
    await expect(hoeheZiehen).toHaveAttribute("aria-pressed", "true");
    const ungespeichert = page.getByTestId("kamm-netz-leiste-ungespeichert");
    const zeiger = () => page.evaluate(() => globalThis.avesmapsMap?.getCanvas().style.cursor ?? "");
    const leer = await aufSeite(page, { x: 463, y: 506 });
    const aufB = await aufSeite(page, B);
    // Der Zeiger ist nur über dem Punkt ↕, über leerer Karte nicht.
    await page.mouse.move(leer.x, leer.y);
    await expect.poll(zeiger).not.toBe("ns-resize");
    await page.mouse.move(aufB.x, aufB.y);
    await expect.poll(zeiger).toBe("ns-resize");
    // Ein Zug ins Leere verschiebt die Ansicht und ändert keine Höhe.
    const vorher = await page.evaluate(() => globalThis.avesmapsMap!.getCenter());
    await page.mouse.move(leer.x, leer.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(leer.x + 8 * i, leer.y - 8 * i);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap!.getCenter())).not.toEqual(vorher);
    await expect(ungespeichert).toContainText("0");
    // Esc: erst nimmt es ↕ zurück, die Auswahl bleibt; der nächste hebt sie auf.
    await page.keyboard.press("Escape");
    await expect(hoeheZiehen).toHaveAttribute("aria-pressed", "false");
    await expect(feld(page)).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(feld(page)).toBeDisabled();
});

test("🔴 Kammhöhe ändern nimmt die eigenen Punkthöhen verhältnisgleich mit; ↶ stellt beides zurück; „Fertig“ schickt beides", async ({
    page,
}) => {
    const gesendet = await oeffneGebirge(
        page,
        probegebirge({
            kaemme: [
                {
                    punkte: [
                        [A.x, A.y],
                        [B.x, B.y],
                        [C.x, C.y],
                    ],
                    rang: "haupt",
                    hoehen: [2000, null, 4000],
                },
            ],
            nebengipfel: [{ x: NEBEN.x, y: NEBEN.y, h: 2000 }],
            mulden: [{ x: 458, y: 534, h: 400 }],
        }),
    );
    await page.getByRole("tab", { name: "Gebirge" }).click();
    const kamm = gebirgeKennung(page, "-kamm");
    await expect(kamm).toHaveValue("4000");
    await kamm.fill("3000");
    await kamm.press("Enter");
    await expect(kamm).toHaveValue("3000");
    await page.getByTestId("landschaft-leiste-zurueck").click();
    await expect(kamm).toHaveValue("4000");
    await page.getByTestId("landschaft-leiste-wieder").click();
    await expect(kamm).toHaveValue("3000");
    await page.getByTestId("landschaft-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    const changes = gesendet[0]!.gebirge![0]!.changes;
    expect(changes.kammhoehe).toBe(3000);
    expect(changes.netz!.kaemme[0]!.hoehen).toEqual([
        [0, 1500],
        [2, 3000],
    ]);
    expect(changes.netz!.nebengipfel[0]!.h).toBe(1500);
    expect(changes.netz!.mulden![0]!.h).toBe(300);
});

/** Die gewählten Teile gelb: was die Auswahl-Ebenen enthalten, ihre Farben und ob sie über den Griffen des Geometrie-Moduls liegen. */
const auswahlGelb = (page: Page) =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap! as unknown as {
            getSource(
                id: string,
            ): { serialize?(): { data?: { features?: { geometry: { type: string } }[] } } } | undefined;
            getLayer(id: string): unknown;
            getPaintProperty(id: string, name: string): unknown;
            getStyle(): { layers: { id: string }[] };
        };
        const ids = map.getStyle().layers.map((l) => l.id);
        const stil = getComputedStyle(document.documentElement);
        const farbe = (wert: unknown): string => String(wert).trim().toLowerCase();
        // Eine Ebene, die (noch) fehlt, ist ein Befund und kein Skriptfehler.
        const paint = (id: string, name: string): string =>
            map.getLayer(id) === undefined ? "fehlt" : farbe(map.getPaintProperty(id, name));
        return {
            teile: (map.getSource("editor-gebirgsnetz-auswahl")?.serialize?.().data?.features ?? []).map(
                (f) => f.geometry.type,
            ),
            punkt: paint("editor-gebirgsnetz-auswahl-punkt", "circle-color"),
            saum: paint("editor-gebirgsnetz-auswahl-punkt", "circle-stroke-color"),
            linie: paint("editor-gebirgsnetz-auswahl-linie", "line-color"),
            gelb: farbe(stil.getPropertyValue("--color-map-selection")),
            panel: farbe(stil.getPropertyValue("--color-panel")),
            // Die Griffe (weißer Anfasser, rote Kante) liegen sonst über dem Gelb.
            ueberAnfasser: ids.indexOf("editor-gebirgsnetz-auswahl-punkt") > ids.indexOf("geometrie-anfasser"),
            ueberKante: ids.indexOf("editor-gebirgsnetz-auswahl-linie") > ids.indexOf("geometrie-kante"),
            griffe: ids.includes("geometrie-anfasser") && ids.includes("geometrie-kante"),
            netz: ids.includes("editor-gebirgsnetz-kaemme"),
        };
    });

for (const farbschema of ["light", "dark"] as const)
    test.describe(`Auswahl gelb, ${farbschema}`, () => {
        test.use({ colorScheme: farbschema });
        test("🔴 Auswahl gelb: Kammpunkt und Nebengipfel gefüllt, Kamm gezeichnet, über den Griffen; Esc und ein Klick ins Leere nehmen das Gelb", async ({
            page,
        }) => {
            // Betreiber 2026-10-25: „was sie machen kann, wenn ich einen gipfel, kamm oder kammpunkt markiere: gelb füllen“ - die Netz-Ebenen lagen unter dem
            // weißen Anfasser und der roten Kante des Geometrie-Moduls, eine Auswahl war nicht zu sehen. Geprüft wird die Ebene (Farbe, Lage), kein Bild.
            await kammeditor(page, {
                kaemme: [
                    {
                        punkte: [
                            [A.x, A.y],
                            [B.x, B.y],
                            [C.x, C.y],
                        ],
                        rang: "haupt",
                    },
                ],
                nebengipfel: [{ x: NEBEN.x, y: NEBEN.y, h: null }],
            });
            // Der Schalter nimmt einen Klick, der mitten in einen Neuaufbau der Leiste fällt, nicht immer an: erst weiter, wenn „Wählen“ gilt.
            const waehlen = page.getByTestId("kamm-netz-werkzeug-waehlen");
            await expect(async () => {
                await waehlen.click();
                await expect(waehlen).toHaveAttribute("aria-checked", "true", { timeout: 1000 });
            }).toPass();
            const teile = () => auswahlGelb(page).then((s) => s.teile);
            expect(await teile()).toEqual([]);

            // Ein Kammpunkt und mit Umschalt der Nebengipfel: zwei gelbe Punkte, in der Farbe der Auswahl, über dem Anfasser.
            await klick(page, B);
            await expect.poll(teile).toEqual(["Point"]);
            await klick(page, NEBEN, true);
            await expect.poll(teile).toEqual(["Point", "Point"]);
            const punkte = await auswahlGelb(page);
            expect(punkte.griffe).toBe(true);
            expect(punkte.gelb).toMatch(/^#[0-9a-f]{6}$/);
            expect(punkte.punkt).toBe(punkte.gelb);
            expect(punkte.ueberAnfasser).toBe(true);

            // Esc hebt die Auswahl auf: nichts mehr gelb.
            await page.keyboard.press("Escape");
            await expect.poll(teile).toEqual([]);

            // Ein Klick auf die Kante wählt den ganzen Kamm: eine gelbe Linie über der roten Kante, die Punkte bleiben ungefüllt.
            await klick(page, { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 });
            await expect.poll(teile).toEqual(["LineString"]);
            const kamm = await auswahlGelb(page);
            expect(kamm.linie).toBe(kamm.gelb);
            expect(kamm.ueberKante).toBe(true);

            // Ein Klick ins Leere nimmt auch dieses Gelb.
            await klick(page, { x: 463, y: 506 });
            await expect.poll(teile).toEqual([]);

            // Ein Stilwechsel der Anwendung (`setStyle` mit `diff`, etwa nach dem Klick auf einen Ort) nimmt die Ebenen des Netzes mit:
            // Sie kommen mit `styledata` wieder, samt der Auswahl.
            // Der Klick ins Leere stößt in der Anwendung einen Stilneuaufbau an; ein Klick mitten darin trifft die Griffe nicht. Mit Abstand
            // wiederholen (länger als ein Doppelklick, der den Punkt löschte), bis er gewählt ist.
            await expect(async () => {
                await klick(page, B);
                await expect.poll(teile, { timeout: 2000 }).toEqual(["Point"]);
            }).toPass();
            await page.evaluate(() => {
                const map = globalThis.avesmapsMap! as unknown as {
                    removeLayer(id: string): void;
                    removeSource(id: string): void;
                };
                for (const id of [
                    "editor-gebirgsnetz-hoehen",
                    "editor-gebirgsnetz-auswahl-punkt",
                    "editor-gebirgsnetz-auswahl-linie",
                    "editor-gebirgsnetz-gipfel",
                    "editor-gebirgsnetz-kaemme",
                ])
                    map.removeLayer(id);
                for (const id of ["editor-gebirgsnetz-hoehen", "editor-gebirgsnetz-auswahl", "editor-gebirgsnetz"])
                    map.removeSource(id);
            });
            await expect.poll(async () => (await auswahlGelb(page)).netz).toBe(true);
            await expect.poll(teile).toEqual(["Point"]);

            // Hell wie dunkel: dieselbe Auswahlfarbe, der Saum um den Punkt in der Panelfarbe des Themas.
            expect(await page.evaluate(() => document.documentElement.dataset["theme"] ?? "light")).toBe(farbschema);
            const thema = await auswahlGelb(page);
            expect(thema.punkt).toBe(thema.gelb);
            expect(thema.saum).toBe(thema.panel);
        });
    });

test("🔴 Flüsse und Seen (WI-0249): erkannt, wählbar, nicht ziehbar; Höhe im Feld; „Fertig“ schickt sie nach Lage", async ({
    page,
}) => {
    const gesendet = await oeffneGebirge(
        page,
        probegebirge(
            {
                kaemme: [
                    {
                        punkte: [
                            [A.x, A.y],
                            [B.x, B.y],
                            [C.x, C.y],
                        ],
                        rang: "haupt",
                    },
                ],
                nebengipfel: [],
            },
            {
                fluesse: [
                    {
                        n: "Probefluss",
                        bach: false,
                        dir: null,
                        p: [
                            [445, 530],
                            [452, 532],
                            [460, 533],
                            [470, 534],
                        ],
                    },
                ],
                seen: [
                    {
                        n: "Probesee",
                        g: {
                            type: "Polygon",
                            coordinates: [
                                [
                                    [455, 507],
                                    [461, 507],
                                    [461, 512],
                                    [455, 512],
                                    [455, 507],
                                ],
                            ],
                        },
                    },
                ],
            },
        ),
    );
    await page.getByRole("tab", { name: "Gebirge" }).click();
    await gebirgeKennung(page, "-kaemme-zeichnen").click();
    await expect(page.getByTestId("kamm-netz-leiste")).toBeVisible();
    await insFreie(page, { x: 453, y: 520 }, 6);
    await page.getByTestId("kamm-netz-werkzeug-waehlen").click();
    const ungespeichert = page.getByTestId("kamm-netz-leiste-ungespeichert");
    // Der Fluss ist da (nur die Stützpunkte in der Fläche) und lässt sich nicht ziehen: Ein Druck auf seinen Punkt bewegt die Karte.
    const fluss = await aufSeite(page, { x: 452, y: 532 });
    await page.mouse.move(fluss.x, fluss.y);
    await page.mouse.down();
    await page.mouse.move(fluss.x + 30, fluss.y + 10, { steps: 4 });
    await page.mouse.up();
    await expect(ungespeichert).toContainText("0");
    // Ein Klick wählt den Stützpunkt; das Feld setzt seine Höhe.
    await klick(page, { x: 452, y: 532 });
    await expect(feld(page)).toBeEnabled();
    await feld(page).fill("1234");
    await feld(page).press("Enter");
    await expect(feld(page)).toHaveValue("1234");
    await expect(feld(page)).toHaveAttribute("data-vorgabe", "false");
    // Der See: ein Punkt an seinem Platz, EINE Höhe.
    await klick(page, { x: 458, y: 509.5 });
    await expect(feld(page)).toBeEnabled();
    await feld(page).fill("900");
    await feld(page).press("Enter");
    await expect(ungespeichert).toContainText("2");
    await page.screenshot({ path: `${KAMMHOEHEN_BILDER}/wasser-1920.png` });

    await page.getByTestId("kamm-netz-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    const netz = gesendet[0]!.gebirge![0]!.changes.netz!;
    expect(netz.flussHoehen).toEqual([{ x: 452, y: 532, h: 1234 }]);
    expect(netz.seeHoehen).toEqual([{ x: 458, y: 509.5, h: 900 }]);
    // Das Netz selbst trägt keinen Fluss: Kämme und Nebengipfel wie zuvor.
    expect(netz.kaemme).toHaveLength(1);
    expect(netz.nebengipfel).toEqual([]);
});

for (const [breite, hoehe] of [
    [1920, 1080],
    [1280, 800],
] as const)
    test.describe(`Bilder ${String(breite)} × ${String(hoehe)}`, () => {
        test.use({ viewport: { width: breite, height: hoehe } });
        test(`Leiste mit Höhen an einem Gebirge wie den Blutzinnen, ${String(breite)}`, async ({ page }) => {
            await oeffneGebirge(page, blutzinnenStub());
            await zeigeKammhoehen(page, `${KAMMHOEHEN_BILDER}/blutzinnen-${String(breite)}.png`);
            // Die Leiste steht ganz im Bild (in einer Zeile hält sie `landschaftseditor-gebirge.spec.ts` bei 1280 × 800).
            for (const kennung of ["kamm-netz-hoehe-ziehen", "kamm-netz-hoehen-zeigen", "kamm-netz-leiste-fertig"])
                await expect(page.getByTestId(kennung)).toBeInViewport();
        });
    });

// ---------------------------------------------------------------------------------------------------------------------------------------
// Fluss als Tal (WI-0259, OPS-071; Vali 2026-10-30: „flüsse sind automatische kammtäler, deren verlauf im kammeditor auch in der höhe verändert
// werden kann“; Probierseite abgenommen: „der kammeditor mit dem editierbaren flussprofil passt“; dazu: „wie das profil MIT see aussieht … wenn man
// den see als fläche ebenfalls in seiner höhe im flussprofil (und auf der karte mit pfeil hoch-runter-symbol) verschieben kann, dann wärs super“).
// Problemfälle: Der Fluss steht gerade statt gerundet; ein Punkt mit eigener Höhe sieht aus wie einer ohne; das „!“ fehlt oder steht an einem
// Punkt, vor dem der Fluss fällt; „Löschen“ und Entf tun am Fluss nichts oder löschen ihn; das Profil schreibt an der Auswahl und am Entwurf
// vorbei (↶ geht nicht); ein Zug im Profil sind viele Schritte; ein Doppelklick nimmt die Höhe nicht weg; Punkte außerhalb der Fläche lassen sich
// ziehen; Esc lässt einen halben Zug stehen; die Platte eines Sees lässt sich nicht heben.
// ---------------------------------------------------------------------------------------------------------------------------------------

const K2 = { x: 449, y: 510 };
const K3 = { x: 453, y: 509.5 };

/** „Kämme zeichnen“ am Probefluss; der Fluss mittig in der freien Fläche, Werkzeug „Wählen“. */
async function flussEditor(page: Page, stub = flussTalStub()): Promise<LandscapeUpdateBody[]> {
    const gesendet = await oeffneGebirge(page, stub);
    await page.getByRole("tab", { name: "Gebirge" }).click();
    await gebirgeKennung(page, "-kaemme-zeichnen").click();
    await expect(page.getByTestId("kamm-netz-leiste")).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap!.isMoving())).toBe(false);
    await insFreie(page, { x: 453, y: 510 }, 6);
    await page.getByTestId("kamm-netz-werkzeug-waehlen").click();
    await erwarteZeichen(page, "punkt", 5);
    return gesendet;
}

const griffe = (page: Page) => page.getByTestId("gebirge-profil-griff");
const griffNr = (page: Page, nr: number) => griffe(page).nth(nr);
/** Die Mitte eines Elements im Profil, nachdem es ins Bild gescrollt ist. */
async function mitteVon(el: Locator): Promise<{ x: number; y: number }> {
    await el.scrollIntoViewIfNeeded();
    const box = (await el.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
/** Zieht ein Element um `dy` Bildpunkte (nach oben negativ); `loslassen: false` lässt die Maus unten. */
async function ziehe(page: Page, el: Locator, dy: number, loslassen = true): Promise<void> {
    const p = await mitteVon(el);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x, p.y + dy / 2, { steps: 4 });
    await page.mouse.move(p.x, p.y + dy, { steps: 4 });
    if (loslassen) await page.mouse.up();
}

test("🔴 Fluss in „Wählen“: gerundet wie auf der Karte, Punkte mit eigener Höhe gefüllt, Zahlen, Quelle und Mündung, Zähler", async ({
    page,
}) => {
    await flussEditor(page);
    // Fünf Stützpunkte in der Fläche (0 und 7 liegen draußen, 4 im See), alle mit eigener Höhe: gefüllt.
    const punkte = (await flussZeichen(page)).filter((p) => p["art"] === "punkt");
    expect(punkte.map((p) => p["eigen"])).toEqual([true, true, true, true, true]);
    // Der Weg beginnt draußen und endet draußen: weder „Quelle“ noch „Mündung“ steht in der Fläche.
    await erwarteZeichen(page, "ende", 0);
    // Der Fluss fällt von Punkt zu Punkt: kein „!“. Die eigenen Höhen stehen immer über den Punkten, ohne „Höhen beschriften“.
    await erwarteZeichen(page, "warn", 0);
    await expect
        .poll(async () => (await beschriftung(page)).map((b) => b["text"]).sort())
        .toEqual(["1.000", "1.600", "1.800", "2.000", "600"]);
    // Die Zählung nennt den Fluss mit dem Zeichen „Tal“ in der Farbe der Flüsse.
    await expect(page.getByTestId("kamm-netz-fluesse")).toHaveText("1");
    await expect(page.getByTestId("kamm-netz-zahl")).toHaveAttribute("aria-label", /Flüsse 1/);
    await expect(gesten(page)).toContainText("Fluss: Klick auf die Linie wählt ihn ganz");
    // Gerundet: Die Kante des Flusses hat mehr Punkte als der Weg (Catmull-Rom, acht je Abschnitt), nicht nur die Stützpunkte.
    const kantenpunkte = await page.evaluate(() => {
        const map = globalThis.avesmapsMap! as unknown as {
            getSource(id: string):
                | {
                      serialize?(): {
                          data?: {
                              features?: {
                                  properties: Record<string, unknown>;
                                  geometry: { coordinates: unknown[] };
                              }[];
                          };
                      };
                  }
                | undefined;
        };
        const f = map.getSource("geometrie")?.serialize?.().data?.features ?? [];
        return f
            .filter((x) => x.properties["rolle"] === "kante" && x.properties["fest"] === true)
            .map((x) => x.geometry.coordinates.length);
    });
    expect(kantenpunkte).toEqual([1 + 8 * 2, 1 + 8 * 1]);
    await page.screenshot({
        path: `${KAMMHOEHEN_BILDER}/fluss-karte-${String((await page.viewportSize())!.width)}.png`,
    });
});

test("🔴 „!“ vor einem steigenden Punkt; „Löschen“ und Entf nehmen die eigene Höhe weg, nie den Verlauf", async ({
    page,
}) => {
    const gesendet = await flussEditor(page);
    const loeschen = page.getByTestId("kamm-netz-loeschen");
    const ungespeichert = page.getByTestId("kamm-netz-leiste-ungespeichert");
    await erwarteZeichen(page, "warn", 0);
    // Nichts Löschbares gewählt: Der Knopf ist gesperrt und sagt, was zu wählen ist.
    await expect(loeschen).toBeDisabled();
    // Punkt 3 auf 2500: Der Fluss steigt vor ihm (von 1800 auf 2500) und fällt dahinter wieder, dazu der See dazwischen nicht.
    await klick(page, K3);
    await expect(feld(page)).toHaveValue("1600");
    await feld(page).fill("2500");
    await feld(page).press("Enter");
    await erwarteZeichen(page, "warn", 1);
    await expect(gesten(page)).toContainText("! Probefluss: der Fluss steigt vor den markierten Punkten");
    await expect(gesten(page)).toHaveClass(/is-warnung/);
    await expect(ungespeichert).toContainText("1");
    // „Löschen“ nimmt die eigene Höhe des gewählten Punkts weg: das „!“ geht, der Punkt bleibt (der Verlauf gehört dem Wegeditor).
    await expect(loeschen).toBeEnabled();
    await expect(loeschen).toHaveAttribute("title", /nimmt die eigene Höhe/);
    await loeschen.click();
    await erwarteZeichen(page, "warn", 0);
    await erwarteZeichen(page, "punkt", 5);
    await expect(feld(page)).toBeEnabled();
    await expect(feld(page)).toHaveAttribute("data-vorgabe", "true");
    await expect(loeschen).toBeDisabled();
    await expect(loeschen).toHaveAttribute("title", /eigener Höhe wählen/);
    // Entf tut dasselbe an einem anderen Punkt; ↶ holt die Höhe zurück.
    await klick(page, K2);
    await expect(feld(page)).toHaveValue("1800");
    await page.keyboard.press("Delete");
    await expect(feld(page)).toHaveAttribute("data-vorgabe", "true");
    await erwarteZeichen(page, "punkt", 5);
    expect((await flussZeichen(page)).filter((p) => p["art"] === "punkt" && p["eigen"] === true)).toHaveLength(3);
    await page.getByTestId("kamm-netz-leiste-zurueck").click();
    await expect(feld(page)).toHaveValue("1800");
    await page.getByTestId("kamm-netz-leiste-wieder").click();
    await expect(feld(page)).toHaveAttribute("data-vorgabe", "true");

    await page.getByTestId("kamm-netz-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    const netz = gesendet[0]!.gebirge![0]!.changes.netz!;
    // Von den fünf eigenen Höhen sind die an Punkt 2 und Punkt 3 weg; der Kamm und der See sind unberührt.
    expect(netz.flussHoehen).toEqual([FLUSS_HOEHEN[0], FLUSS_HOEHEN[3], FLUSS_HOEHEN[4]]);
    expect(netz.seeHoehen).toEqual([]);
    expect(netz.kaemme).toHaveLength(1);
});

test("🔴 Profil außerhalb des Modus: eigene Höhen nur als Punkte, 5 rem hoch, nichts zum Ziehen", async ({ page }) => {
    await oeffneGebirge(page, flussTalStub());
    await page.getByRole("tab", { name: "Gebirge" }).click();
    const profil = page.getByTestId("gebirge-profil-fluss");
    await profil.scrollIntoViewIfNeeded();
    expect((await profil.locator(".profil__plot").boundingBox())!.height).toBeCloseTo(80, 0);
    // Fünf Punkte mit eigener Höhe, gefüllt und nur Zeichen; kein Griff am See, kein Hinweis auf Griffe.
    await expect(griffe(page)).toHaveCount(5);
    for (const eigen of await griffe(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-eigen"))))
        expect(eigen).toBe("true");
    for (const ziehbar of await griffe(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-ziehbar"))))
        expect(ziehbar).toBe("false");
    await expect(page.getByTestId("gebirge-profil-seegriff")).toHaveCount(0);
    await expect(page.getByTestId("gebirge-profil-hinweis")).toHaveCount(0);
    // Der Verlauf mit den eigenen Höhen steht gestrichelt, die Zahlen folgen ihm; zwei feine Linien tragen die höchste und die tiefste Zahl.
    await expect(profil.getByTestId("gebirge-profil-verlauf")).toHaveCount(1);
    await expect(profil.getByTestId("gebirge-profil-steigt")).toHaveCount(0);
    await expect(profil.getByTestId("gebirge-profil-zahlen")).toHaveText(
        "Quelle 2.000 Schritt · Mündung 600 Schritt · Gefälle 1.400 Schritt",
    );
    await expect(profil.getByTestId("gebirge-profil-achse")).toHaveCount(2);
    await expect(profil.locator(".profil__legende")).toContainText("mit eigenen Höhen");
});

test("🔴 Profil im Kammeditor: doppelt so hoch, Griffe nur in der Fläche, Ziehen setzt die Höhe im EINEN Entwurf, Doppelklick nimmt sie weg", async ({
    page,
}) => {
    const gesendet = await flussEditor(page);
    const ungespeichert = page.getByTestId("kamm-netz-leiste-ungespeichert");
    const profil = page.getByTestId("gebirge-profil-fluss");
    await profil.scrollIntoViewIfNeeded();
    expect((await profil.locator(".profil__plot").boundingBox())!.height).toBeCloseTo(160, 0);
    await expect(page.getByTestId("gebirge-profil-hinweis")).toBeVisible();
    // Sieben Griffe (der Punkt im See trägt keinen; der See hat seinen an der Platte): die zwei außerhalb der Fläche sind grau und gesperrt.
    await expect(griffe(page)).toHaveCount(7);
    expect(await griffe(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-ziehbar")))).toEqual([
        "false",
        "true",
        "true",
        "true",
        "true",
        "true",
        "false",
    ]);
    await expect(page.getByTestId("gebirge-profil-seegriff")).toHaveCount(1);
    // Ein Zug an einem grauen Punkt tut nichts.
    await ziehe(page, griffNr(page, 0), -40);
    await expect(ungespeichert).toContainText("0");

    // Punkt 3 (1600) ziehen: die Blase nennt den Wert, ein Schritt im Entwurf beim Loslassen, gerundet auf 10, der Fluss steigt dort.
    const k3 = griffNr(page, 3);
    await expect(k3).toHaveAttribute("data-hoehe", "1600");
    await ziehe(page, k3, -40, false);
    await expect(page.getByTestId("gebirge-profil-blase")).toHaveText(/^\d[\d.]* Schritt$/);
    await expect(ungespeichert).toContainText("0");
    await page.mouse.up();
    await expect(page.getByTestId("gebirge-profil-blase")).toHaveCount(0);
    await expect(ungespeichert).toContainText("1");
    const gezogen = Number(await k3.getAttribute("data-hoehe"));
    expect(gezogen).toBeGreaterThan(1800);
    expect(gezogen % 10).toBe(0);
    await expect(k3).toHaveAttribute("data-steigt", "true");
    await expect(profil.getByTestId("gebirge-profil-steigt")).toHaveCount(1);
    // Karte und Profil sagen dasselbe: „!“ am Punkt 3, die Zahl über ihm, die Gestenzeile.
    await erwarteZeichen(page, "warn", 1);
    await expect(gesten(page)).toContainText("! Probefluss");
    await expect
        .poll(async () => (await beschriftung(page)).some((b) => b["text"] === gezogen.toLocaleString("de-DE")))
        .toBe(true);
    // Die Auswahl ist geteilt: Der gezogene Punkt steht auf der Karte gewählt (das Feld zeigt seine Höhe) …
    await expect(feld(page)).toHaveValue(String(gezogen));
    await expect(k3).toHaveAttribute("data-gewaehlt", "true");
    // … und ein Klick auf einen Punkt der Karte wählt im Profil.
    await klick(page, K2);
    await expect(feld(page)).toHaveValue("1800");
    await expect(griffNr(page, 2)).toHaveAttribute("data-gewaehlt", "true");
    await expect(k3).toHaveAttribute("data-gewaehlt", "false");
    // ↶ stellt den Zug als EIN Schritt zurück.
    await page.getByTestId("kamm-netz-leiste-zurueck").click();
    await expect(k3).toHaveAttribute("data-hoehe", "1600");
    await expect(ungespeichert).toContainText("0");
    await erwarteZeichen(page, "warn", 0);

    // Esc mitten im Zug stellt den Wert davor her; der Entwurf bleibt unberührt.
    await ziehe(page, k3, -40, false);
    await expect(page.getByTestId("gebirge-profil-blase")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.move(0, 0);
    await page.mouse.up();
    await expect(page.getByTestId("gebirge-profil-blase")).toHaveCount(0);
    await expect(k3).toHaveAttribute("data-hoehe", "1600");
    await expect(ungespeichert).toContainText("0");

    // Doppelklick nimmt die eigene Höhe weg (der Punkt fällt auf die des Flusses dazwischen zurück).
    const p = await mitteVon(k3);
    await page.mouse.dblclick(p.x, p.y);
    await expect(k3).toHaveAttribute("data-eigen", "false");
    await expect(ungespeichert).toContainText("1");
    expect((await flussZeichen(page)).filter((z) => z["art"] === "punkt" && z["eigen"] === true)).toHaveLength(4);
    const breite = String((await page.viewportSize())!.width);
    await page.screenshot({ path: `${KAMMHOEHEN_BILDER}/fluss-profil-${breite}.png` });
    await profil.screenshot({ path: `${KAMMHOEHEN_BILDER}/fluss-profil-nah-${breite}.png` });

    await page.getByTestId("kamm-netz-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]!.gebirge![0]!.changes.netz!.flussHoehen).toEqual([
        FLUSS_HOEHEN[0],
        FLUSS_HOEHEN[1],
        FLUSS_HOEHEN[3],
        FLUSS_HOEHEN[4],
    ]);
});

test("🔴 See: Griff ↕ auf der Karte und Platte im Profil setzen seine Höhe; Doppelklick nimmt sie weg; der Verlauf läuft flach durch", async ({
    page,
}) => {
    const gesendet = await flussEditor(page);
    const ungespeichert = page.getByTestId("kamm-netz-leiste-ungespeichert");
    // Der See trägt auf der Karte einen Griff mit ↕ an seinem Platz.
    await erwarteZeichen(page, "see", 1);
    expect(await page.evaluate(() => globalThis.avesmapsMap!.hasImage("editor-gebirgsnetz-see-griff"))).toBe(true);
    const platz = await aufSeite(page, SEE_PLATZ);
    expect(await obenAn(page, platz)).toBe("Karte");
    // Ein Klick wählt den See wie bisher; das Feld ↕ zeigt dann seine Höhe (die des Geländes, blass).
    await page.mouse.click(platz.x, platz.y);
    await expect(feld(page)).toBeEnabled();
    await expect(feld(page)).toHaveAttribute("data-vorgabe", "true");
    await expect(ungespeichert).toContainText("0");
    // Eine eigene Höhe als Ausgangswert (die des Geländes ändert sich, bis die Vorschau fertig ist).
    await feld(page).fill("1000");
    await feld(page).press("Enter");
    const vorher = 1000;
    await expect(ungespeichert).toContainText("1");
    // Ziehen nach oben setzt die Höhe wie „Höhe ziehen“, auch ohne den Schalter: 10 Schritt je Bildpunkt, EIN Schritt im Entwurf.
    await page.mouse.move(platz.x, platz.y);
    await page.mouse.down();
    await page.mouse.move(platz.x, platz.y - 10, { steps: 3 });
    await page.mouse.move(platz.x, platz.y - 20, { steps: 3 });
    await page.mouse.up();
    await expect(feld(page)).toHaveValue(String(vorher + 200));
    await expect(feld(page)).toHaveAttribute("data-vorgabe", "false");
    await expect(ungespeichert).toContainText("2");
    // Die Zahl steht über dem See, solange er eine eigene Höhe hat.
    await expect
        .poll(async () => (await beschriftung(page)).map((b) => b["text"]))
        .toContain((vorher + 200).toLocaleString("de-DE"));
    // Esc mitten im Zug stellt zurück.
    await page.mouse.move(platz.x, platz.y);
    await page.mouse.down();
    await page.mouse.move(platz.x, platz.y - 30, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(feld(page)).toHaveValue(String(vorher + 200));
    await expect(ungespeichert).toContainText("2");

    // Im Profil: Die Platte trägt einen Griff; der Verlauf läuft durch den See auf Seehöhe, flach.
    const seegriff = page.getByTestId("gebirge-profil-seegriff");
    await seegriff.scrollIntoViewIfNeeded();
    await expect(seegriff).toHaveAttribute("data-eigen", "true");
    await expect(seegriff).toHaveAttribute("data-hoehe", String(vorher + 200));
    // Die Platte ziehen: ein Schritt, gerundet auf 10.
    await ziehe(page, seegriff, -30);
    await expect(ungespeichert).toContainText("3");
    const platte = Number(await seegriff.getAttribute("data-hoehe"));
    expect(platte).toBeGreaterThan(vorher + 200);
    expect(platte % 10).toBe(0);
    await expect(feld(page)).toHaveValue(String(platte));
    // Steht der See über Punkt 3 (1600), steigt der Fluss in ihn: „!“ am See, Gelb im Profil.
    if (platte > 1600) {
        await erwarteZeichen(page, "warn", 1);
        await expect(page.getByTestId("gebirge-profil-fluss").getByTestId("gebirge-profil-steigt")).toHaveCount(1);
    }
    // Doppelklick auf den Griff nimmt die eigene Seehöhe weg.
    const p = await mitteVon(seegriff);
    await page.mouse.dblclick(p.x, p.y);
    await expect(seegriff).toHaveAttribute("data-eigen", "false");
    await expect(ungespeichert).toContainText("4");
    await erwarteZeichen(page, "warn", 0);
    // ↶ holt sie zurück; „Fertig“ schickt sie nach Lage (an den Platz des Sees).
    await page.getByTestId("kamm-netz-leiste-zurueck").click();
    await expect(seegriff).toHaveAttribute("data-hoehe", String(platte));
    await expect(ungespeichert).toContainText("3");

    await page.getByTestId("kamm-netz-leiste-fertig").click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]!.gebirge![0]!.changes.netz!.seeHoehen).toEqual([{ x: SEE_PLATZ.x, y: SEE_PLATZ.y, h: platte }]);
});

for (const [breite, hoehe] of [
    [1920, 1080],
    [1280, 800],
] as const)
    test.describe(`Fluss als Tal, Bilder ${String(breite)} × ${String(hoehe)}`, () => {
        test.use({ viewport: { width: breite, height: hoehe } });
        test(`Karte mit „!“ und Profil mit Gelb, ${String(breite)}`, async ({ page }) => {
            await flussEditor(page);
            await klick(page, K3);
            await feld(page).fill("2500");
            await feld(page).press("Enter");
            await erwarteZeichen(page, "warn", 1);
            const profil = page.getByTestId("gebirge-profil-fluss");
            await profil.scrollIntoViewIfNeeded();
            await expect(profil.getByTestId("gebirge-profil-steigt")).toHaveCount(1);
            // Die Leiste mit Zähler, Löschen und „Fertig“ steht ganz im Bild, das Profil ebenso.
            for (const kennung of ["kamm-netz-loeschen", "kamm-netz-fluesse", "kamm-netz-leiste-fertig"])
                await expect(page.getByTestId(kennung)).toBeInViewport();
            await expect(profil).toBeInViewport();
            await page.screenshot({ path: `${KAMMHOEHEN_BILDER}/fluss-bild-${String(breite)}.png` });
        });
    });
