import { PHOTOBOX_SUBMISSION_STATES, type PhotoboxStatus, type PhotoboxSubmissionState } from "@avesmaps3d/shared";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../src/auth/api.ts";
import { da } from "../src/i18n/da.ts";
import { de, type MessageKey } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as itTafel } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { sv } from "../src/i18n/sv.ts";
import { fehlerArt } from "../src/photobox/api.ts";
import { frischerSchutz, nachKopieren, nachMerken, pruefeWeiter, warnungSteht } from "../src/photobox/fertig-schutz.ts";
import {
    createMerkliste,
    MERKLISTE_MAX,
    MERKLISTE_SCHLUESSEL,
    pruefeMerkeintraege,
    type MerkSpeicher,
} from "../src/photobox/meine-reisebilder.ts";
import {
    ART_KURZ,
    createMeinCache,
    ladeMeine,
    MARKE_UNKLAR,
    MARKE_WEG,
    markeFuer,
    meineLeiste,
    MEIN_CACHE_MS,
    type MeineAusgang,
    type MeinErgebnis,
} from "../src/photobox/meine-reisebilder-modell.ts";

/**
 * Die Merkliste „Meine Reisebilder“ ohne Browser (WI-0272 S3, Aufgabe 19a; Entwurf 9, Betreiber 2026-11-01): Der persönliche Link lässt sich auf Wunsch im Browserspeicher merken, unter EINEM
 * Schlüssel, geprüft beim Lesen; was der Speicher nicht hergibt, verschwindet still. Dazu der Schutz beim Schließen (gemerkt zählt wie kopiert), die Zustandsmarken, das Laden des Standes je Eintrag
 * (nacheinander, bei der Lesegrenze ohne erfundenen Stand) und die Verdrahtung im Kartenmenü. Den Browser prüft `e2e/reisebild-merken.spec.ts`.
 */

const A = "A".repeat(43);
const B = "B".repeat(43);
const C = "C".repeat(43);
const JETZT = new Date("2026-11-01T10:00:00.000Z");

/** Ein Speicher im Arbeitsspeicher, der aufzeichnet, was mit ihm geschah. */
function speicher(start?: string): MerkSpeicher & { readonly daten: Map<string, string>; readonly schreibt: string[] } {
    const daten = new Map<string, string>();
    if (start !== undefined) daten.set(MERKLISTE_SCHLUESSEL, start);
    const schreibt: string[] = [];
    return {
        daten,
        schreibt,
        getItem: (schluessel) => daten.get(schluessel) ?? null,
        setItem: (schluessel, wert) => {
            schreibt.push(schluessel);
            daten.set(schluessel, wert);
        },
        removeItem: (schluessel) => {
            daten.delete(schluessel);
        },
    };
}

const werfend = (): MerkSpeicher => ({
    getItem: () => {
        throw new Error("gesperrt");
    },
    setItem: () => {
        throw new Error("voll");
    },
    removeItem: () => {
        throw new Error("gesperrt");
    },
});

const liste = (s: MerkSpeicher | undefined) => createMerkliste({ speicher: () => s, jetzt: () => JETZT });

describe("🔴 die Merkliste: EIN Schlüssel, nur Schlüssel und Zeit, alles still", () => {
    it("merken legt unter EINEM Schlüssel Einträge { schluessel, gemerktAm } ab, sonst nichts", () => {
        const s = speicher();
        const merkliste = liste(s);
        expect(merkliste.merke(A)).toBe(true);
        expect(merkliste.hat(A)).toBe(true);
        expect([...s.daten.keys()]).toEqual([MERKLISTE_SCHLUESSEL]);
        const abgelegt: unknown = JSON.parse(s.daten.get(MERKLISTE_SCHLUESSEL)!);
        expect(abgelegt).toEqual([{ schluessel: A, gemerktAm: JETZT.toISOString() }]);
    });

    it("🔴 keine Bytes und keine Beschreibung im Speicher: nur die zwei Felder je Eintrag", () => {
        const s = speicher();
        const merkliste = liste(s);
        merkliste.merke(A);
        merkliste.merke(B);
        const roh = s.daten.get(MERKLISTE_SCHLUESSEL)!;
        for (const eintrag of JSON.parse(roh) as Record<string, unknown>[]) {
            expect(Object.keys(eintrag).sort()).toEqual(["gemerktAm", "schluessel"]);
        }
        expect(roh.length).toBeLessThan(400);
    });

    it("doppeltes Merken ändert nichts: ein Eintrag, die erste Zeit bleibt, es wird nicht noch einmal geschrieben", () => {
        const s = speicher();
        const merkliste = createMerkliste({ speicher: () => s, jetzt: () => JETZT });
        merkliste.merke(A, new Date("2026-11-01T10:00:00.000Z"));
        const schreibt = s.schreibt.length;
        expect(merkliste.merke(A, new Date("2026-11-02T10:00:00.000Z"))).toBe(true);
        expect(merkliste.eintraege.value).toHaveLength(1);
        expect(merkliste.eintraege.value[0]?.gemerktAm).toBe("2026-11-01T10:00:00.000Z");
        expect(s.schreibt).toHaveLength(schreibt);
    });

    it("neueste zuerst; vergessen nimmt genau einen heraus, der letzte nimmt den Schlüssel aus dem Speicher", () => {
        const s = speicher();
        const merkliste = liste(s);
        merkliste.merke(A, new Date("2026-11-01T09:00:00.000Z"));
        merkliste.merke(B, new Date("2026-11-01T10:00:00.000Z"));
        merkliste.merke(C, new Date("2026-11-01T11:00:00.000Z"));
        expect(merkliste.eintraege.value.map((e) => e.schluessel)).toEqual([C, B, A]);
        merkliste.vergiss(B);
        expect(merkliste.eintraege.value.map((e) => e.schluessel)).toEqual([C, A]);
        expect(merkliste.hat(B)).toBe(false);
        merkliste.vergiss(C);
        merkliste.vergiss(A);
        expect(merkliste.eintraege.value).toEqual([]);
        expect(s.daten.has(MERKLISTE_SCHLUESSEL)).toBe(false);
        // Etwas Unbekanntes zu vergessen ist still.
        expect(() => merkliste.vergiss("Z".repeat(43))).not.toThrow();
    });

    it("🔴 der Speicher wird beim Anlegen und von `verfuegbar` nie beschrieben: kein Eintrag, auch kein vorübergehender (Spy auf setItem), bis jemand das Häkchen setzt", () => {
        const s = speicher();
        const setItem = vi.spyOn(s, "setItem");
        const removeItem = vi.spyOn(s, "removeItem");
        const merkliste = liste(s);
        expect(merkliste.verfuegbar()).toBe(true);
        // Mehrfaches Fragen (Formular, Statusseite, Bestätigung) ändert daran nichts.
        expect(merkliste.verfuegbar()).toBe(true);
        expect(setItem).not.toHaveBeenCalled();
        expect(removeItem).not.toHaveBeenCalled();
        expect(s.schreibt).toEqual([]);
        expect(s.daten.size).toBe(0);
        // Erst das Merken schreibt, und dann genau den einen Schlüssel.
        expect(merkliste.merke(A)).toBe(true);
        expect(setItem).toHaveBeenCalledTimes(1);
        expect(s.schreibt).toEqual([MERKLISTE_SCHLUESSEL]);
    });

    it("🔴 lässt der Speicher nur das Schreiben nicht zu (Safari im privaten Fenster), ist das Merken „verfügbar“, und erst das Setzen des Häkchens sagt „gesperrt“", () => {
        const s = speicher();
        s.setItem = () => {
            throw new Error("QuotaExceededError");
        };
        const merkliste = liste(s);
        expect(merkliste.verfuegbar()).toBe(true);
        expect(merkliste.versuche(A)).toBe("gesperrt");
        expect(merkliste.merke(A)).toBe(false);
        expect(merkliste.hat(A)).toBe(false);
    });

    it("🔴 `versuche` nennt den Grund: gemerkt, voll (die Liste fasst MERKLISTE_MAX) oder gesperrt; `merke` bleibt ein Wahrheitswert", () => {
        const merkliste = liste(speicher());
        const schluessel = (nr: number): string => String(nr).padStart(43, "x");
        expect(merkliste.versuche(A)).toBe("gemerkt");
        expect(merkliste.versuche(A), "schon gemerkt").toBe("gemerkt");
        for (let nr = 0; nr < MERKLISTE_MAX - 1; nr += 1) expect(merkliste.versuche(schluessel(nr))).toBe("gemerkt");
        expect(merkliste.eintraege.value).toHaveLength(MERKLISTE_MAX);
        expect(merkliste.versuche(B)).toBe("voll");
        expect(merkliste.merke(B)).toBe(false);
        expect(merkliste.hat(B)).toBe(false);
        // Ein Eintrag, der schon da ist, bleibt auch bei voller Liste „gemerkt“.
        expect(merkliste.versuche(A)).toBe("gemerkt");
    });

    it("🔴 gibt es keinen Speicher, verschwindet die Funktion still: nicht verfügbar, nichts gemerkt, nichts geworfen", () => {
        const merkliste = liste(undefined);
        expect(merkliste.verfuegbar()).toBe(false);
        expect(merkliste.merke(A)).toBe(false);
        expect(merkliste.hat(A)).toBe(false);
        expect(merkliste.eintraege.value).toEqual([]);
        expect(() => merkliste.vergiss(A)).not.toThrow();
    });

    it("🔴 wirft der Zugriff auf den Speicher selbst (gesperrte Website-Daten), ist es dasselbe", () => {
        const merkliste = createMerkliste({
            speicher: () => {
                throw new Error("SecurityError");
            },
        });
        expect(merkliste.verfuegbar()).toBe(false);
        expect(merkliste.merke(A)).toBe(false);
        expect(merkliste.eintraege.value).toEqual([]);
        expect(() => merkliste.vergiss(A)).not.toThrow();
        expect(() => merkliste.liesNeu()).not.toThrow();
    });

    it("🔴 wirft der Speicher bei jedem Aufruf (voll, gesperrt): alles still, kein Eintrag, nicht verfügbar", () => {
        const merkliste = liste(werfend());
        expect(merkliste.eintraege.value).toEqual([]);
        expect(merkliste.verfuegbar()).toBe(false);
        expect(merkliste.merke(A)).toBe(false);
        expect(merkliste.hat(A)).toBe(false);
        expect(() => merkliste.vergiss(A)).not.toThrow();
        expect(() => merkliste.liesNeu()).not.toThrow();
    });

    it("wirft das Schreiben erst später (Speicher voll), bleibt der Stand, wie er war: nicht gemerkt", () => {
        const s = speicher();
        const merkliste = liste(s);
        merkliste.merke(A);
        s.setItem = () => {
            throw new Error("QuotaExceededError");
        };
        expect(merkliste.merke(B)).toBe(false);
        expect(merkliste.hat(B)).toBe(false);
        expect(merkliste.hat(A)).toBe(true);
    });

    it("vergessen gilt in der Sitzung auch dann, wenn der Speicher das Entfernen nicht hergibt", () => {
        const s = speicher();
        const merkliste = liste(s);
        merkliste.merke(A);
        merkliste.merke(B);
        s.setItem = () => {
            throw new Error("gesperrt");
        };
        merkliste.vergiss(A);
        expect(merkliste.hat(A)).toBe(false);
        expect(merkliste.hat(B)).toBe(true);
    });

    it("die Liste fasst höchstens MERKLISTE_MAX Einträge: darüber wird nicht gemerkt, nichts fällt heraus", () => {
        const merkliste = liste(speicher());
        const schluessel = (nr: number): string => String(nr).padStart(43, "x");
        for (let nr = 0; nr < MERKLISTE_MAX; nr += 1) expect(merkliste.merke(schluessel(nr))).toBe(true);
        expect(merkliste.merke(schluessel(MERKLISTE_MAX))).toBe(false);
        expect(merkliste.eintraege.value).toHaveLength(MERKLISTE_MAX);
        expect(merkliste.hat(schluessel(0))).toBe(true);
        // Ein schon gemerkter Schlüssel bleibt gemerkt, auch bei voller Liste.
        expect(merkliste.merke(schluessel(0))).toBe(true);
    });

    it("`liesNeu` übernimmt, was ein anderer Tab abgelegt oder gelöscht hat", () => {
        const s = speicher();
        const merkliste = liste(s);
        expect(merkliste.eintraege.value).toEqual([]);
        s.daten.set(MERKLISTE_SCHLUESSEL, JSON.stringify([{ schluessel: A, gemerktAm: JETZT.toISOString() }]));
        merkliste.liesNeu();
        expect(merkliste.hat(A)).toBe(true);
        s.daten.delete(MERKLISTE_SCHLUESSEL);
        merkliste.liesNeu();
        expect(merkliste.eintraege.value).toEqual([]);
    });
});

describe("🔴 Prüfung beim Lesen: Kaputtes und Fremdes zählt als leer und wirft nie", () => {
    const gut = { schluessel: A, gemerktAm: JETZT.toISOString() };

    it("kein JSON, kein Feld, ein Fremdes: leer", () => {
        for (const roh of [
            "{",
            "",
            "null",
            "42",
            '"text"',
            "true",
            "{}",
            '{"schluessel":"x"}',
            '{"eintraege":[]}',
            "[1,2,3]",
            "[null]",
            "[[]]",
            '["abc"]',
        ]) {
            const merkliste = liste(speicher(roh));
            expect(merkliste.eintraege.value, roh).toEqual([]);
            expect(merkliste.hat(A)).toBe(false);
        }
    });

    it("ein falscher Schlüssel, eine falsche Zeit oder ein Feld des falschen Typs lässt NUR diesen Eintrag fallen", () => {
        const roh = JSON.stringify([
            gut,
            { schluessel: "zu-kurz", gemerktAm: JETZT.toISOString() },
            { schluessel: `${"B".repeat(42)}!`, gemerktAm: JETZT.toISOString() },
            { schluessel: B, gemerktAm: "gestern" },
            { schluessel: B, gemerktAm: 5 },
            { schluessel: 7, gemerktAm: JETZT.toISOString() },
            { gemerktAm: JETZT.toISOString() },
            { schluessel: C, gemerktAm: JETZT.toISOString() },
        ]);
        const merkliste = liste(speicher(roh));
        expect(merkliste.eintraege.value.map((e) => e.schluessel).sort()).toEqual([A, C]);
    });

    it("fremde Felder werden nicht übernommen, ein Schlüssel kommt nur einmal vor, mehr als MERKLISTE_MAX werden abgeschnitten", () => {
        const fremd = { ...gut, beschreibung: "Morgennebel", bild: "AAAA" };
        const merkliste = liste(speicher(JSON.stringify([fremd, gut])));
        expect(merkliste.eintraege.value).toEqual([gut]);
        const viele = Array.from({ length: MERKLISTE_MAX + 10 }, (_, nr) => ({
            schluessel: String(nr).padStart(43, "x"),
            gemerktAm: JETZT.toISOString(),
        }));
        expect(pruefeMerkeintraege(viele)).toHaveLength(MERKLISTE_MAX);
    });

    it("die reine Prüfung gibt für alles Fremde eine leere Liste und wirft nicht", () => {
        for (const wert of [undefined, null, 1, "a", {}, [], [undefined], [{ schluessel: A }], new Date()]) {
            expect(() => pruefeMerkeintraege(wert)).not.toThrow();
            expect(pruefeMerkeintraege(wert)).toEqual([]);
        }
        expect(pruefeMerkeintraege([gut])).toEqual([gut]);
    });

    it("🔴 der Schlüssel der Merkliste ist ein eigener und kein Schlüssel eines anderen Teils des Hauses", () => {
        expect(MERKLISTE_SCHLUESSEL).toBe("avesmaps.reisebilder.gemerkt");
    });
});

describe("🔴 Schließen ohne Warnung, wenn gemerkt (gemerkt zählt wie kopiert)", () => {
    it("ohne kopiert und ohne gemerkt hält der erste Weg an; gemerkt geht jeder Weg durch", () => {
        expect(pruefeWeiter(frischerSchutz(), "zu").halt).toBe(true);
        for (const weg of ["zu", "noch-eins"] as const) {
            expect(pruefeWeiter(frischerSchutz(), weg, true).halt, weg).toBe(false);
            expect(warnungSteht(frischerSchutz(), true)).toBe(false);
        }
    });

    it("🔴 das Häkchen NACH der Warnung nimmt Hinweis und Warnring sofort weg, ein Rückgängig bringt sie nicht zurück", () => {
        const gewarnt = pruefeWeiter(frischerSchutz(), "zu").schutz;
        expect(warnungSteht(gewarnt, false)).toBe(true);
        expect(warnungSteht(gewarnt, true)).toBe(false);
        const gemerkt = nachMerken(gewarnt);
        expect(warnungSteht(gemerkt, true)).toBe(false);
        expect(warnungSteht(gemerkt, false)).toBe(false);
        // Wieder entfernt: Ohne kopierten Link hält der nächste Versuch wieder einmal an.
        expect(pruefeWeiter(gemerkt, "zu", false).halt).toBe(true);
    });

    it("kopiert UND gemerkt: nichts hält an; das Kopieren löscht die Warnung weiter", () => {
        expect(pruefeWeiter(nachKopieren(), "zu", false).halt).toBe(false);
        expect(warnungSteht(nachKopieren(), false)).toBe(false);
    });

    it("die Sätze: mit Häkchen „… kopiert oder gemerkt“, ohne den alten Satz; in allen neun Sprachen vorhanden", () => {
        expect(de["photobox.fertig.warnungMerken"]).toBe("Link noch nicht kopiert oder gemerkt.");
        expect(de["photobox.fertig.warnung"]).toBe("Link noch nicht kopiert.");
        for (const tafel of [de, en, fr, nl, itTafel, es, pl, da, sv]) {
            expect(tafel["photobox.fertig.warnungMerken"].length).toBeGreaterThan(8);
        }
    });
});

const status = (zustand: PhotoboxSubmissionState, ueber: Partial<PhotoboxStatus> = {}): PhotoboxStatus => ({
    zustand,
    eingereichtAm: "2026-11-01T09:00:00.000Z",
    beschreibung: "Morgennebel am Ochsenwasser",
    entstehung: "photo",
    nutzung: "avesmaps_only",
    lage: { x: 10, y: 20 },
    vorschauBereit: true,
    angepasst: false,
    ...ueber,
});

describe("🔴 die Zustandsmarken: In Prüfung, Rückfrage hervorgehoben, Veröffentlicht, der Rest leise", () => {
    it("jeder Zustand des Servers hat genau eine Marke", () => {
        for (const zustand of PHOTOBOX_SUBMISSION_STATES) {
            const marke = markeFuer(zustand);
            expect(marke.key, zustand).toBeTruthy();
            expect(Object.keys(de), zustand).toContain(marke.key);
        }
    });

    it("eingegangen und in Prüfung heißen beide „In Prüfung“; die Rückfrage ist hervorgehoben", () => {
        expect(markeFuer("incoming")).toEqual(markeFuer("pending"));
        expect(de[markeFuer("pending").key]).toBe("In Prüfung");
        expect(markeFuer("pending").ton).toBe("normal");
        expect(de[markeFuer("changes_requested").key]).toBe("Rückfrage");
        expect(markeFuer("changes_requested").ton).toBe("rueckfrage");
    });

    it("🔴 „Öffentlich“ ist vor der Freigaberegel nicht wahr: die Marke sagt dasselbe wie die Statusseite für `approved`", () => {
        const marke = markeFuer("approved");
        expect(marke.ton).toBe("oeffentlich");
        expect(de[marke.key]).toBe(de["photobox.status.zustand.approved"]);
        expect(en[marke.key]).toBe(en["photobox.status.zustand.approved"]);
        expect(de[marke.key]).not.toBe("Öffentlich");
    });

    it("Technischer Fehler, abgelehnt, zurückgezogen, offline, verfallen und gelöscht sind leise", () => {
        for (const zustand of ["technical_failed", "rejected", "withdrawn", "offline", "expired", "purged"] as const) {
            expect(markeFuer(zustand).ton, zustand).toBe("leise");
        }
        // Wie auf der Statusseite: „Nicht lesbar“, nicht „Technischer Fehler“ (derselbe Schlüssel).
        expect(markeFuer("technical_failed").key).toBe("photobox.status.zustand.technical_failed");
        expect(de[markeFuer("technical_failed").key]).toBe("Nicht lesbar");
        for (const [sprache, tafel] of Object.entries({ de, en, fr, nl, it: itTafel, es, pl, da, sv })) {
            const tabelle: Readonly<Record<string, string>> = tafel;
            expect(tabelle[markeFuer("technical_failed").key], sprache).toBe(
                tabelle["photobox.status.zustand.technical_failed"],
            );
        }
        expect(de[markeFuer("rejected").key]).toBe(de["photobox.status.zustand.rejected"]);
        expect(de[markeFuer("withdrawn").key]).toBe(de["photobox.status.zustand.withdrawn"]);
        expect(de[markeFuer("offline").key]).toBe(de["photobox.status.zustand.offline"]);
    });

    it("„Nicht mehr vorhanden“ und „Stand gerade nicht abrufbar“ sind leise Marken ohne Zustand des Servers", () => {
        expect(de[MARKE_WEG.key]).toBe("Nicht mehr vorhanden");
        expect(de[MARKE_UNKLAR.key]).toBe("Stand gerade nicht abrufbar");
        expect(MARKE_WEG.ton).toBe("leise");
        expect(MARKE_UNKLAR.ton).toBe("leise");
    });

    it("die Art steht in der Liste kurz („Gemalt“ statt „Gemalt oder gezeichnet“)", () => {
        expect(de[ART_KURZ.drawing]).toBe("Gemalt");
        expect(de[ART_KURZ.photo]).toBe("Foto");
        expect(de[ART_KURZ.ai_generated]).toBe("KI-Bild");
        expect(de[ART_KURZ.avesmaps_capture]).toBe("Aufnahme");
    });
});

/** Ein Umfeld mit Protokoll: Wer wann gefragt wurde, und wie viele Fragen zugleich liefen. */
function umfeld(antworten: Readonly<Record<string, PhotoboxStatus | ApiFailure>>) {
    const protokoll: string[] = [];
    let laeuft = 0;
    let zugleich = 0;
    const warte = async <T>(wert: T): Promise<T> => {
        laeuft += 1;
        zugleich = Math.max(zugleich, laeuft);
        await Promise.resolve();
        await Promise.resolve();
        laeuft -= 1;
        return wert;
    };
    return {
        protokoll,
        zugleich: () => zugleich,
        umfeld: {
            leseStatus: async (schluessel: string): Promise<PhotoboxStatus> => {
                protokoll.push(`status:${schluessel.slice(0, 1)}`);
                const antwort = await warte(antworten[schluessel]);
                if (antwort === undefined) throw new ApiFailure(404, "photobox_not_found", "nicht da");
                if (antwort instanceof ApiFailure) throw antwort;
                return antwort;
            },
            ladeVorschau: async (schluessel: string): Promise<Blob | "fehlt"> => {
                protokoll.push(`vorschau:${schluessel.slice(0, 1)}`);
                return warte(new Blob(["x"], { type: "image/webp" }));
            },
            fehlerArt,
        },
    };
}

function sammler() {
    const ergebnisse = new Map<string, MeinErgebnis>();
    const vorschauen: string[] = [];
    const ausgang: MeineAusgang = {
        stand: (schluessel, ergebnis) => {
            ergebnisse.set(schluessel, ergebnis);
        },
        vorschau: (schluessel) => {
            vorschauen.push(schluessel);
        },
    };
    return { ergebnisse, vorschauen, ausgang };
}

describe("🔴 der Stand je Eintrag: nacheinander, nur über die Status-Route, bei der Lesegrenze nichts erfunden", () => {
    it("fragt einen Eintrag nach dem anderen (nie zwei zugleich), erst den Stand, dann die Vorschau", async () => {
        const werk = umfeld({ [A]: status("pending"), [B]: status("approved"), [C]: status("changes_requested") });
        const s = sammler();
        await ladeMeine(werk.umfeld, [A, B, C], s.ausgang).fertig;
        expect(werk.protokoll).toEqual(["status:A", "vorschau:A", "status:B", "vorschau:B", "status:C", "vorschau:C"]);
        expect(werk.zugleich()).toBe(1);
        expect(s.ergebnisse.get(B)).toEqual({ art: "da", status: status("approved") });
        expect(s.vorschauen).toEqual([A, B, C]);
    });

    it("die Vorschau wird nur geholt, wenn der Stand `vorschauBereit` sagt; ein Bild, das noch fehlt, ist kein Fehler", async () => {
        const werk = umfeld({ [A]: status("pending", { vorschauBereit: false }) });
        const s = sammler();
        await ladeMeine(werk.umfeld, [A], s.ausgang).fertig;
        expect(werk.protokoll).toEqual(["status:A"]);
        expect(s.ergebnisse.get(A)?.art).toBe("da");
        expect(s.vorschauen).toEqual([]);

        const fehlt = umfeld({ [A]: status("pending") });
        fehlt.umfeld.ladeVorschau = () => Promise.resolve("fehlt");
        const t = sammler();
        await ladeMeine(fehlt.umfeld, [A], t.ausgang).fertig;
        expect(t.ergebnisse.get(A)?.art).toBe("da");
        expect(t.vorschauen).toEqual([]);
    });

    it("🔴 eine verschwundene Einreichung ist „weg“ (Nicht mehr vorhanden); die übrigen werden trotzdem gefragt", async () => {
        const werk = umfeld({ [B]: status("pending") });
        const s = sammler();
        await ladeMeine(werk.umfeld, [A, B], s.ausgang).fertig;
        expect(s.ergebnisse.get(A)).toEqual({ art: "weg" });
        expect(s.ergebnisse.get(B)?.art).toBe("da");
    });

    it("🔴 bei der Lesegrenze (429) wird der Rest nicht mehr gefragt und nicht erfunden: alle übrigen sind „nicht abrufbar“", async () => {
        const werk = umfeld({
            [A]: status("pending"),
            [B]: new ApiFailure(429, "photobox_rate", "zu viele"),
            [C]: status("pending"),
        });
        const s = sammler();
        await ladeMeine(werk.umfeld, [A, B, C], s.ausgang).fertig;
        expect(s.ergebnisse.get(A)?.art).toBe("da");
        expect(s.ergebnisse.get(B)).toEqual({ art: "unklar" });
        expect(s.ergebnisse.get(C)).toEqual({ art: "unklar" });
        expect(werk.protokoll).not.toContain("status:C");
    });

    it("ein Netzfehler oder ein Serverfehler macht nur diese Karte „nicht abrufbar“, die nächste wird gefragt", async () => {
        const werk = umfeld({
            [A]: new ApiFailure(0, "network", "weg"),
            [B]: new ApiFailure(500, "internal", "kaputt"),
            [C]: status("approved"),
        });
        const s = sammler();
        await ladeMeine(werk.umfeld, [A, B, C], s.ausgang).fertig;
        expect(s.ergebnisse.get(A)).toEqual({ art: "unklar" });
        expect(s.ergebnisse.get(B)).toEqual({ art: "unklar" });
        expect(s.ergebnisse.get(C)?.art).toBe("da");
    });

    it("🔴 ein Fehler der Vorschau ändert den Stand der Karte nicht (nur das Bild bleibt das Symbol)", async () => {
        const werk = umfeld({ [A]: status("pending") });
        werk.umfeld.ladeVorschau = () => Promise.reject(new ApiFailure(500, "internal", "kaputt"));
        const s = sammler();
        await ladeMeine(werk.umfeld, [A], s.ausgang).fertig;
        expect(s.ergebnisse.get(A)?.art).toBe("da");
        expect(s.vorschauen).toEqual([]);
    });

    it("🔴 stoppen (Fenster zu): späte Antworten gelten nicht mehr, es wird nichts weiter gefragt", async () => {
        const werk = umfeld({ [A]: status("pending"), [B]: status("pending") });
        const s = sammler();
        const lauf = ladeMeine(werk.umfeld, [A, B], s.ausgang);
        lauf.stoppe();
        await lauf.fertig;
        expect(s.ergebnisse.size).toBe(0);
        expect(s.vorschauen).toEqual([]);
        expect(werk.protokoll).not.toContain("status:B");
    });

    it("🔴 M2: ein zweiter Durchgang innerhalb von 60 s (der Rückweg zur Liste) fragt nichts mehr; danach wieder", async () => {
        const werk = umfeld({ [A]: status("pending"), [B]: status("approved") });
        const cache = createMeinCache();
        let uhr = 1_000;
        const optionen = { cache, jetzt: () => uhr };
        const s1 = sammler();
        await ladeMeine(werk.umfeld, [A, B, C], s1.ausgang, optionen).fertig;
        const erste = [...werk.protokoll];
        expect(erste).toEqual(["status:A", "vorschau:A", "status:B", "vorschau:B", "status:C"]);

        // Der Rückweg 5 s später: dieselben Karten, aber keine einzige Anfrage.
        uhr += 5_000;
        const s2 = sammler();
        await ladeMeine(werk.umfeld, [A, B, C], s2.ausgang, optionen).fertig;
        expect(werk.protokoll, "keine neue Anfrage").toEqual(erste);
        expect(s2.ergebnisse.get(A)).toEqual({ art: "da", status: status("pending") });
        expect(s2.ergebnisse.get(B)?.art).toBe("da");
        expect(s2.ergebnisse.get(C)).toEqual({ art: "weg" });
        expect(s2.vorschauen, "die Vorschauen kommen aus dem Speicher der Sitzung").toEqual([A, B]);

        // Nach 60 s gilt es nicht mehr.
        uhr += MEIN_CACHE_MS;
        const s3 = sammler();
        await ladeMeine(werk.umfeld, [A, B, C], s3.ausgang, optionen).fertig;
        expect(werk.protokoll.length).toBe(erste.length * 2);
    });

    it("🔴 M2: ohne Cache fragt jeder Durchgang neu; ein Fehler („nicht abrufbar“) wird nie zwischengespeichert", async () => {
        const werk = umfeld({ [A]: new ApiFailure(500, "internal", "kaputt") });
        const cache = createMeinCache();
        await ladeMeine(werk.umfeld, [A], sammler().ausgang, { cache, jetzt: () => 1 }).fertig;
        await ladeMeine(werk.umfeld, [A], sammler().ausgang, { cache, jetzt: () => 2 }).fertig;
        expect(werk.protokoll).toEqual(["status:A", "status:A"]);
        const ohne = umfeld({ [A]: status("pending") });
        await ladeMeine(ohne.umfeld, [A], sammler().ausgang).fertig;
        await ladeMeine(ohne.umfeld, [A], sammler().ausgang).fertig;
        expect(ohne.protokoll).toEqual(["status:A", "vorschau:A", "status:A", "vorschau:A"]);
    });

    it("🔴 M2: eine Vorschau holt nur, wo das Bild noch eine Rolle spielt (eingegangen, in Prüfung, Rückfrage, freigegeben)", async () => {
        const zustaende: readonly PhotoboxSubmissionState[] = [
            "incoming",
            "pending",
            "changes_requested",
            "approved",
            "technical_failed",
            "rejected",
            "withdrawn",
            "offline",
            "expired",
            "purged",
        ];
        for (const zustand of zustaende) {
            const werk = umfeld({ [A]: status(zustand) });
            await ladeMeine(werk.umfeld, [A], sammler().ausgang).fertig;
            const holt = ["incoming", "pending", "changes_requested", "approved"].includes(zustand);
            expect(werk.protokoll, zustand).toEqual(holt ? ["status:A", "vorschau:A"] : ["status:A"]);
        }
    });

    it("🔴 M2: die Statusseite hält den Zwischenspeicher aktuell: ein dort geänderter Stand gilt auch in der Liste, ein Vergessen räumt ihn", async () => {
        const werk = umfeld({ [A]: status("pending") });
        const cache = createMeinCache();
        const optionen = { cache, jetzt: () => 10 };
        await ladeMeine(werk.umfeld, [A], sammler().ausgang, optionen).fertig;
        // Die Statusseite hat das Reisebild zurückgezogen.
        cache.aktualisiere(A, status("withdrawn"), 20);
        const s = sammler();
        await ladeMeine(werk.umfeld, [A], s.ausgang, { cache, jetzt: () => 30 }).fertig;
        expect(werk.protokoll).toEqual(["status:A", "vorschau:A"]);
        expect(s.ergebnisse.get(A)).toEqual({ art: "da", status: status("withdrawn") });
        expect(s.vorschauen, "ein zurückgezogenes Bild zeigt keine Vorschau").toEqual([]);
        cache.vergiss(A);
        await ladeMeine(werk.umfeld, [A], sammler().ausgang, { cache, jetzt: () => 40 }).fertig;
        expect(werk.protokoll.filter((zeile) => zeile === "status:A")).toHaveLength(2);
    });

    it("🔴 M3: ein Schlüssel, der unterwegs vergessen wurde, wird nicht mehr gefragt und meldet nichts mehr (kein Stand, keine Vorschau)", async () => {
        const werk = umfeld({ [A]: status("pending"), [B]: status("pending"), [C]: status("pending") });
        const gemerkt = new Set([A, B, C]);
        const s = sammler();
        const lauf = ladeMeine({ ...werk.umfeld, noch: (schluessel) => gemerkt.has(schluessel) }, [A, B, C], {
            stand: (schluessel, ergebnis) => {
                s.ausgang.stand(schluessel, ergebnis);
                // Wer A sieht, vergisst B (in diesem oder in einem anderen Tab), bevor die Reihe an B ist.
                if (schluessel === A) gemerkt.delete(B);
            },
            vorschau: s.ausgang.vorschau,
        });
        await lauf.fertig;
        expect(werk.protokoll).not.toContain("status:B");
        expect(s.ergebnisse.has(B)).toBe(false);
        expect(s.ergebnisse.get(C)?.art).toBe("da");
    });

    it("🔴 M3: wird der Schlüssel während der Antwort vergessen, legt die späte Antwort nichts mehr an", async () => {
        const werk = umfeld({ [A]: status("pending") });
        const gemerkt = new Set([A]);
        const s = sammler();
        const leseStatus = werk.umfeld.leseStatus;
        const lauf = ladeMeine(
            {
                ...werk.umfeld,
                leseStatus: async (schluessel) => {
                    const antwort = await leseStatus(schluessel);
                    gemerkt.delete(schluessel);
                    return antwort;
                },
                noch: (schluessel) => gemerkt.has(schluessel),
            },
            [A],
            s.ausgang,
        );
        await lauf.fertig;
        expect(s.ergebnisse.size).toBe(0);
        expect(s.vorschauen).toEqual([]);
        expect(werk.protokoll).toEqual(["status:A"]);
    });

    it("🔴 M3: was ein anderer Tab inzwischen gemerkt hat, wird am Ende des Durchgangs nachgefragt", async () => {
        const werk = umfeld({ [A]: status("pending"), [B]: status("approved") });
        const jetzt = [A];
        const s = sammler();
        await ladeMeine({ ...werk.umfeld, aktuelle: () => jetzt }, [A], {
            stand: (schluessel, ergebnis) => {
                s.ausgang.stand(schluessel, ergebnis);
                // Während A geladen wird, merkt ein anderer Tab B.
                if (schluessel === A && !jetzt.includes(B)) jetzt.push(B);
            },
            vorschau: s.ausgang.vorschau,
        }).fertig;
        expect(werk.protokoll).toEqual(["status:A", "vorschau:A", "status:B", "vorschau:B"]);
        expect(s.ergebnisse.get(B)?.art).toBe("da");
    });

    it("kein Takt und keine Schleife: ein Durchgang, danach nichts mehr", async () => {
        const werk = umfeld({ [A]: status("pending", { vorschauBereit: false }) });
        const s = sammler();
        await ladeMeine(werk.umfeld, [A], s.ausgang).fertig;
        await new Promise((fertig) => setTimeout(fertig, 30));
        expect(werk.protokoll).toEqual(["status:A"]);
    });
});

describe("🔴 der Schlüssel landet in keinem Log, auch wenn alles schiefgeht", () => {
    it("Merken, Vergessen, Lesen und Laden schreiben nichts in die Konsole: bei heilem, gesperrtem und kaputtem Speicher und bei jedem Fehler des Servers", async () => {
        const arten = ["log", "info", "warn", "error", "debug"] as const;
        const spione = arten.map((art) => vi.spyOn(console, art).mockImplementation(() => undefined));
        try {
            for (const ziel of [speicher(), werfend(), speicher("kein json"), undefined]) {
                const merkliste = liste(ziel);
                merkliste.verfuegbar();
                merkliste.versuche(A);
                merkliste.hat(A);
                merkliste.liesNeu();
                merkliste.vergiss(A);
            }
            const werk = umfeld({
                [A]: new ApiFailure(500, "internal", "kaputt"),
                [B]: new ApiFailure(429, "photobox_rate", "zu viele"),
                [C]: status("pending"),
            });
            await ladeMeine(werk.umfeld, [A, B, C], sammler().ausgang, { cache: createMeinCache() }).fertig;
            const werk2 = umfeld({ [A]: new ApiFailure(0, "network", "weg"), [B]: status("approved") });
            await ladeMeine(werk2.umfeld, [A, B], sammler().ausgang).fertig;
        } finally {
            for (const spion of spione) spion.mockRestore();
        }
        for (const [nr, spion] of spione.entries()) expect(spion, arten[nr]).not.toHaveBeenCalled();
    });

    it("die Merkliste hält sich an ihren EINEN Schlüssel im Speicher: nichts sonst, auch nicht beim Scheitern", () => {
        const s = speicher();
        const merkliste = liste(s);
        merkliste.versuche(A);
        merkliste.versuche(B);
        merkliste.vergiss(A);
        merkliste.versuche(A);
        expect([...s.daten.keys()]).toEqual([MERKLISTE_SCHLUESSEL]);
        expect(new Set(s.schreibt)).toEqual(new Set([MERKLISTE_SCHLUESSEL]));
    });
});

describe("Sprachtafeln: die neuen Schlüssel stehen in allen neun, der Satz zum Link verspricht nichts Falsches mehr", () => {
    const TAFELN = { de, en, fr, nl, it: itTafel, es, pl, da, sv } as const;
    const NEU: readonly MessageKey[] = [
        "ctxmenu.meineReisebilder",
        "photobox.merken.label",
        "photobox.merken.hinweis",
        "photobox.merken.gemerkt",
        "photobox.merken.gemerktHinweis",
        "photobox.merken.vergessen",
        "photobox.merken.voll",
        "photobox.merken.gesperrt",
        "photobox.fertig.warnungMerken",
        "photobox.meine.titel",
        "photobox.meine.unterzeile",
        "photobox.meine.fuss",
        "photobox.meine.leer",
        "photobox.meine.leerHinweis",
        "photobox.meine.laedt",
        "photobox.meine.zurueck",
        "photobox.meine.frage",
        "photobox.meine.gemeldet",
        "photobox.meine.marke.pruefung",
        "photobox.meine.marke.rueckfrage",
        "photobox.meine.marke.oeffentlich",
        "photobox.meine.marke.abgelehnt",
        "photobox.meine.marke.zurueckgezogen",
        "photobox.meine.marke.offline",
        "photobox.meine.marke.verfallen",
        "photobox.meine.marke.geloescht",
        "photobox.meine.marke.weg",
        "photobox.meine.marke.unklar",
        "photobox.meine.art.drawing",
        "photobox.meine.art.photo",
        "photobox.meine.art.ai_generated",
        "photobox.meine.art.avesmaps_capture",
    ];

    it("jeder neue Schlüssel hat in jeder Sprache einen nicht leeren Text", () => {
        for (const [sprache, tafel] of Object.entries(TAFELN)) {
            const tabelle: Readonly<Record<string, string>> = tafel;
            for (const key of NEU) expect(tabelle[key]?.trim().length ?? 0, `${sprache}: ${key}`).toBeGreaterThan(1);
        }
    });

    it("🔴 „Der Link selbst wird nirgends gespeichert.“ fällt in allen neun Sprachen aus dem Satz im Linkkasten", () => {
        expect(de["photobox.fertig.linkHinweis"]).toBe(
            "Nur über diesen Link lässt sich das Bild ändern, zurückziehen oder offline nehmen.",
        );
        expect(en["photobox.fertig.linkHinweis"]).toBe(
            "Only through this link can the picture be changed, withdrawn or taken offline.",
        );
        for (const [sprache, tafel] of Object.entries(TAFELN)) {
            const tabelle: Readonly<Record<string, string>> = tafel;
            expect(tabelle["photobox.fertig.linkHinweis"], sprache).not.toMatch(/nirgends|nowhere|stored/u);
        }
    });

    it("🔴 kein Besuchertext zum Link behauptet noch, der Link werde nirgends gespeichert (in keiner Sprache)", () => {
        for (const [sprache, tafel] of Object.entries(TAFELN)) {
            const tabelle: Readonly<Record<string, string>> = tafel;
            for (const [key, text] of Object.entries(tabelle)) {
                if (!key.startsWith("photobox.")) continue;
                expect(text, `${sprache}: ${key}`).not.toMatch(
                    /link selbst wird nirgends|stored nowhere|nirgends gespeichert/iu,
                );
            }
        }
    });

    it("die Texte zum Merken sagen, wo gemerkt wird: nur in diesem Browser, nicht auf dem Server", () => {
        expect(de["photobox.merken.hinweis"]).toBe(
            "Nur in diesem Browser, abrufbar unter „Meine Reisebilder“ im Kartenmenü.",
        );
        expect(de["photobox.merken.gemerkt"]).toBe("Auf diesem Gerät gemerkt");
        expect(de["photobox.merken.label"]).toBe("Auf diesem Gerät merken");
        expect(de["photobox.meine.fuss"]).toBe(
            "Gemerkt wird nur in diesem Browser. Wer den Browserspeicher leert, verliert die Liste; der persönliche Link gilt weiter.",
        );
        expect(de["photobox.meine.frage"]).toBe("Nur von diesem Gerät entfernen? Das Reisebild bleibt eingereicht.");
        expect(de["photobox.meine.gemeldet"]).toBe("Vergessen. Das Reisebild bleibt eingereicht.");
    });
});

describe("„Meine Reisebilder“ in der Leiste (Probierseite Fassung 2, Idee B)", () => {
    const karte = (id: string) =>
        ({
            id,
            lage: { x: 1, y: 2 },
            datei: { url: "/media/a.webp", breite: 10, hoehe: 10 },
            beschreibung: id,
            entstehung: "drawing",
        }) as const;

    it("🔴 Veröffentlichtes kommt als Karte, Offenes als Kachel mit Marke, Abgeschlossenes bleibt im Fenster", () => {
        const stand = meineLeiste(["frei", "pruefung", "eingang", "rueckfrage", "ab", "still", "weg", "fehlt"], {
            frei: { art: "da", status: status("approved", { karte: karte("k1") }) },
            pruefung: { art: "da", status: status("pending") },
            eingang: { art: "da", status: status("incoming") },
            rueckfrage: { art: "da", status: status("changes_requested") },
            ab: { art: "da", status: status("rejected") },
            still: { art: "da", status: status("approved") },
            weg: { art: "weg" },
        });
        expect(stand.karten.map((k) => k.id)).toEqual(["k1"]);
        expect(stand.offene.map((o) => o.schluessel)).toEqual(["pruefung", "eingang", "rueckfrage"]);
        expect(stand.offene[2]?.marke).toBe(markeFuer("changes_requested"));
        expect(stand.unklar).toBe(false);
    });

    it("ein Stand, der nicht abrufbar war, wird gemeldet und nicht erfunden", () => {
        const stand = meineLeiste(["a"], { a: { art: "unklar" } });
        expect(stand).toEqual({ karten: [], offene: [], unklar: true });
    });

    it("🔴 ein veröffentlichtes Bild kostet keine zweite Frage: Die Leiste holt seine Vorschau nicht", async () => {
        const ladeVorschau = vi.fn(async () => new Blob(["x"]));
        const staende: Record<string, PhotoboxStatus> = {
            frei: status("approved", { vorschauBereit: true, karte: karte("k1") }),
            offen: status("pending", { vorschauBereit: true }),
        };
        const lauf = ladeMeine(
            { leseStatus: async (s) => staende[s]!, ladeVorschau, fehlerArt: () => "sonst" },
            ["frei", "offen"],
            { stand: () => undefined, vorschau: () => undefined },
            { mitVorschau: (s) => s.karte === undefined },
        );
        await lauf.fertig;
        expect(ladeVorschau.mock.calls).toEqual([["offen"]]);
    });
});
