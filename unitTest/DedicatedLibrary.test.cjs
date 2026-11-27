"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("dedicated library page and stylesheet are packaged by popup", () => {
    let popup = fs.readFileSync(path.join(__dirname, "..", "plugin", "popup.html"), "utf8");
    let manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "plugin", "manifest.json"), "utf8"));
    let library = fs.readFileSync(path.join(__dirname, "..", "plugin", "library.html"), "utf8");
    let css = fs.readFileSync(path.join(__dirname, "..", "plugin", "css", "library.css"), "utf8");
    let script = fs.readFileSync(path.join(__dirname, "..", "plugin", "js", "LibraryPage.js"), "utf8");
    assert.equal(manifest.version, "1.0.14.76");
    assert.match(popup, /Library/);
    assert.match(library, /id="libraryShelf"/);
    assert.match(library, /js\/LibraryPage\.js/);
    assert.match(css, /grid-template-columns/);
    assert.match(css, /data-library-theme="light"/);
    assert.match(css, /data-library-theme="dark"/);
    assert.match(script, /themeColor/);
    assert.match(script, /draggedId/);
});
