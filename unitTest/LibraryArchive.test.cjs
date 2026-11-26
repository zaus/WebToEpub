"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const zip = require("@zip.js/zip.js");

function libraryContext(values) {
    let restoredReadingList;
    let archive;
    let context = vm.createContext({
        zip,
        chrome: {runtime: {lastError: null}, storage: {local: {
            get(keys, callback) {
                if (keys == null) {
                    callback({...values});
                } else {
                    let names = Array.isArray(keys) ? keys : [keys];
                    callback(Object.fromEntries(names.map(key => [key, values[key]])));
                }
            },
            set(items, callback) { Object.assign(values, items); callback(); }
        }}},
        ReadingList: class {
            readFromLocalStorage() {}
            toJson() {
                return JSON.stringify({epubs: [
                    {toc: "https://example.test/one", lastUrl: "chapter"},
                    {toc: "https://example.test/other", lastUrl: "other"}
                ]});
            }
        },
        ProgressBar: {setMax() {}, setValue() {}},
        Download: {save: async blob => { archive = blob; }}
    });
    for (let file of ["BrowserEpubStorage.js", "Library.js"]) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "plugin", "js", file), "utf8"), context);
    }
    context.restore = value => { restoredReadingList = value; };
    vm.runInContext(`
        Library.LibShowLoadingText = () => {};
        Library.LibRenderSavedEpubs = async () => {};
        Library.userPreferences = {loadReadingListFromJson: restore};
    `, context);
    return {context, getArchive: () => archive, getReadingList: () => restoredReadingList};
}

test("real ZIP library export imports EPUB and metadata into a fresh browser library", async () => {
    let values = {
        LibArray: [7],
        LibEpub7: "data:application/epub+zip;base64,YQ==",
        LibStoryURL7: "https://example.test/one",
        LibFilename7: "Test title",
        LibCover7: "data:image/png;base64,Yg==",
        LibNewChapterCount7: 3
    };
    let source = libraryContext(values);
    await vm.runInContext("Library.Libexportall()", source.context);
    let archive = source.getArchive();
    assert.ok(archive instanceof Blob);
    let reader = new zip.ZipReader(new zip.BlobReader(archive), {useWebWorkers: false});
    let entries = await reader.getEntries();
    let count = entries.find(entry => entry.filename === "LibraryCountEntries.txt");
    assert.equal(await count.getData(new zip.TextWriter()), "1");
    await reader.close();

    let restored = {LibArray: []};
    let destination = libraryContext(restored);
    destination.context.archive = archive;
    await vm.runInContext("Library.LibFileReaderloadImport(archive)", destination.context);
    assert.deepEqual(Array.from(restored.LibArray), [0]);
    assert.equal(restored.LibEpub0, values.LibEpub7);
    assert.equal(restored.LibStoryURL0, values.LibStoryURL7);
    assert.equal(restored.LibFilename0, values.LibFilename7);
    assert.equal(restored.LibCover0, values.LibCover7);
    assert.equal(restored.LibNewChapterCount0, "3");
    assert.deepEqual(JSON.parse(JSON.stringify(destination.getReadingList())), {
        ReadingList: {epubs: [{toc: "https://example.test/one", lastUrl: "chapter"}]}
    });
});

test("real ZIP export imports an empty library with an empty reading list", async () => {
    let source = libraryContext({LibArray: []});
    await vm.runInContext("Library.Libexportall()", source.context);
    let restored = {LibArray: []};
    let destination = libraryContext(restored);
    destination.context.archive = source.getArchive();
    await vm.runInContext("Library.LibFileReaderloadImport(archive)", destination.context);
    assert.deepEqual(restored.LibArray, []);
    assert.deepEqual(JSON.parse(JSON.stringify(destination.getReadingList())), {ReadingList: {epubs: []}});
});

test("real ZIP export does not request a download for a missing EPUB", async () => {
    let source = libraryContext({LibArray: [7]});
    await assert.rejects(vm.runInContext("Library.Libexportall()", source.context), /EPUB not found.*7/);
    assert.equal(source.getArchive(), undefined);
});
