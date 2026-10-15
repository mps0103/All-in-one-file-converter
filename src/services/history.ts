import {KEYS, store} from './storage';
type ToolId = string;

export type HistoryItem = {
  id: string;
  /** Absent on a viewed row: nothing was converted, so no tool made it. */
  toolId?: ToolId;
  /** 'converted' is the default so rows written before viewing existed still read. */
  kind?: 'converted' | 'viewed';
  name: string;
  path: string;
  uri: string;
  mime: string;
  at: number;
};

const LIMIT = 40;

export const getHistory = () => store.read<HistoryItem[]>(KEYS.history, []);

export const addHistory = async (items: Omit<HistoryItem, 'id' | 'at'>[]) => {
  const now = Date.now();
  const existing = await getHistory();
  const next = [
    ...items.map((i, idx) => ({...i, id: `${now}_${idx}`, at: now})),
    ...existing,
  ].slice(0, LIMIT);
  await store.write(KEYS.history, next);
  return next;
};

/**
 * Records a file the viewer opened. Opening the same file again moves it to the
 * top rather than adding a duplicate, which is what makes the list useful as a
 * "carry on where I left off" rather than a log of every tap.
 */
export const addViewed = async (item: Omit<HistoryItem, 'id' | 'at' | 'kind'>) => {
  const existing = (await getHistory()).filter(
    i => !(i.kind === 'viewed' && i.uri === item.uri),
  );
  const next = [
    {...item, kind: 'viewed' as const, id: `v${Date.now()}`, at: Date.now()},
    ...existing,
  ].slice(0, LIMIT);
  await store.write(KEYS.history, next);
  return next;
};

/**
 * Drops one row from the list. The file itself is left alone: this list is a
 * record of what the app touched, not a file manager, and deleting somebody's
 * document because they tidied a list would be unforgivable.
 */
export const removeHistory = async (id: string) => {
  const next = (await getHistory()).filter(i => i.id !== id);
  await store.write(KEYS.history, next);
  return next;
};

export const clearHistory = async () => {
  await store.write(KEYS.history, []);
  return [] as HistoryItem[];
};
