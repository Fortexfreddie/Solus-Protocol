# Solus Protocol Encrypted Vaults (`.vault.json`)

**Location:** `/wallets/[agentId].vault.json`
**Purpose:** These files are the persisted, encrypted state of our agents' private keys. They act as the offline storage for Layer 6 of the air-gap engine.

---

## 1. File Structure & Content

If you open `rex.vault.json`, `nova.vault.json`, or `sage.vault.json`, you will see a structure that looks exactly like this:

```jsonc
{
    // Schema version for future backward compatibility
    "version": 1,
    
    // The logical identifier tying this vault to a specific personality profile
    "agentId": "rex",
    
    // The Solana public address. Safe to share and used to fetch balances.
    "publicKey": "37DzHNLLTor9sP1yVGnaEmuQUywgwLTYFiTUYDscVXS5",
    
    // Initialization Vector (16 bytes, hex-encoded). Ensures unique ciphertexts even for identical keys.
    "iv": "a1b2c3d4e5f607182930415263748596",
    
    // AES-256-GCM Authentication Tag (16 bytes, hex). Detects if the file was maliciously tampered with.
    "authTag": "f1e2d3c4b5a697887766554433221100",
    
    // The AES-encrypted 64-byte Solana secret key. The actual highly sensitive payload.
    "ciphertext": "...", 
    
    // PBKDF2 Salt (32 bytes, hex). Hashed with the master password 200,000 times to derive the decryption key.
    "salt": "...",
    
    // Unix timestamp of when the keypair and vault were generated
    "createdAt": 1700000000000
}