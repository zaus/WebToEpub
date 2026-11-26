"use strict";

class ExternalProviderDiscovery { // eslint-disable-line no-unused-vars
    static async discover(baseUrl, token, expectedInstanceId = null) {
        let url;
        try {
            url = new URL(baseUrl);
        } catch {
            throw new Error("Enter a valid external provider URL.");
        }
        let isLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
        if ((url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
            url.username || url.password || url.search || url.hash) {
            throw new Error("Use HTTPS or a loopback HTTP provider URL without credentials, query, or fragment.");
        }
        if (typeof token !== "string" || !token || /[\r\n]/.test(token)) {
            throw new Error("Enter a valid provider token.");
        }
        url.pathname = url.pathname.replace(/\/?$/, "/") + "v1/provider";
        let response = await fetch(url.href, {
            method: "GET",
            credentials: "omit",
            redirect: "error",
            headers: {authorization: "Bearer " + token}
        });
        if (!response.ok) {
            throw new Error("Provider discovery failed (HTTP " + response.status + ").");
        }
        let provider = await response.json();
        if (!provider || typeof provider.instanceId !== "string" || !provider.instanceId ||
            !Array.isArray(provider.apiVersions) || !Array.isArray(provider.capabilities) ||
            !provider.capabilities.every(capability => typeof capability === "string") ||
            !Number.isSafeInteger(provider.maxEpubBytes) || provider.maxEpubBytes <= 0) {
            throw new Error("Provider discovery returned an invalid response.");
        }
        if (expectedInstanceId !== null && provider.instanceId !== expectedInstanceId) {
            throw new Error("The provider instance does not match the saved library provider.");
        }
        if (!provider.apiVersions.includes(1)) {
            throw new Error("The provider does not support API version 1.");
        }
        let required = ["load", "prepare-save", "commit-save", "inspect-operation", "abort-save", "delete", "acknowledge"];
        let missing = required.filter(capability => !provider.capabilities.includes(capability));
        if (missing.length) {
            throw new Error("The provider is missing required storage capabilities: " + missing.join(", ") + ".");
        }
        return provider;
    }
}
