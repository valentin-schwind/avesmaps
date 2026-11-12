import { describe, expect, it } from "vitest";
import type { DiscordFakten, ReleaseVerlauf } from "@avesmaps3d/shared";
import { rechneFakten } from "../src/discord/fakten.ts";
import { sammleMeldungen, type BerichtsVorgang } from "../src/discord/meldungen.ts";
import { berichtSatz, hintergrund, sichererSatz } from "../src/discord/muster.ts";
import { sammleNeuerungen, sammlePunkte } from "../src/discord/punkte.ts";
import { echteUmlaute } from "../src/discord/umlaute.ts";
import { baueBericht } from "../src/discord/vorlage.ts";

/**
 * Echte Umlaute im Bericht (WI-0255; Vali 2026-11-02, Befund aus der Vorschau): Die Quelltexte schreiben „Flaechen“, „oeffnet“, „gewaehlte“, „Flusshoehen“; im Bericht
 * stehen ä, ö, ü. Die Regel ist vorsichtig: Wörter wie „Israel“, „Michael“, „neue“, „Feuer“, „Bauer“ bleiben, wie sie sind.
 */

const sha = (n: number): string => n.toString(16).padStart(7, "a").padEnd(40, "0");

describe("Discord-Bericht: echte Umlaute (vorsichtig)", () => {
    it("🔴 wandelt die Umschrift von ä, ö und ü, auch am Wortanfang und in Zusammensetzungen", () => {
        const wandelt: [string, string][] = [
            ["Flaechen", "Flächen"],
            ["oeffnet", "öffnet"],
            ["gewaehlte", "gewählte"],
            ["Flusshoehen", "Flusshöhen"],
            ["Gebaeude", "Gebäude"],
            ["Aenderung", "Änderung"],
            ["Uebersicht", "Übersicht"],
            ["ueber", "über"],
            ["fuer", "für"],
            ["zurueck", "zurück"],
            ["Loeschen", "Löschen"],
            ["Koenig", "König"],
            ["Moeglichkeit", "Möglichkeit"],
            ["Haeuser", "Häuser"],
            ["Raeume", "Räume"],
            ["Staedte", "Städte"],
            ["Tuerme", "Türme"],
            ["Buecher", "Bücher"],
            ["Pruefung", "Prüfung"],
            ["Schuetzen", "Schützen"],
            ["Kontextmenue", "Kontextmenü"],
            ["Aegypten", "Ägypten"],
            ["Aerzte", "Ärzte"],
            ["Oel", "Öl"],
            ["Heizoel", "Heizöl"],
            ["Maerz", "März"],
            ["Schoen", "Schön"],
            ["Bluete", "Blüte"],
            ["Zuege", "Züge"],
            ["Zuerich", "Zürich"],
            ["Geoeffnet", "Geöffnet"],
            ["gruen", "grün"],
            ["Raeuber", "Räuber"],
            ["Dateiaenderung", "Dateiänderung"],
        ];
        for (const [vorher, nachher] of wandelt) expect(echteUmlaute(vorher)).toBe(nachher);
        expect(
            echteUmlaute("Editoren sehen an Orten Flaechen, die sich oeffnen lassen, fuer gewaehlte Flusshoehen."),
        ).toBe("Editoren sehen an Orten Flächen, die sich öffnen lassen, für gewählte Flusshöhen.");
    });

    it("🔴 zerstört kein Wort, in dem das Paar echt ist: Namen, Fremdwörter, „neue“, „Feuer“, „Bauer“", () => {
        const bleibt = [
            "Israel",
            "Michael",
            "Raphael",
            "Nathanael",
            "Manuel",
            "Samuel",
            "Emanuel",
            "Joel",
            "Noel",
            "Zoe",
            "Goethe",
            "Poesie",
            "Poet",
            "neue",
            "Neues",
            "Neuerungen",
            "Feuer",
            "Bauer",
            "Bauern",
            "Mauer",
            "Steuer",
            "Treue",
            "Abenteuer",
            "Frauen",
            "Quelle",
            "Quellen",
            "Request",
            "Frequenz",
            "Duell",
            "aktuell",
            "aktuelle",
            "individuell",
            "manuell",
            "virtuell",
            "zuerst",
            "Statue",
            "Individuen",
            "Phexcaer",
            "Caesar",
            "Coesfeld",
            "Issue",
            "Value",
            "Queue",
            "Koexistenz",
            "Aerodynamik",
        ];
        for (const wort of bleibt) expect(echteUmlaute(wort)).toBe(wort);
        // Ganze Sätze mit beidem.
        expect(
            echteUmlaute("Michael und Israel finden die neue Quelle zuerst; das Feuer der Bauern ist aktuell."),
        ).toBe("Michael und Israel finden die neue Quelle zuerst; das Feuer der Bauern ist aktuell.");
        expect(echteUmlaute("Michael oeffnet die neue Uebersicht fuer Israel.")).toBe(
            "Michael öffnet die neue Übersicht für Israel.",
        );
    });

    it("lässt Abkürzungen in Großbuchstaben, Zahlen, Verweise und alles ohne Paar unverändert; „ss“ wird nicht zu „ß“", () => {
        for (const text of ["OEPNV", "UEBERSICHT", "3D", "Strasse", "Fluss", "", "Karte"]) {
            expect(echteUmlaute(text)).toBe(text);
        }
        expect(echteUmlaute("Schloss, Fluss und Strasse")).toBe("Schloss, Fluss und Strasse");
    });

    it("🔴 die Quelltexte des Berichts kommen mit echten Umlauten an: Punkte, Community-Titel, Befund, Hintergrund; `sichererSatz` selbst (für /offen) bleibt", () => {
        expect(sichererSatz("Flaechen oeffnen")).toBe("Flaechen oeffnen");
        expect(berichtSatz("Flaechen oeffnen sich")).toBe("Flächen öffnen sich");

        const verlauf: ReleaseVerlauf = {
            schema: 1,
            bis: sha(5),
            commits: [
                {
                    sha: sha(5),
                    art: "feat",
                    titel: "feat: Flaechen oeffnen",
                    neu: ["Editoren sehen an Orten, Gebieten, Flaechen und Wegen die gewaehlte Flusshoehe."],
                    beschreibung: "Die Karte oeffnet Flaechen fuer Michael.",
                    achtung: [],
                    anwendung: true,
                },
                { sha: sha(3), art: "feat", titel: "feat: Basis", neu: [], achtung: [], anwendung: true },
            ],
        };
        const jetzt = new Date("2026-10-25T09:00:00Z");
        const eingang = (vorher: DiscordFakten | null) => ({
            tag: "2026-10-25",
            jetzt,
            umgebung: "production",
            releaseId: `20261025T080000Z-${sha(5).slice(0, 7)}`,
            produktion: verlauf,
            werkstatt: null,
            freigabe: null,
            vorher,
            community: { bearbeitungen: 0, medien: 0, personen: 0, bewertungen: 0 },
            fenster: { von: new Date(jetzt.getTime() - 24 * 3600_000), bis: jetzt },
        });
        const erster = rechneFakten(eingang(null));
        const vorher: DiscordFakten = {
            ...erster,
            production: {
                release: "x",
                commit: sha(3).slice(0, 7),
                seit: null,
                vergleich: "gleich",
                neu: [],
                ohneSatz: 0,
            },
            werkstatt: { commit: null, vergleich: "neu", pruefung: "unbekannt", alle: [], neu: [], weiterhin: 0 },
            erhobenAt: "2026-10-24T08:00:00.000Z",
        };
        const fakten = rechneFakten(eingang(vorher));
        expect(sammlePunkte(fakten).map((p) => p.text)).toEqual([
            "Editoren sehen an Orten, Gebieten, Flächen und Wegen die gewählte Flusshöhe.",
        ]);
        const neuerung = sammleNeuerungen(fakten)[0]!;
        expect(neuerung.neu).toEqual(["Editoren sehen an Orten, Gebieten, Flächen und Wegen die gewählte Flusshöhe."]);
        expect(neuerung.betreff).toBe("Flächen öffnen");
        expect(neuerung.beschreibung).toBe("Die Karte öffnet Flächen für Michael.");
        expect(hintergrund("Israel oeffnet die Flaechen", 100)).toBe("Israel öffnet die Flächen");

        const vorgang = (teil: Partial<BerichtsVorgang> & { nummer: number }): BerichtsVorgang => ({
            kategorie: "bug",
            status: "neu",
            titel: "",
            melder: null,
            angelegtAt: "2026-10-20T08:00:00.000Z",
            gesichtet: true,
            befund: null,
            text: null,
            ...teil,
        });
        const meldungen = sammleMeldungen([
            vorgang({
                nummer: 7,
                titel: "Flaechen lassen sich nicht oeffnen",
                melder: "Samuel",
                befund: "Ursache gefunden, Behebung folgt.",
            }),
        ]);
        const text = baueBericht(fakten, { meldungen });
        expect(text).toContain("• Editoren sehen an Orten, Gebieten, Flächen und Wegen die gewählte Flusshöhe.");
        expect(text).toContain("• #7 „Flächen lassen sich nicht öffnen“ (Samuel): Ursache gefunden, Behebung folgt.");
        expect(text).not.toMatch(/Flaechen|oeffnen|gewaehlte|Flusshoehe/u);
    });
});
