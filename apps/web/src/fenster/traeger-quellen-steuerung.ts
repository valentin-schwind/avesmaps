import { computed, onScopeDispose, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import {
    inhalteTraegerQuellenUrl,
    type InhalteQuellenZeile,
    type InhalteTraegerQuellen,
    type InhalteTraegerQuellenArt,
    type InhalteTraegerQuellenBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, type Fetcher } from "../auth/api";
import { t } from "../i18n/i18n";
import { createInhalteClient } from "../inhalte/inhalte-client";
import { istAbbruch } from "../medien/medien-client";
import { sende, type SchreibAntwort } from "./entwurf-senden";
import type { KlappAngaben } from "./quellen-klappbox-modell";
import { createTextSuche } from "./text-suche";
import {
    aktiveZahl,
    baueAenderung,
    baueBody,
    feldGeaendert,
    fehlerAus,
    type Eingabe,
    type Handlung,
    type ZeilenFehler,
} from "./traeger-quellen-modell";

/**
 * Die Quellen EINES Kartenobjekts in den Editoren (Orte, Herrschaftsgebiete; WI-0254 §12) mit Lesen, Schreiben, Fehlern und Sperre, ohne Bauteil. Betreiber 2026-10-28: **sofort speichern**.
 *
 * - **Jede Handlung ist EIN Schreiben mit genau einer Änderung** und `vorher` = zuletzt gelesener Stand der Verknüpfung: Anhängen (Treffer wählen), die Art wählen, Fundstelle und Notiz beim Verlassen des Felds
 *   oder mit Enter (nur, wo sich der Wert geändert hat, nie je Taste), Lösen, Holen, „↺ Wiki-Wert“. Danach wird neu gelesen; die Zeile folgt dem Server.
 * - **Sperre:** Während eine Zeile schreibt, sind ihre Aktionsknöpfe gesperrt (`schreibend`; Lösen, Holen, ↺ Wiki-Wert, Quelle öffnen, kurz und ohne Satz). Die Felder (Fundstelle, Art, Notiz) bleiben bedienbar:
 *   Schreiben läuft nacheinander, und `vorher` entsteht erst beim Ausführen, als der Stand, den das vorige Schreiben hinterließ. So wirkt der erste Klick auf die Art auch gleich nach dem Tippen.
 * - **Fehler:** 409 `edit_conflict`: neu lesen, die Eingabe bleibt im Feld, der Satz an der Zeile nennt wer und wann. 403, 423, 503, 400 und kein Netz: der Satz des Servers an der Zeile, der Wert bleibt.
 *   Der Fehler eines Anhängens steht beim Anhängen (die Zeile gibt es noch nicht).
 * - **Ein anderes Objekt** (`ziel` ändert sich) beginnt von vorn; ein Schreiben, das noch läuft, schreibt nur noch (der Server hat es), fasst die Anzeige aber nicht mehr an.
 */

export interface TraegerZiel {
    readonly kind: InhalteTraegerQuellenArt;
    /** Die öffentliche Kennung des Objekts (beim Weg die eines Abschnitts der Straße). */
    readonly id: string;
    /**
     * Alle Kennungen, unter denen das Objekt im Fachprotokoll stehen kann; ohne Angabe nur `id`. Beim Weg die aller Abschnitte der Straße: Die Operation hängt an einem von ihnen (dem Anker
     * zur Zeit des Speicherns), und nach dem Teilen oder Verbinden kann der Anker ein anderer sein. Der Verlauf der Straße ist ohnehin auf ihre Abschnitte begrenzt.
     */
    readonly ids?: readonly string[] | undefined;
}

/** Der Weg zum Server: lesen, schreiben und im Katalog suchen. */
export interface TraegerQuellenClient {
    lies(kind: InhalteTraegerQuellenArt, id: string, signal: AbortSignal): Promise<InhalteTraegerQuellen>;
    schreibe(
        kind: InhalteTraegerQuellenArt,
        id: string,
        body: InhalteTraegerQuellenBody,
    ): Promise<SchreibAntwort<OperationReceipt>>;
    suche(text: string, signal: AbortSignal): Promise<readonly InhalteQuellenZeile[]>;
}

export function createTraegerQuellenClient(fetcher: Fetcher = (url, init) => fetch(url, init)): TraegerQuellenClient {
    const katalog = createInhalteClient(fetcher);
    return {
        lies: (kind, id, signal) =>
            getJson<InhalteTraegerQuellen>(inhalteTraegerQuellenUrl(kind, id), (ziel, init) =>
                fetcher(ziel, { ...init, signal }),
            ),
        schreibe: (kind, id, body) =>
            sende<OperationReceipt>(inhalteTraegerQuellenUrl(kind, id), body, "POST", fetcher),
        suche: async (text, signal) =>
            (await katalog.liste({ q: text, limit: 8, sort: "title", stand: "aktiv" }, signal)).items,
    };
}

export interface TraegerQuellenOptionen {
    client?: TraegerQuellenClient | undefined;
    /** Eine neue Kennung je Schreiben; Tests geben feste. */
    neueOperationId?: (() => string) | undefined;
    /** Wartezeit der Suche in Millisekunden; Tests nehmen 0. */
    entprellMs?: number | undefined;
}

export interface TraegerQuellenSteuerung {
    /** Die Antwort des Servers, wie zuletzt gelesen; `undefined`, bis gelesen ist. */
    readonly daten: Readonly<ShallowRef<InhalteTraegerQuellen | undefined>>;
    readonly laedt: Readonly<Ref<boolean>>;
    /** Das erste Lesen ist gescheitert (es gibt nichts zu zeigen). */
    readonly lesefehler: Readonly<Ref<boolean>>;
    /** Was in Feldern steht und noch nicht gespeichert ist, je Quelle. */
    readonly eingaben: Readonly<ShallowRef<ReadonlyMap<string, Eingabe>>>;
    /** Die Quellen, die gerade schreiben. */
    readonly schreibend: Readonly<ShallowRef<ReadonlySet<string>>>;
    /** Was an einer Zeile schiefging. */
    readonly fehler: Readonly<ShallowRef<ReadonlyMap<string, ZeilenFehler>>>;
    /** Das Anhängen schreibt gerade, und was dabei schiefging. */
    readonly anhaengenLaeuft: Readonly<Ref<boolean>>;
    readonly anhaengenFehler: Readonly<Ref<ZeilenFehler | undefined>>;
    /** Die Zahl der aktiven Quellen; `undefined`, bis gelesen ist. */
    readonly zahl: ComputedRef<number | undefined>;
    // Die Suche im Katalog (zum Anhängen).
    readonly quelleText: Ref<string>;
    readonly quelleTreffer: ShallowRef<readonly InhalteQuellenZeile[]>;
    readonly quelleLaedt: Ref<boolean>;
    /** Die Box meldet eine Änderung an einer Zeile: die Art speichert sofort, Fundstelle und Notiz warten auf `feldSchluss`. */
    aendere(sourceId: string, angaben: KlappAngaben): Promise<void>;
    /** Ein Feld ist fertig (verlassen oder Enter): Was sich gegenüber dem gespeicherten Stand geändert hat, wird geschrieben. */
    feldSchluss(): Promise<void>;
    loese(sourceId: string): Promise<void>;
    stelleHer(sourceId: string): Promise<void>;
    /** „↺ Wiki-Wert“: Art, Fundstelle und Notiz auf das Zitat des Wikis. */
    aufWiki(sourceId: string): Promise<void>;
    /** Eine Quelle des Katalogs anhängen (oder zurückholen); gibt ihre Kennung zurück, wenn es ging. */
    haengeAn(quelle: Pick<InhalteQuellenZeile, "id">): Promise<string | undefined>;
    /** Neu lesen; `true`, wenn es ging. */
    neuLesen(): Promise<boolean>;
}

const ENTPRELL_VORGABE = 250;

type Gelesen = "ok" | "fehler" | "veraltet";

export function createTraegerQuellenSteuerung(
    ziel: () => TraegerZiel | undefined,
    optionen: TraegerQuellenOptionen = {},
): TraegerQuellenSteuerung {
    const client = optionen.client ?? createTraegerQuellenClient();
    const neueOperationId = optionen.neueOperationId ?? newOperationId;

    const daten = shallowRef<InhalteTraegerQuellen | undefined>(undefined);
    const laedt = ref(false);
    const lesefehler = ref(false);
    const eingaben = shallowRef<ReadonlyMap<string, Eingabe>>(new Map());
    const schreibend = shallowRef<ReadonlySet<string>>(new Set());
    const fehler = shallowRef<ReadonlyMap<string, ZeilenFehler>>(new Map());
    const anhaengenLaeuft = ref(false);
    const anhaengenFehler = ref<ZeilenFehler | undefined>(undefined);
    const zahl = computed(() => (daten.value === undefined ? undefined : aktiveZahl(daten.value)));

    const suche = createTextSuche<InhalteQuellenZeile>(
        (text, signal) => client.suche(text, signal),
        optionen.entprellMs ?? ENTPRELL_VORGABE,
    );

    /** Wie oft das Objekt gewechselt hat: Eine Antwort, die zu einem früheren gehört, fasst die Anzeige nicht an. */
    let epoche = 0;
    let entsorgt = false;
    let leseNummer = 0;
    let leseAbbruch: AbortController | undefined;
    /** Schreiben läuft nacheinander. */
    let kette: Promise<unknown> = Promise.resolve();
    const zaehler = new Map<string, number>();
    /** Fundstelle und Notiz, die gerade geschrieben werden (`<Quelle>/<Feld>` → der Wert): Dasselbe Feld mit demselben Wert schreibt nicht zweimal. */
    const imFlug = new Map<string, string>();

    function setzeSchreibend(sourceId: string, an: boolean): void {
        const jetzt = (zaehler.get(sourceId) ?? 0) + (an ? 1 : -1);
        if (jetzt > 0) zaehler.set(sourceId, jetzt);
        else zaehler.delete(sourceId);
        schreibend.value = new Set(zaehler.keys());
    }
    function setzeFehler(sourceId: string, wert: ZeilenFehler | undefined): void {
        const neu = new Map(fehler.value);
        if (wert === undefined) neu.delete(sourceId);
        else neu.set(sourceId, wert);
        fehler.value = neu;
    }
    function setzeEingabe(sourceId: string, feld: "seiten" | "notiz", wert: string | undefined): void {
        const neu = new Map(eingaben.value);
        const alt = { ...neu.get(sourceId) };
        if (wert === undefined) delete alt[feld];
        else alt[feld] = wert;
        if (alt.seiten === undefined && alt.notiz === undefined) neu.delete(sourceId);
        else neu.set(sourceId, alt);
        eingaben.value = neu;
    }
    function verwirfEingaben(sourceId: string): void {
        if (!eingaben.value.has(sourceId)) return;
        const neu = new Map(eingaben.value);
        neu.delete(sourceId);
        eingaben.value = neu;
    }

    async function lese(z: TraegerZiel, meine: number): Promise<Gelesen> {
        const nummer = ++leseNummer;
        leseAbbruch?.abort();
        const abbruch = new AbortController();
        leseAbbruch = abbruch;
        if (daten.value === undefined) laedt.value = true;
        try {
            const antwort = await client.lies(z.kind, z.id, abbruch.signal);
            if (abbruch.signal.aborted || entsorgt || meine !== epoche || nummer !== leseNummer) return "veraltet";
            daten.value = antwort;
            lesefehler.value = false;
            return "ok";
        } catch (grund) {
            if (istAbbruch(grund, abbruch.signal) || entsorgt || meine !== epoche || nummer !== leseNummer) {
                return "veraltet";
            }
            if (daten.value === undefined) lesefehler.value = true;
            return "fehler";
        } finally {
            if (nummer === leseNummer && meine === epoche) laedt.value = false;
        }
    }

    /** Die Anzeige beginnt von vorn: ein anderes Objekt. */
    function beginneVonVorn(z: TraegerZiel | undefined): void {
        epoche += 1;
        leseAbbruch?.abort();
        daten.value = undefined;
        laedt.value = false;
        lesefehler.value = false;
        eingaben.value = new Map();
        fehler.value = new Map();
        zaehler.clear();
        imFlug.clear();
        schreibend.value = new Set();
        anhaengenLaeuft.value = false;
        anhaengenFehler.value = undefined;
        suche.leere();
        if (z !== undefined) void lese(z, epoche);
    }
    watch(
        () => {
            const z = ziel();
            return z === undefined ? undefined : `${z.kind}/${z.id}`;
        },
        () => beginneVonVorn(ziel()),
        { immediate: true },
    );
    onScopeDispose(() => {
        entsorgt = true;
        leseAbbruch?.abort();
    });

    /** Das Schreiben EINER Handlung; `true`, wenn der Server sie angenommen hat. */
    async function fuehreAus(z: TraegerZiel, meine: number, sourceId: string, handlung: Handlung): Promise<boolean> {
        const anhaengen = handlung.art === "anhaengen";
        try {
            if (entsorgt || meine !== epoche) return false;
            // `vorher` ist, was zuletzt gelesen wurde: nach dem vorigen Schreiben also dessen Ergebnis.
            const aktuell = daten.value?.quellen.find((quelle) => quelle.sourceId === sourceId);
            const aenderung = baueAenderung(sourceId, handlung, aktuell);
            if (aenderung === undefined) return false;
            const antwort = await client.schreibe(z.kind, z.id, baueBody(neueOperationId(), aenderung));
            if (entsorgt || meine !== epoche) return antwort.ok;
            if (!antwort.ok) {
                const grund = fehlerAus(antwort.status, antwort.fehler);
                if (anhaengen) anhaengenFehler.value = grund;
                else setzeFehler(sourceId, grund);
                // Jemand war schneller: der Stand kommt neu, die Eingabe bleibt im Feld stehen.
                if (grund.art === "konflikt") await lese(z, meine);
                return false;
            }
            const gelesen = await lese(z, meine);
            if (entsorgt || meine !== epoche) return true;
            // Die Eingabe ist eingelöst, wenn sie noch der geschriebene Wert ist; hat jemand inzwischen weitergetippt, bleibt sie. Die Art lässt Fundstelle und Notiz unberührt.
            if (handlung.art === "seiten" || handlung.art === "notiz") {
                const feld = handlung.art;
                if (eingaben.value.get(sourceId)?.[feld] === handlung.wert) setzeEingabe(sourceId, feld, undefined);
            } else if (handlung.art !== "art") {
                verwirfEingaben(sourceId);
            }
            if (gelesen === "fehler") {
                const satz: ZeilenFehler = { art: "satz", satz: t("entwurf.lesefehler") };
                if (anhaengen) anhaengenFehler.value = satz;
                else setzeFehler(sourceId, satz);
            }
            return true;
        } finally {
            if (!entsorgt && meine === epoche) {
                if (handlung.art === "seiten" || handlung.art === "notiz") imFlug.delete(`${sourceId}/${handlung.art}`);
                setzeSchreibend(sourceId, false);
                if (anhaengen) anhaengenLaeuft.value = false;
            }
        }
    }

    function schreibe(sourceId: string, handlung: Handlung): Promise<boolean> {
        const z = ziel();
        if (z === undefined || entsorgt) return Promise.resolve(false);
        const meine = epoche;
        if (handlung.art === "seiten" || handlung.art === "notiz")
            imFlug.set(`${sourceId}/${handlung.art}`, handlung.wert);
        // Die Aktionsknöpfe der Zeile sind sofort gesperrt, auch wenn davor noch ein Schreiben läuft; die Felder bleiben bedienbar, weitere Handlungen reihen sich ein.
        setzeSchreibend(sourceId, true);
        if (handlung.art === "anhaengen") {
            anhaengenLaeuft.value = true;
            anhaengenFehler.value = undefined;
        } else {
            setzeFehler(sourceId, undefined);
        }
        const lauf = kette.then(() => fuehreAus(z, meine, sourceId, handlung));
        kette = lauf.catch(() => undefined);
        return lauf;
    }

    return {
        daten,
        laedt,
        lesefehler,
        eingaben,
        schreibend,
        fehler,
        anhaengenLaeuft,
        anhaengenFehler,
        zahl,
        quelleText: suche.text,
        quelleTreffer: suche.treffer,
        quelleLaedt: suche.laedt,
        async aendere(sourceId, angaben) {
            if (angaben.referenceKind !== undefined) {
                await schreibe(sourceId, { art: "art", referenceKind: angaben.referenceKind });
                return;
            }
            if (angaben.pages !== undefined) setzeEingabe(sourceId, "seiten", angaben.pages);
            if (angaben.note !== undefined) setzeEingabe(sourceId, "notiz", angaben.note);
        },
        async feldSchluss() {
            const laeufe: Promise<boolean>[] = [];
            for (const [sourceId, eingabe] of eingaben.value) {
                const quelle = daten.value?.quellen.find((q) => q.sourceId === sourceId);
                if (quelle === undefined) {
                    verwirfEingaben(sourceId);
                    continue;
                }
                for (const feld of ["seiten", "notiz"] as const) {
                    const wert = eingabe[feld];
                    if (wert === undefined) continue;
                    // Dasselbe Feld mit demselben Wert ist schon unterwegs (Enter, dann Verlassen): nicht noch einmal.
                    if (imFlug.get(`${sourceId}/${feld}`) === wert) continue;
                    if (feldGeaendert(quelle, feld, wert)) laeufe.push(schreibe(sourceId, { art: feld, wert }));
                    else setzeEingabe(sourceId, feld, undefined);
                }
            }
            await Promise.all(laeufe);
        },
        async loese(sourceId) {
            await schreibe(sourceId, { art: "loesen" });
        },
        async stelleHer(sourceId) {
            await schreibe(sourceId, { art: "holen" });
        },
        async aufWiki(sourceId) {
            await schreibe(sourceId, { art: "wikiWert" });
        },
        async haengeAn(quelle) {
            const ging = await schreibe(quelle.id, { art: "anhaengen" });
            if (!ging) return undefined;
            suche.leere();
            return quelle.id;
        },
        async neuLesen() {
            const z = ziel();
            return z !== undefined && (await lese(z, epoche)) === "ok";
        },
    };
}
