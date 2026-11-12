import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    PHOTOBOX_CREATION_KINDS,
    PHOTOBOX_LIMITS,
    PHOTOBOX_TERMS_VERSION,
    PhotoboxEinreichung,
    photoboxGrantAllowed,
    roundMapCoordinate,
    type SearchHit,
    type SearchResponse,
} from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api.ts";
import type { Vorbereitet } from "../src/auth/kanal-bild.ts";
import type { FormularKennung } from "../src/community/api.ts";
import type { BezugOrt } from "../src/community/meldung-modell.ts";
import { de } from "../src/i18n/de.ts";
import type { MessageKey } from "../src/i18n/de.ts";
import { FEHLER_SATZ, fehlerArt, ladeStand, ladeVorschau, reisebildAdresse } from "../src/photobox/api.ts";
import { BILD_TYPEN, bereiteBildVor, istErlaubterTyp, type GewaehltesBild } from "../src/photobox/bild.ts";
import { BEZUG_MAX, bezugAusTreffer, letztesWort, sucheBezuege, type BezugWahl } from "../src/photobox/bezug-suche.ts";
import {
    drahtBody,
    fehlendes,
    leererEntwurf,
    nutzungGesperrt,
    ortUndBezug,
    richtungAusWert,
    richtungWert,
    sperrGrund,
    waehleEntstehung,
    type ReisebildEntwurf,
} from "../src/photobox/formular-modell.ts";
import { REISEBILD_SYMBOLE } from "../src/photobox/reisebild-zeichen.ts";
import {
    BLICK_RICHTUNGEN,
    ORT_NAH,
    RICHTUNGEN,
    richtungVonOrt,
    stelleText,
    type Uebersetzer,
} from "../src/photobox/stelle-text.ts";

/**
 * Das Formular „Eigenes Bild hinzufügen“ ohne Browser (WI-0272 S2b, Aufgabe 13; WI §5.1, §12): die Stelle in Worten, die Pflichtfelder samt Grund der Sperre, die Wahl der Nutzung, der Rumpf der
 * Einreichung gegen das Schema des Servers (`PhotoboxEinreichung`), das Bild, der Bezug aus der Suche und die Aufrufe samt Fehlern. Den Browser prüft `e2e/reisebild-einreichen.spec.ts`.
 */

/** Ein Übersetzer über die deutsche Tafel, ohne die Sprache der Seite: `{name}` wird ersetzt. */
const deutsch: Uebersetzer = (key, params) =>
    (de[key as keyof typeof de] as string).replace(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? ""));

const GARETH_ID = "00000000-0000-4000-8000-000000000001";
const GARETH: BezugOrt = { id: GARETH_ID, name: "Gareth", typ: "metropole", lage: { x: 551.625, y: 532.969 } };

describe("🔴 die Stelle in Worten", () => {
    it("innerhalb von ORT_NAH heißt es „in Gareth“", () => {
        expect(stelleText({ x: 552, y: 533 }, GARETH, deutsch)).toBe("in Gareth");
        expect(stelleText({ x: GARETH.lage.x + ORT_NAH, y: GARETH.lage.y }, GARETH, deutsch)).toBe("in Gareth");
    });

    it("darüber „nordöstlich von Gareth“: Karteneinheiten mit y nach Norden, x nach Osten", () => {
        expect(stelleText({ x: GARETH.lage.x + 18, y: GARETH.lage.y + 17 }, GARETH, deutsch)).toBe(
            "nordöstlich von Gareth",
        );
    });

    it("alle acht Richtungen vom Ort aus (Osten ist +x, Norden ist +y)", () => {
        const von = (dx: number, dy: number) => richtungVonOrt({ x: 100 + dx, y: 100 + dy }, { x: 100, y: 100 });
        expect(von(20, 0)).toBe("o");
        expect(von(20, 20)).toBe("no");
        expect(von(0, 20)).toBe("n");
        expect(von(-20, 20)).toBe("nw");
        expect(von(-20, 0)).toBe("w");
        expect(von(-20, -20)).toBe("sw");
        expect(von(0, -20)).toBe("s");
        expect(von(20, -20)).toBe("so");
        expect(new Set(RICHTUNGEN).size).toBe(8);
        const worte = RICHTUNGEN.map((r) => de[`photobox.richtungVon.${r}` as MessageKey]);
        expect(worte).toEqual([
            "östlich",
            "nordöstlich",
            "nördlich",
            "nordwestlich",
            "westlich",
            "südwestlich",
            "südlich",
            "südöstlich",
        ]);
    });

    it("ohne Ort (die Antwort ist unterwegs, oder es gibt keinen) bleibt es bei „Stelle auf der Karte“", () => {
        expect(stelleText({ x: 1, y: 2 }, undefined, deutsch)).toBe("Stelle auf der Karte");
    });
});

const BILD: GewaehltesBild = {
    datei: { name: "reisebild.webp", dataBase64: "UklGRg==" },
    breite: 640,
    hoehe: 480,
    anzeigeName: "urlaub-IMG_0042.jpg",
};
const KENNUNG: FormularKennung = { operationId: "5b0d6f0e-6f6e-4c7b-8a5e-0d2f4c9b7a11", schluessel: "A".repeat(43) };

const entwurf = (teil: Partial<ReisebildEntwurf> = {}): ReisebildEntwurf => ({
    ...leererEntwurf(),
    bild: BILD,
    text: "Der Markt am Morgen.",
    entstehung: "photo",
    haken: true,
    ...teil,
});

describe("🔴 Einreichen bleibt gesperrt ohne Bild, Beschreibung, Angabe „Entstanden als“ oder Häkchen", () => {
    it("der erste fehlende Punkt in der Reihenfolge des Formulars, mit seinem Satz", () => {
        expect(sperrGrund(leererEntwurf())).toBe("photobox.sperre.bild");
        expect(sperrGrund(entwurf({ bild: undefined }))).toBe("photobox.sperre.bild");
        expect(sperrGrund(entwurf({ text: "" }))).toBe("photobox.sperre.text");
        expect(sperrGrund(entwurf({ text: "   \n " }))).toBe("photobox.sperre.text");
        expect(sperrGrund(entwurf({ entstehung: "" }))).toBe("photobox.sperre.entstehung");
        expect(sperrGrund(entwurf({ haken: false }))).toBe("photobox.sperre.haken");
        expect(sperrGrund(entwurf())).toBeUndefined();
    });

    it("🔴 ein Druck auf den gesperrten Knopf braucht das fehlende Feld: dasselbe, das `sperrGrund` meint, in der Reihenfolge des Formulars (Entwurf 8)", () => {
        expect(fehlendes(leererEntwurf())).toEqual({ feld: "bild", grund: "photobox.sperre.bild" });
        expect(fehlendes(entwurf({ text: "" }))).toEqual({ feld: "text", grund: "photobox.sperre.text" });
        expect(fehlendes(entwurf({ text: "x".repeat(PHOTOBOX_LIMITS.descriptionMax + 1) }))).toEqual({
            feld: "text",
            grund: "photobox.sperre.textLang",
        });
        expect(fehlendes(entwurf({ entstehung: "" }))).toEqual({
            feld: "entstehung",
            grund: "photobox.sperre.entstehung",
        });
        expect(fehlendes(entwurf({ haken: false }))).toEqual({ feld: "haken", grund: "photobox.sperre.haken" });
        expect(fehlendes(entwurf())).toBeUndefined();
        // Fehlt mehr als eins, kommt das erste dran; danach läuft der Grund mit, bis alles da ist.
        expect(fehlendes(entwurf({ text: "", haken: false }))?.feld).toBe("text");
        for (const alt of [
            leererEntwurf(),
            entwurf({ text: "" }),
            entwurf({ entstehung: "" }),
            entwurf({ haken: false }),
        ]) {
            expect(fehlendes(alt)?.grund).toBe(sperrGrund(alt));
        }
    });

    it("die Blickrichtung der Auswahlliste: „ohne“ ist leer, sonst die Himmelsrichtung 0 (Norden) bis 7, alles andere heißt ohne", () => {
        expect(richtungWert(undefined)).toBe("");
        expect(richtungWert(0)).toBe("0");
        expect(richtungWert(7)).toBe("7");
        expect(richtungAusWert("")).toBeUndefined();
        expect(richtungAusWert("0")).toBe(0);
        expect(richtungAusWert("4")).toBe(4);
        expect(richtungAusWert("7")).toBe(7);
        for (const falsch of ["8", "-1", "1.5", "x", "01", " 2"]) expect(richtungAusWert(falsch)).toBeUndefined();
        for (let nr = 0; nr < 8; nr += 1) expect(richtungAusWert(richtungWert(nr))).toBe(nr);
    });

    it("die Beschreibung zählt getrimmt und darf höchstens 300 Zeichen haben", () => {
        expect(sperrGrund(entwurf({ text: "x".repeat(PHOTOBOX_LIMITS.descriptionMax) }))).toBeUndefined();
        expect(sperrGrund(entwurf({ text: "x".repeat(PHOTOBOX_LIMITS.descriptionMax + 1) }))).toBe(
            "photobox.sperre.textLang",
        );
        expect(sperrGrund(entwurf({ text: `  ${"x".repeat(PHOTOBOX_LIMITS.descriptionMax)}  ` }))).toBeUndefined();
    });

    it("die Wahl „Entstanden als“ hat keine Vorgabe (raten wäre eine falsche Auskunft); nur die Nutzung hat eine", () => {
        const leer = leererEntwurf();
        expect(leer.entstehung).toBe("");
        expect(leer.nutzung).toBe("avesmaps_only");
        expect(leer.haken).toBe(false);
    });

    it("jeder gesperrte Grund ist ein Satz der deutschen Tafel", () => {
        for (const key of [
            "photobox.sperre.bild",
            "photobox.sperre.text",
            "photobox.sperre.textLang",
            "photobox.sperre.entstehung",
            "photobox.sperre.haken",
        ] as const) {
            expect(de[key]).toMatch(/\S/u);
        }
    });

    it("„Noch ein Bild von hier“ nimmt Art und Name mit, nie Bild, Text oder Häkchen", () => {
        const neu = leererEntwurf({ entstehung: "drawing", name: "Alrik" });
        expect(neu).toMatchObject({ entstehung: "drawing", name: "Alrik", bild: undefined, text: "", haken: false });
    });
});

describe("🔴 CC BY ist gesperrt bei einer Avesmaps-Aufnahme", () => {
    it("die Nutzung ist nur bei der Aufnahme gesperrt, mit dem Satz dazu", () => {
        expect(nutzungGesperrt(entwurf({ entstehung: "avesmaps_capture" }), "cc-by-4.0")).toBe(
            "photobox.nutzung.gesperrtAufnahme",
        );
        expect(nutzungGesperrt(entwurf({ entstehung: "avesmaps_capture" }), "avesmaps_only")).toBeUndefined();
        for (const art of ["drawing", "photo", "ai_generated"] as const) {
            expect(nutzungGesperrt(entwurf({ entstehung: art }), "cc-by-4.0")).toBeUndefined();
        }
        // Solange „Entstanden als“ fehlt, ist nichts gesperrt.
        expect(nutzungGesperrt(entwurf({ entstehung: "" }), "cc-by-4.0")).toBeUndefined();
    });

    it("wer CC BY gewählt hatte und dann „Avesmaps-Aufnahme“ wählt, bekommt die Vorgabe zurück (die Datenbank wiese die Kombination ab)", () => {
        const e = entwurf({ nutzung: "cc-by-4.0", entstehung: "photo" });
        waehleEntstehung(e, "avesmaps_capture");
        expect(e.entstehung).toBe("avesmaps_capture");
        expect(e.nutzung).toBe("avesmaps_only");
        expect(photoboxGrantAllowed("avesmaps_capture", e.nutzung)).toBe(true);
        const f = entwurf({ nutzung: "cc-by-4.0" });
        waehleEntstehung(f, "drawing");
        expect(f.nutzung).toBe("cc-by-4.0");
    });
});

describe("🔴 die Nutzlast trägt die Fassung der Bedingungen und die gemessene Dauer", () => {
    const lage = { x: 552.123456, y: 533.987654 };

    it("der Rumpf besteht das Schema des Servers, mit den Bedingungen, der Dauer und dem Honigtopf", () => {
        const body = drahtBody(KENNUNG, entwurf({ honig: "" }), lage, GARETH, 12_345.6);
        expect(
            Value.Check(PhotoboxEinreichung, body),
            JSON.stringify([...Value.Errors(PhotoboxEinreichung, body)].slice(0, 3)),
        ).toBe(true);
        expect(body.bedingungen).toBe(PHOTOBOX_TERMS_VERSION);
        expect(body.falle).toEqual({ feld: "", dauerMs: 12_346 });
        expect(body).toMatchObject({
            operationId: KENNUNG.operationId,
            schluessel: KENNUNG.schluessel,
            entstehung: "photo",
            nutzung: "avesmaps_only",
            bild: BILD.datei,
        });
    });

    it("ein gefüllter Honigtopf geht mit (der Server verwirft ihn still)", () => {
        const body = drahtBody(KENNUNG, entwurf({ honig: "http://spam" }), lage, undefined, 9000);
        expect(body.falle.feld).toBe("http://spam");
    });

    it("Beschreibung und Name gehen getrimmt, ein leerer Name fehlt, die Lage ist gerundet", () => {
        const body = drahtBody(
            KENNUNG,
            entwurf({ text: "  Der Markt.  \n", name: "  Alrik  " }),
            lage,
            undefined,
            5000,
        );
        expect(body.beschreibung).toBe("Der Markt.");
        expect(body.name).toBe("Alrik");
        const ohne = drahtBody(KENNUNG, entwurf({ name: "   " }), lage, undefined, 5000);
        expect(ohne).not.toHaveProperty("name");
        expect(body.lage).toEqual({ x: roundMapCoordinate(lage.x), y: roundMapCoordinate(lage.y) });
        expect(body.lage).not.toEqual(lage);
    });

    it("der Name wird auf 80 Zeichen gekürzt (PHOTOBOX_LIMITS.attributionMax)", () => {
        const body = drahtBody(KENNUNG, entwurf({ name: "n".repeat(120) }), lage, undefined, 5000);
        expect(body.name?.length).toBe(PHOTOBOX_LIMITS.attributionMax);
    });

    it("die Blickrichtung 0 (Norden) geht mit, ohne Wahl fehlt das Feld", () => {
        expect(drahtBody(KENNUNG, entwurf({ richtung: 0 }), lage, undefined, 5000).blickrichtung).toBe(0);
        expect(drahtBody(KENNUNG, entwurf({ richtung: 7 }), lage, undefined, 5000).blickrichtung).toBe(7);
        expect(drahtBody(KENNUNG, entwurf(), lage, undefined, 5000)).not.toHaveProperty("blickrichtung");
    });

    it("die Dauer ist nie negativ", () => {
        expect(drahtBody(KENNUNG, entwurf(), lage, undefined, -5).falle.dauerMs).toBe(0);
    });

    it("wirft, wo „Einreichen“ gesperrt wäre: Der Aufrufer prüft zuerst", () => {
        expect(() => drahtBody(KENNUNG, entwurf({ haken: false }), lage, undefined, 5000)).toThrow();
        expect(() => drahtBody(KENNUNG, entwurf({ bild: undefined }), lage, undefined, 5000)).toThrow();
    });

    it("alle vier Arten und beide Nutzungen bestehen das Schema; die Aufnahme nur mit der Vorgabe", () => {
        for (const art of PHOTOBOX_CREATION_KINDS) {
            const e = entwurf({ entstehung: art });
            const body = drahtBody(KENNUNG, e, lage, undefined, 5000);
            expect(Value.Check(PhotoboxEinreichung, body), art).toBe(true);
        }
    });
});

describe("der Ort des Bildes und der Bezug", () => {
    const chip = (art: BezugWahl["art"], id: string): BezugWahl => ({ art, id, name: "X", typ: "Y" });

    it("liegt die Stelle „in“ dem Ort, ist er der Ort des Bildes (automatischer Bezug, WI §4)", () => {
        expect(ortUndBezug({ x: 552, y: 533 }, GARETH, undefined)).toEqual({ placeId: GARETH_ID });
        expect(ortUndBezug({ x: 700, y: 600 }, GARETH, undefined)).toEqual({});
        expect(ortUndBezug({ x: 552, y: 533 }, undefined, undefined)).toEqual({});
    });

    it("ein Treffer der Art Ort mit öffentlicher Kennung ist der Ort des Bildes, jede andere Art der Bezug", () => {
        const anderer = "11111111-2222-4333-8444-555555555555";
        expect(ortUndBezug({ x: 700, y: 600 }, GARETH, chip("ort", anderer))).toEqual({ placeId: anderer });
        expect(ortUndBezug({ x: 700, y: 600 }, GARETH, chip("weg", "name:Reichsstraße 1"))).toEqual({
            bezug: { art: "weg", id: "name:Reichsstraße 1" },
        });
        // Beides zugleich: der Ort, in dem die Stelle liegt, und die Landschaft, die das Bild zeigt.
        expect(ortUndBezug({ x: 552, y: 533 }, GARETH, chip("landschaft", "region-1"))).toEqual({
            placeId: GARETH_ID,
            bezug: { art: "landschaft", id: "region-1" },
        });
    });

    it("ein Ort ohne öffentliche Kennung geht als Bezug, nicht als placeId (der Vertrag kennt „ein Ort ohne placeId“)", () => {
        expect(ortUndBezug({ x: 700, y: 600 }, GARETH, chip("ort", "gebaeude-17"))).toEqual({
            bezug: { art: "ort", id: "gebaeude-17" },
        });
    });

    it("der gewählte Bezug geht in den Rumpf und besteht das Schema", () => {
        const body = drahtBody(
            KENNUNG,
            entwurf({ bezug: chip("klima", "tropisch") }),
            { x: 700, y: 600 },
            undefined,
            5000,
        );
        expect(body.bezug).toEqual({ art: "klima", id: "tropisch" });
        expect(Value.Check(PhotoboxEinreichung, body)).toBe(true);
    });
});

describe("das Bild: nur vier Formate, nie der Dateiname des Besuchers", () => {
    const datei = (name: string, type: string): File => new File([new Uint8Array([1, 2, 3])], name, { type });
    const vorbereitet = (name: string): Vorbereitet => ({
        ok: true,
        datei: { name, dataBase64: "AAAA" },
        breite: 100,
        hoehe: 50,
    });

    it("JPEG, PNG, WebP und GIF sind erlaubt, SVG und das übrige nicht", () => {
        expect(BILD_TYPEN).toEqual(["image/jpeg", "image/png", "image/webp", "image/gif"]);
        for (const typ of BILD_TYPEN) expect(istErlaubterTyp(typ)).toBe(true);
        expect(istErlaubterTyp("IMAGE/PNG")).toBe(true);
        for (const typ of ["image/svg+xml", "image/avif", "application/pdf", "text/html", ""]) {
            expect(istErlaubterTyp(typ), typ).toBe(false);
        }
    });

    it("ein SVG wird gar nicht erst gelesen", async () => {
        let gerufen = false;
        const ergebnis = await bereiteBildVor(datei("karte.svg", "image/svg+xml"), async () => {
            gerufen = true;
            return vorbereitet("x.webp");
        });
        expect(ergebnis).toEqual({ ok: false, grund: "kein_bild" });
        expect(gerufen).toBe(false);
    });

    it("🔴 der Name des Besuchers bleibt auf dem Gerät: Die Datei trägt `reisebild.webp`, der alte Name steht nur zur Anzeige", async () => {
        const ergebnis = await bereiteBildVor(datei("Urlaub mit Oma IMG_0042.jpg", "image/jpeg"), async () =>
            vorbereitet("Urlaub mit Oma IMG_0042.webp"),
        );
        expect(ergebnis.ok).toBe(true);
        if (!ergebnis.ok) return;
        expect(ergebnis.bild.datei).toEqual({ name: "reisebild.webp", dataBase64: "AAAA" });
        expect(ergebnis.bild.anzeigeName).toBe("Urlaub mit Oma IMG_0042.jpg");
        expect(ergebnis.bild).toMatchObject({ breite: 100, hoehe: 50 });
    });

    it("ein Browser ohne WebP-Kodierer liefert PNG: Die Endung folgt", async () => {
        const ergebnis = await bereiteBildVor(datei("a.png", "image/png"), async () => vorbereitet("a.png"));
        expect(ergebnis.ok && ergebnis.bild.datei.name).toBe("reisebild.png");
    });

    it("zu groß oder kein Bild: der Grund geht durch, es entsteht kein Bild", async () => {
        const zuGross = await bereiteBildVor(datei("a.jpg", "image/jpeg"), async () => ({
            ok: false,
            grund: "zu_gross",
        }));
        expect(zuGross).toEqual({ ok: false, grund: "zu_gross" });
        const kaputt = await bereiteBildVor(datei("a.jpg", "image/jpeg"), async () => ({
            ok: false,
            grund: "kein_bild",
        }));
        expect(kaputt).toEqual({ ok: false, grund: "kein_bild" });
    });
});

describe("der Bezug aus der mitlaufenden Suche", () => {
    const treffer = (id: string, name: string, kind: SearchHit["kind"] = "ort"): SearchHit => ({
        kind,
        id,
        name,
        x: 1,
        y: 2,
        zoom: 5,
        ...(kind === "ort" ? { subtype: "stadt" } : {}),
    });

    it("gesucht wird das letzte Wort, ab drei Zeichen", () => {
        expect(letztesWort("Der Markt von Gareth")).toBe("Gareth");
        expect(letztesWort("Der Markt von Gareth ")).toBe("Gareth");
        expect(letztesWort("Blick auf die Reichsstraße.")).toBe("Reichsstraße");
        expect(letztesWort("am Ga")).toBeUndefined();
        expect(letztesWort("")).toBeUndefined();
        expect(letztesWort("  ,, ")).toBeUndefined();
        expect(letztesWort("Lieferstraße 12")).toBeUndefined();
        expect(letztesWort("Zimmer 123")).toBe("123");
    });

    it("höchstens fünf Treffer, ohne den schon gewählten", async () => {
        const antwort: SearchResponse = {
            query: "gar",
            hits: ["a", "b", "c", "d", "e", "f", "g"].map((id) => treffer(id, `Ort ${id}`)),
            truncated: false,
        };
        const alle = await sucheBezuege("gar", undefined, undefined, async () => antwort);
        expect(alle.map((wahl) => wahl.id)).toEqual(["a", "b", "c", "d", "e"]);
        expect(alle).toHaveLength(BEZUG_MAX);
        const ohne = await sucheBezuege("gar", undefined, bezugAusTreffer(treffer("a", "Ort a")), async () => antwort);
        expect(ohne.map((wahl) => wahl.id)).toEqual(["b", "c", "d", "e", "f"]);
    });

    it("ein Treffer trägt Art, Schlüssel, Name und die Art in Worten (Metropole, Wald …)", () => {
        const wahl = bezugAusTreffer(treffer("00000000-0000-4000-8000-000000000001", "Gareth"));
        expect(wahl).toMatchObject({ art: "ort", id: "00000000-0000-4000-8000-000000000001", name: "Gareth" });
        expect(wahl.typ).toMatch(/\S/u);
    });
});

describe("die Aufrufe und ihre Fehler", () => {
    const fehler = (status: number, code: string) => new ApiFailure(status, code, code);

    it("🔴 jeder Code des Servers wählt seinen eigenen Satz (ADR-0018: nie der Text des Servers)", () => {
        expect(fehlerArt(fehler(429, "photobox_rate"))).toBe("zu_viele");
        expect(fehlerArt(fehler(503, "photobox_paused"))).toBe("pausiert");
        expect(fehlerArt(fehler(503, "photobox_unavailable"))).toBe("pausiert");
        expect(fehlerArt(fehler(404, "photobox_not_found"))).toBe("nicht_gefunden");
        expect(fehlerArt(fehler(409, "photobox_transition"))).toBe("uebergang");
        expect(fehlerArt(fehler(409, "photobox_replace_limit"))).toBe("zu_oft_ersetzt");
        expect(fehlerArt(fehler(409, "photobox_key_used"))).toBe("schluessel_belegt");
        expect(fehlerArt(fehler(415, "unsupported_media_type"))).toBe("format");
        expect(fehlerArt(fehler(422, "photobox_invalid"))).toBe("ungueltig");
        expect(fehlerArt(fehler(400, "validation_failed"))).toBe("ungueltig");
        expect(fehlerArt(fehler(0, "network"))).toBe("netz");
        expect(fehlerArt(fehler(500, "irgendwas"))).toBe("sonst");
        expect(fehlerArt(new Error("x"))).toBe("sonst");
        // Ohne bekannten Code entscheidet der Status.
        expect(fehlerArt(fehler(429, "anders"))).toBe("zu_viele");
        expect(fehlerArt(fehler(503, "anders"))).toBe("pausiert");
        expect(fehlerArt(fehler(413, "anders"))).toBe("ungueltig");
    });

    it("jede Art hat einen Satz der deutschen Tafel", () => {
        for (const key of Object.values(FEHLER_SATZ)) expect(de[key]).toMatch(/\S/u);
        expect(de["photobox.status.fehlt"]).toBe("Zu diesem Link gibt es kein Reisebild (mehr).");
    });

    it("die Adresse der Statusseite trägt den Schlüssel im Fragment, nie in der Suche", () => {
        expect(reisebildAdresse("https://avesmaps.de", "A".repeat(43))).toBe(
            `https://avesmaps.de/reisebild#${"A".repeat(43)}`,
        );
    });

    it("ladeStand: eine fehlende Antwort ist ein Nein, ein Ja nur bei `einreichen: true`", async () => {
        const antwort = (body: unknown, status = 200): typeof fetch =>
            (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
        expect(await ladeStand(antwort({ einreichen: true }))).toBe(true);
        expect(await ladeStand(antwort({ einreichen: false }))).toBe(false);
        expect(await ladeStand(antwort({ error: { code: "x" } }, 500))).toBe(false);
        expect(await ladeStand((async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toBe(
            false,
        );
    });

    it("ladeVorschau: ein Bild als Blob, 404 `photobox_preview_missing` heißt „noch nicht berechnet“, jeder andere Fehler ein ApiFailure; der Schlüssel geht im Rumpf", async () => {
        let gesehen: { url: string; init: RequestInit } | undefined;
        const mit = (antwort: Response): typeof fetch =>
            (async (url: string, init: RequestInit) => {
                gesehen = { url, init };
                return antwort;
            }) as unknown as typeof fetch;
        const schluessel = "B".repeat(43);
        const blob = await ladeVorschau(
            schluessel,
            mit(new Response(new Uint8Array([82, 73, 70, 70]), { status: 200 })),
        );
        expect(blob).toBeInstanceOf(Blob);
        expect(gesehen?.url).toBe("/api/photobox/status/vorschau");
        expect(gesehen?.url).not.toContain(schluessel);
        expect(JSON.parse(gesehen?.init.body as string)).toEqual({ schluessel });
        expect(gesehen?.init.method).toBe("POST");

        const json = (status: number, code: string) =>
            new Response(JSON.stringify({ error: { code, message: code } }), { status });
        expect(await ladeVorschau(schluessel, mit(json(404, "photobox_preview_missing")))).toBe("fehlt");
        await expect(ladeVorschau(schluessel, mit(json(404, "photobox_not_found")))).rejects.toMatchObject({
            code: "photobox_not_found",
            status: 404,
        });
        await expect(ladeVorschau(schluessel, mit(new Response("kein json", { status: 500 })))).rejects.toMatchObject({
            code: "unavailable",
        });
        await expect(
            ladeVorschau(schluessel, (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch),
        ).rejects.toMatchObject({ code: "network", status: 0 });
    });
});

describe("das Fenster hält die Zusagen, die der Browser nicht allein beweist", () => {
    const ordner = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "photobox"));
    const lies = (name: string): string => readFileSync(join(ordner, name), "utf8");
    /** Die Hülle (Zustand, Kennung, Fenster), der Rumpf des Formulars und sein Fuß: zusammen „das Fenster“. */
    const huelle = lies("reisebild-fenster.vue");
    const rumpf = lies("reisebild-formular.vue");
    const fuss = lies("reisebild-formular-fuss.vue");
    const fenster = `${huelle}\n${rumpf}\n${fuss}`;

    it("🔴 der Honigtopf heißt wie bei der Community, ist träge und nicht erreichbar, und das Formular trägt EINE Kennung je Öffnen", () => {
        expect(rumpf).toContain('name="weitere-angaben"');
        expect(rumpf).toMatch(/aria-hidden="true"\s+inert/u);
        expect(huelle).toContain("const kennung = neuesFormular();");
        expect(huelle).toContain("const geoeffnet = performance.now();");
    });

    it("die Grenzen kommen aus dem Vertrag, nicht aus Zahlen im Fenster", () => {
        expect(rumpf).toContain(':maxlength="PHOTOBOX_LIMITS.descriptionMax"');
        expect(rumpf).toContain(':maxlength="PHOTOBOX_LIMITS.attributionMax"');
        expect(fenster).not.toMatch(/maxlength="\d+"/u);
    });

    it("🔴 „Bild hochladen“ bleibt drückbar, wenn etwas fehlt (`aria-disabled`), und nur das Senden sperrt wirklich (Entwurf 8)", () => {
        expect(fuss).toContain(":aria-disabled=\"props.gesperrt && !props.sendet ? 'true' : undefined\"");
        expect(fuss).toContain(':disabled="props.sendet"');
        // Kein dauerhafter Satz mehr im Fuß: Der Grund kommt erst nach einem Druck (`versucht`).
        expect(huelle).toContain("versucht.value && fehlt.value !== undefined ? t(fehlt.value.grund) : undefined");
        expect(huelle).toContain("formular.value?.fokussiere(fehlendesFeld.feld)");
        expect(rumpf).toContain("defineExpose({ fokussiere })");
    });

    it("die Erklärung verweist auf die Bedingungen und trägt den Satz der Probierseite in drei Teilen", () => {
        expect(rumpf).toContain("emit('hinweise', 'reisebilder')");
        expect(de["photobox.haken.vor"] + de["photobox.haken.link"] + de["photobox.haken.nach"]).toBe(
            "Ich habe die Bedingungen gelesen und erkläre: Das Bild ist mein eigenes Werk, erkennbare Personen sind einverstanden, ich bin mindestens 16.",
        );
    });

    it("🔴 der Kurzsatz zum Datenschutz bleibt, wie er war (jetzt hinter „ⓘ Datenschutz“ im Fuß), und trägt einen Verweis auf „Datenschutz: Reisebilder“ in den Hinweisen (Aufgabe 15)", () => {
        // Das Ziel heißt seit den neu gesetzten Hinweisen (5db5337bf, 2026-11-04) `datenschutz-bei-reisebildern`; jede Stelle ist verlinkbar.
        expect(fuss).toContain("emit('hinweise', 'datenschutz-bei-reisebildern')");
        expect(fuss).toContain('data-testid="reisebild-datenschutz-link"');
        expect(fuss).toContain('{{ t("photobox.fuss.hinweis") }} {{ t("photobox.datenschutz") }}');
        expect(fuss).toContain('v-if="datenschutzOffen"');
        expect(de["photobox.datenschutz.link"]).toBe("Mehr zum Datenschutz");
        expect(de["photobox.datenschutz.knopf"]).toBe("Datenschutz");
        // Die Besucherhülle reicht das Ziel zur Seite weiter, und die Seite öffnet damit die Hinweise.
        const besucher = readFileSync(
            resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "photobox", "reisebild-besucher.vue"),
            "utf8",
        );
        expect(besucher).toContain("hinweise: [ziel: ReisebildHinweisZiel];");
        expect(besucher).toContain("emit('hinweise', ziel)");
        const seite = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "app.vue"), "utf8");
        expect(seite).toMatch(/<ReisebildBesucher\b[^>]*@hinweise="openNotes"/);
    });

    it("das Formular ist ein Besucherfenster der Hülle: ohne Ablage, nur so hoch wie der Inhalt, am Telefon das Blatt", () => {
        expect(huelle).toContain("ohne-ablage");
        expect(huelle).toContain('hoehe="inhalt"');
        expect(huelle).toContain("telefon-blatt");
        expect(huelle).toContain('breite="entscheiden"');
    });

    it("🔴 Blickrichtung ist eine Auswahlliste (kein Kompassgitter), je Himmelsrichtung ein Satz der Tafel, „ohne“ zuerst (Entwurf 8)", () => {
        expect(rumpf).toContain("<select");
        expect(rumpf).toContain('data-testid="reisebild-blick"');
        expect(rumpf).not.toContain("WINDROSE");
        expect(rumpf).not.toContain("reisebild__rose");
        expect(rumpf).toContain("photobox.blick.wahl.${kurz}");
        for (const kurz of BLICK_RICHTUNGEN) {
            expect(de[`photobox.blick.wahl.${kurz}` as MessageKey], kurz).toMatch(/^\p{Lu}/u);
        }
        expect(de["photobox.blick.ohne"]).toBe("ohne");
    });

    it("jeder Text des Formulars steht in der deutschen Tafel, und die Zeichen des Hauses sind Bilder unter `public/icons`", () => {
        const schluessel = [...fenster.matchAll(/\bt\(\s*["']([a-z][\w.-]*)["']/gu)].map((treffer) => treffer[1]!);
        expect(schluessel.length).toBeGreaterThan(30);
        for (const key of schluessel) expect(Object.keys(de), key).toContain(key);
        for (const pfad of Object.values(REISEBILD_SYMBOLE)) {
            expect(existsSync(join(ordner, "..", "..", "public", pfad.slice(1))), pfad).toBe(true);
        }
    });
});
