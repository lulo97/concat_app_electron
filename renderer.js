const { ipcRenderer } = require("electron");
const fs = require("fs").promises;
const path = require("path");

// --- State Management ---
let selectedFolders = [];
let activeSmartExcludes = new Set();
let abortController = null; // Used to stop the loops

const COMMON_NOISE = [
  // --- Version Control & OS ---
  ".git", ".svn", ".hg", ".DS_Store", "thumbs.db", ".gitignore", ".gitattributes",

  // --- Package Managers ---
  "node_modules", "bower_components", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", 
  "composer.lock", "Cargo.lock", "Gemfile.lock",

  // --- Build Outputs & Caches ---
  "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".astro", ".remix", ".docusaurus",
  "target", "bin", "obj", ".gradle", ".cache", ".turbo", ".parcel-cache", "storybook-static",

  // --- Environment & Secrets ---
  ".env", ".env.local", ".env.development", ".env.production", ".env.test", 
  "*.pem", "*.crt", "*.key", "*.pub",

  // --- Language/Environment Specific ---
  "venv", ".venv", "env", "__pycache__", ".pytest_cache", "go.sum", 
  ".vs", ".vscode", ".idea", "nest-cli.json", "tsconfig.json", "tsconfig.build.json",
  "tsconfig.node.json", "tsconfig.app.json", ".angular",

  // --- Testing & Coverage ---
  "coverage", ".nyc_output", "test-results", "playwright-report", "cypress/screenshots", 
  "cypress/videos", ".eslintcache", ".stylelintcache",

  // --- Logs & Temp ---
  "logs", "*.log", "npm-debug.log*", "yarn-debug.log*", "yarn-error.log*", 
  "temp", "tmp", ".temp", ".tmp",

  // --- Media & Heavy Assets ---
  "*.gguf", "*.bin", "*.onnx", "*.weights", "*.svg", "*.png", "*.jpg", "*.jpeg", "*.gif", 
  "*.pdf", "*.mp4", "*.webm",

  // --- Database & Local Storage ---
  "*.db", "*.sqlite", "*.db-shm", "*.db-wal", ".prisma",

  // --- Documentation & Project Meta ---
  "README.md", "LICENSE", "CONTRIBUTING.md", "project-structure.txt", ".github"
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
    .value.split(",")
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
        const binaryExts = [
          ".png",
          ".jpg",
          ".jpeg",
          ".gif",
          ".pdf",
          ".zip",
          ".exe",
          ".dll",
          ".pyc",
          ".ico",
          ".gguf",
          ".bin",
          ".onnx",
          ".pt",
          ".pth",
          ".model", // Added binary/AI formats
        ];
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

document.getElementById("copyBtn").addEventListener("click", () => {
  const text = document.getElementById("textContent");
  if (!text.value) return;
  text.select();
  document.execCommand("copy");
  const btn = document.getElementById("copyBtn");
  const originalText = btn.innerText;
  btn.innerText = "Copied!";
  setTimeout(() => {
    btn.innerText = originalText;
  }, 2000);
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
