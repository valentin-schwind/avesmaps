import {
    gleichDemWiki,
    quellenWikiNormal,
    type InhalteTraegerQuelle,
    type MapHistoryEntry,
    type MapHistoryObject,
    type SourceReferenceKind,
} from "@avesmaps3d/shared";
import type { Handlung } from "./traeger-quellen-modell";

/**
 * Die Änderungen an den Quellen eines Kartenobjekts im Verlauf (WI-0254 §12), ohne Vue. Der Schreibweg `traeger.sources` protokolliert am Objekt einen Eintrag `<art>.sources_changed` ohne Revision, mit
 * `changes.quellen = { before: [...], after: [...] }`: je geänderter Verknüpfung Quelle, Titel, Zustand und die drei Angaben vorher und nachher (Zustand `none`: Es gab noch keine Verknüpfung).
 *
 * - **Lesbare Zeilen:** Aus einem Eintrag werden Zeilen „Quelle „Titel“ angehängt“, „… geändert: Seiten 12 → 14“, „… gelöst“, „… zurückgeholt“ (`quellenZeilen`; den Text setzt die Anzeige).
 * - **↺ steht nur an der jüngsten Zeile einer Quelle** (`juengsteJeQuelle`).
 * - **↺ ist die Umkehrung über denselben Schreibweg** (`umkehrung`): Angehängt und zurückgeholt wird gelöst, gelöst wird zurückgeholt, geändert geht auf die Angaben von vorher. Sie ist nur frei, solange der heutige Stand der
 *   Verknüpfung dem „nachher“ des Eintrags gleicht (Zustand und Art, Seiten, Notiz nach `gleichDemWiki`); steht sie seitdem anders da, geht ↺ nicht, denn es überschriebe, was jemand danach getan hat.
 */

/** Die Aktion, unter der der Schreibweg am Objekt protokolliert (`place`, `territory`, `region`). */
const AKTION = /\.sources_changed$/u;

/** Ein Gegenstand einer Operation ist die Änderung an Quellen eines Objekts. */
export const istQuellenGegenstand = (gegenstand: Pick<MapHistoryObject, "action">): boolean =>
    AKTION.test(gegenstand.action);

/** Die Kennung eines Objekts im Fachprotokoll, oder mehrere: beim Weg trägt jeder Abschnitt der Straße eine (die Operation hängt an einem von ihnen). */
export type Kennungen = string | readonly string[];

/** Unter welchen Kennungen das Objekt eines Ziels im Fachprotokoll stehen kann: `ids`, sonst `id`; `undefined` ohne Ziel. */
export const protokollKennungen = (
    ziel: { readonly id: string; readonly ids?: readonly string[] | undefined } | undefined,
): Kennungen | undefined => (ziel === undefined ? undefined : (ziel.ids ?? ziel.id));

const gehoertZu = (id: string, kennungen: Kennungen | undefined): boolean =>
    kennungen === undefined || (typeof kennungen === "string" ? id === kennungen : kennungen.includes(id));

/**
 * Besteht der Eintrag aus Änderungen an Quellen (und nur aus solchen)? Dann nimmt der Quellen-Verlauf ihn zurück, nicht die Rücknahme des Objekts.
 * Die Katalogquelle selbst (`kind = source`) zählt dabei nicht: Ändert der Reiter „Quellen“ die Quelle eines Wegs, schreibt dieselbe Operation `source.updated` an der Quelle und
 * `path.sources_changed` an der Straße (`quellen-schreiben.ts`); im Verlauf der Straße ist das eine Änderung an ihren Quellen, die Quelle ist nur die Gegenseite.
 */
export const istQuellenEintrag = (eintrag: Pick<MapHistoryEntry, "objects">): boolean => {
    const objekte = eintrag.objects.filter((gegenstand) => gegenstand.kind !== "source");
    return objekte.length > 0 && objekte.every(istQuellenGegenstand);
};

/** Der Zustand einer Verknüpfung im Protokoll: wie die Antwort des Servers, dazu `none` für „gab es noch nicht“. */
export interface QuellenStand {
    readonly state: "none" | "active" | "retired" | "suppressed";
    readonly referenceKind: SourceReferenceKind | null;
    readonly pages: string | null;
    readonly note: string | null;
}

export type QuellenWechsel = "angehaengt" | "geaendert" | "geloest" | "zurueckgeholt";

export interface QuellenZeile {
    /** Eindeutig im Verlauf: Operation und Quelle. */
    readonly schluessel: string;
    readonly operationId: string;
    readonly sourceId: string;
    readonly titel: string;
    readonly wechsel: QuellenWechsel;
    readonly vorher: QuellenStand;
    readonly nachher: QuellenStand;
}

const ZUSTAENDE = ["none", "active", "retired", "suppressed"] as const;
const text = (wert: unknown): string | null => (typeof wert === "string" ? wert : null);

function stand(roh: unknown): QuellenStand | undefined {
    if (roh === null || typeof roh !== "object") return undefined;
    const r = roh as Record<string, unknown>;
    const zustand = ZUSTAENDE.find((z) => z === r["state"]);
    if (zustand === undefined) return undefined;
    return {
        state: zustand,
        referenceKind: text(r["referenceKind"]) as SourceReferenceKind | null,
        pages: text(r["pages"]),
        note: text(r["note"]),
    };
}

/** Was aus vorher und nachher einer Verknüpfung wurde. */
export function wechselVon(vorher: QuellenStand, nachher: QuellenStand): QuellenWechsel {
    if (vorher.state === "none") return "angehaengt";
    if (vorher.state === "active" && nachher.state !== "active") return "geloest";
    if (vorher.state !== "active" && nachher.state === "active") return "zurueckgeholt";
    return "geaendert";
}

/**
 * Die Zeilen eines Eintrags: eine je geänderter Verknüpfung, in der Folge des Protokolls. Mit `traegerId` nur die des Objekts, dessen Verlauf gezeigt wird (ein Eintrag gehört einem Objekt, aber die Kennung
 * ist die Probe, dass es das richtige ist; beim Weg sind es die Kennungen aller Abschnitte der Straße).
 */
export function quellenZeilen(eintrag: MapHistoryEntry, traegerId?: Kennungen): QuellenZeile[] {
    const zeilen: QuellenZeile[] = [];
    for (const gegenstand of eintrag.objects) {
        if (!istQuellenGegenstand(gegenstand) || !gehoertZu(gegenstand.id, traegerId)) continue;
        const wechsel = gegenstand.changes["quellen"];
        const vorher = Array.isArray(wechsel?.before) ? (wechsel.before as unknown[]) : [];
        const nachher = Array.isArray(wechsel?.after) ? (wechsel.after as unknown[]) : [];
        nachher.forEach((rohNachher, i) => {
            const n = rohNachher as Record<string, unknown> | null;
            const sourceId = text(n?.["sourceId"]);
            const bisher = stand(vorher[i]);
            const jetzt = stand(rohNachher);
            if (sourceId === null || bisher === undefined || jetzt === undefined) return;
            zeilen.push({
                schluessel: `${eintrag.operationId}/${sourceId}`,
                operationId: eintrag.operationId,
                sourceId,
                titel: text(n?.["title"]) ?? "",
                wechsel: wechselVon(bisher, jetzt),
                vorher: bisher,
                nachher: jetzt,
            });
        });
    }
    return zeilen;
}

/**
 * Die jüngste Zeile je Quelle unter den gelesenen Einträgen: Quelle → `schluessel` der Zeile. Jüngst ist die Operation mit der höchsten `seq`. Nur an dieser Zeile steht ↺: Eine ältere Zeile derselben Quelle nähme zurück,
 * was später schon wieder anders wurde, und hätte nur einen Sperrsatz zu sagen. Der Verlauf liest neueste zuerst; eine ältere Seite, die noch nicht gelesen ist, kann die Antwort nicht ändern, denn sie ist älter als alles Gelesene.
 */
export function juengsteJeQuelle(
    eintraege: readonly MapHistoryEntry[],
    traegerId?: Kennungen,
): ReadonlyMap<string, string> {
    const jetzt = new Map<string, { seq: number; schluessel: string }>();
    for (const eintrag of eintraege) {
        for (const zeile of quellenZeilen(eintrag, traegerId)) {
            const bisher = jetzt.get(zeile.sourceId);
            if (bisher === undefined || eintrag.seq > bisher.seq) {
                jetzt.set(zeile.sourceId, { seq: eintrag.seq, schluessel: zeile.schluessel });
            }
        }
    }
    return new Map([...jetzt].map(([sourceId, wert]) => [sourceId, wert.schluessel] as const));
}

/** Ein Wechsel der Angaben einer geänderten Verknüpfung: welches Feld, alt und neu (leer ist `null`). */
export interface QuellenFeldWechsel {
    readonly feld: "seiten" | "art" | "notiz";
    readonly vorher: string | null;
    readonly nachher: string | null;
}

/** Was sich an den Angaben geändert hat, in der Folge Seiten, Art, Notiz. Verglichen wird wie beim Wiki (gekürzt, leer ist nichts). */
export function feldWechsel(vorher: QuellenStand, nachher: QuellenStand): QuellenFeldWechsel[] {
    const raus: QuellenFeldWechsel[] = [];
    const paare = [
        ["seiten", vorher.pages, nachher.pages],
        ["art", vorher.referenceKind, nachher.referenceKind],
        ["notiz", vorher.note, nachher.note],
    ] as const;
    for (const [feld, alt, neu] of paare) {
        if (quellenWikiNormal(alt) !== quellenWikiNormal(neu)) {
            raus.push({ feld, vorher: quellenWikiNormal(alt), nachher: quellenWikiNormal(neu) });
        }
    }
    return raus;
}

/** Der heutige Stand der Verknüpfung in der Form des Protokolls; `none`, wo es sie nicht (mehr) gibt. */
export const standVon = (quelle: InhalteTraegerQuelle | undefined): QuellenStand =>
    quelle === undefined
        ? { state: "none", referenceKind: null, pages: null, note: null }
        : { state: quelle.state, referenceKind: quelle.referenceKind, pages: quelle.pages, note: quelle.note };

/** Gleichen sich zwei Stände (Zustand gleich, Art, Seiten und Notiz nach dem Kürzen)? */
export const gleicherStand = (a: QuellenStand, b: QuellenStand): boolean =>
    a.state === b.state &&
    gleichDemWiki(
        { art: a.referenceKind, seiten: a.pages, notiz: a.note },
        { art: b.referenceKind, seiten: b.pages, notiz: b.note },
    );

/** Was ↺ an einer Zeile täte: die Handlung des Schreibwegs, oder dass die Verknüpfung seitdem anders dasteht. */
export type Umkehrung = { readonly art: "geht"; readonly handlung: Handlung } | { readonly art: "anders" };

export function umkehrung(zeile: QuellenZeile, heute: InhalteTraegerQuelle | undefined): Umkehrung {
    if (!gleicherStand(standVon(heute), zeile.nachher)) return { art: "anders" };
    switch (zeile.wechsel) {
        case "angehaengt":
        case "zurueckgeholt":
            return { art: "geht", handlung: { art: "loesen" } };
        case "geloest":
            return { art: "geht", handlung: { art: "holen" } };
        case "geaendert":
            return {
                art: "geht",
                handlung: {
                    art: "angaben",
                    referenceKind: zeile.vorher.referenceKind,
                    seiten: zeile.vorher.pages,
                    notiz: zeile.vorher.note,
                },
            };
    }
}
