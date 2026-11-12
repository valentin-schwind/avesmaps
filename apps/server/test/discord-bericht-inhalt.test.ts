import { describe, expect, it } from "vitest";
import {
    DISCORD_PROMPT_MAX,
    DISCORD_PROMPT_VORGABE,
    type DiscordFakten,
    type ReleaseVerlauf,
} from "@avesmaps3d/shared";
import type { Queryable } from "../src/database.ts";
import { rechneFakten, type FaktenEingang } from "../src/discord/fakten.ts";
import { FORMULIERER_BERICHT_REGELN, baueKontext } from "../src/discord/formulierer.ts";
import { NICHT_OFFEN, sammleVorgaenge } from "../src/discord/meldungen.ts";
import { istIntern, neuSatz, ohneVorbehalt } from "../src/discord/muster.ts";
import { pruefeModellBericht } from "../src/discord/pruefung.ts";
import { sammleNeuerungen } from "../src/discord/punkte.ts";
import { echteUmlaute } from "../src/discord/umlaute.ts";
import { BEREICH_KOPF, baueBericht, bereichVon, zerlege } from "../src/discord/vorlage.ts";

/**
 * Die Befunde der zweiten Vorschau des Tagesberichts (Handover `2026-11-03-discord-vorschau-zwei-an-claudia.md`, Valis Wort „interna weg lassen ja“):
 * Interna, Einordnung, Doppelungen, Veraltetes und „Grösse“. Ohne Datenbank und ohne Modell. Was nur das Modell entscheiden kann (welche Neuerung sonst
 * niemand bemerkt, welche Punkte dasselbe Thema sind), steht als Regel in der Vorgabe (`FORMULIERER_BERICHT_REGELN`) und ist hier nur als Text belegt.
 */

const sha = (n: number): string => n.toString(16).padStart(7, "a").padEnd(40, "0");

/** Ein Verlauf, neueste zuerst: `[n, neu-Zeilen, art]`; ohne Zeile ist der Commit unredigiert. */
function verlauf(eintraege: [number, string[], ("feat" | "fix")?][]): ReleaseVerlauf {
    return {
        schema: 1,
        bis: sha(eintraege[0]![0]),
        commits: eintraege.map(([n, neu, art]) => ({
            sha: sha(n),
            art: art ?? "feat",
            titel: `${art ?? "feat"}(WI-0${String(n)}): technischer Betreff ${String(n)}`,
            neu,
            achtung: [],
            anwendung: true,
        })),
    };
}

const releaseVon = (n: number): string => `20261103T080000Z-${sha(n).slice(0, 7)}`;

const JETZT = new Date("2026-11-03T09:00:00Z");

function eingang(teil: Partial<FaktenEingang>): FaktenEingang {
    return {
        tag: "2026-11-03",
        jetzt: JETZT,
        umgebung: "production",
        releaseId: releaseVon(3),
        produktion: verlauf([[3, []]]),
        werkstatt: null,
        freigabe: null,
        vorher: null,
        community: { bearbeitungen: 0, medien: 0, personen: 0, bewertungen: 0 },
        fenster: { von: new Date(JETZT.getTime() - 24 * 3600_000), bis: JETZT },
        ...teil,
    };
}

/** Der Faktenbestand des letzten zugestellten Berichts, dessen Production-Stand `commit` war. */
const vorherMit = (commit: string): DiscordFakten => ({
    ...rechneFakten(eingang({})),
    production: { release: "x", commit, seit: null, vergleich: "gleich", neu: [], ohneSatz: 0 },
    werkstatt: { commit: null, vergleich: "neu", pruefung: "unbekannt", alle: [], neu: [], weiterhin: 0 },
    erhobenAt: "2026-11-02T08:00:00.000Z",
});

/** Die Fakten, wenn Production seit dem Stand `basis` des letzten Berichts diese Commits (neueste zuerst) bekam. */
function seit(basis: number, eintraege: [number, string[], ("feat" | "fix")?][]): DiscordFakten {
    return rechneFakten(
        eingang({
            releaseId: releaseVon(eintraege[0]![0]),
            produktion: verlauf([...eintraege, [basis, []]]),
            vorher: vorherMit(sha(basis).slice(0, 7)),
        }),
    );
}

describe("Discord-Bericht: Interna fallen weg (Vali 2026-11-03: „interna weg lassen ja“)", () => {
    it("🔴 ein Satz, der selbst sagt, dass man nichts davon sieht, oder von Stage, Release-Test und Entwicklungsrechner erzählt, ist intern; sonst nicht", () => {
        for (const satz of [
            "Zwischenschritt der Reisebilder ohne eigene sichtbare Wirkung.",
            "Die Datenbank kennt freigegebene Reisebilder als eigene Verwendung; zu sehen ist das noch nicht.",
            "Ein Abzug von Stage oder Production lässt sich lokal auch dann einspielen, wenn der lokale Stand schon neuere Tafeln hat.",
            "Bewertungen, die die Redaktion verborgen hat, gelangen nicht mehr auf den Entwicklungsrechner.",
            "Auf der Stage und im Release-Test stehen jetzt dauerhaft acht Beispielbilder auf der Karte.",
            "Die lokale Bühne führt die Warteschlange auf dem Stage-Stand aus.",
            "Der Umbau läuft ohne sichtbare Auswirkung.",
            "Für Besucher ist das noch nicht sichtbar.",
        ]) {
            expect(istIntern(satz), satz).toBe(true);
        }
        for (const satz of [
            "Verborgene Orte sind auf der Karte nicht sichtbar.",
            "Bearbeiten in Production ist wieder möglich.",
            "Die Backstage-Führung zeigt den Ort.",
            "Orte zeigen ihr Wappen im Infopanel.",
            "Die Stagecoach-Linie ist neu.",
        ]) {
            expect(istIntern(satz), satz).toBe(false);
        }
    });

    it("🔴 solche Sätze kommen weder als Punkt noch als Eintrag für das Modell vor; ein Commit ganz ohne Satz bleibt, das Modell entscheidet nach dem Betreff", () => {
        const f = seit(3, [
            [10, []],
            [9, ["Zwischenschritt der Reisebilder ohne eigene sichtbare Wirkung."]],
            [8, ["Die Datenbank kennt freigegebene Reisebilder als eigene Verwendung; zu sehen ist das noch nicht."]],
            [7, ["Ein Abzug von Stage oder Production lässt sich lokal einspielen."]],
            [6, ["Bewertungen gelangen nicht mehr auf den Entwicklungsrechner."], "fix"],
            [5, ["Auf der Stage und im Release-Test stehen jetzt acht Beispielbilder auf der Karte."]],
            [4, ["Orte zeigen ihr Wappen im Infopanel."]],
        ]);
        expect(f.production.vergleich).toBe("neu");
        expect(f.production.neu.map((fakt) => fakt.satz)).toEqual(["Orte zeigen ihr Wappen im Infopanel."]);
        // Die Einträge für das Modell, älteste zuerst: der Commit mit dem Wappen, dann der ohne `Neu:`-Zeile.
        expect(f.production.eintraege!.map((e) => e.saetze)).toEqual([["Orte zeigen ihr Wappen im Infopanel."], []]);
        const bericht = baueBericht(f);
        expect(bericht).toContain("Orte zeigen ihr Wappen im Infopanel.");
        expect(bericht).not.toMatch(/Zwischenschritt|Datenbank|Abzug|Entwicklungsrechner|Release-Test|Stage/u);
        // Die Neuerungen, die das Modell sieht, tragen sie ebenso wenig.
        const k = baueKontext(f, "morgens");
        expect(JSON.stringify(k.neuerungen)).not.toMatch(
            /Zwischenschritt|Datenbank|Abzug|Entwicklungsrechner|Release-Test|Stage/u,
        );
        expect(k.neuerungen.map((n) => n.betreff)).toEqual(["technischer Betreff 4", "technischer Betreff 10"]);
    });

    it("🔴 bleibt nach dem Weglassen nichts, steht der Satz für einen Tag ohne Neues da, nicht ein leerer Teil", () => {
        const f = seit(3, [
            [9, ["Zwischenschritt der Reisebilder ohne eigene sichtbare Wirkung."]],
            [8, ["Ein Abzug von Stage oder Production lässt sich lokal einspielen."]],
        ]);
        expect(f.production.neu).toEqual([]);
        const k = baueKontext(f, "morgens");
        expect(k.neuerungen).toEqual([]);
        expect(k.leer.neu).toContain("keine neuen Funktionen");
        expect(baueBericht(f)).toContain("keine neuen Funktionen");
    });

    it("🔴 ein Modell, das einen Punkt „ohne sichtbare Wirkung“ schreibt, fällt durch (dann gilt die Vorlage)", () => {
        const f = seit(3, [[9, ["Orte zeigen ihr Wappen im Infopanel."]]]);
        const k = baueKontext(f, "morgens");
        const text = (punkt: string): string =>
            [
                k.titel,
                "Guten Morgen.",
                "",
                "✨ **Was ist neu?**",
                punkt,
                "",
                "🔨 **Was ist in Entwicklung?**",
                k.leer.entwicklung ?? "",
                "",
                k.schluss,
            ].join("\n");
        const ids = k.neuerungen.map((n) => n.id);
        expect(pruefeModellBericht({ text: text("• Orte zeigen ihr Wappen im Infopanel."), punkte: ids }, k)).toEqual({
            ok: true,
            fehler: [],
        });
        const intern = pruefeModellBericht(
            { text: text("• Zwischenschritt der Reisebilder ohne eigene sichtbare Wirkung."), punkte: ids },
            k,
        );
        expect(intern.ok).toBe(false);
        expect(intern.fehler.join("\n")).toContain("Punkt ohne sichtbare Wirkung");
    });
});

describe("Discord-Bericht: Veraltetes (Vorbehalte über Künftiges, erledigte Vorgänge)", () => {
    it("🔴 ein Vorbehalt über Künftiges hinter einem Strichpunkt oder in einer Klammer am Ende fällt weg; der Rest bleibt", () => {
        expect(
            ohneVorbehalt(
                "Doppelte Befehle in Discord lassen sich jetzt prüfen und auf Server-Ebene entfernen; die Korrektur selbst läuft erst noch.",
            ),
        ).toBe("Doppelte Befehle in Discord lassen sich jetzt prüfen und auf Server-Ebene entfernen.");
        expect(
            ohneVorbehalt(
                "Discord: /offen zeigt künftig auch eigene Meldungen von der Website (sobald die Verbindung zur Website eingerichtet ist).",
            ),
        ).toBe("Discord: /offen zeigt künftig auch eigene Meldungen von der Website.");
        // Nichts zu streichen oder nichts übrig: der Satz bleibt, wie er ist.
        for (const satz of [
            "Der Tagesbericht kommt in mehreren Nachrichten; Gruß und Dank stehen nur einmal.",
            "Die Suche findet Flüsse.",
            "Die Suche kommt demnächst.",
            "Erst noch prüfen, dann speichern.",
        ]) {
            expect(ohneVorbehalt(satz), satz).toBe(satz);
        }
    });

    it("🔴 Vorlage und Eingabe des Modells führen den Satz ohne den Vorbehalt, mit echten Umlauten", () => {
        const satz =
            "Doppelte Befehle in Discord lassen sich jetzt pruefen und auf Server-Ebene entfernen; die Korrektur selbst läuft erst noch.";
        expect(neuSatz(satz)).toBe(
            "Doppelte Befehle in Discord lassen sich jetzt prüfen und auf Server-Ebene entfernen.",
        );
        const f = seit(3, [[9, [satz]]]);
        expect(baueBericht(f)).not.toContain("erst noch");
        expect(JSON.stringify(baueKontext(f, "morgens").neuerungen)).not.toContain("erst noch");
    });

    it("🔴 die Community-Liste führt nur offene Vorgänge: mit dem Stand „zur Abnahme“ ist ein Fix gemeldet und die Abnahme der Betreiber offen, eine Nummer entscheidet nie", async () => {
        expect([...NICHT_OFFEN].sort()).toEqual(["abgelehnt", "abgenommen", "beantwortet", "zur_abnahme"]);
        // Was noch offen ist (auch ein Fix auf der Stage, ein Vorgang bei Claudia, ein ungesichteter), bleibt in der Liste.
        for (const offen of ["zu_sichten", "neu", "angenommen", "in_arbeit", "bei_claudia", "auf_stage"]) {
            expect((NICHT_OFFEN as readonly string[]).includes(offen), offen).toBe(false);
        }
        // Die Abfrage übergibt genau diese Liste; keine Nummer steht darin.
        const werte: unknown[][] = [];
        const db = ((_teile: TemplateStringsArray, ...parameter: unknown[]) => {
            werte.push(parameter);
            return Promise.resolve([]);
        }) as unknown as Queryable;
        expect(await sammleVorgaenge(db)).toEqual([]);
        expect(werte).toHaveLength(1);
        expect(werte[0]).toContainEqual([...NICHT_OFFEN]);
    });
});

describe("Discord-Bericht: Einordnung (Discord und Community, Neuerung statt Behebung)", () => {
    const fix = (text: string) => ({ art: "fix" as const, text });
    const merkmal = (text: string) => ({ art: "feature" as const, text });

    it("🔴 der Tagesbericht und die Befehle des Bots gehören zu Discord, nicht zur Karte; Community allein genügt nicht (Reiter der Redaktion)", () => {
        expect(
            bereichVon(merkmal("Der Tagesbericht kommt bei vielen Neuerungen in mehreren Nachrichten hintereinander.")),
        ).toBe("discord");
        expect(bereichVon(merkmal("/bug und /idee posten die Meldung kurz in ihren Kanal."))).toBe("discord");
        expect(bereichVon(merkmal("In Discord zeigt /offen zu jeder Meldung ihre Nummer."))).toBe("discord");
        expect(
            bereichVon(merkmal("Der Bilderstapel in Community › Meldungen ist nach dem Prüfen sofort aktuell.")),
        ).toBe("karte");
        expect(bereichVon(merkmal("Orte zeigen ihr Wappen im Infopanel."))).toBe("karte");
        // Ein Satz aus der Verwaltung bleibt beim Editor, auch wenn Discord darin vorkommt.
        expect(bereichVon(merkmal("Der Reiter Discord in der Verwaltung zeigt die Uhrzeit."))).toBe("editor");
    });

    it("🔴 unter „Fehler behoben“ steht nur ein fix, dessen Satz selbst eine Behebung sagt; eine Neuerung unter dem Präfix fix steht an ihrem Ort", () => {
        // Die Beispiele aus der Vorschau: Das sind Neuerungen.
        expect(
            bereichVon(
                fix(
                    "Rechtsklick auf ein Gebiet bietet „Unterpolygone löschen …“, wenn seine Fläche aus mehreren Teilen besteht.",
                ),
            ),
        ).toBe("karte");
        expect(bereichVon(fix("In Discord zeigt /offen zu jeder Meldung ihre Nummer in Klammern."))).toBe("discord");
        expect(
            bereichVon(
                fix("Fügst du einen Link einer bekannten Briefspielseite ein, stehen Quellenart und Lizenz schon da."),
            ),
        ).toBe("karte");
        // Echte Behebungen bleiben.
        for (const satz of [
            "Ein zweites Fenster sperrt dich beim Bearbeiten nicht mehr aus.",
            "Der Kammeditor speichert wieder.",
            "Ein Absturz beim Speichern ist behoben.",
            "Der Routenplaner rechnet Fähren nicht mehr doppelt.",
            "Im Tagesbericht zerreißt ein fetter Titel keinen Satz mehr.",
            "Die Herkunftskarte erklärt ihre Färbung jetzt richtig.",
            "Auch mit offener Bildleiste bleibt die Karte beim Zoomen flüssig.",
        ]) {
            expect(bereichVon(fix(satz)), satz).toBe("fehler");
        }
    });

    it("🔴 die Vorlage zeigt die vier Bereiche in dieser Reihenfolge, jeden nur mit Punkten, und der Tagesbericht steht nicht unter Karte", () => {
        const f = seit(3, [
            [10, ["Der Tagesbericht kommt bei vielen Neuerungen in mehreren Nachrichten hintereinander."]],
            [
                9,
                [
                    "Rechtsklick auf ein Gebiet bietet „Unterpolygone löschen …“, wenn seine Fläche aus mehreren Teilen besteht.",
                ],
                "fix",
            ],
            [8, ["In Discord zeigt /offen zu jeder Meldung ihre Nummer in Klammern."], "fix"],
            [7, ["Ein zweites Fenster sperrt dich beim Bearbeiten nicht mehr aus."], "fix"],
            [6, ["Orte zeigen ihr Wappen im Infopanel."]],
            [5, ["Im Ortseditor lässt sich die Stadt eines Viertels festlegen."]],
        ]);
        const zeilen = baueBericht(f).split("\n");
        const stelle = (muster: string): number => {
            const i = zeilen.findIndex((zeile) => zeile.includes(muster));
            expect(i, muster).toBeGreaterThanOrEqual(0);
            return i;
        };
        const karte = stelle(BEREICH_KOPF.karte);
        const editor = stelle(BEREICH_KOPF.editor);
        const discord = stelle(BEREICH_KOPF.discord);
        const fehler = stelle(BEREICH_KOPF.fehler);
        expect(karte).toBeLessThan(editor);
        expect(editor).toBeLessThan(discord);
        expect(discord).toBeLessThan(fehler);
        expect(stelle("Der Tagesbericht kommt")).toBeGreaterThan(discord);
        expect(stelle("Der Tagesbericht kommt")).toBeLessThan(fehler);
        expect(stelle("zeigt /offen")).toBeGreaterThan(discord);
        expect(stelle("Unterpolygone")).toBeGreaterThan(karte);
        expect(stelle("Unterpolygone")).toBeLessThan(editor);
        expect(stelle("Ein zweites Fenster")).toBeGreaterThan(fehler);
        // Ohne Punkte aus Discord steht auch keine Überschrift dafür da.
        const ohneDiscord = baueBericht(seit(3, [[6, ["Orte zeigen ihr Wappen im Infopanel."]]]));
        expect(ohneDiscord).not.toContain(BEREICH_KOPF.discord);
    });

    it("🔴 die Regeln des Formulierers nennen die Gruppe Discord und Community und trennen Neuerung von Behebung; die Vorgabe der Betreiber auch", () => {
        expect(FORMULIERER_BERICHT_REGELN).toContain("🤝 Discord und Community");
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/nie unter Karte\s+oder Editor/u);
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/`art` „fix“ nennt nur den Typ des Commits/u);
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/neue Möglichkeit/u);
        expect(DISCORD_PROMPT_VORGABE).toContain("🤝 Discord und Community");
        expect(DISCORD_PROMPT_VORGABE).toMatch(/neue Möglichkeit/u);
        expect(DISCORD_PROMPT_VORGABE.length).toBeLessThanOrEqual(DISCORD_PROMPT_MAX);
    });
});

describe("Discord-Bericht: Doppelungen", () => {
    it("🔴 derselbe Satz steht in der Eingabe des Modells nur einmal; eine Neuerung, deren Sätze alle schon dastehen, fällt weg", () => {
        const f = seit(3, [
            [10, ["Jeder Screenshot trägt das Logo.", "Die Zeile im Bild nennt die Richtlinie."]],
            [9, ["Jeder Screenshot trägt das Logo."]],
            [8, ["Jeder Screenshot trägt das Logo."]],
            [7, ["Orte zeigen ihr Wappen im Infopanel."]],
        ]);
        const neuerungen = sammleNeuerungen(f);
        // Älteste zuerst: Das Logo steht in der ältesten der drei, deren Wiederholung fällt ganz weg, die jüngste trägt nur ihren neuen Satz.
        expect(neuerungen.map((n) => n.neu)).toEqual([
            ["Orte zeigen ihr Wappen im Infopanel."],
            ["Jeder Screenshot trägt das Logo."],
            ["Die Zeile im Bild nennt die Richtlinie."],
        ]);
        expect(neuerungen.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    });

    it("🔴 die Regeln verlangen EIN Thema nur einmal und nennen die Prüffrage; Neuerungen derselben Gruppe sind meist eine Sache", () => {
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/Jedes Thema steht höchstens einmal/u);
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/Wiederholung des ersten/u);
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/auch wenn eine davon eine Behebung ist/u);
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/nennst alle ihre Kennungen in `punkte`/u);
        expect(DISCORD_PROMPT_VORGABE).toMatch(/Ein Thema steht nur einmal/u);
    });
});

describe("Discord-Bericht: Interna und Veraltetes als Regel an das Modell", () => {
    it("🔴 die Regeln sagen, was Interna sind, geben die Prüffrage und lassen nur das interne Stück eines sonst sichtbaren Satzes weg", () => {
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/Interna lässt du weg/u);
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/avesmaps\.de benutzt oder in unserem Discord mitliest/u);
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/Abzüge und Testdaten/u);
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/lass nur dieses Stück weg/u);
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/Erzähle den Stand von heute/u);
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/Vorbehalte weg/u);
        expect(DISCORD_PROMPT_VORGABE).toMatch(/Lass weg, was niemand auf avesmaps\.de oder in Discord bemerkt/u);
        // Der Bot selbst ist nicht mehr pauschal intern: Der Tagesbericht und die Befehle gehören zu Discord.
        expect(DISCORD_PROMPT_VORGABE).not.toMatch(/den Bot selbst/u);
    });
});

describe("Discord-Bericht: Größe statt Grösse", () => {
    it("🔴 „gröss-“ ist immer „größ-“, auch aus der Umschrift „groess-“ und in Zusammensetzungen; andere Wörter mit ss und ö bleiben", () => {
        const faelle: [string, string][] = [
            ["Groesse", "Größe"],
            ["Grösse", "Größe"],
            ["Die Groesse des Felds laesst sich aendern.", "Die Größe des Felds lässt sich ändern."],
            ["Fenstergroesse", "Fenstergröße"],
            ["Fenstergrösse", "Fenstergröße"],
            ["groesser", "größer"],
            ["vergroessern", "vergrößern"],
            ["Grössen", "Größen"],
            ["Kartengroessen", "Kartengrößen"],
        ];
        for (const [roh, soll] of faelle) expect(echteUmlaute(roh), roh).toBe(soll);
        // Ohne Wörterbuch bleibt alles andere stehen: ein kurzes ö (Schlösser), ein kurzes u (Fluss), ein Wort in Großbuchstaben.
        for (const wort of ["Schlösser", "Fluss", "Fluesse", "GROESSE", "Rösser", "Schloss"]) {
            expect(echteUmlaute(wort), wort).toBe(wort === "Fluesse" ? "Flüsse" : wort);
        }
        expect(echteUmlaute("Schloesser")).toBe("Schlösser");
    });

    it("🔴 die Regeln verlangen ß, wo es die Rechtschreibung verlangt", () => {
        expect(FORMULIERER_BERICHT_REGELN).toMatch(/Größe, nicht Grösse/u);
    });

    it("die Umschrift selbst bleibt stehen, wenn ein Satz von ihr erzählt („statt ae, oe und ue“)", () => {
        expect(echteUmlaute("Im Tagesbericht stehen echte Umlaute statt ae, oe und ue.")).toBe(
            "Im Tagesbericht stehen echte Umlaute statt ae, oe und ue.",
        );
        expect(echteUmlaute("Die Aenderung laesst sich pruefen.")).toBe("Die Änderung lässt sich prüfen.");
    });
});

describe("Discord-Bericht: Fettkopf der Vorlage", () => {
    it("🔴 ein Satz vor dem Doppelpunkt ist kein Titel: ab sechs Wörtern bleibt der Punkt ohne Fettkopf, ein kurzer Titel bleibt", () => {
        const satz =
            "Der Tagesbericht in Discord wird ausführlicher: Er zählt alle erledigten Punkte auf und grüßt kürzer.";
        expect(zerlege(satz)).toEqual({ titel: null, rest: satz });
        expect(zerlege("Weg teilen: Im Kontextmenü gibt es jetzt auch „Weg teilen (ohne Kreuzung)“.")).toMatchObject({
            titel: "Weg teilen",
        });
        expect(zerlege("Der Kammeditor rundet: Flüsse und Seen stehen blau mit ihren Punkten.")).toMatchObject({
            titel: "Der Kammeditor rundet",
        });
    });
});
