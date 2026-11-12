import { describe, expect, it } from "vitest";
import {
    CAPABILITIES,
    CAPABILITY_NAMES,
    GRANTABLE_CAPABILITIES,
    RESPONSIBILITY_MAX,
    ROLES,
    VIEWER_CAPABILITIES,
    assignableRoles,
    assuranceFor,
    capabilitiesFor,
    cleanResponsibility,
    invitationRequiresDiscordBinding,
    mayManage,
    roleRank,
    type Capability,
} from "../src/index.ts";

/** Der Rechtekatalog (AUTH-0001 §7, §11; Betreiber 2026-10-09, D2 B′ und D5). */
describe("Rollen und Capabilities", () => {
    it("jede höhere Rolle hat alles, was die niedrigere aus ihrer Vorlage hat", () => {
        for (let index = 1; index < ROLES.length; index += 1) {
            const lower = capabilitiesFor(ROLES[index - 1]!);
            const higher = capabilitiesFor(ROLES[index]!);
            for (const capability of lower)
                expect(higher.has(capability), `${ROLES[index]!} ⊇ ${capability}`).toBe(true);
        }
    });

    it("die Tabelle aus AUTH-0001 §7.2 in Stichproben", () => {
        expect(capabilitiesFor("tester").has("view_editor_series")).toBe(true);
        expect(capabilitiesFor("tester").has("use_editor_menu")).toBe(false);
        expect(capabilitiesFor("reviewer").has("moderate_submissions")).toBe(true);
        expect(capabilitiesFor("reviewer").has("edit_map_objects")).toBe(false);
        expect(capabilitiesFor("reviewer").has("review_media_rights")).toBe(false);
        expect(capabilitiesFor("editor").has("review_media_rights")).toBe(true);
        expect(capabilitiesFor("editor").has("manage_people")).toBe(false);
        expect(capabilitiesFor("admin").has("create_backup")).toBe(true);
        expect(capabilitiesFor("admin").has("assign_admin")).toBe(false);
        expect(capabilitiesFor("operator").has("grant_special_capabilities")).toBe(true);
    });

    it("🔴 der Einzelbild-Notaus ist eine eigene Capability mit Passkey; die Rechteprüfung bleibt ohne (WI-0119 F2)", () => {
        // Rollen wie AUTH-0001 §7.2: ab Editor, nicht zuteilbar; Stufe S heißt frischer Passkey vor der Handlung.
        expect(capabilitiesFor("reviewer").has("suspend_media_publication")).toBe(false);
        expect(capabilitiesFor("editor").has("suspend_media_publication")).toBe(true);
        expect(GRANTABLE_CAPABILITIES).not.toContain("suspend_media_publication");
        expect(assuranceFor("suspend_media_publication")).toBe("s");
        expect(assuranceFor("review_media_rights")).toBe("r");
    });

    it("🔴 die Medienverwaltung: privat lesen ab Reviewer (R), löschen und Freigaberegeln nur der Betreiber (S)", () => {
        // WI-0068, Betreiber 2026-10-09 zum Mockup-Blatt, Frage 1; AUTH-0001 §7.2.
        const holders = (capability: Capability) => ROLES.filter((role) => capabilitiesFor(role).has(capability));
        expect(holders("view_media_private")).toEqual(["reviewer", "editor", "admin", "operator"]);
        expect(assuranceFor("view_media_private")).toBe("r");
        for (const capability of ["delete_media", "manage_media_rules", "merge_media_all"] as const) {
            expect(holders(capability), capability).toEqual(["operator"]);
            expect(assuranceFor(capability), capability).toBe("s");
            // Kein Sonderrecht: auch zugeteilt bekommt ein Admin es nicht.
            expect(GRANTABLE_CAPABILITIES).not.toContain(capability);
            expect(capabilitiesFor("admin", [capability]).has(capability), capability).toBe(false);
        }
        // Die Lizenz eines Community-Uploads ändert nur der Betreiber (WI-0282), auch zugeteilt bekommt sie kein Admin.
        expect(holders("edit_community_license")).toEqual(["operator"]);
        expect(GRANTABLE_CAPABILITIES).not.toContain("edit_community_license");
        expect(capabilitiesFor("admin", ["edit_community_license"]).has("edit_community_license")).toBe(false);
        // Wer ein Medienrecht hat, darf auch die Medienverwaltung öffnen; sonst bekäme er eine Handlung ohne Ansicht.
        for (const capability of [
            "upload_media",
            "review_media_rights",
            "suspend_media_publication",
            "publish_media",
            "delete_media",
            "manage_media_rules",
            "merge_media_all",
        ] as const) {
            for (const role of holders(capability))
                expect(capabilitiesFor(role).has("view_media_private"), `${role}: ${capability}`).toBe(true);
        }
    });

    it("🔴 „Verantwortlich für:“ bei anderen setzt nur die Betreiber-Vorlage, Stufe V, kein Sonderrecht (WI-0133)", () => {
        const holders = ROLES.filter((role) => capabilitiesFor(role).has("set_responsibility"));
        expect(holders).toEqual(["operator"]);
        expect(assuranceFor("set_responsibility")).toBe("v");
        expect(GRANTABLE_CAPABILITIES).not.toContain("set_responsibility");
        expect(capabilitiesFor("admin", ["set_responsibility"]).has("set_responsibility")).toBe(false);
    });

    it("„Verantwortlich für:“: eine Zeile, höchstens 120 Zeichen, leer heißt null (WI-0133)", () => {
        expect(cleanResponsibility("  Entwicklung, Claudia, Claudio, Gemotze  ")).toEqual({
            ok: true,
            value: "Entwicklung, Claudia, Claudio, Gemotze",
        });
        expect(cleanResponsibility("")).toEqual({ ok: true, value: null });
        expect(cleanResponsibility(" \u00a0\u3000 ")).toEqual({ ok: true, value: null });
        expect(cleanResponsibility("Rand\u202e Text\u200b")).toEqual({ ok: true, value: "Rand Text" });
        expect(cleanResponsibility("Zeile eins\nZeile zwei")).toEqual({ ok: false, problem: "line" });
        expect(cleanResponsibility("a\u2028b")).toEqual({ ok: false, problem: "line" });
        expect(cleanResponsibility("a\tb")).toEqual({ ok: false, problem: "line" });
        expect(cleanResponsibility("a\u0085b")).toEqual({ ok: false, problem: "line" });
        expect(cleanResponsibility("x".repeat(RESPONSIBILITY_MAX))).toEqual({ ok: true, value: "x".repeat(120) });
        expect(cleanResponsibility("x".repeat(RESPONSIBILITY_MAX + 1))).toEqual({ ok: false, problem: "too_long" });
        // Gezählt wird je Zeichen (Codepunkt), wie `char_length` in der Tafel, nicht je UTF-16-Einheit.
        expect(cleanResponsibility("🐉".repeat(RESPONSIBILITY_MAX))).toMatchObject({ ok: true });
    });

    it("🔴 fremde Kanäle des Social Hubs verwalten (WI-0268 C12a): nur die Betreiber-Vorlage, Stufe S (frischer Passkey), kein Sonderrecht", () => {
        const holders = ROLES.filter((role) => capabilitiesFor(role).has("manage_social_channels"));
        expect(holders).toEqual(["operator"]);
        expect(assuranceFor("manage_social_channels")).toBe("s");
        expect(GRANTABLE_CAPABILITIES).not.toContain("manage_social_channels");
        expect(capabilitiesFor("admin", ["manage_social_channels"]).has("manage_social_channels")).toBe(false);
        // Freigeben und Senden bleibt bei `manage_news`: Wer es hat, darf die Kanäle noch nicht abschalten.
        expect(capabilitiesFor("admin", ["manage_news"]).has("manage_social_channels")).toBe(false);
    });

    it("🔴 Sonderrechte kommen nicht aus der Rolle Admin, nur zugeteilt, und nur ab Admin", () => {
        expect(GRANTABLE_CAPABILITIES).toEqual([
            "access_restricted_mode",
            "manage_system_settings",
            "request_restore",
            "manage_terrain_recipe",
            "manage_map_series",
            "manage_news",
            "release_to_production",
        ]);
        for (const capability of GRANTABLE_CAPABILITIES) {
            expect(capabilitiesFor("admin").has(capability)).toBe(false);
            expect(capabilitiesFor("admin", [capability]).has(capability)).toBe(true);
            expect(capabilitiesFor("editor", [capability]).has(capability)).toBe(false);
            expect(capabilitiesFor("operator").has(capability)).toBe(true);
        }
        // Das Umgebungsmenü (WI-0180, „Nur Betreiber“) ist bewusst KEIN Sonderrecht: Auch ein Admin mit Sonderrechten bekommt es nicht.
        expect(ROLES.filter((role) => capabilitiesFor(role).has("switch_environment"))).toEqual(["operator"]);
        expect(GRANTABLE_CAPABILITIES).not.toContain("switch_environment");
        expect(
            capabilitiesFor("admin", ["switch_environment", ...GRANTABLE_CAPABILITIES]).has("switch_environment"),
        ).toBe(false);
        expect(assuranceFor("switch_environment")).toBe("v");
        // Nur Sonderrechte sind zuteilbar; eine Leitungs-Capability lässt sich nicht unterschieben.
        expect(
            capabilitiesFor("admin", ["assign_admin", "grant_special_capabilities", "unbekannt"]).has("assign_admin"),
        ).toBe(false);
    });

    it("🔴 Sicherheitsstufen: Redaktion R, Verwaltung V, System S", () => {
        expect(assuranceFor("edit_map_objects")).toBe("r");
        expect(assuranceFor("manage_people")).toBe("v");
        expect(assuranceFor("assign_admin")).toBe("s");
        // Hineinkommen im eingeschränkten Betrieb ist V (E5 A, SYS-0001 W4); Umschalten und Wiederherstellen bleiben S.
        expect(assuranceFor("access_restricted_mode")).toBe("v");
        expect(assuranceFor("manage_system_settings")).toBe("s");
        expect(assuranceFor("request_restore")).toBe("s");
        for (const capability of GRANTABLE_CAPABILITIES) expect(assuranceFor(capability)).not.toBe("r");
        // Alles, was erst ab Admin kommt, verlangt mindestens Stufe V. Benannte Ausnahme: Form und Gebirge bleiben ohne Passkey (WI-0279, E11), das Sprachmodul ebenso (E17a).
        const OHNE_PASSKEY: readonly string[] = [
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
            "edit_languages",
        ];
        for (const name of CAPABILITY_NAMES) {
            if (roleRank(CAPABILITIES[name].minRole) >= roleRank("admin") && !OHNE_PASSKEY.includes(name))
                expect(assuranceFor(name), name).not.toBe("r");
        }
        for (const name of OHNE_PASSKEY) expect(assuranceFor(name as Capability), name).toBe("r");
    });

    // Betreiber 2026-11-04: „wichtig ist: betreiber dürfen alles“.
    it("🔴 Betreiber haben jedes Recht des Katalogs, ohne Einzelrecht und ohne Sonderrolle", () => {
        for (const name of CAPABILITY_NAMES) expect(capabilitiesFor("operator").has(name), name).toBe(true);
    });

    it("🔴 Schutzregeln: nur unterhalb der eigenen Stufe, Admins verwaltet nur der Betreiber", () => {
        expect(mayManage("admin", "editor")).toBe(true);
        expect(mayManage("admin", "admin")).toBe(false);
        expect(mayManage("admin", "operator")).toBe(false);
        expect(mayManage("editor", "tester")).toBe(false);
        expect(mayManage("operator", "admin")).toBe(true);
        expect(assignableRoles("admin")).toEqual(["tester", "reviewer", "editor"]);
        expect(assignableRoles("operator")).toEqual(ROLES);
        expect(assignableRoles("editor")).toEqual([]);
    });

    it("🔴 Einladungen für Admin und Betreiber sind immer an eine Discord-ID gebunden", () => {
        expect(invitationRequiresDiscordBinding("editor")).toBe(false);
        expect(invitationRequiresDiscordBinding("admin")).toBe(true);
        expect(invitationRequiresDiscordBinding("operator")).toBe(true);
    });

    it("die Fähigkeiten des Clients stehen im Katalog", () => {
        for (const capability of VIEWER_CAPABILITIES) expect(CAPABILITY_NAMES).toContain(capability);
    });
});
