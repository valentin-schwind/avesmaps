(function () {
	"use strict";

	// Der Reiter „Social Media" unter Community: die Liste der Beiträge und das Hub-Fenster
	// (Entwurf §2).
	//
	// 💣 DER STATUS GEHÖRT DEM KANAL, NICHT DEM BEITRAG. Ein Beitrag geht an mehrere Netze, und jedes
	// kann für sich scheitern. Deshalb trägt jede Marke ihren eigenen Zustand und ihren eigenen
	// „Erneut"-Knopf, der genau diesen einen Kanal wiederholt. Ein gemeinsames „gesendet" würde den
	// Fall verschlucken, dass eines abgelehnt hat -- und niemand merkte es, bis jemand fragt.
	//
	// ⚠️ Gebaut wird ausschließlich mit createElement, nie mit innerHTML. Der Text stammt von
	// Menschen und geht später öffentlich raus; ein einziges Feld ohne Escaping wäre hier nicht nur
	// ein XSS, sondern einer im Namen des Projekts.

	const LIST_API = "/api/edit/social/list.php";
	const RETRY_API = "/api/edit/social/retry.php";

	// ---- reine Entscheidungen (unter Test in __tests__/social-list.test.js) -----------------------

	// 🔴 Unbekannt fällt auf „wartet", NIE auf „gesendet". Ein Zustand, den eine spätere Stufe
	// hinzufügt und dieser Client noch nicht kennt, würde sonst grün erscheinen -- und Grün heißt
	// „es steht draußen".
	function chipClass(status) {
		if (status === "sent") { return "social-chip social-chip--ok"; }
		if (status === "failed") { return "social-chip social-chip--err"; }
		return "social-chip social-chip--wait";
	}

	function chipLabel(target) {
		const label = (target && target.label) || "";
		if (target && target.status === "sent") { return label + " ✓"; }
		if (target && target.status === "failed") { return label + " — Fehler"; }
		if (target && target.status === "scheduled") { return label + " — geplant"; }
		return label + " — wartet";
	}

	// Nur ein gescheiterter Kanal darf wiederholt werden. Ein bereits gesendeter waere auf Instagram
	// ein Doppelbeitrag, und der laesst sich dort nicht aendern, nur loeschen.
	function canRetry(target) {
		return !!target && target.status === "failed";
	}

	// Spiegelt avesmapsSocialStrictestLimit. ⚠️ Der Server prueft dasselbe noch einmal in
	// avesmapsSocialCheckTarget -- diese Haelfte ist die Bequemlichkeit, nicht der Riegel.
	function strictestLimit(channels, selectedKeys) {
		let best = { key: null, label: "", max_chars: null };
		(channels || []).forEach(function (channel) {
			if (selectedKeys.indexOf(channel.key) === -1) { return; }
			if (channel.max_chars === null || channel.max_chars === undefined) { return; }
			if (best.max_chars === null || channel.max_chars < best.max_chars) {
				best = { key: channel.key, label: channel.label, max_chars: channel.max_chars };
			}
		});
		return best;
	}

	// 💣 Die Zeile, an der das ganze Hashtag-Konzept haengt: die Tags stehen GETRENNT, weil vier von
	// ihnen schnell 60 Zeichen sind -- bei Mastodons 500 ueber ein Zehntel. „168 + 0" liest sich
	// dagegen wie ein Fehler, also faellt die Haelfte weg, wenn es keine Tags gibt.
	function formatCount(textChars, hashtagChars, limit) {
		const total = textChars + hashtagChars;
		const left = hashtagChars > 0
			? textChars + " + " + hashtagChars + " Hashtags = " + total
			: String(total);
		if (!limit || limit.max_chars === null || limit.max_chars === undefined) {
			return left + " Zeichen";
		}
		return left + " / " + limit.max_chars + " (" + limit.label + ")";
	}

	// 🔴 Ein Beitrag, dessen Verfasser verloren ging, darf nie so lesen, als haette die Automatik ihn
	// geschrieben. Der Unterschied zwischen „ein Mensch hat das entschieden" und „eine Routine hat es
	// vorgeschlagen" ist der Sinn des Kennzeichens.
	function postAuthorLabel(post) {
		if (post && post.origin === "routine") { return "Automatisch"; }
		const author = (post && post.author) || "";
		return author !== "" ? author : "Unbekannt";
	}

	// ---- alles ab hier braucht ein Dokument -------------------------------------------------------

	const hasDocument = typeof document !== "undefined";

	let channels = [];
	let vocabulary = [];
	let sendingEnabled = true;
	let loaded = false;

	function statusEl() { return document.getElementById("social-status"); }
	function listEl() { return document.getElementById("social-post-list"); }

	function api(url, options) {
		return fetch(url, Object.assign({ credentials: "same-origin" }, options || {}))
			.then(function (response) { return response.json(); })
			.catch(function () { return null; });
	}

	// MySQL liefert „2026-08-10 18:04:12.123", was nicht jeder Browser als Datum erkennt. Das T
	// macht daraus etwas Parsbares; scheitert es trotzdem, steht der Rohwert da statt „Invalid Date".
	function formatDate(value) {
		const raw = String(value || "");
		const parsed = new Date(raw.replace(" ", "T"));
		return isNaN(parsed.getTime()) ? raw : parsed.toLocaleString("de-DE");
	}

	function makeChip(target) {
		const chip = document.createElement("span");
		chip.className = chipClass(target.status);
		chip.textContent = chipLabel(target);
		if (target.error) { chip.title = target.error; }
		return chip;
	}

	function retryChannel(postId, channelKey, button) {
		button.disabled = true;
		button.textContent = "…";
		api(RETRY_API, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id: postId, channel: channelKey }),
		}).then(function () {
			// Immer neu laden, auch bei Misserfolg: der Server hat den Zustand des Ziels in jedem Fall
			// fortgeschrieben, und die Liste ist die Wahrheit -- nicht die Antwort auf diesen Klick.
			load(true);
		});
	}

	function renderTargets(post, container) {
		const chips = document.createElement("div");
		chips.className = "social-chips";
		(post.targets || []).forEach(function (target) {
			chips.appendChild(makeChip(target));
			if (canRetry(target)) {
				const button = document.createElement("button");
				button.type = "button";
				// Weich, nicht gefüllt: eine Zeilenhandlung ist nie die Haupthandlung der Seite
				// (AGENTS.md §12) -- und dieser Knopf steht potenziell in jeder Zeile.
				button.className = "social-hub__soft social-hub__soft--mini";
				button.textContent = "Erneut";
				button.title = target.error || "";
				button.addEventListener("click", function () {
					retryChannel(post.id, target.channel, button);
				});
				chips.appendChild(button);
			}
		});
		container.appendChild(chips);

		// Der Probe-Kanal legt ab, was er gesendet hätte. Das ist der eigentliche Nutzen der Probe --
		// und <details> ist nativ, damit Strg+F den Text auch im zugeklappten Kasten findet.
		(post.targets || []).forEach(function (target) {
			if (!target.sent_payload) { return; }
			const details = document.createElement("details");
			details.className = "social-post__payload";
			const summary = document.createElement("summary");
			summary.textContent = target.label + ": Was gesendet worden wäre";
			const pre = document.createElement("pre");
			let text = target.sent_payload;
			try {
				text = JSON.stringify(JSON.parse(target.sent_payload), null, 2);
			} catch (error) {
				// Kein JSON? Dann eben roh -- ein unlesbarer Kasten ist besser als gar keiner.
			}
			pre.textContent = text;
			details.append(summary, pre);
			container.appendChild(details);
		});
	}

	function renderProposalActions(post, container) {
		const row = document.createElement("div");
		row.className = "social-chips social-post__actions";

		const approve = document.createElement("button");
		approve.type = "button";
		approve.className = "review-panel__button social-hub__primary--mini";
		approve.textContent = "Freigeben und veröffentlichen";
		approve.addEventListener("click", function () {
			approve.disabled = true;
			decideProposal(post.id, "approve");
		});

		const edit = document.createElement("button");
		edit.type = "button";
		edit.className = "social-hub__soft social-hub__soft--mini";
		edit.textContent = "Bearbeiten";
		edit.addEventListener("click", function () { openHub(post); });

		const discard = document.createElement("button");
		discard.type = "button";
		discard.className = "social-hub__soft social-hub__soft--mini";
		discard.textContent = "Verwerfen";
		discard.addEventListener("click", function () {
			discard.disabled = true;
			decideProposal(post.id, "discard");
		});

		row.append(approve, edit, discard);
		container.appendChild(row);
	}

	function renderList(posts) {
		const target = listEl();
		if (!target) { return; }
		target.textContent = "";

		if (!posts || !posts.length) {
			target.textContent = "Noch nichts veröffentlicht.";
			return;
		}

		posts.forEach(function (post) {
			const item = document.createElement("div");
			item.className = "social-post"
				+ (post.state === "proposal" ? " social-post--proposal" : "");

			const top = document.createElement("div");
			top.className = "social-post__top";
			const who = document.createElement("span");
			who.className = "social-post__who"
				+ (post.origin === "routine" ? " social-post__who--auto" : "");
			who.textContent = postAuthorLabel(post);
			const when = document.createElement("span");
			when.className = "social-post__date";
			when.textContent = formatDate(post.created_at);
			top.append(who, when);

			const text = document.createElement("p");
			text.className = "social-post__text";
			text.textContent = post.text || "";

			item.append(top, text);

			if (post.state === "proposal") {
				const note = document.createElement("p");
				note.className = "social-post__note";
				note.textContent = "Vorschlag der Routine — wartet auf Freigabe.";
				item.appendChild(note);
				renderProposalActions(post, item);
			}

			renderTargets(post, item);
			target.appendChild(item);
		});
	}

	function setStatus(message) {
		const element = statusEl();
		if (element) { element.textContent = message; }
	}

	function load(force) {
		if (loaded && !force) { return Promise.resolve(); }
		loaded = true;
		setStatus("Beiträge werden geladen …");
		return api(LIST_API).then(function (response) {
			if (!response || !response.ok) {
				setStatus("Die Liste konnte nicht geladen werden.");
				return;
			}
			channels = response.channels || [];
			vocabulary = response.vocabulary || [];
			sendingEnabled = response.enabled !== false;
			setStatus(sendingEnabled
				? ""
				: "Das Senden ist serverseitig abgeschaltet — Beiträge werden angelegt, aber nicht verschickt.");
			renderList(response.posts || []);
		});
	}

	// ---- der Riegel ---------------------------------------------------------------------------------

	// 🔴 Fällt GESCHLOSSEN aus, wie bei der Landschaftsebene: bis die Antwort da ist -- und für immer,
	// wenn sie nie kommt -- bleibt der Reiter weg. Er schaltet ein Fenster frei, das öffentlich und
	// unwiderruflich sendet; ein zu früh gezeigter Knopf wäre schlimmer als ein spät gezeigter.
	function applyCapability() {
		const may = !!(typeof window !== "undefined"
			&& window.AvesmapsSession
			&& window.AvesmapsSession.current().capabilities.social);
		const tab = document.querySelector('[data-review-subtab="social"]');
		const section = document.querySelector('[data-review-subtab-section="social"]');
		if (tab) { tab.hidden = !may; }
		if (section && !may) { section.hidden = true; }
		return may;
	}

	function boot() {
		applyCapability();
		if (typeof window !== "undefined" && window.AvesmapsSession) {
			window.AvesmapsSession.load().then(function () {
				if (!applyCapability()) { return; }
				// Erst laden, wenn der Unterreiter wirklich angesehen wird: die Liste ist eine Abfrage
				// über zwei Tabellen und niemand braucht sie beim Öffnen des Editors.
				const tab = document.querySelector('[data-review-subtab="social"]');
				if (tab) { tab.addEventListener("click", function () { load(false); }); }
				if (tab && tab.classList.contains("is-active")) { load(false); }
			});
		}
	}

	if (hasDocument) {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", boot);
		} else {
			boot();
		}
	}

	// openHub und decideProposal kommen mit dem Hub-Fenster; bis dahin sind sie stille Platzhalter,
	// damit die Liste für sich lauffähig bleibt.
	function openHub() {}
	function decideProposal() {}

	if (typeof window !== "undefined") {
		window.AvesmapsSocial = {
			reload: function () { return load(true); },
			channels: function () { return channels; },
			vocabulary: function () { return vocabulary; },
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = { chipClass, chipLabel, canRetry, strictestLimit, formatCount, postAuthorLabel };
	}
})();
