import { ABGLEICH_KATEGORIE_QUELLE, type LegacyZugKategorie } from "@avesmaps3d/shared";
import { abgleicheModes } from "../abgleiche/ausfuehrung.ts";

/**
 * Hatte diese Kategorie ihren Cutoff? (WI-0271 L8; AGENTS.md, „Legacy endet am Cutoff“: „Umgestellt wird wie heute über Claudio (Kategorienliste des Production-Zugs); einen eigenen Umschalter gibt es nicht.“) Die Liste
 * steht in `ABGLEICHE` der Umgebung (`docs/regeln/systemsteuerung-und-betrieb.md`, „Abgleiche“), und der Server liest sie ohnehin (`abgleiche/ausfuehrung.ts`).
 *
 * 🔴 **Nur in Production gesperrt:** Stage und lokal sind Testwelten (AGENTS.md, „Geltung je Umgebung“), die der tägliche Zug zurücksetzt; dort soll man es ausprobieren können.
 *
 * 🔴 **Fehlerrichtung gesperrt:** In Production gilt der Cutoff nur, wenn der Wert es ausdrücklich sagt: Die Kategorie fehlt in einer genannten Liste (`legacy:kategorien=wege+landschaften`, im Datenabgleich `noch_nicht`), oder
 * der Zug ist ganz aus (`legacy:aus`, nach allen drei Kategorien bleibt keine Liste übrig). Kein Wert und `legacy:kategorien` ohne Liste heißen: Der Zug zieht noch.
 */
export function vorDemCutoff(
    environment: string | undefined,
    umgebung: NodeJS.ProcessEnv,
    kategorie: LegacyZugKategorie,
): boolean {
    if (environment !== "production") return false;
    const wert = (umgebung["ABGLEICHE"] ?? "").trim();
    if (wert === "") return true;
    if (wert.split(",").some((teil) => teil.replace(/\s/gu, "") === "legacy:aus")) return false;
    return abgleicheModes(umgebung)[ABGLEICH_KATEGORIE_QUELLE[kategorie]] !== "noch_nicht";
}
