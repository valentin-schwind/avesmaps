<script setup lang="ts">
import type { SubjectRef } from "@avesmaps3d/shared";
import InfoLoreEntry from "./info-lore-entry.vue";
import InfoMarked from "./info-marked.vue";
import type { LoreNamesModel } from "./lore-model";

/**
 * Die Namen einer Vorkommensgruppe als **Buchstabenregister in zwei Spalten** (WI-0099, Legacys
 * `avesmapsLoreNamesBlockMarkup` und `.avesmaps-lore__spalten`): je Marke eine Reihe, die Marke links in ihrer eigenen schmalen
 * Spalte, dahinter die Namen dieser Marke kommagetrennt.
 *
 * 🔴 **Marken IMMER**, auch bei drei Namen (`LORE_LETTER_MIN` = 0, Owner 12.08.2026: „es macht mein durchblättern keinen sinn
 * dass in einem menü welche dranstehen und im andern nicht.“). Die Form ohne Marken (`form: "run"`) bleibt für einen Aufrufer
 * mit eigener Schwelle - heute entsteht sie nur bei einer leeren Liste, und dann steht gar nichts da.
 *
 * Eigenes Bauteil, weil dieselbe Reihe an jeder Gruppe steht: „Von hier“, „Direkt von hier“ und „Aus der Region“.
 *
 * 🔴 **Und an jeder ART der Stättenzeile** (WI-0109) - dort mit `letterMin = 2` statt 0, und ein Name, der auf der Karte steht,
 * trägt hinter sich den Sprung ⊕ (`info-lore-entry.vue`). In Legacy reist er als `item.suffixMarkup` durch dieselbe Funktion,
 * aus demselben Grund: „Ihr Markup von Hand zu spiegeln hiesse, drei CSS-Klassen zu erraten.“
 *
 * 🔴 **Die dritte Form `rows`** (WI-0122) ist die Sammelgruppe „Weitere Gebäude und Stätten“: je Block EINE Zeile, die Art gedämpft davor
 * („Archiv · Hauptsitz“), dahinter der Name. Folgezeilen hängen ein, damit jede Art am linken Rand beginnt und das Auge sie
 * wie eine Spalte abliest, ohne dass eine feste Spalte die Namen auf zwei Drittel der Breite zusammendrückt (am Blatt
 * gemessen: die Tafel mit 96-px-Spalte war doppelt so hoch).
 *
 * `needle` ist das gefaltete Suchwort der Zeile (`lore-search.ts`); ohne Suche ist es leer, und nichts wird markiert.
 */
defineProps<{ names: LoreNamesModel; needle?: string | undefined }>();
const emit = defineEmits<{ open: [ref: SubjectRef] }>();
</script>

<template>
    <div
        v-if="names.blocks.length > 0"
        class="info-lore__sheet"
        :class="{ 'is-register': names.form === 'register', 'is-rows': names.form === 'rows' }"
        data-testid="info-lore-sheet"
    >
        <div v-for="block in names.blocks" :key="block.key" class="info-lore__block" data-testid="info-lore-block">
            <!-- Die Marke ist eine Lesehilfe, kein Inhalt: Ein Vorleser würde sonst „A Alraune, Arganstaude“ sagen. -->
            <span
                v-if="block.letter !== ''"
                class="info-lore__letter"
                data-testid="info-lore-letter"
                aria-hidden="true"
                >{{ block.letter }}</span
            >
            <!-- Die Art einer Zeile ist dagegen Inhalt: Sie sagt, WAS die Stätte ist, und wird mitgesucht. -->
            <span v-if="block.label !== undefined" class="info-lore__row-art" data-testid="info-lore-row-art"
                ><InfoMarked :text="block.label.text" :needle="needle" /><template
                    v-if="block.label.mark !== undefined"
                    >{{ " " }}</template
                ><span
                    v-if="block.label.mark !== undefined"
                    class="info-lore__row-mark"
                    data-testid="info-lore-row-mark"
                    ><InfoMarked :text="block.label.mark" :needle="needle" /></span
            ></span>
            <span class="info-lore__names" data-testid="info-lore-names">
                <!-- Das Komma gehört zum Namen davor: Hinter einem Objektlink steht es in dessen Kasten (`info-link.vue`). -->
                <template v-for="(entry, at) in block.entries" :key="entry.key">
                    <template v-if="at > 0">{{ " " }}</template>
                    <InfoLoreEntry
                        :entry="entry"
                        :needle="needle"
                        :tail="at < block.entries.length - 1 ? ',' : undefined"
                        @open="emit('open', $event)"
                    />
                </template>
            </span>
        </div>
    </div>
</template>

<style scoped>
/*
 * ZWEI SPALTEN, ABER ERST AB 105 px JE SPALTE (Legacy, Owner 12.08.2026: „dann könnten wir aber auch mal 2 spaltig
 * probieren“).
 *
 * 💣 **Die Mindestbreite ist der ganze Trick, und sie ist gemessen, nicht geschätzt.** Hartes `columns: 2` ergab am Telefon
 * Spalten von 64 px - von 23 Buchstabenblöcken brachen 22 um, die Liste wurde HÖHER statt kürzer. Mit der Mindestbreite sind es
 * am Telefon 109 px, und es brach keiner um. Also zwei Spalten, wo sie tragen, eine, wo nicht - und die Grenze zieht der
 * Browser selbst. 🔴 **Darum steht hier keine Media Query und keine Breitenabfrage**: Die wäre eine zweite Fassung von
 * „schmal“, und zwei Fassungen driften.
 *
 * ⚠️ `column-fill: balance` ist die Vorgabe und hier richtig; bei `auto` liefe die erste Spalte voll und die zweite blieb fast
 * leer. Darum steht es nicht da - eine Vorgabe noch einmal hinzuschreiben, heißt behaupten, man könnte sie ändern.
 */
.info-lore__sheet.is-register {
    columns: 2 var(--avesmaps-infopanel-lore-col);
    column-gap: var(--space-6);
    margin-top: var(--space-2);
}

/*
 * ⚠️ `break-inside: avoid` bleibt stehen, auch wo gerade nicht umbrochen wird: Bekommt dieser Block je einen breiteren Ort,
 * risse ein Spaltenumbruch sonst die Marke „B“ von ihren B-Namen.
 */
.is-register .info-lore__block {
    break-inside: avoid;
    display: flex;
    gap: var(--space-4);
    margin-bottom: var(--space-2);
}

/*
 * Die feste schmale Spalte, damit alle Namen an derselben Kante beginnen - genau das, was der Zahl „+43“ gefehlt hat: eine
 * Stelle, an der das Auge sucht.
 *
 * 🪤 **Eine benannte Abweichung von Legacy:** Dort steht `min-width: 12px`, und damit bricht genau die Zusicherung, die der
 * Kommentar daneben gibt - bei „W“ rutscht die Namenskante nach rechts, und die Spalte ist keine Spalte mehr. Hier steht
 * `width`, auf das breiteste Glyph gelegt (`infoPanel.loreLetterWidth` im Kanon, gemessen).
 *
 * 🪤 **Und eine zweite:** Legacy setzt die Marke auf `font-weight: 500`. Die Hausschrift hat nur Regular - 500 wäre
 * synthetisches Fett, und im Haus trägt die Betonung die FARBE (`info-panel-huelle.test.ts` wacht darüber). Die Marke steht
 * darum gedämpft neben Namen in Textfarbe; das ist derselbe Unterschied, nur anders erzeugt.
 */
.info-lore__letter {
    flex: 0 0 auto;
    width: var(--avesmaps-infopanel-lore-letter);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-normal);
}

/*
 * 💣 **KEIN WÖRTERBUCH AUF EIGENNAMEN.** Diese Zeile nimmt sich aus der globalen Silbentrennung des Kanons heraus (Regel an
 * `html` in `styles/canon.css`, WI-0088 P3; dort ist der Ausnahmeweg ausdrücklich vorgesehen: „Wer eine Fläche ausdrücklich
 * ungetrennt braucht, setzt `hyphens: manual` an ihr und sagt warum“). Hier stehen aventurische Eigennamen, und an denen RÄT
 * die deutsche Trennhilfe. Legacy hat es live in Chrome
 * gemessen: „Totenko-pfäffchen“ (richtig wäre Totenkopf-äffchen), „Maraskant-arantel“, „Regenbogenan-beter“, „Tuz-aker“,
 * „Ma-raskanfeder“ - in einem einzigen Deckel 168 falsch getrennte Namen.
 *
 * ⚠️ `overflow-wrap: anywhere` BLEIBT, und es ist der Grund, warum das gefahrlos ist: Es fängt die Namen, die auch ungetrennt
 * breiter sind als die Namensspalte (Khoramsflederechse, Maraskankakerlake) - Legacy gegengemessen: null waagerechter Überlauf,
 * Spaltenzahl unverändert, die beiden längsten rund 18 % höher. Das ist der Preis, und er ist bezahlt.
 *
 * ⚠️ `manual`, nicht `none`: An einem echten Bindestrich („Amdeggyn-Springsalamander“) und am Leerzeichen wird weiter
 * umbrochen. Das war nie das Problem.
 */
.info-lore__names {
    display: block;
    min-width: 0;
    overflow-wrap: anywhere;
    -webkit-hyphens: manual;
    hyphens: manual;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

/*
 * Die Zeilen „Art · Stätte“ (Form `rows`, WI-0122): ein Absatz je Art, Folgezeilen um eine Sprosse eingezogen, damit jede Art am
 * linken Rand beginnt. Dieselbe Trennregel wie die Namen - auch die Arten sind Eigennamen der Wiki-Infoboxen.
 */
.info-lore__sheet.is-rows {
    margin-top: var(--space-2);
}

.is-rows .info-lore__block {
    margin-bottom: var(--space-2);
    padding-left: var(--space-6);
    overflow-wrap: anywhere;
    -webkit-hyphens: manual;
    hyphens: manual;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    text-indent: calc(-1 * var(--space-6));
}

.is-rows .info-lore__names {
    display: inline;
}

/* Die Art ist Sekundärtext (Guide §16.3): gedämpft und eine Sprosse kleiner, der Name dahinter trägt die Zeile. */
.info-lore__row-art {
    margin-right: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/*
 * Das Kennzeichen bleibt mit seinem Trenner zusammen („· Hauptsitz“), darf aber als Ganzes in die nächste Zeile - sonst zöge
 * es das letzte Wort der Art mit sich und ließe „Gräfliches“ allein stehen (am Blatt gesehen). Der Trenner steht im Stylesheet
 * wie jeder Glyph im Haus.
 */
.info-lore__row-mark {
    white-space: nowrap;
}

.info-lore__row-mark::before {
    content: "·\a0";
}
</style>
