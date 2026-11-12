import { shallowRef, type ShallowRef } from "vue";
import type { EditorLockIncoming, EditorLockKind } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import type { EditorSperre } from "./sperre";

/**
 * „Freigabe erbitten“ beim Inhaber der Sperre (WI-0262, OPS-000059; Vali 2026-10-30): Ein anderer bittet um das Objekt, das hier gerade
 * bearbeitet wird. Der Hinweis (`freigabe-hinweise.vue`, nicht modal) nennt den Bittenden und das Objekt und bietet zwei Wege:
 *
 * - **Freigeben:** Der laufende Entwurf wird über den Weg „Fertig“ gespeichert, DANN gibt dieser Lauf die Sperre ab, und erst dann geht
 *   die Antwort „freigegeben“ an den Server (`EditorSperre.gibFreiAufBitte`: jede Bearbeitung des Objekts meldet an, wie sie sich beenden
 *   lässt). Hat der Inhaber nichts Ungespeichertes, endet die Bearbeitung ohne Schreiben und die Sperre ist frei. 🔴 **Scheitert das
 *   Speichern** (Prüfung, Konflikt, 409), bleibt die Sperre, der Hinweis nennt den Grund, und die Bitte bekommt KEINE Antwort: Der
 *   Bittende liest „abgelaufen“, nicht „später“. Der Inhaber kann es noch einmal versuchen oder „Später“ wählen.
 * - **Später:** lehnt ab; die Bitte bekommt die Antwort „später“.
 *
 * Die Bitten kommen mit dem Herzschlag (`EditorSperre.beiAnfragen`, ganze Liste, kein eigener Takt). Eine Bitte, die der Server nicht mehr
 * nennt (beantwortet, abgelaufen, Sperre frei), verschwindet; eine, die gerade speichert, bleibt, bis das Speichern ausging.
 */

export interface AnfrageEintrag {
    readonly id: string;
    readonly kind: EditorLockKind;
    /** Die Kennung des gesperrten Objekts (die Sperre). */
    readonly objektId: string;
    /** Der Name des Bittenden. */
    readonly wer: string;
    /** Der Name des Objekts, wie die Bearbeitung ihn nennt; ohne Namen `undefined`. */
    readonly name: string | undefined;
    readonly bis: string;
    readonly stand: "offen" | "speichert" | "fehler";
    /** Warum das Speichern nicht ging (nur bei `fehler`). */
    readonly grund?: string | undefined;
}

export interface FreigabeAnfragen {
    readonly eintraege: Readonly<ShallowRef<readonly AnfrageEintrag[]>>;
    freigeben(id: string): Promise<void>;
    spaeter(id: string): Promise<void>;
    destroy(): void;
}

export interface FreigabeAnfragenOptionen {
    sperre: Pick<EditorSperre, "beiAnfragen" | "gibFreiAufBitte" | "antworte" | "titelVon">;
    takt?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
    jetzt?: () => number;
}

export function createFreigabeAnfragen(optionen: FreigabeAnfragenOptionen): FreigabeAnfragen {
    const { sperre } = optionen;
    const takt = optionen.takt ?? globalThis;
    const jetzt = optionen.jetzt ?? (() => Date.now());
    const eintraege = shallowRef<readonly AnfrageEintrag[]>([]);
    let ablauf: ReturnType<typeof setTimeout> | undefined;

    const ziel = (e: Pick<AnfrageEintrag, "kind" | "objektId">) => ({ kind: e.kind, id: e.objektId });
    const ersetze = (id: string, neu: Partial<AnfrageEintrag>): void => {
        eintraege.value = eintraege.value.map((e) => (e.id === id ? { ...e, ...neu } : e));
    };
    const entferne = (ids: ReadonlySet<string>): void => {
        eintraege.value = eintraege.value.filter((e) => !ids.has(e.id));
    };

    /** Eine Bitte verschwindet von selbst, wenn sie abläuft (der Server nennt sie dann nicht mehr; der nächste Herzschlag kann dauern). */
    function planeAblauf(): void {
        if (ablauf !== undefined) takt.clearTimeout(ablauf);
        ablauf = undefined;
        const bis = eintraege.value
            .filter((e) => e.stand !== "speichert")
            .map((e) => Date.parse(e.bis))
            .sort((a, b) => a - b)[0];
        if (bis === undefined) return;
        ablauf = takt.setTimeout(
            () => {
                ablauf = undefined;
                const abgelaufen = new Set(
                    eintraege.value
                        .filter((e) => e.stand !== "speichert" && Date.parse(e.bis) <= jetzt())
                        .map((e) => e.id),
                );
                entferne(abgelaufen);
                planeAblauf();
            },
            Math.max(0, bis - jetzt()) + 50,
        );
    }

    const abmelden = sperre.beiAnfragen((neu: readonly EditorLockIncoming[]) => {
        const bisher = new Map(eintraege.value.map((e) => [e.id, e] as const));
        const ids = new Set(neu.map((b) => b.requestId));
        const gemerkt = eintraege.value.filter((e) => e.stand === "speichert" && !ids.has(e.id));
        eintraege.value = [
            ...neu
                .filter(
                    (bitte) =>
                        Date.parse(bitte.expiresAt) > jetzt() || bisher.get(bitte.requestId)?.stand === "speichert",
                )
                .map((bitte): AnfrageEintrag => {
                    const alt = bisher.get(bitte.requestId);
                    return {
                        id: bitte.requestId,
                        kind: bitte.kind,
                        objektId: bitte.id,
                        wer: bitte.from.name,
                        name: sperre.titelVon({ kind: bitte.kind, id: bitte.id }) ?? alt?.name,
                        bis: bitte.expiresAt,
                        stand: alt?.stand ?? "offen",
                        grund: alt?.grund,
                    };
                }),
            ...gemerkt,
        ];
        planeAblauf();
    });

    return {
        eintraege,
        async freigeben(id) {
            const eintrag = eintraege.value.find((e) => e.id === id);
            if (eintrag === undefined || eintrag.stand === "speichert") return;
            ersetze(id, { stand: "speichert", grund: undefined });
            const ausgang = await sperre.gibFreiAufBitte(ziel(eintrag));
            if (!ausgang.ok) {
                // Nichts gespeichert, nichts abgegeben, keine Antwort an den Bittenden.
                ersetze(id, { stand: "fehler", grund: ausgang.grund ?? t("sperre.freigabe.grund.unbekannt") });
                planeAblauf();
                return;
            }
            // Gespeichert und abgegeben. Alle Bitten an dieses Objekt (es können mehrere sein) sind damit erfüllt.
            const gleiche = eintraege.value.filter((e) => e.kind === eintrag.kind && e.objektId === eintrag.objektId);
            entferne(new Set(gleiche.map((e) => e.id)));
            planeAblauf();
            await Promise.all(gleiche.map((e) => sperre.antworte(e.id, "released")));
        },
        async spaeter(id) {
            const eintrag = eintraege.value.find((e) => e.id === id);
            if (eintrag === undefined || eintrag.stand === "speichert") return;
            entferne(new Set([id]));
            planeAblauf();
            await sperre.antworte(id, "later");
        },
        destroy() {
            abmelden();
            if (ablauf !== undefined) takt.clearTimeout(ablauf);
            ablauf = undefined;
        },
    };
}
