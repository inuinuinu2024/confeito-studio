const fs = require('fs');
const agPsd = require('ag-psd');
require('ag-psd/initialize-canvas');
const { createCanvas } = require('canvas');

const canvasBottom = createCanvas(100, 100);
const ctxBottom = canvasBottom.getContext('2d');
ctxBottom.fillStyle = 'red';
ctxBottom.fillRect(0, 0, 100, 100);

const canvasTop = createCanvas(100, 100);
const ctxTop = canvasTop.getContext('2d');
ctxTop.fillStyle = 'blue';
ctxTop.fillRect(50, 50, 50, 50);

const psd = {
  width: 100,
  height: 100,
  children: [
    { name: 'TopLayer', canvas: canvasTop },
    { name: 'BottomLayer', canvas: canvasBottom }
  ]
};

const buffer = agPsd.writePsd(psd);
fs.writeFileSync('test_order.psd', buffer);

const readPsd = agPsd.readPsd(buffer);
console.log('Read order:', readPsd.children.map(c => c.name));
