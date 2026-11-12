import { afterEach, describe, expect, it } from "vitest";
import { AVENTURIA_SERIES, KARTENSERIE_THUMB_VORGABE, type MapSeriesCatalog } from "@avesmaps3d/shared";
import {
    kartenserie,
    kartenserienKatalog,
    kartenserienZuruecksetzen,
    kartenserieThumb,
    ladeKartenserien,
    leseKatalog,
} from "../src/map/kartenserien-stand";

/**
 * Der Katalog der Kartenserien im Browser (WI-0220): gelesen vor dem Start, tolerant, ohne Antwort die gebündelte Vorgabe.
 */

const umbenannt = (): MapSeriesCatalog => ({
    ...AVENTURIA_SERIES,
    defaultSeries: "original",
    series: AVENTURIA_SERIES.series.map((s) =>
        s.id === "original" ? { ...s, label: "Ina Kramer", thumb: { x: 3, y: 9 } } : s,
    ),
});

const antwort = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status, headers: { etag: '"k1"' } })) as unknown as typeof fetch;

afterEach(() => kartenserienZuruecksetzen());

describe("Kartenserien im Browser", () => {
    it("🔴 ohne Antwort gilt die gebündelte Vorgabe, nie ein Fehler", async () => {
        const katalog = await ladeKartenserien((async () => {
            throw new Error("offline");
        }) as unknown as typeof fetch);
        expect(katalog).toBe(AVENTURIA_SERIES);
    });

    it("eine passende Antwort ersetzt den Katalog", async () => {
        await ladeKartenserien(antwort(umbenannt()));
        expect(kartenserienKatalog().defaultSeries).toBe("original");
        expect(kartenserie("original").label).toBe("Ina Kramer");
        expect(kartenserieThumb(kartenserie("original"))).toEqual({ x: 3, y: 9 });
    });

    it("🔴 tolerant: eine Antwort außerhalb des Schemas oder ohne Serie wird verworfen", async () => {
        expect(leseKatalog({ series: [] })).toBeUndefined();
        expect(leseKatalog({ ...AVENTURIA_SERIES, series: [] })).toBeUndefined();
        expect(leseKatalog({ ...AVENTURIA_SERIES, defaultSeries: "gibtesnicht" })).toBeUndefined();
        await ladeKartenserien(antwort({ unsinn: true }));
        expect(kartenserienKatalog()).toBe(AVENTURIA_SERIES);
        await ladeKartenserien(antwort(umbenannt(), 500));
        expect(kartenserienKatalog()).toBe(AVENTURIA_SERIES);
    });

    it("eine unbekannte Kennung (alter Link, gelöschte Serie) fällt auf die Vorgabe-Serie zurück; ohne eigenes Bild gilt Gareth", () => {
        expect(kartenserie("gibtesnicht").id).toBe(AVENTURIA_SERIES.defaultSeries);
        expect(kartenserieThumb(kartenserie("modern"))).toEqual(KARTENSERIE_THUMB_VORGABE);
    });
});
