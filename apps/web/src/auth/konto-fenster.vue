<script setup lang="ts">
/**
 * Das eigene Konto (WI-0120 A9, AUTH-0001 §12.2 `konto-fenster`): eigene Angaben samt „Verantwortlich für:“ (WI-0133, eine Zeile mit
 * Speichern), Anmeldewege verknüpfen oder lösen, Passwort ändern oder einrichten, Passkeys, die offenen Sitzungen mit „diese“, eigene
 * Rechte samt Sonderrechten und die Stufe dieser Sitzung. Gefährliches (lösen, entfernen) fragt an Ort und Stelle nach (`AvmBestaetigung`), nie in einem zweiten Fenster.
 */
import { computed, ref, useId, watch } from "vue";
import { RESPONSIBILITY_MAX, type Bezeichnung } from "@avesmaps3d/shared";
import type { ReturnOutcome } from "./entry";
import AvmAvatar from "../controls/avm-avatar.vue";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterMauer from "../fenster/fenster-mauer.vue";
import { isMessageKey, locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import AnmeldeFeldzeilen from "./anmelde-feldzeilen.vue";
import { requestConfirmation } from "./bestaetigen";
import { bezeichnungsWahlen, rollenName, sonderrollenZeilen } from "./bezeichnung";
import DiscordZeichen from "./discord-zeichen.vue";
import { untilText } from "./formular";
import { createAccount, type AccountAction } from "./konto";
import { authState, refreshSession } from "./session-state";
import { hasAdminRights, secondFactorMissing } from "./zweiter-faktor";

const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{ outcome?: ReturnOutcome | undefined }>();

const session = authState.value;
const konto = createAccount();
const { detail, busy, problems, problemOf } = konto;

watch(
    offen,
    (jetzt) => {
        if (jetzt) void konto.load();
    },
    { immediate: true },
);

const person = computed(() => detail.value?.person ?? null);
const rueckkehr = computed(() => (props.outcome === undefined ? null : t(`auth.return.${props.outcome}`)));
const label = (prefix: string, value: string): string => {
    const key = `${prefix}.${value}`;
    return isMessageKey(key) ? t(key) : value;
};
const jetzt = (): Date => new Date();
const vor = (iso: string): string => relativeTime(new Date(iso), jetzt(), locale.value);
/**
 * Die Stufe dieser Sitzung sagt dasselbe wie die Verwaltung (Betreiber 2026-10-10: „2 faktoren oder keiner“, keine Frist): mit
 * zweitem Faktor ist die Verwaltung offen, solange die Sitzung besteht; ohne fehlt er, und der Knopf daneben bestätigt ihn.
 * Reaktiv, damit die Zeile nach der Bestätigung ohne Neuladen stimmt.
 */
const stufe = computed(() => {
    const jetzt = authState.value;
    const assurance = jetzt.person?.assurance;
    if (assurance === "recovery")
        return t("auth.recovery.badge", { time: untilText(jetzt.person!.expiresAt, locale.value) });
    const verwaltung = hasAdminRights(jetzt.capabilities);
    if (assurance === "strong")
        return verwaltung ? t("auth.account.level.strongAdmin") : t("auth.account.level.strong");
    return verwaltung ? t("auth.secondFactor.missing") : t("auth.account.level.basic");
});
const zweiterFaktorFehlt = computed(() => secondFactorMissing(authState.value));
const meldungBei = (action: AccountAction): boolean => problems.value.length > 0 && problemOf.value === action;

// Anzeigename ändern, an Ort und Stelle.
const nameId = useId();
const umbenennen = ref(false);
const neuerName = ref("");
function nameBearbeiten(): void {
    neuerName.value = person.value?.displayName ?? "";
    umbenennen.value = true;
}
async function nameSpeichern(): Promise<void> {
    if (await konto.rename(neuerName.value)) umbenennen.value = false;
}

// „Verantwortlich für:“ (WI-0133): das Feld zeigt den gespeicherten Stand, bis jemand tippt; Speichern erst, wenn es anders ist.
const verantwortungId = useId();
const verantwortungHinweisId = useId();
const verantwortung = ref("");
watch(
    () => person.value?.responsibleFor,
    (wert) => (verantwortung.value = wert ?? ""),
    { immediate: true },
);
const verantwortungGeaendert = computed(() => verantwortung.value.trim() !== (person.value?.responsibleFor ?? ""));
async function verantwortungSpeichern(): Promise<void> {
    if (!verantwortungGeaendert.value) return;
    await konto.setResponsibility(verantwortung.value);
}

// Bezeichnung (WI-0279 E10): Sie gilt mit dem Klick; die Sitzung liest sie neu, damit Kopfleiste und Kontomenü folgen.
const bezeichnung = computed<string>({
    get: () => person.value?.bezeichnung ?? "neutral",
    set: (wert) => void waehleBezeichnung(wert as Bezeichnung),
});
const bezeichnungen = computed(() =>
    person.value === null ? [] : bezeichnungsWahlen(person.value.role, person.value.sonderrollen),
);
async function waehleBezeichnung(wert: Bezeichnung): Promise<void> {
    if (await konto.setBezeichnung(wert)) await refreshSession();
}
const sonderrollen = computed(() => sonderrollenZeilen(person.value?.sonderrollen, person.value?.bezeichnung));

// Passwort ändern oder einrichten.
const passwortOffen = ref(false);
const bisherId = useId();
const neuId = useId();
const loginId = useId();
const regelId = useId();
const bisher = ref("");
const neu = ref("");
const loginName = ref("");
async function passwortSpeichern(): Promise<void> {
    const ok = await konto.changePassword({
        current: bisher.value,
        next: neu.value,
        ...(detail.value?.loginName === null ? { loginName: loginName.value } : {}),
    });
    if (ok) {
        passwortOffen.value = false;
        bisher.value = "";
        neu.value = "";
    }
}

// Rückfragen an Ort und Stelle.
const frage = ref<{ was: "discord" } | { was: "passkey"; id: string; name: string } | null>(null);
async function bestaetigt(): Promise<void> {
    const offene = frage.value;
    frage.value = null;
    if (offene?.was === "discord") await konto.unlinkDiscord();
    else if (offene?.was === "passkey") await konto.removePasskey(offene.id);
}

// Einen weiteren Passkey hinzufügen.
const passkeyName = ref("");
const passkeyNameId = useId();
async function passkeyHinzu(): Promise<void> {
    if (await konto.addPasskey(passkeyName.value)) passkeyName.value = "";
}
const zweiterPasskey = computed(
    () =>
        (detail.value?.passkeys.length ?? 0) === 1 &&
        (person.value?.role === "operator" || (detail.value?.specialCapabilities.length ?? 0) > 0),
);
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="lesen"
        :titel="t('auth.account.title')"
        testid="konto-fenster"
    >
        <AvmHinweis v-if="rueckkehr !== null" ton="warnung" rolle="status" testid="konto-rueckkehr">{{
            rueckkehr
        }}</AvmHinweis>
        <p v-if="detail === null" class="konto__still">{{ t("auth.account.loading") }}</p>
        <FensterMauer v-else-if="person !== null">
            <FensterKarte :titel="t('auth.account.card.person')">
                <div class="konto__kopf">
                    <AvmAvatar :kennung="person.id" :name="person.displayName" groesse="gross" />
                    <div v-if="!umbenennen" class="konto__wer">
                        <span class="konto__name einzeilig" data-testid="konto-name">{{ person.displayName }}</span>
                        <span class="konto__leise">{{ rollenName(person.role, person.bezeichnung) }}</span>
                    </div>
                    <AvmKnopf v-if="!umbenennen" groesse="zeile" testid="konto-umbenennen" @click="nameBearbeiten()">{{
                        t("auth.account.rename")
                    }}</AvmKnopf>
                </div>
                <AnmeldeFeldzeilen v-if="umbenennen" @submit="nameSpeichern()">
                    <label :for="nameId">{{ t("auth.invitation.displayName") }}</label>
                    <AvmEingabe :id="nameId" v-model="neuerName" autocomplete="nickname" testid="konto-name-feld" />
                    <AvmHinweis v-if="meldungBei('rename')" class="breit" ton="gefahr" rolle="alert">
                        <span v-for="p in problems" :key="p.key" class="konto__zeile">{{ t(p.key, p.params) }}</span>
                    </AvmHinweis>
                    <span class="breit konto__knoepfe">
                        <AvmKnopf typ="submit" art="gefuellt" :gesperrt="busy === 'rename' ? '' : undefined">{{
                            t("auth.account.save")
                        }}</AvmKnopf>
                        <AvmKnopf @click="umbenennen = false">{{ t("ui.confirm.cancel") }}</AvmKnopf>
                    </span>
                </AnmeldeFeldzeilen>
                <AnmeldeFeldzeilen @submit="verantwortungSpeichern()">
                    <span class="konto__feldname">{{ t("auth.account.bezeichnung") }}</span>
                    <span class="feldwert">
                        <AvmSegmente
                            v-model="bezeichnung"
                            :options="bezeichnungen"
                            :label="t('auth.account.bezeichnung')"
                            gestapelt="auto"
                            testid="konto-bezeichnung"
                        />
                        <span class="feldhinweis konto__hinweis">{{ t("auth.account.bezeichnung.hint") }}</span>
                    </span>
                    <AvmHinweis v-if="meldungBei('bezeichnung')" class="breit" ton="gefahr" rolle="alert">
                        <span v-for="p in problems" :key="p.key" class="konto__zeile">{{ t(p.key, p.params) }}</span>
                    </AvmHinweis>
                    <label class="oben" :for="verantwortungId">{{ t("auth.account.responsibleFor") }}</label>
                    <span class="feldwert">
                        <AvmEingabe
                            :id="verantwortungId"
                            v-model="verantwortung"
                            :maxlength="RESPONSIBILITY_MAX"
                            autocomplete="off"
                            :placeholder="t('auth.account.responsibleFor.placeholder')"
                            :aria-describedby="verantwortungHinweisId"
                            testid="konto-verantwortung-feld"
                        />
                        <span class="konto__unterzeile">
                            <span :id="verantwortungHinweisId" class="feldhinweis konto__hinweis">{{
                                t("auth.account.responsibleFor.hint", { max: RESPONSIBILITY_MAX })
                            }}</span>
                            <AvmKnopf
                                typ="submit"
                                groesse="zeile"
                                :gesperrt="busy === 'responsibility' || !verantwortungGeaendert ? '' : undefined"
                                testid="konto-verantwortung-speichern"
                                >{{ t("auth.account.save") }}</AvmKnopf
                            >
                        </span>
                    </span>
                    <AvmHinweis v-if="meldungBei('responsibility')" class="breit" ton="gefahr" rolle="alert">
                        <span v-for="p in problems" :key="p.key" class="konto__zeile">{{ t(p.key, p.params) }}</span>
                    </AvmHinweis>
                </AnmeldeFeldzeilen>
                <dl class="konto__angaben">
                    <dt>{{ t("auth.invitation.environment") }}</dt>
                    <dd>{{ label("auth.environment.name", session.environment ?? "") }}</dd>
                    <dt>{{ t("auth.account.thisSession") }}</dt>
                    <dd>{{ label("auth.menu.signedIn", session.person?.sessionMethod ?? "") }}</dd>
                    <dt>{{ t("auth.account.level") }}</dt>
                    <dd class="konto__stufe">
                        <span data-testid="konto-stufe">{{ stufe }}</span>
                        <AvmKnopf
                            v-if="zweiterFaktorFehlt"
                            groesse="zeile"
                            testid="konto-zweiter-faktor"
                            @click="requestConfirmation('second_factor')"
                            >{{ t("auth.secondFactor.withPasskey") }}</AvmKnopf
                        >
                    </dd>
                </dl>
                <div v-if="detail.specialCapabilities.length > 0" class="konto__sonderrechte">
                    <span class="konto__leise">{{ t("auth.account.special") }}</span>
                    <AvmPille v-for="grant in detail.specialCapabilities" :key="grant.capability" ton="warnung">{{
                        label("auth.capability", grant.capability)
                    }}</AvmPille>
                </div>
            </FensterKarte>

            <FensterKarte v-if="sonderrollen.length > 0" :titel="t('auth.account.card.sonderrollen')">
                <div class="konto__sonderrollen" data-testid="konto-sonderrollen">
                    <AvmPille v-for="zeile in sonderrollen" :key="zeile.sonderrolle">{{ zeile.text }}</AvmPille>
                </div>
                <p class="konto__leise">{{ t("auth.account.sonderrollen.hint") }}</p>
            </FensterKarte>

            <FensterKarte :titel="t('auth.account.card.methods')">
                <div class="konto__reihe" data-testid="konto-discord">
                    <span class="konto__wer">
                        <span>{{ t("auth.account.discord") }}</span>
                        <span class="konto__leise">{{
                            detail.discord === null
                                ? t("auth.account.discord.none")
                                : t("auth.account.discord.as", {
                                      name:
                                          detail.discord.globalName ?? detail.discord.username ?? detail.discord.userId,
                                  })
                        }}</span>
                    </span>
                    <AvmKnopf
                        v-if="detail.discord === null"
                        groesse="zeile"
                        :gesperrt="busy === 'discord-link' ? '' : undefined"
                        testid="konto-discord-verknuepfen"
                        @click="konto.linkDiscord()"
                        ><template #zeichen><DiscordZeichen groesse="zeile" /></template
                        >{{ t("auth.account.discord.link") }}</AvmKnopf
                    >
                    <AvmKnopf
                        v-else
                        art="gefahr"
                        groesse="zeile"
                        :gesperrt="detail.loginName === null ? t('auth.account.discord.needsPassword') : undefined"
                        testid="konto-discord-loesen"
                        @click="frage = { was: 'discord' }"
                        >{{ t("auth.account.discord.unlink") }}</AvmKnopf
                    >
                </div>
                <AvmBestaetigung
                    v-if="frage?.was === 'discord'"
                    :frage="t('auth.account.discord.unlinkQuestion')"
                    :folge="t('auth.account.discord.unlinkFollows')"
                    :bestaetigen="t('auth.account.discord.unlink')"
                    @bestaetigen="bestaetigt()"
                    @abbrechen="frage = null"
                />
                <AvmHinweis
                    v-if="meldungBei('discord-link') || meldungBei('discord-unlink')"
                    ton="gefahr"
                    rolle="alert"
                >
                    <span v-for="p in problems" :key="p.key" class="konto__zeile">{{ t(p.key, p.params) }}</span>
                </AvmHinweis>

                <div class="konto__reihe" data-testid="konto-passwort">
                    <span class="konto__wer">
                        <span>{{ t("auth.account.password") }}</span>
                        <span class="konto__leise">{{
                            detail.loginName === null
                                ? t("auth.account.password.none")
                                : t("auth.account.password.as", { name: detail.loginName })
                        }}</span>
                    </span>
                    <AvmKnopf
                        v-if="!passwortOffen"
                        groesse="zeile"
                        testid="konto-passwort-oeffnen"
                        @click="passwortOffen = true"
                        >{{
                            detail.loginName === null
                                ? t("auth.account.password.setUp")
                                : t("auth.account.password.change")
                        }}</AvmKnopf
                    >
                </div>
                <AnmeldeFeldzeilen v-if="passwortOffen" @submit="passwortSpeichern()">
                    <template v-if="detail.loginName === null">
                        <label :for="loginId">{{ t("auth.login.username") }}</label>
                        <AvmEingabe :id="loginId" v-model="loginName" autocomplete="username" />
                    </template>
                    <template v-else>
                        <label :for="bisherId">{{ t("auth.account.password.current") }}</label>
                        <AvmEingabe
                            :id="bisherId"
                            v-model="bisher"
                            art="passwort"
                            autocomplete="current-password"
                            testid="konto-passwort-bisher"
                        />
                    </template>
                    <label class="oben" :for="neuId">{{ t("auth.reset.newPassword") }}</label>
                    <span class="feldwert">
                        <AvmEingabe
                            :id="neuId"
                            v-model="neu"
                            art="passwort"
                            autocomplete="new-password"
                            :aria-describedby="regelId"
                            testid="konto-passwort-neu"
                        />
                        <span :id="regelId" class="feldhinweis">{{ t("auth.password.rule") }}</span>
                    </span>
                    <AvmHinweis v-if="meldungBei('password')" class="breit" ton="gefahr" rolle="alert">
                        <span v-for="p in problems" :key="p.key" class="konto__zeile">{{ t(p.key, p.params) }}</span>
                    </AvmHinweis>
                    <span class="breit konto__knoepfe">
                        <AvmKnopf
                            typ="submit"
                            art="gefuellt"
                            :gesperrt="busy === 'password' ? '' : undefined"
                            testid="konto-passwort-speichern"
                            >{{ t("auth.account.save") }}</AvmKnopf
                        >
                        <AvmKnopf @click="passwortOffen = false">{{ t("ui.confirm.cancel") }}</AvmKnopf>
                    </span>
                </AnmeldeFeldzeilen>
            </FensterKarte>

            <FensterKarte :titel="t('auth.account.card.passkeys')">
                <p v-if="detail.passkeys.length === 0" class="konto__leise">{{ t("auth.account.passkeys.none") }}</p>
                <div v-for="key in detail.passkeys" :key="key.id" class="konto__reihe" data-testid="konto-passkey">
                    <span class="konto__wer">
                        <span>
                            {{ key.label ?? t("auth.account.passkeys.unnamed") }}
                            <AvmPille v-if="key.backedUp" ton="erfolg">{{
                                t("auth.account.passkeys.synced")
                            }}</AvmPille>
                        </span>
                        <span class="konto__leise">{{
                            key.lastUsedAt === null
                                ? t("auth.account.passkeys.created", { time: vor(key.createdAt) })
                                : t("auth.account.passkeys.used", { time: vor(key.lastUsedAt) })
                        }}</span>
                    </span>
                    <AvmKnopf
                        art="gefahr"
                        groesse="zeile"
                        testid="konto-passkey-entfernen"
                        @click="
                            frage = {
                                was: 'passkey',
                                id: key.id,
                                name: key.label ?? t('auth.account.passkeys.unnamed'),
                            }
                        "
                        >{{ t("auth.account.passkeys.remove") }}</AvmKnopf
                    >
                </div>
                <AvmBestaetigung
                    v-if="frage?.was === 'passkey'"
                    :frage="t('auth.account.passkeys.removeQuestion', { name: frage.name })"
                    :folge="t('auth.account.passkeys.removeFollows')"
                    :bestaetigen="t('auth.account.passkeys.remove')"
                    @bestaetigen="bestaetigt()"
                    @abbrechen="frage = null"
                />
                <AvmHinweis v-if="zweiterPasskey" ton="warnung">{{ t("auth.passkey.second") }}</AvmHinweis>
                <AnmeldeFeldzeilen v-if="detail.passkeys.length > 0" @submit="passkeyHinzu()">
                    <label :for="passkeyNameId">{{ t("auth.passkey.label") }}</label>
                    <AvmEingabe :id="passkeyNameId" v-model="passkeyName" autocomplete="off" />
                    <AvmHinweis
                        v-if="meldungBei('passkey-add') || meldungBei('passkey-remove')"
                        class="breit"
                        ton="gefahr"
                        rolle="alert"
                    >
                        <span v-for="p in problems" :key="p.key" class="konto__zeile">{{ t(p.key, p.params) }}</span>
                    </AvmHinweis>
                    <AvmKnopf
                        class="breit"
                        typ="submit"
                        :gesperrt="busy === 'passkey-add' ? '' : undefined"
                        testid="konto-passkey-hinzu"
                        >{{ t("auth.account.passkeys.add") }}</AvmKnopf
                    >
                </AnmeldeFeldzeilen>
                <p v-else class="konto__leise">{{ t("auth.account.passkeys.firstByLink") }}</p>
            </FensterKarte>

            <FensterKarte :titel="t('auth.account.card.sessions')">
                <div v-for="entry in detail.sessions" :key="entry.id" class="konto__reihe" data-testid="konto-sitzung">
                    <span class="konto__wer">
                        <span>
                            {{ entry.clientLabel ?? t("auth.account.sessions.unknownDevice") }}
                            <AvmPille v-if="entry.current" ton="neutral">{{
                                t("auth.account.sessions.this")
                            }}</AvmPille>
                        </span>
                        <span class="konto__leise">{{
                            t("auth.account.sessions.seen", {
                                method: label("auth.menu.signedIn", entry.method),
                                time: vor(entry.lastSeenAt),
                            })
                        }}</span>
                    </span>
                    <AvmKnopf
                        v-if="!entry.current"
                        groesse="zeile"
                        :gesperrt="busy === 'session' ? '' : undefined"
                        testid="konto-sitzung-beenden"
                        @click="konto.endSession(entry.id)"
                        >{{ t("auth.account.sessions.end") }}</AvmKnopf
                    >
                </div>
                <AvmHinweis v-if="meldungBei('session') || meldungBei('sessions')" ton="gefahr" rolle="alert">
                    <span v-for="p in problems" :key="p.key" class="konto__zeile">{{ t(p.key, p.params) }}</span>
                </AvmHinweis>
                <AvmKnopf
                    v-if="detail.sessions.length > 1"
                    :gesperrt="busy === 'sessions' ? '' : undefined"
                    testid="konto-sitzungen-beenden"
                    @click="konto.endSession()"
                    >{{ t("auth.account.sessions.endOthers") }}</AvmKnopf
                >
            </FensterKarte>
        </FensterMauer>
        <AvmHinweis v-if="detail === null && problems.length > 0" ton="gefahr" rolle="alert">
            <span v-for="p in problems" :key="p.key" class="konto__zeile">{{ t(p.key, p.params) }}</span>
        </AvmHinweis>
    </AvmFenster>
</template>

<style scoped>
.konto__still {
    margin: 0;
    color: var(--color-text-muted);
}

.konto__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-8);
}

.konto__wer {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.konto__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
}

.konto__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Wie ein `label.oben` der Feldzeilen; der Schalter trägt seinen Namen selbst und hat kein Feld, auf das ein `for` zeigte. */
.konto__feldname {
    align-self: start;
    margin-top: var(--space-6);
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.konto__sonderrollen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
}

.konto__angaben {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    gap: var(--space-4) var(--space-8);
    margin: 0;
}

.konto__angaben dt {
    color: var(--color-text-muted);
}

.konto__angaben dd {
    margin: 0;
    color: var(--color-text-strong);
}

.konto__stufe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.konto__sonderrechte {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}

.konto__reihe {
    display: flex;
    align-items: center;
    gap: var(--space-8);
}

/* „Verantwortlich für:“: das Feld über die ganze Breite, darunter der Hinweis und „Speichern“ rechts daneben. */
.konto__unterzeile {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8);
}

.konto__hinweis {
    flex: 1 1 auto;
    min-width: 0;
}

.konto__knoepfe {
    display: flex;
    gap: var(--space-6);
}

.konto__zeile {
    display: block;
}
</style>
