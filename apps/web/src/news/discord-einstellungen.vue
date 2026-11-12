<script setup lang="ts">
import { computed, reactive, useId, watch } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import {
    DISCORD_PROMPT_MAX,
    DISCORD_PROMPT_VORGABE,
    istDiscordPrompt,
    istDiscordUhrzeit,
    sendefenster,
    type DiscordStand,
} from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import { t } from "../i18n/i18n";
import {
    einstellungenBody,
    felderAusStand,
    gleicheFelder,
    kanalGueltig,
    uhrzeitNormal,
    type DiscordVerwaltung,
    type EinstellungenFelder,
} from "./discord";

/**
 * Die Karte „Einstellungen“ im Reiter „Discord“ (WI-0255; Vali 2026-10-25: „die betreiber sollen den prompt unter "Neuigkeiten" -> "Discord" ->
 * "Prompt für den täglichen Bericht" ändern können. schön wär auch die uhrzeit für die routine und auch den kanal festlegen können“).
 *
 * - **Ein Satz, ein Speichern:** Prompt, Uhrzeit und Berichtskanal werden zusammen gespeichert (Passkey, Protokoll). Leer heißt Vorgabe: beim
 *   Prompt der Text der Vorgabe, beim Kanal die Umgebungsvariable der Umgebung; die Karte sagt, welche gilt. Einen Testkanal gibt es nicht mehr
 *   (Vali 2026-10-26): Der Berichtskanal ist der einzige Kanal.
 * - **Der Prompt wirkt nur über einen Formulierer.** Ohne ihn steht „Prompt gespeichert, wird erst mit Formulierer wirksam“, und der Bericht kommt wie
 *   bisher aus der festen Vorlage. Der Prompt bestimmt Ton, Stil und Aufbau des ganzen Berichts (seit 2026-10-26 schreibt der Formulierer den ganzen Text, WI-0255 §3b); Fakten, feste Regeln und die Prüfung gehen ihm vor.
 * - **Den Kanal prüft der Server beim Speichern** (sehen und schreiben), wenn er einen Bot-Schlüssel hat; ohne Schlüssel (Stage, lokal) sagt die Karte, dass die
 *   Prüfung entfällt. Der Schlüssel selbst kommt hier nie vor.
 * - Die Felder bleiben, was die Betreiber tippen, bis sie speichern oder verwerfen; lädt der Reiter zwischendurch neu (etwa nach dem Schalten der Routine),
 *   überschreibt das ungespeicherte Eingaben nicht.
 */
const props = defineProps<{ discord: DiscordVerwaltung; stand: DiscordStand; darf: boolean }>();

const gespeichert = computed(() => felderAusStand(props.stand));
const felder = reactive<EinstellungenFelder>({ ...gespeichert.value });
watch(gespeichert, (neu, alt) => {
    if (gleicheFelder(felder, alt)) Object.assign(felder, neu);
});

const beschaeftigt = computed(() => props.discord.busy.value !== null);
const geaendert = computed(() => !gleicheFelder(felder, gespeichert.value));
const uhrzeit = computed(() => uhrzeitNormal(felder.uhrzeit));
const uhrzeitGueltig = computed(() => istDiscordUhrzeit(uhrzeit.value));
const fenster = computed(() => (uhrzeitGueltig.value ? sendefenster(uhrzeit.value) : null));
const kanalBerichtGueltig = computed(() => kanalGueltig(felder.kanalBericht));
// Länge und Steuerzeichen: dieselbe Regel wie auf dem Server (Zeilenumbruch ja, sonst keine Steuerzeichen).
const promptGueltig = computed(() => istDiscordPrompt(felder.prompt));
const gueltig = computed(() => uhrzeitGueltig.value && kanalBerichtGueltig.value && promptGueltig.value);

/**
 * Warum Speichern nicht geht (Guide §7: ein gesperrter Knopf nennt seinen Grund). Der Satz steht einmal unter den Knöpfen, beide zeigen darauf; während
 * eines Speicherns sind sie kurz ohne Satz gesperrt, wie überall im Haus.
 */
const grundId = useId();
const grund = computed(() => {
    if (!gueltig.value) return t("admin.discord.einstellungen.ungueltig");
    if (!geaendert.value) return t("admin.discord.einstellungen.keineAenderung");
    return undefined;
});
const sperre = computed(() => grund.value ?? (beschaeftigt.value ? "" : undefined));

const kanalSatz = (): string => {
    const wert = props.stand.einstellungen.kanalBericht;
    if (wert.quelle === "reiter") return t("admin.discord.einstellungen.kanal.reiter");
    return wert.quelle === "umgebung"
        ? t("admin.discord.einstellungen.kanal.umgebung", { id: wert.umgebung ?? "" })
        : t("admin.discord.einstellungen.kanal.keiner");
};

/** Was der Prompt tut, im Zustand, der gespeichert ist: ohne Formulierer noch nichts, sonst wirkt er beim nächsten Bericht. */
const promptStatus = computed(() => {
    const eigen = props.stand.einstellungen.promptEigen;
    if (!props.stand.formulierer) {
        return t(
            eigen
                ? "admin.discord.einstellungen.prompt.ohneFormulierer"
                : "admin.discord.einstellungen.prompt.vorgabeOhneFormulierer",
        );
    }
    return t(eigen ? "admin.discord.einstellungen.prompt.wirkt" : "admin.discord.einstellungen.prompt.vorgabeWirkt");
});

const seit = computed(() => {
    const e = props.stand.einstellungen;
    if (e.geaendertAt === null) return null;
    const zeit = new Date(e.geaendertAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    return e.geaendertVon === null
        ? t("admin.discord.einstellungen.seitOhne", { zeit })
        : t("admin.discord.einstellungen.seit", { zeit, name: e.geaendertVon });
});

const probleme = computed(() =>
    props.discord.problemWer.value === "einstellungen" ? props.discord.problems.value : [],
);

function speichern(): void {
    if (!gueltig.value || !geaendert.value || beschaeftigt.value) return;
    void props.discord.speichereEinstellungen(einstellungenBody(felder));
}

function verwerfen(): void {
    Object.assign(felder, gespeichert.value);
}
</script>

<template>
    <div class="einstellungen" :class="{ 'is-telefon': phoneViewport }" data-testid="discord-einstellungen">
        <p class="satz">{{ t("admin.discord.einstellungen.lead") }}</p>
        <FensterFeldzeilen testid="discord-einstellungen-felder">
            <dt>{{ t("admin.discord.einstellungen.field.uhrzeit") }}</dt>
            <dd class="feld">
                <AvmEingabe
                    v-model="felder.uhrzeit"
                    placeholder="HH:MM"
                    inputmode="numeric"
                    maxlength="5"
                    :ungueltig="!uhrzeitGueltig"
                    :gesperrt="props.darf ? undefined : ''"
                    :aria-label="t('admin.discord.einstellungen.field.uhrzeit')"
                    testid="discord-uhrzeit"
                />
                <span class="leise" data-testid="discord-uhrzeit-hinweis">{{
                    fenster === null
                        ? t("admin.discord.einstellungen.uhrzeit.ungueltig")
                        : t("admin.discord.einstellungen.uhrzeit.hinweis", { bis: fenster.bis })
                }}</span>
            </dd>
            <dt>{{ t("admin.discord.einstellungen.field.kanalBericht") }}</dt>
            <dd class="feld">
                <AvmEingabe
                    v-model="felder.kanalBericht"
                    :placeholder="
                        props.stand.einstellungen.kanalBericht.umgebung ??
                        t('admin.discord.einstellungen.kanal.platzhalter')
                    "
                    inputmode="numeric"
                    maxlength="20"
                    :ungueltig="!kanalBerichtGueltig"
                    :gesperrt="props.darf ? undefined : ''"
                    :aria-label="t('admin.discord.einstellungen.field.kanalBericht')"
                    testid="discord-kanal-bericht"
                />
                <span class="leise" data-testid="discord-kanal-bericht-quelle">{{
                    kanalBerichtGueltig ? kanalSatz() : t("admin.discord.einstellungen.kanal.ungueltig")
                }}</span>
            </dd>
            <dt>{{ t("admin.discord.einstellungen.field.prompt") }}</dt>
            <dd class="feld">
                <AvmTextbereich
                    v-model="felder.prompt"
                    :zeilen="5"
                    :ungueltig="!promptGueltig"
                    :gesperrt="props.darf ? undefined : ''"
                    :aria-label="t('admin.discord.einstellungen.field.prompt')"
                    testid="discord-prompt"
                />
                <span class="leise">{{ t("admin.discord.einstellungen.prompt.hinweis") }}</span>
                <span class="leise" :class="{ 'is-rot': !promptGueltig }">{{
                    t("admin.discord.einstellungen.prompt.zaehler", {
                        anzahl: felder.prompt.length,
                        max: DISCORD_PROMPT_MAX,
                    })
                }}</span>
                <span class="status" data-testid="discord-prompt-status">{{ promptStatus }}</span>
                <span v-if="props.darf && felder.prompt !== DISCORD_PROMPT_VORGABE" class="vorgabe">
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="beschaeftigt ? '' : undefined"
                        testid="discord-prompt-vorgabe"
                        @click="felder.prompt = DISCORD_PROMPT_VORGABE"
                        >{{ t("admin.discord.einstellungen.prompt.vorgabe") }}</AvmKnopf
                    >
                </span>
            </dd>
        </FensterFeldzeilen>

        <p class="leise" data-testid="discord-kanal-pruefung">
            {{
                props.stand.schluessel
                    ? t("admin.discord.einstellungen.kanal.pruefung")
                    : t("admin.discord.einstellungen.kanal.ohneSchluessel")
            }}
        </p>

        <div v-if="props.darf" class="knoepfe">
            <AvmKnopf
                groesse="zeile"
                art="gefuellt"
                :gesperrt="sperre"
                :grund-bei="grund === undefined ? undefined : grundId"
                testid="discord-einstellungen-speichern"
                @click="speichern"
                >{{ t("admin.discord.einstellungen.speichern") }}</AvmKnopf
            >
            <AvmKnopf
                groesse="zeile"
                :gesperrt="geaendert ? (beschaeftigt ? '' : undefined) : ''"
                testid="discord-einstellungen-verwerfen"
                @click="verwerfen"
                >{{ t("admin.discord.einstellungen.verwerfen") }}</AvmKnopf
            >
            <span v-if="seit" class="leise" data-testid="discord-einstellungen-seit">{{ seit }}</span>
        </div>
        <AvmSperrgrund v-if="props.darf && grund !== undefined" :id="grundId" :text="grund" />
        <p v-for="problem in probleme" :key="problem.key" class="satz satz--fehler" role="alert">
            {{ t(problem.key, problem.params) }}
        </p>
    </div>
</template>

<style scoped>
.einstellungen {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

/* Am Telefon steht die Beschriftung über dem Feld: Eine Kanalkennung hat bis zu 20 Ziffern und passt sonst nicht in die schmale Feldspalte. */
.einstellungen.is-telefon :deep(.fenster-feldzeilen) {
    grid-template-columns: minmax(0, 1fr);
}

.einstellungen.is-telefon :deep(.fenster-feldzeilen) > dt,
.einstellungen.is-telefon :deep(.fenster-feldzeilen) > dd {
    grid-column: 1;
}

.einstellungen.is-telefon :deep(.fenster-feldzeilen) > dd {
    margin-bottom: var(--space-6);
}

.satz {
    margin: 0;
    color: var(--color-text-muted);
}

.satz--fehler {
    color: var(--color-danger-soft-text);
}

.leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.leise.is-rot {
    color: var(--color-danger-soft-text);
}

.status {
    color: var(--color-text);
    font-size: var(--font-size-small);
}

/* Das Feld und, was zu ihm gehört, untereinander: Hinweis, Zähler, Zustand. */
.feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.vorgabe {
    display: flex;
    justify-content: flex-start;
}

.knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6) var(--space-8);
}
</style>
