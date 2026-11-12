<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, useSlots, useTemplateRef, watch } from "vue";

import { animateHeight, elementHeight, stopHeightAnimation } from "./animate-height";
import AvmText from "./avm-text.vue";

/**
 * Legacys Fauna-/Flora-Deckel: natives details hält Tastatur und Seitensuche funktionsfähig.
 *
 * 🔴 **Das ist die Klappbox des Hauses** (Design Guide §16.3, Betreiber 2026-10-04: das Muster „soll als gemeinsamer
 * Baustein bzw. gemeinsame Darstellung implementiert werden, damit zukünftige Klappboxen es automatisch verwenden“). Sie
 * geht nach unten auf, ihre Kopfzeile bleibt dabei stehen, und zugeklappt sagt sie trotzdem, was gilt - der Titel mit
 * seiner Kurzangabe. Wer eine Klappbox braucht, nimmt DIESE; eine zweite Rezeptur für dieselbe Aussage ist ein Befund.
 *
 * 🔴 **Die Klappbox-Regel für Werte** (Design Guide §16.3 und §17): Titel, Kurzangabe und Inhalt tragen ihre Werte über
 * `AvmWert` und `AvmText` - die Zahl hell mit Ziffern gleicher Breite, die Einheit gedämpft. Die Kopfzeile tut es hier von
 * selbst (Titel `--color-text-strong`, Kurzangabe `--color-text-muted`, ein Titel mit Zahl gedämpft mit heller Zahl); der
 * Inhalt setzt seine Werte mit denselben Bausteinen, nie mit eigenem CSS. Eine neue Klappbox braucht nichts weiter.
 *
 * Drei Zusätze aus WI-0089 P3, alle für „Transportmittel“ und „Reiseoptionen“ im Planer:
 *
 * - **Die Kurzangabe darf Bilder tragen.** `secondary` nimmt neben einem Satz auch eine Liste von Teilen mit Symbol
 *   („🐎 Reisegruppe zu Fuß · ⛵ Flusssegler · Schnellste Route“), verbunden mit „ · “. Die Bilder sind Inhaltsbilder und
 *   werden nie umgefärbt (Guide §30.2).
 * - **Der Aufklappzustand kann von außen kommen** (`v-model:open`). Ohne Bindung führt die Box ihn selbst. Der Planer
 *   braucht ihn, weil seine beiden Kästen mit der Route zuklappen (Legacy `map-features-planner-groups.js`); eine fremde
 *   Änderung fährt denselben Weg wie ein Klick, sie springt nicht.
 * - **Hinter der Kopfzeile steht, wo es eins gibt, das ⓘ ihres Erklärfensters** (Slot `info`, WI-0045): links vom Winkel,
 *   in beiden Zuständen an derselben Stelle. Sein Klick klappt die Box nicht mit (`info-knopf.vue` hält ihn auf).
 *
 * Und einer aus WI-0257 S4: **Die Kurzangabe darf Zeichen tragen** (Slot `secondary`, dazu `secondaryTitle`). „Unterwegs gibt es:“ nennt hinter dem Titel je Art ein Zeichen mit
 * der Zahl (Korb 23, Pfote 68), damit der Deckel einzeilig bleibt; die Wörter dazu stehen im `title` und, vom Aufrufer gesetzt, für den Screenreader. Der Slot steht an der Stelle
 * der Kurzangabe und folgt ihren Regeln (Umbruch als Ganzes in Zeile 2, Versalhöhe in der Mitte); ein Aufrufer, der ihn füllt, setzt kein `secondary`.
 */
const props = defineProps<{
    label: string;
    /** Ein Satz, oder Teile mit Symbol - verbunden mit „ · “. */
    secondary?: string | readonly { icon?: string; text: string }[];
    /**
     * 🔴 Die Kurzangabe steht nur im ZUGEKLAPPTEN Zustand (Betreiber 2026-10-06 zu „Transportmittel“ und
     * „Reiseoptionen“: „was wir nicht brauchen ist die zusammenfassung unter dem header von einstellungen, die
     * drunter sowieso schon stehen. die brauchen wir nur wenn sie eingeklappt ist“). Die Deckel der Routendetails
     * lassen sie stehen - dort nennt sie das Ergebnis, nicht die Eingabe, die gleich darunter wieder auftaucht.
     */
    summaryClosedOnly?: boolean;
    /**
     * 🔴 Die Kurzangabe bleibt EINZEILIG und kürzt am Ende (Betreiber 2026-10-06: „wir wollen den einzeiligen header
     * (zugeklappt) lassen … aber halt einzeilig“). Ohne das bricht sie als Ganzes um (seine frühere Entscheidung vom
     * 2026-10-03 „A“), und die Leiste „Transportmittel“ wurde damit 58,4 statt 30 px hoch. Der volle Text steht
     * weiter im DOM und im `title`; gekürzt wird über `.einzeilig` (app.vue), nie mit einem eigenen Rezept.
     */
    summaryOneLine?: boolean;
    /** Der `title` der Kurzangabe (WI-0257 S4): bei einer Kurzangabe aus Zeichen die Wörter dazu. Ohne ihn gilt die alte Regel (der volle Text, nur bei `summaryOneLine`). */
    secondaryTitle?: string;
    toggleTestid?: string;
}>();
const slots = useSlots();
/** Ohne Bindung im Elternteil führt `defineModel` den Zustand selbst - die fünf Deckel der Routendetails tun das. */
const open = defineModel<boolean>("open", { default: false });
const box = useTemplateRef<HTMLDetailsElement>("box");
let changing = false;
let sequence = 0;

/** Die Kurzangabe immer als Liste: ein Satz ist ein Teil ohne Bild. Aufgeklappt kann sie entfallen. */
const kurz = computed((): readonly { icon?: string; text: string }[] => {
    if (props.summaryClosedOnly === true && open.value) return [];
    const value = props.secondary;
    if (value === undefined || value === "") return [];
    return typeof value === "string" ? [{ text: value }] : value;
});

/** Der volle Text für den `title`, wo die Zeile ihn am Ende kürzt. */
const kurzText = computed(() => kurz.value.map((part) => part.text).join(" · "));

/** Steht hinter dem Titel eine Kurzangabe: als Text oder Teile (`secondary`) oder als Zeichen (Slot `secondary`)? */
const hatKurzangabe = computed(() => kurz.value.length > 0 || slots["secondary"] !== undefined);

/**
 * Fährt den Deckel auf die Höhe des neuen Zustands. 🪤 Gemessen wird in BEIDEN Zuständen am echten Element, weil die Höhe
 * des Inhalts erst feststeht, wenn er gezeichnet ist; `sequence` lässt nur die jüngste Fahrt landen.
 */
async function fahre(opening: boolean): Promise<void> {
    const element = box.value;
    if (!element) return;
    const own = ++sequence;
    const from = elementHeight(element);
    stopHeightAnimation(element);
    changing = true;
    element.open = false;
    const closedHeight = elementHeight(element);
    element.open = true;
    const to = opening ? elementHeight(element) : closedHeight;
    await animateHeight(element, from, to);
    if (own !== sequence) return;
    element.open = opening;
    changing = false;
}

function toggle(): void {
    open.value = !open.value;
}

/** Ein Klick wie eine Vorgabe des Elternteils: ein Weg, eine Bewegung. */
watch(open, (value) => void fahre(value));

// Ohne Fahrt in den Anfangszustand: `<details>` beginnt zu, eine startoffene Box wäre sonst leer.
onMounted(() => {
    if (box.value) box.value.open = open.value;
});

/** Die Seitensuche und die Tastatur können `<details>` selbst öffnen; dann führt das Element den Zustand. */
function syncOpen(): void {
    if (!changing && box.value) open.value = box.value.open;
}

onBeforeUnmount(() => {
    sequence += 1;
    if (box.value) stopHeightAnimation(box.value);
});
</script>

<template>
    <details
        ref="box"
        class="disclosure"
        :class="{ 'disclosure--open': open, 'disclosure--einzeilig': summaryOneLine }"
        @toggle="syncOpen"
    >
        <summary
            class="disclosure__summary avm-klappbox-kopf"
            :class="{ 'avm-kopf-offen': open }"
            :aria-expanded="open"
            :data-testid="toggleTestid"
            @click.prevent="toggle"
        >
            <span class="disclosure__labels"
                ><span :class="{ 'avm-versalmitte': !summaryOneLine }"
                    ><AvmText
                        :text="hatKurzangabe ? `${label}: ` : label"
                        :rolle="/\d/.test(label) ? 'sekundaer' : 'titel'" /></span
                ><span
                    v-if="hatKurzangabe"
                    class="disclosure__secondary"
                    :class="summaryOneLine ? 'einzeilig' : 'avm-versalmitte'"
                    :title="secondaryTitle ?? (summaryOneLine ? kurzText : undefined)"
                    ><slot v-if="$slots['secondary']" name="secondary" /><template v-else
                        ><template v-for="(part, index) in kurz" :key="index"
                            ><template v-if="index > 0"> · </template
                            ><img v-if="part.icon" class="disclosure__icon" :src="part.icon" alt="" /><AvmText
                                :text="part.text"
                                rolle="sekundaer" /></template></template></span
            ></span>
            <span v-if="$slots.info" class="disclosure__info"><slot name="info" /></span>
            <span class="disclosure__arrow" aria-hidden="true"></span>
        </summary>
        <div class="disclosure__content"><slot /></div>
    </details>
</template>

<style scoped>
.disclosure {
    min-width: 0;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-md);
    padding: 0;
    background: var(--color-disclosure-bg);
    box-shadow: var(--shadow-disclosure);
    transition:
        background-color 150ms ease,
        border-color 150ms ease;
}

/*
 * 🔴 **Die Höhe der zugeklappten Kopfzeile kommt aus der Hausregel `.avm-klappbox-kopf`** (`styles/canon.css`,
 * Betreiber 2026-10-07: „klappboxen … sollen eine einheitliche höhe haben (beispiele oneliner), im routenplaner wie
 * im infopanel etc."). Sie steht im Markup, nicht hier: dieselbe Zahl in zwei Bauteilen wäre genau der Weg, auf dem
 * drei Höhen entstanden sind (gemessen 22,00 · 21,94 · 16,08 px). Dieses Bauteil setzt nur noch das Polster, und das
 * ist dasselbe wie vorher - die Höhe gewinnt die Klasse.
 */
.disclosure__summary {
    display: flex;
    align-items: baseline;
    /*
     * Zwischen der Beschriftung und dem Pfeil nur der kleinste Abstand des Kanons (vorher `--space-8`, 10 px): Der Pfeil sitzt
     * durch `margin-left: auto` ohnehin rechts, und die Kurzangabe „+65,8 Std. (bis 27 % Steigung, Schnee)“ braucht die
     * 6 px, um am Rechner in EINER Zeile zu stehen (265 px gegen 263, Betreiber 2026-10-04).
     */
    gap: var(--space-2);
    list-style: none;
    cursor: pointer;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    padding: calc(var(--space-4) / 2) calc(var(--space-16) / 2);
    border-radius: calc(var(--radius-md) - 1px);
    transition: background-color 120ms ease;
}

/*
 * Titel und Kurzangabe stehen in EINER Zeile, wo sie passen (Betreiber 2026-10-03: „1 zeilig“). Reicht die Breite
 * nicht, rutscht die Kurzangabe als Ganzes in eine zweite Zeile unter den Titel und bricht erst dort, wenn sie
 * allein nicht passt (Betreiber 2026-10-03: „A“): Nichts fehlt, nichts wird abgeschnitten.
 */
.disclosure__labels {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    gap: var(--space-2);
    min-width: 0;
}

/*
 * 🔴 Einzeilig (`summaryOneLine`): Der Titel behält seine Breite, die Kurzangabe gibt nach und kürzt am Ende
 * (`.einzeilig`, app.vue). Ohne `flex-wrap: nowrap` rutschte sie als Ganzes in eine zweite Zeile, statt zu kürzen -
 * das ist die Regel der Routendetails, und genau sie soll hier nicht gelten (Betreiber 2026-10-06).
 */
.disclosure--einzeilig .disclosure__labels {
    flex-wrap: nowrap;
}

.disclosure--einzeilig .disclosure__labels > :first-child {
    flex: none;
}

/*
 * 💣 **Die Zeile ist GENAU so hoch wie ein Symbol (16 px), mit und ohne Symbol.** Sonst zieht das Bild die Zeile auf,
 * und „Transportmittel“ steht zugeklappt höher als „Reiseoptionen“ ohne Symbol - gemeldet vom Betreiber am 2026-09-24,
 * im Rahmenkasten damals mit derselben Regel behoben und beim Umzug in die Klappbox zunächst verloren gegangen
 * (gemessen 2026-10-06: 22,00 gegen 19,75 px). Legacys `line-height: 1` am Bild allein reichte dafür nicht.
 *
 * 🔴 **Die Regel gilt der ZEILE, also auch dem Titel** - und genau das fehlte. Stand sie nur an der Kurzangabe, war
 * die Zeile 16 px hoch, der Titel aber nur 13,75; gestreckt setzt die Zeile jedes Feld an den KOPF seines eigenen
 * Zeilenkastens, und der niedrigere hängt oben. Der Betreiber hat es am 2026-10-06 gesehen („kann es sein, dass die
 * vertikale zentrierung von ‚Transportmittel…‘ und ‚Reiseoptionen…‘ um ein paar pixel zu weit hoch ist?“), und am
 * Bild gemessen stimmte es: Der Titel saß **2,08 px** über der Mitte der Leiste (Rechner) beziehungsweise **2,11 px**
 * (360 px) und **2,00 px** über der Grundlinie seiner eigenen Kurzangabe. Mit der Regel an der ganzen Kopfzeile:
 * **0,08** und **0,11 px**, Grundlinienabstand **0,00** - hell wie dunkel. Dazu hält die Kopfzeile ihre Höhe jetzt
 * auch beim Aufklappen (22,00 statt 22,00/19,75), denn ohne Kurzangabe trägt der Titel die Zeile allein.
 *
 * 🪤 `.avm-versalmitte` (§3.2) ist hier NICHT die Antwort, wie schon beim ⓘ (N4): Unter einer gemeinsamen Zeilenhöhe
 * bewegt es nichts, und an einem Deckel OHNE Kurzangabe macht es die Sache schlechter - dort ist der Winkel das
 * höchste Feld, und der auf die Versalhöhe geschnittene Titel hängt an dessen Grundlinie statt in der Mitte
 * (Landschaften gemessen: −0,66 → −2,19 px). Die Deckel der Routendetails lösen es anders, siehe unten.
 */
/*
 * 🪤 Diese Deklaration trägt die AUSRICHTUNG, nicht die Höhe: Sie gibt Titel und Kurzangabe EINEN Zeilenkasten, damit
 * der Titel nicht am Kopf seines eigenen hängt. Dass die Kopfzeile 22 px hoch ist, sagt `.avm-klappbox-kopf` - mit
 * derselben Rechnung (`--icon-sm` plus gleiches Polster), also ändert sich hier nichts, und beide Aussagen haben
 * ihren eigenen Ort.
 */
.disclosure--einzeilig .disclosure__summary {
    line-height: var(--icon-sm);
}

.disclosure--einzeilig .disclosure__secondary {
    flex: 1 1 auto;
    min-width: 0;
    /* `.einzeilig` schneidet ab: Oben bleibt Platz für ein Zeichen, das höher ist als die Zeile (die Plakette im Deckel von „Vorkommen unterwegs“). Die Höhe ändert das nicht. */
    padding-top: calc((var(--icon-kachel) - var(--icon-sm)) / 2);
    margin-top: calc((var(--icon-sm) - var(--icon-kachel)) / 2);
}

/*
 * 🔴 **Die Deckel der Routendetails tragen ihre Versalhöhe in der Mitte ihres Zeilenkastens** (Betreiber 2026-10-11:
 * „Reiseplaner: reparieren“, WI-0089). Vorher saß sie **1,26 px** zu hoch (gemessen an der Geometrie, alle Deckel
 * gleich; am Bild je nach Lage −0,81 bis −1,56 px), und so setzt sich die Zahl zusammen, 11-px-Hausschrift:
 *
 * - **0,97 px Blink:** Der Zeilenkasten (11 × 1,45, im 1/64-Raster 15,9375 px) ist 1,9375 px höher als Ober- plus
 *   Unterlänge (11 + 3). Blink teilt diesen Durchschuss nicht hälftig, sondern rundet die obere Hälfte AB -
 *   `floor(0,97) = 0`. Der ganze Durchschuss liegt unter der Schrift, die Grundlinie steht bei 11,00 statt 11,97 px
 *   (gemessen).
 * - **0,26 px die Schrift:** Selbst hälftig geteilt sitzt die Versalhöhe (8,52 px) nicht in der Mitte von Ober- und
 *   Unterlänge, denn (11 − 3 − 8,52) / 2 = −0,26.
 * - **0,03 px die Untergrenze:** `.avm-klappbox-kopf` macht den Kopf 22,00 px hoch, der Zeilenkasten füllt 21,94 davon
 *   und steht oben.
 *
 * Die Antwort ist die Hausregel §3.2 mit beiden Hälften, nur dass das gleiche Polster oben und unten am FELD sitzt
 * und nicht an der Leiste: Titel und Kurzangabe tragen `.avm-versalmitte` (der Kasten ist dann genau die Versalhöhe)
 * und darüber und darunter je die halbe Differenz zur eigenen Zeile, `(1lh − 1cap) / 2`. Jedes Feld ist damit so hoch
 * wie vorher (eine Zeile, bei Umbruch n Zeilen), die Versalhöhe steht in seiner Mitte, und keine der drei Zahlen oben
 * kommt mehr vor - Ober- und Unterlänge spielen keine Rolle mehr. Kein neuer Wert: beide Längen sind Eigenschaften
 * der Schrift am Feld.
 *
 * 🪤 **Nur ohne `summaryOneLine`.** Die Planerleisten zentrieren über die Zeilenhöhe eines Symbols (oben) und tragen
 * Bilder und den Unterlängenraum von `.einzeilig`; ein auf die Versalhöhe geschnittener Kasten mit `overflow: hidden`
 * schnitte dort beides ab. Sie bleiben, wie sie sind.
 *
 * 🪤 **Die Höhe bleibt.** Zwei Felder, die als Ganzes in eine zweite Zeile rutschen (360 px), und ein umbrechender
 * Titel bleiben n Zeilen hoch; was über der Versalhöhe und unter der Grundlinie liegt (Umlautpunkte, Unterlängen),
 * steht im Polster und wird nicht beschnitten. Gemessen: `apps/web/e2e/leisten-mitte.spec.ts`.
 *
 * Kindkombinatoren, damit eine einzeilige Klappbox IN einer anderen (wie „Übertritte“ in den Reisekosten) nicht über
 * ihren Vorfahren mitgemeint ist.
 */
.disclosure:not(.disclosure--einzeilig) > .disclosure__summary > .disclosure__labels > * {
    padding-block: calc((1lh - 1cap) / 2);
}

.disclosure__summary:hover {
    background: var(--color-panel-active);
}

.disclosure__summary::-webkit-details-marker {
    display: none;
}

.disclosure__summary:active {
    background: var(--color-active-wash);
}

.disclosure__summary:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 calc(var(--space-2) / 2) var(--color-focus);
}

/* Ein Inhaltsbild in der Kurzangabe: 16 px wie in Legacy, es füllt die Zeile genau und ragt nicht über sie hinaus. */
.disclosure__icon {
    display: inline-block;
    width: var(--icon-sm);
    height: var(--icon-sm);
    margin-right: 2px;
    vertical-align: top;
    object-fit: contain;
}

/*
 * Das ⓘ: 16 px, aber es zieht die Zeile nicht auf - sonst stünde die Kopfzeile mit ⓘ höher als ohne (Legacy:
 * `line-height: 1` am ⓘ; dasselbe Rezept trug der Rahmenkasten). Es steht links vom Winkel, in beiden Zuständen an
 * derselben Stelle (WI-0045, Guide §17.6).
 *
 * 🔴 **ⓘ und Winkel liegen auf derselben Mitte** (Betreiber 2026-10-06: „achte darauf dass das (i) und das pfeilchen
 * nach unten vertikal gleich auf liegen. das (i) ist glaub wegen seiner historie etwas zu weit oben“). Er hatte recht,
 * und die Ursache war die Grundlinie: Die Kopfzeile richtet an `baseline` aus, und ein `inline-flex` ohne eigene
 * Grundlinie stellt seine UNTERKANTE auf die Schriftgrundlinie - das ⓘ hing damit über dem Winkel, der als Glyphe auf
 * der Grundlinie sitzt. Gemessen am 2026-10-06 lagen die Mitten 3,50 px auseinander, in beiden Kästen gleich.
 * `.avm-versalmitte` (§3.2) hilft hier NICHT: Es schneidet einen TEXTkasten auf die Versalhöhe, und weder ein Bild
 * noch ein Dreieck hat eine. Beide werden darum in der Zeile zentriert; ihre Kästen sind damit konzentrisch, und die
 * Tinte liegt in beiden mittig (Bild 16 × 16, Winkel gemessen 0,17 px aus seiner Kastenmitte).
 */
.disclosure__info {
    display: inline-flex;
    flex: none;
    align-self: center;
    margin-block: calc((1lh - var(--icon-sm)) / 2);
}

.disclosure__arrow {
    align-self: center;
    margin-left: auto;
    color: var(--color-link);
    font-size: var(--font-size-body);
    line-height: 1;
    transition: color 120ms ease;
}

.disclosure__summary:hover .disclosure__arrow {
    color: var(--color-link-hover);
}

.disclosure__arrow::after {
    content: "▾";
}

.disclosure--open .disclosure__arrow::after {
    content: "▴";
}

.disclosure__content {
    font-size: var(--font-size-caption);
    padding: var(--space-2) calc(var(--space-16) / 2) calc(var(--space-4) / 2);
    color: var(--color-text);
}

@media (prefers-reduced-motion: reduce) {
    .disclosure,
    .disclosure__summary,
    .disclosure__arrow {
        transition: none;
    }
}
</style>
