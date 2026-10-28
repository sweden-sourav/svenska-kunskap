import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { toParagraphLines, type TextLine } from './textBlocks.js';

const run = promisify(execFile);
const isMissingBinary = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT';

/**
 * Legacy binary .doc files cannot be read by pure JavaScript libraries, so they are converted to text with
 * LibreOffice (`soffice`) or, as a fallback, `antiword`. If neither is installed the file is reported as an error.
 */
export async function extractDocLines(path: string): Promise<TextLine[]> {
  const tmp = await mkdtemp(join(tmpdir(), 'quiz-doc-'));
  try {
    for (const bin of ['soffice', 'libreoffice']) {
      try {
        await run(
          bin,
          ['--headless', '--norestore', `-env:UserInstallation=file://${tmp}/profile`, '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', tmp, path],
          { timeout: 90_000 },
        );
      } catch (e) {
        if (isMissingBinary(e)) continue;
        throw new Error(`LibreOffice could not convert the file: ${(e as Error).message}`);
      }
      return toParagraphLines(await readFile(join(tmp, basename(path, extname(path)) + '.txt'), 'utf8'));
    }
    try {
      const { stdout } = await run('antiword', ['-m', 'UTF-8.txt', path], { maxBuffer: 32 * 1024 * 1024, timeout: 30_000 });
      return toParagraphLines(stdout);
    } catch (e) {
      if (!isMissingBinary(e)) throw new Error(`antiword could not read the file: ${(e as Error).message}`);
    }
    throw new Error('Legacy .doc files need LibreOffice (soffice) or antiword installed on the server. Install one, or save the file as .docx.');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
