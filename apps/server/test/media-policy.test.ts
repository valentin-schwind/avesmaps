import { describe, expect, it } from "vitest";
import {
    MEDIA_CLEARANCE_STATES,
    MEDIA_CREATION_METHODS,
    MEDIA_ROLES,
    PHOTOBOX_CREATION_METHOD,
    PHOTOBOX_RIGHTS,
    PHOTOBOX_USAGE_GRANTS,
    contentSwitchSpec,
    type MediaRole,
} from "@avesmaps3d/shared";
import {
    ALLOW_REASONS,
    DENY_REASONS,
    decidePublication,
    type PublicationDecision,
    type PublicationRequest,
    type PublicationRuleFacts,
} from "../src/media/policy.ts";

/**
 * Die EINE Veröffentlichungsentscheidung als Tabelle (WI-0063 26.12, media.yaml → rechte.oeffentlichkeit, G1 = A).
 * Rein: jede Zeile ist eine Rechtelage und ihr Grundcode.
 */

type Rights = NonNullable<PublicationRequest["rights"]>;

const OWN_WORK_CLEARED: Rights = {
    basis: "own_work",
    clearance: "cleared",
    licenseKey: null,
    licenseRequiresAttribution: null,
};

/** Ein ausdrücklich freigebbares Asset: eigenes Werk, geklärt, mit veröffentlichter WebP-Datei. */
function request(overrides: {
    role?: PublicationRequest["role"];
    asset?: Partial<PublicationRequest["asset"]>;
    rights?: Rights | null;
    usage?: Partial<PublicationRequest["usage"]>;
    published?: PublicationRequest["published"];
    rules?: readonly PublicationRuleFacts[];
}): PublicationRequest {
    const role = overrides.role ?? "coat";
    return {
        role,
        asset: {
            mediaKind: "image",
            technicalState: "ok",
            moderationState: "not_applicable",
            creationMethod: "unknown",
            ...overrides.asset,
        },
        rights: overrides.rights === undefined ? OWN_WORK_CLEARED : overrides.rights,
        usage: { role, suppressed: false, retired: false, override: "none", ...overrides.usage },
        published: overrides.published === undefined ? { mimeType: "image/webp" } : overrides.published,
        rules: overrides.rules ?? [],
    };
}

const rights = (basis: Rights["basis"], clearance: Rights["clearance"], licenseKey: string | null = null): Rights => ({
    basis,
    clearance,
    licenseKey,
    licenseRequiresAttribution:
        licenseKey === null ? null : licenseKey === "cc0-1.0" || licenseKey === "public-domain" ? false : true,
});

const rule = (
    overrides: Partial<PublicationRuleFacts> & Pick<PublicationRuleFacts, "rightsBasis" | "role">,
): PublicationRuleFacts => ({
    licenseKey: null,
    creationMethod: null,
    revoked: false,
    ...overrides,
});

const APPROVED = { override: "approved" } as const;

const allow = (reason: "automatic" | "rule" | "override_approved"): PublicationDecision => ({ allowed: true, reason });
const deny = (reason: (typeof DENY_REASONS)[number]): PublicationDecision => ({ allowed: false, reason });

describe("Veröffentlichungsentscheidung: automatisch", () => {
    const table: [string, PublicationRequest, PublicationDecision][] = [
        ["eigenes Werk, cleared", request({ rights: rights("own_work", "cleared") }), allow("automatic")],
        ["Public Domain, cleared", request({ rights: rights("public_domain", "cleared") }), allow("automatic")],
        [
            "Public Domain, legacy_asserted",
            request({ rights: rights("public_domain", "legacy_asserted") }),
            allow("automatic"),
        ],
        [
            "CC0, legacy_asserted",
            request({ rights: rights("license", "legacy_asserted", "cc0-1.0") }),
            allow("automatic"),
        ],
        [
            "CC0, cleared, als Kopfbild",
            request({ role: "header", rights: rights("license", "cleared", "cc0-1.0") }),
            allow("automatic"),
        ],
    ];
    it.each(table)("%s", (_name, input, expected) => {
        expect(decidePublication(input)).toEqual(expected);
    });
});

describe("Veröffentlichungsentscheidung: nie automatisch", () => {
    const table: [string, PublicationRequest, PublicationDecision][] = [
        [
            "CC BY 4.0 ohne Freigabe",
            request({ rights: rights("license", "unreviewed", "cc-by-4.0") }),
            deny("clearance_pending"),
        ],
        [
            "CC BY-SA 3.0 ohne Freigabe",
            request({ rights: rights("license", "unreviewed", "cc-by-sa-3.0") }),
            deny("clearance_pending"),
        ],
        [
            "CC BY ohne Version (Familie, kein Schlüssel)",
            request({
                rights: {
                    basis: "license",
                    clearance: "needs_review",
                    licenseKey: null,
                    licenseRequiresAttribution: null,
                },
            }),
            deny("clearance_pending"),
        ],
        [
            "permission ohne Freigabe",
            request({ rights: rights("permission", "unreviewed") }),
            deny("permission_needs_approval"),
        ],
        [
            "fan_policy ohne Freigabe",
            request({ rights: rights("fan_policy", "legacy_asserted") }),
            deny("fan_policy_needs_approval"),
        ],
        [
            "eigenes Werk, legacy_assumed",
            request({ rights: rights("own_work", "legacy_assumed") }),
            deny("legacy_assumed"),
        ],
        [
            "Public Domain, unreviewed",
            request({ rights: rights("public_domain", "unreviewed") }),
            deny("clearance_pending"),
        ],
        [
            "eigenes Werk, needs_review",
            request({ rights: rights("own_work", "needs_review") }),
            deny("clearance_pending"),
        ],
    ];
    it.each(table)("%s", (_name, input, expected) => {
        expect(decidePublication(input)).toEqual(expected);
    });
});

describe("Veröffentlichungsentscheidung: bewusste Einzelfreigabe", () => {
    const table: [string, PublicationRequest, PublicationDecision][] = [
        [
            "CC BY mit Freigabe",
            request({ rights: rights("license", "unreviewed", "cc-by-4.0"), usage: APPROVED }),
            allow("override_approved"),
        ],
        [
            "permission mit Freigabe",
            request({ rights: rights("permission", "unreviewed"), usage: APPROVED }),
            allow("override_approved"),
        ],
        [
            "fan_policy mit Freigabe",
            request({ rights: rights("fan_policy", "unreviewed"), usage: APPROVED }),
            allow("override_approved"),
        ],
        [
            "legacy_assumed mit Freigabe",
            request({ rights: rights("own_work", "legacy_assumed"), usage: APPROVED }),
            allow("override_approved"),
        ],
        [
            "needs_review mit Freigabe",
            request({ rights: rights("license", "needs_review"), usage: APPROVED }),
            allow("override_approved"),
        ],
        [
            "automatisch geht vor: eigenes Werk mit Freigabe bleibt automatisch",
            request({ rights: rights("own_work", "cleared"), usage: APPROVED }),
            allow("automatic"),
        ],
    ];
    it.each(table)("%s", (_name, input, expected) => {
        expect(decidePublication(input)).toEqual(expected);
    });

    it("🔴 eine Freigabe gilt nur für die Rolle ihrer Verwendung", () => {
        // Das Binding ist als Wappen freigegeben, gefragt wird nach dem Kopfbild.
        const forHeader = request({
            role: "header",
            rights: rights("license", "unreviewed", "cc-by-4.0"),
            usage: { role: "coat", override: "approved" },
        });
        expect(decidePublication(forHeader)).toEqual(deny("role_mismatch"));
        expect(
            decidePublication(
                request({ role: "coat", rights: rights("license", "unreviewed", "cc-by-4.0"), usage: APPROVED }),
            ),
        ).toEqual(allow("override_approved"));
    });
});

describe("Veröffentlichungsentscheidung: nie, auch nicht mit Freigabe oder Regel", () => {
    const everything = { usage: APPROVED, rules: [rule({ rightsBasis: "own_work", role: "coat" })] };
    const table: [string, PublicationRequest, PublicationDecision][] = [
        ["unknown", request({ rights: rights("unknown", "unreviewed"), ...everything }), deny("rights_unknown")],
        [
            "unknown, sogar cleared",
            request({ rights: rights("unknown", "cleared"), ...everything }),
            deny("rights_unknown"),
        ],
        ["keine Rechtezeile", request({ rights: null, ...everything }), deny("rights_missing")],
        [
            "Clearance rejected",
            request({ rights: rights("own_work", "rejected"), ...everything }),
            deny("clearance_rejected"),
        ],
        [
            "Clearance rejected, trotz Regel für die Basis",
            request({
                rights: rights("fan_policy", "rejected"),
                usage: APPROVED,
                rules: [rule({ rightsBasis: "fan_policy", role: "coat" })],
            }),
            deny("clearance_rejected"),
        ],
        ["unterdrückt", request({ usage: { suppressed: true, override: "approved" } }), deny("suppressed")],
        ["zurückgezogen", request({ usage: { retired: true, override: "approved" } }), deny("retired")],
        ["blocked", request({ usage: { override: "blocked" } }), deny("blocked")],
        [
            "technisch pending",
            request({ asset: { technicalState: "pending" }, ...everything }),
            deny("technical_state_not_ok"),
        ],
        [
            "Datei fehlt",
            request({ asset: { technicalState: "missing_file" }, ...everything }),
            deny("technical_state_not_ok"),
        ],
        [
            "nicht dekodierbar",
            request({ asset: { technicalState: "decode_failed" }, ...everything }),
            deny("technical_state_not_ok"),
        ],
        [
            "Format nicht unterstützt",
            request({ asset: { technicalState: "unsupported_format" }, ...everything }),
            deny("technical_state_not_ok"),
        ],
        [
            "moderiert abgelehnt",
            request({ asset: { moderationState: "rejected" }, ...everything }),
            deny("moderation_rejected"),
        ],
        [
            "Moderation offen",
            request({ asset: { moderationState: "pending" }, ...everything }),
            deny("moderation_pending"),
        ],
        [
            "keine veröffentlichte Repräsentation",
            request({ published: null, ...everything }),
            deny("no_published_representation"),
        ],
        ["SVG", request({ published: { mimeType: "image/svg+xml" }, ...everything }), deny("svg_not_public")],
        ["kein WebP", request({ published: { mimeType: "image/png" }, ...everything }), deny("not_webp")],
        ["3D-Modell", request({ asset: { mediaKind: "model_3d" }, ...everything }), deny("kind_not_public")],
    ];
    it.each(table)("%s", (_name, input, expected) => {
        expect(decidePublication(input)).toEqual(expected);
    });

    it("moderiert freigegebene Medien bleiben möglich", () => {
        expect(decidePublication(request({ asset: { moderationState: "approved" } }))).toEqual(allow("automatic"));
    });
});

describe("Veröffentlichungsentscheidung: Freigaberegel (G1, Option A)", () => {
    const fanCover = rule({ rightsBasis: "fan_policy", role: "literature_cover" });
    const fanCoat = rule({ rightsBasis: "fan_policy", role: "coat" });

    it("🔴 eine Regel schaltet fan_policy für ihre Rolle frei, nicht für eine andere", () => {
        const fanPolicy = rights("fan_policy", "legacy_asserted");
        // Die Regel gilt für literature_cover; das Wappen bleibt gesperrt.
        expect(decidePublication(request({ rights: fanPolicy, rules: [fanCover] }))).toEqual(
            deny("fan_policy_needs_approval"),
        );
        // Für die Rolle der Regel greift sie.
        expect(decidePublication(request({ rights: fanPolicy, rules: [fanCoat] }))).toEqual(allow("rule"));
        expect(decidePublication(request({ role: "header", rights: fanPolicy, rules: [fanCoat] }))).toEqual(
            deny("fan_policy_needs_approval"),
        );
    });

    it("🔴 die Regel gilt je Rechtsbasis: fan_policy öffnet weder permission noch CC BY", () => {
        expect(decidePublication(request({ rights: rights("permission", "unreviewed"), rules: [fanCoat] }))).toEqual(
            deny("permission_needs_approval"),
        );
        expect(
            decidePublication(request({ rights: rights("license", "unreviewed", "cc-by-4.0"), rules: [fanCoat] })),
        ).toEqual(deny("clearance_pending"));
    });

    it("🔴 eine widerrufene Regel wirkt nicht", () => {
        const revoked = { ...fanCoat, revoked: true };
        expect(
            decidePublication(request({ rights: rights("fan_policy", "legacy_asserted"), rules: [revoked] })),
        ).toEqual(deny("fan_policy_needs_approval"));
        // Neben einer gültigen Regel zählt die gültige.
        expect(
            decidePublication(request({ rights: rights("fan_policy", "legacy_asserted"), rules: [revoked, fanCoat] })),
        ).toEqual(allow("rule"));
    });

    it("🔴 blocked am Binding oder Galerieeintrag schlägt jede Regel (Einzelausnahme)", () => {
        expect(
            decidePublication(
                request({
                    rights: rights("fan_policy", "legacy_asserted"),
                    rules: [fanCoat],
                    usage: { override: "blocked" },
                }),
            ),
        ).toEqual(deny("blocked"));
    });

    it("🔴 eine Regel greift nie bei unknown oder rejected, auch wenn sie dieselbe Rolle trägt", () => {
        const all = (["public_domain", "license", "permission", "fan_policy", "own_work"] as const).map((rightsBasis) =>
            rule({ rightsBasis, role: "coat" }),
        );
        expect(decidePublication(request({ rights: rights("unknown", "cleared"), rules: all }))).toEqual(
            deny("rights_unknown"),
        );
        expect(decidePublication(request({ rights: rights("fan_policy", "rejected"), rules: all }))).toEqual(
            deny("clearance_rejected"),
        );
        expect(
            decidePublication(
                request({
                    asset: { moderationState: "rejected" },
                    rights: rights("fan_policy", "cleared"),
                    rules: all,
                }),
            ),
        ).toEqual(deny("moderation_rejected"));
    });

    it("eine Regel öffnet nie gegen Unterdrückung, Rückzug, fehlende Datei oder technischen Fehler", () => {
        const base = { rights: rights("fan_policy", "cleared"), rules: [fanCoat] };
        expect(decidePublication(request({ ...base, usage: { suppressed: true } }))).toEqual(deny("suppressed"));
        expect(decidePublication(request({ ...base, usage: { retired: true } }))).toEqual(deny("retired"));
        expect(decidePublication(request({ ...base, published: null }))).toEqual(deny("no_published_representation"));
        expect(decidePublication(request({ ...base, asset: { technicalState: "decode_failed" } }))).toEqual(
            deny("technical_state_not_ok"),
        );
    });

    it("eine Regel mit Lizenzschlüssel gilt nur für diesen Schlüssel, ohne Schlüssel für jede Lizenz der Basis", () => {
        const ccBy40 = rule({ rightsBasis: "license", licenseKey: "cc-by-4.0", role: "coat" });
        const anyLicense = rule({ rightsBasis: "license", role: "coat" });
        expect(
            decidePublication(request({ rights: rights("license", "unreviewed", "cc-by-4.0"), rules: [ccBy40] })),
        ).toEqual(allow("rule"));
        expect(
            decidePublication(request({ rights: rights("license", "unreviewed", "cc-by-sa-4.0"), rules: [ccBy40] })),
        ).toEqual(deny("clearance_pending"));
        expect(
            decidePublication(
                request({ rights: rights("license", "unreviewed", "cc-by-sa-4.0"), rules: [anyLicense] }),
            ),
        ).toEqual(allow("rule"));
        // CC BY ohne Version (kein Schlüssel) trägt nur eine Regel ohne Schlüssel.
        const family: Rights = {
            basis: "license",
            clearance: "needs_review",
            licenseKey: null,
            licenseRequiresAttribution: null,
        };
        expect(decidePublication(request({ rights: family, rules: [ccBy40] }))).toEqual(deny("clearance_pending"));
        expect(decidePublication(request({ rights: family, rules: [anyLicense] }))).toEqual(allow("rule"));
    });

    it("🔴 Ortsbilder: legacy_assumed + eigenes Werk + Kopfbild der Galerie, nur mit Regel öffentlich (media.yaml 01c3883e)", () => {
        // Der Galerieeintrag erbt die Rolle `header` von der Galeriebindung; legacy_assumed bleibt nur ein Prüfmarker.
        const ownHeader = rule({ rightsBasis: "own_work", role: "header" });
        const galleryItem = (usage: Partial<PublicationRequest["usage"]>, rules: readonly PublicationRuleFacts[]) =>
            request({ role: "header", rights: rights("own_work", "legacy_assumed"), usage, rules });

        // Mit Regel: öffentlich, und der Grundcode sagt, dass die Regel es war.
        expect(decidePublication(galleryItem({}, [ownHeader]))).toEqual(allow("rule"));
        // Ohne Regel: nicht.
        expect(decidePublication(galleryItem({}, []))).toEqual(deny("legacy_assumed"));
        // blocked am Galerieeintrag schlägt die Regel.
        expect(decidePublication(galleryItem({ override: "blocked" }, [ownHeader]))).toEqual(deny("blocked"));
        // Eine widerrufene Regel und eine Regel für eine andere Rolle öffnen nichts.
        expect(decidePublication(galleryItem({}, [{ ...ownHeader, revoked: true }]))).toEqual(deny("legacy_assumed"));
        expect(decidePublication(galleryItem({}, [rule({ rightsBasis: "own_work", role: "coat" })]))).toEqual(
            deny("legacy_assumed"),
        );
        // Zurückgezogener Eintrag (oder zurückgezogene Galeriebindung) und Unterdrückung des Kopfbilds bleiben dunkel.
        expect(decidePublication(galleryItem({ retired: true }, [ownHeader]))).toEqual(deny("retired"));
        expect(decidePublication(galleryItem({ suppressed: true }, [ownHeader]))).toEqual(deny("suppressed"));
    });

    it("🔴 KI-Regel (Betreiber 2026-10-10): eigene Bilder nicht automatisch, KI-generierte über die Regel", () => {
        // „eigene bilder sind nicht automatisch öffentlich, aber die die wir haben sind alle KI-generiert und alle KI-generierten sind
        // öffentlich“: die Regel nennt Rechtsgrundlage UND Entstehung (Migration 0092).
        const aiCoat = rule({ rightsBasis: "own_work", creationMethod: "ai_generated", role: "coat" });
        const ownWork = (
            creationMethod: PublicationRequest["asset"]["creationMethod"],
            clearance: Rights["clearance"] = "unreviewed",
            rules: readonly PublicationRuleFacts[] = [aiCoat],
        ): PublicationRequest => request({ asset: { creationMethod }, rights: rights("own_work", clearance), rules });

        // Ein neuer Upload „eigenes Werk“: KI-generiert öffentlich, sonst wartet er auf die Rechteprüfung.
        expect(decidePublication(ownWork("ai_generated"))).toEqual(allow("rule"));
        for (const method of ["unknown", "photo", "drawing", "scan", "derived"] as const) {
            expect(decidePublication(ownWork(method))).toEqual(deny("clearance_pending"));
        }
        // Die Klassenannahme aus Legacy: KI-generiert trotz legacy_assumed öffentlich, ein korrigiertes Foto nicht.
        expect(decidePublication(ownWork("ai_generated", "legacy_assumed"))).toEqual(allow("rule"));
        expect(decidePublication(ownWork("photo", "legacy_assumed"))).toEqual(deny("legacy_assumed"));
        // Nach der Rechteprüfung trägt das eigene Werk von selbst, ohne Regel.
        expect(decidePublication(ownWork("photo", "cleared", []))).toEqual(allow("automatic"));
        // 🔴 Betreiber 2026-10-11, Frage 3, „13: B!“: Legacys Angabe „eigenes Werk“ (legacy_asserted) trägt nicht mehr von selbst. Das
        // KI-Bild aus Legacy steht über die Regel; wird es als Foto umgetragen, wartet es auf die Rechteprüfung.
        expect(decidePublication(ownWork("ai_generated", "legacy_asserted"))).toEqual(allow("rule"));
        expect(decidePublication(ownWork("photo", "legacy_asserted"))).toEqual(deny("clearance_pending"));
        expect(decidePublication(ownWork("ai_generated", "legacy_asserted", []))).toEqual(deny("clearance_pending"));
        // Public Domain und CC0 mit Legacys Angabe bleiben automatisch (die Entscheidung gilt nur eigenen Werken).
        expect(decidePublication(request({ rights: rights("public_domain", "legacy_asserted") }))).toEqual(
            allow("automatic"),
        );
        // Die Regel trägt nur ihre Rechtsgrundlage: ein KI-Bild unter CC BY braucht die Freigabe eines Editors.
        expect(
            decidePublication(
                request({
                    asset: { creationMethod: "ai_generated" },
                    rights: rights("license", "unreviewed", "cc-by-4.0"),
                    rules: [aiCoat],
                }),
            ),
        ).toEqual(deny("clearance_pending"));
        // Einzelsperre, unbekannte und abgelehnte Rechte gewinnen; widerrufen oder andere Rolle trägt nicht.
        expect(
            decidePublication({
                ...ownWork("ai_generated"),
                usage: { ...ownWork("ai_generated").usage, override: "blocked" },
            }),
        ).toEqual(deny("blocked"));
        expect(decidePublication(ownWork("ai_generated", "rejected"))).toEqual(deny("clearance_rejected"));
        expect(
            decidePublication(
                request({
                    asset: { creationMethod: "ai_generated" },
                    rights: rights("unknown", "unreviewed"),
                    rules: [aiCoat],
                }),
            ),
        ).toEqual(deny("rights_unknown"));
        expect(decidePublication(ownWork("ai_generated", "unreviewed", [{ ...aiCoat, revoked: true }]))).toEqual(
            deny("clearance_pending"),
        );
        expect(
            decidePublication(
                request({
                    role: "header",
                    asset: { creationMethod: "ai_generated" },
                    rights: rights("own_work", "unreviewed"),
                    rules: [aiCoat],
                }),
            ),
        ).toEqual(deny("clearance_pending"));
        // Eine Regel ohne Entstehung gilt weiter für jede (die abgelöste Klassenregel, Rückweg auf das vorige Release).
        expect(
            decidePublication(ownWork("photo", "unreviewed", [rule({ rightsBasis: "own_work", role: "coat" })])),
        ).toEqual(allow("rule"));
    });
});

describe("Veröffentlichungsentscheidung: Einzelbild-Notaus (Code-Review 2026-10-16 S8-04)", () => {
    it("🔴 ein Notaus hält zurück, was sonst öffentlich wäre, auch mit Regel oder Einzelfreigabe", () => {
        expect(decidePublication(request({}))).toEqual(allow("automatic"));
        expect(decidePublication({ ...request({}), suspended: true })).toEqual(deny("publication_suspended"));
        expect(decidePublication({ ...request({}), suspended: false })).toEqual(allow("automatic"));
    });

    it("ein ohnehin gesperrtes Bild behält seinen eigentlichen Grund; der Notaus steht vor den Inhaltsschaltern", () => {
        const ohneRechte = { ...request({ rights: null }), suspended: true };
        expect(decidePublication(ohneRechte)).toEqual(deny("rights_missing"));
        const allesAus = { isOff: () => true };
        expect(decidePublication({ ...request({}), suspended: true, switches: allesAus })).toEqual(
            deny("publication_suspended"),
        );
    });
});

describe("Reisebilder (WI-0272): die Rolle photobox wird nur über eine Freigaberegel öffentlich", () => {
    // Die zwei stehenden Regeln aus WI-0272 §12 Nr. 1 und 2: je Rechtsgrundlage eine, die CC-Regel mit Lizenzschlüssel.
    const permissionRule = rule({ rightsBasis: "permission", role: "photobox" });
    const ccByRule = rule({ rightsBasis: "license", licenseKey: "cc-by-4.0", role: "photobox" });
    const permission = rights("permission", "cleared");
    const ccBy = rights("license", "cleared", "cc-by-4.0");
    /** Die Rechtelage so, wie die Freigabe sie aus der Lizenzwahl des Einreichers anlegt (`PHOTOBOX_RIGHTS`). */
    const grantedRights = (grant: (typeof PHOTOBOX_USAGE_GRANTS)[number], clearance: Rights["clearance"]): Rights => {
        const { basis, licenseKey } = PHOTOBOX_RIGHTS[grant];
        return rights(basis, clearance, licenseKey);
    };
    const photobox = (overrides: Omit<Parameters<typeof request>[0], "role"> = {}): PublicationRequest =>
        request({ ...overrides, role: "photobox", asset: { creationMethod: "photo", ...overrides.asset } });
    const otherRoles = MEDIA_ROLES.filter((role) => role !== "photobox");
    const judged = MEDIA_CLEARANCE_STATES.filter((state) => state !== "rejected");

    it("🔴 ohne Regel nie öffentlich: weder 'nur für Avesmaps' (permission) noch CC BY, bei keinem Prüfstand und keiner Entstehung", () => {
        for (const grant of PHOTOBOX_USAGE_GRANTS) {
            for (const clearance of judged) {
                const decision = decidePublication(photobox({ rights: grantedRights(grant, clearance) }));
                expect(decision.allowed, `${grant} / ${clearance}`).toBe(false);
            }
            for (const creationMethod of MEDIA_CREATION_METHODS) {
                const decision = decidePublication(
                    photobox({ rights: grantedRights(grant, "cleared"), asset: { creationMethod } }),
                );
                expect(decision.allowed, `${grant} / ${creationMethod}`).toBe(false);
            }
        }
        // Der Grund ist derselbe wie heute: permission wartet auf Freigabe, CC BY auf die Nennungspflicht.
        expect(decidePublication(photobox({ rights: permission }))).toEqual(deny("permission_needs_approval"));
        expect(decidePublication(photobox({ rights: ccBy }))).toEqual(deny("attribution_required"));
    });

    it("🔴 die Regel (permission, ohne Schlüssel, ohne Entstehung, photobox) macht 'nur für Avesmaps' öffentlich, für jede Entstehung", () => {
        expect(decidePublication(photobox({ rights: permission, rules: [permissionRule] }))).toEqual(allow("rule"));
        // Auch vor der freiwilligen Rechteprüfung („Rechte geprüft“ ändert die Sichtbarkeit nicht, WI-0272 §12 Nr. 1).
        for (const clearance of judged) {
            expect(
                decidePublication(photobox({ rights: rights("permission", clearance), rules: [permissionRule] })),
                clearance,
            ).toEqual(allow("rule"));
        }
        for (const creationMethod of Object.values(PHOTOBOX_CREATION_METHOD)) {
            expect(
                decidePublication(photobox({ rights: permission, asset: { creationMethod }, rules: [permissionRule] })),
                creationMethod,
            ).toEqual(allow("rule"));
        }
    });

    it("🔴 dieselbe Regel öffnet header und keine andere Rolle; die Regel einer anderen Rolle öffnet photobox nicht", () => {
        for (const role of otherRoles) {
            expect(
                decidePublication(
                    request({ role, rights: rights("permission", "unreviewed"), rules: [permissionRule] }),
                ),
                role,
            ).toEqual(deny("permission_needs_approval"));
            const foreign = rule({ rightsBasis: "permission", role });
            expect(decidePublication(photobox({ rights: permission, rules: [foreign] })), role).toEqual(
                deny("permission_needs_approval"),
            );
        }
        // Eine Freigabe an einer Verwendung in header deckt keine Verwendung in der Rolle photobox.
        expect(
            decidePublication(photobox({ rights: permission, usage: { role: "header", override: "approved" } })),
        ).toEqual(deny("role_mismatch"));
    });

    it("🔴 CC BY 4.0 wird mit der Regel (license, cc-by-4.0, photobox) öffentlich, trotz Nennungspflicht; ohne Regel hält attribution_required zurück", () => {
        expect(decidePublication(photobox({ rights: ccBy }))).toEqual(deny("attribution_required"));
        expect(decidePublication(photobox({ rights: ccBy, rules: [ccByRule] }))).toEqual(allow("rule"));
        // Die Regel trägt genau diese Lizenz: ein anderer Schlüssel bleibt gesperrt.
        expect(
            decidePublication(photobox({ rights: rights("license", "cleared", "cc-by-sa-4.0"), rules: [ccByRule] })),
        ).toEqual(deny("attribution_required"));
        // Je Rechtsgrundlage eine Regel: die eine öffnet die andere nicht.
        expect(decidePublication(photobox({ rights: ccBy, rules: [permissionRule] }))).toEqual(
            deny("attribution_required"),
        );
        expect(decidePublication(photobox({ rights: permission, rules: [ccByRule] }))).toEqual(
            deny("permission_needs_approval"),
        );
        // Beide stehenden Regeln zusammen öffnen beide Lizenzwahlen des Einreichers, auch vor der Rechteprüfung.
        for (const grant of PHOTOBOX_USAGE_GRANTS) {
            expect(
                decidePublication(
                    photobox({ rights: grantedRights(grant, "unreviewed"), rules: [permissionRule, ccByRule] }),
                ),
                grant,
            ).toEqual(allow("rule"));
        }
    });

    it("🔴 abgelehnt, unbekannt oder ohne Rechtezeile nie öffentlich, auch mit beiden Regeln", () => {
        const rules = [permissionRule, ccByRule];
        expect(decidePublication(photobox({ rights: rights("unknown", "unreviewed"), rules }))).toEqual(
            deny("rights_unknown"),
        );
        expect(decidePublication(photobox({ rights: rights("permission", "rejected"), rules }))).toEqual(
            deny("clearance_rejected"),
        );
        expect(decidePublication(photobox({ rights: rights("license", "rejected", "cc-by-4.0"), rules }))).toEqual(
            deny("clearance_rejected"),
        );
        expect(decidePublication(photobox({ rights: null, rules }))).toEqual(deny("rights_missing"));
        expect(
            decidePublication(photobox({ rights: permission, asset: { moderationState: "rejected" }, rules })),
        ).toEqual(deny("moderation_rejected"));
        expect(
            decidePublication(photobox({ rights: permission, asset: { moderationState: "pending" }, rules })),
        ).toEqual(deny("moderation_pending"));
    });

    it("🔴 die Regel öffnet nie gegen fehlende Datei, Unterdrückung, Rückzug, Sperre am Eintrag, Notaus oder technischen Fehler", () => {
        const base = { rights: permission, rules: [permissionRule] };
        expect(decidePublication(photobox({ ...base, published: null }))).toEqual(deny("no_published_representation"));
        expect(decidePublication(photobox({ ...base, published: { mimeType: "image/jpeg" } }))).toEqual(
            deny("not_webp"),
        );
        expect(decidePublication(photobox({ ...base, published: { mimeType: "image/svg+xml" } }))).toEqual(
            deny("svg_not_public"),
        );
        expect(decidePublication(photobox({ ...base, usage: { suppressed: true } }))).toEqual(deny("suppressed"));
        expect(decidePublication(photobox({ ...base, usage: { retired: true } }))).toEqual(deny("retired"));
        expect(decidePublication(photobox({ ...base, usage: { override: "blocked" } }))).toEqual(deny("blocked"));
        expect(decidePublication(photobox({ ...base, asset: { technicalState: "decode_failed" } }))).toEqual(
            deny("technical_state_not_ok"),
        );
        expect(decidePublication({ ...photobox(base), suspended: true })).toEqual(deny("publication_suspended"));
        // Eine widerrufene Regel wirkt nicht; neben einer gültigen zählt die gültige.
        const revoked = { ...permissionRule, revoked: true };
        expect(decidePublication(photobox({ rights: permission, rules: [revoked] }))).toEqual(
            deny("permission_needs_approval"),
        );
        expect(decidePublication(photobox({ rights: permission, rules: [revoked, permissionRule] }))).toEqual(
            allow("rule"),
        );
    });

    it("🔴 der Rollenschalter media.role.photobox hält jede Verwendung der Rolle zurück (switched_off), Fehlerrichtung closed", () => {
        const open = photobox({ rights: permission, rules: [permissionRule] });
        const off = (...keys: string[]) => ({ isOff: (key: string) => keys.includes(key) });
        expect(decidePublication({ ...open, switches: off() })).toEqual(allow("rule"));
        expect(decidePublication({ ...open, switches: off("media.role.photobox") })).toEqual(deny("switched_off"));
        // Auch die CC-Regel und die Einzelfreigabe stehen unter dem Schalter.
        expect(
            decidePublication({
                ...photobox({ rights: ccBy, rules: [ccByRule] }),
                switches: off("media.role.photobox"),
            }),
        ).toEqual(deny("switched_off"));
        expect(
            decidePublication({
                ...photobox({ rights: permission, usage: { override: "approved" } }),
                switches: off("media.role.photobox"),
            }),
        ).toEqual(deny("switched_off"));
        // Der Schalter einer anderen Rolle berührt photobox nicht, und der von photobox hält keine andere Rolle zurück.
        for (const role of otherRoles) {
            expect(decidePublication({ ...open, switches: off(`media.role.${role}`) }), role).toEqual(allow("rule"));
        }
        expect(decidePublication({ ...request({ role: "header" }), switches: off("media.role.photobox") })).toEqual(
            allow("automatic"),
        );
        // Der Schalter des Rechtsgrunds und der Lizenzfamilie wirkt wie bei jedem Bild.
        expect(decidePublication({ ...open, switches: off("media.rights.permission") })).toEqual(deny("switched_off"));
        const family = photobox({ rights: { ...ccBy, licenseFamily: "cc-by" }, rules: [ccByRule] });
        expect(decidePublication({ ...family, switches: off("media.license.cc-by") })).toEqual(deny("switched_off"));
        // Fehlerrichtung: Fällt die Auskunft über den Schalter aus, bleibt die Rolle zu.
        expect(contentSwitchSpec("media.role.photobox", { licenseFamilies: [], series: [] })?.failure).toBe("closed");
    });

    it("eine bewusste Einzelfreigabe ist nicht automatisch, gilt aber nie gegen unbekannte oder abgelehnte Rechte", () => {
        expect(decidePublication(photobox({ rights: permission, usage: { override: "approved" } }))).toEqual(
            allow("override_approved"),
        );
        expect(
            decidePublication(photobox({ rights: rights("unknown", "unreviewed"), usage: { override: "approved" } })),
        ).toEqual(deny("rights_unknown"));
        expect(
            decidePublication(photobox({ rights: rights("permission", "rejected"), usage: { override: "approved" } })),
        ).toEqual(deny("clearance_rejected"));
    });

    it("photobox steht in der Liste der Rollen, und keine Rolle öffnet sich allein mit der Erlaubnis des Einreichers", () => {
        const roles: readonly MediaRole[] = MEDIA_ROLES;
        expect(roles).toContain("photobox");
        for (const role of roles) {
            expect(decidePublication(request({ role, rights: rights("permission", "unreviewed") })).allowed, role).toBe(
                false,
            );
        }
    });
});

describe("Veröffentlichungsentscheidung: Grundcodes", () => {
    it("jeder Grundcode ist ein eigener Wert", () => {
        const all = [...ALLOW_REASONS, ...DENY_REASONS];
        expect(new Set(all).size).toBe(all.length);
        expect(ALLOW_REASONS).toEqual(["automatic", "rule", "override_approved"]);
    });
});

describe("Die Freigabe eines Editors (WI-0282, Betreiber 2026-11-06)", () => {
    const AUSNAHMEN: readonly MediaRole[] = ["photobox", "social_post"];
    const rollen = MEDIA_ROLES.filter((role) => !AUSNAHMEN.includes(role));
    const LAGEN: [string, Rights["basis"], string | null][] = [
        ["Public Domain", "public_domain", null],
        ["eigenes Werk", "own_work", null],
        ["Erlaubnis", "permission", null],
        ["Fan-Richtlinie", "fan_policy", null],
        ["CC0", "license", "cc0-1.0"],
        ["CC BY 4.0", "license", "cc-by-4.0"],
        ["CC BY-SA 3.0", "license", "cc-by-sa-3.0"],
    ];

    it("🔴 „Rechte geprüft“ macht jede bekannte Rechtslage öffentlich, in jeder Rolle, KI oder nicht", () => {
        for (const role of rollen) {
            for (const [name, basis, schluessel] of LAGEN) {
                for (const creationMethod of MEDIA_CREATION_METHODS) {
                    expect(
                        decidePublication(
                            request({ role, asset: { creationMethod }, rights: rights(basis, "cleared", schluessel) }),
                        ),
                        `${role} / ${name} / ${creationMethod}`,
                    ).toEqual(allow("automatic"));
                }
            }
        }
    });

    it("🔴 eine Lizenz mit Namensnennung bleibt ohne Freigabe zu, der Grund ist die offene Prüfung", () => {
        for (const role of rollen) {
            expect(
                decidePublication(request({ role, rights: rights("license", "unreviewed", "cc-by-4.0") })),
                role,
            ).toEqual(deny("clearance_pending"));
        }
    });

    it("🔴 unbekannt und abgelehnt nie; Sperre, Notaus und Inhaltsschalter schlagen die Freigabe", () => {
        const frei = rights("license", "cleared", "cc-by-4.0");
        expect(decidePublication(request({ rights: rights("unknown", "cleared") }))).toEqual(deny("rights_unknown"));
        expect(decidePublication(request({ rights: rights("license", "rejected", "cc-by-4.0") }))).toEqual(
            deny("clearance_rejected"),
        );
        expect(decidePublication(request({ rights: frei, usage: { override: "blocked" } }))).toEqual(deny("blocked"));
        expect(decidePublication({ ...request({ rights: frei }), suspended: true })).toEqual(
            deny("publication_suspended"),
        );
        expect(
            decidePublication({
                ...request({ rights: { ...frei, licenseFamily: "cc-by" } }),
                switches: { isOff: (key: string) => key === "media.license.cc-by" },
            }),
        ).toEqual(deny("switched_off"));
    });

    it("🔴 Ausnahmen: Reisebilder bleiben bei Moderation und Regel, der Social Hub bei seiner Weitergabe", () => {
        for (const role of AUSNAHMEN) {
            const usage = { role };
            expect(decidePublication(request({ role, usage, rights: rights("permission", "cleared") })), role).toEqual(
                deny("permission_needs_approval"),
            );
            expect(
                decidePublication(request({ role, usage, rights: rights("license", "cleared", "cc-by-4.0") })),
                role,
            ).toEqual(deny("attribution_required"));
        }
    });
});
