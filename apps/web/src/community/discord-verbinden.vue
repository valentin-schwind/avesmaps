<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import DiscordZeichen from "../auth/discord-zeichen.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import ReisebildZeichen from "../photobox/reisebild-zeichen.vue";
import { FEHLER_SATZ, ladeDiscord, loeseDiscord } from "./api";
import { besucherSatz } from "./besucher-ablehnung";
import { verbindeMitDiscord } from "./discord-verbinden";

/**
 * „Mit Discord verbinden“ bzw. „Verbindung lösen“ (WI-0268 C8; Fachkonzept §8.3 und §8.4, Bedienkonzept §2.1 Nr. 4 und §5). Derselbe Block steht auf der Statusseite und in der Bestätigung nach dem Absenden
 * von Meldeformular und Kontaktformular: dort, wo der Statuslink steht, weil ein Sprung mitten aus dem Formular den Entwurf verlöre.
 *
 * - **Hängt nicht am Namensfeld.** Darunter steht in Alltagssprache, was passiert und was gespeichert wird (nur Discord-Kennung und Anzeigename), mit dem Satz zu `/offen` und `/erledigt`.
 * - **Verbunden:** „Mit Discord verbunden als ‹Name›“ (nie die Kennung) und „Verbindung lösen“ mit dem Satz, dass es für alle Meldungen dieser Verbindung gilt. Gelöst ist gelöst: kein Dialog, denn
 *   erneut verbinden ist ein Klick.
 * - **Gesperrt mit Grund**, wenn die Anmeldung mit Discord hier nicht eingerichtet ist (`GET /stand` meldet `discord: false`); solange die Antwort fehlt, steht „Einen Moment …“. Nie ein toter Knopf ohne Satz.
 * - 🔴 Der Statusschlüssel verlässt diese Seite nur im Rumpf der Anfrage und, für die Rückkehr, in `sessionStorage` (`discord-verbinden.ts`); er steht nie in einer Adresse.
 */
const props = defineProps<{
    /** Der Statusschlüssel der Meldung oder Nachricht. */
    schluessel: string;
    /** Der Anzeigename der bestehenden Verbindung, sonst `null`. */
    verbunden: string | null;
    /** Die Bestätigung des Kontaktformulars: leise, ohne Rahmen, die Erklärung klappt hinter ⓘ auf. */
    erklaerungKlappt?: boolean | undefined;
}>();
const emit = defineEmits<{ geloest: [] }>();

/** `undefined`: noch nicht gefragt. */
const moeglich = ref<boolean | undefined>(undefined);
const arbeitet = ref(false);
const erklaerungOffen = ref(false);
const kennungId = useId();
/** Der Satz zum Fehler, schon in der Sprache (WI-0291). */
const problem = ref<string | undefined>(undefined);

onMounted(() => {
    void ladeDiscord().then((geht) => {
        moeglich.value = geht;
    });
});

const verbindenGrund = computed((): string | undefined => {
    if (arbeitet.value) return t("community.discord.sprung");
    if (moeglich.value === undefined) return t("community.discord.grund.laedt");
    return moeglich.value ? undefined : t("community.discord.grund.aus");
});

async function verbinden(): Promise<void> {
    if (arbeitet.value) return;
    arbeitet.value = true;
    problem.value = undefined;
    try {
        // Gelingt der Start, verlässt die Seite sich hier; `arbeitet` bleibt dann stehen.
        await verbindeMitDiscord(props.schluessel);
    } catch (fehler) {
        arbeitet.value = false;
        // 429 `rate_limited`: die Drossel der Anmeldung mit Discord, mit Uhrzeit; nicht „zu viele Meldungen“ (WI-0291).
        problem.value = besucherSatz(
            fehler,
            {},
            {
                zuViele: "community.ablehnung.discordZuViele",
                rueckfall: (art) =>
                    t(
                        art === "nicht_moeglich"
                            ? "community.discord.grund.aus"
                            : art === "ungueltig"
                              ? "community.ablehnung.discordUngueltig"
                              : FEHLER_SATZ[art],
                    ),
            },
        );
    }
}

async function loesen(): Promise<void> {
    if (arbeitet.value) return;
    arbeitet.value = true;
    problem.value = undefined;
    try {
        await loeseDiscord(props.schluessel);
        emit("geloest");
    } catch (fehler) {
        problem.value = besucherSatz(
            fehler,
            {},
            {
                zuViele: "community.ablehnung.discordZuViele",
                rueckfall: (art) => t(FEHLER_SATZ[art]),
            },
        );
    } finally {
        arbeitet.value = false;
    }
}
</script>

<template>
    <section class="discord" :class="{ 'discord--klappt': props.erklaerungKlappt }" data-testid="community-discord">
        <template v-if="props.verbunden !== null">
            <p class="discord__zeile" data-testid="community-discord-verbunden">
                {{ t("community.discord.verbunden", { name: props.verbunden }) }}
            </p>
            <p class="discord__leise">{{ t("community.discord.verbundenErklaerung") }}</p>
            <div class="discord__knoepfe">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="arbeitet ? t('community.sendet') : undefined"
                    testid="community-discord-loesen"
                    @click="loesen()"
                    >{{ t("community.discord.loesen") }}</AvmKnopf
                >
            </div>
            <p class="discord__leise" data-testid="community-discord-loesen-satz">
                {{ t("community.discord.loesenErklaerung") }}
            </p>
        </template>
        <template v-else>
            <p
                v-if="!props.erklaerungKlappt || erklaerungOffen"
                :id="`${kennungId}-erklaerung`"
                class="discord__leise"
                data-testid="community-discord-erklaerung"
            >
                {{ t("community.discord.erklaerung") }}
            </p>
            <div class="discord__knoepfe">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="verbindenGrund"
                    testid="community-discord-verbinden"
                    @click="verbinden()"
                    ><template #zeichen><DiscordZeichen groesse="zeile" /></template
                    >{{ t("community.discord.verbinden") }}</AvmKnopf
                >
                <button
                    v-if="props.erklaerungKlappt"
                    type="button"
                    class="discord__info"
                    :aria-expanded="erklaerungOffen"
                    :aria-controls="`${kennungId}-erklaerung`"
                    :aria-label="t('community.discord.erklaerungKnopf')"
                    :title="t('community.discord.erklaerungKnopf')"
                    data-testid="community-discord-info"
                    @click="erklaerungOffen = !erklaerungOffen"
                >
                    <ReisebildZeichen name="info" />
                </button>
            </div>
        </template>
        <AvmHinweis v-if="problem !== undefined" ton="gefahr" rolle="alert" testid="community-discord-problem">
            {{ problem }}
        </AvmHinweis>
    </section>
</template>

<style scoped>
.discord {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.discord--klappt {
    padding: 0;
    border: 0;
    background: none;
}

.discord--klappt .discord__knoepfe {
    order: -1;
    align-items: center;
}

.discord__info {
    display: grid;
    place-items: center;
    width: var(--icon-lg);
    height: var(--icon-lg);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        color 120ms ease;
}

.discord__info svg {
    width: var(--icon-md);
    height: var(--icon-md);
}

.discord__info:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.discord__info:active {
    background: var(--color-active-wash);
}

.discord__info:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.discord__zeile {
    margin: 0;
    color: var(--color-text);
    overflow-wrap: anywhere;
}

.discord__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.discord__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}
</style>
