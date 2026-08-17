// Renders resume-content.mjs to Colin-Shanahan-Resume.docx.
//
// Written with real Word constructs rather than converted from the PDF:
// right-aligned tab stops carry the dates and locations (so they stay put
// when the recipient edits), headings use paragraph bottom borders, and
// bullets use Word's native list numbering. The result is a document a
// recruiter can actually edit, not a picture of one.
//
//   npm install && npm run build
import { writeFileSync } from "node:fs";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
} from "docx";
import { RESUME } from "./resume-content.mjs";

const FONT = "Calibri";
// Half-points, as Word measures them: 21 => 10.5pt.
const SIZE = { name: 30, contact: 18, section: 20, company: 20, body: 19 };
const INK = "1A1A1A";
const RULE = "9A9A9A";

// Letter page, 0.5in margins => 7.5in of content = 10800 twips.
const CONTENT_WIDTH = 10800;

// A bare string is plain; { b } is bold.
const runs = (parts, opts = {}) =>
  (Array.isArray(parts) ? parts : [parts]).map((p) =>
    new TextRun({
      text: typeof p === "string" ? p : p.b,
      bold: typeof p !== "string",
      font: FONT,
      size: opts.size ?? SIZE.body,
      color: INK,
    })
  );

// Spacing is deliberately tight: the content runs just past a single page at
// comfortable settings, and a resume that spills two lines onto page two
// reads worse than one that is a little snug.
const sectionHeading = (text) =>
  new Paragraph({
    spacing: { before: 140, after: 40 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 2 } },
    children: [
      new TextRun({ text: text.toUpperCase(), bold: true, font: FONT, size: SIZE.section, color: INK }),
    ],
  });

// "Left thing ................ right thing" on one line, held by a tab stop
// rather than spaces, so it survives editing.
const splitLine = (left, right, { bold = false, italics = false } = {}) =>
  new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
    spacing: { before: bold ? 100 : 0, after: 10 },
    children: [
      new TextRun({ text: left, bold, italics, font: FONT, size: SIZE.company, color: INK }),
      // A real <w:tab/>, not a literal tab character — Word only advances to
      // the tab stop for the element, so a "\t" string leaves the right-hand
      // text floating mid-line.
      new TextRun({ children: [new Tab()], font: FONT, size: SIZE.company }),
      new TextRun({ text: right, bold, italics, font: FONT, size: SIZE.company, color: INK }),
    ],
  });

const bullet = (parts) =>
  new Paragraph({
    numbering: { reference: "resume-bullets", level: 0 },
    spacing: { after: 20, line: 240 },
    children: runs(parts),
  });

const doc = new Document({
  creator: RESUME.name,
  title: `${RESUME.name} — Resume`,
  description: "Resume",
  numbering: {
    config: [
      {
        reference: "resume-bullets",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 288, hanging: 180 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } },
      },
      children: [
        // ── header ──────────────────────────────────────────────────────
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [
            new TextRun({ text: RESUME.name, bold: true, font: FONT, size: SIZE.name, color: INK }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 20 },
          children: [
            new TextRun({ text: RESUME.contact, font: FONT, size: SIZE.contact, color: INK }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [
            new TextRun({ text: RESUME.portfolio.prefix, font: FONT, size: SIZE.contact, color: INK }),
            new ExternalHyperlink({
              link: RESUME.portfolio.link.url,
              children: [
                new TextRun({
                  text: RESUME.portfolio.link.text,
                  font: FONT,
                  size: SIZE.contact,
                  color: "1B6DC1",
                  underline: {},
                }),
              ],
            }),
            new TextRun({
              text: RESUME.portfolio.suffix,
              italics: true,
              font: FONT,
              size: SIZE.contact,
              color: INK,
            }),
          ],
        }),

        // ── summary ─────────────────────────────────────────────────────
        sectionHeading("Summary"),
        new Paragraph({ spacing: { after: 30, line: 240 }, children: runs(RESUME.summary) }),

        // ── experience ──────────────────────────────────────────────────
        sectionHeading("Work Experience"),
        ...RESUME.experience.flatMap((job) => [
          splitLine(job.company, job.dates, { bold: true }),
          splitLine(job.title, job.location, { italics: true }),
          ...job.bullets.map(bullet),
        ]),

        // ── projects ────────────────────────────────────────────────────
        sectionHeading("Selected Projects"),
        ...RESUME.projects.map(bullet),

        // ── education ───────────────────────────────────────────────────
        sectionHeading("Education"),
        splitLine(RESUME.education.school, RESUME.education.date, { bold: true }),
        splitLine(RESUME.education.degree, RESUME.education.location, { italics: true }),

        // ── certifications & skills ─────────────────────────────────────
        sectionHeading("Certifications & Skills"),
        ...RESUME.skills.map(bullet),
      ],
    },
  ],
});

const out = new URL("./Colin-Shanahan-Resume.docx", import.meta.url);
writeFileSync(out, await Packer.toBuffer(doc));
console.log(`wrote ${out.pathname.split("/").pop()}`);
