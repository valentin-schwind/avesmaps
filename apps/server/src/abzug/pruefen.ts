import { Value } from "@sinclair/typebox/value";
import { ABZUG_FORMAT, ABZUG_TAR_MANIFEST, ABZUG_VERSION, AbzugManifest, type AbzugProblem } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { leseKatalog, type Katalog } from "./katalog.ts";
import { lokalZuLeerendeTafeln, mitgenommeneTafeln, type GeladeneRegeln } from "./regeln.ts";
import { erste, pruefeMedienAblage, pruefeMedienListe, problem } from "./medien.ts";
import { listeTar, tarText, type TarEintrag } from "./tar.ts";

/**
 * Die Prüfung eines Abzugs vor dem Einspielen (WI-0251): Ist es überhaupt ein Abzug, und passt er zu dieser Datenbank? Sie liest nur
 * (das Tar und den Katalog) und verändert nichts. Das Einspielen wiederholt sie unmittelbar vor dem Leeren.
 *
 * Die Probleme sind Codes (`AbzugProblemCode`); die Oberfläche setzt den Satz, `detail` nennt die erste Fundstelle.
 */
export interface AbzugPruefung {
    /** `null`, wenn schon das Manifest nicht zu lesen war. */
    readonly manifest: AbzugManifest | null;
    readonly eintraege: readonly TarEintrag[];
    readonly probleme: readonly AbzugProblem[];
    /** Tafeln dieses Stands, die es an der Quelle noch nicht gab; das Einspielen leert sie mit. */
    readonly neueTafeln?: readonly string[];
}

/** Liest Tar und Manifest; das Manifest muss der erste Eintrag sein. */
export async function liesAbzug(
    tarPfad: string,
): Promise<{ manifest: AbzugManifest | null; eintraege: TarEintrag[]; probleme: AbzugProblem[] }> {
    let eintraege: TarEintrag[];
    try {
        eintraege = await listeTar(tarPfad);
    } catch (error) {
        return {
            manifest: null,
            eintraege: [],
            probleme: [problem("datei", error instanceof Error ? error.message : String(error))],
        };
    }
    const kopf = eintraege[0];
    if (kopf === undefined || kopf.name !== ABZUG_TAR_MANIFEST) {
        return {
            manifest: null,
            eintraege,
            probleme: [problem("format", `${ABZUG_TAR_MANIFEST} fehlt als erste Datei`)],
        };
    }
    let roh: unknown;
    try {
        roh = JSON.parse(await tarText(tarPfad, kopf));
    } catch (error) {
        return {
            manifest: null,
            eintraege,
            probleme: [problem("format", error instanceof Error ? error.message : String(error))],
        };
    }
    const objekt = typeof roh === "object" && roh !== null ? (roh as Record<string, unknown>) : {};
    if (objekt["format"] !== ABZUG_FORMAT) {
        return { manifest: null, eintraege, probleme: [problem("format", `format ${String(objekt["format"])}`)] };
    }
    if (objekt["version"] !== ABZUG_VERSION) {
        return { manifest: null, eintraege, probleme: [problem("version", `version ${String(objekt["version"])}`)] };
    }
    if (!Value.Check(AbzugManifest, roh)) {
        const fehler = [...Value.Errors(AbzugManifest, roh)][0];
        return {
            manifest: null,
            eintraege,
            probleme: [problem("format", fehler === undefined ? null : `${fehler.path || "/"}: ${fehler.message}`)],
        };
    }
    return { manifest: roh, eintraege, probleme: [] };
}

interface TafelRecht {
    tafel: string;
    eigener: boolean;
    einfuegen: boolean;
}

/**
 * Prüft einen Abzug gegen diese Datenbank und diese Regeln.
 *
 * - Migrationen: Alles, was die Quelle angewendet hat, muss hier angewendet sein, mit derselben Prüfsumme. Hier darf mehr stehen
 *   (Migrationen sind additiv; die Spaltenprüfung fängt den Rest).
 * - Kartendomäne, Tafeln und Spalten: gleiche Kennung, gleicher Koordinatenraum, gleiche Prüfsumme; jede Tafel und Spalte des Abzugs gibt
 *   es hier mit demselben Typ; eine Spalte, die nur hier steht, braucht eine Vorgabe oder darf leer sein.
 * - Regeln: Der Abzug folgt denselben Regeln wie dieser Stand, oder er ist mindestens so streng (nie weniger Tafeln, die hier
 *   weggelassen würden, und nie ein Personenfeld, das hier leer sein müsste und dort nicht war). Eine Tafel, die der Abzug nicht trägt, ist nur dann in
 *   Ordnung, wenn hier Migrationen stehen, die die Quelle noch nicht hat: Der lokale Stand ist der Quelle voraus, die Tafel gab es dort nicht. Das
 *   Einspielen leert sie mit (`neueTafeln`).
 * - Rechte: Die Rolle dieser Datenbank besitzt die Tafeln (Trigger abschalten, Fremdschlüssel aufschieben) und darf einfügen.
 * - Mediendateien: Pfade im Manifest sind sicher und nicht doppelt, jede Datei liegt im Tar und ist so groß wie genannt, das Tar trägt nichts
 *   Fremdes (`medien/pfad`-Liste gegen die Köpfe, ohne eine Datei zu lesen); und, wenn `medien` übergeben wird, `MEDIA_ROOT` ist eingerichtet,
 *   beschreibbar und hat Platz für das, was lokal fehlt. Die Prüfsummen der Dateien prüft das Einspielen, bevor es etwas verändert.
 */
export async function pruefeAbzug(
    db: Queryable,
    tarPfad: string,
    regeln: GeladeneRegeln,
    katalog?: Katalog,
    medien?: { wurzel: string | undefined },
): Promise<AbzugPruefung> {
    const gelesen = await liesAbzug(tarPfad);
    const { manifest, eintraege } = gelesen;
    if (manifest === null) return { manifest: null, eintraege, probleme: gelesen.probleme };
    const probleme: AbzugProblem[] = [];

    // Dateien: Jede Tafel des Manifests liegt im Tar, und die Liste der Mediendateien stimmt mit den Köpfen des Tars überein.
    const imTar = new Set(eintraege.map((eintrag) => eintrag.name));
    const fehlendeDateien = manifest.tafeln.filter((tafel) => !imTar.has(tafel.datei)).map((tafel) => tafel.datei);
    const mediendateien = pruefeMedienListe(manifest, eintraege);
    const dateiTeile = [
        ...(fehlendeDateien.length > 0 ? [`fehlt im Abzug: ${erste(fehlendeDateien)}`] : []),
        ...mediendateien.dateien,
    ];
    if (dateiTeile.length > 0) probleme.push(problem("datei", dateiTeile.join("; ")));
    if (mediendateien.pfade.length > 0) probleme.push(problem("medien_pfad", mediendateien.pfade.join("; ")));

    // Regeln.
    const hier = new Set(mitgenommeneTafeln(regeln.regeln));
    const dort = new Set(manifest.tafeln.map((tafel) => tafel.tafel));
    const fehlenDort = [...hier].filter((name) => !dort.has(name));
    const zuviel = [...dort].filter((name) => !hier.has(name));
    const zuLaschDetail: string[] = [];
    for (const tafel of manifest.tafeln) {
        const regel = regeln.regeln.tafeln[tafel.tafel];
        if (regel === undefined || regel.art !== "mitnehmen") continue;
        const offen = [
            ...(regel.leeren ?? []).filter(
                (spalte) => !tafel.leeren.includes(spalte) && !tafel.verdeckt.includes(spalte),
            ),
            ...(regel.verdecken ?? []).filter((spalte) => !tafel.verdeckt.includes(spalte)),
        ];
        if (offen.length > 0) zuLaschDetail.push(`${tafel.tafel}: ${offen.join(", ")}`);
    }
    const lokaleMigrationen = new Map(
        (await db<{ version: string; checksum: string }[]>`SELECT version, checksum FROM schema_migration`).map(
            (zeile) => [zeile.version, zeile.checksum],
        ),
    );
    const anDerQuelle = new Set(manifest.migrationen.map((m) => m.version));
    const lokalVoraus = [...lokaleMigrationen.keys()].some((version) => !anDerQuelle.has(version));
    const neueTafeln = lokalVoraus ? fehlenDort : [];
    if (zuviel.length > 0 || zuLaschDetail.length > 0 || (fehlenDort.length > 0 && !lokalVoraus)) {
        const teile: string[] = [];
        if (zuviel.length > 0) teile.push(`Tafeln, die hier nicht mitkommen dürfen: ${erste(zuviel)}`);
        if (zuLaschDetail.length > 0) teile.push(`Personenfelder nicht geleert: ${erste(zuLaschDetail, 2)}`);
        if (fehlenDort.length > 0 && !lokalVoraus)
            teile.push(`Tafeln, die der Abzug nicht trägt: ${erste(fehlenDort)}`);
        probleme.push(problem("regeln", teile.join("; ")));
    }

    // Journal und Domänen.
    const fehlendeMigrationen = manifest.migrationen
        .filter((m) => !lokaleMigrationen.has(m.version))
        .map((m) => m.version);
    if (fehlendeMigrationen.length > 0) probleme.push(problem("migrationen_lokal_alt", erste(fehlendeMigrationen)));
    const andere = manifest.migrationen
        .filter((m) => lokaleMigrationen.has(m.version) && lokaleMigrationen.get(m.version) !== m.checksum)
        .map((m) => m.version);
    if (andere.length > 0) probleme.push(problem("migrationen_abweichend", erste(andere)));

    const domaenen = await db<{ id: string; koordinatenraum: string; pruefsumme: string }[]>`
        SELECT id, coordinate_space_id AS koordinatenraum, config_checksum AS pruefsumme FROM map_domain
    `;
    const abweichendeDomaenen = manifest.kartendomaenen
        .filter(
            (soll) =>
                !domaenen.some(
                    (ist) =>
                        ist.id === soll.id &&
                        ist.koordinatenraum === soll.koordinatenraum &&
                        ist.pruefsumme === soll.pruefsumme,
                ),
        )
        .map((domaene) => domaene.id);
    if (abweichendeDomaenen.length > 0) probleme.push(problem("kartendomaene", erste(abweichendeDomaenen)));

    // Tafeln und Spalten.
    const lokal = katalog ?? (await leseKatalog(db));
    const tafelFehlt: string[] = [];
    const spaltenProblem: string[] = [];
    for (const tafel of manifest.tafeln) {
        const hierTafel = lokal.tafeln.get(tafel.tafel);
        if (hierTafel === undefined) {
            tafelFehlt.push(tafel.tafel);
            continue;
        }
        const namen = new Set<string>();
        for (const spalte of tafel.spalten) {
            namen.add(spalte.name);
            const hierSpalte = hierTafel.spalten.find((kandidat) => kandidat.name === spalte.name);
            if (hierSpalte === undefined) spaltenProblem.push(`${tafel.tafel}.${spalte.name} fehlt hier`);
            else if (hierSpalte.generiert) spaltenProblem.push(`${tafel.tafel}.${spalte.name} wird hier errechnet`);
            else if (hierSpalte.typ !== spalte.typ)
                spaltenProblem.push(`${tafel.tafel}.${spalte.name}: ${spalte.typ} im Abzug, ${hierSpalte.typ} hier`);
        }
        for (const hierSpalte of hierTafel.spalten) {
            if (namen.has(hierSpalte.name) || hierSpalte.generiert) continue;
            if (hierSpalte.nichtNull && !hierSpalte.hatVorgabe && hierSpalte.identitaet === null) {
                spaltenProblem.push(`${tafel.tafel}.${hierSpalte.name} gibt es nur hier und braucht einen Wert`);
            }
        }
    }
    if (tafelFehlt.length > 0) probleme.push(problem("tafel_fehlt", erste(tafelFehlt)));
    if (spaltenProblem.length > 0) probleme.push(problem("spalten", erste(spaltenProblem, 2)));

    // Rechte: Besitz der Tafeln (Trigger, Fremdschlüssel) und Einfügen; die Tafeln, die mit geleert werden, zählen mit.
    const zuPruefen = [
        ...new Set([...manifest.tafeln.map((tafel) => tafel.tafel), ...lokalZuLeerendeTafeln(regeln.regeln)]),
    ];
    const rechte = await db<TafelRecht[]>`
        SELECT n.nspname || '.' || c.relname AS tafel, pg_has_role(current_user, c.relowner, 'MEMBER') AS eigener,
               has_table_privilege(c.oid, 'INSERT') AS einfuegen
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname || '.' || c.relname = ANY (${zuPruefen}::text[])
    `;
    const ohneRecht = rechte.filter((recht) => !recht.eigener || !recht.einfuegen).map((recht) => recht.tafel);
    if (ohneRecht.length > 0) {
        probleme.push(problem("rechte", `der Rolle fehlen Besitz oder Einfügen an: ${erste(ohneRecht)}`));
    }

    // Mediendateien: ein Ort, an den sie kommen, und Platz.
    if (medien !== undefined) probleme.push(...(await pruefeMedienAblage(medien.wurzel, manifest)));
    return { manifest, eintraege, probleme, neueTafeln };
}
