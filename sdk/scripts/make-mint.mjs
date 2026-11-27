// Creates the devnet demo stablecoin "fUSD" (6 decimals) with the sponsor as mint authority.
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { Connection, Keypair } from "@solana/web3.js"; import { createMint } from "@solana/spl-token";
const s = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/fungu-devnet.json")))));
const m = await createMint(new Connection("https://api.devnet.solana.com", "confirmed"), s, s.publicKey, null, 6);
console.log(m.toBase58());
