import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
    MAM_BASKETS,
    MAM_EINREICHUNGEN,
    MEDIA_ASSET_TYPES,
    PHOTOBOX_TERMS_VERSION,
    photoboxUnterteilung,
    type MamAssetSummary,
    type MamEinreichung,
    type MamNavigation,
    type MediaAssetDetail,
    type MediaUsageResult,
    type OperationReceipt,
    type PhotoboxSubmissionState,
    type PhotoboxSubmissionView,
} from "@avesmaps3d/shared";
import { clickMap } from "./map-handle.ts";
import { MIT_MEDIEN, stubSitzung } from "./medien-quelle.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";

/**
 * Reisebilder prüfen in der Medienverwaltung (WI-0272 S3, Aufgabe 18), am Rechner: der Korb „PhotoBox-Uploads“ mit seinen drei Reitern, der Inspector mit den
 * Kästen „Prüfen“, „Nach der Freigabe“ und „Angaben des Einsenders“, Freigeben, Rückfrage, Konflikt und „Offline nehmen“. Die Antworten des Servers sind hier
 * vorgegeben (keine Datenbank): Was der Server tut, prüfen `media-editor-routes.test.ts` und `photobox-redaktion.test.ts`; hier geht es darum, dass die
 * Oberfläche die richtige Revision der EINREICHUNG schickt, nur zeigt, was Recht und Zustand erlauben, und nach jeder Handlung neu liest.
 *
 * Aufnahmen des Inspectors für die Abnahme (offen, Rückfrage, freigegeben) legt der Lauf nur ab, wenn `E2E_AUFNAHMEN` einen Ordner nennt.
 */

const HIER = dirname(fileURLToPath(import.meta.url));
const VORSCHAU = readFileSync(join(HIER, "..", "public", "icons", "header", "gebaeude.webp"));
const AUFNAHMEN = process.env["E2E_AUFNAHMEN"];

const asset = (n: number): string => `6dcf1e76-4c1a-4b0e-9a6e-${String(n).padStart(12, "0")}`;
const einreichungId = (n: number): string => `0b9f4c1e-6f0a-4a63-9f2b-${String(n).padStart(12, "0")}`;
const ORT = "0b9f4c1e-6f0a-4a63-9f2b-0000000000f1";

interface Fall {
    asset: string;
    sub: PhotoboxSubmissionView;
}

const fall = (n: number, teil: Partial<PhotoboxSubmissionView>): Fall => ({
    asset: asset(n),
    sub: {
        publicId: einreichungId(n),
        revision: 3,
        zustand: "pending",
        eingereichtAm: "2026-11-01T10:00:00.000Z",
        beschreibung: `Reisebild ${String(n)}`,
        entstehung: "photo",
        nutzung: "avesmaps_only",
        lage: { x: 300 + n, y: 310 },
        bedingungen: PHOTOBOX_TERMS_VERSION,
        angepasst: false,
        ...teil,
    },
});

/** Vier Einreichungen: zwei offen (eine mit Ort ohne Ortsansicht), eine Rückfrage, eine freigegeben. */
const anfang = (): Fall[] => [
    fall(1, {
        beschreibung: "Pfad am Dorfrand",
        ort: { publicId: ORT, name: "Beispieldorf", typ: "dorf" },
        ortHatOrtsansicht: false,
        name: "Alrik Testmann",
        blickrichtung: 2,
    }),
    fall(2, { beschreibung: "Abend vor Rommilys", revision: 2, entstehung: "drawing" }),
    fall(3, {
        beschreibung: "Blick über Garetien",
        zustand: "changes_requested",
        revision: 5,
        nachricht: "Welcher Hafen ist das?",
        entstehung: "ai_generated",
    }),
    fall(4, { beschreibung: "Der Markt von Gareth", zustand: "approved", revision: 4 }),
];

const json = (route: Route, status: number, body: unknown): Promise<void> =>
    route.fulfill({
        status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(body),
    });

interface Server {
    faelle: Fall[];
    /** Was an die Operationen der Redaktion ging, mit der Aktion. */
    gesendet: { aktion: string; id: string; body: Record<string, unknown> }[];
    /** Die Anfragen der Liste (nur der Query-String). */
    listen: string[];
    konflikt: boolean;
    /** Wie oft ein Asset gelesen wurde (der erste Aufruf lädt, jeder weitere ist ein Nachladen). */
    detailLesen: number;
    /** Wie lange das Lesen eines Assets dauert, in Millisekunden. */
    verzoegerungMs: number;
}

function zeile(f: Fall): MamAssetSummary {
    const s = f.sub;
    return {
        id: f.asset,
        revision: 1,
        title: null,
        kind: "image",
        assetType: "picture",
        origin: "community_upload",
        creationMethod: "photo",
        technicalState: "ok",
        rightsBasis: "permission",
        clearance: "unreviewed",
        usageCount: s.zustand === "approved" ? 1 : 0,
        sharedFileCount: 0,
        fileGroup: null,
        primaryUsage: null,
        preview: null,
        privatePreview: { url: `/api/editor/media/${f.asset}/preview/intern_photobox_2048`, width: 64, height: 64 },
        published: false,
        suspended: false,
        updatedAt: "2026-11-01T10:00:00.000Z",
        submission: {
            zustand: s.zustand,
            unterteilung: photoboxUnterteilung(s.zustand, s.wartendeBeschreibung !== undefined),
            beschreibung: s.beschreibung,
            eingereichtAm: s.eingereichtAm,
            entstehung: s.entstehung,
            ortName: s.ort?.name ?? null,
        },
    };
}

function detail(f: Fall): MediaAssetDetail {
    return {
        asset: {
            id: f.asset,
            revision: 2,
            title: null,
            kind: "image",
            assetType: "picture",
            origin: "community_upload",
            creationMethod: "photo",
            technicalState: "ok",
            moderationState: f.sub.zustand === "approved" ? "approved" : "pending",
            degradedOriginal: false,
            sourceSystem: "photobox",
            sourceRef: null,
            createdAt: "2026-11-01T10:00:00.000Z",
            updatedAt: "2026-11-01T10:00:00.000Z",
            importedAt: null,
        },
        rights: null,
        creation: null,
        ingest: [],
        legacySource: null,
        representations: [
            {
                variant: "intern_photobox_2048",
                storageClass: "derivative",
                mimeType: "image/webp",
                width: 64,
                height: 64,
                byteSize: 2048,
                sha256: "a".repeat(64),
                recipe: null,
                recipeVersion: null,
                createdAt: "2026-11-01T10:00:00.000Z",
                url: null,
                privateUrl: `/api/editor/media/${f.asset}/preview/intern_photobox_2048`,
                storageKey: "derivatives/x",
            },
        ],
        suspensions: [],
        usageCount: f.sub.zustand === "approved" ? 1 : 0,
        retiredUsageCount: 0,
        sharedFileCount: 0,
        history: [],
        evidence: [],
        mergedHere: [],
        submission: f.sub,
    };
}

function verwendung(f: Fall): MediaUsageResult {
    return {
        asset: { id: f.asset, revision: 2 },
        usages:
            f.sub.zustand === "approved"
                ? [
                      {
                          via: "binding",
                          subject: null,
                          role: "photobox",
                          gallery: null,
                          override: {
                              state: "none",
                              decidedBy: null,
                              decidedAt: null,
                              reason: null,
                              operatorQuote: null,
                          },
                          publication: { public: false, reason: "permission_needs_approval" },
                      },
                  ]
                : [],
        retired: 0,
        sameFile: [],
    } as unknown as MediaUsageResult;
}

function navigation(faelle: readonly Fall[]): MamNavigation {
    const zaehle = (teil: MamEinreichung): number =>
        faelle.filter((f) => photoboxUnterteilung(f.sub.zustand, f.sub.wartendeBeschreibung !== undefined) === teil)
            .length;
    return {
        total: faelle.length,
        kinds: { image: faelle.length, model_3d: 0 },
        types: Object.fromEntries(MEDIA_ASSET_TYPES.map((typ) => [typ, 0])) as MamNavigation["types"],
        galleries: 0,
        citymaps: 0,
        photoboxGalerien: 0,
        typeImages: 0,
        baskets: Object.fromEntries(
            MAM_BASKETS.map((korb) => [korb, korb === "photobox_uploads" ? faelle.length : 0]),
        ) as MamNavigation["baskets"],
        einreichungen: { offen: zaehle("offen"), rueckfrage: zaehle("rueckfrage"), erledigt: zaehle("erledigt") },
    };
}

const naechster: Record<string, (s: PhotoboxSubmissionView, body: Record<string, unknown>) => PhotoboxSubmissionView> =
    {
        approve: (s) => ({ ...s, zustand: "approved" }),
        ask: (s, body) => ({ ...s, zustand: "changes_requested", nachricht: String(body["nachricht"]) }),
        reject: (s, body) => ({ ...s, zustand: "rejected", nachricht: String(body["grund"]) }),
        correct: (s, body) => ({
            ...s,
            angepasst: true,
            ...(typeof body["beschreibung"] === "string" ? { beschreibung: body["beschreibung"] } : {}),
        }),
        offline: (s) => ({ ...s, zustand: "offline" as PhotoboxSubmissionState }),
    };

/** Der Server der Medienverwaltung als Stand im Test: Die Operationen der Redaktion ändern die Einreichung, die Leserouten antworten danach. */
async function server(page: Page): Promise<Server> {
    const stand: Server = {
        faelle: anfang(),
        gesendet: [],
        listen: [],
        konflikt: false,
        detailLesen: 0,
        verzoegerungMs: 0,
    };
    await page.route("**/api/editor/**", async (route) => {
        const url = new URL(route.request().url());
        const pfad = url.pathname;
        if (pfad === "/api/editor/media/navigation") return json(route, 200, navigation(stand.faelle));
        if (pfad === "/api/editor/media" && route.request().method() === "GET") {
            stand.listen.push(url.search);
            const korb = url.searchParams.get("basket");
            const teil = url.searchParams.get("einreichung");
            const items = stand.faelle
                .map(zeile)
                .filter((z) => korb !== "photobox_uploads" || z.submission !== null)
                .filter((z) => teil === null || z.submission?.unterteilung === teil);
            return json(route, 200, { items, total: items.length, limit: 100, offset: 0 });
        }
        const vorschau = /^\/api\/editor\/media\/[0-9a-f-]{36}\/preview\/intern_photobox_2048$/u.exec(pfad);
        if (vorschau !== null) {
            return route.fulfill({ status: 200, contentType: "image/webp", body: VORSCHAU });
        }
        const lesen = /^\/api\/editor\/media\/([0-9a-f-]{36})(\/usage)?$/u.exec(pfad);
        if (lesen !== null) {
            const f = stand.faelle.find((kandidat) => kandidat.asset === lesen[1]);
            if (f === undefined)
                return json(route, 404, { error: { code: "not_found", message: "Dieses Medium gibt es nicht." } });
            if (lesen[2] === undefined) {
                stand.detailLesen += 1;
                if (stand.verzoegerungMs > 0) await new Promise((fertig) => setTimeout(fertig, stand.verzoegerungMs));
            }
            return json(route, 200, lesen[2] === undefined ? detail(f) : verwendung(f));
        }
        const tun = /^\/api\/editor\/media\/photobox\/([0-9a-f-]{36})\/(approve|ask|reject|correct|offline)$/u.exec(
            pfad,
        );
        if (tun !== null && route.request().method() === "POST") {
            const body = route.request().postDataJSON() as Record<string, unknown>;
            const aktion = tun[2]!;
            stand.gesendet.push({ aktion, id: tun[1]!, body });
            const f = stand.faelle.find((kandidat) => kandidat.sub.publicId === tun[1]);
            if (f === undefined)
                return json(route, 404, { error: { code: "not_found", message: "Dieses Reisebild gibt es nicht." } });
            if (stand.konflikt || body["baseRevision"] !== f.sub.revision) {
                return json(route, 409, {
                    error: {
                        code: "edit_conflict",
                        message: "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
                        details: {
                            currentRevision: f.sub.revision + 1,
                            changedAt: "2026-11-01T11:00:00.000Z",
                            changedBy: { id: "1b2c3d4e-0000-4000-8000-000000000001", displayName: "Thalionmel" },
                        },
                    },
                });
            }
            f.sub = { ...naechster[aktion]!(f.sub, body), revision: f.sub.revision + 1 };
            const quittung: OperationReceipt = {
                operationId: String(body["operationId"]),
                status: "applied",
                environment: "development",
                affected: [{ kind: "media_submission", id: f.sub.publicId, revision: f.sub.revision }],
                derivedWork: [],
                warnings: [],
            };
            return json(route, 200, quittung);
        }
        return json(route, 404, { error: { code: "not_found", message: "Diese Adresse gibt es nicht." } });
    });
    return stand;
}

async function oeffne(page: Page, faehigkeiten: readonly string[], adresse: string): Promise<void> {
    // Für die Aufnahmen: so hoch, dass der Inspector ohne Rollen ganz zu sehen ist.
    if (AUFNAHMEN !== undefined) await page.setViewportSize({ width: 1280, height: 2200 });
    await stubSitzung(page, faehigkeiten);
    await editorPanelGemerktZu(page);
    await page.goto(`/edit?${adresse}`);
    await expect(page.getByTestId("medien-fenster")).toBeVisible({ timeout: 30_000 });
}

const REVIEWER_RECHTE = [...MIT_MEDIEN, "moderate_submissions"];
const EDITOR_RECHTE = [...REVIEWER_RECHTE, "publish_media"];
const KORB = "medien&medien-korb=photobox_uploads";
const mitAsset = (n: number): string => `medien=${asset(n)}&medien-korb=photobox_uploads`;
const inspektor = (page: Page) => page.getByTestId("medien-spalte-inspektor");

async function aufnahme(page: Page, name: string): Promise<void> {
    if (AUFNAHMEN === undefined) return;
    await inspektor(page).screenshot({ path: resolve(AUFNAHMEN, `${name}.png`) });
}

test("🔴 der Korb zählt und filtert: drei Reiter mit Zahl, die Liste folgt dem Reiter, die Adresse merkt ihn", async ({
    page,
}) => {
    const stand = await server(page);
    await oeffne(page, REVIEWER_RECHTE, KORB);

    const reiter = page.getByTestId("medien-einreichung-reiter");
    await expect(reiter.getByRole("button", { name: "Offen 2" })).toBeVisible();
    await expect(reiter.getByRole("button", { name: "Rückfrage 1" })).toBeVisible();
    await expect(reiter.getByRole("button", { name: "Erledigt 1" })).toBeVisible();
    // Die Schiene nennt den Korb einmal, unter „Eingänge“, mit der Zahl der offenen Einreichungen.
    await expect(page.getByTestId("medien-arten").getByText("PhotoBox-Uploads")).toHaveCount(1);

    const zeilen = page.getByTestId("medien-eintrag");
    await expect(zeilen).toHaveCount(2);
    await expect(zeilen.filter({ hasText: "Pfad am Dorfrand" })).toContainText("in Beispieldorf");
    await expect(zeilen.filter({ hasText: "Abend vor Rommilys" })).toContainText("an freier Stelle");
    expect(stand.listen.at(-1)).toContain("einreichung=offen");

    await reiter.getByRole("button", { name: "Rückfrage 1" }).click();
    await expect(zeilen).toHaveCount(1);
    await expect(zeilen.first()).toContainText("Blick über Garetien");
    await expect(zeilen.first()).toContainText("Rückfrage");
    expect(stand.listen.at(-1)).toContain("einreichung=rueckfrage");
    await expect(page).toHaveURL(/medien-einreichung=rueckfrage/u);

    await reiter.getByRole("button", { name: "Erledigt 1" }).click();
    await expect(zeilen).toHaveCount(1);
    await expect(zeilen.first()).toContainText("Der Markt von Gareth");
    expect(stand.listen.at(-1)).toContain("einreichung=erledigt");
    expect([...MAM_EINREICHUNGEN]).toEqual(["offen", "rueckfrage", "erledigt"]);
});

test("🔴 der Inspector zeigt die drei Kästen bei einer Einreichung, Freigeben schickt die Revision der EINREICHUNG, danach stimmen Liste und Zahlen", async ({
    page,
}) => {
    const stand = await server(page);
    await oeffne(page, REVIEWER_RECHTE, mitAsset(1));

    const pruefen = page.getByTestId("medien-einreichung-pruefen");
    await expect(pruefen).toBeVisible();
    await expect(pruefen).toContainText("Datei geprüft und gerechnet");
    await expect(pruefen).toContainText("Keine erkennbaren Personen ohne Einverständnis");
    await expect(pruefen).toContainText("Passt zu Aventurien und zur Stelle");
    await expect(pruefen).toContainText(
        "Rückfrage und Ablehnung erreichen den Einsender nur über seinen persönlichen Link.",
    );
    await expect(page.getByTestId("medien-einreichung-folge")).toContainText(
        "Reiht sich im Kopf von Beispieldorf hinter das Typbild „Dorf“.",
    );
    await expect(page.getByTestId("medien-einreichung-vorher")).toBeVisible();
    await expect(page.getByTestId("medien-einreichung-folgt")).toHaveCount(0);
    const angaben = page.getByTestId("medien-einreichung-angaben");
    await expect(angaben).toContainText("Pfad am Dorfrand");
    await expect(angaben).toContainText("Alrik Testmann");
    await expect(angaben).toContainText("Osten");
    await expect(angaben).toContainText(PHOTOBOX_TERMS_VERSION);
    await expect(
        page.getByTestId("medien-einreichung-offline"),
        "ein Reviewer sieht kein „Offline nehmen“",
    ).toHaveCount(0);
    await aufnahme(page, "inspektor-offen");

    await page.getByTestId("medien-einreichung-freigeben").click();
    await expect(page.getByTestId("medien-einreichung-zustand")).toHaveText("Freigegeben");
    expect(stand.gesendet).toHaveLength(1);
    expect(stand.gesendet[0]).toMatchObject({ aktion: "approve", id: einreichungId(1), body: { baseRevision: 3 } });
    expect(stand.gesendet[0]!.body["operationId"]).toMatch(/^[0-9a-f-]{36}$/u);
    await expect(page.getByTestId("medien-einreichung-freigeben")).toHaveCount(0);
    await expect(page.getByTestId("medien-einreichung-veroeffentlichung")).toHaveText("wartet auf die Freigaberegel");
    await expect(page.getByTestId("medien-einreichung-offline"), "ohne `publish_media` bleibt es weg").toHaveCount(0);
    // Die Zahlen der Reiter haben neu gelesen: Aus „Offen 2“ ist „Offen 1“, „Erledigt“ zählt die Freigabe mit.
    const reiter = page.getByTestId("medien-einreichung-reiter");
    await expect(reiter.getByRole("button", { name: "Offen 1" })).toBeVisible();
    await expect(reiter.getByRole("button", { name: "Erledigt 2" })).toBeVisible();
    await aufnahme(page, "inspektor-freigegeben");
});

test("Rückfrage: ohne Text geht nichts hinaus, mit Text die Nachricht samt Revision; danach steht der Zustand da", async ({
    page,
}) => {
    const stand = await server(page);
    await oeffne(page, REVIEWER_RECHTE, mitAsset(2));

    await page.getByTestId("medien-einreichung-rueckfrage").click();
    await page.getByTestId("medien-einreichung-rueckfrage-senden").click();
    await expect(page.getByTestId("medien-einreichung-nachricht-fehler")).toHaveText("Ohne Text geht es nicht.");
    expect(stand.gesendet, "ohne Text geht nichts hinaus").toHaveLength(0);

    await page.getByTestId("medien-einreichung-rueckfrage-text").fill("Welcher Hafen ist das?");
    await page.getByTestId("medien-einreichung-rueckfrage-senden").click();
    await expect(page.getByTestId("medien-einreichung-zustand")).toHaveText("Rückfrage");
    expect(stand.gesendet).toHaveLength(1);
    expect(stand.gesendet[0]).toMatchObject({
        aktion: "ask",
        id: einreichungId(2),
        body: { baseRevision: 2, nachricht: "Welcher Hafen ist das?" },
    });
    await expect(page.getByTestId("medien-einreichung-angaben")).toContainText("Welcher Hafen ist das?");
    await aufnahme(page, "inspektor-rueckfrage");
});

test("🔴 ein Konflikt nennt die Person, die Eingaben bleiben stehen, „Neu laden“ ist da", async ({ page }) => {
    const stand = await server(page);
    await oeffne(page, REVIEWER_RECHTE, mitAsset(2));
    await page.getByTestId("medien-einreichung-ablehnen").click();
    await page.getByTestId("medien-einreichung-ablehnen-text").fill("Passt nicht nach Aventurien.");
    stand.konflikt = true;
    await page.getByTestId("medien-einreichung-ablehnen-senden").click();
    await expect(page.getByTestId("medien-einreichung-fehler")).toContainText("Thalionmel");
    await expect(page.getByTestId("medien-einreichung-neu-laden")).toBeVisible();
    await expect(page.getByTestId("medien-einreichung-ablehnen-text")).toHaveValue("Passt nicht nach Aventurien.");
    expect(stand.gesendet).toHaveLength(1);
    expect(stand.gesendet[0]).toMatchObject({
        aktion: "reject",
        body: { baseRevision: 2, grund: "Passt nicht nach Aventurien." },
    });
});

test("Korrigieren: nur Geändertes geht hinaus, nach der Freigabe nur die Beschreibung", async ({ page }) => {
    const stand = await server(page);
    await oeffne(page, REVIEWER_RECHTE, mitAsset(1));
    await page.getByTestId("medien-einreichung-korrigieren").click();
    await expect(
        page.getByTestId("medien-einreichung-korrigieren-senden"),
        "nichts geändert, nichts zu senden",
    ).toBeDisabled();
    await page.getByTestId("medien-einreichung-korrektur-text").fill("Der Pfad am Dorfrand");
    await page.getByTestId("medien-einreichung-chip-ort").getByRole("button").click();
    await page.getByTestId("medien-einreichung-korrigieren-senden").click();
    await expect(page.getByTestId("medien-einreichung-angaben")).toContainText("Der Pfad am Dorfrand");
    expect(stand.gesendet).toHaveLength(1);
    expect(stand.gesendet[0]).toMatchObject({
        aktion: "correct",
        body: { baseRevision: 3, beschreibung: "Der Pfad am Dorfrand", placeId: null },
    });
    expect(Object.keys(stand.gesendet[0]!.body).sort()).toEqual([
        "baseRevision",
        "beschreibung",
        "operationId",
        "placeId",
    ]);

    await page.goto(`/edit?${mitAsset(4)}`);
    await expect(page.getByTestId("medien-einreichung-zustand")).toHaveText("Freigegeben");
    await page.getByTestId("medien-einreichung-korrigieren").click();
    await expect(page.getByTestId("medien-einreichung-korrigieren-form")).toContainText(
        "Nach der Freigabe lässt sich nur die Beschreibung ändern.",
    );
    await expect(page.getByTestId("medien-einreichung-stelle-waehlen")).toHaveCount(0);
});

test("🔴 Rückfrage und Ablehnen teilen sich den Text: Beim Wechsel zwischen den beiden bleibt, was getippt ist (Review M6a)", async ({
    page,
}) => {
    await server(page);
    await oeffne(page, REVIEWER_RECHTE, mitAsset(2));
    await page.getByTestId("medien-einreichung-rueckfrage").click();
    await page.getByTestId("medien-einreichung-rueckfrage-text").fill("Welcher Hafen ist das?");
    await page.getByTestId("medien-einreichung-ablehnen").click();
    await expect(page.getByTestId("medien-einreichung-ablehnen-text")).toHaveValue("Welcher Hafen ist das?");
    await page.getByTestId("medien-einreichung-rueckfrage").click();
    await expect(page.getByTestId("medien-einreichung-rueckfrage-text")).toHaveValue("Welcher Hafen ist das?");
    // Abbrechen schließt das Formular; ein neues beginnt leer.
    await page.getByTestId("medien-einreichung-rueckfrage-abbrechen").click();
    await page.getByTestId("medien-einreichung-ablehnen").click();
    await expect(page.getByTestId("medien-einreichung-ablehnen-text")).toHaveValue("");
});

test("🔴 nach einer Operation bleiben die Knöpfe gesperrt, bis das Asset neu geladen ist: kein zweiter Klick mit der alten Revision (Review M6b)", async ({
    page,
}) => {
    const stand = await server(page);
    await oeffne(page, REVIEWER_RECHTE, mitAsset(2));
    await expect(page.getByTestId("medien-einreichung-zustand")).toHaveText("In Prüfung");
    // Das Nachladen dauert; solange steht noch der alte Stand mit der alten Revision da.
    stand.verzoegerungMs = 1500;
    const gelesenVorher = stand.detailLesen;
    await page.getByTestId("medien-einreichung-freigeben").click();
    await expect.poll(() => stand.detailLesen).toBeGreaterThan(gelesenVorher);
    await expect(page.getByTestId("medien-einreichung-ablehnen")).toBeDisabled();
    await expect(page.getByTestId("medien-einreichung-freigeben")).toBeDisabled();
    expect(stand.gesendet, "genau eine Operation, keine zweite mit alter Revision").toHaveLength(1);
    // Ist der neue Stand da, geht es weiter: freigegeben.
    await expect(page.getByTestId("medien-einreichung-zustand")).toHaveText("Freigegeben", { timeout: 15_000 });
    expect(stand.gesendet).toHaveLength(1);
    await expect(page.getByTestId("medien-einreichung-korrigieren")).toBeEnabled();
});

test("🔴 „Neu laden“ nach einem Konflikt schließt ein Formular, das der neue Zustand nicht mehr erlaubt (Review M6c)", async ({
    page,
}) => {
    const stand = await server(page);
    await oeffne(page, REVIEWER_RECHTE, mitAsset(2));
    await page.getByTestId("medien-einreichung-ablehnen").click();
    await page.getByTestId("medien-einreichung-ablehnen-text").fill("Passt nicht.");
    // Eine andere Person gibt das Bild frei, bevor gesendet wird.
    const f = stand.faelle[1]!;
    f.sub = { ...f.sub, zustand: "approved", revision: f.sub.revision + 1 };
    await page.getByTestId("medien-einreichung-ablehnen-senden").click();
    await expect(page.getByTestId("medien-einreichung-fehler")).toContainText("Thalionmel");
    await page.getByTestId("medien-einreichung-neu-laden").click();
    await expect(page.getByTestId("medien-einreichung-zustand")).toHaveText("Freigegeben");
    await expect(page.getByTestId("medien-einreichung-ablehnen-form")).toHaveCount(0);
    await expect(page.getByTestId("medien-einreichung-fehler")).toHaveCount(0);
});

test("🔴 ein Konflikt beim „Offline nehmen“ bietet „Neu laden“ gleich dort an, auch mit nur `publish_media` (Review M6d)", async ({
    page,
}) => {
    const stand = await server(page);
    // Nur das Recht, offline zu nehmen: Der Kasten „Prüfen“ ist für diese Person nur ein Satz.
    await oeffne(page, [...MIT_MEDIEN, "publish_media"], mitAsset(4));
    await expect(page.getByTestId("medien-einreichung-kein-recht")).toBeVisible();
    await page.getByTestId("medien-einreichung-offline").click();
    stand.konflikt = true;
    await page.getByTestId("medien-einreichung-offline-senden").click();
    await expect(page.getByTestId("medien-einreichung-offline-fehler")).toContainText("Thalionmel");
    await expect(page.getByTestId("medien-einreichung-offline-neu-laden")).toBeVisible();
    stand.konflikt = false;
    await page.getByTestId("medien-einreichung-offline-neu-laden").click();
    await expect(page.getByTestId("medien-einreichung-offline-fehler")).toHaveCount(0);
});

test("ein Konflikt beim „Offline nehmen“ steht nur im Kasten „Nach der Freigabe“, auch wenn die Person beide Rechte hat (Review M6d)", async ({
    page,
}) => {
    const stand = await server(page);
    await oeffne(page, EDITOR_RECHTE, mitAsset(4));
    await page.getByTestId("medien-einreichung-offline").click();
    stand.konflikt = true;
    await page.getByTestId("medien-einreichung-offline-senden").click();
    await expect(page.getByTestId("medien-einreichung-offline-fehler")).toBeVisible();
    await expect(page.getByTestId("medien-einreichung-fehler"), "nicht doppelt im Kasten Prüfen").toHaveCount(0);
    await expect(page.getByTestId("medien-einreichung-neu-laden")).toHaveCount(0);
    await expect(page.getByTestId("medien-einreichung-offline-neu-laden")).toHaveCount(1);
});

test("🔴 Typbild im Satz „Ersetzt im Kopf …“ in der Sprache der Oberfläche; das ✕ im Chip ist ein Ziel für den Finger (Review M8)", async ({
    page,
}) => {
    await server(page);
    await page.addInitScript(() => {
        localStorage.setItem("avesmaps-lang", "en");
    });
    await oeffne(page, REVIEWER_RECHTE, mitAsset(1));
    await expect(page.getByTestId("medien-einreichung-wirkung")).toHaveText(
        "Replaces the type image “Village” in the header of Beispieldorf.",
    );
    await page.getByTestId("medien-einreichung-korrigieren").click();
    const kreuz = page.getByTestId("medien-einreichung-chip-ort").getByRole("button");
    const kasten = (await kreuz.boundingBox())!;
    expect(kasten.width).toBeGreaterThanOrEqual(23.5);
    expect(kasten.height).toBeGreaterThanOrEqual(23.5);
    // Der Chip wächst dadurch nicht.
    const chip = (await page.getByTestId("medien-einreichung-chip-ort").boundingBox())!;
    expect(chip.height).toBeLessThan(kasten.height + 12);
});

test("🔴 „Offline nehmen“ nur mit `publish_media`: der Editor sieht es und bestätigt, der Reviewer nicht", async ({
    page,
}) => {
    const stand = await server(page);
    await oeffne(page, EDITOR_RECHTE, mitAsset(4));
    await expect(page.getByTestId("medien-einreichung-zustand")).toHaveText("Freigegeben");
    await page.getByTestId("medien-einreichung-offline").click();
    await expect(page.getByTestId("medien-einreichung-offline-frage")).toContainText("nicht rückgängig");
    expect(stand.gesendet, "erst die Bestätigung").toHaveLength(0);
    await page.getByTestId("medien-einreichung-offline-senden").click();
    await expect(page.getByTestId("medien-einreichung-angaben")).toBeVisible();
    await expect(page.getByTestId("medien-einreichung-pruefen"), "offline genommen: nichts mehr zu prüfen").toHaveCount(
        0,
    );
    expect(stand.gesendet).toHaveLength(1);
    expect(stand.gesendet[0]).toMatchObject({ aktion: "offline", id: einreichungId(4), body: { baseRevision: 4 } });
});

test("🔴 ein Reviewer ohne `publish_media` sieht an einer freigegebenen Einreichung kein „Offline nehmen“", async ({
    page,
}) => {
    await server(page);
    await oeffne(page, REVIEWER_RECHTE, mitAsset(4));
    await expect(page.getByTestId("medien-einreichung-zustand")).toHaveText("Freigegeben");
    await expect(page.getByTestId("medien-einreichung-offline")).toHaveCount(0);
    await expect(page.getByTestId("medien-einreichung-korrigieren")).toBeVisible();
});

test("ohne `moderate_submissions` stehen die Angaben da, aber kein Knopf des Prüfens", async ({ page }) => {
    await server(page);
    await oeffne(page, MIT_MEDIEN, mitAsset(1));
    await expect(page.getByTestId("medien-einreichung-kein-recht")).toBeVisible();
    await expect(page.getByTestId("medien-einreichung-angaben")).toContainText("Pfad am Dorfrand");
    for (const knopf of ["freigeben", "rueckfrage", "ablehnen", "korrigieren"]) {
        await expect(page.getByTestId(`medien-einreichung-${knopf}`), knopf).toHaveCount(0);
    }
});

test("🔴 Stelle auf der Karte wählen: Die Medienverwaltung geht zu, Esc bricht ab, ein Klick bringt die Stelle in die Korrektur, und der Entwurf geht in beiden Fällen nicht verloren", async ({
    page,
}) => {
    const stand = await server(page);
    await oeffne(page, REVIEWER_RECHTE, mitAsset(1));
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });

    // Die Reihenfolge der Felder ist „Beschreibung, dann Stelle“: Was bis hierher getippt ist, darf der Weg zur Karte nicht kosten (Review S3 I2).
    await page.getByTestId("medien-einreichung-korrigieren").click();
    await page.getByTestId("medien-einreichung-korrektur-text").fill("Neu gefasst am Markt");
    await page.getByTestId("medien-einreichung-chip-ort").getByRole("button").click();
    await page.getByTestId("medien-einreichung-suche").locator("input").fill("Gar");
    await page.getByTestId("medien-einreichung-stelle-waehlen").click();
    await expect(page.getByTestId("medien-fenster"), "die Karte ist frei").toBeHidden();
    await expect(page.getByTestId("medien-stelle-hinweis")).toBeVisible();
    // Esc bricht ab: Die Medienverwaltung ist wieder da, beim selben Asset, ohne neue Stelle, und die Korrektur steht noch offen mit ihrem Entwurf.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("medien-stelle-hinweis")).toHaveCount(0);
    await expect(page.getByTestId("medien-fenster")).toBeVisible();
    await expect(page.getByTestId("medien-einreichung-pruefen")).toBeVisible();
    await expect(page.getByTestId("medien-einreichung-korrektur-text")).toHaveValue("Neu gefasst am Markt");
    await expect(page.getByTestId("medien-einreichung-chip-ort"), "der entfernte Ort bleibt entfernt").toHaveCount(0);
    await expect(page.getByTestId("medien-einreichung-suche").locator("input")).toHaveValue("Gar");
    await expect(page.getByTestId("medien-einreichung-korrektur-stelle")).not.toContainText("neu:");

    // Noch einmal, diesmal mit einem Klick auf die Karte: Die Korrektur steht gleich offen mit der neuen Stelle UND dem Entwurf.
    await page.getByTestId("medien-einreichung-stelle-waehlen").click();
    await expect(page.getByTestId("medien-stelle-hinweis")).toBeVisible();
    const mitte = await page.evaluate(() => {
        const leinwand = globalThis.avesmapsMap!.getCanvas();
        return { x: leinwand.clientWidth / 2, y: leinwand.clientHeight / 2 };
    });
    await clickMap(page, mitte);
    await expect(page.getByTestId("medien-stelle-hinweis")).toHaveCount(0);
    await expect(page.getByTestId("medien-fenster")).toBeVisible();
    await expect(page.getByTestId("medien-einreichung-korrektur-stelle")).toContainText("neu:");
    await expect(page.getByTestId("medien-einreichung-korrektur-text")).toHaveValue("Neu gefasst am Markt");
    await expect(page.getByTestId("medien-einreichung-chip-ort")).toHaveCount(0);
    expect(stand.gesendet, "gewählt ist nicht gespeichert").toHaveLength(0);

    await page.getByTestId("medien-einreichung-korrigieren-senden").click();
    await expect(page.getByTestId("medien-einreichung-angaben")).toContainText("Pfad am Dorfrand");
    expect(stand.gesendet).toHaveLength(1);
    expect(stand.gesendet[0]).toMatchObject({
        aktion: "correct",
        body: { baseRevision: 3, beschreibung: "Neu gefasst am Markt", placeId: null },
    });
    const lage = stand.gesendet[0]!.body["lage"] as { x: number; y: number };
    expect(Number.isFinite(lage.x) && Number.isFinite(lage.y), "eine Stelle der Karte").toBe(true);
});

test("ein Asset ohne Einreichung bleibt der gewöhnliche Inspector", async ({ page }) => {
    const stand = await server(page);
    // Ein Asset, das keine Einreichung ist: dieselbe Antwort ohne das Feld.
    const f = stand.faelle[0]!;
    await page.route(`**/api/editor/media/${f.asset}`, (route) => {
        const d = detail(f);
        delete d.submission;
        return json(route, 200, d);
    });
    await oeffne(page, REVIEWER_RECHTE, mitAsset(1));
    await expect(inspektor(page).getByTestId("medien-handlungen")).toBeVisible();
    await expect(page.getByTestId("medien-einreichung")).toHaveCount(0);
});
