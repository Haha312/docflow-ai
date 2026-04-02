// 用 node 临时脚本分析 docx 结构
const fs = require('fs');
const path = require('path');

const filePath = 'C:\\Users\\86188\\Desktop\\基于三维信息技术的新能源电站数字化设计关键技术研究报告(1).docx';
const buf = fs.readFileSync(filePath);
console.log('文件大小:', (buf.length / 1024).toFixed(1), 'KB');
