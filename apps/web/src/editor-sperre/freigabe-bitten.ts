import { watch, type WatchStopHandle } from "vue";
import type { EditorLock, EditorLockKind, EditorLockRequest } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import type { FremdeSperren } from "./fremde-sperren";
import { uhrzeit } from "./fremde-sperren";
import type { EditorSperre } from "./sperre";

/**
 * „Freigabe erbitten“ beim Bittenden (WI-0262, OPS-000059; Vali 2026-10-30): Wer ein fremd gesperrtes Objekt sieht, bittet im Kasten zur
 * Sperre (Kartenmenü) den Inhaber um Freigabe. Der Kasten zeigt den Stand der Bitte, und die Antwort kommt zusätzlich als Meldung, weil der
 * Kasten dann längst zu sein kann.
 *
 * Der Stand der Bitte kommt vom Server (`FremdeSperren.anfragen`, mit der Liste der Sperren, während sie offen ist alle 10 Sekunden);
 * dieser Baustein legt nur dazu, was der Server noch nicht weiß (die Bitte ist unterwegs, sie ging schief) und meldet die Wechsel:
 *
 * | Server | Kasten | Meldung |
 * |---|---|---|
 * | keine Bitte | Knopf „Freigabe erbitten“ | |
 * | `open` | „Anfrage gesendet, läuft ab um 07:41.“ | |
 * | `released` | „Freigegeben, jetzt bearbeitbar.“ | ja, und die Sperren werden frisch gefragt: Das Objekt ist frei, ohne Neuladen |
 * | `later` | „Später.“ und der Knopf wieder | ja |
 * | `expired` | „Abgelaufen.“ und der Knopf wieder | ja |
 *
 * Gemeldet wird nur, was diese Seite offen sah: Eine Antwort von vor dem Neuladen steht im Kasten, aber nie als Meldung. Eine Bitte gilt
 * der Sperre, die beim Bitten galt: Hält inzwischen ein anderer Lauf das Objekt (die Sperre ist jünger als die Bitte), steht der Kasten
 * wieder mit dem Knopf da, und der alte Stand verschwindet.
 */

/** Was der Kasten zur Bitte zeigt: eine Zeile zum Stand und/oder den Knopf. */
export interface KastenFreigabe {
    /** Der Satz zum Stand der Bitte; `undefined`, wenn es keine gibt. */
    readonly status?: string | undefined;
    /** Der Knopf „Freigabe erbitten“ steht da. */
    readonly knopf: boolean;
    /** Die Bitte ist unterwegs: der Knopf steht grau, ohne eigenen Grund. */
    readonly sendet: boolean;
}

export interface FreigabeBittenOptionen {
    sperre: Pick<EditorSperre, "frage">;
    /** Die Sperren aller Arten, in denen eine Bitte stehen kann. */
    fremde: readonly FremdeSperren[];
    /** Eine Meldung (Toast). */
    melde(text: string, ton?: "warning"): void;
    /** Der Name des Objekts, wie das Menü ihn zeigte. */
    name(kind: EditorLockKind, id: string): string | undefined;
    /** Der Kasten zur Sperre ist neu zu zeichnen, wenn er offen steht. */
    neu(): void;
}

export interface FreigabeBitten {
    /** Was der Kasten zur Sperre zeigt; `undefined`, wenn die Bitte hier nicht in Frage kommt. */
    kasten(sperre: EditorLock): KastenFreigabe;
    /** Bittet; ein zweiter Aufruf, solange die Bitte läuft, tut nichts. */
    bitte(sperre: EditorLock): Promise<void>;
    destroy(): void;
}

const schluessel = (ziel: { kind: EditorLockKind; id: string }): string => `${ziel.kind}|${ziel.id}`;

/** Das Wort für ein Objekt, dessen Namen die Seite nicht kennt (etwa nach dem Neuladen). */
const NAMENLOS = (): string => t("sperre.freigabe.objekt");

export function createFreigabeBitten(optionen: FreigabeBittenOptionen): FreigabeBitten {
    /** Die Bitten, die unterwegs sind oder schiefgingen; der Server weiß davon noch nichts. */
    const lokal = new Map<string, "sendet" | "fehler">();
    /** Was diese Seite von jeder Bitte zuletzt sah: Nur ein Wechsel von „offen“ wird gemeldet. */
    const bekannt = new Map<string, EditorLockRequest["state"]>();
    const fremde = new Map<EditorLockKind, FremdeSperren>(optionen.fremde.map((f) => [f.art, f]));

    /** Die Bitte an diese Sperre, wenn sie ihr gilt (nicht einem früheren Halter). */
    function anfrageZu(sperre: EditorLock): EditorLockRequest | undefined {
        const anfrage = fremde.get(sperre.kind)?.anfrageZu(sperre.id);
        if (anfrage === undefined) return undefined;
        return Date.parse(anfrage.createdAt) >= Date.parse(sperre.since) ? anfrage : undefined;
    }

    const aufschrift = (kind: EditorLockKind, id: string): string => optionen.name(kind, id) ?? NAMENLOS();

    /** Die Meldung zu einer Antwort: „Burg Falkenstein“: Freigegeben, jetzt bearbeitbar. */
    function melde(anfrage: EditorLockRequest): void {
        const name = aufschrift(anfrage.kind, anfrage.id);
        const satz = (stand: "freigegeben" | "spaeter" | "abgelaufen"): string =>
            t("sperre.freigabe.meldung", { name, stand: t(`sperre.freigabe.stand.${stand}`) });
        if (anfrage.state === "released") optionen.melde(satz("freigegeben"));
        else if (anfrage.state === "later") optionen.melde(satz("spaeter"));
        else if (anfrage.state === "expired") optionen.melde(satz("abgelaufen"), "warning");
    }

    /** Die Wechsel seit dem letzten Stand: offen → freigegeben, später, abgelaufen. */
    function beobachte(): void {
        let freigegeben = false;
        for (const f of fremde.values()) {
            for (const anfrage of f.anfragen.value) {
                const davor = bekannt.get(anfrage.requestId);
                bekannt.set(anfrage.requestId, anfrage.state);
                if (davor !== "open" || anfrage.state === "open") continue;
                melde(anfrage);
                if (anfrage.state === "released") freigegeben = true;
            }
        }
        // Frei geworden: Die Sperren sofort neu fragen, damit das Objekt ohne Neuladen bearbeitbar ist (Schild und Kasten fallen weg).
        if (freigegeben) void Promise.all([...fremde.values()].map((f) => f.frisch()));
        optionen.neu();
    }

    // `sync`: Die Meldung kommt mit der Antwort der Liste, nicht erst im nächsten Bild; so ist sie auch ohne Fenster prüfbar.
    const stop: WatchStopHandle = watch(() => [...fremde.values()].map((f) => f.anfragen.value), beobachte, {
        flush: "sync",
    });

    return {
        kasten(sperre) {
            const key = schluessel(sperre);
            const lokaler = lokal.get(key);
            if (lokaler === "sendet") return { status: t("sperre.freigabe.stand.sendet"), knopf: true, sendet: true };
            const anfrage = anfrageZu(sperre);
            if (anfrage?.state === "open")
                return {
                    status: t("sperre.freigabe.stand.offen", { bis: uhrzeit(anfrage.expiresAt) }),
                    knopf: false,
                    sendet: false,
                };
            if (anfrage?.state === "released")
                return { status: t("sperre.freigabe.stand.freigegeben"), knopf: false, sendet: false };
            if (lokaler === "fehler") return { status: t("sperre.freigabe.stand.fehler"), knopf: true, sendet: false };
            if (anfrage?.state === "later")
                return { status: t("sperre.freigabe.stand.spaeter"), knopf: true, sendet: false };
            if (anfrage?.state === "expired")
                return { status: t("sperre.freigabe.stand.abgelaufen"), knopf: true, sendet: false };
            return { knopf: true, sendet: false };
        },
        async bitte(sperre) {
            const key = schluessel(sperre);
            if (lokal.get(key) === "sendet") return;
            lokal.set(key, "sendet");
            optionen.neu();
            const ergebnis = await optionen.sperre.frage({ kind: sperre.kind, id: sperre.id });
            lokal.delete(key);
            switch (ergebnis.art) {
                case "gestellt":
                case "offen":
                    bekannt.set(ergebnis.anfrage.requestId, "open");
                    fremde.get(sperre.kind)?.merke(ergebnis.anfrage);
                    break;
                case "frei":
                    // Der Inhaber war schneller: frisch fragen, das Objekt ist frei (Schild und Kasten fallen weg).
                    await Promise.all([...fremde.values()].map((f) => f.frisch()));
                    break;
                case "eigene":
                    break;
                case "fehler":
                    lokal.set(key, "fehler");
                    optionen.melde(t("sperre.freigabe.stand.fehler"), "warning");
                    break;
            }
            optionen.neu();
        },
        destroy: stop,
    };
}
