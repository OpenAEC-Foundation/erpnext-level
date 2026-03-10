/**
 * Encrypted password manager store.
 *
 * Stores password entries in ~/.erpnext-level/passwords.enc
 * encrypted with AES-256-GCM using the same machine-specific key as vault.ts.
 */

import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir, hostname, userInfo } from "os";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;

export interface PasswordEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  url?: string;
  category: string;
  notes?: string;
  created: string;
  modified: string;
}

function getStoreDir(): string {
  const dir = process.env.ERPNEXT_LEVEL_CONFIG_DIR || join(homedir(), ".erpnext-level");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorePath(): string {
  return join(getStoreDir(), "passwords.enc");
}

/** Derive encryption key from machine identity */
function deriveKey(salt: Buffer): Buffer {
  const identity = `${userInfo().username}@${hostname()}::erpnext-level-passwords`;
  return pbkdf2Sync(identity, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");
}

/** Encrypt JSON data and write to store file */
export function writePasswords(entries: PasswordEntry[]): void {
  const plaintext = JSON.stringify(entries, null, 2);
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // File format: salt (32) | iv (16) | authTag (16) | encrypted data
  const output = Buffer.concat([salt, iv, authTag, encrypted]);
  writeFileSync(getStorePath(), output);
  console.log(`[passwords] Wrote ${entries.length} entries to ${getStorePath()}`);
}

/** Read and decrypt store file */
export function readPasswords(): PasswordEntry[] {
  const path = getStorePath();
  if (!existsSync(path)) return [];

  try {
    const data = readFileSync(path);
    if (data.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
      console.error("[passwords] File too small, ignoring");
      return [];
    }

    const salt = data.subarray(0, SALT_LENGTH);
    const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = deriveKey(salt);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return JSON.parse(decrypted.toString("utf-8"));
  } catch (err) {
    console.error("[passwords] Failed to decrypt password store:", err);
    return [];
  }
}

/** Get a single entry by ID */
export function getPasswordEntry(id: string): PasswordEntry | undefined {
  return readPasswords().find((e) => e.id === id);
}

/** Add or update an entry */
export function upsertPasswordEntry(entry: PasswordEntry): void {
  const entries = readPasswords();
  const idx = entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    entries[idx] = { ...entry, modified: new Date().toISOString() };
  } else {
    entries.push({
      ...entry,
      created: entry.created || new Date().toISOString(),
      modified: new Date().toISOString(),
    });
  }
  writePasswords(entries);
}

/** Remove an entry */
export function removePasswordEntry(id: string): void {
  const entries = readPasswords().filter((e) => e.id !== id);
  writePasswords(entries);
}

/** Import entries (merge or replace) */
export function importPasswords(entries: PasswordEntry[], replace = false): number {
  if (replace) {
    writePasswords(entries);
    return entries.length;
  }
  // Merge: add new, update existing
  const existing = readPasswords();
  const map = new Map(existing.map((e) => [e.id, e]));
  for (const entry of entries) {
    map.set(entry.id, entry);
  }
  const merged = Array.from(map.values());
  writePasswords(merged);
  return entries.length;
}
