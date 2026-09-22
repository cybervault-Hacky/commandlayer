import type { PageFormField, PageForm } from '@/shared/types/page';
import { PAGE_LIMITS } from './limits';
import {
  cleanInputType,
  cleanMethod,
  cleanText,
  elementText,
} from './sanitizer';
import { isElementVisible } from './visibility';

/**
 * Structural form detection ONLY.
 *
 * For every field we record: name, type, label, required.
 * We NEVER read `.value` on any element — input contents (passwords,
 * credit cards, OTPs, tokens, typed private data) are out of scope by
 * design. The regression tests in __tests__/forms.test.ts prove it.
 */

function fieldLabel(field: Element, doc: Document): string | undefined {
  const id = field.getAttribute('id');
  if (id) {
    const label = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
    const text = label ? elementText(label, PAGE_LIMITS.MAX_FIELD_LABEL_LENGTH) : '';
    if (text) return text;
  }
  const wrapping = field.closest('label');
  if (wrapping) {
    const text = elementText(wrapping, PAGE_LIMITS.MAX_FIELD_LABEL_LENGTH);
    if (text) return text;
  }
  const ariaLabel = field.getAttribute('aria-label');
  if (ariaLabel) {
    const text = cleanText(ariaLabel, PAGE_LIMITS.MAX_FIELD_LABEL_LENGTH);
    if (text) return text;
  }
  return undefined;
}

function extractField(field: Element, doc: Document): PageFormField {
  const tag = field.tagName.toLowerCase();

  let type: string;
  if (tag === 'select') type = 'select';
  else if (tag === 'textarea') type = 'textarea';
  else if (tag === 'button') type = 'button';
  else type = cleanInputType(field.getAttribute('type'));

  const nameRaw = field.getAttribute('name');
  const name =
    nameRaw !== null ? (cleanText(nameRaw, PAGE_LIMITS.MAX_FIELD_NAME_LENGTH) ?? undefined) : undefined;

  const label = fieldLabel(field, doc);
  const required =
    field.hasAttribute('required') || field.getAttribute('aria-required') === 'true';

  return {
    ...(name ? { name } : {}),
    type,
    ...(label ? { label } : {}),
    required,
  };
}

export function extractForms(doc: Document): {
  forms: PageForm[];
  truncated: boolean;
} {
  const forms: PageForm[] = [];
  let truncated = false;

  const nodes = doc.querySelectorAll('form');
  for (const node of Array.from(nodes)) {
    if (forms.length >= PAGE_LIMITS.MAX_FORMS) {
      truncated = true;
      break;
    }
    if (!isElementVisible(node)) continue;

    const actionRaw = node.getAttribute('action');
    const action = actionRaw
      ? (cleanText(actionRaw, PAGE_LIMITS.MAX_URL) ?? undefined)
      : undefined;

    const fieldNodes = node.querySelectorAll(
      'input, select, textarea, button',
    );
    const fields: PageFormField[] = [];
    let formTruncated = false;
    for (const fieldNode of Array.from(fieldNodes)) {
      if (fields.length >= PAGE_LIMITS.MAX_FORM_FIELDS) {
        formTruncated = true;
        break;
      }
      fields.push(extractField(fieldNode, doc));
    }

    forms.push({
      ...(action ? { action } : {}),
      method: cleanMethod(node.getAttribute('method') ?? node.method),
      fields,
      truncated: formTruncated,
    });
    truncated = truncated || formTruncated;
  }

  return { forms, truncated };
}
