import type { MediaPlan } from "./media-plan.ts";
import { planCoat, readCoat } from "./territory-coat.ts";

/**
 * Sagen E4 (der Wappenzustand im Gebietsexport, `territory-coat.ts`) und E5 (die Medien des Manifests) dasselbe über ein Gebiet?
 * (WI-0063 MEDIA-M8, Vertrag `media.yaml` → `umsetzung_m8_m10`.) Der Gebietsimport rechnet den Zustand nur durch (`planCoat`), der
 * Medienimport schreibt ihn; beide sollen EINE Aussage je Gebiet lesen. Diese Prüfung vergleicht je Gebiet das Ergebnis von
 * `planCoat` mit dem Plan des Medienimports, über die Kennung des Gebiets (nie über den Schlüssel: `planCoat` baut ihn aus der
 * Herkunft der Datei, Legacys E5 aus dem Feld, das gewann, siehe `media.yaml` → `identitaet`).
 *
 *   suppression  E5 nennt eine Unterdrückung für das Gebiet.
 *   binding      E5 nennt ein Wappen mit derselben Herkunft der Bindung.
 *   none         E5 nennt kein Wappen; Ausnahme `undecided` mit Wiki-Wappen (`source staging`): Legacy zeigt es, wenn die Lizenz es
 *                durchlässt, und E5 nennt es dann mit Quelle `staging`: das ist erlaubt und kein Widerspruch.
 */

export interface CoatAgreement {
    compared: number;
    agreed: number;
    /** Je Widerspruch eine Zeile `Name oder Kennung: was E4 sagt, was E5 sagt`. */
    disagreements: string[];
}

export function compareTerritoryCoats(plan: MediaPlan, territoriesPayload: unknown): CoatAgreement {
    const result: CoatAgreement = { compared: 0, agreed: 0, disagreements: [] };
    const rows = (territoriesPayload as { territories?: unknown } | null)?.territories;
    if (!Array.isArray(rows)) return result;
    const suppressed = new Set(
        plan.suppressions.filter((entry) => entry.subjectKind === "territory").map((entry) => entry.subjectPublicId),
    );
    const bound = new Map(
        plan.bindings
            .filter((entry) => entry.subjectKind === "territory" && entry.role === "coat")
            .map((entry) => [entry.subjectPublicId, entry]),
    );
    for (const row of rows) {
        const record = row as Record<string, unknown>;
        const id = typeof record["public_id"] === "string" ? record["public_id"].toLowerCase() : "";
        const { coat } = readCoat(record["coat"]);
        if (coat === null || id === "") continue;
        result.compared += 1;
        const name = typeof record["name"] === "string" ? record["name"] : id;
        const outcome = planCoat(id, coat).outcome;
        const e5 = bound.get(id);
        let problem: string | null = null;
        if (outcome.kind === "suppression") {
            if (!suppressed.has(id)) problem = "E4: ausdrücklich kein Wappen, E5 nennt keine Unterdrückung";
        } else if (outcome.kind === "binding") {
            if (e5 === undefined) problem = "E4: Wappen gesetzt, E5 nennt keines";
            else if (e5.origin !== outcome.bindingOrigin)
                problem = `E4: Herkunft ${outcome.bindingOrigin}, E5: ${e5.origin}`;
        } else if (e5 !== undefined && !(outcome.reason === "undecided_wiki_candidate" && coat.isShown)) {
            problem = `E4: ${outcome.reason}, E5 nennt dennoch ein Wappen`;
        } else if (suppressed.has(id)) {
            problem = `E4: ${outcome.reason}, E5 nennt eine Unterdrückung`;
        }
        if (problem === null) result.agreed += 1;
        else result.disagreements.push(`${name} (${id}): ${problem}`);
    }
    return result;
}
