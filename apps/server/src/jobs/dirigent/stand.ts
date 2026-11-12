import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Value } from "@sinclair/typebox/value";
import {
    WarteschlangeAuftrag,
    leseWarteschlangeStand,
    type WarteschlangeHaengt,
    type WarteschlangePause,
    type WarteschlangeQuelle,
    type WarteschlangeStand,
    type WarteschlangeUmgebung,
} from "@avesmaps3d/shared";
import { ausloeserArt } from "../ausloeser.ts";
import type { ReiheEintrag } from "./plan.ts";

/**
 * Die Stand-Datei des Dirigenten (WI-0163 §5.1, Vertrag `packages/shared/src/warteschlange-stand.ts`): Was er in einem Takt weiß,
 * legt er als `WarteschlangeStand` ab; jede App liest sie und zeigt die Reihe beider Umgebungen. Er schreibt sie in jedem Takt,
 * also ist `at` zugleich sein Lebenszeichen (alt nach `WARTESCHLANGE_STAND_ALT_S`).
 *
 * 🔴 **Der Vertrag wird beim Schreiben eingehalten, nicht beim Lesen gehofft.** Die App liest die Datei als Ganzes (`null` heißt
 * „Zustand unbekannt“): Ein einziges Feld außerhalb des Schemas machte die ganze Reihe unsichtbar. Darum werden Freitexte auf
 * ihre Grenze gekürzt, ein Auftrag, der trotzdem nicht passt, fällt einzeln heraus (und wird gezählt), und der fertige Stand
 * wird vor dem Schreiben mit `leseWarteschlangeStand` geprüft.
 *
 * 🔴 **Atomar**: erst eine temporäre Datei daneben, dann umbenennen. Ein Leser sieht immer eine ganze Datei, nie eine halbe.
 * Modus 0644 ausdrücklich (`chmod` nach dem Schreiben, die umask des Dienstes könnte ihn sonst schmälern): Beide Apps lesen sie
 * als andere Benutzer.
 */

export interface StandEingabe {
    nowMs: number;
    dirigent: { instanz: string; release: string | null; taktS: number };
    pause: WarteschlangePause;
    umgebungen: readonly WarteschlangeQuelle[];
    reihe: readonly ReiheEintrag[];
    /** Hängt ein wartender Auftrag (WI-0179, `haengt.ts`)? Ohne die Angabe hängt keiner. */
    haengt?: (umgebung: WarteschlangeUmgebung, id: number) => WarteschlangeHaengt | null;
    /** Der Anzeigename des Auslösers (WI-0293, `QuelleLage.namen`); ohne die Angabe steht kein Name im Stand. */
    name?: (umgebung: WarteschlangeUmgebung, actorRef: string) => string | null;
}

const kuerzen = (text: string | null, max: number): string | null => (text === null ? null : text.slice(0, max));

export function auftragImStand(
    eintrag: ReiheEintrag,
    haengt: WarteschlangeHaengt | null = null,
    name: string | null = null,
): WarteschlangeAuftrag {
    const { job } = eintrag;
    const ausloeser = ausloeserArt(job.actorRef, job.origin);
    // Der Name nur zu einer Person, gekürzt auf die Grenze des Vertrags; ohne ihn fehlt das Feld (ältere Leser kennen es nicht).
    const anzeigename = ausloeser === "person" && name !== null && name.trim() !== "" ? name.trim().slice(0, 80) : null;
    // Nur ein wartender Auftrag kann hängen; ohne Befund fehlt das Feld ganz (ältere Leser kennen es nicht).
    const befund = haengt !== null && job.state !== "RUNNING" ? { haengt } : {};
    return {
        umgebung: eintrag.umgebung,
        id: job.id,
        publicId: job.publicId,
        kind: job.kind,
        label: kuerzen(job.label, 200),
        state: job.state === "RUNNING" ? "RUNNING" : "QUEUED",
        origin: job.origin,
        platz: eintrag.platz,
        queuedAt: job.queuedAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        phase: kuerzen(job.phase, 80),
        progress: job.progress === null ? null : Math.min(1, Math.max(0, job.progress)),
        wartegrund: eintrag.wartegrund,
        schwer: eintrag.schwer,
        ...befund,
        // Die Art und bei einer Person ihr Anzeigename, nie `actor_ref` (WI-0293).
        ausloeser,
        ...(anzeigename === null ? {} : { ausloeserName: anzeigename }),
        // Die Restzeit eines sammelnden Auftrags für die andere Umgebung (WI-0293).
        notBefore: job.notBefore?.toISOString() ?? null,
    };
}

/** Baut den Stand; `verworfen` zählt Aufträge, die das Schema nicht erfüllen (sie stehen dann nicht darin). */
export function baueStand(eingabe: StandEingabe): { stand: WarteschlangeStand; verworfen: number } {
    const auftraege: WarteschlangeAuftrag[] = [];
    let verworfen = 0;
    for (const eintrag of eingabe.reihe) {
        const ref = eintrag.job.actorRef;
        const auftrag = auftragImStand(
            eintrag,
            eingabe.haengt?.(eintrag.umgebung, eintrag.job.id) ?? null,
            ref === null ? null : (eingabe.name?.(eintrag.umgebung, ref) ?? null),
        );
        if (Value.Check(WarteschlangeAuftrag, auftrag)) auftraege.push(auftrag);
        else verworfen += 1;
    }
    const { pause } = eingabe;
    const stand: WarteschlangeStand = {
        schema: 1,
        at: new Date(eingabe.nowMs).toISOString(),
        dirigent: {
            instanz: eingabe.dirigent.instanz.slice(0, 80),
            release: kuerzen(eingabe.dirigent.release, 80),
            taktS: eingabe.dirigent.taktS,
        },
        pause: {
            ...pause,
            by: kuerzen(pause.by, 64),
            byLabel: kuerzen(pause.byLabel, 80),
            reason: kuerzen(pause.reason, 300),
        },
        umgebungen: eingabe.umgebungen.map((quelle) => ({ ...quelle })),
        auftraege,
    };
    if (leseWarteschlangeStand(stand) === null) throw new Error("Der Stand der Warteschlange verletzt seinen Vertrag");
    return { stand, verworfen };
}

async function schreiben(pfad: string, text: string): Promise<void> {
    await writeFile(pfad, text, { mode: 0o644 });
    await chmod(pfad, 0o644);
}

/** Schreibt den Stand atomar nach `pfad` (temporäre Datei daneben, dann umbenennen); legt ein fehlendes Verzeichnis an. */
export async function schreibeStand(pfad: string, stand: WarteschlangeStand): Promise<void> {
    const vorlaeufig = `${pfad}.${String(process.pid)}.tmp`;
    const text = `${JSON.stringify(stand)}\n`;
    try {
        await schreiben(vorlaeufig, text);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await mkdir(dirname(pfad), { recursive: true });
        await schreiben(vorlaeufig, text);
    }
    try {
        await rename(vorlaeufig, pfad);
    } catch (error) {
        await rm(vorlaeufig, { force: true });
        throw error;
    }
}
