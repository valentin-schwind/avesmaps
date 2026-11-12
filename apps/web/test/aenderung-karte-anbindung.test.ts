import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, SEARCH_FIT_MAX_ZOOM, placeNearZoom, renderBounds } from "@avesmaps3d/shared";
import { kartenBild, type KartenGegenstand } from "../src/aenderungen/aenderung-karte-modell";
import { bildAusLage } from "../src/aenderungen/aenderung-lage-modell";
import {
    kartenAnzeige,
    kartenWunsch,
    schliesseKarte,
    setzeKartenAnzeige,
    zeigeAufKarte,
} from "../src/aenderungen/karte-ablage";
import { createEscapeCascade } from "../src/keyboard/escape-cascade";
import { OVERLAY_EBENEN, OVERLAY_EBENEN_LISTE, OVERLAY_QUELLE } from "../src/map/aenderungen-overlay-formen";
import { fillZoom } from "../src/map/camera/visible-area";

/**
 * Die Anbindung von „Vorher und Nachher“ an die Karte (WI-0265 B5b), gegen eine nachgebaute Karte: Das Detail legt sein Bild in die Ablage, und die Karte
 * bekommt Quelle und Ebenen, fliegt über `camera.ts` auf den Ausschnitt, zeigt die Leiste und nimmt alles auf Esc, beim Schließen und mit der Karte selbst
 * wieder weg. Das Bauteil der Leiste ist ersetzt (dieses Vitest kennt keine .vue-Dateien); wie sie aussieht, prüft die Sichtprüfung.
 */

const gerendert: unknown[] = [];
vi.mock("../src/map/aenderungen-overlay-leiste.vue", () => ({ default: { name: "AenderungenOverlayLeiste" } }));
vi.mock("vue", async (original) => {
    const vue = await original<typeof import("vue")>();
    return {
        ...vue,
        h: (art: unknown, props: unknown) => ({ art, props }),
        render: (knoten: unknown) => {
            gerendert.push(knoten);
        },
    };
});

const { installAenderungenKarte } = await import("../src/map/aenderungen-overlay");

interface Ereignisse {
    [name: string]: ((...argumente: unknown[]) => void)[];
}

/** Eine Karte, die nur kann, was die Anbindung braucht. */
/** Der Zaun der Karte in Renderkoordinaten: Aventurien (`maxBounds` der Seite). */
const ZAUN = (() => {
    const grenzen = renderBounds(AVENTURIA.coordinateSpace);
    return {
        west: grenzen.southWest.lng,
        south: grenzen.southWest.lat,
        east: grenzen.northEast.lng,
        north: grenzen.northEast.lat,
    };
})();

function falscheKarte(leinwand: { width: number; height: number } = { width: 1920, height: 1034 }) {
    const quellen = new Map<string, { data: unknown }>();
    const ebenen = new Map<string, { sichtbar: string }>();
    const ereignisse: Ereignisse = {};
    const angemeldet = new Set<string>();
    const anhang: unknown[] = [];
    const behaelter = {
        appendChild: (kind: unknown) => anhang.push(kind),
    };
    const karte = {
        style: { _loaded: true },
        getContainer: () => behaelter,
        getMaxBounds: () => ({
            getWest: () => ZAUN.west,
            getSouth: () => ZAUN.south,
            getEast: () => ZAUN.east,
            getNorth: () => ZAUN.north,
        }),
        getCanvas: () => ({ clientWidth: leinwand.width, clientHeight: leinwand.height }),
        getSource: (id: string) => {
            const quelle = quellen.get(id);
            return quelle === undefined ? undefined : { setData: (daten: unknown) => (quelle.data = daten) };
        },
        addSource: (id: string, spec: { data: unknown }) => quellen.set(id, { data: spec.data }),
        removeSource: (id: string) => quellen.delete(id),
        getLayer: (id: string) => (ebenen.has(id) ? { id } : undefined),
        addLayer: (spec: { id: string }) => ebenen.set(spec.id, { sichtbar: "visible" }),
        removeLayer: (id: string) => ebenen.delete(id),
        setLayoutProperty: (id: string, eigenschaft: string, wert: string) => {
            if (eigenschaft === "visibility") ebenen.get(id)!.sichtbar = wert;
        },
        on: (name: string, hoerer: (...argumente: unknown[]) => void) => {
            angemeldet.add(name);
            return (ereignisse[name] ??= []).push(hoerer);
        },
        off: (name: string, hoerer: (...argumente: unknown[]) => void) => {
            ereignisse[name] = (ereignisse[name] ?? []).filter((x) => x !== hoerer);
        },
        once: (name: string, hoerer: (...argumente: unknown[]) => void) => {
            const einmal = (...argumente: unknown[]): void => {
                karte.off(name, einmal);
                hoerer(...argumente);
            };
            karte.on(name, einmal);
        },
        feuer: (name: string) => [...(ereignisse[name] ?? [])].forEach((hoerer) => hoerer()),
    };
    return { karte, quellen, ebenen, anhang, angemeldet };
}

const weg: KartenGegenstand = {
    kind: "path",
    zeilen: [
        {
            feld: "geometry",
            vorher: [
                [100, 200],
                [140, 230],
            ],
            nachher: [
                [100, 200],
                [150, 240],
            ],
            hatVorher: true,
            formFehlt: false,
            omitted: false,
        },
    ],
};
const BILD = kartenBild([weg]);

function aufbau(
    telefon = false,
    umgebung: {
        leinwand?: { width: number; height: number };
        gedeckt?: { top: number; right: number; bottom: number; left: number };
        frei?: () => { left?: number; right?: number };
    } = {},
) {
    const falsch = falscheKarte(umgebung.leinwand);
    const flug = vi.fn(() => Promise.resolve(true));
    const reihenfolge: string[] = [];
    const panel = {
        zu: vi.fn(() => reihenfolge.push("panel-zu")),
        auf: vi.fn(() => reihenfolge.push("panel-auf")),
    };
    flug.mockImplementation(() => {
        reihenfolge.push("flug");
        return Promise.resolve(true);
    });
    const kaskade = createEscapeCascade();
    const anbindung = installAenderungenKarte(falsch.karte as unknown as MapLibreMap, {
        camera: () => ({ showBounds: flug }),
        area:
            umgebung.gedeckt === undefined
                ? undefined
                : ({
                      keepFree: () => umgebung.gedeckt,
                      onChange: () => () => undefined,
                      onCovered: () => () => undefined,
                  } as unknown as Parameters<typeof installAenderungenKarte>[1]["area"]),
        escape: kaskade,
        phone: () => telefon,
        panel,
        ...(umgebung.frei === undefined ? {} : { frei: umgebung.frei }),
    });
    return { ...falsch, flug, panel, kaskade, anbindung, reihenfolge };
}

beforeEach(() => {
    gerendert.length = 0;
    vi.stubGlobal("document", {
        createElement: () => ({
            style: {},
            className: "",
            parentElement: null,
            remove() {},
        }),
    });
    vi.stubGlobal("requestAnimationFrame", (aufruf: () => void) => setTimeout(aufruf, 0));
    vi.stubGlobal("cancelAnimationFrame", (nummer: number) => clearTimeout(nummer));
    schliesseKarte();
    setzeKartenAnzeige("beide");
});

afterEach(() => {
    schliesseKarte();
    vi.unstubAllGlobals();
});

describe("Zeigen", () => {
    it("legt Quelle und alle Ebenen an, setzt die Daten und fliegt über die Kamera auf den Ausschnitt, höchstens so nah wie auf einen Weg", async () => {
        const { quellen, ebenen, flug } = aufbau();
        zeigeAufKarte("a", BILD);
        expect(quellen.has(OVERLAY_QUELLE)).toBe(true);
        expect([...ebenen.keys()].sort()).toEqual([...OVERLAY_EBENEN_LISTE].sort());
        await nextTick();
        expect(flug).toHaveBeenCalledTimes(1);
        const [grenzen, optionen] = flug.mock.calls[0] as unknown as [number[][], { maxZoom: number }];
        expect(grenzen).toHaveLength(2);
        expect(optionen.maxZoom).toBe(SEARCH_FIT_MAX_ZOOM.weg);
    });

    it("zeigt die Leiste mit der Anzeige „Beide“ und den Sätzen des Bildes", () => {
        aufbau();
        zeigeAufKarte("a", BILD);
        const leiste = gerendert.at(-1) as { props: { anzeige: string; hinweise: unknown; telefon: boolean } };
        expect(leiste.props.anzeige).toBe("beide");
        expect(leiste.props.hinweise).toBe(BILD.hinweise);
        expect(leiste.props.telefon).toBe(false);
    });

    it("ein zweites Bild ersetzt das erste, ohne die Ebenen doppelt anzulegen", () => {
        const { quellen, ebenen } = aufbau();
        zeigeAufKarte("a", BILD);
        const erste = quellen.get(OVERLAY_QUELLE)!.data;
        zeigeAufKarte("b", kartenBild([{ ...weg, kind: "path" }, weg]));
        expect(quellen.get(OVERLAY_QUELLE)!.data).not.toBe(erste);
        expect(ebenen.size).toBe(OVERLAY_EBENEN_LISTE.length);
    });

    it("ohne Kamera (sie entsteht nach der Karte) bleibt der Flug aus, die Überlagerung steht trotzdem", async () => {
        const falsch = falscheKarte();
        installAenderungenKarte(falsch.karte as unknown as MapLibreMap, {
            camera: () => undefined,
            area: undefined,
            escape: createEscapeCascade(),
            phone: () => false,
            panel: { zu: vi.fn(), auf: vi.fn() },
        });
        zeigeAufKarte("a", BILD);
        await nextTick();
        expect(falsch.ebenen.size).toBe(OVERLAY_EBENEN_LISTE.length);
    });
});

describe("Anzeige", () => {
    it("Vorher blendet die Seite Nachher und die Verbindung aus, Beide bringt alles zurück", () => {
        const { ebenen } = aufbau();
        zeigeAufKarte("a", BILD);
        setzeKartenAnzeige("vorher");
        expect(ebenen.get(OVERLAY_EBENEN.vorherLinie)!.sichtbar).toBe("visible");
        expect(ebenen.get(OVERLAY_EBENEN.nachherLinie)!.sichtbar).toBe("none");
        expect(ebenen.get(OVERLAY_EBENEN.verschiebung)!.sichtbar).toBe("none");
        setzeKartenAnzeige("nachher");
        expect(ebenen.get(OVERLAY_EBENEN.vorherLinie)!.sichtbar).toBe("none");
        expect(ebenen.get(OVERLAY_EBENEN.nachherLinie)!.sichtbar).toBe("visible");
        setzeKartenAnzeige("beide");
        expect([...ebenen.values()].every((ebene) => ebene.sichtbar === "visible")).toBe(true);
    });

    it("die Leiste bekommt die neue Anzeige", () => {
        aufbau();
        zeigeAufKarte("a", BILD);
        setzeKartenAnzeige("nachher");
        expect((gerendert.at(-1) as { props: { anzeige: string } }).props.anzeige).toBe("nachher");
    });
});

describe("Entfernen", () => {
    it("Schließen nimmt Ebenen, Quelle und Leiste weg", () => {
        const { ebenen, quellen } = aufbau();
        zeigeAufKarte("a", BILD);
        schliesseKarte();
        expect(ebenen.size).toBe(0);
        expect(quellen.size).toBe(0);
        expect(gerendert.at(-1)).toBeNull();
    });

    it("Esc nimmt sie weg und verbraucht die Taste, ohne Überlagerung gibt Esc die Taste weiter", () => {
        const { kaskade, ebenen } = aufbau();
        expect(kaskade.run()).toBeUndefined();
        zeigeAufKarte("a", BILD);
        expect(kaskade.run()).toBe("action");
        expect(kartenWunsch.value).toBeUndefined();
        expect(ebenen.size).toBe(0);
        expect(kaskade.run()).toBeUndefined();
    });

    it("🔴 Klicks gehen durch: Die Anbindung meldet sich nirgends für Zeiger an (keine Handler an der Karte außer Größe und Stil)", () => {
        const { angemeldet } = aufbau();
        zeigeAufKarte("a", BILD);
        expect([...angemeldet].sort()).toEqual(["remove", "resize", "styledata"]);
    });

    it("mit der Karte (`remove`) räumt sich alles ab, auch die Esc-Anmeldung", () => {
        const { karte, kaskade, ebenen } = aufbau();
        zeigeAufKarte("a", BILD);
        karte.feuer("remove");
        expect(ebenen.size).toBe(0);
        zeigeAufKarte("b", BILD);
        expect(ebenen.size).toBe(0);
        expect(kaskade.run()).toBeUndefined();
    });
});

describe("Stilwechsel", () => {
    it("ein neuer Stil nimmt Quelle und Ebenen mit; im nächsten Bild sind sie wieder da", async () => {
        const { karte, ebenen, quellen } = aufbau();
        zeigeAufKarte("a", BILD);
        ebenen.clear();
        quellen.clear();
        karte.feuer("styledata");
        await new Promise((fertig) => setTimeout(fertig, 5));
        expect(quellen.has(OVERLAY_QUELLE)).toBe(true);
        expect(ebenen.size).toBe(OVERLAY_EBENEN_LISTE.length);
    });

    it("ohne Überlagerung legt ein Stilwechsel nichts an", async () => {
        const { karte, ebenen } = aufbau();
        karte.feuer("styledata");
        await new Promise((fertig) => setTimeout(fertig, 5));
        expect(ebenen.size).toBe(0);
    });
});

describe("Telefon", () => {
    it("blendet das Panel weg, BEVOR die Kamera fliegt, damit die Karte frei ist; die Leiste trägt den Rückweg", async () => {
        const { reihenfolge, panel } = aufbau(true);
        zeigeAufKarte("a", BILD);
        await nextTick();
        await nextTick();
        expect(reihenfolge).toEqual(["panel-zu", "flug"]);
        expect(panel.auf).not.toHaveBeenCalled();
        const leiste = gerendert.at(-1) as { props: { telefon: boolean; onZumDetail: () => void } };
        expect(leiste.props.telefon).toBe(true);
    });

    it("„Zum Detail“ holt das Panel zurück und nimmt die Überlagerung mit", async () => {
        const { panel, ebenen } = aufbau(true);
        zeigeAufKarte("a", BILD);
        await nextTick();
        (gerendert.at(-1) as { props: { onZumDetail: () => void } }).props.onZumDetail();
        expect(panel.auf).toHaveBeenCalledTimes(1);
        expect(ebenen.size).toBe(0);
        expect(kartenWunsch.value).toBeUndefined();
    });

    it("am Rechner bleibt das Panel, wo es ist", async () => {
        const { panel, flug } = aufbau(false);
        zeigeAufKarte("a", BILD);
        await nextTick();
        expect(panel.zu).not.toHaveBeenCalled();
        expect(flug).toHaveBeenCalledTimes(1);
    });
});

it("die Anzeige beginnt jeden Wunsch bei „Beide“", () => {
    aufbau();
    setzeKartenAnzeige("vorher");
    zeigeAufKarte("a", BILD);
    expect(kartenAnzeige.value).toBe("beide");
});

describe("der heutige Ort (WI-0265 B9)", () => {
    const ORT = bildAusLage({ grenzen: [80, 90, 80, 90], gegenstaende: 1, stillgelegt: 0 })!;
    const STILL = bildAusLage({ grenzen: [100, 200, 160, 260], gegenstaende: 2, stillgelegt: 1 })!;

    it("🔴 ein Punkt fliegt so nah wie an einen Ort und mindestens so nah, in einen Kasten mit Fläche; Quelle und Ebenen wie sonst", async () => {
        const { quellen, ebenen, flug } = aufbau();
        zeigeAufKarte("a", ORT, "liste");
        expect(quellen.has(OVERLAY_QUELLE)).toBe(true);
        expect([...ebenen.keys()].sort()).toEqual([...OVERLAY_EBENEN_LISTE].sort());
        await nextTick();
        const [grenzen, optionen] = flug.mock.calls[0] as unknown as [
            number[][],
            { maxZoom: number; minZoom?: number },
        ];
        expect(grenzen[1]![0]).toBeGreaterThan(grenzen[0]![0]!);
        expect(optionen.maxZoom).toBe(placeNearZoom(undefined));
        expect(optionen.minZoom).toBe(placeNearZoom(undefined));
    });

    it("ein Kasten fliegt wie Vorher und Nachher: höchstens so nah wie auf einen Weg, nie weiter hinaus als das Kartenbild die freie Fläche füllt", async () => {
        const { flug } = aufbau();
        zeigeAufKarte("a", STILL);
        await nextTick();
        const [, optionen] = flug.mock.calls[0] as unknown as [number[][], { maxZoom: number; minZoom?: number }];
        // Ohne Panels ist die freie Fläche die ganze Karte (1920 × 1034).
        expect(optionen).toEqual({
            maxZoom: SEARCH_FIT_MAX_ZOOM.weg,
            minZoom: fillZoom(ZAUN, { width: 1920, height: 1034 }),
        });
    });

    it("🔴 (B9c) die Füllstufe misst an der freien Fläche: Planer links und Editorpanel rechts nehmen von der Fläche, das Telefon hat eine kleinere, also tiefere Stufe", async () => {
        const GANZ = bildAusLage({ grenzen: [6, 10, 1018, 1012], gegenstaende: 608, stillgelegt: 0 })!;
        const rechner = aufbau(false, { gedeckt: { top: 0, right: 400, bottom: 0, left: 350 } });
        zeigeAufKarte("a", GANZ, "liste");
        await nextTick();
        const minRechner = (rechner.flug.mock.calls[0] as unknown as [number[][], { minZoom?: number }])[1].minZoom;
        expect(minRechner).toBe(fillZoom(ZAUN, { width: 1170, height: 1034 }));
        schliesseKarte();
        const telefon = aufbau(true, { leinwand: { width: 412, height: 915 } });
        zeigeAufKarte("b", GANZ, "liste");
        await nextTick();
        const minTelefon = (telefon.flug.mock.calls[0] as unknown as [number[][], { minZoom?: number }])[1].minZoom;
        expect(minTelefon).toBe(fillZoom(ZAUN, { width: 412, height: 915 }));
        expect(minTelefon!).toBeLessThan(minRechner!);
    });

    it("(B9c) ein angedocktes Editorfenster (`frei`) verkleinert die Fläche, wo daneben noch eine Lücke bleibt; sonst gilt, was die Panels decken, wie bei der Kamera", async () => {
        const GANZ = bildAusLage({ grenzen: [6, 10, 1018, 1012], gegenstaende: 608, stillgelegt: 0 })!;
        const gedeckt = { top: 0, right: 0, bottom: 0, left: 350 };
        const mitFenster = aufbau(false, { gedeckt, frei: () => ({ right: 960 }) });
        zeigeAufKarte("a", GANZ);
        await nextTick();
        const [, mitFensterOptionen] = mitFenster.flug.mock.calls[0] as unknown as [
            number[][],
            { minZoom?: number; free?: unknown },
        ];
        expect(mitFensterOptionen.minZoom).toBe(fillZoom(ZAUN, { width: 1920 - 350 - 960, height: 1034 }));
        expect(mitFensterOptionen.free).toEqual({ right: 960 });
        schliesseKarte();
        // Deckt das Fenster fast alles (keine Lücke mehr), gilt wie bei der Kamera nur, was die Panels decken.
        const ohneLuecke = aufbau(false, { gedeckt, frei: () => ({ right: 1550 }) });
        zeigeAufKarte("b", GANZ);
        await nextTick();
        const [, ohneLueckeOptionen] = ohneLuecke.flug.mock.calls[0] as unknown as [number[][], { minZoom?: number }];
        expect(ohneLueckeOptionen.minZoom).toBe(fillZoom(ZAUN, { width: 1920 - 350, height: 1034 }));
    });

    it("(B9c) ohne Zaun an der Karte oder ohne Fläche gibt es keinen unteren Deckel (die Kamera fährt wie bisher)", async () => {
        const { karte, flug } = aufbau();
        (karte as unknown as { getMaxBounds: () => null }).getMaxBounds = () => null;
        zeigeAufKarte("a", STILL);
        await nextTick();
        const [, optionen] = flug.mock.calls[0] as unknown as [number[][], { maxZoom: number; minZoom?: number }];
        expect(optionen).toEqual({ maxZoom: SEARCH_FIT_MAX_ZOOM.weg });
    });

    it("die Leiste bekommt den heutigen Ort (samt „nicht mehr auf der Karte“) und den Rückweg, von wo die Karte gerufen wurde", () => {
        aufbau();
        zeigeAufKarte("a", STILL, "liste");
        const leiste = gerendert.at(-1) as { props: { heute?: { stillgelegt: boolean }; rueckweg: string } };
        expect(leiste.props.heute?.stillgelegt).toBe(true);
        expect(leiste.props.rueckweg).toBe("liste");
        zeigeAufKarte("b", BILD);
        const danach = gerendert.at(-1) as { props: { heute?: unknown; rueckweg: string } };
        expect(danach.props.heute).toBeUndefined();
        expect(danach.props.rueckweg).toBe("detail");
    });

    it("am Telefon geht das Panel vor dem Flug weg, und der Rückweg liegt auf der Leiste; Esc entfernt auch diese Überlagerung", async () => {
        const { panel, flug, reihenfolge, kaskade, ebenen } = aufbau(true);
        zeigeAufKarte("a", ORT, "liste");
        await nextTick();
        await nextTick();
        expect(panel.zu).toHaveBeenCalledTimes(1);
        expect(reihenfolge).toEqual(["panel-zu", "flug"]);
        expect(flug).toHaveBeenCalledTimes(1);
        expect((gerendert.at(-1) as { props: { telefon: boolean } }).props.telefon).toBe(true);
        expect(kaskade.run()).toBe("action");
        expect(kartenWunsch.value).toBeUndefined();
        expect(ebenen.size).toBe(0);
    });
});
