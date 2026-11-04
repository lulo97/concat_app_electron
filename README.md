# Folder Concatenator

A Windows desktop app for selecting multiple folders, filtering files, and concatenating the selected text into one output. Content Search can also trim matching files so large source files contribute only relevant code regions.

## Run

1. Install Node.js 20 or newer.
2. Open a terminal in this project folder.
3. Run:

   ```bash
   npm install
   npm start
   ```

## Build for Windows

- Run `build.bat` to create an unpacked Windows build in `dist/`.
- Run `npm run dist` to create a portable Windows executable in `dist/`.

The packaging commands target Windows. Run them on Windows for the intended portable `.exe` output.

## Content Search and extraction

Enter comma- or line-separated keywords. Matching is case-insensitive. OR mode includes a file when any keyword is found; AND mode requires every keyword to be present somewhere in the file. Whole-word matching is optional.

The Result Mode selector has three choices:

- **Full file** — include every line from each matching file.
- **Matched lines ± N** — include each matching line and the configured number of surrounding lines. Overlapping ranges are merged.
- **Enclosing function / class** — for Python and supported brace-based languages, include the innermost enclosing function or class. For other file types, fall back to matched lines ± N. Very large code blocks also fall back to a focused snippet around the match.

By default, files with 150 lines or fewer remain whole. You can also keep the first N lines (for imports or headers) and toggle original line numbers. Omitted sections are marked with their original line ranges.

Content Search affects List Files, Concat Files, Copy Full Content, and the detected file-type chips. Searches are streamed in chunks, so large files are not rejected by a fixed search-size cap. The output builder reads selected files after the search pass; very large files show a confirmation dialog before being added to the output.

## Filters and configuration

- Auto-detect filters offer common generated folders and files as optional exclusions.
- Manual Excludes and Manual Includes accept comma- or line-separated names. Includes match a filename or any parent folder name.
- Conflicting manual include/exclude terms block List, Concat, and Copy until resolved.
- Save Config writes `.concatignore` to a selected folder. The file stores folder selections, filters, content-search settings, and extraction settings. Adding a folder that contains `.concatignore` loads those settings.

## Project layout

```text
main.js               Electron main process and native dialogs
index.html            UI, Tailwind CDN, jQuery CDN
renderer.js           renderer entry point
src/constants.js      file types and scan constants
src/state.js          shared application state
src/utils.js           common helpers
src/filters.js         include/exclude logic
src/matchers.js        streaming content search
src/extractor.js       context and enclosing-block extraction
src/scanner.js         folder walking and file detection
src/builder.js         output assembly and large-file prompts
src/config.js          .concatignore persistence
src/ui.js              rendering, metadata, and loading states
src/folders.js         folder selection and management
src/actions.js         List / Concat / Copy / Save actions
src/events.js          UI event wiring
test/                  automated tests for extraction and search
```

Tailwind CSS, jQuery, and Google Fonts are loaded from CDNs, so the UI needs an internet connection at runtime. The app itself has no third-party runtime package dependencies beyond Electron's built-in APIs.

## Tests

Run the logic tests with:

```bash
npm test
```
