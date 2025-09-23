const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

(async () => {
  try {
    const pdfPath = path.join(__dirname, '..', '2025年软件工程课程设计题目.pdf');
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(dataBuffer);
    const outPath = path.join(__dirname, '..', 'requirements_extracted.txt');
    fs.writeFileSync(outPath, data.text, 'utf8');
    console.log('已提取文本到:', outPath);
  } catch (e) {
    console.error('提取失败:', e);
    process.exit(1);
  }
})();
