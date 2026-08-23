// load-test.mjs — يحقن ضغطاً من المهام لقياس أداء الطابور دون واتساب حقيقي.
// الاستخدام: node scripts/load-test.mjs [عدد المهام]
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { AppServices } from "../src/main/app-services.mjs";

const N = Number(process.argv[2] || 20000);

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "sb-load-"));
  console.log(`[load] data dir: ${dir}`);
  console.log(`[load] injecting ${N} tasks…`);

  const svc = new AppServices({ dataDir: dir });
  const t0 = Date.now();
  await svc.init();

  // تعطيل الـ Workers حتى لا تستهلك الرتل أثناء القياس (نقيس الإدراج فقط)
  svc.workers.stop();

  const users = [];
  for (let i = 0; i < 100; i++) {
    users.push(svc.users.upsertOrGet({
      whatsappId: `97250${String(1000000 + i)}00@s.whatsapp.net`,
      phone: `97250${String(1000000 + i)}00`,
      name: `user-${i}`,
      pushName: `u${i}`,
    }));
  }

  let ok = 0, rejected = 0, quota = 0, dup = 0;
  const t1 = Date.now();
  for (let i = 0; i < N; i++) {
    const u = users[i % users.length];
    const r = svc.queue.enqueue({ user: u, messageId: `load-${i}`, type: i % 2 ? "VIDEO" : "IMAGE" });
    if (r.ok) ok++;
    else {
      rejected++;
      if (r.code === "quota_exceeded") quota++;
      if (r.code === "duplicate") dup++;
    }
  }
  const t2 = Date.now();

  const counts = svc.queue.counts();
  const perSec = (ok / ((t2 - t1) / 1000)).toFixed(0);

  console.log(`[load] enqueue: ${ok} ok, ${rejected} rejected (quota=${quota}, dup=${dup})`);
  console.log(`[load] throughput: ${perSec}/s in ${((t2 - t1) / 1000).toFixed(1)}s`);
  console.log(`[load] queue counts:`, JSON.stringify(counts));
  console.log(`[load] boot took ${t1 - t0}ms`);

  // التحقق من سلامة الاسترداد بعد إعادة الإقلاع
  await svc.shutdown();
  const svc2 = new AppServices({ dataDir: dir });
  const t3 = Date.now();
  await svc2.init();
  const counts2 = svc2.queue.counts();
  console.log(`[load] recovery OK — re-init ${Date.now() - t3}ms, counts:`, JSON.stringify(counts2));
  await svc2.shutdown();

  console.log("[load] done ✓");
}

main().catch((e) => {
  console.error("[load] FAILED:", e);
  process.exit(1);
});