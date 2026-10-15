export type McpLanguage = 'typescript' | 'python';

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface McpGenerationSummary {
  toolsGenerated: string[];
  requiredEnvVars: string[];
  description?: string;
}

export interface McpServerResponse {
  serverName: string;
  language: McpLanguage;
  files: GeneratedFile[];
  summary: McpGenerationSummary;
  generatedBy?: string;
  notice?: string;
}

export interface PresetSnippet {
  id: string;
  title: string;
  category: 'cURL' | 'OpenAPI' | 'Swagger';
  language: McpLanguage;
  serverName: string;
  snippet: string;
  description: string;
}
