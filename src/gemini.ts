export interface GeminiOptions {
  model?: string;
  systemInstruction?: string;
  temperature?: number;
}

export async function generateMCPCode(
  prompt: string,
  apiKey: string,
  options: GeminiOptions = {}
): Promise<string> {
  const model = options.model ?? "gemini-3.8-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody: any = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      responseMimeType: "application/json"
    }
  };

  if (options.systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: options.systemInstruction }]
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as any;
  const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!candidate) {
    throw new Error("No response generated from Gemini");
  }

  return candidate;
}

export async function generateMcpSpec(
  rawInput: string,
  apiKey?: string
): Promise<any> {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  const prompt = `Convert the following specification or command into a valid MCP (Model Context Protocol) tool definition with JSON schema parameters:\n\n${rawInput}`;
  const response = await generateMCPCode(prompt, apiKey, {
    systemInstruction: "You are an expert MCP (Model Context Protocol) architect. Always output valid JSON definitions."
  });
  return JSON.parse(response);
}
