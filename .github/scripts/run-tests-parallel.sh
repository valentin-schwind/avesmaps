#!/usr/bin/env bash
# DAS DEPLOY-TOR, PARALLEL: faehrt jede Testdatei, die NUL-getrennt auf stdin ankommt.
#
# Aufruf aus der Wurzel des Repos. Die zwei find-Muster stehen im Workflow, nicht hier -- dort sucht
# sie jeder, der wissen will, was das Tor faehrt (AGENTS.md §9):
#   { find api tools \( \( … \) -o \( … \) \) -print0
#     find js tools \( \( … \) -o \( … \) \) -print0; } | bash .github/scripts/run-tests-parallel.sh
#
# 💣 Bis zum 15.09.2026 lief das Tor streng nacheinander: rund 4 von 5 Minuten eines Deploys, auf
#    einem Runner mit 4 Kernen. Der Upload selbst dauert 12-20 s.
#
# 🔴 JEDER TEST BEKOMMT SEIN EIGENES TEMP-VERZEICHNIS (TMPDIR, dazu TMP/TEMP fuer Windows). Parallele
#    Tests teilen sich sonst /tmp, und das ist nicht theoretisch: map-features-cache-test.php raeumt
#    im Cacheverzeichnis der Kartennutzlast auf und zaehlt danach die Dateien, waehrend zwei andere
#    Tests denselben Cache beschreiben. PHP (sys_get_temp_dir) und Node (os.tmpdir) lesen die Variable
#    beide -- auch ein Test, der seinen Pfad selbst zusammensetzt, landet also in seinem eigenen.
#
# 🔴 EIN ROTER TEST WIRD EINMAL ALLEIN NACHGEFAHREN. Rot im Verbund und gruen allein heisst: er teilt
#    sich etwas mit einem Nachbarn (eine Datei im Baum, einen Port, ein Zeitfenster). Das haelt keinen
#    Deploy auf, wird aber mit Namen als ::warning gemeldet -- ein wackelnder Test, an den man sich
#    gewoehnt, ist genau der Zustand, aus dem das Tor am 05.08.2026 entstanden ist. Rot auch allein
#    ist rot.
#
# ⚠️ Eine leere Liste ist ROT: ein Tor, das nichts prueft, meldet sonst „0 rot". Und jede Datei muss
#    ein Ergebnis hinterlassen -- ein Kindprozess, der stirbt, bevor er seins schreibt, fiele sonst
#    lautlos aus der Zaehlung.
#
# Stellschrauben (Umgebung):
#   AVESMAPS_TEST_JOBS      parallele Prozesse, Vorgabe: Zahl der Kerne
#   AVESMAPS_TEST_PHP_ARGS  zusaetzliche php-Argumente; lokal unter Windows z. B.
#                           "-d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll"
#
# Gewacht von tools/__tests__/tor-parallel.test.js.

set -uo pipefail

# Faehrt EINE Testdatei in einem frischen Temp-Verzeichnis. Exit-Code = der des Tests.
# 💣 `< /dev/null` ist tragend: der Nachlauf unten liest seine Liste von stdin, und ein Test, der
#    stdin liest, frasse sie sonst leer.
fahre_einen() {
  local datei="$1" log="$2" tmp tmp_nativ rc
  tmp="$(mktemp -d "$AVESMAPS_TOR_WERKSTATT/tmp/t.XXXXXX")" || return 97
  tmp_nativ="$tmp"
  # Unter Git Bash sind php und node Windows-Programme: sie lesen TMP/TEMP, und zwar als Windows-Pfad.
  if command -v cygpath > /dev/null 2>&1; then
    tmp_nativ="$(cygpath -w "$tmp")"
  fi
  case "$datei" in
    *.php)
      # zend.assertions=1 ist nicht verhandelbar: ohne das ist assert() ein No-op und jeder Test gruen.
      # AVESMAPS_TEST_PHP_ARGS wird bewusst an Leerzeichen zerlegt, darum ohne Anfuehrungszeichen.
      # shellcheck disable=SC2086
      TMPDIR="$tmp" TMP="$tmp_nativ" TEMP="$tmp_nativ" \
        php -d zend.assertions=1 -d assert.exception=1 ${AVESMAPS_TEST_PHP_ARGS:-} "$datei" < /dev/null > "$log" 2>&1
      ;;
    *)
      TMPDIR="$tmp" TMP="$tmp_nativ" TEMP="$tmp_nativ" node "$datei" < /dev/null > "$log" 2>&1
      ;;
  esac
  rc=$?
  rm -rf "$tmp"
  return "$rc"
}

schluessel_von() {
  printf '%s' "$1" | md5sum | cut -c1-32
}

# ---- Kindprozess: eine Datei, ein Ergebnis ---------------------------------------------------------
if [[ "${1:-}" == "--einzeln" ]]; then
  AVESMAPS_TOR_WERKSTATT="$2"
  datei="$3"
  s="$(schluessel_von "$datei")"
  if fahre_einen "$datei" "$AVESMAPS_TOR_WERKSTATT/log/$s"; then rc=0; else rc=$?; fi
  printf '%s\t%s\n' "$rc" "$datei" > "$AVESMAPS_TOR_WERKSTATT/rc/$s"
  exit 0
fi

# ---- Hauptlauf -------------------------------------------------------------------------------------
jobs="${AVESMAPS_TEST_JOBS:-$(nproc 2> /dev/null || echo 4)}"
AVESMAPS_TOR_WERKSTATT="$(mktemp -d)" || { echo "::error title=Tor::Kein Temp-Verzeichnis anlegbar."; exit 1; }
trap 'rm -rf "$AVESMAPS_TOR_WERKSTATT"' EXIT
mkdir -p "$AVESMAPS_TOR_WERKSTATT/tmp" "$AVESMAPS_TOR_WERKSTATT/log" "$AVESMAPS_TOR_WERKSTATT/rc"

liste="$AVESMAPS_TOR_WERKSTATT/liste"
cat > "$liste"
gesamt=$(( $(tr -dc '\0' < "$liste" | wc -c) ))
if [[ "$gesamt" -eq 0 ]]; then
  echo "::error title=Tor leer::Keine einzige Testdatei bekommen. Ein Tor, das nichts prueft, ist nicht gruen -- stimmen die find-Muster (die Klammer um BEIDE Gruppen, AGENTS.md §9)?"
  exit 1
fi

echo "Tor: ${gesamt} Testdateien, ${jobs} parallel."
start=$SECONDS

# 💣 `-n 1`, nie `-I{}` dazu -- die beiden schliessen sich aus (AGENTS.md §9). Die Kinder schreiben ihr
#    Ergebnis in eine Datei und enden immer mit 0; ein Exit ungleich 0 heisst hier also, dass ein
#    Kindprozess abgebrochen wurde.
if ! xargs -0 -P "$jobs" -n 1 bash "${BASH_SOURCE[0]}" --einzeln "$AVESMAPS_TOR_WERKSTATT" < "$liste"; then
  echo "::error title=Tor abgebrochen::xargs ist nicht sauber durchgelaufen -- ein Testprozess wurde abgebrochen."
  exit 1
fi

ergebnisse="$(find "$AVESMAPS_TOR_WERKSTATT/rc" -type f -exec cat {} + | sort -t $'\t' -k 2)"
anzahl=0
[[ -n "$ergebnisse" ]] && anzahl="$(grep -c . <<< "$ergebnisse")"
if [[ "$anzahl" -ne "$gesamt" ]]; then
  echo "::error title=Tor unvollstaendig::${gesamt} Testdateien bekommen, aber ${anzahl} Ergebnisse -- ein Testprozess ist gestorben, bevor er sein Ergebnis schrieb, oder eine Datei stand doppelt auf der Liste."
  exit 1
fi

php_ok=0
js_ok=0
nur_allein=0
failed=0
while IFS=$'\t' read -r rc datei; do
  art=JS
  [[ "$datei" == *.php ]] && art=PHP

  if [[ "$rc" != 0 ]]; then
    s="$(schluessel_von "$datei")"
    if fahre_einen "$datei" "$AVESMAPS_TOR_WERKSTATT/log/$s.allein"; then
      nur_allein=$((nur_allein + 1))
      echo "::warning file=${datei},title=Nur allein gruen::${art}-Test war im Parallellauf rot (Exit ${rc}) und allein gruen -- er teilt sich etwas mit einem Nachbarn (Datei im Baum, Port, Zeitfenster). Der Deploy laeuft weiter; darunter die Ausgabe des roten Laufs."
      tail -20 "$AVESMAPS_TOR_WERKSTATT/log/$s"
    else
      failed=1
      echo "::error file=${datei}::${art} test failed"
      tail -20 "$AVESMAPS_TOR_WERKSTATT/log/$s.allein"
      continue
    fi
  fi

  if [[ "$art" == PHP ]]; then
    php_ok=$((php_ok + 1))
  else
    js_ok=$((js_ok + 1))
  fi
done <<< "$ergebnisse"

echo "PHP ${php_ok} green, JS ${js_ok} green (${gesamt} Dateien, ${jobs} parallel, $((SECONDS - start)) s; davon ${nur_allein} erst allein gruen)."

if [[ "$failed" -ne 0 ]]; then
  echo "::error title=Tests failed::Nothing was uploaded. Fix the tests, then push again."
  exit 1
fi
