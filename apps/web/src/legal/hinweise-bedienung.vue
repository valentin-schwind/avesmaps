<script setup lang="ts">
import { inject } from "vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmText from "../controls/avm-text.vue";
import { coarsePointer, ringOnTouch } from "../controls/camera-settings";
import FensterTafel from "../fenster/fenster-tafel.vue";
import { t, type MessageKey } from "../i18n/i18n";
import { characterShortcutsOff } from "../keyboard/keyboard-settings";
import { capLabel, GESTURES, shortcutRowKey, shortcutsFor, toolKeysFor } from "../keyboard/shortcuts";
import { VIEWER_CONTEXT_KEY } from "../viewer/bootstrap-viewer";
import HinweiseText from "./hinweise-text.vue";

/**
 * Der Abschnitt „Bedienung“ in „Hinweise“ (WI-0016; Aussehen nach Legacys `.shortcut-table`, WI-0045
 * Stufe B): Tasten und Gesten aus DERSELBEN Tafel, nach der sie wirken (`keyboard/shortcuts.ts`), dazu
 * die Schalter für die Einzeltasten und den Steuerring am Handy.
 *
 * - 🔴 Zwei Spalten nebeneinander (Betreiber 2026-10-14: „die shortcuts in 2 spalten erklären … nur bedienung“):
 *   links die Tastatur, rechts die Gesten. Beide Spalten sind zusammen etwa gleich hoch, und der Abschnitt
 *   passt auf einen Blick statt auf zwei Bildschirmhöhen. Gebaut mit dem Hausmuster „Nebeneinander“
 *   (Guide §12.6, `--avm-fenster-spalte` wie bei den Kacheln darüber): Reicht die Breite nicht, stehen die
 *   Spalten wieder untereinander - am Telefon also wie bisher. 🔴 Nur dieser Abschnitt ist zweispaltig; die
 *   übrigen Hinweise bleiben eine Lesespalte.
 * - Die Tafeln sind `FensterTafel` wie jede Tafel im Fenster (WI-0076, Betreiber 2026-10-04: „Tabelle B“): Kopfband,
 *   Zeilen im Wechsel, die Taste oder Geste als Zeilenkopf gedämpft, die Wirkung als Text. Sie liegen direkt auf dem
 *   Fenster (`grund="fenster"`).
 * - Die Taste ist eine Kappe in den Etikett-Farben (§2 „Pills“), die in beiden Themen stehen.
 * - Die Tafel ist die des Betrachters (`shortcutsFor`): Die Leertaste öffnet für Besucher die Suche, für Editoren fixiert
 *   sie die Auswahl (WI-0063 4.11). Dieselbe Auswahl wirkt in `install-keyboard.ts`.
 * - Die Befehle auf Discord stehen in derselben Tafel (abgenommenes Mockup vom 2026-11-04). 🔴 Die Namen sind die des Bots (`apps/server/src/discord/interaktion.ts`) und werden nicht übersetzt.
 * - Unter der Kartentafel stehen die Tasten der Werkzeuge (`toolKeysFor`, Betreiber 2026-11-09: Bedienung als Register jeder
 *   Taste): „Beim Bearbeiten“ nur für Editoren, „Screenshot“ für alle. Sie wirken in ihren Modi, nicht über diese Tafel.
 */
const viewer = inject(VIEWER_CONTEXT_KEY, undefined);
const shortcuts = shortcutsFor(viewer);
const toolKeys = toolKeysFor(viewer);

const DISCORD_BEFEHLE: readonly (readonly [string, MessageKey])[] = [
    ["/hilfe", "notes.discord.hilfe"],
    ["/bug", "notes.discord.bug"],
    ["/idee", "notes.discord.idee"],
    ["/frage", "notes.discord.frage"],
    ["/offen", "notes.discord.offen"],
    ["/erledigt", "notes.discord.erledigt"],
];
</script>

<template>
    <div class="bedienung">
        <div class="bedienung__spalte">
            <h4 class="bedienung__gruppe">{{ t("notes.keyboard") }}</h4>
            <FensterTafel :beschriftung="t('notes.keyboard')" art="text" grund="fenster">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">{{ t("notes.col.keys") }}</th>
                            <th scope="col">{{ t("notes.col.action") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in shortcuts" :key="shortcutRowKey(row)">
                            <th scope="row">
                                <span class="tasten__zeile tasten__zeile--kappen">
                                    <template v-for="(cap, index) in row.caps" :key="cap">
                                        <span v-if="index > 0" class="tasten__oder">{{ t("notes.or") }}</span>
                                        <kbd>{{ capLabel(cap) }}</kbd>
                                    </template>
                                </span>
                            </th>
                            <td><AvmText :text="t(row.label)" /></td>
                        </tr>
                    </tbody>
                </table>
            </FensterTafel>
            <AvmKaestchen
                art="checkbox"
                class="bedienung__schalter"
                mehrzeilig
                :checked="characterShortcutsOff"
                testid="shortcuts-off"
                @change="characterShortcutsOff = $event"
            >
                <span>{{ t("notes.shortcutsOff") }}</span>
            </AvmKaestchen>
            <template v-for="group in toolKeys" :key="group.group">
                <h4 class="bedienung__gruppe">{{ t(group.group) }}</h4>
                <FensterTafel :beschriftung="t(group.group)" art="text" grund="fenster">
                    <table>
                        <tbody>
                            <tr v-for="row in group.rows" :key="row.label">
                                <th scope="row">
                                    <span class="tasten__zeile tasten__zeile--kappen">
                                        <template v-for="(cap, index) in row.caps" :key="cap">
                                            <span v-if="index > 0" class="tasten__oder">{{ t("notes.or") }}</span>
                                            <kbd>{{ capLabel(cap) }}</kbd>
                                        </template>
                                    </span>
                                </th>
                                <td><AvmText :text="t(row.label)" /></td>
                            </tr>
                        </tbody>
                    </table>
                </FensterTafel>
                <p v-if="group.note" class="bedienung__text">{{ t(group.note) }}</p>
            </template>
        </div>
        <div class="bedienung__spalte">
            <template v-for="group in GESTURES" :key="group.device">
                <h4 class="bedienung__gruppe">{{ t(group.device) }}</h4>
                <FensterTafel :beschriftung="t(group.device)" art="text" grund="fenster">
                    <table>
                        <tbody>
                            <tr v-for="[gesture, effect] in group.rows" :key="gesture">
                                <th scope="row">
                                    <span class="tasten__zeile">{{ t(gesture) }}</span>
                                </th>
                                <td><AvmText :text="t(effect)" /></td>
                            </tr>
                        </tbody>
                    </table>
                </FensterTafel>
            </template>
            <p class="bedienung__text">{{ t("notes.ringText") }}</p>
            <AvmKaestchen
                v-if="coarsePointer"
                art="checkbox"
                class="bedienung__schalter"
                mehrzeilig
                :checked="ringOnTouch"
                testid="ring-on-touch"
                @change="ringOnTouch = $event"
            >
                <span>{{ t("notes.ringOnTouch") }}</span>
            </AvmKaestchen>
            <h4 class="bedienung__gruppe" data-hinweis="discord">{{ t("notes.discord") }}</h4>
            <FensterTafel :beschriftung="t('notes.discord')" art="text" grund="fenster">
                <table>
                    <tbody>
                        <tr v-for="[befehl, wirkung] in DISCORD_BEFEHLE" :key="befehl">
                            <th scope="row">
                                <span class="tasten__zeile"
                                    ><kbd>{{ befehl }}</kbd></span
                                >
                            </th>
                            <td><AvmText :text="t(wirkung)" /></td>
                        </tr>
                    </tbody>
                </table>
            </FensterTafel>
            <p class="bedienung__text"><HinweiseText :text="t('notes.discord.text')" /></p>
        </div>
    </div>
</template>

<style scoped>
/*
 * Zwei Spalten nebeneinander, bis der Platz nicht reicht - dasselbe Muster wie die Kacheln oben im Fenster
 * (Guide §12.6 „Nebeneinander“, `--avm-fenster-spalte`). Der waagerechte Abstand ist der größere: zwei Tafeln
 * nebeneinander brauchen eine sichtbare Gasse, sonst liest sich die rechte Spalte als dritte Tabellenspalte.
 */
.bedienung {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-12);
}

.bedienung__spalte {
    display: flex;
    flex: 1 1 var(--avm-fenster-spalte);
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
}

/* Die Untergruppe: derselbe Trenner wie die Zwischenüberschriften im Lesetext (abgenommenes Mockup vom 2026-11-04). */
.bedienung__gruppe {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    margin: var(--space-10) 0 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-reading);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-snug);
}

.bedienung__gruppe::after {
    flex: 1 1 var(--space-12);
    height: 1px;
    background: var(--color-divider);
    content: "";
}

.bedienung__spalte > .bedienung__gruppe:first-child {
    margin-top: 0;
}

/* Eine Geste bleibt beisammen („Doppelklick“); der Satz darum darf umbrechen. */
.tasten__zeile {
    overflow-wrap: break-word;
}

/*
 * 🔴 In zwei Spalten ist die Tastenzelle etwa 150 px breit, und „Umschalt + A oder Umschalt + ←“ passt dort in
 * keine Zeile. Deshalb brechen die FASSUNGEN einer Taste untereinander, während die Kappe selbst nie bricht
 * (`kbd`). Vorher hielt `white-space: nowrap` die ganze Zelle zusammen, und die Tafel rollte stattdessen
 * waagerecht - bei einer Tafel, die man nur liest, ist das der schlechtere Tausch.
 */
.tasten__zeile--kappen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}

.tasten__oder {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Die Tastenkappe: Fläche und Kante, keine Fettung (die Hausschrift hat keinen Fettschnitt). */
kbd {
    display: inline-block;
    min-width: 1.7em;
    padding: calc(var(--space-2) / 2) var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-sm);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-family: inherit;
    font-size: var(--font-size-caption);
    line-height: var(--leading-normal);
    text-align: center;
    white-space: nowrap;
}

.bedienung__schalter {
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
}

.bedienung__text {
    margin: var(--space-4) 0 0;
    color: var(--color-text-muted);
    line-height: var(--leading-normal);
}
</style>
