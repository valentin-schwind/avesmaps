import { expect, type Locator, type Page, type Route } from "@playwright/test";
import {
    FlaechenVereinigenBody,
    FlaechenVereinigenPruefung,
    FlaechenVereinigenReceipt,
    type EditorLandscapeDetail,
    type EditorLandscapeList,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";
import { editorPanelAuf } from "./ortseditor-stub.ts";
import { vertragGilt } from "./vertrag.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Stubs von „Flächen vereinigen ›“ (WI-0252) für Rechner und Telefon: zwei Landschaften aus den Kacheln der lokalen Karte, die
 * aneinanderstoßen, Liste, Detail, Prüfung und Schreibweg aus Stubs. 🔴 Kein Test schreibt in die Datenbank.
 */

/** Die Prüfung, wenn es geht: beide können Vorlage sein, Revisionen 2 und 3. */
export const GEHT = (n: Nachbarn): FlaechenVereinigenPruefung => ({
    geht: true,
    objekte: [n.a, n.b].map((f, i) => ({ publicId: f.id, revision: i + 2, name: f.name, art: f.typ, flaechen: 1 })),
    vorlagen: [n.a.id, n.b.id],
});

/** Die Bilder für den Betreiber (Auftrag WI-0252): nur, wenn der Ordner genannt ist. */
export const BILDER = process.env["FLAECHEN_VEREINIGEN_BILDER"];
/** Nablaquell-Wälder und Vorgebirge des Kosch (wie `area-view-scope.spec.ts`): Wälder, die aneinanderstoßen. */
const LAND = { x: 450, y: 560 };

const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

export interface Nachbarn {
    readonly a: { id: string; name: string; typ: string };
    readonly b: { id: string; name: string; typ: string };
    /** Eine Stelle auf der Grenze zwischen beiden, in Seitenkoordinaten. */
    readonly stelle: { x: number; y: number };
}

/**
 * Zwei Landschaften derselben Art, die auf der Karte aneinanderstoßen: zwei benachbarte Rasterpunkte (rechts oder unten, 8 px) mit je
 * genau einer, verschiedenen, beide mit Namen. Erst, wenn die Flächen gezeichnet sind (wie `showLandscapes`).
 */
export async function nachbarnDerKarte(page: Page): Promise<Nachbarn> {
    await page.waitForFunction(
        () => {
            const map = globalThis.avesmapsMap;
            if (!map) return false;
            const ebenen = (map.getStyle().layers ?? [])
                .map((l) => l.id)
                .filter((id) => id.startsWith("landscape-fill-"));
            return ebenen.length > 0 && map.queryRenderedFeatures({ layers: ebenen }).length > 0;
        },
        undefined,
        { timeout: 30_000 },
    );
    const { gefunden, statistik } = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const ebenen = (map.getStyle().layers ?? []).map((l) => l.id).filter((id) => id.startsWith("landscape-fill-"));
        const leinwand = map.getCanvas();
        const rahmen = leinwand.getBoundingClientRect();
        const frei = (x: number, y: number): boolean =>
            document.elementFromPoint(rahmen.left + x, rahmen.top + y) === leinwand;
        const eine = (x: number, y: number) => {
            const treffer = map.queryRenderedFeatures([x, y], { layers: ebenen });
            const ids = new Set(treffer.map((f) => String(f.properties["region_public_id"])));
            if (ids.size !== 1) return undefined;
            const p = treffer[0]!.properties;
            return {
                id: String(p["region_public_id"]),
                name: String(p["name"] ?? ""),
                typ: String(p["region_type"] ?? ""),
            };
        };
        const zahl = { punkte: 0, einzeln: 0, namen: new Set<string>(), paare: 0 };
        // Je Landschaft die erste Stelle, an der nur sie liegt: der Rückfall, wenn keine zwei derselben Art aneinanderstoßen.
        const erste = new Map<string, { f: { id: string; name: string; typ: string }; x: number; y: number }>();
        const schritt = 8;
        for (let y = 60; y < leinwand.clientHeight - 60; y += schritt)
            for (let x = 40; x < leinwand.clientWidth - 40; x += schritt) {
                if (!frei(x, y)) continue;
                zahl.punkte += 1;
                const a = eine(x, y);
                if (a === undefined) continue;
                zahl.einzeln += 1;
                if (a.name !== "") zahl.namen.add(a.name);
                if (a.name !== "" && !erste.has(a.id)) erste.set(a.id, { f: a, x, y });
                for (const [dx, dy] of [
                    [schritt, 0],
                    [0, schritt],
                ] as const) {
                    if (!frei(x + dx, y + dy)) continue;
                    const b = eine(x + dx, y + dy);
                    if (b === undefined || a.id === b.id) continue;
                    zahl.paare += 1;
                    if (a.typ !== b.typ || a.name === "" || b.name === "" || a.name === b.name) continue;
                    return {
                        gefunden: { a, b, stelle: { x: rahmen.left + x + dx / 2, y: rahmen.top + y + dy / 2 } },
                        statistik: "",
                    };
                }
            }
        // Kein Stoß im Bild: zwei Landschaften derselben Art an verschiedenen Stellen (das Menü braucht nur die Mehrfachauswahl; die
        // Rechnung an Nachbarn prüft der Servertest).
        const liste = [...erste.values()];
        for (const [i, a] of liste.entries())
            for (const b of liste.slice(i + 1))
                if (a.f.typ === b.f.typ && a.f.name !== b.f.name)
                    return {
                        gefunden: { a: a.f, b: b.f, stelle: { x: rahmen.left + a.x, y: rahmen.top + a.y } },
                        statistik: "",
                    };
        return {
            gefunden: undefined,
            statistik: `${String(zahl.punkte)} Punkte, ${String(zahl.einzeln)} mit genau einer Fläche, ${String(zahl.namen.size)} Namen, ${String(zahl.paare)} Nachbarpaare`,
        };
    });
    expect(gefunden, `zwei aneinanderstoßende Landschaften derselben Art (${statistik})`).toBeDefined();
    return gefunden!;
}

export async function oeffne(
    page: Page,
    pruefung: (n: Nachbarn) => FlaechenVereinigenPruefung,
): Promise<{ server: { gefragt: string[]; geschrieben: unknown[] }; n: Nachbarn }> {
    const server = { gefragt: [] as string[], geschrieben: [] as unknown[] };
    // Die Nachbarn findet erst die geladene Karte; die Stubs lesen sie dann von hier.
    const stand: { n?: Nachbarn } = {};
    await stubAdmin(page, {
        capabilities: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        role: "editor",
    });
    await page.route("**/api/editor/status", (route) => json(route, { mapEditing: "testwelt" }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) =>
        route.request().method() === "GET" ? json(route, { locks: [] }) : json(route, { lost: [] }),
    );
    await page.route("**/api/editor/landscapes", (route) => {
        const zeilen: EditorLandscapeList["rows"] =
            stand.n === undefined
                ? []
                : [stand.n.a, stand.n.b].map((f, i) => ({
                      id: f.id,
                      name: f.name,
                      layer: "vegetation",
                      type: f.typ,
                      circle: "voll",
                      areas: 1,
                      labels: 1,
                      order: i + 1,
                  }));
        return json(route, { rows: zeilen, peaks: [] });
    });
    await page.route(/\/api\/editor\/landscapes\/vereinigen(\?.*)?$/, (route) => {
        if (route.request().method() === "POST") {
            // Was die Oberfläche schickt, muss der Server annehmen (Schema der Route), und seine Antwort hat die Form des Vertrags.
            const gesendet = vertragGilt(
                FlaechenVereinigenBody,
                route.request().postDataJSON(),
                "Die Anfrage der Oberfläche",
            );
            server.geschrieben.push(gesendet);
            return json(
                route,
                vertragGilt(
                    FlaechenVereinigenReceipt,
                    {
                        operationId: gesendet.operationId,
                        status: "applied",
                        environment: "test",
                        affected: [],
                        derivedWork: [],
                        warnings: [],
                        publicId: gesendet.vorlage,
                    },
                    "Die Antwort des Stubs",
                ),
            );
        }
        server.gefragt.push(route.request().url());
        return json(route, vertragGilt(FlaechenVereinigenPruefung, pruefung(stand.n!), "Die Prüfung des Stubs"));
    });
    await page.route(/\/api\/editor\/landscapes\/[0-9a-f-]{36}$/, (route) => {
        const id = /landscapes\/([^/?]+)/.exec(route.request().url())?.[1] ?? "";
        const f = stand.n === undefined ? undefined : [stand.n.a, stand.n.b].find((x) => x.id === id);
        return json(route, {
            id,
            name: f?.name ?? "Probe",
            layer: "vegetation",
            ...(f === undefined ? {} : { type: f.typ }),
            circle: "voll",
            order: 1,
            clickLocked: false,
            areas: [],
            labels: [],
            neighbors: [],
            revision: 1,
        } as EditorLandscapeDetail);
    });
    await openMap(
        page,
        `${EDITOR_MODE}#x=${String(LAND.x)}&y=${String(LAND.y)}&z=6.5&series=original&view=landscapes&layer=vegetation`,
    );
    await settleFrame(page);
    const n = await nachbarnDerKarte(page);
    stand.n = n;
    await editorPanelAuf(page);
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    return { server, n };
}

export const liste = (page: Page): Locator => page.getByTestId(/^landschaftseditor-fenster-\d+-landschaften$/);

/** Beide in der Liste anhaken (Mehrfachauswahl an, vorher Gewähltes lösen). */
export async function hakeBeideAn(page: Page, n: Nachbarn): Promise<void> {
    await liste(page)
        .getByTestId(/-landschaften-mehrfach$/)
        .click();
    const loesen = liste(page).getByTestId(/-landschaften-haken-loesen$/);
    if (await loesen.isVisible()) await loesen.click();
    for (const name of [n.a.name, n.b.name])
        await liste(page)
            .getByTestId(/-landschaften-zeile$/)
            .filter({ hasText: name })
            .first()
            .click();
}

/**
 * Eine Stelle der Karte, die gerade obenauf liegt (nicht unter Planer, Panel oder Fenster), nahe der Mitte der freien Fläche: dort geht das
 * Kartenmenü auf. Gesucht NACH dem Öffnen der Fenster; „Flächen vereinigen ›“ steht an jeder Stelle, solange die Mehrfachauswahl steht.
 * Lieber eine Stelle ohne Fläche, Weg und Ort: Dann trägt das Menü nur „Anlegen“ und passt aufs Telefon, ohne zu rollen.
 */
export async function freieStelle(page: Page): Promise<{ x: number; y: number }> {
    const stelle = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const leinwand = map.getCanvas();
        const rahmen = leinwand.getBoundingClientRect();
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        const belegt = (map.getStyle().layers ?? [])
            .map((l) => l.id)
            .filter((id) => /^(landscape-fill-|path-hit-|place-marker)/.test(id));
        let irgendeine: { x: number; y: number } | undefined;
        for (let r = 0; r < 500; r += 10)
            for (let w = 0; w < 360; w += 30) {
                const x = Math.round(mitte.x + r * Math.cos((w * Math.PI) / 180));
                const y = Math.round(mitte.y + r * Math.sin((w * Math.PI) / 180));
                if (x < 8 || y < 8 || x > leinwand.clientWidth - 8 || y > leinwand.clientHeight - 8) continue;
                if (document.elementFromPoint(rahmen.left + x, rahmen.top + y) !== leinwand) continue;
                const hier = { x: rahmen.left + x, y: rahmen.top + y };
                irgendeine ??= hier;
                if (map.queryRenderedFeatures([x, y], { layers: belegt }).length === 0) return hier;
            }
        return irgendeine;
    });
    expect(stelle, "eine freie Stelle der Karte").toBeDefined();
    return stelle!;
}

export const ebeneDa = (page: Page, id: string): Promise<boolean> =>
    page.evaluate((ebene) => globalThis.avesmapsMap?.getLayer(ebene) !== undefined, id);
