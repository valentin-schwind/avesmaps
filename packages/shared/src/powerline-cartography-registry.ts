import { Value } from "@sinclair/typebox/value";
import { PowerlineCartography } from "./powerline-cartography.ts";
import aventuriaPowerlines from "../../../config/map-cartography/aventuria-powerlines.json" with { type: "json" };

function parsePowerlineCartography(candidate: unknown, fileName: string): PowerlineCartography {
    if (!Value.Check(PowerlineCartography, candidate)) {
        const [firstError] = [...Value.Errors(PowerlineCartography, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid powerline cartography in ${fileName} (${detail})`);
    }
    // Was das Schema nicht ausdrücken kann: Jeder Faden zeichnet das ganze Netz noch einmal, deshalb höchstens acht je
    // Linie; und ein Bereich läuft aufwärts.
    const { straenge, faeden } = candidate;
    if (!Number.isInteger(Math.log2(straenge.verfeinerung))) {
        throw new Error(`invalid powerline cartography in ${fileName} (/straenge/verfeinerung: keine Zweierpotenz)`);
    }
    if (straenge.anzahl + faeden.anzahl > 8) {
        throw new Error(`invalid powerline cartography in ${fileName} (straenge + faeden > 8)`);
    }
    for (const [name, [von, bis]] of Object.entries({
        breite: faeden.breite,
        leuchtkraft: faeden.leuchtkraft,
        ausschlag: faeden.ausschlag,
        versatz: faeden.versatz,
    })) {
        if (von > bis) {
            throw new Error(`invalid powerline cartography in ${fileName} (/faeden/${name}: von > bis)`);
        }
    }
    return candidate;
}

export const AVENTURIA_POWERLINE_CARTOGRAPHY: PowerlineCartography = parsePowerlineCartography(
    aventuriaPowerlines,
    "aventuria-powerlines.json",
);
