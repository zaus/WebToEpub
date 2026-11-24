"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createContext(initial = {}) {
    let values = new Map(Object.entries(initial));
    let checkbox = {checked: false};
    let context = vm.createContext({
        window: {localStorage: {
            getItem: key => values.has(key) ? values.get(key) : null,
            setItem: (key, value) => values.set(key, String(value)),
            removeItem: key => values.delete(key)
        }},
        document: {getElementById: id => id === "themeColorTag"
            ? {addEventListener() {}}
            : checkbox},
        ReadingList: class { readFromLocalStorage() {} },
        EpubMetaInfo: {getDefaultStyleSheet: () => ""}
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "plugin", "js", "UserPreferences.js"), "utf8"), context);
    return {context, checkbox, values};
}

test("full-title filenames default to enabled when no preference is saved", () => {
    let {context, checkbox} = createContext();
    vm.runInContext("var preferences = UserPreferences.readFromLocalStorage(); preferences.useFullTitle.writeToUi()", context);
    assert.equal(vm.runInContext("preferences.useFullTitle.value", context), true);
    assert.equal(checkbox.checked, true);
});

for (let choice of [false, true]) {
    test(`saved full-title filename preference ${choice} is preserved`, () => {
        let {context, checkbox} = createContext({useFullTitle: String(choice)});
        vm.runInContext("var preferences = UserPreferences.readFromLocalStorage(); preferences.useFullTitle.writeToUi()", context);
        assert.equal(vm.runInContext("preferences.useFullTitle.value", context), choice);
        assert.equal(checkbox.checked, choice);
    });
}

test("changing the checkbox persists the chosen full-title setting", () => {
    let {context, checkbox, values} = createContext();
    vm.runInContext("var preferences = UserPreferences.readFromLocalStorage()", context);
    checkbox.checked = false;
    vm.runInContext("preferences.useFullTitle.readFromUi(); preferences.useFullTitle.writeToLocalStorage()", context);
    assert.equal(values.get("useFullTitle"), "false");
    assert.equal(vm.runInContext("UserPreferences.readFromLocalStorage().useFullTitle.value", context), false);
});

test("options export is JSON and imports preserve settings from JSON and legacy text files", async () => {
    let {context, values} = createContext();
    let saved;
    let errors = [];
    context.Blob = Blob;
    context.DefaultParserSiteSettings = {storageName: "siteSettings"};
    context.ErrorLog = {showErrorMessage: error => errors.push(error)};
    context.Download = {save: async (blob, name) => { saved = {blob, name}; }};
    context.FileReader = class {
        readAsText(file) {
            file.text().then(content => this.onload({target: {result: content}}));
        }
    };
    vm.runInContext(`
        ReadingList.storageName = "readingList";
        ReadingList.prototype.toJson = () => JSON.stringify({epubs: []});
        ReadingList.prototype.setEpub = () => {};
        var preferences = UserPreferences.readFromLocalStorage();
        preferences.useFullTitle.value = false;
        preferences.noDownloadPopup.value = true;
    `, context);
    await vm.runInContext("preferences.writeToFile()", context);
    assert.equal(saved.name, "Options.json");
    assert.equal(saved.blob.type, "application/json");
    let serialized = await saved.blob.text();
    assert.equal(JSON.parse(serialized).useFullTitle, false);
    assert.equal(JSON.parse(serialized).noDownloadPopup, true);

    for (let name of ["Options.json", "Options.txt"]) {
        vm.runInContext("preferences.useFullTitle.value = true; preferences.noDownloadPopup.value = false", context);
        let file = Object.assign(new Blob([serialized], {type: name.endsWith(".json") ? "application/json" : "text/plain"}), {name});
        let event = {target: {files: [file], value: name}};
        await new Promise(resolve => {
            context.event = event;
            context.populateControls = resolve;
            vm.runInContext("preferences.readFromFile(event, populateControls)", context);
        });
        assert.equal(vm.runInContext("preferences.useFullTitle.value", context), false);
        assert.equal(vm.runInContext("preferences.noDownloadPopup.value", context), true);
        assert.equal(values.get("useFullTitle"), "false");
        assert.equal(event.target.value, null);
    }
    assert.deepEqual(errors, []);
});

test("invalid options JSON reports an error without changing saved preferences", async () => {
    let {context, values} = createContext({useFullTitle: "false"});
    let reported;
    context.FileReader = class {
        readAsText() { this.onload({target: {result: "{invalid"}}); }
    };
    context.ErrorLog = {showErrorMessage: error => { reported = error; }};
    context.populateControls = () => { throw new Error("Controls must not be updated"); };
    context.event = {target: {files: [{name: "Options.txt"}], value: "Options.txt"}};
    vm.runInContext("var preferences = UserPreferences.readFromLocalStorage(); preferences.readFromFile(event, populateControls)", context);
    assert.equal(reported.name, "SyntaxError");
    assert.equal(values.get("useFullTitle"), "false");
    assert.equal(context.event.target.value, null);
});
