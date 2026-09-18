import type {} from "mdast-util-math";
import type {} from "remark-parse";
import type { Extension as FromMarkdownExtension } from "mdast-util-from-markdown";
import type {
  Construct,
  Extension,
  State,
  Tokenizer,
} from "micromark-util-types";
import type { Processor } from "unified";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    latexMath: "latexMath";
    latexMathData: "latexMathData";
  }
}

const tokenize: Tokenizer = (effects, ok, nok) => {
  let close: number;
  const start: State = (code) => {
    effects.enter("latexMath");
    effects.enter("latexMathData");
    effects.consume(code);
    return opening;
  };
  const opening: State = (code) => {
    if (code !== 40 && code !== 91) return nok(code);
    close = code === 40 ? 41 : 93;
    effects.consume(code);
    return body;
  };
  const body: State = (code) => {
    if (code === null) return nok(code);
    if (code === -5 || code === -4 || code === -3) {
      effects.exit("latexMathData");
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      return afterLine;
    }
    if (code === 92) {
      effects.consume(code);
      return escaped;
    }
    effects.consume(code);
    return body;
  };
  const afterLine: State = (code) => {
    effects.enter("latexMathData");
    return body(code);
  };
  const escaped: State = (code) => {
    if (code === close) {
      effects.consume(code);
      effects.exit("latexMathData");
      effects.exit("latexMath");
      return ok;
    }
    if (code === null) return nok(code);
    if (code === -5 || code === -4 || code === -3) return body(code);
    effects.consume(code);
    return body;
  };
  return start;
};

const construct: Construct = { name: "latexMath", tokenize };
const syntax: Extension = { text: { 92: construct } };
const fromMarkdown: FromMarkdownExtension = {
  enter: {
    latexMath(token) {
      this.enter({ type: "inlineMath", value: "" }, token);
    },
  },
  exit: {
    latexMath(token) {
      const raw = this.sliceSerialize(token);
      const node = this.stack[this.stack.length - 1];
      if (node.type !== "inlineMath") return;
      node.value = raw.slice(2, -2);
      this.exit(token);
    },
  },
};

// Register before CommonMark's character escape consumes the opening slash.
export function remarkLatex(this: Processor) {
  const data = this.data();
  data.micromarkExtensions ??= [];
  data.micromarkExtensions.push(syntax);
  data.fromMarkdownExtensions ??= [];
  data.fromMarkdownExtensions.push(fromMarkdown);
}
