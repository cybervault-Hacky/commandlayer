/**
 * Page Intelligence Engine — extraction-only page understanding.
 *
 * The content script calls `extractPageContext(document)` on demand; the
 * background validates the result with `parsePageContext`. No section of
 * this module touches the network, storage, or user input.
 */
export { PAGE_LIMITS } from './limits';
export { cleanText, cleanUrl, cleanLanguage, cleanMethod, cleanInputType } from './sanitizer';
export { isElementVisible, isInsideNonRenderedElement } from './visibility';
export { extractMetadata, type PageMetadata } from './metadata';
export { extractHeadings } from './headings';
export { extractParagraphs } from './text';
export { extractLinks } from './links';
export { extractTables } from './tables';
export { extractForms } from './forms';
export { extractSelection } from './selection';
export { fnv1a32, pageContentDigest } from './hash';
export { extractPageContext, type ExtractOptions } from './extractor';
export { parsePageContext } from './validator';
export {
  CONTENT_PROTOCOL_VERSION,
  EXTRACT_PAGE_REQUEST_TYPE,
  buildExtractPageRequest,
  isExtractPageRequest,
  isExtractPageResponseSuccess,
  type ExtractPageRequest,
  type ExtractPageResponse,
} from './protocol';
export { PROFILE_SECTIONS, isPageSection, sectionsForQuickAction } from './profiles';
