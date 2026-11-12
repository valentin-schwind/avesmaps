import { ref, type Ref } from "vue";
import {
    WIKISYNC_ARTIKEL_URL,
    WIKISYNC_BEGRIFFE_URL,
    WIKISYNC_BEREICHE_URL,
    WIKISYNC_BERICHT_URL,
    WIKISYNC_DUMP_URL,
    WIKISYNC_REGELN_FLAECHEN_URL,
    WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL,
    WIKISYNC_REGELN_FLAECHE_ZURUECK_URL,
    WIKISYNC_REGELN_UEBERNEHMEN_URL,
    WIKISYNC_REGELN_URL,
    WIKISYNC_REGELN_ZURUECK_URL,
    WIKISYNC_STAND_URL,
    WIKISYNC_TAFELN_URL,
    WIKISYNC_UEBERNEHMEN_URL,
    WIKISYNC_VORSCHAU_URL,
    WIKISYNC_ZURUECKNEHMEN_URL,
    type OperationReceipt,
    type WikisyncAblauf,
    type WikisyncArtikelListe,
    type WikisyncBereich,
    type WikisyncBereiche,
    type WikisyncBericht,
    type WikisyncBegriffAenderung,
    type WikisyncBegriffe,
    type WikisyncBegriffeAbfrage,
    type WikisyncRegelAbfrage,
    type WikisyncRegelFlaechen,
    type WikisyncRegelListe,
    type WikisyncStand,
    type WikisyncTafeln,
    type WikisyncTafelnBody,
} from "@avesmaps3d/shared";
import { isMessageKey, type MessageKey } from "../i18n/i18n";
import { ApiFailure, getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import {
    createReadConfirmation,
    neededConfirmation,
    requestConfirmation,
    withConfirmation,
    type Need,
    type ReadConfirmation,
} from "../auth/bestaetigen";
import { formProblems, type Phrase } from "../auth/formular";
import { hoereWikiSyncMeldung } from "./wikisync-melde";
import type { ActionResult } from "../auth/verwaltung";

/**
 * Der Reiter „WikiSync“ der Systemsteuerung (WI-0253 UI-1 und UI-2, Mockup `review/wi-0253/wikisync-mockup.html`, abgenommen 2026-10-25): was die
 * Oberfläche lädt und anstößt. Wie es aussieht, steht in `verwaltung-wikisync.vue` und den Bauteilen daneben; die Sätze in `wikisync-text.ts`.
 *
 * - **Fünf Lesewege** auf einmal: Stand (Dump, Kategorien-Datei, Vorschau, Aufträge), Bereiche (Schalter, letzte Übernahme), die Kopfzahlen des Berichts, die Vergleiche einzelner
 *   Artikel (mit der Auskunft, ob ein Abruf beim Wiki erlaubt ist) und die zwei Tafeln. Keiner fragt das Wiki.
 * - **Kein Kanal zum Browser:** Solange ein Auftrag wartet oder läuft und der Reiter offen ist, sieht er alle paar Sekunden
 *   nach. Die Tafeln (mit ihren Zählungen) lädt er nur beim Öffnen und nach dem Speichern.
 * - **Handlungen** reihen einen Auftrag ein (den Lauf starten, Zurücknehmen, Artikel vergleichen) oder stellen eine Einstellung (Tafeln). Was einen Passkey
 *   braucht, fragt der Server; `withConfirmation` öffnet dann „Kurz bestätigen“.
 * - **Ein Start, ein Passkey** (WI-0253 §20, Variante A): „WikiSync starten“ ist EINE Handlung (`starten`). Dump und Kategorien-Datei lesen (die Vorschau) und Übernehmen verkettet der Server aus den
 *   vorhandenen Aufträgen (WI-0294: Es gibt keinen Wiki-Teil im 20-Sekunden-Takt mehr); die Seite sieht den Fortschritt an dem, was sie ohnehin liest.
 */

/** Wie oft nachgesehen wird, solange etwas läuft. */
export const NACHSEHEN_MS = 4000;

/** Die Handlungen des Reiters, je mit eigener Stelle für ihr Ergebnis. */
export type WikisyncHandlung =
    | "start"
    | "zurueck"
    | "artikel"
    | "dump"
    | "namensraeume"
    | "ohne"
    | "vorschau"
    | "regeln"
    | "regelnZurueck"
    | "flaeche"
    | "begriffe";

/**
 * Was „WikiSync starten“ schickt: die gewählten Bereiche (oder alle, nur ein Admin) und wie weit der Lauf zurückgeht. `ganz` liest den Dump und die Kategorien-Datei (die Vorschau) und übernimmt;
 * ein Bereich mit Kategorien steht aus, solange keine Kategorien-Datei im Dump-Ordner liegt.
 */
export type WikisyncStartWahl = ({ alle: true } | { bereiche: WikisyncBereich[] }) & { ablauf: WikisyncAblauf };

/** Was ein Speichern der Tafeln schickt (ohne Kennung und Revision, die setzt der Speicher der Seite). */
export type WikisyncTafelnKoerper = Omit<WikisyncTafelnBody, "operationId" | "baseRevision">;

export interface WikisyncDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    reads?: ReadConfirmation;
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}

export interface Wikisync {
    stand: Ref<WikisyncStand | null>;
    bereiche: Ref<WikisyncBereiche | null>;
    /** Die Kopfzahlen des Berichts: die Läufe je Bereich und die Zähler, ohne Zeilen. */
    bericht: Ref<WikisyncBericht | null>;
    /** Die jüngsten Vergleiche einzelner Artikel (D-2) mit ihren Zeilen und der Auskunft, ob ein Abruf beim Wiki erlaubt ist. */
    artikel: Ref<WikisyncArtikelListe | null>;
    tafeln: Ref<WikisyncTafeln | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    confirmAgain(): void;
    /** Welche Handlung gerade unterwegs ist. */
    busy: Ref<WikisyncHandlung | null>;
    /** Das Ergebnis der letzten Handlung an ihrer Stelle (eine Ablehnung oder ein Hinweis). */
    ergebnis: Ref<{ wo: WikisyncHandlung; result: ActionResult } | null>;
    load(): Promise<void>;
    ladeTafeln(): Promise<void>;
    follow(on: boolean): void;
    /** Den Lauf starten (`ablauf: "ganz"`): Dump und Kategorien-Datei lesen, dann übernehmen. */
    starten(wahl: WikisyncStartWahl): Promise<ActionResult>;
    /** Eine Übernahme zurücknehmen; ohne Bereich den ganzen Lauf. */
    zuruecknehmen(lauf: number, bereich?: WikisyncBereich): Promise<ActionResult>;
    /** EINEN Artikel über die MediaWiki-API vergleichen (ein leichter Auftrag, das Ergebnis steht im Dump-Bericht). */
    artikelVergleichen(titel: string): Promise<ActionResult>;
    /**
     * Das Holen des Dumps anfordern (WI-0253 §22): Der Server reiht einen Auftrag ein, den Claudios Korridor ausführt; der Klick wartet nicht auf das Ergebnis, die Zeile liest den Stand.
     * In Production fragt der Server den frischen Passkey, sonst genügt das Recht.
     */
    dumpHolen(): Promise<ActionResult>;
    /**
     * Die Tafeln des Kanon-Etiketts speichern, jede Änderung für sich (WI-0253, Vali 2026-10-27: „warum muss man speichern, warum speichert der klick nicht?“).
     * 🔴 Die Aufrufe stehen in EINER Reihe: Eine zweite Änderung wartet auf die erste, damit sie mit der Revision NACH dieser geht (sonst 409) und ein Passkey nur
     * einmal gefragt wird. `body` darf eine Funktion sein: Sie wird erst gerufen, wenn die Reihe an der Änderung ist, und liefert `null`, wenn es nichts mehr zu
     * schicken gibt (schon so gespeichert); das ist ein Erfolg ohne Anfrage.
     */
    tafelnSpeichern(
        wo: "namensraeume" | "ohne",
        body: WikisyncTafelnKoerper | (() => WikisyncTafelnKoerper | null),
    ): Promise<ActionResult>;
    /**
     * Die Regelvorschläge der Vorkommen (WI-0253 §24): die Seite eines Laufs, gefiltert. Der Server rechnet nichts; „neu ableiten“ ist `vorschauVorkommen`. Die Liste gehört dem Fenster
     * (Filter, Seite, Auswahl), nicht dem Reiter; der Reiter liest sie nur.
     */
    ladeRegeln(abfrage: WikisyncRegelAbfrage): Promise<WikisyncRegelListe>;
    /** Die Vorschau nur der Vorkommen neu berechnen („neu ableiten“): ein Auftrag, der nichts schreibt außer dem Protokoll des Laufs. */
    vorschauVorkommen(): Promise<ActionResult>;
    /** Nur die ausgewählten Vorschläge eines Laufs übernehmen (legt Regeln mit Herkunft `wiki_verbreitung` an; Passkey). */
    regelnUebernehmen(lauf: number, vorschlaege: readonly number[]): Promise<ActionResult>;
    /** Eine Übernahme von Regeln zurücknehmen. */
    regelnZuruecknehmen(uebernahme: number): Promise<ActionResult>;
    /** Die offenen Flächen, zu denen es eine gleichnamige Fläche ohne Wiki-Schlüssel gibt (WI-0253 §25), aus dem Protokoll des jüngsten Laufs. */
    ladeRegelFlaechen(): Promise<WikisyncRegelFlaechen>;
    /** Der Fläche `flaeche` den Wiki-Artikel `titel` zuweisen (der Server prüft Name, Titel und Schlüssel selbst; in Production mit frischem Passkey). Die Liste muss danach neu abgeleitet werden. */
    flaecheZuweisen(flaeche: string, titel: string): Promise<ActionResult>;
    /** Diese Zuweisung zurücknehmen (nur, solange die Zuordnung der Fläche noch so dasteht). */
    flaecheZuruecknehmen(flaeche: string): Promise<ActionResult>;
    /** Die Begriffstafel (WI-0253 §24): jedes Wort mit seinen Pillen. Merkt sich die Revision für das Speichern. */
    ladeBegriffe(abfrage: WikisyncBegriffeAbfrage): Promise<WikisyncBegriffe>;
    /**
     * EINE Änderung der Begriffstafel speichern, sofort (kein Speichern-Knopf). 🔴 Wie bei den Tafeln des Kanon-Etiketts stehen die Aufrufe in einer Reihe: Eine zweite Änderung wartet auf die erste und
     * geht mit der Revision NACH ihr (sonst 409); ein Passkey wird so nur einmal gefragt (in Production). `aenderung` darf eine Funktion sein, die erst läuft, wenn die Reihe an der Änderung ist,
     * und `null` liefert, wenn es nichts mehr zu schicken gibt.
     */
    begriffeSpeichern(
        aenderung: WikisyncBegriffAenderung | (() => WikisyncBegriffAenderung | null),
    ): Promise<ActionResult>;
}

/** Läuft etwas, wonach sich Nachsehen lohnt? */
export function laeuftEtwas(stand: WikisyncStand | null): boolean {
    return (stand?.auftraege.length ?? 0) > 0;
}

/**
 * Der Satz zu einer Ablehnung des Servers: Die Gründe des WikiSync stehen in der Sprachtafel (`admin.wikisync.fehler.<code>`); eine ungültige Zeile der
 * Tafeln nennt ihren Grund (`admin.wikisync.tafel.fehler.<grund>`); alles andere nimmt die gemeinsame Zuordnung der Verwaltung.
 */
export function wikisyncProbleme(error: unknown): Phrase[] {
    if (error instanceof ApiFailure) {
        if (error.code === "validation_failed" && typeof error.details?.["reason"] === "string") {
            const key = `admin.wikisync.tafel.fehler.${error.details["reason"]}`;
            if (isMessageKey(key))
                return [{ key: key as MessageKey, params: { zeile: String(error.details["row"] ?? "") } }];
        }
        const key = `admin.wikisync.fehler.${error.code}`;
        if (isMessageKey(key)) return [{ key: key as MessageKey }];
    }
    const bekannt = formProblems(error);
    // Kennt keine Zuordnung den Fehler, steht nicht nur „Das ging gerade nicht.“ da (erster Lauf auf der Stage, 2026-10-26: Beim Umschalten blieb nur dieser Satz, und niemand konnte sagen, woran es lag):
    // Der Code des Servers (mit dem Status) oder der Name des Fehlers in der Seite steht dabei.
    if (bekannt.length === 1 && bekannt[0]?.key === "auth.form.failed") {
        const code =
            error instanceof ApiFailure
                ? `${String(error.status)} ${error.code}`
                : error instanceof Error
                  ? error.name
                  : "?";
        return [{ key: "admin.wikisync.fehler.unbekannt", params: { code } }];
    }
    return bekannt;
}

function ergebnisAus(error: unknown): ActionResult {
    const failure = error instanceof ApiFailure ? error : undefined;
    if (failure?.code === "reauth_required" || failure?.code === "assurance_required") {
        return { ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] };
    }
    if (failure?.code === "edit_conflict") {
        const by = (failure.details?.["changedBy"] as { displayName?: string } | undefined)?.displayName ?? null;
        const at = failure.details?.["changedAt"];
        return {
            ok: false,
            problems: [{ key: "admin.conflict.anonymous" }],
            conflict: { by, at: typeof at === "string" ? at : null },
        };
    }
    return { ok: false, problems: wikisyncProbleme(error) };
}

export function createWikisync(deps: WikisyncDeps = {}): Wikisync {
    const stand = ref<WikisyncStand | null>(null);
    const bereiche = ref<WikisyncBereiche | null>(null);
    const bericht = ref<WikisyncBericht | null>(null);
    const artikel = ref<WikisyncArtikelListe | null>(null);
    const tafeln = ref<WikisyncTafeln | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const busy = ref<WikisyncHandlung | null>(null);
    const ergebnis = ref<{ wo: WikisyncHandlung; result: ActionResult } | null>(null);
    const ask = deps.ask ?? requestConfirmation;
    const reads = deps.reads ?? createReadConfirmation(ask);
    reads.onOffer(() => (unconfirmed.value === null ? undefined : load()));
    const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
    const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const holen = <T>(url: string): Promise<T> => withConfirmation(() => getJson<T>(url, deps.fetcher), reads.ask);
    let ticket = 0;
    let following = false;
    let timer: unknown = undefined;
    /** Solange die Ansicht offen ist, liest sie neu, wenn „Änderungen“ eine Rücknahme des WikiSync anstößt (WI-0265 B8d). */
    let abmelden: (() => void) | undefined;

    function planen(): void {
        if (timer !== undefined) clearTimer(timer);
        timer = undefined;
        if (!following || unconfirmed.value !== null || !laeuftEtwas(stand.value)) return;
        timer = setTimer(() => {
            timer = undefined;
            void load();
        }, NACHSEHEN_MS);
    }

    function fehler(error: unknown): void {
        loadProblems.value = formProblems(error);
        unconfirmed.value = neededConfirmation(error);
    }

    async function load(): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const [s, b, r, a] = await Promise.all([
                holen<WikisyncStand>(WIKISYNC_STAND_URL),
                holen<WikisyncBereiche>(WIKISYNC_BEREICHE_URL),
                holen<WikisyncBericht>(`${WIKISYNC_BERICHT_URL}?limit=1`),
                holen<WikisyncArtikelListe>(WIKISYNC_ARTIKEL_URL),
            ]);
            if (mine !== ticket) return;
            stand.value = s;
            bereiche.value = b;
            bericht.value = r;
            artikel.value = a;
            loadProblems.value = [];
            unconfirmed.value = null;
        } catch (error) {
            if (mine === ticket) fehler(error);
        } finally {
            if (mine === ticket) {
                loading.value = false;
                planen();
            }
        }
    }

    async function ladeTafeln(): Promise<void> {
        try {
            tafeln.value = await holen<WikisyncTafeln>(WIKISYNC_TAFELN_URL);
        } catch (error) {
            fehler(error);
        }
    }

    /** Eine Handlung: senden, das Ergebnis an ihre Stelle, danach neu laden. */
    async function handle(
        wo: WikisyncHandlung,
        senden: () => Promise<OperationReceipt>,
        nachher: () => Promise<void> = load,
    ): Promise<ActionResult> {
        // Nie still: Läuft gerade eine andere Handlung des Reiters, sagt die Stelle der Handlung das (sonst sähe es aus, als wäre nichts geschehen).
        if (busy.value !== null) return { ok: false, problems: [{ key: "admin.wikisync.fehler.beschaeftigt" }] };
        busy.value = wo;
        ergebnis.value = null;
        let result: ActionResult;
        try {
            const receipt = await withConfirmation(senden, ask);
            // „Alle“ übernimmt, was übernommen werden darf, und nennt, was nicht: Das steht als Hinweis an der Stelle.
            // Ein Satz je Grund, auch wenn viele Zeilen ihn nennen (die Regeln melden je Eintrag).
            const gesehen = new Set<string>();
            result = {
                ok: true,
                problems: receipt.warnings.flatMap((warning) => {
                    const key = `admin.wikisync.fehler.${warning.code}`;
                    if (!isMessageKey(key) || gesehen.has(key)) return [];
                    gesehen.add(key);
                    return [{ key: key as MessageKey }];
                }),
            };
        } catch (error) {
            result = ergebnisAus(error);
        }
        ergebnis.value = { wo, result };
        busy.value = null;
        await nachher();
        return result;
    }

    const post = (url: string, body: Record<string, unknown>) => () =>
        postJson<OperationReceipt>(url, { operationId: newOperationId(), ...body }, deps.fetcher);

    /** Die Reihe der Tafel-Änderungen: Jede wartet auf die vorige (auch auf deren Neuladen der Revision). */
    let tafelReihe: Promise<unknown> = Promise.resolve();
    function tafelnSpeichern(
        wo: "namensraeume" | "ohne",
        body: WikisyncTafelnKoerper | (() => WikisyncTafelnKoerper | null),
    ): Promise<ActionResult> {
        const lauf = tafelReihe.then((): Promise<ActionResult> => {
            const koerper = typeof body === "function" ? body() : body;
            if (koerper === null) return Promise.resolve({ ok: true, problems: [] });
            return handle(
                wo,
                () =>
                    postJson<OperationReceipt>(
                        WIKISYNC_TAFELN_URL,
                        { operationId: newOperationId(), baseRevision: tafeln.value?.revision ?? 0, ...koerper },
                        deps.fetcher,
                    ),
                async () => {
                    await Promise.all([load(), ladeTafeln()]);
                },
            );
        });
        tafelReihe = lauf.catch(() => undefined);
        return lauf;
    }

    /** Die Revision der Begriffstafel, wie die Seite sie zuletzt las (`baseRevision` beim Speichern). */
    let begriffeRevision = 0;
    const mitQuery = (url: string, abfrage: object): string => {
        const teile = new URLSearchParams();
        for (const [name, wert] of Object.entries(abfrage)) if (wert !== undefined) teile.set(name, String(wert));
        const text = teile.toString();
        return text === "" ? url : `${url}?${text}`;
    };
    async function ladeBegriffe(abfrage: WikisyncBegriffeAbfrage): Promise<WikisyncBegriffe> {
        const antwort = await holen<WikisyncBegriffe>(mitQuery(WIKISYNC_BEGRIFFE_URL, abfrage));
        begriffeRevision = antwort.revision;
        return antwort;
    }

    /** Die Reihe der Änderungen der Begriffstafel: Jede wartet auf die vorige (auch auf deren Neuladen der Revision). */
    let begriffeReihe: Promise<unknown> = Promise.resolve();
    function begriffeSpeichern(
        aenderung: WikisyncBegriffAenderung | (() => WikisyncBegriffAenderung | null),
    ): Promise<ActionResult> {
        const lauf = begriffeReihe.then((): Promise<ActionResult> => {
            const eine = typeof aenderung === "function" ? aenderung() : aenderung;
            if (eine === null) return Promise.resolve({ ok: true, problems: [] });
            return handle(
                "begriffe",
                () =>
                    postJson<OperationReceipt>(
                        WIKISYNC_BEGRIFFE_URL,
                        { operationId: newOperationId(), baseRevision: begriffeRevision, aenderungen: [eine] },
                        deps.fetcher,
                    ),
                async () => {
                    // Die Revision für die nächste Änderung der Reihe (die Liste selbst lädt das Fenster).
                    try {
                        await ladeBegriffe({ limit: 1 });
                    } catch {
                        /* Die nächste Änderung meldet einen Konflikt selbst. */
                    }
                },
            );
        });
        begriffeReihe = lauf.catch(() => undefined);
        return lauf;
    }

    return {
        stand,
        bereiche,
        bericht,
        artikel,
        tafeln,
        loading,
        loadProblems,
        unconfirmed,
        confirmAgain: () => reads.offer(),
        busy,
        ergebnis,
        load,
        ladeTafeln,
        follow(on): void {
            following = on;
            if (on && abmelden === undefined) abmelden = hoereWikiSyncMeldung(() => void load());
            if (!on) {
                abmelden?.();
                abmelden = undefined;
            }
            planen();
        },
        starten: (wahl) => handle("start", post(WIKISYNC_UEBERNEHMEN_URL, wahl)),
        zuruecknehmen: (lauf, bereich) =>
            handle("zurueck", post(WIKISYNC_ZURUECKNEHMEN_URL, bereich === undefined ? { lauf } : { lauf, bereich })),
        artikelVergleichen: (titel) => handle("artikel", post(WIKISYNC_ARTIKEL_URL, { titel })),
        dumpHolen: () => handle("dump", post(WIKISYNC_DUMP_URL, {})),
        tafelnSpeichern,
        ladeRegeln: (abfrage) => holen<WikisyncRegelListe>(mitQuery(WIKISYNC_REGELN_URL, abfrage)),
        vorschauVorkommen: () => handle("vorschau", post(WIKISYNC_VORSCHAU_URL, { bereiche: ["vorkommen"] })),
        regelnUebernehmen: (lauf, vorschlaege) =>
            handle("regeln", post(WIKISYNC_REGELN_UEBERNEHMEN_URL, { lauf, vorschlaege: [...vorschlaege] })),
        regelnZuruecknehmen: (uebernahme) => handle("regelnZurueck", post(WIKISYNC_REGELN_ZURUECK_URL, { uebernahme })),
        ladeRegelFlaechen: () => holen<WikisyncRegelFlaechen>(WIKISYNC_REGELN_FLAECHEN_URL),
        flaecheZuweisen: (flaeche, titel) =>
            handle("flaeche", post(WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL, { flaeche, titel })),
        flaecheZuruecknehmen: (flaeche) => handle("flaeche", post(WIKISYNC_REGELN_FLAECHE_ZURUECK_URL, { flaeche })),
        ladeBegriffe,
        begriffeSpeichern,
    };
}
