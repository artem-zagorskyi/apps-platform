"use client";
import * as React from "react";
import * as echarts from "echarts";
import { useTheme } from "next-themes";
import { buildEchartsTheme } from "@/lib/echarts-theme";

/**
 * ECharts wrapper that follows the CSS theme.
 * option: object or (theme) => object; theme._renvix.tokens has resolved colors (series[], heat[], success…).
 * <EChart height={220} option={(t) => ({ series: [{ type: "line", data, lineStyle: { color: t._renvix.tokens.series[0] } }] })} />
 */
export function EChart({ option, height = 220, className, onEvents }) {
  const ref = React.useRef(null), chart = React.useRef(null);
  const { resolvedTheme } = useTheme();
  const themeRef = React.useRef(null);

  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    themeRef.current = buildEchartsTheme(document.documentElement);
    chart.current = echarts.init(el, themeRef.current);
    const ro = new ResizeObserver(() => chart.current?.resize()); ro.observe(el);
    Object.entries(onEvents ?? {}).forEach(([n, fn]) => chart.current.on(n, fn));
    return () => { ro.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, [resolvedTheme]); // re-init with new colors on theme change

  React.useEffect(() => {
    if (!chart.current) return;
    chart.current.setOption(typeof option === "function" ? option(themeRef.current) : option, true);
  }, [option, resolvedTheme]);

  return <div ref={ref} style={{ height }} className={className} />;
}
