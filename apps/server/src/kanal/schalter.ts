import { KANAL_SCHALTER, type Capability, type KanalSchalter } from "@avesmaps3d/shared";

/**
 * Der Schalter des Betreiber-Kanals (`KANAL`, WI-0124; Betreiber 2026-10-13, wörtlich: „dann deaktiviert noch "Claudia und Claudio" für
 * production“). Eine eigene Datei, weil ihn zwei Seiten lesen, die sich sonst im Kreis importieren würden: `config.ts` für die Routen und
 * `auth/config.ts` für die Rechte.
 *
 * 🔴 Der Schalter ist eine Eigenschaft der **Umgebung**, keine der Person. Er nimmt niemandem ein Recht; er sagt, dass es hier nichts gibt.
 * Deshalb fällt bei `aus` die Capability `use_operator_channel` aus jeder Sitzung — Eintrag in der Systemsteuerung und Kanal-Teil der
 * Glocke verschwinden damit von selbst, ohne dass eine Oberfläche den Schalter kennen muss.
 */

/** Die Capability, die der Schalter trägt. Eine Zeile, damit niemand sie an zwei Stellen sucht. */
export const KANAL_CAPABILITY: Capability = "use_operator_channel";

/**
 * Liest `KANAL`. Ohne Wert `an`: Vergisst eine Umgebung den Wert, bleibt der Kanal, wie er war — abschalten ist die Ausnahme und wird
 * ausdrücklich gesetzt. Ein anderer Wert hält den Start an wie ein ungültiger `PORT`, damit ein Tippfehler nicht still als „an“ durchgeht.
 */
export function kanalSchalter(environment: NodeJS.ProcessEnv): KanalSchalter {
    const value = environment["KANAL"];
    if (value === undefined || value === "") return "an";
    if ((KANAL_SCHALTER as readonly string[]).includes(value)) return value as KanalSchalter;
    throw new Error(`KANAL must be "an" or "aus": ${value}`);
}

/**
 * Die Rechte dieser Umgebung: der Rechtekatalog, abzüglich dessen, was es hier nicht gibt. Heute genau ein Fall; weitere Schalter
 * gehören hierher und nicht in den Katalog, denn der Katalog sagt, was eine Rolle darf, nicht, was eine Umgebung hat.
 */
export function rechteHier(roh: ReadonlySet<Capability>, kanal: KanalSchalter | undefined): ReadonlySet<Capability> {
    if (kanal !== "aus" || !roh.has(KANAL_CAPABILITY)) return roh;
    const ohne = new Set(roh);
    ohne.delete(KANAL_CAPABILITY);
    return ohne;
}
