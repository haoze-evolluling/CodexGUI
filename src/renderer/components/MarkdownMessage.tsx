import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

const markdownPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

export const MarkdownMessage = memo(function MarkdownMessage({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`markdown-body${className ? ` ${className}` : ''}`}>
      <ReactMarkdown remarkPlugins={markdownPlugins} rehypePlugins={rehypePlugins}>{text}</ReactMarkdown>
    </div>
  );
});
