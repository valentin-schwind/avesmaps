import { describe, expect, it } from "vitest";
import type { ViewerCapability } from "@avesmaps3d/shared";
import type { AuthSnapshot } from "../src/auth/session-state";
import { bootstrapViewer } from "../src/viewer/bootstrap-viewer";

/** Keine Antwort vom Server: seit WI-0203 die Besucheransicht, darüber das Anmeldefenster. */
const OHNE_ANTWORT: AuthSnapshot = {
    known: false,
    authEnabled: false,
    environment: null,
    person: null,
    capabilities: [],
};

/** Der Server antwortet, die Anmeldung ist nicht eingerichtet (lokal): die Ansicht wie vor WI-0120, Editor. */
const OHNE_ANMELDUNG: AuthSnapshot = { ...OHNE_ANTWORT, known: true };

const CAPABILITIES: readonly ViewerCapability[] = [
    "view_editor_series",
    "view_flow_directions",
    "search_sea_route_names",
];

describe("bootstrapViewer (im Editor-Modus)", () => {
    it("ist ohne '?besucher' ein Editor mit jeder Capability", () => {
        const viewer = bootstrapViewer("", OHNE_ANMELDUNG, "/edit");
        for (const capability of CAPABILITIES) {
            expect(viewer.can(capability), capability).toBe(true);
        }
    });

    it("nimmt mit '?besucher' jede Capability weg (Vorschau, keine Zugriffskontrolle)", () => {
        const viewer = bootstrapViewer("?besucher", OHNE_ANMELDUNG, "/edit");
        for (const capability of CAPABILITIES) {
            expect(viewer.can(capability), capability).toBe(false);
        }
    });

    it("liest auch '?besucher' mitten in weiteren Parametern", () => {
        expect(
            bootstrapViewer("?route=Gareth~Perricum&besucher&edit=1", OHNE_ANMELDUNG, "/").can("view_editor_series"),
        ).toBe(false);
    });

    it("ignoriert einen unbeteiligten Parameter, der nur so aehnlich heisst", () => {
        expect(bootstrapViewer("?besucherzahl=5", OHNE_ANMELDUNG, "/edit").can("view_editor_series")).toBe(true);
    });
});

describe("Die Werkzeuge nur im Editor-Modus (Betreiber 2026-10-09: „ja“)", () => {
    const admin: AuthSnapshot = {
        known: true,
        authEnabled: true,
        environment: "staging",
        person: { role: "admin" } as never,
        capabilities: [...CAPABILITIES, "use_editor_menu", "pin_selection"],
    };

    it("🔴 ohne Editor-Modus die öffentliche Karte: auch angemeldet und auch ohne eingerichtete Anmeldung", () => {
        for (const session of [admin, OHNE_ANMELDUNG, OHNE_ANTWORT]) {
            const viewer = bootstrapViewer("?route=Gareth~Perricum", session, "/");
            expect(viewer.source).toBe("oeffentliche-karte");
            for (const capability of [...CAPABILITIES, "use_editor_menu", "pin_selection"] as const) {
                expect(viewer.can(capability), capability).toBe(false);
            }
        }
    });

    it("🔴 `/edit`, `?editor=true` und Legacys `?edit=1` schalten die Werkzeuge der Sitzung ein", () => {
        expect(bootstrapViewer("", admin, "/edit").can("use_editor_menu")).toBe(true);
        expect(bootstrapViewer("?editor=true", admin, "/").can("use_editor_menu")).toBe(true);
        expect(bootstrapViewer("?edit=1", admin, "/").can("view_flow_directions")).toBe(true);
        expect(bootstrapViewer("?edit=1", OHNE_ANMELDUNG, "/").can("view_editor_series")).toBe(true);
    });
});

/**
 * 🔴 Betreiber 2026-10-16 zu Review-Frage 6 (Befund W2-06): „es soll das anmeldefenster kommen. wenn man sich angemeldet hat, kommt
 * der editormodus“. Bis WI-0203 fiel `/edit` ohne Antwort auf `editorViewer` zurück: alle Werkzeuge, die Serie `old` (nie für
 * Besucher) und keine Kopfleiste.
 */
describe("Ohne Antwort des Servers keine Werkzeuge (WI-0203)", () => {
    it("🔴 `/edit`, `?editor=true` und `?edit=1` zeigen ohne Antwort die Besucheransicht, ohne Serie old und Strömungspfeile", () => {
        for (const [search, pathname] of [
            ["", "/edit"],
            ["?editor=true", "/"],
            ["?edit=1", "/"],
        ] as const) {
            const viewer = bootstrapViewer(search, OHNE_ANTWORT, pathname);
            expect(viewer.source, `${pathname}${search}`).toBe("ohne-antwort:anmeldung");
            for (const capability of [
                ...CAPABILITIES,
                "use_editor_menu",
                "pin_selection",
                "view_media_private",
            ] as const) {
                expect(viewer.can(capability), capability).toBe(false);
            }
        }
    });

    it("die Gegenprobe: antwortet der Server ohne eingerichtete Anmeldung, bleibt es die Editor-Ansicht", () => {
        expect(bootstrapViewer("", OHNE_ANMELDUNG, "/edit").source).toBe("default:passwortgeschuetzte-instanz");
        expect(bootstrapViewer("", OHNE_ANMELDUNG, "/edit").can("use_editor_menu")).toBe(true);
    });
});

describe("Editor-Menü und Suche folgen der Sitzung (WI-0120 A11)", () => {
    const session = (role: string | null, capabilities: string[]) =>
        ({
            known: true,
            authEnabled: true,
            environment: "staging",
            person: role === null ? null : ({ role } as never),
            capabilities,
        }) as const;

    it("🔴 das Menü am Objekt nur mit `use_editor_menu`, die Seewegsuche nur mit `search_sea_route_names`", () => {
        const tester = bootstrapViewer("?edit=1", session("tester", ["view_editor_series", "search_sea_route_names"]));
        expect(tester.can("use_editor_menu")).toBe(false);
        expect(tester.can("search_sea_route_names")).toBe(true);
        const reviewer = bootstrapViewer("?edit=1", session("reviewer", ["use_editor_menu"]));
        expect(reviewer.can("use_editor_menu")).toBe(true);
        expect(reviewer.can("search_sea_route_names")).toBe(false);
        const besucher = bootstrapViewer("?edit=1", session(null, []));
        expect(besucher.can("use_editor_menu")).toBe(false);
    });

    it("🔴 die Medienverwaltung nur mit `view_media_private`, nur im Editor-Modus und nie mit `?besucher` (WI-0068 P3)", () => {
        const reviewer = session("reviewer", ["use_editor_menu", "view_media_private"]);
        expect(bootstrapViewer("?edit=1", reviewer).can("view_media_private")).toBe(true);
        expect(bootstrapViewer("", reviewer, "/").can("view_media_private")).toBe(false);
        expect(bootstrapViewer("?edit=1&besucher", reviewer).can("view_media_private")).toBe(false);
        const tester = bootstrapViewer("?edit=1", session("tester", ["view_editor_series"]));
        expect(tester.can("view_media_private")).toBe(false);
    });

    it("Rechte, die der Client nicht kennt, schalten nichts frei", () => {
        const admin = bootstrapViewer("?edit=1", session("admin", ["manage_people", "read_audit"]));
        expect(admin.can("use_editor_menu")).toBe(false);
    });
});
