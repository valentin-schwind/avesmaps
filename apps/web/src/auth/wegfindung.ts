import { ref, type Ref } from "vue";
import {
    MEILEN_JE_EINHEIT,
    WEGFINDUNG_FOLGE_SATZ,
    WEGFINDUNG_PANELE,
    WEGFINDUNG_WERTE,
    WEGFINDUNG_FREIGABE_URL,
    WEGFINDUNG_URL,
    wegfindungGrenzen,
    wegfindungImRahmen,
    wegfindungVorgabe,
    type AdminWegfindung,
    type OperationReceipt,
    type WegfindungFreigabeBody,
    type WegfindungFolge,
    type WegfindungWert,
} from "@avesmaps3d/shared";
import { formatDecimal, isMessageKey, locale, t, tPlural } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { ApiFailure, getJson, newOperationId, postJson, type Fetcher } from "./api";
import {
    createReadConfirmation,
    neededConfirmation,
    requestConfirmation,
    withConfirmation,
    type Need,
    type ReadConfirmation,
} from "./bestaetigen";
import { formProblems, type Phrase } from "./formular";
import type { ActionResult } from "./verwaltung";

/**
 * Der Eintrag „Wegfindung“ der Systemsteuerung (WI-0153, Design Guide §8 „Seiten mit vielen Einstellungen“). Was die Oberfläche
 * rechnet, steht hier; wie es aussieht, in `verwaltung-wegfindung.vue`.
 *
 * 🔴 **Die Werte kommen aus der Tafel** (`packages/shared/src/wegfindung.ts`): Name, Vorgabe, Einheit, Satz, Folge einer Änderung,
 * Panel und Zwischenüberschrift. Der Server schickt nur, was verstellt ist. Hier liegt keine zweite Liste.
 *
 * - Verstellen ohne Dialog: Zahl ins Feld, Feld verlassen oder Eingabetaste — der Browser fragt den Passkey (Stufe S). Das
 *   Rücksetzzeichen ↺ schickt `null` und löscht die Abweichung.
 * - Die Grenzen prüft die Oberfläche mit DERSELBEN Regel wie der Server (`wegfindungImRahmen`): ein Zehntel bis das Zehnfache
 *   der Vorgabe. Der Server prüft danach noch einmal; die Oberfläche spart nur den Weg.
 * - 🔴 **Speichern ist nicht Freigeben — für die Werte am Knopf** (Schnitt 6, Folge `netz`). Ihre Zahl im Feld ist
 *   gespeichert; gerechnet wird mit dem FREIGEGEBENEN Stand, den erst der Knopf oben fortschreibt. Bis dahin rechnet die
 *   Wegfindung unverändert weiter — und die Zeile sagt, mit welcher Zahl. Alle anderen Werte gelten ohne Knopf, binnen
 *   fünf Sekunden; sie tragen darum keinen zweiten Satz und wecken den Knopf nicht.
 */

/** Wie viele Nachkommastellen eine Zahl dieses Reiters höchstens zeigt (0,0005 ist die feinste Vorgabe). */
const STELLEN = 6;

/** Eine Zahl, wie sie im Feld und in den Sätzen steht: in der Sprache der Seite, ohne Nullen am Ende. */
export const zahl = (wert: number): string => formatDecimal(wert, STELLEN);

/** Die Entsprechung in Meilen (MCS-002), für Werte in Karteneinheiten. */
export const meilen = (einheiten: number): string =>
    t("admin.wegfindung.miles", { n: zahl(Number((einheiten * MEILEN_JE_EINHEIT).toPrecision(6))) });

/** Was hinter dem Feld steht: die Meilen eines Streckenwerts oder seine Einheit. */
export const neben = (wert: WegfindungWert, eingestellt: number): string =>
    wert.einheiten === undefined ? (wert.einheit ?? "") : meilen(eingestellt);

/**
 * Die Trennzeichen der Seitensprache, aus einer Probezahl GELESEN statt aufgeschrieben: deutsch „1.000,5“, englisch
 * „1,000.5“. So bleibt die Eingabe richtig, wenn jemand die Sprache wechselt.
 */
function trennzeichen(): { tausend: string; komma: string } {
    const probe = /^1(\D)000(\D)5$/u.exec(formatDecimal(1000.5, 1));
    return { tausend: probe?.[1] ?? ".", komma: probe?.[2] ?? "," };
}

/**
 * Eine getippte Zahl; `null` heißt keine Zahl. Gelesen wird in der Sprache der Seite, weil das Feld seinen Wert in ihr zeigt
 * („1.500.000“, „0,02“).
 *
 * 🪤 Das Tausendertrennzeichen ist auf deutschen Tastaturen auch das Komma der Gewohnheit: „0.03“ meint 0,03 und nicht 3.
 * Darum die Regel — steht das Trennzeichen genau einmal und folgen ihm WENIGER als drei Ziffern, ist es der Dezimalpunkt;
 * sonst trennt es Tausender. „1.500“ bleibt also 1500, „1.5“ wird 1,5. (Anders als `leseZahl` des Höhenmodells, das
 * Tausendertrennzeichen gar nicht annimmt — dort stehen nur kleine Reglerwerte im Feld.)
 */
export function leseZahl(text: string): number | null {
    const { tausend, komma } = trennzeichen();
    let rein = text.trim().replace(/\s/gu, "");
    if (rein.includes(komma)) {
        rein = rein.split(tausend).join("").replace(komma, ".");
    } else {
        const teile = rein.split(tausend);
        rein = teile.length === 2 && (teile[1] ?? "").length < 3 ? teile.join(".") : teile.join("");
    }
    if (!/^\d+(\.\d+)?$/u.test(rein)) return null;
    const zahlWert = Number(rein);
    return Number.isFinite(zahlWert) ? zahlWert : null;
}

export interface WegfindungZeile {
    wert: WegfindungWert;
    /** Der GESPEICHERTE Wert: die Zahl im Feld (die Abweichung, wo es eine gibt, sonst die Vorgabe). */
    eingestellt: number;
    /** Der FREIGEGEBENE Wert: die Zahl, mit der die Wegfindung gerade rechnet (Schnitt 6). */
    gerechnet: number;
    vorgabe: number;
    /** Weicht der gespeicherte Wert von der Vorgabe ab? Danach ist das Rücksetzzeichen ↺ wach. */
    abweichend: boolean;
    /** Gespeichert und gerechnet gehen auseinander: geändert und noch nicht gerechnet. Das zählt die Leiste. */
    offen: boolean;
    /** Was im Feld steht, wenn niemand tippt. */
    text: string;
    /** Die Vorgabe, wie sie dasteht: das Ziel des Rücksetzzeichens. */
    vorgabeText: string;
    /** Was hinter dem Feld steht: Meilen oder Einheit, zum eingestellten Wert. */
    neben: string;
    folge: WegfindungFolge;
    folgeSatz: string;
    /** Die Herkunft als fertiger Satz, für Werte aus dem Reisemodell; `null`, wo es keine gibt. */
    herkunft: string | null;
    /** „statt 0,02“ — die Vorgabe, wenn der gespeicherte Wert von ihr abweicht. */
    statt: string | null;
    /** „noch nicht gerechnet, es gilt 0,02“ — die Zahl, mit der weitergerechnet wird; `null`, wenn beide gleich sind. */
    nochNicht: string | null;
    /** Wer wann verstellt hat; `null` ohne gespeicherte Abweichung. */
    stand: string | null;
}

export interface WegfindungPanelSicht {
    titel: string;
    wirkung: string;
    zeilen: WegfindungZeile[];
}

/** Die Abweichungen nach Kennung, aus der Antwort des Servers. */
function abweichungen(stand: AdminWegfindung | null): Map<string, AdminWegfindung["rows"][number]> {
    return new Map((stand?.rows ?? []).map((row) => [row.id, row]));
}

/** Die drei Panele mit ihren Zeilen: die Tafel, angereichert um das, was der Server über Abweichungen weiß. */
export function panele(stand: AdminWegfindung | null, jetzt: Date): WegfindungPanelSicht[] {
    const gesetzt = abweichungen(stand);
    return WEGFINDUNG_PANELE.map((panel) => ({
        titel: panel.titel,
        wirkung: panel.wirkung,
        zeilen: panel.werte.map((wert) => {
            const row = gesetzt.get(wert.id);
            const vorgabe = wegfindungVorgabe(wert);
            // 🪤 Eine Zeile kann auch dastehen, weil NUR der freigegebene Wert abweicht: zurückgesetzt und noch nicht
            // freigegeben. Dann zeigt das Feld die Vorgabe, das Rücksetzzeichen ruht (es ist ja zurückgesetzt), und die
            // Zeile ist trotzdem offen.
            const eingestellt = row?.value ?? vorgabe;
            const gerechnet = row?.applied ?? vorgabe;
            return {
                wert,
                eingestellt,
                gerechnet,
                vorgabe,
                abweichend: (row?.value ?? null) !== null,
                offen: eingestellt !== gerechnet,
                text: zahl(eingestellt),
                vorgabeText: zahl(vorgabe),
                neben: neben(wert, eingestellt),
                folge: wert.folge,
                folgeSatz: WEGFINDUNG_FOLGE_SATZ[wert.folge],
                herkunft:
                    wert.herkunft === undefined
                        ? null
                        : t("admin.wegfindung.origin", {
                              wert: zahl(vorgabe),
                              satz: wert.herkunft.satz,
                              feld: wert.herkunft.feld,
                          }),
                statt: eingestellt === vorgabe ? null : t("admin.wegfindung.instead", { wert: zahl(vorgabe) }),
                nochNicht: eingestellt === gerechnet ? null : t("admin.wegfindung.notYet", { wert: zahl(gerechnet) }),
                stand:
                    row === undefined || row.changedAt === null
                        ? null
                        : [
                              t("admin.wegfindung.changedAt", {
                                  time: relativeTime(new Date(row.changedAt), jetzt, locale.value, "zeitpunkt"),
                              }),
                              row.changedBy,
                          ]
                              .filter((teil) => teil !== null)
                              .join(" · "),
            };
        }),
    }));
}

/**
 * Wie viele OFFENE Werte welche Folge haben: offen heißt gespeichert ≠ gerechnet (WI-0153 Schnitt 6).
 *
 * 🔴 Offen sein kann nur, was am Knopf hängt (Folge `netz` und `seegraph`): Für alle anderen schickt der Server in `applied`
 * denselben Wert wie in `value`, weil sie ohne Knopf gelten. Die Aufschlüsselung bleibt trotzdem, weil sie zeigt,
 * dass die Regel greift — und weil ein Test sie festhält.
 */
export function offeneFolgen(stand: AdminWegfindung | null): Record<WegfindungFolge, number> {
    const zahl: Record<WegfindungFolge, number> = { netz: 0, seegraph: 0, sofort: 0, zeichnung: 0 };
    for (const row of stand?.rows ?? []) {
        if (row.value === row.applied) continue;
        const wert = WEGFINDUNG_WERTE.find((eintrag) => eintrag.id === row.id);
        if (wert !== undefined) zahl[wert.folge] += 1;
    }
    return zahl;
}

/** Alle offenen Werte zusammen: die Zahl, die die Leiste nennt und die den Knopf weckt. */
export const offeneWerte = (stand: AdminWegfindung | null): number =>
    Object.values(offeneFolgen(stand)).reduce((summe, n) => summe + n, 0);

/**
 * Was in der Schiene rechts steht: wie viele Werte von ihrer Vorgabe abweichen („2 abweichend“); keiner: nichts.
 * 🪤 Gezählt wird der GESPEICHERTE Stand — eine Zeile, die nur noch freigegeben abweicht (zurückgesetzt, nicht
 * freigegeben), steht auf ihrer Vorgabe und zählt hier nicht.
 */
export function schienenWert(stand: AdminWegfindung | null): string | undefined {
    if (stand === null) return undefined;
    const n = stand.rows.filter((row) => row.value !== null).length;
    return n === 0 ? undefined : t("admin.wegfindung.rail", { n });
}

export interface WegfindungLeiste {
    /** Alle offenen Werte (gespeichert ≠ gerechnet): die Zahl, die der Satz nennt und die den Knopf weckt. */
    offen: number;
    /** Ist der Knopf wach: offene Werte, oder ein veralteter Seegraph, dessen Ableitung noch nicht wartet oder läuft. */
    wach: boolean;
    /** Der Satz links in der Leiste. */
    satz: string;
    /** Was das Freigeben kostet; `null`, wenn nichts offen ist. */
    kosten: string | null;
    /** Womit die Wegfindung bis dahin rechnet; `null`, wenn nichts offen ist. */
    bleibt: string | null;
    /** Der Satz zum veralteten Seegraphen; `null`, wenn er passt oder seine Ableitung schon wartet oder läuft. */
    seeSatz: string | null;
    /** Was die Ableitung des Seegraphen dazu kostet; `null`, wenn sie nicht mitkommt. */
    seeKosten: string | null;
    /** Die wartende oder laufende Ableitung des Seegraphen mit Wort und Kreis; sonst `null`. */
    seeAuftrag: ReturnType<typeof auftragssicht>;
    /** „Zuletzt gerechnet …“; `null`, solange nie freigegeben wurde. */
    freigabe: string | null;
    /** Der eingereihte `routing_reload` mit Wort und Kreis; `null`, wenn keiner eingereiht ist. */
    auftrag: ReturnType<typeof auftragssicht>;
}

/**
 * Alles, was die Leiste über den Panelen sagt — als Sätze, hier gerechnet und darum ohne Browser prüfbar
 * (`job-view.ts` macht es für die Warteschlange genauso).
 *
 * 🔴 Der Knopf ist wach, solange `offen > 0`, und offen ist nur, was am Knopf hängt. Ein verstellter Wert der Klasse
 * „sofort“ weckt ihn NICHT: Er gilt schon, und ihn hier zu zählen hieße, zu einem Druck aufzufordern, der nichts tut.
 *
 * 🔴 **Und der Seegraph** (WI-0153 7b; Betreiber 2026-10-18: „Seewege“ über den einen Knopf, kein zweiter): Passt er nicht mehr zu
 * Meeren, Seen und Häfen (`seaGraph.stale`), sagt es die Leiste und der Knopf wacht auf — außer seine Ableitung wartet oder läuft
 * schon; dann steht sie mit Wort und Kreis da. Ein offener Wert der Folge `seegraph` bringt die Ableitung ebenfalls mit.
 */
export function leiste(stand: AdminWegfindung | null, jetzt: Date): WegfindungLeiste {
    const offen = offeneWerte(stand);
    const see = stand?.seaGraph ?? null;
    const seeUnterwegs = see?.jobState === "QUEUED" || see?.jobState === "RUNNING";
    const seeVeraltet = see?.stale === true && !seeUnterwegs;
    const seeMit = seeVeraltet || offeneFolgen(stand).seegraph > 0;
    const verstellt = (stand?.rows ?? []).some((row) => row.value !== null);
    const freigegeben = stand?.appliedAt ?? null;
    return {
        offen,
        wach: offen > 0 || seeVeraltet,
        satz:
            offen === 0
                ? t(verstellt ? "admin.wegfindung.bar.quiet" : "admin.wegfindung.bar.pristine")
                : tPlural("admin.wegfindung.bar.open", offen, { n: offen }),
        kosten: offen === 0 ? null : t("admin.wegfindung.bar.cost"),
        bleibt: offen === 0 ? null : t("admin.wegfindung.bar.keeps"),
        seeSatz: seeVeraltet ? t("admin.wegfindung.bar.seaStale") : null,
        seeKosten: seeMit ? t("admin.wegfindung.bar.seaCost") : null,
        seeAuftrag: seeUnterwegs ? zustandssicht(see?.job ?? null, see?.jobState ?? null) : null,
        freigabe:
            freigegeben === null
                ? null
                : [
                      t("admin.wegfindung.bar.applied", {
                          time: relativeTime(new Date(freigegeben), jetzt, locale.value, "zeitpunkt"),
                      }),
                      stand?.appliedBy ?? null,
                  ]
                      .filter((teil) => teil !== null)
                      .join(" · "),
        auftrag: auftragssicht(stand),
    };
}

/**
 * Der Zustand des eingereihten `routing_reload` für die Leiste: dasselbe Wort wie die Zeile in der Warteschlange
 * (`status.state.*`) und der Kreis des Hauses dazu. Ein unbekannter Zustand steht als Rohwert da, nie geraten.
 */
export function auftragssicht(stand: AdminWegfindung | null): {
    job: string;
    text: string;
    fuellung: "leer" | "halb" | "voll";
    gescheitert: boolean;
} | null {
    return zustandssicht(stand?.appliedJob ?? null, stand?.appliedJobState ?? null);
}

/** Ein Auftrag mit dem Wort der Warteschlange (`status.state.*`) und dem Kreis des Hauses; ohne Auftrag `null`. */
function zustandssicht(
    job: string | null,
    zustand: string | null,
): { job: string; text: string; fuellung: "leer" | "halb" | "voll"; gescheitert: boolean } | null {
    if (job === null) return null;
    const key = `status.state.${zustand ?? ""}`;
    const text = zustand === null ? t("admin.wegfindung.bar.jobUnknown") : isMessageKey(key) ? t(key) : zustand;
    const fuellung = zustand === "RUNNING" ? "halb" : zustand === "SUCCEEDED" ? "voll" : "leer";
    return { job, text, fuellung, gescheitert: zustand === "FAILED" || zustand === "CANCELLED" };
}

/** Der Satz, warum ein Feld eine Zahl nicht annimmt; `null`, wenn sie in Ordnung ist. */
export function problemSatz(wert: WegfindungWert, text: string): Phrase | null {
    const eingabe = leseZahl(text);
    if (eingabe === null) return { key: "admin.wegfindung.invalid.number" };
    if (!wegfindungImRahmen(wert, eingabe)) {
        const grenzen = wegfindungGrenzen(wert);
        return {
            key: "admin.wegfindung.invalid.range",
            params: { min: zahl(grenzen.min), max: zahl(grenzen.max) },
        };
    }
    return null;
}

// --- Zustand des Eintrags ----------------------------------------------------------------------------------------------------------

export interface WegfindungDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    reads?: ReadConfirmation;
}

export interface Wegfindung {
    stand: Ref<AdminWegfindung | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    confirmAgain(): void;
    /** Die Kennung, die gerade geschrieben wird. */
    busy: Ref<string | null>;
    /** Die Antwort des letzten Schreibwegs, an ihrer Kennung. */
    ergebnis: Ref<{ id: string; result: ActionResult } | null>;
    /** Läuft die Freigabe gerade? (Der Knopf oben, nicht ein Feld.) */
    freigebend: Ref<boolean>;
    /** Die Antwort des Knopfes oben; sie gehört zur Leiste, nicht zu einer Zeile. */
    freigabe: Ref<ActionResult | null>;
    /** Was in den Feldern steht, solange jemand tippt; eine Kennung ohne Eintrag zeigt ihren eingestellten Wert. */
    felder: Ref<Record<string, string>>;
    /** Das Problem je Feld, solange es nicht übernommen ist. */
    probleme: Ref<Record<string, Phrase>>;
    load(): Promise<void>;
    tippe(id: string, text: string): void;
    /** Die getippte Zahl übernehmen (Feld verlassen oder Eingabetaste); unverändert oder fehlerhaft: nichts. */
    uebernimm(id: string): Promise<void>;
    /** Zurück auf die Vorgabe: die Abweichung löschen. */
    zuruecksetzen(id: string): Promise<void>;
    /**
     * Den gespeicherten Stand freigeben und `routing_reload` einreihen, davor die Ableitung des Seegraphen, wenn er veraltet ist: der
     * EINE Auslöser über den Panelen.
     */
    freigeben(): Promise<void>;
}

export function createWegfindung(deps: WegfindungDeps = {}): Wegfindung {
    const stand = ref<AdminWegfindung | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const busy = ref<string | null>(null);
    const ergebnis = ref<{ id: string; result: ActionResult } | null>(null);
    const freigebend = ref(false);
    const freigabe = ref<ActionResult | null>(null);
    const felder = ref<Record<string, string>>({});
    const probleme = ref<Record<string, Phrase>>({});
    const ask = deps.ask ?? requestConfirmation;
    const reads = deps.reads ?? createReadConfirmation(ask);
    reads.onOffer(() => (unconfirmed.value === null ? undefined : load()));
    let ticket = 0;

    async function load(): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const body = await withConfirmation(
                () => getJson<AdminWegfindung>(WEGFINDUNG_URL, deps.fetcher),
                reads.ask,
            );
            if (mine !== ticket) return;
            stand.value = body;
            loadProblems.value = [];
            unconfirmed.value = null;
        } catch (error) {
            if (mine === ticket) {
                loadProblems.value = formProblems(error);
                unconfirmed.value = neededConfirmation(error);
            }
        } finally {
            if (mine === ticket) loading.value = false;
        }
    }

    /** Der geltende Wert einer Kennung: die Abweichung, wo es eine gibt, sonst `null` (dann gilt die Vorgabe). */
    const gesetzt = (id: string): number | null => stand.value?.rows.find((row) => row.id === id)?.value ?? null;

    function tippe(id: string, text: string): void {
        felder.value = { ...felder.value, [id]: text };
        const offen = { ...probleme.value };
        delete offen[id];
        probleme.value = offen;
    }

    /** Das Feld wieder an den Stand des Servers binden (nach einem Schreibweg oder einem Abbruch). */
    function loese(id: string): void {
        const offeneFelder = { ...felder.value };
        delete offeneFelder[id];
        felder.value = offeneFelder;
        const offeneProbleme = { ...probleme.value };
        delete offeneProbleme[id];
        probleme.value = offeneProbleme;
    }

    /** Ein gescheiterter Schreibweg als Meldung: dieselben Regeln für ein Feld und für den Knopf oben. */
    function alsErgebnis(error: unknown): ActionResult {
        const failure = error instanceof ApiFailure ? error : undefined;
        if (failure?.code === "reauth_required" || failure?.code === "assurance_required") {
            reads.decline();
            return { ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] };
        }
        if (failure?.code === "edit_conflict") {
            const by = (failure.details?.["changedBy"] as { displayName?: string } | undefined)?.displayName ?? null;
            const at = typeof failure.details?.["changedAt"] === "string" ? failure.details["changedAt"] : null;
            return { ok: false, problems: formProblems(error), conflict: { by, at } };
        }
        return { ok: false, problems: formProblems(error) };
    }

    async function schreibe(id: string, value: number | null): Promise<void> {
        const s = stand.value;
        if (s === null || s.revision === null || busy.value !== null || freigebend.value) return;
        busy.value = id;
        ergebnis.value = null;
        freigabe.value = null;
        try {
            const body = { operationId: newOperationId(), baseRevision: s.revision, id, value };
            await withConfirmation(() => postJson<OperationReceipt>(WEGFINDUNG_URL, body, deps.fetcher), ask);
            loese(id);
        } catch (error) {
            ergebnis.value = { id, result: alsErgebnis(error) };
        }
        busy.value = null;
        await load();
    }

    /**
     * Freigeben: Der gespeicherte Stand wird der gerechnete, und `routing_reload` kommt in die Warteschlange. 🔴 Die
     * Oberfläche rechnet nichts aus und schickt keine Werte — sie nennt nur die Revision, die sie gesehen hat. Welche
     * Werte freigegeben werden, entscheidet die Transaktion auf dem Server.
     */
    async function freigeben(): Promise<void> {
        const s = stand.value;
        if (s === null || s.revision === null || busy.value !== null || freigebend.value) return;
        freigebend.value = true;
        ergebnis.value = null;
        freigabe.value = null;
        try {
            const body: WegfindungFreigabeBody = { operationId: newOperationId(), baseRevision: s.revision };
            await withConfirmation(() => postJson<OperationReceipt>(WEGFINDUNG_FREIGABE_URL, body, deps.fetcher), ask);
            freigabe.value = { ok: true, problems: [] };
        } catch (error) {
            freigabe.value = alsErgebnis(error);
        }
        freigebend.value = false;
        await load();
    }

    async function uebernimm(id: string): Promise<void> {
        const text = felder.value[id];
        if (text === undefined) return;
        const wert = WEGFINDUNG_PANELE.flatMap((panel) => panel.werte).find((eintrag) => eintrag.id === id);
        if (wert === undefined) return;
        if (text.trim() === "") {
            loese(id);
            return;
        }
        const problem = problemSatz(wert, text);
        if (problem !== null) {
            probleme.value = { ...probleme.value, [id]: problem };
            return;
        }
        const eingabe = leseZahl(text)!;
        // Dieselbe Zahl wie der geltende Wert ist keine Änderung; der Server antwortete 409 `no_change`.
        if (eingabe === (gesetzt(id) ?? wegfindungVorgabe(wert))) {
            loese(id);
            return;
        }
        // Zurück auf die Vorgabe getippt heißt: die Abweichung löschen, nicht die Vorgabe speichern.
        await schreibe(id, eingabe === wegfindungVorgabe(wert) ? null : eingabe);
    }

    async function zuruecksetzen(id: string): Promise<void> {
        if (gesetzt(id) === null) {
            loese(id);
            return;
        }
        await schreibe(id, null);
    }

    return {
        stand,
        loading,
        loadProblems,
        unconfirmed,
        confirmAgain: () => reads.offer(),
        busy,
        ergebnis,
        freigebend,
        freigabe,
        felder,
        probleme,
        load,
        tippe,
        uebernimm,
        zuruecksetzen,
        freigeben,
    };
}
