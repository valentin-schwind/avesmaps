import { afterEach, describe, expect, it, vi } from "vitest";
import { coatImageId, mediaPublicUrl } from "@avesmaps3d/shared";
import { claimHatchImageResolver } from "../src/map/claim-hatch-images.ts";
import { dispatchMissingImage, installStyleImageResolvers } from "../src/map/style-image-resolver.ts";
import {
    coatImageResolver,
    coatImageSize,
    halvingSteps,
    transientCoatStatus,
    type CoatImageDependencies,
    type CoatSize,
} from "../src/map/territory-coat-images.ts";

/**
 * Die Wappen als Bilder der Karte und der EINE Auflöser für alle Laufzeitbilder (WI-0121).
 */

const SHA = "ab".repeat(32);
const ID = coatImageId(mediaPublicUrl(SHA)) as string;
const URL_DATEI = mediaPublicUrl(SHA);

afterEach(() => {
    vi.restoreAllMocks();
});

describe("Größe des Wappens", () => {
    it("🔴 die lange Kante wird 40 mal Pixeldichte, die Pixeldichte macht daraus 40 logische Pixel", () => {
        // 512 × 398 auf dem Rechner (1×), auf einem Schirm mit 2× und mit 3×.
        expect(coatImageSize({ width: 512, height: 398 }, 40, 1)).toEqual({ width: 40, height: 31, pixelRatio: 1 });
        expect(coatImageSize({ width: 512, height: 398 }, 40, 2)).toEqual({ width: 80, height: 62, pixelRatio: 2 });
        expect(coatImageSize({ width: 398, height: 512 }, 40, 3)).toEqual({ width: 93, height: 120, pixelRatio: 3 });
    });

    it("🔴 nie hinauf: Ist die Quelle kleiner als das Gerät wünscht, bleibt sie, und die Pixeldichte sinkt unter 1", () => {
        const klein = coatImageSize({ width: 64, height: 64 }, 40, 3);
        expect(klein).toEqual({ width: 64, height: 64, pixelRatio: 1.6 });
        // Die logische Kante bleibt 40 (64 / 1,6).
        expect(klein.width / klein.pixelRatio).toBe(40);
        const winzig = coatImageSize({ width: 20, height: 10 }, 40, 1);
        expect(winzig.width).toBeLessThanOrEqual(20);
        expect(winzig.width / winzig.pixelRatio).toBe(40);
    });

    it("eine Pixeldichte unter 1 zählt als 1; eine leere Quelle bricht nichts", () => {
        expect(coatImageSize({ width: 128, height: 128 }, 40, 0.5)).toEqual({ width: 40, height: 40, pixelRatio: 1 });
        expect(coatImageSize({ width: 0, height: 0 }, 40, 1).width).toBeGreaterThanOrEqual(1);
    });

    it("🔴 verkleinert wird in Hälften, nie in einem Schritt um das Zwölffache", () => {
        expect(halvingSteps(512, 40)).toEqual([256, 128, 64, 40]);
        expect(halvingSteps(512, 80)).toEqual([256, 128, 80]);
        expect(halvingSteps(80, 40)).toEqual([40]);
        expect(halvingSteps(40, 40)).toEqual([40]);
        for (const [von, nach] of [
            [512, 40],
            [398, 31],
            [128, 40],
            [128, 120],
        ] as const) {
            const schritte = halvingSteps(von, nach);
            expect(schritte.at(-1)).toBe(nach);
            let davor: number = von;
            for (const schritt of schritte) {
                expect(schritt).toBeGreaterThanOrEqual(nach);
                expect(davor / schritt).toBeLessThanOrEqual(2.0001);
                davor = schritt;
            }
        }
    });
});

/** Eine Karte, die nur die zwei Aufrufe kennt, die der Auflöser macht. */
function karte() {
    const bilder = new Map<string, { image: { width: number; height: number; data: Uint8Array }; options: unknown }>();
    return {
        bilder,
        hasImage: (id: string) => bilder.has(id),
        addImage: (id: string, image: { width: number; height: number; data: Uint8Array }, options: unknown) => {
            bilder.set(id, { image, options });
        },
    };
}

function abhaengigkeiten(ueberschreibe: Partial<CoatImageDependencies> = {}) {
    const abrufe: string[] = [];
    const pausen: number[] = [];
    let geschlossen = 0;
    const deps: CoatImageDependencies = {
        fetcher: (url: string) => {
            abrufe.push(url);
            return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"])) });
        },
        decode: () =>
            Promise.resolve({
                width: 512,
                height: 398,
                close: () => {
                    geschlossen += 1;
                },
            }),
        rasterize: (_decoded, size: CoatSize) => ({
            width: size.width,
            height: size.height,
            data: new Uint8ClampedArray(size.width * size.height * 4),
        }),
        deviceRatio: () => 2,
        wait: (ms: number) => {
            pausen.push(ms);
            return Promise.resolve();
        },
        ...ueberschreibe,
    };
    return { deps, abrufe, pausen, geschlossen: (): number => geschlossen };
}
describe("Der Auflöser der Wappen", () => {
    it("🔴 holt die Datei von der Adresse, die der Name trägt, rechnet auf 80 Bildpunkte und meldet das Bild mit Pixeldichte 2", async () => {
        const k = karte();
        const abhaengig = abhaengigkeiten();
        await coatImageResolver(k, abhaengig.deps).resolve(ID);
        expect(abhaengig.abrufe).toEqual([URL_DATEI]);
        const bild = k.bilder.get(ID);
        expect(bild?.image).toMatchObject({ width: 80, height: 62 });
        expect(bild?.image.data).toBeInstanceOf(Uint8Array);
        expect(bild?.options).toEqual({ pixelRatio: 2 });
        // Das Quellbild wird freigegeben.
        expect(abhaengig.geschlossen()).toBe(1);
    });

    it("🔴 holt nur Adressen des Media Core: ein fremder Bildname bleibt unbeantwortet, ohne Abruf", async () => {
        const k = karte();
        const abhaengig = abhaengigkeiten();
        const aufloeser = coatImageResolver(k, abhaengig.deps);
        for (const fremd of [
            "coat:../../etc/passwd",
            "coat:http://example.org/x.webp",
            "coat:",
            `coat:${SHA.toUpperCase()}`,
        ]) {
            await aufloeser.resolve(fremd);
        }
        expect(abhaengig.abrufe).toEqual([]);
        expect(k.bilder.size).toBe(0);
    });

    it("🔴 gleichzeitige Anfragen nach demselben Bild (jede Kachel fragt für sich) teilen sich EINEN Abruf", async () => {
        const k = karte();
        const abhaengig = abhaengigkeiten();
        const aufloeser = coatImageResolver(k, abhaengig.deps);
        await Promise.all([aufloeser.resolve(ID), aufloeser.resolve(ID), aufloeser.resolve(ID)]);
        expect(abhaengig.abrufe).toHaveLength(1);
        expect(k.bilder.size).toBe(1);
        // Hat die Karte das Bild, wird nicht noch einmal geholt.
        await aufloeser.resolve(ID);
        expect(abhaengig.abrufe).toHaveLength(1);
    });

    it("🔴 ein Bild, das nicht kommt (404, kaputte Bytes), wird gemeldet und bleibt ohne Bild - der nächste Bedarf versucht es neu", async () => {
        const meldung = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const k = karte();
        let antwort = 404;
        const abhaengig = abhaengigkeiten({
            fetcher: () =>
                Promise.resolve({ ok: antwort === 200, status: antwort, blob: () => Promise.resolve(new Blob(["x"])) }),
        });
        const aufloeser = coatImageResolver(k, abhaengig.deps);
        await expect(aufloeser.resolve(ID)).resolves.toBeUndefined();
        expect(k.bilder.size).toBe(0);
        expect(meldung).toHaveBeenCalledTimes(1);
        expect(String(meldung.mock.calls[0]?.[0])).toContain(ID);
        // Später ist es da: derselbe Name wird erneut gefragt und diesmal angelegt.
        antwort = 200;
        await aufloeser.resolve(ID);
        expect(k.bilder.has(ID)).toBe(true);

        // Kaputte Bytes: Das Entschlüsseln scheitert, nichts wird angelegt.
        const k2 = karte();
        const kaputt = coatImageResolver(
            k2,
            abhaengigkeiten({ decode: () => Promise.reject(new Error("kein Bild")) }).deps,
        );
        await kaputt.resolve(ID);
        expect(k2.bilder.size).toBe(0);
        expect(meldung).toHaveBeenCalledTimes(2);
    });

    it("🔴 ein Abruf, der nur vorübergehend scheitert (Neustart des Servers, Socket zurückgesetzt, 5xx), wird nachgeholt, bevor das Wappen ausbleibt (WI-0123)", async () => {
        const meldung = vi.spyOn(console, "error").mockImplementation(() => undefined);
        // Je Fall: was die Versuche nacheinander liefern; ein Error ist ein Netzfehler (fetch wirft).
        const faelle: { name: string; antworten: (number | Error)[]; bild: boolean; abrufe: number }[] = [
            { name: "Netzfehler, dann da", antworten: [new TypeError("Failed to fetch"), 200], bild: true, abrufe: 2 },
            { name: "502 vom Proxy, dann da", antworten: [502, 200], bild: true, abrufe: 2 },
            { name: "500, 503, dann da", antworten: [500, 503, 200], bild: true, abrufe: 3 },
            {
                name: "dreimal Netzfehler",
                antworten: [new TypeError("x"), new TypeError("x"), new TypeError("x")],
                bild: false,
                abrufe: 3,
            },
            { name: "dreimal 503", antworten: [503, 503, 503, 200], bild: false, abrufe: 3 },
            { name: "404 ist endgültig", antworten: [404, 200], bild: false, abrufe: 1 },
            { name: "403 ist endgültig", antworten: [403, 200], bild: false, abrufe: 1 },
        ];
        for (const fall of faelle) {
            meldung.mockClear();
            const k = karte();
            let versuch = 0;
            const abhaengig = abhaengigkeiten({
                fetcher: () => {
                    const antwort = fall.antworten[versuch] as number | Error;
                    versuch += 1;
                    if (antwort instanceof Error) return Promise.reject(antwort);
                    return Promise.resolve({
                        ok: antwort === 200,
                        status: antwort,
                        blob: () => Promise.resolve(new Blob(["x"])),
                    });
                },
            });
            await coatImageResolver(k, abhaengig.deps).resolve(ID);
            expect(versuch, fall.name).toBe(fall.abrufe);
            expect(k.bilder.has(ID), fall.name).toBe(fall.bild);
            // Gemeldet wird erst, wenn das Wappen wirklich ausbleibt - einmal, nicht je Versuch.
            expect(meldung, fall.name).toHaveBeenCalledTimes(fall.bild ? 0 : 1);
            expect(abhaengig.pausen, fall.name).toHaveLength(fall.abrufe - 1);
        }
    });

    it("die Pause vor dem nächsten Versuch ist die der Route: `Retry-After`, sonst 2 s; gleichzeitige Anfragen warten auf denselben Abruf", async () => {
        const k = karte();
        let versuch = 0;
        const abhaengig = abhaengigkeiten({
            fetcher: () => {
                versuch += 1;
                return Promise.resolve({
                    ok: versuch === 3,
                    status: versuch === 3 ? 200 : 503,
                    headers: new Headers(versuch === 1 ? { "retry-after": "1" } : {}),
                    blob: () => Promise.resolve(new Blob(["x"])),
                });
            },
        });
        const aufloeser = coatImageResolver(k, abhaengig.deps);
        await Promise.all([aufloeser.resolve(ID), aufloeser.resolve(ID)]);
        expect(versuch).toBe(3);
        expect(abhaengig.pausen).toEqual([1000, 2000]);
        expect(k.bilder.has(ID)).toBe(true);
        expect([500, 502, 503, 504, 408, 429].every(transientCoatStatus)).toBe(true);
        expect([400, 401, 403, 404, 410].some(transientCoatStatus)).toBe(false);
    });
});

describe("Der eine Auflöser der Karte", () => {
    it("🔴 reicht einen fehlenden Bildnamen an die Art weiter, deren Präfix er trägt - und an keine andere", async () => {
        const gefragt: string[] = [];
        const art = (prefix: string) => ({
            prefix,
            resolve: (id: string) => {
                gefragt.push(`${prefix}|${id}`);
            },
        });
        const verteilen = dispatchMissingImage([art("claim-"), art("coat:")]);
        await verteilen("claim-4-aabbcc-112233");
        await verteilen(ID);
        await verteilen("marker-diamond");
        expect(gefragt).toEqual(["claim-|claim-4-aabbcc-112233", `coat:|${ID}`]);
    });

    it("🔴 setzt den Auflöser an der Karte EINMAL für beide Arten; Schraffur und Wappen bedienen dieselbe Karte", async () => {
        const k = karte();
        let gesetzt: ((id: string) => void | Promise<void>) | null = null;
        let aufrufe = 0;
        const mapLike = {
            ...k,
            setMissingStyleImageResolver: (funktion: typeof gesetzt) => {
                aufrufe += 1;
                gesetzt = funktion;
            },
        };
        const abhaengig = abhaengigkeiten();
        const abmelden = installStyleImageResolvers(mapLike as never, [
            claimHatchImageResolver(k),
            coatImageResolver(k, abhaengig.deps),
        ]);
        expect(aufrufe).toBe(1);
        const frage = gesetzt as unknown as (id: string) => void | Promise<void>;
        await frage("claim-4-67b060-a9b263");
        await frage(ID);
        expect(k.bilder.has("claim-4-67b060-a9b263")).toBe(true);
        expect(k.bilder.has(ID)).toBe(true);
        abmelden();
        expect(gesetzt).toBeNull();
    });
});
