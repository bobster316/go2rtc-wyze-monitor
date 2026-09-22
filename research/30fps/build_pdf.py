from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "research" / "30fps" / "report-source.md"
OUTPUT = ROOT / "output" / "pdf" / "Wyze-Cam-v4-Pi-Full-Resolution-30fps-Research.pdf"

INK = colors.HexColor("#18212B")
MUTED = colors.HexColor("#5F6B76")
RED = colors.HexColor("#C9342F")
AMBER = colors.HexColor("#D88916")
PALE = colors.HexColor("#F2F5F7")
GRID = colors.HexColor("#D4DCE2")


def inline_markup(text: str) -> str:
    escaped = html.escape(text)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", escaped)
    escaped = re.sub(
        r"(https://[^\s<]+)",
        lambda m: f"<link href='{m.group(1)}' color='#2F5F8F'>{m.group(1)}</link>",
        escaped,
    )
    return escaped


def page_chrome(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setStrokeColor(GRID)
    canvas.line(18 * mm, height - 15 * mm, width - 18 * mm, height - 15 * mm)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.setFillColor(RED)
    canvas.drawString(18 * mm, height - 11.5 * mm, "WYZE / PI 30 FPS RESEARCH")
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(width - 18 * mm, 10 * mm, f"8 September 2026  |  Page {doc.page}")
    canvas.restoreState()


def build_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=25,
            leading=29,
            textColor=INK,
            spaceAfter=8 * mm,
            alignment=TA_CENTER,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=18,
            textColor=INK,
            spaceBefore=6 * mm,
            spaceAfter=2.5 * mm,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "H3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=11.5,
            leading=14,
            textColor=RED,
            spaceBefore=4 * mm,
            spaceAfter=1.5 * mm,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.2,
            leading=13.2,
            textColor=INK,
            spaceAfter=2.4 * mm,
        ),
        "meta": ParagraphStyle(
            "Meta",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceAfter=1.2 * mm,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.2,
            leading=13,
            leftIndent=6 * mm,
            firstLineIndent=-3 * mm,
            bulletIndent=2 * mm,
            textColor=INK,
            spaceAfter=1.2 * mm,
        ),
        "code": ParagraphStyle(
            "Code",
            fontName="Courier",
            fontSize=7.2,
            leading=9.2,
            leftIndent=4 * mm,
            rightIndent=4 * mm,
            textColor=colors.HexColor("#26313B"),
            backColor=PALE,
            borderColor=GRID,
            borderWidth=0.5,
            borderPadding=7,
            spaceBefore=2 * mm,
            spaceAfter=3 * mm,
        ),
        "table": ParagraphStyle(
            "TableCell",
            fontName="Helvetica",
            fontSize=7.1,
            leading=8.7,
            textColor=INK,
        ),
        "table_header": ParagraphStyle(
            "TableHeader",
            fontName="Helvetica-Bold",
            fontSize=7.2,
            leading=8.8,
            textColor=colors.white,
        ),
    }


def table_flowable(rows, styles):
    cleaned = []
    for row_index, row in enumerate(rows):
        style = styles["table_header"] if row_index == 0 else styles["table"]
        cleaned.append([Paragraph(inline_markup(cell.strip()), style) for cell in row])
    columns = len(cleaned[0])
    available = A4[0] - 36 * mm
    if columns == 6:
        widths = [25, 34, 43, 32, 31, 38]
        scale = available / sum(widths)
        widths = [x * scale for x in widths]
    else:
        widths = [available / columns] * columns
    table = Table(cleaned, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#273746")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
    ]))
    return table


def parse_markdown(text: str, styles):
    lines = text.splitlines()
    story = []
    index = 0
    first_heading = True
    while index < len(lines):
        raw = lines[index]
        stripped = raw.strip()
        if not stripped:
            index += 1
            continue
        if stripped.startswith("```"):
            code = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code.append(lines[index])
                index += 1
            index += 1
            story.append(KeepTogether([Preformatted("\n".join(code), styles["code"])]))
            continue
        if stripped.startswith("|") and index + 1 < len(lines) and lines[index + 1].strip().startswith("|---"):
            table_lines = [stripped]
            index += 2
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_lines.append(lines[index].strip())
                index += 1
            rows = [[cell for cell in line.strip("|").split("|")] for line in table_lines]
            story.append(table_flowable(rows, styles))
            story.append(Spacer(1, 3 * mm))
            continue
        if stripped.startswith("# "):
            if not first_heading:
                story.append(PageBreak())
            story.append(Spacer(1, 17 * mm))
            story.append(Paragraph(inline_markup(stripped[2:]), styles["title"]))
            first_heading = False
            index += 1
            continue
        if stripped.startswith("## "):
            if stripped[3:] == "MVLS-30 architecture":
                story.append(PageBreak())
            story.append(Paragraph(inline_markup(stripped[3:]), styles["h2"]))
            index += 1
            continue
        if stripped.startswith("### "):
            story.append(Paragraph(inline_markup(stripped[4:]), styles["h3"]))
            index += 1
            continue
        if stripped.startswith("**") and ":**" in stripped:
            story.append(Paragraph(inline_markup(stripped), styles["meta"]))
            index += 1
            continue
        if re.match(r"^[-*] ", stripped):
            story.append(Paragraph(inline_markup(stripped[2:]), styles["bullet"], bulletText="-"))
            index += 1
            continue
        numbered = re.match(r"^(\d+)\.\s+(.*)", stripped)
        if numbered:
            story.append(Paragraph(inline_markup(numbered.group(2)), styles["bullet"], bulletText=numbered.group(1) + "."))
            index += 1
            continue

        paragraph = [stripped]
        index += 1
        while index < len(lines):
            candidate = lines[index].strip()
            if not candidate or candidate.startswith(("#", "- ", "* ", "```", "|")) or re.match(r"^\d+\.\s+", candidate):
                break
            paragraph.append(candidate)
            index += 1
        story.append(Paragraph(inline_markup(" ".join(paragraph)), styles["body"]))
    return story


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = build_styles()
    document = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=20 * mm,
        bottomMargin=17 * mm,
        title="Wyze Cam v4 on Raspberry Pi - Full-Resolution 30 FPS Research",
        author="Wyze Monitor Engineering Research",
        subject="Measured 30 fps feasibility and MVLS-30 architecture",
    )
    story = parse_markdown(SOURCE.read_text(encoding="utf-8"), styles)
    document.build(story, onFirstPage=page_chrome, onLaterPages=page_chrome)
    print(OUTPUT)


if __name__ == "__main__":
    main()

