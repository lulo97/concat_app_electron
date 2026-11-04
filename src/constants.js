const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.tiff', '.ico', '.svg',
  '.mp4', '.webm', '.mov', '.avi', '.mp3', '.wav', '.flac', '.ogg',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar', '.jar', '.war',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.msi', '.pyc',
  '.gguf', '.onnx', '.pt', '.pth', '.model', '.weights', '.safetensors',
  '.db', '.sqlite', '.db-shm', '.db-wal',
  '.log', '.tmp', '.temp', '.bak', '.swp',
  '.pem', '.crt', '.key', '.pub', '.der',
]);

const COMMON_NOISE = [
  '.git', '.svn', '.hg', '.DS_Store', 'thumbs.db', '.gitignore', '.gitattributes', '.github',
  'node_modules', 'bower_components',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'Cargo.lock', 'Gemfile.lock',
  'dist', 'build', 'out', 'target', 'bin', 'obj', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.astro', '.remix', '.cache', '.turbo', '.parcel-cache',
  'storybook-static', '.gradle',
  '.env', '.env.local', '.env.development', '.env.production', '.env.test',
  '.vs', '.vscode', '.idea', '.angular',
  'venv', '.venv', 'env', '__pycache__', '.pytest_cache', '.eslintcache', '.stylelintcache',
  'nest-cli.json', 'tsconfig.json', 'tsconfig.build.json', 'tsconfig.node.json', 'tsconfig.app.json',
  'go.sum', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'project-structure.txt', '.prisma',
];

// lowercase -> canonical name (excludes are case-insensitive)
const NOISE_MAP = new Map(COMMON_NOISE.map((n) => [n.toLowerCase(), n]));

const PY_EXTS = new Set(['.py', '.pyw']);
const BRACE_EXTS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.java', '.c', '.h', '.cpp', '.hpp', '.cc',
  '.cs', '.go', '.rs', '.php', '.kt', '.kts', '.swift', '.scala', '.dart',
]);

module.exports = {
  BINARY_EXTS,
  COMMON_NOISE,
  NOISE_MAP,
  PY_EXTS,
  BRACE_EXTS,
  CONCATIGNORE_FILE: '.concatignore',
  ALWAYS_SKIP: ['.concatignore'],
  LARGE_FILE_BYTES: 1024 * 1024,
};
