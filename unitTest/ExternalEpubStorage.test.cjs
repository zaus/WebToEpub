"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createContext(settings) {
    let values = {...settings};
    let runtime = {lastError: null};
    let context = vm.createContext({
        URL, TextEncoder, Uint8Array, atob, btoa,
        chrome: {runtime, storage: {local: {
            get(key, callback) {
                callback(typeof key === "string" ? {[key]: values[key]} : Object.fromEntries(key.map(name => [name, values[name]])));
            },
            set(items, callback) { Object.assign(values, items); callback(); }
        }}}
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "plugin", "js", "ExternalEpubStorage.js"), "utf8"), context);
    return {context, runtime};
}

test("saves and loads EPUB data through the loopback companion", async () => {
    let {context} = createContext({ExternalEpubStorage: {url: "http://127.0.0.1:8765", token: "secret"}});
    let requests = [];
    context.fetch = async (url, options) => {
        requests.push({url, options});
        if (options.method === "PUT") {
            return {ok: true, json: async () => ({committed: true, revision: "abc"})};
        }
        return {ok: true, json: async () => ({epubBase64: "YQ=="})};
    };
    await vm.runInContext('new ExternalEpubStorage().set("7", "data:application/epub+zip;base64,YQ==", {LibFilename7: "Title"})', context);
    let loaded = await vm.runInContext('new ExternalEpubStorage().get("7")', context);
    assert.equal(loaded, "data:application/epub+zip;base64,YQ==");
    assert.equal(requests[0].url, "http://127.0.0.1:8765/v1/books/7");
    assert.equal(requests[0].options.method, "PUT");
    assert.equal(requests[0].options.headers.authorization, "Bearer secret");
    assert.deepEqual(Array.from(requests[0].options.body), [97]);
});

test("surfaces missing configuration and backend failures without browser fallback", async () => {
    let {context} = createContext({});
    await assert.rejects(vm.runInContext('new ExternalEpubStorage().get("7")', context), /not configured/);
    let configured = createContext({ExternalEpubStorage: {url: "https://example.test", token: "secret"}});
    await assert.rejects(vm.runInContext('new ExternalEpubStorage().get("7")', configured.context), /loopback/);
    let failed = createContext({ExternalEpubStorage: {url: "http://127.0.0.1:8765", token: "secret"}});
    failed.context.fetch = async () => ({ok: false, status: 503});
    await assert.rejects(vm.runInContext('new ExternalEpubStorage().get("7")', failed.context), /HTTP 503/);
});
