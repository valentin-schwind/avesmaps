import {
    EDITOR_LANDSCAPES_VEREINIGEN_URL,
    EDITOR_TERRITORIES_VEREINIGEN_URL,
    FLAECHEN_VEREINIGEN_MAX,
    type FlaechenVereinigenBody,
    type FlaechenVereinigenGrund,
    type FlaechenVereinigenPruefung,
    type FlaechenVereinigenReceipt,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, type Fetcher } from "../auth/api";
import { sende } from "../fenster/entwurf-senden";
import type { MessageKey } from "../i18n/i18n";
import type { HandgriffWahl } from "../editor-menu/action";

/**
 * „Flächen vereinigen ›“ im Kartenmenü (WI-0252; Betreiber 2026-10-24: „unter anlegen "Hier hinzufügen" soll im kontextmenü (bei der
 * mehrfachauswahl von objekte) "Flächen vereinigen" stehen das Untermenü bestimmt wessen einstellungen übernommen werden“; Server
 * `landscape-vereinigen.ts`, `territory-vereinigen.ts`). Dasselbe Konzept wie „Wege verbinden ›“: vereinigen, im Untermenü wählen, wessen
 * Einstellungen gelten, und dasselbe Bauteil (`HandgriffWahl`, `kartenmenue.ts` `wahlenAlsUnter`).
 *
 * - **Die Auswahl** sind die angehakten Landschaften oder Gebiete (`mehrfach-markierung.ts`), mindestens zwei.
 * - **Ob es geht**, sagt der Server (`GET …/vereinigen?ids=`, dieselbe Rechnung wie beim Schreiben); bis dahin steht der Eintrag grau
 *   „wird geprüft“, danach kommt das Menü noch einmal (`bereit`). Geht es nicht, steht er grau mit dem Grund.
 * - **Das Untermenü** nennt die Flächen, die Vorlage sein können, mit Name und Art; Zeigen lässt jede auf der Karte leuchten
 *   (`flaechen-leuchten.ts`). Die Wahl schreibt sofort EINE Operation gegen die Revisionen, die die Prüfung las; ↺ im Verlauf der Vorlage.
 */

export type FlaechenArt = "landscape" | "territory";

export interface FlaechenAuswahl {
    readonly art: FlaechenArt;
    readonly ids: readonly string[];
}

/** Der Eintrag „Flächen vereinigen ›“, so wie das Kartenmenü ihn unter „Hier hinzufügen ›“ zeigt. */
export interface VereinigenEintrag {
    readonly id: string;
    readonly text: MessageKey;
    /** Warum es (noch) nicht geht; dann ohne Untermenü. */
    readonly grund?: MessageKey | undefined;
    readonly wahlen: readonly HandgriffWahl[];
}

/** Die Kennung des Eintrags; eine Wahl darin heißt `flaechen-vereinigen#<Vorlage>`. */
export const VEREINIGEN_EINTRAG = "flaechen-vereinigen";

const URL_JE_ART: Readonly<Record<FlaechenArt, string>> = {
    landscape: EDITOR_LANDSCAPES_VEREINIGEN_URL,
    territory: EDITOR_TERRITORIES_VEREINIGEN_URL,
};

/** Warum es nicht geht, als Satz des Menüs. */
export const VEREINIGEN_GRUND: Readonly<Record<FlaechenVereinigenGrund | "fehler" | "laedt", MessageKey>> = {
    anzahl: "ortseditor.vereinigen.grund.anzahl",
    karte: "ortseditor.vereinigen.grund.karte",
    art: "ortseditor.vereinigen.grund.art",
    leer: "ortseditor.vereinigen.grund.leer",
    nachbar: "ortseditor.vereinigen.grund.nachbar",
    kraftlinie: "ortseditor.vereinigen.grund.kraftlinie",
    zeit: "ortseditor.vereinigen.grund.zeit",
    fehler: "ortseditor.vereinigen.grund.fehler",
    laedt: "ortseditor.vereinigen.grund.laedt",
};

/** Bei Gebieten heißt die Art anders als bei Landschaften: dieselbe Art unter demselben Obergebiet. */
const ART_GRUND: Readonly<Record<FlaechenArt, MessageKey>> = {
    landscape: "ortseditor.vereinigen.grund.art",
    territory: "ortseditor.vereinigen.grund.artGebiet",
};

export const auswahlSchluessel = (auswahl: FlaechenAuswahl): string =>
    `${auswahl.art}:${[...auswahl.ids].sort().join(",")}`;

interface Pruefung {
    stand: "laedt" | "da" | "fehler";
    pruefung?: FlaechenVereinigenPruefung;
    warte: Promise<void>;
    /** Wann sie scheiterte; nach `FEHLER_NEU_NACH_MS` fragt das nächste Menü noch einmal. */
    fehlerUm?: number;
}

/**
 * So lange bleibt eine gescheiterte Prüfung stehen, bevor das nächste Öffnen des Menüs sie noch einmal stellt. 🔴 Vorher blieb sie für
 * dieselbe Auswahl bis zur nächsten Kartenänderung, obwohl der Grund sagt „das Menü noch einmal öffnen“: Eine Zeitüberschreitung des
 * Servers machte „Flächen vereinigen“ für die ganze Auswahl grau, und kein Öffnen half (WI-0252, gemessen an echten Daten: die Prüfung
 * brach bei großen Flächen an der Zeitgrenze ab). Die Frist hält ein Menü, das sich mehrfach aufbaut, von einer Welle Anfragen ab.
 */
export const FEHLER_NEU_NACH_MS = 3000;

export interface FlaechenVereinigen {
    /**
     * Der Eintrag für diese Auswahl; ohne zwei oder mehr gewählte keiner. `artName` nennt die Art einer Fläche (Landschaft: die Art der
     * Tafel, Gebiet: sein Typ); `sperre` sagt, warum diese Sitzung nicht schreiben darf (Rechte, `MAP_EDITING`).
     */
    eintrag(
        auswahl: FlaechenAuswahl | undefined,
        artName: (art: FlaechenArt, typ: string) => string,
        sperre: MessageKey | undefined,
    ): VereinigenEintrag | undefined;
    /** Wartet, bis die Prüfung dieser Auswahl da ist (dann kommt das Menü noch einmal). */
    bereit(auswahl: FlaechenAuswahl | undefined): Promise<void>;
    /** „Flächen vereinigen“ mit dieser Vorlage: EINE Operation; den Satz einer Ablehnung zurück. */
    vereinige(
        auswahl: FlaechenAuswahl,
        vorlage: string,
    ): Promise<{ ok: true; quittung: FlaechenVereinigenReceipt; n: number } | { ok: false; satz: string }>;
    /** Vergisst alle Prüfungen (nach jedem Schreiben an Flächen). */
    vergiss(): void;
}

export function createFlaechenVereinigen(
    fetcher: Fetcher = (eingabe, init) => fetch(eingabe, init),
    jetzt: () => number = () => Date.now(),
): FlaechenVereinigen {
    const pruefungen = new Map<string, Pruefung>();

    const pruefe = (auswahl: FlaechenAuswahl): Pruefung => {
        const schluessel = auswahlSchluessel(auswahl);
        const da = pruefungen.get(schluessel);
        if (da !== undefined && !(da.stand === "fehler" && jetzt() - (da.fehlerUm ?? 0) >= FEHLER_NEU_NACH_MS))
            return da;
        const neu: Pruefung = { stand: "laedt", warte: Promise.resolve() };
        neu.warte = getJson<FlaechenVereinigenPruefung>(
            `${URL_JE_ART[auswahl.art]}?ids=${encodeURIComponent(auswahl.ids.join(","))}`,
            (url, init) => fetcher(url, { ...init, cache: "no-store" }),
        ).then(
            (pruefung) => {
                neu.stand = "da";
                neu.pruefung = pruefung;
            },
            () => {
                neu.stand = "fehler";
                neu.fehlerUm = jetzt();
            },
        );
        pruefungen.set(schluessel, neu);
        return neu;
    };
    const genug = (auswahl: FlaechenAuswahl | undefined): auswahl is FlaechenAuswahl =>
        auswahl !== undefined && auswahl.ids.length >= 2;

    return {
        eintrag(auswahl, artName, sperre) {
            if (!genug(auswahl)) return undefined;
            const leer = (grund: MessageKey): VereinigenEintrag => ({
                id: VEREINIGEN_EINTRAG,
                text: "ortseditor.anlegen.vereinigen",
                grund,
                wahlen: [],
            });
            if (sperre !== undefined) return leer(sperre);
            if (auswahl.ids.length > FLAECHEN_VEREINIGEN_MAX) return leer("ortseditor.vereinigen.grund.zuViele");
            const p = pruefe(auswahl);
            if (p.stand === "laedt") return leer(VEREINIGEN_GRUND.laedt);
            if (p.stand === "fehler" || p.pruefung === undefined) return leer(VEREINIGEN_GRUND.fehler);
            const pruefung = p.pruefung;
            if (!pruefung.geht)
                return leer(
                    pruefung.grund === "art" ? ART_GRUND[auswahl.art] : VEREINIGEN_GRUND[pruefung.grund ?? "fehler"],
                );
            const vorlagen = new Set(pruefung.vorlagen ?? []);
            return {
                id: VEREINIGEN_EINTRAG,
                text: "ortseditor.anlegen.vereinigen",
                wahlen: pruefung.objekte
                    .filter((o) => vorlagen.has(o.publicId))
                    .map((o) => ({
                        id: o.publicId,
                        text: o.name,
                        hinweis: artName(auswahl.art, o.art),
                        vorschau: true,
                    })),
            };
        },
        async bereit(auswahl) {
            if (!genug(auswahl) || auswahl.ids.length > FLAECHEN_VEREINIGEN_MAX) return;
            await pruefe(auswahl).warte;
        },
        async vereinige(auswahl, vorlage) {
            const pruefung = pruefungen.get(auswahlSchluessel(auswahl))?.pruefung;
            if (pruefung === undefined || !pruefung.geht)
                return { ok: false, satz: "Die Prüfung ist nicht mehr aktuell; das Menü noch einmal öffnen." };
            const body: FlaechenVereinigenBody = {
                operationId: newOperationId(),
                objects: pruefung.objekte.map((o) => ({ publicId: o.publicId, baseRevision: o.revision })),
                vorlage,
            };
            const antwort = await sende<FlaechenVereinigenReceipt>(URL_JE_ART[auswahl.art], body, "POST", fetcher);
            pruefungen.clear();
            return antwort.ok
                ? { ok: true, quittung: antwort.quittung, n: pruefung.objekte.length }
                : { ok: false, satz: antwort.fehler.message };
        },
        vergiss() {
            pruefungen.clear();
        },
    };
}
