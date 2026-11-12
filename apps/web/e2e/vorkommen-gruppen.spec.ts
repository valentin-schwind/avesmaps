import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Die drei Teile einer Vorkommenszeile am echten Stack (WI-0091 Nachtrag 2 und 3): zwei offene Gruppen und ein Link.
 *
 * 🔴 **„Aus der Region“ steht OFFEN** (Betreiber 2026-10-07, wörtlich am Blatt: „nein ‚Aus der Region‘ brauch keine
 * eigene klappbox“). Eine zweite Klappstufe war gebaut und ist abgelehnt worden: Die Zeile selbst ist schon ein Deckel.
 *
 * 🔴 **Dazu das Buchstabenregister** (WI-0099): Jede Gruppe setzt ihre Namen nach Marken in zwei Spalten, und über das Klappen
 * entscheidet die ZEILE - unter 25 Namen klappt nichts, ab 25 klappen alle Gruppen und nur die erste startet offen.
 *
 * Benannte Fälle und ein Beleg:
 * 1. **Unter der Schwelle stehen die Gruppen offen** - beim Aufklappen der Zeile sind „Direkt von hier“ und „Aus der Region“
 *    unmittelbar da, jede mit Überschrift und Zahl, ohne zweiten Knopf.
 * 1a. **Über der Schwelle klappen sie**, und nur die erste startet offen (Selems Waren, 88 Namen am 2026-10-06, 107 am 2026-10-29).
 * 1b. 🔴 **Der längste Fall des Bestands wird wirklich gemessen**: Drunidets Tierarten (110 am 2026-10-06) - Marken, Spaltenzahl, Höhe,
 *    Trennregel und waagerechter Überlauf, in echter Größe und am Telefon.
 * 2. **Nur Kontinentweites** - ein Gegenstand ohne Eigenes und ohne Regionales bekommt die Zeile trotzdem; sie trägt den
 *    Link allein (WI-0103), und ihr Zählsatz sagt seit WI-0104 **0**.
 * 3. 🔴 **Der Link führt wirklich hin** - er öffnet das Panel der Landschaft „Aventurien“ UND markiert ihre Fläche.
 *    Dieser Beleg steht hier, weil die Naht zwischen einer Nennung und `openSubject` schon einmal danebenging
 *    (WI-0087 P2, Etappenliste).
 * 4. 🔴 **WI-0122: Das Suchfeld** steht ab derselben Schwelle wie die Klappgruppen (25 Namen in der ZEILE), auch an EINER
 *    Gruppe: Drunidets Tierarten (110 am 2026-10-06) bekommen es, Nostrias 10 Pflanzen (Selems 23 am 2026-10-06) nicht. Es filtert die Namen, zählt „n Treffer“ und
 *    Escape leert.
 *
 * 🪤 Braucht einen Fastify mit dem Lesepfad DIESES Worktrees auf dem Port, den `PORT` nennt (Vite liest daraus das
 * Proxyziel), und eine Entwicklungsdatenbank, in der I24 und I25 gelaufen sind. Eigene Ports dieser Sitzung:
 *   $env:PORT="3289"; $env:E2E_PORT="4289"; npx playwright test e2e/vorkommen-deckel.spec.ts
 * 💣 3261 ist vergeben (`apps/server/test/uploads-sync.test.ts` bindet ihn fest) und darf nie Serverport einer Sitzung sein.
 */

/** Selem: der Ort mit allen vier Arten, Eigenem und Regionalem (gemessen 2026-10-06). */
const SELEM = { kind: "place", id: "ec477f34-a34a-578e-9887-05b751f091e4" } as const;
/**
 * 🔴 Drunidet: der längste Fall des Bestands - EINE Gruppe, 110 Tierarten (WI-0099; am 2026-10-29 sind es 115, die Regeln der Vorkommen
 * WI-0253/WI-0257 bringen laufend Namen: Die Fälle lesen die Zahl aus der Antwort des Lesepfads, nicht aus dem Test).
 */
const DRUNIDET = { kind: "place", id: "9a04121d-6f4d-533e-9207-05738e16bdf0" } as const;
/**
 * Ein Ort mit „Direkt von hier“ UND „Aus der Region“ in der Flora, beide offen unter der 25er-Schwelle (gemessen 2026-10-29: Flora 2 und 8 Namen).
 * Selem (5 und 18 Namen am 2026-10-06) ist mit den Regeln der Vorkommen über die Schwelle gewachsen; die Voraussetzung prüft der Fall selbst.
 */
const KLEINER_ORT = { kind: "place", id: "7b8f1175-5b09-5f96-8bdc-5bf7ca00c677" } as const; // Nostria
/**
 * Ein Ort ohne Eigenes und ohne Regionales in allen vier Arten, nur kontinentweit (gemessen 2026-10-29: Theron, ein Dorf: alle vier Zeilen ohne Gruppe, Zählsatz 0). Aumond (6f45f4eb-…,
 * am 2026-10-07 so gemessen) trägt seit den Regeln der Vorkommen in der Fauna eine Gruppe; die Voraussetzung prüft der Fall selbst.
 */
const LEERER_ORT = { kind: "place", id: "e0065433-2a24-5e88-aa6c-0fa3a1032686" } as const;
const LEERER_NAME = "Theron";
/** Die Landschaft „Aventurien“: das Ziel des Links, und dort sind die kontinentweiten Einträge „Direkt von hier“. */
const AVENTURIEN_ID = "9188801c-92e6-4fbf-a6d5-794b7433f846";
/** 🔴 Der Hexenwald: der Anlass der Entscheidung vom 2026-10-07 - EINE Gruppe `region`, nichts Eigenes (WI-0103). */
const HEXENWALD = { kind: "area", id: "c3dd94b7-f0b8-4b4a-83ef-fea50c603dd4" } as const;
/** Die Reichsstraße 2 (105 Abschnitte): der Weg, der seit dem 2026-10-07 erbt. */
const REICHSSTRASSE = { kind: "path", anchor: "045922ae-e4df-492f-aee1-37a43ffee54c" } as const;

/** Die Marke eines Namens, nach derselben Regel wie `loreLetterOf` - hier zum Gegenrechnen im Browser. */
const markOf = (name: string): string => {
    const folded = name.trim().charAt(0).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().charAt(0);
    return /[A-Z]/.test(folded) ? folded : "#";
};

async function open(page: Page, ref: Record<string, unknown>): Promise<void> {
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), ref);
    await expect(page.getByTestId("info-title")).toBeVisible({ timeout: 30_000 });
}

/** Die Antwort des Lesepfads `GET /api/subjects/{kind}/{id}/lore`, so weit die Fälle sie lesen (Vertrag: `SubjectLoreSection`). */
interface LoreAntwort {
    rows: { kind: string; groups: { group: string; entries: { name: string }[] }[] }[];
}

/**
 * Meldet an, die Antwort des Lesepfads abzuwarten, die die Oberfläche für diesen Gegenstand bekommt - VOR {@link open} aufrufen (wie
 * `routeAnswer` in `route-evidence.ts`). Die Fälle prüfen die Zeilen gegen diese Antwort statt gegen Zahlen im Test: Die Zahlen sind
 * Datenbestand und wachsen mit jedem Lauf der Regeln der Vorkommen (WI-0253, WI-0257).
 */
function loreAntwort(page: Page, ref: { kind: string; id: string }): Promise<LoreAntwort> {
    return page
        .waitForResponse(
            (candidate) => candidate.url().includes(`/api/subjects/${ref.kind}/${ref.id}/lore`) && candidate.ok(),
        )
        .then((response) => response.json() as Promise<LoreAntwort>);
}

/** Die Zeile einer Art aus der Antwort; die Voraussetzung jedes Falls steht davor, damit Wandern auf den Beleg zeigt und nicht aufs Produkt. */
function loreZeile(antwort: LoreAntwort, kind: string): LoreAntwort["rows"][number] {
    const zeile = antwort.rows.find((row) => row.kind === kind);
    expect(zeile, `Voraussetzung: die Antwort trägt eine Zeile ${kind}`).toBeDefined();
    return zeile!;
}

const loreGruppen = (zeile: LoreAntwort["rows"][number]): string[] => zeile.groups.map((gruppe) => gruppe.group);
const loreNamen = (zeile: LoreAntwort["rows"][number]): number =>
    zeile.groups.reduce((summe, gruppe) => summe + gruppe.entries.length, 0);

/** Ab so vielen Namen in der ZEILE klappen die Gruppen und steht das Suchfeld (WI-0099, WI-0122). */
const SCHWELLE = 25;

/**
 * Klappt die Vorkommenszeile einer Art auf und wartet, bis ihr Inhalt da ist.
 *
 * 🪤 Die Namen kommen verzögert (`GET {detail}/lore`): Gewartet wird auf das Register, nicht auf eine Zeitspanne - sonst misst
 * der Fall eine leere Zeile.
 */
async function expandRow(page: Page, kind: string): Promise<void> {
    const row = page.locator(`[data-field="lore:${kind}"]`);
    await row.waitFor({ timeout: 30_000 });
    await row.locator("button").first().click();
    await expect(row.getByTestId("info-lore-group").first()).toBeAttached({ timeout: 30_000 });
    await expect(row.getByTestId("info-lore-sheet").first()).toBeAttached({ timeout: 30_000 });
}

/**
 * Dasselbe für eine Zeile, deren ganzer Inhalt die LINKZEILE ist (seit WI-0103 der Normalfall an einem Gegenstand ohne
 * Eigenes): Dort entsteht nie eine Gruppe, also wartet {@link expandRow} vergeblich.
 */
async function expandRowLink(page: Page, kind: string): Promise<void> {
    const row = page.locator(`[data-field="lore:${kind}"]`);
    await row.waitFor({ timeout: 30_000 });
    await row.locator("button").first().click();
    await expect(row.getByTestId("info-lore-everywhere")).toBeAttached({ timeout: 30_000 });
}

/** Was im Register einer Zeile steht: Marken, Namen je Marke, wirkliche Spaltenzahl, Höhe und die Trennregel. */
function readRegister(
    page: Page,
    kind: string,
): Promise<{
    letters: string[];
    names: string[][];
    columns: number;
    height: number;
    hyphens: string;
    overflow: number;
}> {
    return page.evaluate((loreKind) => {
        const row = document.querySelector<HTMLElement>(`[data-field="lore:${loreKind}"]`);
        const blocks = [...(row?.querySelectorAll<HTMLElement>('[data-testid="info-lore-block"]') ?? [])];
        const nameSpans = blocks.map((block) => block.querySelector<HTMLElement>('[data-testid="info-lore-names"]'));
        return {
            letters: blocks.map(
                (block) => block.querySelector<HTMLElement>('[data-testid="info-lore-letter"]')?.textContent ?? "",
            ),
            names: nameSpans.map((span) => (span?.textContent ?? "").split(", ").map((name) => name.trim())),
            // Die Spaltenzahl steht in keiner berechneten Eigenschaft (`column-count` nennt die ANGABE): abgelesen an den
            // linken Kanten der Blöcke.
            columns: new Set(blocks.map((block) => Math.round(block.getBoundingClientRect().left))).size,
            height: Math.round(row?.getBoundingClientRect().height ?? 0),
            hyphens:
                nameSpans[0] === null || nameSpans[0] === undefined
                    ? "?"
                    : getComputedStyle(nameSpans[0]).hyphens ||
                      getComputedStyle(nameSpans[0]).getPropertyValue("-webkit-hyphens"),
            // Waagerechter Überlauf: die Zusicherung, für die `overflow-wrap: anywhere` steht.
            overflow: Math.max(0, ...nameSpans.map((span) => (span?.scrollWidth ?? 0) - (span?.clientWidth ?? 0))),
        };
    }, kind);
}

test("🔴 „Direkt von hier“ und „Aus der Region“ stehen OFFEN - keine zweite Klappstufe", async ({ page }) => {
    const antwort = loreAntwort(page, KLEINER_ORT);
    await open(page, KLEINER_ORT);
    await expandRow(page, "flora");
    const lore = loreZeile(await antwort, "flora");
    expect(loreGruppen(lore), "Voraussetzung: der Ort trägt „Direkt von hier“ und „Aus der Region“").toEqual([
        "here",
        "region",
    ]);
    expect(loreNamen(lore), "Voraussetzung: die ganze Zeile liegt unter der 25er-Schwelle").toBeLessThan(SCHWELLE);
    const row = page.locator('[data-field="lore:flora"]');

    // Beide Gruppen mit ihrer Überschrift, in dieser Reihenfolge - und mit ihrer Zahl daneben.
    await expect(row.getByTestId("info-lore-heading")).toHaveText(["Direkt von hier", "Aus der Region"]);
    await expect(row.getByTestId("info-lore-count")).toHaveText(
        lore.groups.map((gruppe) => String(gruppe.entries.length)),
    );
    // Und beide mit ihren Namen, unmittelbar sichtbar - nichts liegt hinter einem zweiten Knopf.
    const sheets = row.getByTestId("info-lore-sheet");
    await expect(sheets).toHaveCount(2);
    for (const index of [0, 1]) {
        await expect(sheets.nth(index)).toBeVisible();
        expect((await sheets.nth(index).boundingBox())?.height ?? 0).toBeGreaterThan(0);
    }
    // 🔴 Mit so wenigen Namen in der ganzen Zeile (Voraussetzung oben) liegt sie UNTER der 25er-Schwelle: Es gibt kein `<details>` und damit keine zweite
    // Klappstufe (Betreiber 2026-10-07, „brauch keine eigene klappbox“). Klappbar ist allein die Zeile selbst.
    expect(await row.locator("[aria-expanded]").count()).toBe(1);
    expect(await row.locator("details").count()).toBe(0);
    // 🔴 Und kein Suchfeld (WI-0122): Es steht erst ab derselben Schwelle, ab der die Gruppen klappen.
    expect(await row.getByRole("searchbox").count()).toBe(0);
});

test("🔴 Ab 25 Namen in der ZEILE klappen die Gruppen, und nur die ERSTE startet offen", async ({ page }) => {
    // Selems Waren: 88 Namen in zwei Gruppen („Von hier“ 3, „Aus der Region“ 85), also über der Schwelle.
    await open(page, SELEM);
    await expandRow(page, "ware");
    const row = page.locator('[data-field="lore:ware"]');

    await expect(row.getByTestId("info-lore-heading")).toHaveText(["Von hier", "Aus der Region"]);
    const groups = row.locator("details");
    await expect(groups).toHaveCount(2);
    // 🔴 Die Position entscheidet, nicht die Zahl: „Von hier“ hat DREI Namen und steht trotzdem offen, weil es die erste
    // Gruppe ist - die stärkste Aussage über den Ort.
    expect(await groups.nth(0).evaluate((node: HTMLDetailsElement) => node.open)).toBe(true);
    expect(await groups.nth(1).evaluate((node: HTMLDetailsElement) => node.open)).toBe(false);

    // Und sie klappt wirklich auf, wenn man ihren Kopf anklickt.
    await row.getByTestId("info-lore-group-head").last().click();
    await expect.poll(async () => groups.nth(1).evaluate((node: HTMLDetailsElement) => node.open)).toBe(true);
    expect((await readRegister(page, "ware")).letters.length).toBeGreaterThan(15);
});

test("🔴 Der längste Fall: Drunidets Tierarten im Register, gemessen", async ({ page }, testInfo) => {
    // 🔴 EINE belegte Gruppe (alles aus Meridiana und vier weiteren Flächen): kein Pfeil, nichts zum Klappen - aber SEIT dem
    // 2026-10-07 mit Kopf und Zahl (WI-0103). Die ganze Höhe hängt am Register.
    const antwort = loreAntwort(page, DRUNIDET);
    await open(page, DRUNIDET);
    await expandRow(page, "fauna");
    const lore = loreZeile(await antwort, "fauna");
    expect(loreGruppen(lore), "Voraussetzung: EINE Gruppe, „Aus der Region“").toEqual(["region"]);
    const namen = loreNamen(lore);
    expect(namen, "Voraussetzung: ein langes Register, weit über der 25er-Schwelle").toBeGreaterThan(SCHWELLE * 2);
    const row = page.locator('[data-field="lore:fauna"]');
    expect(await row.locator("details").count()).toBe(0);
    await expect(row.getByTestId("info-lore-heading")).toHaveText(["Aus der Region"]);

    const wide = await readRegister(page, "fauna");
    testInfo.annotations.push({
        type: "Gemessen",
        description: `1280 px: ${String(wide.letters.length)} Marken, ${String(wide.columns)} Spalten, ${String(wide.height)} px hoch`,
    });

    // Alle Namen der Antwort, und jeder steht unter SEINER Marke.
    expect(wide.names.flat()).toHaveLength(namen);
    for (const [at, letter] of wide.letters.entries()) {
        for (const name of wide.names[at] ?? []) expect(markOf(name), `${name} unter ${letter}`).toBe(letter);
    }
    // Die Marken stehen in deutscher Ordnung und jede nur einmal - sonst wäre die Sortierung mit `<` gemacht.
    expect(wide.letters).toEqual([...wide.letters].sort((left, right) => left.localeCompare(right, "de")));
    expect(new Set(wide.letters).size).toBe(wide.letters.length);

    // 🔴 Zwei Spalten in echter Größe - die Mindestbreite trägt hier.
    expect(wide.columns).toBe(2);
    // 💣 Keine deutsche Trennhilfe auf Eigennamen: Die Zeile nimmt sich aus der globalen Regel des Kanons heraus.
    expect(wide.hyphens).toBe("manual");
    // Und kein waagerechter Überlauf - dafür steht `overflow-wrap: anywhere`.
    expect(wide.overflow).toBeLessThanOrEqual(1);

    // 🪤 Am Telefon fällt es auf EINE Spalte zurück, ohne Breitenabfrage: 2 × 105 px plus Spalt passen nicht in 175 px.
    await page.setViewportSize({ width: 360, height: 900 });
    await expect.poll(async () => (await readRegister(page, "fauna")).columns, { timeout: 15_000 }).toBe(1);
    const narrow = await readRegister(page, "fauna");
    testInfo.annotations.push({
        type: "Gemessen",
        description: `360 px: ${String(narrow.letters.length)} Marken, 1 Spalte, ${String(narrow.height)} px hoch`,
    });
    expect(narrow.names.flat()).toHaveLength(namen);
    expect(narrow.overflow).toBeLessThanOrEqual(1);
});

test("🔴 Das Suchfeld an EINER langen Gruppe: Drunidets Tierarten filtern, zählen, Escape leert (WI-0122)", async ({
    page,
}) => {
    const antwort = loreAntwort(page, DRUNIDET);
    await open(page, DRUNIDET);
    await expandRow(page, "fauna");
    const lore = loreZeile(await antwort, "fauna");
    expect(loreGruppen(lore), "Voraussetzung: EINE Gruppe, „Aus der Region“").toEqual(["region"]);
    const namen = loreNamen(lore);
    expect(namen, "Voraussetzung: die Zeile steht über der 25er-Schwelle").toBeGreaterThanOrEqual(SCHWELLE);
    const row = page.locator('[data-field="lore:fauna"]');
    const field = row.getByRole("searchbox", { name: "Tierarten durchsuchen" });
    await expect(field).toBeVisible();
    const all = (await readRegister(page, "fauna")).names.flat();
    expect(all).toHaveLength(namen);

    // Ein Stück aus einem echten Namen, ohne Akzente und klein geschrieben: gefunden wird trotzdem.
    const fold = (text: string): string =>
        text
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/ß/g, "ss");
    const needle = fold(all[0] ?? "").slice(0, 4);
    const expected = all.filter((name) => fold(name).includes(needle));
    await field.fill(needle);
    await expect(row.getByTestId("info-lore-hits")).toHaveText(`${String(expected.length)} Treffer`);
    // 🔴 Die Gliederung („Aus der Region“) wird nicht mitgesucht, und die Vorkommen zählen keine Arten.
    await expect(row.getByTestId("info-lore-heading")).toHaveText(["Aus der Region"]);
    await expect(row.getByTestId("info-lore-count")).toHaveText(`${String(expected.length)} von ${String(namen)}`);
    expect((await readRegister(page, "fauna")).names.flat().sort()).toEqual([...expected].sort());
    expect(await row.getByTestId("info-marked").count()).toBeGreaterThanOrEqual(expected.length);

    await field.press("Escape");
    await expect(field).toHaveValue("");
    expect((await readRegister(page, "fauna")).names.flat()).toHaveLength(namen);
});

test("🔴 Der Link „Überall in Aventurien“ öffnet die Landschaft und markiert ihre Fläche", async ({ page }) => {
    await open(page, SELEM);
    await expandRow(page, "flora");
    const link = page.getByTestId("info-lore-everywhere").getByTestId("info-link");
    await expect(link).toHaveText(/^Überall in Aventurien \(\d+\)$/);

    await link.click();
    // 1. Das Panel zeigt die Landschaft.
    await expect(page.getByTestId("info-title")).toHaveText("Aventurien", { timeout: 30_000 });
    // 2. Die Karte hat ihre Fläche gewählt - „ganze aventurien wird gezeigt“ ist genau das, was ein Klick auf eine
    //    Landschaft ohnehin tut; hier ist nichts Eigenes gebaut.
    await expect
        .poll(async () => page.evaluate(() => globalThis.avesmapsAreaSelection?.()?.id), { timeout: 30_000 })
        .toBe(AVENTURIEN_ID);
    // 3. Und dort sind dieselben Einträge „Direkt von hier“: am Ziel gibt es keinen Link mehr.
    await expandRow(page, "flora");
    await expect(page.getByTestId("info-lore-everywhere")).toHaveCount(0);
});

test("🔴 Ein Ort ohne Eigenes und ohne Regionales bekommt die LINKZEILE - sie steht überall", async ({
    page,
}, testInfo) => {
    // 🔴 Betreiber 2026-10-07, wörtlich: „und ‚Überall in Aventurien‘ muss natürlich auch überall stehen, wenns in
    // Aventurien ist :)“ (WI-0103). 🪤 **Das dreht A11 um**: Bis dahin bekam Aumond KEINE Zeile. Er liegt in keiner
    // tragenden Fläche und trägt selbst nichts; kontinentweit gelten für ihn trotzdem 1.174 Einträge. Die Zeile ist
    // nicht leer - sie trägt den Link. Gemessen: 75 der 4.949 aktiven Orte sind so, dazu 349 Landschaften, 14 Gipfel,
    // 686 der 1.676 Gebiete und 2 der 1.265 Wege (WI-0104 §3).
    const antwort = loreAntwort(page, LEERER_ORT);
    await open(page, LEERER_ORT);
    await expect(page.getByTestId("info-title")).toHaveText(LEERER_NAME, { timeout: 30_000 });
    await expect(page.getByTestId("info-facts")).toBeVisible({ timeout: 30_000 });
    // Alle vier Arten, weil Aventurien von allen vier kontinentweite Einträge trägt (Waren 302, Fauna 383, Flora 445,
    // Spezies 44 am 2026-10-07).
    await expect(page.locator('[data-field^="lore:"]')).toHaveCount(4);

    // 🔴 Was das an Höhe kostet - die Zahl, die der Betreiber sehen wollte.
    const tabelle = await page
        .getByTestId("info-facts")
        .evaluate((node) => Number(node.getBoundingClientRect().height.toFixed(2)));
    testInfo.annotations.push({
        type: "Gemessen",
        description: `Datentabelle eines leeren Dorfes: ${String(tabelle)} px mit den vier Zeilen (ohne die Zeilen 288 px)`,
    });

    // 🔴 Aufgeklappt steht dort NUR der Link: keine Gruppe, kein Kopf, kein Name.
    await expandRowLink(page, "fauna");
    // Die Antwort des Lesepfads kommt erst mit dem Aufklappen (die Namen kommen verzögert): erst jetzt abwarten.
    const lore = await antwort;
    expect(lore.rows.map((zeile) => zeile.kind).sort(), "Voraussetzung: alle vier Arten haben eine Zeile").toEqual([
        "fauna",
        "flora",
        "spezies",
        "ware",
    ]);
    for (const zeile of lore.rows)
        expect(loreGruppen(zeile), `Voraussetzung: ${zeile.kind} ohne Eigenes und ohne Regionales`).toEqual([]);
    const row = page.locator('[data-field="lore:fauna"]');
    await expect(row.getByTestId("info-lore-group")).toHaveCount(0);
    await expect(row.getByTestId("info-lore-everywhere").getByTestId("info-link")).toHaveText(
        /^Überall in Aventurien \(\d+\)$/,
    );
    // 🔴 DER GRENZFALL VON WI-0104, am echten Stack: Der Satz zählt seit WI-0104 nur die Listen, und die sind hier leer.
    // Die Zeile bleibt trotzdem, und bei 0 sagt sie „Keine besonderen Vorkommen“ (Betreiber 2026-10-09) über dem Link.
    const satz = (await row.textContent()) ?? "";
    expect(satz).toMatch(/Keine besonderen Vorkommen/);
    expect(satz).not.toMatch(/0 Tierarten/);
    const linkText = (await row.getByTestId("info-lore-everywhere").textContent()) ?? "";
    testInfo.annotations.push({
        type: "Grenzfall",
        description: `${LEERER_NAME}, Zeile Fauna: Satz „${satz.replace(/\s+/g, " ").trim().slice(0, 60)}“ über „${linkText.trim()}“`,
    });
});

test("🔴 Eine einzige Gruppe trägt ihre Überschrift AUCH - der Hexenwald, am echten Stack", async ({ page }) => {
    // 🔴 Der Anlass der Entscheidung vom 2026-10-07 (WI-0103). Wörtlich: „Flächen haben abgeleitete Vorkommen <- z.B.
    // ‚Hexenwald‘, prima. aber abgeleitet bedeutet für mich (‚Aus der Region‘). das steht da nicht.“ Der Hexenwald
    // trägt NICHTS Eigenes: alle vier Zeilen bestehen aus der einen Gruppe `region` (Herz des Kontinents 20 Einträge,
    // Königreich Garetien 4). Legacy ließe den Kopf hier weg - und damit stünde nicht da, dass die Namen geerbt sind.
    const antwort = loreAntwort(page, HEXENWALD);
    await open(page, HEXENWALD);
    await expect(page.getByTestId("info-title")).toHaveText("Hexenwald", { timeout: 30_000 });
    await expandRow(page, "flora");
    const lore = loreZeile(await antwort, "flora");
    expect(loreGruppen(lore), "Voraussetzung: EINE Gruppe, „Aus der Region“, nichts Eigenes").toEqual(["region"]);
    const row = page.locator('[data-field="lore:flora"]');
    await expect(row.getByTestId("info-lore-heading")).toHaveText(["Aus der Region"]);
    await expect(row.getByTestId("info-lore-count")).toHaveText([String(loreNamen(lore))]);
    // 🔴 Kein Pfeil: der Kopf sagt etwas, er klappt nichts (eine Gruppe gliedert nichts).
    expect(await row.locator("details").count()).toBe(0);
});

test("🔴 Ein WEG trägt „Aus der Region“ und den Link - nie „Direkt von hier“", async ({ page }) => {
    // 🔴 Betreiber 2026-10-07: „Wege sollen abgeleitete Vorkommen haben (‚Aus der Region‘)“ (WI-0103). Vorher bekam ein
    // Weg GAR NICHTS: `case "path"` gab leere Träger zurück. 🪤 Er kann strukturell nichts Eigenes tragen -
    // `lore_place_target` hat keine `path_id`, und der CHECK `lore_place_target_one_target` erzwingt genau eines von
    // Ort, Gebiet, Region, Gipfel. Die Reichsstraße 2 (105 Abschnitte) erbt gemessen 129 Waren, 61 Fauna, 37 Flora, 8
    // Spezies aus den Flächen, die ihre Linie enthalten.
    await open(page, REICHSSTRASSE);
    await expect(page.getByTestId("info-title")).toHaveText("Reichsstraße 2", { timeout: 30_000 });
    await expect(page.locator('[data-field^="lore:"]')).toHaveCount(4);
    await expandRow(page, "ware");
    const row = page.locator('[data-field="lore:ware"]');
    // Genau EINE Gruppe, und sie heißt „Aus der Region“ - nichts gehört dem Weg selbst.
    await expect(row.getByTestId("info-lore-heading")).toHaveText(["Aus der Region"]);
    // Dazu die Linkzeile: ein Weg liegt genauso in Aventurien wie alles andere.
    await expect(row.getByTestId("info-lore-everywhere").getByTestId("info-link")).toHaveText(
        /^Überall in Aventurien \(\d+\)$/,
    );
});
