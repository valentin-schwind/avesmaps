import { describe, expect, it } from "vitest";
import { parseMediaManifest } from "../src/migration/media-manifest.ts";
import { compareTerritoryCoats } from "../src/migration/media-territory-coat.ts";
import { comparePublicToPrivate, planMedia, type SubjectIndex } from "../src/migration/media-plan.ts";
import { manifestOf, rawItem, subjectId, type ItemSpec } from "./support/media-import-fixture.ts";

/**
 * Das Manifest lesen und den Plan rechnen (WI-0063 MEDIA-M8): rein, ohne Datenbank. Die Beispiele folgen Legacys Beispielantworten
 * `docs/legacy-exporte/media-export*.beispiel.json` (Legacy-Commit `024e3af3d`).
 */

const place = (n: number) => subjectId("place", n);
const territory = (n: number) => subjectId("territory", n);
const adventure = (n: number) => subjectId("adventure", n);
const citymap = (n: number) => subjectId("citymap", n);

function index(spec: {
    places?: number[];
    territories?: number[];
    adventures?: number[];
    citymaps?: number[];
}): SubjectIndex {
    const entries = (kind: "place" | "territory" | "adventure" | "citymap", numbers: number[] = []) =>
        new Map(numbers.map((n) => [subjectId(kind, n), { id: String(n), name: `${kind} ${String(n)}` }]));
    return {
        place: entries("place", spec.places),
        territory: entries("territory", spec.territories),
        adventure: entries("adventure", spec.adventures),
        citymap: entries("citymap", spec.citymaps),
    };
}

const parse = (specs: readonly ItemSpec[], kind: "public" | "private" = "public") => {
    const result = parseMediaManifest(manifestOf(specs, kind));
    if (result.manifest === null) throw new Error("Manifest unbrauchbar");
    return result;
};

const codes = (findings: { code: string }[]) => findings.map((finding) => finding.code).sort();

describe("Manifest lesen", () => {
    it("eine unbrauchbare Antwort schreibt nichts: nicht ok, keine Liste, leere Liste, falscher Zähler", () => {
        expect(parseMediaManifest(null).manifest).toBeNull();
        expect(codes(parseMediaManifest({ ok: false, items: [] }).findings)).toEqual(["source_block_missing"]);
        expect(codes(parseMediaManifest({ ok: true }).findings)).toEqual(["source_block_missing"]);
        expect(codes(parseMediaManifest({ ok: true, items: [], counts: { items: 0 } }).findings)).toEqual([
            "source_empty_catalog",
        ]);
        const full = manifestOf([{ cls: "settlement_coat", subject: place(1), code: "public_domain" }], "public");
        expect(codes(parseMediaManifest({ ...full, counts: { items: 2 } }).findings)).toEqual([
            "source_count_mismatch",
        ]);
        expect(codes(parseMediaManifest({ ...full, counts: {} }).findings)).toEqual(["source_count_mismatch"]);
        expect(parseMediaManifest({ ...full, counts: { items: 2 } }).manifest).toBeNull();
    });

    it("erkennt Export A und B an den Blöcken der Literatur und der Karten", () => {
        const specs: ItemSpec[] = [{ cls: "settlement_coat", subject: place(1), code: "public_domain" }];
        expect(parse(specs, "public").manifest?.kind).toBe("public");
        expect(parse(specs, "private").manifest?.kind).toBe("private");
    });

    it("liest die privaten Felder nur, wo sie stehen, und nimmt Leerwerte als null", () => {
        const { manifest } = parse(
            [
                {
                    cls: "settlement_image",
                    subject: place(1),
                    url: "/uploads/siedlungen/a/ki.webp?v=123",
                    code: "ai_generated",
                    priv: {
                        note: "  Prompt roh  ",
                        uploaded_by: "beispiel-login",
                        uploaded_at: "2026-09-02T10:00:00Z",
                        author: "",
                    },
                },
            ],
            "private",
        );
        const item = manifest?.items[0];
        expect(item).toMatchObject({
            localUrl: "/uploads/siedlungen/a/ki.webp",
            note: "Prompt roh",
            uploadedBy: "beispiel-login",
            author: null,
            legacyForm: "object",
            shown: true,
        });
        const publicItem = parse([{ cls: "settlement_image", subject: place(1), code: "ai_generated" }], "public")
            .manifest?.items[0];
        expect(publicItem).toMatchObject({
            note: null,
            uploadedBy: null,
            uploadedAt: null,
            shown: null,
            storedUrl: null,
        });
    });

    it("lässt Einträge fallen, deren Identität unsicher ist, und meldet sie", () => {
        const good = rawItem({ cls: "settlement_coat", subject: place(1), code: "public_domain" }, "public");
        const unknownClass = { ...good, legacy_media_key: "x:1", media_class: "social_image" };
        const badSubject = {
            ...good,
            legacy_media_key: "settlement-coat:ort-1:/uploads/a.png",
            subject_public_id: "ort-1",
        };
        const wrongKey = { ...good, legacy_media_key: `settlement-image:${place(1)}:/uploads/a.png` };
        const duplicate = { ...good };
        const parsed = parseMediaManifest({
            ok: true,
            counts: { items: 5 },
            items: [good, unknownClass, badSubject, wrongKey, duplicate],
        });
        expect(parsed.manifest?.items).toHaveLength(1);
        expect(codes(parsed.findings)).toEqual([
            "bad_subject_id",
            "duplicate_media_key",
            "key_class_mismatch",
            "unknown_media_class",
        ]);
    });

    it("eine Adresse außerhalb von /uploads/ ist keine lokale Datei (null), auch mit .. oder Rückwärtsstrich", () => {
        const base = rawItem({ cls: "settlement_coat", subject: place(1), code: "public_domain" }, "public");
        for (const local of [
            "https://de.wiki-aventurica.de/images/a.png",
            "/uploads/../etc/passwd",
            "/uploads/a\\b.png",
            "/images/a.png",
            "",
        ]) {
            const parsed = parseMediaManifest({
                ok: true,
                counts: { items: 1 },
                items: [{ ...base, local_url: local }],
            });
            expect(parsed.manifest?.items[0]?.localUrl, local).toBeNull();
        }
    });

    it("Legacys Zähler je Klasse, der von der Liste abweicht, ist ein Befund (die Liste gewinnt)", () => {
        const full = manifestOf([{ cls: "settlement_coat", subject: place(1), code: "public_domain" }], "public");
        const wrong = { ...full, counts: { items: 1, by_class: { settlement_coat: 3 } } };
        const parsed = parseMediaManifest(wrong);
        expect(parsed.manifest?.items).toHaveLength(1);
        expect(codes(parsed.findings)).toEqual(["source_class_count_mismatch"]);
    });
});

describe("Plan", () => {
    it("🔴 Ortsbilder: ab zwei eine Galerie in Legacys Reihenfolge, genau eines wird das Titelbild (Betreiber 2026-10-17, über den Zug)", () => {
        const { manifest } = parse([
            { cls: "settlement_image", subject: place(1), url: "/uploads/siedlungen/p1/c.webp", sort: 2 },
            { cls: "settlement_image", subject: place(1), url: "/uploads/siedlungen/p1/a.webp", sort: 0 },
            { cls: "settlement_image", subject: place(1), url: "/uploads/siedlungen/p1/b.webp", sort: 1 },
            { cls: "settlement_image", subject: place(2), url: "/uploads/siedlungen/p2/x.webp", sort: 0 },
        ]);
        const plan = planMedia(manifest as NonNullable<typeof manifest>, index({ places: [1, 2] }));
        // „legacy galerien mit einem bild sind titelbilder, keine galerien.“ (Betreiber 2026-10-12)
        expect(plan.bindings).toEqual([
            {
                subjectKind: "place",
                subjectPublicId: place(2),
                role: "header",
                key: expect.stringContaining("/uploads/siedlungen/p2/x.webp") as unknown as string,
                origin: "legacy",
            },
        ]);
        expect(plan.galleries.map((gallery) => gallery.ref)).toEqual([`settlement-gallery:${place(1)}`]);
        expect(plan.galleries[0]?.items.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
        expect(plan.galleries[0]?.items.map((item) => item.key.split(":").pop())).toEqual([
            "/uploads/siedlungen/p1/a.webp",
            "/uploads/siedlungen/p1/b.webp",
            "/uploads/siedlungen/p1/c.webp",
        ]);
        expect(plan.assets.every((asset) => asset.role === "header")).toBe(true);
    });

    it("die Rolle folgt der Klasse, Legacys Rollenwert zählt nicht", () => {
        const { manifest } = parse([
            { cls: "settlement_coat", subject: place(1), code: "public_domain", origin: "wiki_localized" },
            { cls: "territory_coat", subject: territory(1), code: "public_domain", origin: "custom" },
            { cls: "citymap_full", subject: citymap(1), code: "own_work" },
            { cls: "citymap_preview", subject: citymap(1), code: "permission_granted", origin: "autoget" },
            { cls: "literature_cover", subject: adventure(1), code: "permission_granted", origin: "wiki_sync" },
        ]);
        const plan = planMedia(
            manifest as NonNullable<typeof manifest>,
            index({ places: [1], territories: [1], adventures: [1], citymaps: [1] }),
        );
        expect(plan.bindings.map((binding) => `${binding.subjectKind}/${binding.role}/${binding.origin}`)).toEqual([
            "place/coat/wiki_localized",
            "territory/coat/legacy",
            "citymap/map_full/legacy",
            "citymap/map_preview/legacy",
            "adventure/literature_cover/wiki_localized",
        ]);
        const byClass = Object.fromEntries(plan.assets.map((asset) => [asset.mediaClass, asset]));
        expect(byClass["citymap_preview"]?.rights.basis).toBe("fan_policy");
        expect(byClass["literature_cover"]?.rights.basis).toBe("fan_policy");
        expect(byClass["citymap_full"]?.rights.basis).toBe("own_work");
        expect(byClass["settlement_coat"]?.origin).toBe("wiki_localized");
        expect(byClass["citymap_preview"]?.origin).toBe("external_import");
        expect(plan.findings.map((finding) => finding.code)).toContain("wappen_state_unknown");
    });

    it("ein Fachobjekt, das es im Ziel nicht gibt, ist ein Befund: weder Asset noch Bindung", () => {
        const { manifest } = parse([
            { cls: "settlement_coat", subject: place(1), code: "public_domain" },
            { cls: "settlement_coat", subject: place(9), code: "public_domain" },
            { cls: "settlement_image", subject: place(9), sort: 0 },
        ]);
        const plan = planMedia(manifest as NonNullable<typeof manifest>, index({ places: [1] }));
        expect(plan.assets).toHaveLength(1);
        expect(plan.byClass.settlement_coat.orphans).toBe(1);
        expect(plan.byClass.settlement_image.orphans).toBe(1);
        const finding = plan.findings.find((entry) => entry.code === "orphan_binding");
        expect(finding?.objectCount).toBe(2);
        expect(finding?.objects.map((object) => object.publicId)).toEqual([place(9), place(9)]);
    });

    it("eine nur fremde Adresse ist external_unlocalized: nicht als lokales Asset behauptet, nicht geladen", () => {
        const { manifest } = parse(
            [
                {
                    cls: "settlement_coat",
                    subject: place(1),
                    code: "public_domain",
                    url: null,
                    origin: "wiki_staging",
                    priv: { stored_url: "https://de.wiki-aventurica.de/images/wappen.png" },
                },
            ],
            "private",
        );
        const plan = planMedia(manifest as NonNullable<typeof manifest>, index({ places: [1] }));
        expect(plan.assets).toEqual([]);
        expect(plan.bindings).toEqual([]);
        const finding = plan.findings.find((entry) => entry.code === "external_unlocalized");
        expect(finding?.objects[0]?.name).toBe("https://de.wiki-aventurica.de/images/wappen.png");
    });

    it("coat_none und der leere Gebiets-Override sind Unterdrückungen ohne Asset, nicht „fehlend“", () => {
        const { manifest } = parse(
            [
                { cls: "settlement_coat", subject: place(1), url: null, suppressed: true, public: false },
                {
                    cls: "territory_coat",
                    subject: territory(1),
                    url: null,
                    suppressed: true,
                    public: false,
                    source: "override",
                },
            ],
            "private",
        );
        const plan = planMedia(manifest as NonNullable<typeof manifest>, index({ places: [1], territories: [1] }));
        expect(plan.assets).toEqual([]);
        expect(plan.suppressions).toEqual([
            { subjectKind: "place", subjectPublicId: place(1), role: "coat", key: `settlement-coat:${place(1)}:none` },
            {
                subjectKind: "territory",
                subjectPublicId: territory(1),
                role: "coat",
                key: `territory-coat:${territory(1)}:override:none`,
            },
        ]);
        expect(plan.byClass.settlement_coat.suppressions).toBe(1);
        // Mit Export B ist der Zustand bekannt: kein Befund wappen_state_unknown.
        expect(plan.findings.map((finding) => finding.code)).not.toContain("wappen_state_unknown");
    });

    it("Wappen und Unterdrückung derselben Rolle schließen sich aus: das Wappen gilt, der Widerspruch ist ein Befund", () => {
        const { manifest } = parse(
            [
                { cls: "settlement_coat", subject: place(1), code: "public_domain", url: "/uploads/wappen/a.png" },
                { cls: "settlement_coat", subject: place(1), url: null, suppressed: true, public: false },
            ],
            "private",
        );
        const plan = planMedia(manifest as NonNullable<typeof manifest>, index({ places: [1] }));
        expect(plan.bindings).toHaveLength(1);
        expect(plan.suppressions).toEqual([]);
        expect(plan.findings.map((finding) => finding.code)).toContain("suppression_and_binding_conflict");
    });

    it("zwei Medien in derselben Einzelrolle: nur das erste, das zweite ist ein Befund (keine zweite aktive Bindung)", () => {
        const { manifest } = parse([
            { cls: "citymap_full", subject: citymap(1), url: "/uploads/kartensammlungen/a.png", code: "own_work" },
            { cls: "citymap_full", subject: citymap(1), url: "/uploads/kartensammlungen/b.png", code: "own_work" },
        ]);
        const plan = planMedia(manifest as NonNullable<typeof manifest>, index({ citymaps: [1] }));
        expect(plan.assets).toHaveLength(1);
        expect(plan.findings.map((finding) => finding.code)).toContain("duplicate_binding_role");
    });

    it("Befunde der Rechte: Vorgabe, cc_by ohne Version, unbekannter Code, ungeklärt, Zwischenspeicher, nicht genehmigt", () => {
        const { manifest } = parse(
            [
                {
                    cls: "settlement_image",
                    subject: place(1),
                    url: "/uploads/siedlungen/a/1.webp",
                    sort: 0,
                    code: null,
                },
                { cls: "citymap_full", subject: citymap(1), url: "/uploads/kartensammlungen/a.png", code: "cc_by" },
                {
                    cls: "citymap_preview",
                    subject: citymap(1),
                    url: "/uploads/kartensammlungen/p.webp",
                    code: "Creative Commons",
                },
                {
                    cls: "literature_cover",
                    subject: adventure(1),
                    url: "/uploads/questcovers/a.webp",
                    code: null,
                    suppressed: true,
                },
                {
                    cls: "settlement_coat",
                    subject: place(2),
                    url: "/uploads/wappen/cache/abc123.png",
                    code: "public_domain",
                    origin: "wiki_localized",
                },
            ],
            "private",
        );
        const plan = planMedia(
            manifest as NonNullable<typeof manifest>,
            index({ places: [1, 2], citymaps: [1], adventures: [1] }),
        );
        expect(codes(plan.findings)).toEqual([
            "assumed_default_license",
            "cache_path_source",
            "cc_by_without_version",
            "legacy_rights_code_unknown",
            "rights_unresolved",
            "subject_not_approved",
        ]);
        // Ein nicht genehmigtes Cover behält sein Asset und seine Bindung: das Werk bestimmt die Sichtbarkeit.
        expect(plan.bindings.some((binding) => binding.role === "literature_cover")).toBe(true);
    });

    it("Stempel, Login und Notiz kommen aus Export B; Notiz von Bild und Wappen roh, von Karte und Cover als Rechtenotiz", () => {
        const { manifest } = parse(
            [
                {
                    cls: "settlement_image",
                    subject: place(1),
                    url: "/uploads/siedlungen/a/1.webp",
                    code: "ai_generated",
                    priv: {
                        note: "Prompt: Hafenstadt bei Nacht",
                        uploaded_by: "thomas",
                        uploaded_at: "2026-09-02T10:00:00Z",
                    },
                },
                {
                    cls: "citymap_full",
                    subject: citymap(1),
                    url: "/uploads/kartensammlungen/a.png",
                    code: "own_work",
                    priv: {
                        note: "Rechtenotiz intern",
                        uploaded_by: "anna",
                        uploaded_at: "2026-09-04 10:00:00",
                        author: "Zeichnerin",
                    },
                },
                {
                    cls: "territory_coat",
                    subject: territory(1),
                    url: "/uploads/wappen/a.png",
                    code: "cc_by",
                    origin: "wiki_localized",
                    priv: {
                        license_text: "CC BY-SA 3.0 DE",
                        author: "Xeledon",
                        attribution: "Wiki Aventurica",
                        note: "Override-Notiz",
                    },
                },
            ],
            "private",
        );
        const plan = planMedia(
            manifest as NonNullable<typeof manifest>,
            index({ places: [1], citymaps: [1], territories: [1] }),
        );
        const [image, map, coat] = plan.assets;
        expect(image).toMatchObject({
            ingestActorLegacy: "thomas",
            legacyUploadedAt: "2026-09-02T10:00:00.000Z",
            stampSemantics: "last_classification",
            legacyNoteRaw: "Prompt: Hafenstadt bei Nacht",
            creationMethod: "ai_generated",
        });
        expect(image?.rights.rightsNote).toBeNull();
        expect(map).toMatchObject({
            legacyNoteRaw: null,
            stampSemantics: "upload",
            legacyUploadedAt: "2026-09-04T10:00:00.000Z",
        });
        expect(map?.rights).toMatchObject({ rightsNote: "Rechtenotiz intern", creator: "Zeichnerin" });
        // Das Gebiet: der Klartext des Wikis bleibt in der Rechtenotiz, die Override-Notiz roh daneben.
        expect(coat).toMatchObject({ legacyNoteRaw: "Override-Notiz" });
        expect(coat?.rights).toMatchObject({
            rightsNote: "CC BY-SA 3.0 DE",
            creator: "Xeledon",
            attribution: "Wiki Aventurica",
            licenseKey: null,
        });
        expect(plan.findings.map((finding) => finding.code)).toContain("stamp_semantics");
    });

    it("Export A kennt weder Notiz noch Stempel noch Unterdrückung: nichts davon wird erfunden", () => {
        const { manifest } = parse(
            [{ cls: "settlement_image", subject: place(1), url: "/uploads/siedlungen/a/1.webp", code: "ai_generated" }],
            "public",
        );
        const plan = planMedia(manifest as NonNullable<typeof manifest>, index({ places: [1] }));
        expect(plan.kind).toBe("public");
        expect(plan.assets[0]).toMatchObject({
            ingestActorLegacy: null,
            legacyUploadedAt: null,
            stampSemantics: null,
            legacyNoteRaw: null,
        });
        expect(plan.suppressions).toEqual([]);
        expect(plan.findings.map((finding) => finding.code)).toContain("wappen_state_unknown");
    });
});

describe("Gebietswappen: E4 (Wappenzustand im Gebietsexport) und E5 sagen dasselbe", () => {
    const coat = (extra: Record<string, unknown>) => ({
        state: "undecided",
        source: null,
        origin: null,
        url: null,
        license_status: null,
        public: false,
        shown: false,
        ...extra,
    });
    const row = (n: number, value: Record<string, unknown>) => ({
        public_id: territory(n),
        name: `Gebiet ${String(n)}`,
        coat: value,
    });

    it("Wappen, Unterdrückung und Wiki-Kandidat ohne Entscheid stimmen überein; ein fehlendes oder überzähliges Wappen ist ein Widerspruch", () => {
        const { manifest } = parse(
            [
                {
                    cls: "territory_coat",
                    subject: territory(1),
                    url: "/uploads/wappen/t1-custom.png",
                    code: "public_domain",
                    origin: "custom",
                    source: "override",
                    priv: { legacy_source: "override" },
                },
                {
                    cls: "territory_coat",
                    subject: territory(2),
                    url: null,
                    suppressed: true,
                    public: false,
                    source: "override",
                },
                {
                    cls: "territory_coat",
                    subject: territory(3),
                    url: "/uploads/wappen/t3.png",
                    code: "public_domain",
                    origin: "wiki_localized",
                    source: "staging",
                    priv: { legacy_source: "staging" },
                },
                {
                    cls: "territory_coat",
                    subject: territory(6),
                    url: "/uploads/wappen/t6.png",
                    code: "public_domain",
                    origin: "wiki_localized",
                    source: "territory",
                },
            ],
            "private",
        );
        const plan = planMedia(manifest as NonNullable<typeof manifest>, index({ territories: [1, 2, 3, 4, 5, 6] }));
        // Der Wiki-Kandidat wird gebunden (Herkunft wiki_localized) und als Befund genannt, nie geraten.
        expect(plan.bindings.find((binding) => binding.subjectPublicId === territory(3))?.origin).toBe(
            "wiki_localized",
        );
        expect(plan.findings.find((finding) => finding.code === "wiki_candidate_bound")?.objectCount).toBe(1);
        const payload = {
            territories: [
                row(
                    1,
                    coat({
                        state: "set",
                        source: "override",
                        origin: "custom",
                        url: "/uploads/wappen/t1-custom.png",
                        license_status: "public_domain",
                        public: true,
                        shown: true,
                    }),
                ),
                row(2, coat({ state: "none" })),
                row(
                    3,
                    coat({
                        state: "undecided",
                        source: "staging",
                        origin: "wiki_localized",
                        url: "/uploads/wappen/t3.png",
                        license_status: "public_domain",
                        public: true,
                        shown: true,
                    }),
                ),
                row(4, coat({ state: "undecided" })),
                // E4 sagt „gesetzt“, E5 nennt nichts.
                row(
                    5,
                    coat({
                        state: "set",
                        source: "territory",
                        origin: "custom",
                        url: "/uploads/wappen/t5-custom.png",
                        license_status: "public_domain",
                        public: true,
                        shown: true,
                    }),
                ),
                // E4 sagt „kein Entscheid und kein Kandidat“, E5 nennt ein Wappen.
                row(6, coat({ state: "undecided" })),
                { public_id: territory(7), name: "ohne coat" },
            ],
        };
        const agreement = compareTerritoryCoats(plan, payload);
        expect(agreement.compared).toBe(6);
        expect(agreement.agreed).toBe(4);
        expect(agreement.disagreements).toHaveLength(2);
        expect(agreement.disagreements.join("\n")).toContain("Gebiet 5");
        expect(agreement.disagreements.join("\n")).toContain("Gebiet 6");
    });

    it("eine Antwort ohne Gebietsliste vergleicht nichts", () => {
        const { manifest } = parse(
            [{ cls: "territory_coat", subject: territory(1), url: "/uploads/wappen/a.png", code: "public_domain" }],
            "private",
        );
        const plan = planMedia(manifest as NonNullable<typeof manifest>, index({ territories: [1] }));
        expect(compareTerritoryCoats(plan, { ok: true })).toEqual({ compared: 0, agreed: 0, disagreements: [] });
    });
});

describe("Öffentliches und privates Manifest", () => {
    it("A ist eine Teilmenge von B: ein Eintrag von A, der in B fehlt oder dort nicht gezeigt wird, ist ein Befund", () => {
        const items: ItemSpec[] = [
            { cls: "settlement_coat", subject: place(1), url: "/uploads/wappen/a.png", code: "public_domain" },
            { cls: "settlement_coat", subject: place(2), url: "/uploads/wappen/b.png", code: "public_domain" },
        ];
        const publicManifest = parse(items, "public").manifest;
        const privateManifest = parse(items, "private").manifest;
        if (publicManifest === null || privateManifest === null) throw new Error("Manifest unbrauchbar");
        expect(comparePublicToPrivate(publicManifest, privateManifest)).toBeNull();
        const hidden = parse(
            [items[0] as ItemSpec, { ...(items[1] as ItemSpec), priv: { shown: false } }],
            "private",
        ).manifest;
        const missing = parse([items[0] as ItemSpec], "private").manifest;
        if (hidden === null || missing === null) throw new Error("Manifest unbrauchbar");
        expect(comparePublicToPrivate(publicManifest, hidden)?.objectCount).toBe(1);
        expect(comparePublicToPrivate(publicManifest, missing)?.code).toBe("public_manifest_drift");
    });
});
