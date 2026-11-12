import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MapHistoryEntry, MapHistoryObject, MapHistorySeries } from "@avesmaps3d/shared";
import {
    TEILS,
    buendelZaehlung,
    elternVon,
    istBuendelbar,
    nurTeilsZurueck,
    punktSchluessel,
    serienSchluessel,
    tagesGruppen,
    tagesSchluessel,
    type Buendel,
} from "../src/aenderungen/aenderung-gruppen";
import { gruppiere, serienZustand, type SerienZeile } from "../src/aenderungen/aenderung-modell";
import { TAFEL_ERSTE, TAFEL_SCHRITT, sichtbareGegenstaende } from "../src/aenderungen/aenderung-tafel";
import { kreisName, kreisTitel, objekteText, statusName, tagesKopf } from "../src/aenderungen/aenderung-text";
import { felderZahl } from "../src/aenderungen/aenderung-titel";
import {
    buendelAngaben,
    buendelTitel,
    eintragsAngaben,
    einzelnerOrt,
    feldAngabe,
    mitgliedTitel,
    personKurz,
    quelleEtikett,
    serienAngaben,
    zeigtRueckAmEnde,
} from "../src/aenderungen/aenderung-zeile-modell";
import { locale, t } from "../src/i18n/i18n";

/**
 * Die Neugestaltung von „Änderungen“ (WI-0265 B10), ohne Bauteil und ohne Browser: Tagesköpfe und Gruppen, Bündel der Läufe, der EINE Wortschatz des Zustands, was eine Zeile sagt (höchstens zwei Zeilen) und
 * wann das ↺ am Zeilenende steht. Die Bauteile prüft `e2e/aenderungen-liste.spec.ts` im Browser.
 */

/** Sonntag, 1.11.2026, 15:10 Ortszeit (die Tage zählen in Ortszeit, wie die Liste sie zeigt). */
const JETZT = new Date(2026, 10, 1, 15, 10, 0);
const um = (monat: number, tag: number, stunde: number, minute = 0): string =>
    new Date(2026, monat - 1, tag, stunde, minute, 0).toISOString();
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ICH: MapHistoryEntry["actor"] = { kind: "person", id: "p1", name: "Rondrikan", self: true };
const THOMAS: MapHistoryEntry["actor"] = { kind: "person", id: "p2", name: "Thomas" };

function gegenstand(teil: Partial<MapHistoryObject> = {}): MapHistoryObject {
    return {
        kind: "place",
        id: id(900),
        name: "Luring",
        action: "place.updated",
        revisionBefore: 1,
        revisionAfter: 2,
        changes: { description: { before: "a", after: "b" } },
        ...teil,
    };
}

function eintrag(n: number, at: string, teil: Partial<MapHistoryEntry> = {}): MapHistoryEntry {
    return {
        operationId: id(n),
        seq: 1000 - n,
        at,
        operation: "place.update",
        source: "editor",
        actor: ICH,
        status: "ruecknehmbar",
        objects: [gegenstand()],
        ...teil,
    };
}

const wiki = (n: number, at: string, summary: string, objekte = 1): MapHistoryEntry =>
    eintrag(n, at, {
        source: "wikisync",
        status: "nicht_ruecknehmbar",
        statusReason: "quelle",
        summary,
        objects: Array.from({ length: objekte }, (_, i) => gegenstand({ id: id(800 + n * 10 + i) })),
    });

beforeEach(() => {
    locale.value = "de";
});
afterEach(() => {
    locale.value = "de";
});

describe("Tagesköpfe (in Ortszeit)", () => {
    it("🔴 „Heute“, „Gestern“, sonst der Wochentag mit Datum, in der Sprache der Oberfläche", () => {
        expect(tagesKopf(um(11, 1, 0, 5), JETZT)).toBe("Heute");
        expect(tagesKopf(um(11, 1, 14, 59), JETZT)).toBe("Heute");
        expect(tagesKopf(um(10, 31, 23, 59), JETZT)).toBe("Gestern");
        expect(tagesKopf(um(10, 28, 16, 5), JETZT)).toBe("Mittwoch, 28. Oktober");
        locale.value = "en";
        expect(tagesKopf(um(11, 1, 9), JETZT)).toBe("Today");
        expect(tagesKopf(um(10, 28, 16, 5), JETZT)).toMatch(/Wednesday/);
    });

    it("liegt der Tag in einem anderen Jahr, steht es dabei", () => {
        expect(tagesKopf(new Date(2025, 11, 24, 10).toISOString(), JETZT)).toBe("Mittwoch, 24. Dezember 2025");
    });

    it("der Tag zählt in Ortszeit: kurz nach Mitternacht gehört zum neuen Tag", () => {
        expect(tagesSchluessel(um(11, 1, 0, 1))).toBe("2026-11-01");
        expect(tagesSchluessel(um(10, 31, 23, 59))).toBe("2026-10-31");
    });
});

describe("Tagesgruppen", () => {
    const a = eintrag(1, um(11, 1, 14, 2));
    const b = eintrag(2, um(11, 1, 11, 30), { actor: THOMAS });
    const c = eintrag(3, um(10, 31, 22, 40));
    const d = eintrag(4, um(10, 28, 16, 20));
    const liste = (eintraege: MapHistoryEntry[], serien: MapHistorySeries[] = []) =>
        gruppiere(eintraege, new Map(serien.map((serie) => [serie.id, serie])));

    it("🔴 die Zeilen stehen unter dem Kopf ihres Tages, neueste zuerst, die Reihenfolge der Eingabe bleibt", () => {
        const tage = tagesGruppen(liste([a, b, c, d]), true);
        expect(tage.map((tag) => tag.schluessel)).toEqual(["2026-11-01", "2026-10-31", "2026-10-28"]);
        expect(tage.map((tag) => tag.punkte.map(punktSchluessel))).toEqual([[id(1), id(2)], [id(3)], [id(4)]]);
        expect(tage[0]!.at).toBe(a.at);
    });

    it("🔴 die Läufe von WikiSync und Import bündelt ein Tag je Quelle, an der Stelle des neuesten Laufs", () => {
        const w1 = wiki(5, um(11, 1, 3, 0), "WikiSync: 2 Felder aus dem Wiki übernommen (2 Objekte)", 2);
        const imp = eintrag(6, um(11, 1, 2, 30), {
            source: "import",
            status: "nicht_ruecknehmbar",
            actor: { kind: "system" },
        });
        const w2 = wiki(7, um(11, 1, 1, 0), "WikiSync: 608 Felder aus dem Wiki übernommen (90 Objekte)");
        const gestern = wiki(8, um(10, 31, 6, 22), "WikiSync: 4 Felder aus dem Wiki übernommen (4 Objekte)");
        const heute = tagesGruppen(liste([a, w1, imp, w2, gestern]), true)[0]!;
        // Die Läufe stehen nicht einzeln da: eine Zeile für den Wiki-Abgleich (an der Stelle von w1), eine für den Import.
        expect(heute.punkte.map(punktSchluessel)).toEqual([
            id(1),
            "bundle:2026-11-01:wikisync",
            "bundle:2026-11-01:import",
        ]);
        const buendel = heute.punkte[1] as Buendel;
        expect(buendel.art).toBe("buendel");
        expect(buendel.eintraege.map((e) => e.operationId)).toEqual([id(5), id(7)]);
        // Ein anderer Tag bündelt für sich.
        const tage = tagesGruppen(liste([a, w1, imp, w2, gestern]), true);
        expect(tage[1]!.punkte.map(punktSchluessel)).toEqual(["bundle:2026-10-31:wikisync"]);
    });

    it("ohne Bündeln stehen die Läufe einzeln da", () => {
        const w1 = wiki(5, um(11, 1, 3, 0), "WikiSync: 2 Felder aus dem Wiki übernommen (2 Objekte)");
        expect(tagesGruppen(liste([a, w1]), false)[0]!.punkte.map(punktSchluessel)).toEqual([id(1), id(5)]);
    });

    it("🔴 ein Lauf in einer Arbeitsserie bleibt in ihr; die Serie steht an der Stelle ihres neuesten Mitglieds", () => {
        const m1 = wiki(10, um(11, 1, 9, 5), "WikiSync: 1 Felder aus dem Wiki übernommen (1 Objekte)", 1);
        const m2 = { ...m1, operationId: id(11), at: um(11, 1, 9, 12), series: { id: id(10), position: 2, size: 2 } };
        const m1s = { ...m1, series: { id: id(10), position: 1, size: 2 } };
        const serie: MapHistorySeries = {
            id: id(10),
            size: 2,
            delivered: 2,
            members: [id(10), id(11)],
            membersHash: "h",
            scope: { kind: "place", id: id(900), name: "Luring" },
        };
        const tage = tagesGruppen(liste([a, m2, m1s], [serie]), true);
        expect(tage[0]!.punkte.map(punktSchluessel)).toEqual([id(1), serienSchluessel(id(10))]);
        expect(istBuendelbar(m1s)).toBe(false);
        expect(istBuendelbar(m1)).toBe(true);
    });

    it("das Bündel zählt Läufe, Felder (die Zahl des Servers) und Objekte; eine Null im Titel zählt die Zeilen des Details", () => {
        const w1 = wiki(5, um(11, 1, 3, 0), "WikiSync: 2 Felder aus dem Wiki übernommen (2 Objekte)", 2);
        const w2 = wiki(7, um(11, 1, 1, 0), "WikiSync: 608 Felder aus dem Wiki übernommen (90 Objekte)");
        const nullFelder = wiki(9, um(11, 1, 0, 30), "WikiSync: 0 Felder aus dem Wiki übernommen (0 Objekte)");
        const buendel: Buendel = {
            art: "buendel",
            schluessel: "bundle:x:wikisync",
            quelle: "wikisync",
            eintraege: [w1, w2, nullFelder],
        };
        expect(felderZahl(w1)).toBe(2);
        expect(felderZahl(w2)).toBe(608);
        // Eine Null, wo der Lauf Gegenstände mit Feldern trägt, zählt das Detail (hier ein Feld).
        expect(felderZahl(nullFelder)).toBe(1);
        expect(buendelZaehlung(buendel)).toEqual({ laeufe: 3, felder: 611, objekte: 4 });
    });

    it("elternVon nennt, was aufgeklappt sein muss, damit man einen Eintrag sieht", () => {
        const w1 = wiki(5, um(11, 1, 3, 0), "WikiSync: 2 Felder aus dem Wiki übernommen (2 Objekte)");
        expect(elternVon(a, true)).toEqual([]);
        expect(elternVon(w1, true)).toEqual(["bundle:2026-11-01:wikisync"]);
        expect(elternVon(w1, false)).toEqual([]);
        expect(elternVon(eintrag(6, a.at, { series: { id: id(2), position: 1, size: 2 } }), true)).toEqual([
            serienSchluessel(id(2)),
        ]);
    });

    it("🔴 „teils zurückgenommen“ zeigt nur Serien, von denen einige Mitglieder zurück sind", () => {
        const m = (n: number, status: NonNullable<MapHistoryEntry["status"]>): MapHistoryEntry =>
            eintrag(n, um(10, 28, 15, n), { status, series: { id: id(20), position: n - 20, size: 3 } });
        const serien: MapHistorySeries[] = [
            {
                id: id(20),
                size: 3,
                delivered: 3,
                members: [id(21), id(22), id(23)],
                membersHash: "h",
                scope: { kind: "place", id: id(900) },
            },
        ];
        const halb = liste([m(23, "bereits_zurueckgenommen"), m(22, "ruecknehmbar"), m(21, "ruecknehmbar"), a], serien);
        expect(nurTeilsZurueck(halb)).toHaveLength(1);
        expect(serienZustand(nurTeilsZurueck(halb)[0] as SerienZeile).kreis).toBe("halb");
        const voll = liste([m(23, "ruecknehmbar"), m(22, "ruecknehmbar"), m(21, "ruecknehmbar"), a], serien);
        expect(nurTeilsZurueck(voll)).toEqual([]);
        expect(TEILS).toBe("teils");
    });
});

describe("Der EINE Wortschatz des Zustands", () => {
    it("🔴 ● wirksam · ◐ teils zurückgenommen · ○ zurückgenommen · ⊘ nicht rücknehmbar", () => {
        expect(kreisName("voll")).toBe("wirksam");
        expect(kreisName("halb")).toBe("teils zurückgenommen");
        expect(kreisName("leer")).toBe("zurückgenommen");
        expect(kreisName("gesperrt")).toBe("nicht rücknehmbar");
    });

    it("🔴 die Zustände des Servers heißen in Trichter und Detail genauso wie am Kreis", () => {
        expect(statusName("ruecknehmbar")).toBe(kreisName("voll"));
        expect(statusName("bereits_zurueckgenommen")).toBe(kreisName("leer"));
        expect(statusName("nicht_ruecknehmbar")).toBe(kreisName("gesperrt"));
    });

    it("der Tooltip: ● sagt „(rücknehmbar)“, ◐ einer Serie nennt die Zahl, die anderen sind ihr Wort", () => {
        expect(kreisTitel("voll")).toBe("wirksam (rücknehmbar)");
        expect(kreisTitel("halb", { zurueck: 1, gesamt: 3 })).toBe("teils zurückgenommen (1 von 3)");
        expect(kreisTitel("halb")).toBe("teils zurückgenommen");
        expect(kreisTitel("leer")).toBe("zurückgenommen");
        expect(kreisTitel("gesperrt")).toBe("nicht rücknehmbar");
    });
});

describe("Was eine Zeile sagt (höchstens zwei Zeilen)", () => {
    it("🔴 die eigene Änderung trägt den Anzeigenamen (keine Anrede, ohne „(eigene Änderung)“), die fremde auch, unter „Meine“ steht die Person nie", () => {
        const eigene = eintrag(1, um(11, 1, 14, 2));
        const fremde = eintrag(2, um(11, 1, 11, 30), { actor: THOMAS });
        expect(personKurz(eigene.actor)).toBe("Rondrikan");
        expect(personKurz(eigene.actor)).not.toContain("eigene");
        expect(personKurz(fremde.actor)).toBe("Thomas");
        expect(personKurz({ kind: "system" })).toBeUndefined();
        expect(eintragsAngaben(eigene, { meine: false }).person).toBe("Rondrikan");
        expect(eintragsAngaben(fremde, { meine: false }).person).toBe("Thomas");
        expect(eintragsAngaben(eigene, { meine: true }).person).toBeUndefined();
        expect(eintragsAngaben(fremde, { meine: false, ohnePerson: true }).person).toBeUndefined();
    });

    it("die Uhrzeit steht ohne Zeitzone; der Kreis trägt den Zustand im Tooltip", () => {
        const angaben = eintragsAngaben(eintrag(1, um(11, 1, 14, 2)), { meine: false });
        expect(angaben.zeit).toBe("14:02");
        expect(angaben.zeit).not.toMatch(/M?EZ|UTC/u);
        expect(angaben.kreis).toBe("voll");
        expect(angaben.kreisName).toBe("wirksam (rücknehmbar)");
    });

    it("🔴 die Quelle steht nur, wenn sie nicht der Editor ist; ein Community-Vorgang trägt seine Nummer", () => {
        expect(quelleEtikett({ source: "editor", communityVorgang: undefined })).toBeUndefined();
        expect(quelleEtikett({ source: "wikisync", communityVorgang: undefined })).toBe(t("verlauf.quelle.wikisync"));
        expect(quelleEtikett({ source: "import", communityVorgang: undefined })).toBe(t("verlauf.quelle.import"));
        expect(quelleEtikett({ source: "restore", communityVorgang: undefined })).toBe("Rücknahme");
        expect(quelleEtikett({ source: "editor", communityVorgang: "COM-000123" })).toBe("COM-000123");
        expect(eintragsAngaben(eintrag(1, um(11, 1, 9), { source: "restore" }), { meine: false }).etikett).toBe(
            "Rücknahme",
        );
        expect(
            eintragsAngaben(eintrag(1, um(11, 1, 9), { source: "restore" }), { meine: false, ohneEtikett: true })
                .etikett,
        ).toBeUndefined();
    });

    it("🔴 „n Objekte“ nur bei mehr als einem", () => {
        expect(objekteText(0)).toBeUndefined();
        expect(objekteText(1)).toBeUndefined();
        expect(objekteText(3)).toBe("3 Objekte");
        const zwei = eintrag(1, um(11, 1, 9), { objects: [gegenstand(), gegenstand({ id: id(901), name: "Punin" })] });
        expect(eintragsAngaben(zwei, { meine: false }).objekte).toBe("2 Objekte");
        expect(eintragsAngaben(eintrag(2, um(11, 1, 9)), { meine: false }).objekte).toBeUndefined();
    });

    it("die Felder: bei einem Ort seine Felder, sonst alle der Gegenstände, jedes einmal", () => {
        const ort = eintrag(1, um(11, 1, 9), {
            objects: [
                gegenstand({
                    changes: { description: { before: "a", after: "b" }, hidden: { before: false, after: true } },
                }),
                gegenstand({ kind: "path", id: id(902), changes: { description: { before: "a", after: "b" } } }),
            ],
        });
        expect(feldAngabe(ort)).toBe("Beschreibung, Verborgen");
        const wege = eintrag(2, um(11, 1, 9), {
            objects: [
                gegenstand({ kind: "path", id: id(903), changes: { description: { before: "a", after: "b" } } }),
                gegenstand({ kind: "path", id: id(904), changes: { description: { before: "c", after: "d" } } }),
            ],
        });
        // Zwei Wege mit demselben Feld: ein Name, nicht zwei.
        expect(feldAngabe(wege)).toBe(feldAngabe({ objects: [wege.objects[0]!] }));
        expect(feldAngabe(wege).split(", ")).toHaveLength(1);
    });

    it("ein Mitglied einer Serie nennt den Schritt und nicht den Gegenstand", () => {
        const m = eintrag(3, um(10, 28, 16, 20), {
            summary: "Blutzinnen: Kamm 2 verschoben",
            series: { id: id(1), position: 3, size: 8 },
        });
        expect(mitgliedTitel(m)).toBe("Schritt 3/8: Kamm 2 verschoben");
    });

    it("eine Serie ist dieselbe Zeile: Name und Zahl, Spanne, Zustand mit Zahl im Tooltip", () => {
        const serien: MapHistorySeries[] = [
            {
                id: id(20),
                size: 3,
                delivered: 3,
                members: [id(21), id(22), id(23)],
                membersHash: "h",
                scope: { kind: "place", id: id(900), name: "Havena" },
            },
        ];
        const m = (n: number, status: NonNullable<MapHistoryEntry["status"]>, minute: number): MapHistoryEntry =>
            eintrag(n, um(10, 28, 16, minute), { status, series: { id: id(20), position: n - 20, size: 3 } });
        const zeile = gruppiere(
            [m(23, "bereits_zurueckgenommen", 20), m(22, "ruecknehmbar", 11), m(21, "ruecknehmbar", 5)],
            new Map(serien.map((s) => [s.id, s])),
        )[0] as SerienZeile;
        const angaben = serienAngaben(zeile, { meine: false });
        expect(angaben.titel).toBe("Havena — 3 Änderungen");
        expect(angaben.bereich).toBe("16:05–16:20");
        expect(angaben.zeit).toBe("16:20");
        expect(angaben.kreis).toBe("halb");
        expect(angaben.kreisName).toBe("teils zurückgenommen (1 von 3)");
        expect(angaben.person).toBe("Rondrikan");
        expect(serienAngaben(zeile, { meine: true }).person).toBeUndefined();
    });

    it("🔴 das Bündel: „Wiki-Abgleich · 2 Läufe · 610 Felder“ und „Import · 1 Lauf · 3 Objekte“, gesperrt, ohne Uhrzeit", () => {
        const w1 = wiki(5, um(11, 1, 3, 0), "WikiSync: 2 Felder aus dem Wiki übernommen (2 Objekte)", 2);
        const w2 = wiki(7, um(11, 1, 1, 0), "WikiSync: 608 Felder aus dem Wiki übernommen (90 Objekte)");
        const buendel: Buendel = {
            art: "buendel",
            schluessel: "bundle:x:wikisync",
            quelle: "wikisync",
            eintraege: [w1, w2],
        };
        expect(buendelTitel(buendel)).toBe("Wiki-Abgleich · 2 Läufe · 610 Felder");
        const einzel: Buendel = {
            art: "buendel",
            schluessel: "bundle:x:import",
            quelle: "import",
            eintraege: [
                eintrag(6, um(11, 1, 2), {
                    source: "import",
                    objects: [gegenstand(), gegenstand({ id: id(1) }), gegenstand({ id: id(2) })],
                }),
            ],
        };
        expect(buendelTitel(einzel)).toBe("Import · 1 Lauf · 3 Objekte");
        expect(buendelAngaben(buendel)).toMatchObject({
            kreis: "gesperrt",
            kreisName: "nicht rücknehmbar",
            zeit: "",
            felder: "",
        });
    });

    it("die Zahlwörter folgen der Sprache", () => {
        locale.value = "en";
        const w = wiki(5, um(11, 1, 3, 0), "WikiSync: 1 Felder aus dem Wiki übernommen (1 Objekte)");
        const buendel: Buendel = {
            art: "buendel",
            schluessel: "bundle:x:wikisync",
            quelle: "wikisync",
            eintraege: [w],
        };
        expect(buendelTitel(buendel)).toBe("Wiki sync · 1 run · 1 field");
        expect(objekteText(2)).toBe("2 objects");
        locale.value = "pl";
        expect(objekteText(2)).toBe("2 obiekty");
        expect(objekteText(5)).toBe("5 obiektów");
    });
});

describe("⊕ und ↺ in der Zeile", () => {
    it("🔴 ↺ am Zeilenende: nur wo es etwas zurückzunehmen gibt, und am Telefon nie", () => {
        expect(zeigtRueckAmEnde({ phone: false, hatAngebot: true, gesperrt: false })).toBe(true);
        expect(zeigtRueckAmEnde({ phone: true, hatAngebot: true, gesperrt: false })).toBe(false);
        expect(zeigtRueckAmEnde({ phone: false, hatAngebot: false, gesperrt: false })).toBe(false);
        expect(zeigtRueckAmEnde({ phone: false, hatAngebot: true, gesperrt: true })).toBe(false);
    });

    it("genau ein Ort und kein Löschen: ⊕ wählt den Ort; sonst die Karte (B9)", () => {
        const eins = eintrag(1, um(11, 1, 9));
        expect(einzelnerOrt(eins)?.id).toBe(id(900));
        expect(einzelnerOrt({ ...eins, operation: "place.delete" })).toBeUndefined();
        expect(einzelnerOrt({ ...eins, objects: [gegenstand(), gegenstand({ id: id(901) })] })).toBeUndefined();
        expect(einzelnerOrt({ ...eins, objects: [gegenstand({ kind: "path" })] })).toBeUndefined();
    });
});

describe("Die Tafel bei vielen Gegenständen", () => {
    it("🔴 die ersten fünf, dann „n weitere“, je Druck zehn mehr", () => {
        const viele = Array.from({ length: 40 }, (_, i) => i);
        expect(TAFEL_ERSTE).toBe(5);
        expect(TAFEL_SCHRITT).toBe(10);
        expect(sichtbareGegenstaende(viele, 0)).toEqual({ sichtbar: viele.slice(0, 5), weitere: 35 });
        expect(sichtbareGegenstaende(viele, 1)).toEqual({ sichtbar: viele.slice(0, 15), weitere: 25 });
        expect(sichtbareGegenstaende(viele, 4)).toEqual({ sichtbar: viele, weitere: 0 });
        expect(sichtbareGegenstaende(viele, 9)).toEqual({ sichtbar: viele, weitere: 0 });
        expect(sichtbareGegenstaende([1, 2], 0)).toEqual({ sichtbar: [1, 2], weitere: 0 });
        expect(sichtbareGegenstaende([], 0)).toEqual({ sichtbar: [], weitere: 0 });
    });
});
