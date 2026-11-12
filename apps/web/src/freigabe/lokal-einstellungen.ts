import { ref, type Ref } from "vue";
import {
    KARTENEINSTELLUNGEN_URL,
    LOKAL_IM_MENUE,
    LOKAL_NAME_MUSTER,
    privateKarteneinstellung,
    privateKarteneinstellungenWirksam,
    type AdminKarteneinstellungen,
    type LokalImMenue,
    type OperationReceipt,
    type PrivateKartenEinstellungen,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import { requestConfirmation, withConfirmation, type ReadConfirmation } from "../auth/bestaetigen";
import { formProblems, type Phrase } from "../auth/formular";

/**
 * Die Einstellungen von Lokal im Reiter „Umgebungen“ (WI-0204 Stufe 2): Adresse im Tailnet (Name und Port) und wann Lokal im
 * Umgebungsmenü steht. Gespeichert in den Karteneinstellungen mit Sichtbarkeit `privat` (WI-0180 §8): derselbe Lese- und
 * Schreibweg wie der Reiter „Karteneinstellungen“, aber nur die privaten Zeilen, und schreiben verlangt `switch_environment`.
 *
 * - Ein Wert auf seiner Vorgabe wird nicht gespeichert, sondern die Abweichung gelöscht (`value: null`), wie in den
 *   Karteneinstellungen. Die Vorgabe des Namens ist leer: dann gibt es Lokal nirgends.
 * - Geschrieben wird mit dem Passkey (Stufe S); der Server prüft Muster und Grenzen noch einmal.
 */

export type LokalFeld = "lokalName" | "lokalPort" | "lokalImMenue";

const NAME = new RegExp(LOKAL_NAME_MUSTER, "u");

/**
 * Was jemand eingetippt hat, als Wert der Einstellung, oder der Satz, warum es keiner ist. Der Name wird klein geschrieben und
 * ohne Leerraum genommen (MagicDNS kennt keine Großbuchstaben); leer heißt: Lokal abschalten. Eine eingefügte Adresse
 * (`https://name.tailnet.ts.net/`) gilt als ihr Name; ein Port darin gehört ins Portfeld und bekommt seinen eigenen Satz
 * (Handover `2026-10-17-lokal-name-mit-https-an-claudia.md`). Der Server prüft das Muster weiter streng.
 */
export function lokalEingabe(feld: LokalFeld, text: string): string | number | Phrase {
    const roh = text.trim();
    if (feld === "lokalName") {
        const name = roh
            .toLowerCase()
            .replace(/^https?:\/\//u, "")
            .replace(/\/$/u, "");
        if (/:\d*$/u.test(name)) return { key: "admin.umgebungen.lokal.nameMitPort" };
        return name === "" || NAME.test(name) ? name : { key: "admin.umgebungen.lokal.nameFalsch" };
    }
    if (feld === "lokalPort") {
        const port = Number(roh);
        return /^\d+$/u.test(roh) && port >= 1 && port <= 65535 ? port : { key: "admin.umgebungen.lokal.portFalsch" };
    }
    return (LOKAL_IM_MENUE as readonly string[]).includes(roh)
        ? (roh as LokalImMenue)
        : { key: "admin.umgebungen.lokal.menueFalsch" };
}

const istPhrase = (wert: unknown): wert is Phrase => typeof wert === "object" && wert !== null && "key" in wert;

export interface LokalEinstellungen {
    /** Die wirksamen Werte; `null`, solange nicht gelesen (oder ohne Recht). */
    werte: Ref<PrivateKartenEinstellungen | null>;
    /** Weicht der Wert von seiner Vorgabe ab? Je Feld. */
    abweichend: Ref<Record<LokalFeld, boolean>>;
    /** Das Feld, das gerade geschrieben wird. */
    busy: Ref<LokalFeld | null>;
    /** Das Problem je Feld, bis es behoben ist. */
    probleme: Ref<Partial<Record<LokalFeld, Phrase>>>;
    laden: () => Promise<void>;
    /** Einen getippten oder gewählten Wert übernehmen; unverändert heißt nichts tun. `true`, wenn etwas geschrieben wurde. */
    setze: (feld: LokalFeld, text: string) => Promise<boolean>;
    /** Auf die Vorgabe zurück (die Abweichung löschen). */
    zuruecksetzen: (feld: LokalFeld) => Promise<boolean>;
}

export interface LokalEinstellungenDeps {
    fetcher?: Fetcher;
    reads?: ReadConfirmation;
    /** Nach jedem Schreiben: etwa den Stand je Umgebung neu lesen, damit Station und Menü die neue Adresse kennen. */
    nachher?: () => Promise<void>;
}

export function createLokalEinstellungen(deps: LokalEinstellungenDeps = {}): LokalEinstellungen {
    const werte = ref<PrivateKartenEinstellungen | null>(null);
    const abweichend = ref<Record<LokalFeld, boolean>>({ lokalName: false, lokalPort: false, lokalImMenue: false });
    const busy = ref<LokalFeld | null>(null);
    const probleme = ref<Partial<Record<LokalFeld, Phrase>>>({});
    let revision: number | null = null;

    async function laden(): Promise<void> {
        try {
            const lesen = () => getJson<AdminKarteneinstellungen>(KARTENEINSTELLUNGEN_URL, deps.fetcher);
            const stand = deps.reads === undefined ? await lesen() : await withConfirmation(lesen, deps.reads.ask);
            const zeilen = stand.privat ?? [];
            revision = stand.revision;
            werte.value = privateKarteneinstellungenWirksam(
                Object.fromEntries(zeilen.map((zeile) => [zeile.id, zeile.value])),
            );
            abweichend.value = {
                lokalName: zeilen.some((zeile) => zeile.id === "lokalName"),
                lokalPort: zeilen.some((zeile) => zeile.id === "lokalPort"),
                lokalImMenue: zeilen.some((zeile) => zeile.id === "lokalImMenue"),
            };
        } catch {
            werte.value = null;
        }
    }

    /** Das Problem eines Feldes ist behoben. */
    function loese(feld: LokalFeld): void {
        const rest = { ...probleme.value };
        delete rest[feld];
        probleme.value = rest;
    }

    async function schreibe(feld: LokalFeld, value: string | number | null): Promise<boolean> {
        if (revision === null || busy.value !== null) return false;
        busy.value = feld;
        try {
            const body = { operationId: newOperationId(), baseRevision: revision, id: feld, value };
            await withConfirmation(
                () => postJson<OperationReceipt>(KARTENEINSTELLUNGEN_URL, body, deps.fetcher),
                requestConfirmation,
            );
            loese(feld);
            return true;
        } catch (error) {
            const [problem] = formProblems(error);
            if (problem !== undefined) probleme.value = { ...probleme.value, [feld]: problem };
            return false;
        } finally {
            busy.value = null;
            await laden();
            await deps.nachher?.();
        }
    }

    async function setze(feld: LokalFeld, text: string): Promise<boolean> {
        const wert = lokalEingabe(feld, text);
        if (istPhrase(wert)) {
            probleme.value = { ...probleme.value, [feld]: wert };
            return false;
        }
        const jetzt = werte.value?.[feld];
        if (jetzt === wert) {
            loese(feld);
            return false;
        }
        const vorgabe = privateKarteneinstellung(feld)?.vorgabe;
        return schreibe(feld, wert === vorgabe ? null : wert);
    }

    return {
        werte,
        abweichend,
        busy,
        probleme,
        laden,
        setze,
        zuruecksetzen: (feld) => (abweichend.value[feld] ? schreibe(feld, null) : Promise.resolve(false)),
    };
}
