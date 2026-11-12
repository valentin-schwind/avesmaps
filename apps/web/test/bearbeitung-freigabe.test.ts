import { describe, expect, it, vi } from "vitest";
import type { EditorLockTarget, OperationReceipt } from "@avesmaps3d/shared";
import type { FreigabeAngebot, NimmErgebnis } from "../src/editor-sperre/sperre";
import { createBearbeitung, type BearbeitungsArt, type SchreibAntwort, type Stand } from "../src/fenster/bearbeitung";

/**
 * Die Freigabe auf Bitte an der gemeinsamen Bearbeitung (WI-0262, OPS-000059; `fenster/bearbeitung.ts`): Hält die Bearbeitung die Sperre,
 * ist sie bei `sperre.bieteFreigabe` angemeldet; das Angebot schreibt den Entwurf über „Fertig“ und beendet die Bearbeitung.
 *
 * Problemfälle: Die Anmeldung bleibt nach dem Ende stehen oder fehlt bei der Form; das Angebot gibt ab, ohne zu speichern, oder behauptet
 * Erfolg bei einem Konflikt, einer Prüfung, die „Fertig“ sperrt, einer Ablehnung des Servers; nach einem gescheiterten Versuch fehlt der
 * Entwurf oder die Sperre; eine Bearbeitung ohne Änderung bleibt hängen.
 */
interface Zettel {
    readonly id: string;
    readonly revision: number;
    readonly name: string;
}
interface Felder {
    readonly name: string;
}
const ID = "a4a4a4a4-0000-4000-8000-000000000001";
const START: Zettel = { id: ID, revision: 3, name: "Gareth" };
const quittung = (revision: number): OperationReceipt => ({
    operationId: "op",
    status: "applied",
    environment: "test",
    affected: [{ kind: "zettel", id: ID, revision }],
    derivedWork: [],
    warnings: [],
    mapRevision: 42,
});

function aufbau(optionen: { pruefe?: BearbeitungsArt<Zettel, Felder, never, unknown>["pruefe"] } = {}) {
    const gelesen: Zettel = START;
    const antworten: SchreibAntwort[] = [];
    const gesendet: unknown[] = [];
    const art: BearbeitungsArt<Zettel, Felder, never, { operationId: string; baseRevision: number; name: string }> = {
        sperrArt: "landscape",
        lade: async () => gelesen,
        felder: (d) => ({ name: d.name }),
        operation: (d, start, jetzt, operationId) =>
            jetzt.felder.name === start.felder.name
                ? undefined
                : { operationId, baseRevision: d.revision, name: jetzt.felder.name },
        async schreibe(_id, body) {
            gesendet.push(body);
            return antworten.shift() ?? { ok: true, quittung: quittung(body.baseRevision + 1) };
        },
        geaendert: (d, s: Stand<Felder, never>) => (s.felder.name === d.name ? [] : ["name"]),
        fremde: (vorher, jetzt) => (vorher.name === jetzt.name ? [] : ["name"]),
        aufNeuenStand: (_v, jetzt, s) => ({
            felder: { name: s.felder.name === START.name ? jetzt.name : s.felder.name },
            form: undefined,
        }),
        ...(optionen.pruefe === undefined ? {} : { pruefe: optionen.pruefe }),
    };
    const angebote: { ziel: EditorLockTarget; angebot: FreigabeAngebot; abgemeldet: boolean }[] = [];
    const sperre = {
        nimm: vi.fn(async (): Promise<NimmErgebnis> => ({
            art: "genommen",
            sperre: {
                kind: "landscape",
                id: ID,
                part: "felder",
                person: { id: "p", name: "Ich" },
                since: "2026-10-30T10:00:00Z",
                heartbeatAt: "2026-10-30T10:00:00Z",
                own: true,
            },
        })),
        gib: vi.fn(),
        beiVerlust: () => () => undefined,
        bieteFreigabe(ziel: EditorLockTarget, angebot: FreigabeAngebot) {
            const eintrag = { ziel, angebot, abgemeldet: false };
            angebote.push(eintrag);
            return () => {
                eintrag.abgemeldet = true;
            };
        },
    };
    const bearbeitung = createBearbeitung(art, {
        id: ID,
        titel: "Gareth",
        sperre,
        neueKennung: () => "op-1",
        folge: { vormerke: () => undefined },
    });
    const aktive = () => angebote.filter((a) => !a.abgemeldet);
    return { bearbeitung, antworten, gesendet, sperre, angebote, aktive };
}

const geladen = (b: ReturnType<typeof aufbau>["bearbeitung"]) =>
    vi.waitFor(() => expect(b.zustand.value.art).toBe("bereit"));

describe("Freigabe auf Bitte an der Bearbeitung", () => {
    it("🔴 angemeldet, solange die Bearbeitung die Sperre hält, mit dem Titel des Fensters; mit dem Ende abgemeldet", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        // Vor der ersten Änderung gibt es keine Sperre und keine Anmeldung.
        expect(t.angebote).toEqual([]);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(t.aktive()).toHaveLength(1));
        expect(t.angebote[0]).toMatchObject({ ziel: { kind: "landscape", id: ID }, angebot: { titel: "Gareth" } });
        // Noch eine Änderung meldet nicht noch einmal an.
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien!" }));
        expect(t.angebote).toHaveLength(1);
        // „Verwerfen“ stellt den Start her, die Bearbeitung bleibt; Esc beendet sie, und mit ihr geht die Anmeldung.
        t.bearbeitung.verwerfen();
        expect(t.aktive()).toHaveLength(1);
        t.bearbeitung.esc();
        expect(t.aktive()).toEqual([]);
        t.bearbeitung.destroy();
    });

    it("🔴 das Angebot schreibt den Entwurf über „Fertig“ und beendet die Bearbeitung: ERST geschrieben, dann frei", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(t.aktive()).toHaveLength(1));
        const ausgang = await t.angebote[0]!.angebot.speichere();
        expect(ausgang).toEqual({ ok: true });
        expect(t.gesendet).toEqual([{ operationId: "op-1", baseRevision: 3, name: "Garetien" }]);
        expect(t.bearbeitung.zustand.value.art).toBe("gespeichert");
        expect(t.bearbeitung.lage.value.aktiv).toBe(false);
        expect(t.sperre.gib).toHaveBeenCalledWith({ kind: "landscape", id: ID });
        expect(t.aktive()).toEqual([]);
        t.bearbeitung.destroy();
    });

    it("🔴 hat der Inhaber nichts mehr ungespeichert (alles zurückgenommen), gibt das Angebot einfach ab, ohne zu schreiben", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(t.aktive()).toHaveLength(1));
        t.bearbeitung.feld((f) => ({ ...f, name: START.name }));
        expect(await t.angebote[0]!.angebot.speichere()).toEqual({ ok: true });
        expect(t.gesendet).toEqual([]);
        expect(t.bearbeitung.lage.value.aktiv).toBe(false);
        expect(t.sperre.gib).toHaveBeenCalled();
        t.bearbeitung.destroy();
    });

    it("🔴 409 Konflikt: nichts geht verloren, die Sperre bleibt, der Grund nennt den Konflikt", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(t.aktive()).toHaveLength(1));
        t.antworten.push({
            ok: false,
            status: 409,
            fehler: { code: "edit_conflict", message: "geändert", details: { changedBy: { displayName: "Thomas" } } },
        });
        const ausgang = await t.angebote[0]!.angebot.speichere();
        expect(ausgang).toEqual({
            ok: false,
            grund: "Ein anderer hat das Objekt inzwischen geändert; der Konflikt ist im Fenster zu lösen.",
        });
        expect(t.bearbeitung.zustand.value.art).toBe("konflikt");
        expect(t.bearbeitung.stand.value?.felder.name).toBe("Garetien");
        expect(t.bearbeitung.lage.value.aktiv).toBe(true);
        expect(t.sperre.gib).not.toHaveBeenCalled();
        expect(t.aktive()).toHaveLength(1);
        t.bearbeitung.destroy();
    });

    it("🔴 abgelehnt (Prüfung des Servers, 423): der Satz des Servers ist der Grund, Entwurf und Sperre bleiben", async () => {
        const t = aufbau();
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(t.aktive()).toHaveLength(1));
        t.antworten.push({
            ok: false,
            status: 400,
            fehler: { code: "validation_failed", message: "Der Name ist zu lang." },
        });
        expect(await t.angebote[0]!.angebot.speichere()).toEqual({ ok: false, grund: "Der Name ist zu lang." });
        expect(t.bearbeitung.zustand.value).toMatchObject({ art: "abgelehnt" });
        expect(t.bearbeitung.lage.value.aktiv).toBe(true);
        expect(t.sperre.gib).not.toHaveBeenCalled();
        // Ein zweiter Versuch nach der Korrektur geht durch.
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        expect(await t.angebote[0]!.angebot.speichere()).toEqual({ ok: true });
        t.bearbeitung.destroy();
    });

    it("🔴 sperrt die Prüfung der Art „Fertig“ (ein Feld fehlt), schreibt das Angebot nicht und nennt den Satz der Prüfung", async () => {
        const t = aufbau({ pruefe: () => "Die Art fehlt noch." });
        await geladen(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Garetien" }));
        await vi.waitFor(() => expect(t.aktive()).toHaveLength(1));
        expect(await t.angebote[0]!.angebot.speichere()).toEqual({ ok: false, grund: "Die Art fehlt noch." });
        expect(t.gesendet).toEqual([]);
        expect(t.bearbeitung.lage.value.aktiv).toBe(true);
        expect(t.sperre.gib).not.toHaveBeenCalled();
        t.bearbeitung.destroy();
    });

    it("eine Sperre ohne die Schnittstelle der Seite funktioniert wie zuvor (keine Anmeldung, kein Fehler)", async () => {
        const gelesen = START;
        const art: BearbeitungsArt<Zettel, Felder, never, { n: string }> = {
            sperrArt: "landscape",
            lade: async () => gelesen,
            felder: (d) => ({ name: d.name }),
            operation: () => undefined,
            schreibe: async () => ({ ok: true, quittung: quittung(4) }),
            geaendert: () => [],
            fremde: () => [],
            aufNeuenStand: (_v, _j, s) => s,
        };
        const bearbeitung = createBearbeitung(art, {
            id: ID,
            titel: "Gareth",
            sperre: {
                nimm: async () => ({ art: "fehler", fehler: new Error("x") as never }),
                gib: () => undefined,
                beiVerlust: () => () => undefined,
            },
        });
        await vi.waitFor(() => expect(bearbeitung.zustand.value.art).toBe("bereit"));
        bearbeitung.feld((f) => ({ ...f, name: "x" }));
        bearbeitung.destroy();
    });
});
