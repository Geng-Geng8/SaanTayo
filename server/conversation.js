import { AppError } from "../shared/travel.js";
const enc = new TextEncoder();
function encode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function decode(value) {
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
async function key(secret) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function signConversation(
  id,
  secret,
  now = Date.now(),
  metadata = {},
) {
  if (typeof id !== "string" || !id || id.length > 2000) return null;
  const payload = encode(
    enc.encode(
      JSON.stringify({
        id,
        exp: now + 7 * 86400000,
        hasMaps: metadata.hasMaps === true,
        expiresAt: metadata.expiresAt || null,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(secret),
    enc.encode(payload),
  );
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyConversationState(token, secret, now = Date.now()) {
  try {
    if (typeof token !== "string" || token.length > 4000) throw new Error();
    const [payload, signature, extra] = token.split(".");
    if (
      extra ||
      !(await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        decode(signature),
        enc.encode(payload),
      ))
    )
      throw new Error();
    const data = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (
      typeof data.id !== "string" ||
      !Number.isFinite(data.exp) ||
      data.exp <= now
    )
      throw new Error();
    return data;
  } catch {
    throw new AppError(
      "CONVERSATION_EXPIRED",
      "Reconnect using your saved itinerary. Conversation access has expired.",
      409,
    );
  }
}
export async function verifyConversation(token, secret, now = Date.now()) {
  return (await verifyConversationState(token, secret, now)).id;
}
