import { app, safeStorage } from "electron";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredVerifiedSession } from "../shared/ipc";

type EncryptedState = {
  version: 1;
  publicKey: string;
  privateKey: string;
  sessions: Record<string, { backendUrl: string; userUID: string; token: string; expiresAt: string }>;
};

/** Private signing material and bearer tokens never enter renderer storage. */
export class SecureIdentityService {
  private readonly filePath = path.join(app.getPath("userData"), "identity-secure-v1.json");
  private state: EncryptedState | null = null;

  private requireOSStorage(): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("OS secure storage is unavailable.");
    if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
      throw new Error("An OS keyring is required for signing keys and sessions.");
    }
  }

  private encrypt(value: Buffer): string {
    this.requireOSStorage();
    return safeStorage.encryptString(value.toString("base64")).toString("base64");
  }

  private decrypt(value: string): Buffer {
    this.requireOSStorage();
    const encoded = safeStorage.decryptString(Buffer.from(value, "base64"));
    return Buffer.from(encoded, "base64");
  }

  private async load(): Promise<EncryptedState> {
    if (this.state) return this.state;
    this.requireOSStorage();
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as EncryptedState;
      if (raw.version !== 1 || !raw.publicKey || !raw.privateKey || typeof raw.sessions !== "object") {
        throw new Error("Secure identity data is invalid.");
      }
      this.decrypt(raw.privateKey);
      this.state = raw;
      return raw;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const jwk = publicKey.export({ format: "jwk" });
    if (!jwk.x) throw new Error("Could not export Ed25519 public key.");
    const next: EncryptedState = {
      version: 1,
      publicKey: jwk.x,
      privateKey: this.encrypt(privateKey.export({ format: "der", type: "pkcs8" })),
      sessions: {}
    };
    await this.persist(next);
    this.state = next;
    return next;
  }

  private async persist(value: EncryptedState): Promise<void> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, this.filePath);
  }

  async publicKey(): Promise<string> {
    return (await this.load()).publicKey;
  }

  async signChallenge(payload: string): Promise<string> {
    if (typeof payload !== "string" || payload.length > 1024 || !payload.startsWith("openchat-session-v1\n")) {
      throw new Error("Invalid session challenge.");
    }
    const state = await this.load();
    const privateKey = createPrivateKey({ key: this.decrypt(state.privateKey), format: "der", type: "pkcs8" });
    return sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64url");
  }

  async storeSession(session: StoredVerifiedSession): Promise<void> {
    if (!session.serverId || session.serverId.length > 128 || !/^https?:\/\//.test(session.backendUrl) ||
      !session.userUID || session.userUID.length > 128 ||
      !session.token || session.token.length > 128 || !Number.isFinite(Date.parse(session.expiresAt))) {
      throw new Error("Invalid verified session.");
    }
    const state = await this.load();
    const next: EncryptedState = {
      ...state,
      sessions: {
        ...state.sessions,
        [session.serverId]: {
          backendUrl: session.backendUrl,
          userUID: session.userUID,
          token: this.encrypt(Buffer.from(session.token, "utf8")),
          expiresAt: session.expiresAt
        }
      }
    };
    await this.persist(next);
    this.state = next;
  }

  async loadSession(serverId: string): Promise<StoredVerifiedSession | null> {
    if (!serverId || serverId.length > 128) return null;
    const stored = (await this.load()).sessions[serverId];
    if (!stored || Date.parse(stored.expiresAt) <= Date.now()) return null;
    return {
      serverId,
      backendUrl: stored.backendUrl,
      userUID: stored.userUID,
      token: this.decrypt(stored.token).toString("utf8"),
      expiresAt: stored.expiresAt
    };
  }

  async clearSession(serverId: string): Promise<void> {
    const state = await this.load();
    if (!state.sessions[serverId]) return;
    const sessions = { ...state.sessions };
    delete sessions[serverId];
    const next = { ...state, sessions };
    await this.persist(next);
    this.state = next;
  }
}
