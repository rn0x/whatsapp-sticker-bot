import fallback from "../data/release.json";

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

// يجلب أحدث إصدار من GitHub API وقت البناء؛ يعود للبيانات الثابتة عند الفشل.
export async function getRelease(): Promise<ReleaseInfo> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ""}`,
        "User-Agent": "wsb-site",
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
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
