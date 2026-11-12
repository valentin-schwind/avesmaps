import { expect, test, type Page, type Route } from "@playwright/test";
import {
    MAM_BASKETS,
    MEDIA_ASSET_TYPES,
    type MamKarteAendernBody,
    type MamKarteDetail,
    type MamKartenListe,
    type MamNavigation,
} from "@avesmaps3d/shared";
import { MIT_MEDIEN, REVIEWER, stubSitzung } from "./medien-quelle.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";

/**
 * Die Kartensammlung in der Medienverwaltung bearbeiten (WI-0068 R5, Betreiber 2026-10-18 „B jetzt“), am Rechner. Die Antworten des
 * Servers sind hier vorgegeben (keine Datenbank): Was der Server tut, prüfen `media-kartensammlung.test.ts` und `citymaps.test.ts`; hier
 * geht es darum, dass der Kasten „Angaben“ genau das schickt, was sich geändert hat, dass „unbekannt“ eine eigene Wahl ist, dass nach dem
 * Speichern der Satz „Von Hand geändert“ steht und dass ein Konflikt die Person nennt und die Eingaben stehen lässt.
 */

const KARTE = "7e570000-0000-4000-8000-000000000061";

const navigation = (): MamNavigation => ({
    total: 0,
    kinds: { image: 0, model_3d: 0 },
    types: Object.fromEntries(MEDIA_ASSET_TYPES.map((typ) => [typ, 0])) as MamNavigation["types"],
    galleries: 0,
    citymaps: 1,
    photoboxGalerien: 0,
    typeImages: 0,
    baskets: Object.fromEntries(MAM_BASKETS.map((korb) => [korb, 0])) as MamNavigation["baskets"],
});

function detailAnfang(): MamKarteDetail {
    return {
        id: KARTE,
        revision: 3,
        title: "Stadtplan von Gareth",
        art: "politisch",
        colorMode: null,
        isMultilevel: null,
        isLabeled: false,
        isOfficial: true,
        isSpoiler: null,
        hasScale: null,
        widthPx: 2000,
        heightPx: 1500,
        format: null,
        validFromBf: 1027,
        validToBf: 9999,
        author: "Zeichnerin Elwe",
        publisher: null,
        note: null,
        legacyWikiKey: null,
        legacyOrigin: "manual",
        state: "active",
        active: true,
        importedAt: null,
        editorHeld: false,
        parent: null,
        related: [],
        types: ["stadtplan"],
        places: [],
        links: [],
        sources: [],
        wiki: null,
        images: [],
    };
}

const liste = (karte: MamKarteDetail): MamKartenListe => ({
    items: [
        {
            id: karte.id,
            title: karte.title,
            art: karte.art,
            types: karte.types,
            validFromBf: karte.validFromBf,
            validToBf: karte.validToBf,
            places: 0,
            images: 0,
            publicImages: 0,
            state: karte.state,
            active: karte.active,
            preview: null,
            privatePreview: null,
        },
    ],
    total: 1,
    retiredTotal: 0,
});

const json = (route: Route, status: number, body: unknown): Promise<void> =>
    route.fulfill({
        status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(body),
    });

/** Der Server der Medienverwaltung als Stand im Test: `antwort` entscheidet, was das nächste Ändern bekommt. */
async function server(
    page: Page,
    antwort: "annehmen" | "konflikt" = "annehmen",
): Promise<{ gesendet: MamKarteAendernBody[] }> {
    let karte = detailAnfang();
    const gesendet: MamKarteAendernBody[] = [];
    await page.route("**/api/editor/**", async (route) => {
        const url = new URL(route.request().url());
        const pfad = url.pathname;
        if (pfad === "/api/editor/media/navigation") return json(route, 200, navigation());
        if (pfad === "/api/editor/media/citymaps") return json(route, 200, liste(karte));
        if (pfad === `/api/editor/media/citymaps/${KARTE}`) return json(route, 200, karte);
        if (pfad === `/api/editor/media/citymaps/${KARTE}/update` && route.request().method() === "POST") {
            const body = route.request().postDataJSON() as MamKarteAendernBody;
            gesendet.push(body);
            if (antwort === "konflikt") {
                return json(route, 409, {
                    error: {
                        code: "edit_conflict",
                        message: "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
                        details: {
                            currentRevision: 4,
                            changedAt: "2026-10-18T15:00:00.000Z",
                            changedBy: { id: "1b2c3d4e-0000-4000-8000-000000000001", displayName: "Thalionmel" },
                        },
                    },
                });
            }
            karte = {
                ...karte,
                revision: karte.revision + 1,
                ...(body.fields?.author === undefined ? {} : { author: body.fields.author }),
                ...(body.fields?.isSpoiler === undefined ? {} : { isSpoiler: body.fields.isSpoiler }),
                ...(body.types === undefined ? {} : { types: body.types }),
                editorHeld: true,
            };
            return json(route, 200, {
                operationId: body.operationId,
                status: "applied",
                environment: "development",
                affected: [{ kind: "citymap", id: KARTE, revision: karte.revision }],
                derivedWork: [],
                warnings: [],
            });
        }
        return json(route, 404, { error: { code: "not_found", message: "Diese Adresse gibt es nicht." } });
    });
    return { gesendet };
}

async function oeffne(page: Page): Promise<void> {
    await stubSitzung(page, [...MIT_MEDIEN, "upload_media"]);
    await editorPanelGemerktZu(page);
    await page.goto(`/edit?medien&medien-objekt=kartensammlung&medien-karte=${KARTE}`);
    await expect(page.getByTestId("medien-spalte-karte")).toBeVisible({ timeout: 30_000 });
}

const kasten = (page: Page) => page.getByTestId("medien-kasten-karte");
/** Eingabe und Auswahl tragen die Kennung an ihrer Hülle (`avm-eingabe.vue`, `avm-auswahl.vue`); das Feld liegt darin. */
const feld = (page: Page, id: string) => page.getByTestId(id).locator("input, select");

test("🔴 Angaben bearbeiten: nur Geändertes geht hinaus, „unbekannt“ bleibt null, danach „Von Hand geändert“", async ({
    page,
}) => {
    const { gesendet } = await server(page);
    await oeffne(page);
    await expect(page.getByTestId("medien-karte-herkunft")).toHaveText("Noch unverändert aus dem Bestand.");
    await expect(kasten(page)).toContainText("Zeichnerin Elwe");

    await page.getByTestId("medien-kasten-karte-bearbeiten").click();
    await expect(page.getByTestId("medien-karte-bearbeiten-folge")).toContainText(
        "Gespeichert werden die Angaben und Typen dieser Karte",
    );
    // Unbekanntes steht als eigene Wahl da, nicht als „nein“.
    await expect(feld(page, "medien-karte-bearbeiten-mehrstoeckig")).toHaveValue("");
    await expect(feld(page, "medien-karte-bearbeiten-beschriftet")).toHaveValue("nein");

    await feld(page, "medien-karte-bearbeiten-zeichner").fill("Zeichnerin Elwe von Gareth");
    await feld(page, "medien-karte-bearbeiten-spoiler").selectOption("ja");
    await page.getByTestId("medien-karte-bearbeiten-typ-schatzkarte").check();
    await page.getByTestId("medien-kasten-karte-speichern").click();

    await expect(page.getByTestId("medien-karte-herkunft")).toContainText("Von Hand geändert");
    expect(gesendet).toHaveLength(1);
    expect(gesendet[0]).toMatchObject({
        baseRevision: 3,
        fields: { author: "Zeichnerin Elwe von Gareth", isSpoiler: true },
        types: ["schatzkarte", "stadtplan"],
    });
    expect(Object.keys(gesendet[0]!.fields ?? {}).sort(), "nur, was sich geändert hat").toEqual([
        "author",
        "isSpoiler",
    ]);
    expect(gesendet[0]!.operationId).toMatch(/^[0-9a-f-]{36}$/u);
    await expect(kasten(page)).toContainText("Zeichnerin Elwe von Gareth");
    await expect(page.getByTestId("medien-kasten-karte-bearbeiten"), "der Kasten ist wieder zu").toBeVisible();
});

test("🔴 ein Befund im Feld schickt nichts; ein Konflikt nennt die Person und lässt die Eingaben stehen", async ({
    page,
}) => {
    const { gesendet } = await server(page, "konflikt");
    await oeffne(page);
    await page.getByTestId("medien-kasten-karte-bearbeiten").click();

    await feld(page, "medien-karte-bearbeiten-titel").fill("   ");
    await feld(page, "medien-karte-bearbeiten-breite").fill("12a");
    await page.getByTestId("medien-kasten-karte-speichern").click();
    await expect(kasten(page)).toContainText("Eine Karte braucht einen Titel.");
    await expect(kasten(page)).toContainText("Eine ganze Zahl von 1 bis 1.000.000.");
    expect(gesendet, "mit Befund geht nichts hinaus").toHaveLength(0);

    await feld(page, "medien-karte-bearbeiten-titel").fill("Stadtplan von Gareth");
    await feld(page, "medien-karte-bearbeiten-breite").fill("2400");
    await page.getByTestId("medien-kasten-karte-speichern").click();
    await expect(page.getByTestId("medien-kasten-karte-fehler")).toContainText("Thalionmel hat das gerade geändert");
    // Zwischen den beiden Sätzen steht ein Leerzeichen (die R5-Bedienprobe sah „…04:45).Die eigenen …“).
    await expect(page.getByTestId("medien-kasten-karte-fehler")).toContainText(
        "). Die eigenen Eingaben bleiben stehen.",
    );
    await expect(feld(page, "medien-karte-bearbeiten-breite")).toHaveValue("2400");
    await expect(page.getByTestId("medien-kasten-karte-neu-laden")).toBeVisible();
    expect(gesendet).toHaveLength(1);
    expect(gesendet[0]).toMatchObject({ baseRevision: 3, fields: { widthPx: 2400 } });
    expect(REVIEWER.displayName, "die Person der Sitzung ist eine andere").not.toBe("Thalionmel");
});

test("Fokusfolge im Kasten (R8): Tab läuft in Lesefolge durch die Felder bis „Angaben speichern“", async ({ page }) => {
    await server(page);
    await oeffne(page);
    await page.getByTestId("medien-kasten-karte-bearbeiten").click();
    await feld(page, "medien-karte-bearbeiten-titel").focus();
    const erwartet = [
        "medien-karte-bearbeiten-art",
        "medien-karte-bearbeiten-farbe",
        ...[
            "ortsplan",
            "stadtplan",
            "bezirk",
            "viertel",
            "lageplan",
            "uebersicht",
            "schauplatz",
            "grundriss",
            "befestigungen",
            "dungeon",
            "hoehlen",
            "krypten",
            "katakomben",
            "schatzkarte",
            "region",
            "sonstige",
        ].map((typ) => `medien-karte-bearbeiten-typ-${typ}`),
        "medien-karte-bearbeiten-mehrstoeckig",
        "medien-karte-bearbeiten-beschriftet",
        "medien-karte-bearbeiten-offiziell",
        "medien-karte-bearbeiten-spoiler",
        "medien-karte-bearbeiten-massstab",
        "medien-karte-bearbeiten-breite",
        "medien-karte-bearbeiten-hoehe",
        "medien-karte-bearbeiten-ab",
        "medien-karte-bearbeiten-bis",
        "medien-karte-bearbeiten-format",
        "medien-karte-bearbeiten-zeichner",
        "medien-karte-bearbeiten-verlag",
        "medien-karte-bearbeiten-notiz",
        "medien-kasten-karte-abbrechen",
        "medien-kasten-karte-speichern",
    ];
    const gesehen: (string | null)[] = [];
    for (let i = 0; i < erwartet.length; i += 1) {
        await page.keyboard.press("Tab");
        gesehen.push(
            await page.evaluate(
                () => document.activeElement?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
            ),
        );
    }
    expect(gesehen).toEqual(erwartet);
});
