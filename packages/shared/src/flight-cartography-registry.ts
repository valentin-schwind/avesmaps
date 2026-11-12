import { Value } from "@sinclair/typebox/value";
import { FlightCartography } from "./flight-cartography.ts";
import aventuriaFlight from "../../../config/map-cartography/aventuria-flight.json" with { type: "json" };

function parseFlightCartography(candidate: unknown, fileName: string): FlightCartography {
    if (!Value.Check(FlightCartography, candidate)) {
        const [firstError] = [...Value.Errors(FlightCartography, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid flight cartography in ${fileName} (${detail})`);
    }
    const teile = candidate.zeichnung.lote.teileHoechstens;
    if ((teile & (teile - 1)) !== 0) {
        throw new Error(`invalid flight cartography in ${fileName} (lote.teileHoechstens must be a power of two)`);
    }
    return candidate;
}

export const AVENTURIA_FLIGHT_CARTOGRAPHY: FlightCartography = parseFlightCartography(
    aventuriaFlight,
    "aventuria-flight.json",
);
