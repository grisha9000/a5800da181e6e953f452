"""Build the book text snapshot from the public Google Doc DOCX export.

The original Word file remains the source for the existing illustrations.
"""

import json
import sys
import xml.etree.ElementTree as ET
import zipfile


SOURCE = "https://docs.google.com/document/d/1rfjYaZ-OtbNZ0tjB7AoF4Av-HtXZpN1fpoJ8P3YnYfU/edit"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"


def image_paths(archive):
    with zipfile.ZipFile(archive) as source:
        relationships = {
            item.get("Id"): item.get("Target")
            for item in ET.fromstring(source.read("word/_rels/document.xml.rels"))
        }
        document = ET.fromstring(source.read("word/document.xml"))
    paths = []
    for drawing in document.iter(W + "drawing"):
        blip = drawing.find(".//" + A + "blip")
        if blip is not None:
            target = relationships.get(blip.get(R + "embed"))
            if target and ".." not in target:
                paths.append("word/" + target)
    return paths


def clean_runs(runs):
    while runs and not runs[0]["text"].strip():
        runs.pop(0)
    while runs and not runs[-1]["text"].strip():
        runs.pop()
    if runs:
        runs[0]["text"] = runs[0]["text"].lstrip()
        runs[-1]["text"] = runs[-1]["text"].rstrip()
    return [run for run in runs if run["text"]]


def read_doc(export, paths):
    with zipfile.ZipFile(export) as source:
        document = ET.fromstring(source.read("word/document.xml"))
        styles = ET.fromstring(source.read("word/styles.xml"))
    headings = {
        style.get(W + "styleId")
        for style in styles.iter(W + "style")
        if (style.find(W + "name") is not None
            and style.find(W + "name").get(W + "val", "").lower() in {"heading 1", "heading1"})
    }
    body = document.find(".//" + W + "body")
    blocks = []
    cover = []
    started = False
    previous_verse = False
    image_index = 0

    for index, paragraph in enumerate(body.findall(W + "p")):
        properties = paragraph.find(W + "pPr")
        style = properties.find(W + "pStyle") if properties is not None else None
        style_id = style.get(W + "val", "") if style is not None else ""
        heading = style_id in headings or style_id.lower() in {"heading1", "heading 1"}
        indent = properties.find(W + "ind") if properties is not None else None
        verse = indent is not None and int(indent.get(W + "left", "0")) > 0
        full_text = "".join(node.text or "" for node in paragraph.iter(W + "t")).strip()
        has_image = paragraph.find(".//" + W + "drawing") is not None

        if not started and heading and len(cover) < 2:
            cover.append(full_text)
            continue
        if not started:
            if not full_text:
                continue
            started = True
        if not full_text and not has_image:
            if previous_verse and blocks and blocks[-1]["kind"] != "space":
                blocks.append({"kind": "space", "id": f"p-{index}"})
            continue

        runs = []
        part = 0

        def flush():
            nonlocal part
            cleaned = clean_runs(runs)
            runs.clear()
            text = "".join(run["text"] for run in cleaned)
            if not text:
                return
            block = {"kind": "heading" if heading else "paragraph", "id": f"p-{index}-{part}", "text": text}
            part += 1
            if not heading:
                block.update(runs=cleaned, verse=verse, separator=text == "***")
            blocks.append(block)

        for run in paragraph.iter(W + "r"):
            run_style = run.find(W + "rPr")
            italic_element = run_style.find(W + "i") if run_style is not None else None
            italic = italic_element is not None and italic_element.get(W + "val", "1") not in {"false", "0"}
            for item in run:
                if item.tag == W + "t":
                    runs.append({"text": item.text or "", "italic": italic})
                elif item.tag == W + "tab":
                    runs.append({"text": "\t", "italic": italic})
                elif item.tag == W + "br":
                    if item.get(W + "type") != "page":
                        runs.append({"text": "\n", "italic": italic})
                elif item.tag == W + "drawing":
                    flush()
                    if image_index >= len(paths):
                        raise ValueError("In Google Doc there are more images than in the original archive")
                    extent = item.find(".//" + WP + "extent")
                    if extent is None:
                        raise ValueError("An illustration has no dimensions")
                    blocks.append({
                        "kind": "image", "id": f"p-{index}-{part}",
                        "path": paths[image_index],
                        "width": int(extent.get("cx")), "height": int(extent.get("cy")),
                    })
                    image_index += 1
                    part += 1
        flush()
        previous_verse = verse

    while blocks and blocks[-1]["kind"] == "space":
        blocks.pop()
    if len(cover) != 2 or not blocks or blocks[0]["kind"] != "heading":
        raise ValueError("Could not identify the title and first chapter heading")
    if image_index != len(paths):
        raise ValueError(f"Expected {len(paths)} illustrations; Google Doc has {image_index}")
    return {
        "sourceUrl": SOURCE,
        "title": " ".join(cover).strip(),
        "blocks": blocks,
        "marginalia": [],
    }


if __name__ == "__main__":
    export, archive, output = sys.argv[1:]
    model = read_doc(export, image_paths(archive))
    with open(output, "w", encoding="utf-8") as target:
        json.dump(model, target, ensure_ascii=False, separators=(",", ":"))
        target.write("\n")
