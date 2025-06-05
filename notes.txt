# bip39-wallet-html-js-IndexedDB



Storage Mechanism

- Replace localStorage with IndexedDB

Why?
localStorage is synchronous, has limited storage capacity, and is vulnerable to cross-site scripting (XSS) attacks, making it unsuitable for storing sensitive data like encrypted mnemonics in a production app. IndexedDB, on the other hand, is asynchronous, supports larger data sizes, and provides a more secure storage mechanism within the browser context of an Electron app.
