// WorkerPool — نوعان: Download workers (تحميل رسائل Media) و Media workers (FFmpeg/Sharp).
// كل worker يحلق: claim → handler → تحديث. Heartbeat دوري أثناء العمل.

const MIN_WAIT = 200;
const MAX_WAIT = 2000;

export class WorkerPool {
  constructor({ queue, settings, logger, downloadHandler, processHandler }) {
    this.queue = queue;
    this.settings = settings;
    this.logger = logger;
    this.downloadHandler = downloadHandler;
    this.processHandler = processHandler;
    this.downloadWorkers = [];
    this.processWorkers = [];
    this.stopped = false;
  }

  start() {
    const dCount = this.settings.getNumber("queue.maxDownloadWorkers", 2);
    const mCount = this.settings.getNumber("queue.maxMediaWorkers", 4);
    this.stopped = false;
    for (let i = 0; i < dCount; i++) this.downloadWorkers.push(this._spawn("DL", i, "claimDownload", this.downloadHandler));
    for (let i = 0; i < mCount; i++) this.processWorkers.push(this._spawn("MD", i, "claimProcess", this.processHandler));
    this.logger.info("worker-pool", `started ${dCount} download workers, ${mCount} media workers`);
  }

  _spawn(kind, index, claimMethod, handler) {
    const id = `${kind}-${index}`;
    const worker = {
      id,
      job: null,
      running: true,
      timer: null,
      heartbeat: null,
      run: async () => {
        let wait = MIN_WAIT;
        while (worker.running && !this.stopped) {
          let job = null;
          try {
            job = this.queue[claimMethod](id);
          } catch (err) {
            this.logger.error("worker-pool", `claim failed ${id}`, { err: err.message });
          }
          if (!job) {
            await sleep(wait);
            wait = Math.min(wait * 2, MAX_WAIT);
            continue;
          }
          wait = MIN_WAIT;
          worker.job = job;
          const hbMs = this.settings.getNumber("queue.jobHeartbeatIntervalMs", 30000);
          worker.heartbeat = setInterval(() => {
            try {
              this.queue.heartbeat(job.id, id);
            } catch { /* ignore */ }
          }, hbMs);

          const started = Date.now();
          try {
            await handler(job);
          } catch (err) {
            const retryable = classifyRetryable(err);
            try {
              const res = this.queue.fail(job, err, { retryable });
              this.logger.error("worker-pool", `${id} FAILED job ${job.id}`, {
                err: err.message,
                retryable,
                status: res?.status,
              });
            } catch (err2) {
              this.logger.error("worker-pool", "fail handler error", { err: err2.message });
            }
          } finally {
            clearInterval(worker.heartbeat);
            worker.heartbeat = null;
            worker.job = null;
            this.logger.info("worker-pool", `${id} finished job ${job.id} in ${Date.now() - started}ms`);
          }
        }
      },
    };
    worker.run();
    return worker;
  }

  pause() {
    this.stop();
  }

  stop() {
    this.stopped = true;
    for (const w of [...this.downloadWorkers, ...this.processWorkers]) {
      w.running = false;
      if (w.heartbeat) clearInterval(w.heartbeat);
    }
    this.downloadWorkers = [];
    this.processWorkers = [];
  }

  activeCount() {
    return (
      (this.downloadWorkers.filter((w) => w.job).length + this.processWorkers.filter((w) => w.job).length) || 0
    );
  }

  status() {
    return {
      download: this.downloadWorkers.map((w) => ({ id: w.id, busy: !!w.job })),
      media: this.processWorkers.map((w) => ({ id: w.id, busy: !!w.job })),
      stopped: this.stopped,
    };
  }
}

export function classifyRetryable(err) {
  if (err && err.permanent) return false;
  const msg = String(err?.message || err || "");
  if (/not connected|disconnect|reconnect|timed out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ECONNABORTED|ENETUNREACH/.test(msg)) return true;
  if (/corrupt|decrypt|encounter missing|media message expired|HTTPError: 404|404 not found/i.test(msg)) return true; // تنزيل فاشل => retry
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}