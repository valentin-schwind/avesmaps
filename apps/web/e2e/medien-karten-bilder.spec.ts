import { expect, test, type Page, type Route } from "@playwright/test";
import {
    MAM_BASKETS,
    MEDIA_ASSET_TYPES,
    type InhalteQuellenZeile,
    type MamAssetSummary,
    type MamKarteAnlegenBody,
    type MamKarteBild,
    type MamKarteBildBody,
    type MamKarteBildLoesenBody,
    type MamKarteDetail,
    type MamKarteLinksBody,
    type MamKarteOrteBody,
    type MamKartenListe,
    type MamKartePublikation,
    type MamKarteQuellenBody,
    type MamKarteVersionBody,
    type MamKarteVorschauBody,
    type MamKarteZusammenlegenBody,
    type MamNavigation,
} from "@avesmaps3d/shared";
import { MIT_MEDIEN, stubSitzung } from "./medien-quelle.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";

/**
 * Neuer Eintrag der Kartensammlung und die Plätze „Die Karte“ und „Die Vorschau“ (WI-0287 Stufe 1, Punkt 2), am Rechner. Die Antworten des Servers sind vorgegeben (keine Datenbank):
 * Was der Server tut, prüfen `media-karte-bilder.test.ts` und `media-kartensammlung.test.ts`; hier geht es darum, dass die Oberfläche genau das schickt, was gewollt ist (Rolle, gesehene
 * Revision, Kennung des Werks), dass der Name Pflicht ist, dass das Zuweisen und Lösen den Platz umstellt und dass das Hochladefenster den Namen vorbelegt und einen gleichen Namen anzeigt.
 * Seit Stufe 2 hat die Karte Versionen: Der gestellte Server hängt eine Karte an (statt zu ersetzen) und kennt Bezeichnung und Reihenfolge (`…/version`).
 */

const KARTE = "7e570000-0000-4000-8000-000000000071";
const NEU = "7e570000-0000-4000-8000-000000000072";
const WERK = "7e570000-0000-4000-8000-0000000000a1";
const GLEICHNAMIG = "7e570000-0000-4000-8000-0000000000a2";
const HOCHGELADEN = "7e570000-0000-4000-8000-0000000000a3";
const ERZEUGT = "7e570000-0000-4000-8000-0000000000a4";

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

const detail = (id: string, titel: string, images: MamKarteBild[] = []): MamKarteDetail => ({
    id,
    revision: 3,
    title: titel,
    art: null,
    colorMode: null,
    isMultilevel: null,
    isLabeled: null,
    isOfficial: null,
    isSpoiler: null,
    hasScale: null,
    widthPx: null,
    heightPx: null,
    format: null,
    validFromBf: null,
    validToBf: null,
    author: "Zeichnerin Elwe",
    publisher: null,
    note: null,
    legacyWikiKey: null,
    legacyOrigin: "manual",
    state: "active",
    active: true,
    importedAt: null,
    editorHeld: true,
    parent: null,
    related: [],
    types: [],
    places: [],
    links: [{ role: "primary", url: "https://example.test/karte", label: "Im Shop", isPaid: true }],
    sources: [],
    wiki: null,
    images,
});

const werk = (id: string, titel: string): MamAssetSummary =>
    ({
        id,
        revision: 1,
        title: titel,
        kind: "image",
        assetType: "map",
        origin: "editor_upload",
        creationMethod: "drawing",
        technicalState: "ok",
        rightsBasis: "permission",
        clearance: "cleared",
        usageCount: 2,
        sharedFileCount: 0,
        fileGroup: null,
        primaryUsage: null,
        preview: null,
        published: false,
        suspended: false,
        updatedAt: "2026-11-07T08:00:00.000Z",
    }) as MamAssetSummary;

const bild = (role: "map_full" | "map_preview", assetId: string, titel: string): MamKarteBild => ({
    role,
    assetId,
    title: titel,
    origin: "editor",
    override: "none",
    publication: { public: false, reason: "rights_unknown" },
    preview: null,
    privatePreview: null,
});

/** Wie der Server (WI-0287 Stufe 2): die Vorschau zuerst, dann die Versionen der Karte in ihrer Folge, je mit ihrer Stelle. */
const nummeriert = (bilder: MamKarteBild[]): MamKarteBild[] => [
    ...bilder.filter((eintrag) => eintrag.role === "map_preview"),
    ...bilder
        .filter((eintrag) => eintrag.role === "map_full")
        .map((eintrag, stelle) => ({
            ...eintrag,
            versionLabel: eintrag.versionLabel ?? null,
            versionPosition: stelle,
        })),
];

const json = (route: Route, status: number, body: unknown): Promise<void> =>
    route.fulfill({
        status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(body),
    });

const quittung = (operationId: string, id: string, revision: number) => ({
    operationId,
    status: "applied",
    environment: "development",
    affected: [{ kind: "citymap", id, revision }],
    derivedWork: [],
    warnings: [],
});

interface Gesendet {
    anlegen: MamKarteAnlegenBody[];
    zuweisen: MamKarteBildBody[];
    loesen: MamKarteBildLoesenBody[];
    links: MamKarteLinksBody[];
    suchen: string[];
    /** Die Rümpfe der Kartendateien (`PUT …/citymaps/datei`) mit dem Inhaltstyp. */
    dateien: { rumpf: Buffer; typ: string }[];
    /** Die Handlungen an den Publikationen (`POST …/citymaps/:id/sources`, WI-0287 Punkt 4) und die Suchen im Quellenverzeichnis. */
    quellen: MamKarteQuellenBody[];
    quellenSuchen: string[];
    /** „Vorschau erzeugen“ (`POST …/citymaps/:id/preview`, WI-0287 Punkt 5). */
    vorschau: MamKarteVorschauBody[];
    /** Bezeichnung und Reihenfolge einer Version (`POST …/citymaps/:id/version`, WI-0287 Stufe 2). */
    versionen: MamKarteVersionBody[];
    /** Die Handlungen an den Orten und Regionen (`POST …/citymaps/:id/places`, WI-0287 Stufe 3) und die Suchen der Karte (`/api/search`). */
    orte: MamKarteOrteBody[];
    ortSuchen: string[];
}

/** Orte und Regionen des Tests (WI-0287 Stufe 3): was die Suche der Karte liefert und der Server bindet. */
const PORTO = "7e570000-0000-4000-8000-0000000000c1";
const KUESTE = "7e570000-0000-4000-8000-0000000000c2";
const KUESTE_LABEL = "7e570000-0000-4000-8000-0000000000c3";
const ALBERNIA = "7e570000-0000-4000-8000-0000000000c4";
const PFALZ = "7e570000-0000-4000-8000-0000000000c5";
const FREIES_LABEL = "7e570000-0000-4000-8000-0000000000c9";
const ZIELE: Record<string, { kind: "place" | "region"; name: string; type: string }> = {
    [PORTO]: { kind: "place", name: "Porto Paligan", type: "stadt" },
    [KUESTE]: { kind: "region", name: "Siebenwind-Küste", type: "kueste" },
    [ALBERNIA]: { kind: "region", name: "Albernia", type: "region" },
    [PFALZ]: { kind: "place", name: "Pfalz Siebenwind", type: "dorf" },
};
const TREFFER = [
    { kind: "ort", id: PORTO, name: "Porto Paligan", subtype: "stadt", x: 1, y: 1, zoom: 5 },
    {
        kind: "landschaft",
        id: KUESTE_LABEL,
        name: "Siebenwind-Küste",
        subtype: "kueste",
        x: 2,
        y: 2,
        zoom: 4,
        region: KUESTE,
    },
    { kind: "ort", id: PFALZ, name: "Pfalz Siebenwind", subtype: "dorf", x: 3, y: 3, zoom: 5 },
    { kind: "landschaft", id: ALBERNIA, name: "Albernia", subtype: "region", x: 4, y: 4, zoom: 4, region: ALBERNIA },
    // Ein freies Label ohne Region ist kein Ziel.
    { kind: "landschaft", id: FREIES_LABEL, name: "Siebenwind frei", x: 5, y: 5, zoom: 4 },
];
const flach = (text: string): string => text.toLocaleLowerCase("de").replace(/[^\p{L}\p{N}]/gu, "");

/** Die Publikationen und das Quellenverzeichnis des Tests (WI-0287 Punkt 4). */
const UMSCHLAG = { url: `/media/sha256/ab/cd/${"ab".repeat(32)}.webp`, width: 60, height: 80, oeffentlich: true };
const HORAS = "7e570000-0000-4000-8000-0000000000b1";
const HEFT = "7e570000-0000-4000-8000-0000000000b2";
const GEOGRAPHIA = "7e570000-0000-4000-8000-0000000000b3";
const LANDKARTEN = "7e570000-0000-4000-8000-0000000000b4";
const publikation = (
    sourceId: string,
    title: string,
    mit: boolean,
    pages: string | null = null,
): MamKartePublikation => ({
    sourceId,
    title,
    sourceType: "regionalspielhilfe",
    offiziell: true,
    url: null,
    pages,
    state: "active",
    umschlag: mit ? UMSCHLAG : null,
});
const VERZEICHNIS: InhalteQuellenZeile[] = [
    {
        id: HORAS,
        title: "Reich des Horas",
        sourceType: "regionalspielhilfe",
        uses: 3,
        herkunft: "legacy",
        stillgelegt: false,
        umschlag: UMSCHLAG,
    },
    {
        id: HEFT,
        title: "Horasischer Almanach",
        sourceType: "sonstiges",
        uses: 0,
        herkunft: "editor",
        stillgelegt: false,
        umschlag: null,
    },
];

/** Der Server der Medienverwaltung als Stand im Test. */
async function server(
    page: Page,
    gleichnamig = false,
    publikationen?: MamKartePublikation[],
    mitKarte = false,
    orte?: MamKarteDetail["places"],
): Promise<Gesendet> {
    let karte: MamKarteDetail = {
        ...detail(
            KARTE,
            "Stadtplan von Gareth",
            nummeriert(mitKarte ? [{ ...bild("map_full", WERK, "Porto Paligan"), vorschauSperre: null }] : []),
        ),
        ...(publikationen === undefined ? {} : { publications: publikationen }),
        ...(orte === undefined ? {} : { places: orte }),
    };
    let neu: MamKarteDetail | undefined;
    const gesendet: Gesendet = {
        anlegen: [],
        zuweisen: [],
        loesen: [],
        links: [],
        suchen: [],
        dateien: [],
        quellen: [],
        quellenSuchen: [],
        vorschau: [],
        versionen: [],
        orte: [],
        ortSuchen: [],
    };
    // Die Suche der Karte (WI-0287 Stufe 3): Orte und Landschaften, nach dem Namen ohne Satzzeichen.
    await page.route("**/api/search?**", async (route) => {
        const q = new URL(route.request().url()).searchParams.get("q") ?? "";
        gesendet.ortSuchen.push(q);
        const hits = TREFFER.filter((hit) => flach(hit.name).includes(flach(q)));
        return json(route, 200, { query: q, hits, truncated: false });
    });
    const liste = (): MamKartenListe => ({
        items: [karte, ...(neu === undefined ? [] : [neu])].map((eintrag) => ({
            id: eintrag.id,
            title: eintrag.title,
            art: eintrag.art,
            types: eintrag.types,
            validFromBf: eintrag.validFromBf,
            validToBf: eintrag.validToBf,
            places: 0,
            images: eintrag.images.length,
            publicImages: 0,
            versions: eintrag.images.filter((bild) => bild.role === "map_full").length,
            state: eintrag.state,
            active: eintrag.active,
            preview: null,
            privatePreview: null,
        })),
        total: neu === undefined ? 1 : 2,
        retiredTotal: 0,
    });
    await page.route("**/api/editor/**", async (route) => {
        const url = new URL(route.request().url());
        const pfad = url.pathname;
        const methode = route.request().method();
        if (pfad === "/api/editor/media/navigation") return json(route, 200, navigation());
        if (pfad === "/api/editor/media/licenses") {
            return json(route, 200, {
                licenses: [
                    {
                        key: "cc-by-4",
                        displayName: "CC BY 4.0",
                        uri: "https://example.test/cc",
                        family: "cc",
                        requiresAttribution: true,
                    },
                ],
            });
        }
        if (pfad === "/api/editor/media/publication-preview") {
            return json(route, 200, { public: false, reason: "rights_unknown" });
        }
        if (pfad === "/api/editor/media" && methode === "GET") {
            gesendet.suchen.push(url.search);
            const typ = url.searchParams.get("type");
            const q = (url.searchParams.get("q") ?? "").toLowerCase();
            const alle = [
                werk(WERK, "Porto Paligan"),
                ...(gleichnamig ? [werk(GLEICHNAMIG, "Vorschau von „Stadtplan von Gareth“")] : []),
            ].filter((eintrag) => q === "" || (eintrag.title ?? "").toLowerCase().includes(q));
            const items = typ === "map" || typ === "map_preview" ? alle : [];
            return json(route, 200, { items, total: items.length, limit: 20, offset: 0 });
        }
        if (pfad === "/api/editor/media/citymaps/datei" && methode === "PUT") {
            gesendet.dateien.push({
                rumpf: route.request().postDataBuffer() ?? Buffer.alloc(0),
                typ: route.request().headers()["content-type"] ?? "",
            });
            return json(route, 200, {
                operationId: "00000000-0000-4000-8000-000000000001",
                status: "applied",
                environment: "development",
                affected: [{ kind: "media_asset", id: HOCHGELADEN, revision: 1 }],
                derivedWork: [],
                warnings: [],
            });
        }
        if (pfad === "/api/editor/media/citymaps" && methode === "GET") return json(route, 200, liste());
        if (pfad === "/api/editor/media/citymaps" && methode === "POST") {
            const body = route.request().postDataJSON() as MamKarteAnlegenBody;
            gesendet.anlegen.push(body);
            neu = detail(NEU, body.fields.title ?? "");
            neu.revision = 1;
            return json(route, 200, quittung(body.operationId, NEU, 1));
        }
        if (pfad === `/api/editor/media/citymaps/${KARTE}` && methode === "GET") return json(route, 200, karte);
        if (pfad === `/api/editor/media/citymaps/${NEU}` && methode === "GET" && neu !== undefined) {
            return json(route, 200, neu);
        }
        if (pfad === `/api/editor/media/citymaps/${KARTE}/image` && methode === "POST") {
            const body = route.request().postDataJSON() as MamKarteBildBody;
            gesendet.zuweisen.push(body);
            const titel =
                body.assetId === WERK
                    ? "Porto Paligan"
                    : body.assetId === HOCHGELADEN
                      ? "Karte von „Stadtplan von Gareth“"
                      : "Vorschau von „Stadtplan von Gareth“";
            // Wie der Server seit Stufe 2: Eine Karte kommt als Version ans Ende, eine Vorschau ersetzt die bisherige.
            const neuesBild =
                body.role === "map_full"
                    ? {
                          ...bild("map_full", body.assetId, titel),
                          vorschauSperre: null,
                          versionLabel: body.versionLabel ?? null,
                      }
                    : bild(body.role, body.assetId, titel);
            karte = {
                ...karte,
                revision: karte.revision + 1,
                images: nummeriert([
                    ...karte.images.filter((eintrag) => body.role === "map_full" || eintrag.role !== body.role),
                    neuesBild,
                ]),
            };
            return json(route, 200, quittung(body.operationId, KARTE, karte.revision));
        }
        if (pfad === `/api/editor/media/citymaps/${KARTE}/image/remove` && methode === "POST") {
            const body = route.request().postDataJSON() as MamKarteBildLoesenBody;
            gesendet.loesen.push(body);
            karte = {
                ...karte,
                revision: karte.revision + 1,
                images: nummeriert(
                    karte.images.filter(
                        (eintrag) =>
                            eintrag.role !== body.role ||
                            (body.assetId !== undefined && eintrag.assetId !== body.assetId),
                    ),
                ),
            };
            return json(route, 200, quittung(body.operationId, KARTE, karte.revision));
        }
        if (pfad === `/api/editor/media/citymaps/${KARTE}/version` && methode === "POST") {
            const body = route.request().postDataJSON() as MamKarteVersionBody;
            gesendet.versionen.push(body);
            let bilder = karte.images.map((eintrag) =>
                body.op === "label" && eintrag.assetId === body.assetId
                    ? { ...eintrag, versionLabel: body.label ?? null }
                    : eintrag,
            );
            if (body.op === "first") {
                const vorn = bilder.find((eintrag) => eintrag.assetId === body.assetId)!;
                bilder = [vorn, ...bilder.filter((eintrag) => eintrag !== vorn)];
            }
            karte = { ...karte, revision: karte.revision + 1, images: nummeriert(bilder) };
            return json(route, 200, quittung(body.operationId, KARTE, karte.revision));
        }
        if (pfad === `/api/editor/media/citymaps/${KARTE}/links` && methode === "POST") {
            const body = route.request().postDataJSON() as MamKarteLinksBody;
            gesendet.links.push(body);
            karte = {
                ...karte,
                revision: karte.revision + 1,
                links: body.links.map((link, i) => ({
                    role: i === 0 ? "primary" : "further",
                    url: link.url,
                    label: link.label,
                    isPaid: link.isPaid,
                })),
            };
            return json(route, 200, quittung(body.operationId, KARTE, karte.revision));
        }
        if (pfad === `/api/editor/media/citymaps/${KARTE}/preview` && methode === "POST") {
            const body = route.request().postDataJSON() as MamKarteVorschauBody;
            gesendet.vorschau.push(body);
            // Die neue Vorschau hängt sofort und wird gerechnet; Rechte und Notaus folgen der Karte.
            karte = {
                ...karte,
                revision: karte.revision + 1,
                images: [
                    ...karte.images,
                    {
                        ...bild("map_preview", ERZEUGT, body.title),
                        publication: { public: false, reason: "technical_state_not_ok" },
                        technicalState: "pending",
                        erzeugtAus: { assetId: WERK, title: "Porto Paligan", offline: false },
                    },
                ],
            };
            return json(route, 200, {
                ...quittung(body.operationId, KARTE, karte.revision),
                affected: [
                    { kind: "citymap", id: KARTE, revision: karte.revision },
                    { kind: "media_asset", id: ERZEUGT, revision: 1 },
                ],
                derivedWork: [{ kind: "citymap_preview_generate", jobId: "j1", state: "queued" }],
            });
        }
        if (pfad === `/api/editor/media/citymaps/${KARTE}/places` && methode === "POST") {
            const body = route.request().postDataJSON() as MamKarteOrteBody;
            gesendet.orte.push(body);
            const zeilen = [...karte.places];
            const ziel = body.target === undefined ? undefined : ZIELE[body.target.id];
            const bezug =
                body.target === undefined || ziel === undefined
                    ? null
                    : { kind: body.target.kind, id: body.target.id, name: ziel.name, active: true, type: ziel.type };
            if (body.action === "add" && bezug !== null) {
                zeilen.push({ name: bezug.name, target: bezug, targetState: "resolved" });
            } else if (body.action === "remove") {
                zeilen.splice(body.index!, 1);
            } else if (body.action === "resolve" && bezug !== null) {
                zeilen[body.index!] = { ...zeilen[body.index!]!, target: bezug, targetState: "resolved" };
            }
            karte = { ...karte, revision: karte.revision + 1, places: zeilen };
            return json(route, 200, quittung(body.operationId, KARTE, karte.revision));
        }
        if (pfad === "/api/editor/inhalte/quellen" && methode === "GET") {
            gesendet.quellenSuchen.push(url.search);
            const q = (url.searchParams.get("q") ?? "").toLowerCase();
            const items = VERZEICHNIS.filter((zeile) => zeile.title.toLowerCase().includes(q));
            return json(route, 200, { total: items.length, items, zahlen: { aktiv: 2, editor: 1, stillgelegt: 0 } });
        }
        if (pfad === `/api/editor/media/citymaps/${KARTE}/sources` && methode === "POST") {
            const body = route.request().postDataJSON() as MamKarteQuellenBody;
            gesendet.quellen.push(body);
            const liste = [...(karte.publications ?? [])];
            const i = liste.findIndex((p) => p.sourceId === body.sourceId);
            if (body.op === "add" && i < 0) {
                const zeile = VERZEICHNIS.find((eintrag) => eintrag.id === body.sourceId)!;
                liste.push(publikation(zeile.id, zeile.title, zeile.umschlag !== null, body.pages ?? null));
            } else if (body.op === "pages") {
                liste[i] = { ...liste[i]!, pages: body.pages === "" ? null : (body.pages ?? null) };
            } else if (body.op === "remove") {
                liste[i] = { ...liste[i]!, state: "retired" };
            } else if (body.op === "restore" || body.op === "add") {
                liste[i] = { ...liste[i]!, state: "active" };
            } else if (body.op === "first") {
                liste.unshift(...liste.splice(i, 1));
            }
            karte = { ...karte, revision: karte.revision + 1, publications: liste };
            return json(route, 200, quittung(body.operationId, KARTE, karte.revision));
        }
        return json(route, 404, { error: { code: "not_found", message: "Diese Adresse gibt es nicht." } });
    });
    return gesendet;
}

async function oeffne(page: Page): Promise<void> {
    await stubSitzung(page, [...MIT_MEDIEN, "upload_media"]);
    await editorPanelGemerktZu(page);
    await page.goto(`/edit?medien&medien-objekt=kartensammlung&medien-karte=${KARTE}`);
    await expect(page.getByTestId("medien-spalte-karte")).toBeVisible({ timeout: 30_000 });
}

const eingabe = (page: Page, id: string) => page.getByTestId(id).locator("input");

test("🔴 Neuer Eintrag: der Name ist Pflicht, gesendet wird nur, was erfasst ist, danach ist der Eintrag gewählt", async ({
    page,
}) => {
    const gesendet = await server(page);
    await oeffne(page);

    await page.getByTestId("medien-karten-neu").click();
    await expect(page.getByTestId("medien-karte-neu-fenster")).toBeVisible();
    await page.getByTestId("medien-eintrag-anlegen").click();
    await expect(page.getByTestId("medien-karte-neu-fenster")).toContainText("Eine Karte braucht einen Titel.");
    expect(gesendet.anlegen, "ohne Namen geht nichts hinaus").toHaveLength(0);

    await eingabe(page, "medien-eintrag-name").fill("  Neue Probekarte ");
    await page.getByTestId("medien-eintrag-typ-region").check();
    await page.getByTestId("medien-eintrag-anlegen").click();

    await expect(page.getByTestId("medien-spalte-karte")).toContainText("Neue Probekarte");
    await expect(page.getByTestId("medien-karten-hinweis")).toContainText("Eintrag angelegt");
    expect(gesendet.anlegen).toHaveLength(1);
    expect(gesendet.anlegen[0]).toMatchObject({ fields: { title: "Neue Probekarte" }, types: ["region"], places: [] });
    expect(Object.keys(gesendet.anlegen[0]!.fields), "nur, was erfasst ist").toEqual(["title"]);
});

test("🔴 Neuer Eintrag: die Suche bringt auch Regionen (Art als zweite Zeile), gesendet werden Orte und Regionen als `targets` in der gewählten Folge (WI-0287 Stufe 3)", async ({
    page,
}) => {
    const gesendet = await server(page);
    await oeffne(page);
    await page.getByTestId("medien-karten-neu").click();
    const fenster = page.getByTestId("medien-karte-neu-fenster");
    await expect(fenster).toContainText("Orte und Regionen");
    await expect(fenster).toContainText("Ohne Ort oder Region erscheint die Karte in keiner Infobox.");
    await eingabe(page, "medien-eintrag-name").fill("Siebenwindküste");

    const suche = eingabe(page, "community-karte-ortwahl-suche");
    await expect(suche).toHaveAttribute("placeholder", "Name eines Orts oder einer Region");
    const treffer = fenster.getByTestId("community-karte-ortwahl-treffer").locator("button");
    await suche.fill("Siebenwind");
    await expect(treffer).toHaveCount(2);
    await expect(treffer.filter({ hasText: "Siebenwind-Küste" })).toContainText("Küste · Region");
    await treffer.filter({ hasText: "Pfalz Siebenwind" }).click();
    await suche.fill("Siebenwind-K");
    await treffer.filter({ hasText: "Siebenwind-Küste" }).click();
    await expect(fenster.getByTestId("medien-eintrag-ort")).toHaveCount(2);

    await page.getByTestId("medien-eintrag-anlegen").click();
    await expect(page.getByTestId("medien-karten-hinweis")).toContainText("Eintrag angelegt");
    expect(gesendet.anlegen[0]).toMatchObject({
        fields: { title: "Siebenwindküste" },
        places: [],
        targets: [
            { kind: "place", id: PFALZ },
            { kind: "region", id: KUESTE },
        ],
    });
});

test("🔴 Zuweisen und Lösen: Rolle und gesehene Revision gehen mit, der Platz stellt sich um", async ({ page }) => {
    const gesendet = await server(page);
    await oeffne(page);
    const karte = page.getByTestId("medien-platz-map_full");
    await expect(page.getByTestId("medien-platz-map_full-leer")).toContainText("Keine Karte hinterlegt, nur ein Link:");
    await expect(karte.getByRole("link", { name: "Im Shop" }), "die Links stehen lesend im leeren Platz").toBeVisible();
    await expect(page.getByTestId("medien-platz-map_preview-leer")).toContainText("Keine Vorschau.");

    await page.getByTestId("medien-platz-map_full-zuweisen").click();
    await expect(page.getByTestId("medien-platz-map_full-suche")).toBeVisible();
    await page.getByTestId("medien-platz-map_full-treffer").filter({ hasText: "Porto Paligan" }).click();
    await expect(page.getByTestId("medien-platz-version")).toContainText("Porto Paligan");
    expect(gesendet.zuweisen).toEqual([
        { operationId: expect.stringMatching(/^[0-9a-f-]{36}$/u), baseRevision: 3, role: "map_full", assetId: WERK },
    ]);
    expect(gesendet.suchen.some((suche) => suche.includes("type=map") && !suche.includes("type=map_preview"))).toBe(
        true,
    );

    // Seit Stufe 2 löst man eine Version (mit ihrer Kennung); ein „Ändern“ gibt es an ihr nicht.
    await expect(page.getByTestId("medien-platz-map_full-aendern")).toHaveCount(0);
    await page.getByTestId("medien-platz-version-loesen").click();
    await expect(page.getByTestId("medien-platz-map_full-geloest")).toContainText("Vom Eintrag gelöst");
    await expect(page.getByTestId("medien-platz-map_full-leer")).toBeVisible();
    expect(gesendet.loesen).toMatchObject([{ baseRevision: 4, role: "map_full", assetId: WERK }]);
});

test("🔴 Stufe 2: eine weitere Version hochladen mit Bezeichnung, benennen, zuerst zeigen, lösen; die Vorschau entsteht aus der ersten (WI-0287)", async ({
    page,
}) => {
    const gesendet = await server(page, false, undefined, true);
    await oeffne(page);
    const platz = page.getByTestId("medien-platz-map_full");
    await expect(page.getByTestId("medien-platz-version")).toHaveCount(1);
    await expect(page.getByTestId("medien-platz-versionen-zahl"), "eine Version nennt keine Zahl").toHaveCount(0);
    await expect(page.getByTestId("medien-platz-version-zuerst"), "die erste hat kein „Zuerst zeigen“").toHaveCount(0);
    await expect(page.getByTestId("medien-platz-map_full-zuweisen")).toHaveText(/Weitere Version zuweisen/u);

    // Hochladen: Das Fenster heißt „Weitere Version …“ und fragt nach der Bezeichnung.
    await page.getByTestId("medien-platz-map_full-hochladen").click();
    const fenster = page.getByTestId("medien-hochladen-fenster");
    await expect(fenster).toContainText("Weitere Version für „Stadtplan von Gareth“ hochladen");
    await expect(fenster.getByTestId("medien-hochladen-version-satz")).toHaveText(
        "Diese Karte hat schon eine Version. Die neue kommt dazu.",
    );
    await eingabe(page, "medien-hochladen-version").fill("  SL-Version ");
    const pdf = Buffer.from(["%PDF-1.4", "%%EOF", ""].join(String.fromCharCode(10)), "latin1");
    await page
        .getByTestId("medien-hochladen-datei")
        .setInputFiles({ name: "meister.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.getByTestId("medien-hochladen-grundlage").locator("select").selectOption("permission");
    await page.getByTestId("medien-hochladen-senden").click();
    await expect(fenster).toBeHidden();
    expect(gesendet.zuweisen).toMatchObject([
        { baseRevision: 3, role: "map_full", assetId: HOCHGELADEN, versionLabel: "SL-Version" },
    ]);
    const versionen = page.getByTestId("medien-platz-version");
    await expect(versionen).toHaveCount(2);
    await expect(page.getByTestId("medien-platz-versionen-zahl")).toHaveText("2 Versionen");
    await expect(versionen.nth(1).getByTestId("medien-platz-version-feld").locator("input")).toHaveValue("SL-Version");

    // Die Bezeichnung speichert beim Verlassen des Felds; der Satz unter „Vorschau erzeugen“ nennt die erste Version.
    await versionen.nth(0).getByTestId("medien-platz-version-feld").locator("input").fill("Spielerversion");
    await versionen.nth(0).getByTestId("medien-platz-version-feld").locator("input").press("Tab");
    await expect.poll(() => gesendet.versionen.length).toBe(1);
    expect(gesendet.versionen[0]).toEqual({
        operationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        baseRevision: 4,
        assetId: WERK,
        op: "label",
        label: "Spielerversion",
    });
    await expect(page.getByTestId("medien-platz-map_preview-erzeugen-satz")).toHaveText(
        "Entsteht aus der Version „Spielerversion“. Rechte, Nennung und Notaus folgen der Karte.",
    );

    // Zuerst zeigen: die zweite wird die erste, und mit ihr die Quelle der Vorschau.
    await versionen.nth(1).getByTestId("medien-platz-version-zuerst").click();
    await expect(versionen.nth(0)).toContainText("Karte von „Stadtplan von Gareth“");
    expect(gesendet.versionen[1]).toMatchObject({ baseRevision: 5, assetId: HOCHGELADEN, op: "first" });
    await expect(page.getByTestId("medien-platz-map_preview-erzeugen-satz")).toContainText("„SL-Version“");

    // Lösen: genau diese Version, die andere bleibt.
    await versionen.nth(1).getByTestId("medien-platz-version-loesen").click();
    await expect(versionen).toHaveCount(1);
    await expect(platz.getByTestId("medien-platz-map_full-geloest")).toContainText("Vom Eintrag gelöst");
    expect(gesendet.loesen).toMatchObject([{ baseRevision: 6, role: "map_full", assetId: WERK }]);
    await expect(page.getByTestId("medien-platz-versionen-zahl")).toHaveCount(0);
});

test("🔴 Fundstellen: der Knopf im Platz öffnet den Kasten mit dem Fokus in der Adresse, eine falsche Adresse bleibt an ihrer Zeile, gesendet wird die Folge", async ({
    page,
}) => {
    const gesendet = await server(page);
    await oeffne(page);
    await expect(page.getByTestId("medien-platz-map_full-links")).toContainText("Links bearbeiten");

    await page.getByTestId("medien-platz-map_full-links").click();
    const kasten = page.getByTestId("medien-kasten-links");
    await expect(kasten.getByTestId("medien-karte-links-zeile")).toHaveCount(1);
    await expect(kasten.getByTestId("medien-karte-links-url").locator("input")).toBeFocused();
    await expect(kasten.getByTestId("medien-karte-links-url").locator("input")).toHaveValue(
        "https://example.test/karte",
    );

    await kasten.getByTestId("medien-karte-links-neu").click();
    await expect(kasten.getByTestId("medien-karte-links-zeile")).toHaveCount(2);
    const zweite = kasten.getByTestId("medien-karte-links-zeile").nth(1);
    await zweite.getByTestId("medien-karte-links-url").locator("input").fill("example.org/band");
    await kasten.getByTestId("medien-kasten-links-speichern").click();
    await expect(zweite.getByTestId("medien-karte-links-befund")).toHaveText(
        "Erwartet wird eine Adresse mit http oder https.",
    );
    expect(gesendet.links, "mit falscher Adresse geht nichts hinaus").toHaveLength(0);

    await zweite.getByTestId("medien-karte-links-url").locator("input").fill("https://example.org/band");
    await zweite.getByTestId("medien-karte-links-bezahlt").locator("select").selectOption("nein");
    await kasten.getByTestId("medien-kasten-links-speichern").click();
    await expect(page.getByTestId("medien-karte-fundstellen")).toContainText("Karte");
    expect(gesendet.links).toEqual([
        {
            operationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
            baseRevision: 3,
            links: [
                { url: "https://example.test/karte", label: "Im Shop", isPaid: true },
                { url: "https://example.org/band", label: "Karte", isPaid: false },
            ],
        },
    ]);

    // Entfernen: die erste Zeile weg, die zweite wird der Karten-Link.
    await page.getByTestId("medien-kasten-links-bearbeiten").click();
    await kasten.getByTestId("medien-karte-links-weg").first().click();
    await kasten.getByTestId("medien-kasten-links-speichern").click();
    await expect(page.getByTestId("medien-karte-fundstellen").getByRole("link")).toHaveCount(1);
    expect(gesendet.links[1]!.links).toEqual([{ url: "https://example.org/band", label: "Karte", isPaid: false }]);
});

test("Hochladen: der Name ist vorbelegt, ein gleicher Name in der Liste wird angezeigt und „Vorhandenes verwenden“ bindet ihn", async ({
    page,
}) => {
    const gesendet = await server(page, true);
    await oeffne(page);

    await page.getByTestId("medien-platz-map_preview-hochladen").click();
    const fenster = page.getByTestId("medien-hochladen-fenster");
    await expect(fenster).toBeVisible();
    await expect(fenster).toContainText("Vorschau für „Stadtplan von Gareth“ hochladen");
    await expect(eingabe(page, "medien-hochladen-titel")).toHaveValue("Vorschau von „Stadtplan von Gareth“");
    await expect(fenster.getByTestId("medien-karte-landet")).toContainText("Landet unter „Kartenvorschauen“");
    await expect(fenster.getByTestId("medien-karte-konflikt")).toContainText(
        "Diesen Namen gibt es unter „Kartenvorschauen“ schon.",
    );

    await page.getByTestId("medien-karte-konflikt-verwenden").click();
    await expect(fenster).toBeHidden();
    await expect(page.getByTestId("medien-platz-map_preview-bild")).toContainText(
        "Vorschau von „Stadtplan von Gareth“",
    );
    expect(gesendet.zuweisen).toMatchObject([{ baseRevision: 3, role: "map_preview", assetId: GLEICHNAMIG }]);

    // Ein anderer Name: kein Hinweis mehr.
    await page.getByTestId("medien-platz-map_preview-aendern").click();
    await page.getByTestId("medien-platz-map_preview-stattdessen").click();
    await expect(page.getByTestId("medien-karte-konflikt")).toBeVisible();
    await eingabe(page, "medien-hochladen-titel").fill("Etwas ganz anderes");
    await expect(page.getByTestId("medien-karte-konflikt")).toBeHidden();
});

test("🔴 Publikationen: suchen mit Umschlag, anhängen, Fundstelle, zuerst zeigen, lösen; ohne Quellenrecht kein Anlegen (WI-0287 Punkt 4)", async ({
    page,
}) => {
    const gesendet = await server(page, false, [
        publikation(GEOGRAPHIA, "Geographia Aventurica", true, "42"),
        publikation(LANDKARTEN, "Landkartenset Das Dornenreich", false),
    ]);
    await oeffne(page);
    const kasten = page.getByTestId("medien-kasten-publikationen");
    const zeilen = kasten.getByTestId("medien-publikation-quelle");
    await expect(kasten).toContainText("Publikationen (2)");
    await expect(zeilen).toHaveCount(2);
    // Umschlagbild links in jeder Zeile, ohne Bild ein leerer Platz.
    await expect(zeilen.nth(0).getByTestId("medien-publikation-quelle-bild").locator("img")).toHaveCount(1);
    await expect(zeilen.nth(1).getByTestId("medien-publikation-quelle-bild").locator("img")).toHaveCount(0);
    await expect(kasten.getByTestId("medien-publikationen-baende")).toHaveText(
        "Besucher sehen alle unter „Bände“, die erste zuerst.",
    );
    // Ohne `manage_sources` gibt es kein „Quelle bearbeiten“.
    await zeilen.nth(0).getByTestId("medien-publikation-quelle-kopf").click();
    await expect(zeilen.nth(0).getByTestId("medien-publikation-quelle-loesen")).toBeVisible();
    await expect(zeilen.nth(0).getByTestId("medien-publikation-quelle-oeffnen")).toHaveCount(0);
    await expect(
        zeilen.nth(0).getByTestId("medien-publikation-quelle-zuerst"),
        "die erste ist schon der Band",
    ).toHaveCount(0);

    // Suchen: Treffer mit Umschlag und ohne; nichts gefunden sagt, wer neue anlegt.
    await kasten.getByTestId("medien-publikation-neu").click();
    const suche = eingabe(page, "medien-publikation-quelle-suche");
    await suche.fill("Hora");
    const treffer = kasten.getByTestId("medien-publikation-quelle-treffer-eins");
    await expect(treffer).toHaveCount(2);
    await expect(treffer.nth(0).getByTestId("medien-publikation-quelle-treffer-bild").locator("img")).toHaveCount(1);
    await expect(treffer.nth(1)).toContainText("Kein Umschlagbild");
    expect(gesendet.quellenSuchen.some((anfrage) => anfrage.includes("umschlag=true"))).toBe(true);
    await suche.fill("Unbekanntes Heft");
    await expect(kasten.getByTestId("medien-publikation-quelle-keiner")).toHaveText(
        "Steht nicht im Quellenverzeichnis. Neue Publikationen legt an, wer Quellen verwalten darf.",
    );

    // Anhängen: gesehene Revision und Kennung gehen mit, die neue Zeile steht am Ende und ist offen.
    await suche.fill("Reich");
    await treffer.filter({ hasText: "Reich des Horas" }).click();
    await expect(zeilen).toHaveCount(3);
    expect(gesendet.quellen[0]).toEqual({
        operationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        baseRevision: 3,
        op: "add",
        sourceId: HORAS,
    });
    await expect(kasten).toContainText("Publikationen (3)");
    const horas = zeilen.filter({ hasText: "Reich des Horas" });

    // Die Fundstelle speichert beim Verlassen des Felds.
    await horas.getByTestId("medien-publikation-quelle-seiten").locator("input").fill("130");
    await horas.getByTestId("medien-publikation-quelle-seiten").locator("input").press("Tab");
    await expect(horas.getByTestId("medien-publikation-quelle-seiten-text")).toHaveText("S. 130");
    await expect.poll(() => gesendet.quellen.length).toBe(2);
    expect(gesendet.quellen[1]).toMatchObject({ baseRevision: 4, op: "pages", sourceId: HORAS, pages: "130" });

    // Zuerst zeigen: Sie wird der Band.
    await horas.getByTestId("medien-publikation-quelle-zuerst").click();
    await expect(zeilen.first()).toContainText("Reich des Horas");
    expect(gesendet.quellen[2]).toMatchObject({ baseRevision: 5, op: "first", sourceId: HORAS });

    // Lösen: Die Zeile geht, der Satz sagt, wie sie zurückkommt.
    await zeilen.filter({ hasText: "Landkartenset" }).getByTestId("medien-publikation-quelle-kopf").click();
    await zeilen.filter({ hasText: "Landkartenset" }).getByTestId("medien-publikation-quelle-loesen").click();
    await expect(kasten.getByTestId("medien-publikation-geloest")).toContainText("„Gelöste anzeigen“ holt sie zurück");
    await expect(zeilen).toHaveCount(2);
    await expect(kasten.getByTestId("medien-publikation-quellen-stille-zeigen")).toBeVisible();
    await expect(kasten).toContainText("Gelöste anzeigen (1)");
    expect(gesendet.quellen[3]).toMatchObject({ baseRevision: 6, op: "remove", sourceId: LANDKARTEN });
});

test("🔴 Orte und Regionen: anhängen über die Suche, eine nicht aufgelöste Zeile zuordnen, lösen; jede Handlung wird sofort mit dem gesehenen Stand gesendet (WI-0287 Stufe 3)", async ({
    page,
}) => {
    const gesendet = await server(page, false, undefined, false, [
        { name: "Siebenwindküste", target: null, targetState: "unmatched" },
        {
            name: "Porto Paligan",
            target: { kind: "place", id: PORTO, name: "Porto Paligan", active: true, type: "stadt" },
            targetState: "resolved",
        },
    ]);
    await oeffne(page);
    const kasten = page.getByTestId("medien-kasten-orte");
    const zeilen = kasten.getByTestId("medien-orte-zeile");
    const hinweis = kasten.getByTestId("medien-orte-hinweis");
    await expect(kasten).toContainText("Orte und Regionen (2)");
    await expect(zeilen).toHaveCount(2);

    // Die nicht aufgelöste Zeile: kursiv, mit dem Satz, warum die Karte in keiner Infobox steht; der Ort mit Art und Gruppe.
    await expect(zeilen.nth(0).getByTestId("medien-orte-l2")).toHaveText("nicht zugeordnet");
    await expect(zeilen.nth(0).getByTestId("medien-orte-warnung")).toHaveText(
        "Passt zu keinem Ort und keiner Region. Darum steht die Karte hier in keiner Infobox.",
    );
    await expect(zeilen.nth(1).getByTestId("medien-orte-l2")).toHaveText("Stadt · Ort");
    await expect(zeilen.nth(0).getByTestId("medien-karte-auf-karte")).toHaveCount(0);
    await expect(zeilen.nth(1).getByTestId("medien-karte-auf-karte")).toHaveCount(1);
    await expect(kasten.getByTestId("medien-orte-satz")).toHaveText(
        "Die Karte steht in der Infobox jedes Orts und jeder Region hier, dazu in deren Editor im Reiter „Karten“.",
    );

    // Zuordnen: Die Suche ist mit dem Rohnamen vorbelegt, die Wahl ersetzt die Zeile (dieselbe Stelle).
    await zeilen.nth(0).getByTestId("medien-orte-zuordnen").click();
    await expect(kasten.getByTestId("medien-orte-zuordnen-kopf")).toHaveText(
        "„Siebenwindküste“ zuordnen: Ort oder Region wählen.",
    );
    await expect(eingabe(page, "medien-orte-suche")).toHaveValue("Siebenwindküste");
    // Der Cursor steht gleich im Suchfeld (Stage-Probe 2026-11-07: ohne das tippte man ins Leere).
    await expect(eingabe(page, "medien-orte-suche")).toBeFocused();
    const treffer = kasten.getByTestId("medien-orte-treffer-eins");
    await expect(treffer).toHaveCount(1);
    await expect(treffer.first()).toContainText("Siebenwind-Küste");
    await expect(treffer.first()).toContainText("Küste · Region");
    await treffer.first().click();
    await expect(hinweis).toHaveText(
        "Gespeichert. Die Karte steht jetzt in der Infobox von „Siebenwind-Küste“ und im Derographie-Editor im Reiter „Karten“.",
    );
    expect(gesendet.orte[0]).toEqual({
        operationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        baseRevision: 3,
        action: "resolve",
        index: 0,
        target: { kind: "region", id: KUESTE },
    });
    await expect(zeilen.nth(0).getByTestId("medien-orte-name")).toHaveText("Siebenwind-Küste");
    await expect(zeilen.nth(0).getByTestId("medien-orte-l2")).toHaveText("Küste · Region");
    await expect(zeilen.nth(0).getByTestId("medien-orte-warnung")).toHaveCount(0);
    await expect(zeilen.nth(0).getByTestId("medien-karte-auf-karte")).toHaveCount(1);
    await expect(kasten.getByTestId("medien-orte-suche-box")).toHaveCount(0);

    // Anhängen: Orte und Regionen stehen in einer Liste; was schon hängt, ist gesperrt; ein freies Label ist kein Ziel.
    await kasten.getByTestId("medien-orte-neu").click();
    await expect(kasten.getByTestId("medien-orte-zu-kurz")).toHaveText(
        "Ab zwei Buchstaben. Orte und Regionen stehen in einer Liste.",
    );
    await eingabe(page, "medien-orte-suche").fill("Siebenwind");
    await expect(treffer).toHaveCount(2);
    await expect(treffer.nth(0)).toBeDisabled();
    await expect(treffer.nth(0)).toContainText("schon angehängt");
    await expect(treffer.nth(1)).toContainText("Pfalz Siebenwind");
    await expect(treffer.nth(1)).toContainText("Dorf · Ort");
    await eingabe(page, "medien-orte-suche").fill("Xyzzy");
    await expect(kasten.getByTestId("medien-orte-keiner")).toHaveText("Kein Ort und keine Region mit diesem Namen.");
    await eingabe(page, "medien-orte-suche").fill("Alber");
    await treffer.first().click();
    await expect(zeilen).toHaveCount(3);
    expect(gesendet.orte[1]).toMatchObject({
        baseRevision: 4,
        action: "add",
        target: { kind: "region", id: ALBERNIA },
    });
    expect(gesendet.orte[1]!.index).toBeUndefined();
    await expect(kasten).toContainText("Orte und Regionen (3)");

    // Abbrechen schließt die Suche, ohne zu senden.
    await kasten.getByTestId("medien-orte-neu").click();
    await kasten.getByTestId("medien-orte-abbrechen").click();
    await expect(kasten.getByTestId("medien-orte-suche-box")).toHaveCount(0);
    expect(gesendet.orte).toHaveLength(2);

    // Lösen: Der Ort geht, der Hinweis nennt ihn.
    await zeilen.nth(1).getByTestId("medien-orte-loesen").click();
    await expect(hinweis).toHaveText("Gelöst. Die Karte steht nicht mehr in der Infobox von „Porto Paligan“.");
    expect(gesendet.orte[2]).toMatchObject({ baseRevision: 5, action: "remove", index: 1 });
    await expect(zeilen).toHaveCount(2);

    // „Auf Karte zeigen“ an der Region (Betreiber 2026-11-07): Das Fenster geht zu, die Region öffnet als Fläche im Infopanel.
    const flaeche = page.waitForRequest(
        (anfrage) => new URL(anfrage.url()).pathname === `/api/subjects/area/${KUESTE}`,
    );
    await zeilen.nth(0).getByTestId("medien-karte-auf-karte").click();
    await flaeche;
    await expect(page.getByTestId("medien-fenster")).toBeHidden();
    await expect(page.getByTestId("info-title")).toHaveText("Siebenwind-Küste");
});

test("🔴 Eine Kartendatei hochladen: PDF als Rohkörper mit Kopf, danach an die Karte gebunden, der Platz nennt die Liste", async ({
    page,
}) => {
    const gesendet = await server(page);
    await oeffne(page);

    await page.getByTestId("medien-platz-map_full-hochladen").click();
    const fenster = page.getByTestId("medien-hochladen-fenster");
    await expect(fenster).toContainText("Karte für „Stadtplan von Gareth“ hochladen");
    await expect(fenster).toContainText("JPEG, PNG, WebP oder PDF, bis 50 MB");
    // Die erste Karte: Das Feld „Version“ darf leer bleiben (WI-0287 Stufe 2), und leer geht keine Bezeichnung mit.
    await expect(fenster.getByTestId("medien-hochladen-version-satz")).toHaveText(
        "Leer lassen, wenn es nur eine gibt.",
    );
    await expect(eingabe(page, "medien-hochladen-titel")).toHaveValue("Karte von „Stadtplan von Gareth“");
    // Der Zeichner des Eintrags ist der Urheber der Karte.
    await expect(eingabe(page, "medien-hochladen-urheber")).toHaveValue("Zeichnerin Elwe");

    const pdf = Buffer.from(
        ["%PDF-1.4", "1 0 obj", "<<>>", "endobj", "trailer", "<<>>", "%%EOF", ""].join(String.fromCharCode(10)),
        "latin1",
    );
    await page
        .getByTestId("medien-hochladen-datei")
        .setInputFiles({ name: "stadtplan.pdf", mimeType: "application/pdf", buffer: pdf });
    await expect(page.getByTestId("medien-hochladen-pdf")).toBeVisible();
    await page.getByTestId("medien-hochladen-grundlage").locator("select").selectOption("permission");
    await page.getByTestId("medien-hochladen-senden").click();

    await expect(page.getByTestId("medien-platz-map_full-frisch")).toContainText(
        "Liegt jetzt unter Karten als Karte von „Stadtplan von Gareth“.",
    );
    expect(gesendet.dateien).toHaveLength(1);
    const { rumpf, typ } = gesendet.dateien[0]!;
    expect(typ).toBe("application/octet-stream");
    const laenge = rumpf.readUInt32BE(0);
    const kopf = JSON.parse(rumpf.subarray(4, 4 + laenge).toString("utf8")) as {
        operationId: string;
        name: string;
        form: { role: string; title: string; rights: { basis: string; creator: string } };
    };
    expect(kopf).toMatchObject({
        name: "stadtplan.pdf",
        form: {
            role: "map_full",
            title: "Karte von „Stadtplan von Gareth“",
            rights: { basis: "permission", creator: "Zeichnerin Elwe" },
        },
    });
    expect(rumpf.subarray(4 + laenge).equals(pdf), "die Bytes der Datei folgen dem Kopf unverändert").toBe(true);
    expect(gesendet.zuweisen).toMatchObject([{ baseRevision: 3, role: "map_full", assetId: HOCHGELADEN }]);
    expect(gesendet.zuweisen[0]).not.toHaveProperty("versionLabel");
});

test("🔴 Vorschau erzeugen: ein gleicher Name führt in den Konflikt, „Unter diesem Namen erzeugen“ sendet Karte, Stand und Namen, danach wird gerechnet (WI-0287 Punkt 5)", async ({
    page,
}) => {
    const gesendet = await server(page, true, undefined, true);
    await oeffne(page);
    const platz = page.getByTestId("medien-platz-map_preview");
    await expect(page.getByTestId("medien-platz-map_preview-leer")).toBeVisible();
    await expect(page.getByTestId("medien-platz-map_preview-erzeugen-satz")).toHaveText(
        "Entsteht aus der Karte. Rechte, Nennung und Notaus folgen der Karte.",
    );

    // Den Namen gibt es unter „Kartenvorschauen“ schon: Der Platz kündigt ihn an, nichts geht hinaus.
    await page.getByTestId("medien-platz-map_preview-erzeugen").click();
    const konflikt = page.getByTestId("medien-platz-map_preview-konflikt");
    await expect(konflikt).toContainText("Vorschau von „Stadtplan von Gareth“ gibt es unter „Kartenvorschauen“ schon.");
    await expect(eingabe(page, "medien-platz-map_preview-konflikt-name")).toHaveValue(
        "Vorschau von „Stadtplan von Gareth“ (2)",
    );
    expect(gesendet.vorschau, "erst angekündigt, nicht erzeugt").toHaveLength(0);
    expect(gesendet.suchen.some((suche) => suche.includes("type=map_preview"))).toBe(true);

    await page.getByTestId("medien-platz-map_preview-konflikt-erzeugen").click();
    await expect(page.getByTestId("medien-platz-map_preview-bild")).toBeVisible();
    expect(gesendet.vorschau).toEqual([
        {
            operationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
            baseRevision: 3,
            sourceAssetId: WERK,
            title: "Vorschau von „Stadtplan von Gareth“ (2)",
        },
    ]);
    // Sie hängt sofort, wird gerechnet und nennt ihre Karte; der Satz nennt die Liste.
    await expect(page.getByTestId("medien-platz-map_preview-satz")).toHaveText(
        "Wird gerechnet. Das Bild erscheint von selbst.",
    );
    await expect(page.getByTestId("medien-platz-map_preview-erzeugt-aus")).toHaveText(
        "Erzeugt aus Porto Paligan. Rechte und Notaus folgen der Karte.",
    );
    await expect(platz.getByTestId("medien-platz-map_preview-frisch")).toContainText(
        "Liegt jetzt unter Kartenvorschauen als Vorschau von „Stadtplan von Gareth“ (2).",
    );
    await expect(konflikt).toBeHidden();
});

test("🔴 Stufe 2: Bilder an anderen Eintrag geben: ohne Ziel ein Satz, die Namensvettern, die Version vorbelegt, die Folgen; gesendet werden beide Stände, danach ist das Ziel gewählt; der stillgelegte nennt es, Zurückholen lässt die Bilder dort (WI-0287)", async ({
    page,
}) => {
    const ZIEL = "7e570000-0000-4000-8000-000000000073";
    const FREMD = "7e570000-0000-4000-8000-000000000074";
    await server(page, false, undefined, true);
    const ziel: MamKarteDetail = {
        ...detail(ZIEL, "Stadtplan", [bild("map_preview", "7e570000-0000-4000-8000-0000000000a5", "Eigene Vorschau")]),
        revision: 7,
    };
    let quelle: MamKarteDetail | undefined;
    const zusammen: MamKarteZusammenlegenBody[] = [];
    const listen: string[] = [];
    const zeile = (karte: MamKarteDetail, active = true) => ({
        id: karte.id,
        title: karte.title,
        art: karte.art,
        types: karte.types,
        validFromBf: null,
        validToBf: null,
        places: 0,
        images: karte.images.length,
        publicImages: 0,
        versions: 0,
        state: active ? ("active" as const) : ("retired" as const),
        active,
        preview: null,
        privatePreview: null,
    });
    // Nach dem Server des Tests: die Suche der Zielwahl, das Ziel, das Zusammenlegen, die stillgelegte Quelle und ihr Zurückholen.
    await page.route("**/api/editor/media/citymaps**", async (route) => {
        const url = new URL(route.request().url());
        const methode = route.request().method();
        if (url.pathname === "/api/editor/media/citymaps" && methode === "GET" && url.searchParams.has("q")) {
            listen.push(url.searchParams.get("q") ?? "");
            // Der Server findet mehr als die Namensvettern; die Wahl zeigt nur sie, nie den Eintrag selbst.
            const items = [
                zeile(detail(KARTE, "Stadtplan von Gareth")),
                zeile(ziel),
                zeile(detail(FREMD, "Gareths Stadtplan")),
            ];
            return json(route, 200, { items, total: items.length, retiredTotal: 0 });
        }
        if (url.pathname === `/api/editor/media/citymaps/${ZIEL}` && methode === "GET") return json(route, 200, ziel);
        if (url.pathname === `/api/editor/media/citymaps/${KARTE}/merge` && methode === "POST") {
            const body = route.request().postDataJSON() as MamKarteZusammenlegenBody;
            zusammen.push(body);
            // Beim ersten Versuch ist das Ziel inzwischen stillgelegt.
            if (zusammen.length === 1) {
                return json(route, 409, { error: { code: "citymap_target_retired", message: "Text des Servers" } });
            }
            quelle = {
                ...detail(KARTE, "Stadtplan von Gareth"),
                revision: 4,
                state: "retired",
                active: false,
                handedTo: { id: ZIEL, title: "Stadtplan" },
            };
            return json(route, 200, {
                ...quittung(body.operationId, KARTE, 4),
                affected: [
                    { kind: "citymap", id: KARTE, revision: 4 },
                    { kind: "citymap", id: ZIEL, revision: 8 },
                ],
            });
        }
        if (url.pathname === `/api/editor/media/citymaps/${KARTE}` && methode === "GET" && quelle !== undefined) {
            return json(route, 200, quelle);
        }
        if (url.pathname === `/api/editor/media/citymaps/${KARTE}/restore` && methode === "POST") {
            const body = route.request().postDataJSON() as { operationId: string };
            quelle = { ...quelle!, revision: 5, state: "active", active: true, handedTo: null };
            return json(route, 200, quittung(body.operationId, KARTE, 5));
        }
        return route.fallback();
    });
    await oeffne(page);

    await page.getByTestId("medien-karte-entfernen").click();
    const fenster = page.getByTestId("medien-karte-entfernen-fenster");
    await expect(fenster).toBeVisible();
    await expect(page.getByTestId("medien-karte-entfernen-weg-nur")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("medien-karte-entfernen-weg-uebergeben").click();
    await expect(page.getByTestId("medien-karte-entfernen-senden")).toHaveText(/⇄\s*Übergeben und entfernen/u);

    // Ohne gewähltes Ziel steht ein Satz statt des Sendens.
    await page.getByTestId("medien-karte-entfernen-senden").click();
    await expect(page.getByTestId("medien-karte-entfernen-ohne-ziel")).toHaveText(
        "Es fehlt der Eintrag, der die Bilder bekommt.",
    );
    expect(zusammen).toHaveLength(0);

    // Ohne Suchwort die Namensvettern (gleiches erstes Wort), ohne den Eintrag selbst.
    const treffer = page.getByTestId("medien-karte-entfernen-ziel-treffer");
    await expect(treffer).toHaveCount(1);
    await expect(treffer).toContainText("Stadtplan");
    expect(listen[0]).toBe("stadtplan");
    await treffer.click();
    await expect(page.getByTestId("medien-karte-entfernen-ziel-gewaehlt")).toContainText("Stadtplan");
    await expect(page.getByTestId("medien-karte-entfernen-ohne-ziel")).toHaveCount(0);
    await expect(eingabe(page, "medien-karte-entfernen-version")).toHaveValue("von Gareth");
    const folgen = page.getByTestId("medien-karte-entfernen-folgen");
    await expect(folgen).toContainText("Porto Paligan wird eine weitere Version von „Stadtplan“.");
    await expect(folgen).not.toContainText("Vorschau");
    await expect(folgen).toContainText("Fundstellen, Publikationen und Orte, die dort fehlen, kommen dazu.");
    const aufnahmen = process.env["E2E_AUFNAHMEN"];
    if (aufnahmen !== undefined) {
        await page.screenshot({ path: `${aufnahmen}/zusammenlegen-1280.png` });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: `${aufnahmen}/zusammenlegen-tel.png` });
        await page.setViewportSize({ width: 1280, height: 720 });
    }

    // „⇄ Andere wählen“ führt zurück in die Suche; dasselbe Ziel noch einmal.
    await page.getByTestId("medien-karte-entfernen-ziel-andere").click();
    await expect(treffer).toHaveCount(1);
    await treffer.click();

    await eingabe(page, "medien-karte-entfernen-version").fill("Spielerversion");
    // Ein inzwischen stillgelegtes Ziel: Der Satz steht, die Wahl geht zurück an die Suche.
    await page.getByTestId("medien-karte-entfernen-senden").click();
    await expect(page.getByTestId("medien-karte-entfernen-fehler")).toHaveText(
        "Der gewählte Eintrag ist stillgelegt. Ein anderer muss gewählt werden.",
    );
    await expect(page.getByTestId("medien-karte-entfernen-ziel-gewaehlt")).toHaveCount(0);
    await treffer.click();
    await expect(page.getByTestId("medien-karte-entfernen-fehler")).toHaveCount(0);
    await eingabe(page, "medien-karte-entfernen-version").fill("Spielerversion");
    await page.getByTestId("medien-karte-entfernen-senden").click();
    await expect(fenster).toBeHidden();
    expect(zusammen).toHaveLength(2);
    expect(zusammen.slice(1)).toEqual([
        {
            operationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
            baseRevision: 3,
            targetId: ZIEL,
            targetBaseRevision: 7,
            versionLabel: "Spielerversion",
        },
    ]);
    // Danach ist das Ziel gewählt, und der Hinweis nennt es.
    await expect(page.getByTestId("medien-karten-hinweis")).toHaveText(
        "Entfernt. Die Bilder hängen jetzt an „Stadtplan“.",
    );
    await expect(page.getByTestId("medien-spalte-karte")).toContainText("Eigene Vorschau");

    // Der stillgelegte Eintrag nennt das Ziel; Zurückholen lässt die Bilder dort.
    await page.goto(`/edit?medien&medien-objekt=kartensammlung&medien-karte=${KARTE}`);
    await expect(page.getByTestId("medien-karte-stillgelegt-hinweis")).toHaveText(
        "Dieser Eintrag ist stillgelegt. Besucher sehen ihn nicht mehr. Die Bilder hängen jetzt an „Stadtplan“.",
    );
    await page.getByTestId("medien-karte-zurueckholen").click();
    await expect(page.getByTestId("medien-karten-hinweis")).toHaveText(
        "Zurückgeholt. Die übergebenen Bilder bleiben am anderen Eintrag.",
    );
});
