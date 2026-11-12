import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorLock, EditorLockRequest } from "@avesmaps3d/shared";
import { EDITOR_LOCK_REQUEST_POLL_SECONDS } from "@avesmaps3d/shared";
import { createFreigabeBitten } from "../src/editor-sperre/freigabe-bitten.ts";
import { createFremdeSperren, type FremdeSperren } from "../src/editor-sperre/fremde-sperren.ts";
import type { FrageErgebnis } from "../src/editor-sperre/sperre.ts";

/**
 * „Freigabe erbitten“ beim Bittenden (WI-0262, OPS-000059; Design Guide §30.5 für die Zustände des Knopfs): der Stand im Kasten, die
 * Meldungen zu den Antworten und der schnelle Takt, solange die Bitte offen ist.
 *
 * Problemfälle: Der Knopf steht neben einer offenen Anfrage oder fehlt nach „Später“ und „Abgelaufen“; die Antwort kommt als Meldung
 * zweimal oder nach dem Neuladen für eine Antwort von gestern; die Freigabe lässt das Objekt gesperrt, bis die Minute um ist; eine Bitte
 * an den früheren Halter erscheint am neuen; der Knopf lässt sich doppelt drücken; der schnelle Takt läuft weiter, wenn nichts mehr
 * offen ist.
 */
const ID = "e2e2e2e2-0000-4000-8000-000000000001";
const SINCE = "2026-10-30T09:00:00.000Z";
const SPERRE: EditorLock = {
    kind: "place",
    id: ID,
    part: "felder",
    person: { id: "e2e2e2e2-0000-4000-8000-0000000000f1", name: "Thomas" },
    since: SINCE,
    heartbeatAt: "2026-10-30T10:00:00.000Z",
    own: false,
};
const anfrage = (state: EditorLockRequest["state"], extra: Partial<EditorLockRequest> = {}): EditorLockRequest => ({
    requestId: "e2e2e2e2-0000-4000-8000-0000000000b1",
    kind: "place",
    id: ID,
    state,
    createdAt: "2026-10-30T10:00:00.000Z",
    expiresAt: "2026-10-30T10:05:00.000Z",
    ...extra,
});

afterEach(() => {
    vi.useRealTimers();
});

/** Eine Seite mit einer Liste, die der Test füllt; `frage` antwortet, wie der Test es will. */
function aufbau(
    frage: () => FrageErgebnis | Promise<FrageErgebnis> = () => ({ art: "gestellt", anfrage: anfrage("open") }),
) {
    let locks: EditorLock[] = [SPERRE];
    let eigene: EditorLockRequest[] = [];
    const liste = vi.fn(async () => locks);
    const sperre = { liste, anfragen: () => eigene, frage: vi.fn(async () => frage()) };
    const fremde: FremdeSperren = createFremdeSperren({ sperre, art: "place", aktiv: () => true });
    const meldungen: { text: string; ton: string | undefined }[] = [];
    const neu = vi.fn();
    const bitten = createFreigabeBitten({
        sperre,
        fremde: [fremde],
        melde: (text, ton) => meldungen.push({ text, ton }),
        name: () => "Gareth",
        neu,
    });
    return {
        bitten,
        fremde,
        sperre,
        meldungen,
        neu,
        liste,
        setze(neueLocks: EditorLock[], neueAnfragen: EditorLockRequest[]) {
            locks = neueLocks;
            eigene = neueAnfragen;
        },
    };
}

describe("Freigabe erbitten: der Kasten", () => {
    it("🔴 ohne Anfrage der Knopf; während sie unterwegs ist, grau mit Satz; danach „gesendet, läuft ab um …“ ohne Knopf", async () => {
        vi.useFakeTimers();
        let antworte!: (e: FrageErgebnis) => void;
        const t = aufbau(() => new Promise<FrageErgebnis>((r) => (antworte = r)));
        await t.fremde.frisch();
        expect(t.bitten.kasten(SPERRE)).toEqual({ knopf: true, sendet: false });

        const ersteBitte = t.bitten.bitte(SPERRE);
        expect(t.bitten.kasten(SPERRE)).toMatchObject({ knopf: true, sendet: true, status: "Anfrage wird gesendet …" });
        // Ein zweiter Druck, solange sie unterwegs ist, fragt nicht noch einmal.
        await t.bitten.bitte(SPERRE);
        expect(t.sperre.frage).toHaveBeenCalledTimes(1);

        antworte({ art: "gestellt", anfrage: anfrage("open") });
        await ersteBitte;
        const stand = t.bitten.kasten(SPERRE);
        expect(stand).toMatchObject({ knopf: false, sendet: false });
        expect(stand.status).toMatch(/^Anfrage gesendet, läuft ab um \d\d:\d\d\.$/);
        // Der Kasten wird neu gezeichnet: beim Senden und nach der Antwort.
        expect(t.neu).toHaveBeenCalled();
        t.fremde.destroy();
        t.bitten.destroy();
    });

    it("🔴 Später und Abgelaufen: der Satz steht da, und der Knopf kommt wieder", async () => {
        const t = aufbau();
        await t.fremde.frisch();
        t.setze([SPERRE], [anfrage("later")]);
        await t.fremde.frisch();
        expect(t.bitten.kasten(SPERRE)).toEqual({
            status: "Später: wird noch bearbeitet.",
            knopf: true,
            sendet: false,
        });
        t.setze([SPERRE], [anfrage("expired")]);
        await t.fremde.frisch();
        expect(t.bitten.kasten(SPERRE)).toEqual({ status: "Abgelaufen: keine Antwort.", knopf: true, sendet: false });
        t.fremde.destroy();
        t.bitten.destroy();
    });

    it("🔴 eine Bitte an den früheren Halter gilt nicht für den neuen: Der Kasten zeigt wieder nur den Knopf", async () => {
        const t = aufbau();
        t.setze([{ ...SPERRE, since: "2026-10-30T10:30:00.000Z" }], [anfrage("later")]);
        await t.fremde.frisch();
        expect(t.bitten.kasten(t.fremde.von(ID)!)).toEqual({ knopf: true, sendet: false });
        t.fremde.destroy();
        t.bitten.destroy();
    });

    it("🔴 geht die Bitte schief, steht der Satz mit dem Knopf da; ist das Objekt schon frei, wird frisch gefragt", async () => {
        let ergebnis: FrageErgebnis = { art: "fehler", fehler: new Error("kein Netz") as never };
        const t = aufbau(() => ergebnis);
        await t.fremde.frisch();
        await t.bitten.bitte(SPERRE);
        expect(t.bitten.kasten(SPERRE)).toEqual({
            status: "Die Anfrage ließ sich nicht senden.",
            knopf: true,
            sendet: false,
        });
        expect(t.meldungen).toEqual([{ text: "Die Anfrage ließ sich nicht senden.", ton: "warning" }]);
        // Beim nächsten Versuch ist der Fehler weg, und ein freies Objekt fragt die Sperren neu (das Schild fällt weg).
        ergebnis = { art: "frei" };
        const vorher = t.liste.mock.calls.length;
        await t.bitten.bitte(SPERRE);
        expect(t.bitten.kasten(SPERRE)).toEqual({ knopf: true, sendet: false });
        expect(t.liste.mock.calls.length).toBeGreaterThan(vorher);
        t.fremde.destroy();
        t.bitten.destroy();
    });
});

describe("Freigabe erbitten: mehrere Bitten an dasselbe Objekt", () => {
    it("🔴 gilt die jüngste Bitte, gleich in welcher Reihenfolge der Server sie nennt", async () => {
        const alt = anfrage("later", {
            requestId: "e2e2e2e2-0000-4000-8000-0000000000b0",
            createdAt: "2026-10-30T09:50:00.000Z",
        });
        const neu = anfrage("open", { createdAt: "2026-10-30T10:00:00.000Z" });
        for (const reihenfolge of [
            [alt, neu],
            [neu, alt],
        ]) {
            const t = aufbau();
            t.setze([SPERRE], reihenfolge);
            await t.fremde.frisch();
            expect(t.fremde.anfrageZu(ID)?.state).toBe("open");
            expect(t.bitten.kasten(SPERRE)).toMatchObject({ knopf: false });
            t.fremde.destroy();
            t.bitten.destroy();
        }
    });
});

describe("Freigabe erbitten: die Antworten", () => {
    it("🔴 freigegeben: EINE Meldung mit dem Namen, und die Sperren werden sofort neu gefragt, ohne Neuladen", async () => {
        const t = aufbau();
        await t.fremde.frisch();
        await t.bitten.bitte(SPERRE);
        expect(t.fremde.anfrageZu(ID)?.state).toBe("open");
        const vorher = t.liste.mock.calls.length;
        // Der Server nennt die Sperre nicht mehr und die Bitte freigegeben.
        t.setze([], [anfrage("released")]);
        await t.fremde.frisch();
        expect(t.meldungen).toEqual([{ text: "„Gareth“: Freigegeben, jetzt bearbeitbar.", ton: undefined }]);
        await vi.waitFor(() => expect(t.liste.mock.calls.length).toBeGreaterThan(vorher + 1));
        expect(t.fremde.von(ID)).toBeUndefined();
        // Dieselbe Antwort im nächsten Takt meldet nichts mehr.
        await t.fremde.frisch();
        expect(t.meldungen).toHaveLength(1);
        t.fremde.destroy();
        t.bitten.destroy();
    });

    it("später und abgelaufen: je eine Meldung, abgelaufen als Warnung", async () => {
        for (const [state, text, ton] of [
            ["later", "„Gareth“: Später: wird noch bearbeitet.", undefined],
            ["expired", "„Gareth“: Abgelaufen: keine Antwort.", "warning"],
        ] as const) {
            const t = aufbau();
            await t.fremde.frisch();
            await t.bitten.bitte(SPERRE);
            t.setze([SPERRE], [anfrage(state)]);
            await t.fremde.frisch();
            expect(t.meldungen).toEqual([{ text, ton }]);
            t.fremde.destroy();
            t.bitten.destroy();
        }
    });

    it("🔴 eine Antwort von vor dem Neuladen steht im Kasten, wird aber nie gemeldet", async () => {
        const t = aufbau();
        t.setze([SPERRE], [anfrage("later")]);
        await t.fremde.frisch();
        await t.fremde.frisch();
        expect(t.meldungen).toEqual([]);
        expect(t.bitten.kasten(SPERRE).status).toBe("Später: wird noch bearbeitet.");
        t.fremde.destroy();
        t.bitten.destroy();
    });
});

describe("Freigabe erbitten: der Takt der Liste", () => {
    it("🔴 solange eine Bitte offen ist, fragt die Liste alle zehn Sekunden statt jede Minute; danach wieder jede Minute", async () => {
        vi.useFakeTimers();
        const t = aufbau();
        await t.fremde.frisch();
        await t.bitten.bitte(SPERRE);
        // Der Server nennt die Bitte von nun an offen.
        t.setze([SPERRE], [anfrage("open")]);
        t.liste.mockClear();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(t.liste).toHaveBeenCalledTimes(Math.floor(30 / EDITOR_LOCK_REQUEST_POLL_SECONDS));
        // Die Antwort kommt: Der schnelle Takt ist aus, es bleibt der Takt der Minute.
        t.setze([SPERRE], [anfrage("later")]);
        await vi.advanceTimersByTimeAsync(EDITOR_LOCK_REQUEST_POLL_SECONDS * 1000);
        t.liste.mockClear();
        // Bei 40 s kam die Antwort; die Minute der Liste läuft seit dem Start und schlägt bei 60 s, ein schneller Takt schlüge bei 50 s.
        await vi.advanceTimersByTimeAsync(19_999);
        expect(t.liste).toHaveBeenCalledTimes(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(t.liste).toHaveBeenCalledTimes(1);
        t.fremde.destroy();
        t.bitten.destroy();
    });

    it("außerhalb des Editor-Modus fragt auch der schnelle Takt nicht", async () => {
        vi.useFakeTimers();
        let aktiv = true;
        const liste = vi.fn(async () => [SPERRE]);
        const fremde = createFremdeSperren({
            sperre: { liste, anfragen: () => [anfrage("open")] },
            art: "place",
            aktiv: () => aktiv,
        });
        await fremde.frisch();
        liste.mockClear();
        aktiv = false;
        await fremde.frisch();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(liste).not.toHaveBeenCalled();
        expect(fremde.anfragen.value).toEqual([]);
        fremde.destroy();
    });
});
