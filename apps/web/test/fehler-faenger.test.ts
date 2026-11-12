import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_FEHLER_GRENZEN } from "@avesmaps3d/shared";
import { haltBesuchsmeldung, starteBesuchsmeldung } from "../src/besuch/besuch-melden.ts";
import {
    erfasseFehler,
    faengeVueFehler,
    installiereFehlerfaenger,
    oberflaecheSteht,
    setzeFehlerfaengerZurueck,
} from "../src/besuch/fehler-faenger.ts";
import { beobachteKartenfehler, WORKER_FRIST_MS, type KarteFuerFehler } from "../src/besuch/fehler-karte.ts";

/**
 * Die Fänger für Fehler im Browser (WI-0202): Grenze je Seite, Arten, was nicht zählt. Gegen die echten Module; die
 * Vitest-Umgebung ist `node`, also stehen Fenster, Dokument und fetch als Attrappe da (wie in `besuch-melden.test.ts`).
 */

interface Koerper {
    ereignisse: { metrik: string; dimension?: string }[];
    fehler?: { art: string; name: string; meldung: string; stellen: string[]; grafik?: string }[];
}

let fetchHorcher: ReturnType<typeof vi.fn>;
let fensterHaken: Map<string, (ereignis: unknown) => void>;

function meldungen(): Koerper[] {
    return (fetchHorcher.mock.calls as [string, { body?: string }][])
        .filter(([url, optionen]) => url.endsWith("/api/besuch") && typeof optionen.body === "string")
        .map(([, optionen]) => JSON.parse(optionen.body as string) as Koerper);
}
const diagnosen = () => meldungen().flatMap((koerper) => koerper.fehler ?? []);
const zaehlungen = () =>
    meldungen()
        .flatMap((koerper) => koerper.ereignisse)
        .filter((ereignis) => ereignis.metrik === "client_fehler")
        .map((ereignis) => ereignis.dimension);

beforeEach(() => {
    vi.useFakeTimers();
    fetchHorcher = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    fensterHaken = new Map();
    vi.stubGlobal("fetch", fetchHorcher);
    vi.stubGlobal("location", { hash: "", origin: "https://avesmaps.de", href: "https://avesmaps.de/" });
    vi.stubGlobal("window", {
        addEventListener: (art: string, haken: (ereignis: unknown) => void) => fensterHaken.set(art, haken),
        innerWidth: 1280,
        matchMedia: undefined,
    });
    vi.stubGlobal("document", {
        addEventListener: vi.fn(),
        referrer: "",
        visibilityState: "visible",
        createElement: () => ({ getContext: () => null }),
    });
});

afterEach(() => {
    haltBesuchsmeldung();
    setzeFehlerfaengerZurueck();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("Grenze je Seite", () => {
    it("derselbe Fehler zehnmal: eine Zählung, eine Diagnose", () => {
        for (let mal = 0; mal < 10; mal += 1) erfasseFehler("vue", new TypeError("x is not a function"));
        vi.advanceTimersByTime(1000);
        expect(zaehlungen()).toEqual(["vue"]);
        expect(diagnosen()).toEqual([
            { art: "vue", name: "TypeError", meldung: "x is not a function", stellen: [], grafik: "ohne" },
        ]);
    });

    it("sieben verschiedene Fehler: höchstens fünf Diagnosen, je Meldung höchstens drei", () => {
        for (let nummer = 0; nummer < 7; nummer += 1)
            erfasseFehler("unbehandelt", new Error(`Fall ${"abcdefg"[nummer]!}`));
        vi.advanceTimersByTime(5000);
        expect(diagnosen()).toHaveLength(CLIENT_FEHLER_GRENZEN.jeSeite);
        expect(Math.max(...meldungen().map((koerper) => koerper.fehler?.length ?? 0))).toBeLessThanOrEqual(
            CLIENT_FEHLER_GRENZEN.jeMeldung,
        );
        expect(zaehlungen()).toEqual(["unbehandelt"]);
    });

    it("schickt auch vor dem Start der Zählung, ohne Seitenaufruf", () => {
        erfasseFehler("start", new SyntaxError("Unexpected token"));
        vi.advanceTimersByTime(1000);
        expect(meldungen().flatMap((koerper) => koerper.ereignisse.map((ereignis) => ereignis.metrik))).toEqual([
            "client_fehler",
        ]);
    });

    it("zieht eine wartende Meldung der Statistik vor, statt vier Sekunden zu warten", () => {
        starteBesuchsmeldung();
        fetchHorcher.mockClear();
        erfasseFehler("karte", new Error("Style is not done loading"));
        vi.advanceTimersByTime(1000);
        expect(zaehlungen()).toEqual(["karte"]);
    });
});

describe("Fänger am Fenster", () => {
    const fehlerEreignis = (fehler: unknown, datei = "https://avesmaps.de/assets/index-A.js") => ({
        error: fehler,
        filename: datei,
    });

    it("heißt vor der Oberfläche start, danach unbehandelt", () => {
        installiereFehlerfaenger();
        fensterHaken.get("error")?.(fehlerEreignis(new Error("vorher")));
        oberflaecheSteht();
        fensterHaken.get("error")?.(fehlerEreignis(new Error("nachher")));
        vi.advanceTimersByTime(1000);
        expect(zaehlungen()).toEqual(["start", "unbehandelt"]);
    });

    it("lässt Ereignisse ohne Fehlerobjekt, fremde Dateien und Abbrüche fallen", () => {
        installiereFehlerfaenger();
        oberflaecheSteht();
        fensterHaken.get("error")?.({ error: null, filename: "", message: "ResizeObserver loop completed" });
        fensterHaken.get("error")?.(fehlerEreignis(new Error("Erweiterung"), "chrome-extension://abc/inject.js"));
        fensterHaken.get("unhandledrejection")?.({ reason: new DOMException("überholt", "AbortError") });
        vi.advanceTimersByTime(1000);
        expect(meldungen()).toEqual([]);
    });

    it("nimmt eine unbehandelte Ablehnung", () => {
        installiereFehlerfaenger();
        oberflaecheSteht();
        fensterHaken.get("unhandledrejection")?.({ reason: new TypeError("Cannot read properties of undefined") });
        vi.advanceTimersByTime(1000);
        expect(diagnosen()[0]).toMatchObject({ art: "unbehandelt", name: "TypeError" });
    });
});

describe("Fänger für Vue", () => {
    it("schreibt in die Konsole und erfasst als vue", () => {
        const app = { config: {} as { errorHandler?: (fehler: unknown, instanz: unknown, info: string) => void } };
        const konsole = vi.spyOn(console, "error").mockImplementation(() => undefined);
        faengeVueFehler(app as never);
        const fehler = new TypeError("kaputt");
        app.config.errorHandler?.(fehler, null, "render function");
        vi.advanceTimersByTime(1000);
        expect(konsole).toHaveBeenCalledWith("Vue (render function):", fehler);
        expect(zaehlungen()).toEqual(["vue"]);
        konsole.mockRestore();
    });
});

describe("Fänger an der Karte", () => {
    function karteAttrappe(quellen: Record<string, { type?: string }> = { places: { type: "vector" } }) {
        const haken = new Map<string, (ereignis: unknown) => void>();
        const leinwandHaken = new Map<string, () => void>();
        const karte: KarteFuerFehler = {
            on: (art, h) => haken.set(art, h as (ereignis: unknown) => void),
            off: (art) => haken.delete(art),
            getCanvas: () =>
                ({
                    addEventListener: (art: string, h: () => void) => leinwandHaken.set(art, h),
                    removeEventListener: (art: string) => leinwandHaken.delete(art),
                }) as unknown as HTMLCanvasElement,
            getStyle: () => ({ sources: quellen }),
        };
        return { karte, haken, leinwandHaken };
    }
    let sichtbar = true;
    const uhr = {
        alle: (ms: number, tun: () => void) => {
            const id = setInterval(tun, ms);
            return () => clearInterval(id);
        },
        sichtbar: () => sichtbar,
    };
    beforeEach(() => {
        sichtbar = true;
    });

    it("zählt einen Fehler im Kartencode als karte, Ladefehler von Kacheln nicht", () => {
        const { karte, haken } = karteAttrappe();
        beobachteKartenfehler(karte, uhr);
        haken.get("error")?.({ error: { status: 503, message: "Service Unavailable" }, source: { type: "vector" } });
        haken.get("error")?.({ error: new Error("Kachel"), tile: {}, source: { type: "raster" } });
        expect(meldungen()).toEqual([]);
        haken.get("error")?.({ error: new Error("layers.x: Expected number") });
        vi.advanceTimersByTime(1000);
        expect(zaehlungen()).toEqual(["karte"]);
    });

    it("meldet den verlorenen Grafikkontext", () => {
        const { karte, leinwandHaken } = karteAttrappe();
        beobachteKartenfehler(karte, uhr);
        leinwandHaken.get("webglcontextlost")?.();
        vi.advanceTimersByTime(1000);
        expect(diagnosen()).toEqual([
            { art: "kontext_verloren", name: "WebGLContextLost", meldung: "", stellen: [], grafik: "ohne" },
        ]);
    });

    it("erkennt die Worker-Falle: sichtbare Zeit ohne jede Vektorkachel", () => {
        const { karte } = karteAttrappe();
        beobachteKartenfehler(karte, uhr);
        vi.advanceTimersByTime(WORKER_FRIST_MS - 5000);
        expect(zaehlungen()).toEqual([]);
        vi.advanceTimersByTime(5000 + 1000);
        expect(zaehlungen()).toEqual(["worker"]);
    });

    it("meldet keine Worker-Falle, wenn eine Vektorkachel kam, der Tab verborgen war oder die Karte keine Vektorquelle hat", () => {
        const geladen = karteAttrappe();
        beobachteKartenfehler(geladen.karte, uhr);
        geladen.haken.get("sourcedata")?.({ tile: {}, source: { type: "vector" } });
        vi.advanceTimersByTime(WORKER_FRIST_MS * 2);

        sichtbar = false;
        const abnehmen = beobachteKartenfehler(karteAttrappe().karte, uhr);
        vi.advanceTimersByTime(WORKER_FRIST_MS * 2);
        abnehmen();

        sichtbar = true;
        beobachteKartenfehler(karteAttrappe({ grund: { type: "raster" } }).karte, uhr);
        vi.advanceTimersByTime(WORKER_FRIST_MS * 2);

        expect(zaehlungen()).toEqual([]);
    });
});
