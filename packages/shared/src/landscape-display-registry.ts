import { Value } from "@sinclair/typebox/value";
import { LandscapeDisplayDefaults } from "./landscape-display.ts";
import aventuriaDefaults from "../../../config/landscape-display/aventuria.json" with { type: "json" };

/** Laedt die Vorgaben der Darstellungstafel aus config/landscape-display, einmal validiert (WI-0064). */
function parseDefaults(candidate: unknown, fileName: string): LandscapeDisplayDefaults {
    if (!Value.Check(LandscapeDisplayDefaults, candidate)) {
        const [firstError] = [...Value.Errors(LandscapeDisplayDefaults, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid landscape display defaults in ${fileName} (${detail})`);
    }
    return candidate;
}

export const AVENTURIA_LANDSCAPE_DISPLAY_DEFAULTS: LandscapeDisplayDefaults = parseDefaults(
    aventuriaDefaults,
    "aventuria.json",
);
