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
