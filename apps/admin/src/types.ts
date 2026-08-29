export type BlockType = 'heading' | 'prose' | 'formula' | 'example' | 'exercise'
  | 'solution' | 'graph' | 'table' | 'image' | 'contents' | 'footer';
export type BoundingBox = [number, number, number, number];

export interface Candidate {
  id: string;
  engine: string;
  passName: string;
  contentMarkdown: string;
  latex: string | null;
  confidence: number | null;
}
export interface Block {
  id: string;
  pageId: string;
  sequenceNumber: number;
  blockType: BlockType;
  boundingBox: BoundingBox;
  confidence: number | null;
  reviewState: 'pending' | 'approved' | 'rejected';
  reviewReasons: string[];
  contentMarkdown: string;
  candidates: Candidate[];
}
export interface PageSummary {
  id: string;
  documentId: string;
  filePageNumber: number;
  printedPageNumber: string | null;
  imagePath: string;
  verifiedAt: string | null;
  resolvedBlockCount: number;
  totalBlockCount: number;
}
export interface PageDetail extends PageSummary {
  width: number | null;
  height: number | null;
  blocks: Block[];
}
export interface DocumentSummary {
  id: string;
  title: string;
  pageCount: number;
  resolvedBlockCount: number;
  totalBlockCount: number;
}
