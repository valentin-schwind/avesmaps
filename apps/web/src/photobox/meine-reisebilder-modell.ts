import type { PhotoboxCreationKind, PhotoboxStatus, PhotoboxSubmissionState, ReisebildKarte } from "@avesmaps3d/shared";
import type { BezugOrt } from "../community/meldung-modell";
import type { MessageKey } from "../i18n/de";
import type { PhotoboxFehlerArt } from "./api";
import type { LinienZeichen } from "./reisebild-zeichen";

/**
 * Was das Fenster „Meine Reisebilder“ rechnet (WI-0272 S3, Aufgabe 19a; Entwurf 9, Betreiber 2026-11-01), ohne Browser: die Zustandsmarke je Stand und das Laden der Stände. Wie es aussieht, steht
 * in `meine-reisebilder-fenster.vue`, was gemerkt ist, in `meine-reisebilder.ts`.
 *
 * - **Marken:** „In Prüfung“ (gemalte Stoppuhr; eingegangen und in Prüfung gleich), „Rückfrage“ hervorgehoben (gemalter Brief), die Freigabe grün mit Haken, alles Abgeschlossene leise. 🔴 Die Marke der
 *   Freigabe sagt dasselbe wie die Statusseite für `approved` („Veröffentlicht“): Der Entwurf nannte sie „Öffentlich“, aber solange die Freigaberegel nicht steht, ist „öffentlich“ noch nicht wahr, und
 *   Karte und Statusseite sollen für einen Zustand nicht zwei Aussagen machen.
 * - 🔴 **Der Stand je Eintrag kommt vom Server, nacheinander, einmal beim Öffnen** (`ladeMeine`): über die vorhandene Status-Route (`POST /api/photobox/status`, der Schlüssel im Rumpf, nie in der Adresse),
 *   dazu die Vorschau, wo der Stand sie bereit meldet. Kein Takt, keine Wiederholung. Die Lesegrenze (120 je Stunde und Adresse, Stand und Vorschau zählen zusammen) hält für eine Liste; reicht sie doch
 *   nicht (429), wird der Rest nicht mehr gefragt, und die Karten sagen „Stand gerade nicht abrufbar“, statt einen Stand zu erfinden. „Gibt es nicht (mehr)“ ist „Nicht mehr vorhanden“ mit „Vergessen“.
 * - **Der letzte Stand dieser Sitzung** (`letzteStaende`, nur im Arbeitsspeicher der Seite) füllt die Karte, solange der neue unterwegs ist: der Text der Karte, nie ihre Marke.
 * - 🔴 **Der Rückweg zur Liste fragt nichts mehr** (Review S3 M2): Stand und Vorschau je Schlüssel bleiben 60 s im Arbeitsspeicher der Seite (`createMeinCache`, nie im Browserspeicher). Eine Liste mit 30
 *   Einträgen kostet beim Öffnen 60 Aufrufe der Lesegrenze (120 je Stunde und Adresse); ohne den Zwischenspeicher kostete der Weg Liste, Karte, zurück 122 und käme an die Grenze, hinter einem gemeinsamen
 *   Anschluss (Schule, Mobilfunk) mit mehreren Besuchern noch früher. Ein Fehler („nicht abrufbar“) wird nie gemerkt. Die Vorschau holt nur, wo das Bild noch eine Rolle spielt (`VORSCHAU_ZUSTAENDE`).
 * - 🔴 **Der Durchgang folgt der Merkliste** (Review S3 M3): Vor jedem Schritt und nach jeder Antwort fragt er, ob der Schlüssel noch gemerkt ist (`noch`; ein vergessener wird weder gefragt noch gemeldet),
 *   und am Ende fragt er nach, was inzwischen dazukam (`aktuelle`; ein anderer Tab hat gemerkt).
 */

/** Wie eine Marke aussieht: `normal` (In Prüfung), `rueckfrage` hervorgehoben, `oeffentlich` grün, `leise` für alles Abgeschlossene und alles Unklare. */
export type MarkenTon = "normal" | "rueckfrage" | "oeffentlich" | "leise";

/** Das Zeichen vor dem Wort: ein gemaltes Symbol des Hauses oder ein Linienzeichen (`reisebild-zeichen.ts`). */
export type MarkenZeichen =
    { readonly art: "gemalt"; readonly pfad: string } | { readonly art: "linie"; readonly zeichen: LinienZeichen };

export interface Marke {
    readonly ton: MarkenTon;
    readonly zeichen: MarkenZeichen;
    readonly key: MessageKey;
}

const gemalt = (pfad: string): MarkenZeichen => ({ art: "gemalt", pfad });
const linie = (zeichen: LinienZeichen): MarkenZeichen => ({ art: "linie", zeichen });

const IN_PRUEFUNG: Marke = {
    ton: "normal",
    zeichen: gemalt("/icons/route/Stoppuhr.webp"),
    key: "photobox.meine.marke.pruefung",
};

/** Die Marke je Zustand des Servers. */
export const MARKEN: Readonly<Record<PhotoboxSubmissionState, Marke>> = {
    incoming: IN_PRUEFUNG,
    pending: IN_PRUEFUNG,
    changes_requested: {
        ton: "rueckfrage",
        zeichen: gemalt("/icons/context/brief.webp"),
        key: "photobox.meine.marke.rueckfrage",
    },
    approved: { ton: "oeffentlich", zeichen: linie("haken"), key: "photobox.meine.marke.oeffentlich" },
    technical_failed: { ton: "leise", zeichen: linie("info"), key: "photobox.status.zustand.technical_failed" },
    rejected: { ton: "leise", zeichen: linie("kreuz"), key: "photobox.meine.marke.abgelehnt" },
    withdrawn: { ton: "leise", zeichen: linie("zurueck"), key: "photobox.meine.marke.zurueckgezogen" },
    offline: { ton: "leise", zeichen: linie("offline"), key: "photobox.meine.marke.offline" },
    expired: { ton: "leise", zeichen: linie("kreuz"), key: "photobox.meine.marke.verfallen" },
    purged: { ton: "leise", zeichen: gemalt("/icons/menu/papierkorb.webp"), key: "photobox.meine.marke.geloescht" },
};

export const markeFuer = (zustand: PhotoboxSubmissionState): Marke => MARKEN[zustand];

/** Der Betreiber hat das Bild endgültig gelöscht (WI-0272): „Entfernt“, gleich in welchem Zustand die Einreichung stehen blieb. */
export const MARKE_ENTFERNT: Marke = {
    ton: "leise",
    zeichen: gemalt("/icons/menu/papierkorb.webp"),
    key: "photobox.status.zustand.entfernt",
};

/** Die Marke eines Stands: nach dem endgültigen Löschen `MARKE_ENTFERNT`, sonst die des Zustands. */
export const markeFuerStand = (status: Pick<PhotoboxStatus, "zustand" | "bildEntfernt">): Marke =>
    status.bildEntfernt === true ? MARKE_ENTFERNT : markeFuer(status.zustand);

/** Der Server kennt diese Einreichung nicht (mehr): gelöscht, verfallen und geleert, oder nie gewesen. */
export const MARKE_WEG: Marke = {
    ton: "leise",
    zeichen: gemalt("/icons/menu/papierkorb.webp"),
    key: "photobox.meine.marke.weg",
};

/** Der Stand ließ sich nicht holen (Lesegrenze, Netz, Server): kein erfundener Stand, nur dieser Satz. */
export const MARKE_UNKLAR: Marke = { ton: "leise", zeichen: linie("info"), key: "photobox.meine.marke.unklar" };

/** In der Liste ist die Zeile schmal: die Art kurz (im Stand und in der Bestätigung steht sie ganz). */
export const ART_KURZ: Readonly<Record<PhotoboxCreationKind, MessageKey>> = {
    drawing: "photobox.meine.art.drawing",
    photo: "photobox.meine.art.photo",
    ai_generated: "photobox.meine.art.ai_generated",
    avesmaps_capture: "photobox.meine.art.avesmaps_capture",
};

/** Der letzte echte Stand je Schlüssel in dieser Sitzung der Seite; nie im Browserspeicher. */
export const letzteStaende = new Map<string, PhotoboxStatus>();

/** Der nächste Ort je Stelle, nur im Arbeitsspeicher der Seite: Das erneute Öffnen des Fensters fragt den Ortsdienst nicht noch einmal je Karte. */
export const naechsteOrte = new Map<string, BezugOrt>();
export const ortSchluessel = (lage: { readonly x: number; readonly y: number }): string =>
    `${String(lage.x)}:${String(lage.y)}`;

/** Was das Laden zu einem Eintrag ergibt: ein Stand, „gibt es nicht (mehr)“ oder „nicht abrufbar“. */
export type MeinErgebnis =
    { readonly art: "da"; readonly status: PhotoboxStatus } | { readonly art: "weg" } | { readonly art: "unklar" };

export interface MeineUmfeld {
    readonly leseStatus: (schluessel: string) => Promise<PhotoboxStatus>;
    /** Die Vorschau; `"fehlt"` heißt: noch nicht berechnet. */
    readonly ladeVorschau: (schluessel: string) => Promise<Blob | "fehlt">;
    readonly fehlerArt: (fehler: unknown) => PhotoboxFehlerArt;
    /** Steht der Schlüssel noch in der Merkliste? Ohne Angabe ja. Ein vergessener wird nicht mehr gefragt, und eine späte Antwort für ihn legt nichts an. */
    readonly noch?: (schluessel: string) => boolean;
    /** Die Schlüssel, die jetzt gemerkt sind: Was nach dem Start dazukam (ein anderer Tab), fragt der Durchgang am Ende noch nach. */
    readonly aktuelle?: () => readonly string[];
}

/** Was noch auf eine Entscheidung der Redaktion oder des Einreichers wartet: In der Leiste steht es als Kachel mit Marke vorn. */
const OFFENE_ZUSTAENDE: ReadonlySet<PhotoboxSubmissionState> = new Set<PhotoboxSubmissionState>([
    "incoming",
    "pending",
    "changes_requested",
]);

/** Ein eigenes Bild, das noch offen ist. */
export interface MeinOffenes {
    readonly schluessel: string;
    readonly beschreibung: string;
    readonly entstehung: PhotoboxCreationKind;
    readonly marke: Marke;
}

/** Was „Meine Reisebilder“ in der Leiste zeigt; alles Abgeschlossene steht nur im Fenster. `unklar`: Mindestens ein Stand ließ sich nicht holen. */
export interface MeineLeiste {
    readonly karten: readonly ReisebildKarte[];
    readonly offene: readonly MeinOffenes[];
    readonly unklar: boolean;
}

/** Aus den Ständen der gemerkten Schlüssel, in ihrer Reihenfolge: die veröffentlichten Bilder und das Offene. */
export function meineLeiste(
    schluessel: readonly string[],
    ergebnisse: Readonly<Record<string, MeinErgebnis>>,
): MeineLeiste {
    const karten: ReisebildKarte[] = [];
    const offene: MeinOffenes[] = [];
    let unklar = false;
    for (const eintrag of schluessel) {
        const ergebnis = ergebnisse[eintrag];
        if (ergebnis?.art === "unklar") unklar = true;
        if (ergebnis?.art !== "da") continue;
        const { status } = ergebnis;
        if (status.karte !== undefined) karten.push(status.karte);
        else if (OFFENE_ZUSTAENDE.has(status.zustand))
            offene.push({
                schluessel: eintrag,
                beschreibung: status.beschreibung,
                entstehung: status.entstehung,
                marke: markeFuer(status.zustand),
            });
    }
    return { karten, offene, unklar };
}

/** Wie lange Stand und Vorschau einer Sitzung gelten, bevor die Liste sie wieder beim Server holt. */
export const MEIN_CACHE_MS = 60_000;

/** Nur wo das Bild noch eine Rolle spielt, lohnt der Aufruf der Vorschau (die Lesegrenze zählt ihn): eingegangen, in Prüfung, Rückfrage, freigegeben. */
export const VORSCHAU_ZUSTAENDE: ReadonlySet<PhotoboxSubmissionState> = new Set<PhotoboxSubmissionState>([
    "incoming",
    "pending",
    "changes_requested",
    "approved",
]);

interface CacheEintrag {
    readonly zeit: number;
    readonly ergebnis: { readonly art: "da"; readonly status: PhotoboxStatus } | { readonly art: "weg" };
    readonly vorschau: Blob | undefined;
}

/** Der Zwischenspeicher einer Sitzung: Stand und Vorschau je Schlüssel, nur im Arbeitsspeicher. */
export interface MeinCache {
    /** Der gültige Eintrag (jünger als `MEIN_CACHE_MS`), sonst nichts. */
    hole(schluessel: string, jetzt: number): CacheEintrag | undefined;
    merke(schluessel: string, ergebnis: CacheEintrag["ergebnis"], jetzt: number, vorschau?: Blob): void;
    merkeVorschau(schluessel: string, bild: Blob): void;
    /** Die Statusseite hat einen neuen Stand gelesen oder gesendet: Er gilt auch in der Liste; die Vorschau bleibt, wie sie war. */
    aktualisiere(schluessel: string, status: PhotoboxStatus, jetzt: number): void;
    /** Die Statusseite sagt „gibt es nicht (mehr)“. */
    aktualisiereWeg(schluessel: string, jetzt: number): void;
    vergiss(schluessel: string): void;
    leere(): void;
}

export function createMeinCache(): MeinCache {
    const eintraege = new Map<string, CacheEintrag>();
    return {
        hole(schluessel, jetzt) {
            const eintrag = eintraege.get(schluessel);
            if (eintrag === undefined) return undefined;
            if (jetzt - eintrag.zeit >= MEIN_CACHE_MS || jetzt < eintrag.zeit) {
                eintraege.delete(schluessel);
                return undefined;
            }
            return eintrag;
        },
        merke(schluessel, ergebnis, jetzt, vorschau) {
            eintraege.set(schluessel, { zeit: jetzt, ergebnis, vorschau });
        },
        merkeVorschau(schluessel, bild) {
            const eintrag = eintraege.get(schluessel);
            if (eintrag !== undefined) eintraege.set(schluessel, { ...eintrag, vorschau: bild });
        },
        aktualisiere(schluessel, status, jetzt) {
            eintraege.set(schluessel, {
                zeit: jetzt,
                ergebnis: { art: "da", status },
                vorschau: eintraege.get(schluessel)?.vorschau,
            });
        },
        aktualisiereWeg(schluessel, jetzt) {
            eintraege.set(schluessel, { zeit: jetzt, ergebnis: { art: "weg" }, vorschau: undefined });
        },
        vergiss: (schluessel) => {
            eintraege.delete(schluessel);
        },
        leere: () => {
            eintraege.clear();
        },
    };
}

/** Der eine Zwischenspeicher der Seite (nur im Arbeitsspeicher; er geht mit dem Neuladen). */
export const meinCache: MeinCache = createMeinCache();

export interface MeineOptionen {
    /** Ohne Cache fragt jeder Durchgang neu. */
    readonly cache?: MeinCache | undefined;
    /** Die Uhr in Millisekunden; für Tests. */
    readonly jetzt?: (() => number) | undefined;
    /** Wo die Vorschau nicht gebraucht wird (die Leiste: Ein veröffentlichtes Bild bringt seine Kachel mit); ohne Angabe überall, wo das Bild noch eine Rolle spielt. */
    readonly mitVorschau?: ((status: PhotoboxStatus) => boolean) | undefined;
}

export interface MeineAusgang {
    stand(schluessel: string, ergebnis: MeinErgebnis): void;
    /** Die Vorschau ist da: Das Fenster macht daraus eine Adresse nur für sich (`URL.createObjectURL`) und gibt sie beim Schließen frei. */
    vorschau(schluessel: string, bild: Blob): void;
}

export interface MeinLauf {
    /** Das Fenster geht zu: späte Antworten gelten nicht mehr, nichts wird weiter gefragt. */
    stoppe(): void;
    /** Ist der Durchgang zu Ende (oder gestoppt)? */
    readonly fertig: Promise<void>;
}

/**
 * Den Stand zu jedem Schlüssel holen, einen nach dem anderen (nie zwei zugleich): erst der Stand, dann, wo er sie bereit meldet und das Bild noch eine Rolle spielt, die Vorschau. Ein Durchgang, kein Takt.
 * Die Lesegrenze (429) und ein abgeschaltetes Modul (503) beenden ihn: Der Rest wird nicht mehr gefragt und gilt als „nicht abrufbar“; jeder andere Fehler betrifft nur seine Karte. Mit Zwischenspeicher
 * (`optionen.cache`) kommt, was jünger als 60 s ist, ohne Anfrage aus dem Arbeitsspeicher.
 */
export function ladeMeine(
    umfeld: MeineUmfeld,
    schluessel: readonly string[],
    ausgang: MeineAusgang,
    optionen: MeineOptionen = {},
): MeinLauf {
    let gilt = true;
    const cache = optionen.cache;
    const uhr = optionen.jetzt ?? (() => Date.now());
    const noch = (eintrag: string): boolean => umfeld.noch?.(eintrag) ?? true;

    async function holeVorschau(eintrag: string): Promise<void> {
        try {
            const bild = await umfeld.ladeVorschau(eintrag);
            if (gilt && bild !== "fehlt" && noch(eintrag)) {
                cache?.merkeVorschau(eintrag, bild);
                ausgang.vorschau(eintrag, bild);
            }
        } catch {
            // Ohne Vorschau steht das gemalte Symbol; der Stand der Karte bleibt, wie er ist.
        }
    }

    const braucheVorschau = (status: PhotoboxStatus): boolean =>
        status.vorschauBereit && VORSCHAU_ZUSTAENDE.has(status.zustand) && (optionen.mitVorschau?.(status) ?? true);

    /** Einen Eintrag beantworten; `false`, wenn der Durchgang hier enden soll (Lesegrenze oder abgeschaltetes Modul). */
    async function beantworte(eintrag: string, danach: readonly string[]): Promise<boolean> {
        const gemerkt = cache?.hole(eintrag, uhr());
        if (gemerkt !== undefined) {
            if (gemerkt.ergebnis.art === "weg") {
                ausgang.stand(eintrag, { art: "weg" });
                return true;
            }
            const status = gemerkt.ergebnis.status;
            letzteStaende.set(eintrag, status);
            ausgang.stand(eintrag, { art: "da", status });
            if (braucheVorschau(status)) {
                if (gemerkt.vorschau !== undefined) ausgang.vorschau(eintrag, gemerkt.vorschau);
                else await holeVorschau(eintrag);
            }
            return true;
        }
        let status: PhotoboxStatus;
        try {
            status = await umfeld.leseStatus(eintrag);
        } catch (fehler) {
            if (!gilt || !noch(eintrag)) return true;
            const art = umfeld.fehlerArt(fehler);
            if (art === "nicht_gefunden") {
                letzteStaende.delete(eintrag);
                cache?.merke(eintrag, { art: "weg" }, uhr());
                ausgang.stand(eintrag, { art: "weg" });
                return true;
            }
            ausgang.stand(eintrag, { art: "unklar" });
            if (art === "zu_viele" || art === "pausiert") {
                for (const rest of danach) if (noch(rest)) ausgang.stand(rest, { art: "unklar" });
                return false;
            }
            return true;
        }
        // Wer unterwegs vergessen wurde, bekommt keine Karte mehr (Review S3 M3).
        if (!gilt || !noch(eintrag)) return true;
        letzteStaende.set(eintrag, status);
        cache?.merke(eintrag, { art: "da", status }, uhr());
        ausgang.stand(eintrag, { art: "da", status });
        if (braucheVorschau(status)) await holeVorschau(eintrag);
        return true;
    }

    const fertig = (async (): Promise<void> => {
        const gefragt = new Set<string>();
        let warteschlange = [...schluessel];
        while (warteschlange.length > 0) {
            for (const [nr, eintrag] of warteschlange.entries()) {
                if (!gilt) return;
                gefragt.add(eintrag);
                if (!noch(eintrag)) continue;
                if (!(await beantworte(eintrag, warteschlange.slice(nr + 1)))) return;
            }
            // Was ein anderer Tab inzwischen gemerkt hat, kommt am Ende dran.
            warteschlange = (umfeld.aktuelle?.() ?? []).filter((eintrag) => !gefragt.has(eintrag));
        }
    })();

    return {
        stoppe: () => {
            gilt = false;
        },
        fertig,
    };
}
