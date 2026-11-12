import { describe, expect, it, vi } from "vitest";
import type { EditorLock, EditorLockTarget, OperationReceipt } from "@avesmaps3d/shared";
import type { NimmErgebnis } from "../src/editor-sperre/sperre";
import { createBearbeitung, type BearbeitungsArt, type SchreibAntwort, type Stand } from "../src/fenster/bearbeitung";
import { ENTWURF_SCHRITTE } from "../src/fenster/entwurf-kern";
import type { FolgeArbeit } from "../src/fenster/folge-arbeit";
import { t as uebersetze } from "../src/i18n/i18n";

/**
 * Der gemeinsame Fensterrumpf (O3, EDIT-0003 §6 „Gemeinsame Pakete“; Schnittstelle im Kopf von `fenster/bearbeitung.ts`) an einer
 * erfundenen Art „Zettel“: Felder (Name, Größe) und eine Form (Zahlenreihe), ohne Karte und ohne Server.
 *
 * Problemfälle: Felder und Form gehen in zwei Operationen; ↶ kennt nur eine der beiden Arten von Schritten; Tippen wird zu einem
 * Schritt je Taste; ↶ geht über 20 Schritte zurück; ein Konflikt verwirft den Entwurf; „anwenden“ überschreibt fremde Felder;
 * die Sperre eines anderen wird übergangen; eine abgelaufene Sperre lässt den Entwurf fallen; Verlassen schreibt still oder verwirft
 * still; der Entwurf überlebt das Neuladen nicht; „Fertig“ oder „Speichern“ schreibt einen Stand, dem noch etwas fehlt.
 */

interface Zettel {
    readonly id: string;
    readonly revision: number;
    readonly name: string;
    readonly groesse: number;
    readonly punkte: readonly number[];
}
interface Felder {
    readonly name: string;
    readonly groesse: number;
}
type Form = readonly number[];
interface Koerper {
    readonly operationId: string;
    readonly baseRevision: number;
    readonly changes: Partial<Felder>;
    readonly punkte?: readonly number[];
}

const ID = "z1";
const START: Zettel = { id: ID, revision: 3, name: "Gareth", groesse: 2, punkte: [1, 2, 3] };

const quittung = (revision: number): OperationReceipt => ({
    operationId: "op",
    status: "applied",
    environment: "test",
    affected: [{ kind: "zettel", id: ID, revision }],
    derivedWork: [],
    warnings: [],
    mapRevision: 42,
});

const FELDER = ["name", "groesse"] as const;

function geaendert(d: Pick<Zettel, "name" | "groesse" | "punkte">, s: Stand<Felder, Form>): string[] {
    const raus: string[] = FELDER.filter((feld) => s.felder[feld] !== d[feld]);
    if (s.form !== undefined && s.form.join() !== d.punkte.join()) raus.push("form");
    return raus;
}

function aufbau(
    optionen: {
        sperre?: NimmErgebnis["art"];
        speicher?: Storage;
        gelesen?: Zettel;
        pruefe?: BearbeitungsArt<Zettel, Felder, Form, Koerper>["pruefe"];
        folge?: Pick<FolgeArbeit, "vormerke">;
    } = {},
) {
    let gelesen: Zettel = optionen.gelesen ?? START;
    /** Hält das nächste Lesen an, bis die Probe es freigibt (das Neulesen nach dem Schreiben). */
    let halt: Promise<void> | undefined;
    const gesendet: Koerper[] = [];
    const antworten: SchreibAntwort[] = [];
    const art: BearbeitungsArt<Zettel, Felder, Form, Koerper> = {
        sperrArt: "landscape",
        lade: vi.fn(async () => {
            await halt;
            return gelesen;
        }),
        felder: (d) => ({ name: d.name, groesse: d.groesse }),
        operation(d, start, jetzt, operationId) {
            const changes: Partial<Felder> = {};
            for (const feld of FELDER)
                if (jetzt.felder[feld] !== start.felder[feld]) Object.assign(changes, { [feld]: jetzt.felder[feld] });
            const form = jetzt.form !== undefined && jetzt.form.join() !== (start.form ?? d.punkte).join();
            if (Object.keys(changes).length === 0 && !form) return undefined;
            return { operationId, baseRevision: d.revision, changes, ...(form ? { punkte: jetzt.form } : {}) };
        },
        async schreibe(_id, body) {
            gesendet.push(body);
            return (
                antworten.shift() ?? {
                    ok: true,
                    quittung: quittung(body.baseRevision + 1),
                }
            );
        },
        geaendert,
        fremde: (vorher, jetzt) =>
            geaendert(vorher, { felder: { name: jetzt.name, groesse: jetzt.groesse }, form: jetzt.punkte }),
        aufNeuenStand(vorher, jetzt, s) {
            const eigene = geaendert(vorher, s);
            return {
                felder: {
                    name: eigene.includes("name") ? s.felder.name : jetzt.name,
                    groesse: eigene.includes("groesse") ? s.felder.groesse : jetzt.groesse,
                },
                form: eigene.includes("form") ? s.form : s.form === undefined ? undefined : jetzt.punkte,
            };
        },
        sicherung: {
            version: 1,
            aus: (s) => s,
            ein: (x) => x as Stand<Felder, Form>,
        },
        ...(optionen.pruefe === undefined ? {} : { pruefe: optionen.pruefe }),
    };
    const genommen: string[] = [];
    const freigegeben: string[] = [];
    let verlust: ((ziel: EditorLockTarget) => void) | undefined;
    const sperre = {
        nimm: vi.fn(async (_ziel: EditorLockTarget, teil: EditorLock["part"]): Promise<NimmErgebnis> => {
            genommen.push(teil);
            const lock: EditorLock = {
                kind: "landscape",
                id: ID,
                part: teil,
                person: { id: "p2", name: "Thomas" },
                since: "2026-10-17T10:00:00Z",
                heartbeatAt: "2026-10-17T10:00:00Z",
                own: false,
            };
            return optionen.sperre === "gesperrt"
                ? { art: "gesperrt", sperre: lock }
                : { art: "genommen", sperre: { ...lock, own: true } };
        }),
        gib: vi.fn((ziel: EditorLockTarget) => void freigegeben.push(ziel.id)),
        beiVerlust(zuhoerer: (ziel: EditorLockTarget) => void) {
            verlust = zuhoerer;
            return () => (verlust = undefined);
        },
    };
    const karte = { geaendert: vi.fn() };
    let nr = 0;
    const bearbeitung = createBearbeitung(art, {
        id: ID,
        titel: "Gareth",
        sperre,
        karte,
        speicher: optionen.speicher,
        neueKennung: () => `op-${String((nr += 1))}`,
        folge: optionen.folge,
    });
    return {
        bearbeitung,
        gesendet,
        antworten,
        genommen,
        freigegeben,
        karte,
        setzeGelesen: (neu: Zettel) => (gelesen = neu),
        haltLesen: (bis: Promise<void>) => (halt = bis),
        verliereSperre: () => verlust?.({ kind: "landscape", id: ID }),
    };
}

const geladen = async (b: ReturnType<typeof aufbau>["bearbeitung"]): Promise<void> => {
    await vi.waitFor(() => expect(b.zustand.value.art).toBe("bereit"));
};

function speicherAttrappe(): Storage {
    const daten = new Map<string, string>();
    return {
        get length() {
            return daten.size;
        },
        clear: () => daten.clear(),
        getItem: (k) => daten.get(k) ?? null,
        key: (i) => [...daten.keys()][i] ?? null,
        removeItem: (k) => void daten.delete(k),
        setItem: (k, v) => void daten.set(k, v),
    };
}

describe("Fensterrumpf O3: EIN Entwurf für Felder und Form", () => {
    it("schreibt Feld- und Formschritte als EINE Operation", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        const form = t.bearbeitung.formEntwurf();
        form.beginne([1, 2, 3]);
        form.schritt([1, 5, 3]);
        expect(t.bearbeitung.lage.value.ungespeichert).toBe(2);
        await t.bearbeitung.fertig();
        expect(t.gesendet).toEqual([
            { operationId: "op-1", baseRevision: 3, changes: { name: "Garetien" }, punkte: [1, 5, 3] },
        ]);
        expect(t.bearbeitung.zustand.value.art).toBe("gespeichert");
        expect(t.bearbeitung.lage.value.aktiv).toBe(false);
        expect(t.karte.geaendert).toHaveBeenCalledWith(42);
        expect(t.freigegeben).toEqual([ID]);
    });

    it("↶ nimmt den jüngsten Schritt zurück, egal ob Feld oder Form", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        const form = t.bearbeitung.formEntwurf();
        form.beginne([1, 2, 3]);
        form.schritt([9, 2, 3]);
        t.bearbeitung.feld((f) => ({ ...f, groesse: 4 }));
        t.bearbeitung.zurueck();
        expect(t.bearbeitung.stand.value).toEqual({ felder: { name: "Gareth", groesse: 2 }, form: [9, 2, 3] });
        t.bearbeitung.zurueck();
        expect(form.jetzt()).toEqual([1, 2, 3]);
        t.bearbeitung.wieder();
        expect(form.jetzt()).toEqual([9, 2, 3]);
    });

    it("die Form, mitten im Felder-Entwurf gestartet, steht in allen Ständen (↶ bis zum Start ändert keine Form)", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        t.bearbeitung.formEntwurf().beginne([1, 2, 3]);
        t.bearbeitung.zurueck();
        expect(t.bearbeitung.stand.value?.form).toEqual([1, 2, 3]);
        await t.bearbeitung.fertig();
        expect(t.gesendet).toEqual([]);
    });

    it("Tippen in EINEM Feld ist EIN Schritt, ein anderes Feld ein zweiter", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        for (const name of ["G", "Ga", "Gar"]) t.bearbeitung.feld((f) => ({ ...f, name }), "name");
        expect(t.bearbeitung.lage.value.ungespeichert).toBe(1);
        t.bearbeitung.feld((f) => ({ ...f, groesse: 5 }), "groesse");
        expect(t.bearbeitung.lage.value.ungespeichert).toBe(2);
        t.bearbeitung.zurueck();
        t.bearbeitung.feld((f) => ({ ...f, name: "Garx" }), "name");
        // Nach ↶ verschmilzt nichts mehr mit dem Schritt davor.
        expect(t.bearbeitung.lage.value.ungespeichert).toBe(2);
    });

    it("nach dem Verlassen des Felds ist die nächste Änderung desselben Felds ein neuer Schritt", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Ga" }), "name");
        t.bearbeitung.feldVerlassen();
        t.bearbeitung.feld((f) => ({ ...f, name: "Gar" }), "name");
        expect(t.bearbeitung.lage.value.ungespeichert).toBe(2);
    });

    it(`↶ geht höchstens ${String(ENTWURF_SCHRITTE)} Schritte zurück`, async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        for (let i = 1; i <= ENTWURF_SCHRITTE + 5; i += 1) t.bearbeitung.feld((f) => ({ ...f, groesse: i }));
        let zurueck = 0;
        while (t.bearbeitung.lage.value.zurueck) {
            t.bearbeitung.zurueck();
            zurueck += 1;
        }
        expect(zurueck).toBe(ENTWURF_SCHRITTE);
    });
});

describe("Fensterrumpf O3: Sperre", () => {
    it("die erste Feldänderung nimmt die Sperre der Felder, die Form die der Form", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(t.genommen).toEqual(["felder"]));
        t.bearbeitung.formEntwurf().beginne([1, 2, 3]);
        await vi.waitFor(() => expect(t.genommen).toEqual(["felder", "form"]));
    });

    it("hält ein anderer das Objekt, beginnt nichts: die Änderung fällt zurück, der Satz nennt ihn", async () => {
        const t = aufbau({ sperre: "gesperrt" });
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(t.bearbeitung.zustand.value).toMatchObject({ art: "gesperrt", wer: "Thomas" }));
        expect(t.bearbeitung.lage.value.ungespeichert).toBe(0);
        expect(t.bearbeitung.stand.value?.felder.name).toBe("Gareth");
    });

    it("eine abgelaufene Sperre lässt den Entwurf stehen und bietet anwenden · übernehmen · überschreiben", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(t.genommen).toHaveLength(1));
        t.verliereSperre();
        expect(t.bearbeitung.zustand.value).toMatchObject({ art: "konflikt", grund: "sperre" });
        expect(t.bearbeitung.stand.value?.felder.name).toBe("Garetien");
        await t.bearbeitung.eigeneAnwenden();
        expect(t.genommen).toHaveLength(2);
        expect(t.gesendet.map((b) => b.changes)).toEqual([{ name: "Garetien" }]);
    });
});

describe("Fensterrumpf O3: Konflikt (409)", () => {
    const konflikt: SchreibAntwort = {
        ok: false,
        status: 409,
        fehler: {
            code: "edit_conflict",
            message: "Jemand war schneller.",
            details: { changedBy: { displayName: "Thomas" }, changedAt: "2026-10-17T10:05:00Z" },
        },
    };

    it("ohne Überschneidung: anwenden schickt nur die eigenen Felder gegen die neue Revision", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        t.antworten.push(konflikt);
        t.setzeGelesen({ ...START, revision: 4, groesse: 3 });
        await t.bearbeitung.fertig();
        expect(t.bearbeitung.zustand.value).toMatchObject({
            art: "konflikt",
            grund: "fremd",
            wer: "Thomas",
            eigene: ["name"],
            fremde: ["groesse"],
            beide: [],
        });
        expect(t.bearbeitung.stand.value?.felder.name).toBe("Garetien");
        await t.bearbeitung.eigeneAnwenden();
        expect(t.gesendet.at(-1)).toMatchObject({ baseRevision: 4, changes: { name: "Garetien" } });
    });

    it("mit Überschneidung: anwenden geht nicht, überschreiben schon, übernehmen verwirft", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        t.antworten.push(konflikt);
        t.setzeGelesen({ ...START, revision: 4, name: "Gareth (Stadt)" });
        await t.bearbeitung.fertig();
        expect(t.bearbeitung.zustand.value).toMatchObject({ art: "konflikt", beide: ["name"] });
        await t.bearbeitung.eigeneAnwenden();
        expect(t.gesendet).toHaveLength(1);
        await t.bearbeitung.eigeneAnwenden(true);
        expect(t.gesendet.at(-1)).toMatchObject({ baseRevision: 4, changes: { name: "Garetien" } });
    });

    it("nach „anwenden“ und Speichern beginnt die nächste Änderung eine neue Bearbeitung", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        t.antworten.push(konflikt);
        t.setzeGelesen({ ...START, revision: 4, groesse: 3 });
        await t.bearbeitung.fertig();
        await t.bearbeitung.eigeneAnwenden();
        expect(t.bearbeitung.zustand.value.art).toBe("gespeichert");
        t.bearbeitung.feld((f) => ({ ...f, name: "Kessel" }), "name");
        expect(t.bearbeitung.lage.value).toMatchObject({ aktiv: true, ungespeichert: 1 });
        expect(t.bearbeitung.esc()).toBe(true);
        expect(t.bearbeitung.lage.value.frage).toBe(true);
    });

    it("übernehmen: der fremde Stand gilt, der eigene Entwurf ist weg", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        t.antworten.push(konflikt);
        t.setzeGelesen({ ...START, revision: 4, name: "Gareth (Stadt)" });
        await t.bearbeitung.fertig();
        await t.bearbeitung.fremdenUebernehmen();
        expect(t.bearbeitung.stand.value?.felder.name).toBe("Gareth (Stadt)");
        expect(t.bearbeitung.lage.value.ungespeichert).toBe(0);
    });

    it("ein laufender Zug (503) lehnt ab, der Entwurf bleibt", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        t.antworten.push({
            ok: false,
            status: 503,
            fehler: { code: "map_import_running", message: "Die Karte wird gerade aus Legacy zurückgesetzt." },
        });
        await t.bearbeitung.fertig();
        expect(t.bearbeitung.zustand.value).toMatchObject({ art: "abgelehnt", code: "map_import_running" });
        expect(t.bearbeitung.lage.value.ungespeichert).toBe(1);
    });

    it("🔴 eine Ablehnung trägt die Angaben des Servers und endet mit dem Stand, den sie abgelehnt hat (↶)", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        const form = t.bearbeitung.formEntwurf();
        form.beginne([1, 2, 3]);
        form.schritt([7, 2, 3]);
        const details = { reason: "form_ungueltig", art: "schneidet_sich", stelle: { x: 1, y: 2 } };
        t.antworten.push({ ok: false, status: 400, fehler: { code: "validation_failed", message: "Satz", details } });
        await t.bearbeitung.fertig();
        expect(t.bearbeitung.zustand.value).toMatchObject({ art: "abgelehnt", details });
        // Ohne Änderung bleibt sie stehen (die Leiste zeigt sie, „Fertig“ fragt noch einmal).
        expect(t.bearbeitung.lage.value.ungespeichert).toBe(1);
        form.zurueck();
        expect(t.bearbeitung.zustand.value.art).toBe("bereit");
    });
});

describe("Fensterrumpf O3: Verwerfen und Verlassen (F20, R2)", () => {
    it("Verwerfen stellt den Start her, die Bearbeitung bleibt (F20)", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        const form = t.bearbeitung.formEntwurf();
        form.beginne([1, 2, 3]);
        form.schritt([7, 2, 3]);
        t.bearbeitung.verwerfen();
        expect(form.jetzt()).toEqual([1, 2, 3]);
        expect(t.bearbeitung.lage.value).toMatchObject({ aktiv: true, ungespeichert: 0 });
    });

    it("Esc mit Ungeschriebenem fragt Speichern · Verwerfen · Weiter bearbeiten; nichts geschieht still", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        expect(t.bearbeitung.esc()).toBe(true);
        expect(t.bearbeitung.lage.value.frage).toBe(true);
        await t.bearbeitung.antworte("weiter");
        expect(t.bearbeitung.lage.value).toMatchObject({ frage: false, aktiv: true, ungespeichert: 1 });
        t.bearbeitung.esc();
        await t.bearbeitung.antworte("speichern");
        expect(t.gesendet).toHaveLength(1);
        expect(t.bearbeitung.lage.value.aktiv).toBe(false);
    });

    it("„Verwerfen“ auf die Frage endet ohne zu schreiben und gibt die Sperre frei", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(t.genommen).toHaveLength(1));
        t.bearbeitung.esc();
        await t.bearbeitung.antworte("verwerfen");
        expect(t.gesendet).toEqual([]);
        expect(t.bearbeitung.lage.value).toMatchObject({ aktiv: false, ungespeichert: 0 });
        expect(t.freigegeben).toEqual([ID]);
    });

    it("die Form, angehängt bevor der Stand gelesen ist, gilt nach dem Lesen", async () => {
        const t = aufbau();
        const form = t.bearbeitung.formEntwurf();
        form.beginne([1, 2, 3]);
        await geladen(t.bearbeitung);
        expect(form.jetzt()).toEqual([1, 2, 3]);
        form.schritt([4, 2, 3]);
        expect(t.bearbeitung.lage.value).toMatchObject({ aktiv: true, form: true, ungespeichert: 1 });
    });

    it("Esc ohne Ungeschriebenes endet sofort", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.formEntwurf().beginne([1, 2, 3]);
        t.bearbeitung.esc();
        expect(t.bearbeitung.lage.value.aktiv).toBe(false);
    });
});

describe("Fensterrumpf O3: Entwurf im Browser (R1, D19)", () => {
    it("ein Schritt sichert den Entwurf, eine neue Bearbeitung auf derselben Revision stellt ihn her, Fertig räumt ihn weg", async () => {
        const speicher = speicherAttrappe();
        const t = aufbau({ speicher });
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(speicher.length).toBe(1));
        t.bearbeitung.destroy();

        const wieder = aufbau({ speicher });
        await geladen(wieder.bearbeitung);
        expect(wieder.bearbeitung.stand.value?.felder.name).toBe("Garetien");
        expect(wieder.bearbeitung.lage.value.ungespeichert).toBe(1);
        await wieder.bearbeitung.fertig();
        expect(speicher.length).toBe(0);
    });

    it("🔴 geschrieben ist die Sicherung sofort weg, auch während der Stand neu gelesen wird (ein Neuladen dann holt nichts zurück)", async () => {
        const speicher = speicherAttrappe();
        const t = aufbau({ speicher });
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(speicher.length).toBe(1));
        let freigeben!: () => void;
        t.haltLesen(new Promise<void>((weiter) => (freigeben = weiter)));
        const fertig = t.bearbeitung.fertig();
        await vi.waitFor(() => expect(t.gesendet).toHaveLength(1));
        // Das Neulesen hängt noch; die Sicherung ist schon weg und kommt auch nach der Sicherungspause nicht wieder.
        await vi.waitFor(() => expect(speicher.length).toBe(0));
        await new Promise((r) => setTimeout(r, 400));
        expect(speicher.length).toBe(0);
        freigeben();
        await fertig;
        expect(t.bearbeitung.zustand.value.art).toBe("gespeichert");
        expect(speicher.length).toBe(0);
    });

    it("ein Speicher, der wirft, hält das Bearbeiten nicht auf", async () => {
        const speicher = speicherAttrappe();
        speicher.setItem = () => {
            throw new Error("voll");
        };
        const t = aufbau({ speicher });
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await t.bearbeitung.fertig();
        expect(t.gesendet).toHaveLength(1);
    });

    it("ein gesicherter Entwurf auf einem älteren Stand kommt als Konflikt, nicht still auf den neuen Stand", async () => {
        const speicher = speicherAttrappe();
        const t = aufbau({ speicher });
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(speicher.length).toBe(1));
        t.bearbeitung.destroy();

        const wieder = aufbau({ speicher, gelesen: { ...START, revision: 4, name: "Gareth (Stadt)" } });
        await vi.waitFor(() => expect(wieder.bearbeitung.zustand.value.art).toBe("konflikt"));
        expect(wieder.bearbeitung.zustand.value).toMatchObject({ grund: "fremd", eigene: ["name"], beide: ["name"] });
        expect(wieder.bearbeitung.stand.value?.felder.name).toBe("Garetien");
        await wieder.bearbeitung.fertig();
        expect(wieder.gesendet).toEqual([]);
    });
});

describe("Fensterrumpf O3: was fehlt, sperrt „Fertig“; Befunde der Quittung", () => {
    it("🔴 fehlt dem Stand etwas, schreiben weder „Fertig“ noch „Speichern“ der Frage; der Grund steht in der Lage", async () => {
        const t = aufbau({ pruefe: (_d, stand) => (stand.felder.name === "" ? "Erst einen Namen." : undefined) });
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "" }));
        expect(t.bearbeitung.lage.value.grund).toBe("Erst einen Namen.");
        await t.bearbeitung.fertig();
        expect(t.bearbeitung.esc()).toBe(true);
        expect(t.bearbeitung.lage.value.frage).toBe(true);
        await t.bearbeitung.antworte("speichern");
        expect(t.gesendet).toEqual([]);
        expect(t.bearbeitung.lage.value.aktiv).toBe(true);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        expect(t.bearbeitung.lage.value.grund).toBeUndefined();
        await t.bearbeitung.fertig();
        expect(t.gesendet).toHaveLength(1);
    });

    it("die Befunde der Quittung stehen übersetzt im Zustand (Gelände veraltet, T18); ein unbekannter mit dem Satz des Servers", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.antworten.push({
            ok: true,
            quittung: {
                ...quittung(4),
                warnings: [
                    { code: "terrain_stale", message: "Gelände veraltet." },
                    { code: "unbekannt", message: "Roh." },
                ],
            },
        });
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await t.bearbeitung.fertig();
        const zustand = t.bearbeitung.zustand.value;
        expect(zustand.art === "gespeichert" ? zustand.befunde : []).toEqual([
            uebersetze("entwurf.befund.terrain_stale"),
            "Roh.",
        ]);
    });

    it("🔴 reiht die Operation das Gelände im Umkreis ein (WI-0223), merkt der Rumpf die Folgearbeit vor; „Gelände veraltet“ gilt dann nicht", async () => {
        const vorgemerkt: unknown[] = [];
        const t = aufbau({
            folge: {
                vormerke: (q) => {
                    vorgemerkt.push(q);
                    const auftrag = q.derivedWork.find((x) => x.kind === "dem_publish")?.jobId;
                    return auftrag === undefined ? undefined : { art: "gelaende", auftrag };
                },
            },
        });
        await geladen(t.bearbeitung);
        t.antworten.push({
            ok: true,
            quittung: {
                ...quittung(4),
                derivedWork: [
                    { kind: "terrain_local", jobId: "lokal-1", state: "queued" },
                    { kind: "dem_publish", jobId: "publish-1", state: "queued" },
                ],
                warnings: [{ code: "terrain_stale", message: "Gelände veraltet." }],
            },
        });
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await t.bearbeitung.fertig();
        const zustand = t.bearbeitung.zustand.value;
        expect(vorgemerkt).toHaveLength(1);
        expect(zustand).toMatchObject({
            art: "gespeichert",
            befunde: [],
            folge: { art: "gelaende", auftrag: "publish-1" },
        });
    });
});
