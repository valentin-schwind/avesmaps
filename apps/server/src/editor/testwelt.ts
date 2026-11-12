import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.ts";
import { withDeriveLock } from "../derive/derive-lock.ts";

/**
 * Die Testwelt zurücksetzen (WI-0128 E14; EDIT-0001 D4, W7, N3, §7.1 E14). Lokal und auf Stage ist Bearbeiten eine Testwelt
 * (\`MAP_EDITING=testwelt\`); der tägliche Zug um 12:00 setzt sie auf Legacys Stand zurück.
 *
 * Was der gewöhnliche Import schon zurücksetzt, macht er weiter: Felder und Lage der Legacy-Orte (I1), ihre Einzelheiten (I17), die
 * Geometrie der Wege (I5) samt Kurve (I6) und Profilen (I11). Er schreibt, was sich vom Satz unterscheidet, und eine Bearbeitung IST ein
 * Unterschied. Was er nicht kann, tut dieser Schritt VOR ihm, in einer Transaktion unter der exklusiven Sperre der Domäne:
 *
 * 1. **Neue Orte außer Betrieb**: Orte mit \`source_system = 'avesmaps3d'\` (\`place.create\`) legt kein Import still, er kennt nur
 *    Legacys Zeilen (\`migration/places.ts\`).
 * 2. **Vom Editor stillgelegte Einzelheiten freigeben**: Eine Zeile mit \`retired_origin = 'editor'\` schützt der Import (\`sync-table.ts\`:
 *    manuell schlägt Wiki). Hier wird sie zu \`import\`, damit der Satz sie wieder belebt; Zeilen, die der Editor neu angelegt hat
 *    (\`source_system = 'avesmaps3d'\`), legt er still.
 * 2b. **Unterirdisch und Entrückt zurück** (WI-0126 §11i): Legacy kennt sie nicht, kein Import setzt sie.
 * 2a. **Orte ohne Lage stilllegen** (E16, `place_unplaced`) und die Zuordnungen, die Editoren beim Platzieren eines Wiki-Eintrags
 *    schrieben (X2 mit `source_system = 'avesmaps3d'`): Der Eintrag steht danach wieder unter „Nicht auf der Karte“.
 * 3. **Das Testwelt-Protokoll leeren**: die Operationen des Editors samt ihren Einträgen; danach steht EINE Zeile \`testwelt_reset\`.
 * 4. **Neue Landschaften außer Betrieb** (WI-0178 B4, EDIT-0004 §4 Nr. 3 und 6): Landschaften, Teilflächen und Beschriftungen mit
 *    \`source_system = 'avesmaps3d'\` kennt der Regionsimport (I2) nicht, auch eine eigene Teilfläche oder Beschriftung an einer
 *    Legacy-Landschaft nicht. Was der Editor an Legacys Zeilen änderte, setzt I2 zurück (er vergleicht jede Spalte, die er schreibt,
 *    und belebt Stillgelegtes); nur den Grad der Kurve (\`region.label_curve_degree\`) kennt Legacy nicht, also hier. „Von der Karte
 *    nehmen“ (\`region.off_map\`, D2) fasst I2 bewusst nicht an: Es geht hier zurück auf \`FALSE\`, und I2 belebt die Landschaft samt
 *    Teilflächen und Beschriftungen danach.
 * 5. **Neue Kraftlinien und Kraftlinienpunkte außer Betrieb** (WI-0205 K4): Abschnitte und Punkte mit \`source_system = 'avesmaps3d'\`
 *    kennt der Kraftlinienimport (I8) nicht. Was der Editor an Legacys Abschnitten und Punkten änderte (Name, Enden, Kurve, Lage,
 *    Stilllegen), setzt I8 zurück: Er vergleicht jede Spalte, die er schreibt, und belebt Stillgelegtes. Nur die Beschreibung
 *    (\`powerline.description\`, KF1) übernimmt kein Import (Legacy hat keine gefüllte), also hier.
 * 6. **Neue Herrschaftsgebiete und Flächen außer Betrieb** (WI-0209 B4, EDIT-0005 §9): Gebiete und Flächen mit
 *    \`source_system = 'avesmaps3d'\` kennt der Gebietsimport (I14) nicht, auch eine eigene Fläche an einem Legacy-Gebiet nicht. Was der
 *    Editor an Legacys Gebieten und Flächen änderte (Felder, Elter, Spanne, Farbe, Form, Stilllegen), setzt I14 zurück: Er vergleicht
 *    jede Spalte, die er schreibt, und belebt Stillgelegtes. Die Ableitung danach (I15) rechnet neu, weil sich ihre Eingabe ändert.
 *
 * 7. **Neue Wege außer Betrieb** (WI-0177 „Neuer Weg“): Wege mit \`source_system = 'avesmaps3d'\` (\`path.create\`) kennt der Wegeimport
 *    (I5) nicht. Was der Editor an Legacys Wegen änderte (die Linie, gelöscht), setzt I5 zurück. „Von der Karte nehmen“ (Stufe 3b,
 *    \`path.off_map\`) kennt Legacy nicht und I5 fasst es bewusst nicht an (Claudio: sonst kehrte jeder genommene Weg mit dem nächsten
 *    Legacy-Zug still zurück); hier geht es zurück auf \`FALSE\`, und I5 belebt den Weg danach. Ebenso „Tunnel“ (\`path.is_tunnel\`,
 *    Migration 0172) und das Kennzeichen „Karawanenroute“ (\`path.mark\`, Migration 0174): Legacy kennt beides nicht, kein Import setzt
 *    es zurück, also hier. Die Reisemittel je Abschnitt samt „vollständig geschrieben“ (Migration 0208) setzt I5 zurück
 *    (\`migration/paths.ts\`), mit Legacys Erbe.
 * 8. **Neue Gipfel außer Betrieb** (WI-0178 P7 „▲ Gipfel setzen …“): Gipfel mit \`source_system = 'avesmaps3d'\` (\`peak.create\`)
 *    kennt der Geländezug (I10) nicht. Was der Editor an Legacys Gipfeln änderte (Name, Höhe, Lage, „Auf der Karte anzeigen“), setzt
 *    I10 zurück: Er vergleicht jede Spalte, die er schreibt.
 *
 * Ob es etwas zurückzusetzen gibt, sagt \`testweltOffen\` (\`npm run testwelt:offen\`): Operationen des Editors seit dem letzten
 * Zurücksetzen. Claudios Zug fragt das, bevor er bei unverändertem Legacy-Satz den Import überspringt (N3).
 */

export interface TestweltStand {
    /** Operationen des Editors seit dem letzten Zurücksetzen. */
    offen: number;
    /** Die erste davon. */
    seit: Date | null;
    /** Wann zuletzt zurückgesetzt wurde. */
    zuletzt: Date | null;
}

export async function testweltOffen(database: Queryable, mapDomainId: string): Promise<TestweltStand> {
    const [stand] = await database<{ offen: number; seit: Date | null; zuletzt: Date | null }[]>`
        WITH letzte AS (
            SELECT max(seq) AS seq, max(at) AS at FROM map_operation
             WHERE map_domain_id = ${mapDomainId} AND source = 'testwelt_reset'
        )
        SELECT count(o.*)::int AS offen, min(o.at) AS seit, (SELECT at FROM letzte) AS zuletzt
          FROM map_operation o
         WHERE o.map_domain_id = ${mapDomainId} AND o.source IN ('editor', 'restore')
           AND o.seq > coalesce((SELECT seq FROM letzte), 0)
    `;
    return { offen: stand?.offen ?? 0, seit: stand?.seit ?? null, zuletzt: stand?.zuletzt ?? null };
}

export interface RuecksetzBericht {
    probelauf: boolean;
    orteStillgelegt: number;
    /** Orte ohne Lage (E16). */
    ohneLageStillgelegt: number;
    /** Orte, deren Merkmale Unterirdisch oder Entrückt zurückgingen (eigene Daten von Avesmaps3D). */
    merkmaleZurueck: number;
    /** Zuordnungen platzierter Wiki-Einträge (X2, eigene Herkunft). */
    zuordnungenStillgelegt: number;
    einzelheitenFreigegeben: number;
    einzelheitenStillgelegt: number;
    /** Landschaften, Teilflächen und Beschriftungen mit eigener Herkunft (WI-0178 B4). */
    landschaftenStillgelegt: number;
    flaechenStillgelegt: number;
    beschriftungenStillgelegt: number;
    /** Landschaften, deren Kurvengrad zurück auf Legacys 3 ging (NULL). */
    kurvengradZurueck: number;
    /** Landschaften, die von der Karte genommen waren (WI-0178 D2, Migration 0163); I2 belebt sie samt Teilen. */
    abgenommeneLandschaftenZurueck: number;
    /** Abschnitte von Kraftlinien und Kraftlinienpunkte mit eigener Herkunft (WI-0205 K4). */
    kraftlinienStillgelegt: number;
    kraftlinienpunkteStillgelegt: number;
    /** Abschnitte, deren Beschreibung zurück auf leer ging. */
    kraftlinienBeschreibungZurueck: number;
    /** Abschnitte von Kraftlinien, die von der Karte genommen waren (WI-0205 K10). */
    abgenommeneKraftlinienZurueck: number;
    /** Wiki-Zuordnungen der Kraftlinien aus dem Editor, für den Import freigegeben (WI-0205). */
    kraftlinienWikiFreigegeben: number;
    /** Herrschaftsgebiete und Flächen mit eigener Herkunft (WI-0209 B4). */
    gebieteStillgelegt: number;
    gebietsflaechenStillgelegt: number;
    /** Wege mit eigener Herkunft (WI-0177 „Neuer Weg“). */
    wegeStillgelegt: number;
    /** Wege, die von der Karte genommen waren (WI-0177 Stufe 3b). */
    abgenommeneWegeZurueck: number;
    /** Abschnitte, deren Merkmal „Tunnel“ zurückging (eigene Daten von Avesmaps3D, Migration 0172). */
    tunnelZurueck: number;
    /** Abschnitte, deren Kennzeichen (Karawanenroute) zurückging (eigene Daten von Avesmaps3D, Migration 0174). */
    kennzeichenZurueck: number;
    /** Gipfel mit eigener Herkunft (WI-0178 P7). */
    gipfelStillgelegt: number;
    operationenGeloescht: number;
    eintraegeGeloescht: number;
    /** Die Zeile \`testwelt_reset\`; im Probelauf nicht geschrieben. */
    operationId: string | null;
}

export interface RuecksetzOptionen {
    mapDomainId: string;
    /** Die Umgebung der Zeile \`testwelt_reset\` (\`map_operation.environment\`). */
    environment: "development" | "staging" | "production" | "test";
    /** Ohne \`true\` rechnet der Schritt nur und rollt zurück. */
    schreiben: boolean;
}

/**
 * 🪤 Kein `constructor(readonly bericht …)`: Eine Parametereigenschaft ist TypeScript-Syntax, die Nodes Type-Stripping nicht
 * umschreibt (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX) - `npm run testwelt:zuruecksetzen` startete lokal deshalb gar nicht.
 */
class Probelauf extends Error {
    readonly bericht: RuecksetzBericht;
    constructor(bericht: RuecksetzBericht) {
        super("Probelauf: zurückgerollt");
        this.bericht = bericht;
    }
}

/** Setzt die Testwelt zurück (vor dem Import); im Probelauf alles in derselben Transaktion gerechnet und zurückgerollt. */
export async function testweltZuruecksetzen(
    database: Database,
    optionen: RuecksetzOptionen,
): Promise<RuecksetzBericht> {
    const domain = optionen.mapDomainId;
    return withDeriveLock(database, domain, "testwelt:zuruecksetzen", async () => {
        try {
            return await database.begin(async (tx) => {
                const orte = await tx`
                    UPDATE place SET is_active = FALSE
                     WHERE map_domain_id = ${domain} AND source_system = 'avesmaps3d' AND is_active
                `;
                // Unterirdisch, Entrückt und ungefähre Lage kennt Legacy nicht: Kein Import setzt sie zurück, also hier (WI-0126 §11i, WI-0267).
                const merkmale = await tx`
                    UPDATE place SET is_underground = FALSE, is_withdrawn = FALSE, is_approximate = FALSE
                     WHERE map_domain_id = ${domain} AND (is_underground OR is_withdrawn OR is_approximate)
                `;
                const ohneLage = await tx`
                    UPDATE place_unplaced SET is_active = FALSE, retired_at = now(), retired_origin = 'testwelt'
                     WHERE map_domain_id = ${domain} AND is_active
                `;
                const zuordnungen = await tx`
                    UPDATE wiki_key_assignment k SET is_active = FALSE, retired_at = now(), retired_origin = 'editor'
                      FROM place p
                     WHERE p.public_id = k.object_public_id AND p.map_domain_id = ${domain}
                       AND k.source_system = 'avesmaps3d' AND k.is_active
                `;
                const freigegeben = await tx`
                    UPDATE place_detail d SET retired_origin = 'import'
                      FROM place p
                     WHERE p.id = d.place_id AND p.map_domain_id = ${domain}
                       AND NOT d.is_active AND d.retired_origin = 'editor' AND d.source_system <> 'avesmaps3d'
                `;
                const stillgelegt = await tx`
                    UPDATE place_detail d SET is_active = FALSE, retired_at = now(), retired_origin = 'import'
                      FROM place p
                     WHERE p.id = d.place_id AND p.map_domain_id = ${domain}
                       AND d.source_system = 'avesmaps3d' AND (d.is_active OR d.retired_origin = 'editor')
                `;
                // Landschaften (WI-0178 B4): erst die Teile, dann die Wurzel, wie der Import stilllegt.
                const beschriftungen = await tx`
                    UPDATE map_label SET is_active = FALSE
                     WHERE map_domain_id = ${domain} AND source_system = 'avesmaps3d' AND is_active
                `;
                const flaechen = await tx`
                    UPDATE region_area SET is_active = FALSE
                     WHERE map_domain_id = ${domain} AND source_system = 'avesmaps3d' AND is_active
                `;
                const landschaften = await tx`
                    UPDATE region SET is_active = FALSE
                     WHERE map_domain_id = ${domain} AND source_system = 'avesmaps3d' AND is_active
                `;
                const kurvengrad = await tx`
                    UPDATE region SET label_curve_degree = NULL
                     WHERE map_domain_id = ${domain} AND label_curve_degree IS NOT NULL
                `;
                // Von der Karte genommene Landschaften (D2, off_map): Der Zug fasst off_map nie an; danach belebt I2 sie samt Teilen.
                const landschaftenAbgenommen = await tx`
                    UPDATE region SET off_map = FALSE WHERE map_domain_id = ${domain} AND off_map
                `;
                // Kraftlinien (WI-0205 K4): die Abschnitte vor den Punkten, an denen sie enden.
                // Von der Karte genommene Kraftlinien (K10, off_map) kommen mit dem Zug zurück: Der Import fasst off_map nie an.
                // Wiki-Zuordnungen der Kraftlinien aus dem Editor (WI-0205): für den Import freigeben, damit der Zug Legacys Stand
                // zurückholt (der Editor schreibt in die Zeile des Abschnitts, eine eigene gibt es nicht).
                const kraftlinienWiki = await tx`
                    UPDATE powerline_wiki_assignment w
                       SET assignment_origin = 'unknown', retired_origin = CASE WHEN w.is_active THEN NULL ELSE 'import' END
                      FROM powerline p
                     WHERE p.id = w.powerline_id AND p.map_domain_id = ${domain} AND w.assignment_origin = 'editor'
                `;
                const kraftlinienSchluessel = await tx`
                    UPDATE wiki_key_assignment k
                       SET is_active = FALSE, retired_at = coalesce(k.retired_at, now()), retired_origin = 'import'
                      FROM powerline p
                     WHERE p.public_id = k.object_public_id AND p.map_domain_id = ${domain} AND k.legacy_art = 'kraftlinie'
                       AND (k.source_system = 'avesmaps3d' OR k.retired_origin = 'editor')
                `;
                const kraftlinienAbgenommen = await tx`
                    UPDATE powerline SET off_map = FALSE WHERE map_domain_id = ${domain} AND off_map
                `;
                const kraftlinien = await tx`
                    UPDATE powerline SET is_active = FALSE
                     WHERE map_domain_id = ${domain} AND source_system = 'avesmaps3d' AND is_active
                `;
                const kraftlinienBeschreibung = await tx`
                    UPDATE powerline SET description = NULL
                     WHERE map_domain_id = ${domain} AND description IS NOT NULL
                `;
                const kraftlinienpunkte = await tx`
                    UPDATE nodix SET is_active = FALSE
                     WHERE map_domain_id = ${domain} AND source_system = 'avesmaps3d' AND is_active
                `;
                // Herrschaftsgebiete (WI-0209 B4): erst die Flächen, dann die Gebiete, wie der Import stilllegt.
                const gebietsflaechen = await tx`
                    UPDATE territory_area SET is_active = FALSE
                     WHERE map_domain_id = ${domain} AND source_system = 'avesmaps3d' AND is_active
                `;
                const gebiete = await tx`
                    UPDATE territory SET is_active = FALSE
                     WHERE map_domain_id = ${domain} AND source_system = 'avesmaps3d' AND is_active
                `;
                // Neue Wege (WI-0177): Der Wegeimport kennt nur Legacys Zeilen.
                const wege = await tx`
                    UPDATE path SET is_active = FALSE
                     WHERE map_domain_id = ${domain} AND source_system = 'avesmaps3d' AND is_active
                `;
                const abgenommen = await tx`
                    UPDATE path SET off_map = FALSE WHERE map_domain_id = ${domain} AND off_map
                `;
                // Tunnel kennt Legacy nicht: Kein Import setzt es zurück, also hier (wie Unterirdisch am Ort).
                const tunnel = await tx`
                    UPDATE path SET is_tunnel = FALSE WHERE map_domain_id = ${domain} AND is_tunnel
                `;
                // Ebenso das Kennzeichen: Legacy kennt Karawanenrouten nur als Wiki-Art.
                const kennzeichen = await tx`
                    UPDATE path SET mark = NULL WHERE map_domain_id = ${domain} AND mark IS NOT NULL
                `;
                // Neue Gipfel (WI-0178 P7): Der Geländezug kennt nur Legacys Zeilen.
                const gipfel = await tx`
                    UPDATE terrain_peak SET is_active = FALSE
                     WHERE map_domain_id = ${domain} AND source_system = 'avesmaps3d' AND is_active
                `;
                const eintraege = await tx`
                    DELETE FROM map_audit_event e USING map_operation o
                     WHERE e.operation_id = o.operation_id AND o.map_domain_id = ${domain} AND o.source IN ('editor', 'restore')
                `;
                // Die Verknüpfungen der Rücknahmen (`map_operation_revert_link`, Migration 0262) gehen mit ihren Operationen (ON DELETE CASCADE).
                const operationen = await tx`
                    DELETE FROM map_operation WHERE map_domain_id = ${domain} AND source IN ('editor', 'restore')
                `;
                const bericht: RuecksetzBericht = {
                    probelauf: !optionen.schreiben,
                    orteStillgelegt: orte.count,
                    ohneLageStillgelegt: ohneLage.count,
                    merkmaleZurueck: merkmale.count,
                    zuordnungenStillgelegt: zuordnungen.count,
                    einzelheitenFreigegeben: freigegeben.count,
                    einzelheitenStillgelegt: stillgelegt.count,
                    landschaftenStillgelegt: landschaften.count,
                    flaechenStillgelegt: flaechen.count,
                    beschriftungenStillgelegt: beschriftungen.count,
                    kurvengradZurueck: kurvengrad.count,
                    abgenommeneLandschaftenZurueck: landschaftenAbgenommen.count,
                    kraftlinienStillgelegt: kraftlinien.count,
                    kraftlinienpunkteStillgelegt: kraftlinienpunkte.count,
                    kraftlinienBeschreibungZurueck: kraftlinienBeschreibung.count,
                    abgenommeneKraftlinienZurueck: kraftlinienAbgenommen.count,
                    kraftlinienWikiFreigegeben: kraftlinienWiki.count + kraftlinienSchluessel.count,
                    gebieteStillgelegt: gebiete.count,
                    gebietsflaechenStillgelegt: gebietsflaechen.count,
                    wegeStillgelegt: wege.count,
                    abgenommeneWegeZurueck: abgenommen.count,
                    tunnelZurueck: tunnel.count,
                    kennzeichenZurueck: kennzeichen.count,
                    gipfelStillgelegt: gipfel.count,
                    operationenGeloescht: operationen.count,
                    eintraegeGeloescht: eintraege.count,
                    operationId: null,
                };
                if (!optionen.schreiben) throw new Probelauf(bericht);
                const operationId = randomUUID();
                await tx`
                    INSERT INTO map_operation (operation_id, map_domain_id, action, source, summary, environment, actor_kind,
                                               actor_label)
                    VALUES (${operationId}::uuid, ${domain}, 'testwelt.reset', 'testwelt_reset',
                            ${`Testwelt zurückgesetzt: ${String(orte.count)} neue Orte und ${String(landschaften.count)} neue Landschaften außer Betrieb, ${String(operationen.count)} Operationen aus dem Protokoll`},
                            ${optionen.environment}, 'system', 'testwelt:zuruecksetzen')
                `;
                return { ...bericht, operationId };
            });
        } catch (error) {
            if (error instanceof Probelauf) return error.bericht;
            throw error;
        }
    });
}
