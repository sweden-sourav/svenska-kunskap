import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { loadQuestionBank } from './loader.js';
import { LibreTranslateClient, TranslationService } from './translation.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const questionsDir = resolve(root, process.env.QUESTIONS_DIR ?? 'data/questions');
const port = Number(process.env.PORT ?? 3001);

const bank = await loadQuestionBank(questionsDir);

console.log(`Question folder: ${questionsDir}`);
for (const f of bank.files) console.log(`  ${f.file}: ${f.loaded} loaded${f.skipped ? `, ${f.skipped} skipped` : ''}`);
for (const i of bank.issues) console[i.severity === 'error' ? 'error' : 'warn'](`  [${i.severity}] ${i.file} (${i.location}): ${i.message}`);
console.log(bank.questions.length > 0 ? `Loaded ${bank.questions.length} valid question(s).` : 'No valid questions loaded. The quiz will show an explanation instead.');

// Translation: per-language columns in the files always work; LibreTranslate adds machine translation when configured.
const translation = new TranslationService({
  questions: bank.questions,
  sourceLanguage: process.env.QUIZ_LANGUAGE ?? 'en',
  client: process.env.LIBRETRANSLATE_URL ? new LibreTranslateClient(process.env.LIBRETRANSLATE_URL, process.env.LIBRETRANSLATE_API_KEY) : undefined,
});
const languages = await translation.languages();
console.log(`Question language: ${translation.sourceLanguage}. Languages offered: ${languages.map((l) => `${l.code}${l.fromFiles ? ' (files)' : ''}${l.machine ? ' (machine)' : ''}`).join(', ')}`);
if (!process.env.LIBRETRANSLATE_URL) console.log('LIBRETRANSLATE_URL is not set: machine translation is off.');

createApp(bank, { staticDir: resolve(root, 'dist'), translation }).listen(port, () => console.log(`API listening on http://localhost:${port}`));
