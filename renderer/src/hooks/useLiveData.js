import { useEffect, useRef } from "react";
import { api } from "../ctx.js";

// تحميل حيّ مزدوج:
//  1) دفع من الخادم ("overview:tick" كل ثانيتين) — التحديث الفوري المضمون.
//  2) استطلاع دوري احتياطي عبر `interval`.
// حماية تداخل: طلب واحد فقط في كل لحظة؛ يبدأ فوراً على التركيب.
export function useLiveData(loader, { interval = 5000, enabled = true } = {}) {
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;

    const run = async (source) => {
      if (busy.current || !live) return;
      busy.current = true;
      try {
        await loader(source);
      } catch {
        // أخطاء دورة تحديث تُتجاهل حتى لا تكسر التتابع.
      } finally {
        busy.current = false;
      }
    };

    run("mount");
    const iv = setInterval(() => run("interval"), interval);
    const off = api.on("overview:tick", () => run("push"));
    return () => {
      live = false;
      busy.current = false;
      clearInterval(iv);
      if (off) off();
    };
  }, [loader, interval, enabled]);
}