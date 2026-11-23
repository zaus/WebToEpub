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

test("writes EPUB data to browser storage and waits for completion", async () => {
    let {context} = createLibraryContext();
    let saved;
    let finish;
    context.chrome.storage.local.set = (value, callback) => {
        saved = value;
        finish = callback;
    };
    let completed = false;
    let write = vm.runInContext('Library.epubStorage.set("7", "data:application/epub+zip;base64,YQ==")', context);
    write.then(() => { completed = true; });
    await Promise.resolve();
    assert.equal(completed, false);
    assert.deepEqual(Object.entries(saved), [["LibEpub7", "data:application/epub+zip;base64,YQ=="]]);
    finish();
    await write;
    assert.equal(completed, true);
});

test("propagates browser EPUB write failures", async () => {
    let {context, runtime} = createLibraryContext();
    context.chrome.storage.local.set = (value, callback) => {
        runtime.lastError = {message: "Storage quota exceeded"};
        callback();
        runtime.lastError = null;
    };
    await assert.rejects(vm.runInContext('Library.epubStorage.set("7", "data")', context), /Storage quota exceeded/);
});

test("library ID creation waits for storage completion", async () => {
    let {context} = createLibraryContext({LibArray: [3]});
    let saved;
    let finish;
    context.chrome.storage.local.set = (value, callback) => {
        saved = value;
        finish = callback;
    };
    let completed = false;
    let write = vm.runInContext("Library.LibCreateStorageIDs(7)", context);
    write.then(() => { completed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    assert.deepEqual(Array.from(saved.LibArray), [3, 7]);
    finish();
    await write;
    assert.equal(completed, true);
});

test("library ID creation propagates storage write failures", async () => {
    let {context, runtime} = createLibraryContext({LibArray: []});
    context.chrome.storage.local.set = (value, callback) => {
        runtime.lastError = {message: "ID write failed"};
        callback();
        runtime.lastError = null;
    };
    await assert.rejects(vm.runInContext("Library.LibCreateStorageIDs(7)", context), /ID write failed/);
});

test("EPUB reads use separate readers for overlapping operations", async () => {
    let {context} = createLibraryContext();
    let readers = [];
    context.FileReader = class {
        constructor() { readers.push(this); }
        readAsDataURL(blob) { this.blob = blob; }
    };
    let first = vm.runInContext('Library.LibReadEpubAsDataURL("first")', context);
    let second = vm.runInContext('Library.LibReadEpubAsDataURL("second")', context);
    assert.equal(readers.length, 2);
    assert.equal(readers[0].blob, "first");
    assert.equal(readers[1].blob, "second");
    readers[1].result = "data:second";
    readers[1].onload();
    readers[0].result = "data:first";
    readers[0].onload();
    assert.equal(await first, "data:first");
    assert.equal(await second, "data:second");
});

test("EPUB read errors and aborts reject", async () => {
    let {context} = createLibraryContext();
    let readers = [];
    context.FileReader = class {
        constructor() { readers.push(this); }
        readAsDataURL() {}
    };
    let failed = vm.runInContext('Library.LibReadEpubAsDataURL("first")', context);
    readers[0].error = new Error("Read failed");
    readers[0].onerror();
    await assert.rejects(failed, /Read failed/);
    let aborted = vm.runInContext('Library.LibReadEpubAsDataURL("second")', context);
    readers[1].onabort();
    await assert.rejects(aborted, /aborted/);
});

test("overlapping library updates retain distinct EPUBs and IDs", async () => {
    let values = {LibArray: []};
    let {context} = createLibraryContext(values);
    let readers = [];
    context.FileReader = class {
        constructor() { readers.push(this); }
        readAsDataURL(blob) { this.blob = blob; }
    };
    context.chrome.storage.local.set = (items, callback) => {
        Object.assign(values, items);
        callback();
    };
    vm.runInContext('Library.LibShowLoadingText = () => {}; Library.LibSaveCoverImgInStorage = async () => {}; Library.LibRenderSavedEpubs = async () => {}', context);
    let first = vm.runInContext('Library.LibHandleUpdate(-1, "first", "url1", "title1", -1)', context);
    let second = vm.runInContext('Library.LibHandleUpdate(-1, "second", "url2", "title2", -1)', context);
    readers[1].result = "data:second";
    readers[1].onload();
    readers[0].result = "data:first";
    readers[0].onload();
    await Promise.all([first, second]);
    assert.deepEqual(Array.from(values.LibArray), [0, 1]);
    let books = [
        [values.LibStoryURL0, values.LibEpub0],
        [values.LibStoryURL1, values.LibEpub1]
    ].sort();
    assert.deepEqual(books, [["url1", "data:first"], ["url2", "data:second"]]);
});

test("failed library write does not advance metadata and later updates can retry", async () => {
    let values = {LibArray: [7], LibEpub7: "old", LibStoryURL7: "old-url", LibNewChapterCount7: 1};
    let {context, runtime} = createLibraryContext(values);
    context.FileReader = class {
        readAsDataURL(blob) { this.result = blob; this.onload(); }
    };
    let fail = true;
    context.chrome.storage.local.set = (items, callback) => {
        if (fail) {
            runtime.lastError = {message: "Storage failed"};
            callback();
            runtime.lastError = null;
        } else {
            Object.assign(values, items);
            callback();
        }
    };
    vm.runInContext('Library.LibShowLoadingText = () => {}; Library.LibSaveCoverImgInStorage = async () => {}; Library.LibRenderSavedEpubs = async () => {}', context);
    await assert.rejects(vm.runInContext('Library.LibHandleUpdate(-1, "new", "new-url", "title", 7, 2)', context), /Storage failed/);
    assert.equal(values.LibEpub7, "old");
    assert.equal(values.LibStoryURL7, "old-url");
    assert.equal(values.LibNewChapterCount7, 1);
    fail = false;
    await vm.runInContext('Library.LibHandleUpdate(-1, "new", "new-url", "title", 7, 2)', context);
    assert.equal(values.LibEpub7, "new");
    assert.equal(values.LibStoryURL7, "new-url");
    assert.equal(values.LibNewChapterCount7, 3);
});

test("library update waits for the browser storage callback", async () => {
    let values = {LibArray: []};
    let {context} = createLibraryContext(values);
    let finish;
    context.FileReader = class {
        readAsDataURL(blob) { this.result = blob; this.onload(); }
    };
    context.chrome.storage.local.set = (items, callback) => {
        finish = () => { Object.assign(values, items); callback(); };
    };
    vm.runInContext('Library.LibShowLoadingText = () => {}; Library.LibSaveCoverImgInStorage = async () => {}; Library.LibRenderSavedEpubs = async () => {}', context);
    let finished = false;
    let update = vm.runInContext('Library.LibHandleUpdate(-1, "epub", "url", "title", -1)', context);
    update.then(() => { finished = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    finish();
    await update;
    assert.equal(finished, true);
    assert.equal(values.LibEpub0, "epub");
});

test("post-save refresh errors identify that the EPUB was saved", async () => {
    let values = {LibArray: []};
    let {context} = createLibraryContext(values);
    context.FileReader = class {
        readAsDataURL(blob) { this.result = blob; this.onload(); }
    };
    context.chrome.storage.local.set = (items, callback) => { Object.assign(values, items); callback(); };
    vm.runInContext('Library.LibShowLoadingText = () => {}; Library.LibSaveCoverImgInStorage = async () => {}; Library.LibRenderSavedEpubs = async () => { throw new Error("Refresh failed"); }', context);
    await assert.rejects(vm.runInContext('Library.LibHandleUpdate(-1, "epub", "url", "title", -1)', context), /EPUB was saved.*Refresh failed/);
    assert.equal(values.LibEpub0, "epub");
});

test("manual EPUB upload normalizes Firefox MIME type and records source chapters", async () => {
    let values = {LibArray: []};
    let {context} = createLibraryContext(values);
    let recorded;
    context.FileReader = class {
        readAsDataURL(blob) { this.result = blob.content; this.onload(); }
    };
    context.chrome.storage.local.set = (items, callback) => { Object.assign(values, items); callback(); };
    context.recordChapter = (...args) => { recorded = args; };
    vm.runInContext(`
        Library.LibShowLoadingText = () => {};
        Library.LibSaveCoverImgInStorage = async () => {};
        Library.LibRenderSavedEpubs = async () => {};
        Library.LibGetSourceURL = async () => "source-url";
        Library.LibGetSourceChapterList = async () => ["chapter1", "chapter2"];
        Library.userPreferences = {readingList: {setEpub: (...args) => recordChapter(...args)}};
    `, context);
    await vm.runInContext('Library.LibHandleUpdate({files: [{name: "book.epub", content: "data:application/octet-stream;base64,YQ=="}]}, -1, "", "", -1)', context);
    assert.equal(values.LibEpub0, "data:application/epub+zip;base64,YQ==");
    assert.equal(values.LibFilename0, "book");
    assert.equal(values.LibStoryURL0, "source-url");
    assert.deepEqual(recorded, ["source-url", "chapter2"]);
});

test("updates preserve the chapter-count sentinel behavior", async () => {
    let values = {LibArray: [7], LibNewChapterCount7: "-1"};
    let {context} = createLibraryContext(values);
    context.FileReader = class {
        readAsDataURL(blob) { this.result = blob; this.onload(); }
    };
    context.chrome.storage.local.set = (items, callback) => { Object.assign(values, items); callback(); };
    vm.runInContext('Library.LibShowLoadingText = () => {}; Library.LibSaveCoverImgInStorage = async () => {}; Library.LibRenderSavedEpubs = async () => {}', context);
    await vm.runInContext('Library.LibHandleUpdate(-1, "epub", "url", "title", 7, 4)', context);
    assert.equal(values.LibNewChapterCount7, 0);
    assert.deepEqual(Array.from(values.LibArray), [7]);
});

test("acquisition does not advance reading list or download when saving fails", async () => {
    let {context} = createLibraryContext();
    let added = 0;
    let downloaded = 0;
    context.document = {getElementById: id => id === "startingUrlInput" ? {value: "url"} : {checked: true}};
    context.Download = {save: async () => { downloaded++; }};
    vm.runInContext(`
        Library.userPreferences = {readingList: {addEpub: () => { added(); }}};
        Library.LibShowLoadingText = () => {};
        Library.LibGetStorageIDs = async () => [];
        Library.LibGetFromStorageArray = async () => ({});
        Library.LibHandleUpdate = async () => { throw new Error("Write failed"); };
    `, context);
    context.added = () => { added++; };
    await assert.rejects(vm.runInContext('new Library().LibAddToLibrary("epub", "book.epub", "url", false, false)', context), /Write failed/);
    assert.equal(added, 0);
    assert.equal(downloaded, 0);
});

for (let format of ["legacy", "zip"]) {
    test(`${format} import waits for the book write before recording its ID`, async () => {
        let {context} = createLibraryContext();
        let finish;
        let ids = [];
        let loadedReadingList = false;
        context.chrome.storage.local.set = (items, callback) => { finish = callback; };
        context.recordId = id => { ids.push(id); };
        context.recordReadingList = () => { loadedReadingList = true; };
        context.ProgressBar = {setMax() {}, setValue() {}};
        context.zip = {
            BlobReader: class {},
            TextWriter: class {},
            ZipReader: class {
                async getEntries() {
                    let contents = {
                        "LibraryVersion.txt": "2",
                        "LibraryCountEntries.txt": "1",
                        "Library/0/LibCover": "cover",
                        "Library/0/LibEpub": "epub",
                        "Library/0/LibFilename": "title",
                        "Library/0/LibStoryURL": "url",
                        "Library/0/LibNewChapterCount": "0",
                        "ReadingList.json": "{}"
                    };
                    return Object.entries(contents).map(([filename, value]) => ({filename, getData: async () => value}));
                }
            }
        };
        vm.runInContext(`
            Library.LibGetStorageIDs = async () => [];
            Library.LibCreateStorageIDs = async id => recordId(id);
            Library.LibRenderSavedEpubs = () => {};
            Library.userPreferences = {loadReadingListFromJson: () => recordReadingList()};
            LibFileReader.result = JSON.stringify({Library: [{LibEpub: "epub", LibStoryURL: "url", LibCover: "cover", LibFilename: "title"}]});
        `, context);
        let expression = format === "zip" ? 'Library.LibFileReaderloadImport("zip")' : "Library.LibFileReaderloadImportLegacy()";
        let imported = vm.runInContext(expression, context);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(ids, []);
        assert.equal(loadedReadingList, false);
        finish();
        await imported;
        assert.deepEqual(ids, [0]);
        assert.equal(loadedReadingList, true);
    });

    test(`${format} import does not record an ID when the book write fails`, async () => {
        let {context, runtime} = createLibraryContext();
        let ids = [];
        context.chrome.storage.local.set = (items, callback) => {
            runtime.lastError = {message: "Import write failed"};
            callback();
            runtime.lastError = null;
        };
        context.recordId = id => ids.push(id);
        context.ProgressBar = {setMax() {}, setValue() {}};
        context.zip = {
            BlobReader: class {},
            TextWriter: class {},
            ZipReader: class {
                async getEntries() {
                    let names = ["LibraryVersion.txt", "LibraryCountEntries.txt", "Library/0/LibCover", "Library/0/LibEpub",
                        "Library/0/LibFilename", "Library/0/LibStoryURL", "Library/0/LibNewChapterCount"];
                    return names.map(filename => ({filename, getData: async () => filename === "LibraryVersion.txt" ? "2" : "1"}));
                }
            }
        };
        vm.runInContext(`
            Library.LibGetStorageIDs = async () => [];
            Library.LibCreateStorageIDs = async id => recordId(id);
            LibFileReader.result = JSON.stringify({Library: [{LibEpub: "epub", LibStoryURL: "url", LibCover: "cover", LibFilename: "title"}]});
        `, context);
        let expression = format === "zip" ? 'Library.LibFileReaderloadImport("zip")' : "Library.LibFileReaderloadImportLegacy()";
        await assert.rejects(vm.runInContext(expression, context), /Import write failed/);
        assert.deepEqual(ids, []);
    });
}

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

test("cover extraction reads EPUB through the adapter", async () => {
    let {context} = createLibraryContext();
    let saved;
    let readEpub;
    context.chrome.storage.local.set = (value, callback) => { saved = value; callback(); };
    context.zip = {
        Data64URIReader: class { constructor(value) { readEpub = value; } },
        Data64URIWriter: class {},
        TextWriter: class {},
        ZipReader: class {
            async getEntries() {
                return [
                    {filename: "OEBPS/Text/Cover.xhtml", directory: false, getData: async () => '"../Images/000.jpg"'},
                    {filename: "OEBPS/Images/000.jpg", directory: false, getData: async () => "data:;base64,YQ=="}
                ];
            }
        }
    };
    vm.runInContext('Library.epubStorage = {get: async id => "adapter:" + id}', context);
    await vm.runInContext('Library.LibSaveCoverImgInStorage("7")', context);
    assert.equal(readEpub, "adapter:7");
    assert.equal(saved.LibCover7, "data:image/jpg;base64,YQ==");
});

test("existing cached cover avoids loading EPUB", async () => {
    let {context} = createLibraryContext({LibCover7: "existing"});
    vm.runInContext('Library.epubStorage = {get: async () => { throw new Error("Unexpected read"); }}', context);
    await vm.runInContext('Library.LibSaveCoverImgInStorage("7")', context);
});

test("cover extraction propagates storage failures instead of caching a placeholder", async () => {
    let {context} = createLibraryContext();
    let writes = 0;
    context.chrome.storage.local.set = () => { writes++; };
    vm.runInContext('Library.epubStorage = {get: async () => { throw new Error("Storage unavailable"); }}', context);
    await assert.rejects(vm.runInContext('Library.LibSaveCoverImgInStorage("7")', context), /Storage unavailable/);
    vm.runInContext('Library.epubStorage = {get: async () => undefined}', context);
    await assert.rejects(vm.runInContext('Library.LibSaveCoverImgInStorage("7")', context), /EPUB not found/);
    assert.equal(writes, 0);
});

test("cover extraction retains the placeholder for EPUBs without a cover", async () => {
    let {context} = createLibraryContext();
    let saved;
    context.chrome.storage.local.set = (value, callback) => { saved = value; callback(); };
    context.zip = {
        Data64URIReader: class {},
        ZipReader: class { async getEntries() { return []; } }
    };
    vm.runInContext('Library.epubStorage = {get: async () => "epub"}', context);
    await vm.runInContext('Library.LibSaveCoverImgInStorage("7")', context);
    assert.match(saved.LibCover7, /^data:image\/svg\+xml;base64,/);
});

test("cover cache write errors propagate", async () => {
    let {context, runtime} = createLibraryContext();
    context.chrome.storage.local.set = (value, callback) => {
        runtime.lastError = {message: "Cover cache unavailable"};
        callback();
        runtime.lastError = null;
    };
    context.zip = {
        Data64URIReader: class {},
        ZipReader: class { async getEntries() { return []; } }
    };
    vm.runInContext('Library.epubStorage = {get: async () => "epub"}', context);
    await assert.rejects(vm.runInContext('Library.LibSaveCoverImgInStorage("7")', context), /Cover cache unavailable/);
});

test("metadata reads the EPUB from the selected adapter", async () => {
    let {context} = createLibraryContext();
    let readEpub;
    context.zip = {
        Data64URIReader: class { constructor(value) { readEpub = value; } },
        TextWriter: class {},
        ZipReader: class {
            async getEntries() {
                return [{filename: "OEBPS/content.opf", getData: async () => "<dc:title>Example</dc:title><dc:creator>Author</dc:creator>"}];
            }
        }
    };
    vm.runInContext('Library.epubStorage = {get: async id => "adapter:" + id}', context);
    let metadata = await vm.runInContext('Library.LibGetMetadata("7")', context);
    assert.equal(readEpub, "adapter:7");
    assert.deepEqual(Array.from(metadata), ["Example", "Author", "", "", "", ""]);
});

test("metadata read surfaces backend errors and missing EPUBs", async () => {
    let {context} = createLibraryContext();
    vm.runInContext('Library.epubStorage = {get: async () => { throw new Error("Storage unavailable"); }}', context);
    await assert.rejects(vm.runInContext('Library.LibGetMetadata("7")', context), /Storage unavailable/);
    vm.runInContext('Library.epubStorage = {get: async () => undefined}', context);
    await assert.rejects(vm.runInContext('Library.LibGetMetadata("7")', context), /EPUB not found/);
});

test("metadata read preserves empty metadata for unsupported EPUB structures", async () => {
    let {context} = createLibraryContext();
    context.zip = {
        Data64URIReader: class {},
        ZipReader: class { async getEntries() { return []; } }
    };
    vm.runInContext('Library.epubStorage = {get: async () => "epub"}', context);
    let metadata = await vm.runInContext('Library.LibGetMetadata("7")', context);
    assert.deepEqual(Array.from(metadata), []);
});
