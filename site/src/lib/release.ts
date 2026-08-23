import fallback from "../release-fallback.json";

export interface PlatformRelease {
  url: string;
  size: number;
}

export interface ReleaseInfo {
  tag: string;
  version: string;
  publishedAt: string;
  assets: Record<string, PlatformRelease>;
}

const REPO = "rn0x/whatsapp-sticker-bot";

function cmpTag(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

function mapAssets(assets: { name: string; browser_download_url: string; size: number }[]): Record<string, PlatformRelease> {
  const map: Record<string, PlatformRelease> = {};
  for (const a of assets) {
    const n = a.name.toLowerCase();
    if (n.endsWith(".blockmap") || n.startsWith("latest-") || n.endsWith(".yml")) continue;
    if (n.endsWith(".deb")) map.deb = { url: a.browser_download_url, size: a.size };
    else if (n.endsWith(".rpm")) map.rpm = { url: a.browser_download_url, size: a.size };
    else if (n.endsWith(".appimage")) map.appimage = { url: a.browser_download_url, size: a.size };
    else if (n.endsWith(".tar.gz")) map.targz = { url: a.browser_download_url, size: a.size };
    else if (n.endsWith(".flatpak")) map.flatpak = { url: a.browser_download_url, size: a.size };
    else if (n.endsWith(".snap")) map.snap = { url: a.browser_download_url, size: a.size };
    else if (n.endsWith(".dmg")) map.dmg = { url: a.browser_download_url, size: a.size };
    else if (n.endsWith(".exe")) map.exe = { url: a.browser_download_url, size: a.size };
  }
  return map;
}

// يجلب أحدث إصدار (حسب أعلى رقم semver) من GitHub API وقت البناء؛
// يعود للبيانات الثابتة عند الفشل.
export async function getRelease(): Promise<ReleaseInfo> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ""}`,
        "User-Agent": "wsb-site",
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const list = (await res.json()) as {
      tag_name: string;
      published_at: string;
      draft?: boolean;
      prerelease?: boolean;
      assets?: { name: string; browser_download_url: string; size: number }[];
    }[];
    const releases = list
      .filter((r) => !r.draft && !r.prerelease && (r.assets?.length ?? 0) > 0)
      .sort((a, b) => cmpTag(a.tag_name, b.tag_name));
    const data = releases[0];
    if (!data) throw new Error("no releases with assets");
    return {
      tag: data.tag_name,
      version: String(data.tag_name ?? "").replace(/^v/, ""),
      publishedAt: data.published_at,
      assets: mapAssets(data.assets ?? []),
    };
  } catch {
    return fallback as ReleaseInfo;
  }
}
