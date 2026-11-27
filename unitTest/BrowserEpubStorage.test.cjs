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
            if (key == null) {
                callback({...values});
            } else if (Array.isArray(key)) {
                callback(Object.fromEntries(key.map(name => [name, values[name]])));
            } else {
                callback({[key]: values[key]});
            }
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
    assert.deepEqual(calls.filter(key => key !== "ExternalEpubStorage"), ["LibEpub7"]);
});

test("preserves missing EPUB and metadata lookup behavior", async () => {
    let {context, calls} = createLibraryContext({LibFilename7: "Title"});
    assert.equal(await vm.runInContext('Library.LibGetFromStorage("LibEpub9")', context), undefined);
    assert.equal(await vm.runInContext('Library.LibGetFromStorage("LibFilename7")', context), "Title");
    assert.deepEqual(calls.filter(key => key !== "ExternalEpubStorage"), ["LibEpub9", "LibFilename7"]);
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

test("browser adapter saves EPUB and metadata in one storage operation", async () => {
    let {context} = createLibraryContext();
    let writes = [];
    context.chrome.storage.local.set = (value, callback) => { writes.push(value); callback(); };
    await vm.runInContext('Library.epubStorage.set("7", "epub", {LibArray: [7], LibFilename7: "title", LibEpub7: "wrong"})', context);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].LibEpub7, "epub");
    assert.equal(writes[0].LibFilename7, "title");
    assert.deepEqual(Array.from(writes[0].LibArray), [7]);
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

test("library update uses selected adapter and propagates its write errors", async () => {
    let {context} = createLibraryContext({LibArray: [7], LibNewChapterCount7: 1});
    let writes = [];
    context.FileReader = class {
        readAsDataURL(blob) { this.result = blob; this.onload(); }
    };
    context.writeAdapter = async (...args) => { writes.push(args); throw new Error("Selected storage failed"); };
    context.chrome.storage.local.set = () => { throw new Error("Unexpected browser write"); };
    vm.runInContext('Library.LibShowLoadingText = () => {}; Library.epubStorage = {set: (...args) => writeAdapter(...args)}', context);
    await assert.rejects(vm.runInContext('Library.LibHandleUpdate(-1, "new", "url", "title", 7, 2)', context), /Selected storage failed/);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], 7);
    assert.equal(writes[0][1], "new");
    assert.equal(writes[0][2].LibNewChapterCount7, 3);
    assert.deepEqual(Array.from(writes[0][2].LibArray), [7]);
});

test("library import sends EPUB and metadata to the selected adapter", async () => {
    let {context} = createLibraryContext({LibArray: [3]});
    let write;
    context.writeAdapter = async (...args) => { write = args; };
    context.chrome.storage.local.set = () => { throw new Error("Unexpected browser write"); };
    vm.runInContext('Library.epubStorage = {set: (...args) => writeAdapter(...args)}', context);
    await vm.runInContext('Library.LibImportBook({epub:"new", storyURL:"url", filename:"title", cover:"cover", newChapterCount:"2"})', context);
    assert.equal(write[0], 4);
    assert.equal(write[1], "new");
    assert.equal(write[2].LibStoryURL4, "url");
    assert.equal(write[2].LibNewChapterCount4, "2");
    assert.deepEqual(Array.from(write[2].LibArray), [3, 4]);
});

test("legacy library IDs are discovered without rewriting metadata before the book write", async () => {
    let values = {LibEpub7: "old", LibStoryURL7: "url"};
    let {context} = createLibraryContext(values);
    let write;
    context.writeAdapter = async (...args) => { write = args; };
    context.chrome.storage.local.set = () => { throw new Error("Unexpected browser write"); };
    vm.runInContext('Library.epubStorage = {set: (...args) => writeAdapter(...args)}', context);
    await vm.runInContext('Library.LibImportBook({epub:"new", storyURL:"new-url", filename:"title", cover:"cover"})', context);
    assert.equal(write[0], 8);
    assert.deepEqual(Array.from(write[2].LibArray), ["7", 8]);
});

for (let failedKey of ["LibArray", null, "LibNewChapterCount7"]) {
    test(`update stops on metadata read failure for ${String(failedKey)}`, async () => {
        let values = failedKey === null ? {} : {LibArray: [7], LibNewChapterCount7: 1};
        let {context, runtime} = createLibraryContext(values);
        let writes = 0;
        context.FileReader = class {
            readAsDataURL(blob) { this.result = blob; this.onload(); }
        };
        context.chrome.storage.local.get = (key, callback) => {
            if (key === failedKey) {
                runtime.lastError = {message: "Metadata unavailable"};
                callback(undefined);
                runtime.lastError = null;
            } else {
                callback(key == null ? {...values} : {[key]: values[key]});
            }
        };
        context.writeAdapter = async () => { writes++; };
        vm.runInContext('Library.LibShowLoadingText = () => {}; Library.epubStorage = {set: (...args) => writeAdapter(...args)}', context);
        await assert.rejects(vm.runInContext('Library.LibHandleUpdate(-1, "new", "url", "title", 7, 2)', context), /Metadata unavailable/);
        assert.equal(writes, 0);
    });
}

test("acquisition stops when URL metadata cannot be read", async () => {
    let values = {LibArray: [7]};
    let {context, runtime} = createLibraryContext(values);
    let writes = 0;
    context.chrome.storage.local.get = (key, callback) => {
        if (Array.isArray(key)) {
            runtime.lastError = {message: "URL metadata unavailable"};
            callback(undefined);
            runtime.lastError = null;
        } else {
            callback({[key]: values[key]});
        }
    };
    context.writeAdapter = async () => { writes++; };
    vm.runInContext('Library.LibShowLoadingText = () => {}; Library.epubStorage = {set: (...args) => writeAdapter(...args)}', context);
    await assert.rejects(vm.runInContext('new Library().LibAddToLibrary("epub", "book.epub", "url", false, false)', context), /URL metadata unavailable/);
    assert.equal(writes, 0);
});

test("import stops when library IDs cannot be read", async () => {
    let {context, runtime} = createLibraryContext();
    let writes = 0;
    context.chrome.storage.local.get = (key, callback) => {
        runtime.lastError = {message: "Library IDs unavailable"};
        callback(undefined);
        runtime.lastError = null;
    };
    context.writeAdapter = async () => { writes++; };
    vm.runInContext('Library.epubStorage = {set: (...args) => writeAdapter(...args)}', context);
    await assert.rejects(vm.runInContext('Library.LibImportBook({epub:"new", storyURL:"url", filename:"title", cover:"cover"})', context), /Library IDs unavailable/);
    assert.equal(writes, 0);
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
    test(`${format} import writes the book and its ID together`, async () => {
        let values = {LibArray: [3]};
        let {context} = createLibraryContext(values);
        let finish;
        let pendingItems;
        let loadedReadingList = false;
        context.chrome.storage.local.set = (items, callback) => {
            pendingItems = items;
            finish = () => { Object.assign(values, items); callback(); };
        };
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
            Library.LibRenderSavedEpubs = () => {};
            Library.userPreferences = {loadReadingListFromJson: () => recordReadingList()};
            legacyImport = JSON.stringify({Library: [{LibEpub: "epub", LibStoryURL: "url", LibCover: "cover", LibFilename: "title"}]});
        `, context);
        let expression = format === "zip" ? 'Library.LibFileReaderloadImport("zip")' : "Library.LibFileReaderloadImportLegacy(legacyImport)";
        let imported = vm.runInContext(expression, context);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(values.LibArray, [3]);
        assert.equal(pendingItems.LibEpub4, "epub");
        assert.deepEqual(Array.from(pendingItems.LibArray), [3, 4]);
        assert.equal(loadedReadingList, false);
        finish();
        await imported;
        assert.deepEqual(Array.from(values.LibArray), [3, 4]);
        assert.equal(loadedReadingList, true);
    });

    test(`${format} import does not record an ID when the book write fails`, async () => {
        let values = {LibArray: [3]};
        let {context, runtime} = createLibraryContext(values);
        context.chrome.storage.local.set = (items, callback) => {
            runtime.lastError = {message: "Import write failed"};
            callback();
            runtime.lastError = null;
        };
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
            legacyImport = JSON.stringify({Library: [{LibEpub: "epub", LibStoryURL: "url", LibCover: "cover", LibFilename: "title"}]});
        `, context);
        let expression = format === "zip" ? 'Library.LibFileReaderloadImport("zip")' : "Library.LibFileReaderloadImportLegacy(legacyImport)";
        await assert.rejects(vm.runInContext(expression, context), /Import write failed/);
        assert.deepEqual(values.LibArray, [3]);
        assert.equal(values.LibEpub4, undefined);
    });

    test(`${format} import reports partial completion if a later book fails`, async () => {
        let values = {LibArray: []};
        let {context, runtime} = createLibraryContext(values);
        let writes = 0;
        let loaded = false;
        context.chrome.storage.local.set = (items, callback) => {
            writes++;
            if (writes === 2) {
                runtime.lastError = {message: "Storage quota exceeded"};
                callback();
                runtime.lastError = null;
            } else {
                Object.assign(values, items);
                callback();
            }
        };
        context.markLoaded = () => { loaded = true; };
        context.ProgressBar = {setMax() {}, setValue() {}};
        context.zip = {
            BlobReader: class {},
            TextWriter: class {},
            ZipReader: class {
                async getEntries() {
                    let contents = {"LibraryVersion.txt": "2", "LibraryCountEntries.txt": "2", "ReadingList.json": "{}"};
                    for (let i = 0; i < 2; i++) {
                        for (let name of ["LibCover", "LibEpub", "LibFilename", "LibStoryURL", "LibNewChapterCount"]) {
                            contents[`Library/${i}/${name}`] = `${name}${i}`;
                        }
                    }
                    return Object.entries(contents).map(([filename, value]) => ({filename, getData: async () => value}));
                }
            }
        };
        vm.runInContext(`
            Library.userPreferences = {loadReadingListFromJson: () => markLoaded()};
            legacyImport = JSON.stringify({Library: [
                {LibEpub: "book0", LibStoryURL: "url0", LibCover: "cover0", LibFilename: "title0"},
                {LibEpub: "book1", LibStoryURL: "url1", LibCover: "cover1", LibFilename: "title1"}
            ]});
        `, context);
        let expression = format === "zip" ? 'Library.LibFileReaderloadImport("zip")' : "Library.LibFileReaderloadImportLegacy(legacyImport)";
        await assert.rejects(vm.runInContext(expression, context), /1 book\(s\) were already imported.*duplicates.*Storage quota exceeded/);
        assert.deepEqual(Array.from(values.LibArray), [0]);
        assert.equal(values.LibEpub0, format === "zip" ? "LibEpub0" : "book0");
        assert.equal(values.LibEpub1, undefined);
        assert.equal(loaded, false);
    });

    test(`${format} import reports saved books if the reading list cannot be restored`, async () => {
        let values = {LibArray: []};
        let {context} = createLibraryContext(values);
        context.chrome.storage.local.set = (items, callback) => { Object.assign(values, items); callback(); };
        context.ProgressBar = {setMax() {}, setValue() {}};
        context.zip = {
            BlobReader: class {},
            TextWriter: class {},
            ZipReader: class {
                async getEntries() {
                    let contents = {"LibraryVersion.txt": "2", "LibraryCountEntries.txt": "1", "ReadingList.json": "{}"};
                    for (let name of ["LibCover", "LibEpub", "LibFilename", "LibStoryURL", "LibNewChapterCount"]) {
                        contents[`Library/0/${name}`] = name;
                    }
                    return Object.entries(contents).map(([filename, value]) => ({filename, getData: async () => value}));
                }
            }
        };
        vm.runInContext(`
            Library.userPreferences = {loadReadingListFromJson: () => { throw new Error("Reading list failed"); }};
            legacyImport = JSON.stringify({Library: [{LibEpub: "book", LibStoryURL: "url", LibCover: "cover", LibFilename: "title"}]});
        `, context);
        let expression = format === "zip" ? 'Library.LibFileReaderloadImport("zip")' : "Library.LibFileReaderloadImportLegacy(legacyImport)";
        await assert.rejects(vm.runInContext(expression, context), /1 book\(s\) were already imported.*duplicates.*Reading list failed/);
        assert.deepEqual(Array.from(values.LibArray), [0]);
    });
}

test("legacy import readers are isolated and await import completion", async () => {
    let {context} = createLibraryContext();
    let readers = [];
    let imported = [];
    let finishImport;
    context.FileReader = class {
        constructor() { readers.push(this); }
        readAsText(blob) { this.blob = blob; }
    };
    context.importText = async text => {
        imported.push(text);
        if (text === "first") {
            await new Promise(resolve => { finishImport = resolve; });
        }
    };
    vm.runInContext('Library.LibShowLoadingText = () => {}; Library.LibFileReaderloadImportLegacy = text => importText(text)', context);
    let first = vm.runInContext('Library.LibHandelImport({files: [{name:"one.json"}]})', context);
    let second = vm.runInContext('Library.LibHandelImport({files: [{name:"two.json"}]})', context);
    readers[1].result = "second";
    readers[1].onload();
    readers[0].result = "first";
    readers[0].onload();
    let completed = false;
    first.then(() => { completed = true; });
    await second;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(imported, ["second", "first"]);
    assert.equal(completed, false);
    finishImport();
    await first;
});

test("legacy import read errors and aborts propagate", async () => {
    let {context} = createLibraryContext();
    let readers = [];
    context.FileReader = class {
        constructor() { readers.push(this); }
        readAsText() {}
    };
    vm.runInContext('Library.LibShowLoadingText = () => {}', context);
    let failed = vm.runInContext('Library.LibHandelImport({files: [{name:"one.json"}]})', context);
    readers[0].error = new Error("Read failed");
    readers[0].onerror();
    await assert.rejects(failed, /Read failed/);
    let aborted = vm.runInContext('Library.LibHandelImport({files: [{name:"two.json"}]})', context);
    readers[1].onabort();
    await assert.rejects(aborted, /aborted/);
});

test("import and update allocate distinct IDs when they overlap", async () => {
    let values = {LibArray: []};
    let {context} = createLibraryContext(values);
    let finishFirst;
    let writes = 0;
    context.FileReader = class {
        readAsDataURL(blob) { this.result = blob; this.onload(); }
    };
    context.chrome.storage.local.set = (items, callback) => {
        writes++;
        if (writes === 1) {
            finishFirst = () => { Object.assign(values, items); callback(); };
        } else {
            Object.assign(values, items);
            callback();
        }
    };
    vm.runInContext('Library.LibShowLoadingText = () => {}; Library.LibSaveCoverImgInStorage = async () => {}; Library.LibRenderSavedEpubs = async () => {}', context);
    let imported = vm.runInContext('Library.LibImportBook({epub:"imported", storyURL:"import-url", cover:"cover", filename:"import"})', context);
    await new Promise(resolve => setImmediate(resolve));
    let updated = vm.runInContext('Library.LibHandleUpdate(-1, "updated", "update-url", "update", -1)', context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes, 1);
    finishFirst();
    await Promise.all([imported, updated]);
    assert.deepEqual(Array.from(values.LibArray), [0, 1]);
    assert.equal(values.LibEpub0, "imported");
    assert.equal(values.LibEpub1, "updated");
});

test("routes EPUB reads through the configured adapter", async () => {
    let {context, calls} = createLibraryContext();
    vm.runInContext('Library.epubStorage = {get: async id => "adapter:" + id}', context);
    assert.equal(await vm.runInContext('Library.LibGetFromStorage("LibEpub42")', context), "adapter:42");
    assert.deepEqual(calls.filter(key => key !== "ExternalEpubStorage"), []);
});

test("chapter lookup distinguishes untracked stories from missing stored EPUBs", async () => {
    let {context} = createLibraryContext();
    vm.runInContext(`
        Library.LibGetStorageIDs = async () => [7];
        Library.LibGetFromStorageArray = async () => ({LibStoryURL7: "url"});
        Library.epubStorage = {get: async () => undefined};
    `, context);
    assert.equal(await vm.runInContext('Library.LibGetSourceChapterList("other")', context), null);
    await assert.rejects(vm.runInContext('Library.LibGetSourceChapterList("url")', context), /EPUB not found.*7/);
    vm.runInContext('Library.epubStorage = {get: async () => { throw new Error("Backend unavailable"); }}', context);
    await assert.rejects(vm.runInContext('Library.LibGetSourceChapterList("url")', context), /Backend unavailable/);
});

test("manual merge stops before processing when stored EPUB is missing", async () => {
    let {context} = createLibraryContext();
    let merged = false;
    context.markMerged = () => { merged = true; };
    vm.runInContext('Library.epubStorage = {get: async () => undefined}; Library.LibMergeEpub = async () => markMerged()', context);
    await assert.rejects(vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "7"}, files: ["new"]})', context), /EPUB not found.*7/);
    assert.equal(merged, false);
});

for (let key of ["LibStoryURL7", "LibFilename7"]) {
    for (let firstKind of ["change", "merge"]) {
        test(`${key} change and same-book merge serialize when ${firstKind} starts first`, async () => {
            let values = {LibEpub7: "old", LibStoryURL7: "url", LibFilename7: "title"};
            let {context} = createLibraryContext(values);
            let release;
            let started = new Promise(resolve => { context.started = resolve; });
            let events = [];
            let input = {dataset: {libepubid: "7"}, id: key, value: "edited"};
            context.input = input;
            context.chrome.storage.local.set = (items, callback) => {
                events.push("change");
                let finish = () => { Object.assign(values, items); callback(); };
                if (firstKind === "change") {
                    release = finish;
                    context.started();
                } else {
                    finish();
                }
            };
            context.merge = async () => {
                events.push("merge");
                if (firstKind === "merge") {
                    await new Promise(resolve => { release = resolve; context.started(); });
                }
            };
            vm.runInContext("Library.LibMergeEpub = merge; Library.LibGetSourceChapterList = async () => null", context);
            let change = () => vm.runInContext("Library.LibSaveTextURLChange(input)", context);
            let merge = () => vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "7"}, files: ["new"]})', context);
            let first = firstKind === "change" ? change() : merge();
            await started;
            let second = firstKind === "change" ? merge() : change();
            input.value = "later";
            await new Promise(resolve => setImmediate(resolve));
            assert.deepEqual(events, [firstKind]);
            release();
            await Promise.all([first, second]);
            assert.deepEqual(events, firstKind === "change" ? ["change", "merge"] : ["merge", "change"]);
            assert.equal(values[key], "edited");
            assert.equal(vm.runInContext("Library.bookQueues.size", context), 0);
        });
    }
}

for (let key of ["LibStoryURL7", "LibFilename7"]) {
    test(`failed ${key} change propagates and releases the book queue`, async () => {
        let values = {LibEpub7: "old", LibStoryURL7: "url", LibFilename7: "title"};
        let {context, runtime} = createLibraryContext(values);
        let original = values[key];
        let merged = false;
        context.input = {dataset: {libepubid: "7"}, id: key, value: "new"};
        context.chrome.storage.local.set = (items, callback) => {
            runtime.lastError = {message: "Text write failed"};
            callback();
            runtime.lastError = null;
        };
        context.merge = async () => { merged = true; };
        vm.runInContext("Library.LibMergeEpub = merge; Library.LibGetSourceChapterList = async () => null", context);
        await assert.rejects(vm.runInContext("Library.LibSaveTextURLChange(input)", context), /Text write failed/);
        await vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "7"}, files: ["new"]})', context);
        assert.equal(values[key], original);
        assert.equal(merged, true);
        assert.equal(vm.runInContext("Library.bookQueues.size", context), 0);
    });
}

for (let firstKind of ["edit", "merge"]) {
    test(`metadata edit and same-book merge serialize when ${firstKind} starts first`, async () => {
        let values = {LibEpub7: "old", LibStoryURL7: "url"};
        let {context} = createLibraryContext(values);
        let input = {value: "initial"};
        let events = [];
        let release;
        let started = new Promise(resolve => { context.started = resolve; });
        context.document = {getElementById: id => id.startsWith("LibTitleInput") ? input : {value: ""}};
        context.edit = async (id, fields) => {
            events.push(["edit", values.LibEpub7, fields.LibTitleInput]);
            if (firstKind === "edit") {
                await new Promise(resolve => { release = resolve; context.started(); });
            }
            values.LibEpub7 += "+edit";
        };
        context.merge = async previous => {
            events.push(["merge", previous]);
            if (firstKind === "merge") {
                await new Promise(resolve => { release = resolve; context.started(); });
            }
            values.LibEpub7 = previous + "+merge";
        };
        vm.runInContext('Library.LibSaveMetadataChangeQueued = edit; Library.LibMergeEpub = merge; Library.LibGetSourceChapterList = async () => null', context);
        let edit = () => vm.runInContext('Library.LibSaveMetadataChange({dataset: {libepubid: "7"}})', context);
        let merge = () => vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "7"}, files: ["new"]})', context);
        let first = firstKind === "edit" ? edit() : merge();
        await started;
        let second = firstKind === "edit" ? merge() : edit();
        input.value = "changed";
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(events.length, 1);
        release();
        await Promise.all([first, second]);
        assert.deepEqual(events, firstKind === "edit"
            ? [["edit", "old", "initial"], ["merge", "old+edit"]]
            : [["merge", "old"], ["edit", "old+merge", "initial"]]);
        assert.equal(vm.runInContext("Library.bookQueues.size", context), 0);
    });
}

test("a failed metadata edit releases the book queue", async () => {
    let {context} = createLibraryContext({LibEpub7: "old", LibStoryURL7: "url"});
    let merged = false;
    context.document = {getElementById: () => ({value: ""})};
    context.merge = async () => { merged = true; };
    vm.runInContext('Library.LibSaveMetadataChangeQueued = async () => { throw new Error("Edit failed"); }; Library.LibMergeEpub = merge; Library.LibGetSourceChapterList = async () => null', context);
    await assert.rejects(vm.runInContext('Library.LibSaveMetadataChange({dataset: {libepubid: "7"}})', context), /Edit failed/);
    await vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "7"}, files: ["new"]})', context);
    assert.equal(merged, true);
    assert.equal(vm.runInContext("Library.bookQueues.size", context), 0);
});

test("metadata edit reads the EPUB after an earlier same-book merge finishes", async () => {
    let values = {LibEpub7: "old", LibStoryURL7: "url", LibFilename7: "title"};
    let {context} = createLibraryContext(values);
    let release;
    let started = new Promise(resolve => { context.started = resolve; });
    let editedSource;
    let saved;
    context.document = {getElementById: () => ({value: ""})};
    context.ErrorLog = {showErrorMessage: error => { throw error; }};
    context.EpubPacker = class { getDateForMetaData() { return "date"; } };
    context.merge = async previous => {
        await new Promise(resolve => { release = resolve; context.started(); });
        values.LibEpub7 = previous + "+merge";
    };
    context.save = async (button, content) => { saved = content; };
    context.zip = {
        Data64URIReader: class { constructor(value) { editedSource = value; } },
        BlobReader: class {},
        BlobWriter: class {},
        TextReader: class {},
        TextWriter: class {},
        ZipReader: class {
            async getEntries() {
                return [{filename: "OEBPS/content.opf", directory: false,
                    getData: async () => "<dc:title>old</dc:title><dc:creator>old</dc:creator>"}];
            }
        },
        ZipWriter: class { add() {} async close() { return "edited"; } }
    };
    vm.runInContext('Library.LibShowLoadingText = () => {}; Library.LibMergeEpub = merge; Library.LibHandleUpdate = save; Library.LibGetSourceChapterList = async () => null', context);
    let merge = vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "7"}, files: ["new"]})', context);
    await started;
    let edit = vm.runInContext('Library.LibSaveMetadataChange({dataset: {libepubid: "7"}})', context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(editedSource, undefined);
    release();
    await Promise.all([merge, edit]);
    assert.equal(editedSource, "old+merge");
    assert.equal(saved, "edited");
});

for (let failMetadata of [false, true]) {
    test(`merge ${failMetadata ? "stops on" : "preserves"} story and filename metadata ${failMetadata ? "read failure" : "on save"}`, async () => {
        let {context, runtime} = createLibraryContext({LibStoryURL7: "url", LibFilename7: "title"});
        let writes = [];
        let storageGet = context.chrome.storage.local.get;
        context.chrome.storage.local.get = (keys, callback) => {
            if (failMetadata && Array.isArray(keys) && keys.includes("LibStoryURL7")) {
                runtime.lastError = {message: "Metadata unavailable"};
                callback({});
                runtime.lastError = null;
                return;
            }
            storageGet(keys, callback);
        };
        context.save = (...args) => { writes.push(args); };
        let entries = ["OEBPS/content.opf", "OEBPS/toc.ncx"].map(filename => ({
            filename, directory: false, getData: async () => "<xml/>"
        }));
        context.zip = {
            Data64URIReader: class {},
            BlobReader: class {},
            BlobWriter: class {},
            TextReader: class {},
            TextWriter: class {},
            ZipReader: class { async getEntries() { return entries; } },
            ZipWriter: class { add() {} async close() { return "merged"; } }
        };
        vm.runInContext("Library.LibShowLoadingText = () => {}; Library.LibHandleUpdate = save", context);
        let operation = vm.runInContext('Library.LibMergeEpub("old", "new", "7")', context);
        if (failMetadata) {
            await assert.rejects(operation, /Metadata unavailable/);
            assert.deepEqual(writes, []);
        } else {
            assert.equal(await operation, "merged");
            assert.deepEqual(writes, [[-1, "merged", "url", "title", "7", 0]]);
        }
    });
}

for (let firstKind of ["manual", "acquisition"]) {
    test(`manual and acquired merges serialize when ${firstKind} starts first`, async () => {
        let values = {LibArray: [7], LibStoryURL7: "url", LibEpub7: "old"};
        let {context} = createLibraryContext(values);
        let finish;
        let started = new Promise(resolve => { context.started = resolve; });
        let reads = [];
        context.document = {getElementById: () => ({checked: false})};
        context.merge = async (previous, next) => {
            reads.push([previous, next]);
            if (reads.length === 1) {
                await new Promise(resolve => { finish = resolve; context.started(); });
            }
            values.LibEpub7 = previous + "+" + next;
            return values.LibEpub7;
        };
        vm.runInContext(`
            Library.LibShowLoadingText = () => {};
            Library.userPreferences = {readingList: {addEpub: () => {}, setEpub: () => {}}};
            Library.LibMergeEpub = merge;
            Library.LibGetSourceChapterList = async () => null;
        `, context);
        let manual = () => vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "7"}, files: ["manual"]})', context);
        let acquisition = () => vm.runInContext('new Library().LibAddToLibrary("acquired", "book.epub", "url", false, false)', context);
        let first = firstKind === "manual" ? manual() : acquisition();
        await started;
        let second = firstKind === "manual" ? acquisition() : manual();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(reads.length, 1);
        finish();
        await Promise.all([first, second]);
        let firstPart = firstKind === "manual" ? "manual" : "acquired";
        let secondPart = firstKind === "manual" ? "acquired" : "manual";
        assert.deepEqual(reads, [["old", firstPart], ["old+" + firstPart, secondPart]]);
        assert.equal(values.LibEpub7, "old+" + firstPart + "+" + secondPart);
        assert.equal(vm.runInContext("Library.bookQueues.size", context), 0);
    });
}

test("a failed manual merge releases the book queue for a later acquisition", async () => {
    let values = {LibArray: [7], LibStoryURL7: "url", LibEpub7: "old"};
    let {context} = createLibraryContext(values);
    let finish;
    let started = new Promise(resolve => { context.started = resolve; });
    context.document = {getElementById: () => ({checked: false})};
    context.merge = async (previous, next) => {
        if (next === "manual") {
            await new Promise(resolve => { finish = resolve; context.started(); });
            throw new Error("Merge failed");
        }
        values.LibEpub7 = previous + "+" + next;
        return values.LibEpub7;
    };
    vm.runInContext(`
        Library.LibShowLoadingText = () => {};
        Library.userPreferences = {readingList: {addEpub: () => {}}};
        Library.LibMergeEpub = merge;
    `, context);
    let first = vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "7"}, files: ["manual"]})', context);
    await started;
    let second = vm.runInContext('new Library().LibAddToLibrary("acquired", "book.epub", "url", false, false)', context);
    finish();
    await assert.rejects(first, /Merge failed/);
    await second;
    assert.equal(values.LibEpub7, "old+acquired");
    assert.equal(vm.runInContext("Library.bookQueues.size", context), 0);
});

test("manual merges of different books proceed independently", async () => {
    let values = {LibEpub7: "old7", LibEpub8: "old8"};
    let {context} = createLibraryContext(values);
    let finish;
    let started = new Promise(resolve => { context.started = resolve; });
    context.merge = async (previous, next, id) => {
        if (id === "7") {
            await new Promise(resolve => { finish = resolve; context.started(); });
        }
        values["LibEpub" + id] = previous + "+" + next;
    };
    vm.runInContext('Library.LibMergeEpub = merge; Library.LibGetSourceChapterList = async () => null', context);
    let first = vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "7"}, files: ["first"]})', context);
    await started;
    let second = vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "8"}, files: ["second"]})', context);
    await second;
    assert.equal(values.LibEpub8, "old8+second");
    assert.equal(values.LibEpub7, "old7");
    finish();
    await first;
    assert.equal(values.LibEpub7, "old7+first");
    assert.equal(vm.runInContext("Library.bookQueues.size", context), 0);
});

test("acquisition merge does not update reading state when stored EPUB is missing", async () => {
    let {context} = createLibraryContext({LibArray: [7], LibStoryURL7: "url"});
    let added = 0;
    context.added = () => { added++; };
    context.document = {getElementById: () => ({value: "url", checked: false})};
    vm.runInContext(`
        Library.userPreferences = {readingList: {addEpub: () => added()}};
        Library.LibShowLoadingText = () => {};
        Library.epubStorage = {get: async () => undefined};
    `, context);
    await assert.rejects(vm.runInContext('new Library().LibAddToLibrary("epub", "book.epub", "url", false, false)', context), /EPUB not found.*7/);
    assert.equal(added, 0);
});

test("overlapping acquisitions of one URL create one book and merge against the saved EPUB", async () => {
    let values = {LibArray: []};
    let {context} = createLibraryContext(values);
    let finish;
    let started = new Promise(resolve => { context.started = resolve; });
    context.document = {getElementById: () => ({value: "changed-ui-value", checked: false})};
    context.saveFirst = (epub, url) => new Promise(resolve => {
        finish = () => {
            Object.assign(values, {LibArray: [0], LibStoryURL0: url, LibEpub0: epub});
            resolve();
        };
        context.started();
    });
    context.merge = async (previous, next) => {
        values.LibEpub0 = previous + "+" + next;
        return values.LibEpub0;
    };
    vm.runInContext(`
        Library.userPreferences = {readingList: {addEpub: () => {}}};
        Library.LibShowLoadingText = () => {};
        Library.LibHandleUpdate = async (button, epub, url) => saveFirst(epub, url);
        Library.LibMergeEpub = merge;
    `, context);
    let first = vm.runInContext('new Library().LibAddToLibrary("first", "book.epub", "url", false, false)', context);
    await started;
    let second = vm.runInContext('new Library().LibAddToLibrary("second", "book.epub", "url", false, false)', context);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(values.LibArray, []);
    finish();
    await Promise.all([first, second]);
    assert.deepEqual(values.LibArray, [0]);
    assert.equal(values.LibStoryURL0, "url");
    assert.equal(values.LibEpub0, "first+second");
    assert.equal(vm.runInContext("Library.acquisitionQueues.size", context), 0);
});

test("failed acquisition does not block the next operation for the same URL", async () => {
    let {context} = createLibraryContext();
    let release;
    context.gate = new Promise(resolve => { release = resolve; });
    let first = vm.runInContext('Library.LibQueueAcquisition("url", async () => { await gate; throw new Error("failed"); })', context);
    let second = vm.runInContext('Library.LibQueueAcquisition("url", async () => "retried")', context);
    release();
    await assert.rejects(first, /failed/);
    assert.equal(await second, "retried");
    assert.equal(vm.runInContext("Library.acquisitionQueues.size", context), 0);
});

test("acquisitions for different URLs can proceed independently", async () => {
    let {context} = createLibraryContext();
    let release;
    context.gate = new Promise(resolve => { release = resolve; });
    let first = vm.runInContext('Library.LibQueueAcquisition("first", () => gate)', context);
    let second = vm.runInContext('Library.LibQueueAcquisition("second", async () => "completed")', context);
    assert.equal(await second, "completed");
    release("done");
    assert.equal(await first, "done");
    assert.equal(vm.runInContext("Library.acquisitionQueues.size", context), 0);
});

function setupMergedDownload(context) {
    context.document = {getElementById: () => ({value: "url", checked: true})};
    context.EpubPacker = {addExtensionIfMissing: name => name + ".epub"};
    context.Download = {isFileNameIllegalOnWindows: () => false};
    vm.runInContext(`
        Library.userPreferences = {readingList: {addEpub: () => {}}};
        Library.LibShowLoadingText = () => {};
        Library.LibMergeEpub = async () => "merged";
    `, context);
}

test("same-book acquisition waits for the prior download and chapter marker", async () => {
    let values = {LibArray: [7], LibStoryURL7: "url", LibFilename7: "title", LibEpub7: "existing"};
    let {context} = createLibraryContext(values);
    setupMergedDownload(context);
    let finishDownload;
    let downloads = 0;
    context.Download.save = () => {
        downloads++;
        if (downloads === 1) {
            return new Promise(resolve => { finishDownload = resolve; });
        }
        return Promise.resolve();
    };
    context.chrome.storage.local.set = (items, callback) => { Object.assign(values, items); callback(); };
    let first = vm.runInContext('new Library().LibAddToLibrary("first", "book.epub", "url", false, false)', context);
    await new Promise(resolve => setImmediate(resolve));
    let second = vm.runInContext('new Library().LibAddToLibrary("second", "book.epub", "url", false, false)', context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(downloads, 1);
    finishDownload();
    await Promise.all([first, second]);
    assert.equal(downloads, 2);
    assert.equal(values.LibNewChapterCount7, "-1");
});

test("merged download preserves the chapter marker on download failure", async () => {
    let values = {LibArray: [7], LibStoryURL7: "url", LibFilename7: "title", LibEpub7: "existing", LibNewChapterCount7: 4};
    let {context} = createLibraryContext(values);
    setupMergedDownload(context);
    let writes = 0;
    context.chrome.storage.local.set = () => { writes++; };
    context.Download.save = async () => { throw new Error("Download failed"); };
    await assert.rejects(vm.runInContext('new Library().LibAddToLibrary("epub", "book.epub", "url", false, false)', context), /Download failed/);
    assert.equal(writes, 0);
    assert.equal(values.LibNewChapterCount7, 4);
});

test("merged download waits for the chapter marker after successful download", async () => {
    let values = {LibArray: [7], LibStoryURL7: "url", LibFilename7: "title", LibEpub7: "existing"};
    let {context} = createLibraryContext(values);
    setupMergedDownload(context);
    context.Download.save = async () => "downloaded";
    let finish;
    context.chrome.storage.local.set = (items, callback) => {
        finish = () => { Object.assign(values, items); callback(); };
    };
    let completed = false;
    let operation = vm.runInContext('new Library().LibAddToLibrary("epub", "book.epub", "url", false, false)', context);
    operation.then(() => { completed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    finish();
    assert.equal(await operation, "downloaded");
    assert.equal(values.LibNewChapterCount7, "-1");
});

test("merged download reports chapter marker failure after downloading", async () => {
    let values = {LibArray: [7], LibStoryURL7: "url", LibFilename7: "title", LibEpub7: "existing"};
    let {context, runtime} = createLibraryContext(values);
    setupMergedDownload(context);
    context.Download.save = async () => "downloaded";
    context.chrome.storage.local.set = (items, callback) => {
        runtime.lastError = {message: "Storage unavailable"};
        callback();
        runtime.lastError = null;
    };
    await assert.rejects(vm.runInContext('new Library().LibAddToLibrary("epub", "book.epub", "url", false, false)', context), /download request returned.*Storage unavailable/);
});

function setupFirefoxDownload(context, platform, download) {
    context.util = {isFirefox: () => true};
    context.browser = {
        runtime: {getPlatformInfo: async () => ({os: platform})},
        downloads: {onChanged: {addListener() {}}, download}
    };
    let source = fs.readFileSync(path.join(__dirname, "..", "plugin", "js", "Download.js"), "utf8");
    vm.runInContext(source, context, {filename: "Download.js"});
}

test("Firefox download errors clean up and reject", async () => {
    let {context} = createLibraryContext();
    let cleaned = 0;
    context.cleanupDownload = () => { cleaned++; };
    setupFirefoxDownload(context, "linux", async () => { throw new Error("Firefox download failed"); });
    await assert.rejects(vm.runInContext('Download.saveOnFirefox({}, cleanupDownload)', context), /Firefox download failed/);
    assert.equal(cleaned, 1);
});

test("Firefox platform detection errors clean up and reject", async () => {
    let {context} = createLibraryContext();
    let cleaned = 0;
    context.cleanupDownload = () => { cleaned++; };
    setupFirefoxDownload(context, "linux", async () => 17);
    context.browser.runtime.getPlatformInfo = async () => { throw new Error("Platform unavailable"); };
    await assert.rejects(vm.runInContext('Download.saveOnFirefox({}, cleanupDownload)', context), /Platform unavailable/);
    assert.equal(cleaned, 1);
});

test("Firefox successful download defers cleanup until completion event", async () => {
    let {context} = createLibraryContext();
    let cleaned = 0;
    context.cleanupDownload = () => { cleaned++; };
    setupFirefoxDownload(context, "linux", async () => 17);
    await vm.runInContext('Download.saveOnFirefox({}, cleanupDownload)', context);
    assert.equal(cleaned, 0);
    vm.runInContext('Download.onChanged({id: 17, state: {current: "complete"}})', context);
    assert.equal(cleaned, 1);
});

test("Firefox Android link failures remove the link, clean up, and reject", async () => {
    let {context} = createLibraryContext();
    let cleaned = 0;
    let removed = 0;
    context.cleanupDownload = () => { cleaned++; };
    context.document = {
        createElement: () => ({style: {}, click() { throw new Error("Click failed"); }}),
        body: {appendChild() {}, removeChild() { removed++; }}
    };
    setupFirefoxDownload(context, "android", async () => { throw new Error("Unexpected API call"); });
    await assert.rejects(vm.runInContext('Download.saveOnFirefox({url: "blob", filename: "book.epub"}, cleanupDownload)', context), /Click failed/);
    assert.equal(cleaned, 1);
    assert.equal(removed, 1);
});

test("Firefox Android dispatches the link before resolving and cleans it up", async () => {
    let {context} = createLibraryContext();
    let events = [];
    context.cleanupDownload = () => { events.push("cleanup"); };
    context.document = {
        createElement: () => ({style: {}, click() { events.push("click"); }}),
        body: {appendChild() { events.push("append"); }, removeChild() { events.push("remove"); }}
    };
    setupFirefoxDownload(context, "android", async () => { throw new Error("Unexpected API call"); });
    await vm.runInContext('Download.saveOnFirefox({url: "blob", filename: "book.epub"}, cleanupDownload)', context);
    assert.deepEqual(events, ["append", "click", "remove", "cleanup"]);
});

function setupExport(context, useRealIndex = false) {
    let entries = [];
    let downloads = [];
    context.ReadingList = class {
        readFromLocalStorage() {}
        toJson() { return JSON.stringify({epubs: [{toc: "url"}, {toc: "other"}]}); }
    };
    context.ProgressBar = {setMax() {}, setValue() {}};
    context.Download = {save: async (...args) => { downloads.push(args); }};
    context.zip = {
        BlobWriter: class {},
        TextReader: class { constructor(value) { this.value = value; } },
        ZipWriter: class {
            async add(name, reader) { entries.push([name, reader.value]); }
            async close() { return "archive"; }
        }
    };
    vm.runInContext('Library.LibShowLoadingText = () => {}; Library.LibRenderSavedEpubs = () => {}', context);
    if (!useRealIndex) {
        vm.runInContext('Library.LibGetStorageIDsForWrite = async () => [7]', context);
    }
    return {entries, downloads};
}

test("library export reads the selected adapter and preserves archive metadata", async () => {
    let {context} = createLibraryContext({LibCover7: "cover", LibFilename7: "title", LibStoryURL7: "url", LibNewChapterCount7: "2"});
    let {entries, downloads} = setupExport(context);
    vm.runInContext('Library.epubStorage = {get: async id => "adapter:" + id}', context);
    await vm.runInContext("Library.Libexportall()", context);
    assert.equal(entries.find(([name]) => name === "Library/0/LibEpub")[1], "adapter:7");
    assert.equal(entries.find(([name]) => name === "Library/0/LibFilename")[1], "title");
    assert.equal(entries.find(([name]) => name === "Library/0/LibNewChapterCount")[1], "2");
    assert.deepEqual(JSON.parse(entries.find(([name]) => name === "ReadingList.json")[1]).ReadingList.epubs, [{toc: "url"}]);
    assert.deepEqual(downloads, [["archive", "Libraryexport.zip"]]);
});

test("library export stops without downloading for missing or failed EPUB reads", async () => {
    let {context} = createLibraryContext();
    let {downloads} = setupExport(context);
    vm.runInContext('Library.epubStorage = {get: async () => undefined}', context);
    await assert.rejects(vm.runInContext("Library.Libexportall()", context), /EPUB not found.*7/);
    vm.runInContext('Library.epubStorage = {get: async () => { throw new Error("Backend unavailable"); }}', context);
    await assert.rejects(vm.runInContext("Library.Libexportall()", context), /Backend unavailable/);
    assert.deepEqual(downloads, []);
});

test("library export propagates ZIP entry failures without downloading", async () => {
    let {context} = createLibraryContext();
    let {downloads} = setupExport(context);
    context.zip.ZipWriter = class { async add() { throw new Error("ZIP write failed"); } };
    await assert.rejects(vm.runInContext("Library.Libexportall()", context), /ZIP write failed/);
    assert.deepEqual(downloads, []);
});

test("library export stops when book metadata cannot be read", async () => {
    let {context, runtime} = createLibraryContext();
    let {entries, downloads} = setupExport(context);
    context.chrome.storage.local.get = (keys, callback) => {
        runtime.lastError = {message: "Metadata unavailable"};
        callback({});
        runtime.lastError = null;
    };
    await assert.rejects(vm.runInContext("Library.Libexportall()", context), /Metadata unavailable/);
    assert.deepEqual(entries, []);
    assert.deepEqual(downloads, []);
});

test("library export stops when the library index cannot be read", async () => {
    let {context, runtime} = createLibraryContext();
    let {entries, downloads} = setupExport(context, true);
    context.chrome.storage.local.get = (keys, callback) => {
        runtime.lastError = {message: "Index unavailable"};
        callback({});
        runtime.lastError = null;
    };
    await assert.rejects(vm.runInContext("Library.Libexportall()", context), /Index unavailable/);
    assert.deepEqual(entries, []);
    assert.deepEqual(downloads, []);
});

test("library export discovers legacy books without rewriting their index", async () => {
    let {context} = createLibraryContext({LibEpub7: "epub", LibFilename7: "title", LibStoryURL7: "url", LibCover7: "cover"});
    let {entries, downloads} = setupExport(context, true);
    context.chrome.storage.local.set = () => { throw new Error("Unexpected storage write"); };
    await vm.runInContext("Library.Libexportall()", context);
    assert.equal(entries.find(([name]) => name === "Library/0/LibEpub")[1], "epub");
    assert.deepEqual(downloads, [["archive", "Libraryexport.zip"]]);
});

test("library export waits for the download request before refreshing", async () => {
    let {context} = createLibraryContext({LibEpub7: "epub"});
    setupExport(context);
    let release;
    let refreshed = false;
    let started = new Promise(resolve => { context.started = resolve; });
    context.Download.save = async () => new Promise(resolve => { release = resolve; context.started(); });
    context.refresh = () => { refreshed = true; };
    vm.runInContext("Library.LibRenderSavedEpubs = refresh", context);
    let operation = vm.runInContext("Library.Libexportall()", context);
    await started;
    assert.equal(refreshed, false);
    release();
    await operation;
    assert.equal(refreshed, true);
});

test("library export propagates a failed download without refreshing", async () => {
    let {context} = createLibraryContext({LibEpub7: "epub"});
    setupExport(context);
    let refreshed = false;
    context.Download.save = async () => { throw new Error("Download failed"); };
    context.refresh = () => { refreshed = true; };
    vm.runInContext("Library.LibRenderSavedEpubs = refresh", context);
    await assert.rejects(vm.runInContext("Library.Libexportall()", context), /Download failed/);
    assert.equal(refreshed, false);
});

test("library export identifies refresh failure after download request returned", async () => {
    let {context} = createLibraryContext({LibEpub7: "epub"});
    let {downloads} = setupExport(context);
    vm.runInContext('Library.LibRenderSavedEpubs = async () => { throw new Error("Refresh failed"); }', context);
    await assert.rejects(vm.runInContext("Library.Libexportall()", context), /download request returned.*refresh failed.*Refresh failed/);
    assert.deepEqual(downloads, [["archive", "Libraryexport.zip"]]);
});

test("downloads the selected adapter's EPUB and retains download preferences", async () => {
    let {context} = createLibraryContext({LibFilename7: "Title"});
    let removed = [];
    let count = {innerHTML: "2"};
    let downloaded;
    context.chrome.storage.local.remove = (keys, callback) => { removed.push(...keys); callback(); };
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

test("library download waits for the chapter marker to be cleared", async () => {
    let {context} = createLibraryContext({LibFilename7: "Title"});
    let count = {innerHTML: "2"};
    let finish;
    context.chrome.storage.local.remove = (keys, callback) => { finish = callback; };
    context.document = {getElementById: () => count};
    context.UserPreferences = {readFromLocalStorage: () => ({
        overwriteExistingEpub: {value: false}, noDownloadPopup: {value: false}
    })};
    context.Download = {save: async () => "saved"};
    vm.runInContext('Library.epubStorage = {get: async () => "data"}; Library.LibConvertDataUrlToBlob = async value => value', context);
    let completed = false;
    let operation = vm.runInContext('Library.LibDownload({dataset: {libepubid: "7"}})', context);
    operation.then(() => { completed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    assert.equal(count.innerHTML, "2");
    finish();
    assert.equal(await operation, "saved");
    assert.equal(count.innerHTML, "");
});

for (let [firstKind, mergeKind] of [
    ["download", "manual"], ["merge", "manual"],
    ["download", "acquisition"], ["merge", "acquisition"]
]) {
    test(`library download and ${mergeKind} merge serialize when ${firstKind} starts first`, async () => {
        let values = {LibArray: [7], LibEpub7: "old", LibFilename7: "Title", LibStoryURL7: "url", LibNewChapterCount7: "2"};
        let {context} = createLibraryContext(values);
        let release;
        let started = new Promise(resolve => { context.started = resolve; });
        let events = [];
        context.document = {getElementById: () => ({innerHTML: "", checked: false})};
        context.UserPreferences = {readFromLocalStorage: () => ({
            overwriteExistingEpub: {value: false}, noDownloadPopup: {value: false}
        })};
        context.chrome.storage.local.remove = (keys, callback) => {
            events.push("clear");
            delete values[keys[0]];
            callback();
        };
        context.Download = {save: async blob => {
            events.push("download:" + blob);
            if (firstKind === "download") {
                await new Promise(resolve => { release = resolve; context.started(); });
            }
        }};
        context.merge = async previous => {
            events.push("merge:" + previous);
            if (firstKind === "merge") {
                await new Promise(resolve => { release = resolve; context.started(); });
            }
            values.LibEpub7 = previous + "+new";
            values.LibNewChapterCount7 = "3";
        };
        vm.runInContext('Library.LibConvertDataUrlToBlob = async value => value; Library.LibMergeEpub = merge; Library.LibGetSourceChapterList = async () => null; Library.LibShowLoadingText = () => {}; Library.userPreferences = {readingList: {addEpub: () => {}}}', context);
        let download = () => vm.runInContext('Library.LibDownload({dataset: {libepubid: "7"}})', context);
        let merge = () => mergeKind === "manual"
            ? vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "7"}, files: ["new"]})', context)
            : vm.runInContext('new Library().LibAddToLibrary("new", "book.epub", "url", false, false)', context);
        let first = firstKind === "download" ? download() : merge();
        await started;
        let second = firstKind === "download" ? merge() : download();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(events, [firstKind === "download" ? "download:old" : "merge:old"]);
        release();
        await Promise.all([first, second]);
        if (firstKind === "download") {
            assert.deepEqual(events, ["download:old", "clear", "merge:old"]);
            assert.equal(values.LibNewChapterCount7, "3");
        } else {
            assert.deepEqual(events, ["merge:old", "download:old+new", "clear"]);
            assert.equal(values.LibNewChapterCount7, undefined);
        }
        assert.equal(vm.runInContext("Library.bookQueues.size", context), 0);
    });
}

test("a failed download releases the book queue for a later merge", async () => {
    let values = {LibEpub7: "old", LibFilename7: "Title", LibStoryURL7: "url"};
    let {context} = createLibraryContext(values);
    let release;
    let started = new Promise(resolve => { context.started = resolve; });
    context.UserPreferences = {readFromLocalStorage: () => ({
        overwriteExistingEpub: {value: false}, noDownloadPopup: {value: false}
    })};
    context.Download = {save: async () => {
        await new Promise(resolve => { release = resolve; context.started(); });
        throw new Error("Download failed");
    }};
    context.merge = async previous => { values.LibEpub7 = previous + "+new"; };
    vm.runInContext('Library.LibConvertDataUrlToBlob = async value => value; Library.LibMergeEpub = merge; Library.LibGetSourceChapterList = async () => null', context);
    let download = vm.runInContext('Library.LibDownload({dataset: {libepubid: "7"}})', context);
    await started;
    let merge = vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "7"}, files: ["new"]})', context);
    release();
    await assert.rejects(download, /Download failed/);
    await merge;
    assert.equal(values.LibEpub7, "old+new");
    assert.equal(vm.runInContext("Library.bookQueues.size", context), 0);
});

test("a pending download does not block a merge of a different book", async () => {
    let values = {LibEpub7: "old7", LibFilename7: "Title", LibEpub8: "old8", LibStoryURL8: "url"};
    let {context} = createLibraryContext(values);
    let release;
    let started = new Promise(resolve => { context.started = resolve; });
    context.document = {getElementById: () => ({innerHTML: ""})};
    context.UserPreferences = {readFromLocalStorage: () => ({
        overwriteExistingEpub: {value: false}, noDownloadPopup: {value: false}
    })};
    context.chrome.storage.local.remove = (keys, callback) => callback();
    context.Download = {save: async () => new Promise(resolve => { release = resolve; context.started(); })};
    context.merge = async previous => { values.LibEpub8 = previous + "+new"; };
    vm.runInContext('Library.LibConvertDataUrlToBlob = async value => value; Library.LibMergeEpub = merge; Library.LibGetSourceChapterList = async () => null', context);
    let download = vm.runInContext('Library.LibDownload({dataset: {libepubid: "7"}})', context);
    await started;
    await vm.runInContext('Library.LibMergeUpload({dataset: {libepubid: "8"}, files: ["new"]})', context);
    assert.equal(values.LibEpub8, "old8+new");
    release();
    await download;
    assert.equal(vm.runInContext("Library.bookQueues.size", context), 0);
});

test("library download reports marker removal failure and keeps the displayed count", async () => {
    let {context, runtime} = createLibraryContext({LibFilename7: "Title"});
    let count = {innerHTML: "2"};
    context.chrome.storage.local.remove = (keys, callback) => {
        runtime.lastError = {message: "Storage unavailable"};
        callback();
        runtime.lastError = null;
    };
    context.document = {getElementById: () => count};
    context.UserPreferences = {readFromLocalStorage: () => ({
        overwriteExistingEpub: {value: false}, noDownloadPopup: {value: false}
    })};
    context.Download = {save: async () => "saved"};
    vm.runInContext('Library.epubStorage = {get: async () => "data"}; Library.LibConvertDataUrlToBlob = async value => value', context);
    await assert.rejects(vm.runInContext('Library.LibDownload({dataset: {libepubid: "7"}})', context), /download request returned.*marker could not be cleared.*Storage unavailable/);
    assert.equal(count.innerHTML, "2");
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

test("download stops before requesting a file or clearing its marker when filename storage fails", async () => {
    let {context, runtime} = createLibraryContext();
    let downloads = 0;
    let removals = 0;
    context.chrome.storage.local.get = (key, callback) => {
        runtime.lastError = {message: "Filename unavailable"};
        callback({});
        runtime.lastError = null;
    };
    context.chrome.storage.local.remove = () => { removals++; };
    context.Download = {save: async () => { downloads++; }};
    vm.runInContext('Library.epubStorage = {get: async () => "epub"}', context);
    await assert.rejects(vm.runInContext('Library.LibDownload({dataset: {libepubid: "7"}})', context), /Filename unavailable/);
    assert.equal(downloads, 0);
    assert.equal(removals, 0);
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

for (let failMetadata of [false, true]) {
    test(`metadata edit ${failMetadata ? "reports storage errors without saving" : "preserves story URL and filename"}`, async () => {
        let {context, runtime} = createLibraryContext({LibStoryURL7: "url", LibFilename7: "title"});
        let errors = [];
        let writes = [];
        let storageGet = context.chrome.storage.local.get;
        context.chrome.storage.local.get = (keys, callback) => {
            if (failMetadata && Array.isArray(keys) && keys.includes("LibStoryURL7")) {
                runtime.lastError = {message: "Metadata unavailable"};
                callback({});
                runtime.lastError = null;
                return;
            }
            storageGet(keys, callback);
        };
        context.document = {getElementById: () => ({value: ""})};
        context.ErrorLog = {showErrorMessage: error => errors.push(error.message)};
        context.EpubPacker = class { getDateForMetaData() { return "date"; } };
        context.save = (...args) => { writes.push(args); };
        context.zip = {
            Data64URIReader: class {},
            BlobReader: class {},
            BlobWriter: class {},
            TextReader: class {},
            TextWriter: class {},
            ZipReader: class {
                async getEntries() {
                    return [{filename: "OEBPS/content.opf", directory: false,
                        getData: async () => "<dc:title>old</dc:title><dc:creator>old</dc:creator>"}];
                }
            },
            ZipWriter: class { add() {} async close() { return "edited"; } }
        };
        vm.runInContext('Library.LibShowLoadingText = () => {}; Library.epubStorage = {get: async () => "epub"}; Library.LibHandleUpdate = save', context);
        await vm.runInContext('Library.LibSaveMetadataChange({dataset: {libepubid: "7"}})', context);
        if (failMetadata) {
            assert.deepEqual(errors, ["Metadata unavailable"]);
            assert.deepEqual(writes, []);
        } else {
            assert.deepEqual(errors, []);
            assert.deepEqual(writes, [[-1, "edited", "url", "title", "7"]]);
        }
    });
}

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

test("library lock toggles persist and expose pressed state", async () => {
    let values = {LibLocked7: false};
    let {context} = createLibraryContext(values);
    context.chrome.storage.local.set = (items, callback) => { Object.assign(values, items); callback(); };
    let button = {dataset: {libepubid: "7"}, textContent: "Lock", setAttribute(name, value) { this[name] = value; }};
    context.button = button;
    await vm.runInContext("Library.LibToggleLock(button)", context);
    assert.equal(values.LibLocked7, true);
    assert.equal(button.textContent, "Unlock");
    assert.equal(button["aria-pressed"], "true");
    await vm.runInContext("Library.LibToggleLock(button)", context);
    assert.equal(values.LibLocked7, false);
    assert.equal(button.textContent, "Lock");
    assert.equal(button["aria-pressed"], "false");
});

test("update all skips locked books", async () => {
    let values = {LibArray: [7, 8], LibLocked7: true, LibLocked8: false,
        LibStoryURL7: "locked", LibStoryURL8: "unlocked"};
    let {context} = createLibraryContext(values);
    let urls = [];
    let startingUrl = {value: ""};
    context.document = {getElementById: id => id === "libupdateall"
        ? {disabled: false}
        : id === "startingUrlInput"
            ? startingUrl
            : {innerHTML: "", value: "", checked: false}};
    startingUrl.value = "";
    context.main = {
        resetUI() {},
        onLoadAndAnalyseButtonClick: async function() { urls.push(startingUrl.value); },
        fetchContentAndPackEpub: async function() {},
        getCurrentParser: () => ({rateLimitDelay: async () => {}})
    };
    context.ErrorLog = {SuppressErrorLog: false, showErrorMessage() {}};
    await vm.runInContext("Library.Libupdateall()", context);
    assert.deepEqual(urls, ["unlocked"]);
});

test("chapter preview reports unchanged and appended chapters without mutation", async () => {
    let {context} = createLibraryContext();
    let unchanged = await vm.runInContext('Library.LibPreviewChapterDelta(["one", "two"], ["one", "two"])', context);
    assert.equal(unchanged.unchanged, true);
    assert.deepEqual(Array.from(unchanged.appended), []);
    assert.equal(unchanged.ambiguous, false);
    let appended = await vm.runInContext('Library.LibPreviewChapterDelta(["one", "two"], ["one", "two", "three"])', context);
    assert.equal(appended.unchanged, false);
    assert.deepEqual(Array.from(appended.appended), ["three"]);
    assert.equal(appended.ambiguous, false);
});

test("chapter preview flags removed and reordered chapters as ambiguous", async () => {
    let {context} = createLibraryContext();
    let removed = await vm.runInContext('Library.LibPreviewChapterDelta(["one", "two"], ["one"])', context);
    assert.deepEqual(Array.from(removed.removed), ["two"]);
    assert.equal(removed.ambiguous, true);
    let reordered = await vm.runInContext('Library.LibPreviewChapterDelta(["one", "two"], ["two", "one"])', context);
    assert.equal(reordered.reordered, true);
    assert.equal(reordered.ambiguous, true);
});

test("chapter preview rejects invalid chapter lists", async () => {
    let {context} = createLibraryContext();
    assert.throws(() => vm.runInContext('Library.LibPreviewChapterDelta(["one"], [7])', context), /URL lists/);
});

test("shelf sorting orders title and new-chapter views without changing manual order", async () => {
    let {context} = createLibraryContext();
    let items = [
        {title: "Zulu", count: 1},
        {title: "Alpha", count: 3},
        {title: "Beta", count: 2}
    ];
    context.items = items;
    let manual = await vm.runInContext('Library.LibSortShelfItems(items, "manual")', context);
    let titles = await vm.runInContext('Library.LibSortShelfItems(items, "title")', context);
    let newest = await vm.runInContext('Library.LibSortShelfItems(items, "new")', context);
    context.items = items;
    assert.deepEqual(Array.from(manual), items);
    assert.deepEqual(Array.from(titles).map(item => item.title), ["Alpha", "Beta", "Zulu"]);
    assert.deepEqual(Array.from(newest).map(item => item.title), ["Alpha", "Beta", "Zulu"]);
});

test("shelf drag reorder moves IDs and persists the new order", async () => {
    let values = {LibArray: ["7", "8", "9"]};
    let {context} = createLibraryContext(values);
    context.chrome.storage.local.set = (items, callback) => { Object.assign(values, items); callback(); };
    vm.runInContext("Library.LibRenderSavedEpubs = async () => {}", context);
    await vm.runInContext('Library.LibMoveShelfBook("7", "9")', context);
    assert.deepEqual(values.LibArray, ["8", "9", "7"]);
});
