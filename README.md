# File-based quiz app

A quiz whose questions and answer keys live in files inside the project (`data/questions/`).
The Node.js server reads and validates them at startup; the React app shows one question at a time and the
**server** checks every answer, so correct answers never reach the browser before a question is submitted.

- Frontend: React 19 + TypeScript + Vite (`src/`)
- Backend: Node.js + TypeScript, plain `node:http` (`server/`), run with `tsx`
- Question formats: CSV, XLSX, DOCX, DOC, PDF
- Language switch: per-language file columns plus self-hosted LibreTranslate (machine translation)

## Prerequisites

- Node.js 20.16+ (22 LTS recommended) and npm
- Only for legacy `.doc` files: [LibreOffice](https://www.libreoffice.org/) (`soffice` on the PATH) or `antiword`

## Run it

```bash
npm install
npm run dev        # starts API (http://localhost:3001) and web app (http://localhost:5173) together
```

Open <http://localhost:5173>. The server log lists every file, how many questions loaded, and any problems.

Production-style run (one process, one port):

```bash
npm run build      # type-checks and builds the frontend into dist/
npm start          # serves the API and dist/ on http://localhost:3001
```

Other commands: `npm test` (backend tests), `npm run typecheck`.
Environment variables: `PORT` (default 3001), `QUESTIONS_DIR` (default `data/questions`, relative to the project root), `API_URL` (dev proxy target for Vite), `QUIZ_LANGUAGE` (language the question files are written in, default `en`), `LIBRETRANSLATE_URL` and `LIBRETRANSLATE_API_KEY` (see Translation).

One command to run app + translation in development:

```bash
npm run dev:all
```

This starts LibreTranslate in Docker (`translator:up`) and then runs the app with translation enabled.
If Docker Desktop is not running, start it first.
`dev:all` now runs a preflight check first (Docker daemon + required ports `5001`, `3001`, `5173`) and prints a friendly error if something is not ready.

Optional force mode (kills existing listeners on `3001` and `5173` before startup):

```bash
npm run dev:all:force
```

## Adding questions

1. Create or edit a file in `data/questions/` using one of the formats below.
2. Restart the server (in `npm run dev` it restarts by itself when files in that folder change).
3. Check the server log: every skipped question is listed with its file and location.

Each question needs: question text, 2–8 choices, and exactly one correct answer. `category` and `explanation` are optional.
The correct answer is a choice letter (`A`–`H`) or the exact text of the right choice.

### CSV and XLSX: one question per row

The first row is a header. Column names are case-insensitive; spaces and dashes count as `_`.

| Column                               | Required     | Notes                                                                         |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------- |
| `question`                           | yes          | also accepted: `question_text`, `text`                                        |
| `choice_a`, `choice_b`, … `choice_h` | at least two | `option_a` / `answer_a` also work. Blank trailing cells mean fewer choices    |
| `correct`                            | yes          | letter or exact choice text; also accepted: `correct_answer`, `answer`, `key` |
| `category`                           | no           | also `topic`                                                                  |
| `explanation`                        | no           | shown after the answer is submitted; also `rationale`                         |

```csv
question,choice_a,choice_b,choice_c,choice_d,correct,category,explanation
What is the capital of Australia?,Sydney,Melbourne,Canberra,Perth,C,Geography,Chosen as a compromise.
```

- CSV: UTF-8 (a BOM is fine); comma, semicolon (common in Excel exports for some locales) or tab delimiter is detected automatically. Quote fields that contain the delimiter or line breaks.
- XLSX: every worksheet is read; each needs its own header row. Sheets whose name starts with `_` are ignored (use one for notes). Formula cells use their last calculated value.
- Row numbers in messages are the row/record numbers in the file (the header is row 1).

### DOCX, DOC and PDF: one block of text per question

```text
Q: Which ocean is the largest?
A) Atlantic
B) Indian
C) Pacific
D) Arctic
Answer: C
Category: Geography
Explanation: The Pacific covers about a third of Earth's surface.
```

- A question starts with `Q:` (also `Q1.`, `Question 2:` …). Choices start with an uppercase letter and `)`, `.` or `:` followed by a space, in order from `A`.
- `Answer:` (also `Correct answer:`, `Ans:`) is required. `Category:` and `Explanation:` are optional.
- Blank lines are ignored. A line that is not one of the markers continues the previous field, so long questions and explanations can wrap.
- Text before the first `Q:` (titles, intros) is ignored and reported as a note.
- Locations in messages: `paragraph N` (DOCX/DOC, counting non-empty paragraphs) or `page P, line L` (PDF).

## Translation (language switch)

The header shows a **Language** menu whenever more than one language is available. Switching keeps your progress and
translates questions, choices, categories and explanations. Answer letters never change, so scoring is unaffected.
Button labels and other interface text stay in English.

For every piece of text the server uses, in this order: (1) the original, if you pick the quiz's own language;
(2) the per-language column in the file; (3) a LibreTranslate translation; (4) the original text, with a notice that it
could not be translated.

### 1. Per-language columns (CSV and XLSX, always available, no extra software)

Add the language code as a suffix to any column: `question_sv`, `choice_a_sv`, `choice_b_sv`, …, `category_sv`, `explanation_sv`.
Region codes work too (`question_pt_br`). Empty cells fall back to machine translation. Set `QUIZ_LANGUAGE` to the language of the
base columns (for a Swedish quiz: `QUIZ_LANGUAGE=sv`, with `question_en`, `choice_a_en`, … for English).
`01-geography.csv` has complete `_sv` columns as an example. DOCX, DOC and PDF files have no per-language columns; they use machine translation.

```csv
question,choice_a,choice_b,correct,question_sv,choice_a_sv,choice_b_sv
Is the sky blue?,Yes,No,A,Är himlen blå?,Ja,Nej
```

### 2. Self-hosted LibreTranslate (machine translation, any language to any language)

```bash
npm run translator                      # = docker compose up libretranslate  (http://localhost:5001)
LIBRETRANSLATE_URL=http://localhost:5001 QUIZ_LANGUAGE=sv npm run dev
```

(On Windows PowerShell set the variables first: `$env:LIBRETRANSLATE_URL="http://localhost:5001"`.)
`docker-compose.yml` loads only the languages in `LT_LOAD_ONLY` (edit the list; remove the line for all languages). The first start
downloads the language models, which needs internet and some minutes; they are then cached in a Docker volume and it works offline.
The service listens on localhost only. Set `LIBRETRANSLATE_API_KEY` if you started LibreTranslate with API keys.
The menu offers every language LibreTranslate can translate **from** `QUIZ_LANGUAGE`, plus languages found in file columns.
If LibreTranslate is down, the quiz keeps working with the original text and any file columns.

Translations are cached in memory (a language is translated once per server run, in batches). Machine translation can change
meaning or make two choices look alike, and the page says when it is in use. For graded quizzes, prefer proofread file columns.

## Validation and error reporting

At startup every question is checked. A question is **skipped and reported** (file + row/paragraph/page + reason) when it has:
empty text; fewer than 2 or more than 8 choices; choices not labelled A, B, C… in order; an empty or duplicated choice; a missing correct answer or one that matches no choice.
Whole-file problems (unreadable or corrupt file, missing header columns, no questions found, unsupported type) are reported too.
Nothing malformed is silently treated as valid.

- If at least one valid question exists, the quiz runs and a collapsible note lists the skipped items.
- If none exist (empty folder, all invalid), the page explains what to fix and lists the problems.

## API

| Endpoint                     | Purpose                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/questions?lang=xx` | `{ language, machineTranslated, incomplete, questions: [{ id, text, category?, choices: [{ id, text }] }] }` – no answers, no explanations. `lang` is optional |
| `POST /api/answer`           | body `{ questionId, choiceId, lang? }` → `{ correct, correctChoiceId, explanation? }` (explanation in `lang`)                                                  |
| `GET /api/languages`         | `{ sourceLanguage, machineTranslation, languages: [{ code, name, fromFiles, machine }] }`                                                                      |
| `GET /api/status`            | question count, per-file counts, and all load issues                                                                                                           |

Quiz progress is kept in the browser. Reloading the page or pressing **Restart quiz** starts again from question 1.

## Project layout

```
data/questions/     question files (samples for every format)
server/             index.ts (start-up), loader.ts, validate.ts, app.ts (HTTP API), translation.ts, parsers/
src/                React app: App.tsx, api.ts, components/ (incl. LanguageSelect), styles.css
docker-compose.yml  LibreTranslate for the language switch
```

## Known parser limitations

- **Legacy `.doc`** cannot be read by JavaScript libraries. The server converts it with LibreOffice (`soffice --headless --convert-to txt`) or `antiword`. Without either, the file is reported as an error – install one, or save the file as `.docx` (the practical alternative). Conversion takes a few seconds per file at startup.
- **Word automatic numbering/bullets** (a list that Word numbers for you) is not part of the text, so `A)` labels would be missing. Type the labels `A)`, `B)` … as normal text.
- **PDF**: only text-based PDFs work (no OCR for scans). Lines are rebuilt from text positions, so multi-column layouts, tables and text boxes may come out in the wrong order; use a single-column layout. Page headers/footers become stray text unless they look like a marker.
- **Text formats** treat any line starting with `Q:`/`Q1.`, `A)`–`H)`, `Answer:`, `Category:` or `Explanation:` as a marker, so a wrapped line that happens to begin that way will be misread. Tables inside DOCX files are read as plain text, cell by cell.
- **XLSX**: charts, images and merged-cell layouts are ignored; use one flat table per sheet.
- Files are read once at startup; changes need a server restart. Question order follows the file name order (sorted naturally), then position in the file.
- Machine translation needs LibreTranslate and a model for the pair; interface labels are not translated.
- Questions are shown in file order and a question can be answered once per quiz run; there is no per-user storage.
