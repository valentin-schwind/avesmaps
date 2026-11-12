import { describe, expect, it } from "vitest";
import { profileForRole } from "../src/media/raster/profiles.ts";
import {
    CLASS_ROLE,
    CLASS_SUBJECT,
    LEGACY_RIGHTS_CODES,
    MEDIA_CLASSES,
    assetOrigin,
    bindingOrigin,
    isCachePath,
    isDegradedOriginal,
    legacyTimestamp,
    mapRights,
    noteIsRightsNote,
    stampSemantics,
    withoutStamp,
    type MediaClass,
} from "../src/migration/media-legacy.ts";

/**
 * Was Legacys Rechtecodes im Ziel bedeuten (WI-0063 MEDIA-M8, Vertrag `media.yaml` → `rechte.zuordnung_legacy_code`, Media-Core-Plan
 * Abschnitt 6, STOP-Regeln 1 bis 5). Reine Tabelle, keine Datenbank.
 */

const rights = (
    mediaClass: MediaClass,
    code: string | null,
    origin: Parameters<typeof mapRights>[0]["origin"] = null,
    hasStamp = false,
) => mapRights({ mediaClass, code, origin, hasStamp });

describe("Rechtezuordnung: Legacy-Code zu Rechtsbasis", () => {
    it("public_domain: Public Domain, ausdrücklich eingestuft", () => {
        expect(rights("territory_coat", "public_domain")).toMatchObject({
            basis: "public_domain",
            licenseKey: null,
            clearance: "legacy_asserted",
            unresolved: false,
        });
    });

    it("cc0: Lizenz cc0-1.0 aus dem Katalog", () => {
        expect(rights("settlement_coat", "cc0")).toMatchObject({
            basis: "license",
            licenseKey: "cc0-1.0",
            clearance: "legacy_asserted",
        });
    });

    it("cc_by ohne Version: Familie cc-by, KEIN Schlüssel, needs_review (nie eine Version erfunden)", () => {
        const mapping = rights("citymap_full", "cc_by");
        expect(mapping).toMatchObject({
            basis: "license",
            licenseKey: null,
            licenseFamily: "cc-by",
            clearance: "needs_review",
            ccByWithoutVersion: true,
            unresolved: true,
        });
    });

    it("cc_by bei Gebieten: die Familie ist unbekannt (Legacys Wiki-Parser wirft CC-BY-SA, NC und GFDL hinein)", () => {
        expect(rights("territory_coat", "cc_by")).toMatchObject({
            basis: "license",
            licenseKey: null,
            licenseFamily: null,
            clearance: "needs_review",
        });
    });

    it("permission_granted: bei Literaturcover und Autoget-Vorschau fan_policy, sonst Einzelgenehmigung, nie eine Lizenz", () => {
        expect(rights("literature_cover", "permission_granted", "upload")).toMatchObject({
            basis: "fan_policy",
            licenseKey: null,
        });
        expect(rights("literature_cover", "permission_granted", "wiki_sync")).toMatchObject({ basis: "fan_policy" });
        expect(rights("citymap_preview", "permission_granted", "autoget")).toMatchObject({ basis: "fan_policy" });
        // Eine hochgeladene Vorschau mit Genehmigung ist eine Einzelgenehmigung, keine Fan-Regel.
        expect(rights("citymap_preview", "permission_granted", "upload")).toMatchObject({ basis: "permission" });
        expect(rights("citymap_full", "permission_granted", "upload")).toMatchObject({ basis: "permission" });
        expect(rights("settlement_coat", "permission_granted", "custom")).toMatchObject({ basis: "permission" });
        for (const cls of MEDIA_CLASSES) expect(rights(cls, "permission_granted", "upload").licenseKey).toBeNull();
    });

    it("ai_generated: eigenes Werk, Entstehungsart ai_generated, nie eine Lizenz", () => {
        const mapping = rights("territory_coat", "ai_generated");
        expect(mapping).toMatchObject({
            basis: "own_work",
            creationMethod: "ai_generated",
            licenseKey: null,
            licenseFamily: null,
            clearance: "legacy_asserted",
        });
        // Ortsbild mit ausdrücklicher Einstufung (ein Objekt mit Lizenzfeld): eine Behauptung, kein Nachweis.
        expect(rights("settlement_image", "ai_generated")).toMatchObject({
            clearance: "legacy_asserted",
            assumedDefault: false,
        });
    });

    it("ai_generated an einem Ortswappen: ausdrücklich nur mit Hochladestempel, sonst Vorgabe (legacy_assumed)", () => {
        expect(rights("settlement_coat", "ai_generated", "custom", true)).toMatchObject({
            clearance: "legacy_asserted",
            assumedDefault: false,
        });
        expect(rights("settlement_coat", "ai_generated", "custom", false)).toMatchObject({
            clearance: "legacy_assumed",
            assumedDefault: true,
        });
    });

    it("own_work: eigenes Werk, ausdrücklich eingestuft", () => {
        expect(rights("citymap_full", "own_work")).toMatchObject({
            basis: "own_work",
            clearance: "legacy_asserted",
            creationMethod: "unknown",
        });
    });

    it("unknown_other und alles Fremde: unknown, unreviewed, ungeklärt", () => {
        expect(rights("citymap_full", "unknown_other")).toMatchObject({
            basis: "unknown",
            clearance: "unreviewed",
            unresolved: true,
            unknownCode: false,
        });
        expect(rights("citymap_full", "CC-BY-SA 3.0")).toMatchObject({
            basis: "unknown",
            clearance: "unreviewed",
            unknownCode: true,
        });
        // Nicht normalisiert: ein Tippfehler heißt nie „cc0“ (Legacy: `CC0` ist ein Fehler, keine Schreibvariante).
        expect(rights("territory_coat", "CC0")).toMatchObject({ basis: "unknown", unknownCode: true });
    });

    it("leerer Wert: bei Ortsbildern die Klassenannahme des Betreibers, sonst unknown", () => {
        expect(rights("settlement_image", null)).toMatchObject({
            basis: "own_work",
            clearance: "legacy_assumed",
            creationMethod: "ai_generated",
            assumedDefault: true,
            licenseKey: null,
        });
        for (const cls of MEDIA_CLASSES.filter((name) => name !== "settlement_image")) {
            expect(rights(cls, null)).toMatchObject({ basis: "unknown", clearance: "unreviewed", unresolved: true });
        }
    });

    it("jeder der sieben Legacy-Codes ergibt für jede Klasse eine Zuordnung ohne Lizenzschlüssel außer cc0", () => {
        for (const cls of MEDIA_CLASSES) {
            for (const code of LEGACY_RIGHTS_CODES) {
                const mapping = rights(cls, code, "upload");
                if (code === "cc0") expect(mapping.licenseKey).toBe("cc0-1.0");
                else expect(mapping.licenseKey).toBeNull();
                // Eine Lizenz ohne Schlüssel ist nur mit needs_review denkbar (CHECK im Schema).
                if (mapping.basis === "license" && mapping.licenseKey === null)
                    expect(mapping.clearance).toBe("needs_review");
            }
        }
    });

    it("kein Legacy-Code ergibt je cleared oder rejected (das tut nur ein Mensch im MAM)", () => {
        for (const cls of MEDIA_CLASSES) {
            for (const code of [...LEGACY_RIGHTS_CODES, null, "irgendwas"]) {
                expect(["cleared", "rejected"]).not.toContain(rights(cls, code, "upload", true).clearance);
            }
        }
    });
});

describe("Klassen, Rollen und Herkunft", () => {
    it("jede Klasse hat eine Rolle, ein Fachobjekt und ein Rasterprofil", () => {
        for (const cls of MEDIA_CLASSES) {
            expect(CLASS_ROLE[cls]).toBeDefined();
            expect(CLASS_SUBJECT[cls]).toBeDefined();
            expect(profileForRole(CLASS_ROLE[cls]).role).toBe(CLASS_ROLE[cls]);
        }
        // Legacys Rollenwert `gallery` ist keine Rolle des Ziels: Ortsbilder tragen die Rolle header.
        expect(CLASS_ROLE.settlement_image).toBe("header");
        expect(CLASS_SUBJECT.literature_cover).toBe("adventure");
    });

    it("Herkunft des Assets und der Bindung", () => {
        expect(assetOrigin("custom")).toBe("legacy_import");
        expect(assetOrigin("upload")).toBe("legacy_import");
        expect(assetOrigin(null)).toBe("legacy_import");
        expect(assetOrigin("wiki_localized")).toBe("wiki_localized");
        expect(assetOrigin("wiki_sync")).toBe("wiki_localized");
        expect(assetOrigin("autoget")).toBe("external_import");
        expect(assetOrigin("wiki_staging")).toBe("wiki_import");
        expect(bindingOrigin("wiki_localized")).toBe("wiki_localized");
        expect(bindingOrigin("custom")).toBe("legacy");
        expect(bindingOrigin("autoget")).toBe("legacy");
    });

    it("„Kein Original vorhanden“: nur, wo Legacy verkleinert hat", () => {
        expect(isDegradedOriginal("settlement_image", "upload")).toBe(true);
        expect(isDegradedOriginal("literature_cover", "wiki_sync")).toBe(true);
        expect(isDegradedOriginal("citymap_preview", "autoget")).toBe(true);
        expect(isDegradedOriginal("settlement_coat", "custom")).toBe(true);
        expect(isDegradedOriginal("territory_coat", "custom")).toBe(true);
        // Eine lokalisierte Wiki-Datei und ein hochgeladenes Kartenbild liegen unverkleinert.
        expect(isDegradedOriginal("settlement_coat", "wiki_localized")).toBe(false);
        expect(isDegradedOriginal("territory_coat", "wiki_localized")).toBe(false);
        expect(isDegradedOriginal("citymap_full", "upload")).toBe(false);
    });

    it("der Stempel eines Ortsbildes ist die letzte Einstufung, sonst der Upload", () => {
        expect(stampSemantics("settlement_image")).toBe("last_classification");
        expect(stampSemantics("settlement_coat")).toBe("upload");
        expect(stampSemantics("citymap_full")).toBe("upload");
    });

    it("die Notiz von Bild und Wappen bleibt unklassifiziert, die von Karte und Cover ist eine Rechtenotiz", () => {
        expect(noteIsRightsNote("settlement_image")).toBe(false);
        expect(noteIsRightsNote("settlement_coat")).toBe(false);
        expect(noteIsRightsNote("territory_coat")).toBe(false);
        expect(noteIsRightsNote("citymap_full")).toBe(true);
        expect(noteIsRightsNote("literature_cover")).toBe(true);
    });

    it("Adressen: Cache-Stempel ab, Zwischenspeicher erkannt", () => {
        expect(withoutStamp("/uploads/wappen/a-custom.png?v=1786648684")).toBe("/uploads/wappen/a-custom.png");
        expect(withoutStamp("/uploads/wappen/a.png")).toBe("/uploads/wappen/a.png");
        expect(isCachePath("/uploads/wappen/cache/abcdef.png")).toBe(true);
        expect(isCachePath("/uploads/wappen/wiki/abcdef.png")).toBe(false);
    });
});

describe("Zeitstempel aus Legacy", () => {
    it("ISO mit Zone bleibt, ein Wert ohne Zone gilt als UTC (der Stempel wird einmal übernommen)", () => {
        expect(legacyTimestamp("2026-07-10T09:15:20Z")).toBe("2026-07-10T09:15:20.000Z");
        expect(legacyTimestamp("2026-09-04 10:00:00")).toBe("2026-09-04T10:00:00.000Z");
        expect(legacyTimestamp("2026-09-04T10:00:00+02:00")).toBe("2026-09-04T08:00:00.000Z");
        expect(legacyTimestamp("2026-09-04 10:00:00+0200")).toBe("2026-09-04T08:00:00.000Z");
        expect(legacyTimestamp("2026-09-04T10:00:00.250Z")).toBe("2026-09-04T10:00:00.250Z");
    });

    it("kein lesbarer Zeitpunkt ist null, nie ein geratener", () => {
        expect(legacyTimestamp(null)).toBeNull();
        expect(legacyTimestamp("")).toBeNull();
        expect(legacyTimestamp("gestern")).toBeNull();
        expect(legacyTimestamp("2026-13-45 99:00:00")).toBeNull();
    });
});
