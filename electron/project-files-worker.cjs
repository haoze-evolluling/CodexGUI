const { parentPort, workerData } = require('worker_threads');
const { listProjectFilesAsync } = require('./project-files.cjs');

listProjectFilesAsync(workerData.root)
  .then(files => parentPort.postMessage({ files }))
  .catch(error => parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) }));
