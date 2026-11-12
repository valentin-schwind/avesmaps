import {
    WIKISYNC_PILLEN_MAX,
    wikisyncPilleGueltig,
    type WikisyncBegriff,
    type WikisyncBegriffAenderung,
    type WikisyncBegriffLage,
    type WikisyncBegriffe,
    type WikisyncBegriffeAbfrage,
    type WikisyncRegelAbfrage,
    type WikisyncRegelBedingung,
    type WikisyncRegelBeziehung,
    type WikisyncRegelListe,
    type WikisyncRegelUebernahme,
    type WikisyncRegelVorschlag,
    type WikisyncRegelZahlen,
} from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { likeMuster } from "../../db/like-muster.ts";
import { ApiError } from "../../http/api-error.ts";
import { isMissingTable } from "../../system/state-row.ts";
import { BEGRIFFE_VORGABE, Begriffstafel, familieVon } from "./begriffe.ts";
import { flaechenSeitLaufGeaendert } from "./flaechen.ts";
import { ladeBegriffeAbweichungen } from "./laden.ts";

/**
 * Lesen der Regelvorschläge und der Begriffstafel für die Fenster des WikiSync, und das Schreiben der Begriffstafel (WI-0253 Scheibe Regelvorschläge, §24). Die Vorschläge sind das Protokoll des jüngsten
 * Laufs der Vorschau mit dem Bereich `vorkommen` (`wikisync_regel_vorschlag`); gerechnet wird hier nichts.
 */

type Zeile = Record<string, unknown>;

const zeit = (wert: unknown): string | null => (wert instanceof Date ? wert.toISOString() : null);
const text = (wert: unknown): string | null => (typeof wert === "string" && wert !== "" ? wert : null);

const LIMIT_VORGABE = 50;

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Vorschläge
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Payload {
    original: WikisyncRegelVorschlag["original"];
    regeln: (WikisyncRegelBeziehung & {
        bisherIds?: string[];
        bisherSchluessel?: string[];
        schluessel?: string | null;
    })[];
}

/**
 * Eine Bedingung, wie die Schnittstelle sie führt: nur die Felder des Schemas. Das Protokoll trägt mehr (die Fläche mit ihrer Nummer in der Datenbank, für die Übernahme); stünde das in
 * der Antwort, verwürfe Fastifys Serialisierer an der Union `nullable(Fläche)` mit strengem Schema die ganze Liste mit 500 (Stage 2026-10-27, erste echte Ableitung). Auch der Vorschlag am Eintrag
 * (`inhalte/vorkommen-regeln-lesen.ts`, Reiter „Vorkommen“) liest das Protokoll nur über diese Funktion.
 */
export function bedingungAus(b: WikisyncRegelBedingung): WikisyncRegelBedingung {
    const f = b.flaeche;
    return {
        verknuepfung: b.verknuepfung,
        flaeche:
            f === null
                ? null
                : { name: f.name, kennung: f.kennung, offen: f.offen, titel: f.titel, kandidat: f.kandidat },
        arten: b.arten.map((a) => ({ ebene: a.ebene, art: a.art })),
        klima: b.klima === null ? null : { von: b.klima.von, bis: b.klima.bis },
        // Die Lage zu einer Linie (WI-0254) nur aus den Feldern des Schemas und nur, wo es eine gibt: das Feld fehlt sonst (nie `null`), ältere Protokolle kennen es nicht.
        ...(b.lage === undefined
            ? {}
            : {
                  lage: {
                      richtung: b.lage.richtung,
                      orte: b.lage.orte.map((o) => ({ kennung: o.kennung, name: o.name, x: o.x, y: o.y })),
                  },
              }),
        woerter: b.woerter,
        rueckfragen: b.rueckfragen,
    };
}

function vorschlagAus(zeile: Zeile): WikisyncRegelVorschlag {
    const payload = zeile["payload"] as Payload;
    return {
        id: Number(zeile["id"]),
        eintrag: {
            id: String(zeile["eintrag_id"]),
            name: String(zeile["eintrag_name"]),
            art: zeile["art"] as WikisyncRegelVorschlag["eintrag"]["art"],
        },
        artikel: text(zeile["artikel"]),
        typ: zeile["typ"] as WikisyncRegelVorschlag["typ"],
        status: zeile["status"] as WikisyncRegelVorschlag["status"],
        wartet: zeile["wartet"] === true,
        vorgewaehlt: zeile["vorgewaehlt"] === true,
        waehlbar: zeile["waehlbar"] === true,
        sperre: text(zeile["sperre"]),
        original: payload.original,
        regeln: payload.regeln.map((regel) => ({
            beziehung: regel.beziehung,
            status: regel.status,
            bedingungen: regel.bedingungen.map(bedingungAus),
            bisher: regel.bisher?.map(bedingungAus) ?? null,
            teile: regel.teile.map((t) => ({ beziehung: t.beziehung, text: t.text, grund: t.grund, art: t.art })),
            bisherId: regel.bisherIds?.[0] ?? null,
        })),
    };
}

/** Die Übernahmen von Regeln, die jüngsten zuerst (jede mit dem Zurücknehmen). */
export async function leseRegelUebernahmen(db: Queryable, limit = 8): Promise<WikisyncRegelUebernahme[]> {
    try {
        const zeilen = await db<Zeile[]>`
            SELECT u.id::int AS id, u.created_at, COALESCE(p.display_name, u.actor_label) AS wer, u.zurueckgenommen_am,
                   (SELECT count(*)::int FROM wikisync_regel_uebernahme_zeile z WHERE z.uebernahme_id = u.id AND z.angelegt_rule_id IS NOT NULL) AS regeln,
                   (SELECT COALESCE(sum(cardinality(z.stillgelegt_rule_ids)), 0)::int FROM wikisync_regel_uebernahme_zeile z WHERE z.uebernahme_id = u.id) AS stillgelegt
              FROM wikisync_regel_uebernahme u LEFT JOIN avesmaps_auth.person p ON p.id = u.actor_person_id
             ORDER BY u.id DESC LIMIT ${limit}
        `;
        return zeilen.map((zeile) => ({
            id: Number(zeile["id"]),
            am: zeit(zeile["created_at"]) ?? "",
            von: text(zeile["wer"]),
            regeln: Number(zeile["regeln"]),
            stillgelegt: Number(zeile["stillgelegt"]),
            zurueckgenommenAm: zeit(zeile["zurueckgenommen_am"]),
        }));
    } catch (error) {
        if (isMissingTable(error)) return [];
        throw error;
    }
}

const leereFacetten = (): WikisyncRegelListe["facetten"] => ({ art: {}, typ: {}, status: {} });

/** Die Regelvorschläge des jüngsten fertigen Laufs mit Filter, Freitext, Zahl am Wert und Seite. Ohne Lauf: eine leere Antwort (unbekannt ist nicht null). */
export async function leseRegelListe(
    db: Queryable,
    abfrage: WikisyncRegelAbfrage,
    jetzt: Date,
): Promise<WikisyncRegelListe> {
    const limit = abfrage.limit ?? LIMIT_VORGABE;
    const offset = abfrage.offset ?? 0;
    let lauf: Zeile | undefined;
    try {
        [lauf] = await db<Zeile[]>`
            SELECT l.id::int AS id, l.beendet_am, l.dump_stand, r.begriffe_revision::int AS begriffe_revision, r.zahlen
              FROM wikisync_lauf l JOIN wikisync_regel_lauf r ON r.lauf_id = l.id
             WHERE l.status = 'fertig'
             ORDER BY l.id DESC LIMIT 1
        `;
    } catch (error) {
        if (!isMissingTable(error)) throw error;
    }
    const uebernahmen = await leseRegelUebernahmen(db);
    if (lauf === undefined) {
        return {
            jetzt: jetzt.toISOString(),
            lauf: null,
            zahlen: null,
            gesamt: 0,
            offset,
            limit,
            facetten: leereFacetten(),
            vorgewaehlt: [],
            vorschlaege: [],
            uebernahmen,
        };
    }
    const laufId = Number(lauf["id"]);
    const heute = (await ladeBegriffeAbweichungen(db)).revision;
    const flaechenGeaendert = await flaechenSeitLaufGeaendert(
        db,
        lauf["beendet_am"] instanceof Date ? lauf["beendet_am"] : null,
    );
    const gerechnet = lauf["begriffe_revision"] === null ? null : Number(lauf["begriffe_revision"]);
    const muster =
        abfrage.q === undefined || abfrage.q.trim() === "" ? null : likeMuster(abfrage.q.trim().toLowerCase());
    const nachArt = abfrage.art === undefined ? db`` : db`AND v.art = ${abfrage.art}`;
    const nachTyp = abfrage.typ === undefined ? db`` : db`AND v.typ = ${abfrage.typ}`;
    const nachStatus = abfrage.status === undefined ? db`` : db`AND v.status = ${abfrage.status}`;
    const nachText = muster === null ? db`` : db`AND v.suchtext LIKE ${muster} ESCAPE '\\'`;
    const filter = db`${nachArt} ${nachTyp} ${nachStatus} ${nachText}`;

    const [zaehlung] = await db<{ gesamt: number }[]>`
        SELECT count(*)::int AS gesamt FROM wikisync_regel_vorschlag v WHERE v.lauf_id = ${laufId} ${filter}
    `;
    const zeilen = await db<Zeile[]>`
        SELECT v.id::int AS id, e.public_id::text AS eintrag_id, v.eintrag_name, v.art, v.artikel, v.typ, v.status, v.wartet, v.vorgewaehlt, v.waehlbar, v.sperre, v.payload
          FROM wikisync_regel_vorschlag v JOIN lore_entry e ON e.id = v.lore_entry_id
         WHERE v.lauf_id = ${laufId} ${filter}
         ORDER BY v.waehlbar DESC, v.position
         LIMIT ${limit} OFFSET ${offset}
    `;
    // Die Zahl am Wert: eingeschränkt durch die anderen Filter, nicht durch den eigenen.
    const facette = async (spalte: "art" | "typ" | "status"): Promise<Record<string, number>> => {
        const ohne = {
            art: spalte === "art" ? db`` : nachArt,
            typ: spalte === "typ" ? db`` : nachTyp,
            status: spalte === "status" ? db`` : nachStatus,
        };
        const reihen = await db<{ wert: string; anzahl: number }[]>`
            SELECT v.${db(spalte)} AS wert, count(*)::int AS anzahl
              FROM wikisync_regel_vorschlag v
             WHERE v.lauf_id = ${laufId} ${ohne.art} ${ohne.typ} ${ohne.status} ${nachText}
             GROUP BY v.${db(spalte)}
        `;
        return Object.fromEntries(reihen.map((reihe) => [reihe.wert, reihe.anzahl]));
    };
    const vorgewaehlt = await db<{ id: number }[]>`
        SELECT id::int AS id FROM wikisync_regel_vorschlag WHERE lauf_id = ${laufId} AND vorgewaehlt ORDER BY position
    `;
    return {
        jetzt: jetzt.toISOString(),
        lauf: {
            id: laufId,
            beendetAm: zeit(lauf["beendet_am"]),
            dumpStand: text(lauf["dump_stand"]),
            begriffeRevision: gerechnet,
            veraltet: heute !== null && gerechnet !== heute,
            flaechenGeaendert,
        },
        zahlen: lauf["zahlen"] as WikisyncRegelZahlen,
        gesamt: zaehlung?.gesamt ?? 0,
        offset,
        limit,
        facetten: { art: await facette("art"), typ: await facette("typ"), status: await facette("status") },
        vorgewaehlt: vorgewaehlt.map((zeile) => zeile.id),
        vorschlaege: zeilen.map(vorschlagAus),
        uebernahmen,
    };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Begriffstafel
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const LAGE_REIHENFOLGE: Readonly<Record<WikisyncBegriffLage, number>> = {
    offen: 0,
    neu: 1,
    luecke: 2,
    naeherung: 3,
    gleichwertig: 4,
    uebergehen: 5,
};

/** Die Wörter, die der jüngste Lauf sah, mit der Zahl ihrer Nennungen. */
async function gefundeneWoerter(db: Queryable): Promise<{ lauf: number | null; woerter: Map<string, number> }> {
    try {
        const [lauf] = await db<{ lauf_id: number }[]>`
            SELECT r.lauf_id::int AS lauf_id FROM wikisync_regel_lauf r JOIN wikisync_lauf l ON l.id = r.lauf_id WHERE l.status = 'fertig' ORDER BY r.lauf_id DESC LIMIT 1
        `;
        if (lauf === undefined) return { lauf: null, woerter: new Map() };
        const zeilen = await db<
            { wort: string; anzahl: number }[]
        >`SELECT wort, anzahl FROM wikisync_regel_wort WHERE lauf_id = ${lauf.lauf_id}`;
        return { lauf: lauf.lauf_id, woerter: new Map(zeilen.map((zeile) => [zeile.wort, zeile.anzahl])) };
    } catch (error) {
        if (isMissingTable(error)) return { lauf: null, woerter: new Map() };
        throw error;
    }
}

/**
 * Die Zahl der Nennungen einer Familie. Hat der jüngste Lauf eine ihrer Formen gesehen, zählen die Nennungen des Laufs (eine nicht gesehene Form zählt null); sonst die Zählung der Analyse bei den
 * Startwerten; `null`, wo beides fehlt (ein von Hand angelegtes Wort, das der Lauf nicht sah).
 */
function nennungen(formen: readonly string[], lauf: ReadonlyMap<string, number>): number | null {
    if (formen.some((form) => lauf.has(form))) return formen.reduce((summe, form) => summe + (lauf.get(form) ?? 0), 0);
    const analyse = formen.flatMap((form) => BEGRIFFE_VORGABE.get(form)?.gesehen ?? []);
    return analyse.length === 0 ? null : analyse.reduce((summe, n) => summe + n, 0);
}

/**
 * Die Begriffstafel: jede Familie der Startwerte (ein Kopfwort mit seinen Formen) und jedes von Hand angelegte Wort, dazu die gefundenen Wörter ohne Zuweisung (aus dem jüngsten Lauf). Eine
 * Familie ist EINE Zeile: Entscheidung, Pillen und Marke gelten für alle Formen, die Zahl der Nennungen ist die Summe. Ein Wort ohne Pille, das entschieden werden muss (mehrdeutig), steht vorn.
 */
export async function leseBegriffe(
    db: Queryable,
    abfrage: WikisyncBegriffeAbfrage,
    jetzt: Date,
): Promise<WikisyncBegriffe> {
    const limit = abfrage.limit ?? 100;
    const offset = abfrage.offset ?? 0;
    const filter = abfrage.filter ?? "alle";
    const { revision, abweichungen, geaendert } = await ladeBegriffeAbweichungen(db, true);
    const tafel = new Begriffstafel(abweichungen);
    const gefunden = await gefundeneWoerter(db);
    const zeilen = new Map<string, WikisyncBegriff>();
    for (const { kopf: eintrag, formen } of tafel.familien()) {
        // Wer die Zeile zuletzt änderte: unter dem Kopfwort, sonst unter einer älteren Zeile einer anderen Form.
        const wer =
            geaendert.get(eintrag.wort) ??
            formen.map((form) => geaendert.get(form)).find((einer) => einer !== undefined);
        zeilen.set(eintrag.wort, {
            wort: eintrag.wort,
            formen: [...formen],
            pillen: [...eintrag.pillen],
            startwert: [...(eintrag.vorgabe?.pillen ?? [])],
            lage: eintrag.lage,
            eigen: eintrag.eigen,
            gesehen: nennungen(formen, gefunden.woerter),
            hinweis: eintrag.vorgabe?.hinweis ?? null,
            geaendertAm: eintrag.eigen ? (wer?.am ?? null) : null,
            geaendertVon: eintrag.eigen ? (wer?.von ?? null) : null,
        });
    }
    for (const [wort, n] of gefunden.woerter) {
        if (zeilen.has(wort) || tafel.eintrag(wort) !== undefined || tafel.abbildung(wort) !== undefined) continue;
        zeilen.set(wort, {
            wort,
            formen: [wort],
            pillen: [],
            startwert: [],
            lage: "neu",
            eigen: false,
            gesehen: n,
            hinweis: null,
            geaendertAm: null,
            geaendertVon: null,
        });
    }
    const alle = [...zeilen.values()];
    const passt = (eintrag: WikisyncBegriff, art: string): boolean =>
        art === "alle" ||
        (art === "offen" && eintrag.lage === "offen" && eintrag.pillen.length === 0) ||
        (art === "ohne" && eintrag.pillen.length === 0) ||
        (art === "zugewiesen" && eintrag.pillen.length > 0) ||
        (art === "eigen" && eintrag.eigen);
    const suche = (abfrage.q ?? "").trim().toLowerCase();
    // Die Suche findet eine Familie auch über jede ihrer Formen.
    const nachSuche =
        suche === "" ? alle : alle.filter((eintrag) => eintrag.formen.some((form) => form.includes(suche)));
    const zahlen: Record<string, number> = {};
    for (const art of ["alle", "offen", "ohne", "zugewiesen", "eigen"])
        zahlen[art] = nachSuche.filter((eintrag) => passt(eintrag, art)).length;
    const treffer = nachSuche
        .filter((eintrag) => passt(eintrag, filter))
        .sort(
            (a, b) =>
                (a.pillen.length === 0 && a.lage === "offen" ? 0 : 1) -
                    (b.pillen.length === 0 && b.lage === "offen" ? 0 : 1) ||
                LAGE_REIHENFOLGE[a.lage] - LAGE_REIHENFOLGE[b.lage] ||
                (b.gesehen ?? -1) - (a.gesehen ?? -1) ||
                (a.wort < b.wort ? -1 : a.wort > b.wort ? 1 : 0),
        );
    return {
        jetzt: jetzt.toISOString(),
        revision: revision ?? 0,
        quelle: revision === null ? "vorgabe" : "datenbank",
        gesamt: treffer.length,
        offset,
        limit,
        zahlen,
        lauf: gefunden.lauf,
        woerter: treffer.slice(offset, offset + limit),
    };
}

export const KANON_BEGRIFFE_SPERRE = "wikisync_begriffe:schreiben";

export interface BegriffeAendern {
    aenderungen: readonly WikisyncBegriffAenderung[];
    baseRevision: number;
    actor: { personId: string | null; label: string };
    conflict?: (current: { revision: number; changedAt: Date }) => Promise<ApiError>;
}

const ungueltig = (wort: string, grund: string): ApiError =>
    new ApiError(400, "validation_failed", "Dieses Wort der Begriffstafel ist nicht gültig.", {
        field: "pillen",
        reason: grund,
        row: wort,
    });

const gleich = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((pille) => b.includes(pille));

/**
 * Ändert Wörter der Begriffstafel, in der Transaktion des Aufrufers. Jedes Wort einer Familie wird angenommen und unter dem Kopfwort der Familie gespeichert (eine Entscheidung gilt für alle Formen;
 * zwei Formen derselben Familie in einer Anfrage sind `doppelt`). Eine Zeile, die dem Startwert gleicht, wird nie gespeichert (und eine vorhandene gelöscht); ein Wort ohne Startwert und ohne Pille
 * entfällt. Ältere Zeilen unter einer anderen Form derselben Familie fallen beim Schreiben weg, damit sie nach einem Zurücksetzen nicht wieder gelten. Ungültige Pille 400 `validation_failed`;
 * veraltet 409 `edit_conflict`; nichts geändert 409 `no_change`. Liefert die Kopfwörter, die sich änderten, und die neue Revision.
 */
export async function aendereBegriffe(
    tx: Queryable,
    eingabe: BegriffeAendern,
): Promise<{ geaendert: string[]; revision: number }> {
    const gesehen = new Set<string>();
    for (const aenderung of eingabe.aenderungen) {
        const wort = aenderung.wort;
        const kopf = familieVon(wort);
        if (wort !== wort.toLowerCase() || gesehen.has(kopf))
            throw ungueltig(wort, gesehen.has(kopf) ? "doppelt" : "wort_ungueltig");
        gesehen.add(kopf);
        if (aenderung.zuruecksetzen !== true) {
            if (aenderung.pillen === undefined) throw ungueltig(wort, "pillen_fehlen");
            if (aenderung.pillen.length > WIKISYNC_PILLEN_MAX) throw ungueltig(wort, "zu_viele_pillen");
            if (!aenderung.pillen.every((pille) => wikisyncPilleGueltig(pille)))
                throw ungueltig(wort, "pille_unbekannt");
        }
    }
    await tx`SELECT pg_advisory_xact_lock(hashtext(${KANON_BEGRIFFE_SPERRE}))`;
    const [stand] = await tx<{ revision: number; updated_at: Date }[]>`
        SELECT revision::int AS revision, updated_at FROM wikisync_begriff_state WHERE id = 1
    `;
    if (stand === undefined) {
        throw new ApiError(503, "begriffe_unprovisioned", "Die Begriffstafel fehlt noch in dieser Umgebung.");
    }
    if (stand.revision !== eingabe.baseRevision) {
        throw eingabe.conflict
            ? await eingabe.conflict({ revision: stand.revision, changedAt: stand.updated_at })
            : new ApiError(
                  409,
                  "edit_conflict",
                  "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
              );
    }
    const bisher = new Map(
        (await tx<{ wort: string; pillen: string[] }[]>`SELECT wort, pillen FROM wikisync_begriff_setting`).map(
            (zeile) => [zeile.wort, zeile.pillen],
        ),
    );
    const geaendert: string[] = [];
    for (const aenderung of eingabe.aenderungen) {
        // Gespeichert wird unter dem Kopfwort der Familie; ältere Zeilen unter einer anderen Form derselben Familie räumt das Schreiben ab.
        const wort = familieVon(aenderung.wort);
        const aeltere = [...bisher.keys()].filter((zeile) => zeile !== wort && familieVon(zeile) === wort);
        const startwert = BEGRIFFE_VORGABE.get(wort)?.pillen ?? null;
        const soll = aenderung.zuruecksetzen === true ? null : [...new Set(aenderung.pillen ?? [])];
        // Eine Zeile gleicht dem Startwert (oder gibt es bei einem fremden Wort nichts zu sagen): Sie entfällt.
        const entfaellt = soll === null || (startwert !== null ? gleich(soll, startwert) : soll.length === 0);
        const da = bisher.get(wort);
        const raeumeAb = async (): Promise<void> => {
            for (const zeile of aeltere) await tx`DELETE FROM wikisync_begriff_setting WHERE wort = ${zeile}`;
        };
        if (entfaellt) {
            if (da === undefined && aeltere.length === 0) continue;
            if (da !== undefined) await tx`DELETE FROM wikisync_begriff_setting WHERE wort = ${wort}`;
            await raeumeAb();
            geaendert.push(wort);
            continue;
        }
        if (da !== undefined && gleich(da, soll)) continue;
        // Je Wort genau eine Anweisung ohne ON CONFLICT: Der Trigger hebt die Revision je Anweisung, und ein Upsert löste ihn für INSERT und UPDATE aus.
        if (da === undefined) {
            await tx`
                INSERT INTO wikisync_begriff_setting (wort, pillen, changed_at, changed_by, changed_by_label)
                VALUES (${wort}, ${soll}::text[], now(), ${eingabe.actor.personId}::uuid, ${eingabe.actor.label})
            `;
        } else {
            await tx`
                UPDATE wikisync_begriff_setting
                   SET pillen = ${soll}::text[], changed_at = now(), changed_by = ${eingabe.actor.personId}::uuid, changed_by_label = ${eingabe.actor.label}
                 WHERE wort = ${wort}
            `;
        }
        await raeumeAb();
        geaendert.push(wort);
    }
    if (geaendert.length === 0) throw new ApiError(409, "no_change", "Die Begriffstafel steht schon so.");
    const [neu] = await tx<
        { revision: number }[]
    >`SELECT revision::int AS revision FROM wikisync_begriff_state WHERE id = 1`;
    return { geaendert, revision: (neu as { revision: number }).revision };
}
