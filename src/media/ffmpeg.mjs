// مزوّد ffmpeg — ffmpeg-static أولاً، fallback لـ PATH.
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let cachedFfmpeg = null;
let cachedFfprobe = null;

export function resolveFfmpeg() {
  if (cachedFfmpeg) return cachedFfmpeg;
  try {
    const staticPath = resolve(process.resourcesPath ?? "", "ffmpeg", "ffmpeg");
    statSync(staticPath);
    cachedFfmpeg = staticPath;
    return cachedFfmpeg;
  } catch {
    /* ignore */
  }
  try {
    const mod = require("ffmpeg-static");
    statSync(mod);
    cachedFfmpeg = mod;
    return cachedFfmpeg;
  } catch {
    /* ignore */
  }
  cachedFfmpeg = "ffmpeg"; // PATH
  return cachedFfmpeg;
}

export function resolveFfprobe() {
  if (cachedFfprobe) return cachedFfprobe;
  const ff = resolveFfmpeg();
  if (ff !== "ffmpeg") {
    const candidate = ff.replace(/ffmpeg$/, "ffprobe");
    try {
      statSync(candidate);
      cachedFfprobe = candidate;
      return candidate;
    } catch {
      /* ignore */
    }
  }
  cachedFfprobe = "ffprobe"; // PATH
  return cachedFfprobe;
}

export function runFfmpeg(args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const ff = resolveFfmpeg();
    const child = execFile(ff, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || "");
        reject(err);
        return;
      }
      resolveResult({ stdout: String(stdout), stderr: String(stderr) });
    });
    child.on("error", (e) => {
      // bin مفقود
      reject(new Error(`ffmpeg not found: ${e.message}`));
    });
  });
}

export function runFfprobe(args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const fp = resolveFfprobe();
    const child = execFile(fp, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || "");
        reject(err);
        return;
      }
      resolveResult({ stdout: String(stdout), stderr: String(stderr) });
    });
    child.on("error", (e) => reject(new Error(`ffprobe not found: ${e.message}`)));
  });
}

// قراءة معلومات الفيديو عبر ffprobe (JSON). عند غياب ffprobe (مثل ffmpeg-static
// الذي لا يحمل ffprobe) نستنتج نفس المعلومات من ملخص ffmpeg على stderr.
export async function probeMedia(inputPath) {
  if (!process.env.SB_FORCE_FFMPEG_PROBE) {
    try {
      return await probeViaFfprobe(inputPath);
    } catch {
      /* ffprobe غير متاح */
    }
  }
  try {
    const { stderr } = await runFfmpeg(["-hide_banner", "-i", inputPath, "-f", "null", "-"]);
    return parseFfmpegSummary(stderr);
  } catch {
    return null;
  }
}

async function probeViaFfprobe(inputPath) {
  const { stdout } = await runFfprobe([
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ]);
  const data = JSON.parse(stdout);
  const video = data.streams?.find((s) => s.codec_type === "video");
  const durationSec = parseFloat(data.format?.duration || video?.duration || "0");
  return {
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null,
    width: video?.width || null,
    height: video?.height || null,
    fps: parseFps(video?.avg_frame_rate || video?.r_frame_rate),
    hasAudio: (data.streams || []).some((s) => s.codec_type === "audio"),
    format: data.format?.format_name || null,
  };
}

function parseFfmpegSummary(stderr) {
  const text = String(stderr || "");
  const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSec = durMatch
    ? Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3])
    : null;
  let width = null;
  let height = null;
  let fpsText = null;
  const line = text.split("\r\n").concat(text.split("\n")).find((l) => /Video:\s/.test(l));
  if (line) {
    const sizeMatch = line.match(/(\d{2,5})x(\d{2,5})/);
    if (sizeMatch) {
      width = Number(sizeMatch[1]);
      height = Number(sizeMatch[2]);
    }
    const rateMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:fps|tbr)/);
    if (rateMatch) fpsText = String(rateMatch[1]);
  }
  const hasAudio = /\bAudio:\s/.test(text);
  return {
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null,
    width,
    height,
    fps: fpsText ? Number(fpsText) : null,
    hasAudio,
    format: null,
  };
}

function parseFps(rate) {
  if (!rate) return null;
  const [n, d] = String(rate).split("/").map((x) => parseFloat(x));
  if (d && d !== 0) return n / d;
  return null;
}