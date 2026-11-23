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
    assert.deepEqual(calls, []);
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

function setupExport(context) {
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
    vm.runInContext('Library.LibShowLoadingText = () => {}; Library.LibRenderSavedEpubs = () => {}; Library.LibGetStorageIDs = async () => [7]; Library.LibGetFromStorageArray = async () => ({LibStoryURL7: "url"})', context);
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
