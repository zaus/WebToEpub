"use strict";

class BrowserEpubStorage { // eslint-disable-line no-unused-vars
    async get(id) {
        let key = "LibEpub" + id;
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(key, items => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(items[key]);
            });
        });
    }

    async set(id, epub, metadata = {}) {
        let key = "LibEpub" + id;
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({...metadata, [key]: epub}, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }
}
