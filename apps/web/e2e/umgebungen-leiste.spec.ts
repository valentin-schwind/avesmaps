import { expect, test, type Page } from "@playwright/test";
import { UMGEBUNGEN_URL, type FreigabeSicht, type ReleaseTestSicht, type UmgebungenStand } from "@avesmaps3d/shared";
import { oeffne, PRODUCTION_ROUTE, SICHT, STAGE_ROUTE, STAGE_SHA, TEST } from "./umgebungen-leiste-stub.ts";

/**
 * Die Leiste „Lokal → Stage → Production“ oben in „Umgebungen“ (WI-0248; Vali: „je nachdem wo man ist, soll die jeweilige umgebung markiert sein
 * … unter dem pfeil von localhost zu stage könnte der Release-Test sein … die 3 boxen in allen ansichten da und sogar gleich groß“).
 *
 * Problemfall: Lokal fehlte in der Leiste ganz; die Stationen waren je nach Umgebung verschieden breit (Lokal stand in der schmalen Etikettenspalte);
 * Production zeigte „läuft“, ohne es zu wissen. Sitzung und Routen sind gestubbt (`umgebungen-leiste-stub.ts`); was die Leiste rechnet, prüft
 * `test/umgebungen-leiste.test.ts`.
 *
 * Dazu (WI-0204, Vali: „die erreichbarkeit beim aufruf kurz getestet … die stage weiß selbst nicht ob sie erreichbar ist … die 3 umgebungsboxen eine
 * stabile höhe (300 px?)“): Lokal wird beim Öffnen von selbst geprüft, die Station mit „hier“ ist sofort erreichbar, und die drei Stationen sind 300 px
 * hoch, auch während der Probe und bei langen Texten.
 */

/** Die Höhe der drei Stationen (`--station-hoehe`, `verwaltung-umgebungen.vue`). */
const STATION_HOEHE = 300;

/** Die Adresse von Lokal in den Routen unten; die Probe aus dem Browser geht dorthin (`auth/lokal-probe.ts`). */
const LOKAL_ADRESSE = "https://rechner.tail0000.ts.net";
const LOKAL_ROUTE: UmgebungenStand = {
    ...STAGE_ROUTE,
    lokal: { adresse: LOKAL_ADRESSE, imMenue: "erreichbar" },
};

/** Wie viel in der Station über ihren Rand hinausläuft (Höhe des Inhalts minus Höhe der Station): 0 heißt, alles passt hinein. */
async function randUeberhang(page: Page, id: string): Promise<{ hoch: number; breit: number }> {
    return page.getByTestId(id).evaluate((el) => ({
        hoch: el.scrollHeight - el.clientHeight,
        breit: el.scrollWidth - el.clientWidth,
    }));
}

/** Breite und Höhe der drei Stationen, in der Reihenfolge Lokal, Stage, Production. */
async function masse(page: Page): Promise<{ b: number; h: number }[]> {
    const ids = ["umgebungen-lokal", "umgebungen-stage", "umgebungen-production"];
    const kaesten = [];
    for (const id of ids) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box, id).not.toBeNull();
        kaesten.push({ b: box!.width, h: box!.height });
    }
    return kaesten;
}

async function hier(page: Page): Promise<string[]> {
    return page
        .locator('[data-testid^="umgebungen-"][data-hier="true"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""));
}

test("🔴 auf der Stage: drei gleich große Stationen, die Stage ist markiert; Release-Test und Abnahme hängen unter ihren Pfeilen", async ({
    page,
}) => {
    await oeffne(page, { environment: "staging", sicht: SICHT, route: STAGE_ROUTE });
    const [lokal, stage, production] = await masse(page);
    // Gleich breit und gleich hoch (die Zeile streckt sie).
    expect(Math.abs(lokal!.b - stage!.b)).toBeLessThan(1.5);
    expect(Math.abs(stage!.b - production!.b)).toBeLessThan(1.5);
    expect(Math.abs(lokal!.h - stage!.h)).toBeLessThan(1.5);
    expect(Math.abs(stage!.h - production!.h)).toBeLessThan(1.5);
    // 🔴 Und 300 px hoch, nichts läuft über den Rand (Vali: „eine stabile höhe“).
    for (const kasten of [lokal!, stage!, production!]) expect(Math.abs(kasten.h - STATION_HOEHE)).toBeLessThan(1.5);
    for (const id of ["umgebungen-lokal", "umgebungen-stage", "umgebungen-production"])
        expect(await randUeberhang(page, id), id).toEqual({ hoch: 0, breit: 0 });
    expect(await hier(page)).toEqual(["umgebungen-stage"]);
    await expect(page.getByTestId("umgebungen-stage")).toHaveAttribute("aria-current", "true");

    // Die Stationen: Stand, seit wann, Zustand.
    await expect(page.getByTestId("umgebungen-stage")).toContainText("a7728a1");
    // 🔴 Die eigene Station antwortet, ohne dass jemand fragt: „erreichbar“, ohne Zeit, nie „noch nicht geprüft“. Die Prüfung des Stands steht
    // als eigene Zeile „Prüfung“ darunter.
    await expect(page.getByTestId("umgebungen-stage-zustand")).toHaveText("erreichbar");
    await expect(page.getByTestId("umgebungen-stage")).toContainText("Prüfung");
    await expect(page.getByTestId("umgebungen-stage")).toContainText("grün geprüft");
    await expect(page.getByTestId("umgebungen-stage")).toContainText("Proben und Journal gruen");
    await expect(page.getByTestId("umgebungen-production")).toContainText("b2ee1b3");
    await expect(page.getByTestId("umgebungen-production-zustand")).toHaveText("läuft");
    // Lokal ist da; die Adresse steht nicht in der Route, also ist nichts eingetragen.
    await expect(page.getByTestId("umgebungen-lokal-zustand")).toContainText("keine Adresse eingetragen");

    // Unter dem Pfeil von Lokal zur Stage: der Nachweis aus der Statusdatei; gestartet wird er lokal.
    await expect(page.getByTestId("umgebungen-test-zustand")).toHaveText("grün");
    await expect(page.getByTestId("umgebungen-test-stand")).toHaveText("Stand a7728a1");
    await expect(page.getByTestId("umgebungen-test")).toContainText("Gestartet wird er auf dem Entwicklungsrechner");
    await expect(page.getByTestId("umgebungen-verbinder-push")).toContainText("Push");
    // Unter dem Pfeil von der Stage nach Production: der Zustand der Freigabe (hier: keine) und der Knopf von Hand (Vali 2026-10-31).
    await expect(page.getByTestId("umgebungen-abnahme")).toContainText("Abnahme");
    await expect(page.getByTestId("umgebungen-abnahme").getByTestId("production-release")).toHaveCount(1);
    await expect(page.getByTestId("umgebungen-freigabe-zustand")).toContainText("Keine Freigabe.");
    await expect(page.getByTestId("umgebungen-verbinder")).toContainText("2 ▸");
    // Darunter, was noch nicht draußen ist.
    await expect(page.getByTestId("production-themen")).toContainText("Neuigkeiten");
    await expect(page.getByTestId("umgebungen-gleise")).toBeVisible();

    // Die Zellen hängen mittig unter der Fuge: ihre Mitte liegt auf der Mitte zwischen den Stationen, und sie sind so breit wie eine Station.
    const test = await page.getByTestId("umgebungen-test").boundingBox();
    const l = await page.getByTestId("umgebungen-lokal").boundingBox();
    const s = await page.getByTestId("umgebungen-stage").boundingBox();
    const mitteFuge = (l!.x + l!.width + s!.x) / 2;
    expect(Math.abs(test!.x + test!.width / 2 - mitteFuge)).toBeLessThan(2);
    expect(Math.abs(test!.width - s!.width)).toBeLessThan(1.5);
});

test("🔴 auf Production: dieselbe Leiste, Production ist markiert; was die Umgebung nicht weiß, steht als „nicht bekannt“; erhaltene Releases ehrlich", async ({
    page,
}) => {
    await oeffne(page, {
        environment: "production",
        sicht: { ...SICHT, datei: null, frueher: [], sperre: "nicht_eingerichtet" } as FreigabeSicht,
        route: PRODUCTION_ROUTE,
    });
    const [lokal, stage, production] = await masse(page);
    expect(Math.abs(lokal!.b - production!.b)).toBeLessThan(1.5);
    expect(Math.abs(stage!.b - production!.b)).toBeLessThan(1.5);
    expect(await hier(page)).toEqual(["umgebungen-production"]);
    await expect(page.getByTestId("umgebungen-production")).toContainText("b2ee1b3");
    await expect(page.getByTestId("umgebungen-production-zustand")).toHaveText("erreichbar");
    await expect(page.getByTestId("umgebungen-stage")).toContainText("a7728a1");
    await expect(page.getByTestId("umgebungen-stage-zustand")).toHaveText("läuft");
    // Den Release-Nachweis kennt Production nicht, und freigegeben wird auf der Stage.
    await expect(page.getByTestId("umgebungen-test-zustand")).toHaveText("nicht bekannt");
    await expect(page.getByTestId("umgebungen-test")).toContainText("Den Nachweis kennt Production nicht");
    await expect(page.getByTestId("umgebungen-abnahme")).toContainText(
        "Freigegeben wird mit dem Start des Release-Tests auf Lokal",
    );
    await expect(page.getByTestId("production-release")).toHaveCount(0);
    // Die Zusammenfassung: der laufende Stand, frühere Auslieferungen sind nicht bekannt.
    await expect(page.getByTestId("umgebungen-erhalten-aktuell")).toContainText("b2ee1b3");
    await expect(page.getByTestId("umgebungen-erhalten-unbekannt")).toContainText("nicht bekannt");
    await expect(page.getByTestId("umgebungen-erhalten-liste")).toHaveCount(0);
});

test("auf Production: kennt die Sicht frühere Auslieferungen, stehen sie in der Zusammenfassung", async ({ page }) => {
    await oeffne(page, {
        environment: "production",
        sicht: { ...SICHT, datei: null, sperre: "nicht_eingerichtet" } as FreigabeSicht,
        route: PRODUCTION_ROUTE,
    });
    await expect(page.getByTestId("umgebungen-erhalten-liste")).toContainText("b2ee1b3");
    await expect(page.getByTestId("umgebungen-erhalten-liste")).toContainText("OPS-000122");
    await expect(page.getByTestId("umgebungen-erhalten-unbekannt")).toHaveCount(0);
});

test("🔴 lokal: dieselbe Leiste, Lokal ist markiert; Stage und Production stehen als Strich beziehungsweise „nicht bekannt“; unter dem Pfeil der Zustand des Release-Tests mit Link zur Karte", async ({
    page,
}) => {
    await oeffne(page, { environment: "development", test: TEST });
    const [lokal, stage, production] = await masse(page);
    expect(Math.abs(lokal!.b - stage!.b)).toBeLessThan(1.5);
    expect(Math.abs(stage!.b - production!.b)).toBeLessThan(1.5);
    expect(await hier(page)).toEqual(["umgebungen-lokal"]);
    await expect(page.getByTestId("umgebungen-lokal-zustand")).toHaveText("erreichbar");
    // Der Stage-Stand kommt aus den Git-Notizen; ob die Stage antwortet, weiß Lokal nicht. Production ist ein Strich.
    await expect(page.getByTestId("umgebungen-stage")).toContainText("a7728a1");
    await expect(page.getByTestId("umgebungen-stage")).toContainText("nicht bekannt");
    await expect(page.getByTestId("umgebungen-production")).toContainText("nicht bekannt");
    // Die jüngste Freigabe (WI-0248: aus dem Start des Release-Tests) steht bei Production, mit Person und Stand.
    await expect(page.getByTestId("umgebungen-production")).toContainText("Vali · a7728a1");
    await expect(page.getByTestId("umgebungen-production")).not.toContainText("läuft");

    // Kein Lauf für den Stage-Stand: Der Nachweis fehlt, und er nennt den Stand, der geprüft würde.
    await expect(page.getByTestId("umgebungen-test-zustand")).toHaveText("fehlt");
    await expect(page.getByTestId("umgebungen-test-stand")).toHaveText("Stand a7728a1");
    await expect(page.getByTestId("umgebungen-freigabe-zustand")).toHaveText(
        "Freigabe a7728a1 von Vali: wartet auf den Release-Test",
    );
    // Darunter die Karte mit dem Stand der Tests; der Link führt hin.
    await expect(page.getByTestId("release-test")).toBeVisible();
    await page.getByTestId("umgebungen-test-link").click();
    await expect(page.getByTestId("release-test")).toBeInViewport();
});

test("lokal: ein laufender Test zeigt seinen Fortschritt unter dem Pfeil, ein roter färbt die Pille", async ({
    page,
}) => {
    const laeuft: ReleaseTestSicht = {
        ...TEST,
        lauf: {
            ...TEST.lauf!,
            zustand: "laeuft",
            sha: STAGE_SHA,
            lebt: true,
            fortschritt: 0.35,
            start: new Date().toISOString(),
        },
    };
    await oeffne(page, { environment: "development", test: laeuft });
    await expect(page.getByTestId("umgebungen-test-zustand")).toHaveText("läuft · 35 %");

    const rot: ReleaseTestSicht = {
        ...TEST,
        lauf: { ...TEST.lauf!, zustand: "rot", sha: STAGE_SHA, ende: new Date().toISOString() },
    };
    const zweite = await page.context().newPage();
    await oeffne(zweite, { environment: "development", test: rot });
    await expect(zweite.getByTestId("umgebungen-test-zustand")).toHaveText("rot");
});

test("🔴 Lokal wird beim Öffnen einmal von selbst geprüft, ohne Klick; erneut nur per Knopf", async ({ page }) => {
    let anfragen = 0;
    await page.route(`${LOKAL_ADRESSE}/**`, async (route) => {
        anfragen += 1;
        // Eine kurze Weile ohne Antwort: Währenddessen steht „prüft …“, und die Station behält ihre Höhe.
        await new Promise((fertig) => setTimeout(fertig, 400));
        await route.fulfill({ status: 200, body: "" });
    });
    await oeffne(page, { environment: "staging", sicht: SICHT, route: LOKAL_ROUTE });
    const lokal = page.getByTestId("umgebungen-lokal");
    const zustand = page.getByTestId("umgebungen-lokal-zustand");
    // Nie „noch nicht geprüft“: Schon beim ersten Zeichnen läuft die Probe oder steht ihr Ergebnis da.
    await expect(zustand).not.toContainText("noch nicht geprüft");
    await expect(zustand).toContainText("prüft");
    expect((await lokal.boundingBox())!.height).toBeCloseTo(STATION_HOEHE, 0);
    await expect(zustand).toHaveText(/^\s*erreichbar · \d+ ms\s*$/);
    expect((await lokal.boundingBox())!.height).toBeCloseTo(STATION_HOEHE, 0);
    expect(anfragen).toBe(1);
    // Das Panel zeigt dasselbe Ergebnis; der Knopf „Prüfen“ nimmt denselben Weg.
    await expect(page.getByTestId("umgebungen-probe-ergebnis")).toHaveText(/^\s*erreichbar · \d+ ms\s*$/);
    await page.getByTestId("umgebungen-pruefen").click();
    await expect.poll(() => anfragen).toBe(2);
    await expect(zustand).toHaveText(/^\s*erreichbar · \d+ ms\s*$/);
});

test("Lokal: antwortet die Adresse nicht, sagt die Station es von selbst", async ({ page }) => {
    await page.route(`${LOKAL_ADRESSE}/**`, (route) => route.abort("failed"));
    await oeffne(page, { environment: "staging", sicht: SICHT, route: LOKAL_ROUTE });
    await expect(page.getByTestId("umgebungen-lokal-zustand")).toHaveText("antwortet diesem Browser nicht");
    await expect(page.getByTestId("umgebungen-lokal")).toContainText("rechner.tail0000.ts.net");
    expect((await page.getByTestId("umgebungen-lokal").boundingBox())!.height).toBeCloseTo(STATION_HOEHE, 0);
});

test("beim Öffnen des Reiters fragt die Ansicht einmal frisch nach (Stage und Production aus der Route), nicht doppelt nach dem Laden des Fensters", async ({
    page,
}) => {
    let route = 0;
    await oeffne(page, {
        environment: "staging",
        sicht: SICHT,
        route: STAGE_ROUTE,
        beiAnruf: (pfad) => {
            if (pfad.startsWith(UMGEBUNGEN_URL)) route += 1;
        },
        ort: { url: "/?verwaltung=versionen", warteAuf: "verwaltung-eintrag-production" },
    });
    // Das Fenster hat beim Öffnen geladen, auch den Stand der Umgebungen.
    await expect.poll(() => route).toBe(1);
    // Gleich in den Reiter: Was eben erst geladen wurde, wird nicht noch einmal geholt.
    await page.getByTestId("verwaltung-eintrag-production").click();
    await page.getByTestId("umgebungen-leiste").waitFor();
    await page.waitForTimeout(800);
    expect(route).toBe(1);
    // Später wieder hinein: Der Stand ist alt, die Ansicht fragt beim Öffnen einmal nach.
    await page.getByTestId("verwaltung-eintrag-versionen").click();
    await page.waitForTimeout(5_500);
    await page.getByTestId("verwaltung-eintrag-production").click();
    await expect.poll(() => route).toBe(2);
    await page.waitForTimeout(800);
    expect(route).toBe(2);
});

test("🔴 lange Texte lassen die Stationen nicht wachsen und laufen nicht über den Rand", async ({ page }) => {
    const lang =
        "Proben und Journal gruen; Sammellauf gruen; Release-Nachweis gruen und die Seitenprobe der Stage ohne Auffälligkeit ".repeat(
            2,
        );
    const sicht = {
        ...SICHT,
        datei: { ...SICHT.datei!, stageGruen: null, stagePruefung: lang.slice(0, 200), nachweis: "fehlt" },
    } as FreigabeSicht;
    await page.route(`${LOKAL_ADRESSE}/**`, (route) => route.abort("failed"));
    await oeffne(page, { environment: "staging", sicht, route: LOKAL_ROUTE });
    await expect(page.getByTestId("umgebungen-lokal-zustand")).toHaveText("antwortet diesem Browser nicht");
    for (const kasten of await masse(page)) expect(Math.abs(kasten.h - STATION_HOEHE)).toBeLessThan(1.5);
    for (const id of ["umgebungen-lokal", "umgebungen-stage", "umgebungen-production"])
        expect((await randUeberhang(page, id)).breit, id).toBe(0);
    // Die Prüfung ist eine eigene Zeile, auch wenn sie offen ist; die Erreichbarkeit steht davon getrennt.
    await expect(page.getByTestId("umgebungen-stage-zustand")).toHaveText("erreichbar");
    await expect(page.getByTestId("umgebungen-stage")).toContainText("noch nicht geprüft");
});

test.describe("am Telefon", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("🔴 die Stationen stehen untereinander, gleich breit, und nichts ist breiter als das Fenster", async ({
        page,
    }) => {
        await oeffne(page, { environment: "staging", sicht: SICHT, route: STAGE_ROUTE });
        const [lokal, stage, production] = await masse(page);
        expect(Math.abs(lokal!.b - stage!.b)).toBeLessThan(1.5);
        expect(Math.abs(stage!.b - production!.b)).toBeLessThan(1.5);
        const boxen = await Promise.all(
            ["umgebungen-lokal", "umgebungen-stage", "umgebungen-production"].map((id) =>
                page.getByTestId(id).boundingBox(),
            ),
        );
        // Untereinander: jede beginnt unter dem Ende der vorigen.
        expect(boxen[1]!.y).toBeGreaterThan(boxen[0]!.y + boxen[0]!.height - 1);
        expect(boxen[2]!.y).toBeGreaterThan(boxen[1]!.y + boxen[1]!.height - 1);
        // Untereinander folgt die Höhe dem Inhalt, ohne Mindestmaß (nichts wird abgeschnitten, nichts rollt in der Station, kein leerer Rest):
        // mindestens eine der kurzen Stationen bleibt unter den 300 px des Rasters.
        expect(Math.min(...boxen.map((box) => box!.height))).toBeLessThan(STATION_HOEHE - 20);
        for (const id of ["umgebungen-lokal", "umgebungen-stage", "umgebungen-production"])
            expect((await randUeberhang(page, id)).hoch, id).toBeLessThanOrEqual(1);
        const fenster = await page.getByTestId("systemsteuerung-fenster").boundingBox();
        for (const box of boxen) {
            expect(box!.x).toBeGreaterThanOrEqual(fenster!.x - 1);
            expect(box!.x + box!.width).toBeLessThanOrEqual(fenster!.x + fenster!.width + 1);
        }
        // Kein waagerechtes Rollen der Seite.
        const ueberlauf = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(ueberlauf).toBeLessThanOrEqual(0);
        await expect(page.getByTestId("umgebungen-abnahme").getByTestId("umgebungen-freigabe-zustand")).toBeVisible();
    });
});
