"use client";

import {
  APIProvider,
  InfoWindow,
  Map,
  Marker,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useState } from "react";

export type RouteMapStop = {
  id: string;
  lat: number;
  lng: number;
  shop_name: string;
  shop_address: string;
  legDriveSeconds: number | null;
  isLapsed: boolean;
};

export type RouteMapOrigin = {
  address: string;
  lat: number;
  lng: number;
};

type Props = {
  apiKey: string;
  origin: RouteMapOrigin;
  stops: RouteMapStop[];
  encodedPolyline: string | null;
};

const COLD_FILL = "#0284c7";   // sky-600 — cold prospect
const LAPSED_FILL = "#d97706"; // amber-600 — lapsed customer
const ORIGIN_FILL = "#4f46e5"; // indigo-600 — Hans's home

function formatHM(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function pinSvgDataUrl(fill: string, label: string): string {
  // Standard teardrop pin, white knockout circle, label text in fill color.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48">` +
    `<path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 30 18 30s18-16.5 18-30C36 8.06 27.94 0 18 0z" ` +
    `fill="${fill}" stroke="white" stroke-width="2"/>` +
    `<circle cx="18" cy="18" r="10" fill="white"/>` +
    `<text x="18" y="22" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" ` +
    `font-weight="700" fill="${fill}">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export default function RouteMap({ apiKey, origin, stops, encodedPolyline }: Props) {
  const center = useMemo(
    () => ({ lat: origin.lat, lng: origin.lng }),
    [origin.lat, origin.lng],
  );

  return (
    <APIProvider apiKey={apiKey} libraries={["geometry"]}>
      <div className="aspect-square md:aspect-[16/9] w-full overflow-hidden rounded-lg border border-slate-200">
        <Map
          defaultCenter={center}
          defaultZoom={9}
          gestureHandling="greedy"
          disableDefaultUI={false}
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={true}
          style={{ width: "100%", height: "100%" }}
        >
          <FitBounds origin={origin} stops={stops} />
          <OriginMarker origin={origin} />
          {stops.map((s, i) => (
            <StopMarker key={s.id} index={i} stop={s} />
          ))}
          <RoutePolyline
            encodedPolyline={encodedPolyline}
            origin={origin}
            stops={stops}
          />
        </Map>
      </div>
    </APIProvider>
  );
}

function OriginMarker({ origin }: { origin: RouteMapOrigin }) {
  return (
    <Marker
      position={{ lat: origin.lat, lng: origin.lng }}
      title={`Start/End — ${origin.address}`}
      icon={{ url: pinSvgDataUrl(ORIGIN_FILL, "S") }}
      zIndex={1000}
    />
  );
}

function StopMarker({ index, stop }: { index: number; stop: RouteMapStop }) {
  const [open, setOpen] = useState(false);
  const fill = stop.isLapsed ? LAPSED_FILL : COLD_FILL;
  return (
    <>
      <Marker
        position={{ lat: stop.lat, lng: stop.lng }}
        title={stop.shop_name}
        icon={{ url: pinSvgDataUrl(fill, String(index + 1)) }}
        onClick={() => setOpen(true)}
        zIndex={500 - index}
      />
      {open && (
        <InfoWindow
          position={{ lat: stop.lat, lng: stop.lng }}
          onCloseClick={() => setOpen(false)}
          pixelOffset={[0, -42]}
        >
          <div className="text-xs text-slate-800 max-w-[220px]">
            <div className="font-semibold mb-0.5">
              {index + 1}. {stop.shop_name}
            </div>
            <div className="text-slate-500 mb-1">{stop.shop_address}</div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: fill }}
              />
              <span className="uppercase text-[10px] tracking-wide text-slate-500">
                {stop.isLapsed ? "lapsed" : "cold"}
              </span>
              {stop.legDriveSeconds != null && (
                <span className="text-slate-500">
                  · drive {formatHM(stop.legDriveSeconds)}
                </span>
              )}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

function FitBounds({ origin, stops }: { origin: RouteMapOrigin; stops: RouteMapStop[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (typeof google === "undefined" || !google.maps) return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: origin.lat, lng: origin.lng });
    for (const s of stops) bounds.extend({ lat: s.lat, lng: s.lng });
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 64);
    }
  }, [map, origin.lat, origin.lng, stops]);
  return null;
}

function RoutePolyline({
  encodedPolyline,
  origin,
  stops,
}: {
  encodedPolyline: string | null;
  origin: RouteMapOrigin;
  stops: RouteMapStop[];
}) {
  const map = useMap();
  const geometry = useMapsLibrary("geometry");

  const fallbackPath = useMemo<google.maps.LatLngLiteral[] | null>(() => {
    if (encodedPolyline) return null;
    if (stops.length === 0) return null;
    const path: google.maps.LatLngLiteral[] = [{ lat: origin.lat, lng: origin.lng }];
    for (const s of stops) path.push({ lat: s.lat, lng: s.lng });
    path.push({ lat: origin.lat, lng: origin.lng });
    return path;
  }, [encodedPolyline, origin.lat, origin.lng, stops]);

  useEffect(() => {
    if (!map) return;
    if (typeof google === "undefined" || !google.maps) return;

    let path: google.maps.LatLng[] | google.maps.LatLngLiteral[] | null = null;

    if (encodedPolyline && geometry) {
      path = geometry.encoding.decodePath(encodedPolyline);
    } else if (fallbackPath) {
      if (encodedPolyline && !geometry) {
        // geometry library still loading — wait
        return;
      }
      if (!encodedPolyline) {
        console.warn(
          "[RouteMap] no encoded polyline in routes_api_response — falling back to straight lines",
        );
      }
      path = fallbackPath;
    }

    if (!path) return;

    const polyline = new google.maps.Polyline({
      path,
      strokeColor: "#4f46e5",
      strokeOpacity: 0.85,
      strokeWeight: 4,
      geodesic: !encodedPolyline, // straight-line fallback follows the curve of the earth
    });
    polyline.setMap(map);
    return () => {
      polyline.setMap(null);
    };
  }, [map, geometry, encodedPolyline, fallbackPath]);

  return null;
}
