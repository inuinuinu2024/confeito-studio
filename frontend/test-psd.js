const fs = require('fs');
const agPsd = require('ag-psd');
require('ag-psd/initialize-canvas');

const buffer = fs.readFileSync('../sample/test_2.psd');
const psd = agPsd.readPsd(buffer);
console.log(psd.children.map(c => c.name));
