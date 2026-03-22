const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

// State Management
let selectedFolders = [];

const COMMON_NOISE = [
  // General & VCS
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".DS_Store",
  "thumbs.db",
  ".env",
  ".env.local",

  // JavaScript / TypeScript / Vue / React
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  ".vuepress",
  ".serverless",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bower_components",

  // Python
  "venv",
  ".venv",
  "env",
  "venv.bak",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
  "poetry.lock",
  "pip-log.txt",

  // C# / .NET / Visual Studio
  "bin",
  "obj",
  ".vs",
  ".vscode",
  "Properties",
  "App.config",
  "packages",
  "TestResults",
  "PublishScripts",
  ".user",
  ".suo",

  // Java / Maven / Gradle
  "target",
  ".gradle",
  ".mvn",
  "build.log",
  ".metadata",
  ".recommenders",
  "*.class", // Usually handled in file extension filter, but good for folders

  // C++ / Compiled languages
  "Debug",
  "Release",
  "x64",
  "x86",
  "ipch",

  // Documentation / Logs
  "logs",
  "temp",
  "tmp",
  "coverage",
];

let activeSmartExcludes = new Set();

// --- Folder Management ---

function updateFolderUI() {
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
  detectNoise();
}

// --- Updated Noise Detection ---

function detectNoise() {
  const foundInFolders = new Set();

  // Scan every enabled folder recursively (with a depth limit)
  selectedFolders
    .filter((f) => f.enabled)
    .forEach((folderObj) => {
      scanForNoise(folderObj.path, foundInFolders, 0, 3); // Depth limit of 3
    });

  const container = document.getElementById("smartExcludes");
  if (!container) return;

  // We keep existing checked states so user preferences aren't wiped on every refresh
  const previouslyChecked = new Set(activeSmartExcludes);

  container.innerHTML =
    foundInFolders.size > 0
      ? "<div style='width:100%; font-size:12px; margin-bottom:5px;'><strong>Auto-Exclude detected (Recursive):</strong></div>"
      : "";

  foundInFolders.forEach((noise) => {
    // If it's a new discovery, auto-exclude it. If we saw it before, keep previous state.
    if (!activeSmartExcludes.has(noise) && !previouslyChecked.has(noise)) {
      activeSmartExcludes.add(noise);
    }

    const isChecked = activeSmartExcludes.has(noise);

    const label = document.createElement("label");
    label.style =
      "background: #e0e0e0; padding: 4px 10px; border-radius: 15px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 5px; border: 1px solid #ccc; margin-bottom: 5px;";
    label.innerHTML = `
            <input type="checkbox" ${isChecked ? "checked" : ""} onchange="toggleSmartExclude('${noise}', this.checked)">
            ${noise}
        `;
    container.appendChild(label);
  });
}

/**
 * Helper to find noise items in subdirectories
 * @param {string} dir Current directory
 * @param {Set} foundSet Set to collect found noise names
 * @param {number} depth Current recursion depth
 * @param {number} maxDepth Stop scanning after X levels
 */
function scanForNoise(dir, foundSet, depth, maxDepth) {
  if (depth > maxDepth) return;

  try {
    const items = fs.readdirSync(dir);
    items.forEach((item) => {
      // If the item name is in our COMMON_NOISE list, add it
      if (COMMON_NOISE.includes(item)) {
        foundSet.add(item);
      }

      // If it's a directory, dive deeper (unless it's already a noise folder)
      const fullPath = path.join(dir, item);
      if (!COMMON_NOISE.includes(item) && fs.statSync(fullPath).isDirectory()) {
        scanForNoise(fullPath, foundSet, depth + 1, maxDepth);
      }
    });
  } catch (e) {
    // Silence errors for system/protected folders
  }
}

window.toggleSmartExclude = (name, isChecked) => {
  if (isChecked) activeSmartExcludes.add(name);
  else activeSmartExcludes.delete(name);
};

window.toggleFolder = (index) => {
  selectedFolders[index].enabled = !selectedFolders[index].enabled;
  detectNoise(); // Refresh smart excludes based on new selection
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
});

// --- Validation Logic ---

async function validateFiles(files) {
  if (files.length === 0) {
    alert("No files found to process.");
    return false;
  }

  if (files.length > 200) {
    const choice = await ipcRenderer.invoke(
      "show-warning",
      `Large task: ${files.length} files detected. This might take a moment.`,
    );
    if (choice === 1) return false;
  }

  for (const f of files) {
    try {
      const stats = fs.statSync(f);
      if (stats.size > 1024 * 1024) {
        // 1MB Limit
        const choice = await ipcRenderer.invoke(
          "show-warning",
          `Large file detected: ${path.basename(f)} (>1MB). Large files can freeze the UI.`,
        );
        if (choice === 1) return false;
        break;
      }
    } catch (e) {
      continue;
    }
  }
  return true;
}

// --- Core File Logic ---

function getFiles() {
  const manualExcludes = document
    .getElementById("excludeInput")
    .value.split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  // Merge detected smart excludes with user-typed excludes
  const allExcludes = [...activeSmartExcludes, ...manualExcludes];

  let allFiles = [];
  selectedFolders
    .filter((f) => f.enabled)
    .forEach((folderObj) => {
      walkSync(folderObj.path, allFiles, allExcludes);
    });
  return allFiles;
}

function walkSync(dir, filelist = [], excludes = []) {
  try {
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      // Check if directory or file name is in the exclude list
      if (excludes.includes(file)) return;

      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        walkSync(filePath, filelist, excludes);
      } else {
        // Skip common binary/image extensions automatically for safety
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
        ];
        if (!binaryExts.includes(ext)) {
          filelist.push(filePath);
        }
      }
    });
  } catch (e) {
    console.error("Walk error:", e);
  }
}

// --- Button Actions ---

document.getElementById("listBtn").addEventListener("click", async () => {
  const files = getFiles();
  if (await validateFiles(files)) {
    document.getElementById("textContent").value =
      `Total Files: ${files.length}\n\n` + files.join("\n");
  }
});

document.getElementById("concatBtn").addEventListener("click", async () => {
  const files = getFiles();
  if (!(await validateFiles(files))) return;

  let combined = "";
  files.forEach((f) => {
    try {
      const content = fs.readFileSync(f, "utf8");
      combined += `\n\n===== ${f} =====\n\n${content}`;
    } catch (e) {
      combined += `\n\n[Error reading ${f}]\n`;
    }
  });
  document.getElementById("textContent").value =
    combined || "No readable content found.";
});

document.getElementById("copyBtn").addEventListener("click", () => {
  const text = document.getElementById("textContent");
  if (!text.value) return;

  text.select();
  document.execCommand("copy");

  const originalText = document.getElementById("copyBtn").innerText;
  document.getElementById("copyBtn").innerText = "Copied!";
  setTimeout(() => {
    document.getElementById("copyBtn").innerText = originalText;
  }, 2000);
});
