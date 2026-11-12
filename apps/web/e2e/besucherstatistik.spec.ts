import { expect, test } from "@playwright/test";
import { oeffneStatistik, ZAHLEN } from "./besucherstatistik-stub.ts";

/**
 * Die Besucherstatistik im Editorpanel (WI-0138 V4, BESUCH-0001 §7): Reiter „Status“ → „Besucher“ und „Editoren“.
 * Geprüft wird die Ansicht; die Schreibwege der Zählung bleiben außen vor.
 */

test.describe("Besucherstatistik im Editorpanel", () => {
    test("der Reiter „Status“ zeigt Besucher und Editoren getrennt", async ({ page }) => {
        await oeffneStatistik(page);
        await page.getByRole("tab", { name: "Status" }).click();

        const panel = page.getByTestId("editor-panel");
        // Die Unterreiter sind ein Segmentschalter des Hauses (Guide §13.25), kein eigenes Bauteil.
        await expect(panel.getByTestId("statistik-sorte-besucher")).toHaveAttribute("aria-pressed", "true");
        await expect(panel.getByTestId("statistik-sorte-editoren")).toBeVisible();
        await expect(panel.getByTestId("statistik-sorte-api")).toBeEnabled();

        await expect(panel.getByText("21.156")).toBeVisible();
        // Exakt: Die Achse der Startzeit des Wetters trägt „15“ und „20“ nebeneinander, als Text „…1520…“.
        await expect(panel.getByText("520", { exact: true })).toBeVisible();
        // „bis 18“ steht zweimal: in der Kachel und in der Legende der Editorenlinie (eigene Skala).
        await expect(panel.getByText("bis 18").first()).toBeVisible();
        await expect(panel.getByText("Keine IP-Adressen.")).toBeVisible();

        // Die andere Sorte ist dieselbe Ansicht, nur mit der anderen Zahlenreihe.
        await panel.getByTestId("statistik-sorte-editoren").click();
        await expect(panel.getByText("21.156")).toBeVisible();
    });

    test("Stufe 2: Herkunft als Karte, Geräte aufgeschlüsselt, Kartennutzung, CSV", async ({ page }) => {
        await oeffneStatistik(page);
        await page.getByRole("tab", { name: "Status" }).click();
        const panel = page.getByTestId("editor-panel");

        // Die Karte kommt erst mit dem Reiter (160 KB Umrisse, dynamisch geladen).
        await expect(panel.locator("svg.statistik__karte path").first()).toBeVisible();
        // Jedes Merkmal für sich: Gerät, System, Browser, Fenster, Fähigkeiten.
        await expect(panel.getByText("Betriebssystem")).toBeVisible();
        await expect(panel.getByText("Browser", { exact: true })).toBeVisible();
        await expect(panel.getByText("3D-fähig")).toBeVisible();
        // Was auf der Karte getan wird.
        await expect(panel.getByText("Kartenansicht")).toBeVisible();
        await expect(panel.getByText("Wie nah herangegangen wird")).toBeVisible();
        await expect(panel.getByText("Gesuchte Ziele")).toBeVisible();
        await expect(panel.getByText("Die dritte Dimension")).toBeVisible();
        // Technische Schlüssel tragen ihren Namen.
        await expect(panel.getByText("Finger statt Maus")).toBeVisible();
        await expect(panel.getByText("nur in 2D angesehen")).toBeVisible();
        await expect(panel.getByText("in 3D angesehen", { exact: true })).toBeVisible();
    });

    /** WI-0286: das Histogramm der Zoomstufen, die Ebenen unter „Derographie“, zwei Sprachen und das Design. */
    test("Zoomstufen als Histogramm, Ebenen unter ihrer Ansicht, Sprachen und Design getrennt", async ({ page }) => {
        await oeffneStatistik(page);
        await page.getByRole("tab", { name: "Status" }).click();
        const panel = page.getByTestId("editor-panel");

        const zoom = panel.getByTestId("statistik-zoom");
        await expect(zoom.locator(".statistik__zoomBalken")).toHaveCount(9);
        await expect(panel.getByText("Median 4 · Mittel 3,9")).toBeVisible();

        const ansicht = panel.locator('section:has(h3:text-is("Kartenansicht"))');
        await expect(ansicht.locator(".statistik__balken--stufe1", { hasText: "Klimazonen" })).toBeVisible();
        await expect(ansicht.locator(".statistik__balken--stufe2", { hasText: "Höhenstufen" })).toBeVisible();

        await expect(panel.getByText("Sprache des Browsers")).toBeVisible();
        await expect(panel.getByText("Eingestellte Sprache")).toBeVisible();
        const theme = panel.locator('section:has(h3:text-is("Theme"))');
        await expect(theme.getByText("Hell", { exact: true })).toBeVisible();
        await expect(theme.getByText("Dunkel", { exact: true })).toBeVisible();

        // „statistik.fenster“ trägt einen Platzhalter und gehört der Zeile „Anwesend jetzt“; der Block hieß roh „Fenster {minuten} min“.
        await expect(panel.getByText("Fensterbreite")).toBeVisible();
        await expect(panel.getByText("{minuten}")).toHaveCount(0);
    });

    /**
     * WI-0191 (Kanal OPS-000016, Thomas: „Bitte die Statistiken die mehr als die angezeigten 8 EInträge haben ausklappbar
     * machen.“). Der Stub trägt zwölf Länder; acht stehen da, der Knopf holt die übrigen vier.
     */
    test("eine Liste mit mehr als acht Einträgen klappt auf und wieder zu", async ({ page }) => {
        await oeffneStatistik(page);
        await page.getByRole("tab", { name: "Status" }).click();
        const panel = page.getByTestId("editor-panel");

        const laender = panel.locator('section:has(h3:text-is("Länder"))');
        await expect(laender.locator(".statistik__balken")).toHaveCount(8);
        // Der zwölfte Eintrag (120) steht erst nach dem Klick da; sein Name käme aus Intl und wäre vom Browser abhängig.
        await expect(laender.getByText("120", { exact: true })).toHaveCount(0);

        const knopf = panel.getByTestId("statistik-mehr-land");
        await expect(knopf).toHaveText("Alle 12 zeigen");
        await knopf.click();
        await expect(laender.locator(".statistik__balken")).toHaveCount(12);
        await expect(laender.getByText("120", { exact: true })).toBeVisible();

        // Eine andere Liste bleibt davon unberührt: Der Zustand gehört dem Block.
        const suche = panel.locator('section:has(h3:text-is("Gesuchte Ziele"))');
        await expect(suche.locator(".statistik__balken")).toHaveCount(8);

        await expect(knopf).toHaveText("Weniger");
        await knopf.click();
        await expect(laender.locator(".statistik__balken")).toHaveCount(8);
    });

    /** Hat der Server gekürzt, behauptet der offene Block nicht „alle“, sondern nennt die Gesamtzahl (WI-0191 A9). */
    test("ein gekürzter Block sagt, wie viele Einträge es insgesamt gibt", async ({ page }) => {
        await oeffneStatistik(page);
        await page.getByRole("tab", { name: "Status" }).click();
        const panel = page.getByTestId("editor-panel");

        const suche = panel.locator('section:has(h3:text-is("Gesuchte Ziele"))');
        await panel.getByTestId("statistik-mehr-suche").click();
        await expect(suche.locator(".statistik__balken")).toHaveCount(10);
        await expect(suche.getByText("Von 318 Einträgen stehen hier die häufigsten 10.")).toBeVisible();
    });

    /** Acht oder weniger: kein Knopf, denn es gibt nichts aufzuklappen (WI-0191 A8). */
    test("eine kurze Liste trägt keinen Knopf", async ({ page }) => {
        await oeffneStatistik(page);
        await page.getByRole("tab", { name: "Status" }).click();
        const panel = page.getByTestId("editor-panel");

        await expect(panel.getByRole("heading", { name: "Geräte" })).toBeVisible();
        await expect(panel.getByTestId("statistik-mehr-geraet")).toHaveCount(0);
    });

    test("der Unterreiter „API“ zeigt, wer die Schnittstellen ruft", async ({ page }) => {
        await oeffneStatistik(page);
        await page.getByRole("tab", { name: "Status" }).click();
        const panel = page.getByTestId("editor-panel");
        await panel.getByTestId("statistik-sorte-api").click();

        await expect(panel.getByText("2,94 Mio")).toBeVisible();
        await expect(panel.getByText("3,2 %")).toBeVisible();
        await expect(panel.getByText("18 Uhr")).toBeVisible();
        // Der Takt steht als Satz daneben, nicht in den Zonen.
        await expect(panel.getByText("812 T", { exact: false })).toBeVisible();
        await expect(panel.getByText("gestorben")).toBeVisible();
        await expect(panel.getByText("offene Schnittstelle")).toBeVisible();
        await expect(panel.getByText("/api/route", { exact: true }).first()).toBeVisible();
        await expect(panel.getByText("point_not_on_land")).toBeVisible();
    });

    test("die Messwerte stehen im Reiter „Server“ und lassen sich herauslösen", async ({ page }) => {
        await oeffneStatistik(page);
        await page.getByRole("tab", { name: "Status" }).click();
        const panel = page.getByTestId("editor-panel");
        // 🔴 Sie stehen im Reiter „Server“, nicht bei den Besuchern (Betreiber 2026-10-14).
        await panel.getByTestId("statistik-sorte-server").click();

        // Angedockt: im Panel, so breit wie dieses. „Wer online ist“ steht hier nicht — das sagt der Besucher-Reiter.
        await expect(panel.getByText("588 MB")).toBeVisible();
        await expect(panel.getByText("Nutzer online")).toHaveCount(0);
        await expect(page.getByTestId("mess-fenster")).toHaveCount(0);

        await panel.getByTestId("statistik-messfenster").click();
        const fenster = page.getByTestId("mess-fenster");
        await expect(fenster).toBeVisible();
        await expect(fenster.getByText("Dieser Browser")).toBeVisible();
        // Gelöst trägt es die Online-Zahlen selbst: der Reiter ist dann nicht im Blick.
        await expect(fenster.getByText("Nutzer online")).toBeVisible();
        // Im Panel stehen die Werte dann nicht doppelt.
        await expect(panel.getByText("588 MB")).toHaveCount(0);

        // Frei heißt: am Kopf zu fassen. Ein Zug verschiebt es.
        // 🪤 Nach rechts oben, nicht nach links unten: Seit WI-0150 (`7f39ab34`, OPS-000002) steht das gelöste Messfenster
        // ohne gemerkte Box schon in der linken unteren Ecke (`vorgabe-ecke="links-unten"`). Ein Zug dorthin wird von
        // `begrenzeBox` auf den Rand geklemmt - aus 120 + 60 px wurden rund 24, und die Probe las das als Fehler.
        const vorher = (await fenster.boundingBox())!;
        await page.mouse.move(vorher.x + vorher.width / 2, vorher.y + 12);
        await page.mouse.down();
        await page.mouse.move(vorher.x + vorher.width / 2 + 120, vorher.y - 60, { steps: 8 });
        await page.mouse.up();
        const nachher = (await fenster.boundingBox())!;
        expect(Math.abs(nachher.x - vorher.x) + Math.abs(nachher.y - vorher.y)).toBeGreaterThan(40);
    });

    // Regressionsfall (Betreiber 2026-10-13: „am rechten rand andocken … funktioniert nicht“, „minimieren geht auch
    // nicht“): Das Fenster hielt seine Lage selbst und war damit taub für den Kopf seiner eigenen Hülle.
    test("das Messfenster dockt an und lässt sich ablegen", async ({ page }) => {
        await oeffneStatistik(page);
        await page.getByRole("tab", { name: "Status" }).click();
        await page.getByTestId("editor-panel").getByTestId("statistik-sorte-server").click();
        await page.getByTestId("editor-panel").getByTestId("statistik-messfenster").click();
        const fenster = page.getByTestId("mess-fenster");
        await expect(fenster).toBeVisible();
        const geloest = (await fenster.boundingBox())!;

        // ▥ dockt an: am rechten Rand, über die volle Höhe der Karte.
        await fenster.getByTestId("fenster-andocken").click();
        await expect(fenster).toHaveAttribute("data-map-overlay", "right");
        const angedockt = (await fenster.boundingBox())!;
        expect(angedockt.height).toBeGreaterThan(geloest.height);
        expect(angedockt.x + angedockt.width).toBeGreaterThan(geloest.x + geloest.width);

        // − legt ab: das Fenster bleibt eingehängt (der Entwurf im Inhalt überlebt), ist aber nicht mehr zu sehen; der
        // Block steht wieder im Reiter „Server“.
        await fenster.getByTestId("fenster-ablegen").click();
        await expect(fenster).not.toBeVisible();
        await expect(page.getByTestId("editor-panel").getByText("588 MB")).toBeVisible();
    });

    test("ohne Schlüssel in der Umgebung steht „unbekannt“, nie 0", async ({ page }) => {
        await oeffneStatistik(page, {
            kennungAktiv: false,
            kennzahlen: { ...ZAHLEN.kennzahlen, eindeutigeMittel: null, besterTag: null, besterTagAm: null },
        });
        await page.getByRole("tab", { name: "Status" }).click();
        await expect(page.getByTestId("editor-panel").getByText("unbekannt").first()).toBeVisible();
    });
});

// WI-0141: der vierte Unterreiter. Die Minute kommt aus den eigenen Abfragen, 24 h und Woche aus dem Server.
test("🔴 der Block „Wetter (experimentell)“ zeigt Schalter, Bildrate mit Einheit und die Familien der Grafikkarte (WI-0288)", async ({
    page,
}) => {
    await oeffneStatistik(page);
    await page.getByRole("tab", { name: "Status" }).click();
    const panel = page.getByTestId("editor-panel");

    // Jede Liste hat Sender, Leser UND Anzeige - ein leerer Block fiele hier auf (Falle 4 der Besucherstatistik).
    for (const titel of [
        "Ein und Aus",
        "Seitenaufrufe",
        "Startzeit",
        "Bildrate",
        "Bildzeit-Spitze",
        "Wolkenauflösung",
        "Grafikkarte",
    ])
        await expect(
            panel.locator(".statistik__titel", { hasText: `Wetter (experimentell) · ${titel}` }),
        ).toBeVisible();
    await expect(panel.getByText("Wolken: an", { exact: true })).toBeVisible();
    // Die Zahlenwerte stehen als EIN Histogramm je Wert (Betreiber 2026-11-08: „kannst du bei den numerischen werten histogramme
    // machen?“, dann „feineres binning und mehrere kategorien in einem histogramm“): alle Klassen als Spalten, je Spalte ein Balken je
    // Gerät, Zahl und Anteil im Titel des Balkens, die Summe je Gerät in der Legende.
    const bildrate = panel.getByTestId("statistik-wetterBildrate");
    await expect(bildrate.locator(".statistik__zoomBalken")).toHaveCount(13);
    await expect(bildrate.locator('[data-geraet="rechner"]')).toHaveCount(13);
    await expect(bildrate.locator('[data-geraet="telefon"]')).toHaveCount(13);
    await expect(bildrate.locator('[title^="Rechner · 50–60 fps: 240"]')).toHaveCount(1);
    await expect(bildrate.locator('[title^="Telefon · <10 fps: 30"]')).toHaveCount(1);
    await expect(
        panel.locator('.statistik__block:has([data-testid="statistik-wetterBildrate"]) .statistik__wetterLegende'),
    ).toContainText("Rechner · 500");
    // Median und Mittel je Gerät (Betreiber 2026-11-08: „median und mittelwert ins histogramm … farbig für die kategorien“): Linien in
    // der Farbe des Geräts, die Werte in der Legende, aus den Klassen geschätzt (Rechner: 54 und 57 fps im Nachbau).
    await expect(panel.getByTestId("statistik-wetterBildrate-legende-rechner")).toContainText("Median 54 · Mittel 57");
    for (const geraet of ["rechner", "telefon"])
        for (const art of ["median", "mittel"])
            await expect(panel.getByTestId(`statistik-wetterBildrate-${art}-${geraet}`)).toHaveCount(1);
    await expect(panel.getByTestId("statistik-wetterSpitze").locator(".statistik__zoomBalken")).toHaveCount(11);
    await expect(panel.getByTestId("statistik-wetterStart").locator(".statistik__zoomBalken")).toHaveCount(14);
    await expect(panel.getByTestId("statistik-wetterAufloesung").locator(".statistik__zoomBalken")).toHaveCount(19);
    await expect(panel.getByText("Rechner · NVIDIA")).toBeVisible();
    await expect(panel.getByText("Telefon · Adreno")).toBeVisible();
    await expect(panel.getByText("Telefon · gleitkomma")).toBeVisible();
});

test("der Unterreiter „Server“ zeigt Minute, Tag, Wochentafel und Verlauf", async ({ page }) => {
    await oeffneStatistik(page);
    await page.getByRole("tab", { name: "Status" }).click();
    const panel = page.getByTestId("editor-panel");

    await panel.getByTestId("statistik-sorte-server").click();
    await expect(panel.getByText("Letzte Minute")).toBeVisible();
    await expect(panel.getByText("24 Stunden")).toBeVisible();
    await expect(panel.getByText("Aktivste Zeiten")).toBeVisible();
    await expect(panel.getByText("168 Stunden aufgezeichnet")).toBeVisible();
    // Die Messwerte stehen oben in diesem Reiter, nicht mehr bei den Besuchern (Betreiber 2026-10-14).
    await expect(panel.getByText("505 MB").or(panel.getByText("588 MB"))).toBeVisible();

    // Die Linien stehen als Züge da; eine Lücke trennt sie, statt die Linie auf null zu ziehen.
    await expect.poll(() => panel.locator("polyline").count()).toBeGreaterThan(2);

    // Die Zahlen der Besucher stehen hier nicht - der Reiter zeigt den Server.
    await expect(panel.getByText("Anwesend jetzt")).toHaveCount(0);
});

// WI-0141b, WI-0276: die Editorenliste unter der Anwesenheit, als Visitenkarten.
test("der Unterreiter „Editoren“ zeigt, wer was tut, und klappt die letzten Änderungen auf", async ({ page }) => {
    await oeffneStatistik(page);
    await page.getByRole("tab", { name: "Status" }).click();
    const panel = page.getByTestId("editor-panel");

    await panel.getByTestId("statistik-sorte-editoren").click();
    const liste = panel.getByTestId("editoren-liste");
    await expect(liste.getByText("Rondrikan")).toBeVisible();

    // Wer da ist, steht offen; die übrigen sind zu, bis jemand nachschaut.
    await expect(panel.getByTestId("editoren-gruppe-online")).toContainText("Online: 2");
    const inaktiv = panel.getByTestId("editoren-gruppe-inaktiv");
    await expect(inaktiv).toContainText("Inaktiv: 1");
    await expect(liste.getByText("alrik")).toBeHidden();
    await inaktiv.click();
    await expect(liste.getByText("alrik")).toBeVisible();

    // Rolle und eigene Beschreibung stehen auf der Karte, ohne dass man aufklappt.
    const karten = liste.getByTestId("editor-karte");
    // Die Rollen in der Wortform der Person (WI-0279 E9b, E10). Sonderrollen zählt die Karte nur, die Namen stehen im Hinweis und kommen beim Aufklappen.
    await expect(karten.nth(0).getByText("Betreiberin")).toBeVisible();
    const zahl = karten.nth(0).getByTestId("editor-karte-sonderrollen-zahl");
    await expect(zahl).toHaveText("+2");
    await expect(zahl).toHaveAttribute("title", "Ortskundige (Greifenfurt, Weiden), Kuratorin");
    await expect(karten.nth(0).getByTestId("editor-karte-sonderrolle")).toHaveCount(0);
    await expect(karten.nth(0).getByText("Karte und Routen")).toBeVisible();

    // Was jemand gerade tut, sagt das Band: das Objekt der Sperre, die Ansicht oder die letzte Änderung.
    const baender = liste.getByTestId("editor-band");
    await expect(baender.nth(0)).toContainText("bearbeitet");
    await expect(baender.nth(0)).toContainText("Weg Tarle");
    await expect(baender.nth(0)).toContainText("Form");
    await expect(baender.nth(0)).toContainText("seit 12 Min.");
    await expect(baender.nth(1)).toContainText("sitzt an");
    await expect(baender.nth(1)).toContainText("Derographie");
    await expect(baender.nth(2)).toContainText("zuletzt");
    await expect(baender.nth(2)).toContainText("Ort Luring");

    await expect(panel.getByTestId("editoren-legende")).toContainText("bearbeitet");
    await expect(panel.getByTestId("editoren-legende")).toContainText("nicht da");

    // Zu, bis jemand draufklickt; erst dann fragt die Karte nach den letzten Änderungen dieser Person.
    await expect(panel.getByText("Chrome auf Windows")).toHaveCount(0);
    const frage = page.waitForRequest((anfrage) => anfrage.url().includes("/api/editor/changes?"));
    await liste.getByText("Rondrikan").click();
    expect(new URL((await frage).url()).searchParams.get("person")).toBe("p1");
    const mehr = liste.getByTestId("editor-mehr");
    const pillen = mehr.getByTestId("editor-karte-sonderrolle");
    await expect(pillen).toHaveText(["Ortskundige", "Kuratorin"]);
    await expect(pillen.nth(0)).toHaveAttribute("title", "Ortskundige (Greifenfurt, Weiden)");
    await expect(zahl).toHaveCount(0);
    await expect(mehr).toContainText("Chrome auf Windows");
    await expect(mehr).toContainText("an 27 von 30 Tagen");
    await expect(mehr).toContainText("3 Änderungen");
    await expect(mehr).toContainText("Luring verschoben");

    // Höchstens eine Karte ist offen.
    await liste.getByText("alrik").click();
    await expect(liste.getByTestId("editor-mehr")).toHaveCount(1);
    await liste.getByText("Rondrikan").click();

    // Der Knopf führt in den Reiter „Änderungen“, gefiltert auf die Person.
    const gefiltert = page.waitForRequest(
        (anfrage) => anfrage.url().includes("/api/editor/changes?") && anfrage.url().includes("person=p1"),
    );
    await liste.getByTestId("editor-alle-aenderungen").click();
    await gefiltert;
    await expect(page.getByRole("tab", { name: "Änderungen", selected: true })).toBeVisible();
});

// WI-0138 V11: Was nicht klappt, war bisher gezählt und nirgends zu sehen.
test("🔴 der Trichter der Editorenliste wählt nach Sonderrolle (WI-0279 E9b)", async ({ page }) => {
    await oeffneStatistik(page);
    await page.getByRole("tab", { name: "Status" }).click();
    const panel = page.getByTestId("editor-panel");
    await panel.getByTestId("statistik-sorte-editoren").click();
    const liste = panel.getByTestId("editoren-liste");
    await expect(liste.getByTestId("editor-karte").first()).toBeVisible();
    await panel.getByTestId("editoren-gruppe-inaktiv").click();
    const alle = await liste.getByTestId("editor-karte").count();
    expect(alle).toBeGreaterThan(1);

    await page.getByTestId("editoren-filter").click();
    await page.getByLabel("Kurator:in").check();
    await expect(liste.getByTestId("editor-karte")).toHaveCount(1);
    await expect(liste.getByTestId("editor-karte").first()).toContainText("Rondrikan");
});

test("🔴 die Suche der Editorenliste findet Name und Zuständigkeit", async ({ page }) => {
    await oeffneStatistik(page);
    await page.getByRole("tab", { name: "Status" }).click();
    const panel = page.getByTestId("editor-panel");
    await panel.getByTestId("statistik-sorte-editoren").click();
    const liste = panel.getByTestId("editoren-liste");
    await expect(liste.getByTestId("editor-karte").first()).toBeVisible();
    const feld = panel.getByTestId("editoren-leiste").locator("input");
    await feld.fill("nics");
    await expect(liste.getByTestId("editor-karte")).toHaveCount(1);
    await expect(liste.getByTestId("editor-karte").first()).toContainText("nics");
    await feld.fill("Karte und Routen");
    await expect(liste.getByTestId("editor-karte").first()).toContainText("Rondrikan");
});

test("die Statistik zeigt vergebliche Suchen und Routen ohne Ergebnis", async ({ page }) => {
    await oeffneStatistik(page);
    await page.getByRole("tab", { name: "Status" }).click();
    const panel = page.getByTestId("editor-panel");

    await expect(panel.getByText("Suchen ohne Treffer")).toBeVisible();
    await expect(panel.locator(".statistik__kachelZahl", { hasText: "318" })).toBeVisible();

    await expect(panel.getByText("Routen ohne Ergebnis")).toBeVisible();
    // Der Grund steht als Satz da, nicht als Code des Routers.
    await expect(panel.getByText("keine Route gefunden")).toBeVisible();
    await expect(panel.getByText("Punkt liegt im Wasser")).toBeVisible();

    await expect(panel.getByRole("heading", { name: "Angesehen" })).toBeVisible();
    await expect(panel.getByText("Orte", { exact: true })).toBeVisible();
});

// WI-0213 (Betreiber 2026-10-16): zwei Kacheln mehr im Zeitraum, die dritte Reihe ist damit voll.
test("die Statistik zeigt die meisten zugleich Anwesenden und die Besuchszeit", async ({ page }) => {
    await oeffneStatistik(page);
    await page.getByRole("tab", { name: "Status" }).click();
    const panel = page.getByTestId("editor-panel");

    const gleichzeitig = panel.getByTestId("statistik-gleichzeitig");
    await expect(gleichzeitig).toContainText("Meiste gleichzeitig anwesend");
    await expect(gleichzeitig.locator(".statistik__kachelZahl")).toHaveText("64");
    // 🔴 Unter der Zahl der Tag der Spitze, wie beim besten Tag (Betreiber 2026-10-19: „wir wollen hier das datum haben WANN die meisten
    // gleichzeitig anwesend waren / genauso wie / Bester Tag / 17 / 2026-10-17 <-- neu“).
    await expect(gleichzeitig.locator(".statistik__kachelZusatz")).toHaveText("2026-10-07");
    const besterTag = panel.getByTestId("statistik-bester-tag");
    await expect(besterTag.locator(".statistik__kachelZahl")).toHaveText("1.080");
    await expect(besterTag.locator(".statistik__kachelZusatz")).toHaveText("2026-10-04");

    // Mittel 210 s und Median 40 s aus derselben Verweildauer wie der Block darunter.
    const besuchszeit = panel.getByTestId("statistik-besuchszeit");
    await expect(besuchszeit).toContainText("Besuchszeit, Mittel / Median");
    await expect(besuchszeit.locator(".statistik__kachelZahl")).toHaveText("3:30 / 0:40");

    await expect(panel.locator(".statistik__kacheln > .statistik__kachel")).toHaveCount(9);
});

test("ohne Messung steht ein Strich statt einer 0, und kein Datum", async ({ page }) => {
    await oeffneStatistik(page, {
        kennzahlen: {
            ...ZAHLEN.kennzahlen,
            gleichzeitigSpitze: null,
            gleichzeitigAm: null,
            editorenSpitze: null,
            editorenAb: null,
        },
        dauer: { sitzungen: 0, median: null, mittel: null, koerbe: [], ohne: 0 },
    });
    await page.getByRole("tab", { name: "Status" }).click();
    const panel = page.getByTestId("editor-panel");

    const gleichzeitig = panel.getByTestId("statistik-gleichzeitig");
    await expect(gleichzeitig.locator(".statistik__kachelZahl")).toHaveText("–");
    await expect(gleichzeitig.locator(".statistik__kachelZusatz")).toHaveCount(0);
    await expect(panel.getByTestId("statistik-besuchszeit").locator(".statistik__kachelZahl")).toHaveText("–");
    // Vor der Kopfzählung (2026-11-11) keine Editorenzahl: Die alte Reihe zählte Geräte.
    const koepfe = panel.getByTestId("statistik-koepfe");
    await expect(koepfe.locator(".statistik__kachelZahl")).toHaveText("–");
    await expect(koepfe.locator(".statistik__kachelZusatz")).toHaveCount(0);
});

// Vali 2026-11-11: „7 T“ gewählt, darüber stand 2026-10-13 – 2026-11-11. Der Reiter öffnet mit 30 Tagen (Stage 1,5 s), die Woche kam
// in 30 ms; die spätere Antwort der 30 Tage überschrieb sie.
test("🔴 die Wahl „7 T“ gilt, auch wenn die 30 Tage danach ankommen", async ({ page }) => {
    await oeffneStatistik(page);
    let gibDreissigFrei: () => void = () => undefined;
    const dreissigFrei = new Promise<void>((frei) => (gibDreissigFrei = frei));
    await page.route("**/api/besuch/zahlen*", async (route) => {
        const tage = Number(new URL(route.request().url()).searchParams.get("tage"));
        if (tage === 30) await dreissigFrei;
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ...ZAHLEN, tage, von: tage === 7 ? "2026-10-06" : ZAHLEN.von }),
        });
    });
    await page.getByRole("tab", { name: "Status" }).click();
    const panel = page.getByTestId("editor-panel");

    await panel.getByTestId("statistik-zeitraum-7").click();
    await expect(panel.getByText("2026-10-06 – 2026-10-12")).toBeVisible();

    const spaet = page.waitForResponse((antwort) => antwort.url().includes("tage=30"));
    gibDreissigFrei();
    await spaet;
    await page.evaluate(() => new Promise((fertig) => setTimeout(fertig, 300)));
    await expect(panel.getByTestId("statistik-zeitraum-7")).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByText("2026-10-06 – 2026-10-12")).toBeVisible();
    await expect(panel.getByText(`${ZAHLEN.von} – ${ZAHLEN.bis}`)).toHaveCount(0);
});

// Vali 2026-11-11: „die anzahl editoren kann mit 22 nicht sein - wir sind nur 11“. Vor der Kopfzählung gibt es keine Zahl.
test("🔴 die Kachel „Köpfe je Tag“ sagt, seit wann gezählt wird", async ({ page }) => {
    await oeffneStatistik(page, { kennzahlen: { ...ZAHLEN.kennzahlen, editorenSpitze: 3, editorenAb: "2026-10-11" } });
    await page.getByRole("tab", { name: "Status" }).click();
    const kachel = page.getByTestId("editor-panel").getByTestId("statistik-koepfe");
    await expect(kachel.locator(".statistik__kachelZahl")).toHaveText("bis 3");
    await expect(kachel.locator(".statistik__kachelZusatz")).toHaveText("seit 2026-10-11");
});

// OPS-000118 (der Melder 2026-11-11: viele Besuche unter zehn Sekunden, Singapur und Malaysia aus dem Nichts).
test("🔴 der Schalter „Besuche unter 10 Sekunden ausblenden“ fragt gefiltert und sagt, wie viel er ausblendet", async ({
    page,
}) => {
    await oeffneStatistik(page, {
        ausgeschlossen: { aufrufe: 412, gruende: [{ name: "useragent", wert: 412 }] },
        dauer: { ...ZAHLEN.dauer, ohne: 37 },
    });
    const gefragt: string[] = [];
    await page.route("**/api/besuch/zahlen*", async (route) => {
        const adresse = new URL(route.request().url());
        gefragt.push(adresse.search);
        const gefiltert = adresse.searchParams.get("ohneKurz") === "true";
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                ...ZAHLEN,
                ausgeschlossen: { aufrufe: 412, gruende: [{ name: "useragent", wert: 412 }] },
                dauer: { ...ZAHLEN.dauer, ohne: 37 },
                ...(gefiltert
                    ? {
                          kennzahlen: { ...ZAHLEN.kennzahlen, aufrufe: 14000 },
                          filter: { ab: "2026-11-12", ausgeblendet: 7156, gesamt: 21156 },
                      }
                    : {}),
            }),
        });
    });
    await page.getByRole("tab", { name: "Status" }).click();
    const panel = page.getByTestId("editor-panel");

    await expect(panel.getByText("21.156")).toBeVisible();
    await expect(panel.getByTestId("statistik-filter")).toHaveCount(0);
    await expect(panel.getByTestId("statistik-ausgeschlossen")).toHaveText(
        "Als Automat ausgeschlossene Aufrufe: 412 (Browserkennung)",
    );
    await expect(panel.getByTestId("statistik-dauer-ohne")).toHaveText(
        "Ohne messbare Dauer (nur ein Lebenszeichen): 37",
    );

    await panel.getByTestId("statistik-ohne-kurz").click();
    await expect(panel.getByTestId("statistik-filter")).toHaveText(
        "Filter aktiv seit 2026-11-12. Ausgeblendete Aufrufe: 7.156 von 21.156",
    );
    await expect(panel.getByText("14.000")).toBeVisible();
    expect(gefragt.at(-1)).toContain("ohneKurz=true");

    // Im Unterreiter „Editoren“ gibt es den Schalter nicht; er filtert nur Besucher.
    await panel.getByTestId("statistik-sorte-editoren").click();
    await expect(panel.getByTestId("statistik-ohne-kurz")).toHaveCount(0);
    expect(gefragt.at(-1)).not.toContain("ohneKurz");
});
