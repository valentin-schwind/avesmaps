const { Worker: NodeWorker } = require("node:worker_threads");

// Führt den Browser-Worker unverändert in einem echten zweiten Thread aus.
module.exports = function workerUmgebung() {
	const blobs = new Map();
	let serial = 0;
	class Blob {
		constructor(parts) { this.source = parts.join(""); }
	}
	class Worker {
		constructor(url) {
			this.worker = new NodeWorker(`
				const { parentPort } = require("node:worker_threads");
				const vm = require("node:vm");
				const fs = require("node:fs");
				global.self = global;
				global.importScripts = (path) => vm.runInThisContext(fs.readFileSync(path, "utf8"));
				global.postMessage = (data, transfer) => parentPort.postMessage(data, transfer);
				${blobs.get(url)}
				parentPort.on("message", (data) => self.onmessage({ data }));
			`, { eval: true });
			this.worker.on("message", (data) => this.onmessage?.({ data }));
			this.worker.on("error", (error) => this.onerror?.(error));
		}
		postMessage(data) { this.worker.postMessage(data); }
		terminate() { void this.worker.terminate(); }
	}
	return {
		Blob, Worker, AbortController, setTimeout, clearTimeout,
		URL: {
			createObjectURL(blob) { const url = String(++serial); blobs.set(url, blob.source); return url; },
			revokeObjectURL(url) { blobs.delete(url); },
		},
	};
};
