import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import {
    MEDIA_COAT_BIND_URL,
    MEDIA_COAT_NONE_URL,
    MEDIA_EDITOR_GALLERY_URL,
    MEDIA_GALLERY_BIND_URL,
    MEDIA_HEADER_NONE_URL,
    MEDIA_HEADER_SET_URL,
    type EditorPlaceList,
    type MamAssetSummary,
    type MamGallerySummary,
    type MediaSlotAsset,
    type MediaSubjectSlots,
} from "@avesmaps3d/shared";
import { GRATENFELS, LISTE, fenster, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";

/**
 * Der Reiter „Bilder“ (WI-0128 E19; EDIT-0001 §8.1 E19 „jede Handlung eine Operation der Medienverwaltung, Infopanel und Liste zeigen
 * das neue Wappen“; WI-0126 §11j; Gesamtmockup Version 7).
 *
 * 🔴 Kein Test schreibt in die Datenbank der Entwicklung (W15): Plätze, Suche und die Operationen der Medienverwaltung kommen aus einem
 * Stub; den echten Schreibweg prüfen die Tests der Medienverwaltung gegen die Testdatenbank (`media-operations-routes.test.ts`).
 */

const RECHTE = [
    "use_editor_menu",
    "edit_map_objects",
    "view_media_private",
    "upload_media",
    "edit_territories",
    "edit_landscapes",
];
const BILD = (n: number) => `e19e19e1-0000-4000-8000-00000000000${String(n)}`;
const SHA = (n: number) => String(n).repeat(64);
const PERSON = { id: "e19e19e1-0000-4000-8000-0000000000aa", displayName: "Rondrikan" };

function asset(n: number, ueber: Partial<MediaSlotAsset> = {}): MediaSlotAsset {
    return {
        id: BILD(n),
        revision: 1,
        title: `Bild ${String(n)}`,
        technicalState: "ok",
        clearance: "cleared",
        preview: { url: `/media/${SHA(n)}.webp`, width: 64, height: 36 },
        uploadedBy: PERSON,
        uploadedAt: "2026-08-21T10:00:00.000Z",
        publication: { public: true, reason: "automatic" },
        ...ueber,
    };
}

function plaetze(ueber: Partial<MediaSubjectSlots> = {}): MediaSubjectSlots {
    return {
        subject: { kind: "place", id: GRATENFELS, name: "Gratenfels", active: true },
        coat: {
            state: "set",
            origin: "legacy",
            revision: 4,
            asset: asset(1, { title: "Wappen Gratenfels", uploadedBy: null }),
        },
        header: {
            gallery: { id: "e19e19e1-0000-4000-8000-0000000000ga", revision: 7, origin: "legacy" },
            items: [
                { asset: asset(2), position: 0, revision: 1 },
                {
                    asset: asset(3, { publication: { public: false, reason: "clearance_pending" } }),
                    position: 1,
                    revision: 1,
                },
                { asset: asset(4), position: 2, revision: 1 },
            ],
            max: 10,
            suppressed: false,
        },
        ...ueber,
    };
}

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const quittung = {
    operationId: "00000000-0000-4000-8000-000000000001",
    status: "applied",
    environment: "development",
    affected: [],
    derivedWork: [],
    warnings: [],
};

interface Server {
    plaetze: MediaSubjectSlots[];
    gesendet: { url: string; body: Record<string, unknown> }[];
    listen: number;
}

/** Der Stand der Plätze: der erste, bis eine Operation ging, danach der nächste. */
async function stubMedien(page: Page, server: Server): Promise<void> {
    await page.route("**/api/editor/status", (route) => route.fulfill(json({ mapEditing: "testwelt" })));
    await page.route(`**/api/editor/media/subjects/place/${GRATENFELS}`, (route) =>
        route.fulfill(json(server.plaetze[0])),
    );
    const schreiben = async (route: Route, request: Request): Promise<void> => {
        server.gesendet.push({
            url: new URL(request.url()).pathname,
            body: request.postDataJSON() as Record<string, unknown>,
        });
        if (server.plaetze.length > 1) server.plaetze.shift();
        await route.fulfill(json(quittung));
    };
    for (const url of [
        MEDIA_COAT_BIND_URL,
        MEDIA_COAT_NONE_URL,
        MEDIA_HEADER_SET_URL,
        MEDIA_HEADER_NONE_URL,
        MEDIA_GALLERY_BIND_URL,
    ])
        await page.route(`**${url}`, (route, request) => schreiben(route, request));
    page.on("request", (request) => {
        if (request.method() === "GET" && new URL(request.url()).pathname === "/api/editor/places") server.listen += 1;
    });
}

async function oeffneBilder(page: Page, rechte = RECHTE, liste?: EditorPlaceList): Promise<void> {
    await oeffneOrtseditor(page, { rechte, ...(liste ? { liste } : {}) });
    await zeile(page, "Gratenfels").click();
    await fenster(page).locator('[data-testid$="-reiter-bilder"]').click();
    await expect(fenster(page).locator('[data-testid$="-bilder-wappen"]')).toBeVisible();
}

test("🔴 Wappen: Bild mit Herkunft und Freigabe; ✕ fragt erst, dann EINE Operation „bewusst ohne“; Liste und Plätze laden neu", async ({
    page,
}) => {
    const server: Server = {
        plaetze: [plaetze(), plaetze({ coat: { state: "none", origin: "editor", revision: null, asset: null } })],
        gesendet: [],
        listen: 0,
    };
    await stubMedien(page, server);
    // Die Liste kennt das Wappen (E19): links in der Zeile.
    const mitWappen: EditorPlaceList = {
        ...LISTE,
        rows: LISTE.rows.map((row) => (row.key === GRATENFELS ? { ...row, coat: `/media/${SHA(1)}.webp` } : row)),
    };
    await oeffneBilder(page, RECHTE, mitWappen);
    await expect(zeile(page, "Gratenfels").locator('[data-testid$="-zeile-bild"] img')).toHaveAttribute(
        "src",
        `/media/${SHA(1)}.webp`,
    );

    const wappen = fenster(page).locator('[data-testid$="-bilder-wappen"]');
    await expect(wappen.locator('[data-testid$="-bilder-wappen-name"]')).toHaveText("Wappen Gratenfels");
    // Legacy kennt den Hochlader nicht: „unbekannt“, nie leer.
    await expect(wappen).toContainText("hochgeladen von unbekannt · 21.08.2026");
    await expect(wappen.locator('[data-testid$="-bilder-wappen-freigabe"]')).toHaveText("öffentlich");

    await wappen.locator('[data-testid$="-bilder-wappen-entfernen"]').click();
    const frage = wappen.locator('[data-testid$="-bilder-wappen-frage"]');
    await expect(frage).toContainText("Wappen von Gratenfels entfernen?");
    expect(server.gesendet).toEqual([]);
    const listenVorher = server.listen;
    await frage.getByRole("button", { name: "Wappen entfernen" }).click();

    await expect(wappen.locator('[data-testid$="-bilder-ohne-wappen"]')).toHaveText("bewusst ohne Wappen");
    expect(server.gesendet).toEqual([
        {
            url: MEDIA_COAT_NONE_URL,
            body: { operationId: expect.any(String), subject: { kind: "place", id: GRATENFELS }, baseRevision: 4 },
        },
    ]);
    // Danach liest die Ortsliste neu (und mit ihr das Infopanel).
    await expect.poll(() => server.listen).toBeGreaterThan(listenVorher);
});

test("🔴 WI-0219: hängt eine Galerie, stehen ihre Bilder nur als Vorschau; ✕ fragt, dann EINE Operation „Galerie lösen“", async ({
    page,
}) => {
    // Betreiber 2026-10-17: „er kann nicht mehr wie ein bild haben, EIN titelbild oder EINE Galerie“. Eine Galerie bearbeitet man in
    // der Medienverwaltung; der Ortseditor verweist dorthin.
    const ohne = plaetze({ header: { gallery: null, image: null, items: [], max: 10, suppressed: true } });
    const server: Server = { plaetze: [plaetze(), ohne], gesendet: [], listen: 0 };
    await stubMedien(page, server);
    await oeffneBilder(page);

    const titel = fenster(page).locator('[data-testid$="-bilder-titelbilder"]');
    const galerie = titel.locator('[data-testid$="-bilder-galerie"]');
    await expect(galerie.locator('[data-testid$="-bilder-galerie-name"]')).toHaveText("Galerie ohne Titel");
    await expect(galerie).toContainText("Galerie · 3 Bilder");
    await expect(galerie.locator('[data-testid$="-bilder-bild"]')).toHaveCount(3);
    // Keine Handgriffe mehr: Umsortieren und Entfernen je Bild gibt es am Ort nicht; kein Erklärtext im Reiter.
    await expect(titel.locator('[data-testid$="-bilder-links"]')).toHaveCount(0);
    await expect(fenster(page).locator("div.bilder")).not.toContainText("Wie hängt das");
    // 🔴 Die Knöpfe nach dem, was hängt (Editor-Orchestrierung 2026-10-17): Galerie zuerst, dann die Alternative, „Bearbeiten“ als
    // Knopf im selben Band, zuletzt Entfernen.
    await expect(titel.locator(".bilder__knoepfe button")).toHaveText([
        "⇄ Galerie ersetzen …",
        "⇄ Titelbild statt Galerie …",
        // Ein Knopf nur für das Backend trägt ein abstraktes Zeichen (docs/regeln/oberflaeche.md, Betreiber 2026-10-10).
        "⚙ In der Medienverwaltung bearbeiten",
        "✕ Galerie entfernen",
    ]);
    await expect(titel.locator('[data-testid$="-bilder-galerie-bearbeiten"]')).toHaveAttribute("type", "button");

    await titel.locator('[data-testid$="-bilder-titelbild-entfernen"]').click();
    const frage = titel.locator('[data-testid$="-bilder-titelbild-frage"]');
    await expect(frage).toContainText("Galerie von Gratenfels lösen?");
    expect(server.gesendet).toEqual([]);
    await frage.getByRole("button", { name: "Galerie lösen" }).click();
    await expect(titel.locator('[data-testid$="-bilder-keine"]')).toContainText("Kein eigenes Titelbild");
    expect(server.gesendet).toEqual([
        {
            url: MEDIA_HEADER_NONE_URL,
            body: { operationId: expect.any(String), placeId: GRATENFELS, galleryRevision: 7 },
        },
    ]);
});

test("Wappen ersetzen über die Auswahl der Medienverwaltung: Binden ist EINE Operation", async ({ page }) => {
    const server: Server = { plaetze: [plaetze(), plaetze()], gesendet: [], listen: 0 };
    await stubMedien(page, server);
    const neues: MamAssetSummary = {
        id: BILD(9),
        revision: 1,
        title: "Wappen Grafschaft Gratenfels",
        kind: "image",
        assetType: "coat",
        origin: "editor_upload",
        creationMethod: "drawing",
        technicalState: "ok",
        rightsBasis: "own_work",
        clearance: "cleared",
        usageCount: 0,
        sharedFileCount: 0,
        primaryUsage: null,
        preview: null,
        published: true,
        suspended: false,
        updatedAt: "2026-10-11T08:00:00.000Z",
        uploadedBy: PERSON,
    } as MamAssetSummary;
    await page.route(
        (url) => url.pathname === "/api/editor/media" && url.searchParams.has("type"),
        (route) => route.fulfill(json({ items: [neues], total: 1, limit: 50, offset: 0 })),
    );
    await oeffneBilder(page);

    await fenster(page).locator('[data-testid$="-bilder-wappen-waehlen"]').click();
    const auswahl = page.getByTestId("medien-auswahl-fenster");
    await expect(auswahl).toBeVisible();
    await auswahl.locator(`[data-testid="medien-auswahl-eintrag"][data-asset="${BILD(9)}"]`).click();
    await page.getByTestId("medien-auswahl-binden").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toEqual({
        url: MEDIA_COAT_BIND_URL,
        body: {
            operationId: expect.any(String),
            subject: { kind: "place", id: GRATENFELS },
            assetId: BILD(9),
            baseRevision: 4,
        },
    });
    await expect(auswahl).toBeHidden();
});

test("ohne `upload_media` steht alles lesend da: Bindungen sichtbar, keine Knöpfe", async ({ page }) => {
    const server: Server = { plaetze: [plaetze()], gesendet: [], listen: 0 };
    await stubMedien(page, server);
    await oeffneBilder(page, [
        "use_editor_menu",
        "edit_map_objects",
        "view_media_private",
        "edit_territories",
        "edit_landscapes",
    ]);
    await expect(fenster(page).locator('[data-testid$="-bilder-wappen-name"]')).toHaveText("Wappen Gratenfels");
    await expect(fenster(page).locator('[data-testid$="-bilder-bild"]')).toHaveCount(3);
    await expect(fenster(page).locator('[data-testid$="-bilder-wappen-waehlen"]')).toHaveCount(0);
    await expect(fenster(page).locator('[data-testid$="-bilder-titelbild-waehlen"]')).toHaveCount(0);
    await expect(fenster(page).locator('[data-testid$="-bilder-titelbild-entfernen"]')).toHaveCount(0);
});

/** Bilder in der Suche der Medienverwaltung, für die Auswahl eines Titel- oder Galeriebilds. */
function bild(n: number): MamAssetSummary {
    return {
        id: BILD(n),
        revision: 1,
        title: `Ansicht ${String(n)}`,
        kind: "image",
        assetType: "picture",
        origin: "editor_upload",
        creationMethod: "drawing",
        technicalState: "ok",
        rightsBasis: "own_work",
        clearance: "cleared",
        usageCount: 0,
        sharedFileCount: 0,
        primaryUsage: null,
        preview: null,
        published: true,
        suspended: false,
        updatedAt: "2026-10-16T08:00:00.000Z",
        uploadedBy: PERSON,
    } as MamAssetSummary;
}

async function stubBildwahl(page: Page, server: Server): Promise<void> {
    await stubMedien(page, server);
    await page.route(
        (url) => url.pathname === "/api/editor/media" && url.searchParams.has("type"),
        (route) => route.fulfill(json({ items: [bild(7), bild(8)], total: 2, limit: 50, offset: 0 })),
    );
}

/** Ein Ort mit einem Einzelbild als Titelbild (WI-0219). */
const mitBild = (): MediaSubjectSlots =>
    plaetze({
        header: {
            gallery: null,
            image: { asset: asset(5), revision: 3, origin: "editor" },
            items: [],
            max: 10,
            suppressed: false,
        },
    });

test("🔴 WI-0219: ein Einzelbild als Titelbild; „Titelbild hinzufügen“ ersetzt es über header.set, das Fenster schließt", async ({
    page,
}) => {
    const server: Server = { plaetze: [mitBild(), mitBild()], gesendet: [], listen: 0 };
    await stubBildwahl(page, server);
    await oeffneBilder(page);
    const titel = fenster(page).locator('[data-testid$="-bilder-titelbilder"]');
    await expect(titel.locator('[data-testid$="-bilder-titelbild-name"]')).toHaveText("Bild 5");
    await expect(titel.locator('[data-testid$="-bilder-titelbild-freigabe"]')).toHaveText("öffentlich");
    // Hängt ein Bild: „ersetzen“ für das Bild vorn, die Galerie als Alternative, dann Entfernen; kein „Bearbeiten“.
    await expect(titel.locator(".bilder__knoepfe button")).toHaveText([
        "⇄ Titelbild ersetzen …",
        "⇄ Galerie statt Titelbild …",
        "✕ Titelbild entfernen",
    ]);
    await expect(titel.locator('[data-testid$="-bilder-galerie"]')).toHaveCount(0);

    await titel.locator('[data-testid$="-bilder-titelbild-waehlen"]').click();
    const auswahl = page.getByTestId("medien-auswahl-fenster");
    await expect(auswahl).toContainText("Titelbild für Gratenfels");
    await auswahl.locator(`[data-testid="medien-auswahl-eintrag"][data-asset="${BILD(7)}"]`).click();
    await expect(page.getByTestId("medien-auswahl-binden")).toHaveText("Titelbild ersetzen");
    await expect(page.getByTestId("medien-auswahl-satz")).toContainText("bleibt in der Medienverwaltung");
    await page.getByTestId("medien-auswahl-binden").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toEqual({
        url: MEDIA_HEADER_SET_URL,
        body: { operationId: expect.any(String), placeId: GRATENFELS, assetId: BILD(7), baseRevision: 3 },
    });
    await expect(auswahl).toBeHidden();
});

test("an einem Ort ohne Titelbild: „✚ … hinzufügen“, kein ✕; das Bild geht mit dem gesehenen Zustand", async ({
    page,
}) => {
    const leer = plaetze({ header: { gallery: null, image: null, items: [], max: 10, suppressed: false } });
    const server: Server = { plaetze: [leer, leer], gesendet: [], listen: 0 };
    await stubBildwahl(page, server);
    await oeffneBilder(page);
    const titel = fenster(page).locator('[data-testid$="-bilder-titelbilder"]');
    await expect(titel.locator('[data-testid$="-bilder-keine"]')).toContainText("Kein eigenes Titelbild");
    await expect(titel.locator('[data-testid$="-bilder-titelbild-waehlen"]')).toHaveText("✚ Titelbild hinzufügen …");
    await expect(titel.locator('[data-testid$="-bilder-galerie-waehlen"]')).toHaveText("✚ Galerie hinzufügen …");
    await expect(titel.locator('[data-testid$="-bilder-titelbild-entfernen"]')).toHaveCount(0);
    await titel.locator('[data-testid$="-bilder-titelbild-waehlen"]').click();
    await page.locator(`[data-testid="medien-auswahl-eintrag"][data-asset="${BILD(8)}"]`).click();
    await expect(page.getByTestId("medien-auswahl-binden")).toHaveText("Als Titelbild setzen");
    await page.getByTestId("medien-auswahl-binden").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]?.body).toEqual({
        operationId: expect.any(String),
        placeId: GRATENFELS,
        assetId: BILD(8),
        baseState: "undecided",
    });
});

const HAFEN = "e19e19e1-0000-4000-8000-0000000000ga";
const TEMPEL = "e19e19e1-0000-4000-8000-0000000000g3";

function galerieZeile(id: string, title: string, places: { id: string; name: string }[]): MamGallerySummary {
    return {
        id,
        revision: 3,
        title,
        kind: "object_gallery",
        origin: "editor",
        publicationState: "published",
        items: 4,
        places,
        draft: places.length === 0,
        previews: [],
    };
}

test("🔴 WI-0219: „Galerie hinzufügen“ ersetzt, was hängt: die bisherige steht gesperrt da, gallery.bind mit replaceRevision", async ({
    page,
}) => {
    const server: Server = { plaetze: [plaetze(), plaetze()], gesendet: [], listen: 0 };
    await stubMedien(page, server);
    await page.route(
        (url) => url.pathname === MEDIA_EDITOR_GALLERY_URL,
        (route) =>
            route.fulfill(
                json({
                    items: [
                        galerieZeile(HAFEN, "Hafen", [{ id: GRATENFELS, name: "Gratenfels" }]),
                        galerieZeile(TEMPEL, "Tempel", []),
                    ],
                    total: 2,
                }),
            ),
    );
    await oeffneBilder(page);
    await fenster(page).locator('[data-testid$="-bilder-galerie-waehlen"]').click();
    const wahl = page.getByTestId("ortseditor-galerie-wahl");
    await expect(wahl).toBeVisible();
    await expect(wahl.locator(`[data-galerie="${HAFEN}"]`)).toContainText("hängt schon hier");
    await wahl.locator(`[data-galerie="${TEMPEL}"]`).click();
    await page.getByTestId("ortseditor-galerie-wahl-binden").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toEqual({
        url: MEDIA_GALLERY_BIND_URL,
        body: {
            operationId: expect.any(String),
            galleryId: TEMPEL,
            baseRevision: 3,
            placeId: GRATENFELS,
            replaceRevision: 7,
        },
    });
    await expect(wahl).toBeHidden();
});

/**
 * „Dieses Bild gibt es bereits!“ (Betreiber 2026-10-17, WI-0068): Im gemeinsamen Hochladen fragt das Formular nach der Dateiwahl,
 * ob das Original schon als Werk existiert. Im Ortseditor nimmt „Vorhandenes Bild verwenden“ das vorhandene über DIESELBE Bindung
 * wie nach dem Hochladen (am Wappen wie „Wappen ersetzen“); ein Upload geht nicht hinaus. Hängt das Werk schon an genau diesem
 * Platz, ist der Knopf gesperrt (Editor-Orchestrierung 2026-10-17). Die Antworten kommen aus dem Test; die Prüfung der Bytes auf dem
 * Server prüfen die Servertests (`media-duplikate.test.ts`).
 */
const PUNKT_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
);

function vorhandenesWappen(n: number): MamAssetSummary {
    return {
        id: BILD(n),
        revision: 2,
        title: `Wappen Nummer ${String(n)}`,
        kind: "image",
        assetType: "coat",
        origin: "legacy_import",
        creationMethod: "drawing",
        technicalState: "ok",
        rightsBasis: "fan_policy",
        clearance: "legacy_asserted",
        usageCount: 1,
        sharedFileCount: 0,
        fileGroup: null,
        primaryUsage: null,
        preview: null,
        published: true,
        suspended: false,
        updatedAt: "2026-10-11T08:00:00.000Z",
    } as MamAssetSummary;
}

async function waehleSchonVorhandeneDatei(page: Page, treffer: MamAssetSummary): Promise<{ hochgeladen: number }> {
    const zaehler = { hochgeladen: 0 };
    await page.route(
        (url) => url.pathname === "/api/editor/media" && url.searchParams.has("type"),
        (route) => route.fulfill(json({ items: [treffer], total: 1, limit: 50, offset: 0 })),
    );
    await page.route(
        (url) => url.pathname === "/api/editor/media",
        async (route) => {
            if (route.request().method() !== "POST") return route.fallback();
            zaehler.hochgeladen += 1;
            return route.abort();
        },
    );
    await page.route("**/api/editor/media/same-bytes/*", (route) =>
        route.fulfill(json({ hits: [treffer], suggested: treffer.id })),
    );
    await page.route(`**/api/editor/media/${treffer.id}/usage`, (route) =>
        route.fulfill(
            json({
                asset: { id: treffer.id, revision: treffer.revision },
                usages: [
                    {
                        via: "binding",
                        subject: {
                            kind: "place",
                            id: "e19e19e1-0000-4000-8000-0000000000b0",
                            name: "Rotenfels",
                            active: true,
                        },
                        role: "coat",
                        gallery: null,
                        origin: "legacy",
                        revision: 1,
                        override: {
                            state: "none",
                            decidedOn: null,
                            decidedBy: null,
                            reason: null,
                            operatorQuote: null,
                        },
                        publication: { public: true, reason: "automatic" },
                    },
                ],
                retired: 0,
                sameFile: [],
            }),
        ),
    );
    await oeffneBilder(page);
    await fenster(page).locator('[data-testid$="-bilder-wappen-waehlen"]').click();
    const auswahl = page.getByTestId("medien-auswahl-fenster");
    await expect(auswahl).toBeVisible();
    await auswahl.getByTestId("medien-auswahl-hochladen").click();
    await expect(page.getByTestId("medien-hochladen-fenster")).toBeVisible();
    await page
        .getByTestId("medien-hochladen-datei")
        .setInputFiles({ name: "schon-da.png", mimeType: "image/png", buffer: PUNKT_PNG });
    await expect(page.getByTestId("medien-duplikat-hinweis")).toContainText("Dieses Bild gibt es bereits!");
    return zaehler;
}

test("🔴 Duplikat: „Vorhandenes Bild verwenden“ bindet das vorhandene Wappen mit EINER Operation, kein Upload", async ({
    page,
}) => {
    const server: Server = { plaetze: [plaetze(), plaetze()], gesendet: [], listen: 0 };
    await stubMedien(page, server);
    const zaehler = await waehleSchonVorhandeneDatei(page, vorhandenesWappen(9));

    const hinweis = page.getByTestId("medien-duplikat");
    await expect(hinweis.getByTestId("medien-eintrag")).toHaveCount(1);
    // Die Verwendungen stehen als Verweise auf die Objekte da, nie nur als Zahl; ohne „Auf der Karte“ über dem Formular.
    await expect(hinweis.getByTestId("medien-verwendung-subjekt")).toHaveText("Rotenfels");
    await expect(hinweis.getByTestId("medien-auf-karte")).toHaveCount(0);
    await expect(page.getByTestId("medien-hochladen-senden")).toHaveCount(0);

    await page.getByTestId("medien-duplikat-verwenden").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toEqual({
        url: MEDIA_COAT_BIND_URL,
        body: {
            operationId: expect.any(String),
            subject: { kind: "place", id: GRATENFELS },
            assetId: BILD(9),
            baseRevision: 4,
        },
    });
    await expect(page.getByTestId("medien-hochladen-fenster")).toBeHidden();
    expect(zaehler.hochgeladen).toBe(0);
});

test("🔴 Duplikat: hängt das Werk schon an genau diesem Platz, ist „Vorhandenes Bild verwenden“ gesperrt", async ({
    page,
}) => {
    const server: Server = { plaetze: [plaetze()], gesendet: [], listen: 0 };
    await stubMedien(page, server);
    // BILD(1) ist das Wappen, das an Gratenfels schon hängt.
    const zaehler = await waehleSchonVorhandeneDatei(page, vorhandenesWappen(1));
    const knopf = page.getByTestId("medien-duplikat-verwenden");
    await expect(knopf).toBeVisible();
    await expect(knopf).toBeDisabled();
    await expect(page.getByTestId("medien-hochladen-fenster")).toContainText("Es hängt schon hier.");
    expect(server.gesendet).toHaveLength(0);
    expect(zaehler.hochgeladen).toBe(0);
});
