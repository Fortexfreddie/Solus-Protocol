# Solus Protocol Cryptographic Core (`key-store.ts`)

**Location:** `src/wallet/key-store.ts`
**Purpose:** This module is the isolated cryptographic engine for Layer 6 (Vault). It handles secure key derivation, payload encryption/decryption, and aggressive memory management. No plaintext private key material ever leaves this module.

---

## 1. Key Derivation (PBKDF2)



Before any encryption or decryption occurs, the system must derive a cryptographically strong key from the user's password. 

* **Algorithm:** PBKDF2 with HMAC-SHA-512.
* **Iterations:** `200,000` (Thwarts brute-force and dictionary attacks).
* **Salt:** A 32-byte random salt is generated for every encryption operation and stored alongside the ciphertext.

**Team Takeaway:** The `buildVaultPassword` helper ensures that even if we use a single `VAULT_MASTER_KEY` environment variable, each agent (`rex`, `nova`, `sage`) gets a completely unique password by concatenating the master key with their `agentId`.

---

## 2. Encryption Engine (AES-256-GCM)



We use AES-256-GCM because it provides both confidentiality (encryption) and authenticity (tamper evidence).

* **Initialization Vector (IV):** A random 16-byte IV is generated for every single encryption.
* **Authentication Tag:** GCM mode automatically generates a 16-byte `authTag`. During decryption, if even a single bit of the stored ciphertext or IV has been altered, the `authTag` validation will violently fail, preventing the system from loading corrupted or maliciously modified keys.

---

## 3. Strict Memory Management (Zero-Exposure)

In Node.js, standard variables wait around in RAM until the Garbage Collector (GC) decides to clean them up. For private keys, this creates an unacceptable attack surface.

* **The `zeroBuffer` Function:** This utility explicitly calls `buf.fill(0)` on the Node.js `Buffer` objects holding the derived keys and private key materials.
* **Guaranteed Execution:** Both the `encrypt` and `decrypt` functions wrap their operations in `try...finally` blocks. This guarantees that `zeroBuffer(key)` is executed the millisecond the cryptographic operation finishes, even if the operation throws a fatal error mid-execution.

**Team Takeaway (Frontend/LLM Devs):** You will never interact with this file directly. This is the deepest part of the air-gap engine. By the time any transaction data bubbles up to the Next.js dashboard, the private keys have long been zeroed out of the backend's RAM.