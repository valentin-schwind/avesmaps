import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    MEDIA_INSTAGRAM_URL_PATTERN,
    MEDIA_PUBLIC_URL_PATTERN,
    MediaPublicView,
    MediaRole,
    mediaInstagramUrl,
    mediaPublicUrl,
} from "../src/index.ts";

const HASH = "ab".repeat(32);
const ID = "11111111-2222-4333-8444-555555555555";

const good = {
    id: ID,
    role: "coat",
    url: mediaPublicUrl(HASH),
    width: 256,
    height: 256,
    mimeType: "image/webp",
};

describe("Media-Vertrag (WI-0063, media.yaml)", () => {
    it("die öffentliche Adresse ist inhaltsversioniert und folgt dem Muster", () => {
        expect(mediaPublicUrl(HASH)).toBe(`/media/sha256/ab/ab/${HASH}.webp`);
        expect(new RegExp(MEDIA_PUBLIC_URL_PATTERN).test(mediaPublicUrl(HASH))).toBe(true);
        expect(() => mediaPublicUrl("AB".repeat(32))).toThrow();
        expect(() => mediaPublicUrl("abc")).toThrow();
        // Keine Cache-Umgehung per Zeitstempel wie in Legacy.
        expect(new RegExp(MEDIA_PUBLIC_URL_PATTERN).test(`${mediaPublicUrl(HASH)}?v=123`)).toBe(false);
    });

    it("die Instagram-Fassung liegt neben der WebP, trägt denselben Hash und hat ihre eigene Form (WebP-Muster bleibt WebP)", () => {
        expect(mediaInstagramUrl(HASH)).toBe(`/media/sha256/ab/ab/${HASH}.ig.jpg`);
        expect(mediaInstagramUrl(HASH).replace(".ig.jpg", ".webp")).toBe(mediaPublicUrl(HASH));
        expect(new RegExp(MEDIA_INSTAGRAM_URL_PATTERN).test(mediaInstagramUrl(HASH))).toBe(true);
        expect(new RegExp(MEDIA_INSTAGRAM_URL_PATTERN).test(mediaPublicUrl(HASH))).toBe(false);
        expect(new RegExp(MEDIA_PUBLIC_URL_PATTERN).test(mediaInstagramUrl(HASH))).toBe(false);
        expect(new RegExp(MEDIA_INSTAGRAM_URL_PATTERN).test(`${mediaInstagramUrl(HASH)}?v=1`)).toBe(false);
        expect(() => mediaInstagramUrl("AB".repeat(32))).toThrow();
        expect(() => mediaInstagramUrl("abc")).toThrow();
    });

    it("die Sicht kennt genau die vereinbarten Felder", () => {
        expect(Value.Check(MediaPublicView, good)).toBe(true);
        const credit = {
            creator: "Urheberin",
            licenseName: "CC BY 4.0",
            licenseUri: "https://example.org/l",
            attribution: "Bild: X",
        };
        expect(Value.Check(MediaPublicView, { ...good, credit })).toBe(true);
    });

    it("🔴 jedes weitere Feld, auch ein verbotenes, macht die Sicht ungültig", () => {
        for (const forbidden of [
            "storageKey",
            "storage_key",
            "prompt",
            "negativePrompt",
            "note",
            "rightsNote",
            "evidence",
            "uploadedBy",
            "ingestActorLegacy",
            "legacyRightsCode",
            "clearanceState",
            "sha256",
        ]) {
            expect(Value.Check(MediaPublicView, { ...good, [forbidden]: "x" }), forbidden).toBe(false);
        }
        expect(Value.Check(MediaPublicView, { ...good, credit: { creator: "A", clearanceState: "cleared" } })).toBe(
            false,
        );
    });

    it("Rolle, Adresse und Maße sind eingeschränkt", () => {
        expect(Value.Check(MediaRole, "coat")).toBe(true);
        expect(Value.Check(MediaRole, "header")).toBe(true);
        for (const role of ["map_full", "map_preview", "literature_cover"]) {
            expect(Value.Check(MediaRole, role), role).toBe(true);
        }
        expect(Value.Check(MediaRole, "gallery")).toBe(false);
        expect(Value.Check(MediaPublicView, { ...good, role: "gallery" })).toBe(false);
        expect(Value.Check(MediaPublicView, { ...good, url: "/uploads/wappen/x.png?v=1" })).toBe(false);
        expect(Value.Check(MediaPublicView, { ...good, url: "https://example.org/x.webp" })).toBe(false);
        expect(Value.Check(MediaPublicView, { ...good, width: 0 })).toBe(false);
        expect(Value.Check(MediaPublicView, { ...good, id: HASH })).toBe(false);
    });
});
