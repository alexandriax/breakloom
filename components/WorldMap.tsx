"use client";

import { useEffect, useRef } from "react";
import type { CircleMarker, LeafletMouseEvent } from "leaflet";
import type { Beach } from "@/lib/beaches";

type WorldMapProps = {
  beach: Beach;
  latitude: number;
  longitude: number;
  onSelect: (latitude: number, longitude: number, label: string) => void;
};

export default function WorldMap({ beach, latitude, longitude, onSelect }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  const coordinatesRef = useRef({ latitude, longitude });
  const selectionRef = useRef<CircleMarker | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    coordinatesRef.current = { latitude, longitude };
    selectionRef.current?.setLatLng([latitude, longitude]);
  }, [latitude, longitude]);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let cleanup = () => {};

    void import("leaflet").then((leaflet) => {
      if (disposed || !containerRef.current) return;
      const L = leaflet.default;
      const selected = coordinatesRef.current;
      const map = L.map(containerRef.current, {
        center: [selected.latitude, selected.longitude],
        zoom: beach.zoom,
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: false,
      });

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);

      const zoneLine = L.polyline(
        beach.zones.map((zone) => [zone.lat, zone.lon] as [number, number]),
        { color: "#7ff7eb", weight: 3, opacity: 0.75, dashArray: "2 8" },
      ).addTo(map);

      beach.zones.forEach((zone) => {
        const marker = L.circleMarker([zone.lat, zone.lon], {
          radius: 7,
          color: "rgba(255,255,255,.92)",
          weight: 2,
          fillColor: "#0fd0bf",
          fillOpacity: 0.9,
        }).addTo(map);
        marker.bindTooltip(`<b>${zone.name}</b><br>${zone.note}`, {
          direction: "top",
          opacity: 0.95,
        });
        marker.on("click", () => onSelectRef.current(zone.lat, zone.lon, zone.name));
      });

      const selection = L.circleMarker([selected.latitude, selected.longitude], {
        radius: 14,
        color: "#ffffff",
        weight: 3,
        fillColor: "#ff6f4f",
        fillOpacity: 0.95,
        className: "map-pulse",
      }).addTo(map);
      selectionRef.current = selection;

      map.on("click", (event: LeafletMouseEvent) => {
        selection.setLatLng(event.latlng);
        onSelectRef.current(event.latlng.lat, event.latlng.lng, "Custom shoreline");
      });

      if (beach.zones.length > 1) {
        map.fitBounds(zoneLine.getBounds().pad(0.38), { animate: false });
      }
      window.setTimeout(() => {
        if (!disposed) map.invalidateSize();
      }, 50);

      cleanup = () => {
        selectionRef.current = null;
        map.remove();
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [beach]);

  return (
    <div className="map-shell">
      <div ref={containerRef} className="world-map" aria-label={`Interactive map of ${beach.name}`} />
      <div className="map-crosshair" aria-hidden="true">
        <span />
      </div>
      <div className="map-guidance">Tap the shoreline to set your paddle-out</div>
    </div>
  );
}
