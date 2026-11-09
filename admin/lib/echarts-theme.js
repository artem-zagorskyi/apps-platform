// Builds an ECharts theme from the CSS variables of the current shadcn theme.
// ECharts can't parse oklch(), so every token is resolved to rgb() through a 1×1 canvas.
//
//   import * as echarts from "echarts";
//   import { buildEchartsTheme, onThemeChange } from "@/lib/echarts-theme";
//   let chart = echarts.init(el, buildEchartsTheme());
//   const stop = onThemeChange(() => { const opt = chart.getOption(); chart.dispose();
//     chart = echarts.init(el, buildEchartsTheme()); chart.setOption(opt); });

let ctx;
export function toRgb(color) {
  if (typeof document === "undefined") return color;
  ctx ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

export function alpha(rgb, a) {
  const m = rgb.match(/\d+(\.\d+)?/g);
  return m ? `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${a})` : rgb;
}

export function readTokens(el = typeof document !== "undefined" ? document.documentElement : null) {
  const cs = getComputedStyle(el);
  const v = (name) => toRgb(cs.getPropertyValue(`--${name}`).trim());
  return {
    background: v("background"), foreground: v("foreground"), card: v("card"),
    muted: v("muted"), mutedForeground: v("muted-foreground"), border: v("border"),
    popover: v("popover"), primary: v("primary"),
    success: v("success"), warning: v("warning"), destructive: v("destructive"),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`chart-${i}`)),
    heat: [0, 1, 2, 3, 4, 5].map((i) => v(`heat-${i}`)),
    fontSans: cs.getPropertyValue("--font-sans").trim() || "Inter, sans-serif",
    fontMono: cs.getPropertyValue("--font-mono").trim() || "JetBrains Mono, monospace",
  };
}

export function buildEchartsTheme(el) {
  const t = readTokens(el);
  const axis = {
    axisLine: { show: true, lineStyle: { color: t.border } },
    axisTick: { show: false },
    axisLabel: { color: t.mutedForeground, fontSize: 11, fontFamily: t.fontSans },
    splitLine: { show: true, lineStyle: { color: alpha(t.border, 0.7), type: [3, 3] } },
    splitArea: { show: false },
  };
  return {
    color: t.series,
    backgroundColor: "transparent",
    textStyle: { fontFamily: t.fontSans, color: t.foreground, fontSize: 12 },
    title: { textStyle: { color: t.foreground, fontSize: 13, fontWeight: 600 }, subtextStyle: { color: t.mutedForeground } },
    legend: { textStyle: { color: t.mutedForeground, fontSize: 12 }, icon: "roundRect", itemWidth: 10, itemHeight: 10, itemGap: 14 },
    grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: { ...axis, axisLine: { show: false } },
    timeAxis: { ...axis, splitLine: { show: false } },
    tooltip: {
      backgroundColor: t.popover, borderColor: t.border, borderWidth: 1, padding: [8, 10],
      textStyle: { color: t.foreground, fontSize: 12, fontFamily: t.fontSans },
      extraCssText: "border-radius:8px;box-shadow:0 8px 24px -12px rgba(0,0,0,.25);font-variant-numeric:tabular-nums;",
      axisPointer: { lineStyle: { color: t.mutedForeground, type: [3, 3] }, crossStyle: { color: t.mutedForeground } },
    },
    line: { symbol: "none", smooth: false, lineStyle: { width: 2 } },
    bar: { barMaxWidth: 18, itemStyle: { borderRadius: [3, 3, 0, 0] } },
    visualMap: { inRange: { color: t.heat.slice(1) }, textStyle: { color: t.mutedForeground } },
    funnel: { itemStyle: { borderColor: t.card, borderWidth: 2 }, label: { color: t.foreground } },
    geo: { itemStyle: { areaColor: t.muted, borderColor: t.border }, emphasis: { itemStyle: { areaColor: alpha(t.primary, 0.3) } } },
    // Shared change-marker style ("Config v42 published", "Release 1.4.0"). Use with markLine(markers, theme).
    _renvix: { tokens: t },
  };
}

// Vertical change markers, identical on every chart.
export function markLine(markers, theme) {
  const t = theme._renvix.tokens;
  return {
    silent: false, symbol: ["none", "none"],
    lineStyle: { color: t.mutedForeground, type: [4, 3], width: 1 },
    label: { show: true, position: "end", color: t.mutedForeground, fontSize: 11, fontFamily: t.fontMono, formatter: (p) => p.name, distance: 4 },
    emphasis: { lineStyle: { color: t.foreground, width: 1 } },
    tooltip: { show: true, formatter: (p) => `<b>${p.name}</b><br/>${p.data.detail ?? ""}` },
    data: markers.map((m) => ({ xAxis: m.x, name: m.label, detail: m.detail })),
  };
}

// Calls cb whenever <html> toggles the .dark class (next-themes / manual switch).
export function onThemeChange(cb, el = document.documentElement) {
  const mo = new MutationObserver(() => cb());
  mo.observe(el, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
  return () => mo.disconnect();
}
