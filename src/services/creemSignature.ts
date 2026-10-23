/**
 * src/services/creemSignature.ts
 * 
 * Deterministiska Creem.io Webhook HMAC SHA-256 Kriptogrāfiskā Verifikācija.
 * Atbilst W3C Web Crypto standartam, pilnībā saderīga ar Cloudflare Workers un Node.js runtime.
 */

function hexToBytes(hex: string): Uint8Array | null {
  const cleanHex = hex.trim();
  if (cleanHex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
    return null;
  }
  const buffer = new ArrayBuffer(32);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Pārbauda Creem.io webhook HMAC SHA-256 parakstu.
 * 
 * @param rawBody - Neapstrādāta pieprasījuma pamatteksta virkne (raw body string)
 * @param signatureHeader - creem-signature vai x-creem-signature galvenes vērtība (hex formāts)
 * @param secret - CREEM_WEBHOOK_SECRET noslēpums
 */
export async function verifyCreemSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string
): Promise<boolean> {
  if (!signatureHeader || !secret) {
    return false;
  }

  const signatureBytes = hexToBytes(signatureHeader);
  if (!signatureBytes) {
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret) as unknown as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const bodyBytes = encoder.encode(rawBody);

    return await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes as unknown as BufferSource,
      bodyBytes as unknown as BufferSource
    );
  } catch (err) {
    console.error("Creem signature verification error:", err);
    return false;
  }
}

/**
 * Ģenerē HMAC SHA-256 parakstu Web Crypto API vidē (izmantošanai testos un simulācijās).
 */
export async function generateCreemSignature(
  rawBody: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret) as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const bodyBytes = encoder.encode(rawBody);

  const signatureBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    bodyBytes as unknown as BufferSource
  );

  return Array.from(new Uint8Array(signatureBuf), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}
