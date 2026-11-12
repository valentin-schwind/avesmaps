import {
    EDITOR_LOCKS_URL,
    EDITOR_LOCK_HEARTBEAT_SECONDS,
    type EditorLock,
    type EditorLockAsked,
    type EditorLockBeatAnswer,
    type EditorLockIncoming,
    type EditorLockKind,
    type EditorLockList,
    type EditorLockPart,
    type EditorLockRequest,
    type EditorLockRequestAnswer,
    type EditorLockTaken,
    type EditorLockTarget,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, postJson, type Fetcher } from "../auth/api";

/**
 * Die Sperre während der Bearbeitung im Browser (EDIT-0003 §4; Vertrag `packages/shared/src/editor-lock.ts`). EIN Baustein für alle
 * Editoren; der erste Nutzer ist „Ecken bearbeiten“ (WI-0178).
 *
 * - **Ein Lauf je Fenster des Browsers** (`lauf`): Dieselbe Person in einem zweiten Fenster übernimmt die Sperre; das erste erfährt es beim
 *   nächsten Herzschlag (`beiVerlust`), sein Entwurf bleibt.
 * - **Nehmen** fragt den Server; hält eine andere Person das Objekt, kommt die Sperre zurück („🔒 Thomas · Form · seit …“), und der Editor
 *   beginnt nicht.
 * - **Herzschlag** alle 60 s, solange etwas gehalten wird, für alle Sperren in EINEM Aufruf. Meldet der Server eine als verloren
 *   (15 Minuten ohne Herzschlag, und ein anderer hat sie genommen), erfahren es die Zuhörer (`beiVerlust`); der Entwurf bleibt.
 * - **Freigeben** beim Ende des Bearbeitens und beim Verlassen der Seite (`keepalive`). Ein abgestürzter Browser gibt nie frei; dafür
 *   sind die 15 Minuten da.
 * - **Freigabe erbitten** (WI-0262, OPS-000059): `frage` bittet den Inhaber einer fremden Sperre; die Antwort und der Stand der eigenen
 *   Bitten kommen mit der Liste (`anfragen`, im Takt der Liste). Beim Inhaber kommen die Bitten mit dem Herzschlag (`beiAnfragen`, ohne
 *   eigenen Takt). 🔴 **Die Schnittstelle zum Speichern:** Jede Bearbeitung, die eine Sperre hält, meldet mit `bieteFreigabe` an, wie
 *   sie sich auf Bitten beenden lässt (Entwurf über „Fertig“ speichern, dann freigeben); `gibFreiAufBitte` ruft sie auf, ein Angebot nach
 *   dem anderen, und gibt die Sperre erst ab, wenn ALLE gespeichert haben. Scheitert eins, bleibt die Sperre, und der Grund geht zurück.
 *   Wer nichts anmeldet, wird nie still entlassen: Ohne Angebot gibt es keine Freigabe auf Bitte.
 */

export type NimmErgebnis =
    | { art: "genommen"; sperre: EditorLock }
    | { art: "gesperrt"; sperre: EditorLock }
    | { art: "fehler"; fehler: ApiFailure };

/** Das Ergebnis der Bitte um Freigabe, wie der Bittende es braucht. */
export type FrageErgebnis =
    | { art: "gestellt"; anfrage: EditorLockRequest }
    /** Es gibt schon eine offene Bitte dieser Person an dieselbe Sperre. */
    | { art: "offen"; anfrage: EditorLockRequest }
    /** Das Objekt ist inzwischen frei: Bitten ist unnötig, nehmen geht. */
    | { art: "frei" }
    /** Die Sperre gehört dem fragenden Lauf selbst. */
    | { art: "eigene" }
    | { art: "fehler"; fehler: ApiFailure };

/** Wie eine Bearbeitung auf eine Bitte endet: gespeichert und frei, oder mit dem Grund, warum nicht. */
export type FreigabeAusgang = { ok: true } | { ok: false; grund: string | undefined };

/** Was eine Bearbeitung anbietet, die eine Sperre hält (siehe `bieteFreigabe`). */
export interface FreigabeAngebot {
    /** Der Name des Objekts, wie der Hinweis ihn nennt (der Titel in „Offene Bearbeitungen“). */
    readonly titel?: string | undefined;
    /** Speichert den Entwurf über den Weg „Fertig“ und beendet die Bearbeitung; `grund` sagt, warum es nicht ging. */
    speichere(): Promise<FreigabeAusgang>;
}

export interface EditorSperre {
    readonly lauf: string;
    nimm(ziel: EditorLockTarget, teil: EditorLockPart): Promise<NimmErgebnis>;
    /** Gibt frei, ohne auf die Antwort zu warten. */
    gib(ziel: EditorLockTarget): void;
    /** Die geltenden Sperren einer Art; `own` sagt, welche dieser Lauf oder dieselbe Person in einem anderen Fenster hält. Ohne Verbindung keine. */
    liste(art: EditorLockKind): Promise<EditorLock[]>;
    /** Hebt die Sperre eines anderen auf (nur Admins, `manage_people`); `true`, wenn der Server es tat. */
    hebeAuf(ziel: EditorLockTarget): Promise<boolean>;
    /** Die eigenen Bitten um Freigabe an Objekte der Art, wie die letzte `liste` dieser Art sie brachte. */
    anfragen(art: EditorLockKind): readonly EditorLockRequest[];
    /** Bittet den Inhaber einer fremden Sperre um Freigabe. */
    frage(ziel: EditorLockTarget): Promise<FrageErgebnis>;
    /** Antwortet auf eine Bitte an eine Sperre dieses Laufs; `true`, wenn der Server sie annahm. */
    antworte(anfrage: string, antwort: EditorLockRequestAnswer): Promise<boolean>;
    /** Ein Zuhörer für die offenen Bitten an die Sperren dieses Laufs (mit jedem Herzschlag, ganze Liste); zurück kommt das Abmelden. */
    beiAnfragen(hoerer: (anfragen: readonly EditorLockIncoming[]) => void): () => void;
    /** Meldet an, wie sich die Bearbeitung des Objekts auf eine Bitte beenden lässt; zurück kommt das Abmelden (beim Freigeben). */
    bieteFreigabe(ziel: EditorLockTarget, angebot: FreigabeAngebot): () => void;
    /** Der Name des Objekts aus den Angeboten, falls eines ihn nennt. */
    titelVon(ziel: EditorLockTarget): string | undefined;
    /** Wird die Sperre dieses Objekts von diesem Lauf gehalten? */
    haelt(ziel: EditorLockTarget): boolean;
    /** Speichert alles, was am Objekt hängt, und gibt dann die Sperre ab; scheitert eins, bleibt sie. */
    gibFreiAufBitte(ziel: EditorLockTarget): Promise<FreigabeAusgang>;
    /** Ein Zuhörer für verlorene Sperren; zurück kommt das Abmelden. */
    beiVerlust(zuhoerer: (ziel: EditorLockTarget) => void): () => void;
    destroy(): void;
}

export interface EditorSperreOptionen {
    fetcher?: Fetcher;
    lauf?: string;
    takt?: Pick<typeof globalThis, "setInterval" | "clearInterval">;
}

const schluessel = (ziel: EditorLockTarget): string => `${ziel.kind}|${ziel.id}`;

export function createEditorSperre(optionen: EditorSperreOptionen = {}): EditorSperre {
    const fetcher = optionen.fetcher ?? ((url, init) => fetch(url, init));
    const takt = optionen.takt ?? globalThis;
    const lauf = optionen.lauf ?? globalThis.crypto.randomUUID();
    const gehalten = new Map<string, EditorLockTarget>();
    const zuhoerer = new Set<(ziel: EditorLockTarget) => void>();
    const anfrageHoerer = new Set<(anfragen: readonly EditorLockIncoming[]) => void>();
    const angebote = new Map<string, Set<FreigabeAngebot>>();
    /** Die eigenen Bitten je Art, wie die letzte Liste sie brachte. */
    const eigeneAnfragen = new Map<EditorLockKind, readonly EditorLockRequest[]>();
    /** Die Bitten, die der letzte Herzschlag brachte (ungefiltert). */
    let letzteBitten: readonly EditorLockIncoming[] = [];
    let uhr: ReturnType<typeof setInterval> | undefined;

    /** Meldet den Zuhörern die Bitten, die noch eine Sperre dieses Laufs treffen (eine freigegebene Sperre hat keine mehr). */
    function meldeBitten(): void {
        const noch = letzteBitten.filter((bitte) => gehalten.has(schluessel(bitte)));
        for (const hoerer of anfrageHoerer) hoerer(noch);
    }

    function stelleUhr(): void {
        if (gehalten.size > 0 && uhr === undefined)
            uhr = takt.setInterval(schlage, EDITOR_LOCK_HEARTBEAT_SECONDS * 1000);
        if (gehalten.size === 0 && uhr !== undefined) {
            takt.clearInterval(uhr);
            uhr = undefined;
        }
    }

    function schlage(): void {
        const locks = [...gehalten.values()];
        if (locks.length === 0) return;
        postJson<EditorLockBeatAnswer>(`${EDITOR_LOCKS_URL}/heartbeat`, { run: lauf, locks }, fetcher).then(
            (antwort) => {
                for (const verloren of antwort.lost) {
                    if (!gehalten.delete(schluessel(verloren))) continue;
                    for (const hoerer of zuhoerer) hoerer(verloren);
                }
                stelleUhr();
                // `requests` fehlt, wenn es keine gibt (und bei einem Server vor WI-0262).
                letzteBitten = antwort.requests ?? [];
                meldeBitten();
            },
            // Ohne Verbindung schlägt der nächste Takt wieder; 15 Minuten sind reichlich Puffer.
            () => undefined,
        );
    }

    function freigeben(ziel: EditorLockTarget, beimVerlassen: boolean): void {
        void fetcher(`${EDITOR_LOCKS_URL}/release`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ run: lauf, ...ziel }),
            keepalive: beimVerlassen,
        }).catch(() => undefined);
    }

    const beimVerlassen = (): void => {
        for (const ziel of gehalten.values()) freigeben(ziel, true);
    };
    if (typeof globalThis.addEventListener === "function") globalThis.addEventListener("pagehide", beimVerlassen);

    const aussen: EditorSperre = {
        lauf,
        async nimm(ziel, teil) {
            try {
                const antwort = await postJson<EditorLockTaken>(
                    EDITOR_LOCKS_URL,
                    { ...ziel, part: teil, run: lauf },
                    fetcher,
                );
                gehalten.set(schluessel(ziel), { kind: ziel.kind, id: ziel.id });
                stelleUhr();
                return { art: "genommen", sperre: antwort.lock };
            } catch (error: unknown) {
                const fehler = error instanceof ApiFailure ? error : new ApiFailure(0, "failed", String(error));
                const sperre =
                    fehler.code === "object_locked" ? (fehler.details?.["lock"] as EditorLock | undefined) : undefined;
                return sperre === undefined ? { art: "fehler", fehler } : { art: "gesperrt", sperre };
            }
        },
        async liste(art) {
            try {
                const antwort = await getJson<EditorLockList>(`${EDITOR_LOCKS_URL}?kind=${art}&run=${lauf}`, fetcher);
                eigeneAnfragen.set(art, antwort.requests ?? []);
                return antwort.locks;
            } catch {
                // Ohne Verbindung bleibt der letzte bekannte Stand der Bitten stehen: Eine Antwort verschwindet nicht, weil das Netz hakt.
                return [];
            }
        },
        anfragen: (art) => eigeneAnfragen.get(art) ?? [],
        async frage(ziel) {
            try {
                const antwort = await postJson<EditorLockAsked>(
                    `${EDITOR_LOCKS_URL}/request`,
                    { kind: ziel.kind, id: ziel.id, run: lauf },
                    fetcher,
                );
                return { art: "gestellt", anfrage: antwort.request };
            } catch (error: unknown) {
                const fehler = error instanceof ApiFailure ? error : new ApiFailure(0, "failed", String(error));
                if (fehler.code === "request_open") {
                    const offene = fehler.details?.["request"] as EditorLockRequest | undefined;
                    if (offene !== undefined) return { art: "offen", anfrage: offene };
                }
                if (fehler.code === "not_locked") return { art: "frei" };
                if (fehler.code === "own_lock") return { art: "eigene" };
                return { art: "fehler", fehler };
            }
        },
        async antworte(anfrage, antwort) {
            try {
                const rueck = await fetcher(`${EDITOR_LOCKS_URL}/request/answer`, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ requestId: anfrage, run: lauf, answer: antwort }),
                });
                return rueck.ok;
            } catch {
                return false;
            }
        },
        beiAnfragen(hoerer) {
            anfrageHoerer.add(hoerer);
            return () => anfrageHoerer.delete(hoerer);
        },
        bieteFreigabe(ziel, angebot) {
            const key = schluessel(ziel);
            const menge = angebote.get(key) ?? new Set<FreigabeAngebot>();
            menge.add(angebot);
            angebote.set(key, menge);
            return () => {
                menge.delete(angebot);
                if (menge.size === 0 && angebote.get(key) === menge) angebote.delete(key);
            };
        },
        titelVon(ziel) {
            for (const angebot of angebote.get(schluessel(ziel)) ?? [])
                if (angebot.titel !== undefined && angebot.titel !== "") return angebot.titel;
            return undefined;
        },
        haelt: (ziel) => gehalten.has(schluessel(ziel)),
        async gibFreiAufBitte(ziel) {
            // Eine Kopie: Ein Angebot meldet sich ab, sobald seine Bearbeitung endet.
            const alle = [...(angebote.get(schluessel(ziel)) ?? [])];
            if (alle.length === 0) return { ok: false, grund: undefined };
            for (const angebot of alle) {
                let ausgang: FreigabeAusgang;
                try {
                    ausgang = await angebot.speichere();
                } catch {
                    ausgang = { ok: false, grund: undefined };
                }
                if (!ausgang.ok) return ausgang;
            }
            // Alle haben gespeichert und sich beendet; was die Sperre dann noch hält (ein Rest), gibt der Lauf jetzt ab.
            aussen.gib(ziel);
            return { ok: true };
        },
        async hebeAuf(ziel) {
            try {
                const antwort = await fetcher(`${EDITOR_LOCKS_URL}/lift`, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ kind: ziel.kind, id: ziel.id }),
                });
                return antwort.ok;
            } catch {
                return false;
            }
        },
        gib(ziel) {
            if (!gehalten.delete(schluessel(ziel))) return;
            stelleUhr();
            freigeben(ziel, false);
            meldeBitten();
        },
        beiVerlust(hoerer) {
            zuhoerer.add(hoerer);
            return () => zuhoerer.delete(hoerer);
        },
        destroy() {
            beimVerlassen();
            gehalten.clear();
            stelleUhr();
            zuhoerer.clear();
            anfrageHoerer.clear();
            angebote.clear();
            if (typeof globalThis.removeEventListener === "function")
                globalThis.removeEventListener("pagehide", beimVerlassen);
        },
    };
    return aussen;
}
