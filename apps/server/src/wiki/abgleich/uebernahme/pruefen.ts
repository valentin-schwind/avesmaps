import type { WikisyncAblehnung, WikisyncBereich } from "@avesmaps3d/shared";
import type { Queryable } from "../../../database.ts";
import { laufIstGrundlage } from "../plan.ts";
import { wikisyncBereiche } from "../schalter-lesen.ts";
import { schreiberFuer } from "./liste.ts";
import { laufOhneKennungen, laufRechneteFuerLegacy, ladeVorschauLauf, type VorschauLauf } from "./protokoll.ts";
import type { Schreiber } from "./schreiber.ts";
import { kategorienFertig } from "./kategorien-stand.ts";

/**
 * Darf dieser Bereich jetzt übernommen werden (WI-0253 D-1)? Eine Stelle für die Route (die vor dem Einreihen 409 sagt) und den Auftrag (der es unter der Sperre
 * noch einmal prüft). Die Reihenfolge ist die der Fragen:
 *
 * 1. **Gehört der Bereich dem WikiSync?** Das tut jeder Bereich mit angeschlossener Übernahme, in jeder Umgebung (kein Schalter mehr); sonst fasst die Übernahme seine Felder nicht an (`gehoert_legacy`).
 * 2. **Hat die Vorschau seine Kategorien gelesen?** Die Vorschau, aus der übernommen würde, trägt den Pin einer Kategorien-Datei; sonst steht der Sync aus (`kategorien_fehlen`, WI-0294: `wiki/kategorien/`).
 * 3. **Gibt es einen Schreiber?** Sonst ist der Bereich noch nicht angeschlossen (`nicht_angeschlossen`).
 * 4. **Gibt es einen Lauf der Vorschau?** Der genannte oder der jüngste fertige, der den Bereich rechnete (`kein_lauf`).
 * 5. **Ist der Lauf eine Grundlage?** Ihn rechnete ein Stand des Plans, der den Bereich wie der heutige liest (`parser_version`, `laufIstGrundlage`), und er rechnete den Bereich nicht, als er noch dem Legacy-Zug gehörte
 *    (dann trägt keine Zeile das Wiki als Eigentümer), und er nennt die Objekte, die seine Zeilen zusammenfassen (`vorschau_veraltet`).
 */
export type Pruefung =
    { ok: true; lauf: VorschauLauf; schreiber: Schreiber } | { ok: false; grund: WikisyncAblehnung; text: string };

export async function pruefeUebernahme(db: Queryable, bereich: WikisyncBereich, laufId?: number): Promise<Pruefung> {
    if (!(await wikisyncBereiche(db)).has(bereich)) {
        return {
            ok: false,
            grund: "gehoert_legacy",
            text: "Für diesen Bereich gibt es noch keine Übernahme.",
        };
    }
    const kategorien = await kategorienFertig(db, bereich, laufId);
    if (!kategorien.fertig) return { ok: false, grund: "kategorien_fehlen", text: kategorien.text };
    const schreiber = schreiberFuer(bereich);
    if (schreiber === undefined) {
        return {
            ok: false,
            grund: "nicht_angeschlossen",
            text: "Für diesen Bereich gibt es noch keine Übernahme.",
        };
    }
    const lauf = await ladeVorschauLauf(db, bereich, laufId);
    if (lauf === undefined) {
        return { ok: false, grund: "kein_lauf", text: "Für diesen Bereich liegt keine fertige Vorschau vor." };
    }
    if (!laufIstGrundlage(bereich, lauf.parserVersion)) {
        return {
            ok: false,
            grund: "vorschau_veraltet",
            text: "Die Vorschau stammt von einem älteren Stand des Abgleichs. Bitte neu berechnen.",
        };
    }
    if (await laufRechneteFuerLegacy(db, lauf.id, bereich)) {
        return {
            ok: false,
            grund: "vorschau_veraltet",
            text: "Die Vorschau rechnete den Bereich, als er noch dem Legacy-Zug gehörte. Bitte neu berechnen.",
        };
    }
    if (await laufOhneKennungen(db, lauf.id, bereich)) {
        return {
            ok: false,
            grund: "vorschau_veraltet",
            text: "Die Vorschau nennt die Objekte ihrer Zeilen nicht. Bitte neu berechnen.",
        };
    }
    return { ok: true, lauf, schreiber };
}
