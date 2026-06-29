#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appendAudit, exists, removeTree, reportsRoot, rootDir, sha256File, toPosix, writeJson } from "./harness-core.mjs";

const defaultReportManifestPath = path.join(reportsRoot, "report-export-manifest.json");
const defaultOutputRoot = path.join(reportsRoot, "exported-pdf");
const defaultPdfManifestPath = path.join(reportsRoot, "pdf-report-export-manifest.json");
const defaultMarkdownPath = path.join(rootDir, "docs", "generated", "pdf-report-index.md");
const pdfProfile =
  "Plain-text companion PDF generated from report HTML for review packets. The source HTML remains the canonical report rendering.";

const parseOptions = (values) => {
  const options = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      options._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
};

const repoRelative = (targetPath) => toPosix(path.relative(rootDir, targetPath));

const decodeEntities = (value) =>
  String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));

export const htmlToReportText = (html) =>
  decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(h1|h2|h3|p|div|section|header|main|tr|table|ul|ol|li)>/gi, "\n")
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );

const sanitizePdfText = (value) =>
  String(value ?? "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?")
    .replace(/\s+/g, " ")
    .trim();

const wrapLine = (line, width = 92) => {
  const clean = sanitizePdfText(line);
  if (!clean) {
    return [""];
  }
  const words = clean.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
};

const escapePdf = (value) => String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const splitPages = (lines, pageLineLimit = 52) => {
  const pages = [];
  for (let index = 0; index < lines.length; index += pageLineLimit) {
    pages.push(lines.slice(index, index + pageLineLimit));
  }
  return pages.length ? pages : [[""]];
};

export const createSimplePdf = ({ title, lines }) => {
  const wrappedLines = [
    title,
    "",
    ...lines,
  ].flatMap((line) => wrapLine(line));
  const pages = splitPages(wrappedLines);
  const objectBodies = new Map();
  const pageObjectIds = [];
  const maxObjectId = 3 + pages.length * 2;

  objectBodies.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objectBodies.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  pages.forEach((pageLines, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    pageObjectIds.push(pageId);
    const bodyLines = ["BT", "/F1 10 Tf", "50 760 Td", "14 TL"];
    pageLines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        bodyLines.push("T*");
      }
      bodyLines.push(`(${escapePdf(line)}) Tj`);
    });
    bodyLines.push("ET");
    const stream = bodyLines.join("\n");
    const streamLength = Buffer.byteLength(stream, "ascii");
    objectBodies.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objectBodies.set(contentId, `<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`);
  });

  objectBodies.set(2, `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id <= maxObjectId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "ascii");
    pdf += `${id} 0 obj\n${objectBodies.get(id)}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${maxObjectId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxObjectId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
};

const pdfFileName = (report) => `${String(report.templateId ?? "report").replace(/[^a-z0-9._-]/gi, "-")}.pdf`;

const markdownIndex = (manifest) => [
  "# PDF Report Export Index",
  "",
  `Generated: ${manifest.generatedAt}`,
  "",
  pdfProfile,
  "",
  "| App | Subject | Report | PDF | Source HTML | SHA-256 |",
  "| --- | --- | --- | --- | --- | --- |",
  ...manifest.appResults.flatMap((appResult) =>
    appResult.reports.map(
      (report) =>
        `| ${appResult.appId} | ${report.subjectId} | ${report.title} | ${report.path} | ${report.sourceHtmlPath} | ${report.sha256} |`,
    ),
  ),
  "",
].join("\n");

export const exportReportPdfs = async ({
  reportManifestPath = defaultReportManifestPath,
  outputRoot = defaultOutputRoot,
  reportPath = defaultPdfManifestPath,
  markdownPath = defaultMarkdownPath,
  writeOutputs = true,
} = {}) => {
  if (!(await exists(reportManifestPath))) {
    throw new Error(`Missing report export manifest: ${repoRelative(reportManifestPath)}`);
  }
  const sourceManifest = JSON.parse(await readFile(reportManifestPath, "utf8"));
  const generatedAt = new Date().toISOString();
  const appResults = [];

  if (writeOutputs) {
    await removeTree(outputRoot);
    await mkdir(outputRoot, { recursive: true });
  }

  for (const appResult of sourceManifest.appResults ?? []) {
    const nextAppResult = {
      appId: appResult.appId,
      reports: [],
    };
    for (const report of appResult.reports ?? []) {
      const sourceHtmlPath = path.isAbsolute(report.path) ? report.path : path.join(rootDir, report.path);
      if (!(await exists(sourceHtmlPath))) {
        throw new Error(`Missing source HTML report: ${path.isAbsolute(report.path) ? report.path : report.path}`);
      }
      const text = htmlToReportText(await readFile(sourceHtmlPath, "utf8"));
      const lines = [
        "PDF role: companion artifact. The source HTML report is canonical.",
        `Source HTML: ${path.isAbsolute(report.path) ? sourceHtmlPath : report.path}`,
        `Subject: ${report.subjectId ?? "n/a"}`,
        `Template: ${report.templateId ?? "n/a"}`,
        `Source HTML SHA-256: ${report.sha256 ?? "n/a"}`,
        `Clinical use limitation: ${sourceManifest.clinicalUseLimitation ?? "n/a"}`,
        "",
        ...text.split(/\r?\n/),
      ];
      const pdf = createSimplePdf({ title: report.title ?? report.templateId ?? "Report", lines });
      const targetPath = path.join(outputRoot, appResult.appId, report.subjectId ?? "all-subjects", pdfFileName(report));
      if (writeOutputs) {
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, pdf);
      }
      const sha256 = createHash("sha256").update(pdf).digest("hex");
      nextAppResult.reports.push({
        templateId: report.templateId,
        title: report.title,
        subjectId: report.subjectId,
        sourceHtmlPath: path.isAbsolute(report.path) ? sourceHtmlPath : report.path,
        path: path.isAbsolute(outputRoot) && outputRoot.startsWith(rootDir)
          ? repoRelative(targetPath)
          : toPosix(path.relative(outputRoot, targetPath)),
        absolutePath: targetPath,
        size: pdf.length,
        sha256,
      });
    }
    appResults.push(nextAppResult);
  }

  const pdfCount = appResults.reduce((total, appResult) => total + appResult.reports.length, 0);
  const result = {
    schemaVersion: 1,
    ok: true,
    generatedAt,
    generatedBy: "tauri-shinylive-harness",
    sourceManifest: path.isAbsolute(reportManifestPath) && reportManifestPath.startsWith(rootDir)
      ? repoRelative(reportManifestPath)
      : reportManifestPath,
    sourceManifestSha256: await sha256File(reportManifestPath),
    project: sourceManifest.project ?? null,
    clinicalUseLimitation: sourceManifest.clinicalUseLimitation ?? null,
    pdfProfile,
    summary: { pdfCount, appCount: appResults.length },
    appResults,
  };

  if (writeOutputs) {
    await writeJson(reportPath, result);
    await mkdir(path.dirname(markdownPath), { recursive: true });
    await writeFile(markdownPath, `${markdownIndex(result)}\n`);
    await appendAudit("export-report-pdfs", "ok", {
      pdfCount,
      report: path.isAbsolute(reportPath) && reportPath.startsWith(rootDir) ? repoRelative(reportPath) : reportPath,
    });
  }

  return result;
};

const runCli = async () => {
  const options = parseOptions(process.argv.slice(2));
  const result = await exportReportPdfs({
    reportManifestPath: options.manifest ? path.resolve(options.manifest) : defaultReportManifestPath,
    outputRoot: options.output ? path.resolve(options.output) : defaultOutputRoot,
    reportPath: options.report ? path.resolve(options.report) : defaultPdfManifestPath,
    markdownPath: options.markdown ? path.resolve(options.markdown) : defaultMarkdownPath,
  });
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        report: repoRelative(options.report ? path.resolve(options.report) : defaultPdfManifestPath),
        pdfs: result.summary.pdfCount,
      },
      null,
      2,
    ),
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
