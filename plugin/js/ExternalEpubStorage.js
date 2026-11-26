"use strict";

class ExternalEpubStorage { // eslint-disable-line no-unused-vars
    constructor() {
        this.settingsKey = "ExternalEpubStorage";
    }

    readSettings() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(this.settingsKey, items => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(items[this.settingsKey]);
            });
        });
    }

    writeMetadata(metadata) {
        if (!metadata || Object.keys(metadata).length === 0) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(metadata, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }

    async settings() {
        let settings = await this.readSettings();
        if (!settings || typeof settings.url !== "string" || typeof settings.token !== "string") {
            throw new Error("External EPUB storage is not configured.");
        }
        let url = new URL(settings.url);
        if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
            throw new Error("External EPUB storage must use a loopback HTTP companion.");
        }
        return {url: url.href.replace(/\/$/, ""), token: settings.token};
    }

    async get(id) {
        let settings = await this.settings();
        let response = await fetch(settings.url + "/v1/books/" + encodeURIComponent(id), {
            credentials: "omit",
            redirect: "error",
            headers: {authorization: "Bearer " + settings.token}
        });
        if (!response.ok) {
            throw new Error("External EPUB load failed (HTTP " + response.status + ").");
        }
        let result = await response.json();
        if (!result || typeof result.epubBase64 !== "string") {
            throw new Error("External EPUB load returned an invalid result.");
        }
        return "data:application/epub+zip;base64," + result.epubBase64;
    }

    async set(id, epub, metadata = {}) {
        let settings = await this.settings();
        let match = /^data:application\/epub\+zip;base64,(.*)$/.exec(epub);
        if (!match) {
            throw new Error("External EPUB storage requires a base64 EPUB data URL.");
        }
        let bytes = Uint8Array.from(atob(match[1]), character => character.charCodeAt(0));
        let meta = JSON.stringify({
            title: metadata.LibFilename || "Untitled",
            author: metadata.LibAuthor || "Unknown Author"
        });
        let encodedMeta = btoa(Array.from(new TextEncoder().encode(meta), byte => String.fromCharCode(byte)).join(""));
        let response = await fetch(settings.url + "/v1/books/" + encodeURIComponent(id), {
            method: "PUT",
            credentials: "omit",
            redirect: "error",
            headers: {
                authorization: "Bearer " + settings.token,
                "content-type": "application/epub+zip",
                "x-wepub-meta": encodedMeta
            },
            body: bytes
        });
        if (!response.ok) {
            throw new Error("External EPUB save failed (HTTP " + response.status + ").");
        }
        await response.json();
        await this.writeMetadata(metadata);
    }

    async remove(id) {
        let settings = await this.settings();
        let response = await fetch(settings.url + "/v1/books/" + encodeURIComponent(id), {
            method: "DELETE",
            credentials: "omit",
            redirect: "error",
            headers: {authorization: "Bearer " + settings.token}
        });
        if (!response.ok) {
            throw new Error("External EPUB delete failed (HTTP " + response.status + ").");
        }
        return response.json();
    }
}
