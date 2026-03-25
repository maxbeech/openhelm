import { registerHandler } from "../handler.js";
import { emit } from "../emitter.js";
import * as credQueries from "../../db/queries/credentials.js";
import { setKeychainItem, getKeychainItem, deleteKeychainItem } from "../../keychain/index.js";
import type {
  CreateCredentialParams,
  UpdateCredentialParams,
  ListCredentialsParams,
  CredentialValue,
  CredentialWithValue,
} from "@openhelm/shared";

export function registerCredentialHandlers() {
  registerHandler("credentials.list", (params) => {
    const p = params as ListCredentialsParams | undefined;
    return credQueries.listCredentials(p);
  });

  registerHandler("credentials.listAll", () => {
    return credQueries.listCredentials();
  });

  registerHandler("credentials.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const cred = credQueries.getCredential(id);
    if (!cred) throw new Error(`Credential not found: ${id}`);
    return cred;
  });

  registerHandler("credentials.getValue", async (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const cred = credQueries.getCredential(id);
    if (!cred) throw new Error(`Credential not found: ${id}`);

    let value: CredentialValue | null = null;
    try {
      const raw = await getKeychainItem(id);
      if (raw) value = JSON.parse(raw) as CredentialValue;
    } catch (err) {
      console.error("[credentials] keychain read error:", err);
      throw new Error(
        err instanceof Error ? err.message : "Failed to read credential from Keychain",
      );
    }

    const result: CredentialWithValue = { ...cred, value };
    return result;
  });

  registerHandler("credentials.create", async (params) => {
    const p = params as CreateCredentialParams;
    if (!p?.name) throw new Error("name is required");
    if (!p?.type) throw new Error("type is required");
    if (!p?.value) throw new Error("value is required");

    // Store metadata in SQLite (env var name is auto-generated inside createCredential)
    const cred = credQueries.createCredential(p);

    // Store secret value in Keychain
    try {
      await setKeychainItem(cred.id, JSON.stringify(p.value));
    } catch (err) {
      // Rollback metadata if Keychain write fails
      credQueries.deleteCredential(cred.id);
      throw new Error(
        err instanceof Error ? err.message : "Failed to store credential in Keychain",
      );
    }

    emit("credential.created", cred);
    return cred;
  });

  registerHandler("credentials.update", async (params) => {
    const p = params as UpdateCredentialParams;
    if (!p?.id) throw new Error("id is required");

    // Update metadata in SQLite
    const cred = credQueries.updateCredential(p);

    // Update secret value in Keychain if provided
    if (p.value) {
      try {
        await setKeychainItem(cred.id, JSON.stringify(p.value));
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to update credential in Keychain",
        );
      }
    }

    emit("credential.updated", cred);
    return cred;
  });

  registerHandler("credentials.delete", async (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");

    const deleted = credQueries.deleteCredential(id);
    if (deleted) {
      // Best-effort Keychain delete (don't fail if not found)
      try {
        await deleteKeychainItem(id);
      } catch (err) {
        console.error("[credentials] keychain delete error (non-fatal):", err);
      }
      emit("credential.deleted", { id });
    }
    return { deleted };
  });

  registerHandler("credentials.count", (params) => {
    const { projectId } = params as { projectId?: string };
    return { count: credQueries.countCredentials(projectId ?? undefined) };
  });

  registerHandler("credentials.countAll", () => {
    return { count: credQueries.countCredentials() };
  });
}
