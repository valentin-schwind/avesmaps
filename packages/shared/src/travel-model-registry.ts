import { Value } from "@sinclair/typebox/value";
import { TravelModel } from "./travel-model.ts";
import aventuria from "../../../config/travel-model/aventuria.json" with { type: "json" };

function parseModel(candidate: unknown, fileName: string): TravelModel {
    if (!Value.Check(TravelModel, candidate)) {
        const [firstError] = [...Value.Errors(TravelModel, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid travel model in ${fileName} (${detail})`);
    }
    return candidate;
}

/** Das Reisemodell Aventuriens (WI-0017 R2). */
export const AVENTURIA_TRAVEL_MODEL: TravelModel = parseModel(aventuria, "travel-model/aventuria.json");
