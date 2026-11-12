<script setup lang="ts">
import { computed } from "vue";
import type { VorgangDetail } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { eingangName, mailtoVon } from "./mails-modell";
import { ergebnisName, kategorieName, zeitAbstand } from "./meldungen-modell";

/**
 * Der Kasten „Absender“ im Fenster einer Anfrage (WI-0268 C4; Bedienkonzept §3.2, Fachkonzept §2.1, §9): Name, Adresse als `mailto:`-Verweis, der Eingang, die Rückwege und die **früheren Vorgänge derselben
 * Adresse** als Verweise. Er steht nur im Fenster einer Anfrage, und das Fenster öffnet nur mit `read_mailbox`: Die Adresse und die früheren Vorgänge liefert der Server nur mit dem Recht.
 *
 * - **Keine Zusammenführung nach Name oder Text** (Fachkonzept §2.1): Früher ist, was dieselbe Adresse trug, genau und ohne Groß- und Kleinschreibung. Ohne Adresse gibt es keine Liste und keinen Satz dazu.
 * - 🔴 Die Adresse ist Eingabe von außen: Der Verweis kodiert, was aus einer Adresse mehr machen könnte (`?bcc=…`, mehrere Empfänger), bevor ein Mailprogramm sie liest (`mailtoVon`).
 */
const props = defineProps<{ detail: VorgangDetail }>();
const emit = defineEmits<{ oeffne: [nummer: string] }>();

const melder = computed(() => props.detail.melder);
const name = computed(() => melder.value.name ?? t("community.mails.ohneName"));
const adresse = computed(() => melder.value.mail ?? null);
const discordName = computed(() =>
    melder.value.entfernt || melder.value.discordName == null ? undefined : melder.value.discordName,
);
const fruehere = computed(() => melder.value.fruehere ?? []);
const rueckwege = computed(() => {
    const wege = melder.value.rueckwege.map((weg) => t(`community.redaktion.rueckweg.${weg}`)).join(", ");
    return wege === ""
        ? t("community.redaktion.melder.keinRueckweg")
        : t("community.redaktion.melder.rueckweg", { wege });
});
const eingang = computed(() =>
    t("community.redaktion.eingangVor", {
        eingang: eingangName(props.detail.zeile.eingang),
        zeit: zeitAbstand(props.detail.zeile.eingegangenAt),
    }),
);
</script>

<template>
    <section class="kasten" data-testid="community-vorgang-absender">
        <h3 class="kasten__kopf avm-versalmitte">{{ t("community.mails.absender") }}</h3>
        <p class="absender__name" data-testid="community-vorgang-absender-name">{{ name }}</p>
        <!-- Verbunden mit Discord (WI-0268 C8): der Anzeigename, nie die Kennung. -->
        <p v-if="discordName !== undefined" class="leise" data-testid="community-vorgang-absender-discord">
            {{ t("community.redaktion.melder.discord", { name: discordName }) }}
        </p>
        <p v-if="melder.entfernt" class="leise">{{ t("community.redaktion.melder.entfernt") }}</p>
        <p v-else-if="adresse !== null" class="leise">
            <a class="post" :href="mailtoVon(adresse)" data-testid="community-vorgang-absender-mail">{{ adresse }}</a>
        </p>
        <p v-else class="leise" data-testid="community-vorgang-absender-ohne-adresse">
            {{ t("community.mails.keineAdresse") }}
        </p>
        <p class="leise">{{ eingang }}</p>
        <p v-if="!melder.entfernt" class="leise">{{ rueckwege }}</p>
        <template v-if="adresse !== null">
            <div v-if="fruehere.length > 0" data-testid="community-vorgang-fruehere">
                <p class="leise">{{ t("community.mails.fruehere") }}</p>
                <ul class="fruehere">
                    <li v-for="vorgang in fruehere" :key="vorgang.nummer">
                        <button
                            type="button"
                            class="verweis"
                            :data-testid="`community-vorgang-frueher-${vorgang.nummer}`"
                            @click="emit('oeffne', vorgang.nummer)"
                        >
                            {{ vorgang.nummer }}
                        </button>
                        <span class="leise"
                            >{{ kategorieName(vorgang.kategorie)
                            }}<template v-if="vorgang.ergebnis !== null">
                                · {{ ergebnisName(vorgang.ergebnis) }}</template
                            ></span
                        >
                    </li>
                </ul>
            </div>
            <p v-else class="leise" data-testid="community-vorgang-keine-fruehere">
                {{ t("community.mails.keineFruehere") }}
            </p>
        </template>
    </section>
</template>

<style scoped>
.kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.kasten p {
    margin: 0;
}

.kasten__kopf {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.absender__name {
    color: var(--color-text);
    overflow-wrap: anywhere;
}

.leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    overflow-wrap: anywhere;
}

/* Die Adresse ist ein Verweis nach INNEN (mailto): goldbraun und unterstrichen, wie im Impressum der Hinweise. */
.post {
    border-radius: var(--radius-sm);
    color: var(--color-link);
    text-decoration: underline;
    transition: color 120ms ease;
}

.post:hover,
.post:active {
    color: var(--color-link-hover);
}

.post:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.fruehere {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.fruehere li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-6);
}

/* Eine Nummer, die einen anderen Vorgang öffnet: ein Verweis im Fließtext, kein Knopf (Zustände nach Guide §30.5). */
.verweis {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
    transition: color 120ms ease;
}

.verweis:hover,
.verweis:active {
    color: var(--color-link-hover);
}

.verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .post,
    .verweis {
        transition: none;
    }
}
</style>
