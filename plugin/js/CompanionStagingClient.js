"use strict";

class CompanionStagingClient { // eslint-disable-line no-unused-vars
    static async readStorage(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(keys, items => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(items);
            });
        });
    }

    static async listBooks() {
        let {LibArray} = await CompanionStagingClient.readStorage("LibArray");
        if (LibArray == null) {
            throw new Error("No library index was found. Open the library first, then retry.");
        }
        let keys = LibArray.map(id => "LibFilename" + id);
        let items = await CompanionStagingClient.readStorage(keys);
        return LibArray.map(id => ({id: String(id), title: items["LibFilename" + id] || "Book " + id}));
    }

    static async stage(id, port, token) {
        if (!/^\d+$/.test(id)) {
            throw new Error("Select a library book.");
        }
        if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
            throw new Error("Enter a valid companion port.");
        }
        if (!token || /[\r\n]/.test(token)) {
            throw new Error("Enter the companion token.");
        }
        let keys = ["LibStoryURL" + id, "LibFilename" + id];
        let items = await CompanionStagingClient.readStorage(keys);
        let sourceUrl = items[keys[0]];
        let title = items[keys[1]];
        let source;
        try {
            source = new URL(sourceUrl);
        } catch {
            throw new Error("The selected book needs a valid source URL before staging.");
        }
        if (!["http:", "https:"].includes(source.protocol) || typeof title !== "string" || !title) {
            throw new Error("The selected book needs an HTTP(S) source URL and a title before staging.");
        }
        let epub = await new BrowserEpubStorage().get(id);
        if (typeof epub !== "string" || !epub.startsWith("data:application/epub+zip;base64,")) {
            throw new Error("The selected book has no supported EPUB in browser storage.");
        }
        let raw = atob(epub.slice("data:application/epub+zip;base64,".length));
        let bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
        let meta = JSON.stringify({sourceUrl, title, chapters: []});
        let encodedMeta = btoa(Array.from(new TextEncoder().encode(meta), byte => String.fromCharCode(byte)).join(""));
        let response = await fetch("http://127.0.0.1:" + Number(port) + "/ingest", {
            method: "POST",
            credentials: "omit",
            redirect: "error",
            headers: {
                "authorization": "Bearer " + token,
                "content-type": "application/epub+zip",
                "x-wepub-meta": encodedMeta
            },
            body: bytes
        });
        if (!response.ok) {
            throw new Error("Companion rejected the staging request (HTTP " + response.status + ").");
        }
        let result = await response.json();
        if (result == null || result.committed !== false || typeof result.id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.id) ||
            result.bytes !== bytes.length) {
            throw new Error("Companion returned an invalid staging receipt; the outcome is uncertain.");
        }
        return result;
    }
}
