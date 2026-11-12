import { Value } from "@sinclair/typebox/value";
import { PoliticalCartography } from "./political-cartography.ts";
import aventuriaPolitical from "../../../config/map-cartography/aventuria-political.json" with { type: "json" };

function parsePoliticalCartography(candidate: unknown, fileName: string): PoliticalCartography {
    if (!Value.Check(PoliticalCartography, candidate)) {
        const [firstError] = [...Value.Errors(PoliticalCartography, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid political cartography in ${fileName} (${detail})`);
    }
    return candidate;
}

export const AVENTURIA_POLITICAL_CARTOGRAPHY: PoliticalCartography = parsePoliticalCartography(
    aventuriaPolitical,
    "aventuria-political.json",
);
