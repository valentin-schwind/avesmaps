import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import {
    DISCORD_ADMIN_URL,
    DISCORD_KANAL_MUSTER,
    DISCORD_PROMPT_VORGABE,
    type DiscordStand,
    type DiscordVorschau,
    type DiscordZustellung,
    type OperationReceipt,
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
 * Der Reiter „Discord“ unter Systemsteuerung › Neuigkeiten (WI-0255): Betriebsstand, Einstellungen (Prompt, Uhrzeit, Berichtskanal), Vorschau, Routine an/aus,
 * Sendearchiv und Wiederholen.
 * Wie es aussieht, steht in `discord-verwaltung.vue`. 🔴 Ob gesendet wird, entscheidet der Server; der Reiter zeigt es nur.
 *
 * Der Kreis je Zustellung (Guide §13.17): ● zugestellt · ◐ unklar oder läuft (erst nachsehen) · ○ fehlgeschlagen (wartet auf euch).
 */

export type Kreis = "leer" | "halb" | "voll";

export function kreisVon(zustellung: Pick<DiscordZustellung, "status">): Kreis {
    if (zustellung.status === "zugestellt") return "voll";
    return zustellung.status === "fehlgeschlagen" ? "leer" : "halb";
}

/** Der Ton des Statuspunkts für den Betriebsstand: sendet, ist bewusst aus oder fehlt etwas. */
export function betriebsTon(stand: Pick<DiscordStand, "sperre" | "routine">): "erfolg" | "ruhe" | "warnung" {
    if (stand.sperre === "ohne_schluessel" || stand.sperre === "ohne_kanal") return "warnung";
    if (stand.sperre !== null || !stand.routine.aktiv) return "ruhe";
    return "erfolg";
}

/** Das Ergebnis eines Laufs (`discord_routine.letzter_lauf`): die Kennung vor dem Doppelpunkt, dahinter die Diagnose des Servers. */
export function laufTeile(ergebnis: string): { art: string; detail: string | null } {
    const stelle = ergebnis.indexOf(":");
    if (stelle < 0) return { art: ergebnis.trim(), detail: null };
    return { art: ergebnis.slice(0, stelle).trim(), detail: ergebnis.slice(stelle + 1).trim() || null };
}

/**
 * Was die Betreiber im Reiter einstellen, so wie der Server es nimmt: immer der ganze Satz, `null` heißt Vorgabe (beim Prompt der Text der Vorgabe, bei
 * dem Kanal die Umgebungsvariable). Aus dem Eingabestand der Karte macht `einstellungenBody` diesen Satz.
 */
export interface EinstellungenSatz {
    prompt: string | null;
    uhrzeit: string;
    berichtsKanal: string | null;
}

/** Der Eingabestand der Karte „Einstellungen“: Texte, wie sie in den Feldern stehen. */
export interface EinstellungenFelder {
    prompt: string;
    uhrzeit: string;
    kanalBericht: string;
}

/** „9:30“ wird „09:30“; alles andere bleibt, wie es ist (die Prüfung sagt dann ungültig). */
export function uhrzeitNormal(text: string): string {
    const treffer = /^\s*(\d{1,2}):(\d{2})\s*$/u.exec(text);
    return treffer === null ? text.trim() : `${treffer[1]!.padStart(2, "0")}:${treffer[2]!}`;
}

export function kanalGueltig(text: string): boolean {
    return text.trim() === "" || new RegExp(DISCORD_KANAL_MUSTER, "u").test(text.trim());
}

/** Die Felder der Karte als Satz für den Server; die Vorgabe oder ein leerer Prompt und ein leerer Kanal werden `null`. */
export function einstellungenBody(felder: EinstellungenFelder): EinstellungenSatz {
    const prompt = felder.prompt.replace(/\r\n?/gu, "\n").trim();
    return {
        prompt: prompt === "" || prompt === DISCORD_PROMPT_VORGABE ? null : prompt,
        uhrzeit: uhrzeitNormal(felder.uhrzeit),
        berichtsKanal: felder.kanalBericht.trim() === "" ? null : felder.kanalBericht.trim(),
    };
}

/** Der gespeicherte Stand als Felder der Karte (der Prompt ist der, der gilt: gespeichert oder die Vorgabe). */
export function felderAusStand(stand: Pick<DiscordStand, "einstellungen">): EinstellungenFelder {
    const e = stand.einstellungen;
    return {
        prompt: e.prompt,
        uhrzeit: e.uhrzeit,
        kanalBericht: e.kanalBericht.eigen ?? "",
    };
}

export const gleicheFelder = (a: EinstellungenFelder, b: EinstellungenFelder): boolean =>
    a.prompt === b.prompt && a.uhrzeit === b.uhrzeit && a.kanalBericht === b.kanalBericht;

export interface DiscordVerwaltung {
    stand: ShallowRef<DiscordStand | null>;
    fehler: Ref<boolean>;
    vorschau: ShallowRef<DiscordVorschau | null>;
    vorschauFehler: Ref<boolean>;
    busy: Ref<string | null>;
    problems: Ref<Phrase[]>;
    /** Welche Handlung die `problems` ausgelöst hat (`routine`, `einstellungen`, `zustellung-<id>`): Jede Karte zeigt nur ihre eigenen. */
    problemWer: Ref<string | null>;
    laden: () => Promise<void>;
    rechneVorschau: () => Promise<void>;
    setzeRoutine: (aktiv: boolean) => Promise<boolean>;
    speichereEinstellungen: (satz: EinstellungenSatz) => Promise<boolean>;
    wiederhole: (id: number) => Promise<boolean>;
}

export interface DiscordVerwaltungDeps {
    fetcher?: Fetcher;
    reads?: ReadConfirmation;
}

export function createDiscordVerwaltung(deps: DiscordVerwaltungDeps = {}): DiscordVerwaltung {
    const stand = shallowRef<DiscordStand | null>(null);
    const fehler = ref(false);
    const vorschau = shallowRef<DiscordVorschau | null>(null);
    const vorschauFehler = ref(false);
    const busy = ref<string | null>(null);
    const problems = ref<Phrase[]>([]);
    const problemWer = ref<string | null>(null);
    const reads = deps.reads ?? createReadConfirmation(requestConfirmation);

    async function laden(): Promise<void> {
        try {
            stand.value = await withConfirmation(
                () => getJson<DiscordStand>(DISCORD_ADMIN_URL, deps.fetcher),
                reads.ask,
            );
            fehler.value = false;
        } catch {
            fehler.value = true;
        }
    }

    async function rechneVorschau(): Promise<void> {
        if (busy.value !== null) return;
        busy.value = "vorschau";
        try {
            vorschau.value = await withConfirmation(
                () => getJson<DiscordVorschau>(`${DISCORD_ADMIN_URL}/vorschau`, deps.fetcher),
                reads.ask,
            );
            vorschauFehler.value = false;
        } catch {
            vorschauFehler.value = true;
        } finally {
            busy.value = null;
        }
    }

    /** Eine Handlung mit Passkey: Der Server fragt ihn an (`reauth_required`), die Bestätigung kommt von hier. */
    async function handle(wer: string, url: string, rumpf: Record<string, unknown>): Promise<boolean> {
        if (busy.value !== null) return false;
        busy.value = wer;
        problems.value = [];
        problemWer.value = wer;
        let ok = false;
        try {
            await withConfirmation(
                () => postJson<OperationReceipt>(url, { operationId: newOperationId(), ...rumpf }, deps.fetcher),
                requestConfirmation,
            );
            ok = true;
        } catch (error) {
            problems.value = formProblems(error);
        } finally {
            busy.value = null;
        }
        await laden();
        return ok;
    }

    return {
        stand,
        fehler,
        vorschau,
        vorschauFehler,
        busy,
        problems,
        problemWer,
        laden,
        rechneVorschau,
        setzeRoutine: (aktiv) => handle("routine", `${DISCORD_ADMIN_URL}/routine`, { aktiv }),
        speichereEinstellungen: (satz) => handle("einstellungen", `${DISCORD_ADMIN_URL}/einstellungen`, { ...satz }),
        wiederhole: (id) =>
            handle(`zustellung-${String(id)}`, `${DISCORD_ADMIN_URL}/zustellungen/${String(id)}/wiederholen`, {}),
    };
}
