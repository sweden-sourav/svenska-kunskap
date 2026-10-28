import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { TranslationService, UnsupportedLanguageError } from './translation.js';
import type { QuestionBank } from './types.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};

class BadRequestError extends Error {}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage, limit = 16 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new BadRequestError('Request body too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new BadRequestError('Body must be valid JSON')); } });
    req.on('error', reject);
  });
}

/** Creates the HTTP server. Answer keys stay in `bank`; the API only reveals one after an answer is submitted. */
export function createApp(bank: QuestionBank, options: { staticDir?: string; translation?: TranslationService } = {}): Server {
  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  const translation = options.translation ?? new TranslationService({ questions: bank.questions, sourceLanguage: 'en' });
  const status = {
    questionCount: bank.questions.length,
    files: bank.files,
    issues: bank.issues,
  };

  function serveStatic(pathname: string, res: ServerResponse) {
    const root = options.staticDir;
    if (!root || !existsSync(join(root, 'index.html'))) {
      sendJson(res, 404, { error: 'Frontend not built. Run "npm run build", or use "npm run dev" and open http://localhost:5173.' });
      return;
    }
    let file = normalize(join(root, decodeURIComponent(pathname)));
    if (file !== root && !file.startsWith(root + sep)) { sendJson(res, 403, { error: 'Forbidden' }); return; }
    if (!existsSync(file) || !statSync(file).isFile()) file = join(root, 'index.html'); // single-page app fallback
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    createReadStream(file).pipe(res);
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/status' && req.method === 'GET') return sendJson(res, 200, status);
      if (url.pathname === '/api/languages' && req.method === 'GET') {
        const languages = await translation.languages();
        return sendJson(res, 200, { sourceLanguage: translation.sourceLanguage, machineTranslation: languages.some((l) => l.machine), languages });
      }
      if (url.pathname === '/api/questions' && req.method === 'GET') {
        const { language, questions, machineTranslated, incomplete } = await translation.translateQuestions(url.searchParams.get('lang') || translation.sourceLanguage);
        return sendJson(res, 200, { language, machineTranslated, incomplete, questions });
      }
      if (url.pathname === '/api/answer') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST' });
        const body = (await readJson(req)) as { questionId?: unknown; choiceId?: unknown; lang?: unknown } | null;
        if (typeof body?.questionId !== 'string' || typeof body?.choiceId !== 'string') {
          return sendJson(res, 400, { error: 'Expected JSON: { "questionId": string, "choiceId": string }' });
        }
        const q = byId.get(body.questionId);
        if (!q) return sendJson(res, 404, { error: 'Unknown question' });
        if (!q.choices.some((c) => c.id === body.choiceId)) return sendJson(res, 400, { error: 'Unknown choice for this question' });
        return sendJson(res, 200, {
          correct: body.choiceId === q.correctChoiceId,
          correctChoiceId: q.correctChoiceId,
          explanation: await translation.translateExplanation(q, typeof body.lang === 'string' && body.lang ? body.lang : translation.sourceLanguage),
        });
      }
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      serveStatic(url.pathname, res);
    } catch (e) {
      sendJson(res, e instanceof UnsupportedLanguageError || e instanceof BadRequestError ? 400 : 500, { error: (e as Error).message });
    }
  });
}
