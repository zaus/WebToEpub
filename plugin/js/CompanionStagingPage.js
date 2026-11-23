"use strict";

const form = document.getElementById("stagingForm");
const bookSelect = document.getElementById("book");
const status = document.getElementById("status");
const submit = document.getElementById("stage");

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

loadBooks().catch(error => {
    status.textContent = "Unable to load the browser library: " + error.message;
});
