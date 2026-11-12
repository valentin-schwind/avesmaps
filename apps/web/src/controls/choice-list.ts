import { subjectKey } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import type { LinkChoice } from "../info-panel/object-link";
import type { AreaChoices } from "../map/area-selection-input";
import type { PowerlineChoices } from "../map/powerline-selection-input";
import { artNebenName, unnamedCandidateLabel } from "../i18n/unnamed";
import { candidateTypeLabel } from "../route-planner/route-landscapes";

/**
 * Was die Auswahlliste (`area-choice-menu.vue`) zeichnet, schon in der Sprache der Seite. EINE Bauweise für jede Liste, in der
 * der Betrachter einen von mehreren Gegenständen wählt (WI-0063 P5): die Kraftlinien an einer Stelle (P8), die Flächen übereinander an einer Stelle des Klicks
 * (WI-0043 Stufe 2, „C“) und die Kandidaten eines mehrdeutigen Objektlinks (`?siedlung=Rathila`, 4.6) - Aussehen, Pfeiltasten,
 * Esc und „Klick daneben schließt“ stehen einmal.
 */
export interface ChoiceEntry {
    /** Eindeutig in der Liste: die Kennung der Fläche, bei einem Link der Schlüssel des Subjects. */
    id: string;
    name: string;
    /** Die Art in der Sprache der Seite; leer, wo es keine gibt. */
    type: string;
    /** Die Farbe des Punkts vor dem Namen (eine Sprache in ihrer Farbe der Karte, WI-0261 S5b); ohne sie steht der Punkt nur am gewählten Eintrag. */
    swatch?: string;
}

export interface ChoiceList {
    entries: ChoiceEntry[];
    /** Der markierte Eintrag, wenn einer gewählt ist. */
    selected?: string | undefined;
    /** Wo die Liste aufgeht, in Fensterkoordinaten. */
    screen: { x: number; y: number };
    title: string;
    /** Der Name der Liste für Vorleser. */
    label: string;
    testid: string;
    itemTestid: string;
}

/** Die Flächen an der Stelle eines Klicks, kleinste zuerst. */
export function areaChoiceList(choices: AreaChoices): ChoiceList {
    return {
        entries: choices.candidates.map((candidate) => {
            // 🔴 Ohne Namen der Satz der Art (WI-0105; seit OPS-073 nur die Art, „Wald“), und die Art steht dann nicht noch einmal
            // daneben - sonst stünde sie doppelt in derselben Zeile, einmal als Name und einmal als Art.
            const name = candidate.name ?? unnamedCandidateLabel(candidate);
            return { id: candidate.id, name, type: artNebenName(name, candidateTypeLabel(candidate)) };
        }),
        selected: choices.selected,
        screen: choices.screen,
        title: t("areaChoice.count", { n: choices.candidates.length }),
        label: t("areaChoice.label"),
        testid: "area-choices",
        itemTestid: "area-choice",
    };
}

/** Die Kraftlinien an der Stelle eines Klicks, die nächste zuerst (WI-0063 P8): Mehrere heißt Auswahl, nie still gewählt. */
export function powerlineChoiceList(choices: PowerlineChoices): ChoiceList {
    return {
        entries: choices.candidates.map((line) => ({ id: line.id, name: line.name, type: t("infoPanel.powerline") })),
        selected: choices.selected,
        screen: choices.screen,
        title: t("powerlineChoice.count", { n: choices.candidates.length }),
        label: t("powerlineChoice.label"),
        testid: "powerline-choices",
        itemTestid: "powerline-choice",
    };
}

/**
 * Die Sprachen an der Stelle eines Klicks (WI-0261 S5b; Bauvorlage `app.js` `karteKlick`: „An dieser Stelle: 2 Sprachen“, je Eintrag ein Punkt in der Farbe der
 * Sprache). Ein Mischgebiet heißt Auswahl, nie still gewählt; die gewählte Sprache steht markiert.
 */
export function sprachChoiceList(
    sprachen: readonly { id: string; name: string; farbe: string }[],
    screen: ChoiceList["screen"],
    selected?: string,
): ChoiceList {
    return {
        entries: sprachen.map((sprache) => ({
            id: sprache.id,
            name: sprache.name,
            type: t("sprache.art.sprache"),
            swatch: sprache.farbe,
        })),
        selected,
        screen,
        title: t("sprache.anStelle", { n: sprachen.length }),
        label: t("sprache.anStelle.label"),
        testid: "sprach-choices",
        itemTestid: "sprach-choice",
    };
}

/** Die Kandidaten eines mehrdeutigen Objektlinks: Mehrdeutig heißt Auswahl, nie still gewählt. */
export function linkChoiceList(entries: readonly LinkChoice[], screen: ChoiceList["screen"]): ChoiceList {
    return {
        entries: entries.map((entry) => ({ id: subjectKey(entry.ref), name: entry.name, type: entry.type })),
        screen,
        title: t("objectLink.choose", { n: entries.length }),
        label: t("objectLink.label"),
        testid: "link-choices",
        itemTestid: "link-choice",
    };
}
