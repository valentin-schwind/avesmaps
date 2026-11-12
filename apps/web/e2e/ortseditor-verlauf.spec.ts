import { expect, test, type Page } from "@playwright/test";
import type {
    EditorPlaceDetail,
    MapHistoryPage,
    RuecknahmeBody,
    RuecknahmePruefung,
    RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import { settleFrame } from "./map-handle.ts";
import { GRATENFELS, GRATENFELS_LAGE, fenster, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";

/**
 * Verlauf und „Änderungen“ (WI-0128 E17; EDIT-0001 §7.1 E17): jede Operation mit Person, Feldern und Revision; ↺ nimmt eine
 * Operation als neue zurück; „Änderungen“ im Editorpanel mit „Nur meine“. Der Server antwortet hier gestellt.
 *
 * Der Verlauf des Orts ist seit WI-0265 B6d der gemeinsame Verlauf der Fenster (`fenster/entwurf-verlauf.vue`): Serien, Zustand und das gemeinsame Detail mit Vorher, Nachher und Karte. Das ⊕ an der
 * Zeile der Lage ist darin aufgegangen („⊕ Auf der Karte zeigen“ im Detail, B5b).
 *
 * ↺ geht seit WI-0265 B5c über den Server: Vorprüfung (`restore-series/preview`), Rückfrage, Rücknahme (`restore-series`). Die Fälle hier stellen beide Antworten
 * und prüfen, was die Oberfläche schickt; dass der echte Server so antwortet, belegt `aenderungen-ruecknahme.spec.ts` (Zwei-Kontext-Fall gegen die Testwelt).
 */
const RECHTE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];
const OPERATION = "e17e17e1-0000-4000-8000-000000000042";
const leer = { value: null, origin: null, wiki: null };

const ORT: EditorPlaceDetail = {
    publicId: GRATENFELS,
    revision: 9,
    name: "Gratenfels",
    subtype: "stadt",
    kind: null,
    position: GRATENFELS_LAGE,
    active: true,
    hidden: true,
    ruined: false,
    nodix: false,
    seaport: false,
    underground: false,
    withdrawn: false,
    approximate: false,
    sourceSystem: "legacy",
    fields: { description: leer, einwohner: leer, lage: leer, oberhaupt: leer },
    wiki: null,
    pathEnds: [],
};

const SEITE: MapHistoryPage = {
    entries: [
        {
            operationId: OPERATION,
            seq: 42,
            at: "2026-10-11T10:00:00.000Z",
            operation: "place.update",
            source: "editor",
            summary: "Gratenfels geändert",
            actor: { kind: "person", name: "Rondrikan", self: true },
            status: "ruecknehmbar",
            objects: [
                {
                    kind: "place",
                    id: GRATENFELS,
                    name: "Gratenfels",
                    action: "place.updated",
                    revisionBefore: 8,
                    revisionAfter: 9,
                    changes: { hidden: { before: false, after: true } },
                },
            ],
        },
    ],
};

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/** Die Vorprüfung des Servers für EIN Mitglied: alles in Ordnung (`ergebnis: ok`), mit den Folgen für die Rückfrage. */
const pruefung = (operationId: string, operation: string, action: string): RuecknahmePruefung => ({
    ergebnis: "ok",
    membersHash: "f".repeat(64),
    mitglieder: [
        {
            operationId,
            seq: 42,
            at: "2026-10-11T10:00:00.000Z",
            operation,
            source: "editor",
            actor: { kind: "person", name: "Rondrikan" },
            status: "ruecknehmbar",
            offen: true,
            gegenstaende: [
                {
                    kind: "place",
                    id: GRATENFELS,
                    name: "Gratenfels",
                    action,
                    revisionBefore: 8,
                    revisionAfter: 9,
                    felder: [],
                },
            ],
        },
    ],
    offen: [operationId],
    gegenstaende: [],
    konflikte: [],
    sperren: [],
    fehlendeRechte: [],
    fremdePersonen: [],
    reasonRequired: false,
    folgen: { gegenstaende: 1, gelaende: "keines" },
});

const QUITTUNG = {
    operationId: "00000000-0000-4000-8000-000000000001",
    status: "applied",
    environment: "development",
    affected: [{ kind: "place", id: GRATENFELS, revision: 10 }],
    derivedWork: [],
    warnings: [],
    mapRevision: 11,
};

/** Stellt die Vorprüfung und die Rücknahme des Orts; die Körper, die die Oberfläche schickt, sammelt es. */
async function ruecknahmeStubs(page: Page, operationId: string, operation: string, action: string) {
    const vorschau: RuecknahmeVorschauBody[] = [];
    const zurueck: RuecknahmeBody[] = [];
    await page.route(`**/api/editor/places/${GRATENFELS}/restore-series/preview`, (route) => {
        vorschau.push(route.request().postDataJSON() as RuecknahmeVorschauBody);
        return route.fulfill(json(pruefung(operationId, operation, action)));
    });
    await page.route(`**/api/editor/places/${GRATENFELS}/restore-series`, (route) => {
        zurueck.push(route.request().postDataJSON() as RuecknahmeBody);
        return route.fulfill(json({ ...QUITTUNG, reverts: [operationId] }));
    });
    return { vorschau, zurueck };
}

/** Stellt den Server; `verlauf` und `orte` zählen, wie oft die Oberfläche den Verlauf des Orts und den Ort selbst gelesen hat. */
async function stubs(page: Page): Promise<{ aenderungen: string[]; verlauf: string[]; orte: string[] }> {
    const aenderungen: string[] = [];
    const verlauf: string[] = [];
    const orte: string[] = [];
    await page.route("**/api/editor/status", (route) => route.fulfill(json({ mapEditing: "testwelt" })));
    await page.route(`**/api/editor/places/${GRATENFELS}`, (route) => {
        orte.push(route.request().url());
        return route.fulfill(json(ORT));
    });
    await page.route(`**/api/editor/places/${GRATENFELS}/history*`, (route) => {
        verlauf.push(route.request().url());
        return route.fulfill(json(SEITE));
    });
    await page.route("**/api/editor/changes*", (route) => {
        aenderungen.push(route.request().url());
        return route.fulfill(json(SEITE));
    });
    return { aenderungen, verlauf, orte };
}

test("🔴 der Verlauf eines Orts: wer, wann, Feld alt → neu; ↺ fragt den Server, fragt nach und nimmt als neue Operation zurück", async ({
    page,
}) => {
    const { verlauf, orte } = await stubs(page);
    const { vorschau, zurueck } = await ruecknahmeStubs(page, OPERATION, "place.update", "place.updated");
    await oeffneOrtseditor(page, { rechte: RECHTE });
    await zeile(page, "Gratenfels").click();
    await fenster(page).locator('[data-testid$="-reiter-verlauf"]').click();
    const eintrag = fenster(page).locator('[data-testid$="-verlauf-eintrag"]').first();
    await expect(eintrag).toContainText("Gratenfels geändert");
    // Die Zeile ist dieselbe wie im Reiter „Änderungen“ (WI-0265 B10): der Anzeigename auch bei der eigenen Änderung, die Revision dahinter.
    await expect(eintrag).toContainText("Rondrikan");
    await expect(eintrag).toContainText("Revision 8 → 9");
    // Der Zustand ist der Kreis, sein Wort der Tooltip (B10); die Felder stehen im gemeinsamen Detail vorher → nachher.
    await expect(
        eintrag.getByTestId("aenderung-status").getByRole("img", { name: "wirksam (rücknehmbar)" }),
    ).toBeVisible();
    await eintrag.locator("summary").click();
    await expect(eintrag.locator("dl")).toContainText("Verborgen");
    await expect(eintrag.locator("dl s")).toContainText("nein");

    // Klick: Der Server prüft, es wird noch nichts geschrieben; die Rückfrage steht im Fenster (kein zweites Fenster).
    await eintrag.locator('[data-testid$="-ruecknahme"]').click();
    const frage = eintrag.locator('[data-testid$="-ruecknahme-frage"]');
    await expect(frage).toContainText("Diese Änderung zurücknehmen?");
    await expect(frage).toContainText("Eigenschaften geändert");
    expect(vorschau).toEqual([{ members: [OPERATION] }]);
    expect(zurueck).toHaveLength(0);
    const verlaufVorher = verlauf.length;
    const orteVorher = orte.length;
    await frage.getByRole("button", { name: "Zurücknehmen", exact: true }).click();
    await expect.poll(() => zurueck.length).toBe(1);
    expect(zurueck[0]).toEqual({ operationId: expect.any(String), members: [OPERATION], membersHash: "f".repeat(64) });

    // Danach liest der Ort sich neu (Revision, Felder) und der Verlauf auch, ohne dass jemand lädt.
    await expect.poll(() => orte.length).toBeGreaterThan(orteVorher);
    await expect.poll(() => verlauf.length).toBeGreaterThan(verlaufVorher);
});

const RUECKNAHME = "e17e17e1-0000-4000-8000-000000000043";
/** Der Verlauf nach einem ↺: die Rücknahme mit `reverts` über dem Original mit `revertedBy`. */
const SEITE_NACH_RUECKNAHME: MapHistoryPage = {
    entries: [
        {
            operationId: RUECKNAHME,
            seq: 43,
            at: "2026-10-12T10:00:00.000Z",
            operation: "place.update",
            source: "restore",
            summary: "Gratenfels: Änderung zurückgenommen",
            actor: { kind: "person", name: "Rondrikan", self: true },
            status: "ruecknehmbar",
            reverts: [OPERATION],
            objects: [
                {
                    kind: "place",
                    id: GRATENFELS,
                    name: "Gratenfels",
                    action: "place.updated",
                    revisionBefore: 9,
                    revisionAfter: 10,
                    changes: { hidden: { before: true, after: false } },
                },
            ],
        },
        {
            ...SEITE.entries[0]!,
            status: "bereits_zurueckgenommen",
            revertedBy: {
                operationId: RUECKNAHME,
                at: "2026-10-12T10:00:00.000Z",
                actor: { kind: "person", name: "Rondrikan", self: true },
            },
        },
    ],
};

test("🔴 Verlauf nach einem ↺: Rücknahme und Original lassen sich aufklappen, ohne dass der Verlauf von selbst aufklappt und endlos neu zeichnet", async ({
    page,
}) => {
    // Das Detail fragte beim Zeichnen mit einer Funktion, die aufklappt: Im Produktionsbau fror das den Browser ein, hier meldet Vue die Rekursion.
    const meldungen: string[] = [];
    page.on("console", (meldung) => {
        if (meldung.type() === "error" || meldung.type() === "warning") meldungen.push(meldung.text());
    });
    page.on("pageerror", (fehler) => meldungen.push(fehler.message));
    await stubs(page);
    await page.route(`**/api/editor/places/${GRATENFELS}/history*`, (route) =>
        route.fulfill(json(SEITE_NACH_RUECKNAHME)),
    );
    await oeffneOrtseditor(page, { rechte: RECHTE });
    await zeile(page, "Gratenfels").click();
    await fenster(page).locator('[data-testid$="-reiter-verlauf"]').click();
    const eintraege = fenster(page).locator('[data-testid$="-verlauf-eintrag"]');
    await expect(eintraege).toHaveCount(2);
    const ruecknahme = eintraege.nth(0);
    const original = eintraege.nth(1);

    // Die Rücknahme auf: Sie nennt das Original als Knopf, das Original bleibt zu.
    await ruecknahme.locator("summary").click();
    await expect(ruecknahme.getByTestId("aenderung-detail-reverts")).toBeVisible();
    const zumOriginal = ruecknahme.getByRole("button", { name: "e17e17e1…" });
    await expect(zumOriginal).toBeVisible();
    await settleFrame(page);
    await expect(original.locator("details")).not.toHaveAttribute("open");

    // Erst der Klick klappt das Original auf; es nennt seine Rücknahme.
    await zumOriginal.click();
    await expect(original.locator("details")).toHaveAttribute("open");
    await expect(original.getByTestId("aenderung-detail-zurueck-durch")).toBeVisible();
    await settleFrame(page);
    expect(meldungen.filter((text) => /recursive|Rekursion/i.test(text))).toEqual([]);
});

test("🔴 „Änderungen“ im Editorpanel: das Protokoll aller Operationen, „Nur meine“ fragt nur die eigenen", async ({
    page,
}) => {
    const { aenderungen } = await stubs(page);
    await oeffneOrtseditor(page, { rechte: RECHTE, verb: false });
    await page.getByTestId("editorpanel-reiter-aenderungen").click();
    await expect(page.getByTestId("editorpanel-aenderung").first()).toContainText("Gratenfels geändert");
    await expect(page.getByTestId("editorpanel-aenderung").first()).toContainText("Verborgen");
    // „Meine | Alle“ ist ein Reiter unter der Leiste (WI-0265 B5a, Probierseite), kein Eintrag im Trichter mehr.
    await page.getByTestId("aenderungen-wer-reiter-meine").click();
    await expect.poll(() => aenderungen.some((url) => url.includes("mine=true"))).toBe(true);
});

test("🔴 E22 „Änderungen“: ein „Ganz löschen“ trägt weder ⊕ noch ⚙; „Diese Änderung zurücknehmen“ nimmt es als EINE Rücknahme des Servers zurück", async ({
    page,
}) => {
    await stubs(page);
    const LOESCHEN = "e22e22e2-0000-4000-8000-000000000099";
    await page.route("**/api/editor/changes*", (route) =>
        route.fulfill(
            json({
                entries: [
                    {
                        operationId: LOESCHEN,
                        seq: 43,
                        at: "2026-10-12T08:00:00.000Z",
                        operation: "place.delete",
                        source: "editor",
                        summary: "Gratenfels gelöscht",
                        actor: { kind: "person", name: "Rondrikan", self: true },
                        status: "ruecknehmbar",
                        objects: [
                            {
                                kind: "place",
                                id: GRATENFELS,
                                name: "Gratenfels",
                                action: "place.deleted",
                                revisionBefore: 9,
                                revisionAfter: 10,
                                changes: { active: { before: true, after: false } },
                            },
                        ],
                    },
                ],
            } satisfies MapHistoryPage),
        ),
    );
    const { vorschau, zurueck } = await ruecknahmeStubs(page, LOESCHEN, "place.delete", "place.deleted");
    await oeffneOrtseditor(page, { rechte: RECHTE, verb: false });
    await page.getByTestId("editorpanel-reiter-aenderungen").click();
    const eintrag = page.getByTestId("editorpanel-aenderung").first();
    await expect(eintrag).toContainText("Gratenfels gelöscht");
    await expect(eintrag.getByTestId("editorpanel-aenderung-zeige")).toHaveCount(0);
    // Das ↺ steht im Detail der Zeile und fragt zuerst den Server (Vorprüfung), dann den Menschen.
    await eintrag.getByTestId("editorpanel-aenderung-zeile").click();
    await eintrag.getByTestId("editorpanel-aenderung-ruecknahme").click();
    const frage = eintrag.getByTestId("editorpanel-aenderung-ruecknahme-frage");
    await expect(frage).toContainText("Diese Änderung zurücknehmen?");
    expect(vorschau).toEqual([{ members: [LOESCHEN] }]);
    expect(zurueck).toHaveLength(0);
    await frage.getByRole("button", { name: "Zurücknehmen", exact: true }).click();
    await expect.poll(() => zurueck.length).toBe(1);
    expect(zurueck[0]).toEqual({ operationId: expect.any(String), members: [LOESCHEN], membersHash: "f".repeat(64) });
    await expect(page.getByText("Die Änderung ist zurückgenommen.").first()).toBeVisible();
});

test("🔴 „Änderungen“: die Leiste jeder Liste (Guide §13.45), Suche links über Ort, Feld und Person, Trichter rechtsbündig", async ({
    page,
}) => {
    const { aenderungen } = await stubs(page);
    await oeffneOrtseditor(page, { rechte: RECHTE, verb: false });
    await page.getByTestId("editorpanel-reiter-aenderungen").click();
    const suche = page.getByTestId("editorpanel-aenderungen-leiste-suche");
    const trichter = page.getByTestId("editorpanel-aenderungen-filter");
    const [s, f] = await Promise.all([suche.boundingBox(), trichter.boundingBox()]);
    expect(Math.abs(s!.y + s!.height / 2 - (f!.y + f!.height / 2))).toBeLessThan(4);
    expect(s!.x + s!.width).toBeLessThanOrEqual(f!.x);

    // Der Server sucht (die Einträge kommen seitenweise); der angezeigte Feldname geht als Schlüssel mit.
    await suche.locator("input").fill("Verb");
    await expect.poll(() => aenderungen.find((url) => url.includes("q=Verb"))).toMatch(/qFelder=hidden/);
    // Esc leert zuerst die Suche, dann fragt die Liste wieder alles.
    const vorher = aenderungen.length;
    await suche.locator("input").press("Escape");
    await expect(suche.locator("input")).toHaveValue("");
    await expect.poll(() => aenderungen.slice(vorher).some((url) => !url.includes("q="))).toBe(true);
});

test("🔴 „⊕ Auf der Karte zeigen“ im Detail legt die frühere und die jetzige Lage auf die Karte, die Kamera fliegt in die freie Fläche - und nichts wird zurückgenommen", async ({
    page,
}) => {
    // Breit genug, dass neben dem angedockten Ortseditor überhaupt freie Karte bleibt: sonst zielt die Kamera wie ohne freie Fläche, in die Mitte der ganzen Karte.
    await page.setViewportSize({ width: 1920, height: 1080 });
    const VORHER = { x: GRATENFELS_LAGE.x - 12, y: GRATENFELS_LAGE.y + 9 };
    await stubs(page);
    const { vorschau, zurueck } = await ruecknahmeStubs(page, OPERATION, "place.move", "place.moved");
    await page.route(`**/api/editor/places/${GRATENFELS}/history*`, (route) =>
        route.fulfill(
            json({
                entries: [
                    {
                        ...SEITE.entries[0]!,
                        operation: "place.move",
                        summary: "Gratenfels verschoben",
                        objects: [
                            {
                                kind: "place",
                                id: GRATENFELS,
                                name: "Gratenfels",
                                action: "place.moved",
                                revisionBefore: 8,
                                revisionAfter: 9,
                                // 🪤 Die Lage steht im Protokoll als Paar [x, y], nicht als Objekt (`punkt` in `aenderung-karte-modell.ts`).
                                changes: {
                                    position: {
                                        before: [VORHER.x, VORHER.y],
                                        after: [GRATENFELS_LAGE.x, GRATENFELS_LAGE.y],
                                    },
                                },
                            },
                        ],
                    },
                ],
            } satisfies MapHistoryPage),
        ),
    );
    await oeffneOrtseditor(page, { rechte: RECHTE });
    await zeile(page, "Gratenfels").click();
    await fenster(page).locator('[data-testid$="-reiter-verlauf"]').click();
    const eintrag = fenster(page).locator('[data-testid$="-verlauf-eintrag"]').first();
    await eintrag.locator("summary").click();

    const vorher = await page.evaluate(() => {
        const mitte = globalThis.avesmapsMap!.getCenter();
        return { lng: mitte.lng, lat: mitte.lat };
    });
    await eintrag.locator('[data-testid$="-karte"]').click();
    await expect(page.getByTestId("aenderungen-karte-leiste")).toBeVisible();
    // Der Flug beginnt erst, wenn die Überlagerung steht: Gewartet wird auf eine Mitte, die anders ist als vorher, und auf das Ende der Bewegung.
    await page.waitForFunction(
        (lng) => globalThis.avesmapsMap?.isMoving() === false && globalThis.avesmapsMap.getCenter().lng !== lng,
        vorher.lng,
        { timeout: 10_000 },
    );
    await settleFrame(page);

    // Die Kamera ist zu den beiden Stellen geflogen; sie steht jetzt woanders, und beide liegen in der freien Fläche.
    const nachher = await page.evaluate(() => {
        const mitte = globalThis.avesmapsMap!.getCenter();
        return { lng: mitte.lng, lat: mitte.lat };
    });
    expect(nachher.lng).not.toBeCloseTo(vorher.lng, 6);
    const auf = await page.evaluate(
        (punkte) => {
            const map = globalThis.avesmapsMap!;
            const rahmen = map.getCanvas().getBoundingClientRect();
            const editor = document
                .querySelector('dialog[data-lage][open][data-testid^="ortseditor-"]')!
                .getBoundingClientRect();
            return {
                xs: punkte.map(
                    (p) => rahmen.left + map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p)).x,
                ),
                editorLinks: editor.left,
            };
        },
        [VORHER, GRATENFELS_LAGE],
    );
    for (const x of auf.xs) expect(x).toBeLessThan(auf.editorLinks);
    // 🔴 ⊕ ist keine Rücknahme: Es wurde nichts geschrieben.
    expect([...vorschau, ...zurueck]).toEqual([]);
});

test("🔴 Sprung (WI-0265 B5a2): „Im Objektverlauf zeigen“ wählt im Verlauf des Orts dieselbe Operation, „In Änderungen zeigen“ führt zurück", async ({
    page,
}) => {
    await stubs(page);
    await oeffneOrtseditor(page, { rechte: RECHTE, verb: false });
    await page.getByTestId("editorpanel-reiter-aenderungen").click();
    await page.getByTestId("editorpanel-aenderung-zeile").first().click();
    await page.getByTestId("editorpanel-aenderung-sprung").click();

    // Das Fenster des Ortseditors öffnet am Ort, der Reiter „Verlauf“ ist gewählt, und der Eintrag mit DERSELBEN Kennung ist aufgeklappt.
    const eintrag = fenster(page).locator(`[data-aenderung-id="${OPERATION}"]`);
    await expect(eintrag).toBeVisible();
    await expect(eintrag.locator("details")).toHaveAttribute("open", "");
    await expect(eintrag.locator("dl")).toContainText("Verborgen");

    // Zurück: Der Reiter „Änderungen“ kommt nach vorn (das Fenster wird abgelegt), dieselbe Operation ist gewählt.
    await eintrag.locator('[data-testid$="-sprung"]').click();
    await expect(page.getByTestId("editorpanel-reiter-aenderungen")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("editorpanel-aenderung-zeile").first()).toHaveAttribute("aria-expanded", "true");
    // Die Kennung steht im Fuß gekürzt (die ganze im Tooltip).
    await expect(page.getByTestId("editorpanel-aenderung-detail")).toContainText(OPERATION.slice(0, 8));
    await expect(
        page.getByTestId("editorpanel-aenderung-detail").getByTestId("aenderung-detail-kennung"),
    ).toHaveAttribute("title", OPERATION);
});

const SERIE_A = "e17e17e1-0000-4000-8000-0000000000a1";
const SERIE_B = "e17e17e1-0000-4000-8000-0000000000a2";

/** Zwei Änderungen derselben Person am Ort in Folge: eine Arbeitsserie (Fachvertrag B), die Liste kennt beide Mitglieder. */
const SERIEN_SEITE: MapHistoryPage = {
    entries: [
        {
            ...SEITE.entries[0]!,
            operationId: SERIE_B,
            seq: 44,
            at: "2026-10-11T10:05:00.000Z",
            summary: "Gratenfels geändert",
            status: "ruecknehmbar",
            series: { id: SERIE_A, position: 2, size: 2 },
            objects: [
                {
                    kind: "place",
                    id: GRATENFELS,
                    name: "Gratenfels",
                    action: "place.updated",
                    revisionBefore: 9,
                    revisionAfter: 10,
                    changes: { name: { before: "Gratenfels", after: "Gratenfels am Fluss" } },
                },
            ],
        },
        {
            ...SEITE.entries[0]!,
            operationId: SERIE_A,
            seq: 43,
            at: "2026-10-11T10:00:00.000Z",
            status: "ruecknehmbar",
            series: { id: SERIE_A, position: 1, size: 2 },
        },
    ],
    series: [
        {
            id: SERIE_A,
            size: 2,
            delivered: 2,
            members: [SERIE_A, SERIE_B],
            membersHash: "a".repeat(64),
            scope: { kind: "place", id: GRATENFELS, name: "Gratenfels" },
        },
    ],
};

test("🔴 Serien (WI-0265 B6d): zwei Änderungen in Folge stehen als aufklappbare Serie; ↺ der Serie nimmt beide als EINE Rücknahme zurück, einzeln geht nur das letzte Mitglied", async ({
    page,
}) => {
    await stubs(page);
    await page.route(`**/api/editor/places/${GRATENFELS}/history*`, (route) => route.fulfill(json(SERIEN_SEITE)));
    const vorschau: RuecknahmeVorschauBody[] = [];
    const zurueck: RuecknahmeBody[] = [];
    await page.route(`**/api/editor/places/${GRATENFELS}/restore-series/preview`, (route) => {
        vorschau.push(route.request().postDataJSON() as RuecknahmeVorschauBody);
        const ein = pruefung(SERIE_A, "place.update", "place.updated");
        const zwei = pruefung(SERIE_B, "place.update", "place.updated");
        return route.fulfill(
            json({
                ...ein,
                membersHash: "a".repeat(64),
                mitglieder: [...ein.mitglieder, ...zwei.mitglieder.map((m) => ({ ...m, seq: 44 }))],
                offen: [SERIE_A, SERIE_B],
            } satisfies RuecknahmePruefung),
        );
    });
    await page.route(`**/api/editor/places/${GRATENFELS}/restore-series`, (route) => {
        zurueck.push(route.request().postDataJSON() as RuecknahmeBody);
        return route.fulfill(json({ ...QUITTUNG, reverts: [SERIE_A, SERIE_B] }));
    });
    await oeffneOrtseditor(page, { rechte: RECHTE });
    await zeile(page, "Gratenfels").click();
    await fenster(page).locator('[data-testid$="-reiter-verlauf"]').click();

    // Die Serie steht als EINE Zeile da (Gegenstand und Zahl), die Mitglieder sind zu.
    const serie = fenster(page).locator('[data-testid$="-verlauf-serie"]');
    await expect(serie).toHaveCount(1);
    await expect(serie).toContainText("Gratenfels — 2 Änderungen");
    await expect(fenster(page).locator('[data-testid$="-verlauf-eintrag"]')).toHaveCount(0);

    // Ein Druck öffnet die Serie (WI-0265 B10: dieselbe Zeile wie im Reiter): ihr Detail UND ihre Mitglieder, jedes mit Zustand und Schritt; das Detail zeigt Vorher und Nachher.
    await serie.locator('[data-testid$="-verlauf-serie-zeile"]').click();
    const mitglieder = fenster(page).locator('[data-testid$="-verlauf-eintrag"]');
    await expect(mitglieder).toHaveCount(2);
    await expect(
        mitglieder.first().getByTestId("aenderung-status").getByRole("img", { name: "wirksam (rücknehmbar)" }),
    ).toBeVisible();
    await expect(mitglieder.first()).toContainText("Schritt 2/2");
    await mitglieder.first().locator("summary").click();
    await expect(mitglieder.first().locator("dl")).toContainText("Gratenfels am Fluss");

    // Einzeln geht nur das letzte offene Mitglied: das ältere ist überholt, noch bevor der Server gefragt wird.
    await mitglieder.last().locator("summary").click();
    await expect(mitglieder.last().locator('[data-testid$="-ruecknahme"]')).toBeDisabled();
    await expect(mitglieder.first().locator('[data-testid$="-ruecknahme"]')).toBeEnabled();

    // Die ganze Serie: Der Server prüft mit ALLEN Mitgliedern und der Prüfsumme, die Rückfrage nennt beide, EINE Rücknahme.
    const serienRuecknahme = serie.locator('[data-testid$="-serien-detail"] [data-testid$="-ruecknahme"]');
    await expect(serienRuecknahme).toContainText("Serie zurücknehmen (2)");
    await serienRuecknahme.click();
    const frage = serie.locator('[data-testid$="-ruecknahme-frage"]');
    await expect(frage).toContainText("Die gesamte Serie zurücknehmen?");
    expect(vorschau).toEqual([{ members: [SERIE_A, SERIE_B], membersHash: "a".repeat(64) }]);
    expect(zurueck).toHaveLength(0);
    await frage.getByRole("button", { name: "Serie zurücknehmen (2)", exact: true }).click();
    await expect.poll(() => zurueck.length).toBe(1);
    expect(zurueck[0]).toEqual({
        operationId: expect.any(String),
        members: [SERIE_A, SERIE_B],
        membersHash: "a".repeat(64),
    });
});
