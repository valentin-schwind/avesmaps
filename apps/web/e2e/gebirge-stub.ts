import { expect, type Locator, type Page, type Route } from "@playwright/test";
import {
    GEBIRGS_PRESETS_VORGABE,
    type EditorGebirge,
    type EditorGebirgeProfile,
    type EditorLandscapeDetail,
    type LandscapeUpdateBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Ein Gebirge aus Stubs für den Kammeditor (WI-0249 P9, OPS-000045): Liste, Detail, Gebirge, Sperre und `landscape.update` kommen aus
 * `page.route`. 🔴 Kein Test schreibt in die Datenbank der Entwicklung; den Schreibweg prüfen die Servertests als App-Rolle.
 */
export interface GebirgeStub {
    readonly detail: EditorLandscapeDetail;
    readonly gelesen: EditorGebirge;
    /** Die Höhenprofile der Flüsse (WI-0259): ohne Angabe „nicht verfügbar“, der Reiter zeigt dann keine Kurven. */
    readonly profil?: EditorGebirgeProfile;
}

const GEBIRGE = "a5a5a5a5-0000-4000-8000-000000000101";
const FLAECHE = "a5a5a5a5-0000-4000-8000-0000000001a1";
const ZINNE = "a5a5a5a5-0000-4000-8000-0000000001b1";

/** Das Probegebirge (26 × 36 E bei 440/502) mit einer Probezinne; mit `netz` steht schon ein Netz im Bestand. */
export function probegebirge(
    netz: EditorGebirge["stand"]["netz"] = { kaemme: [], nebengipfel: [] },
    /** Flüsse und Seen der Eingabe (WI-0249: im Kammeditor erkannt); ohne Angabe keine. */
    wasser: Pick<EditorGebirge["eingabe"], "fluesse" | "seen"> = { fluesse: [], seen: [] },
    /** Die Höhenprofile der Flüsse in der Folge von `wasser.fluesse` (WI-0259); ohne Angabe nicht verfügbar. */
    profil?: EditorGebirgeProfile,
): GebirgeStub {
    const ring: [number, number][] = [
        [440, 502],
        [466, 502],
        [466, 538],
        [440, 538],
    ];
    const stand: EditorGebirge["stand"] = {
        typ: null,
        muster: null,
        kammhoehe: 4000,
        werte: {},
        modell: {},
        netz,
        revision: 1,
    };
    const detail: EditorLandscapeDetail = {
        id: GEBIRGE,
        name: "Probegebirge",
        layer: "topographie",
        type: "gebirge",
        circle: "halb-rechts",
        order: 10,
        clickLocked: false,
        areas: [{ id: FLAECHE, polygons: [[ring]], affectsPaths: true, revision: 1, gebirge: stand }],
        labels: [],
        neighbors: [],
        peaks: [
            { id: ZINNE, name: "Probezinne", subtype: "berggipfel", height: 3200, position: [450, 520], revision: 2 },
        ],
        revision: 1,
    };
    const gelesen: EditorGebirge = {
        area: FLAECHE,
        eingabe: {
            bounds: { min_x: 440, min_y: 502, max_x: 466, max_y: 538 },
            geometry: { type: "Polygon", coordinates: [[...ring, ring[0]!]] },
            peaks: [{ x: 450, y: 520, h: 3200 }],
            kurve: null,
            fluesse: wasser.fluesse,
            seen: wasser.seen,
            saat: 7,
        } as EditorGebirge["eingabe"],
        stand,
        grundhoehe: 1500,
        presets: { quelle: "vorgabe", fassung: 18, gruppe: GEBIRGS_PRESETS_VORGABE },
    };
    return { detail, gelesen, ...(profil === undefined ? {} : { profil }) };
}

/** Öffnet das Gebirge im Landschaftseditor (Liste → Eintrag); gibt die gesendeten `landscape.update` zurück. */
export async function oeffneGebirge(
    page: Page,
    stub: GebirgeStub,
    pfad: string = EDITOR_MODE,
    /** Rechte, die dieser Sitzung fehlen (WI-0279, Paket 6: `sonderrollen-sperre.spec.ts`). */
    ohne: readonly string[] = [],
): Promise<LandscapeUpdateBody[]> {
    const { detail, gelesen, profil } = stub;
    const flaeche = detail.areas[0]!.id;
    const gesendet: LandscapeUpdateBody[] = [];
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
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
        ].filter((recht) => !ohne.includes(recht)),
        role: "editor",
    });
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    const [minX, minY, maxX, maxY] = [
        gelesen.eingabe.bounds.min_x,
        gelesen.eingabe.bounds.min_y,
        gelesen.eingabe.bounds.max_x,
        gelesen.eingabe.bounds.max_y,
    ];
    await page.route("**/api/editor/landscapes", (route) =>
        json(route, 200, {
            rows: [
                {
                    id: detail.id,
                    name: detail.name,
                    layer: "topographie",
                    type: "gebirge",
                    circle: "halb-rechts",
                    areas: 1,
                    labels: 0,
                    order: 10,
                    bounds: [minX, minY, maxX, maxY],
                },
            ],
        }),
    );
    await page.route(`**/api/editor/landscapes/${detail.id}`, (route) => {
        if (route.request().method() !== "PATCH") return json(route, 200, detail);
        gesendet.push(route.request().postDataJSON() as LandscapeUpdateBody);
        const quittung: OperationReceipt = {
            operationId: "op",
            status: "applied",
            environment: "test",
            affected: [{ kind: "terrain_control", id: flaeche }],
            derivedWork: [],
            warnings: [],
            mapRevision: 902,
        };
        return json(route, 200, quittung);
    });
    await page.route(`**/api/editor/gebirge/${flaeche}`, (route) => json(route, 200, gelesen));
    await page.route(`**/api/editor/gebirge/${flaeche}/profile`, (route) =>
        json(
            route,
            200,
            profil ?? {
                verfuegbar: false,
                fluesse: [],
                paesse: [],
                objekte: { fluesse: [], seen: [], paesse: [] },
            },
        ),
    );
    await page.route(`**/api/editor/landscapes/${detail.id}/history**`, (route) => json(route, 200, { entries: [] }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return json(route, 200, { locks: [] });
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return json(route, 200, { lost: [] });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        return json(route, 200, {
            lock: {
                ...body,
                person: { id: "a5a5a5a5-0000-4000-8000-0000000001f1", name: "Rondrikan" },
                since: "2026-10-24T12:00:00.000Z",
                heartbeatAt: "2026-10-24T12:00:00.000Z",
                own: true,
            },
        });
    });
    await openMap(page, pfad);
    if ((page.viewportSize()?.width ?? 1920) >= 768) await editorPanelVorn(page);
    else {
        // Am Telefon trägt das offene Panel keine Lasche mehr (`editor-panel.touch.spec.ts`).
        await page.getByTestId("editor-panel-tab").click();
        await expect(page.getByTestId("editor-panel")).toBeVisible();
    }
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    await page
        .locator('[data-testid^="landschaftseditor-"][data-testid$="-liste"]')
        .getByRole("option", { name: new RegExp(detail.name) })
        .click();
    return gesendet;
}

/** Ein Element im Reiter „Gebirge“ des offenen Fensters. */
export const gebirgeKennung = (page: Page, rest: string): Locator =>
    page.getByTestId(new RegExp(`^landschaftseditor-fenster-\\d+-gebirge${rest}$`));

/** Ein Punkt der Karte (Karteneinheiten) in Seitenkoordinaten. */
export function aufSeite(page: Page, punkt: { x: number; y: number }): Promise<{ x: number; y: number }> {
    return page.evaluate((pt) => {
        const map = globalThis.avesmapsMap!;
        const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(pt));
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, punkt);
}

/** Was an einer Stelle der Seite oben liegt: „Karte“ oder das Element mit seiner nächsten Kennung (für eine lesbare Meldung). */
export function obenAn(page: Page, at: { x: number; y: number }): Promise<string> {
    return page.evaluate(
        ([x, y]) => {
            const e = document.elementFromPoint(x!, y!);
            if (e === globalThis.avesmapsMap!.getCanvas()) return "Karte";
            return `${e?.tagName ?? "nichts"} ${e?.closest("[data-testid]")?.getAttribute("data-testid") ?? ""}`;
        },
        [at.x, at.y],
    );
}

/** Die Fläche in die Mitte der FREIEN Fläche (neben dem angedockten Fenster), damit jeder Klick die Karte trifft. */
export async function insFreie(page: Page, punkt: { x: number; y: number }, zoom: number): Promise<void> {
    await page.evaluate(
        ([p, z]) => {
            const map = globalThis.avesmapsMap!;
            map.jumpTo({
                center: globalThis.avesmapsRenderProjection!.toRenderLngLat(p as { x: number; y: number }),
                zoom: z as number,
            });
            const frei = globalThis.avesmapsVisibleArea!.centre();
            const jetzt = map.project(map.getCenter());
            map.jumpTo({ center: map.unproject([2 * jetzt.x - frei.x, 2 * jetzt.y - frei.y]) });
        },
        [punkt, zoom] as const,
    );
}
