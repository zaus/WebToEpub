"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createContext(values) {
    let runtime = {lastError: null};
    let context = vm.createContext({
        URL, TextEncoder, Uint8Array, atob, btoa,
        chrome: {runtime, storage: {local: {get(keys, callback) {
            let names = Array.isArray(keys) ? keys : [keys];
            callback(Object.fromEntries(names.map(key => [key, values[key]])));
        }}}}
    });
    for (let file of ["BrowserEpubStorage.js", "CompanionStagingClient.js"]) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "plugin", "js", file), "utf8"), context);
    }
    return {context, runtime};
}

function bookValues() {
    return {
        LibArray: [7], LibFilename7: "Café", LibStoryURL7: "https://example.test/story",
        LibEpub7: "data:application/epub+zip;base64,YQ=="
    };
}

test("lists browser books without reading EPUB payloads", async () => {
    let {context} = createContext(bookValues());
    let books = await vm.runInContext("CompanionStagingClient.listBooks()", context);
    assert.equal(books.length, 1);
    assert.equal(books[0].id, "7");
    assert.equal(books[0].title, "Café");
});

test("stages a copy using authenticated loopback with UTF-8 metadata", async () => {
    let values = bookValues();
    let {context} = createContext(values);
    let request;
    context.fetch = async (url, options) => {
        request = {url, options};
        return {ok: true, json: async () => ({
            id: "cb306512-b832-4dd1-9e04-2fd48bb2a8f3", committed: false, bytes: 1
        })};
    };
    let result = await vm.runInContext('CompanionStagingClient.stage("7", "8765", "secret")', context);
    assert.equal(result.committed, false);
    assert.equal(request.url, "http://127.0.0.1:8765/ingest");
    assert.equal(request.options.redirect, "error");
    assert.equal(request.options.credentials, "omit");
    assert.equal(request.options.headers.authorization, "Bearer secret");
    assert.equal(request.options.headers["content-type"], "application/epub+zip");
    assert.deepEqual(JSON.parse(Buffer.from(request.options.headers["x-wepub-meta"], "base64").toString("utf8")),
        {sourceUrl: "https://example.test/story", title: "Café", chapters: []});
    assert.deepEqual(Array.from(request.options.body), [97]);
    assert.equal(values.LibEpub7, "data:application/epub+zip;base64,YQ==");
});

test("rejects invalid input and browser storage failures before making a request", async () => {
    let values = bookValues();
    let {context, runtime} = createContext(values);
    let requests = 0;
    context.fetch = async () => { requests++; };
    for (let expression of [
        'CompanionStagingClient.stage("x", "8765", "secret")',
        'CompanionStagingClient.stage("7", "65536", "secret")',
        'CompanionStagingClient.stage("7", "80@evil", "secret")',
        'CompanionStagingClient.stage("7", "8765", "")'
    ]) {
        await assert.rejects(vm.runInContext(expression, context));
    }
    values.LibStoryURL7 = "file:///book";
    await assert.rejects(vm.runInContext('CompanionStagingClient.stage("7", "8765", "secret")', context), /HTTP/);
    values.LibStoryURL7 = "https://example.test/story";
    values.LibEpub7 = undefined;
    await assert.rejects(vm.runInContext('CompanionStagingClient.stage("7", "8765", "secret")', context), /no supported EPUB/);
    runtime.lastError = {message: "Storage unavailable"};
    await assert.rejects(vm.runInContext("CompanionStagingClient.listBooks()", context), /Storage unavailable/);
    await assert.rejects(vm.runInContext('CompanionStagingClient.stage("7", "8765", "secret")', context), /Storage unavailable/);
    assert.equal(requests, 0);
});

test("rejects backend errors, lost responses and invalid staging receipts", async () => {
    let {context} = createContext(bookValues());
    context.fetch = async () => ({ok: false, status: 401});
    await assert.rejects(vm.runInContext('CompanionStagingClient.stage("7", "8765", "secret")', context), /HTTP 401/);
    context.fetch = async () => { throw new Error("Connection failed"); };
    await assert.rejects(vm.runInContext('CompanionStagingClient.stage("7", "8765", "secret")', context), /Connection failed/);
    for (let receipt of [
        null,
        {committed: true, id: "cb306512-b832-4dd1-9e04-2fd48bb2a8f3", bytes: 1},
        {committed: false, id: "../bad", bytes: 1},
        {committed: false, id: "cb306512-b832-4dd1-9e04-2fd48bb2a8f3", bytes: 2}
    ]) {
        context.fetch = async () => ({ok: true, json: async () => receipt});
        await assert.rejects(vm.runInContext('CompanionStagingClient.stage("7", "8765", "secret")', context), /outcome is uncertain/);
    }
});
