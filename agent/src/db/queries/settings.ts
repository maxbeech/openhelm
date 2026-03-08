import { eq } from "drizzle-orm";
import { getDb } from "../init.js";
import { settings } from "../schema.js";
import type { Setting, SettingKey } from "@openorchestra/shared";

export function getSetting(key: SettingKey): Setting | null {
  const db = getDb();
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return (row as Setting) ?? null;
}

export function getAllSettings(): Setting[] {
  const db = getDb();
  return db.select().from(settings).all() as Setting[];
}

export function setSetting(key: SettingKey, value: string): Setting {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db
    .insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: now },
    })
    .returning()
    .get();
  return row as Setting;
}

export function deleteSetting(key: SettingKey): boolean {
  const db = getDb();
  const result = db.delete(settings).where(eq(settings.key, key)).run();
  return result.changes > 0;
}
