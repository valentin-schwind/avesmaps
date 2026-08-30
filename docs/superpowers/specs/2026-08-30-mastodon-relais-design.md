# Mastodon über ein Relais — Entwurf

**Stand 30.08.2026.** Anlass: `rollenspiel.social` verwirft die Pakete von STRATOs Ausgangsadresse
`81.169.144.135` (Phase `tcp`, Port 80 **und** 443, gemessen mit `api/edit/admin/ausgang-check.php`).
Die Instanz-Administration hat eine Ausnahme geprüft und abgelehnt — nachvollziehbar, die Adresse ist
Shared Hosting mit fremder Reputation — und ausdrücklich um eine Alternative auf unserer Seite
gebeten. Owner-Entscheid: Versand über einen GitHub-Workflow, Takt **30 Minuten**, und der Hub muss
**sichtbar machen, dass ein Beitrag noch in der Warteschlange steht**.

## 1. Was sich ändert — und was ausdrücklich nicht

🔴 **Nur Mastodon nimmt den Umweg.** Facebook, Instagram und „Neuigkeiten" senden unverändert direkt
vom Server. Ein zweiter Versandweg für alle wäre eine zweite Wahrheit über das Senden.

🔴 **Der Hub bleibt, wie er ist.** „Freigeben und veröffentlichen" ist derselbe Knopf. Was sich
ändert, ist allein die Auskunft: Mastodon steht danach auf **„wartet auf Versand"** statt sofort auf
grün.

## 2. Der Zustandsfluss

```
pending ──(Freigabe)──> queued ──(Workflow holt ab)──> sending ──> sent
                                                              └──> failed
```

💣 **`queued` und `sending` sind ZWEI Zustände, nicht einer.** `queued` heißt „niemand hat es
angefasst", `sending` heißt „ein Lauf hat es übernommen". Nur mit der Trennung lässt sich ein
abgestürzter Lauf von einem wartenden Beitrag unterscheiden — und genau das ist die Anzeige, die der
Owner verlangt hat.

💣 **Ein `sending` MUSS verfallen.** Bricht ein Workflow-Lauf zwischen Abholen und Zurückmelden ab
(GitHub bricht Läufe ab, das Netz reißt), bliebe der Beitrag sonst für immer in `sending` liegen und
niemand holt ihn je wieder. Nach `AVESMAPS_SOCIAL_RELAY_STALE_MINUTES` fällt er auf `queued` zurück.
⚠️ Der Wert muss deutlich über der Laufzeit eines Laufs liegen, sonst greifen sich zwei Läufe
denselben Beitrag.

⭐ **Doppelversand ist trotzdem abgesichert, unabhängig von diesem Zeitwert:** Mastodons
`Idempotency-Key` hängt an der Beitrags-ID und ist über alle Versuche derselbe — ein zweiter Versand
liefert den ursprünglichen Beitrag zurück, statt einen zweiten anzulegen. Das ist der Grund, warum
dieser Kanal der einzige ist, bei dem ein Relais überhaupt gefahrlos ist.

## 3. Die Weiche

🔴 **Sie sitzt in `avesmapsSocialDispatch` und sonst nirgends.** Drei Aufrufer (`publish.php` zweimal,
`retry.php`) gehen alle durch diese eine Funktion — die Falle vom 14.08.2026 („eine Regel, die einen
von vier Erzeugern bindet, ist keine Regel") ist hier bereits vermieden, weil es nur einen gibt.

💣 **Die Weiche steht NACH allen Prüfungen, nicht davor.** Kill-Switch, Zeichenlimit
(`avesmapsSocialCheckTarget`) und Bilderreichbarkeit laufen unverändert. Stünde sie davor, wanderte
ein zu langer Beitrag in die Warteschlange und scheiterte 30 Minuten später an etwas, das im
Augenblick des Klicks schon feststand — die Rückmeldung erreichte ihren Verfasser nie.

⭐ **Erkannt wird sie am Register** (`'relay' => 'github'` beim Kanal), nicht an `$key === 'mastodon'`.
Ein zweiter Kanal, der je dasselbe Problem bekommt, ist dann eine Datenzeile.

## 4. Die zwei Endpunkte

| Endpunkt | Tut |
|---|---|
| `POST /api/social/relay-next.php` | gibt den ältesten wartenden Beitrag heraus, setzt ihn auf `sending` |
| `POST /api/social/relay-result.php` | nimmt Ergebnis, Adresse und Fehlertext entgegen |

🔴 **Eigener Schlüssel `social.relay_token`** — nicht der von Discord, nicht `social.app_token`, nicht
der des SVG-Abzugs. Dieselbe Entscheidung wie am 08.08.2026: Bequemlichkeit ist kein Grund, zwei
Rechte zu verschmelzen; wer eines widerrufen will, muss es allein können.

💣 **`relay-next` gibt AUSSCHLIESSLICH Relais-Kanäle heraus.** Ein Endpunkt hinter einem Token, der
beliebige Beiträge herausreichte, wäre ein Leseweg an der Anmeldung vorbei. Er filtert auf
`channel_key`, dessen Register `relay` trägt.

🔴 **Er gibt NIE einen Zugangsschlüssel heraus** — der Mastodon-Token liegt in den GitHub Secrets, und
der Server kennt den GitHub-Weg nicht. Beide Seiten haben genau das Geheimnis, das sie brauchen.

💣 **Der Text wird SERVERSEITIG fertig gebaut** (`avesmapsSocialCompose`), nicht im Workflow. Baute
ihn der Workflow, gäbe es zwei Regeln dafür, wie Hashtags an einen Beitrag kommen — und die eine
davon würde im Hub angezeigt und die andere gesendet.

## 5. Was der Hub zeigt

- `queued` → **„wartet auf Versand"** mit der Wartezeit („seit 12 Min.")
- `sending` → **„wird gesendet"**
- ⚠️ Wartet ein Beitrag länger als `AVESMAPS_SOCIAL_RELAY_WARN_MINUTES`, sagt die Zeile das
  deutlich — dann läuft der Workflow nicht, und ohne diesen Hinweis sähe das genauso aus wie „gleich
  ist es so weit".

💣 **Ein unbekannter Zustand fällt weiterhin auf „wartet", nie auf „gesendet"** (bestehende Regel in
`review-social.js`). Die zwei neuen Zustände werden ausdrücklich benannt, statt sich auf den Rückfall
zu verlassen.

## 6. Der Workflow

`.github/workflows/mastodon-relay.yml`, `cron: */30`, ruft `tools/social/mastodon-relais.mjs`.

⭐ **Die Logik liegt in der `.mjs`, nicht im YAML** — dasselbe Muster wie beim SVG-Abzug. Ein
Workflow-Schritt lässt sich nicht testen, eine Node-Datei schon.

⚠️ **GitHubs Zeitplan ist keine Zusage.** Geplante Läufe verschieben sich bei Last um Minuten, und
GitHub schaltet Zeitpläne in Repositorien ohne Aktivität nach 60 Tagen ab. Ersteres ist egal,
Letzteres trifft dieses Repository nicht (es wird täglich gepusht) — aber die Warnzeile aus §5 ist
genau dafür da.

💣 **Ein Lauf ohne Arbeit ist ein Erfolg, kein Fehler.** Der Normalfall ist „nichts zu tun"; ein
Workflow, der dann rot wird, erzeugt Dutzende Fehlmeldungen pro Tag und wird nach einer Woche
ignoriert — samt der echten.
