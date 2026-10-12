import { readFile, writeFile, readdir, realpath, stat, lstat, rename, unlink } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const writing = new Set();
const revision = value => createHash('sha256').update(value).digest('hex');

export async function listDirectories(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('请输入文件夹的绝对路径。');
  const path = await realpath(directory);
  const entries = await readdir(path, { withFileTypes: true });
  return { path, parent: dirname(path), directories: entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort((a, b) => a.localeCompare(b)), separator: process.platform === 'win32' ? '\\' : '/' };
}

export async function saveSvg({ directory, name, svg, expectedRevision }) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('请选择保存文件夹，或输入绝对路径。');
  if (typeof name !== 'string' || !name.trim() || name.length > 180 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('文件名无效，请勿包含路径或特殊字符。');
  if (!/\.svg$/i.test(name)) name += '.svg';
  if (typeof svg !== 'string' || Buffer.byteLength(svg) > 5_000_000 || !/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s/>]/.test(svg) || !/<\/svg>\s*$|<svg[^>]*\/>\s*$/.test(svg)) throw new Error('SVG 内容无效或超过 5 MB。');
  const folder = await realpath(directory);
  if (!(await stat(folder)).isDirectory()) throw new Error('保存位置不是文件夹。');
  const path = join(folder, name);
  const key = process.platform === 'win32' ? path.toLowerCase() : path;
  if (writing.has(key)) throw new Error('这个文件正在保存，请稍后重试。');
  writing.add(key);
  let temporary;
  try {
    if (expectedRevision == null) {
      try { await writeFile(path, svg, { encoding: 'utf8', flag: 'wx' }); }
      catch (error) { if (error.code === 'EEXIST') throw new Error('同名文件已存在，请换一个名称。原文件未被覆盖。'); throw error; }
    } else {
      if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision)) throw new Error('保存版本无效，请另存为新文件。');
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('文件类型已改变，请另存为新文件。');
      if (revision(await readFile(path)) !== expectedRevision) throw new Error('磁盘文件已被其他程序修改。请另存为新文件，避免覆盖外部修改。');
      temporary = join(folder, `.${name}.${randomUUID()}.tmp`);
      await writeFile(temporary, svg, { encoding: 'utf8', flag: 'wx' });
      // Recheck after writing the temporary file; preserve external edits if they are detected.
      if (revision(await readFile(path)) !== expectedRevision) throw new Error('磁盘文件已更改，请另存为。');
      await rename(temporary, path);
      temporary = null;
    }
    return { path, directory: folder, name, revision: revision(svg) };
  } finally {
    writing.delete(key);
    if (temporary) await unlink(temporary).catch(() => {});
  }
}
