import { storage } from "@/src/utils/storage";

// Una única clave y un único espacio (secure*) para el token del monitor.
const TOKEN_KEY = "admin_token";

export async function getToken(): Promise<string | null> {
  return storage.secureGet<string | null>(TOKEN_KEY, null);
}

export async function setToken(token: string): Promise<void> {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
}
