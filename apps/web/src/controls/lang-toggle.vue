<script setup lang="ts">
import { computed } from "vue";
import AvmFlagge from "./avm-flagge.vue";
import AvmMenueknopf from "./avm-menueknopf.vue";
import { melde } from "../besuch/besuch-melden";
import { LOCALES, locale, setLocale, t, type Locale } from "../i18n/i18n";

/**
 * Der Sprachschalter im Planerkopf (WI-0156; vorher die Pille DE | EN aus WI-0032, Legacy `index.html:2743`,
 * `lang-toggle.js`): eine Pille, die die gewählte Sprache zeigt und auf Klick die kurze Liste der Sprachen aufklappt.
 * Links daneben steht der Themenknopf, wie seit WI-0032.
 *
 * 🔴 **Warum nicht mehr ein Feld je Sprache** (Betreiber 2026-10-15 am Blatt `review/sprachschalter/blatt.png`, Fassung B):
 * Mit Französisch und Niederländisch wären es vier Felder und 96 statt 50 px; auf dem Telefon (Panel 294 px) säße die Pille
 * dann auf der Wortmarke. Die aufklappende Pille bleibt gleich breit, gleich wie viele Sprachen noch dazukommen.
 *
 * - **Die Flagge steht ZUSÄTZLICH, nicht statt des Kürzels** (Kanal OPS-000014, Thomas 2026-10-15; Betreiber 2026-10-16:
 *   Variante b). Sie ist gezeichnet, nicht geladen (`avm-flagge.vue`), und für Englisch halb USA, halb Großbritannien —
 *   eine Flagge steht für ein Land, eine Sprache nicht. Vorgelesen wird sie nicht; dafür steht der Name daneben.
 * - **Jede Sprache steht unter ihrem eigenen Namen** („Deutsch“, „English“), nicht als Kürzel und nicht übersetzt: Wer
 *   Niederländisch sucht, sucht „Nederlands“. Darum tragen alle Tafeln dieselben Wörter (`lang.name.*`).
 * - **Liste, Tasten, die Marke ● an der Wahl und die Lage des Blatts** kommen vom Menüknopf des Hauses
 *   (`avm-menueknopf.vue`), die Fassung der Pille von dort als `bauart="pille"`. Hier steht nur, was auf dem geschlossenen
 *   Knopf zu sehen ist: das Kürzel und der Winkel.
 * - ⭐ 8 px wie Legacys Pille, als benannte Ausnahme unter der 11-px-Grenze (`--font-size-lang`; Betreiber 2026-09-25:
 *   „auf 8px machen, auch wenn das gegen unsere regel verstößt (ausnahme)“). Das Gewicht bleibt regulär: Legacys 600
 *   synthetisiert die Hausschrift nur matschig.
 * - 🔴 Die Versalien sitzen senkrecht genau in der Mitte (Betreiber 2026-09-25: „DE | EN einfach nur perfekt vertikal
 *   zentrieren sonst nix“). Zentriert wird die Versalhöhe, nicht die Zeile: Rezept `.avm-versalmitte` in `styles/canon.css`.
 * - Der Winkel ist der des Auswahlfelds (`avm-auswahl.vue`, 8 × 6, Legacys Maß), gezeichnet statt gemalt (Guide §6).
 */
const optionen = computed(() => LOCALES.map((wert) => ({ wert, text: t(`lang.name.${wert}`) })));

const wahl = computed<string>({
    get: () => locale.value,
    set: (neu) => {
        // Die Tafel lädt erst bei Bedarf (WI-0235); bis sie da ist, bleibt die alte Sprache stehen. Gezählt wird, was wirklich gilt.
        void setLocale(neu as Locale).then((gewechselt) => {
            if (gewechselt) melde("sprache_eingestellt", neu);
        });
    },
});
</script>

<template>
    <AvmMenueknopf
        v-model="wahl"
        bauart="pille"
        :optionen="optionen"
        :bezeichnung="t('lang.button', { name: t(`lang.name.${locale}`) })"
        :menue-bezeichnung="t('lang.menu')"
        testid="lang"
    >
        <template #zeichen="{ wert }"><AvmFlagge :sprache="wert as Locale" /></template>
        <template #knopf="{ wert }">
            <AvmFlagge :sprache="wert as Locale" />
            <span class="lang-toggle__label avm-versalmitte" aria-hidden="true">{{ wert.toUpperCase() }}</span>
            <svg class="lang-toggle__winkel" viewBox="0 0 8 6" aria-hidden="true">
                <path
                    d="M1 1.25 4 4.5 7 1.25"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        </template>
    </AvmMenueknopf>
</template>

<style scoped>
.lang-toggle__label {
    letter-spacing: inherit;
    margin-left: var(--space-4);
}

.lang-toggle__winkel {
    flex: none;
    width: 8px;
    height: 6px;
    margin-left: var(--space-2);
}
</style>
