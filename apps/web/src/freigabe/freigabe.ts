import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import {
    FREIGABE_URL,
    opsId,
    phasenFuer,
    type FreigabeDatei,
    type FreigabeFortschritt,
    type FreigabePhase,
    type FreigabeRueckweg,
    type FreigabeSicht,
    type FreigabeSperre,
    type FreigabeThema,
    type OperationReceipt,
    UMGEBUNGEN_URL,
    releaseStand,
    type UmgebungenStand,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import {
    createReadConfirmation,
    requestConfirmation,
    withConfirmation,
    type ReadConfirmation,
} from "../auth/bestaetigen";
import { formProblems, type Phrase } from "../auth/formular";

/**
 * Der Eintrag „Umgebungen“ der Systemsteuerung (WI-0204; vorher „Production“, FREIGABE-0001 Stufe 1, Betreiber 2026-10-13: „alles wie
 * empfohlen, ja“). Was die Oberfläche rechnet; wie sie aussieht, steht in `verwaltung-umgebungen.vue`.
 *
 * - **Stufe 1 hat keine Haken.** Die Liste sagt, was mit dem nächsten Mal rausgeht; ein Knopf schiebt den geprüften Stage-Stand.
 * - 🔴 **Der Knopf nennt den Stand, den er gesehen hat.** Hat sich die Stage seitdem bewegt, lehnt der Server ab — lieber ein Satz als
 *   ein anderer Stand als der, der dastand.
 * - Beide Wege fragen den Passkey (Stufe S); die Oberfläche fragt vorher nichts weiter: Der Satz unter dem Knopf sagt, was passiert.
 */

/**
 * Der Satz, der erklärt, warum gerade nichts geht. Eine Stelle für Oberfläche und Tests.
 *
 * 🔴 „Ungeprüft“ nennt, was wirklich fehlt (Hauptorchestrierung 2026-10-19; der Betreiber stolperte über „Claudios Lauf schreibt das
 * Ergebnis“, als der Sammellauf fehlte). `ops/production/freigabe-stand.sh` schreibt `stagePruefung` nur mit grünen Proben, und dann
 * „…; Sammellauf steht aus“, solange die Notiz fehlt. Ohne Prüftext fehlen also die Proben. Den Stand der Viertel kennt der Leser nicht.
 * Seit WI-0248 öffnet im Nachtmodus schon `probenGruen` den Knopf (`sperreVon`); dieser Satz erscheint dann nur noch, wo die Proben (noch)
 * nicht als grün gemeldet sind, und nennt den fehlenden vollständigen Release-Nachweis.
 */
export function sperrSchluessel(sperre: FreigabeSperre | null, datei: FreigabeDatei | null = null): string | null {
    if (sperre === null) return null;
    if (sperre === "stage_ungeprueft" && datei !== null) {
        const pruefung = datei.stagePruefung ?? "";
        if (pruefung === "") return "admin.production.blocked.proben_aus";
        if (/Sammellauf steht aus/u.test(pruefung)) return "admin.production.blocked.sammellauf_aus";
    }
    return `admin.production.blocked.${sperre}`;
}

/** Die Zahl an der Schiene: wie viele Themen warten; läuft ein Lauf, der halbe Kreis. Keine, kein Wert. */
export function schienenWert(sicht: FreigabeSicht | null): string | undefined {
    if (laeuftGerade(sichtbarerLauf(sicht ?? null, null))) return "◐";
    const zahl = sicht?.datei?.themen.length ?? 0;
    return zahl > 0 ? String(zahl) : undefined;
}

// --- Zeiten in der Ansicht (WI-0204) ------------------------------------------------------------------------------

/** Eine Dauer als m:ss, ab einer Stunde als h:mm:ss. */
export function dauerText(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const zwei = (n: number): string => String(n).padStart(2, "0");
    if (s >= 3600) return `${String(Math.floor(s / 3600))}:${zwei(Math.floor((s % 3600) / 60))}:${zwei(s % 60)}`;
    return `${String(Math.floor(s / 60))}:${zwei(s % 60)}`;
}

/** Tag, Monat und Uhrzeit in der Sprache der Seite; ohne Zeitpunkt ein Strich. */
export function zeitpunkt(iso: string | null, sprache: string): string {
    return iso === null
        ? "–"
        : new Date(iso).toLocaleString(sprache, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Nur die Uhrzeit; ohne Zeitpunkt leer. */
export function uhrzeit(iso: string | null, sprache: string): string {
    return iso === null ? "" : new Date(iso).toLocaleTimeString(sprache, { hour: "2-digit", minute: "2-digit" });
}

/** Die Uhrzeit mit Sekunden (ms seit 1970), für „Nicht ausgeführt (22:41:05)“: Zwei Versuche in derselben Minute sollen sich unterscheiden. */
export function uhrzeitGenau(ms: number | null, sprache: string): string {
    return ms === null
        ? ""
        : new Date(ms).toLocaleTimeString(sprache, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Was ein Druck in der Ansicht „Umgebungen“ gerade tut, bis der Server antwortet. */
export type FreigabeVersuch = "release" | "rollback" | "abbrechen";

// --- Die Stationen: was in Stage und Production läuft (WI-0204 Stufe 2) -------------------------------------------

/** Was eine Station zeigt. Jeder Wert kann fehlen; dann steht ein Strich, nichts wird erfunden. */
export interface StationStand {
    /** Der kurze Stand (Commit). */
    stand: string | null;
    /** Die volle Release-Kennung. */
    release: string | null;
    /** Seit wann er läuft (aus Claudios Statusdatei, nur wenn sie denselben Stand nennt). */
    seit: string | null;
    /** Wann das Release geschnitten wurde (aus der Kennung); steht da, wenn `seit` fehlt. */
    gebaut: string | null;
    /** Antwortet die Umgebung? `null`: nicht bekannt. */
    erreichbar: boolean | null;
}

/**
 * Stage und Production für die Stationen (Absprache mit WI-0180 §9: EIN Weg für den Stand je Umgebung). Den laufenden Stand liefert
 * `GET /api/admin/system/umgebungen` (eigene Umgebung und Gegenseite, live); die Statusdatei der Freigabe ergänzt, seit wann er läuft,
 * und springt ein, wo die Route fehlt (ohne `switch_environment`). Auf Production gibt es keine Statusdatei: Dort tragen die
 * Stationen allein die Route.
 */
export function stationen(
    sicht: FreigabeSicht | null,
    umgebungen: UmgebungenStand | null,
    umgebung: string | null,
): { stage: StationStand; production: StationStand } {
    const datei = sicht?.datei ?? null;
    const ausRoute = (ziel: "staging" | "production"): { releaseId: string | null; erreichbar: boolean } | null => {
        if (umgebungen === null || (umgebung !== "staging" && umgebung !== "production")) return null;
        if (umgebung === ziel) return { releaseId: umgebungen.eigene.releaseId, erreichbar: true };
        return umgebungen.gegenseite;
    };
    const station = (ziel: "staging" | "production", ausDatei: FreigabeDatei["stage"] | null): StationStand => {
        const live = ausRoute(ziel);
        const release = live?.releaseId ?? ausDatei?.release ?? null;
        const geschnitten = releaseStand(release);
        const dateiPasst = ausDatei !== null && release !== null && gleicherStand(release, ausDatei);
        return {
            stand: geschnitten?.commit ?? (release === null ? null : kurzStand(release)),
            release,
            seit: dateiPasst ? ausDatei.seit : null,
            gebaut: geschnitten?.zeit.toISOString() ?? null,
            erreichbar: live?.erreichbar ?? null,
        };
    };
    return {
        stage: station("staging", datei?.stage ?? null),
        production: station("production", datei?.production ?? null),
    };
}

/** Das Ergebnis der Probe ins Tailnet aus diesem Browser (`auth/lokal-probe.ts`), mit der gemessenen Zeit. */
export interface LokalProbe {
    zustand: "ungeprueft" | "laeuft" | "ok" | "nein";
    ms: number | null;
}

// --- Die Gleise: wo jedes Release steht (WI-0204) -----------------------------------------------------------------

/** Der Stand einer Umgebung in einer Zeile der Gleise. `zurueck`: war draußen und wurde zurückgenommen; `rueckweg`: die Zeile ist ein Rückweg. */
export type GleisStand = "voll" | "halb" | "leer" | "zurueck" | "rueckweg" | "keiner";

export interface Gleis {
    schluessel: string;
    art: "wartet" | "release" | "rollback";
    /** Der Stand kurz (Commit), so wie ihn die Stationen zeigen. */
    stand: string;
    /** Wann: für eine Freigabe oder einen Rückweg der Auftrag, für den wartenden Stand seit wann er auf der Stage läuft. */
    at: string | null;
    ops: string | null;
    wer: string | null;
    stage: GleisStand;
    production: GleisStand;
    aktuell: { stage: boolean; production: boolean };
    /** Wann dieser Stand zurückgenommen wurde, sonst `null`. */
    zurueckAm: string | null;
}

/** Der kurze Stand: aus `20261016T181003Z-4850978` wird `4850978`; was keinen Strich trägt, bleibt. */
export function kurzStand(release: string): string {
    const stelle = release.lastIndexOf("-");
    return stelle >= 0 ? release.slice(stelle + 1) : release;
}

/** Nennt die Release-Kennung denselben Stand wie dieser Stand der Statusdatei? Verglichen wird über den Commit. */
export function gleicherStand(release: string, stand: { release: string; commit: string }): boolean {
    const kurz = kurzStand(release);
    return (
        release === stand.release ||
        (kurz.length >= 7 && stand.commit.startsWith(kurz)) ||
        kurzStand(stand.release) === kurz
    );
}

/**
 * Die Zeilen der Gleise, jüngste zuerst (WI-0204; der Betreiber wählte „Gleise je Release“): der wartende Stand der Stage, dann jede
 * Freigabe und jeder Rückweg. Eine Freigabe, die ein späterer Rückweg zurückgenommen hat, trägt `zurueck` (ein Stapel von alt nach
 * neu: Jeder Rückweg nimmt die jüngste noch stehende Freigabe zurück).
 *
 * 🔴 Die Zwischenstände der Stage (jeder Push) stehen nicht einzeln da: Sichtbar ist, was rausging, und was gerade wartet.
 */
export function gleise(sicht: FreigabeSicht | null): Gleis[] {
    const datei = sicht?.datei ?? null;
    const frueher = sicht?.frueher ?? [];
    const zurueckAm = new Map<number, string>();
    const stapel: number[] = [];
    for (let stelle = frueher.length - 1; stelle >= 0; stelle--) {
        const lauf = frueher[stelle];
        if (lauf?.art === "release") stapel.push(stelle);
        else if (lauf?.art === "rollback") {
            const genommen = stapel.pop();
            if (genommen !== undefined) zurueckAm.set(genommen, lauf.at);
        }
    }
    const zeilen: Gleis[] = [];
    const laufend = sichtbarerLauf(sicht, null);
    const laeuftFreigabe = laufend?.art === "release" && laeuftGerade(laufend);
    if (datei !== null && datei.stage.commit !== datei.production.commit) {
        zeilen.push({
            schluessel: `wartet-${datei.stage.commit}`,
            art: "wartet",
            stand: kurzStand(datei.stage.release),
            at: datei.stage.seit,
            ops: laeuftFreigabe ? (sicht?.laeuft?.ops ?? null) : null,
            wer: null,
            stage: "voll",
            production: laeuftFreigabe ? "halb" : "leer",
            aktuell: { stage: true, production: false },
            zurueckAm: null,
        });
    }
    let productionGefunden = false;
    frueher.forEach((lauf, stelle) => {
        const rueckweg = lauf.art === "rollback";
        const zurueck = zurueckAm.get(stelle) ?? null;
        const istProduction =
            !productionGefunden &&
            !rueckweg &&
            zurueck === null &&
            datei !== null &&
            gleicherStand(lauf.release, datei.production);
        if (istProduction) productionGefunden = true;
        zeilen.push({
            schluessel: `${lauf.art}-${lauf.ops ?? lauf.at}`,
            art: lauf.art,
            stand: kurzStand(lauf.release),
            at: lauf.at,
            ops: lauf.ops,
            wer: lauf.wer,
            stage: rueckweg ? "keiner" : "voll",
            production: rueckweg ? "rueckweg" : zurueck !== null ? "zurueck" : "voll",
            aktuell: {
                stage: zeilen.length === 0 && !rueckweg && datei !== null && gleicherStand(lauf.release, datei.stage),
                production: istProduction,
            },
            zurueckAm: zurueck,
        });
    });
    return zeilen;
}

// --- Die Schritte eines Laufs (WI-0204) ---------------------------------------------------------------------------

export type SchrittZustand = "fertig" | "jetzt" | "offen" | "fehler" | "unbekannt";

export interface Schritt {
    /** `auftrag`, eine Phase aus `FREIGABE_PHASEN` oder das Ende (`live` beziehungsweise `fertig`). */
    id: string;
    zustand: SchrittZustand;
    /** Wie lange der Schritt lief, wenn er fertig ist und eine Dauer gemeldet wurde. */
    ms: number | null;
    /** Seit wann er läuft, wenn er gerade läuft und das ableitbar ist. */
    seit: string | null;
}

export interface Lauf {
    ops: string;
    art: "release" | "rollback";
    /** Seit wann der Vorgang besteht (der Auftrag). */
    seit: string;
    /** `true`: der Vorgang ist noch offen. */
    offen: boolean;
    fortschritt: FreigabeFortschritt | null;
}

/**
 * Läuft der Lauf gerade? Der Vorgang ist offen, und der Abholer hat ihn noch nicht beendet. 🪤 Ein Vorgang bleibt offen, auch wenn
 * der Lauf rot endete (abschließen tun ihn Claudio oder die Betreiber); dann läuft nichts mehr, und die Ansicht zeigt das Ergebnis.
 */
export function laeuftGerade(lauf: Lauf | null): boolean {
    return lauf !== null && lauf.offen && (lauf.fortschritt === null || lauf.fortschritt.zustand === "laeuft");
}

/**
 * Die Stationen eines Laufs, wie die Oberfläche sie zeigt (der Betreiber wählte „Nur Stationen“): der Auftrag, die Phasen, die
 * Claudios Abholer meldet, und das Ende.
 *
 * 🔴 Nichts wird erfunden. Hat der Abholer (noch) nichts gemeldet, steht nach dem Auftrag „Abgeholt“ als laufend, solange der Vorgang
 * offen ist; nach dem Ende ohne Meldung stehen die Schritte dazwischen als `unbekannt`.
 */
export function schritte(lauf: Lauf): Schritt[] {
    const f = lauf.fortschritt;
    const reihe = phasenFuer(lauf.art).filter(
        (phase) => phase !== "zurueck" || lauf.art === "rollback" || erreicht(f, "zurueck"),
    );
    const ende = lauf.art === "rollback" ? "fertig" : "live";
    const auftrag: Schritt = { id: "auftrag", zustand: "fertig", ms: null, seit: lauf.seit };
    if (f === null) {
        const mitte = reihe.map((phase, stelle): Schritt => {
            if (!lauf.offen) return { id: phase, zustand: "unbekannt", ms: null, seit: null };
            return {
                id: phase,
                zustand: stelle === 0 ? "jetzt" : "offen",
                ms: null,
                seit: stelle === 0 ? lauf.seit : null,
            };
        });
        return [auftrag, ...mitte, { id: ende, zustand: lauf.offen ? "offen" : "unbekannt", ms: null, seit: null }];
    }
    // Bei einer Freigabe heißt ein erreichter Rückweg: Die Proben davor waren rot. Endet der Lauf mit `proben_rot`, ist der
    // Rückweg selbst gelungen (der Abholer meldet ihn als Grund, nicht als zweiten Fehler).
    const probenRot = lauf.art === "release" && erreicht(f, "zurueck");
    const mitte = reihe.map((phase): Schritt => {
        const fertig = f.fertig.find((eintrag) => eintrag.phase === phase);
        if (phase === "proben" && probenRot)
            return { id: phase, zustand: "fehler", ms: fertig?.ms ?? null, seit: null };
        if (phase === "zurueck" && probenRot && f.zustand === "rot" && f.fehlerCode === "proben_rot") {
            return { id: phase, zustand: "fertig", ms: fertig?.ms ?? null, seit: null };
        }
        if (fertig !== undefined && !(f.zustand === "rot" && f.phase === phase)) {
            return { id: phase, zustand: "fertig", ms: fertig.ms, seit: null };
        }
        if (f.phase === phase) {
            if (f.zustand === "laeuft") return { id: phase, zustand: "jetzt", ms: null, seit: f.phaseSeit };
            if (f.zustand === "rot") return { id: phase, zustand: "fehler", ms: fertig?.ms ?? null, seit: null };
        }
        return { id: phase, zustand: "offen", ms: null, seit: null };
    });
    const endZustand: SchrittZustand = f.zustand === "gruen" ? "fertig" : f.zustand === "rot" ? "fehler" : "offen";
    return [auftrag, ...mitte, { id: ende, zustand: endZustand, ms: null, seit: f.ende }];
}

function erreicht(f: FreigabeFortschritt | null, phase: FreigabePhase): boolean {
    return f !== null && (f.phase === phase || f.fertig.some((eintrag) => eintrag.phase === phase));
}

/**
 * Welcher Lauf in der Ansicht steht: der offene, sonst der jüngste frühere, solange sein Ende nicht länger als eine Stunde her ist und
 * er nicht ausgeblendet wurde. Ein früherer ohne Meldung des Abholers steht nicht da: Von ihm gibt es nichts zu zeigen.
 */
export function sichtbarerLauf(sicht: FreigabeSicht | null, ausgeblendet: string | null): Lauf | null {
    const laeuft = sicht?.laeuft ?? null;
    if (laeuft !== null) {
        return {
            ops: laeuft.ops,
            art: laeuft.art,
            seit: laeuft.seit,
            offen: true,
            fortschritt: laeuft.fortschritt ?? null,
        };
    }
    const juengster = sicht?.frueher[0];
    const f = juengster?.fortschritt ?? null;
    if (juengster === undefined || juengster.ops === null || f === null || f.ende === null) return null;
    if (juengster.ops === ausgeblendet) return null;
    const alter = Date.parse(sicht?.now ?? "") - Date.parse(f.ende);
    if (!Number.isFinite(alter) || alter > 60 * 60 * 1000) return null;
    return { ops: juengster.ops, art: juengster.art, seit: juengster.at, offen: false, fortschritt: f };
}

/** Der Kurzname eines Themas; die Grundlage trägt ihren Namen aus der Sprachtafel, nicht aus den Daten. */
export function themaName(thema: FreigabeThema, grundlage: string): string {
    return thema.id === "grundlage" ? grundlage : (thema.name ?? thema.id);
}

/**
 * Der letzte Rückweg von Production, oder `null` (WI-0144 §3; Betreiber 2026-10-14: „ich muss auf der stage im reiter
 * "Production" sehen, dass ein Feature-Release zurückgefahren wurde“).
 *
 * 🔴 Eine ältere Statusdatei kennt das Feld nicht — das ist kein Fehler, dann steht hier nichts. `wer` bleibt `null`, wenn der
 * Vorgang die Person nicht nennt; den Satz dafür hat die Sprachtafel, nicht diese Stelle.
 */
export function letzterRueckweg(sicht: FreigabeSicht | null): FreigabeRueckweg | null {
    return sicht?.datei?.letzterRueckweg ?? null;
}

/** Was mit einer Freigabe mitging: die Liste, wie sie beim Start dastand. Nach dem Ende ist sie aus der Statusdatei verschwunden. */
export interface ImLauf {
    ops: string;
    themen: readonly FreigabeThema[];
    technik: FreigabeDatei["technik"] | null;
}

export interface Freigabe {
    sicht: ShallowRef<FreigabeSicht | null>;
    fehler: Ref<boolean>;
    busy: Ref<boolean>;
    problems: Ref<Phrase[]>;
    /**
     * 🔴 Der Druck, der gerade unterwegs ist (Vali 2026-10-25: „nicht klar, ob ich den button gedrückt habe“): vom Klick über den Passkey bis
     * zur frisch geladenen Sicht. Solange steht „Gebe für Production frei …“ und nichts vom Vorgang davor.
     */
    versuch: Ref<FreigabeVersuch | null>;
    /** Wann der letzte Druck abgewiesen wurde (ms seit 1970); `null`: der letzte ging durch. */
    abgewiesenAm: Ref<number | null>;
    sperre: ComputedRef<FreigabeSperre | null>;
    /** Die laufende Freigabe als lesbare OPS-Nummer, oder `null`. */
    laufendeOps: ComputedRef<string | null>;
    /** Wann zuletzt gelesen wurde (ms seit 1970), für „Stand vor …“; `null`: noch nie. */
    geladenAm: Ref<number | null>;
    /** Die Themen einer Freigabe, gemerkt beim Start, damit sie nach dem Ende als „in Production“ stehen bleiben. */
    imLauf: ShallowRef<ImLauf | null>;
    /** Der Lauf, der in der Ansicht steht (offen oder eben zu Ende), oder `null`. */
    lauf: ComputedRef<Lauf | null>;
    /** Der Stand je Umgebung aus `GET /api/admin/system/umgebungen` (WI-0180), nur mit `switch_environment`; sonst `null`. */
    umgebungen: ShallowRef<UmgebungenStand | null>;
    laden: () => Promise<void>;
    nachProduction: () => Promise<boolean>;
    zurueck: () => Promise<boolean>;
    /** Den beendeten Lauf aus der Ansicht nehmen. */
    ausblenden: () => void;
    /** Die offene Nacht-Freigabe (WI-0234), oder `null`. */
    nacht: ComputedRef<NonNullable<FreigabeSicht["freigabe"]> | null>;
    /** Die offene Nacht-Freigabe abbrechen: jeder aktive Betreiber, ohne Passkey (die sichere Richtung). */
    abbrechen: () => Promise<boolean>;
}

export interface FreigabeDeps {
    fetcher?: Fetcher;
    reads?: ReadConfirmation;
    /** Die Uhr; Tests setzen eine feste. */
    jetzt?: () => number;
    /** Den Stand je Umgebung mitlesen (`switch_environment`, nur Betreiber); ohne das Recht antwortete die Route 403. */
    mitUmgebungen?: boolean;
}

export function createFreigabe(deps: FreigabeDeps = {}): Freigabe {
    const sicht = shallowRef<FreigabeSicht | null>(null);
    const fehler = ref(false);
    const busy = ref(false);
    const problems = ref<Phrase[]>([]);
    const versuch = ref<FreigabeVersuch | null>(null);
    const abgewiesenAm = ref<number | null>(null);
    const geladenAm = ref<number | null>(null);
    const imLauf = shallowRef<ImLauf | null>(null);
    const ausgeblendet = ref<string | null>(null);
    const reads = deps.reads ?? createReadConfirmation(requestConfirmation);
    const jetzt = deps.jetzt ?? Date.now;

    const umgebungen = shallowRef<UmgebungenStand | null>(null);

    /**
     * Eine Antwort, mit der die Ansicht rechnen kann. Alles andere zählt wie ein Lesefehler: Ein unerwartet geformter Stand
     * (etwa eine Quittung statt der Sicht) hat sonst beim Zeichnen das ganze Fenster der Systemsteuerung lahmgelegt (Befund der
     * Review-Sitzung 2026-10-17, `frueher` fehlte).
     */
    const istSicht = (wert: unknown): wert is FreigabeSicht =>
        typeof wert === "object" && wert !== null && Array.isArray((wert as { frueher?: unknown }).frueher);
    const istStand = (wert: unknown): wert is UmgebungenStand =>
        typeof wert === "object" && wert !== null && typeof (wert as { eigene?: unknown }).eigene === "object";

    async function laden(): Promise<void> {
        // Beides zugleich; der Stand je Umgebung ist eine Zugabe: Scheitert er, bleibt die Freigabe lesbar.
        const [freigabe] = await Promise.allSettled([
            withConfirmation(() => getJson<FreigabeSicht>(FREIGABE_URL, deps.fetcher), reads.ask),
            deps.mitUmgebungen === true
                ? getJson<UmgebungenStand>(UMGEBUNGEN_URL, deps.fetcher).then(
                      (stand) => (umgebungen.value = istStand(stand) ? stand : null),
                      () => undefined,
                  )
                : Promise.resolve(),
        ]);
        if (freigabe.status === "fulfilled" && istSicht(freigabe.value)) {
            merken(freigabe.value);
            sicht.value = freigabe.value;
            geladenAm.value = jetzt();
            fehler.value = false;
        } else {
            fehler.value = true;
        }
    }

    /**
     * Beim Start einer Freigabe die Liste merken: Nach dem Ende schreibt Claudio die Statusdatei neu, und die Liste ist leer. Gemerkt
     * wird nur im offenen Fenster; wer es während des Laufs schließt, sieht danach die neue Lage.
     */
    function merken(neu: FreigabeSicht): void {
        const laeuft = neu.laeuft;
        if (laeuft?.art === "release" && imLauf.value?.ops !== laeuft.ops) {
            imLauf.value = { ops: laeuft.ops, themen: neu.datei?.themen ?? [], technik: neu.datei?.technik ?? null };
        } else if (laeuft === null && imLauf.value !== null && neu.frueher[0]?.ops !== imLauf.value.ops) {
            imLauf.value = null;
        }
    }

    async function schiebe(weg: "release" | "rollback"): Promise<boolean> {
        if (busy.value) return false;
        busy.value = true;
        problems.value = [];
        versuch.value = weg;
        abgewiesenAm.value = null;
        let ok = false;
        try {
            const commit = sicht.value?.datei?.stage.commit;
            await withConfirmation(
                () =>
                    postJson<OperationReceipt>(
                        `${FREIGABE_URL}/${weg}`,
                        {
                            operationId: newOperationId(),
                            // Der Rückweg kennt keinen Stand: Er betrifft Production, nicht die Stage.
                            ...(weg === "release" && commit !== undefined ? { commit } : {}),
                        },
                        deps.fetcher,
                    ),
                requestConfirmation,
            );
            ok = true;
        } catch (error) {
            problems.value = formProblems(error);
        } finally {
            busy.value = false;
        }
        await laden();
        beende(ok);
        return ok;
    }

    /** Der Druck ist beantwortet und die Sicht frisch: Ab jetzt zeigt die Ansicht wieder, was der Server weiß, eine Abweisung mit ihrer Uhrzeit. */
    function beende(ok: boolean): void {
        abgewiesenAm.value = ok ? null : jetzt();
        versuch.value = null;
    }

    async function abbrechen(): Promise<boolean> {
        const ops = sicht.value?.freigabe?.ops;
        if (busy.value || ops === undefined) return false;
        busy.value = true;
        problems.value = [];
        versuch.value = "abbrechen";
        abgewiesenAm.value = null;
        let ok = false;
        try {
            await postJson<OperationReceipt>(
                `${FREIGABE_URL}/abbrechen`,
                { operationId: newOperationId(), ops },
                deps.fetcher,
            );
            ok = true;
        } catch (error) {
            problems.value = formProblems(error);
        } finally {
            busy.value = false;
        }
        await laden();
        beende(ok);
        return ok;
    }

    return {
        sicht,
        fehler,
        busy,
        problems,
        versuch,
        abgewiesenAm,
        sperre: computed(() => sicht.value?.sperre ?? null),
        laufendeOps: computed(() => {
            const roh = sicht.value?.laeuft?.ops ?? null;
            if (roh === null) return null;
            // Der Server schickt sie schon als „OPS-000142“; eine rohe Zahl formatiert diese Stelle.
            return /^\d+$/u.test(roh) ? opsId(Number(roh)) : roh;
        }),
        geladenAm,
        imLauf,
        lauf: computed(() => sichtbarerLauf(sicht.value, ausgeblendet.value)),
        umgebungen,
        laden,
        nachProduction: () => schiebe("release"),
        zurueck: () => schiebe("rollback"),
        ausblenden: () => {
            ausgeblendet.value = sichtbarerLauf(sicht.value, null)?.ops ?? null;
            imLauf.value = null;
        },
        nacht: computed(() => sicht.value?.freigabe ?? null),
        abbrechen,
    };
}
