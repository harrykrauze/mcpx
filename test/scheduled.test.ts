/**
 * test/scheduled.test.ts
 *
 * Cloudflare Worker Cron Trigger (scheduled) vienībtests:
 * Pārbauda ikdienas audita kopsavilkuma ģenerēšanu un zemas bilances atslēgu identifikāciju.
 */

import workerDefault, { handleScheduled } from "../src/index";
import {
  Env,
  ExecutionContext,
  ScheduledController,
  KVNamespace,
  AnalyticsEngineDataset,
  AnalyticsEngineDataPoint,
  DailyAuditSummary,
} from "../src/auth";

class MockKV implements KVNamespace {
  public store = new Map<string, string>();
  public expirationOptions = new Map<string, any>();

  async get(key: string, type?: "text"): Promise<string | null>;
  async get<ExpectedValue = unknown>(key: string, type: "json"): Promise<ExpectedValue | null>;
  async get(key: string, type: "text" | "json" = "text"): Promise<any> {
    const val = this.store.get(key);
    if (!val) return null;
    if (type === "json") {
      try {
        return JSON.parse(val);
      } catch {
        return null;
      }
    }
    return val;
  }

  async put(key: string, value: string, options?: any): Promise<void> {
    this.store.set(key, value);
    if (options) {
      this.expirationOptions.set(key, options);
    }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const prefix = options?.prefix || "";
    const keys: Array<{ name: string }> = [];
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) {
        keys.push({ name: k });
      }
    }
    return { keys, list_complete: true };
  }
}

class MockAnalytics implements AnalyticsEngineDataset {
  public dataPoints: AnalyticsEngineDataPoint[] = [];

  writeDataPoint(point: AnalyticsEngineDataPoint): void {
    this.dataPoints.push(point);
  }
}

function createMockCtx(): ExecutionContext {
  return {
    waitUntil(_p: Promise<unknown>) {},
    passThroughOnException() {},
  };
}

async function runScheduledTests() {
  console.log("================================================================");
  console.log("      CRON TRIGGER (SCHEDULED AUDIT) VIENĪBTESTS               ");
  console.log("      Laika zīmogs: " + new Date().toISOString());
  console.log("================================================================\n");

  const kv = new MockKV();
  const analytics = new MockAnalytics();

  const env: Env = {
    GEMINI_API_KEY: "fake_gemini",
    MCPX_KEYS: kv,
    ANALYTICS: analytics,
  };
  const ctx = createMockCtx();

  // Sagatavo testa atslēgas KV krātuvē
  // 1. Aktīva atslēga ar pietiekamu bilanci (500 centi = $5.00)
  await kv.put(
    "key:mcpx_live_client_healthy_01",
    JSON.stringify({
      userId: "client-healthy-01",
      tenantId: "tenant-healthy-01",
      keyId: "key_healthy_01",
      plan: "pro",
      status: "active",
      billing: {
        mode: "prepaid",
        balanceCents: 500,
        currency: "USD",
        costPerToolCallCents: 1,
        costPerGenerateCents: 5,
        totalSpentCents: 120,
        lowBalanceThresholdCents: 50,
      },
    })
  );

  // 2. Aktīva atslēga ar zemu bilanci (45 centi = $0.45, zem 100 centiem)
  await kv.put(
    "key:mcpx_live_client_low_02",
    JSON.stringify({
      userId: "client-low-02",
      tenantId: "tenant-low-02",
      keyId: "key_low_02",
      plan: "free",
      status: "active",
      billing: {
        mode: "prepaid",
        balanceCents: 45,
        currency: "USD",
        costPerToolCallCents: 1,
        costPerGenerateCents: 5,
        totalSpentCents: 455,
        lowBalanceThresholdCents: 50,
      },
    })
  );

  // 3. Aktīva atslēga ar kritiski 0 bilanci (0 centi)
  await kv.put(
    "key:mcpx_live_client_zero_03",
    JSON.stringify({
      userId: "client-zero-03",
      tenantId: "tenant-zero-03",
      keyId: "key_zero_03",
      plan: "enterprise",
      status: "active",
      billing: {
        mode: "prepaid",
        balanceCents: 0,
        currency: "USD",
        costPerToolCallCents: 1,
        costPerGenerateCents: 5,
        totalSpentCents: 1000,
        lowBalanceThresholdCents: 10,
      },
    })
  );

  // 4. Anulēta (revoked) atslēga - tai nevajadzētu parādīties pie aktīvajām
  await kv.put(
    "key:mcpx_live_client_revoked_04",
    JSON.stringify({
      userId: "client-revoked-04",
      tenantId: "tenant-revoked-04",
      keyId: "key_revoked_04",
      plan: "free",
      status: "revoked",
      billing: {
        mode: "prepaid",
        balanceCents: 10,
        currency: "USD",
        costPerToolCallCents: 1,
        costPerGenerateCents: 5,
        totalSpentCents: 50,
        lowBalanceThresholdCents: 10,
      },
    })
  );

  let pass = 0;
  let fail = 0;

  async function testStep(name: string, fn: () => Promise<void>) {
    process.stdout.write(`[*] ${name}... `);
    try {
      await fn();
      console.log("PASS");
      pass++;
    } catch (err: any) {
      console.log("FAIL");
      console.error(`    ${err.message || String(err)}`);
      fail++;
    }
  }

  const fixedScheduledTime = new Date("2026-10-24T08:00:00Z").getTime();
  const controller: ScheduledController = {
    scheduledTime: fixedScheduledTime,
    cron: "0 8 * * *",
    noRetry() {},
  };

  await testStep("Izpilda workerDefault.scheduled un saņem atgriezto auditu", async () => {
    if (!workerDefault.scheduled) {
      throw new Error("workerDefault nesatur 'scheduled' apstrādātāju!");
    }
    await workerDefault.scheduled(controller, env, ctx);
  });

  await testStep("Pārbauda, ka stats:daily:2026-10-24 ir saglabāts KV krātuvē ar pareizo struktūru", async () => {
    const rawDaily = await kv.get("stats:daily:2026-10-24", "text");
    if (!rawDaily) {
      throw new Error("KV nesatur ierakstu 'stats:daily:2026-10-24'");
    }
    const daily = JSON.parse(rawDaily) as DailyAuditSummary;
    if (daily.status !== "HEALTHY") {
      throw new Error(`Gaidīts statuss 'HEALTHY', saņemts: ${daily.status}`);
    }
    if (daily.date !== "2026-10-24") {
      throw new Error(`Gaidīts datums '2026-10-24', saņemts: ${daily.date}`);
    }
    if (daily.totalActiveKeys !== 3) {
      throw new Error(`Gaidītas 3 aktīvas atslēgas, saņemtas: ${daily.totalActiveKeys}`);
    }
    if (daily.lowBalanceCount !== 2) {
      throw new Error(`Gaidītas 2 zemas bilances atslēgas, saņemtas: ${daily.lowBalanceCount}`);
    }
    const hasLow02 = daily.lowBalanceKeys.some((k) => k.keyId === "key_low_02" && k.balanceCents === 45);
    const hasZero03 = daily.lowBalanceKeys.some((k) => k.keyId === "key_zero_03" && k.balanceCents === 0);
    if (!hasLow02 || !hasZero03) {
      throw new Error("lowBalanceKeys nesatur pareizās atslēgas: " + JSON.stringify(daily.lowBalanceKeys));
    }
    // Pārbauda 30 dienu TTL opciju
    const opts = kv.expirationOptions.get("stats:daily:2026-10-24");
    if (!opts || opts.expirationTtl !== 30 * 86400) {
      throw new Error("Ierakstam trūkst 30 dienu expirationTtl (2592000s)");
    }
  });

  await testStep("Pārbauda, ka Analytics Engine reģistrēja telemetrijas punktu par Cron auditēšanu", async () => {
    if (analytics.dataPoints.length === 0) {
      throw new Error("Analytics Engine nav saņēmis nevienu datu punktu!");
    }
    const point = analytics.dataPoints[0];
    if (point.blobs?.[0] !== "system.cron_health") {
      throw new Error(`Gaidīts blob1 'system.cron_health', saņemts: ${point.blobs?.[0]}`);
    }
    if (point.doubles?.[0] !== 3) {
      throw new Error(`Gaidīts double1 (aktīvās atslēgas: 3), saņemts: ${point.doubles?.[0]}`);
    }
    if (point.doubles?.[1] !== 2) {
      throw new Error(`Gaidīts double2 (zemās bilances: 2), saņemts: ${point.doubles?.[1]}`);
    }
  });

  console.log(`\n================================================================`);
  console.log(`Rezultāts: ${pass} sekmīgi, ${fail} neveiksmīgi`);
  console.log(`================================================================`);

  if (fail > 0) {
    process.exit(1);
  }
}

runScheduledTests().catch((err) => {
  console.error("Testa kļūda:", err);
  process.exit(1);
});
