"use client";
import { Keypair } from "@solana/web3.js";

/*
 The wallet key never sits in storage in the clear.
 - PIN (always set): PBKDF2-SHA256 (310k rounds) → AES-256-GCM.
 - Fingerprint / face (optional): a device passkey with the WebAuthn PRF extension. The passkey returns a
   secret only after the phone checks your fingerprint or face; that secret (through HKDF) encrypts a second
   copy of the key. Phones without PRF support simply don't offer it — we never fake a biometric gate.
 - Cloud backup: PBKDF2(recovery passphrase + server pepper) → AES-256-GCM; the server keeps only ciphertext.
 The unlocked key lives in memory only and is dropped after 5 minutes in the background.
*/

const KEY = "fungu.vault.v2";
const LEGACY = "fungu.wallet.v1";
const ITER = 310_000;
type U8 = Uint8Array<ArrayBuffer>;
type Box = { salt: string; iv: string; ct: string };
type Vault = { v: 2; pub: string; pin: Box & { iter: number }; bio?: Box & { cred: string; prfSalt: string } };

const te = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string): U8 => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n: number): U8 => crypto.getRandomValues(new Uint8Array(n));
const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

async function pbkdf(secret: string, salt: U8, iter: number) {
  const base = await crypto.subtle.importKey("raw", te.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function hkdf(ikm: ArrayBuffer, salt: U8) {
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: te.encode("fungu-vault") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function boxUp(key: CryptoKey, plain: Uint8Array, salt: U8): Promise<Box> {
  const iv = rand(12);
  return { salt: b64(salt), iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(plain))) };
}
async function open(key: CryptoKey, box: Box): Promise<Keypair> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct));
  return Keypair.fromSecretKey(new Uint8Array(plain));
}

export const vault = {
  get(): Vault | null { const r = safeGet(KEY); return r ? (JSON.parse(r) as Vault) : null; },
  exists() { return !!safeGet(KEY); },
  /** A wallet from before the lock existed (key stored in the clear). */
  legacy(): Keypair | null { const r = safeGet(LEGACY); return r ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(r))) : null; },
  hasBio() { return !!this.get()?.bio; },

  async create(kp: Keypair, pin: string) {
    const salt = rand(16);
    const box = await boxUp(await pbkdf(pin, salt, ITER), kp.secretKey, salt);
    localStorage.setItem(KEY, JSON.stringify({ v: 2, pub: kp.publicKey.toBase58(), pin: { ...box, iter: ITER } } satisfies Vault));
    localStorage.removeItem(LEGACY);
  },
  async unlockPin(pin: string): Promise<Keypair> {
    const v = this.get();
    if (!v) throw new Error("No wallet on this device");
    try { return await open(await pbkdf(pin, unb64(v.pin.salt), v.pin.iter), v.pin); }
    catch { throw new Error("Wrong PIN"); }
  },
  async changePin(kp: Keypair, pin: string) {
    const v = this.get()!;
    const salt = rand(16);
    v.pin = { ...(await boxUp(await pbkdf(pin, salt, ITER), kp.secretKey, salt)), iter: ITER };
    localStorage.setItem(KEY, JSON.stringify(v));
  },

  /** Is a fingerprint/face sensor available to the browser at all? (PRF support is only known after enrolling.) */
  async bioAvailable(): Promise<boolean> {
    try { return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
  },
  /** Creates a passkey and uses its PRF secret to encrypt a second copy of the key. false = this phone can't do it. */
  async enableBio(kp: Keypair, label: string): Promise<boolean> {
    const prfSalt = rand(32);
    const cred = (await navigator.credentials.create({ publicKey: {
      rp: { name: "Fungu", id: location.hostname },
      user: { id: rand(16), name: `${label || "wallet"} · Fungu`, displayName: label || "Fungu wallet" },
      challenge: rand(32),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    } })) as PublicKeyCredential | null;
    if (!cred) return false;
    const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
    let secret = ext.prf?.results?.first;
    if (!secret && ext.prf?.enabled) secret = await this.prfSecret(b64(cred.rawId), prfSalt);
    if (!secret) return false;
    const v = this.get()!;
    const hsalt = rand(16);
    v.bio = { ...(await boxUp(await hkdf(secret, hsalt), kp.secretKey, hsalt)), cred: b64(cred.rawId), prfSalt: b64(prfSalt) };
    localStorage.setItem(KEY, JSON.stringify(v));
    return true;
  },
  async prfSecret(credId: string, prfSalt: U8): Promise<ArrayBuffer | undefined> {
    const a = (await navigator.credentials.get({ publicKey: {
      challenge: rand(32), rpId: location.hostname, userVerification: "required",
      allowCredentials: [{ type: "public-key", id: unb64(credId) }],
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    } })) as PublicKeyCredential | null;
    return (a?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } })?.prf?.results?.first;
  },
  async unlockBio(): Promise<Keypair> {
    const v = this.get();
    if (!v?.bio) throw new Error("Fingerprint unlock isn't set up");
    const secret = await this.prfSecret(v.bio.cred, unb64(v.bio.prfSalt));
    if (!secret) throw new Error("Fingerprint check didn't complete");
    return open(await hkdf(secret, unb64(v.bio.salt)), v.bio);
  },
  disableBio() { const v = this.get(); if (v) { delete v.bio; localStorage.setItem(KEY, JSON.stringify(v)); } },
  wipe() { localStorage.removeItem(KEY); localStorage.removeItem(LEGACY); },
};

// ---------------------------------------------------------------- cloud backup (zero-knowledge)
export async function sealBackup(kp: Keypair, passphrase: string, pepperHex: string): Promise<string> {
  const salt = rand(16);
  const box = await boxUp(await pbkdf(passphrase + ":" + pepperHex, salt, ITER), kp.secretKey, salt);
  return btoa(JSON.stringify(box));
}
export async function openBackup(blob: string, passphrase: string, pepperHex: string): Promise<Keypair> {
  const box = JSON.parse(atob(blob)) as Box;
  try { return await open(await pbkdf(passphrase + ":" + pepperHex, unb64(box.salt), ITER), box); }
  catch { throw new Error("That recovery passphrase doesn't open this backup."); }
}

export async function recovery(step: string, body: object): Promise<any> {
  const r = await fetch("/api/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step, ...body }) });
  const j = await r.json().catch(() => ({ ok: false, error: "Network problem. Try again." }));
  if (!j.ok) throw new Error(j.error || "Something went wrong");
  return j;
}
