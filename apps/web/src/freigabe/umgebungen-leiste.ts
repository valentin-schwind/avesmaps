import {
    releaseTestCommit,
    type FreigabeDatei,
    type FreigabeLauf,
    type FreigabeNachweis,
    type FreigabeSicht,
    type ReleaseTestSicht,
    type UmgebungLokal,
    type UmgebungenStand,
} from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";
import { kurzStand, stationen, type Lauf, type LokalProbe, type StationStand } from "./freigabe";

/**
 * Die Leiste oben in der Ansicht „Umgebungen“ (WI-0248; Vali: „siehst du das 3er stufen system bei umgebungen? je nachdem wo man ist, soll
 * die jeweilige umgebung markiert sein“): Lokal → Stage → Production, in jeder Umgebung dieselbe, mit drei gleich großen Stationen. Dieses
 * Modul rechnet, was darin steht; wie es aussieht, steht in `umgebungen-leiste.vue`, `umgebungen-station.vue` und
 * `verwaltung-umgebungen.vue`.
 *
 * 🔴 **Nichts wird erfunden.** Jede Umgebung kennt nur, was ihr Server weiß: Lokal den Kandidaten aus den Git-Notizen und den Release-Test,
 * die Stage die Statusdatei der Freigabe und den Stand der Gegenseite, Production nur ihren eigenen Stand und den der Stage. Was eine Umgebung
 * nicht weiß, steht als Strich oder als „nicht bekannt“, nie als geratener Wert. Die Erreichbarkeit der eigenen Umgebung ist die einzige, die
 * sich von selbst versteht: Die Seite wird von ihr ausgeliefert.
 */

export type LeistenUmgebung = "development" | "staging" | "production";

/** Die Umgebung der Sitzung, oder `null` (nicht angemeldet, unbekannt). */
export function leistenUmgebung(umgebung: string | null): LeistenUmgebung | null {
    return umgebung === "development" || umgebung === "staging" || umgebung === "production" ? umgebung : null;
}

/** Der Ton einer Zeile in einer Station; `leise` heißt: nichts bekannt. */
export type Ton = "gut" | "warn" | "rot" | "lauf" | "leise";

/** Eine Zeile mit Kreis in einer Station: ihr Text (Schlüssel), Ton und Füllung des Kreises. */
export interface Zustand {
    key: MessageKey;
    ton: Ton;
    fuellung: "voll" | "halb" | "leer";
    params?: Record<string, number | string>;
}

/** Ein Pfeil der Leiste: wie die Linie aussieht, was über ihr steht und was der Hinweis dazu sagt. */
export interface Verbinder {
    /** `gleich`: durchgezogen, `offen`: gestrichelt, `lauf`: fließend, `still`: Linie ohne Spitze. */
    art: "gleich" | "offen" | "lauf" | "still";
    text: string;
    titel: string;
}

/** Eine Zeile der Fakten unter dem Stand einer Station; Etikett und Wert stehen schon in der Sprache der Seite. */
export interface Fakt {
    label: string;
    wert: string;
    /** Der volle Wert als Hinweis, wenn die Zeile ihn kürzt. */
    titel?: string | undefined;
    /** Färbt den Wert wie die Zeile mit Kreis (etwa die Prüfung der Stage: grün, rot, offen). */
    ton?: Ton | undefined;
    /** Ein Satz unter dem Wert, in der Station auf wenige Zeilen gekürzt (mit dem vollen Satz als Hinweis). */
    zusatz?: string | undefined;
}

// --- Die Stände der drei Stationen ---------------------------------------------------------------------------------

export interface LeistenEingabe {
    umgebung: string | null;
    sicht: FreigabeSicht | null;
    umgebungen: UmgebungenStand | null;
    /** Der Release-Test; es gibt ihn nur lokal (WI-0248 L). */
    releaseTest: ReleaseTestSicht | null;
}

/**
 * Stage und Production für die Leiste. Auf Stage und Production wie bisher (`stationen`: Route und Statusdatei). Lokal weiß die Route nichts
 * von den anderen beiden (`gegenseite` ist dort `null`); die Git-Notizen des Entwicklungsrechners kennen den Stage-Stand, den Release-Test
 * liest (`kandidat.stage`). Production kennt Lokal gar nicht: Der Strich bleibt.
 *
 * Die eigene Umgebung antwortet immer; sie liefert die Seite aus.
 */
export function leistenStaende(eingabe: LeistenEingabe): { stage: StationStand; production: StationStand } {
    const umgebung = leistenUmgebung(eingabe.umgebung);
    const leer: StationStand = { stand: null, release: null, seit: null, gebaut: null, erreichbar: null };
    if (umgebung === "development") {
        const stage = eingabe.releaseTest?.kandidat?.stage ?? null;
        return {
            stage:
                stage === null
                    ? leer
                    : { ...leer, stand: stage.sha.slice(0, 7), release: stage.sha.slice(0, 7), seit: stage.zeit },
            production: leer,
        };
    }
    const staende = stationen(eingabe.sicht, eingabe.umgebungen, eingabe.umgebung);
    return {
        stage: umgebung === "staging" ? { ...staende.stage, erreichbar: true } : staende.stage,
        production: umgebung === "production" ? { ...staende.production, erreichbar: true } : staende.production,
    };
}

// --- Der Zustand einer Station -------------------------------------------------------------------------------------

/**
 * Die eigene Umgebung antwortet, ohne dass jemand fragt: Sie liefert gerade diese Seite aus (Vali: „die stage weiß selbst nicht ob sie
 * erreichbar ist“). Keine Zeit dabei, denn gemessen wurde nichts.
 */
const ERREICHBAR: Zustand = { key: "admin.umgebungen.erreichbar", ton: "gut", fuellung: "voll" };

/**
 * Die Zeile der Stage: ob sie antwortet, und nur das. Die eigene Station (`hier`) antwortet immer; für die Gegenseite sagt es die Route
 * (`erreichbar`), und weiß die Umgebung nichts, steht „nicht bekannt“. Wie es um die Prüfung des Stands steht, sagt `stagePruefungZustand`.
 */
export function stageZustand(stand: StationStand, hier: boolean): Zustand {
    if (hier) return ERREICHBAR;
    if (stand.erreichbar === false) return { key: "admin.umgebungen.antwortetNicht", ton: "rot", fuellung: "leer" };
    return stand.erreichbar === true
        ? { key: "admin.umgebungen.prod.laeuft", ton: "gut", fuellung: "voll" }
        : { key: "admin.umgebungen.unbekannt", ton: "leise", fuellung: "leer" };
}

/**
 * Die Prüfung des Stage-Stands aus der Statusdatei der Freigabe (Proben, Sammellauf, Release-Nachweis), als Wert der Zeile „Prüfung“ in der
 * Station. Früher stand sie als Zeile mit Kreis an der Stelle der Erreichbarkeit; „noch nicht geprüft“ las sich dort als Aussage über die
 * Erreichbarkeit der Stage. Ohne Statusdatei weiß die Umgebung nichts davon.
 */
export function stagePruefungZustand(datei: FreigabeDatei | null): Zustand | null {
    if (datei === null) return null;
    if (datei.stageGruen === true) return { key: "admin.umgebungen.stage.gruen", ton: "gut", fuellung: "voll" };
    // Ein roter Release-Nachweis (WI-0248) ist ebenfalls „geprüft und rot“, auch wenn `stageGruen` noch `null` steht.
    if (datei.stageGruen === false || datei.nachweis === "rot")
        return { key: "admin.umgebungen.stage.rot", ton: "rot", fuellung: "leer" };
    return { key: "admin.umgebungen.stage.ungeprueft", ton: "warn", fuellung: "leer" };
}

/**
 * Die Zeile von Production: ein laufender Vorgang (die Freigabe unterwegs, das Umschalten, der Rückweg), sonst ob Production antwortet
 * (die eigene Station `hier` immer).
 * 🔴 Ohne Statusdatei und ohne Antwort der Route weiß die Umgebung nicht, ob Production läuft; dann steht „nicht bekannt“, nicht „läuft“.
 */
export function productionZustand(
    stand: StationStand,
    lauf: Lauf | null,
    laeuft: boolean,
    datei: FreigabeDatei | null,
    hier = false,
): Zustand {
    const fortschritt = lauf?.fortschritt ?? null;
    if (lauf !== null && laeuft) {
        if (fortschritt?.phase === "umschalten" || fortschritt?.phase === "proben")
            return { key: "admin.umgebungen.prod.startet", ton: "lauf", fuellung: "halb" };
        if (fortschritt?.phase === "zurueck")
            return { key: "admin.umgebungen.prod.zurueck", ton: "lauf", fuellung: "halb" };
        if (lauf.art === "release") return { key: "admin.umgebungen.prod.unterwegs", ton: "gut", fuellung: "voll" };
    }
    if (lauf !== null && !laeuft && fortschritt?.zustand === "rot" && fortschritt.fehlerCode === "proben_rot") {
        return { key: "admin.umgebungen.prod.probenRot", ton: "rot", fuellung: "leer" };
    }
    if (hier) return ERREICHBAR;
    if (stand.erreichbar === false) return { key: "admin.umgebungen.antwortetNicht", ton: "rot", fuellung: "leer" };
    // Die Statusdatei kennt den Stand von Production; ohne sie und ohne Antwort der Route weiß die Umgebung nichts.
    if (datei === null && stand.erreichbar !== true)
        return { key: "admin.umgebungen.unbekannt", ton: "leise", fuellung: "leer" };
    return { key: "admin.umgebungen.prod.laeuft", ton: "gut", fuellung: "voll" };
}

/**
 * Die Zeile von Lokal: die Probe aus diesem Browser ins Tailnet (`auth/lokal-probe.ts`). Auf Lokal selbst ist die Antwort klar. Ohne Recht, die
 * Adresse zu sehen (`switch_environment`), ist nichts bekannt: Dann steht nicht „keine Adresse eingetragen“, denn das wäre geraten.
 * Die Zeit in ms steht nur, wenn die Probe sie gemessen hat.
 */
export function lokalZustand(
    hier: boolean,
    darfLokal: boolean,
    lokal: UmgebungLokal | null,
    probe: LokalProbe,
): Zustand | null {
    // 🔴 „erreichbar“, nicht „läuft“: Das Wort allein las sich wie der Zustand des Release-Tests darunter (WI-0248, Valis Eindruck nach dem Abbruch).
    if (hier) return ERREICHBAR;
    if (!darfLokal) return null;
    if (lokal === null) return { key: "admin.umgebungen.lokal.ohneAdresse", ton: "leise", fuellung: "leer" };
    if (probe.zustand === "laeuft") return { key: "admin.umgebungen.lokal.prueft", ton: "leise", fuellung: "halb" };
    if (probe.zustand === "ok") {
        if (probe.ms === null) return ERREICHBAR;
        return { key: "admin.umgebungen.lokal.erreichbar", ton: "gut", fuellung: "voll", params: { ms: probe.ms } };
    }
    if (probe.zustand === "nein") return { key: "admin.umgebungen.lokal.nicht", ton: "rot", fuellung: "leer" };
    return { key: "admin.umgebungen.lokal.ungeprueft", ton: "leise", fuellung: "leer" };
}

// --- Der Release-Test unter dem Pfeil von Lokal zur Stage ----------------------------------------------------------

export type NachweisZustand = FreigabeNachweis | "abgebrochen";

export interface Nachweis {
    /** Wie es um den Nachweis für den Stand steht; `null`: diese Umgebung weiß es nicht. */
    zustand: NachweisZustand | null;
    /** Der Stand, auf den sich der Nachweis bezieht (kurz), wenn er bekannt ist. */
    stand: string | null;
    /** Läuft er und kennt der Starter den Fortschritt: 0 bis 100. */
    prozent: number | null;
}

const UNBEKANNT: Nachweis = { zustand: null, stand: null, prozent: null };

/**
 * Der Zustand des Release-Nachweises für den Stage-Stand, so wie die Umgebung ihn kennt (WI-0248):
 *
 * - **Lokal** läuft der Test. Maßgeblich ist der Kandidat (seit WI-0248 der aktuelle Stage-Stand, `releaseTestCommit`): Läuft ein Test
 *   oder baut ein Start sein Paket, ist der Nachweis „läuft“; sonst zählt der jüngste Lauf, aber nur, wenn er zu diesem Stand gehört. Ein
 *   Lauf von gestern ist keine Antwort auf den Stand von heute: Dann „fehlt“ der Nachweis.
 * - **Stage** kennt ihn aus der Statusdatei der Freigabe (`nachweis`); eine ältere Datei kennt das Feld nicht, dann steht er nicht da.
 * - **Production** weiß nichts davon.
 */
export function nachweisVon(eingabe: LeistenEingabe): Nachweis {
    const umgebung = leistenUmgebung(eingabe.umgebung);
    if (umgebung === "development") return nachweisLokal(eingabe.releaseTest);
    const datei = eingabe.sicht?.datei ?? null;
    if (umgebung === "staging" && datei?.nachweis !== undefined) {
        return { zustand: datei.nachweis, stand: kurzStand(datei.stage.release), prozent: null };
    }
    return UNBEKANNT;
}

function nachweisLokal(sicht: ReleaseTestSicht | null): Nachweis {
    if (sicht === null || !sicht.verfuegbar) return UNBEKANNT;
    const commit = releaseTestCommit(sicht.kandidat);
    if (commit === null) return UNBEKANNT;
    const stand = commit.slice(0, 7);
    const lauf = sicht.lauf;
    if (lauf?.zustand === "laeuft" && lauf.sha === commit) {
        // Ein Lauf, dessen Prozess nicht mehr lebt, ist abgestürzt: kein Nachweis, und er läuft nicht.
        if (lauf.lebt === false) return { zustand: "abgebrochen", stand, prozent: null };
        return { zustand: "laeuft", stand, prozent: Math.round(lauf.fortschritt * 100) };
    }
    if (sicht.start?.zustand === "baut" && sicht.start.commit === commit)
        return { zustand: "laeuft", stand, prozent: null };
    // Ein Auftrag dieses Standes in der Warteschlange (WI-0248): Der Nachweis ist in Arbeit, auch solange er noch wartet; ein alter Lauf zählt nicht.
    if (sicht.auftrag?.commit === commit) return { zustand: "laeuft", stand, prozent: null };
    if (lauf !== null && lauf.sha === commit) {
        if (lauf.zustand === "gruen" || lauf.zustand === "rot" || lauf.zustand === "abgebrochen")
            return { zustand: lauf.zustand, stand, prozent: null };
    }
    return { zustand: "fehlt", stand, prozent: null };
}

/** Der Ton der Pille zu einem Nachweis. */
export function nachweisTon(zustand: NachweisZustand): "erfolg" | "gefahr" | "warnung" | "neutral" {
    switch (zustand) {
        case "gruen":
            return "erfolg";
        case "rot":
            return "gefahr";
        case "laeuft":
        case "abgebrochen":
            return "warnung";
        case "fehlt":
            return "neutral";
    }
}

// --- Production: was bisher ankam ----------------------------------------------------------------------------------

/**
 * Die früheren Auslieferungen, die diese Umgebung kennt: die Freigaben (nicht die Rückwege) aus dem Vorgangskanal, jüngste zuerst. Der Kanal
 * liegt auf der Stage; Production führt ihn nicht, dort ist die Liste leer, und die Ansicht sagt das, statt etwas zu erfinden.
 */
export function erhalteneReleases(sicht: FreigabeSicht | null): FreigabeLauf[] {
    return (sicht?.frueher ?? []).filter((lauf) => lauf.art === "release");
}
