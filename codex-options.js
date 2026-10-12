import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export async function modelCatalog() {
  try {
    const cache = JSON.parse(await readFile(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json'), 'utf8'));
    return (cache.models || []).filter(model => model.visibility !== 'hide' && typeof model.slug === 'string').map(model => ({
      id: model.slug, name: model.display_name || model.slug,
      efforts: (model.supported_reasoning_levels || []).map(level => level.effort).filter(level => efforts.includes(level)),
      defaultEffort: model.default_reasoning_level,
    }));
  } catch { return []; }
}

export function codexOptions({ model, effort }, catalog = []) {
  if (model != null && (typeof model !== 'string' || model.length > 150 || model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model))) throw new Error('模型名称无效。');
  if (effort != null && effort !== '' && !efforts.includes(effort)) throw new Error('思考强度无效。');
  const known = catalog.find(item => item.id === model);
  if (effort && known && !known.efforts.includes(effort)) throw new Error('所选模型不支持这个思考强度，请重新选择。');
  const args = [];
  if (model) args.push('--model', model);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  return args;
}
