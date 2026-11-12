<script setup lang="ts">
import { useId } from "vue";
import { t } from "../i18n/i18n";
import type { ActionRun, PanelAction } from "./panel-types";

/**
 * Das Aktionsband (Design Guide §13.6, §16.2, Legacy `.location-popup__actions`): gleich breite Spalten (`minmax(0, 1fr)`, nie
 * `1fr` - die Kachel mit dem längsten Wort machte ihre Spalte sonst breiter), **eine je Kachel** seit WI-0089 P4 (Legacy setzte fest
 * vier), Abstand 8, die Kacheln HOCH statt breit: Symbol oben, Beschriftung darunter, zweizeilig erlaubt. Die Hauptaktion ist gefüllt,
 * die gefährliche nur im Ton abgesetzt (Zeichen in der Warnfarbe), nicht im Ort: beide stehen im selben Raster.
 *
 * 🔴 Jede Kachel trägt die Mindestliste für ein Bedienelement (Guide §30.5): Ruhe, Hover (die Fläche, nie die Deckkraft), Aktiv, Fokus
 * (der goldene Ring mit eigenem Schatten komponiert), Gesperrt (`--color-disabled-*`, `cursor: not-allowed`) und 120 ms `ease`.
 * Eine gesperrte Kachel („Änderungen vorschlagen“, WI-0063 4.1) hat keine Handlung: Sie löst nichts aus. Ihre Erklärung steht als ZEILE
 * unter dem Band (Guide §13.11), nicht in einem Tooltip.
 *
 * 🔴 **Dieselbe Kachel, in zwei Gestalten** (WI-0118, Legacy `place-extras.css` „Flache Abschnitts-Kacheln“, Owner 2026-08-12: „kannst du das
 * icon kleiner machen und vor den text einzeilig platzieren“): `embedded` ist das Band IN einem Abschnitt - „Kartensammlung anzeigen“, „Karte
 * vorschlagen“, „Literatur anzeigen“ unter dem Streifen. Es trägt weder Linien noch Polster (der Abschnitt hat beides), und seine Kacheln
 * liegen flach: das Zeichen vor dem Wort, nicht darüber. Eine zweite Kachelrezeptur daneben ist genau die Divergenz, vor der Legacy gewarnt
 * hat („Nachbauten“ liefen auseinander).
 */
const props = defineProps<{
    actions: PanelAction[];
    note?: string | undefined;
    /** Das Band steht in einem Abschnitt unter dessen Inhalt (flache Kacheln, ohne Linien und Polster). */
    embedded?: boolean;
    /** Der Name des Bandes für Vorleser; ohne Angabe „Aktionen“. Im Abschnitt trägt er den Namen des Abschnitts. */
    label?: string | undefined;
}>();
const emit = defineEmits<{ run: [run: ActionRun] }>();

const noteId = useId();

function press(action: PanelAction): void {
    // Eine gesperrte Kachel ist `disabled` und erreicht diese Stelle nicht; die Prüfung hält es auch ohne den Browser fest.
    if (action.run !== undefined) emit("run", action.run);
}
</script>

<template>
    <section
        class="info-actions"
        :class="{ 'is-embedded': embedded === true }"
        :aria-label="label ?? t('infoPanel.action.group')"
        :data-testid="embedded === true ? 'info-catalog-actions' : 'info-actions'"
    >
        <div class="info-actions__grid">
            <button
                v-for="action in props.actions"
                :key="action.id"
                type="button"
                class="info-tile"
                :class="[`is-${action.tone}`, action.id === 'review' ? 'has-star' : '']"
                :disabled="action.run === undefined"
                :aria-describedby="action.run === undefined && note !== undefined ? noteId : undefined"
                :data-testid="`info-action-${action.id}`"
                :data-locked="action.run === undefined ? '' : undefined"
                @click="press(action)"
            >
                <span class="info-tile__icon" aria-hidden="true">
                    <img
                        v-if="'image' in action.icon"
                        class="info-tile__img"
                        :src="`/icons/menu/${action.icon.image}.webp`"
                        alt=""
                        width="80"
                        height="80"
                        decoding="async"
                    />
                    <span v-else class="info-tile__glyph">{{ action.icon.glyph }}</span>
                </span>
                <span class="info-tile__label">{{ action.label }}</span>
            </button>
        </div>
        <p
            v-if="note !== undefined"
            :id="noteId"
            class="info-actions__note"
            :data-testid="embedded === true ? 'info-catalog-actions-note' : 'info-actions-note'"
        >
            {{ note }}
        </p>
    </section>
</template>

<style scoped>
/* Eine Linie über und unter dem Band, durch die ganze Panelbreite (Guide §13.6). */
.info-actions {
    padding: var(--space-10) var(--info-pad-x);
    border-top: 1px solid var(--color-divider);
    border-bottom: 1px solid var(--color-divider);
}

/* Im Abschnitt trägt der Abschnitt Linien und Polster (`info-section.vue`); das Band steht bündig darin. */
.info-actions.is-embedded {
    padding: 0;
    border: 0;
}

/*
 * 🔴 **So viele Spalten, wie es Kacheln gibt** (Betreiber 2026-10-06, nachdem er die Varianten gesehen hat: „alle
 * 2 zeiligen lösungen von ‚änderungen vorschlagen‘: passt“; Variante F des Blattes zu WI-0089 P4). Legacy setzte
 * FEST vier Spalten - bei drei Kacheln blieb rechts eine leer, und die Kachel war mit 81,25 px so schmal, dass
 * „Änderungen vorschlagen“ drei Zeilen brauchte. Daher kam die gemeldete Länglichkeit („die buttons bei z.b.
 * siedlungen sollten eigentliche eher quadratisch sein“): 81,25 × 99,39 px, Verhältnis 1,22, bei 360 px sogar 1,78.
 *
 * `grid-auto-flow: column` mit `grid-auto-columns: minmax(0, 1fr)` legt je Kachel eine gleich breite Spalte an - die
 * Kachel wird breiter statt höher, und zwei Zeilen reichen. 🪤 `minmax(0, 1fr)` bleibt (nie `1fr`): Sonst machte die
 * Kachel mit dem längsten Wort ihre Spalte breiter als die anderen.
 */
.info-actions__grid {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: var(--space-6);
}

/*
 * 🔴 **Vier Kacheln stehen in ZWEI Reihen** (Betreiber 2026-10-06: „ja, mach die zwei reihen beim weg“). Vier Spalten
 * hatte das Band schon, dort half die Regel oben nicht: Die Kachel blieb 81,25 px schmal, und „Änderungen vorschlagen“
 * brauchte drei Zeilen am Rechner und vier bei 360 px. Mit zwei Reihen wird sie 170,5 beziehungsweise 135,5 px breit,
 * und zwei Zeilen reichen überall. Der Preis ist die Höhe des Bandes - gemessen rund 52 px mehr; der Betreiber hat ihn
 * mit der Zahl vor sich freigegeben.
 *
 * 🪤 Vier ist die größte Zahl, die es gibt (der Weg: Anzeigen, Link teilen, Änderungen vorschlagen, Weg als Route).
 * Gezählt wird am DOM (`:has(> :nth-child(4))`), nicht an einer Objektart - eine fünfte Kachel fiele damit von selbst
 * in dieselbe Regel.
 */
.info-actions__grid:has(> :nth-child(4)) {
    grid-auto-flow: row;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

/*
 * 🔴 **Am Ort stehen die vier Kacheln in EINER Reihe** (Betreiber 2026-10-31, WI-0269: „Eine Reihe wie Vorlage“, die abgenommene
 * Probierseite der Bewertungen zeigte Reiseziel, Link teilen, Bewertung schreiben und Änderungen vorschlagen nebeneinander). Die
 * Regel oben bleibt für den Weg (Betreiber 2026-10-06). Erkannt wird der Ort an seiner Kachel „Bewertung schreiben“, nicht an einer
 * Objektart: Nur Orte tragen sie.
 */
.info-actions__grid:has(> [data-testid="info-action-review"]) {
    grid-auto-flow: column;
    grid-template-columns: none;
}

/*
 * Damit „Änderungen vorschlagen“ in der schmalen Kachel (81 px) nicht auf drei Zeilen umbricht, eine Stufe kleiner (Betreiber 2026-10-31:
 * „probier eine kleinere schrift wenn es zu 4x kacheln kommt“), Kanonstufe `caption`.
 */
.info-actions__grid:has(> [data-testid="info-action-review"]) .info-tile {
    font-size: var(--font-size-caption);
}

/*
 * Am Telefon bleibt es bei zwei Reihen in der gewohnten Schrift: Dort ist die Kachel in einer Reihe nur 68 px breit, und „Änderungen
 * vorschlagen“ bräuchte auch in 11 px vier Zeilen (gemessen 2026-10-31 bei 375 px; bei 1280 px: 81 px, höchstens zwei Zeilen). Die Schwelle
 * ist die EINE des Hauses (419 px, `controls/map-fan.vue`; Wächter `info-panel-huelle`): Darüber hat das Panel seine volle Breite.
 */
@media (max-width: 419px) {
    .info-actions__grid:has(> [data-testid="info-action-review"]) {
        grid-auto-flow: row;
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .info-actions__grid:has(> [data-testid="info-action-review"]) .info-tile {
        font-size: var(--font-size-small);
    }
}

.info-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    box-sizing: border-box;
    min-height: var(--avesmaps-infopanel-tile-min-h);
    margin: 0;
    padding: var(--space-6) var(--space-4);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    line-height: var(--leading-tight);
    text-align: center;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

/*
 * Die flache Kachel im Abschnitt (Legacy: `flex-direction: row`, Symbol 20 px, `min-height: 0`): Die Abschnittskacheln sind 160 bis 350 px
 * breit, dort stehen Zeichen und Wort bequem in EINER Zeile, und die gesparte Höhe ist genau das, was der Abschnitt nicht braucht. Das
 * Zeichen schrumpft auf die Sprosse `icon.md`, die es auch außerhalb der Kachel hat - ein 36-px-Bild neben einer 12-px-Schrift wäre das
 * Bild als Hauptsache.
 */
.is-embedded .info-tile {
    flex-direction: row;
    gap: var(--space-4);
    min-height: 0;
    padding: var(--space-4) var(--space-6);
}

.is-embedded .info-tile__icon {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
}

.info-tile:hover {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.info-tile:active {
    background: var(--color-button-soft-active);
}

.info-tile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Die Hauptaktion: gefüllt. */
.info-tile.is-accent {
    border-color: var(--color-button-border);
    background: var(--color-button);
    color: var(--color-button-text);
}

.info-tile.is-accent:hover {
    border-color: var(--color-button-border);
    background: var(--color-button-hover);
}

.info-tile.is-accent:active {
    background: var(--color-button-active);
}

/* Die gefährliche: dieselbe Fläche, das Zeichen in der Warnfarbe - unterschieden am Ton, nicht am Ort. */
.info-tile.is-danger .info-tile__glyph {
    color: var(--color-danger);
}

/* Gesperrt: gedämpfte Fläche und Schrift, kein Schatten, nicht greifbar - „geht gerade nicht“ (Guide §30.2). */
.info-tile:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.info-tile__icon {
    display: grid;
    place-items: center;
    width: var(--avesmaps-infopanel-tile-icon);
    height: var(--avesmaps-infopanel-tile-icon);
}

/* Ein Inhaltsbild wird nie umgefärbt und nie gedimmt (Guide §30.2): voll in Farbe, `contain`. */
.info-tile__img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.info-tile__glyph {
    font-size: var(--icon-lg);
    line-height: 1;
}

/* Ein Wort bricht nie in der Mitte (Legacy: `white-space: normal` ohne `anywhere`): Es ragt lieber ins Polster der Kachel. */
.info-tile__label {
    min-width: 0;
}

.info-actions__note {
    margin: var(--space-6) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-normal);
}

@media (prefers-reduced-motion: reduce) {
    .info-tile {
        transition: none;
    }
}

/* „Bewertung schreiben“: der Stern in der Farbe der Bewertungssterne (Guide §16.6). */
.info-tile.has-star .info-tile__glyph {
    color: var(--color-star);
}
</style>
