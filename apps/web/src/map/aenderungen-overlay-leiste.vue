<script setup lang="ts">
import { computed } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import { t } from "../i18n/i18n";
import type { KartenHeute, KartenHinweise } from "../aenderungen/aenderung-karte-modell";
import { kartenHinweisTexte } from "../aenderungen/aenderung-karte-text";
import { KARTEN_ANZEIGEN, type KartenAnzeige, type KartenRueckweg } from "../aenderungen/karte-ablage";

/**
 * Die Leiste über der Karte, solange „Vorher und Nachher“ liegt (WI-0265 B5b; Probierseite `review/wi-0265/aenderungen.html`, Szenen 2, 4 und 8):
 * der Schalter **Beide | Vorher | Nachher**, darunter die kleine Legende („− Vorher (früher): blassrot, gestrichelt“, „+ Nachher (neu): hellgelb,
 * durchgezogen“) und, wo das Protokoll Lücken hat, der Satz dazu. Sie ist ein Bedienelement wie die anderen Leisten über der Karte (Fläche, Kante und
 * Schatten des Panels, mit Dunkelwert); allein die Farbfelder der Legende sind Kartenfarben und haben keinen (`colour.mapChange*`, Guide §23.1).
 *
 * - **Am Rechner** schließt ein ✕ die Überlagerung, wie Esc. **Am Telefon** hat das Detail das Panel weggeblendet, damit die Karte frei ist; „‹ Zum Detail“
 *   ist der Rückweg (kein ✕: Der Rückweg nimmt die Überlagerung mit).
 * - **Der heutige Ort (B9):** Zeigt die Karte nur, wo die Gegenstände einer Änderung jetzt liegen (`heute`), gibt es nichts zu schalten: Statt Schalter und Legende von Vorher und Nachher steht „Heutiger Ort“ mit
 *   seinem Zeichen, und wo ein Gegenstand nicht mehr auf der Karte liegt, der Satz dazu. Der Rückweg am Telefon führt dorthin, von wo die Karte gerufen wurde (Detail oder Liste).
 * - Gezeichnet wird sie von `aenderungen-overlay.ts` mit `render`; sie hält keinen eigenen Zustand.
 */
const props = defineProps<{
    anzeige: KartenAnzeige;
    hinweise: KartenHinweise;
    heute?: KartenHeute | undefined;
    rueckweg?: KartenRueckweg | undefined;
    telefon: boolean;
}>();
const emit = defineEmits<{
    anzeige: [anzeige: KartenAnzeige];
    schliessen: [];
    zumDetail: [];
}>();

const optionen = computed(() =>
    KARTEN_ANZEIGEN.map((wert) => ({ value: wert, label: t(`aenderungen.karte.${wert}` as const) })),
);
const saetze = computed(() => kartenHinweisTexte(props.hinweise));
</script>

<template>
    <section
        class="ao-balken"
        :aria-label="heute ? t('aenderungen.karte.heute.beschriftung') : t('aenderungen.karte.beschriftung')"
        data-testid="aenderungen-karte-leiste"
    >
        <div class="ao-balken__kopf">
            <AvmSegmente
                v-if="!heute"
                :model-value="anzeige"
                :options="optionen"
                :label="t('aenderungen.karte.anzeige')"
                testid="aenderungen-karte-anzeige"
                @update:model-value="(wert: string) => emit('anzeige', wert as KartenAnzeige)"
            />
            <strong v-else class="ao-balken__titel" data-testid="aenderungen-karte-heute">{{
                t("aenderungen.karte.heute.titel")
            }}</strong>
            <AvmKnopf
                v-if="!telefon"
                groesse="zeile"
                testid="aenderungen-karte-zu"
                :aria-label="t('aenderungen.karte.schliessen')"
                :title="t('aenderungen.karte.schliessen')"
                @click="emit('schliessen')"
            >
                ✕
            </AvmKnopf>
        </div>
        <ul v-if="heute" class="ao-balken__legende">
            <li data-testid="aenderungen-karte-legende-heute">
                <i class="ao-balken__feld ao-balken__feld--heute" aria-hidden="true" />
                <span>{{ t("aenderungen.karte.heute.legende") }}</span>
            </li>
        </ul>
        <p v-if="heute?.stillgelegt" class="ao-balken__hinweis" data-testid="aenderungen-karte-hinweis">
            {{ t("aenderungen.karte.heute.stillgelegt") }}
        </p>
        <ul v-if="!heute" class="ao-balken__legende">
            <li data-testid="aenderungen-karte-legende-vorher">
                <i class="ao-balken__feld ao-balken__feld--vorher" aria-hidden="true" />
                <span>{{ t("aenderungen.karte.legende.vorher") }}</span>
            </li>
            <li data-testid="aenderungen-karte-legende-nachher">
                <i class="ao-balken__feld ao-balken__feld--nachher" aria-hidden="true" />
                <span>{{ t("aenderungen.karte.legende.nachher") }}</span>
            </li>
        </ul>
        <p v-for="satz in saetze" :key="satz" class="ao-balken__hinweis" data-testid="aenderungen-karte-hinweis">
            {{ satz }}
        </p>
        <AvmKnopf v-if="telefon" groesse="zeile" testid="aenderungen-karte-zum-detail" @click="emit('zumDetail')">
            {{ rueckweg === "liste" ? t("aenderungen.detail.zurListe") : t("aenderungen.karte.zumDetail") }}
        </AvmKnopf>
    </section>
</template>

<style scoped>
/* Bauteilmaße, benannt: das Farbfeld der Legende, 26 × 12 wie auf der Probierseite. */
.ao-balken {
    --ao-feld-b: 26px;
    --ao-feld-h: 12px;
    --ao-feld-rand: 2px;

    box-sizing: border-box;
    display: grid;
    gap: var(--space-6);
    width: max-content;
    max-width: 100%;
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-tight);
    pointer-events: auto;
}

.ao-balken__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

.ao-balken__titel {
    font-weight: var(--font-weight-bold);
}

.ao-balken__legende {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.ao-balken__legende li {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

.ao-balken__feld {
    flex: none;
    box-sizing: border-box;
    width: var(--ao-feld-b);
    height: var(--ao-feld-h);
    border-radius: var(--radius-sm);
}

/* Vorher gestrichelt, Nachher durchgezogen: die Strichart sagt es mit, nicht die Farbe allein. */
.ao-balken__feld--vorher {
    border: var(--ao-feld-rand) dashed var(--color-map-change-before-line);
    background: var(--color-map-change-before-fill);
}

.ao-balken__feld--nachher {
    border: var(--ao-feld-rand) solid var(--color-map-change-after-line);
    background: var(--color-map-change-after-fill);
}

/* Der heutige Ort: weiße Fläche mit dünnem braunem Rand, wie auf der Karte (Kanon mapChangeLink, mapCheckHalo). */
.ao-balken__feld--heute {
    border: var(--ao-feld-rand) solid var(--color-map-change-link);
    background: var(--color-map-check-halo);
}

.ao-balken__hinweis {
    margin: 0;
    max-width: 24rem;
    color: var(--color-text-muted);
}
</style>
