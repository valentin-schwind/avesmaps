import type { WikiBoxArt, WikiBoxStand, WikiBoxSyncGrund } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { wikisyncBereiche } from "../abgleich/schalter-lesen.ts";
import { wikiAbrufErlaubt } from "../config.ts";
import { titelAusWikiAdresse } from "../vorschau/adresse.ts";
import type { Anschluss, BoxObjekt } from "./anschluss.ts";
import { gebietAnschluss } from "./gebiet.ts";
import { gipfelAnschluss } from "./gipfel.ts";
import { kraftlinieAnschluss } from "./kraftlinie.ts";
import { ortAnschluss } from "./ort.ts";
import { regionAnschluss } from "./region.ts";
import { wegAnschluss } from "./weg.ts";
import { leseObjektStand } from "./stand.ts";

/**
 * Die Wiki-Box am Server (WI-0253): die sechs Anschlüsse (Ort, Weg, Gebiet, Landschaft, Kraftlinie, Gipfel) und der Stand, den die Box zeigt. Die Routen (`routes/editor-wiki-box.ts`) sind dünn; was sie lesen und prüfen, steht hier.
 */

export const ANSCHLUESSE: Readonly<Record<WikiBoxArt, Anschluss | undefined>> = {
    ort: ortAnschluss,
    weg: wegAnschluss,
    gebiet: gebietAnschluss,
    region: regionAnschluss,
    kraftlinie: kraftlinieAnschluss,
    gipfel: gipfelAnschluss,
};

/** Wartet oder läuft ein Sync dieses Objekts? Der Auftrag trägt das Objekt in seiner Eingabe. */
export async function syncLaeuft(db: Queryable, objekt: BoxObjekt): Promise<boolean> {
    const [zeile] = await db<{ n: number }[]>`
        SELECT count(*)::int AS n FROM job
         WHERE kind = 'wiki_artikel' AND state IN ('QUEUED', 'RUNNING') AND input_ref #>> '{objekt,id}' = ${objekt.id}
    `;
    return (zeile?.n ?? 0) > 0;
}

/** Der Titel des Artikels im Wiki, mit dem der Sync fragt; `null`, wenn die Adresse keine des Wikis ist. */
export const syncTitel = (objekt: BoxObjekt): string | null =>
    objekt.artikel === null ? null : titelAusWikiAdresse(objekt.artikel.url);

/**
 * Darf der Sync jetzt angestoßen werden? Die erste Absage gewinnt, in der Reihenfolge der Fragen: Hängt ein Artikel am Objekt? Hat er einen Wiki-Stand und eine Adresse des Wikis? Darf diese Umgebung das
 * Wiki fragen (lokal nie)? Gehört der Bereich in dieser Umgebung dem WikiSync?
 */
export async function syncGrund(
    db: Queryable,
    objekt: BoxObjekt,
    umgebung: NodeJS.ProcessEnv,
): Promise<WikiBoxSyncGrund | undefined> {
    if (objekt.artikel === null) return "kein_artikel";
    if (!objekt.mitStand || syncTitel(objekt) === null) return "kein_stand";
    if (!wikiAbrufErlaubt(umgebung).erlaubt) return "abruf_gesperrt";
    if (!(await wikisyncBereiche(db)).has(objekt.art)) return "gehoert_legacy";
    return undefined;
}

/** Der Stand der Box: das Objekt mit seinem Artikel, der Stand des letzten Syncs und ob und warum der Sync möglich ist. */
export async function leseBoxStand(
    db: Queryable,
    objekt: BoxObjekt,
    umgebung: NodeJS.ProcessEnv,
): Promise<WikiBoxStand> {
    const weitere = ANSCHLUESSE[objekt.art]?.weitere;
    const [grund, laeuft, stand, weitereArtikel] = await Promise.all([
        syncGrund(db, objekt, umgebung),
        syncLaeuft(db, objekt),
        leseObjektStand(db, objekt.art, objekt.ids),
        weitere?.lies(db, objekt),
    ]);
    return {
        art: objekt.art,
        id: objekt.id,
        name: objekt.name,
        artikel: objekt.artikel,
        ...(objekt.anteil === undefined ? {} : { anteil: objekt.anteil }),
        sync: {
            moeglich: grund === undefined,
            ...(grund === undefined ? {} : { grund }),
            laeuft,
            letzter: stand.letzter,
            fehler: stand.fehler,
        },
        // Nur der Weg trägt weitere Artikel (WI-0300).
        ...(weitereArtikel === undefined ? {} : { weitere: weitereArtikel }),
    };
}
