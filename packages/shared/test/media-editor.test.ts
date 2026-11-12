import { Value } from "@sinclair/typebox/value";
import type { TObject } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import {
    MamAssetSummary,
    API_ERROR_CODE_PATTERN,
    API_ERROR_STATUS,
    MEDIA_ALLOW_REASONS,
    MEDIA_DENY_REASONS,
    MEDIA_ERROR_STATUS,
    MEDIA_PRIVATE_FIELDS,
    MamSearchQuery,
    MediaAssetDetail,
    MediaCreationEditorView,
    MediaCredit,
    MediaHistoryEntry,
    MediaIngestView,
    MediaLegacySourceView,
    MediaPublicView,
    MediaRepresentation,
    MediaRightsEditorView,
    MediaSlotAsset,
    MediaSuspensionView,
    MediaUsageOverride,
    type MediaPrivateModel,
} from "../src/index.ts";

/** Die Verträge der Medienverwaltung (WI-0068 P2). */

const MODELS: Readonly<Record<MediaPrivateModel, TObject>> = {
    MediaUsageOverride,
    MediaRightsEditorView,
    MediaCreationEditorView,
    MediaIngestView,
    MediaLegacySourceView,
    MediaRepresentation,
    MediaSuspensionView,
    MediaHistoryEntry,
    MediaAssetDetail,
    MediaSlotAsset,
    MamAssetSummary,
};

const PRIVATE_NAMES = new Set<string>(Object.values(MEDIA_PRIVATE_FIELDS).flat());

describe("Positivliste der privaten Felder", () => {
    it("🔴 jedes private Feld steht in seinem Lesemodell (keine Leiche, kein Tippfehler)", () => {
        for (const [model, fields] of Object.entries(MEDIA_PRIVATE_FIELDS) as [
            MediaPrivateModel,
            readonly string[],
        ][]) {
            const properties = Object.keys(MODELS[model].properties);
            for (const field of fields) expect(properties, `${model}.${field}`).toContain(field);
        }
    });

    it("🔴 die öffentliche Sicht trägt keines davon, auch nicht in der Nennung", () => {
        const publicNames = [...Object.keys(MediaPublicView.properties), ...Object.keys(MediaCredit.properties)];
        expect(publicNames.filter((name) => PRIVATE_NAMES.has(name))).toEqual([]);
        // Die öffentliche Sicht bleibt geschlossen: ein weiteres Feld fiele durch.
        expect(MediaPublicView.additionalProperties).toBe(false);
    });

    it("Prompt, Rechtenotiz, Belege, Hochlader und Speicherschlüssel sind privat (WI-0068 §2 Nr. 15, AC16)", () => {
        expect(MEDIA_PRIVATE_FIELDS.MediaCreationEditorView).toContain("prompt");
        expect(MEDIA_PRIVATE_FIELDS.MediaRightsEditorView).toContain("rightsNote");
        expect(MEDIA_PRIVATE_FIELDS.MediaAssetDetail).toContain("evidence");
        expect(MEDIA_PRIVATE_FIELDS.MediaIngestView).toEqual(
            expect.arrayContaining(["actor", "legacyActorLabel", "originalFilename"]),
        );
        expect(MEDIA_PRIVATE_FIELDS.MediaRepresentation).toContain("storageKey");
    });
});

describe("Fachcodes und Suche", () => {
    it("die Fachcodes folgen ADR-0018 und überschreiben keinen gemeinsamen Code", () => {
        for (const code of Object.keys(MEDIA_ERROR_STATUS)) {
            expect(code).toMatch(new RegExp(API_ERROR_CODE_PATTERN));
            expect(Object.keys(API_ERROR_STATUS)).not.toContain(code);
        }
        // Der Konflikt ist der gemeinsame Code mit EditConflictDetails, kein eigener.
        expect(Object.keys(MEDIA_ERROR_STATUS)).not.toContain("edit_conflict");
    });

    it("Grundcodes der Entscheidung: erlaubt und verweigert sind getrennt", () => {
        const allow = new Set<string>(MEDIA_ALLOW_REASONS);
        expect(MEDIA_DENY_REASONS.filter((reason) => allow.has(reason))).toEqual([]);
    });

    it("ein Fachobjekt wird über Art und Kennung gefiltert, nie über einen Namen", () => {
        const uuid = "6d656469-0000-4000-8000-000000000001";
        expect(Value.Check(MamSearchQuery, { subject: `place:${uuid}` })).toBe(true);
        expect(Value.Check(MamSearchQuery, { subject: `citymap:${uuid}` })).toBe(true);
        expect(Value.Check(MamSearchQuery, { subject: "place:Gareth" })).toBe(false);
        expect(Value.Check(MamSearchQuery, { subject: `region:${uuid}` })).toBe(false);
        expect(Value.Check(MamSearchQuery, { limit: 201 })).toBe(false);
        expect(Value.Check(MamSearchQuery, { basket: "rights_open", sort: "rights", order: "desc" })).toBe(true);
    });
});
