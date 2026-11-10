// The one repaint a frame, announced to the painter as frame-due

// coalesce bursty redraw sources (pointer moves, image loads) into one paint per frame
let drawPending = false;
export function scheduleDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    window.dispatchEvent(new Event("frame-due"));
  });
}
