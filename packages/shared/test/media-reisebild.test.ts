import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    MEDIA_IMAGE_RELATIONS,
    MEDIA_REISEBILD_ENTSTEHUNG,
    MEDIA_VIEW_RELATIONS,
    MamSearchQuery,
    MediaPublicView,
    MediaReisebild,
    PHOTOBOX_CREATION_KINDS,
    PHOTOBOX_ORT_EINGAENGE_MAX,
    PhotoboxOrtEingaenge,
    mediaPhotoboxOrtEingaengeUrl,
    mediaPublicUrl,
} from "../src/index.ts";

/**
 * Das Reisebild im Kopf der Infobox eines Ortes (WI-0272 S5): der Bildbezug `reisebild`, die Angaben, die Besucher darüber erfahren, die offenen Eingänge eines Ortes für Editoren und der Filter der Auswahl.
 *
 * Problemfälle: der Bildbezug `reisebild` sickert in das, was ein Editor übersteuern darf; die Liste der Entstehungen läuft der des Formulars davon (zwei Listen, weil `media.ts` ein Blattmodul ist); die
 * öffentliche Sicht trägt mehr als Beschreibung, Name und Entstehung; die Antwort der Eingänge trägt mehr als Kennung, Adresse und Maße.
 */

const KENNUNG = "11111111-1111-4111-8111-111111111111";
const SICHT = {
    id: KENNUNG,
    role: "photobox" as const,
    url: mediaPublicUrl("a".repeat(64)),
    width: 1600,
    height: 900,
    mimeType: "image/webp",
};

describe("Der Bildbezug einer öffentlichen Sicht", () => {
    it("🔴 `reisebild` ist ein Bezug der Sicht, aber nie einer, den ein Editor setzt oder übersteuert", () => {
        expect(MEDIA_VIEW_RELATIONS).toEqual([...MEDIA_IMAGE_RELATIONS, "reisebild"]);
        expect(MEDIA_IMAGE_RELATIONS).not.toContain("reisebild");
    });

    it("die Entstehungen des Blocks sind die des Formulars, Wort für Wort", () => {
        expect([...MEDIA_REISEBILD_ENTSTEHUNG]).toEqual([...PHOTOBOX_CREATION_KINDS]);
    });

    it("eine Sicht mit Bezug und Block passt zum Vertrag; ohne Name auch, mit unbekanntem Bezug oder einem weiteren Feld nicht", () => {
        const block = { beschreibung: "Der Blick vom Hafen", name: "Alrik", entstehung: "photo" } as const;
        expect(Value.Check(MediaPublicView, { ...SICHT, relation: "reisebild", reisebild: block })).toBe(true);
        expect(
            Value.Check(MediaPublicView, {
                ...SICHT,
                relation: "reisebild",
                reisebild: { beschreibung: "Die Bucht", entstehung: "ai_generated" },
            }),
        ).toBe(true);
        expect(Value.Check(MediaPublicView, { ...SICHT, relation: "ortsansicht" })).toBe(false);
        expect(
            Value.Check(MediaPublicView, { ...SICHT, relation: "reisebild", reisebild: { ...block, ort: "x" } }),
        ).toBe(false);
        expect(Value.Check(MediaReisebild, { ...block, entstehung: "gemalt" })).toBe(false);
        expect(Value.Check(MediaReisebild, { ...block, beschreibung: "" })).toBe(false);
        // Eine Sicht der Vorversion (ohne beide Felder) bleibt gültig.
        expect(Value.Check(MediaPublicView, SICHT)).toBe(true);
    });
});

describe("Die offenen Eingänge eines Ortes", () => {
    it("die Adresse trägt die Kennung des Ortes", () => {
        expect(mediaPhotoboxOrtEingaengeUrl(KENNUNG)).toBe(`/api/editor/media/photobox/ort/${KENNUNG}/eingaenge`);
    });

    it("🔴 die Antwort nennt Kennung, Adresse und Maße, sonst nichts, und höchstens PHOTOBOX_ORT_EINGAENGE_MAX", () => {
        const eingang = {
            publicId: KENNUNG,
            url: `/api/editor/media/${KENNUNG}/preview/intern_photobox_2048`,
            breite: 640,
            hoehe: 360,
        };
        expect(Value.Check(PhotoboxOrtEingaenge, { eingaenge: [eingang] })).toBe(true);
        expect(Value.Check(PhotoboxOrtEingaenge, { eingaenge: [] })).toBe(true);
        expect(Value.Check(PhotoboxOrtEingaenge, { eingaenge: [{ ...eingang, beschreibung: "geheim" }] })).toBe(false);
        expect(Value.Check(PhotoboxOrtEingaenge, { eingaenge: [{ ...eingang, name: "Alrik" }] })).toBe(false);
        expect(Value.Check(PhotoboxOrtEingaenge, { eingaenge: [eingang], zustand: "pending" })).toBe(false);
        expect(
            Value.Check(PhotoboxOrtEingaenge, {
                eingaenge: Array.from({ length: PHOTOBOX_ORT_EINGAENGE_MAX + 1 }, () => eingang),
            }),
        ).toBe(false);
    });
});

describe("Die Suche der Medienverwaltung", () => {
    it("ohneReisebilder ist ein Wahrheitswert; was anderes ist keine Anfrage", () => {
        expect(Value.Check(MamSearchQuery, { type: "picture", ohneReisebilder: true })).toBe(true);
        expect(Value.Check(MamSearchQuery, { ohneReisebilder: "ja" })).toBe(false);
    });
});
