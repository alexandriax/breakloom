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

function accessForPeak(beach: Beach, latitude: number, longitude: number) {
  const exact = beach.zones.find(
    (zone) => Math.abs(zone.lat - latitude) < .00001 && Math.abs(zone.lon - longitude) < .00001,
  );
  if (exact) return exact.access;
  return beach.zones.reduce((closest, zone) => {
    const distance = Math.hypot(zone.lat - latitude, zone.lon - longitude);
    const closestDistance = Math.hypot(closest.lat - latitude, closest.lon - longitude);
    return distance < closestDistance ? zone : closest;
  }).access;
}

export default function WorldMap({ beach, latitude, longitude, onSelect }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  const coordinatesRef = useRef({ latitude, longitude });
  const selectionRef = useRef<CircleMarker | null>(null);
  const selectionRouteRef = useRef<Polyline | null>(null);
  const refreshMarkerLayoutRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    coordinatesRef.current = { latitude, longitude };
    const access = accessForPeak(beach, latitude, longitude);
    selectionRouteRef.current?.setLatLngs([
      [access.lat, access.lon],
      [latitude, longitude],
    ]);
    refreshMarkerLayoutRef.current?.();
  }, [beach, latitude, longitude]);

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

      const accessMarkers: CircleMarker[] = [];
      const peakMarkers: CircleMarker[] = [];
      const peakLeaders: Polyline[] = [];
      beach.zones.forEach((zone) => {
        L.polyline(
          [
            [zone.access.lat, zone.access.lon],
            [zone.lat, zone.lon],
          ],
          {
            color: zone.access.towRecommended ? "#ff9d69" : "#efc579",
            weight: zone.access.towRecommended ? 2.4 : 1.6,
            opacity: zone.access.towRecommended ? .72 : .38,
            dashArray: zone.access.towRecommended ? "3 7" : "2 8",
          },
        ).addTo(map).bringToBack();

        const accessMarker = L.circleMarker([zone.access.lat, zone.access.lon], {
          radius: zone.access.towRecommended ? 9 : 7,
          color: zone.access.towRecommended ? "#ff9d69" : "rgba(5,20,27,.95)",
          weight: 3,
          fillColor: "#efc579",
          fillOpacity: 1,
          bubblingMouseEvents: false,
        }).addTo(map);
        accessMarker.bindTooltip(
          `<b>${zone.access.name}</b><br>${zone.name} beach access`
          + `<br>${zone.access.towRecommended ? "Tow recommended for this break" : "Optional jetski tow available"}`,
          { direction: "top", opacity: 0.95 },
        );
        accessMarker.on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          onSelectRef.current(zone.lat, zone.lon, zone.name);
        });
        accessMarkers.push(accessMarker);

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
        peakMarkers.push(marker);
        peakLeaders.push(L.polyline(
          [
            [zone.lat, zone.lon],
            [zone.lat, zone.lon],
          ],
          {
            color: "#78e7de",
            weight: 1.2,
            opacity: 0,
            dashArray: "2 4",
            interactive: false,
          },
        ).addTo(map).bringToBack());
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

      const selectedAccess = accessForPeak(beach, selected.latitude, selected.longitude);
      const selectionRoute = L.polyline(
        [
          [selectedAccess.lat, selectedAccess.lon],
          [selected.latitude, selected.longitude],
        ],
        { color: "#efc579", weight: 2, opacity: 0.72, dashArray: "4 8" },
      ).addTo(map).bringToBack();
      selectionRouteRef.current = selectionRoute;

      const refreshMarkerLayout = () => {
        const selectedCoordinates = coordinatesRef.current;
        const exactSelectedIndex = beach.zones.findIndex(
          (zone) => Math.abs(zone.lat - selectedCoordinates.latitude) < .00001
            && Math.abs(zone.lon - selectedCoordinates.longitude) < .00001,
        );
        const occupied = accessMarkers.map((marker) => map.latLngToLayerPoint(marker.getLatLng()));
        const displayPoints = beach.zones.map((zone, zoneIndex) => {
          const accessPoint = map.latLngToLayerPoint([zone.access.lat, zone.access.lon]);
          const truePeakPoint = map.latLngToLayerPoint([zone.lat, zone.lon]);
          const point = truePeakPoint.clone();
          let direction = point.subtract(accessPoint);
          if (direction.distanceTo(L.point(0, 0)) < 1) {
            const angle = (zoneIndex / Math.max(1, beach.zones.length)) * Math.PI * 2 - Math.PI / 2;
            direction = L.point(Math.cos(angle), Math.sin(angle));
          }
          const directionLength = Math.max(1, direction.distanceTo(L.point(0, 0)));
          const outward = L.point(direction.x / directionLength, direction.y / directionLength);
          const pairedMinimum = zoneIndex === exactSelectedIndex ? 52 : 34;
          if (truePeakPoint.distanceTo(accessPoint) < pairedMinimum) {
            point.x = accessPoint.x + outward.x * pairedMinimum;
            point.y = accessPoint.y + outward.y * pairedMinimum;
          }

          // Entry positions remain exact. Only crowded peak symbols move, with
          // a leader back to their real water coordinate.
          for (let pass = 0; pass < 8; pass += 1) {
            let adjusted = false;
            occupied.forEach((other, otherIndex) => {
              const minimum = otherIndex < accessMarkers.length
                ? zoneIndex === exactSelectedIndex ? 52 : 32
                : 24;
              const distance = point.distanceTo(other);
              if (distance >= minimum) return;
              let repel = point.subtract(other);
              if (repel.distanceTo(L.point(0, 0)) < .5) {
                const angle = (zoneIndex + pass * .37) * 2.399963;
                repel = L.point(Math.cos(angle), Math.sin(angle));
              }
              const repelLength = Math.max(.5, repel.distanceTo(L.point(0, 0)));
              point.x += (repel.x / repelLength) * (minimum - distance + 1);
              point.y += (repel.y / repelLength) * (minimum - distance + 1);
              adjusted = true;
            });
            if (!adjusted) break;
          }
          occupied.push(point.clone());
          return point;
        });

        displayPoints.forEach((point, index) => {
          const displayLatLng = map.layerPointToLatLng(point);
          peakMarkers[index].setLatLng(displayLatLng);
          const trueLatLng = L.latLng(beach.zones[index].lat, beach.zones[index].lon);
          const offset = point.distanceTo(map.latLngToLayerPoint(trueLatLng));
          peakLeaders[index].setLatLngs([trueLatLng, displayLatLng]);
          peakLeaders[index].setStyle({ opacity: offset > 3 ? .72 : 0 });
        });

        let selectedDisplayPoint = exactSelectedIndex >= 0
          ? displayPoints[exactSelectedIndex]
          : map.latLngToLayerPoint([selectedCoordinates.latitude, selectedCoordinates.longitude]);
        if (exactSelectedIndex < 0) {
          const nearestAccess = accessForPeak(
            beach,
            selectedCoordinates.latitude,
            selectedCoordinates.longitude,
          );
          const accessPoint = map.latLngToLayerPoint([nearestAccess.lat, nearestAccess.lon]);
          const distance = selectedDisplayPoint.distanceTo(accessPoint);
          if (distance < 52) {
            let direction = selectedDisplayPoint.subtract(accessPoint);
            if (direction.distanceTo(L.point(0, 0)) < 1) direction = L.point(0, -1);
            const length = Math.max(1, direction.distanceTo(L.point(0, 0)));
            selectedDisplayPoint = L.point(
              accessPoint.x + (direction.x / length) * 52,
              accessPoint.y + (direction.y / length) * 52,
            );
          }
        }
        selection.setLatLng(map.layerPointToLatLng(selectedDisplayPoint));
        accessMarkers.forEach((marker) => marker.bringToFront());
        selection.bringToFront();
      };
      refreshMarkerLayoutRef.current = refreshMarkerLayout;

      map.on("click", (event: LeafletMouseEvent) => {
        const nearestAccess = accessForPeak(beach, event.latlng.lat, event.latlng.lng);
        selectionRoute.setLatLngs([
          [nearestAccess.lat, nearestAccess.lon],
          event.latlng,
        ]);
        onSelectRef.current(event.latlng.lat, event.latlng.lng, "Custom surf peak");
      });

      const mapBounds = L.latLngBounds([
        ...beach.zones.map((zone) => [zone.lat, zone.lon] as [number, number]),
        ...beach.zones.map((zone) => [zone.access.lat, zone.access.lon] as [number, number]),
      ]);
      map.fitBounds(mapBounds.pad(0.28), { animate: false });
      map.on("zoomend moveend", refreshMarkerLayout);
      refreshMarkerLayout();
      window.setTimeout(() => {
        if (!disposed) {
          map.invalidateSize();
          refreshMarkerLayout();
        }
      }, 50);

      cleanup = () => {
        selectionRef.current = null;
        selectionRouteRef.current = null;
        refreshMarkerLayoutRef.current = null;
        map.off("zoomend moveend", refreshMarkerLayout);
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
        aria-label={`Interactive beach-entry and surf-peak map of ${beach.name}`}
      />
      <div className="map-crosshair" aria-hidden="true">
        <span />
      </div>
      <div className="map-guidance" aria-hidden="true">
        <span><i className="is-coast" /> Beach entries</span>
        <span><i className="is-peak" /> Surf peaks</span>
        <span><i className="is-selected" /> Selected</span>
      </div>
    </div>
  );
}
