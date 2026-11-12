import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    beobachteKarte,
    haltBesuchsmeldung,
    melde,
    meldeEinmal,
    starteBesuchsmeldung,
} from "../src/besuch/besuch-melden.ts";

/**
 * Die Zusage „einmal je Besuch" (WI-0138 V10 für `tilt`, WI-0159 für `flight`, `profile`, `play`).
 *
 * 🔴 **Vier Stellen geben sie, eine Umsetzung trägt sie.** Bis WI-0159 merkte sich `beobachteNeigung` mit einem eigenen Flag,
 * ob `tilt` schon weg war; drei weitere Stellen hätten das Rezept dreimal wiederholt. Hier steht die Regel selbst.
 *
 * 🪤 Die Vitest-Umgebung ist `node`, und `starteBesuchsmeldung` steigt ohne `window` aus. Deshalb stehen hier die wenigen
 * Browserteile, die der Zähler wirklich anfasst - gegen das ECHTE Modul, nicht gegen einen Nachbau: Die Zusage soll an dem
 * Code hängen, der sie später hält.
 */

/** Was der Zähler an den Server geschickt hat, Metrik für Metrik. */
function gemeldet(fetchHorcher: ReturnType<typeof vi.fn>): string[] {
    const metriken: string[] = [];
    for (const [url, optionen] of fetchHorcher.mock.calls as [string, { body?: string }][]) {
        if (!url.endsWith("/api/besuch") || typeof optionen.body !== "string") continue;
        const koerper = JSON.parse(optionen.body) as { ereignisse: { metrik: string }[] };
        for (const ereignis of koerper.ereignisse) metriken.push(ereignis.metrik);
    }
    return metriken;
}

/** Dieselben Meldungen, aber mit Ausprägung: `zoom_band=nah`. */
function gemeldetMitWert(fetchHorcher: ReturnType<typeof vi.fn>): string[] {
    const eintraege: string[] = [];
    for (const [url, optionen] of fetchHorcher.mock.calls as [string, { body?: string }][]) {
        if (!url.endsWith("/api/besuch") || typeof optionen.body !== "string") continue;
        const koerper = JSON.parse(optionen.body) as { ereignisse: { metrik: string; dimension?: string }[] };
        for (const ereignis of koerper.ereignisse) eintraege.push(`${ereignis.metrik}=${ereignis.dimension ?? ""}`);
    }
    return eintraege;
}

/**
 * Eine Karte, soweit die Zählung sie braucht: `moveend`, Neigung, Zoom. Mehr sieht `beobachteKarte` nicht - und mehr soll es
 * nicht sehen können.
 */
function karteAttrappe(zoom = 6, neigung = 0) {
    let haken: (() => void) | undefined;
    const karte = {
        on: (art: string, h: () => void) => {
            if (art === "moveend") haken = h;
        },
        getZoom: () => zoom,
        getPitch: () => neigung,
    };
    return {
        karte,
        /** Die Karte kommt an dieser Stelle zur Ruhe. */
        ruhe(neuerZoom = zoom, neueNeigung = neigung) {
            zoom = neuerZoom;
            neigung = neueNeigung;
            haken?.();
        },
        hatHaken: () => haken !== undefined,
    };
}

let fetchHorcher: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.useFakeTimers();
    fetchHorcher = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchHorcher);
    vi.stubGlobal("location", { hash: "" });
    vi.stubGlobal("window", { addEventListener: vi.fn(), innerWidth: 1280, matchMedia: undefined });
    vi.stubGlobal("document", {
        addEventListener: vi.fn(),
        referrer: "",
        visibilityState: "visible",
        createElement: () => ({ getContext: () => null }),
    });
});

afterEach(() => {
    haltBesuchsmeldung();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("Einmal je Besuch melden", () => {
    it("meldet beim ersten Mal und schweigt danach", () => {
        starteBesuchsmeldung();
        fetchHorcher.mockClear();

        meldeEinmal("play");
        meldeEinmal("play");
        meldeEinmal("play");
        vi.advanceTimersByTime(4000);

        expect(gemeldet(fetchHorcher)).toEqual(["play"]);
    });

    it("hält die Metriken auseinander - jede hat ihr eigenes erstes Mal", () => {
        starteBesuchsmeldung();
        fetchHorcher.mockClear();

        for (const metrik of ["tilt", "flight", "profile", "play"] as const) {
            meldeEinmal(metrik);
            meldeEinmal(metrik);
        }
        vi.advanceTimersByTime(4000);

        expect(gemeldet(fetchHorcher)).toEqual(["tilt", "flight", "profile", "play"]);
    });

    it("hindert die gewöhnliche Meldung nicht - die zählt jedes Mal", () => {
        starteBesuchsmeldung();
        fetchHorcher.mockClear();

        meldeEinmal("play");
        melde("display_toggle", "toggleRivers:on");
        melde("display_toggle", "toggleRivers:off");
        meldeEinmal("play");
        vi.advanceTimersByTime(4000);

        expect(gemeldet(fetchHorcher)).toEqual(["play", "display_toggle", "display_toggle"]);
    });

    /**
     * 🪤 Vor dem Start darf nichts gemerkt werden: `melde` steigt dort aus, und ein Vermerk verschlösse die Metrik für den
     * ganzen Besuch. Ohne diesen Fall wäre `flight` nach einem Aufruf aus einer noch nicht gestarteten Oberfläche für immer
     * stumm - und niemand sähe es.
     */
    it("merkt vor dem Start nichts und meldet danach trotzdem", () => {
        meldeEinmal("flight");
        starteBesuchsmeldung();
        fetchHorcher.mockClear();

        meldeEinmal("flight");
        vi.advanceTimersByTime(4000);

        expect(gemeldet(fetchHorcher)).toEqual(["flight"]);
    });

    it("beginnt nach dem Anhalten neu - ein neuer Besuch ist ein neues erstes Mal", () => {
        starteBesuchsmeldung();
        meldeEinmal("profile");
        haltBesuchsmeldung();

        starteBesuchsmeldung();
        fetchHorcher.mockClear();
        meldeEinmal("profile");
        vi.advanceTimersByTime(4000);

        expect(gemeldet(fetchHorcher)).toEqual(["profile"]);
    });
});

/**
 * Die Zoomstufe und die Neigung an der Kartenruhe (WI-0161, WI-0286, `BESUCH-0001 §13 D`).
 *
 * 🔴 Bis WI-0161 holte sich der Haken `globalThis.avesmapsMap` - das Entwicklungs-Handle, das es im Release nicht gibt und das
 * beim Einhängen auch lokal noch fehlt. Er hängte sich darum nie ein, und `tilt` hatte seit WI-0138 keine einzige Zeile. Jetzt
 * übergibt `app.vue` die Karte; diese Fälle halten fest, was die Zählung daraus macht.
 *
 * Die Stufe ist die fachliche (`bandForRenderZoom`): MapLibre-Zoom minus eins, abgerundet, also Zoom 8 ist Stufe 7.
 */
describe("Was die Karte verrät", () => {
    it("merkt die Stufe beim Einhängen, meldet sie aber nicht - wer mit ?z=8 ankommt, ist nicht herangezoomt", () => {
        starteBesuchsmeldung();
        const { karte } = karteAttrappe(8);
        fetchHorcher.mockClear();

        beobachteKarte(karte);
        vi.advanceTimersByTime(4000);

        expect(gemeldetMitWert(fetchHorcher)).toEqual([]);
    });

    it("meldet den Wechsel der Stufe, nicht jede Kartenruhe", () => {
        starteBesuchsmeldung();
        const stapel = karteAttrappe(8);
        beobachteKarte(stapel.karte);
        fetchHorcher.mockClear();

        // Zwei Fahrten innerhalb von Stufe 7: keine Meldung.
        stapel.ruhe(8.4);
        stapel.ruhe(8.9);
        // Heraus auf Stufe 5, dann weiter auf Stufe 2: zwei Wechsel, zwei Meldungen.
        stapel.ruhe(6.2);
        stapel.ruhe(3.5);
        // Innerhalb von Stufe 2 bleiben: nichts.
        stapel.ruhe(3.9);
        vi.advanceTimersByTime(4000);

        expect(gemeldetMitWert(fetchHorcher)).toEqual(["zoom_stufe=5", "zoom_stufe=2"]);
    });

    it("zählt jedes Hin und Her - jeder Wechsel ist eine eigene Entscheidung", () => {
        starteBesuchsmeldung();
        const stapel = karteAttrappe(3);
        beobachteKarte(stapel.karte);
        fetchHorcher.mockClear();

        stapel.ruhe(8);
        stapel.ruhe(3);
        stapel.ruhe(8);
        vi.advanceTimersByTime(4000);

        expect(gemeldetMitWert(fetchHorcher)).toEqual(["zoom_stufe=7", "zoom_stufe=2", "zoom_stufe=7"]);
    });

    it("klemmt die Stufe an die Enden - die Karte zoomt über Stufe 8 hinaus und unter Stufe 0", () => {
        starteBesuchsmeldung();
        const stapel = karteAttrappe(5);
        beobachteKarte(stapel.karte);
        fetchHorcher.mockClear();

        stapel.ruhe(9.5);
        stapel.ruhe(0.4);
        vi.advanceTimersByTime(4000);

        expect(gemeldetMitWert(fetchHorcher)).toEqual(["zoom_stufe=8", "zoom_stufe=0"]);
    });

    /**
     * 🔴 Der Regressionsfall zu WI-0161: Ohne eine übergebene Karte hängte sich nichts ein, und `tilt` meldete in keiner
     * Umgebung. Die Neigung zählt einmal je Besuch, auch wenn die Karte zwanzigmal geneigt zur Ruhe kommt.
     */
    it("meldet die geneigte Karte, einmal je Besuch", () => {
        starteBesuchsmeldung();
        const stapel = karteAttrappe(6, 0);
        beobachteKarte(stapel.karte);
        fetchHorcher.mockClear();

        // Flach: keine Neigung gemeldet.
        stapel.ruhe(6, 0);
        stapel.ruhe(6, 3);
        expect(gemeldet(fetchHorcher)).toEqual([]);

        stapel.ruhe(6, 45);
        stapel.ruhe(6, 60);
        stapel.ruhe(6, 85);
        vi.advanceTimersByTime(4000);

        expect(gemeldet(fetchHorcher)).toEqual(["tilt"]);
    });

    /** Wer einem geneigten Link folgt und nichts anfasst, sieht die Karte trotzdem in 3D (WI-0286). */
    it("meldet die Neigung schon beim Einhängen", () => {
        starteBesuchsmeldung();
        const { karte } = karteAttrappe(6, 45);
        fetchHorcher.mockClear();

        beobachteKarte(karte);
        vi.advanceTimersByTime(4000);

        expect(gemeldet(fetchHorcher)).toEqual(["tilt"]);
    });

    it("hält Neigung und Stufe auseinander - eine geneigte Fahrt über eine Stufengrenze meldet beides", () => {
        starteBesuchsmeldung();
        const stapel = karteAttrappe(8, 0);
        beobachteKarte(stapel.karte);
        fetchHorcher.mockClear();

        stapel.ruhe(3, 50);
        vi.advanceTimersByTime(4000);

        expect(gemeldetMitWert(fetchHorcher)).toEqual(["tilt=", "zoom_stufe=2"]);
    });

    it("beginnt nach dem Anhalten mit einer neuen Startstufe", () => {
        starteBesuchsmeldung();
        const erste = karteAttrappe(8);
        beobachteKarte(erste.karte);
        erste.ruhe(3);
        haltBesuchsmeldung();

        starteBesuchsmeldung();
        const zweite = karteAttrappe(8);
        beobachteKarte(zweite.karte);
        fetchHorcher.mockClear();
        // Dieselbe Fahrt wie oben: Die Startstufe ist wieder 7, also ist Stufe 2 wieder ein Wechsel.
        zweite.ruhe(3);
        vi.advanceTimersByTime(4000);

        expect(gemeldetMitWert(fetchHorcher)).toEqual(["zoom_stufe=2"]);
    });
});

/** Wie die Seite läuft, gehört zum ersten Bündel (WI-0286): Hell oder dunkel und die Sprache der Oberfläche, nicht die des Browsers. */
describe("Der Start der Zählung", () => {
    it("meldet Seitenaufruf, Design und eingestellte Sprache in einer Meldung", () => {
        starteBesuchsmeldung();

        const koerper = fetchHorcher.mock.calls
            .filter(([url]) => String(url).endsWith("/api/besuch"))
            .map(([, optionen]) => JSON.parse((optionen as { body: string }).body) as { ereignisse: unknown[] });
        expect(koerper).toHaveLength(1);
        expect(koerper[0]?.ereignisse).toEqual([
            { metrik: "pageview" },
            { metrik: "theme", dimension: "light" },
            { metrik: "sprache_eingestellt", dimension: "de" },
        ]);
    });
});

/** Die Meldungen an `/api/besuch` als Rumpf, in der Reihenfolge des Sendens. */
function rumpfe(fetchHorcher: ReturnType<typeof vi.fn>): { ereignisse: { metrik: string }[]; bestaetigt?: unknown }[] {
    return (fetchHorcher.mock.calls as [string, { body?: string }][])
        .filter(([url, optionen]) => url.endsWith("/api/besuch") && typeof optionen.body === "string")
        .map(
            ([, optionen]) => JSON.parse(optionen.body!) as { ereignisse: { metrik: string }[]; bestaetigt?: unknown },
        );
}

/**
 * OPS-000118 (der Melder 2026-11-11: viele Besuche unter zehn Sekunden, ein Filter, der sie ausblendet): Die Seite bestätigt sich nach zehn
 * Sekunden mit allem bisher, und beim Verschwinden misst ein Abschied das Ende des Besuchs.
 */
describe("Bestätigung nach 10 s und Abschied (OPS-000118)", () => {
    it("🔴 nach 10 s geht alles bisher als Nachtrag weg, danach trägt jede Meldung `bestaetigt`", () => {
        starteBesuchsmeldung();
        melde("search_empty");
        vi.advanceTimersByTime(4000);
        vi.advanceTimersByTime(6000);
        melde("route");
        vi.advanceTimersByTime(4000);

        const gesendet = rumpfe(fetchHorcher);
        expect(
            gesendet.map((rumpf) => [rumpf.bestaetigt ?? "-", rumpf.ereignisse.map((e) => e.metrik).join(",")]),
        ).toEqual([
            ["-", "pageview,theme,sprache_eingestellt"],
            ["-", "search_empty"],
            ["nachtrag", "pageview,theme,sprache_eingestellt,search_empty"],
            [true, "route"],
        ]);
    });

    it("was bei der Bestätigung noch wartet, geht erst gewöhnlich und dann im Nachtrag, je einmal", () => {
        starteBesuchsmeldung();
        vi.advanceTimersByTime(8000);
        melde("search_empty");
        vi.advanceTimersByTime(2000);

        const gesendet = rumpfe(fetchHorcher);
        expect(
            gesendet.map((rumpf) => [rumpf.bestaetigt ?? "-", rumpf.ereignisse.map((e) => e.metrik).join(",")]),
        ).toEqual([
            ["-", "pageview,theme,sprache_eingestellt"],
            ["-", "search_empty"],
            ["nachtrag", "pageview,theme,sprache_eingestellt,search_empty"],
        ]);
    });

    it("unter 10 s geschlossen: kein Nachtrag", () => {
        starteBesuchsmeldung();
        vi.advanceTimersByTime(9000);
        haltBesuchsmeldung();
        vi.advanceTimersByTime(5000);
        expect(rumpfe(fetchHorcher).some((rumpf) => rumpf.bestaetigt !== undefined)).toBe(false);
    });

    it("🔴 verschwindet die Seite, misst ein Abschied das Ende, auch wenn sie schon verborgen ist", () => {
        starteBesuchsmeldung();
        const haken = (document.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
            ([art]) => art === "visibilitychange",
        )?.[1] as () => void;
        fetchHorcher.mockClear();
        (document as { visibilityState: string }).visibilityState = "hidden";
        haken();

        const pings = (fetchHorcher.mock.calls as [string, { body?: string }][])
            .filter(([url]) => url.endsWith("/api/besuch/ping"))
            .map(([, optionen]) => JSON.parse(optionen.body!) as { zustand: string });
        expect(pings.map((ping) => ping.zustand)).toEqual(["hidden"]);
    });
});
