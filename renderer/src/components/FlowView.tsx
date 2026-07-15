import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState,
  type Node, type NodeProps, type NodeTypes, type OnNodeDrag, type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FileText, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { NODE_WIDTH, NODE_HEIGHT, GRID_SIZE, type DesignFlowNode } from '../hooks/useDesignFlow';
import type { DesignPagePosition } from '../types/api';

// ============================================================================
// Design Mode — Prototype view (DESIGN_MODE_PLAN.md §7, revised): a spatial
// arrangement of pages to view/compare them, NOT a navigation/flow graph —
// no edges, no connection handles (see DESIGN_MODE_PLAN.md §11 for why the
// earlier <Link>-derived edge graph was dropped). Pure presentational
// component — all data (nodes/thumbnails) and IO (capture, position
// persistence) are owned by DesignView.tsx's useDesignFlow() call and
// passed in as props. Grid snapping (snapToGrid/snapGrid below) keeps
// dragged pages tidy without needing alignment-guide logic.
// ============================================================================

export interface FlowViewProps {
  nodes: DesignFlowNode[];
  thumbnails: Record<string, string>;
  thumbnailsLoading: boolean;
  captureThumbnails: () => Promise<void>;
  savePosition: (slug: string, pos: DesignPagePosition) => Promise<void>;
  onSelectPage: (slug: string) => void;
}

interface PageNodeData extends Record<string, unknown> {
  title: string;
  thumbnail?: string;
  loading: boolean;
}
type PageFlowNode = Node<PageNodeData, 'page'>;

function PageNode({ data, selected }: NodeProps<PageFlowNode>) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-md border bg-card shadow-sm',
        selected ? 'border-primary ring-1 ring-primary/50' : 'border-border',
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <div className="flex flex-1 items-center justify-center overflow-hidden bg-muted/40">
        {data.thumbnail ? (
          <img src={data.thumbnail} alt={data.title} className="h-full w-full object-cover object-top" draggable={false} />
        ) : data.loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <FileText className="h-5 w-5 text-muted-foreground opacity-40" />
        )}
      </div>
      <div className="truncate border-t border-border bg-card px-2 py-1 text-xs font-medium text-foreground">{data.title}</div>
    </div>
  );
}

const nodeTypes: NodeTypes = { page: PageNode };

export function FlowView({
  nodes, thumbnails, thumbnailsLoading, captureThumbnails, savePosition, onSelectPage,
}: FlowViewProps) {
  // Lazy per DESIGN_MODE_PLAN.md §7: only fires when this view actually
  // mounts (Prototype mode entered), not on every nodes recompute.
  useEffect(() => {
    void captureThumbnails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Positions live in local, draggable state (seeded from + resynced with
  // the `nodes` prop) so ReactFlow's own drag handling stays smooth;
  // thumbnails are merged in separately at render time below so a capture
  // completing mid-drag never resets node positions.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<PageFlowNode>(nodes.map((n) => ({
    id: n.slug, type: 'page', position: n.position, data: { title: n.title, loading: false },
  })));

  useEffect(() => {
    setRfNodes((prev) => nodes.map((n) => {
      const existing = prev.find((p) => p.id === n.slug);
      return { id: n.slug, type: 'page', position: existing?.position ?? n.position, data: { title: n.title, loading: false } };
    }));
  }, [nodes, setRfNodes]);

  const flowNodes = useMemo<PageFlowNode[]>(() => rfNodes.map((n) => ({
    ...n,
    data: { ...n.data, thumbnail: thumbnails[n.id], loading: thumbnailsLoading && !thumbnails[n.id] },
  })), [rfNodes, thumbnails, thumbnailsLoading]);

  const handleNodeDragStop = useCallback<OnNodeDrag<PageFlowNode>>((_event, node) => {
    void savePosition(node.id, { x: node.position.x, y: node.position.y });
  }, [savePosition]);

  const handleNodeClick = useCallback<NodeMouseHandler<PageFlowNode>>((_event, node) => {
    onSelectPage(node.id);
  }, [onSelectPage]);

  if (flowNodes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
        No pages to arrange yet.
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-background">
      <ReactFlow
        nodes={flowNodes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick}
        snapToGrid
        snapGrid={[GRID_SIZE, GRID_SIZE]}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        fitView
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
