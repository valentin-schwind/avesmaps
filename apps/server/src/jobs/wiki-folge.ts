import { WIKISYNC_BEREICHE, wikisyncAngeschlossen, type WikisyncBereich } from "@avesmaps3d/shared";
import type { Folge } from "../wiki/abgleich/folge.ts";
import { JobFailure } from "./handlers.ts";

/**
 * Die Folge einer Eingabe, streng geprüft: `{ bereiche }` mit mindestens einem Bereich, den die Übernahme anschließt (`WIKISYNC_ANGESCHLOSSEN`), ohne Wiederholung. Eine Art, die keinen Schreiber hat, hätte in der
 * Folge nichts zu suchen: Die Übernahme lehnte sie ab, und der Lauf sähe aus, als hinge er.
 */
export function leseFolge(wert: unknown): Folge | undefined {
    if (wert === undefined) return undefined;
    const bekannt = WIKISYNC_BEREICHE as readonly unknown[];
    const roh = (wert as { bereiche?: unknown } | null)?.bereiche;
    if (
        typeof wert !== "object" ||
        wert === null ||
        Object.keys(wert).some((schluessel) => schluessel !== "bereiche") ||
        !Array.isArray(roh) ||
        roh.length === 0 ||
        roh.some((bereich) => !bekannt.includes(bereich) || !wikisyncAngeschlossen(bereich as WikisyncBereich)) ||
        new Set(roh).size !== roh.length
    ) {
        throw new JobFailure(
            "input_invalid",
            'Wiki-Auftrag: "folge" ist keine Liste von Bereichen mit Übernahme',
            false,
        );
    }
    return { bereiche: WIKISYNC_BEREICHE.filter((bereich) => roh.includes(bereich)) };
}
