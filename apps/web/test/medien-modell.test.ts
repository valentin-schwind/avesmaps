import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    MEDIA_PRIVATE_FIELDS,
    type MamAssetSummary,
    type MediaAssetDetail,
    type MediaUsage,
    type MediaUsageResult,
} from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api.ts";
import { createPanelActions, mediaSubjectOf, type PanelActionDeps } from "../src/info-panel/panel-actions.ts";
import { createMedienClient, istAbbruch, medienFehler } from "../src/medien/medien-client.ts";
import {
    dateiZeilen,
    eigenschaftenZeilen,
    entstehungZeilen,
    freigabeSatz,
    ingestZeilen,
    istPrivat,
    legacyZeilen,
    oeffentlich,
    interneVorschau,
    rechteZeilen,
    trefferBild,
    vorschau,
    wappenMaengel,
} from "../src/medien/medien-inspektor-modell.ts";
import { kreisDerVerwendung, kreisDesAssets } from "../src/medien/medien-kreis.ts";
import {
    installiereMedienAdresse,
    medienNamen,
    medienOffen,
    medienZustand,
    oeffneMedien,
} from "../src/medien/medien-oeffnen.ts";
import { anzeigeName } from "../src/medien/medien-text.ts";
import { MEDIEN_START, hochladbareRollen } from "../src/medien/medien-zustand.ts";
import { GARETH_ID, gareth, shown } from "./panel-fixtures.ts";

/**
 * Was die Medienverwaltung zeigt und wie sie fragt (WI-0068 P3): der Kreis, die Feldzeilen des Inspectors samt Positivliste der
 * privaten Felder, die Fehler im Umschlag, der Kontext-Einstieg aus dem Infopanel und die Adresse.
 */

const ASSET = "6dcf1e76-4c1a-4b0e-9a6e-2f1d3c4b5a69";
const LAUF = "efe85e4c-1111-4222-8333-444455556666";
const SHA = "a".repeat(64);
const AM = "2026-10-05T10:00:00.000Z";

function detail(): MediaAssetDetail {
    return {
        asset: {
            id: ASSET,
            revision: 3,
            title: null,
            kind: "image",
            assetType: "coat",
            origin: "legacy_import",
            creationMethod: "ai_generated",
            technicalState: "ok",
            moderationState: "not_applicable",
            degradedOriginal: false,
            sourceSystem: "avesmaps-legacy",
            sourceRef: "settlement_coat:42",
            createdAt: AM,
            updatedAt: AM,
            importedAt: AM,
        },
        rights: {
            revision: 1,
            basis: "own_work",
            licenseKey: null,
            licenseFamily: null,
            licenseName: null,
            licenseUri: null,
            requiresAttribution: false,
            creator: null,
            rightsHolder: null,
            attribution: null,
            clearance: "legacy_assumed",
            reviewedAt: null,
            updatedAt: AM,
            rightsNote: "nur intern",
            legacyRightsCode: "own_work",
            reviewedBy: null,
            reviewer: null,
        },
        creation: {
            revision: 1,
            updatedAt: AM,
            tool: null,
            model: "SDXL",
            prompt: "ein Fuchs auf Gold",
            negativePrompt: null,
            parameters: null,
            legacyNoteRaw: null,
        },
        ingest: [
            {
                kind: "legacy_import",
                migrationRunId: LAUF,
                sourceSystem: "avesmaps-legacy",
                sourceRef: "uploads/wappen/own/3946d663a420.png",
                ingestedAt: AM,
                actor: null,
                legacyActorLabel: null,
                legacyUploadedAt: null,
                legacyStampSemantics: null,
                submissionId: null,
                originalFilename: null,
            },
        ],
        legacySource: {
            mediaClass: "settlement_coat_own",
            legacyOrigin: "own",
            legacySource: null,
            legacyForm: null,
            legacyPublic: true,
            legacyShown: true,
            mediaRevision: null,
            fileFetchedAt: null,
            localUrl: "/uploads/wappen/own/3946d663a420.png",
            storedUrl: null,
            sourceUrl: "https://de.wiki-aventurica.de/wiki/Gareth",
        },
        representations: [
            {
                variant: "source",
                storageClass: "private_source",
                mimeType: "image/png",
                width: 128,
                height: 128,
                byteSize: 20_480,
                sha256: SHA,
                recipe: null,
                recipeVersion: null,
                createdAt: AM,
                url: null,
                storageKey: "private/source/aa/aa/aaaa.png",
            },
            {
                variant: "coat",
                storageClass: "published",
                mimeType: "image/webp",
                width: 128,
                height: 128,
                byteSize: 8_000,
                sha256: "b".repeat(64),
                recipe: "coat",
                recipeVersion: "1",
                createdAt: AM,
                url: `/media/sha256/bb/bb/${"b".repeat(64)}.webp`,
                storageKey: "published/bb/bb/bbbb.webp",
            },
        ],
        suspensions: [],
        mergedHere: [],
        usageCount: 1,
        retiredUsageCount: 0,
        sharedFileCount: 0,
        history: [],
        evidence: [],
    };
}

function usage(teil: Partial<MediaUsage> = {}): MediaUsage {
    return {
        via: "binding",
        subject: { kind: "place", id: GARETH_ID, name: "Gareth", active: true },
        role: "coat",
        gallery: null,
        origin: "legacy",
        revision: 1,
        override: { state: "none", decidedOn: null, decidedBy: null, reason: null, operatorQuote: null },
        publication: { public: true, reason: "rule" },
        ...teil,
    };
}

const summary = (teil: Partial<MamAssetSummary> = {}): MamAssetSummary => ({
    id: ASSET,
    revision: 1,
    title: null,
    kind: "image",
    assetType: "coat",
    origin: "legacy_import",
    creationMethod: "unknown",
    technicalState: "ok",
    rightsBasis: "fan_policy",
    clearance: "legacy_asserted",
    usageCount: 1,
    sharedFileCount: 0,
    fileGroup: null,
    primaryUsage: {
        subject: { kind: "place", id: GARETH_ID, name: "Gareth", active: true },
        role: "coat",
        gallery: null,
    },
    preview: null,
    published: true,
    suspended: false,
    updatedAt: AM,
    ...teil,
});

describe("Hochladen in der Trefferspalte (Schritt 7)", () => {
    it("Wappen bei den Wappen, Titelbilder bei den Bildern, beides bei „Alle Medien“, sonst nichts", () => {
        expect(hochladbareRollen({ typ: "coat" })).toEqual(["coat"]);
        expect(hochladbareRollen({ typ: "picture" })).toEqual(["header"]);
        expect(hochladbareRollen({ typ: null })).toEqual(["coat", "header"]);
        expect(hochladbareRollen({ typ: "cover" })).toEqual([]);
        expect(hochladbareRollen({ typ: "model_3d" })).toEqual([]);
        expect(hochladbareRollen({ korb: "rights_open" })).toEqual([]);
    });
});

describe("Der Kreis ○ ◐ ● (Legacys allgemeine Bedeutung, auf Medien übertragen)", () => {
    it("○ unbenutzt · ◐ verwendet, nicht öffentlich · ● verwendet und öffentlich", () => {
        expect(kreisDesAssets(summary({ usageCount: 0 }))).toBe("leer");
        expect(kreisDesAssets(summary({ published: false }))).toBe("halb");
        expect(kreisDesAssets(summary({ suspended: true }))).toBe("halb");
        expect(kreisDesAssets(summary())).toBe("voll");
    });

    it("je Verwendung die Entscheidung der Policy an genau dieser Stelle; ein Galerieeintrag ohne Bindung bleibt leer", () => {
        expect(kreisDerVerwendung(usage())).toBe("voll");
        expect(kreisDerVerwendung(usage({ publication: { public: false, reason: "legacy_assumed" } }))).toBe("halb");
        expect(kreisDerVerwendung(usage({ publication: null }))).toBe("leer");
    });
});

describe("Der Name eines Assets ohne Titel", () => {
    it("die erste Verwendung samt Rolle, sonst die Galerie, sonst die Kurzkennung", () => {
        expect(anzeigeName({ id: ASSET, title: null }, summary().primaryUsage)).toBe("Gareth · Wappen");
        expect(anzeigeName({ id: ASSET, title: "Fuchs" }, summary().primaryUsage)).toBe("Fuchs");
        expect(
            anzeigeName({ id: ASSET, title: null }, { subject: null, role: null, gallery: { id: ASSET, title: null } }),
        ).toBe("Galerie ohne Titel");
        expect(anzeigeName({ id: ASSET, title: null }, null)).toBe("Asset 6dcf1e76");
    });
});

describe("Der Inspector: private Felder nur, wenn die Route sie liefert (Positivliste)", () => {
    const intern = (zeilen: { id: string; intern: boolean }[]): string[] =>
        zeilen.filter((zeile) => zeile.intern).map((zeile) => zeile.id);

    it("🔴 jedes Feld der Positivliste trägt die Marke „intern“, keines sonst", () => {
        const d = detail();
        const rechte = rechteZeilen(d);
        expect(intern(rechte)).toEqual([
            "MediaRightsEditorView.rightsNote",
            "MediaRightsEditorView.reviewer",
            "MediaRightsEditorView.legacyRightsCode",
            "MediaAssetDetail.evidence",
        ]);
        expect(intern(entstehungZeilen(d))).toEqual(
            MEDIA_PRIVATE_FIELDS.MediaCreationEditorView.map((feld) => `MediaCreationEditorView.${feld}`),
        );
        expect(intern(eigenschaftenZeilen(d))).toEqual([]);
        expect(intern(legacyZeilen(d))).toEqual(["MediaLegacySourceView.localUrl", "MediaLegacySourceView.sourceUrl"]);
        for (const zeile of [...rechte, ...entstehungZeilen(d), ...legacyZeilen(d)]) {
            const [modell, feld] = zeile.id.split(".");
            if (modell !== undefined && feld !== undefined && modell in MEDIA_PRIVATE_FIELDS) {
                expect(zeile.intern, zeile.id).toBe(istPrivat(modell as keyof typeof MEDIA_PRIVATE_FIELDS, feld));
            }
        }
    });

    it("🔴 liefert die Route ein privates Feld nicht, steht keine Zeile da (nicht „nicht erfasst“)", () => {
        const d = detail();
        const ohne = {
            ...d,
            rights: Object.fromEntries(
                Object.entries(d.rights!).filter(
                    ([feld]) => !MEDIA_PRIVATE_FIELDS.MediaRightsEditorView.includes(feld as never),
                ),
            ) as MediaAssetDetail["rights"],
            creation: Object.fromEntries(
                Object.entries(d.creation!).filter(
                    ([feld]) => !MEDIA_PRIVATE_FIELDS.MediaCreationEditorView.includes(feld as never),
                ),
            ) as MediaAssetDetail["creation"],
        };
        delete (ohne as Partial<MediaAssetDetail>).evidence;
        expect(rechteZeilen(ohne).filter((zeile) => zeile.intern)).toEqual([]);
        expect(entstehungZeilen(ohne).map((zeile) => zeile.id)).toEqual(["MediaAssetCore.creationMethod"]);
        const ingest = Object.fromEntries(
            Object.entries(d.ingest[0]!).filter(
                ([feld]) => !MEDIA_PRIVATE_FIELDS.MediaIngestView.includes(feld as never),
            ),
        ) as MediaAssetDetail["ingest"][number];
        expect(ingestZeilen(ingest, 0).some((zeile) => zeile.intern)).toBe(false);
        const representations = d.representations.map(
            (datei) =>
                Object.fromEntries(Object.entries(datei).filter(([feld]) => feld !== "storageKey")) as typeof datei,
        );
        expect(dateiZeilen({ ...d, representations }).every((zeile) => zeile.speicher === undefined)).toBe(true);
        expect(dateiZeilen(d).map((zeile) => zeile.speicher)).toEqual([
            "private/source/aa/aa/aaaa.png",
            "published/bb/bb/bbbb.webp",
        ]);
    });

    it("WI-0275: Ein gelöschtes Original steht mit Datum da, der Master heißt so; ohne Stempel und bei einem Server der Vorversion keine Zeile", () => {
        const d = detail();
        expect(dateiZeilen(d).every((zeile) => zeile.geloescht === undefined)).toBe(true);
        const [quelle, ...rest] = d.representations;
        const gestempelt = dateiZeilen({
            ...d,
            representations: [
                { ...quelle!, bytesDeletedAt: "2026-11-12T03:00:00.000Z" },
                { ...quelle!, variant: "master", storageClass: "master", bytesDeletedAt: null },
                ...rest,
            ],
        });
        expect(gestempelt[0]?.geloescht).toContain("Original gelöscht am");
        expect(gestempelt[1]?.geloescht).toBeUndefined();
        expect(gestempelt[1]?.titel).toContain("Master (privat)");
    });

    it("`null` ist eine Auskunft: „nicht erfasst“; die Lücke aus Export B wird benannt", () => {
        const d = detail();
        const urheber = rechteZeilen(d).find((zeile) => zeile.id === "MediaRightsEditorView.creator");
        expect(urheber?.wert).toBe("nicht erfasst");
        const provenienz = ingestZeilen(d.ingest[0]!, 0);
        expect(provenienz.find((zeile) => zeile.id.endsWith(".legacyActorLabel"))?.wert).toBe(
            "unbekannt · steht nur in Export B",
        );
        expect(provenienz.find((zeile) => zeile.id.endsWith(".legacyUploadedAt"))?.wert).toBe(
            "unbekannt · steht nur in Export B",
        );
        expect(provenienz.find((zeile) => zeile.id.endsWith(".migrationRunId"))?.wert).toBe(
            "Medienzug (System) · Lauf efe85e4c",
        );
    });

    it("🔴 Urheber ≠ Hochlader: der Urheber steht bei den Rechten, wer hereinbrachte bei der Provenienz", () => {
        const d = detail();
        d.rights!.creator = "Hesindiane";
        d.ingest[0]!.legacyActorLabel = "Rondrikan";
        expect(rechteZeilen(d).find((zeile) => zeile.id.endsWith(".creator"))?.wert).toBe("Hesindiane");
        const provenienz = ingestZeilen(d.ingest[0]!, 0);
        expect(provenienz.find((zeile) => zeile.id.endsWith(".legacyActorLabel"))?.wert).toBe("Rondrikan");
        expect(provenienz.some((zeile) => zeile.wert === "Hesindiane")).toBe(false);
        // Ein Legacy-Import hat nie eine Person als Hochlader (Migration 0086): keine leere Zeile dafür.
        expect(provenienz.some((zeile) => zeile.id.endsWith(".actor"))).toBe(false);
    });

    it("Original und Vorschau: die private Quelle nennt Format und Maße, die Vorschau ist die veröffentlichte Datei", () => {
        const d = detail();
        expect(eigenschaftenZeilen(d).find((zeile) => zeile.id === "MediaAssetDetail.original")?.wert).toBe(
            "PNG, 128 × 128 px · 20 KB",
        );
        expect(vorschau(d)?.url).toBe(`/media/sha256/bb/bb/${"b".repeat(64)}.webp`);
        expect(vorschau({ ...d, representations: d.representations.slice(0, 1) })).toBeUndefined();
    });

    it("🔴 die private Vorschau (WI-0068 P4b): nur über den geschützten Weg, und nur ohne öffentliche Datei als Bild des Treffers", () => {
        const d = detail();
        const id = "11111111-2222-4333-8444-555555555555";
        const intern = {
            ...d.representations[1]!,
            variant: "intern_coat",
            storageClass: "derivative" as const,
            url: null,
            privateUrl: `/api/editor/media/${id}/preview/intern_coat`,
            storageKey: "derivatives/cc/cc/cccc.webp",
        };
        expect(interneVorschau(d)).toBeUndefined();
        expect(interneVorschau({ ...d, representations: [d.representations[0]!, intern] })?.privateUrl).toBe(
            intern.privateUrl,
        );
        // Ein Derivat ohne geschützte Adresse (ein Server der Vorversion) ist keine Vorschau.
        expect(interneVorschau({ ...d, representations: [{ ...intern, privateUrl: null }] })).toBeUndefined();

        const oeffentlichesBild = { url: `/media/sha256/bb/bb/${"b".repeat(64)}.webp`, width: 10, height: 10 };
        const privatesBild = { url: intern.privateUrl, width: 10, height: 10 };
        expect(trefferBild({ preview: oeffentlichesBild, privatePreview: privatesBild })).toEqual({
            ...oeffentlichesBild,
            intern: false,
        });
        expect(trefferBild({ preview: null, privatePreview: privatesBild })).toEqual({ ...privatesBild, intern: true });
        expect(trefferBild({ preview: null })).toBeNull();
    });

    it("🔴 T2b: die Mängel eines Wappens als Satz; ein Wappen aus dem Editor mit undurchsichtigen Ecken bleibt privat", () => {
        const d = detail();
        const mit = (cornersTransparent: boolean | null, width: number, height: number, origin = d.asset.origin) => ({
            ...d,
            asset: { ...d.asset, origin },
            representations: [{ ...d.representations[0]!, cornersTransparent, width, height }, d.representations[1]!],
        });
        expect(wappenMaengel(mit(true, 128, 128))).toBeUndefined();
        expect(wappenMaengel(mit(null, 128, 128))).toBeUndefined();
        expect(wappenMaengel(mit(false, 128, 128))).toBe(
            "Wappen mit Mängeln: die Ecken sind nicht durchsichtig. Es bleibt, wie es ist.",
        );
        expect(wappenMaengel(mit(true, 90, 128))).toBe(
            "Wappen mit Mängeln: nicht quadratisch (90 × 128 px). Es bleibt, wie es ist.",
        );
        // Ein Wappen aus dem Editor wird aufgefüllt: nicht quadratisch ist dort kein Mangel, undurchsichtig hält es privat.
        expect(wappenMaengel(mit(true, 160, 120, "editor_upload"))).toBeUndefined();
        expect(wappenMaengel(mit(false, 160, 120, "editor_upload"))).toBe(
            "Bleibt privat: die Ecken sind nicht durchsichtig. Ein Wappen braucht einen durchsichtigen Hintergrund.",
        );
        expect(wappenMaengel({ ...mit(false, 90, 128), asset: { ...d.asset, assetType: "picture" } })).toBeUndefined();
    });

    it("Rechte: Prüfstand färbt sich, gespeichert ist nicht geprüft; eine Lizenz mit Adresse wird ein Verweis", () => {
        const d = detail();
        expect(rechteZeilen(d).find((zeile) => zeile.id.endsWith(".clearance"))).toMatchObject({
            wert: "angenommen",
            ton: "warnung",
        });
        d.rights!.clearance = "cleared";
        d.rights!.reviewedAt = AM;
        d.rights!.licenseName = "CC BY 4.0";
        d.rights!.licenseUri = "https://creativecommons.org/licenses/by/4.0/";
        expect(rechteZeilen(d).find((zeile) => zeile.id.endsWith(".clearance"))).toMatchObject({
            wert: "geprüft am 05.10.2026",
            ton: "erfolg",
        });
        expect(rechteZeilen(d).find((zeile) => zeile.id.endsWith(".licenseName"))?.verweis).toBe(
            "https://creativecommons.org/licenses/by/4.0/",
        );
        d.rights!.licenseUri = "javascript:alert(1)";
        expect(rechteZeilen(d).find((zeile) => zeile.id.endsWith(".licenseName"))?.verweis).toBeUndefined();
    });

    it("öffentlich heißt: mindestens eine Verwendung ist heute frei; der Satz nennt den Grund der ersten", () => {
        const result = (usages: MediaUsage[]): MediaUsageResult => ({
            asset: { id: ASSET, revision: 1 },
            usages,
            retired: 0,
            sameFile: [],
        });
        expect(oeffentlich(result([usage()]))).toBe(true);
        expect(freigabeSatz(result([usage()]))).toBe("Öffentlich: über eine Freigaberegel.");
        const zu = result([usage({ publication: { public: false, reason: "fan_policy_needs_approval" } })]);
        expect(oeffentlich(zu)).toBe(false);
        expect(freigabeSatz(zu)).toBe("Nicht öffentlich: die Fanrichtlinie braucht eine Freigabe.");
        expect(freigabeSatz(result([]))).toBeUndefined();
    });
});

describe("Fehler im Umschlag (ADR-0018): nach dem Code, nie nach dem Text des Servers", () => {
    it("🔴 401 und 403 sind eine Auskunft ohne „Erneut versuchen“", () => {
        expect(medienFehler(new ApiFailure(401, "unauthenticated", "x"))).toMatchObject({
            text: "Für die Medienverwaltung ist eine Anmeldung nötig.",
            erneut: false,
        });
        expect(medienFehler(new ApiFailure(403, "forbidden", "x"))).toMatchObject({
            text: "Für die Medienverwaltung fehlt das Recht „Medienverwaltung öffnen“.",
            ton: "gefahr",
            erneut: false,
        });
        expect(medienFehler(new ApiFailure(403, "reauth_required", "x")).text).toBe(
            "Die Anmeldung muss kurz bestätigt werden.",
        );
    });

    it("404, Netz, Server und Unbekanntes", () => {
        expect(medienFehler(new ApiFailure(404, "not_found", "x"))).toMatchObject({ ton: "gefahr", erneut: false });
        expect(medienFehler(new ApiFailure(0, "network", "x"))).toMatchObject({
            text: "Keine Verbindung zum Server.",
            erneut: true,
        });
        expect(medienFehler(new ApiFailure(503, "auth_unavailable", "x")).text).toBe(
            "Die Anmeldung ist auf dieser Instanz nicht eingerichtet.",
        );
        expect(medienFehler(new ApiFailure(500, "unavailable", "x")).text).toBe(
            "Die Medienverwaltung antwortet gerade nicht.",
        );
        expect(medienFehler(new ApiFailure(409, "edit_conflict", "x")).text).toBe(
            "Konnte nicht geladen werden (edit_conflict).",
        );
        // Ein Fehler in der Seite ist kein Netzfehler mehr (WI-0202, W5-05): eigener Code, kein „Erneut versuchen“.
        const konsole = vi.spyOn(console, "error").mockImplementation(() => undefined);
        expect(medienFehler(new Error("kaputt"))).toMatchObject({ code: "client", erneut: false });
        konsole.mockRestore();
    });
});

describe("Der Lesepfad im Browser", () => {
    it("fragt die fünf Routen aus P2, ohne Cache, mit dem Signal des Wunsches", async () => {
        const gefragt: { url: string; init: RequestInit | undefined }[] = [];
        const client = createMedienClient((url, init) => {
            gefragt.push({ url: String(url), init });
            return Promise.resolve(
                new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
            );
        });
        const signal = new AbortController().signal;
        await client.navigation(signal);
        await client.suche({ kind: "image", sort: "name", limit: 100, offset: 0 }, signal);
        await client.asset(ASSET, signal);
        await client.verwendung(ASSET, signal);
        await client.galerie(ASSET, signal);
        expect(gefragt.map((frage) => frage.url)).toEqual([
            "/api/editor/media/navigation",
            "/api/editor/media?kind=image&limit=100&offset=0&sort=name",
            `/api/editor/media/${ASSET}`,
            `/api/editor/media/${ASSET}/usage`,
            `/api/editor/galleries/${ASSET}`,
        ]);
        for (const frage of gefragt) {
            expect(frage.init?.signal).toBe(signal);
            expect(frage.init?.cache).toBe("no-store");
            expect(frage.init?.method).toBe("GET");
        }
    });

    it("ein Fehler des Servers kommt als `ApiFailure` mit Code; ein abgebrochener Wunsch ist kein Fehler", async () => {
        const client = createMedienClient(() =>
            Promise.resolve(
                new Response(JSON.stringify({ error: { code: "forbidden", message: "Dafür fehlt das Recht." } }), {
                    status: 403,
                }),
            ),
        );
        await expect(client.navigation(new AbortController().signal)).rejects.toMatchObject({
            status: 403,
            code: "forbidden",
        });
        const abbruch = new AbortController();
        abbruch.abort();
        expect(istAbbruch(new ApiFailure(0, "network", ""), abbruch.signal)).toBe(true);
        expect(istAbbruch(new ApiFailure(0, "network", ""), new AbortController().signal)).toBe(false);
    });
});

describe("Kontext-Einstieg: Wappen oder Kopfbild öffnen genau dieses Asset (WI-0068 §13)", () => {
    afterEach(() => {
        medienOffen.value = false;
        medienZustand.value = { ...MEDIEN_START };
        medienNamen.value = {};
    });

    it("das Infopanel reicht Asset und Fachobjekt; nur Ort und Gebiet sind „verwendet von“", () => {
        const geoeffnet: unknown[] = [];
        const deps = { openMedia: (ziel: unknown) => geoeffnet.push(ziel) } as unknown as PanelActionDeps;
        createPanelActions(deps).run({ type: "openMedia", asset: ASSET, name: "Gareth" }, shown(gareth));
        expect(geoeffnet).toEqual([{ asset: ASSET, von: { kind: "place", id: GARETH_ID, name: "Gareth" } }]);
        expect(mediaSubjectOf({ kind: "territory", id: GARETH_ID })).toEqual({ kind: "territory", id: GARETH_ID });
        expect(mediaSubjectOf({ kind: "peak", id: GARETH_ID })).toBeUndefined();
    });

    it("ohne die Naht (Besucher) geschieht nichts", () => {
        const deps = {} as PanelActionDeps;
        expect(() =>
            createPanelActions(deps).run({ type: "openMedia", asset: ASSET, name: "x" }, shown(gareth)),
        ).not.toThrow();
    });

    it("🔴 `oeffneMedien` mit Ziel: Asset im Inspector, Treffer auf das Fachobjekt beschränkt, der Name gemerkt", () => {
        oeffneMedien({ asset: ASSET, von: { kind: "place", id: GARETH_ID, name: "Gareth" } });
        expect(medienOffen.value).toBe(true);
        expect(medienZustand.value).toEqual({ ...MEDIEN_START, asset: ASSET, von: `place:${GARETH_ID}` });
        expect(medienNamen.value[`place:${GARETH_ID}`]).toBe("Gareth");
    });

    it("ohne Ziel (Hauptmenü) mit dem Stand von zuletzt", () => {
        medienZustand.value = { ...MEDIEN_START, auswahl: { korb: "unused" } };
        oeffneMedien();
        expect(medienZustand.value.auswahl).toEqual({ korb: "unused" });
    });
});

describe("Die Adresse folgt dem offenen Fenster", () => {
    afterEach(() => {
        medienOffen.value = false;
        medienZustand.value = { ...MEDIEN_START };
    });

    function ort(search: string): { search: string; pathname: string; hash: string } {
        return { search, pathname: "/edit", hash: "#x=520&y=500&z=5" };
    }

    it("🔴 mit dem Recht öffnet `?medien=<asset>` beim Laden genau dieses Asset; ohne Recht geht nichts auf", () => {
        const aus = installiereMedienAdresse(false, ort(`?medien=${ASSET}`), { replaceState: () => undefined });
        expect(medienOffen.value).toBe(false);
        aus();
        const an = installiereMedienAdresse(true, ort(`?medien=${ASSET}`), { replaceState: () => undefined });
        expect(medienOffen.value).toBe(true);
        expect(medienZustand.value.asset).toBe(ASSET);
        an();
    });

    it("offen steht der Stand in der Query (ohne neuen Eintrag im Verlauf), geschlossen verschwindet er", async () => {
        const adresse = ort("?route=Gareth~Perricum");
        const geschrieben: string[] = [];
        const stop = installiereMedienAdresse(true, adresse, {
            replaceState: (_state, _unused, url) => {
                geschrieben.push(String(url));
                adresse.search = String(url)
                    .replace(/^[^?#]*/, "")
                    .replace(/#.*$/, "");
            },
        });
        oeffneMedien({ asset: ASSET });
        await nextTick();
        expect(geschrieben.at(-1)).toBe(`/edit?route=Gareth~Perricum&medien=${ASSET}#x=520&y=500&z=5`);
        medienOffen.value = false;
        await nextTick();
        expect(geschrieben.at(-1)).toBe("/edit?route=Gareth~Perricum#x=520&y=500&z=5");
        stop();
    });
});
