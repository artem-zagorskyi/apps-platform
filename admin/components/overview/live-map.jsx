'use client';

import * as echarts from 'echarts';
import { useMemo } from 'react';
import { feature } from 'topojson-client';
import countries from 'world-atlas/countries-110m.json';
import { EChart } from '@/components/data/echart';
import { SourceTag } from '@/components/data/source-tag';
import { Card, CardHeader } from '@/components/ui/card';
import { appColor } from '@/lib/app-look';
import { toRgb } from '@/lib/echarts-theme';
import { num } from '@/lib/overview-format';

// Country outlines from Natural Earth (public domain), once per page load.
// Antarctica only takes space. Russia and Fiji cross the 180th meridian:
// their western points move past 180°, or a flat map draws lines across it.
const ANTARCTICA = '010';
const ACROSS_180 = new Set(['242', '643']);

let registered = false;
function registerWorld() {
  if (registered) return;
  const world = feature(countries, countries.objects.countries);
  world.features = world.features
    .filter((country) => country.id !== ANTARCTICA)
    .map((country) => {
      if (!ACROSS_180.has(country.id)) return country;
      const shift = (ring) => ring.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat]);
      const { type, coordinates } = country.geometry;
      const moved = type === 'Polygon' ? coordinates.map(shift) : coordinates.map((polygon) => polygon.map(shift));
      return { ...country, geometry: { type, coordinates: moved } };
    });
  echarts.registerMap('world', world);
  registered = true;
}

const size = (count) => 7 + Math.sqrt(count) * 4;

/**
 * live: { total, unplaced, points: [{ appSlug, country, city, lat, lon, count }] }
 * apps: the apps on the page ({ slug, name, status })
 */
export function LiveMap({ live, apps, consentRate, showLegend }) {
  registerWorld();
  const series = useMemo(
    () =>
      apps
        .map((app) => ({ app, points: live.points.filter((point) => point.appSlug === app.slug) }))
        // Disabled apps have nobody to show
        .filter(({ app, points }) => points.length > 0 || (showLegend && app.status === 'active')),
    [apps, live.points, showLegend],
  );

  const option = (theme) => {
    const t = theme._renvix.tokens;
    return {
      tooltip: {
        trigger: 'item',
        formatter: (item) => {
          const [, , count, country, city, appName] = item.value;
          const place = [city, country].filter(Boolean).join(', ') || 'Unknown place';
          return `<b>${place}</b><br/>${num(count)} ${count === 1 ? 'person' : 'people'} now${showLegend ? ` · ${appName}` : ''}`;
        },
      },
      legend: showLegend ? { bottom: 4, left: 8, data: series.map(({ app }) => app.name) } : undefined,
      geo: {
        map: 'world',
        roam: true,
        // The inhabited part of the world, from Alaska to New Zealand
        boundingCoords: [
          [-168, 78],
          [192, -56],
        ],
        scaleLimit: { min: 1, max: 12 },
        top: 8,
        bottom: showLegend ? 32 : 8,
        silent: true,
        itemStyle: { areaColor: t.muted, borderColor: t.border, borderWidth: 0.6 },
      },
      series: series.map(({ app, points }) => ({
        name: app.name,
        type: 'scatter',
        coordinateSystem: 'geo',
        data: points.map((point) => [point.lon, point.lat, point.count, point.country, point.city, app.name]),
        symbolSize: (value) => size(value[2]),
        itemStyle: { color: toRgb(appColor(app)), opacity: 0.85, borderColor: t.card, borderWidth: 1 },
        emphasis: { scale: 1.2 },
      })),
    };
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            Right now · {num(live.total)} {live.total === 1 ? 'person' : 'people'}
          </span>
        }
        description="Active in the last 30 minutes, by city. Only people who consented to analytics; drag and scroll to move and zoom."
        actions={consentRate != null && <SourceTag kind="analytics" rate={Math.round(consentRate * 100)} />}
      />
      <div className="relative border-t border-border">
        <EChart height={380} option={option} />
        {live.total === 0 && (
          <span className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[0.8125rem] text-muted-foreground">
            Nobody with analytics consent is using {apps.length === 1 ? 'the app' : 'the apps'} right now.
          </span>
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-border px-4 py-2 text-[0.6875rem] text-muted-foreground">
        <span>
          {live.unplaced > 0
            ? `${num(live.unplaced)} more without a known city or in groups too small to show`
            : 'City centres, never exact positions'}
        </span>
        <a href="https://db-ip.com" target="_blank" rel="noreferrer" className="hover:underline">
          IP geolocation by DB-IP
        </a>
      </div>
    </Card>
  );
}
