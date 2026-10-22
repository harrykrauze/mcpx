import { z } from "zod";

export const McpToolSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/),
  description: z.string().min(5),
  inputSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.any()),
    required: z.array(z.string()).optional()
  })
});

export function validateToolManifest(manifest: unknown): { success: boolean; errors?: string[] } {
  const result = McpToolSchema.safeParse(manifest);
  if (!result.success) {
    const issues = result.error.issues || (result.error as any).errors || [];
    return {
      success: false,
      errors: issues.map((err: any) => `${err.path.join(".")}: ${err.message}`)
    };
  }
  return { success: true };
}
