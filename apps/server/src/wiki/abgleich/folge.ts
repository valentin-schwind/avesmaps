import { AVENTURIA, wikisyncHatKategorien, type WikisyncBereich } from "@avesmaps3d/shared";
import type { Database } from "../../database.ts";

/**
 * Die Folge eines verketteten Laufs (WI-0253 §20, „Variante A“; Vali 2026-10-26: „ich finde den workflow etwas kompliziert“).
 *
 * „WikiSync starten“ reiht EINEN Auftrag ein, die Vorschau mit `folge: { bereiche }`. Aus den vorhandenen Auftragsarten (keine neue) verkettet sich der Rest selbst:
 *
 *     wiki_vorschau  ──►  wiki_uebernehmen (alle Bereiche der Folge, sofort)
 *
 * - **Seit WI-0294 gibt es keinen Wiki-Teil mehr:** Ortsgröße, Bauwerkart und Kontinent rechnet die Vorschau selbst aus der Kategorien-Datei. Ein Bereich mit Kategorien wird nur übernommen, wenn die
 *   Vorschau eine Datei gelesen hat (`kategorienFertig`, `pruefeUebernahme`); fehlt sie, wird seine Übernahme gar nicht erst eingereiht (`ausstehend`), und es entsteht kein abgelehnter Protokolleintrag.
 * - **Die Übernahme ist ein eigener Auftrag für alle Bereiche der Folge** (schwer, `exclusivePairs`): Läuft ein Legacy-Zug, wartet sie hinter ihm (`wartetAuf: "legacy_zug"`).
 * - **Einreihen ist idempotent** (`reiheUebernahmenEin`): Wer schon übernommen wurde oder in der Warteschlange steht, wird nicht noch einmal eingereiht. So darf ein Auftrag, der nach einem Absturz
 *   von vorn beginnt, die Folge noch einmal ansehen, ohne einen Bereich zweimal zu übernehmen.
 * - Die Auslöserin bleibt dieselbe Person (`actor_ref` des Auftrags), und die Auftragsarten bleiben, was sie waren: Die Folge ist nur ein Feld in der Eingabe.
 */
export interface Folge {
    /** Die Bereiche, die nach der Vorschau übernommen werden sollen. */
    bereiche: WikisyncBereich[];
}

/** Der Auftrag der Übernahme, wie die Route der Steuerung ihn einreiht (`scope_kind = 'tiles'` ohne Kacheln: kein Kartenfußabdruck, die Operation nimmt die Domänensperre selbst). */
export const UEBERNAHME_ART = "wiki_uebernehmen";

/**
 * Reiht die Übernahme der genannten Bereiche aus der Vorschau `vorschauLauf` EIN, soweit sie nicht schon übernommen wurden und kein Auftrag dafür wartet oder läuft. Liefert die Bereiche, die
 * wirklich eingereiht wurden (leer: nichts zu tun). Die Prüfung und das Einreihen stehen in EINER Transaktion unter einer Sperre, damit zwei Aufträge einer Reihe nie denselben Bereich zweimal einreihen.
 *
 * 🔴 Das Einreihen prüft nicht, ob der Bereich übernommen werden DARF: Das tut der Auftrag unter der Sperre noch einmal (`pruefeUebernahme`) und hält das Ergebnis im Protokoll fest, auch eine Ablehnung.
 */
export async function reiheUebernahmenEin(
    db: Database,
    args: {
        vorschauLauf: number;
        bereiche: readonly WikisyncBereich[];
        actorRef: string | null;
        domain?: string | null;
    },
): Promise<WikisyncBereich[]> {
    if (args.bereiche.length === 0) return [];
    return db.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext('wikisync:folge'))`;
        const offen: WikisyncBereich[] = [];
        for (const bereich of args.bereiche) {
            const [zeile] = await tx<{ da: boolean }[]>`
                SELECT EXISTS (
                           SELECT 1 FROM wikisync_uebernahme WHERE lauf_id = ${args.vorschauLauf} AND bereich = ${bereich} AND art = 'uebernahme'
                       )
                       OR EXISTS (
                           SELECT 1 FROM job
                            WHERE kind = ${UEBERNAHME_ART} AND state IN ('QUEUED', 'RUNNING')
                              AND (input_ref ->> 'lauf')::bigint = ${args.vorschauLauf}
                              AND input_ref -> 'bereiche' @> to_jsonb(${bereich}::text)
                       ) AS da
            `;
            if (zeile?.da !== true) offen.push(bereich);
        }
        if (offen.length === 0) return [];
        await tx`
            SELECT public_id
              FROM job_enqueue(
                       ${UEBERNAHME_ART}, 1::smallint, ${args.domain ?? AVENTURIA.mapDomain}, ${args.actorRef},
                       ${tx.json({ bereiche: offen, lauf: args.vorschauLauf } as never)}::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[]
                   )
        `;
        return offen;
    });
}

/**
 * Was die Vorschau eines verketteten Laufs nach ihrem Ende einreiht: die Übernahme aller Bereiche der Folge aus `vorschauLauf`. Die Bereiche mit Kategorien nur, wenn die Vorschau eine Kategorien-Datei
 * gelesen hat; sonst stehen sie aus (`ausstehend`) und werden nicht eingereiht. Liefert, was eingereiht wurde und was aussteht.
 */
export async function reiheFolgeNachVorschauEin(
    db: Database,
    args: {
        vorschauLauf: number;
        folge: Folge;
        actorRef: string | null;
        ausgeloestVon: string | undefined;
        mapDomainId: string | null;
    },
): Promise<{ uebernahme: WikisyncBereich[]; ausstehend: WikisyncBereich[] }> {
    const domain = args.mapDomainId ?? AVENTURIA.mapDomain;
    const [pin] = await db<{ da: boolean }[]>`
        SELECT kategorien_sha256 IS NOT NULL AS da FROM wikisync_lauf WHERE id = ${args.vorschauLauf}
    `;
    const mitDatei = pin?.da === true;
    const ausstehend = mitDatei ? [] : args.folge.bereiche.filter((bereich) => wikisyncHatKategorien(bereich));
    const uebernahme = await reiheUebernahmenEin(db, {
        vorschauLauf: args.vorschauLauf,
        bereiche: args.folge.bereiche.filter((bereich) => !ausstehend.includes(bereich)),
        actorRef: args.actorRef,
        domain,
    });
    return { uebernahme, ausstehend };
}
