import { ref, type Ref } from "vue";
import {
    ABZUG_SCHLUESSEL_HOECHSTENS,
    ABZUG_SCHLUESSEL_TAGE,
    ABZUG_URL,
    istAbzugSchluessel,
    type AbgleichKreis,
    type AbzugLauf,
    type AbzugLink,
    type AbzugProblem,
    type AbzugQuelle,
    type AbzugSchluessel,
    type AbzugSchluesselNeu,
    type AbzugSicht,
    type AbzugSichtEinspielen,
    type AbzugSichtErstellen,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { isMessageKey, locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { haengtGrund } from "../status/gemeinsam-view";
import { warteSatz } from "./abgleiche";
import { ApiFailure, getJson, newOperationId, postJson, putDatei, type Fetcher } from "./api";
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
 * Der Abzug für lokal im Datenabgleich (WI-0251; Vali 2026-10-24: „ja von stage und production, aber ohne die accounts, statistiken und alle
 * kartendaten auch“). Was die Oberfläche rechnet, steht hier; wie es aussieht, in `verwaltung-abzug.vue`.
 *
 * - **Stage und Production** (`erstellen`): „⇄ Abzug erstellen“ fragt an der Stelle nach (`AvmBestaetigung`) und reiht den Auftrag ein; die Liste
 *   der fertigen Abzüge trägt je Zeile „↓ Herunterladen“. Der Knopf holt einen Link (mit frischem Passkey), der zwei Minuten gilt, und löst den
 *   Download aus.
 * - **Lokal** (`einspielen`): „✚ Datei wählen“ legt die Datei als Strom auf den Rechner und zeigt, ob sie zu dieser Datenbank passt; „⇄ Jetzt
 *   einspielen“ fragt nach (Sicherung, Konten bleiben) und startet das Ersetzen. 🔴 Es gibt keinen Weg, der ohne diesen Knopfdruck einspielt.
 * - Kein Kanal zum Browser: Solange ein Auftrag wartet oder das Einspielen läuft und der Eintrag offen ist, sieht er alle paar Sekunden nach.
 * - Antwortet der Server auf `GET /api/admin/system/abzug` mit 404, hat diese Umgebung keine Rolle beim Abzug; der Eintrag zeigt dann nichts.
 * - **Selbst abholen** (Vali 2026-10-25: „ich will keine dateien runter und wieder hochladen“): Auf Stage und Production legt ein Admin einen
 *   **Abzugs-Schlüssel** an (Passkey, Ablauf, widerrufbar; der Wert steht EINMAL da, im Kopierfeld). Lokal trägt man ihn je Quelle ein; „Abzug holen und
 *   einspielen“ holt den neuesten Abzug der Quelle selbst, mit Fortsetzen nach einem Abbruch, und spielt ihn ein wie die gewählte Datei (Sicherung,
 *   Prüfsummen, Medien), danach ist die Datei gelöscht. Den Schlüssel liest die Seite nie zurück: Der Server sagt nur, für welche Quelle einer da ist.
 */

/** Wie oft nachgesehen wird, solange etwas wartet oder läuft. */
export const NACHSEHEN_MS = 3000;

export type AbzugFrage = "erstellen" | "einspielen" | "schluessel" | `holen:${AbzugQuelle}`;

/** Wie lange ein neuer Schlüssel gelten soll, wenn die Person nichts wählt. */
export const SCHLUESSEL_TAGE_VORGABE = 90;
export type SchluesselTage = (typeof ABZUG_SCHLUESSEL_TAGE)[number];

export function istErstellen(sicht: AbzugSicht | null): sicht is AbzugSichtErstellen {
    return sicht?.rolle === "erstellen";
}

export function istEinspielen(sicht: AbzugSicht | null): sicht is AbzugSichtEinspielen {
    return sicht?.rolle === "einspielen";
}

const EINHEITEN = ["B", "KB", "MB", "GB", "TB"] as const;

/** Eine Dateigröße in der Sprache der Seite: „312 MB“, „1,4 GB“. */
export function groesseText(bytes: number): string {
    let wert = bytes;
    let stufe = 0;
    while (wert >= 1024 && stufe < EINHEITEN.length - 1) {
        wert /= 1024;
        stufe += 1;
    }
    const format = new Intl.NumberFormat(locale.value, { maximumFractionDigits: wert < 10 && stufe > 0 ? 1 : 0 });
    return `${format.format(wert)} ${EINHEITEN[stufe]}`;
}

export function zahlText(zahl: number): string {
    return new Intl.NumberFormat(locale.value).format(zahl);
}

/** „3.372 Mediendateien · 243 MB“: was ein Abzug an Bilddateien trägt. */
export function medienText(anzahl: number, bytes: number): string {
    return t("admin.abzug.medien", { n: zahlText(anzahl), groesse: groesseText(bytes) });
}

/** Die Fakten einer Datei mit den Mediendateien dahinter; ohne Mediendateien bleibt der Satz, wie er ist. */
export function faktenMitMedien(fakten: string, medien: number, medienBytes: number, fehlend = 0): string {
    if (medien === 0 && fehlend === 0) return fakten;
    const teile = [fakten, medienText(medien, medienBytes)];
    if (fehlend > 0) teile.push(t("admin.abzug.medien.fehlend", { n: zahlText(fehlend) }));
    return teile.join(" · ");
}

/**
 * Die Zeile zu den Mediendateien im Ergebnis des letzten Einspielens: was abgelegt wurde, oder, wenn etwas ausstehen blieb, „Medien unvollständig“ mit
 * der Zahl und dem Weg, es nachzuholen. `null`, wenn der Abzug keine Mediendateien trug.
 */
export function ergebnisMedien(lauf: AbzugLauf): Unterzeile | null {
    const medien = lauf.medien;
    if (lauf.zustand !== "fertig" || medien === undefined || medien === null || medien.dateien === 0) return null;
    if (medien.offen > 0) {
        return {
            text: t("admin.abzug.ergebnis.medienOffen", { offen: zahlText(medien.offen), n: zahlText(medien.dateien) }),
            ton: "warnung",
        };
    }
    return {
        text: t("admin.abzug.ergebnis.medien", { n: zahlText(medien.dateien), groesse: groesseText(medien.bytes) }),
        ton: "leise",
    };
}

function zeitpunkt(iso: string, now: Date): string {
    return relativeTime(new Date(iso), now, locale.value, "zeitpunkt");
}

function phaseName(phase: string | null): string | null {
    if (phase === null) return null;
    const key = `admin.abzug.phase.${phase}`;
    return isMessageKey(key) ? t(key) : phase;
}

/** Was eine Zeile in ihrer Unterzeile sagt, samt Ton (Legacys Listen: leise, gut, Warnung). */
export interface Unterzeile {
    text: string;
    ton: "leise" | "gut" | "warnung" | "fehler";
}

/** Stage und Production: der Auftrag und der letzte Lauf. */
export function erstellenUnterzeile(sicht: AbzugSichtErstellen, now: Date): Unterzeile {
    const laufend = sicht.laufend;
    if (laufend !== null) {
        if (laufend.state === "QUEUED") {
            const teile = [t("admin.sync.queued")];
            if ((laufend.platz ?? null) !== null) teile.push(t("status.row.position", { n: laufend.platz ?? 0 }));
            teile.push(warteSatz(laufend.waitReason));
            return { text: teile.join(" · "), ton: haengtGrund(laufend.waitReason) ? "fehler" : "warnung" };
        }
        const teile = [t("admin.sync.running", { time: zeitpunkt(laufend.startedAt ?? laufend.queuedAt, now) })];
        const phase = phaseName(laufend.phase);
        if (phase !== null) teile.push(phase);
        if (laufend.progress !== null) teile.push(`${String(Math.round(laufend.progress * 100))} %`);
        return { text: teile.join(" · "), ton: "leise" };
    }
    const letzter = sicht.letzter;
    if (letzter === null) return { text: t("admin.abzug.never"), ton: "leise" };
    const wann = zeitpunkt(letzter.finishedAt, now);
    if (letzter.state === "FAILED" || letzter.state === "CANCELLED") {
        const teile = [t(letzter.state === "FAILED" ? "admin.abzug.failed" : "admin.sync.cancelled", { time: wann })];
        if (letzter.fehler !== null) teile.push(letzter.fehler);
        return { text: teile.join(" · "), ton: "warnung" };
    }
    const wer =
        letzter.ausgeloest.art === "person" && letzter.ausgeloest.name !== null
            ? t("admin.sync.by", { name: letzter.ausgeloest.name })
            : t("admin.sync.byProcess");
    return { text: [t("admin.abzug.last", { time: wann }), wer].join(" · "), ton: "gut" };
}

/** Lokal: das Einspielen und sein letzter Lauf. */
export function einspielenUnterzeile(sicht: AbzugSichtEinspielen, now: Date): Unterzeile {
    const lauf = sicht.lauf;
    if (lauf === null) return { text: t("admin.abzug.lokal.nie"), ton: "leise" };
    if (lauf.zustand === "laeuft") {
        const teile = [t("admin.abzug.lokal.laeuft", { time: zeitpunkt(lauf.seit, now) })];
        const phase = phaseName(lauf.phase);
        if (phase !== null) teile.push(phase);
        if (lauf.tafel !== null) teile.push(lauf.tafel);
        if (lauf.fortschritt !== null) teile.push(`${String(Math.round(lauf.fortschritt * 100))} %`);
        // Beim Holen: wie viel der Datei schon da ist.
        if (lauf.phase === "holen" && lauf.holen !== undefined && lauf.holen !== null && lauf.holen.gesamt > 0) {
            teile.push(
                t("admin.abzug.holen.fortschritt", {
                    geladen: groesseText(lauf.holen.geladen),
                    gesamt: groesseText(lauf.holen.gesamt),
                }),
            );
        }
        return { text: teile.join(" · "), ton: "leise" };
    }
    // Was geschah, steht darunter in der Ergebniszeile (Zeilen, Sicherung, der Satz des Fehlers); hier nur, wann und ob.
    const wann = zeitpunkt(lauf.ende ?? lauf.seit, now);
    if (lauf.zustand === "fehler") return { text: t("admin.abzug.lokal.fehler", { time: wann }), ton: "warnung" };
    // Die Datenbank ist ersetzt, aber nicht jede Mediendatei liegt: nicht grün.
    return {
        text: t("admin.abzug.lokal.fertig", { time: wann }),
        ton: (lauf.medien?.offen ?? 0) > 0 ? "warnung" : "gut",
    };
}

/** Der Name einer Quelle in der Sprache der Seite: „Stage“, „Production“. */
export function quellenName(quelle: AbzugQuelle): string {
    return t(`admin.abzug.quelle.${quelle}`);
}

/**
 * Kommt das laufende Einspielen vom Holen? Dann nennt es die Quelle, und deren Zeile zeigt Lage und Balken, nicht der Weg der Datei. Solange die
 * Datei kommt, sagt es der Lauf selbst (`holen`); danach ist er von einem Einspielen der Datei nicht zu unterscheiden, und es zählt, was DIESE
 * Seite gestartet hat (`geholtVon`). Weiß sie es nicht (etwa nach dem Neuladen mitten im Lauf), ist es `null`.
 */
export function holenQuelleGerade(sicht: AbzugSicht | null, geholtVon: AbzugQuelle | null): AbzugQuelle | null {
    if (!istEinspielen(sicht) || sicht.lauf?.zustand !== "laeuft") return null;
    return sicht.lauf.holen?.quelle ?? geholtVon;
}

/**
 * Steht der Weg „Datei von Hand einspielen“ offen, ohne dass jemand ihn aufgeklappt hat? (Vali 2026-10-25: Sichtbar ist nur „Abzug holen und
 * einspielen“, der Weg mit der Datei bleibt ein leiser Notweg.) Ja, solange die Datei übernommen und geprüft wird und solange ein Einspielen
 * läuft, das nicht vom Holen kommt: Dort stehen sein Fortschritt und seine Lage.
 */
export function dateiWegErzwungen(
    sicht: AbzugSicht | null,
    hochladen: boolean,
    geholtVon: AbzugQuelle | null,
): boolean {
    if (hochladen) return true;
    return istEinspielen(sicht) && sicht.lauf?.zustand === "laeuft" && holenQuelleGerade(sicht, geholtVon) === null;
}

/** Der Titel einer Zeile in der Liste der Schlüssel: wer ihn anlegte. */
export function schluesselTitel(eintrag: AbzugSchluessel): string {
    return eintrag.von === null
        ? t("admin.abzug.schluessel.titelOhne")
        : t("admin.abzug.schluessel.titel", { name: eintrag.von });
}

/** Die Unterzeile eines Schlüssels: bis wann er gilt und wann er zuletzt benutzt wurde; abgelaufen und widerrufen im Ton der Warnung. */
export function schluesselUnterzeile(eintrag: AbzugSchluessel, now: Date): Unterzeile {
    const bis = zeitpunkt(eintrag.laeuftAb, now);
    if (eintrag.zustand === "widerrufen") return { text: t("admin.abzug.schluessel.widerrufen"), ton: "warnung" };
    if (eintrag.zustand === "abgelaufen")
        return { text: t("admin.abzug.schluessel.abgelaufen", { time: bis }), ton: "warnung" };
    const zuletzt =
        eintrag.zuletzt === null
            ? t("admin.abzug.schluessel.nie")
            : t("admin.abzug.schluessel.zuletzt", { time: zeitpunkt(eintrag.zuletzt, now) });
    return { text: [t("admin.abzug.schluessel.gueltigBis", { time: bis }), zuletzt].join(" · "), ton: "leise" };
}

/** Wie viele Schlüssel gerade gelten. */
export function gueltigeSchluessel(sicht: AbzugSichtErstellen): number {
    return sicht.schluessel.filter((eintrag) => eintrag.zustand === "gueltig").length;
}

/** Warum „Schlüssel anlegen“ gesperrt ist; `undefined`, wenn der Knopf geht. */
export function anlegenSperre(sicht: AbzugSichtErstellen, darf: boolean): string | undefined {
    if (!darf) return t("admin.abzug.schluessel.readOnly", { recht: t("auth.capability.create_backup") });
    if (gueltigeSchluessel(sicht) >= ABZUG_SCHLUESSEL_HOECHSTENS) {
        return t("admin.abzug.schluessel.voll", { n: ABZUG_SCHLUESSEL_HOECHSTENS });
    }
    return undefined;
}

/** Warum „Abzug holen und einspielen“ für diese Quelle gesperrt ist; `undefined`, wenn der Knopf geht. */
export function holenSperre(sicht: AbzugSichtEinspielen, darf: boolean, quelle: AbzugQuelle): string | undefined {
    const grund = einspielenSperreOhneDatei(sicht, darf);
    if (grund !== undefined) return grund;
    if (!sicht.schluessel[quelle]) return t("admin.abzug.holen.ohneSchluessel", { quelle: quellenName(quelle) });
    return undefined;
}

function einspielenSperreOhneDatei(sicht: AbzugSichtEinspielen, darf: boolean): string | undefined {
    if (!darf) return t("admin.sync.readOnly", { recht: t("auth.capability.run_abzug_einspielen") });
    if (!sicht.ablage) return t("admin.abzug.noStorage");
    if (!sicht.sicherung) return t("admin.abzug.noBackup");
    if (sicht.lauf?.zustand === "laeuft") return t("admin.abzug.lokal.beschaeftigt");
    return undefined;
}

/** Der Kreis der Hauptzeile: voll, wenn der letzte Lauf gelang, sonst leer. */
export function abzugKreis(sicht: AbzugSicht | null): AbgleichKreis {
    if (istErstellen(sicht)) return sicht.letzter?.state === "SUCCEEDED" ? "voll" : "leer";
    if (istEinspielen(sicht))
        return sicht.lauf?.zustand === "fertig" && (sicht.lauf.medien?.offen ?? 0) === 0 ? "voll" : "leer";
    return "leer";
}

/** Der Fortschritt eines laufenden Auftrags oder Einspielens in Prozent für den Balken; sonst `null`. */
export function fortschritt(sicht: AbzugSicht | null): number | null {
    if (istErstellen(sicht)) {
        const laufend = sicht.laufend;
        if (laufend === null || laufend.state !== "RUNNING" || laufend.progress === null) return null;
        return Math.round(Math.min(1, Math.max(0, laufend.progress)) * 100);
    }
    if (istEinspielen(sicht)) {
        const lauf = sicht.lauf;
        if (lauf === null || lauf.zustand !== "laeuft" || lauf.fortschritt === null) return null;
        return Math.round(Math.min(1, Math.max(0, lauf.fortschritt)) * 100);
    }
    return null;
}

/** Ein Grund, der gegen das Einspielen spricht, als Satz: der feste Satz zum Code, dahinter in Klammern die erste Fundstelle. */
export function problemSatz(problem: AbzugProblem): string {
    const key = `admin.abzug.problem.${problem.code}`;
    const satz = isMessageKey(key) ? t(key) : problem.code;
    return problem.detail === null || problem.detail === "" ? satz : `${satz} (${problem.detail})`;
}

/** Warum „Abzug erstellen“ gesperrt ist; `undefined`, wenn der Knopf geht. */
export function erstellenSperre(sicht: AbzugSichtErstellen, darf: boolean): string | undefined {
    if (!darf) return t("admin.sync.readOnly", { recht: t("auth.capability.create_backup") });
    if (!sicht.ablage) return t("admin.abzug.noStorage");
    if (sicht.laufend !== null) return t("admin.abzug.alreadyQueued");
    return undefined;
}

/** Warum „Jetzt einspielen“ gesperrt ist; `undefined`, wenn der Knopf geht. */
export function einspielenSperre(sicht: AbzugSichtEinspielen, darf: boolean): string | undefined {
    if (!darf) return t("admin.sync.readOnly", { recht: t("auth.capability.run_abzug_einspielen") });
    if (!sicht.ablage) return t("admin.abzug.noStorage");
    if (!sicht.sicherung) return t("admin.abzug.noBackup");
    if (sicht.lauf?.zustand === "laeuft") return t("admin.abzug.lokal.beschaeftigt");
    const eingang = sicht.eingang;
    if (eingang === null) return t("admin.abzug.lokal.keineDatei");
    // Die Gründe stehen unter der Datei; der Knopf sagt nur, dass es sie gibt (nicht denselben Satz zweimal).
    if (eingang.probleme.length > 0) return t("admin.abzug.eingang.befund");
    return undefined;
}

export interface AbzugDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    /** Die Bestätigung der Lesewege, geteilt mit den übrigen Einträgen des Fensters. */
    reads?: ReadConfirmation;
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    /** Löst den Download aus (Tests ersetzen ihn); die Vorgabe lässt den Browser die Adresse als Anhang laden. */
    starteDownload?: (link: AbzugLink) => void;
}

/** Was „Schlüssel speichern“ der Person sagt, wenn der Wert nicht die Form eines Abzugs-Schlüssels hat. */
const SCHLUESSEL_FORM = { key: "admin.abzug.holen.schluesselForm" } as const;

export interface Abzug {
    sicht: Ref<AbzugSicht | null>;
    /** `false`: Der Server kennt keine Rolle beim Abzug (404); der Eintrag zeigt nichts. */
    verfuegbar: Ref<boolean>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    confirmAgain(): void;
    frage: Ref<AbzugFrage | null>;
    busy: Ref<boolean>;
    /** Die Datei wird gerade auf den Rechner gelegt. */
    hochladen: Ref<boolean>;
    /** Lokal: von welcher Quelle DIESE Seite das laufende oder letzte Einspielen geholt hat; `null`: von keiner (Datei, oder die Seite weiß es nicht). */
    geholtVon: Ref<AbzugQuelle | null>;
    /** Für welche Kennung gerade der Link geholt wird. */
    ladeKennung: Ref<string | null>;
    /** Stage und Production: wie lange der nächste Schlüssel gelten soll, und der frisch angelegte (sein Wert steht nur hier und nur jetzt). */
    tage: Ref<SchluesselTage>;
    neuerSchluessel: Ref<AbzugSchluesselNeu | null>;
    /** Welcher Schlüssel gerade widerrufen wird. */
    widerrufId: Ref<string | null>;
    /** Lokal: ein Schlüssel wird gerade gespeichert oder entfernt. */
    schluesselBusy: Ref<boolean>;
    /** Lokal: zu welcher Quelle die letzte Handlung gehörte (dort steht ihr Ergebnis); `null`: zu keiner. */
    letzteQuelle: Ref<AbzugQuelle | null>;
    /** Das Ergebnis der letzten Handlung: ein Fehler oder der Hinweis. */
    ergebnis: Ref<ActionResult | null>;
    load(): Promise<void>;
    ask(was: AbzugFrage): void;
    cancel(): void;
    confirm(): Promise<ActionResult>;
    herunterladen(kennung: string): Promise<ActionResult>;
    waehleDatei(datei: File): Promise<ActionResult>;
    /** Wie lange der nächste Schlüssel gelten soll. */
    waehleTage(tage: SchluesselTage): void;
    /** Der Schlüssel ist notiert (kopiert): Der Wert verschwindet aus der Seite. */
    schluesselGesehen(): void;
    widerrufen(id: string): Promise<ActionResult>;
    /** Lokal: den Schlüssel einer Quelle hinterlegen (`wert`) oder entfernen (`null`). */
    setzeSchluessel(quelle: AbzugQuelle, wert: string | null): Promise<ActionResult>;
    follow(on: boolean): void;
}

function beschaeftigt(sicht: AbzugSicht | null): boolean {
    if (istErstellen(sicht)) return sicht.laufend !== null;
    if (istEinspielen(sicht)) return sicht.lauf?.zustand === "laeuft";
    return false;
}

/** Der Browser lädt die Adresse als Anhang (`content-disposition`); ein Link in der Seite, der sofort geklickt wird. */
function ladeImBrowser(link: AbzugLink): void {
    const anker = document.createElement("a");
    anker.href = link.url;
    anker.download = link.dateiname;
    anker.rel = "noopener";
    anker.style.display = "none";
    document.body.append(anker);
    anker.click();
    anker.remove();
}

export function createAbzug(deps: AbzugDeps = {}): Abzug {
    const sicht = ref<AbzugSicht | null>(null);
    const verfuegbar = ref(true);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const frage = ref<AbzugFrage | null>(null);
    const busy = ref(false);
    const hochladen = ref(false);
    const geholtVon = ref<AbzugQuelle | null>(null);
    const ladeKennung = ref<string | null>(null);
    const tage = ref<SchluesselTage>(SCHLUESSEL_TAGE_VORGABE);
    const neuerSchluessel = ref<AbzugSchluesselNeu | null>(null);
    const widerrufId = ref<string | null>(null);
    const schluesselBusy = ref(false);
    const letzteQuelle = ref<AbzugQuelle | null>(null);
    const ergebnis = ref<ActionResult | null>(null);
    const ask = deps.ask ?? requestConfirmation;
    const reads = deps.reads ?? createReadConfirmation(ask);
    reads.onOffer(() => (unconfirmed.value === null ? undefined : load()));
    const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
    const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const starteDownload = deps.starteDownload ?? ladeImBrowser;
    let ticket = 0;
    let following = false;
    let timer: unknown = undefined;

    function planen(): void {
        if (timer !== undefined) clearTimer(timer);
        timer = undefined;
        if (!following || unconfirmed.value !== null || !beschaeftigt(sicht.value)) return;
        timer = setTimer(() => {
            timer = undefined;
            void load();
        }, NACHSEHEN_MS);
    }

    async function load(): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const body = await withConfirmation(() => getJson<AbzugSicht>(ABZUG_URL, deps.fetcher), reads.ask);
            if (mine !== ticket) return;
            sicht.value = body;
            verfuegbar.value = true;
            loadProblems.value = [];
            unconfirmed.value = null;
        } catch (error) {
            if (mine === ticket) {
                if (error instanceof ApiFailure && error.status === 404) {
                    verfuegbar.value = false;
                    sicht.value = null;
                    loadProblems.value = [];
                    unconfirmed.value = null;
                } else {
                    loadProblems.value = formProblems(error);
                    unconfirmed.value = neededConfirmation(error);
                }
            }
        } finally {
            if (mine === ticket) {
                loading.value = false;
                planen();
            }
        }
    }

    /** Das Ergebnis einer Handlung aus ihrem Fehler: eine abgebrochene Bestätigung bekommt ihren eigenen Satz. */
    function fehlerErgebnis(error: unknown): ActionResult {
        const failure = error instanceof ApiFailure ? error : undefined;
        return failure?.code === "reauth_required" || failure?.code === "assurance_required"
            ? { ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] }
            : { ok: false, problems: formProblems(error) };
    }

    async function confirm(): Promise<ActionResult> {
        const was = frage.value;
        if (was === null || busy.value) return { ok: false, problems: [] };
        const aktuell = sicht.value;
        busy.value = true;
        ergebnis.value = null;
        let result: ActionResult;
        try {
            if (was === "schluessel") {
                neuerSchluessel.value = await withConfirmation(
                    () =>
                        postJson<AbzugSchluesselNeu>(
                            `${ABZUG_URL}/schluessel`,
                            { operationId: newOperationId(), tage: tage.value },
                            deps.fetcher,
                        ),
                    ask,
                );
            } else if (was.startsWith("holen:")) {
                const quelle = was.slice("holen:".length) as AbzugQuelle;
                await withConfirmation(
                    () =>
                        postJson<OperationReceipt>(
                            `${ABZUG_URL}/holen`,
                            { operationId: newOperationId(), quelle },
                            deps.fetcher,
                        ),
                    ask,
                );
                geholtVon.value = quelle;
            } else if (was === "erstellen") {
                await withConfirmation(
                    () =>
                        postJson<OperationReceipt>(
                            `${ABZUG_URL}/erstellen`,
                            { operationId: newOperationId() },
                            deps.fetcher,
                        ),
                    ask,
                );
            } else {
                const kennung = istEinspielen(aktuell) ? (aktuell.eingang?.kennung ?? "") : "";
                await withConfirmation(
                    () =>
                        postJson<OperationReceipt>(
                            `${ABZUG_URL}/einspielen`,
                            { operationId: newOperationId(), kennung },
                            deps.fetcher,
                        ),
                    ask,
                );
                geholtVon.value = null;
            }
            result = { ok: true, problems: [] };
        } catch (error) {
            result = fehlerErgebnis(error);
        }
        frage.value = null;
        if (!result.ok) ergebnis.value = result;
        busy.value = false;
        await load();
        return result;
    }

    async function herunterladen(kennung: string): Promise<ActionResult> {
        if (ladeKennung.value !== null) return { ok: false, problems: [] };
        ladeKennung.value = kennung;
        letzteQuelle.value = null;
        ergebnis.value = null;
        let result: ActionResult;
        try {
            const link = await withConfirmation(
                () =>
                    postJson<AbzugLink>(`${ABZUG_URL}/link`, { operationId: newOperationId(), kennung }, deps.fetcher),
                ask,
            );
            starteDownload(link);
            result = { ok: true, problems: [] };
        } catch (error) {
            result = fehlerErgebnis(error);
            ergebnis.value = result;
        }
        ladeKennung.value = null;
        return result;
    }

    async function widerrufen(id: string): Promise<ActionResult> {
        if (widerrufId.value !== null) return { ok: false, problems: [] };
        widerrufId.value = id;
        ergebnis.value = null;
        let result: ActionResult;
        try {
            await withConfirmation(
                () =>
                    postJson<OperationReceipt>(
                        `${ABZUG_URL}/schluessel/widerrufen`,
                        { operationId: newOperationId(), id },
                        deps.fetcher,
                    ),
                ask,
            );
            result = { ok: true, problems: [] };
        } catch (error) {
            result = fehlerErgebnis(error);
            ergebnis.value = result;
        }
        widerrufId.value = null;
        await load();
        return result;
    }

    async function setzeSchluessel(quelle: AbzugQuelle, wert: string | null): Promise<ActionResult> {
        if (schluesselBusy.value) return { ok: false, problems: [] };
        // Was keine Form hat, geht nicht erst zum Server (und steht nirgends außer im Feld).
        if (wert !== null && !istAbzugSchluessel(wert.trim())) {
            const result: ActionResult = { ok: false, problems: [SCHLUESSEL_FORM] };
            letzteQuelle.value = quelle;
            ergebnis.value = result;
            return result;
        }
        schluesselBusy.value = true;
        letzteQuelle.value = quelle;
        ergebnis.value = null;
        let result: ActionResult;
        try {
            await withConfirmation(
                () =>
                    postJson<OperationReceipt>(
                        `${ABZUG_URL}/quelle`,
                        { operationId: newOperationId(), quelle, schluessel: wert === null ? null : wert.trim() },
                        deps.fetcher,
                    ),
                ask,
            );
            result = { ok: true, problems: [] };
        } catch (error) {
            result = fehlerErgebnis(error);
            ergebnis.value = result;
        }
        schluesselBusy.value = false;
        await load();
        return result;
    }

    async function waehleDatei(datei: File): Promise<ActionResult> {
        if (hochladen.value) return { ok: false, problems: [] };
        hochladen.value = true;
        geholtVon.value = null;
        letzteQuelle.value = null;
        ergebnis.value = null;
        let result: ActionResult;
        try {
            const adresse = `${ABZUG_URL}/eingang?name=${encodeURIComponent(datei.name)}&operationId=${newOperationId()}`;
            await withConfirmation(() => putDatei(adresse, datei, "application/x-tar", deps.fetcher), ask);
            result = { ok: true, problems: [] };
        } catch (error) {
            result = fehlerErgebnis(error);
            ergebnis.value = result;
        }
        hochladen.value = false;
        await load();
        return result;
    }

    return {
        sicht,
        verfuegbar,
        loading,
        loadProblems,
        unconfirmed,
        confirmAgain: () => reads.offer(),
        frage,
        busy,
        hochladen,
        geholtVon,
        ladeKennung,
        tage,
        neuerSchluessel,
        widerrufId,
        schluesselBusy,
        letzteQuelle,
        ergebnis,
        load,
        ask(was): void {
            frage.value = was;
            letzteQuelle.value = was.startsWith("holen:") ? (was.slice("holen:".length) as AbzugQuelle) : null;
            ergebnis.value = null;
        },
        cancel(): void {
            frage.value = null;
        },
        confirm,
        herunterladen,
        waehleDatei,
        waehleTage(wert): void {
            tage.value = wert;
        },
        schluesselGesehen(): void {
            neuerSchluessel.value = null;
        },
        widerrufen,
        setzeSchluessel,
        follow(on): void {
            following = on;
            planen();
        },
    };
}
