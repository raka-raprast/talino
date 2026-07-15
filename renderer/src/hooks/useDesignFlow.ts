import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { DesignConfig, DesignPageMeta, DesignPagePosition } from '../types/api';

// ============================================================================
// Design Mode — Prototype view (DESIGN_MODE_PLAN.md §7, revised). Derived
// hook, not a competing data source: takes the page list + config already
// owned by useDesign() and turns them into a positioned grid of pages, plus
// lazy thumbnail capture off the single live-preview <webview> DesignView.tsx
// already owns.
//
// Deliberately NO edges/navigation graph — see DESIGN_MODE_PLAN.md §11.
// Multiple buttons on one page can all target the same page, which made a
// <Link>-derived edge graph ambiguous (one line? one per button?) without
// buying anything Design Mode actually needs yet. This view is purely a
// spatial arrangement of pages so they're easy to see and compare, with grid
// snapping so they stay tidy — not a prototyping/flow tool.
// ============================================================================

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 140;
export const GRID_SIZE = 20;
// Deliberate fixed delay, not a hot loop — one-shot capture pass triggered
// on entering Prototype mode, giving each page's fresh build a moment to
// paint before capturePage() grabs a frame.
const THUMBNAIL_RENDER_DELAY_MS = 220;

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export interface DesignFlowNode {
  slug: string;
  title: string;
  position: DesignPagePosition;
}

// Imperative surface DesignView.tsx's single live-preview <webview> exposes
// to this hook for thumbnail capture — deliberately not a raw element ref so
// this hook stays agnostic of the WebviewTag/electron type and DesignView
// keeps sole ownership of the (one, shared) webview instance. Each page is
// its own bundle now (no in-bundle hash router), so capturing a page means
// actually loading its preview URL, not flipping a hash.
export interface WebviewFlowHandle {
  loadPreview: (previewUrl: string) => Promise<void>;
  // Already converted via nativeImage.toDataURL() — never a NativeImage.
  capturePage: () => Promise<string>;
}

// Plain grid for pages without a saved position — no edges to optimize
// around, so there's no reason for a graph-layout algorithm here. Shifted
// clear of the pinned nodes' bounding box so a fresh page never lands on
// top of one the user already dragged.
const GRID_COLS = 4;
function layoutUnpinned(
  pages: DesignPageMeta[],
  pinned: Record<string, DesignPagePosition>,
): Record<string, DesignPagePosition> {
  const unpinnedSlugs = pages.map((p) => p.slug).filter((slug) => !pinned[slug]);
  if (unpinnedSlugs.length === 0) return {};

  const colGap = NODE_WIDTH + 60;
  const rowGap = NODE_HEIGHT + 60;
  const positions: Record<string, DesignPagePosition> = {};
  unpinnedSlugs.forEach((slug, i) => {
    positions[slug] = { x: (i % GRID_COLS) * colGap, y: Math.floor(i / GRID_COLS) * rowGap };
  });

  const pinnedSlugs = Object.keys(pinned);
  if (pinnedSlugs.length > 0) {
    const maxPinnedX = Math.max(...pinnedSlugs.map((s) => pinned[s].x + NODE_WIDTH));
    const minLayoutX = Math.min(...unpinnedSlugs.map((s) => positions[s].x));
    const dx = maxPinnedX + 80 - minLayoutX;
    if (dx > 0) {
      for (const slug of unpinnedSlugs) positions[slug].x += dx;
    }
  }
  return positions;
}

export interface UseDesignFlowReturn {
  nodes: DesignFlowNode[];
  thumbnails: Record<string, string>;
  thumbnailsLoading: boolean;
  captureThumbnails: () => Promise<void>;
  savePosition: (slug: string, pos: DesignPagePosition) => Promise<void>;
}

export function useDesignFlow(
  root: string | null,
  pages: DesignPageMeta[],
  config: DesignConfig | null,
  // The main preview's currently-loaded URL (useDesign's build?.previewUrl)
  // — restored into the shared webview once the capture pass finishes, so
  // Prototype mode never leaves the live-preview pane pointed at whatever
  // page happened to be captured last.
  activePreviewUrl: string | null,
  webview: WebviewFlowHandle | null,
): UseDesignFlowReturn {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [thumbnailsLoading, setThumbnailsLoading] = useState(false);
  // Optimistic client-side pin, applied immediately on drop and layered over
  // `config.pages` — designSavePositions doesn't push a fresh DesignConfig
  // back through useDesign(), so without this a drag would appear to revert
  // the moment the user leaves and re-enters Prototype mode within the same
  // session, even though the write to config.json already succeeded.
  const [positionOverrides, setPositionOverrides] = useState<Record<string, DesignPagePosition>>({});
  const capturingRef = useRef(false);

  useEffect(() => { setPositionOverrides({}); }, [root]);

  // Config on disk (or an in-session override) could in principle hold a
  // corrupted/non-finite position — never trust it blindly into ReactFlow,
  // since a single NaN position poisons its internal viewport transform
  // (every node/edge/background SVG attr becomes "NaN" and never recovers
  // without a remount). Treat an invalid entry as unpinned instead.
  const isValidPosition = (p: DesignPagePosition | undefined): p is DesignPagePosition =>
    !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

  const pinned = useMemo<Record<string, DesignPagePosition>>(() => {
    const merged = { ...(config?.pages ?? {}), ...positionOverrides };
    const valid: Record<string, DesignPagePosition> = {};
    for (const [slug, pos] of Object.entries(merged)) {
      if (isValidPosition(pos)) valid[slug] = pos;
    }
    return valid;
  }, [config, positionOverrides]);

  const nodes = useMemo<DesignFlowNode[]>(() => {
    const autoPositions = layoutUnpinned(pages, pinned);
    return pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      position: pinned[p.slug] ?? autoPositions[p.slug] ?? { x: 0, y: 0 },
    }));
  }, [pages, pinned]);

  const captureThumbnails = useCallback(async () => {
    if (!webview || !root || capturingRef.current || pages.length === 0) return;
    capturingRef.current = true;
    setThumbnailsLoading(true);
    try {
      const next: Record<string, string> = {};
      for (const page of pages) {
        const result = await api.designBuild(root, page.slug);
        if (!result.success || !result.previewUrl) continue;
        await webview.loadPreview(result.previewUrl);
        await delay(THUMBNAIL_RENDER_DELAY_MS);
        try {
          next[page.slug] = await webview.capturePage();
        } catch {
          // Leave this slug unset — FlowView renders its placeholder box.
        }
      }
      setThumbnails(next);
    } finally {
      if (activePreviewUrl) await webview.loadPreview(activePreviewUrl);
      setThumbnailsLoading(false);
      capturingRef.current = false;
    }
  }, [webview, pages, root, activePreviewUrl]);

  const savePosition = useCallback(async (slug: string, pos: DesignPagePosition) => {
    setPositionOverrides((prev) => ({ ...prev, [slug]: pos }));
    if (!root) return;
    await api.designSavePositions(root, { [slug]: pos });
  }, [root]);

  return { nodes, thumbnails, thumbnailsLoading, captureThumbnails, savePosition };
}
