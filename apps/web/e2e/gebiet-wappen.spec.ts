import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import {
    MEDIA_COAT_BIND_URL,
    MEDIA_COAT_NONE_URL,
    type EditorTerritoryDetail,
    type EditorTerritoryHierarchy,
    type EditorTerritoryList,
    type MamAssetSummary,
    type MediaSlotAsset,
    type MediaSubjectSlots,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * DER Wappen-Kasten an den Herrschaftsgebieten (Editor-Orchestrierung 2026-10-19: „Ein gemeinsamer Wappen-Kasten aus dem Teil des
 * Ortseditors“, `medien-wappen-kasten.vue`): Das Wappen steht nicht nur da, es lässt sich setzen, ersetzen und entfernen, mit den Wörtern und
 * Zeichen des Ortseditors und jede Handlung als EINE Operation der Medienverwaltung mit dem Subjekt `territory`. Es steht im Reiter „Bilder“ (WI-0253,
 * Betreiber 2026-10-26: „Wappen gehören zu einem Bilder-Tab“, wie bei Orten), nicht mehr im Kasten „Wiki und Quellen“ der Eigenschaften.
 *
 * 🔴 Kein Test schreibt in die Datenbank der Entwicklung: Gebiete, Plätze, Suche und Operationen kommen aus Stubs; den Schreibweg am
 * Gebiet prüft `apps/server/test/media-plaetze-zustaende.test.ts` gegen die Testdatenbank.
 */
const ID = (n: number): string => `9a9a9a9a-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ALBENHUS = ID(1);
const ISENHAG = ID(2);
const BILD = (n: number): string => ID(0x100 + n);
const SHA = (n: number): string => String(n).repeat(64);
const PERSON = { id: ID(0xaa), displayName: "Rondrikan" };
const RECHTE = [
    "use_editor_menu",
    "edit_map_objects",
    "view_media_private",
    "upload_media",
    "edit_territories",
    "edit_landscapes",
];

const zeileVon = (id: string, name: string, order: number): EditorTerritoryList["rows"][number] => ({
    id,
    name,
    type: "Grafschaft",
    circle: "voll",
    area: true,
    minZoom: 0,
    maxZoom: 8,
    color: "#b2b065",
    order,
    bounds: [440, 490, 470, 520],
});
const LISTE: EditorTerritoryList = {
    yearBf: 1049,
    rows: [zeileVon(ALBENHUS, "Grafschaft Albenhus", 0), zeileVon(ISENHAG, "Grafschaft Isenhag", 1)],
};
const detailVon = (id: string, name: string, mitWappen: boolean): EditorTerritoryDetail => ({
    id,
    revision: 3,
    name,
    type: "Grafschaft",
    color: "#b2b065",
    opacity: 0.7,
    minZoom: 0,
    maxZoom: 8,
    order: 0,
    parents: [],
    children: [],
    details: {},
    areas: [{ id: ID(0x200 + (mitWappen ? 1 : 2)), bounds: [440, 490, 470, 520] }],
    claimedBy: [],
    claims: [],
    ...(mitWappen ? { hasCoat: true, coat: `/media/${SHA(1)}.webp` } : {}),
});
const HIERARCHIE: EditorTerritoryHierarchy = { yearBf: 1049, derivedMaxBand: 8, territories: [], areas: [] };

function asset(n: number, ueber: Partial<MediaSlotAsset> = {}): MediaSlotAsset {
    return {
        id: BILD(n),
        revision: 1,
        title: `Wappen ${String(n)}`,
        technicalState: "ok",
        clearance: "cleared",
        preview: { url: `/media/${SHA(n)}.webp`, width: 40, height: 48 },
        uploadedBy: PERSON,
        uploadedAt: "2026-08-21T10:00:00.000Z",
        publication: { public: true, reason: "automatic" },
        ...ueber,
    };
}
function platz(id: string, name: string, coat: MediaSubjectSlots["coat"]): MediaSubjectSlots {
    return { subject: { kind: "territory", id, name, active: true }, coat, header: null };
}
const MIT = (id: string, name: string, titel = "Wappen Albenhus"): MediaSubjectSlots =>
    platz(id, name, { state: "set", origin: "legacy", revision: 4, asset: asset(1, { title: titel }) });
const OHNE = (id: string, name: string): MediaSubjectSlots =>
    platz(id, name, { state: "undecided", origin: null, revision: null, asset: null });

const NEUES: MamAssetSummary = {
    id: BILD(9),
    revision: 1,
    title: "Wappen der Isenhager",
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
    updatedAt: "2026-10-19T08:00:00.000Z",
    uploadedBy: PERSON,
} as MamAssetSummary;

const json = (route: Route, body: unknown): Promise<void> =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

interface Server {
    /** Der Stand je Gebiet: der erste, bis eine Operation an ihm ging, danach der nächste. */
    plaetze: Map<string, MediaSubjectSlots[]>;
    gesendet: { url: string; body: Record<string, unknown> }[];
    /** Jeder Lesezugriff auf Liste und Detail der Gebiete (Pfad). */
    gelesen?: string[];
}

async function oeffne(page: Page, server: Server, rechte = RECHTE): Promise<void> {
    await stubAdmin(page, { capabilities: rechte, role: "editor" });
    await page.route("**/api/editor/status", (route) => json(route, { mapEditing: "testwelt" }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) =>
        route.request().method() === "GET" ? json(route, { locks: [] }) : json(route, { lost: [] }),
    );
    const gelesen = (route: Route): void => void server.gelesen?.push(new URL(route.request().url()).pathname);
    await page.route("**/api/editor/territories", (route) => {
        gelesen(route);
        return json(route, LISTE);
    });
    await page.route(`**/api/editor/territories/${ALBENHUS}`, (route) => {
        gelesen(route);
        return json(route, detailVon(ALBENHUS, "Grafschaft Albenhus", true));
    });
    await page.route(`**/api/editor/territories/${ISENHAG}`, (route) => {
        gelesen(route);
        return json(route, detailVon(ISENHAG, "Grafschaft Isenhag", false));
    });
    await page.route("**/api/editor/territories/*/hierarchy", (route) => json(route, HIERARCHIE));
    await page.route("**/api/editor/media/subjects/territory/*", (route) => {
        const id = new URL(route.request().url()).pathname.split("/").pop()!;
        return json(route, server.plaetze.get(id)![0]);
    });
    await page.route(
        (url) => url.pathname === "/api/editor/media" && url.searchParams.has("type"),
        (route) => json(route, { items: [NEUES], total: 1, limit: 50, offset: 0 }),
    );
    const schreiben = async (route: Route, request: Request): Promise<void> => {
        const body = request.postDataJSON() as Record<string, unknown>;
        server.gesendet.push({ url: new URL(request.url()).pathname, body });
        const stand = server.plaetze.get((body["subject"] as { id: string }).id)!;
        if (stand.length > 1) stand.shift();
        await json(route, {
            operationId: body["operationId"],
            status: "applied",
            environment: "development",
            affected: [],
            derivedWork: [],
            warnings: [],
        });
    };
    for (const url of [MEDIA_COAT_BIND_URL, MEDIA_COAT_NONE_URL])
        await page.route(`**${url}`, (route, request) => schreiben(route, request));

    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-territorien").click();
    const verb = page.getByTestId("editorpanel-verb");
    await expect(verb).toContainText("Herrschaftsgebiete bearbeiten");
    await verb.click();
}

const liste = (page: Page) => page.locator('[data-testid^="gebietseditor-"][data-testid$="-liste"]');
const kasten = (page: Page) => page.getByTestId(/^gebietseditor-fenster-\d+-bilder-wappen$/);

async function waehle(page: Page, name: string): Promise<void> {
    await liste(page).getByRole("searchbox").fill(name);
    await liste(page)
        .getByRole("option", { name: new RegExp(name) })
        .click();
    // Der Name steht als Eingabe da (B2, die Sitzung schreibt), nicht als Text.
    await expect(
        page
            .getByTestId(/^gebietseditor-fenster-\d+-feld-name$/)
            .filter({ visible: true })
            .locator("input"),
    ).toHaveValue(name);
    // Das Wappen steht im Reiter „Bilder“.
    await page.getByRole("tab", { name: "Bilder" }).click();
}

test("🔴 ohne Wappen: „✚ Wappen hinzufügen …“ bindet über die Auswahl der Medienverwaltung, EINE Operation am Gebiet", async ({
    page,
}) => {
    const server: Server = {
        plaetze: new Map([
            [
                ISENHAG,
                [OHNE(ISENHAG, "Grafschaft Isenhag"), MIT(ISENHAG, "Grafschaft Isenhag", "Wappen der Isenhager")],
            ],
            [ALBENHUS, [MIT(ALBENHUS, "Grafschaft Albenhus")]],
        ]),
        gesendet: [],
    };
    await oeffne(page, server);
    await waehle(page, "Grafschaft Isenhag");

    // Im Kasten des Reiters „Bilder“: der Satz zum leeren Platz, die Wörter und Zeichen des Ortseditors (der Verweis steht oben im Kopf).
    await expect(kasten(page).locator('[data-testid$="-bilder-ohne-wappen"]')).toHaveText("kein Wappen gebunden");
    await expect(kasten(page).getByRole("button")).toHaveText(["Medienverwaltung › Wappen", "✚ Wappen hinzufügen …"]);

    await kasten(page).locator('[data-testid$="-bilder-wappen-waehlen"]').click();
    const auswahl = page.getByTestId("medien-auswahl-fenster");
    await expect(auswahl).toBeVisible();
    await auswahl.locator(`[data-testid="medien-auswahl-eintrag"][data-asset="${BILD(9)}"]`).click();
    await page.getByTestId("medien-auswahl-binden").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toEqual({
        url: MEDIA_COAT_BIND_URL,
        body: {
            operationId: expect.any(String),
            subject: { kind: "territory", id: ISENHAG },
            assetId: BILD(9),
            baseState: "undecided",
        },
    });
    await expect(auswahl).toBeHidden();
    // Danach liest der Kasten seinen Platz neu: Jetzt hängt ein Wappen, der Knopf heißt „ersetzen“.
    await expect(kasten(page).locator('[data-testid$="-bilder-wappen-name"]')).toHaveText("Wappen der Isenhager");
    await expect(kasten(page).locator('[data-testid$="-bilder-wappen-waehlen"]')).toHaveText("⇄ Wappen ersetzen …");
});

test("🔴 nach dem Binden lesen Liste und Detail des Gebiets neu: das neue Wappen steht sofort überall (Editor-Orchestrierung 2026-10-19)", async ({
    page,
}) => {
    const server: Server = {
        plaetze: new Map([
            [
                ISENHAG,
                [OHNE(ISENHAG, "Grafschaft Isenhag"), MIT(ISENHAG, "Grafschaft Isenhag", "Wappen der Isenhager")],
            ],
            [ALBENHUS, [MIT(ALBENHUS, "Grafschaft Albenhus")]],
        ]),
        gesendet: [],
        gelesen: [],
    };
    await oeffne(page, server);
    await waehle(page, "Grafschaft Isenhag");
    const LISTE_PFAD = "/api/editor/territories";
    const DETAIL_PFAD = `/api/editor/territories/${ISENHAG}`;
    const zaehle = (pfad: string): number => server.gelesen!.filter((x) => x === pfad).length;
    await expect.poll(() => zaehle(DETAIL_PFAD)).toBeGreaterThan(0);
    const vorher = { liste: zaehle(LISTE_PFAD), detail: zaehle(DETAIL_PFAD) };

    await kasten(page).locator('[data-testid$="-bilder-wappen-waehlen"]').click();
    await page
        .getByTestId("medien-auswahl-fenster")
        .locator(`[data-testid="medien-auswahl-eintrag"][data-asset="${BILD(9)}"]`)
        .click();
    await page.getByTestId("medien-auswahl-binden").click();
    await expect.poll(() => server.gesendet.length).toBe(1);

    await expect.poll(() => zaehle(LISTE_PFAD), { message: "die Liste liest neu" }).toBeGreaterThan(vorher.liste);
    await expect.poll(() => zaehle(DETAIL_PFAD), { message: "das Detail liest neu" }).toBeGreaterThan(vorher.detail);
    await expect(kasten(page).locator('[data-testid$="-bilder-wappen-name"]')).toHaveText("Wappen der Isenhager");
});

test("🔴 mit Wappen: Bild mit Herkunft und Freigabe; „⇄ Wappen ersetzen …“ bindet mit dem gesehenen Stand", async ({
    page,
}) => {
    const server: Server = {
        plaetze: new Map([[ALBENHUS, [MIT(ALBENHUS, "Grafschaft Albenhus"), MIT(ALBENHUS, "Grafschaft Albenhus")]]]),
        gesendet: [],
    };
    await oeffne(page, server);
    await waehle(page, "Grafschaft Albenhus");

    await expect(kasten(page).locator('[data-testid$="-bilder-wappen-name"]')).toHaveText("Wappen Albenhus");
    await expect(kasten(page)).toContainText("hochgeladen von Rondrikan · 21.08.2026");
    await expect(kasten(page).locator('[data-testid$="-bilder-wappen-freigabe"]')).toHaveText("öffentlich");
    await expect(kasten(page).getByRole("button")).toHaveText([
        "Medienverwaltung › Wappen",
        "⇄ Wappen ersetzen …",
        "✕ Wappen entfernen",
    ]);

    await kasten(page).locator('[data-testid$="-bilder-wappen-waehlen"]').click();
    const auswahl = page.getByTestId("medien-auswahl-fenster");
    await auswahl.locator(`[data-testid="medien-auswahl-eintrag"][data-asset="${BILD(9)}"]`).click();
    await page.getByTestId("medien-auswahl-binden").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toEqual({
        url: MEDIA_COAT_BIND_URL,
        body: {
            operationId: expect.any(String),
            subject: { kind: "territory", id: ALBENHUS },
            assetId: BILD(9),
            baseRevision: 4,
        },
    });
});

test("🔴 „✕ Wappen entfernen“ fragt erst und nennt das Gebiet, dann EINE Operation „bewusst ohne“", async ({
    page,
}) => {
    const ohne = platz(ALBENHUS, "Grafschaft Albenhus", {
        state: "none",
        origin: "editor",
        revision: null,
        asset: null,
    });
    const server: Server = {
        plaetze: new Map([[ALBENHUS, [MIT(ALBENHUS, "Grafschaft Albenhus"), ohne]]]),
        gesendet: [],
    };
    await oeffne(page, server);
    await waehle(page, "Grafschaft Albenhus");

    await kasten(page).locator('[data-testid$="-bilder-wappen-entfernen"]').click();
    const frage = kasten(page).locator('[data-testid$="-bilder-wappen-frage"]');
    await expect(frage).toContainText("Wappen von Grafschaft Albenhus entfernen?");
    await expect(frage).toContainText("Das Gebiet steht danach bewusst ohne Wappen da");
    expect(server.gesendet, "erst fragen").toEqual([]);
    await frage.getByRole("button", { name: "Wappen entfernen" }).click();

    await expect(kasten(page).locator('[data-testid$="-bilder-ohne-wappen"]')).toHaveText("bewusst ohne Wappen");
    expect(server.gesendet).toEqual([
        {
            url: MEDIA_COAT_NONE_URL,
            body: { operationId: expect.any(String), subject: { kind: "territory", id: ALBENHUS }, baseRevision: 4 },
        },
    ]);
});

test("ohne `upload_media` steht das Wappen nur da: keine Knöpfe, der Verweis in die Medienverwaltung bleibt", async ({
    page,
}) => {
    const server: Server = { plaetze: new Map([[ALBENHUS, [MIT(ALBENHUS, "Grafschaft Albenhus")]]]), gesendet: [] };
    await oeffne(page, server, [
        "use_editor_menu",
        "edit_map_objects",
        "view_media_private",
        "edit_territories",
        "edit_landscapes",
    ]);
    await waehle(page, "Grafschaft Albenhus");

    await expect(kasten(page).locator('[data-testid$="-bilder-wappen-name"]')).toHaveText("Wappen Albenhus");
    await expect(kasten(page).getByRole("button")).toHaveText(["Medienverwaltung › Wappen"]);
});
