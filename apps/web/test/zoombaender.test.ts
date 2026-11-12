import { Value } from "@sinclair/typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { AdminZoombaender, composeView, renderZoomForBand, ZOOMBAND_SPUREN } from "@avesmaps3d/shared";
import { isMessageKey } from "../src/i18n/i18n.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as italiano } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { es } from "../src/i18n/es.ts";
import { pl } from "../src/i18n/pl.ts";
import { da } from "../src/i18n/da.ts";
import { sv } from "../src/i18n/sv.ts";
import {
    abweichendeSpannen,
    ebenenGrenzen,
    inSpanne,
    ladeZoombaender,
    mitSpanne,
    spannenBedingungen,
    zoombaenderSetzen,
    zoomspanne,
} from "../src/map/zoombaender-stand.ts";
import { buildPathLabelLayer, buildPathLayers } from "../src/map/path-layers.ts";
import { buildContourLayers, buildPeakLayer } from "../src/map/topography-layers.ts";
import { buildPowerlineLabelLayer } from "../src/map/powerline-layers.ts";
import { buildLandscapeRunLayer } from "../src/map/landscape-layers.ts";
import { buildPlaceLayers, nodixLabelLayerId } from "../src/map/place-layers.ts";
import { createZoombaender, panele, schienenWert, vonBisText, vorschau } from "../src/zoombaender/zoombaender.ts";

/**
 * Die Zoombänder im Browser (WI-0221): was die Karte aus den Abweichungen macht (Zeichen, Linien, Namen je Art), der Reiter ohne
 * Browser (Panele, Vorschau, Übernehmen gegen einen nachgebauten Server) und die Sprachtafeln.
 */

const NOW = new Date("2026-10-18T12:00:00Z");
afterEach(() => zoombaenderSetzen({}));

function stand(patch: Partial<AdminZoombaender> = {}): AdminZoombaender {
    const body: AdminZoombaender = {
        now: NOW.toISOString(),
        revision: 7,
        source: "database",
        zeilen: [],
        unknownKeys: [],
        ...patch,
    };
    expect(Value.Check(AdminZoombaender, body)).toBe(true);
    return body;
}

/** Der Filter einer Ebene (die Hintergrundebene hat keinen). */
const filterVon = (ebene: { type: string }): unknown => ("filter" in ebene ? ebene.filter : undefined);

/** Lässt ein Filter dieses Objekt auf diesem Zoom durch? (`["zoom"]` im Filter: ganzzahliger Kachelzoom.) */
const laesstDurch = (filter: unknown, zoom: number, properties: Record<string, unknown>): boolean =>
    featureFilter(filter as never, "filter").filter({ zoom }, { type: 2, properties } as never, undefined as never);

describe("die Spannen beim Start der Karte", () => {
    it("🔴 ohne Antwort gelten die Vorgaben; eine Antwort setzt die Abweichungen, Unpassendes fällt weg", async () => {
        await ladeZoombaender((async () => {
            throw new Error("offline");
        }) as unknown as typeof fetch);
        expect(zoomspanne("orte.dorf.name")).toEqual({ von: 5, bis: 8 });
        await ladeZoombaender(
            (async () =>
                new Response(
                    JSON.stringify({
                        abweichungen: { "orte.dorf.name": { von: 3, bis: 6 }, "orte.drache.name": { von: 1, bis: 2 } },
                    }),
                    { status: 200 },
                )) as unknown as typeof fetch,
        );
        expect(zoomspanne("orte.dorf.name")).toEqual({ von: 3, bis: 6 });
        expect(abweichendeSpannen("orte", "name")).toEqual({ dorf: { von: 3, bis: 6 } });
    });

    it("🔴 Grenzen einer Ebene: auf der Vorgabe bleibt der Kanonwert, verstellt die Bandgrenze; außerhalb kein Knoten", () => {
        const kanon = ebenenGrenzen("gelaende.hoehen500.linie", 4.5);
        expect(kanon).toEqual({ minzoom: 4.5 });
        zoombaenderSetzen({ "gelaende.hoehen500.linie": { von: 5, bis: 6 } });
        expect(ebenenGrenzen("gelaende.hoehen500.linie", 4.5)).toEqual({
            minzoom: renderZoomForBand(5),
            maxzoom: renderZoomForBand(7),
        });
        zoombaenderSetzen({ "orte.nodix.zeichen": { von: 2, bis: 5 } });
        expect(spannenBedingungen("orte.nodix.zeichen")).toEqual([
            [">=", ["zoom"], 3],
            ["<", ["zoom"], 7],
        ]);
        expect(inSpanne("orte.nodix.zeichen", 2.99)).toBe(false);
        expect(inSpanne("orte.nodix.zeichen", 3)).toBe(true);
        expect(inSpanne("orte.nodix.zeichen", 7)).toBe(false);
        // Eine Ebene mit eigenem `minzoom` wird nie früher sichtbar als vorher.
        zoombaenderSetzen({ "landschaften.flaechen.flaeche": { von: 1, bis: 6 } });
        const ebene = mitSpanne("landschaften.flaechen.flaeche")({ id: "x", type: "background", minzoom: 4 });
        expect(ebene).toMatchObject({ minzoom: 4, maxzoom: renderZoomForBand(7) });
    });
});

describe("was die Karte aus einer Abweichung macht", () => {
    it("🔴 Wegnamen je Art (Betreiber 2026-10-18): der Pfad nur zwischen 4 und 6, die Reichsstraße unberührt", () => {
        // Ohne Abweichung kennt der Filter nur die Arten, die die Karte nicht zeigt (Seewege), keinen Zoom.
        expect(JSON.stringify(filterVon(buildPathLabelLayer("x", {})))).not.toContain('"zoom"');
        zoombaenderSetzen({ "wege.Pfad.name": { von: 4, bis: 6 } });
        const filter = filterVon(buildPathLabelLayer("x", {}));
        expect(laesstDurch(filter, renderZoomForBand(3), { subtype: "Pfad" })).toBe(false);
        expect(laesstDurch(filter, renderZoomForBand(4), { subtype: "Pfad" })).toBe(true);
        expect(laesstDurch(filter, renderZoomForBand(7), { subtype: "Pfad" })).toBe(false);
        expect(laesstDurch(filter, renderZoomForBand(0), { subtype: "Reichsstrasse" })).toBe(true);
    });

    it("🔴 Bachnamen (Migration 0199): ein Bachlauf folgt der Spanne der Bäche, ein Flusslauf und ein Lauf ohne Merkmal der des Flusses", () => {
        zoombaenderSetzen({ "wege.bach.name": { von: 4, bis: 8 }, "wege.Flussweg.name": { von: 1, bis: 8 } });
        const filter = filterVon(buildPathLabelLayer("x", {}));
        expect(laesstDurch(filter, renderZoomForBand(3), { subtype: "Flussweg", is_bach: true })).toBe(false);
        expect(laesstDurch(filter, renderZoomForBand(4), { subtype: "Flussweg", is_bach: true })).toBe(true);
        expect(laesstDurch(filter, renderZoomForBand(2), { subtype: "Flussweg", is_bach: false })).toBe(true);
        // Vor der Neuableitung ist `is_bach` NULL: wie bisher die Spanne der Art.
        expect(laesstDurch(filter, renderZoomForBand(2), { subtype: "Flussweg" })).toBe(true);
        expect(laesstDurch(filter, renderZoomForBand(0), { subtype: "Flussweg" })).toBe(false);
    });

    it("🔴 Linien: die Spanne setzt `minzoom` und `maxzoom` der Ebene, früher erscheint die Linie mit ihrer ersten Breite", () => {
        const vorher = buildPathLayers({}).find((ebene) => ebene.id === "path-center-reichsstrasse");
        expect(vorher?.minzoom).toBe(renderZoomForBand(2));
        expect(vorher?.maxzoom).toBeUndefined();
        zoombaenderSetzen({ "wege.Reichsstrasse.linie": { von: 1, bis: 5 } });
        const nachher = buildPathLayers({}).find((ebene) => ebene.id === "path-center-reichsstrasse");
        expect(nachher?.minzoom).toBe(renderZoomForBand(1));
        expect(nachher?.maxzoom).toBe(renderZoomForBand(6));
        // Die Trefferfläche folgt der Linie.
        expect(buildPathLayers({}).find((ebene) => ebene.id === "path-hit-reichsstrasse")?.maxzoom).toBe(
            renderZoomForBand(6),
        );
    });

    it("Kraftlinien, Höhenlinien und Gipfel: auf der Vorgabe wie vorher, verstellt nach dem Band", () => {
        expect(buildPowerlineLabelLayer("x").minzoom).toBe(renderZoomForBand(2));
        const gipfel = buildPeakLayer("x", "names", "de");
        const nameNachSchalter = ["case", ["==", ["get", "show_name"], false], "", ["get", "name"]];
        expect(gipfel.layout?.["text-field"]).toEqual(nameNachSchalter);
        zoombaenderSetzen({
            "kraftlinien.kraftlinien.name": { von: 3, bis: 8 },
            "gelaende.hoehen1000.linie": { von: 3, bis: 8 },
            "gelaende.gipfel.name": { von: 6, bis: 8 },
        });
        expect(buildPowerlineLabelLayer("x").minzoom).toBe(renderZoomForBand(3));
        expect(buildContourLayers()[2]?.minzoom).toBe(renderZoomForBand(3));
        // Der Name des Gipfels kommt später als sein Zeichen: dieselbe Ebene, der Name erst ab Band 6.
        expect(buildPeakLayer("x", "names", "de").layout?.["text-field"]).toEqual([
            "step",
            ["zoom"],
            "",
            renderZoomForBand(6),
            nameNachSchalter,
        ]);
    });

    it("🔴 Landschaftsnamen je Art: nur verstellte Arten kommen in den Filter, zusätzlich zur Ebene", () => {
        expect(filterVon(buildLandscapeRunLayer("x", ["topographie"]))).toEqual([
            "in",
            ["get", "region_layer"],
            ["literal", ["topographie"]],
        ]);
        zoombaenderSetzen({ "landschaften.wald.name": { von: 5, bis: 8 } });
        const filter = filterVon(buildLandscapeRunLayer("x", ["vegetation"]));
        expect(laesstDurch(filter, renderZoomForBand(4), { region_layer: "vegetation", region_type: "wald" })).toBe(
            false,
        );
        expect(laesstDurch(filter, renderZoomForBand(5), { region_layer: "vegetation", region_type: "wald" })).toBe(
            true,
        );
        expect(laesstDurch(filter, renderZoomForBand(2), { region_layer: "vegetation", region_type: "steppe" })).toBe(
            true,
        );
    });

    it("Nodices: die Namen nur in ihrer Spanne", () => {
        zoombaenderSetzen({ "orte.nodix.name": { von: 3, bis: 8 } });
        const ebenen = buildPlaceLayers({ labels: true, composition: composeView("powerlines", "alle") });
        const name = ebenen.find((ebene) => ebene.id === nodixLabelLayerId("stadt", "right"));
        expect(name && "filter" in name).toBe(true);
        const filter = (name as { filter: unknown }).filter;
        const nodix = { subtype: "stadt", name: "Gareth", public_id: "p1" };
        expect(laesstDurch(filter, renderZoomForBand(2), nodix)).toBe(false);
        expect(laesstDurch(filter, renderZoomForBand(3), nodix)).toBe(true);
    });
});

describe("der Reiter ohne Browser", () => {
    it("🔴 sechs Panele nach Wirkort, je Zeile ihre Spuren; Herrschaftsgebiete nur zur Ansicht", () => {
        const sicht = panele(stand(), {}, 4, NOW);
        expect(sicht.map((panel) => panel.id)).toEqual([
            "orte",
            "wege",
            "landschaften",
            "gebiete",
            "kraftlinien",
            "gelaende",
        ]);
        const orte = sicht[0]!;
        expect(orte.zeilen[0]?.name).toBe("Metropolen");
        expect(orte.zeilen[0]?.spuren.map((spur) => [spur.name, vonBisText(spur.spanne)])).toEqual([
            ["Zeichen", "0 bis 8"],
            ["Name", "1 bis 8"],
        ]);
        const gebiete = sicht.find((panel) => panel.id === "gebiete")!;
        expect(gebiete.ansicht).toBe(true);
        expect(gebiete.zeilen.every((zeile) => zeile.spuren.every((spur) => spur.gesperrt !== undefined))).toBe(true);
        expect(vonBisText({ von: 2, bis: 2 })).toBe("nur 2");
        const alle = sicht.flatMap((panel) => panel.zeilen.flatMap((zeile) => zeile.spuren));
        expect(alle).toHaveLength(ZOOMBAND_SPUREN.length);
    });

    it("🔴 eine Abweichung zeigt, was sie braucht; die Vorschau zählt, was auf dem Band zu sehen ist", () => {
        const sicht = panele(
            stand({
                zeilen: [
                    {
                        id: "orte.dorf.name",
                        spanne: { von: 3, bis: 8 },
                        changedAt: "2026-10-18T11:00:00Z",
                        changedBy: "Rondrikan",
                    },
                ],
            }),
            { "landschaften.wald.name": { von: 2, bis: 8 } },
            0,
            NOW,
        );
        const dorf = sicht[0]!.zeilen.find((zeile) => zeile.key === "orte.dorf")!;
        expect(dorf.spuren[1]?.folge).toBe("Wirkt beim nächsten Laden der Karte.");
        expect(dorf.zuruecksetzbar).toBe(true);
        expect(dorf.stand).toContain("Rondrikan");
        const wald = sicht
            .find((panel) => panel.id === "landschaften")!
            .zeilen.find((zeile) => zeile.key === "landschaften.wald")!;
        expect(wald.spuren[0]?.geaendert).toBe(true);
        expect(wald.spuren[0]?.folge).toContain("Namensläufe");
        // Auf Band 0: Metropolen ja, Dörfer nicht.
        expect(sicht[0]!.zeilen.find((zeile) => zeile.key === "orte.metropole")?.blass).toBe(false);
        expect(dorf.blass).toBe(true);
        const { sichtbar, alle } = vorschau(sicht);
        expect(sichtbar).toBeGreaterThan(0);
        expect(sichtbar).toBeLessThan(alle);
        expect(schienenWert(stand())).toBeUndefined();
        expect(
            schienenWert(
                stand({
                    zeilen: [
                        {
                            id: "orte.dorf.name",
                            spanne: { von: 3, bis: 8 },
                            changedAt: NOW.toISOString(),
                            changedBy: null,
                        },
                    ],
                }),
            ),
        ).toBe("1 verstellt");
    });
});

type Answer = { status: number; body?: unknown };
function server(...answers: Answer[]) {
    const calls: { url: string; method: string; body: Record<string, unknown> | undefined }[] = [];
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        calls.push({
            url: String(url),
            method: init?.method ?? "GET",
            body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        });
        const answer = answers.shift() ?? { status: 500 };
        return new Response(answer.body === undefined ? "" : JSON.stringify(answer.body), { status: answer.status });
    };
    return { calls, fetcher: fetcher as typeof fetch };
}
const RECEIPT: Answer = {
    status: 200,
    body: { operationId: "x", status: "applied", environment: "test", affected: [], derivedWork: [], warnings: [] },
};

describe("Übernehmen", () => {
    it("🔴 alle geänderten Spannen in EINEM Schreibweg; die Vorgabe geht als null hinaus; danach liest die Karte neu", async () => {
        const gespeichert = stand({
            zeilen: [
                { id: "orte.dorf.name", spanne: { von: 3, bis: 8 }, changedAt: NOW.toISOString(), changedBy: "R" },
            ],
        });
        const { calls, fetcher } = server({ status: 200, body: gespeichert }, RECEIPT, {
            status: 200,
            body: stand({ revision: 8 }),
        });
        let nachgeladen = 0;
        const h = createZoombaender({ fetcher, ask: async () => true, nachladen: async () => void (nachgeladen += 1) });
        await h.load();
        h.setze("wege.Pfad.name", { von: 4, bis: 6 });
        h.zuruecksetzen("orte.dorf");
        // Eine Spur nur zur Ansicht nimmt der Entwurf nicht an.
        h.setze("gebiete.reiche.flaeche", { von: 0, bis: 4 });
        expect(h.geaenderte().map((g) => g.id)).toEqual(["wege.Pfad.name", "orte.dorf.name"]);
        expect(await h.uebernehmen()).toBe(true);
        const posts = calls.filter((call) => call.method === "POST");
        expect(posts).toHaveLength(1);
        expect(posts[0]?.body).toMatchObject({
            baseRevision: 7,
            aenderungen: [
                { id: "wege.Pfad.name", spanne: { von: 4, bis: 6 } },
                { id: "orte.dorf.name", spanne: null },
            ],
        });
        expect(h.entwurf.value).toEqual({});
        expect(nachgeladen).toBe(1);
        expect(h.stand.value?.revision).toBe(8);
    });

    it("ein veralteter Stand meldet, wer schneller war, und behält den Entwurf", async () => {
        const { fetcher } = server(
            { status: 200, body: stand() },
            {
                status: 409,
                body: {
                    error: {
                        code: "edit_conflict",
                        message: "x",
                        details: { changedBy: { displayName: "Alrike" }, changedAt: NOW.toISOString() },
                    },
                },
            },
            { status: 200, body: stand({ revision: 9 }) },
        );
        const h = createZoombaender({ fetcher, ask: async () => true, nachladen: async () => undefined });
        await h.load();
        h.setze("wege.Pfad.name", { von: 4, bis: 6 });
        expect(await h.uebernehmen()).toBe(false);
        expect(h.ergebnis.value?.conflict?.by).toBe("Alrike");
        expect(h.entwurf.value).toEqual({ "wege.Pfad.name": { von: 4, bis: 6 } });
    });
});

describe("Sprachtafeln", () => {
    it("🔴 jede Spur, jede Zeile und jedes Panel hat seinen Text in allen neun Sprachen", () => {
        const tafeln = { de, en, fr, nl, it: italiano, es, pl, da, sv } as Record<string, Record<string, string>>;
        const schluessel = new Set<string>([
            "admin.tab.zoombaender",
            "admin.foot.zoombaender",
            "admin.event.system.zoom_band_changed",
        ]);
        for (const spur of ZOOMBAND_SPUREN) {
            schluessel.add(`admin.zoombaender.spur.${spur.spur}`);
            schluessel.add(`admin.zoombaender.panel.${spur.gruppe}.title`);
            schluessel.add(`admin.zoombaender.panel.${spur.gruppe}.effect`);
            if (spur.nurAnsicht !== undefined) schluessel.add(`admin.zoombaender.viewOnly.${spur.nurAnsicht}`);
            // Landschaftsarten tragen den Namen ihrer Tafel (`landscape.type.*`), nur die Flächen einen eigenen.
            if (spur.gruppe !== "landschaften" || !isMessageKey(`landscape.type.${spur.zeile}`))
                schluessel.add(`admin.zoombaender.zeile.${spur.gruppe}.${spur.zeile}`);
        }
        for (const folge of ["stil", "namen", "kacheln"]) schluessel.add(`admin.zoombaender.folge.${folge}`);
        for (const key of schluessel) {
            expect(isMessageKey(key), key).toBe(true);
            for (const [sprache, tafel] of Object.entries(tafeln))
                expect(tafel[key], `${sprache}: ${key}`).toBeTruthy();
        }
    });
});
