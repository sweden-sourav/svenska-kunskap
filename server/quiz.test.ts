import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createApp } from './app.js';
import { loadQuestionBank } from './loader.js';
import { parseCsv } from './parsers/csv.js';
import { parseTabular } from './parsers/tabular.js';
import { parseTextBlocks, toParagraphLines } from './parsers/textBlocks.js';
import { LibreTranslateClient, TranslationService } from './translation.js';

const samples = resolve(fileURLToPath(import.meta.url), '..', '..', 'data', 'questions');

describe('sample question bank', async () => {
  const bank = await loadQuestionBank(samples);

  it('loads every supported format without errors', () => {
    assert.deepEqual(bank.issues, []);
    for (const ext of ['.csv', '.xlsx', '.docx', '.doc', '.pdf']) {
      const f = bank.files.find((x) => x.file.endsWith(ext));
      assert.ok(f && f.loaded > 0, `no questions loaded from a ${ext} file`);
    }
  });

  it('handles quotes, wrapped text and answers given as text', () => {
    const texts = bank.questions.map((q) => q.text);
    assert.ok(texts.some((t) => t.includes('"Ring of Fire", Asia')));
    assert.ok(texts.some((t) => t.startsWith('Which ancient civilization built the mountain citadel of Machu Picchu')));
    const kili = bank.questions.find((q) => q.text.startsWith('Mount Kilimanjaro'))!;
    assert.equal(kili.choices.find((c) => c.id === kili.correctChoiceId)?.text, 'Tanzania');
  });

  describe('HTTP API', async () => {
    const server = createApp(bank);
    await new Promise<void>((ok) => server.listen(0, ok));
    after(() => server.close());
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const post = (body: unknown) =>
      fetch(`${base}/api/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    it('never sends answer keys or explanations with the questions', async () => {
      const text = await (await fetch(`${base}/api/questions`)).text();
      assert.ok(!/correct|explanation/i.test(text));
    });

    it('checks submitted answers on the server', async () => {
      const q = bank.questions[0];
      const wrong = q.choices.find((c) => c.id !== q.correctChoiceId)!;
      assert.deepEqual(await (await post({ questionId: q.id, choiceId: q.correctChoiceId })).json(), {
        correct: true, correctChoiceId: q.correctChoiceId, explanation: q.explanation,
      });
      const res = await (await post({ questionId: q.id, choiceId: wrong.id })).json();
      assert.equal(res.correct, false);
      assert.equal(res.correctChoiceId, q.correctChoiceId);
    });

    it('rejects bad requests', async () => {
      assert.equal((await post({ questionId: 'nope', choiceId: 'A' })).status, 404);
      assert.equal((await post({ questionId: 'q1', choiceId: 'Z' })).status, 400);
      assert.equal((await post({ questionId: 'q1' })).status, 400);
    });
  });
});

describe('validation of malformed files', () => {
  it('reports file name and row, and does not load invalid questions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'quiz-test-'));
    await writeFile(join(dir, 'bad.csv'), [
      'question,choice_a,choice_b,choice_c,correct',
      'Fine?,Yes,No,,A',            // row 2: valid
      'One choice only,Yes,,,A',    // row 3: invalid
      'Bad key,Yes,No,,Q',          // row 4: invalid
      'Same text,Yes,yes,,A',       // row 5: invalid
    ].join('\n'));
    await writeFile(join(dir, 'nocols.csv'), 'foo,bar\n1,2\n');
    await writeFile(join(dir, 'notes.pdf.bak'), 'x');
    const bank = await loadQuestionBank(dir);
    assert.equal(bank.questions.length, 1);
    const errors = bank.issues.filter((i) => i.severity === 'error');
    assert.deepEqual(errors.filter((i) => i.file === 'bad.csv').map((i) => i.location), ['row 3', 'row 4', 'row 5']);
    assert.ok(errors.some((i) => i.file === 'nocols.csv' && /missing required column/.test(i.message)));
    assert.ok(bank.issues.some((i) => i.file === 'notes.pdf.bak' && i.severity === 'warning'));
  });

  it('reports a missing folder', async () => {
    const bank = await loadQuestionBank(join(tmpdir(), 'does-not-exist-quiz'));
    assert.equal(bank.questions.length, 0);
    assert.equal(bank.issues[0].severity, 'error');
  });
});

describe('parsers', () => {
  it('parses CSV with semicolons, quotes, embedded newlines and CRLF', () => {
    const rows = parseCsv('\uFEFFa;b\r\n"x;1";"say ""hi""\nthere"\r\n');
    assert.deepEqual(rows.map((r) => r.values), [['a', 'b'], ['x;1', 'say "hi"\nthere']]);
    assert.throws(() => parseCsv('a,b\n"open,1'), /Unterminated/);
  });

  it('parses text blocks and flags stray text', () => {
    const { raws, issues } = parseTextBlocks(toParagraphLines('Title\n\nQ1. First\nline?\nA) one\nB) two\nAnswer: b\nExplanation: why\nmore'));
    assert.equal(issues.length, 1);
    assert.equal(raws[0].text, 'First line?');
    assert.equal(raws[0].explanation, 'why more');
    assert.equal(raws[0].correct, 'b');
  });
});

/** A stand-in for LibreTranslate: English can go to Swedish and German; "translating" prefixes the target code. */
async function fakeLibreTranslate() {
  const state = { translateCalls: 0, textsTranslated: 0, fail: false };
  const server: Server = createHttpServer((req, res) => {
    if (req.url === '/languages') {
      res.setHeader('Content-Type', 'application/json');
      return void res.end(JSON.stringify([
        { code: 'en', name: 'English', targets: ['sv', 'de'] },
        { code: 'sv', name: 'Swedish', targets: ['en'] },
        { code: 'de', name: 'German', targets: ['en'] },
      ]));
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      state.translateCalls++;
      if (state.fail) { res.statusCode = 500; return void res.end('{"error":"boom"}'); }
      const { q, target, source } = JSON.parse(body) as { q: string[]; target: string; source: string };
      assert.equal(source, 'en');
      state.textsTranslated += q.length;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ translatedText: q.map((t) => `[${target}] ${t}`) }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, ok));
  return { state, url: `http://localhost:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

describe('translation', async () => {
  const bank = await loadQuestionBank(samples);
  const lt = await fakeLibreTranslate();
  after(() => lt.close());

  it('reads per-language columns (including region codes) from tables', () => {
    const { raws } = parseTabular([
      { row: 1, values: ['question', 'choice_a', 'choice_b', 'correct', 'question_pt_br', 'choice_b_pt_br', 'explanation_SV'] },
      { row: 2, values: ['Hi?', 'Yes', 'No', 'A', 'Oi?', 'Não', 'Förklaring'] },
    ]);
    assert.deepEqual(raws[0].translations, {
      'pt-br': { text: 'Oi?', choices: { B: 'Não' } },
      sv: { explanation: 'Förklaring' },
    });
  });

  it('uses file columns first and falls back to the original when nothing else is available', async () => {
    const svc = new TranslationService({ questions: bank.questions, sourceLanguage: 'en' });
    assert.deepEqual((await svc.languages()).map((l) => l.code), ['en', 'sv']);
    const sv = await svc.translateQuestions('sv');
    assert.equal(sv.questions[0].text, 'Vad är Australiens huvudstad?');
    assert.equal(sv.questions[0].choices[1].text, 'Melbourne');
    assert.equal(sv.machineTranslated, false);
    assert.equal(sv.incomplete, true); // questions from the other files have no Swedish columns
    assert.equal(sv.questions[5].text, bank.questions[5].text);
    await assert.rejects(svc.translateQuestions('de'), /Unsupported language/);
  });

  it('fills the gaps with LibreTranslate, keeps file text, and caches results', async () => {
    const svc = new TranslationService({ questions: bank.questions, sourceLanguage: 'en', client: new LibreTranslateClient(lt.url) });
    const langs = await svc.languages();
    assert.deepEqual(langs.map((l) => [l.code, l.fromFiles, l.machine]), [['en', false, false], ['de', false, true], ['sv', true, true]]);

    const de = await svc.translateQuestions('de');
    assert.equal(de.questions[0].text, '[de] What is the capital of Australia?');
    assert.equal(de.machineTranslated, true);
    assert.equal(de.incomplete, false);
    assert.deepEqual(de.questions[0].choices.map((c) => c.id), ['A', 'B', 'C', 'D']); // letters never change

    const sv = await svc.translateQuestions('sv');
    assert.equal(sv.questions[0].text, 'Vad är Australiens huvudstad?'); // from the file, not machine
    assert.equal(sv.questions[5].text, '[sv] ' + bank.questions[5].text); // gap filled by machine
    assert.equal(sv.incomplete, false);

    const before = lt.state.textsTranslated;
    await svc.translateQuestions('de');
    assert.equal(lt.state.textsTranslated, before);
  });

  it('serves languages, translated questions and translated explanations over HTTP', async () => {
    const svc = new TranslationService({ questions: bank.questions, sourceLanguage: 'en', client: new LibreTranslateClient(lt.url) });
    const server = createApp(bank, { translation: svc });
    await new Promise<void>((ok) => server.listen(0, ok));
    after(() => server.close());
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const post = (body: unknown) => fetch(`${base}/api/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

    const langs = await (await fetch(`${base}/api/languages`)).json();
    assert.equal(langs.sourceLanguage, 'en');
    assert.equal(langs.machineTranslation, true);

    const qs = await (await fetch(`${base}/api/questions?lang=de`)).text();
    assert.ok(!/"correct|explanation/i.test(qs), 'translated questions must not reveal answers');
    assert.equal((await fetch(`${base}/api/questions?lang=xx`)).status, 400);

    const q = bank.questions[0];
    assert.equal((await post({ questionId: q.id, choiceId: q.correctChoiceId, lang: 'sv' })).explanation, q.translations.sv.explanation);
    assert.equal((await post({ questionId: q.id, choiceId: 'A', lang: 'de' })).explanation, '[de] ' + q.explanation);
    assert.equal((await post({ questionId: q.id, choiceId: 'A' })).explanation, q.explanation);
  });

  it('degrades gracefully when LibreTranslate is down or fails', async () => {
    const down = new TranslationService({ questions: bank.questions, sourceLanguage: 'en', client: new LibreTranslateClient('http://localhost:1') });
    assert.deepEqual((await down.languages()).map((l) => l.code), ['en', 'sv']);

    lt.state.fail = true;
    const failing = new TranslationService({ questions: bank.questions, sourceLanguage: 'en', client: new LibreTranslateClient(lt.url) });
    const sv = await failing.translateQuestions('sv');
    assert.equal(sv.incomplete, true);
    assert.equal(sv.questions[0].text, 'Vad är Australiens huvudstad?');
    lt.state.fail = false;
  });
});
