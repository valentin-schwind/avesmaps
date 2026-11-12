<script setup lang="ts">
import { ref, useId } from "vue";
import { formatNumber } from "../i18n/i18n";

/**
 * Der Abschnitt (Design Guide §16.4, Legacy `.infobox-section`): EIN Bauteil für Kartensammlung, Literatur, Bewertungen, Lore und
 * Quellen. Obere Trennlinie über die volle Panelbreite, der Kopf folgt dem Satzmuster „⟨Was⟩ zu ⟨Wem⟩ (⟨Zahl⟩)“ - nicht „Karten“ oder
 * „Bewertungen“: Er sagt, WOVON und WIEVIEL, ohne Etikett daneben. Das Dreieck rechts klappt zu und auf; der Zähler bleibt beim
 * Zuklappen sichtbar und ist dann das Einzige, was den Abschnitt noch beschreibt.
 *
 * 🔴 Keine leeren Bauteile (WI-0063 5.3): Wer den Abschnitt braucht, baut ihn nur mit Inhalt - ohne etwas zu zeigen entsteht er nicht.
 * Der Inhalt darf lazy sein: `open` meldet das erste Aufklappen, `toggle` jedes. Zugeklappt ist der Inhalt `inert` und nicht gezeichnet.
 *
 * 🔴 Der Kopf ist eine LEISTE, und darin sitzt die Versalhöhe in der Mitte (Hausregel `.avm-versalmitte`, `styles/canon.css`; Betreiber
 * 2026-10-05: „kannst du bei sowas darauf achten, dass der text immer vertikal zentriert ist?“, am Bild von „Literatur zu Gareth (85)“).
 * Gemessen saß der Text 2,9 bis 4,8 px zu TIEF in seiner Lasur: Das Polster war oben 12 und unten 6, und der Zeilenkasten trug die
 * Unterlängen mit, die hier niemand braucht. Jetzt gleiches Polster oben und unten und jedes Feld auf seine Versalhöhe geschnitten -
 * Titel, Zählung und Dreieck bleiben dabei auf EINER Grundlinie (`baseline`), denn „(85)“ gehört an die Grundlinie des Titels, nicht in
 * seine Mitte.
 *
 * 🔴 **Die Luft steht unter einem Kopf, nicht zwischen zwei Köpfen** (WI-0088 P2, Betreiber 2026-10-06: „kannst du den abstand raustun“
 * unter einem zugeklappten Kopf und „und den abstand hier wieder einfügen“ zwischen einem offenen Kopf und seiner ersten Karte). Zwei
 * Köpfe stehen untereinander wie eine Liste; dort trennt die Linie, nicht ein Abstand. Zwischen einem Kopf und SEINEM Inhalt braucht es
 * Luft, sonst klebt der Inhalt am Kopf. Gemessen am 2026-10-06 war es genau andersherum: 41 px von Versalunterkante zu Versaloberkante
 * zwischen zwei zugeklappten Köpfen, 14 px von der Versalunterkante zum Inhalt. Die Luft wurde nicht erfunden, sondern umgezogen - der
 * Außenabstand zwischen zwei Abschnitten (`--space-10`) fällt weg und steht jetzt als obere Polsterung im Rumpf, der damit oben wie
 * unten gleich viel trägt. Danach 29 px zwischen zwei Köpfen und 26 px vom Kopf zu seinem Inhalt.
 */
const props = withDefaults(defineProps<{ heading: string; count?: number | undefined; startOpen?: boolean }>(), {
    startOpen: true,
    count: undefined,
});
const emit = defineEmits<{ open: []; toggle: [open: boolean] }>();

const open = ref(props.startOpen);
const body = useId();
let announced = props.startOpen;

function toggle(): void {
    open.value = !open.value;
    emit("toggle", open.value);
    if (open.value && !announced) {
        announced = true;
        emit("open");
    }
}
</script>

<template>
    <section class="info-section" :class="{ 'is-open': open }" data-testid="info-section">
        <button type="button" class="info-section__head" :aria-expanded="open" :aria-controls="body" @click="toggle">
            <span class="info-section__title avm-versalmitte" data-testid="info-section-title">{{ heading }}</span>
            <span
                v-if="count !== undefined"
                class="info-section__count avm-versalmitte"
                data-testid="info-section-count"
                >({{ formatNumber(count, 0) }})</span
            >
            <span class="info-section__chevron avm-versalmitte" aria-hidden="true">{{ open ? "▾" : "▸" }}</span>
        </button>
        <div v-if="open" :id="body" class="info-section__body"><slot /></div>
    </section>
</template>

<style scoped>
.info-section {
    margin-top: var(--space-10);
    border-top: 1px solid var(--color-divider);
}

/* 🔴 Zwischen zwei Abschnitten steht keine Luft (WI-0088 P2): Die Trennlinie genügt, und beide Köpfe tragen ihr eigenes Polster. */
.info-section + .info-section {
    margin-top: 0;
}

.info-section__head {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    padding: var(--space-12) var(--info-pad-x, var(--space-16));
    border: 0;
    background: none;
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.info-section__head:hover {
    background: linear-gradient(var(--color-hover-wash), var(--color-hover-wash)), var(--color-panel);
}

.info-section__head:active {
    background: linear-gradient(var(--color-active-wash), var(--color-active-wash)), var(--color-panel);
}

.info-section__head:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.info-section__title {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--font-size-subhead);
    line-height: var(--leading-snug);
}

.info-section__count {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.info-section__chevron {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Oben wie unten dieselbe Sprosse: Der Inhalt hängt am Kopf, klebt aber nicht an ihm (WI-0088 P2). */
.info-section__body {
    padding: var(--space-10) var(--info-pad-x, var(--space-16));
}

@media (prefers-reduced-motion: reduce) {
    .info-section__head {
        transition: none;
    }
}
</style>
