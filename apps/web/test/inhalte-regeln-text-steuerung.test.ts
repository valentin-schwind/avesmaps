import { computed, effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
    InhalteRegelTextAlsText,
    InhalteRegelTextErgebnis,
    InhalteRegelTextPruefenBody,
    InhalteRegelTextUebernehmenBody,
    InhalteRegelTextUebernommen,
} from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api.ts";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden.ts";
import { locale } from "../src/i18n/i18n.ts";
import type { InhalteClient } from "../src/inhalte/inhalte-client.ts";
import { TEXT_BEISPIEL } from "../src/inhalte/inhalte-regeln-text-modell.ts";
import {
    createRegelTextSteuerung,
    type RegelTextOptionen,
    type RegelTextSteuerung,
} from "../src/inhalte/inhalte-regeln-text-steuerung.ts";

/**
 * Der Zustand der Ansicht „Regeln als Text“ (WI-0254 §13) gegen einen falschen Server: Prüfen, die Antwort auf eine Rückfrage als Ersatz mit neuer Prüfung, „Übernehmen“ als EINE Operation mit dem `rest` als neuem
 * Text und dem Neuladen von Liste und Eintrag, „Als Text“ und die Fehler. Die Rechnung am Text prüft `inhalte-regeln-text-modell.test.ts`.
 *
 * - **Soll:** Die Vorschau gehört zum geprüften Text; eine Antwort schreibt in genau die Stelle und prüft neu; „Übernehmen“ legt nur an, was „neu“ ist, und lässt den Rest stehen.
 * - **Problemfälle:** eine späte Antwort auf einen älteren Text; Antworten und „Übernehmen“ bei veralteter Vorschau; ein Entwurf mit Änderungen am gewählten Eintrag (nie verwerfen); Fehler 423, 403, kein Netz.
 */
beforeEach(() => {
    locale.value = "de";
});

const KENNUNG = "00000000-0000-4000-8000-000000000f01";
const leer = (): InhalteRegelTextErgebnis => ({
    zahlen: { eintraege: 0, neu: 0, schon: 0, rueckfragen: 0, fehler: 0 },
    plan: { regeln: 0, eintraege: 0, quellen: 0, anlegen: 0 },
    eintraege: [],
    lose: [],
    rest: "",
});
/** Ein Ergebnis mit EINER offenen Rückfrage an Zeile 1 und EINER neuen Regel. */
const mitRueckfrage = (): InhalteRegelTextErgebnis => ({
    ...leer(),
    zahlen: { eintraege: 1, neu: 1, schon: 0, rueckfragen: 1, fehler: 0 },
    plan: { regeln: 1, eintraege: 1, quellen: 0, anlegen: 0 },
    eintraege: [
        {
            zeile: 0,
            name: "Alprute",
            kategorie: "flora",
            kennung: KENNUNG,
            neuAnlegen: false,
            status: "ok",
            probleme: [],
            regeln: [
                {
                    zeile: 1,
                    zeileBis: 1,
                    relation: "herkunft",
                    status: "rueckfrage",
                    text: "[[Aeltikan]]",
                    probleme: [
                        {
                            art: "rueckfrage",
                            zeile: 1,
                            von: 13,
                            bis: 25,
                            text: "„Aeltikan“ ist mehrdeutig",
                            optionen: [
                                {
                                    label: "Aeltikan (Tiefebene)",
                                    meta: "Topographie",
                                    ersatz: { zeile: 1, von: 13, bis: 25, text: "[[#269be9c7|Aeltikan]]" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
});

const quittung = (teil: Partial<InhalteRegelTextUebernommen> = {}): InhalteRegelTextUebernommen => ({
    operationId: "00000000-0000-4000-8000-000000000001",
    status: "applied",
    environment: "test",
    affected: [],
    derivedWork: [],
    warnings: [],
    regeln: 1,
    eintraege: 1,
    quellen: 0,
    angelegt: 0,
    schon: 0,
    rest: "",
    ...teil,
});

const fehler = (
    status: number,
    code: string,
    message: string,
): { ok: false; status: number; fehler: { code: string; message: string } } => ({
    ok: false,
    status,
    fehler: { code, message },
});

interface Falsch {
    client: Pick<InhalteClient, "regelTextPruefen" | "regelTextUebernehmen" | "vorkommenAlsText">;
    pruefAnfragen: InhalteRegelTextPruefenBody[];
    uebernehmenAnfragen: InhalteRegelTextUebernehmenBody[];
    alsTextAnfragen: string[];
    /** Was die nächste Prüfung antwortet; eine Funktion darf vom Text abhängen. */
    pruefen: (
        text: string,
    ) => SchreibAntwort<InhalteRegelTextErgebnis> | Promise<SchreibAntwort<InhalteRegelTextErgebnis>>;
    uebernehmen: () =>
        SchreibAntwort<InhalteRegelTextUebernommen> | Promise<SchreibAntwort<InhalteRegelTextUebernommen>>;
    alsText: () => Promise<InhalteRegelTextAlsText>;
}

function falscherServer(): Falsch {
    const s: Falsch = {
        client: undefined as never,
        pruefAnfragen: [],
        uebernehmenAnfragen: [],
        alsTextAnfragen: [],
        pruefen: () => ({ ok: true, quittung: leer() }),
        uebernehmen: () => ({ ok: true, quittung: quittung() }),
        alsText: () => Promise.resolve({ text: "" }),
    };
    s.client = {
        regelTextPruefen: (body) => {
            s.pruefAnfragen.push(body);
            return Promise.resolve(s.pruefen(body.text));
        },
        regelTextUebernehmen: (body) => {
            s.uebernehmenAnfragen.push(body);
            return Promise.resolve(s.uebernehmen());
        },
        vorkommenAlsText: (id) => {
            s.alsTextAnfragen.push(id);
            return s.alsText();
        },
    };
    return s;
}

/** Die Steuerung der Vorkommen, soweit „Übernehmen“ sie braucht: Liste neu laden, den gewählten Eintrag neu holen. */
function falscheVorkommen(optionen: { gewaehlt?: string | undefined; geaendert?: boolean } = {}) {
    const geaendert = ref(optionen.geaendert ?? false);
    const protokoll: string[] = [];
    return {
        protokoll,
        geaendert,
        steuerung: {
            ladeListeNeu: () => protokoll.push("liste"),
            gewaehlt: ref<string | undefined>("gewaehlt" in optionen ? optionen.gewaehlt : "e1"),
            geaendert: computed(() => geaendert.value),
            waehleDirekt: (id: string) => protokoll.push(`waehle:${id}`),
        },
    };
}

let scope: EffectScope | undefined;
function baue(server: Falsch, vorkommen?: ReturnType<typeof falscheVorkommen>): RegelTextSteuerung {
    scope = effectScope();
    const optionen: RegelTextOptionen = {
        client: server.client,
        neueOperationId: () => "00000000-0000-4000-8000-0000000000aa",
        ...(vorkommen === undefined ? {} : { vorkommen: vorkommen.steuerung }),
    };
    return scope.run(() => createRegelTextSteuerung(optionen))!;
}
afterEach(() => {
    scope?.stop();
    scope = undefined;
});

/** Eine Antwort, die erst kommt, wenn der Test sie freigibt (für Rennen). */
function aufgeschoben<T>(): { versprechen: Promise<T>; erfuelle: (wert: T) => void } {
    let erfuelle!: (wert: T) => void;
    const versprechen = new Promise<T>((r) => (erfuelle = r));
    return { versprechen, erfuelle };
}

describe("Prüfen", () => {
    it("schickt den Text, hält die Vorschau und sagt, dass sie zum Text gehört", async () => {
        const server = falscherServer();
        server.pruefen = () => ({ ok: true, quittung: mitRueckfrage() });
        const s = baue(server);
        s.tippe("Alprute (Flora)\n| Herkunft = [[Aeltikan]]");
        expect(s.aktuell.value).toBe(false);
        await s.pruefe();
        expect(server.pruefAnfragen).toEqual([{ text: "Alprute (Flora)\n| Herkunft = [[Aeltikan]]" }]);
        expect(s.ergebnis.value?.zahlen.rueckfragen).toBe(1);
        expect(s.aktuell.value).toBe(true);
        expect(s.prueftGerade.value).toBe(false);
    });

    it("🔴 Tippen macht die Vorschau veraltet, bis neu geprüft ist", async () => {
        const server = falscherServer();
        const s = baue(server);
        s.tippe("a");
        await s.pruefe();
        s.tippe("ab");
        expect(s.aktuell.value).toBe(false);
        await s.pruefe();
        expect(s.aktuell.value).toBe(true);
    });

    it("🪤 eine späte Antwort auf einen älteren Text überschreibt nichts", async () => {
        const server = falscherServer();
        const alt = aufgeschoben<SchreibAntwort<InhalteRegelTextErgebnis>>();
        let aufrufe = 0;
        server.pruefen = (text) => {
            aufrufe += 1;
            return aufrufe === 1 ? alt.versprechen : { ok: true, quittung: { ...leer(), rest: text } };
        };
        const s = baue(server);
        s.tippe("alt");
        const erste = s.pruefe();
        s.tippe("neu");
        await s.pruefe();
        alt.erfuelle({ ok: true, quittung: { ...leer(), rest: "alt" } });
        await erste;
        expect(s.ergebnis.value?.rest).toBe("neu");
        expect(s.aktuell.value).toBe(true);
    });

    it("ein Fehler steht mit dem Satz des Servers da, der Text und die ältere Vorschau bleiben", async () => {
        const server = falscherServer();
        const s = baue(server);
        s.tippe("a");
        await s.pruefe();
        server.pruefen = () => fehler(403, "forbidden", "Dafür fehlt das Recht.");
        s.tippe("ab");
        await s.pruefe();
        expect(s.meldung.value).toEqual({ ton: "gefahr", satz: "Dafür fehlt das Recht." });
        expect(s.text.value).toBe("ab");
        expect(s.ergebnis.value).toBeDefined();
        expect(s.aktuell.value).toBe(false);
        expect(s.prueftGerade.value).toBe(false);
    });

    it("kein Netz und eine Antwort ohne Satz bekommen einen eigenen Satz", async () => {
        const server = falscherServer();
        const s = baue(server);
        server.pruefen = () => fehler(503, "map_import_running", "");
        await s.pruefe();
        expect(s.meldung.value?.satz).toBe("Der Server hat die Anfrage nicht angenommen.");
        server.pruefen = () => fehler(0, "network_error", "Keine Verbindung zum Server.");
        await s.pruefe();
        expect(s.meldung.value?.satz).toBe("Keine Verbindung zum Server.");
    });

    it("„Prüfen“ löscht die Meldung des Schritts davor", async () => {
        const server = falscherServer();
        server.pruefen = () => fehler(423, "map_locked", "Die Karte ist gesperrt.");
        const s = baue(server);
        await s.pruefe();
        expect(s.meldung.value?.ton).toBe("gefahr");
        server.pruefen = () => ({ ok: true, quittung: leer() });
        await s.pruefe();
        expect(s.meldung.value).toBeUndefined();
    });
});

describe("Antwort auf eine Rückfrage", () => {
    it("schreibt den Ersatz in genau die Stelle, markiert die Zeile und prüft den neuen Text", async () => {
        const server = falscherServer();
        server.pruefen = (text) => ({
            ok: true,
            quittung: text.includes("#269be9c7") ? { ...leer(), rest: "geprüft" } : mitRueckfrage(),
        });
        const s = baue(server);
        s.tippe("Alprute (Flora)\n| Herkunft = [[Aeltikan]]");
        await s.pruefe();
        const ersatz = s.ergebnis.value!.eintraege[0]!.regeln[0]!.probleme[0]!.optionen[0]!.ersatz;
        await s.wendeAn(ersatz);
        expect(s.text.value).toBe("Alprute (Flora)\n| Herkunft = [[#269be9c7|Aeltikan]]");
        expect(server.pruefAnfragen.at(-1)?.text).toBe(s.text.value);
        expect(s.ergebnis.value?.rest).toBe("geprüft");
        expect(s.aktuell.value).toBe(true);
        expect(s.markierung.value).toMatchObject({ von: 1, bis: 1 });
    });

    it("🔴 gilt nicht bei veralteter Vorschau: Der Ersatz zielt auf den geprüften Text", async () => {
        const server = falscherServer();
        server.pruefen = () => ({ ok: true, quittung: mitRueckfrage() });
        const s = baue(server);
        s.tippe("Alprute (Flora)\n| Herkunft = [[Aeltikan]]");
        await s.pruefe();
        const ersatz = s.ergebnis.value!.eintraege[0]!.regeln[0]!.probleme[0]!.optionen[0]!.ersatz;
        s.tippe("Zeile davor\nAlprute (Flora)\n| Herkunft = [[Aeltikan]]");
        const anfragen = server.pruefAnfragen.length;
        await s.wendeAn(ersatz);
        expect(s.text.value).toBe("Zeile davor\nAlprute (Flora)\n| Herkunft = [[Aeltikan]]");
        expect(server.pruefAnfragen).toHaveLength(anfragen);
    });

    it("eine Stelle, die nicht mehr passt, ändert nichts und sagt es", async () => {
        const server = falscherServer();
        server.pruefen = () => ({ ok: true, quittung: mitRueckfrage() });
        const s = baue(server);
        s.tippe("a");
        await s.pruefe();
        await s.wendeAn({ zeile: 5, von: 0, bis: 1, text: "x" });
        expect(s.text.value).toBe("a");
        expect(s.meldung.value?.ton).toBe("gefahr");
    });
});

describe("Übernehmen", () => {
    async function geprueft(server: Falsch, vorkommen?: ReturnType<typeof falscheVorkommen>) {
        server.pruefen = (text) => ({
            ok: true,
            quittung:
                text === "Rest"
                    ? leer()
                    : { ...mitRueckfrage(), plan: { regeln: 3, eintraege: 2, quellen: 0, anlegen: 0 } },
        });
        const s = baue(server, vorkommen);
        s.tippe("Alprute (Flora)\n| Herkunft = [[Wald]]");
        await s.pruefe();
        return s;
    }

    it("EINE Operation: der Server liest den Text noch einmal; danach ist `rest` der Text und wird geprüft", async () => {
        const server = falscherServer();
        const vorkommen = falscheVorkommen();
        const s = await geprueft(server, vorkommen);
        server.uebernehmen = () => ({ ok: true, quittung: quittung({ regeln: 3, eintraege: 2, rest: "Rest" }) });
        await s.uebernimm();
        expect(server.uebernehmenAnfragen).toEqual([
            { operationId: "00000000-0000-4000-8000-0000000000aa", text: "Alprute (Flora)\n| Herkunft = [[Wald]]" },
        ]);
        expect(s.text.value).toBe("Rest");
        expect(server.pruefAnfragen.at(-1)?.text).toBe("Rest");
        expect(s.aktuell.value).toBe(true);
        expect(s.meldung.value).toEqual({ ton: "neutral", satz: "3 Regeln an 2 Einträgen übernommen." });
        expect(s.uebernimmtGerade.value).toBe(false);
    });

    it("lädt die Liste und den gewählten Eintrag neu", async () => {
        const server = falscherServer();
        const vorkommen = falscheVorkommen({ gewaehlt: "e7" });
        const s = await geprueft(server, vorkommen);
        await s.uebernimm();
        expect(vorkommen.protokoll).toEqual(["liste", "waehle:e7"]);
    });

    it("🔴 ein Entwurf mit Änderungen bleibt stehen: nur die Liste lädt neu, die Meldung kündigt den Konflikt an", async () => {
        const server = falscherServer();
        const vorkommen = falscheVorkommen({ geaendert: true });
        const s = await geprueft(server, vorkommen);
        await s.uebernimm();
        expect(vorkommen.protokoll).toEqual(["liste"]);
        expect(s.meldung.value?.satz).toContain("Konflikt");
    });

    it("ohne gewählten Eintrag lädt nur die Liste neu", async () => {
        const server = falscherServer();
        const vorkommen = falscheVorkommen({ gewaehlt: undefined });
        const s = await geprueft(server, vorkommen);
        await s.uebernimm();
        expect(vorkommen.protokoll).toEqual(["liste"]);
    });

    it("🔴 ein Fehler (423, 403, 409, 503) lässt Text und Vorschau stehen und lädt nichts neu", async () => {
        for (const [status, code, satz] of [
            [423, "map_editing_off", "Das Bearbeiten der Karte ist ausgeschaltet."],
            [403, "forbidden", "Dafür fehlt das Recht."],
            [409, "idempotency_key_reused", "Schon verwendet."],
            [503, "map_import_running", "Ein Import läuft."],
        ] as const) {
            const server = falscherServer();
            const vorkommen = falscheVorkommen();
            const s = await geprueft(server, vorkommen);
            server.uebernehmen = () => fehler(status, code, satz);
            await s.uebernimm();
            expect(s.meldung.value, code).toEqual({ ton: "gefahr", satz });
            expect(s.text.value, code).toBe("Alprute (Flora)\n| Herkunft = [[Wald]]");
            expect(s.aktuell.value, code).toBe(true);
            expect(vorkommen.protokoll, code).toEqual([]);
            expect(s.uebernimmtGerade.value, code).toBe(false);
        }
    });

    it("🔴 geht nicht bei veralteter Vorschau, ohne Vorschau und bei leerem Plan", async () => {
        const server = falscherServer();
        const s = baue(server);
        await s.uebernimm();
        s.tippe("a");
        await s.uebernimm();
        expect(server.uebernehmenAnfragen).toEqual([]);
        server.pruefen = () => ({ ok: true, quittung: leer() });
        await s.pruefe();
        await s.uebernimm();
        expect(server.uebernehmenAnfragen).toEqual([]);
        const s2 = await geprueft(falscherServer());
        s2.tippe("anders");
        await s2.uebernimm();
        expect(s2.uebernimmtGerade.value).toBe(false);
    });

    it("während es läuft, steht der Text still und ein zweiter Aufruf tut nichts", async () => {
        const server = falscherServer();
        const s = await geprueft(server);
        const spaet = aufgeschoben<SchreibAntwort<InhalteRegelTextUebernommen>>();
        server.uebernehmen = () => spaet.versprechen;
        const lauf = s.uebernimm();
        expect(s.uebernimmtGerade.value).toBe(true);
        expect(s.beschaeftigt.value).toBe(true);
        s.tippe("verbotene Eingabe");
        s.leere();
        s.beispiel();
        await s.uebernimm();
        expect(server.uebernehmenAnfragen).toHaveLength(1);
        expect(s.text.value).toBe("Alprute (Flora)\n| Herkunft = [[Wald]]");
        spaet.erfuelle({ ok: true, quittung: quittung({ rest: "Rest" }) });
        await lauf;
        expect(s.text.value).toBe("Rest");
    });

    it("scheitert die Prüfung nach dem Übernehmen, bleibt der Satz zum Übernehmen und der Fehler steht dabei", async () => {
        const server = falscherServer();
        const s = await geprueft(server);
        server.uebernehmen = () => ({ ok: true, quittung: quittung({ rest: "Rest" }) });
        server.pruefen = () => fehler(0, "network_error", "Keine Verbindung zum Server.");
        await s.uebernimm();
        expect(s.meldung.value?.ton).toBe("gefahr");
        expect(s.meldung.value?.satz).toContain("übernommen");
        expect(s.meldung.value?.satz).toContain("Keine Verbindung");
        expect(s.text.value).toBe("Rest");
    });
});

describe("Als Text", () => {
    const block = "Aal (Fauna)\n| Vorkommen = [[See]] oder [[Meer]]\n";

    it("ersetzt einen leeren Text, öffnet die Ansicht, markiert den Block und prüft", async () => {
        const server = falscherServer();
        server.alsText = () => Promise.resolve({ text: block });
        const s = baue(server);
        expect(s.offen.value).toBe(false);
        await s.alsText("e1");
        expect(server.alsTextAnfragen).toEqual(["e1"]);
        expect(s.offen.value).toBe(true);
        expect(s.text.value).toBe(block.trimEnd());
        expect(s.markierung.value).toMatchObject({ von: 0, bis: 1 });
        expect(server.pruefAnfragen.at(-1)?.text).toBe(s.text.value);
        expect(s.aktuell.value).toBe(true);
    });

    it("ersetzt das unberührte Beispiel", async () => {
        const server = falscherServer();
        server.alsText = () => Promise.resolve({ text: block });
        const s = baue(server);
        s.beispiel();
        expect(s.text.value).toBe(TEXT_BEISPIEL);
        await s.alsText("e1");
        expect(s.text.value).toBe(block.trimEnd());
    });

    it("hängt an eigenen Text hinter einer Leerzeile an und markiert den neuen Block", async () => {
        const server = falscherServer();
        server.alsText = () => Promise.resolve({ text: block });
        const s = baue(server);
        s.tippe("Quelle: [[Titel]]\nAlprute (Flora)");
        await s.alsText("e1");
        expect(s.text.value).toBe(`Quelle: [[Titel]]\nAlprute (Flora)\n\n${block.trimEnd()}`);
        expect(s.markierung.value).toMatchObject({ von: 3, bis: 4 });
    });

    it("🔴 ein Fehler öffnet die Ansicht trotzdem, zeigt den Satz und lässt den Text, wie er ist", async () => {
        const server = falscherServer();
        server.alsText = () => Promise.reject(new ApiFailure(404, "not_found", "Nicht gefunden."));
        const s = baue(server);
        s.tippe("eigener Text");
        await s.alsText("e1");
        expect(s.offen.value).toBe(true);
        expect(s.text.value).toBe("eigener Text");
        expect(s.meldung.value).toEqual({ ton: "gefahr", satz: "Nicht gefunden." });
        expect(server.pruefAnfragen).toEqual([]);
    });
});

describe("Text, Beispiel, Leeren und die Ansicht", () => {
    it("Leeren und Beispiel setzen die Vorschau zurück, Tippen löscht die Meldung", async () => {
        const server = falscherServer();
        server.pruefen = () => fehler(403, "forbidden", "Nein.");
        const s = baue(server);
        s.beispiel();
        expect(s.text.value).toBe(TEXT_BEISPIEL);
        await s.pruefe();
        expect(s.meldung.value).toBeDefined();
        s.tippe("x");
        expect(s.meldung.value).toBeUndefined();
        server.pruefen = () => ({ ok: true, quittung: leer() });
        await s.pruefe();
        expect(s.ergebnis.value).toBeDefined();
        s.leere();
        expect(s.text.value).toBe("");
        expect(s.ergebnis.value).toBeUndefined();
        expect(s.aktuell.value).toBe(false);
    });

    it("🪤 eine Prüfung, die beim Leeren noch läuft, bringt ihre Vorschau nicht zurück", async () => {
        const server = falscherServer();
        const spaet = aufgeschoben<SchreibAntwort<InhalteRegelTextErgebnis>>();
        server.pruefen = () => spaet.versprechen;
        const s = baue(server);
        s.tippe("a");
        const lauf = s.pruefe();
        expect(s.prueftGerade.value).toBe(true);
        s.leere();
        expect(s.prueftGerade.value).toBe(false);
        spaet.erfuelle({ ok: true, quittung: leer() });
        await lauf;
        expect(s.ergebnis.value).toBeUndefined();
    });

    it("öffnen, schließen und umschalten; der Text bleibt beim Schließen", () => {
        const s = baue(falscherServer());
        s.tippe("bleibt");
        s.oeffne();
        expect(s.offen.value).toBe(true);
        s.schliesse();
        expect(s.offen.value).toBe(false);
        s.umschalten();
        expect(s.offen.value).toBe(true);
        s.umschalten();
        expect(s.offen.value).toBe(false);
        expect(s.text.value).toBe("bleibt");
    });

    it("jede Markierung ist neu, auch dieselbe Zeile zweimal", () => {
        const s = baue(falscherServer());
        s.markiere(2, 3);
        const erste = s.markierung.value;
        s.markiere(2, 3);
        expect(s.markierung.value).not.toBe(erste);
        expect(s.markierung.value?.nr).toBe((erste?.nr ?? 0) + 1);
    });
});
