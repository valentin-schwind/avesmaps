import { INHALTE_KORPUS_VORGABEN, type InhalteKorpusForm, type InhalteKorpusVorgabe } from "@avesmaps3d/shared";

/**
 * Die Vorgabe eines Korpus für die Quellen seiner Domain (WI-0254, Runde 4; Vali: „Belegstellen-Korpus ja, wenn ich da was änder, änderts überall, was den
 * Korpus verwendet“), rein, ohne Datenbank. Eine Quelle der Redaktion, der Import und das Fenster rechnen alle mit denselben Sätzen:
 *
 * - 🔴 **Nur eine Belegstelle gibt vor.** Bei `werk` und unentschiedener Form (`''`) bleiben Art, „offiziell“, Lizenz und Namensnennung an der Quelle;
 *   nichts schreibt durch, und die Felder sind am Korpus gesperrt. (Bei einem Werk-Korpus wie f-shop.de mit gemischten Abenteuer- und Romanarten wäre ein
 *   Durchschreiben ein Fehler.)
 * - 🔴 **Nur was gesetzt ist, gibt vor.** Art und „offiziell“ am Korpus sind nullable (NULL = keine Vorgabe); eine Lizenzaussage `unrecorded` („nicht erfasst“,
 *   nie „keine Lizenz“) und eine leere Namensnennung geben nichts vor und nehmen nichts zurück.
 * - **Überall heißt überall:** Es gibt keine Ausnahme je Quelle (`own_fields` wird nicht gebaut). Eine Quelle, die vom Korpus vorgegebene Werte trägt, ändert
 *   sie nur über den Korpus.
 */

/** Die Werte einer Quelle, soweit die Vorgabe sie berührt. */
export interface QuellenWerte {
    sourceType: string;
    isOfficial: boolean;
    lizenzAussage: string;
    lizenzKey: string | null;
    attribution: string | null;
}

/** Die Angaben des Korpus, aus denen die Vorgabe entsteht (nach einer Änderung: die, die danach gelten). */
export interface KorpusAngaben {
    form: InhalteKorpusForm;
    sourceType: string | null;
    isOfficial: boolean | null;
    lizenzAussage: string;
    lizenzKey: string | null;
    attribution: string | null;
}

/** Was der Korpus den Quellen vorgibt; `null` je Feld: keine Vorgabe. */
export interface Vorgabe {
    sourceType: string | null;
    isOfficial: boolean | null;
    /** Aussage und Schlüssel gehören zusammen (`license` mit Schlüssel, sonst `public_domain` oder `unfree` ohne). */
    lizenz: { aussage: string; key: string | null } | null;
    attribution: string | null;
}

export const KEINE_VORGABE: Vorgabe = { sourceType: null, isOfficial: null, lizenz: null, attribution: null };

const nurText = (wert: string | null | undefined): string | null => {
    const text = (wert ?? "").trim();
    return text === "" ? null : text;
};

export function vorgabeVon(korpus: KorpusAngaben): Vorgabe {
    if (korpus.form !== "belegstelle") return KEINE_VORGABE;
    const lizenz =
        korpus.lizenzAussage === "unrecorded"
            ? null
            : { aussage: korpus.lizenzAussage, key: korpus.lizenzAussage === "license" ? korpus.lizenzKey : null };
    return {
        sourceType: korpus.sourceType,
        isOfficial: korpus.isOfficial,
        lizenz,
        attribution: nurText(korpus.attribution),
    };
}

/** Die Felder, die diese Vorgabe gesetzt hat, in fester Folge. */
export function gibtVor(vorgabe: Vorgabe): InhalteKorpusVorgabe[] {
    return INHALTE_KORPUS_VORGABEN.filter((feld) =>
        feld === "sourceType"
            ? vorgabe.sourceType !== null
            : feld === "isOfficial"
              ? vorgabe.isOfficial !== null
              : feld === "lizenz"
                ? vorgabe.lizenz !== null
                : vorgabe.attribution !== null,
    );
}

/** Die Felder, in denen die Quelle von der Vorgabe abweicht (nur die gesetzten). */
export function weichtAb(vorgabe: Vorgabe, quelle: QuellenWerte): InhalteKorpusVorgabe[] {
    return gibtVor(vorgabe).filter((feld) => {
        switch (feld) {
            case "sourceType":
                return quelle.sourceType !== vorgabe.sourceType;
            case "isOfficial":
                return quelle.isOfficial !== vorgabe.isOfficial;
            case "lizenz":
                return quelle.lizenzAussage !== vorgabe.lizenz?.aussage || quelle.lizenzKey !== vorgabe.lizenz.key;
            case "attribution":
                return nurText(quelle.attribution) !== vorgabe.attribution;
        }
    });
}

/**
 * Trägt die Quelle heute eine AUSSAGE in diesem Feld, die eine Änderung überschreibt (und nicht nur den leeren Wert)? Die Art `sonstiges` ist im Haus die
 * Nicht-Aussage (Legacy macht aus leer beim Anlegen `sonstiges`), eine Lizenzaussage `unrecorded` und eine leere Namensnennung ebenso. „Offiziell“ ist
 * beim Katalog nie leer: Jeder Wert ist eine Aussage.
 */
export function tragtAussage(feld: InhalteKorpusVorgabe, quelle: QuellenWerte): boolean {
    switch (feld) {
        case "sourceType":
            return quelle.sourceType !== "sonstiges";
        case "isOfficial":
            return true;
        case "lizenz":
            return quelle.lizenzAussage !== "unrecorded";
        case "attribution":
            return nurText(quelle.attribution) !== null;
    }
}

/** Der Wert, den ein Feld nach der Vorgabe trägt, als Text für die Anzeige der Wirkung. */
export function wertText(feld: InhalteKorpusVorgabe, vorgabe: Vorgabe): string {
    switch (feld) {
        case "sourceType":
            return vorgabe.sourceType ?? "";
        case "isOfficial":
            return vorgabe.isOfficial === null ? "" : vorgabe.isOfficial ? "ja" : "nein";
        case "lizenz":
            return vorgabe.lizenz === null ? "" : (vorgabe.lizenz.key ?? vorgabe.lizenz.aussage);
        case "attribution":
            return vorgabe.attribution ?? "";
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Was der Bestand einer Domain sagt
// ---------------------------------------------------------------------------------------------------------------------

/** Quellen einer Domain mit denselben Werten, und wie viele es sind. */
export interface BestandsGruppe {
    sourceType: string;
    isOfficial: boolean;
    lizenzAussage: string;
    lizenzKey: string | null;
    attribution: string | null;
    n: number;
}

/** Was eine neue Quelle der Domain aus dem Bestand übernimmt, wo der Korpus selbst nichts trägt; `null`: Der Bestand sagt nichts. */
export interface Bestand {
    sourceType: string | null;
    isOfficial: boolean;
    lizenz: { aussage: string; key: string | null } | null;
    attribution: string | null;
}

export const KEIN_BESTAND: Bestand = { sourceType: null, isOfficial: false, lizenz: null, attribution: null };

/** Unter so vielen Quellen ist eine Einigkeit Zufall (Legacy: „unter drei Zeilen schweigt er“). */
const BESTAND_MINDEST = 3;

/** Die häufigste Aussage: mit ihrer Zahl und der Zahl aller anderen. Ein Gleichstand ist keine Aussage. */
function haeufigste(gruppen: readonly BestandsGruppe[], aussage: (gruppe: BestandsGruppe) => string | null) {
    const zahlen = new Map<string, number>();
    for (const gruppe of gruppen) {
        const wert = aussage(gruppe);
        if (wert !== null) zahlen.set(wert, (zahlen.get(wert) ?? 0) + gruppe.n);
    }
    const folge = [...zahlen.entries()].sort((a, b) => b[1] - a[1]);
    const [erste, zweite] = folge;
    if (erste === undefined || (zweite !== undefined && zweite[1] === erste[1])) return undefined;
    const alle = [...zahlen.values()].reduce((summe, n) => summe + n, 0);
    return { wert: erste[0], n: erste[1], rest: alle - erste[1] };
}

/**
 * Was die Quellen einer Domain gemeinsam sagen (WI-0277), rein, ohne Datenbank. Der Abgleich aus Legacy brachte vom Korpus nur Schlüssel, Name und Anzeigeform (`sources.ts`, `CORPUS_COLUMNS`); Art, Lizenz und
 * Namensnennung stehen seither an den Quellen. Eine neue Quelle der Domain bekommt sie von dort: „Aus vorhandenen Werten ableiten“, ohne dass ein Korpus oder eine Quelle dafür geändert wird.
 *
 * - **Nur außerhalb von Werk-Korpora:** Dort ist jede Quelle etwas anderes (ein Shop mit Abenteuern und Romanen); Art und Lizenz gehören der einzelnen Quelle.
 * - **Die Art** ist die Mehrheit der getroffenen Aussagen (Legacy, `avesmapsSourceCorpusTypeSuggestion`; `sonstiges` ist die Nicht-Aussage): mindestens die Hälfte aller Quellen und mehr als doppelt so viele wie alle anderen
 *   Aussagen. Sie ist nur eine Vorbelegung, der Mensch kann sie ändern. „Offiziell“ belegt nur vor, wenn mindestens zwei Drittel offiziell sind.
 * - 🔴 **Lizenz und Namensnennung werden nicht erfunden** (WI-0254 §5): mindestens die Hälfte aller Quellen trägt eine Aussage, und mindestens 95 % dieser Aussagen sind dieselbe. Sonst bleibt es „nicht erfasst“.
 */
export function bestandVon(form: InhalteKorpusForm, gruppen: readonly BestandsGruppe[]): Bestand {
    const gesamt = gruppen.reduce((summe, gruppe) => summe + gruppe.n, 0);
    if (form === "werk" || gesamt < BESTAND_MINDEST) return KEIN_BESTAND;
    const traegt = (treffer: { n: number } | undefined): boolean => treffer !== undefined && treffer.n * 2 >= gesamt;
    const einig = (treffer: { n: number; rest: number } | undefined): boolean =>
        treffer !== undefined && treffer.rest * 19 <= treffer.n;

    const art = haeufigste(gruppen, (gruppe) => (gruppe.sourceType === "sonstiges" ? null : gruppe.sourceType));
    const lizenz = haeufigste(gruppen, (gruppe) =>
        gruppe.lizenzAussage === "unrecorded" ? null : `${gruppe.lizenzAussage}/${gruppe.lizenzKey ?? ""}`,
    );
    const nennung = haeufigste(gruppen, (gruppe) => nurText(gruppe.attribution));
    const offiziell = gruppen.reduce((summe, gruppe) => summe + (gruppe.isOfficial ? gruppe.n : 0), 0);
    const [aussage, key] = lizenz?.wert.split("/") ?? [];
    return {
        sourceType: art !== undefined && traegt(art) && art.n > art.rest * 2 ? art.wert : null,
        isOfficial: offiziell * 3 >= gesamt * 2,
        lizenz:
            aussage !== undefined && traegt(lizenz) && einig(lizenz)
                ? { aussage, key: key === undefined || key === "" ? null : key }
                : null,
        attribution: nennung !== undefined && traegt(nennung) && einig(nennung) ? nennung.wert : null,
    };
}

/**
 * Zeigt die Adresse auf eine Datei statt auf eine Seite (Bild, PDF, `Datei:` eines Wikis)? Das AlberniaWiki sagt es selbst im Fuß jeder Seite: „Insbesondere Bilddateien können anderen Lizenzen unterliegen“.
 * Eine Datei erbt deshalb keine Rechte aus dem Bestand.
 */
export function istDateiAdresse(url: string): boolean {
    let text = url;
    try {
        text = decodeURIComponent(url);
    } catch {
        // Eine kaputte Kodierung ändert nichts an der Endung.
    }
    return /(?:^|[/:#=])(?:Datei|File|Bild|Image|Media):|\/images\/|\.(?:jpe?g|png|gif|webp|svg|tiff?|pdf)(?:$|[?#])/iu.test(
        text,
    );
}

/** Die Rechte, die eine neue Quelle dieser Adresse bekommt: die des Korpus, sonst die des Bestands; `ausBestand`: mindestens eines kommt daher. EINE Stelle für die Auskunft und das Anlegen. */
export function rechteDerNeuenQuelle(
    url: string,
    korpus: { license_statement: string; license_key: string | null; attribution: string | null } | undefined,
    bestand: Bestand,
): { aussage: string; key: string | null; attribution: string | null; ausBestand: boolean } {
    const erbt = !istDateiAdresse(url);
    const eigeneLizenz = korpus !== undefined && korpus.license_statement !== "unrecorded";
    const geerbteLizenz = !eigeneLizenz && erbt ? bestand.lizenz : null;
    const eigeneNennung = korpus?.attribution ?? null;
    const geerbteNennung = eigeneNennung === null && erbt ? bestand.attribution : null;
    return {
        aussage: eigeneLizenz ? korpus.license_statement : (geerbteLizenz?.aussage ?? "unrecorded"),
        key: eigeneLizenz ? korpus.license_key : (geerbteLizenz?.key ?? null),
        attribution: eigeneNennung ?? geerbteNennung,
        ausBestand: geerbteLizenz !== null || geerbteNennung !== null,
    };
}
