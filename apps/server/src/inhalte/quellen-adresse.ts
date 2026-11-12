import type { InhalteAdressAuskunft, InhalteAdressKorpus } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { holeOeffentlicheSeite, type Abruf } from "../http/oeffentlicher-abruf.ts";
import { findeGleicheQuelle, korpusSchluesselDerAdresse } from "./adress-vergleich.ts";
import {
    angabenMit,
    bestandDerDomain,
    KORPUS_SPALTEN,
    korpusForm,
    lizenzAussage,
    quellenTyp,
    traegerDerDomain,
    type KorpusZeile,
} from "./korpora-lesen.ts";
import { rechteDerNeuenQuelle, vorgabeVon } from "./korpora-vorgabe.ts";
import { VERWENDUNGEN_SQL } from "./quellen-lesen.ts";
import { pruefeAdresse } from "./quellen-schreiben.ts";
import { leseSeitentitel } from "./seitentitel.ts";

/**
 * „Was ist das für eine Adresse?“ (WI-0277): die Auskunft, die das Feld „＋ Quelle“ holt, sobald ein Link darin steht. Legacys `inspect_url` (`api/_internal/app/source-inspect.php`). Nur lesend.
 *
 * 🔴 **Erst im Katalog nachsehen, dann erst nach draußen:** Eine bekannte Seite ist sofort fertig und fragt den fremden Server nicht; ihr Titel steht ohnehin fest.
 *
 * - **Der Korpus** kommt allein aus der Domain (`korpusSchluesselDerAdresse`), genau wie beim Anlegen. `sourceType` und `isOfficial` tragen, was er einer NEUEN Quelle vorgibt (`vorgabeVon`, `null`: frei wählbar); Lizenz und Namensnennung
 *   übernimmt `legeQuelleAn` von jedem Korpus. Was der Korpus nicht trägt, kommt aus dem Bestand seiner Domain (`bestandVon`): Die Auskunft zeigt genau, was `legeQuelleAn` dann schreibt.
 * - **Vier Ausgänge des Abrufs:** `gelesen` (Titel gefunden), `erreichbar` (antwortet, aber kein Titel: etwa ein PDF; der Link ist in Ordnung), `unerreichbar` (keine Antwort oder ein Fehlerstatus, `httpStatus` nennt ihn) und
 *   `nicht_geprueft` (keine öffentliche Seite, gar nicht gefragt). Keiner hindert am Anlegen: Das Eintragen hängt nicht an einem fremden Server.
 */

type Hole = (adresse: string) => Promise<Abruf>;

async function korpusDerAdresse(database: Queryable, url: string): Promise<InhalteAdressKorpus | null> {
    const domain = korpusSchluesselDerAdresse(url);
    if (domain === "") return null;
    const [zeile] = await database.unsafe<KorpusZeile[]>(
        `SELECT ${KORPUS_SPALTEN} FROM source_corpus c WHERE c.corpus_key = $1`,
        [domain],
    );
    if (zeile === undefined) return null;
    const vorgabe = vorgabeVon(angabenMit(zeile));
    const bestand = await bestandDerDomain(database, domain, korpusForm(zeile.form));
    const rechte = rechteDerNeuenQuelle(url, zeile, bestand);
    const [zahl] = await database<{ n: number }[]>`
        SELECT count(*)::int AS n FROM feature_source WHERE corpus_key = ${domain} AND is_active
    `;
    const [lizenz] =
        rechte.key === null
            ? []
            : await database<{ display_name: string }[]>`
                  SELECT display_name FROM license_catalog WHERE key = ${rechte.key}
              `;
    return {
        key: zeile.corpus_key,
        name: zeile.label === "" ? zeile.corpus_key : zeile.label,
        sourceType: vorgabe.sourceType === null ? null : quellenTyp(vorgabe.sourceType),
        isOfficial: vorgabe.isOfficial,
        artVorschlag: bestand.sourceType === null ? null : quellenTyp(bestand.sourceType),
        offiziellVorschlag: bestand.isOfficial,
        lizenzAussage: lizenzAussage(rechte.aussage),
        lizenzName: lizenz?.display_name ?? null,
        attribution: rechte.attribution,
        rechteAusBestand: rechte.ausBestand,
        quellen: zahl?.n ?? 0,
        objekte: await traegerDerDomain(database, domain),
    };
}

export async function adressAuskunft(
    database: Queryable,
    roh: string,
    hole: Hole = holeOeffentlicheSeite,
): Promise<InhalteAdressAuskunft> {
    const url = pruefeAdresse(roh);
    const korpus = await korpusDerAdresse(database, url);
    const gleich = await findeGleicheQuelle(database, url);
    if (gleich !== undefined) {
        const [verwendung] = await database.unsafe<{ uses: number }[]>(
            `SELECT (${VERWENDUNGEN_SQL})::int AS uses FROM feature_source f WHERE f.public_id = $1::uuid`,
            [gleich.id],
        );
        return {
            url,
            zustand: "bekannt",
            korpus,
            vorhanden: {
                id: gleich.id,
                title: gleich.title,
                url: gleich.url,
                sourceType: quellenTyp(gleich.source_type),
                stillgelegt: !gleich.is_active,
                uses: verwendung?.uses ?? 0,
                gleicheAdresse: gleich.url === url,
            },
        };
    }
    const abruf = await hole(url);
    if (abruf.art === "gesperrt") return { url, zustand: "nicht_geprueft", korpus, vorhanden: null };
    if (abruf.art === "keine_antwort") return { url, zustand: "unerreichbar", korpus, vorhanden: null };
    if (abruf.status < 200 || abruf.status >= 300) {
        return { url, zustand: "unerreichbar", httpStatus: abruf.status, korpus, vorhanden: null };
    }
    const titel = abruf.html === undefined ? "" : leseSeitentitel(abruf.html, korpus?.name);
    return titel === ""
        ? { url, zustand: "erreichbar", httpStatus: abruf.status, korpus, vorhanden: null }
        : { url, zustand: "gelesen", httpStatus: abruf.status, titel, korpus, vorhanden: null };
}
