import type { SubjectDetail } from "@avesmaps3d/shared";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createPropertyExpression, latest, type StylePropertySpecification } from "@maplibre/maplibre-gl-style-spec";
import { openMap, showLandscapes } from "./map-handle.ts";

/**
 * „Was auf der Karte ist, ist anklickbar“ (Betreiber 2026-10-04, AGENTS.md „Karteninteraktion“, WI-0063 27.12) am echten Stack: Werte der
 * Fakten- und Kontexttafel, die ein Objekt der Karte benennen, sind Links wie in „Liegt in“ - ein Klick fliegt hin, markiert und öffnet das
 * Panel des Objekts über dieselbe Naht. Was das Modell daraus macht, prüft `test/panel-links.test.ts`; die Zuordnung des Servers
 * `test/wiki-key-lookup.test.ts` und `test/subject-text-links.test.ts`.
 *
 * 🔴 Die Zuordnung läuft über den WIKI-KEY, nie über den Namen (Betreiber 2026-10-05): Ein Wiki-Wert wird nur ein Link, wenn der Quelltext für genau
 * dieses Teilstück ein Linkziel nennt, dessen Wiki-Key genau ein Objekt der Karte trägt. Links aus UNSEREN Daten (Derographie, Topographie,
 * „Liegt in“, „Führt durch“, Klimazone: die Kennung steht in der Antwort) bleiben, was sie waren.
 *
 * 💣 **Diese Datei hatte bis 2026-10-06 eine überholte Voraussetzung** und war deshalb in sieben Fällen dauerhaft rot: Sie entstand, als Legacys
 * Linkziele (X1) in `avesmaps3d_dev` noch fehlten, und schrieb darum „alle anderen Wiki-Felder bleiben Text“ als Erwartung fest - samt der
 * Begründung „die Daten tragen keine Linkziele“. Seit der Import X1/X2 dort gelaufen ist (Schritt I24, `migrate:wiki-links`, Migration 0073,
 * gemessen am 2026-10-05 08:00: 3.183 Artikel mit 27.296 Linkzielen und 6.625 Zuweisungen) tragen Lage, Staat, Region, Nachbarn und Verlauf
 * Linkziele, und die Regel macht aus einem Teil davon Links. Nachgezogen sind die Erwartungen, NICHT die Regel.
 *
 * 🔴 **Jede Erwartung unten nennt beide Seiten**, denn die Aussage der Datei ist die Auswahl, nicht die Menge: welches Teilstück ein Link wird UND
 * welches Text bleibt, obwohl sein Name ein Kartenobjekt nennt. Die drei Gründe, Text zu bleiben, stehen je an ihrem Fall: kein Linkziel im
 * Quelltext · ein Linkziel, dessen Key kein Objekt trägt · ein Linkziel, dessen Key mehrere Objekte tragen (mehrdeutig, nie gewählt).
 *
 * 🪤 Die Zahlen hängen am Satz der Entwicklungsdatenbank (Satz 161832) UND am Stand von X1/X2. Ein neuer Zug kann aus einem Text einen Link machen
 * oder umgekehrt; dann ist dieser Fall nachzuziehen, nicht die Regel. Wer das prüft, zählt `wiki_link_target` (Linkziel vorhanden?) und
 * `wiki_key_assignment` (wie viele Objekte tragen den Key?) für den strittigen Schlüssel.
 *
 * Die Fälle: Gareth (Lage und Verkehrswege mit Linkzielen, Derographie und Klimazone aus unseren Daten), Hüterkloster, Moorburg und Mohema
 * (Verkehrswege, je ein anderer Grund für Text), das Koschgebirge südlich des Greifenpasses (die Beispiele des Betreibers), „Herz des
 * Kontinents“ und die Region „Yalaiad“ (Nachbarn).
 */

const GARETH = "80558060-4299-54aa-b520-814b10819885";
const KOSCHGEBIRGE = "0e3c25ec-8329-437d-9eb9-40ae199d12ad";
const HERZ_DES_KONTINENTS = "af1a1e78-a55c-4aa7-b958-0c65d4dda4a9";
/** Die Region „Yalaiad“ (Derographie): vier Nachbarn, zwei davon mit Linkziel, einer trotz Kartenobjekt gleichen Namens Text (Bestand 2026-10-29). */
const YALAIAD = "cc406cae-9677-4c6a-b883-ec1c2e189eb6";
/** „nahe Greifenpass/Reichsstraße 3“: zwei Linkziele, beide treffen einen Weg. */
const HUETERKLOSTER = "fa053c50-e465-4e0a-a75b-4fdefbcd295e";
/** „Reichslandstraße von Havena nach Abilacht liegt zwei Meilen entfernt“: Havena trifft einen Ort, die Reichslandstraße kein Objekt, Abilacht zwei. */
const MOORBURG = "bfc97329-c045-473e-8939-b3c379497f85";
/** „… Verbindung nach Rekmehi und Dju'imen“: das Linkziel heißt „Inoffiziell:Dju'imen“ - der Namensraum gehört zum Key. */
const MOHEMA = "33cb3312-ac2a-5b9b-99d7-441d36fdf07c";

/** MapLibres Spezifikation von `fill-opacity`; `latest` kennt sie nur ungetypt (vgl. `test/style-spec.ts`). */
const FILL_OPACITY_SPEC = (latest as unknown as Record<string, Record<string, StylePropertySpecification>>)[
    "paint_fill"
]?.["fill-opacity"];

/** Öffnet ein Subject über die Öffnungsnaht und wartet, bis das Panel seinen Namen trägt. */
async function open(page: Page, ref: Record<string, unknown>, title: string | RegExp): Promise<void> {
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), ref);
    await expect(page.getByTestId("info-title")).toHaveText(title, { timeout: 20_000 });
    // Die Zeilen kommen mit der Antwort; ein Subject, das noch lädt, hat keine.
    await expect(page.getByTestId("info-facts")).toBeVisible({ timeout: 20_000 });
}

/** Die Zeile der Feldliste mit dieser Beschriftung. */
const rowOf = (page: Page, label: string): Locator =>
    page
        .getByTestId("info-fact")
        .filter({ has: page.getByTestId("info-fact-label").getByText(label, { exact: true }) });

const linkTexts = (row: Locator): Promise<string[]> => row.getByTestId("info-link").allTextContents();

const valueText = async (row: Locator): Promise<string> =>
    ((await row.getByTestId("info-fact-value").textContent()) ?? "").replace(/\s+/g, " ").trim();

/**
 * Wo die Kamera gelandet ist. Seit WI-0218 landet jedes Hinfliegen in der Mitte der FREIEN Fläche (Planer links, Infopanel
 * rechts), der Fluchtpunkt bleibt in der Bildmitte: gelesen wird, was in der freien Mitte liegt (in der Bildmitte lag die
 * Bandmitte 12,5 Einheiten daneben).
 */
async function cameraAt(page: Page): Promise<{ x: number; y: number; zoom: number }> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        const projection = globalThis.avesmapsRenderProjection;
        if (!map || !projection) throw new Error("map handle missing");
        const { x, y } = globalThis.avesmapsVisibleArea!.centre();
        return { ...projection.fromRenderLngLat(map.unproject([x, y])), zoom: map.getZoom() };
    });
}

const subject = (page: Page): Promise<{ kind: string; id?: string; band?: string } | undefined> =>
    page.evaluate(
        () => globalThis.avesmapsSelectedSubject?.() as { kind: string; id?: string; band?: string } | undefined,
    );

test.describe("Gareth: Lage, Verkehrswege und Derographie - welcher Name ein Link wird und welcher Text bleibt", () => {
    test("🔴 die Lage: „Reichsstadt“ und „Alt-Gareth“ haben ein Linkziel und bleiben trotzdem Text, weil kein Kartenobjekt ihren Key trägt", async ({
        page,
    }) => {
        await open(page, { kind: "place", id: GARETH }, "Gareth");
        const lage = rowOf(page, "Lage");
        await expect(lage).toHaveCount(1);
        expect(await valueText(lage)).toBe("Herz des Kontinents · Baronie Raulsmark; Reichsstadt (nur Alt-Gareth)");
        // Die Zeile setzt sich aus Legacys Feldern `region` und `staat` zusammen, und ALLE VIER Teilstücke tragen ein Linkziel
        // (`wiki:herz-des-kontinents`, `wiki:baronie-raulsmark`, `wiki:reichsstadt`, `wiki:alt-gareth`). Link werden nur die
        // ersten zwei - ihren Key trägt genau ein Kartenobjekt. „Reichsstadt“ und „Alt-Gareth“ tragen keines und bleiben Text:
        // 🔴 Ein Linkziel allein macht keinen Link, und ein Name macht nie einen.
        expect(await linkTexts(lage)).toEqual(["Herz des Kontinents", "Baronie Raulsmark"]);
    });

    test("🔴 Gareths Verkehrswege: die Linkziele des Quelltextes gewinnen, auch wo der Anzeigetext nur „3“ heißt", async ({
        page,
    }) => {
        await open(page, { kind: "place", id: GARETH }, "Gareth");
        const roads = rowOf(page, "Verkehrswege");
        await expect(roads).toHaveCount(1);
        expect(await valueText(roads)).toBe("Reichsstraßen 2 und 3, Gardel");
        // 🔴 Der Beleg, dass der KEY zählt und nicht der Text: Das zweite Teilstück heißt im Satz nur „3“ und zeigt über
        // `wiki:reichsstrasse-3` trotzdem auf die Reichsstraße 3. Über einen Namensvergleich wäre „3“ nie auflösbar.
        expect(await linkTexts(roads)).toEqual(["Reichsstraßen 2", "3", "Gardel"]);
    });

    test("🔴 die Derographie: Name als Link, die Art in Klammern als Text daneben", async ({ page }) => {
        await open(page, { kind: "place", id: GARETH }, "Gareth");
        const derographie = rowOf(page, "Regionen");
        expect(await valueText(derographie)).toBe(
            "Herz des Kontinents · Mittelaventurien (Region) · Aventurien (Kontinent)",
        );
        expect(await linkTexts(derographie)).toEqual(["Herz des Kontinents", "Mittelaventurien", "Aventurien"]);
    });

    test("🔴 ein Klick auf einen Link der Derographie: die Kamera fliegt hin, die Fläche leuchtet, das Panel ist das des Objekts", async ({
        page,
    }) => {
        await open(page, { kind: "place", id: GARETH }, "Gareth");
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
        const before = await cameraAt(page);

        await rowOf(page, "Regionen").getByTestId("info-link").filter({ hasText: "Herz des Kontinents" }).click();

        await expect(page.getByTestId("info-title")).toHaveText("Herz des Kontinents", { timeout: 20_000 });
        expect((await subject(page))?.kind).toBe("area");
        expect((await subject(page))?.id).toBe(HERZ_DES_KONTINENTS);
        // Die Karte fährt: kein Sprung (`camera-never-jumps`), aber nach der Fahrt steht die Kamera woanders.
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 20_000 });
        const after = await cameraAt(page);
        expect(Math.abs(after.zoom - before.zoom) + Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(
            0.05,
        );
        // Die Fläche steht markiert (dieselbe Darstellung wie nach einem Klick auf die Karte).
        const marked = await page.evaluate(() => globalThis.avesmapsAreaSelection?.());
        expect(marked?.name).toBe("Herz des Kontinents");
    });

    test("ein Klick auf ein Gebiet in „Liegt in“ (die Kette kommt aus der Geometrie, die Kennung steht in der Antwort) öffnet dessen Panel", async ({
        page,
    }) => {
        await open(page, { kind: "place", id: GARETH }, "Gareth");
        await page
            .getByTestId("info-lies-in")
            .getByTestId("info-link")
            .filter({ hasText: "Königreich Garetien" })
            .click();
        await expect(page.getByTestId("info-title")).toHaveText("Königreich Garetien", { timeout: 20_000 });
        expect((await subject(page))?.kind).toBe("territory");
    });
});

test.describe("Verkehrswege der Orte: Linkziele aus dem Wiki-Quelltext, verlinkt über den Wiki-Key", () => {
    test("🔴 Hüterkloster: der Rest („nahe“, „/“) bleibt Text, und „Greifenpass“ auch - sein Key trägt kein Kartenobjekt", async ({
        page,
    }) => {
        await open(page, { kind: "place", id: HUETERKLOSTER }, "Hüterkloster");
        const roads = rowOf(page, "Verkehrswege");
        expect(await valueText(roads)).toBe("nahe Greifenpass/Reichsstraße 3");
        // Beide Teilstücke tragen ein Linkziel (`wiki:greifenpass`, `wiki:reichsstrasse-3`). Nur das zweite wird ein Link:
        // `wiki_key_assignment` kennt 122 Wegabschnitte zur Reichsstraße 3 (eine Wegegruppe, ein Objekt) und zu
        // `wiki:greifenpass` KEINE EINZIGE Zuweisung - obwohl es auf der Karte einen Greifenpass gibt.
        // 🔴 Das ist ein Datenbefund an Legacys X2-Export, kein Fehler der Regel; sie darf ohne Zuweisung nichts wählen.
        expect(await linkTexts(roads)).toEqual(["Reichsstraße 3"]);
    });

    test("ein Klick auf „Reichsstraße 3“ öffnet das Panel des Wegs", async ({ page }) => {
        await open(page, { kind: "place", id: HUETERKLOSTER }, "Hüterkloster");
        await rowOf(page, "Verkehrswege").getByTestId("info-link").filter({ hasText: "Reichsstraße 3" }).click();
        await expect(page.getByTestId("info-title")).toHaveText("Reichsstraße 3", { timeout: 20_000 });
        expect((await subject(page))?.kind).toBe("path");
    });

    test("🔴 Moorburg: ein Linkziel ohne Objekt und ein Linkziel mit zwei Objekten bleiben Text, auch wenn der Name eindeutig einen Ort nennt", async ({
        page,
    }) => {
        await open(page, { kind: "place", id: MOORBURG }, "Moorburg");
        const roads = rowOf(page, "Verkehrswege");
        expect(await valueText(roads)).toBe("Reichslandstraße von Havena nach Abilacht liegt zwei Meilen entfernt");
        // 🔴 Der härteste Fall der Datei: DREI Teilstücke mit Linkziel, und KEINES wird ein Link, obwohl jeder der drei
        // Namen auf der Karte vorkommt.
        //   · „Reichslandstraße“ → `wiki:reichslandstrasse`: kein Objekt trägt den Key.
        //   · „Havena“ → `wiki:havena-siedlung`: ZWEI Objekte tragen ihn (eine Siedlung und ein Gebiet) - mehrdeutig,
        //     also nichts gewählt. Bis 2026-10-06 erwartete dieser Fall hier einen Link; das stammte aus einem älteren
        //     X2-Stand mit nur einer Zuweisung. Die zweite ist ein Datenbefund, kein Grund, die Mehrdeutigkeit zu raten.
        //   · „Abilacht“ → `wiki:abilacht`: ein Ort UND ein Gebiet, ebenso mehrdeutig.
        expect(await linkTexts(roads)).toEqual([]);
    });

    test("🔴 Mohema: „Inoffiziell:Dju'imen“ ist ein anderer Artikel als „Dju'imen“ - der Namensraum gehört zum Key", async ({
        page,
    }) => {
        await open(page, { kind: "place", id: MOHEMA }, "Mohema");
        const roads = rowOf(page, "Verkehrswege");
        expect(await linkTexts(roads)).toEqual(["Dju'imen"]);
        await roads.getByTestId("info-link").filter({ hasText: "Dju'imen" }).click();
        await expect(page.getByTestId("info-title")).toHaveText("Dju'imen", { timeout: 20_000 });
        expect((await subject(page))?.kind).toBe("territory");
    });
});

test.describe("Koschgebirge, Massiv südlich des Greifenpasses", () => {
    test("🔴 Derographie und Topographie: jeder Name ein Link, auch der mit dem Komma im Namen", async ({ page }) => {
        const answer = page.waitForResponse(
            (response) => response.url().endsWith(`/api/subjects/area/${KOSCHGEBIRGE}`) && response.ok(),
        );
        await open(page, { kind: "area", id: KOSCHGEBIRGE }, /^Koschgebirge, Massiv südlich des Greifenpasses$/);
        const detail = (await (await answer).json()) as SubjectDetail;
        const landscapes = detail.context?.landscapes?.items ?? [];
        expect(landscapes.find((entry) => entry.name === "Koschberge" && entry.layer === "derographisch")?.type).toBe(
            "region",
        );
        expect(landscapes.find((entry) => entry.name === "Koschberge" && entry.layer === "topographie")?.type).toBe(
            "gebirge",
        );
        const derographie = rowOf(page, "Regionen");
        expect(await valueText(derographie)).toBe(
            "Koschberge (Region) · Mittelaventurien (Region) · Aventurien (Kontinent) · Nordmarken",
        );
        expect(await linkTexts(derographie)).toEqual(["Koschberge", "Mittelaventurien", "Aventurien", "Nordmarken"]);
        const topographie = rowOf(page, "Topographie");
        expect(await valueText(topographie)).toBe(
            "Koschgebirge, Berge um den Greifenpass (Gebirge) · Koschberge (Gebirge)",
        );
        expect(await linkTexts(topographie)).toEqual(["Koschgebirge, Berge um den Greifenpass", "Koschberge"]);
    });

    test("ein Klick auf „Mittelaventurien“ öffnet dessen Panel", async ({ page }) => {
        await open(page, { kind: "area", id: KOSCHGEBIRGE }, /^Koschgebirge, Massiv südlich des Greifenpasses$/);
        await rowOf(page, "Regionen").getByTestId("info-link").filter({ hasText: "Mittelaventurien" }).click();
        await expect(page.getByTestId("info-title")).toHaveText("Mittelaventurien", { timeout: 20_000 });
        expect((await subject(page))?.kind).toBe("area");
    });
});

test.describe("Weg: Lage und Verlauf - der Deckel bleibt, die Stationen sind Links", () => {
    const MISAMUNDER = { kind: "path", chain: "Misamunder Straße:Strasse" };

    test("🔴 Lage und Verlauf tragen Linkziele; der Deckel des Verlaufs bleibt und seine Vorschau auch", async ({
        page,
    }) => {
        await open(page, MISAMUNDER, "Misamunder Straße");
        const lage = rowOf(page, "Lage");
        expect(await valueText(lage)).toContain("Tobrien");
        // 🪤 Bis 2026-10-06 stand hier `[]` mit der Begründung „der Quelltext nennt kein Linkziel“. Er nennt eines
        // (`lage[0] Tobrien → wiki:tobrien`), seit X1 in `avesmaps3d_dev` liegt.
        expect(await linkTexts(lage)).toEqual(["Tobrien"]);

        const verlauf = rowOf(page, "Verlauf");
        const lid = verlauf.getByTestId("info-lid");
        // Zugeklappt: nur die Vorschau; der Deckel ist `inert`. Das ist die Zusicherung, die hier nie gewackelt hat.
        await expect(lid.getByTestId("info-lid-preview")).toHaveText("Vallusa → … → Flussbuckel");
        await lid.getByRole("button").first().click();
        // Aufgeklappt stehen die sechs Stationen des Wegs, jede als Link. Der Quelltext nennt im Feld `verlauf` zwölf
        // Linkziele; gezeigt werden die sechs Orte, die der Weg wirklich berührt - der Deckel erfindet keine Station dazu.
        expect(await valueText(verlauf)).toContain("Wolfen");
        expect(await valueText(verlauf)).toContain("Dogul");
        expect(await linkTexts(verlauf)).toEqual([
            "Vallusa",
            "Wolfen",
            "Alstfurt",
            "Dogul",
            "Marktfelden",
            "Flussbuckel",
        ]);
    });

    test("die Kontextwerte des Wegs (Gebiete und Landschaften aus der Geometrie) bleiben Links", async ({ page }) => {
        await open(page, MISAMUNDER, "Misamunder Straße");
        const durch = rowOf(page, "Führt durch");
        expect(await linkTexts(durch)).toContain("Tobrien");
        await durch
            .getByTestId("info-link")
            .filter({ hasText: /^Tobrien$/ })
            .first()
            .click();
        await expect(page.getByTestId("info-title")).toHaveText("Tobrien", { timeout: 20_000 });
        expect((await subject(page))?.kind).toBe("area");
    });
});

test.describe("Landschaft: die Nachbarn stehen in EINER Zeile, und nur ein Teil von ihnen ist ein Link", () => {
    test("🔴 Herz des Kontinents: die Zeile behält ihre Form; „Kosch“ bleibt Text, weil sein Linkziel kein Kartenobjekt trifft", async ({
        page,
    }) => {
        await open(page, { kind: "area", id: HERZ_DES_KONTINENTS }, "Herz des Kontinents");
        const neighbors = rowOf(page, "Nachbarn");
        // 🔴 Die Form des Betreibers (2026-10-04): Name, Richtungen in Klammern, Komma; Reihenfolge des ersten Auftretens
        // auf der Windrose. SIE ist die Zusicherung dieses Falls und darf sich durch Links nicht verändern - acht
        // Windrichtungen werden zu fünf Nachbarn zusammengefasst, auch wenn vier davon jetzt Links sind.
        expect(await valueText(neighbors)).toBe(
            "Darpatien (N, NO, O), Raschtulswall (SO), Caldaia (S), Kosch (SW, W), Greifenfurt (NW)",
        );
        // Alle fünf Nachbarn tragen ein Linkziel (`nachbar_*` in X1). Vier treffen genau ein Kartenobjekt; „Kosch“ zeigt
        // auf `wiki:kosch-region` und trifft keines - es bleibt Text, obwohl „Kosch“ auf der Karte vorkommt.
        expect(
            await linkTexts(neighbors),
            "ein Nachbar wird nur über seinen Wiki-Key ein Link, nie über seinen Namen",
        ).toEqual(["Darpatien", "Raschtulswall", "Caldaia", "Greifenfurt"]);
    });

    test("Yalaiad: Nachbarn ohne Linkziel bleiben Text, auch wenn ihr Name ein Kartenobjekt nennt („Balash“); die mit Linkziel sind Links", async ({
        page,
    }) => {
        // 🪤 Die „Gorische Steppe“, an der dieser Fall bis 2026-10-29 hing, gibt es in den Daten nicht mehr (Stage-Abzug, Kennung stillgelegt).
        // Die Aussage ist die Auswahl, nicht die Namen: Welche Nachbarn ein Linkziel tragen, steht in der Antwort des Servers (`links` am
        // Teilstück); das Panel macht genau diese zu Links und lässt die übrigen Text. Die Erwartung kommt deshalb aus der Antwort.
        const answer = page.waitForResponse(
            (response) => response.url().endsWith(`/api/subjects/area/${YALAIAD}`) && response.ok(),
        );
        await open(page, { kind: "area", id: YALAIAD }, "Yalaiad");
        const detail = (await (await answer).json()) as SubjectDetail;
        const felder = (detail.facts ?? []).filter((fact) => fact.field === "neighbors") as unknown as {
            values: string[];
            links?: { value: number }[];
        }[];
        const mitLink: string[] = [];
        const ohneLink: string[] = [];
        for (const feld of felder)
            feld.values.forEach((name, at) => {
                const ziel = feld.links?.some((link) => link.value === at) === true ? mitLink : ohneLink;
                if (!ziel.includes(name)) ziel.push(name);
            });
        expect(mitLink.length, "Voraussetzung: mindestens ein Nachbar trägt ein Linkziel").toBeGreaterThan(0);
        // „Obwohl sein Name ein Kartenobjekt nennt“: Mindestens einer der übrigen heißt wie ein Objekt der Suche.
        const gefunden = await Promise.all(
            ohneLink.map(async (name) => {
                const antwort = await page.request.get(`/api/search?q=${encodeURIComponent(name)}`);
                const treffer = ((await antwort.json()) as { hits: { name: string }[] }).hits;
                return treffer.some((hit) => hit.name === name);
            }),
        );
        expect(
            gefunden.some(Boolean),
            "Voraussetzung: ein Nachbar ohne Linkziel heißt wie ein Kartenobjekt (Text trotz Namenstreffer)",
        ).toBe(true);

        const neighbors = rowOf(page, "Nachbarn");
        const text = await valueText(neighbors);
        for (const name of [...mitLink, ...ohneLink])
            expect(text, `der Nachbar „${name}“ steht in der Zeile`).toContain(name);
        // Genau die Nachbarn mit Linkziel sind Links, in der Folge ihres ersten Auftretens auf der Windrose; kein Name macht einen Link.
        expect(await linkTexts(neighbors)).toEqual(mitLink);
    });
});

/** Die Klimazonen unter der Mitte der freien Fläche (dort landet der Link); wartet, bis dort eine Fläche liegt. */
async function climateZonesAtCenter(page: Page): Promise<unknown[]> {
    await page.waitForFunction(
        () => {
            const map = globalThis.avesmapsMap;
            if (!map?.getLayer("climate-fill")) return false;
            const { x, y } = globalThis.avesmapsVisibleArea!.centre();
            return map.queryRenderedFeatures([x, y], { layers: ["climate-fill"] }).length > 0;
        },
        undefined,
        { timeout: 30_000 },
    );
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const { x, y } = globalThis.avesmapsVisibleArea!.centre();
        return map
            .queryRenderedFeatures([x, y], { layers: ["climate-fill"] })
            .map((feature) => feature.properties["type_key"]);
    });
}

/** Mit welcher Deckkraft der LEBENDE Stil die Zone `zone` gerade zeichnet, von MapLibres eigenem Auswerter. */
async function climateOpacity(page: Page, zone: string): Promise<number> {
    const wert = await page.evaluate(() => globalThis.avesmapsMap?.getPaintProperty("climate-fill", "fill-opacity"));
    if (!FILL_OPACITY_SPEC) throw new Error("fill-opacity steht nicht in MapLibres Stilspezifikation");
    const compiled = createPropertyExpression(wert as never, "fill-opacity", FILL_OPACITY_SPEC);
    if (compiled.result !== "success") throw new Error("fill-opacity im Stil ungültig");
    return compiled.value.evaluate({ zoom: 2 }, { type: "Polygon", properties: { type_key: zone } } as never) as number;
}

test.describe("Klimazone: ein Gegenstand mit Kopf (Legacy `showEcosystemAreaInfopanel`)", () => {
    test("🔴 die Klimazone-Zeile ist ein Link; der Klick zeigt den Kopf: Name und „Klimazonen“, keine Felder, keine Aktion", async ({
        page,
    }) => {
        await open(page, { kind: "place", id: GARETH }, "Gareth");
        const klima = rowOf(page, "Klimazone");
        expect(await linkTexts(klima)).toEqual(["Gemäßigte Zone"]);
        await klima.getByTestId("info-link").click();

        await expect(page.getByTestId("info-title")).toHaveText("Gemäßigte Zone", { timeout: 20_000 });
        await expect(page.getByTestId("info-subtitle")).toHaveText("Klimazonen");
        expect(await subject(page)).toEqual({ kind: "climate", band: "gemaessigt" });
        // Nur der Kopf: keine Felder, keine Aktionskachel, keine Quellen, kein Kanon.
        await expect(page.getByTestId("info-facts")).toHaveCount(0);
        await expect(page.getByTestId("info-actions")).toHaveCount(0);
        await expect(page.getByTestId("info-source")).toHaveCount(0);
        await expect(page.getByTestId("info-lies-in")).toHaveCount(0);
    });

    test("🔴 der Klick schaltet die Karte auf die Klimazonen, fährt zur Bandmitte und hebt die Zone hervor", async ({
        page,
    }) => {
        await open(page, { kind: "place", id: GARETH }, "Gareth");
        await rowOf(page, "Klimazone").getByTestId("info-link").click();
        await expect(page.getByTestId("info-title")).toHaveText("Gemäßigte Zone", { timeout: 20_000 });

        // Die Ansicht folgt dem Ziel (wie bei der Suche): Landschaften → Klimazonen.
        await expect(page.getByTestId("fan-toggle")).toHaveAttribute("title", "Ansicht: Derographie");
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 20_000 });
        const camera = await cameraAt(page);
        expect(camera.x, "auf der Mittelsenkrechten, nicht an einer Kante").toBeCloseTo(512, 0);
        expect(camera.zoom).toBeCloseTo(2, 1);
        // Gefragt wird die gezeichnete Fläche unter der Kamera, nicht eine Zahl aus der Antwort.
        expect(new Set(await climateZonesAtCenter(page))).toContain("gemaessigt");
        expect(await climateOpacity(page, "gemaessigt"), "die gewählte Zone steht kräftiger").toBeGreaterThan(
            await climateOpacity(page, "subtropisch"),
        );
    });

    test("eine andere Auswahl beendet die Hervorhebung der Zone", async ({ page }) => {
        await open(page, { kind: "place", id: GARETH }, "Gareth");
        await rowOf(page, "Klimazone").getByTestId("info-link").click();
        await expect(page.getByTestId("info-title")).toHaveText("Gemäßigte Zone", { timeout: 20_000 });
        expect(await climateOpacity(page, "gemaessigt")).toBeGreaterThan(await climateOpacity(page, "subtropisch"));

        // Eine andere Auswahl: Gareth öffnet die Standardansicht (die Klimabänder sind dort aus) und beendet die Hervorhebung.
        await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), { kind: "place", id: GARETH });
        await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 20_000 });
        await showLandscapes(page, "klima");
        expect(await climateOpacity(page, "gemaessigt"), "keine Zone steht mehr kräftiger").toBe(
            await climateOpacity(page, "subtropisch"),
        );
    });
});
