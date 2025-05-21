
import fitz  # PyMuPDF
import json
import re
import os


def clean_text(text_lines):

    cleaned_lines = []
    for line in text_lines:

        if re.match(r"^\s*strana \d+\s*$", line, re.IGNORECASE) or \
                re.match(r"^\s*\d+\s*$", line) and len(cleaned_lines) % 50 == 0:
            continue
        if "sbírka zákonů" in line.lower() and "ročník" in line.lower():
            continue
        if "© Ministerstvo vnitra" in line:
            continue
        cleaned_lines.append(line.strip())
    return [line for line in cleaned_lines if line]


def extract_metadata(text_content_lines):

    metadata = {
        "law_id": "UNKNOWN",
        "title": "UNKNOWN",
        "effective_date": "UNKNOWN",
        "publication_date": "UNKNOWN",
        "enforcing_agency": "UNKNOWN",
        "references": [],
        "source_file": ""
    }


    for i, line in enumerate(text_content_lines):
        match_id = re.search(r"(\d+/\d{4})\s+Sb\.", line)
        if match_id:
            metadata["law_id"] = match_id.group(1) + " Sb."
            if i + 1 < len(text_content_lines) and not text_content_lines[i + 1].startswith("§"):
                title_candidate_line = ""
                for j in range(i + 1, min(i + 5, len(text_content_lines))):
                    current_line_lower = text_content_lines[j].lower()
                    if text_content_lines[j].startswith("§") or "ČÁST" in text_content_lines[j] or "HLAVA" in \
                            text_content_lines[j]:
                        break
                    if "o " in current_line_lower or "kterým se mění" in current_line_lower or "ze dne" in current_line_lower:
                        title_candidate_line += text_content_lines[j] + " "
                    elif title_candidate_line:
                        title_candidate_line += text_content_lines[j] + " "

                if title_candidate_line:

                    title_candidate_line = re.sub(r"^\s*ze dne\s+\d+\.\s+\w+\s+\d{4}\s*", "",
                                                  title_candidate_line.strip(), flags=re.IGNORECASE)

                    title_candidate_line = re.sub(r"^(ZÁKON|VYHLÁŠKA|NAŘÍZENÍ VLÁDY)\s*", "", title_candidate_line,
                                                  flags=re.IGNORECASE).strip()
                    metadata["title"] = title_candidate_line.strip()

            date_match = re.search(r"ze dne (\d{1,2}\. \w+ \d{4})", " ".join(text_content_lines[:10]),
                                   re.IGNORECASE)
            if date_match:
                metadata["publication_date"] = date_match.group(1)
            break


    for line in reversed(text_content_lines):
        effective_date_match = re.search(r"nabývá účinnosti dnem\s+(.*)", line, re.IGNORECASE)
        if effective_date_match:
            metadata["effective_date"] = effective_date_match.group(1).strip().rstrip('.')
            break

    for line in text_content_lines:
        references = re.findall(r"(zákon(?:a|u|ě)? č\.\s*\d+/\d{4}\s*Sb\.)", line, re.IGNORECASE)
        for ref in references:
            if ref not in metadata["references"]:
                metadata["references"].append(ref)

        complex_refs = re.findall(
            r"(§\s*\d+[a-z]?\s*(?:odst\.\s*\d+)?\s*(?:písm\.\s*[a-z]\))?\s*zákona č\.\s*\d+/\d{4}\s*Sb\.)", line,
            re.IGNORECASE)
        for ref in complex_refs:
            if ref not in metadata["references"]:
                metadata["references"].append(ref)

    return metadata


def structure_text_content(text_lines):
    structured_content = []
    current_part = None
    current_head = None
    current_paragraph_number = None
    current_paragraph_text = []
    current_subsection_level1_number = None
    current_subsection_level1_text = []
    current_subsection_level2_letter = None
    current_subsection_level2_text = []


    part_re = re.compile(r"^\s*ČÁST\s+([A-Z]+|[IVXLCDM]+)", re.IGNORECASE)
    head_re = re.compile(r"^\s*HLAVA\s+([IVXLCDM]+)", re.IGNORECASE)
    paragraph_re = re.compile(r"^\s*§\s*(\d+[a-z]?)")  # Matches §1, §1a, etc.
    subsection_l1_re = re.compile(r"^\s*\((\d+)\)")  # Matches (1), (2) etc.
    subsection_l2_re = re.compile(r"^\s*([a-z])\)")  # Matches a), b) etc.

    def store_previous_item():
        nonlocal current_paragraph_text, current_subsection_level1_text, current_subsection_level2_text
        nonlocal current_paragraph_number, current_subsection_level1_number, current_subsection_level2_letter

        if current_subsection_level2_text:
            if not current_subsection_level1_text:
                current_paragraph_text.append({
                    "type": "subsection_level2",
                    "identifier": current_subsection_level2_letter,
                    "text": " ".join(current_subsection_level2_text).strip()
                })
            else:
                current_subsection_level1_text.append({
                    "type": "subsection_level2",
                    "identifier": current_subsection_level2_letter,
                    "text": " ".join(current_subsection_level2_text).strip()
                })
            current_subsection_level2_text = []
            current_subsection_level2_letter = None

        if current_subsection_level1_text:
            current_paragraph_text.append({
                "type": "subsection_level1",
                "identifier": current_subsection_level1_number,
                "content": current_subsection_level1_text if isinstance(current_subsection_level1_text, list) else [
                    current_subsection_level1_text]
            })
            current_subsection_level1_text = []
            current_subsection_level1_number = None

        if current_paragraph_text and current_paragraph_number:
            main_text_lines = [item for item in current_paragraph_text if isinstance(item, str)]
            sub_items = [item for item in current_paragraph_text if isinstance(item, dict)]

            para_obj = {
                "type": "paragraph",
                "identifier": f"§ {current_paragraph_number}",
                "text": " ".join(main_text_lines).strip()
            }
            if sub_items:
                para_obj["subsections"] = sub_items

            if current_head:
                current_head["paragraphs"].append(para_obj)
            elif current_part:
                current_part["paragraphs"].append(para_obj)
            else:
                structured_content.append(para_obj)
            current_paragraph_text = []
            current_paragraph_number = None

    for line_idx, line_text in enumerate(text_lines):
        line_text_stripped = line_text.strip()
        if not line_text_stripped:
            continue

        part_match = part_re.match(line_text_stripped)
        head_match = head_re.match(line_text_stripped)
        paragraph_match = paragraph_re.match(line_text_stripped)
        subsection_l1_match = subsection_l1_re.match(line_text_stripped)
        subsection_l2_match = subsection_l2_re.match(line_text_stripped)

        if part_match:
            store_previous_item()
            if current_head:
                if current_part:
                    current_part["heads"].append(current_head)
                else:
                    structured_content.append(current_head)
                current_head = None
            if current_part:
                structured_content.append(current_part)

            part_id = part_match.group(1)
            part_title = text_lines[line_idx + 1].strip() if line_idx + 1 < len(text_lines) else ""
            if line_idx + 2 < len(text_lines) and not (
                    paragraph_re.match(text_lines[line_idx + 2].strip()) or head_re.match(
                    text_lines[line_idx + 2].strip()) or part_re.match(text_lines[line_idx + 2].strip())):
                part_title += " " + text_lines[line_idx + 2].strip()

            current_part = {
                "type": "part",
                "identifier": f"ČÁST {part_id}",
                "title": part_title,
                "heads": [],
                "paragraphs": []
            }
            continue

        if head_match:
            store_previous_item()
            if current_head:
                if current_part:
                    current_part["heads"].append(current_head)
                else:
                    structured_content.append(current_head)

            head_id = head_match.group(1)
            head_title = text_lines[line_idx + 1].strip() if line_idx + 1 < len(text_lines) else ""
            if line_idx + 2 < len(text_lines) and not (
                    paragraph_re.match(text_lines[line_idx + 2].strip()) or head_re.match(
                    text_lines[line_idx + 2].strip()) or part_re.match(text_lines[line_idx + 2].strip())):
                head_title += " " + text_lines[line_idx + 2].strip()

            current_head = {
                "type": "head",
                "identifier": f"HLAVA {head_id}",
                "title": head_title,
                "paragraphs": []
            }
            continue

        if paragraph_match:
            store_previous_item()
            current_paragraph_number = paragraph_match.group(1)
            text_after_identifier = line_text_stripped[len(paragraph_match.group(0)):].strip()
            if text_after_identifier:
                current_paragraph_text.append(text_after_identifier)
            if line_idx + 1 < len(text_lines):
                next_line_stripped = text_lines[line_idx + 1].strip()
                if not (paragraph_re.match(next_line_stripped) or \
                        subsection_l1_re.match(next_line_stripped) or \
                        subsection_l2_re.match(next_line_stripped) or \
                        part_re.match(next_line_stripped) or \
                        head_re.match(next_line_stripped) or \
                        next_line_stripped.lower().startswith("§") or \
                        next_line_stripped.lower().startswith("(") or \
                        next_line_stripped.lower().startswith("čl.") or \
                        len(next_line_stripped.split()) > 10
                ):
                    if current_paragraph_text and isinstance(current_paragraph_text[-1],
                                                             str):
                        current_paragraph_text[-1] += " " + next_line_stripped
                    else:
                        current_paragraph_text.append(next_line_stripped)
            continue

        if subsection_l1_match:

            if current_subsection_level2_text:
                if not current_subsection_level1_text:
                    current_paragraph_text.append({
                        "type": "subsection_level2",
                        "identifier": current_subsection_level2_letter,
                        "text": " ".join(current_subsection_level2_text).strip()
                    })
                else:
                    current_subsection_level1_text.append({
                        "type": "subsection_level2",
                        "identifier": current_subsection_level2_letter,
                        "text": " ".join(current_subsection_level2_text).strip()
                    })
                current_subsection_level2_text = []
                current_subsection_level2_letter = None

            if current_subsection_level1_text:
                current_paragraph_text.append({
                    "type": "subsection_level1",
                    "identifier": current_subsection_level1_number,
                    "content": current_subsection_level1_text if isinstance(current_subsection_level1_text, list) else [
                        current_subsection_level1_text]
                })

            current_subsection_level1_number = subsection_l1_match.group(1)
            current_subsection_level1_text = []
            text_after_identifier = line_text_stripped[len(subsection_l1_match.group(0)):].strip()
            if text_after_identifier:
                current_subsection_level1_text.append(text_after_identifier)
            continue

        if subsection_l2_match:

            if current_subsection_level2_text:
                item_to_append_to = current_subsection_level1_text if current_subsection_level1_number else current_paragraph_text
                item_to_append_to.append({
                    "type": "subsection_level2",
                    "identifier": current_subsection_level2_letter,
                    "text": " ".join(current_subsection_level2_text).strip()
                })

            current_subsection_level2_letter = subsection_l2_match.group(1)
            current_subsection_level2_text = []
            text_after_identifier = line_text_stripped[len(subsection_l2_match.group(0)):].strip()
            if text_after_identifier:
                current_subsection_level2_text.append(text_after_identifier)
            continue

        if current_subsection_level2_letter:
            current_subsection_level2_text.append(line_text_stripped)
        elif current_subsection_level1_number:
            current_subsection_level1_text.append(line_text_stripped)
        elif current_paragraph_number:
            current_paragraph_text.append(line_text_stripped)

    store_previous_item()
    if current_head:
        if current_part:
            current_part["heads"].append(current_head)
        else:
            structured_content.append(current_head)
    if current_part:
        structured_content.append(current_part)


    for item in structured_content:
        if item.get("type") == "paragraph" and "subsections" in item:
            for sub_item in item["subsections"]:
                if sub_item.get("type") == "subsection_level1" and isinstance(sub_item.get("content"), list):

                    new_content = []
                    current_text_segment = []
                    for content_part in sub_item["content"]:
                        if isinstance(content_part, str):
                            current_text_segment.append(content_part)
                        else:
                            if current_text_segment:
                                new_content.append(" ".join(current_text_segment).strip())
                                current_text_segment = []
                            new_content.append(content_part)
                    if current_text_segment:
                        new_content.append(" ".join(current_text_segment).strip())
                    sub_item["content"] = new_content[0] if len(new_content) == 1 and isinstance(new_content[0],
                                                                                                 str) else new_content



    return structured_content


def pdf_to_structured_json(pdf_path, json_path):

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"Error opening PDF {pdf_path}: {e}")
        return

    all_text_lines = []
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        text = page.get_text("text")
        all_text_lines.extend(text.split('\n'))


    all_text_lines = [line for line in all_text_lines if not re.match(r"^-+ PAGE \d+ -+$", line)]


    cleaned_lines = []
    for line in all_text_lines:
        stripped_line = line.strip()
        if re.fullmatch(r"strana \d+", stripped_line, re.IGNORECASE):
            continue
        if re.fullmatch(r"\d+", stripped_line) and (len(cleaned_lines) > 0 and len(cleaned_lines[-1]) > 60 or len(
                cleaned_lines) == 0):
            pass


        if page_num > 0 and stripped_line == doc[0].get_text("blocks")[0][4].split('\n')[
            0].strip():

            pass

        cleaned_lines.append(stripped_line)

    cleaned_lines = [line for line in cleaned_lines if line]

    metadata = extract_metadata(cleaned_lines)
    metadata["source_file"] = os.path.basename(pdf_path)


    structured_law_text = structure_text_content(cleaned_lines)

    output_data = {
        "metadata": metadata,
        "text_content": cleaned_lines,
        "structured_text": structured_law_text
    }

    try:
        with open(json_path, 'w', encoding='utf-8') as jf:
            json.dump(output_data, jf, ensure_ascii=False, indent=4)
        print(f"Successfully converted {pdf_path} to {json_path}")
    except Exception as e:
        print(f"Error writing JSON to {json_path}: {e}")


if __name__ == "__main__":
    input_directory = "e-sbirka_data"
    output_directory = "output"

    if not os.path.exists(output_directory):
        os.makedirs(output_directory)
        print(f"Created output directory: '{output_directory}'")


    if not os.path.exists(input_directory) or not os.path.isdir(input_directory):
        print(f"Error: Input directory '{input_directory}' not found or is not a directory.")
        print("Please ensure the directory exists and contains PDF files.")
    else:
        print(f"Scanning for PDF files in '{input_directory}'...")
        found_pdf_files = False
        for filename in os.listdir(input_directory):
            if filename.lower().endswith(".pdf"):
                found_pdf_files = True
                input_pdf_path = os.path.join(input_directory, filename)


                output_json_filename = os.path.splitext(filename)[0] + ".json"
                output_json_path = os.path.join(output_directory, output_json_filename)

                print(f"Processing '{input_pdf_path}'...")
                try:

                    pdf_to_structured_json(input_pdf_path, output_json_path)
                    print(f"Successfully processed '{input_pdf_path}' to '{output_json_path}'")
                except Exception as e:
                    print(f"Error processing file '{input_pdf_path}': {e}")

        if not found_pdf_files:
            print(f"No PDF files found in '{input_directory}'.")

    print("Script finished.")