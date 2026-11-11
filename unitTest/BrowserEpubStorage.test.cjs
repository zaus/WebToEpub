"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createLibraryContext(values = {}) {
    let runtime = {lastError: null};
    let calls = [];
    let storage = {
        get(key, callback) {
            calls.push(key);
            callback({[key]: values[key]});
        }
    };
    let context = vm.createContext({
        chrome: {runtime, storage: {local: storage}},
        FileReader: class {},
    });
    for (let file of ["BrowserEpubStorage.js", "Library.js"]) {
        let source = fs.readFileSync(path.join(__dirname, "..", "plugin", "js", file), "utf8");
        vm.runInContext(source, context, {filename: file});
    }
    return {context, calls, runtime};
}

test("reads existing EPUB data through the browser storage adapter", async () => {
    let {context, calls} = createLibraryContext({LibEpub7: "data:application/epub+zip;base64,YQ=="});
    let value = await vm.runInContext('Library.LibGetFromStorage("LibEpub7")', context);
    assert.equal(value, "data:application/epub+zip;base64,YQ==");
    assert.deepEqual(calls, ["LibEpub7"]);
});

test("preserves missing EPUB and metadata lookup behavior", async () => {
    let {context, calls} = createLibraryContext({LibFilename7: "Title"});
    assert.equal(await vm.runInContext('Library.LibGetFromStorage("LibEpub9")', context), undefined);
    assert.equal(await vm.runInContext('Library.LibGetFromStorage("LibFilename7")', context), "Title");
    assert.deepEqual(calls, ["LibEpub9", "LibFilename7"]);
});

test("propagates EPUB storage errors", async () => {
    let {context, runtime} = createLibraryContext();
    runtime.lastError = {message: "Storage unavailable"};
    await assert.rejects(vm.runInContext('Library.LibGetFromStorage("LibEpub7")', context), /Storage unavailable/);
});

test("routes EPUB reads through the configured adapter", async () => {
    let {context, calls} = createLibraryContext();
    vm.runInContext('Library.epubStorage = {get: async id => "adapter:" + id}', context);
    assert.equal(await vm.runInContext('Library.LibGetFromStorage("LibEpub42")', context), "adapter:42");
    assert.deepEqual(calls, []);
});

test("downloads the selected adapter's EPUB and retains download preferences", async () => {
    let {context} = createLibraryContext({LibFilename7: "Title"});
    let removed = [];
    let count = {innerHTML: "2"};
    let downloaded;
    context.chrome.storage.local.remove = keys => removed.push(...keys);
    context.document = {getElementById: () => count};
    context.UserPreferences = {readFromLocalStorage: () => ({
        overwriteExistingEpub: {value: true}, noDownloadPopup: {value: false}
    })};
    context.Download = {save: async (...args) => { downloaded = args; return "saved"; }};
    vm.runInContext('Library.epubStorage = {get: async id => "adapter:" + id}; Library.LibConvertDataUrlToBlob = async value => "blob:" + value', context);
    assert.equal(await vm.runInContext('Library.LibDownload({dataset: {libepubid: "7"}})', context), "saved");
    assert.deepEqual(downloaded, ["blob:adapter:7", "Title.epub", true, false]);
    assert.deepEqual(removed, ["LibNewChapterCount7"]);
    assert.equal(count.innerHTML, "");
});

test("download failures leave new-chapter state unchanged", async () => {
    let {context} = createLibraryContext({LibFilename7: "Title"});
    let removed = [];
    let count = {innerHTML: "2"};
    context.chrome.storage.local.remove = keys => removed.push(...keys);
    context.document = {getElementById: () => count};
    context.UserPreferences = {readFromLocalStorage: () => ({
        overwriteExistingEpub: {value: false}, noDownloadPopup: {value: false}
    })};
    context.Download = {save: async () => { throw new Error("Download failed"); }};
    vm.runInContext('Library.epubStorage = {get: async () => "data"}; Library.LibConvertDataUrlToBlob = async value => value', context);
    await assert.rejects(vm.runInContext('Library.LibDownload({dataset: {libepubid: "7"}})', context), /Download failed/);
    assert.deepEqual(removed, []);
    assert.equal(count.innerHTML, "2");
});

test("download reports missing EPUB and storage errors without clearing state", async () => {
    let {context} = createLibraryContext();
    vm.runInContext('Library.epubStorage = {get: async () => undefined}', context);
    await assert.rejects(vm.runInContext('Library.LibDownload({dataset: {libepubid: "7"}})', context), /EPUB not found/);
    vm.runInContext('Library.epubStorage = {get: async () => { throw new Error("Storage unavailable"); }}', context);
    await assert.rejects(vm.runInContext('Library.LibDownload({dataset: {libepubid: "7"}})', context), /Storage unavailable/);
});
