// renderer.js

// Helper functions for converting between Uint8Array and hex strings
function bufferToHex(buffer) {
    return Array.from(buffer)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function hexToBuffer(hex) {
    return Uint8Array.from(hex.match(/.{2}/g), byte => parseInt(byte, 16));
}

// IndexedDB setup
const dbName = 'walletDB';
const storeName = 'mnemonics';
let db;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            db.createObjectStore(storeName, { keyPath: 'id' });
        };
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

async function saveToDB(id, data) {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    await store.put({ id, ...data });
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject(event.target.error);
    });
}

async function loadFromDB(id) {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(id);
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

// Define window.electronAPI
window.electronAPI = {
    saveMnemonic: async (mnemonic, password) => {
        if (!mnemonic || !password) {
            throw new Error('Mnemonic and password are required.');
        }

        // Generate random salt and IV
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12)); // AES-GCM uses 12-byte IV
        const passwordBuffer = new TextEncoder().encode(password);
        const mnemonicBuffer = new TextEncoder().encode(mnemonic);

        // Derive encryption key using PBKDF2
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 200000, // Increased for better security
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );

        // Encrypt the mnemonic using AES-GCM
        const encryptedBuffer = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv,
                tagLength: 128 // Authentication tag length
            },
            key,
            mnemonicBuffer
        );

        // Store encrypted data in IndexedDB
        const saltHex = bufferToHex(salt);
        const ivHex = bufferToHex(iv);
        const encryptedHex = bufferToHex(new Uint8Array(encryptedBuffer));
        await saveToDB('mnemonic', { salt: saltHex, iv: ivHex, encrypted: encryptedHex });

        return 'Saved successfully.';
    },

    loadMnemonic: async (password) => {
        if (!password) {
            throw new Error('Password is required.');
        }

        // Retrieve stored data from IndexedDB
        const data = await loadFromDB('mnemonic');
        if (!data) {
            throw new Error('No saved data found.');
        }

        // Convert hex strings back to buffers
        const salt = hexToBuffer(data.salt);
        const iv = hexToBuffer(data.iv);
        const encrypted = hexToBuffer(data.encrypted);
        const passwordBuffer = new TextEncoder().encode(password);

        // Derive decryption key using PBKDF2
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 200000, // Match the increased iterations
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        // Decrypt the mnemonic
        try {
            const decryptedBuffer = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv,
                    tagLength: 128
                },
                key,
                encrypted
            );
            return new TextDecoder().decode(decryptedBuffer);
        } catch (err) {
            throw new Error('Failed to load: incorrect password or corrupted data.');
        }
    }
};

// Initialize IndexedDB
openDB()
    .then(() => console.log('IndexedDB initialized'))
    .catch((error) => console.error('Failed to initialize IndexedDB:', error));

// Existing event listeners
document.getElementById('save').addEventListener('click', async (event) => {
    event.preventDefault();
    const mnemonic = document.getElementById('phrase').value.trim();
    const password = document.getElementById('password').value;
    const status = document.getElementById('status');

    try {
        const result = await window.electronAPI.saveMnemonic(mnemonic, password);
        status.textContent = result;
    } catch (err) {
        status.textContent = err.message;
    }
});

document.getElementById('load').addEventListener('click', async (event) => {
    event.preventDefault();
    const password = document.getElementById('password').value;
    const status = document.getElementById('status');
    const phrase = document.getElementById('phrase');

    try {
        const mnemonic = await window.electronAPI.loadMnemonic(password);
        phrase.value = mnemonic;
        status.textContent = 'Loaded successfully.';
    } catch (err) {
        status.textContent = err.message;
    }
});

function loadBalances() {
    const rows = document.querySelectorAll('table tbody.addresses.monospace tr');

    rows.forEach(row => {
        const addressSpan = row.querySelector('.address a span');
        if (!addressSpan) return;
        const address = addressSpan.textContent;
        const balanceTd = row.querySelector('.balance');
        if (balanceTd) {
            balanceTd.textContent = 'Loading...';
            fetch(`https://api.blockcypher.com/v1/btc/main/addrs/${address}/balance`)
                .then(response => response.json())
                .then(data => {
                    const balance = data.balance / 100000000;
                    balanceTd.textContent = balance.toFixed(8) + ' BTC';
                })
                .catch(error => {
                    console.error('Error fetching balance:', error);
                    balanceTd.textContent = 'Error';
                });
        } else {
            console.warn('Balance td not found for row:', row);
        }
    });
}

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('load-balances').addEventListener('click', loadBalances);
});