import type { WarteschlangeHaengt, WarteschlangeUmgebung } from "@avesmaps3d/shared";
import type { QuelleLage } from "./plan.ts";

/**
 * Hängende Aufträge erkennen (WI-0179). Anlass 2026-10-15: Seit 07:25 wies der Wrapper `avesmaps3d-auftrag` jeden Korridor-Auftrag
 * mit Exit 3 ab (die Dirigent-Unit versteckte `/home`), und der Dirigent stellte ihn acht Stunden lang still alle fünf Minuten
 * zurück. In der Oberfläche stand „Wartet“, niemand wurde benachrichtigt. Betreiber: Probleme müssen sich melden.
 *
 * - **Gezählt** wird je Auftrag und Versuch (Umgebung, Kennung, `attempt`), wie oft der Ausführer ihn HINTEREINANDER mit demselben
 *   Grund abgewiesen hat: `exit_3` (die Umgebung kann ihn nicht ausführen), `exit_2` (Aufruffehler), `unveraendert` (der Ausführer
 *   endete, ohne ihn zu übernehmen; dazu gehört Claudios Exit 70, „Einrichtungsfehler“, seit `8458a82b`).
 * - **Hängend** ist er ab `HAENGT_AB_ABLEHNUNGEN` Ablehnungen; dann steht `haengt` im Stand. Gemeldet wird von der App seiner
 *   Umgebung, einmal je Auftrag und Versuch (`jobs/haengt-melder.ts`); der Dirigent schreibt weiter in keine Datenbank.
 * - **Zurückgesetzt** wird, sobald der Ausführer anders antwortet: Er übernimmt den Auftrag (die Zeile wartet nicht mehr oder trägt
 *   einen neuen Versuch), oder er meldet ein gewöhnliches Warten (Exit 75 Sperre der Domäne, Exit 76 Speichertor; dann arbeitet er
 *   ja). Ein anderer Grund beginnt eine neue Serie bei eins.
 * - 🪤 Ein Neustart des Dirigenten verliert die Zähler (er ist zustandslos bis auf das, was nur er wissen kann). Das ist harmlos: Er
 *   zählt neu, und die Meldung hängt an `attempt`, nicht an der Serie, kommt also nicht doppelt.
 */

/**
 * Ab so vielen gleichen Ablehnungen hintereinander gilt ein Auftrag als hängend. Mit Exit 3 (alle fünf Minuten ein Versuch) sind das
 * rund zehn Minuten nach dem ersten Start, mit „unverändert“ (jede Minute) rund zwei. 🔴 Ein Regler mit Wirkung auf den Betrieb:
 * gemeldet in `project-control/discovery/regler-meldeliste.md`, nicht selbst einstellbar gebaut (AGENTS.md „Regler melden“).
 */
export const HAENGT_AB_ABLEHNUNGEN = 3;

export type HaengtGrund = "exit_3" | "exit_2" | "unveraendert";

interface Serie {
    umgebung: WarteschlangeUmgebung;
    id: number;
    attempt: number;
    grund: HaengtGrund;
    code: number | null;
    ablehnungen: number;
    seitMs: number;
}

const schluessel = (umgebung: WarteschlangeUmgebung, id: number): string => `${umgebung}#${String(id)}`;

export class HaengtZaehler {
    private readonly serien = new Map<string, Serie>();
    private readonly ab: number;

    // 🪤 Kein `constructor(private readonly ab …)`: Lokal startet Node die Quelle mit Type-Stripping, und das kennt keine
    // Parameter-Eigenschaften (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX); der Worker brach am 2026-10-17 lokal sofort ab.
    constructor(ab: number = HAENGT_AB_ABLEHNUNGEN) {
        this.ab = ab;
    }

    /**
     * Eine Ablehnung zählen. `jetztHaengend` ist nur in dem Takt wahr, in dem die Serie die Schwelle erreicht: Das Log meldet es
     * einmal, nicht bei jedem weiteren Versuch.
     */
    zaehle(
        auftrag: { umgebung: WarteschlangeUmgebung; id: number; attempt: number },
        grund: HaengtGrund,
        code: number | null,
        nowMs: number,
    ): { ablehnungen: number; jetztHaengend: boolean } {
        const key = schluessel(auftrag.umgebung, auftrag.id);
        const vorher = this.serien.get(key);
        const weiter = vorher !== undefined && vorher.attempt === auftrag.attempt && vorher.grund === grund;
        const serie: Serie = weiter
            ? { ...vorher, code, ablehnungen: vorher.ablehnungen + 1 }
            : { ...auftrag, grund, code, ablehnungen: 1, seitMs: nowMs };
        this.serien.set(key, serie);
        return { ablehnungen: serie.ablehnungen, jetztHaengend: serie.ablehnungen === this.ab };
    }

    /** Der Ausführer hat anders geantwortet: Die Serie ist vorbei. `true`, wenn der Auftrag bis eben als hängend galt. */
    loese(umgebung: WarteschlangeUmgebung, id: number): boolean {
        const key = schluessel(umgebung, id);
        const serie = this.serien.get(key);
        this.serien.delete(key);
        return serie !== undefined && serie.ablehnungen >= this.ab;
    }

    /**
     * Mit einer Lesung abgleichen: Was in einer lesbaren Umgebung nicht mehr wartet (übernommen, fertig, abgebrochen) oder einen
     * neuen Versuch trägt, fällt heraus. Gibt die zurück, die bis eben hingen. Eine unlesbare Umgebung behält ihre Serien.
     */
    abgleichen(lagen: readonly QuelleLage[]): { umgebung: WarteschlangeUmgebung; id: number }[] {
        const geloest: { umgebung: WarteschlangeUmgebung; id: number }[] = [];
        for (const serie of this.serien.values()) {
            const lage = lagen.find((entry) => entry.umgebung === serie.umgebung);
            if (lage === undefined || !lage.erreichbar) continue;
            const zeile = lage.queued.find((job) => job.id === serie.id);
            if (zeile !== undefined && zeile.attempt === serie.attempt) continue;
            if (this.loese(serie.umgebung, serie.id)) geloest.push({ umgebung: serie.umgebung, id: serie.id });
        }
        return geloest;
    }

    /** Was im Stand steht; `null`, solange der Auftrag nicht hängt. */
    haengt(umgebung: WarteschlangeUmgebung, id: number): WarteschlangeHaengt | null {
        const serie = this.serien.get(schluessel(umgebung, id));
        if (serie === undefined || serie.ablehnungen < this.ab) return null;
        return {
            seit: new Date(serie.seitMs).toISOString(),
            ablehnungen: serie.ablehnungen,
            grund: serie.grund,
            code: serie.code,
            attempt: serie.attempt,
        };
    }
}
