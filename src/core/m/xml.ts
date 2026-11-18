import { MError } from "./errors.ts";

/** A minimal, dependency-free XML parser (elements, attributes, text, CDATA, entities; no DTDs). */
export interface XmlElement {
  name: string;
  /** namespace URI resolved from xmlns declarations ("" when none) */
  ns: string;
  attrs: { name: string; ns: string; value: string }[];
  children: (XmlElement | string)[];
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(src: string): XmlElement {
  let i = 0;
  const fail = (msg: string): never => {
    throw new MError("DataFormat.Error", `We couldn't parse the XML input: ${msg} (at position ${i}).`);
  };
  const skipMisc = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i]!)) i++;
      if (src.startsWith("<?", i)) {
        const e = src.indexOf("?>", i);
        if (e < 0) fail("unterminated processing instruction");
        i = e + 2;
      } else if (src.startsWith("<!--", i)) {
        const e = src.indexOf("-->", i);
        if (e < 0) fail("unterminated comment");
        i = e + 3;
      } else if (src.startsWith("<!DOCTYPE", i)) {
        let depth = 0;
        while (i < src.length) {
          const c = src[i++];
          if (c === "[") depth++;
          else if (c === "]") depth--;
          else if (c === ">" && depth <= 0) break;
        }
      } else return;
    }
  };
  const nameAt = (): string => {
    const m = /^[^\s/>=]+/.exec(src.slice(i, i + 256));
    if (!m) fail("expected a name");
    i += m![0].length;
    return m![0];
  };
  const element = (scope: Map<string, string>): XmlElement => {
    if (src[i] !== "<") fail("expected '<'");
    i++;
    const qname = nameAt();
    const rawAttrs: [string, string][] = [];
    for (;;) {
      while (/\s/.test(src[i] ?? "")) i++;
      if (src[i] === "/" || src[i] === ">") break;
      const an = nameAt();
      while (/\s/.test(src[i] ?? "")) i++;
      if (src[i] !== "=") fail("expected '='");
      i++;
      while (/\s/.test(src[i] ?? "")) i++;
      const q = src[i];
      if (q !== '"' && q !== "'") fail("expected a quoted attribute value");
      const end = src.indexOf(q!, i + 1);
      if (end < 0) fail("unterminated attribute value");
      rawAttrs.push([an, decodeEntities(src.slice(i + 1, end))]);
      i = end + 1;
    }
    const local = new Map(scope);
    for (const [n, v] of rawAttrs) {
      if (n === "xmlns") local.set("", v);
      else if (n.startsWith("xmlns:")) local.set(n.slice(6), v);
    }
    const split = (q: string, isAttr: boolean) => {
      const c = q.indexOf(":");
      if (c < 0) return { name: q, ns: isAttr ? "" : (local.get("") ?? "") };
      return { name: q.slice(c + 1), ns: local.get(q.slice(0, c)) ?? "" };
    };
    const el: XmlElement = {
      ...split(qname, false),
      attrs: rawAttrs.filter(([n]) => n !== "xmlns" && !n.startsWith("xmlns:")).map(([n, v]) => ({ ...split(n, true), value: v })),
      children: [],
    };
    if (src[i] === "/") {
      if (src[i + 1] !== ">") fail("expected '/>'");
      i += 2;
      return el;
    }
    i++;
    let text = "";
    const flush = () => {
      if (text) el.children.push(text);
      text = "";
    };
    for (;;) {
      if (i >= src.length) fail(`unterminated element <${qname}>`);
      if (src.startsWith("</", i)) {
        i += 2;
        const close = nameAt();
        if (close !== qname) fail(`expected </${qname}> but found </${close}>`);
        while (/\s/.test(src[i] ?? "")) i++;
        i++;
        flush();
        return el;
      }
      if (src.startsWith("<![CDATA[", i)) {
        const e = src.indexOf("]]>", i);
        if (e < 0) fail("unterminated CDATA");
        text += src.slice(i + 9, e);
        i = e + 3;
        continue;
      }
      if (src.startsWith("<!--", i)) {
        const e = src.indexOf("-->", i);
        i = e < 0 ? src.length : e + 3;
        continue;
      }
      if (src.startsWith("<?", i)) {
        const e = src.indexOf("?>", i);
        i = e < 0 ? src.length : e + 2;
        continue;
      }
      if (src[i] === "<") {
        flush();
        el.children.push(element(local));
        continue;
      }
      const next = src.indexOf("<", i);
      const end = next < 0 ? src.length : next;
      text += decodeEntities(src.slice(i, end));
      i = end;
    }
  };
  skipMisc();
  const root = element(new Map());
  skipMisc();
  return root;
}

/** Text content of an element (concatenated descendant text). */
export function xmlText(el: XmlElement): string {
  return el.children.map((c) => (typeof c === "string" ? c : xmlText(c))).join("");
}
