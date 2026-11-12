<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { KartenvorschlagStatus, KartenvorschlagZustand } from "@avesmaps3d/shared";
import { newOperationId } from "../auth/api";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import type { MessageKey } from "../i18n/de";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import LinkKasten from "../photobox/link-kasten.vue";
import { useLinkKopieren } from "../photobox/link-kopieren";
import { kartenvorschlagGrund } from "./ablehnung";
import { FEHLER_SATZ, fehlerArt, leseStatus, sperreBis, vorschlagAdresse, ziehZurueck } from "./api";

/**
 * Die Statusseite eines Kartenvorschlags (WI-0275 Stufe C): das Ziel von `/kartenvorschlag#‹schlüssel›` und von „Stand ansehen“ nach dem Einreichen. Sie liegt im Fenster von „Karte vorschlagen“
 * (`kartenvorschlag-fenster.vue`) und zeigt den Stand in Worten, die Angaben, den Grund einer Ablehnung (nur den, den die Redaktion schrieb) und - solange noch nicht entschieden ist - „Zurückziehen“.
 *
 * - 🔴 **Der Schlüssel bleibt im Speicher dieser Seite:** Er geht im Rumpf an den Server (nie in der Adresse), und die Seite speichert ihn nirgends (kein „Auf diesem Gerät merken“: Das gibt es bei
 *   Kartenvorschlägen nicht). Wer den Link verliert, hat keinen Zugriff mehr; der Kasten sagt das im Satz darunter.
 * - **Ein falscher oder abgelaufener Schlüssel** zeigt „Zu diesem Link gibt es keinen Kartenvorschlag (mehr).“ (derselbe Satz für „nie gewesen“ und „gelöscht“; der Server antwortet ebenso).
 * - **Zurückziehen fragt einmal nach** (`AvmBestaetigung`) und trägt eine Kennung, die ein erneutes Senden nach einem Netzfehler überlebt (ADR-0019): Ein Doppelklick legt nie zwei Änderungen an.
 * - Es gibt keine Vorschau und darum keine Nachfrage in einem Takt: Der Stand ändert sich erst, wenn die Redaktion entscheidet; „Neu laden“ fragt von Hand.
 */
const props = defineProps<{
    /** Der Schlüssel aus dem Link; `null`, wenn er fehlte oder verstümmelt war: Dann gibt es nichts zu fragen. */
    schluessel: string | null;
}>();

type Stand =
    | { readonly art: "laedt" }
    | { readonly art: "fehlt" }
    | { readonly art: "da"; readonly status: KartenvorschlagStatus };

const stand = ref<Stand>(props.schluessel === null ? { art: "fehlt" } : { art: "laedt" });
const ladeProblem = ref<MessageKey | undefined>(undefined);
const frage = ref(false);
const sendet = ref(false);
const problem = ref<{ key: MessageKey; params?: Record<string, string> } | { satz: string } | undefined>(undefined);
/** Die Kennung des Zurückziehens bleibt, bis es gelingt (ADR-0019). */
let zurueckKennung: string | undefined;
let lauf = 0;

async function ladeStatus(): Promise<void> {
    if (props.schluessel === null) {
        stand.value = { art: "fehlt" };
        return;
    }
    const mein = ++lauf;
    ladeProblem.value = undefined;
    try {
        const status = await leseStatus(props.schluessel);
        if (mein === lauf) stand.value = { art: "da", status };
    } catch (fehler) {
        if (mein !== lauf) return;
        const art = fehlerArt(fehler);
        if (art === "nicht_gefunden") stand.value = { art: "fehlt" };
        else
            ladeProblem.value = art === "zu_viele" ? "photobox.status.ladefehlerZuViele" : "photobox.status.ladefehler";
    }
}
onMounted(() => void ladeStatus());
watch(
    () => props.schluessel,
    () => {
        stand.value = props.schluessel === null ? { art: "fehlt" } : { art: "laedt" };
        frage.value = false;
        problem.value = undefined;
        zurueckKennung = undefined;
        void ladeStatus();
    },
);

const status = computed(() => (stand.value.art === "da" ? stand.value.status : undefined));
const linkAdresse = computed(() => vorschlagAdresse(globalThis.location.origin, props.schluessel ?? ""));
const linkKopie = useLinkKopieren({ link: () => linkAdresse.value });
/** Der Satz zum Stand ist ruhig, solange nichts schiefging; bei einer Ablehnung, einem Rückzug oder einer unlesbaren Datei steht er im Ton der Warnung. */
const satzTon = computed<"neutral" | "warnung">(() =>
    status.value === undefined || ["incoming", "pending", "approved"].includes(status.value.zustand)
        ? "neutral"
        : "warnung",
);
const zeit = (iso: string): string => relativeTime(new Date(iso), new Date(), locale.value, "zeitpunkt");

const ZUSTAND_TEXT: Readonly<Record<KartenvorschlagZustand, MessageKey>> = {
    incoming: "photobox.status.zustand.incoming",
    technical_failed: "photobox.status.zustand.technical_failed",
    pending: "photobox.status.zustand.pending",
    approved: "photobox.status.zustand.approved",
    rejected: "photobox.status.zustand.rejected",
    withdrawn: "photobox.status.zustand.withdrawn",
};
const ZUSTAND_SATZ: Readonly<Record<KartenvorschlagZustand, MessageKey>> = {
    incoming: "kartenvorschlag.status.text.incoming",
    technical_failed: "kartenvorschlag.status.text.technical_failed",
    pending: "kartenvorschlag.status.text.pending",
    approved: "kartenvorschlag.status.text.approved",
    rejected: "kartenvorschlag.status.text.rejected",
    withdrawn: "kartenvorschlag.status.text.withdrawn",
};
const TON: Readonly<Record<KartenvorschlagZustand, "neutral" | "erfolg" | "warnung" | "gefahr">> = {
    incoming: "neutral",
    technical_failed: "warnung",
    pending: "neutral",
    approved: "erfolg",
    rejected: "gefahr",
    withdrawn: "gefahr",
};
const DATEI_TEXT: Readonly<Record<string, MessageKey>> = {
    "image/jpeg": "kartenvorschlag.status.datei.jpeg",
    "image/png": "kartenvorschlag.status.datei.png",
    "image/webp": "kartenvorschlag.status.datei.webp",
    "application/pdf": "kartenvorschlag.status.datei.pdf",
};

async function zieheZurueck(): Promise<void> {
    if (props.schluessel === null || sendet.value) return;
    zurueckKennung ??= newOperationId();
    sendet.value = true;
    problem.value = undefined;
    try {
        const neu = await ziehZurueck({ schluessel: props.schluessel, operationId: zurueckKennung });
        stand.value = { art: "da", status: neu };
        frage.value = false;
        zurueckKennung = undefined;
    } catch (fehler) {
        const art = fehlerArt(fehler);
        const bis = sperreBis(fehler, new Date());
        // WI-0291: 409 sagt, in welchem Stand der Vorschlag ist und was geht; sonst der allgemeine Satz.
        const genau = art === "uebergang" ? kartenvorschlagGrund(fehler) : undefined;
        problem.value =
            genau !== undefined
                ? { satz: genau }
                : {
                      key: FEHLER_SATZ[art],
                      ...(bis === undefined
                          ? {}
                          : { params: { uhr: relativeTime(bis, new Date(), locale.value, "zeitpunkt") } }),
                  };
        // Der Zustand erlaubt es nicht (mehr): Der Stand wird neu gelesen, damit der Knopf verschwindet.
        if (art === "uebergang" || art === "nicht_gefunden") {
            frage.value = false;
            void ladeStatus();
        }
    } finally {
        sendet.value = false;
    }
}
</script>

<template>
    <div class="ks" data-testid="kartenvorschlag-status">
        <p
            v-if="stand.art === 'laedt' && ladeProblem === undefined"
            class="ks__leise"
            role="status"
            data-testid="kartenvorschlag-status-laedt"
        >
            {{ t("photobox.status.laedt") }}
        </p>
        <AvmHinweis v-if="stand.art === 'fehlt'" ton="warnung" rolle="status" testid="kartenvorschlag-status-fehlt">
            {{ t("kartenvorschlag.status.fehlt") }}
        </AvmHinweis>
        <template v-else-if="status !== undefined">
            <LinkKasten
                testid="kartenvorschlag-status"
                :link="linkAdresse"
                :kopiert="linkKopie.anzeige.value"
                :merken-moeglich="false"
                :gemerkt="false"
                :satz="t('kartenvorschlag.fertig.linkHinweis')"
                @kopieren="linkKopie.kopiere()"
            />
            <div class="ks__kopf">
                <AvmPille :ton="TON[status.zustand]" testid="kartenvorschlag-status-zustand">{{
                    t(ZUSTAND_TEXT[status.zustand])
                }}</AvmPille>
                <span class="ks__leise">{{
                    t("kartenvorschlag.status.eingegangen", { zeit: zeit(status.eingegangenAm) })
                }}</span>
                <AvmKnopf groesse="zeile" testid="kartenvorschlag-status-neu-laden" @click="ladeStatus()">{{
                    t("photobox.status.neuLaden")
                }}</AvmKnopf>
            </div>
            <AvmHinweis
                v-if="ladeProblem !== undefined"
                ton="gefahr"
                rolle="alert"
                testid="kartenvorschlag-status-neu-fehler"
            >
                {{ t(ladeProblem) }}
            </AvmHinweis>
            <AvmHinweis :ton="satzTon" rolle="status" testid="kartenvorschlag-status-satz">
                {{ t(ZUSTAND_SATZ[status.zustand]) }}
            </AvmHinweis>
            <AvmHinweis v-if="status.grund !== null" ton="warnung" testid="kartenvorschlag-status-grund">
                <span class="ks__titel">{{ t("photobox.status.nachricht") }}</span>
                <span class="ks__grund">{{ status.grund }}</span>
            </AvmHinweis>

            <dl class="ks__fakten" data-testid="kartenvorschlag-status-fakten">
                <dt>{{ t("kartenvorschlag.status.nummer") }}</dt>
                <dd>{{ status.nummer }}</dd>
                <dt>{{ t("kartenvorschlag.status.faktTitel") }}</dt>
                <dd>{{ status.titel }}</dd>
                <template v-if="status.weg === 'link' && status.link !== null">
                    <dt>{{ t("kartenvorschlag.status.link") }}</dt>
                    <dd class="ks__adresse">{{ status.link }}</dd>
                </template>
                <template v-else-if="status.dateiTyp !== null">
                    <dt>{{ t("kartenvorschlag.status.datei") }}</dt>
                    <dd>{{ t(DATEI_TEXT[status.dateiTyp] ?? "kartenvorschlag.status.datei") }}</dd>
                </template>
            </dl>

            <AvmBestaetigung
                v-if="frage"
                :frage="t('kartenvorschlag.status.zurueckziehen.frage')"
                :folge="t('kartenvorschlag.status.zurueckziehen.folge')"
                :bestaetigen="t('kartenvorschlag.status.zurueckziehen')"
                :gesperrt="sendet ? t('photobox.sendet') : undefined"
                testid="kartenvorschlag-status-zurueckziehen-frage"
                @bestaetigen="zieheZurueck"
                @abbrechen="frage = false"
            />
            <AvmHinweis v-if="problem !== undefined" ton="gefahr" rolle="alert" testid="kartenvorschlag-status-problem">
                {{ "satz" in problem ? problem.satz : t(problem.key, problem.params) }}
            </AvmHinweis>
            <div v-if="status.zurueckziehbar && !frage" class="ks__reihe">
                <AvmKnopf testid="kartenvorschlag-status-zurueckziehen" @click="frage = true">{{
                    t("kartenvorschlag.status.zurueckziehen")
                }}</AvmKnopf>
            </div>
        </template>
        <AvmHinweis v-if="stand.art === 'laedt' && ladeProblem !== undefined" ton="gefahr" rolle="alert">
            {{ t(ladeProblem) }}
            <AvmKnopf groesse="zeile" testid="kartenvorschlag-status-nochmal" @click="ladeStatus()">{{
                t("photobox.status.neuLaden")
            }}</AvmKnopf>
        </AvmHinweis>
    </div>
</template>

<style scoped>
.ks {
    display: grid;
    gap: var(--space-10);
    min-width: 0;
}

.ks__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6) var(--space-8);
}

.ks__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.ks__titel {
    display: block;
    color: var(--color-text-strong);
}

.ks__grund {
    display: block;
    overflow-wrap: anywhere;
}

.ks__fakten {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2) var(--space-10);
    margin: 0;
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
}

.ks__fakten dt {
    color: var(--color-text-muted);
}

.ks__fakten dd {
    margin: 0;
    color: var(--color-text);
    overflow-wrap: anywhere;
}

.ks__adresse {
    font-size: var(--font-size-small);
}

.ks__reihe {
    display: flex;
    justify-content: flex-end;
}
</style>
