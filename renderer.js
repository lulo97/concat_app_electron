const { ipcRenderer } = require("electron");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const { clipboard } = require("electron");

// --- State Management ---
let selectedFolders = [];
let activeSmartExcludes = new Set();
let excludedFileTypes = new Set(); // Extensions the user wants to EXCLUDE (e.g. ".css")
let abortController = null; // Used to stop the loops

const CONCATIGNORE_FILE = ".concatignore";

const binaryExts = [
  // --- Images & Icons ---
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".tiff",
  ".ico",
  ".svg",
  // --- Media (Audio/Video) ---
  ".mp4",
  ".webm",
  ".mov",
  ".avi",
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  // --- Documents & Archives ---
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".jar",
  ".war",
  // --- Executables & System ---
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".msi",
  ".pyc",
  // --- AI & Data Models ---
  ".gguf",
  ".onnx",
  ".pt",
  ".pth",
  ".model",
  ".weights",
  ".safetensors",
  // --- Databases ---
  ".db",
  ".sqlite",
  ".db-shm",
  ".db-wal",
  // --- Logs & Temp ---
  ".log",
  ".tmp",
  ".temp",
  ".bak",
  ".swp",
  // --- Certificates & Keys ---
  ".pem",
  ".crt",
  ".key",
  ".pub",
  ".der",
];

const COMMON_NOISE = [
  ".git",
  ".svn",
  ".hg",
  ".DS_Store",
  "thumbs.db",
  ".gitignore",
  ".gitattributes",
  ".github",
  "node_modules",
  "bower_components",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "composer.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "dist",
  "build",
  "out",
  "target",
  "bin",
  "obj",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".remix",
  ".cache",
  ".turbo",
  ".parcel-cache",
  "storybook-static",
  ".gradle",
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  ".vs",
  ".vscode",
  ".idea",
  ".angular",
  "venv",
  ".venv",
  "env",
  "__pycache__",
  ".pytest_cache",
  ".eslintcache",
  ".stylelintcache",
  "nest-cli.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "tsconfig.node.json",
  "tsconfig.app.json",
  "go.sum",
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "project-structure.txt",
  ".prisma",
];

// --- UI Helpers ---

function setLoading(show, text = "Processing...") {
  const overlay = document.getElementById("loadingOverlay");
  const textEl = document.getElementById("loadingText");
  if (overlay) {
    overlay.style.display = show ? "flex" : "none";
    textEl.innerText = text;
  }
}

document.getElementById("cancelBtn").addEventListener("click", () => {
  if (abortController) {
    abortController.abort();
    setLoading(false);
  }
});

async function updateFolderUI() {
  const list = document.getElementById("folderList");
  list.innerHTML = "";
  selectedFolders.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "folder-item";
    li.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <input type="checkbox" ${item.enabled ? "checked" : ""} onchange="toggleFolder(${index})">
        <span style="word-break: break-all;">${item.path}</span>
      </div>
      <button class="remove-btn" onclick="removeFolder(${index})">Delete</button>
    `;
    list.appendChild(li);
  });
  await detectNoise();
}

// --- Non-Blocking Noise Detection ---

async function detectNoise() {
  const foundInFolders = new Set();
  for (const folderObj of selectedFolders.filter((f) => f.enabled)) {
    await scanForNoise(folderObj.path, foundInFolders, 0, 3);
  }

  const container = document.getElementById("smartExcludes");
  if (!container) return;

  const previouslyChecked = new Set(activeSmartExcludes);
  container.innerHTML =
    foundInFolders.size > 0
      ? "<div style='width:100%; font-size:12px; margin-bottom:5px;'><strong>Auto-Exclude detected:</strong></div>"
      : "";

  foundInFolders.forEach((noise) => {
    if (!activeSmartExcludes.has(noise) && !previouslyChecked.has(noise)) {
      activeSmartExcludes.add(noise);
    }
    const isChecked = activeSmartExcludes.has(noise);
    const label = document.createElement("label");
    label.style =
      "background: #e0e0e0; padding: 4px 10px; border-radius: 15px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 5px; border: 1px solid #ccc; margin-bottom: 5px;";
    label.innerHTML = `<input type="checkbox" ${isChecked ? "checked" : ""} onchange="toggleSmartExclude('${noise}', this.checked)"> ${noise}`;
    container.appendChild(label);
  });

  await detectFileTypes();
}

async function scanForNoise(dir, foundSet, depth, maxDepth) {
  if (depth > maxDepth) return;
  try {
    const items = await fs.readdir(dir);
    for (const item of items) {
      if (COMMON_NOISE.includes(item)) foundSet.add(item);
      const fullPath = path.join(dir, item);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory() && !COMMON_NOISE.includes(item)) {
          await scanForNoise(fullPath, foundSet, depth + 1, maxDepth);
        }
      } catch (e) {}
    }
  } catch (e) {}
}

// --- File Type Detection ---

async function detectFileTypes() {
  const container = document.getElementById("fileTypeFilter");
  if (!container) return;

  const foundExts = new Set();
  for (const folderObj of selectedFolders.filter((f) => f.enabled)) {
    await scanForExtensions(folderObj.path, foundExts, 0, 4);
  }

  if (foundExts.size === 0) {
    container.innerHTML =
      "<span style='font-size:12px; color: var(--text-muted);'>No folders selected yet.</span>";
    return;
  }

  const sortedExts = [...foundExts].sort();
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "ft-header";
  header.innerHTML = `
    <strong style="font-size:12px;">Toggle extensions:</strong>
    <div class="ft-header-actions">
      <button class="ft-action-link" onclick="selectAllFileTypes()">Include All</button>
      <button class="ft-action-link" onclick="excludeAllFileTypes()">Exclude All</button>
    </div>
  `;
  container.appendChild(header);

  sortedExts.forEach((ext) => {
    const isExcluded = excludedFileTypes.has(ext);
    const label = document.createElement("label");
    label.className = isExcluded ? "excluded" : "";
    label.title = isExcluded
      ? `${ext} files are excluded`
      : `${ext} files are included`;
    label.innerHTML = `
      <input type="checkbox" ${isExcluded ? "" : "checked"}
        onchange="toggleFileTypeExclude('${ext}', this.checked)">
      ${ext}
    `;
    container.appendChild(label);
  });
}

async function scanForExtensions(dir, extSet, depth, maxDepth) {
  if (depth > maxDepth) return;
  try {
    const manualExcludes = document
      .getElementById("excludeInput")
      .value.split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const allExcludes = [...activeSmartExcludes, ...manualExcludes];

    const items = await fs.readdir(dir);
    for (const item of items) {
      if (allExcludes.includes(item)) continue;
      const fullPath = path.join(dir, item);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await scanForExtensions(fullPath, extSet, depth + 1, maxDepth);
        } else {
          const ext = path.extname(item).toLowerCase();
          if (ext && !binaryExts.includes(ext)) {
            extSet.add(ext);
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
}

// --- File Type Toggle Handlers ---

window.toggleFileTypeExclude = (ext, isChecked) => {
  if (isChecked) excludedFileTypes.delete(ext);
  else excludedFileTypes.add(ext);
  detectFileTypes();
};

window.selectAllFileTypes = () => {
  excludedFileTypes.clear();
  detectFileTypes();
};

window.excludeAllFileTypes = () => {
  const labels = document.querySelectorAll("#fileTypeFilter label");
  labels.forEach((label) => {
    const ext = label.textContent.trim();
    if (ext) excludedFileTypes.add(ext);
  });
  detectFileTypes();
};

// --- .concatignore Save / Load ---

/**
 * Build the config object from current UI state.
 */
function buildConfig() {
  const manualExcludes = document
    .getElementById("excludeInput")
    .value.split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");

  return {
    _comment: "Auto-generated by Concatenator.io — edit carefully.",
    folders: selectedFolders.map((f) => ({ path: f.path, enabled: f.enabled })),
    smartExcludes: [...activeSmartExcludes],
    excludedFileTypes: [...excludedFileTypes],
    manualExcludes,
  };
}

/**
 * Apply a loaded config object back to the UI state.
 * Merges folders (avoids duplicates), replaces excludes.
 */
async function applyConfig(config) {
  if (config.folders && Array.isArray(config.folders)) {
    config.folders.forEach((entry) => {
      if (!selectedFolders.some((f) => f.path === entry.path)) {
        selectedFolders.push({
          path: entry.path,
          enabled: entry.enabled !== false,
        });
      }
    });
  }
  if (config.smartExcludes && Array.isArray(config.smartExcludes)) {
    config.smartExcludes.forEach((s) => activeSmartExcludes.add(s));
  }
  if (config.excludedFileTypes && Array.isArray(config.excludedFileTypes)) {
    config.excludedFileTypes.forEach((ext) => excludedFileTypes.add(ext));
  }
  if (config.manualExcludes && Array.isArray(config.manualExcludes)) {
    const existingRaw = document
      .getElementById("excludeInput")
      .value.split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const merged = [...new Set([...existingRaw, ...config.manualExcludes])];
    document.getElementById("excludeInput").value = merged.join(", ");
  }
  await updateFolderUI();
}

/**
 * Try to load .concatignore from a given folder path.
 * Returns parsed config or null.
 */
async function tryLoadConcatIgnore(folderPath) {
  const filePath = path.join(folderPath, CONCATIGNORE_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return null; // File doesn't exist or is invalid — silently skip
  }
}

/**
 * Save config button handler.
 * If multiple folders are selected, ask the user which one to save into.
 * If only one, save directly.
 */
document.getElementById("saveConfigBtn").addEventListener("click", async () => {
  const enabledFolders = selectedFolders.filter((f) => f.enabled);

  if (enabledFolders.length === 0) {
    alert("Please add at least one folder before saving a config.");
    return;
  }

  let targetFolder;

  if (enabledFolders.length === 1) {
    targetFolder = enabledFolders[0].path;
  } else {
    // Let user pick which folder to save the .concatignore into
    const choice = await ipcRenderer.invoke(
      "pick-config-folder",
      enabledFolders.map((f) => f.path),
    );
    if (choice === null || choice === undefined) return; // Cancelled
    targetFolder = choice;
  }

  const configPath = path.join(targetFolder, CONCATIGNORE_FILE);
  const config = buildConfig();

  try {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

    // Success feedback on button
    const btn = document.getElementById("saveConfigBtn");
    const original = btn.innerText;
    btn.innerText = "Config Saved ✓";
    btn.classList.add("saved");
    setTimeout(() => {
      btn.innerText = original;
      btn.classList.remove("saved");
    }, 2000);
  } catch (err) {
    alert(`Failed to save config: ${err.message}`);
  }
});

// --- Folder Management ---

window.toggleSmartExclude = (name, isChecked) => {
  if (isChecked) activeSmartExcludes.add(name);
  else activeSmartExcludes.delete(name);
};

window.toggleFolder = async (index) => {
  selectedFolders[index].enabled = !selectedFolders[index].enabled;
  await detectNoise();
};

window.removeFolder = (index) => {
  selectedFolders.splice(index, 1);
  updateFolderUI();
};

document.getElementById("addBtn").addEventListener("click", async () => {
  const paths = await ipcRenderer.invoke("select-folders");
  if (paths && paths.length > 0) {
    for (const p of paths) {
      if (!selectedFolders.some((f) => f.path === p)) {
        selectedFolders.push({ path: p, enabled: true });
      }
      // Auto-load .concatignore if it exists in this folder
      const config = await tryLoadConcatIgnore(p);
      if (config) {
        await applyConfig(config);
        // Brief toast to let the user know a config was loaded
        showToast(`Loaded .concatignore from ${path.basename(p)}`);
        return; // applyConfig already calls updateFolderUI
      }
    }
    await updateFolderUI();
  }
});

document.getElementById("clearBtn").addEventListener("click", () => {
  selectedFolders = [];
  activeSmartExcludes.clear();
  excludedFileTypes.clear();
  updateFolderUI();
  document.getElementById("textContent").value = "";
  document.getElementById("excludeInput").value = "";
  document.getElementById("contentFilterInput").value = "";
  updateMetadata("");
});

// --- Toast Notification ---

function showToast(message, duration = 3000) {
  let toast = document.getElementById("toastNotification");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toastNotification";
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: #1e293b;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      z-index: 99999;
      opacity: 0;
      transition: opacity 0.25s ease, transform 0.25s ease;
      pointer-events: none;
      white-space: nowrap;
    `;
    document.body.appendChild(toast);
  }
  toast.innerText = message;
  toast.style.opacity = "1";
  toast.style.transform = "translateX(-50%) translateY(0)";

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(10px)";
  }, duration);
}

// --- Core File Logic ---
// Search file contents without loading the entire file into memory.
async function fileContainsKeyword(filePath, keyword, signal) {
  if (!keyword) return true;

  const stream = fsSync.createReadStream(filePath, {
    encoding: "utf8",
  });

  let overlap = "";

  try {
    for await (const chunk of stream) {
      if (signal.aborted) {
        stream.destroy();
        return false;
      }

      const text = (overlap + chunk).toLowerCase();

      // Match the keyword, including matches across chunk boundaries.
      if (text.includes(keyword)) {
        stream.destroy();
        return true;
      }

      overlap = keyword.length > 1 ? text.slice(-(keyword.length - 1)) : "";
    }

    return false;
  } catch (error) {
    return false;
  }
}

async function getFiles(signal) {
  const manualExcludes = document
    .getElementById("excludeInput")
    .value.split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const allExcludes = [...activeSmartExcludes, ...manualExcludes];
  let allFiles = [];

  for (const folderObj of selectedFolders.filter((f) => f.enabled)) {
    if (signal.aborted) return [];
    await walk(folderObj.path, allFiles, allExcludes, signal);
  }
  // Apply optional content search filter
  const keyword = document
    .getElementById("contentFilterInput")
    .value.trim()
    .toLowerCase();

  if (!keyword) return allFiles;

  const matchingFiles = [];

  for (const file of allFiles) {
    if (signal.aborted) return [];

    if (await fileContainsKeyword(file, keyword, signal)) {
      matchingFiles.push(file);
    }
  }

  return matchingFiles;
}

async function walk(dir, filelist = [], excludes = [], signal) {
  if (signal.aborted) return;
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (signal.aborted) return;
      if (excludes.includes(file)) continue;

      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);

      if (stat.isDirectory()) {
        await walk(filePath, filelist, excludes, signal);
      } else {
        const ext = path.extname(file).toLowerCase();
        if (binaryExts.includes(ext)) continue;
        if (excludedFileTypes.has(ext)) continue;
        filelist.push(filePath);
      }
    }
  } catch (e) {}
}

// --- Button Actions ---

document.getElementById("listBtn").addEventListener("click", async () => {
  abortController = new AbortController();
  setLoading(true, "Scanning folders...");
  const files = await getFiles(abortController.signal);
  setLoading(false);
  if (abortController.signal.aborted) return;
  document.getElementById("textContent").value =
    `Total Files: ${files.length}\n\n` + files.join("\n");
});

document.getElementById("concatBtn").addEventListener("click", async () => {
  abortController = new AbortController();
  const signal = abortController.signal;

  setLoading(true, "Scanning folders...");
  const files = await getFiles(signal);

  if (signal.aborted) return;
  if (files.length === 0) {
    setLoading(false);
    return alert("No files found.");
  }

  let combined = "";
  const excludeInput = document.getElementById("excludeInput");

  try {
    for (let i = 0; i < files.length; i++) {
      if (signal.aborted) break;

      const f = files[i];
      const fileName = path.basename(f);
      const stat = await fs.stat(f);
      const fileSizeMB = stat.size / (1024 * 1024);

      if (fileSizeMB > 1) {
        const choice = await ipcRenderer.invoke(
          "show-large-file-warning",
          fileName,
          fileSizeMB,
        );
        if (choice === 1) {
          const currentExcludes = excludeInput.value
            ? excludeInput.value.split(",").map((s) => s.trim())
            : [];
          if (!currentExcludes.includes(fileName)) {
            currentExcludes.push(fileName);
            excludeInput.value = currentExcludes.join(", ");
          }
          continue;
        } else if (choice === 2) {
          abortController.abort();
          break;
        }
      }

      const percent = Math.round(((i + 1) / files.length) * 100);
      document.getElementById("loadingText").innerHTML = `
        <div style="font-weight: bold; color: #3498db;">Processing ${percent}%</div>
        <div style="font-size: 11px; color: #666; margin-top: 5px;">Current: ${fileName}</div>
      `;

      try {
        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
        const content = await fs.readFile(f, "utf8");
        combined += `\n\n===== ${f} =====\n\n${content}`;
      } catch (e) {
        combined += `\n\n[Error reading ${f}]: ${e.message}\n`;
      }
    }

    if (!signal.aborted) {
      const finalContent = combined || "No readable content found.";
      document.getElementById("textContent").value = finalContent;
      updateMetadata(finalContent);
    }
  } finally {
    setLoading(false);
  }
});

let copyFeedbackTimeout;

document.getElementById("copyBtn").addEventListener("click", async () => {
  if (!selectedFolders.some((f) => f.enabled)) {
    alert("Please add at least one folder first.");
    return;
  }

  abortController = new AbortController();
  const signal = abortController.signal;
  setLoading(true, "Refreshing and verifying copy...");

  try {
    const { aborted, files, combined, newest } = await rebuildContent(signal);
    if (aborted) return;

    if (files.length === 0) {
      alert("No files found.");
      return;
    }

    const finalContent = combined || "No readable content found.";
    clipboard.writeText(finalContent);
    const verifyContent = clipboard.readText();

    if (verifyContent !== finalContent) {
      throw new Error(
        "Clipboard verification failed: Content mismatch or clipboard access denied.",
      );
    }

    document.getElementById("textContent").value = finalContent;
    updateMetadata(finalContent);

    const btn = document.getElementById("copyBtn");
    btn.classList.remove("copied");
    btn.innerText = "Copied! ✓";
    btn.classList.add("copied");

    clearTimeout(copyFeedbackTimeout);
    copyFeedbackTimeout = setTimeout(() => {
      btn.innerText = "Copy Full Content";
      btn.classList.remove("copied");
    }, 2000);

    if (newest) {
      const newestName = path.basename(newest.path);
      const newestTime = formatTimestamp(new Date(newest.mtimeMs));
      alert(
        `Files copied with newest timestamp ${newestTime} in file ${newestName}.`,
      );
    }
  } catch (err) {
    console.error("Critical Copy Error: ", err);
    alert(`Copy Failed: ${err.message}`);
    const btn = document.getElementById("copyBtn");
    btn.style.backgroundColor = "var(--danger)";
    btn.innerText = "Copy Error!";
    setTimeout(() => {
      btn.style.backgroundColor = "";
      btn.innerText = "Copy Full Content";
    }, 3000);
  } finally {
    setLoading(false);
  }
});

// --- Metadata ---

function updateMetadata(text) {
  const metaInfo = document.getElementById("metaInfo");
  if (!text || text.trim() === "") {
    metaInfo.style.display = "none";
    return;
  }
  const lines = text.split(/\r\n|\r|\n/).length;
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  const bytes = new Blob([text]).size;
  let sizeStr = "";
  if (bytes < 1024) sizeStr = bytes + " B";
  else if (bytes < 1048576) sizeStr = (bytes / 1024).toFixed(2) + " KB";
  else sizeStr = (bytes / 1048576).toFixed(2) + " MB";

  document.getElementById("metaLines").innerText = lines.toLocaleString();
  document.getElementById("metaWords").innerText = words.toLocaleString();
  document.getElementById("metaSize").innerText = sizeStr;
  metaInfo.style.display = "flex";
}

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function rebuildContent(signal) {
  const files = await getFiles(signal);
  if (signal.aborted)
    return { aborted: true, files: [], combined: "", newest: null };

  let combined = "";
  let newest = null;

  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) return { aborted: true, files, combined, newest };

    const f = files[i];
    const fileName = path.basename(f);
    const stat = await fs.stat(f);

    if (!newest || stat.mtimeMs > newest.mtimeMs) {
      newest = { path: f, mtimeMs: stat.mtimeMs };
    }

    const percent = Math.round(((i + 1) / files.length) * 100);
    document.getElementById("loadingText").innerHTML = `
      <div style="font-weight: bold; color: #3498db;">Processing ${percent}%</div>
      <div style="font-size: 11px; color: #666; margin-top: 5px;">Current: ${fileName}</div>
    `;

    try {
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
      const content = await fs.readFile(f, "utf8");
      combined += `\n\n===== ${f} =====\n\n${content}`;
    } catch (e) {
      combined += `\n\n[Error reading ${f}]: ${e.message}\n`;
    }
  }

  return { aborted: false, files, combined, newest };
}
