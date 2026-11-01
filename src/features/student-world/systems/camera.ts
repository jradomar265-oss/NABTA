export type Camera = { x: number; y: number; zoom: number };

export const MIN_ZOOM = 0.9;
export const MAX_ZOOM = 3.4;

export function clampCamera(camera: Camera, viewW: number, viewH: number, worldW: number, worldH: number): Camera {
  const halfW = viewW / (2 * camera.zoom);
  const halfH = viewH / (2 * camera.zoom);
  const x = halfW * 2 >= worldW ? worldW / 2 : Math.min(worldW - halfW, Math.max(halfW, camera.x));
  const y = halfH * 2 >= worldH ? worldH / 2 : Math.min(worldH - halfH, Math.max(halfH, camera.y));
  return { x, y, zoom: camera.zoom };
}

/**
 * Frames the region at 1.75x the "whole world visible" zoom, so the first view is
 * a close, immersive crop of the world rather than the entire map shrunk to fit.
 */
export function fitCamera(viewW: number, viewH: number, worldW: number, worldH: number, focus?: { x: number; y: number }): Camera {
  const contain = Math.max(viewW / worldW, viewH / worldH);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, contain * 1.75));
  const camera = { x: focus?.x ?? worldW / 2, y: focus?.y ?? worldH / 2, zoom };
  return clampCamera(camera, viewW, viewH, worldW, worldH);
}

/** Zoom while keeping the world point under the pointer fixed on screen. */
export function zoomAtPoint(
  camera: Camera,
  nextZoom: number,
  pointerX: number,
  pointerY: number,
  viewW: number,
  viewH: number,
  worldW: number,
  worldH: number,
): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  const worldX = camera.x + (pointerX - viewW / 2) / camera.zoom;
  const worldY = camera.y + (pointerY - viewH / 2) / camera.zoom;
  return clampCamera(
    {
      x: worldX - (pointerX - viewW / 2) / zoom,
      y: worldY - (pointerY - viewH / 2) / zoom,
      zoom,
    },
    viewW,
    viewH,
    worldW,
    worldH,
  );
}

export function screenToWorld(camera: Camera, screenX: number, screenY: number, viewW: number, viewH: number) {
  return {
    x: camera.x + (screenX - viewW / 2) / camera.zoom,
    y: camera.y + (screenY - viewH / 2) / camera.zoom,
  };
}
