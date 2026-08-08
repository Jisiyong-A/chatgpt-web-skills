/**
 * GET /v1/models (spec §29). Phase 1 advertises the single adapter model.
 */

export interface ModelList {
  object: 'list';
  data: Array<{ id: string; object: 'model'; created: number; owned_by: string }>;
}

export const MODELS: ModelList = {
  object: 'list',
  data: [{ id: 'chatgpt-web', object: 'model', created: 0, owned_by: 'local-adapter' }],
};
