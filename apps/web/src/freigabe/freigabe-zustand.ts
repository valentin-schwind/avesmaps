import type { ReleaseFreigabeStand, ReleaseTestFreigabe } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";

/**
 * Der Zustand der Freigabe an der Stelle, wo früher „Für Production freigeben“ stand (WI-0248; Vali 2026-10-26: „1. Wann getestet wird: WENN ICH DAS
 * WILL“, „3. … Nein das passiert automatisch, sobald der test grün war“). Der Knopf entfällt: Der Start des Release-Tests ist die Freigabe, und hier
 * steht nur noch, was aus ihr wird — wartet auf den Test, Test läuft, rot (Bericht auf Lokal), grün und wird ausgeliefert, in Production.
 *
 * Eine Regel für beide Quellen: auf der Stage Claudios Statusdatei (`releaseFreigabe`, mit `ausgeliefert`), auf Lokal der Kandidat des Starters
 * (`kandidat.freigabe`). Beide kommen aus derselben Entscheidung (`scripts/dev/release-freigabe.ts`); die Oberfläche rechnet nichts nach.
 */

export interface FreigabeZustandSatz {
    readonly key: MessageKey;
    readonly params: Record<string, string>;
    /** Die Farbe der Zeile: `gut` (grün, in Production), `rot`, sonst neutral. */
    readonly ton: "gut" | "rot" | "";
}

type Quelle =
    | Pick<ReleaseFreigabeStand, "commit" | "von" | "zustand" | "grund">
    | (Pick<ReleaseTestFreigabe, "von" | "zustand" | "grund"> & { readonly sha: string });

/** Der Satz zur Freigabe; ohne Freigabe der Hinweis, wie eine entsteht. */
export function freigabeZustand(f: Quelle | null | undefined): FreigabeZustandSatz {
    if (f === null || f === undefined) return { key: "admin.umgebungen.freigabe.keine", params: {}, ton: "" };
    const sha = "commit" in f ? f.commit : f.sha;
    const params = { stand: sha.slice(0, 7), wer: f.von ?? "–", grund: f.grund };
    switch (f.zustand) {
        case "wartet":
            return { key: "admin.umgebungen.freigabe.wartet", params, ton: "" };
        case "laeuft":
            return { key: "admin.umgebungen.freigabe.laeuft", params, ton: "" };
        case "rot":
            return { key: "admin.umgebungen.freigabe.rot", params, ton: "rot" };
        case "gruen":
            return { key: "admin.umgebungen.freigabe.gruen", params, ton: "gut" };
        case "ausgeliefert":
            return { key: "admin.umgebungen.freigabe.ausgeliefert", params, ton: "gut" };
        default:
            // abgebrochen, fremd, ungueltig: Es geht nichts raus, und der Grund sagt, warum.
            return { key: "admin.umgebungen.freigabe.nicht", params, ton: "" };
    }
}
