import { describe, expect, it } from "vitest";
import { editorViewer, visitorViewer, type ViewerCapability } from "../src/index.ts";

const CAPABILITIES: readonly ViewerCapability[] = [
    "view_editor_series",
    "view_flow_directions",
    "search_sea_route_names",
    "pin_selection",
    "use_editor_menu",
    "view_media_private",
    "edit_map_objects",
    "edit_map_geometry",
];

describe("editorViewer", () => {
    it("hat jede Capability", () => {
        const viewer = editorViewer("test");
        for (const capability of CAPABILITIES) {
            expect(viewer.can(capability), capability).toBe(true);
        }
    });

    it("traegt seine Quelle zur Fehlersuche", () => {
        expect(editorViewer("url-flag:besucher").source).toBe("url-flag:besucher");
    });
});

describe("visitorViewer", () => {
    it("hat keine Capability - `?besucher` nimmt nur weg, schaltet nie frei", () => {
        const viewer = visitorViewer("test");
        for (const capability of CAPABILITIES) {
            expect(viewer.can(capability), capability).toBe(false);
        }
    });
});
