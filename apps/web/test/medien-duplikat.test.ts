import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { MamAssetSummary, MediaSlotAsset, MediaSubjectSlots } from "@avesmaps3d/shared";
import {
    duplikatKonflikte,
    duplikatLage,
    duplikatSperre,
    haengtSchonHier,
    sha256Hex,
} from "../src/medien/medien-duplikat-modell";

/**
 * „Dieses Bild gibt es bereits!“ (Betreiber 2026-10-17, WI-0068): die reinen Regeln hinter dem Hinweis im Hochladen.
 *
 * - Die SHA-256 im Browser ist dieselbe wie auf dem Server (Hex der ganzen Datei).
 * - Vorgeschlagen ist das kanonische Werk, das der Server nennt.
 * - Konflikte: abweichende Rechte unter den Treffern, ein Typ, der die Rolle nicht trägt, ein Notaus.
 * - Am Platz des Ortseditors sperren der falsche Typ und „hängt schon hier“ (Editor-Orchestrierung 2026-10-17); nur das Einzelbild
 *   zählt als „hier“, nicht ein Eintrag der gebundenen Galerie (WI-0219: das Bild ersetzt die Galerie).
 */
const ALT = "a1a2a3a4-0000-4000-8000-000000000001";
const JUNG = "a1a2a3a4-0000-4000-8000-000000000002";
const ORT = "c1c2c3c4-0000-4000-8000-000000000003";

const werk = (id: string, teil: Partial<MamAssetSummary> = {}): MamAssetSummary => ({
    id,
    revision: 1,
    title: id === ALT ? "Altes Wappen" : "Junges Wappen",
    kind: "image",
    assetType: "coat",
    origin: "legacy_import",
    creationMethod: "unknown",
    technicalState: "ok",
    rightsBasis: "fan_policy",
    clearance: "legacy_asserted",
    usageCount: 1,
    sharedFileCount: 1,
    fileGroup: ALT,
    primaryUsage: null,
    preview: null,
    published: true,
    suspended: false,
    updatedAt: "2026-10-17T10:00:00.000Z",
    ...teil,
});

const slotAsset = (id: string): MediaSlotAsset => ({ id, revision: 1, title: null }) as unknown as MediaSlotAsset;

function plaetze(ueber: { wappen?: string; bild?: string; galerieMit?: string } = {}): MediaSubjectSlots {
    return {
        subject: { kind: "place", id: ORT, name: "Gareth", active: true },
        coat:
            ueber.wappen === undefined
                ? { state: "undecided", origin: null, revision: null, asset: null }
                : { state: "set", origin: "legacy", revision: 4, asset: slotAsset(ueber.wappen) },
        header: {
            gallery:
                ueber.galerieMit === undefined
                    ? null
                    : { id: "b1b2c3d4-0000-4000-9000-000000000002", revision: 7, origin: "legacy" },
            image: ueber.bild === undefined ? null : { asset: slotAsset(ueber.bild), revision: 3, origin: "editor" },
            items:
                ueber.galerieMit === undefined
                    ? []
                    : [{ asset: slotAsset(ueber.galerieMit), position: 0, revision: 1 }],
            max: 500,
            suppressed: false,
        },
    } as MediaSubjectSlots;
}

describe("Dieses Bild gibt es bereits (Betreiber 2026-10-17)", () => {
    it("🔴 die SHA-256 im Browser ist die der ganzen Datei, wie auf dem Server", async () => {
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
        expect(await sha256Hex(new Blob([bytes]))).toBe(createHash("sha256").update(bytes).digest("hex"));
    });

    it("ohne Treffer keine Lage; mit Treffern ist der Vorschlag das Werk, das der Server nennt", () => {
        expect(duplikatLage({ hits: [], suggested: null })).toBeUndefined();
        const lage = duplikatLage({ hits: [werk(ALT), werk(JUNG)], suggested: ALT });
        expect(lage?.vorschlag.id).toBe(ALT);
        expect(lage?.treffer.map((treffer) => treffer.id)).toEqual([ALT, JUNG]);
    });

    it("🔴 Konflikte: abweichende Rechte, ein Typ, der die Rolle nicht trägt, ein Notaus", () => {
        const gleich = duplikatLage({ hits: [werk(ALT), werk(JUNG)], suggested: ALT })!;
        expect(duplikatKonflikte(gleich, gleich.vorschlag, "coat")).toEqual([]);

        const verschieden = duplikatLage({
            hits: [werk(ALT), werk(JUNG, { rightsBasis: "own_work", clearance: "cleared" })],
            suggested: ALT,
        })!;
        expect(duplikatKonflikte(verschieden, verschieden.vorschlag, "coat")).toEqual(["rechte"]);

        // Ein Wappen ist kein Titelbild (Betreiber 2026-10-10); ein gesperrtes Original bleibt unveröffentlicht.
        const einzeln = duplikatLage({ hits: [werk(ALT, { suspended: true })], suggested: ALT })!;
        expect(duplikatKonflikte(einzeln, einzeln.vorschlag, "header")).toEqual(["typ", "notaus"]);
    });

    it("🔴 am Platz: „hängt schon hier“ nur für dasselbe Wappen oder dasselbe Einzelbild, nicht für einen Galerieeintrag", () => {
        expect(haengtSchonHier(plaetze({ wappen: ALT }), "coat", ALT)).toBe(true);
        expect(haengtSchonHier(plaetze({ wappen: JUNG }), "coat", ALT)).toBe(false);
        expect(haengtSchonHier(plaetze({ bild: ALT }), "header", ALT)).toBe(true);
        // Steht das Werk in der gebundenen Galerie, ersetzt das Einzelbild die Galerie (WI-0219): das ist eine echte Änderung.
        expect(haengtSchonHier(plaetze({ galerieMit: ALT }), "header", ALT)).toBe(false);
    });

    it("🔴 gesperrt wird nur am Platz: falscher Typ oder hängt schon hier; ohne Platz öffnet die Übernahme nur den Inspector", () => {
        expect(duplikatSperre([], plaetze({ wappen: ALT }), "coat", ALT)).toBe("schonHier");
        expect(duplikatSperre(["typ"], plaetze(), "header", ALT)).toBe("typ");
        expect(duplikatSperre(["rechte", "notaus"], plaetze(), "coat", ALT)).toBeUndefined();
        expect(duplikatSperre(["typ"], undefined, "header", ALT)).toBeUndefined();
    });
});
