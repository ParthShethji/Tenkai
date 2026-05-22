type StrategyDoc = Record<string, any>;

const docs = new Map<string, StrategyDoc>();

export function putStrategyDoc(docId: string, payload: StrategyDoc) {
  docs.set(docId, payload);
}

export function getStrategyDoc(docId: string): StrategyDoc | null {
  return docs.get(docId) || null;
}
