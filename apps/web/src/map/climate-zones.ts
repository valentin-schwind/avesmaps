import { AVENTURIA_CARTOGRAPHY } from "@avesmaps3d/shared";

import { isMessageKey, t } from "../i18n/i18n";

/**
 * Die Namen der acht Klimazonen in der Sprache der Seite (WI-0171, Betreiber 2026-10-15: „übersetzen, auch der Name
 * vom Server“).
 *
 * 🔴 **Die Trennung ist dieselbe wie bei den namenlosen Objekten** (`i18n/unnamed.ts`): WELCHE Zone es ist, sagt die
 * Datenschicht mit ihrem `type_key` - WIE sie heißt, sagt die Sprachtafel. Der Server liefert daneben weiter seinen
 * deutschen `label` (Migration 0015 `climate_zone_type.label`); der bleibt der Stamm für Daten, die über Sprachen
 * hinweg eine Zeile bleiben müssen (die Dimension der Besucherstatistik, Legacys historische Suchbegriffe in
 * `leseKartenNamen`), und der Rückfall für eine Zone, die die Tafel noch nicht kennt.
 *
 * 🪤 Vor WI-0171 stand über den acht Zeilen in `de.ts` die Regel, sie NICHT zu übersetzen, „damit sie zu dem Namen
 * passen, den der Server liefert“. Sie ist mit dem Entscheid gefallen: Statt den Namen deutsch zu lassen, geht der
 * Servername jetzt überall durch diese Datei. Wer eine Stelle neu baut, die eine Zone nennt, ruft hier auf - ein
 * roher `label` aus einer Kachel oder einer Antwort ist ein Befund.
 */

/**
 * Die Schlüssel der Zonen von Nord nach Süd - dieselbe Liste, nach der die Bänder gefärbt werden, und damit dieselbe
 * Quelle wie `CLIMATE_ZONES` im Erklärfenster der Reiseoptionen.
 */
export const CLIMATE_ZONE_KEYS: readonly string[] = Object.keys(AVENTURIA_CARTOGRAPHY.climateZones);

/**
 * Wie die Zone `band` auf der Seite heißt.
 *
 * Eine Zone, für die die Tafel keinen Satz hat (eine neunte), fällt auf den Namen des Servers zurück und, wo auch der
 * fehlt, auf ihren lesbaren Schlüssel. Erfunden wird nichts.
 */
export function climateZoneName(band: string, serverName?: string | null): string {
    const key = `climate.zone.${band}`;
    if (isMessageKey(key)) return t(key);
    if (serverName !== undefined && serverName !== null && serverName !== "") return serverName;
    return band.replace(/_/g, " ");
}

/**
 * Die Zonen, deren Name in der Sprache der Seite zur Eingabe passt - das, was die Suche dem Server mitschickt
 * (WI-0171, Weg D; Betreiber 2026-10-15: „Der Browser schickt die passenden Schlüssel mit, Deutsch bleibt zusätzlich
 * serverseitig“).
 *
 * 🔴 **Warum der Browser vergleicht und nicht der Server:** Die acht Namen stehen in der Sprachtafel, und eine
 * serverseitige Suche kann dort nicht nachschlagen. Schickte der Aufruf statt der Schlüssel seine SPRACHE mit, müsste
 * der Server dieselben acht Namen ein zweites Mal führen - und jede neue Sprache wäre an zwei Orten zu pflegen. So
 * bleibt die Tafel die einzige Quelle, und eine künftige Sprache findet ihre Zonen, ohne dass der Server davon weiß.
 *
 * 🪤 Verglichen wird wie das `ILIKE` des Servers: Teiltreffer, ohne Rücksicht auf Groß und Klein, ABER ohne
 * Diakritikfaltung. Wer hier `normalizeSearchText` nähme, fände mit „gemassigt“ eine Zone und mit demselben Wort
 * keinen Ort - die Suche antwortete in einer Zeile nach einer anderen Regel als in allen übrigen.
 */
export function climateZoneKeysMatching(query: string): readonly string[] {
    const needle = query.trim().toLocaleLowerCase();
    if (needle === "") return [];
    return CLIMATE_ZONE_KEYS.filter((band) => climateZoneName(band).toLocaleLowerCase().includes(needle));
}
