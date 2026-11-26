import { useRef, useEffect, useCallback } from 'react';

const MOVE_TOLERANCE = 10; // px of drift before a press is treated as a scroll

/**
 * Long-press detection for pointer devices.
 *
 * Spread `handlers` on the element. After the press fires, the click the browser
 * sends on release should be swallowed: call `consumeClick()` first in the click
 * handler and bail out if it returns true. With `contextMenu`, the native
 * contextmenu event (right click, Android long-press) also triggers `onLong`;
 * either way the native menu is suppressed.
 */
export function useLongPress(onLong, { ms = 600, contextMenu = false } = {}) {
  const timer = useRef(null);
  const fired = useRef(false);
  const origin = useRef(null);
  const onLongRef = useRef(onLong);

  useEffect(() => {
    onLongRef.current = onLong;
  });

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const handlers = {
    onPointerDown(e) {
      if (e.button > 0) return;
      cancel();
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongRef.current();
      }, ms);
    },
    onPointerMove(e) {
      if (!timer.current || !origin.current) return;
      if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > MOVE_TOLERANCE) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu(e) {
      e.preventDefault();
      if (contextMenu && !fired.current) {
        cancel();
        fired.current = true;
        onLongRef.current();
      }
    },
  };

  const consumeClick = () => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  };

  return { handlers, consumeClick };
}
