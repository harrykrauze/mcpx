/**
 * src/services/creemSignature.ts
 * 
 * Deterministic Creem.io Webhook HMAC SHA-256 Cryptographic Verification.
 * Compliant with W3C Web Crypto standard, fully compatible with Cloudflare Workers and Node.js runtimes.
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
 * Verifies Creem.io webhook HMAC SHA-256 signature.
 * 
 * @param rawBody - Raw unparsed request body string
 * @param signatureHeader - creem-signature or x-creem-signature header value (hex format)
 * @param secret - CREEM_WEBHOOK_SECRET secret key
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
 * Generates HMAC SHA-256 signature in Web Crypto API environment (for tests and simulations).
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
