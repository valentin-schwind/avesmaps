import {
    WIKISYNC_KLIMAZONEN,
    wikisyncPilleGueltig,
    wikisyncPilleZerlegt,
    type WikisyncBegriffLage,
} from "@avesmaps3d/shared";
import { VORGABE_DATEI as DATEI, type VorgabeWort } from "./begriffe-vorgabe.ts";

/**
 * Die Begriffstafel der Regelableitung (WI-0253 Scheibe Regelvorschläge, §24; Vali 2026-10-27, F5): jedes Wort des Wikis, das eine Landschaftsart oder Klimazone meint, mit seiner Zuweisung als Pillen
 * (`vegetation|wald`, `zone|tropisch`). REIN: keine Datenbank. Die Startwerte (`begriffe-vorgabe.json`, Claudias Näherungen aus `review/wi-0253/regelbuch/regelbuch-abbildung.json`) gelten, wo die Umgebung
 * nichts anderes gespeichert hat (`wikisync_begriff_setting`, nur Abweichungen wie bei den Kanon-Tafeln); die nächste Ableitung liest die Tafel, wie sie dann ist.
 *
 * Gelesen wird in dieser Reihenfolge (Regelbuch 3b): das ganze Wort; sonst der Kopf am Wortende („Laubwälder“ → „wälder“); sonst das Bestimmungswort vor einem allgemeinen Kopf („Steppengebiete“, „Wüstenrand“ =
 * Wüste + Rand); ein Bindestrich-Wort („Nord-“) über sein Bestimmungswort. Eine Zuweisung gilt als Entscheidung: Ein Wort mit Pillen ist automatisch (auch eine Näherung), ein Wort ohne Pillen ist offen
 * (mehrdeutig: muss entschieden werden), eine Lücke (keine passende Art im Modell) oder übergangen (Kleinstandort: engt nur ein).
 *
 * **Familien:** Die Beugungsformen und Schreibweisen EINES Worts (kalt, kalte, kalten, kaltes, kälteren) bilden eine Familie mit einem Kopfwort (`familie` der Startwerte, von Hand abgelegt). Die Umgebung speichert eine
 * Entscheidung unter dem Kopfwort; sie gilt für alle Formen. Ein Wort ohne Startwert (von Hand angelegt) ist seine eigene Familie.
 *
 * **Großräume** (Gruppe `grossraum`, Vali 2026-10-27, Option A): Zeilen der Tafel, die kein WORT sind, sondern ein Wiki-Artikel ohne Fläche in der Karte („Hoher Norden“). Ihr Schlüssel ist der Titel klein, Leerraum
 * zu `-` (`grossraumWort`). `eintrag` und damit die Wortlesung kennen sie nicht (der Link `[[Klirrfrostwüste]]` bleibt ein Ort, die freie Silbe „wüste“ liest weiter als Wüste); nur `grossraum(titel)` liefert sie, und nur,
 * solange ihre geltenden Pillen mindestens eine Pille tragen. Leere Pillen in der Umgebung („bewusst keine“) schalten einen Großraum ab. Im Fenster „Begriffstafel“ stehen sie wie jede Familie (`familien`).
 */

export type { VorgabeWort };

/** Die Startwerte, nach Wort. */
export const BEGRIFFE_VORGABE: ReadonlyMap<string, VorgabeWort> = new Map(
    DATEI.woerter.map((eintrag) => [eintrag.wort, eintrag]),
);

/** Wort → Kopfwort seiner Familie, für die Wörter der Startwerte. Jedes andere Wort ist seine eigene Familie. */
const FAMILIE_VON: ReadonlyMap<string, string> = new Map(
    DATEI.woerter.map((eintrag) => [eintrag.wort, eintrag.familie]),
);

/** Kopfwort → alle Formen der Familie, das Kopfwort zuerst, die übrigen in der Reihenfolge der Startwerte. */
const FAMILIE_FORMEN: ReadonlyMap<string, readonly string[]> = (() => {
    const jeKopf = new Map<string, string[]>();
    for (const eintrag of DATEI.woerter) {
        const formen = jeKopf.get(eintrag.familie) ?? [];
        // Das Kopfwort steht vorn, auch wo es im Startwert nicht das erste Wort der Familie ist.
        if (eintrag.wort === eintrag.familie) formen.unshift(eintrag.wort);
        else formen.push(eintrag.wort);
        jeKopf.set(eintrag.familie, formen);
    }
    return jeKopf;
})();

/** Das Kopfwort der Familie dieses Worts (klein geschrieben); ein Wort ohne Startwert ist sein eigener Kopf. */
export const familieVon = (wort: string): string => FAMILIE_VON.get(wort) ?? wort;

/** Alle Formen der Familie mit diesem Kopfwort, das Kopfwort zuerst; ein Wort ohne Startwert steht allein. */
export const formenDerFamilie = (kopf: string): readonly string[] => FAMILIE_FORMEN.get(kopf) ?? [kopf];

/** Ein Wort der Tafel, wie die Ableitung es liest: die geltenden Pillen und was ein Wort ohne Pillen bedeutet. */
export interface TafelEintrag {
    wort: string;
    /** Das Kopfwort der Familie des Worts; unter ihm steht die Entscheidung der Umgebung. */
    familie: string;
    /** Die geltenden Pillen: die Abweichung der Umgebung, sonst der Startwert. */
    pillen: readonly string[];
    /** Wie sicher das Wort ist; bei einer eigenen Wahl mit Pillen `gleichwertig`. */
    lage: WikisyncBegriffLage;
    /** Die Gruppe der Startwerte (`wald`, `fluss`, `unterwelt`, `mikro` …); ein Wort ohne Startwert hat keine. */
    gruppe: string;
    /** Die Zeile weicht vom Startwert ab oder ist von Hand angelegt. */
    eigen: boolean;
    vorgabe: VorgabeWort | null;
}

/** Wie ein Wort an einem Satz hing: allein, als Kopf eines Kompositums, als Bestimmungswort, mit Bindestrich oder als Kompositum am Link. */
export type WortForm = "" | "kompositum" | "bindestrich" | "gebiet" | "rand" | "ufer" | "hang" | "nahe" | "mikro";

export interface WortAbbildung {
    eintrag: TafelEintrag;
    form: WortForm;
}

/** Das Wort, wie die Tafel es führt: klein geschrieben, ohne führenden und folgenden Bindestrich. */
export const tafelWort = (wort: string): string => wort.toLowerCase().replace(/^-+|-+$/gu, "");

/** Die Gruppe der Startwerte, die einen Großraum bezeichnet (kein Wort, sondern ein Wiki-Artikel ohne Fläche). */
export const GRUPPE_GROSSRAUM = "grossraum";

/**
 * Der Schlüssel eines Großraums in der Tafel: der Artikeltitel klein, Leerraum zu `-` („Hoher Norden“ → `hoher-norden`). Er erfüllt `WIKISYNC_WORT_MUSTER` und die Prüfung von
 * `wikisync_begriff_setting.wort` (kein Leerraum), braucht also keine eigene Spalte.
 */
export const grossraumWort = (titel: string): string => titel.trim().toLowerCase().replace(/\s+/gu, "-");

/** Ein Großraum, wie die Ableitung ihn liest: die geltenden Pillen und der Titel der Fläche, in der die Klimaspanne gilt (`null`: ohne umgebende Fläche, überall). */
export type GrossraumEintrag = TafelEintrag & { innerhalb: string | null };

/** Eine Pille, die es nicht gibt, wird nie gespeichert; die Ableitung überspringt sie. */
const gueltig = (pillen: readonly string[]): string[] => pillen.filter((pille) => wikisyncPilleGueltig(pille));

/** Eine Familie der Tafel: ihr Kopfwort mit der geltenden Zuweisung und alle Formen (das Kopfwort zuerst). */
export interface TafelFamilie {
    kopf: TafelEintrag;
    formen: readonly string[];
}

export class Begriffstafel {
    /** Die Entscheidungen der Umgebung, nach dem Kopfwort der Familie. */
    private readonly abweichungen: ReadonlyMap<string, readonly string[]>;
    private readonly koepfe: readonly string[];

    /**
     * `abweichungen`: die gespeicherten Zeilen der Umgebung (Wort → Pillen, auch leer). Eine Zeile gehört dem Kopfwort ihrer Familie; steht sie unter einer anderen Form (eine ältere Zeile), gilt sie
     * für die Familie, wo das Kopfwort keine eigene Zeile hat.
     */
    constructor(abweichungen: ReadonlyMap<string, readonly string[]> = new Map()) {
        const nachKopf = new Map<string, readonly string[]>();
        for (const [wort, pillen] of abweichungen) if (familieVon(wort) === wort) nachKopf.set(wort, pillen);
        for (const [wort, pillen] of abweichungen) {
            const kopf = familieVon(wort);
            if (!nachKopf.has(kopf)) nachKopf.set(kopf, pillen);
        }
        this.abweichungen = nachKopf;
        this.koepfe = [...DATEI.koepfe].sort((a, b) => b.length - a.length);
    }

    /** Der Eintrag zu genau diesem Wort (klein geschrieben); `undefined`, wo die Tafel das Wort nicht kennt. Ein Großraum ist kein Wort und steht hier nicht (`grossraum`). */
    eintrag(wort: string): TafelEintrag | undefined {
        const zeile = this.zeile(wort);
        return zeile?.gruppe === GRUPPE_GROSSRAUM ? undefined : zeile;
    }

    /**
     * Der Großraum zu diesem Artikeltitel („Hoher Norden“); `undefined`, wo die Tafel keinen kennt oder er abgeschaltet ist: Eine Zeile der Umgebung mit leeren Pillen heißt „bewusst keine
     * Klimaspanne“, dann bleibt der Artikel eine offene Fläche. Ob eine Fläche der Karte den Artikel trägt, weiß die Tafel nicht; die Ableitung fragt erst dort.
     */
    grossraum(titel: string): GrossraumEintrag | undefined {
        const zeile = this.zeile(grossraumWort(titel));
        if (zeile === undefined || zeile.gruppe !== GRUPPE_GROSSRAUM || zeile.pillen.length === 0) return undefined;
        return { ...zeile, innerhalb: zeile.vorgabe?.innerhalb ?? null };
    }

    /** Kennt die Tafel diesen Artikel als Großraum, auch wenn die Umgebung ihn abgeschaltet hat? Nur zum Zählen der Nennungen. */
    istGrossraum(titel: string): boolean {
        return BEGRIFFE_VORGABE.get(grossraumWort(titel))?.gruppe === GRUPPE_GROSSRAUM;
    }

    /** Die Zeile der Tafel zu diesem Schlüssel: Wort oder Großraum (Startwert, Abweichung der Umgebung, Pillen, Lage). */
    private zeile(wort: string): TafelEintrag | undefined {
        const vorgabe = BEGRIFFE_VORGABE.get(wort);
        const kopf = familieVon(wort);
        const eigene = this.abweichungen.get(kopf);
        if (vorgabe === undefined && eigene === undefined) return undefined;
        const pillen = gueltig(eigene ?? vorgabe?.pillen ?? []);
        const eigen = eigene !== undefined;
        return {
            wort,
            familie: kopf,
            pillen,
            lage:
                eigen && pillen.length > 0
                    ? "gleichwertig"
                    : pillen.length === 0 && eigen && vorgabe === undefined
                      ? "offen"
                      : (vorgabe?.lage ?? "neu"),
            gruppe: vorgabe?.gruppe ?? "",
            eigen: eigen && (vorgabe === undefined || !gleichePillen(eigene, vorgabe.pillen)),
            vorgabe: vorgabe ?? null,
        };
    }

    /** Alle Familien der Tafel: die der Startwerte (auch die Großräume) und die von Hand angelegten Wörter (jedes seine eigene). */
    familien(): TafelFamilie[] {
        const koepfe = new Set<string>([...FAMILIE_FORMEN.keys(), ...this.abweichungen.keys()]);
        return [...koepfe].flatMap((kopf) => {
            const eintrag = this.zeile(kopf);
            return eintrag === undefined ? [] : [{ kopf: eintrag, formen: formenDerFamilie(kopf) }];
        });
    }

    /** Die ausdrücklich nicht gelesenen Klimawörter („südlichen“). */
    static readonly KLIMA_OHNE: ReadonlySet<string> = new Set(DATEI.klimaOhne);

    /**
     * Python `wort_abbildung`: erst das ganze Wort, dann der Kopf am Wortende, dann das Bestimmungswort vor einem allgemeinen Kopf, dann ein Bindestrich-Wort über sein Bestimmungswort.
     * `undefined`, wo nichts passt.
     */
    abbildung(wort: string): WortAbbildung | undefined {
        const w0 = tafelWort(wort);
        if (w0 === "") return undefined;
        const ganz = this.eintrag(w0);
        if (ganz !== undefined) return { eintrag: ganz, form: "" };
        for (const kopf of this.koepfe) {
            if (w0.endsWith(kopf) && w0.length > kopf.length + 2) {
                const basis = this.eintrag(kopf);
                if (basis !== undefined) return { eintrag: basis, form: "kompositum" };
            }
        }
        for (const [generisch, rest] of Object.entries(DATEI.generisch)) {
            if (w0.endsWith(generisch) && w0.length > generisch.length + 2) {
                const bestimmung = w0
                    .slice(0, w0.length - generisch.length)
                    .replace(/s+$/u, "")
                    .replace(/-+$/u, "");
                const kandidaten = [
                    bestimmung,
                    `${bestimmung}e`,
                    bestimmung.replace(/n+$/u, ""),
                    bestimmung.endsWith("en") ? bestimmung.slice(0, -2) : "",
                    DATEI.staemme[bestimmung] ?? "",
                    DATEI.staemme[`${bestimmung}s`] ?? "",
                ];
                for (const kandidat of kandidaten) {
                    if (kandidat === "") continue;
                    const basis = this.eintrag(kandidat);
                    if (basis !== undefined)
                        return { eintrag: basis, form: (rest === "" ? "gebiet" : rest) as WortForm };
                }
            }
        }
        if (wort.endsWith("-")) {
            const kandidaten = [w0, `${w0}e`, w0.replace(/n+$/u, ""), DATEI.staemme[w0] ?? ""];
            for (const kandidat of kandidaten) {
                if (kandidat === "") continue;
                const basis = this.eintrag(kandidat);
                if (basis !== undefined) return { eintrag: basis, form: "bindestrich" };
            }
        }
        return undefined;
    }
}

function gleichePillen(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    const menge = new Set(a);
    return b.every((pille) => menge.has(pille));
}

/** Die Pillen in Landschaftsarten (Ebene, Art) und die Klimaspanne zerlegt. Die Spanne reicht von der kältesten bis zur wärmsten Zone der Pillen. */
export function pillenGelesen(pillen: readonly string[]): {
    arten: { ebene: string; art: string }[];
    klima: { von: string; bis: string } | null;
} {
    const arten: { ebene: string; art: string }[] = [];
    const zonen: number[] = [];
    for (const pille of pillen) {
        const teil = wikisyncPilleZerlegt(pille);
        if (teil === null) continue;
        if (teil.art === "art") arten.push({ ebene: teil.ebene, art: teil.wert });
        else zonen.push(WIKISYNC_KLIMAZONEN.indexOf(teil.wert));
    }
    arten.sort((a, b) => (a.ebene === b.ebene ? a.art.localeCompare(b.art) : a.ebene.localeCompare(b.ebene)));
    if (zonen.length === 0) return { arten, klima: null };
    const von = WIKISYNC_KLIMAZONEN[Math.min(...zonen)] as string;
    const bis = WIKISYNC_KLIMAZONEN[Math.max(...zonen)] as string;
    return { arten, klima: { von, bis } };
}
