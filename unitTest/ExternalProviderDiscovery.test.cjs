"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function contextFor(response) {
    let requests = [];
    let context = vm.createContext({URL, fetch: async (url, options) => {
        requests.push({url, options});
        return response;
    }});
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "plugin", "js", "ExternalProviderDiscovery.js"), "utf8"), context);
    return {context, requests};
}

function provider(overrides = {}) {
    return {
        instanceId: "provider-1", apiVersions: [1], maxEpubBytes: 100,
        capabilities: ["load", "prepare-save", "commit-save", "inspect-operation", "abort-save", "delete", "acknowledge"],
        ...overrides
    };
}

test("discovers a compatible provider with authenticated, non-redirecting request", async () => {
    let {context, requests} = contextFor({ok: true, json: async () => provider()});
    let result = await vm.runInContext('ExternalProviderDiscovery.discover("http://127.0.0.1:8765", "token", "provider-1")', context);
    assert.equal(result.instanceId, "provider-1");
    assert.equal(requests[0].url, "http://127.0.0.1:8765/v1/provider");
    assert.equal(requests[0].options.redirect, "error");
    assert.equal(requests[0].options.credentials, "omit");
    assert.equal(requests[0].options.headers.authorization, "Bearer token");
});

for (let [description, response, expected] of [
    ["empty capabilities", provider({capabilities: []}), /missing required storage capabilities/],
    ["unsupported version", provider({apiVersions: [2]}), /does not support API version 1/],
    ["invalid capabilities", provider({capabilities: [null]}), /invalid response/],
    ["missing identity", provider({instanceId: ""}), /invalid response/],
    ["invalid limit", provider({maxEpubBytes: 0}), /invalid response/],
    ["changed identity", provider({instanceId: "other"}), /does not match/]
]) {
    test(`rejects ${description}`, async () => {
        let {context} = contextFor({ok: true, json: async () => response});
        await assert.rejects(vm.runInContext('ExternalProviderDiscovery.discover("http://127.0.0.1:8765", "token", "provider-1")', context), expected);
    });
}

test("rejects unsafe URLs and tokens before sending credentials", async () => {
    let {context, requests} = contextFor({});
    for (let url of ["http://example.test", "https://user:pass@example.test", "https://example.test/?x=1", "file:///test", "not a url"]) {
        context.baseUrl = url;
        await assert.rejects(vm.runInContext('ExternalProviderDiscovery.discover(baseUrl, "token")', context));
    }
    await assert.rejects(vm.runInContext('ExternalProviderDiscovery.discover("http://127.0.0.1", "bad\\ntoken")', context));
    assert.equal(requests.length, 0);
});

test("surfaces authentication and network failures without a fallback", async () => {
    let {context, requests} = contextFor({ok: false, status: 401});
    await assert.rejects(vm.runInContext('ExternalProviderDiscovery.discover("https://example.test/backend", "token")', context), /HTTP 401/);
    assert.equal(requests[0].url, "https://example.test/backend/v1/provider");
    context.fetch = async () => { throw new Error("Connection failed"); };
    await assert.rejects(vm.runInContext('ExternalProviderDiscovery.discover("http://127.0.0.1", "token")', context), /Connection failed/);
});
