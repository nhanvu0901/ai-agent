# import fitz  # PyMuPDF
# import json
# import os
# import re
#
# def extract_text_from_pdf(pdf_path):
#     """
#     Extracts text content from a PDF file page by page.
#
#     Args:
#         pdf_path (str): The path to the PDF file.
#
#     Returns:
#         str or None: The concatenated text content of the PDF, or None if an error occurs.
#     """
#     text = ""
#     try:
#         doc = fitz.open(pdf_path)
#         for page_num in range(doc.page_count):
#             page = doc.load_page(page_num)
#             text += page.get_text()
#         doc.close()
#     except Exception as e:
#         print(f"Error extracting text from {pdf_path}: {e}")
#         return None
#     return text
#
# def clean_text(text):
#     """
#     Cleans the extracted text by removing common noise like page numbers,
#     headers, and footers based on observed patterns in eSbírka PDFs.
#
#     Args:
#         text (str): The raw text extracted from the PDF.
#
#     Returns:
#         str: The cleaned text.
#     """
#     # Remove page numbers like "strana X"
#     cleaned_text = re.sub(r'strana \d+\n', '', text)
#     # Remove potential headers/footers (adjust regex based on common patterns)
#     # This is a basic example, may need refinement for other PDFs
#     cleaned_text = re.sub(r'^\s*\d+\s*\n', '', cleaned_text, flags=re.MULTILINE) # Remove standalone numbers at line start
#     # Remove multiple empty lines
#     cleaned_text = re.sub(r'\n\s*\n', '\n\n', cleaned_text)
#     return cleaned_text
#
# def extract_metadata(text):
#     """
#     Extracts key metadata from the beginning of the legal text.
#
#     Args:
#         text (str): The cleaned text of the law.
#
#     Returns:
#         dict: A dictionary containing extracted metadata.
#     """
#     metadata = {
#         "law_id": None,
#         "title": None,
#         "promulgation_date": None,
#         "effective_date": None, # This is harder to get reliably from just the text, often in later amendments or separate documents
#         "agency": None
#     }
#
#     # Look for Law ID and Title (usually near the beginning)
#     # Example: 455\n\nZÁKON\n\nze dne 2. října 1991\n\no živnostenském podnikání (živnostenský zákon)
#     # This regex looks for a number, followed by ZÁKON, date, and then the title in parentheses after 'o'
#     id_title_match = re.search(r'(\d+)\s*\n\s*ZÁKON\s*\n\s*ze dne\s*(\d+\.\s*\S+\s*\d+)\s*\n\s*o\s*(.+?)\s*\(', text, re.DOTALL)
#     if id_title_match:
#         # Construct law_id in the format XXX/YYYY
#         year = id_title_match.group(2).split('.')[-1].strip()
#         metadata["law_id"] = f"{id_title_match.group(1)}/{year}"
#         metadata["promulgation_date"] = id_title_match.group(2).strip() # e.g., 2. října 1991
#         metadata["title"] = id_title_match.group(3).strip() # e.g., živnostenském podnikání
#
#     # Look for the enacting agency (usually after the title and before the first section)
#     # This regex looks for text after a closing parenthesis ')' and before 'se usneslo na\s*tomto zákoně:'
#     agency_match = re.search(r'\)(.+?)se usneslo na\s*tomto zákoně:', text, re.DOTALL)
#     if agency_match:
#         metadata["agency"] = agency_match.group(1).strip()
#
#     # Note: Extracting the *current* effective date from the original law text
#     # is often not possible as it's typically introduced by later amendments.
#     # This script focuses on the original promulgation details.
#
#     return metadata
#
# def extract_references(text):
#     """
#     Finds references to other laws or sections within the text.
#     This is a basic implementation and might need refinement based on actual reference patterns.
#
#     Args:
#         text (str): The cleaned text of the law.
#
#     Returns:
#         list: A list of dictionaries, each representing a found reference.
#     """
#     references = []
#     # Basic pattern for § X of Act No. YYY or similar Czech phrasing
#     # This regex is simplified and might need adjustment for variations
#     # It looks for '§' followed by numbers, optional paragraph/subsection indicators,
#     # and then 'zákona č.' followed by non-whitespace characters.
#     ref_pattern = re.compile(r'(§\s*\d+\s*(?:odst\.\s*\d+)?\s*(?:písm\.\s*[a-z])?\s*zákona č\.\s*\S+)')
#
#     for match in ref_pattern.finditer(text):
#         references.append({
#             "text": match.group(0),
#             "start_pos": match.start(),
#             "end_pos": match.end(),
#             # More advanced parsing could try to identify the specific section/paragraph
#             # containing this reference, but that adds significant complexity.
#             # For Neo4j, storing the text and position might be sufficient to link later.
#         })
#     return references
#
# def parse_legal_structure(text):
#     """
#     Parses the cleaned text to identify and structure legal elements
#     (ČÁST, HLAVA, §, Paragraphs, Subsections).
#
#     Args:
#         text (str): The cleaned text of the law.
#
#     Returns:
#         list: A hierarchical list of dictionaries representing the law's structure.
#     """
#     structure = []
#     current_part = None
#     current_head = None
#     current_section = None
#     current_paragraph = None
#     current_subsection = None
#
#     # Split text into potential blocks based on major headings (ČÁST, HLAVA, §)
#     # This split regex captures the heading line and the content following it.
#     blocks = re.split(r'(ČÁST\s+[IVXLCDM]+\s*\n.*?\n|HLAVA\s+[IVXLCDM]+\s*\n.*?\n|§\s*\d+\s*\n)', text)
#
#     # The first block is usually introductory text before the first major heading
#     intro_text = blocks[0].strip()
#     if intro_text:
#          structure.append({"type": "INTRO", "content": intro_text.split('\n')})
#
#     # Process the rest of the blocks, which alternate between headings and content
#     i = 1
#     while i < len(blocks):
#         heading = blocks[i].strip()
#         content = blocks[i+1].strip() if i+1 < len(blocks) else ""
#
#         if heading.startswith("ČÁST"):
#             # Parse ČÁST (Part) heading
#             part_match = re.match(r'ČÁST\s+([IVXLCDM]+)\s*\n(.*)', heading, re.DOTALL)
#             part_number = part_match.group(1) if part_match else "Unknown"
#             part_title = part_match.group(2).strip() if part_match else "Unknown"
#             current_part = {"type": "ČÁST", "number": part_number, "title": part_title, "content": [], "children": []}
#             structure.append(current_part)
#             # Reset lower levels when a new part starts
#             current_head = None
#             current_section = None
#             current_paragraph = None
#             current_subsection = None
#
#         elif heading.startswith("HLAVA"):
#             # Parse HLAVA (Chapter/Head) heading
#             head_match = re.match(r'HLAVA\s+([IVXLCDM]+)\s*\n(.*)', heading, re.DOTALL)
#             head_number = head_match.group(1) if head_match else "Unknown"
#             head_title = head_match.group(2).strip() if head_match else "Unknown"
#             current_head = {"type": "HLAVA", "number": head_number, "title": head_title, "content": [], "children": []}
#             # Add to the current part if one exists, otherwise add to the main structure
#             if current_part:
#                 current_part["children"].append(current_head)
#             else:
#                 structure.append(current_head)
#             # Reset lower levels when a new head starts
#             current_section = None
#             current_paragraph = None
#             current_subsection = None
#
#         elif heading.startswith("§"):
#             # Parse § (Section) heading
#             section_match = re.match(r'§\s*(\d+)', heading)
#             section_number = section_match.group(1) if section_match else "Unknown"
#             # Section title might be on the same line or the next, or absent.
#             # For simplicity here, we assume it's captured in the content block if present right after §.
#             current_section = {"type": "SECTION", "number": section_number, "title": None, "content": [], "children": []}
#             # Add to the current head or part if they exist, otherwise add to the main structure
#             if current_head:
#                 current_head["children"].append(current_section)
#             elif current_part:
#                  current_part["children"].append(current_section)
#             else:
#                 structure.append(current_section)
#             # Reset lower levels when a new section starts
#             current_paragraph = None
#             current_subsection = None
#
#             # Process the content block associated with the section
#             lines = content.split('\n')
#             for line in lines:
#                 line = line.strip()
#                 if not line:
#                     continue
#
#                 # Check for paragraph (number)
#                 paragraph_match = re.match(r'\((\d+)\)(.*)', line)
#                 # Check for subsection letter)
#                 subsection_match = re.match(r'([a-z])\)(.*)', line)
#
#                 if paragraph_match:
#                     # Found a new paragraph
#                     para_number = paragraph_match.group(1)
#                     para_text = paragraph_match.group(2).strip()
#                     current_paragraph = {"type": "PARAGRAPH", "number": para_number, "text": para_text, "children": []}
#                     # Add to the current section
#                     if current_section:
#                          current_section["children"].append(current_paragraph)
#                     # Reset subsection as we are starting a new paragraph
#                     current_subsection = None
#                 elif subsection_match:
#                     # Found a new subsection
#                     sub_number = subsection_match.group(1)
#                     sub_text = subsection_match.group(2).strip()
#                     current_subsection = {"type": "SUBSECTION", "number": sub_number, "text": sub_text}
#                     # Add to the current paragraph if one exists, otherwise add directly to the section
#                     if current_paragraph:
#                         current_paragraph["children"].append(current_subsection)
#                     elif current_section:
#                          # Sometimes subsections appear directly under a section without a paragraph (1)
#                          current_section["children"].append(current_subsection)
#                     # No reset needed for lower levels as subsection is the lowest
#                 elif current_subsection:
#                     # Append text to the current subsection if the line continues its content
#                     current_subsection["text"] += " " + line
#                 elif current_paragraph:
#                     # Append text to the current paragraph if the line continues its content
#                     current_paragraph["text"] += " " + line
#                 elif current_section:
#                     # Append text to the current section if it appears before the first paragraph/subsection
#                      current_section["content"].append(line)
#                 else:
#                     # Text that doesn't belong to any identified element (should be rare after splitting)
#                     # Could potentially add to the content of the current_section or parent if needed
#                     pass
#
#
#         else:
#              # This block should ideally not be reached if major headings cover everything
#              # Any content here might be text between major blocks not matched by split regex
#              pass # Ignore or handle as needed
#
#         i += 2 # Move to the next heading block (skipping the content block)
#
#     # Post-processing: Clean up empty content lists/children lists if needed
#     # This structure is designed to be Neo4j friendly with nested relationships
#
#     return structure
#
# def extract_footnotes(text):
#     """
#     Extracts footnotes, assuming they are at the end of the document
#     and follow a pattern like 'number) text'.
#
#     Args:
#         text (str): The raw text extracted from the PDF.
#
#     Returns:
#         list: A list of dictionaries, each representing a footnote.
#     """
#     footnotes = []
#     # Regex to find lines starting with number) or numberletter) followed by text
#     # Assumes footnotes are grouped at the end
#     # It looks for a line starting with one or more digits, optionally followed by a letter,
#     # then a closing parenthesis, and then captures the rest of the line.
#     footnote_pattern = re.compile(r'^(\d+[a-z]?)\)(.*)$', re.MULTILINE)
#
#     # Find a likely start of the footnotes section (e.g., after the main law text ends)
#     # This is heuristic and might need adjustment. Looking for patterns like "Příloha č. X"
#     # or a significant block of text matching the footnote pattern.
#     # For this example, let's just search the whole text and filter later if needed.
#
#     for match in footnote_pattern.finditer(text):
#         footnotes.append({
#             "number": match.group(1).strip(),
#             "text": match.group(2).strip()
#         })
#
#     # Basic filtering: remove potential false positives (e.g., list items that look like footnotes)
#     # This requires domain knowledge or more complex analysis. For now, we'll include all matches.
#
#     return footnotes
#
#
# def process_law_pdf(pdf_path):
#     """
#     Processes a single law PDF to extract structured data.
#
#     Args:
#         pdf_path (str): The path to the PDF file.
#
#     Returns:
#         dict or None: A dictionary containing the structured law data, or None if processing fails.
#     """
#     print(f"Processing {pdf_path}...")
#     raw_text = extract_text_from_pdf(pdf_path)
#     if raw_text is None:
#         return None # Return None if text extraction failed
#
#     cleaned_text = clean_text(raw_text)
#
#     metadata = extract_metadata(cleaned_text)
#     references = extract_references(cleaned_text)
#     structure = parse_legal_structure(cleaned_text)
#     # Extract footnotes from raw text before cleaning, as cleaning might remove footnote markers
#     footnotes = extract_footnotes(raw_text)
#
#     # Combine all extracted data
#     law_data = {
#         "metadata": metadata,
#         "structure": structure,
#         "references": references,
#         "footnotes": footnotes,
#         "original_text": cleaned_text # Optionally keep the cleaned text
#     }
#
#     print(f"Finished processing {pdf_path}.")
#     return law_data
#
# def save_to_json(data, output_dir, filename):
#     """
#     Saves the extracted data to a JSON file.
#
#     Args:
#         data (dict): The data to save.
#         output_dir (str): The directory to save the JSON file.
#         filename (str): The name of the output JSON file (without extension).
#     """
#     if not os.path.exists(output_dir):
#         os.makedirs(output_dir)
#
#     output_path = os.path.join(output_dir, f"{filename}.json")
#     try:
#         with open(output_path, 'w', encoding='utf-8') as f:
#             json.dump(data, f, ensure_ascii=False, indent=4)
#         print(f"Saved data to {output_path}")
#     except Exception as e:
#         print(f"Error saving data to {output_path}: {e}")
#
# # --- Main Script ---
# if __name__ == "__main__":
#     pdf_directory = "e-sbirka_data" # Assuming this is the folder name
#     output_directory = "structured_legal_data"
#
#     # Process all PDFs in the specified directory
#     if not os.path.isdir(pdf_directory):
#         print(f"Error: Directory '{pdf_directory}' not found.")
#     else:
#         pdf_files = [f for f in os.listdir(pdf_directory) if f.endswith(".pdf")]
#         if not pdf_files:
#             print(f"No PDF files found in '{pdf_directory}'.")
#         else:
#             print(f"Found {len(pdf_files)} PDF files in '{pdf_directory}'.")
#             for pdf_file in pdf_files:
#                 pdf_path = os.path.join(pdf_directory, pdf_file)
#                 law_data = process_law_pdf(pdf_path)
#
#                 # Check if processing was successful before saving
#                 if law_data:
#                     # Determine filename: prefer extracted law_id, fallback to original filename base
#                     # Ensure the value is treated as a string before calling replace
#                     law_id = law_data["metadata"].get("law_id")
#                     if law_id:
#                         filename = str(law_id).replace('/', '_').replace(' ', '_')
#                     else:
#                         # Use the original filename base if law_id is not found
#                         filename = os.path.splitext(pdf_file)[0]
#
#                     save_to_json(law_data, output_directory, filename)
#                 else:
#                     # Print a message if a file could not be processed
#                     print(f"Skipping saving for {pdf_file} due to processing errors.")
#
import fitz  # PyMuPDF
import json
import re
import os


def clean_text(text_lines):
    """
    Cleans the extracted text lines by removing common headers, footers,
    and page numbers. This function will need to be adapted based on the
    specific format of the eSbírka PDFs.
    """
    cleaned_lines = []
    for line in text_lines:
        # Remove page numbers (e.g., "strana X" or just "X" at the start/end of a page)
        # This is a basic heuristic and might need refinement.
        if re.match(r"^\s*strana \d+\s*$", line, re.IGNORECASE) or \
                re.match(r"^\s*\d+\s*$", line) and len(cleaned_lines) % 50 == 0:  # crude page number detection
            continue
        if "sbírka zákonů" in line.lower() and "ročník" in line.lower():  # Common header
            continue
        if "© Ministerstvo vnitra" in line:  # Common footer
            continue
        cleaned_lines.append(line.strip())
    return [line for line in cleaned_lines if line]  # Remove empty lines


def extract_metadata(text_content_lines):
    """
    Extracts metadata like Law ID, Title, Effective Dates, and Enforcing Agency.
    This is highly dependent on the document structure and will require
    specific parsing rules.
    """
    metadata = {
        "law_id": "UNKNOWN",
        "title": "UNKNOWN",
        "effective_date": "UNKNOWN",
        "publication_date": "UNKNOWN",  # Assuming publication date might also be relevant
        "enforcing_agency": "UNKNOWN",
        "references": [],  # List of references to other laws
        "source_file": ""
    }

    # Placeholder logic - this needs to be significantly improved
    # based on actual document patterns.

    # Attempt to find Law ID (e.g., "455/1991 Sb.")
    for i, line in enumerate(text_content_lines):
        match_id = re.search(r"(\d+/\d{4})\s+Sb\.", line)
        if match_id:
            metadata["law_id"] = match_id.group(1) + " Sb."
            # Often the title is near the law ID
            if i + 1 < len(text_content_lines) and not text_content_lines[i + 1].startswith("§"):
                # Look for a line starting with "o " or "kterým se mění" for the title
                title_candidate_line = ""
                for j in range(i + 1, min(i + 5, len(text_content_lines))):
                    current_line_lower = text_content_lines[j].lower()
                    if text_content_lines[j].startswith("§") or "ČÁST" in text_content_lines[j] or "HLAVA" in \
                            text_content_lines[j]:
                        break
                    if "o " in current_line_lower or "kterým se mění" in current_line_lower or "ze dne" in current_line_lower:
                        title_candidate_line += text_content_lines[j] + " "
                    elif title_candidate_line:  # continue if title has started
                        title_candidate_line += text_content_lines[j] + " "

                if title_candidate_line:
                    # Clean up title: remove date part if it's at the beginning of the title line
                    title_candidate_line = re.sub(r"^\s*ze dne\s+\d+\.\s+\w+\s+\d{4}\s*", "",
                                                  title_candidate_line.strip(), flags=re.IGNORECASE)
                    # Further clean up common prefixes if they are not part of the main title
                    title_candidate_line = re.sub(r"^(ZÁKON|VYHLÁŠKA|NAŘÍZENÍ VLÁDY)\s*", "", title_candidate_line,
                                                  flags=re.IGNORECASE).strip()
                    metadata["title"] = title_candidate_line.strip()

            # Attempt to find publication date (often near the law ID or at the very beginning)
            date_match = re.search(r"ze dne (\d{1,2}\. \w+ \d{4})", " ".join(text_content_lines[:10]),
                                   re.IGNORECASE)  # Check first 10 lines
            if date_match:
                metadata["publication_date"] = date_match.group(1)
            break  # Found law ID, assume it's the main one for this document

    # Placeholder for effective date (often mentioned explicitly, e.g., "Tento zákon nabývá účinnosti dnem...")
    for line in reversed(text_content_lines):  # Search from the end
        effective_date_match = re.search(r"nabývá účinnosti dnem\s+(.*)", line, re.IGNORECASE)
        if effective_date_match:
            metadata["effective_date"] = effective_date_match.group(1).strip().rstrip('.')
            break

    # Placeholder for references (e.g., "zákona č. XYZ/YYYY Sb.")
    for line in text_content_lines:
        references = re.findall(r"(zákon(?:a|u|ě)? č\.\s*\d+/\d{4}\s*Sb\.)", line, re.IGNORECASE)
        for ref in references:
            if ref not in metadata["references"]:
                metadata["references"].append(ref)

        # References like "§ X odst. Y písm. z) zákona č. ..."
        complex_refs = re.findall(
            r"(§\s*\d+[a-z]?\s*(?:odst\.\s*\d+)?\s*(?:písm\.\s*[a-z]\))?\s*zákona č\.\s*\d+/\d{4}\s*Sb\.)", line,
            re.IGNORECASE)
        for ref in complex_refs:
            if ref not in metadata["references"]:
                metadata["references"].append(ref)

    # Enforcing agency is harder and might require a predefined list or NLP.
    # For now, we'll leave it as UNKNOWN.
    # Example: "Ministerstvo financí stanoví:" - this is more for decrees, not primary laws.
    # For laws, it's usually implicit or defined within the text regarding competencies.

    return metadata


def structure_text_content(text_lines):
    """
    Identifies and organizes laws, articles (části), paragraphs (hlavy, paragrafy),
    and subsections (odstavce, písmena).
    This is a complex parsing task and this function provides a very basic starting point.
    """
    structured_content = []
    current_part = None
    current_head = None
    current_paragraph_number = None
    current_paragraph_text = []
    current_subsection_level1_number = None  # for (1), (2) etc.
    current_subsection_level1_text = []
    current_subsection_level2_letter = None  # for a), b) etc.
    current_subsection_level2_text = []

    # Regex patterns
    part_re = re.compile(r"^\s*ČÁST\s+([A-Z]+|[IVXLCDM]+)", re.IGNORECASE)
    head_re = re.compile(r"^\s*HLAVA\s+([IVXLCDM]+)", re.IGNORECASE)
    paragraph_re = re.compile(r"^\s*§\s*(\d+[a-z]?)")  # Matches §1, §1a, etc.
    subsection_l1_re = re.compile(r"^\s*\((\d+)\)")  # Matches (1), (2) etc.
    subsection_l2_re = re.compile(r"^\s*([a-z])\)")  # Matches a), b) etc.

    def store_previous_item():
        nonlocal current_paragraph_text, current_subsection_level1_text, current_subsection_level2_text
        nonlocal current_paragraph_number, current_subsection_level1_number, current_subsection_level2_letter

        if current_subsection_level2_text:
            if not current_subsection_level1_text:  # If sub_l2 is directly under paragraph
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
            # Separate main paragraph text from its sub-items
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
            if current_head:  # Store previous head if any
                if current_part:
                    current_part["heads"].append(current_head)
                else:  # Should not happen if part always comes first
                    structured_content.append(current_head)
                current_head = None
            if current_part:  # Store previous part if any
                structured_content.append(current_part)

            part_id = part_match.group(1)
            # The title of the part is usually on the next line(s)
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
                "paragraphs": []  # For paragraphs directly under a part
            }
            continue  # Title line(s) will be skipped by subsequent iterations if handled here

        if head_match:
            store_previous_item()
            if current_head:  # Store previous head
                if current_part:
                    current_part["heads"].append(current_head)
                else:  # Should not happen if part/head structure is consistent
                    structured_content.append(current_head)

            head_id = head_match.group(1)
            # The title of the head is usually on the next line(s)
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
            # Check if next line is title of paragraph
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
                        len(next_line_stripped.split()) > 10  # Heuristic for paragraph title
                ):
                    if current_paragraph_text and isinstance(current_paragraph_text[-1],
                                                             str):  # Append to previous line if it was text
                        current_paragraph_text[-1] += " " + next_line_stripped  # This is likely the title
                    else:
                        current_paragraph_text.append(next_line_stripped)  # This is likely the title
            continue  # Processed this line

        if subsection_l1_match:
            # Store previous L2 subsection if exists
            if current_subsection_level2_text:
                if not current_subsection_level1_text:  # If sub_l2 is directly under paragraph
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

            # Store previous L1 subsection if exists
            if current_subsection_level1_text:
                current_paragraph_text.append({
                    "type": "subsection_level1",
                    "identifier": current_subsection_level1_number,
                    "content": current_subsection_level1_text if isinstance(current_subsection_level1_text, list) else [
                        current_subsection_level1_text]
                })

            current_subsection_level1_number = subsection_l1_match.group(1)
            current_subsection_level1_text = []  # Reset for new L1 subsection
            text_after_identifier = line_text_stripped[len(subsection_l1_match.group(0)):].strip()
            if text_after_identifier:
                current_subsection_level1_text.append(text_after_identifier)
            continue

        if subsection_l2_match:
            # Store previous L2 subsection if exists
            if current_subsection_level2_text:
                item_to_append_to = current_subsection_level1_text if current_subsection_level1_number else current_paragraph_text
                item_to_append_to.append({
                    "type": "subsection_level2",
                    "identifier": current_subsection_level2_letter,
                    "text": " ".join(current_subsection_level2_text).strip()
                })

            current_subsection_level2_letter = subsection_l2_match.group(1)
            current_subsection_level2_text = []  # Reset for new L2
            text_after_identifier = line_text_stripped[len(subsection_l2_match.group(0)):].strip()
            if text_after_identifier:
                current_subsection_level2_text.append(text_after_identifier)
            continue

        # Append text to the current active item
        if current_subsection_level2_letter:
            current_subsection_level2_text.append(line_text_stripped)
        elif current_subsection_level1_number:
            current_subsection_level1_text.append(line_text_stripped)
        elif current_paragraph_number:
            current_paragraph_text.append(line_text_stripped)
        # else:
        # This text is likely part of a part/head title or general intro before first paragraph
        # Or it's general text not fitting into the above structures.
        # For simplicity, we'll associate it with the current part/head if one exists,
        # or add as a general text block if nothing else is active.
        # if current_head and isinstance(current_head.get("title"), str) and not current_head.get("paragraphs"):
        #     current_head["title"] += " " + line_text_stripped
        # elif current_part and isinstance(current_part.get("title"), str) and not (current_part.get("heads") or current_part.get("paragraphs")):
        #     current_part["title"] += " " + line_text_stripped
        # elif not structured_content or structured_content[-1].get("type") == "general_text":
        #     if not structured_content or structured_content[-1].get("type") != "general_text":
        #         structured_content.append({"type": "general_text", "text": line_text_stripped})
        #     else:
        #         structured_content[-1]["text"] += " " + line_text_stripped
        # else: # Fallback: append to the last known paragraph's text if it's just free text
        #     if current_paragraph_text:
        #          current_paragraph_text.append(line_text_stripped)

    # Store any remaining items after the loop
    store_previous_item()
    if current_head:  # Store last head
        if current_part:
            current_part["heads"].append(current_head)
        else:
            structured_content.append(current_head)
    if current_part:  # Store last part
        structured_content.append(current_part)

    # Consolidate text for list-based content in subsections
    for item in structured_content:
        if item.get("type") == "paragraph" and "subsections" in item:
            for sub_item in item["subsections"]:
                if sub_item.get("type") == "subsection_level1" and isinstance(sub_item.get("content"), list):
                    # Join text parts, keep dictionaries as they are
                    new_content = []
                    current_text_segment = []
                    for content_part in sub_item["content"]:
                        if isinstance(content_part, str):
                            current_text_segment.append(content_part)
                        else:  # It's a dict (e.g. subsection_level2)
                            if current_text_segment:
                                new_content.append(" ".join(current_text_segment).strip())
                                current_text_segment = []
                            new_content.append(content_part)
                    if current_text_segment:
                        new_content.append(" ".join(current_text_segment).strip())
                    sub_item["content"] = new_content[0] if len(new_content) == 1 and isinstance(new_content[0],
                                                                                                 str) else new_content

                # if sub_item.get("type") == "subsection_level2" and isinstance(sub_item.get("text"), list):
                #     sub_item["text"] = " ".join(sub_item["text"]).strip()

    return structured_content


def pdf_to_structured_json(pdf_path, json_path):
    """
    Main function to convert a PDF to a structured JSON file.
    """
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

    # Basic cleaning of lines (can be improved)
    # Remove "--- PAGE X ---" markers if they exist from a previous text dump
    all_text_lines = [line for line in all_text_lines if not re.match(r"^-+ PAGE \d+ -+$", line)]

    # More advanced cleaning (headers, footers, page numbers)
    # This is heuristic and needs to be tailored to the specific PDF format
    # For eSbírka, headers might include "Sbírka zákonů" and footers might have page numbers or ministry info.

    # A simple approach: remove lines that are just numbers (likely page numbers)
    # and lines that look like "strana X"
    cleaned_lines = []
    for line in all_text_lines:
        stripped_line = line.strip()
        # Heuristic for page numbers and common headers/footers
        if re.fullmatch(r"strana \d+", stripped_line, re.IGNORECASE):
            continue
        if re.fullmatch(r"\d+", stripped_line) and (len(cleaned_lines) > 0 and len(cleaned_lines[-1]) > 60 or len(
                cleaned_lines) == 0):  # if previous line was long, this might be a page number
            # This is a very basic heuristic for page numbers
            pass  # Potentially skip, but needs care not to remove actual short numeric data

        # Skip lines that are part of the PDF's own header/footer structure if identifiable
        # Example: "455" at the top of a page if it's a collection number.
        # This needs careful pattern matching.
        if page_num > 0 and stripped_line == doc[0].get_text("blocks")[0][4].split('\n')[
            0].strip():  # crude check for repeated header from first page
            # continue
            pass

        cleaned_lines.append(stripped_line)

    # Remove empty lines after stripping
    cleaned_lines = [line for line in cleaned_lines if line]

    # Further cleaning specific to the document structure (e.g., annotations like "23n)")
    # This is complex. For now, we'll keep them as they might be part of the text.
    # A more advanced step would be to identify and potentially move them to a "notes" field.

    metadata = extract_metadata(cleaned_lines)
    metadata["source_file"] = os.path.basename(pdf_path)

    # The actual text content for the main body of the law
    # This might involve skipping initial pages if they are cover pages or tables of contents
    # For now, we assume `cleaned_lines` is the main content.
    structured_law_text = structure_text_content(cleaned_lines)

    output_data = {
        "metadata": metadata,
        "text_content": cleaned_lines,  # Or use structured_law_text for more granularity
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

    # Create an 'output' directory if it doesn't exist
    if not os.path.exists(output_directory):
        os.makedirs(output_directory)
        print(f"Created output directory: '{output_directory}'")

    # Check if the input directory exists
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

                # Construct the output JSON path
                output_json_filename = os.path.splitext(filename)[0] + ".json"
                output_json_path = os.path.join(output_directory, output_json_filename)

                print(f"Processing '{input_pdf_path}'...")
                try:
                    # This is where your actual PDF processing function is called
                    pdf_to_structured_json(input_pdf_path, output_json_path)
                    print(f"Successfully processed '{input_pdf_path}' to '{output_json_path}'")
                except Exception as e:
                    print(f"Error processing file '{input_pdf_path}': {e}")

        if not found_pdf_files:
            print(f"No PDF files found in '{input_directory}'.")

    print("Script finished.")