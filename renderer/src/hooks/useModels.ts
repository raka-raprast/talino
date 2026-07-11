import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { isRecord } from '../lib/guards';

// A discoverable model as returned by `model:list`. The IPC payload is richer
// than the typed `string[]` contract, so it is narrowed defensively.
export interface ModelEntry {
  selector: string;
  name: string;
  provider: string;
  vision: boolean;
  contextWindow?: number;
}

// Shared current-model + model-list state, backing both the Settings model
// picker and the status bar model selector so they never drift out of sync.
export function useModels() {
  const [model, setModelState] = useState('');
  const [models, setModels] = useState<ModelEntry[]>([]);

  const reload = useCallback(async () => {
    try {
      const raw = await api.listModels();
      const list: ModelEntry[] = [];
      if (Array.isArray(raw)) {
        for (const m of raw) {
          if (!isRecord(m)) continue;
          if (typeof m.selector !== 'string') continue;
          if (typeof m.name !== 'string') continue;
          if (typeof m.provider !== 'string') continue;
          const input = m.input;
          const contextWindow = typeof m.contextWindow === 'number' ? m.contextWindow : undefined;
          list.push({ selector: m.selector, name: m.name, provider: m.provider, vision: Array.isArray(input) && input.includes('image'), contextWindow });
        }
      }
      setModels(list);
      const curRaw = await api.getModel();
      const cur = isRecord(curRaw) && typeof curRaw.model === 'string' ? curRaw.model : typeof curRaw === 'string' ? curRaw : '';
      setModelState(cur);
    } catch { /* keep current state */ }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const setModel = useCallback((selector: string) => {
    setModelState(selector);
    void api.setModel(selector);
  }, []);

  return { model, models, setModel, reload };
}
