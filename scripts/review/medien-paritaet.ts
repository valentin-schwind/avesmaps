import { readFile } from "node:fs/promises";
import type { Queryable } from "../../apps/server/src/database.ts";
import {
    resolveCitymapFulls,
    resolveCitymapPreviews,
    resolveLiteratureCovers,
    resolvePlaceMedia,
    resolveTerritoryMedia,
} from "../../apps/server/src/media/resolver.ts";

/**
 * MEDIA-M11: der Paritätsvergleich der Medien-Referenzfälle als wiederholbare Messung (Skill `legacy-analysis`, Modus B,
 * Punkt 4 — „den Vergleich als wiederholbares Skript ablegen, nicht als einmalige Handprüfung").
 *
 * Die Frage: **Zeigt Avesmaps3D dieselben Medien wie Legacy — und wo nicht, warum nicht?**
 *
 * 🔴 Die Legacy-Seite ist Legacys EIGENER Export A (`media-export.php`, Klasse `legacy_api`), ein lokal abgelegter Satz.
 * Dieses Skript ruft NICHTS ab: kein Zugriff auf `avesmaps.de`, kein Crawl, keine Einzelabfrage. Export A enthält nur
 * **Gezeigtes** (`legacy_public = true`, `suppressed = false` an jedem Eintrag, siehe `media.yaml`
 * → `umsetzung_m8_m10.abgleich_manifest_gegen_vertrag`), er ist damit genau die Aussage „das zeigt Legacy".
 *
 * 🔴 Die eigene Seite wird durch den ECHTEN Lesepfad gemessen (`media/resolver.ts` und damit `policy.ts`), nicht mit einer
 * zweiten SQL-Liste erlaubter Rechte. Was dieses Skript zählt, ist genau das, was das Infopanel bekommt.
 *
 * 🔴 Nur lesend und KEIN Tor: der Lauf endet immer mit 0 (AGENTS.md, „Blockierende Prüfungen im Betrieb" — eine
 * Paritätsregel der Entwicklung ist keine Betreiberentscheidung). `--streng` ist ein ausdrücklich angeforderter
 * Rückgabewert für einen Aufrufer, der die Abweichung selbst bewerten will.
 */

/** Ein Eintrag aus Legacys Export A (nur die Felder, die der Vergleich braucht). */
interface ExportItem {
    legacy_media_key: string;
    media_class: string;
    subject_kind: string;
    subject_public_id: string;
    role: string;
    origin: string | null;
    legacy_rights_code: string | null;
    legacy_public: boolean;
    suppressed: boolean;
}

interface ExportA {
    ok?: boolean;
    media_revision?: string;
    counts?: { items?: number; by_class?: Record<string, number> };
    items?: ExportItem[];
}

/** Die Paritätsklassen des Skills `legacy-analysis` (Modus B, Punkt 3). */
export type Paritaetsklasse =
    "IDENTICAL" | "WITHIN_TOLERANCE" | "EXPECTED_CHANGE" | "UNEXPECTED_DIFFERENCE" | "UNDECIDED";

/**
 * Was wir je Gruppe erwarten, und WARUM — Modellabweichung und Migrationsfehler getrennt (Kap. 9.67).
 *
 * Der Schlüssel ist `<media_class>/<origin>/<legacy_rights_code>`: die Kartenvorschauen zerfallen in zwei Gruppen mit
 * verschiedenen Ursachen, und nur auf dieser Höhe ist die Aussage ehrlich. Eine Gruppe ohne Eintrag wird als
 * „vollständig" erwartet: Legacy zeigt n, wir zeigen n.
 *
 * 🪤 Die Tafel ist die Erwartung, nicht die Messung. Weicht die Messung von ihr ab, sagt der Bericht das als Befund
 * `erwartung_veraltet` — damit fällt auch eine zurückgenommene Betreiberentscheidung von selbst auf.
 */
const ERWARTUNG: Readonly<
    Record<
        string,
        { klasse: Paritaetsklasse; art: "modell" | "migration"; grund: string; wir_zeigen: "alle" | "keines" }
    >
> = {
    "citymap_preview/autoget/permission_granted": {
        klasse: "EXPECTED_CHANGE",
        art: "modell",
        wir_zeigen: "keines",
        grund:
            "Der Betreiber hat die Freigaberegel fan_policy/map_preview am 2026-10-06 widerrufen (Commit 14353dbf), " +
            "weil Legacys „Kartenvorschau“ fast nie die Karte zeigt, sondern den Produktumschlag.",
    },
    "citymap_preview/upload/permission_granted": {
        klasse: "UNDECIDED",
        art: "modell",
        wir_zeigen: "keines",
        grund:
            "rights_basis permission ohne Freigaberegel: G1 = A deckt nur fan_policy. Die Policy arbeitet wie entworfen, " +
            "aber es sind ausgerechnet die vier echten hochgeladenen Kartenbilder. Offene Betreiberfrage.",
    },
    "citymap_full/upload/permission_granted": {
        klasse: "UNDECIDED",
        art: "modell",
        wir_zeigen: "keines",
        grund:
            "rights_basis permission ohne Freigaberegel, genau wie bei den vier hochgeladenen Vorschauen — und seit dem " +
            "Nachgang zu MEDIA-M11 ist das der EINZIGE Grund: resolveCitymapFulls fragt die Rolle map_full ab und " +
            "bekommt nichts zurück. Offene Betreiberfrage, kein Migrationsfehler mehr.",
    },
};

/**
 * Rollen, für die der Resolver eine Abfrage hat. 🔴 Fehlt eine, ist das selbst ein Befund (`kein_lesepfad`): dann könnte
 * nichts sie zeigen, auch mit Freigabe nicht. `map_full` stand bis zum Nachgang von MEDIA-M11 nicht hier.
 */
const ROLLEN_MIT_LESEPFAD: ReadonlySet<string> = new Set([
    "coat",
    "header",
    "literature_cover",
    "map_preview",
    "map_full",
]);

/**
 * Was Legacy je Klasse zeigt, belegt aus Legacys eigenem Code (Mirror `6fafd5c2f`, Discovery 2026-10-06). Das ist die
 * Legacy-Seite des Vergleichs in Worten; die Zahlen kommen aus Export A.
 *
 * 🔴 Legacys Gate ist EIN Katalog mit sieben Kennungen, von denen FÜNF öffentlich sind
 * (`public_domain, cc0, permission_granted, ai_generated, own_work`); `cc_by` und `unknown_other` werden gespeichert und
 * nie gezeigt, weil eine Namensnennung am Bild keine Fläche im Frontend hat (Owner-Entscheid 2026-08-16).
 */
export const LEGACY_BEDINGUNG: Readonly<Record<string, { satz: string; fundstelle: string }>> = {
    settlement_coat: {
        satz:
            "Ortswappen erscheint, wenn die lokalisierte Adresse nicht leer ist, kein coat_none gesetzt ist und die " +
            "Lizenz eine der fünf öffentlichen Kennungen ist. Das Wappen ersetzt das Ortssymbol, ohne Lizenzzeile.",
        fundstelle: "avesmaps@6fafd5c2f:api/_internal/app/coat-display.php#L331-L341",
    },
    settlement_image: {
        satz:
            "Ortsbilder erscheinen als geordnete Liste (höchstens 10, 800 × 450, Lightbox), je Bild lizenzgefiltert; " +
            "Lizenz, Notiz und Urheber verlassen den Editor nie, es gibt keine Urheberzeile.",
        fundstelle: "avesmaps@6fafd5c2f:api/_internal/app/coat-display.php#L343-L384",
    },
    territory_coat: {
        satz:
            "Gebietswappen erscheint, wenn die Rangfolge (Override, Territorium, Wiki-Staging) eine nicht leere " +
            "Adresse ergibt und die wirksame Lizenz öffentlich ist; ein leerer Override heißt „kein Wappen“.",
        fundstelle: "avesmaps@6fafd5c2f:api/_internal/coat-url.php#L54-L111",
    },
    literature_cover: {
        satz:
            "Buchumschlag erscheint bei genehmigtem Werk mit öffentlicher Lizenz. Fehlende Cover-Lizenzen setzt " +
            "Legacys Migration auf permission_granted: Genehmigung unter den Fan-Regeln von Ulisses.",
        fundstelle: "avesmaps@6fafd5c2f:api/_internal/app/game-literature.php#L425-L440",
    },
    citymap_preview: {
        satz:
            "Vorschau erscheint NUR aus thumb_local_url, bei genehmigter Karte und öffentlicher Lizenz. Legacys Code " +
            "nennt die automatisch geholten Bilder selbst „publisher covers BY CONSTRUCTION“, nicht Karten.",
        fundstelle: "avesmaps@6fafd5c2f:api/_internal/app/citymaps.php#L807-L813, #L1960-L1979",
    },
    citymap_full: {
        satz: "Vollkarte erscheint bei genehmigter Karte und öffentlicher Lizenz des Kartenbilds (eigenes Gate, getrennt von der Vorschau).",
        fundstelle: "avesmaps@6fafd5c2f:api/_internal/app/citymaps.php#L815-L821",
    },
};

export interface GruppenErgebnis {
    schluessel: string;
    media_class: string;
    origin: string;
    legacy_rights_code: string;
    /** Wie viele Medien dieser Gruppe Legacy zeigt (Einträge in Export A). */
    legacy_zeigt: number;
    /** Wie viele davon der ECHTE Resolver öffentlich liefert. */
    wir_zeigen: number;
    klasse: Paritaetsklasse;
    art: "modell" | "migration" | "keine";
    grund: string;
    /**
     * Ein benannter Referenzfall der Gruppe für das Blatt des Betreibers. `url` ist unsere öffentliche Adresse (oder
     * `null`, wenn wir nichts zeigen); `quelle_key` ist das private Original — byte-gleich die Datei, die Legacy zeigt.
     * 🔴 Das private Original hat keine öffentliche Adresse; es dient nur dem Blatt auf diesem Rechner.
     */
    referenz?: {
        name: string;
        url: string | null;
        breite: number | null;
        hoehe: number | null;
        quelle_key: string | null;
        quelle_mime: string | null;
    };
}

export interface ParitaetsBericht {
    media_revision: string;
    legacy_eintraege: number;
    assets_in_der_tafel: number;
    regeln: { rights_basis: string; role: string; decided_on: string; revoked_on: string | null; zitat: string }[];
    gruppen: GruppenErgebnis[];
    summe: { legacy_zeigt: number; wir_zeigen: number };
    befunde: { code: string; text: string }[];
}

/** Export A lesen und auf die Einträge prüfen, die der Vergleich braucht. */
export async function liesExportA(pfad: string): Promise<{ revision: string; items: ExportItem[] }> {
    const roh = JSON.parse(await readFile(pfad, "utf8")) as ExportA;
    const items = roh.items ?? [];
    if (items.length === 0) throw new Error(`${pfad}: keine items — als Legacy-Seite unbrauchbar`);
    const genannt = roh.counts?.items;
    if (genannt !== undefined && genannt !== items.length) {
        throw new Error(`${pfad}: counts.items ${String(genannt)} gegen ${String(items.length)} Einträge`);
    }
    return { revision: roh.media_revision ?? "unbekannt", items };
}

const gruppeVon = (item: ExportItem): string =>
    `${item.media_class}/${item.origin ?? "leer"}/${item.legacy_rights_code ?? "leer"}`;

/**
 * Der Vergleich. Legacy-Seite aus Export A, eigene Seite aus dem echten Resolver; je Gruppe eine Paritätsklasse.
 */
export async function vergleicheMedien(database: Queryable, pfadExportA: string): Promise<ParitaetsBericht> {
    const { revision, items } = await liesExportA(pfadExportA);
    const befunde: { code: string; text: string }[] = [];

    // 🪤 Export A soll nur Gezeigtes enthalten. Hielte er das nicht, wäre die ganze Legacy-Seite eine andere Aussage.
    const nichtOeffentlich = items.filter((i) => i.legacy_public !== true || i.suppressed === true).length;
    if (nichtOeffentlich > 0) {
        befunde.push({
            code: "export_a_nicht_nur_gezeigtes",
            text: `${String(nichtOeffentlich)} Einträge mit legacy_public != true oder suppressed — Export A ist nicht mehr „nur Gezeigtes“`,
        });
    }

    const assets = await database<{ source_ref: string; public_id: string }[]>`
        SELECT source_ref, public_id::text FROM media_asset WHERE source_system = 'avesmaps-legacy'
    `;
    const assetVonSchluessel = new Map(assets.map((a) => [a.source_ref, a.public_id]));
    const fehlendeAssets = items.filter((i) => !assetVonSchluessel.has(i.legacy_media_key)).length;
    if (fehlendeAssets > 0) {
        befunde.push({
            code: "asset_fehlt",
            text: `${String(fehlendeAssets)} Medien aus Export A haben kein Asset in der Tafel (Metadatenimport nicht gelaufen oder älterer Satz)`,
        });
    }

    const regeln = await database<
        { rights_basis: string; role: string; decided_on: string; revoked_on: string | null; zitat: string }[]
    >`
        SELECT rights_basis, role, decided_on::text, revoked_on::text, operator_quote AS zitat
        FROM publication_rule ORDER BY rights_basis, role
    `;

    // Die eigene Seite: EINMAL je Fachobjekt durch den echten Lesepfad, nie je Eintrag.
    const orte = [...new Set(items.filter((i) => i.subject_kind === "place").map((i) => i.subject_public_id))];
    const gebiete = [...new Set(items.filter((i) => i.subject_kind === "territory").map((i) => i.subject_public_id))];
    const werke = [...new Set(items.filter((i) => i.subject_kind === "literature").map((i) => i.subject_public_id))];
    const karten = [...new Set(items.filter((i) => i.subject_kind === "citymap").map((i) => i.subject_public_id))];

    /** `"<rolle>:<asset-public-id>"` jedes Mediums, das der Resolver wirklich ausliefert, mit Maßen und Adresse. */
    const geliefert = new Map<string, { url: string; breite: number; hoehe: number }>();
    const merke = (views: Iterable<{ role: string; id: string; url: string; width: number; height: number }>): void => {
        for (const v of views) geliefert.set(`${v.role}:${v.id}`, { url: v.url, breite: v.width, hoehe: v.height });
    };
    for (const ort of orte) merke(await resolvePlaceMedia(database, ort));
    for (const gebiet of gebiete) merke(await resolveTerritoryMedia(database, gebiet));
    merke((await resolveLiteratureCovers(database, werke)).values());
    merke((await resolveCitymapPreviews(database, karten)).values());
    merke((await resolveCitymapFulls(database, karten)).values());

    const namen = await ladeNamen(database, { orte, gebiete, werke, karten });

    // Das private Original je Asset: byte-gleich die Datei, die Legacy zeigt. Nur für das Blatt, nie für eine Antwort.
    const quellen = new Map<string, { key: string; mime: string }>(
        (
            await database<{ public_id: string; storage_key: string; mime_type: string }[]>`
                SELECT a.public_id::text, f.storage_key, f.mime_type
                FROM media_asset a JOIN media_file f ON f.media_asset_id = a.id
                WHERE f.storage_class = 'private_source'`
        ).map((row) => [row.public_id, { key: row.storage_key, mime: row.mime_type }]),
    );

    const gruppen = new Map<string, GruppenErgebnis>();
    for (const item of items) {
        const schluessel = gruppeVon(item);
        let gruppe = gruppen.get(schluessel);
        if (gruppe === undefined) {
            gruppe = {
                schluessel,
                media_class: item.media_class,
                origin: item.origin ?? "leer",
                legacy_rights_code: item.legacy_rights_code ?? "leer",
                legacy_zeigt: 0,
                wir_zeigen: 0,
                klasse: "IDENTICAL",
                art: "keine",
                grund: "",
            };
            gruppen.set(schluessel, gruppe);
        }
        gruppe.legacy_zeigt += 1;

        const assetId = assetVonSchluessel.get(item.legacy_media_key);
        // Die Rolle folgt der KLASSE, nie Legacys Rollenwert (media.yaml → abgleich_manifest_gegen_vertrag).
        const rolle = rolleVonKlasse(item.media_class);
        const treffer = assetId === undefined ? undefined : geliefert.get(`${rolle}:${assetId}`);
        if (treffer !== undefined) gruppe.wir_zeigen += 1;
        const quelle = assetId === undefined ? undefined : quellen.get(assetId);
        const referenz = {
            name: namen.get(item.subject_public_id) ?? item.subject_public_id,
            url: treffer?.url ?? null,
            breite: treffer?.breite ?? null,
            hoehe: treffer?.hoehe ?? null,
            quelle_key: quelle?.key ?? null,
            quelle_mime: quelle?.mime ?? null,
        };
        // Der erste Fall der Gruppe, aber ein Fall MIT Bild schlägt einen ohne: er zeigt mehr.
        if (gruppe.referenz === undefined || (gruppe.referenz.url === null && treffer !== undefined)) {
            gruppe.referenz = referenz;
        }
    }

    for (const gruppe of gruppen.values()) {
        const rolle = rolleVonKlasse(gruppe.media_class);
        if (!ROLLEN_MIT_LESEPFAD.has(rolle)) {
            befunde.push({
                code: "kein_lesepfad",
                text: `Rolle ${rolle} (Klasse ${gruppe.media_class}, ${String(gruppe.legacy_zeigt)} Medien): der Resolver hat keine Abfrage dafür — nichts könnte sie zeigen, auch mit Freigabe nicht`,
            });
        }
        bewerte(gruppe, befunde);
    }

    const sortiert = [...gruppen.values()].sort((a, b) => a.schluessel.localeCompare(b.schluessel));
    return {
        media_revision: revision,
        legacy_eintraege: items.length,
        assets_in_der_tafel: assets.length,
        regeln,
        gruppen: sortiert,
        summe: {
            legacy_zeigt: sortiert.reduce((n, g) => n + g.legacy_zeigt, 0),
            wir_zeigen: sortiert.reduce((n, g) => n + g.wir_zeigen, 0),
        },
        befunde,
    };
}

/** Die Zielrolle einer Legacy-Medienklasse (media.yaml → `legacy_zuordnung.klassen`). */
function rolleVonKlasse(mediaClass: string): string {
    switch (mediaClass) {
        case "settlement_coat":
        case "territory_coat":
            return "coat";
        case "settlement_image":
            return "header";
        case "literature_cover":
            return "literature_cover";
        case "citymap_preview":
            return "map_preview";
        case "citymap_full":
            return "map_full";
        default:
            return mediaClass;
    }
}

/** Die Paritätsklasse aus Messung und Erwartung — und ein Befund, wenn die Erwartung nicht mehr stimmt. */
function bewerte(gruppe: GruppenErgebnis, befunde: { code: string; text: string }[]): void {
    const erwartung = ERWARTUNG[gruppe.schluessel];
    const vollstaendig = gruppe.wir_zeigen === gruppe.legacy_zeigt;
    const keines = gruppe.wir_zeigen === 0;

    if (erwartung === undefined) {
        if (vollstaendig) {
            gruppe.klasse = "IDENTICAL";
            gruppe.art = "keine";
            gruppe.grund = "Legacy zeigt es, wir zeigen es — dieselbe Menge, über den echten Lesepfad gemessen.";
            return;
        }
        gruppe.klasse = "UNEXPECTED_DIFFERENCE";
        gruppe.art = "migration";
        gruppe.grund = `Ohne Eintrag in der Erwartungstafel: Legacy zeigt ${String(gruppe.legacy_zeigt)}, wir ${String(gruppe.wir_zeigen)}.`;
        befunde.push({
            code: "unerwartete_abweichung",
            text: `${gruppe.schluessel}: Legacy ${String(gruppe.legacy_zeigt)}, wir ${String(gruppe.wir_zeigen)} — keine begründete Erwartung dafür`,
        });
        return;
    }

    gruppe.klasse = erwartung.klasse;
    gruppe.art = erwartung.art;
    gruppe.grund = erwartung.grund;
    const passt = erwartung.wir_zeigen === "keines" ? keines : vollstaendig;
    if (!passt) {
        befunde.push({
            code: "erwartung_veraltet",
            text:
                `${gruppe.schluessel}: erwartet war „wir zeigen ${erwartung.wir_zeigen}“, gemessen ` +
                `${String(gruppe.wir_zeigen)} von ${String(gruppe.legacy_zeigt)} — die Erwartungstafel in medien-paritaet.ts ist nachzuziehen`,
        });
    }
}

/** Die Namen der Fachobjekte für die Referenzfälle (eine Abfrage je Tafel, nie je Objekt). */
async function ladeNamen(
    database: Queryable,
    subjects: { orte: string[]; gebiete: string[]; werke: string[]; karten: string[] },
): Promise<Map<string, string>> {
    const namen = new Map<string, string>();
    const sammle = (rows: { public_id: string; name: string }[]): void => {
        for (const row of rows) namen.set(row.public_id, row.name);
    };
    if (subjects.orte.length > 0) {
        sammle(
            await database<{ public_id: string; name: string }[]>`
                SELECT public_id::text, name FROM place WHERE public_id = ANY(${subjects.orte}::uuid[])`,
        );
    }
    if (subjects.gebiete.length > 0) {
        sammle(
            await database<{ public_id: string; name: string }[]>`
                SELECT public_id::text, name FROM territory WHERE public_id = ANY(${subjects.gebiete}::uuid[])`,
        );
    }
    if (subjects.werke.length > 0) {
        sammle(
            await database<{ public_id: string; name: string }[]>`
                SELECT public_id::text, title AS name FROM adventure WHERE public_id = ANY(${subjects.werke}::uuid[])`,
        );
    }
    if (subjects.karten.length > 0) {
        sammle(
            await database<{ public_id: string; name: string }[]>`
                SELECT public_id::text, title AS name FROM citymap WHERE public_id = ANY(${subjects.karten}::uuid[])`,
        );
    }
    return namen;
}

/** Der Bericht als Text, so wie ihn der Lauf ausgibt. */
export function formatBericht(bericht: ParitaetsBericht): string {
    const zeilen: string[] = [];
    zeilen.push(`Satz           ${bericht.media_revision}`);
    zeilen.push(
        `Legacy-Seite   Export A, ${String(bericht.legacy_eintraege)} gezeigte Medien (Klasse legacy_api, lokal abgelegt, NICHT abgerufen)`,
    );
    zeilen.push(`Eigene Seite   ${String(bericht.assets_in_der_tafel)} Assets, gemessen durch media/resolver.ts`);
    zeilen.push("");
    zeilen.push("Freigaberegeln (G1 = A)");
    for (const regel of bericht.regeln) {
        const stand = regel.revoked_on === null ? "gilt" : `widerrufen am ${regel.revoked_on}`;
        zeilen.push(`  ${regel.rights_basis}/${regel.role}  ${stand}  (entschieden ${regel.decided_on})`);
    }
    zeilen.push("");
    const breite = Math.max(...bericht.gruppen.map((g) => g.schluessel.length), 10);
    zeilen.push(`${"Gruppe".padEnd(breite)}  Legacy   wir  Paritätsklasse          Art`);
    for (const g of bericht.gruppen) {
        zeilen.push(
            `${g.schluessel.padEnd(breite)}  ${String(g.legacy_zeigt).padStart(6)}  ${String(g.wir_zeigen).padStart(4)}  ` +
                `${g.klasse.padEnd(22)}  ${g.art}`,
        );
    }
    zeilen.push(
        `${"gesamt".padEnd(breite)}  ${String(bericht.summe.legacy_zeigt).padStart(6)}  ${String(bericht.summe.wir_zeigen).padStart(4)}`,
    );
    zeilen.push("");
    for (const g of bericht.gruppen) {
        if (g.klasse === "IDENTICAL") continue;
        zeilen.push(`${g.klasse}  ${g.schluessel}`);
        zeilen.push(`  ${g.grund}`);
        if (g.referenz) zeilen.push(`  Referenzfall: ${g.referenz.name} — ${g.referenz.url ?? "zeigt nichts"}`);
    }
    if (bericht.befunde.length > 0) {
        zeilen.push("");
        zeilen.push("Befunde");
        for (const b of bericht.befunde) zeilen.push(`  BEFUND ${b.code}: ${b.text}`);
    }
    return zeilen.join("\n");
}
