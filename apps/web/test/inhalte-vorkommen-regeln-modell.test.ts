import { beforeEach, describe, expect, it } from "vitest";
import type {
    InhalteVorkommen,
    InhalteVorkommenBedingung,
    InhalteVorkommenRegel,
    InhalteVorkommenWikiVorschlag,
    WikisyncRegelBedingung,
    WikisyncRegelLage,
} from "@avesmaps3d/shared";
import { locale } from "../src/i18n/i18n.ts";
import { setzeLage, type EditorBedingung } from "../src/inhalte/inhalte-regel-lage.ts";
import { entwurfAlsKoerper, standAusVorkommen, zaehleAenderungen } from "../src/inhalte/inhalte-vorkommen-modell.ts";
import {
    aktiveRegeln,
    bedingungAusServer,
    bedingungLeer,
    ketteSchluessel,
    koerperBedingung,
    loescheRegel,
    neueBedingung,
    offeneVorschlaege,
    regelAenderungSchluessel,
    regelAenderungen,
    regelAusEditor,
    regelAusServer,
    regelSatz,
    regelSperre,
    regelStatus,
    regelWartet,
    stelleWikiHer,
    uebernimmVorschlag,
    uebertrageRegeln,
    wikiFassungZumHerstellen,
    wikiJetzt,
    type EntwurfRegel,
} from "../src/inhalte/inhalte-vorkommen-regeln-modell.ts";

/**
 * Die Rechnung der Regeln im Reiter „Vorkommen“ (WI-0254 `--weiter`, Regeleditor), ohne Vue: Aus dem Lesemodell des Servers wird ein Entwurf, aus dem Entwurf der Körper von `lore.update`.
 *
 * - **Soll:** Ändern heißt neu anlegen (`add` mit `ersetzt`), nie ein Eingriff in die alte; was der Entwurf nicht mehr trägt, geht als `remove`; eine Wiki-Regel, die jemand ändert, wird eine Regel von Hand
 *   mit ihrer Wiki-Fassung als Basis; ein Vorschlag des Wikis schreibt erst mit dem Speichern, und nur die nicht vorgewählten stehen als Karten da.
 * - **Problemfälle:** leere Felder im Körper (nie `null`: Fastifys ajv machte daraus 0 oder ""), eine Fläche, die es noch nicht gibt (`wartetAuf`), dieselbe Kette in dieselben Beziehung (der Server lehnte sie mit
 *   `regel_besteht` ab), zurück auf die alte Fassung (nichts ist geändert), mehrere Regeln, die ein Vorschlag ersetzt, ein Konflikt (409) mit „eigene anwenden“.
 * - **Erwartungsfälle:** der Fingerabdruck liest wie `ruleKeyOf` des Servers (Verknüpfung der ersten Bedingung zählt nicht, Arten sortiert, Fläche klein).
 * - **Lage zu einer Linie** (WI-0254): Eine Kette ohne Lage behält ihren Fingerabdruck Zeichen für Zeichen (sonst fänden `regel_besteht` und der Vergleich mit der Wiki-Fassung keine gespeicherte Regel mehr); mit
 *   Lage kommt ein sechstes Feld dazu (Orte klein und sortiert); eine Bedingung nur mit Lage ist gültig; eine halbe Lage sperrt „Regel übernehmen“ mit Nummer und erreicht nie den Körper.
 * Dass der Server den Körper annimmt, belegt `apps/server/test/inhalte-vorkommen-regeln.test.ts`.
 */

beforeEach(() => {
    locale.value = "de";
});

const FLAECHE_A = "0190c0a0-0000-7000-8000-00000000a001";
const schluessel = (n: number): string => n.toString(16).padStart(64, "0");

const bed = (teil: Partial<InhalteVorkommenBedingung> = {}): InhalteVorkommenBedingung => ({
    joinOp: "und",
    arten: [{ ebene: "vegetation", art: "wald" }],
    ...teil,
});

const regel = (n: number, teil: Partial<InhalteVorkommenRegel> = {}): InhalteVorkommenRegel => ({
    ruleId: String(n),
    relation: "verbreitung",
    ursprung: "wiki",
    state: "active",
    bedingungen: [bed()],
    ruleKey: schluessel(n),
    ...teil,
});

const wb = (teil: Partial<WikisyncRegelBedingung> = {}): WikisyncRegelBedingung => ({
    verknuepfung: "und",
    flaeche: null,
    arten: [{ ebene: "vegetation", art: "steppe" }],
    klima: null,
    woerter: ["Steppe"],
    rueckfragen: ["rand"],
    ...teil,
});

const GARETH = "0190c0a0-0000-7000-8000-00000000b001";
const HAVENA = "0190c0a0-0000-7000-8000-00000000b002";
const lageSued = (...kennungen: string[]): WikisyncRegelLage => ({
    richtung: "sued",
    orte: kennungen.map((kennung, i) => ({ kennung, name: i === 0 ? "Gareth" : "Havena", x: 400 + i * 100, y: 700 })),
});
/** Eine Bedingung nur mit Lage: „alles südlich von Gareth“. */
const nurLage = (lage: WikisyncRegelLage, teil: Partial<WikisyncRegelBedingung> = {}): WikisyncRegelBedingung =>
    wb({ arten: [], woerter: [], rueckfragen: [], lage, ...teil });

type VorschlagRegel = InhalteVorkommenWikiVorschlag["regeln"][number];
const vorschlagRegel = (teil: Partial<VorschlagRegel> = {}): VorschlagRegel => ({
    beziehung: "verbreitung",
    status: "geaendert",
    schluessel: schluessel(900),
    bedingungen: [wb()],
    teile: [],
    bisherIds: ["1"],
    aktuell: true,
    ...teil,
});
const vorschlag = (
    regeln: VorschlagRegel[],
    teil: Partial<InhalteVorkommenWikiVorschlag> = {},
): InhalteVorkommenWikiVorschlag => ({
    lauf: 1,
    am: null,
    veraltet: false,
    typ: "unvollstaendig",
    vorgewaehlt: false,
    sperre: null,
    original: [],
    regeln,
    ...teil,
});

const liste = (...regeln: InhalteVorkommenRegel[]): EntwurfRegel[] => regeln.map(regelAusServer);
const wald = (): WikisyncRegelBedingung => wb({ arten: [{ ebene: "vegetation", art: "wald" }] });
const eintrag = (regeln: InhalteVorkommenRegel[], wikiVorschlag?: InhalteVorkommenWikiVorschlag): InhalteVorkommen => ({
    id: "00000000-0000-4000-8000-0000000000aa",
    revision: 3,
    wikiKey: "aal",
    name: "Aal",
    art: "fauna",
    gruppe: null,
    lebensraum: null,
    synonyme: null,
    editorNote: null,
    ursprung: "wiki",
    herkunft: "legacy",
    aktiv: true,
    feldUrsprung: {},
    orte: [],
    regeln,
    quellen: [],
    ...(wikiVorschlag === undefined ? {} : { wikiVorschlag }),
});

describe("Aus dem Lesemodell", () => {
    it("liest eine Bedingung des Servers in die Form der Sätze: Fläche, wartende Fläche, Klima, Arten", () => {
        const b = bedingungAusServer(
            bed({
                joinOp: "oder",
                flaeche: { kennung: FLAECHE_A, name: "Aranien" },
                klima: { von: "boreal", bis: "gemaessigt" },
            }),
        );
        expect(b).toMatchObject({
            verknuepfung: "oder",
            flaeche: { name: "Aranien", kennung: FLAECHE_A, offen: false, titel: null, kandidat: null },
            klima: { von: "boreal", bis: "gemaessigt" },
            arten: [{ ebene: "vegetation", art: "wald" }],
            woerter: [],
            rueckfragen: [],
        });
        const wartet = bedingungAusServer(bed({ wartetAuf: "Mhanadistan" }));
        expect(wartet.flaeche).toEqual({
            name: "Mhanadistan",
            kennung: null,
            offen: true,
            titel: "Mhanadistan",
            kandidat: null,
        });
        expect(regelWartet({ bedingungen: [wartet] })).toBe(true);
        expect(regelWartet({ bedingungen: [b] })).toBe(false);
    });

    it("🔴 die Lage des Servers kommt mit Richtung, Orten, Namen und Stellen in die Bedingung; ohne Lage fehlt das Feld", () => {
        const lage = lageSued(GARETH, HAVENA);
        const mit = bedingungAusServer(bed({ arten: [], lage }));
        expect(mit.lage).toEqual(lage);
        // Eine Kopie, nicht dieselbe Liste.
        expect(mit.lage?.orte).not.toBe(lage.orte);
        expect(bedingungAusServer(bed())).not.toHaveProperty("lage");
        // Die Regel trägt die Lage in ihre Kette und in ihren Fingerabdruck.
        const r = regelAusServer(regel(1, { bedingungen: [bed({ lage })] }));
        expect(r.bedingungen[0]?.lage).toEqual(lage);
        expect(ketteSchluessel(r.bedingungen)).toContain("sued:");
    });

    it("eine Fläche ohne Namen (die Kennung aus Legacy) nennt ihre Kennung, nie einen erfundenen Namen", () => {
        const b = bedingungAusServer(bed({ flaeche: { kennung: FLAECHE_A } }));
        expect(b.flaeche?.name).toBe("Fläche 0190c0a0");
        expect(b.flaeche?.kennung).toBe(FLAECHE_A);
    });

    it("🔴 der Stand trägt die Regeln mit Fingerabdruck, Basis und dem, was das Wiki seitdem sagt", () => {
        const stand = standAusVorkommen(
            eintrag([
                regel(1),
                regel(2, {
                    ursprung: "manual",
                    wikiBasis: { schluessel: schluessel(7), bedingungen: [wb()] },
                    wikiJetzt: {
                        schluessel: schluessel(8),
                        bedingungen: [wb({ rueckfragen: ["x"] })],
                        geaendert: true,
                    },
                }),
            ]),
        );
        expect(stand.regeln.map((r) => r.ruleId)).toEqual(["1", "2"]);
        expect(stand.regeln[0]).toMatchObject({ ruleKey: schluessel(1), neu: false, ersetzt: undefined });
        // Wörter und Rückfragen des Wikis gehören nicht in die Regel.
        expect(stand.regeln[1]?.wikiBasis?.bedingungen?.[0]?.rueckfragen).toEqual([]);
        expect(stand.regeln[1]?.wikiJetzt).toMatchObject({ geaendert: true });
        expect(regelStatus(stand.regeln[1]!)).toBe("");
    });
});

describe("Fingerabdruck der Kette", () => {
    it("liest wie ruleKeyOf: die Verknüpfung der ersten Bedingung zählt nicht, die Reihenfolge der Arten nicht, die der Bedingungen schon", () => {
        const a = wb({
            arten: [
                { ebene: "vegetation", art: "wald" },
                { ebene: "topographie", art: "gebirge" },
            ],
        });
        const b = wb({
            arten: [
                { ebene: "topographie", art: "gebirge" },
                { ebene: "vegetation", art: "wald" },
            ],
        });
        expect(ketteSchluessel([a])).toBe(ketteSchluessel([{ ...b, verknuepfung: "oder" }]));
        const x = wb({ flaeche: { name: "A", kennung: FLAECHE_A, offen: false, titel: null, kandidat: null } });
        const y = wb({ arten: [{ ebene: "vegetation", art: "wald" }] });
        expect(ketteSchluessel([x, { ...y, verknuepfung: "oder" }])).not.toBe(
            ketteSchluessel([{ ...y }, { ...x, verknuepfung: "oder" }]),
        );
        expect(ketteSchluessel([x, { ...y, verknuepfung: "oder" }])).not.toBe(
            ketteSchluessel([x, { ...y, verknuepfung: "ohne" }]),
        );
    });

    it("eine wartende Fläche steht unter wiki:<Titel klein>, eine vorhandene unter ihrer Kennung in Kleinbuchstaben", () => {
        const wartet = wb({
            flaeche: { name: "Mhanadistan", kennung: null, offen: true, titel: "Mhanadistan", kandidat: null },
        });
        expect(ketteSchluessel([wartet])).toContain("wiki:mhanadistan");
        const da = wb({
            flaeche: { name: "A", kennung: FLAECHE_A.toUpperCase(), offen: false, titel: null, kandidat: null },
        });
        expect(ketteSchluessel([da])).toContain(FLAECHE_A);
    });

    it("eine Bedingung ohne Art, Fläche, Klima und Lage ist leer", () => {
        expect(bedingungLeer(neueBedingung())).toBe(true);
        expect(bedingungLeer(wb())).toBe(false);
        expect(bedingungLeer(neueBedingung("oder"))).toBe(true);
        expect(bedingungLeer({ ...neueBedingung(), klima: { von: "polar", bis: "polar" } })).toBe(false);
        // „alles südlich von Gareth“ sagt etwas.
        expect(bedingungLeer({ ...neueBedingung(), lage: lageSued(GARETH) })).toBe(false);
    });

    it("🔴 Schlüssel ohne Lage unverändert: eine Kette ohne Lage behält ihren Fingerabdruck Zeichen für Zeichen (kein leeres sechstes Feld)", () => {
        const a = wb({ arten: [{ ebene: "vegetation", art: "wald" }] });
        // Die Folge der Felder: Verknüpfung (bei der ersten leer), Fläche, Klima von, Klima bis, Arten.
        expect(ketteSchluessel([a])).toBe('[["","","","",["vegetation/wald"]]]');
        const x = wb({
            arten: [],
            flaeche: { name: "A", kennung: FLAECHE_A, offen: false, titel: null, kandidat: null },
            klima: { von: "polar", bis: "boreal" },
        });
        expect(ketteSchluessel([a, { ...x, verknuepfung: "ohne" }])).toBe(
            `[["","","","",["vegetation/wald"]],["ohne","${FLAECHE_A}","polar","boreal",[]]]`,
        );
    });

    it("🔴 mit Lage kommt ein sechstes Feld dazu: Richtung und Orte, die Orte klein und sortiert (A–B ist B–A); eine andere Richtung oder ein anderer Ort ist eine andere Regel", () => {
        const ohne = wb({ arten: [{ ebene: "vegetation", art: "wald" }] });
        const mit = { ...ohne, lage: lageSued(GARETH.toUpperCase(), HAVENA) };
        expect(ketteSchluessel([mit])).toBe(`[["","","","",["vegetation/wald"],"sued:${GARETH},${HAVENA}"]]`);
        expect(ketteSchluessel([mit])).not.toBe(ketteSchluessel([ohne]));
        // A–B ist B–A, Groß und Klein gelten nicht.
        expect(ketteSchluessel([{ ...ohne, lage: lageSued(HAVENA, GARETH) }])).toBe(ketteSchluessel([mit]));
        // Eine andere Richtung, ein Ort mehr oder ein anderer Ort ändern den Schlüssel.
        expect(ketteSchluessel([{ ...ohne, lage: { ...lageSued(GARETH, HAVENA), richtung: "nord" } }])).not.toBe(
            ketteSchluessel([mit]),
        );
        expect(ketteSchluessel([{ ...ohne, lage: lageSued(GARETH) }])).not.toBe(ketteSchluessel([mit]));
        expect(ketteSchluessel([{ ...ohne, lage: lageSued(HAVENA) }])).not.toBe(
            ketteSchluessel([{ ...ohne, lage: lageSued(GARETH) }]),
        );
        // Die Namen und Stellen der Orte gehören nicht zur Identität.
        const umbenannt = {
            ...ohne,
            lage: {
                ...lageSued(GARETH.toUpperCase(), HAVENA),
                orte: lageSued(GARETH, HAVENA).orte.map((o) => ({ ...o, name: "X", x: 1, y: 2 })),
            },
        };
        expect(ketteSchluessel([umbenannt])).toBe(ketteSchluessel([mit]));
    });
});

describe("Der Körper einer Bedingung", () => {
    it("🔴 leere Felder fehlen, sie sind nie null; die Fläche geht als Kennung, die wartende als Titel", () => {
        const nur = koerperBedingung(wb());
        expect(Object.keys(nur).sort()).toEqual(["arten", "verknuepfung"]);
        expect(JSON.stringify(nur)).not.toContain("null");
        const mit = koerperBedingung(
            wb({
                flaeche: { name: "A", kennung: FLAECHE_A, offen: false, titel: "Aranien", kandidat: null },
                klima: { von: "polar", bis: "boreal" },
            }),
        );
        expect(mit).toEqual({
            verknuepfung: "und",
            arten: [{ ebene: "vegetation", art: "steppe" }],
            flaeche: FLAECHE_A,
            klima: { von: "polar", bis: "boreal" },
        });
        const wartet = koerperBedingung(
            wb({ flaeche: { name: "Mhana", kennung: null, offen: true, titel: "Mhanadistan", kandidat: "Mhana" } }),
        );
        expect(wartet).toMatchObject({ wartetAuf: "Mhanadistan" });
        expect(wartet).not.toHaveProperty("flaeche");
    });

    it("🔴 die Lage geht mit den Kennungen der Orte hinaus (klein), ohne Namen und Stellen; ohne Lage fehlt das Feld ganz", () => {
        const mit = koerperBedingung(nurLage(lageSued(GARETH.toUpperCase(), HAVENA)));
        expect(mit).toEqual({ verknuepfung: "und", arten: [], lage: { richtung: "sued", orte: [GARETH, HAVENA] } });
        expect(JSON.stringify(mit)).not.toContain("null");
        expect(koerperBedingung(wb())).not.toHaveProperty("lage");
        // Ein halber Stand des Editors erreicht den Körper nie: Er steht in `lageEntwurf`, und der Körper liest nur `lage`.
        const halb: EditorBedingung = setzeLage(wb(), { richtung: "sued", orte: [] });
        expect(halb.lageEntwurf).toBeDefined();
        expect(koerperBedingung(halb)).not.toHaveProperty("lage");
        expect(JSON.stringify(koerperBedingung(halb))).not.toContain("lageEntwurf");
    });
});

describe("Eine Regel anlegen und ändern", () => {
    it("🔴 eine neue Regel ist eine Regel von Hand, hinten angehängt; der Körper trägt sie als add ohne ersetzt und ohne Basis", () => {
        const start = standAusVorkommen(eintrag([regel(1)]));
        const regeln = regelAusEditor(start.regeln, { relation: "herkunft", bedingungen: [wald()] }, undefined);
        expect(regeln).toHaveLength(2);
        const neu = regeln[1]!;
        expect(neu).toMatchObject({ neu: true, ursprung: "manual", relation: "herkunft", ersetzt: undefined });
        expect(regelStatus(neu)).toBe("neu");
        expect(neu.bedingungen[0]).toMatchObject({ verknuepfung: "und", rueckfragen: [], woerter: [] });
        const koerper = entwurfAlsKoerper(start, { ...start, regeln });
        expect(koerper).toEqual({
            regeln: [
                {
                    op: "add",
                    relation: "herkunft",
                    bedingungen: [{ verknuepfung: "und", arten: [{ ebene: "vegetation", art: "wald" }] }],
                },
            ],
        });
        expect(zaehleAenderungen(start, { ...start, regeln })).toBe(1);
    });

    it("🔴 eine Wiki-Regel zu ändern legt eine Regel von Hand an, die die alte ablöst; die alte geht nicht zusätzlich als remove", () => {
        const start = standAusVorkommen(eintrag([regel(1), regel(2, { relation: "herkunft" })]));
        const regeln = regelAusEditor(
            start.regeln,
            {
                schluessel: "1",
                relation: "verbreitung",
                bedingungen: [
                    wb(),
                    { ...wb({ arten: [] }), verknuepfung: "ohne", klima: { von: "polar", bis: "polar" } },
                ],
            },
            undefined,
        );
        expect(regeln).toHaveLength(2);
        // An der Stelle der alten, mit der alten als `ersetzt`.
        expect(regeln[0]).toMatchObject({
            neu: true,
            ursprung: "manual",
            ersetzt: { ruleId: "1" },
            wikiBasis: { schluessel: schluessel(1) },
        });
        expect(regelStatus(regeln[0]!)).toBe("geaendert");
        const koerper = entwurfAlsKoerper(start, { ...start, regeln });
        expect(koerper?.regeln).toHaveLength(1);
        expect(koerper?.regeln?.[0]).toMatchObject({ op: "add", relation: "verbreitung", ersetzt: "1" });
        // Die Wiki-Fassung geht mit; der Server nimmt sie vor der ersetzten Regel (hier dieselbe).
        expect(koerper?.regeln?.[0]).toMatchObject({ wikiBasis: schluessel(1) });
    });

    it("dieselbe Kette in derselben Beziehung ist keine Änderung: dieselbe Liste, kein Körper", () => {
        const start = standAusVorkommen(eintrag([regel(1)]));
        const wieder = regelAusEditor(
            start.regeln,
            { schluessel: "1", relation: "verbreitung", bedingungen: [wald()] },
            undefined,
        );
        expect(wieder).toBe(start.regeln);
        expect(entwurfAlsKoerper(start, { ...start, regeln: wieder })).toBeUndefined();
    });

    it("🔴 wer eine geänderte Regel wieder auf die alte Kette stellt, hat nichts geändert: die gespeicherte Regel kommt zurück", () => {
        const start = standAusVorkommen(eintrag([regel(1)]));
        const geaendert = regelAusEditor(
            start.regeln,
            { schluessel: "1", relation: "verbreitung", bedingungen: [wb()] },
            undefined,
        );
        const neuSchluessel = geaendert[0]!.schluessel;
        const zurueck = regelAusEditor(
            geaendert,
            { schluessel: neuSchluessel, relation: "verbreitung", bedingungen: [wald()] },
            undefined,
        );
        expect(zurueck[0]).toBe(start.regeln[0]);
        expect(entwurfAlsKoerper(start, { ...start, regeln: zurueck })).toBeUndefined();
    });

    it("eine Regel von Hand, die auf dem Wiki beruht, behält ihre Basis; eine zweite Änderung löst die erste ab, nicht die gespeicherte", () => {
        const basis = { schluessel: schluessel(7), bedingungen: [wb()] };
        const start = standAusVorkommen(eintrag([regel(5, { ursprung: "manual", wikiBasis: basis })]));
        const eins = regelAusEditor(
            start.regeln,
            {
                schluessel: "5",
                relation: "verbreitung",
                bedingungen: [wb({ arten: [{ ebene: "topographie", art: "gebirge" }] })],
            },
            undefined,
        );
        expect(eins[0]?.wikiBasis?.schluessel).toBe(schluessel(7));
        const zwei = regelAusEditor(
            eins,
            {
                schluessel: eins[0]!.schluessel,
                relation: "verbreitung",
                bedingungen: [wb({ arten: [{ ebene: "topographie", art: "huegelland" }] })],
            },
            undefined,
        );
        expect(zwei).toHaveLength(1);
        expect(zwei[0]?.ersetzt?.ruleId).toBe("5");
        const koerper = entwurfAlsKoerper(start, { ...start, regeln: zwei });
        expect(koerper?.regeln).toHaveLength(1);
        expect(koerper?.regeln?.[0]).toMatchObject({ op: "add", ersetzt: "5" });
    });

    it("ist die geänderte Kette selbst die Wiki-Fassung (die Basis oder was das Wiki jetzt sagt), bleibt sie eine Wiki-Regel", () => {
        const basis = { schluessel: schluessel(7), bedingungen: [wb()] };
        const jetzt = {
            schluessel: schluessel(8),
            bedingungen: [wb({ arten: [{ ebene: "topographie", art: "gebirge" }] })],
            geaendert: true,
        };
        const start = standAusVorkommen(
            eintrag([
                regel(5, {
                    ursprung: "manual",
                    bedingungen: [bed({ arten: [], klima: { von: "polar", bis: "polar" } })],
                    wikiBasis: basis,
                    wikiJetzt: jetzt,
                }),
            ]),
        );
        const mitBasis = regelAusEditor(
            start.regeln,
            { schluessel: "5", relation: "verbreitung", bedingungen: [wb()] },
            undefined,
        );
        expect(mitBasis[0]).toMatchObject({ ursprung: "wiki", wikiBasis: undefined });
        const mitJetzt = regelAusEditor(
            start.regeln,
            { schluessel: "5", relation: "verbreitung", bedingungen: jetzt.bedingungen },
            undefined,
        );
        expect(mitJetzt[0]).toMatchObject({ ursprung: "wiki" });
    });

    it("eine andere Beziehung ist keine Fassung des Wikis mehr: die Regel verliert die Basis", () => {
        const basis = { schluessel: schluessel(7), bedingungen: [wb()] };
        const start = standAusVorkommen(eintrag([regel(5, { ursprung: "manual", wikiBasis: basis })]));
        const regeln = regelAusEditor(
            start.regeln,
            { schluessel: "5", relation: "herkunft", bedingungen: [wb()] },
            undefined,
        );
        expect(regeln[0]).toMatchObject({
            relation: "herkunft",
            ursprung: "manual",
            wikiBasis: undefined,
            ersetzt: { ruleId: "5" },
        });
    });

    it("die erste Bedingung hat immer UND, ein ODER davor wird nicht gespeichert", () => {
        const start = standAusVorkommen(eintrag([]));
        const regeln = regelAusEditor(
            start.regeln,
            {
                relation: "verbreitung",
                bedingungen: [
                    { ...wb(), verknuepfung: "oder" },
                    { ...wb({ klima: { von: "polar", bis: "polar" } }), verknuepfung: "ohne" },
                ],
            },
            undefined,
        );
        expect(regeln[0]?.bedingungen.map((b) => b.verknuepfung)).toEqual(["und", "ohne"]);
    });
});

describe("Löschen", () => {
    it("🔴 eine Regel des Servers geht als remove hinaus; eine neue verschwindet ohne Spur", () => {
        const start = standAusVorkommen(eintrag([regel(1), regel(2, { relation: "herkunft" })]));
        const ohne = loescheRegel(start.regeln, "1");
        expect(entwurfAlsKoerper(start, { ...start, regeln: ohne })).toEqual({
            regeln: [{ op: "remove", ruleId: "1" }],
        });
        const mit = regelAusEditor(start.regeln, { relation: "regionen", bedingungen: [wb()] }, undefined);
        const wieder = loescheRegel(mit, mit[2]!.schluessel);
        expect(entwurfAlsKoerper(start, { ...start, regeln: wieder })).toBeUndefined();
    });

    it("löscht man eine Regel, die eine alte ablöst, geht die alte als remove hinaus (und keine neue)", () => {
        const start = standAusVorkommen(eintrag([regel(1)]));
        const geaendert = regelAusEditor(
            start.regeln,
            { schluessel: "1", relation: "verbreitung", bedingungen: [wb()] },
            undefined,
        );
        const weg = loescheRegel(geaendert, geaendert[0]!.schluessel);
        expect(entwurfAlsKoerper(start, { ...start, regeln: weg })).toEqual({
            regeln: [{ op: "remove", ruleId: "1" }],
        });
    });

    it("eine Regel, die es nicht gibt, ändert nichts", () => {
        const start = standAusVorkommen(eintrag([regel(1)]));
        expect(loescheRegel(start.regeln, "99")).toBe(start.regeln);
    });

    it("🔴 erst weg, dann neu: Der Körper löscht vor dem Anlegen, damit derselbe Fingerabdruck die stille Zeile belebt statt zu kollidieren", () => {
        const start = standAusVorkommen(eintrag([regel(1), regel(2, { relation: "herkunft" })]));
        const ohne = loescheRegel(start.regeln, "1");
        const mit = regelAusEditor(ohne, { relation: "verbreitung", bedingungen: [wald()] }, undefined);
        const aenderungen = regelAenderungen(start.regeln, mit);
        expect(aenderungen.map((a) => a.op)).toEqual(["remove", "add"]);
    });

    it("stille Regeln des Servers bleiben unangetastet und gehen nie als remove hinaus", () => {
        const start = standAusVorkommen(eintrag([regel(1), regel(2, { state: "suppressed", relation: "herkunft" })]));
        expect(aktiveRegeln(start.regeln).map((r) => r.ruleId)).toEqual(["1"]);
        expect(regelAenderungen(start.regeln, start.regeln)).toEqual([]);
        expect(entwurfAlsKoerper(start, { ...start, regeln: loescheRegel(start.regeln, "1") })).toEqual({
            regeln: [{ op: "remove", ruleId: "1" }],
        });
    });
});

describe("Vorschläge des Wikis am Eintrag", () => {
    const eins = vorschlagRegel();

    it("🔴 es stehen nur die nicht vorgewählten, aktuellen Vorschläge mit Bedingungen da; der Sperrgrund „manuell“ nimmt sie alle", () => {
        const regeln = liste(regel(1));
        expect(offeneVorschlaege(vorschlag([eins]), regeln)).toHaveLength(1);
        expect(offeneVorschlaege(vorschlag([eins], { vorgewaehlt: true }), regeln)).toEqual([]);
        expect(offeneVorschlaege(vorschlag([eins], { sperre: "manuell" }), regeln)).toEqual([]);
        expect(offeneVorschlaege(vorschlag([eins], { sperre: "redaktion" }), regeln)).toHaveLength(1);
        expect(offeneVorschlaege(vorschlag([{ ...eins, aktuell: false }]), regeln)).toEqual([]);
        expect(offeneVorschlaege(vorschlag([{ ...eins, bedingungen: [] }]), regeln)).toEqual([]);
        expect(offeneVorschlaege(vorschlag([{ ...eins, status: "manuell" }]), regeln)).toEqual([]);
        expect(offeneVorschlaege(vorschlag([{ ...eins, status: "entfaellt", bedingungen: [] }]), regeln)).toEqual([]);
        expect(offeneVorschlaege(undefined, regeln)).toEqual([]);
    });

    it("ein Vorschlag nennt die Zahl der Bedingungen der Regel, die er ersetzt; ohne bisherige Regel nennt er keine", () => {
        const regeln = liste(
            regel(1, {
                bedingungen: [bed(), bed({ joinOp: "oder", arten: [{ ebene: "vegetation", art: "urwald" }] })],
            }),
        );
        expect(offeneVorschlaege(vorschlag([eins]), regeln)[0]?.ersetzt).toBe(2);
        expect(offeneVorschlaege(vorschlag([{ ...eins, status: "neu", bisherIds: [] }]), regeln)[0]?.ersetzt).toBe(0);
    });

    it("🔴 kein Vorschlag, wo die Beziehung schon eine Regel von Hand mit Wiki-Basis trägt (sie trägt die neue Fassung als Hinweis) oder eine Wiki-Regel mit genau dieser Kette", () => {
        const basis = { schluessel: schluessel(7), bedingungen: [wb()] };
        expect(offeneVorschlaege(vorschlag([eins]), liste(regel(1, { ursprung: "manual", wikiBasis: basis })))).toEqual(
            [],
        );
        const gleich = regel(1, { bedingungen: [bed({ arten: [{ ebene: "vegetation", art: "steppe" }] })] });
        expect(offeneVorschlaege(vorschlag([eins]), liste(gleich))).toEqual([]);
        // Eine andere Beziehung oder eine Regel von Hand ohne Basis hält ihn nicht auf.
        expect(offeneVorschlaege(vorschlag([eins]), liste(regel(1, { relation: "herkunft" })))).toHaveLength(1);
        expect(offeneVorschlaege(vorschlag([eins]), liste(regel(1, { ursprung: "manual" })))).toHaveLength(1);
    });

    it("🔴 „Übernehmen“ legt die Wiki-Regel an der Stelle der bisherigen an; der Vorschlag steht danach nicht mehr da; der Körper nennt die bisherige als ersetzt", () => {
        const wiki = vorschlag([eins]);
        const start = standAusVorkommen(eintrag([regel(1), regel(2, { relation: "herkunft" })], wiki));
        const regeln = uebernimmVorschlag(start.regeln, wiki, 0);
        expect(regeln).toHaveLength(2);
        expect(regeln[0]).toMatchObject({
            neu: true,
            ursprung: "wiki",
            ruleKey: schluessel(900),
            ersetzt: { ruleId: "1" },
            wikiBasis: undefined,
        });
        expect(regeln[0]?.bedingungen[0]).toMatchObject({ rueckfragen: [], woerter: [] });
        expect(offeneVorschlaege(wiki, regeln)).toEqual([]);
        const koerper = entwurfAlsKoerper(start, { ...start, regeln });
        expect(koerper?.regeln).toEqual([
            {
                op: "add",
                relation: "verbreitung",
                bedingungen: [{ verknuepfung: "und", arten: [{ ebene: "vegetation", art: "steppe" }] }],
                ersetzt: "1",
            },
        ]);
    });

    it("ein Vorschlag für eine Beziehung ohne Regel hängt eine Regel an und ersetzt nichts", () => {
        const wiki = vorschlag([vorschlagRegel({ beziehung: "herkunft", status: "neu", bisherIds: [] })]);
        const start = standAusVorkommen(eintrag([regel(1)], wiki));
        const regeln = uebernimmVorschlag(start.regeln, wiki, 0);
        expect(regeln).toHaveLength(2);
        expect(regeln[1]).toMatchObject({ ursprung: "wiki", relation: "herkunft", ersetzt: undefined });
        expect(entwurfAlsKoerper(start, { ...start, regeln })?.regeln).toHaveLength(1);
    });

    it("ersetzt ein Vorschlag mehrere Regeln, löst er die erste ab und löscht die übrigen", () => {
        const wiki = vorschlag([vorschlagRegel({ bisherIds: ["1", "3"] })]);
        const start = standAusVorkommen(eintrag([regel(1), regel(2, { relation: "herkunft" }), regel(3)], wiki));
        const regeln = uebernimmVorschlag(start.regeln, wiki, 0);
        expect(regeln.map((r) => r.neu)).toEqual([true, false]);
        const aenderungen = entwurfAlsKoerper(start, { ...start, regeln })?.regeln ?? [];
        expect(aenderungen.map((a) => a.op)).toEqual(["remove", "add"]);
        expect(aenderungen[0]).toEqual({ op: "remove", ruleId: "3" });
        expect(aenderungen[1]).toMatchObject({ op: "add", ersetzt: "1" });
    });

    it("🔴 „Bearbeiten“ eines Vorschlags: unverändert eine Wiki-Regel, verändert eine Regel von Hand, die auf der bisherigen Wiki-Regel beruht", () => {
        const wiki = vorschlag([eins]);
        const start = standAusVorkommen(eintrag([regel(1)], wiki));
        const unveraendert = regelAusEditor(
            start.regeln,
            { vorschlag: 0, relation: "verbreitung", bedingungen: eins.bedingungen },
            wiki,
        );
        expect(unveraendert[0]).toMatchObject({ ursprung: "wiki", ersetzt: { ruleId: "1" } });
        const veraendert = regelAusEditor(
            start.regeln,
            {
                vorschlag: 0,
                relation: "verbreitung",
                bedingungen: [wb({ klima: { von: "boreal", bis: "gemaessigt" } })],
            },
            wiki,
        );
        expect(veraendert[0]).toMatchObject({
            ursprung: "manual",
            ersetzt: { ruleId: "1" },
            wikiBasis: { schluessel: schluessel(1) },
        });
        // Der Vorschlag ist erledigt: Die Regel von Hand trägt die Basis.
        expect(offeneVorschlaege(wiki, veraendert)).toEqual([]);
    });

    it("🔴 ein bearbeiteter Vorschlag ohne bisherige Regel nennt den Fingerabdruck des Vorschlags als wikiBasis im Körper", () => {
        const wiki = vorschlag([vorschlagRegel({ beziehung: "regionen", status: "neu", bisherIds: [] })]);
        const start = standAusVorkommen(eintrag([], wiki));
        const regeln = regelAusEditor(
            start.regeln,
            { vorschlag: 0, relation: "regionen", bedingungen: [wb({ klima: { von: "polar", bis: "polar" } })] },
            wiki,
        );
        expect(regeln[0]).toMatchObject({
            ursprung: "manual",
            ersetzt: undefined,
            wikiBasis: { schluessel: schluessel(900) },
        });
        expect(entwurfAlsKoerper(start, { ...start, regeln })?.regeln?.[0]).toMatchObject({
            op: "add",
            relation: "regionen",
            wikiBasis: schluessel(900),
        });
        // Ein Fingerabdruck, der keiner ist, geht nicht hinaus.
        const kaputt = vorschlag([
            vorschlagRegel({ beziehung: "regionen", status: "neu", bisherIds: [], schluessel: "kurz" as never }),
        ]);
        const r2 = regelAusEditor(
            start.regeln,
            { vorschlag: 0, relation: "regionen", bedingungen: [wb({ klima: { von: "polar", bis: "polar" } })] },
            kaputt,
        );
        expect(entwurfAlsKoerper(start, { ...start, regeln: r2 })?.regeln?.[0]).not.toHaveProperty("wikiBasis");
    });

    it("ein Vorschlag, den es nicht gibt, ändert nichts", () => {
        const start = standAusVorkommen(eintrag([regel(1)]));
        expect(uebernimmVorschlag(start.regeln, undefined, 0)).toBe(start.regeln);
        expect(uebernimmVorschlag(start.regeln, vorschlag([eins]), 5)).toBe(start.regeln);
    });
});

describe("Die Wiki-Fassung wiederherstellen", () => {
    const basis = { schluessel: schluessel(7), bedingungen: [wb()] };
    const jetzt = {
        schluessel: schluessel(8),
        bedingungen: [wb({ arten: [{ ebene: "topographie", art: "gebirge" }] })],
        geaendert: true,
    };

    it("🔴 hat das Wiki sich geändert, holt „↺ Wiki-Fassung“ die neue; die Regel von Hand weicht ihr und wird eine Wiki-Regel", () => {
        const start = standAusVorkommen(
            eintrag([regel(5, { ursprung: "manual", wikiBasis: basis, wikiJetzt: jetzt })]),
        );
        const regeln = stelleWikiHer(start.regeln, "5", undefined);
        expect(regeln).toHaveLength(1);
        expect(regeln[0]).toMatchObject({
            neu: true,
            ursprung: "wiki",
            wikiBasis: undefined,
            ersetzt: { ruleId: "5" },
        });
        expect(regeln[0]?.bedingungen[0]?.arten).toEqual([{ ebene: "topographie", art: "gebirge" }]);
        expect(entwurfAlsKoerper(start, { ...start, regeln })?.regeln).toEqual([
            {
                op: "add",
                relation: "verbreitung",
                bedingungen: [{ verknuepfung: "und", arten: [{ ebene: "topographie", art: "gebirge" }] }],
                ersetzt: "5",
            },
        ]);
    });

    it("hat das Wiki sich nicht geändert, holt es die Fassung, auf der die Regel beruht", () => {
        const start = standAusVorkommen(
            eintrag([
                regel(5, {
                    ursprung: "manual",
                    wikiBasis: basis,
                    wikiJetzt: { ...jetzt, bedingungen: basis.bedingungen, geaendert: false },
                }),
            ]),
        );
        const regeln = stelleWikiHer(start.regeln, "5", undefined);
        expect(regeln[0]?.bedingungen[0]?.arten).toEqual([{ ebene: "vegetation", art: "steppe" }]);
    });

    it("🔴 wer die Wiki-Regel erst änderte und dann wiederherstellt, hat die gespeicherte Wiki-Regel zurück (nichts ist geändert)", () => {
        const start = standAusVorkommen(
            eintrag([regel(1, { bedingungen: [bed({ arten: [{ ebene: "vegetation", art: "steppe" }] })] })]),
        );
        const geaendert = regelAusEditor(
            start.regeln,
            {
                schluessel: "1",
                relation: "verbreitung",
                bedingungen: [wb({ arten: [{ ebene: "topographie", art: "gebirge" }] })],
            },
            undefined,
        );
        expect(geaendert[0]).toMatchObject({ ursprung: "manual" });
        const zurueck = stelleWikiHer(geaendert, geaendert[0]!.schluessel, undefined);
        expect(zurueck[0]).toBe(start.regeln[0]);
        expect(entwurfAlsKoerper(start, { ...start, regeln: zurueck })).toBeUndefined();
    });

    it("was das Wiki jetzt sagt, liest eine neue Regel von Hand aus dem jüngsten Vorschlag; ohne Basis gibt es nichts herzustellen", () => {
        const wiki = vorschlag([vorschlagRegel({ bedingungen: jetzt.bedingungen })]);
        const start = standAusVorkommen(eintrag([regel(1)], wiki));
        const geaendert = regelAusEditor(
            start.regeln,
            { schluessel: "1", relation: "verbreitung", bedingungen: [wb({ klima: { von: "polar", bis: "polar" } })] },
            wiki,
        );
        const w = wikiJetzt(geaendert[0]!, wiki);
        expect(w?.geaendert).toBe(true);
        expect(w?.bedingungen[0]?.arten).toEqual([{ ebene: "topographie", art: "gebirge" }]);
        expect(wikiFassungZumHerstellen(geaendert[0]!, wiki)?.[0]?.arten).toEqual([
            { ebene: "topographie", art: "gebirge" },
        ]);
        // Ohne neue Ableitung gilt die Basis, und sie hat sich nicht geändert.
        const ohne = wikiJetzt(geaendert[0]!, undefined);
        expect(ohne).toMatchObject({ geaendert: false });
        const von = regelAusEditor(start.regeln, { relation: "regionen", bedingungen: [wb()] }, undefined);
        expect(wikiJetzt(von[1]!, wiki)).toBeUndefined();
        expect(stelleWikiHer(von, von[1]!.schluessel, wiki)).toBe(von);
        expect(stelleWikiHer(von, "99", wiki)).toBe(von);
    });

    it("eine Regel aus Legacy hat keine Wiki-Fassung", () => {
        const start = standAusVorkommen(eintrag([regel(1, { ursprung: "legacy" })]));
        expect(wikiJetzt(start.regeln[0]!, undefined)).toBeUndefined();
        expect(wikiFassungZumHerstellen(start.regeln[0]!, undefined)).toBeUndefined();
    });
});

describe("Warum „Regel übernehmen“ nicht geht", () => {
    it("🔴 eine Bedingung ohne Einschränkung sperrt, mit der Nummer; bei einer einzigen steht der kürzere Satz", () => {
        expect(regelSperre({ relation: "verbreitung", bedingungen: [neueBedingung()] }, [])).toEqual({
            art: "leer",
            n: 1,
            nurEine: true,
        });
        expect(regelSperre({ relation: "verbreitung", bedingungen: [wb(), neueBedingung("oder")] }, [])).toEqual({
            art: "leer",
            n: 2,
            nurEine: false,
        });
        expect(
            regelSperre(
                { relation: "verbreitung", bedingungen: [wb(), wb({ klima: { von: "polar", bis: "polar" } })] },
                [],
            ),
        ).toBeUndefined();
    });

    it("🔴 eine Lage, der Richtung oder Ort fehlt, sperrt mit der Nummer der Bedingung - vor jeder anderen Sperre; mit Lage ist eine sonst leere Bedingung gültig", () => {
        const halbOhneOrt = setzeLage(neueBedingung(), { richtung: "sued", orte: [] });
        const halbOhneRichtung = setzeLage(neueBedingung("oder"), {
            richtung: null,
            orte: lageSued(GARETH).orte,
        });
        expect(regelSperre({ relation: "verbreitung", bedingungen: [halbOhneOrt] }, [])).toEqual({
            art: "lage",
            n: 1,
        });
        expect(regelSperre({ relation: "verbreitung", bedingungen: [wb(), halbOhneRichtung] }, [])).toEqual({
            art: "lage",
            n: 2,
        });
        // Auch neben einer leeren Bedingung vorne zuerst die Lage (sie ist die Auskunft, die der Nutzer gerade gibt).
        expect(regelSperre({ relation: "verbreitung", bedingungen: [neueBedingung(), halbOhneOrt] }, [])).toEqual({
            art: "lage",
            n: 2,
        });
        // Fertig: „alles südlich von Gareth“ sperrt nicht.
        const fertig = setzeLage(neueBedingung(), { richtung: "sued", orte: lageSued(GARETH).orte });
        expect(regelSperre({ relation: "verbreitung", bedingungen: [fertig] }, [])).toBeUndefined();
        // Wieder gelöscht (egal): leer, nicht halb.
        const egal = setzeLage(halbOhneOrt, null);
        expect(regelSperre({ relation: "verbreitung", bedingungen: [egal] }, [])).toMatchObject({ art: "leer" });
    });

    it("🔴 dieselbe Kette mit anderer Lage ist eine andere Regel; mit derselben Lage (Orte vertauscht) sperrt sie als doppelt", () => {
        const regeln = liste(regel(1, { bedingungen: [bed({ lage: lageSued(GARETH, HAVENA), arten: [] })] }));
        const gleich = nurLage(lageSued(HAVENA, GARETH));
        expect(regelSperre({ relation: "verbreitung", bedingungen: [gleich] }, regeln)).toEqual({ art: "doppelt" });
        const andere = nurLage({ ...lageSued(GARETH, HAVENA), richtung: "nord" });
        expect(regelSperre({ relation: "verbreitung", bedingungen: [andere] }, regeln)).toBeUndefined();
    });

    it("🔴 eine Regel, die es in der Beziehung schon gibt, sperrt (der Server lehnte sie mit regel_besteht ab); die geöffnete Regel und die, die sie ersetzt, zählen nicht", () => {
        const regeln = liste(regel(1), regel(2, { relation: "herkunft" }));
        expect(regelSperre({ relation: "verbreitung", bedingungen: [wald()] }, regeln)).toEqual({ art: "doppelt" });
        // Eine andere Beziehung ist eine andere Regel.
        expect(regelSperre({ relation: "regionen", bedingungen: [wald()] }, regeln)).toBeUndefined();
        // Die geöffnete Regel mit ihrer eigenen Kette sperrt sich nicht.
        expect(
            regelSperre({ schluessel: "1", relation: "verbreitung", bedingungen: [wald()] }, regeln),
        ).toBeUndefined();
        // Auch nicht, wenn sie schon eine geänderte ist und die gespeicherte ersetzt.
        const geaendert = regelAusEditor(
            regeln,
            { schluessel: "1", relation: "verbreitung", bedingungen: [wb()] },
            undefined,
        );
        expect(
            regelSperre(
                { schluessel: geaendert[0]!.schluessel, relation: "verbreitung", bedingungen: [wald()] },
                geaendert,
            ),
        ).toBeUndefined();
        // Eine andere Regel mit derselben Kette sperrt.
        expect(regelSperre({ schluessel: "2", relation: "verbreitung", bedingungen: [wb()] }, geaendert)).toEqual({
            art: "doppelt",
        });
    });
});

describe("Sätze", () => {
    it("die Regel in einer Zeile: Bedingungen mit UND, ODER, OHNE", () => {
        expect(regelSatz([wb()])).toBe("Steppe");
        expect(
            regelSatz([
                wb({ flaeche: { name: "Aranien", kennung: FLAECHE_A, offen: false, titel: null, kandidat: null } }),
                { ...wb({ arten: [], klima: { von: "polar", bis: "polar" } }), verknuepfung: "ohne" },
            ]),
        ).toBe("Steppe · Aranien OHNE Klima Polare Zone bis Polare Zone");
    });

    it("🔴 die Lage steht im Satz: hinter dem Ort, ohne Art und Fläche als eigene Bedingung", () => {
        expect(regelSatz([wb({ lage: lageSued(GARETH) })])).toBe("Steppe · südlich von Gareth");
        expect(regelSatz([nurLage(lageSued(GARETH, HAVENA))])).toBe("südlich der Linie Gareth–Havena");
        expect(
            regelSatz([
                wb({ flaeche: { name: "Aranien", kennung: FLAECHE_A, offen: false, titel: null, kandidat: null } }),
                { ...nurLage({ ...lageSued(GARETH), richtung: "nord" }), verknuepfung: "ohne" },
            ]),
        ).toBe("Steppe · Aranien OHNE nördlich von Gareth");
    });

    it("🔴 aus Editor und Regel: ein Stand mit halber Lage verliert beim Übernehmen seinen Entwurf, die ganze Lage bleibt in der Regel und im Körper", () => {
        const start = standAusVorkommen(eintrag([]));
        const ganz = setzeLage(neueBedingung(), { richtung: "sued", orte: lageSued(GARETH).orte });
        const regeln = regelAusEditor(start.regeln, { relation: "verbreitung", bedingungen: [ganz] }, undefined);
        const neu = regeln.at(-1)!;
        expect(neu.bedingungen[0]?.lage).toEqual(lageSued(GARETH));
        expect(neu.bedingungen[0]).not.toHaveProperty("lageEntwurf");
        const aenderungen = regelAenderungen(start.regeln, regeln);
        expect(aenderungen).toEqual([
            {
                op: "add",
                relation: "verbreitung",
                bedingungen: [{ verknuepfung: "und", arten: [], lage: { richtung: "sued", orte: [GARETH] } }],
            },
        ]);
        // Ein halber Stand ginge mit `lageEntwurf` hinein und kommt ohne heraus.
        const halb = setzeLage(wb(), { richtung: "ost", orte: [] });
        const mitHalb = regelAusEditor(start.regeln, { relation: "verbreitung", bedingungen: [halb] }, undefined);
        expect(mitHalb.at(-1)?.bedingungen[0]).not.toHaveProperty("lageEntwurf");
        expect(mitHalb.at(-1)?.bedingungen[0]).not.toHaveProperty("lage");
    });

    it("eine wartende Fläche trägt „!“", () => {
        expect(
            regelSatz([wb({ flaeche: { name: "Mhana", kennung: null, offen: true, titel: "Mhana", kandidat: null } })]),
        ).toBe("Steppe · ! Mhana");
    });
});

describe("Konflikt (409): die eigenen Änderungen auf den fremden Stand", () => {
    it("Schlüssel der Änderungen: die Regel des Servers, die sie trifft, oder die neue Regel in ihrer Beziehung", () => {
        const start = standAusVorkommen(eintrag([regel(1), regel(2, { relation: "herkunft" })]));
        const geaendert = regelAusEditor(
            start.regeln,
            { schluessel: "1", relation: "verbreitung", bedingungen: [wb()] },
            undefined,
        );
        const mitNeu = regelAusEditor(geaendert, { relation: "regionen", bedingungen: [wb()] }, undefined);
        const ohne = loescheRegel(mitNeu, "2");
        const schluessel_ = regelAenderungen(start.regeln, ohne).map(regelAenderungSchluessel);
        expect(schluessel_[0]).toBe("regel:2");
        expect(schluessel_).toContain("regel:1");
        expect(schluessel_.some((s) => s.startsWith("regel:neu:regionen:"))).toBe(true);
    });

    it("die eigene Änderung ersetzt auf dem fremden Stand dieselbe Regel; ist sie dort weg, hängt die neue Regel ohne ersetzt an", () => {
        const start = standAusVorkommen(eintrag([regel(1)]));
        const eigen = regelAusEditor(
            start.regeln,
            { schluessel: "1", relation: "verbreitung", bedingungen: [wb()] },
            undefined,
        );
        // Fremd hat eine weitere Regel angelegt; Regel 1 ist noch da.
        const fremd = liste(regel(1), regel(3, { relation: "herkunft" }));
        const uebertragen = uebertrageRegeln(fremd, start.regeln, eigen);
        expect(uebertragen).toHaveLength(2);
        expect(uebertragen[0]).toMatchObject({ neu: true, ersetzt: { ruleId: "1" } });
        expect(uebertragen[1]?.ruleId).toBe("3");
        // Fremd hat Regel 1 gelöscht: Die neue Regel hängt an, ohne eine Regel zu ersetzen, die es nicht mehr gibt.
        const ohne1 = uebertrageRegeln(liste(regel(3, { relation: "herkunft" })), start.regeln, eigen);
        expect(ohne1).toHaveLength(2);
        expect(ohne1[1]).toMatchObject({ neu: true, ersetzt: undefined });
    });

    it("gelöscht bleibt gelöscht; was es fremd schon gibt (dieselbe Kette in derselben Beziehung), kommt nicht doppelt", () => {
        const start = standAusVorkommen(eintrag([regel(1), regel(2, { relation: "herkunft" })]));
        const eigen = regelAusEditor(
            loescheRegel(start.regeln, "2"),
            { relation: "regionen", bedingungen: [wb()] },
            undefined,
        );
        const fremd = liste(
            regel(1),
            regel(2, { relation: "herkunft" }),
            regel(8, { relation: "regionen", bedingungen: [bed({ arten: [{ ebene: "vegetation", art: "steppe" }] })] }),
        );
        const uebertragen = uebertrageRegeln(fremd, start.regeln, eigen);
        expect(uebertragen.map((r) => r.ruleId ?? "neu")).toEqual(["1", "8"]);
    });
});
