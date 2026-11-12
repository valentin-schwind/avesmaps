import { Value } from "@sinclair/typebox/value";
import { ZoomBandModel } from "./zoom-bands.ts";
import aventuriaBands from "../../../config/zoom-bands/aventuria.json" with { type: "json" };

/** Loads the zoom band model from config/zoom-bands, validated once (chapter 4.17.5). */
function parseModel(candidate: unknown, fileName: string): ZoomBandModel {
    if (!Value.Check(ZoomBandModel, candidate)) {
        const [firstError] = [...Value.Errors(ZoomBandModel, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid zoom band model in ${fileName} (${detail})`);
    }
    return candidate;
}

export const AVENTURIA_ZOOM_BANDS: ZoomBandModel = parseModel(aventuriaBands, "aventuria.json");
