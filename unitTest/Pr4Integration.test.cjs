"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("popup packages Royal Road acquisition and the external EPUB adapter", () => {
    let popup = fs.readFileSync(path.join(__dirname, "..", "plugin", "popup.html"), "utf8");
    assert.match(popup, /js\/parsers\/RoyalRoadParser\.js/);
    assert.match(popup, /js\/ExternalEpubStorage\.js/);
    assert.match(popup, /js\/Library\.js/);
});

test("selected Royal Road URL shape is retained for parser lookup", () => {
    let source = "https://royalroad.com/fiction/39408/beware-of-chicken";
    let url = new URL(source);
    assert.equal(url.hostname, "royalroad.com");
    assert.equal(url.pathname, "/fiction/39408/beware-of-chicken");
});

test("popup uses in-page acquisition and library tabs", () => {
    let popup = fs.readFileSync(path.join(__dirname, "..", "plugin", "popup.html"), "utf8");
    let main = fs.readFileSync(path.join(__dirname, "..", "plugin", "js", "main.js"), "utf8");
    let manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "plugin", "manifest.json"), "utf8"));
    assert.match(popup, /id="mainViewTabs"/);
    assert.match(popup, /id="acquisitionViewTab"/);
    assert.match(popup, /id="libraryViewTab"/);
    assert.match(main, /switchMainView/);
    assert.doesNotMatch(main, /chrome\.tabs\.create\(\{\s*url:\s*chrome\.runtime\.getURL\("library\.html"\)/);
    assert.equal(manifest.version, "1.0.14.78");
});
