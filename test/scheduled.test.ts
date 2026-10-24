/**
 * test/scheduled.test.ts
 *
 * Cloudflare Worker Cron Trigger (scheduled) unit test:
 * Verifies daily audit summary generation and low-balance key identification.
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
  console.log("      CRON TRIGGER (SCHEDULED AUDIT) UNIT TEST                  ");
  console.log("      Timestamp: " + new Date().toISOString());
  console.log("================================================================\n");

  const kv = new MockKV();
  const analytics = new MockAnalytics();

  const env: Env = {
    GEMINI_API_KEY: "fake_gemini",
    MCPX_KEYS: kv,
    ANALYTICS: analytics,
  };
  const ctx = createMockCtx();

  // Prepare test keys in mock KV store
  // 1. Active key with healthy balance (500 cents = $5.00)
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

  // 2. Active key with low balance (45 cents = $0.45, under 100 cents)
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

  // 3. Active key with zero balance (0 cents)
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

  // 4. Revoked key - should not appear among active keys
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

  await testStep("Executes workerDefault.scheduled and generates audit summary", async () => {
    if (!workerDefault.scheduled) {
      throw new Error("workerDefault does not export a 'scheduled' handler!");
    }
    await workerDefault.scheduled(controller, env, ctx);
  });

  await testStep("Verifies that stats:daily:2026-10-24 is stored in KV with valid schema", async () => {
    const rawDaily = await kv.get("stats:daily:2026-10-24", "text");
    if (!rawDaily) {
      throw new Error("KV does not contain entry 'stats:daily:2026-10-24'");
    }
    const daily = JSON.parse(rawDaily) as DailyAuditSummary;
    if (daily.status !== "HEALTHY") {
      throw new Error(`Expected status 'HEALTHY', received: ${daily.status}`);
    }
    if (daily.date !== "2026-10-24") {
      throw new Error(`Expected date '2026-10-24', received: ${daily.date}`);
    }
    if (daily.totalActiveKeys !== 3) {
      throw new Error(`Expected 3 active keys, received: ${daily.totalActiveKeys}`);
    }
    if (daily.lowBalanceCount !== 2) {
      throw new Error(`Expected 2 low-balance keys, received: ${daily.lowBalanceCount}`);
    }
    const hasLow02 = daily.lowBalanceKeys.some((k) => k.keyId === "key_low_02" && k.balanceCents === 45);
    const hasZero03 = daily.lowBalanceKeys.some((k) => k.keyId === "key_zero_03" && k.balanceCents === 0);
    if (!hasLow02 || !hasZero03) {
      throw new Error("lowBalanceKeys does not contain expected keys: " + JSON.stringify(daily.lowBalanceKeys));
    }
    // Verify 30-day expiration TTL
    const opts = kv.expirationOptions.get("stats:daily:2026-10-24");
    if (!opts || opts.expirationTtl !== 30 * 86400) {
      throw new Error("Entry missing 30-day expirationTtl (2592000s)");
    }
  });

  await testStep("Verifies that Analytics Engine recorded cron audit telemetry data point", async () => {
    if (analytics.dataPoints.length === 0) {
      throw new Error("Analytics Engine received no data points!");
    }
    const point = analytics.dataPoints[0];
    if (point.blobs?.[0] !== "system.cron_health") {
      throw new Error(`Expected blob1 'system.cron_health', received: ${point.blobs?.[0]}`);
    }
    if (point.doubles?.[0] !== 3) {
      throw new Error(`Expected double1 (active keys: 3), received: ${point.doubles?.[0]}`);
    }
    if (point.doubles?.[1] !== 2) {
      throw new Error(`Expected double2 (low balance keys: 2), received: ${point.doubles?.[1]}`);
    }
  });

  console.log(`\n================================================================`);
  console.log(`Result: ${pass} passed, ${fail} failed`);
  console.log(`================================================================`);

  if (fail > 0) {
    process.exit(1);
  }
}

runScheduledTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
