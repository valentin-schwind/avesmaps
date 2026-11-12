import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVENTURIA, toRenderLngLat } from "@avesmaps3d/shared";
import { createBesucherSteuerung } from "../src/community/community-besucher.ts";
import {
    LAGE_EBENEN,
    LAGE_QUELLE,
    imKartenraum,
    installLageVorschlag,
    lageDaten,
    lageEbenen,
    vorschlagGrenzen,
} from "../src/community/lage-vorschlag.ts";
import { createEscapeCascade } from "../src/keyboard/escape-cascade.ts";
import { INTERACTION_PRIORITY, LAYER_OWNERS } from "../src/map/interaction/priorities.ts";
import type { HitContext, InteractionOwner, MapInteractionCoordinator } from "../src/map/interaction/types.ts";

/**
 * „Neue Lage auf der Karte zeigen“ (WI-0268 C2): der Geist mit der gestrichelten Linie zur alten Lage, und der Besitzer des Klicks im Koordinator - nur angemeldet, solange der
 * Modus läuft, mit Esc als Ausweg. Die Karte ist hier eine Attrappe ohne Stil; was MapLibre zeichnet, prüft die Sichtprobe.
 */

const space = AVENTURIA.coordinateSpace;
const ALT = { x: 551.63, y: 532.97 };
const NEU = { x: 560.12, y: 541.99 };

// Eine Karte zeichnet im nächsten Bild: hier gleich, damit die Fahrt der Kamera im Fall selbst zu prüfen ist.
beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (aufruf: FrameRequestCallback) => {
        aufruf(0);
        return 1;
    });
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("die Merkmale auf der Karte", () => {
    it("ohne Vorschlag nichts", () => {
        expect(lageDaten(undefined).features).toEqual([]);
    });

    it("🔴 der Geist an der neuen Lage, die alte als Scheibe und die Linie dazwischen (alt → neu)", () => {
        const daten = lageDaten({ neu: NEU, alt: ALT });
        expect(daten.features.map((merkmal) => merkmal.properties.t).sort()).toEqual(["alt", "geist", "verbindung"]);
        const linie = daten.features.find((merkmal) => merkmal.properties.t === "verbindung");
        const geist = daten.features.find((merkmal) => merkmal.properties.t === "geist");
        const alt = daten.features.find((merkmal) => merkmal.properties.t === "alt");
        const render = (lage: { x: number; y: number }) => {
            const punkt = toRenderLngLat(space, lage);
            return [punkt.lng, punkt.lat];
        };
        expect(linie?.geometry).toEqual({ type: "LineString", coordinates: [render(ALT), render(NEU)] });
        expect(geist?.geometry).toEqual({ type: "Point", coordinates: render(NEU) });
        expect(alt?.geometry).toEqual({ type: "Point", coordinates: render(ALT) });
    });

    it("ohne bekannte alte Lage (eine Stelle) nur der Geist, keine Linie ins Leere", () => {
        const daten = lageDaten({ neu: NEU });
        expect(daten.features.map((merkmal) => merkmal.properties.t)).toEqual(["geist"]);
    });

    it("der Ausschnitt um beide Lagen in Renderkoordinaten (Südwest, Nordost); ohne alte Lage der Punkt der neuen", () => {
        const render = (lage: { x: number; y: number }) => {
            const punkt = toRenderLngLat(space, lage);
            return [punkt.lng, punkt.lat];
        };
        const [sw, ne] = vorschlagGrenzen({ neu: NEU, alt: ALT });
        const [a, b] = [render(ALT), render(NEU)];
        expect(sw).toEqual([Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!)]);
        expect(ne).toEqual([Math.max(a[0]!, b[0]!), Math.max(a[1]!, b[1]!)]);
        expect(vorschlagGrenzen({ neu: NEU })).toEqual([render(NEU), render(NEU)]);
    });

    it("die Ebenen stehen unten nach oben: Linie, alte Lage, Geist; alle aus EINER Quelle", () => {
        const ebenen = lageEbenen();
        expect(ebenen.map((ebene) => ebene.id)).toEqual([LAGE_EBENEN.verbindung, LAGE_EBENEN.alt, LAGE_EBENEN.geist]);
        for (const ebene of ebenen) expect("source" in ebene && ebene.source).toBe(LAGE_QUELLE);
    });

    it("🔴 der Kartenraum: was außerhalb liegt, nimmt der Server nicht an und der Klick auch nicht", () => {
        const { bounds } = space;
        expect(imKartenraum({ x: bounds.minX, y: bounds.minY })).toBe(true);
        expect(imKartenraum({ x: bounds.maxX, y: bounds.maxY })).toBe(true);
        expect(imKartenraum({ x: bounds.minX - 1, y: bounds.minY })).toBe(false);
        expect(imKartenraum({ x: bounds.minX, y: bounds.maxY + 1 })).toBe(false);
    });
});

describe("die Rangtafel kennt den Besitzer", () => {
    it("🔴 `lage-zeigen` hat eine eigene Zahl, steht unter `measure` und über `place-set`, und nimmt auch in den Klimazonen teil", () => {
        const p = INTERACTION_PRIORITY;
        expect(p["lage-zeigen"]).toBeLessThan(p.measure);
        expect(p["lage-zeigen"]).toBeGreaterThan(p["place-set"]);
        expect(LAYER_OWNERS.klima).toContain("lage-zeigen");
    });
});

/** Eine Karte ohne Stil: Der Besitzer und die Esc-Stufe sind zu prüfen, nicht MapLibre. */
function attrappe(zoom = 2.5) {
    const fahrten: { grenzen: unknown; optionen: unknown }[] = [];
    const abgemeldet: string[] = [];
    const angemeldet: InteractionOwner[] = [];
    const interaction = {
        register(besitzer: InteractionOwner) {
            angemeldet.push(besitzer);
            return () => {
                abgemeldet.push(besitzer.id);
                angemeldet.splice(angemeldet.indexOf(besitzer), 1);
            };
        },
    } as unknown as MapInteractionCoordinator;
    const map = {
        style: { _loaded: false },
        on() {},
        off() {},
        once() {},
        getLayer: () => undefined,
        getSource: () => undefined,
        getZoom: () => zoom,
    };
    const escape = createEscapeCascade();
    const steuerung = createBesucherSteuerung();
    const camera = {
        showBounds: async (grenzen: unknown, optionen: unknown) => {
            fahrten.push({ grenzen, optionen });
            return true;
        },
    };
    const karte = installLageVorschlag(map as never, { interaction, escape, steuerung, camera: () => camera as never });
    const klick = (lage: { x: number; y: number }): void => {
        const punkt = toRenderLngLat(space, lage);
        const besitzer = angemeldet[0];
        if (besitzer === undefined) throw new Error("kein Besitzer angemeldet");
        const kontext = { kind: "click", lngLat: { lng: punkt.lng, lat: punkt.lat } } as unknown as HitContext;
        const anspruch = besitzer.hit(kontext);
        besitzer.apply("click", anspruch as never, kontext);
    };
    return { steuerung, angemeldet, abgemeldet, escape, karte, klick, fahrten };
}

describe("der Besitzer des Klicks", () => {
    it("🔴 nur angemeldet, solange der Modus läuft", () => {
        const { steuerung, angemeldet, abgemeldet } = attrappe();
        expect(angemeldet).toHaveLength(0);
        steuerung.starteLageModus({ name: "Wehrheim", alt: ALT });
        expect(angemeldet.map((besitzer) => besitzer.id)).toEqual(["lage-zeigen"]);
        steuerung.beendeLageModus();
        expect(angemeldet).toHaveLength(0);
        expect(abgemeldet).toEqual(["lage-zeigen"]);
    });

    it("🔴 der Klick setzt die Lage (auf 0,01 gerundet), beendet den Modus und meldet den Besitzer ab", () => {
        const { steuerung, klick, angemeldet } = attrappe();
        steuerung.oeffneMeldung({ art: "objekt", objektArt: "place", objektId: "x", name: "Wehrheim", lage: ALT });
        steuerung.starteLageModus({ name: "Wehrheim", alt: ALT });
        klick({ x: 560.1234, y: 541.9876 });
        expect(steuerung.vorschlag.value).toEqual({ neu: { x: 560.12, y: 541.99 }, alt: ALT });
        expect(steuerung.lageModus.value).toBeUndefined();
        expect(angemeldet).toHaveLength(0);
    });

    it("🔴 danach fliegt die Kamera zu beiden Lagen (nie näher als jetzt), damit der Geist nicht unter dem aufgeklappten Fenster liegt", async () => {
        const { steuerung, klick, fahrten } = attrappe(3.25);
        steuerung.starteLageModus({ name: "Wehrheim", alt: ALT });
        klick(NEU);
        await Promise.resolve();
        await Promise.resolve();
        expect(fahrten).toHaveLength(1);
        expect(fahrten[0]?.grenzen).toEqual(vorschlagGrenzen({ neu: NEU, alt: ALT }));
        expect(fahrten[0]?.optionen).toEqual({ maxZoom: 3.25 });
    });

    it("ein Klick außerhalb des Kartenraums fliegt nirgends hin", async () => {
        const { steuerung, klick, fahrten } = attrappe();
        steuerung.starteLageModus({ name: "Wehrheim" });
        klick({ x: space.bounds.maxX + 500, y: space.bounds.maxY + 500 });
        await Promise.resolve();
        await Promise.resolve();
        expect(fahrten).toEqual([]);
    });

    it("der Zeiger ist ein Fadenkreuz, solange der Modus läuft", () => {
        const { steuerung, angemeldet } = attrappe();
        steuerung.starteLageModus({ name: "Wehrheim" });
        const hover = angemeldet[0]?.hit({ kind: "hover" } as unknown as HitContext);
        expect(hover).toEqual({ cursor: "crosshair" });
    });

    it("🔴 ein Klick außerhalb des Kartenraums setzt nichts, der Modus läuft weiter", () => {
        const { steuerung, klick } = attrappe();
        steuerung.starteLageModus({ name: "Wehrheim" });
        klick({ x: space.bounds.maxX + 500, y: space.bounds.maxY + 500 });
        expect(steuerung.vorschlag.value).toBeUndefined();
        expect(steuerung.lageModus.value).toBeDefined();
    });
});

describe("🔴 Esc bricht den Modus ab (Stufe `action` der Kaskade)", () => {
    it("mit laufendem Modus verbraucht Esc die Taste und beendet ihn; ein gesetzter Vorschlag bleibt", () => {
        const { steuerung, escape } = attrappe();
        steuerung.setzeVorschlag({ x: 1, y: 1 });
        steuerung.starteLageModus({ name: "Wehrheim" });
        expect(escape.run()).toBe("action");
        expect(steuerung.lageModus.value).toBeUndefined();
        expect(steuerung.vorschlag.value).toBeDefined();
    });

    it("ohne Modus lässt Esc die Taste den äußeren Stufen", () => {
        const { escape } = attrappe();
        expect(escape.run()).toBeUndefined();
    });

    it("nach dem Abbauen hört niemand mehr auf Esc", () => {
        const { steuerung, escape, karte } = attrappe();
        karte.destroy();
        steuerung.starteLageModus({ name: "Wehrheim" });
        expect(escape.run()).toBeUndefined();
    });
});
