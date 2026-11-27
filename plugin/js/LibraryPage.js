"use strict";

class LibraryPage {
    constructor() {
        this.shelf = document.getElementById("libraryShelf");
        this.status = document.getElementById("libraryStatus");
        this.sort = document.getElementById("librarySort");
        this.dialog = document.getElementById("libraryMetadataDialog");
        this.metadataContent = document.getElementById("libraryMetadataContent");
        this.draggedId = null;
        this.externalStorage = null;
        this.applyTheme();
        this.read("themeColor").then(items => {
            let theme = items.themeColor || "";
            document.documentElement.dataset.libraryTheme = theme === "LightMode"
                ? "light"
                : theme === "DarkMode" ? "dark" : "";
        }).catch(() => {});
        this.read("ExternalEpubStorage").then(items => {
            if (items.ExternalEpubStorage?.enabled) {
                this.externalStorage = new ExternalEpubStorage();
            }
        }).catch(() => {});
    }

    applyTheme() {
        let autoDark = document.getElementById("autoDark");
        let alwaysDark = document.getElementById("alwaysDark");
        if (autoDark) {
            autoDark.disabled = false;
        }
        if (alwaysDark) {
            alwaysDark.disabled = true;
        }
        this.read("themeColor").then(items => {
            let theme = items.themeColor || "";
            let autoDark = document.getElementById("autoDark");
            let alwaysDark = document.getElementById("alwaysDark");
            if (autoDark) {
                autoDark.disabled = theme !== "";
            }
            if (alwaysDark) {
                alwaysDark.disabled = theme !== "DarkMode";
            }
            document.documentElement.dataset.libraryTheme = theme === "LightMode"
                ? "light"
                : theme === "DarkMode" ? "dark" : "";
        }).catch(() => {});
    }

    read(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(keys, items => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(items);
            });
        });
    }

    write(items) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(items, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }

    remove(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.remove(keys, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }

    async load() {
        let items = await this.read(null);
        let ids = Array.isArray(items.LibArray)
            ? items.LibArray.map(String)
            : Object.keys(items)
                .filter(key => key.startsWith("LibEpub"))
                .map(key => key.slice("LibEpub".length));
        let books = ids.map(id => ({
            id,
            title: items["LibFilename" + id] || "Book " + id,
            url: items["LibStoryURL" + id] || "",
            cover: items["LibCover" + id] || "",
            count: parseInt(items["LibNewChapterCount" + id] || "0", 10),
            locked: items["LibLocked" + id] === true
        }));
        if (this.sort.value === "title") {
            books.sort((a, b) => a.title.localeCompare(b.title));
        } else if (this.sort.value === "new") {
            books.sort((a, b) => b.count - a.count);
        }
        this.status.textContent = books.length === 1
            ? "1 book"
            : books.length + " books";
        this.render(books);
    }

    render(books) {
        this.shelf.replaceChildren();
        for (let book of books) {
            let card = document.createElement("article");
            card.className = "libraryCard";
            card.dataset.bookId = book.id;
            card.draggable = this.sort.value === "manual";

            let coverButton = document.createElement("button");
            coverButton.type = "button";
            coverButton.className = "libraryCoverButton";
            coverButton.setAttribute("aria-label", "View metadata for " + book.title);
            let cover = document.createElement("img");
            cover.alt = book.title + " cover";
            cover.src = book.cover;
            coverButton.appendChild(cover);
            coverButton.addEventListener("click", () => this.showMetadata(book));

            let body = document.createElement("div");
            body.className = "libraryCardBody";
            let title = document.createElement("h2");
            title.className = "libraryTitle";
            title.title = book.title;
            title.textContent = book.title;
            let count = document.createElement("p");
            count.className = "libraryCount";
            count.textContent = book.count > 0 ? book.count + " new chapters" : "";

            let actions = document.createElement("div");
            actions.className = "libraryActions";
            actions.appendChild(this.actionButton("Download", () => this.download(book)));
            actions.appendChild(this.actionButton(book.locked ? "Unlock" : "Lock", async () => {
                await this.write({["LibLocked" + book.id]: !book.locked});
                await this.load();
            }, book.locked));
            actions.appendChild(this.actionButton("Metadata", () => this.showMetadata(book)));
            actions.appendChild(this.actionButton("Delete", async () => {
                if (!window.confirm("Delete " + book.title + " from the library?")) {
                    return;
                }
                await this.deleteBook(book);
            }));

            body.append(title, count, actions);
            card.append(coverButton, body);
            card.addEventListener("dragstart", event => {
                this.draggedId = book.id;
                card.classList.add("dragging");
                event.dataTransfer.effectAllowed = "move";
            });
            card.addEventListener("dragend", () => card.classList.remove("dragging"));
            card.addEventListener("dragover", event => {
                if (this.sort.value === "manual") {
                    event.preventDefault();
                }
            });
            card.addEventListener("drop", event => {
                event.preventDefault();
                if (this.sort.value === "manual" && this.draggedId) {
                    this.move(this.draggedId, book.id).catch(error => this.showError(error));
                }
            });
            this.shelf.appendChild(card);
        }
    }

    actionButton(label, handler, pressed = false) {
        let button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        if (pressed) {
            button.setAttribute("aria-pressed", "true");
        }
        button.addEventListener("click", () => Promise.resolve(handler(button)).catch(error => this.showError(error)));
        return button;
    }

    showMetadata(book) {
        let rows = [
            ["Title", book.title],
            ["Story URL", book.url || "Not set"],
            ["New chapters", String(book.count)],
            ["Locked", book.locked ? "Yes" : "No"]
        ];
        this.metadataContent.replaceChildren();
        for (let [label, value] of rows) {
            let term = document.createElement("dt");
            term.textContent = label;
            let description = document.createElement("dd");
            description.textContent = value;
            this.metadataContent.append(term, description);
        }
        this.dialog.showModal();
    }

    async move(fromId, toId) {
        if (fromId === toId) {
            return;
        }
        let items = await this.read("LibArray");
        let ids = Array.isArray(items.LibArray) ? items.LibArray.map(String) : [];
        let from = ids.indexOf(String(fromId));
        let to = ids.indexOf(String(toId));
        if (from < 0 || to < 0) {
            return;
        }
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        await this.write({LibArray: ids});
        await this.load();
    }

    async deleteBook(book) {
        let items = await this.read("LibArray");
        let ids = Array.isArray(items.LibArray) ? items.LibArray.map(String) : [];
        if (this.externalStorage) {
            await this.externalStorage.remove(book.id);
        }
        await this.write({LibArray: ids.filter(id => id !== book.id)});
        await this.remove([
            "LibEpub" + book.id,
            "LibStoryURL" + book.id,
            "LibFilename" + book.id,
            "LibCover" + book.id,
            "LibNewChapterCount" + book.id,
            "LibLocked" + book.id
        ]);
        await this.load();
    }

    async download(book) {
        let epub;
        if (this.externalStorage) {
            epub = await this.externalStorage.get(book.id);
        } else {
            let items = await this.read("LibEpub" + book.id);
            epub = items["LibEpub" + book.id];
        }
        if (!epub) {
            throw new Error("EPUB not found in browser storage.");
        }
        let base64 = epub.startsWith("data:application/epub+zip;base64,")
            ? epub.slice("data:application/epub+zip;base64,".length)
            : epub;
        let binary = atob(base64);
        let bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        let blob = new Blob([bytes], {type: "application/epub+zip"});
        let url = URL.createObjectURL(blob);
        let link = document.createElement("a");
        link.href = url;
        link.download = (book.title || "Book") + ".epub";
        link.click();
        URL.revokeObjectURL(url);
    }

    showError(error) {
        this.status.textContent = "Library action failed: " + error.message;
    }
}

let libraryPage = new LibraryPage();
document.getElementById("libraryMetadataClose").addEventListener("click", () => libraryPage.dialog.close());
document.getElementById("librarySort").addEventListener("change", () => libraryPage.load().catch(error => libraryPage.showError(error)));
libraryPage.load().catch(error => libraryPage.showError(error));
