import vm from "node:vm";

export interface SandboxExecutionOptions {
  timeoutMs?: number;
  allowedHosts?: string[];
}

export class CodeSandbox {
  /**
   * Droši izpilda dinamisko rīka funkciju izolētā kontekstā.
   */
  public static async executeToolHandler(
    handlerCode: string,
    args: Record<string, unknown>,
    options: SandboxExecutionOptions = {}
  ): Promise<unknown> {
    const timeout = options.timeoutMs ?? 5000;

    // Izveido izolētu kontekstu bez pieejas galvenā procesa globālajiem objektiem
    const sandboxScope = {
      args,
      URL,
      URLSearchParams,
      Buffer: {
        from: Buffer.from,
        byteLength: Buffer.byteLength
      },
      console: {
        log: () => {},
        error: () => {},
        warn: () => {}
      },
      // Droša fetch vārteja, kas bloķē pieprasījumus uz lokālajiem tīkliem (SSRF aizsardzība)
      fetch: async (input: string | URL, init?: RequestInit) => {
        const urlStr = input.toString();
        const parsed = new URL(urlStr);

        // SSRF aizsardzība pret lokālo IP adrešu skenēšanu
        if (
          parsed.hostname === "localhost" ||
          parsed.hostname === "127.0.0.1" ||
          parsed.hostname.startsWith("192.168.") ||
          parsed.hostname.startsWith("10.") ||
          parsed.hostname === "169.254.169.254" // AWS/Cloud metadata
        ) {
          throw new Error(`SSRF aizsardzība: piekļuve lokālajai adresei ${parsed.hostname} ir bloķēta.`);
        }

        return fetch(input, init);
      }
    };

    const context = vm.createContext(sandboxScope, {
      codeGeneration: { strings: false, wasm: false } // Bloķē dinamisku eval()
    });

    // Ietver kodu asinhronā pašizpildes funkcijā
    const script = new vm.Script(`
      (async () => {
        ${handlerCode}
      })()
    `);

    const executionPromise = script.runInContext(context, {
      timeout,
      displayErrors: true
    }) as Promise<unknown>;

    // Nodrošina taimautu arī asinhronām aizturēm
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`ERR_SCRIPT_EXECUTION_TIMEOUT: Izpildes laiks pārsniedza ${timeout}ms limitu.`));
      }, timeout);
    });

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
