import dotenv from "dotenv";
import { runSelfHealingPipeline } from "../src/core/selfHealingPipeline.js";

dotenv.config();

async function testPipeline() {
  console.log("=== SOLIS 5: DETERMINISTISKĀS AVĀRIJAS BREMZES UN ORĶESTRATORA TESTS ===\n");

  // --- SCENĀRIJS 1: Veiksmīga pašārstēšanās ---
  console.log("--- SCENĀRIJS 1.1: Tīra koda tūlītēja pieņemšana (0 iterāciju patēriņš) ---");
  const repairableCode = `export interface ServerConfig {
  port: number;
}

export function initializePort(): ServerConfig {
  const defaultPort: number = 8080;
  return {
    port: defaultPort
  };
}
`;

  const cleanResult = await runSelfHealingPipeline({
    initialCode: repairableCode
  });
  console.log("Tīra koda rezultāts:", JSON.stringify(cleanResult, null, 2));

  if (!cleanResult.success || cleanResult.totalIterations !== 1 || cleanResult.history[0]?.tier !== "CLEAN") {
    throw new Error("Scenārijs 1.1 neizdevās: Tīram kodam vajadzēja uzreiz sekmīgi noslēgties 1 iterācijā!");
  }

  console.log("\n--- SCENĀRIJS 1.2: Kods ar L1 tipa kļūdu (labošana caur orķestratoru) ---");
  const minorErrorCode = `export interface UserGreeting {
  message: string;
}

export function getGreeting(): UserGreeting {
  const greetingText: string = process.env.APP_GREETING;
  return {
    message: greetingText
  };
}
`;

  const repairResult = await runSelfHealingPipeline({
    initialCode: minorErrorCode,
    maxIterations: 2
  });
  console.log("L1 kļūdas labošanas rezultāts:", JSON.stringify(repairResult, null, 2));

  if (!repairResult.success || repairResult.totalIterations > 2) {
    throw new Error("Scenārijs 1.2 neizdevās: Pašārstēšanās cauruļvadam vajadzēja sekmīgi novērst L1 kļūdu!");
  }

  // --- SCENĀRIJS 2: Circuit Breaker nostrāde (Bailout) ---
  console.log("\n--- SCENĀRIJS 2: Circuit Breaker nostrāde pie nesalabojama koda (limits 2) ---");
  const stubbornErrorCode = `export function brokenFunction(): number {
  return "STILL_NOT_A_NUMBER";
}
`;

  // Simulējam nepakļāvīgu kļūdu (labotājs atdod joprojām kļūdainu kodu)
  const breakerResult = await runSelfHealingPipeline({
    initialCode: stubbornErrorCode,
    maxIterations: 2,
    repairerOverride: async (code) => {
      // Labotājs atgriež joprojām nederīgu kodu, lai pārbaudītu Circuit Breaker robežu
      return code.replace("STILL_NOT_A_NUMBER", "ANOTHER_INVALID_STRING");
    }
  });
  console.log("Circuit Breaker rezultāts:", JSON.stringify(breakerResult, null, 2));

  if (breakerResult.success) {
    throw new Error("Scenārijs 2 neizdevās: Circuit breaker vajadzēja atteikt un atgriezt success: false!");
  }

  if (breakerResult.totalIterations !== 2) {
    throw new Error(`Scenārijs 2 neizdevās: Gaidīts totalIterations = 2, bet saņemts ${breakerResult.totalIterations}`);
  }

  if (!breakerResult.errorReport || !breakerResult.errorReport.reason.includes("Sasniegts maksimālais pašārstēšanās iterāciju limits (2)")) {
    throw new Error("Scenārijs 2 neizdevās: Trūkst pareiza kļūdas ziņojuma no errorReport!");
  }

  if (!breakerResult.errorReport.finalDiagnostics || breakerResult.errorReport.finalDiagnostics.length === 0) {
    throw new Error("Scenārijs 2 neizdevās: errorReport nesatur finalDiagnostics kompilatora kļūdas!");
  }

  console.log("\n Visi 5. soļa orķestratora un Circuit Breaker testi sekmīgi izturēti!");
}

testPipeline().catch(err => {
  console.error("Testa kļūda:", err);
  process.exit(1);
});
