import { describe, expect, it } from "vitest";
import type { MediaAssetDetail, MediaLicenseInfo } from "@avesmaps3d/shared";
import {
    belegAnfrage,
    entstehungAus,
    entstehungsBefunde,
    entstehungsSchritte,
    leererBeleg,
    nameAnfrage,
    pruefungFaelltZurueck,
    pruefungsLage,
    rechteAnfrage,
    rechteAus,
    zeigeEntscheid,
} from "../src/medien/medien-bearbeiten-modell.ts";
import { verlaufText } from "../src/medien/medien-inspektor-modell.ts";

/**
 * Die Kästen des Inspectors beim Bearbeiten (WI-0068 P4b, Blatt 1, Betreiber 2026-10-10: „jeden Kasten einzeln (A)“): je Kasten nur das
 * Geänderte, die richtige Revision, die Reihenfolge bei wechselnder Entstehung, die Warnung vor dem Zurückfallen der Prüfung und wer prüfen
 * darf.
 */

const AM = "2026-10-05T10:00:00.000Z";

function detail(ueber: Partial<MediaAssetDetail> = {}): MediaAssetDetail {
    return {
        asset: {
            id: "6dcf1e76-4c1a-4b0e-9a6e-2f1d3c4b5a69",
            revision: 3,
            title: "Wappen von Gareth",
            kind: "image",
            assetType: "coat",
            origin: "legacy_import",
            creationMethod: "ai_generated",
            technicalState: "ok",
            moderationState: "not_applicable",
            degradedOriginal: false,
            sourceSystem: "avesmaps-legacy",
            sourceRef: null,
            createdAt: AM,
            updatedAt: AM,
            importedAt: AM,
        },
        rights: {
            revision: 5,
            basis: "own_work",
            licenseKey: null,
            licenseFamily: null,
            licenseName: null,
            licenseUri: null,
            requiresAttribution: null,
            creator: "Elwe",
            rightsHolder: null,
            attribution: null,
            clearance: "legacy_asserted",
            reviewedAt: null,
            updatedAt: AM,
            rightsNote: "KI-Wappen aus Legacy",
            legacyRightsCode: "ai_generated",
            reviewedBy: null,
            reviewer: null,
        },
        creation: {
            revision: 2,
            updatedAt: AM,
            tool: "Midjourney",
            model: "v6",
            prompt: "heraldic coat of arms, red fox",
            negativePrompt: null,
            parameters: null,
            legacyNoteRaw: null,
        },
        ingest: [],
        legacySource: null,
        representations: [],
        suspensions: [],
        mergedHere: [],
        usageCount: 1,
        retiredUsageCount: 0,
        sharedFileCount: 0,
        history: [],
        evidence: [],
        ...ueber,
    };
}

const LIZENZEN: MediaLicenseInfo[] = [
    { key: "cc-by-4.0", displayName: "CC BY 4.0", requiresAttribution: true } as MediaLicenseInfo,
    { key: "cc0-1.0", displayName: "CC0 1.0", requiresAttribution: false } as MediaLicenseInfo,
];

describe("Eigenschaften: der Name in der Liste", () => {
    it("sendet nur einen geänderten Namen, mit der Revision des Assets; leer heißt „kein eigener Name“", () => {
        expect(nameAnfrage(detail(), " Wappen von Gareth ")).toBeUndefined();
        expect(nameAnfrage(detail(), "Fuchs auf Gold")).toEqual({ baseRevision: 3, title: "Fuchs auf Gold" });
        expect(nameAnfrage(detail(), "  ")).toEqual({ baseRevision: 3, title: null });
    });
});

describe("Entstehung: Art und Werkzeug, Modell, Prompt", () => {
    it("nichts geändert: keine Anfrage; nur Felder: eine an …/creation mit der Revision der Entstehung", () => {
        const d = detail();
        expect(entstehungsSchritte(d, entstehungAus(d))).toEqual([]);
        const stand = { ...entstehungAus(d), modell: "v7" };
        expect(entstehungsSchritte(d, stand)).toEqual([
            {
                route: "creation",
                body: {
                    baseRevision: 2,
                    creation: {
                        tool: "Midjourney",
                        model: "v7",
                        prompt: "heraldic coat of arms, red fox",
                        negativePrompt: null,
                    },
                },
            },
        ]);
    });

    it("🔴 hört es auf, KI-erzeugt zu sein: erst den Prompt leeren, dann die Art (sonst wiese der Server den Prompt ab)", () => {
        const d = detail();
        const schritte = entstehungsSchritte(d, { ...entstehungAus(d), art: "photo" });
        expect(schritte.map((schritt) => schritt.route)).toEqual(["creation", "metadata"]);
        expect(schritte[0]?.body).toMatchObject({ creation: { prompt: null, negativePrompt: null } });
        expect(schritte[1]?.body).toEqual({ baseRevision: 3, creationMethod: "photo" });
    });

    it("🔴 wird es KI-erzeugt: erst die Art, dann der Prompt; ohne gespeicherte Entstehung ohne deren Revision", () => {
        const d = detail({
            asset: { ...detail().asset, creationMethod: "unknown" },
            creation: null,
        });
        const schritte = entstehungsSchritte(d, { ...entstehungAus(d), art: "ai_generated", prompt: "ein Fuchs" });
        expect(schritte.map((schritt) => schritt.route)).toEqual(["metadata", "creation"]);
        expect(schritte[1]?.body).toEqual({
            creation: { tool: null, model: null, prompt: "ein Fuchs", negativePrompt: null },
        });
        // Nur die Art: eine Anfrage.
        expect(entstehungsSchritte(d, { ...entstehungAus(d), art: "drawing" })).toEqual([
            { route: "metadata", body: { baseRevision: 3, creationMethod: "drawing" } },
        ]);
    });

    it("ein Prompt bei einem Foto fällt still weg, statt einen Befund zu erzeugen", () => {
        expect(entstehungsBefunde({ ...entstehungAus(detail()), art: "photo" })).toEqual([]);
    });
});

describe("Rechte", () => {
    it("sendet alle Felder mit der Revision der Rechte, nur wenn sich etwas geändert hat", () => {
        const d = detail();
        expect(rechteAnfrage(d, rechteAus(d), LIZENZEN)).toEqual({ body: undefined, befunde: [] });
        const anfrage = rechteAnfrage(d, { ...rechteAus(d), urheber: "" }, LIZENZEN);
        expect(anfrage.body).toEqual({
            baseRevision: 5,
            rights: {
                basis: "own_work",
                licenseKey: null,
                creator: null,
                rightsHolder: null,
                attribution: null,
                rightsNote: "KI-Wappen aus Legacy",
            },
        });
    });

    it("prüft vorher wie der Server: CC BY verlangt die Namensnennung, eine Lizenz verlangt ihren Schlüssel", () => {
        const d = detail();
        const ohneNennung = rechteAnfrage(d, { ...rechteAus(d), grundlage: "license", lizenz: "cc-by-4.0" }, LIZENZEN);
        expect(ohneNennung.body).toBeUndefined();
        expect(ohneNennung.befunde).toEqual([{ path: "rights.attribution", rule: "required_by_license" }]);
        expect(rechteAnfrage(d, { ...rechteAus(d), grundlage: "license" }, LIZENZEN).befunde).toEqual([
            { path: "rights.licenseKey", rule: "required" },
        ]);
        expect(rechteAnfrage(d, { ...rechteAus(d), grundlage: "" }, LIZENZEN).befunde).toEqual([
            { path: "rights.basis", rule: "required" },
        ]);
    });

    it("🔴 sagt vorher, wenn die Prüfung zurückfällt: neue Grundlage oder Lizenz an geprüften oder eingestuften Rechten", () => {
        const d = detail();
        expect(pruefungFaelltZurueck(d, { ...rechteAus(d), urheber: "jemand" })).toBe(false);
        expect(pruefungFaelltZurueck(d, { ...rechteAus(d), grundlage: "license", lizenz: "cc0-1.0" })).toBe(true);
        const offen = detail({ rights: { ...detail().rights!, clearance: "unreviewed" } });
        expect(pruefungFaelltZurueck(offen, { ...rechteAus(offen), grundlage: "public_domain" })).toBe(false);
    });
});

describe("Prüfung: wer darf", () => {
    const datum = (iso: string): string => iso.slice(0, 10);

    it("offen mit dem Recht, auch am eigenen Hochgeladenen (WI-0282); gesperrt ohne Recht und ohne Rechte, je mit EINEM Satz", () => {
        expect(pruefungsLage(detail(), true, datum)).toMatchObject({ gesperrt: undefined });
        expect(pruefungsLage(detail(), false, datum).gesperrt).toBeDefined();
        expect(pruefungsLage(detail({ rights: null }), true, datum).gesperrt).toBeDefined();
    });

    it("nennt den Stand: noch nie geprüft, oder geprüft am Tag", () => {
        expect(pruefungsLage(detail(), true, datum).stand).toContain("noch nie geprüft");
        const geprueft = detail({ rights: { ...detail().rights!, clearance: "cleared", reviewedAt: AM } });
        expect(pruefungsLage(geprueft, true, datum).stand).toContain("2026-10-05");
    });

    it("🔴 OPS-000101: „Erneut zur Prüfung“ heißt nicht „geprüft am“, und es steht nur, wo ein Entscheid gilt", () => {
        const zurueck = detail({ rights: { ...detail().rights!, clearance: "needs_review", reviewedAt: AM } });
        const stand = pruefungsLage(zurueck, true, datum).stand;
        expect(stand).toContain("zur Prüfung gestellt am 2026-10-05");
        expect(stand).not.toContain("geprüft am");
        for (const clearance of ["cleared", "rejected", "legacy_asserted"] as const) {
            expect(
                zeigeEntscheid(detail({ rights: { ...detail().rights!, clearance } }), "needs_review"),
                clearance,
            ).toBe(true);
        }
        for (const clearance of ["unreviewed", "needs_review", "legacy_assumed"] as const) {
            expect(
                zeigeEntscheid(detail({ rights: { ...detail().rights!, clearance } }), "needs_review"),
                clearance,
            ).toBe(false);
            expect(zeigeEntscheid(detail({ rights: { ...detail().rights!, clearance } }), "cleared"), clearance).toBe(
                true,
            );
            expect(zeigeEntscheid(detail({ rights: { ...detail().rights!, clearance } }), "rejected"), clearance).toBe(
                true,
            );
        }
        expect(zeigeEntscheid(detail({ rights: null }), "needs_review")).toBe(false);
    });

    it("🔴 OPS-000101: der Verlauf nennt den Entscheid der Prüfung in Worten, andere Handlungen mit ihrem Code", () => {
        expect(verlaufText({ action: "rights.reviewed", decision: "needs_review" })).toBe(
            "Rechte erneut zur Prüfung gestellt",
        );
        expect(verlaufText({ action: "rights.reviewed", decision: "cleared" })).toBe("Rechte geprüft");
        expect(verlaufText({ action: "rights.reviewed", decision: "rejected" })).toBe("Rechte abgelehnt");
        expect(verlaufText({ action: "photobox.reopened" })).toBe("Reisebild erneut zur Prüfung gestellt");
        expect(verlaufText({ action: "rights.reviewed" })).toBe("rights.reviewed");
        expect(verlaufText({ action: "rights.set" })).toBe("rights.set");
    });
});

describe("Beleg", () => {
    it("verlangt eine Art und je Art Adresse, Datei oder Text wie der Server", () => {
        expect(belegAnfrage(leererBeleg()).befunde).toEqual([{ path: "evidence.kind", rule: "required" }]);
        expect(belegAnfrage({ ...leererBeleg(), art: "license_page" }).befunde).toEqual([
            { path: "evidence.url", rule: "required" },
        ]);
        expect(
            belegAnfrage({
                ...leererBeleg(),
                art: "license_page",
                adresse: "https://creativecommons.org/licenses/by/4.0/",
            }),
        ).toEqual({
            evidence: { kind: "license_page", url: "https://creativecommons.org/licenses/by/4.0/" },
            befunde: [],
        });
    });
});
