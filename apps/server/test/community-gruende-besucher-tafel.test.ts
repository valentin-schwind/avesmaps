import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRUENDE_BESUCHER } from "../src/community/gruende-besucher.ts";
import { grundZumSatz } from "../src/community/gruende.ts";

/**
 * Die Mustertafel der Besucherfenster gegen die Sätze der Migrationen, ohne Datenbank (WI-0291): Ein Satz, der in der Datenbank umformuliert wird, ohne dass die Tafel nachzieht, ließe das Fenster
 * wieder bei einem Sammelsatz landen. Deshalb liest dieser Test alle `_fehler('KC…', 'community_…: Satz')` aus den Migrationen.
 */

const MIGRATIONEN = join(import.meta.dirname, "..", "migrations");

/** Alle Sätze (ohne den Präfix `community_…:`), die eine Migration als Fehler wirft. Sätze mit `format(…)` haben keinen festen Wortlaut und fehlen hier. */
function saetzeDerMigrationen(): Set<string> {
    const saetze = new Set<string>();
    for (const datei of readdirSync(MIGRATIONEN).filter((name) => name.endsWith(".sql"))) {
        const sql = readFileSync(join(MIGRATIONEN, datei), "utf8");
        for (const treffer of sql.matchAll(/_fehler\(\s*'KC\d+'\s*,\s*'community_[a-z_]+:\s*([^']+)'\s*\)/gu)) {
            saetze.add(treffer[1]!.trim());
        }
    }
    return saetze;
}

/** Die Sätze, die ein Besucherfenster erreicht, mit dem Code, den das Fenster bekommen muss. Stand: die letzte Migration je Funktion (siehe `gruende-besucher.ts`). */
const BESUCHER_SAETZE: readonly (readonly [string, string])[] = [
    ["die Beschreibung braucht 10 bis 2000 Zeichen", "beschreibung_laenge"],
    ["die Nachricht braucht 10 bis 2000 Zeichen", "nachricht_laenge"],
    ["Schlüssel und Bezug sind Pflicht", "schluessel_bezug_fehlt"],
    ["der Schlüssel ist Pflicht", "schluessel_fehlt"],
    ["unbekannte Kategorie", "kategorie_unbekannt"],
    ["der Name darf höchstens 80 Zeichen lang sein", "name_zu_lang"],
    ["die Adresse stimmt nicht", "adresse_falsch"],
    ["die Meldung ist zurückgezogen", "meldung_zurueckgezogen"],
    ["der Vorgang ist schon abgeschlossen", "vorgang_abgeschlossen"],
    ["kein Vorgang zu diesem Schlüssel", "vorgang_unbekannt"],
    ["die Wertung braucht 1 bis 5 Sterne", "sterne"],
    ["der Text darf höchstens 200 Zeichen haben", "text_zu_lang"],
    ["der Name darf höchstens 80 Zeichen haben", "name_zu_lang"],
    ["das Datum darf höchstens 60 Zeichen haben", "datum_zu_lang"],
    ["diesen Ort gibt es nicht", "ort_unbekannt"],
    ["diese Bewertung gibt es nicht", "bewertung_unbekannt"],
    ["Gefällt mir zählt um eins hoch oder runter", "gefaellt_schritt"],
    ["bitte einen Grund wählen", "grund_fehlt"],
    ["die Beschreibung darf höchstens 2000 Zeichen haben", "beschreibung_zu_lang"],
];

describe("Mustertafel der Besucherfenster (ohne Datenbank)", () => {
    const saetze = saetzeDerMigrationen();

    it("die Migrationen liefern die Sätze (der Test liest sie wirklich)", () => {
        expect(saetze.size).toBeGreaterThan(30);
    });

    it("🔴 jedes Muster trifft genau einen Satz aus den Migrationen", () => {
        for (const { muster, reason } of GRUENDE_BESUCHER) {
            const treffer = [...saetze].filter((satz) => muster.test(satz));
            expect(treffer, `${reason}: ${String(muster)}`).toHaveLength(1);
        }
    });

    it.each(BESUCHER_SAETZE)("der Satz „%s“ steht in einer Migration und führt zu %s", (satz, reason) => {
        expect(saetze.has(satz), `Der Satz steht in keiner Migration mehr: ${satz}`).toBe(true);
        expect(grundZumSatz(satz)).toBe(reason);
    });

    it("jeder Code ist snake_case und jedes Muster ist verankert (kein Teilwort-Treffer)", () => {
        for (const { muster, reason } of GRUENDE_BESUCHER) {
            expect(reason).toMatch(/^[a-z]+(_[a-z]+)*$/u);
            expect(muster.source.startsWith("^") && muster.source.endsWith("$"), reason).toBe(true);
        }
    });

    it("ein Satz ohne Muster bleibt ohne Code (das Fenster zeigt dann den Satz des Servers)", () => {
        expect(grundZumSatz("irgendein neuer Satz")).toBeUndefined();
    });
});
