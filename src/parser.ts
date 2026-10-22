export type PayloadType = "openapi" | "curl" | "json_schema" | "unknown";

export function detectPayloadType(rawInput: string): PayloadType {
  const trimmed = rawInput.trim();

  if (trimmed.startsWith("curl ") || trimmed.startsWith("curl\n")) {
    return "curl";
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.openapi || parsed.swagger) {
      return "openapi";
    }
    if (parsed.type || parsed.properties) {
      return "json_schema";
    }
  } catch {
    if (trimmed.includes("openapi:") || trimmed.includes("swagger:")) {
      return "openapi";
    }
  }

  return "unknown";
}
