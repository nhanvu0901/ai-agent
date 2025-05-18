
export interface LawMetadata {
    law_id: string;
    title: string;
    promulgation_date?: string;
    effective_date?: string;
    agency?: string;
    references?: string[];
    source_file?: string;
}

export interface BaseStructuralElement {
    type: string;
    identifier: string;
    title?: string;
    text?: string;
}

export interface SubsectionLevel2 extends BaseStructuralElement {
    type: "subsection_level2";
    text: string;
}

export interface SubsectionLevel1 extends BaseStructuralElement {
    type: "subsection_level1";
    content: (string | SubsectionLevel2)[];
}

export interface Paragraph extends BaseStructuralElement {
    type: "paragraph";
    subsections?: (SubsectionLevel1 | SubsectionLevel2)[];
}

export interface Head extends BaseStructuralElement {
    type: "head";
    paragraphs: Paragraph[];
}

export interface Part extends BaseStructuralElement {
    type: "part";
    heads?: Head[];
    paragraphs?: Paragraph[];
}

export interface LawJson {
    metadata: LawMetadata;
    text_content: string[];
    structured_text: Part[];
}