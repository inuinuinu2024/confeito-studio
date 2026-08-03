import { getPsdCache } from './src/shared/utils/idb';
import { readPsd } from 'ag-psd';

async function main() {
  console.log("Testing PSD...");
  // Node doesn't have IDB. Wait, this won't work in node because of indexedDB.
}
main();
