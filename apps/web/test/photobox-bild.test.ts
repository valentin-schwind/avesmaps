import { afterEach, describe, expect, it, vi } from "vitest";
import { KANAL_BILD_MAX_BYTES } from "@avesmaps3d/shared";
import { bildVorbereiten, neuerName } from "../src/auth/kanal-bild.ts";
import { bereiteBildVor } from "../src/photobox/bild.ts";

/**
 * Das Neu-Kodieren des Bildes im Browser (Review S2b I3): Safari/iOS kodiert in der Leinwand kein WebP (`toBlob("image/webp")` liefert PNG) und kennt
 * `imageOrientation: "from-image"` (ältere Fassungen) nicht. Ohne Rückfall wäre ein Telefonfoto als PNG über 6 MB oder scheiterte mit „kein JPEG, PNG, WebP oder GIF“.
 * Hier stehen Attrappen für `createImageBitmap` und für die Leinwand (`toBlob`); die Wirkung auf einem echten iPhone belegt das nicht.
 *
 * 🔴 Der Betreiber-Kanal (`auth/kanal.ts`) ruft `bildVorbereiten` ohne Optionen auf und verhält sich wie zuvor: kein JPEG, keine zweite Leseversuch.
 */

const MIB = 1024 * 1024;
type Leseversuch = { optionen: unknown };

interface Attrappen {
    /** Welche Typen die Leinwand wirklich kodiert; jeder andere kommt als PNG zurück (wie in Safari). */
    readonly kodiert: readonly string[];
    /** Wie groß die Bytes sind, je Typ (Vorgabe: 100 KB). */
    readonly groesse?: Readonly<Record<string, number>>;
    /** `createImageBitmap` wirft, wenn `{ imageOrientation }` mitkommt (ältere Browser). */
    readonly werfeMitAusrichtung?: boolean;
    /** `createImageBitmap` wirft immer (kein Bild). */
    readonly werfeImmer?: boolean;
    /** Die JPEG-Kodierung liefert nichts. */
    readonly jpegLiefertNichts?: boolean;
}

interface Aufzeichnung {
    readonly lesen: Leseversuch[];
    readonly kodierungen: { typ: string | undefined; qualitaet: number | undefined }[];
    /** Die Zeichenbefehle in der Reihenfolge, in der sie kamen (`zeichne`, `fuelle:<operation>`). */
    readonly befehle: string[];
    readonly leinwaende: { width: number; height: number }[];
}

function stelleAttrappenAuf(einstellung: Attrappen): Aufzeichnung {
    const aufzeichnung: Aufzeichnung = { lesen: [], kodierungen: [], befehle: [], leinwaende: [] };
    vi.stubGlobal(
        "createImageBitmap",
        vi.fn((_quelle: unknown, optionen?: unknown) => {
            aufzeichnung.lesen.push({ optionen });
            if (einstellung.werfeImmer === true)
                return Promise.reject(new DOMException("kein Bild", "InvalidStateError"));
            if (einstellung.werfeMitAusrichtung === true && optionen !== undefined) {
                return Promise.reject(new TypeError("The provided value 'from-image' is not a valid enum value"));
            }
            return Promise.resolve({ width: 4032, height: 3024, close: () => undefined });
        }),
    );
    vi.stubGlobal("document", {
        createElement: (art: string) => {
            expect(art).toBe("canvas");
            const kontext = {
                globalCompositeOperation: "source-over",
                fillStyle: "",
                drawImage: () => aufzeichnung.befehle.push("zeichne"),
                fillRect: () =>
                    aufzeichnung.befehle.push(`fuelle:${kontext.globalCompositeOperation}:${kontext.fillStyle}`),
            };
            const leinwand = {
                width: 0,
                height: 0,
                getContext: () => kontext,
                toBlob: (fertig: (blob: Blob | null) => void, typ?: string, qualitaet?: number) => {
                    aufzeichnung.kodierungen.push({ typ, qualitaet });
                    aufzeichnung.befehle.push(`kodiere:${typ ?? ""}`);
                    aufzeichnung.leinwaende.push({ width: leinwand.width, height: leinwand.height });
                    if (typ === "image/jpeg" && einstellung.jpegLiefertNichts === true) return fertig(null);
                    // Ein Typ, den die Leinwand nicht kann, kommt als PNG zurück.
                    const geliefert = typ !== undefined && einstellung.kodiert.includes(typ) ? typ : "image/png";
                    const bytes = einstellung.groesse?.[geliefert] ?? 100 * 1024;
                    fertig(new Blob([new Uint8Array(bytes)], { type: geliefert }));
                },
            };
            return leinwand;
        },
    });
    return aufzeichnung;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

const foto = (name = "IMG_2041.JPG", typ = "image/jpeg"): File => new File([new Uint8Array(8)], name, { type: typ });
const REISEBILD = { jpegRueckfall: true, ausrichtungOhneOptionWiederholen: true } as const;

describe("🔴 der Betreiber-Kanal bleibt, wie er war (ohne Optionen)", () => {
    it("ein Browser mit WebP: WebP, Qualität 0,9, ein Leseversuch mit der Ausrichtung aus dem Bild", async () => {
        const a = stelleAttrappenAuf({ kodiert: ["image/webp", "image/jpeg"] });
        const ergebnis = await bildVorbereiten(foto());
        expect(ergebnis).toMatchObject({ ok: true, breite: 2560, hoehe: 1920, datei: { name: "IMG_2041.webp" } });
        expect(a.kodierungen).toEqual([{ typ: "image/webp", qualitaet: 0.9 }]);
        expect(a.lesen).toEqual([{ optionen: { imageOrientation: "from-image" } }]);
    });

    it("ein Browser ohne WebP: PNG, nie JPEG; ist das PNG über 6 MiB, auch verkleinert, heißt es „zu groß“", async () => {
        const a = stelleAttrappenAuf({
            kodiert: ["image/jpeg"],
            groesse: { "image/png": KANAL_BILD_MAX_BYTES + MIB, "image/jpeg": 1 * MIB },
        });
        expect(await bildVorbereiten(foto())).toEqual({ ok: false, grund: "zu_gross" });
        expect(a.kodierungen.map((k) => k.typ)).toEqual(["image/webp", "image/png", "image/webp", "image/png"]);
        expect(a.befehle.some((befehl) => befehl.startsWith("fuelle"))).toBe(false);
    });

    it("kennt der Browser die Ausrichtung nicht, bleibt es bei „kein Bild“ (kein zweiter Versuch)", async () => {
        const a = stelleAttrappenAuf({ kodiert: ["image/webp"], werfeMitAusrichtung: true });
        expect(await bildVorbereiten(foto())).toEqual({ ok: false, grund: "kein_bild" });
        expect(a.lesen).toHaveLength(1);
    });
});

describe("🔴 Reisebild: Rückfälle für Safari und ältere Browser", () => {
    it("ein Browser mit WebP: genau wie der Kanal, WebP", async () => {
        const a = stelleAttrappenAuf({ kodiert: ["image/webp", "image/jpeg"] });
        const ergebnis = await bildVorbereiten(foto(), REISEBILD);
        expect(ergebnis).toMatchObject({ ok: true, datei: { name: "IMG_2041.webp" } });
        expect(a.kodierungen).toEqual([{ typ: "image/webp", qualitaet: 0.9 }]);
        expect(a.befehle).toEqual(["zeichne", "kodiere:image/webp"]);
    });

    it("🔴 ohne WebP-Kodierer (Safari): JPEG mit Qualität 0,9 statt PNG; Durchsichtiges wird weiß unterlegt, bevor kodiert wird", async () => {
        const a = stelleAttrappenAuf({ kodiert: ["image/jpeg"] });
        const ergebnis = await bildVorbereiten(foto("Urlaub.HEIC"), REISEBILD);
        expect(ergebnis).toMatchObject({ ok: true, breite: 2560, hoehe: 1920, datei: { name: "Urlaub.jpg" } });
        expect(a.kodierungen).toEqual([
            { typ: "image/webp", qualitaet: 0.9 },
            { typ: "image/jpeg", qualitaet: 0.9 },
        ]);
        // Erst gezeichnet, dann (nach dem fehlgeschlagenen WebP) HINTER das Bild gefüllt, erst dann JPEG.
        expect(a.befehle).toEqual([
            "zeichne",
            "kodiere:image/webp",
            "fuelle:destination-over:#ffffff",
            "kodiere:image/jpeg",
        ]);
    });

    it("🔴 das Foto, das als PNG über 6 MiB läge, geht als JPEG durch (der Telefonfall)", async () => {
        const a = stelleAttrappenAuf({
            kodiert: ["image/jpeg"],
            groesse: { "image/png": KANAL_BILD_MAX_BYTES + MIB, "image/jpeg": 2 * MIB },
        });
        const ergebnis = await bildVorbereiten(foto(), REISEBILD);
        expect(ergebnis.ok).toBe(true);
        expect(a.leinwaende[0]).toEqual({ width: 2560, height: 1920 });
    });

    it("ist auch das JPEG über 6 MiB, wird einmal mit 1920 px versucht, dann heißt es „zu groß“", async () => {
        const a = stelleAttrappenAuf({
            kodiert: ["image/jpeg"],
            groesse: { "image/jpeg": KANAL_BILD_MAX_BYTES + MIB },
        });
        expect(await bildVorbereiten(foto(), REISEBILD)).toEqual({ ok: false, grund: "zu_gross" });
        expect(a.leinwaende.map((l) => l.width)).toEqual([2560, 2560, 1920, 1920]);
    });

    it("liefert die JPEG-Kodierung nichts, bleibt PNG als letzter Weg", async () => {
        stelleAttrappenAuf({ kodiert: [], jpegLiefertNichts: true });
        const ergebnis = await bildVorbereiten(foto(), REISEBILD);
        expect(ergebnis).toMatchObject({ ok: true, datei: { name: "IMG_2041.png" } });
    });

    it("🔴 wirft `createImageBitmap` mit der Ausrichtung (Browser, die den Wert nicht kennen), wird ohne die Option noch einmal gelesen", async () => {
        const a = stelleAttrappenAuf({ kodiert: ["image/webp"], werfeMitAusrichtung: true });
        const ergebnis = await bildVorbereiten(foto(), REISEBILD);
        expect(ergebnis.ok).toBe(true);
        expect(a.lesen).toEqual([{ optionen: { imageOrientation: "from-image" } }, { optionen: undefined }]);
    });

    it("scheitert auch der zweite Versuch, ist es kein Bild", async () => {
        const a = stelleAttrappenAuf({ kodiert: ["image/webp"], werfeImmer: true });
        expect(await bildVorbereiten(foto(), REISEBILD)).toEqual({ ok: false, grund: "kein_bild" });
        expect(a.lesen).toHaveLength(2);
    });

    it("ein Bild, das beim ersten Versuch klappt, wird nicht ein zweites Mal gelesen", async () => {
        const a = stelleAttrappenAuf({ kodiert: ["image/webp"] });
        await bildVorbereiten(foto(), REISEBILD);
        expect(a.lesen).toHaveLength(1);
    });
});

describe("der Name zur Anzeige und das Formular", () => {
    it("ein JPEG heißt .jpg, ein WebP .webp, alles Übrige .png", () => {
        expect(neuerName("IMG_2041.HEIC.jpg", "image/jpeg")).toBe("IMG_2041.HEIC.jpg");
        expect(neuerName("a.png", "image/webp")).toBe("a.webp");
        expect(neuerName("a.webp", "image/png")).toBe("a.png");
    });

    it("🔴 das Formular nimmt die Rückfälle: ohne WebP geht ein JPEG hinaus, und der Name des Besuchers nie", async () => {
        stelleAttrappenAuf({ kodiert: ["image/jpeg"] });
        const ergebnis = await bereiteBildVor(foto("Urlaub mit Oma IMG_0042.JPG"));
        expect(ergebnis.ok).toBe(true);
        if (!ergebnis.ok) return;
        expect(ergebnis.bild.datei.name).toBe("reisebild.jpg");
        expect(ergebnis.bild.anzeigeName).toBe("Urlaub mit Oma IMG_0042.JPG");
        expect(JSON.stringify(ergebnis.bild.datei)).not.toContain("Urlaub");
    });

    it("mit WebP bleibt es bei reisebild.webp, bei PNG (kein JPEG-Kodierer) bei reisebild.png", async () => {
        stelleAttrappenAuf({ kodiert: ["image/webp"] });
        const mit = await bereiteBildVor(foto());
        expect(mit.ok && mit.bild.datei.name).toBe("reisebild.webp");
        vi.unstubAllGlobals();
        stelleAttrappenAuf({ kodiert: [], jpegLiefertNichts: true });
        const ohne = await bereiteBildVor(foto());
        expect(ohne.ok && ohne.bild.datei.name).toBe("reisebild.png");
    });
});
