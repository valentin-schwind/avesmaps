import { describe, expect, it } from "vitest";
import {
    CAPABILITIES,
    SONDERROLLEN,
    SONDERROLLEN_NAMEN,
    capabilitiesFor,
    formtGelaende,
    landmarkenArtVorschlag,
    rechteVon,
    sonderrolleSpec,
    type Capability,
} from "../src/index.ts";

/**
 * Der Katalog der Sonderrollen (WI-0279, Meteorologe WI-0288, Linguist 2026-11-08): zwölf Rollen als Bündel aus dem einen Rechtekatalog. Problemfälle: Ein Bündel trägt ein Recht, das
 * die Verwaltung öffnet; eine Sonderrolle nimmt etwas weg; eine unbekannte Rolle gibt Rechte; ein Tester bekommt ein Einzelrecht durch die
 * Hintertür.
 */

/** Was keine Sonderrolle je tragen darf: Verwaltung, Betrieb und die Rechte, die allein bei den Betreibern bleiben (Bauplan WI-0279). */
const NIE_IN_EINEM_BUENDEL: readonly Capability[] = [
    "view_operations",
    "manage_system_settings",
    "manage_people",
    "assign_roles",
    "assign_admin",
    "grant_special_capabilities",
    "manage_passkeys",
    "release_to_production",
    "switch_environment",
    "manage_media_rules",
    "edit_community_license",
    "manage_social_channels",
    "manage_news",
    "moderate_community",
    "use_operator_channel",
    "access_restricted_mode",
];

describe("Sonderrollen", () => {
    it("🔴 zwölf Rollen in der Reihenfolge des Auftrags, danach Meteorologe (WI-0288) und Linguist", () => {
        expect(SONDERROLLEN_NAMEN).toEqual([
            "derograph",
            "politologe",
            "ortskundiger",
            "regionalkanzler",
            "social_media_manager",
            "diplomat",
            "kurator",
            "odologe",
            "topograph",
            "kartograph",
            "meteorologe",
            "linguist",
        ]);
    });

    it("🔴 WI-0288: das Wettermodell nur aus der Betreiber-Vorlage und über den Meteorologen; Presets und Icons ab Editor", () => {
        expect(capabilitiesFor("admin").has("manage_weather_model")).toBe(false);
        expect(capabilitiesFor("operator").has("manage_weather_model")).toBe(true);
        expect(capabilitiesFor("reviewer").has("edit_weather")).toBe(false);
        expect(capabilitiesFor("editor").has("edit_weather")).toBe(true);
        const meteorologe = rechteVon({ role: "tester", sonderrollen: ["meteorologe"] });
        expect(meteorologe.has("manage_weather_model")).toBe(true);
        expect(meteorologe.has("edit_weather")).toBe(true);
        expect(meteorologe.has("manage_routing")).toBe(false);
        expect(meteorologe.has("view_operations")).toBe(false);
    });

    it("🔴 Linguist: das Sprachmodul schreiben, sonst nichts dazu; aus der Vorlage erst ab Admin (E17a)", () => {
        expect(capabilitiesFor("reviewer").has("edit_languages")).toBe(false);
        expect(capabilitiesFor("editor").has("edit_languages")).toBe(false);
        expect(capabilitiesFor("admin").has("edit_languages")).toBe(true);
        expect(rechteVon({ role: "editor", sonderrollen: ["linguist"] }).has("edit_languages")).toBe(true);
        const linguist = rechteVon({ role: "tester", sonderrollen: ["linguist"] });
        const tester = capabilitiesFor("tester");
        const dazu = [...linguist].filter((recht) => !tester.has(recht));
        expect(dazu.sort()).toEqual(["edit_languages", "use_editor_menu"]);
        // Das Sammelrecht der Inhalte bleibt draußen: Quellen, Literatur, Vorkommen und Korpora schreibt der Linguist nicht.
        expect(linguist.has("manage_sources")).toBe(false);
        expect(linguist.has("edit_map_objects")).toBe(false);
        expect(linguist.has("edit_landscapes")).toBe(false);
    });

    it("🔴 kein Bündel trägt ein Recht der Verbotsliste, und jedes Recht steht im Katalog", () => {
        for (const name of SONDERROLLEN_NAMEN) {
            for (const recht of sonderrolleSpec(name).rechte) {
                expect(NIE_IN_EINEM_BUENDEL, `${name}: ${recht}`).not.toContain(recht);
                expect(Object.hasOwn(CAPABILITIES, recht), `${name}: ${recht}`).toBe(true);
            }
        }
    });

    it("🔴 nur Ortskundiger und Regionalkanzler sind regional, und nur der Kanzler ist einer je Region", () => {
        const regional = SONDERROLLEN_NAMEN.filter((name) => sonderrolleSpec(name).regional === true);
        const einer = SONDERROLLEN_NAMEN.filter((name) => sonderrolleSpec(name).einePersonJeRegion === true);
        expect(regional).toEqual(["ortskundiger", "regionalkanzler"]);
        expect(einer).toEqual(["regionalkanzler"]);
        expect(SONDERROLLEN.ortskundiger.rechte).toEqual([]);
        expect(SONDERROLLEN.regionalkanzler.rechte).toEqual([]);
    });

    it("🔴 eine Sonderrolle kommt zur Grundrolle hinzu und nimmt nie etwas weg", () => {
        const editor = capabilitiesFor("editor");
        const mitRolle = rechteVon({ role: "editor", sonderrollen: ["kurator"] });
        for (const recht of editor) expect(mitRolle.has(recht), recht).toBe(true);
        expect(mitRolle.has("delete_media")).toBe(true);
        expect(editor.has("delete_media")).toBe(false);
    });

    it("🔴 sie gilt auch für Tester, anders als ein Einzelrecht", () => {
        expect(rechteVon({ role: "tester" }).has("read_mailbox")).toBe(false);
        expect(rechteVon({ role: "tester", sonderrollen: ["diplomat"] }).has("read_mailbox")).toBe(true);
        expect(rechteVon({ role: "tester", grants: ["manage_map_series"] }).has("manage_map_series")).toBe(false);
    });

    it("🔴 Paket 6: die Kartenrechte stehen in den drei Bündeln und sonst erst ab Admin", () => {
        expect(sonderrolleSpec("politologe").rechte).toEqual(
            expect.arrayContaining(["edit_territories", "edit_territory_form"]),
        );
        expect(sonderrolleSpec("derograph").rechte).not.toContain("edit_mountains");
        expect(sonderrolleSpec("topograph").rechte).toEqual(
            expect.arrayContaining(["edit_landscape_form", "edit_mountains"]),
        );
        for (const recht of ["edit_territory_form", "edit_landscape_form", "edit_mountains"] as const) {
            expect(capabilitiesFor("reviewer").has(recht), recht).toBe(false);
            expect(capabilitiesFor("editor").has(recht), recht).toBe(false);
            expect(capabilitiesFor("admin").has(recht), recht).toBe(true);
            expect(capabilitiesFor("operator").has(recht), recht).toBe(true);
        }
    });

    it("🔴 Paket 6: Die Umwandlung eines Orts ergibt nie Berggipfel oder Vulkan, darum bleibt sie bei jedem Editor (E2a, E12)", () => {
        for (const [name, ortsart] of [
            ["Feuerberg", "Vulkan"],
            ["Vulkan von Tuzak", "Berggipfel"],
            ["Berggipfel", "berg"],
            ["Grotte Keranvor", "Höhle"],
            ["Irgendwas", null],
        ] as const) {
            expect(formtGelaende(landmarkenArtVorschlag(name, ortsart)), name).toBe(false);
        }
    });

    it("eine unbekannte Sonderrolle gibt nichts", () => {
        expect(rechteVon({ role: "tester", sonderrollen: ["erzmagier", "constructor"] })).toEqual(
            capabilitiesFor("tester"),
        );
    });

    it("ohne Sonderrollen ist das Ergebnis das der Rolle samt Einzelrechten", () => {
        expect(rechteVon({ role: "admin", grants: ["manage_news"] })).toEqual(
            capabilitiesFor("admin", ["manage_news"]),
        );
    });
});
