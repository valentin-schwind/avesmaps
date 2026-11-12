import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { InhalteRegelTextErgebnis, type InhalteVorkommenBedingung } from "@avesmaps3d/shared";
import { alsErgebnis, pruefeText } from "../src/inhalte/regeln-text/ergebnis.ts";
import { titelNorm } from "../src/inhalte/regeln-text/glied.ts";
import { lies } from "../src/inhalte/regeln-text/lies.ts";
import { bauePlan } from "../src/inhalte/regeln-text/plan.ts";
import { restText } from "../src/inhalte/regeln-text/rest.ts";
import { schreibeRegelBlock } from "../src/inhalte/regeln-text/schreibe.ts";
import { eintragsSchluessel, schluesselAusVertrag } from "../src/inhalte/regeln-text/schluessel.ts";
import type { Problem, RegelInnen } from "../src/inhalte/regeln-text/typen.ts";
import { titelNorm as titelNormSchreiber } from "../src/inhalte/vorkommen-regeln-lesen.ts";
import { E, F, O, Q, anfang, testWelt } from "./support/regeln-text-welt.ts";

/**
 * „Regeln als Text“, der reine Teil (WI-0254 §13 und §14; ohne Datenbank): der Leser `lies` mit den Zeichen der Wiki-Kurzschrift, die Rückfragen und Fehler samt ihren Antworten (`ersatz`), „gibt es schon“, der Rückweg
 * „Als Text“ (derselbe Fingerabdruck wie der Schreiber), der Plan und der Rest nach dem Übernehmen, dazu das Ergebnis gegen das Schema des Vertrags und Zufallstexte (keine Ausnahme, jeder Ersatz liegt in seiner Zeile).
 * Die Testwelt (`support/regeln-text-welt.ts`) ist erfunden.
 */

const welt = testWelt();
const KOPF = "Alprute (Flora)\n";
const R = (rest: string): string => `${KOPF}| Verbreitung = ${rest}`;

const regel = (g: ReturnType<typeof lies>, i = 0, j = 0): RegelInnen => g.eintraege[i]!.regeln[j]!;
const arten = (r: RegelInnen, b = 0): string => JSON.stringify(r.bedingungen[b]!.arten.map((a) => a.art));
/** Die Antwort einspielen: der Ersatz muss genau die Stelle treffen (Zeile, von, bis). */
function antwort(text: string, p: Problem, nr = 0): string {
    const o = p.optionen[nr]!.ersatz;
    const z = text.split("\n");
    z[o.zeile] = (z[o.zeile] ?? "").slice(0, o.von) + o.text + (z[o.zeile] ?? "").slice(o.bis);
    return z.join("\n");
}
/** Der Text, den die Antwort ersetzt (spaltengenau). */
const ersetzt = (text: string, p: Problem, nr = 0): string => {
    const o = p.optionen[nr]!.ersatz;
    return (text.split("\n")[o.zeile] ?? "").slice(o.von, o.bis);
};
const optText = (p: Problem, nr = 0): string => p.optionen[nr]!.ersatz.text;

describe("titelNorm: derselbe Vergleich wie im Schreiber", () => {
    it("gleiche Antworten auf Unterstrich, Leerraum und Groß-/Kleinschreibung", () => {
        for (const titel of ["Kaiserwald", " kaiser_wald ", "Der_Große Fluss", "ÄÖÜ", ""]) {
            expect(titelNorm(titel)).toBe(titelNormSchreiber(titel));
        }
    });
});

describe("Teile eines Glieds", () => {
    it("Landschaftsarten mit „oder“, Schlüssel und Anzeigename, ß/ss und Akzente egal, Ziel|Anzeige und angehängte Buchstaben", () => {
        const g1 = lies(R("[[Wald]] oder [[Sümpfe und Moore]]"), welt);
        expect(arten(regel(g1))).toBe('["wald","suempfe_moore"]');
        expect(g1.fehler).toEqual([]);
        const g2 = lies(R("[[suempfe_moore]] oder [[Flussland/Flusstal]] Klima gemaessigt"), welt);
        expect(regel(g2).bedingungen).toHaveLength(1);
        expect(regel(g2).bedingungen[0]!.arten).toHaveLength(2);
        expect(regel(g2).bedingungen[0]!.klima?.von).toBe("gemaessigt");
        const g3 = lies(R("[[Wald|Wälder]] oder [[Steppe]]n"), welt);
        expect(arten(regel(g3))).toBe('["wald","steppe"]');
        expect(g3.fehler).toEqual([]);
    });

    it("Fläche: eindeutig, mit Arten in einem Glied, Teile in freier Reihenfolge, ohne „in“ nur, wenn der Name keine Landschaftsart ist", () => {
        const g1 = lies(R("[[Wald]] in [[Aventurien]]"), welt);
        expect(regel(g1).bedingungen).toHaveLength(1);
        expect(regel(g1).bedingungen[0]!.flaeche).toEqual({
            offen: false,
            kennung: F.aventurien.id,
            name: "Aventurien",
        });
        expect(regel(g1).status).toBe("neu");
        const g2 = lies(R("in [[Aventurien]] [[Wald]]"), welt);
        expect(regel(g2).bedingungen[0]!.arten).toHaveLength(1);
        expect(regel(g2).bedingungen[0]!.flaeche).toMatchObject({ name: "Aventurien" });
        expect(regel(lies(R("[[Aventurien]]"), welt)).bedingungen[0]!.arten).toEqual([]);
        // über den Wiki-Titel (Name und Titel verschieden), Titel vor Name
        expect(regel(lies(R("in [[Aelderwald (Wald)]]"), welt)).bedingungen[0]!.flaeche).toMatchObject({
            name: "Aelderwald",
        });
        expect(regel(lies(R("[[Perlenmeer]]"), welt)).bedingungen[0]!.flaeche).toMatchObject({
            kennung: F.meerNord.id,
        });
    });

    it("„Meer“ und „See“ heißen wie Landschaftsarten: ohne „in“ sind sie Arten, mit „in“ die Fläche; „in [[Wald]]“ ist ein Fehler mit der Wahl „in“ weglassen", () => {
        const g1 = lies(R("[[Meer]] oder [[See]]"), welt);
        expect(arten(regel(g1))).toBe('["meer","see"]');
        expect(regel(g1).bedingungen[0]!.flaeche).toBeNull();
        const g2 = lies(R("in [[See]]"), welt);
        expect(regel(g2).bedingungen[0]!.arten).toEqual([]);
        expect(regel(g2).bedingungen[0]!.flaeche).toMatchObject({ kennung: F.see.id });
        // zwei Flächen „Meer“: Rückfrage mit beiden
        const g3 = lies(R("in [[Meer]]"), welt);
        const p3 = regel(g3).probleme[0]!;
        expect(regel(g3).status).toBe("rueckfrage");
        expect(p3.optionen).toHaveLength(2);
        expect(p3.optionen.every((o) => /^\[\[#b[0-9a-f]{7}\|Meer\]\]$/u.test(o.ersatz.text))).toBe(true);
        // „in [[Wald]]“: Wald ist nur eine Art
        const t = R("in [[Wald]]");
        const g4 = lies(t, welt);
        const p4 = regel(g4).probleme[0]!;
        const weg = p4.optionen.findIndex((o) => o.label === "„in“ weglassen");
        expect(p4.art).toBe("fehler");
        expect(weg).toBeGreaterThanOrEqual(0);
        expect(ersetzt(t, p4, weg)).toBe("in ");
        expect(regel(lies(antwort(t, p4, weg), welt)).bedingungen[0]!.arten[0]!.art).toBe("wald");
    });

    it("Klima: eine Zone, Spanne in beliebiger Reihenfolge, Schlüssel und kurze Form, Zone vor der nächsten Fläche", () => {
        const g1 = lies(R("[[Wald]] Klima Gemäßigte Zone bis Boreale Zone, Klima tropisch"), welt);
        const b = regel(g1).bedingungen;
        expect(b).toHaveLength(2);
        expect(b[0]!.klima).toEqual({ von: "boreal", bis: "gemaessigt" });
        expect(b[1]!.v).toBe("oder");
        expect(b[1]!.klima).toEqual({ von: "tropisch", bis: "tropisch" });
        const g2 = lies(R("Klima Subtropen winterfeucht bis trockene_subtropen"), welt);
        expect(regel(g2).bedingungen[0]!.klima).toEqual({ von: "subtropen_winterfeucht", bis: "trockene_subtropen" });
        expect(g2.fehler).toEqual([]);
        const g3 = lies(R("Klima polar in [[Aventurien]]"), welt);
        expect(regel(g3).bedingungen).toHaveLength(1);
        expect(regel(g3).bedingungen[0]!.klima).toEqual({ von: "polar", bis: "polar" });
        expect(regel(g3).bedingungen[0]!.flaeche).toMatchObject({ name: "Aventurien" });
    });

    it("Lage: ein Ort, eine Linie mit „–“, „-“ und „bis“ liest dasselbe (gleicher Fingerabdruck → „gibt es schon“ im Text); Akzent, Apostroph, Anzeigetext", () => {
        const g1 = lies(R("nördlich von [[Havena]]: südlich der Linie [[Havena]]–[[Perricum]]"), welt);
        const b = regel(g1).bedingungen;
        expect(b).toHaveLength(2);
        expect(b[0]!.lage).toMatchObject({ richtung: "nord", orte: [{ id: O.havena.id }] });
        expect(b[1]!.v).toBe("und");
        expect(b[1]!.lage?.orte).toHaveLength(2);
        expect(g1.fehler).toEqual([]);
        const g2 = lies(
            `${KOPF}| Verbreitung = südlich der Linie [[Havena]] bis [[Perricum]]; südlich der Linie [[Havena]]-[[Perricum]]; südlich der Linie [[Perricum]] – [[Havena]]`,
            welt,
        );
        expect(g2.eintraege[0]!.regeln.map((r) => r.status)).toEqual(["neu", "schon", "schon"]);
        expect(g2.fehler).toEqual([]);
        expect(
            regel(lies(R("südlich der Linie [[Hot-Alem]]–[[Perricum]]"), welt)).bedingungen[0]!.lage?.orte[0]!.name,
        ).toBe("Hôt-Alem");
        expect(
            regel(lies(R("nördlich von [[Havena (Siedlung)|Havena]]"), welt)).bedingungen[0]!.lage?.orte[0]!.name,
        ).toBe("Havena");
        expect(regel(lies(R("nördlich von [[Al’Anfa]]"), welt)).bedingungen[0]!.lage?.orte[0]!.name).toBe("Al'Anfa");
        expect(regel(lies(R("nordlich von [[Havena]]"), welt)).bedingungen[0]!.lage?.richtung).toBe("nord");
    });

    it("Lage: Fehler mit der Stelle (Linie mit einem Ort, „von“ mit zwei, unbekannte Richtung und Ort, derselbe Ort zweimal)", () => {
        expect(regel(lies(R("nördlich von [[Havena]]–[[Perricum]]"), welt)).probleme[0]!.text).toContain(
            "nimmt einen Ort",
        );
        expect(regel(lies(R("südlich der Linie [[Havena]]"), welt)).probleme[0]!.text).toContain("zwei Orte");
        const t = R("nordöstlich von [[Havena]]");
        const g = lies(t, welt);
        expect(regel(g).status).toBe("fehler");
        expect(ersetzt(t, regel(g).probleme[0]!)).toBe("nordöstlich");
        const t2 = R("nördlich von [[Havenaa]]");
        const g2 = lies(t2, welt);
        expect(optText(g2.fehler[0]!)).toBe("[[Havena]]");
        expect(ersetzt(t2, g2.fehler[0]!)).toBe("[[Havenaa]]");
        expect(regel(lies(R("südlich der Linie [[Havena]]–[[Havena]]"), welt)).probleme[0]!.text).toContain(
            "zwei verschiedene",
        );
    });

    it("Lage: ein mehrdeutiger Ort (Calladun/Calladûn) ist eine Rückfrage mit [[#Kennung|Name]], die Antwort löst auf", () => {
        const t = R("nördlich von [[Calladun]]");
        const g = lies(t, welt);
        const p = regel(g).probleme[0]!;
        expect(p.art).toBe("rueckfrage");
        expect(p.optionen).toHaveLength(2);
        expect(ersetzt(t, p)).toBe("[[Calladun]]");
        expect(p.optionen.map((o) => o.ersatz.text)).toEqual([
            `[[#${anfang(O.calladun.id)}|Calladun]]`,
            `[[#${anfang(O.calladunHut.id)}|Calladûn]]`,
        ]);
        expect(lies(antwort(t, p, 1), welt).fehler).toEqual([]);
        // nicht eindeutiger Kennungsanfang
        expect(regel(lies(R("nördlich von [[#c000]]"), welt)).probleme[0]!.text).toContain("nicht eindeutig");
    });

    it("(wartet): nur für einen Artikel, auf den der Eintrag schon wartet; mit und ohne „in“, Ziel|Anzeige, Groß/klein; sonst Fehler", () => {
        const g1 = lies(R("[[Wald]] in [[Kaiserwald]] (wartet)"), welt);
        expect(regel(g1).bedingungen[0]!.flaeche).toEqual({
            offen: true,
            titel: "Kaiserwald",
            name: "Kaiserwald",
            gespeichert: "Kaiserwald",
        });
        expect(regel(g1).status).toBe("neu");
        const g2 = lies(R("[[Kaiserwald|der Kaiserwald]] (wartet)"), welt);
        expect(regel(g2).bedingungen[0]!.flaeche).toMatchObject({ offen: true, titel: "Kaiserwald" });
        // dieselbe Fläche in anderer Schreibweise: gibt es im Text schon
        const g3 = lies(`${KOPF}| Verbreitung = [[Kaiserwald]] (wartet); in [[kaiserwald]] (wartet)`, welt);
        expect(g3.eintraege[0]!.regeln.map((r) => r.status)).toEqual(["neu", "schon"]);
        expect(regel(g3, 0, 1).schon).toEqual({ grund: "stapel", zeile: 1 });
        // unbekannter Titel: Fehler, ohne die Wahl „warten“
        const g4 = lies(R("in [[Mondwald]] (wartet)"), welt);
        expect(regel(g4).status).toBe("fehler");
        expect(regel(g4).probleme[0]!.text).toContain("wartet nicht auf einen Artikel");
        // eine Kennung wartet nicht
        expect(regel(lies(R(`in [[#${anfang(F.khomWueste.id)}|Khôm]] (wartet)`), welt)).status).toBe("fehler");
        // ein Titel, den inzwischen eine Fläche trägt: Fehler mit der Wahl, die Fläche zu nehmen
        const welt2 = testWelt({ wartend: new Map([[E.alprute.id, new Map([["meridiana", "Meridiana"]])]]) });
        const t = R("[[Meridiana]] (wartet)");
        const g5 = lies(t, welt2);
        expect(regel(g5).status).toBe("fehler");
        expect(regel(g5).probleme[0]!.text).toContain("trägt inzwischen eine Fläche");
        expect(ersetzt(t, regel(g5).probleme[0]!)).toBe("[[Meridiana]] (wartet)");
        expect(regel(lies(antwort(t, regel(g5).probleme[0]!), welt2)).bedingungen[0]!.flaeche).toMatchObject({
            offen: false,
            kennung: F.meridiana.id,
        });
    });

    it("(wartet) an einem Eintrag, der erst angelegt wird, ist ein Fehler; ein anderer Klammerzusatz ebenso, mit der Wahl „Zusatz entfernen“", () => {
        const g = lies("Sturmwurz (Flora, neu)\n| Verbreitung = [[Kaiserwald]] (wartet)", welt);
        expect(g.eintraege[0]!.neuAnlegen).toBe(true);
        expect(regel(g).status).toBe("fehler");
        expect(regel(g).probleme[0]!.text).toContain("erst angelegt");
        const t = R("[[Wald]] (häufig) oder [[Steppe]]");
        const g2 = lies(t, welt);
        const p = regel(g2).probleme[0]!;
        expect(regel(g2).status).toBe("fehler");
        expect(p.optionen[0]!.label).toBe("Zusatz entfernen");
        expect(ersetzt(t, p)).toBe(" (häufig)");
        expect(regel(lies(antwort(t, p), welt)).status).toBe("neu");
        const g3 = lies(
            `${KOPF}| Verbreitung = nördlich von [[Havena]] (ehemals): in [[Aventurien]] (?) (selten)\n| Herkunft = [[Wald]] (wartet)`,
            welt,
        );
        expect(regel(g3, 0, 0).probleme).toHaveLength(3);
        expect(regel(g3, 0, 1).status).toBe("fehler");
    });

    it("Namen in [[…]] dürfen Komma, Doppelpunkt, Klammer und „in“ enthalten", () => {
        const g1 = lies(R("[[Amboss, Ost-Massiv]]"), welt);
        expect(regel(g1).bedingungen).toHaveLength(1);
        expect(regel(g1).bedingungen[0]!.flaeche).toMatchObject({ name: "Amboss, Ost-Massiv" });
        const g2 = lies(R("[[Kaiserwald]] (wartet), [[Wald]]"), welt);
        expect(regel(g2).bedingungen).toHaveLength(2);
    });

    it("Kennungsanfang: [[#b0000004|Name]] wählt genau, der Name zählt nicht; unbekannt, nicht eindeutig und stillgelegt sind Fehler", () => {
        const a = anfang(F.aelderwald.id);
        const g = lies(`${KOPF}| Verbreitung = in [[#${a}|Aelderwald]]; in [[#${a}|irgendwas]]; in [[#${a}]]`, welt);
        expect(g.eintraege[0]!.regeln.map((r) => r.status)).toEqual(["neu", "schon", "schon"]);
        const g2 = lies(
            `${KOPF}| Verbreitung = in [[#ffffffff|X]]\n| Herkunft = in [[#b000]]\n| Regionen = in [[#${anfang(F.altoum.id)}|Altoum]]`,
            welt,
        );
        expect(regel(g2, 0, 0).probleme[0]!.text).toContain("gibt es nicht");
        expect(regel(g2, 0, 1).probleme[0]!.text).toContain("nicht eindeutig");
        expect(regel(g2, 0, 2).probleme[0]!.text).toBe("Fläche „Altoum“ ist stillgelegt.");
    });
});

describe("Zeichen, Zeilen und Eintragsköpfe", () => {
    it("streng von links nach rechts: „A, B: C außer D“ = ((A oder B) und C) ohne D", () => {
        const g = lies(R("[[Wald]], [[Steppe]]: Klima polar außer [[Gebirge]]"), welt);
        expect(regel(g).bedingungen.map((b) => b.v)).toEqual(["und", "oder", "und", "ohne"]);
        expect(g.fehler).toEqual([]);
    });

    it("„;“ beginnt eine neue Regel derselben Beziehung; mehrere |-Zeilen kennen ihre Zeile und Beziehung", () => {
        const g = lies(R("[[Gebirge]]; [[Steppe]]; [[Tundra]]"), welt);
        expect(g.eintraege[0]!.regeln).toHaveLength(3);
        expect(g.eintraege[0]!.regeln.every((r) => r.status === "neu" && r.relation === "verbreitung")).toBe(true);
        const g2 = lies(
            `${KOPF}| Verbreitung = [[Wald]]\n| Regionen = [[Steppe]]\n| Vorkommen = [[Tundra]]\n| Herkunft = [[Gebirge]]`,
            welt,
        );
        expect(g2.eintraege[0]!.regeln.map((r) => r.relation)).toEqual([
            "verbreitung",
            "regionen",
            "vorkommen",
            "herkunft",
        ]);
        expect(g2.eintraege[0]!.regeln.map((r) => r.zeile)).toEqual([1, 2, 3, 4]);
    });

    it("Fortsetzungszeile: eine eingerückte Zeile setzt den Ausdruck fort (auch mit Tabulator und CRLF, ohne Leerraum nach „|“)", () => {
        const g = lies(`${KOPF}| Verbreitung = [[Wald]]\n    außer [[Steppe]]`, welt);
        expect(regel(g).bedingungen).toHaveLength(2);
        expect(regel(g).bedingungen[1]!.v).toBe("ohne");
        expect([regel(g).zeile, regel(g).zeileBis]).toEqual([1, 2]);
        expect(g.fehler).toEqual([]);
        const g2 = lies(`${KOPF}| Verbreitung = [[Wald]],\n    [[Steppe]]; [[Tundra]]\n    : Klima polar`, welt);
        expect(g2.eintraege[0]!.regeln).toHaveLength(2);
        expect(regel(g2, 0, 1).bedingungen[1]!.klima?.von).toBe("polar");
        expect(regel(g2, 0, 1).zeileBis).toBe(3);
        const g3 = lies("Alprute (Flora)\r\n|verbreitung=[[Wald]]\r\n\t\toder [[Steppe]]\r\n", welt);
        expect(regel(g3).status).toBe("neu");
        expect(regel(g3).bedingungen[0]!.arten).toHaveLength(2);
        expect(g3.fehler).toEqual([]);
    });

    it("Kommentar und Leerzeilen werden überlesen; Quelle mit Seiten gilt bis „Quelle: –“; auch ohne [[…]]", () => {
        const g = lies(
            "# Beispiel\n\nQuelle: [[Geographia Aventurica]], S. 12, 14\nAlprute (Flora)\n| Verbreitung = [[Wald]]\nQuelle: –\nKajubo (Flora)\n| Verbreitung = [[Wald]]",
            welt,
        );
        expect(g.eintraege[0]!.quelle).toMatchObject({
            titel: "Geographia Aventurica",
            seiten: "12, 14",
            id: Q.geographia.id,
            status: "ok",
        });
        expect(g.eintraege[1]!.quelle).toBeNull();
        const g2 = lies(
            "Quelle: [[Zoo-Botanica Aventurica]]\nQuelle: Zoo-Botanica Aventurica, S. 217, 221\nAlprute (Flora)",
            welt,
        );
        expect(g2.quellen[0]!.seiten).toBe("");
        expect(g2.quellen[1]!.seiten).toBe("217, 221");
        expect(g2.eintraege[0]!.quelle).toBe(g2.quellen[1]);
    });

    it("Quelle: mehrfacher Titel → Rückfrage mit [[#Kennung|Titel]]; unbekannt → Fehler mit Vorschlag; Rest hinter dem Titel", () => {
        const t = "Quelle: [[Albernisches Briefspiel]], S. 3\nQuelle: [[Geographia Aventuric]]\nAlprute (Flora)";
        const g = lies(t, welt);
        expect(g.quellen[0]!.status).toBe("rueckfrage");
        expect(g.quellen[0]!.probleme[0]!.optionen).toHaveLength(2);
        expect(optText(g.quellen[0]!.probleme[0]!)).toBe(`[[#${anfang(Q.briefspiel1.id)}|Albernisches Briefspiel]]`);
        expect(ersetzt(t, g.quellen[0]!.probleme[0]!)).toBe("[[Albernisches Briefspiel]]");
        expect(g.quellen[1]!.status).toBe("fehler");
        expect(optText(g.quellen[1]!.probleme[0]!)).toBe("[[Geographia Aventurica]]");
        expect(lies(antwort(t, g.quellen[0]!.probleme[0]!, 1), welt).quellen[0]!.status).toBe("ok");
        expect(lies("Quelle: [[Geographia Aventurica]] S. 3", welt).quellen[0]!.probleme[0]!.text).toContain(
            "Hinter dem Titel",
        );
        expect(lies("Quelle:", welt).quellen[0]!.status).toBe("fehler");
        expect(
            lies(`Quelle: [[Geographia Aventurica]], S. ${"9".repeat(121)}`, welt).quellen[0]!.probleme[0]!.text,
        ).toContain("zu lang");
    });

    it("Kopf: Wiki-Titel bei gleichnamigen Einträgen; Rückfrage ohne Titel; Name in zwei Kategorien; Tippfehler; neu anlegen", () => {
        const g1 = lies("Alant (Flora, [[Inoffiziell:Alant]])\n| Verbreitung = [[Wald]]", welt);
        expect(g1.eintraege[0]!.id).toBe(E.alantNeu.id);
        expect(g1.fehler).toEqual([]);
        // Alant (Flora) gibt es zweimal: Rückfrage, Antwort mit [[Wiki-Titel]]
        const t = "Alant (Flora)\n| Verbreitung = [[Wald]]";
        const g2 = lies(t, welt);
        const p = g2.eintraege[0]!.probleme[0]!;
        expect(p.art).toBe("rueckfrage");
        expect(p.optionen).toHaveLength(2);
        expect(p.optionen[1]!.label).toContain("[[Inoffiziell:Alant]]");
        const g3 = lies(antwort(t, p, 1), welt);
        expect(g3.eintraege[0]).toMatchObject({ status: "ok", titel: "Inoffiziell:Alant" });
        expect(g3.zahlen.rueckfragen).toBe(0);
        // Aal in zwei Kategorien: die Regeln warten
        const g4 = lies("Aal\n| Verbreitung = [[See]]; [[Wald]]", welt);
        expect(g4.eintraege[0]!.probleme[0]!.art).toBe("rueckfrage");
        expect(g4.eintraege[0]!.regeln.every((r) => r.status === "rueckfrage" && r.wartet)).toBe(true);
        expect(g4.zahlen.rueckfragen).toBe(1);
        const g5 = lies(antwort("Aal\n| Verbreitung = [[See]]", g4.eintraege[0]!.probleme[0]!, 0), welt);
        expect(g5.eintraege[0]).toMatchObject({ status: "ok", kind: "fauna" });
        // gibt es nicht: neu anlegen oder ähnlicher Eintrag
        const g6 = lies("Sturmwurz (Flora)\n| Verbreitung = [[Wald]]", welt);
        expect(g6.eintraege[0]!.probleme[0]!.optionen[0]!.ersatz.text).toBe("Sturmwurz (Flora, neu)");
        const g7 = lies(antwort("Sturmwurz (Flora)\n| Verbreitung = [[Wald]]", g6.eintraege[0]!.probleme[0]!, 0), welt);
        expect(g7.eintraege[0]).toMatchObject({ neuAnlegen: true, status: "ok", id: null, kind: "flora" });
        expect(regel(g7).status).toBe("neu");
        expect(
            lies("Kajubu (Flora)", welt).eintraege[0]!.probleme[0]!.optionen.some(
                (o) => o.ersatz.text === "Kajubo (Flora)",
            ),
        ).toBe(true);
        // „, neu“ bei einem Eintrag, den es gibt: Rückfrage statt Doppelanlage
        const g8 = lies("Kajubo (Flora, neu)", welt);
        expect(g8.eintraege[0]!.probleme[0]!.art).toBe("rueckfrage");
        expect(g8.eintraege[0]!.probleme[0]!.optionen[0]!.ersatz.text).toBe("Kajubo (Flora)");
        // „Name (neu)“ ohne Kategorie fragt nach ihr; falsch geschriebene Kategorie bei bekanntem Namen
        expect(lies("Sturmwurz (neu)", welt).eintraege[0]!.probleme[0]!.optionen).toHaveLength(4);
        const g9 = lies("Alprute (Pflanze)\n| Verbreitung = [[Wald]]", welt);
        expect(g9.eintraege[0]!.probleme[0]!.art).toBe("fehler");
        expect(g9.eintraege[0]!.probleme[0]!.optionen.some((o) => o.ersatz.text === "Alprute (Flora)")).toBe(true);
        // zu langer Name für einen neuen Eintrag
        expect(lies(`${"N".repeat(301)} (Flora, neu)`, welt).eintraege[0]!.probleme[0]!.text).toContain("zu lang");
    });

    it("Rückfrage: Khom (drei Flächen), Aeltikan (doppelter Titel), Archipel (Name, Art und Ebene gleich) – die Antwort schreibt [[#Kennung|Name]] genau über den Link", () => {
        const t = R("[[Wüste]] in [[Khom]]");
        const g = lies(t, welt);
        const p = regel(g).probleme[0]!;
        expect(p.art).toBe("rueckfrage");
        expect(p.optionen).toHaveLength(3);
        expect(ersetzt(t, p)).toBe("[[Khom]]");
        expect(p.optionen[0]!.label).toBe("Khôm (Wüste)");
        const neu = antwort(t, p, 0);
        expect(neu).toMatch(/in \[\[#b0000005\|Khôm\]\]$/u);
        expect(regel(lies(neu, welt)).status).toBe("neu");
        const g2 = lies(R("[[Aeltikan]]"), welt);
        expect(regel(g2).probleme[0]!.optionen.map((o) => o.label)).toEqual([
            "Aeltikan (Tiefebene)",
            "Aeltikan (Inselgruppe)",
        ]);
        const g3 = lies(R("in [[Archipel der Perlen]]"), welt);
        expect(regel(g3).probleme[0]!.optionen.every((o) => /^\[\[#b[0-9a-f]{7}\|.+\]\]$/u.test(o.ersatz.text))).toBe(
            true,
        );
        expect(lies(antwort(R("in [[Archipel der Perlen]]"), regel(g3).probleme[0]!), welt).fehler).toEqual([]);
        // zwei Rückfragen in EINER Zeile: jede Antwort trifft ihre Stelle, der Rest der Zeile bleibt
        const t4 = R("[[Wüste]] in [[Khom]]: [[Wald]] in [[Aeltikan]] außer [[Steppe]]");
        const ps = lies(t4, welt).fehler;
        expect(ps).toHaveLength(2);
        expect(ersetzt(t4, ps[0]!)).toBe("[[Khom]]");
        expect(ersetzt(t4, ps[1]!)).toBe("[[Aeltikan]]");
        const t5 = antwort(t4, ps[1]!, 0);
        const g5 = lies(t5, welt);
        expect(g5.fehler).toHaveLength(1);
        const t6 = antwort(t5, g5.fehler[0]!, 2);
        expect(lies(t6, welt).fehler).toEqual([]);
        expect(t6.endsWith("außer [[Steppe]]")).toBe(true);
        expect(regel(lies(t6, welt)).bedingungen).toHaveLength(3);
    });
});

describe("Fehler mit der Stelle im Text", () => {
    it("Tippfehler mit Vorschlag: der Ersatz trifft genau den Link, danach ist der Text fehlerfrei", () => {
        const t = R("[[Wald]] oder [[Sumpf]]");
        const g = lies(t, welt);
        const p = g.fehler[0]!;
        expect(p.art).toBe("fehler");
        expect(p.zeile).toBe(1);
        expect(p.optionen[0]!.label).toBe("Sumpf → Sümpfe und Moore ersetzen");
        expect(ersetzt(t, p)).toBe("[[Sumpf]]");
        const neu = antwort(t, p);
        expect(neu.endsWith("[[Wald]] oder [[Sümpfe und Moore]]")).toBe(true);
        expect(lies(neu, welt).fehler).toEqual([]);
    });

    it("unbekannte Fläche: Vorschlag, „in“ weglassen; unbekannte Klimazone und Beziehung mit Vorschlag, der Ersatz trifft nur das Wort", () => {
        const t = R("in [[Aventurin]]");
        const p = lies(t, welt).fehler[0]!;
        expect(optText(p, 0)).toBe("[[Aventurien]]");
        expect(ersetzt(t, p, 0)).toBe("[[Aventurin]]");
        // „Als wartend schreiben“ gibt es nur, wo der Eintrag auf den Artikel wartet
        expect(p.optionen.some((o) => o.label === "Als wartend schreiben")).toBe(false);
        const t2 = R("in [[Kaiserwal]]");
        expect(lies(t2, welt).fehler[0]!.optionen.some((o) => o.label === "Als wartend schreiben")).toBe(false);
        const t3 = R("Klima boreal bis tropish");
        const g3 = lies(t3, welt);
        expect(optText(g3.fehler[0]!)).toBe("Tropische Zone");
        expect(ersetzt(t3, g3.fehler[0]!)).toBe("tropish");
        expect(regel(lies(antwort(t3, g3.fehler[0]!), welt)).status).toBe("neu");
        const t4 = `${KOPF}| Verbreitng = [[Tundra]]`;
        const g4 = lies(t4, welt);
        expect(optText(g4.fehler[0]!)).toBe("Verbreitung");
        expect(ersetzt(t4, g4.fehler[0]!)).toBe("Verbreitng");
        expect(regel(lies(antwort(t4, g4.fehler[0]!), welt)).status).toBe("neu");
    });

    it("„ohne“ → „außer“, „und“ → „:“, „oder“ zwischen Art und Fläche → „,“; jede Antwort macht die Regel neu", () => {
        const t = R("[[Wald]] ohne [[Steppe]]");
        const p = regel(lies(t, welt)).probleme[0]!;
        expect(optText(p)).toBe("außer");
        expect(ersetzt(t, p)).toBe("ohne");
        const g2 = lies(antwort(t, p), welt);
        expect(regel(g2).status).toBe("neu");
        expect(regel(g2).bedingungen[1]!.v).toBe("ohne");
        const t3 = R("[[Wald]] und Klima polar");
        const p3 = regel(lies(t3, welt)).probleme[0]!;
        expect(optText(p3)).toBe(":");
        expect(regel(lies(antwort(t3, p3), welt)).bedingungen[1]!.v).toBe("und");
        const t4 = R("[[Wald]] oder [[Aventurien]]");
        const g4 = lies(t4, welt);
        const nr = g4.fehler[0]!.optionen.findIndex((o) => o.ersatz.text === ",");
        expect(nr).toBeGreaterThanOrEqual(0);
        expect(regel(lies(antwort(t4, g4.fehler[0]!, nr), welt)).bedingungen[1]!.v).toBe("oder");
    });

    it("Teile doppelt, leere Regeln und Glieder, fehlendes „=“, offene Zeichen, Wörter ohne [[…]]", () => {
        const g = lies(
            `${KOPF}| Verbreitung = [[Wald]] [[Steppe]]\n| Herkunft = [[Aventurien]] in [[Aventurien]]\n| Regionen = Klima polar Klima boreal`,
            welt,
        );
        expect(
            g.eintraege[0]!.regeln.every(
                (r) => r.status === "fehler" && r.probleme.some((p) => p.text.includes("zweimal")),
            ),
        ).toBe(true);
        expect(regel(lies(R("[[Wald]] oder [[Wald]]"), welt)).probleme[0]!.text).toContain("zweimal");
        const g2 = lies(
            `${KOPF}| Verbreitung = Klima\n| Herkunft = Klima polar bis boreal bis tropisch\n| Regionen = Klima polar bis`,
            welt,
        );
        expect(g2.eintraege[0]!.regeln.every((r) => r.status === "fehler")).toBe(true);
        expect(regel(lies(`${KOPF}| Verbreitung [[Wald]]`, welt)).probleme[0]!.text).toContain("„=“");
        const g3 = lies(`${KOPF}| Verbreitung =\n| Herkunft = [[Wald]]; ; [[Steppe]]\n| Regionen = [[Wald]];`, welt);
        expect(g3.eintraege[0]!.regeln.map((r) => r.status)).toEqual([
            "fehler",
            "neu",
            "fehler",
            "neu",
            "neu",
            "fehler",
        ]);
        const g4 = lies(
            `${KOPF}| Verbreitung = [[Wald]], , [[Steppe]]\n| Herkunft = [[Wald]]:\n| Regionen = außer [[Wald]]`,
            welt,
        );
        expect(g4.eintraege[0]!.regeln.every((r) => r.status === "fehler")).toBe(true);
        expect(g4.fehler[2]!.text).toContain("beginnt nicht mit „außer“");
        const g5 = lies(`${KOPF}| Verbreitung = Klma polar\n| Herkunft = [[Wald\n| Regionen = [[Wald]] (häufig`, welt);
        expect(g5.eintraege[0]!.regeln.every((r) => r.status === "fehler")).toBe(true);
        expect(optText(regel(g5).probleme[0]!)).toBe("Klima");
        expect(regel(lies(R("in Aventurien"), welt)).status).toBe("fehler");
    });

    it("eine unbekannte Beziehung macht auch die weiteren Regeln der Zeile zu Fehlern (die Zeile ist nicht lesbar)", () => {
        const g = lies(`${KOPF}| Verbreitng = [[Wald]]; [[Steppe]]`, welt);
        expect(g.eintraege[0]!.regeln.map((r) => r.status)).toEqual(["fehler", "fehler"]);
        expect(g.eintraege[0]!.regeln.every((r) => r.fingerabdruck === null)).toBe(true);
    });

    it("höchstens 25 Bedingungen je Regel und 50 Regeln je Eintrag", () => {
        const g = lies(
            `${KOPF}| Verbreitung = [[Wald]]${", [[Steppe]]".repeat(24)}\n| Herkunft = [[Wald]]${", [[Steppe]]".repeat(25)}`,
            welt,
        );
        expect(regel(g, 0, 0).status).toBe("neu");
        expect(regel(g, 0, 0).bedingungen).toHaveLength(25);
        expect(regel(g, 0, 1).status).toBe("fehler");
        expect(g.fehler.some((p) => p.text.includes("25 Bedingungen"))).toBe(true);
        const viele =
            KOPF +
            Array.from(
                { length: 26 },
                (_, i) =>
                    `| Verbreitung = [[Wald]] Klima ${["polar", "subpolar", "boreal", "gemäßigt"][i % 4]!} in [[Kaiserwald]] (wartet); [[Steppe]] in [[Aventurien]]`,
            ).join("\n");
        const g2 = lies(viele, welt);
        expect(g2.eintraege[0]!.regeln).toHaveLength(52);
        expect(g2.fehler.some((p) => p.text.includes("50 Regeln"))).toBe(true);
        expect(g2.eintraege[0]!.regeln[49]!.status).not.toBe("fehler");
        expect(g2.eintraege[0]!.regeln[50]!.status).toBe("fehler");
    });

    it("lose Befunde: Regel ohne Kopf, Fortsetzung ohne Zeile davor", () => {
        const g = lies("| Verbreitung = [[Wald]]\n    , [[Steppe]]\nAlprute (Flora)\n    , [[Steppe]]", welt);
        expect(g.lose).toHaveLength(2);
        expect(g.lose[0]).toMatchObject({ zeile: 0 });
        expect(g.lose[0]!.text).toContain("Eintrag");
        expect(g.lose[1]).toMatchObject({ zeile: 3 });
        expect(g.lose[1]!.text).toContain("setzt keinen Ausdruck fort");
    });
});

describe("gibt es schon", () => {
    it("eine vorhandene Regel des Eintrags (Einbeere: Wald, Klima boreal bis gemäßigt) – Klimaenden in jeder Reihenfolge – ist „bestehend“, eine andere Beziehung ist neu", () => {
        const g = lies(
            "Vierblättrige Einbeere (Flora)\n| Verbreitung = [[Wald]] Klima gemäßigt bis boreal\n| Herkunft = [[Wald]] Klima boreal bis gemäßigt",
            welt,
        );
        expect(regel(g, 0, 0).status).toBe("schon");
        expect(regel(g, 0, 0).schon).toEqual({ grund: "bestehend" });
        expect(regel(g, 0, 1).status).toBe("neu");
    });

    it("eine frühere Regel im Text: Arten sortiert, Reihenfolge der Teile egal, auch über „;“; die Zeile der früheren steht dabei", () => {
        const g = lies(R("[[Wald]] oder [[Steppe]] Klima polar; Klima polar [[Steppe]] oder [[Wald]]"), welt);
        expect(regel(g, 0, 0).status).toBe("neu");
        expect(regel(g, 0, 1).status).toBe("schon");
        expect(regel(g, 0, 1).schon).toEqual({ grund: "stapel", zeile: 1 });
        // eine andere Beziehung ist neu, A–B ist B–A
        const g2 = lies(
            `${KOPF}| Verbreitung = südlich der Linie [[Havena]]–[[Perricum]]\n| Verbreitung = südlich der Linie [[Perricum]]–[[Havena]]\n| Herkunft = südlich der Linie [[Havena]]–[[Perricum]]`,
            welt,
        );
        expect(regel(g2, 0, 1).status).toBe("schon");
        expect(regel(g2, 0, 2).status).toBe("neu");
    });

    it("dieselbe Fläche über Wiki-Titel, Name und Kennung ist dieselbe Regel", () => {
        const g = lies(
            `${KOPF}| Verbreitung = in [[Aelderwald (Wald)]]; in [[Aelderwald]]; in [[#${anfang(F.aelderwald.id)}|Aelderwald]]`,
            welt,
        );
        expect(g.eintraege[0]!.regeln.map((r) => r.status)).toEqual(["neu", "schon", "schon"]);
    });

    it("zwei Köpfe desselben Eintrags teilen den Stapel", () => {
        const g = lies("Alprute (Flora)\n| Verbreitung = [[Wald]]\nAlprute (Flora)\n| Verbreitung = [[Wald]]", welt);
        expect(g.eintraege[0]!.regeln[0]!.status).toBe("neu");
        expect(g.eintraege[1]!.regeln[0]!.status).toBe("schon");
        expect(g.eintraege[1]!.regeln[0]!.schon).toEqual({ grund: "stapel", zeile: 1 });
    });

    it("eine Regel aus Legacy mit anderem gespeichertem Fingerabdruck gilt über die gerechnete Kette trotzdem als „bestehend“", () => {
        const g = lies(`Bremse (Fauna)\n| Vorkommen = in [[Aventurien]]`, welt);
        expect(regel(g).status).toBe("schon");
    });

    it("eine stillgelegte Fläche: die vorhandene Regel des Eintrags ist lesbar („bestehend“), eine neue Regel mit ihr ein Fehler", () => {
        const a = anfang(F.altoum.id);
        const g = lies(`Kajubo (Flora)\n| Verbreitung = in [[#${a}|Altoum]], in [[Orkland]]`, welt);
        expect(regel(g).status).toBe("schon");
        expect(g.fehler).toEqual([]);
        const g2 = lies(`Kajubo (Flora)\n| Herkunft = [[Wald]] in [[#${a}|Altoum]]`, welt);
        expect(regel(g2).status).toBe("fehler");
        expect(g2.fehler[0]!.text).toBe("Fläche „Altoum“ ist stillgelegt.");
        // an einem anderen Eintrag nennt keine vorhandene Regel sie
        const g3 = lies(R(`in [[#${a}|Altoum]]`), welt);
        expect(regel(g3).status).toBe("fehler");
        expect(g3.fehler[0]!.text).toBe("Fläche „Altoum“ ist stillgelegt.");
    });

    it("Zahlen: Einträge · neu · gibt es schon · Rückfragen · Fehler", () => {
        const g = lies(
            "Alprute (Flora)\n| Verbreitung = [[Wald]]\n| Verbreitung = [[Wald]] oder [[Sumpf]]\n| Herkunft = [[Wald]]\nAal\n| Verbreitung = [[See]]\nVierblättrige Einbeere (Flora)\n| Verbreitung = [[Wald]] Klima boreal bis gemäßigt",
            welt,
        );
        expect(g.zahlen).toEqual({ eintraege: 3, neu: 2, schon: 1, rueckfragen: 1, fehler: 1 });
    });
});

/** Eine Bedingung der Kette in der Form des Lesemodells. */
const bed = (
    b: Partial<InhalteVorkommenBedingung> & { joinOp?: "und" | "oder" | "ohne" },
): InhalteVorkommenBedingung => ({ joinOp: "und", arten: [], ...b });

describe("Rückweg „Als Text“: derselbe Fingerabdruck wie der Schreiber", () => {
    it("die Schreibweise der Flächen: Titel|Name, Name, Kennung bei Doppeltem, „in“ bei Art-Namen, wartend mit „in“ und „(wartet)“", () => {
        const fl = (f: { id: string; name: string }) => ({ flaeche: { kennung: f.id, name: f.name } });
        const zeilen = schreibeRegelBlock(
            E.alprute,
            [
                { relation: "verbreitung", bedingungen: [bed(fl(F.see))] },
                { relation: "verbreitung", bedingungen: [bed(fl(F.meerNord))] },
                { relation: "verbreitung", bedingungen: [bed(fl(F.aelderwald))] },
                { relation: "verbreitung", bedingungen: [bed(fl(F.aeltikanEbene))] },
                { relation: "verbreitung", bedingungen: [bed(fl(F.reichsforst))] },
                { relation: "verbreitung", bedingungen: [bed({ wartetAuf: "Meer" })] },
                { relation: "verbreitung", bedingungen: [bed({ wartetAuf: "Kaiserwald" })] },
                {
                    relation: "verbreitung",
                    bedingungen: [bed({ ...fl(F.reichsforst), arten: [{ ebene: "vegetation", art: "wald" }] })],
                },
                { relation: "verbreitung", bedingungen: [bed(fl(F.griff))] },
                { relation: "verbreitung", bedingungen: [bed(fl(F.amboss))] },
            ],
            welt,
        )
            .split("\n")
            .map((z) => z.replace(/^\| Verbreitung = /u, ""));
        expect(zeilen[0]).toBe("Alprute (Flora)");
        expect(zeilen.slice(1)).toEqual([
            "in [[See]]",
            "in [[Perlenmeer|Meer]]",
            "[[Aelderwald (Wald)|Aelderwald]]",
            `[[#${anfang(F.aeltikanEbene.id)}|Aeltikan]]`,
            "[[Reichsforst]]",
            "in [[Meer]] (wartet)",
            "[[Kaiserwald]] (wartet)",
            "[[Wald]] in [[Reichsforst]]",
            `[[#${anfang(F.griff.id)}|Wald-925]]`,
            "[[Amboss, Ost-Massiv]]",
        ]);
    });

    it("der Kopf trägt den Wiki-Titel bei gleichnamigen Einträgen derselben Kategorie, sonst nicht", () => {
        expect(schreibeRegelBlock(E.alantNeu, [], welt)).toBe("Alant (Flora, [[Inoffiziell:Alant]])");
        expect(schreibeRegelBlock(E.aalFauna, [], welt)).toBe("Aal (Fauna)");
        expect(
            schreibeRegelBlock(
                E.einbeere,
                [
                    {
                        relation: "verbreitung",
                        bedingungen: [
                            bed({
                                arten: [{ ebene: "vegetation", art: "wald" }],
                                klima: { von: "gemaessigt", bis: "boreal" },
                            }),
                        ],
                    },
                ],
                welt,
            ),
        ).toBe("Vierblättrige Einbeere (Flora)\n| Verbreitung = [[Wald]] Klima Boreale Zone bis Gemäßigte Zone");
    });

    it("jede vorhandene Regel der Testwelt wird als Text gelesen und ist dann „bestehend“ (auch mit stillgelegter und mit wartender Fläche)", () => {
        for (const e of [E.einbeere, E.kajubo, E.alprute, E.bremse]) {
            const regeln = welt.regelnVon(e.id);
            const text = schreibeRegelBlock(e, regeln, welt);
            const g = lies(text, welt);
            expect(g.eintraege, text).toHaveLength(1);
            expect(g.eintraege[0]!.status, text).toBe("ok");
            expect(
                g.eintraege[0]!.regeln.map((r) => r.status),
                text,
            ).toEqual(regeln.map(() => "schon"));
            expect(g.fehler, text).toEqual([]);
        }
    });

    it("🔴 Eigenschaft: eine Kette als Text und zurück gibt denselben Fingerabdruck wie der Schreiber (UND/ODER/OHNE, Arten, Fläche, Klima, Lage)", () => {
        let a = 20261031;
        const rnd = (): number => {
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const wahl = <T>(liste: readonly T[]): T => liste[Math.floor(rnd() * liste.length)]!;
        const alleFlaechen = [
            F.aventurien,
            F.meridiana,
            F.orkland,
            F.aelderwald,
            F.khomWueste,
            F.aeltikanInseln,
            F.meerNord,
            F.meerSued,
            F.see,
            F.perlen1,
            F.reichsforst,
            F.amboss,
            F.griff,
        ];
        const alleOrte = Object.values(O);
        const arten = [
            { ebene: "vegetation", art: "wald" },
            { ebene: "vegetation", art: "suempfe_moore" },
            { ebene: "topographie", art: "gebirge" },
            { ebene: "topographie", art: "meer" },
            { ebene: "topographie", art: "see" },
            { ebene: "derographisch", art: "region" },
        ];
        const zonen = [
            "polar",
            "subpolar",
            "boreal",
            "gemaessigt",
            "subtropen_winterfeucht",
            "trockene_subtropen",
            "subtropisch",
            "tropisch",
        ];
        const baue = (erste: boolean): InhalteVorkommenBedingung => {
            for (;;) {
                const b: InhalteVorkommenBedingung = {
                    joinOp: erste ? "und" : wahl(["und", "oder", "ohne"] as const),
                    arten: [],
                };
                if (rnd() < 0.5) b.arten = arten.filter(() => rnd() < 0.35).slice(0, 3);
                const f = rnd();
                if (f < 0.45) {
                    const x = wahl(alleFlaechen);
                    b.flaeche = { kennung: x.id, name: x.name };
                } else if (f < 0.55) b.wartetAuf = "Kaiserwald";
                if (rnd() < 0.4) {
                    const i = Math.floor(rnd() * zonen.length);
                    const j = Math.min(zonen.length - 1, i + Math.floor(rnd() * 3));
                    b.klima = { von: zonen[i]!, bis: zonen[j]! };
                }
                if (rnd() < 0.35) {
                    const eins = wahl(alleOrte);
                    const zwei = rnd() < 0.5 ? wahl(alleOrte.filter((o) => o.id !== eins.id)) : undefined;
                    const orte = [eins, ...(zwei === undefined ? [] : [zwei])].map((o) => ({
                        kennung: o.id,
                        name: o.name,
                        x: o.x,
                        y: o.y,
                    }));
                    b.lage = { richtung: wahl(["nord", "sued", "ost", "west"] as const), orte };
                }
                // eine Bedingung braucht mindestens einen Teil
                if (
                    b.arten.length > 0 ||
                    b.flaeche !== undefined ||
                    b.wartetAuf !== undefined ||
                    b.klima !== undefined ||
                    b.lage !== undefined
                )
                    return b;
            }
        };
        let geprueft = 0;
        for (let i = 0; i < 400; i++) {
            const kette = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) => baue(k === 0));
            const text = schreibeRegelBlock(
                E.alprute,
                [{ relation: wahl(["verbreitung", "herkunft", "vorkommen"] as const), bedingungen: kette }],
                welt,
            );
            const g = lies(text, welt);
            const r = regel(g);
            expect(
                g.fehler.map((p) => p.text),
                text,
            ).toEqual([]);
            // Alprute hat eine wartende Regel in „herkunft“; alles andere ist neu
            const erwartet = schluesselAusVertrag(eintragsSchluessel(E.alprute), r.relation!, kette);
            expect(r.fingerabdruck, text).toBe(erwartet);
            expect(r.status, text).toBe("neu");
            geprueft += 1;
        }
        expect(geprueft).toBe(400);
    });
});

describe("Plan, Rest und Ergebnis", () => {
    const TEXT = [
        "# Stapel aus dem Buch",
        "Quelle: [[Geographia Aventurica]], S. 12",
        "Alprute (Flora)",
        "| Verbreitung = [[Wald]]; [[Gebirge]] außer [[Nirgendwo]]",
        "| Herkunft = [[Wald]]",
        "",
        "Kajubo (Flora)",
        `| Verbreitung = in [[#${anfang(F.altoum.id)}|Altoum]], in [[Orkland]]`,
        "",
        "Quelle: –",
        "Sturmwurz (Flora, neu)",
        "| Verbreitung = [[Tundra]]",
        "Aal",
        "| Verbreitung = [[See]]",
    ].join("\n");

    it("der Plan zählt auch den Eintrag, der angelegt wird; eine Quelle, die der Eintrag schon nennt, zählt nicht", () => {
        const g = lies(TEXT, welt);
        const plan = bauePlan(g, welt);
        expect(plan.zahlen).toEqual({ regeln: 3, eintraege: 2, quellen: 1, anlegen: 1 });
        expect(plan.eintraege.map((p) => [p.name, p.neuAnlegen, p.regeln.length, p.quellen.length])).toEqual([
            ["Alprute", false, 2, 1],
            ["Kajubo", false, 0, 0],
            ["Sturmwurz", true, 1, 0],
        ]);
        // Kajubo: Die Regel gibt es schon, seine Quelle (Geographia) auch
        expect(g.eintraege[1]!.regeln[0]!.status).toBe("schon");
    });

    it("der Rest: Übernommenes, Vorhandenes, fertige Köpfe und Quellen entfallen; offene Regeln einer Zeile bleiben in einer neu geschriebenen Zeile; Rückfragen bleiben; Leerzeilen zusammengezogen", () => {
        const g = lies(TEXT, welt);
        expect(restText(TEXT, g)).toBe(
            [
                "# Stapel aus dem Buch",
                "Quelle: [[Geographia Aventurica]], S. 12",
                "Alprute (Flora)",
                "| Verbreitung = [[Gebirge]] außer [[Nirgendwo]]",
                "",
                // Die Quelle gilt weiter für Alprute; ihr Ende bleibt dabei, sonst fiele Aal darunter.
                "Quelle: –",
                "Aal",
                "| Verbreitung = [[See]]",
            ].join("\n"),
        );
    });

    it("der Rest einer Zeile mit Fortsetzung: Bleibt eine Regel offen, steht sie in einer Zeile; der Rest hat nur \\n", () => {
        const t = `${KOPF}| Verbreitung = [[Wald]];\r\n    [[Gebirge]]\r\n    außer [[Nirgendwo]]\r\n`;
        const g = lies(t, welt);
        expect(restText(t, g)).toBe(
            `${KOPF}| Verbreitung = [[Gebirge]]\n    außer [[Nirgendwo]]`.replace("\n    außer", "\n    außer"),
        );
    });

    it("ist alles erledigt, bleibt nichts (auch nicht die Quelle und das ausdrückliche Ende); ein leerer Text bleibt leer", () => {
        const t = "Quelle: [[Geographia Aventurica]]\nAlprute (Flora)\n| Verbreitung = [[Wald]]\nQuelle: –\n\n";
        expect(restText(t, lies(t, welt))).toBe("");
        expect(restText("", lies("", welt))).toBe("");
        expect(lies("", welt).zahlen).toEqual({ eintraege: 0, neu: 0, schon: 0, rueckfragen: 0, fehler: 0 });
    });

    it("das Ergebnis passt zum Schema des Vertrags (Einträge, Quellen, Regeln mit Kette, Rückfragen mit Antworten, lose Befunde)", () => {
        const text = `${TEXT}\nQuelle: [[Geographia Aventuric]]\n| Verbreitung = [[Wald]]\n    , [[Steppe]]\n${R("nördlich von [[Calladun]]: [[Wald]] in [[Kaiserwald]] (wartet)")}`;
        const { ergebnis } = pruefeText(text, welt);
        expect([...Value.Errors(InhalteRegelTextErgebnis, ergebnis)].map((e) => `${e.path}: ${e.message}`)).toEqual([]);
        expect(ergebnis.zahlen.eintraege).toBe(5);
        expect(ergebnis.lose.length).toBeGreaterThan(0);
        // sortiert nach Zeile
        expect(ergebnis.lose.map((p) => p.zeile)).toEqual([...ergebnis.lose.map((p) => p.zeile)].sort((x, y) => x - y));
        // eine lesbare Regel trägt ihre Kette in der Form des Lesemodells, eine unlesbare nicht
        const alprute = ergebnis.eintraege[0]!;
        expect(alprute.regeln[0]!.bedingungen).toEqual([
            { joinOp: "und", arten: [{ ebene: "vegetation", art: "wald" }] },
        ]);
        expect(alprute.regeln[1]!.bedingungen).toBeUndefined();
        expect(alprute.quelle).toMatchObject({
            titel: "Geographia Aventurica",
            seiten: "12",
            status: "ok",
            kennung: Q.geographia.id,
            vorhanden: false,
        });
        expect(ergebnis.eintraege[1]!.quelle).toMatchObject({ vorhanden: true });
        expect(ergebnis.eintraege[2]!).toMatchObject({ neuAnlegen: true, kategorie: "flora", name: "Sturmwurz" });
        expect(ergebnis.eintraege[2]!.kennung).toBeUndefined();
        const lage = ergebnis.eintraege.at(-1)!.regeln[0]!;
        expect(lage.status).toBe("rueckfrage");
        expect(lage.probleme[0]!.optionen).toHaveLength(2);
    });

    it("eine lesbare Regel mit Lage und wartender Fläche trägt Orte mit Name und Stelle und den gespeicherten Titel", () => {
        const { ergebnis } = pruefeText(R("nördlich von [[Havena]]: [[Wald]] in [[Kaiserwald]] (wartet)"), welt);
        expect([...Value.Errors(InhalteRegelTextErgebnis, ergebnis)]).toEqual([]);
        const b = ergebnis.eintraege[0]!.regeln[0]!.bedingungen!;
        expect(b[0]!.lage).toEqual({
            richtung: "nord",
            orte: [{ kennung: O.havena.id, name: "Havena", x: 150, y: 300 }],
        });
        expect(b[1]).toMatchObject({
            joinOp: "und",
            wartetAuf: "Kaiserwald",
            arten: [{ ebene: "vegetation", art: "wald" }],
        });
    });

    it("alsErgebnis und pruefeText rechnen dasselbe", () => {
        const gelesen = lies(TEXT, welt);
        const plan = bauePlan(gelesen, welt);
        expect(alsErgebnis(TEXT, gelesen, plan, welt)).toEqual(pruefeText(TEXT, welt).ergebnis);
    });
});

describe("Zufallstexte: keine Ausnahme, jeder Ersatz liegt in seiner Zeile und ergibt wieder einen lesbaren Text", () => {
    it("1500 Texte aus Bruchstücken der Schreibweise", () => {
        let a = 7;
        const rnd = (): number => {
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const stuecke = [
            "[[Wald]]",
            "[[Sumpf]]",
            "[[Khom]]",
            "[[Aeltikan]]",
            "[[Havena]]",
            "[[Calladun]]",
            `[[#${anfang(F.khomWueste.id)}|Khôm]]`,
            `[[#${anfang(F.altoum.id)}|Altoum]]`,
            "[[",
            "]]",
            "[[]]",
            "(wartet)",
            "(häufig)",
            "(",
            ")",
            ";",
            ",",
            ":",
            "außer",
            "ohne",
            "und",
            "oder",
            "in",
            "Klima",
            "polar",
            "bis",
            "boreal",
            "tropish",
            "nördlich",
            "nordöstlich",
            "von",
            "der",
            "Linie",
            "–",
            "-",
            "|",
            "=",
            "# x",
            "\n",
            "\n    ",
            "\n\t",
            "\n| Verbreitung = ",
            "\n| Herkunft =",
            "\n|",
            "\nAlprute (Flora)\n",
            "\nAal\n",
            "\nKajubu (Flora, neu)\n",
            "\nQuelle: [[Geographia Aventurica]], S. 3\n",
            "\nQuelle: [[Albernisches Briefspiel]]\n",
            "\nQuelle: –\n",
            "[[Kaiserwald]] (wartet)",
            "Klima",
        ];
        let probleme = 0;
        let optionen = 0;
        const schlecht: string[] = [];
        for (let i = 0; i < 1500; i++) {
            const text = Array.from(
                { length: 1 + Math.floor(rnd() * 14) },
                () => stuecke[Math.floor(rnd() * stuecke.length)]!,
            ).join(rnd() < 0.5 ? " " : "");
            try {
                const g = lies(text, welt);
                const zeilen = text.split(/\r?\n/u);
                const ergebnis = pruefeText(text, welt).ergebnis;
                if ([...Value.Errors(InhalteRegelTextErgebnis, ergebnis)].length > 0)
                    schlecht.push(`Schema: ${JSON.stringify(text)}`);
                for (const p of [...g.fehler, ...g.lose]) {
                    probleme += 1;
                    if (!(p.zeile >= 0 && p.zeile < zeilen.length)) {
                        schlecht.push(`Zeile ${String(p.zeile)} liegt nicht im Text: ${JSON.stringify(text)}`);
                        continue;
                    }
                    for (const o of p.optionen) {
                        optionen += 1;
                        const s = o.ersatz;
                        const z = zeilen[s.zeile];
                        if (z === undefined || !(s.von >= 0 && s.von <= s.bis && s.bis <= z.length)) {
                            schlecht.push(`Ersatz außerhalb der Zeile (${JSON.stringify(s)}): ${JSON.stringify(text)}`);
                            continue;
                        }
                        const kopie = [...zeilen];
                        kopie[s.zeile] = z.slice(0, s.von) + s.text + z.slice(s.bis);
                        lies(kopie.join("\n"), welt);
                    }
                }
            } catch (fehler) {
                schlecht.push(`Ausnahme ${(fehler as Error).message}: ${JSON.stringify(text)}`);
            }
        }
        expect(schlecht.slice(0, 3)).toEqual([]);
        expect(probleme).toBeGreaterThan(500);
        expect(optionen).toBeGreaterThan(200);
    });
});
