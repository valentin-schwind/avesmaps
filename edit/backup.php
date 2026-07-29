<?php

declare(strict_types=1);

/**
 * Datenbank-Backup page (admin only).
 * ---------------------------------------------------------------------------
 * Reached from the "💾 Datenbank-Backup" link in the edit shell's top bar, next to
 * the handbook. One button builds a complete, gzip-packed .sql dump of the whole
 * database and the browser downloads it when it is done.
 *
 * The heavy lifting is api/_internal/backup/db-dump.php, driven through
 * api/edit/admin/database-backup.php. This page is only the shell plus the step
 * loop: a full dump takes far longer than one PHP request may spend on STRATO, so
 * the client POSTs `step` until the run reports `done` -- the same shape the
 * WikiSync passes use.
 *
 * ADMIN ONLY, deliberately: the dump carries `users.password_hash`, every share
 * link and every report. The endpoint enforces it too; this page's gate only keeps
 * the surface out of an editor's way.
 */

require __DIR__ . '/../api/auth.php';

$config = avesmapsLoadApiConfig(dirname(__DIR__) . '/api');
$pdo = avesmapsCreatePdo($config['database'] ?? []);
$loginError = '';

$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($requestMethod === 'POST') {
    $action = avesmapsNormalizeSingleLine((string) ($_POST['action'] ?? 'login'), 20);

    if ($action === 'logout') {
        avesmapsLogout();
        header('Location: ./');
        exit;
    }

    $user = avesmapsLogin($pdo, (string) ($_POST['username'] ?? ''), (string) ($_POST['password'] ?? ''));
    if ($user !== null && avesmapsUserCan($user, 'admin')) {
        header('Location: ./backup.php');
        exit;
    }

    avesmapsLogout();
    $loginError = 'Login fehlgeschlagen oder keine Admin-Berechtigung.';
}

$currentUser = avesmapsCurrentUser();
$isAdmin = $currentUser !== null && avesmapsUserCan($currentUser, 'admin');

?><!DOCTYPE html>
<html lang="de">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Avesmaps Datenbank-Backup</title>
    <!-- Hand-written on purpose: the deploy's asset stamper only follows index.html and
         html/*.html, so it never reaches this PHP page. Bump this whenever db-backup.css
         changes, or admins keep the cached stylesheet. See AGENTS.md sec.7. -->
    <link rel="stylesheet" href="../css/pages/db-backup.css?v=20260729-backup" />
</head>

<body class="edit-page">
    <?php if (!$isAdmin) : ?>
        <main class="edit-login">
            <form class="edit-login__panel" method="post" action="./backup.php">
                <input type="hidden" name="action" value="login" />
                <h1>Datenbank-Backup</h1>
                <p>Bitte melde dich mit deinem Admin-Zugang an.</p>
                <?php if ($loginError !== '') : ?>
                    <p class="edit-login__error" role="alert"><?php echo htmlspecialchars($loginError, ENT_QUOTES, 'UTF-8'); ?></p>
                <?php endif; ?>
                <label>
                    <span>Benutzername</span>
                    <input type="text" name="username" autocomplete="username" required autofocus />
                </label>
                <label>
                    <span>Passwort</span>
                    <input type="password" name="password" autocomplete="current-password" required />
                </label>
                <button type="submit">Anmelden</button>
            </form>
        </main>
    <?php else : ?>
        <main class="backup-shell">
            <header class="edit-shell__bar">
                <div>
                    <strong>Datenbank-Backup</strong>
                    <span><?php echo htmlspecialchars((string) $currentUser['username'], ENT_QUOTES, 'UTF-8'); ?> | <?php echo htmlspecialchars((string) $currentUser['role'], ENT_QUOTES, 'UTF-8'); ?></span>
                </div>
                <div class="edit-shell__actions">
                    <a class="edit-shell__toplink" href="/edit/">&larr; Zurück zum Editor</a>
                    <form method="post" action="./backup.php">
                        <input type="hidden" name="action" value="logout" />
                        <button type="submit">Abmelden</button>
                    </form>
                </div>
            </header>

            <section class="backup-panel" aria-labelledby="backup-title">
                <h1 id="backup-title">Datenbank-Backup</h1>
                <p class="backup-lead">
                    Zieht einen vollständigen Abzug der Datenbank &ndash; Schema <em>und</em> Daten &ndash;
                    als gepackte SQL-Datei (<code>.sql.gz</code>). Die Datei lässt sich unverändert
                    wieder einspielen, per <code>mysql</code> oder über den Import von phpMyAdmin.
                </p>
                <p class="backup-hint">
                    Der Abzug läuft in kleinen Schritten, damit er die PHP-Grenzen des Webhostings
                    nicht reißt: bitte diesen Tab offen lassen, bis der Fortschritt 100&nbsp;% erreicht.
                    Zum Schluss prüft der Lauf die Datei selbst gegen und lädt sie dann herunter.
                </p>

                <div class="backup-actions">
                    <button type="button" class="backup-start" id="backup-start">Backup erstellen</button>
                    <button type="button" class="backup-button" id="backup-cancel" hidden>Abbrechen</button>
                    <label class="backup-option">
                        <input type="checkbox" id="backup-skip-transient" />
                        <span>WikiSync-Zwischenspeicher überspringen (kleinere Datei)</span>
                    </label>
                </div>
                <p class="backup-hint">
                    Ohne Haken ist wirklich alles drin. Mit Haken bleiben die aus dem Wiki-Dump
                    wiederherstellbaren Zwischentabellen leer &ndash; ihre Struktur ist trotzdem
                    enthalten, das Backup bleibt also vollständig einspielbar.
                </p>

                <div class="backup-progress" id="backup-progress" hidden>
                    <div class="backup-progress__track">
                        <div class="backup-progress__bar" id="backup-bar"></div>
                    </div>
                    <p class="backup-progress__label" id="backup-progress-label" role="status" aria-live="polite"></p>
                </div>

                <p class="backup-message" id="backup-message" hidden role="status"></p>

                <div class="backup-section">
                    <h2>Vorhandene Backups</h2>
                    <ul class="backup-list" id="backup-list"></ul>
                    <p class="backup-empty" id="backup-empty" hidden>Noch kein Backup vorhanden.</p>
                    <p class="backup-hint">
                        Es werden die drei jüngsten Backups behalten; ältere räumt der nächste Lauf weg.
                    </p>
                </div>

                <div class="backup-section backup-restore">
                    <h2>Wieder einspielen</h2>
                    <ol>
                        <li>
                            Auf der Kommandozeile (Git Bash, WSL, Linux, macOS) direkt aus der
                            gepackten Datei:
                            <code>gunzip -c avesmaps-&lt;db&gt;-&lt;datum&gt;.sql.gz | mysql -u &lt;benutzer&gt; -p &lt;datenbank&gt;</code>
                        </li>
                        <li>
                            Oder in phpMyAdmin: Zieldatenbank auswählen &rarr; <em>Importieren</em> &rarr;
                            die <code>.sql.gz</code> hochladen. Bei großen Dateien greift das
                            Upload-Limit &ndash; dann ist der Weg über <code>mysql</code> der richtige.
                        </li>
                        <li>
                            Die Datei legt jede enthaltene Tabelle neu an
                            (<code>DROP TABLE IF EXISTS</code> + <code>CREATE TABLE</code>) und enthält
                            bewusst kein <code>CREATE DATABASE</code>: sie landet in der Datenbank, die
                            beim Einspielen ausgewählt ist. Eine leere Datenbank ist also ein
                            gültiges Ziel.
                        </li>
                    </ol>
                    <p class="backup-hint">
                        Die Datei ist ein gewöhnliches gzip-Archiv mit genau einem Strom &ndash; jedes
                        Werkzeug (gzip, zcat, 7-Zip, PowerShell, phpMyAdmin) packt sie vollständig aus.
                        Sie enthält Passwort-Hashes und alle Meldungen: bitte wie ein Geheimnis behandeln
                        und nie ins Repository legen.
                    </p>
                </div>
            </section>
        </main>

        <script>
            (function () {
                'use strict';

                var ENDPOINT = '../api/edit/admin/database-backup.php';
                // How often a single step may fail on the network before the loop gives up.
                // A step is resumable server-side, so retrying is always safe.
                var MAX_STEP_RETRIES = 3;
                var RETRY_DELAY_MS = 1500;

                var startButton = document.getElementById('backup-start');
                var cancelButton = document.getElementById('backup-cancel');
                var skipTransient = document.getElementById('backup-skip-transient');
                var progressBox = document.getElementById('backup-progress');
                var progressBar = document.getElementById('backup-bar');
                var progressLabel = document.getElementById('backup-progress-label');
                var messageBox = document.getElementById('backup-message');
                var listBox = document.getElementById('backup-list');
                var emptyBox = document.getElementById('backup-empty');

                var activeRunId = '';
                var looping = false;

                var PHASE_LABELS = {
                    header: 'Vorbereiten',
                    tables: 'Tabellen sichern',
                    views: 'Views sichern',
                    triggers: 'Trigger sichern',
                    routines: 'Prozeduren sichern',
                    trailer: 'Abschließen',
                    verify: 'Datei gegenlesen',
                    done: 'Fertig'
                };

                function formatBytes(bytes) {
                    var value = Number(bytes) || 0;
                    var units = ['B', 'KB', 'MB', 'GB'];
                    var unit = 0;
                    while (value >= 1024 && unit < units.length - 1) {
                        value /= 1024;
                        unit += 1;
                    }
                    return (unit === 0 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[unit];
                }

                function formatNumber(value) {
                    return (Number(value) || 0).toLocaleString('de-DE');
                }

                function showMessage(text, kind) {
                    messageBox.textContent = text;
                    messageBox.className = 'backup-message'
                        + (kind ? ' backup-message--' + kind : '');
                    messageBox.hidden = !text;
                }

                function clearMessage() {
                    showMessage('', '');
                }

                function request(options) {
                    var url = ENDPOINT + (options.query || '');
                    var init = { credentials: 'same-origin', headers: { Accept: 'application/json' } };

                    if (options.body) {
                        init.method = 'POST';
                        init.headers['Content-Type'] = 'application/json';
                        init.body = JSON.stringify(options.body);
                    }

                    return fetch(url, init).then(function (response) {
                        return response.json().catch(function () {
                            throw new Error('Die Antwort des Servers war unlesbar (HTTP ' + response.status + ').');
                        }).then(function (payload) {
                            if (!response.ok || !payload || payload.ok !== true) {
                                var message = payload && payload.error && payload.error.message
                                    ? payload.error.message
                                    : 'Die Anfrage ist fehlgeschlagen (HTTP ' + response.status + ').';
                                var error = new Error(message);
                                error.code = payload && payload.error ? payload.error.code : '';
                                throw error;
                            }
                            return payload;
                        });
                    });
                }

                function renderProgress(progress) {
                    if (!progress) {
                        return;
                    }

                    progressBox.hidden = false;
                    progressBar.style.width = (Number(progress.percent) || 0) + '%';

                    var phase = PHASE_LABELS[progress.phase] || progress.phase || '';
                    var parts = [phase];
                    if (progress.phase === 'tables') {
                        var current = Math.min(
                            (Number(progress.tables_done) || 0) + 1,
                            Number(progress.tables_total) || 1
                        );
                        parts.push('Tabelle ' + formatNumber(current)
                            + '/' + formatNumber(progress.tables_total)
                            + (progress.object ? ' (' + progress.object + ')' : ''));
                        parts.push(formatNumber(progress.rows_written) + ' Zeilen');
                    }
                    if (progress.gz_bytes) {
                        parts.push(formatBytes(progress.gz_bytes) + ' gepackt');
                    }

                    progressLabel.textContent = (Number(progress.percent) || 0) + '% – '
                        + parts.filter(Boolean).join(' – ');
                }

                function setBusy(busy) {
                    startButton.disabled = busy;
                    cancelButton.hidden = !busy;
                    skipTransient.disabled = busy;
                }

                function downloadRun(runId) {
                    // A programmatic link click keeps this page (and its step loop state)
                    // in place; the response is an attachment, so nothing navigates.
                    var link = document.createElement('a');
                    link.href = ENDPOINT + '?action=download&run_id=' + encodeURIComponent(runId);
                    link.rel = 'noopener';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }

                function describeRun(run) {
                    var status = {
                        completed: 'fertig',
                        running: 'läuft',
                        failed: 'fehlgeschlagen',
                        canceled: 'abgebrochen',
                        pruned: 'aufgeräumt'
                    }[run.status] || run.status;

                    var meta = [status, run.created_at];
                    if (run.gz_bytes) {
                        meta.push(formatBytes(run.gz_bytes) + ' gepackt');
                    }
                    if (run.rows_written) {
                        meta.push(formatNumber(run.rows_written) + ' Zeilen aus '
                            + formatNumber(run.tables_done) + ' Tabellen');
                    }
                    if (!run.include_transient) {
                        meta.push('ohne Zwischenspeicher');
                    }
                    if (run.created_by) {
                        meta.push('von ' + run.created_by);
                    }
                    if (run.error) {
                        meta.push(run.error);
                    }
                    return meta.filter(Boolean).join(' · ');
                }

                function renderList(runs) {
                    listBox.textContent = '';
                    var visible = (runs || []).filter(function (run) {
                        return run.status !== 'pruned';
                    });

                    emptyBox.hidden = visible.length > 0;

                    visible.forEach(function (run) {
                        var row = document.createElement('li');
                        row.className = 'backup-list__row';

                        var info = document.createElement('div');
                        var name = document.createElement('p');
                        name.className = 'backup-list__name';
                        name.textContent = run.file_name || '(ohne Datei)';
                        var meta = document.createElement('p');
                        meta.className = 'backup-list__meta';
                        meta.textContent = describeRun(run);
                        info.appendChild(name);
                        info.appendChild(meta);

                        if (run.warnings && run.warnings.length) {
                            var warnings = document.createElement('ul');
                            warnings.className = 'backup-warnings';
                            run.warnings.forEach(function (warning) {
                                var item = document.createElement('li');
                                item.textContent = warning;
                                warnings.appendChild(item);
                            });
                            info.appendChild(warnings);
                        }
                        row.appendChild(info);

                        var download = document.createElement('button');
                        download.type = 'button';
                        download.className = 'backup-button';
                        download.textContent = 'Herunterladen';
                        download.disabled = run.status !== 'completed' || !run.file_present;
                        download.addEventListener('click', function () {
                            downloadRun(run.id);
                        });
                        row.appendChild(download);

                        var remove = document.createElement('button');
                        remove.type = 'button';
                        remove.className = 'backup-button backup-button--danger';
                        remove.textContent = 'Löschen';
                        remove.addEventListener('click', function () {
                            if (!window.confirm('Dieses Backup endgültig löschen?')) {
                                return;
                            }
                            request({ body: { action: 'delete', run_id: run.id } })
                                .then(function (payload) {
                                    renderList(payload.runs);
                                })
                                .catch(function (error) {
                                    showMessage(error.message, 'error');
                                });
                        });
                        row.appendChild(remove);

                        listBox.appendChild(row);
                    });
                }

                function refreshStatus() {
                    return request({ query: '?action=status' }).then(function (payload) {
                        renderList(payload.runs);
                        return payload;
                    });
                }

                function finish(run) {
                    looping = false;
                    activeRunId = '';
                    setBusy(false);

                    if (run && run.status === 'completed') {
                        renderProgress({ percent: 100, phase: 'done', gz_bytes: run.gz_bytes });
                        var note = 'Backup fertig: ' + run.file_name
                            + ' (' + formatBytes(run.gz_bytes) + ', '
                            + formatNumber(run.rows_written) + ' Zeilen aus '
                            + formatNumber(run.tables_done) + ' Tabellen). Der Download startet.';
                        showMessage(note, (run.warnings && run.warnings.length) ? 'warning' : '');
                        downloadRun(run.id);
                    } else if (run) {
                        showMessage('Backup ' + (run.status === 'canceled' ? 'abgebrochen' : 'fehlgeschlagen')
                            + (run.error ? ': ' + run.error : '.'), 'error');
                    }

                    refreshStatus().catch(function () { /* the list is cosmetic here */ });
                }

                function runStep(runId, retriesLeft) {
                    if (!looping || runId !== activeRunId) {
                        return;
                    }

                    request({ body: { action: 'step', run_id: runId } })
                        .then(function (payload) {
                            renderProgress(payload.progress);
                            if (payload.done) {
                                finish(payload.run);
                                return;
                            }
                            // Yield to the event loop so the bar paints and Abbrechen stays
                            // clickable between steps.
                            window.setTimeout(function () {
                                runStep(runId, MAX_STEP_RETRIES);
                            }, 0);
                        })
                        .catch(function (error) {
                            // A step is resumable server-side, so a lost response is worth
                            // retrying; a reported failure is not.
                            if (retriesLeft > 0 && !error.code) {
                                showMessage('Verbindungsproblem – neuer Versuch …', 'warning');
                                window.setTimeout(function () {
                                    runStep(runId, retriesLeft - 1);
                                }, RETRY_DELAY_MS);
                                return;
                            }

                            looping = false;
                            activeRunId = '';
                            setBusy(false);
                            showMessage(error.message, 'error');
                            refreshStatus().catch(function () { /* cosmetic */ });
                        });
                }

                function startLoop(runId, progress) {
                    activeRunId = runId;
                    looping = true;
                    setBusy(true);
                    renderProgress(progress);
                    runStep(runId, MAX_STEP_RETRIES);
                }

                startButton.addEventListener('click', function () {
                    clearMessage();
                    setBusy(true);

                    request({
                        body: {
                            action: 'start',
                            include_transient: !skipTransient.checked
                        }
                    })
                        .then(function (payload) {
                            startLoop(payload.run.id, payload.progress);
                        })
                        .catch(function (error) {
                            setBusy(false);
                            showMessage(error.message, 'error');
                        });
                });

                cancelButton.addEventListener('click', function () {
                    if (!activeRunId) {
                        return;
                    }
                    var runId = activeRunId;
                    looping = false;
                    activeRunId = '';

                    request({ body: { action: 'cancel', run_id: runId } })
                        .then(function (payload) {
                            setBusy(false);
                            progressBox.hidden = true;
                            showMessage('Backup abgebrochen.', 'warning');
                            renderList(payload.runs);
                        })
                        .catch(function (error) {
                            setBusy(false);
                            showMessage(error.message, 'error');
                        });
                });

                // On load: show what exists, and reattach to a backup that is still running
                // (a reloaded tab would otherwise abandon it until its heartbeat goes stale).
                refreshStatus()
                    .then(function (payload) {
                        if (payload.live && payload.live.id) {
                            showMessage('Ein Backup läuft bereits – der Fortschritt wird weiter verfolgt.', 'warning');
                            startLoop(payload.live.id, {
                                percent: 0,
                                phase: payload.live.phase,
                                tables_done: payload.live.tables_done,
                                tables_total: payload.live.tables_total,
                                rows_written: payload.live.rows_written,
                                rows_total: payload.live.rows_total,
                                gz_bytes: payload.live.gz_bytes
                            });
                        }
                    })
                    .catch(function (error) {
                        showMessage(error.message, 'error');
                    });
            }());
        </script>
    <?php endif; ?>
</body>

</html>
