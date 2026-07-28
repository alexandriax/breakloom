"use client";

import { useEffect, useRef } from "react";
import type { CircleMarker, LeafletMouseEvent, Polyline } from "leaflet";
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
  const selectionRouteRef = useRef<Polyline | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    coordinatesRef.current = { latitude, longitude };
    selectionRef.current?.setLatLng([latitude, longitude]);
    selectionRouteRef.current?.setLatLngs([
      [beach.lat, beach.lon],
      [latitude, longitude],
    ]);
  }, [beach.lat, beach.lon, latitude, longitude]);

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

      const coastMarker = L.circleMarker([beach.lat, beach.lon], {
        radius: 8,
        color: "rgba(5,20,27,.95)",
        weight: 3,
        fillColor: "#efc579",
        fillOpacity: 1,
        bubblingMouseEvents: false,
      }).addTo(map);
      coastMarker.bindTooltip(`<b>${beach.name}</b><br>Coast reference`, {
        direction: "top",
        opacity: 0.95,
      });
      coastMarker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
      });

      L.polyline(
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
          bubblingMouseEvents: false,
        }).addTo(map);
        marker.bindTooltip(`<b>${zone.name}</b><br>${zone.note}`, {
          direction: "top",
          opacity: 0.95,
        });
        marker.on("click", (event) => {
          // A vector layer click still reaches the map, whose own handler would
          // immediately overwrite this peak with a hand-placed paddle-out.
          L.DomEvent.stopPropagation(event);
          onSelectRef.current(zone.lat, zone.lon, zone.name);
        });
      });

      const selection = L.circleMarker([selected.latitude, selected.longitude], {
        radius: 14,
        color: "#ffffff",
        weight: 3,
        fillColor: "#ff6f4f",
        fillOpacity: 0.95,
        className: "map-pulse",
        bubblingMouseEvents: false,
      }).addTo(map);
      selection.bindTooltip("<b>Selected surf peak</b>", {
        direction: "top",
        opacity: 0.95,
      });
      selectionRef.current = selection;

      const selectionRoute = L.polyline(
        [
          [beach.lat, beach.lon],
          [selected.latitude, selected.longitude],
        ],
        { color: "#efc579", weight: 2, opacity: 0.72, dashArray: "4 8" },
      ).addTo(map).bringToBack();
      selectionRouteRef.current = selectionRoute;
      coastMarker.bringToFront();
      selection.bringToFront();

      map.on("click", (event: LeafletMouseEvent) => {
        selection.setLatLng(event.latlng);
        selectionRoute.setLatLngs([
          [beach.lat, beach.lon],
          event.latlng,
        ]);
        onSelectRef.current(event.latlng.lat, event.latlng.lng, "Custom surf peak");
      });

      const mapBounds = L.latLngBounds([
        [beach.lat, beach.lon],
        ...beach.zones.map((zone) => [zone.lat, zone.lon] as [number, number]),
      ]);
      map.fitBounds(mapBounds.pad(0.28), { animate: false });
      window.setTimeout(() => {
        if (!disposed) map.invalidateSize();
      }, 50);

      cleanup = () => {
        selectionRef.current = null;
        selectionRouteRef.current = null;
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
      <div
        ref={containerRef}
        className="world-map"
        aria-label={`Interactive coastline and surf peak map of ${beach.name}`}
      />
      <div className="map-crosshair" aria-hidden="true">
        <span />
      </div>
      <div className="map-guidance" aria-hidden="true">
        <span><i className="is-coast" /> Coast</span>
        <span><i className="is-peak" /> Surf peaks</span>
        <span><i className="is-selected" /> Selected</span>
      </div>
    </div>
  );
}
