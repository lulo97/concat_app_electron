const { ipcRenderer } = require("electron");
const fs = require("fs").promises;
const path = require("path");
const { clipboard } = require("electron"); // <-- add this

// --- State Management ---
let selectedFolders = [];
let activeSmartExcludes = new Set();
let abortController = null; // Used to stop the loops

const binaryExts = [
  // --- Images & Icons ---
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".tiff", ".ico", ".svg",
  
  // --- Media (Audio/Video) ---
  ".mp4", ".webm", ".mov", ".avi", ".mp3", ".wav", ".flac", ".ogg",
  
  // --- Documents & Archives ---
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar", ".jar", ".war",
  
  // --- Executables & System ---
  ".exe", ".dll", ".so", ".dylib", ".bin", ".msi", ".pyc",
  
  // --- AI & Data Models ---
  ".gguf", ".onnx", ".pt", ".pth", ".model", ".weights", ".safetensors",
  
  // --- Databases ---
  ".db", ".sqlite", ".db-shm", ".db-wal",
  
  // --- Logs & Temp ---
  ".log", ".tmp", ".temp", ".bak", ".swp",
  
  // --- Certificates & Keys ---
  ".pem", ".crt", ".key", ".pub", ".der"
];

const COMMON_NOISE = [
  // --- Version Control & OS ---
  ".git", ".svn", ".hg", ".DS_Store", "thumbs.db", ".gitignore", ".gitattributes", ".github",

  // --- Package Managers ---
  "node_modules", "bower_components", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "composer.lock", "Cargo.lock", "Gemfile.lock",

  // --- Build Outputs & Caches ---
  "dist", "build", "out", "target", "bin", "obj", "coverage", ".next", ".nuxt", ".svelte-kit", ".astro", ".remix", ".cache", ".turbo", ".parcel-cache", "storybook-static", ".gradle",

  // --- Environment & Secrets ---
  ".env", ".env.local", ".env.development", ".env.production", ".env.test",

  // --- IDEs & Tools ---
  ".vs", ".vscode", ".idea", ".angular", "venv", ".venv", "env", "__pycache__", ".pytest_cache", ".eslintcache", ".stylelintcache",

  // --- Configs & Meta ---
  "nest-cli.json", "tsconfig.json", "tsconfig.build.json", "tsconfig.node.json", "tsconfig.app.json", "go.sum", "README.md", "LICENSE", "CONTRIBUTING.md", "project-structure.txt", ".prisma"
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

// Cancel Button Logic
document.getElementById("cancelBtn").addEventListener("click", () => {
  if (abortController) {
    abortController.abort(); // Sends the signal to stop
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
  if (paths) {
    paths.forEach((p) => {
      if (!selectedFolders.some((f) => f.path === p)) {
        selectedFolders.push({ path: p, enabled: true });
      }
    });
    updateFolderUI();
  }
});

document.getElementById("clearBtn").addEventListener("click", () => {
  selectedFolders = [];
  activeSmartExcludes.clear();
  updateFolderUI();
  document.getElementById("textContent").value = "";
  updateMetadata(""); // This will hide the meta bar
});

// --- Core File Logic ---

async function getFiles(signal) {
  const manualExcludes = document
    .getElementById("excludeInput")
    .value.split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const allExcludes = [...activeSmartExcludes, ...manualExcludes];
  let allFiles = [];

  for (const folderObj of selectedFolders.filter((f) => f.enabled)) {
    if (signal.aborted) return []; // Stop if cancelled
    await walk(folderObj.path, allFiles, allExcludes, signal);
  }
  return allFiles;
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
        if (!binaryExts.includes(ext)) {
          filelist.push(filePath);
        }
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

      // --- Large File Check (> 1MB) ---
      if (fileSizeMB > 1) {
        // Pause UI loading to show dialog
        const choice = await ipcRenderer.invoke(
          "show-large-file-warning",
          fileName,
          fileSizeMB,
        );

        if (choice === 1) {
          // Skip & Add to Exclude
          const currentExcludes = excludeInput.value
            ? excludeInput.value.split(",").map((s) => s.trim())
            : [];
          if (!currentExcludes.includes(fileName)) {
            currentExcludes.push(fileName);
            excludeInput.value = currentExcludes.join(", ");
          }
          continue; // Skip this file
        } else if (choice === 2) {
          // Stop Process
          abortController.abort();
          break;
        }
        // If choice is 0 (Continue), it just proceeds to read
      }

      // Update UI Progress
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

    // ... inside concatBtn listener, near the end:
    if (!signal.aborted) {
      const finalContent = combined || "No readable content found.";
      document.getElementById("textContent").value = finalContent;

      // Trigger the metadata update here
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

  setLoading(true, "Refreshing files before copy...");

  try {
    const { aborted, files, combined, newest } = await rebuildContent(signal);
    if (aborted) return;

    if (files.length === 0) {
      alert("No files found.");
      return;
    }

    const finalContent = combined || "No readable content found.";
    clipboard.writeText(finalContent);

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
    } else {
      alert("Files copied.");
    }
  } catch (err) {
    console.error("Failed to copy text: ", err);
    alert("Failed to copy to clipboard.");
  } finally {
    setLoading(false);
  }
});

function updateMetadata(text) {
  const metaInfo = document.getElementById("metaInfo");
  if (!text || text.trim() === "") {
    metaInfo.style.display = "none";
    return;
  }

  // Calculate Lines
  const lines = text.split(/\r\n|\r|\n/).length;

  // Calculate Words (matches alphanumeric sequences)
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;

  // Calculate Size (using Blob to get accurate byte count for UTF-8)
  const bytes = new Blob([text]).size;
  let sizeStr = "";
  if (bytes < 1024) sizeStr = bytes + " B";
  else if (bytes < 1048576) sizeStr = (bytes / 1024).toFixed(2) + " KB";
  else sizeStr = (bytes / 1048576).toFixed(2) + " MB";

  // Update UI
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
