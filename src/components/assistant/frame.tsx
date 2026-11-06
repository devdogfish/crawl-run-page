import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { Box, CloseButton, FloatingPanel, IconButton, Text } from "@chakra-ui/react";
import { LuExternalLink, LuGrip, LuPanelLeft, LuPanelRight } from "react-icons/lu";
import { Tooltip } from "@/components/ui/tooltip";

export type Placement = "left" | "right" | "floating";
type Point = { x: number; y: number };
type Size = { width: number; height: number };

export function dockingEdge(position: Point, size: Size, viewportWidth: number, previous: "left" | "right" | null = null) {
  const threshold = previous ? 48 : 24;
  if (position.x <= threshold) return "left";
  if (viewportWidth - position.x - size.width <= threshold) return "right";
  return null;
}

// One mounted panel: changing placement keeps the editor, scroll position and active reply intact.
export function AssistantFrame({ placement, onPlacementChange, onClose, actions, children }: {
  placement: Placement; onPlacementChange: (placement: Placement) => void; onClose: () => void; actions?: ReactNode; children: ReactNode;
}) {
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [position, setPosition] = useState<Point>(() => ({ x: Math.max(12, window.innerWidth - 468), y: 88 }));
  const [size, setSize] = useState<Size>({ width: 420, height: 600 });
  const [preview, setPreview] = useState<"left" | "right" | null>(null);
  const candidate = useRef<"left" | "right" | null>(null);
  const dragging = useRef(false);
  const releaseTear = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseTear.current?.(), []);
  const floating = placement === "floating";
  const dockWidth = viewport.width < 768 ? viewport.width : 400;
  const floatingSize = { width: Math.min(size.width, viewport.width - 24), height: Math.min(size.height, viewport.height - 24) };
  const floatingPosition = { x: Math.max(0, Math.min(position.x, viewport.width - floatingSize.width)), y: Math.max(0, Math.min(position.y, viewport.height - floatingSize.height)) };

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const dock = (side: "left" | "right") => {
    dragging.current = false; candidate.current = null; setPreview(null); onPlacementChange(side);
  };
  const detach = () => {
    setPosition({ x: placement === "left" ? 48 : Math.max(12, viewport.width - floatingSize.width - 48), y: 88 });
    onPlacementChange("floating");
  };

  const startHeaderDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (floating) { dragging.current = true; return; }
    // Keep the initial tear-off gesture captured through the dock → window change.
    event.stopPropagation();
    releaseTear.current?.();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    target.setPointerCapture(pointerId);
    const start = { x: event.clientX, y: event.clientY };
    const dockX = placement === "left" ? 0 : viewport.width - dockWidth;
    const offsetX = Math.min(start.x - dockX, floatingSize.width - 48);
    let torn = false;
    let latest = position;
    const clear = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      releaseTear.current = null;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!torn && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
      if (!torn) { torn = true; onPlacementChange("floating"); }
      latest = {
        x: Math.max(0, Math.min(e.clientX - offsetX, viewport.width - floatingSize.width)),
        y: Math.max(0, Math.min(e.clientY - start.y, viewport.height - floatingSize.height)),
      };
      setPosition(latest);
      const edge = dockingEdge(latest, floatingSize, viewport.width, candidate.current);
      candidate.current = edge; setPreview(edge);
    };
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      clear();
      const edge = torn ? dockingEdge(latest, floatingSize, viewport.width, candidate.current) : null;
      candidate.current = null; setPreview(null);
      if (edge) dock(edge);
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      clear(); candidate.current = null; setPreview(null);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
    releaseTear.current = clear;
  };

  return <>
    {preview && <Box position="fixed" top="2" bottom="2" left={preview === "left" ? "2" : undefined} right={preview === "right" ? "2" : undefined}
      w={`${Math.max(0, dockWidth - 16)}px`} bg="blue.subtle" opacity={0.65} borderWidth="1px" borderColor="blue.fg" rounded="l3" zIndex="overlay" pointerEvents="none"
      display="flex" justifyContent="center" alignItems="center" aria-hidden>
      <Text bg="bg.panel" px="3" py="2" rounded="l2" textStyle="sm" shadow="sm">Release to dock {preview}</Text>
    </Box>}
    <FloatingPanel.Root open onOpenChange={(e) => { if (!e.open) onClose(); }} initialFocusEl={() => false}
      draggable={floating} resizable={floating} allowOverflow={false}
      position={floating ? floatingPosition : { x: placement === "left" ? 0 : viewport.width - dockWidth, y: 0 }}
      size={floating ? floatingSize : { width: dockWidth, height: viewport.height }}
      minSize={{ width: Math.min(320, viewport.width - 24), height: Math.min(300, viewport.height - 24) }}
      onPositionChange={({ position: next }) => {
        if (!floating || !dragging.current) return;
        setPosition(next);
        const edge = dockingEdge(next, floatingSize, viewport.width, candidate.current);
        candidate.current = edge; setPreview(edge);
      }}
      onPositionChangeEnd={({ position: next }) => {
        if (!floating || !dragging.current) return;
        const edge = dockingEdge(next, floatingSize, viewport.width, candidate.current);
        dragging.current = false; candidate.current = null; setPreview(null);
        if (edge) dock(edge);
      }}
      onSizeChange={({ size: next }) => { if (floating) setSize(next); }}>
      <FloatingPanel.Positioner style={{ zIndex: "var(--chakra-z-index-overlay)" }}>
        <FloatingPanel.Content data-placement={placement} bg="bg" rounded={floating ? "l3" : "0"} borderWidth="1px" borderTopWidth={floating ? "1px" : "0"} shadow={floating ? "2xl" : "none"}
          animation="none" display="flex" flexDirection="column">
          <FloatingPanel.Header px="3" py="0" h={floating ? "12" : "var(--app-header-height, 57px)"} bg="bg">
            <FloatingPanel.DragTrigger style={{ cursor: "grab" }} onPointerDownCapture={startHeaderDrag}
              onPointerCancel={() => { dragging.current = false; candidate.current = null; setPreview(null); }}>
              {floating && <LuGrip aria-hidden />}
              <FloatingPanel.Title fontWeight="medium">Ask AI</FloatingPanel.Title>
            </FloatingPanel.DragTrigger>
            <FloatingPanel.Control gap="0.5">
              {actions}
              {floating ? <>
                <Tooltip content="Dock left"><IconButton size="xs" variant="ghost" aria-label="Dock assistant left" onClick={() => dock("left")}><LuPanelLeft /></IconButton></Tooltip>
                <Tooltip content="Dock right"><IconButton size="xs" variant="ghost" aria-label="Dock assistant right" onClick={() => dock("right")}><LuPanelRight /></IconButton></Tooltip>
              </> : <Tooltip content="Detach window"><IconButton size="xs" variant="ghost" aria-label="Detach assistant" onClick={detach}><LuExternalLink /></IconButton></Tooltip>}
              <CloseButton size="xs" onClick={onClose} aria-label="Close" />
            </FloatingPanel.Control>
          </FloatingPanel.Header>
          {children}
          {floating && <FloatingPanel.ResizeTriggers />}
        </FloatingPanel.Content>
      </FloatingPanel.Positioner>
    </FloatingPanel.Root>
  </>;
}
