import { expect, test, type Page, type Request } from "@playwright/test";
import { chooseFromFan, chooseView, openMap, showLandscapes } from "./map-handle.ts";
import { showStages } from "./stage-groups.ts";

/**
 * Was die Karte der anonymen Zählung wirklich meldet (WI-0159, `BESUCH-0001 §13 D`).
 *
 * 🔴 **Warum das hier steht und nicht in Vitest:** Die Ausprägungen und der Zählpfad sind dort geprüft
 * (`display-zaehlung.test.ts`, `besucher-zaehler.test.ts`), aber nicht die Naht dazwischen - ob der Klick den Sender
 * wirklich erreicht. Genau diese Naht hat WI-0157 gekostet: Alles stand bereit, nur meldete niemand. Vue-Komponenten
 * prüft dieses Repository im Browser, also steht die Zusage hier.
 *
 * 🪤 Die Meldungen gehen gebündelt weg (`BUENDEL_MS`, 4 s) oder sobald zwanzig beisammen sind. Darum wartet der Test auf
 * die Anfrage, statt nach einer festen Pause nachzusehen.
 */

/** Alle Ereignisse, die der Browser an `/api/besuch` geschickt hat, als `metrik=ausprägung`. */
function horchen(page: Page): string[] {
    const gemeldet: string[] = [];
    page.on("request", (anfrage: Request) => {
        if (!anfrage.url().endsWith("/api/besuch") || anfrage.method() !== "POST") return;
        const roh = anfrage.postData();
        if (roh === null) return;
        const koerper = JSON.parse(roh) as { ereignisse: { metrik: string; dimension?: string }[] };
        for (const ereignis of koerper.ereignisse) {
            gemeldet.push(`${ereignis.metrik}=${ereignis.dimension ?? ""}`);
        }
    });
    return gemeldet;
}

/** Wartet, bis eine Meldung mit diesem Eintrag angekommen ist. */
async function warteAuf(page: Page, gemeldet: string[], eintrag: string): Promise<void> {
    await expect
        .poll(() => gemeldet, { timeout: 15_000, message: `„${eintrag}“ wurde nie gemeldet` })
        .toContain(eintrag);
}

test("🔴 ein umgelegter Anzeigeschalter meldet sich mit Legacys Schlüssel", async ({ page }) => {
    const gemeldet = horchen(page);
    await openMap(page);

    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-menu")).toBeVisible();
    // „Wege" ist in der Standardansicht an; der Klick legt sie aus.
    await page.getByTestId("display-paths").click();

    await warteAuf(page, gemeldet, "display_toggle=togglePaths:off");

    // Und zurück: beide Richtungen zählen, wie bei Legacy (`toggleRivers:on` 6.853, `toggleRivers:off` 3.068).
    await page.getByTestId("display-paths").click();
    await warteAuf(page, gemeldet, "display_toggle=togglePaths:on");
});

test("🔴 ein Wetterschalter im Auge meldet sich mit der Wetter-Kennung (WI-0288)", async ({ page }) => {
    const gemeldet = horchen(page);
    await openMap(page);

    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-menu")).toBeVisible();
    // Vorgabe ist aus: Der Klick schaltet die Wolken ein. Zurück geht dieser Lauf nicht - mit SwiftShader hält die Engine die Seite so
    // lange auf, dass der zweite Klick nie ankommt; `klickeWetter` meldet beide Richtungen, geprüft in `wetter-schalter.test.ts`.
    await page.getByTestId("display-wetter-wolken").click();
    await warteAuf(page, gemeldet, "display_toggle=wetter_wolken:on");
    // 🪤 Die Leistungsmessung (`wetter_lauf`, `wetter_bildrate` …) braucht ein `bereit` der Engine und 20 s sichtbaren Lauf; das prüft
    // `wetter-messung.test.ts` mit Uhr von Hand, nicht dieser Lauf.
});

test("🔴 die Ortsklassen melden die höchste sichtbare Klasse, nicht den angeklickten Knopf", async ({ page }) => {
    const gemeldet = horchen(page);
    await openMap(page);

    await page.getByTestId("display-open").click();
    await expect(page.getByTestId("display-menu")).toBeVisible();
    // Die Kaskade: Ein Klick auf „Stadt" (dritte Klasse) zeigt die Klassen 1 bis 3, und gemeldet wird die dritte.
    await page.getByTestId("display-place-stadt").click();

    await warteAuf(page, gemeldet, "display_toggle=stadt:on");
});

test("🔴 eine gewählte Landschaftsebene meldet sich als die Ebene selbst", async ({ page }) => {
    const gemeldet = horchen(page);
    await openMap(page);

    await showLandscapes(page, "klima");

    await warteAuf(page, gemeldet, "eco_kind=klima");
});

test("eine geöffnete Karte meldet keine Wahl - gezählt wird das Umschalten, nicht der Startzustand", async ({
    page,
}) => {
    const gemeldet = horchen(page);
    await openMap(page);

    // Der Seitenaufruf geht sofort weg; danach wartet nichts anderes auf das Bündel.
    await warteAuf(page, gemeldet, "pageview=");
    await page.waitForTimeout(4500);

    // 🔴 Wer mit `?view=political` ankommt, hat nichts gewählt (Legacy verlor daran ein halbes Jahr Statistik).
    expect(
        gemeldet.filter((eintrag) => eintrag.startsWith("display_toggle=")),
        "kein Schalter wurde umgelegt",
    ).toEqual([]);
    expect(
        gemeldet.filter((eintrag) => eintrag.startsWith("eco_kind=")),
        "keine Ebene wurde gewählt",
    ).toEqual([]);
});

/** Eine gerechnete Reise, wie `playmode.spec.ts` sie öffnet: Der Planer steht, die Leiste ist da. */
async function oeffneReise(page: Page): Promise<void> {
    await page.goto("/?route=Gareth~Perricum");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await showStages(page, 15_000);
    await expect(page.getByTestId("route-player")).toBeVisible();
}

test("🔴 eine gerechnete Reise meldet jeden angesteuerten Ort", async ({ page }) => {
    const gemeldet = horchen(page);
    await oeffneReise(page);

    // Die Namen kommen aus UNSERER Antwort, nicht aus den Feldern: Der Link trägt Kennungen, der Server löst sie auf.
    await warteAuf(page, gemeldet, "route_waypoint=Gareth");
    await warteAuf(page, gemeldet, "route_waypoint=Perricum");
    // Und die Route selbst, als Paar (WI-0157).
    await warteAuf(page, gemeldet, "route=Gareth → Perricum");
});

test("🔴 das aufgeklappte Höhenprofil und die laufende Wiedergabe melden sich je einmal", async ({ page }) => {
    const gemeldet = horchen(page);
    await oeffneReise(page);

    await page.getByTestId("profile-toggle").click();
    await warteAuf(page, gemeldet, "profile=");

    await page.getByTestId("player-play").click();
    await warteAuf(page, gemeldet, "play=");

    // 🔴 Einmal je Besuch: Zuklappen und erneut Aufklappen, Pause und erneut Spielen zählen nicht zweimal.
    await page.getByTestId("profile-toggle").click();
    await page.getByTestId("profile-toggle").click();
    await page.getByTestId("player-play").click();
    await page.getByTestId("player-play").click();
    await page.waitForTimeout(4500);

    expect(gemeldet.filter((eintrag) => eintrag === "profile=")).toHaveLength(1);
    expect(gemeldet.filter((eintrag) => eintrag === "play=")).toHaveLength(1);
});

/**
 * Die Kartenwahl und das Zoomband (WI-0161). Bis dahin hingen alle drei an `hashchange`, und der Hash wird nur mit
 * `replaceState` geschrieben - diese vier Fälle wären vorher rot gewesen.
 */

/** Die Karte an diese Stelle bringen und auf ihre Ruhe warten. */
async function fahre(page: Page, nach: { zoom?: number; neigung?: number }): Promise<void> {
    await page.evaluate(async (ziel) => {
        const karte = globalThis.avesmapsMap;
        if (!karte) throw new Error("map handle missing");
        await new Promise<void>((fertig) => {
            karte.once("moveend", () => fertig());
            karte.jumpTo({
                ...(ziel.zoom === undefined ? {} : { zoom: ziel.zoom }),
                ...(ziel.neigung === undefined ? {} : { pitch: ziel.neigung }),
            });
        });
    }, nach);
}

test("🔴 eine gewählte Ansicht meldet sich mit unserem Schlüssel, nicht mit Legacys", async ({ page }) => {
    const gemeldet = horchen(page);
    await openMap(page);

    await chooseView(page, "powerlines");

    // 🪤 `powerlines` ist bei uns und bei Legacy derselbe Schlüssel; `standard` hieß dort `deregraphic`, und das
    // schreibt erst der Leseweg um (`LEGACY_DIMENSIONEN`). Der Sender schickt immer den heutigen Schlüssel.
    await warteAuf(page, gemeldet, "map_mode=powerlines");
});

test("🔴 ein gewählter Untergrund meldet Serie und Ansicht", async ({ page }) => {
    const gemeldet = horchen(page);
    await openMap(page);

    // Die Unterreihe der Standardansicht trägt die drei Serien; `original` ist nicht die Vorgabe (`modern`).
    await chooseFromFan(page, "standard", "fan-series-original");

    await warteAuf(page, gemeldet, "map_style=original");
});

test("🔴 die Derographie meldet ihre Ebene, auch die Vorgabe, und die Unterwahl der Topographie", async ({ page }) => {
    const gemeldet = horchen(page);
    await openMap(page);

    // 🔴 Die Kachel allein zeigt schon eine Ebene (WI-0286): Bis dahin zählte nur der Wechsel, und „Alle“ kam kaum vor.
    await chooseView(page, "landscapes");
    await warteAuf(page, gemeldet, "eco_kind=alle");

    await chooseFromFan(page, "landscapes", "fan-layer-klima");
    await warteAuf(page, gemeldet, "eco_kind=klima");
});

test("🔴 die Karte auf einer anderen Zoomstufe gemeldet - einmal je Stufe, nicht je Bild", async ({ page }) => {
    const gemeldet = horchen(page);
    await openMap(page);

    // Erst ganz nah (Stufe 7), dann weit heraus (Stufe 2): ein Wechsel je Stufe.
    await fahre(page, { zoom: 8 });
    await fahre(page, { zoom: 3 });
    await warteAuf(page, gemeldet, "zoom_stufe=2");

    // Zwei weitere Fahrten INNERHALB von Stufe 2 melden nichts dazu.
    const vorher = gemeldet.filter((eintrag) => eintrag.startsWith("zoom_stufe=")).length;
    await fahre(page, { zoom: 3.4 });
    await fahre(page, { zoom: 3.8 });
    await page.waitForTimeout(4500);
    expect(
        gemeldet.filter((eintrag) => eintrag.startsWith("zoom_stufe=")),
        "keine Stufe gewechselt",
    ).toHaveLength(vorher);
});

test("🔴 eine geneigte Karte meldet die dritte Dimension", async ({ page }) => {
    const gemeldet = horchen(page);
    await openMap(page);

    // 🔴 Der Regressionsfall: Der Haken hing am Entwicklungs-Handle, das es im Release nicht gibt und das beim
    // Einhängen auch lokal noch fehlte. `tilt` hatte seit WI-0138 keine einzige Zeile, in keiner Umgebung.
    await fahre(page, { neigung: 55 });

    await warteAuf(page, gemeldet, "tilt=");
});
