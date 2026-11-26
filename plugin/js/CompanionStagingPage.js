"use strict";

const form = document.getElementById("stagingForm");
const bookSelect = document.getElementById("book");
const status = document.getElementById("status");
const submit = document.getElementById("stage");
const enableExternal = document.getElementById("enableExternal");

async function loadBooks() {
    let books = await CompanionStagingClient.listBooks();
    for (let book of books) {
        let option = document.createElement("option");
        option.value = book.id;
        option.textContent = book.title;
        bookSelect.appendChild(option);
    }
    if (books.length === 0) {
        status.textContent = "The browser library is empty.";
    } else {
        submit.disabled = false;
        enableExternal.disabled = false;
        status.textContent = "Select a book and enter the companion token.";
    }
}

form.addEventListener("submit", async event => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "Sending a copy for staging...";
    try {
        let result = await CompanionStagingClient.stage(bookSelect.value,
            document.getElementById("port").value, document.getElementById("token").value);
        status.textContent = "Staged copy " + result.id + " (" + result.bytes +
            " bytes). It was not committed to a library.";
    } catch (error) {
        status.textContent = "Staging failed or its outcome is uncertain: " + error.message +
            " A retry may create another staged copy.";
    } finally {
        submit.disabled = false;
    }
});

enableExternal.addEventListener("click", async () => {
    enableExternal.disabled = true;
    status.textContent = "Discovering companion...";
    try {
        let port = document.getElementById("port").value;
        let token = document.getElementById("token").value;
        let baseUrl = "http://127.0.0.1:" + port;
        let provider = await ExternalProviderDiscovery.discover(baseUrl, token);
        await new Promise((resolve, reject) => {
            chrome.storage.local.set({ExternalEpubStorage: {
                enabled: true, url: baseUrl, token: token, instanceId: provider.instanceId
            }}, () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve());
        });
        status.textContent = "Companion EPUB storage enabled. Reload the extension before using the library.";
    } catch (error) {
        status.textContent = "Companion storage was not enabled: " + error.message;
    } finally {
        enableExternal.disabled = false;
    }
});

loadBooks().catch(error => {
    status.textContent = "Unable to load the browser library: " + error.message;
});
