import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ZOOM_KURVE_VORGABE } from "@avesmaps3d/shared";
import {
    aufDerKurve,
    begleitNeigung,
    setZoomKurve,
    clampPitch,
    FLIGHT_PITCH,
    maxPitchForZoom,
    neigungBeimZoom,
    neigungNachZoom,
    nextCompassBearing,
    normalizeBearing,
    PITCH_CEILING,
    PITCH_CEILING_TOUCH,
    setMaxPitch,
    snapsToNorth,
    TILT_PRESET,
} from "../src/map/camera/camera-math.ts";
import { cameraMapOptions } from "../src/map/camera/camera-options.ts";
import {
    createCamera,
    FOLLOW_ACTIVE_MS,
    FOLLOW_EVENT,
    FOLLOW_HEIGHT_GAP_MS,
    FOLLOW_HEIGHT_SECONDS,
    isFollowMove,
} from "../src/map/camera/camera.ts";
import { startsCameraDrag } from "../src/map/camera/pointer-controls.ts";

/**
 * Die Regeln der 3D-Kamera (WI-0016, `docs/design/3d-navigation.md`). Geprüft wird, WOHIN die
 * Kamera darf; wie sie fährt, zeigen die Browsertests.
 */

describe("Neigungsgrenze nach Zoom (D3): nie ins Leere blicken", () => {
    it("15° je Zoomstufe: im Überblick 30°, in der Region 45°, in der Nähe 60°, dicht dran 80°", () => {
        expect(maxPitchForZoom(1)).toBe(30);
        expect(maxPitchForZoom(3)).toBe(30);
        expect(maxPitchForZoom(4)).toBe(45);
        expect(maxPitchForZoom(5)).toBe(60);
        expect(maxPitchForZoom(6)).toBe(75);
        expect(maxPitchForZoom(7)).toBe(80);
        expect(maxPitchForZoom(8)).toBe(80);
    });

    it("dazwischen weich, nicht in Stufen", () => {
        expect(maxPitchForZoom(3.5)).toBeCloseTo(37.5, 6);
        expect(maxPitchForZoom(4.5)).toBeCloseTo(52.5, 6);
        expect(maxPitchForZoom(5.5)).toBeCloseTo(67.5, 6);
        expect(maxPitchForZoom(6.5)).toBeCloseTo(77.5, 6);
    });

    it("🔴 nie über 80° - am Gerät abgenommen (Betreiber 2026-10-13: „fühlt sich gut an als max“)", () => {
        for (let zoom = -2; zoom <= 22; zoom += 0.25) {
            expect(maxPitchForZoom(zoom)).toBeLessThanOrEqual(PITCH_CEILING);
        }
        expect(PITCH_CEILING).toBe(80);
    });

    it("🔴 am Finger bleibt es bei 60°: der zusätzliche Deckel gilt über allen Stützstellen", () => {
        try {
            setMaxPitch(PITCH_CEILING_TOUCH);
            expect(PITCH_CEILING_TOUCH).toBe(60);
            expect(maxPitchForZoom(8)).toBe(60);
            expect(maxPitchForZoom(6)).toBe(60);
            // Unter dem Deckel gilt weiter die Regel nach Zoom.
            expect(maxPitchForZoom(4)).toBe(45);
            expect(clampPitch(79, 8)).toBe(60);
        } finally {
            setMaxPitch(undefined);
        }
        expect(maxPitchForZoom(8)).toBe(80);
    });

    it("eine Neigung wird in die Grenze gelegt, nie negativ", () => {
        expect(clampPitch(55, 3)).toBe(30);
        expect(clampPitch(-5, 6)).toBe(0);
        expect(clampPitch(40, 6)).toBe(40);
        expect(clampPitch(90, 8)).toBe(80);
    });

    it("die Reise fliegt auf ihrem eigenen Wert, nicht am Anschlag", () => {
        expect(FLIGHT_PITCH).toBe(65);
        expect(FLIGHT_PITCH).toBeLessThan(PITCH_CEILING);
        // Auf Flughöhe erlaubt die Regel nach Zoom sie auch wirklich.
        expect(maxPitchForZoom(7)).toBeGreaterThanOrEqual(FLIGHT_PITCH);
    });

    it("der 3D-Knopf kippt auf 45°", () => {
        expect(TILT_PRESET).toBe(45);
    });
});

describe("Die Neigung folgt ihrer Kurve (Betreiber 2026-11-08 „Ja, folgen lassen“, 2026-11-09 „neigt sich ab einer bestimmten nähe“)", () => {
    it("🔴 die Vorgabe: 25° bei Zoom 2 (angezeigt 1), 45° bei 6 (angezeigt 5), 80° bei 9,5 (angezeigt 8,5), Knick nur bei 6", () => {
        const werte = [1, 2, 2.4, 3, 4, 5, 6, 7, 8, 9, 9.5].map(begleitNeigung);
        [25, 25, 27, 30, 35, 40, 45, 55, 65, 75, 80].forEach((soll, i) => expect(werte[i]).toBeCloseTo(soll, 9));
        expect(ZOOM_KURVE_VORGABE).toEqual([
            { zoom: 2, neigung: 25 },
            { zoom: 6, neigung: 45 },
            { zoom: 9.5, neigung: 80 },
        ]);
    });

    it("🔴 die Zoomkurve aus den Standardwerten gilt, nie steiler als die Grenze; ohne Angabe wieder die Vorgabe", () => {
        try {
            setZoomKurve([
                { zoom: 2, neigung: 40 },
                { zoom: 5, neigung: 50 },
            ]);
            expect(begleitNeigung(2)).toBe(30);
            expect(begleitNeigung(4)).toBeCloseTo(45, 9);
            expect(begleitNeigung(4.5)).toBeCloseTo(40 + (2.5 / 3) * 10, 9);
            expect(begleitNeigung(9)).toBe(50);
            setZoomKurve(undefined);
            expect(begleitNeigung(6)).toBe(45);
        } finally {
            setZoomKurve(undefined);
        }
    });

    it("auf der Kurve steht, wer so steil ist, wie sie bei diesem Zoom sagt - flach nie, steiler auch nicht", () => {
        expect(aufDerKurve({ pitch: 27, zoom: 2.4 })).toBe(true);
        expect(aufDerKurve({ pitch: 44.6, zoom: 6 })).toBe(true);
        expect(aufDerKurve({ pitch: 80, zoom: 9.5 })).toBe(true);
        expect(aufDerKurve({ pitch: 60, zoom: 5 })).toBe(false);
        expect(aufDerKurve({ pitch: 30, zoom: 4 })).toBe(false);
        expect(aufDerKurve({ pitch: 0, zoom: 2 })).toBe(false);
    });

    it("Ring und Tasten: auf der Kurve kippt der Zoomschritt mit, sonst bleibt die Neigung", () => {
        expect(neigungNachZoom({ pitch: 30, zoom: 3 }, 5)).toBeCloseTo(40, 9);
        expect(neigungNachZoom({ pitch: 45, zoom: 6 }, 8)).toBeCloseTo(65, 9);
        expect(neigungNachZoom({ pitch: 80, zoom: 9.5 }, 4)).toBeCloseTo(35, 9);
        expect(neigungNachZoom({ pitch: 30, zoom: 5 }, 6)).toBe(30);
        expect(neigungNachZoom({ pitch: 0, zoom: 3 }, 6)).toBe(0);
    });

    it("🔴 Rad und Finger: vom Link mit 30° bei Zoom 2,4 hinein bis zum Horizont und wieder hinaus", () => {
        // Die Kamera zieht MapLibres gewünschten Stand auf das Ergebnis nach: Eine Zoomgeste bringt die gezeichnete Neigung mit.
        let vorher = { pitch: 27, zoom: 2.4 };
        const zoome = (zoom: number): number => {
            const pitch = neigungBeimZoom({ pitch: vorher.pitch, zoom }, vorher);
            vorher = { pitch, zoom };
            return pitch;
        };
        const runde = (n: number): number => Math.round(n * 1e6) / 1e6;
        expect([3, 4, 5, 6, 7, 8, 9, 9.5].map(zoome).map(runde)).toEqual([30, 35, 40, 45, 55, 65, 75, 80]);
        expect([8, 6, 4, 2].map(zoome).map(runde)).toEqual([65, 45, 35, 25]);
    });

    it("wer selbst neigt, flacher oder steiler, behält seine Neigung bis zur Grenze; flach bleibt flach", () => {
        expect(neigungBeimZoom({ pitch: 40, zoom: 6 }, { pitch: 45, zoom: 6 })).toBe(40);
        expect(neigungBeimZoom({ pitch: 40, zoom: 8 }, { pitch: 40, zoom: 6 })).toBe(40);
        expect(neigungBeimZoom({ pitch: 60, zoom: 6 }, { pitch: 45, zoom: 6 })).toBe(60);
        expect(neigungBeimZoom({ pitch: 90, zoom: 6 }, { pitch: 45, zoom: 6 })).toBe(75);
        expect(neigungBeimZoom({ pitch: 0, zoom: 7 }, { pitch: 0, zoom: 3 })).toBe(0);
    });

    it("verschieben auf der Kurve lässt sie, wo sie ist", () => {
        expect(neigungBeimZoom({ pitch: 45, zoom: 6 }, { pitch: 45, zoom: 6 })).toBe(45);
    });

    it("🔴 am Finger folgt sie nur bis 60°", () => {
        try {
            setMaxPitch(PITCH_CEILING_TOUCH);
            expect(neigungBeimZoom({ pitch: 30, zoom: 9.5 }, { pitch: 30, zoom: 3 })).toBe(60);
        } finally {
            setMaxPitch(undefined);
        }
    });

    it("🪤 MapLibre führt den gewünschten Stand weiter als `_camera._requestedCameraState` (sonst folgt nichts)", () => {
        // Wie Node sucht: vom Test aufwärts bis zum ersten `node_modules` mit MapLibre (Arbeitskopien haben keins).
        let ordner = dirname(fileURLToPath(import.meta.url));
        while (!existsSync(join(ordner, "node_modules/maplibre-gl")) && dirname(ordner) !== ordner)
            ordner = dirname(ordner);
        const bau = readFileSync(join(ordner, "node_modules/maplibre-gl/dist/maplibre-gl.mjs"), "utf8");
        expect(bau).toContain("_requestedCameraState");
        expect(bau).toContain("this._camera.transformCameraUpdate");
    });

    /** Eine Karte, die den Haken der Kamera festhält; `easeTo` läuft, bis `finish` kommt. */
    function hakenMap(start: { pitch: number; zoom: number }) {
        const view = { ...start };
        let haken: ((update: object) => { pitch?: number; center?: unknown }) | undefined;
        let laeuft = false;
        const ends: (() => void)[] = [];
        const gewuenscht: number[] = [];
        const mitten: unknown[] = [];
        const hoerer = new Map<string, (event: object) => void>();
        const map = {
            _camera: {
                _requestedCameraState: {
                    setPitch: (pitch: number) => gewuenscht.push(pitch),
                    setCenter: (center: unknown) => mitten.push(center),
                },
            },
            painter: { transform: { maxPitchScaleFactor: () => 1 } },
            getCenter: () => ({ lng: 0, lat: 0 }),
            getBearing: () => 0,
            getPitch: () => view.pitch,
            getZoom: () => view.zoom,
            getMinZoom: () => 0,
            getMaxZoom: () => 9.5,
            getCanvas: () => ({
                clientWidth: 1280,
                clientHeight: 720,
                getBoundingClientRect: () => ({ left: 100, top: 50 }),
            }),
            getCanvasContainer: () => ({
                addEventListener: (type: string, fn: (event: object) => void) => hoerer.set(type, fn),
            }),
            isMoving: () => laeuft,
            on: (type: string, handler: () => void) => {
                if (type === "moveend") ends.push(handler);
            },
            off: () => undefined,
            easeTo: () => {
                laeuft = true;
            },
            setTransformCameraUpdate: (fn: typeof haken) => {
                haken = fn;
            },
        };
        const finish = (): void => {
            laeuft = false;
            ends.forEach((end) => end());
        };
        return {
            map: map as unknown as Parameters<typeof createCamera>[0],
            view,
            haken: () => haken,
            finish,
            gewuenscht,
            mitten,
            hoerer,
        };
    }

    it("die Kamera hängt die Regel bei MapLibre ein; während ihrer eigenen Fahrt klemmt sie nur", () => {
        const { map, view, haken, finish, gewuenscht } = hakenMap({ pitch: 30, zoom: 3 });
        const camera = createCamera(map);
        expect(haken()?.({ pitch: 30, zoom: 4 }).pitch).toBe(35);
        // Der gewünschte Stand zieht mit, sonst brächte die nächste Zoomgeste wieder 30° mit.
        expect(gewuenscht).toEqual([35]);
        view.pitch = 35;
        view.zoom = 4;
        // Ein Schritt vom Ring gibt seine Neigung selbst vor: Bis er ankommt, folgt der Haken nicht.
        camera.rotateBy(10);
        expect(haken()?.({ pitch: 35, zoom: 8 }).pitch).toBe(35);
        finish();
        expect(haken()?.({ pitch: 35, zoom: 8 }).pitch).toBeCloseTo(65, 9);
    });

    it("🔴 sie kippt um den Punkt, an dem das Rad zoomt, und der gewünschte Stand bekommt diese Mitte (Betreiber 2026-11-09)", () => {
        const { map, view, haken, hoerer } = hakenMap({ pitch: 30, zoom: 3 });
        let uhr = 1000;
        createCamera(map, undefined, () => uhr);
        // Eine Transformation wie MapLibres: Ort unter Bildzeile y = Mitte + (y − 360) · (1 + Neigung / 30).
        const transform = (center: number, pitch: number, zoom: number) => {
            const tr = {
                center,
                pitch,
                zoom,
                clone: () => transform(tr.center, tr.pitch, tr.zoom),
                setPitch: (p: number) => {
                    tr.pitch = p;
                },
                setCenter: (c: number) => {
                    tr.center = c;
                },
                setLocationAtPoint: (ort: number, punkt: { y: number }) => {
                    tr.center = ort - (punkt.y - 360) * (1 + tr.pitch / 30);
                },
                screenPointToLocation: (punkt: { y: number }) => tr.center + (punkt.y - 360) * (1 + tr.pitch / 30),
            };
            return tr;
        };
        const kamera = map as unknown as { _camera: { _requestedCameraState: unknown } };
        // Zeiger bei Bildzeile 500 (Rahmen oben 50).
        hoerer.get("wheel")?.({ clientX: 900, clientY: 550 });
        const gewuenscht = transform(10, 30, 4);
        kamera._camera._requestedCameraState = gewuenscht;
        const antwort = haken()?.(transform(10, 30, 4));
        expect(antwort?.pitch).toBe(35);
        // Der Ort unter dem Zeiger (10 + 140 · 2) bleibt dort, gezeichnet und im gewünschten Stand.
        expect(antwort?.center as number).toBeCloseTo(10 + 140 * 2 - 140 * (1 + 35 / 30), 9);
        expect(gewuenscht).toMatchObject({ pitch: 35, center: antwort?.center });

        // 🪤 MapLibre hebt die Kamera über einen Hügel (flacher als gewünscht): gezeichnet wird so flach, der Ort bleibt trotzdem unter dem
        // Zeiger, und der gewünschte Stand behält die Kurve (65° bei Zoom 8), damit sie nach dem Hügel weiter gilt.
        view.pitch = 45;
        view.zoom = 6;
        const amHang = transform(10, 45, 8);
        kamera._camera._requestedCameraState = amHang;
        const gehoben = haken()?.(transform(10, 40, 8));
        expect(gehoben?.pitch).toBe(40);
        expect(gehoben?.center as number).toBeCloseTo(10 + 140 * 2.5 - 140 * (1 + 40 / 30), 9);
        expect(amHang.pitch).toBeCloseTo(65, 9);

        // Ohne frische Eingabe kippt sie wieder um die Bildmitte.
        uhr += 1000;
        view.pitch = 30;
        view.zoom = 3;
        kamera._camera._requestedCameraState = transform(10, 30, 4);
        expect(haken()?.(transform(10, 30, 4)).center).toBeUndefined();
    });
});

describe("Drehung", () => {
    it("liegt immer in (−180, 180]", () => {
        expect(normalizeBearing(190)).toBe(-170);
        expect(normalizeBearing(-190)).toBe(170);
        expect(normalizeBearing(180)).toBe(180);
        expect(normalizeBearing(-180)).toBe(180);
        expect(normalizeBearing(720)).toBe(0);
    });

    it("‹ › fahren zur nächsten der acht Himmelsrichtungen", () => {
        expect(nextCompassBearing(0, 1)).toBe(45);
        expect(nextCompassBearing(0, -1)).toBe(-45);
        expect(nextCompassBearing(37, 1)).toBe(45);
        expect(nextCompassBearing(37, -1)).toBe(0);
        expect(nextCompassBearing(135, 1)).toBe(180);
        expect(nextCompassBearing(180, 1)).toBe(-135);
        expect(nextCompassBearing(-170, -1)).toBe(180);
    });

    it("🪤 eine Fahrt, die knapp vor der Richtung endet, zählt nicht doppelt", () => {
        expect(nextCompassBearing(44.8, 1)).toBe(90);
        expect(nextCompassBearing(45.3, -1)).toBe(0);
    });

    it("rastet unter 7° auf Norden ein, darüber nicht", () => {
        expect(snapsToNorth(6.9)).toBe(true);
        expect(snapsToNorth(-6.9)).toBe(true);
        expect(snapsToNorth(7)).toBe(false);
        expect(snapsToNorth(353.5)).toBe(true);
    });
});

describe("Kameraoptionen der Karte", () => {
    it("🔴 MapLibres Rechtsziehen bleibt aus - die rechte Taste gehört dem Kontextmenü (D1)", () => {
        const options = cameraMapOptions({ zoom: 5 });
        expect(options.dragRotate).toBe(false);
        expect(options.pitchWithRotate).toBe(false);
        expect(options.rollEnabled).toBe(false);
    });

    it("Touch dreht und neigt mit zwei Fingern", () => {
        const options = cameraMapOptions({ zoom: 5 });
        expect(options.touchZoomRotate).toBe(true);
        expect(options.touchPitch).toBe(true);
    });

    it("die Grenze nach Zoom gilt für jede Kamerabewegung", () => {
        const options = cameraMapOptions({ zoom: 5 });
        const transform = options.transformCameraUpdate;
        if (!transform) {
            throw new Error("transformCameraUpdate fehlt");
        }
        const next = { center: { lng: 0, lat: 0 } as never, zoom: 3, roll: 0, pitch: 55, bearing: 0, elevation: 0 };
        expect(transform(next).pitch).toBe(30);
    });

    it("ein Link mit zu starker Neigung öffnet in der Grenze", () => {
        expect(cameraMapOptions({ zoom: 3, pitch: 55, bearing: 400 })).toMatchObject({ pitch: 30, bearing: 40 });
    });
});

describe("Mausgesten", () => {
    it("Strg + Links und die Mitteltaste drehen und neigen", () => {
        expect(startsCameraDrag({ pointerType: "mouse", button: 0, ctrlKey: true })).toBe(true);
        expect(startsCameraDrag({ pointerType: "mouse", button: 1, ctrlKey: false })).toBe(true);
    });

    it("🔴 Links ohne Strg verschiebt, und die rechte Taste bewegt die Kamera nie", () => {
        expect(startsCameraDrag({ pointerType: "mouse", button: 0, ctrlKey: false })).toBe(false);
        expect(startsCameraDrag({ pointerType: "mouse", button: 2, ctrlKey: false })).toBe(false);
        expect(startsCameraDrag({ pointerType: "mouse", button: 2, ctrlKey: true })).toBe(false);
    });

    it("Touch gehört MapLibres Zwei-Finger-Gesten", () => {
        expect(startsCameraDrag({ pointerType: "touch", button: 0, ctrlKey: true })).toBe(false);
    });
});

describe("Folgen (Playmode, WI-0031)", () => {
    /** Eine Karte, die nur festhält, wohin gesprungen wird. */
    function fakeMap(zoom: number) {
        const jumps: { options: Record<string, unknown>; data: Record<string, unknown> | undefined }[] = [];
        const map = {
            // MapLibres Painter: daran klemmt `installHorizonQueryFix` den Maßstabsfaktor der Trefferabfrage.
            painter: { transform: { maxPitchScaleFactor: () => 1 } },
            getBearing: () => 0,
            getPitch: () => 0,
            getZoom: () => zoom,
            isMoving: () => false,
            on: () => undefined,
            off: () => undefined,
            jumpTo: (options: Record<string, unknown>, data?: Record<string, unknown>) => jumps.push({ options, data }),
        };
        return { map: map as unknown as Parameters<typeof createCamera>[0], jumps };
    }

    it("in 2D nur die Mitte: Drehung und Neigung bleiben, wie sie sind", () => {
        const { map, jumps } = fakeMap(6);
        createCamera(map).follow([1, 2]);
        expect(jumps).toEqual([{ options: { center: [1, 2] }, data: { [FOLLOW_EVENT]: true } }]);
    });

    it("in 3D dreht und neigt sie mit - die Neigung in der Grenze des Zooms", () => {
        const { map, jumps } = fakeMap(3);
        createCamera(map).follow([1, 2], { bearing: 190, pitch: 55 });
        expect(jumps[0]?.options).toEqual({ center: [1, 2], bearing: -170, pitch: 30 });
    });

    it("fährt beim Folgen auch den Zoom mit - die Neigung in der Grenze des neuen Zooms", () => {
        const { map, jumps } = fakeMap(3);
        createCamera(map).follow([1, 2], { bearing: 10, pitch: 55, zoom: 7 });
        expect(jumps[0]?.options).toMatchObject({ center: [1, 2], zoom: 7, bearing: 10 });
        const { map: flat, jumps: flatJumps } = fakeMap(3);
        createCamera(flat).follow([1, 2], { pitch: 55 });
        expect((flatJumps[0]?.options as { pitch: number }).pitch).toBeLessThan(
            (jumps[0]?.options as { pitch: number }).pitch,
        );
    });

    it("🔴 die eigene Bewegung ist erkennbar, jede andere nicht", () => {
        expect(isFollowMove({ [FOLLOW_EVENT]: true })).toBe(true);
        expect(isFollowMove({ originalEvent: {} })).toBe(false);
        expect(isFollowMove({})).toBe(false);
    });

    /** Eine Karte mit Gelände: Boden nach Wunsch des Tests, Klemmen und Sprünge im Protokoll. */
    function terrainMap() {
        let ground = 0;
        const clamps: boolean[] = [];
        const elevations: (number | undefined)[] = [];
        const handlers = new Map<string, ((event: object) => void)[]>();
        const map = {
            // MapLibres Painter: daran klemmt `installHorizonQueryFix` den Maßstabsfaktor der Trefferabfrage.
            painter: { transform: { maxPitchScaleFactor: () => 1 } },
            getBearing: () => 0,
            getPitch: () => 45,
            getZoom: () => 7,
            isMoving: () => false,
            getTerrain: () => ({}),
            queryTerrainElevation: () => ground,
            getCenterElevation: () => 250,
            setCenterClampedToGround: (value: boolean) => clamps.push(value),
            on: (type: string, handler: (event: object) => void) =>
                handlers.set(type, [...(handlers.get(type) ?? []), handler]),
            off: () => undefined,
            jumpTo: (options: { elevation?: number }) => elevations.push(options.elevation),
        };
        const fire = (type: string, event: object): void =>
            (handlers.get(type) ?? []).forEach((handler) => handler(event));
        return {
            map: map as unknown as Parameters<typeof createCamera>[0],
            clamps,
            elevations,
            fire,
            setGround: (value: number) => {
                ground = value;
            },
        };
    }

    it("🔴 über Gelände hält sie die Höhe des Bodens unter dem Pfeil weich, statt auf jeden Kamm zu springen (WI-0053)", () => {
        let clock = 0;
        const { map, clamps, elevations, setGround } = terrainMap();
        const camera = createCamera(map, undefined, () => clock);
        setGround(1000);
        camera.follow([1, 2], { bearing: 0, ground: [1, 2], settle: true });
        // Ein Sprung (settle) steht gleich auf dem Boden; MapLibre klemmt ab jetzt nicht mehr selbst.
        expect(elevations.at(-1)).toBe(1000);
        expect(clamps).toEqual([false]);
        // Über den Kamm: der Boden springt um 30 km, die Kamera geht in einem Bild nur ein kleines Stück mit.
        setGround(31_000);
        clock += 16;
        camera.follow([1, 2.1], { bearing: 0, ground: [1, 2.1] });
        const step = (elevations.at(-1) as number) - 1000;
        expect(step).toBeCloseTo(30_000 * (1 - Math.exp(-0.016 / FOLLOW_HEIGHT_SECONDS)), 6);
        expect(step).toBeLessThan(1000);
        // Nach einigen Zeitkonstanten ist sie oben.
        for (let frame = 0; frame < 600; frame += 1) {
            clock += 16;
            camera.follow([1, 2.1], { bearing: 0, ground: [1, 2.1] });
        }
        expect(elevations.at(-1) as number).toBeCloseTo(31_000, 0);
        // Ein Sprung (eine Lücke über FOLLOW_HEIGHT_GAP_MS) setzt sie gleich auf den Boden.
        setGround(500);
        clock += FOLLOW_HEIGHT_GAP_MS + 1;
        camera.follow([5, 5], { bearing: 0, ground: [5, 5] });
        expect(elevations.at(-1)).toBe(500);
        expect(clamps).toEqual([false]);
    });

    it("🔴 3D-Knopf, Ring und Tasten lösen die folgende Kamera nicht: der Schritt läuft in der Folge aus (WI-0053)", () => {
        // Betreiber 2026-09-27: „wenn ich play drücke und dann auf 3d schalte flitzt der pfeil davon und die kamera
        // bleibt stehen … die kamera soll nur vom pfeil losgelöst sein, wenn [ich] mit maus oder touch … verändere“.
        let clock = 0;
        const view = { bearing: 20, pitch: 0, zoom: 7 };
        const eases: unknown[] = [];
        const jumps: Record<string, number | undefined>[] = [];
        const map = {
            // MapLibres Painter: daran klemmt `installHorizonQueryFix` den Maßstabsfaktor der Trefferabfrage.
            painter: { transform: { maxPitchScaleFactor: () => 1 } },
            getBearing: () => view.bearing,
            getPitch: () => view.pitch,
            getZoom: () => view.zoom,
            getMinZoom: () => 0,
            getMaxZoom: () => 12,
            getCenter: () => ({ lng: 1, lat: 2 }),
            isMoving: () => false,
            on: () => undefined,
            off: () => undefined,
            getTerrain: () => null,
            easeTo: (options: unknown) => eases.push(options),
            flyTo: (options: unknown) => eases.push(options),
            jumpTo: (options: { zoom?: number; pitch?: number; bearing?: number }) => {
                jumps.push({ zoom: options.zoom, pitch: options.pitch, bearing: options.bearing });
                if (options.zoom !== undefined) view.zoom = options.zoom;
                if (options.pitch !== undefined) view.pitch = options.pitch;
                if (options.bearing !== undefined) view.bearing = options.bearing;
            },
        } as unknown as Parameters<typeof createCamera>[0];
        const camera = createCamera(map, undefined, () => clock);
        camera.follow([1, 2]);
        // 2D → 3D während der Wiedergabe: keine eigene Fahrt, die Folge neigt - bis zum Anschlag.
        camera.toggleTilt();
        expect(eases).toEqual([]);
        clock += 16;
        camera.follow([1, 2.01]);
        expect(view.pitch).toBeGreaterThan(0);
        expect(view.pitch).toBeLessThan(10);
        for (let frame = 0; frame < 40; frame += 1) {
            clock += 16;
            camera.follow([1, 2.01]);
        }
        expect(view.pitch).toBeCloseTo(FLIGHT_PITCH, 6);
        // Zoom per Ring, in 2D auch die Drehung: ebenfalls in der Folge. Der Zoom meldet sein Ziel als gewählt.
        const chosen: number[] = [];
        camera.onZoomChoice((zoom) => chosen.push(zoom));
        camera.zoomBy(1);
        expect(chosen).toEqual([8]);
        camera.northUp();
        for (let frame = 0; frame < 40; frame += 1) {
            clock += 16;
            camera.follow([1, 2.01]);
        }
        expect(view.zoom).toBeCloseTo(8, 6);
        expect(view.bearing).toBeCloseTo(0, 6);
        // Führt die Folge die Drehung selbst (3D), gewinnt sie.
        camera.rotateBy(90);
        clock += 600;
        camera.follow([1, 2.01], { bearing: 33 });
        expect(view.bearing).toBeCloseTo(33, 6);
        // Eine Fahrt des Planers oder der Suche geht während der Folge nicht los.
        camera.showPoint([5, 5], 9);
        expect(eases).toEqual([]);
        // Angehalten oder frei (unfollow) fahren die Knöpfe gleich wieder selbst - und ohne Folgebild auch so.
        camera.unfollow();
        camera.zoomBy(1);
        expect(eases).toHaveLength(1);
        camera.follow([1, 2.01]);
        clock += FOLLOW_ACTIVE_MS + 1;
        camera.zoomBy(1);
        expect(eases).toHaveLength(2);
    });

    it("kehrt sie von einer freien Kamera zurück, beginnt die Höhe dort, wo die Karte gerade steht", () => {
        let clock = 0;
        const { map, elevations, fire, setGround } = terrainMap();
        const camera = createCamera(map, undefined, () => clock);
        setGround(1000);
        camera.follow([1, 2], { ground: [1, 2], settle: true });
        // Jemand anderes nimmt die Kamera: MapLibre klemmt wieder, die Karte steht auf 250 m (Attrappe).
        fire("movestart", { originalEvent: {} });
        clock += 5000;
        camera.follow([1, 2], { ground: [1, 2] });
        expect(elevations.at(-1)).toBe(250);
        clock += 16;
        camera.follow([1, 2], { ground: [1, 2] });
        expect(elevations.at(-1) as number).toBeGreaterThan(250);
        expect(elevations.at(-1) as number).toBeLessThan(300);
    });

    it("jede andere Bewegung gibt MapLibre das Klemmen auf den Boden zurück, ohne Gelände bleibt es", () => {
        const { map, clamps, fire, setGround } = terrainMap();
        const camera = createCamera(map, undefined, () => 0);
        setGround(1000);
        camera.follow([1, 2], { ground: [1, 2] });
        fire("movestart", { [FOLLOW_EVENT]: true });
        expect(clamps).toEqual([false]);
        fire("movestart", { originalEvent: {} });
        expect(clamps).toEqual([false, true]);
        // Ohne Punkt am Boden (2D) wird gar nicht geklemmt oder gelöst.
        camera.follow([1, 2]);
        expect(clamps).toEqual([false, true]);
    });
});
