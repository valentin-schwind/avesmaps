import { shallowRef, type ShallowRef } from "vue";
import {
    EDITOR_LOCK_HEARTBEAT_SECONDS,
    EDITOR_LOCK_REQUEST_POLL_SECONDS,
    EDITOR_LOCK_TIMEOUT_MINUTES,
    type EditorLock,
    type EditorLockKind,
    type EditorLockPart,
    type EditorLockRequest,
} from "@avesmaps3d/shared";
import { locale, t, type MessageKey } from "../i18n/i18n";
import type { EditorSperre } from "./sperre";

/**
 * Die Sperren der anderen, wie die Karte und das Kartenmenü sie zeigen (EDIT-0003 §4, T27 (3); S3). Die Liste kommt vom Server
 * (`EditorSperre.liste`), im Takt des Herzschlags, solange die Seite im Editor-Modus ist, und frisch, sobald ein Menü sie braucht.
 * Eigene Sperren stehen nicht darin, auch nicht aus einem anderen Fenster: Wer selbst bearbeitet, sieht seinen Modus, kein Schloss.
 *
 * **Bitten um Freigabe** (WI-0262): Mit derselben Antwort der Liste kommen die eigenen Bitten dieser Art (`anfragen`). Solange eine offen
 * ist, fragt die Liste öfter (alle `EDITOR_LOCK_REQUEST_POLL_SECONDS` statt jede Minute), damit die Antwort des Inhabers nicht eine
 * Minute braucht; mit der Antwort ist der schnelle Takt wieder aus. Ein neuer Takt für alle ist das nicht.
 *
 * Die Wörter nach F10 (🔒 „wird gerade bearbeitet“) und dem Probierblatt: das Schild „🔒 Thomas · Form · seit 07:32“, der Kasten „🔒 Thomas
 * bearbeitet die Form seit 07:32“ mit „Zuletzt aktiv um 07:41, ohne Aktivität frei ab 07:56.“ Uhrzeiten statt Dauern: Sie veralten
 * nicht, solange das Menü offen steht.
 */
export interface FremdeSperren {
    readonly art: EditorLockKind;
    readonly liste: Readonly<ShallowRef<readonly EditorLock[]>>;
    /** Die eigenen Bitten um Freigabe an Sperren dieser Art, die jüngste zuerst (WI-0262). */
    readonly anfragen: Readonly<ShallowRef<readonly EditorLockRequest[]>>;
    /** Die jüngste eigene Bitte an dieses Objekt. */
    anfrageZu(id: string): EditorLockRequest | undefined;
    /** Nimmt eine eben gestellte Bitte auf, ohne die nächste Antwort der Liste abzuwarten. */
    merke(anfrage: EditorLockRequest): void;
    /** Die Sperre eines anderen an diesem Objekt, sonst nichts. */
    von(id: string): EditorLock | undefined;
    /**
     * An Linien (WI-0205 K11, Anzeige): die Sperre, deren Objekt oder Abschnitte (`sections`) diesen Abschnitt tragen. Ein Klick trifft
     * einen Abschnitt, gesperrt ist bei der Kraftlinie ihr Anker.
     */
    vonAbschnitt(id: string): EditorLock | undefined;
    /** Jetzt neu fragen (ein Menü öffnet, ein Modus endet, eine Sperre wurde aufgehoben). */
    frisch(): Promise<void>;
    destroy(): void;
}

export interface FremdeSperrenOptionen {
    /** `anfragen` ist optional, damit ein Prüfling nur mit `liste` genügt; ohne es gibt es keine Bitten. */
    sperre: Pick<EditorSperre, "liste"> & Partial<Pick<EditorSperre, "anfragen">>;
    art: EditorLockKind;
    /** Nur im Editor-Modus; sonst fragt der Takt nicht. */
    aktiv: () => boolean;
    takt?: Pick<typeof globalThis, "setInterval" | "clearInterval">;
}

export function createFremdeSperren(optionen: FremdeSperrenOptionen): FremdeSperren {
    const takt = optionen.takt ?? globalThis;
    const liste = shallowRef<readonly EditorLock[]>([]);
    const anfragen = shallowRef<readonly EditorLockRequest[]>([]);
    let frage = 0;
    let schnell: ReturnType<typeof setInterval> | undefined;
    /** Solange eine eigene Bitte offen ist (und der Editor-Modus läuft), fragt die Liste öfter. */
    function stelleSchnell(): void {
        const soll = optionen.aktiv() && anfragen.value.some((anfrage) => anfrage.state === "open");
        if (soll && schnell === undefined)
            schnell = takt.setInterval(() => void frisch(), EDITOR_LOCK_REQUEST_POLL_SECONDS * 1000);
        if (!soll && schnell !== undefined) {
            takt.clearInterval(schnell);
            schnell = undefined;
        }
    }
    async function frisch(): Promise<void> {
        if (!optionen.aktiv()) {
            liste.value = [];
            anfragen.value = [];
            stelleSchnell();
            return;
        }
        const diese = ++frage;
        const alle = await optionen.sperre.liste(optionen.art);
        if (diese !== frage) return;
        liste.value = alle.filter((sperre) => !sperre.own);
        anfragen.value = optionen.sperre.anfragen?.(optionen.art) ?? [];
        stelleSchnell();
    }
    const uhr = takt.setInterval(() => void frisch(), EDITOR_LOCK_HEARTBEAT_SECONDS * 1000);
    return {
        art: optionen.art,
        liste,
        anfragen,
        // Die jüngste (der Server nennt sie zuerst; hier zählt nicht die Reihenfolge, sondern der Zeitpunkt).
        anfrageZu: (id) =>
            anfragen.value
                .filter((anfrage) => anfrage.id === id)
                .reduce<EditorLockRequest | undefined>(
                    (jung, anfrage) =>
                        jung === undefined || Date.parse(anfrage.createdAt) > Date.parse(jung.createdAt)
                            ? anfrage
                            : jung,
                    undefined,
                ),
        merke(anfrage) {
            anfragen.value = [anfrage, ...anfragen.value.filter((a) => a.requestId !== anfrage.requestId)];
            stelleSchnell();
        },
        von: (id) => liste.value.find((sperre) => sperre.id === id),
        vonAbschnitt: (id) => liste.value.find((sperre) => sperre.id === id || sperre.sections?.includes(id) === true),
        frisch,
        destroy() {
            takt.clearInterval(uhr);
            if (schnell !== undefined) takt.clearInterval(schnell);
            schnell = undefined;
        },
    };
}

const WORT: Readonly<Record<EditorLockPart, MessageKey>> = { form: "sperre.wort.form", felder: "sperre.wort.felder" };
const WORAN: Readonly<Record<EditorLockPart, MessageKey>> = {
    form: "sperre.woran.form",
    felder: "sperre.woran.felder",
};

export const uhrzeit = (iso: string): string =>
    new Date(iso).toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit" });

/** Das Schild auf der Karte: „🔒 Thomas · Form · seit 07:32“. */
export function sperrSchild(sperre: EditorLock): string {
    return t("sperre.schild", { wer: sperre.person.name, wort: t(WORT[sperre.part]), seit: uhrzeit(sperre.since) });
}

/** Der Kopf des Kastens: „🔒 Thomas bearbeitet die Form seit 07:32“. */
export function sperrKopf(sperre: EditorLock): string {
    return t("sperre.kopf", { wer: sperre.person.name, woran: t(WORAN[sperre.part]), seit: uhrzeit(sperre.since) });
}

/** Die Zeile darunter: zuletzt aktiv und frei ab, als Uhrzeiten. */
export function sperrDetail(sperre: EditorLock): string {
    const frei = new Date(Date.parse(sperre.heartbeatAt) + EDITOR_LOCK_TIMEOUT_MINUTES * 60_000).toISOString();
    return t("sperre.detail", { zuletzt: uhrzeit(sperre.heartbeatAt), frei: uhrzeit(frei) });
}

/**
 * So weit steht das Schild eines Orts über seinem Punkt (Bildpunkte): etwas mehr als die halbe Kante der größten Ortsmarke, damit die
 * Marke frei bleibt (WI-0208, die Sperre am Ort sichtbar). Eine Landschaft trägt das Schild mitten auf der Fläche.
 *
 * 🪤 Hier und nicht in `map/sperre-schicht.ts`: Die lädt `sperre-schild.vue`, und `npm test` aus der Wurzel kennt kein Vue-Plugin.
 */
const ORT_ABSTAND = 16;

/** Wo das Schild am Punkt `at` sitzt: am Ort über der Marke, an einer Landschaft mittig. */
export function schildLage(sperre: Pick<EditorLock, "kind">): {
    anchor: "bottom" | "center";
    offset?: [number, number];
} {
    return sperre.kind === "place" ? { anchor: "bottom", offset: [0, -ORT_ABSTAND] } : { anchor: "center" };
}
