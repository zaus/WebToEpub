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
            setItem: (key, value) => values.set(key, String(value))
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
