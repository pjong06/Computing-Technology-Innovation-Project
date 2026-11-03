// pdf.js - makes the PDF file for a report.

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 40;
const LINE_HEIGHT = 11.5;
const PADDING_X = 5;
const PADDING_Y = 4;
const FONT_SIZE = 9;
const HEADER_HEIGHT = 20;

const HELVETICA_WIDTHS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

// Works out how wide a text will be, using the letter widths in HELVETICA_WIDTHS.
function textWidth(text, size, bold) {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 32 && code <= 126) {
      total = total + HELVETICA_WIDTHS[code - 32];
    } else {
      total = total + 556;
    }
  }
  let width = total * size / 1000;
  if (bold) {
    width = width * 1.06;
  }
  return width;
}

// Cuts a word that is wider than the column into pieces.
// The pieces are added to lines. The last piece is returned.
function cutLongWord(word, maxWidth, size, bold, lines) {
  while (textWidth(word, size, bold) > maxWidth && word.length > 1) {
    let n = word.length - 1;
    while (n > 1 && textWidth(word.slice(0, n), size, bold) > maxWidth) {
      n = n - 1;
    }
    lines.push(word.slice(0, n));
    word = word.slice(n);
  }
  return word;
}

// Turns tabs, line breaks and repeated spaces into single spaces.
function cleanSpaces(text) {
  let result = '';
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const letter = text.charAt(i);
    if (letter === ' ' || letter === '\t' || letter === '\n' || letter === '\r') {
      if (lastWasSpace === false) {
        result = result + ' ';
      }
      lastWasSpace = true;
    } else {
      result = result + letter;
      lastWasSpace = false;
    }
  }
  return result.trim();
}

// Splits a text into a list of lines that each fit inside maxWidth.
function wrapText(text, maxWidth, size, bold) {
  const lines = [];
  let cleaned = '';
  if (text !== null && text !== undefined) {
    cleaned = cleanSpaces(String(text));
  }
  const words = cleaned.split(' ');
  let line = '';

  for (let i = 0; i < words.length; i++) {
    let word = words[i];
    let attempt = word;
    if (line !== '') {
      attempt = line + ' ' + word;
    }

    if (textWidth(attempt, size, bold) <= maxWidth) {
      line = attempt;
      continue;
    }
    if (line !== '') {
      lines.push(line);
      line = '';
    }
    line = cutLongWord(word, maxWidth, size, bold, lines);
  }
  lines.push(line);
  return lines;
}

// Turns a colour like "#a01818" into the three numbers (0 to 1) that a PDF needs.
function pdfColor(hex) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const twoLetters = hex.slice(1 + i * 2, 3 + i * 2);
    const number = parseInt(twoLetters, 16) / 255;
    parts.push(number.toFixed(3));
  }
  return parts.join(' ');
}

// Returns the text colour for each conservation status.
function statusColor(value) {
  if (value === 'Endangered') {
    return '#a01818';
  }
  if (value === 'Vulnerable') {
    return '#a67c00';
  }
  if (value === 'Least Concern') {
    return '#2f4a3b';
  }
  return '#222222';
}

// Prepares text for the PDF.
// Letters the font cannot show become "?", and \ ( ) get a backslash in front.
function pdfText(text) {
  const fancy = { 8211: 150, 8212: 151, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149, 8230: 133 };
  let result = '';

  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);

    if (fancy[code]) {
      code = fancy[code];
    } else if (code === 9 || code === 10 || code === 13) {
      code = 32;
    } else if (code >= 32 && code <= 126) {
    } else if (code >= 160 && code <= 255) {
    } else {
      code = 63;
    }

    let letter = String.fromCharCode(code);
    if (letter === '\\' || letter === '(' || letter === ')') {
      letter = '\\' + letter;
    }
    result = result + letter;
  }
  return result;
}

// Adds a text to the page. top is the distance from the top of the page.
// A PDF counts from the bottom, so the value is flipped here.
function drawText(page, x, top, str, size, font, color) {
  const bottom = PAGE_HEIGHT - top - size * 0.8;
  page.push('BT /' + font + ' ' + size + ' Tf ' + pdfColor(color) + ' rg ' +
    x.toFixed(2) + ' ' + bottom.toFixed(2) + ' Td (' + pdfText(str) + ') Tj ET');
}

// Adds a filled rectangle to the page.
function drawRect(page, x, top, width, height, color) {
  const bottom = PAGE_HEIGHT - top - height;
  page.push(pdfColor(color) + ' rg ' + x.toFixed(2) + ' ' + bottom.toFixed(2) + ' ' +
    width.toFixed(2) + ' ' + height.toFixed(2) + ' re f');
}

// Adds a thin line across the page.
function drawLine(page, top, color) {
  const y = (PAGE_HEIGHT - top).toFixed(2);
  page.push(pdfColor(color) + ' RG 0.5 w ' + MARGIN + ' ' + y + ' m ' + (PAGE_WIDTH - MARGIN) + ' ' + y + ' l S');
}

// Works out the width of every column from the w value of each column.
function getColumnWidths(report) {
  const usable = PAGE_WIDTH - 2 * MARGIN;

  let sum = 0;
  for (let c = 0; c < report.columns.length; c++) {
    sum = sum + report.columns[c].w;
  }

  const widths = [];
  for (let c = 0; c < report.columns.length; c++) {
    widths.push(usable * report.columns[c].w / sum);
  }
  return widths;
}

// Draws the green row with the column names. Returns the position below it.
function drawTableHeader(page, top, report, colW) {
  drawRect(page, MARGIN, top, PAGE_WIDTH - 2 * MARGIN, HEADER_HEIGHT, '#334f3f');
  let x = MARGIN;
  for (let c = 0; c < report.columns.length; c++) {
    drawText(page, x + PADDING_X, top + 6, report.columns[c].label, FONT_SIZE, 'F2', '#ffffff');
    x = x + colW[c];
  }
  return top + HEADER_HEIGHT;
}

// Starts a new page. The first page also gets the title.
// Returns the page and the position where the table starts.
function startPage(pages, report, generated, colW, isFirstPage) {
  const page = [];
  pages.push(page);
  let top = MARGIN;

  if (isFirstPage) {
    drawText(page, MARGIN, top, 'NIAH GROUND-TRUTH · CONSERVATION OFFICER REPORT', 8, 'F2', '#6f8577');
    top = top + 16;
    drawText(page, MARGIN, top, report.title, 20, 'F2', '#334f3f');
    top = top + 28;
    drawText(page, MARGIN, top, 'Generated ' + generated + ' · ' + report.summary, 9, 'F1', '#555555');
    top = top + 20;
  }

  top = drawTableHeader(page, top, report, colW);
  return { page: page, top: top };
}

// Cuts the text of every cell in one row into lines. Returns a list of lists.
function wrapRow(report, rowNumber, colW) {
  const cells = [];
  for (let c = 0; c < report.columns.length; c++) {
    const maxWidth = colW[c] - 2 * PADDING_X;
    cells.push(wrapText(report.rows[rowNumber][c], maxWidth, FONT_SIZE, false));
  }
  return cells;
}

// Draws one table row. Returns the position below it.
function drawRow(page, top, rowNumber, cells, rowHeight, report, colW) {
  if (rowNumber % 2 === 1) {
    drawRect(page, MARGIN, top, PAGE_WIDTH - 2 * MARGIN, rowHeight, '#f3f6f4');
  }

  let x = MARGIN;
  for (let c = 0; c < report.columns.length; c++) {
    const column = report.columns[c];

    let font = 'F1';
    if (column.pill) {
      font = 'F2';
    } else if (column.italic) {
      font = 'F3';
    }

    let color = '#222222';
    if (column.pill) {
      color = statusColor(report.rows[rowNumber][c]);
    }

    for (let line = 0; line < cells[c].length; line++) {
      drawText(page, x + PADDING_X, top + PADDING_Y + line * LINE_HEIGHT, cells[c][line], FONT_SIZE, font, color);
    }
    x = x + colW[c];
  }

  const bottom = top + rowHeight;
  drawLine(page, bottom, '#e0e8e3');
  return bottom;
}

// Puts all the rows on pages. A new page is started when a row does not fit.
function layoutPages(report, generated, colW) {
  const pages = [];
  let start = startPage(pages, report, generated, colW, true);
  let page = start.page;
  let top = start.top;

  for (let r = 0; r < report.rows.length; r++) {
    const cells = wrapRow(report, r, colW);

    let mostLines = 1;
    for (let c = 0; c < cells.length; c++) {
      if (cells[c].length > mostLines) {
        mostLines = cells[c].length;
      }
    }
    const rowHeight = mostLines * LINE_HEIGHT + 2 * PADDING_Y;

    if (top + rowHeight > PAGE_HEIGHT - MARGIN - 18) {
      start = startPage(pages, report, generated, colW, false);
      page = start.page;
      top = start.top;
    }

    top = drawRow(page, top, r, cells, rowHeight, report, colW);
  }
  return pages;
}

// Adds the report name and "Page 1 of 2" at the bottom of every page.
function addFooters(pages, report) {
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    drawText(page, MARGIN, PAGE_HEIGHT - 28, 'Niah Biotrack · ' + report.title, 8, 'F1', '#6f8577');

    const label = 'Page ' + (p + 1) + ' of ' + pages.length;
    const x = PAGE_WIDTH - MARGIN - textWidth(label, 8, false);
    drawText(page, x, PAGE_HEIGHT - 28, label, 8, 'F1', '#6f8577');
  }
}

// Adds one numbered object to the PDF text and remembers where it starts.
function addPdfObject(file, number, body) {
  file.offsets[number] = file.text.length;
  file.text = file.text + number + ' 0 obj\n' + body + '\nendobj\n';
}

// Writes the pages in the PDF file format. Returns the file as bytes.
function writePdfFile(pages) {
  const file = { text: '%PDF-1.4\n', offsets: [] };

  const pageRefs = [];
  for (let i = 0; i < pages.length; i++) {
    pageRefs.push((7 + i * 2) + ' 0 R');
  }

  addPdfObject(file, 1, '<< /Type /Catalog /Pages 2 0 R >>');
  addPdfObject(file, 2, '<< /Type /Pages /Kids [' + pageRefs.join(' ') + '] /Count ' + pages.length + ' >>');
  addPdfObject(file, 3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  addPdfObject(file, 4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  addPdfObject(file, 5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');

  for (let i = 0; i < pages.length; i++) {
    const content = pages[i].join('\n');
    addPdfObject(file, 6 + i * 2, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    addPdfObject(file, 7 + i * 2, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_WIDTH + ' ' + PAGE_HEIGHT + '] ' +
      '/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ' + (6 + i * 2) + ' 0 R >>');
  }

  const totalObjects = 6 + pages.length * 2;
  const xrefStart = file.text.length;
  file.text = file.text + 'xref\n0 ' + totalObjects + '\n0000000000 65535 f \n';
  for (let i = 1; i < totalObjects; i++) {
    file.text = file.text + ('0000000000' + file.offsets[i]).slice(-10) + ' 00000 n \n';
  }
  file.text = file.text + 'trailer\n<< /Size ' + totalObjects + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';

  const bytes = new Uint8Array(file.text.length);
  for (let i = 0; i < file.text.length; i++) {
    bytes[i] = file.text.charCodeAt(i) % 256;
  }
  return bytes;
}

// Builds the whole PDF for a report. Returns the file as bytes.
function makePdf(report, generated) {
  const colW = getColumnWidths(report);
  const pages = layoutPages(report, generated, colW);
  addFooters(pages, report);
  return writePdfFile(pages);
}
